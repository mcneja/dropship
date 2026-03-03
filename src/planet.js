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
    this.sdf.regenFromMap();
    this._radialDebugDirty = true;
    return newAir;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {0|1} [val]
   * @returns {Float32Array}
   */
  applyAirEdit(x, y, radius, val = 1){
    this.mapgen.setAirDisk(x, y, radius, val);
    this.sdf.onMapEdited();
    this._radialDebugDirty = true;
    return this.radial.updateAirFlags(true);
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
    const fog = this.updateFogForRender(shipX, shipY);
    if (fog) renderer.updateFog(fog);
    const fogGrid = this.sdf.renderData().fog;
    if (fogGrid) renderer.updateFogTexture(fogGrid);
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
