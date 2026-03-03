// @ts-check

import { mulberry32 } from "./rng.js";
import { Noise } from "./noise.js";

/** @typedef {import("./types.d.js").Vec2} Vec2 */
/** @typedef {import("./types.d.js").MapWorld} MapWorld */

export class MapGen {
  /**
   * Create a map generator for the given config.
   * @param {typeof import("./config.js").CFG} cfg Mapgen constants.
   */
  constructor(cfg){
    this.cfg = cfg;
    const G = cfg.GRID;
    const worldMin = -(cfg.RMAX + cfg.PAD);
    const worldMax = +(cfg.RMAX + cfg.PAD);
    const worldSize = worldMax - worldMin;
    const cell = worldSize / G;
    const R2 = cfg.RMAX * cfg.RMAX;

    const inside = new Uint8Array(G*G);
    /** @type {(i:number, j:number) => number} */
    const idx = (i, j) => j*G+i;
    /** @type {(i:number, j:number) => Vec2} */
    const toWorld = (i, j) => [worldMin + (i+0.5)*cell, worldMin + (j+0.5)*cell];
    /** @type {(x:number, y:number) => [number, number]} */
    const toGrid = (x, y) => [Math.floor((x - worldMin) / cell), Math.floor((y - worldMin) / cell)];

    for (let j=0;j<G;j++) for (let i=0;i<G;i++){
      const [x,y] = toWorld(i, j);
      inside[idx(i, j)] = (x*x + y*y <= R2) ? 1 : 0;
    }

    /** @type {{G:number,cell:number,worldMin:number,worldMax:number,worldSize:number,R2:number,inside:Uint8Array,idx:(i:number,j:number)=>number,toWorld:(i:number,j:number)=>Vec2,toGrid:(x:number,y:number)=>[number,number]}} */
    this.grid = { G, cell, worldMin, worldMax, worldSize, R2, inside, idx, toWorld, toGrid };

    this._dirs4 = [[1,0],[-1,0],[0,1],[0,-1]];
    /** @type {Vec2[]} */
    this._dirs8 = [];
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) if (dx||dy) this._dirs8.push([dx,dy]);

    /** @type {Noise} */
    this.noise = new Noise(cfg.seed);

    /** @type {Float32Array} */
    this._wx = new Float32Array(G*G);
    /** @type {Float32Array} */
    this._wy = new Float32Array(G*G);
    /** @type {Float32Array} */
    this._caveNoise = new Float32Array(G*G);
    /** @type {Float32Array} */
    this._veinNoise = new Float32Array(G*G);

    /** @type {MapWorld} */
    this._current = { seed: cfg.seed, air: new Uint8Array(G*G), entrances: [], finalAir: 0 };

