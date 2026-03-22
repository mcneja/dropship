// @ts-check

import { GAME } from "./config.js";
import { Renderer } from "./rendering.js";
import { Input } from "./input.js";
import { updateHud, updatePlanetLabel, updateObjectiveLabel, updateShipStatusLabel, updateSignalMeter, updateHeatMeter } from "./ui.js";
import { GameLoop } from "./loop.js";
import { BackgroundMusic } from "./audio.js";
import { HelpPopup } from "./help_popup.js";
import { loadGameFromStorage, installExitSaveHandlers } from "./save_state.js";
import { BENCH_CONFIG } from "./perf.js";

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("gl"));
const hud = /** @type {HTMLElement} */ (document.getElementById("hud"));
const planetLabel = /** @type {HTMLElement} */ (document.getElementById("planet-label"));
const objectiveLabel = /** @type {HTMLElement} */ (document.getElementById("objective-label"));
const shipStatusLabel = /** @type {HTMLElement} */ (document.getElementById("ship-status-label"));
const signalMeter = /** @type {HTMLElement} */ (document.getElementById("signal-meter"));
const heatMeter = /** @type {HTMLElement} */ (document.getElementById("heat-meter"));

const renderer = new Renderer(canvas, GAME);

const input = new Input(canvas);
const bgm = new BackgroundMusic({ volume: 0.35 });
const helpPopup = new HelpPopup({
  onToggle: (open) => input.setModalOpen(open),
});

const loop = new GameLoop({
  renderer,
  input,
  audio: /** @type {{toggleMuted?:()=>boolean,toggleCombatMusicEnabled?:()=>boolean,stepMusicVolume?:(direction:number)=>number,stepSfxVolume?:(direction:number)=>number,setCombatActive?:(active:boolean)=>boolean,triggerCombatImmediate?:()=>boolean,triggerVictoryMusic?:()=>boolean,returnToAmbient?:(withFade?:boolean)=>void,playSfx?:(id:string,opts?:{volume?:number,rate?:number})=>boolean,setThrustLoopActive?:(active:boolean)=>boolean}} */ (bgm),
  ui: { updateHud, updatePlanetLabel, updateObjectiveLabel, updateShipStatusLabel, updateSignalMeter, updateHeatMeter },
  canvas,
  overlay: /** @type {HTMLCanvasElement} */ (document.getElementById("overlay")),
  hud,
  planetLabel,
  objectiveLabel,
  shipStatusLabel,
  signalMeter,
  heatMeter,
  helpPopup,
});

if (!BENCH_CONFIG.enabled){
  loadGameFromStorage(loop);
  installExitSaveHandlers(loop);
}
loop.start();
