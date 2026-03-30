// @ts-check
/** @typedef {import("./game.js").Game} Game */

import { GAME } from "./config.js";
import * as audioState from "./audio.js";
import * as stats from "./stats.js";
import * as tether from "./tether.js";
import * as levels from "./levels.js";
import { BENCH_CONFIG } from "./perf.js";
import * as planetFog from "./planet_fog.js";

export const SAVE_SCHEMA_VERSION = 1;
const STORAGE_KEY_BASE = "dropship.save";
const STORAGE_KEY = `${STORAGE_KEY_BASE}.v${SAVE_SCHEMA_VERSION}`;
const LEGACY_STORAGE_KEYS = [STORAGE_KEY_BASE];

/**
 * @typedef {{
 *   version:number,
 *   savedAtUtcMs:number,
 *   progressionSeed:number,
 *   level:number,
 *   planetSeed:number,
 *   planetConfigId:string|null,
 *   planetRuntime:any,
 *   ship:any,
 *   mothership:{x:number,y:number,vx:number,vy:number,angle:number},
 *   miners:any[],
 *   fallenMiners:any[],
 *   minersRemaining:number,
 *   minersDead:number,
 *   minerTarget:number,
 *   minerCandidates:number,
 *   levelStats:any,
 *   overallStats:any,
 *   enemies:{enemies:any[],shots:any[],explosions:any[],debris:any[]},
 *   playerShots:any[],
 *   playerBombs:any[],
 *   debris:any[],
 *   fragments:any[],
 *   entityExplosions:any[],
 *   popups:any[],
 *   shipHitPopups:any[],
 *   objective:any,
 *   clearObjectiveTotal:number,
 *   coreMeltdownActive:boolean,
 *   coreMeltdownT:number,
 *   coreMeltdownEruptT:number,
 *   planetView:boolean,
 *   fogEnabled:boolean,
 *   pendingPerkChoice:any,
 *   objectiveCompleteSfxPlayed:boolean,
 *   objectiveCompleteSfxDelayMs:number|null,
 *   victoryMusicTriggered:boolean,
 *   combatThreatDelayMs:number,
 *   statusCueText:string,
 *   statusCueDelayMs:number,
 *   lastAimWorld:any,
 *   lastAimScreen:any,
 *   title:{
 *     startTitleSeen:boolean,
 *     startTitleAlpha:number,
 *     startTitleFade:boolean,
 *     newGameHelpPromptT:number,
 *     newGameHelpPromptArmed:boolean,
 *   },
 *   hasLaunchedPlayerShip:boolean,
 *   lastHeat:number,
 *   shipWasInWater:boolean,
 * }} GameSaveSnapshot
 */

/** @typedef {{createSaveSnapshot:()=>GameSaveSnapshot, restoreFromSaveSnapshot:(snapshot:GameSaveSnapshot)=>boolean}} SaveLoop */

/**
 * Save current runtime snapshot to localStorage.
 * @param {SaveLoop} game
 * @returns {boolean}
 */
