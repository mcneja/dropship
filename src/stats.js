// @ts-check
/** @typedef {import("./game.js").Game} Game */

/**
 * @param {Game} game
 * @returns {{rescued:number,enemiesDestroyed:number,minersLost:number,dropshipsLost:number,hostiles:number,docks:number,shotsFired:number,bombsFired:number,factoriesDestroyed:number}}
 */
export function createRunStats(game){
  return {
    rescued: 0,
    enemiesDestroyed: 0,
    minersLost: 0,
    dropshipsLost: 0,
    hostiles: 0,
    docks: 0,
    shotsFired: 0,
    bombsFired: 0,
    factoriesDestroyed: 0,
  };
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function resetLevelStats(game){
  game.levelStats = createRunStats(game);
  markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function markDashboardDirty(game){
  game.dashboardState.dirty = true;
}

/**
 * @param {Game} game
 * @param {number} count
 * @returns {void}
 */
export function recordRescue(game, count){
  const n = Math.max(0, count | 0);
  if (!n) return;
  game.levelStats.rescued += n;
  game.overallStats.rescued += n;
  markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @param {number} [count]
 * @returns {void}
 */
export function recordEnemyDestroyed(game, count = 1){
  const n = Math.max(0, count | 0);
  if (!n) return;
  game.levelStats.enemiesDestroyed += n;
  game.overallStats.enemiesDestroyed += n;
  markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @param {number} [count]
 * @returns {void}
 */
export function recordFactoryDestroyed(game, count = 1){
  const n = Math.max(0, count | 0);
  if (!n) return;
  game.levelStats.factoriesDestroyed += n;
  game.overallStats.factoriesDestroyed += n;
  markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @param {number} [count]
 * @returns {void}
 */
export function registerMinerLoss(game, count = 1){
  const n = Math.max(0, count | 0);
  if (!n) return;
  game.minersDead += n;
  game.levelStats.minersLost += n;
  game.overallStats.minersLost += n;
  markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @param {number} [count]
 * @returns {void}
 */
export function recordDropshipLoss(game, count = 1){
  const n = Math.max(0, count | 0);
  if (!n) return;
  game.levelStats.dropshipsLost += n;
  game.overallStats.dropshipsLost += n;
  markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @param {number} count
 * @returns {void}
 */
export function setHostileBudget(game, count){
  const n = Math.max(0, count | 0);
  game.levelStats.hostiles = n;
  game.overallStats.hostiles += n;
  markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @param {number} [count]
 * @returns {void}
 */
export function recordDock(game, count = 1){
  const n = Math.max(0, count | 0);
  if (!n) return;
  game.levelStats.docks += n;
  game.overallStats.docks += n;
  markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @param {number} [count]
 * @returns {void}
 */
export function recordShotsFired(game, count = 1){
  const n = Math.max(0, count | 0);
  if (!n) return;
  game.levelStats.shotsFired += n;
  game.overallStats.shotsFired += n;
  markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @param {number} [count]
 * @returns {void}
 */
export function recordBombsFired(game, count = 1){
  const n = Math.max(0, count | 0);
  if (!n) return;
  game.levelStats.bombsFired += n;
  game.overallStats.bombsFired += n;
  markDashboardDirty(game);
}


