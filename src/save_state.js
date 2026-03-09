// @ts-check

import { GAME } from "./config.js";

const STORAGE_KEY = "dropship.save.v1";
export const SAVE_SCHEMA_VERSION = 1;

/** @typedef {{createSaveSnapshot:()=>any, restoreFromSaveSnapshot:(snapshot:any)=>boolean}} SaveLoop */

/**
 * Save current runtime snapshot to localStorage.
 * @param {SaveLoop} loop
 * @returns {boolean}
 */
export function saveGameToStorage(loop){
  if (!loop || typeof loop.createSaveSnapshot !== "function") return false;
  try {
    const snapshot = loop.createSaveSnapshot();
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
 * @param {SaveLoop} loop
 * @returns {boolean}
 */
export function loadGameFromStorage(loop){
  if (!loop || typeof loop.restoreFromSaveSnapshot !== "function") return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const snapshot = JSON.parse(raw);
    if (!isSnapshotPersistable(snapshot)){
      localStorage.removeItem(STORAGE_KEY);
      return false;
    }
    return !!loop.restoreFromSaveSnapshot(snapshot);
  } catch (err){
    console.warn("[Save] read failed", err);
    return false;
  }
}

/**
 * Persist state when the page is backgrounded or closed.
 * @param {SaveLoop} loop
 * @returns {() => void}
 */
export function installExitSaveHandlers(loop){
  const saveNow = () => {
    saveGameToStorage(loop);
  };
  const onVisibility = () => {
    if (document.visibilityState === "hidden"){
      saveNow();
    }
  };
  window.addEventListener("pagehide", saveNow);
  window.addEventListener("beforeunload", saveNow);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("pagehide", saveNow);
    window.removeEventListener("beforeunload", saveNow);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/**
 * Remove persisted game snapshot.
 * @returns {boolean}
 */
export function clearSavedGame(){
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (err){
    console.warn("[Save] clear failed", err);
    return false;
  }
}

/**
 * Build a versioned runtime snapshot from a GameLoop-like object.
 * @param {any} loop
 * @returns {any}
 */
export function createLoopSaveSnapshot(loop){
  const nowMs = performance.now();
  const cfg = loop.planet && loop.planet.getPlanetConfig ? loop.planet.getPlanetConfig() : null;
  const planetRuntime = loop.planet.exportRuntimeState();
  return {
    version: SAVE_SCHEMA_VERSION,
    savedAtUtcMs: Date.now(),
    progressionSeed: loop.progressionSeed | 0,
    level: loop.level | 0,
    planetSeed: loop.planet.getSeed(),
    planetConfigId: cfg ? cfg.id : null,
    planetRuntime: encodePlanetRuntimeState(planetRuntime),

    ship: sanitizeShipForSave(loop.ship),
    mothership: {
      x: loop.mothership.x,
      y: loop.mothership.y,
      vx: loop.mothership.vx,
      vy: loop.mothership.vy,
      angle: loop.mothership.angle,
    },

    miners: cloneSaveData(loop.miners),
    minersRemaining: loop.minersRemaining | 0,
    minersDead: loop.minersDead | 0,
    minerTarget: loop.minerTarget | 0,
    minerCandidates: loop.minerCandidates | 0,

    enemies: {
      enemies: cloneSaveData(loop.enemies.enemies),
      shots: cloneSaveData(loop.enemies.shots),
      explosions: cloneSaveData(loop.enemies.explosions),
      debris: cloneSaveData(loop.enemies.debris),
    },
    playerShots: cloneSaveData(loop.playerShots),
    playerBombs: cloneSaveData(loop.playerBombs),
    debris: cloneSaveData(loop.debris),
    entityExplosions: cloneSaveData(loop.entityExplosions),
    minerPopups: cloneSaveData(loop.minerPopups),
    shipHitPopups: cloneSaveData(loop.shipHitPopups),

    objective: cloneSaveData(loop.objective),
    clearObjectiveTotal: loop.clearObjectiveTotal | 0,
    coreMeltdownActive: !!loop.coreMeltdownActive,
    coreMeltdownT: +loop.coreMeltdownT || 0,
    coreMeltdownEruptT: +loop.coreMeltdownEruptT || 0,

    planetView: !!loop.planetView,
    fogEnabled: !!loop.fogEnabled,
    pendingPerkChoice: cloneSaveData(loop.pendingPerkChoice),
    objectiveCompleteSfxPlayed: !!loop.objectiveCompleteSfxPlayed,
    objectiveCompleteSfxDelayMs: Number.isFinite(loop.objectiveCompleteSfxDueAtMs)
      ? Math.max(0, loop.objectiveCompleteSfxDueAtMs - nowMs)
      : null,
    victoryMusicTriggered: !!loop.victoryMusicTriggered,
    combatThreatDelayMs: Math.max(0, loop.combatThreatUntilMs - nowMs),
    statusCueText: loop.statusCueText || "",
    statusCueDelayMs: Math.max(0, loop.statusCueUntil - nowMs),
    lastAimWorld: cloneSaveData(loop.lastAimWorld),
    lastAimScreen: cloneSaveData(loop.lastAimScreen),
    title: {
      startTitleSeen: !!loop.startTitleSeen,
      startTitleAlpha: +loop.startTitleAlpha || 0,
      startTitleFade: !!loop.startTitleFade,
      newGameHelpPromptT: +loop.newGameHelpPromptT || 0,
      newGameHelpPromptArmed: !!loop.newGameHelpPromptArmed,
    },
    hasLaunchedPlayerShip: !!loop.hasLaunchedPlayerShip,
    lastHeat: +loop.lastHeat || 0,
    shipWasInWater: !!loop._shipWasInWater,
  };
}

/**
 * Restore loop state from a versioned runtime snapshot.
 * @param {any} loop
 * @param {any} snapshot
 * @returns {boolean}
 */
export function restoreLoopFromSaveSnapshot(loop, snapshot){
  try {
    if (!snapshot || typeof snapshot !== "object") return false;
    if ((snapshot.version | 0) !== SAVE_SCHEMA_VERSION) return false;
    const level = snapshot.level | 0;
    if (level < 1) return false;
    const planetSeed = Number(snapshot.planetSeed);
    if (!Number.isFinite(planetSeed)) return false;
    const progressionSeed = Number(snapshot.progressionSeed);
    if (!Number.isFinite(progressionSeed)) return false;

    loop.progressionSeed = progressionSeed | 0;
    loop._beginLevel(planetSeed, level);

    const runtimeState = decodePlanetRuntimeState(snapshot.planetRuntime);
    if (runtimeState){
      const newAir = loop.planet.importRuntimeState(runtimeState);
      if (newAir) loop.renderer.updateAir(newAir);
    }

    const restoredShip = sanitizeShipForSave(snapshot.ship);
    applyObjectState(loop.ship, restoredShip);
    loop.ship.guidePath = null;
    if (loop.ship._dock && (typeof loop.ship._dock.lx !== "number" || typeof loop.ship._dock.ly !== "number")){
      loop.ship._dock = { lx: GAME.MOTHERSHIP_START_DOCK_X, ly: GAME.MOTHERSHIP_START_DOCK_Y };
    }

    if (snapshot.mothership && typeof snapshot.mothership === "object"){
      if (Number.isFinite(snapshot.mothership.x)) loop.mothership.x = snapshot.mothership.x;
      if (Number.isFinite(snapshot.mothership.y)) loop.mothership.y = snapshot.mothership.y;
      if (Number.isFinite(snapshot.mothership.vx)) loop.mothership.vx = snapshot.mothership.vx;
      if (Number.isFinite(snapshot.mothership.vy)) loop.mothership.vy = snapshot.mothership.vy;
      if (Number.isFinite(snapshot.mothership.angle)) loop.mothership.angle = snapshot.mothership.angle;
    }

    loop.miners = Array.isArray(snapshot.miners) ? cloneSaveData(snapshot.miners) : [];
    loop.minersRemaining = clampNonNegativeInt(snapshot.minersRemaining, loop.miners.length);
    loop.minersDead = clampNonNegativeInt(snapshot.minersDead, 0);
    loop.minerTarget = clampNonNegativeInt(snapshot.minerTarget, loop.minersRemaining + loop.minersDead);
    loop.minerCandidates = clampNonNegativeInt(snapshot.minerCandidates, loop.miners.length);

    const enemies = snapshot.enemies || {};
    loop.enemies.enemies = Array.isArray(enemies.enemies) ? cloneSaveData(enemies.enemies) : [];
    loop.enemies.shots = Array.isArray(enemies.shots) ? cloneSaveData(enemies.shots) : [];
    loop.enemies.explosions = Array.isArray(enemies.explosions) ? cloneSaveData(enemies.explosions) : [];
    loop.enemies.debris = Array.isArray(enemies.debris) ? cloneSaveData(enemies.debris) : [];

    loop.playerShots = Array.isArray(snapshot.playerShots) ? cloneSaveData(snapshot.playerShots) : [];
    loop.playerBombs = Array.isArray(snapshot.playerBombs) ? cloneSaveData(snapshot.playerBombs) : [];
    loop.debris = Array.isArray(snapshot.debris) ? cloneSaveData(snapshot.debris) : [];
    loop.entityExplosions = Array.isArray(snapshot.entityExplosions) ? cloneSaveData(snapshot.entityExplosions) : [];
    loop.minerPopups = Array.isArray(snapshot.minerPopups) ? cloneSaveData(snapshot.minerPopups) : [];
    loop.shipHitPopups = Array.isArray(snapshot.shipHitPopups) ? cloneSaveData(snapshot.shipHitPopups) : [];

    loop.objective = (snapshot.objective && typeof snapshot.objective === "object")
      ? cloneSaveData(snapshot.objective)
      : loop.objective;
    loop.clearObjectiveTotal = clampNonNegativeInt(snapshot.clearObjectiveTotal, loop.clearObjectiveTotal);
    loop.coreMeltdownActive = !!snapshot.coreMeltdownActive;
    loop.coreMeltdownT = clampNonNegativeNumber(snapshot.coreMeltdownT, 0);
    loop.coreMeltdownEruptT = clampNonNegativeNumber(snapshot.coreMeltdownEruptT, 0);

    loop.planetView = !!snapshot.planetView;
    loop.fogEnabled = !!snapshot.fogEnabled;
    loop.pendingPerkChoice = Array.isArray(snapshot.pendingPerkChoice) ? cloneSaveData(snapshot.pendingPerkChoice) : null;
    loop.objectiveCompleteSfxPlayed = !!snapshot.objectiveCompleteSfxPlayed;
    loop.victoryMusicTriggered = !!snapshot.victoryMusicTriggered;
    loop.statusCueText = (typeof snapshot.statusCueText === "string") ? snapshot.statusCueText : "";
    loop.lastAimWorld = (snapshot.lastAimWorld && typeof snapshot.lastAimWorld === "object") ? cloneSaveData(snapshot.lastAimWorld) : null;
    loop.lastAimScreen = (snapshot.lastAimScreen && typeof snapshot.lastAimScreen === "object") ? cloneSaveData(snapshot.lastAimScreen) : null;

    // Debug toggles are intentionally session-local and not persisted.
    loop.debugCollisions = GAME.DEBUG_COLLISION;
    loop.debugPlanetTriangles = false;
    loop.debugCollisionContours = false;
    loop.devHudVisible = false;
    loop.hud.style.display = "none";

    const title = snapshot.title || {};
    loop.startTitleSeen = !!title.startTitleSeen;
    loop.startTitleAlpha = clampRange(title.startTitleAlpha, 0, 1, loop.startTitleSeen ? 0 : 1);
    loop.startTitleFade = !!title.startTitleFade;
    loop.newGameHelpPromptT = clampNonNegativeNumber(title.newGameHelpPromptT, 0);
    loop.newGameHelpPromptArmed = !!title.newGameHelpPromptArmed;
    loop.hasLaunchedPlayerShip = (typeof snapshot.hasLaunchedPlayerShip === "boolean")
      ? snapshot.hasLaunchedPlayerShip
      : ((snapshot.level | 0) > 1 || (snapshot.ship && (snapshot.ship.state === "flying" || snapshot.ship._dock === null)));
    loop.lastHeat = clampNonNegativeNumber(snapshot.lastHeat, 0);
    loop._shipWasInWater = !!snapshot.shipWasInWater;

    const nowMs = performance.now();
    loop.combatThreatUntilMs = nowMs + clampNonNegativeNumber(snapshot.combatThreatDelayMs, 0);
    const objectiveDueMs = snapshot.objectiveCompleteSfxDelayMs;
    loop.objectiveCompleteSfxDueAtMs = Number.isFinite(objectiveDueMs)
      ? (nowMs + clampNonNegativeNumber(objectiveDueMs, 0))
      : Number.POSITIVE_INFINITY;
    loop.statusCueUntil = nowMs + clampNonNegativeNumber(snapshot.statusCueDelayMs, 0);

    loop.accumulator = 0;
    loop.lastTime = nowMs;
    loop.fpsTime = nowMs;
    loop.fpsFrames = 0;
    loop.ship._samples = null;
    loop.ship._collision = null;
    loop._syncTetherProtectionStates();
    loop.planet.reconcileFeatures({
      enemies: loop.enemies.enemies,
      miners: loop.miners,
    });
    loop.renderer.setPlanet(loop.planet);
    loop.planet.syncRenderFog(loop.renderer, loop.ship.x, loop.ship.y);
    loop._setThrustLoopActive(false);
    loop._setCombatActive(false);
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
  for (const key of Object.keys(source)){
    target[key] = cloneSaveData(source[key]);
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
  const out = {};
  for (const key of Object.keys(value)){
    const v = value[key];
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
      part += String.fromCharCode(slice[j]);
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
 * @param {any} snapshot
 * @returns {boolean}
 */
function isSnapshotPersistable(snapshot){
  if (!snapshot || typeof snapshot !== "object") return false;
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
