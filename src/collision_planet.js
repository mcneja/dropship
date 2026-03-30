// @ts-check

import {
  closestPointOnSegment,
  convexPolysOverlap,
  depenetrateAlongNormal,
  extractHullBoundaryContacts,
  sampleGradientNormal,
} from "./collision_helpers.js";

/**
 * @param {[number, number]} a
 * @param {[number, number]} b
 * @returns {boolean}
 */
function samePointTuple(a, b){
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6;
}

/**
 * @param {{x:number,y:number,air:number}} a
 * @param {{x:number,y:number,air:number}} b
 * @returns {[number, number]}
 */
function boundaryPointOnEdge(a, b){
  const denom = (b.air - a.air) || 1e-6;
  const t = Math.max(0, Math.min(1, (0.5 - a.air) / denom));
  return [
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
  ];
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
 * Return explicit boundary edge defs for a triangle.
 * @param {Array<{x:number,y:number,air:number}>|null|undefined} tri
 * @returns {Array<{p0:[number,number],p1:[number,number]}>}
 */
function boundaryEdgeDefsFromTri(tri){
  /** @type {Array<{p0:[number,number],p1:[number,number]}>} */
  const out = [];
  if (!tri || tri.length < 3) return out;
  /** @type {Array<[number, number]>} */
  const pts = [];
  const eps = 1e-6;
  /**
   * @param {[number, number]} p
   * @returns {void}
   */
  const pushUnique = (p) => {
    for (const q of pts){
      if (samePointTuple(p, q)) return;
    }
    pts.push(p);
  };
  for (let i = 0; i < 3; i++){
    const a = tri[i];
    const b = tri[(i + 1) % 3];
    if (!a || !b) continue;
    const da = a.air - 0.5;
    const db = b.air - 0.5;
    if (Math.abs(da) <= eps) pushUnique([a.x, a.y]);
    if (Math.abs(db) <= eps) pushUnique([b.x, b.y]);
    if (da * db < 0) pushUnique(boundaryPointOnEdge(a, b));
  }
  if (pts.length >= 2){
    out.push({
      p0: /** @type {[number, number]} */ (pts[0]),
      p1: /** @type {[number, number]} */ (pts[1]),
    });
  }
  return out;
}

/**
 * @typedef {{ax:number,ay:number,bx:number,by:number,mx:number,my:number,nx:number,ny:number}} BoundaryEdge
 */

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
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qpx = qx - px;
  const qpy = qy - py;
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { t, u };
}

/**
 * @param {[number, number]} p0
 * @param {[number, number]} p1
 * @returns {string}
 */
function boundaryEdgeKey(p0, p1){
  const ax = Math.round(p0[0] * 1000);
  const ay = Math.round(p0[1] * 1000);
  const bx = Math.round(p1[0] * 1000);
  const by = Math.round(p1[1] * 1000);
  if (ax < bx || (ax === bx && ay <= by)){
    return `${ax},${ay}:${bx},${by}`;
  }
  return `${bx},${by}:${ax},${ay}`;
}

/**
 * @param {BoundaryEdge[]} edges
 * @param {Map<string, BoundaryEdge>} byKey
 * @param {(x:number,y:number)=>number} airAt
 * @param {[number, number]} p0
 * @param {[number, number]} p1
 * @returns {void}
 */
function pushBoundaryEdge(edges, byKey, airAt, p0, p1){
  if (samePointTuple(p0, p1)) return;
  const key = boundaryEdgeKey(p0, p1);
  if (byKey.has(key)) return;
  const ex = p1[0] - p0[0];
  const ey = p1[1] - p0[1];
  const len = Math.hypot(ex, ey);
  if (len <= 1e-8) return;
  const mx = (p0[0] + p1[0]) * 0.5;
  const my = (p0[1] + p1[1]) * 0.5;
  let nx = ey / len;
  let ny = -ex / len;
  const probe = 0.06;
  const front = airAt(mx + nx * probe, my + ny * probe);
  const back = airAt(mx - nx * probe, my - ny * probe);
  if (back > front){
    nx = -nx;
    ny = -ny;
  } else if (Math.abs(front - back) <= 1e-6){
    const rr = Math.hypot(mx, my) || 1;
    if (nx * (mx / rr) + ny * (my / rr) < 0){
      nx = -nx;
      ny = -ny;
    }
  }
  const edge = { ax: p0[0], ay: p0[1], bx: p1[0], by: p1[1], mx, my, nx, ny };
  byKey.set(key, edge);
  edges.push(edge);
}

