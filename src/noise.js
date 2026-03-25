// @ts-check

import { mulberry32 } from "./rng.js";

/** @type {Array<[number, number]>} */
const grad2 = [
  [ 1, 1], [-1, 1], [ 1,-1], [-1,-1],
  [ 1, 0], [-1, 0], [ 1, 0], [-1, 0],
  [ 0, 1], [ 0,-1], [ 0, 1], [ 0,-1],
];

/**
 * @param {number} seed
 * @returns {Uint8Array}
 */
function buildPerm(seed){
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;

  const r = mulberry32(seed);
  for (let i = 255; i > 0; i--){
    const j = (r() * (i + 1)) | 0;
    const tmp = /** @type {number} */ (p[i]);
    p[i] = /** @type {number} */ (p[j]);
    p[j] = tmp;
  }

  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = /** @type {number} */ (p[i & 255]);
  return perm;
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

export class Noise {
  /**
   * Simplex noise generator.
   * @param {number} seed Seed for permutation table.
   */
  constructor(seed){
    /** @type {Uint8Array} */
    this._perm = buildPerm(seed);
  }

  /**
   * @param {number} s
   * @returns {void}
   */
  setSeed(s){
    this._perm = buildPerm(s);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  simplex2(x, y){
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);

    const t = (i + j) * G2;
    const X0 = i - t, Y0 = j - t;
    const x0 = x - X0, y0 = y - Y0;

    let i1, j1;
    if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }

    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2*G2, y2 = y0 - 1 + 2*G2;

    const ii = i & 255, jj = j & 255;

    let n0 = 0, n1 = 0, n2 = 0;

    let t0 = 0.5 - x0*x0 - y0*y0;
    if (t0 > 0) {
      const gi0 = /** @type {number} */ (this._perm[ii + /** @type {number} */ (this._perm[jj])]) % 12;
      const g = /** @type {[number, number]} */ (grad2[gi0]);
      t0 *= t0;
      n0 = t0 * t0 * (g[0]*x0 + g[1]*y0);
    }

    let t1 = 0.5 - x1*x1 - y1*y1;
    if (t1 > 0) {
      const gi1 = /** @type {number} */ (this._perm[ii + i1 + /** @type {number} */ (this._perm[jj + j1])]) % 12;
      const g = /** @type {[number, number]} */ (grad2[gi1]);
      t1 *= t1;
      n1 = t1 * t1 * (g[0]*x1 + g[1]*y1);
    }

    let t2 = 0.5 - x2*x2 - y2*y2;
    if (t2 > 0) {
      const gi2 = /** @type {number} */ (this._perm[ii + 1 + /** @type {number} */ (this._perm[jj + 1])]) % 12;
      const g = /** @type {[number, number]} */ (grad2[gi2]);
      t2 *= t2;
      n2 = t2 * t2 * (g[0]*x2 + g[1]*y2);
    }

    return 70 * (n0 + n1 + n2); // ~[-1,1]
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} [oct]
   * @param {number} [pers]
   * @param {number} [lac]
   * @returns {number}
   */
  fbm(x, y, oct=4, pers=0.55, lac=2.0){
    let amp=1, freq=1, total=0, norm=0;
    for (let o=0;o<oct;o++){
      total += amp * this.simplex2(x*freq, y*freq);
      norm += amp;
      amp *= pers;
      freq *= lac;
    }
    return norm ? total/norm : 0; // ~[-1,1]
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} [oct]
   * @param {number} [pers]
   * @param {number} [lac]
   * @returns {number}
   */
  ridged(x, y, oct=4, pers=0.55, lac=2.0){
    let amp=1, freq=1, total=0, norm=0;
    for (let o=0;o<oct;o++){
      const n = this.simplex2(x*freq, y*freq); // [-1,1]
      let r = 1 - Math.abs(n);           // [0,1]
      r *= r;
      total += amp * r;
      norm += amp;
      amp *= pers;
      freq *= lac;
    }
    return norm ? total/norm : 0; // [0,1]
  }
}

