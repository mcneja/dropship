// @ts-check

import { RingMesh } from "./planet_ring_mesh.js";
import { PlanetSdf } from "./planet_sdf.js";

const surfaceGravityAcceleration = 2.0;

/**
 * Planet terrain abstraction backed by mapgen grid truth.
 */
export class Planet {
  /**
   * @param {typeof import("./config.js").CFG} cfg
   * @param {typeof import("./config.js").GAME} game
   * @param {import("./mapgen.js").MapGen} mapgen
   */
  constructor(cfg, game, mapgen){
    this.cfg = cfg;
    this.game = game;
    this.mapgen = mapgen;
    /** @type {"radial"|"sdf"} */
    this.mode = "radial";
    const rPlanet = cfg.RMAX;
    this.planetRadius = rPlanet;
    this.gravitationalConstant = surfaceGravityAcceleration * rPlanet * rPlanet;

    this.radial = new RingMesh(cfg, mapgen);
    this.radial.initFog(game);

    this.sdf = new PlanetSdf(cfg, game, mapgen, () => this._radialNodeCount(), (x, y) => this.radial.airValueAtWorld(x, y));
    /** @type {Array<[number,number,boolean,number]>|null} */
    this._radialDebugPoints = null;
    /** @type {boolean} */
    this._radialDebugDirty = true;
    /** @type {boolean} */
    this._radialDirty = false;
    /** @type {boolean} */
    this._sdfDirty = false;
    /** @type {boolean} */
    this._sdfDirtyFull = false;
  }

  /**
   * @param {"radial"|"sdf"} mode
   */
  setMode(mode){
    this.mode = mode;
  }

