// @ts-check
/** @typedef {import("./game.js").Game} Game */

import { clearSavedGame } from "./save_state.js";
import * as dropship from "./dropship.js";
import * as levels from "./levels.js";

/**
 * @param {Game} game
 * @returns {void}
 */
export function restartWithNewPilot(game){
  console.log("Restart: num pilots", game.ship.mothershipPilots);
  game.ship.mothershipPilots = Math.max(0, game.ship.mothershipPilots - 1);
  dropship.resetShip(game);
}

/**
 * Abandon current run: clear persisted save and start from level 1.
 * @param {Game} game
 * @returns {void}
 */
export function abandonRunAndRestart(game){
  clearSavedGame();
  const nextSeed = game.planet.getSeed() + 1;
  levels.beginNewGameWithIntro(game, nextSeed);
}


