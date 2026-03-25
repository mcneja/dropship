// @ts-check
/** @typedef {import("./game.js").Game} Game */

import * as factories from "./factories.js";
import * as audioState from "./audio.js";
import * as dashboardUi from "./dashboard.js";
import * as dropship from "./dropship.js";
import * as tether from "./tether.js";

export class MissionState {
  constructor(){
    this.clearObjectiveTotal = 0;
    this.levelAdvanceReady = false;
    this.objectiveCompleteSfxPlayed = false;
    this.objectiveCompleteSfxDueAtMs = Number.POSITIVE_INFINITY;
    this.victoryMusicTriggered = false;
  }
}

/**
 * @param {Game} game
 * @returns {number}
 */
export function remainingCombatEnemies(game){
  if (!game.enemies || !game.enemies.enemies) return 0;
  let count = 0;
  for (const enemy of game.enemies.enemies){
    if (!enemy || enemy.hp <= 0) continue;
    count++;
  }
  return count;
}

/**
 * @param {Game} game
 * @returns {number}
 */
export function remainingClearTargets(game){
  return remainingCombatEnemies(game);
}

/**
 * @param {Game} game
 * @returns {number}
 */
export function remainingFactoryTargets(game){
  return factories.factoryPropsAlive(game).length;
}

/**
 * @param {Game} game
 * @returns {{done:number,target:number,remaining:number}}
 */
export function factoryObjectiveProgress(game){
  const configuredTarget = Math.max(0, (game.objective && game.objective.type === "destroy_factories")
    ? (game.objective.target || 0)
    : 0);
  const destroyed = Math.max(0, game.levelStats.factoriesDestroyed || 0);
  const target = configuredTarget || Math.max(0, destroyed + remainingFactoryTargets(game));
  const done = target ? Math.min(target, destroyed) : destroyed;
  const remaining = target ? Math.max(0, target - done) : 0;
  return { done, target, remaining };
}

/**
 * Recompute clear-objective totals at level init.
 * @param {Game} game
 * @returns {void}
 */
export function initializeClearObjectiveTracking(game){
  const missionState = game.missionState;
  if (!game.objective || game.objective.type !== "clear"){
    missionState.clearObjectiveTotal = 0;
    return;
  }
  const remaining = remainingClearTargets(game);
  missionState.clearObjectiveTotal = Math.max(game.objective.target || 0, remaining);
  game.objective.target = missionState.clearObjectiveTotal;
}

/**
 * @param {Game} game
 * @returns {string}
 */
export function objectiveText(game){
  if (!game.objective) return "";
  if (game.objective.type === "destroy_core"){
    const target = Math.max(game.objective.target || 0, tether.tetherPropsAll(game).length);
    const remaining = tether.tetherPropsAlive(game).length;
    const done = target ? Math.max(0, target - remaining) : 0;
    if (game.coreMeltdownActive){
      const timeLeft = Math.max(0, game.coreMeltdownDuration - game.coreMeltdownT);
      return `Objective: Escape to mothership ${Math.ceil(timeLeft)}s`;
    }
    return `Objective: Destroy core ${done}${target ? `/${target}` : ""}`;
  }
  if (game.objective.type === "clear"){
    const remaining = remainingClearTargets(game);
    const target = Math.max(game.objective.target || 0, game.missionState.clearObjectiveTotal || 0, remaining);
    const done = target ? Math.max(0, target - remaining) : 0;
    return `Objective: Clear enemies ${done}${target ? `/${target}` : ""}`;
  }
  if (game.objective.type === "destroy_factories"){
    const { done, target, remaining } = factoryObjectiveProgress(game);
    return `Objective: Destroy factories ${done}${target ? `/${target}` : ""}${target ? ` (${remaining} remaining)` : ""}`;
  }
  if (game.objective.type === "extract"){
    const target = game.objective.target || 0;
    const remaining = Math.max(0, game.minersRemaining || 0);
    const lost = Math.max(0, game.minersDead || 0);
    const rescued = target
      ? Math.max(0, target - remaining - lost)
      : Math.max(0, game.levelStats.rescued || 0);
    const extractable = target ? Math.max(0, target - lost) : rescued;
    const rescuedShown = target ? Math.min(rescued, extractable) : rescued;
    return `Objective: Extract miners ${rescuedShown}${target ? `/${extractable}` : ""}${lost ? ` (lost ${lost})` : ""}`;
  }
  return `Objective: ${game.objective.type}`;
}

/**
 * @param {Game} game
 * @returns {boolean}
 */
export function runEnded(game){
  return game.ship.state === "crashed" && game.ship.mothershipPilots <= 0;
}

/**
 * @param {Game} game
 * @param {boolean} transitionActive
 * @returns {boolean}
 */
export function updateLevelAdvanceReady(game, transitionActive){
  game.missionState.levelAdvanceReady =
    !transitionActive &&
    game.pendingPerkChoice === null &&
    game.ship.mothershipEngineers <= 0 &&
    dashboardUi.objectiveComplete(game) &&
    dropship.isDockedWithMothership(game);
  return game.missionState.levelAdvanceReady;
}

/**
 * @param {Game} game
 * @param {number} now
 * @param {boolean} transitionActive
 * @returns {{objectiveCompleteNow:boolean,runEnded:boolean,levelAdvanceReady:boolean}}
 */
export function finalizeFrameState(game, now, transitionActive){
  const missionState = game.missionState;
  const objectiveCompleteNow = dashboardUi.objectiveComplete(game);
  const levelAdvanceReady = updateLevelAdvanceReady(game, transitionActive);
  if (objectiveCompleteNow && game.level >= 16 && !missionState.victoryMusicTriggered){
    missionState.victoryMusicTriggered = true;
    audioState.triggerVictoryMusic(game);
  }
  if (objectiveCompleteNow && !missionState.objectiveCompleteSfxPlayed){
    if (!Number.isFinite(missionState.objectiveCompleteSfxDueAtMs)){
      missionState.objectiveCompleteSfxDueAtMs = now + game.OBJECTIVE_COMPLETE_SFX_DELAY_MS;
    } else if (now >= missionState.objectiveCompleteSfxDueAtMs){
      missionState.objectiveCompleteSfxPlayed = true;
      missionState.objectiveCompleteSfxDueAtMs = Number.POSITIVE_INFINITY;
      audioState.playSfx(game, "objective_complete", { volume: 0.75 });
    }
  } else if (!objectiveCompleteNow){
    missionState.objectiveCompleteSfxDueAtMs = Number.POSITIVE_INFINITY;
  }
  const combatActive =
    !objectiveCompleteNow &&
    game.ship.state !== "crashed" &&
    now < game.combatThreatUntilMs;
  audioState.setCombatActive(game, combatActive);
  return {
    objectiveCompleteNow,
    runEnded: !transitionActive && runEnded(game),
    levelAdvanceReady,
  };
}


