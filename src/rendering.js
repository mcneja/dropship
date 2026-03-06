// @ts-check

import { CFG, TOUCH_UI } from "./config.js";
import { buildStarfieldMesh } from "./starfield.js";
import { findPathAStar, nearestRadialNode } from "./navigation.js";

/** @typedef {import("./types.d.js").RenderState} RenderState */
/** @typedef {import("./planet.js").Planet} Planet */
/** @typedef {import("./types.d.js").Enemy} Enemy */
/** @typedef {{x:number,y:number,type:import("./types.d.js").EnemyType,vx?:number,vy?:number}} EnemyRender */

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} type
 * @param {string} src
 * @returns {WebGLShader}
 */
function compile(gl, type, src){
  const sh = gl.createShader(type);
  if (!sh) throw new Error("Shader allocation failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(log || "Shader compile failed");
  }
  return sh;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} loc
 * @param {Float32Array|Uint8Array|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array} data
 * @param {number} size
 * @param {number} [type]
 * @returns {WebGLBuffer}
 */
function uploadAttrib(gl, loc, data, size, type=gl.FLOAT){
  const buf = gl.createBuffer();
  if (!buf) throw new Error("Failed to create buffer");
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, type, false, 0, 0);
  return buf;
}

/**
 * @param {Float32Array} src
 * @returns {Uint16Array}
 */
function toHalfFloatArray(src){
  const out = new Uint16Array(src.length);
  const view = new DataView(new ArrayBuffer(4));
  for (let i = 0; i < src.length; i++){
    const f = src[i];
    if (isNaN(f)){
      out[i] = 0x7e00;
      continue;
    }
    if (f === Infinity){
      out[i] = 0x7c00;
      continue;
    }
    if (f === -Infinity){
      out[i] = 0xfc00;
      continue;
    }
    view.setFloat32(0, f, true);
    const x = view.getUint32(0, true);
    const sign = (x >> 31) & 0x1;
    let exp = (x >> 23) & 0xff;
    let mant = x & 0x7fffff;
    let h;
    if (exp === 0){
      h = sign << 15;
    } else if (exp === 0xff){
      h = (sign << 15) | 0x7c00 | (mant ? 0x200 : 0);
    } else {
      exp = exp - 127 + 15;
      if (exp >= 0x1f){
        h = (sign << 15) | 0x7c00;
      } else if (exp <= 0){
        if (exp < -10){
          h = sign << 15;
        } else {
          mant = (mant | 0x800000) >> (1 - exp);
          h = (sign << 15) | ((mant + 0x1000) >> 13);
        }
      } else {
        h = (sign << 15) | (exp << 10) | ((mant + 0x1000) >> 13);
      }
    }
    out[i] = h;
  }
  return out;
}

/**
 * @param {WebGL2RenderingContext} gl
 * @param {number} w
 * @param {number} h
 * @param {number} internalFormat
 * @param {number} format
 * @param {number} type
 * @param {ArrayBufferView|null} data
 * @param {number} [minFilter]
 * @param {number} [magFilter]
 * @returns {WebGLTexture}
 */