/**
 * @param {{bandTris:Array<Array<Array<{x:number,y:number,air:number}>>|undefined>|undefined}} radial
 * @param {(x:number,y:number)=>number} airAt
 * @param {number} b0
 * @param {number} b1
 * @returns {BoundaryEdge[]}
 */
function collectBoundaryEdges(radial, airAt, b0, b1){
  /** @type {BoundaryEdge[]} */
  const edges = [];
  /** @type {Map<string, BoundaryEdge>} */
  const byKey = new Map();
  const bandMax = Math.max(0, (radial.bandTris?.length || 1) - 1);
  for (let bi = Math.max(0, b0); bi <= Math.min(bandMax, b1); bi++){
    const tris = radial.bandTris ? radial.bandTris[bi] : null;
    if (!tris) continue;
    for (const tri of tris){
      const defs = boundaryEdgeDefsFromTri(tri);
      for (const def of defs){
        pushBoundaryEdge(edges, byKey, airAt, def.p0, def.p1);
      }
    }
  }
  return edges;
}

/**
 * @param {BoundaryEdge[]} edges
 * @param {number} x
 * @param {number} y
 * @param {number} [preferDx]
 * @param {number} [preferDy]
 * @param {number} [fallbackNx]
 * @param {number} [fallbackNy]
 * @returns {{edge:BoundaryEdge,cp:{x:number,y:number,u:number,d2:number},preferVn:number,fallbackDot:number}|null}
 */
