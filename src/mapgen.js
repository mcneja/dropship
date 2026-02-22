// @ts-check

import { mulberry32 } from "./rng.js";
import { createNoise } from "./noise.js";

/** @typedef {[number, number]} Vec2 */

/**
 * @typedef {Object} MapGrid
 * @property {number} G
 * @property {number} cell
 * @property {number} worldMin
 * @property {number} worldMax
 * @property {number} worldSize
 * @property {number} R2
 * @property {Uint8Array} inside
 * @property {(i:number, j:number) => number} idx
 * @property {(i:number, j:number) => Vec2} toWorld
 * @property {(x:number, y:number) => [number, number]} toGrid
 */

/**
 * @typedef {Object} MapWorld
 * @property {number} seed
 * @property {Uint8Array} air
 * @property {Vec2[]} entrances
 * @property {number} finalAir
 */

/**
 * @param {typeof import("./config.js").CFG} cfg
 */
export function createMapGen(cfg){
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

  /** @type {MapGrid} */
  const grid = { G, cell, worldMin, worldMax, worldSize, R2, inside, idx, toWorld, toGrid };

  const dirs4 = [[1,0],[-1,0],[0,1],[0,-1]];
  const dirs8 = [];
  for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) if (dx||dy) dirs8.push([dx,dy]);

  /**
   * @param {Uint8Array} field
   * @param {number} i
   * @param {number} j
   * @param {number[][]} dirs
   */
  function countN(field, i, j, dirs){
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
   * @param {Uint8Array} field
   * @param {number} iters
   */
  function dilate(field, iters){
    let out = new Uint8Array(field);
    for (let it=0; it<iters; it++){
      const next = new Uint8Array(out);
      for (let j=0;j<G;j++) for (let i=0;i<G;i++){
        const k=idx(i,j);
        if (!inside[k] || out[k]) continue;
        for (const [dx,dy] of dirs4){
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
   */
  function carveDisk(field, cx, cy, radius, val=1){
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
   */
  function floodFromSeeds(field, seeds){
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
      for (const [dx,dy] of dirs4){
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
   */
  function fractionAir(field){
    let ins=0, a=0;
    for (let k=0;k<G*G;k++){
      if (!inside[k]) continue;
      ins++;
      if (field[k]) a++;
    }
    return a/ins;
  }

  const noise = createNoise(cfg.seed);

  /** @type {Float32Array} */
  let wx = new Float32Array(G*G);
  /** @type {Float32Array} */
  let wy = new Float32Array(G*G);
  /** @type {Float32Array} */
  let caveNoise = new Float32Array(G*G);
  /** @type {Float32Array} */
  let veinNoise = new Float32Array(G*G);

  /**
   * @param {number} targetInitialAir
   * @param {() => number} rand
   */
  function buildWorld(targetInitialAir, rand){
    const entrances = [];
    for (let e=0;e<cfg.ENTRANCES;e++){
      const th = (e/cfg.ENTRANCES)*2*Math.PI + (rand()-0.5)*cfg.ENTRANCE_ANGLE_JITTER;
      entrances.push([(cfg.RMAX-0.05)*Math.cos(th), (cfg.RMAX-0.05)*Math.sin(th)]);
    }

    let lo=0, hi=1;
    let air = new Uint8Array(G*G);

    for (let iter=0; iter<20; iter++){
      const mid=(lo+hi)*0.5;
      let ins=0, a=0;
      for (let k=0;k<G*G;k++){
        if (!inside[k]) { air[k]=0; continue; }
        ins++;
        const v = caveNoise[k] > mid ? 1 : 0;
        air[k]=v; a+=v;
      }
      const frac = a/ins;
      if (frac > targetInitialAir) lo = mid; else hi = mid;
    }

    for (let s=0;s<cfg.CA_STEPS;s++){
      const next = new Uint8Array(air);
      for (let j=0;j<G;j++) for (let i=0;i<G;i++){
        const k=idx(i,j);
        if (!inside[k]) continue;
        const n8 = countN(air,i,j,dirs8);
        if (air[k]) next[k] = (n8 >= cfg.AIR_KEEP_N8) ? 1 : 0;
        else        next[k] = (n8 >= cfg.ROCK_TO_AIR_N8) ? 1 : 0;
      }
      air = next;
    }

    let veins = new Uint8Array(G*G);
    for (let j=0;j<G;j++) for (let i=0;i<G;i++){
      const k=idx(i,j);
      if (!inside[k]) continue;
      const [x,y] = toWorld(i,j);
      const r = Math.hypot(x,y) / cfg.RMAX;
      let mid = 1.0 - Math.abs(r - 0.60) / 0.60;
      mid = Math.max(0, Math.min(1, mid));
      if (veinNoise[k] > cfg.VEIN_THRESH && mid > cfg.VEIN_MID_MIN) veins[k]=1;
    }
    veins = dilate(veins, cfg.VEIN_DILATE);
    for (let k=0;k<G*G;k++){
      if (veins[k]) air[k]=0;
    }

    for (const [ex,ey] of entrances){
      carveDisk(air, ex, ey, cfg.ENTRANCE_OUTER, 1);
      carveDisk(air, ex*0.97, ey*0.97, cfg.ENTRANCE_INNER, 1);
    }

    const seeds=[];
    for (const [ex,ey] of entrances){
      const [ix,iy] = toGrid(ex*0.97, ey*0.97);
      for (let dy=-3;dy<=3;dy++) for (let dx=-3;dx<=3;dx++) seeds.push([ix+dx, iy+dy]);
    }
    const vis = floodFromSeeds(air, seeds);
    for (let k=0;k<G*G;k++){
      if (air[k] && !vis[k]) air[k]=0;
    }

    return { air, entrances };
  }

  /** @type {MapWorld} */
  let current = { seed: cfg.seed, air: new Uint8Array(G*G), entrances: [], finalAir: 0 };

  /**
   * @param {number} seed
   * @returns {MapWorld}
   */
  function regenWorld(seed){
    const rand = mulberry32(seed);
    noise.setSeed(seed);

    wx = new Float32Array(G*G);
    wy = new Float32Array(G*G);
    for (let j=0;j<G;j++) for (let i=0;i<G;i++){
      const k=idx(i,j);
      if (!inside[k]) continue;
      const [x,y] = toWorld(i,j);
      wx[k] = noise.fbm(x*cfg.WARP_F, y*cfg.WARP_F, 3, 0.6, 2.0);
      wy[k] = noise.fbm((x+19.3)*cfg.WARP_F, (y-11.7)*cfg.WARP_F, 3, 0.6, 2.0);
    }

    caveNoise = new Float32Array(G*G);
    veinNoise = new Float32Array(G*G);
    for (let j=0;j<G;j++) for (let i=0;i<G;i++){
      const k=idx(i,j);
      if (!inside[k]) continue;
      const [x,y] = toWorld(i,j);
      const xw = x + cfg.WARP_A*wx[k];
      const yw = y + cfg.WARP_A*wy[k];

      const chambers = 0.5 + 0.5*noise.fbm(xw*cfg.BASE_F*0.8, yw*cfg.BASE_F*0.8, 4, 0.55, 2.0);
      const corridors= noise.ridged(xw*cfg.BASE_F*1.35, yw*cfg.BASE_F*1.35, 4, 0.55, 2.05);
      caveNoise[k] = 0.45*chambers + 0.55*corridors;

      veinNoise[k] = noise.ridged(xw*cfg.VEIN_F, yw*cfg.VEIN_F, 3, 0.6, 2.2);
    }

    let best=null, bestDiff=1e9, bestWorld=null;
    for (const g of [0.58,0.60,0.62,0.64,0.66,0.68,0.70]){
      const w=buildWorld(g, rand);
      const frac=fractionAir(w.air);
      const d=Math.abs(frac - cfg.TARGET_FINAL_AIR);
      if (d<bestDiff){ bestDiff=d; best=g; bestWorld=w; }
    }
    for (const delta of [-0.04,-0.03,-0.02,-0.01,0,0.01,0.02,0.03,0.04]){
      const g=best+delta;
      if (g<=0||g>=1) continue;
      const w=buildWorld(g, rand);
      const frac=fractionAir(w.air);
      const d=Math.abs(frac - cfg.TARGET_FINAL_AIR);
      if (d<bestDiff){ bestDiff=d; best=g; bestWorld=w; }
    }

    const finalAir = bestWorld ? fractionAir(bestWorld.air) : 0;
    current = { seed, air: bestWorld ? bestWorld.air : new Uint8Array(G*G), entrances: bestWorld ? bestWorld.entrances : [], finalAir };
    return current;
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  function airBinaryAtWorld(x, y){
    const [i, j] = toGrid(x, y);
    if (i < 0 || i >= G || j < 0 || j >= G) return 1;
    const k = idx(i, j);
    if (!inside[k]) return 1;
    return current.air[k] ? 1 : 0;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {0|1} [val]
   */
  function setAirAtWorld(x, y, val = 1){
    const [i, j] = toGrid(x, y);
    if (i < 0 || i >= G || j < 0 || j >= G) return false;
    const k = idx(i, j);
    if (!inside[k]) return false;
    current.air[k] = val ? 1 : 0;
    return true;
  }

  function getWorld(){
    return current;
  }

  return {
    grid,
    noise,
    regenWorld,
    airBinaryAtWorld,
    setAirAtWorld,
    getWorld,
  };
}
