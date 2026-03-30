// @ts-check

/** @typedef {import("./planet.js").Planet} Planet */

/**
 * @param {Planet} planet
 * @param {number} shipX
 * @param {number} shipY
 * @returns {Float32Array|undefined}
 */
export function updateFog(planet, shipX, shipY){
  planet.radial.updateFog(shipX, shipY);
  return planet.radial.fogAlpha();
}

/**
 * @param {Planet} planet
 * @param {number} shipX
 * @param {number} shipY
 * @returns {Float32Array|undefined}
 */
export function updateFogForRender(planet, shipX, shipY){
  return updateFog(planet, shipX, shipY);
}

/**
 * @param {Planet} planet
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function fogVisibleAt(planet, x, y){
  return planet.radial.fogVisibleAt(x, y);
}

/**
 * @param {Planet} planet
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function fogSeenAt(planet, x, y){
  return planet.radial.fogSeenAt(x, y);
}

/**
 * @param {Planet} planet
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function fogAlphaAtWorld(planet, x, y){
  return planet.radial.fogAlphaAtWorld(x, y);
}

/**
 * @param {Planet} planet
 * @returns {boolean}
 */
export function hasSeenCoreOverlay(planet){
  const coreR = planet.getCoreRadius();
  if (!(coreR > 0)) return false;
  const params = planet.getPlanetParams();
  const moltenOuter = params && typeof params.MOLTEN_RING_OUTER === "number"
    ? params.MOLTEN_RING_OUTER
    : 0;
  return planet.radial.hasSeenCoreOverlay(coreR, moltenOuter);
}

/**
 * @param {Planet} planet
 * @param {{updateFog:(fog:Float32Array)=>void}} renderer
 * @param {number} shipX
 * @param {number} shipY
 * @returns {void}
 */
export function syncRenderFog(planet, renderer, shipX, shipY){
  const fog = updateFogForRender(planet, shipX, shipY);
  if (fog) renderer.updateFog(fog);
}

/**
 * @param {Planet} planet
 * @param {{updateFog:(fog:Float32Array)=>void}} renderer
 * @param {number} shipX
 * @param {number} shipY
 * @returns {void}
 */
export function primeRenderFog(planet, renderer, shipX, shipY){
  const fog = planet.radial.primeFog(shipX, shipY);
  if (fog) renderer.updateFog(fog);
}
