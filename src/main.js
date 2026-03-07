// @ts-check

import { GAME } from "./config.js";
import { Renderer } from "./rendering.js";
import { Input } from "./input.js";
import { updateHud, updatePlanetLabel, updateObjectiveLabel, updateHeatMeter } from "./ui.js";
import { GameLoop } from "./loop.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gl"));
const hud = /** @type {HTMLElement} */ (document.getElementById("hud"));
const planetLabel = /** @type {HTMLElement} */ (document.getElementById("planet-label"));
const objectiveLabel = /** @type {HTMLElement} */ (document.getElementById("objective-label"));
const heatMeter = /** @type {HTMLElement} */ (document.getElementById("heat-meter"));

const renderer = new Renderer(canvas, GAME);

const input = new Input(canvas);

const loop = new GameLoop({
  renderer,
  input,
  ui: { updateHud, updatePlanetLabel, updateObjectiveLabel, updateHeatMeter },
  canvas,
  overlay: /** @type {HTMLCanvasElement} */ (document.getElementById("overlay")),
  hud,
  planetLabel,
  objectiveLabel,
  heatMeter,
});

loop.start();
