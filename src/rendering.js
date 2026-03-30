// @ts-check

import { CFG, TOUCH_UI } from "./config.js";
import { PERF_FLAGS, getEffectiveDevicePixelRatio } from "./perf.js";
import {
  DROPSHIP_MODEL,
  getDropshipGeometryProfileN,
  getDropshipCargoBoundsN,
  getInertialDriveThrust,
  getDropshipRenderSize,
  getDropshipThrusterPowers,
  getDropshipWorldRotation,
} from "./dropship.js";
import { buildStarfieldMesh } from "./starfield.js";
import { dijkstraMap, findPathAStar, nearestRadialNode } from "./navigation.js";
import { fragmentBaseColor } from "./fragment_fx.js";
import * as planetFog from "./planet_fog.js";
import { closestPointOnSegment } from "./collision_helpers.js";
import {
  getMothershipBoundaryEdges,
  mothershipLocalDirToWorld,
  mothershipLocalToWorld,
  worldToMothershipLocal,
} from "./collision_mothership.js";

/** @typedef {import("./types.d.js").RenderState} RenderState */
/** @typedef {import("./planet.js").Planet} Planet */
/** @typedef {import("./types.d.js").Enemy} Enemy */
/** @typedef {{x:number,y:number,type:import("./types.d.js").EnemyType,vx?:number,vy?:number}} EnemyRender */
/** @typedef {[number, number]} Vec2 */
/** @typedef {[number, number, number]} Rgb */
/** @typedef {[number, number, number, number]} Rgba */
/** @typedef {{a:Vec2,b:Vec2,c:Vec2,col:Rgba,outline?:boolean}} ColoredTri */
/** @typedef {{a:Vec2,b:Vec2,c:Vec2,material:number,outline:boolean}} ActorTri */

const ACTOR_MATERIAL_HULL = 0;
const ACTOR_MATERIAL_WINDOW = 1;
const ACTOR_MATERIAL_GUN = 2;

/**
 * @param {[number,number,number]} base
 * @param {number} boost
 * @returns {[number,number,number]}
 */
function brightenColor(base, boost){
  return [
    Math.min(1, base[0] + (1 - base[0]) * boost),
    Math.min(1, base[1] + (1 - base[1]) * boost),
    Math.min(1, base[2] + (1 - base[2]) * boost),
  ];
}

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
 * @param {number} v
 * @returns {number}
 */
function clamp01(v){
  return Math.max(0, Math.min(1, v));
}

/**
 * @param {number} t
 * @returns {number}
 */
function smoothstep01(t){
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
}

/**
 * Approximates the terrain's air-side edge fade for nested dropship outline shells.
 * Input is normalized shell radius 0..1 where 0 is the hull edge and 1 is the outer fade limit.
 * @param {number} t
 * @returns {number}
 */