    /** @type {Float32Array} */
    this._sdf = new Float32Array(G*G);
  }

  /**
   * @param {Uint8Array} field
   * @param {number} i
   * @param {number} j
   * @param {number[][]} dirs
   * @returns {number}
   */
  _countN(field, i, j, dirs){
    const { G, idx, inside } = this.grid;
    let c=0;
    for (const [dx,dy] of dirs){
      const x=i+dx, y=j+dy;
      if (x<0||x>=G||y<0||y>=G) continue;
      const k=idx(x,y);
      if (inside[k] && field[k]) c++;
    }
    return c;
  }

  /**
   * @param {Uint8Array<ArrayBuffer>} field
   * @param {number} iters
   * @returns {Uint8Array<ArrayBuffer>}
   */
  _dilate(field, iters){
    const { G, idx, inside } = this.grid;
    let out = new Uint8Array(field);
    for (let it=0; it<iters; it++){
      const next = new Uint8Array(out);
      for (let j=0;j<G;j++) for (let i=0;i<G;i++){
        const k=idx(i,j);
        if (!inside[k] || out[k]) continue;
        for (const [dx,dy] of this._dirs4){
          const x=i+dx, y=j+dy;
          if (x<0||x>=G||y<0||y>=G) continue;
          const kk=idx(x,y);
          if (inside[kk] && out[kk]) { next[k]=1; break; }
        }
      }
      out = next;
    }
    return out;
  }

  /**
   * @param {Uint8Array} field
   * @param {number} cx
   * @param {number} cy
   * @param {number} radius
   * @param {0|1} [val]
   * @returns {void}
   */
  _carveDisk(field, cx, cy, radius, val=1){
    const { G, idx, inside, toGrid, toWorld } = this.grid;
    const r2 = radius*radius;
    const [ix0,iy0] = toGrid(cx-radius, cy-radius);
    const [ix1,iy1] = toGrid(cx+radius, cy+radius);
    const x0=Math.max(0,ix0), y0=Math.max(0,iy0);
    const x1=Math.min(G-1,ix1), y1=Math.min(G-1,iy1);
    for (let j=y0;j<=y1;j++) for (let i=x0;i<=x1;i++){
      const k=idx(i,j);
      if (!inside[k]) continue;
      const [x,y] = toWorld(i,j);
      const dx=x-cx, dy=y-cy;
      if (dx*dx+dy*dy <= r2) field[k]=val;
    }
  }

  /**
   * @param {Uint8Array} field
   * @param {Vec2[]} seeds
   * @returns {Uint8Array}
   */
  _floodFromSeeds(field, seeds){
    const { G, idx, inside } = this.grid;
    const vis = new Uint8Array(G*G);
    const qx = new Int32Array(G*G);
    const qy = new Int32Array(G*G);
    let qh=0, qt=0;

    for (const [sx,sy] of seeds){
      if (sx<0||sx>=G||sy<0||sy>=G) continue;
      const k=idx(sx,sy);
      if (!inside[k] || !field[k] || vis[k]) continue;
      vis[k]=1;
      qx[qt]=sx; qy[qt]=sy; qt++;
    }

    while (qh<qt){
      const x=qx[qh], y=qy[qh]; qh++;
      for (const [dx,dy] of this._dirs4){
        const xx=x+dx, yy=y+dy;
        if (xx<0||xx>=G||yy<0||yy>=G) continue;
        const kk=idx(xx,yy);
        if (!inside[kk] || !field[kk] || vis[kk]) continue;
        vis[kk]=1;
        qx[qt]=xx; qy[qt]=yy; qt++;
      }
    }
    return vis;
  }

  /**
   * @param {Uint8Array} field
   * @returns {number}
   */
  _fractionAir(field){
    const { G, inside } = this.grid;
    let ins=0, a=0;
    for (let k=0;k<G*G;k++){
      if (!inside[k]) continue;
      ins++;
      if (field[k]) a++;
    }
    return a/ins;
  }

  /**
   * @param {number} targetInitialAir
   * @param {() => number} rand
   * @returns {{air:Uint8Array<ArrayBufferLike>,entrances:Vec2[]}}
   */
  _buildWorld(targetInitialAir, rand){
    const { G, idx, inside, toWorld, toGrid } = this.grid;
    const cfg = this.cfg;
    /** @type {Vec2[]} */
    const entrances = [];
    for (let e=0;e<cfg.ENTRANCES;e++){
      const th = (e/cfg.ENTRANCES)*2*Math.PI + (rand()-0.5)*cfg.ENTRANCE_ANGLE_JITTER;
      entrances.push([(cfg.RMAX-0.05)*Math.cos(th), (cfg.RMAX-0.05)*Math.sin(th)]);
    }

    let lo=0, hi=1;
    /** @type {Uint8Array<ArrayBufferLike>} */
    let air = new Uint8Array(G*G);

    for (let iter=0; iter<20; iter++){
      const mid=(lo+hi)*0.5;
      let ins=0, a=0;
      for (let k=0;k<G*G;k++){
        if (!inside[k]) { air[k]=0; continue; }
        ins++;
        const v = this._caveNoise[k] > mid ? 1 : 0;
        air[k]=v; a+=v;
      }
      const frac = a/ins;
      if (frac > targetInitialAir) lo = mid; else hi = mid;
    }

    for (let s=0;s<cfg.CA_STEPS;s++){
      /** @type {Uint8Array<ArrayBufferLike>} */
      const next = new Uint8Array(air);
      for (let j=0;j<G;j++) for (let i=0;i<G;i++){
        const k=idx(i,j);
        if (!inside[k]) continue;
        const n8 = this._countN(air,i,j,this._dirs8);
        if (air[k]) next[k] = (n8 >= cfg.AIR_KEEP_N8) ? 1 : 0;
        else        next[k] = (n8 >= cfg.ROCK_TO_AIR_N8) ? 1 : 0;
      }
      air = next;
    }

    /** @type {Uint8Array<ArrayBuffer>} */
    let veins = new Uint8Array(G*G);
    for (let j=0;j<G;j++) for (let i=0;i<G;i++){
      const k=idx(i,j);
      if (!inside[k]) continue;
      const [x,y] = toWorld(i,j);
      const r = Math.hypot(x,y) / cfg.RMAX;
      let mid = 1.0 - Math.abs(r - 0.60) / 0.60;
      mid = Math.max(0, Math.min(1, mid));
      if (this._veinNoise[k] > cfg.VEIN_THRESH && mid > cfg.VEIN_MID_MIN) veins[k]=1;
    }
    veins = this._dilate(veins, cfg.VEIN_DILATE);
    for (let k=0;k<G*G;k++){
      if (veins[k]) air[k]=0;
    }

    for (const [ex,ey] of entrances){
      this._carveDisk(air, ex, ey, cfg.ENTRANCE_OUTER, 1);
      this._carveDisk(air, ex*0.97, ey*0.97, cfg.ENTRANCE_INNER, 1);
    }

    /**@type {Vec2[]} */
    const seeds=[];
    for (const [ex,ey] of entrances){
      const [ix,iy] = toGrid(ex*0.97, ey*0.97);
      for (let dy=-3;dy<=3;dy++) for (let dx=-3;dx<=3;dx++) seeds.push([ix+dx, iy+dy]);
    }
    const vis = this._floodFromSeeds(air, seeds);
    for (let k=0;k<G*G;k++){
      if (air[k] && !vis[k]) air[k]=0;
    }

    return { air, entrances };
  }

  /**
   * @param {number} seed
   * @returns {MapWorld}
   */
  regenWorld(seed){
    const { G, idx, inside, toWorld } = this.grid;
    const cfg = this.cfg;
    const rand = mulberry32(seed);
    this.noise.setSeed(seed);

    this._wx = new Float32Array(G*G);
    this._wy = new Float32Array(G*G);
    for (let j=0;j<G;j++) for (let i=0;i<G;i++){
      const k=idx(i,j);
      if (!inside[k]) continue;
      const [x,y] = toWorld(i,j);
      this._wx[k] = this.noise.fbm(x*cfg.WARP_F, y*cfg.WARP_F, 3, 0.6, 2.0);
      this._wy[k] = this.noise.fbm((x+19.3)*cfg.WARP_F, (y-11.7)*cfg.WARP_F, 3, 0.6, 2.0);
    }

    this._caveNoise = new Float32Array(G*G);
    this._veinNoise = new Float32Array(G*G);
    for (let j=0;j<G;j++) for (let i=0;i<G;i++){
      const k=idx(i,j);
      if (!inside[k]) continue;
      const [x,y] = toWorld(i,j);
      const xw = x + cfg.WARP_A*this._wx[k];
      const yw = y + cfg.WARP_A*this._wy[k];

      const chambers = 0.5 + 0.5*this.noise.fbm(xw*cfg.BASE_F*0.8, yw*cfg.BASE_F*0.8, 4, 0.55, 2.0);
      const corridors= this.noise.ridged(xw*cfg.BASE_F*1.35, yw*cfg.BASE_F*1.35, 4, 0.55, 2.05);
      this._caveNoise[k] = 0.45*chambers + 0.55*corridors;

      this._veinNoise[k] = this.noise.ridged(xw*cfg.VEIN_F, yw*cfg.VEIN_F, 3, 0.6, 2.2);
    }

    /** @type {number} */
    let best=0.6;
    let bestDiff=1e9;
    /** @type {{air:Uint8Array,entrances:Vec2[]}|null} */
    let bestWorld=null;
    for (const g of [0.58,0.60,0.62,0.64,0.66,0.68,0.70]){
      const w=this._buildWorld(g, rand);
      const frac=this._fractionAir(w.air);
      const d=Math.abs(frac - cfg.TARGET_FINAL_AIR);
      if (d<bestDiff){ bestDiff=d; best=g; bestWorld=w; }
    }
    for (const delta of [-0.04,-0.03,-0.02,-0.01,0,0.01,0.02,0.03,0.04]){
      const g=best+delta;
      if (g<=0||g>=1) continue;
      const w=this._buildWorld(g, rand);
      const frac=this._fractionAir(w.air);
      const d=Math.abs(frac - cfg.TARGET_FINAL_AIR);
      if (d<bestDiff){ bestDiff=d; best=g; bestWorld=w; }
    }

    const finalAir = bestWorld ? this._fractionAir(bestWorld.air) : 0;
    this._current = { seed, air: bestWorld ? bestWorld.air : new Uint8Array(G*G), entrances: bestWorld ? bestWorld.entrances : [], finalAir };
    return this._current;
  }

  /**
   * Recompute signed distance field from current air grid.
   * Positive in air, negative in rock. Units are world units.
   * @returns {Float32Array}
   */
  rebuildSdf(){
    const { G, inside, idx, cell } = this.grid;
    const air = this._current.air;
    const size = G * G;
    const INF = 1e12;

    /** @type {Float32Array} */
    const distToRock = new Float32Array(size);
    /** @type {Float32Array} */
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

    for (let k = 0; k < size; k++){
      const ins = inside[k];
      const isAir = ins ? (air[k] ? 1 : 0) : 1;
      const d = isAir ? Math.sqrt(distToRock[k]) : Math.sqrt(distToAir[k]);
      this._sdf[k] = (isAir ? 1 : -1) * d * cell;
    }

    return this._sdf;
  }

  /**
   * Sample signed distance at world point (bilinear).
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  sampleSdfAtWorld(x, y){
    const { G, worldMin, worldSize } = this.grid;
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
    const a = this._sdf[i00] * (1 - fx) + this._sdf[i10] * fx;
    const b = this._sdf[i01] * (1 - fx) + this._sdf[i11] * fx;
    return a * (1 - fy) + b * fy;
  }


  /**
   * @returns {Float32Array}
   */
  getSdfGrid(){
    return this._sdf;
  }

  /**
   * Set air/rock in a disk around world point.
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {0|1} [val]
   * @returns {void}
   */
  setAirDisk(x, y, radius, val = 1){
    this._carveDisk(this._current.air, x, y, radius, val);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {0|1}
   */
  airBinaryAtWorld(x, y){
    const { G, idx, inside, toGrid } = this.grid;
    const [i, j] = toGrid(x, y);
    if (i < 0 || i >= G || j < 0 || j >= G) return 1;
    const k = idx(i, j);
    if (!inside[k]) return 1;
    return this._current.air[k] ? 1 : 0;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {0|1} [val]
   * @returns {boolean}
   */
  setAirAtWorld(x, y, val = 1){
    const { G, idx, inside, toGrid } = this.grid;
    const [i, j] = toGrid(x, y);
    if (i < 0 || i >= G || j < 0 || j >= G) return false;
    const k = idx(i, j);
    if (!inside[k]) return false;
    this._current.air[k] = val ? 1 : 0;
    return true;
  }

  /**
   * @returns {MapWorld}
   */
  getWorld(){
    return this._current;
  }
}
