// @ts-check

import { mothershipAirAtWorld } from "./mothership.js";
import { findMothershipCollisionExactAtPose, resolveMothershipCollisionResponse } from "./collision_mothership.js";
import { findPlanetCollisionExactAt, resolvePlanetCollisionResponse, stabilizePlanetPenetration } from "./collision_planet.js";

/**
 * @typedef {Object} CollisionResponseArgs
 * @property {import("./types.d.js").Ship} ship
 * @property {import("./types.d.js").CollisionQuery} collision
 * @property {import("./planet.js").Planet} planet
 * @property {import("./mothership.js").Mothership|null} mothership
 * @property {{CRASH_SPEED:number,LAND_SPEED:number,LAND_FRICTION:number}} planetParams
 * @property {{SURFACE_DOT:number,BOUNCE_RESTITUTION:number,MOTHERSHIP_FRICTION:number,MOTHERSHIP_RESTITUTION:number,LAND_SPEED:number}} game
 * @property {number} dt
 * @property {number} eps
 * @property {boolean} [debugEnabled]
 * @property {number} shipRadius
 * @property {(x:number,y:number)=>boolean} shipCollidesAt
 * @property {(x:number,y:number)=>boolean} [shipCollidesMothershipAt]
 * @property {Array<[number,number]>} [shipLocalConvexHull]
 * @property {(x:number,y:number)=>Array<[number,number]>} [shipCollisionPointsAt]
 * @property {number} [mothershipAngularVel]
 * @property {{x:number,y:number,angle:number}|null} [mothershipPrevPose]
 * @property {number} [shipStartX]
 * @property {number} [shipStartY]
 * @property {number} [shipEndX]
 * @property {number} [shipEndY]
 * @property {Array<[number,number]>} [prevPoints]
 * @property {Array<[number,number]>} [currPoints]
 * @property {()=>void} onCrash
 * @property {()=>boolean} isDockedWithMothership
 * @property {()=>void} onSuccessfullyDocked
 */

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
 * @returns {{samples:Array<[number, number, boolean, number]>, hit:import("./types.d.js").CollisionHit|null, hitSource:"mothership"|"planet"|null}}
 */
export function sampleBodyCollisionAt(collision, pointsAt, x, y, includeCenter = true){
  const pts = pointsAt(x, y);
  if (includeCenter){
    pts.push([x, y]);
  }
  return collision.sampleCollisionPoints(pts);
}

/**
 * @param {CollisionResponseArgs} args
 * @returns {void}
 */
export function resolveCollisionResponse(args){
  const hit = args && args.ship ? args.ship._collision : null;
  if (!hit) return;
  if (hit.source === "mothership" && args.mothership){
    resolveMothershipCollisionResponse(/** @type {Parameters<typeof resolveMothershipCollisionResponse>[0]} */ (args));
    return;
  }
  resolvePlanetCollisionResponse(/** @type {Parameters<typeof resolvePlanetCollisionResponse>[0]} */ (args));
}

export { stabilizePlanetPenetration };

/**
 * @typedef {Object} CollisionExactCtx
 * @property {import("./planet.js").Planet} planet
 * @property {import("./mothership.js").Mothership|null} mothership
 * @property {import("./types.d.js").CollisionQuery} collision
 * @property {number} collisionEps
 * @property {()=>number} shipRadius
 * @property {(x:number,y:number)=>Array<[number,number]>} shipConvexHullWorldVertices
 */

/**
 * @param {CollisionExactCtx} ctx
 * @param {number} x
 * @param {number} y
 * @returns {{hit:import("./types.d.js").CollisionHit, hitSource:"planet"|"mothership"}|null}
 */
export function findCollisionExactAt(ctx, x, y){
  const mothershipHit = findMothershipCollisionExactAtPose(ctx, x, y, ctx.mothership);
  const planetHit = findPlanetCollisionExactAt(ctx, x, y);
  if (mothershipHit && planetHit){
    const dm2 = (mothershipHit.x - x) * (mothershipHit.x - x) + (mothershipHit.y - y) * (mothershipHit.y - y);
    const dp2 = (planetHit.x - x) * (planetHit.x - x) + (planetHit.y - y) * (planetHit.y - y);
    return (dm2 <= dp2)
      ? { hit: mothershipHit, hitSource: "mothership" }
      : { hit: planetHit, hitSource: "planet" };
  }
  if (mothershipHit) return { hit: mothershipHit, hitSource: "mothership" };
  if (planetHit) return { hit: planetHit, hitSource: "planet" };
  return null;
}

