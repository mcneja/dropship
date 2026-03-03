// @ts-check

/**
 * Planet SDF representation.
 */
export class PlanetSdf {
  /**
   * @param {typeof import("./config.js").CFG} cfg
   * @param {typeof import("./config.js").GAME} game
   * @param {import("./mapgen.js").MapGen} mapgen
   * @param {() => number} getNodeCount
   * @param {(x:number,y:number)=>number} airSampleAtWorld
   */
  constructor(cfg, game, mapgen, getNodeCount, airSampleAtWorld){
    this.cfg = cfg;
    this.game = game;
    this.mapgen = mapgen;
    this._getNodeCount = getNodeCount;
    this._airSampleAtWorld = airSampleAtWorld;

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
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  airValueAtWorld(x, y){
    const sdf = this._sampleLowResSdfAtWorld(x, y);
    return sdf > 0 ? 1 : 0;
  }

  /**
   * Continuous signed distance at world point.
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  sdfValueAtWorld(x, y){
    return this._sampleSdfFullAtWorld(x, y);
  }

  /**
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
   * @returns {Array<[number,number,boolean,number]>}
   */
  debugPoints(){
    return this._sdfDebugPoints || [];
  }

  /**
   * @returns {void}
   */
  regenFromMap(){
    this._rebuildSdfFull();
    this._buildShadeGrid();
    this._sdfSize = this._calcSdfResolution();
    this._sdfRenderSize = this._sdfSize;
    this._buildLowResSdf();
    this._buildLowResShade();
    this._buildSdfDebugPoints();
    this._fogSize = this._calcFogResolution();
  }

  /**
   * @returns {void}
   */
  onMapEdited(){
    this._rebuildSdfFull();
    this._buildLowResSdf();
    this._buildSdfDebugPoints();
    this._fogSize = this._calcFogResolution();
  }

  /**
   * @param {number} shipX
   * @param {number} shipY
   * @param {(x:number,y:number)=>number} airValueAtWorld
   * @returns {void}
   */
  updateFog(shipX, shipY, airValueAtWorld){
    this._updateFogSdf(shipX, shipY, airValueAtWorld);
  }

  /**
   * @param {{fogAlphaAtWorld:(x:number,y:number)=>number}} radial
   * @returns {void}
   */
  buildFogFromRadial(radial){
    const size = this._fogSize || this._sdfSize;
    const scale = Math.max(1, Math.min(4, Math.round(this.cfg.SDF_FOG_SUPERSAMPLE || 1)));
    const sizeHi = size * scale;
    const outHi = new Float32Array(sizeHi * sizeHi);
    const { worldMin, worldSize } = this.mapgen.grid;
    for (let j = 0; j < sizeHi; j++) for (let i = 0; i < sizeHi; i++){
      const x = worldMin + (i + 0.5) * (worldSize / sizeHi);
      const y = worldMin + (j + 0.5) * (worldSize / sizeHi);
      outHi[j * sizeHi + i] = radial.fogAlphaAtWorld(x, y);
    }
    this._fogGrid = (scale > 1) ? this._downsampleSdf(outHi, sizeHi, size) : outHi;
  }

  _shadeGridRender(){
    if (!this._shadeGrid) this._buildShadeGrid();
    if (!this._shadeGridLow || this._shadeGridLow.length === 0) this._buildLowResShade();
    return this._shadeGridLow || new Float32Array(0);
  }

  _sdfGridRender(){
    if (!this._sdfGridLow || this._sdfGridLow.length === 0) this._buildLowResSdf();
    return this._sdfGridLow || new Float32Array(0);
  }

  _sdfDebugPointsRender(){
    return this._sdfDebugPoints || [];
  }

  _getSdfRenderSize(){
    return this._sdfRenderSize || this._sdfSize;
  }

  _fogGridRender(){
    return this._fogGrid;
  }

  _getFogRenderSize(){
    return this._fogSize || this._sdfSize;
  }

  _airAtWorld(x, y){
    if (this._airSampleAtWorld){
      return this._airSampleAtWorld(x, y) > 0.5 ? 1 : 0;
    }
    return this.mapgen.airBinaryAtWorld(x, y);
  }

  _buildAirGridFromSampler(){
    const { G, inside, toWorld } = this.mapgen.grid;
    const out = new Uint8Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
      const k = j * G + i;
      if (!inside[k]) { out[k] = 1; continue; }
      const [x, y] = toWorld(i, j);
      out[k] = this._airAtWorld(x, y) ? 1 : 0;
    }
    return out;
  }

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

