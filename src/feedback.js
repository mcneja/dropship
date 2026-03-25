// @ts-check
/** @typedef {import("./game.js").Game} Game */

import * as stats from "./stats.js";

/** @typedef {Gamepad & {hapticActuators?: Array<{pulse:(value:number, durationMs:number)=>Promise<void>}>}} LegacyHapticGamepad */

export class FeedbackState {
  constructor(){
    this.statusCueText = "";
    this.statusCueUntil = 0;
    this.screenshotCopyInFlight = false;
    this.rumbleWeak = 0;
    this.rumbleStrong = 0;
    this.rumbleUntilMs = 0;
    this.lastRumbleApplyMs = 0;
    this.lastRumbleWeakApplied = 0;
    this.lastRumbleStrongApplied = 0;
    this.lastBrowserVibrateMs = 0;
  }
}

/**
 * @param {Game} game
 * @param {string} text
 * @param {number} [duration]
 * @returns {void}
 */
export function showStatusCue(game, text, duration = 1.5){
  game.feedbackState.statusCueText = text || "";
  game.feedbackState.statusCueUntil = performance.now() + Math.max(0.1, duration) * 1000;
  stats.markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function showZoomCue(game){
  showStatusCue(game, `Zoom ${game.camera.currentZoomMultiplier().toFixed(2)}x`, 1.0);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {number} destroyedCount
 * @returns {void}
 */
export function addTerrainDestructionShake(game, x, y, destroyedCount){
  const count = Math.max(0, destroyedCount || 0);
  if (!(count > 0)) return;
  const dx = game.ship.x - x;
  const dy = game.ship.y - y;
  const dist = Math.hypot(dx, dy);
  const reach = 8.5;
  if (dist >= reach) return;
  const proximity = 1 - (dist / reach);
  const strength = (0.038 + Math.min(0.06, count * 0.018)) * proximity * proximity;
  game.camera.addScreenShake(strength);
}

/**
 * @param {Game} game
 * @param {number} weak
 * @param {number} strong
 * @param {number} [durationMs]
 * @returns {void}
 */
export function queueRumble(game, weak, strong, durationMs = 140){
  const feedbackState = game.feedbackState;
  const w = Math.max(0, Math.min(1, weak || 0));
  const s = Math.max(0, Math.min(1, strong || 0));
  if (!(w > 0 || s > 0)) return;
  feedbackState.rumbleWeak = Math.max(feedbackState.rumbleWeak, w);
  feedbackState.rumbleStrong = Math.max(feedbackState.rumbleStrong, s);
  const now = Number.isFinite(game.lastTime) ? game.lastTime : performance.now();
  feedbackState.rumbleUntilMs = Math.max(feedbackState.rumbleUntilMs, now + Math.max(16, durationMs || 0));
}

/**
 * @param {Game} game
 * @param {number} weak
 * @param {number} strong
 * @param {number} durationMs
 * @returns {boolean}
 */
export function applyGamepadRumble(game, weak, strong, durationMs){
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return false;
  const pads = navigator.getGamepads() || [];
  let applied = false;
  for (const pad of pads){
    if (!pad) continue;
    const actuator = pad.vibrationActuator;
    if (actuator && typeof actuator.playEffect === "function"){
      applied = true;
      actuator.playEffect("dual-rumble", {
        duration: Math.max(16, Math.round(durationMs)),
        weakMagnitude: weak,
        strongMagnitude: strong,
        startDelay: 0,
      }).catch(() => {});
      continue;
    }
    const legacyPad = /** @type {LegacyHapticGamepad} */ (pad);
    const haptics = Array.isArray(legacyPad.hapticActuators) ? legacyPad.hapticActuators : [];
    if (!haptics.length) continue;
    applied = true;
    const mag = Math.max(weak, strong);
    for (const h of haptics){
      if (h && typeof h.pulse === "function"){
        const pulseResult = /** @type {Promise<unknown>} */ (h.pulse(mag, Math.max(16, Math.round(durationMs))));
        pulseResult.catch(() => {});
      }
    }
  }
  return applied;
}

/**
 * @param {Game} game
 * @param {number} durationMs
 * @returns {void}
 */
export function applyBrowserVibration(game, durationMs){
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  const now = game.lastTime || performance.now();
  if (now - game.feedbackState.lastBrowserVibrateMs < 120) return;
  game.feedbackState.lastBrowserVibrateMs = now;
  navigator.vibrate(Math.max(20, Math.min(180, Math.round(durationMs))));
}

/**
 * @param {Game} game
 * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
 * @param {number} now
 * @returns {void}
 */
export function flushRumble(game, inputType, now){
  const feedbackState = game.feedbackState;
  const active = now < feedbackState.rumbleUntilMs;
  const weak = active ? feedbackState.rumbleWeak : 0;
  const strong = active ? feedbackState.rumbleStrong : 0;
  const prevWeak = feedbackState.lastRumbleWeakApplied || 0;
  const prevStrong = feedbackState.lastRumbleStrongApplied || 0;
  const hadPrev = prevWeak > 1e-3 || prevStrong > 1e-3;
  const changed = Math.abs(prevWeak - weak) > 0.03 || Math.abs(prevStrong - strong) > 0.03;
  if ((active || hadPrev) && (changed || now - feedbackState.lastRumbleApplyMs >= 90)){
    const durationMs = active ? Math.max(40, feedbackState.rumbleUntilMs - now) : 40;
    const appliedToPad = applyGamepadRumble(game, weak, strong, durationMs);
    if (!appliedToPad && strong >= 0.35 && (inputType === "touch" || inputType === "gamepad")){
      applyBrowserVibration(game, durationMs);
    }
    feedbackState.lastRumbleWeakApplied = weak;
    feedbackState.lastRumbleStrongApplied = strong;
    feedbackState.lastRumbleApplyMs = now;
  }
  if (!active){
    feedbackState.rumbleWeak = 0;
    feedbackState.rumbleStrong = 0;
    feedbackState.rumbleUntilMs = 0;
  }
}

/**
 * @param {Array<{x:number,y:number,vx:number,vy:number,life:number}>} popups
 * @param {number} dt
 * @returns {void}
 */
function updatePopupList(popups, dt){
  if (!popups.length) return;
  for (let i = popups.length - 1; i >= 0; i--){
    const popup = popups[i];
    if (!popup) continue;
    popup.x += popup.vx * dt;
    popup.y += popup.vy * dt;
    popup.life -= dt;
    if (popup.life <= 0) popups.splice(i, 1);
  }
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function updateTransientPopups(game, dt){
  updatePopupList(game.popups, dt);
  updatePopupList(game.shipHitPopups, dt);
}


