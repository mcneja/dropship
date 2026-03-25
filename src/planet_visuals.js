// @ts-check
/** @typedef {import("./game.js").Game} Game */

import { CFG } from "./config.js";

/**
 * @param {Game} game
 * @returns {{rockDark:[number,number,number],rockLight:[number,number,number],airDark:[number,number,number],airLight:[number,number,number],surfaceRockDark:[number,number,number],surfaceRockLight:[number,number,number],surfaceBand:number}}
 */
export function planetPalette(game){
  const cfg = game.planet ? game.planet.getPlanetConfig() : null;
  const def = (cfg && cfg.defaults) ? cfg.defaults : null;
  if (!def){
    return {
      rockDark: /** @type {[number,number,number]} */ (CFG.ROCK_DARK),
      rockLight: /** @type {[number,number,number]} */ (CFG.ROCK_LIGHT),
      airDark: /** @type {[number,number,number]} */ (CFG.AIR_DARK),
      airLight: /** @type {[number,number,number]} */ (CFG.AIR_LIGHT),
      surfaceRockDark: /** @type {[number,number,number]} */ (CFG.ROCK_DARK),
      surfaceRockLight: /** @type {[number,number,number]} */ (CFG.ROCK_LIGHT),
      surfaceBand: 0,
    };
  }
  return {
    rockDark: def.ROCK_DARK ?? /** @type {[number,number,number]} */ (CFG.ROCK_DARK),
    rockLight: def.ROCK_LIGHT ?? /** @type {[number,number,number]} */ (CFG.ROCK_LIGHT),
    airDark: def.AIR_DARK ?? /** @type {[number,number,number]} */ (CFG.AIR_DARK),
    airLight: def.AIR_LIGHT ?? /** @type {[number,number,number]} */ (CFG.AIR_LIGHT),
    surfaceRockDark: def.SURFACE_ROCK_DARK ?? def.ROCK_DARK ?? /** @type {[number,number,number]} */ (CFG.ROCK_DARK),
    surfaceRockLight: def.SURFACE_ROCK_LIGHT ?? def.ROCK_LIGHT ?? /** @type {[number,number,number]} */ (CFG.ROCK_LIGHT),
    surfaceBand: (typeof def.SURFACE_BAND === "number") ? def.SURFACE_BAND : 0,
  };
}


