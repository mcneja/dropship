// @ts-check
/** @typedef {import("./game.js").Game} Game */

export class TitleState {
  constructor(){
    this.text = "DROPSHIP";
    this.alpha = 1;
    this.fade = false;
    this.seen = false;
    this.newGameHelpPromptT = 0;
    this.newGameHelpPromptArmed = true;
  }
}

/**
 * @param {Game} game
 * @param {number} dt
 * @param {import("./types.d.js").InputState} inputState
 * @returns {void}
 */
export function updateStartTitle(game, dt, inputState){
  const title = game.titleState;
  if (title.seen) return;
  if (!title.fade && hasAnyPlayerInput(game, inputState)){
    title.fade = true;
  }
  if (!title.fade) return;
  title.alpha = Math.max(0, title.alpha - game.START_TITLE_FADE_PER_SEC * Math.max(0, dt));
  if (title.alpha <= 0){
    title.seen = true;
    title.alpha = 0;
  }
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").InputState} inputState
 * @returns {boolean}
 */
export function hasAnyPlayerInput(game, inputState){
  if (inputState.left || inputState.right || inputState.thrust || inputState.down) return true;
  if (inputState.shootHeld || inputState.shootPressed || inputState.shoot || inputState.bomb || inputState.reset || inputState.abandonRun) return true;
  if (inputState.regen || inputState.nextLevel || inputState.prevLevel) return true;
  if (inputState.toggleDebug || inputState.toggleDevHud || inputState.togglePlanetView || inputState.toggleCollisionContours || inputState.toggleMinerGuidePath || inputState.toggleFog) return true;
  if (inputState.copyScreenshot || inputState.copyScreenshotClean || inputState.copyScreenshotCleanTitle) return true;
  if (inputState.zoomReset) return true;
  if (typeof inputState.zoomDelta === "number" && Math.abs(inputState.zoomDelta) > 1e-4) return true;
  if (inputState.rescueAll || inputState.killAllEnemies || inputState.removeEntities || inputState.spawnEnemyType !== null) return true;
  if (inputState.inputType === "touch" && (inputState.aim || inputState.aimShoot || inputState.aimBomb)) return true;
  if (inputState.inputType === "gamepad" && (inputState.aim || inputState.aimShoot || inputState.aimBomb)) return true;
  const stick = inputState.stickThrust;
  return !!(stick && (stick.x * stick.x + stick.y * stick.y) > 0);
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function resetStartTitle(game){
  const title = game.titleState;
  title.text = "DROPSHIP";
  title.alpha = 1;
  title.fade = false;
  title.seen = false;
  title.newGameHelpPromptT = 0;
  title.newGameHelpPromptArmed = true;
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function tickHelpPrompt(game, dt){
  const title = game.titleState;
  if (title.newGameHelpPromptT > 0){
    title.newGameHelpPromptT = Math.max(0, title.newGameHelpPromptT - dt);
  }
}


