// @ts-check

import { CFG, GAME } from "./config.js";
import { MapGen } from "./mapgen.js";
import { Planet } from "./planet.js";
import { Renderer } from "./rendering.js";
import { Input } from "./input.js";
import { updateHud } from "./ui.js";
import { GameLoop } from "./loop.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gl"));
const hud = /** @type {HTMLElement} */ (document.getElementById("hud"));

const mapgen = new MapGen(CFG);
mapgen.regenWorld(CFG.seed);

const renderer = new Renderer(canvas, CFG, GAME);
const planet = new Planet(CFG, GAME, mapgen);
renderer.setPlanet(planet);

const input = new Input(canvas);

const loop = new GameLoop({
  cfg: CFG,
  mapgen,
  planet,
  renderer,
  input,
  ui: { updateHud },
  canvas,
  overlay: /** @type {HTMLCanvasElement} */ (document.getElementById("overlay")),
  hud,
});

loop.start();
