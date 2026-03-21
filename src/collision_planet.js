// @ts-check

import { mothershipAirAtWorld } from "./mothership.js";

/**
 * @template T
 * @param {T|null|undefined} value
 * @returns {T}
 */
function expectDefined(value){
  if (value == null){
    throw new Error("Expected value to be defined");
  }
  return value;
}

/**
 * @param {Array<{x:number,y:number,air:number}>|null|undefined} tri
 * @param {number} fallbackNx
 * @param {number} fallbackNy
 * @returns {{nx:number,ny:number}}
 */
function triAirNormalFromTri(tri, fallbackNx, fallbackNy){
  if (!tri || tri.length < 3){
    return { nx: fallbackNx, ny: fallbackNy };
  }
  const a = tri[0];
  const b = tri[1];
  const c = tri[2];
  if (!a || !b || !c){
    return { nx: fallbackNx, ny: fallbackNy };
  }
  const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  if (Math.abs(det) < 1e-8){
    return { nx: fallbackNx, ny: fallbackNy };
  }
  const dfdx = (a.air * (b.y - c.y) + b.air * (c.y - a.y) + c.air * (a.y - b.y)) / det;
  const dfdy = (a.air * (c.x - b.x) + b.air * (a.x - c.x) + c.air * (b.x - a.x)) / det;
  const gLen = Math.hypot(dfdx, dfdy);
  if (gLen < 1e-8){
    return { nx: fallbackNx, ny: fallbackNy };
  }
  let nx = dfdx / gLen;
  let ny = dfdy / gLen;
  if (nx * fallbackNx + ny * fallbackNy < 0){
    nx = -nx;
    ny = -ny;
  }
  return { nx, ny };
}

/**
 * @param {import("./mothership.js").Mothership} mothership
 * @param {number} x
 * @param {number} y
 * @returns {{x:number,y:number}}
 */
function worldToMothershipLocal(mothership, x, y){
  const dx = x - mothership.x;
  const dy = y - mothership.y;
  const c = Math.cos(-mothership.angle);
  const s = Math.sin(-mothership.angle);
  return {
    x: c * dx - s * dy,
    y: s * dx + c * dy,
  };
}

/**
 * @param {import("./mothership.js").Mothership} mothership
 * @param {number} x
 * @param {number} y
 * @returns {{x:number,y:number}}
 */
function mothershipLocalToWorld(mothership, x, y){
  const c = Math.cos(mothership.angle);
  const s = Math.sin(mothership.angle);
  return {
    x: mothership.x + c * x - s * y,
    y: mothership.y + s * x + c * y,
  };
}

/**
 * @param {import("./mothership.js").Mothership} mothership
 * @param {number} nx
 * @param {number} ny
 * @returns {{x:number,y:number}}
 */
function mothershipLocalDirToWorld(mothership, nx, ny){
  const c = Math.cos(mothership.angle);
  const s = Math.sin(mothership.angle);
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
 * @param {import("./mothership.js").Mothership} mothership
 * @param {number} lx
 * @param {number} ly
 * @returns {number|null}
 */
function mothershipAirAtLocalExact(mothership, lx, ly){
  const points = mothership.points;
  const tris = mothership.tris;
  const triAir = mothership.triAir || [];
  let hit = false;
  let maxAir = -Infinity;
  for (let i = 0; i < tris.length; i++){
    const tri = tris[i];
    if (!tri) continue;
    const a = points[tri[0]];
    const b = points[tri[1]];
    const c = points[tri[2]];
    if (!a || !b || !c) continue;
    if (!pointInTriLocal(lx, ly, a.x, a.y, b.x, b.y, c.x, c.y)) continue;
    const triAirValue = triAir[i];
    const air = (typeof triAirValue === "number" && Number.isFinite(triAirValue)) ? triAirValue : 1;
    if (!hit || air > maxAir){
      maxAir = air;
      hit = true;
    }
  }
  return hit ? maxAir : null;
}

/**
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {number}
 */
function cross2(ax, ay, bx, by){
  return ax * by - ay * bx;
}

/**
 * @param {number} px
 * @param {number} py
 * @param {number} rx
 * @param {number} ry
 * @param {number} qx
 * @param {number} qy
 * @param {number} sx
 * @param {number} sy
 * @returns {{t:number,u:number}|null}
 */
function segmentIntersectionParams(px, py, rx, ry, qx, qy, sx, sy){
  const den = cross2(rx, ry, sx, sy);
  if (Math.abs(den) < 1e-9) return null;
  const qpx = qx - px;
  const qpy = qy - py;
  const t = cross2(qpx, qpy, sx, sy) / den;
  const u = cross2(qpx, qpy, rx, ry) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { t, u };
}

/**
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} px
 * @param {number} py
 * @returns {{x:number,y:number,u:number,d2:number}}
 */
function closestPointOnSegment(ax, ay, bx, by, px, py){
  const ex = bx - ax;
  const ey = by - ay;
  const e2 = ex * ex + ey * ey;
  if (e2 < 1e-10){
    const dx = px - ax;
    const dy = py - ay;
    return { x: ax, y: ay, u: 0, d2: dx * dx + dy * dy };
  }
  let u = ((px - ax) * ex + (py - ay) * ey) / e2;
  u = Math.max(0, Math.min(1, u));
  const x = ax + ex * u;
  const y = ay + ey * u;
  const dx = px - x;
  const dy = py - y;
  return { x, y, u, d2: dx * dx + dy * dy };
}

/**
 * Build exact solid-air boundary edges in mothership local space.
 * Outward normal points from solid toward air.
 * @param {import("./mothership.js").Mothership} mothership
 * @returns {Array<{ax:number,ay:number,bx:number,by:number,nx:number,ny:number}>}
 */
function getMothershipBoundaryEdges(mothership){
  // @ts-ignore dynamic cache on runtime object
  if (Array.isArray(mothership._collisionBoundaryEdgesExact)){
    // @ts-ignore dynamic cache on runtime object
    return mothership._collisionBoundaryEdgesExact;
  }
  const points = mothership.points;
  const tris = mothership.tris;
  const triAir = mothership.triAir || [];
  /** @type {Map<string,{i:number,j:number,solidCount:number,airCount:number,solidThird:number}>} */
  const edgeMap = new Map();
  for (let ti = 0; ti < tris.length; ti++){
    const tri = tris[ti];
    if (!tri) continue;
    const triAirValue = triAir[ti];
    const solid = ((typeof triAirValue === "number" && Number.isFinite(triAirValue)) ? triAirValue : 1) <= 0.5;
    for (let e = 0; e < 3; e++){
      const i0 = tri[e];
      const i1 = tri[(e + 1) % 3];
      const ik = tri[(e + 2) % 3];
      if (i0 === undefined || i1 === undefined || ik === undefined) continue;
      const i = Math.min(i0, i1);
      const j = Math.max(i0, i1);
      const key = `${i},${j}`;
      let rec = edgeMap.get(key);
      if (!rec){
        rec = { i, j, solidCount: 0, airCount: 0, solidThird: -1 };
        edgeMap.set(key, rec);
      }
      if (solid){
        rec.solidCount++;
        if (rec.solidThird < 0) rec.solidThird = ik;
      } else {
        rec.airCount++;
      }
    }
  }

  /** @type {Array<{ax:number,ay:number,bx:number,by:number,nx:number,ny:number}>} */
  const edges = [];
  for (const rec of edgeMap.values()){
    if (rec.solidCount <= 0) continue;
    if (rec.solidCount >= 2 && rec.airCount === 0) continue;
    const a = points[rec.i];
    const b = points[rec.j];
    if (!a || !b) continue;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-8) continue;
    let nx = ey / len;
    let ny = -ex / len;
    const mx = (a.x + b.x) * 0.5;
    const my = (a.y + b.y) * 0.5;
    if (rec.solidCount === 1 && rec.solidThird >= 0){
      // Deterministic orientation for normal manifold boundary edges:
      // normal must point away from solid-triangle interior.
      const c = points[rec.solidThird];
      if (!c) continue;
      const toSolidX = c.x - mx;
      const toSolidY = c.y - my;
      if (toSolidX * nx + toSolidY * ny > 0){
        nx = -nx;
        ny = -ny;
      }
    } else {
      // Non-manifold fallback: orient by local air probe.
      const eps = Math.max(0.01, (mothership.spacing || 0.4) * 0.18);
      const n2x = -nx;
      const n2y = -ny;
      const av1Raw = mothershipAirAtLocalExact(mothership, mx + nx * eps, my + ny * eps);
      const av2Raw = mothershipAirAtLocalExact(mothership, mx + n2x * eps, my + n2y * eps);
      const av1 = (av1Raw === null) ? 1 : av1Raw;
      const av2 = (av2Raw === null) ? 1 : av2Raw;
      if (av2 > av1 + 1e-6){
        nx = n2x;
        ny = n2y;
      } else if (Math.abs(av1 - av2) <= 1e-6 && rec.solidThird >= 0){
        const c = points[rec.solidThird];
        if (!c) continue;
        const toSolidX = c.x - mx;
        const toSolidY = c.y - my;
        if (toSolidX * nx + toSolidY * ny > 0){
          nx = -nx;
          ny = -ny;
        }
      }
    }
    edges.push({
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      nx,
      ny,
    });
  }
  // @ts-ignore dynamic cache on runtime object
  mothership._collisionBoundaryEdgesExact = edges;
  return edges;
}

/**
 * @param {Array<[number,number]>|undefined} points
 * @returns {Array<[number,number]>}
 */
function hullLoopFromCollisionPoints(points){
  if (!Array.isArray(points) || points.length <= 0) return [];
  if (points.length >= 4) return points.slice(0, -1);
  return points.slice();
}

/**
 * Collect actual mothership wall contacts from the attempted hull pose.
 * Priority is: swept vertex crossings, attempted-pose hull-edge crossings,
 * then true penetrating hull vertices.
 * @param {import("./mothership.js").Mothership} mothership
 * @param {Array<[number,number]>|undefined} prevPoints
 * @param {Array<[number,number]>|undefined} currPoints
 * @returns {{mode:"sweep_vertex"|"pose_edge"|"inside_vertex",count:number,avgX:number,avgY:number,avgNx:number,avgNy:number,hits:Array<{kind:string,edgeIdx:number,hullIdx:number,x:number,y:number,nx:number,ny:number,av?:number|null}>}|null}
 */
