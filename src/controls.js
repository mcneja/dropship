// @ts-check
/** @typedef {import("./game.js").Game} Game */

import * as camera from "./camera.js";
import * as dashboardUi from "./dashboard.js";
import * as dropship from "./dropship.js";
import * as levels from "./levels.js";
import * as session from "./session.js";

/**
 * @param {Game} game
 * @param {ReturnType<import("./input.js").Input["update"]>} inputState
 * @returns {void}
 */
export function applyFrameToggles(game, inputState){
  if (inputState.togglePlanetView){
    game.planetView = !game.planetView;
  }
  if (inputState.toggleFog){
    game.fogEnabled = !game.fogEnabled;
  }
}

/**
 * @param {ReturnType<import("./input.js").Input["update"]>} inputState
 * @param {ReturnType<typeof readFrameCommandInput>|null} [frameCommandInput]
 * @returns {void}
 */
export function consumeFrameOneShots(inputState, frameCommandInput = null){
  inputState.reset = false;
  inputState.abandonRun = false;
  inputState.shootPressed = false;
  inputState.shoot = false;
  inputState.bomb = false;
  inputState.spawnEnemyType = null;
  if (!frameCommandInput) return;
  frameCommandInput.reset = false;
  frameCommandInput.abandonRun = false;
  frameCommandInput.shootPressed = false;
  frameCommandInput.shoot = false;
  frameCommandInput.bomb = false;
  frameCommandInput.spawnEnemyType = null;
}

/**
 * @param {ReturnType<import("./input.js").Input["update"]>} inputState
 * @returns {{
 *   stickThrust:{x:number,y:number},
 *   left:boolean,
 *   right:boolean,
 *   thrust:boolean,
 *   down:boolean,
 *   reset:boolean,
 *   abandonRun:boolean,
 *   shootHeld:boolean,
 *   shootPressed:boolean,
 *   shoot:boolean,
 *   bomb:boolean,
 *   aim:any,
 *   aimShoot:any,
 *   aimBomb:any,
 *   aimShootFrom:any,
 *   aimShootTo:any,
 *   aimBombFrom:any,
 *   aimBombTo:any,
 *   inputType:any,
 *   spawnEnemyType:any,
 * }}
 */
export function readFrameCommandInput(inputState){
  /** @type {{x:number,y:number}} */
  const stickThrust = {
    x: Number(inputState.stickThrust?.x) || 0,
    y: Number(inputState.stickThrust?.y) || 0,
  };
  let left = !!inputState.left;
  let right = !!inputState.right;
  let thrust = !!inputState.thrust;
  let down = !!inputState.down;
  let shootHeld = !!inputState.shootHeld;
  let shootPressed = !!inputState.shootPressed;
  const shoot = !!inputState.shoot;
  const bomb = !!inputState.bomb;
  let aim = inputState.aim || null;
  let aimShoot = inputState.aimShoot || null;
  let aimBomb = inputState.aimBomb || null;

  if (!shootPressed && shoot){
    shootPressed = true;
  }
  return {
    stickThrust,
    left,
    right,
    thrust,
    down,
    reset: !!inputState.reset,
    abandonRun: !!inputState.abandonRun,
    shootHeld,
    shootPressed,
    shoot,
    bomb,
    aim,
    aimShoot,
    aimBomb,
    aimShootFrom: inputState.aimShootFrom || null,
    aimShootTo: inputState.aimShootTo || null,
    aimBombFrom: inputState.aimBombFrom || null,
    aimBombTo: inputState.aimBombTo || null,
    inputType: inputState.inputType || null,
    spawnEnemyType: inputState.spawnEnemyType || null,
  };
}

/**
 * @param {Game} game
 * @param {ReturnType<typeof readFrameCommandInput>} frameCommandInput
 * @param {number} dt
 * @returns {ReturnType<typeof readFrameCommandInput>}
 */