function terrainAirFade01(t){
  return 1 - smoothstep01(t);
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
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {string}
 */
function actorEdgeKey(ax, ay, bx, by){
  const a = `${ax.toFixed(6)},${ay.toFixed(6)}`;
  const b = `${bx.toFixed(6)},${by.toFixed(6)}`;
  return (a < b) ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {string}
 */
function actorVertexKey(x, y){
  return `${x.toFixed(6)},${y.toFixed(6)}`;
}

/**
 * Build non-indexed actor mesh data for shader-driven actor rendering.
 * @param {ActorTri[]} tris
 * @returns {{local:Float32Array,bary:Float32Array,edgeMask:Float32Array,outlineDir:Float32Array,material:Float32Array,vertCount:number}}
 */
function buildActorMeshData(tris){
  const edgeCounts = new Map();
  for (const tri of tris){
    const edges = [
      actorEdgeKey(tri.b[0], tri.b[1], tri.c[0], tri.c[1]),
      actorEdgeKey(tri.c[0], tri.c[1], tri.a[0], tri.a[1]),
      actorEdgeKey(tri.a[0], tri.a[1], tri.b[0], tri.b[1]),
    ];
    for (const key of edges){
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
  }
  /** @type {number[]} */
  const local = [];
  /** @type {number[]} */
  const bary = [];
  /** @type {number[]} */
  const edgeMask = [];
  /** @type {Map<string,{x:number,y:number}>} */
  const outlineDirByVertex = new Map();
  for (const tri of tris){
    if (!tri.outline) continue;
    const area2 = (tri.b[0] - tri.a[0]) * (tri.c[1] - tri.a[1]) - (tri.b[1] - tri.a[1]) * (tri.c[0] - tri.a[0]);
    const winding = area2 >= 0 ? 1 : -1;
    const triVerts = [tri.a, tri.b, tri.c];
    for (let i = 0; i < 3; i++){
      const p0 = /** @type {Vec2} */ (triVerts[i]);
      const p1 = /** @type {Vec2} */ (triVerts[(i + 1) % 3]);
      const edgeKey = actorEdgeKey(p0[0], p0[1], p1[0], p1[1]);
      if ((edgeCounts.get(edgeKey) || 0) !== 1) continue;
      const ex = p1[0] - p0[0];
      const ey = p1[1] - p0[1];
      const len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      const nx = (winding > 0 ? ey : -ey) / len;
      const ny = (winding > 0 ? -ex : ex) / len;
      for (const p of [p0, p1]){
        const key = actorVertexKey(p[0], p[1]);
        const acc = outlineDirByVertex.get(key) || { x: 0, y: 0 };
        acc.x += nx;
        acc.y += ny;
        outlineDirByVertex.set(key, acc);
      }
    }
  }
  /** @type {number[]} */
  const outlineDir = [];
  /** @type {number[]} */
  const material = [];
  for (const tri of tris){
    const outlineMask = tri.outline
      ? /** @type {[number,number,number]} */ ([
          (edgeCounts.get(actorEdgeKey(tri.b[0], tri.b[1], tri.c[0], tri.c[1])) || 0) === 1 ? 1 : 0,
          (edgeCounts.get(actorEdgeKey(tri.c[0], tri.c[1], tri.a[0], tri.a[1])) || 0) === 1 ? 1 : 0,
          (edgeCounts.get(actorEdgeKey(tri.a[0], tri.a[1], tri.b[0], tri.b[1])) || 0) === 1 ? 1 : 0,
        ])
      : /** @type {[number,number,number]} */ ([0, 0, 0]);
    const verts = [tri.a, tri.b, tri.c];
    const baryCoords = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    for (let i = 0; i < 3; i++){
      const v = /** @type {Vec2} */ (verts[i]);
      const b = /** @type {[number,number,number]} */ (baryCoords[i]);
      local.push(v[0], v[1]);
      bary.push(b[0], b[1], b[2]);
      edgeMask.push(outlineMask[0], outlineMask[1], outlineMask[2]);
      const outlineAcc = outlineDirByVertex.get(actorVertexKey(v[0], v[1])) || { x: 0, y: 0 };
      const outlineLen = Math.hypot(outlineAcc.x, outlineAcc.y);
      outlineDir.push(
        outlineLen > 1e-6 ? (outlineAcc.x / outlineLen) : 0,
        outlineLen > 1e-6 ? (outlineAcc.y / outlineLen) : 0
      );
      material.push(tri.material);
    }
  }
  return {
    local: new Float32Array(local),
    bary: new Float32Array(bary),
    edgeMask: new Float32Array(edgeMask),
    outlineDir: new Float32Array(outlineDir),
    material: new Float32Array(material),
    vertCount: tris.length * 3,
  };
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
 * Draw a thick world-space line as two triangles.
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} thickness
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @returns {void}
 */
function pushThickLine(pos, col, ax, ay, bx, by, thickness, r, g, b, a){
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-6) return;
  const half = Math.max(1e-4, thickness * 0.5);
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  pushTri(pos, col, ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, r, g, b, a);
  pushTri(pos, col, ax + nx, ay + ny, bx - nx, by - ny, ax - nx, ay - ny, r, g, b, a);
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
 * @param {Array<{x:number,y:number,air:number}>} tri
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function triAirAtWorld(tri, x, y){
  const a = /** @type {{x:number,y:number,air:number}} */ (tri[0]);
  const b = /** @type {{x:number,y:number,air:number}} */ (tri[1]);
  const c = /** @type {{x:number,y:number,air:number}} */ (tri[2]);
  const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(det) < 1e-6){
    return (a.air + b.air + c.air) / 3;
  }
  const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
  const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
  const l3 = 1 - l1 - l2;
  return a.air * l1 + b.air * l2 + c.air * l3;
}

/**
 * @param {Array<[number, number]>} out
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function pushUniquePoint(out, x, y){
  const eps2 = 1e-10;
  for (const p of out){
    const dx = p[0] - x;
    const dy = p[1] - y;
    if ((dx * dx + dy * dy) <= eps2) return;
  }
  out.push([x, y]);
}

/**
 * @param {Array<{x:number,y:number,air:number}>} tri
 * @param {number} [threshold]
 * @returns {[[number, number], [number, number]]|null}
 */
function triIsoSegment(tri, threshold = 0.5){
  /** @type {Array<[number, number]>} */
  const pts = [];
  const a = /** @type {{x:number,y:number,air:number}} */ (tri[0]);
  const b = /** @type {{x:number,y:number,air:number}} */ (tri[1]);
  const c = /** @type {{x:number,y:number,air:number}} */ (tri[2]);
  /** @type {Array<[{x:number,y:number,air:number}, {x:number,y:number,air:number}]>} */
  const edges = [[a, b], [b, c], [c, a]];
  const eps = 1e-6;
  for (const [a, b] of edges){
    const va = a.air;
    const vb = b.air;
    const da = va - threshold;
    const db = vb - threshold;
    if (Math.abs(da) <= eps && Math.abs(db) <= eps){
      pushUniquePoint(pts, a.x, a.y);
      pushUniquePoint(pts, b.x, b.y);
      continue;
    }
    if (Math.abs(da) <= eps){
      pushUniquePoint(pts, a.x, a.y);
      continue;
    }
    if (Math.abs(db) <= eps){
      pushUniquePoint(pts, b.x, b.y);
      continue;
    }
    if (da * db < 0){
      const t = (threshold - va) / ((vb - va) || 1);
      const clampedT = Math.max(0, Math.min(1, t));
      pushUniquePoint(pts, a.x + (b.x - a.x) * clampedT, a.y + (b.y - a.y) * clampedT);
    }
  }
  if (pts.length < 2) return null;
  if (pts.length === 2){
    const p0 = /** @type {[number, number]} */ (pts[0]);
    const p1 = /** @type {[number, number]} */ (pts[1]);
    return [p0, p1];
  }
  let iBest = 0;
  let jBest = 1;
  let bestD2 = -1;
  for (let i = 0; i < pts.length; i++){
    for (let j = i + 1; j < pts.length; j++){
      const pi = /** @type {[number, number]} */ (pts[i]);
      const pj = /** @type {[number, number]} */ (pts[j]);
      const dx = pj[0] - pi[0];
      const dy = pj[1] - pi[1];
      const d2 = dx * dx + dy * dy;
      if (d2 > bestD2){
        bestD2 = d2;
        iBest = i;
        jBest = j;
      }
    }
  }
  return [/** @type {[number, number]} */ (pts[iBest]), /** @type {[number, number]} */ (pts[jBest])];
}

/**
 * @param {Float32Array} triPositions
 * @returns {{positions:Float32Array,colors:Float32Array,vertCount:number}}
 */
function buildTriangleWireframe(triPositions){
  const triCount = Math.floor(triPositions.length / 6);
  const positions = new Float32Array(triCount * 12);
  const colors = new Float32Array(triCount * 24);
  let pi = 0;
  let ci = 0;
  const r = 0.96, g = 0.97, b = 1.0, a = 0.33;
  for (let i = 0; i < triCount; i++){
    const i0 = i * 6;
    const ax = /** @type {number} */ (triPositions[i0]);
    const ay = /** @type {number} */ (triPositions[i0 + 1]);
    const bx = /** @type {number} */ (triPositions[i0 + 2]);
    const by = /** @type {number} */ (triPositions[i0 + 3]);
    const cx = /** @type {number} */ (triPositions[i0 + 4]);
    const cy = /** @type {number} */ (triPositions[i0 + 5]);

    positions[pi++] = ax; positions[pi++] = ay;
    positions[pi++] = bx; positions[pi++] = by;
    positions[pi++] = bx; positions[pi++] = by;
    positions[pi++] = cx; positions[pi++] = cy;
    positions[pi++] = cx; positions[pi++] = cy;
    positions[pi++] = ax; positions[pi++] = ay;

    for (let j = 0; j < 6; j++){
      colors[ci++] = r;
      colors[ci++] = g;
      colors[ci++] = b;
      colors[ci++] = a;
    }
  }
  return { positions, colors, vertCount: triCount * 6 };
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
  /** @type {Vec2} */
  const top = [x, y + up];
  /** @type {Vec2} */
  const rightP = [x + right, y];
  /** @type {Vec2} */
  const bot = [x, y - up];
  /** @type {Vec2} */
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
  /** @type {Array<[number, number]>} */
  const pts = [];
  for (let i = 0; i < 6; i++){
    const ang = rot + (i / 6) * Math.PI * 2;
    pts.push([x + Math.cos(ang) * radius, y + Math.sin(ang) * radius]);
  }
  for (let i = 0; i < 6; i++){
    const p0 = /** @type {Vec2} */ (pts[i]);
    const p1 = /** @type {Vec2} */ (pts[(i + 1) % 6]);
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
  /** @type {Array<[number, number]>} */
  const pts = [];
  for (let i = 0; i < sides; i++){
    const ang = rot + (i / sides) * Math.PI * 2;
    pts.push([x + Math.cos(ang) * radius, y + Math.sin(ang) * radius]);
  }
  for (let i = 0; i < sides; i++){
    const p0 = /** @type {Vec2} */ (pts[i]);
    const p1 = /** @type {Vec2} */ (pts[(i + 1) % sides]);
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
 * @param {{upx?:number,upy?:number,deformX?:number,deformY?:number,alpha?:number}|null} [opts]
 * @returns {number}
 */
function pushMiner(pos, col, x, y, jumpCycle, r, g, b, scale, skipHelmet = false, outlineExpand = 0, opts = null){
  const len = Math.hypot(x, y) || 1;
  const upLen = (opts && Number.isFinite(opts.upx) && Number.isFinite(opts.upy))
    ? (Math.hypot(Number(opts.upx), Number(opts.upy)) || 1)
    : len;
  const upx = (opts && Number.isFinite(opts.upx)) ? Number(opts.upx) / upLen : x / len;
  const upy = (opts && Number.isFinite(opts.upy)) ? Number(opts.upy) / upLen : y / len;
  const jumpOffset = 0.5 * jumpCycle * (1 - jumpCycle);
  const tx = -upy;
  const ty = upx;
  const s = scale ?? 1;
  const deformX = (opts && Number.isFinite(opts.deformX)) ? Number(opts.deformX) : 1;
  const deformY = (opts && Number.isFinite(opts.deformY)) ? Number(opts.deformY) : 1;
  const alpha = (opts && Number.isFinite(opts.alpha)) ? Math.max(0, Math.min(1, Number(opts.alpha))) : 1;
  const ox = x + upx * jumpOffset;
  const oy = y + upy * jumpOffset;
  /**
   * @param {number} lx
   * @param {number} ly
   * @returns {[number, number]}
   */
  const toWorld = (lx, ly) => [ox + tx * lx * deformX + upx * ly * deformY, oy + ty * lx * deformX + upy * ly * deformY];
  let triCount = 0;
  /**
   * @param {number} v
   * @returns {number}
   */
  const darken = (v) => Math.max(0, Math.min(1, v * 0.55));
  /** @type {Array<{a:[number,number],b:[number,number],c:[number,number],col:[number,number,number],outline:boolean}>} */
  const tris = [];
  /**
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @param {number} cx
   * @param {number} cy
   * @param {number} cr
   * @param {number} cg
   * @param {number} cb
   * @param {boolean} [outline]
   * @returns {void}
   */
  const emitTri = (ax, ay, bx, by, cx, cy, cr, cg, cb, outline = true) => {
    tris.push({ a: [ax, ay], b: [bx, by], c: [cx, cy], col: [cr, cg, cb], outline });
  };
  /**
   * @param {number} lx0
   * @param {number} ly0
   * @param {number} lx1
   * @param {number} ly1
   * @param {number} [qr]
   * @param {number} [qg]
   * @param {number} [qb]
   * @param {boolean} [outline]
   * @returns {void}
   */
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
  /**
   * @param {number} cx
   * @returns {void}
   */
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
          pushTri(pos, col, sax, say, sbx, sby, scx, scy, darken(t.col[0]), darken(t.col[1]), darken(t.col[2]), alpha);
          triCount += 1;
        }
      }
    }
    for (const t of tris){
      pushTri(pos, col, t.a[0], t.a[1], t.b[0], t.b[1], t.c[0], t.c[1], t.col[0], t.col[1], t.col[2], alpha);
      triCount += 1;
    }
  }
  return triCount;
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} life
 * @returns {number}
 */
function pushHealthPickup(pos, col, x, y, life){
  return pushHealthPickupFx(pos, col, x, y, life, 1, 1);
}

/**
 * @param {number[]} pos
 * @param {number[]} col
 * @param {number} x
 * @param {number} y
 * @param {number} life
 * @param {number} scale
 * @param {number} alpha
 * @returns {number}
 */
function pushHealthPickupFx(pos, col, x, y, life, scale, alpha){
  let s = 0.1 * (1.0 + 0.2 * Math.sin(8 * life));
  s *= Math.min(1.0, 16 * life);
  s *= Math.max(0, scale);
  const x0 = x - s, x1 = x + s;
  const y0 = y - s, y1 = y + s;
  const a = Math.max(0, Math.min(1, alpha));
  pushTri(pos, col, x0, y0, x1, y0, x1, y1, 0, 1, 0, a);
  pushTri(pos, col, x0, y0, x1, y1, x0, y1, 0, 1, 0, a);
  return 6;
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
  /** @type {Rgba} */
  const bright = [Math.min(1, r + 0.3), Math.min(1, g + 0.3), Math.min(1, b + 0.3), alpha];
  /** @type {Rgba} */
  const dark = [r * 0.55, g * 0.55, b * 0.55, alpha];
  /** @type {Rgba} */
  const mid = [r * 0.85, g * 0.85, b * 0.85, alpha];
  /**
   * @param {number} lx
   * @param {number} ly
   * @returns {[number, number]}
   */
  const toWorld = (lx, ly) => [x + tx * lx + upx * ly, y + ty * lx + upy * ly];
  /**
   * @param {number} v
   * @returns {number}
   */
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  /**
   * @param {number} ly
   * @returns {[number,number,number,number]}
   */
  const colorFor = (ly) => {
    const t = clamp01((ly / (scale || 1)) * 0.5 + 0.5);
    return [
      dark[0] + (bright[0] - dark[0]) * t,
      dark[1] + (bright[1] - dark[1]) * t,
      dark[2] + (bright[2] - dark[2]) * t,
      alpha,
    ];
  };
  /**
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @param {number} cx
   * @param {number} cy
   * @returns {void}
   */
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
    /**
     * @param {number} cx
     * @returns {void}
     */
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
 * @param {"miner"|"pilot"|"engineer"} minerType 
 * @returns {[number,number,number]}
 */
function minerColor(minerType){
  if (minerType === "pilot") {
    return [0.1, 0.25, 0.98];
  } else if (minerType === "engineer") {
    return [0.2, 0.98, 0.2];
  } else {
    return [0.98, 0.85, 0.25];
  }
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
    shipProg, shipVao, shipScale, shipCam, shipViewRot, shipPos, shipRot: shipRotLoc,
    shipOutlineExpandWorld, shipHullTop, shipHullBottom, shipWindowColor, shipGunTop, shipGunBottom, shipOutlineTop, shipOutlineBottom, shipGunOutlineTop, shipGunOutlineBottom, shipTopY, shipBottomY, shipHullSheenAlpha, shipHullSheenFalloff,
    shipRenderOutline, shipOutlineAlphaTop, shipOutlineAlphaBottom, shipLocalBuf, shipBaryBuf, shipEdgeBuf, shipMatBuf, shipOutlineDirBuf,
    planetWireVao, planetWireVertCount,
    starProg, starVao, starRot, starTime, starAspect, starSpan, starSaturation,
    starVertCount,
  } = renderer;
  const vertCount = renderer.vertCount;
  renderer.resize();
  const showGameplayIndicators = state.showGameplayIndicators !== false;

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
  const surfaceShellRadius = planet.getSurfaceShellRadius
    ? planet.getSurfaceShellRadius()
    : (planet.radial ? planet.radial.outerSurfaceRadius() : Math.max(0, rMax - 0.5));
  if (uRmax) gl.uniform1f(uRmax, surfaceShellRadius);
  if (uMeshRmax) gl.uniform1f(uMeshRmax, planet.radial.outerRingRadius());
  if (renderer.uMaxR) gl.uniform1f(renderer.uMaxR, rMax + 0.5);
  gl.drawArrays(gl.TRIANGLES, 0, vertCount);
  gl.bindVertexArray(null);
  if (PERF_FLAGS.disableDynamicOverlay){
    gl.disable(gl.BLEND);
    return;
  }

  /**
   * Runtime visibility for dynamic actors/FX tied to terrain exploration memory.
   * If terrain has been seen once, actors in that region remain visible.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  const shellEntityBand = Math.max(1.1, Math.min(2.0, surfaceShellRadius * 0.035));

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  const visibleEntityNow = (x, y) => {
    if (!state.fogEnabled) return true;
    if (planetFog.fogSeenAt(planet, x, y)) return true;
    if (!state.showVisibleOuterRingEntities) return false;
    if (!planetFog.fogVisibleAt(planet, x, y)) return false;
    return Math.hypot(x, y) >= surfaceShellRadius - shellEntityBand;
  };

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  const visibleHostileNow = (x, y) => {
    return visibleEntityNow(x, y);
  };

  const { shipHWorld, shipWWorld } = getDropshipRenderSize(game);
  const { bodyLiftN, skiLiftN, cargoWidthScale, cargoBottomN, cargoTopBaseN } = DROPSHIP_MODEL;
  const cabinSide = state.ship.cabinSide || 1;
  const { cargoTopN } = getDropshipCargoBoundsN();
  const dropshipGeomN = getDropshipGeometryProfileN();
  const cargoMidN = (cargoBottomN + cargoTopN) * 0.5;
  const oldCargoMidN = (cargoTopBaseN + cargoBottomN) * 0.5;
  const thrustLiftAll = (cargoMidN - oldCargoMidN) * shipHWorld * 1.0;
  const thrustDownExtraUp = shipHWorld * 0.18;
  const thrustUpExtraDown = shipHWorld * -0.12;

  /** @type {number[]} */
  const pos = [];
  /** @type {number[]} */
  const col = [];
  let triVerts = 0;
  let lineVerts = 0;
  let pointVerts = 0;
  let shipTriSplit = -1;
  let aimLineStartVert = -1;
  let aimLineVertCount = 0;
  const planetCfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;

  // Atmosphere ring around the planet (configurable per-planet).
  {
    const atmo = (planetCfg && planetCfg.defaults && planetCfg.defaults.ATMOSPHERE) ? planetCfg.defaults.ATMOSPHERE : null;
    if (!atmo) {
      // no atmosphere for this planet
    } else {
    const rings = planet.radial && planet.radial.rings ? planet.radial.rings : null;
    let outerR = rMax;
    let ringStep = 1.0;
    if (rings && rings.length >= 2){
      const ringOuter = rings[rings.length - 1];
      const ringInner = rings[rings.length - 2];
      if (ringOuter && ringOuter.length){
        let acc = 0;
        for (const v of ringOuter) acc += Math.hypot(v.x, v.y);
        outerR = acc / ringOuter.length;
      }
      if (ringInner && ringInner.length){
        let acc = 0;
        for (const v of ringInner) acc += Math.hypot(v.x, v.y);
        const innerR = acc / ringInner.length;
        ringStep = Math.max(0.5, outerR - innerR);
      }
    }
    const ringCount = Math.max(1, atmo.ringCount || 1);
    const ringOffset = atmo.ringOffset || 0;
    const innerR = outerR + ringStep * ringOffset;
    const outerR2 = innerR + ringStep * ringCount;
    const segs = 96;
    const cIn = atmo.inner || [0.45, 0.72, 1.0, 0.22];
    const cOut = atmo.outer || [0.45, 0.72, 1.0, 0.0];
    for (let i = 0; i < segs; i++){
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const x0i = Math.cos(a0) * innerR;
      const y0i = Math.sin(a0) * innerR;
      const x1i = Math.cos(a1) * innerR;
      const y1i = Math.sin(a1) * innerR;
      const x0o = Math.cos(a0) * outerR2;
      const y0o = Math.sin(a0) * outerR2;
      const x1o = Math.cos(a1) * outerR2;
      const y1o = Math.sin(a1) * outerR2;
      pushTriColored(pos, col, x0i, y0i, x0o, y0o, x1o, y1o, cIn, cOut, cOut);
      pushTriColored(pos, col, x0i, y0i, x1o, y1o, x1i, y1i, cIn, cOut, cIn);
      triVerts += 6;
    }
    }
  }

  const shipRot = Number.isFinite(state.ship.renderAngle)
    ? Number(state.ship.renderAngle)
    : getDropshipWorldRotation(state.ship.x, state.ship.y);
  /**
   * @param {number} c
   * @returns {number}
   */
  const lighten = (c) => Math.min(1, c + 0.3);
  /** @type {Rgb} */
  const rockPoint = [1.0, 0.55, 0.12];
  /** @type {Rgb} */
  const airPoint = [
    lighten(/** @type {number} */ (airLight[0])),
    lighten(/** @type {number} */ (airLight[1])),
    lighten(/** @type {number} */ (airLight[2])),
  ];
  const now = performance.now() * 0.001;
  const invertT = Math.max(0, state.ship.invertT || 0);
  const invertPulse = invertT > 0 ? (0.55 + 0.45 * Math.sin(now * 8)) : 0;
  const invertMix = invertT > 0 ? Math.min(0.65, 0.25 + 0.35 * invertPulse) : 0;
  /** @type {Rgb} */
  const invertTint = (planetCfg && planetCfg.id === "molten")
    ? [1.0, 0.48, 0.16]
    : [0.72, 0.25, 0.9];
  const hitCooldownT = (state.ship.state !== "crashed") ? Math.max(0, state.ship.hitCooldown || 0) : 0;
  const hitCooldownMax = Math.max(1e-6, game.SHIP_HIT_COOLDOWN || 1);
  const damageNorm = hitCooldownT > 0 ? Math.min(1, hitCooldownT / hitCooldownMax) : 0;
  const damagePulse = damageNorm > 0 ? (0.5 + 0.5 * Math.sin(now * 22)) : 0;
  const damageMix = damageNorm > 0 ? ((0.18 + 0.42 * damagePulse) * damageNorm) : 0;
  /** @type {Rgb} */
  const damageTint = [1.0, 0.12, 0.12];
  const lowHullPulse = (state.ship.state !== "crashed" && state.ship.hpCur === 1)
    // Slower critical cycle with a narrow peak so red is a quick flash.
    ? Math.pow(Math.max(0, Math.sin(now * 4.2)), 7)
    : 0;
  const lowHullMix = lowHullPulse > 0 ? (0.48 * lowHullPulse) : 0;
  /** @type {Rgb} */
  const lowHullTint = [1.0, 0.14, 0.14];
  /**
   * @param {number} cr
   * @param {number} cg
   * @param {number} cb
   * @returns {Rgb}
   */
  const applyTint = (cr, cg, cb) => {
    let outR = cr;
    let outG = cg;
    let outB = cb;
    if (invertMix){
      outR = outR * (1 - invertMix) + invertTint[0] * invertMix;
      outG = outG * (1 - invertMix) + invertTint[1] * invertMix;
      outB = outB * (1 - invertMix) + invertTint[2] * invertMix;
    }
    if (damageMix){
      outR = outR * (1 - damageMix) + damageTint[0] * damageMix;
      outG = outG * (1 - damageMix) + damageTint[1] * damageMix;
      outB = outB * (1 - damageMix) + damageTint[2] * damageMix;
    }
    if (lowHullMix){
      outR = outR * (1 - lowHullMix) + lowHullTint[0] * lowHullMix;
      outG = outG * (1 - lowHullMix) + lowHullTint[1] * lowHullMix;
      outB = outB * (1 - lowHullMix) + lowHullTint[2] * lowHullMix;
    }
    return [outR, outG, outB];
  };
  const upLen = Math.hypot(state.ship.x, state.ship.y) || 1;
  const upx = state.ship.x / upLen;
  const upy = state.ship.y / upLen;
  const topY = (cargoTopN + bodyLiftN) * shipHWorld;
  const bottomY = (cargoBottomN + bodyLiftN) * shipHWorld;
  /** @type {Rgb} */
  const silverTop = [0.85, 0.87, 0.9];
  /** @type {Rgb} */
  const silverBottom = [0.55, 0.58, 0.62];
  /**
   * Normalized ship-local coords converted into local world units before ship rotation/translation.
   * @param {number} x
   * @param {number} y
   * @param {number} [liftN]
   * @returns {Vec2}
   */
  const LS = (x, y, liftN = 0) => {
    return [x * shipWWorld, (y + liftN) * shipHWorld];
  };
  /** @type {ActorTri[]} */
  const shipActorTris = [];
  /**
   * @param {Vec2} a
   * @param {Vec2} b
   * @param {Vec2} c
   * @param {number} material
   * @param {boolean} [outline]
   * @returns {void}
   */
  const addShipActorTri = (a, b, c, material, outline = true) => {
    shipActorTris.push({ a, b, c, material, outline });
  };
  /**
   * @param {{x:number,y:number,scale?:number,padNx?:number,padNy?:number}} p
   */
  const drawTurretPadProp = (p) => {
    /** @type {number|undefined} */
    let ux;
    /** @type {number|undefined} */
    let uy;
    if (typeof p.padNx === "number" && typeof p.padNy === "number"){
      const nlen = Math.hypot(p.padNx, p.padNy) || 1;
      ux = p.padNx / nlen;
      uy = p.padNy / nlen;
    } else {
      const normal = planet.normalAtWorld ? planet.normalAtWorld(p.x, p.y) : null;
      if (normal){
        ux = normal.nx;
        uy = normal.ny;
      }
    }
    /** @type {number|undefined} */
    let tx;
    /** @type {number|undefined} */
    let ty;
    if (ux !== undefined && uy !== undefined){
      tx = -uy;
      ty = ux;
    } else {
      const len = Math.hypot(p.x, p.y) || 1;
      ux = p.x / len;
      uy = p.y / len;
      tx = -uy;
      ty = ux;
    }
    const s = p.scale || 1;
    const halfW = 0.55 * s;
    const halfH = 0.12 * s;
    const sink = halfH + 0.02 * s;
    const nx = /** @type {number} */ (ux);
    const ny = /** @type {number} */ (uy);
    const tangentX = /** @type {number} */ (tx);
    const tangentY = /** @type {number} */ (ty);
    const cx = p.x - nx * sink;
    const cy = p.y - ny * sink;
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} lx
     * @param {number} ly
     * @returns {Vec2}
     */
    const toWorld = (x, y, lx, ly) => [x + tangentX * lx + nx * ly, y + tangentY * lx + ny * ly];
    const a0 = toWorld(cx, cy, -halfW, -halfH);
    const a1 = toWorld(cx, cy, halfW, -halfH);
    const a2 = toWorld(cx, cy, halfW, halfH);
    const a3 = toWorld(cx, cy, -halfW, halfH);
    pushTri(pos, col, a0[0], a0[1], a1[0], a1[1], a2[0], a2[1], 0.28, 0.28, 0.30, 0.95);
    pushTri(pos, col, a0[0], a0[1], a2[0], a2[1], a3[0], a3[1], 0.28, 0.28, 0.30, 0.95);
    triVerts += 6;
  };
  const appendShipGeometry = () => {
    if (state.ship.state === "crashed") return;
    {
      const bottomHalfW = dropshipGeomN.bodyBottomHalfWRenderN;
      const topHalfW = dropshipGeomN.bodyTopHalfWRenderN;
      const lb = LS(-bottomHalfW, cargoBottomN, bodyLiftN);
      const rb = LS(bottomHalfW, cargoBottomN, bodyLiftN);
      const rt = LS(topHalfW, cargoTopN, bodyLiftN);
      const lt = LS(-topHalfW, cargoTopN, bodyLiftN);
      addShipActorTri(lb, rb, rt, ACTOR_MATERIAL_HULL, true);
      addShipActorTri(lb, rt, lt, ACTOR_MATERIAL_HULL, true);

      const cabOffset = dropshipGeomN.cabinOffsetN * cabinSide;
      const cabHalfW = dropshipGeomN.cabinHalfWBaseN * dropshipGeomN.cabinHalfWScale;
      const cabBaseY = cargoBottomN;
      const cabTipY = cargoTopN;
      const cabTip = LS(cabOffset, cabTipY, bodyLiftN);
      const cabBL = LS(cabOffset - cabHalfW, cabBaseY, bodyLiftN);
      const cabBR = LS(cabOffset + cabHalfW, cabBaseY, bodyLiftN);
      addShipActorTri(cabBL, cabBR, cabTip, ACTOR_MATERIAL_HULL, true);

      const winHalfW = cabHalfW * dropshipGeomN.windowHalfWScale;
      const winBaseY = cabBaseY + (cabTipY - cabBaseY) * dropshipGeomN.windowBaseT;
      const winTipY = cabBaseY + (cabTipY - cabBaseY) * dropshipGeomN.windowTipT;
      const winTip = LS(cabOffset, winTipY, bodyLiftN);
      const winBL = LS(cabOffset - winHalfW, winBaseY, bodyLiftN);
      const winBR = LS(cabOffset + winHalfW, winBaseY, bodyLiftN);
      addShipActorTri(winBL, winBR, winTip, ACTOR_MATERIAL_WINDOW, false);

      const gunLen = shipHWorld * dropshipGeomN.gunLenH;
      const gunHalfW = shipWWorld * dropshipGeomN.gunHalfWW;
      const mountOffset = gunLen * dropshipGeomN.gunMountBackOffsetLen;
      const mount = LS(0, cargoTopN + dropshipGeomN.gunPivotYInsetN, bodyLiftN);
      const mountCx = mount[0];
      const mountCy = mount[1];
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
      const localDir = rot2(dirx, diry, -shipRot);
      dirx = /** @type {number} */ (localDir[0]);
      diry = /** @type {number} */ (localDir[1]);
      const dirLen = Math.hypot(dirx, diry) || 1;
      dirx /= dirLen;
      diry /= dirLen;
      const px = -diry;
      const py = dirx;
      const gmx = mountCx;
      const gmy = mountCy;
      const backCx = gmx - dirx * mountOffset;
      const backCy = gmy - diry * mountOffset;
      const frontCx = backCx + dirx * gunLen;
      const frontCy = backCy + diry * gunLen;
      // Gun strut/platform should sit behind the gun body in draw order.
      const gstrutW = dropshipGeomN.gunStrutHalfW;
      const gsb0 = LS(-gstrutW, cargoTopN, bodyLiftN);
      const gsb1 = LS(gstrutW, cargoTopN, bodyLiftN);
      const gst0 = LS(-gstrutW, cargoTopN + DROPSHIP_MODEL.gunStrutHeightN, bodyLiftN);
      const gst1 = LS(gstrutW, cargoTopN + DROPSHIP_MODEL.gunStrutHeightN, bodyLiftN);
      addShipActorTri(gsb0, gsb1, gst1, ACTOR_MATERIAL_HULL, false);
      addShipActorTri(gsb0, gst1, gst0, ACTOR_MATERIAL_HULL, false);
      /** @type {Vec2} */
      const backL = [backCx + px * gunHalfW, backCy + py * gunHalfW];
      /** @type {Vec2} */
      const backR = [backCx - px * gunHalfW, backCy - py * gunHalfW];
      /** @type {Vec2} */
      const frontL = [frontCx + px * gunHalfW, frontCy + py * gunHalfW];
      /** @type {Vec2} */
      const frontR = [frontCx - px * gunHalfW, frontCy - py * gunHalfW];
      addShipActorTri(backL, backR, frontR, ACTOR_MATERIAL_GUN, true);
      addShipActorTri(backL, frontR, frontL, ACTOR_MATERIAL_GUN, true);

      // Landing skis under cargo
      const skiY0 = cargoBottomN;
      const skiY1 = dropshipGeomN.skiTopYRenderN;
      const skiHalfW = dropshipGeomN.skiHalfWRenderN;
      const skiOffset = dropshipGeomN.skiOffsetRenderN;
      const skiL0 = LS(-skiOffset - skiHalfW, skiY0, skiLiftN);
      const skiL1 = LS(-skiOffset + skiHalfW, skiY0, skiLiftN);
      const skiL2 = LS(-skiOffset + skiHalfW, skiY1, skiLiftN);
      const skiL3 = LS(-skiOffset - skiHalfW, skiY1, skiLiftN);
      addShipActorTri(skiL0, skiL1, skiL2, ACTOR_MATERIAL_HULL, true);
      addShipActorTri(skiL0, skiL2, skiL3, ACTOR_MATERIAL_HULL, true);
      const skiR0 = LS(skiOffset - skiHalfW, skiY0, skiLiftN);
      const skiR1 = LS(skiOffset + skiHalfW, skiY0, skiLiftN);
      const skiR2 = LS(skiOffset + skiHalfW, skiY1, skiLiftN);
      const skiR3 = LS(skiOffset - skiHalfW, skiY1, skiLiftN);
      addShipActorTri(skiR0, skiR1, skiR2, ACTOR_MATERIAL_HULL, true);
      addShipActorTri(skiR0, skiR2, skiR3, ACTOR_MATERIAL_HULL, true);
      // Ski struts
      const strutW = 0.05;
      const strutTop = cargoBottomN;
      const strutBot = skiY1 + 0.01;
      const sL0 = LS(-skiOffset - strutW, strutBot, skiLiftN);
      const sL1 = LS(-skiOffset + strutW, strutBot, skiLiftN);
      const sL2 = LS(-skiOffset + strutW, strutTop, bodyLiftN);
      const sL3 = LS(-skiOffset - strutW, strutTop, bodyLiftN);
      addShipActorTri(sL0, sL1, sL2, ACTOR_MATERIAL_HULL, false);
      addShipActorTri(sL0, sL2, sL3, ACTOR_MATERIAL_HULL, false);
      const sR0 = LS(skiOffset - strutW, strutBot, skiLiftN);
      const sR1 = LS(skiOffset + strutW, strutBot, skiLiftN);
      const sR2 = LS(skiOffset + strutW, strutTop, bodyLiftN);
      const sR3 = LS(skiOffset - strutW, strutTop, bodyLiftN);
      addShipActorTri(sR0, sR1, sR2, ACTOR_MATERIAL_HULL, false);
      addShipActorTri(sR0, sR2, sR3, ACTOR_MATERIAL_HULL, false);
    }
  };
  appendShipGeometry();
  const shipMeshData = shipActorTris.length ? buildActorMeshData(shipActorTris) : null;

  if (state.enemies && state.enemies.length){
    const tNow = performance.now() * 0.001;
    const outlineSize = 1/16;
    for (const enemy of state.enemies){
      if (!visibleHostileNow(enemy.x, enemy.y)) continue;
      /** @type {EnemyRender} */
      const enemyRender = enemy;
      const base = fragmentBaseColor(enemy.type);
      const moltenStun = !!(planetCfg && planetCfg.id === "molten" && enemy.stunT && enemy.stunT > 0);
      const bodyBase = moltenStun
        ? /** @type {[number,number,number]} */ ([0.92, 0.34, 0.08])
        : base;
      const outline = moltenStun
        ? /** @type {[number,number,number]} */ ([0.55, 0.20, 0.06])
        : /** @type {[number,number,number]} */ ([bodyBase[0] * 0.55, bodyBase[1] * 0.55, bodyBase[2] * 0.55]);
      triVerts += pushEnemyShape(pos, col, enemyRender, outline, game.ENEMY_SCALE, 1, false, outlineSize) * 3;
      triVerts += pushEnemyShape(pos, col, enemyRender, bodyBase, game.ENEMY_SCALE, 1, true) * 3;
      if (enemy.hitT && enemy.hitT > 0){
        const pulse = 0.5 + 0.5 * Math.sin(tNow * 14.0);
        const alpha = 0.25 + pulse * 0.45;
        triVerts += pushEnemyShape(pos, col, enemyRender, [1.0, 0.2, 0.2], game.ENEMY_SCALE * 1.08, alpha, false) * 3;
      }
      if (enemy.stunT && enemy.stunT > 0){
        const pulse = 0.5 + 0.5 * Math.sin(tNow * 10.0);
        const alpha = 0.18 + pulse * 0.24;
        const stunCol = (planetCfg && planetCfg.id === "molten")
          ? /** @type {[number,number,number]} */ ([1.0, 0.38, 0.04])
          : /** @type {[number,number,number]} */ ([0.72, 0.92, 1.0]);
        triVerts += pushEnemyShape(pos, col, enemyRender, stunCol, game.ENEMY_SCALE * 1.12, alpha, false) * 3;
      }
    }
  }

  if (state.mechanizedLarvae && state.mechanizedLarvae.length){
    const tNow = performance.now() * 0.001;
    for (const larva of state.mechanizedLarvae){
      if (!visibleHostileNow(larva.x, larva.y)) continue;
      const speed = Math.hypot(larva.vx || 0, larva.vy || 0);
      let ux;
      let uy;
      if (speed > 1e-4){
        ux = (larva.vx || 0) / speed;
        uy = (larva.vy || 0) / speed;
      } else {
        const len = Math.hypot(larva.x, larva.y) || 1;
        ux = larva.x / len;
        uy = larva.y / len;
      }
      const tx = -uy;
      const ty = ux;
      const s = Math.max(0.05, larva.size || 0.12);
      const pulse = 0.5 + 0.5 * Math.sin(tNow * 18 + (larva.phase || 0));
      /** @type {[number, number, number]} */
      const body = [0.82, 0.88, 0.24];
      /** @type {[number, number, number]} */
      const glow = [1.0, 0.62 + 0.18 * pulse, 0.18];
      /** @type {[number, number, number]} */
      const outline = [0.22, 0.30, 0.10];
      /**
       * @param {number} lx
       * @param {number} ly
       * @returns {[number, number]}
       */
      const toWorld = (lx, ly) => [larva.x + tx * lx + ux * ly, larva.y + ty * lx + uy * ly];
      const tail = toWorld(0, -0.62 * s);
      const left = toWorld(-0.42 * s, -0.06 * s);
      const right = toWorld(0.42 * s, -0.06 * s);
      const tip = toWorld(0, 0.74 * s);
      const finL = toWorld(-0.34 * s, 0.32 * s);
      const finR = toWorld(0.34 * s, 0.32 * s);
      pushTri(pos, col, tail[0], tail[1], left[0], left[1], tip[0], tip[1], outline[0], outline[1], outline[2], 0.96);
      pushTri(pos, col, tail[0], tail[1], tip[0], tip[1], right[0], right[1], outline[0], outline[1], outline[2], 0.96);
      triVerts += 6;
      pushTri(pos, col, left[0], left[1], finL[0], finL[1], tip[0], tip[1], body[0], body[1], body[2], 0.96);
      pushTri(pos, col, right[0], right[1], tip[0], tip[1], finR[0], finR[1], body[0], body[1], body[2], 0.96);
      triVerts += 6;
      triVerts += pushPolyFan(pos, col, larva.x, larva.y + uy * 0.12 * s, 0.22 * s, 6, tNow * 3.4 + (larva.phase || 0), glow[0], glow[1], glow[2], 0.78) * 3;
    }
  }


  if (state.mothership){
    const m = state.mothership;
    const c = Math.cos(m.angle);
    const s3 = Math.sin(m.angle);
    const points = m.renderPoints || m.points;
    const tris = m.renderTris || m.tris;
    /**
     * @param {[number, number, number]} tri
     * @param {boolean} isWall
     * @returns {void}
     */
    const drawTri = (tri, isWall) => {
      const a = /** @type {{x:number,y:number,air?:number}} */ (points[tri[0]]);
      const b = /** @type {{x:number,y:number,air?:number}} */ (points[tri[1]]);
      const d = /** @type {{x:number,y:number,air?:number}} */ (points[tri[2]]);
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
    /**
     * @param {[number, number, number]} tri
     * @param {number} idx
     * @returns {boolean}
     */
    const triIsWall = (tri, idx) => {
      if (m.triAir && idx < m.triAir.length){
        return /** @type {number} */ (m.triAir[idx]) <= 0.5;
      }
      const a = /** @type {{x:number,y:number,air?:number}} */ (points[tri[0]]);
      const b = /** @type {{x:number,y:number,air?:number}} */ (points[tri[1]]);
      const d = /** @type {{x:number,y:number,air?:number}} */ (points[tri[2]]);
      const aAir = ("air" in a) ? a.air : 1;
      const bAir = ("air" in b) ? b.air : 1;
      const cAir = ("air" in d) ? d.air : 1;
      return (aAir + bAir + cAir) / 3 <= 0.5;
    };
    for (let i = 0; i < tris.length; i++){
      const tri = /** @type {[number, number, number]} */ (tris[i]);
      if (!triIsWall(tri, i)) drawTri(tri, false);
    }
    for (let i = 0; i < tris.length; i++){
      const tri = /** @type {[number, number, number]} */ (tris[i]);
      if (triIsWall(tri, i)) drawTri(tri, true);
    }

    {
      const rotCos = Math.cos(state.mothership.angle);
      const rotSin = Math.sin(state.mothership.angle);
      // Cabin occupants should stay aligned to the mothership floor even while
      // the jumpdrive pitches the ship away from its orbital frame.
      const minerUpX = rotSin;
      const minerUpY = -rotCos;
      const minerLocalRangeX = 3.5;
      const minerLocalCenterX = 0.25;
      const minerLocalY = 0.8;
      const numMinersVisible = Math.min(state.ship.mothershipMiners, 20);
      const numPilotsVisible = state.ship.mothershipPilots;
      const numEngineersVisible = Math.min(state.ship.mothershipEngineers, 10);
      const totalMiners = numMinersVisible + numPilotsVisible + numEngineersVisible;
      const minerLocalStepX = Math.min(0.15, minerLocalRangeX / Math.max(1, (totalMiners - 1)));
      const minerLocalMinX = minerLocalCenterX - minerLocalStepX * totalMiners/2;
      let x = 0;
      for (let i = 0; i < totalMiners; ++i) {
        const minerLocalX = minerLocalMinX + x;
        const minerWorldX = state.mothership.x + minerLocalX * rotCos - minerLocalY * rotSin;
        const minerWorldY = state.mothership.y + minerLocalX * rotSin + minerLocalY * rotCos;
        const minerType =
          (i < numPilotsVisible) ? "pilot" :
          (i < (numPilotsVisible + numEngineersVisible)) ? "engineer" :
          "miner";
        const [r, g, b] = minerColor(minerType);
        triVerts += pushMiner(
          pos,
          col,
          minerWorldX,
          minerWorldY,
          0,
          r,
          g,
          b,
          game.MINER_SCALE,
          false,
          1/16,
          { upx: minerUpX, upy: minerUpY }
        ) * 3;
        x += minerLocalStepX;
      }
    }
  }

  {
    const levelProps = planet.props;
    if (levelProps && levelProps.length){
      for (const p of levelProps){
        if (p.type !== "turret_pad") continue;
        if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
        if (!visibleEntityNow(p.x, p.y)) continue;
        drawTurretPadProp(p);
      }
    }
  }
  shipTriSplit = triVerts;

  if (state.miners && state.miners.length){
    for (const miner of state.miners){
      if (!visibleEntityNow(miner.x, miner.y)) continue;
      const [r, g, b] = minerColor(miner.type);
      triVerts += pushMiner(pos, col, miner.x, miner.y, miner.jumpCycle, r, g, b, game.MINER_SCALE, false, 1/16) * 3;
    }
  }

  if (state.fallenMiners && state.fallenMiners.length){
    for (const miner of state.fallenMiners){
      if (!visibleEntityNow(miner.x, miner.y)) continue;
      const [r, g, b] = minerColor(miner.type);
      const maxLife = Math.max(0.001, miner.maxLife || miner.life || 1);
      const t = Math.max(0, Math.min(1, miner.life / maxLife));
      const fadeT = Math.min(1, t / 0.22);
      let upx = miner.upx;
      let upy = miner.upy;
      let deformX = 1;
      let deformY = 1;
      if (miner.mode === "shot"){
        const progress = 1 - t;
        const baseAng = Math.atan2(miner.upy, miner.upx);
        const ang = baseAng + miner.leanDir * progress * Math.PI * 0.52;
        const flattenT = Math.max(0, Math.min(1, (progress - 0.62) / 0.38));
        upx = Math.cos(ang);
        upy = Math.sin(ang);
        deformX = 1 + 0.08 * flattenT;
        deformY = 1 - 0.06 * flattenT;
      } else {
        upx = Math.cos(miner.rot);
        upy = Math.sin(miner.rot);
        deformX = 1.04;
        deformY = 0.96;
      }
      triVerts += pushMiner(
        pos,
        col,
        miner.x,
        miner.y,
        0,
        r,
        g,
        b,
        game.MINER_SCALE,
        false,
        1 / 16,
        { upx, upy, deformX, deformY, alpha: fadeT }
      ) * 3;
    }
  }

  for (const healthPickup of state.healthPickups){
    if (!visibleEntityNow(healthPickup.x, healthPickup.y)) continue;
    triVerts += pushHealthPickup(pos, col, healthPickup.x, healthPickup.y, healthPickup.life);
  }

  if (state.pickupAnimations && state.pickupAnimations.length){
    for (const anim of state.pickupAnimations){
      if (!visibleEntityNow(anim.x, anim.y)) continue;
      const t = Math.max(0, Math.min(1, (anim.t || 0) / Math.max(0.001, anim.duration || 0.18)));
      const ease = 1 - Math.pow(1 - t, 3);
      const scale = 0.35 + (1 - ease) * 0.45;
      const alpha = 0.85 - ease * 0.25;
      if (anim.kind === "health"){
        triVerts += pushHealthPickupFx(pos, col, anim.x, anim.y, 1 - t * 0.4, scale, alpha);
      } else {
        const [r, g, b] = minerColor(anim.kind);
        triVerts += pushMiner(
          pos,
          col,
          anim.x,
          anim.y,
          (1 - t) * 0.08,
          r,
          g,
          b,
          game.MINER_SCALE * scale,
          false,
          1 / 16,
          { alpha, deformX: 1 - t * 0.12, deformY: 1 + t * 0.22 }
        ) * 3;
      }
      triVerts += pushPolyFan(pos, col, anim.x, anim.y, 0.03 + (1 - t) * 0.05, 6, t * 3.2, 1.0, 1.0, 1.0, 0.16 * (1 - t));
    }
  }

  if (state.shots && state.shots.length){
    const size = 0.10;
    for (const s of state.shots){
      if (!visibleHostileNow(s.x, s.y)) continue;
      if (s.owner === "hunter") pushDiamond(pos, col, s.x, s.y, size, 1.0, 0.35, 0.3, 0.9);
      else if (s.owner === "ranger") pushDiamond(pos, col, s.x, s.y, size, 0.3, 0.8, 1.0, 0.9);
      else pushDiamond(pos, col, s.x, s.y, size, 0.5, 0.125, 1.0, 0.9);
      triVerts += 6;
    }
  }

  if (state.playerShots && state.playerShots.length){
    const size = 0.11;
    for (const s of state.playerShots){
      if (!visibleEntityNow(s.x, s.y)) continue;
      pushDiamond(pos, col, s.x, s.y, size, 0.95, 0.95, 0.95, 0.95);
      triVerts += 6;
    }
  }

  if (state.playerBombs && state.playerBombs.length){
    const size = 0.13;
    for (const b of state.playerBombs){
      if (!visibleEntityNow(b.x, b.y)) continue;
      pushSquare(pos, col, b.x, b.y, size, 1.0, 0.7, 0.2, 0.95);
      triVerts += 6;
    }
  }

  const featureParticles = state.featureParticles || null;
  const lavaParticles = featureParticles ? featureParticles.lava : null;
  if (lavaParticles && lavaParticles.length){
    const size = 0.10;
    for (const p of lavaParticles){
      if (!visibleEntityNow(p.x, p.y)) continue;
      pushDiamond(pos, col, p.x, p.y, size, 1.0, 0.25, 0.15, 0.95);
      triVerts += 6;
    }
  }
  const ventPlumeParticles = featureParticles ? featureParticles.ventPlume : null;
  if (ventPlumeParticles && ventPlumeParticles.length){
    for (const p of ventPlumeParticles){
      if (!visibleEntityNow(p.x, p.y)) continue;
      const life = p.life ?? 0;
      const lifeN = (p.maxLife && p.maxLife > 0) ? Math.max(0, Math.min(1, life / p.maxLife)) : 1;
      const size = (p.size || 0.14) * (0.92 + (1 - lifeN) * 0.35);
      pushSquare(pos, col, p.x, p.y, size * 1.15, 1.0, 0.42, 0.08, 0.84 * lifeN);
      pushDiamond(pos, col, p.x, p.y, size * 0.72, 1.0, 0.92, 0.28, 0.96 * lifeN);
      triVerts += 12;
    }
  }
  const sporeParticles = featureParticles ? featureParticles.spores : null;
  if (sporeParticles && sporeParticles.length){
    const size = 0.12;
    for (const p of sporeParticles){
      if (!visibleEntityNow(p.x, p.y)) continue;
      pushDiamond(pos, col, p.x, p.y, size, 0.95, 0.45, 0.75, 0.95);
      triVerts += 6;
    }
  }
  const iceShardParticles = featureParticles ? featureParticles.iceShard : null;
  if (iceShardParticles && iceShardParticles.length){
    for (const p of iceShardParticles){
      if (!visibleEntityNow(p.x, p.y)) continue;
      const life = p.life ?? 0;
      const lifeN = (p.maxLife && p.maxLife > 0) ? Math.max(0, Math.min(1, life / p.maxLife)) : 1;
      const progress = 1 - lifeN;
      const vlen = Math.hypot(p.vx || 0, p.vy || 0) || 1;
      const ux = (p.vx || 0) / vlen;
      const uy = (p.vy || 0) / vlen;
      const tx = -uy;
      const ty = ux;
      const size = (p.size || 0.16) * (0.9 + progress * 0.45);
      const tipX = p.x + ux * (size * 1.25);
      const tipY = p.y + uy * (size * 1.25);
      const baseX = p.x - ux * (size * 0.40);
      const baseY = p.y - uy * (size * 0.40);
      const blX = baseX + tx * (size * 0.52);
      const blY = baseY + ty * (size * 0.52);
      const brX = baseX - tx * (size * 0.52);
      const brY = baseY - ty * (size * 0.52);
      pushTri(pos, col, blX, blY, brX, brY, tipX, tipY, 0.74, 0.92, 1.0, 0.92 * lifeN);
      triVerts += 3;
    }
  }
  const splashParticles = featureParticles ? featureParticles.splashes : null;
  if (splashParticles && splashParticles.length){
    for (const p of splashParticles){
      if (!visibleEntityNow(p.x, p.y)) continue;
      const life = p.life ?? 0;
      const lifeN = (p.maxLife && p.maxLife > 0) ? Math.max(0, Math.min(1, life / p.maxLife)) : 1;
      const vlen = Math.hypot(p.vx || 0, p.vy || 0);
      let ux = 1;
      let uy = 0;
      if (vlen > 1e-4){
        ux = (p.vx || 0) / vlen;
        uy = (p.vy || 0) / vlen;
      } else {
        const r = Math.hypot(p.x, p.y) || 1;
        ux = p.x / r;
        uy = p.y / r;
      }
      const tx = -uy;
      const ty = ux;
      const size = (p.size || 0.1) * (0.8 + 0.35 * lifeN);
      const tipX = p.x + ux * (size * 0.95);
      const tipY = p.y + uy * (size * 0.95);
      const baseX = p.x - ux * (size * 0.42);
      const baseY = p.y - uy * (size * 0.42);
      const blX = baseX + tx * (size * 0.38);
      const blY = baseY + ty * (size * 0.38);
      const brX = baseX - tx * (size * 0.38);
      const brY = baseY - ty * (size * 0.38);
      const cr = (typeof p.cr === "number") ? p.cr : 0.18;
      const cg = (typeof p.cg === "number") ? p.cg : 0.52;
      const cb = (typeof p.cb === "number") ? p.cb : 0.86;
      pushTri(pos, col, blX, blY, brX, brY, tipX, tipY, cr, cg, cb, 0.9 * lifeN);
      triVerts += 3;
    }
  }

  const coreR = planet.getCoreRadius ? planet.getCoreRadius() : 0;
  const coreOverlayVisible = !state.fogEnabled
    || planetFog.hasSeenCoreOverlay(planet);
  if (coreR > 0 && coreOverlayVisible){
    const params = planet.getPlanetParams ? planet.getPlanetParams() : null;
    const moltenOuter = params && typeof params.MOLTEN_RING_OUTER === "number" ? params.MOLTEN_RING_OUTER : 0;
    const r0 = coreR + 0.5;
    const baseOuter = moltenOuter > coreR ? moltenOuter : (coreR + 0.8);
    const r1 = baseOuter + 0.5;
    const steps = 7;
    const pulse = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(now * 1.6));
    for (let i = 0; i < steps; i++){
      const t = (i + 1) / steps;
      const r = r0 + (r1 - r0) * t;
      const root = Math.sqrt(Math.max(0, 1 - t));
      const exp = Math.exp(-2.2 * t);
      const a = (0.85 * root * exp * pulse);
      triVerts += pushPolyFan(pos, col, 0, 0, r, 28, 0, 1.0, 0.25, 0.12, a) * 3;
    }
    triVerts += pushPolyFan(pos, col, 0, 0, r0, 28, 0, 1.0, 0.45, 0.20, 0.9) * 3;
  }

  const props = planet.props;
  if (props && props.length){
    /**
     * @param {number} x
     * @param {number} y
     * @returns {{ux:number,uy:number,tx:number,ty:number}}
     */
    const basisAt = (x, y) => {
      const len = Math.hypot(x, y) || 1;
      const ux = x / len;
      const uy = y / len;
      const tx = -uy;
      const ty = ux;
      return { ux, uy, tx, ty };
    };
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} tx
     * @param {number} ty
     * @param {number} ux
     * @param {number} uy
     * @param {number} lx
     * @param {number} ly
     * @returns {Vec2}
     */
    const toWorld = (x, y, tx, ty, ux, uy, lx, ly) => {
      return [x + tx * lx + ux * ly, y + ty * lx + uy * ly];
    };
    for (const p of props){
      if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
      if (!visibleEntityNow(p.x, p.y)) continue;
      if (p.type === "bubble_hex") continue;
      const rot = (p.rot || 0) + (p.rotSpeed ? p.rotSpeed * now : 0);
      const s = p.scale || 1;
      if (p.type === "turret_pad"){
        continue;
      } else if (p.type === "boulder"){
        triVerts += pushPolyFan(pos, col, p.x, p.y, 0.3 * s, 7, rot, 0.45, 0.45, 0.48, 0.95) * 3;
        triVerts += pushPolyFan(pos, col, p.x, p.y, 0.18 * s, 7, rot, 0.35, 0.35, 0.37, 0.95) * 3;
      } else if (p.type === "ridge_spike"){
        let ux, uy, tx, ty;
        if (typeof p.nx === "number" && typeof p.ny === "number"){
          const nlen = Math.hypot(p.nx, p.ny) || 1;
          ux = p.nx / nlen;
          uy = p.ny / nlen;
          tx = -uy;
          ty = ux;
        } else {
          ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
        }
        const cx = p.x - ux * 0.02 * s;
        const cy = p.y - uy * 0.02 * s;
        const tip = toWorld(cx, cy, tx, ty, ux, uy, 0, 0.62 * s);
        const bl = toWorld(cx, cy, tx, ty, ux, uy, -0.18 * s, -0.08 * s);
        const br = toWorld(cx, cy, tx, ty, ux, uy, 0.18 * s, -0.08 * s);
        pushTri(pos, col, bl[0], bl[1], br[0], br[1], tip[0], tip[1], 0.4, 0.4, 0.42, 0.95);
        triVerts += 3;
      } else if (p.type === "vent"){
        const heat = p.ventHeat ? Math.max(0, Math.min(1, p.ventHeat)) : 0;
        const cr = 0.6 + heat * 0.4;
        const cg = 0.2 + heat * 0.05;
        const cb = 0.1 + heat * 0.05;
        let ux, uy, tx, ty;
        if (typeof p.nx === "number" && typeof p.ny === "number"){
          const nlen = Math.hypot(p.nx, p.ny) || 1;
          ux = p.nx / nlen;
          uy = p.ny / nlen;
          tx = -uy;
          ty = ux;
        } else {
          ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
        }
        const h = 0.9 * s;
        const w0 = 0.28 * s;
        const w1 = 0.16 * s;
        const a0 = toWorld(p.x, p.y, tx, ty, ux, uy, -w0, -h * 0.5);
        const a1 = toWorld(p.x, p.y, tx, ty, ux, uy, w0, -h * 0.5);
        const a2 = toWorld(p.x, p.y, tx, ty, ux, uy, w1, h * 0.5);
        const a3 = toWorld(p.x, p.y, tx, ty, ux, uy, -w1, h * 0.5);
        pushTri(pos, col, a0[0], a0[1], a1[0], a1[1], a2[0], a2[1], cr, cg, cb, 0.95);
        pushTri(pos, col, a0[0], a0[1], a2[0], a2[1], a3[0], a3[1], cr, cg, cb, 0.95);
        triVerts += 6;
        const ih = h * 0.5;
        const iw0 = w0 * 0.55;
        const iw1 = w1 * 0.5;
        const b0 = toWorld(p.x, p.y, tx, ty, ux, uy, -iw0, -ih * 0.5);
        const b1 = toWorld(p.x, p.y, tx, ty, ux, uy, iw0, -ih * 0.5);
        const b2 = toWorld(p.x, p.y, tx, ty, ux, uy, iw1, ih * 0.5);
        const b3 = toWorld(p.x, p.y, tx, ty, ux, uy, -iw1, ih * 0.5);
        pushTri(pos, col, b0[0], b0[1], b1[0], b1[1], b2[0], b2[1], 0.2 + heat * 0.6, 0.05, 0.05, 0.95);
        pushTri(pos, col, b0[0], b0[1], b2[0], b2[1], b3[0], b3[1], 0.2 + heat * 0.6, 0.05, 0.05, 0.95);
        triVerts += 6;
      } else if (p.type === "ice_shard"){
        let ux, uy, tx, ty;
        if (typeof p.nx === "number" && typeof p.ny === "number"){
          const nlen = Math.hypot(p.nx, p.ny) || 1;
          ux = p.nx / nlen;
          uy = p.ny / nlen;
          tx = -uy;
          ty = ux;
        } else {
          const normal = planet.normalAtWorld ? planet.normalAtWorld(p.x, p.y) : null;
          if (normal){
            ux = normal.nx;
            uy = normal.ny;
            tx = -uy;
            ty = ux;
          } else {
            ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
          }
        }
        const tip = toWorld(p.x, p.y, tx, ty, ux, uy, 0, 0.7 * s);
        const bl = toWorld(p.x, p.y, tx, ty, ux, uy, -0.14 * s, -0.05 * s);
        const br = toWorld(p.x, p.y, tx, ty, ux, uy, 0.14 * s, -0.05 * s);
        pushTri(pos, col, bl[0], bl[1], br[0], br[1], tip[0], tip[1], 0.75, 0.9, 1.0, 0.95);
        triVerts += 3;
      } else if (p.type === "tree"){
        let ux, uy, tx, ty;
        if (typeof p.nx === "number" && typeof p.ny === "number"){
          const nlen = Math.hypot(p.nx, p.ny) || 1;
          ux = p.nx / nlen;
          uy = p.ny / nlen;
          tx = -uy;
          ty = ux;
        } else {
          ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
        }
        if (planet.airValueAtWorld && planet.airValueAtWorld(p.x + ux * 0.25, p.y + uy * 0.25) <= 0.5){
          ux = -ux;
          uy = -uy;
          tx = -uy;
          ty = ux;
        }
        const trunkW = 0.07 * s;
        const trunkH = 0.60 * s;
        const t0 = toWorld(p.x, p.y, tx, ty, ux, uy, -trunkW, -0.02 * s);
        const t1 = toWorld(p.x, p.y, tx, ty, ux, uy, trunkW, -0.02 * s);
        const t2 = toWorld(p.x, p.y, tx, ty, ux, uy, trunkW, trunkH);
        const t3 = toWorld(p.x, p.y, tx, ty, ux, uy, -trunkW, trunkH);
        pushTri(pos, col, t0[0], t0[1], t1[0], t1[1], t2[0], t2[1], 0.45, 0.3, 0.18, 0.95);
        pushTri(pos, col, t0[0], t0[1], t2[0], t2[1], t3[0], t3[1], 0.45, 0.3, 0.18, 0.95);
        triVerts += 6;
        const seed = Math.abs(Math.sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453);
        const tierCount = 3 + Math.floor((seed % 1) * 3);
        const tierStep = 0.44 * s;
        const tierOverlap = 0.12 * s;
        const tierHeight = 0.52 * s;
        const baseStart = 0.36 * s;
        for (let i = 0; i < tierCount; i++){
          const t = i / Math.max(1, tierCount);
          const halfW = (0.38 - 0.18 * t) * s;
          const baseY = baseStart + i * Math.max(0.05 * s, tierStep - tierOverlap);
          const tipY = baseY + tierHeight;
          const bl = toWorld(p.x, p.y, tx, ty, ux, uy, -halfW, baseY);
          const br = toWorld(p.x, p.y, tx, ty, ux, uy, halfW, baseY);
          const tip = toWorld(p.x, p.y, tx, ty, ux, uy, 0, tipY);
          const shade = 0.25 + 0.08 * (tierCount - i);
          pushTri(pos, col, bl[0], bl[1], br[0], br[1], tip[0], tip[1], 0.18, 0.52 + shade, 0.20, 0.95);
          triVerts += 3;
        }
      } else if (p.type === "mushroom"){
        let ux, uy, tx, ty;
        if (typeof p.nx === "number" && typeof p.ny === "number"){
          const nlen = Math.hypot(p.nx, p.ny) || 1;
          ux = p.nx / nlen;
          uy = p.ny / nlen;
          tx = -uy;
          ty = ux;
        } else {
          ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
        }
        if (planet.airValueAtWorld && planet.airValueAtWorld(p.x + ux * 0.25, p.y + uy * 0.25) <= 0.5){
          ux = -ux;
          uy = -uy;
          tx = -uy;
          ty = ux;
        }
        const sink = 0.05 * s;
        const cx = p.x - ux * sink;
        const cy = p.y - uy * sink;
        const st0 = toWorld(cx, cy, tx, ty, ux, uy, -0.05 * s, 0);
        const st1 = toWorld(cx, cy, tx, ty, ux, uy, 0.05 * s, 0);
        const st2 = toWorld(cx, cy, tx, ty, ux, uy, 0.05 * s, 0.22 * s);
        const st3 = toWorld(cx, cy, tx, ty, ux, uy, -0.05 * s, 0.22 * s);
        pushTri(pos, col, st0[0], st0[1], st1[0], st1[1], st2[0], st2[1], 0.9, 0.7, 0.9, 0.95);
        pushTri(pos, col, st0[0], st0[1], st2[0], st2[1], st3[0], st3[1], 0.9, 0.7, 0.9, 0.95);
        triVerts += 6;
        const capL = toWorld(cx, cy, tx, ty, ux, uy, -0.26 * s, 0.28 * s);
        const capR = toWorld(cx, cy, tx, ty, ux, uy, 0.26 * s, 0.28 * s);
        const capT = toWorld(cx, cy, tx, ty, ux, uy, 0, 0.48 * s);
        pushTri(pos, col, capL[0], capL[1], capR[0], capR[1], capT[0], capT[1], 0.95, 0.35, 0.75, 0.95);
        triVerts += 3;
      } else if (p.type === "stalactite"){
        let ux, uy, tx, ty;
        if (typeof p.nx === "number" && typeof p.ny === "number"){
          const nlen = Math.hypot(p.nx, p.ny) || 1;
          ux = p.nx / nlen;
          uy = p.ny / nlen;
          tx = -uy;
          ty = ux;
        } else {
          ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
        }
        const cx = p.x - ux * 0.02 * s;
        const cy = p.y - uy * 0.02 * s;
        const tip = toWorld(cx, cy, tx, ty, ux, uy, 0, 0.62 * s);
        const bl = toWorld(cx, cy, tx, ty, ux, uy, -0.18 * s, -0.10 * s);
        const br = toWorld(cx, cy, tx, ty, ux, uy, 0.18 * s, -0.10 * s);
        pushTri(pos, col, bl[0], bl[1], br[0], br[1], tip[0], tip[1], 0.45, 0.45, 0.5, 0.95);
        triVerts += 3;
      } else if (p.type === "tether"){
        let ux, uy, tx, ty;
        if (typeof p.nx === "number" && typeof p.ny === "number"){
          const nlen = Math.hypot(p.nx, p.ny) || 1;
          ux = p.nx / nlen;
          uy = p.ny / nlen;
          tx = -uy;
          ty = ux;
        } else {
          ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
        }
        const halfL = (typeof p.halfLength === "number" && p.halfLength > 0) ? p.halfLength : (0.9 * s);
        const halfW = (typeof p.halfWidth === "number" && p.halfWidth > 0) ? p.halfWidth : (0.12 * s);
        const locked = !!p.locked;
        const flash = Math.max(0, Math.min(1, ((typeof p.flashT === "number") ? p.flashT : 0) / 0.18));
        /** @type {Rgb} */
        const bodyBase = locked ? [0.28, 0.31, 0.38] : [0.78, 0.38, 0.20];
        /** @type {Rgb} */
        const coreBase = locked ? [0.14, 0.17, 0.22] : [1.0, 0.68, 0.32];
        /** @type {Rgb} */
        const bodyCol = [
          bodyBase[0] + (1.0 - bodyBase[0]) * flash,
          bodyBase[1] + (0.95 - bodyBase[1]) * flash,
          bodyBase[2] + (0.78 - bodyBase[2]) * flash,
        ];
        /** @type {Rgb} */
        const coreCol = [
          coreBase[0] + (1.0 - coreBase[0]) * flash,
          coreBase[1] + (0.98 - coreBase[1]) * flash,
          coreBase[2] + (0.88 - coreBase[2]) * flash,
        ];
        const a0 = toWorld(p.x, p.y, tx, ty, ux, uy, -halfW, -halfL);
        const a1 = toWorld(p.x, p.y, tx, ty, ux, uy, halfW, -halfL);
        const a2 = toWorld(p.x, p.y, tx, ty, ux, uy, halfW, halfL);
        const a3 = toWorld(p.x, p.y, tx, ty, ux, uy, -halfW, halfL);
        pushTri(pos, col, a0[0], a0[1], a1[0], a1[1], a2[0], a2[1], bodyCol[0], bodyCol[1], bodyCol[2], 0.98);
        pushTri(pos, col, a0[0], a0[1], a2[0], a2[1], a3[0], a3[1], bodyCol[0], bodyCol[1], bodyCol[2], 0.98);
        triVerts += 6;
        const iw = halfW * 0.45;
        const i0 = toWorld(p.x, p.y, tx, ty, ux, uy, -iw, -halfL);
        const i1 = toWorld(p.x, p.y, tx, ty, ux, uy, iw, -halfL);
        const i2 = toWorld(p.x, p.y, tx, ty, ux, uy, iw, halfL);
        const i3 = toWorld(p.x, p.y, tx, ty, ux, uy, -iw, halfL);
        pushTri(pos, col, i0[0], i0[1], i1[0], i1[1], i2[0], i2[1], coreCol[0], coreCol[1], coreCol[2], locked ? 0.65 : 0.95);
        pushTri(pos, col, i0[0], i0[1], i2[0], i2[1], i3[0], i3[1], coreCol[0], coreCol[1], coreCol[2], locked ? 0.65 : 0.95);
        triVerts += 6;
      } else if (p.type === "gate"){
        let ux, uy, tx, ty;
        if (typeof p.nx === "number" && typeof p.ny === "number"){
          const nlen = Math.hypot(p.nx, p.ny) || 1;
          ux = p.nx / nlen;
          uy = p.ny / nlen;
          tx = -uy;
          ty = ux;
        } else {
          ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
        }
        const cx = p.x - ux * 0.02 * s;
        const cy = p.y - uy * 0.02 * s;
        const hw = 0.62 * s;
        const hh = 0.14 * s;
        const a0 = toWorld(cx, cy, tx, ty, ux, uy, -hw, -hh);
        const a1 = toWorld(cx, cy, tx, ty, ux, uy, hw, -hh);
        const a2 = toWorld(cx, cy, tx, ty, ux, uy, hw, hh);
        const a3 = toWorld(cx, cy, tx, ty, ux, uy, -hw, hh);
        pushTri(pos, col, a0[0], a0[1], a1[0], a1[1], a2[0], a2[1], 0.32, 0.33, 0.36, 0.96);
        pushTri(pos, col, a0[0], a0[1], a2[0], a2[1], a3[0], a3[1], 0.32, 0.33, 0.36, 0.96);
        triVerts += 6;
        const iw = hw * 0.82;
        const ih = hh * 0.38;
        const b0 = toWorld(cx, cy, tx, ty, ux, uy, -iw, -ih);
        const b1 = toWorld(cx, cy, tx, ty, ux, uy, iw, -ih);
        const b2 = toWorld(cx, cy, tx, ty, ux, uy, iw, ih);
        const b3 = toWorld(cx, cy, tx, ty, ux, uy, -iw, ih);
        pushTri(pos, col, b0[0], b0[1], b1[0], b1[1], b2[0], b2[1], 0.16, 0.17, 0.19, 0.95);
        pushTri(pos, col, b0[0], b0[1], b2[0], b2[1], b3[0], b3[1], 0.16, 0.17, 0.19, 0.95);
        triVerts += 6;
      } else if (p.type === "factory"){
        let ux, uy, tx, ty;
        if (typeof p.nx === "number" && typeof p.ny === "number"){
          const nlen = Math.hypot(p.nx, p.ny) || 1;
          ux = p.nx / nlen;
          uy = p.ny / nlen;
          tx = -uy;
          ty = ux;
        } else {
          ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
        }
        const sink = 0.08 * s;
        const cx = p.x - ux * sink;
        const cy = p.y - uy * sink;
        const halfBase = 0.46 * s;
        const halfTop = 0.30 * s;
        const h = 0.56 * s;
        const factoryHitNorm = (typeof p.hitT === "number" && p.hitT > 0)
          ? Math.min(1, p.hitT / 0.35)
          : 0;
        const factoryHitPulse = factoryHitNorm > 0 ? (0.5 + 0.5 * Math.sin(now * 18.0)) : 0;
        const factoryHitMix = factoryHitNorm > 0
          ? ((0.24 + 0.5 * factoryHitPulse) * factoryHitNorm)
          : 0;
        /**
         * @param {number} r
         * @param {number} g
         * @param {number} b
         * @returns {Rgb}
         */
        const tintFactory = (r, g, b) => {
          if (factoryHitMix <= 0) return [r, g, b];
          return [
            r * (1 - factoryHitMix) + 1.0 * factoryHitMix,
            g * (1 - factoryHitMix) + 0.2 * factoryHitMix,
            b * (1 - factoryHitMix) + 0.2 * factoryHitMix,
          ];
        };
        const bodyCol = tintFactory(0.38, 0.39, 0.42);
        const doorCol = tintFactory(0.14, 0.15, 0.17);
        const stackCol = tintFactory(0.30, 0.31, 0.34);
        const a0 = toWorld(cx, cy, tx, ty, ux, uy, -halfBase, 0);
        const a1 = toWorld(cx, cy, tx, ty, ux, uy, halfBase, 0);
        const a2 = toWorld(cx, cy, tx, ty, ux, uy, halfTop, h);
        const a3 = toWorld(cx, cy, tx, ty, ux, uy, -halfTop, h);
        pushTri(pos, col, a0[0], a0[1], a1[0], a1[1], a2[0], a2[1], bodyCol[0], bodyCol[1], bodyCol[2], 0.98);
        pushTri(pos, col, a0[0], a0[1], a2[0], a2[1], a3[0], a3[1], bodyCol[0], bodyCol[1], bodyCol[2], 0.98);
        triVerts += 6;
        const doorW = 0.11 * s;
        const doorH = 0.22 * s;
        const d0 = toWorld(cx, cy, tx, ty, ux, uy, -doorW, 0.02 * s);
        const d1 = toWorld(cx, cy, tx, ty, ux, uy, doorW, 0.02 * s);
        const d2 = toWorld(cx, cy, tx, ty, ux, uy, doorW, doorH);
        const d3 = toWorld(cx, cy, tx, ty, ux, uy, -doorW, doorH);
        pushTri(pos, col, d0[0], d0[1], d1[0], d1[1], d2[0], d2[1], doorCol[0], doorCol[1], doorCol[2], 0.96);
        pushTri(pos, col, d0[0], d0[1], d2[0], d2[1], d3[0], d3[1], doorCol[0], doorCol[1], doorCol[2], 0.96);
        triVerts += 6;
        const sx = halfTop * 0.55;
        const sw = 0.07 * s;
        const sh = 0.26 * s;
        const st0 = toWorld(cx, cy, tx, ty, ux, uy, sx - sw, h);
        const st1 = toWorld(cx, cy, tx, ty, ux, uy, sx + sw, h);
        const st2 = toWorld(cx, cy, tx, ty, ux, uy, sx + sw, h + sh);
        const st3 = toWorld(cx, cy, tx, ty, ux, uy, sx - sw, h + sh);
        pushTri(pos, col, st0[0], st0[1], st1[0], st1[1], st2[0], st2[1], stackCol[0], stackCol[1], stackCol[2], 0.95);
        pushTri(pos, col, st0[0], st0[1], st2[0], st2[1], st3[0], st3[1], stackCol[0], stackCol[1], stackCol[2], 0.95);
        triVerts += 6;
      }
    }
  }

  // Base world triangles end here.
  triVerts = pos.length / 2;

  /**
   * @param {{x:number,y:number,life?:number,maxLife?:number,radius?:number}} ex
   * @returns {void}
   */
  const pushCrawlerExplosionShards = (ex) => {
    if (!visibleHostileNow(ex.x, ex.y)) return;
    const maxLife = Math.max(0.001, ex.maxLife ?? 0.5);
    const t = Math.max(0, Math.min(1, (ex.life ?? 0) / maxLife));
    const baseRadius = ex.radius ?? 0.8;
    const alpha = 0.85 * t;
    const burstN = 6;
    const burstPhase = Math.max(0, Math.min(1, (1 - t) * 2));
    const burstCenterR = baseRadius * (0.18 + 0.50 * burstPhase);
    const burstLen = baseRadius * 0.55;
    const burstHalfW = baseRadius * 0.095;
    for (let i = 0; i < burstN; i++){
      const travelA = (i / burstN) * Math.PI * 2 + burstPhase * 0.18;
      const cx = ex.x + Math.cos(travelA) * burstCenterR;
      const cy = ex.y + Math.sin(travelA) * burstCenterR;
      const spinDir = (i & 1) ? -1 : 1;
      const a = travelA + spinDir * burstPhase * 1.3;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const tx = -uy;
      const ty = ux;
      const tipX = cx + ux * (burstLen * 0.58);
      const tipY = cy + uy * (burstLen * 0.58);
      const baseCx = cx - ux * (burstLen * 0.42);
      const baseCy = cy - uy * (burstLen * 0.42);
      pushTri(
        pos,
        col,
        baseCx + tx * burstHalfW,
        baseCy + ty * burstHalfW,
        baseCx - tx * burstHalfW,
        baseCy - ty * burstHalfW,
        tipX,
        tipY,
        1.0,
        0.68,
        0.18,
        0.92 * alpha
      );
      triVerts += 3;
      pushTri(
        pos,
        col,
        cx + ux * (burstLen * 0.08),
        cy + uy * (burstLen * 0.08),
        baseCx + tx * (burstHalfW * 0.45),
        baseCy + ty * (burstHalfW * 0.45),
        baseCx - tx * (burstHalfW * 0.45),
        baseCy - ty * (burstHalfW * 0.45),
        1.0,
        0.95,
        0.48,
        0.55 * alpha
      );
      triVerts += 3;
    }
  };

  /**
   * @param {import("./types.d.js").Debris} d
   * @returns {void}
   */
  const pushFragmentShard = (d) => {
    const ownerType = d.ownerType || "crawler";
    const visible = (
      ownerType === "dropship"
      || ownerType === "miner"
      || ownerType === "pilot"
      || ownerType === "engineer"
      || ownerType === "rock"
    )
      ? visibleEntityNow(d.x, d.y)
      : visibleHostileNow(d.x, d.y);
    if (!visible) return;
    const maxLife = Math.max(0.001, d.maxLife ?? d.life ?? 1);
    const t = Math.max(0, Math.min(1, d.life / maxLife));
    const fadeT = Math.min(1, t / 0.22);
    const base = (
      Number.isFinite(d.cr) && Number.isFinite(d.cg) && Number.isFinite(d.cb)
    )
      ? /** @type {[number,number,number]} */ ([Number(d.cr), Number(d.cg), Number(d.cb)])
      : fragmentBaseColor(ownerType);
    const glow = brightenColor(base, 0.4);
    const len = d.size ?? (0.16 * game.ENEMY_SCALE);
    const sides = Number.isFinite(d.sides) ? Math.max(3, Math.floor(Number(d.sides))) : 0;
    if (sides >= 5){
      triVerts += pushPolyFan(pos, col, d.x, d.y, len, sides, d.a, base[0], base[1], base[2], 0.92 * fadeT) * 3;
      triVerts += pushPolyFan(pos, col, d.x, d.y, len * 0.58, sides, d.a + 0.15, glow[0], glow[1], glow[2], 0.45 * fadeT) * 3;
      return;
    }
    const stretch = d.stretch ?? 1.7;
    const halfW = len * 0.42;
    const ux = Math.cos(d.a);
    const uy = Math.sin(d.a);
    const tx = -uy;
    const ty = ux;
    const tipX = d.x + ux * len * stretch;
    const tipY = d.y + uy * len * stretch;
    const baseCx = d.x - ux * len * 0.6;
    const baseCy = d.y - uy * len * 0.6;
    pushTri(
      pos,
      col,
      baseCx + tx * halfW,
      baseCy + ty * halfW,
      baseCx - tx * halfW,
      baseCy - ty * halfW,
      tipX,
      tipY,
      base[0],
      base[1],
      base[2],
      0.92 * fadeT
    );
    triVerts += 3;
    pushTri(
      pos,
      col,
      d.x + ux * len * 0.1,
      d.y + uy * len * 0.1,
      baseCx + tx * (halfW * 0.45),
      baseCy + ty * (halfW * 0.45),
      baseCx - tx * (halfW * 0.45),
      baseCy - ty * (halfW * 0.45),
      glow[0],
      glow[1],
      glow[2],
      0.55 * fadeT
    );
    triVerts += 3;
  };

  if (state.explosions && state.explosions.length){
    for (const ex of state.explosions){
      if (ex.owner !== "crawler") continue;
      pushCrawlerExplosionShards(ex);
    }
  }

  if (state.fragments && state.fragments.length){
    for (const d of state.fragments){
      pushFragmentShard(d);
    }
  }

  /**
   * @param {number} dx
   * @param {number} dy
   * @param {number} r
   * @param {number} g
   * @param {number} b
   * @param {number} [extraOffset]
   * @param {number} [lift]
   * @param {number} [power]
   */
  const thrustV = (dx, dy, r, g, b, extraOffset = 0, lift = 0, power = 1) => {
    const mag = Math.hypot(dx, dy) || 1;
    const p = Math.max(0, Math.min(1, power));
    const posUx = -dx / mag;
    const posUy = -dy / mag;
    const ux = dx / mag;
    const uy = dy / mag;
    const len = shipHWorld * (0.14 + 0.22 * p);
    const spread = shipHWorld * (0.06 + 0.09 * p);
    const px = -uy;
    const py = ux;
    const offset = shipHWorld * 0.72 + extraOffset;
    const tipx = ux * len;
    const tipy = uy * len;
    const b1x = -ux * len * 0.45 + px * spread;
    const b1y = -uy * len * 0.45 + py * spread;
    const b2x = -ux * len * 0.45 - px * spread;
    const b2y = -uy * len * 0.45 - py * spread;
    const liftRot = rot2(0, lift, shipRot);
    const lx = /** @type {number} */ (liftRot[0]);
    const ly = /** @type {number} */ (liftRot[1]);
    const tipRot = rot2(tipx + posUx * offset, tipy + posUy * offset, shipRot);
    const tx = /** @type {number} */ (tipRot[0]);
    const ty = /** @type {number} */ (tipRot[1]);
    const p1Rot = rot2(b1x + posUx * offset, b1y + posUy * offset, shipRot);
    const p1x = /** @type {number} */ (p1Rot[0]);
    const p1y = /** @type {number} */ (p1Rot[1]);
    const p2Rot = rot2(b2x + posUx * offset, b2y + posUy * offset, shipRot);
    const p2x = /** @type {number} */ (p2Rot[0]);
    const p2y = /** @type {number} */ (p2Rot[1]);
    const a = 0.35 + 0.65 * p;
    pushLine(pos, col, state.ship.x + p1x + lx, state.ship.y + p1y + ly, state.ship.x + tx + lx, state.ship.y + ty + ly, r, g, b, a);
    pushLine(pos, col, state.ship.x + p2x + lx, state.ship.y + p2y + ly, state.ship.x + tx + lx, state.ship.y + ty + ly, r, g, b, a);
    lineVerts += 4;
  };

  if (state.ship.state !== "crashed"){
    /**
     * 
     * @param {number} x 
     * @param {number} y 
     * @param {number} r 
     * @param {number} g 
     * @param {number} b 
     */
    const drawOffscreenIndicator = (x, y, r, g, b) => {
      const dX = x - state.view.xCenter;
      const dY = y - state.view.yCenter;

      const camRotCos = Math.cos(-camRot);
      const camRotSin = Math.sin(-camRot);

      const horzLen = 0.9 / sx;
      const horzX = camRotCos * horzLen;
      const horzY = camRotSin * horzLen;

      const vertLen = 0.9 / sy;
      const vertX = -camRotSin * vertLen;
      const vertY = camRotCos * vertLen;

      let u = 1;

      let projection = (dX * horzX + dY * horzY) / (horzX * horzX + horzY * horzY);
      u = Math.min(u, 1 / (Math.max(1, projection)));

      projection = (dX * -horzX + dY * -horzY) / (horzX * horzX + horzY * horzY);
      u = Math.min(u, 1 / (Math.max(1, projection)));

      projection = (dX * vertX + dY * vertY) / (vertX * vertX + vertY * vertY);
      u = Math.min(u, 1 / (Math.max(1, projection)));

      projection = (dX * -vertX + dY * -vertY) / (vertX * vertX + vertY * vertY);
      u = Math.min(u, 1 / (Math.max(1, projection)));

      if (u < 1) {
        const mx = state.view.xCenter + dX * u;
        const my = state.view.yCenter + dY * u;

        const n = Math.hypot(dX, dY);
        const s = state.view.radius * 0.05;
        const nx = dX / n;
        const ny = dY / n;
        const tx = -0.5 * ny;
        const ty =  0.5 * nx;
        const ax = mx + s * (-nx - tx);
        const ay = my + s * (-ny - ty);
        const bx = mx + s * (-nx + tx);
        const by = my + s * (-ny + ty);
        const thickness = Math.max(0.03, s * 0.16);
        pushThickLine(pos, col, mx, my, ax, ay, thickness, r, g, b, 0.9);
        pushThickLine(pos, col, mx, my, bx, by, thickness, r, g, b, 0.9);
        triVerts += 12;
      }
    };

    if (showGameplayIndicators){
      if (state.mothership) {
        const rotCos = Math.cos(state.mothership.angle);
        const rotSin = Math.sin(state.mothership.angle);
        const localX = -2.75;
        const localY = 1.0;
        const x = state.mothership.x + localX * rotCos - localY * rotSin;
        const y = state.mothership.y + localX * rotSin + localY * rotCos;
        drawOffscreenIndicator(x, y, 0.5, 0.84, 1.0);
      }

      if (state.ship.rescueeDetector){
        let closestRescuee = null;
        let closestDistSqr = Infinity;
        for (const miner of state.miners){
          const dx = miner.x - state.ship.x;
          const dy = miner.y - state.ship.y;
          const distSqr = dx*dx + dy*dy;
          if (distSqr < closestDistSqr){
            closestDistSqr = distSqr;
            closestRescuee = miner;
          }
        }
        if (closestRescuee !== null){
          const [r, g, b] = minerColor("miner");
          drawOffscreenIndicator(closestRescuee.x, closestRescuee.y, r, g, b);
        }
      }

      if (state.ship.state === "flying"){
        const thickness = state.view.radius * 0.008;

        // Braking line

        /** @type (x: number, y: number) => boolean */
        const isInsideMothership = (x, y) => {
          const mothership = /** @type {NonNullable<typeof state.mothership>} */ (state.mothership);
          x -= mothership.x;
          y -= mothership.y;
          const rotCos = Math.cos(mothership.angle);
          const rotSin = Math.sin(mothership.angle);
          const xLocal = x * rotCos + y *  rotSin;
          const yLocal = x * rotSin + y * -rotCos;
          // Hard-coding the dimensions of the mothership in its local coordinate
          // system; might be better to ask the mothership.
          return yLocal < 1.2 && yLocal > -1.2 && xLocal > -4 && xLocal < 2.75;
        };

        const insideMothership = isInsideMothership(state.ship.x, state.ship.y);

        const thrustMax = planet.planetParams.THRUST * (1 + state.ship.thrust * 0.1);
        const inertialDriveThrust = getInertialDriveThrust(game, state.ship.inertialDrive);

        let vx = state.ship.vx;
        let vy = state.ship.vy;

        if (insideMothership){
          const mothership = /** @type {NonNullable<typeof state.mothership>} */ (state.mothership);
          vx -= mothership.vx;
          vy -= mothership.vy;
        }

        const vscale = vScaleStopping(planet, state.ship.x, state.ship.y, vx, vy, thrustMax + inertialDriveThrust);
        vx *= vscale;
        vy *= vscale;
        
        const r1 = Math.hypot(vx, vy);
        const r0 = 0.35;
        if (r1 > r0){
          const x1 = state.ship.x + vx;
          const y1 = state.ship.y + vy;
          const x0 = state.ship.x + vx * r0 / r1;
          const y0 = state.ship.y + vy * r0 / r1;
          pushThickLine(pos, col, x0, y0, x1, y1, thickness, 0.5, 0.84, 1.0, 0.5);
          triVerts += 6;
        }

        // Orbit apogee and perigee

        if (!insideMothership){
          const {rPerigee: rPerigee, rApogee: rApogee} = planet.perigeeAndApogee(state.ship.x, state.ship.y, state.ship.vx, state.ship.vy);
          const rMin = rMax - 0.5;
          if (rPerigee >= rMin) {
            const r = Math.hypot(state.ship.x, state.ship.y);
            const dirX = state.ship.x / r;
            const dirY = state.ship.y / r;

            const crossTickSize = 0.01 * state.view.radius;
            const crossX = -dirY * crossTickSize;
            const crossY = dirX * crossTickSize;

            const upX0 = dirX * thickness / 2;
            const upY0 = dirY * thickness / 2;

            const upLen = Math.min(2 * crossTickSize, (rApogee - rPerigee) / 2);
            const upX1 = dirX * upLen;
            const upY1 = dirY * upLen;

            const apoX = dirX * rApogee;
            const apoY = dirY * rApogee;

            const periX = dirX * rPerigee;
            const periY = dirY * rPerigee;

            let offsetX = -dirY * (crossTickSize + 0.35);
            let offsetY = dirX * (crossTickSize + 0.35);
            if (state.ship.x * state.ship.vy - state.ship.y * state.ship.vx < 0){
              offsetX = -offsetX;
              offsetY = -offsetY;
            }

            pushThickLine(pos, col, apoX + offsetX - crossX, apoY + offsetY - crossY, apoX + offsetX + crossX, apoY + offsetY + crossY, thickness, 0.5, 0.84, 1.0, 0.5);
            pushThickLine(pos, col, periX + offsetX - crossX, periY + offsetY - crossY, periX + offsetX + crossX, periY + offsetY + crossY, thickness, 0.5, 0.84, 1.0, 0.5);
            pushThickLine(pos, col, apoX + offsetX - upX0, apoY + offsetY - upY0, apoX + offsetX - upX1, apoY + offsetY - upY1, thickness, 0.5, 0.84, 1.0, 0.5);
            pushThickLine(pos, col, periX + offsetX + upX0, periY + offsetY + upY0, periX + offsetX + upX1, periY + offsetY + upY1, thickness, 0.5, 0.84, 1.0, 0.5);
            triVerts += 24;
          }
        }
      }
    }

    /** @type {Rgb} */
    const tc = [1.0, 0.55, 0.15];
    const thrusterPower = getDropshipThrusterPowers(state.input || {});
    const manualThrustersActive = (
      thrusterPower.up > 1e-3
      || thrusterPower.down > 1e-3
      || thrusterPower.left > 1e-3
      || thrusterPower.right > 1e-3
    );
    if (thrusterPower.up > 0){
      thrustV(0, 1, tc[0], tc[1], tc[2], shipHWorld * 0.2, thrustLiftAll + thrustUpExtraDown, thrusterPower.up);
    }
    if (thrusterPower.down > 0){
      thrustV(0, -1, tc[0], tc[1], tc[2], shipHWorld * 0.35, thrustLiftAll + thrustDownExtraUp, thrusterPower.down);
    }
    if (thrusterPower.left > 0){
      thrustV(-1, 0, tc[0], tc[1], tc[2], shipWWorld * 0.5, thrustLiftAll, thrusterPower.left);
    }
    if (thrusterPower.right > 0){
      thrustV(1, 0, tc[0], tc[1], tc[2], shipWWorld * 0.5, thrustLiftAll, thrusterPower.right);
    }
    if (!manualThrustersActive && state.ship.state === "flying"){
      const speed = Math.hypot(state.ship.vx, state.ship.vy);
      if (speed <= 0.18){
        const idlePulse = 0.12 + 0.05 * (0.5 + 0.5 * Math.sin(now * 11.0));
        thrustV(0, 1, 0.95, 0.68, 0.22, shipHWorld * 0.14, thrustLiftAll + thrustUpExtraDown * 0.35, idlePulse);
      }
    }
  }

  if (showGameplayIndicators && state.aimWorld){
    const ao = state.aimOrigin || state.ship;
    aimLineStartVert = pos.length / 2;
    pushLine(pos, col, ao.x, ao.y, state.aimWorld.x, state.aimWorld.y, 0.85, 0.9, 1.0, 0.65);
    aimLineVertCount = 2;
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
      const maxLife = Math.max(0.001, d.maxLife ?? d.life ?? 1);
      const t = Math.max(0, Math.min(1, d.life / maxLife));
      const len = d.size ?? (shipHWorld * 0.18);
      const hx = Math.cos(d.a) * len;
      const hy = Math.sin(d.a) * len;
      pushLine(
        pos,
        col,
        d.x - hx,
        d.y - hy,
        d.x + hx,
        d.y + hy,
        d.cr ?? 0.9,
        d.cg ?? 0.9,
        d.cb ?? 0.9,
        (d.alpha ?? 0.9) * t
      );
      lineVerts += 2;
    }
  }

  if (state.explosions && state.explosions.length){
    for (const ex of state.explosions){
      if (!visibleHostileNow(ex.x, ex.y)) continue;
      const maxLife = Math.max(0.001, ex.maxLife ?? 0.5);
      const t = Math.max(0, Math.min(1, ex.life / maxLife));
      const baseRadius = ex.radius ?? 0.8;
      if (ex.owner === "crawler"){
        const ringR = baseRadius * (0.4 + (1 - t) * 0.52);
        const alpha = 0.85 * t;
        const seg = 14;
        for (let i = 0; i < seg; i++){
          const a0 = (i / seg) * Math.PI * 2;
          const a1 = ((i + 1) / seg) * Math.PI * 2;
          const wobble0 = 0.88 + 0.16 * Math.sin((1 - t) * 12 + i * 0.9);
          const wobble1 = 0.88 + 0.16 * Math.sin((1 - t) * 12 + (i + 1) * 0.9);
          const x0 = ex.x + Math.cos(a0) * ringR * wobble0;
          const y0 = ex.y + Math.sin(a0) * ringR * wobble0;
          const x1 = ex.x + Math.cos(a1) * ringR * wobble1;
          const y1 = ex.y + Math.sin(a1) * ringR * wobble1;
          pushLine(pos, col, x0, y0, x1, y1, 1.0, 0.7, 0.2, alpha);
          lineVerts += 2;
        }
        const spokeR = ringR * (0.35 + 0.25 * (1 - t));
        const spokeOuter = Math.min(baseRadius, ringR * 1.08);
        for (let i = 0; i < 4; i++){
          const a = i * Math.PI * 0.5 + (1 - t) * 0.35;
          const ix = ex.x + Math.cos(a) * spokeR;
          const iy = ex.y + Math.sin(a) * spokeR;
          const ox = ex.x + Math.cos(a) * spokeOuter;
          const oy = ex.y + Math.sin(a) * spokeOuter;
          pushLine(pos, col, ix, iy, ox, oy, 1.0, 0.95, 0.5, 0.95 * alpha);
          lineVerts += 2;
        }
      } else {
        const r = baseRadius * (0.4 + (1 - t) * 0.75);
        pushLine(pos, col, ex.x - r, ex.y, ex.x + r, ex.y, 1.0, 0.5, 0.3, 0.8 * t);
        pushLine(pos, col, ex.x, ex.y - r, ex.x, ex.y + r, 1.0, 0.5, 0.3, 0.8 * t);
        lineVerts += 4;
      }
    }
  }

  if (state.entityExplosions && state.entityExplosions.length){
    for (const ex of state.entityExplosions){
      if (!visibleHostileNow(ex.x, ex.y)) continue;
      const t = Math.max(0, Math.min(1, ex.life / 0.8));
      const r = (ex.radius ?? 1.0) * (0.4 + (1 - t) * 0.9);
      const alpha = 0.9 * t;
      const er = Number.isFinite(ex.cr) ? Number(ex.cr) : 1.0;
      const eg = Number.isFinite(ex.cg) ? Number(ex.cg) : 0.9;
      const eb = Number.isFinite(ex.cb) ? Number(ex.cb) : 0.4;
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
        pushLine(pos, col, x0, y0, x1, y1, er, eg, eb, alpha);
        lineVerts += 2;
      }
      pushLine(pos, col, ex.x - r * 0.6, ex.y, ex.x + r * 0.6, ex.y, Math.min(1, er), Math.min(1, eg + 0.05), Math.min(1, eb + 0.08), 0.7 * alpha);
      pushLine(pos, col, ex.x, ex.y - r * 0.6, ex.x, ex.y + r * 0.6, Math.min(1, er), Math.min(1, eg + 0.05), Math.min(1, eb + 0.08), 0.7 * alpha);
      lineVerts += 4;
    }
  }

  if (props && props.length){
    for (const p of props){
      if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
      if (p.type !== "bubble_hex") continue;
      if (!visibleEntityNow(p.x, p.y)) continue;
      const rot = (p.rot || 0) + (p.rotSpeed ? p.rotSpeed * now : 0);
      const s = p.scale || 1;
      pushHexOutline(pos, col, p.x, p.y, 0.28 * s, rot, 0.60, 0.62, 0.66, 0.78);
      lineVerts += 12;
    }
    /**
     * @param {number} x
     * @param {number} y
     * @returns {{ux:number,uy:number,tx:number,ty:number}}
     */
    const basisAt = (x, y) => {
      const len = Math.hypot(x, y) || 1;
      const ux = x / len;
      const uy = y / len;
      const tx = -uy;
      const ty = ux;
      return { ux, uy, tx, ty };
    };
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} tx
     * @param {number} ty
     * @param {number} ux
     * @param {number} uy
     * @param {number} lx
     * @param {number} ly
     * @returns {Vec2}
     */
    const toWorld = (x, y, tx, ty, ux, uy, lx, ly) => {
      return [x + tx * lx + ux * ly, y + ty * lx + uy * ly];
    };
    for (const p of props){
      if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
      if (p.type !== "ridge_spike" && p.type !== "stalactite" && p.type !== "ice_shard") continue;
      if (!visibleEntityNow(p.x, p.y)) continue;
      let ux, uy, tx, ty;
      if (typeof p.nx === "number" && typeof p.ny === "number"){
        const nlen = Math.hypot(p.nx, p.ny) || 1;
        ux = p.nx / nlen;
        uy = p.ny / nlen;
        tx = -uy;
        ty = ux;
      } else {
        ({ ux, uy, tx, ty } = basisAt(p.x, p.y));
      }
      const s = p.scale || 1;
      const isIce = p.type === "ice_shard";
      const cx = p.x - ux * (isIce ? 0.0 : 0.02 * s);
      const cy = p.y - uy * (isIce ? 0.0 : 0.02 * s);
      const tipY = (isIce ? 0.70 : 0.62) * s;
      const tip = toWorld(cx, cy, tx, ty, ux, uy, 0, tipY);
      const hash = Math.abs(Math.sin(p.x * 17.23 + p.y * 29.71));
      const pulse = Math.max(0, Math.sin(now * (6.0 + hash * 4.0) + hash * Math.PI * 2));
      const twinkle = pulse * pulse * pulse;
      if (twinkle <= 0.02) continue;
      const arm = (isIce ? (0.032 + 0.055 * twinkle) : (0.03 + 0.05 * twinkle)) * s;
      const alpha = 0.2 + 0.8 * twinkle;
      const tr = isIce ? 0.70 : 1.0;
      const tg = isIce ? 0.94 : 0.93;
      const tb = isIce ? 1.0 : 0.62;
      pushLine(pos, col, tip[0] - tx * arm, tip[1] - ty * arm, tip[0] + tx * arm, tip[1] + ty * arm, tr, tg, tb, alpha);
      pushLine(pos, col, tip[0] - ux * arm, tip[1] - uy * arm, tip[0] + ux * arm, tip[1] + uy * arm, tr, tg, tb, alpha);
      lineVerts += 4;
    }
  }
  const bubbleParticles = featureParticles ? featureParticles.bubbles : null;
  if (bubbleParticles && bubbleParticles.length){
    for (const p of bubbleParticles){
      if (!visibleEntityNow(p.x, p.y)) continue;
      const life = p.life ?? 0;
      const lifeN = (p.maxLife && p.maxLife > 0) ? Math.max(0, Math.min(1, life / p.maxLife)) : 1;
      const radius = (p.size || 0.08) * (1 + (1 - lifeN) * 0.35);
      const alpha = 0.30 + 0.58 * lifeN;
      pushHexOutline(pos, col, p.x, p.y, radius, p.rot || 0, 0.80, 0.95, 1.0, alpha);
      lineVerts += 12;
    }
  }
  if (state.debugMinerGuidePath && state.ship && state.ship.state === "landed" && state.ship.guidePath && state.ship.guidePath.path && state.ship.guidePath.path.length > 0){
      const path = state.ship.guidePath.path;
      for (let i = 1; i < path.length; ++i){
        const p0 = /** @type {{x:number,y:number}} */ (path[i - 1]);
        const p1 = /** @type {{x:number,y:number}} */ (path[i]);
        pushLine(pos, col, p0.x, p0.y, p1.x, p1.y, 1.0, 0.9, 0.1, 0.85);
        lineVerts += 2;
      }
    if (state.debugMinerPathToMiner && state.debugMinerPathToMiner.length > 1){
        const minerPath = state.debugMinerPathToMiner;
        for (let i = 1; i < minerPath.length; i++){
          const p0 = /** @type {{x:number,y:number}} */ (minerPath[i - 1]);
          const p1 = /** @type {{x:number,y:number}} */ (minerPath[i]);
          pushLine(pos, col, p0.x, p0.y, p1.x, p1.y, 0.2, 0.95, 0.25, 0.98);
          lineVerts += 2;
        }
    }
    const idxRaw = Math.max(0, Math.min(path.length - 1, Number(state.ship.guidePath.indexClosest) || 0));
    let pShip = null;
    if (path.length === 1){
      pShip = path[0];
    } else {
      let i0 = Math.floor(idxRaw);
      let u = idxRaw - i0;
      if (i0 >= path.length - 1){
        i0 = path.length - 2;
        u = 1;
      }
      const p0 = /** @type {{x:number,y:number}} */ (path[Math.max(0, i0)]);
      const p1 = /** @type {{x:number,y:number}} */ (path[Math.min(path.length - 1, i0 + 1)]);
      pShip = {
        x: p0.x + (p1.x - p0.x) * u,
        y: p0.y + (p1.y - p0.y) * u,
      };
    }
    if (pShip){
      pushLine(pos, col, state.ship.x, state.ship.y, pShip.x, pShip.y, 0.2, 0.95, 1.0, 0.95);
      lineVerts += 2;
    }
  }

  // Lines end here. Lock the line vertex count to buffer length.
  lineVerts = pos.length / 2 - triVerts;

  const dbgSamples = state.debugCollisionSamples || state.ship._samples;
  const landingDbg = state.ship._landingDebug || null;
  /** @type {Array<{x:number,y:number,air:boolean,av:number}>} */
  const debugCollisionSeeds = [];
  /**
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  const addDebugSeed = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    for (const s of debugCollisionSeeds){
      if (Math.hypot(s.x - x, s.y - y) <= 1e-4) return;
    }
    const av = planet.airValueAtWorld(x, y);
    debugCollisionSeeds.push({ x, y, av, air: av > 0.5 });
  };
  if (dbgSamples){
    for (const [sxw, syw, air, av] of dbgSamples){
      debugCollisionSeeds.push({ x: sxw, y: syw, air: !!air, av });
    }
  }
  if (landingDbg){
    if (Number.isFinite(landingDbg.impactX) && Number.isFinite(landingDbg.impactY)){
      addDebugSeed(Number(landingDbg.impactX), Number(landingDbg.impactY));
    }
    if (Number.isFinite(landingDbg.supportX) && Number.isFinite(landingDbg.supportY)){
      addDebugSeed(Number(landingDbg.supportX), Number(landingDbg.supportY));
    }
  }

  if ((state.debugCollisions || state.debugCollisionContours) && state.ship){
    // Draw active ship collider outline from sampled hull points.
    if (dbgSamples && dbgSamples.length >= 4){
      let nHull = dbgSamples.length;
      const last = /** @type {[number, number, boolean, number]} */ (dbgSamples[dbgSamples.length - 1]);
      if (Math.hypot(last[0] - state.ship.x, last[1] - state.ship.y) < 1e-5){
        nHull = Math.max(0, nHull - 1);
      }
      if (nHull >= 3){
        for (let i = 0; i < nHull; i++){
          const a = /** @type {[number, number, boolean, number]} */ (dbgSamples[i]);
          const b = /** @type {[number, number, boolean, number]} */ (dbgSamples[(i + 1) % nHull]);
          pushLine(pos, col, a[0], a[1], b[0], b[1], 0.2, 0.95, 1.0, 0.7);
          lineVerts += 2;
        }
      } else {
        const cx = state.ship.x;
        const cy = state.ship.y;
        const r = Number.isFinite(state.ship._shipRadius) ? Number(state.ship._shipRadius) : 0;
        if (Number.isFinite(cx) && Number.isFinite(cy) && r > 0){
          const segs = 28;
          for (let i = 0; i < segs; i++){
            const a0 = (i / segs) * Math.PI * 2;
            const a1 = ((i + 1) / segs) * Math.PI * 2;
            const x0 = cx + Math.cos(a0) * r;
            const y0 = cy + Math.sin(a0) * r;
            const x1 = cx + Math.cos(a1) * r;
            const y1 = cy + Math.sin(a1) * r;
            pushLine(pos, col, x0, y0, x1, y1, 0.2, 0.95, 1.0, 0.7);
            lineVerts += 2;
          }
        }
      }
    } else {
      const cx = state.ship.x;
      const cy = state.ship.y;
      const r = Number.isFinite(state.ship._shipRadius) ? Number(state.ship._shipRadius) : 0;
      if (Number.isFinite(cx) && Number.isFinite(cy) && r > 0){
        const segs = 28;
        for (let i = 0; i < segs; i++){
          const a0 = (i / segs) * Math.PI * 2;
          const a1 = ((i + 1) / segs) * Math.PI * 2;
          const x0 = cx + Math.cos(a0) * r;
          const y0 = cy + Math.sin(a0) * r;
          const x1 = cx + Math.cos(a1) * r;
          const y1 = cy + Math.sin(a1) * r;
          pushLine(pos, col, x0, y0, x1, y1, 0.2, 0.95, 1.0, 0.7);
          lineVerts += 2;
        }
      }
    }
  }

  if (state.debugCollisions){
    for (const s of debugCollisionSeeds){
      pos.push(s.x, s.y);
      if (s.air) col.push(0.45, 1.0, 0.55, 0.9);
      else col.push(1.0, 0.3, 0.3, 0.9);
      pointVerts += 1;
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Array<{x:number,y:number,air:number}>|null}
   */
  const findTriAtOrNear = (x, y) => {
    if (!planet.radial || typeof planet.radial.findTriAtWorld !== "function") return null;
    let tri = planet.radial.findTriAtWorld(x, y);
    if (tri) return tri;
    const r = Math.hypot(x, y) || 1;
    const ux = x / r;
    const uy = y / r;
    const tx = -uy;
    const ty = ux;
    /** @type {Vec2[]} */
    const dirs = [[ux, uy], [-ux, -uy], [tx, ty], [-tx, -ty]];
    const probe = [0.02, 0.05, 0.1, 0.18];
    for (const d of probe){
      for (const dir of dirs){
        tri = planet.radial.findTriAtWorld(x + dir[0] * d, y + dir[1] * d);
        if (tri) return tri;
      }
    }
    return null;
  };

  if (state.debugCollisionContours && debugCollisionSeeds.length && planet.radial && typeof planet.radial.findTriAtWorld === "function"){
    /** @type {Array<Array<{x:number,y:number,air:number}>>} */
    const testedTris = [];
    for (const s of debugCollisionSeeds){
      const sxw = s.x;
      const syw = s.y;
      const tri = findTriAtOrNear(sxw, syw);
      if (!tri) continue;
      if (testedTris.indexOf(tri) < 0) testedTris.push(tri);

      if (!state.debugCollisions){
        pos.push(sxw, syw);
        if (s.air) col.push(0.45, 1.0, 0.55, 0.9);
        else col.push(1.0, 0.3, 0.3, 0.9);
        pointVerts += 1;
      }

      const airRaw = triAirAtWorld(tri, sxw, syw);
      const nearBoundary = Math.abs(airRaw - 0.5);
      if (nearBoundary <= 0.06){
        pushSquareOutline(pos, col, sxw, syw, 0.04, 1.0, 0.9, 0.2, 0.95);
        lineVerts += 8;
      }
    }

    for (const tri of testedTris){
      const a = /** @type {{x:number,y:number,air:number}} */ (tri[0]);
      const b = /** @type {{x:number,y:number,air:number}} */ (tri[1]);
      const c = /** @type {{x:number,y:number,air:number}} */ (tri[2]);
      pushTriangleOutline(pos, col, a.x, a.y, b.x, b.y, c.x, c.y, 0.25, 0.65, 1.0, 0.25);
      lineVerts += 6;
      const seg = triIsoSegment(tri, 0.5);
      if (!seg) continue;
      pushLine(pos, col, seg[0][0], seg[0][1], seg[1][0], seg[1][1], 1.0, 0.95, 0.2, 0.95);
      lineVerts += 2;
    }
  }
  if (state.debugCollisionContours && debugCollisionSeeds.length && state.mothership){
    const mothership = state.mothership;
    const boundaryEdges = getMothershipBoundaryEdges(mothership);
    const edgeHintDist = Math.max(0.12, (mothership.spacing || 0.4) * 0.7);
    const edgeHintDist2 = edgeHintDist * edgeHintDist;
    /** @type {Map<number,{cp:{x:number,y:number,d2:number,u:number},seed:{x:number,y:number}}>} */
    const hintedEdges = new Map();
    for (const s of debugCollisionSeeds){
      const lp = worldToMothershipLocal(mothership, s.x, s.y);
      let nearestIdx = -1;
      let nearest = null;
      let nearestD2 = Infinity;
      for (let i = 0; i < boundaryEdges.length; i++){
        const edge = /** @type {NonNullable<typeof boundaryEdges[number]>} */ (boundaryEdges[i]);
        const cp = closestPointOnSegment(edge.ax, edge.ay, edge.bx, edge.by, lp.x, lp.y);
        if (cp.d2 < nearestD2){
          nearestD2 = cp.d2;
          nearestIdx = i;
          nearest = cp;
        }
        if (cp.d2 <= edgeHintDist2){
          const prev = hintedEdges.get(i);
          if (!prev || cp.d2 < prev.cp.d2){
            hintedEdges.set(i, { cp, seed: { x: s.x, y: s.y } });
          }
        }
      }
      if (nearestIdx >= 0 && nearest){
        const prev = hintedEdges.get(nearestIdx);
        if (!prev || nearest.d2 < prev.cp.d2){
          hintedEdges.set(nearestIdx, { cp: nearest, seed: { x: s.x, y: s.y } });
        }
      }
    }
    let drawn = 0;
    for (const [edgeIdx, hint] of hintedEdges){
      if (drawn >= 16) break;
      const edge = boundaryEdges[edgeIdx];
      if (!edge) continue;
      const aw = mothershipLocalToWorld(mothership, edge.ax, edge.ay);
      const bw = mothershipLocalToWorld(mothership, edge.bx, edge.by);
      pushLine(pos, col, aw.x, aw.y, bw.x, bw.y, 1.0, 0.55, 0.15, 0.95);
      lineVerts += 2;

      const cpw = mothershipLocalToWorld(mothership, hint.cp.x, hint.cp.y);
      pushLine(pos, col, hint.seed.x, hint.seed.y, cpw.x, cpw.y, 1.0, 0.9, 0.2, 0.65);
      lineVerts += 2;
      pushSquareOutline(pos, col, cpw.x, cpw.y, 0.035, 1.0, 0.9, 0.2, 0.95);
      lineVerts += 8;

      const nw = mothershipLocalDirToWorld(mothership, edge.nx, edge.ny);
      const nScale = Math.max(0.06, (mothership.spacing || 0.4) * 0.18);
      pushLine(pos, col, cpw.x, cpw.y, cpw.x + nw.x * nScale, cpw.y + nw.y * nScale, 0.2, 1.0, 0.95, 0.9);
      lineVerts += 2;
      drawn += 1;
    }

    const diagEvidence = landingDbg && landingDbg.collisionDiag && landingDbg.collisionDiag.evidence
      ? landingDbg.collisionDiag.evidence
      : null;
    if (diagEvidence && Array.isArray(diagEvidence.hits) && diagEvidence.hits.length){
      /** @type {Set<number>} */
      const exactEdgeSet = new Set();
      /** @type {Set<number>} */
      const exactTriSet = new Set();
      for (const hit of diagEvidence.hits){
        if (!hit || !Number.isFinite(hit.edgeIdx)) continue;
        const edgeIdx = /** @type {number} */ (hit.edgeIdx);
        exactEdgeSet.add(edgeIdx);
        const edge = boundaryEdges[edgeIdx];
        if (!edge) continue;
        if (Number.isFinite(edge.solidTriIdx) && edge.solidTriIdx >= 0) exactTriSet.add(edge.solidTriIdx);
        if (Number.isFinite(edge.airTriIdx) && edge.airTriIdx >= 0) exactTriSet.add(edge.airTriIdx);
      }
      for (const triIdx of exactTriSet){
        const tri = mothership.tris && mothership.tris[triIdx];
        if (!tri || tri.length < 3) continue;
        const a0 = mothership.points[tri[0]];
        const b0 = mothership.points[tri[1]];
        const c0 = mothership.points[tri[2]];
        if (!a0 || !b0 || !c0) continue;
        const a = {
          x: mothership.x + Math.cos(mothership.angle) * a0.x - Math.sin(mothership.angle) * a0.y,
          y: mothership.y + Math.sin(mothership.angle) * a0.x + Math.cos(mothership.angle) * a0.y,
        };
        const b = {
          x: mothership.x + Math.cos(mothership.angle) * b0.x - Math.sin(mothership.angle) * b0.y,
          y: mothership.y + Math.sin(mothership.angle) * b0.x + Math.cos(mothership.angle) * b0.y,
        };
        const c = {
          x: mothership.x + Math.cos(mothership.angle) * c0.x - Math.sin(mothership.angle) * c0.y,
          y: mothership.y + Math.sin(mothership.angle) * c0.x + Math.cos(mothership.angle) * c0.y,
        };
        pushTriangleOutline(pos, col, a.x, a.y, b.x, b.y, c.x, c.y, 1.0, 0.15, 0.75, 0.95);
        lineVerts += 6;
      }
      for (const edgeIdx of exactEdgeSet){
        const edge = boundaryEdges[edgeIdx];
        if (!edge) continue;
        const aw = mothershipLocalToWorld(mothership, edge.ax, edge.ay);
        const bw = mothershipLocalToWorld(mothership, edge.bx, edge.by);
        pushLine(pos, col, aw.x, aw.y, bw.x, bw.y, 1.0, 1.0, 0.0, 1.0);
        lineVerts += 2;
        const mx = (edge.ax + edge.bx) * 0.5;
        const my = (edge.ay + edge.by) * 0.5;
        const mw = mothershipLocalToWorld(mothership, mx, my);
        const nw = mothershipLocalDirToWorld(mothership, edge.nx, edge.ny);
        const nScale = Math.max(0.08, (mothership.spacing || 0.4) * 0.22);
        pushLine(pos, col, mw.x, mw.y, mw.x + nw.x * nScale, mw.y + nw.y * nScale, 1.0, 1.0, 0.0, 1.0);
        lineVerts += 2;
      }
    }
  }
  const dbg = state.debugPoints;
  if (state.debugRingVertices && dbg){
    for (const [sxw, syw, air, av] of dbg){
      pos.push(sxw, syw);
      if (air) col.push(0.83, 0.83, 0.83, 0.95);
      else col.push(0.58, 0.42, 0.24, 0.95);
      pointVerts += 1;
    }
  }
  if (state.debugCollisions && state.debugNodes && dbg && !state.debugRingVertices){
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
      const a = /** @type {{x:number,y:number,air:number}} */ (c.tri[0]);
      const b = /** @type {{x:number,y:number,air:number}} */ (c.tri[1]);
      const d = /** @type {{x:number,y:number,air:number}} */ (c.tri[2]);
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
  if (state.debugCollisions && landingDbg){
    const ix = landingDbg.impactX;
    const iy = landingDbg.impactY;
    if (Number.isFinite(ix) && Number.isFinite(iy)){
      pos.push(Number(ix), Number(iy));
      col.push(1.0, 0.55, 0.1, 1.0);
      pointVerts += 1;
    }
    const sx = landingDbg.supportX;
    const sy = landingDbg.supportY;
    if (Number.isFinite(sx) && Number.isFinite(sy)){
      pos.push(Number(sx), Number(sy));
      col.push(0.2, 1.0, 1.0, 1.0);
      pointVerts += 1;
    }
  }

  // Points end here. Lock the point vertex count to buffer length.
  pointVerts = pos.length / 2 - triVerts - lineVerts;

  // Test pathfinding

  /*
  if (state.aimWorld) {
    const nodeShip = planet.nearestRadialNodeInAir(state.ship.x, state.ship.y);
    const nodeCursor = planet.nearestRadialNodeInAir(state.aimWorld.x, state.aimWorld.y);
    const radialGraph = planet.radialGraph;
    const passable = planet.airNodesBitmap;
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

  if (state.debugPlanetTriangles && planetWireVao && planetWireVertCount > 0){
    gl.bindVertexArray(planetWireVao);
    gl.drawArrays(gl.LINES, 0, planetWireVertCount);
    gl.bindVertexArray(oVao);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, oPos);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, oCol);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.DYNAMIC_DRAW);

    const drawShipPass = () => {
      if (!(shipMeshData && shipProg && shipVao && shipLocalBuf && shipBaryBuf && shipEdgeBuf && shipMatBuf && shipOutlineDirBuf)) return;
      const hullTopBase = /** @type {Rgb} */ (CFG.DROPSHIP_HULL_TOP);
      const hullBottomBase = /** @type {Rgb} */ (CFG.DROPSHIP_HULL_BOTTOM);
      const windowBase = /** @type {Rgb} */ (CFG.DROPSHIP_WINDOW_COLOR);
      const gunTopBase = /** @type {Rgb} */ (CFG.DROPSHIP_GUN_TOP);
      const gunBottomBase = /** @type {Rgb} */ (CFG.DROPSHIP_GUN_BOTTOM);
      const outlineTopBase = /** @type {Rgb} */ (CFG.DROPSHIP_OUTLINE_TOP);
      const outlineBottomBase = /** @type {Rgb} */ (CFG.DROPSHIP_OUTLINE_BOTTOM);
      const gunOutlineTopBase = /** @type {Rgb} */ (CFG.DROPSHIP_GUN_OUTLINE_TOP);
      const gunOutlineBottomBase = /** @type {Rgb} */ (CFG.DROPSHIP_GUN_OUTLINE_BOTTOM);
      const hullTopCol = applyTint(hullTopBase[0], hullTopBase[1], hullTopBase[2]);
      const hullBottomCol = applyTint(hullBottomBase[0], hullBottomBase[1], hullBottomBase[2]);
      const windowCol = applyTint(windowBase[0], windowBase[1], windowBase[2]);
      const gunTopCol = applyTint(gunTopBase[0], gunTopBase[1], gunTopBase[2]);
      const gunBottomCol = applyTint(gunBottomBase[0], gunBottomBase[1], gunBottomBase[2]);
      const outlineTopCol = applyTint(outlineTopBase[0], outlineTopBase[1], outlineTopBase[2]);
      const outlineBottomCol = applyTint(outlineBottomBase[0], outlineBottomBase[1], outlineBottomBase[2]);
      const gunOutlineTopCol = applyTint(gunOutlineTopBase[0], gunOutlineTopBase[1], gunOutlineTopBase[2]);
      const gunOutlineBottomCol = applyTint(gunOutlineBottomBase[0], gunOutlineBottomBase[1], gunOutlineBottomBase[2]);
    gl.useProgram(shipProg);
    gl.bindVertexArray(shipVao);
    if (shipScale) gl.uniform2f(shipScale, sx, sy);
    if (shipCam) gl.uniform2f(shipCam, state.view.xCenter, state.view.yCenter);
    if (shipViewRot) gl.uniform1f(shipViewRot, camRot);
    if (shipPos) gl.uniform2f(shipPos, state.ship.x, state.ship.y);
      if (shipRotLoc) gl.uniform1f(shipRotLoc, shipRot);
      if (shipHullTop) gl.uniform3fv(shipHullTop, hullTopCol);
      if (shipHullBottom) gl.uniform3fv(shipHullBottom, hullBottomCol);
      if (shipWindowColor) gl.uniform3fv(shipWindowColor, windowCol);
      if (shipGunTop) gl.uniform3fv(shipGunTop, gunTopCol);
      if (shipGunBottom) gl.uniform3fv(shipGunBottom, gunBottomCol);
      if (shipOutlineTop) gl.uniform3fv(shipOutlineTop, outlineTopCol);
      if (shipOutlineBottom) gl.uniform3fv(shipOutlineBottom, outlineBottomCol);
      if (shipGunOutlineTop) gl.uniform3fv(shipGunOutlineTop, gunOutlineTopCol);
      if (shipGunOutlineBottom) gl.uniform3fv(shipGunOutlineBottom, gunOutlineBottomCol);
    if (shipHullSheenAlpha) gl.uniform1f(shipHullSheenAlpha, CFG.DROPSHIP_HULL_SHEEN_ALPHA ?? 0);
    if (shipHullSheenFalloff) gl.uniform1f(shipHullSheenFalloff, CFG.DROPSHIP_HULL_SHEEN_FALLOFF ?? 0);
    if (shipTopY) gl.uniform1f(shipTopY, topY);
    if (shipBottomY) gl.uniform1f(shipBottomY, bottomY);
    gl.bindBuffer(gl.ARRAY_BUFFER, shipLocalBuf);
    gl.bufferData(gl.ARRAY_BUFFER, shipMeshData.local, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, shipBaryBuf);
    gl.bufferData(gl.ARRAY_BUFFER, shipMeshData.bary, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, shipEdgeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, shipMeshData.edgeMask, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, shipMatBuf);
    gl.bufferData(gl.ARRAY_BUFFER, shipMeshData.material, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, shipOutlineDirBuf);
    gl.bufferData(gl.ARRAY_BUFFER, shipMeshData.outlineDir, gl.DYNAMIC_DRAW);
      const outlineWorld = Math.max(0, CFG.DROPSHIP_OUTLINE_WORLD ?? 0);
      if (outlineWorld > 0 && shipRenderOutline && shipOutlineExpandWorld && shipOutlineAlphaTop && shipOutlineAlphaBottom){
        const shellFractions = [0.9, 0.7, 0.5, 0.3, 0.12];
        let prevFade = 0;
        gl.uniform1f(shipRenderOutline, 1);
        for (const frac of shellFractions){
          const fade = terrainAirFade01(frac);
          const alphaScale = Math.max(0, fade - prevFade);
          prevFade = fade;
          if (!(alphaScale > 1e-4)) continue;
          gl.uniform1f(shipOutlineExpandWorld, outlineWorld * frac);
          gl.uniform1f(shipOutlineAlphaTop, (CFG.DROPSHIP_OUTLINE_ALPHA_TOP ?? 1) * alphaScale);
          gl.uniform1f(shipOutlineAlphaBottom, (CFG.DROPSHIP_OUTLINE_ALPHA_BOTTOM ?? 1) * alphaScale);
          gl.drawArrays(gl.TRIANGLES, 0, shipMeshData.vertCount);
        }
      } else {
        if (shipOutlineExpandWorld) gl.uniform1f(shipOutlineExpandWorld, outlineWorld);
        if (shipOutlineAlphaTop) gl.uniform1f(shipOutlineAlphaTop, CFG.DROPSHIP_OUTLINE_ALPHA_TOP ?? 1);
        if (shipOutlineAlphaBottom) gl.uniform1f(shipOutlineAlphaBottom, CFG.DROPSHIP_OUTLINE_ALPHA_BOTTOM ?? 1);
        if (shipRenderOutline) gl.uniform1f(shipRenderOutline, 1);
        gl.drawArrays(gl.TRIANGLES, 0, shipMeshData.vertCount);
      }
    if (shipOutlineExpandWorld) gl.uniform1f(shipOutlineExpandWorld, 0);
    if (shipRenderOutline) gl.uniform1f(shipRenderOutline, 0);
    gl.drawArrays(gl.TRIANGLES, 0, shipMeshData.vertCount);
    gl.bindVertexArray(oVao);
    gl.useProgram(oprog);
    gl.uniform2f(ouScale, sx, sy);
    gl.uniform2f(ouCam, state.view.xCenter, state.view.yCenter);
    gl.uniform1f(ouRot, camRot);
  };
  if (triVerts > 0){
    const split = Math.max(0, Math.min(triVerts, shipTriSplit));
    if (split > 0){
      gl.drawArrays(gl.TRIANGLES, 0, split);
    }
    if (aimLineVertCount > 0){
      gl.drawArrays(gl.LINES, aimLineStartVert, aimLineVertCount);
    }
    if (shipMeshData){
      drawShipPass();
    }
    if (triVerts > split){
      gl.drawArrays(gl.TRIANGLES, split, triVerts - split);
    }
  } else if (shipMeshData){
    if (aimLineVertCount > 0){
      gl.drawArrays(gl.LINES, aimLineStartVert, aimLineVertCount);
    }
    drawShipPass();
  }
  let offset = triVerts;
  if (lineVerts > 0){
    if (aimLineVertCount > 0 && aimLineStartVert >= triVerts){
      const preAimVerts = aimLineStartVert - triVerts;
      if (preAimVerts > 0){
        gl.drawArrays(gl.LINES, offset, preAimVerts);
      }
      const postAimOffset = aimLineStartVert + aimLineVertCount;
      const postAimVerts = lineVerts - preAimVerts - aimLineVertCount;
      if (postAimVerts > 0){
        gl.drawArrays(gl.LINES, postAimOffset, postAimVerts);
      }
    } else {
      gl.drawArrays(gl.LINES, offset, lineVerts);
    }
    offset += lineVerts;
  }
  if (pointVerts > 0){
    gl.drawArrays(gl.POINTS, offset, pointVerts);
  }

  if (showGameplayIndicators && state.touchUi){
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

    /**
     * Clamp the visible touch knob/button travel so the control behaves like a stick.
     * @param {{x:number,y:number}} center
     * @param {{x:number,y:number}|null|undefined} touch
     * @param {number} maxOffset
     */
    const toClampedPx = (center, touch, maxOffset) => {
      const base = toPx(center.x, center.y);
      if (!touch){
        return base;
      }
      const touchPx = toPx(touch.x, touch.y);
      let dx = touchPx.x - base.x;
      let dy = touchPx.y - base.y;
      const len = Math.hypot(dx, dy);
      if (len > maxOffset && len > 1e-4){
        const scale = maxOffset / len;
        dx *= scale;
        dy *= scale;
      }
      return { x: base.x + dx, y: base.y + dy };
    };

    const leftCenter = state.touchUi.leftCenter || TOUCH_UI.left;
    const laserCenter = state.touchUi.laserCenter || TOUCH_UI.laser;
    const bombCenter = state.touchUi.bombCenter || TOUCH_UI.bomb;

    const left = toPx(leftCenter.x, leftCenter.y);
    const leftRadius = TOUCH_UI.left.r * minDim;

    const laser = toPx(laserCenter.x, laserCenter.y);
    const laserSize = TOUCH_UI.laser.r * minDim;
    pushDiamondOutline(linePos, lineCol, laser.x, laser.y, laserSize, 0.95, 0.95, 0.95, 0.9);

    const bomb = toPx(bombCenter.x, bombCenter.y);
    const bombSize = TOUCH_UI.bomb.r * minDim;
    pushSquareOutline(linePos, lineCol, bomb.x, bomb.y, bombSize, 1.0, 0.75, 0.2, 0.9);

    pushCircle(linePos, lineCol, left.x, left.y, leftRadius, 1.0, 0.55, 0.15, 0.9, 64);

    if (state.touchUi.leftTouch){
      const touch = toClampedPx(leftCenter, state.touchUi.leftTouch, leftRadius * 0.65);
      pushLine(linePos, lineCol, left.x, left.y, touch.x, touch.y, 1.0, 0.4, 0.15, 0.9);
      pushCircle(linePos, lineCol, touch.x, touch.y, leftRadius * 0.42, 1.0, 0.82, 0.3, 0.95, 32);
    }
    if (state.touchUi.laserTouch){
      const touch = toClampedPx(laserCenter, state.touchUi.laserTouch, laserSize * 0.75);
      pushLine(linePos, lineCol, laser.x, laser.y, touch.x, touch.y, 0.95, 0.95, 0.95, 0.85);
      pushDiamondOutline(linePos, lineCol, touch.x, touch.y, laserSize * 0.68, 0.95, 0.95, 0.95, 0.98);
    }
    if (state.touchUi.bombTouch){
      const touch = toClampedPx(bombCenter, state.touchUi.bombTouch, bombSize * 0.75);
      pushLine(linePos, lineCol, bomb.x, bomb.y, touch.x, touch.y, 1.0, 0.75, 0.2, 0.9);
      pushSquareOutline(linePos, lineCol, touch.x, touch.y, bombSize * 0.68, 1.0, 0.82, 0.3, 0.98);
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
    const glMaybe = canvas.getContext("webgl2", {
      antialias: !PERF_FLAGS.disableMsaa,
      premultipliedAlpha: false,
    });
    if (!glMaybe) throw new Error("WebGL2 not available");
    /** @type {WebGL2RenderingContext} */
    const gl = glMaybe;
    this.gl = gl;

    this.airBuf = null;
    this.fogBuf = null;
    this.vertCount = 0;
    this.shadeTex = null;
    this.planetWirePosBuf = null;
    this.planetWireColBuf = null;
    this.planetWireVertCount = 0;
    this.shipVertCount = 0;

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
  uniform float uEdgeAirOcclusion;
  uniform float uEdgeAirBandWorld;
  uniform float uEdgeAirHardness;
  uniform float uEdgeRockLight;
  uniform float uEdgeRockBandWorld;
  uniform float uEdgeRockHardness;
  uniform float uEdgeOutwardBias;

  vec3 lerp(vec3 a, vec3 b, float t){ return a + (b-a)*t; }

  float edgeBandMask(float dist, float band, float hardness){
    float t = clamp(dist / max(band, 1e-5), 0.0, 1.0);
    float soft = 1.0 - smoothstep(0.0, 1.0, t);
    float hard = 1.0 - step(1.0, t);
    return mix(soft, hard, clamp(hardness, 0.0, 1.0));
  }

  vec2 airGradientWorld(){
    vec2 wx = dFdx(vWorld);
    vec2 wy = dFdy(vWorld);
    float ax = dFdx(vAir);
    float ay = dFdy(vAir);
    float det = wx.x * wy.y - wx.y * wy.x;
    if (abs(det) < 1e-6){
      return vec2(0.0);
    }
    return vec2(
      (ax * wy.y - wx.y * ay) / det,
      (wx.x * ay - ax * wy.x) / det
    );
  }

  void main(){
    float r = length(vWorld);
    if (r > uMaxR){
      discard;
    }
    // Outer air ring: suppress drawing the air-side half of the outermost
    // barycentric band so "space" remains unrendered there.
    if (r > (uMeshRmax - 0.5) && vAir > 0.5){
      discard;
    }
    float t = clamp(vShade, 0.0, 1.0);
    float band = uSurfaceBand * uRmax;
    bool useSurface = (uSurfaceBand > 0.0) && (r > (uRmax - band));
    vec3 rockDark = useSurface ? uSurfaceRockDark : uRockDark;
    vec3 rockLight = useSurface ? uSurfaceRockLight : uRockLight;
    vec3 c = (vAir > 0.5) ? lerp(uAirDark,  uAirLight,  t)
                          : lerp(rockDark, rockLight, t);
    bool airEdgeEnabled = (uEdgeAirOcclusion > 0.0) && (uEdgeAirBandWorld > 0.0);
    bool rockEdgeEnabled = (uEdgeRockLight > 0.0) && (uEdgeRockBandWorld > 0.0);
    if (airEdgeEnabled || rockEdgeEnabled){
      float signedAir = vAir - 0.5;
      vec2 gradAirWorld = airGradientWorld();
      float gradLen = length(gradAirWorld);
      float airBand = max(gradLen * uEdgeAirBandWorld, 1e-5);
      float rockBand = max(gradLen * uEdgeRockBandWorld, 1e-5);
      float airStrip = step(0.0, signedAir) * edgeBandMask(signedAir, airBand, uEdgeAirHardness);
      float rockStrip = step(0.0, -signedAir) * edgeBandMask(-signedAir, rockBand, uEdgeRockHardness);
      vec2 boundaryNormal = (gradLen > 1e-5) ? (gradAirWorld / gradLen) : vec2(0.0, 1.0);
      vec2 radialOut = (r > 1e-5) ? (vWorld / r) : vec2(0.0, 1.0);
      float outward = clamp(dot(boundaryNormal, radialOut), 0.0, 1.0);
      float outwardMask = mix(1.0, outward, clamp(uEdgeOutwardBias, 0.0, 1.0));
      if (airEdgeEnabled && signedAir >= 0.0){
        c *= (1.0 - uEdgeAirOcclusion * airStrip);
      } else if (rockEdgeEnabled && signedAir < 0.0){
        c = mix(c, vec3(1.0), uEdgeRockLight * rockStrip * outwardMask);
      }
    }
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

    const shipVs = `#version 300 es
  precision highp float;
  layout(location=0) in vec2 aLocal;
  layout(location=1) in vec3 aBary;
  layout(location=2) in vec3 aEdgeMask;
  layout(location=3) in float aMaterial;
  layout(location=4) in vec2 aOutlineDir;

  uniform vec2 uScale;
  uniform vec2 uCam;
  uniform float uViewRot;
  uniform vec2 uShipPos;
  uniform float uShipRot;
  uniform float uOutlineExpandWorld;

  out vec2 vLocal;
  out vec3 vBary;
  flat out vec3 vEdgeMask;
  flat out float vMaterial;

  vec2 rot(vec2 p, float a){
    float c = cos(a), s = sin(a);
    return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }

  void main(){
    vec2 local = aLocal;
    if (uOutlineExpandWorld > 0.0 && dot(aOutlineDir, aOutlineDir) > 1e-8){
      local += aOutlineDir * uOutlineExpandWorld;
    }
    vec2 world = rot(local, uShipRot) + uShipPos;
    vec2 p = rot(world - uCam, uViewRot);
    gl_Position = vec4(p * uScale, 0.0, 1.0);
    vLocal = aLocal;
    vBary = aBary;
    vEdgeMask = aEdgeMask;
    vMaterial = aMaterial;
  }`;

    const shipFs = `#version 300 es
  precision highp float;

  in vec2 vLocal;
  in vec3 vBary;
  flat in vec3 vEdgeMask;
  flat in float vMaterial;
  out vec4 outColor;

  uniform vec3 uHullTop;
  uniform vec3 uHullBottom;
  uniform vec3 uWindowColor;
  uniform vec3 uGunTop;
  uniform vec3 uGunBottom;
  uniform vec3 uOutlineTop;
  uniform vec3 uOutlineBottom;
  uniform vec3 uGunOutlineTop;
  uniform vec3 uGunOutlineBottom;
  uniform float uTopY;
  uniform float uBottomY;
  uniform float uRenderOutline;
  uniform float uOutlineAlphaTop;
  uniform float uOutlineAlphaBottom;
  uniform float uHullSheenAlpha;
  uniform float uHullSheenFalloff;

  vec3 shipBaseColor(){
    float t = clamp((vLocal.y - uBottomY) / max(1e-5, uTopY - uBottomY), 0.0, 1.0);
    vec3 hull = mix(uHullBottom, uHullTop, t);
    vec3 gun = mix(uGunBottom, uGunTop, t);
    float centerSheen = exp(-max(0.0, uHullSheenFalloff) * abs(vLocal.x));
    hull = mix(hull, vec3(1.0), clamp(uHullSheenAlpha, 0.0, 1.0) * centerSheen * smoothstep(uBottomY, uTopY, vLocal.y));
    if (vMaterial < 0.5){
      return hull;
    }
    if (vMaterial < 1.5){
      return uWindowColor;
    }
    return gun;
  }

  vec3 outlineColor(){
    float t = clamp((vLocal.y - uBottomY) / max(1e-5, uTopY - uBottomY), 0.0, 1.0);
    if (vMaterial > 1.5){
      return mix(uGunOutlineBottom, uGunOutlineTop, t);
    }
    return mix(uOutlineBottom, uOutlineTop, t);
  }

  void main(){
    vec3 col = (uRenderOutline > 0.5) ? outlineColor() : shipBaseColor();
    float t = clamp((vLocal.y - uBottomY) / max(1e-5, uTopY - uBottomY), 0.0, 1.0);
    float alpha = (uRenderOutline > 0.5) ? mix(uOutlineAlphaBottom, uOutlineAlphaTop, t) : 1.0;
    outColor = vec4(col, alpha);
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
    const shipProg = gl.createProgram();
    if (!shipProg) throw new Error("Failed to create ship program");
    gl.attachShader(shipProg, compile(gl, gl.VERTEX_SHADER, shipVs));
    gl.attachShader(shipProg, compile(gl, gl.FRAGMENT_SHADER, shipFs));
    gl.linkProgram(shipProg);
    if (!gl.getProgramParameter(shipProg, gl.LINK_STATUS)){
      throw new Error(gl.getProgramInfoLog(shipProg) || "Ship program link failed");
    }
    this.shipProg = shipProg;

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
    const shipVao = gl.createVertexArray();
    /** @type {WebGLVertexArrayObject|null} */
    const planetWireVao = gl.createVertexArray();
    /** @type {WebGLVertexArrayObject|null} */
    const starVao = gl.createVertexArray();
    if (!vao || !oVao || !shipVao || !planetWireVao || !starVao) throw new Error("Failed to create VAO");
    this.vao = vao;
    this.oVao = oVao;
    this.shipVao = shipVao;
    this.planetWireVao = planetWireVao;
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
    this.uEdgeAirOcclusion = gl.getUniformLocation(prog, "uEdgeAirOcclusion");
    this.uEdgeAirBandWorld = gl.getUniformLocation(prog, "uEdgeAirBandWorld");
    this.uEdgeAirHardness = gl.getUniformLocation(prog, "uEdgeAirHardness");
    this.uEdgeRockLight = gl.getUniformLocation(prog, "uEdgeRockLight");
    this.uEdgeRockBandWorld = gl.getUniformLocation(prog, "uEdgeRockBandWorld");
    this.uEdgeRockHardness = gl.getUniformLocation(prog, "uEdgeRockHardness");
    this.uEdgeOutwardBias = gl.getUniformLocation(prog, "uEdgeOutwardBias");

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
    if (this.uEdgeAirOcclusion) gl.uniform1f(this.uEdgeAirOcclusion, CFG.TERRAIN_EDGE_AIR_OCCLUSION ?? 0);
    if (this.uEdgeAirBandWorld) gl.uniform1f(this.uEdgeAirBandWorld, CFG.TERRAIN_EDGE_AIR_BAND_WORLD ?? 0);
    if (this.uEdgeAirHardness) gl.uniform1f(this.uEdgeAirHardness, CFG.TERRAIN_EDGE_AIR_HARDNESS ?? 0);
    if (this.uEdgeRockLight) gl.uniform1f(this.uEdgeRockLight, CFG.TERRAIN_EDGE_ROCK_LIGHT ?? 0);
    if (this.uEdgeRockBandWorld) gl.uniform1f(this.uEdgeRockBandWorld, CFG.TERRAIN_EDGE_ROCK_BAND_WORLD ?? 0);
    if (this.uEdgeRockHardness) gl.uniform1f(this.uEdgeRockHardness, CFG.TERRAIN_EDGE_ROCK_HARDNESS ?? 0);
    if (this.uEdgeOutwardBias) gl.uniform1f(this.uEdgeOutwardBias, CFG.TERRAIN_EDGE_OUTWARD_BIAS ?? 0);

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

    gl.useProgram(shipProg);
    this.shipScale = gl.getUniformLocation(shipProg, "uScale");
    this.shipCam = gl.getUniformLocation(shipProg, "uCam");
    this.shipViewRot = gl.getUniformLocation(shipProg, "uViewRot");
    this.shipPos = gl.getUniformLocation(shipProg, "uShipPos");
    this.shipRot = gl.getUniformLocation(shipProg, "uShipRot");
    this.shipOutlineExpandWorld = gl.getUniformLocation(shipProg, "uOutlineExpandWorld");
    this.shipHullTop = gl.getUniformLocation(shipProg, "uHullTop");
    this.shipHullBottom = gl.getUniformLocation(shipProg, "uHullBottom");
    this.shipWindowColor = gl.getUniformLocation(shipProg, "uWindowColor");
    this.shipGunTop = gl.getUniformLocation(shipProg, "uGunTop");
    this.shipGunBottom = gl.getUniformLocation(shipProg, "uGunBottom");
    this.shipOutlineTop = gl.getUniformLocation(shipProg, "uOutlineTop");
    this.shipOutlineBottom = gl.getUniformLocation(shipProg, "uOutlineBottom");
    this.shipGunOutlineTop = gl.getUniformLocation(shipProg, "uGunOutlineTop");
    this.shipGunOutlineBottom = gl.getUniformLocation(shipProg, "uGunOutlineBottom");
    this.shipTopY = gl.getUniformLocation(shipProg, "uTopY");
    this.shipBottomY = gl.getUniformLocation(shipProg, "uBottomY");
    this.shipHullSheenAlpha = gl.getUniformLocation(shipProg, "uHullSheenAlpha");
    this.shipHullSheenFalloff = gl.getUniformLocation(shipProg, "uHullSheenFalloff");
    this.shipRenderOutline = gl.getUniformLocation(shipProg, "uRenderOutline");
    this.shipOutlineAlphaTop = gl.getUniformLocation(shipProg, "uOutlineAlphaTop");
    this.shipOutlineAlphaBottom = gl.getUniformLocation(shipProg, "uOutlineAlphaBottom");

    gl.bindVertexArray(shipVao);
    this.shipLocalBuf = gl.createBuffer();
    this.shipBaryBuf = gl.createBuffer();
    this.shipEdgeBuf = gl.createBuffer();
    this.shipMatBuf = gl.createBuffer();
    this.shipOutlineDirBuf = gl.createBuffer();
    if (!this.shipLocalBuf || !this.shipBaryBuf || !this.shipEdgeBuf || !this.shipMatBuf || !this.shipOutlineDirBuf){
      throw new Error("Failed to create ship render buffers");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shipLocalBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shipBaryBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shipEdgeBuf);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shipMatBuf);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.shipOutlineDirBuf);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /**
   * @returns {void}
   */
  resize(){
    const dpr = getEffectiveDevicePixelRatio();
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

    if (this.planetWirePosBuf) gl.deleteBuffer(this.planetWirePosBuf);
    if (this.planetWireColBuf) gl.deleteBuffer(this.planetWireColBuf);
    const wire = buildTriangleWireframe(mesh.positions);
    gl.bindVertexArray(this.planetWireVao);
    this.planetWirePosBuf = uploadAttrib(gl, 0, wire.positions, 2);
    this.planetWireColBuf = uploadAttrib(gl, 1, wire.colors, 4);
    gl.bindVertexArray(null);
    this.planetWireVertCount = wire.vertCount;
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

