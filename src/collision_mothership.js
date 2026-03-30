// @ts-check

import { mothershipAirAtWorld } from "./mothership.js";
import {
  closestPointOnSegment,
  convexPolysOverlap,
  depenetrateAlongNormal,
  extractHullBoundaryContacts,
  sampleGradientNormal,
} from "./collision_helpers.js";

/** @typedef {[number, number, number]} TriIndex */

/**
 * @typedef {Pick<import("./mothership.js").Mothership, "x"|"y"|"angle">} MothershipPose
 * @typedef {MothershipPose & Pick<import("./mothership.js").Mothership, "points"|"tris"|"triAir"> & Partial<Pick<import("./mothership.js").Mothership, "spacing">>} MothershipCollisionMesh
 * @typedef {{mothership:import("./mothership.js").Mothership|null,shipLocalConvexHull:()=>Array<[number,number]>}} SweptMothershipCollisionCtx
 */

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerpAngleShortest(a, b, t){
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/**
 * @param {MothershipPose} pose
 * @param {number} x
 * @param {number} y
 * @returns {{x:number,y:number}}
 */
export function worldToMothershipLocal(pose, x, y){
  const dx = x - pose.x;
  const dy = y - pose.y;
  const c = Math.cos(-pose.angle);
  const s = Math.sin(-pose.angle);
  return {
    x: c * dx - s * dy,
    y: s * dx + c * dy,
  };
}

/**
 * @param {MothershipPose} pose
 * @param {number} x
 * @param {number} y
 * @returns {{x:number,y:number}}
 */
export function mothershipLocalToWorld(pose, x, y){
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return {
    x: pose.x + c * x - s * y,
    y: pose.y + s * x + c * y,
  };
}

/**
 * @param {MothershipPose} pose
 * @param {number} nx
 * @param {number} ny
 * @returns {{x:number,y:number}}
 */
export function mothershipLocalDirToWorld(pose, nx, ny){
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return {
    x: c * nx - s * ny,
    y: s * nx + c * ny,
  };
}

/**
 * @param {number} px
 * @param {number} py
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} cx
 * @param {number} cy
 * @returns {boolean}
 */
function pointInTriLocal(px, py, ax, ay, bx, by, cx, cy){
  const v0x = cx - ax;
  const v0y = cy - ay;
  const v1x = bx - ax;
  const v1y = by - ay;
  const v2x = px - ax;
  const v2y = py - ay;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const invDen = 1 / (dot00 * dot11 - dot01 * dot01 || 1);
  const u = (dot11 * dot02 - dot01 * dot12) * invDen;
  const v = (dot00 * dot12 - dot01 * dot02) * invDen;
  return (u >= -1e-6) && (v >= -1e-6) && (u + v <= 1 + 1e-6);
}

/**
 * @param {MothershipCollisionMesh} mothership
 * @param {number} lx
 * @param {number} ly
 * @returns {number|null}
 */
export function mothershipAirAtLocalExact(mothership, lx, ly){
  /** @type {Array<{x:number,y:number,air?:number}>} */
  const points = mothership.points;
  /** @type {TriIndex[]} */
  const tris = mothership.tris;
  /** @type {number[]} */
  const triAir = mothership.triAir || [];
  let hit = false;
  let maxAir = -Infinity;
  for (let i = 0; i < tris.length; i++){
    const tri = /** @type {TriIndex} */ (tris[i]);
    const a = /** @type {{x:number,y:number,air?:number}} */ (points[tri[0]]);
    const b = /** @type {{x:number,y:number,air?:number}} */ (points[tri[1]]);
    const c = /** @type {{x:number,y:number,air?:number}} */ (points[tri[2]]);
    if (!pointInTriLocal(lx, ly, a.x, a.y, b.x, b.y, c.x, c.y)) continue;
    const air = /** @type {number} */ (triAir[i]);
    if (!hit || air > maxAir){
      maxAir = air;
      hit = true;
    }
  }
  return hit ? maxAir : null;
}

/**
 * @param {{collisionEps:number,shipRadius:()=>number,shipConvexHullWorldVertices:(x:number,y:number)=>Array<[number,number]>}} ctx
 * @param {number} x
 * @param {number} y
 * @param {(Pick<import("./mothership.js").Mothership, "x"|"y"|"angle"|"bounds"|"points"|"tris"|"triAir">)|null|undefined} mothershipPose
 * @returns {import("./types.d.js").CollisionHit|null}
 */
export function findMothershipCollisionExactAtPose(ctx, x, y, mothershipPose){
  const m = mothershipPose;
  if (!m) return null;
  const hull = ctx.shipConvexHullWorldVertices(x, y);
  if (hull.length < 3) return null;
  const shipR = ctx.shipRadius();
  const broadR = (Number.isFinite(m.bounds) ? m.bounds : 0) + shipR + 0.25;
  const dxm = x - m.x;
  const dym = y - m.y;
  if (dxm * dxm + dym * dym > broadR * broadR) return null;

  let hxMin = Infinity;
  let hyMin = Infinity;
  let hxMax = -Infinity;
  let hyMax = -Infinity;
  for (const p of hull){
    hxMin = Math.min(hxMin, p[0]);
    hyMin = Math.min(hyMin, p[1]);
    hxMax = Math.max(hxMax, p[0]);
    hyMax = Math.max(hyMax, p[1]);
  }

  /** @type {Array<{x:number,y:number,air?:number}>} */
  const points = m.points || [];
  /** @type {TriIndex[]} */
  const tris = m.tris || [];
  /** @type {number[]} */
  const triAir = m.triAir || [];
  const c = Math.cos(m.angle);
  const s = Math.sin(m.angle);
  let bestD2 = Infinity;
  /** @type {import("./types.d.js").CollisionHit|null} */
  let best = null;
  for (let i = 0; i < tris.length; i++){
    const air = /** @type {number} */ (triAir[i]);
    if (air > 0.5) continue;
    const tri = /** @type {TriIndex} */ (tris[i]);
    const a = /** @type {{x:number,y:number,air?:number}} */ (points[tri[0]]);
    const b = /** @type {{x:number,y:number,air?:number}} */ (points[tri[1]]);
    const cpt = /** @type {{x:number,y:number,air?:number}} */ (points[tri[2]]);
    const ax = m.x + c * a.x - s * a.y;
    const ay = m.y + s * a.x + c * a.y;
    const bx = m.x + c * b.x - s * b.y;
    const by = m.y + s * b.x + c * b.y;
    const cx = m.x + c * cpt.x - s * cpt.y;
    const cy = m.y + s * cpt.x + c * cpt.y;
    const txMin = Math.min(ax, bx, cx);
    const tyMin = Math.min(ay, by, cy);
    const txMax = Math.max(ax, bx, cx);
    const tyMax = Math.max(ay, by, cy);
    if (txMax < hxMin || txMin > hxMax || tyMax < hyMin || tyMin > hyMax) continue;
    /** @type {Array<[number, number]>} */
    const triPoly = [[ax, ay], [bx, by], [cx, cy]];
    if (!convexPolysOverlap(hull, triPoly)) continue;
    for (let e = 0; e < 3; e++){
      const p0 = /** @type {[number, number]} */ (triPoly[e]);
      const p1 = /** @type {[number, number]} */ (triPoly[(e + 1) % 3]);
      const cp = closestPointOnSegment(p0[0], p0[1], p1[0], p1[1], x, y);
      if (cp.d2 < bestD2){
        bestD2 = cp.d2;
        best = { x: cp.x, y: cp.y };
      }
    }
  }
  if (!best) return null;
  const contacts = extractHullBoundaryContacts(
    ctx.shipConvexHullWorldVertices,
    x,
    y,
    (sx, sy) => {
      const lp = worldToMothershipLocal(m, sx, sy);
      const v = mothershipAirAtLocalExact(m, lp.x, lp.y);
      return (v === null) ? 1 : v;
    },
    Math.max(0.01, ctx.collisionEps * 0.2)
  );
  if (contacts.length){
    best.contacts = contacts;
  }
  return best;
}

/**
 * @param {MothershipCollisionMesh} mothership
 * @returns {Array<{ax:number,ay:number,bx:number,by:number,nx:number,ny:number,i:number,j:number,solidTriIdx:number,airTriIdx:number}>}
 */
export function getMothershipBoundaryEdges(mothership){
  // @ts-ignore dynamic cache on runtime object
  if (Array.isArray(mothership._collisionBoundaryEdgesExact)){
    // @ts-ignore dynamic cache on runtime object
    return mothership._collisionBoundaryEdgesExact;
  }
  /** @type {Array<{x:number,y:number,air?:number}>} */
  const points = mothership.points;
  /** @type {TriIndex[]} */
  const tris = mothership.tris;
  /** @type {number[]} */
  const triAir = mothership.triAir || [];
  /** @type {Map<string,{i:number,j:number,solidCount:number,airCount:number,solidThird:number,solidTriIdx:number,airTriIdx:number}>} */
  const edgeMap = new Map();
  for (let ti = 0; ti < tris.length; ti++){
    const tri = /** @type {TriIndex} */ (tris[ti]);
    const solid = /** @type {number} */ (triAir[ti]) <= 0.5;
    for (let e = 0; e < 3; e++){
      const i0 = /** @type {number} */ (tri[e]);
      const i1 = /** @type {number} */ (tri[(e + 1) % 3]);
      const ik = /** @type {number} */ (tri[(e + 2) % 3]);
      const i = Math.min(i0, i1);
      const j = Math.max(i0, i1);
      const key = `${i},${j}`;
      let rec = edgeMap.get(key);
      if (!rec){
        rec = {
          i,
          j,
          solidCount: 0,
          airCount: 0,
          solidThird: -1,
          solidTriIdx: -1,
          airTriIdx: -1,
        };
        edgeMap.set(key, rec);
      }
      if (solid){
        rec.solidCount += 1;
        if (rec.solidThird < 0) rec.solidThird = ik;
        if (rec.solidTriIdx < 0) rec.solidTriIdx = ti;
      } else if (rec.airTriIdx < 0){
        rec.airCount += 1;
        rec.airTriIdx = ti;
      } else {
        rec.airCount += 1;
      }
    }
  }

  /** @type {Array<{ax:number,ay:number,bx:number,by:number,nx:number,ny:number,i:number,j:number,solidTriIdx:number,airTriIdx:number}>} */
  const edges = [];
  for (const rec of edgeMap.values()){
    if (rec.solidCount <= 0) continue;
    if (rec.solidCount >= 2 && rec.airCount === 0) continue;
    const a = /** @type {{x:number,y:number,air?:number}} */ (points[rec.i]);
    const b = /** @type {{x:number,y:number,air?:number}} */ (points[rec.j]);
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-8) continue;
    let nx = ey / len;
    let ny = -ex / len;
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    if (rec.solidCount === 1 && rec.solidThird >= 0){
      const c = /** @type {{x:number,y:number,air?:number}} */ (points[rec.solidThird]);
      const toSolidX = c.x - mx;
      const toSolidY = c.y - my;
      if (toSolidX * nx + toSolidY * ny > 0){
        nx = -nx;
        ny = -ny;
      }
    } else {
      const eps = Math.max(0.01, (mothership.spacing || 0.4) * 0.18);
      const av1Raw = mothershipAirAtLocalExact(mothership, mx + nx * eps, my + ny * eps);
      const av2Raw = mothershipAirAtLocalExact(mothership, mx - nx * eps, my - ny * eps);
      const av1 = (av1Raw === null) ? 1 : av1Raw;
      const av2 = (av2Raw === null) ? 1 : av2Raw;
      if (av2 > av1 + 1e-6){
        nx = -nx;
        ny = -ny;
      }
    }
    edges.push({
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      nx,
      ny,
      i: rec.i,
      j: rec.j,
      solidTriIdx: rec.solidTriIdx,
      airTriIdx: rec.airTriIdx,
    });
  }
  // @ts-ignore dynamic cache on runtime object
  mothership._collisionBoundaryEdgesExact = edges;
  return edges;
}

