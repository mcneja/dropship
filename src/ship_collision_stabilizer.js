// @ts-check

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

    let nx = collision.planetAirValueAtWorld(planetHit.x + eps, planetHit.y)
      - collision.planetAirValueAtWorld(planetHit.x - eps, planetHit.y);
    let ny = collision.planetAirValueAtWorld(planetHit.x, planetHit.y + eps)
      - collision.planetAirValueAtWorld(planetHit.x, planetHit.y - eps);
    let nlen = Math.hypot(nx, ny);
    if (nlen < 1e-4){
      nx = ship.x - planetHit.x;
      ny = ship.y - planetHit.y;
      nlen = Math.hypot(nx, ny);
    }
    if (nlen < 1e-4){
      const rr = Math.hypot(ship.x, ship.y) || 1;
      nx = ship.x / rr;
      ny = ship.y / rr;
      nlen = 1;
    }
    nx /= nlen;
    ny /= nlen;

    const r = Math.hypot(ship.x, ship.y) || 1;
    const upx = ship.x / r;
    const upy = ship.y / r;
    if (nx * upx + ny * upy < 0){
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

    const vn = ship.vx * nx + ship.vy * ny;
    if (vn < 0){
      ship.vx -= nx * vn;
      ship.vy -= ny * vn;
    }
    const vInward = -(ship.vx * upx + ship.vy * upy);
    if (vInward > 0){
      ship.vx += upx * vInward;
      ship.vy += upy * vInward;
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
