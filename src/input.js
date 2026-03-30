// @ts-check

/** @typedef {import("./types.d.js").Point} Point */
/** @typedef {import("./types.d.js").InputState} InputState */

import { TOUCH_UI, GAME } from "./config.js";
import { perkChoiceIndexAtPoint } from "./perk_choice_ui.js";

const KEY_LEFT = new Set(["ArrowLeft", "a", "A"]);
const KEY_RIGHT = new Set(["ArrowRight", "d", "D"]);
const KEY_THRUST = new Set([" ", "Space", "ArrowUp", "w", "W"]);
const KEY_DOWN = new Set(["ArrowDown", "s", "S"]);
const TOUCH_PERK_CHOICE_TOP = 0.24;
const TOUCH_PERK_CHOICE_BOTTOM = 0.76;
const TOUCH_RESTART_LABEL = "↻";
const TOUCH_LAUNCH_LABEL = "▲";

function ensureTouchDockStyles(){
  if (typeof document === "undefined" || document.getElementById("touch-dock-style")) return;
  const style = document.createElement("style");
  style.id = "touch-dock-style";
  style.textContent = `
    #touch-action-toggle,
    #touch-launch-toggle {
      position: fixed;
      bottom: max(calc(env(safe-area-inset-bottom) + 16px), 9dvh);
      height: 42px;
      border-radius: 999px;
      display: none;
      place-items: center;
      z-index: 45;
      text-shadow: 0 1px 3px rgba(0,0,0,0.7);
      box-shadow: 0 3px 12px rgba(0,0,0,0.35);
      padding: 0;
      pointer-events: auto;
      touch-action: manipulation;
    }
    #touch-launch-toggle {
      left: calc(50% - 104px);
      width: 42px;
      border: 1px solid rgba(120, 230, 255, 0.98);
      background: rgba(10, 18, 28, 0.9);
      color: rgba(220, 245, 255, 1);
      font: 800 21px/1 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
    }
    #touch-launch-toggle.touch-launch-visible { display: grid; }
    #touch-launch-toggle.touch-launch-holding {
      background: rgba(32, 78, 104, 0.96);
      border-color: rgba(168, 242, 255, 1);
      box-shadow: 0 0 16px rgba(96, 220, 255, 0.35);
    }
    #touch-action-toggle {
      left: calc(50% - 28px);
      min-width: 56px;
      padding: 0 14px;
      border: 1px solid rgba(255, 215, 110, 0.98);
      background: rgba(18, 16, 24, 0.92);
      color: rgba(255, 240, 190, 1);
      font: 800 13px/1 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    #touch-action-toggle.touch-action-visible { display: grid; }
    #touch-action-toggle.touch-action-map {
      border-color: rgba(120, 210, 255, 0.98);
      color: rgba(205, 236, 255, 1);
    }
    #touch-action-toggle.touch-action-next {
      border-color: rgba(120, 255, 190, 0.98);
      color: rgba(210, 255, 230, 1);
    }
    #touch-action-toggle.touch-action-upgrade {
      border-color: rgba(255, 215, 110, 0.98);
      color: rgba(255, 240, 190, 1);
    }
    #touch-action-toggle.touch-action-restart {
      border-color: rgba(255, 150, 110, 0.98);
      color: rgba(255, 215, 190, 1);
    }
  `;
  document.head.appendChild(style);
}

