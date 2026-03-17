// @ts-check

import { RingMesh } from "./planet_ring_mesh.js";
import { RadialGraph, buildPassableMask, dijkstraMap, nearestRadialNode } from "./navigation.js";
import { MapGen } from "./mapgen.js";
import { CFG, GAME } from "./config.js";
import { mulberry32 } from "./rng.js";
import { buildPlanetMaterials, createIceShardHazard, createRidgeSpikeHazard, createMushroomHazard, createPlanetFeatures } from "./planet_features.js";

/**
 * @param {import("./planet_config.js").PlanetConfig|null|undefined} cfg
 * @returns {{min:number,max:number}}
 */
function getFactorySpawnCooldownRange(cfg){
  const min = (cfg && typeof cfg.factorySpawnCooldownMin === "number") ? cfg.factorySpawnCooldownMin : 6.5;
  const max = (cfg && typeof cfg.factorySpawnCooldownMax === "number") ? cfg.factorySpawnCooldownMax : 10.5;
  const lo = Math.max(0.1, Math.min(min, max));
  const hi = Math.max(lo, Math.max(min, max));
  return { min: lo, max: hi };
}

/**
 * Planet terrain abstraction backed by mapgen grid truth.
 */
export class Planet {
  /**
   * @param {{seed:number, planetConfig: import("./planet_config.js").PlanetConfig, planetParams: import("./planet_config.js").PlanetParams, mapWorld?:import("./types.d.js").MapWorld|null}} deps
   */
  constructor({ seed, planetConfig, planetParams, mapWorld = null }){
    if (!planetConfig) {
      throw new Error("Planet requires a planetConfig");
    }
    if (!planetParams) {
      throw new Error("Planet requires planetParams");
    }
    this.planetConfig = planetConfig;
    this.planetParams = planetParams;
    this.coreRadius = this._coreRadiusWorld();
    this.mapgen = new MapGen(seed, planetParams, mapWorld);
    const rPlanet = planetParams.RMAX ?? CFG.RMAX;
    this.planetRadius = rPlanet;
    const surfaceG = (typeof planetParams.SURFACE_G === "number") ? planetParams.SURFACE_G : 2.0;
    this.gravitationalConstant = surfaceG * rPlanet * rPlanet;

    this.radial = new RingMesh(this.mapgen, planetParams);
    this.radialGraph = new RadialGraph(this.radial);
    this.airNodesBitmap = buildAirNodesBitmap(this.radialGraph, this.radial);
    /** @type {Float32Array} */
    this.distanceToTarget = new Float32Array(this.radialGraph.nodes.length);
    const mats = buildPlanetMaterials(this.mapgen, this.planetConfig, this.planetParams);
    this.material = mats.material;
    this.props = mats.props;
    this.iceShardHazard = createIceShardHazard(this.props || []);
    this.ridgeSpikeHazard = createRidgeSpikeHazard(this.props || []);
    this.mushroomHazard = createMushroomHazard(this.props || []);
    /** @type {Array<[number,number,number,number]>} */
    this._standablePoints = [];
    /** @type {Array<{x:number,y:number,r:number}>} */
    this._spawnReservations = [];
    /** @type {Uint8Array|null} */
    this._spawnReachableMask = null;
    this._rebuildSpawnReachabilityMask();
    this._spreadIceShardsUniform();
    this._snapIceShardsToSurface();
    this._alignTurretPadsToSurface();
    this._alignVentsToSurface();
    this._alignGaiaFlora();
    this._alignSurfaceDebris();
    this._alignCavernDebris();
    this._alignMechanizedStructures();
    this._reserveSpawnPointsFromProps();
    if (!this._standablePoints || !this._standablePoints.length){
      this._standablePoints = this._buildStandablePoints();
    }

    this.features = createPlanetFeatures(this, this.props || [], this.iceShardHazard, this.ridgeSpikeHazard, this.mushroomHazard);

    /** @type {Array<[number,number,boolean,number]>|null} */
    this._radialDebugPoints = null;
    /** @type {boolean} */
    this._radialDebugDirty = true;
  }

  /**
   * @returns {number}
   */
  getSeed(){
    return this.mapgen.getWorld().seed;
  }

  /**
   * @returns {number}
   */
  getFinalAir(){
    return this.mapgen.getWorld().finalAir;
  }

  /**
   * @returns {{seed:number, finalAir:number}}
   */
  getWorldMeta(){
    const world = this.mapgen.getWorld();
    return { seed: world.seed, finalAir: world.finalAir };
  }

  /**
   * @returns {import("./planet_config.js").PlanetConfig}
   */
  getPlanetConfig(){
    return this.planetConfig;
  }

  /**
   * @returns {import("./planet_config.js").PlanetParams}
   */
  getPlanetParams(){
    return this.planetParams;
  }

  /**
   * @returns {{
   *  iceShard:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number}>,
   *  lava:Array<{x:number,y:number,vx:number,vy:number,life:number}>,
   *  mushroom:Array<{x:number,y:number,vx:number,vy:number,life:number}>,
   *  bubbles:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,spin:number}>,
   *  splashes:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,cr:number,cg:number,cb:number}>
   * }}
   */
  getFeatureParticles(){
    return this.features ? this.features.getParticles() : { iceShard: [], lava: [], mushroom: [], bubbles: [], splashes: [] };
  }

  /**
   * @returns {void}
   */
  clearFeatureParticles(){
    if (this.features) this.features.clearParticles();
  }

  /**
   * @returns {number}
   */
  getCoreRadius(){
    return this.coreRadius || 0;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {{x:number,y:number,scale:number}|null}
   */
  /**
   * @param {number} dt
   * @param {{
   *  ship: import("./types.d.js").Ship,
   *  enemies: Array<{x:number,y:number,hp:number,hitT?:number,stunT?:number}>,
   *  miners: import("./types.d.js").Miner[],
   *  onShipDamage?: (x:number, y:number)=>void,
   *  onShipHeat?: (amount:number)=>void,
   *  onShipConfuse?: (duration:number)=>void,
   *  onEnemyHit?: (enemy:{x:number,y:number,hp:number,hitT?:number,stunT?:number}, x:number, y:number)=>void,
   *  onEnemyStun?: (enemy:{x:number,y:number,hp:number,hitT?:number,stunT?:number}, duration:number)=>void,
   *  onMinerKilled?: (miner:import("./types.d.js").Miner)=>void,
   * }} state
   * @returns {void}
   */
  updateFeatureEffects(dt, state){
    if (this.features) this.features.update(dt, state);
  }

  /**
   * @param {{enemies:Array<{x:number,y:number}>, miners:Array<{x:number,y:number}>}} state
   * @returns {void}
   */
  reconcileFeatures(state){
    if (this.features && this.features.reconcile) this.features.reconcile(state);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {{
   *  onExplosion?: (info:{x:number,y:number,life:number,radius:number})=>void,
   *  onDebris?: (info:{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number})=>void,
   *  onAreaDamage?: (x:number, y:number, radius:number)=>void,
   * }} callbacks
   * @returns {boolean}
   */
  handleFeatureContact(x, y, radius, callbacks){
    if (!this.features) return false;
    return this.features.handleShipContact(x, y, radius, callbacks);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {{
   *  onExplosion?: (info:{x:number,y:number,life:number,radius:number})=>void,
   *  onDebris?: (info:{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number})=>void,
   *  onAreaDamage?: (x:number, y:number, radius:number)=>void,
   * }} callbacks
   * @returns {boolean}
   */
  handleFeatureShot(x, y, radius, callbacks){
    if (!this.features) return false;
    return this.features.handleShot(x, y, radius, callbacks);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} impactRadius
   * @param {number} bombRadius
   * @param {{
   *  onExplosion?: (info:{x:number,y:number,life:number,radius:number})=>void,
   *  onDebris?: (info:{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number})=>void,
   *  onAreaDamage?: (x:number, y:number, radius:number)=>void,
   * }} callbacks
   * @returns {boolean}
   */
  handleFeatureBomb(x, y, impactRadius, bombRadius, callbacks){
    if (!this.features) return false;
    return this.features.handleBomb(x, y, impactRadius, bombRadius, callbacks);
  }

  /**
   * Find nearest radial node to world point using ring radius.
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  nearestRadialNodeInAir(x, y){
    const graph = this.radialGraph;
    const iNode = nearestRadialNode(graph, this.radial, x, y);
    if (iNode < 0 || iNode >= graph.nodes.length) return -1;
    const air = this.airNodesBitmap;
    if (air[iNode]) return iNode;
    const hasAirNeighbor = (idx) => {
      for (const edge of graph.neighbors[idx]){
        if (air[edge.to]) return true;
      }
      return false;
    };

    // First, expand locally in graph space to find nearby passable nodes.
    const visited = new Uint8Array(graph.nodes.length);
    /** @type {number[]} */
    let frontier = [iNode];
    visited[iNode] = 1;
    let bestMovable = -1;
    let bestMovableDistSqr = Infinity;
    let best = -1;
    let bestDistSqr = Infinity;
    const maxHops = 6;
    for (let hop = 0; hop < maxHops && frontier.length; hop++){
      /** @type {number[]} */
      const next = [];
      for (const idx of frontier){
        if (air[idx]){
          const node = graph.nodes[idx];
          const dx = x - node.x;
          const dy = y - node.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDistSqr){
            bestDistSqr = d2;
            best = idx;
          }
          if (hasAirNeighbor(idx) && d2 < bestMovableDistSqr){
            bestMovableDistSqr = d2;
            bestMovable = idx;
          }
        }
        for (const edge of graph.neighbors[idx]){
          const j = edge.to;
          if (visited[j]) continue;
          visited[j] = 1;
          next.push(j);
        }
      }
      if (bestMovable >= 0) return bestMovable;
      if (best >= 0) return best;
      frontier = next;
    }

    // Fallback: nearest passable node globally.
    for (let i = 0; i < graph.nodes.length; i++){
      if (!air[i]) continue;
      const node = graph.nodes[i];
      const dx = x - node.x;
      const dy = y - node.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDistSqr){
        bestDistSqr = d2;
        best = i;
      }
      if (hasAirNeighbor(i) && d2 < bestMovableDistSqr){
        bestMovableDistSqr = d2;
        bestMovable = i;
      }
    }
    if (bestMovable >= 0) return bestMovable;
    return best >= 0 ? best : iNode;
  }

  /**
   * Compute and cache a distance map for every node in the graph to a given target position.
   * Useful when multiple enemies all want to go to the same place.
   * @param {number} x 
   * @param {number} y 
   * @returns {void}
   */
  computeDistanceMapTo(x, y){
    const radialGraph = this.radialGraph;
    const nodeTarget = this.nearestRadialNodeInAir(x, y);
    this.distanceToTarget = dijkstraMap(radialGraph, [nodeTarget], this.airNodesBitmap);    
  }

  /**
   * @returns {number}
   */
  _coreRadiusWorld(){
    const p = this.planetParams;
    if (!p || !p.CORE_RADIUS) return 0;
    if (p.CORE_RADIUS > 1) return p.CORE_RADIUS;
    return p.CORE_RADIUS * (p.RMAX || 0);
  }

  /**
   * Align vent props to landable points.
   * @returns {void}
   */
  _alignVentsToSurface(){
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    if (cfg && cfg.id === "molten") return;
    if (!this.props || !this.props.length) return;
    const vents = [];
    for (const p of this.props){
      if (p.type === "vent") vents.push(p);
    }
    if (!vents.length) return;
    const seed = (this.mapgen.getWorld().seed | 0) + 1721;
    const points = this.sampleLandablePoints(vents.length, seed, 0.30, 0.2, "random");
    if (!points.length) return;
    for (let i = 0; i < vents.length; i++){
      const p = vents[i];
      const idx = i % points.length;
      const pt = points[idx];
      p.x = pt[0];
      p.y = pt[1];
    }
  }

