// @ts-check

import { TOUCH_UI } from "./config.js";

/** @typedef {import("./types.d.js").RenderState} RenderState */

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
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {void}
 */
function pushMiner(pos, col, x, y, r, g, b, scale){
  const len = Math.hypot(x, y) || 1;
  const upx = x / len;
  const upy = y / len;
  const tx = -upy;
  const ty = upx;
  const s = scale ?? 1;
  const halfW = 0.06 * s;
  const halfH = 0.18 * s;
  const b0x = x + tx * halfW;
  const b0y = y + ty * halfW;
  const b1x = x - tx * halfW;
  const b1y = y - ty * halfW;
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
 * @param {Renderer} renderer
 * @param {RenderState} state
 * @param {import("./mesh.js").RingMesh} mesh
 * @returns {void}
 */
function drawFrameImpl(renderer, state, mesh){
  const { gl, canvas, cfg, game, prog, oprog, vao, oVao, uScale, uCam, uRot, ouScale, ouCam, ouRot, oPos, oCol } = renderer;
  const vertCount = renderer.vertCount;
  renderer.resize();

    gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const camRot = Math.atan2(state.ship.x, state.ship.y || 1e-6);

    gl.useProgram(prog);
    gl.bindVertexArray(vao);

    const s = game.ZOOM / (cfg.RMAX + cfg.PAD);
    const aspect = canvas.width / canvas.height;
    const sx = s / aspect;
    const sy = s;
    gl.uniform2f(uScale, sx, sy);
    gl.uniform2f(uCam, state.ship.x, state.ship.y);
    gl.uniform1f(uRot, camRot);

    gl.drawArrays(gl.TRIANGLES, 0, vertCount);

    gl.bindVertexArray(null);

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
        if (miner.state === "running"){
          pushMiner(pos, col, miner.x, miner.y, 0.98, 0.62, 0.2, game.MINER_SCALE);
        } else {
          pushMiner(pos, col, miner.x, miner.y, 0.98, 0.85, 0.25, game.MINER_SCALE);
        }
        triVerts += 6;
      }
    }

    if (state.enemies && state.enemies.length){
      for (const enemy of state.enemies){
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
      // TODO: Incorporate gravity into the stopping distance
      const vscale = Math.hypot(state.ship.vx, state.ship.vy) / (2 * game.THRUST);
      pushLine(pos, col, state.ship.x, state.ship.y, state.ship.x + state.ship.vx * vscale, state.ship.y + state.ship.vy * vscale, 0.5, 0.84, 1.0, 1);
      lineVerts += 2;

      // Plot apogee and perigee, if in orbit

      const rCrossV = state.ship.x * state.ship.vy - state.ship.y * state.ship.vx;
      const r = Math.hypot(state.ship.x, state.ship.y);
      const eccentricityX = (state.ship.vy * rCrossV) / game.GRAVITY - state.ship.x / r;
      const eccentricityY = (-state.ship.vx * rCrossV) / game.GRAVITY - state.ship.y / r;
      const eccentricity = Math.hypot(eccentricityX, eccentricityY);

      if (eccentricity < 1.0) {
        const vSqr = state.ship.vx * state.ship.vx + state.ship.vy * state.ship.vy;
        const specificEnergy = vSqr / 2 - game.GRAVITY / r;
        const a = -game.GRAVITY / (2 * specificEnergy);
        let rPerigee = a * (1 - eccentricity);
        let rApogee = a * (1 + eccentricity);

        const rMin = cfg.RMAX + 0.5;
        const rMax = Math.max(r * 2, cfg.RMAX * 2);

        if (rPerigee >= rMin && rApogee <= rMax) {
          const dirX = state.ship.x / r;
          const dirY = state.ship.y / r;

          const crossTickSize = 0.05;
          const crossX = -dirY * crossTickSize;
          const crossY = dirX * crossTickSize;

          rApogee = Math.min(rApogee, rMax);
          rPerigee = Math.max(rPerigee, rMin);

          const apoX = dirX * rApogee;
          const apoY = dirY * rApogee;

          const periX = dirX * rPerigee;
          const periY = dirY * rPerigee;

          if (rApogee < rMax) {
            pushLine(pos, col, apoX - crossX, apoY - crossY, apoX + crossX, apoY + crossY, 0.2, 1.0, 0.2, 0.5);
            lineVerts += 2;
          }

          if (rPerigee > rMin) {
            pushLine(pos, col, periX - crossX, periY - crossY, periX + crossX, periY + crossY, 0.2, 1.0, 0.2, 0.5);
            lineVerts += 2;
          }

          pushLine(pos, col, apoX, apoY, periX, periY, 0.2, 1.0, 0.2, 0.5);
          lineVerts += 2;
        }
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

    if (state.debugCollisions && state.ship._samples){
      for (const [sxw, syw, air, av] of state.ship._samples){
        pos.push(sxw, syw);
        if (air) col.push(0.45, 1.0, 0.55, 0.9);
        else col.push(1.0, 0.3, 0.3, 0.9);
        pointVerts += 1;
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

    if (state.debugCollisions && state.debugNodes){
      for (const ring of mesh.rings){
        for (const v of ring){
          pos.push(v.x, v.y);
          col.push(0.95, 0.8, 0.2, 0.6);
          pointVerts += 1;
        }
      }
    }


    gl.useProgram(oprog);
    gl.bindVertexArray(oVao);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.uniform2f(ouScale, sx, sy);
    gl.uniform2f(ouCam, state.ship.x, state.ship.y);
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
    this.vertCount = 0;

    const vs = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aPos;
  layout(location=1) in float aAir;
  layout(location=2) in float aShade;
  out vec2 vWorld;

  uniform vec2 uScale;
  uniform vec2 uCam;
  uniform float uRot;

  out float vAir;
  out float vShade;

  vec2 rot(vec2 p, float a){
    float c = cos(a), s = sin(a);
    return vec2(c*p.x - s*p.y, s*p.x + c*p.y);
  }

  void main(){
    vAir = aAir;
    vShade = aShade;
    vWorld = aPos;
    vec2 p = aPos - uCam;
    p = rot(p, uRot);
    gl_Position = vec4(p * uScale, 0.0, 1.0);
  }`;

    const fs = `#version 300 es
  precision highp float;

  in float vAir;
  in float vShade;
  in vec2 vWorld;
  out vec4 outColor;

  uniform vec3 uRockDark;
  uniform vec3 uRockLight;
  uniform vec3 uAirDark;
  uniform vec3 uAirLight;
  uniform float uMaxR;

  vec3 lerp(vec3 a, vec3 b, float t){ return a + (b-a)*t; }

  void main(){
    if (length(vWorld) > uMaxR){
      discard;
    }
    float t = clamp(vShade, 0.0, 1.0);
    vec3 c = (vAir > 0.5) ? lerp(uAirDark,  uAirLight,  t)
                          : lerp(uRockDark, uRockLight, t);
    outColor = vec4(c, 1.0);
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

    /** @type {WebGLVertexArrayObject|null} */
    const vao = gl.createVertexArray();
    /** @type {WebGLVertexArrayObject|null} */
    const oVao = gl.createVertexArray();
    if (!vao || !oVao) throw new Error("Failed to create VAO");
    this.vao = vao;
    this.oVao = oVao;

    gl.useProgram(prog);
    this.uScale = gl.getUniformLocation(prog, "uScale");
    this.uCam = gl.getUniformLocation(prog, "uCam");
    this.uRot = gl.getUniformLocation(prog, "uRot");
    this.uRockDark = gl.getUniformLocation(prog, "uRockDark");
    this.uRockLight= gl.getUniformLocation(prog, "uRockLight");
    this.uAirDark  = gl.getUniformLocation(prog, "uAirDark");
    this.uAirLight = gl.getUniformLocation(prog, "uAirLight");
    this.uMaxR     = gl.getUniformLocation(prog, "uMaxR");

    gl.uniform3fv(this.uRockDark, cfg.ROCK_DARK);
    gl.uniform3fv(this.uRockLight,cfg.ROCK_LIGHT);
    gl.uniform3fv(this.uAirDark,  cfg.AIR_DARK);
    gl.uniform3fv(this.uAirLight, cfg.AIR_LIGHT);
    gl.uniform1f(this.uMaxR, cfg.RMAX + 0.5);

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
   * @param {{positions:Float32Array, airFlag:Float32Array, shade:Float32Array, vertCount:number}} mesh
   * @returns {void}
   */
  setMesh(mesh){
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    uploadAttrib(gl, 0, mesh.positions, 2);
    this.airBuf = uploadAttrib(gl, 1, mesh.airFlag, 1);
    uploadAttrib(gl, 2, mesh.shade, 1);
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
   * @param {RenderState} state
   * @param {import("./mesh.js").RingMesh} mesh
   * @returns {void}
   */
  drawFrame(state, mesh){
    drawFrameImpl(this, state, mesh);
  }
}