export class Input {
  /**
   * Input handler for keyboard/mouse/touch/gamepad.
   * @param {HTMLCanvasElement} canvas Input surface.
   */
  constructor(canvas){
    this.canvas = canvas;
    /** @type {Set<string>} */
    this.keys = new Set();
    /** @type {Set<string>} */
    this.justPressed = new Set();

    /** @type {{id:number|null,pos:Point|null,start:Point|null,center:Point|null}} */
    this.leftControl = { id: null, pos: null, start: null, center: null };
    /** @type {{id:number|null,pos:Point|null,start:Point|null,center:Point|null}} */
    this.laserControl = { id: null, pos: null, start: null, center: null };
    /** @type {{id:number|null,pos:Point|null,start:Point|null,center:Point|null}} */
    this.bombControl = { id: null, pos: null, start: null, center: null };
    /** @type {{id:number|null,downAt:number,triggered:boolean}} */
    this.touchRestartControl = { id: null, downAt: 0, triggered: false };

    /** @type {{regen:boolean,toggleDebug:boolean,toggleDevHud:boolean,toggleFrameStep:boolean,togglePlanetView:boolean,toggleRingVertices:boolean,togglePlanetTriangles:boolean,toggleCollisionContours:boolean,toggleMinerGuidePath:boolean,toggleFog:boolean,toggleMusic:boolean,toggleCombatMusic:boolean,musicVolumeUp:boolean,musicVolumeDown:boolean,sfxVolumeUp:boolean,sfxVolumeDown:boolean,copyScreenshot:boolean,copyScreenshotClean:boolean,copyScreenshotCleanTitle:boolean,reset:boolean,abandonRun:boolean,nextLevel:boolean,prevLevel:boolean,promptLevelJump:boolean,zoomReset:boolean,shoot:boolean,bomb:boolean,rescueAll:boolean,killAllEnemies:boolean,removeEntities:boolean,perkLeft:boolean,perkRight:boolean,spawnEnemyType:"1"|"2"|"3"|"4"|"5"|null}} */
    this.oneshot = {
      regen: false,
      toggleDebug: false,
      toggleDevHud: false,
      toggleFrameStep: false,
      togglePlanetView: false,
      toggleRingVertices: false,
      togglePlanetTriangles: false,
      toggleCollisionContours: false,
      toggleMinerGuidePath: false,
      toggleFog: false,
      toggleMusic: false,
      toggleCombatMusic: false,
      musicVolumeUp: false,
      musicVolumeDown: false,
      sfxVolumeUp: false,
      sfxVolumeDown: false,
      copyScreenshot: false,
      copyScreenshotClean: false,
      copyScreenshotCleanTitle: false,
      reset: false,
      abandonRun: false,
      nextLevel: false,
      prevLevel: false,
      promptLevelJump: false,
      zoomReset: false,
      shoot: false,
      bomb: false,
      rescueAll: false,
      killAllEnemies: false,
      removeEntities: false,
      perkLeft: false,
      perkRight: false,
      spawnEnemyType: null,
    };
    /** @type {boolean} */
    this.prevPadShoot = false;
    /** @type {boolean} */
    this.prevPadBomb = false;
    /** @type {boolean} */
    this.prevPadReset = false;
    /** @type {Point|null} */
    this.aimMouse = null;
    /** @type {Point|null} */
    this.aimTouchShoot = null;
    /** @type {Point|null} */
    this.aimTouchBomb = null;
    /** @type {Point|null} */
    this.aimTouchShootFrom = null;
    /** @type {Point|null} */
    this.aimTouchShootTo = null;
    /** @type {Point|null} */
    this.aimTouchBombFrom = null;
    /** @type {Point|null} */
    this.aimTouchBombTo = null;
    /** @type {Point|null} */
    this.bombReleaseFrom = null;
    /** @type {Point|null} */
    this.bombReleaseTo = null;
    /** @type {"keyboard"|"mouse"|"touch"|"gamepad"|null} */
    this.lastInputType = null;
    /** @type {boolean} */
    this.mouseShootHeld = false;
    /** @type {number} */
    this.zoomDelta = 0;
    this.HOLD_ABANDON_MS = 1000;
    this.pointerLocked = false;
    /** @type {boolean} */
    this.mouseDocked = false;
    /** @type {boolean} */
    this.gameOver = false;
    /** @type {boolean} */
    this.modalOpen = false;
    /** @type {boolean} */
    this.debugCommandsEnabled = false;
    /** @type {HTMLButtonElement|null} */
    this.touchRestartButton = null;
    /** @type {HTMLButtonElement|null} */
    this.touchActionButton = null;
    /** @type {HTMLButtonElement|null} */
    this.touchLaunchButton = null;
    /** @type {number|null} */
    this.touchLaunchPointerId = null;
    /** @type {boolean} */
    this.touchDocked = false;
    /** @type {boolean} */
    this.touchPerkChoiceActive = false;
    /** @type {"respawnShip"|"restartGame"|"upgrade"|"nextLevel"|"viewMap"|"exitMap"|null} */
    this.touchActionMode = null;

    ensureTouchDockStyles();
    window.addEventListener("keydown", (e) => this._onKeyDown(e), { passive: false });
    window.addEventListener("keyup", (e) => this._onKeyUp(e), { passive: false });

    canvas.addEventListener("pointerdown", (e) => this._onPointerDown(e), { passive: false });
    canvas.addEventListener("pointermove", (e) => this._onPointerMove(e), { passive: true });
    canvas.addEventListener("pointerup", (e) => this._onPointerUp(e), { passive: true });
    canvas.addEventListener("pointercancel", (e) => this._onPointerUp(e), { passive: true });
    canvas.addEventListener("wheel", (e) => this._onWheel(e), { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });

    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.canvas.style.cursor = this.pointerLocked ? "none" : "default";
    });

    window.addEventListener("gamepaddisconnected", () => {
      this.prevPadShoot = false;
      this.prevPadBomb = false;
      this.prevPadReset = false;
      if (this.lastInputType === "gamepad" && !this._hasConnectedGamepad()){
        this.lastInputType = null;
      }
    });

    /** @type {"keyboard"|"gamepad"|"touch"|null} */
    this.abandonHoldSource = null;
    this.abandonHoldStartMs = 0;
    this.abandonHoldTriggered = false;
  }

  /**
   * @param {boolean} gameOver
   * @returns {void}
   */
  setGameOver(gameOver){
    if (this.gameOver === gameOver) return;
    this.gameOver = gameOver;
    if (gameOver){
      this.aimMouse = null;
      this.aimTouchShoot = null;
      this.aimTouchBomb = null;
      this.aimTouchShootFrom = null;
      this.aimTouchShootTo = null;
      this.aimTouchBombFrom = null;
      this.aimTouchBombTo = null;
      this.bombReleaseFrom = null;
      this.bombReleaseTo = null;
      this.leftControl.id = null;
      this.leftControl.pos = null;
      this.leftControl.start = null;
      this.leftControl.center = null;
      this.laserControl.id = null;
      this.laserControl.pos = null;
      this.laserControl.start = null;
      this.laserControl.center = null;
      this.bombControl.id = null;
      this.bombControl.pos = null;
      this.bombControl.start = null;
      this.bombControl.center = null;
      this._clearTouchRestartControl();
      this._clearTouchLaunchControl();
      this.mouseShootHeld = false;
      this.prevPadShoot = false;
      this.prevPadBomb = false;
      this.prevPadReset = false;
      this.oneshot.shoot = false;
      this.oneshot.bomb = false;
      this.oneshot.abandonRun = false;
      this.oneshot.zoomReset = false;
      this.oneshot.rescueAll = false;
      this.oneshot.killAllEnemies = false;
      this.oneshot.removeEntities = false;
      this.oneshot.musicVolumeUp = false;
      this.oneshot.musicVolumeDown = false;
      this.oneshot.sfxVolumeUp = false;
      this.oneshot.sfxVolumeDown = false;
      this.oneshot.copyScreenshot = false;
      this.oneshot.copyScreenshotClean = false;
      this.oneshot.copyScreenshotCleanTitle = false;
      this.zoomDelta = 0;
      this.abandonHoldSource = null;
      this.abandonHoldStartMs = 0;
      this.abandonHoldTriggered = false;
      this._updateTouchDockButtonVisual();
    }
  }

  /**
   * @param {boolean} modalOpen
   * @returns {void}
   */
  setModalOpen(modalOpen){
    this.modalOpen = !!modalOpen;
    if (!this.modalOpen) return;
    this.keys.clear();
    this.justPressed.clear();
    this.aimMouse = null;
    this.aimTouchShoot = null;
    this.aimTouchBomb = null;
    this.aimTouchShootFrom = null;
    this.aimTouchShootTo = null;
    this.aimTouchBombFrom = null;
    this.aimTouchBombTo = null;
    this.bombReleaseFrom = null;
    this.bombReleaseTo = null;
    this.leftControl.id = null;
    this.leftControl.pos = null;
    this.leftControl.start = null;
    this.leftControl.center = null;
    this.laserControl.id = null;
    this.laserControl.pos = null;
    this.laserControl.start = null;
    this.laserControl.center = null;
    this.bombControl.id = null;
    this.bombControl.pos = null;
    this.bombControl.start = null;
    this.bombControl.center = null;
    this._clearTouchRestartControl();
    this._clearTouchLaunchControl();
    this.mouseShootHeld = false;
    this.prevPadShoot = false;
    this.prevPadBomb = false;
    this.prevPadReset = false;
    this.zoomDelta = 0;
    this.abandonHoldSource = null;
    this.abandonHoldStartMs = 0;
    this.abandonHoldTriggered = false;
    this._resetOneShotFlags();
    this._updateTouchDockButtonVisual();
  }

  /**
   * @param {"respawnShip"|"restartGame"|"upgrade"|"nextLevel"|"viewMap"|"exitMap"|null} mode
   * @returns {void}
   */
  setTouchActionMode(mode){
    this.touchActionMode = mode;
    this._updateTouchDockButtonVisual();
  }

  /**
   * @param {boolean} docked
   * @returns {void}
   */
  setTouchDocked(docked){
    this.touchDocked = !!docked;
    if (!this.touchDocked){
      this._clearTouchLaunchControl();
    }
    this._updateTouchDockButtonVisual();
  }

  /**
   * @param {boolean} docked
   * @returns {void}
   */
  setMouseDocked(docked){
    this.mouseDocked = !!docked;
    if (this.mouseDocked){
      this._releasePointerLock();
    }
  }

  /**
   * @param {boolean} active
   * @returns {void}
   */
  setTouchPerkChoiceActive(active){
    this.touchPerkChoiceActive = !!active;
    if (this.touchPerkChoiceActive){
      this._releasePointerLock();
    }
  }

  /**
   * Enable/disable debug keyboard commands (except Alt+\ and screenshot shortcuts).
   * @param {boolean} enabled
   * @returns {void}
   */
  setDebugCommandsEnabled(enabled){
    this.debugCommandsEnabled = !!enabled;
  }

  /**
   * @returns {HTMLButtonElement|null}
   */
  _ensureTouchRestartButton(){
    if (typeof document === "undefined" || !document.body) return null;
    const existing = document.getElementById("touch-restart-toggle");
    if (existing && existing.parentElement){
      existing.parentElement.removeChild(existing);
    }
    const button = document.createElement("button");
    button.id = "touch-restart-toggle";
    button.type = "button";
    button.setAttribute("aria-label", "Hold 1 second to abandon run");
    button.textContent = TOUCH_RESTART_LABEL;
    button.style.setProperty("--restart-hold-progress", "0%");
    button.addEventListener("pointerdown", (e) => {
      if (this.modalOpen) return;
      if (e.pointerType !== "touch") return;
      if (this.gameOver) return;
      e.preventDefault();
      e.stopPropagation();
      this.lastInputType = "touch";
      this.touchRestartControl.id = e.pointerId;
      this.touchRestartControl.downAt = performance.now();
      this.touchRestartControl.triggered = false;
      if (button.setPointerCapture){
        try {
          button.setPointerCapture(e.pointerId);
        } catch (_err){
          // Ignore pointer capture failures on older/mobile browsers.
        }
      }
      this._updateTouchRestartButtonVisual(this.touchRestartControl.downAt);
    });
    /** @param {PointerEvent} e */
    const finishHold = (e) => {
      if (e.pointerType !== "touch") return;
      if (this.touchRestartControl.id !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const cancelled = e.type === "pointercancel";
      const heldMs = performance.now() - this.touchRestartControl.downAt;
      if (!cancelled && !this.touchRestartControl.triggered && heldMs >= this.HOLD_ABANDON_MS){
        this.oneshot.abandonRun = true;
      }
      this._clearTouchRestartControl();
    };
    button.addEventListener("pointerup", finishHold);
    button.addEventListener("pointercancel", finishHold);
    button.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(button);
    return button;
  }

  /**
   * @returns {HTMLButtonElement|null}
   */
  _ensureTouchActionButton(){
    if (typeof document === "undefined" || !document.body) return null;
    const existing = document.getElementById("touch-action-toggle");
    if (existing && existing.parentElement){
      existing.parentElement.removeChild(existing);
    }
    const button = document.createElement("button");
    button.id = "touch-action-toggle";
    button.type = "button";
    button.setAttribute("aria-label", "Primary docked action");
    button.textContent = "GO";
    button.addEventListener("pointerdown", (e) => {
      if (this.modalOpen) return;
      if (e.pointerType !== "touch") return;
      if (!this.touchActionMode) return;
      e.preventDefault();
      e.stopPropagation();
      this.lastInputType = "touch";
    });
    button.addEventListener("click", (e) => {
      e.preventDefault();
      if (!this.touchActionMode) return;
      this.oneshot.reset = true;
    });
    button.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(button);
    return button;
  }

  /**
   * @returns {HTMLButtonElement|null}
   */
  _ensureTouchLaunchButton(){
    if (typeof document === "undefined" || !document.body) return null;
    const existing = document.getElementById("touch-launch-toggle");
    if (existing && existing.parentElement){
      existing.parentElement.removeChild(existing);
    }
    const button = document.createElement("button");
    button.id = "touch-launch-toggle";
    button.type = "button";
    button.setAttribute("aria-label", "Launch from mothership");
    button.textContent = TOUCH_LAUNCH_LABEL;
    button.addEventListener("pointerdown", (e) => {
      if (this.modalOpen) return;
      if (e.pointerType !== "touch") return;
      if (!this.touchDocked || this.gameOver) return;
      e.preventDefault();
      e.stopPropagation();
      this.lastInputType = "touch";
      this.touchLaunchPointerId = e.pointerId;
      if (button.setPointerCapture){
        try {
          button.setPointerCapture(e.pointerId);
        } catch (_err){
          // Ignore pointer capture failures on older/mobile browsers.
        }
      }
      this._updateTouchDockButtonVisual();
    });
    /** @param {PointerEvent} e */
    const finish = (e) => {
      if (e.pointerType !== "touch") return;
      if (this.touchLaunchPointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      this._clearTouchLaunchControl();
    };
    button.addEventListener("pointerup", finish);
    button.addEventListener("pointercancel", finish);
    button.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.appendChild(button);
    return button;
  }

  /**
   * @returns {void}
   */
  _clearTouchRestartControl(){
    this.touchRestartControl.id = null;
    this.touchRestartControl.downAt = 0;
    this.touchRestartControl.triggered = false;
    this._updateTouchRestartButtonVisual(performance.now());
  }

  /**
   * @returns {void}
   */
  _clearTouchLaunchControl(){
    this.touchLaunchPointerId = null;
    this._updateTouchDockButtonVisual();
  }

  /**
   * @param {number} now
   * @returns {void}
   */
  _updateTouchRestartButtonVisual(now){
    if (!this.touchRestartButton) return;
    const holding = this.touchRestartControl.id !== null;
    const heldMs = holding ? Math.max(0, now - this.touchRestartControl.downAt) : 0;
    const holdProgress = holding ? Math.max(0, Math.min(1, heldMs / this.HOLD_ABANDON_MS)) : 0;
    const disabled = this.gameOver || this.modalOpen;
    this.touchRestartButton.classList.toggle("touch-restart-disabled", disabled);
    this.touchRestartButton.classList.toggle("touch-restart-holding", holding);
    this.touchRestartButton.style.setProperty("--restart-hold-progress", `${(holdProgress * 100).toFixed(1)}%`);
  }

  /**
   * @returns {void}
   */
  _updateTouchDockButtonVisual(){
    const showDocked = !!(this.touchDocked && this.lastInputType === "touch" && !this.modalOpen && !this.gameOver);
    const showAction = !!(showDocked && this.touchActionMode);
    if (this.touchActionButton){
      const mode = this.touchActionMode;
      let label = "GO";
      let modeClass = "touch-action-upgrade";
      if (mode === "upgrade"){
        label = "UP";
        modeClass = "touch-action-upgrade";
      } else if (mode === "nextLevel"){
        label = "GO";
        modeClass = "touch-action-next";
      } else if (mode === "viewMap"){
        label = "MAP";
        modeClass = "touch-action-map";
      } else if (mode === "exitMap"){
        label = "BACK";
        modeClass = "touch-action-map";
      } else if (mode === "restartGame"){
        label = "NEW";
        modeClass = "touch-action-restart";
      } else if (mode === "respawnShip"){
        label = "SHIP";
        modeClass = "touch-action-restart";
      }
      this.touchActionButton.textContent = label;
      this.touchActionButton.classList.toggle("touch-action-visible", showAction);
      this.touchActionButton.classList.remove("touch-action-upgrade", "touch-action-next", "touch-action-map", "touch-action-restart");
      if (showAction) this.touchActionButton.classList.add(modeClass);
    }
    if (this.touchLaunchButton){
      this.touchLaunchButton.textContent = TOUCH_LAUNCH_LABEL;
      this.touchLaunchButton.classList.toggle("touch-launch-visible", showDocked);
      this.touchLaunchButton.classList.toggle("touch-launch-holding", this.touchLaunchPointerId !== null);
    }
    if (typeof document !== "undefined" && document.body){
      document.body.classList.toggle("touch-docked-visible", showDocked);
    }
  }

  /** @returns {void} */
  _fireBomb(){
    this.oneshot.bomb = true;
  }

  /**
   * @returns {void}
   */
  _releasePointerLock(){
    if (typeof document === "undefined") return;
    if (document.pointerLockElement !== this.canvas) return;
    if (typeof document.exitPointerLock === "function"){
      document.exitPointerLock();
    }
  }

  /**
   * @param {KeyboardEvent} e
   * @returns {void}
   */
  _onKeyDown(e){
    if (this.modalOpen){
      return;
    }
    const key = e.key;
    const code = e.code;
    const debugChord = e.altKey && !e.ctrlKey && !e.metaKey;
    const rescueAllChord = this.debugCommandsEnabled && debugChord && code === "KeyQ";
    const debugDigitChar = code.charAt(5);
    const debugDigit = code.startsWith("Digit") && code.length === 6 && debugDigitChar >= "1" && debugDigitChar <= "9";
    const debugToggleHud = debugChord && code === "Backslash";
    const screenshotTitleShortcut = debugChord && code === "KeyZ";
    const debugAction =
      debugChord && (
        code === "KeyM" ||
        code === "KeyI" ||
        code === "KeyK" ||
        code === "KeyN" ||
        code === "KeyL" ||
        code === "KeyV" ||
        code === "KeyG" ||
        code === "KeyH" ||
        code === "KeyT" ||
        code === "KeyY" ||
        code === "KeyU" ||
        code === "KeyF" ||
        code === "KeyC" ||
        code === "KeyX" ||
        code === "KeyZ" ||
        debugDigit
      );
    const debugShortcut = debugToggleHud || debugAction || screenshotTitleShortcut || rescueAllChord;
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," ","Space"].includes(key)) e.preventDefault();
    if (debugShortcut) e.preventDefault();
    if (!this.keys.has(key)) this.justPressed.add(key);
    this.keys.add(key);
    this.lastInputType = "keyboard";

    if (debugToggleHud) this.oneshot.toggleDevHud = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyM") this.oneshot.regen = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyI") this.oneshot.toggleDebug = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyK") this.oneshot.promptLevelJump = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyL") this.oneshot.toggleFrameStep = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyN"){
      if (e.shiftKey) this.oneshot.prevLevel = true;
      else this.oneshot.nextLevel = true;
    }
    if (code === "Digit0" && !e.ctrlKey && !e.metaKey && !e.altKey){
      this.oneshot.zoomReset = true;
    }
    if ((key === "r" || key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey){
      if (!e.shiftKey) this.oneshot.reset = true;
    }
    if (this.debugCommandsEnabled && debugChord && code === "KeyV") this.oneshot.togglePlanetView = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyG") this.oneshot.toggleRingVertices = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyH") this.oneshot.toggleRingVertices = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyT") this.oneshot.togglePlanetTriangles = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyY") this.oneshot.toggleCollisionContours = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyU") this.oneshot.toggleMinerGuidePath = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyF") this.oneshot.toggleFog = true;
    if (debugChord && code === "KeyC"){
      if (e.shiftKey) this.oneshot.copyScreenshotClean = true;
      else this.oneshot.copyScreenshot = true;
    }
    if (screenshotTitleShortcut) this.oneshot.copyScreenshotCleanTitle = true;
    if ((key === "-" || key === "_") && !e.ctrlKey && !e.metaKey && !e.altKey){
      if (e.shiftKey) this.oneshot.sfxVolumeDown = true;
      else this.oneshot.musicVolumeDown = true;
    }
    if ((key === "=" || key === "+") && !e.ctrlKey && !e.metaKey && !e.altKey){
      if (e.shiftKey) this.oneshot.sfxVolumeUp = true;
      else this.oneshot.musicVolumeUp = true;
    }
    if ((key === "m" || key === "M" || key === "b" || key === "B") && !e.ctrlKey && !e.metaKey && !e.altKey){
      this.oneshot.toggleMusic = true;
    }
    if (key === "j" || key === "J") this.oneshot.toggleCombatMusic = true;
    if (this.debugCommandsEnabled && debugChord && debugDigit) this.oneshot.spawnEnemyType = /** @type {"1"|"2"|"3"|"4"|"5"} */ (debugDigitChar);
    if (rescueAllChord) this.oneshot.rescueAll = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyX") this.oneshot.killAllEnemies = true;
    if (this.debugCommandsEnabled && debugChord && code === "KeyE") this.oneshot.removeEntities = true;
  }

  /**
   * @param {KeyboardEvent} e
   * @returns {void}
   */
  _onKeyUp(e){
    this.keys.delete(e.key);
  }

  /**
   * @param {PointerEvent|MouseEvent} e
   * @returns {Point}
   */
  _pointerPos(e){
    const rect = this.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / Math.max(1, rect.width);
    const y = (e.clientY - rect.top) / Math.max(1, rect.height);
    return {
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    };
  }

  /**
   * @param {Point} p
   * @param {{x:number,y:number}} c
   * @param {number} r
   * @returns {boolean}
   */
  _inCircle(p, c, r){
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return (dx * dx + dy * dy) <= r * r;
  }

  /**
   * @param {Point} p
   * @param {{x:number,y:number}} c
   * @param {number} r
   * @returns {boolean}
   */
  _inDiamond(p, c, r){
    const dx = Math.abs(p.x - c.x);
    const dy = Math.abs(p.y - c.y);
    return (dx + dy) <= r;
  }

  /**
   * @param {Point} p
   * @param {{x:number,y:number}} c
   * @param {number} r
   * @returns {boolean}
   */
  _inSquare(p, c, r){
    const dx = Math.abs(p.x - c.x);
    const dy = Math.abs(p.y - c.y);
    return Math.max(dx, dy) <= r;
  }

  /**
   * @param {{id:number|null,pos:Point|null,start:Point|null,center:Point|null}} control
   * @param {number} pointerId
   * @param {Point} p
   * @returns {void}
   */
  _captureTouchControl(control, pointerId, p){
    control.id = pointerId;
    control.pos = p;
    control.start = p;
    control.center = { x: p.x, y: p.y };
  }

  /**
   * @param {{id:number|null,pos:Point|null,start:Point|null,center:Point|null}} control
   * @returns {void}
   */
  _releaseTouchControl(control){
    control.id = null;
    control.pos = null;
    control.start = null;
    control.center = null;
  }

  /**
   * @param {{id:number|null,pos:Point|null,start:Point|null,center:Point|null}|null|undefined} control
   * @param {Point} fallback
   * @returns {Point}
   */
  _touchControlCenter(control, fallback){
    const center = control?.center;
    if (center) return center;
    return fallback;
  }

  /**
   * @param {PointerEvent} e
   * @returns {void}
   */
  _onPointerDown(e){
    if (this.modalOpen){
      return;
    }
    if (this.gameOver && e.pointerType !== "touch"){
      return;
    }
    if (e.pointerType !== "touch"){
      const p = this._pointerPos(e);
      if (this.touchPerkChoiceActive){
        const perkChoice = perkChoiceIndexAtPoint(
          { x: p.x * this.canvas.clientWidth, y: p.y * this.canvas.clientHeight },
          this.canvas.clientWidth,
          this.canvas.clientHeight
        );
        if (perkChoice === 0) this.oneshot.perkLeft = true;
        else if (perkChoice === 1) this.oneshot.perkRight = true;
        this.lastInputType = "mouse";
        return;
      }
      if (this.mouseDocked){
        this.aimMouse = p;
        this.lastInputType = "mouse";
        return;
      }
      if (!this.pointerLocked && document.pointerLockElement !== this.canvas){
        this.canvas.requestPointerLock();
      }
      if (!this.pointerLocked){
        this.aimMouse = p;
      }
      if (e.button === 2) this._fireBomb();
      if ((e.button === 0 || (e.buttons & 1)) && !this.mouseShootHeld){
        this.mouseShootHeld = true;
        this.oneshot.shoot = true;
      }
      this.lastInputType = "mouse";
      return;
    }
    e.preventDefault();
    this.lastInputType = "touch";
    const p = this._pointerPos(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (this.touchPerkChoiceActive && p.y >= TOUCH_PERK_CHOICE_TOP && p.y <= TOUCH_PERK_CHOICE_BOTTOM){
      if (p.x < 0.5) this.oneshot.perkLeft = true;
      else this.oneshot.perkRight = true;
      return;
    }
    if (this.gameOver){
      return;
    }
    if (this.touchDocked){
      return;
    }
    if (this.leftControl.id === null && this._inCircle(p, TOUCH_UI.left, TOUCH_UI.left.r * TOUCH_UI.activationScale)){
      this._captureTouchControl(this.leftControl, e.pointerId, p);
    } else if (this.laserControl.id === null && this._inDiamond(p, TOUCH_UI.laser, TOUCH_UI.laser.r * TOUCH_UI.activationScale)){
      this._captureTouchControl(this.laserControl, e.pointerId, p);
    } else if (this.bombControl.id === null && this._inSquare(p, TOUCH_UI.bomb, TOUCH_UI.bomb.r * TOUCH_UI.activationScale)){
      this._captureTouchControl(this.bombControl, e.pointerId, p);
    }
  }

  /**
   * @param {PointerEvent} e
   * @returns {void}
   */
  _onPointerMove(e){
    if (this.modalOpen){
      return;
    }
    if (this.gameOver && e.pointerType !== "touch"){
      return;
    }
    if (e.pointerType !== "touch"){
      if (this.pointerLocked){
        const rect = this.canvas.getBoundingClientRect();
        const w = Math.max(1, rect.width);
        const h = Math.max(1, rect.height);
        const nx = (this.aimMouse ? this.aimMouse.x : 0.5) + (e.movementX / w);
        const ny = (this.aimMouse ? this.aimMouse.y : 0.5) + (e.movementY / h);
        this.aimMouse = {
          x: Math.max(0, Math.min(1, nx)),
          y: Math.max(0, Math.min(1, ny)),
        };
      } else {
        this.aimMouse = this._pointerPos(e);
      }
      this.mouseShootHeld = !!(e.buttons & 1);
      this.lastInputType = "mouse";
      return;
    }
    const p = this._pointerPos(e);
    if (this.leftControl.id === e.pointerId){
      this.leftControl.pos = p;
    } else if (this.laserControl.id === e.pointerId){
      this.laserControl.pos = p;
    } else if (this.bombControl.id === e.pointerId){
      this.bombControl.pos = p;
    }
  }

  /**
   * @param {PointerEvent} e
   * @returns {void}
   */
  _onPointerUp(e){
    if (this.modalOpen){
      return;
    }
    if (this.gameOver && e.pointerType !== "touch"){
      return;
    }
    if (e.pointerType !== "touch"){
      if (!this.pointerLocked){
        this.aimMouse = this._pointerPos(e);
      }
      this.mouseShootHeld = !!(e.buttons & 1);
      this.lastInputType = "mouse";
      return;
    }
    if (this.leftControl.id === e.pointerId){
      this._releaseTouchControl(this.leftControl);
    } else if (this.laserControl.id === e.pointerId){
      this._releaseTouchControl(this.laserControl);
    } else if (this.bombControl.id === e.pointerId){
      const start = this.bombControl.start;
      const pos = this.bombControl.pos;
      const center = this._touchControlCenter(this.bombControl, TOUCH_UI.bomb);
      if (start && pos){
        const dx = pos.x - start.x;
        const dy = pos.y - start.y;
        const moved = Math.hypot(dx, dy);
        if (moved >= TOUCH_UI.dead){
          this.oneshot.bomb = true;
          this.bombReleaseFrom = { x: center.x, y: center.y };
          this.bombReleaseTo = { x: pos.x, y: pos.y };
        }
      }
      this._releaseTouchControl(this.bombControl);
    }
  }

  /**
   * @param {WheelEvent} e
   * @returns {void}
   */
  _onWheel(e){
    if (this.modalOpen) return;
    e.preventDefault();
    let modeScale = 1;
    if (e.deltaMode === 1) modeScale = 3; // DOM_DELTA_LINE
    else if (e.deltaMode === 2) modeScale = 24; // DOM_DELTA_PAGE
    const delta = (e.deltaY / 100) * modeScale;
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-4) return;
    this.zoomDelta = Math.max(-8, Math.min(8, this.zoomDelta + delta));
    this.lastInputType = "mouse";
  }

  /**
   * @returns {boolean}
   */
  _hasConnectedGamepad(){
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return false;
    const pads = navigator.getGamepads() || [];
    for (const pad of pads){
      if (!pad) continue;
      if (pad.connected === false) continue;
      return true;
    }
    return false;
  }

  /**
   * @returns {{stickThrust:Point,left:boolean,right:boolean,thrust:boolean,down:boolean}}
   */
  _touchState(){
    let left = false;
    let right = false;
    let thrust = false;
    let down = false;
    let stickThrust = { x: 0, y: 0 };
    const leftCenter = this._touchControlCenter(this.leftControl, TOUCH_UI.left);
    const laserCenter = this._touchControlCenter(this.laserControl, TOUCH_UI.laser);
    const bombCenter = this._touchControlCenter(this.bombControl, TOUCH_UI.bomb);

    this.aimTouchShoot = null;
    this.aimTouchBomb = null;
    this.aimTouchShootFrom = null;
    this.aimTouchShootTo = null;
    this.aimTouchBombFrom = null;
    this.aimTouchBombTo = null;
    const dead = TOUCH_UI.dead;
    if (this.leftControl.id !== null && this.leftControl.pos){
      const dx = this.leftControl.pos.x - leftCenter.x;
      const dy = this.leftControl.pos.y - leftCenter.y;
      if (dx < -dead) left = true;
      if (dx > dead) right = true;
      if (dy < -dead) thrust = true;
      if (dy > dead) down = true;
      const len = Math.hypot(dx, dy);
      const maxRadius = Math.max(dead + 1e-4, TOUCH_UI.left.r || 0);
      const clampedLen = Math.min(len, maxRadius);
      let lenAdjusted = (clampedLen - dead) / Math.max(1e-4, maxRadius - dead);
      lenAdjusted = Math.max(0, Math.min(1, lenAdjusted));
      if (len > 1e-4 && lenAdjusted > 0){
        const ux = dx / len;
        const uy = dy / len;
        stickThrust = { x: ux * lenAdjusted, y: -uy * lenAdjusted };
      }
    }

    /**
     * @param {{id:number|null,pos:Point|null,start:Point|null,center:Point|null}|null|undefined} control
     * @param {Point} center
     */
    const aimFromControl = (control, center) => {
      if (!control || control.id === null || !control.pos) return null;
      const dx = control.pos.x - center.x;
      const dy = control.pos.y - center.y;
      const sx = (control.start ? control.pos.x - control.start.x : dx);
      const sy = (control.start ? control.pos.y - control.start.y : dy);
      const move = Math.hypot(sx, sy);
      if (move < dead) return null;
      const len = Math.hypot(dx, dy);
      const radius = Math.max(0.25, GAME.AIM_SCREEN_RADIUS || 0.25);
      if (len > 1e-4){
        const ux = dx / len;
        const uy = dy / len;
        return { x: 0.5 + ux * radius, y: 0.5 + uy * radius };
      }
      return { x: 0.5, y: 0.5 - radius };
    };

    this.aimTouchShoot = aimFromControl(this.laserControl, laserCenter);
    this.aimTouchBomb = aimFromControl(this.bombControl, bombCenter);
    if (this.laserControl.id !== null && this.laserControl.pos && this.aimTouchShoot){
      this.aimTouchShootFrom = { x: laserCenter.x, y: laserCenter.y };
      this.aimTouchShootTo = { x: this.laserControl.pos.x, y: this.laserControl.pos.y };
    }
    if (this.bombControl.id !== null && this.bombControl.pos && this.aimTouchBomb){
      this.aimTouchBombFrom = { x: bombCenter.x, y: bombCenter.y };
      this.aimTouchBombTo = { x: this.bombControl.pos.x, y: this.bombControl.pos.y };
    }

    return { stickThrust, left, right, thrust, down };
  }

  /**
   * @returns {{stickThrust:Point,dashboardScroll:Point,left:boolean,right:boolean,thrust:boolean,down:boolean,aim:Point|null,shoot:boolean,bomb:boolean,reset:boolean,abandonRun:boolean}}
   */
  _gamepadState(){
    const pads = navigator.getGamepads ? (navigator.getGamepads() || []) : [];
    let hasConnectedPad = false;

    /** @type {{stickThrust:Point,dashboardScroll:Point,left:boolean,right:boolean,thrust:boolean,down:boolean,aim:Point|null,shoot:boolean,bomb:boolean,reset:boolean,abandonRun:boolean}} */
    let inputCombined = {
      stickThrust:{x:0, y:0},
      dashboardScroll:{x:0, y:0},
      left:false,
      right:false,
      thrust:false,
      down:false,
      aim:null,
      shoot:false,
      bomb:false,
      reset:false,
      abandonRun:false,
    };

    for (const pad of pads) {
      if (!pad || pad.connected === false) continue;
      hasConnectedPad = true;

      const dead = 0.2;
      const ax0 = (pad.axes && pad.axes.length ? pad.axes[0] : 0) ?? 0;
      const ax1 = (pad.axes && pad.axes.length > 1 ? pad.axes[1] : 0) ?? 0;
      const ax2 = (pad.axes && pad.axes.length > 2 ? pad.axes[2] : 0) ?? 0;
      const ax3 = (pad.axes && pad.axes.length > 3 ? pad.axes[3] : 0) ?? 0;
      const alen = Math.hypot(ax2, ax3);
      const scrollX = Math.abs(ax2) > dead ? (Math.abs(ax2) - dead) / (1 - dead) * Math.sign(ax2) : 0;
      const scrollY = Math.abs(ax3) > dead ? (Math.abs(ax3) - dead) / (1 - dead) * Math.sign(ax3) : 0;
      const dashboardScroll = { x: scrollX, y: scrollY };

      const thrustLen = Math.hypot(ax0, ax1);
      let thrustLenAdjusted = (thrustLen - dead) / (1 - dead);
      thrustLenAdjusted = Math.max(0, Math.min(1, thrustLenAdjusted));
      const thrustScale = (thrustLenAdjusted <= 0) ? 0 : (thrustLenAdjusted / thrustLen);
      const stickThrust = {x:ax0 * thrustScale, y:-ax1 * thrustScale};

      const faceBottomPressed = !!(pad.buttons && pad.buttons[0] && pad.buttons[0].pressed);
      const faceRightPressed = !!(pad.buttons && pad.buttons[1] && pad.buttons[1].pressed);
      const dpadUpPressed = !!(pad.buttons && pad.buttons[12] && pad.buttons[12].pressed);
      const dpadDownPressed = !!(pad.buttons && pad.buttons[13] && pad.buttons[13].pressed);
      const dpadLeftPressed = !!(pad.buttons && pad.buttons[14] && pad.buttons[14].pressed);
      const dpadRightPressed = !!(pad.buttons && pad.buttons[15] && pad.buttons[15].pressed);
      const left = dpadLeftPressed;
      const right = dpadRightPressed;
      const thrust = dpadUpPressed;
      const down = faceRightPressed || dpadDownPressed;

      let aim = null;
      if (alen > dead){
        const ux = ax2 / alen;
        const uy = ax3 / alen;
        const radius = Math.max(0.25, GAME.AIM_SCREEN_RADIUS || 0.25);
        aim = { x: 0.5 + ux * radius, y: 0.5 + uy * radius };
      }

      const lb = !!(pad.buttons && pad.buttons[4] && pad.buttons[4].pressed);
      const lt = !!(pad.buttons && pad.buttons[6] && (pad.buttons[6].pressed || pad.buttons[6].value > 0.4));
      const rb = !!(pad.buttons && pad.buttons[5] && pad.buttons[5].pressed);
      const rt = !!(pad.buttons && pad.buttons[7] && (pad.buttons[7].pressed || pad.buttons[7].value > 0.4));
      const startPressed = !!(pad.buttons && pad.buttons[9] && pad.buttons[9].pressed);
      const shoot = rb || rt;
      const bomb = lb || lt;
      const reset = faceBottomPressed;
      const abandonRun = startPressed;

      if (thrustLenAdjusted > 0) {
        const thrustLenCombined = Math.hypot(inputCombined.stickThrust.x, inputCombined.stickThrust.y);
        if (thrustLenAdjusted > thrustLenCombined){
          inputCombined.stickThrust = stickThrust;
        }        
      }

      inputCombined.left = inputCombined.left || left;
      inputCombined.right = inputCombined.right || right;
      inputCombined.thrust = inputCombined.thrust || thrust;
      inputCombined.down = inputCombined.down || down;
      inputCombined.shoot = inputCombined.shoot || shoot;
      inputCombined.bomb = inputCombined.bomb || bomb;
      inputCombined.reset = inputCombined.reset || reset;
      inputCombined.abandonRun = inputCombined.abandonRun || abandonRun;
      if (
        Math.hypot(dashboardScroll.x, dashboardScroll.y)
        > Math.hypot(inputCombined.dashboardScroll.x, inputCombined.dashboardScroll.y)
      ){
        inputCombined.dashboardScroll = dashboardScroll;
      }
      if (aim) {
        const ax = aim.x - 0.5;
        const ay = aim.y - 0.5;
        if (!inputCombined.aim ||
          ax*ax + ay*ay > (inputCombined.aim.x - 0.5) * (inputCombined.aim.x - 0.5) + (inputCombined.aim.y - 0.5) * (inputCombined.aim.y - 0.5)) {
          inputCombined.aim = aim;
        }
      }
    }

    if (
      inputCombined.left
      || inputCombined.right
      || inputCombined.thrust
      || inputCombined.down
      || inputCombined.shoot
      || inputCombined.bomb
      || inputCombined.reset
      || inputCombined.abandonRun
      || inputCombined.aim
      || (inputCombined.stickThrust.x*inputCombined.stickThrust.x + inputCombined.stickThrust.y*inputCombined.stickThrust.y) > 0
      || (inputCombined.dashboardScroll.x*inputCombined.dashboardScroll.x + inputCombined.dashboardScroll.y*inputCombined.dashboardScroll.y) > 0
    ) {
      this.lastInputType = "gamepad";
    } else if (!hasConnectedPad && this.lastInputType === "gamepad"){
      // Avoid stale gamepad hints/behavior after disconnect.
      this.lastInputType = null;
      this.prevPadShoot = false;
      this.prevPadBomb = false;
      this.prevPadReset = false;
    }

    return inputCombined;
  }

  /**
   * @returns {InputState}
   */
  update(){
    if (!this.touchRestartButton){
      this.touchRestartButton = this._ensureTouchRestartButton();
    }
    if (!this.touchActionButton){
      this.touchActionButton = this._ensureTouchActionButton();
    }
    if (!this.touchLaunchButton){
      this.touchLaunchButton = this._ensureTouchLaunchButton();
    }
    this._updateTouchDockButtonVisual();
    if (this.modalOpen){
      const state = {
        stickThrust: { x: 0, y: 0 },
        left: false,
        right: false,
        thrust: false,
        down: false,
        reset: false,
        abandonRun: false,
        abandonHoldActive: false,
        abandonHoldRemainingMs: 0,
        regen: false,
        toggleDebug: false,
        toggleDevHud: false,
        togglePlanetView: false,
        toggleRingVertices: false,
        togglePlanetTriangles: false,
        toggleCollisionContours: false,
        toggleMinerGuidePath: false,
        toggleFog: false,
        toggleMusic: false,
        toggleCombatMusic: false,
        musicVolumeUp: false,
        musicVolumeDown: false,
        sfxVolumeUp: false,
        sfxVolumeDown: false,
        copyScreenshot: false,
        copyScreenshotClean: false,
        copyScreenshotCleanTitle: false,
        nextLevel: false,
        prevLevel: false,
        promptLevelJump: false,
        zoomReset: false,
        shootHeld: false,
        shootPressed: false,
        shoot: false,
        bomb: false,
        rescueAll: false,
        killAllEnemies: false,
        removeEntities: false,
        spawnEnemyType: null,
        aim: null,
        aimShoot: null,
        aimBomb: null,
        aimShootFrom: null,
        aimShootTo: null,
        aimBombFrom: null,
        aimBombTo: null,
        touchUi: null,
        touchUiVisible: false,
        dashboardScroll: { x: 0, y: 0 },
        zoomDelta: 0,
        inputType: this.lastInputType,
      };
      this._resetOneShotFlags();
      return state;
    }

    const now = performance.now();
    const keyState = {
      left: false,
      right: false,
      thrust: false,
      down: false,
    };

    this.keys.forEach((k) => {
      if (KEY_LEFT.has(k)) keyState.left = true;
      if (KEY_RIGHT.has(k)) keyState.right = true;
      if (KEY_THRUST.has(k)) keyState.thrust = true;
      if (KEY_DOWN.has(k)) keyState.down = true;
    });

    const t = this._touchState();
    const g = this._gamepadState();

    let left = keyState.left || t.left || g.left;
    let right = keyState.right || t.right || g.right;
    let thrust = keyState.thrust || t.thrust || g.thrust || this.touchLaunchPointerId !== null;
    let down = keyState.down || t.down || g.down;
    let stickThrust = g.stickThrust;
    const touchStickMag = Math.hypot(t.stickThrust.x, t.stickThrust.y);
    const gamepadStickMag = Math.hypot(stickThrust.x, stickThrust.y);
    if (touchStickMag > gamepadStickMag){
      stickThrust = t.stickThrust;
    }

    if (!this.gameOver && g.shoot && !this.prevPadShoot){
      this.oneshot.shoot = true;
    }
    if (g.bomb && !this.prevPadBomb) this.oneshot.bomb = true;
    if (g.reset && !this.prevPadReset) this.oneshot.reset = true;
    this.prevPadShoot = g.shoot;
    this.prevPadBomb = g.bomb;
    this.prevPadReset = g.reset;
    const keyboardAbandonHeld =
      this.keys.has("Shift") &&
      (this.keys.has("r") || this.keys.has("R"));
    const gamepadAbandonHeld = !!g.abandonRun;
    const touchAbandonHeld = !this.gameOver && this.touchRestartControl.id !== null;
    const holdSource = touchAbandonHeld ? "touch" : gamepadAbandonHeld ? "gamepad" : keyboardAbandonHeld ? "keyboard" : null;
    if (holdSource){
      if (this.abandonHoldSource !== holdSource){
        this.abandonHoldSource = holdSource;
        this.abandonHoldStartMs = now;
        this.abandonHoldTriggered = false;
      }
      if (!this.abandonHoldTriggered && (now - this.abandonHoldStartMs) >= this.HOLD_ABANDON_MS){
        this.oneshot.abandonRun = true;
        this.abandonHoldTriggered = true;
        if (holdSource === "touch"){
          this.touchRestartControl.triggered = true;
        }
      }
    } else {
      this.abandonHoldSource = null;
      this.abandonHoldStartMs = 0;
      this.abandonHoldTriggered = false;
    }
    const abandonHoldActive = !!holdSource;
    const abandonHoldRemainingMs = abandonHoldActive
      ? Math.max(0, this.HOLD_ABANDON_MS - (now - this.abandonHoldStartMs))
      : 0;
    this._updateTouchRestartButtonVisual(now);
    left = left || this.oneshot.perkLeft;
    right = right || this.oneshot.perkRight;
    const touchUiVisible = !this.gameOver && this.lastInputType === "touch" && !this.touchDocked;
    const touchUi = touchUiVisible ? {
      leftCenter: this._touchControlCenter(this.leftControl, TOUCH_UI.left),
      laserCenter: this._touchControlCenter(this.laserControl, TOUCH_UI.laser),
      bombCenter: this._touchControlCenter(this.bombControl, TOUCH_UI.bomb),
      leftTouch: this.leftControl.pos,
      laserTouch: this.laserControl.pos,
      bombTouch: this.bombControl.pos,
    } : null;

    let aimShoot = null;
    let aimBomb = null;
    let aim = null;
    let aimBombFrom = this.aimTouchBombFrom;
    let aimBombTo = this.aimTouchBombTo;
    if (this.bombReleaseFrom && this.bombReleaseTo){
      aimBombFrom = this.bombReleaseFrom;
      aimBombTo = this.bombReleaseTo;
    }
    if (this.gameOver){
      aimShoot = null;
      aimBomb = null;
      aim = null;
      left = false;
      right = false;
      thrust = false;
      down = false;
      this.oneshot.shoot = false;
      this.oneshot.bomb = false;
    } else if (this.lastInputType === "touch"){
      aimShoot = this.aimTouchShoot;
      aimBomb = this.aimTouchBomb || aimShoot;
      aim = aimShoot || aimBomb || null;
    } else if (this.lastInputType === "gamepad"){
      aimShoot = g.aim;
      aimBomb = aimShoot;
      aim = aimShoot || null;
    } else {
      aimShoot = this.aimMouse || g.aim || null;
      aimBomb = this.aimTouchBomb || aimShoot;
      aim = aimShoot || aimBomb || null;
    }
    const touchShootHeld = !this.gameOver && this.laserControl.id !== null && !!this.aimTouchShoot;
    const shootHeld = !this.gameOver && (this.mouseShootHeld || !!g.shoot || touchShootHeld);
    const shootPressed = this.oneshot.shoot;

    const state = {
      stickThrust: stickThrust,
      left,
      right,
      thrust,
      down,
      reset: this.oneshot.reset,
      abandonRun: this.oneshot.abandonRun,
      abandonHoldActive,
      abandonHoldRemainingMs,
      regen: this.oneshot.regen,
      toggleDebug: this.oneshot.toggleDebug,
      toggleDevHud: this.oneshot.toggleDevHud,
      toggleFrameStep: this.oneshot.toggleFrameStep,
      togglePlanetView: this.oneshot.togglePlanetView,
      toggleRingVertices: this.oneshot.toggleRingVertices,
      togglePlanetTriangles: this.oneshot.togglePlanetTriangles,
      toggleCollisionContours: this.oneshot.toggleCollisionContours,
      toggleMinerGuidePath: this.oneshot.toggleMinerGuidePath,
      toggleFog: this.oneshot.toggleFog,
      toggleMusic: this.oneshot.toggleMusic,
      toggleCombatMusic: this.oneshot.toggleCombatMusic,
      musicVolumeUp: this.oneshot.musicVolumeUp,
      musicVolumeDown: this.oneshot.musicVolumeDown,
      sfxVolumeUp: this.oneshot.sfxVolumeUp,
      sfxVolumeDown: this.oneshot.sfxVolumeDown,
      copyScreenshot: this.oneshot.copyScreenshot,
      copyScreenshotClean: this.oneshot.copyScreenshotClean,
      copyScreenshotCleanTitle: this.oneshot.copyScreenshotCleanTitle,
      nextLevel: this.oneshot.nextLevel,
      prevLevel: this.oneshot.prevLevel,
      promptLevelJump: this.oneshot.promptLevelJump,
      zoomReset: this.oneshot.zoomReset,
      shootHeld,
      shootPressed,
      shoot: shootPressed,
      bomb: this.oneshot.bomb,
      rescueAll: this.oneshot.rescueAll,
      killAllEnemies: this.oneshot.killAllEnemies,
      removeEntities: this.oneshot.removeEntities,
      spawnEnemyType: this.oneshot.spawnEnemyType,
      aim,
      aimShoot,
      aimBomb,
      aimShootFrom: this.aimTouchShootFrom,
      aimShootTo: this.aimTouchShootTo,
      aimBombFrom,
      aimBombTo,
      touchUi,
      touchUiVisible,
      dashboardScroll: g.dashboardScroll,
      zoomDelta: this.zoomDelta,
      stepFrame: this.justPressed.has(" ") || this.justPressed.has("Space"),
      inputType: this.lastInputType,
    };

    this._resetOneShotFlags();

    return state;
  }

  /**
   * @returns {void}
   */
  _resetOneShotFlags(){
    this.justPressed.clear();
    this.oneshot.reset = false;
    this.oneshot.abandonRun = false;
    this.oneshot.regen = false;
    this.oneshot.toggleDebug = false;
    this.oneshot.toggleDevHud = false;
    this.oneshot.toggleFrameStep = false;
    this.oneshot.togglePlanetView = false;
    this.oneshot.toggleRingVertices = false;
    this.oneshot.togglePlanetTriangles = false;
    this.oneshot.toggleCollisionContours = false;
    this.oneshot.toggleMinerGuidePath = false;
    this.oneshot.toggleFog = false;
    this.oneshot.toggleMusic = false;
    this.oneshot.toggleCombatMusic = false;
    this.oneshot.musicVolumeUp = false;
    this.oneshot.musicVolumeDown = false;
    this.oneshot.sfxVolumeUp = false;
    this.oneshot.sfxVolumeDown = false;
    this.oneshot.copyScreenshot = false;
    this.oneshot.copyScreenshotClean = false;
    this.oneshot.copyScreenshotCleanTitle = false;
    this.oneshot.nextLevel = false;
    this.oneshot.prevLevel = false;
    this.oneshot.promptLevelJump = false;
    this.oneshot.zoomReset = false;
    this.oneshot.shoot = false;
    this.oneshot.bomb = false;
    this.oneshot.rescueAll = false;
    this.oneshot.killAllEnemies = false;
    this.oneshot.removeEntities = false;
    this.oneshot.perkLeft = false;
    this.oneshot.perkRight = false;
    this.oneshot.spawnEnemyType = null;
    this.zoomDelta = 0;
    this.bombReleaseFrom = null;
    this.bombReleaseTo = null;
  }
}