  /**
   * Align Gaia flora: trees on landable surface, mushrooms underground.
   * @returns {void}
   */
  _alignGaiaFlora(){
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    if (!cfg || cfg.id !== "gaia") return;
    if (!this.props || !this.props.length) return;
    const trees = [];
    const mush = [];
    for (const p of this.props){
      if (p.type === "tree") trees.push(p);
      else if (p.type === "mushroom") mush.push(p);
    }
    if (trees.length){
      const seed = (this.mapgen.getWorld().seed | 0) + 811;
      const surfaceBand = (cfg.defaults && typeof cfg.defaults.SURFACE_BAND === "number") ? cfg.defaults.SURFACE_BAND : 0;
      const surfaceR = this.planetParams.RMAX * (1 - surfaceBand);
      const rMax = this.planetParams.RMAX - 0.2;
      const eps = 0.18;
      const minDist = 0.35;
      const rand = mulberry32(seed);
      const standable = (this._standablePoints && this._standablePoints.length)
        ? this._standablePoints
        : this._buildStandablePoints();
      const bandPoints = standable.filter((p) => p[3] >= surfaceR && p[3] <= rMax);
      const flatPoints = bandPoints.filter((p) => {
        const info = this.surfaceInfoAtWorld(p[0], p[1], eps);
        if (!info) return false;
        const r = Math.hypot(p[0], p[1]) || 1;
        const nx = p[0] / r;
        const ny = p[1] / r;
        const dot = info.nx * nx + info.ny * ny;
        return dot >= 0.98;
      });
      const pool = flatPoints.length ? flatPoints : (bandPoints.length ? bandPoints : standable);
      /** @type {Array<[number,number,number,number]>} */
      const shuffled = pool.slice();
      for (let i = shuffled.length - 1; i > 0; i--){
        const j = Math.floor(rand() * (i + 1));
        const tmp = shuffled[i];
        shuffled[i] = shuffled[j];
        shuffled[j] = tmp;
      }
      /** @type {Array<[number,number]>} */
      const points = [];
      for (const sp of shuffled){
        if (points.length >= trees.length) break;
        const x = sp[0];
        const y = sp[1];
        let ok = true;
        for (const q of points){
          const dx = x - q[0];
          const dy = y - q[1];
          if (dx * dx + dy * dy < minDist * minDist){
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        points.push([x, y]);
      }
      for (let i = 0; i < trees.length; i++){
        const p = trees[i];
        if (i >= points.length){
          p.dead = true;
          continue;
        }
        const pt = points[i];
        p.x = pt[0];
        p.y = pt[1];
        const info = this.surfaceInfoAtWorld(p.x, p.y, eps);
        if (info){
          p.nx = info.nx;
          p.ny = info.ny;
          const recess = 0.02;
          p.x -= info.nx * recess;
          p.y -= info.ny * recess;
        }
      }
    }
    if (mush.length){
      const seed = (this.mapgen.getWorld().seed | 0) + 877;
      const points = this.sampleUndergroundPoints(mush.length, seed, "random");
      for (let i = 0; i < mush.length && i < points.length; i++){
        const p = mush[i];
        const pt = points[i];
        p.x = pt[0];
        p.y = pt[1];
      }
    }
  }

  /**
   * Align no-caves/water debris onto standable surface using radial-graph standable points.
   * @returns {void}
   */
  _alignSurfaceDebris(){
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    if (!cfg || (cfg.id !== "no_caves" && cfg.id !== "water")) return;
    if (!this.props || !this.props.length) return;
    const debris = [];
    for (const p of this.props){
      if (p.type === "boulder" || p.type === "ridge_spike") debris.push(p);
    }
    if (!debris.length) return;
    if (!this._standablePoints || !this._standablePoints.length){
      this._standablePoints = this._buildStandablePoints();
    }
    const seed = (this.mapgen.getWorld().seed | 0) + ((cfg.id === "no_caves") ? 1207 : 1239);
    const placement = (cfg.id === "no_caves") ? "uniform" : "random";
    const minDist = (cfg.id === "no_caves") ? 0.5 : 0.4;
    const points = this.sampleStandablePoints(debris.length, seed, placement, minDist, false);
    for (let i = 0; i < debris.length; i++){
      const p = debris[i];
      const pt = points[i];
      if (!pt){
        p.dead = true;
        continue;
      }
      p.x = pt[0];
      p.y = pt[1];
      const info = this.surfaceInfoAtWorld(p.x, p.y, 0.18);
      if (!info) continue;
      p.nx = info.nx;
      p.ny = info.ny;
      const sink = (p.type === "boulder") ? (0.06 * (p.scale || 1)) : (0.035 * (p.scale || 1));
      p.x -= info.nx * sink;
      p.y -= info.ny * sink;
      p.rot = Math.atan2(info.ny, info.nx) - Math.PI * 0.5;
    }
  }

  /**
   * Sample cave-wall attachment points from radial graph air/rock boundaries.
   * @param {number} count
   * @param {number} seed
   * @param {number} minDist
   * @returns {Array<{x:number,y:number,nx:number,ny:number}>}
   */
  _sampleCaveAttachmentPoints(count, seed, minDist = 0.45){
    if (count <= 0) return [];
    const graph = this.radialGraph;
    const nodes = graph && graph.nodes ? graph.nodes : [];
    const neighbors = graph && graph.neighbors ? graph.neighbors : [];
    const air = this.airNodesBitmap;
    if (!nodes.length || !neighbors.length || !air || air.length !== nodes.length){
      return [];
    }
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    const surfaceBand = (cfg && cfg.defaults && typeof cfg.defaults.SURFACE_BAND === "number")
      ? cfg.defaults.SURFACE_BAND
      : 0;
    const surfaceR = this.planetParams.RMAX * (1 - surfaceBand);
    const rMin = Math.max(0.7, this.planetParams.RMAX * 0.12);
    const rMax = Math.max(rMin + 0.8, Math.min(this.planetParams.RMAX - 0.5, surfaceR - 0.25));
    /** @type {Array<{x:number,y:number,nx:number,ny:number}>} */
    const candidates = [];
    for (let i = 0; i < nodes.length; i++){
      if (!air[i]) continue;
      const n = nodes[i];
      const r = Math.hypot(n.x, n.y);
      if (r < rMin || r > rMax) continue;
      const neigh = neighbors[i] || [];
      let rockNeighbor = null;
      let rockDist2 = Infinity;
      for (const e of neigh){
        if (air[e.to]) continue;
        const nb = nodes[e.to];
        if (!nb) continue;
        const dx = n.x - nb.x;
        const dy = n.y - nb.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < rockDist2){
          rockDist2 = d2;
          rockNeighbor = nb;
        }
      }
      if (!rockNeighbor) continue;
      const dxr = n.x - rockNeighbor.x;
      const dyr = n.y - rockNeighbor.y;
      const len = Math.hypot(dxr, dyr) || 1;
      const nx = dxr / len;
      const ny = dyr / len;
      let lo = { x: rockNeighbor.x, y: rockNeighbor.y };
      let hi = { x: n.x, y: n.y };
      for (let it = 0; it < 8; it++){
        const mx = (lo.x + hi.x) * 0.5;
        const my = (lo.y + hi.y) * 0.5;
        if (this.airValueAtWorld(mx, my) > 0.5){
          hi = { x: mx, y: my };
        } else {
          lo = { x: mx, y: my };
        }
      }
      candidates.push({ x: hi.x, y: hi.y, nx, ny });
    }
    const rand = mulberry32(seed);
    for (let i = candidates.length - 1; i > 0; i--){
      const j = Math.floor(rand() * (i + 1));
      const tmp = candidates[i];
      candidates[i] = candidates[j];
      candidates[j] = tmp;
    }
    /** @type {Array<{x:number,y:number,nx:number,ny:number}>} */
    const picked = [];
    for (const c of candidates){
      let tooClose = false;
      for (const p of picked){
        const dx = c.x - p.x;
        const dy = c.y - p.y;
        if (dx * dx + dy * dy < minDist * minDist){
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      picked.push(c);
      if (picked.length >= count) break;
    }
    return picked;
  }

  /**
   * Align cavern debris to cave walls with normals from radial graph boundaries.
   * @returns {void}
   */
  _alignCavernDebris(){
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    if (!cfg || cfg.id !== "cavern") return;
    if (!this.props || !this.props.length) return;
    const stal = [];
    const boulders = [];
    const spikes = [];
    for (const p of this.props){
      if (p.type === "stalactite") stal.push(p);
      else if (p.type === "boulder") boulders.push(p);
      else if (p.type === "ridge_spike") spikes.push(p);
    }
    const total = stal.length + boulders.length + spikes.length;
    if (!total) return;
    const seed = (this.mapgen.getWorld().seed | 0) + 1327;
    const points = this._sampleCaveAttachmentPoints(total, seed, 0.45);
    let cursor = 0;
    const applyAttach = (p, sinkMul) => {
      const pt = points[cursor++];
      if (!pt){
        p.dead = true;
        return;
      }
      p.nx = pt.nx;
      p.ny = pt.ny;
      p.rot = Math.atan2(pt.ny, pt.nx) - Math.PI * 0.5;
      const sink = sinkMul * (p.scale || 1);
      p.x = pt.x - pt.nx * sink;
      p.y = pt.y - pt.ny * sink;
    };
    for (const p of stal) applyAttach(p, 0.025);
    for (const p of boulders) applyAttach(p, 0.10);
    for (const p of spikes) applyAttach(p, 0.05);
  }

  /**
   * Align mechanized factories/gates/tethers to standable surfaces.
   * @returns {void}
   */
  _alignMechanizedStructures(){
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    if (!cfg || cfg.id !== "mechanized") return;
    const factorySpawnCooldown = getFactorySpawnCooldownRange(cfg);
    if (!this.props || !this.props.length) return;
    const coreR = this.getCoreRadius ? this.getCoreRadius() : 0;
    const factories = [];
    const gates = [];
    const tethers = [];
    for (const p of this.props){
      if (p.type === "factory") factories.push(p);
      else if (p.type === "gate") gates.push(p);
      else if (p.type === "tether") tethers.push(p);
    }
    if (!factories.length && !gates.length && !tethers.length) return;
    if (!this._standablePoints || !this._standablePoints.length){
      this._standablePoints = this._buildStandablePoints();
    }
    const seed = (this.mapgen.getWorld().seed | 0) + 1907;
    const rand = mulberry32(seed + 31);
    const coreMode = coreR > 0.5 && tethers.length > 0;
    if (coreMode){
      for (const p of gates){
        p.dead = true;
      }
      const innerR = Math.max(0.6, coreR + 0.55);
      const outerCap = Math.max(innerR + 0.8, this.planetParams.RMAX - 0.5);
      const standable = this._filterReachableStandable(this.getStandablePoints())
        .filter((p) => p[3] >= innerR + 0.9);
      // Prefer true landable sites so each tether's factory has a practical landing zone above it.
      const landableStandable = standable.filter((p) => this.isLandableAtWorld(p[0], p[1], 0.32, 0.2, 0.18));
      const factorySites = landableStandable.length ? landableStandable : standable;
      const usedAngles = [];
      const usedSites = new Set();
      const wrapDiff = (a, b) => {
        let d = Math.abs(a - b);
        if (d > Math.PI) d = Math.abs(d - Math.PI * 2);
        return d;
      };
      /**
       * @param {number} x
       * @returns {number}
       */
      const normalizeAngle = (x) => {
        let a = x % (Math.PI * 2);
        if (a < 0) a += Math.PI * 2;
        return a;
      };
      /**
       * @param {number} ang
       * @returns {{nx:number,ny:number,outerR:number}|null}
       */
      const evaluateTetherAngle = (ang) => {
        const nx = Math.cos(ang);
        const ny = Math.sin(ang);
        let firstAir = -1;
        let rockAfterAir = -1;
        for (let r = innerR + 0.25; r <= outerCap; r += 0.16){
          const isAir = this.airValueAtWorld(nx * r, ny * r) > 0.5;
          if (isAir){
            if (firstAir < 0) firstAir = r;
          } else if (firstAir >= 0){
            rockAfterAir = r;
            break;
          }
        }
        // If no rock after air, tether is effectively open to air and should be moved.
        if (firstAir < 0 || rockAfterAir < 0) return null;
        return {
          nx,
          ny,
          outerR: Math.max(innerR + 0.9, rockAfterAir - 0.08),
        };
      };
      /**
       * @param {number} ang
       * @param {number} minR
       * @returns {number}
       */
      const pickFactoryStandableIndex = (ang, minR) => {
        if (!factorySites.length) return -1;
        /** @type {number} */
        let best = -1;
        let bestScore = Infinity;
        // Keep factories near the tether angle; if no match, retry a new tether angle instead.
        const thresholds = [0.42, 0.68];
        for (const th of thresholds){
          best = -1;
          bestScore = Infinity;
          for (let i = 0; i < factorySites.length; i++){
            if (usedSites.has(i)) continue;
            const sp = factorySites[i];
            if (sp[3] < minR) continue;
            const dAng = wrapDiff(sp[2], ang);
            if (dAng > th) continue;
            const score = dAng * 3.0 + Math.max(0, sp[3] - minR) * 0.03;
            if (score < bestScore){
              bestScore = score;
              best = i;
            }
          }
          if (best >= 0) return best;
        }
        return -1;
      };
      /**
       * @param {any} factory
       * @param {number} idx
       * @param {number} iFactory
       * @returns {void}
       */
      const placeFactoryAtStandable = (factory, idx, iFactory) => {
        if (!factory || idx < 0 || idx >= factorySites.length){
          if (factory){
            factory.dead = true;
          }
          return;
        }
        usedSites.add(idx);
        const pt = factorySites[idx];
        factory.x = pt[0];
        factory.y = pt[1];
        const info = this.surfaceInfoAtWorld(factory.x, factory.y, 0.18);
        if (info){
          factory.nx = info.nx;
          factory.ny = info.ny;
          factory.x -= info.nx * (0.05 * (factory.scale || 1));
          factory.y -= info.ny * (0.05 * (factory.scale || 1));
          factory.rot = Math.atan2(info.ny, info.nx) - Math.PI * 0.5;
        }
        factory.propId = iFactory;
        factory.hp = (typeof factory.hp === "number") ? Math.max(1, factory.hp) : 5;
        factory.spawnCd = factorySpawnCooldown.min + rand() * (factorySpawnCooldown.max - factorySpawnCooldown.min);
        factory.spawnT = rand() * factory.spawnCd;
      };

      for (let i = 0; i < tethers.length; i++){
        const tether = tethers[i];
        let picked = null;
        const minAngSep = 0.4;
        const base = normalizeAngle((i / Math.max(1, tethers.length)) * Math.PI * 2 + (rand() - 0.5) * 0.35);
        for (let attempt = 0; attempt < 56; attempt++){
          const jitter = (rand() * 2 - 1) * (0.18 + 0.015 * attempt);
          const ang = normalizeAngle(base + jitter);
          if (usedAngles.some((a) => wrapDiff(a, ang) < minAngSep)) continue;
          const evalRes = evaluateTetherAngle(ang);
          if (!evalRes) continue;
          const fIdx = pickFactoryStandableIndex(ang, evalRes.outerR + 0.45);
          if (fIdx < 0) continue;
          picked = { ang, fIdx, ...evalRes };
          break;
        }
        if (!picked){
          for (let attempt = 0; attempt < 140; attempt++){
            const ang = normalizeAngle(rand() * Math.PI * 2);
            if (usedAngles.some((a) => wrapDiff(a, ang) < minAngSep)) continue;
            const evalRes = evaluateTetherAngle(ang);
            if (!evalRes) continue;
            const fIdx = pickFactoryStandableIndex(ang, evalRes.outerR + 0.25);
            if (fIdx < 0) continue;
            picked = { ang, fIdx, ...evalRes };
            break;
          }
        }
        if (!picked){
          tether.dead = true;
          tether.hp = 0;
          continue;
        }
        usedAngles.push(picked.ang);
        const centerR = 0.5 * (innerR + picked.outerR);
        tether.x = picked.nx * centerR;
        tether.y = picked.ny * centerR;
        tether.nx = picked.nx;
        tether.ny = picked.ny;
        tether.rot = Math.atan2(picked.ny, picked.nx) - Math.PI * 0.5;
        tether.halfLength = Math.max(0.5, 0.5 * (picked.outerR - innerR));
        tether.halfWidth = Math.max(0.08, Math.min(0.18, (typeof tether.halfWidth === "number") ? tether.halfWidth : (0.11 + rand() * 0.04)));

        const factory = (i < factories.length) ? factories[i] : null;
        if (factory){
          placeFactoryAtStandable(factory, picked.fIdx, i);
          tether.protectedBy = (typeof factory.propId === "number") ? factory.propId : i;
        } else {
          tether.protectedBy = -1;
        }
      }

      // Place any leftover factories on valid standable points.
      for (let i = tethers.length; i < factories.length; i++){
        const factory = factories[i];
        if (!factory) continue;
        let idx = -1;
        for (let j = 0; j < factorySites.length; j++){
          if (usedSites.has(j)) continue;
          idx = j;
          break;
        }
        placeFactoryAtStandable(factory, idx, i);
      }
      return;
    }

    const factoryPts = this.sampleStandablePoints(factories.length, seed, "uniform", 1.5, false);
    for (let i = 0; i < factories.length; i++){
      const p = factories[i];
      const pt = factoryPts[i];
      if (!pt){
        p.dead = true;
        continue;
      }
      p.x = pt[0];
      p.y = pt[1];
      const info = this.surfaceInfoAtWorld(p.x, p.y, 0.18);
      if (info){
        p.nx = info.nx;
        p.ny = info.ny;
        p.x -= info.nx * (0.05 * (p.scale || 1));
        p.y -= info.ny * (0.05 * (p.scale || 1));
        p.rot = Math.atan2(info.ny, info.nx) - Math.PI * 0.5;
      }
      p.propId = i;
      p.hp = (typeof p.hp === "number") ? Math.max(1, p.hp) : 5;
      p.spawnCd = factorySpawnCooldown.min + rand() * (factorySpawnCooldown.max - factorySpawnCooldown.min);
      p.spawnT = rand() * p.spawnCd;
    }

    const gatePts = this.sampleStandablePoints(gates.length, seed + 97, "clusters", 2.0, false);
    for (let i = 0; i < gates.length; i++){
      const p = gates[i];
      const pt = gatePts[i];
      if (!pt){
        p.dead = true;
        continue;
      }
      p.x = pt[0];
      p.y = pt[1];
      const info = this.surfaceInfoAtWorld(p.x, p.y, 0.18);
      if (info){
        p.nx = info.nx;
        p.ny = info.ny;
        p.x -= info.nx * (0.03 * (p.scale || 1));
        p.y -= info.ny * (0.03 * (p.scale || 1));
        p.rot = Math.atan2(info.ny, info.nx) - Math.PI * 0.5;
      }
    }
  }

  /**
   * @param {number} count
   * @param {number} seed
   * @param {"uniform"|"random"|"clusters"} [placement]
   * @returns {Array<[number,number]>}
   */
  sampleUndergroundPoints(count, seed, placement = "random"){
    if (count <= 0) return [];
    const rand = mulberry32(seed);
    /** @type {Array<[number,number]>} */
    const points = [];
    const rMax = this.planetParams.RMAX * 0.9;
    const attempts = Math.max(200, count * 140);
    const angleAt = (i) => {
      if (placement === "uniform"){
        const base = (i / count) * Math.PI * 2;
        return base + (rand() - 0.5) * 0.35;
      }
      return rand() * Math.PI * 2;
    };
    for (let i = 0; i < attempts && points.length < count; i++){
      const ang = angleAt(points.length);
      const r = Math.sqrt(rand()) * rMax;
      const x = Math.cos(ang) * r;
      const y = Math.sin(ang) * r;
      if (this.airValueAtWorld(x, y) > 0.5) continue;
      const eps = 0.18;
      if (this.airValueAtWorld(x + eps, y) > 0.5) continue;
      if (this.airValueAtWorld(x - eps, y) > 0.5) continue;
      if (this.airValueAtWorld(x, y + eps) > 0.5) continue;
      if (this.airValueAtWorld(x, y - eps) > 0.5) continue;
      points.push([x, y]);
    }
    return points;
  }

  /**
   * Keep ice shards attached to the nearest surface.
   * @returns {void}
   */
  _snapIceShardsToSurface(){
    if (!this.props || !this.props.length) return;
    for (const p of this.props){
      if (p.type !== "ice_shard") continue;
      if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
      let info = this.surfaceInfoAtWorld(p.x, p.y, 0.18);
      if (!info){
        p.dead = true;
        p.hp = 0;
        continue;
      }
      // If in air, move toward rock; if buried, nudge outward, then embed slightly.
      if (this.airValueAtWorld(p.x, p.y) > 0.5){
        for (let i = 0; i < 6; i++){
          p.x -= info.nx * 0.06;
          p.y -= info.ny * 0.06;
          if (this.airValueAtWorld(p.x, p.y) <= 0.5) break;
        }
      } else {
        const res = this.nudgeOutOfTerrain(p.x, p.y, 0.8, 0.08, 0.18);
        if (res.ok){
          p.x = res.x;
          p.y = res.y;
        }
      }
      info = this.surfaceInfoAtWorld(p.x, p.y, 0.18);
      if (!info){
        p.dead = true;
        p.hp = 0;
        continue;
      }
      // Embed slightly so they appear attached.
      p.x -= info.nx * 0.03;
      p.y -= info.ny * 0.03;
    }
  }

  /**
   * Spread ice shards uniformly around the planet (ice worlds only).
   * @returns {void}
   */
  _spreadIceShardsUniform(){
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    if (!cfg || cfg.id !== "ice") return;
    if (!this.props || !this.props.length) return;
    const shards = [];
    for (const p of this.props){
      if (p.type === "ice_shard") shards.push(p);
    }
    if (!shards.length) return;
    const seed = (this.mapgen.getWorld().seed | 0) + 331;
    const points = this.sampleSurfacePoints(shards.length, seed, "uniform");
    if (!points.length) return;
    const rand = mulberry32(seed + 17);
    for (let i = 0; i < shards.length; i++){
      const p = shards[i];
      const pt = points[i % points.length];
      p.x = pt[0];
      p.y = pt[1];
      // Orient roughly orthogonal to the surface normal (tangent), with random flip/jitter.
      const info = this.surfaceInfoAtWorld(p.x, p.y, 0.18);
      if (info){
        const tx = -info.ny;
        const ty = info.nx;
        const base = Math.atan2(ty, tx);
        p.rot = base + (rand() - 0.5) * 0.6;
      } else {
        p.rot = rand() * Math.PI * 2;
      }
    }
  }

  /**
   * @param {number} count
   * @param {number} seed
   * @param {"uniform"|"random"|"clusters"} [placement]
   * @returns {Array<[number,number]>}
   */
  sampleSurfacePoints(count, seed, placement = "random"){
    if (count <= 0) return [];
    const rand = mulberry32(seed);
    /** @type {Array<[number,number]>} */
    const points = [];
    const rMin = 1.0;
    const shell = (this.planetParams.NO_CAVES && this.mapgen && this.mapgen.grid)
      ? Math.max(this.mapgen.grid.cell * 1.5, 0.35)
      : 0;
    const rMax = Math.max(rMin + 0.5, this.planetParams.RMAX - shell - 0.15);
    const attempts = Math.max(200, count * 120);
    const angleAt = (i) => {
      if (placement === "uniform"){
        const base = (i / count) * Math.PI * 2;
        return base + (rand() - 0.5) * 0.35;
      }
      return rand() * Math.PI * 2;
    };
    for (let i = 0; i < attempts && points.length < count; i++){
      const ang = angleAt(points.length);
      const surf = this._findSurfaceAtAngle(ang, rMin, rMax);
      if (!surf) continue;
      points.push([surf.x, surf.y]);
    }
    return points;
  }

  _angleDistance(a, b){
    let d = Math.abs(a - b);
    if (d > Math.PI) d = Math.abs(d - Math.PI * 2);
    return d;
  }

  /**
   * @param {number} a
   * @returns {number}
   */
  _normalizeAngle(a){
    const tau = Math.PI * 2;
    let out = a % tau;
    if (out < 0) out += tau;
    return out;
  }

  /**
   * Check whether a turret pad has rock support under both shoulders.
   * @param {number} x
   * @param {number} y
   * @param {number} [scale]
   * @param {number} [eps]
   * @returns {{ok:boolean, plusOk:boolean, minusOk:boolean, info:{nx:number,ny:number,slope:number}|null, tx:number, ty:number}}
   */
  _turretPadSupportAtWorld(x, y, scale = 0.55, eps = 0.18){
    const info = this.surfaceInfoAtWorld(x, y, eps);
    if (!info){
      return { ok: false, plusOk: false, minusOk: false, info: null, tx: 0, ty: 0 };
    }
    const tx = -info.ny;
    const ty = info.nx;
    const shoulder = 0.55 * scale + 0.08;
    const airClearance = 0.12;
    const rockDepth = 0.09;
    const shoulderSupported = (dir) => {
      const sx = x + tx * shoulder * dir;
      const sy = y + ty * shoulder * dir;
      return (this.airValueAtWorld(sx + info.nx * airClearance, sy + info.ny * airClearance) > 0.5)
        && (this.airValueAtWorld(sx - info.nx * rockDepth, sy - info.ny * rockDepth) <= 0.5);
    };
    const plusOk = shoulderSupported(1);
    const minusOk = shoulderSupported(-1);
    const ok = this.isLandableAtWorld(x, y, 0.45, 0.16, eps) && plusOk && minusOk;
    return { ok, plusOk, minusOk, info, tx, ty };
  }

  /**
   * Read the two ordered ring vertices on either side of an angle.
   * @param {number} ringIndex
   * @param {number} angle
   * @returns {{ring:Array<{x:number,y:number,air:number}>,minusIdx:number,plusIdx:number,minusVertex:{x:number,y:number,air:number},plusVertex:{x:number,y:number,air:number}}|null}
   */
  _ringVerticesAroundAngle(ringIndex, angle){
    const rings = this.radial && this.radial.rings ? this.radial.rings : null;
    if (!rings || ringIndex < 0 || ringIndex >= rings.length) return null;
    const ring = rings[ringIndex];
    if (!ring || !ring.length) return null;
    const target = this._normalizeAngle(angle);
    let plusIdx = 0;
    let plusDiff = Infinity;
    for (let i = 0; i < ring.length; i++){
      const ang = this._normalizeAngle(Math.atan2(ring[i].y, ring[i].x));
      let diff = ang - target;
      if (diff < 0) diff += Math.PI * 2;
      if (diff < plusDiff){
        plusDiff = diff;
        plusIdx = i;
      }
    }
    const minusIdx = (plusIdx - 1 + ring.length) % ring.length;
    return {
      ring,
      minusIdx,
      plusIdx,
      minusVertex: ring[minusIdx],
      plusVertex: ring[plusIdx],
    };
  }

  /**
   * Flood-fill radial graph air connectivity from outer-ring air vertices.
   * @returns {Uint8Array}
   */
  _buildOuterAirReachableMask(){
    const graph = this.radialGraph;
    const rings = this.radial && this.radial.rings ? this.radial.rings : null;
    if (!graph || !graph.nodes || !graph.neighbors || !graph.nodeOfRef || !rings || !rings.length){
      return new Uint8Array(0);
    }
    const reachable = new Uint8Array(graph.nodes.length);
    const queue = [];
    const outerRing = rings[rings.length - 1] || [];
    for (const vertex of outerRing){
      if (!vertex || vertex.air <= 0.5) continue;
      const idx = graph.nodeOfRef.get(vertex);
      if (idx === undefined || reachable[idx]) continue;
      reachable[idx] = 1;
      queue.push(idx);
    }
    for (let q = 0; q < queue.length; q++){
      const idx = queue[q];
      for (const edge of (graph.neighbors[idx] || [])){
        const next = edge.to;
        if (reachable[next]) continue;
        const node = graph.nodes[next];
        if (!node) continue;
        const ring = rings[node.r];
        const vertex = ring && ring[node.i];
        if (!vertex || vertex.air <= 0.5) continue;
        reachable[next] = 1;
        queue.push(next);
      }
    }
    return reachable;
  }

  /**
   * @param {Array<any>} items
   * @param {number} seed
   * @returns {Array<any>}
   */
  _shuffleDeterministic(items, seed){
    const out = items.slice();
    const rand = mulberry32(seed | 0);
    for (let i = out.length - 1; i > 0; i--){
      const j = Math.floor(rand() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /**
   * @param {number} ring
   * @param {number} seed
   * @returns {number}
   */
  _ringShuffleSeed(ring, seed){
    return ((seed | 0) ^ (((ring + 1) * 2654435761) | 0)) | 0;
  }

  /**
   * @returns {Array<{x:number,y:number,angle:number,r:number,ring:number,depth:number,anchorKind:"outer_rock"|"under_air",sourceKind:"rock"|"air",sourceRing:number,sourceIndex:number}>}
   */
  _buildBarrenPadCandidates(){
    const graph = this.radialGraph;
    const rings = this.radial && this.radial.rings ? this.radial.rings : null;
    if (!graph || !graph.nodes || !graph.neighbors || !graph.nodeOfRef || !rings || !rings.length){
      return [];
    }
    const outerRingIndex = rings.length - 1;
    const reachableAir = this._buildOuterAirReachableMask();
    /** @type {Array<{x:number,y:number,angle:number,r:number,ring:number,depth:number,anchorKind:"outer_rock"|"under_air",sourceKind:"rock"|"air",sourceRing:number,sourceIndex:number}>} */
    const out = [];
    const seen = new Set();
    const outerRing = rings[outerRingIndex] || [];
    for (let i = 0; i < outerRing.length; i++){
      const vertex = outerRing[i];
      if (!vertex || vertex.air > 0.5) continue;
      const key = `outer:${outerRingIndex}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        x: vertex.x,
        y: vertex.y,
        angle: Math.atan2(vertex.y, vertex.x),
        r: Math.hypot(vertex.x, vertex.y),
        ring: outerRingIndex,
        depth: 0,
        anchorKind: "outer_rock",
        sourceKind: "rock",
        sourceRing: outerRingIndex,
        sourceIndex: i,
      });
    }
    for (let ringIndex = outerRingIndex - 1; ringIndex >= 0; ringIndex--){
      const upperRing = rings[ringIndex + 1] || [];
      for (let airIndex = 0; airIndex < upperRing.length; airIndex++){
        const airVertex = upperRing[airIndex];
        if (!airVertex || airVertex.air <= 0.5) continue;
        const airNode = graph.nodeOfRef.get(airVertex);
        if (airNode === undefined || !reachableAir[airNode]) continue;
        const around = this._ringVerticesAroundAngle(ringIndex, Math.atan2(airVertex.y, airVertex.x));
        if (!around) continue;
        if (around.minusVertex.air > 0.5 || around.plusVertex.air > 0.5) continue;
        const minusNode = graph.nodeOfRef.get(around.minusVertex);
        const plusNode = graph.nodeOfRef.get(around.plusVertex);
        if (minusNode === undefined || plusNode === undefined) continue;
        let minusLinked = false;
        let plusLinked = false;
        for (const edge of (graph.neighbors[airNode] || [])){
          if (edge.to === minusNode) minusLinked = true;
          if (edge.to === plusNode) plusLinked = true;
          if (minusLinked && plusLinked) break;
        }
        if (!minusLinked || !plusLinked) continue;
        const angle = Math.atan2(airVertex.y, airVertex.x);
        const supportRadius = (Math.hypot(around.minusVertex.x, around.minusVertex.y) + Math.hypot(around.plusVertex.x, around.plusVertex.y)) * 0.5;
        const airRadius = Math.hypot(airVertex.x, airVertex.y);
        // Inner pads sit midway between the reachable air vertex and the
        // supporting rock pair below instead of directly on the lower ring.
        const radius = (supportRadius + airRadius) * 0.5;
        const key = `inner:${ringIndex}:${airIndex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          angle,
          r: radius,
          ring: ringIndex,
          depth: outerRingIndex - ringIndex,
          anchorKind: "under_air",
          sourceKind: "air",
          sourceRing: ringIndex + 1,
          sourceIndex: airIndex,
        });
      }
    }
    return out;
  }

  /**
   * @param {{x:number,y:number}} candidate
   * @param {Array<{x:number,y:number}>} picked
   * @param {number} minDist
   * @returns {boolean}
   */
  _barrenCandidateHasSpacing(candidate, picked, minDist){
    for (const cur of picked){
      const dx = candidate.x - cur.x;
      const dy = candidate.y - cur.y;
      if (dx * dx + dy * dy < minDist * minDist){
        return false;
      }
    }
    return true;
  }

  /**
   * @param {Array<any>} items
   * @param {number} seed
   * @param {boolean} innerFirst
   * @param {(item:any)=>number} getRing
   * @returns {Array<any>}
   */
  _orderBarrenByRing(items, seed, innerFirst, getRing){
    const groups = new Map();
    for (const item of items){
      const ring = getRing(item);
      const group = groups.get(ring);
      if (group) group.push(item);
      else groups.set(ring, [item]);
    }
    const ringOrder = Array.from(groups.keys()).sort((a, b) => innerFirst ? (a - b) : (b - a));
    /** @type {Array<any>} */
    const out = [];
    for (const ring of ringOrder){
      out.push(...this._shuffleDeterministic(groups.get(ring) || [], this._ringShuffleSeed(ring, seed)));
    }
    return out;
  }

  /**
   * @param {Array<any>} ordered
   * @param {number} count
   * @param {number} minDist
   * @returns {Array<any>}
   */
  _pickBarrenCandidates(ordered, count, minDist){
    if (count <= 0 || !ordered.length) return [];
    /** @type {Array<any>} */
    const picked = [];
    for (const spacing of [Math.max(0, minDist), Math.max(0.18, minDist * 0.55)]){
      for (const candidate of ordered){
        if (picked.length >= count) break;
        if (picked.includes(candidate)) continue;
        if (!this._barrenCandidateHasSpacing(candidate, picked, spacing)) continue;
        picked.push(candidate);
      }
      if (picked.length >= count) break;
    }
    return picked;
  }

  /**
   * @param {number} seed
   * @returns {{inner:Array<any>,outer:Array<any>,outerRockByIndex:Map<number, any>,underAirByNode:Map<number, Array<any>>,outerRingIndex:number}|null}
   */
  _buildBarrenPadLookup(seed){
    const graph = this.radialGraph;
    const rings = this.radial && this.radial.rings ? this.radial.rings : null;
    if (!graph || !graph.nodeOfRef || !rings || !rings.length){
      return null;
    }
    const candidates = this._buildBarrenPadCandidates();
    const outerRingIndex = rings.length - 1;
    const outerRockByIndex = new Map();
    const underAirByNode = new Map();
    for (const candidate of candidates){
      if (candidate.anchorKind === "outer_rock" && candidate.sourceRing === outerRingIndex){
        outerRockByIndex.set(candidate.sourceIndex, candidate);
        continue;
      }
      if (candidate.anchorKind !== "under_air") continue;
      const ring = rings[candidate.sourceRing];
      const vertex = ring && ring[candidate.sourceIndex];
      const nodeIdx = vertex ? graph.nodeOfRef.get(vertex) : undefined;
      if (nodeIdx === undefined) continue;
      const bucket = underAirByNode.get(nodeIdx);
      if (bucket) bucket.push(candidate);
      else underAirByNode.set(nodeIdx, [candidate]);
    }
    return {
      inner: this._orderBarrenByRing(candidates, seed, true, (item) => item.ring),
      outer: this._orderBarrenByRing(candidates, seed + 17, false, (item) => item.ring),
      outerRockByIndex,
      underAirByNode,
      outerRingIndex,
    };
  }

  /**
   * @param {{x:number,y:number,angle:number,r:number,ring:number,depth:number,anchorKind:"outer_rock"|"under_air",sourceKind:"rock"|"air",sourceRing:number,sourceIndex:number}} candidate
   * @param {{underAirByNode:Map<number, Array<any>>,outerRockByIndex:Map<number, any>,outerRingIndex:number}|null} lookup
   * @param {Set<any>} used
   * @param {Array<any>} chosenTurrets
   * @param {number} minDist
   * @returns {any|null}
   */
  _findBarrenOverwatchCandidate(candidate, lookup, used, chosenTurrets, minDist){
    const graph = this.radialGraph;
    const rings = this.radial && this.radial.rings ? this.radial.rings : null;
    if (!lookup || !graph || !graph.nodes || !graph.neighbors || !graph.nodeOfRef || !rings || !rings.length){
      return null;
    }
    const { underAirByNode, outerRockByIndex, outerRingIndex } = lookup;
    const canUseCandidate = (cand) => (
      cand
      && cand !== candidate
      && !used.has(cand)
      && this._barrenCandidateHasSpacing(cand, chosenTurrets, minDist)
    );
    const searchOuterRing = (baseIndex) => {
      const outerRing = rings[outerRingIndex] || [];
      const n = outerRing.length;
      if (!n || !Number.isFinite(baseIndex)) return null;
      for (let off = 1; off < n; off++){
        const left = ((baseIndex - off) % n + n) % n;
        const right = (baseIndex + off) % n;
        for (const idx of [left, right]){
          const cand = outerRockByIndex.get(idx);
          if (!canUseCandidate(cand)) continue;
          return cand;
        }
      }
      return null;
    };
    const isAirNode = (nodeIdx) => {
      const node = graph.nodes[nodeIdx];
      if (!node) return false;
      const ring = rings[node.r];
      const vertex = ring && ring[node.i];
      return !!(vertex && vertex.air > 0.5);
    };
    if (candidate.anchorKind === "outer_rock"){
      return searchOuterRing(candidate.sourceIndex);
    }
    if (candidate.sourceKind !== "air"){
      return null;
    }
    const sourceRing = rings[candidate.sourceRing] || null;
    const sourceVertex = sourceRing && sourceRing[candidate.sourceIndex];
    const startNode = sourceVertex ? graph.nodeOfRef.get(sourceVertex) : undefined;
    if (startNode === undefined) return null;
    const visited = new Set([startNode]);
    let frontier = [startNode];
    for (let nextRing = graph.nodes[startNode].r + 1; nextRing <= outerRingIndex; nextRing++){
      /** @type {number[]} */
      const ringAir = [];
      const queue = [];
      for (const nodeIdx of frontier){
        for (const edge of (graph.neighbors[nodeIdx] || [])){
          const nextIdx = edge.to;
          if (visited.has(nextIdx)) continue;
          const nextNode = graph.nodes[nextIdx];
          if (!nextNode || nextNode.r !== nextRing || !isAirNode(nextIdx)) continue;
          visited.add(nextIdx);
          queue.push(nextIdx);
        }
      }
      for (let qi = 0; qi < queue.length; qi++){
        const nodeIdx = queue[qi];
        ringAir.push(nodeIdx);
        for (const edge of (graph.neighbors[nodeIdx] || [])){
          const nextIdx = edge.to;
          if (visited.has(nextIdx)) continue;
          const nextNode = graph.nodes[nextIdx];
          if (!nextNode || nextNode.r !== nextRing || !isAirNode(nextIdx)) continue;
          visited.add(nextIdx);
          queue.push(nextIdx);
        }
      }
      if (!ringAir.length) return null;
      if (nextRing < outerRingIndex){
        for (const nodeIdx of ringAir){
          for (const cand of (underAirByNode.get(nodeIdx) || [])){
            if (cand.ring <= candidate.ring) continue;
            if (!canUseCandidate(cand)) continue;
            return cand;
          }
        }
        frontier = ringAir;
        continue;
      }
      for (const nodeIdx of ringAir){
        const node = graph.nodes[nodeIdx];
        if (!node) continue;
        const overwatch = searchOuterRing(node.i);
        if (overwatch) return overwatch;
      }
      return null;
    }
    return null;
  }

  /**
   * @param {{x:number,y:number,angle:number,r:number,ring:number,depth:number,anchorKind:"outer_rock"|"under_air",sourceKind:"rock"|"air",sourceRing:number,sourceIndex:number}} candidate
   * @param {any} prop
   * @param {"miner"|"turret"|null} reservedFor
   * @returns {void}
   */
  _applyBarrenPadCandidateToProp(candidate, prop, reservedFor){
    prop.dead = false;
    prop.x = candidate.x;
    prop.y = candidate.y;
    prop.padRing = candidate.ring;
    prop.padDepth = candidate.depth;
    prop.padAnchorKind = candidate.anchorKind;
    prop.padSourceKind = candidate.sourceKind;
    prop.padSourceRing = candidate.sourceRing;
    prop.padSourceIndex = candidate.sourceIndex;
    prop.padReservedFor = reservedFor;
    const up = this._upDirAt(prop.x, prop.y);
    if (up){
      prop.padNx = up.ux;
      prop.padNy = up.uy;
      return;
    }
    const info = this.surfaceInfoAtWorld(prop.x, prop.y, 0.18);
    if (info){
      prop.padNx = info.nx;
      prop.padNy = info.ny;
    }
  }

  /**
   * Re-layout barren pads so miner pads sit deep and turret pads occupy
   * graph-found overwatch ridges above those miners.
   * @param {number} minerCount
   * @param {number} turretCount
   * @param {number} seed
   * @param {number} [minDist]
   * @returns {void}
   */
  layoutBarrenPadsForRoles(minerCount, turretCount, seed, minDist = GAME.MINER_MIN_SEP){
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    if (!(cfg && cfg.flags && cfg.flags.barrenPerimeter)) return;
    const pads = (this.props || []).filter((p) => p.type === "turret_pad");
    if (!pads.length) return;
    const lookup = this._buildBarrenPadLookup(seed);
    if (!lookup) return;
    /** @type {Array<any>} */
    const chosenMiners = [];
    /** @type {Array<any>} */
    const chosenTurrets = [];
    /** @type {Set<any>} */
    const used = new Set();
    const pairedTarget = Math.min(Math.max(0, minerCount | 0), Math.max(0, turretCount | 0));
    if (pairedTarget > 0){
      for (const candidate of lookup.inner){
        if (chosenMiners.length >= pairedTarget) break;
        if (used.has(candidate)) continue;
        if (!this._barrenCandidateHasSpacing(candidate, chosenMiners, minDist)) continue;
        const overwatch = this._findBarrenOverwatchCandidate(candidate, lookup, used, chosenTurrets, minDist);
        if (!overwatch) continue;
        used.add(candidate);
        used.add(overwatch);
        chosenMiners.push(candidate);
        chosenTurrets.push(overwatch);
      }
    }
    for (const candidate of lookup.inner){
      if (chosenMiners.length >= minerCount) break;
      if (used.has(candidate)) continue;
      if (!this._barrenCandidateHasSpacing(candidate, chosenMiners, minDist)) continue;
      used.add(candidate);
      chosenMiners.push(candidate);
    }
    if (chosenTurrets.length < turretCount){
      for (const miner of chosenMiners){
        if (chosenTurrets.length >= turretCount) break;
        const overwatch = this._findBarrenOverwatchCandidate(miner, lookup, used, chosenTurrets, minDist);
        if (!overwatch) continue;
        used.add(overwatch);
        chosenTurrets.push(overwatch);
      }
    }
    if (chosenTurrets.length < turretCount){
      for (const candidate of lookup.outer){
        if (chosenTurrets.length >= turretCount) break;
        if (used.has(candidate)) continue;
        if (!this._barrenCandidateHasSpacing(candidate, chosenTurrets, minDist)) continue;
        used.add(candidate);
        chosenTurrets.push(candidate);
      }
    }
    /** @type {Array<{candidate:any,reservedFor:"miner"|"turret"|null}>} */
    const placements = [];
    for (const cand of chosenMiners){
      placements.push({ candidate: cand, reservedFor: "miner" });
    }
    for (const cand of chosenTurrets){
      placements.push({ candidate: cand, reservedFor: null });
    }
    for (let i = 0; i < pads.length; i++){
      const prop = pads[i];
      const placement = placements[i] || null;
      if (!placement){
        prop.dead = true;
        prop.hp = 0;
        delete prop.padRing;
        delete prop.padDepth;
        delete prop.padAnchorKind;
        delete prop.padSourceKind;
        delete prop.padSourceRing;
        delete prop.padSourceIndex;
        prop.padReservedFor = null;
        continue;
      }
      this._applyBarrenPadCandidateToProp(placement.candidate, prop, placement.reservedFor);
    }
  }

  /**
   * @param {number} seed
   * @param {boolean} innerFirst
   * @returns {Array<any>}
   */
  _orderedBarrenPadProps(seed, innerFirst = true){
    const pads = (this.props || []).filter((prop) => (
      prop.type === "turret_pad"
      && !prop.dead
      && typeof prop.padRing === "number"
    ));
    return this._orderBarrenByRing(pads, seed, innerFirst, (pad) => pad.padRing);
  }

  /**
   * Reserve deeper barren pads for miners before turrets consume the outer pads.
   * @param {number} count
   * @param {number} seed
   * @param {number} [minDist]
   * @returns {Array<[number,number]>}
   */
  reserveBarrenPadsForMiners(count, seed, minDist = GAME.MINER_MIN_SEP){
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    if (!(cfg && cfg.flags && cfg.flags.barrenPerimeter) || count <= 0) return [];
    const ordered = this._orderedBarrenPadProps(seed, true);
    const existing = ordered.filter((pad) => pad.padReservedFor === "miner");
    if (existing.length >= count){
      return existing.slice(0, count).map((pad) => [pad.x, pad.y]);
    }
    /** @type {Array<any>} */
    const chosen = existing.slice();
    for (const pad of ordered){
      if (chosen.length >= count) break;
      if (pad.padReservedFor) continue;
      if (!this._isFarFromReservations(pad.x, pad.y, minDist, this._spawnReservations)) continue;
      let ok = true;
      for (const cur of chosen){
        const dx = pad.x - cur.x;
        const dy = pad.y - cur.y;
        if (dx * dx + dy * dy < minDist * minDist){
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      pad.padReservedFor = "miner";
      chosen.push(pad);
    }
    if (chosen.length > existing.length){
      this.reserveSpawnPoints(chosen.slice(existing.length).map((pad) => ({ x: pad.x, y: pad.y })), minDist);
    }
    return chosen.map((pad) => [pad.x, pad.y]);
  }

  /**
   * Align turret pads to landable surface points.
   * @returns {void}
   */
  _alignTurretPadsToSurface(){
    if (!this.props || !this.props.length) return;
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    const forceHorizontalPads = !!(cfg && cfg.flags && cfg.flags.barrenPerimeter);
    const pads = [];
    for (const p of this.props){
      if (p.type === "turret_pad") pads.push(p);
    }
    if (!pads.length) return;
    if (!this._standablePoints || !this._standablePoints.length){
      this._standablePoints = this._buildStandablePoints();
    }
    const seed = (this.mapgen.getWorld().seed | 0) + 913;
    const minDist = GAME.MINER_MIN_SEP;
    /** @type {Array<any>} */
    let placed = [];
    if (forceHorizontalPads){
      const lookup = this._buildBarrenPadLookup(seed);
      placed = lookup ? this._pickBarrenCandidates(lookup.inner, pads.length, minDist) : [];
    } else {
      const standable = this._standablePoints || [];
      const flatPool = standable.filter((pt) => {
        const info = this.surfaceInfoAtWorld(pt[0], pt[1], 0.18);
        if (!info) return false;
        const up = this._upDirAt(pt[0], pt[1]);
        if (!up) return false;
        if (info.slope > 0.08) return false;
        if (info.nx * up.ux + info.ny * up.uy < 0.98) return false;
        const tx = -info.ny;
        const ty = info.nx;
        const shoulder = 0.38;
        for (const dir of [-1, 1]){
          const sx = pt[0] + tx * shoulder * dir;
          const sy = pt[1] + ty * shoulder * dir;
          if (this.airValueAtWorld(sx + info.nx * 0.12, sy + info.ny * 0.12) <= 0.5) return false;
          if (this.airValueAtWorld(sx - info.nx * 0.09, sy - info.ny * 0.09) > 0.5) return false;
        }
        return true;
      });
      const pool = (flatPool.length >= pads.length) ? flatPool : standable;
      if (pool !== standable){
        const saved = this._standablePoints;
        this._standablePoints = pool;
        placed = this.sampleStandablePoints(pads.length, seed, "uniform", minDist, false)
          .map((pt) => ({ x: pt[0], y: pt[1] }));
        this._standablePoints = saved;
      } else {
        placed = this.sampleStandablePoints(pads.length, seed, "uniform", minDist, false)
          .map((pt) => ({ x: pt[0], y: pt[1] }));
      }
    }
    for (let i = 0; i < pads.length; i++){
      const p = pads[i];
      const pt = placed[i] || null;
      p.padReservedFor = null;
      if (!pt){
        p.dead = true;
        p.hp = 0;
        delete p.padRing;
        delete p.padDepth;
        delete p.padAnchorKind;
        delete p.padSourceKind;
        delete p.padSourceRing;
        delete p.padSourceIndex;
        continue;
      }
      p.dead = false;
      p.x = pt.x;
      p.y = pt.y;
      if (forceHorizontalPads){
        p.padRing = pt.ring;
        p.padDepth = pt.depth;
        p.padAnchorKind = pt.anchorKind;
        p.padSourceKind = pt.sourceKind;
        p.padSourceRing = pt.sourceRing;
        p.padSourceIndex = pt.sourceIndex;
        const up = this._upDirAt(p.x, p.y);
        if (up){
          p.padNx = up.ux;
          p.padNy = up.uy;
          continue;
        }
      } else {
        delete p.padRing;
        delete p.padDepth;
        delete p.padAnchorKind;
        delete p.padSourceKind;
        delete p.padSourceRing;
        delete p.padSourceIndex;
      }
      const info = this.surfaceInfoAtWorld(p.x, p.y, 0.18);
      if (info){
        p.padNx = info.nx;
        p.padNy = info.ny;
      } else {
        const up = this._upDirAt(p.x, p.y);
        if (up){
          p.padNx = up.ux;
          p.padNy = up.uy;
        }
      }
    }
  }

  /**
   * @param {number} ang
   * @param {number} rMin
   * @param {number} rMax
   * @param {number} [steps]
   * @returns {{x:number,y:number,r:number}|null}
   */
  _findSurfaceAtAngle(ang, rMin, rMax, steps = 64){
    const cx = Math.cos(ang);
    const cy = Math.sin(ang);
    let prevR = rMin;
    let prevAir = this.airValueAtWorld(cx * prevR, cy * prevR) > 0.5;
    for (let i = 1; i <= steps; i++){
      const r = rMin + (i / steps) * (rMax - rMin);
      const curAir = this.airValueAtWorld(cx * r, cy * r) > 0.5;
      if (curAir !== prevAir){
        let lo = prevR;
        let hi = r;
        const loAir = prevAir;
        for (let it = 0; it < 8; it++){
          const mid = (lo + hi) * 0.5;
          const midAir = this.airValueAtWorld(cx * mid, cy * mid) > 0.5;
          if (midAir === loAir){
            lo = mid;
          } else {
            hi = mid;
          }
        }
        const baseR = (lo + hi) * 0.5;
        return { x: cx * baseR, y: cy * baseR, r: baseR };
      }
      prevR = r;
      prevAir = curAir;
    }
    return null;
  }

  /**
   * @param {number} count
   * @param {number} seed
   * @param {number} rMin
   * @param {number} rMax
   * @param {"uniform"|"random"|"clusters"} [placement]
   * @returns {Array<[number,number]>}
   */
  sampleAirPoints(count, seed, rMin, rMax, placement = "random"){
    if (rMin >= rMax || count <= 0) return [];
    const rand = mulberry32(seed);
    const restrictReachability = !!this._spawnReachableMask;
    /** @type {Array<[number,number]>} */
    const points = [];
    const attempts = Math.max(200, count * 80);
    if (placement === "uniform"){
      const jitter = 0.35;
      for (let i = 0; i < count; i++){
        const base = (i / count) * Math.PI * 2;
        const ang = base + (rand() - 0.5) * jitter;
        const rr = rMin * rMin + rand() * (rMax * rMax - rMin * rMin);
        const r = Math.sqrt(Math.max(0, rr));
        const x = r * Math.cos(ang);
        const y = r * Math.sin(ang);
        if (this.airValueAtWorld(x, y) <= 0.5) continue;
        if (restrictReachability && !this._isSpawnReachableAt(x, y)) continue;
        points.push([x, y]);
      }
      return points;
    }
    for (let i = 0; i < attempts && points.length < count; i++){
      const ang = rand() * Math.PI * 2;
      const r = Math.sqrt(rMin * rMin + rand() * (rMax * rMax - rMin * rMin));
      const x = r * Math.cos(ang);
      const y = r * Math.sin(ang);
      if (this.airValueAtWorld(x, y) <= 0.5) continue;
      if (restrictReachability && !this._isSpawnReachableAt(x, y)) continue;
      points.push([x, y]);
    }
    return points;
  }

  /**
   * @param {number} count
   * @param {number} seed
   * @param {number} maxSlope
   * @param {number} clearance
   * @param {"uniform"|"random"|"clusters"} [placement]
   * @returns {Array<[number,number]>}
   */
  sampleLandablePoints(count, seed, maxSlope = 0.28, clearance = 0.2, placement = "random"){
    if (count <= 0) return [];
    const rand = mulberry32(seed);
    /** @type {Array<[number,number]>} */
    const points = [];
    const rMin = 1.0;
    const rMax = this.planetParams.RMAX + 1.2;
    const attempts = Math.max(200, count * 120);
    const angleAt = (i) => {
      if (placement === "uniform"){
        const base = (i / count) * Math.PI * 2;
        return base + (rand() - 0.5) * 0.35;
      }
      return rand() * Math.PI * 2;
    };
    for (let i = 0; i < attempts && points.length < count; i++){
      const ang = angleAt(points.length);
      const surf = this._findSurfaceAtAngle(ang, rMin, rMax);
      if (!surf) continue;
      const nx = surf.x / (Math.hypot(surf.x, surf.y) || 1);
      const ny = surf.y / (Math.hypot(surf.x, surf.y) || 1);
      const x = surf.x + nx * 0.02;
      const y = surf.y + ny * 0.02;
      if (!this.isLandableAtWorld(x, y, maxSlope, clearance, 0.18)) continue;
      points.push([x, y]);
    }
    return points;
  }

  /**
   * Precompute a dense set of standable surface points based on mesh vertices.
   * @returns {Array<[number,number,number,number]>} [x,y,angle,r]
   */
  _buildStandablePoints(){
    const maxSlope = 0.28;
    const clearance = 0.2;
    const eps = 0.18;
    const sideClearance = 0.25;
    const graph = this.radialGraph;
    /** @type {Array<[number,number,number,number]>} */
    const points = [];
    if (!graph || !graph.nodes || !graph.nodes.length) return points;
    const passable = buildPassableMask(this.radial, graph, 0.5);
    for (let i = 0; i < graph.nodes.length; i++){
      if (!passable[i]) continue;
      const n = graph.nodes[i];
      let inner = -1;
      let innerR = -1;
      for (const edge of graph.neighbors[i]){
        const nb = graph.nodes[edge.to];
        if (!nb || nb.r >= n.r) continue;
        if (passable[edge.to]) continue;
        if (nb.r > innerR){
          innerR = nb.r;
          inner = edge.to;
        }
      }
      if (inner < 0) continue;
      const nb = graph.nodes[inner];
      const aOuter = this.radial.airValueAtWorld(n.x, n.y);
      const aInner = this.radial.airValueAtWorld(nb.x, nb.y);
      const denom = (aOuter - aInner);
      const t = denom !== 0 ? Math.max(0, Math.min(1, (0.5 - aInner) / denom)) : 0.5;
      const sx = nb.x + (n.x - nb.x) * t;
      const sy = nb.y + (n.y - nb.y) * t;
      const info = this.surfaceInfoAtWorld(sx, sy, eps);
      if (!info) continue;
      const px = sx + info.nx * 0.02;
      const py = sy + info.ny * 0.02;
      if (!this.isStandableAtWorld(px, py, maxSlope, clearance, eps, sideClearance)) continue;
      const ang = Math.atan2(py, px);
      const r = Math.hypot(px, py);
      points.push([px, py, ang, r]);
    }
    return points;
  }

  /**
   * Cached standable points. Do not mutate.
   * @returns {Array<[number,number,number,number]>} [x,y,angle,r]
   */
  getStandablePoints(){
    return this._standablePoints || [];
  }

  /**
   * Debug helper: count standable points that are not blocked by reservations.
   * @param {number} minDist
   * @returns {{standable:number, available:number, reservations:number}}
   */
  debugAvailableStandableCount(minDist = 0){
    const points = this.getStandablePoints();
    const reservations = this._spawnReservations || [];
    let available = 0;
    for (const p of points){
      if (this._isFarFromReservations(p[0], p[1], minDist, reservations)){
        available++;
      }
    }
    return { standable: points.length, available, reservations: reservations.length };
  }

  /**
   * Debug helper: count prop types.
   * @returns {Record<string, number>}
   */
  debugPropCounts(){
    /** @type {Record<string, number>} */
    const counts = {};
    if (!this.props || !this.props.length) return counts;
    for (const p of this.props){
      const key = p.type || "unknown";
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }

  /**
   * Reserve prop locations so spawns avoid them.
   * @returns {void}
   */
  _reserveSpawnPointsFromProps(){
    if (!this.props || !this.props.length) return;
    const base = Math.max(0.4, GAME.MINER_MIN_SEP * 0.6);
    for (const p of this.props){
      if (p.dead) continue;
      // Turret pads are intended spawn targets on barren perimeter maps.
      if (p.type === "turret_pad") continue;
      this._spawnReservations.push({ x: p.x, y: p.y, r: base });
    }
  }

  /**
   * @returns {boolean}
   */
  _restrictToReachableSpawns(){
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    return !!(cfg && cfg.flags && cfg.flags.disableTerrainDestruction);
  }

  /**
   * Rebuild mask of air nodes reachable from near-surface air using dijkstra.
   * Used to avoid spawning required units in sealed pockets on non-destructible worlds.
   * @returns {void}
   */
  _rebuildSpawnReachabilityMask(){
    if (!this._restrictToReachableSpawns()){
      this._spawnReachableMask = null;
      return;
    }
    const graph = this.radialGraph;
    const passable = this.airNodesBitmap;
    if (!graph || !graph.nodes || !graph.nodes.length || !passable || passable.length !== graph.nodes.length){
      this._spawnReachableMask = null;
      return;
    }
    const nearSurfaceR = Math.max(0, (this.planetParams.RMAX || this.planetRadius || 0) - 0.9);
    /** @type {number[]} */
    const sources = [];
    for (let i = 0; i < graph.nodes.length; i++){
      if (!passable[i]) continue;
      const n = graph.nodes[i];
      const r = Math.hypot(n.x, n.y);
      if (r >= nearSurfaceR){
        sources.push(i);
      }
    }
    if (!sources.length){
      for (let i = 0; i < passable.length; i++){
        if (passable[i]){
          sources.push(i);
          break;
        }
      }
    }
    if (!sources.length){
      this._spawnReachableMask = null;
      return;
    }
    const dist = dijkstraMap(graph, sources, passable);
    const mask = new Uint8Array(passable.length);
    for (let i = 0; i < passable.length; i++){
      if (!passable[i]) continue;
      if (Number.isFinite(dist[i])) mask[i] = 1;
    }
    this._spawnReachableMask = mask;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  _isSpawnReachableAt(x, y){
    if (!this._spawnReachableMask) return true;
    const iNode = this.nearestRadialNodeInAir(x, y);
    if (iNode < 0 || iNode >= this._spawnReachableMask.length) return false;
    return !!this._spawnReachableMask[iNode];
  }

  /**
   * @param {Array<[number,number,number,number]>} points
   * @returns {Array<[number,number,number,number]>}
   */
  _filterReachableStandable(points){
    if (!this._spawnReachableMask) return points;
    const out = [];
    for (const p of points){
      if (!this._isSpawnReachableAt(p[0], p[1])) continue;
      out.push(p);
    }
    return out;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} minDist
   * @param {Array<{x:number,y:number,r:number}>} reservations
   * @returns {boolean}
   */
  _isFarFromReservations(x, y, minDist, reservations){
    if (minDist <= 0 || !reservations.length) return true;
    for (const rsv of reservations){
      const dx = x - rsv.x;
      const dy = y - rsv.y;
      const rr = Math.max(minDist, rsv.r || 0);
      if (dx * dx + dy * dy < rr * rr) return false;
    }
    return true;
  }

  /**
   * @param {Array<{x:number,y:number}>} points
   * @param {number} minDist
   * @returns {void}
   */
  reserveSpawnPoints(points, minDist = 0){
    if (!points || !points.length) return;
    const r = Math.max(0, minDist);
    for (const p of points){
      this._spawnReservations.push({ x: p.x, y: p.y, r });
    }
  }

  /**
   * Sample from cached standable points.
   * @param {number} count
   * @param {number} seed
   * @param {"uniform"|"random"|"clusters"} [placement]
   * @param {number} [minDist]
   * @param {boolean} [reserve]
   * @param {number} [minR]
   * @returns {Array<[number,number]>}
   */
  sampleStandablePoints(count, seed, placement = "random", minDist = 0, reserve = false, minR = 0){
    if (count <= 0) return [];
    const basePoints = this._filterReachableStandable(this.getStandablePoints());
    const points = (minR > 0) ? basePoints.filter((p) => p[3] >= minR) : basePoints;
    if (!points.length) return [];
    const rand = mulberry32(seed);
    const rMax = (this.planetParams.RMAX || CFG.RMAX) || 1;
    const bias = 0.35;
    const take = Math.min(count, points.length);
    /** @type {Array<[number,number]>} */
    const out = [];
    /** @type {Array<number>} */
    const indices = points.map((_, i) => i);
    const used = new Set();
    /** @type {Array<{x:number,y:number,r:number}>} */
    const reservations = this._spawnReservations || [];
    if (placement === "uniform"){
      indices.sort((a, b) => points[a][2] - points[b][2]);
      const offset = rand();
      const step = (Math.PI * 2) / take;
      const window = step * 0.65;
      for (let i = 0; i < take; i++){
        const target = (i + offset) * step;
        let picked = -1;
        let pickedScore = Infinity;
        for (const idx of indices){
          const p = points[idx];
          const ang = p[2];
          let d = Math.abs(ang - target);
          d = Math.min(d, Math.abs(d - Math.PI * 2));
          if (d > window) continue;
          if (used.has(idx)) continue;
          if (!this._isFarFromReservations(p[0], p[1], minDist, reservations)) continue;
          let ok = true;
          for (const q of out){
            const dx = p[0] - q[0];
            const dy = p[1] - q[1];
            if (dx * dx + dy * dy < minDist * minDist){
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const r = p[3];
          const biasScore = (r / rMax) * bias;
          const score = d / window + biasScore;
          if (score < pickedScore){
            pickedScore = score;
            picked = idx;
          }
        }
        if (picked >= 0){
          const p = points[picked];
          used.add(picked);
          out.push([p[0], p[1]]);
          if (out.length >= take) break;
        }
      }
      if (out.length < take){
        for (const idx of indices){
          if (out.length >= take) break;
          if (used.has(idx)) continue;
          const p = points[idx];
          if (!this._isFarFromReservations(p[0], p[1], minDist, reservations)) continue;
          let ok = true;
          for (const q of out){
            const dx = p[0] - q[0];
            const dy = p[1] - q[1];
            if (dx * dx + dy * dy < minDist * minDist){
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          used.add(idx);
          out.push([p[0], p[1]]);
        }
      }
    } else {
      if (placement === "clusters"){
        const clusterCount = Math.max(1, Math.floor(Math.sqrt(take)));
        /** @type {number[]} */
        const centers = [];
        for (let i = 0; i < indices.length && centers.length < clusterCount; i++){
          const idx = indices[Math.floor(rand() * indices.length)];
          centers.push(points[idx][2]);
        }
        let clusterIndex = 0;
        const window = (Math.PI * 2) / Math.max(6, clusterCount * 2);
        for (let i = 0; i < take; i++){
          const target = centers[clusterIndex % centers.length];
          clusterIndex++;
          let picked = -1;
          let pickedScore = Infinity;
          for (const idx of indices){
            if (used.has(idx)) continue;
            const p = points[idx];
            let d = Math.abs(p[2] - target);
            d = Math.min(d, Math.abs(d - Math.PI * 2));
            if (d > window) continue;
            if (!this._isFarFromReservations(p[0], p[1], minDist, reservations)) continue;
            let ok = true;
            for (const q of out){
              const dx = p[0] - q[0];
              const dy = p[1] - q[1];
              if (dx * dx + dy * dy < minDist * minDist){
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            const r = p[3];
            const biasScore = (r / rMax) * bias;
            const score = d / window + biasScore;
            if (score < pickedScore){
              pickedScore = score;
              picked = idx;
            }
          }
          if (picked >= 0){
            const p = points[picked];
            used.add(picked);
            out.push([p[0], p[1]]);
            if (out.length >= take) break;
          }
        }
        if (out.length < take){
          for (const idx of indices){
            if (out.length >= take) break;
            if (used.has(idx)) continue;
            const p = points[idx];
            if (!this._isFarFromReservations(p[0], p[1], minDist, reservations)) continue;
            let ok = true;
            for (const q of out){
              const dx = p[0] - q[0];
              const dy = p[1] - q[1];
              if (dx * dx + dy * dy < minDist * minDist){
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            used.add(idx);
            out.push([p[0], p[1]]);
          }
        }
      } else {
        for (let i = indices.length - 1; i > 0; i--){
          const j = Math.floor(rand() * (i + 1));
          const tmp = indices[i];
          indices[i] = indices[j];
          indices[j] = tmp;
        }
        for (const idx of indices){
          const p = points[idx];
          if (used.has(idx)) continue;
          if (!this._isFarFromReservations(p[0], p[1], minDist, reservations)) continue;
          let ok = true;
          for (const q of out){
            const dx = p[0] - q[0];
            const dy = p[1] - q[1];
            if (dx * dx + dy * dy < minDist * minDist){
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          // Slight interior bias for random selection.
          const r = p[3];
          const w = 1 + bias * Math.max(0, 1 - r / rMax);
          const maxW = 1 + bias;
          if (rand() > (w / maxW)) continue;
          used.add(idx);
          out.push([p[0], p[1]]);
          if (out.length >= take) break;
        }
        if (out.length < take){
          for (const idx of indices){
            if (out.length >= take) break;
            if (used.has(idx)) continue;
            const p = points[idx];
            if (!this._isFarFromReservations(p[0], p[1], minDist, reservations)) continue;
            let ok = true;
            for (const q of out){
              const dx = p[0] - q[0];
              const dy = p[1] - q[1];
              if (dx * dx + dy * dy < minDist * minDist){
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            used.add(idx);
            out.push([p[0], p[1]]);
          }
        }
      }
    }
    if (reserve && out.length){
      const reservePoints = out.map((p) => ({ x: p[0], y: p[1] }));
      this.reserveSpawnPoints(reservePoints, minDist);
    }
    return out;
  }

  /**
   * Turret placement helper (special case for barren perimeter pads).
   * @param {number} count
   * @param {number} seed
   * @param {"uniform"|"random"|"clusters"} [placement]
   * @returns {Array<[number,number]>}
   */
  sampleTurretPoints(count, seed, placement = "random", minDist = 0, reserve = false){
    const cfg = this.getPlanetConfig ? this.getPlanetConfig() : null;
    if (cfg && cfg.flags && cfg.flags.barrenPerimeter){
      const pads = this._orderedBarrenPadProps(seed, false).filter((pad) => !pad.padReservedFor);
      if (pads.length){
        /** @type {Array<any>} */
        const chosen = [];
        for (const pad of pads){
          if (chosen.length >= count) break;
          if (!this._isFarFromReservations(pad.x, pad.y, minDist, this._spawnReservations)) continue;
          let ok = true;
          for (const cur of chosen){
            const dx = pad.x - cur.x;
            const dy = pad.y - cur.y;
            if (dx * dx + dy * dy < minDist * minDist){
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          chosen.push(pad);
        }
        if (reserve && chosen.length){
          for (const pad of chosen){
            if (!pad.padReservedFor) pad.padReservedFor = "turret";
          }
          this.reserveSpawnPoints(chosen.map((pad) => ({ x: pad.x, y: pad.y })), minDist);
        }
        return chosen.map((pad) => [pad.x, pad.y]);
      }
    }
    const pool = this.sampleStandablePoints(Math.max(count * 3, count), seed, placement, minDist, false);
    const coreR = this.getCoreRadius ? this.getCoreRadius() : 0;
    const moltenOuter = this.planetParams && typeof this.planetParams.MOLTEN_RING_OUTER === "number"
      ? this.planetParams.MOLTEN_RING_OUTER
      : 0;
    const minR = Math.max(0, Math.max(coreR, moltenOuter) + 0.6);
    const out = (minR > 0)
      ? pool.filter((p) => (Math.hypot(p[0], p[1]) >= minR)).slice(0, count)
      : pool.slice(0, count);
    if (reserve && out.length){
      const reservePoints = out.map((pt) => ({ x: pt[0], y: pt[1] }));
      this.reserveSpawnPoints(reservePoints, minDist);
    }
    return out;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  airValueAtWorld(x, y){
    return this.radial.airValueAtWorld(x, y);
  }

  /**
   * Collision-focused air sampling (filtered against outer-shell sliver spikes).
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  airValueAtWorldForCollision(x, y){
    if (this.radial && typeof this.radial.airValueAtWorldForCollision === "function"){
      return this.radial.airValueAtWorldForCollision(x, y);
    }
    return this.radial.airValueAtWorld(x, y);
  }

  /**
   * @returns {Array<[number,number,boolean,number]>|null}
   */
  debugPoints(){
    if (this._radialDebugDirty || !this._radialDebugPoints){
      this._buildRadialDebugPoints();
    }
    return this._radialDebugPoints || null;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {0|1} [val]
   * @returns {Float32Array|undefined}
   */
  applyAirEdit(x, y, radius, val = 1){
    this.mapgen.setAirDisk(x, y, radius, val);
    let newAir = this.radial.updateAirFlags(true);
    this.airNodesBitmap = buildAirNodesBitmap(this.radialGraph, this.radial);
    this._rebuildSpawnReachabilityMask();
    this._radialDebugDirty = true;
    return newAir;
  }

  /**
   * Capture mutable runtime state needed for save/resume.
   * @returns {{
   *  air:Uint8Array,
   *  props:Array<any>,
   *  fog:{
   *    alpha:Float32Array,
   *    visible:Uint8Array,
   *    seen:Uint8Array,
   *    hold:Uint8Array,
   *    cursor:number
   *  }
   * }}
   */
  exportRuntimeState(){
    const world = this.mapgen.getWorld();
    const srcAir = (world && world.air instanceof Uint8Array) ? world.air : new Uint8Array(0);
    const air = new Uint8Array(srcAir);
    const props = Array.isArray(this.props) ? this.props.map((p) => clonePlainData(p)) : [];
    const fog = this.radial.exportFogState();
    return { air, props, fog };
  }

  /**
   * Restore mutable runtime state from save data.
   * @param {{
   *  air:Uint8Array,
   *  props?:Array<any>,
   *  fog?:{
   *    alpha:Float32Array,
   *    visible:Uint8Array,
   *    seen:Uint8Array,
   *    hold:Uint8Array,
   *    cursor:number
   *  }
   * }|null|undefined} state
   * @returns {Float32Array|undefined}
   */
  importRuntimeState(state){
    if (!state || !(state.air instanceof Uint8Array)){
      return undefined;
    }
    const world = this.mapgen.getWorld();
    if (!world || !(world.air instanceof Uint8Array) || world.air.length !== state.air.length){
      return undefined;
    }
    world.air.set(state.air);
    const newAir = this.radial.updateAirFlags(true);
    this.airNodesBitmap = buildAirNodesBitmap(this.radialGraph, this.radial);
    this._rebuildSpawnReachabilityMask();
    this._radialDebugDirty = true;

    if (Array.isArray(state.props) && Array.isArray(this.props)){
      const count = Math.min(this.props.length, state.props.length);
      for (let i = 0; i < count; i++){
        const src = state.props[i];
        const dst = this.props[i];
        if (!src || typeof src !== "object" || !dst || typeof dst !== "object") continue;
        for (const key of Object.keys(dst)){
          if (!Object.prototype.hasOwnProperty.call(src, key)){
            delete dst[key];
          }
        }
        for (const key of Object.keys(src)){
          dst[key] = clonePlainData(src[key]);
        }
      }
    }
    if (state.fog){
      this.radial.importFogState(state.fog);
    }
    return newAir;
  }

  /**
   * @param {number} shipX
   * @param {number} shipY
   * @returns {Float32Array|undefined}
   */
  updateFog(shipX, shipY){
    this.radial.updateFog(shipX, shipY);
    return this.radial.fogAlpha();
  }

  /**
   * Update fog for current render mode and return radial fog alpha when applicable.
   * @param {number} shipX
   * @param {number} shipY
   * @returns {Float32Array|undefined}
   */
  updateFogForRender(shipX, shipY){
    return this.updateFog(shipX, shipY);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  fogVisibleAt(x, y){
    return this.radial.fogVisibleAt(x, y);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  fogSeenAt(x, y){
    return this.radial.fogSeenAt(x, y);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  fogAlphaAtWorld(x, y){
    return this.radial.fogAlphaAtWorld(x, y);
  }

  /**
   * Find closest point on world
   * Note: Does not work very far from the surface
   * @param {number} x
   * @param {number} y
   * @returns {{x:number, y:number}|null}
   */
  posClosest(x, y) {
    const eps = 0.1;

    const dist = this.radial.airValueAtWorld(x, y) - 0.5;
    const gdx = this.radial.airValueAtWorld(x + eps, y) - this.radial.airValueAtWorld(x - eps, y);
    const gdy = this.radial.airValueAtWorld(x, y + eps) - this.radial.airValueAtWorld(x, y - eps);
    const g = Math.hypot(gdx, gdy);
    if (g < 1e-4) {
      return null;
    }

    const step = -dist / g;
    return {x: x + gdx * step, y: y + gdy * step};
  }

  /**
   * Build a guide path to the closest point on the terrain to the query position
   * @param {number} x
   * @param {number} y
   * @param {number} maxDistance
   * @returns {{path:Array<{x:number, y:number}>, indexClosest: number}|null}
   */
  surfaceGuidePathTo(x, y, maxDistance) {
    if (!this.radial || typeof this.radial.surfaceGuidePathTo !== "function"){
      return null;
    }
    return this.radial.surfaceGuidePathTo(x, y, maxDistance);
  }

  /**
   * Surface normal and slope info at world point.
   * Returns slope as (1 - dot(normal, gravityDir)), so 0 is perfectly flat.
   * @param {number} x
   * @param {number} y
   * @param {number} [eps]
   * @returns {{nx:number, ny:number, slope:number}|null}
   */
  surfaceInfoAtWorld(x, y, eps = 0.18){
    const up = this._upDirAt(x, y);
    if (!up) return null;
    const n = this.radialNormalAtWorld(x, y, eps);
    if (!n) return null;
    let dot = n.nx * up.ux + n.ny * up.uy;
    if (dot < 0){
      n.nx = -n.nx;
      n.ny = -n.ny;
      dot = -dot;
    }
    return { nx: n.nx, ny: n.ny, slope: 1 - dot };
  }

  /**
   * Walkability test using surface slope (lower is flatter).
   * @param {number} x
   * @param {number} y
   * @param {number} maxSlope
   * @param {number} [eps]
   * @returns {boolean}
   */
  isWalkableAtWorld(x, y, maxSlope = 0.35, eps = 0.18){
    const info = this.surfaceInfoAtWorld(x, y, eps);
    if (!info) return false;
    return info.slope <= maxSlope;
  }

  /**
   * Landable check using slope and a small clearance test.
   * @param {number} x
   * @param {number} y
   * @param {number} maxSlope
   * @param {number} clearance
   * @param {number} [eps]
   * @returns {boolean}
   */
  isLandableAtWorld(x, y, maxSlope = 0.4, clearance = 0.2, eps = 0.18){
    const info = this.surfaceInfoAtWorld(x, y, eps);
    if (!info) return false;
    if (info.slope > maxSlope) return false;
    const ax = x + info.nx * clearance;
    const ay = y + info.ny * clearance;
    const bx = x - info.nx * clearance;
    const by = y - info.ny * clearance;
    return (this.airValueAtWorld(ax, ay) > 0.5) && (this.airValueAtWorld(bx, by) <= 0.5);
  }

  /**
   * Standable check: air above and on both sides, rock behind.
   * @param {number} x
   * @param {number} y
   * @param {number} maxSlope
   * @param {number} clearance
   * @param {number} [eps]
   * @param {number} [sideClearance]
   * @returns {boolean}
   */
  isStandableAtWorld(x, y, maxSlope = 0.4, clearance = 0.2, eps = 0.18, sideClearance = 0.25){
    const info = this.surfaceInfoAtWorld(x, y, eps);
    if (!info) return false;
    if (info.slope > maxSlope) return false;
    const nx = info.nx;
    const ny = info.ny;
    const tx = -ny;
    const ty = nx;
    const ax = x + nx * clearance;
    const ay = y + ny * clearance;
    const bx = x - nx * clearance;
    const by = y - ny * clearance;
    const lx = x + tx * sideClearance;
    const ly = y + ty * sideClearance;
    const rx = x - tx * sideClearance;
    const ry = y - ty * sideClearance;
    return (this.airValueAtWorld(ax, ay) > 0.5)
      && (this.airValueAtWorld(lx, ly) > 0.5)
      && (this.airValueAtWorld(rx, ry) > 0.5)
      && (this.airValueAtWorld(bx, by) <= 0.5);
  }

  /**
   * Nudge a point out of rock along the local surface normal.
   * Returns ok=false if it stays buried after maxPush.
   * @param {number} x
   * @param {number} y
   * @param {number} [maxPush]
   * @param {number} [step]
   * @param {number} [eps]
   * @returns {{x:number,y:number,ok:boolean}}
   */
  nudgeOutOfTerrain(x, y, maxPush = 0.6, step = 0.06, eps = 0.18){
    if (this.airValueAtWorld(x, y) > 0.5){
      return { x, y, ok: true };
    }
    const steps = Math.max(1, Math.ceil(maxPush / step));
    let cx = x;
    let cy = y;
    for (let i = 0; i < steps; i++){
      const n = this.radialNormalAtWorld(cx, cy, eps);
      if (!n) break;
      cx += n.nx * step;
      cy += n.ny * step;
      if (this.airValueAtWorld(cx, cy) > 0.5){
        return { x: cx, y: cy, ok: true };
      }
    }
    return { x: cx, y: cy, ok: false };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{ux:number,uy:number}|null}
   */
  _upDirAt(x, y){
    const r = Math.hypot(x, y);
    if (r < 1e-6) return null;
    return { ux: x / r, uy: y / r };
  }

  /**
   * Normal from radial occupancy gradient.
   * @param {number} x
   * @param {number} y
   * @param {number} eps
   * @returns {{nx:number,ny:number}|null}
   */
  radialNormalAtWorld(x, y, eps){
    const gdx = this.radial.airValueAtWorld(x + eps, y) - this.radial.airValueAtWorld(x - eps, y);
    const gdy = this.radial.airValueAtWorld(x, y + eps) - this.radial.airValueAtWorld(x, y - eps);
    const len = Math.hypot(gdx, gdy);
    if (len < 1e-6) return null;
    return { nx: gdx / len, ny: gdy / len };
  }

  /**
   * Update fog for current mode and push fog resources to renderer.
   * @param {{updateFog:(fog:Float32Array)=>void}} renderer
   * @param {number} shipX
   * @param {number} shipY
   * @returns {void}
   */
  syncRenderFog(renderer, shipX, shipY){
    const fog = this.updateFogForRender(shipX, shipY);
    if (fog) renderer.updateFog(fog);
  }

  /**
   * Evaluate gravitational acceleration at a position relative to the planet
   * @param {number} x
   * @param {number} y
   * @returns {{x:number,y:number}}
   */
  gravityAt(x, y) {
    const rPlanet = this.planetRadius;
    const r2 = Math.max(x*x + y*y, rPlanet*rPlanet);
    const r = Math.sqrt(r2);
    const a = -this.gravitationalConstant / (r2 * r);
    return {x: x * a, y: y * a};
  }

  /**
   * Position and velocity on an orbit (specified by closest approach, orbit eccentricity, current angle, and direction)
   * @param {number} perigee
   * @param {number} eccentricity
   * @param {number} angle
   * @param {boolean} directionCCW
   * @returns {{x: number, y: number, vx: number, vy: number}}
   */
  orbitStateFromElements(perigee, eccentricity, angle, directionCCW) {
    angle *= directionCCW ? -1 : 1;
    const p = perigee * (1 + eccentricity);
    const r = p / (1 + eccentricity * Math.cos(angle));
    const x = r * Math.cos(angle);
    const y = r * Math.sin(angle);
    const vScale = Math.sqrt(this.gravitationalConstant / p) * (directionCCW ? -1 : 1);
    const vx = vScale * Math.sin(angle);
    const vy = -vScale * (eccentricity + Math.cos(angle));
    return {x: x, y: y, vx: vx, vy: vy};
  }

  /**
   * Evaluate perigee and apogee height for orbit defined by a position and velocity
   * @param {number} x
   * @param {number} y
   * @param {number} vx
   * @param {number} vy
   * @returns {{rPerigee: number, rApogee: number}}
   */
  perigeeAndApogee(x, y, vx, vy) {
    const rCrossV = x * vy - y * vx;
    const r = Math.hypot(x, y);
    const gravMu = this.gravitationalConstant;
    const eccentricityX = (vy * rCrossV) / gravMu - x / r;
    const eccentricityY = (-vx * rCrossV) / gravMu - y / r;
    const eccentricity = Math.hypot(eccentricityX, eccentricityY);

    // Not handling parabolic or hyperbolic trajectories correctly yet
    if (eccentricity >= 1.0) {
      return {rPerigee: 0, rApogee: Infinity};
    }

    const vSqr = vx * vx + vy * vy;
    const specificEnergy = vSqr / 2 - gravMu / r;
    const a = -gravMu / (2 * specificEnergy);
    const rPerigee = a * (1 - eccentricity);
    const rApogee = a * (1 + eccentricity);

    return {rPerigee: rPerigee, rApogee: rApogee};
  }

  /**
   * @returns {number}
   */
  _radialNodeCount(){
    let nodes = 0;
    for (const ring of this.radial.rings){
      if (ring) nodes += ring.length;
    }
    return nodes;
  }

  /**
   * @returns {void}
   */
  _buildRadialDebugPoints(){
    /** @type {Array<[number, number, boolean, number]>} */
    const pts = [];
    for (const ring of this.radial.rings){
      if (!ring) continue;
      for (const v of ring){
        const air = v.air > 0.5;
        pts.push([v.x, v.y, air, v.air]);
      }
    }
    this._radialDebugPoints = pts;
    this._radialDebugDirty = false;
  }
}

/**
 * 
 * @param {RadialGraph} radialGraph 
 * @param {RingMesh} ringMesh 
 * @returns {Uint8Array}
 */
function buildAirNodesBitmap(radialGraph, ringMesh){
  const passable = new Uint8Array(radialGraph.nodes.length);
  for (let i = 0; i < radialGraph.nodes.length; i++){
    const n = radialGraph.nodes[i];
    passable[i] = ringMesh.rings[n.r][n.i].air > 0.5 ? 1 : 0;
  }
  return passable;
}

/**
 * Clone plain JSON-like data and drop non-serializable values.
 * @param {any} value
 * @returns {any}
 */
function clonePlainData(value){
  if (value === null || typeof value !== "object"){
    return value;
  }
  if (Array.isArray(value)){
    return value.map((v) => clonePlainData(v));
  }
  const out = {};
  for (const key of Object.keys(value)){
    const v = value[key];
    if (typeof v === "function" || v === undefined) continue;
    out[key] = clonePlainData(v);
  }
  return out;
}
