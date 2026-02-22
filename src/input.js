// @ts-check

/** @typedef {{left:boolean,right:boolean,thrust:boolean,down:boolean,reset:boolean,regen:boolean,toggleDebug:boolean}} InputState */

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

  /** @type {Map<number, {x:number,y:number}>} */
  const pointers = new Map();

  const oneshot = {
    regen: false,
    toggleDebug: false,
    reset: false,
  };

  function onKeyDown(e){
    const key = e.key;
    if (["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"," ","Space"].includes(key)) e.preventDefault();
    if (!keys.has(key)) justPressed.add(key);
    keys.add(key);

    if (key === "m" || key === "M") oneshot.regen = true;
    if (key === "c" || key === "C") oneshot.toggleDebug = true;
  }
  function onKeyUp(e){
    keys.delete(e.key);
  }

  window.addEventListener("keydown", onKeyDown, { passive: false });
  window.addEventListener("keyup", onKeyUp, { passive: false });

  function pointerPos(e){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / Math.max(1, rect.width),
      y: (e.clientY - rect.top) / Math.max(1, rect.height),
    };
  }

  function onPointerDown(e){
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, pointerPos(e));
  }
  function onPointerMove(e){
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, pointerPos(e));
  }
  function onPointerUp(e){
    pointers.delete(e.pointerId);
  }

  canvas.addEventListener("pointerdown", onPointerDown, { passive: true });
  canvas.addEventListener("pointermove", onPointerMove, { passive: true });
  canvas.addEventListener("pointerup", onPointerUp, { passive: true });
  canvas.addEventListener("pointercancel", onPointerUp, { passive: true });

  /**
   * @returns {{left:boolean,right:boolean,thrust:boolean,down:boolean}}
   */
  function touchState(){
    let left = false;
    let right = false;
    let thrust = false;
    let down = false;

    for (const p of pointers.values()){
      if (p.x < 0.5){
        if (p.x < 0.25) left = true;
        else right = true;
      } else {
        if (p.y < 0.5) thrust = true;
        else down = true;
      }
    }

    return { left, right, thrust, down };
  }

  /**
   * @returns {{left:boolean,right:boolean,thrust:boolean,down:boolean}}
   */
  function gamepadState(){
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = pads && pads[0];
    if (!pad) return { left:false, right:false, thrust:false, down:false };

    const dead = 0.2;
    const ax0 = pad.axes && pad.axes.length ? pad.axes[0] : 0;
    const ax1 = pad.axes && pad.axes.length > 1 ? pad.axes[1] : 0;

    const left = ax0 < -dead;
    const right = ax0 > dead;
    const thrust = (pad.buttons && pad.buttons[0] && pad.buttons[0].pressed) || ax1 < -dead;
    const down = (pad.buttons && pad.buttons[1] && pad.buttons[1].pressed) || ax1 > dead;

    return { left, right, thrust, down };
  }

  /**
   * @returns {InputState}
   */
  function update(){
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

    const state = {
      left,
      right,
      thrust,
      down,
      reset: oneshot.reset,
      regen: oneshot.regen,
      toggleDebug: oneshot.toggleDebug,
    };

    justPressed.clear();
    oneshot.reset = false;
    oneshot.regen = false;
    oneshot.toggleDebug = false;

    return state;
  }

  return { update };
}
