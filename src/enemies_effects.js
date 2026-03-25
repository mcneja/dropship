// @ts-check
/** @typedef {import("./game.js").Game} Game */

import * as audioState from "./audio.js";
import { emitTerrainDestructionFragments } from "./fragment_fx.js";
import * as stats from "./stats.js";

const CRAWLER_BOMB_DEATH_SFX_DELAY_MS = 45;

/**
 * @param {Game} game
 * @param {{x:number,y:number,hitT?:number}} enemy
 * @param {"lava"|"spores"|null} [source]
 * @returns {void}
 */
function applyEnemyHitFeedback(game, enemy, source = null){
  enemy.hitT = 0.25;
  const flashCol = (source === "lava")
    ? { cr: 1.0, cg: 0.42, cb: 0.08 }
    : null;
  game.entityExplosions.push({
    x: enemy.x,
    y: enemy.y,
    life: game.NONLETHAL_HIT_FLASH_LIFE,
    radius: game.ENEMY_HIT_BLAST,
    ...(flashCol || {}),
  });
}

/**
 * @param {Game} game
 * @param {{x:number,y:number,hp:number,hitT?:number}} enemy
 * @param {number} amount
 * @returns {void}
 */
function damageEnemy(game, enemy, amount){
  if (!enemy || enemy.hp <= 0) return;
  const dmg = Math.max(0, amount || 0);
  if (dmg <= 0) return;
  enemy.hp = Math.max(0, enemy.hp - dmg);
  if (enemy.hp > 0){
    applyEnemyHitFeedback(game, enemy);
  }
}

/**
 * @param {Game} game
 * @param {{x:number,y:number,hp:number,stunT?:number,hitT?:number}} enemy
 * @param {number} duration
 * @param {"lava"|"spores"} [source]
 * @returns {void}
 */
function stunEnemy(game, enemy, duration, source){
  if (!enemy || enemy.hp <= 0) return;
  enemy.stunT = Math.max(0.1, duration || 0);
  applyEnemyHitFeedback(game, enemy, source || null);
}

/**
 * @param {Game} game
 * @param {{type?:string,x:number,y:number,vx?:number,vy?:number}} enemy
 * @param {{cause?:"hp"|"detonate",destroyedBy?:import("./types.d.js").FragmentDestroyedBy}|null|undefined} [info]
 * @returns {void}
 */
function handleEnemyDestroyed(game, enemy, info){
  stats.recordEnemyDestroyed(game, 1);
  audioState.playSfx(game, "enemy_destroyed", { volume: 0.8 });

  if (game.healthPickups.length === 0 &&
      game.ship.hpCur < game.ship.hpMax &&
      enemy.type !== "orbitingTurret"){
    const hpCurClamped = Math.min(4, game.ship.hpCur);
    const hpMaxClamped = 4;
    const healthPickupChance = (hpMaxClamped - hpCurClamped) / hpMaxClamped;
    if (Math.random() < healthPickupChance){
      game.healthPickups.push({
        x: enemy.x,
        y: enemy.y,
        life: 4,
      });
    }
  }

  if (!enemy || enemy.type !== "crawler"){
    return;
  }
  const destroyedBy = info && info.destroyedBy ? info.destroyedBy : "unknown";
  playCrawlerDeathSfx(game, destroyedBy);
  applyCrawlerDeathBlast(game, enemy, destroyedBy);
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").FragmentDestroyedBy} destroyedBy
 * @returns {void}
 */
function playCrawlerDeathSfx(game, destroyedBy){
  const opts = {
    volume: destroyedBy === "bomb" ? 0.58 : 0.72,
    rate: destroyedBy === "bomb"
      ? 0.88 + Math.random() * 0.08
      : 0.92 + Math.random() * 0.12,
  };
  if (destroyedBy === "bomb"){
    setTimeout(() => {
      audioState.playSfx(game, "bomb_explosion", opts);
    }, CRAWLER_BOMB_DEATH_SFX_DELAY_MS);
    return;
  }
  audioState.playSfx(game, "bomb_explosion", opts);
}

/**
 * @param {Game} game
 * @param {{x:number,y:number,vx?:number,vy?:number}} enemy
 * @param {import("./types.d.js").FragmentDestroyedBy} destroyedBy
 * @returns {void}
 */
function applyCrawlerDeathBlast(game, enemy, destroyedBy){
  const x = enemy.x;
  const y = enemy.y;
  const blastRadius = destroyedBy === "bomb" ? game.CRAWLER_BOMB_DEATH_BLAST : game.CRAWLER_DEATH_BLAST;
  game.entityExplosions.push({
    x,
    y,
    life: game.CRAWLER_DEATH_FLASH_LIFE,
    radius: blastRadius,
  });
  applyCrawlerBlastDamage(game, x, y, blastRadius, enemy, destroyedBy);
  applyCrawlerTerrainImpact(game, x, y, blastRadius);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {{x:number,y:number}|null|undefined} sourceEnemy
 * @param {import("./types.d.js").FragmentDestroyedBy} [destroyedBy]
 * @returns {void}
 */
function applyCrawlerBlastDamage(game, x, y, radius, sourceEnemy, destroyedBy = "unknown"){
  const r2 = radius * radius;
  const collateralDestroyedBy = destroyedBy === "bomb" ? "bomb" : "detonate";
  for (let j = game.enemies.enemies.length - 1; j >= 0; j--){
    const e = game.enemies.enemies[j];
    if (!e || e === sourceEnemy || e.hp <= 0) continue;
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy > r2) continue;
    e.hp = Math.max(0, e.hp - game.CRAWLER_DEATH_DAMAGE);
    if (e.hp <= 0){
      game.enemies.markEnemyDestroyedBy(e, collateralDestroyedBy);
    }
    if (e.hp > 0){
      applyEnemyHitFeedback(game, e);
    }
  }
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {number} range
 * @returns {void}
 */
function applyCrawlerTerrainImpact(game, x, y, range){
  const cfg = game.planet ? game.planet.getPlanetConfig() : null;
  if (cfg && cfg.flags && cfg.flags.disableTerrainDestruction){
    if (cfg.id === "molten"){
      game.planet.handleFeatureImpact(x, y, Math.max(game.TERRAIN_NODE_IMPACT_RANGE, range), "crawler", game.featureCallbacks);
    }
    return;
  }
  const result = game.planet.destroyRockRadialNodesInRange(x, y, Math.max(game.TERRAIN_NODE_IMPACT_RANGE, range));
  if (!result) return;
  emitTerrainDestructionFragments(game, result, x, y);
}

export {
  applyCrawlerBlastDamage,
  applyCrawlerDeathBlast,
  applyCrawlerTerrainImpact,
  applyEnemyHitFeedback,
  damageEnemy,
  handleEnemyDestroyed,
  playCrawlerDeathSfx,
  stunEnemy,
};