function nearestBoundaryEdge(edges, x, y, preferDx = Number.NaN, preferDy = Number.NaN, fallbackNx = Number.NaN, fallbackNy = Number.NaN){
  if (!edges.length) return null;
  let minD2 = Infinity;
  const preferLen = Math.hypot(preferDx, preferDy);
  /** @type {Array<{edge:BoundaryEdge,cp:{x:number,y:number,u:number,d2:number},preferVn:number,fallbackDot:number}>} */
  const cands = [];
  for (const edge of edges){
    const cp = closestPointOnSegment(edge.ax, edge.ay, edge.bx, edge.by, x, y);
    if (cp.d2 < minD2) minD2 = cp.d2;
    cands.push({
      edge,
      cp,
      preferVn: preferLen > 1e-6 ? (preferDx * edge.nx + preferDy * edge.ny) : Number.NaN,
      fallbackDot: Number.isFinite(fallbackNx) && Number.isFinite(fallbackNy) ? (edge.nx * fallbackNx + edge.ny * fallbackNy) : Number.NaN,
    });
  }
  const d2Tol = 1e-4;
  /** @type {{edge:BoundaryEdge,cp:{x:number,y:number,u:number,d2:number},preferVn:number,fallbackDot:number}|null} */
  let best = null;
  for (const cand of cands){
    if (cand.cp.d2 > minD2 + d2Tol) continue;
    if (!best){
      best = cand;
      continue;
    }
    if (preferLen > 1e-6){
      if (cand.preferVn < best.preferVn - 1e-6){
        best = cand;
        continue;
      }
      if (Math.abs(cand.preferVn - best.preferVn) <= 1e-6){
        if (cand.cp.d2 < best.cp.d2 - 1e-6){
          best = cand;
          continue;
        }
        if (Math.abs(cand.cp.d2 - best.cp.d2) <= 1e-6 && cand.fallbackDot > best.fallbackDot){
          best = cand;
        }
      }
    } else if (cand.cp.d2 < best.cp.d2 - 1e-6){
      best = cand;
    } else if (Math.abs(cand.cp.d2 - best.cp.d2) <= 1e-6 && cand.fallbackDot > best.fallbackDot){
      best = cand;
    }
  }
  return best;
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
 * @param {{CRASH_SPEED:number,LAND_SPEED:number,LAND_FRICTION:number,WALL_FRICTION?:number,BOUNCE_RESTITUTION?:number}} args.planetParams
 * @param {{SURFACE_DOT:number,BOUNCE_RESTITUTION:number,MOTHERSHIP_FRICTION:number,MOTHERSHIP_RESTITUTION:number,LAND_SPEED:number,LAND_MAX_TANGENT_SPEED?:number}} args.game
 * @param {number} args.dt
 * @param {number} args.eps
 * @param {boolean} [args.debugEnabled]
 * @param {number} args.shipRadius
 * @param {(x:number,y:number)=>boolean} args.shipCollidesAt
 * @param {(x:number,y:number)=>Array<[number,number]>} [args.shipCollisionPointsAt]
 * @param {number} [args.shipStartX]
 * @param {number} [args.shipStartY]
 * @param {number} [args.shipEndX]
 * @param {number} [args.shipEndY]
 * @param {boolean} [args.thrustInputActive]
 * @param {number} [args.controlAccelX]
 * @param {number} [args.controlAccelY]
 * @param {Array<[number,number]>} [args.prevPoints]
 * @param {Array<[number,number]>} [args.currPoints]
 * @param {()=>void} args.onCrash
 * @returns {void}
 */
export function resolvePlanetCollisionResponse(args){
  const {
    ship,
    collision,
    planet,
    planetParams,
    game,
    dt,
    eps,
    debugEnabled = false,
    shipRadius,
    shipCollidesAt,
    shipCollisionPointsAt,
    shipStartX,
    shipStartY,
    shipEndX,
    shipEndY,
    thrustInputActive = false,
    controlAccelX = Number.NaN,
    controlAccelY = Number.NaN,
    prevPoints,
    currPoints,
    onCrash,
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
    return sampleGradientNormal(sample, eps, ship.x, ship.y, cx, cy);
  };

  {
    const shipR = Math.hypot(ship.x, ship.y) || 1;
    const shipUpX = ship.x / shipR;
    const shipUpY = ship.y / shipR;

    const radial = planet && planet.radial;
    let queryRMin = Math.min(Math.hypot(hx, hy), shipR) - shipRadius - 0.5;
    let queryRMax = Math.max(Math.hypot(hx, hy), shipR) + shipRadius + 0.5;
    /** @param {[number, number]|null|undefined} p */
    const includeQueryPoint = (p) => {
      if (!p) return;
      const pr = Math.hypot(p[0], p[1]);
      queryRMin = Math.min(queryRMin, pr - shipRadius - 0.5);
      queryRMax = Math.max(queryRMax, pr + shipRadius + 0.5);
    };
    if (prevPoints){
      for (const p of prevPoints) includeQueryPoint(p);
    }
    if (currPoints){
      for (const p of currPoints) includeQueryPoint(p);
    }
    const boundaryEdges = (radial && radial.bandTris)
      ? collectBoundaryEdges(
        radial,
        (x, y) => collision.planetAirValueAtWorld(x, y),
        Math.floor(queryRMin) - 3,
        Math.ceil(queryRMax) + 3
      )
      : [];

    /**
     * Resolve exact contact from nearest explicit boundary edge.
     * @param {number} x
     * @param {number} y
     * @returns {{x:number,y:number,nx:number,ny:number,diag?:{queryX:number,queryY:number,preferDx:number,preferDy:number,segments:Array<{ax:number,ay:number,bx:number,by:number,nx:number,ny:number,d2:number,u:number,preferVn:number,fallbackDot:number,chosen:boolean}>}|null}}
      */
    const normalAtContact = (x, y, preferDx = Number.NaN, preferDy = Number.NaN) => {
      const fallback = contactNormal((sx, sy) => collision.planetAirValueAtWorld(sx, sy), x, y);
      const near = nearestBoundaryEdge(boundaryEdges, x, y, preferDx, preferDy, fallback.nx, fallback.ny);
      if (!near){
        return { x, y, nx: fallback.nx, ny: fallback.ny, diag: null };
      }
      return {
        x: near.cp.x,
        y: near.cp.y,
        nx: near.edge.nx,
        ny: near.edge.ny,
        diag: debugEnabled ? {
          queryX: x,
          queryY: y,
          preferDx,
          preferDy,
          segments: [{
            ax: near.edge.ax,
            ay: near.edge.ay,
            bx: near.edge.bx,
            by: near.edge.by,
            nx: near.edge.nx,
            ny: near.edge.ny,
            d2: near.cp.d2,
            u: near.cp.u,
            preferVn: near.preferVn,
            fallbackDot: near.fallbackDot,
            chosen: true,
          }],
        } : null,
      };
    };

    /**
     * Collect collider-point air->rock crossings from previous frame to current frame.
     * Uses all ship sample points as independent swept probes.
     * @returns {Array<any>}
     */
    const sweepContacts = () => {
      if (!prevPoints || !currPoints || !prevPoints.length || !currPoints.length){
        return [];
      }
      const nPts = Math.min(prevPoints.length, currPoints.length);
      /** @type {Array<any>} */
      const out = [];
      for (let i = 0; i < nPts; i++){
        const p0 = prevPoints[i];
        const p1 = currPoints[i];
        if (!p0 || !p1) continue;
        const svx = p1[0] - p0[0];
        const svy = p1[1] - p0[1];
        let bestHit = null;
        for (const edge of boundaryEdges){
          const hitSeg = segmentIntersectionParams(
            p0[0], p0[1], svx, svy,
            edge.ax, edge.ay, edge.bx - edge.ax, edge.by - edge.ay
          );
          if (!hitSeg) continue;
          const entryVn = svx * edge.nx + svy * edge.ny;
          if (entryVn >= -1e-6) continue;
          if (!bestHit || hitSeg.t < bestHit.t - 1e-6 || (Math.abs(hitSeg.t - bestHit.t) <= 1e-6 && entryVn < bestHit.entryVn)){
            bestHit = { edge, t: hitSeg.t, u: hitSeg.u, entryVn };
          }
        }
        let n;
        let entryVn;
        let tHit;
        if (bestHit){
          tHit = bestHit.t;
          entryVn = bestHit.entryVn;
          n = {
            x: bestHit.edge.ax + (bestHit.edge.bx - bestHit.edge.ax) * bestHit.u,
            y: bestHit.edge.ay + (bestHit.edge.by - bestHit.edge.ay) * bestHit.u,
            nx: bestHit.edge.nx,
            ny: bestHit.edge.ny,
            diag: debugEnabled ? {
              queryX: p0[0] + svx * bestHit.t,
              queryY: p0[1] + svy * bestHit.t,
              preferDx: svx,
              preferDy: svy,
              segments: [{
                ax: bestHit.edge.ax,
                ay: bestHit.edge.ay,
                bx: bestHit.edge.bx,
                by: bestHit.edge.by,
                nx: bestHit.edge.nx,
                ny: bestHit.edge.ny,
                d2: 0,
                u: bestHit.u,
                preferVn: bestHit.entryVn,
                fallbackDot: Number.NaN,
                chosen: true,
              }],
            } : null,
          };
        } else {
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
            if (aMid > 0.5) lo = tMid;
            else hi = tMid;
          }
          tHit = hi;
          const cx = p0[0] + (p1[0] - p0[0]) * tHit;
          const cy = p0[1] + (p1[1] - p0[1]) * tHit;
          n = normalAtContact(cx, cy, svx, svy);
          entryVn = svx * n.nx + svy * n.ny;
        }
        out.push({
          x: n.x,
          y: n.y,
          nx: n.nx,
          ny: n.ny,
          t: tHit,
          pointIndex: i,
          entryVn,
          normalDiag: n.diag || null,
        });
      }

      return out;
    };

    /**
     * Collect contacts from currently colliding hull sample points.
     * This complements swept entry contacts for stable support selection.
     * @returns {Array<any>}
     */
    const poseContacts = () => {
      /** @type {Array<any>} */
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
          t: 1,
          pointIndex: i,
          entryVn: ship.vx * n.nx + ship.vy * n.ny,
          normalDiag: n.diag || null,
        });
      }
      return out;
    };

    /**
     * @param {Array<any>} contacts
     * @returns {any}
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
    // Prefer the earliest swept entry feature when available. Do not fall back
    // to an averaged manifold normal for response; around sharp corners it can
    // produce a bisector normal that traps the hull and cancels forward motion.
    const contactImpact = pickImpactContact(contacts);
    let impactX = hx;
    let impactY = hy;
    let impactNormal = contactNormal((x, y) => collision.planetAirValueAtWorld(x, y), impactX, impactY);
    if (contactImpact){
      impactX = contactImpact.x;
      impactY = contactImpact.y;
      impactNormal = { nx: contactImpact.nx, ny: contactImpact.ny };
    } else {
      const nHit = normalAtContact(impactX, impactY);
      impactX = nHit.x;
      impactY = nHit.y;
      impactNormal = { nx: nHit.nx, ny: nHit.ny };
    }
    const impactOrientProbeFront = Math.max(
      Math.max(0.03, Math.min(0.08, eps * 0.5)),
      Math.max(0.12, shipRadius * 0.45)
    );
    const impactOrientProbeBack = Math.max(
      Math.max(0.03, Math.min(0.08, eps * 0.5)),
      Math.max(0.10, shipRadius * 0.38)
    );
    const impactAirFrontCheck = collision.planetAirValueAtWorld(
      impactX + impactNormal.nx * impactOrientProbeFront,
      impactY + impactNormal.ny * impactOrientProbeFront
    );
    const impactAirBackCheck = collision.planetAirValueAtWorld(
      impactX - impactNormal.nx * impactOrientProbeBack,
      impactY - impactNormal.ny * impactOrientProbeBack
    );
    const trustExactImpactNormal = !!(contactImpact && contactImpact.normalDiag && Array.isArray(contactImpact.normalDiag.segments) && contactImpact.normalDiag.segments.length);
    if (!trustExactImpactNormal && impactAirBackCheck > impactAirFrontCheck){
      impactNormal.nx = -impactNormal.nx;
      impactNormal.ny = -impactNormal.ny;
    }

    const supportX = impactX;
    const supportY = impactY;
    const speedAbs = Math.hypot(ship.vx, ship.vy);
    const maxSlope = 1 - Math.cos(Math.PI / 8); // 22.5 deg
    const landSlope = Math.min((1 - game.SURFACE_DOT) + 0.03, maxSlope);
    const contactPool = contactsPose.length ? contactsPose : contacts;
    let bestDotUpAny = -Infinity;
    let bestDotUpUnder = -Infinity;
    /** @type {{nx:number,ny:number}|null} */
    let bestUnderNormal = null;
    for (const c of contactPool){
      const dot = c.nx * shipUpX + c.ny * shipUpY;
      if (dot > bestDotUpAny) bestDotUpAny = dot;
      const rcx = c.x - ship.x;
      const rcy = c.y - ship.y;
      const rLen = Math.hypot(rcx, rcy);
      const downness = rLen > 1e-6 ? (-(rcx * shipUpX + rcy * shipUpY) / rLen) : -1;
      if (downness >= 0.1 && dot > bestDotUpUnder){
        bestDotUpUnder = dot;
        bestUnderNormal = { nx: c.nx, ny: c.ny };
      }
    }
    const hasUnderSupport = Number.isFinite(bestDotUpUnder) && bestDotUpUnder > 0;
    const supportDotUp = hasUnderSupport ? bestDotUpUnder : -Infinity;
    const supportLandable = hasUnderSupport
      && supportDotUp > 0
      && Math.max(0, 1 - supportDotUp) <= landSlope;

    ship._collision = {
      x: supportX,
      y: supportY,
      source: "planet",
      tri: hit.tri || null,
      node: planet.radial.nearestNodeOnRing(supportX, supportY),
    };

    const vnImpact = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
    const sweptVnImpact = (contactImpact && Number.isFinite(contactImpact.entryVn) && Number.isFinite(dt) && dt > 1e-6)
      ? (contactImpact.entryVn / dt)
      : Number.NaN;
    const vnResponse = Number.isFinite(sweptVnImpact)
      ? Math.min(vnImpact, sweptVnImpact)
      : vnImpact;
    if (vnResponse < -planetParams.CRASH_SPEED) {
      if (debugEnabled){
        ship._landingDebug = {
          source: "planet",
          reason: "planet_crash",
          vn: vnResponse,
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
      vn: vnResponse,
      vt: ship.vx * (-impactNormal.ny) + ship.vy * impactNormal.nx,
      airFront: impactAirFront,
      airBack: impactAirBack,
      supportDist: Math.hypot(impactX - probeX, impactY - probeY),
      landable: supportLandable,
    };
    const landVt = Math.max(0, Number(game.LAND_MAX_TANGENT_SPEED) || 0);
    const controlTangentAccel = Number.isFinite(controlAccelX) && Number.isFinite(controlAccelY)
      ? (controlAccelX * (-impactNormal.ny) + controlAccelY * impactNormal.nx)
      : 0;
    const tangentThrustReinforcing = !!thrustInputActive
      && Math.abs(landingInfo.vt) > 0.05
      && Math.abs(controlTangentAccel) > 0.05
      && Math.sign(controlTangentAccel) === Math.sign(landingInfo.vt);
    let landingSupportRatio = 1;
    const flightDbg = ship._debugFlightInput || null;
    const impactRelX = impactX - ship.x;
    const impactRelY = impactY - ship.y;
    const supportRelX = supportX - ship.x;
    const supportRelY = supportY - ship.y;
    const impactContactsDiag = debugEnabled ? contacts.slice(0, 8).map((c) => ({
      pointIndex: c.pointIndex,
      t: c.t,
      entryVn: c.entryVn,
      x: c.x,
      y: c.y,
      nx: c.nx,
      ny: c.ny,
    })) : null;
    if (shipCollisionPointsAt){
      const supportPts = shipCollisionPointsAt(ship.x, ship.y);
      const supportBand = [];
      let bestDownness = -Infinity;
      const supportCheckNormal = bestUnderNormal || (contactImpact ? impactNormal : { nx: shipUpX, ny: shipUpY });
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
        const airFront = collision.planetAirValueAtWorld(
          p.x + supportCheckNormal.nx * clearOutside,
          p.y + supportCheckNormal.ny * clearOutside
        );
        const airBack = collision.planetAirValueAtWorld(
          p.x - supportCheckNormal.nx * clearInside,
          p.y - supportCheckNormal.ny * clearInside
        );
        if (airFront > 0.5 && airBack <= 0.52){
          supportCount++;
        }
      }
      landingSupportRatio = supportTotal > 0 ? (supportCount / supportTotal) : 0;
    }
    /** @type {{source:string,reason:string,dotUp:number,slope:number,landSlope:number,vn:number,vt:number,speed:number,airFront:number,airBack:number,landable:boolean,landed:boolean,support:boolean,supportDist:number,contactsCount:number,bestDotUpAny:number,bestDotUpUnder:number,impactPoint:number,supportPoint:number,impactT:number,supportT:number,impactX:number,impactY:number,supportX:number,supportY:number,impactNormalX?:number,impactNormalY?:number,shipX?:number,shipY?:number,shipVx?:number,shipVy?:number,shipStartX?:number,shipStartY?:number,shipEndX?:number,shipEndY?:number,impactRelX?:number,impactRelY?:number,supportRelX?:number,supportRelY?:number,inputLeft?:boolean,inputRight?:boolean,inputThrust?:boolean,inputDown?:boolean,inputStickX?:number,inputStickY?:number,inputAccelX?:number,inputAccelY?:number,inputGravityX?:number,inputGravityY?:number,impactEdges?:Array<{ax:number,ay:number,bx:number,by:number,nx:number,ny:number,d2:number,u:number,preferVn:number,fallbackDot:number,chosen:boolean}>|null,impactContacts?:Array<{pointIndex:number,t:number,entryVn:number,x:number,y:number,nx:number,ny:number}>|null,supportRatio?:number,overlapBeforeCount?:number,overlapAfterCount?:number,overlapBeforeMin?:number,overlapAfterMin?:number,depenPush?:number,depenIter?:number,depenCleared?:boolean}|null} */
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
      impactNormalX: impactNormal.nx,
      impactNormalY: impactNormal.ny,
      shipX: ship.x,
      shipY: ship.y,
      shipVx: ship.vx,
      shipVy: ship.vy,
      shipStartX: Number.isFinite(shipStartX) ? Number(shipStartX) : Number.NaN,
      shipStartY: Number.isFinite(shipStartY) ? Number(shipStartY) : Number.NaN,
      shipEndX: Number.isFinite(shipEndX) ? Number(shipEndX) : Number.NaN,
      shipEndY: Number.isFinite(shipEndY) ? Number(shipEndY) : Number.NaN,
      impactRelX,
      impactRelY,
      supportRelX,
      supportRelY,
      inputLeft: !!(flightDbg && flightDbg.left),
      inputRight: !!(flightDbg && flightDbg.right),
      inputThrust: !!(flightDbg && flightDbg.thrust),
      inputDown: !!(flightDbg && flightDbg.down),
      inputStickX: Number.isFinite(flightDbg && flightDbg.stickX) ? Number(flightDbg && flightDbg.stickX) : Number.NaN,
      inputStickY: Number.isFinite(flightDbg && flightDbg.stickY) ? Number(flightDbg && flightDbg.stickY) : Number.NaN,
      inputAccelX: Number.isFinite(flightDbg && flightDbg.accelX) ? Number(flightDbg && flightDbg.accelX) : Number.NaN,
      inputAccelY: Number.isFinite(flightDbg && flightDbg.accelY) ? Number(flightDbg && flightDbg.accelY) : Number.NaN,
      inputGravityX: Number.isFinite(flightDbg && flightDbg.gravityX) ? Number(flightDbg && flightDbg.gravityX) : Number.NaN,
      inputGravityY: Number.isFinite(flightDbg && flightDbg.gravityY) ? Number(flightDbg && flightDbg.gravityY) : Number.NaN,
      impactEdges: contactImpact && contactImpact.normalDiag ? contactImpact.normalDiag.segments : null,
      impactContacts: impactContactsDiag,
      supportRatio: landingSupportRatio,
    } : null;

    if (
      landingInfo.landable
      && !tangentThrustReinforcing
      && landingSupportRatio >= 0.5
      && landingInfo.vn >= -planetParams.LAND_SPEED
      && Math.abs(landingInfo.vt) <= landVt
      && speedAbs <= (planetParams.LAND_SPEED + 0.2)
    ){
      if (landingDbg){
        landingDbg.reason = "planet_landed";
        landingDbg.landed = true;
        landingDbg.landable = true;
        ship._landingDebug = landingDbg;
      }
      ship.state = "landed";
      ship.vx = 0;
      ship.vy = 0;
      return;
    }

    const wallFriction = Number.isFinite(planetParams.WALL_FRICTION)
      ? Math.max(0, Number(planetParams.WALL_FRICTION))
      : Math.max(0, Number(planetParams.LAND_FRICTION) || 0);
    const tx = -impactNormal.ny;
    const ty = impactNormal.nx;
    const responseStartOverlap = shipCollidesAt(ship.x, ship.y);
    if (vnResponse < 0){
      if (responseStartOverlap){
        const vnNow = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
        if (vnNow < 0){
          ship.vx -= impactNormal.nx * vnNow;
          ship.vy -= impactNormal.ny * vnNow;
        }
      } else {
        const vtImpact = ship.vx * tx + ship.vy * ty;
        const damp = wallFriction > 0
          ? Math.max(0, 1 - wallFriction * 0.45 * Math.max(0, dt))
          : 1;
        const vtDamped = vtImpact * damp;
        // Project velocity onto the wall tangent instead of reflecting it so
        // contact removes inward speed but preserves slide along the surface.
        ship.vx = tx * vtDamped;
        ship.vy = ty * vtDamped;
        ship.x += impactNormal.nx * Math.max(0.002, shipRadius * 0.02);
        ship.y += impactNormal.ny * Math.max(0.002, shipRadius * 0.02);
      }
      if (landingDbg){
        landingDbg.reason = responseStartOverlap ? "planet_clip" : "planet_slide";
        landingDbg.vn = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
        landingDbg.vt = ship.vx * (-impactNormal.ny) + ship.vy * impactNormal.nx;
      }
    } else {
      if (Number.isFinite(shipEndX) && Number.isFinite(shipEndY)){
        const attemptedBlocked = shipCollidesAt(Number(shipEndX), Number(shipEndY));
        if (!landingInfo.landable && attemptedBlocked){
          const startX = ship.x;
          const startY = ship.y;
          const remainDx = Number(shipEndX) - startX;
          const remainDy = Number(shipEndY) - startY;
          const intoDist = remainDx * impactNormal.nx + remainDy * impactNormal.ny;
          const slideDist = (Number(shipEndX) - startX) * tx + (Number(shipEndY) - startY) * ty;
          if (
            intoDist < -1e-6
            && Math.abs(slideDist) > Math.max(1e-6, Math.abs(intoDist))
          ){
            const targetX = startX + tx * slideDist;
            const targetY = startY + ty * slideDist;
            if (!shipCollidesAt(targetX, targetY)){
              ship.x = targetX;
              ship.y = targetY;
            } else {
              let lo = 0;
              let hi = 1;
              for (let b = 0; b < 14; b++){
                const mid = (lo + hi) * 0.5;
                const mx = startX + tx * slideDist * mid;
                const my = startY + ty * slideDist * mid;
                if (shipCollidesAt(mx, my)){
                  hi = mid;
                } else {
                  lo = mid;
                }
              }
              ship.x = startX + tx * slideDist * lo;
              ship.y = startY + ty * slideDist * lo;
            }
          }
        }
      }
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
    let depenPasses = 0;
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
      depenPasses = depNow.push > 0 ? 1 : 0;
      overlapAfter = shipCollidesAt(ship.x, ship.y);
      const vnNow = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
      if (vnNow < 0){
        ship.vx -= impactNormal.nx * vnNow;
        ship.vy -= impactNormal.ny * vnNow;
      }
      if (overlapAfter && shipCollisionPointsAt){
        const preStabilizeX = ship.x;
        const preStabilizeY = ship.y;
        stabilizePlanetPenetration({
          ship,
          collision,
          planet,
          collisionEps: eps,
          shipCollisionPointsAt,
          shipRadius: () => shipRadius,
        }, 6);
        overlapAfter = shipCollidesAt(ship.x, ship.y);
        depenPush += Math.hypot(ship.x - preStabilizeX, ship.y - preStabilizeY);
        depenCleared = depenCleared || !overlapAfter;
        depenPasses++;
      }
    }
    if (
      vnResponse >= 0
      && !overlapAfter
    ){
      const vnNow = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
      if (vnNow < 0){
        ship.vx -= impactNormal.nx * vnNow;
        ship.vy -= impactNormal.ny * vnNow;
      }
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
      landingDbg.depenIter = depenPasses;
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

    const fieldNormal = sampleGradientNormal(
      (x, y) => collision.planetAirValueAtWorld(x, y),
      eps,
      ship.x,
      ship.y,
      planetHit.x,
      planetHit.y
    );
    let nxField = fieldNormal.nx;
    let nyField = fieldNormal.ny;
    const tri = planet.radial.findTriAtWorld(planetHit.x, planetHit.y);
    const nTri = triAirNormalFromTri(/** @type {Array<{x:number,y:number,air:number}>|null} */ (tri), nxField, nyField);
    let nx = nTri.nx;
    let ny = nTri.ny;

    const orientProbe = Math.max(0.03, eps * 0.5);
    const airFront = collision.planetAirValueAtWorld(
      planetHit.x + nx * orientProbe,
      planetHit.y + ny * orientProbe
    );
    const airBack = collision.planetAirValueAtWorld(
      planetHit.x - nx * orientProbe,
      planetHit.y - ny * orientProbe
    );
    if (airBack > airFront){
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

