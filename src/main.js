// @ts-check

import { CFG, GAME } from "./config.js";
import { MapGen } from "./mapgen.js";
import { RingMesh } from "./mesh.js";
import { Renderer } from "./rendering.js";
import { Input } from "./input.js";
import { updateHud } from "./ui.js";
import { GameLoop } from "./loop.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gl"));
const hud = /** @type {HTMLElement} */ (document.getElementById("hud"));

const mapgen = new MapGen(CFG);
mapgen.regenWorld(CFG.seed);

const mesh = new RingMesh(CFG, mapgen);

const renderer = new Renderer(canvas, CFG, GAME);
renderer.setMesh(mesh);

const input = new Input(canvas);

const loop = new GameLoop({
  cfg: CFG,
  mapgen,
  mesh,
  renderer,
  input,
  ui: { updateHud },
  canvas,
  hud,
});

loop.start();
