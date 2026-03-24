// @ts-check

import { RingMesh } from "./planet_ring_mesh.js";
import { RadialGraph, buildPassableMask, dijkstraMap, nearestRadialNode } from "./navigation.js";
import { MapGen } from "./mapgen.js";
import { CFG, GAME } from "./config.js";
import { mulberry32 } from "./rng.js";
import { buildPlanetMaterials, createIceShardHazard, createRidgeSpikeHazard, createMushroomHazard, createPlanetFeatures } from "./planet_features.js";
import {
  alignTurretPadSpawnProps,
  alignCavernDebrisSpawnProps,
  alignGaiaSpawnProps,
  alignMechanizedStructureSpawnProps,
  alignSurfaceDebrisSpawnProps,
  alignVentSpawnProps,
  planMinerSpawnPlacements as computeMinerSpawnPlacements,
} from "./planet_spawn.js";
import { collectSupportNodeIndices, getSupportNodeIndices, setSupportNodeIndices } from "./terrain_support.js";

/** @typedef {import("./types.d.js").DestroyedTerrainNode} DestroyedTerrainNode */
/** @typedef {import("./types.d.js").DetachedTerrainProp} DetachedTerrainProp */
/** @typedef {import("./types.d.js").StandablePoint} StandablePoint */

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
 * @template T
 * @param {T|null|undefined} value
 * @returns {T}
 */
