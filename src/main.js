// @ts-check

import { CFG, GAME } from "./config.js";
import { Planet } from "./planet.js";
import { Renderer } from "./rendering.js";
import { Input } from "./input.js";
import { updateHud } from "./ui.js";
import { GameLoop } from "./loop.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gl"));
const hud = /** @type {HTMLElement} */ (document.getElementById("hud"));

const renderer = new Renderer(canvas, CFG, GAME);
const planet = new Planet({ cfg: CFG, game: GAME, seed: CFG.seed });
renderer.setPlanet(planet);

const input = new Input(canvas);

const loop = new GameLoop({
  cfg: CFG,
  planet,
  renderer,
  input,
  ui: { updateHud },
  canvas,
  overlay: /** @type {HTMLCanvasElement} */ (document.getElementById("overlay")),
  hud,
});

loop.start();
