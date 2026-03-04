// @ts-check

import { TOUCH_UI } from "./config.js";

/** @typedef {import("./types.d.js").RenderState} RenderState */
/** @typedef {import("./planet.js").Planet} Planet */

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
 * @param {number[]} a
 * @param {number[]} b
 * @param {number[]} c
 * @param {number[]} d
 * @returns {Float32Array}
 */
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
 * @returns {void}
 */
function pushMiner(pos, col, x, y, jumpCycle, r, g, b, scale){
  const len = Math.hypot(x, y) || 1;
  const upx = x / len;
  const upy = y / len;
  const jumpOffset = 0.5 * jumpCycle * (1 - jumpCycle);
  const tx = -upy;
  const ty = upx;
  const s = scale ?? 1;
  const halfW = 0.06 * s;
  const halfH = 0.18 * s;
  const b0x = x + tx * halfW + upx * jumpOffset;
  const b0y = y + ty * halfW + upy * jumpOffset;
  const b1x = x - tx * halfW + upx * jumpOffset;
  const b1y = y - ty * halfW + upy * jumpOffset;
  const t0x = b0x + upx * (2 * halfH);
  const t0y = b0y + upy * (2 * halfH);
  const t1x = b1x + upx * (2 * halfH);
  const t1y = b1y + upy * (2 * halfH);
  pushTri(pos, col, t0x, t0y, t1x, t1y, b0x, b0y, r, g, b, 1);
  pushTri(pos, col, t1x, t1y, b1x, b1y, b0x, b0y, r, g, b, 1);
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {void}
 */
function pushEnemy(pos, col, x, y, r, g, b, scale){
  const len = Math.hypot(x, y) || 1;
  const upx = x / len;
  const upy = y / len;
  const tx = -upy;
  const ty = upx;
  const s = (scale ?? 1) * 1.5;
  const base = 0.18 * s;
  const height = 0.26 * s;
  const lx = x - tx * base;
  const ly = y - ty * base;
  const rx = x + tx * base;
  const ry = y + ty * base;
  const hx = x + upx * height;
  const hy = y + upy * height;
  pushTri(pos, col, lx, ly, rx, ry, hx, hy, r, g, b, 1);
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
  const { gl, canvas, cfg, game, prog, oprog, vao, oVao, uScale, uCam, uRot, ouScale, ouCam, ouRot, oPos, oCol } = renderer;
  const vertCount = renderer.vertCount;
  const mesh = planet.radial;
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
  if (renderer.renderMode === "sdf"){
    gl.useProgram(renderer.sdfProg);
    gl.bindVertexArray(renderer.sdfVao);
    gl.uniform2f(renderer.suScale, sx, sy);
    gl.uniform2f(renderer.suCam, state.view.xCenter, state.view.yCenter);
    gl.uniform1f(renderer.suRot, camRot);
    gl.uniform2f(renderer.suWorldMin, renderer._worldMin, renderer._worldMin);
    gl.uniform1f(renderer.suWorldSize, renderer._worldSize);
    gl.uniform2f(renderer.suGridSize, renderer._gridSize, renderer._gridSize);
    gl.uniform2f(renderer.suFogGridSize, renderer._fogGridSize || renderer._gridSize, renderer._fogGridSize || renderer._gridSize);
    gl.uniform1f(renderer.suSdfSuper, cfg.SDF_SUPERSAMPLE ?? 0.0);
    gl.uniform1f(renderer.suFogScale, cfg.SDF_FOG_SCALE ?? 1.0);
    gl.uniform1f(renderer.suFogSeenScale, cfg.SDF_FOG_SEEN_SCALE ?? 1.0);
    gl.uniform1f(renderer.suFogUnseenScale, cfg.SDF_FOG_UNSEEN_SCALE ?? 1.0);
    gl.uniform1f(renderer.suMaxR, cfg.RMAX + 0.5);
    gl.uniform3fv(renderer.suRockDark, cfg.ROCK_DARK);
    gl.uniform3fv(renderer.suRockLight, cfg.ROCK_LIGHT);
    gl.uniform3fv(renderer.suAirDark, cfg.AIR_DARK);
    gl.uniform3fv(renderer.suAirLight, cfg.AIR_LIGHT);
    gl.uniform3fv(renderer.suFogColor, game.FOG_COLOR);
    gl.uniform2f(renderer.suViewport, canvas.width, canvas.height);
    gl.uniform1f(renderer.suUseHwFilter, renderer.sdfUseHwFilter ? 1.0 : 0.0);
    gl.uniform1f(renderer.suMarchingSquares, cfg.SDF_MARCHING_SQUARES ? 1.0 : 0.0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, renderer.sdfTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, renderer.shadeTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, renderer.fogTex);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  } else {
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(uScale, sx, sy);
    gl.uniform2f(uCam, state.view.xCenter, state.view.yCenter);
    gl.uniform1f(uRot, camRot);
    gl.drawArrays(gl.TRIANGLES, 0, vertCount);
    gl.bindVertexArray(null);
  }

  const shipHWorld = 0.7 * game.SHIP_SCALE;
  const shipWWorld = 0.5 * game.SHIP_SCALE;
  const nose = shipHWorld * 0.6;
  const tail = shipHWorld * 0.4;

  /** @type {number[]} */
  const pos = [];
  /** @type {number[]} */
  const col = [];
  let triVerts = 0;
  let lineVerts = 0;
  let pointVerts = 0;

  const local = [
    [0, nose],
    [shipWWorld * 0.6, -tail],
    [0, -tail * 0.6],
    [-shipWWorld * 0.6, -tail],
  ];
  const body = [];
  const shipRot = -camRot;
  const lighten = (c) => Math.min(1, c + 0.3);
  const rockPoint = [1.0, 0.55, 0.12];
  const airPoint = [lighten(cfg.AIR_LIGHT[0]), lighten(cfg.AIR_LIGHT[1]), lighten(cfg.AIR_LIGHT[2])];
  const losVisibleAt = (x, y) => {
    if (!mesh || !mesh.lineOfSight) return true;
    const dx = x - state.ship.x;
    const dy = y - state.ship.y;
    if (dx * dx + dy * dy > game.VIS_RANGE * game.VIS_RANGE) return false;
    return mesh.lineOfSight(state.ship.x, state.ship.y, x, y);
  };
  if (state.ship.state !== "crashed"){
    for (const [lx, ly] of local){
      const [wx, wy] = rot2(lx, ly, shipRot);
      body.push([state.ship.x + wx, state.ship.y + wy]);
    }
    pushTri(pos, col, body[0][0], body[0][1], body[1][0], body[1][1], body[2][0], body[2][1], 0.06, 0.08, 0.12, 1);
    pushTri(pos, col, body[0][0], body[0][1], body[2][0], body[2][1], body[3][0], body[3][1], 0.06, 0.08, 0.12, 1);
    triVerts += 6;
  }

  if (state.miners && state.miners.length){
    for (const miner of state.miners){
      if (miner.state === "boarded") continue;
      if (miner.state !== "running" && !losVisibleAt(miner.x, miner.y)) continue;
      if (miner.state === "running"){
        pushMiner(pos, col, miner.x, miner.y, miner.jumpCycle, 0.98, 0.62, 0.2, game.MINER_SCALE);
      } else {
        pushMiner(pos, col, miner.x, miner.y, miner.jumpCycle, 0.98, 0.85, 0.25, game.MINER_SCALE);
      }
      triVerts += 6;
    }
  }

  if (state.enemies && state.enemies.length){
    for (const enemy of state.enemies){
      if (!losVisibleAt(enemy.x, enemy.y)) continue;
      if (enemy.type === "hunter"){
        pushEnemy(pos, col, enemy.x, enemy.y, 0.92, 0.25, 0.2, game.ENEMY_SCALE);
      } else if (enemy.type === "ranger"){
        pushEnemy(pos, col, enemy.x, enemy.y, 0.2, 0.75, 0.95, game.ENEMY_SCALE);
      } else {
        pushEnemy(pos, col, enemy.x, enemy.y, 0.95, 0.55, 0.2, game.ENEMY_SCALE);
      }
      triVerts += 3;
    }
  }

  if (state.shots && state.shots.length){
    const size = 0.10;
    for (const s of state.shots){
      if (s.owner === "hunter") pushDiamond(pos, col, s.x, s.y, size, 1.0, 0.35, 0.3, 0.9);
      else pushDiamond(pos, col, s.x, s.y, size, 0.3, 0.8, 1.0, 0.9);
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

  if (state.ship.state !== "crashed"){
    pushLine(pos, col, body[0][0], body[0][1], body[1][0], body[1][1], 0.9, 0.9, 0.9, 1);
    pushLine(pos, col, body[1][0], body[1][1], body[2][0], body[2][1], 0.9, 0.9, 0.9, 1);
    pushLine(pos, col, body[2][0], body[2][1], body[3][0], body[3][1], 0.9, 0.9, 0.9, 1);
    pushLine(pos, col, body[3][0], body[3][1], body[0][0], body[0][1], 0.9, 0.9, 0.9, 1);
    lineVerts += 8;
  }

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
    const ux = -dx / mag;
    const uy = -dy / mag;
    const len = shipHWorld * 0.28;
    const spread = shipHWorld * 0.12;
    const px = -uy;
    const py = ux;
    const offset = shipHWorld * 0.55 + extraOffset;
    const tipx = ux * len;
    const tipy = uy * len;
    const b1x = -ux * len * 0.45 + px * spread;
    const b1y = -uy * len * 0.45 + py * spread;
    const b2x = -ux * len * 0.45 - px * spread;
    const b2y = -uy * len * 0.45 - py * spread;
    const [tx, ty] = rot2(tipx + ux * offset, tipy + uy * offset, shipRot);
    const [p1x, p1y] = rot2(b1x + ux * offset, b1y + uy * offset, shipRot);
    const [p2x, p2y] = rot2(b2x + ux * offset, b2y + uy * offset, shipRot);
    pushLine(pos, col, state.ship.x + p1x, state.ship.y + p1y, state.ship.x + tx, state.ship.y + ty, r, g, b, 1);
    pushLine(pos, col, state.ship.x + p2x, state.ship.y + p2y, state.ship.x + tx, state.ship.y + ty, r, g, b, 1);
    lineVerts += 4;
  };

  if (state.ship.state !== "crashed"){
    const tc = [1.0, 0.55, 0.15];
    if (state.input.thrust) thrustV(0, 1, tc[0], tc[1], tc[2]);
    if (state.input.down) thrustV(0, -1, tc[0], tc[1], tc[2], shipHWorld * 0.08);
    if (state.input.left) thrustV(-1, 0, tc[0], tc[1], tc[2]);
    if (state.input.right) thrustV(1, 0, tc[0], tc[1], tc[2]);
  }

  if (state.ship.state !== "crashed"){
    // Braking line
    const vscale = vScaleStopping(planet, state.ship.x, state.ship.y, state.ship.vx, state.ship.vy, game.THRUST);
    pushLine(pos, col, state.ship.x, state.ship.y, state.ship.x + state.ship.vx * vscale, state.ship.y + state.ship.vy * vscale, 0.5, 0.84, 1.0, 0.5);
    lineVerts += 2;

    // Orbit apogee and perigee
    const {rPerigee: rPerigee, rApogee: rApogee} = planet.perigeeAndApogee(state.ship.x, state.ship.y, state.ship.vx, state.ship.vy);
    const rMin = cfg.RMAX + 0.5;
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
    pushLine(pos, col, state.ship.x, state.ship.y, state.aimWorld.x, state.aimWorld.y, 0.85, 0.9, 1.0, 0.65);
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
        const len = 0.098 * game.ENEMY_SCALE;
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
  }
  if (state.debugCollisions && state.ship._collision){
    const c = state.ship._collision;
    pos.push(c.x, c.y);
    col.push(1.0, 0.95, 0.2, 1.0);
    pointVerts += 1;
    if (c.tri && state.renderMode !== "sdf"){
      const a = c.tri[0], b = c.tri[1], d = c.tri[2];
      pushLine(pos, col, a.x, a.y, b.x, b.y, 1.0, 0.4, 0.2, 0.8);
      pushLine(pos, col, b.x, b.y, d.x, d.y, 1.0, 0.4, 0.2, 0.8);
      pushLine(pos, col, d.x, d.y, a.x, a.y, 1.0, 0.4, 0.2, 0.8);
      lineVerts += 6;
    }
    if (c.node && state.renderMode !== "sdf"){
      pos.push(c.node.x, c.node.y);
      col.push(0.2, 0.9, 1.0, 0.9);
      pointVerts += 1;
    }
  }

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

  // Draw a box around the distance field
  /*
  {
    const s = renderer._worldSize;
    const x0 = renderer._worldMin;
    const y0 = renderer._worldMin;
    const x1 = x0 + s;
    const y1 = y0 + s;
    const r = 1;
    const g = 1;
    const b = 1;
    const a = 1;
    pushLine(pos, col, x0, y0, x1, y0, r, g, b, a);
    pushLine(pos, col, x1, y0, x1, y1, r, g, b, a);
    pushLine(pos, col, x1, y1, x0, y1, r, g, b, a);
    pushLine(pos, col, x0, y1, x0, y0, r, g, b, a);
    lineVerts += 8;
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
   * @param {typeof import("./config.js").CFG} cfg Render configuration.
   * @param {typeof import("./config.js").GAME} game Gameplay constants used in rendering.
   */
  constructor(canvas, cfg, game){
    this.canvas = canvas;
    this.cfg = cfg;
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
    this.renderMode = "radial";
    this.sdfTex = null;
    this.shadeTex = null;
    this.fogTex = null;
    this._gridSize = 0;
    this._fogGridSize = 0;
    this._worldMin = 0;
    this._worldSize = 1;

    this.sdfUseHwFilter = false;
    this.sdfTexInternalFormat = gl.R32F;
    this.sdfTexFormat = gl.RED;
    this.sdfTexType = gl.FLOAT;
    this.sdfTexFilter = gl.NEAREST;

    const sdfFormatRaw = cfg.SDF_TEX_FORMAT ?? "r32f";
    const sdfFormat = String(sdfFormatRaw).toLowerCase();
    if (sdfFormat === "r16f"){
      this.sdfTexInternalFormat = gl.R16F;
      this.sdfTexFormat = gl.RED;
      this.sdfTexType = gl.HALF_FLOAT;
    } else if (sdfFormat !== "r32f"){
      console.warn(`Unknown SDF_TEX_FORMAT: ${sdfFormatRaw}. Falling back to r32f.`);
    }

    if (cfg.SDF_HW_FILTER){
      const hasFloatLinear = !!gl.getExtension("OES_texture_float_linear");
      const hasHalfFloatLinear = !!gl.getExtension("OES_texture_half_float_linear");
      const canLinear = (this.sdfTexInternalFormat === gl.R16F)
        ? (hasHalfFloatLinear || hasFloatLinear)
        : false;
      if (canLinear){
        this.sdfUseHwFilter = true;
        this.sdfTexFilter = gl.LINEAR;
      } else {
        console.warn("SDF_HW_FILTER requested but linear filtering not supported for current SDF format.");
      }
    }

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
    vFog = aFog;
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
  uniform vec3 uAirDark;
  uniform vec3 uAirLight;
  uniform float uMaxR;
  uniform vec3 uFogColor;

  vec3 lerp(vec3 a, vec3 b, float t){ return a + (b-a)*t; }

  void main(){
    if (length(vWorld) > uMaxR){
      discard;
    }
    float t = clamp(vShade, 0.0, 1.0);
    vec3 c = (vAir > 0.5) ? lerp(uAirDark,  uAirLight,  t)
                          : lerp(uRockDark, uRockLight, t);
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

    const sdfVs = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  void main(){
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

    const sdfFs = `#version 300 es
  precision highp float;
  out vec4 outColor;

  uniform vec2 uScale;
  uniform vec2 uCam;
  uniform float uRot;
  uniform vec2 uWorldMin;
  uniform float uWorldSize;
  uniform vec2 uGridSize;
  uniform vec2 uFogGridSize;
  uniform float uFogScale;
  uniform float uFogSeenScale;
  uniform float uFogUnseenScale;
  uniform float uSdfSuper;
  uniform float uMaxR;
  uniform vec3 uRockDark;
  uniform vec3 uRockLight;
  uniform vec3 uAirDark;
  uniform vec3 uAirLight;
  uniform vec3 uFogColor;
  uniform vec2 uViewport;
  uniform float uUseHwFilter;
  uniform float uMarchingSquares;
  uniform sampler2D uSdfTex;
  uniform sampler2D uShadeTex;
  uniform sampler2D uFogTex;

  vec2 rot(vec2 p, float a){
    float c = cos(a), s = sin(a);
    return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  }

  float sampleTex(sampler2D tex, vec2 uv, vec2 size){
    if (uUseHwFilter > 0.5){
      return texture(tex, uv).r;
    }
    vec2 coord = uv * size - 0.5;
    vec2 i0 = floor(coord);
    vec2 f = coord - i0;
    vec2 maxI = size - 1.0;
    ivec2 i00 = ivec2(clamp(i0, vec2(0.0), maxI));
    ivec2 i10 = ivec2(clamp(i0 + vec2(1.0, 0.0), vec2(0.0), maxI));
    ivec2 i01 = ivec2(clamp(i0 + vec2(0.0, 1.0), vec2(0.0), maxI));
    ivec2 i11 = ivec2(clamp(i0 + vec2(1.0, 1.0), vec2(0.0), maxI));
    float a = texelFetch(tex, i00, 0).r;
    float b = texelFetch(tex, i10, 0).r;
    float c = texelFetch(tex, i01, 0).r;
    float d = texelFetch(tex, i11, 0).r;
    float ab = mix(a, b, f.x);
    float cd = mix(c, d, f.x);
    return mix(ab, cd, f.y);
  }

  float sampleSdfSuper(sampler2D tex, vec2 uv, vec2 size, float level){
    if (level < 0.5){
      return sampleTex(tex, uv, size);
    }
    vec2 px = 1.0 / size;
    float s0 = sampleTex(tex, uv + vec2(-0.25, -0.25) * px, size);
    float s1 = sampleTex(tex, uv + vec2(0.25, -0.25) * px, size);
    float s2 = sampleTex(tex, uv + vec2(-0.25, 0.25) * px, size);
    float s3 = sampleTex(tex, uv + vec2(0.25, 0.25) * px, size);
    float base = 0.25 * (s0 + s1 + s2 + s3);
    if (level < 1.5){
      return base;
    }
    float s4 = sampleTex(tex, uv + vec2(-0.45, 0.0) * px, size);
    float s5 = sampleTex(tex, uv + vec2(0.45, 0.0) * px, size);
    float s6 = sampleTex(tex, uv + vec2(0.0, -0.45) * px, size);
    float s7 = sampleTex(tex, uv + vec2(0.0, 0.45) * px, size);
    return (base * 4.0 + s4 + s5 + s6 + s7) / 8.0;
  }

  float sampleTexNearest(sampler2D tex, vec2 uv, vec2 size){
    vec2 coord = uv * size - 0.5;
    vec2 i0 = floor(coord + 0.5);
    vec2 maxI = size - 1.0;
    ivec2 ii = ivec2(clamp(i0, vec2(0.0), maxI));
    return texelFetch(tex, ii, 0).r;
  }

  float sampleFogSmooth(sampler2D tex, vec2 uv, vec2 size){
    vec2 px = 1.0 / size;
    float f0 = sampleTex(tex, uv + vec2(-0.25, -0.25) * px, size);
    float f1 = sampleTex(tex, uv + vec2(0.25, -0.25) * px, size);
    float f2 = sampleTex(tex, uv + vec2(-0.25, 0.25) * px, size);
    float f3 = sampleTex(tex, uv + vec2(0.25, 0.25) * px, size);
    return 0.25 * (f0 + f1 + f2 + f3);
  }


  float segDist(vec2 p, vec2 a, vec2 b){
    vec2 ab = b - a;
    float denom = max(1e-6, dot(ab, ab));
    float t = clamp(dot(p - a, ab) / denom, 0.0, 1.0);
    vec2 q = a + ab * t;
    return length(p - q);
  }

  float sampleSdfMarching(vec2 uv, vec2 size){
    vec2 coord = uv * size - 0.5;
    vec2 i0 = floor(coord);
    vec2 f = coord - i0;
    vec2 maxI = size - 1.0;
    ivec2 i00 = ivec2(clamp(i0, vec2(0.0), maxI));
    ivec2 i10 = ivec2(clamp(i0 + vec2(1.0, 0.0), vec2(0.0), maxI));
    ivec2 i01 = ivec2(clamp(i0 + vec2(0.0, 1.0), vec2(0.0), maxI));
    ivec2 i11 = ivec2(clamp(i0 + vec2(1.0, 1.0), vec2(0.0), maxI));
    float v00 = texelFetch(uSdfTex, i00, 0).r;
    float v10 = texelFetch(uSdfTex, i10, 0).r;
    float v01 = texelFetch(uSdfTex, i01, 0).r;
    float v11 = texelFetch(uSdfTex, i11, 0).r;

    bool top = (v00 > 0.0) != (v10 > 0.0);
    bool right = (v10 > 0.0) != (v11 > 0.0);
    bool bottom = (v01 > 0.0) != (v11 > 0.0);
    bool left = (v00 > 0.0) != (v01 > 0.0);

    vec2 pTop = vec2(0.0);
    vec2 pRight = vec2(0.0);
    vec2 pBottom = vec2(0.0);
    vec2 pLeft = vec2(0.0);

    if (top){
      float t = v00 / (v00 - v10);
      pTop = vec2(clamp(t, 0.0, 1.0), 0.0);
    }
    if (right){
      float t = v10 / (v10 - v11);
      pRight = vec2(1.0, clamp(t, 0.0, 1.0));
    }
    if (bottom){
      float t = v01 / (v01 - v11);
      pBottom = vec2(clamp(t, 0.0, 1.0), 1.0);
    }
    if (left){
      float t = v00 / (v00 - v01);
      pLeft = vec2(0.0, clamp(t, 0.0, 1.0));
    }

    int count = int(top) + int(right) + int(bottom) + int(left);
    float signVal = sampleTex(uSdfTex, uv, size);
    float sign = (signVal >= 0.0) ? 1.0 : -1.0;

    if (count < 2){
      return signVal;
    }

    float dist = 1e6;
    if (count == 2){
      vec2 a = vec2(0.0);
      vec2 b = vec2(0.0);
      bool gotA = false;
      if (top){ a = pTop; gotA = true; }
      if (right){ if (!gotA){ a = pRight; gotA = true; } else { b = pRight; } }
      if (bottom){ if (!gotA){ a = pBottom; gotA = true; } else { b = pBottom; } }
      if (left){ if (!gotA){ a = pLeft; gotA = true; } else { b = pLeft; } }
      dist = segDist(f, a, b);
    } else if (count == 4){
      float center = (v00 + v10 + v01 + v11) * 0.25;
      if (center > 0.0){
        float d1 = segDist(f, pTop, pRight);
        float d2 = segDist(f, pBottom, pLeft);
        dist = min(d1, d2);
      } else {
        float d1 = segDist(f, pTop, pLeft);
        float d2 = segDist(f, pBottom, pRight);
        dist = min(d1, d2);
      }
    } else {
      // 3 crossings: fall back to bilinear sample
      return signVal;
    }

    return dist * sign;
  }

  vec3 lerp(vec3 a, vec3 b, float t){ return a + (b-a)*t; }

  void main(){
    vec2 ndc = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
    vec2 p = ndc / uScale;
    p = rot(p, -uRot);
    vec2 world = p + uCam;
    if (length(world) > uMaxR) discard;
    vec2 uv = (world - uWorldMin) / uWorldSize;
    uv = clamp(uv, 0.0, 1.0);
    float sdf = (uMarchingSquares > 0.5) ? sampleSdfMarching(uv, uGridSize) : sampleSdfSuper(uSdfTex, uv, uGridSize, uSdfSuper);
    float shade = sampleTex(uShadeTex, uv, uGridSize);
    float fogRaw = sampleFogSmooth(uFogTex, uv, uFogGridSize);
    float fog = fogRaw;
    if (fogRaw > 0.001){
      float seen = uFogSeenScale;
      float unseen = uFogUnseenScale;
      fog = (fogRaw < 0.7) ? (fogRaw * seen) : (fogRaw * unseen);
    }
    fog = clamp(fog * uFogScale, 0.0, 1.0);
    vec3 c = (sdf > 0.0) ? lerp(uAirDark,  uAirLight,  clamp(shade, 0.0, 1.0))
                         : lerp(uRockDark, uRockLight, clamp(shade, 0.0, 1.0));
    vec3 fogged = mix(c, uFogColor, clamp(fog, 0.0, 1.0));
    outColor = vec4(fogged, 1.0);
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
    const sdfProg = gl.createProgram();
    if (!sdfProg) throw new Error("Failed to create SDF program");
    gl.attachShader(sdfProg, compile(gl, gl.VERTEX_SHADER, sdfVs));
    gl.attachShader(sdfProg, compile(gl, gl.FRAGMENT_SHADER, sdfFs));
    gl.linkProgram(sdfProg);
    if (!gl.getProgramParameter(sdfProg, gl.LINK_STATUS)){
      throw new Error(gl.getProgramInfoLog(sdfProg) || "SDF program link failed");
    }
    this.sdfProg = sdfProg;

    /** @type {WebGLVertexArrayObject|null} */
    const vao = gl.createVertexArray();
    /** @type {WebGLVertexArrayObject|null} */
    const oVao = gl.createVertexArray();
    /** @type {WebGLVertexArrayObject|null} */
    const sdfVao = gl.createVertexArray();
    if (!vao || !oVao || !sdfVao) throw new Error("Failed to create VAO");
    this.vao = vao;
    this.oVao = oVao;
    this.sdfVao = sdfVao;

    gl.useProgram(prog);
    this.uScale = gl.getUniformLocation(prog, "uScale");
    this.uCam = gl.getUniformLocation(prog, "uCam");
    this.uRot = gl.getUniformLocation(prog, "uRot");
    this.uRockDark = gl.getUniformLocation(prog, "uRockDark");
    this.uRockLight= gl.getUniformLocation(prog, "uRockLight");
    this.uAirDark  = gl.getUniformLocation(prog, "uAirDark");
    this.uAirLight = gl.getUniformLocation(prog, "uAirLight");
    this.uMaxR     = gl.getUniformLocation(prog, "uMaxR");
    this.uFogColor = gl.getUniformLocation(prog, "uFogColor");

    gl.uniform3fv(this.uRockDark, cfg.ROCK_DARK);
    gl.uniform3fv(this.uRockLight,cfg.ROCK_LIGHT);
    gl.uniform3fv(this.uAirDark,  cfg.AIR_DARK);
    gl.uniform3fv(this.uAirLight, cfg.AIR_LIGHT);
    gl.uniform1f(this.uMaxR, cfg.RMAX + 0.5);
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

    this.ouScale = gl.getUniformLocation(oprog, "uScale");
    this.ouCam = gl.getUniformLocation(oprog, "uCam");
    this.ouRot = gl.getUniformLocation(oprog, "uRot");

    gl.useProgram(sdfProg);
    this.suScale = gl.getUniformLocation(sdfProg, "uScale");
    this.suCam = gl.getUniformLocation(sdfProg, "uCam");
    this.suRot = gl.getUniformLocation(sdfProg, "uRot");
    this.suWorldMin = gl.getUniformLocation(sdfProg, "uWorldMin");
    this.suWorldSize = gl.getUniformLocation(sdfProg, "uWorldSize");
    this.suGridSize = gl.getUniformLocation(sdfProg, "uGridSize");
    this.suFogGridSize = gl.getUniformLocation(sdfProg, "uFogGridSize");
    this.suSdfSuper = gl.getUniformLocation(sdfProg, "uSdfSuper");
    this.suFogScale = gl.getUniformLocation(sdfProg, "uFogScale");
    this.suFogSeenScale = gl.getUniformLocation(sdfProg, "uFogSeenScale");
    this.suFogUnseenScale = gl.getUniformLocation(sdfProg, "uFogUnseenScale");
    this.suMaxR = gl.getUniformLocation(sdfProg, "uMaxR");
    this.suRockDark = gl.getUniformLocation(sdfProg, "uRockDark");
    this.suRockLight = gl.getUniformLocation(sdfProg, "uRockLight");
    this.suAirDark = gl.getUniformLocation(sdfProg, "uAirDark");
    this.suAirLight = gl.getUniformLocation(sdfProg, "uAirLight");
    this.suFogColor = gl.getUniformLocation(sdfProg, "uFogColor");
    this.suViewport = gl.getUniformLocation(sdfProg, "uViewport");
    this.suUseHwFilter = gl.getUniformLocation(sdfProg, "uUseHwFilter");
    this.suMarchingSquares = gl.getUniformLocation(sdfProg, "uMarchingSquares");
    const suSdfTex = gl.getUniformLocation(sdfProg, "uSdfTex");
    const suShadeTex = gl.getUniformLocation(sdfProg, "uShadeTex");
    const suFogTex = gl.getUniformLocation(sdfProg, "uFogTex");
    if (suSdfTex) gl.uniform1i(suSdfTex, 0);
    if (suShadeTex) gl.uniform1i(suShadeTex, 1);
    if (suFogTex) gl.uniform1i(suFogTex, 2);

    gl.bindVertexArray(sdfVao);
    const sdfPos = gl.createBuffer();
    if (!sdfPos) throw new Error("Failed to create SDF buffer");
    this.sdfPos = sdfPos;
    gl.bindBuffer(gl.ARRAY_BUFFER, sdfPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,
       1, -1,
       1,  1,
      -1, -1,
       1,  1,
      -1,  1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
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
    this.renderMode = planet.mode;

    const { worldMin, worldSize } = planet.mapgen.grid;
    this._worldMin = worldMin;
    this._worldSize = worldSize;

    const rd = planet.renderData();
    this._gridSize = rd.gridSize;
    this._fogGridSize = rd.fogSize;
    this.updateSdfTextures(rd.sdf, rd.shade);
    const fogGrid = rd.fog || new Float32Array(this._gridSize * this._gridSize);
    this.updateFogTexture(fogGrid);

  }

  /**
   * @param {"radial"|"sdf"} mode
   * @returns {void}
   */
  setRenderMode(mode){
    this.renderMode = mode;
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
   * @param {Float32Array} sdfGrid
   * @param {Float32Array} shadeGrid
   * @returns {void}
   */
  updateSdfTextures(sdfGrid, shadeGrid){
    const gl = this.gl;
    const len = sdfGrid.length;
    if (len < 1) return;
    const G = Math.max(1, Math.floor(Math.sqrt(len)));
    if (G * G > len){
      console.warn("SDF grid size mismatch; skipping texture upload.", { len, G });
      return;
    }
    this._gridSize = G;
    if (shadeGrid.length !== sdfGrid.length){
      const shadeSize = Math.max(1, Math.floor(Math.sqrt(shadeGrid.length)));
      shadeGrid = resampleGrid(shadeGrid, shadeSize, G);
    }
    if (!this.sdfTex){
      this.sdfTex = createTexture(gl, G, G, this.sdfTexInternalFormat, this.sdfTexFormat, this.sdfTexType, sdfGrid, this.sdfTexFilter, this.sdfTexFilter);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.sdfTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.sdfTexFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.sdfTexFilter);
      gl.texImage2D(gl.TEXTURE_2D, 0, this.sdfTexInternalFormat, G, G, 0, this.sdfTexFormat, this.sdfTexType, ensureTexData(gl, this.sdfTexType, sdfGrid));
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    if (!this.shadeTex){
      this.shadeTex = createTexture(gl, G, G, this.sdfTexInternalFormat, this.sdfTexFormat, this.sdfTexType, shadeGrid, this.sdfTexFilter, this.sdfTexFilter);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.shadeTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.sdfTexFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.sdfTexFilter);
      gl.texImage2D(gl.TEXTURE_2D, 0, this.sdfTexInternalFormat, G, G, 0, this.sdfTexFormat, this.sdfTexType, ensureTexData(gl, this.sdfTexType, shadeGrid));
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
  }

  /**
   * @param {Float32Array} fogGrid
   * @returns {void}
   */
  updateFogTexture(fogGrid){
    const gl = this.gl;
    const len = fogGrid.length;
    if (len < 1) return;
    const G = Math.max(1, Math.floor(Math.sqrt(len)));
    if (G * G > len){
      console.warn("Fog grid size mismatch; skipping texture upload.", { len, G });
      return;
    }
    this._fogGridSize = G;
    if (!this.fogTex){
      this.fogTex = createTexture(gl, G, G, this.sdfTexInternalFormat, this.sdfTexFormat, this.sdfTexType, fogGrid, this.sdfTexFilter, this.sdfTexFilter);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.fogTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.sdfTexFilter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.sdfTexFilter);
      gl.texImage2D(gl.TEXTURE_2D, 0, this.sdfTexInternalFormat, G, G, 0, this.sdfTexFormat, this.sdfTexType, ensureTexData(gl, this.sdfTexType, fogGrid));
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
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