/**
 * @param {CollisionExactCtx} ctx
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} stepLen
 * @param {number} maxSteps
 * @returns {{x:number,y:number,hit:import("./types.d.js").CollisionHit,hitSource:"planet"|"mothership"}|null}
 */
export function findFirstCollisionOnSegmentExact(ctx, x0, y0, x1, y1, stepLen, maxSteps){
  const dx = x1 - x0;
  const dy = y1 - y0;
  const travel = Math.hypot(dx, dy);
  if (travel < 1e-6) return null;

  const start = findCollisionExactAt(ctx, x0, y0);
  if (start){
    return { x: x0, y: y0, hit: start.hit, hitSource: start.hitSource };
  }

  const step = Math.max(1e-3, stepLen || 0.08);
  const steps = Math.max(2, Math.min(maxSteps | 0, Math.ceil(travel / step) + 1));
  let tPrev = 0;
  for (let i = 1; i < steps; i++){
    const t = i / (steps - 1);
    const sx = x0 + dx * t;
    const sy = y0 + dy * t;
    const cur = findCollisionExactAt(ctx, sx, sy);
    if (!cur){
      tPrev = t;
      continue;
    }
    let lo = tPrev;
    let hi = t;
    /** @type {{hit:import("./types.d.js").CollisionHit, hitSource:"planet"|"mothership"}|null} */
    let hiHit = cur;
    for (let b = 0; b < 9; b++){
      const mid = (lo + hi) * 0.5;
      const mx = x0 + dx * mid;
      const my = y0 + dy * mid;
      const midHit = findCollisionExactAt(ctx, mx, my);
      if (midHit){
        hi = mid;
        hiHit = midHit;
      } else {
        lo = mid;
      }
    }
    if (!hiHit) return null;
    return {
      x: x0 + dx * lo,
      y: y0 + dy * lo,
      hit: hiHit.hit,
      hitSource: hiHit.hitSource,
    };
  }
  return null;
}

export { findMothershipCollisionExactAtPose, findPlanetCollisionExactAt };

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
 * @returns {{x:number,y:number,samples:Array<[number, number, boolean, number]>,hit:import("./types.d.js").CollisionHit,hitSource:"mothership"|"planet"|null}|null}
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
    /** @type {{samples:Array<[number, number, boolean, number]>, hit:import("./types.d.js").CollisionHit|null, hitSource:"mothership"|"planet"|null}} */
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
 * @param {import("./planet.js").Planet} planet
 * @param {()=>import("./mothership.js").Mothership|null} getMothership
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
   * @returns {{samples:Array<[number, number, boolean, number]>, hit:import("./types.d.js").CollisionHit|null, hitSource:"mothership"|"planet"|null}}
   */
  function sampleCollisionPoints(points){
    /** @type {Array<[number, number, boolean, number]>} */
    const samples = [];
    let hit = null;
    // Pick the boundary-nearest colliding sample (largest av <= 0.5), not the
    // deepest penetration sample. This yields stable contact normals.
    let hitBoundaryAv = -Infinity;
    /** @type {"mothership"|"planet"|null} */
    let hitSource = null;
    for (const [x, y] of points){
      const sample = sampleAtWorld(x, y);
      const av = sample.air;
      const air = av > 0.5;
      samples.push([x, y, air, av]);
      if (!air && av > hitBoundaryAv){
        hit = { x, y };
        hitBoundaryAv = av;
        hitSource = sample.source;
      }
    }
    return { samples, hit, hitSource };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  function airValueAtWorld(x, y){
    return sampleAtWorld(x, y).air;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{x:number,y:number}}
   */
  function gravityAt(x, y){
    return planet.gravityAt(x, y);
  }

  /**
   * @param {Array<[number, number]>} points
   * @returns {boolean}
   */
  function collidesAtPoints(points){
    for (const [x, y] of points){
      if (sampleAtWorld(x, y).air <= 0.5) return true;
    }
    return false;
  }

  return {
    airValueAtWorld,
    planetAirValueAtWorld,
    gravityAt,
    sampleAtWorld,
    collidesAtPoints,
    sampleCollisionPoints,
  };
}