/**
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} a
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} b
 * @returns {boolean}
 */
function aabbOverlap(a, b){
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/**
 * @param {{x:number,y:number}} a
 * @param {{x:number,y:number}} b
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
function segmentAabb(a, b){
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/**
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} a
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} b
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
function mergeAabb(a, b){
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} aabb
 * @param {number} r
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
function expandAabb(aabb, r){
  return {
    minX: aabb.minX - r,
    minY: aabb.minY - r,
    maxX: aabb.maxX + r,
    maxY: aabb.maxY + r,
  };
}

/**
 * @param {Array<{x:number,y:number}>} verts
 * @returns {number}
 */
function signedArea2(verts){
  let s = 0;
  for (let i = 0; i < verts.length; i++){
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (!a || !b) continue;
    s += a.x * b.y - a.y * b.x;
  }
  return s;
}

/**
 * @param {Array<{x:number,y:number}>} verts
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
function hullAabb(verts){
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of verts){
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * @param {Array<[number,number]>} localHull
 * @param {{x:number,y:number}} pos
 * @param {number} angle
 * @returns {{verts:Array<{x:number,y:number}>,edges:Array<{a:{x:number,y:number},b:{x:number,y:number},normal:{x:number,y:number}}>,pos:{x:number,y:number},angle:number}}
 */
function transformHull(localHull, pos, angle){
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const verts = localHull.map(([lx, ly]) => ({
    x: pos.x + c * lx - s * ly,
    y: pos.y + s * lx + c * ly,
  }));
  const edges = [];
  for (let i = 0; i < verts.length; i++){
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    if (!a || !b) continue;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    edges.push({
      a,
      b,
      normal: { x: -ey / len, y: ex / len },
    });
  }
  if (signedArea2(verts) > 0){
    for (const edge of edges){
      edge.normal.x = -edge.normal.x;
      edge.normal.y = -edge.normal.y;
    }
  }
  return { verts, edges, pos, angle };
}

/**
 * @param {Array<[number,number]>} localHull
 * @param {{x:number,y:number}} startPos
 * @param {{x:number,y:number}} endPos
 * @param {number} startAngle
 * @param {number} endAngle
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
function sweptHullAabb(localHull, startPos, endPos, startAngle, endAngle){
  const startHull = transformHull(localHull, startPos, startAngle);
  const endHull = transformHull(localHull, endPos, endAngle);
  return expandAabb(mergeAabb(hullAabb(startHull.verts), hullAabb(endHull.verts)), 0.05);
}

/**
 * @param {import("./mothership.js").Mothership} mothership
 * @returns {{edges:Array<{id:number,a:{x:number,y:number},b:{x:number,y:number},normal:{x:number,y:number},aabb:{minX:number,minY:number,maxX:number,maxY:number},i:number,j:number}>,corners:Array<{id:number,p:{x:number,y:number},edgeIds:number[],aabb:{minX:number,minY:number,maxX:number,maxY:number}}>} }
 */
function getMothershipCollisionFeatures(mothership){
  // @ts-ignore dynamic cache on runtime object
  if (mothership._triangleCollisionFeatures){
    // @ts-ignore dynamic cache on runtime object
    return mothership._triangleCollisionFeatures;
  }
  const pad = Math.max(0.03, (mothership.spacing || 0.4) * 0.25);
  const edges = getMothershipBoundaryEdges(mothership).map((edge, id) => ({
    id,
    a: { x: edge.ax, y: edge.ay },
    b: { x: edge.bx, y: edge.by },
    normal: { x: edge.nx, y: edge.ny },
    aabb: expandAabb(segmentAabb({ x: edge.ax, y: edge.ay }, { x: edge.bx, y: edge.by }), pad),
    i: edge.i,
    j: edge.j,
  }));

  /** @type {Map<number,{id:number,p:{x:number,y:number},edgeIds:number[]}>} */
  const cornerMap = new Map();
  for (const edge of edges){
    const endpoints = [
      { vertexIdx: edge.i, point: edge.a },
      { vertexIdx: edge.j, point: edge.b },
    ];
    for (const endpoint of endpoints){
      let corner = cornerMap.get(endpoint.vertexIdx);
      if (!corner){
        corner = {
          id: cornerMap.size,
          p: { x: endpoint.point.x, y: endpoint.point.y },
          edgeIds: [],
        };
        cornerMap.set(endpoint.vertexIdx, corner);
      }
      corner.edgeIds.push(edge.id);
    }
  }
  const corners = Array.from(cornerMap.values(), (corner) => ({
    ...corner,
    aabb: {
      minX: corner.p.x - pad,
      minY: corner.p.y - pad,
      maxX: corner.p.x + pad,
      maxY: corner.p.y + pad,
    },
  }));
  const out = { edges, corners };
  // @ts-ignore dynamic cache on runtime object
  mothership._triangleCollisionFeatures = out;
  return out;
}

/**
 * @param {Array<[number,number]>} localHull
 * @param {{x:number,y:number}} startPos
 * @param {{x:number,y:number}} endPos
 * @param {number} startAngle
 * @param {number} endAngle
 * @param {import("./mothership.js").Mothership} mothership
 * @returns {{edges:Array<{id:number,a:{x:number,y:number},b:{x:number,y:number},normal:{x:number,y:number},aabb:{minX:number,minY:number,maxX:number,maxY:number},i:number,j:number}>,corners:Array<{id:number,p:{x:number,y:number},edgeIds:number[],aabb:{minX:number,minY:number,maxX:number,maxY:number}}>} }
 */
function gatherCandidateFeatures(localHull, startPos, endPos, startAngle, endAngle, mothership){
  const sweptAabb = sweptHullAabb(localHull, startPos, endPos, startAngle, endAngle);
  const features = getMothershipCollisionFeatures(mothership);
  return {
    edges: features.edges.filter((edge) => aabbOverlap(edge.aabb, sweptAabb)),
    corners: features.corners.filter((corner) => aabbOverlap(corner.aabb, sweptAabb)),
  };
}

/**
 * @param {{x:number,y:number}} p0
 * @param {{x:number,y:number}} v
 * @param {{a:{x:number,y:number},b:{x:number,y:number},normal:{x:number,y:number}}} edge
 * @param {number} dt
 * @returns {{type:"vertex-edge",time:number,point:{x:number,y:number},normal:{x:number,y:number},edgeId?:number,u:number}|null}
 */
function pointEdgeToi(p0, v, edge, dt){
  const denom = edge.normal.x * v.x + edge.normal.y * v.y;
  if (denom >= -1e-8) return null;
  const t = ((edge.a.x - p0.x) * edge.normal.x + (edge.a.y - p0.y) * edge.normal.y) / denom;
  if (t < -1e-8 || t > dt + 1e-8) return null;
  const hitX = p0.x + v.x * t;
  const hitY = p0.y + v.y * t;
  const ex = edge.b.x - edge.a.x;
  const ey = edge.b.y - edge.a.y;
  const e2 = ex * ex + ey * ey;
  const u = ((hitX - edge.a.x) * ex + (hitY - edge.a.y) * ey) / Math.max(e2, 1e-8);
  if (u < -1e-8 || u > 1 + 1e-8) return null;
  return {
    type: "vertex-edge",
    time: Math.max(0, Math.min(dt, t)),
    point: { x: hitX, y: hitY },
    normal: edge.normal,
    u,
  };
}

/**
 * @param {{p:{x:number,y:number},edgeIds:number[]}} corner
 * @param {{a:{x:number,y:number},b:{x:number,y:number},normal:{x:number,y:number}}} edge
 * @param {{x:number,y:number}} edgeVel
 * @param {number} dt
 * @returns {{type:"edge-corner",time:number,point:{x:number,y:number},normal:{x:number,y:number},u:number}|null}
 */
function wallCornerPlayerEdgeToi(corner, edge, edgeVel, dt){
  const denom = edge.normal.x * edgeVel.x + edge.normal.y * edgeVel.y;
  if (denom <= 1e-8) return null;
  const t = ((corner.p.x - edge.a.x) * edge.normal.x + (corner.p.y - edge.a.y) * edge.normal.y) / denom;
  if (t < -1e-8 || t > dt + 1e-8) return null;
  const atX = edge.a.x + edgeVel.x * t;
  const atY = edge.a.y + edgeVel.y * t;
  const btX = edge.b.x + edgeVel.x * t;
  const btY = edge.b.y + edgeVel.y * t;
  const ex = btX - atX;
  const ey = btY - atY;
  const e2 = ex * ex + ey * ey;
  const u = ((corner.p.x - atX) * ex + (corner.p.y - atY) * ey) / Math.max(e2, 1e-8);
  if (u < -1e-8 || u > 1 + 1e-8) return null;
  return {
    type: "edge-corner",
    time: Math.max(0, Math.min(dt, t)),
    point: { x: corner.p.x, y: corner.p.y },
    normal: edge.normal,
    u,
  };
}

/**
 * @param {{pos:{x:number,y:number},angle:number,vel:{x:number,y:number},angVel:number}} state
 * @param {number} t
 * @returns {{pos:{x:number,y:number},angle:number,vel:{x:number,y:number},angVel:number}}
 */
function advanceState(state, t){
  return {
    pos: {
      x: state.pos.x + state.vel.x * t,
      y: state.pos.y + state.vel.y * t,
    },
    angle: state.angle + state.angVel * t,
    vel: state.vel,
    angVel: state.angVel,
  };
}

/**
 * @param {{pos:{x:number,y:number},angle:number,vel:{x:number,y:number},angVel:number}} state
 * @param {[number,number]} localPoint
 * @returns {{x:number,y:number}}
 */
function localPointVelocity(state, localPoint){
  const c = Math.cos(state.angle);
  const s = Math.sin(state.angle);
  const rx = c * localPoint[0] - s * localPoint[1];
  const ry = s * localPoint[0] + c * localPoint[1];
  return {
    x: state.vel.x - state.angVel * ry,
    y: state.vel.y + state.angVel * rx,
  };
}

/**
 * @param {Array<{time:number,normal:{x:number,y:number}}>} hits
 * @param {{x:number,y:number}} vel
 * @returns {number}
 */
function chooseBestHitIndex(hits, vel){
  if (!hits.length) return -1;
  let bestIdx = 0;
  for (let i = 1; i < hits.length; i++){
    const best = hits[bestIdx];
    const hit = hits[i];
    if (!best || !hit) continue;
    if (hit.time < best.time - 1e-8){
      bestIdx = i;
      continue;
    }
    if (Math.abs(hit.time - best.time) > 1e-8) continue;
    const hitScore = vel.x * hit.normal.x + vel.y * hit.normal.y;
    const bestScore = vel.x * best.normal.x + vel.y * best.normal.y;
    if (hitScore < bestScore){
      bestIdx = i;
    }
  }
  return bestIdx;
}

/**
 * @param {number} shipX
 * @param {number} shipY
 * @returns {number}
 */
function shipWorldAngleAt(shipX, shipY){
  return -Math.atan2(shipX, shipY || 1e-6);
}

/**
 * @param {MothershipPose} prevPose
 * @param {MothershipPose} currPose
 * @param {number} t
 * @returns {MothershipPose}
 */
function interpolateMothershipPose(prevPose, currPose, t){
  return {
    x: prevPose.x + (currPose.x - prevPose.x) * t,
    y: prevPose.y + (currPose.y - prevPose.y) * t,
    angle: lerpAngleShortest(prevPose.angle, currPose.angle, t),
  };
}

/**
 * @param {Object} args
 * @param {import("./mothership.js").Mothership} args.mothership
 * @param {MothershipPose|null|undefined} args.mothershipPrevPose
 * @param {Array<[number,number]>} args.shipLocalConvexHull
 * @param {number} args.shipStartX
 * @param {number} args.shipStartY
 * @param {number} args.shipEndX
 * @param {number} args.shipEndY
 * @param {number} args.dt
 * @returns {{time:number,fraction:number,safeFraction:number,type:"vertex-edge"|"edge-corner",localPoint:{x:number,y:number},localNormal:{x:number,y:number},worldPoint:{x:number,y:number},worldNormal:{x:number,y:number},edgeId:number|null,cornerId:number|null,playerVertex:number|null,playerEdgeIndex:number|null}|null}
 */
export function findSweptMothershipCollision(args){
  const {
    mothership,
    mothershipPrevPose,
    shipLocalConvexHull,
    shipStartX,
    shipStartY,
    shipEndX,
    shipEndY,
    dt,
  } = args;
  if (!mothership || !Array.isArray(shipLocalConvexHull) || shipLocalConvexHull.length < 3) return null;
  const span = Math.max(1e-6, Number.isFinite(dt) ? Number(dt) : 1);
  const prevPose = mothershipPrevPose || mothership;
  const currPose = mothership;
  const startPos = worldToMothershipLocal(prevPose, shipStartX, shipStartY);
  const endPos = worldToMothershipLocal(currPose, shipEndX, shipEndY);
  const startAngle = shipWorldAngleAt(shipStartX, shipStartY) - prevPose.angle;
  const endAngle = shipWorldAngleAt(shipEndX, shipEndY) - currPose.angle;
  const angVel = (lerpAngleShortest(startAngle, endAngle, 1) - startAngle) / span;
  const state = {
    pos: startPos,
    angle: startAngle,
    vel: {
      x: (endPos.x - startPos.x) / span,
      y: (endPos.y - startPos.y) / span,
    },
    angVel,
  };
  const candidates = gatherCandidateFeatures(shipLocalConvexHull, startPos, endPos, startAngle, endAngle, mothership);
  if (!candidates.edges.length) return null;
  const worldHull = transformHull(shipLocalConvexHull, state.pos, state.angle);
  /** @type {Array<{time:number,point:{x:number,y:number},normal:{x:number,y:number},type:"vertex-edge"|"edge-corner",edgeId:number|null,cornerId:number|null,playerVertex:number|null,playerEdgeIndex:number|null}>} */
  const hits = [];

  for (let vertexIdx = 0; vertexIdx < shipLocalConvexHull.length; vertexIdx++){
    const p0 = worldHull.verts[vertexIdx];
    const localPoint = shipLocalConvexHull[vertexIdx];
    if (!p0 || !localPoint) continue;
    const v = localPointVelocity(state, localPoint);
    for (const edge of candidates.edges){
      const hit = pointEdgeToi(p0, v, edge, span);
      if (!hit) continue;
      hits.push({
        time: hit.time,
        point: hit.point,
        normal: hit.normal,
        type: hit.type,
        edgeId: edge.id,
        cornerId: null,
        playerVertex: vertexIdx,
        playerEdgeIndex: null,
      });
    }
  }

  for (const corner of candidates.corners){
    for (let edgeIdx = 0; edgeIdx < worldHull.edges.length; edgeIdx++){
      const edge = worldHull.edges[edgeIdx];
      const localPoint = shipLocalConvexHull[edgeIdx];
      if (!edge || !localPoint) continue;
      const edgeVel = localPointVelocity(state, localPoint);
      const hit = wallCornerPlayerEdgeToi(corner, edge, edgeVel, span);
      if (!hit) continue;
      let bestNormal = hit.normal;
      let bestD2 = Infinity;
      for (const boundaryEdgeId of corner.edgeIds){
        const wallEdge = candidates.edges.find((item) => item.id === boundaryEdgeId);
        if (!wallEdge) continue;
        const cp = closestPointOnSegment(
          wallEdge.a.x,
          wallEdge.a.y,
          wallEdge.b.x,
          wallEdge.b.y,
          hit.point.x,
          hit.point.y
        );
        if (cp.d2 < bestD2){
          bestD2 = cp.d2;
          bestNormal = wallEdge.normal;
        }
      }
      hits.push({
        time: hit.time,
        point: hit.point,
        normal: bestNormal,
        type: hit.type,
        edgeId: null,
        cornerId: corner.id,
        playerVertex: null,
        playerEdgeIndex: edgeIdx,
      });
    }
  }

  const bestIdx = chooseBestHitIndex(hits, state.vel);
  if (bestIdx < 0) return null;
  const hit = hits[bestIdx];
  if (!hit) return null;
  const fraction = Math.max(0, Math.min(1, hit.time / span));
  const safeFraction = Math.max(0, Math.min(1, (hit.time - 1e-5) / span));
  const poseAtImpact = interpolateMothershipPose(prevPose, currPose, fraction);
  const worldPoint = mothershipLocalToWorld(poseAtImpact, hit.point.x, hit.point.y);
  const worldNormal = mothershipLocalDirToWorld(poseAtImpact, hit.normal.x, hit.normal.y);
  return {
    time: hit.time,
    fraction,
    safeFraction,
    type: hit.type,
    localPoint: hit.point,
    localNormal: hit.normal,
    worldPoint,
    worldNormal,
    edgeId: hit.edgeId,
    cornerId: hit.cornerId,
    playerVertex: hit.playerVertex,
    playerEdgeIndex: hit.playerEdgeIndex,
  };
}

/**
 * @param {SweptMothershipCollisionCtx} ctx
 * @param {number} shipX0
 * @param {number} shipY0
 * @param {number} shipX1
 * @param {number} shipY1
 * @param {number} shipRadius
 * @param {{x:number,y:number,angle:number}} mothershipPrev
 * @param {{x:number,y:number,angle:number}} mothershipCurr
 * @returns {{x:number,y:number,hit:import("./types.d.js").CollisionHit,hitSource:"mothership"}|null}
 */
export function sweptShipVsMovingMothership(ctx, shipX0, shipY0, shipX1, shipY1, shipRadius, mothershipPrev, mothershipCurr){
  if (!ctx.mothership) return null;
  const impact = findSweptMothershipCollision({
    mothership: ctx.mothership,
    mothershipPrevPose: mothershipPrev,
    shipLocalConvexHull: ctx.shipLocalConvexHull(),
    shipStartX: shipX0,
    shipStartY: shipY0,
    shipEndX: shipX1,
    shipEndY: shipY1,
    dt: 1,
  });
  if (!impact) return null;
  const safeFraction = impact.safeFraction;
  return {
    x: shipX0 + (shipX1 - shipX0) * safeFraction,
    y: shipY0 + (shipY1 - shipY0) * safeFraction,
    hit: {
      x: impact.worldPoint.x,
      y: impact.worldPoint.y,
      contacts: [{
        x: impact.worldPoint.x,
        y: impact.worldPoint.y,
        nx: impact.worldNormal.x,
        ny: impact.worldNormal.y,
        av: 0,
      }],
    },
    hitSource: "mothership",
  };
}

/**
 * @param {import("./mothership.js").Mothership} mothership
 * @param {(x:number,y:number)=>Array<[number,number]>} shipCollisionPointsAt
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function hasStrictMothershipOverlapAtPose(mothership, shipCollisionPointsAt, x, y){
  const edges = getMothershipBoundaryEdges(mothership);
  const strictSkin = Math.max(0.002, (mothership.spacing || 0.4) * 0.01);
  const pts = shipCollisionPointsAt(x, y);
  pts.push([x, y]);
  for (const p of pts){
    const av = mothershipAirAtWorld(mothership, p[0], p[1]);
    if (av === null || av > 0.5) continue;
    const lp = worldToMothershipLocal(mothership, p[0], p[1]);
    let bestD2 = Infinity;
    for (const edge of edges){
      const cp = closestPointOnSegment(edge.ax, edge.ay, edge.bx, edge.by, lp.x, lp.y);
      if (cp.d2 < bestD2) bestD2 = cp.d2;
    }
    if (Math.sqrt(bestD2) > strictSkin){
      return true;
    }
  }
  return false;
}

/**
 * @typedef {{x:number,y:number,angle:number}} Pose
 * @typedef {Object} MothershipCollisionResponseArgs
 * @property {import("./types.d.js").Ship} ship
 * @property {import("./types.d.js").CollisionQuery} collision
 * @property {import("./mothership.js").Mothership} mothership
 * @property {{CRASH_SPEED:number,LAND_SPEED:number,LAND_FRICTION:number}} planetParams
 * @property {{SURFACE_DOT:number,BOUNCE_RESTITUTION:number,MOTHERSHIP_FRICTION:number,MOTHERSHIP_RESTITUTION:number,LAND_SPEED:number,LAND_MAX_TANGENT_SPEED?:number}} game
 * @property {number} dt
 * @property {number} eps
 * @property {boolean} [debugEnabled]
 * @property {number} shipRadius
 * @property {(x:number,y:number)=>Array<[number,number]>} shipCollisionPointsAt
 * @property {number} [mothershipAngularVel]
 * @property {{x:number,y:number,angle:number}|null} [mothershipPrevPose]
 * @property {Array<[number,number]>} shipLocalConvexHull
 * @property {number} shipStartX
 * @property {number} shipStartY
 * @property {number} shipEndX
 * @property {number} shipEndY
 * @property {boolean} [thrustInputActive]
 * @property {number} [controlAccelX]
 * @property {number} [controlAccelY]
 * @property {()=>void} onCrash
 * @property {()=>boolean} isDockedWithMothership
 * @property {()=>void} onSuccessfullyDocked
 */

/**
 * @param {number} vx
 * @param {number} vy
 * @returns {{vx:number,vy:number,speed:number,dirDeg:number}}
 */
function vecDiag(vx, vy){
  return {
    vx,
    vy,
    speed: Math.hypot(vx, vy),
    dirDeg: Math.atan2(vy, vx) * 180 / Math.PI,
  };
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {{x:number,y:number}}
 */
function normalize(x, y){
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

/**
 * @param {{x:number,y:number}} v
 * @param {{x:number,y:number}} n
 * @param {number} restitution
 * @returns {{x:number,y:number}}
 */
function reflectVelocity(v, n, restitution){
  const vn = v.x * n.x + v.y * n.y;
  if (vn >= 0) return { x: v.x, y: v.y };
  return {
    x: v.x - (1 + restitution) * vn * n.x,
    y: v.y - (1 + restitution) * vn * n.y,
  };
}

/**
 * Reflect relative velocity and damp tangential slide along the impact surface.
 * @param {{x:number,y:number}} v
 * @param {{x:number,y:number}} n
 * @param {number} restitution
 * @param {number} friction
 * @param {number} dt
 * @returns {{x:number,y:number}}
 */
function reflectVelocityWithFriction(v, n, restitution, friction, dt){
  const reflected = reflectVelocity(v, n, restitution);
  const tx = -n.y;
  const ty = n.x;
  const vn = reflected.x * n.x + reflected.y * n.y;
  const vt = reflected.x * tx + reflected.y * ty;
  const damp = Math.max(0, 1 - Math.max(0, friction) * 0.45 * Math.max(0, dt));
  const vtDamped = vt * damp;
  return {
    x: n.x * vn + tx * vtDamped,
    y: n.y * vn + ty * vtDamped,
  };
}

/**
 * @param {Pose} a
 * @param {Pose} b
 * @param {number} t
 * @returns {Pose}
 */
function lerpPose(a, b, t){
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: lerpAngleShortest(a.angle, b.angle, t),
  };
}

/**
 * @param {import("./mothership.js").Mothership} mothership
 * @param {Pose} pose
 * @param {number} omega
 * @param {number} x
 * @param {number} y
 * @returns {{vx:number,vy:number}}
 */
function baseVelocityAtPose(mothership, pose, omega, x, y){
  const rx = x - pose.x;
  const ry = y - pose.y;
  return {
    vx: mothership.vx - omega * ry,
    vy: mothership.vy + omega * rx,
  };
}

/**
 * @param {import("./mothership.js").Mothership} mothership
 * @param {(x:number,y:number)=>Array<[number,number]>} shipCollisionPointsAt
 * @param {number} x
 * @param {number} y
 * @returns {{x:number,y:number,nx:number,ny:number,edgeIdx:number}|null}
 */
function nearestBoundaryContactAtPose(mothership, shipCollisionPointsAt, x, y){
  const edges = getMothershipBoundaryEdges(mothership);
  const pts = shipCollisionPointsAt(x, y);
  pts.push([x, y]);
  let best = null;
  for (const p of pts){
    const lp = worldToMothershipLocal(mothership, p[0], p[1]);
    const av = mothershipAirAtLocalExact(mothership, lp.x, lp.y);
    const inside = av !== null && av <= 0.5;
    for (let edgeIdx = 0; edgeIdx < edges.length; edgeIdx++){
      const edge = edges[edgeIdx];
      if (!edge) continue;
      const cp = closestPointOnSegment(edge.ax, edge.ay, edge.bx, edge.by, lp.x, lp.y);
      const candidate = {
        inside,
        d2: cp.d2,
        x: cp.x,
        y: cp.y,
        nx: edge.nx,
        ny: edge.ny,
        edgeIdx,
      };
      if (!best){
        best = candidate;
        continue;
      }
      if (candidate.inside !== best.inside){
        if (candidate.inside) best = candidate;
        continue;
      }
      if (candidate.d2 < best.d2){
        best = candidate;
      }
    }
  }
  if (!best) return null;
  const c = Math.cos(mothership.angle);
  const s = Math.sin(mothership.angle);
  const n = normalize(
    c * best.nx - s * best.ny,
    s * best.nx + c * best.ny
  );
  return {
    x: mothership.x + c * best.x - s * best.y,
    y: mothership.y + s * best.x + c * best.y,
    nx: n.x,
    ny: n.y,
    edgeIdx: best.edgeIdx,
  };
}

/**
 * @param {any} landingDbg
 * @param {import("./types.d.js").Ship} ship
 * @param {any} payload
 * @returns {void}
 */
function setDiag(landingDbg, ship, payload){
  if (!landingDbg) return;
  const prev = ship._lastMothershipCollisionDiag || null;
  const outAbs = payload && payload.absOut ? payload.absOut : null;
  const outRel = payload && payload.relOut ? payload.relOut : null;
  landingDbg.collisionDiag = { ...payload, prev };
  ship._lastMothershipCollisionDiag = { abs: outAbs, rel: outRel };
}

/**
 * @param {import("./mothership.js").Mothership} mothership
 * @param {number} nx
 * @param {number} ny
 * @param {number} shipX
 * @param {number} shipY
 * @param {number} shipRadius
 * @param {{SURFACE_DOT:number}} game
 * @returns {{dotUpRaw:number,slope:number,landSlope:number,dockTest:{lx:number,ly:number},dockLocalNormal:{x:number,y:number},dockableSurface:boolean,dockFloorNormal:boolean,landedTestX:number,landedTestY:number,landable:boolean}}
 */
function buildLandingData(mothership, nx, ny, shipX, shipY, shipRadius, game){
  const cUp = Math.cos(mothership.angle);
  const sUp = Math.sin(mothership.angle);
  const upx = -sUp;
  const upy = cUp;
  const maxSlope = 1 - Math.cos(Math.PI / 8);
  const landSlope = Math.min((1 - game.SURFACE_DOT) + 0.03, maxSlope);
  const dotUpRaw = nx * upx + ny * upy;
  const slope = 1 - Math.abs(dotUpRaw);
  const landable = (dotUpRaw < 0 && slope <= landSlope);
  const landingClearance = Math.max(0.01, Math.min(shipRadius * 0.16, (mothership.spacing || 0.4) * 0.08));
  const landedTestX = shipX + nx * landingClearance;
  const landedTestY = shipY + ny * landingClearance;
  const dx = landedTestX - mothership.x;
  const dy = landedTestY - mothership.y;
  const c = Math.cos(-mothership.angle);
  const s = Math.sin(-mothership.angle);
  const dockTest = {
    lx: c * dx - s * dy,
    ly: s * dx + c * dy,
  };
  const dockLocalNormal = {
    x: c * nx - s * ny,
    y: s * nx + c * ny,
  };
  return {
    dotUpRaw,
    slope,
    landSlope,
    dockTest,
    dockLocalNormal,
    dockableSurface: dockTest.ly > 0.5,
    dockFloorNormal: dockLocalNormal.y <= -0.6,
    landedTestX,
    landedTestY,
    landable,
  };
}

/**
 * @param {MothershipCollisionResponseArgs} args
 * @returns {void}
 */
export function resolveMothershipCollisionResponse(args){
  const {
    ship,
    collision,
    mothership,
    planetParams,
    game,
    dt,
    eps,
    debugEnabled = false,
    shipRadius,
    shipCollisionPointsAt,
    mothershipAngularVel,
    mothershipPrevPose,
    shipLocalConvexHull,
    shipStartX,
    shipStartY,
    shipEndX,
    shipEndY,
    thrustInputActive = false,
    controlAccelX = Number.NaN,
    controlAccelY = Number.NaN,
    onCrash,
    isDockedWithMothership,
    onSuccessfullyDocked,
  } = args;
  const hit = ship._collision;
  if (!hit || hit.source !== "mothership") return;
  if (!debugEnabled){
    ship._landingDebug = null;
    ship._lastMothershipCollisionDiag = null;
  }

  const omega = Number.isFinite(mothershipAngularVel) ? Number(mothershipAngularVel) : 0;
  const restitution = Number.isFinite(game.MOTHERSHIP_RESTITUTION)
    ? Math.max(0, Math.min(1, Number(game.MOTHERSHIP_RESTITUTION)))
    : 0.8;
  const mothershipFriction = Number.isFinite(game.MOTHERSHIP_FRICTION)
    ? Math.max(0, Number(game.MOTHERSHIP_FRICTION))
    : 0;
  const maxImpacts = 4;
  const finalPose = /** @type {Pose} */ ({ x: mothership.x, y: mothership.y, angle: mothership.angle });
  const startPose = mothershipPrevPose
    ? /** @type {Pose} */ ({ x: mothershipPrevPose.x, y: mothershipPrevPose.y, angle: mothershipPrevPose.angle })
    : finalPose;
  const hx = Number.isFinite(hit.x) ? hit.x : ship.x;
  const hy = Number.isFinite(hit.y) ? hit.y : ship.y;

  let curX = shipStartX;
  let curY = shipStartY;
  let curVx = ship.vx;
  let curVy = ship.vy;
  let remainingDt = Math.max(1e-6, Number.isFinite(dt) ? Number(dt) : 1 / 60);
  let segStartPose = startPose;
  let firstSegment = true;
  let lastContact = null;
  let lastDiagDebug = null;
  let overlapBefore = false;
  let overlapAfter = false;
  let depenPush = 0;
  let depenCleared = true;
  let handledImpact = false;

  for (let impactCount = 0; impactCount < maxImpacts && remainingDt > 1e-6; impactCount++){
    const targetX = firstSegment ? shipEndX : (curX + curVx * remainingDt);
    const targetY = firstSegment ? shipEndY : (curY + curVy * remainingDt);
    const impact = findSweptMothershipCollision({
      mothership,
      mothershipPrevPose: segStartPose,
      shipLocalConvexHull,
      shipStartX: curX,
      shipStartY: curY,
      shipEndX: targetX,
      shipEndY: targetY,
      dt: remainingDt,
    });
    firstSegment = false;
    if (!impact){
      curX = targetX;
      curY = targetY;
      break;
    }

    handledImpact = true;
    const safeFraction = impact.safeFraction;
    const hitFraction = impact.fraction;
    curX = curX + (targetX - curX) * safeFraction;
    curY = curY + (targetY - curY) * safeFraction;
    const hitPose = lerpPose(segStartPose, finalPose, hitFraction);
    const baseAtHit = baseVelocityAtPose(mothership, hitPose, omega, impact.worldPoint.x, impact.worldPoint.y);
    const n = normalize(impact.worldNormal.x, impact.worldNormal.y);
    const relIn = { x: curVx - baseAtHit.vx, y: curVy - baseAtHit.vy };
    const vnIn = relIn.x * n.x + relIn.y * n.y;
    const tx = -n.y;
    const ty = n.x;
    const vtIn = relIn.x * tx + relIn.y * ty;
    lastContact = {
      x: impact.worldPoint.x,
      y: impact.worldPoint.y,
      nx: n.x,
      ny: n.y,
      kind: impact.type,
      edgeIdx: Number.isFinite(impact.edgeId) ? impact.edgeId : null,
    };
    if (debugEnabled){
      lastDiagDebug = {
        type: impact.type,
        time: impact.time,
        fraction: impact.fraction,
        safeFraction: impact.safeFraction,
        edgeId: impact.edgeId,
        cornerId: impact.cornerId,
        playerVertex: impact.playerVertex,
        playerEdgeIndex: impact.playerEdgeIndex,
      };
    }

    if (vnIn < -planetParams.CRASH_SPEED){
      if (debugEnabled){
        ship._landingDebug = {
          source: "mothership",
          reason: "mothership_crash",
          vn: vnIn,
          vt: vtIn,
          speed: Math.hypot(relIn.x, relIn.y),
          impactX: impact.worldPoint.x,
          impactY: impact.worldPoint.y,
          supportX: impact.worldPoint.x,
          supportY: impact.worldPoint.y,
        };
      }
      onCrash();
      return;
    }

    const landing = buildLandingData(mothership, n.x, n.y, curX, curY, shipRadius, game);
    const mothershipLandSpeed = Math.max(0, Number(game.LAND_SPEED) || 0);
    const landVn = Math.max(0.08, mothershipLandSpeed * 3.0);
    const landVt = Math.max(0, Number(game.LAND_MAX_TANGENT_SPEED) || 0);
    const controlTangentAccel = Number.isFinite(controlAccelX) && Number.isFinite(controlAccelY)
      ? (controlAccelX * tx + controlAccelY * ty)
      : 0;
    const tangentThrustReinforcing = !!thrustInputActive
      && Math.abs(vtIn) > 0.05
      && Math.abs(controlTangentAccel) > 0.05
      && Math.sign(controlTangentAccel) === Math.sign(vtIn);
    if (
      landing.landable
      && landing.dockableSurface
      && landing.dockFloorNormal
      && !tangentThrustReinforcing
      && vnIn >= -landVn
      && Math.abs(vtIn) < landVt
    ){
      ship.state = "landed";
      ship.x = landing.landedTestX;
      ship.y = landing.landedTestY;
      ship.vx = mothership.vx;
      ship.vy = mothership.vy;
      ship._dock = landing.dockTest;
      ship._landingDebug = debugEnabled ? {
        source: "mothership",
        reason: "mothership_landed",
        dotUp: landing.dotUpRaw,
        slope: landing.slope,
        landSlope: landing.landSlope,
        vn: vnIn,
        vt: vtIn,
        speed: Math.hypot(relIn.x, relIn.y),
        impactX: impact.worldPoint.x,
        impactY: impact.worldPoint.y,
        supportX: impact.worldPoint.x,
        supportY: impact.worldPoint.y,
        contactsCount: 1,
        overlapBeforeCount: 0,
        overlapAfterCount: 0,
        overlapBeforeMin: 1,
        overlapAfterMin: 1,
        depenIter: 0,
        depenPush: 0,
        depenCushion: 0,
        depenDir: 0,
        depenCleared: true,
        landable: true,
        landed: true,
      } : null;
      if (debugEnabled) setDiag(ship._landingDebug, ship, {
        phase: "landed",
        hitCount: 1,
        distinctHullCount: 1,
        averageNormal: { nx: n.x, ny: n.y },
        normals: [{
          kind: impact.type,
          edgeIdx: Number.isFinite(impact.edgeId) ? impact.edgeId : -1,
          hullIdx: -1,
          x: impact.worldPoint.x,
          y: impact.worldPoint.y,
          nx: n.x,
          ny: n.y,
          av: null,
        }],
        absIn: vecDiag(ship.vx, ship.vy),
        absOut: vecDiag(ship.vx, ship.vy),
        baseAtContact: vecDiag(baseAtHit.vx, baseAtHit.vy),
        relIn: vecDiag(relIn.x, relIn.y),
        relOut: vecDiag(0, 0),
        absInLocal: vecDiag(ship.vx, ship.vy),
        absOutLocal: vecDiag(ship.vx, ship.vy),
        baseAtContactLocal: vecDiag(baseAtHit.vx, baseAtHit.vy),
        relInLocal: vecDiag(relIn.x, relIn.y),
        relOutLocal: vecDiag(0, 0),
        vnIn,
        vtIn,
        vnOut: 0,
        vtOut: 0,
        backoff: { dist: 0, dirX: n.x, dirY: n.y, cleared: true },
        overlap: { before: false, after: false },
        evidence: {
          valid: true,
          reason: impact.type,
          hits: [{
            kind: impact.type,
            edgeIdx: Number.isFinite(impact.edgeId) ? impact.edgeId : -1,
            hullIdx: -1,
            x: impact.worldPoint.x,
            y: impact.worldPoint.y,
            nx: n.x,
            ny: n.y,
            av: null,
          }],
          debug: lastDiagDebug,
        },
        dock: {
          lx: landing.dockTest.lx,
          ly: landing.dockTest.ly,
          localNx: landing.dockLocalNormal.x,
          localNy: landing.dockLocalNormal.y,
          dockableSurface: landing.dockableSurface,
          dockFloorNormal: landing.dockFloorNormal,
        },
      });
      if (isDockedWithMothership()){
        onSuccessfullyDocked();
      }
      return;
    }

    const relOut = reflectVelocityWithFriction(relIn, n, restitution, mothershipFriction, dt);
    curVx = baseAtHit.vx + relOut.x;
    curVy = baseAtHit.vy + relOut.y;
    curX += n.x * Math.max(0.002, (mothership.spacing || 0.4) * 0.03);
    curY += n.y * Math.max(0.002, (mothership.spacing || 0.4) * 0.03);
    remainingDt = Math.max(0, remainingDt - impact.time);
    segStartPose = lerpPose(segStartPose, finalPose, hitFraction);
  }

  ship.x = curX;
  ship.y = curY;
  ship.vx = curVx;
  ship.vy = curVy;

  overlapBefore = hasStrictMothershipOverlapAtPose(mothership, shipCollisionPointsAt, ship.x, ship.y);
  if (overlapBefore){
    const poseContact = nearestBoundaryContactAtPose(mothership, shipCollisionPointsAt, ship.x, ship.y) || (() => {
      const n = sampleGradientNormal((x, y) => collision.airValueAtWorld(x, y), eps, ship.x, ship.y, hx, hy);
      return { x: hx, y: hy, nx: n.nx, ny: n.ny, edgeIdx: -1 };
    })();
    const depen = depenetrateAlongNormal(
      ship.x,
      ship.y,
      poseContact.nx,
      poseContact.ny,
      (x, y) => hasStrictMothershipOverlapAtPose(mothership, shipCollisionPointsAt, x, y),
      Math.max(0.35, shipRadius * 1.4),
      Math.max(0.01, shipRadius * 0.06)
    );
    ship.x = depen.x;
    ship.y = depen.y;
    depenPush += depen.push;
    depenCleared = depenCleared && depen.cleared;
    overlapAfter = hasStrictMothershipOverlapAtPose(mothership, shipCollisionPointsAt, ship.x, ship.y);
    const n = normalize(poseContact.nx, poseContact.ny);
    const base = baseVelocityAtPose(mothership, finalPose, omega, poseContact.x, poseContact.y);
    const relIn = { x: ship.vx - base.vx, y: ship.vy - base.vy };
    const vnIn = relIn.x * n.x + relIn.y * n.y;
    if (vnIn < 0){
      const relOut = reflectVelocityWithFriction(relIn, n, restitution, mothershipFriction, dt);
      ship.vx = base.vx + relOut.x;
      ship.vy = base.vy + relOut.y;
    }
    ship.x += n.x * Math.max(0.002, shipRadius * 0.02);
    ship.y += n.y * Math.max(0.002, shipRadius * 0.02);
    lastContact = {
      x: poseContact.x,
      y: poseContact.y,
      nx: n.x,
      ny: n.y,
      kind: "overlap_pose",
      edgeIdx: Number.isFinite(poseContact.edgeIdx) ? poseContact.edgeIdx : null,
    };
  } else {
    overlapAfter = false;
  }

  if (!handledImpact && !lastContact){
    ship._collision = null;
    ship._landingDebug = debugEnabled ? {
      source: "mothership",
      reason: "mothership_no_contact",
      vn: 0,
      vt: 0,
      speed: 0,
      impactX: hx,
      impactY: hy,
      supportX: hx,
      supportY: hy,
      contactsCount: 0,
      overlapBeforeCount: 0,
      overlapAfterCount: 0,
      overlapBeforeMin: 1,
      overlapAfterMin: 1,
      depenIter: 0,
      depenPush: 0,
      depenCushion: 0,
      depenDir: 0,
      depenCleared: true,
    } : null;
    if (debugEnabled) setDiag(ship._landingDebug, ship, {
      phase: "no_contact",
      hitCount: 0,
      distinctHullCount: 0,
      averageNormal: null,
      normals: [],
      absIn: vecDiag(curVx, curVy),
      absOut: vecDiag(curVx, curVy),
      baseAtContact: vecDiag(0, 0),
      relIn: vecDiag(0, 0),
      relOut: vecDiag(0, 0),
      absInLocal: vecDiag(curVx, curVy),
      absOutLocal: vecDiag(curVx, curVy),
      baseAtContactLocal: vecDiag(0, 0),
      relInLocal: vecDiag(0, 0),
      relOutLocal: vecDiag(0, 0),
      vnIn: 0,
      vtIn: 0,
      vnOut: 0,
      vtOut: 0,
      backoff: { dist: depenPush, dirX: 0, dirY: 0, cleared: depenCleared },
      overlap: { before: false, after: false },
      evidence: { valid: false, reason: "no_contact", hits: [], debug: null },
      dock: null,
    });
    return;
  }

  const base = lastContact ? baseVelocityAtPose(mothership, finalPose, omega, lastContact.x, lastContact.y) : { vx: 0, vy: 0 };
  const relNowVx = ship.vx - base.vx;
  const relNowVy = ship.vy - base.vy;
  const tx = lastContact ? -lastContact.ny : 0;
  const ty = lastContact ? lastContact.nx : 0;
  const vnNow = lastContact ? (relNowVx * lastContact.nx + relNowVy * lastContact.ny) : 0;
  const vtNow = lastContact ? (relNowVx * tx + relNowVy * ty) : 0;
  const landing = lastContact
    ? buildLandingData(mothership, lastContact.nx, lastContact.ny, ship.x, ship.y, shipRadius, game)
    : null;

  ship._collision = null;
  if (debugEnabled){
    /** @type {NonNullable<typeof ship._landingDebug>} */
    const landingDebug = {
      source: "mothership",
      reason: overlapAfter ? "mothership_overlap_only" : "mothership_reflect",
      vn: vnNow,
      vt: vtNow,
      speed: Math.hypot(relNowVx, relNowVy),
      impactX: lastContact ? lastContact.x : hx,
      impactY: lastContact ? lastContact.y : hy,
      supportX: lastContact ? lastContact.x : hx,
      supportY: lastContact ? lastContact.y : hy,
      contactsCount: lastContact ? 1 : 0,
      overlapBeforeCount: overlapBefore ? 1 : 0,
      overlapAfterCount: overlapAfter ? 1 : 0,
      overlapBeforeMin: overlapBefore ? 0 : 1,
      overlapAfterMin: overlapAfter ? 0 : 1,
      depenIter: depenPush > 0 ? 1 : 0,
      depenPush,
      depenCushion: 0,
      depenDir: depenPush > 0 ? 1 : 0,
      depenCleared,
    };
    if (landing){
      landingDebug.dotUp = landing.dotUpRaw;
      landingDebug.slope = landing.slope;
      landingDebug.landSlope = landing.landSlope;
    }
    ship._landingDebug = landingDebug;
  } else {
    ship._landingDebug = null;
  }

  if (debugEnabled && ship._landingDebug) setDiag(ship._landingDebug, ship, {
    phase: "reflect",
    hitCount: lastContact ? 1 : 0,
    distinctHullCount: lastContact ? 1 : 0,
    averageNormal: lastContact ? { nx: lastContact.nx, ny: lastContact.ny } : null,
    normals: lastContact ? [{
      kind: lastContact.kind,
      edgeIdx: Number.isFinite(lastContact.edgeIdx) ? lastContact.edgeIdx : -1,
      hullIdx: -1,
      x: lastContact.x,
      y: lastContact.y,
      nx: lastContact.nx,
      ny: lastContact.ny,
      av: null,
    }] : [],
    absIn: vecDiag(curVx, curVy),
    absOut: vecDiag(ship.vx, ship.vy),
    baseAtContact: vecDiag(base.vx, base.vy),
    relIn: vecDiag(relNowVx, relNowVy),
    relOut: vecDiag(relNowVx, relNowVy),
    absInLocal: vecDiag(curVx, curVy),
    absOutLocal: vecDiag(ship.vx, ship.vy),
    baseAtContactLocal: vecDiag(base.vx, base.vy),
    relInLocal: vecDiag(relNowVx, relNowVy),
    relOutLocal: vecDiag(relNowVx, relNowVy),
    vnIn: vnNow,
    vtIn: vtNow,
    vnOut: vnNow,
    vtOut: vtNow,
    backoff: { dist: depenPush, dirX: lastContact ? lastContact.nx : 0, dirY: lastContact ? lastContact.ny : 0, cleared: depenCleared },
    overlap: { before: overlapBefore, after: overlapAfter },
    evidence: {
      valid: !!lastContact,
      reason: lastContact ? lastContact.kind : "no_contact",
      hits: lastContact ? [{
        kind: lastContact.kind,
        edgeIdx: Number.isFinite(lastContact.edgeIdx) ? lastContact.edgeIdx : -1,
        hullIdx: -1,
        x: lastContact.x,
        y: lastContact.y,
        nx: lastContact.nx,
        ny: lastContact.ny,
        av: null,
      }] : [],
      debug: lastDiagDebug,
    },
    dock: landing ? {
      lx: landing.dockTest.lx,
      ly: landing.dockTest.ly,
      localNx: landing.dockLocalNormal.x,
      localNy: landing.dockLocalNormal.y,
      dockableSurface: landing.dockableSurface,
      dockFloorNormal: landing.dockFloorNormal,
    } : null,
  });
}

