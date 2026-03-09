// @ts-check

import { RingMesh } from "./planet_ring_mesh.js";
import { RadialGraph, buildPassableMask, dijkstraMap, nearestRadialNode } from "./navigation.js";
import { MapGen } from "./mapgen.js";
import { CFG, GAME } from "./config.js";
import { mulberry32 } from "./rng.js";
import { buildPlanetMaterials, createIceShardHazard, createRidgeSpikeHazard, createMushroomHazard, createPlanetFeatures } from "./planet_materials.js";

/**
 * Planet terrain abstraction backed by mapgen grid truth.
 */
export class Planet {
  /**
   * @param {{seed:number, planetConfig: import("./planet_config.js").PlanetConfig, planetParams: import("./planet_config.js").PlanetParams}} deps
   */
  constructor({ seed, planetConfig, planetParams }){
    if (!planetConfig) {
      throw new Error("Planet requires a planetConfig");
    }
    if (!planetParams) {
      throw new Error("Planet requires planetParams");
    }
    this.planetConfig = planetConfig;
    this.planetParams = planetParams;
    this.coreRadius = this._coreRadiusWorld();
    this.mapgen = new MapGen(seed, planetParams);
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
   *  lava:Array<{x:number,y:number,vx:number,vy:number,life:number}>,
   *  mushroom:Array<{x:number,y:number,vx:number,vy:number,life:number}>,
   *  bubbles:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,spin:number}>,
   *  splashes:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,cr:number,cg:number,cb:number}>
   * }}
   */
  getFeatureParticles(){
    return this.features ? this.features.getParticles() : { lava: [], mushroom: [], bubbles: [], splashes: [] };
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
   *  enemies: Array<{x:number,y:number,hp:number,hitT?:number}>,
   *  miners: import("./types.d.js").Miner[],
   *  onShipDamage?: (x:number, y:number)=>void,
   *  onShipHeat?: (amount:number)=>void,
   *  onShipConfuse?: (duration:number)=>void,
   *  onEnemyHit?: (enemy:{x:number,y:number,hp:number,hitT?:number}, x:number, y:number)=>void,
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
    const iNode = nearestRadialNode(this.radialGraph, this.radial, x, y);
    if (this.airNodesBitmap[iNode]) return iNode;
    let iNodeBest = iNode;
    let distSqrBest = Infinity;
    for (const n of this.radialGraph.neighbors[iNode]) {
      const iNodeNeighbor = n.to;
      if (!this.airNodesBitmap[iNodeNeighbor]) continue;
      const nodeNeighbor = this.radialGraph.nodes[iNodeNeighbor];
      const dx = x - nodeNeighbor.x;
      const dy = y - nodeNeighbor.y;
      const distSqr = dx*dx + dy*dy;
      if (distSqr < distSqrBest) {
        distSqrBest = distSqr;
        iNodeBest = iNodeNeighbor;
      }
    }
    return iNodeBest;
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
    const nodeTarget = nearestRadialNode(radialGraph, this.radial, x, y);
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
        factory.spawnCd = 6.5 + rand() * 4.0;
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
      p.spawnCd = 6.5 + rand() * 4.0;
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
    const standable = this._standablePoints || [];
    const flatPool = standable.filter((pt) => {
      const info = this.surfaceInfoAtWorld(pt[0], pt[1], 0.18);
      if (!info) return false;
      const up = this._upDirAt(pt[0], pt[1]);
      if (!up) return false;
      if (info.slope > 0.08) return false;
      if (info.nx * up.ux + info.ny * up.uy < 0.98) return false;
      // Require support under both shoulders to avoid overhang placements.
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
    let placed = [];
    if (pool !== standable){
      const saved = this._standablePoints;
      this._standablePoints = pool;
      placed = this.sampleStandablePoints(pads.length, seed, "uniform", minDist, false);
      this._standablePoints = saved;
    } else {
      placed = this.sampleStandablePoints(pads.length, seed, "uniform", minDist, false);
    }
    for (let i = 0; i < pads.length; i++){
      const p = pads[i];
      const pt = placed[i];
      if (!pt){
        p.dead = true;
        p.hp = 0;
        continue;
      }
      p.x = pt[0];
      p.y = pt[1];
      if (forceHorizontalPads){
        const up = this._upDirAt(p.x, p.y);
        if (up){
          p.padNx = up.ux;
          p.padNy = up.uy;
          continue;
        }
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
   * @returns {Array<[number,number]>}
   */
  sampleStandablePoints(count, seed, placement = "random", minDist = 0, reserve = false){
    if (count <= 0) return [];
    const points = this._filterReachableStandable(this.getStandablePoints());
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
   * Sample standable points with a minimum radius constraint.
   * @param {number} count
   * @param {number} seed
   * @param {"uniform"|"random"|"clusters"} [placement]
   * @param {number} [minDist]
   * @param {boolean} [reserve]
   * @param {number} [minR]
   * @returns {Array<[number,number]>}
   */
  sampleStandablePointsMinRadius(count, seed, placement = "random", minDist = 0, reserve = false, minR = 0){
    if (count <= 0) return [];
    const basePoints = this._filterReachableStandable(this.getStandablePoints());
    if (!basePoints.length) return [];
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
      const pads = [];
      for (const p of (this.props || [])){
        if (p.type === "turret_pad" && !p.dead) pads.push([p.x, p.y]);
      }
      if (pads.length){
        const rand = mulberry32(seed);
        for (let i = pads.length - 1; i > 0; i--){
          const j = Math.floor(rand() * (i + 1));
          const tmp = pads[i];
          pads[i] = pads[j];
          pads[j] = tmp;
        }
        if (minDist <= 0){
          return pads.slice(0, count);
        }
        /** @type {Array<[number,number]>} */
        const out = [];
        for (const p of pads){
          if (!this._isFarFromReservations(p[0], p[1], minDist, this._spawnReservations)) continue;
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
          out.push(p);
          if (out.length >= count) break;
        }
        if (reserve && out.length){
          const reservePoints = out.map((pt) => ({ x: pt[0], y: pt[1] }));
          this.reserveSpawnPoints(reservePoints, minDist);
        }
        return out;
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
   * Closest point variant for guide-path construction near the outer ring.
   * @param {number} x
   * @param {number} y
   * @returns {{x:number, y:number}|null}
   */
  _posClosestForPath(x, y) {
    const eps = 0.1;
    const air = (px, py) => this.radial.airValueAtWorldForPath(px, py);
    const dist = air(x, y) - 0.5;
    const gdx = air(x + eps, y) - air(x - eps, y);
    const gdy = air(x, y + eps) - air(x, y - eps);
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
    /**
     * Snap candidate path point to the gameplay radial surface and reject
     * points that do not straddle a real air/rock boundary.
     * @param {number} sx
     * @param {number} sy
     * @returns {{x:number,y:number}|null}
     */
    const projectToRadialSurface = (sx, sy) => {
      const pos = this.posClosest(sx, sy);
      if (!pos) return null;
      const info = this.surfaceInfoAtWorld(pos.x, pos.y, 0.18);
      if (!info) return null;
      const airProbe = 0.08;
      const ax = pos.x + info.nx * airProbe;
      const ay = pos.y + info.ny * airProbe;
      const bx = pos.x - info.nx * airProbe;
      const by = pos.y - info.ny * airProbe;
      if (this.airValueAtWorld(ax, ay) <= 0.5) return null;
      if (this.airValueAtWorld(bx, by) > 0.5) return null;
      return pos;
    };

    const posRaw = this._posClosestForPath(x, y);
    if (!posRaw) return null;
    const pos = projectToRadialSurface(posRaw.x, posRaw.y);
    if (!pos) return null;
    if (Math.hypot(pos.x, pos.y) > this.planetRadius + 0.02) return null;

    /** @type {Array<{x:number, y:number}>} */
    const path = [{x: pos.x, y: pos.y}];
    let indexClosest = 0;

    /**
     * @param {number} x 
     * @param {number} y 
     * @returns {{nx:number, ny:number}}
     */
    const tryGetNormalAt = (x, y) => {
      const eps = 0.18;
      const gdx = this.radial.airValueAtWorldForPath(x + eps, y) - this.radial.airValueAtWorldForPath(x - eps, y);
      const gdy = this.radial.airValueAtWorldForPath(x, y + eps) - this.radial.airValueAtWorldForPath(x, y - eps);
      const len = Math.hypot(gdx, gdy);
      if (len < 1e-6) return null;
      return { nx: gdx / len, ny: gdy / len };
    };

    /**
     * 
     * @param {number} px 
     * @param {number} py 
     * @param {number} stepSize 
     * @returns {{x:number, y:number}|null}
     */
    const tryGetStep = (px, py, stepSize) => {
      let n = tryGetNormalAt(px, py);
      if (!n) return null;
      const r = Math.hypot(px, py) || 1;
      let dotUp = (px * n.nx + py * n.ny) / r;
      if (dotUp < 0){
        n = { nx: -n.nx, ny: -n.ny };
        dotUp = -dotUp;
      }
      if (dotUp <= 0.5) return null;
      const qx = px + n.ny * -stepSize;
      const qy = py + n.nx *  stepSize;
      const posNextRaw = this._posClosestForPath(qx, qy);
      if (!posNextRaw) return null;
      const posNext = projectToRadialSurface(posNextRaw.x, posNextRaw.y);
      if (!posNext) return null;
      if (Math.hypot(posNext.x, posNext.y) > this.planetRadius + 0.02) return null;
      if (Math.hypot(posNext.x - x, posNext.y - y) > maxDistance) return null;
      return {x: posNext.x, y: posNext.y};
    };

    const stepSize = 0.25;

    const maxPointsPos = 16;
    while (path.length < maxPointsPos) {
      const posExtend = tryGetStep(path[0].x, path[0].y, stepSize);
      if (!posExtend) break;
      const head = path[0];
      if (Math.hypot(posExtend.x - head.x, posExtend.y - head.y) < 1e-4) break;
      path.unshift(posExtend);
      ++indexClosest;
    }

    const maxPointsNeg = path.length + 15;
    while (path.length < maxPointsNeg) {
      const posExtend = tryGetStep(path[path.length-1].x, path[path.length-1].y, -stepSize);
      if (!posExtend) break;
      const tail = path[path.length - 1];
      if (Math.hypot(posExtend.x - tail.x, posExtend.y - tail.y) < 1e-4) break;
      path.push(posExtend);
    }

    return {path: path, indexClosest: indexClosest};
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