export function saveGameToStorage(game){
  if (!game || typeof game.createSaveSnapshot !== "function") return false;
  try {
    purgeUnversionedLegacySaves();
    const snapshot = game.createSaveSnapshot();
    if (!isSnapshotPersistable(snapshot)){
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch (err){
    console.warn("[Save] write failed", err);
    return false;
  }
}

/**
 * Restore latest runtime snapshot from localStorage.
 * @param {SaveLoop} game
 * @returns {boolean}
 */
export function loadGameFromStorage(game){
  if (!game || typeof game.restoreFromSaveSnapshot !== "function") return false;
  try {
    purgeUnversionedLegacySaves();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    if (!isSnapshotPersistable(snapshot)){
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    const restored = !!game.restoreFromSaveSnapshot(snapshot);
    if (restored){
      localStorage.removeItem(STORAGE_KEY);
    }
    return restored;
  } catch (err){
    console.warn("[Save] read failed", err);
    return false;
  }
}

/**
 * Persist state when the page is backgrounded or closed.
 * @param {SaveLoop} game
 * @returns {() => void}
 */
export function installExitSaveHandlers(game){
  const saveNow = () => {
    saveGameToStorage(game);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden"){
      saveNow();
    }
  };
  const onFreeze = () => {
    saveNow();
  };
  const onPageExit = () => {
    saveNow();
  };
  window.addEventListener("pagehide", onPageExit);
  window.addEventListener("beforeunload", onPageExit);
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("freeze", onFreeze);
  return () => {
    window.removeEventListener("pagehide", onPageExit);
    window.removeEventListener("beforeunload", onPageExit);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("freeze", onFreeze);
  };
}

/**
 * Remove persisted game snapshot.
 * @returns {boolean}
 */
export function clearSavedGame(){
  try {
    localStorage.removeItem(STORAGE_KEY);
    for (const key of LEGACY_STORAGE_KEYS){
      localStorage.removeItem(key);
    }
    return true;
  } catch (err){
    console.warn("[Save] clear failed", err);
    return false;
  }
}

/**
 * Build a versioned runtime snapshot from a game instance.
 * @param {Game} game
 * @returns {GameSaveSnapshot}
 */
export function createGameSaveSnapshot(game){
  const nowMs = performance.now();
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  const planetRuntime = exportPlanetRuntimeState(game.planet);
  const missionState = game.missionState;
  const feedbackState = game.feedbackState;
  const titleState = game.titleState;
  return {
    version: SAVE_SCHEMA_VERSION,
    savedAtUtcMs: Date.now(),
    progressionSeed: game.progressionSeed | 0,
    level: game.level | 0,
    planetSeed: game.planet.getSeed(),
    planetConfigId: cfg ? cfg.id : null,
    planetRuntime: encodePlanetRuntimeState(planetRuntime),

    ship: sanitizeShipForSave(game.ship),
    mothership: {
      x: game.mothership.x,
      y: game.mothership.y,
      vx: game.mothership.vx,
      vy: game.mothership.vy,
      angle: game.mothership.angle,
    },

    miners: cloneSaveData(game.miners),
    fallenMiners: cloneSaveData(game.fallenMiners),
    minersRemaining: game.minersRemaining | 0,
    minersDead: game.minersDead | 0,
    minerTarget: game.minerTarget | 0,
    minerCandidates: game.minerCandidates | 0,
    levelStats: cloneSaveData(game.levelStats),
    overallStats: cloneSaveData(game.overallStats),

    enemies: {
      enemies: cloneSaveData(game.enemies.enemies),
      shots: cloneSaveData(game.enemies.shots),
      explosions: cloneSaveData(game.enemies.explosions),
      debris: cloneSaveData(game.enemies.debris),
    },
    playerShots: cloneSaveData(game.playerShots),
    playerBombs: cloneSaveData(game.playerBombs),
    debris: cloneSaveData(game.debris),
    fragments: cloneSaveData(game.fragments),
    entityExplosions: cloneSaveData(game.entityExplosions),
    popups: cloneSaveData(game.popups),
    shipHitPopups: cloneSaveData(game.shipHitPopups),

    objective: cloneSaveData(game.objective),
    clearObjectiveTotal: missionState.clearObjectiveTotal | 0,
    coreMeltdownActive: !!game.coreMeltdownActive,
    coreMeltdownT: +game.coreMeltdownT || 0,
    coreMeltdownEruptT: +game.coreMeltdownEruptT || 0,

    planetView: !!game.planetView,
    fogEnabled: !!game.fogEnabled,
    pendingPerkChoice: cloneSaveData(game.pendingPerkChoice),
    objectiveCompleteSfxPlayed: !!missionState.objectiveCompleteSfxPlayed,
    objectiveCompleteSfxDelayMs: Number.isFinite(missionState.objectiveCompleteSfxDueAtMs)
      ? Math.max(0, missionState.objectiveCompleteSfxDueAtMs - nowMs)
      : null,
    victoryMusicTriggered: !!missionState.victoryMusicTriggered,
    combatThreatDelayMs: Math.max(0, game.combatThreatUntilMs - nowMs),
    statusCueText: feedbackState.statusCueText || "",
    statusCueDelayMs: Math.max(0, feedbackState.statusCueUntil - nowMs),
    lastAimWorld: cloneSaveData(game.lastAimWorld),
    lastAimScreen: cloneSaveData(game.lastAimScreen),
    title: {
      startTitleSeen: !!titleState.seen,
      startTitleAlpha: +titleState.alpha || 0,
      startTitleFade: !!titleState.fade,
      newGameHelpPromptT: +titleState.newGameHelpPromptT || 0,
      newGameHelpPromptArmed: !!titleState.newGameHelpPromptArmed,
    },
    hasLaunchedPlayerShip: !!game.hasLaunchedPlayerShip,
    lastHeat: +game.lastHeat || 0,
    shipWasInWater: !!game._shipWasInWater,
  };
}

/**
 * Restore game state from a versioned runtime snapshot.
 * @param {Game} game
 * @param {GameSaveSnapshot} snapshot
 * @returns {boolean}
 */
export function restoreGameFromSaveSnapshot(game, snapshot){
  try {
    if (!snapshot || typeof snapshot !== "object") return false;
    if ((snapshot.version | 0) !== SAVE_SCHEMA_VERSION) return false;
    const level = snapshot.level | 0;
    if (level < 1) return false;
    const planetSeed = Number(snapshot.planetSeed);
    if (!Number.isFinite(planetSeed)) return false;
    const progressionSeed = Number(snapshot.progressionSeed);
    if (!Number.isFinite(progressionSeed)) return false;

    game.progressionSeed = progressionSeed | 0;
    levels.beginLevel(game, planetSeed, level);

    const runtimeState = decodePlanetRuntimeState(snapshot.planetRuntime);
    if (runtimeState){
      const newAir = importPlanetRuntimeState(game.planet, runtimeState);
      if (newAir) game.renderer.updateAir(newAir);
    }

    const restoredShip = sanitizeShipForSave(snapshot.ship);
    applyObjectState(game.ship, restoredShip);
    game.ship.guidePath = null;
    if (game.ship._dock && (typeof game.ship._dock.lx !== "number" || typeof game.ship._dock.ly !== "number")){
      game.ship._dock = { lx: GAME.MOTHERSHIP_START_DOCK_X, ly: GAME.MOTHERSHIP_START_DOCK_Y };
    }

    if (snapshot.mothership && typeof snapshot.mothership === "object"){
      if (Number.isFinite(snapshot.mothership.x)) game.mothership.x = snapshot.mothership.x;
      if (Number.isFinite(snapshot.mothership.y)) game.mothership.y = snapshot.mothership.y;
      if (Number.isFinite(snapshot.mothership.vx)) game.mothership.vx = snapshot.mothership.vx;
      if (Number.isFinite(snapshot.mothership.vy)) game.mothership.vy = snapshot.mothership.vy;
      if (Number.isFinite(snapshot.mothership.angle)) game.mothership.angle = snapshot.mothership.angle;
    }

    game.miners = Array.isArray(snapshot.miners) ? cloneSaveData(snapshot.miners) : [];
    game.fallenMiners = Array.isArray(snapshot.fallenMiners) ? cloneSaveData(snapshot.fallenMiners) : [];
    game.minersRemaining = clampNonNegativeInt(snapshot.minersRemaining, game.miners.length);
    game.minersDead = clampNonNegativeInt(snapshot.minersDead, 0);
    game.minerTarget = clampNonNegativeInt(snapshot.minerTarget, game.minersRemaining + game.minersDead);
    game.minerCandidates = clampNonNegativeInt(snapshot.minerCandidates, game.miners.length);
    const makeRunStats = () => stats.createRunStats(game);
    game.levelStats = Object.assign(makeRunStats(), (snapshot.levelStats && typeof snapshot.levelStats === "object")
      ? cloneSaveData(snapshot.levelStats)
      : {});
    game.overallStats = Object.assign(makeRunStats(), (snapshot.overallStats && typeof snapshot.overallStats === "object")
      ? cloneSaveData(snapshot.overallStats)
      : {});

    const enemies = snapshot.enemies || {};
    game.enemies.enemies = Array.isArray(enemies.enemies) ? cloneSaveData(enemies.enemies) : [];
    game.enemies.shots = Array.isArray(enemies.shots) ? cloneSaveData(enemies.shots) : [];
    game.enemies.explosions = Array.isArray(enemies.explosions) ? cloneSaveData(enemies.explosions) : [];
    game.enemies.debris = Array.isArray(enemies.debris) ? cloneSaveData(enemies.debris) : [];

    game.playerShots = Array.isArray(snapshot.playerShots) ? cloneSaveData(snapshot.playerShots) : [];
    game.playerBombs = Array.isArray(snapshot.playerBombs) ? cloneSaveData(snapshot.playerBombs) : [];
    game.debris = Array.isArray(snapshot.debris) ? cloneSaveData(snapshot.debris) : [];
    game.fragments = Array.isArray(snapshot.fragments) ? cloneSaveData(snapshot.fragments) : [];
    game.entityExplosions = Array.isArray(snapshot.entityExplosions) ? cloneSaveData(snapshot.entityExplosions) : [];
    game.popups = Array.isArray(snapshot.popups) ? cloneSaveData(snapshot.popups) : [];
    game.shipHitPopups = Array.isArray(snapshot.shipHitPopups) ? cloneSaveData(snapshot.shipHitPopups) : [];
    game.pickupAnimations = [];

    game.objective = (snapshot.objective && typeof snapshot.objective === "object")
      ? cloneSaveData(snapshot.objective)
      : game.objective;
    game.missionState.clearObjectiveTotal = clampNonNegativeInt(snapshot.clearObjectiveTotal, game.missionState.clearObjectiveTotal);
    game.coreMeltdownActive = !!snapshot.coreMeltdownActive;
    game.coreMeltdownT = clampNonNegativeNumber(snapshot.coreMeltdownT, 0);
    game.coreMeltdownEruptT = clampNonNegativeNumber(snapshot.coreMeltdownEruptT, 0);

    game.planetView = !!snapshot.planetView;
    game.fogEnabled = !!snapshot.fogEnabled;
    game.pendingPerkChoice = Array.isArray(snapshot.pendingPerkChoice) ? cloneSaveData(snapshot.pendingPerkChoice) : null;
    game.missionState.objectiveCompleteSfxPlayed = !!snapshot.objectiveCompleteSfxPlayed;
    game.missionState.victoryMusicTriggered = !!snapshot.victoryMusicTriggered;
    game.feedbackState.statusCueText = (typeof snapshot.statusCueText === "string") ? snapshot.statusCueText : "";
    game.lastAimWorld = (snapshot.lastAimWorld && typeof snapshot.lastAimWorld === "object") ? cloneSaveData(snapshot.lastAimWorld) : null;
    game.lastAimScreen = (snapshot.lastAimScreen && typeof snapshot.lastAimScreen === "object") ? cloneSaveData(snapshot.lastAimScreen) : null;

    // Debug toggles are intentionally session-local and not persisted.
    game.debugState.collisions = GAME.DEBUG_COLLISION;
    game.debugState.planetTriangles = false;
    game.debugState.collisionContours = false;
    game.debugState.minerGuidePath = false;
    game.debugState.ringVertices = false;
    game.debugState.minerPathToMiner = null;
    game.debugState.frameStepMode = false;
    game.debugState.devHudVisible = false;
    game.debugState.lastLandingDebugConsoleLine = "";
    game.debugState.landingDebugSessionActive = false;
    game.debugState.landingDebugSessionFrame = 0;
    game.debugState.landingDebugSessionSource = "";
    game.debugState.minerPathDebugCooldown = 0;
    game.hud.style.display = "none";

    const title = snapshot.title || {};
    game.titleState.seen = !!title.startTitleSeen;
    game.titleState.alpha = clampRange(title.startTitleAlpha, 0, 1, game.titleState.seen ? 0 : 1);
    game.titleState.fade = !!title.startTitleFade;
    game.titleState.newGameHelpPromptT = clampNonNegativeNumber(title.newGameHelpPromptT, 0);
    game.titleState.newGameHelpPromptArmed = !!title.newGameHelpPromptArmed;
    game.hasLaunchedPlayerShip = (typeof snapshot.hasLaunchedPlayerShip === "boolean")
      ? snapshot.hasLaunchedPlayerShip
      : ((snapshot.level | 0) > 1 || (snapshot.ship && (snapshot.ship.state === "flying" || snapshot.ship._dock === null)));
    game.lastHeat = clampNonNegativeNumber(snapshot.lastHeat, 0);
    game._shipWasInWater = !!snapshot.shipWasInWater;

    const nowMs = performance.now();
    game.combatThreatUntilMs = nowMs + clampNonNegativeNumber(snapshot.combatThreatDelayMs, 0);
    const objectiveDueMs = snapshot.objectiveCompleteSfxDelayMs;
    game.missionState.objectiveCompleteSfxDueAtMs = Number.isFinite(objectiveDueMs)
      ? (nowMs + clampNonNegativeNumber(objectiveDueMs, 0))
      : Number.POSITIVE_INFINITY;
    game.feedbackState.statusCueUntil = nowMs + clampNonNegativeNumber(snapshot.statusCueDelayMs, 0);

    game.accumulator = 0;
    game.lastTime = nowMs;
    game.perfState.fpsTime = nowMs;
    game.perfState.fpsFrames = 0;
    game.perfState.fps = 0;
    game.perfState.frameStats = null;
    game.perfState.frameStatsUpdatedAt = nowMs;
    if (game.perfState.frameStatsTracker && typeof game.perfState.frameStatsTracker.reset === "function"){
      game.perfState.frameStatsTracker.reset();
    }
    if (game.perfState.benchmarkRun){
      game.perfState.benchmarkRun.startedAtMs = 0;
      game.perfState.benchmarkRun.sampleStartAtMs = 0;
      game.perfState.benchmarkRun.sampleEndAtMs = 0;
      game.perfState.benchmarkRun.active = false;
      game.perfState.benchmarkRun.finished = false;
      game.perfState.benchmarkRun.stateText = `warmup ${Math.ceil(BENCH_CONFIG.warmupMs / 1000)}s`;
      game.perfState.benchmarkRun.result = null;
      if (game.perfState.benchmarkRun.tracker && typeof game.perfState.benchmarkRun.tracker.reset === "function"){
        game.perfState.benchmarkRun.tracker.reset();
      }
    }
    game.ship._samples = null;
    game.ship._collision = null;
    tether.syncTetherProtectionStates(game);
    game.planet.reconcileFeatures({
      enemies: game.enemies.enemies,
      miners: game.miners,
    });
    game.renderer.setPlanet(game.planet);
    planetFog.syncRenderFog(game.planet, game.renderer, game.ship.x, game.ship.y);
    audioState.setThrustLoopActive(game, false);
    audioState.setCombatActive(game, false);
    return true;
  } catch (err){
    console.warn("[Save] restore failed", err);
    return false;
  }
}

/**
 * @param {any} ship
 * @returns {any}
 */
function sanitizeShipForSave(ship){
  const out = cloneSaveData(ship && typeof ship === "object" ? ship : {});
  out.guidePath = null;
  delete out._samples;
  delete out._collision;
  if (out._dock && (typeof out._dock.lx !== "number" || typeof out._dock.ly !== "number")){
    out._dock = { lx: GAME.MOTHERSHIP_START_DOCK_X, ly: GAME.MOTHERSHIP_START_DOCK_Y };
  }
  return out;
}

/**
 * @param {{air:Uint8Array,props:Array<any>,fog:{alpha:Float32Array,visible:Uint8Array,seen:Uint8Array,hold:Uint8Array,cursor:number}}|null|undefined} state
 * @returns {any|null}
 */
function encodePlanetRuntimeState(state){
  if (!state) return null;
  return {
    airLen: state.air.length,
    airB64: uint8ToBase64(state.air),
    props: cloneSaveData(state.props || []),
    fog: {
      alphaLen: state.fog.alpha.length,
      alphaB64: float32ToBase64(state.fog.alpha),
      visibleLen: state.fog.visible.length,
      visibleB64: uint8ToBase64(state.fog.visible),
      seenLen: state.fog.seen.length,
      seenB64: uint8ToBase64(state.fog.seen),
      holdLen: state.fog.hold.length,
      holdB64: uint8ToBase64(state.fog.hold),
      cursor: state.fog.cursor | 0,
    },
  };
}

/**
 * @param {import("./planet.js").Planet} planet
 * @returns {{
 *  air:Uint8Array,
 *  props:Array<any>,
 *  fog:{
 *    alpha:Float32Array,
 *    visible:Uint8Array,
 *    seen:Uint8Array,
 *    hold:Uint8Array,
 *    cursor:number
 *  }
 * }}
 */
function exportPlanetRuntimeState(planet){
  const world = planet.mapgen.getWorld();
  const srcAir = (world && world.air instanceof Uint8Array) ? world.air : new Uint8Array(0);
  const air = new Uint8Array(srcAir);
  const props = Array.isArray(planet.props) ? planet.props.map((prop) => cloneSaveData(prop)) : [];
  const fog = planet.radial.exportFogState();
  return { air, props, fog };
}

/**
 * @param {import("./planet.js").Planet} planet
 * @param {{
 *  air:Uint8Array,
 *  props?:Array<any>,
 *  fog?:{
 *    alpha:Float32Array,
 *    visible:Uint8Array,
 *    seen:Uint8Array,
 *    hold:Uint8Array,
 *    cursor:number
 *  }
 * }|null|undefined} state
 * @returns {Float32Array|undefined}
 */
function importPlanetRuntimeState(planet, state){
  if (!state || !(state.air instanceof Uint8Array)){
    return undefined;
  }
  const world = planet.mapgen.getWorld();
  if (!world || !(world.air instanceof Uint8Array) || world.air.length !== state.air.length){
    return undefined;
  }
  world.air.set(state.air);
  const newAir = planet._refreshAirAfterEdit();

  if (Array.isArray(state.props) && Array.isArray(planet.props)){
    const count = Math.min(planet.props.length, state.props.length);
    for (let i = 0; i < count; i++){
      const src = state.props[i];
      const dst = planet.props[i];
      if (!src || typeof src !== "object" || !dst || typeof dst !== "object") continue;
      /** @type {Record<string, any>} */
      const srcRecord = /** @type {Record<string, any>} */ (src);
      /** @type {Record<string, any>} */
      const dstRecord = /** @type {Record<string, any>} */ (dst);
      for (const key of Object.keys(dstRecord)){
        if (!Object.prototype.hasOwnProperty.call(srcRecord, key)){
          delete dstRecord[key];
        }
      }
      for (const key of Object.keys(srcRecord)){
        dstRecord[key] = cloneSaveData(srcRecord[key]);
      }
    }
  }
  if (state.fog){
    planet.radial.importFogState(state.fog);
  }
  return newAir;
}

/**
 * @param {any} state
 * @returns {{air:Uint8Array,props:Array<any>,fog:{alpha:Float32Array,visible:Uint8Array,seen:Uint8Array,hold:Uint8Array,cursor:number}}|null}
 */
function decodePlanetRuntimeState(state){
  if (!state || typeof state !== "object") return null;
  const air = base64ToUint8(state.airB64, state.airLen | 0);
  if (!air) return null;
  const fog = state.fog || {};
  const alpha = base64ToFloat32(fog.alphaB64, fog.alphaLen | 0);
  const visible = base64ToUint8(fog.visibleB64, fog.visibleLen | 0);
  const seen = base64ToUint8(fog.seenB64, fog.seenLen | 0);
  const hold = base64ToUint8(fog.holdB64, fog.holdLen | 0);
  if (!alpha || !visible || !seen || !hold) return null;
  return {
    air,
    props: Array.isArray(state.props) ? cloneSaveData(state.props) : [],
    fog: {
      alpha,
      visible,
      seen,
      hold,
      cursor: fog.cursor | 0,
    },
  };
}

/**
 * @param {object} target
 * @param {object} source
 * @returns {void}
 */
function applyObjectState(target, source){
  const targetObj = /** @type {Record<string, any>} */ (target);
  const sourceObj = /** @type {Record<string, any>} */ (source);
  for (const key of Object.keys(sourceObj)){
    targetObj[key] = cloneSaveData(sourceObj[key]);
  }
}

/**
 * @param {any} value
 * @returns {any}
 */
function cloneSaveData(value){
  if (value === null || typeof value !== "object"){
    return value;
  }
  if (Array.isArray(value)){
    return value.map((v) => cloneSaveData(v));
  }
  const valueObj = /** @type {Record<string, any>} */ (value);
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of Object.keys(valueObj)){
    const v = valueObj[key];
    if (typeof v === "function" || v === undefined) continue;
    out[key] = cloneSaveData(v);
  }
  return out;
}

/**
 * @param {Uint8Array} value
 * @returns {string}
 */
function uint8ToBase64(value){
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < value.length; i += chunk){
    const slice = value.subarray(i, i + chunk);
    let part = "";
    for (let j = 0; j < slice.length; j++){
      part += String.fromCharCode(/** @type {number} */ (slice[j]));
    }
    binary += part;
  }
  return btoa(binary);
}