  /**
   * @returns {void}
   */
  toggleMode(){
    this.mode = this.mode === "radial" ? "sdf" : "radial";
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  airValueAtWorld(x, y){
    if (this.mode === "radial"){
      return this.radial.airValueAtWorld(x, y);
    }
    return this.sdf.airValueAtWorld(x, y);
  }

  /**
   * @returns {Array<[number,number,boolean,number]>|null}
   */
  debugPoints(){
    if (this.mode === "sdf"){
      return this.sdf.debugPoints();
    }
    if (this._radialDebugDirty || !this._radialDebugPoints){
      this._buildRadialDebugPoints();
    }
    return this._radialDebugPoints || null;
  }

  /**
   * @returns {{gridSize:number,fogSize:number,sdf:Float32Array,shade:Float32Array,fog:Float32Array|null}}
   */
  renderData(){
    return this.sdf.renderData();
  }

  /**
   * @returns {Float32Array}
   */
  regenFromMap(){
    const newAir = this.radial.updateAirFlags(true);
    if (this.mode === "sdf"){
      this.sdf.regenFromMap();
      this._sdfDirty = false;
      this._sdfDirtyFull = false;
    } else {
      this._sdfDirty = true;
      this._sdfDirtyFull = true;
    }
    this._radialDebugDirty = true;
    return newAir;
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
    let newAir;
    if (this.mode === "radial"){
      newAir = this.radial.updateAirFlags(true);
      this._sdfDirty = true;
    } else {
      this.sdf.onMapEdited();
      this._radialDirty = true;
    }
    this._radialDebugDirty = true;
    return newAir;
  }

  /**
   * @param {number} shipX
   * @param {number} shipY
   * @returns {Float32Array|undefined}
   */
  updateFog(shipX, shipY, buildGrid = false){
    if (this.mode !== "sdf"){
      this.radial.updateFog(shipX, shipY);
      if (buildGrid) this.sdf.buildFogFromRadial(this.radial);
      return this.radial.fogAlpha();
    }
    this.sdf.updateFog(shipX, shipY, (x, y) => this.airValueAtWorld(x, y));
    return undefined;
  }

  /**
   * Update fog for current render mode and return radial fog alpha when applicable.
   * @param {number} shipX
   * @param {number} shipY
   * @returns {Float32Array|undefined}
   */
  updateFogForRender(shipX, shipY){
    return this.updateFog(shipX, shipY, false);
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
   * @returns {number}
   */
  fogAlphaAtWorld(x, y){
    return this.radial.fogAlphaAtWorld(x, y);
  }

  /**
   * Find closest point on world
   * Note: Does not work very far from the surface in the "radial" mode
   * @param {number} x
   * @param {number} y
   * @returns {{x:number, y:number}|null}
   */
  posClosest(x, y) {
    const eps = 0.1;

    let dist, gdx, gdy, g;

    if (this.mode === "sdf") {
      dist = this.sdf.sdfValueAtWorld(x, y);
      gdx = (this.sdf.sdfValueAtWorld(x + eps, y) - this.sdf.sdfValueAtWorld(x - eps, y)) / (2 * eps);
      gdy = (this.sdf.sdfValueAtWorld(x, y + eps) - this.sdf.sdfValueAtWorld(x, y - eps)) / (2 * eps);
      g = Math.hypot(gdx, gdy);
      if (g < 0.707) {
        return null;
      }
    } else {
      dist = this.radial.airValueAtWorld(x, y) - 0.5;
      gdx = this.radial.airValueAtWorld(x + eps, y) - this.radial.airValueAtWorld(x - eps, y);
      gdy = this.radial.airValueAtWorld(x, y + eps) - this.radial.airValueAtWorld(x, y - eps);
      g = Math.hypot(gdx, gdy);
      if (g < 1e-4) {
        return null;
      }
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
    const pos = this.posClosest(x, y);
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
      return (this.mode === "sdf")
        ? this.sdfNormalAtWorld(x, y, eps)
        : this.radialNormalAtWorld(x, y, eps);
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
      const dotUp = (px * n.nx + py * n.ny) / (Math.hypot(px, py) * Math.hypot(n.nx, n.ny));
      if (dotUp <= 0.5) return null;
      const qx = px + n.ny * -stepSize;
      const qy = py + n.nx *  stepSize;
      const posNext = this.posClosest(qx, qy);
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
    const n = (this.mode === "sdf")
      ? this.sdfNormalAtWorld(x, y, eps)
      : this.radialNormalAtWorld(x, y, eps);
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
    return this.airValueAtWorld(ax, ay) > 0.5;
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
      const n = (this.mode === "sdf")
        ? this.sdfNormalAtWorld(cx, cy, eps)
        : this.radialNormalAtWorld(cx, cy, eps);
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
   * Normal from SDF gradient.
   * @param {number} x
   * @param {number} y
   * @param {number} eps
   * @returns {{nx:number,ny:number}|null}
   */
  sdfNormalAtWorld(x, y, eps){
    const gdx = this.sdf.sdfValueAtWorld(x + eps, y) - this.sdf.sdfValueAtWorld(x - eps, y);
    const gdy = this.sdf.sdfValueAtWorld(x, y + eps) - this.sdf.sdfValueAtWorld(x, y - eps);
    const len = Math.hypot(gdx, gdy);
    if (len < 1e-6) return null;
    return { nx: gdx / len, ny: gdy / len };
  }

  /**
   * Update renderer resources for current mode (no-op for radial mode).
   * @param {{updateSdfTextures:(sdf:Float32Array, shade:Float32Array)=>void}} renderer
   * @returns {void}
   */
  syncRenderResources(renderer){
    if (this.mode !== "sdf") return;
    const rd = this.renderData();
    renderer.updateSdfTextures(rd.sdf, rd.shade);
  }

  /**
   * Update fog for current mode and push fog resources to renderer.
   * @param {{updateFog:(fog:Float32Array)=>void, updateFogTexture:(fog:Float32Array)=>void}} renderer
   * @param {number} shipX
   * @param {number} shipY
   * @returns {void}
   */
  syncRenderFog(renderer, shipX, shipY){
    if (this.mode !== "sdf"){
      const fog = this.updateFogForRender(shipX, shipY);
      if (fog) renderer.updateFog(fog);
      return;
    }
    this.updateFogForRender(shipX, shipY);
    const fogGrid = this.sdf.renderData().fog;
    if (fogGrid) renderer.updateFogTexture(fogGrid);
  }

  /**
   * Ensure active mode data is up-to-date after deferred edits.
   * @returns {Float32Array|undefined}
   */
  ensureModeUpdated(){
    if (this.mode === "radial"){
      if (!this._radialDirty) return undefined;
      this._radialDirty = false;
      const newAir = this.radial.updateAirFlags(true);
      this._radialDebugDirty = true;
      return newAir;
    }
    if (this._sdfDirtyFull){
      this.sdf.regenFromMap();
    } else if (this._sdfDirty){
      this.sdf.onMapEdited();
    } else {
      return undefined;
    }
    this._sdfDirty = false;
    this._sdfDirtyFull = false;
    return undefined;
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
