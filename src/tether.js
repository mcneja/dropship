// @ts-check
/** @typedef {import("./game.js").Game} Game */

import * as factories from "./factories.js";
import * as levels from "./levels.js";
import * as mechanized from "./mechanized.js";
import * as meltdown from "./meltdown.js";

/**
 * @param {Game} game
 * @returns {Array<any>}
 */
export function tetherPropsAlive(game){
  /** @type {Array<any>} */
  const out = [];
  if (!game.planet || !game.planet.props || !game.planet.props.length) return out;
  for (const p of game.planet.props){
    if (p.type !== "tether") continue;
    if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
    out.push(p);
  }
  return out;
}

/**
 * @param {Game} game
 * @returns {Array<any>}
 */
export function tetherPropsAll(game){
  /** @type {Array<any>} */
  const out = [];
  if (!game.planet || !game.planet.props || !game.planet.props.length) return out;
  for (const p of game.planet.props){
    if (p.type === "tether") out.push(p);
  }
  return out;
}

/**
 * @param {Game} game
 * @param {any} tether
 * @returns {boolean}
 */
export function isTetherUnlocked(game, tether){
  if (!tether) return false;
  const protectedBy = (typeof tether.protectedBy === "number") ? tether.protectedBy : -1;
  if (protectedBy < 0) return true;
  const factory = factories.findFactoryById(game, protectedBy);
  if (!factory) return true;
  if (factory.dead) return true;
  if (typeof factory.hp === "number" && factory.hp <= 0) return true;
  return false;
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function syncTetherProtectionStates(game){
  const tethers = tetherPropsAll(game);
  if (!tethers.length) return;
  for (const t of tethers){
    t.locked = !isTetherUnlocked(game, t);
  }
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {boolean}
 */
export function destroyTethersAt(game, x, y, radius){
  if (!levels.isMechanizedCoreLevel(game)) return false;
  const tethers = tetherPropsAlive(game);
  if (!tethers.length) return false;
  let destroyed = false;
  for (const t of tethers){
    if (!isTetherUnlocked(game, t)) continue;
    if (!mechanized.solidPropPenetration(game, t, x, y, radius)) continue;
    t.dead = true;
    t.hp = 0;
    destroyed = true;
    const blastR = Math.max(0.5, (typeof t.halfLength === "number" ? t.halfLength : 0.9) * 0.35);
    game.entityExplosions.push({ x: t.x, y: t.y, life: 0.75, radius: blastR });
  }
  if (destroyed && tetherPropsAlive(game).length <= 0){
    meltdown.startCoreMeltdown(game);
  }
  return destroyed;
}

/**
 * @param {Game} game
 * @param {any} tether
 * @param {number} [duration]
 * @returns {void}
 */
export function flashTether(game, tether, duration = 0.18){
  if (!tether || tether.type !== "tether" || tether.dead) return;
  tether.flashT = Math.max((typeof tether.flashT === "number") ? tether.flashT : 0, duration);
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function updateTetherFlash(game, dt){
  if (!(dt > 0) || !levels.isMechanizedLevel(game)) return;
  const tethers = tetherPropsAll(game);
  for (const tether of tethers){
    if (typeof tether.flashT !== "number" || tether.flashT <= 0) continue;
    tether.flashT = Math.max(0, tether.flashT - dt);
  }
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function update(game, dt){
  syncTetherProtectionStates(game);
  updateTetherFlash(game, dt);
}


