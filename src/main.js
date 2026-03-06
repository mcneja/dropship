// @ts-check

import { GAME } from "./config.js";
import { Renderer } from "./rendering.js";
import { Input } from "./input.js";
import { updateHud } from "./ui.js";
import { GameLoop } from "./loop.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gl"));
const hud = /** @type {HTMLElement} */ (document.getElementById("hud"));

const renderer = new Renderer(canvas, GAME);

const input = new Input(canvas);

const loop = new GameLoop({
  renderer,
  input,
  ui: { updateHud },
  canvas,
  overlay: /** @type {HTMLCanvasElement} */ (document.getElementById("overlay")),
  hud,
});

loop.start();
