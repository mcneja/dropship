// @ts-check

import { RingMesh } from "./planet_ring_mesh.js";
import { RadialGraph, dijkstraMap, nearestRadialNode } from "./navigation.js";
import { MapGen } from "./mapgen.js";
import { CFG } from "./config.js";
import { buildPlanetMaterials, createIceShardHazard, createRidgeSpikeHazard, createMushroomHazard, createPlanetFeatures } from "./planet_features.js";
import * as planetSpawn from "./planet_spawn.js";
import * as terrainSupport from "./terrain_support.js";

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
    planetSpawn.initializePlanetProps(this);

    this.features = createPlanetFeatures(this, this.props || [], this.iceShardHazard, this.ridgeSpikeHazard, this.mushroomHazard);
    terrainSupport.refreshTerrainPropSupportNodes(this);

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
   * Configured world radius (RMAX).
   * @returns {number}
   */
  getWorldRadius(){
    return this.planetRadius;
  }

  /**
   * Radial-mesh outer ring index (0-based).
   * @returns {number}
   */
  getOuterRingIndex(){
    return this.radial.outerRingIndex();
  }

  /**
   * Radial-mesh outer ring radius in world units.
   * @returns {number}
   */
  getOuterRingRadius(){
    return this.radial.outerRingRadius();
  }

  /**
   * Terrain shell radius where air/rock boundary is interpreted.
   * Outer ring is reserved as air; shell is the midpoint to the next inner ring.
   * @returns {number}
   */
  getSurfaceShellRadius(){
    return this.radial.outerSurfaceRadius();
  }

  /**
   * Outer radius where atmospheric drag reaches zero.
   * @returns {number}
   */
  getAtmosphereOuterRadius(){
    const h = Math.max(0, this.planetParams?.ATMOSPHERE_HEIGHT || 0);
    return this.getSurfaceShellRadius() + h;
  }

  /**
   * @returns {{
   *  iceShard:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number}>,
   *  lava:Array<{x:number,y:number,vx:number,vy:number,life:number}>,
   *  ventPlume:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number}>,
   *  spores:Array<{x:number,y:number,vx:number,vy:number,life:number}>,
   *  bubbles:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,spin:number}>,
   *  splashes:Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,cr:number,cg:number,cb:number}>
   * }}
   */
  getFeatureParticles(){
    return this.features.getParticles();
  }

  /**
   * @returns {void}
   */
  clearFeatureParticles(){
    this.features.clearParticles();
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
    const coreR = this.getCoreRadius();
    if (!(coreR > 0)) return 0;
    const params = this.getPlanetParams();
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
   *  onEnemyStun?: (enemy:{x:number,y:number,hp:number,hitT?:number,stunT?:number}, duration:number, source?:"spores"|"lava")=>void,
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
    const baseMask = this.features.getEnemyNavigationMask();
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
    this.features.reconcile(state);
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
   * @param {number} radius
   * @returns {boolean}
   */
  handleFeatureBombContact(x, y, radius){
    if (!this.features || !this.features.handleBombContact) return false;
    return this.features.handleBombContact(x, y, radius);
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
      if (!terrainSupport.propDetachesWithTerrain(p)) continue;
      const scale = Math.max(0.2, p.scale || 1);
      const anchorX = Number.isFinite(p.supportX) ? Number(p.supportX) : p.x;
      const anchorY = Number.isFinite(p.supportY) ? Number(p.supportY) : p.y;
      const supportRadius = terrainSupport.terrainPropSupportRadius(p);
      const preferredSupportIdx = Number.isFinite(p.supportNodeIndex) ? Number(p.supportNodeIndex) : -1;
      let supportIndices = terrainSupport.getSupportNodeIndices(p);
      if (!supportIndices.length){
        supportIndices = terrainSupport.collectRockSupportNodeIndices(
          this,
          anchorX,
          anchorY,
          supportRadius,
          preferredSupportIdx
        );
        if (supportIndices.length){
          terrainSupport.setSupportNodeIndices(p, supportIndices, preferredSupportIdx);
        }
      }
      let detached = false;
      for (const idx of supportIndices){
        if (!destroyedNodeIndices.has(idx)) continue;
        detached = true;
        break;
      }
      if (!detached){
        const nearRadius = Math.max(0.35, supportRadius + 0.30);
        const nearRadiusSq = nearRadius * nearRadius;
        let nearDestroyed = false;
        for (const node of destroyedNodes){
          if (!node) continue;
          const dx = anchorX - node.x;
          const dy = anchorY - node.y;
          if (dx * dx + dy * dy > nearRadiusSq) continue;
          nearDestroyed = true;
          break;
        }
        if (!nearDestroyed){
          continue;
        }
        const refreshedSupport = terrainSupport.collectRockSupportNodeIndices(
          this,
          anchorX,
          anchorY,
          supportRadius,
          preferredSupportIdx
        );
        if (refreshedSupport.length){
          terrainSupport.setSupportNodeIndices(p, refreshedSupport, preferredSupportIdx);
        } else {
          detached = true;
        }
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
   * @returns {number}
   */
  _coreRadiusWorld(){
    const p = this.planetParams;
    if (!p || !p.CORE_RADIUS) return 0;
    if (p.CORE_RADIUS > 1) return p.CORE_RADIUS;
    return p.CORE_RADIUS * (p.RMAX || 0);
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
    return this.radial.airValueAtWorldForCollision(x, y);
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
    planetSpawn.rebuildSpawnReachabilityMask(this);
    this._radialDebugDirty = true;
    return newAir;
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
    const tri = this.radial.findTriAtWorld(x, y);
    if (this._triStraddlesBoundary(tri)){
      return this._triGradientNormal(tri);
    }
    const shellR = this._surfaceShellRadius();
    if (!(shellR > 0)) return null;
    const r = Math.hypot(x, y);
    if (r <= 1e-6) return null;
    const ux = x / r;
    const uy = y / r;
    const probe = 0.08;
    const shellGap = Math.max(0.08, probe * 1.5);
    if (Math.abs(r - shellR) > shellGap) return null;
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
  _surfaceShellRadius(){
    return this.getSurfaceShellRadius();
  }

  /**
   * @returns {number}
   */
  _outerShellRadius(){
    return this._surfaceShellRadius();
  }

  /**
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @returns {number|null}
   */
  _segmentOuterShellHitT(ax, ay, bx, by){
    const shellR = this._surfaceShellRadius();
    if (!(shellR > 0)) return null;
    const dx = bx - ax;
    const dy = by - ay;
    const qa = dx * dx + dy * dy;
    if (qa <= 1e-10) return null;
    const qb = 2 * (ax * dx + ay * dy);
    const qc = ax * ax + ay * ay - shellR * shellR;
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