export function deriveSimInput(game, frameCommandInput, dt){
  const stickThrust = {
    x: frameCommandInput.stickThrust.x,
    y: frameCommandInput.stickThrust.y,
  };
  let left = frameCommandInput.left;
  let right = frameCommandInput.right;
  let thrust = frameCommandInput.thrust;
  let down = frameCommandInput.down;
  const shootHeld = frameCommandInput.shootHeld;
  const shootPressed = frameCommandInput.shootPressed;
  const shoot = frameCommandInput.shoot;
  const bomb = frameCommandInput.bomb;
  let aim = frameCommandInput.aim;
  let aimShoot = frameCommandInput.aimShoot;
  let aimBomb = frameCommandInput.aimBomb;

  if (frameCommandInput.inputType === "gamepad"){
    const aimAdjusted = camera.aimScreenAroundShip(game, aim);
    aim = aimAdjusted;
    aimShoot = aimAdjusted;
    aimBomb = aimAdjusted;
  }
  if (!aim && game.lastAimScreen){
    aim = game.lastAimScreen;
  }
  if (!aimShoot) aimShoot = aim;
  if (!aimBomb) aimBomb = aimShoot || aim;

  if (game.planetView){
    left = false;
    right = false;
    thrust = false;
    down = false;
    stickThrust.x = 0;
    stickThrust.y = 0;
  }

  if (game.ship.invertT > 0){
    game.ship.invertT = Math.max(0, game.ship.invertT - dt);
    [left, right] = [right, left];
    [thrust, down] = [down, thrust];
    stickThrust.x = -stickThrust.x;
    stickThrust.y = -stickThrust.y;
  }

  return {
    stickThrust,
    left,
    right,
    thrust,
    down,
    reset: frameCommandInput.reset,
    abandonRun: frameCommandInput.abandonRun,
    shootHeld,
    shootPressed,
    shoot,
    bomb,
    aim,
    aimShoot,
    aimBomb,
    aimShootFrom: frameCommandInput.aimShootFrom,
    aimShootTo: frameCommandInput.aimShootTo,
    aimBombFrom: frameCommandInput.aimBombFrom,
    aimBombTo: frameCommandInput.aimBombTo,
    inputType: frameCommandInput.inputType,
    spawnEnemyType: frameCommandInput.spawnEnemyType,
  };
}

/**
 * @param {Game} game
 * @param {ReturnType<typeof readFrameCommandInput>} frameCommandInput
 * @param {ReturnType<import("./input.js").Input["update"]>} inputState
 * @returns {boolean}
 */
export function handleFrameCommands(game, frameCommandInput, inputState){
  if (frameCommandInput.abandonRun){
    session.abandonRunAndRestart(game);
    inputState.abandonRun = false;
    inputState.abandonHoldActive = false;
    inputState.abandonHoldRemainingMs = 0;
    return true;
  }

  if (frameCommandInput.reset){
    if (game.ship.state === "crashed"){
      if (game.ship.mothershipPilots > 0){
        session.restartWithNewPilot(game);
      } else {
        const nextSeed = game.planet.getSeed() + 1;
        levels.beginNewGameWithIntro(game, nextSeed);
      }
      return true;
    } else if (dropship.isDockedWithMothership(game)) {
      if (game.pendingPerkChoice === null && game.ship.mothershipEngineers > 0){
        dashboardUi.presentNextPerkChoice(game);
        return false;
      } else if (game.missionState.levelAdvanceReady){
        const nextSeed = game.planet.getSeed() + 1;
        levels.startJumpdriveTransition(game, nextSeed, game.level + 1);
        return true;
      } else if (game.ship.planetScanner){
        game.planetView = !game.planetView;
        return false;
      }
    } else if (game.debugState && game.debugState.devHudVisible){
      dropship.resetShip(game);
      return true;
    }
  }

  if (game.pendingPerkChoice !== null){
    dashboardUi.handlePerkChoiceInput(
      game,
      frameCommandInput.left || frameCommandInput.stickThrust.x < -0.5,
      frameCommandInput.right || frameCommandInput.stickThrust.x > 0.5
    );
    return false;
  }

  return false;
}

/**
 * @param {Game} game
 * @param {ReturnType<typeof deriveSimInput>} simInput
 * @returns {ReturnType<typeof deriveSimInput>}
 */
export function suppressDockedFlightInput(game, simInput){
  if (!dropship.isDockedWithMothership(game)){
    return simInput;
  }

  return {
    ...simInput,
    left: false,
    right: false,
    stickThrust: {
      x: 0,
      y: simInput.stickThrust.y < 0.25 ? 0 : simInput.stickThrust.y,
    },
  };
}