/**
 * @param {Float32Array} value
 * @returns {string}
 */
function float32ToBase64(value){
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return uint8ToBase64(bytes);
}

/**
 * @param {string} b64
 * @param {number} expectedLen
 * @returns {Uint8Array|null}
 */
function base64ToUint8(b64, expectedLen){
  if (typeof b64 !== "string" || expectedLen < 0) return null;
  const binary = atob(b64);
  if (binary.length !== expectedLen) return null;
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++){
    out[i] = binary.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * @param {string} b64
 * @param {number} expectedLen
 * @returns {Float32Array|null}
 */
function base64ToFloat32(b64, expectedLen){
  const bytes = base64ToUint8(b64, expectedLen * 4);
  if (!bytes) return null;
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

/**
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
function clampNonNegativeNumber(value, fallback){
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

/**
 * @param {any} value
 * @param {number} fallback
 * @returns {number}
 */
function clampNonNegativeInt(value, fallback){
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n | 0);
}

/**
 * @param {any} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampRange(value, min, max, fallback){
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/**
 * Delete legacy save entries that predate snapshot versioning.
 * @returns {void}
 */
function purgeUnversionedLegacySaves(){
  for (const key of LEGACY_STORAGE_KEYS){
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const snapshot = JSON.parse(raw);
      if (!hasSnapshotVersion(snapshot)){
        localStorage.removeItem(key);
      }
    } catch {
      localStorage.removeItem(key);
    }
  }
}

/**
 * @param {any} snapshot
 * @returns {boolean}
 */
function hasSnapshotVersion(snapshot){
  return !!snapshot
    && typeof snapshot === "object"
    && Number.isFinite(snapshot.version)
    && (snapshot.version | 0) > 0;
}

/**
 * @param {any} snapshot
 * @returns {boolean}
 */
function isSnapshotPersistable(snapshot){
  if (!snapshot || typeof snapshot !== "object") return false;
  if (!hasSnapshotVersion(snapshot)) return false;
  const level = snapshot.level | 0;
  const ship = snapshot.ship || null;
  const hardGameOver = !!(ship && ship.state === "crashed" && ((ship.mothershipPilots | 0) <= 0));
  if (hardGameOver){
    return false;
  }
  if (level === 1 && !snapshot.hasLaunchedPlayerShip){
    return false;
  }
  return true;
}


