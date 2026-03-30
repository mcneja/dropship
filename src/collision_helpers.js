/**
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} px
 * @param {number} py
 * @returns {{x:number,y:number,u:number,d2:number}}
 */
export function closestPointOnSegment(ax, ay, bx, by, px, py){
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
export function convexPolysOverlap(a, b){
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
 * @param {(x:number,y:number)=>Array<[number, number]>} hullPointsAt
 * @param {number} x
 * @param {number} y
 * @param {(x:number,y:number)=>number} airAt
 * @param {number} [eps]
 * @returns {Array<{x:number,y:number,nx:number,ny:number,av:number}>}
 */
export function extractHullBoundaryContacts(hullPointsAt, x, y, airAt, eps = 0.03){
  const hull = hullPointsAt(x, y);
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
 * @param {(x:number,y:number)=>number} sample
 * @param {number} eps
 * @param {number} shipX
 * @param {number} shipY
 * @param {number} cx
 * @param {number} cy
 * @returns {{nx:number,ny:number}}
 */
export function sampleGradientNormal(sample, eps, shipX, shipY, cx, cy){
  let nx = sample(cx + eps, cy) - sample(cx - eps, cy);
  let ny = sample(cx, cy + eps) - sample(cx, cy - eps);
  let nLen = Math.hypot(nx, ny);
  if (nLen < 1e-4){
    nx = shipX - cx;
    ny = shipY - cy;
    nLen = Math.hypot(nx, ny);
  }
  if (nLen < 1e-4){
    nx = shipX;
    ny = shipY;
    nLen = Math.hypot(nx, ny) || 1;
  }
  return { nx: nx / nLen, ny: ny / nLen };
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
export function depenetrateAlongNormal(x, y, nx, ny, collidesAt, maxPush, startPush){
  const nLen = Math.hypot(nx, ny) || 1;
  const ux = nx / nLen;
  const uy = ny / nLen;
  let lo = 0;
  let hi = Math.max(1e-3, startPush);
  while (hi < maxPush && collidesAt(x + ux * hi, y + uy * hi)){
    lo = hi;
    hi *= 2;
  }
  hi = Math.min(hi, maxPush);
  if (collidesAt(x + ux * hi, y + uy * hi)){
    return { x: x + ux * hi, y: y + uy * hi, push: hi, cleared: false };
  }
  for (let i = 0; i < 14; i++){
    const mid = (lo + hi) * 0.5;
    if (collidesAt(x + ux * mid, y + uy * mid)){
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return { x: x + ux * hi, y: y + uy * hi, push: hi, cleared: true };
}

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
 * @param {import("./types.d.js").CollisionQuery} collision
 * @param {(x:number,y:number)=>Array<[number, number]>} pointsAt
 * @param {number} x
 * @param {number} y
 * @param {boolean} [includeCenter]
 * @returns {{samples:Array<[number, number, boolean, number]>, hit:import("./types.d.js").CollisionHit|null, hitSource:"mothership"|"planet"|null}}
 */
export function sampleBodyCollisionAt(collision, pointsAt, x, y, includeCenter = true){
  const pts = pointsAt(x, y);
  if (includeCenter){
    pts.push([x, y]);
  }
  return collision.sampleCollisionPoints(pts);
}
