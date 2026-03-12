// @ts-check

import { mothershipAirAtWorld } from "./mothership.js";

/**
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function isAir(mesh, x, y){
  return mesh.airValueAtWorld(x, y) > 0.5;
}

/**
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {Array<[number, number]>} points
 * @returns {boolean}
 */
export function collidesAtWorldPoints(mesh, points){
  for (const [x, y] of points){
    if (mesh.airValueAtWorld(x, y) <= 0.5) return true;
  }
  return false;
}

/**
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {number} x
 * @param {number} y
 * @param {Array<[number, number]>} offsets
 * @returns {boolean}
 */
export function collidesAtOffsets(mesh, x, y, offsets){
  for (const [dx, dy] of offsets){
    if (mesh.airValueAtWorld(x + dx, y + dy) <= 0.5) return true;
  }
  return false;
}

/**
 * Sample collision at body pose using local/world sample points.
 * Adds center point by default.
 * @param {import("./types.d.js").CollisionQuery} collision
 * @param {(x:number,y:number)=>Array<[number, number]>} pointsAt
 * @param {number} x
 * @param {number} y
 * @param {boolean} [includeCenter]
 * @returns {{samples:Array<[number, number, boolean, number]>, hit:{x:number,y:number}|null, hitSource:"mothership"|"planet"|null}}
 */
export function sampleBodyCollisionAt(collision, pointsAt, x, y, includeCenter = true){
  const pts = pointsAt(x, y);
  if (includeCenter){
    pts.push([x, y]);
  }
  return collision.sampleCollisionPoints(pts);
}

/**
 * Swept collision sampling along a segment.
 * Returns body position at last non-colliding point plus collision sample data.
 * @param {import("./types.d.js").CollisionQuery} collision
 * @param {(x:number,y:number)=>Array<[number, number]>} pointsAt
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} stepLen
 * @param {number} [maxSteps]
 * @param {boolean} [includeCenter]
 * @returns {{x:number,y:number,samples:Array<[number, number, boolean, number]>,hit:{x:number,y:number},hitSource:"mothership"|"planet"|null}|null}
 */
export function firstBodyCollisionOnSegment(collision, pointsAt, x0, y0, x1, y1, stepLen, maxSteps = 14, includeCenter = true){
  const dx = x1 - x0;
  const dy = y1 - y0;
  const travel = Math.hypot(dx, dy);
  if (travel < 1e-6) return null;

  const start = sampleBodyCollisionAt(collision, pointsAt, x0, y0, includeCenter);
  if (start.hit){
    return {
      x: x0,
      y: y0,
      samples: start.samples,
      hit: start.hit,
      hitSource: start.hitSource,
    };
  }

  const step = Math.max(1e-3, stepLen || 0.08);
  const steps = Math.max(2, Math.min(maxSteps | 0, Math.ceil(travel / step) + 1));
  let tPrev = 0;
  for (let i = 1; i < steps; i++){
    const t = i / (steps - 1);
    const sx = x0 + dx * t;
    const sy = y0 + dy * t;
    const cur = sampleBodyCollisionAt(collision, pointsAt, sx, sy, includeCenter);
    if (!cur.hit){
      tPrev = t;
      continue;
    }
    let lo = tPrev; // guaranteed free
    let hi = t; // guaranteed colliding
    /** @type {{samples:Array<[number, number, boolean, number]>, hit:{x:number,y:number}|null, hitSource:"mothership"|"planet"|null}} */
    let hiSample = cur;
    for (let b = 0; b < 9; b++){
      const mid = (lo + hi) * 0.5;
      const mx = x0 + dx * mid;
      const my = y0 + dy * mid;
      const midSample = sampleBodyCollisionAt(collision, pointsAt, mx, my, includeCenter);
      if (midSample.hit){
        hi = mid;
        hiSample = midSample;
      } else {
        lo = mid;
      }
    }
    if (!hiSample.hit) return null;
    // Keep ship pose at last known-free point to avoid deep frame-over-frame
    // interpenetration when colliding with thin/steep ceilings.
    const safeSample = sampleBodyCollisionAt(
      collision,
      pointsAt,
      x0 + dx * lo,
      y0 + dy * lo,
      includeCenter
    );
    return {
      x: x0 + dx * lo,
      y: y0 + dy * lo,
      samples: safeSample.samples,
      hit: hiSample.hit,
      hitSource: hiSample.hitSource,
    };
  }
  return null;
}