function createTexture(gl, w, h, internalFormat, format, type, data, minFilter=gl.NEAREST, magFilter=gl.NEAREST){

  if (type === gl.HALF_FLOAT && data && data instanceof Float32Array){
    data = toHalfFloatArray(data);
  }
  const tex = gl.createTexture();
  if (!tex) throw new Error("Failed to create texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, data);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return tex;
}

function ensureTexData(gl, type, data){
  if (type === gl.HALF_FLOAT && data && data instanceof Float32Array){
    return toHalfFloatArray(data);
  }
  return data;
}

function resampleGrid(src, srcSize, dstSize){
  if (srcSize === dstSize){
    return src;
  }
  const out = new Float32Array(dstSize * dstSize);
  const scale = srcSize / dstSize;
  for (let j = 0; j < dstSize; j++) for (let i = 0; i < dstSize; i++){
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
 * @param {number} x
 * @param {number} y
 * @param {number} a
 * @returns {[number, number]}
 */
function rot2(x, y, a){
  const c = Math.cos(a), s = Math.sin(a);
  return [c*x - s*y, s*x + c*y];
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {void}
 */
function pushTri(pos, col, ax, ay, bx, by, cx, cy, r, g, b, a){
  pos.push(ax, ay, bx, by, cx, cy);
  for (let i = 0; i < 3; i++) col.push(r, g, b, a);
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} cx
 * @param {number} cy
 * @param {[number,number,number,number]} ca
 * @param {[number,number,number,number]} cb
 * @param {[number,number,number,number]} cc
 * @returns {void}
 */
function pushTriColored(pos, col, ax, ay, bx, by, cx, cy, ca, cb, cc){
  pos.push(ax, ay, bx, by, cx, cy);
  col.push(ca[0], ca[1], ca[2], ca[3]);
  col.push(cb[0], cb[1], cb[2], cb[3]);
  col.push(cc[0], cc[1], cc[2], cc[3]);
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {void}
 */
function pushLine(pos, col, ax, ay, bx, by, r, g, b, a){
  pos.push(ax, ay, bx, by);
  col.push(r, g, b, a, r, g, b, a);
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {void}
 */
function pushTriangleOutline(pos, col, ax, ay, bx, by, cx, cy, r, g, b, a){
  pushLine(pos, col, ax, ay, bx, by, r, g, b, a);
  pushLine(pos, col, bx, by, cx, cy, r, g, b, a);
  pushLine(pos, col, cx, cy, ax, ay, r, g, b, a);
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {void}
 */
function pushDiamondOutline(pos, col, x, y, size, r, g, b, a){
  const up = size;
  const right = size;
  const top = [x, y + up];
  const rightP = [x + right, y];
  const bot = [x, y - up];
  const left = [x - right, y];
  pushLine(pos, col, top[0], top[1], rightP[0], rightP[1], r, g, b, a);
  pushLine(pos, col, rightP[0], rightP[1], bot[0], bot[1], r, g, b, a);
  pushLine(pos, col, bot[0], bot[1], left[0], left[1], r, g, b, a);
  pushLine(pos, col, left[0], left[1], top[0], top[1], r, g, b, a);
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {void}
 */
function pushSquareOutline(pos, col, x, y, size, r, g, b, a){
  const s = size;
  const x0 = x - s, x1 = x + s;
  const y0 = y - s, y1 = y + s;
  pushLine(pos, col, x0, y0, x1, y0, r, g, b, a);
  pushLine(pos, col, x1, y0, x1, y1, r, g, b, a);
  pushLine(pos, col, x1, y1, x0, y1, r, g, b, a);
  pushLine(pos, col, x0, y1, x0, y0, r, g, b, a);
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {void}
 */
function pushDiamond(pos, col, x, y, size, r, g, b, a){
  const up = size;
  const right = size;
  pushTri(pos, col, x, y + up, x + right, y, x, y - up, r, g, b, a);
  pushTri(pos, col, x, y - up, x - right, y, x, y + up, r, g, b, a);
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} size
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {void}
 */
function pushSquare(pos, col, x, y, size, r, g, b, a){
  const s = size;
  const x0 = x - s, x1 = x + s;
  const y0 = y - s, y1 = y + s;
  pushTri(pos, col, x0, y0, x1, y0, x1, y1, r, g, b, a);
  pushTri(pos, col, x0, y0, x1, y1, x0, y1, r, g, b, a);
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} rot
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {number}
 */
function pushHexOutline(pos, col, x, y, radius, rot, r, g, b, a){
  const pts = [];
  for (let i = 0; i < 6; i++){
    const ang = rot + (i / 6) * Math.PI * 2;
    pts.push([x + Math.cos(ang) * radius, y + Math.sin(ang) * radius]);
  }
  for (let i = 0; i < 6; i++){
    const p0 = pts[i];
    const p1 = pts[(i + 1) % 6];
    pushLine(pos, col, p0[0], p0[1], p1[0], p1[1], r, g, b, a);
  }
  return 12;
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} sides
 * @param {number} rot
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {number}
 */
function pushPolyFan(pos, col, x, y, radius, sides, rot, r, g, b, a){
  const pts = [];
  for (let i = 0; i < sides; i++){
    const ang = rot + (i / sides) * Math.PI * 2;
    pts.push([x + Math.cos(ang) * radius, y + Math.sin(ang) * radius]);
  }
  for (let i = 0; i < sides; i++){
    const p0 = pts[i];
    const p1 = pts[(i + 1) % sides];
    pushTri(pos, col, x, y, p0[0], p0[1], p1[0], p1[1], r, g, b, a);
  }
  return sides;
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @param {number} [seg]
 * @returns {number}
 */
function pushCircle(pos, col, x, y, radius, r, g, b, a, seg = 24){
  const aStart = 0;
  const x0 = x + Math.cos(aStart) * radius;
  const y0 = y + Math.sin(aStart) * radius;
  let px = x0;
  let py = y0;
  for (let i = 1; i <= seg; i++){
    const ang = (i / seg) * Math.PI * 2;
    const nx = x + Math.cos(ang) * radius;
    const ny = y + Math.sin(ang) * radius;
    pushLine(pos, col, px, py, nx, ny, r, g, b, a);
    px = nx;
    py = ny;
  }
  return seg * 2;
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} jumpCycle
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} scale
 * @param {boolean} [skipHelmet]
 * @param {number} [outlineExpand]
 * @returns {number}
 */
function pushMiner(pos, col, x, y, jumpCycle, r, g, b, scale, skipHelmet = false, outlineExpand = 0){
  const len = Math.hypot(x, y) || 1;
  const upx = x / len;
  const upy = y / len;
  const jumpOffset = 0.5 * jumpCycle * (1 - jumpCycle);
  const tx = -upy;
  const ty = upx;
  const s = scale ?? 1;
  const ox = x + upx * jumpOffset;
  const oy = y + upy * jumpOffset;
  const toWorld = (lx, ly) => [ox + tx * lx + upx * ly, oy + ty * lx + upy * ly];
  let triCount = 0;
  const darken = (v) => Math.max(0, Math.min(1, v * 0.55));
  /** @type {Array<{a:[number,number],b:[number,number],c:[number,number],col:[number,number,number],outline:boolean}>} */
  const tris = [];
  const emitTri = (ax, ay, bx, by, cx, cy, cr, cg, cb, outline = true) => {
    tris.push({ a: [ax, ay], b: [bx, by], c: [cx, cy], col: [cr, cg, cb], outline });
  };
  const quad = (lx0, ly0, lx1, ly1, qr = r, qg = g, qb = b, outline = true) => {
    const [ax, ay] = toWorld(lx0, ly0);
    const [bx, by] = toWorld(lx1, ly0);
    const [cx, cy] = toWorld(lx1, ly1);
    const [dx, dy] = toWorld(lx0, ly1);
    emitTri(ax, ay, bx, by, cx, cy, qr, qg, qb, outline);
    emitTri(ax, ay, cx, cy, dx, dy, qr, qg, qb, outline);
  };

  // Legs: two skinny tris side by side, pointing down
  const legHalfW = 0.028 * s;
  const legBaseY = 0.08 * s;
  const legTipY = -0.08 * s;
  const legCenterOffset = 0.055 * s;
  const legTri = (cx) => {
    const [aX, aY] = toWorld(cx - legHalfW, legBaseY);
    const [bX, bY] = toWorld(cx + legHalfW, legBaseY);
    const [cX, cY] = toWorld(cx, legTipY);
    emitTri(aX, aY, bX, bY, cX, cY, r, g, b);
  };
  legTri(-legCenterOffset);
  legTri(legCenterOffset);

  // Torso square on top of legs
  const torsoHalf = 0.08 * s;
  const torsoBottom = legBaseY;
  const torsoTop = torsoBottom + 2 * torsoHalf;
  quad(-torsoHalf, torsoBottom, torsoHalf, torsoTop);

  // Shoulders: inverted triangle overlapping the torso
  const shoulderBaseY = torsoTop + 0.02 * s;
  const shoulderTipY = torsoTop - 0.06 * s;
  const shoulderHalfW = 0.14 * s;
  {
    const [aX, aY] = toWorld(-shoulderHalfW, shoulderBaseY);
    const [bX, bY] = toWorld(shoulderHalfW, shoulderBaseY);
    const [cX, cY] = toWorld(0, shoulderTipY);
    emitTri(aX, aY, bX, bY, cX, cY, r, g, b);
  }

  // Solid blue square behind the head (shoulder width)
  const headHalf = 0.045 * s;
  const headBottom = shoulderBaseY + 0.01 * s;
  const headTop = headBottom + 2 * headHalf;
  const glassHalf = shoulderHalfW * 0.85;
  const glassBottom = shoulderBaseY - 0.005 * s;
  const glassTop = headTop + 0.06 * s;
  if (!skipHelmet){
    const br = 0.25, bg = 0.55, bb = 1.0;
    quad(-glassHalf, glassBottom, glassHalf, glassTop, br, bg, bb, false);

    // Head square above shoulders
    quad(-headHalf, headBottom, headHalf, headTop);
  }
  if (tris.length){
    if (outlineExpand > 0){
      for (const t of tris){
        if (!t.outline) continue;
        const ax = t.a[0], ay = t.a[1];
        const bx = t.b[0], by = t.b[1];
        const cx = t.c[0], cy = t.c[1];
        const cxm = (ax + bx + cx) / 3;
        const cym = (ay + by + cy) / 3;
        const da = Math.hypot(ax - cxm, ay - cym);
        const db = Math.hypot(bx - cxm, by - cym);
        const dc = Math.hypot(cx - cxm, cy - cym);
        const maxd = Math.max(da, db, dc);
        if (maxd > 1e-6){
          const ab = Math.hypot(ax - bx, ay - by);
          const bc = Math.hypot(bx - cx, by - cy);
          const ca = Math.hypot(cx - ax, cy - ay);
          const minEdge = Math.max(1e-6, Math.min(ab, bc, ca));
          const effExpand = Math.min(outlineExpand, minEdge * 0.35);
          const scaleO = (maxd + effExpand) / maxd;
          const sax = cxm + (ax - cxm) * scaleO;
          const say = cym + (ay - cym) * scaleO;
          const sbx = cxm + (bx - cxm) * scaleO;
          const sby = cym + (by - cym) * scaleO;
          const scx = cxm + (cx - cxm) * scaleO;
          const scy = cym + (cy - cym) * scaleO;
          pushTri(pos, col, sax, say, sbx, sby, scx, scy, darken(t.col[0]), darken(t.col[1]), darken(t.col[2]), 1);
          triCount += 1;
        }
      }
    }
    for (const t of tris){
      pushTri(pos, col, t.a[0], t.a[1], t.b[0], t.b[1], t.c[0], t.c[1], t.col[0], t.col[1], t.col[2], 1);
      triCount += 1;
    }
  }
  return triCount;
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {EnemyRender} enemy
 * @param {[number,number,number]} baseColor
 * @param {number} scale
 * @param {number} alpha
 * @param {boolean} useGradient
 * @param {number} [outlineExpand]
 * @returns {number}
 */
function pushEnemyShape(pos, col, enemy, baseColor, scale, alpha, useGradient, outlineExpand = 0){
  const { x, y } = enemy;
  const len = Math.hypot(x, y) || 1;
  let upx = x / len;
  let upy = y / len;
  if (enemy.type === "hunter"){
    const vlen = Math.hypot(enemy.vx || 0, enemy.vy || 0);
    if (vlen > 1e-4){
      upx = (enemy.vx || 0) / vlen;
      upy = (enemy.vy || 0) / vlen;
    }
  }
  const tx = -upy;
  const ty = upx;
  const r = baseColor[0];
  const g = baseColor[1];
  const b = baseColor[2];
  const bright = [Math.min(1, r + 0.3), Math.min(1, g + 0.3), Math.min(1, b + 0.3), alpha];
  const dark = [r * 0.55, g * 0.55, b * 0.55, alpha];
  const mid = [r * 0.85, g * 0.85, b * 0.85, alpha];
  const toWorld = (lx, ly) => [x + tx * lx + upx * ly, y + ty * lx + upy * ly];
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const colorFor = (ly) => {
    const t = clamp01((ly / (scale || 1)) * 0.5 + 0.5);
    return /** @type {[number,number,number,number]} */ ([
      dark[0] + (bright[0] - dark[0]) * t,
      dark[1] + (bright[1] - dark[1]) * t,
      dark[2] + (bright[2] - dark[2]) * t,
      alpha,
    ]);
  };
  const tri = (ax, ay, bx, by, cx, cy) => {
    if (outlineExpand > 0){
      const cxm = (ax + bx + cx) / 3;
      const cym = (ay + by + cy) / 3;
      const da = Math.hypot(ax - cxm, ay - cym);
      const db = Math.hypot(bx - cxm, by - cym);
      const dc = Math.hypot(cx - cxm, cy - cym);
      const maxd = Math.max(da, db, dc);
      if (maxd > 1e-6){
        const scaleO = (maxd + outlineExpand) / maxd;
        ax = cxm + (ax - cxm) * scaleO;
        ay = cym + (ay - cym) * scaleO;
        bx = cxm + (bx - cxm) * scaleO;
        by = cym + (by - cym) * scaleO;
        cx = cxm + (cx - cxm) * scaleO;
        cy = cym + (cy - cym) * scaleO;
      }
    }
    const [axw, ayw] = toWorld(ax, ay);
    const [bxw, byw] = toWorld(bx, by);
    const [cxw, cyw] = toWorld(cx, cy);
    if (useGradient){
      const ca = colorFor(ay);
      const cb = colorFor(by);
      const cc = colorFor(cy);
      pushTriColored(pos, col, axw, ayw, bxw, byw, cxw, cyw, ca, cb, cc);
    } else {
      pushTri(pos, col, axw, ayw, bxw, byw, cxw, cyw, r, g, b, alpha);
    }
  };

  let triCount = 0;
  const s = scale;
  if (enemy.type === "hunter"){
    const topY = 1.1 * s;
    const baseY = -0.55 * s;
    const halfW = 0.8 * s;
    tri(0, topY, -halfW, baseY, halfW, baseY);
    const scale2 = 0.62;
    const offsetY = -0.64 * s;
    tri(0, topY * scale2 + offsetY, -halfW * scale2, baseY * scale2 + offsetY, halfW * scale2, baseY * scale2 + offsetY);
    triCount += 2;
  } else if (enemy.type === "ranger"){
    const ds = 0.8;
    const halfW = 0.75 * s * ds;
    const halfH = 1.05 * s * ds;
    const cxOff = halfW * 0.5;
    const diamond = (cx) => {
      tri(cx, halfH, cx + halfW, 0, cx, -halfH);
      tri(cx, -halfH, cx - halfW, 0, cx, halfH);
    };
    diamond(-cxOff);
    diamond(cxOff);
    triCount += 4;
  } else if (enemy.type === "crawler"){
      const tNow = performance.now() * 0.001;
      const spin = tNow * 1.6;
      const spikeLen = 1.05 * s;
      const spikeW = 0.28 * s;
      const spikeBack = 0.35 * s;
      for (let i = 0; i < 4; i++){
        const a = spin + i * Math.PI * 0.5;
        const [tx1, ty1] = rot2(0, spikeLen, a);
        const [tx2, ty2] = rot2(-spikeW, -spikeBack, a);
        const [tx3, ty3] = rot2(spikeW, -spikeBack, a);
        tri(tx1, ty1, tx2, ty2, tx3, ty3);
      }
      triCount += 4;
    } else if (enemy.type === "turret"){
    // Two legs (downward triangles) + turret head
    tri(-0.7 * s, 0.3 * s, 0.0 * s, 0.3 * s, -0.35 * s, -0.75 * s);
    tri(0.0 * s, 0.3 * s, 0.7 * s, 0.3 * s, 0.35 * s, -0.75 * s);
    tri(0, 0.05 * s, 0.6 * s, 0.55 * s, -0.6 * s, 0.55 * s);
    triCount += 3;
  } else {
    // Orbiting turret: same body as turret, but legs angle out and point down
    tri(-0.75 * s, 0.3 * s, 0.0 * s, 0.3 * s, -1.05 * s, -0.95 * s);
    tri(0.0 * s, 0.3 * s, 0.75 * s, 0.3 * s, 1.05 * s, -0.95 * s);
    tri(0, 0.05 * s, 0.6 * s, 0.55 * s, -0.6 * s, 0.55 * s);
    triCount += 3;
  }
  return triCount;
}

/**
 * Scale to apply to current velocity to represent distance required to come to a stop.
 * @param {Planet} planet
 * @param {number} x 
 * @param {number} y 
 * @param {number} vx 
 * @param {number} vy 
 * @param {number} thrust 
 * @returns {number}
 */
function vScaleStopping(planet, x, y, vx, vy, thrust) {
  const {x: gx, y: gy} = planet.gravityAt(x, y);
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-6) {
    return 0;
  }
  const deceleration = thrust - (gx * vx + gy * vy) / speed;
  const dt = speed / deceleration;
  const dist = 0.5 * Math.abs(deceleration) * dt * dt;
  return dist / speed;
}

/**
 * @param {Renderer} renderer
 * @param {RenderState} state
 * @param {Planet} planet
 * @returns {void}
 */
function drawFrameImpl(renderer, state, planet){
  const {
    gl, canvas, game, prog, oprog, vao, oVao, uScale, uCam, uRot, uFog,
    uRockDark, uRockLight, uSurfaceRockDark, uSurfaceRockLight,
      uAirDark, uAirLight, uSurfaceBand, uRmax, uMeshRmax,
    ouScale, ouCam, ouRot, oPos, oCol,
    starProg, starVao, starRot, starTime, starAspect, starSpan, starSaturation,
    starVertCount,
  } = renderer;
  const vertCount = renderer.vertCount;
  renderer.resize();

  gl.viewport(0,0,canvas.width,canvas.height);
  gl.clearColor(0,0,0,1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const camRot = state.view.angle;

  const s = 1 / state.view.radius;
  let sx, sy;
  if (canvas.width > canvas.height) {
    sy = s;
    sx = s * canvas.height / canvas.width;
  } else {
    sx = s;
    sy = s * canvas.width / canvas.height;
  }
  if (starProg && starVao && starVertCount){
    gl.useProgram(starProg);
    gl.bindVertexArray(starVao);
    const aspect = canvas.width / Math.max(1, canvas.height);
    const span = Math.max(aspect, 1 / aspect) * 1.15;
    if (starRot) gl.uniform1f(starRot, camRot);
    if (starAspect){
      const ax = aspect >= 1 ? 1 / aspect : 1;
      const ay = aspect >= 1 ? 1 : aspect;
      gl.uniform2f(starAspect, ax, ay);
    }
    if (starSpan) gl.uniform1f(starSpan, span);
    if (starSaturation) gl.uniform1f(starSaturation, CFG.STAR_SATURATION ?? 1.0);
    if (starTime) gl.uniform1f(starTime, performance.now() * 0.001);
    gl.drawArrays(gl.TRIANGLES, 0, starVertCount);
    gl.bindVertexArray(null);
  }
  gl.useProgram(prog);
  gl.bindVertexArray(vao);
  gl.uniform2f(uScale, sx, sy);
  gl.uniform2f(uCam, state.view.xCenter, state.view.yCenter);
  gl.uniform1f(uRot, camRot);
  gl.uniform1f(uFog, state.fogEnabled ? 1 : 0);
  const palette = state.planetPalette || null;
  const rockDark = (palette && palette.rockDark) ? palette.rockDark : CFG.ROCK_DARK;
  const rockLight = (palette && palette.rockLight) ? palette.rockLight : CFG.ROCK_LIGHT;
  const airDark = (palette && palette.airDark) ? palette.airDark : CFG.AIR_DARK;
  const airLight = (palette && palette.airLight) ? palette.airLight : CFG.AIR_LIGHT;
  const surfaceRockDark = (palette && palette.surfaceRockDark) ? palette.surfaceRockDark : rockDark;
  const surfaceRockLight = (palette && palette.surfaceRockLight) ? palette.surfaceRockLight : rockLight;
  const band = (palette && typeof palette.surfaceBand === "number") ? palette.surfaceBand : 0;
  if (uRockDark) gl.uniform3fv(uRockDark, rockDark);
  if (uRockLight) gl.uniform3fv(uRockLight, rockLight);
  if (uSurfaceRockDark) gl.uniform3fv(uSurfaceRockDark, surfaceRockDark);
  if (uSurfaceRockLight) gl.uniform3fv(uSurfaceRockLight, surfaceRockLight);
  if (uAirDark) gl.uniform3fv(uAirDark, airDark);
  if (uAirLight) gl.uniform3fv(uAirLight, airLight);
  if (uSurfaceBand) gl.uniform1f(uSurfaceBand, band);
  const params = planet.getPlanetParams ? planet.getPlanetParams() : null;
  const rMax = (params && params.RMAX) ? params.RMAX : CFG.RMAX;
    if (uRmax) gl.uniform1f(uRmax, rMax);
    if (uMeshRmax) gl.uniform1f(uMeshRmax, planet.radial ? (planet.radial.rings.length - 1) : rMax);
  if (renderer.uMaxR) gl.uniform1f(renderer.uMaxR, rMax + 0.5);
  gl.drawArrays(gl.TRIANGLES, 0, vertCount);
  gl.bindVertexArray(null);

  const shipHWorld = 0.7 * game.SHIP_SCALE;
  const shipWWorld = 0.75 * game.SHIP_SCALE;
  const bodyLiftN = 0.18;
  const skiLiftN = 0.0;
  const cabinSide = state.ship.cabinSide || 1;

  /** @type {number[]} */
  const pos = [];
  /** @type {number[]} */
  const col = [];
  let triVerts = 0;
  let lineVerts = 0;
  let pointVerts = 0;

  const shipRot = -Math.atan2(state.ship.x, state.ship.y || 1e-6);
  const lighten = (c) => Math.min(1, c + 0.3);
  const rockPoint = [1.0, 0.55, 0.12];
  const airPoint = [lighten(airLight[0]), lighten(airLight[1]), lighten(airLight[2])];
  const now = performance.now() * 0.001;
  const toShipWorldLocal = (lx, ly) => {
    const [wx, wy] = rot2(lx, ly, shipRot);
    return [state.ship.x + wx, state.ship.y + wy];
  };
  // Normalized ship-local coords: x,y in [-0.5..0.5], liftN in ship heights.
  const L = (x, y, liftN = 0) => {
    return toShipWorldLocal(x * shipWWorld, (y + liftN) * shipHWorld);
  };
  const shipOutlineSize = 1/16;
  /** @type {Array<{a:[number,number],b:[number,number],c:[number,number],col:[number,number,number,number],outline?:boolean}>} */
  const shipTris = [];
  /** @type {Array<{a:[number,number],b:[number,number],c:[number,number],col:[number,number,number,number],outline?:boolean}>} */
  const gunTris = [];
  /** @type {Array<{a:[number,number],b:[number,number],c:[number,number],col:[number,number,number,number],outline?:boolean}>} */
  const windowTris = [];
  const upLen = Math.hypot(state.ship.x, state.ship.y) || 1;
  const upx = state.ship.x / upLen;
  const upy = state.ship.y / upLen;
  const topY = (0.6 + bodyLiftN) * shipHWorld;
  const bottomY = (-0.6 + bodyLiftN) * shipHWorld;
  const silverTop = [0.85, 0.87, 0.9];
  const silverBottom = [0.55, 0.58, 0.62];
  const addTri = (list, ax, ay, bx, by, cx, cy, cr, cg, cb, ca = 1, outline = true) => {
    list.push({
      a: [ax, ay],
      b: [bx, by],
      c: [cx, cy],
      col: [cr, cg, cb, ca],
      outline,
    });
  };
  const addShipTri = (list, ax, ay, bx, by, cx, cy, ly, outline = true) => {
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    const localY = ly ?? ((mx - state.ship.x) * upx + (my - state.ship.y) * upy);
    const t = Math.max(0, Math.min(1, (localY - bottomY) / Math.max(1e-6, topY - bottomY)));
    const cr = silverBottom[0] + (silverTop[0] - silverBottom[0]) * t;
    const cg = silverBottom[1] + (silverTop[1] - silverBottom[1]) * t;
    const cb = silverBottom[2] + (silverTop[2] - silverBottom[2]) * t;
    addTri(list, ax, ay, bx, by, cx, cy, cr, cg, cb, 1, outline);
  };
  const appendShipGeometry = () => {
    if (state.ship.state === "crashed") return;
    {
      const cargoTopN = 0.18;
      const cargoBottomN = -0.35;
      const bottomHalfW = 0.85;
      const topHalfW = 0.6;
      const lb = L(-bottomHalfW, cargoBottomN, bodyLiftN);
      const rb = L(bottomHalfW, cargoBottomN, bodyLiftN);
      const rt = L(topHalfW, cargoTopN, bodyLiftN);
      const lt = L(-topHalfW, cargoTopN, bodyLiftN);
      addShipTri(shipTris, lb[0], lb[1], rb[0], rb[1], rt[0], rt[1]);
      addShipTri(shipTris, lb[0], lb[1], rt[0], rt[1], lt[0], lt[1]);

      const cabOffset = 0.75 * cabinSide;
      const cabHalfW = 0.28;
      const cabBaseY = cargoBottomN;
      const cabTipY = cargoTopN;
      const cabTip = L(cabOffset, cabTipY, bodyLiftN);
      const cabBL = L(cabOffset - cabHalfW, cabBaseY, bodyLiftN);
      const cabBR = L(cabOffset + cabHalfW, cabBaseY, bodyLiftN);
      addShipTri(shipTris, cabBL[0], cabBL[1], cabBR[0], cabBR[1], cabTip[0], cabTip[1]);

      const winHalfW = cabHalfW * 0.5;
      const winBaseY = cabBaseY + (cabTipY - cabBaseY) * 0.25;
      const winTipY = cabBaseY + (cabTipY - cabBaseY) * 0.8;
      const winTip = L(cabOffset, winTipY, bodyLiftN);
      const winBL = L(cabOffset - winHalfW, winBaseY, bodyLiftN);
      const winBR = L(cabOffset + winHalfW, winBaseY, bodyLiftN);
      addTri(windowTris, winBL[0], winBL[1], winBR[0], winBR[1], winTip[0], winTip[1], 0.05, 0.05, 0.05, 1, false);

      const gunLen = shipHWorld * 1.05;
      const gunHalfW = shipWWorld * 0.09;
      const mountOffset = gunLen * 0.25;
      const [mountCx, mountCy] = L(0, cargoTopN + 0.12 + 0.04, bodyLiftN);
      let dirx = 0;
      let diry = 0;
      if (state.aimWorld){
        const ao = state.aimOrigin || state.ship;
        dirx = state.aimWorld.x - ao.x;
        diry = state.aimWorld.y - ao.y;
        const dlen = Math.hypot(dirx, diry);
        if (dlen > 1e-4){
          dirx /= dlen;
          diry /= dlen;
        } else {
          dirx = cabinSide;
          diry = 0;
        }
      } else if (state.ship.state === "landed"){
        const rightx = upy;
        const righty = -upx;
        dirx = rightx * cabinSide;
        diry = righty * cabinSide;
      } else {
        const r = Math.hypot(state.ship.x, state.ship.y) || 1;
        dirx = state.ship.x / r;
        diry = state.ship.y / r;
      }
      const px = -diry;
      const py = dirx;
      const gmx = mountCx;
      const gmy = mountCy;
      const backCx = gmx - dirx * mountOffset;
      const backCy = gmy - diry * mountOffset;
      const frontCx = backCx + dirx * gunLen;
      const frontCy = backCy + diry * gunLen;
      const backL = [backCx + px * gunHalfW, backCy + py * gunHalfW];
      const backR = [backCx - px * gunHalfW, backCy - py * gunHalfW];
      const frontL = [frontCx + px * gunHalfW, frontCy + py * gunHalfW];
      const frontR = [frontCx - px * gunHalfW, frontCy - py * gunHalfW];
      addShipTri(gunTris, backL[0], backL[1], backR[0], backR[1], frontR[0], frontR[1], undefined, true);
      addShipTri(gunTris, backL[0], backL[1], frontR[0], frontR[1], frontL[0], frontL[1], undefined, true);
      // Gun strut (vertical post from cargo top to pivot)
      const gstrutW = 0.05;
      const gsb0 = L(-gstrutW, cargoTopN, bodyLiftN);
      const gsb1 = L(gstrutW, cargoTopN, bodyLiftN);
      const gst0 = L(-gstrutW, cargoTopN + 0.12, bodyLiftN);
      const gst1 = L(gstrutW, cargoTopN + 0.12, bodyLiftN);
      addShipTri(shipTris, gsb0[0], gsb0[1], gsb1[0], gsb1[1], gst1[0], gst1[1], undefined, false);
      addShipTri(shipTris, gsb0[0], gsb0[1], gst1[0], gst1[1], gst0[0], gst0[1], undefined, false);

      // Landing skis under cargo
      const skiY0 = cargoBottomN;
      const skiY1 = skiY0 + 0.05;
      const skiHalfW = 0.2;
      const skiOffset = 0.32;
      const skiL0 = L(-skiOffset - skiHalfW, skiY0, skiLiftN);
      const skiL1 = L(-skiOffset + skiHalfW, skiY0, skiLiftN);
      const skiL2 = L(-skiOffset + skiHalfW, skiY1, skiLiftN);
      const skiL3 = L(-skiOffset - skiHalfW, skiY1, skiLiftN);
      addShipTri(shipTris, skiL0[0], skiL0[1], skiL1[0], skiL1[1], skiL2[0], skiL2[1]);
      addShipTri(shipTris, skiL0[0], skiL0[1], skiL2[0], skiL2[1], skiL3[0], skiL3[1]);
      const skiR0 = L(skiOffset - skiHalfW, skiY0, skiLiftN);
      const skiR1 = L(skiOffset + skiHalfW, skiY0, skiLiftN);
      const skiR2 = L(skiOffset + skiHalfW, skiY1, skiLiftN);
      const skiR3 = L(skiOffset - skiHalfW, skiY1, skiLiftN);
      addShipTri(shipTris, skiR0[0], skiR0[1], skiR1[0], skiR1[1], skiR2[0], skiR2[1]);
      addShipTri(shipTris, skiR0[0], skiR0[1], skiR2[0], skiR2[1], skiR3[0], skiR3[1]);
      // Ski struts
      const strutW = 0.05;
      const strutTop = cargoBottomN;
      const strutBot = skiY1 + 0.01;
      const sL0 = L(-skiOffset - strutW, strutBot, skiLiftN);
      const sL1 = L(-skiOffset + strutW, strutBot, skiLiftN);
      const sL2 = L(-skiOffset + strutW, strutTop, bodyLiftN);
      const sL3 = L(-skiOffset - strutW, strutTop, bodyLiftN);
      addShipTri(shipTris, sL0[0], sL0[1], sL1[0], sL1[1], sL2[0], sL2[1], undefined, false);
      addShipTri(shipTris, sL0[0], sL0[1], sL2[0], sL2[1], sL3[0], sL3[1], undefined, false);
      const sR0 = L(skiOffset - strutW, strutBot, skiLiftN);
      const sR1 = L(skiOffset + strutW, strutBot, skiLiftN);
      const sR2 = L(skiOffset + strutW, strutTop, bodyLiftN);
      const sR3 = L(skiOffset - strutW, strutTop, bodyLiftN);
      addShipTri(shipTris, sR0[0], sR0[1], sR1[0], sR1[1], sR2[0], sR2[1], undefined, false);
      addShipTri(shipTris, sR0[0], sR0[1], sR2[0], sR2[1], sR3[0], sR3[1], undefined, false);
    }
  };

  if (state.enemies && state.enemies.length){
    const tNow = performance.now() * 0.001;
    const outlineSize = 1/16;
    for (const enemy of state.enemies){
      if (state.fogEnabled && !planet.fogSeenAt(enemy.x, enemy.y)) continue;
      /** @type {EnemyRender} */
      const enemyRender = enemy;
      /** @type {[number,number,number]} */
      let base;
      if (enemy.type === "hunter"){
        base = [0.92, 0.25, 0.2];
      } else if (enemy.type === "ranger"){
        base = [0.2, 0.75, 0.95];
      } else if (enemy.type === "crawler") {
        base = [0.95, 0.55, 0.2];
      } else {
        base = [0.5, 0.125, 1.0];
      }
      const outline = /** @type {[number,number,number]} */ ([base[0] * 0.55, base[1] * 0.55, base[2] * 0.55]);
      triVerts += pushEnemyShape(pos, col, enemyRender, outline, game.ENEMY_SCALE, 1, false, outlineSize) * 3;
      triVerts += pushEnemyShape(pos, col, enemyRender, base, game.ENEMY_SCALE, 1, true) * 3;
      if (enemy.hitT && enemy.hitT > 0){
        const pulse = 0.5 + 0.5 * Math.sin(tNow * 14.0);
        const alpha = 0.25 + pulse * 0.45;
        triVerts += pushEnemyShape(pos, col, enemyRender, [1.0, 0.2, 0.2], game.ENEMY_SCALE * 1.08, alpha, false) * 3;
      }
    }
  }


  if (state.mothership){
    const m = state.mothership;
    const c = Math.cos(m.angle);
    const s3 = Math.sin(m.angle);
    const points = m.renderPoints || m.points;
    const tris = m.renderTris || m.tris;
    const drawTri = (tri, isWall) => {
      const a = points[tri[0]];
      const b = points[tri[1]];
      const d = points[tri[2]];
      const ax = m.x + c * a.x - s3 * a.y;
      const ay = m.y + s3 * a.x + c * a.y;
      const bx = m.x + c * b.x - s3 * b.y;
      const by = m.y + s3 * b.x + c * b.y;
      const cx = m.x + c * d.x - s3 * d.y;
      const cy = m.y + s3 * d.x + c * d.y;
      if (isWall){
        pushTri(pos, col, ax, ay, bx, by, cx, cy, 0.78, 0.78, 0.78, 0.98);
      } else {
        pushTri(pos, col, ax, ay, bx, by, cx, cy, 0.20, 0.20, 0.20, 0.98);
      }
      triVerts += 3;
    };
    const triIsWall = (tri, idx) => {
      if (m.triAir && idx < m.triAir.length){
        return m.triAir[idx] <= 0.5;
      }
      const a = points[tri[0]];
      const b = points[tri[1]];
      const d = points[tri[2]];
      const aAir = ("air" in a) ? a.air : 1;
      const bAir = ("air" in b) ? b.air : 1;
      const cAir = ("air" in d) ? d.air : 1;
      return (aAir + bAir + cAir) / 3 <= 0.5;
    };
    for (let i = 0; i < tris.length; i++){
      const tri = tris[i];
      if (!triIsWall(tri, i)) drawTri(tri, false);
    }
    for (let i = 0; i < tris.length; i++){
      const tri = tris[i];
      if (triIsWall(tri, i)) drawTri(tri, true);
    }
  }

  appendShipGeometry();
  if (shipTris.length){
    for (const t of shipTris){
      if (!t.outline) continue;
      const ax = t.a[0], ay = t.a[1];
      const bx = t.b[0], by = t.b[1];
      const cx = t.c[0], cy = t.c[1];
      const cxm = (ax + bx + cx) / 3;
      const cym = (ay + by + cy) / 3;
      const da = Math.hypot(ax - cxm, ay - cym);
      const db = Math.hypot(bx - cxm, by - cym);
      const dc = Math.hypot(cx - cxm, cy - cym);
      const maxd = Math.max(da, db, dc);
      const scaleO = maxd > 1e-6 ? (maxd + shipOutlineSize) / maxd : 1;
      const sax = cxm + (ax - cxm) * scaleO;
      const say = cym + (ay - cym) * scaleO;
      const sbx = cxm + (bx - cxm) * scaleO;
      const sby = cym + (by - cym) * scaleO;
      const scx = cxm + (cx - cxm) * scaleO;
      const scy = cym + (cy - cym) * scaleO;
      pushTri(pos, col, sax, say, sbx, sby, scx, scy, t.col[0] * 0.55, t.col[1] * 0.55, t.col[2] * 0.55, t.col[3]);
      triVerts += 3;
    }
    for (const t of shipTris){
      pushTri(pos, col, t.a[0], t.a[1], t.b[0], t.b[1], t.c[0], t.c[1], t.col[0], t.col[1], t.col[2], t.col[3]);
      triVerts += 3;
    }
  }
  if (windowTris.length){
    for (const t of windowTris){
      pushTri(pos, col, t.a[0], t.a[1], t.b[0], t.b[1], t.c[0], t.c[1], t.col[0], t.col[1], t.col[2], t.col[3]);
      triVerts += 3;
    }
  }
  if (gunTris.length){
    for (const t of gunTris){
      if (!t.outline) continue;
      const ax = t.a[0], ay = t.a[1];
      const bx = t.b[0], by = t.b[1];
      const cx = t.c[0], cy = t.c[1];
      const cxm = (ax + bx + cx) / 3;
      const cym = (ay + by + cy) / 3;
      const da = Math.hypot(ax - cxm, ay - cym);
      const db = Math.hypot(bx - cxm, by - cym);
      const dc = Math.hypot(cx - cxm, cy - cym);
      const maxd = Math.max(da, db, dc);
      const scaleO = maxd > 1e-6 ? (maxd + shipOutlineSize) / maxd : 1;
      const sax = cxm + (ax - cxm) * scaleO;
      const say = cym + (ay - cym) * scaleO;
      const sbx = cxm + (bx - cxm) * scaleO;
      const sby = cym + (by - cym) * scaleO;
      const scx = cxm + (cx - cxm) * scaleO;
      const scy = cym + (cy - cym) * scaleO;
      pushTri(pos, col, sax, say, sbx, sby, scx, scy, t.col[0] * 0.55, t.col[1] * 0.55, t.col[2] * 0.55, t.col[3]);
      triVerts += 3;
    }
    for (const t of gunTris){
      pushTri(pos, col, t.a[0], t.a[1], t.b[0], t.b[1], t.c[0], t.c[1], t.col[0], t.col[1], t.col[2], t.col[3]);
      triVerts += 3;
    }
  }

  if (state.miners && state.miners.length){
    for (const miner of state.miners){
      if (miner.state === "boarded") continue;
      if (state.fogEnabled && !planet.fogSeenAt(miner.x, miner.y)) continue;
      if (miner.state === "running"){
        triVerts += pushMiner(pos, col, miner.x, miner.y, miner.jumpCycle, 0.98, 0.62, 0.2, game.MINER_SCALE, false, 1/16) * 3;
      } else {
        triVerts += pushMiner(pos, col, miner.x, miner.y, miner.jumpCycle, 0.98, 0.85, 0.25, game.MINER_SCALE, false, 1/16) * 3;
      }
    }
  }

  if (state.shots && state.shots.length){
    const size = 0.10;
    for (const s of state.shots){
      if (s.owner === "hunter") pushDiamond(pos, col, s.x, s.y, size, 1.0, 0.35, 0.3, 0.9);
      else if (s.owner === "ranger") pushDiamond(pos, col, s.x, s.y, size, 0.3, 0.8, 1.0, 0.9);
      else pushDiamond(pos, col, s.x, s.y, size, 0.5, 0.125, 1.0, 0.9);
      triVerts += 6;
    }
  }

  if (state.playerShots && state.playerShots.length){
    const size = 0.11;
    for (const s of state.playerShots){
      pushDiamond(pos, col, s.x, s.y, size, 0.95, 0.95, 0.95, 0.95);
      triVerts += 6;
    }
  }

  if (state.playerBombs && state.playerBombs.length){
    const size = 0.13;
    for (const b of state.playerBombs){
      pushSquare(pos, col, b.x, b.y, size, 1.0, 0.7, 0.2, 0.95);
      triVerts += 6;
    }
  }

  const featureParticles = state.featureParticles || null;
  const lavaParticles = featureParticles ? featureParticles.lava : null;
  if (lavaParticles && lavaParticles.length){
    const size = 0.10;
    for (const p of lavaParticles){
      pushDiamond(pos, col, p.x, p.y, size, 1.0, 0.25, 0.15, 0.95);
      triVerts += 6;
    }
  }
  const mushroomParticles = featureParticles ? featureParticles.mushroom : null;
  if (mushroomParticles && mushroomParticles.length){
    const size = 0.12;
    for (const p of mushroomParticles){
      pushDiamond(pos, col, p.x, p.y, size, 0.95, 0.45, 0.75, 0.95);
      triVerts += 6;
    }
  }

  const coreR = planet.getCoreRadius ? planet.getCoreRadius() : 0;
  if (coreR > 0){
    const r0 = coreR;
    const r1 = coreR + 0.8;
    triVerts += pushPolyFan(pos, col, 0, 0, r1, 28, 0, 1.0, 0.25, 0.12, 0.35) * 3;
    triVerts += pushPolyFan(pos, col, 0, 0, r0, 28, 0, 1.0, 0.45, 0.20, 0.85) * 3;
  }

  const props = planet.props;
  if (props && props.length){
    const basisAt = (x, y) => {
      const len = Math.hypot(x, y) || 1;
      const ux = x / len;
      const uy = y / len;
      const tx = -uy;
      const ty = ux;
      return { ux, uy, tx, ty };
    };
    const toWorld = (x, y, tx, ty, ux, uy, lx, ly) => {
      return [x + tx * lx + ux * ly, y + ty * lx + uy * ly];
    };
    for (const p of props){
      if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
      if (!planet.fogSeenAt(p.x, p.y)) continue;
      if (p.type === "bubble_hex") continue;
      const rot = (p.rot || 0) + (p.rotSpeed ? p.rotSpeed * now : 0);
      const s = p.scale || 1;
      if (p.type === "turret_pad"){
        let ux, uy, tx, ty;
        if (typeof p.padNx === "number" && typeof p.padNy === "number"){
          ux = p.padNx;
          uy = p.padNy;
        } else {
          const info = planet.surfaceInfoAtWorld ? planet.surfaceInfoAtWorld(p.x, p.y, 0.18) : null;
          if (info){
            ux = info.nx;
            uy = info.ny;
          }
        }
        if (ux !== undefined && uy !== undefined){
          tx = -uy;
          ty = ux;
        } else {
          ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
        }
        const halfW = 0.55 * s;
        const halfH = 0.12 * s;
          const sink = halfH;
          const cx = p.x - ux * sink;
          const cy = p.y - uy * sink;
          const a0 = toWorld(cx, cy, tx, ty, ux, uy, -halfW, -halfH);
          const a1 = toWorld(cx, cy, tx, ty, ux, uy, halfW, -halfH);
          const a2 = toWorld(cx, cy, tx, ty, ux, uy, halfW, halfH);
          const a3 = toWorld(cx, cy, tx, ty, ux, uy, -halfW, halfH);
        pushTri(pos, col, a0[0], a0[1], a1[0], a1[1], a2[0], a2[1], 0.28, 0.28, 0.30, 0.95);
        pushTri(pos, col, a0[0], a0[1], a2[0], a2[1], a3[0], a3[1], 0.28, 0.28, 0.30, 0.95);
        triVerts += 6;
      } else if (p.type === "boulder"){
        triVerts += pushPolyFan(pos, col, p.x, p.y, 0.3 * s, 7, rot, 0.45, 0.45, 0.48, 0.95) * 3;
        triVerts += pushPolyFan(pos, col, p.x, p.y, 0.18 * s, 7, rot, 0.35, 0.35, 0.37, 0.95) * 3;
      } else if (p.type === "ridge_spike"){
        const { ux, uy, tx, ty } = basisAt(p.x, p.y);
        const tip = toWorld(p.x, p.y, tx, ty, ux, uy, 0, 0.6 * s);
        const bl = toWorld(p.x, p.y, tx, ty, ux, uy, -0.18 * s, -0.1 * s);
        const br = toWorld(p.x, p.y, tx, ty, ux, uy, 0.18 * s, -0.1 * s);
        pushTri(pos, col, bl[0], bl[1], br[0], br[1], tip[0], tip[1], 0.4, 0.4, 0.42, 0.95);
        triVerts += 3;
      } else if (p.type === "vent"){
        const heat = p.ventHeat ? Math.max(0, Math.min(1, p.ventHeat)) : 0;
        const cr = 0.6 + heat * 0.4;
        const cg = 0.2 + heat * 0.05;
        const cb = 0.1 + heat * 0.05;
        triVerts += pushPolyFan(pos, col, p.x, p.y, 0.28 * s, 8, rot, cr, cg, cb, 0.95) * 3;
        triVerts += pushPolyFan(pos, col, p.x, p.y, 0.16 * s, 8, rot, 0.2 + heat * 0.5, 0.05, 0.05, 0.95) * 3;
      } else if (p.type === "ice_shard"){
        let ux, uy, tx, ty;
        const info = planet.surfaceInfoAtWorld ? planet.surfaceInfoAtWorld(p.x, p.y, 0.18) : null;
        if (info){
          ux = info.nx;
          uy = info.ny;
          tx = -uy;
          ty = ux;
        } else {
          ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
        }
        const tip = toWorld(p.x, p.y, tx, ty, ux, uy, 0, 0.7 * s);
        const bl = toWorld(p.x, p.y, tx, ty, ux, uy, -0.14 * s, -0.05 * s);
        const br = toWorld(p.x, p.y, tx, ty, ux, uy, 0.14 * s, -0.05 * s);
        pushTri(pos, col, bl[0], bl[1], br[0], br[1], tip[0], tip[1], 0.75, 0.9, 1.0, 0.95);
        triVerts += 3;
      } else if (p.type === "tree"){
        const { ux, uy, tx, ty } = basisAt(p.x, p.y);
        const t0 = toWorld(p.x, p.y, tx, ty, ux, uy, -0.06 * s, -0.02 * s);
        const t1 = toWorld(p.x, p.y, tx, ty, ux, uy, 0.06 * s, -0.02 * s);
        const t2 = toWorld(p.x, p.y, tx, ty, ux, uy, 0.06 * s, 0.28 * s);
        const t3 = toWorld(p.x, p.y, tx, ty, ux, uy, -0.06 * s, 0.28 * s);
        pushTri(pos, col, t0[0], t0[1], t1[0], t1[1], t2[0], t2[1], 0.45, 0.3, 0.18, 0.95);
        pushTri(pos, col, t0[0], t0[1], t2[0], t2[1], t3[0], t3[1], 0.45, 0.3, 0.18, 0.95);
        triVerts += 6;
        const tip = toWorld(p.x, p.y, tx, ty, ux, uy, 0, 0.75 * s);
        const bl = toWorld(p.x, p.y, tx, ty, ux, uy, -0.3 * s, 0.22 * s);
        const br = toWorld(p.x, p.y, tx, ty, ux, uy, 0.3 * s, 0.22 * s);
        pushTri(pos, col, bl[0], bl[1], br[0], br[1], tip[0], tip[1], 0.25, 0.65, 0.25, 0.95);
        triVerts += 3;
      } else if (p.type === "mushroom"){
        const { ux, uy, tx, ty } = basisAt(p.x, p.y);
        const st0 = toWorld(p.x, p.y, tx, ty, ux, uy, -0.05 * s, 0);
        const st1 = toWorld(p.x, p.y, tx, ty, ux, uy, 0.05 * s, 0);
        const st2 = toWorld(p.x, p.y, tx, ty, ux, uy, 0.05 * s, 0.22 * s);
        const st3 = toWorld(p.x, p.y, tx, ty, ux, uy, -0.05 * s, 0.22 * s);
        pushTri(pos, col, st0[0], st0[1], st1[0], st1[1], st2[0], st2[1], 0.9, 0.7, 0.9, 0.95);
        pushTri(pos, col, st0[0], st0[1], st2[0], st2[1], st3[0], st3[1], 0.9, 0.7, 0.9, 0.95);
        triVerts += 6;
        const capL = toWorld(p.x, p.y, tx, ty, ux, uy, -0.26 * s, 0.28 * s);
        const capR = toWorld(p.x, p.y, tx, ty, ux, uy, 0.26 * s, 0.28 * s);
        const capT = toWorld(p.x, p.y, tx, ty, ux, uy, 0, 0.48 * s);
        pushTri(pos, col, capL[0], capL[1], capR[0], capR[1], capT[0], capT[1], 0.95, 0.35, 0.75, 0.95);
        triVerts += 3;
      } else if (p.type === "stalactite"){
        const { ux, uy, tx, ty } = basisAt(p.x, p.y);
        const tip = toWorld(p.x, p.y, tx, ty, ux, uy, 0, -0.6 * s);
        const bl = toWorld(p.x, p.y, tx, ty, ux, uy, -0.18 * s, 0.1 * s);
        const br = toWorld(p.x, p.y, tx, ty, ux, uy, 0.18 * s, 0.1 * s);
        pushTri(pos, col, bl[0], bl[1], br[0], br[1], tip[0], tip[1], 0.45, 0.45, 0.5, 0.95);
        triVerts += 3;
      } else if (p.type === "gate"){
        const { ux, uy, tx, ty } = basisAt(p.x, p.y);
        const w = 0.35 * s;
        const h = 0.4 * s;
        const a0 = toWorld(p.x, p.y, tx, ty, ux, uy, -w, 0);
        const a1 = toWorld(p.x, p.y, tx, ty, ux, uy, -w * 0.6, h);
        const a2 = toWorld(p.x, p.y, tx, ty, ux, uy, w * 0.6, h);
        const a3 = toWorld(p.x, p.y, tx, ty, ux, uy, w, 0);
        pushTri(pos, col, a0[0], a0[1], a1[0], a1[1], a2[0], a2[1], 0.35, 0.35, 0.38, 0.95);
        pushTri(pos, col, a0[0], a0[1], a2[0], a2[1], a3[0], a3[1], 0.35, 0.35, 0.38, 0.95);
        triVerts += 6;
      } else if (p.type === "factory"){
        const { ux, uy, tx, ty } = basisAt(p.x, p.y);
        const w = 0.35 * s;
        const h = 0.3 * s;
        const b0 = toWorld(p.x, p.y, tx, ty, ux, uy, -w, 0);
        const b1 = toWorld(p.x, p.y, tx, ty, ux, uy, w, 0);
        const b2 = toWorld(p.x, p.y, tx, ty, ux, uy, w, h);
        const b3 = toWorld(p.x, p.y, tx, ty, ux, uy, -w, h);
        pushTri(pos, col, b0[0], b0[1], b1[0], b1[1], b2[0], b2[1], 0.28, 0.28, 0.32, 0.95);
        pushTri(pos, col, b0[0], b0[1], b2[0], b2[1], b3[0], b3[1], 0.28, 0.28, 0.32, 0.95);
        triVerts += 6;
      }
    }
  }

  // Triangles end here. Lock the triangle vertex count to buffer length.
  triVerts = pos.length / 2;

  /**
   * @param {number} dx
   * @param {number} dy
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @param {number} [extraOffset]
   */
  const thrustV = (dx, dy, r, g, b, extraOffset = 0) => {
    const mag = Math.hypot(dx, dy) || 1;
    const posUx = -dx / mag;
    const posUy = -dy / mag;
    const ux = dx / mag;
    const uy = dy / mag;
    const len = shipHWorld * 0.28;
    const spread = shipHWorld * 0.12;
    const px = -uy;
    const py = ux;
    const offset = shipHWorld * 0.72 + extraOffset;
    const tipx = ux * len;
    const tipy = uy * len;
    const b1x = -ux * len * 0.45 + px * spread;
    const b1y = -uy * len * 0.45 + py * spread;
    const b2x = -ux * len * 0.45 - px * spread;
    const b2y = -uy * len * 0.45 - py * spread;
    const [tx, ty] = rot2(tipx + posUx * offset, tipy + posUy * offset, shipRot);
    const [p1x, p1y] = rot2(b1x + posUx * offset, b1y + posUy * offset, shipRot);
    const [p2x, p2y] = rot2(b2x + posUx * offset, b2y + posUy * offset, shipRot);
    pushLine(pos, col, state.ship.x + p1x, state.ship.y + p1y, state.ship.x + tx, state.ship.y + ty, r, g, b, 1);
    pushLine(pos, col, state.ship.x + p2x, state.ship.y + p2y, state.ship.x + tx, state.ship.y + ty, r, g, b, 1);
    lineVerts += 4;
  };

  if (state.ship.state !== "crashed"){
    const tc = [1.0, 0.55, 0.15];
    if (state.input.thrust) thrustV(0, 1, tc[0], tc[1], tc[2], shipHWorld * 0.2);
    if (state.input.down) thrustV(0, -1, tc[0], tc[1], tc[2], shipHWorld * 0.35);
    if (state.input.left) thrustV(-1, 0, tc[0], tc[1], tc[2], shipWWorld * 0.5);
    if (state.input.right) thrustV(1, 0, tc[0], tc[1], tc[2], shipWWorld * 0.5);
  }

  if (state.ship.state === "flying"){
    // Braking line
    const vscale = vScaleStopping(planet, state.ship.x, state.ship.y, state.ship.vx, state.ship.vy, game.THRUST);
    pushLine(pos, col, state.ship.x, state.ship.y, state.ship.x + state.ship.vx * vscale, state.ship.y + state.ship.vy * vscale, 0.5, 0.84, 1.0, 0.5);
    lineVerts += 2;

    // Orbit apogee and perigee
    const {rPerigee: rPerigee, rApogee: rApogee} = planet.perigeeAndApogee(state.ship.x, state.ship.y, state.ship.vx, state.ship.vy);
    const rMin = rMax + 0.5;
    if (rPerigee >= rMin) {
      const r = Math.hypot(state.ship.x, state.ship.y);
      const dirX = state.ship.x / r;
      const dirY = state.ship.y / r;

      const crossTickSize = 0.01 * state.view.radius;
      const crossX = -dirY * crossTickSize;
      const crossY = dirX * crossTickSize;

      const apoX = dirX * rApogee;
      const apoY = dirY * rApogee;

      const periX = dirX * rPerigee;
      const periY = dirY * rPerigee;

      pushLine(pos, col, apoX - crossX, apoY - crossY, apoX + crossX, apoY + crossY, 0.5, 0.84, 1.0, 0.5);
      pushLine(pos, col, periX - crossX, periY - crossY, periX + crossX, periY + crossY, 0.5, 0.84, 1.0, 0.5);
      pushLine(pos, col, apoX, apoY, periX, periY, 0.5, 0.84, 1.0, 0.5);
      lineVerts += 6;
    }
  }

  if (state.aimWorld){
    const ao = state.aimOrigin || state.ship;
    pushLine(pos, col, ao.x, ao.y, state.aimWorld.x, state.aimWorld.y, 0.85, 0.9, 1.0, 0.65);
    lineVerts += 2;
  }

  if (state.ship.state === "crashed"){
    const t = state.ship.explodeT;
    const radius = shipHWorld * (0.6 + t * 1.6);
    const alpha = Math.max(0, 1 - t);
    const seg = 28;
    for (let i = 0; i < seg; i++){
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const r0 = radius * (0.85 + 0.2 * Math.sin(t * 8 + i));
      const r1 = radius * (0.85 + 0.2 * Math.sin(t * 8 + i + 1));
      const x0 = state.ship.x + Math.cos(a0) * r0;
      const y0 = state.ship.y + Math.sin(a0) * r0;
      const x1 = state.ship.x + Math.cos(a1) * r1;
      const y1 = state.ship.y + Math.sin(a1) * r1;
      pushLine(pos, col, x0, y0, x1, y1, 1.0, 0.72, 0.3, 0.9 * alpha);
      lineVerts += 2;
    }
    pushLine(pos, col, state.ship.x - radius * 0.7, state.ship.y, state.ship.x + radius * 0.7, state.ship.y, 1.0, 0.85, 0.4, 0.6 * alpha);
    pushLine(pos, col, state.ship.x, state.ship.y - radius * 0.7, state.ship.x, state.ship.y + radius * 0.7, 1.0, 0.85, 0.4, 0.6 * alpha);
    lineVerts += 4;
  }

  if (state.debris.length){
    for (const d of state.debris){
      const len = shipHWorld * 0.18;
      const hx = Math.cos(d.a) * len;
      const hy = Math.sin(d.a) * len;
      pushLine(pos, col, d.x - hx, d.y - hy, d.x + hx, d.y + hy, 0.9, 0.9, 0.9, 0.9);
      lineVerts += 2;
    }
  }

    if (state.enemyDebris && state.enemyDebris.length){
      for (const d of state.enemyDebris){
        const len = 0.2 * game.ENEMY_SCALE;
        const hx = Math.cos(d.a) * len;
        const hy = Math.sin(d.a) * len;
        pushLine(pos, col, d.x - hx, d.y - hy, d.x + hx, d.y + hy, 1.0, 0.5, 0.2, 0.9);
        lineVerts += 2;
      }
    }

  if (state.explosions && state.explosions.length){
    for (const ex of state.explosions){
      const t = Math.max(0, Math.min(1, ex.life / 0.5));
      const r = 0.35 + (1 - t) * 0.6;
      const colr = ex.owner === "crawler" ? [1.0, 0.7, 0.2] : [1.0, 0.5, 0.3];
      pushLine(pos, col, ex.x - r, ex.y, ex.x + r, ex.y, colr[0], colr[1], colr[2], 0.8 * t);
      pushLine(pos, col, ex.x, ex.y - r, ex.x, ex.y + r, colr[0], colr[1], colr[2], 0.8 * t);
      lineVerts += 4;
    }
  }

  if (state.entityExplosions && state.entityExplosions.length){
    for (const ex of state.entityExplosions){
      const t = Math.max(0, Math.min(1, ex.life / 0.8));
      const r = (ex.radius ?? 1.0) * (0.4 + (1 - t) * 0.9);
      const alpha = 0.9 * t;
      const seg = 18;
      for (let i = 0; i < seg; i++){
        const a0 = (i / seg) * Math.PI * 2;
        const a1 = ((i + 1) / seg) * Math.PI * 2;
        const r0 = r * (0.85 + 0.2 * Math.sin(t * 8 + i));
        const r1 = r * (0.85 + 0.2 * Math.sin(t * 8 + i + 1));
        const x0 = ex.x + Math.cos(a0) * r0;
        const y0 = ex.y + Math.sin(a0) * r0;
        const x1 = ex.x + Math.cos(a1) * r1;
        const y1 = ex.y + Math.sin(a1) * r1;
        pushLine(pos, col, x0, y0, x1, y1, 1.0, 0.9, 0.4, alpha);
        lineVerts += 2;
      }
      pushLine(pos, col, ex.x - r * 0.6, ex.y, ex.x + r * 0.6, ex.y, 1.0, 0.95, 0.6, 0.7 * alpha);
      pushLine(pos, col, ex.x, ex.y - r * 0.6, ex.x, ex.y + r * 0.6, 1.0, 0.95, 0.6, 0.7 * alpha);
      lineVerts += 4;
    }
  }

  if (props && props.length){
    for (const p of props){
      if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
      if (p.type !== "bubble_hex") continue;
      if (!planet.fogSeenAt(p.x, p.y)) continue;
      const rot = (p.rot || 0) + (p.rotSpeed ? p.rotSpeed * now : 0);
      const s = p.scale || 1;
      pushHexOutline(pos, col, p.x, p.y, 0.28 * s, rot, 0.6, 0.95, 1.0, 0.6);
      lineVerts += 12;
    }
  }

  // Lines end here. Lock the line vertex count to buffer length.
  lineVerts = pos.length / 2 - triVerts;

  const dbgSamples = state.debugCollisionSamples || state.ship._samples;
  if (state.debugCollisions && dbgSamples){
    for (const [sxw, syw, air, av] of dbgSamples){
      pos.push(sxw, syw);
      if (air) col.push(0.45, 1.0, 0.55, 0.9);
      else col.push(1.0, 0.3, 0.3, 0.9);
      pointVerts += 1;
    }
  }
  const dbg = state.debugPoints;
  if (state.debugCollisions && state.debugNodes && dbg){
    for (const [sxw, syw, air, av] of dbg){
      pos.push(sxw, syw);
      if (air) col.push(airPoint[0], airPoint[1], airPoint[2], 0.45);
      else col.push(rockPoint[0], rockPoint[1], rockPoint[2], 0.45);
      pointVerts += 1;
    }
    const outerRing = planet.radial && planet.radial.rings ? planet.radial.rings[planet.radial.rings.length - 1] : null;
    if (outerRing){
      for (const v of outerRing){
        pos.push(v.x, v.y);
        col.push(0.8, 0.2, 0.9, 0.6);
        pointVerts += 1;
      }
    }
  }
  if (state.debugCollisions && state.ship._collision){
    const c = state.ship._collision;
    pos.push(c.x, c.y);
    col.push(1.0, 0.95, 0.2, 1.0);
    pointVerts += 1;
    if (c.tri){
      const a = c.tri[0], b = c.tri[1], d = c.tri[2];
      pushLine(pos, col, a.x, a.y, b.x, b.y, 1.0, 0.4, 0.2, 0.8);
      pushLine(pos, col, b.x, b.y, d.x, d.y, 1.0, 0.4, 0.2, 0.8);
      pushLine(pos, col, d.x, d.y, a.x, a.y, 1.0, 0.4, 0.2, 0.8);
      lineVerts += 6;
    }
    if (c.node){
      pos.push(c.node.x, c.node.y);
      col.push(0.2, 0.9, 1.0, 0.9);
      pointVerts += 1;
    }
  }

  // Points end here. Lock the point vertex count to buffer length.
  pointVerts = pos.length / 2 - triVerts - lineVerts;

  // Test pathfinding

  /*
  if (state.aimWorld) {
    const radialGraph = planet.radialGraph;
    const passable = planet.airNodesBitmap;
    const nodeShip = nearestRadialNode(radialGraph, planet.radial, state.ship.x, state.ship.y);
    const nodeCursor = nearestRadialNode(radialGraph, planet.radial, state.aimWorld.x, state.aimWorld.y);

    const path = findPathAStar(radialGraph, nodeShip, nodeCursor, passable);
    if (path) {
      for (let i = 1; i < path.length; ++i) {
        const node0 = radialGraph.nodes[path[i-1]];
        const node1 = radialGraph.nodes[path[i]];
        pushLine(pos, col, node0.x, node0.y, node1.x, node1.y, 0, 1, 0, 1);
        lineVerts += 2;
      }
    }
  }
  */

  // Test surface guide path

  /*
  if (state.ship.guidePath) {
    const path = state.ship.guidePath.path;
    for (let i = 1; i < path.length; ++i) {
      pushLine(pos, col, path[i-1].x, path[i-1].y, path[i].x, path[i].y, 1, 0.9, 0, 1);
      lineVerts += 2;
    }

    const iShip = state.ship.guidePath.indexClosest;
    pushLine(pos, col, state.ship.x, state.ship.y, path[iShip].x, path[iShip].y, 1, 0.9, 0, 1);
    lineVerts += 2;
  }
  */

  // Test closest-point-on-planet (use mouse cursor as query point)

  /*
  if (state.aimWorld) {
    const posClosestOld = planet.posClosest(state.aimWorld.x, state.aimWorld.y);
    if (posClosestOld) {
      pushLine(pos, col, state.aimWorld.x, state.aimWorld.y, posClosestOld.x, posClosestOld.y, 1, 1, 0, 1);
      lineVerts += 2;
    }
  }
  */

  // Debug nodes now come from state.debugPoints for both modes.


  gl.useProgram(oprog);
  gl.bindVertexArray(oVao);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  gl.uniform2f(ouScale, sx, sy);
  gl.uniform2f(ouCam, state.view.xCenter, state.view.yCenter);
  gl.uniform1f(ouRot, camRot);

  gl.bindBuffer(gl.ARRAY_BUFFER, oPos);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, oCol);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.DYNAMIC_DRAW);

  if (triVerts > 0){
    gl.drawArrays(gl.TRIANGLES, 0, triVerts);
  }
  let offset = triVerts;
  if (lineVerts > 0){
    gl.drawArrays(gl.LINES, offset, lineVerts);
    offset += lineVerts;
  }
  if (pointVerts > 0){
    gl.drawArrays(gl.POINTS, offset, pointVerts);
  }

  if (state.touchUi){
    /** @type {number[]} */
    const linePos = [];
    /** @type {number[]} */
    const lineCol = [];

    const w = canvas.width;
    const h = canvas.height;
    const minDim = Math.max(1, Math.min(w, h));

    /**
     * @param {number} nx
     * @param {number} ny
     */
    const toPx = (nx, ny) => {
      return { x: nx * w, y: (1 - ny) * h };
    };

    const left = toPx(TOUCH_UI.left.x, TOUCH_UI.left.y);
    const leftRadius = TOUCH_UI.left.r * minDim;

    const laser = toPx(TOUCH_UI.laser.x, TOUCH_UI.laser.y);
    const laserSize = TOUCH_UI.laser.r * minDim;
    pushDiamondOutline(linePos, lineCol, laser.x, laser.y, laserSize, 0.95, 0.95, 0.95, 0.9);

    const bomb = toPx(TOUCH_UI.bomb.x, TOUCH_UI.bomb.y);
    const bombSize = TOUCH_UI.bomb.r * minDim;
    pushSquareOutline(linePos, lineCol, bomb.x, bomb.y, bombSize, 1.0, 0.75, 0.2, 0.9);

    pushCircle(linePos, lineCol, left.x, left.y, leftRadius, 1.0, 0.55, 0.15, 0.9, 64);

    if (state.touchUi.leftTouch){
      const touch = toPx(state.touchUi.leftTouch.x, state.touchUi.leftTouch.y);
      pushCircle(linePos, lineCol, touch.x, touch.y, leftRadius * 0.35, 1.0, 0.2, 0.2, 0.9, 24);
    }
    if (state.touchUi.laserTouch){
      const touch = toPx(state.touchUi.laserTouch.x, state.touchUi.laserTouch.y);
      pushCircle(linePos, lineCol, touch.x, touch.y, leftRadius * 0.35, 1.0, 0.2, 0.2, 0.9, 24);
    }
    if (state.touchUi.bombTouch){
      const touch = toPx(state.touchUi.bombTouch.x, state.touchUi.bombTouch.y);
      pushCircle(linePos, lineCol, touch.x, touch.y, leftRadius * 0.35, 1.0, 0.2, 0.2, 0.9, 24);
    }

    const uiLine = linePos.length / 2;
    /** @type {number[]} */
    const uiPos = linePos;
    /** @type {number[]} */
    const uiCol = lineCol;

    gl.uniform2f(ouScale, 2 / w, 2 / h);
    gl.uniform2f(ouCam, w * 0.5, h * 0.5);
    gl.uniform1f(ouRot, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, oPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uiPos), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, oCol);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uiCol), gl.DYNAMIC_DRAW);

    if (uiLine > 0){
      gl.drawArrays(gl.LINES, 0, uiLine);
    }
  }

  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
}

export class Renderer {
  /**
   * WebGL renderer for the game scene.
   * @param {HTMLCanvasElement} canvas Render surface.
   * @param {typeof import("./config.js").GAME} game Gameplay constants used in rendering.
   */
  constructor(canvas, game){
    this.canvas = canvas;
    this.game = game;

    /** @type {WebGL2RenderingContext|null} */
    const glMaybe = canvas.getContext("webgl2", { antialias:true, premultipliedAlpha:false });
    if (!glMaybe) throw new Error("WebGL2 not available");
    /** @type {WebGL2RenderingContext} */
    const gl = glMaybe;
    this.gl = gl;

    this.airBuf = null;
    this.fogBuf = null;
    this.vertCount = 0;
    this.shadeTex = null;

    const vs = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in float aAir;
  layout(location=2) in float aShade;
  layout(location=3) in float aFog;
  out vec2 vWorld;

  uniform vec2 uScale;
  uniform vec2 uCam;
  uniform float uRot;
  uniform float uFog;

  out float vAir;
  out float vShade;
  out float vFog;

  vec2 rot(vec2 p, float a){
    float c = cos(a), s = sin(a);
    return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  }

  void main(){
    vAir = aAir;
    vShade = aShade;
    vFog = aFog * uFog;
    vWorld = aPos;
    vec2 p = aPos - uCam;
    p = rot(p, uRot);
    gl_Position = vec4(p * uScale, 0.0, 1.0);
  }`;

    const fs = `#version 300 es
  precision highp float;

  in float vAir;
  in float vShade;
  in float vFog;
  in vec2 vWorld;
  out vec4 outColor;

  uniform vec3 uRockDark;
  uniform vec3 uRockLight;
  uniform vec3 uSurfaceRockDark;
  uniform vec3 uSurfaceRockLight;
  uniform vec3 uAirDark;
  uniform vec3 uAirLight;
    uniform float uMaxR;
    uniform float uRmax;
    uniform float uMeshRmax;
  uniform float uSurfaceBand;
  uniform vec3 uFogColor;

  vec3 lerp(vec3 a, vec3 b, float t){ return a + (b-a)*t; }

    void main(){
      float r = length(vWorld);
      if (r > uMaxR){
        discard;
      }
      if (r > (uMeshRmax - 0.5)){
        discard;
      }
      float t = clamp(vShade, 0.0, 1.0);
      float band = uSurfaceBand * uRmax;
      bool useSurface = (uSurfaceBand > 0.0) && (length(vWorld) > (uRmax - band));
    vec3 rockDark = useSurface ? uSurfaceRockDark : uRockDark;
    vec3 rockLight = useSurface ? uSurfaceRockLight : uRockLight;
    vec3 c = (vAir > 0.5) ? lerp(uAirDark,  uAirLight,  t)
                          : lerp(rockDark, rockLight, t);
    vec3 fogged = mix(c, uFogColor, clamp(vFog, 0.0, 1.0));
    outColor = vec4(fogged, 1.0);
  }`;

    const ovs = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in vec4 aColor;

  uniform vec2 uScale;
  uniform vec2 uCam;
  uniform float uRot;

  out vec4 vColor;

  vec2 rot(vec2 p, float a){
    float c = cos(a), s = sin(a);
    return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  }

  void main(){
    vec2 p = aPos - uCam;
    p = rot(p, uRot);
    gl_Position = vec4(p * uScale, 0.0, 1.0);
    vColor = aColor;
    gl_PointSize = 6.0;
  }`;

    const ofs = `#version 300 es
  precision highp float;
  in vec4 vColor;
  out vec4 outColor;
  void main(){
    outColor = vColor;
  }`;

    const starVs = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in float aPhase;
  layout(location=2) in float aRate;
  layout(location=3) in float aDepth;
  layout(location=4) in vec3 aColor;

  uniform float uRot;
  uniform vec2 uAspect;
  uniform float uSpan;

  out float vPhase;
  out float vRate;
  out float vDepth;
  out vec3 vColor;

  vec2 rot(vec2 p, float a){
    float c = cos(a), s = sin(a);
    return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  }

  void main(){
    float depth = clamp(aDepth, 0.0, 1.0);
    vec2 p = rot(aPos * uSpan, uRot);
    p.x *= uAspect.x;
    p.y *= uAspect.y;
    gl_Position = vec4(p, 0.0, 1.0);
    vPhase = aPhase;
    vRate = aRate;
    vDepth = depth;
    vColor = aColor;
  }`;

    const starFs = `#version 300 es
  precision highp float;
  in float vPhase;
  in float vRate;
  in float vDepth;
  in vec3 vColor;
  out vec4 outColor;

  uniform float uTime;
  uniform float uSaturation;

  void main(){
    float tw = 0.7 + 0.3 * sin(uTime * vRate + vPhase);
    float depthBoost = mix(0.6, 1.0, vDepth);
    float brightness = clamp(tw * depthBoost, 0.0, 1.0);
    vec3 col = mix(vec3(1.0), vColor, 0.6);
    float luma = dot(col, vec3(0.299, 0.587, 0.114));
    float sat = exp2((uSaturation - 1.0) * 2.0);
    col = mix(vec3(luma), col, sat);
    outColor = vec4(col * brightness, 1.0);
  }`;

    /** @type {WebGLProgram|null} */
    const prog = gl.createProgram();
    if (!prog) throw new Error("Failed to create program");
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)){
      throw new Error(gl.getProgramInfoLog(prog) || "Program link failed");
    }
    this.prog = prog;

    /** @type {WebGLProgram|null} */
    const oprog = gl.createProgram();
    if (!oprog) throw new Error("Failed to create overlay program");
    gl.attachShader(oprog, compile(gl, gl.VERTEX_SHADER, ovs));
    gl.attachShader(oprog, compile(gl, gl.FRAGMENT_SHADER, ofs));
    gl.linkProgram(oprog);
    if (!gl.getProgramParameter(oprog, gl.LINK_STATUS)){
      throw new Error(gl.getProgramInfoLog(oprog) || "Overlay program link failed");
    }
    this.oprog = oprog;

    /** @type {WebGLProgram|null} */
    const starProg = gl.createProgram();
    if (!starProg) throw new Error("Failed to create starfield program");
    gl.attachShader(starProg, compile(gl, gl.VERTEX_SHADER, starVs));
    gl.attachShader(starProg, compile(gl, gl.FRAGMENT_SHADER, starFs));
    gl.linkProgram(starProg);
    if (!gl.getProgramParameter(starProg, gl.LINK_STATUS)){
      throw new Error(gl.getProgramInfoLog(starProg) || "Starfield program link failed");
    }
    this.starProg = starProg;

    /** @type {WebGLVertexArrayObject|null} */
    const vao = gl.createVertexArray();
    /** @type {WebGLVertexArrayObject|null} */
    const oVao = gl.createVertexArray();
    /** @type {WebGLVertexArrayObject|null} */
    const starVao = gl.createVertexArray();
    if (!vao || !oVao || !starVao) throw new Error("Failed to create VAO");
    this.vao = vao;
    this.oVao = oVao;
    this.starVao = starVao;

    gl.useProgram(prog);
    this.uScale = gl.getUniformLocation(prog, "uScale");
    this.uCam = gl.getUniformLocation(prog, "uCam");
    this.uRot = gl.getUniformLocation(prog, "uRot");
    this.uFog = gl.getUniformLocation(prog, "uFog");
    this.uRockDark = gl.getUniformLocation(prog, "uRockDark");
    this.uRockLight= gl.getUniformLocation(prog, "uRockLight");
    this.uSurfaceRockDark = gl.getUniformLocation(prog, "uSurfaceRockDark");
    this.uSurfaceRockLight = gl.getUniformLocation(prog, "uSurfaceRockLight");
    this.uAirDark  = gl.getUniformLocation(prog, "uAirDark");
    this.uAirLight = gl.getUniformLocation(prog, "uAirLight");
    this.uMaxR     = gl.getUniformLocation(prog, "uMaxR");
    this.uRmax     = gl.getUniformLocation(prog, "uRmax");
    this.uMeshRmax = gl.getUniformLocation(prog, "uMeshRmax");
    this.uSurfaceBand = gl.getUniformLocation(prog, "uSurfaceBand");
    this.uFogColor = gl.getUniformLocation(prog, "uFogColor");

    gl.uniform3fv(this.uRockDark, CFG.ROCK_DARK);
    gl.uniform3fv(this.uRockLight,CFG.ROCK_LIGHT);
    if (this.uSurfaceRockDark) gl.uniform3fv(this.uSurfaceRockDark, CFG.ROCK_DARK);
    if (this.uSurfaceRockLight) gl.uniform3fv(this.uSurfaceRockLight, CFG.ROCK_LIGHT);
    gl.uniform3fv(this.uAirDark,  CFG.AIR_DARK);
    gl.uniform3fv(this.uAirLight, CFG.AIR_LIGHT);
    gl.uniform1f(this.uMaxR, CFG.RMAX + 0.5);
    if (this.uRmax) gl.uniform1f(this.uRmax, CFG.RMAX);
    if (this.uMeshRmax) gl.uniform1f(this.uMeshRmax, CFG.RMAX);
    if (this.uSurfaceBand) gl.uniform1f(this.uSurfaceBand, 0);
    gl.uniform3fv(this.uFogColor, game.FOG_COLOR);

    gl.bindVertexArray(oVao);
    /** @type {WebGLBuffer|null} */
    const oPos = gl.createBuffer();
    /** @type {WebGLBuffer|null} */
    const oCol = gl.createBuffer();
    if (!oPos || !oCol) throw new Error("Failed to create overlay buffers");
    this.oPos = oPos;
    this.oCol = oCol;
    gl.bindBuffer(gl.ARRAY_BUFFER, oPos);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, oCol);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    const starMesh = buildStarfieldMesh(CFG.seed + 911, {
      count: 480,
      sizeMin: 0.0015,
      sizeMax: 0.005,
      span: 1.0,
    });
    this.starVertCount = starMesh.vertCount;

    gl.useProgram(starProg);
    this.starRot = gl.getUniformLocation(starProg, "uRot");
    this.starTime = gl.getUniformLocation(starProg, "uTime");
    this.starAspect = gl.getUniformLocation(starProg, "uAspect");
    this.starSpan = gl.getUniformLocation(starProg, "uSpan");
    this.starSaturation = gl.getUniformLocation(starProg, "uSaturation");

    gl.bindVertexArray(starVao);
    uploadAttrib(gl, 0, starMesh.positions, 2);
    uploadAttrib(gl, 1, starMesh.phase, 1);
    uploadAttrib(gl, 2, starMesh.rate, 1);
    uploadAttrib(gl, 3, starMesh.depth, 1);
    uploadAttrib(gl, 4, starMesh.color, 3);
    gl.bindVertexArray(null);

    this.ouScale = gl.getUniformLocation(oprog, "uScale");
    this.ouCam = gl.getUniformLocation(oprog, "uCam");
    this.ouRot = gl.getUniformLocation(oprog, "uRot");
  }

  /**
   * @returns {void}
   */
  resize(){
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h){
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  /**
   * @param {Planet} planet
   * @returns {void}
   */
  setPlanet(planet){
    const gl = this.gl;
    const mesh = planet.radial;
    gl.bindVertexArray(this.vao);
    uploadAttrib(gl, 0, mesh.positions, 2);
    this.airBuf = uploadAttrib(gl, 1, mesh.airFlag, 1);
    uploadAttrib(gl, 2, mesh.shade, 1);
    const fog = (mesh.fogAlpha && mesh.fogAlpha()) || new Float32Array(mesh.vertCount);
    this.fogBuf = uploadAttrib(gl, 3, fog, 1);
    gl.bindVertexArray(null);
    this.vertCount = mesh.vertCount;
  }


  /**
   * @param {Float32Array} airFlag
   * @returns {void}
   */
  updateAir(airFlag){
    if (!this.airBuf) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.airBuf);
    gl.bufferData(gl.ARRAY_BUFFER, airFlag, gl.STATIC_DRAW);
  }

  /**
   * @param {Float32Array} fogAlpha
   * @returns {void}
   */
  updateFog(fogAlpha){
    if (!this.fogBuf) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fogBuf);
    gl.bufferData(gl.ARRAY_BUFFER, fogAlpha, gl.DYNAMIC_DRAW);
  }

  /**
   * @param {RenderState} state
   * @param {Planet} planet
   * @returns {void}
   */
  drawFrame(state, planet){
    drawFrameImpl(this, state, planet);
  }
}
