// @ts-check
/** @typedef {import("./game.js").Game} Game */

import { getSupportNodeIndices } from "./terrain_support.js";
import * as levels from "./levels.js";
import * as mechanized from "./mechanized.js";
import * as missions from "./missions.js";
import * as stats from "./stats.js";
import * as weapons from "./weapons.js";
import * as tether from "./tether.js";
import * as audioState from "./audio.js";

/**
 * @param {Game} game
 * @returns {Array<any>}
 */
export function factoryPropsAlive(game){
  /** @type {Array<any>} */
  const out = [];
  if (!game.planet || !game.planet.props || !game.planet.props.length) return out;
  for (const p of game.planet.props){
    if (p.type !== "factory") continue;
    if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
    out.push(p);
  }
  return out;
}

/**
 * @param {Game} game
 * @param {number} propId
 * @returns {any|null}
 */
export function findFactoryById(game, propId){
  if (!game.planet || !game.planet.props || !game.planet.props.length) return null;
  for (const p of game.planet.props){
    if (p.type !== "factory") continue;
    if ((/** @type {number} */ (p.propId) | 0) === (propId | 0)) return p;
  }
  return null;
}

/**
 * @param {Game} game
 * @returns {{min:number,max:number}}
 */
export function factorySpawnCooldownRange(game){
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  const min = (cfg && typeof cfg.factorySpawnCooldownMin === "number") ? cfg.factorySpawnCooldownMin : 6.5;
  const max = (cfg && typeof cfg.factorySpawnCooldownMax === "number") ? cfg.factorySpawnCooldownMax : 10.5;
  const lo = Math.max(0.1, Math.min(min, max));
  const hi = Math.max(lo, Math.max(min, max));
  return { min: lo, max: hi };
}

/**
 * @param {Game} game
 * @param {{x:number,y:number,scale?:number,hitT?:number}} factory
 * @returns {void}
 */
export function applyFactoryHitFeedback(game, factory){
  factory.hitT = game.FACTORY_HIT_FLASH_T;
  game.entityExplosions.push({
    x: factory.x,
    y: factory.y,
    life: game.NONLETHAL_HIT_FLASH_LIFE,
    radius: 0.4 * (factory.scale || 1),
  });
}

/**
 * @param {Game} game
 * @param {any} p
 * @returns {number}
 */
export function factoryHitRadius(game, p){
  const s = p && p.scale ? p.scale : 1;
  return 0.42 * s;
}

/**
 * @param {Game} game
 * @param {any} p
 * @returns {void}
 */
export function destroyFactoryProp(game, p){
  if (!p || p.dead) return;
  stats.recordFactoryDestroyed(game, 1);
  p.hp = 0;
  p.dead = true;
  const s = p.scale || 1;
  game.entityExplosions.push({ x: p.x, y: p.y, life: 0.65, radius: 0.95 * s });
  weapons.spawnDebrisBurst(game, p.x, p.y, {
    pieces: 9,
    speedMin: 0.95,
    speedMax: 1.8,
    lifeMin: 0.8,
    lifeMax: 0.7,
    offset: 0.1 * s,
    spin: 7,
  });
  audioState.playSfx(game, "enemy_destroyed", {
    volume: 0.78,
    rate: 0.85 + Math.random() * 0.14,
  });
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").DestroyedTerrainNode[]} destroyedNodes
 * @returns {number}
 */
export function destroyFactoriesAttachedToTerrainNodes(game, destroyedNodes){
  if (!destroyedNodes || !destroyedNodes.length || !game.planet || !game.planet.props || !game.planet.props.length) return 0;
  const destroyedNodeIndices = new Set(destroyedNodes.map((node) => node.idx));
  let count = 0;
  for (const p of game.planet.props){
    if (!p || p.dead || p.type !== "factory") continue;
    const supportIndices = getSupportNodeIndices(p);
    if (!supportIndices.length) continue;
    let detached = false;
    for (const idx of supportIndices){
      if (destroyedNodeIndices.has(idx)){
        detached = true;
        break;
      }
    }
    if (!detached) continue;
    destroyFactoryProp(game, p);
    count++;
  }
  if (count > 0){
    tether.syncTetherProtectionStates(game);
  }
  return count;
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} [damage]
 * @param {boolean} [forceKill]
 * @returns {boolean}
 */
export function damageFactoriesAt(game, x, y, radius, damage = 1, forceKill = false){
  if (!levels.isMechanizedLevel(game)) return false;
  return damageFactoryPropsAt(game, factoryPropsAlive(game), x, y, radius, damage, forceKill);
}

/**
 * @param {Game} game
 * @param {Array<any>|null|undefined} factories
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} [damage]
 * @param {boolean} [forceKill]
 * @returns {boolean}
 */
export function damageFactoryPropsAt(game, factories, x, y, radius, damage = 1, forceKill = false){
  if (!factories || !factories.length) return false;
  let hit = false;
  let factoryDestroyed = false;
  for (const p of factories){
    if (!p || p.type !== "factory") continue;
    if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
    const rr = radius + factoryHitRadius(game, p);
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy > rr * rr) continue;
    hit = true;
    if (forceKill){
      p.hp = 0;
    } else {
      const cur = (typeof p.hp === "number") ? p.hp : 5;
      p.hp = Math.max(0, cur - Math.max(0.1, damage));
    }
    if ((p.hp || 0) <= 0){
      destroyFactoryProp(game, p);
      factoryDestroyed = true;
    } else {
      applyFactoryHitFeedback(game, p);
    }
  }
  if (factoryDestroyed){
    tether.syncTetherProtectionStates(game);
  }
  return hit;
}