/**
 * Normal from a triangle's barycentric air interpolation gradient.
 * Falls back to provided normal when triangle/gradient is degenerate.
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
 * @param {Object} args
 * @param {import("./types.d.js").Ship} args.ship
 * @param {import("./types.d.js").CollisionQuery} args.collision
 * @param {import("./planet.js").Planet} args.planet
 * @param {import("./mothership.js").Mothership|null} args.mothership
 * @param {{CRASH_SPEED:number,LAND_SPEED:number,LAND_FRICTION:number}} args.planetParams
 * @param {{SURFACE_DOT:number,BOUNCE_RESTITUTION:number,MOTHERSHIP_FRICTION:number}} args.game
 * @param {number} args.dt
 * @param {number} args.eps
 * @param {number} args.shipRadius
 * @param {(x:number,y:number)=>boolean} args.shipCollidesAt
 * @param {Array<[number,number]>} [args.prevPoints]
 * @param {Array<[number,number]>} [args.currPoints]
 * @param {()=>void} args.onCrash
 * @param {()=>boolean} args.isDockedWithMothership
 * @param {()=>void} args.onSuccessfullyDocked
 * @returns {void}
 */
export function resolveShipCollisionResponse(args){
  const {
    ship,
    collision,
    planet,
    mothership,
    planetParams,
    game,
    dt,
    eps,
    shipRadius,
    shipCollidesAt,
    prevPoints,
    currPoints,
    onCrash,
    isDockedWithMothership,
    onSuccessfullyDocked,
  } = args;
  const hit = ship._collision;
  if (!hit) return;
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

  const mothershipHit = (hit.source === "mothership" && mothership);
  if (!mothershipHit){
    const shipR = Math.hypot(ship.x, ship.y) || 1;
    const shipUpX = ship.x / shipR;
    const shipUpY = ship.y / shipR;
    const shipTx = -shipUpY;
    const shipTy = shipUpX;

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
            const qx = cx + dir[0] * d;
            const qy = cy + dir[1] * d;
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
     * Refine a buried hull sample to the local support boundary along ship-up.
     * @param {number} x
     * @param {number} y
     * @returns {{x:number,y:number}|null}
     */
    const boundaryAlongShipUp = (x, y) => {
      const outD = Math.max(0.08, shipRadius * 0.18);
      const inD = Math.max(0.08, shipRadius * 0.18);
      let ax = x + shipUpX * outD;
      let ay = y + shipUpY * outD;
      let bx = x - shipUpX * inD;
      let by = y - shipUpY * inD;
      const aAir = collision.planetAirValueAtWorld(ax, ay);
      const bAir = collision.planetAirValueAtWorld(bx, by);
      if (!(aAir > 0.5 && bAir <= 0.5)) return null;
      for (let i = 0; i < 18; i++){
        const mx = (ax + bx) * 0.5;
        const my = (ay + by) * 0.5;
        if (collision.planetAirValueAtWorld(mx, my) > 0.5){
          ax = mx;
          ay = my;
        } else {
          bx = mx;
          by = my;
        }
      }
      return { x: bx, y: by };
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
        const b = boundaryAlongShipUp(p[0], p[1]);
        const n = b
          ? normalAtContact(b.x, b.y)
          : normalAtContact(p[0], p[1]);
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
      for (let i = 1; i < contacts.length; i++){
        const c = contacts[i];
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

    /**
     * @param {Array<{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number}>} contacts
     * @param {number} probeX
     * @param {number} probeY
     * @returns {{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number}|null}
     */
    /**
     * @param {{x:number,y:number,nx:number,ny:number}} c
     * @returns {number}
     */
    const contactDownness = (c) => {
      const rcx = c.x - ship.x;
      const rcy = c.y - ship.y;
      const rLen = Math.hypot(rcx, rcy);
      if (rLen < 1e-6) return -1;
      return (-(rcx * shipUpX + rcy * shipUpY) / rLen);
    };

    /**
     * Fit a local boundary normal at the ship underside probe using nearby
     * boundary samples along the ship tangent.
     * @param {number} probeX
     * @param {number} probeY
     * @returns {{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number,dotUp:number,airFront:number,airBack:number,leftSpan:number,rightSpan:number,maxDev:number}|null}
     */
    const localProbeSupportContact = (probeX, probeY) => {
      const span = Math.max(0.16, shipRadius * 0.48);
      const offsets = [-span, -span * 0.5, 0, span * 0.5, span];
      /** @type {Array<{o:number,x:number,y:number}>} */
      const samples = [];
      for (const o of offsets){
        const sx = probeX + shipTx * o;
        const sy = probeY + shipTy * o;
        const b = boundaryAlongShipUp(sx, sy);
        if (b){
          samples.push({ o, x: b.x, y: b.y });
        }
      }
      if (samples.length < 2) return null;

      let left = null;
      let right = null;
      let center = null;
      let centerAbs = Infinity;
      for (const s of samples){
        const ao = Math.abs(s.o);
        if (ao < centerAbs){
          centerAbs = ao;
          center = s;
        }
        if (s.o < 0 && (!left || s.o > left.o)) left = s;
        if (s.o > 0 && (!right || s.o < right.o)) right = s;
      }
      if (!left || !right) return null;

      /** @type {{o:number,x:number,y:number}} */
      let pivot = center || {
        o: 0,
        x: (left.x + right.x) * 0.5,
        y: (left.y + right.y) * 0.5,
      };
      if (!center){
        const bPivot = boundaryAlongShipUp(pivot.x, pivot.y);
        if (bPivot){
          pivot = { o: 0, x: bPivot.x, y: bPivot.y };
        }
      }

      const tdx = right.x - left.x;
      const tdy = right.y - left.y;
      const tLen = Math.hypot(tdx, tdy);
      if (tLen < 1e-6) return null;
      const txFit = tdx / tLen;
      const tyFit = tdy / tLen;
      const normals = [
        { nx: -tyFit, ny: txFit },
        { nx: tyFit, ny: -txFit },
      ];

      let best = null;
      let bestScore = -Infinity;
      const probeOut = 0.08;
      const probeIn = 0.06;
      for (const n of normals){
        const af = collision.planetAirValueAtWorld(pivot.x + n.nx * probeOut, pivot.y + n.ny * probeOut);
        const ab = collision.planetAirValueAtWorld(pivot.x - n.nx * probeIn, pivot.y - n.ny * probeIn);
        const dotUp = n.nx * shipUpX + n.ny * shipUpY;
        const boundaryOk = (af > 0.5 && ab <= 0.52) ? 1 : 0;
        const score = boundaryOk * 4.0 + (af - ab) * 2.2 + dotUp * 0.35;
        if (score > bestScore){
          bestScore = score;
          best = { nx: n.nx, ny: n.ny, dotUp, af, ab };
        }
      }
      if (!best) return null;

      let maxDev = 0;
      for (const s of samples){
        const dev = Math.abs((s.x - pivot.x) * best.nx + (s.y - pivot.y) * best.ny);
        if (dev > maxDev) maxDev = dev;
      }

      const minSideSpan = Math.max(0.06, shipRadius * 0.14);
      const flatTol = Math.max(0.03, shipRadius * 0.10);
      const leftSpan = Math.abs(left.o);
      const rightSpan = Math.abs(right.o);
      const enoughSpan = leftSpan >= minSideSpan && rightSpan >= minSideSpan;
      const flatEnough = maxDev <= flatTol;
      const boundaryEnough = (best.af > 0.5 && best.ab <= 0.52);
      if (!enoughSpan || !flatEnough || !boundaryEnough){
        return null;
      }

      const nPivot = normalAtContact(pivot.x, pivot.y);
      return {
        x: pivot.x,
        y: pivot.y,
        nx: best.nx,
        ny: best.ny,
        tri: nPivot.tri,
        t: 1,
        pointIndex: -3,
        entryVn: ship.vx * best.nx + ship.vy * best.ny,
        dotUp: best.dotUp,
        airFront: best.af,
        airBack: best.ab,
        leftSpan,
        rightSpan,
        maxDev,
      };
    };

    const pickSupportContact = (contacts, probeX, probeY) => {
      const localSupport = localProbeSupportContact(probeX, probeY);
      if (localSupport){
        return {
          x: localSupport.x,
          y: localSupport.y,
          nx: localSupport.nx,
          ny: localSupport.ny,
          tri: localSupport.tri,
          t: localSupport.t,
          pointIndex: localSupport.pointIndex,
          entryVn: localSupport.entryVn,
        };
      }

      const candidates = contacts.slice();
      const probeBoundary = boundaryAlongShipUp(probeX, probeY);
      if (probeBoundary){
        const nProbe = normalAtContact(probeBoundary.x, probeBoundary.y);
        const normCandidates = [
          [nProbe.nx, nProbe.ny],
          [-nProbe.nx, -nProbe.ny],
          [shipUpX, shipUpY],
          [-shipUpX, -shipUpY],
        ];
        let bestN = normCandidates[0];
        let bestScore = -Infinity;
        const probeOut = 0.08;
        const probeIn = 0.06;
        for (const nn of normCandidates){
          const nx = nn[0];
          const ny = nn[1];
          const front = collision.planetAirValueAtWorld(probeBoundary.x + nx * probeOut, probeBoundary.y + ny * probeOut);
          const back = collision.planetAirValueAtWorld(probeBoundary.x - nx * probeIn, probeBoundary.y - ny * probeIn);
          const dotUp = nx * shipUpX + ny * shipUpY;
          const validBoundary = (front > 0.5 && back <= 0.52) ? 1 : 0;
          const score = validBoundary * 3.0 + (front - back) * 2.0 + dotUp * 0.2;
          if (score > bestScore){
            bestScore = score;
            bestN = nn;
          }
        }
        const pnx = bestN[0];
        const pny = bestN[1];
        candidates.push({
          x: nProbe.x,
          y: nProbe.y,
          nx: pnx,
          ny: pny,
          tri: nProbe.tri,
          t: 1,
          pointIndex: -2,
          entryVn: ship.vx * pnx + ship.vy * pny,
        });
      }
      if (!candidates.length) return null;
      /** @type {Array<{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number,dotUp:number,downness:number,dProbe:number}>} */
      const underside = [];
      const maxSlopeLocal = 1 - Math.cos(Math.PI / 8); // 22.5 deg
      const landSlopeLocal = Math.min((1 - game.SURFACE_DOT) + 0.03, maxSlopeLocal);
      for (const c of candidates){
        const dotUpC = c.nx * shipUpX + c.ny * shipUpY;
        const downness = contactDownness(c);
        // Landing support must come from the lower hull hemisphere.
        if (downness < 0.12) continue;
        const dProbe = Math.hypot(c.x - probeX, c.y - probeY);
        underside.push({ ...c, dotUp: dotUpC, downness, dProbe });
      }
      if (underside.length){
        // If any current contact is already landable, pick the flattest one.
        /** @type {Array<{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number,dotUp:number,downness:number,dProbe:number}>} */
        const landableNow = [];
        for (const c of underside){
          const slopeC = Math.max(0, 1 - c.dotUp);
          if (slopeC > landSlopeLocal) continue;
          const cFront = collision.planetAirValueAtWorld(c.x + c.nx * 0.08, c.y + c.ny * 0.08);
          const cBack = collision.planetAirValueAtWorld(c.x - c.nx * 0.06, c.y - c.ny * 0.06);
          if (!(cFront > 0.5 && cBack <= 0.52)) continue;
          landableNow.push(c);
        }
        if (landableNow.length){
          let best = landableNow[0];
          for (let i = 1; i < landableNow.length; i++){
            const c = landableNow[i];
            if (c.dotUp > best.dotUp + 1e-6){
              best = c;
              continue;
            }
            if (Math.abs(c.dotUp - best.dotUp) <= 1e-6 && c.dProbe < best.dProbe){
              best = c;
            }
          }
          return best;
        }

        // Primary criterion: pick from the flattest available underside contacts.
        let bestDot = -Infinity;
        for (const c of underside){
          if (c.dotUp > bestDot) bestDot = c.dotUp;
        }
        const dotWindow = 0.05;
        /** @type {{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number,dotUp:number,downness:number,dProbe:number}|null} */
        let best = null;
        let bestScore = Infinity;
        for (const c of underside){
          if (c.dotUp + dotWindow < bestDot) continue;
          const bottomPenalty = Math.max(0, 1 - c.downness) * shipRadius * 0.35;
          const cFront = collision.planetAirValueAtWorld(c.x + c.nx * 0.08, c.y + c.ny * 0.08);
          const cBack = collision.planetAirValueAtWorld(c.x - c.nx * 0.06, c.y - c.ny * 0.06);
          const boundaryPenalty = Math.max(0, 0.5 - cFront) * shipRadius * 2.2
            + Math.max(0, cBack - 0.52) * shipRadius * 1.8;
          const score = c.dProbe + bottomPenalty + c.t * shipRadius * 0.2 + boundaryPenalty;
          if (score < bestScore){
            bestScore = score;
            best = c;
          }
        }
        if (best){
          return best;
        }
      }

      // Fallback: pick the flattest upward normal, then nearest to underside probe.
      let bestDot = -Infinity;
      let bestProbe = Infinity;
      let bestFlat = null;
      for (const c of candidates){
        const dotUpC = c.nx * shipUpX + c.ny * shipUpY;
        const dProbe = Math.hypot(c.x - probeX, c.y - probeY);
        if (dotUpC > bestDot + 1e-6){
          bestDot = dotUpC;
          bestProbe = dProbe;
          bestFlat = c;
          continue;
        }
        if (Math.abs(dotUpC - bestDot) <= 1e-6 && dProbe < bestProbe){
          bestProbe = dProbe;
          bestFlat = c;
        }
      }
      return bestFlat || pickImpactContact(candidates);
    };

    const probeX = ship.x - shipUpX * shipRadius;
    const probeY = ship.y - shipUpY * shipRadius;
    const contacts = sweepContacts();
    const contactsPose = poseContacts();
    /** @type {Array<{x:number,y:number,nx:number,ny:number,tri:Array<{x:number,y:number,air:number}>|null,t:number,pointIndex:number,entryVn:number}>} */
    const supportContacts = contactsPose.length ? contactsPose : contacts;
    const contactImpact = pickImpactContact(contacts);
    const contactSupport = pickSupportContact(supportContacts, probeX, probeY);
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

    let supportX = impactX;
    let supportY = impactY;
    let supportNormal = { nx: impactNormal.nx, ny: impactNormal.ny };
    let supportTri = impactTri;
    if (contactSupport){
      supportX = contactSupport.x;
      supportY = contactSupport.y;
      supportNormal = { nx: contactSupport.nx, ny: contactSupport.ny };
      supportTri = contactSupport.tri;
    }

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
    for (const c of supportContacts){
      const dot = c.nx * shipUpX + c.ny * shipUpY;
      if (dot > bestDotUpAny) bestDotUpAny = dot;
      if (contactDownness(c) >= 0.12 && dot > bestDotUpUnder) bestDotUpUnder = dot;
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
      ship._landingDebug = {
        source: "planet",
        reason: "crash_speed",
        vn: vnImpact,
        speed: Math.hypot(ship.vx, ship.vy),
        impactX,
        impactY,
        supportX,
        supportY,
      };
      ship.vx += (-vnImpact) * impactNormal.nx;
      ship.vy += (-vnImpact) * impactNormal.ny;
      onCrash();
      return;
    }

    const lx = supportX;
    const ly = supportY;
    const lnxRaw = supportNormal.nx;
    const lnyRaw = supportNormal.ny;
    const support = true;
    let supportDist = Math.hypot(lx - probeX, ly - probeY);
    const txRaw = -lnyRaw;
    const tyRaw = lnxRaw;
    const vnSupportRaw = ship.vx * lnxRaw + ship.vy * lnyRaw;
    const vtSupportRaw = ship.vx * txRaw + ship.vy * tyRaw;
    const speedAbs = Math.hypot(ship.vx, ship.vy);
    let lnx = lnxRaw;
    let lny = lnyRaw;
    let tx = txRaw;
    let ty = tyRaw;
    let vnSupport = vnSupportRaw;
    let vtSupport = vtSupportRaw;
    let dotUp = lnx * shipUpX + lny * shipUpY;
    let slope = Math.max(0, 1 - dotUp);

    const maxSlope = 1 - Math.cos(Math.PI / 8); // 22.5 deg
    const landSlope = Math.min((1 - game.SURFACE_DOT) + 0.03, maxSlope);
    const clearOutside = Math.max(0.12, shipRadius * 0.45);
    const clearInside = Math.max(0.10, shipRadius * 0.38);
    let airFront = collision.planetAirValueAtWorld(lx + lnx * clearOutside, ly + lny * clearOutside);
    let airBack = collision.planetAirValueAtWorld(lx - lnx * clearInside, ly - lny * clearInside);
    let landable = support && (dotUp > 0) && (slope <= landSlope) && (airFront > 0.5) && (airBack <= 0.52);
    /**
     * Landing assist is only valid for ledge/shelf-like bottoms.
     * If both tangent-side boundary probes exist and show clear slope grade,
     * reject assist so slopes keep sliding instead of sticking.
     * @param {{x:number,y:number}} b
     * @returns {boolean}
     */
    const assistShelfLike = (b) => {
      const span = Math.max(0.14, shipRadius * 0.42);
      const bL = boundaryAlongShipUp(b.x - shipTx * span, b.y - shipTy * span);
      const bR = boundaryAlongShipUp(b.x + shipTx * span, b.y + shipTy * span);
      // Ledge assist only: exactly one side should have nearby support.
      if (!!bL === !!bR) return false;
      return true;
    };
    if (!landable){
      // Landing-assist normal is classification-only (for ledge settle cases).
      // Collision response/sliding still use raw contact normals.
      const settleSpeed = speedAbs <= 0.2;
      const vnUp = ship.vx * shipUpX + ship.vy * shipUpY;
      const vtUp = ship.vx * (-shipUpY) + ship.vy * shipUpX;
      const settleMotion = Math.abs(vnUp) <= 0.18 && Math.abs(vtUp) <= 0.18;
      const pinnedContact = !!(contactImpact && Number.isFinite(contactImpact.t) && contactImpact.t <= 0.05);
      // Only allow assist when raw support looks clearly misclassified
      // (wall-like/invalid boundary), not when it's a genuine slope.
      const assistNeeded = (dotUp <= 0.35) || (airFront <= 0.42);
      if ((settleSpeed && settleMotion || pinnedContact) && assistNeeded){
        const bAssist = boundaryAlongShipUp(probeX, probeY) || boundaryAlongShipUp(lx, ly);
        if (bAssist){
          const afAssist = collision.planetAirValueAtWorld(
            bAssist.x + shipUpX * clearOutside,
            bAssist.y + shipUpY * clearOutside
          );
          const abAssist = collision.planetAirValueAtWorld(
            bAssist.x - shipUpX * clearInside,
            bAssist.y - shipUpY * clearInside
          );
          if (afAssist > 0.5 && abAssist <= 0.52 && assistShelfLike(bAssist)){
            lnx = shipUpX;
            lny = shipUpY;
            tx = -lny;
            ty = lnx;
            vnSupport = ship.vx * lnx + ship.vy * lny;
            vtSupport = ship.vx * tx + ship.vy * ty;
            dotUp = 1;
            slope = 0;
            airFront = afAssist;
            airBack = abAssist;
            supportDist = Math.hypot(bAssist.x - probeX, bAssist.y - probeY);
            landable = true;
          }
        }
      }
    }
    const landVt = Math.max(0.8, planetParams.LAND_SPEED * 0.6);
    /** @type {{source:string,reason:string,dotUp:number,slope:number,landSlope:number,vn:number,vt:number,speed:number,airFront:number,airBack:number,landable:boolean,landed:boolean,support:boolean,supportDist:number,contactsCount:number,bestDotUpAny:number,bestDotUpUnder:number,impactPoint:number,supportPoint:number,impactT:number,supportT:number,impactX:number,impactY:number,supportX:number,supportY:number,supportTriOuterCount:number,supportTriAirMin:number,supportTriAirMax:number,supportTriRMin:number,supportTriRMax:number}} */
    const landingDbg = {
      source: "planet",
      reason: "eval",
      dotUp,
      slope,
      landSlope,
      vn: vnSupport,
      vt: vtSupport,
      speed: speedAbs,
      airFront,
      airBack,
      landable,
      landed: false,
      support,
      supportDist: supportDist,
      contactsCount: supportContacts.length,
      bestDotUpAny,
      bestDotUpUnder,
      impactPoint: contactImpact ? contactImpact.pointIndex : -1,
      supportPoint: contactSupport ? contactSupport.pointIndex : -1,
      impactT: contactImpact ? contactImpact.t : Number.NaN,
      supportT: contactSupport ? contactSupport.t : Number.NaN,
      impactX,
      impactY,
      supportX,
      supportY,
      supportTriOuterCount: supportMeta ? supportMeta.outerCount : -1,
      supportTriAirMin: supportMeta ? supportMeta.airMin : Number.NaN,
      supportTriAirMax: supportMeta ? supportMeta.airMax : Number.NaN,
      supportTriRMin: supportMeta ? supportMeta.rMin : Number.NaN,
      supportTriRMax: supportMeta ? supportMeta.rMax : Number.NaN,
    };

    if (
      landable &&
      vnSupport >= -planetParams.LAND_SPEED &&
      Math.abs(vtSupport) <= landVt &&
      speedAbs <= (planetParams.LAND_SPEED + 0.2)
    ){
      landingDbg.reason = "landed";
      landingDbg.landed = true;
      ship._landingDebug = landingDbg;
      ship.state = "landed";
      ship.vx = 0;
      ship.vy = 0;
      return;
    }

    if (!landable){
      const vnImpactNow = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
      const vtImpactNow = ship.vx * (-impactNormal.ny) + ship.vy * impactNormal.nx;
      const impactDotUp = impactNormal.nx * shipUpX + impactNormal.ny * shipUpY;
      const impactCeilingLike = impactDotUp < 0.15;
      const impactFloorLike = impactDotUp > 0.35;
      const itx = -impactNormal.ny;
      const ity = impactNormal.nx;
      landingDbg.vn = vnImpactNow;
      landingDbg.vt = vtImpactNow;
      const bounceMin = Math.max(0.25, planetParams.LAND_SPEED * 0.3);
      if (vnImpactNow < -bounceMin){
        landingDbg.reason = "bounce_non_landable";
        ship._landingDebug = landingDbg;
        const restitution = (1 + game.BOUNCE_RESTITUTION) * -vnImpactNow;
        ship.vx += impactNormal.nx * restitution;
        ship.vy += impactNormal.ny * restitution;
      } else if (vnImpactNow < 0){
        landingDbg.reason = "slide_non_landable";
        ship._landingDebug = landingDbg;
        ship.vx -= impactNormal.nx * vnImpactNow;
        ship.vy -= impactNormal.ny * vnImpactNow;
        // Small outward detach bias to prevent magnet-like wall sticking.
        const detach = impactCeilingLike ? 0.06 : 0.015;
        ship.vx += impactNormal.nx * detach;
        ship.vy += impactNormal.ny * detach;
        if (impactFloorLike){
          const vnKeep = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
          const vtNow = ship.vx * itx + ship.vy * ity;
          const damp = Math.max(0, 1 - Math.max(0, planetParams.LAND_FRICTION) * 0.35 * dt);
          const vtAfter = vtNow * damp;
          ship.vx = impactNormal.nx * vnKeep + itx * vtAfter;
          ship.vy = impactNormal.ny * vnKeep + ity * vtAfter;
          landingDbg.vt = vtAfter;
        }
      } else {
        landingDbg.reason = "separate_non_landable";
        ship._landingDebug = landingDbg;
        // Already non-inward at sample time, but sustained contact on ceilings/
        // inverted walls can still cling due repeated depenetration. Enforce a
        // minimum outward component to break contact cleanly.
        if (impactCeilingLike){
          const vnNow = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
          const minOut = 0.28;
          if (vnNow < minOut){
            const dv = minOut - vnNow;
            ship.vx += impactNormal.nx * dv;
            ship.vy += impactNormal.ny * dv;
            landingDbg.vn = minOut;
          }
        } else if (impactFloorLike){
          const vnKeep = ship.vx * impactNormal.nx + ship.vy * impactNormal.ny;
          const vtNow = ship.vx * itx + ship.vy * ity;
          const damp = Math.max(0, 1 - Math.max(0, planetParams.LAND_FRICTION) * 0.25 * dt);
          const vtAfter = vtNow * damp;
          ship.vx = impactNormal.nx * vnKeep + itx * vtAfter;
          ship.vy = impactNormal.ny * vnKeep + ity * vtAfter;
          landingDbg.vt = vtAfter;
        }
      }
      return;
    }

    // Landable but not yet landed: keep contact and damp tangent.
    let vnNow = ship.vx * lnx + ship.vy * lny;
    if (vnNow < 0){
      ship.vx -= lnx * vnNow;
      ship.vy -= lny * vnNow;
      vnNow = 0;
    }
    if (landable){
      const vtNow = ship.vx * tx + ship.vy * ty;
      const damp = Math.max(0, 1 - Math.max(0, planetParams.LAND_FRICTION) * dt);
      const vtAfter = vtNow * damp;
      ship.vx = lnx * vnNow + tx * vtAfter;
      ship.vy = lny * vnNow + ty * vtAfter;
      landingDbg.reason = "settle_landable";
      landingDbg.vt = vtAfter;
      ship._landingDebug = landingDbg;
    }
    return;
  }

  const n = contactNormal((x, y) => collision.airValueAtWorld(x, y));
  const nx = n.nx;
  const ny = n.ny;
  const baseVx = mothership.vx;
  const baseVy = mothership.vy;
  let relVx = ship.vx - baseVx;
  let relVy = ship.vy - baseVy;
  const vn = relVx * nx + relVy * ny;
  const vt = relVx * -ny + relVy * nx;
  ship._landingDebug = {
    source: "mothership",
    reason: "mothership_contact",
    vn,
    vt,
    speed: Math.hypot(ship.vx, ship.vy),
    impactX: hx,
    impactY: hy,
    supportX: hx,
    supportY: hy,
  };

  if (vn < -planetParams.CRASH_SPEED) {
    onCrash();
  } else if (vn < 0) {
    const maxSlope = 1 - Math.cos(Math.PI / 8); // 22.5 deg
    const landSlope = Math.min((1 - game.SURFACE_DOT) + 0.03, maxSlope);
    const cUp = Math.cos(mothership.angle);
    const sUp = Math.sin(mothership.angle);
    const upx = -sUp;
    const upy = cUp;
    const dotUpRaw = nx * upx + ny * upy;
    const slope = 1 - Math.abs(dotUpRaw);
    const landable = (dotUpRaw < 0 && slope <= landSlope);
    const landVn = planetParams.LAND_SPEED * 3.0;
    const landVt = 1.0;
    if (!landable) {
      const restitution = (1 + game.BOUNCE_RESTITUTION) * -vn;
      relVx += restitution * nx;
      relVy += restitution * ny;
    } else if (vn >= -landVn && Math.abs(vt) < landVt){
      ship.state = "landed";
      // Nudge outward to avoid immediate re-collision bounce.
      const lift = shipRadius * 0.3;
      ship.x += nx * lift;
      ship.y += ny * lift;
      const clearStep = shipRadius * 0.2;
      for (let i = 0; i < 8 && shipCollidesAt(ship.x, ship.y); i++){
        ship.x += nx * clearStep;
        ship.y += ny * clearStep;
      }
      const dx2 = ship.x - mothership.x;
      const dy2 = ship.y - mothership.y;
      const c2 = Math.cos(-mothership.angle);
      const s2 = Math.sin(-mothership.angle);
      const lx2 = c2 * dx2 - s2 * dy2;
      const ly2 = s2 * dx2 + c2 * dy2;
      ship._dock = { lx: lx2, ly: ly2 };
      ship.vx = mothership.vx;
      ship.vy = mothership.vy;
      if (isDockedWithMothership()){
        onSuccessfullyDocked();
      }
    } else {
      const restitution = -vn;
      relVx += restitution * nx;
      relVy += restitution * ny;
      const friction = game.MOTHERSHIP_FRICTION * -vt * dt;
      relVx += friction * -ny;
      relVy += friction * nx;
      const vn2 = relVx * nx + relVy * ny;
      if (vn2 < 0){
        relVx -= nx * vn2;
        relVy -= ny * vn2;
      }
    }
  }
  if (ship.state !== "landed"){
    ship.vx = relVx + baseVx;
    ship.vy = relVy + baseVy;
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
export function stabilizeShipAgainstPlanetPenetration(ctx, maxIters = 12){
  const { ship, collision, planet } = ctx;
  const eps = Math.max(1e-3, ctx.collisionEps || 0.18);

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
      if (av > 0.5) continue;
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
    ship._collision = {
      x: refreshed.hit.x,
      y: refreshed.hit.y,
      source: refreshed.hitSource,
      tri: planet.radial.findTriAtWorld(refreshed.hit.x, refreshed.hit.y),
      node: planet.radial.nearestNodeOnRing(refreshed.hit.x, refreshed.hit.y),
    };
  } else {
    ship._collision = null;
  }
}

/**
 * Collision router for planet + mothership (and future sources).
 * @param {import("./planet.js").Planet} planet
 * @param {() => (import("./mothership.js").Mothership|null)} getMothership
 * @returns {import("./types.d.js").CollisionQuery}
 */
export function createCollisionRouter(planet, getMothership){
  /**
   * Collision-focused sampling of planet terrain only (no mothership blending).
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  function planetAirValueAtWorld(x, y){
    if (typeof planet.airValueAtWorldForCollision === "function"){
      return planet.airValueAtWorldForCollision(x, y);
    }
    return planet.airValueAtWorld(x, y);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{air:number, source:"mothership"|"planet"}}
   */
  function sampleAtWorld(x, y){
    const mothership = getMothership();
    if (mothership){
      const r = Math.hypot(x, y);
      const dPlanet = Math.abs(r - planet.planetRadius);
      const dx = x - mothership.x;
      const dy = y - mothership.y;
      const dM = Math.max(0, Math.hypot(dx, dy) - mothership.bounds);
      if (dM < dPlanet){
        const v = mothershipAirAtWorld(mothership, x, y);
        if (v !== null) return { air: v, source: "mothership" };
      }
    }
    const air = planetAirValueAtWorld(x, y);
    return { air, source: "planet" };
  }

  /**
   * @param {Array<[number, number]>} points
   * @returns {{samples:Array<[number, number, boolean, number]>, hit:{x:number,y:number}|null, hitSource:"mothership"|"planet"|null}}
   */
  function sampleCollisionPoints(points){
    /** @type {Array<[number, number, boolean, number]>} */
    const samples = [];
    let hit = null;
    let hitAv = Infinity;
    /** @type {"mothership"|"planet"|null} */
    let hitSource = null;
    for (const [x, y] of points){
      const sample = sampleAtWorld(x, y);
      const av = sample.air;
      const air = av > 0.5;
      samples.push([x, y, air, av]);
      if (!air && av < hitAv){
        hit = { x, y };
        hitAv = av;
        hitSource = sample.source;
      }
    }
    return { samples, hit, hitSource };
  }

  return {
    airValueAtWorld: (x, y) => sampleAtWorld(x, y).air,
    planetAirValueAtWorld: (x, y) => planetAirValueAtWorld(x, y),
    gravityAt: (x, y) => planet.gravityAt(x, y),
    sampleAtWorld,
    collidesAtPoints: (points) => {
      for (const [x, y] of points){
        if (sampleAtWorld(x, y).air <= 0.5) return true;
      }
      return false;
    },
    sampleCollisionPoints,
  };
}
