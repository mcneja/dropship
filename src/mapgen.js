// @ts-check

import { mulberry32 } from "./rng.js";
import { Noise } from "./noise.js";
import { CFG } from "./config.js";

/** @typedef {import("./types.d.js").Vec2} Vec2 */
/** @typedef {import("./types.d.js").MapWorld} MapWorld */

export class MapGen {
  /**
   * Create a map generator.
   */
  constructor(){
    const G = CFG.GRID;
    const worldMin = -(CFG.RMAX + CFG.PAD);
    const worldMax = +(CFG.RMAX + CFG.PAD);
    const worldSize = worldMax - worldMin;
    const cell = worldSize / G;
    const R2 = CFG.RMAX * CFG.RMAX;

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
    this.noise = new Noise(CFG.seed);

    /** @type {Float32Array} */
    this._wx = new Float32Array(G*G);
    /** @type {Float32Array} */
    this._wy = new Float32Array(G*G);
    /** @type {Float32Array} */
    this._caveNoise = new Float32Array(G*G);
    /** @type {Float32Array} */
    this._veinNoise = new Float32Array(G*G);

    /** @type {MapWorld} */
    this._current = { seed: CFG.seed, air: new Uint8Array(G*G), entrances: [], finalAir: 0 };

    /** @type {Float32Array} */
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
    /** @type {Vec2[]} */
    const entrances = [];
    for (let e=0;e<CFG.ENTRANCES;e++){
      const th = (e/CFG.ENTRANCES)*2*Math.PI + (rand()-0.5)*CFG.ENTRANCE_ANGLE_JITTER;
      entrances.push([(CFG.RMAX-0.05)*Math.cos(th), (CFG.RMAX-0.05)*Math.sin(th)]);
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

    for (let s=0;s<CFG.CA_STEPS;s++){
      /** @type {Uint8Array<ArrayBufferLike>} */
      const next = new Uint8Array(air);
      for (let j=0;j<G;j++) for (let i=0;i<G;i++){
        const k=idx(i,j);
        if (!inside[k]) continue;
        const n8 = this._countN(air,i,j,this._dirs8);
        if (air[k]) next[k] = (n8 >= CFG.AIR_KEEP_N8) ? 1 : 0;
        else        next[k] = (n8 >= CFG.ROCK_TO_AIR_N8) ? 1 : 0;
      }
      air = next;
    }

    /** @type {Uint8Array<ArrayBuffer>} */
    let veins = new Uint8Array(G*G);
    for (let j=0;j<G;j++) for (let i=0;i<G;i++){
      const k=idx(i,j);
      if (!inside[k]) continue;
      const [x,y] = toWorld(i,j);
      const r = Math.hypot(x,y) / CFG.RMAX;
      let mid = 1.0 - Math.abs(r - 0.60) / 0.60;
      mid = Math.max(0, Math.min(1, mid));
      if (this._veinNoise[k] > CFG.VEIN_THRESH && mid > CFG.VEIN_MID_MIN) veins[k]=1;
    }
    veins = this._dilate(veins, CFG.VEIN_DILATE);
    for (let k=0;k<G*G;k++){
      if (veins[k]) air[k]=0;
    }

    for (const [ex,ey] of entrances){
      this._carveDisk(air, ex, ey, CFG.ENTRANCE_OUTER, 1);
      this._carveDisk(air, ex*0.97, ey*0.97, CFG.ENTRANCE_INNER, 1);
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
    const rand = mulberry32(seed);
    this.noise.setSeed(seed);

    this._wx = new Float32Array(G*G);
    this._wy = new Float32Array(G*G);
    for (let j=0;j<G;j++) for (let i=0;i<G;i++){
      const k=idx(i,j);
      if (!inside[k]) continue;
      const [x,y] = toWorld(i,j);
      this._wx[k] = this.noise.fbm(x*CFG.WARP_F, y*CFG.WARP_F, 3, 0.6, 2.0);
      this._wy[k] = this.noise.fbm((x+19.3)*CFG.WARP_F, (y-11.7)*CFG.WARP_F, 3, 0.6, 2.0);
    }

    this._caveNoise = new Float32Array(G*G);
    this._veinNoise = new Float32Array(G*G);
    for (let j=0;j<G;j++) for (let i=0;i<G;i++){
      const k=idx(i,j);
      if (!inside[k]) continue;
      const [x,y] = toWorld(i,j);
      const xw = x + CFG.WARP_A*this._wx[k];
      const yw = y + CFG.WARP_A*this._wy[k];

      const chambers = 0.5 + 0.5*this.noise.fbm(xw*CFG.BASE_F*0.8, yw*CFG.BASE_F*0.8, 4, 0.55, 2.0);
      const corridors= this.noise.ridged(xw*CFG.BASE_F*1.35, yw*CFG.BASE_F*1.35, 4, 0.55, 2.05);
      this._caveNoise[k] = 0.45*chambers + 0.55*corridors;

      this._veinNoise[k] = this.noise.ridged(xw*CFG.VEIN_F, yw*CFG.VEIN_F, 3, 0.6, 2.2);
    }

    /** @type {number} */
    let best=0.6;
    let bestDiff=1e9;
    /** @type {{air:Uint8Array,entrances:Vec2[]}|null} */
    let bestWorld=null;
    for (const g of [0.58,0.60,0.62,0.64,0.66,0.68,0.70]){
      const w=this._buildWorld(g, rand);
      const frac=this._fractionAir(w.air);
      const d=Math.abs(frac - CFG.TARGET_FINAL_AIR);
      if (d<bestDiff){ bestDiff=d; best=g; bestWorld=w; }
    }
    for (const delta of [-0.04,-0.03,-0.02,-0.01,0,0.01,0.02,0.03,0.04]){
      const g=best+delta;
      if (g<=0||g>=1) continue;
      const w=this._buildWorld(g, rand);
      const frac=this._fractionAir(w.air);
      const d=Math.abs(frac - CFG.TARGET_FINAL_AIR);
      if (d<bestDiff){ bestDiff=d; best=g; bestWorld=w; }
    }

    const finalAir = bestWorld ? this._fractionAir(bestWorld.air) : 0;
    this._current = { seed, air: bestWorld ? bestWorld.air : new Uint8Array(G*G), entrances: bestWorld ? bestWorld.entrances : [], finalAir };
    return this._current;
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