/**
 * @param {Game} game
 * @param {any} factory
 * @returns {boolean}
 */
export function spawnEnemyFromFactory(game, factory){
  if (!factory || factory.dead || (factory.hp || 0) <= 0) return false;
  if (!game.enemies || !game.enemies.enemies) return false;
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  const maxEnemies = (cfg && typeof cfg.enemyCountCap === "number") ? Math.max(0, cfg.enemyCountCap | 0) : 30;
  if (missions.remainingCombatEnemies(game) >= maxEnemies) return false;
  /** @type {import("./types.d.js").EnemyType[]} */
  const allow = (cfg && cfg.enemyAllow) ? cfg.enemyAllow : [];
  const pool = allow.filter((t) => t === "hunter" || t === "ranger" || t === "crawler");
  const type = pool.length
    ? /** @type {import("./types.d.js").EnemyType} */ (pool[Math.floor(Math.random() * pool.length)])
    : "hunter";
  const { nx, ny, tx, ty } = mechanized.propBasis(game, factory);
  const s = factory.scale || 1;
  let x = factory.x + nx * (0.58 * s + 0.28);
  let y = factory.y + ny * (0.58 * s + 0.28);
  x += tx * ((Math.random() * 2 - 1) * 0.16);
  y += ty * ((Math.random() * 2 - 1) * 0.16);
  if (game.collision.airValueAtWorld(x, y) <= 0.5){
    const nudge = game.planet.nudgeOutOfTerrain(x, y, 0.9, 0.08, 0.18);
    if (!nudge.ok) return false;
    x = nudge.x;
    y = nudge.y;
    if (game.collision.airValueAtWorld(x, y) <= 0.5) return false;
  }
  return mechanized.spawnHostileAt(game, type, x, y);
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function updateFactorySpawns(game, dt){
  if (!levels.isMechanizedLevel(game)) return;
  const factoriesAlive = factoryPropsAlive(game);
  if (!factoriesAlive.length) return;
  const spawnCooldown = factorySpawnCooldownRange(game);
  for (const p of factoriesAlive){
    p.spawnCd = (typeof p.spawnCd === "number" && p.spawnCd > 0)
      ? p.spawnCd
      : (spawnCooldown.min + Math.random() * (spawnCooldown.max - spawnCooldown.min));
    p.spawnT = (typeof p.spawnT === "number") ? (p.spawnT + dt) : (Math.random() * p.spawnCd);
    if (p.spawnT < p.spawnCd) continue;
    p.spawnT -= p.spawnCd;
    p.spawnCd = spawnCooldown.min + Math.random() * (spawnCooldown.max - spawnCooldown.min);
    spawnEnemyFromFactory(game, p);
  }
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function updateFactoryHitFlash(game, dt){
  if (!game.planet || !game.planet.props || !game.planet.props.length) return;
  for (const prop of game.planet.props){
    if (prop.type !== "factory") continue;
    if (!prop.hitT || prop.hitT <= 0) continue;
    prop.hitT = Math.max(0, prop.hitT - dt);
  }
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function update(game, dt){
  updateFactoryHitFlash(game, dt);
  updateFactorySpawns(game, dt);
}


