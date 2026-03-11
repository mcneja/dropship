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
    /** @type {"mothership"|"planet"|null} */
    let hitSource = null;
    for (const [x, y] of points){
      const sample = sampleAtWorld(x, y);
      const av = sample.air;
      const air = av > 0.5;
      samples.push([x, y, air, av]);
      if (!air && !hit){
        hit = { x, y };
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
