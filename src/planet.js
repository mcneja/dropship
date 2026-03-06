// @ts-check

import { RingMesh } from "./planet_ring_mesh.js";
import { RadialGraph, buildPassableMask } from "./navigation.js";
import { MapGen } from "./mapgen.js";
import { CFG, GAME } from "./config.js";
import { mulberry32 } from "./rng.js";
import { buildPlanetMaterials, createIceShardHazard, createMushroomHazard, createPlanetFeatures } from "./planet_materials.js";

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
    const mats = buildPlanetMaterials(this.mapgen, this.planetConfig, this.planetParams);
    this.material = mats.material;
    this.props = mats.props;
    this.iceShardHazard = createIceShardHazard(this.props || []);
    this.mushroomHazard = createMushroomHazard(this.props || []);
    this._spreadIceShardsUniform();
    this._snapIceShardsToSurface();
    this._alignTurretPadsToSurface();
    this._alignVentsToSurface();
    this._alignGaiaFlora();
    this._spawnReservations = [];
    this._reserveSpawnPointsFromProps();
    this._standablePoints = this._buildStandablePoints();

    this.features = createPlanetFeatures(this, this.props || [], this.iceShardHazard, this.mushroomHazard);

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
   * @returns {{lava:Array<{x:number,y:number,vx:number,vy:number,life:number}>,mushroom:Array<{x:number,y:number,vx:number,vy:number,life:number}>}}
   */
  getFeatureParticles(){
    return this.features ? this.features.getParticles() : { lava: [], mushroom: [] };
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
   *  onEnemyHit?: (enemy:{x:number,y:number,hp:number,hitT?:number}, x:number, y:number)=>void,
   *  onMinerKilled?: (miner:import("./types.d.js").Miner)=>void,
   * }} state
   * @returns {void}
   */
  updateFeatureEffects(dt, state){
    if (this.features) this.features.update(dt, state);
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
      const points = this.sampleLandablePoints(trees.length, seed, 0.30, 0.2, "uniform");
      for (let i = 0; i < trees.length && i < points.length; i++){
        const p = trees[i];
        const pt = points[i];
        p.x = pt[0];
        p.y = pt[1];
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
    const pads = [];
    for (const p of this.props){
      if (p.type === "turret_pad") pads.push(p);
    }
    if (!pads.length) return;
    const seed = (this.mapgen.getWorld().seed | 0) + 913;
    const rand = mulberry32(seed);
    const placed = [];
    const rMin = 1.0;
    const rMax = this.planetParams.RMAX + 1.2;
    const minDist = 0.9;
    for (let i = 0; i < pads.length; i++){
      const p = pads[i];
      let placedOk = false;
      const base = (i / Math.max(1, pads.length)) * Math.PI * 2;
      for (let attempt = 0; attempt < 10 && !placedOk; attempt++){
        const ang = base + (rand() - 0.5) * 0.6;
        const surf = this._findSurfaceAtAngle(ang, rMin, rMax);
        if (!surf) continue;
        const info = this.surfaceInfoAtWorld(surf.x, surf.y, 0.18);
        if (!info || info.slope > 0.08) continue;
        if (!this.isStandableAtWorld(surf.x, surf.y, 0.08, 0.3, 0.18, 0.28)) continue;
        let tooClose = false;
        for (const pt of placed){
          const dx = pt[0] - surf.x;
          const dy = pt[1] - surf.y;
          if (dx * dx + dy * dy < minDist * minDist){
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        p.x = surf.x;
        p.y = surf.y;
        const up = this._upDirAt(p.x, p.y);
        if (up){
          p.padNx = up.ux;
          p.padNy = up.uy;
        }
        placed.push([p.x, p.y]);
        placedOk = true;
      }
      if (!placedOk){
        p.dead = true;
        p.hp = 0;
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
        if (this.airValueAtWorld(x, y) > 0.5){
          points.push([x, y]);
        }
      }
      return points;
    }
    for (let i = 0; i < attempts && points.length < count; i++){
      const ang = rand() * Math.PI * 2;
      const r = Math.sqrt(rMin * rMin + rand() * (rMax * rMax - rMin * rMin));
      const x = r * Math.cos(ang);
      const y = r * Math.sin(ang);
      if (this.airValueAtWorld(x, y) <= 0.5) continue;
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
   * Reserve prop locations so spawns avoid them.
   * @returns {void}
   */
  _reserveSpawnPointsFromProps(){
    if (!this.props || !this.props.length) return;
    const base = Math.max(0.4, GAME.MINER_MIN_SEP * 0.6);
    for (const p of this.props){
      if (p.dead) continue;
      this._spawnReservations.push({ x: p.x, y: p.y, r: base });
    }
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
      const rr = minDist + (rsv.r || 0);
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
    const points = this.getStandablePoints();
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
    return this.sampleStandablePoints(count, seed, placement, minDist, reserve);
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
    const pos = this._posClosestForPath(x, y);
    if (!pos) return null;

    /** @type {Array<{x:number, y:number}>} */
    const path = [{x: pos.x, y: pos.y}];
    let indexClosest = 0;

    let px = pos.x;
    let py = pos.y;

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
      const dotUp = (px * n.nx + py * n.ny) / (r * Math.hypot(n.nx, n.ny));
      // Allow inward-facing surfaces only near the outer band to avoid "ceiling" paths.
      if (dotUp <= 0.5) {
        if (dotUp >= -0.5) return null;
        if (r < this.planetRadius * 0.92) return null;
      }
      const qx = px + n.ny * -stepSize;
      const qy = py + n.nx *  stepSize;
      const posNext = this._posClosestForPath(qx, qy);
      if (!posNext) return null;
      if (Math.hypot(posNext.x - x, posNext.y - y) > maxDistance) return null;
      return {x: posNext.x, y: posNext.y};
    };

    const stepSize = 0.25;

    const maxPointsPos = 16;
    while (path.length < maxPointsPos) {
      const posExtend = tryGetStep(path[0].x, path[0].y, stepSize);
      if (!posExtend) break;
      path.unshift(posExtend);
      ++indexClosest;
    }

    const maxPointsNeg = path.length + 15;
    while (path.length < maxPointsNeg) {
      const posExtend = tryGetStep(path[path.length-1].x, path[path.length-1].y, -stepSize);
      if (!posExtend) break;
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
