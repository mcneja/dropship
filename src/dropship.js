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
 * @param {Array<[number,number]>} points
 * @returns {Array<[number,number]>}
 */
function convexHull(points){
  if (!Array.isArray(points) || points.length <= 3) return Array.isArray(points) ? points.slice() : [];
  /** @type {Array<[number,number]>} */
  const sorted = points
    .map((p) => /** @type {[number,number]} */ ([Number(p[0]), Number(p[1])]))
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (sorted.length <= 3) return sorted;
  /**@type {(o:[number, number], a:[number, number], b:[number, number])=>number} */
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  /** @type {Array<[number,number]>} */
  const lower = [];
  for (const p of sorted){
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0){
      lower.pop();
    }
    lower.push(p);
  }
  /** @type {Array<[number,number]>} */
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--){
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0){
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
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
  const skiOut = shipWWorld * 0.18;
  const skiDrop = shipHWorld * 0.08;
  const xBody = bottomHalfW;
  const xTop = topHalfW;
  const xSki = xBody + skiOut;
  const yTop = cargoTop + bodyLift;
  const yBody = cargoBottom + bodyLift;
  const ySki = yBody - skiDrop;
  // Build the true convex hull of the body + ski candidate points.
  return convexHull([
    [xTop, yTop],
    [xBody, yBody],
    [xSki, ySki],
    [-xSki, ySki],
    [-xBody, yBody],
    [-xTop, yTop],
  ]);
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
 * Ship art stays aligned to local "up" from the planet center.
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function getDropshipWorldRotation(x, y){
  return -Math.atan2(x, y || 1e-6);
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
