// @ts-check

/**
 * Fade atmosphere density from full strength at/below the terrain shell to zero above the configured height.
 * @param {{airValueAtWorld?:(x:number,y:number)=>number}|null|undefined} planet
 * @param {{ATMOSPHERE_DRAG?:number,ATMOSPHERE_HEIGHT?:number}|null|undefined} planetParams
 * @param {number} shellRadius
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function sampleAtmosphereDensity(planet, planetParams, shellRadius, x, y){
  const drag = planetParams?.ATMOSPHERE_DRAG || 0;
  if (!(drag > 0)) return 0;
  if (!planet || typeof planet.airValueAtWorld !== "function") return 0;
  if (planet.airValueAtWorld(x, y) <= 0.5) return 0;
  const r = Math.hypot(x, y);
  const shell = Math.max(0, shellRadius);
  const height = Math.max(0, planetParams?.ATMOSPHERE_HEIGHT || 0);
  if (height <= 0) return (r <= shell + 0.02) ? 1 : 0;
  const altitude = Math.max(0, r - shell);
  return Math.max(0, Math.min(1, 1 - altitude / height));
}

/**
 * Apply stable quadratic drag without flipping velocity when dt or speed spikes.
 * @param {number} vx
 * @param {number} vy
 * @param {number} dragCoeff
 * @param {number} dt
 * @returns {{vx:number, vy:number}}
 */
export function applyQuadraticVelocityDrag(vx, vy, dragCoeff, dt){
  if (!(dragCoeff > 0) || !(dt > 0)) return { vx, vy };
  const speed = Math.hypot(vx, vy);
  if (speed <= 1e-6) return { vx, vy };
  const scale = 1 / (1 + dragCoeff * speed * dt);
  return { vx: vx * scale, vy: vy * scale };
}