  _calcSdfResolution(){
    const nodes = Math.max(0, this._getNodeCount ? this._getNodeCount() : 0);
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

  _calcFogResolution(){
    return this._sdfSize;
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

  _rebuildSdfFull(){
    const { G, inside, cell } = this.mapgen.grid;
    const source = String(this.cfg.SDF_SOURCE || "mapgen");
    const air = (source === "radial") ? this._buildAirGridFromSampler() : this.mapgen.getWorld().air;
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
      const d = Math.max(0, Math.sqrt(isAir ? distToRock[k] : distToAir[k]) - 0.5);
      sdf[k] = (isAir ? 1 : -1) * d * cell;
    }

    this._sdfFull = sdf;
  }

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
      const source = String(this.cfg.SDF_SOURCE || "mapgen");
      const v = (source === "radial") ? (this._airAtWorld(x, y) ? 1 : -1) : this._sampleSdfFullAtWorld(x, y);
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
      const edt1d = (ff, out) => {
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
          out[q] = dx*dx + ff[v[k]];
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
      const d = Math.max(0, Math.sqrt(isAir ? distToRock[k] : distToAir[k]) - 0.5);
      sdfOut[k] = (isAir ? 1 : -1) * d * cell;
    }
    this._sdfGridLow = this._downsampleSdf(sdfOut, H, G);
  }

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

  _updateFogSdf(shipX, shipY, airValueAtWorld){
    const size = this._fogSize || this._sdfSize;
    if (size <= 0) return;
    const scale = Math.max(1, Math.min(4, Math.round(this.cfg.SDF_FOG_SUPERSAMPLE || 1)));
    const sizeHi = size * scale;
    const { worldMin, worldSize } = this.mapgen.grid;
    const r2 = this.game.VIS_RANGE * this.game.VIS_RANGE;
    const step = this.game.VIS_STEP;
    const holdFrames = this.game.FOG_HOLD_FRAMES ?? 4;
    const seenAlpha = this.game.FOG_SEEN_ALPHA ?? 0.55;
    const unseenAlpha = this.game.FOG_UNSEEN_ALPHA ?? 0.85;
    if (!this._fogSeenGrid || this._fogSeenGrid.length !== sizeHi * sizeHi){
      this._fogSeenGrid = new Uint8Array(sizeHi * sizeHi);
      this._fogHoldGrid = new Uint8Array(sizeHi * sizeHi);
    }
    const seen = this._fogSeenGrid;
    const hold = this._fogHoldGrid;
    const outHi = new Float32Array(sizeHi * sizeHi);
    const cell = worldSize / sizeHi;

    for (let j = 0; j < sizeHi; j++) for (let i = 0; i < sizeHi; i++){
      const idx = j * sizeHi + i;
      const x = worldMin + (i + 0.5) * cell;
      const y = worldMin + (j + 0.5) * cell;
      const dx = x - shipX;
      const dy = y - shipY;
      const dist2 = dx * dx + dy * dy;
      let visibleNow = false;
      const targetAir = airValueAtWorld(x, y) > 0.5;
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
          if (airValueAtWorld(px, py) <= 0.5){
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
      outHi[idx] = fog;
    }
    this._fogGrid = (scale > 1) ? this._downsampleSdf(outHi, sizeHi, size) : outHi;
  }

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