function collectMothershipCollisionEvidence(mothership, prevPoints, currPoints){
  const edges = getMothershipBoundaryEdges(mothership);
  if (!edges.length) return null;
  const currHull = hullLoopFromCollisionPoints(currPoints);
  if (currHull.length < 2) return null;
  const prevHull = hullLoopFromCollisionPoints(prevPoints);
  const boundarySkin = Math.max(0.002, (mothership.spacing || 0.4) * 0.01);
  const nearTol = Math.max(1e-3, (mothership.spacing || 0.4) * 0.08);
  const nearTol2 = nearTol * nearTol;

  /**
   * @param {Array<{kind:string,edgeIdx:number,hullIdx:number,x:number,y:number,nx:number,ny:number,av?:number|null}>} hits
   * @param {"sweep_vertex"|"pose_edge"|"inside_vertex"} mode
   * @returns {{mode:"sweep_vertex"|"pose_edge"|"inside_vertex",count:number,avgX:number,avgY:number,avgNx:number,avgNy:number,hits:Array<{kind:string,edgeIdx:number,hullIdx:number,x:number,y:number,nx:number,ny:number,av?:number|null}>}|null}
   */
  const finalize = (hits, mode) => {
    if (!hits.length) return null;
    let sx = 0;
    let sy = 0;
    let snx = 0;
    let sny = 0;
    for (const hit of hits){
      sx += hit.x;
      sy += hit.y;
      snx += hit.nx;
      sny += hit.ny;
    }
    let nLen = Math.hypot(snx, sny);
    if (nLen < 1e-8){
      const first = expectDefined(hits[0]);
      snx = first.nx;
      sny = first.ny;
      nLen = Math.hypot(snx, sny) || 1;
    }
    return {
      mode,
      count: hits.length,
      avgX: sx / hits.length,
      avgY: sy / hits.length,
      avgNx: snx / nLen,
      avgNy: sny / nLen,
      hits,
    };
  };

  /** @type {Array<{kind:string,edgeIdx:number,hullIdx:number,x:number,y:number,nx:number,ny:number,av?:number|null}>} */
  const sweepHits = [];
  if (prevHull.length === currHull.length && prevHull.length >= 2){
    for (let i = 0; i < currHull.length; i++){
      const prev = prevHull[i];
      const curr = currHull[i];
      if (!prev || !curr) continue;
      const p0 = worldToMothershipLocal(mothership, prev[0], prev[1]);
      const p1 = worldToMothershipLocal(mothership, curr[0], curr[1]);
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      if (dx * dx + dy * dy < 1e-12) continue;
      for (let edgeIdx = 0; edgeIdx < edges.length; edgeIdx++){
        const edge = edges[edgeIdx];
        if (!edge) continue;
        const hit = segmentIntersectionParams(
          p0.x, p0.y, dx, dy,
          edge.ax, edge.ay, edge.bx - edge.ax, edge.by - edge.ay
        );
        if (!hit) continue;
        if (dx * edge.nx + dy * edge.ny >= -1e-6) continue;
        const hx = p0.x + dx * hit.t;
        const hy = p0.y + dy * hit.t;
        const wp = mothershipLocalToWorld(mothership, hx, hy);
        const wn = mothershipLocalDirToWorld(mothership, edge.nx, edge.ny);
        sweepHits.push({
          kind: "sweep_vertex",
          edgeIdx,
          hullIdx: i,
          x: wp.x,
          y: wp.y,
          nx: wn.x,
          ny: wn.y,
          av: null,
        });
      }
    }
  }
  const sweepEvidence = finalize(sweepHits, "sweep_vertex");
  if (sweepEvidence) return sweepEvidence;

  /** @type {Array<{kind:string,edgeIdx:number,hullIdx:number,x:number,y:number,nx:number,ny:number,av?:number|null}>} */
  const edgeHits = [];
  for (let i = 0; i < currHull.length; i++){
    const p0 = currHull[i];
    const p1 = currHull[(i + 1) % currHull.length];
    if (!p0 || !p1) continue;
    const a = worldToMothershipLocal(mothership, p0[0], p0[1]);
    const b = worldToMothershipLocal(mothership, p1[0], p1[1]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    if (dx * dx + dy * dy < 1e-12) continue;
    for (let edgeIdx = 0; edgeIdx < edges.length; edgeIdx++){
      const edge = edges[edgeIdx];
      if (!edge) continue;
      const hit = segmentIntersectionParams(
        a.x, a.y, dx, dy,
        edge.ax, edge.ay, edge.bx - edge.ax, edge.by - edge.ay
      );
      if (!hit) continue;
      const hx = a.x + dx * hit.t;
      const hy = a.y + dy * hit.t;
      const wp = mothershipLocalToWorld(mothership, hx, hy);
      const wn = mothershipLocalDirToWorld(mothership, edge.nx, edge.ny);
      edgeHits.push({
        kind: "pose_edge",
        edgeIdx,
        hullIdx: i,
        x: wp.x,
        y: wp.y,
        nx: wn.x,
        ny: wn.y,
        av: null,
      });
    }
  }
  const edgeEvidence = finalize(edgeHits, "pose_edge");
  if (edgeEvidence) return edgeEvidence;

  /** @type {Array<{kind:string,edgeIdx:number,hullIdx:number,x:number,y:number,nx:number,ny:number,av?:number|null}>} */
  const insideHits = [];
  for (let i = 0; i < currHull.length; i++){
    const p = currHull[i];
    if (!p) continue;
    const lp = worldToMothershipLocal(mothership, p[0], p[1]);
    const av = mothershipAirAtLocalExact(mothership, lp.x, lp.y);
    if (av === null || av > 0.5) continue;
    let minD2 = Infinity;
    /** @type {Array<{edgeIdx:number,edge:{ax:number,ay:number,bx:number,by:number,nx:number,ny:number},cp:{x:number,y:number,u:number,d2:number}}>} */
    let nearest = [];
    for (let edgeIdx = 0; edgeIdx < edges.length; edgeIdx++){
      const edge = edges[edgeIdx];
      if (!edge) continue;
      const cp = closestPointOnSegment(edge.ax, edge.ay, edge.bx, edge.by, lp.x, lp.y);
      if (cp.d2 < minD2 - nearTol2){
        minD2 = cp.d2;
        nearest = [{ edgeIdx, edge, cp }];
      } else if (cp.d2 <= minD2 + nearTol2){
        nearest.push({ edgeIdx, edge, cp });
      }
    }
    if (!nearest.length) continue;
    if (Math.sqrt(minD2) <= boundarySkin) continue;
    for (const item of nearest){
      const wp = mothershipLocalToWorld(mothership, item.cp.x, item.cp.y);
      const wn = mothershipLocalDirToWorld(mothership, item.edge.nx, item.edge.ny);
      insideHits.push({
        kind: "inside_vertex",
        edgeIdx: item.edgeIdx,
        hullIdx: i,
        x: wp.x,
        y: wp.y,
        nx: wn.x,
        ny: wn.y,
        av,
      });
    }
  }
  return finalize(insideHits, "inside_vertex");
}

/**
 * Back off ship along negative relative-velocity direction until strict
 * mothership overlap clears.
 * @param {import("./mothership.js").Mothership} mothership
 * @param {import("./types.d.js").Ship} ship
 * @param {(x:number,y:number)=>boolean} hasOverlapAt
 * @param {(x:number,y:number)=>{vx:number,vy:number}} baseVelocityAt
 * @param {number} shipRadius
 * @returns {{dist:number,cleared:boolean,hadOverlap:boolean,dirX:number,dirY:number}}
 */
function backoffShipAlongNegativeRelativeVelocity(
  mothership,
  ship,
  hasOverlapAt,
  baseVelocityAt,
  shipRadius
){
  if (!hasOverlapAt(ship.x, ship.y)){
    return { dist: 0, cleared: true, hadOverlap: false, dirX: 0, dirY: 0 };
  }
  const base = baseVelocityAt(ship.x, ship.y);
  const rvx = ship.vx - base.vx;
  const rvy = ship.vy - base.vy;
  const rLen = Math.hypot(rvx, rvy);
  if (rLen < 1e-6){
    return { dist: 0, cleared: false, hadOverlap: true, dirX: 0, dirY: 0 };
  }
  const dirX = -rvx / rLen;
  const dirY = -rvy / rLen;
  const startX = ship.x;
  const startY = ship.y;
  let lo = 0;
  let hi = Math.max(0.01, shipRadius * 0.08);
  const maxBack = Math.max(0.5, shipRadius * 1.5);
  while (hi < maxBack && hasOverlapAt(startX + dirX * hi, startY + dirY * hi)){
    lo = hi;
    hi *= 2;
  }
  hi = Math.min(hi, maxBack);
  const cleared = !hasOverlapAt(startX + dirX * hi, startY + dirY * hi);
  if (cleared){
    for (let i = 0; i < 14; i++){
      const mid = (lo + hi) * 0.5;
      if (hasOverlapAt(startX + dirX * mid, startY + dirY * mid)){
        lo = mid;
      } else {
        hi = mid;
      }
    }
  }
  ship.x = startX + dirX * hi;
  ship.y = startY + dirY * hi;
  return { dist: hi, cleared, hadOverlap: true, dirX, dirY };
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} nx
 * @param {number} ny
 * @param {(x:number,y:number)=>boolean} collidesAt
 * @param {number} maxPush
 * @param {number} startPush
 * @returns {{x:number,y:number,push:number,cleared:boolean}}
 */
function depenetrateAlongNormal(x, y, nx, ny, collidesAt, maxPush, startPush){
  let lo = 0;
  let hi = Math.max(1e-3, startPush);
  while (hi < maxPush && collidesAt(x + nx * hi, y + ny * hi)){
    lo = hi;
    hi *= 2;
  }
  hi = Math.min(hi, maxPush);
  if (collidesAt(x + nx * hi, y + ny * hi)){
    return { x: x + nx * hi, y: y + ny * hi, push: hi, cleared: false };
  }
  for (let i = 0; i < 14; i++){
    const mid = (lo + hi) * 0.5;
    if (collidesAt(x + nx * mid, y + ny * mid)){
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { x: x + nx * hi, y: y + ny * hi, push: hi, cleared: true };
}

/**
 * @param {Array<[number, number]>} poly
 * @param {number} nx
 * @param {number} ny
 * @returns {{min:number,max:number}}
 */
function projectPolyAxis(poly, nx, ny){
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly){
    const d = p[0] * nx + p[1] * ny;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return { min, max };
}

/**
 * @param {Array<[number, number]>} a
 * @param {Array<[number, number]>} b
 * @returns {boolean}
 */
function convexPolysOverlap(a, b){
  /**
   * @param {Array<[number, number]>} poly0
   * @param {Array<[number, number]>} poly1
   * @returns {boolean}
   */
  const testAxes = (poly0, poly1) => {
    for (let i = 0; i < poly0.length; i++){
      const p0 = poly0[i];
      const p1 = poly0[(i + 1) % poly0.length];
      if (!p0 || !p1) continue;
      const ex = p1[0] - p0[0];
      const ey = p1[1] - p0[1];
      const el = Math.hypot(ex, ey);
      if (el < 1e-8) continue;
      const nx = -ey / el;
      const ny = ex / el;
      const pa = projectPolyAxis(poly0, nx, ny);
      const pb = projectPolyAxis(poly1, nx, ny);
      if (pa.max < pb.min || pb.max < pa.min){
        return false;
      }
    }
    return true;
  };
  return testAxes(a, b) && testAxes(b, a);
}

/**
 * @param {Array<{x:number,y:number,air:number}>} tri
 * @returns {Array<[number, number]>}
 */
function rockPolygonFromTri(tri){
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let i = 0; i < 3; i++){
    const a = tri[i];
    const b = tri[(i + 1) % 3];
    if (!a || !b) continue;
    const aRock = a.air <= 0.5;
    const bRock = b.air <= 0.5;
    if (aRock){
      out.push([a.x, a.y]);
    }
    if (aRock !== bRock){
      const denom = (b.air - a.air) || 1e-6;
      const t = (0.5 - a.air) / denom;
      out.push([
        a.x + (b.x - a.x) * t,
        a.y + (b.y - a.y) * t,
      ]);
    }
  }
  return out;
}

/**
 * @param {(x:number,y:number)=>Array<[number, number]>} shipConvexHullWorldVertices
 * @param {number} x
 * @param {number} y
 * @param {(x:number,y:number)=>number} airAt
 * @param {number} [eps]
 * @returns {Array<{x:number,y:number,nx:number,ny:number,av:number}>}
 */
function extractHullBoundaryContacts(shipConvexHullWorldVertices, x, y, airAt, eps = 0.03){
  const hull = shipConvexHullWorldVertices(x, y);
  if (hull.length < 2) return [];
  const e = Math.max(1e-3, eps);
  /** @type {Array<{x:number,y:number,nx:number,ny:number,av:number}>} */
  const out = [];
  /**
   * @param {number} cx
   * @param {number} cy
   * @returns {void}
   */
  const addContact = (cx, cy) => {
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    const av = airAt(cx, cy);
    let nx = airAt(cx + e, cy) - airAt(cx - e, cy);
    let ny = airAt(cx, cy + e) - airAt(cx, cy - e);
    let nLen = Math.hypot(nx, ny);
    if (nLen < 1e-6){
      nx = cx - x;
      ny = cy - y;
      nLen = Math.hypot(nx, ny);
    }
    if (nLen < 1e-6) return;
    nx /= nLen;
    ny /= nLen;
    const af = airAt(cx + nx * e * 1.6, cy + ny * e * 1.6);
    const ab = airAt(cx - nx * e * 1.2, cy - ny * e * 1.2);
    if (ab > af){
      nx = -nx;
      ny = -ny;
    }
    for (const c of out){
      if (Math.hypot(c.x - cx, c.y - cy) <= 0.015){
        c.nx += nx;
        c.ny += ny;
        const nn = Math.hypot(c.nx, c.ny) || 1;
        c.nx /= nn;
        c.ny /= nn;
        c.av = Math.min(c.av, av);
        return;
      }
    }
    out.push({ x: cx, y: cy, nx, ny, av });
  };

  const n = hull.length;
  for (let i = 0; i < n; i++){
    const a = hull[i];
    const b = hull[(i + 1) % n];
    if (!a || !b) continue;
    const av0 = airAt(a[0], a[1]);
    const av1 = airAt(b[0], b[1]);
    const in0 = av0 <= 0.5;
    const in1 = av1 <= 0.5;
    if (in0) addContact(a[0], a[1]);
    if (in1) addContact(b[0], b[1]);
    if (in0 === in1) continue;
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 14; k++){
      const mid = (lo + hi) * 0.5;
      const mx = a[0] + (b[0] - a[0]) * mid;
      const my = a[1] + (b[1] - a[1]) * mid;
      const avm = airAt(mx, my);
      const inm = avm <= 0.5;
      if (inm === in0){
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const t = (lo + hi) * 0.5;
    const cx = a[0] + (b[0] - a[0]) * t;
    const cy = a[1] + (b[1] - a[1]) * t;
    addContact(cx, cy);
  }
  return out;
}

/**
 * @param {{planet:import("./planet.js").Planet,collision:import("./types.d.js").CollisionQuery,collisionEps:number,shipConvexHullWorldVertices:(x:number,y:number)=>Array<[number,number]>}} ctx
 * @param {number} x
 * @param {number} y
 * @returns {import("./types.d.js").CollisionHit|null}
 */
export function findPlanetCollisionExactAt(ctx, x, y){
  const radial = ctx.planet && ctx.planet.radial;
  if (!radial || !Array.isArray(radial.bandTris)) return null;
  const hull = ctx.shipConvexHullWorldVertices(x, y);
  if (hull.length < 3) return null;
  let hxMin = Infinity;
  let hyMin = Infinity;
  let hxMax = -Infinity;
  let hyMax = -Infinity;
  let rMin = Infinity;
  let rMax = 0;
  for (const p of hull){
    hxMin = Math.min(hxMin, p[0]);
    hyMin = Math.min(hyMin, p[1]);
    hxMax = Math.max(hxMax, p[0]);
    hyMax = Math.max(hyMax, p[1]);
    const r = Math.hypot(p[0], p[1]);
    rMin = Math.min(rMin, r);
    rMax = Math.max(rMax, r);
  }
  const b0 = Math.max(0, Math.floor(rMin) - 2);
  const b1 = Math.min(radial.bandTris.length - 1, Math.ceil(rMax) + 2);
  let bestD2 = Infinity;
  /** @type {import("./types.d.js").CollisionHit|null} */
  let bestHit = null;
  for (let bi = b0; bi <= b1; bi++){
    const tris = radial.bandTris[bi];
    if (!tris) continue;
    for (const tri of tris){
      const a = tri[0], b = tri[1], c = tri[2];
      if (!a || !b || !c) continue;
      const txMin = Math.min(a.x, b.x, c.x);
      const tyMin = Math.min(a.y, b.y, c.y);
      const txMax = Math.max(a.x, b.x, c.x);
      const tyMax = Math.max(a.y, b.y, c.y);
      if (txMax < hxMin || txMin > hxMax || tyMax < hyMin || tyMin > hyMax) continue;
      const rock = rockPolygonFromTri(tri);
      if (rock.length < 3) continue;
      if (!convexPolysOverlap(hull, rock)) continue;
      for (let i = 0; i < rock.length; i++){
        const p0 = rock[i];
        const p1 = rock[(i + 1) % rock.length];
        if (!p0 || !p1) continue;
        const cpt = closestPointOnSegment(p0[0], p0[1], p1[0], p1[1], x, y);
        if (cpt.d2 < bestD2){
          bestD2 = cpt.d2;
          bestHit = { x: cpt.x, y: cpt.y, tri };
        }
      }
    }
  }
  if (!bestHit) return null;
  const contacts = extractHullBoundaryContacts(
    ctx.shipConvexHullWorldVertices,
    x,
    y,
    (sx, sy) => ctx.collision.planetAirValueAtWorld(sx, sy),
    Math.max(0.01, ctx.collisionEps * 0.2)
  );
  if (contacts.length){
    bestHit.contacts = contacts;
  }
  return bestHit;
}

/**
 * @param {Object} args
 * @param {import("./types.d.js").Ship} args.ship
 * @param {import("./types.d.js").CollisionQuery} args.collision
 * @param {import("./planet.js").Planet} args.planet
 * @param {import("./mothership.js").Mothership|null} args.mothership
 * @param {{CRASH_SPEED:number,LAND_SPEED:number,LAND_FRICTION:number,WALL_FRICTION?:number,BOUNCE_RESTITUTION?:number}} args.planetParams
 * @param {{SURFACE_DOT:number,BOUNCE_RESTITUTION:number,MOTHERSHIP_FRICTION:number,MOTHERSHIP_RESTITUTION:number,LAND_SPEED:number}} args.game
 * @param {number} args.dt
 * @param {number} args.eps
 * @param {boolean} [args.debugEnabled]
 * @param {number} args.shipRadius
 * @param {(x:number,y:number)=>boolean} args.shipCollidesAt
 * @param {(x:number,y:number)=>boolean} [args.shipCollidesMothershipAt]
 * @param {(x:number,y:number)=>Array<[number,number]>} [args.shipCollisionPointsAt]
 * @param {number} [args.shipStartX]
 * @param {number} [args.shipStartY]
 * @param {number} [args.shipEndX]
 * @param {number} [args.shipEndY]
 * @param {number} [args.mothershipAngularVel]
 * @param {Array<[number,number]>} [args.prevPoints]
 * @param {Array<[number,number]>} [args.currPoints]
 * @param {()=>void} args.onCrash
 * @param {()=>boolean} args.isDockedWithMothership
 * @param {()=>void} args.onSuccessfullyDocked
 * @returns {void}
 */
export function resolvePlanetCollisionResponse(args){
  const {
    ship,
    collision,
    planet,
    mothership,
    planetParams,
    game,
    dt,
    eps,
    debugEnabled = false,
    shipRadius,
    shipCollidesAt,
    shipCollidesMothershipAt,
    shipCollisionPointsAt,
    shipStartX,
    shipStartY,
    shipEndX,
    shipEndY,
    mothershipAngularVel,
    prevPoints,
    currPoints,
    onCrash,
    isDockedWithMothership,
    onSuccessfullyDocked,
  } = args;
  const hit = ship._collision;
  if (!hit) return;
  if (hit.source === "mothership") return;
  if (!debugEnabled){
    ship._landingDebug = null;
    ship._lastMothershipCollisionDiag = null;
  }
  const hx = Number.isFinite(hit.x) ? hit.x : ship.x;
  const hy = Number.isFinite(hit.y) ? hit.y : ship.y;

  /**
   * @param {(x:number,y:number)=>number} sample
   * @returns {{nx:number,ny:number}}
   */
  const contactNormal = (sample, cx = hx, cy = hy) => {
    let nx = sample(cx + eps, cy) - sample(cx - eps, cy);
    let ny = sample(cx, cy + eps) - sample(cx, cy - eps);
    let nlen = Math.hypot(nx, ny);
    if (nlen < 1e-4){
      nx = ship.x - cx;
      ny = ship.y - cy;
      nlen = Math.hypot(nx, ny);
    }
    if (nlen < 1e-4){
      nx = ship.x;
      ny = ship.y;
      nlen = Math.hypot(nx, ny) || 1;
    }
    nx /= nlen;
    ny /= nlen;
    return { nx, ny };
  };

  /**
   * @param {Array<{x:number,y:number,nx:number,ny:number,av?:number}>|null|undefined} contacts
   * @returns {{x:number,y:number,nx:number,ny:number,count:number}|null}
   */
  const averageImpactContacts = (contacts) => {
    if (!Array.isArray(contacts) || !contacts.length) return null;
    let sx = 0;
    let sy = 0;
    let snx = 0;
    let sny = 0;
    let sw = 0;
    let count = 0;
    for (const c of contacts){
      if (!c) continue;
      if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
      if (!Number.isFinite(c.nx) || !Number.isFinite(c.ny)) continue;
      const nLen = Math.hypot(c.nx, c.ny);
      if (nLen < 1e-8) continue;
      const nx = c.nx / nLen;
      const ny = c.ny / nLen;
      const av = Number.isFinite(c.av) ? Number(c.av) : 0.5;
      const w = Math.max(0.05, 0.55 - Math.min(1, Math.max(0, av)));
      sx += c.x * w;
      sy += c.y * w;
      snx += nx * w;
      sny += ny * w;
      sw += w;
      count++;
    }
    if (count <= 0 || sw <= 1e-8) return null;
    let nx = snx / sw;
    let ny = sny / sw;
    const nLen = Math.hypot(nx, ny);
    if (nLen < 1e-8) return null;
    nx /= nLen;
    ny /= nLen;
    return {
      x: sx / sw,
      y: sy / sw,
      nx,
      ny,
      count,
    };
  };

  /**
   * @param {number} vx
   * @param {number} vy
   * @returns {{vx:number,vy:number,speed:number,dirDeg:number}}
   */
  const vecDiag = (vx, vy) => ({
    vx,
    vy,
    speed: Math.hypot(vx, vy),
    dirDeg: Math.atan2(vy, vx) * 180 / Math.PI,
  });

  /**
   * @param {any} landingDbg
   * @param {any} payload
   */
  const setMothershipDiag = (landingDbg, payload) => {
    if (!debugEnabled || !landingDbg) return;
    const prev = ship._lastMothershipCollisionDiag || null;
    const outAbs = payload && payload.absOut ? payload.absOut : null;
    const outRel = payload && payload.relOut ? payload.relOut : null;
    landingDbg.collisionDiag = {
      ...payload,
      prev,
    };
    ship._lastMothershipCollisionDiag = {
      abs: outAbs,
      rel: outRel,
    };
  };

  {
    const shipR = Math.hypot(ship.x, ship.y) || 1;
    const shipUpX = ship.x / shipR;
    const shipUpY = ship.y / shipR;

    /**
     * @param {Array<{x:number,y:number,air:number}>|null|undefined} tri
     * @returns {boolean}
     */
    const triStraddlesBoundary = (tri) => {
      if (!tri || tri.length < 3) return false;
      let minA = Infinity;
      let maxA = -Infinity;
      for (const v of tri){
        minA = Math.min(minA, v.air);
        maxA = Math.max(maxA, v.air);
      }
      return minA <= 0.5 && maxA > 0.5;
    };

    /**
     * @param {Array<{x:number,y:number,air:number}>} tri
     * @param {number} x
     * @param {number} y
     * @returns {number}
     */
    const airInTri = (tri, x, y) => {
      const a = tri[0];
      const b = tri[1];
      const c = tri[2];
      if (!a || !b || !c) return 1;
      const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
      if (Math.abs(det) < 1e-8){
        return (a.air + b.air + c.air) / 3;
      }
      const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
      const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
      const l3 = 1 - l1 - l2;
      return a.air * l1 + b.air * l2 + c.air * l3;
    };

    /**
     * Choose boundary-relevant triangle at contact.
     * Uniform rule across all rings: choose the best boundary-straddling tri.
     * @param {number} x
     * @param {number} y
     * @param {number} fallbackNx
     * @param {number} fallbackNy
     * @returns {Array<{x:number,y:number,air:number}>|null}
     */
    const pickTriAtContact = (x, y, fallbackNx, fallbackNy) => {
      const radial = planet && planet.radial;
      if (!radial || !radial.bandTris || typeof radial._pointInTri !== "function"){
        return (radial && typeof radial.findTriAtWorld === "function") ? radial.findTriAtWorld(x, y) : null;
      }
      const r = Math.hypot(x, y);
      const rMaxBand = Math.max(0, (radial.bandTris.length || 1) - 1);
      const r0 = Math.max(0, Math.min(rMaxBand, Math.floor(r)));
      const bands = [r0, r0 - 1, r0 + 1, r0 - 2, r0 + 2];
      /** @type {Array<{x:number,y:number,air:number}>|null} */
      let bestTri = null;
      let bestScore = -Infinity;
      for (const bi of bands){
        if (bi < 0 || bi > rMaxBand) continue;
        const tris = radial.bandTris[bi];
        if (!tris || !tris.length) continue;
        for (const tri of tris){
          if (!tri || tri.length < 3) continue;
          const a = tri[0], b = tri[1], c = tri[2];
          if (!a || !b || !c) continue;
          if (!radial._pointInTri(x, y, a.x, a.y, b.x, b.y, c.x, c.y)) continue;
          let minA = Infinity;
          let maxA = -Infinity;
          for (const v of tri){
            minA = Math.min(minA, v.air);
            maxA = Math.max(maxA, v.air);
          }
          const boundaryTri = (minA <= 0.5 && maxA > 0.5);
          if (!boundaryTri) continue;
          const n = triAirNormalFromTri(/** @type {Array<{x:number,y:number,air:number}>} */ (tri), fallbackNx, fallbackNy);
          const probe = 0.06;
          const front = collision.planetAirValueAtWorld(x + n.nx * probe, y + n.ny * probe);
          const back = collision.planetAirValueAtWorld(x - n.nx * probe, y - n.ny * probe);
          const av = airInTri(/** @type {Array<{x:number,y:number,air:number}>} */ (tri), x, y);
          let score = 0;
          score += 2.0;
          score -= Math.abs(av - 0.5) * 1.2;
          score += Math.max(-1, Math.min(1, n.nx * fallbackNx + n.ny * fallbackNy)) * 0.5;
          score += Math.max(-0.7, Math.min(0.7, front - back)) * 1.4;
          if (score > bestScore){
            bestScore = score;
            bestTri = /** @type {Array<{x:number,y:number,air:number}>} */ (tri);
          }
        }
      }
      if (bestTri) return bestTri;
      return (typeof radial.findTriAtWorld === "function") ? radial.findTriAtWorld(x, y) : null;
    };

    /**
     * Resolve exact contact normal at a point from its barycentric triangle.
     * Falls back to field gradient at that point if no triangle is found.
     * @param {number} x
     * @param {number} y
     * @returns {{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null}}
     */
    const normalAtContact = (x, y) => {
      const fallback = contactNormal((sx, sy) => collision.planetAirValueAtWorld(sx, sy), x, y);
      let cx = x;
      let cy = y;
      let tri = pickTriAtContact(cx, cy, fallback.nx, fallback.ny);
      if (!tri){
        // Contact can lie exactly on/just outside band coverage near the rim.
        // Probe locally to recover a boundary tri before falling back to field gradient.
        const rr = Math.hypot(cx, cy) || 1;
        const rux = cx / rr;
        const ruy = cy / rr;
        /** @type {Array<[number, number]>} */
        const probeDirs = [
          [-fallback.nx, -fallback.ny], // toward likely rock side
          [fallback.nx, fallback.ny], // toward likely air side
          [-rux, -ruy], // inward radial
          [rux, ruy], // outward radial
        ];
        const probeSteps = [0.03, 0.06, 0.10, 0.16, 0.24];
        for (const d of probeSteps){
          let found = null;
          for (const dir of probeDirs){
            const probeDir = dir;
            if (!probeDir) continue;
            const qx = cx + probeDir[0] * d;
            const qy = cy + probeDir[1] * d;
            const t = pickTriAtContact(qx, qy, fallback.nx, fallback.ny);
            if (t){
              found = t;
              cx = qx;
              cy = qy;
              break;
            }
          }
          if (found){
            tri = found;
            break;
          }
        }
      }
      const rr = Math.hypot(cx, cy) || 1;
      const rux = cx / rr;
      const ruy = cy / rr;
      const radial = planet && planet.radial;
      const rOuter = (radial && radial.rings && radial.rings.length)
        ? (radial.rings.length - 1)
        : ((typeof planet.planetRadius === "number") ? planet.planetRadius : rr);
      const shellDist = Math.abs(rr - rOuter);
      const probe = 0.08;
      const shellAirOut = collision.planetAirValueAtWorld(cx + rux * probe, cy + ruy * probe);
      const shellAirIn = collision.planetAirValueAtWorld(cx - rux * probe, cy - ruy * probe);
      const isOuterShellBoundary = (shellDist <= 0.35) && (shellAirOut > 0.5) && (shellAirIn <= 0.5);
      let n = triAirNormalFromTri(/** @type {Array<{x:number,y:number,air:number}>|null} */(tri), fallback.nx, fallback.ny);
      // On the top strip, the rendered/collision boundary can be the outer clamp
      // (air outside the mesh) and not a straddling barycentric tri. In that case,
      // use the exact shell boundary normal instead of an all-rock tri gradient.
      if (isOuterShellBoundary && !triStraddlesBoundary(tri)){
        n = { nx: rux, ny: ruy };
        if (n.nx * fallback.nx + n.ny * fallback.ny < 0){
          n.nx = -n.nx;
          n.ny = -n.ny;
        }
      }
      return { x: cx, y: cy, nx: n.nx, ny: n.ny, tri: /** @type {Array<{x:number,y:number,air:number}>|null} */(tri) };
    };

    /**
     * Collect collider-point air->rock crossings from previous frame to current frame.
     * Uses all ship sample points as independent swept probes.
     * @returns {Array<{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number}>}
     */
    const sweepContacts = () => {
      if (!prevPoints || !currPoints || !prevPoints.length || !currPoints.length){
        return [];
      }
      const nPts = Math.min(prevPoints.length, currPoints.length);
      /** @type {Array<{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number}>} */
      const out = [];
      for (let i = 0; i < nPts; i++){
        const p0 = prevPoints[i];
        const p1 = currPoints[i];
        if (!p0 || !p1) continue;
        const a0 = collision.planetAirValueAtWorld(p0[0], p0[1]);
        const a1 = collision.planetAirValueAtWorld(p1[0], p1[1]);
        if (!(a0 > 0.5 && a1 <= 0.5)) continue;
        let lo = 0;
        let hi = 1;
        for (let b = 0; b < 20; b++){
          const tMid = (lo + hi) * 0.5;
          const mx = p0[0] + (p1[0] - p0[0]) * tMid;
          const my = p0[1] + (p1[1] - p0[1]) * tMid;
          const aMid = collision.planetAirValueAtWorld(mx, my);
          if (aMid > 0.5){
            lo = tMid;
          } else {
            hi = tMid;
          }
        }
        const tHit = hi;
        const cx = p0[0] + (p1[0] - p0[0]) * tHit;
        const cy = p0[1] + (p1[1] - p0[1]) * tHit;
        const n = normalAtContact(cx, cy);
        const svx = p1[0] - p0[0];
        const svy = p1[1] - p0[1];
        const entryVn = svx * n.nx + svy * n.ny;
        out.push({
          x: n.x,
          y: n.y,
          nx: n.nx,
          ny: n.ny,
          tri: n.tri,
          t: tHit,
          pointIndex: i,
          entryVn,
        });
      }

      return out;
    };

    /**
     * Collect contacts from currently colliding hull sample points.
     * This complements swept entry contacts for stable support selection.
     * @returns {Array<{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number}>}
     */
    const poseContacts = () => {
      /** @type {Array<{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number}>} */
      const out = [];
      if (!currPoints || !currPoints.length){
        return out;
      }
      for (let i = 0; i < currPoints.length; i++){
        const p = currPoints[i];
        if (!p) continue;
        if (collision.planetAirValueAtWorld(p[0], p[1]) > 0.5) continue;
        const n = normalAtContact(p[0], p[1]);
        out.push({
          x: n.x,
          y: n.y,
          nx: n.nx,
          ny: n.ny,
          tri: n.tri,
          t: 1,
          pointIndex: i,
          entryVn: ship.vx * n.nx + ship.vy * n.ny,
        });
      }
      return out;
    };

    /**
     * @param {Array<{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number}>} contacts
     * @returns {{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number}|null}
     */
    const pickImpactContact = (contacts) => {
      if (!contacts.length) return null;
      let best = contacts[0];
      if (!best) return null;
      for (let i = 1; i < contacts.length; i++){
        const c = contacts[i];
        if (!c) continue;
        if (c.t < best.t - 1e-6){
          best = c;
          continue;
        }
        if (Math.abs(c.t - best.t) <= 1e-6 && c.entryVn < best.entryVn){
          best = c;
        }
      }
      return best;
    };

    const probeX = ship.x - shipUpX * shipRadius;
    const probeY = ship.y - shipUpY * shipRadius;
    const contacts = sweepContacts();
    const contactsPose = poseContacts();
    const avgHitContact = averageImpactContacts(
      /** @type {Array<{x:number,y:number,nx:number,ny:number,av?:number}>|null|undefined} */ (hit.contacts)
    );
    const hitImpactContact = avgHitContact ? {
      x: avgHitContact.x,
      y: avgHitContact.y,
      nx: avgHitContact.nx,
      ny: avgHitContact.ny,
      tri: /** @type {Array<{x:number,y:number,air:number}>|null} */ (hit.tri || null),
      t: 0,
      pointIndex: -10,
      entryVn: ship.vx * avgHitContact.nx + ship.vy * avgHitContact.ny,
    } : null;
    const contactImpact = hitImpactContact || pickImpactContact(contacts);
    let impactX = hx;
    let impactY = hy;
    let impactTri = null;
    let impactNormal = contactNormal((x, y) => collision.planetAirValueAtWorld(x, y), impactX, impactY);
    if (contactImpact){
      impactX = contactImpact.x;
      impactY = contactImpact.y;
      impactNormal = { nx: contactImpact.nx, ny: contactImpact.ny };
      impactTri = contactImpact.tri;
    } else {
      const nHit = normalAtContact(impactX, impactY);
      impactX = nHit.x;
      impactY = nHit.y;
      impactNormal = { nx: nHit.nx, ny: nHit.ny };
      impactTri = nHit.tri;
    }

    const supportX = impactX;
    const supportY = impactY;
    const supportTri = impactTri;

    /**
     * @param {Array<{x:number,y:number,air:number}>|null} tri
     * @returns {{outerCount:number,airMin:number,airMax:number,rMin:number,rMax:number}|null}
     */
    const triMeta = (tri) => {
      if (!tri || tri.length < 3) return null;
      let outerCount = 0;
      let airMin = Infinity;
      let airMax = -Infinity;
      let rMin = Infinity;
      let rMax = -Infinity;
      const rOuter = (typeof planet.planetRadius === "number")
        ? planet.planetRadius
        : (planet.radial && planet.radial.rings ? (planet.radial.rings.length - 1) : Infinity);
      for (const v of tri){
        const rv = Math.hypot(v.x, v.y);
        rMin = Math.min(rMin, rv);
        rMax = Math.max(rMax, rv);
        airMin = Math.min(airMin, v.air);
        airMax = Math.max(airMax, v.air);
        if (rv >= rOuter - 0.22) outerCount++;
      }
      return { outerCount, airMin, airMax, rMin, rMax };
    };
    let bestDotUpAny = -Infinity;
    let bestDotUpUnder = -Infinity;
    for (const c of contactsPose.length ? contactsPose : contacts){
      const dot = c.nx * shipUpX + c.ny * shipUpY;
      if (dot > bestDotUpAny) bestDotUpAny = dot;
      const rcx = c.x - ship.x;
      const rcy = c.y - ship.y;
      const rLen = Math.hypot(rcx, rcy);
      const downness = rLen > 1e-6 ? (-(rcx * shipUpX + rcy * shipUpY) / rLen) : -1;
      if (downness >= 0.1 && dot > bestDotUpUnder) bestDotUpUnder = dot;
    }
    const supportMeta = triMeta(/** @type {Array<{x:number,y:number,air:number}>|null} */(supportTri));

    if (hit){
      ship._collision = {
        x: supportX,
        y: supportY,
        source: "planet",
        tri: supportTri,
        node: (planet.radial && typeof planet.radial.nearestNodeOnRing === "function")
          ? planet.radial.nearestNodeOnRing(supportX, supportY)
          : null,
      };
    }

    const vnImpact = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
    if (vnImpact < -planetParams.CRASH_SPEED) {
      if (debugEnabled){
        ship._landingDebug = {
          source: "planet",
          reason: "planet_crash",
          vn: vnImpact,
          vt: ship.vx * (-impactNormal.ny) + ship.vy * impactNormal.nx,
          speed: Math.hypot(ship.vx, ship.vy),
          impactX,
          impactY,
          supportX,
          supportY,
        };
      }
      onCrash();
      return;
    }

    const speedAbs = Math.hypot(ship.vx, ship.vy);
    const maxSlope = 1 - Math.cos(Math.PI / 8); // 22.5 deg
    const landSlope = Math.min((1 - game.SURFACE_DOT) + 0.03, maxSlope);
    const impactDotUp = impactNormal.nx * shipUpX + impactNormal.ny * shipUpY;
    const impactAirFront = collision.planetAirValueAtWorld(
      impactX + impactNormal.nx * Math.max(0.12, shipRadius * 0.45),
      impactY + impactNormal.ny * Math.max(0.12, shipRadius * 0.45)
    );
    const impactAirBack = collision.planetAirValueAtWorld(
      impactX - impactNormal.nx * Math.max(0.10, shipRadius * 0.38),
      impactY - impactNormal.ny * Math.max(0.10, shipRadius * 0.38)
    );
    const landingInfo = {
      dotUp: impactDotUp,
      slope: Math.max(0, 1 - impactDotUp),
      vn: vnImpact,
      vt: ship.vx * (-impactNormal.ny) + ship.vy * impactNormal.nx,
      airFront: impactAirFront,
      airBack: impactAirBack,
      supportDist: Math.hypot(impactX - probeX, impactY - probeY),
      landable: impactDotUp > 0 && Math.max(0, 1 - impactDotUp) <= landSlope,
    };
    const landVt = Math.max(0.8, planetParams.LAND_SPEED * 0.6);
    let landingSupportRatio = 1;
    if (shipCollisionPointsAt){
      const supportPts = shipCollisionPointsAt(ship.x, ship.y);
      const supportBand = [];
      let bestDownness = -Infinity;
      const planetOuterRadius = (typeof planet.planetRadius === "number")
        ? planet.planetRadius
        : (planet.radial && planet.radial.rings ? (planet.radial.rings.length - 1) : Infinity);
      const supportCheckNormal = contactImpact ? impactNormal : { nx: shipUpX, ny: shipUpY };
      for (const p of supportPts){
        const dx = p[0] - ship.x;
        const dy = p[1] - ship.y;
        const plen = Math.hypot(dx, dy);
        if (plen < 1e-6) continue;
        const downness = (-(dx * shipUpX + dy * shipUpY) / plen);
        if (downness > bestDownness) bestDownness = downness;
        supportBand.push({ x: p[0], y: p[1], downness });
      }
      let supportCount = 0;
      let supportTotal = 0;
      const bandThreshold = bestDownness - 0.12;
      const clearOutside = Math.max(0.12, shipRadius * 0.45);
      const clearInside = Math.max(0.10, shipRadius * 0.38);
      for (const p of supportBand){
        if (p.downness < bandThreshold) continue;
        supportTotal++;
        const pr = Math.hypot(p.x, p.y) || 1;
        const outerShellSample = pr >= planetOuterRadius - Math.max(0.30, shipRadius * 0.6);
        const sampleNx = outerShellSample ? (p.x / pr) : supportCheckNormal.nx;
        const sampleNy = outerShellSample ? (p.y / pr) : supportCheckNormal.ny;
        const airFront = collision.planetAirValueAtWorld(
          p.x + sampleNx * clearOutside,
          p.y + sampleNy * clearOutside
        );
        const airBack = collision.planetAirValueAtWorld(
          p.x - sampleNx * clearInside,
          p.y - sampleNy * clearInside
        );
        if (airFront > 0.5 && airBack <= 0.52){
          supportCount++;
        }
      }
      landingSupportRatio = supportTotal > 0 ? (supportCount / supportTotal) : 0;
    }
    /** @type {{source:string,reason:string,dotUp:number,slope:number,landSlope:number,vn:number,vt:number,speed:number,airFront:number,airBack:number,landable:boolean,landed:boolean,support:boolean,supportDist:number,contactsCount:number,bestDotUpAny:number,bestDotUpUnder:number,impactPoint:number,supportPoint:number,impactT:number,supportT:number,impactX:number,impactY:number,supportX:number,supportY:number,supportTriOuterCount:number,supportTriAirMin:number,supportTriAirMax:number,supportTriRMin:number,supportTriRMax:number,supportRatio?:number,overlapBeforeCount?:number,overlapAfterCount?:number,overlapBeforeMin?:number,overlapAfterMin?:number,depenPush?:number,depenIter?:number,depenCleared?:boolean}|null} */
    const landingDbg = debugEnabled ? {
      source: "planet",
      reason: "planet_eval",
      dotUp: landingInfo ? landingInfo.dotUp : 0,
      slope: landingInfo ? landingInfo.slope : 1,
      landSlope,
      vn: landingInfo.vn,
      vt: landingInfo.vt,
      speed: speedAbs,
      airFront: landingInfo.airFront,
      airBack: landingInfo.airBack,
      landable: landingInfo.landable,
      landed: false,
      support: !!contactImpact,
      supportDist: landingInfo.supportDist,
      contactsCount: contactsPose.length ? contactsPose.length : contacts.length,
      bestDotUpAny,
      bestDotUpUnder,
      impactPoint: contactImpact ? contactImpact.pointIndex : -1,
      supportPoint: contactImpact ? contactImpact.pointIndex : -1,
      impactT: contactImpact ? contactImpact.t : Number.NaN,
      supportT: contactImpact ? contactImpact.t : Number.NaN,
      impactX,
      impactY,
      supportX,
      supportY,
      supportTriOuterCount: supportMeta ? supportMeta.outerCount : -1,
      supportTriAirMin: supportMeta ? supportMeta.airMin : Number.NaN,
      supportTriAirMax: supportMeta ? supportMeta.airMax : Number.NaN,
      supportTriRMin: supportMeta ? supportMeta.rMin : Number.NaN,
      supportTriRMax: supportMeta ? supportMeta.rMax : Number.NaN,
      supportRatio: landingSupportRatio,
    } : null;
    const settledLanding = !contactImpact
      && contactsPose.length > 0
      && speedAbs <= Math.max(0.08, planetParams.LAND_SPEED * 0.35)
      && landingSupportRatio >= 0.5;

    if (
      (
        (landingInfo.landable
          && landingSupportRatio >= 0.5
          && landingInfo.vn >= -planetParams.LAND_SPEED
          && Math.abs(landingInfo.vt) <= landVt
          && speedAbs <= (planetParams.LAND_SPEED + 0.2))
        || settledLanding
      )
    ){
      if (landingDbg){
        landingDbg.reason = "planet_landed";
        landingDbg.landed = true;
        landingDbg.landable = true;
        if (settledLanding){
          landingDbg.vn = 0;
          landingDbg.vt = 0;
          landingDbg.speed = 0;
        }
        ship._landingDebug = landingDbg;
      }
      ship.state = "landed";
      ship.vx = 0;
      ship.vy = 0;
      return;
    }

    const restitution = Number.isFinite(planetParams.BOUNCE_RESTITUTION)
      ? Math.max(0, Math.min(1, Number(planetParams.BOUNCE_RESTITUTION)))
      : (Number.isFinite(game.BOUNCE_RESTITUTION) ? Math.max(0, Number(game.BOUNCE_RESTITUTION)) : 0.8);
    const wallFriction = Number.isFinite(planetParams.WALL_FRICTION)
      ? Math.max(0, Number(planetParams.WALL_FRICTION))
      : Math.max(0, Number(planetParams.LAND_FRICTION) || 0);
    if (vnImpact < 0){
      ship.vx -= (1 + restitution) * vnImpact * impactNormal.nx;
      ship.vy -= (1 + restitution) * vnImpact * impactNormal.ny;
      if (wallFriction > 0){
        const tx = -impactNormal.ny;
        const ty = impactNormal.nx;
        const vnAfter = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
        const vtAfter = ship.vx * tx + ship.vy * ty;
        // Keep wall friction readable across planet materials without reviving sticky slide logic.
        const damp = Math.max(0, 1 - wallFriction * 0.45 * Math.max(0, dt));
        const vtDamped = vtAfter * damp;
        ship.vx = impactNormal.nx * vnAfter + tx * vtDamped;
        ship.vy = impactNormal.ny * vnAfter + ty * vtDamped;
      }
      ship.x += impactNormal.nx * Math.max(0.002, shipRadius * 0.02);
      ship.y += impactNormal.ny * Math.max(0.002, shipRadius * 0.02);
      if (landingDbg){
        landingDbg.reason = "planet_reflect";
        landingDbg.vn = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
        landingDbg.vt = ship.vx * (-impactNormal.ny) + ship.vy * impactNormal.nx;
      }
    } else {
      if (landingDbg){
        landingDbg.reason = "planet_graze";
        landingDbg.vn = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
        landingDbg.vt = ship.vx * (-impactNormal.ny) + ship.vy * impactNormal.nx;
      }
    }

    const overlapBefore = shipCollidesAt(ship.x, ship.y);
    let overlapAfter = overlapBefore;
    let depenPush = 0;
    let depenCleared = true;
    if (overlapBefore){
      const depNow = depenetrateAlongNormal(
        ship.x,
        ship.y,
        impactNormal.nx,
        impactNormal.ny,
        shipCollidesAt,
        Math.max(0.18, shipRadius * 0.8),
        Math.max(0.02, shipRadius * 0.08)
      );
      ship.x = depNow.x;
      ship.y = depNow.y;
      depenPush = depNow.push;
      depenCleared = depNow.cleared;
      overlapAfter = shipCollidesAt(ship.x, ship.y);
      const vnNow = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
      if (vnNow < 0){
        ship.vx -= impactNormal.nx * vnNow;
        ship.vy -= impactNormal.ny * vnNow;
      }
    }
    if (
      vnImpact >= 0
      && !overlapAfter
      && Number.isFinite(shipStartX)
      && Number.isFinite(shipStartY)
      && Number.isFinite(dt)
      && dt > 1e-6
    ){
      ship.vx = (ship.x - Number(shipStartX)) / dt;
      ship.vy = (ship.y - Number(shipStartY)) / dt;
      if (landingDbg){
        landingDbg.vn = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
        landingDbg.vt = ship.vx * (-impactNormal.ny) + ship.vy * impactNormal.nx;
        landingDbg.speed = Math.hypot(ship.vx, ship.vy);
      }
    }
    if (landingDbg){
      landingDbg.overlapBeforeCount = overlapBefore ? 1 : 0;
      landingDbg.overlapAfterCount = overlapAfter ? 1 : 0;
      landingDbg.overlapBeforeMin = overlapBefore ? 0 : 1;
      landingDbg.overlapAfterMin = overlapAfter ? 0 : 1;
      landingDbg.depenPush = depenPush;
      landingDbg.depenIter = depenPush > 0 ? 1 : 0;
      landingDbg.depenCleared = depenCleared && !overlapAfter;
    }
    if (!overlapAfter){
      ship._collision = null;
    } else {
      if (landingDbg){
        landingDbg.reason = "planet_overlap_only";
      }
    }
    if (landingDbg){
      ship._landingDebug = landingDbg;
    }
    return;
  }

  if (!mothership){
    ship._collision = null;
    return;
  }
  const activeMothership = expectDefined(mothership);

  const collidesMothershipAt = shipCollidesMothershipAt || shipCollidesAt;
  const strictEdges = shipCollisionPointsAt ? getMothershipBoundaryEdges(activeMothership) : [];
  const strictSkin = Math.max(0.002, (activeMothership.spacing || 0.4) * 0.01);
  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  const hasStrictMothershipOverlapAt = (x, y) => {
    if (!shipCollisionPointsAt) return collidesMothershipAt(x, y);
    if (!strictEdges.length) return collidesMothershipAt(x, y);
    const pts = shipCollisionPointsAt(x, y);
    pts.push([x, y]);
    for (const p of pts){
      const av = mothershipAirAtWorld(activeMothership, p[0], p[1]);
      if (av === null || av > 0.5) continue;
      const lp = worldToMothershipLocal(activeMothership, p[0], p[1]);
      let bestD2 = Infinity;
      for (const e of strictEdges){
        const c = closestPointOnSegment(e.ax, e.ay, e.bx, e.by, lp.x, lp.y);
        if (c.d2 < bestD2) bestD2 = c.d2;
      }
      if (Math.sqrt(bestD2) > strictSkin){
        return true;
      }
    }
    return false;
  };
  const overlapNowStrict = hasStrictMothershipOverlapAt(ship.x, ship.y);
  const absInVx = ship.vx;
  const absInVy = ship.vy;
  const omega = Number.isFinite(mothershipAngularVel) ? Number(mothershipAngularVel) : 0;
  /**
   * Surface velocity of the rotating/translating mothership at world position.
   * @param {number} x
   * @param {number} y
   * @returns {{vx:number,vy:number}}
   */
  const baseVelocityAt = (x, y) => {
    const rx = x - activeMothership.x;
    const ry = y - activeMothership.y;
    return {
      vx: activeMothership.vx - omega * ry,
      vy: activeMothership.vy + omega * rx,
    };
  };
  const collisionEvidence = collectMothershipCollisionEvidence(activeMothership, prevPoints, currPoints);
  let hasEventContact = false;
  /** @type {Array<{kind:string,edgeIdx:number,hullIdx:number,x:number,y:number,nx:number,ny:number,av?:number|null}>} */
  let eventHits = [];
  /** @type {"sweep_vertex"|"pose_edge"|"inside_vertex"|null} */
  let eventMode = null;
  let eventCount = 0;
  let contactX = hx;
  let contactY = hy;
  let nx;
  let ny;
  let contactsCount = 0;
  const collisionEvidenceCount = collisionEvidence?.count ?? 0;
  if (collisionEvidenceCount < 2){
    const nFallback = contactNormal((x, y) => collision.airValueAtWorld(x, y), hx, hy);
    nx = nFallback.nx;
    ny = nFallback.ny;
  } else {
    const evidence = /** @type {NonNullable<ReturnType<typeof collectMothershipCollisionEvidence>>} */ (collisionEvidence);
    hasEventContact = true;
    eventHits = evidence.hits.slice();
    eventMode = evidence.mode;
    eventCount = evidence.count;
    contactX = evidence.avgX;
    contactY = evidence.avgY;
    contactsCount = evidence.count;
    nx = evidence.avgNx;
    ny = evidence.avgNy;
  }

  let base = baseVelocityAt(contactX, contactY);
  let relVx = ship.vx - base.vx;
  let relVy = ship.vy - base.vy;
  let vn = relVx * nx + relVy * ny;
  let vt = relVx * -ny + relVy * nx;
  if (vn > 0){
    nx = -nx;
    ny = -ny;
    vn = relVx * nx + relVy * ny;
    vt = relVx * -ny + relVy * nx;
  }
  ship._landingDebug = {
    source: "mothership",
    reason: hasEventContact ? "mothership_contact" : "mothership_graze",
    vn,
    vt,
    speed: Math.hypot(relVx, relVy),
    impactX: contactX,
    impactY: contactY,
    supportX: contactX,
    supportY: contactY,
    contactsCount,
    overlapBeforeCount: overlapNowStrict ? 1 : 0,
    overlapAfterCount: overlapNowStrict ? 1 : 0,
    overlapBeforeMin: overlapNowStrict ? 0 : 1,
    overlapAfterMin: overlapNowStrict ? 0 : 1,
    depenIter: 0,
    depenPush: 0,
    depenCushion: 0,
    depenDir: 0,
    depenCleared: !overlapNowStrict,
  };
  const mothershipDbg = expectDefined(ship._landingDebug);

  if (!hasEventContact && !overlapNowStrict){
    ship._collision = null;
    if (mothershipDbg){
      mothershipDbg.reason = "mothership_no_contact";
      mothershipDbg.vn = 0;
      mothershipDbg.vt = 0;
      mothershipDbg.speed = 0;
    }
    setMothershipDiag(mothershipDbg, {
      mode: "no_contact",
      absIn: vecDiag(absInVx, absInVy),
      absOut: vecDiag(ship.vx, ship.vy),
      relIn: vecDiag(relVx, relVy),
      relOut: vecDiag(relVx, relVy),
      vnIn: 0,
      vtIn: 0,
      vnOut: 0,
      vtOut: 0,
      normalAvg: null,
      normals: [],
      evidence: {
        overlapNowStrict,
        eventMode: null,
        eventCount: 0,
      },
    });
    ship._mothershipTrapFrames = 0;
    return;
  }

  if (vn < -planetParams.CRASH_SPEED){
    onCrash();
    return;
  }

  const cUp = Math.cos(activeMothership.angle);
  const sUp = Math.sin(activeMothership.angle);
  const upx = -sUp;
  const upy = cUp;
  const maxSlope = 1 - Math.cos(Math.PI / 8); // 22.5 deg
  const landSlope = Math.min((1 - game.SURFACE_DOT) + 0.03, maxSlope);
  const dotUpRaw = nx * upx + ny * upy;
  const slope = 1 - Math.abs(dotUpRaw);
  const landable = (dotUpRaw < 0 && slope <= landSlope);
  const mothershipLandSpeed = Math.max(0, Number(game.LAND_SPEED) || 0);
  const landVn = Math.max(0.08, mothershipLandSpeed * 3.0);
  const landVt = Math.max(0.8, mothershipLandSpeed * 0.6);
  if (!overlapNowStrict && (!hasEventContact || vn >= 0) && !landable){
    ship._collision = null;
    if (mothershipDbg){
      mothershipDbg.reason = "mothership_graze";
      mothershipDbg.contactsCount = 0;
      mothershipDbg.vn = 0;
      mothershipDbg.vt = 0;
      mothershipDbg.speed = 0;
      mothershipDbg.overlapBeforeCount = 0;
      mothershipDbg.overlapAfterCount = 0;
    }
    setMothershipDiag(mothershipDbg, {
      mode: "graze",
      absIn: vecDiag(absInVx, absInVy),
      absOut: vecDiag(ship.vx, ship.vy),
      relIn: vecDiag(relVx, relVy),
      relOut: vecDiag(relVx, relVy),
      vnIn: vn,
      vtIn: vt,
      vnOut: vn,
      vtOut: vt,
      normalAvg: hasEventContact ? { nx, ny } : null,
      normals: eventHits,
      evidence: {
        overlapNowStrict,
        eventMode,
        eventCount,
      },
    });
    ship._mothershipTrapFrames = 0;
    return;
  }

  if (landable && vn >= -landVn && Math.abs(vt) < landVt){
    ship.state = "landed";
    const lift = shipRadius * 0.28;
    ship.x += nx * lift;
    ship.y += ny * lift;
    const clearStep = shipRadius * 0.2;
    for (let i = 0; i < 8 && collidesMothershipAt(ship.x, ship.y); i++){
      ship.x += nx * clearStep;
      ship.y += ny * clearStep;
    }
    const dx2 = ship.x - activeMothership.x;
    const dy2 = ship.y - activeMothership.y;
    const c2 = Math.cos(-activeMothership.angle);
    const s2 = Math.sin(-activeMothership.angle);
    ship._dock = {
      lx: c2 * dx2 - s2 * dy2,
      ly: s2 * dx2 + c2 * dy2,
    };
    const vDock = baseVelocityAt(ship.x, ship.y);
    ship.vx = vDock.vx;
    ship.vy = vDock.vy;
    if (mothershipDbg){
      mothershipDbg.reason = "mothership_landed";
      mothershipDbg.landable = true;
      mothershipDbg.landed = true;
    }
    if (isDockedWithMothership()){
      onSuccessfullyDocked();
    }
    setMothershipDiag(mothershipDbg, {
      mode: "landed",
      absIn: vecDiag(absInVx, absInVy),
      absOut: vecDiag(ship.vx, ship.vy),
      relIn: vecDiag(relVx, relVy),
      relOut: vecDiag(0, 0),
      vnIn: vn,
      vtIn: vt,
      vnOut: 0,
      vtOut: 0,
      normalAvg: { nx, ny },
      normals: eventHits,
      evidence: {
        overlapNowStrict,
        eventMode,
        eventCount,
      },
    });
    ship._mothershipTrapFrames = 0;
    return;
  }

  const backoff = backoffShipAlongNegativeRelativeVelocity(
    activeMothership,
    ship,
    hasStrictMothershipOverlapAt,
    baseVelocityAt,
    shipRadius
  );
  if (mothershipDbg){
    mothershipDbg.overlapBeforeCount = backoff.hadOverlap ? 1 : 0;
    mothershipDbg.overlapBeforeMin = backoff.hadOverlap ? 0 : 1;
    mothershipDbg.depenPush = backoff.dist;
    mothershipDbg.depenCleared = backoff.cleared;
    mothershipDbg.depenDir = (backoff.dirX || backoff.dirY) ? 1 : 0;
    mothershipDbg.depenIter = backoff.hadOverlap ? 1 : 0;
  }
  let overlapAfter = hasStrictMothershipOverlapAt(ship.x, ship.y);
  if (overlapAfter){
    const depNow = depenetrateAlongNormal(
      ship.x,
      ship.y,
      nx,
      ny,
      hasStrictMothershipOverlapAt,
      Math.max(0.18, shipRadius * 0.7),
      Math.max(0.02, shipRadius * 0.08)
    );
    ship.x = depNow.x;
    ship.y = depNow.y;
    overlapAfter = hasStrictMothershipOverlapAt(ship.x, ship.y);
    if (mothershipDbg){
      mothershipDbg.depenPush = (mothershipDbg.depenPush || 0) + depNow.push;
      mothershipDbg.depenIter = (mothershipDbg.depenIter || 0) + (depNow.cleared ? 1 : 0);
      mothershipDbg.depenCleared = depNow.cleared && !overlapAfter;
    }
  }
  if (mothershipDbg){
    mothershipDbg.overlapAfterCount = overlapAfter ? 1 : 0;
    mothershipDbg.overlapAfterMin = overlapAfter ? 0 : 1;
  }
  if (!hasEventContact){
    ship._collision = null;
    if (mothershipDbg){
      mothershipDbg.reason = overlapAfter ? "mothership_overlap_only" : "mothership_graze";
      mothershipDbg.contactsCount = 0;
      mothershipDbg.vn = 0;
      mothershipDbg.vt = 0;
      mothershipDbg.speed = 0;
    }
    setMothershipDiag(mothershipDbg, {
      mode: overlapAfter ? "overlap_only" : "graze",
      absIn: vecDiag(absInVx, absInVy),
      absOut: vecDiag(ship.vx, ship.vy),
      relIn: vecDiag(relVx, relVy),
      relOut: vecDiag(relVx, relVy),
      vnIn: 0,
      vtIn: 0,
      vnOut: 0,
      vtOut: 0,
      normalAvg: null,
      normals: [],
      evidence: {
        overlapNowStrict,
        overlapAfter,
        eventMode: null,
        eventCount: 0,
      },
      backoff: { ...backoff },
    });
    ship._mothershipTrapFrames = 0;
    return;
  }

  base = baseVelocityAt(contactX, contactY);
  relVx = ship.vx - base.vx;
  relVy = ship.vy - base.vy;
  vn = relVx * nx + relVy * ny;
  vt = relVx * -ny + relVy * nx;
  if (vn > 0){
    ship._collision = null;
    if (mothershipDbg){
      mothershipDbg.reason = "mothership_graze";
      mothershipDbg.contactsCount = 0;
      mothershipDbg.vn = 0;
      mothershipDbg.vt = 0;
      mothershipDbg.speed = 0;
    }
    setMothershipDiag(mothershipDbg, {
      mode: "graze",
      absIn: vecDiag(absInVx, absInVy),
      absOut: vecDiag(ship.vx, ship.vy),
      relIn: vecDiag(relVx, relVy),
      relOut: vecDiag(relVx, relVy),
      vnIn: vn,
      vtIn: vt,
      vnOut: vn,
      vtOut: vt,
      normalAvg: hasEventContact ? { nx, ny } : null,
      normals: eventHits,
      evidence: {
        overlapNowStrict,
        overlapAfter,
        eventMode,
        eventCount,
      },
      backoff: { ...backoff },
    });
    ship._mothershipTrapFrames = 0;
    return;
  }

  const tx = -ny;
  const ty = nx;
  const e = Number.isFinite(game.MOTHERSHIP_RESTITUTION)
    ? Math.max(0, Math.min(1, Number(game.MOTHERSHIP_RESTITUTION)))
    : Math.max(0, Math.min(1, Number(game.BOUNCE_RESTITUTION) || 0));
  const mothershipFriction = Number.isFinite(game.MOTHERSHIP_FRICTION)
    ? Math.max(0, Number(game.MOTHERSHIP_FRICTION))
    : 0;
  const relInVx = relVx;
  const relInVy = relVy;
  const vnIn = vn;
  const vtIn = vt;
  const relReflectVx = relInVx - (1 + e) * vnIn * nx;
  const relReflectVy = relInVy - (1 + e) * vnIn * ny;
  const vnReflect = relReflectVx * nx + relReflectVy * ny;
  const vtReflect = relReflectVx * tx + relReflectVy * ty;
  const damp = Math.max(0, 1 - mothershipFriction * 0.45 * Math.max(0, dt));
  const vtOut = vtReflect * damp;
  const relOutVx = vnReflect * nx + vtOut * tx;
  const relOutVy = vnReflect * ny + vtOut * ty;
  const vnOut = relOutVx * nx + relOutVy * ny;
  ship.vx = base.vx + relOutVx;
  ship.vy = base.vy + relOutVy;

  if (mothershipDbg){
    const relAfterX = ship.vx - base.vx;
    const relAfterY = ship.vy - base.vy;
    mothershipDbg.reason = "mothership_reflect";
    mothershipDbg.vn = relAfterX * nx + relAfterY * ny;
    mothershipDbg.vt = relAfterX * tx + relAfterY * ty;
    mothershipDbg.speed = Math.hypot(relAfterX, relAfterY);
    mothershipDbg.contactsCount = contactsCount;
    setMothershipDiag(mothershipDbg, {
      mode: eventMode || "overlap_only",
      absIn: vecDiag(absInVx, absInVy),
      absOut: vecDiag(ship.vx, ship.vy),
      relIn: vecDiag(relInVx, relInVy),
      relOut: vecDiag(relAfterX, relAfterY),
      vnIn,
      vtIn,
      vnOut,
      vtOut,
      normalAvg: { nx, ny },
      normals: eventHits,
      evidence: {
        overlapNowStrict,
        overlapAfter,
        eventMode,
        eventCount,
      },
      backoff: { ...backoff },
    });
  }

  ship._mothershipTrapFrames = 0;
}

/**
 * Post-collision depenetration against planet terrain using
 * minimum outward translation along local collision normal.
 * @param {{
 *  ship: import("./types.d.js").Ship,
 *  collision: import("./types.d.js").CollisionQuery,
 *  planet: import("./planet.js").Planet,
 *  collisionEps: number,
 *  shipCollisionPointsAt: (x:number, y:number)=>Array<[number, number]>,
 *  shipRadius: ()=>number,
 * }} ctx
 * @param {number} [maxIters]
 * @returns {void}
 */
export function stabilizePlanetPenetration(ctx, maxIters = 12){
  const { ship, collision, planet } = ctx;
  const eps = Math.max(1e-3, ctx.collisionEps || 0.18);
  // Ignore shallow boundary touches; only depenetrate true penetration.
  const solidThreshold = 0.47;

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Array<[number, number]>}
   */
  const samplePointsAt = (x, y) => {
    const out = ctx.shipCollisionPointsAt(x, y);
    out.push([x, y]);
    return out;
  };

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{x:number,y:number,av:number}|null}
   */
  const deepestPlanetHitAt = (x, y) => {
    const pts = samplePointsAt(x, y);
    /** @type {{x:number,y:number,av:number}|null} */
    let hit = null;
    for (const p of pts){
      const av = collision.planetAirValueAtWorld(p[0], p[1]);
      if (av > solidThreshold) continue;
      if (!hit || av < hit.av){
        hit = { x: p[0], y: p[1], av };
      }
    }
    return hit;
  };

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  const collidesPlanetAt = (x, y) => deepestPlanetHitAt(x, y) !== null;

  for (let iter = 0; iter < maxIters; iter++){
    const planetHit = deepestPlanetHitAt(ship.x, ship.y);
    if (!planetHit) break;

    let nxField = collision.planetAirValueAtWorld(planetHit.x + eps, planetHit.y)
      - collision.planetAirValueAtWorld(planetHit.x - eps, planetHit.y);
    let nyField = collision.planetAirValueAtWorld(planetHit.x, planetHit.y + eps)
      - collision.planetAirValueAtWorld(planetHit.x, planetHit.y - eps);
    let nlen = Math.hypot(nxField, nyField);
    if (nlen < 1e-4){
      nxField = ship.x - planetHit.x;
      nyField = ship.y - planetHit.y;
      nlen = Math.hypot(nxField, nyField);
    }
    if (nlen < 1e-4){
      const rr = Math.hypot(ship.x, ship.y) || 1;
      nxField = ship.x / rr;
      nyField = ship.y / rr;
      nlen = 1;
    }
    nxField /= nlen;
    nyField /= nlen;
    const tri = (planet.radial && typeof planet.radial.findTriAtWorld === "function")
      ? planet.radial.findTriAtWorld(planetHit.x, planetHit.y)
      : null;
    const nTri = triAirNormalFromTri(/** @type {Array<{x:number,y:number,air:number}>|null} */ (tri), nxField, nyField);
    let nx = nTri.nx;
    let ny = nTri.ny;

    if (nx * ship.x + ny * ship.y < 0){
      nx = -nx;
      ny = -ny;
    }

    const maxPush = Math.max(0.35, ctx.shipRadius() * 1.6);
    let lo = 0;
    let hi = 0.01;
    while (hi < maxPush && collidesPlanetAt(ship.x + nx * hi, ship.y + ny * hi)){
      lo = hi;
      hi *= 2;
    }
    if (hi > maxPush) hi = maxPush;
    if (collidesPlanetAt(ship.x + nx * hi, ship.y + ny * hi)){
      ship.x += nx * hi;
      ship.y += ny * hi;
    } else {
      for (let b = 0; b < 14; b++){
        const mid = (lo + hi) * 0.5;
        if (collidesPlanetAt(ship.x + nx * mid, ship.y + ny * mid)){
          lo = mid;
        } else {
          hi = mid;
        }
      }
      ship.x += nx * hi;
      ship.y += ny * hi;
    }
  }

  const refreshed = collision.sampleCollisionPoints(samplePointsAt(ship.x, ship.y));
  ship._samples = refreshed.samples;
  if (refreshed.hit){
    /** @type {NonNullable<import("./types.d.js").Ship["_collision"]>} */
    const collisionHit = {
      x: refreshed.hit.x,
      y: refreshed.hit.y,
      tri: planet.radial.findTriAtWorld(refreshed.hit.x, refreshed.hit.y),
      node: planet.radial.nearestNodeOnRing(refreshed.hit.x, refreshed.hit.y),
    };
    if (refreshed.hitSource){
      collisionHit.source = refreshed.hitSource;
    }
    ship._collision = collisionHit;
  } else {
    ship._collision = null;
  }
}
