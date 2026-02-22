// @ts-check

/** @typedef {{x:number,y:number}} Point */
/** @typedef {{left:boolean,right:boolean,thrust:boolean,down:boolean,reset:boolean,regen:boolean,toggleDebug:boolean,nextLevel:boolean,shoot:boolean,bomb:boolean,aim?:Point|null,aimShoot?:Point|null,aimBomb?:Point|null,aimShootFrom?:Point|null,aimShootTo?:Point|null,aimBombFrom?:Point|null,aimBombTo?:Point|null,touchUi?:{leftTouch:Point|null,laserTouch:Point|null,bombTouch:Point|null}|null,touchUiVisible?:boolean}} InputState */

import { TOUCH_UI } from "./config.js";

const KEY_LEFT = new Set(["ArrowLeft", "a", "A"]);
const KEY_RIGHT = new Set(["ArrowRight", "d", "D"]);
const KEY_THRUST = new Set([" ", "Space", "ArrowUp", "w", "W"]);
const KEY_DOWN = new Set(["ArrowDown", "s", "S"]);
const KEY_RESET = new Set(["r", "R"]);

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createInput(canvas){
  /** @type {Set<string>} */
  const keys = new Set();
  /** @type {Set<string>} */
  const justPressed = new Set();

  /** @type {{id:number|null,pos:Point|null,start:Point|null}} */
  const leftControl = { id: null, pos: null, start: null };
  /** @type {{id:number|null,pos:Point|null,start:Point|null,lastFire:number}} */
  const laserControl = { id: null, pos: null, start: null, lastFire: 0 };
  /** @type {{id:number|null,pos:Point|null,start:Point|null,lastFire:number}} */
  const bombControl = { id: null, pos: null, start: null, lastFire: 0 };

  const oneshot = {
    regen: false,
    toggleDebug: false,
    reset: false,
    nextLevel: false,
    shoot: false,
    bomb: false,
  };
  /** @type {boolean} */
  let prevPadShoot = false;
  /** @type {boolean} */
  let prevPadBomb = false;
  /** @type {Point|null} */
  let aimMouse = null;
  /** @type {Point|null} */
  let aimTouchShoot = null;
  /** @type {Point|null} */
  let aimTouchBomb = null;
  /** @type {Point|null} */
  let aimTouchShootFrom = null;
  /** @type {Point|null} */
  let aimTouchShootTo = null;
  /** @type {Point|null} */
  let aimTouchBombFrom = null;
  /** @type {Point|null} */
  let aimTouchBombTo = null;
  /** @type {"keyboard"|"mouse"|"touch"|"gamepad"|null} */
  let lastInputType = null;
  let lastPointerShootTime = 0;
  const SHOOT_DEBOUNCE_MS = 50;
  const LASER_INTERVAL_MS = 500;
  const BOMB_INTERVAL_MS = 2000;

  /**
   * @param {number} now
   */
  function fireShoot(now){
    if (now - lastPointerShootTime < SHOOT_DEBOUNCE_MS) return;
    oneshot.shoot = true;
    lastPointerShootTime = now;
  }
  /** @returns {void} */
  function fireBomb(){
    oneshot.bomb = true;
  }

  /**
   * @param {KeyboardEvent} e
   */
  function onKeyDown(e){
    const key = e.key;
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," ","Space"].includes(key)) e.preventDefault();
    if (!keys.has(key)) justPressed.add(key);
    keys.add(key);
    lastInputType = "keyboard";

    if (key === "m" || key === "M") oneshot.regen = true;
    if (key === "c" || key === "C") oneshot.toggleDebug = true;
    if (key === "n" || key === "N") oneshot.nextLevel = true;
  }
  /**
   * @param {KeyboardEvent} e
   */
  function onKeyUp(e){
    keys.delete(e.key);
  }

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp, { passive: false });

  /**
   * @param {PointerEvent|MouseEvent} e
   */
  function pointerPos(e){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / Math.max(1, rect.width),
      y: (e.clientY - rect.top) / Math.max(1, rect.height),
    };
  }

  /**
   * @param {Point} p
   * @param {{x:number,y:number}} c
   * @param {number} r
   * @returns {boolean}
   */
  function inCircle(p, c, r){
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
  function inDiamond(p, c, r){
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
  function inSquare(p, c, r){
    const dx = Math.abs(p.x - c.x);
    const dy = Math.abs(p.y - c.y);
    return Math.max(dx, dy) <= r;
  }

  /**
   * @param {PointerEvent} e
   */
  function onPointerDown(e){
    if (e.pointerType !== "touch"){
      aimMouse = pointerPos(e);
      const now = performance.now();
      if (e.button === 2) fireBomb();
      else if (e.button === 0 || (e.buttons & 1)) fireShoot(now);
      lastInputType = "mouse";
      return;
    }
    e.preventDefault();
    lastInputType = "touch";
    const p = pointerPos(e);
    canvas.setPointerCapture(e.pointerId);
    if (leftControl.id === null && inCircle(p, TOUCH_UI.left, TOUCH_UI.left.r)){
      leftControl.id = e.pointerId;
      leftControl.pos = p;
      leftControl.start = p;
    } else if (laserControl.id === null && inDiamond(p, TOUCH_UI.laser, TOUCH_UI.laser.r)){
      laserControl.id = e.pointerId;
      laserControl.pos = p;
      laserControl.start = p;
      laserControl.lastFire = performance.now() - LASER_INTERVAL_MS;
    } else if (bombControl.id === null && inSquare(p, TOUCH_UI.bomb, TOUCH_UI.bomb.r)){
      bombControl.id = e.pointerId;
      bombControl.pos = p;
      bombControl.start = p;
      bombControl.lastFire = performance.now() - BOMB_INTERVAL_MS;
    }
  }
  /**
   * @param {PointerEvent} e
   */
  function onPointerMove(e){
    const p = pointerPos(e);
    if (e.pointerType !== "touch"){
      aimMouse = p;
      lastInputType = "mouse";
      return;
    }
    if (leftControl.id === e.pointerId){
      leftControl.pos = p;
    } else if (laserControl.id === e.pointerId){
      laserControl.pos = p;
    } else if (bombControl.id === e.pointerId){
      bombControl.pos = p;
    }
  }
  /**
   * @param {PointerEvent} e
   */
  function onPointerUp(e){
    if (e.pointerType !== "touch"){
      aimMouse = pointerPos(e);
      const now = performance.now();
      if (e.button === 2) fireBomb();
      else if (e.button === 0) fireShoot(now);
      lastInputType = "mouse";
      return;
    }
    if (leftControl.id === e.pointerId){
      leftControl.id = null;
      leftControl.pos = null;
      leftControl.start = null;
    } else if (laserControl.id === e.pointerId){
      laserControl.id = null;
      laserControl.pos = null;
      laserControl.start = null;
    } else if (bombControl.id === e.pointerId){
      bombControl.id = null;
      bombControl.pos = null;
      bombControl.start = null;
    }
  }

  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerup", onPointerUp, { passive: true });
  canvas.addEventListener("pointercancel", onPointerUp, { passive: true });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("dblclick", (e) => {
    e.preventDefault();
    e.stopPropagation();
  }, { passive: false });

  /**
   * @returns {{left:boolean,right:boolean,thrust:boolean,down:boolean}}
   */
  function touchState(){
    let left = false;
    let right = false;
    let thrust = false;
    let down = false;

    aimTouchShoot = null;
    aimTouchBomb = null;
    aimTouchShootFrom = null;
    aimTouchShootTo = null;
    aimTouchBombFrom = null;
    aimTouchBombTo = null;
    const dead = TOUCH_UI.dead;
    if (leftControl.id !== null && leftControl.pos){
      const dx = leftControl.pos.x - TOUCH_UI.left.x;
      const dy = leftControl.pos.y - TOUCH_UI.left.y;
      if (dx < -dead) left = true;
      if (dx > dead) right = true;
      if (dy < -dead) thrust = true;
      if (dy > dead) down = true;
    }

    /**
     * @param {{id:number|null,pos:Point|null,start:Point|null}|null|undefined} control
     * @param {Point} center
     * @returns {Point|null}
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
      const radius = TOUCH_UI.aimRadius;
      if (len > 1e-4){
        const ux = dx / len;
        const uy = dy / len;
        return { x: center.x + ux * radius, y: center.y + uy * radius };
      }
      return { x: center.x, y: center.y - radius };
    };

    aimTouchShoot = aimFromControl(laserControl, TOUCH_UI.laser);
    aimTouchBomb = aimFromControl(bombControl, TOUCH_UI.bomb);
    if (laserControl.id !== null && laserControl.pos && aimTouchShoot){
      aimTouchShootFrom = { x: TOUCH_UI.laser.x, y: TOUCH_UI.laser.y };
      aimTouchShootTo = { x: laserControl.pos.x, y: laserControl.pos.y };
    }
    if (bombControl.id !== null && bombControl.pos && aimTouchBomb){
      aimTouchBombFrom = { x: TOUCH_UI.bomb.x, y: TOUCH_UI.bomb.y };
      aimTouchBombTo = { x: bombControl.pos.x, y: bombControl.pos.y };
    }

    return { left, right, thrust, down };
  }

  /**
   * @returns {{left:boolean,right:boolean,thrust:boolean,down:boolean,aim:Point|null,shoot:boolean,bomb:boolean}}
   */
  function gamepadState(){
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && pads[0];
    if (!pad) return { left:false, right:false, thrust:false, down:false, aim:null, shoot:false, bomb:false };

    const dead = 0.2;
    const ax0 = pad.axes && pad.axes.length ? pad.axes[0] : 0;
    const ax1 = pad.axes && pad.axes.length > 1 ? pad.axes[1] : 0;
    const ax2 = pad.axes && pad.axes.length > 2 ? pad.axes[2] : 0;
    const ax3 = pad.axes && pad.axes.length > 3 ? pad.axes[3] : 0;

    const left = ax0 < -dead;
    const right = ax0 > dead;
    const thrust = (pad.buttons && pad.buttons[0] && pad.buttons[0].pressed) || ax1 < -dead;
    const down = (pad.buttons && pad.buttons[1] && pad.buttons[1].pressed) || ax1 > dead;

    let aim = null;
    const alen = Math.hypot(ax2, ax3);
    if (alen > dead){
      const ux = ax2 / alen;
      const uy = ax3 / alen;
      const radius = 0.22;
      aim = { x: 0.5 + ux * radius, y: 0.5 + uy * radius };
    }

    const rb = !!(pad.buttons && pad.buttons[5] && pad.buttons[5].pressed);
    const rt = !!(pad.buttons && pad.buttons[7] && (pad.buttons[7].pressed || pad.buttons[7].value > 0.4));
    const shoot = rb && !prevPadShoot;
    const bomb = rt && !prevPadBomb;
    const anyInput = left || right || thrust || down || aim || rb || rt;
    if (anyInput) lastInputType = "gamepad";
    prevPadShoot = rb;
    prevPadBomb = rt;

    return { left, right, thrust, down, aim, shoot, bomb };
  }

  /**
   * @returns {InputState}
   */
  function update(){
    const now = performance.now();
    const keyState = {
      left: false,
      right: false,
      thrust: false,
      down: false,
    };

    for (const k of keys){
      if (KEY_LEFT.has(k)) keyState.left = true;
      if (KEY_RIGHT.has(k)) keyState.right = true;
      if (KEY_THRUST.has(k)) keyState.thrust = true;
      if (KEY_DOWN.has(k)) keyState.down = true;
      if (KEY_RESET.has(k)) oneshot.reset = true;
    }

    const t = touchState();
    const g = gamepadState();

    const left = keyState.left || t.left || g.left;
    const right = keyState.right || t.right || g.right;
    const thrust = keyState.thrust || t.thrust || g.thrust;
    const down = keyState.down || t.down || g.down;
    if (g.shoot) oneshot.shoot = true;
    if (g.bomb) oneshot.bomb = true;

    if (aimTouchShoot && laserControl.id !== null){
      if (now - laserControl.lastFire >= LASER_INTERVAL_MS){
        oneshot.shoot = true;
        laserControl.lastFire = now;
      }
    }
    if (aimTouchBomb && bombControl.id !== null){
      if (now - bombControl.lastFire >= BOMB_INTERVAL_MS){
        oneshot.bomb = true;
        bombControl.lastFire = now;
      }
    }

    const touchUiVisible = lastInputType === "touch";
    const touchUi = touchUiVisible ? {
      leftTouch: leftControl.pos,
      laserTouch: laserControl.pos,
      bombTouch: bombControl.pos,
    } : null;

    const aimShoot = aimTouchShoot || aimMouse || g.aim || null;
    const aimBomb = aimTouchBomb || aimShoot;
    const aim = aimShoot || aimBomb || null;

    const state = {
      left,
      right,
      thrust,
      down,
      reset: oneshot.reset,
      regen: oneshot.regen,
      toggleDebug: oneshot.toggleDebug,
      nextLevel: oneshot.nextLevel,
      shoot: oneshot.shoot,
      bomb: oneshot.bomb,
      aim,
      aimShoot,
      aimBomb,
      aimShootFrom: aimTouchShootFrom,
      aimShootTo: aimTouchShootTo,
      aimBombFrom: aimTouchBombFrom,
      aimBombTo: aimTouchBombTo,
      touchUi,
      touchUiVisible,
    };

    justPressed.clear();
    oneshot.reset = false;
    oneshot.regen = false;
    oneshot.toggleDebug = false;
    oneshot.nextLevel = false;
    oneshot.shoot = false;
    oneshot.bomb = false;

    return state;
  }

  return { update };
}
