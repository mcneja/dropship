// @ts-check

/** @typedef {{x:number,y:number}} Point */
/** @typedef {{stickThrust?:Point,left?:boolean,right?:boolean,thrust?:boolean,down?:boolean}} DropshipInput */

export const DROPSHIP_MODEL = Object.freeze({
  shipRenderHScale: 0.7,
  shipRenderWScale: 0.75,
  shipHullWScale: 0.7,
  bodyLiftN: 0.18,
  skiLiftN: 0.0,
  cargoWidthScale: 2 / 3,
  cargoHeightScale: 2.0,
  cargoBottomN: -0.35,
  cargoTopBaseN: 0.18,
  gunStrutHeightN: 0.12,
  gunLiftN: 0.04,
});

/**
 * @param {{SHIP_SCALE:number}} game
 * @returns {{shipHWorld:number,shipWWorld:number}}
 */
export function getDropshipRenderSize(game){
  return {
    shipHWorld: DROPSHIP_MODEL.shipRenderHScale * game.SHIP_SCALE,
    shipWWorld: DROPSHIP_MODEL.shipRenderWScale * game.SHIP_SCALE,
  };
}

/**
 * @param {{SHIP_SCALE:number}} game
 * @returns {{shipHWorld:number,shipWWorld:number}}
 */
function getDropshipHullSize(game){
  return {
    shipHWorld: DROPSHIP_MODEL.shipRenderHScale * game.SHIP_SCALE,
    shipWWorld: DROPSHIP_MODEL.shipHullWScale * game.SHIP_SCALE,
  };
}

/**
 * @returns {{cargoBottomN:number,cargoHeightN:number,cargoTopN:number}}
 */
export function getDropshipCargoBoundsN(){
  const cargoBottomN = DROPSHIP_MODEL.cargoBottomN;
  const cargoHeightN = (DROPSHIP_MODEL.cargoTopBaseN - cargoBottomN) * DROPSHIP_MODEL.cargoHeightScale;
  const cargoTopN = cargoBottomN + cargoHeightN;
  return { cargoBottomN, cargoHeightN, cargoTopN };
}

/**
 * @param {{SHIP_SCALE:number}} game
 * @returns {Array<[number,number]>}
 */
export function buildDropshipLocalHullPoints(game){
  const { shipHWorld, shipWWorld } = getDropshipHullSize(game);
  const { bodyLiftN, cargoWidthScale } = DROPSHIP_MODEL;
  const { cargoBottomN, cargoTopN } = getDropshipCargoBoundsN();
  const bodyLift = shipHWorld * bodyLiftN;
  const cargoBottom = shipHWorld * cargoBottomN - bodyLift;
  const cargoTop = shipHWorld * cargoTopN - bodyLift;
  const bottomHalfW = shipWWorld * 0.87 * cargoWidthScale;
  const topHalfW = shipWWorld * 0.65 * cargoWidthScale * 0.8;
  const topRight = topHalfW;
  const topLeft = -topHalfW;
  return [
    [topRight, cargoTop + bodyLift],
    [bottomHalfW, cargoBottom + bodyLift],
    [0, cargoBottom + bodyLift],
    [-bottomHalfW, cargoBottom + bodyLift],
    [topLeft, cargoTop + bodyLift],
    [0, cargoTop + bodyLift],
  ];
}

/**
 * @param {{SHIP_SCALE:number}} game
 * @returns {{x:number,y:number}}
 */
export function getDropshipGunPivotLocal(game){
  const { shipHWorld } = getDropshipRenderSize(game);
  const { bodyLiftN, gunStrutHeightN, gunLiftN } = DROPSHIP_MODEL;
  const { cargoTopN } = getDropshipCargoBoundsN();
  return {
    x: 0,
    y: (cargoTopN + gunStrutHeightN + gunLiftN + bodyLiftN) * shipHWorld,
  };
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {{r:number,rx:number,ry:number,tx:number,ty:number}}
 */
export function computeDropshipAxes(x, y){
  const r = Math.hypot(x, y) || 1;
  const rx = x / r;
  const ry = y / r;
  const tx = -ry;
  const ty = rx;
  return { r, rx, ry, tx, ty };
}

/**
 * @param {{x:number,y:number}} ship
 * @param {DropshipInput} input
 * @param {number} thrustMax
 * @returns {{ax:number,ay:number,r:number,rx:number,ry:number,tx:number,ty:number}}
 */
export function computeDropshipAcceleration(ship, input, thrustMax){
  const { r, rx, ry, tx, ty } = computeDropshipAxes(ship.x, ship.y);
  const stick = input.stickThrust || { x: 0, y: 0 };
  let ax = 0;
  let ay = 0;
  if (input.left){
    ax += tx * thrustMax;
    ay += ty * thrustMax;
  }
  if (input.right){
    ax -= tx * thrustMax;
    ay -= ty * thrustMax;
  }
  if (input.thrust){
    ax += rx * thrustMax;
    ay += ry * thrustMax;
  }
  if (input.down){
    ax -= rx * thrustMax;
    ay -= ry * thrustMax;
  }
  ax += (stick.x * -tx + stick.y * rx) * thrustMax;
  ay += (stick.x * -ty + stick.y * ry) * thrustMax;
  return { ax, ay, r, rx, ry, tx, ty };
}

/**
 * @param {number} cabinSide
 * @param {DropshipInput} input
 * @param {number} [stickDead]
 * @returns {number}
 */
export function resolveDropshipFacing(cabinSide, input, stickDead = 0.15){
  const stickX = (input.stickThrust && Number.isFinite(input.stickThrust.x)) ? input.stickThrust.x : 0;
  const faceLeft = !!input.left || stickX < -stickDead;
  const faceRight = !!input.right || stickX > stickDead;
  if (faceLeft && !faceRight) return -1;
  if (faceRight && !faceLeft) return 1;
  return cabinSide;
}

/**
 * @param {DropshipInput} input
 * @param {number} [stickDead]
 * @returns {boolean}
 */
export function hasDropshipThrustInput(input, stickDead = 0.12){
  const stick = input.stickThrust || { x: 0, y: 0 };
  const stickMagSqr = stick.x * stick.x + stick.y * stick.y;
  return !!(input.left || input.right || input.thrust || input.down || stickMagSqr > stickDead * stickDead);
}

/**
 * @param {DropshipInput} input
 * @returns {boolean}
 */
export function wantsDropshipLiftoff(input){
  const stick = input.stickThrust || { x: 0, y: 0 };
  const stickMagSqr = stick.x * stick.x + stick.y * stick.y;
  return !!(input.left || input.right || input.thrust || stickMagSqr > 0);
}

/**
 * @param {DropshipInput} input
 * @returns {{up:number,down:number,left:number,right:number}}
 */
export function getDropshipThrusterPowers(input){
  const stick = input.stickThrust || { x: 0, y: 0 };
  const analogLeft = Math.max(0, -stick.x);
  const analogRight = Math.max(0, stick.x);
  const analogUp = Math.max(0, stick.y);
  const analogDown = Math.max(0, -stick.y);
  return {
    up: Math.max(input.thrust ? 1 : 0, analogUp),
    down: Math.max(input.down ? 1 : 0, analogDown),
    left: Math.max(input.left ? 1 : 0, analogLeft),
    right: Math.max(input.right ? 1 : 0, analogRight),
  };
}
