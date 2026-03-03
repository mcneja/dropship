// @ts-check

/** @typedef {import("./types.d.js").Point} Point */
/** @typedef {import("./types.d.js").InputState} InputState */

import { TOUCH_UI, GAME } from "./config.js";

const KEY_LEFT = new Set(["ArrowLeft", "a", "A"]);
const KEY_RIGHT = new Set(["ArrowRight", "d", "D"]);
const KEY_THRUST = new Set([" ", "Space", "ArrowUp", "w", "W"]);
const KEY_DOWN = new Set(["ArrowDown", "s", "S"]);
const KEY_RESET = new Set(["r", "R"]);

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

    /** @type {{id:number|null,pos:Point|null,start:Point|null}} */
    this.leftControl = { id: null, pos: null, start: null };
    /** @type {{id:number|null,pos:Point|null,start:Point|null,lastFire:number}} */
    this.laserControl = { id: null, pos: null, start: null, lastFire: 0 };
    /** @type {{id:number|null,pos:Point|null,start:Point|null,lastFire:number}} */
    this.bombControl = { id: null, pos: null, start: null, lastFire: 0 };

    this.oneshot = {
      regen: false,
      toggleDebug: false,
      toggleRender: true,
      reset: false,
      nextLevel: false,
      shoot: false,
      bomb: false,
    };
    /** @type {boolean} */
    this.prevPadShoot = false;
    /** @type {boolean} */
    this.prevPadBomb = false;
    /** @type {boolean} */
    this.prevPadStart = false;
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
    /** @type {"keyboard"|"mouse"|"touch"|"gamepad"|null} */
    this.lastInputType = null;
    this.lastPointerShootTime = 0;
    this.SHOOT_DEBOUNCE_MS = 50;
    this.LASER_INTERVAL_MS = 500;
    this.BOMB_INTERVAL_MS = 2000;
    this.pointerLocked = false;
    /** @type {boolean} */
    this.gameOver = false;

    window.addEventListener("keydown", (e) => this._onKeyDown(e), { passive: false });
    window.addEventListener("keyup", (e) => this._onKeyUp(e), { passive: false });

    canvas.addEventListener("pointerdown", (e) => this._onPointerDown(e), { passive: false });
    canvas.addEventListener("pointermove", (e) => this._onPointerMove(e), { passive: true });
    canvas.addEventListener("pointerup", (e) => this._onPointerUp(e), { passive: true });
    canvas.addEventListener("pointercancel", (e) => this._onPointerUp(e), { passive: true });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, { passive: false });

    document.addEventListener("pointerlockchange", () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      this.canvas.style.cursor = this.pointerLocked ? "none" : "default";
    });
  }

  /**
   * @param {boolean} gameOver
   * @returns {void}
   */
  setGameOver(gameOver){
    this.gameOver = gameOver;
    if (gameOver){
      this.aimMouse = null;
      this.aimTouchShoot = null;
      this.aimTouchBomb = null;
      this.aimTouchShootFrom = null;
      this.aimTouchShootTo = null;
      this.aimTouchBombFrom = null;
      this.aimTouchBombTo = null;
      this.leftControl.id = null;
      this.leftControl.pos = null;
      this.leftControl.start = null;
      this.laserControl.id = null;
      this.laserControl.pos = null;
      this.laserControl.start = null;
      this.bombControl.id = null;
      this.bombControl.pos = null;
      this.bombControl.start = null;
      this.oneshot.shoot = false;
      this.oneshot.bomb = false;
    }
  }

  /**
   * @param {number} now
   * @returns {void}
   */
  _fireShoot(now){
    if (now - this.lastPointerShootTime < this.SHOOT_DEBOUNCE_MS) return;
    this.oneshot.shoot = true;
    this.lastPointerShootTime = now;
  }

  /** @returns {void} */
  _fireBomb(){
    this.oneshot.bomb = true;
  }

  /**
   * @param {KeyboardEvent} e
   * @returns {void}
   */
  _onKeyDown(e){
    const key = e.key;
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," ","Space"].includes(key)) e.preventDefault();
    if (!this.keys.has(key)) this.justPressed.add(key);
    this.keys.add(key);
    this.lastInputType = "keyboard";

    if (key === "m" || key === "M") this.oneshot.regen = true;
    if (key === "c" || key === "C") this.oneshot.toggleDebug = true;
    if (key === "n" || key === "N") this.oneshot.nextLevel = true;
    if (key === "v" || key === "V") this.oneshot.toggleRender = true;
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
   * @param {PointerEvent} e
   * @returns {void}
   */
  _onPointerDown(e){
    if (this.gameOver && e.pointerType !== "touch"){
      return;
    }
    if (e.pointerType !== "touch"){
      if (!this.pointerLocked && document.pointerLockElement !== this.canvas){
        this.canvas.requestPointerLock();
      }
      if (!this.pointerLocked){
        this.aimMouse = this._pointerPos(e);
      }
      const now = performance.now();
      if (e.button === 2) this._fireBomb();
      else if (e.button === 0 || (e.buttons & 1)) this._fireShoot(now);
      this.lastInputType = "mouse";
      return;
    }
    e.preventDefault();
    this.lastInputType = "touch";
    const p = this._pointerPos(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (this.gameOver && this._inCircle(p, TOUCH_UI.start, TOUCH_UI.start.r)){
      this.oneshot.reset = true;
      return;
    }
    if (this.leftControl.id === null && this._inCircle(p, TOUCH_UI.left, TOUCH_UI.left.r)){
      this.leftControl.id = e.pointerId;
      this.leftControl.pos = p;
      this.leftControl.start = p;
    } else if (this.laserControl.id === null && this._inDiamond(p, TOUCH_UI.laser, TOUCH_UI.laser.r)){
      this.laserControl.id = e.pointerId;
      this.laserControl.pos = p;
      this.laserControl.start = p;
      this.laserControl.lastFire = performance.now() - this.LASER_INTERVAL_MS;
    } else if (this.bombControl.id === null && this._inSquare(p, TOUCH_UI.bomb, TOUCH_UI.bomb.r)){
      this.bombControl.id = e.pointerId;
      this.bombControl.pos = p;
      this.bombControl.start = p;
      this.bombControl.lastFire = performance.now() - this.BOMB_INTERVAL_MS;
    }
  }

  /**
   * @param {PointerEvent} e
   * @returns {void}
   */
  _onPointerMove(e){
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
    if (this.gameOver && e.pointerType !== "touch"){
      return;
    }
    if (e.pointerType !== "touch"){
      if (!this.pointerLocked){
        this.aimMouse = this._pointerPos(e);
      }
      this.lastInputType = "mouse";
      return;
    }
    if (this.leftControl.id === e.pointerId){
      this.leftControl.id = null;
      this.leftControl.pos = null;
      this.leftControl.start = null;
    } else if (this.laserControl.id === e.pointerId){
      this.laserControl.id = null;
      this.laserControl.pos = null;
      this.laserControl.start = null;
    } else if (this.bombControl.id === e.pointerId){
      this.bombControl.id = null;
      this.bombControl.pos = null;
      this.bombControl.start = null;
    }
  }

  /**
   * @returns {{left:boolean,right:boolean,thrust:boolean,down:boolean}}
   */
  _touchState(){
    let left = false;
    let right = false;
    let thrust = false;
    let down = false;

    this.aimTouchShoot = null;
    this.aimTouchBomb = null;
    this.aimTouchShootFrom = null;
    this.aimTouchShootTo = null;
    this.aimTouchBombFrom = null;
    this.aimTouchBombTo = null;
    const dead = TOUCH_UI.dead;
    if (this.leftControl.id !== null && this.leftControl.pos){
      const dx = this.leftControl.pos.x - TOUCH_UI.left.x;
      const dy = this.leftControl.pos.y - TOUCH_UI.left.y;
      if (dx < -dead) left = true;
      if (dx > dead) right = true;
      if (dy < -dead) thrust = true;
      if (dy > dead) down = true;
    }

    /**
     * @param {{id:number|null,pos:Point|null,start:Point|null}|null|undefined} control
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

    this.aimTouchShoot = aimFromControl(this.laserControl, TOUCH_UI.laser);
    this.aimTouchBomb = aimFromControl(this.bombControl, TOUCH_UI.bomb);
    if (this.laserControl.id !== null && this.laserControl.pos && this.aimTouchShoot){
      this.aimTouchShootFrom = { x: TOUCH_UI.laser.x, y: TOUCH_UI.laser.y };
      this.aimTouchShootTo = { x: this.laserControl.pos.x, y: this.laserControl.pos.y };
    }
    if (this.bombControl.id !== null && this.bombControl.pos && this.aimTouchBomb){
      this.aimTouchBombFrom = { x: TOUCH_UI.bomb.x, y: TOUCH_UI.bomb.y };
      this.aimTouchBombTo = { x: this.bombControl.pos.x, y: this.bombControl.pos.y };
    }

    return { left, right, thrust, down };
  }

  /**
   * @returns {{left:boolean,right:boolean,thrust:boolean,down:boolean,aim:Point|null,shoot:boolean,bomb:boolean,reset:boolean}}
   */
  _gamepadState(){
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && pads[0];
    if (!pad) return { left:false, right:false, thrust:false, down:false, aim:null, shoot:false, bomb:false, reset:false };

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
      const radius = Math.max(0.25, GAME.AIM_SCREEN_RADIUS || 0.25);
      aim = { x: 0.5 + ux * radius, y: 0.5 + uy * radius };
    }

    const rb = !!(pad.buttons && pad.buttons[5] && pad.buttons[5].pressed);
    const rt = !!(pad.buttons && pad.buttons[7] && (pad.buttons[7].pressed || pad.buttons[7].value > 0.4));
    const startPressed = !!(pad.buttons && pad.buttons[9] && pad.buttons[9].pressed);
    const shoot = rb && !this.prevPadShoot;
    const bomb = rt && !this.prevPadBomb;
    const reset = startPressed && !this.prevPadStart;
    const anyInput = left || right || thrust || down || aim || rb || rt || startPressed;
    if (anyInput) this.lastInputType = "gamepad";
    this.prevPadShoot = rb;
    this.prevPadBomb = rt;
    this.prevPadStart = startPressed;

    return { left, right, thrust, down, aim, shoot, bomb, reset };
  }

  /**
   * @returns {InputState}
   */
  update(){
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
      if (KEY_RESET.has(k)) this.oneshot.reset = true;
    });

    const t = this._touchState();
    const g = this._gamepadState();

    let left = keyState.left || t.left || g.left;
    let right = keyState.right || t.right || g.right;
    let thrust = keyState.thrust || t.thrust || g.thrust;
    let down = keyState.down || t.down || g.down;
    if (g.shoot) this.oneshot.shoot = true;
    if (g.bomb) this.oneshot.bomb = true;
    if (g.reset) this.oneshot.reset = true;

    if (!this.gameOver && this.aimTouchShoot && this.laserControl.id !== null){
      if (now - this.laserControl.lastFire >= this.LASER_INTERVAL_MS){
        this.oneshot.shoot = true;
        this.laserControl.lastFire = now;
      }
    }
    if (!this.gameOver && this.aimTouchBomb && this.bombControl.id !== null){
      if (now - this.bombControl.lastFire >= this.BOMB_INTERVAL_MS){
        this.oneshot.bomb = true;
        this.bombControl.lastFire = now;
      }
    }

    const touchUiVisible = !this.gameOver && this.lastInputType === "touch";
    const touchUi = touchUiVisible ? {
      leftTouch: this.leftControl.pos,
      laserTouch: this.laserControl.pos,
      bombTouch: this.bombControl.pos,
    } : null;

    let aimShoot = null;
    let aimBomb = null;
    let aim = null;
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

    const state = {
      left,
      right,
      thrust,
      down,
      reset: this.oneshot.reset,
      regen: this.oneshot.regen,
      toggleDebug: this.oneshot.toggleDebug,
      toggleRender: this.oneshot.toggleRender,
      nextLevel: this.oneshot.nextLevel,
      shoot: this.oneshot.shoot,
      bomb: this.oneshot.bomb,
      aim,
      aimShoot,
      aimBomb,
      aimShootFrom: this.aimTouchShootFrom,
      aimShootTo: this.aimTouchShootTo,
      aimBombFrom: this.aimTouchBombFrom,
      aimBombTo: this.aimTouchBombTo,
      touchUi,
      touchUiVisible,
      inputType: this.lastInputType,
    };

    this.justPressed.clear();
    this.oneshot.reset = false;
    this.oneshot.regen = false;
    this.oneshot.toggleDebug = false;
    this.oneshot.toggleRender = false;
    this.oneshot.nextLevel = false;
    this.oneshot.shoot = false;
    this.oneshot.bomb = false;

    return state;
  }
}