function expectDefined(value){
  if (value == null){
    throw new Error("Expected value to be defined");
  }
  return value;
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
    this.radialGraphNavPadded = new RadialGraph(this.radial, {
      navPadding: 0.75,
    });
    this.airNodesBitmapNavPadded = buildAirNodesBitmap(this.radialGraphNavPadded, this.radial);
    /** @type {Float32Array} */
    this.distanceToTarget = new Float32Array(this.radialGraph.nodes.length);
    const mats = buildPlanetMaterials(this.mapgen, this.planetConfig, this.planetParams);
    this.material = mats.material;
    this.props = mats.props;
    this.iceShardHazard = createIceShardHazard(this.props || []);
    this.ridgeSpikeHazard = createRidgeSpikeHazard(this.props || []);
    this.mushroomHazard = createMushroomHazard(this.props || []);
    /** @type {StandablePoint[]} */
    this._standablePoints = [];
    /** @type {Array<{x:number,y:number,r:number}>} */
    this._spawnReservations = [];
    /** @type {Uint8Array|null} */
    this._spawnReachableMask = null;
    /** @type {Uint8Array|null} */
    this._enemyNavigationMaskNavPadded = null;
    this._rebuildSpawnReachabilityMask();
    this._spreadIceShardsUniform();
    this._snapIceShardsToSurface();
    this._alignTurretPadsToSurface();
    this._alignVentsToSurface();
    this._alignGaiaFlora();
    this._alignSurfaceDebris();
    this._alignCavernDebris();
    this._refreshTerrainPropSupportNodes();
    this._alignMechanizedStructures();
    this._reserveSpawnPointsFromProps();
    if (!this._standablePoints || !this._standablePoints.length){
      this._standablePoints = this._buildStandablePoints();
    }

    this.features = createPlanetFeatures(this, this.props || [], this.iceShardHazard, this.ridgeSpikeHazard, this.mushroomHazard);
    this._refreshTerrainPropSupportNodes();

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
   *  tremorLava:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number}>,
   *  mushroom:Array<{x:number,y:number,vx:number,vy:number,life:number}>,
   *  bubbles:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,spin:number}>,
   *  splashes:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,cr:number,cg:number,cb:number}>
   * }}
   */
  getFeatureParticles(){
    return this.features ? this.features.getParticles() : { iceShard: [], lava: [], tremorLava: [], mushroom: [], bubbles: [], splashes: [] };
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
   * Molten worlds render a hot-core overlay beyond the literal solid core.
   * Keep excavation from removing terrain hidden behind that visual mask.
   * @returns {number}
   */
  getProtectedTerrainRadius(){
    const coreR = this.getCoreRadius ? this.getCoreRadius() : 0;
    if (!(coreR > 0)) return 0;
    const params = this.getPlanetParams ? this.getPlanetParams() : null;
    const moltenOuter = (params && typeof params.MOLTEN_RING_OUTER === "number")
      ? Math.max(0, params.MOLTEN_RING_OUTER)
      : 0;
    if (!(moltenOuter > coreR)) return coreR;
    const baseOuter = moltenOuter > coreR ? moltenOuter : (coreR + 0.8);
    return Math.max(coreR, baseOuter + 0.5);
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
   *  onEnemyStun?: (enemy:{x:number,y:number,hp:number,hitT?:number,stunT?:number}, duration:number, source?:"mushroom"|"lava")=>void,
   *  onMinerKilled?: (miner:import("./types.d.js").Miner)=>void,
   *  onScreenShake?: (amount:number)=>void,
   *  onRumble?: (weak:number, strong:number, durationMs?:number)=>void,
   * }} state
   * @returns {void}
   */
  updateFeatureEffects(dt, state){
    if (this.features) this.features.update(dt, state);
  }

  /**
   * @param {boolean} [navPadded]
   * @returns {RadialGraph}
   */
  getRadialGraph(navPadded = false){
    return navPadded ? this.radialGraphNavPadded : this.radialGraph;
  }

  /**
   * @param {boolean} [navPadded]
   * @returns {Uint8Array}
   */
  getAirNodesBitmap(navPadded = false){
    return navPadded ? this.airNodesBitmapNavPadded : this.airNodesBitmap;
  }

  /**
   * @returns {Uint8Array}
   */
  getEnemyNavigationMask(navPadded = false){
    const baseMask = (this.features && this.features.getEnemyNavigationMask)
      ? this.features.getEnemyNavigationMask()
      : this.airNodesBitmap;
    if (!navPadded) return baseMask;
    const navPaddedBase = this.airNodesBitmapNavPadded;
    if (!navPaddedBase || baseMask.length === navPaddedBase.length){
      return baseMask;
    }
    if (!this._enemyNavigationMaskNavPadded || this._enemyNavigationMaskNavPadded.length !== navPaddedBase.length){
      this._enemyNavigationMaskNavPadded = new Uint8Array(navPaddedBase.length);
    }
    this._enemyNavigationMaskNavPadded.set(navPaddedBase);
    this._enemyNavigationMaskNavPadded.set(baseMask.subarray(0, Math.min(baseMask.length, navPaddedBase.length)));
    return this._enemyNavigationMaskNavPadded;
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
   * @param {number} dt
   * @param {{
   *  onExplosion?: (info:{x:number,y:number,life:number,radius:number})=>void,
   *  onDebris?: (info:{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number})=>void,
   *  onAreaDamage?: (x:number, y:number, radius:number)=>void,
   * }} callbacks
   * @returns {boolean}
   */
  handleFeatureContact(x, y, radius, dt, callbacks){
    if (!this.features) return false;
    return this.features.handleShipContact(x, y, radius, dt, callbacks);
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
   *  onScreenShake?: (amount:number)=>void,
   *  onRumble?: (weak:number, strong:number, durationMs?:number)=>void,
   * }} callbacks
   * @returns {boolean}
   */
  handleFeatureBomb(x, y, impactRadius, bombRadius, callbacks){
    if (!this.features) return false;
    return this.features.handleBomb(x, y, impactRadius, bombRadius, callbacks);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} impactRadius
   * @param {"bomb"|"crawler"} kind
   * @param {{
   *  onExplosion?: (info:{x:number,y:number,life:number,radius:number})=>void,
   *  onDebris?: (info:{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number})=>void,
   *  onAreaDamage?: (x:number, y:number, radius:number)=>void,
   *  onScreenShake?: (amount:number)=>void,
   *  onRumble?: (weak:number, strong:number, durationMs?:number)=>void,
   * }} callbacks
   * @returns {boolean}
   */
  handleFeatureImpact(x, y, impactRadius, kind, callbacks){
    if (!this.features || !this.features.handleImpact) return false;
    return this.features.handleImpact(x, y, impactRadius, kind, callbacks);
  }

  /**
   * @param {DestroyedTerrainNode[]} destroyedNodes
   * @param {{
   *  onExplosion?: (info:{x:number,y:number,life:number,radius:number})=>void,
   *  onDebris?: (info:{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number})=>void,
   *  onAreaDamage?: (x:number, y:number, radius:number)=>void,
   * }} callbacks
   * @returns {void}
   */
  handleFeatureTerrainDestroyed(destroyedNodes, callbacks){
    if (!this.features || !this.features.handleTerrainDestroyed) return;
    this.features.handleTerrainDestroyed(destroyedNodes, callbacks);
  }

  /**
   * Find nearest radial node to world point using ring radius.
   * @param {number} x
   * @param {number} y
   * @param {boolean} [navPadded]
   * @returns {number}
   */
  nearestRadialNodeInAir(x, y, navPadded = false){
    const graph = this.getRadialGraph(navPadded);
    const iNode = nearestRadialNode(graph, this.radial, x, y);
    if (iNode < 0 || iNode >= graph.nodes.length) return -1;
    const air = this.getAirNodesBitmap(navPadded);
    if (air[iNode]) return iNode;
    /**
     * @param {number} idx
     * @returns {boolean}
     */
    const hasAirNeighbor = (idx) => {
      const neigh = graph.neighbors[idx] || [];
      for (const edge of neigh){
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
          if (!node) continue;
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
        const neigh = graph.neighbors[idx] || [];
        for (const edge of neigh){
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
      if (!node) continue;
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
   * @param {number} x
   * @param {number} y
   * @param {number} range
   * @param {number} [maxTargets]
   * @returns {{newAir:Float32Array|undefined,destroyedNodes:Array<{idx:number,x:number,y:number,nx?:number,ny?:number}>}|undefined}
   */
  destroyRockRadialNodesInRange(x, y, range, maxTargets = Infinity){
    const graph = this.radialGraph;
    const nodes = graph && graph.nodes ? graph.nodes : null;
    const air = this.airNodesBitmap;
    if (!nodes || !nodes.length || !air || air.length !== nodes.length) return undefined;
    const limit = Number.isFinite(maxTargets) ? Math.max(1, Math.floor(maxTargets)) : Infinity;
    const rangeClamped = Math.max(0, range);
    const rangeSq = rangeClamped * rangeClamped;
    const protectedRadius = Math.max(0, this.getProtectedTerrainRadius());
    /** @type {Array<{idx:number,d2:number}>} */
    const candidates = [];
    for (let i = 0; i < nodes.length; i++){
      if (air[i]) continue;
      const node = nodes[i];
      if (!node || node.navPadded) continue;
      if (protectedRadius > 0 && Math.hypot(node.x, node.y) <= protectedRadius) continue;
      const dx = node.x - x;
      const dy = node.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > rangeSq) continue;
      candidates.push({ idx: i, d2 });
    }
    if (!candidates.length) return undefined;
    candidates.sort((a, b) => a.d2 - b.d2);
    let edited = false;
    /** @type {Array<{idx:number,x:number,y:number,nx?:number,ny?:number}>} */
    const destroyedNodes = [];
    for (let i = 0; i < candidates.length && i < limit; i++){
      const candidate = candidates[i];
      if (!candidate) continue;
      const node = nodes[candidate.idx];
      if (!node) continue;
      const normal = this.normalAtWorld(node.x, node.y);
      const changed = this.mapgen.setAirAtWorld(node.x, node.y, 1);
      edited = changed || edited;
      if (!changed) continue;
      if (normal){
        destroyedNodes.push({ idx: candidate.idx, x: node.x, y: node.y, nx: normal.nx, ny: normal.ny });
      } else {
        destroyedNodes.push({ idx: candidate.idx, x: node.x, y: node.y });
      }
    }
    if (!edited) return undefined;
    return { newAir: this._refreshAirAfterEdit(), destroyedNodes };
  }

  /**
   * Mark terrain-attached props whose support nodes were destroyed.
   * @param {DestroyedTerrainNode[]} destroyedNodes
   * @returns {DetachedTerrainProp[]}
   */
  destroyTerrainPropsAttachedToNodes(destroyedNodes){
    if (!destroyedNodes || !destroyedNodes.length || !this.props || !this.props.length) return [];
    /** @type {DetachedTerrainProp[]} */
    const destroyedProps = [];
    const destroyedNodeIndices = new Set(destroyedNodes.map((node) => node.idx));
    for (const p of this.props){
      if (!p || p.dead) continue;
      if (!this._propDetachesWithTerrain(p)) continue;
      const scale = Math.max(0.2, p.scale || 1);
      const supportIndices = getSupportNodeIndices(p);
      if (!supportIndices.length) continue;
      let detached = false;
      for (const idx of supportIndices){
        if (!destroyedNodeIndices.has(idx)) continue;
        detached = true;
        break;
      }
      if (!detached) continue;
      p.dead = true;
      destroyedProps.push({
        type: p.type,
        x: p.x,
        y: p.y,
        scale,
        nx: p.nx,
        ny: p.ny,
        rot: p.rot,
      });
    }
    return destroyedProps;
  }

  /**
   * @param {DetachedTerrainProp[]} detachedProps
   * @param {{onExplosion?:(info:{x:number,y:number,life:number,radius:number})=>void,onDebris?:(info:{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number})=>void,onAreaDamage?:(x:number,y:number,radius:number)=>void,onShipDamage?:(x:number,y:number)=>void,onShipHeat?:(amount:number)=>void,onShipCrash?:()=>void,onShipConfuse?:(duration:number)=>void}|null|undefined} callbacks
   * @returns {void}
   */
  emitDetachedTerrainPropBursts(detachedProps, callbacks){
    if (!detachedProps || !detachedProps.length || !callbacks || !this.features || !this.features.emitDetachedPropBursts) return;
    this.features.emitDetachedPropBursts(detachedProps, callbacks);
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
    alignVentSpawnProps(this);
  }

  /**
   * Align Gaia flora: trees on landable surface, mushrooms underground.
   * @returns {void}
   */
  _alignGaiaFlora(){
    alignGaiaSpawnProps(this);
  }

  /**
   * Align no-caves/water debris onto standable surface using radial-graph standable points.
   * @returns {void}
   */
  _alignSurfaceDebris(){
    alignSurfaceDebrisSpawnProps(this);
  }

  /**
   * Align cavern debris to cave walls with normals from radial graph boundaries.
   * @returns {void}
   */
  _alignCavernDebris(){
    alignCavernDebrisSpawnProps(this);
  }

  /**
   * Align mechanized factories/gates/tethers to standable surfaces.
   * @returns {void}
   */
  _alignMechanizedStructures(){
    alignMechanizedStructureSpawnProps(this);
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
    /**
     * @param {number} i
     * @returns {number}
     */
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
      let normal = this.normalAtWorld(p.x, p.y);
      if (!normal){
        p.dead = true;
        p.hp = 0;
        continue;
      }
      // If in air, move toward rock; if buried, nudge outward, then embed slightly.
      if (this.airValueAtWorld(p.x, p.y) > 0.5){
        for (let i = 0; i < 6; i++){
          p.x -= normal.nx * 0.06;
          p.y -= normal.ny * 0.06;
          if (this.airValueAtWorld(p.x, p.y) <= 0.5) break;
        }
      } else {
        const res = this.nudgeOutOfTerrain(p.x, p.y, 0.8, 0.08, 0.18);
        if (res.ok){
          p.x = res.x;
          p.y = res.y;
        }
      }
      normal = this.normalAtWorld(p.x, p.y);
      if (!normal){
        p.dead = true;
        p.hp = 0;
        continue;
      }
      // Embed slightly so they appear attached.
      p.x -= normal.nx * 0.03;
      p.y -= normal.ny * 0.03;
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
      if (!p) continue;
      const pt = points[i % points.length];
      if (!pt) continue;
      p.x = pt[0];
      p.y = pt[1];
      // Orient roughly orthogonal to the surface normal (tangent), with random flip/jitter.
      const normal = this.normalAtWorld(p.x, p.y);
      if (normal){
        const tx = -normal.ny;
        const ty = normal.nx;
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
    /**
     * @param {number} i
     * @returns {number}
     */
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
   * @param {number} a
   * @param {number} b
   * @returns {number}
   */
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
    const normal = this._upAlignedNormalAtWorld(x, y);
    const slope = this._surfaceSlopeAtWorld(x, y, normal);
    if (!normal || slope === null){
      return { ok: false, plusOk: false, minusOk: false, info: null, tx: 0, ty: 0 };
    }
    const tx = -normal.ny;
    const ty = normal.nx;
    const shoulder = 0.55 * scale + 0.08;
    const airClearance = 0.12;
    const rockDepth = 0.09;
    /**
     * @param {number} dir
     * @returns {boolean}
     */
    const shoulderSupported = (dir) => {
      const sx = x + tx * shoulder * dir;
      const sy = y + ty * shoulder * dir;
      return (this.airValueAtWorld(sx + normal.nx * airClearance, sy + normal.ny * airClearance) > 0.5)
        && (this.airValueAtWorld(sx - normal.nx * rockDepth, sy - normal.ny * rockDepth) <= 0.5);
    };
    const plusOk = shoulderSupported(1);
    const minusOk = shoulderSupported(-1);
    const ok = this.isLandableAtWorld(x, y, 0.45, 0.16, eps) && plusOk && minusOk;
    return { ok, plusOk, minusOk, info: { nx: normal.nx, ny: normal.ny, slope }, tx, ty };
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
      const v = ring[i];
      if (!v) continue;
      const ang = this._normalizeAngle(Math.atan2(v.y, v.x));
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
      minusVertex: expectDefined(ring[minusIdx]),
      plusVertex: expectDefined(ring[plusIdx]),
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
    /** @type {number[]} */
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
      const idx = expectDefined(queue[q]);
      const neigh = graph.neighbors[idx] || [];
      for (const edge of neigh){
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
    /**
     * @param {any} cand
     * @returns {boolean}
     */
    const canUseCandidate = (cand) => (
      cand
      && cand !== candidate
      && !used.has(cand)
      && this._barrenCandidateHasSpacing(cand, chosenTurrets, minDist)
    );
    /**
     * @param {number} baseIndex
     * @returns {any|null}
     */
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
    /**
     * @param {number} nodeIdx
     * @returns {boolean}
     */
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
    const start = graph.nodes[startNode];
    if (!start) return null;
    const visited = new Set([startNode]);
    /** @type {number[]} */
    let frontier = [startNode];
    for (let nextRing = start.r + 1; nextRing <= outerRingIndex; nextRing++){
      /** @type {number[]} */
      const ringAir = [];
      /** @type {number[]} */
      const queue = [];
      for (const nodeIdx of frontier){
        const neigh = graph.neighbors[nodeIdx] || [];
        for (const edge of neigh){
          const nextIdx = edge.to;
          if (visited.has(nextIdx)) continue;
          const nextNode = graph.nodes[nextIdx];
          if (!nextNode || nextNode.r !== nextRing || !isAirNode(nextIdx)) continue;
          visited.add(nextIdx);
          queue.push(nextIdx);
        }
      }
      for (let qi = 0; qi < queue.length; qi++){
        const nodeIdx = expectDefined(queue[qi]);
        ringAir.push(nodeIdx);
        const neigh = graph.neighbors[nodeIdx] || [];
        for (const edge of neigh){
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
    const normal = this.normalAtWorld(prop.x, prop.y);
    if (normal){
      prop.padNx = normal.nx;
      prop.padNy = normal.ny;
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
      if (!prop) continue;
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
    alignTurretPadSpawnProps(this);
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
    /**
     * @param {number} i
     * @returns {number}
     */
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
   * @returns {StandablePoint[]} [x,y,angle,r,supportNodeIndex]
   */
  _buildStandablePoints(){
    const maxSlope = 0.28;
    const clearance = 0.2;
    const eps = 0.18;
    const sideClearance = 0.25;
    const graph = this.radialGraph;
    /** @type {StandablePoint[]} */
    const points = [];
    if (!graph || !graph.nodes || !graph.nodes.length) return points;
    const passable = buildPassableMask(this.radial, graph, 0.5);
    for (let i = 0; i < graph.nodes.length; i++){
      if (!passable[i]) continue;
      const n = graph.nodes[i];
      if (!n) continue;
      let inner = -1;
      let innerR = -1;
      const neigh = graph.neighbors[i] || [];
      for (const edge of neigh){
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
      if (!nb) continue;
      const aOuter = this.radial.airValueAtWorld(n.x, n.y);
      const aInner = this.radial.airValueAtWorld(nb.x, nb.y);
      const denom = (aOuter - aInner);
      const t = denom !== 0 ? Math.max(0, Math.min(1, (0.5 - aInner) / denom)) : 0.5;
      const sx = nb.x + (n.x - nb.x) * t;
      const sy = nb.y + (n.y - nb.y) * t;
      const normal = this._upAlignedNormalAtWorld(sx, sy);
      if (!normal) continue;
      const px = sx + normal.nx * 0.02;
      const py = sy + normal.ny * 0.02;
      if (!this.isStandableAtWorld(px, py, maxSlope, clearance, eps, sideClearance)) continue;
      const ang = Math.atan2(py, px);
      const r = Math.hypot(px, py);
      points.push([px, py, ang, r, inner]);
    }
    return points;
  }

  /**
   * Cached standable points. Do not mutate.
   * @returns {StandablePoint[]} [x,y,angle,r,supportNodeIndex]
   */
  getStandablePoints(){
    return this._standablePoints || [];
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  _findStandableSupportNodeIndex(x, y){
    const points = this.getStandablePoints();
    let bestIdx = -1;
    let bestD2 = Infinity;
    for (const p of points){
      if (!p) continue;
      const dx = p[0] - x;
      const dy = p[1] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 >= bestD2) continue;
      bestD2 = d2;
      bestIdx = Number.isFinite(p[4]) ? Number(p[4]) : -1;
      if (d2 <= 1e-10 && bestIdx >= 0) break;
    }
    return bestIdx;
  }

  /**
   * @param {{type:string,scale?:number}} p
   * @returns {number}
   */
  _terrainPropSupportRadius(p){
    const scale = Math.max(0.2, p && p.scale ? p.scale : 1);
    if (!p) return 0.28;
    if (p.type === "tree") return Math.max(0.24, 0.18 + scale * 0.16);
    if (p.type === "boulder") return Math.max(0.26, 0.18 + scale * 0.22);
    if (p.type === "ridge_spike") return Math.max(0.24, 0.16 + scale * 0.18);
    if (p.type === "stalactite") return Math.max(0.22, 0.15 + scale * 0.16);
    if (p.type === "ice_shard") return Math.max(0.18, 0.12 + scale * 0.14);
    if (p.type === "factory") return Math.max(0.22, 0.16 + scale * 0.18);
    if (p.type === "vent") return Math.max(0.18, 0.12 + scale * 0.12);
    if (p.type === "mushroom") return Math.max(0.16, 0.10 + scale * 0.12);
    if (p.type === "bubble_hex") return Math.max(0.10, 0.08 + scale * 0.10);
    if (p.type === "turret_pad") return Math.max(0.24, 0.18 + scale * 0.14);
    return 0.28;
  }

  /**
   * @param {{type?:string}|null|undefined} p
   * @returns {boolean}
   */
  _propTracksTerrainSupport(p){
    if (!p) return false;
    return p.type === "tree"
      || p.type === "boulder"
      || p.type === "ridge_spike"
      || p.type === "stalactite"
      || p.type === "ice_shard"
      || p.type === "factory"
      || p.type === "vent"
      || p.type === "mushroom"
      || p.type === "bubble_hex"
      || p.type === "turret_pad";
  }

  /**
   * @param {{type?:string}|null|undefined} p
   * @returns {boolean}
   */
  _propDetachesWithTerrain(p){
    if (!this._propTracksTerrainSupport(p)) return false;
    return !!(p && p.type !== "bubble_hex");
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {number} [preferredIndex]
   * @returns {number[]}
   */
  _collectRockSupportNodeIndices(x, y, radius, preferredIndex = -1){
    const graph = this.radialGraph;
    const nodes = graph && graph.nodes ? graph.nodes : null;
    const air = this.airNodesBitmap;
    return collectSupportNodeIndices(nodes, air, x, y, radius, preferredIndex, 8);
  }

  /**
   * Rebuild support-node footprints for terrain-attached props after placement.
   * @returns {void}
   */
  _refreshTerrainPropSupportNodes(){
    if (!this.props || !this.props.length) return;
    for (const p of this.props){
      if (!p || p.dead) continue;
      if (!this._propTracksTerrainSupport(p)) continue;
      const anchorX = Number.isFinite(p.supportX) ? Number(p.supportX) : p.x;
      const anchorY = Number.isFinite(p.supportY) ? Number(p.supportY) : p.y;
      const supportIndices = this._collectRockSupportNodeIndices(
        anchorX,
        anchorY,
        this._terrainPropSupportRadius(p),
        Number.isFinite(p.supportNodeIndex) ? Number(p.supportNodeIndex) : -1,
      );
      if (!supportIndices.length) continue;
      setSupportNodeIndices(p, supportIndices, Number.isFinite(p.supportNodeIndex) ? Number(p.supportNodeIndex) : -1);
    }
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
      if (!n) continue;
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
   * @param {StandablePoint[]} points
   * @returns {StandablePoint[]}
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
      indices.sort((a, b) => expectDefined(points[a])[2] - expectDefined(points[b])[2]);
      const offset = rand();
      const step = (Math.PI * 2) / take;
      const window = step * 0.65;
      for (let i = 0; i < take; i++){
        const target = (i + offset) * step;
        let picked = -1;
        let pickedScore = Infinity;
        for (const idx of indices){
          const p = points[idx];
          if (!p) continue;
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
          if (!p) continue;
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
          if (!p) continue;
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
          if (idx === undefined) continue;
          const p = points[idx];
          if (!p) continue;
          centers.push(p[2]);
        }
        if (!centers.length) return out;
        let clusterIndex = 0;
        const window = (Math.PI * 2) / Math.max(6, clusterCount * 2);
        for (let i = 0; i < take; i++){
          const target = centers[clusterIndex % centers.length];
          if (target === undefined) continue;
          clusterIndex++;
          let picked = -1;
          let pickedScore = Infinity;
          for (const idx of indices){
            if (used.has(idx)) continue;
            const p = points[idx];
            if (!p) continue;
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
            if (!p) continue;
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
            if (!p) continue;
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
          const tmp = expectDefined(indices[i]);
          indices[i] = expectDefined(indices[j]);
          indices[j] = tmp;
        }
        for (const idx of indices){
          const p = points[idx];
          if (!p) continue;
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
            if (!p) continue;
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
   * Build miner spawn placements against the finalized planet, props, and reservations.
   * @param {number} count
   * @param {number} seed
   * @param {number} [minDist]
   * @returns {{
   *  placements: Array<{x:number,y:number,supportX?:number,supportY?:number,supportNodeIndex?:number,supportNodeIndices?:number[]}>,
   *  debug: {
   *    mode: "barren"|"standable",
   *    pads?: number,
   *    standable?: number,
   *    available?: number,
   *    reservations?: number,
   *    props?: Record<string, number>|null,
   *    minR?: number,
   *    filteredStandable?: number,
   *  }
   * }}
   */
  planMinerSpawnPlacements(count, seed, minDist = GAME.MINER_MIN_SEP){
    return computeMinerSpawnPlacements(this, count, seed, minDist);
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
    return this._refreshAirAfterEdit();
  }

  /**
   * @returns {Float32Array|undefined}
   */
  _refreshAirAfterEdit(){
    const newAir = this.radial.updateAirFlags(true);
    this.airNodesBitmap = buildAirNodesBitmap(this.radialGraph, this.radial);
    this.airNodesBitmapNavPadded = buildAirNodesBitmap(this.radialGraphNavPadded, this.radial);
    this._enemyNavigationMaskNavPadded = null;
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
    const newAir = this._refreshAirAfterEdit();

    if (Array.isArray(state.props) && Array.isArray(this.props)){
      const count = Math.min(this.props.length, state.props.length);
      for (let i = 0; i < count; i++){
        const src = state.props[i];
        const dst = this.props[i];
        if (!src || typeof src !== "object" || !dst || typeof dst !== "object") continue;
        /** @type {Record<string, any>} */
        const srcRecord = /** @type {Record<string, any>} */ (src);
        /** @type {Record<string, any>} */
        const dstRecord = /** @type {Record<string, any>} */ (dst);
        for (const key of Object.keys(dstRecord)){
          if (!Object.prototype.hasOwnProperty.call(srcRecord, key)){
            delete dstRecord[key];
          }
        }
        for (const key of Object.keys(srcRecord)){
          dstRecord[key] = clonePlainData(srcRecord[key]);
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
   * @returns {boolean}
   */
  hasSeenCoreOverlay(){
    const coreR = this.getCoreRadius ? this.getCoreRadius() : 0;
    if (!(coreR > 0)) return false;
    const params = this.getPlanetParams ? this.getPlanetParams() : null;
    const moltenOuter = params && typeof params.MOLTEN_RING_OUTER === "number"
      ? params.MOLTEN_RING_OUTER
      : 0;
    return !this.radial || typeof this.radial.hasSeenCoreOverlay !== "function"
      ? true
      : this.radial.hasSeenCoreOverlay(coreR, moltenOuter);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  shadeAtWorld(x, y){
    return this.radial.shadeAtWorld(x, y);
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
    const n = this._airGradientNormalAtWorld(x, y, eps);
    if (!n) {
      return null;
    }

    const step = -dist;
    return {x: x + n.nx * step, y: y + n.ny * step};
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
   * Exact surface normal at a world point.
   * Returns null when the point is not on a boundary-carrying terrain surface.
   * @param {number} x
   * @param {number} y
   * @returns {{nx:number, ny:number}|null}
   */
  normalAtWorld(x, y){
    const tri = this.radial && typeof this.radial.findTriAtWorld === "function"
      ? this.radial.findTriAtWorld(x, y)
      : null;
    if (this._triStraddlesBoundary(tri)){
      return this._triGradientNormal(tri);
    }
    const rOuter = this._outerShellRadius();
    if (!(rOuter > 0)) return null;
    const r = Math.hypot(x, y);
    if (r <= 1e-6) return null;
    const ux = x / r;
    const uy = y / r;
    const probe = 0.08;
    const shellGap = Math.max(0.08, probe * 1.5);
    if (Math.abs(r - rOuter) > shellGap) return null;
    const airOut = this.airValueAtWorld(x + ux * probe, y + uy * probe);
    const airIn = this.airValueAtWorld(x - ux * probe, y - uy * probe);
    if (!(airOut > 0.5 && airIn <= 0.5)) return null;
    return { nx: ux, ny: uy };
  }

  /**
   * Exact terrain crossing along a swept segment.
   * Returns null when the segment does not cross a terrain surface.
   * @param {{x:number,y:number}} p1
   * @param {{x:number,y:number}} p2
   * @returns {{x:number,y:number,nx:number,ny:number}|null}
   */
  terrainCrossing(p1, p2){
    if (!p1 || !p2) return null;
    const ax = p1.x;
    const ay = p1.y;
    const bx = p2.x;
    const by = p2.y;
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)){
      return null;
    }
    const a0 = this.airValueAtWorld(ax, ay);
    const a1 = this.airValueAtWorld(bx, by);
    const s0 = a0 > 0.5;
    const s1 = a1 > 0.5;
    if (s0 === s1){
      return null;
    }
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++){
      const mid = (lo + hi) * 0.5;
      const mx = ax + (bx - ax) * mid;
      const my = ay + (by - ay) * mid;
      const airMid = this.airValueAtWorld(mx, my) > 0.5;
      if (airMid === s0){
        lo = mid;
      } else {
        hi = mid;
      }
    }
    let x = ax + (bx - ax) * hi;
    let y = ay + (by - ay) * hi;
    let n = this.normalAtWorld(x, y);
    if (!n){
      const tShell = this._segmentOuterShellHitT(ax, ay, bx, by);
      if (tShell === null){
        return null;
      }
      x = ax + (bx - ax) * tShell;
      y = ay + (by - ay) * tShell;
      const r = Math.hypot(x, y);
      if (r <= 1e-6) return null;
      n = { nx: x / r, ny: y / r };
    }
    return { x, y, nx: n.nx, ny: n.ny };
  }

  /**
   * @param {Array<{x:number,y:number,air:number}>|null|undefined} tri
   * @param {number} [threshold]
   * @returns {boolean}
   */
  _triStraddlesBoundary(tri, threshold = 0.5){
    if (!tri || tri.length < 3) return false;
    let minA = Infinity;
    let maxA = -Infinity;
    for (const v of tri){
      minA = Math.min(minA, v.air);
      maxA = Math.max(maxA, v.air);
    }
    return minA <= threshold && maxA > threshold;
  }

  /**
   * @param {Array<{x:number,y:number,air:number}>|null|undefined} tri
   * @returns {{nx:number,ny:number}|null}
   */
  _triGradientNormal(tri){
    if (!tri || tri.length < 3) return null;
    const a = tri[0];
    const b = tri[1];
    const c = tri[2];
    if (!a || !b || !c) return null;
    const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (Math.abs(det) < 1e-8) return null;
    const dfdx = (a.air * (b.y - c.y) + b.air * (c.y - a.y) + c.air * (a.y - b.y)) / det;
    const dfdy = (a.air * (c.x - b.x) + b.air * (a.x - c.x) + c.air * (b.x - a.x)) / det;
    const gLen = Math.hypot(dfdx, dfdy);
    if (gLen < 1e-8) return null;
    return { nx: dfdx / gLen, ny: dfdy / gLen };
  }

  /**
   * @returns {number}
   */
  _outerShellRadius(){
    return (this.radial && this.radial.rings && this.radial.rings.length)
      ? (this.radial.rings.length - 1)
      : this.planetRadius;
  }

  /**
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @returns {number|null}
   */
  _segmentOuterShellHitT(ax, ay, bx, by){
    const rOuter = this._outerShellRadius();
    if (!(rOuter > 0)) return null;
    const dx = bx - ax;
    const dy = by - ay;
    const qa = dx * dx + dy * dy;
    if (qa <= 1e-10) return null;
    const qb = 2 * (ax * dx + ay * dy);
    const qc = ax * ax + ay * ay - rOuter * rOuter;
    const disc = qb * qb - 4 * qa * qc;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    const t0 = (-qb - root) / (2 * qa);
    const t1 = (-qb + root) / (2 * qa);
    let t = null;
    if (t0 >= 0 && t0 <= 1) t = t0;
    if (t1 >= 0 && t1 <= 1){
      t = (t === null) ? t1 : Math.min(t, t1);
    }
    return t;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{nx:number,ny:number}|null}
   */
  _upAlignedNormalAtWorld(x, y){
    const n = this.normalAtWorld(x, y);
    const up = this._upDirAt(x, y);
    if (!n || !up) return null;
    if (n.nx * up.ux + n.ny * up.uy < 0){
      return { nx: -n.nx, ny: -n.ny };
    }
    return n;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{nx:number,ny:number}|null|undefined} normal
   * @returns {number|null}
   */
  _surfaceSlopeAtWorld(x, y, normal){
    const up = this._upDirAt(x, y);
    if (!up || !normal) return null;
    return 1 - Math.abs(normal.nx * up.ux + normal.ny * up.uy);
  }

  /**
   * Private recovery helper for nudging buried points back toward air.
   * @param {number} x
   * @param {number} y
   * @param {number} eps
   * @returns {{nx:number,ny:number}|null}
   */
  _airGradientNormalAtWorld(x, y, eps){
    const gdx = this.radial.airValueAtWorld(x + eps, y) - this.radial.airValueAtWorld(x - eps, y);
    const gdy = this.radial.airValueAtWorld(x, y + eps) - this.radial.airValueAtWorld(x, y - eps);
    const len = Math.hypot(gdx, gdy);
    if (len < 1e-6) return null;
    return { nx: gdx / len, ny: gdy / len };
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
    const n = this._upAlignedNormalAtWorld(x, y);
    const slope = this._surfaceSlopeAtWorld(x, y, n);
    if (slope === null) return false;
    return slope <= maxSlope;
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
    const n = this._upAlignedNormalAtWorld(x, y);
    const slope = this._surfaceSlopeAtWorld(x, y, n);
    if (!n || slope === null || slope > maxSlope) return false;
    const ax = x + n.nx * clearance;
    const ay = y + n.ny * clearance;
    const bx = x - n.nx * clearance;
    const by = y - n.ny * clearance;
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
    const n = this._upAlignedNormalAtWorld(x, y);
    const slope = this._surfaceSlopeAtWorld(x, y, n);
    if (!n || slope === null || slope > maxSlope) return false;
    const nx = n.nx;
    const ny = n.ny;
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
      const n = this._airGradientNormalAtWorld(cx, cy, eps);
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
   * Evaluate fog for the entire current mesh and push it to the renderer.
   * @param {{updateFog:(fog:Float32Array)=>void}} renderer
   * @param {number} shipX
   * @param {number} shipY
   * @returns {void}
   */
  primeRenderFog(renderer, shipX, shipY){
    const fog = this.radial && typeof this.radial.primeFog === "function"
      ? this.radial.primeFog(shipX, shipY)
      : this.updateFogForRender(shipX, shipY);
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
    if (!n){
      passable[i] = 0;
      continue;
    }
    if (n.navPadded){
      passable[i] = 1;
      continue;
    }
    const ring = ringMesh.rings[n.r];
    const vertex = ring ? ring[n.i] : null;
    passable[i] = vertex && vertex.air > 0.5 ? 1 : 0;
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
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(value)){
    const v = value[key];
    if (typeof v === "function" || v === undefined) continue;
    out[key] = clonePlainData(v);
  }
  return out;
}
