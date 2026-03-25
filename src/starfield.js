// @ts-check

import { mulberry32 } from "./rng.js";

/**
 * @typedef {Object} StarfieldMesh
 * @property {Float32Array} positions
 * @property {Float32Array} phase
 * @property {Float32Array} rate
 * @property {Float32Array} depth
 * @property {Float32Array} color
 * @property {number} vertCount
 */

/**
 * Build a simple triangle-star field mesh in world space.
 * @param {number} seed
 * @param {{count?:number, span?:number, sizeMin?:number, sizeMax?:number}} [opts]
 * @returns {StarfieldMesh}
 */
export function buildStarfieldMesh(seed, opts = {}){
  const count = Math.max(1, opts.count ?? 420);
  const sizeMin = opts.sizeMin ?? 0.004;
  const sizeMax = opts.sizeMax ?? 0.012;
  const span = opts.span ?? 1.0;

  const rand = mulberry32(seed >>> 0);
  const triVerts = count * 3;

  const positions = new Float32Array(triVerts * 2);
  const phase = new Float32Array(triVerts);
  const rate = new Float32Array(triVerts);
  const depth = new Float32Array(triVerts);
  const color = new Float32Array(triVerts * 3);

  let p = 0;
  /** @type {Array<[number, number, number]>} */
  const palettes = [
    [1.0, 1.0, 1.0],   // white
    [1.0, 0.92, 0.78], // yellow
    [1.0, 0.80, 0.55], // orange
    [1.0, 0.70, 0.70], // red
    [0.70, 0.80, 1.0], // blue
  ];
  for (let i = 0; i < count; i++){
    const x = (rand() * 2 - 1) * span;
    const y = (rand() * 2 - 1) * span;
    const baseSize = sizeMin + rand() * (sizeMax - sizeMin);
    const ang = rand() * Math.PI * 2;
    const d = 0.15 + rand() * 0.85;
    const ph = rand() * Math.PI * 2;
    const tw = 0.6 + rand() * 1.4;

    const size = baseSize * (0.6 + d * 0.7);
    const a0 = ang;
    const a1 = ang + Math.PI * 2 / 3;
    const a2 = ang + Math.PI * 4 / 3;
    const ax = Math.cos(a0) * size;
    const ay = Math.sin(a0) * size;
    const bx = Math.cos(a1) * size;
    const by = Math.sin(a1) * size;
    const cx = Math.cos(a2) * size;
    const cy = Math.sin(a2) * size;

    positions[p + 0] = x + ax;
    positions[p + 1] = y + ay;
    positions[p + 2] = x + bx;
    positions[p + 3] = y + by;
    positions[p + 4] = x + cx;
    positions[p + 5] = y + cy;

    const base = p / 2;
    const palette = /** @type {[number, number, number]} */ (palettes[Math.floor(rand() * palettes.length)]);
    const mixToWhite = 0.55 + rand() * 0.35;
    const cr = palette[0] * (1 - mixToWhite) + mixToWhite;
    const cg = palette[1] * (1 - mixToWhite) + mixToWhite;
    const cb = palette[2] * (1 - mixToWhite) + mixToWhite;
    for (let v = 0; v < 3; v++){
      phase[base + v] = ph;
      rate[base + v] = tw;
      depth[base + v] = d;
      const ci = (base + v) * 3;
      color[ci + 0] = cr;
      color[ci + 1] = cg;
      color[ci + 2] = cb;
    }

    p += 6;
  }

  return { positions, phase, rate, depth, color, vertCount: triVerts };
}

