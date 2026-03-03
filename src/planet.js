// @ts-check

import { RingMesh } from "./planet_ring_mesh.js";

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

    this.radial = new RingMesh(cfg, mapgen);
    this.radial.initFog(game);

    /** @type {Float32Array|null} */
    this._shadeGrid = null;
    /** @type {Float32Array|null} */
    this._shadeGridLow = null;
    /** @type {Float32Array|null} */
    this._sdfGridLow = null;
    /** @type {Float32Array|null} */
    this._sdfFull = null;
    /** @type {Float32Array|null} */
    this._fogGrid = null;
    /** @type {number} */
    this._sdfSize = 0;
    /** @type {number} */
    this._sdfRenderSize = 0;
    /** @type {number} */
    this._fogSize = 0;
    /** @type {Uint8Array|null} */
    this._fogSeenGrid = null;
    /** @type {Uint8Array|null} */
    this._fogHoldGrid = null;
    /** @type {Array<[number,number,boolean,number]>|null} */
    this._sdfDebugPoints = null;

    this._sdfSize = this._calcSdfResolution();
    this._sdfRenderSize = this._sdfSize;
    this._buildShadeGrid();
    this._rebuildSdfFull();
    this._buildLowResSdf();
    this._buildLowResShade();
    this._buildSdfDebugPoints();
    this._fogSize = this._calcFogResolution();
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
    const sdf = this._sampleLowResSdfAtWorld(x, y);
    return sdf > 0 ? 1 : 0;
  }

  /**
   * @returns {Float32Array}
   */
  _shadeGridRender(){
    if (!this._shadeGrid) this._buildShadeGrid();
    if (!this._shadeGridLow || this._shadeGridLow.length === 0) this._buildLowResShade();
    return this._shadeGridLow || new Float32Array(0);
  }

  /**
   * @returns {Float32Array}
   */
  _sdfGridRender(){
    if (!this._sdfGridLow || this._sdfGridLow.length === 0) this._buildLowResSdf();
    return this._sdfGridLow || new Float32Array(0);
  }

  /**
   * @returns {Array<[number,number,boolean,number]>}
   */
  _sdfDebugPointsRender(){
    return this._sdfDebugPoints || [];
  }

  /**
   * @returns {number}
   */
  _getSdfRenderSize(){
    return this._sdfRenderSize || this._sdfSize;
  }

  _fogGridRender(){
    return this._fogGrid;
  }

  _getFogRenderSize(){
    return this._fogSize || this._sdfSize;
  }

  /**
   * @returns {Float32Array}
   */
  regenFromMap(){
    this._rebuildSdfFull();
    const newAir = this.radial.updateAirFlags(true);
    this._buildShadeGrid();
    this._sdfSize = this._calcSdfResolution();
    this._sdfRenderSize = this._sdfSize;
    this._buildLowResSdf();
    this._buildLowResShade();
    this._buildSdfDebugPoints();
    this._fogSize = this._calcFogResolution();
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
    this._rebuildSdfFull();
    this._buildLowResSdf();
    this._buildSdfDebugPoints();
    this._fogSize = this._calcFogResolution();
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
      if (buildGrid) this._buildFogGrid();
      return this.radial.fogAlpha();
    }
    this._updateFogSdf(shipX, shipY);
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
   * Render-only data (SDF path). Keeps SDF details inside Planet.
   * @returns {{gridSize:number,fogSize:number,sdf:Float32Array,shade:Float32Array,fog:Float32Array|null}}
   */
  renderData(){
    return {
      gridSize: this._getSdfRenderSize(),
      fogSize: this._getFogRenderSize(),
      sdf: this._sdfGridRender(),
      shade: this._shadeGridRender(),
      fog: this._fogGridRender(),
    };
  }

  /**
   * Update renderer-dependent SDF resources (no-op for radial mode).
   * @param {{updateSdfTextures:(sdf:Float32Array, shade:Float32Array)=>void}} renderer
   * @returns {void}
   */
  syncRenderer(renderer){
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
  syncFog(renderer, shipX, shipY){
    const fog = this.updateFogForRender(shipX, shipY);
    if (fog) renderer.updateFog(fog);
    const fogGrid = this._fogGridRender();
    if (fogGrid) renderer.updateFogTexture(fogGrid);
  }

  /**
   * @returns {Array<[number,number,boolean,number]>|null}
   */
  debugPoints(){
    return this.mode === "sdf" ? this._sdfDebugPointsRender() : null;
  }

  /**
   * @returns {void}
   */
  _buildShadeGrid(){
    const { G, idx, inside, toWorld } = this.mapgen.grid;
    const out = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){
      const k = idx(i, j);
      if (!inside[k]) { out[k] = 0; continue; }
      const [x, y] = toWorld(i, j);
      const n = this.mapgen.noise.fbm(x * 0.16, y * 0.16, 2, 0.6, 2.0);
      out[k] = Math.max(0, Math.min(1, 0.5 + 0.5 * n));
    }
    this._shadeGrid = out;
  }

  /**
   * @returns {number}
   */
  _calcSdfResolution(){
    let nodes = 0;
    for (const ring of this.radial.rings){
      if (ring) nodes += ring.length;
    }
    const r = this.cfg.RMAX;
    const pad = this.cfg.PAD;
    const worldSize = (r + pad) * 2;
    const insideFrac = (Math.PI * r * r) / (worldSize * worldSize);
    const mode = String(this.cfg.SDF_GRID_MODE || "relative");
    const mapG = this.mapgen.grid.G;
    if (mode === "mapgen_full"){
      return mapG;
    }
    if (mode === "absolute"){
      const abs = Math.max(16, Math.floor(this.cfg.SDF_GRID_ABSOLUTE || 0));
      return Math.min(mapG, abs);
    }
    const rel = this.cfg.SDF_GRID_RELATIVE ?? 0.75;
    const targetByNodes = Math.max(32, Math.round(Math.sqrt(nodes / Math.max(insideFrac, 1e-6))));
    const targetByGrid = Math.max(16, Math.round(mapG * rel));
    const clampNodes = (this.cfg.SDF_GRID_CLAMP_TO_NODES !== false);
    const target = clampNodes ? Math.max(16, Math.min(targetByNodes, targetByGrid)) : Math.max(16, targetByGrid);
    return Math.min(mapG, target);
  }

  /**
   * @returns {number}
   */
  _calcFogResolution(){
    const base = Math.max(this._sdfSize, 32);
    return Math.min(this.mapgen.grid.G, base * 2);
  }

  /**
   * Recompute full-res SDF from mapgen air grid (world units).
   * @returns {void}
   */
  _rebuildSdfFull(){
    const { G, inside, cell } = this.mapgen.grid;
    const air = this.mapgen.getWorld().air;
    const size = G * G;
    const INF = 1e12;
    const distToRock = new Float32Array(size);
    const distToAir = new Float32Array(size);

    for (let k = 0; k < size; k++){
      const ins = inside[k];
      const isAir = ins ? (air[k] ? 1 : 0) : 1;
      distToRock[k] = isAir ? INF : 0;
      distToAir[k] = isAir ? 0 : INF;
    }

    const _edt2d = (data) => {
      const tmp = new Float32Array(size);
      const f = new Float32Array(G);
      const d = new Float32Array(G);
      const v = new Int32Array(G);
      const z = new Float32Array(G + 1);

      const edt1d = (ff, out) => {
        let k = 0;
        v[0] = 0;
        z[0] = -INF;
        z[1] = INF;
        for (let q = 1; q < G; q++){
          let s = ((ff[q] + q*q) - (ff[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);
          while (s <= z[k]){
            k--;
            s = ((ff[q] + q*q) - (ff[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);
          }
          k++;
          v[k] = q;
          z[k] = s;
          z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < G; q++){
          while (z[k + 1] < q) k++;
          const dx = q - v[k];
          out[q] = dx*dx + ff[v[k]];
        }
      };

      // pass 1: rows
      for (let y = 0; y < G; y++){
        const base = y * G;
        for (let x = 0; x < G; x++) f[x] = data[base + x];
        edt1d(f, d);
        for (let x = 0; x < G; x++) tmp[base + x] = d[x];
      }
      // pass 2: cols
      for (let x = 0; x < G; x++){
        for (let y = 0; y < G; y++) f[y] = tmp[y * G + x];
        edt1d(f, d);
        for (let y = 0; y < G; y++) data[y * G + x] = d[y];
      }
    };

    _edt2d(distToRock);
    _edt2d(distToAir);

    const sdf = new Float32Array(size);
    for (let k = 0; k < size; k++){
      const ins = inside[k];
      const isAir = ins ? (air[k] ? 1 : 0) : 1;
      const d = isAir ? Math.sqrt(distToRock[k]) : Math.sqrt(distToAir[k]);
      sdf[k] = (isAir ? 1 : -1) * d * cell;
    }

    this._sdfFull = sdf;
  }

  /**
   * Sample signed distance at world point (bilinear).
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  _sampleSdfFullAtWorld(x, y){
    if (!this._sdfFull){
      this._rebuildSdfFull();
    }
    const sdf = this._sdfFull;
    if (!sdf) return 1;
    const { G, worldMin, worldSize } = this.mapgen.grid;
    const u = (x - worldMin) / worldSize;
    const v = (y - worldMin) / worldSize;
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1){
      return 1;
    }
    const gx = u * G - 0.5;
    const gy = v * G - 0.5;
    const x0 = Math.max(0, Math.min(G - 1, Math.floor(gx)));
    const y0 = Math.max(0, Math.min(G - 1, Math.floor(gy)));
    const x1 = Math.max(0, Math.min(G - 1, x0 + 1));
    const y1 = Math.max(0, Math.min(G - 1, y0 + 1));
    const fx = gx - x0;
    const fy = gy - y0;
    const i00 = y0 * G + x0;
    const i10 = y0 * G + x1;
    const i01 = y1 * G + x0;
    const i11 = y1 * G + x1;
    const a = sdf[i00] * (1 - fx) + sdf[i10] * fx;
    const b = sdf[i01] * (1 - fx) + sdf[i11] * fx;
    return a * (1 - fy) + b * fy;
  }

  _downsampleSdf(src, srcSize, dstSize){
    if (srcSize === dstSize) return new Float32Array(src);
    const out = new Float32Array(dstSize * dstSize);
    const scale = srcSize / dstSize;
    for (let j = 0; j < dstSize; j++) for (let i = 0; i < dstSize; i++) {
      const x = (i + 0.5) * scale - 0.5;
      const y = (j + 0.5) * scale - 0.5;
      const x0 = Math.max(0, Math.min(srcSize - 1, Math.floor(x)));
      const y0 = Math.max(0, Math.min(srcSize - 1, Math.floor(y)));
      const x1 = Math.max(0, Math.min(srcSize - 1, x0 + 1));
      const y1 = Math.max(0, Math.min(srcSize - 1, y0 + 1));
      const fx = x - x0;
      const fy = y - y0;
      const i00 = y0 * srcSize + x0;
      const i10 = y0 * srcSize + x1;
      const i01 = y1 * srcSize + x0;
      const i11 = y1 * srcSize + x1;
      const a = src[i00] * (1 - fx) + src[i10] * fx;
      const b = src[i01] * (1 - fx) + src[i11] * fx;
      out[j * dstSize + i] = a * (1 - fy) + b * fy;
    }
    return out;
  }

  /**
   * @returns {void}
   */
  _buildLowResSdf(){
    const { worldMin, worldSize } = this.mapgen.grid;
    const G = this._sdfSize;
    const buildScale = Math.max(1, Math.min(4, Math.round(this.cfg.SDF_BUILD_SUPERSAMPLE || 1)));
    const H = G * buildScale;
    const bin = new Uint8Array(H * H);
    const cell = worldSize / H;
    for (let j = 0; j < H; j++) for (let i = 0; i < H; i++){
      const x = worldMin + (i + 0.5) * (worldSize / H);
      const y = worldMin + (j + 0.5) * (worldSize / H);
      const v = this._sampleSdfFullAtWorld(x, y);
      bin[j * H + i] = v > 0 ? 1 : 0;
    }
    // De-checkerboard: collapse 2x2 alternating patterns using local majority.
    const cur = new Uint8Array(bin);
    for (let j = 0; j < H - 1; j++) for (let i = 0; i < H - 1; i++){
      const i00 = j * H + i;
      const i10 = j * H + i + 1;
      const i01 = (j + 1) * H + i;
      const i11 = (j + 1) * H + i + 1;
      const a = cur[i00], b = cur[i10], c = cur[i01], d = cur[i11];
      const sum = a + b + c + d;
      const checker = (sum === 2) && (a === d) && (b === c) && (a !== b);
      if (!checker) continue;
      // Majority in 3x3 neighborhood (fallback to keep a if tie).
      let count = 0;
      let total = 0;
      for (let dy = -1; dy <= 2; dy++){
        const y = j + dy;
        if (y < 0 || y >= H) continue;
        for (let dx = -1; dx <= 2; dx++){
          const x = i + dx;
          if (x < 0 || x >= H) continue;
          total++;
          if (cur[y * H + x]) count++;
        }
      }
      const next = (count * 2 >= total) ? 1 : 0;
      cur[i00] = next;
      cur[i10] = next;
      cur[i01] = next;
      cur[i11] = next;
    }

    // Recompute low-res SDF from smoothed binary.
    const size = H * H;
    const INF = 1e12;
    const distToRock = new Float32Array(size);
    const distToAir = new Float32Array(size);
    for (let k = 0; k < size; k++){
      const isAir = cur[k] ? 1 : 0;
      distToRock[k] = isAir ? INF : 0;
      distToAir[k] = isAir ? 0 : INF;
    }

    const _edt2d = (data) => {
      const tmp = new Float32Array(size);
      const f = new Float32Array(H);
      const d = new Float32Array(H);
      const v = new Int32Array(H);
      const z = new Float32Array(H + 1);
      const edt1d = (ff, out1d) => {
        let k = 0;
        v[0] = 0;
        z[0] = -INF;
        z[1] = INF;
        for (let q = 1; q < H; q++){
          let s = ((ff[q] + q*q) - (ff[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);
          while (s <= z[k]){
            k--;
            s = ((ff[q] + q*q) - (ff[v[k]] + v[k]*v[k])) / (2*q - 2*v[k]);
          }
          k++;
          v[k] = q;
          z[k] = s;
          z[k + 1] = INF;
        }
        k = 0;
        for (let q = 0; q < H; q++){
          while (z[k + 1] < q) k++;
          const dx = q - v[k];
          out1d[q] = dx*dx + ff[v[k]];
        }
      };
      for (let y = 0; y < H; y++){
        const base = y * H;
        for (let x = 0; x < H; x++) f[x] = data[base + x];
        edt1d(f, d);
        for (let x = 0; x < H; x++) tmp[base + x] = d[x];
      }
      for (let x = 0; x < H; x++){
        for (let y = 0; y < H; y++) f[y] = tmp[y * H + x];
        edt1d(f, d);
        for (let y = 0; y < H; y++) data[y * H + x] = d[y];
      }
    };

    _edt2d(distToRock);
    _edt2d(distToAir);
    const sdfOut = new Float32Array(size);
    for (let k = 0; k < size; k++){
      const isAir = cur[k] ? 1 : 0;
      const d = isAir ? Math.sqrt(distToRock[k]) : Math.sqrt(distToAir[k]);
      sdfOut[k] = (isAir ? 1 : -1) * d * cell;
    }
    this._sdfGridLow = this._downsampleSdf(sdfOut, H, G);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  _sampleLowResSdfAtWorld(x, y){
    const { worldMin, worldSize } = this.mapgen.grid;
    const G = this._sdfSize;
    if (G <= 1 || !this._sdfGridLow) return this._sampleSdfFullAtWorld(x, y);
    const u = (x - worldMin) / worldSize;
    const v = (y - worldMin) / worldSize;
    if (u <= 0 || v <= 0 || u >= 1 || v >= 1){
      return 1;
    }
    const gx = u * G - 0.5;
    const gy = v * G - 0.5;
    const x0 = Math.max(0, Math.min(G - 1, Math.floor(gx)));
    const y0 = Math.max(0, Math.min(G - 1, Math.floor(gy)));
    const x1 = Math.max(0, Math.min(G - 1, x0 + 1));
    const y1 = Math.max(0, Math.min(G - 1, y0 + 1));
    const fx = gx - x0;
    const fy = gy - y0;
    const i00 = y0 * G + x0;
    const i10 = y0 * G + x1;
    const i01 = y1 * G + x0;
    const i11 = y1 * G + x1;
    const a = this._sdfGridLow[i00] * (1 - fx) + this._sdfGridLow[i10] * fx;
    const b = this._sdfGridLow[i01] * (1 - fx) + this._sdfGridLow[i11] * fx;
    return a * (1 - fy) + b * fy;
  }

  /**
   * @returns {void}
   */
  _buildLowResShade(){
    const { worldMin, worldSize } = this.mapgen.grid;
    const G = this._sdfSize;
    const out = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){
      const x = worldMin + (i + 0.5) * (worldSize / G);
      const y = worldMin + (j + 0.5) * (worldSize / G);
      const n = this.mapgen.noise.fbm(x * 0.16, y * 0.16, 2, 0.6, 2.0);
      out[j * G + i] = Math.max(0, Math.min(1, 0.5 + 0.5 * n));
    }
    this._shadeGridLow = out;
  }

  /**
   * @returns {void}
   */
  _buildFogGrid(){
    const size = this._fogSize || this._sdfSize;
    const out = new Float32Array(size * size);
    const { worldMin, worldSize } = this.mapgen.grid;
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++){
      const x = worldMin + (i + 0.5) * (worldSize / size);
      const y = worldMin + (j + 0.5) * (worldSize / size);
      out[j * size + i] = this.radial.fogAlphaAtWorld(x, y);
    }
    this._fogGrid = out;
  }

  /**
   * @param {number} shipX
   * @param {number} shipY
   * @returns {void}
   */
  _updateFogSdf(shipX, shipY){
    const size = this._fogSize || this._sdfSize;
    if (size <= 0) return;
    const { worldMin, worldSize } = this.mapgen.grid;
    const r2 = this.game.VIS_RANGE * this.game.VIS_RANGE;
    const step = this.game.VIS_STEP;
    const holdFrames = this.game.FOG_HOLD_FRAMES ?? 4;
    const seenAlpha = this.game.FOG_SEEN_ALPHA ?? 0.55;
    const unseenAlpha = this.game.FOG_UNSEEN_ALPHA ?? 0.85;
    if (!this._fogSeenGrid || this._fogSeenGrid.length !== size * size){
      this._fogSeenGrid = new Uint8Array(size * size);
      this._fogHoldGrid = new Uint8Array(size * size);
    }
    const seen = this._fogSeenGrid;
    const hold = this._fogHoldGrid;
    const out = new Float32Array(size * size);
    const cell = worldSize / size;

    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++){
      const idx = j * size + i;
      const x = worldMin + (i + 0.5) * cell;
      const y = worldMin + (j + 0.5) * cell;
      const dx = x - shipX;
      const dy = y - shipY;
      const dist2 = dx * dx + dy * dy;
      let visibleNow = false;
      const targetAir = this.airValueAtWorld(x, y) > 0.5;
      if (dist2 <= r2){
        const dist = Math.sqrt(dist2);
        const steps = Math.max(1, Math.ceil(dist / step));
        visibleNow = true;
        for (let s = 1; s <= steps; s++){
          const t = s / steps;
          const px = shipX + dx * t;
          const py = shipY + dy * t;
          if (!targetAir && s === steps){
            continue;
          }
          if (this.airValueAtWorld(px, py) <= 0.5){
            visibleNow = false;
            break;
          }
        }
      }
      if (visibleNow){
        hold[idx] = holdFrames;
        seen[idx] = 1;
      } else if (hold[idx] > 0){
        hold[idx]--;
      }
      let fog = 0;
      if (hold[idx] === 0){
        fog = seen[idx] ? seenAlpha : unseenAlpha;
      }
      out[idx] = fog;
    }
    this._fogGrid = out;
  }

  /**
   * @returns {void}
   */
  _buildSdfDebugPoints(){
    const { worldMin, worldSize, R2 } = this.mapgen.grid;
    const G = this._sdfSize;
    /** @type {Array<[number, number, boolean, number]>} */
    const pts = [];
    const cell = worldSize / G;
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){
      const x = worldMin + (i + 0.5) * cell;
      const y = worldMin + (j + 0.5) * cell;
      if (x * x + y * y > R2) continue;
      const sdf = this._sdfGridLow ? this._sdfGridLow[j * G + i] : this._sampleSdfFullAtWorld(x, y);
      pts.push([x, y, sdf > 0, sdf]);
    }
    this._sdfDebugPoints = pts;
  }
}
