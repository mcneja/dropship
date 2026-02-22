// @ts-check

import { CFG, GAME } from "./config.js";
import { createMapGen } from "./mapgen.js";
import { buildRingMesh } from "./mesh.js";
import { createRenderer } from "./rendering.js";
import { createInput } from "./input.js";
import { updateHud } from "./ui.js";
import { createGameLoop } from "./loop.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gl"));
const hud = /** @type {HTMLElement} */ (document.getElementById("hud"));

const mapgen = createMapGen(CFG);
mapgen.regenWorld(CFG.seed);

const mesh = buildRingMesh(CFG, mapgen);

const renderer = createRenderer(canvas, CFG, GAME);
renderer.setMesh(mesh);

const input = createInput(canvas);

const loop = createGameLoop({
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
