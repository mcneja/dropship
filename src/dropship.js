// @ts-check
/** @typedef {import("./game.js").Game} Game */

import { lerpAngleShortest } from "./collision_mothership.js";
import { sampleBodyCollisionAt } from "./collision_helpers.js";
import { GAME } from "./config.js";
import { spawnFragmentBurst } from "./fragment_fx.js";
import * as audioState from "./audio.js";
import * as camera from "./camera.js";
import * as collisionDropship from "./collision_dropship.js";
import * as collisionWorld from "./collision_world.js";
import { resolveCollisionResponse } from "./collision_world.js";
import * as flightPhysics from "./flight_physics.js";
import { mothershipCollisionInfo } from "./mothership.js";
import * as stats from "./stats.js";

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
 * Shared normalized geometry for rendered body/skis and the collision convex hull.
 * Render and collision are intentionally related, but not required to match 1:1.
 * @returns {{
 *   cargoBottomN:number,
 *   cargoTopN:number,
 *   bodyBottomHalfWRenderN:number,
 *   bodyTopHalfWRenderN:number,
 *   bodyBottomHalfWConvexN:number,
 *   bodyTopHalfWConvexN:number,
 *   cabinOffsetN:number,
 *   cabinHalfWBaseN:number,
 *   cabinHalfWScale:number,
 *   windowHalfWScale:number,
 *   windowBaseT:number,
 *   windowTipT:number,
 *   skiOffsetRenderN:number,
 *   skiHalfWRenderN:number,
 *   skiTopYRenderN:number,
 *   gunLenH:number,
 *   gunHalfWW:number,
 *   gunMountBackOffsetLen:number,
 *   gunStrutHalfW:number,
 *   gunPivotYInsetN:number,
 *   convexSkiOuterXN:number,
 *   convexSkiYDropN:number,
 * }}
 */
export function getDropshipGeometryProfileN(){
  const { cargoBottomN, cargoTopN } = getDropshipCargoBoundsN();
  const bodyBottomHalfWRenderN = 0.85 * DROPSHIP_MODEL.cargoWidthScale;
  const bodyTopHalfWRenderN = 0.6 * DROPSHIP_MODEL.cargoWidthScale * 0.8;
  const bodyBottomHalfWConvexN = 0.87 * DROPSHIP_MODEL.cargoWidthScale;
  const bodyTopHalfWConvexN = 0.65 * DROPSHIP_MODEL.cargoWidthScale * 0.8;
  return {
    cargoBottomN,
    cargoTopN,
    bodyBottomHalfWRenderN,
    bodyTopHalfWRenderN,
    bodyBottomHalfWConvexN,
    bodyTopHalfWConvexN,
    cabinOffsetN: 0.75 * DROPSHIP_MODEL.cargoWidthScale,
    cabinHalfWBaseN: 0.28 * DROPSHIP_MODEL.cargoWidthScale,
    cabinHalfWScale: 1.3,
    windowHalfWScale: 0.5,
    windowBaseT: 0.25,
    windowTipT: 0.8,
    skiOffsetRenderN: 0.32,
    skiHalfWRenderN: 0.2,
    skiTopYRenderN: cargoBottomN + 0.05,
    gunLenH: 1.05,
    gunHalfWW: 0.09,
    gunMountBackOffsetLen: 0.25,
    gunStrutHalfW: 0.05,
    gunPivotYInsetN: DROPSHIP_MODEL.gunStrutHeightN + DROPSHIP_MODEL.gunLiftN,
    convexSkiOuterXN: bodyBottomHalfWConvexN + 0.18,
    convexSkiYDropN: cargoBottomN - 0.08,
  };
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
    while (lower.length >= 2 && cross(
      /** @type {[number, number]} */ (lower[lower.length - 2]),
      /** @type {[number, number]} */ (lower[lower.length - 1]),
      p
    ) <= 0){
      lower.pop();
    }
    lower.push(p);
  }
  /** @type {Array<[number,number]>} */
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--){
    const p = /** @type {[number, number]} */ (sorted[i]);
    while (upper.length >= 2 && cross(
      /** @type {[number, number]} */ (upper[upper.length - 2]),
      /** @type {[number, number]} */ (upper[upper.length - 1]),
      p
    ) <= 0){
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
export function buildDropshipLocalConvexHullPoints(game){
  const { shipHWorld, shipWWorld } = getDropshipHullSize(game);
  const { bodyLiftN } = DROPSHIP_MODEL;
  const profile = getDropshipGeometryProfileN();
  const bodyLift = shipHWorld * bodyLiftN;
  const cargoBottom = shipHWorld * profile.cargoBottomN - bodyLift;
  const cargoTop = shipHWorld * profile.cargoTopN - bodyLift;
  const bottomHalfW = shipWWorld * profile.bodyBottomHalfWConvexN;
  const topHalfW = shipWWorld * profile.bodyTopHalfWConvexN;
  const xBody = bottomHalfW;
  const xTop = topHalfW;
  const xSki = shipWWorld * profile.convexSkiOuterXN;
  const yTop = cargoTop + bodyLift;
  const yBody = cargoBottom + bodyLift;
  const ySki = shipHWorld * profile.convexSkiYDropN + bodyLift;
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
 * @param {Array<[number, number]>} convexHullPoints
 * @returns {number}
 */
export function computeDropshipConvexHullBoundRadius(convexHullPoints){
  let r2 = 0;
  for (const p of convexHullPoints){
    const x = p[0] || 0;
    const y = p[1] || 0;
    const d2 = x * x + y * y;
    if (d2 > r2) r2 = d2;
  }
  return Math.sqrt(r2);
}

/**
 * Given a unit vector for aim direction and current ship velocity,
 * compute the projectile's launch velocity while preserving muzzle speed.
 * @param {number} dirx
 * @param {number} diry
 * @param {number} vx
 * @param {number} vy
 * @param {number} bulletSpeed
 * @returns {{vx:number, vy:number}}
 */
export function muzzleVelocity(dirx, diry, vx, vy, bulletSpeed){
  const vn = vx * dirx + vy * diry;
  const vt = vx * -diry + vy * dirx;
  let speed = Math.sqrt(Math.max(0, bulletSpeed * bulletSpeed - vt * vt));
  const MIN_LAUNCH_SPEED = 0.5;
  if (speed < MIN_LAUNCH_SPEED){
    vx += dirx * bulletSpeed;
    vy += diry * bulletSpeed;
  } else {
    speed += vn;
    vx = dirx * speed;
    vy = diry * speed;
  }
  return { vx, vy };
}

/**
 * @param {Array<[number, number]>} localConvexHull
 * @param {number} x
 * @param {number} y
 * @returns {Array<[number, number]>}
 */
export function buildDropshipWorldConvexHullVertices(localConvexHull, x, y){
  const camRot = Math.atan2(x, y || 1e-6);
  const shipRot = -camRot;
  const c = Math.cos(shipRot);
  const s = Math.sin(shipRot);
  /** @type {Array<[number, number]>} */
  const out = [];
  for (const p of localConvexHull){
    const lx = p[0];
    const ly = p[1];
    const wx = c * lx - s * ly;
    const wy = s * lx + c * ly;
    out.push([x + wx, y + wy]);
  }
  return out;
}

/**
 * @param {Array<[number, number]>} localConvexHull
 * @param {number} x
 * @param {number} y
 * @param {number} edgeSamplesPerEdge
 * @param {number} maxSampleSpacing
 * @returns {{points:Array<[number, number]>, edgeIdxByPoint:number[], pointMetaByPoint:Array<{kind:"vertex"|"edge",edgeIdx:number,vertexIdx:number,t:number}>}}
 */
export function buildDropshipWorldConvexHullSampleSet(localConvexHull, x, y, edgeSamplesPerEdge = 0, maxSampleSpacing = 0){
  const verts = buildDropshipWorldConvexHullVertices(localConvexHull, x, y);
  if (verts.length < 2){
    return {
      points: verts,
      edgeIdxByPoint: verts.map(() => 0),
      pointMetaByPoint: verts.map((_, i) => ({ kind: "vertex", edgeIdx: i, vertexIdx: i, t: 0 })),
    };
  }
  const edgeSamples = Math.max(0, edgeSamplesPerEdge | 0);
  const spacingLimit = Number.isFinite(maxSampleSpacing)
    ? Math.max(0, Number(maxSampleSpacing))
    : 0;
  if (edgeSamples <= 0 && !(spacingLimit > 0)){
    return {
      points: verts,
      edgeIdxByPoint: verts.map((_, i) => i),
      pointMetaByPoint: verts.map((_, i) => ({ kind: "vertex", edgeIdx: i, vertexIdx: i, t: 0 })),
    };
  }
  /** @type {Array<[number, number]>} */
  const points = [];
  /** @type {number[]} */
  const edgeIdxByPoint = [];
  /** @type {Array<{kind:"vertex"|"edge",edgeIdx:number,vertexIdx:number,t:number}>} */
  const pointMetaByPoint = [];
  const n = verts.length;
  for (let i = 0; i < n; i++){
    const a = /** @type {[number, number]} */ (verts[i]);
    const b = /** @type {[number, number]} */ (verts[(i + 1) % n]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const edgeLen = Math.hypot(dx, dy);
    const spacingSamples = (spacingLimit > 0)
      ? Math.max(0, Math.ceil(edgeLen / spacingLimit) - 1)
      : 0;
    const samplesPerEdge = Math.max(edgeSamples, spacingSamples);
    const segCount = samplesPerEdge + 1;
    for (let s = 0; s < segCount; s++){
      const t = s / segCount;
      points.push([a[0] + dx * t, a[1] + dy * t]);
      edgeIdxByPoint.push(i);
      pointMetaByPoint.push({
        kind: s === 0 ? "vertex" : "edge",
        edgeIdx: i,
        vertexIdx: i,
        t,
      });
    }
  }
  return { points, edgeIdxByPoint, pointMetaByPoint };
}

/**
 * @param {Array<[number, number]>} localConvexHull
 * @param {number} px
 * @param {number} py
 * @param {number} shipX
 * @param {number} shipY
 * @param {number} fallbackRadius
 * @returns {number}
 */
export function pointDistanceToDropshipWorldConvexHull(localConvexHull, px, py, shipX, shipY, fallbackRadius){
  const verts = buildDropshipWorldConvexHullVertices(localConvexHull, shipX, shipY);
  if (verts.length < 2){
    const dx = px - shipX;
    const dy = py - shipY;
    return Math.max(0, Math.hypot(dx, dy) - fallbackRadius);
  }

  /**
   * @param {number} qx
   * @param {number} qy
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @returns {number}
   */
  const distPointToSegment = (qx, qy, ax, ay, bx, by) => {
    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / denom));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    return Math.hypot(qx - cx, qy - cy);
  };

  let best = Infinity;
  for (let i = 0; i < verts.length; i++){
    const a = /** @type {[number, number]} */ (verts[i]);
    const b = /** @type {[number, number]} */ (verts[(i + 1) % verts.length]);
    const d = distPointToSegment(px, py, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }

  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++){
    const vi = /** @type {[number, number]} */ (verts[i]);
    const vj = /** @type {[number, number]} */ (verts[j]);
    const xi = vi[0], yi = vi[1];
    const xj = vj[0], yj = vj[1];
    const intersects = ((yi > py) !== (yj > py))
      && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-6) + xi);
    if (intersects) inside = !inside;
  }
  return inside ? 0 : best;
}

export { buildDropshipLocalConvexHullPoints as buildDropshipLocalHullPoints };

/**
 * @param {{SHIP_SCALE:number}} game
 * @returns {{x:number,y:number}}
 */
export function getDropshipGunPivotLocal(game){
  const { shipHWorld } = getDropshipRenderSize(game);
  const { bodyLiftN } = DROPSHIP_MODEL;
  const { cargoTopN } = getDropshipCargoBoundsN();
  const profile = getDropshipGeometryProfileN();
  return {
    x: 0,
    y: (cargoTopN + profile.gunPivotYInsetN + bodyLiftN) * shipHWorld,
  };
}

/**
 * @param {{SHIP_SCALE:number}} game
 * @returns {number}
 */
export function getDropshipGunTipForwardOffset(game){
  const { shipHWorld } = getDropshipRenderSize(game);
  const profile = getDropshipGeometryProfileN();
  return shipHWorld * profile.gunLenH * (1 - profile.gunMountBackOffsetLen);
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
 * @param {{INERTIAL_DRIVE_THRUST:number,INERTIAL_DRIVE_UPGRADE_FACTOR:number}} game
 * @param {number} inertialDriveLevel
 * @returns {number}
 */
export function getInertialDriveThrust(game, inertialDriveLevel){
  const level = Math.max(0, Math.floor(Number.isFinite(inertialDriveLevel) ? inertialDriveLevel : 0));
  if (level <= 0) return 0;
  return game.INERTIAL_DRIVE_THRUST * (1 + (level - 1) * game.INERTIAL_DRIVE_UPGRADE_FACTOR);
}

/**
 * Apply input-aware momentum correction. No input means no inertial-drive force.
 * @param {{x:number,y:number,vx:number,vy:number}} ship
 * @param {DropshipInput} input
 * @param {number} driveThrust
 * @param {number} reverseFraction
 * @param {number} lateralFraction
 * @param {number} dt
 * @returns {{ax:number,ay:number}}
 */
export function computeDropshipInertialDriveAcceleration(ship, input, driveThrust, reverseFraction, lateralFraction, dt){
  if (!(driveThrust > 0) || !(dt > 0)) return { ax: 0, ay: 0 };
  const { rx, ry, tx, ty } = computeDropshipAxes(ship.x, ship.y);
  const stick = input.stickThrust || { x: 0, y: 0 };
  let dx = 0;
  let dy = 0;
  if (input.left){
    dx += tx;
    dy += ty;
  }
  if (input.right){
    dx -= tx;
    dy -= ty;
  }
  if (input.thrust){
    dx += rx;
    dy += ry;
  }
  if (input.down){
    dx -= rx;
    dy -= ry;
  }
  dx += stick.x * -tx + stick.y * rx;
  dy += stick.x * -ty + stick.y * ry;

  const desiredLen = Math.hypot(dx, dy);
  if (desiredLen <= 1e-6) return { ax: 0, ay: 0 };
  dx /= desiredLen;
  dy /= desiredLen;

  const lx = -dy;
  const ly = dx;
  const vForward = ship.vx * dx + ship.vy * dy;
  const vLateral = ship.vx * lx + ship.vy * ly;
  let ax = 0;
  let ay = 0;

  const reverseCap = driveThrust * Math.max(0, reverseFraction);
  const reverseSpeed = Math.max(0, -vForward);
  if (reverseCap > 0 && reverseSpeed > 1e-6){
    const accel = Math.min(reverseSpeed / dt, reverseCap);
    ax += dx * accel;
    ay += dy * accel;
  }

  const lateralCap = driveThrust * Math.max(0, lateralFraction);
  if (lateralCap > 0 && Math.abs(vLateral) > 1e-6){
    const accel = Math.min(Math.abs(vLateral) / dt, lateralCap);
    const sign = Math.sign(vLateral);
    ax -= lx * sign * accel;
    ay -= ly * sign * accel;
  }

  const accelLen = Math.hypot(ax, ay);
  if (accelLen > driveThrust){
    const scale = driveThrust / accelLen;
    ax *= scale;
    ay *= scale;
  }
  return { ax, ay };
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

/**
 * @param {Game} game
 * @returns {void}
 */
export function resetShip(game){
  const c = Math.cos(game.mothership.angle);
  const s = Math.sin(game.mothership.angle);
  game.ship.x = game.mothership.x + c * GAME.MOTHERSHIP_START_DOCK_X - s * GAME.MOTHERSHIP_START_DOCK_Y;
  game.ship.y = game.mothership.y + s * GAME.MOTHERSHIP_START_DOCK_X + c * GAME.MOTHERSHIP_START_DOCK_Y;
  game.ship.vx = game.mothership.vx;
  game.ship.vy = game.mothership.vy;
  game.ship.state = "landed";
  game.ship.explodeT = 0;
  game.ship.hpCur = game.ship.hpMax;
  game.ship.bombsCur = game.ship.bombsMax;
  game.ship.heat = 0;
  game.ship.invertT = 0;
  game.ship.hitCooldown = 0;
  game.ship.dropshipMiners = 0;
  game.ship.dropshipPilots = 0;
  game.ship.dropshipEngineers = 0;
  game.ship._dock = { lx: GAME.MOTHERSHIP_START_DOCK_X, ly: GAME.MOTHERSHIP_START_DOCK_Y };
  game.ship._collision = null;
  game.ship._samples = null;
  game.ship._landingDebug = null;
  game.debris.length = 0;
  game.fragments.length = 0;
  game.mechanizedLarvae.length = 0;
  game.camera.clearScreenShake();
  game.feedbackState.rumbleWeak = 0;
  game.feedbackState.rumbleStrong = 0;
  game.feedbackState.rumbleUntilMs = 0;
  game.feedbackState.lastRumbleApplyMs = 0;
  game.feedbackState.lastRumbleWeakApplied = 0;
  game.feedbackState.lastRumbleStrongApplied = 0;
  game.feedbackState.lastBrowserVibrateMs = 0;
  game.fallenMiners.length = 0;
  game.playerShots.length = 0;
  game.playerBombs.length = 0;
  game.entityExplosions.length = 0;
  game.popups.length = 0;
  game.shipHitPopups.length = 0;
  game.pickupAnimations.length = 0;
  game.playerShotCooldown = 0;
  game.planet.clearFeatureParticles();
  game.lastAimWorld = null;
  game.lastAimScreen = null;
  game.lastHeat = 0;
  game._shipWasInWater = false;
  game.combatThreatUntilMs = 0;
  audioState.setCombatActive(game, false);
  audioState.setThrustLoopActive(game, false);
  resetShipRenderAngle(game);
  game.camera.snapToScene(camera.cameraScene(game));
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function putShipInLowOrbit(game){
  const orbitState = game.planet.orbitStateFromElements(game.planet.planetRadius + 1, 0, 0, true);
  game.ship.x = orbitState.x;
  game.ship.y = orbitState.y;
  game.ship.vx = orbitState.vx;
  game.ship.vy = orbitState.vy;
  game.ship.state = "flying";
  game.ship._dock = null;
  resetShipRenderAngle(game);
  game.camera.snapToScene(camera.cameraScene(game));
}

/**
 * Reset ship/camera orientation after teleports, respawns, and load.
 * @param {Game} game
 * @returns {void}
 */
export function resetShipRenderAngle(game){
  game.ship.renderAngle = getDropshipWorldRotation(game.ship.x, game.ship.y);
}

/**
 * Damp the singular 180-degree flip at the planet core without adding general camera lag.
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function updateShipRenderAngle(game, dt){
  const target = getDropshipWorldRotation(game.ship.x, game.ship.y);
  const current = Number.isFinite(game.ship.renderAngle) ? /** @type {number} */ (game.ship.renderAngle) : target;
  const delta = lerpAngleShortest(current, target, 1) - current;
  const maxStep = Math.PI * 8 * Math.max(0, dt);
  if (!(maxStep > 0) || Math.abs(delta) <= maxStep){
    game.ship.renderAngle = target;
    return;
  }
  game.ship.renderAngle = lerpAngleShortest(current, target, maxStep / Math.abs(delta));
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").FragmentDestroyedBy} [destroyedBy]
 * @returns {void}
 */
export function triggerCrash(game, destroyedBy = "unknown"){
  if (game.ship.state === "crashed") return;
  game.ship.state = "crashed";
  game.ship.explodeT = 0;
  game.combatThreatUntilMs = 0;
  audioState.setCombatActive(game, false);
  audioState.setThrustLoopActive(game, false);
  audioState.playSfx(game, "ship_crash", { volume: 0.9 });
  game.lastAimWorld = null;
  game.lastAimScreen = null;
  stats.recordDropshipLoss(game, 1);
  const pieces = 10;
  for (let i = 0; i < pieces; i++){
    const ang = Math.random() * Math.PI * 2;
    const sp = 1.5 + Math.random() * 2.5;
    game.debris.push({
      x: game.ship.x + Math.cos(ang) * 0.1,
      y: game.ship.y + Math.sin(ang) * 0.1,
      vx: game.ship.vx + Math.cos(ang) * sp,
      vy: game.ship.vy + Math.sin(ang) * sp,
      a: Math.random() * Math.PI * 2,
      w: (Math.random() - 0.5) * 4,
      life: 2.5 + Math.random() * 1.5,
    });
  }
  stats.registerMinerLoss(game, game.ship.dropshipMiners + game.ship.dropshipPilots + game.ship.dropshipEngineers);
  spawnShipDestructionFragments(game, destroyedBy);
  game.ship.dropshipMiners = 0;
  game.ship.dropshipPilots = 0;
  game.ship.dropshipEngineers = 0;
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {import("./types.d.js").FragmentDestroyedBy} [destroyedBy]
 * @returns {void}
 */
export function damageShip(game, x, y, destroyedBy = "unknown"){
  if (game.ship.state === "crashed") return;
  if (game.ship.hitCooldown > 0) return;
  audioState.markCombatThreat(game);
  audioState.triggerCombatImmediate(game);
  game.ship.hpCur = Math.max(0, game.ship.hpCur - 1);
  game.ship.hitCooldown = GAME.SHIP_HIT_COOLDOWN;
  audioState.playSfx(game, "ship_hit", { volume: 0.8 });
  game.entityExplosions.push({ x, y, life: 0.5, radius: game.SHIP_HIT_BLAST });
  game.shipHitPopups.push({
    x: game.ship.x,
    y: game.ship.y,
    vx: 0,
    vy: 0,
    life: GAME.SHIP_HIT_POPUP_LIFE,
  });
  if (game.ship.hpCur <= 0){
    triggerCrash(game, destroyedBy);
  }
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function updateHostileDamage(game, dt){
  if (game.ship.state === "crashed") return;
  for (let i = game.enemies.shots.length - 1; i >= 0; i--){
    const shot = game.enemies.shots[i];
    if (!shot) continue;
    if (collisionDropship.enemyShotHitsShip(game, shot, dt)){
      game.enemies.shots.splice(i, 1);
      damageShip(game, shot.x, shot.y, "bullet");
    }
  }
  if (!game.enemies.explosions.length) return;
  const shipRadius = collisionDropship.shipRadius(game);
  for (const explosion of game.enemies.explosions){
    if (!explosion) continue;
    const radius = (explosion.radius ?? 1.0) + shipRadius;
    const dx = game.ship.x - explosion.x;
    const dy = game.ship.y - explosion.y;
    if (dx * dx + dy * dy <= radius * radius){
      damageShip(game, explosion.x, explosion.y, "explosion");
      break;
    }
  }
}

/**
 * @param {Game} game
 * @param {DropshipInput} input
 * @returns {void}
 */
export function updateLandedState(game, input){
  if (game.ship.state !== "landed") return;
  if (!wantsDropshipLiftoff(input)) return;
  game.ship.state = "flying";
  game.ship._dock = null;
  game.hasLaunchedPlayerShip = true;
}

/**
 * @param {Game} game
 * @param {{thrust:boolean,stickThrust:{x:number,y:number}}} input
 * @param {any} titleState
 * @param {{aim?:any,aimShoot?:any,aimBomb?:any,lastAimScreen?:any}} [aimState]
 * @returns {{aim:any,aimShoot:any,aimBomb:any}|null}
 */
export function updateDockedMothershipState(game, input, titleState, aimState = {}){
  if (!(game.ship.state === "landed" && game.ship._dock && game.mothership)) return null;
  if (input.thrust || input.stickThrust.y > 0.5){
    const shipRadius = collisionDropship.shipRadius(game);
    const pushStep = shipRadius * 0.35;
    for (let i = 0; i < 8 && collisionDropship.shipCollidesAt(game, game.ship.x, game.ship.y); i++){
      const info = mothershipCollisionInfo(game.mothership, game.ship.x, game.ship.y);
      if (!info) break;
      game.ship.x += info.nx * pushStep;
      game.ship.y += info.ny * pushStep;
    }
    const info = mothershipCollisionInfo(game.mothership, game.ship.x, game.ship.y);
    if (info){
      const lift = shipRadius * 0.25;
      game.ship.x += info.nx * lift;
      game.ship.y += info.ny * lift;
      game.ship.vx += info.nx * 0.05;
      game.ship.vy += info.ny * 0.05;
    }
    game.ship.state = "flying";
    game.ship._dock = null;
    game.hasLaunchedPlayerShip = true;
    if (titleState.newGameHelpPromptArmed){
      titleState.newGameHelpPromptT = game.NEW_GAME_HELP_PROMPT_SECS;
      titleState.newGameHelpPromptArmed = false;
    }
    if (!aimState.aim && !aimState.aimShoot && !aimState.aimBomb && !aimState.lastAimScreen){
      const seededAim = camera.defaultAimScreenFromShip(game, () => collisionDropship.shipGunPivotWorld(game));
      if (seededAim){
        return { aim: seededAim, aimShoot: seededAim, aimBomb: seededAim };
      }
    }
    return null;
  }

  const { lx, ly } = game.ship._dock;
  const c = Math.cos(game.mothership.angle);
  const s = Math.sin(game.mothership.angle);
  game.ship.x = game.mothership.x + c * lx - s * ly;
  game.ship.y = game.mothership.y + s * lx + c * ly;
  game.ship.vx = game.mothership.vx;
  game.ship.vy = game.mothership.vy;
  game.ship._shipRadius = collisionDropship.shipRadius(game);
  game.ship._samples = sampleBodyCollisionAt(
    game.collision,
    (px, py) => collisionDropship.shipCollisionPoints(game, px, py),
    game.ship.x,
    game.ship.y,
    false
  ).samples;
  game.lastAimWorld = null;
  game.lastAimScreen = null;
  return null;
}

/**
 * @param {Game} game
 * @param {{
 *  aim:any,
 *  aimShoot:any,
 *  aimBomb:any,
 *  aimShootFrom:any,
 *  aimShootTo:any,
 *  aimBombFrom:any,
 *  aimBombTo:any,
 * }} aimState
 * @returns {{gunOrigin:{x:number,y:number},aimWorldShoot:any,aimWorldBomb:any,aimWorld:any}}
 */
export function resolveAimState(game, aimState){
  const gunOrigin = collisionDropship.shipGunPivotWorld(game);
  const aimWorldShoot = camera.toWorldFromAim(game, aimState.aimShoot || aimState.aim);
  const aimWorldBomb = camera.toWorldFromAim(game, aimState.aimBomb || aimState.aimShoot || aimState.aim);
  let aimWorld =
    (aimState.aimShootTo && camera.toWorldFromAim(game, aimState.aimShootTo)) ||
    aimWorldShoot ||
    (aimState.aimBombTo && camera.toWorldFromAim(game, aimState.aimBombTo)) ||
    aimWorldBomb;
  if ((aimState.aimShootFrom && aimState.aimShootTo) || (aimState.aimBombFrom && aimState.aimBombTo)){
    const from = aimState.aimShootFrom || aimState.aimBombFrom;
    const to = aimState.aimShootTo || aimState.aimBombTo;
    const worldFrom = from ? camera.toWorldFromAim(game, from) : null;
    const worldTo = to ? camera.toWorldFromAim(game, to) : null;
    if (worldFrom && worldTo){
      const dx = worldTo.x - worldFrom.x;
      const dy = worldTo.y - worldFrom.y;
      const dist = Math.hypot(dx, dy) || 1;
      const aimLen = Math.max(4.0, camera.aimWorldDistance(game, GAME.AIM_SCREEN_RADIUS || 0.25));
      aimWorld = {
        x: gunOrigin.x + (dx / dist) * aimLen,
        y: gunOrigin.y + (dy / dist) * aimLen,
      };
    }
  }
  if (!isDockedWithMothership(game)){
    game.lastAimWorld = aimWorld;
    if (aimState.aim) game.lastAimScreen = aimState.aim;
  }
  return { gunOrigin, aimWorldShoot, aimWorldBomb, aimWorld };
}

/**
 * @param {Game} game
 * @param {number} dt
 * @param {{
 *  left:boolean,
 *  right:boolean,
 *  thrust:boolean,
 *  down:boolean,
 *  stickThrust:{x:number,y:number},
 *  aim:any,
 *  aimShoot:any,
 *  aimBomb:any,
 *  aimShootFrom:any,
 *  aimShootTo:any,
 *  aimBombFrom:any,
 *  aimBombTo:any,
 * }} controls
 * @param {any} titleState
 * @param {{prevPose:{x:number,y:number,angle:number}|null, angularVel:number}} mothershipMotion
 * @returns {{gunOrigin:{x:number,y:number},aimWorldShoot:any,aimWorldBomb:any,aimWorld:any}}
 */
export function updateStep(game, dt, controls, titleState, mothershipMotion){
  const planetCfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  let aim = controls.aim;
  let aimShoot = controls.aimShoot;
  let aimBomb = controls.aimBomb;
  const dockAim = updateDockedMothershipState(
    game,
    { thrust: controls.thrust, stickThrust: controls.stickThrust },
    titleState,
    { aim, aimShoot, aimBomb, lastAimScreen: game.lastAimScreen }
  );
  if (dockAim){
    aim = dockAim.aim;
    aimShoot = dockAim.aimShoot;
    aimBomb = dockAim.aimBomb;
  }
  updateDamageState(game, dt);
  updateFlyingState(
    game,
    dt,
    {
      left: controls.left,
      right: controls.right,
      thrust: controls.thrust,
      down: controls.down,
      stickThrust: controls.stickThrust,
    },
    planetCfg,
    mothershipMotion.prevPose,
    mothershipMotion.angularVel
  );
  finalizePose(game, dt);
  return resolveAimState(game, {
    aim,
    aimShoot,
    aimBomb,
    aimShootFrom: controls.aimShootFrom,
    aimShootTo: controls.aimShootTo,
    aimBombFrom: controls.aimBombFrom,
    aimBombTo: controls.aimBombTo,
  });
}

/**
 * @param {Game} game
 * @param {number} dt
 * @param {DropshipInput} input
 * @param {any} planetCfg
 * @param {{x:number,y:number,angle:number}|null} mothershipPrevPose
 * @param {number} mothershipAngularVel
 * @returns {void}
 */
export function updateFlyingState(game, dt, input, planetCfg, mothershipPrevPose, mothershipAngularVel){
  if (game.ship.state !== "flying") return;

  const { left, right, thrust, down, stickThrust } = input;
  const controls = {
    left: !!left,
    right: !!right,
    thrust: !!thrust,
    down: !!down,
    stickThrust: stickThrust || { x: 0, y: 0 },
  };
  game.ship.cabinSide = resolveDropshipFacing(game.ship.cabinSide || 1, controls);
  audioState.setThrustLoopActive(game, hasDropshipThrustInput(controls));

  const isWaterWorld = !!(planetCfg && planetCfg.id === "water");
  const surfaceShellR = game.planet.getSurfaceShellRadius
    ? game.planet.getSurfaceShellRadius()
    : game.planet.radial.outerSurfaceRadius();
  const thrustMax = game.planetParams.THRUST * (1 + game.ship.thrust * 0.1);
  const inertialDriveThrust = getInertialDriveThrust(GAME, game.ship.inertialDrive);
  const thrustAccel = computeDropshipAcceleration(game.ship, controls, thrustMax);
  let ax = thrustAccel.ax;
  let ay = thrustAccel.ay;
  const inertialDriveAccel = computeDropshipInertialDriveAcceleration(
    game.ship,
    controls,
    inertialDriveThrust,
    GAME.INERTIAL_DRIVE_REVERSE_FRACTION,
    GAME.INERTIAL_DRIVE_LATERAL_FRACTION,
    dt
  );
  ax += inertialDriveAccel.ax;
  ay += inertialDriveAccel.ay;
  const controlAccelX = ax;
  const controlAccelY = ay;
  const thrustInputActive = hasDropshipThrustInput(controls);
  const { rx, ry } = thrustAccel;
  const waterR = isWaterWorld ? Math.max(0, surfaceShellR) : 0;
  const shipInWaterBefore = !!(isWaterWorld && collisionWorld.shipCountsAsSubmergedInWater(game, waterR, game.ship.x, game.ship.y));

  if (isWaterWorld && shipInWaterBefore){
    let buoyancy = Math.max(0, game.planetParams.SURFACE_G * 0.45);
    buoyancy = Math.max(buoyancy, game.planetParams.SURFACE_G * 0.95);
    ax += rx * buoyancy;
    ay += ry * buoyancy;
  }

  const prevShipX = game.ship.x;
  const prevShipY = game.ship.y;
  const { x: gx, y: gy } = game.planet.gravityAt(game.ship.x, game.ship.y);
  game.ship.x += (game.ship.vx + 0.5 * (ax + gx) * dt) * dt;
  game.ship.y += (game.ship.vy + 0.5 * (ay + gy) * dt) * dt;

  const { x: gx2, y: gy2 } = game.planet.gravityAt(game.ship.x, game.ship.y);
  game.ship.vx += (ax + (gx + gx2) / 2) * dt;
  game.ship.vy += (ay + (gy + gy2) / 2) * dt;
  const shipWaterSpeed = Math.hypot(game.ship.vx, game.ship.vy);

  let shipInWaterNow = false;
  if (isWaterWorld){
    const rNow = Math.hypot(game.ship.x, game.ship.y) || 1;
    shipInWaterNow = collisionWorld.shipCountsAsSubmergedInWater(game, waterR, game.ship.x, game.ship.y);
    if (shipInWaterNow && !game._shipWasInWater){
      audioState.playSfx(game, "water_splash", {
        volume: Math.max(0.35, Math.min(0.95, 0.42 + shipWaterSpeed * 0.12)),
        rate: Math.max(0.86, Math.min(1.16, 0.9 + shipWaterSpeed * 0.04)),
      });
    } else if (!shipInWaterNow && game._shipWasInWater){
      audioState.playSfx(game, "water_splash", {
        volume: Math.max(0.3, Math.min(0.8, 0.36 + shipWaterSpeed * 0.1)),
        rate: Math.max(0.9, Math.min(1.22, 1.02 + shipWaterSpeed * 0.03)),
      });
    }
    if (shipInWaterNow){
      const depth = Math.max(0, waterR - rNow);
      const edgeBand = Math.max(0.35, waterR * 0.22);
      const edgeMix = Math.max(0, Math.min(1, 1 - depth / edgeBand));
      const dragK = game.planetParams.DRAG * (4.8 + edgeMix * 5.4);
      const drag = Math.max(0, 1 - dragK * dt);
      game.ship.vx *= drag;
      game.ship.vy *= drag;
      const maxWaterSpeed = Math.max(1.35, thrustMax * 0.55);
      const speed = Math.hypot(game.ship.vx, game.ship.vy);
      if (speed > maxWaterSpeed){
        const scale = maxWaterSpeed / speed;
        game.ship.vx *= scale;
        game.ship.vy *= scale;
      }
      if (!game._shipWasInWater){
        game.ship.vx *= 0.68;
        game.ship.vy *= 0.68;
      }
    }
    game._shipWasInWater = shipInWaterNow;
  } else {
    game._shipWasInWater = false;
  }

  if (!shipInWaterNow){
    const atmosphereDensity = flightPhysics.sampleAtmosphereDensity(
      game.planet,
      game.planetParams,
      surfaceShellR,
      game.ship.x,
      game.ship.y
    );
    if (atmosphereDensity > 0){
      const dragOut = flightPhysics.applyQuadraticVelocityDrag(
        game.ship.vx,
        game.ship.vy,
        game.planetParams.ATMOSPHERE_DRAG * atmosphereDensity,
        dt
      );
      game.ship.vx = dragOut.vx;
      game.ship.vy = dragOut.vy;
    }
  }

  const eps = game.COLLISION_EPS;
  const shipRadius = collisionDropship.shipRadius(game);
  const attemptedShipX = game.ship.x;
  const attemptedShipY = game.ship.y;
  game.ship._debugFlightInput = game.debugState.devHudVisible ? {
    left: controls.left,
    right: controls.right,
    thrust: controls.thrust,
    down: controls.down,
    stickX: controls.stickThrust.x,
    stickY: controls.stickThrust.y,
    accelX: ax,
    accelY: ay,
    gravityX: gx,
    gravityY: gy,
  } : null;
  const travelDist = Math.hypot(attemptedShipX - prevShipX, attemptedShipY - prevShipY);
  const sweepStep = Math.max(0.03, Math.min(0.05, shipRadius * 0.2));
  const sweepMaxSteps = Math.max(18, Math.min(96, Math.ceil(travelDist / sweepStep) + 2));
  game.ship._landingDebug = null;
  let sweptHit = collisionDropship.firstShipCollisionOnSegmentExact(
    game,
    prevShipX,
    prevShipY,
    game.ship.x,
    game.ship.y,
    sweepStep,
    sweepMaxSteps
  );
  if (!sweptHit && game.mothership && mothershipPrevPose){
    const mothershipCurrPose = {
      x: game.mothership.x,
      y: game.mothership.y,
      angle: game.mothership.angle,
    };
    sweptHit = collisionDropship.sweptShipVsMovingMothershipAt(
      game,
      prevShipX,
      prevShipY,
      game.ship.x,
      game.ship.y,
      shipRadius,
      mothershipPrevPose,
      mothershipCurrPose
    );
  }

  let samples;
  let hit;
  let hitSource;
  if (sweptHit){
    game.ship.x = sweptHit.x;
    game.ship.y = sweptHit.y;
    samples = sampleBodyCollisionAt(
      game.collision,
      (px, py) => collisionDropship.shipCollisionPoints(game, px, py),
      game.ship.x,
      game.ship.y,
      false
    ).samples;
    hit = sweptHit.hit;
    hitSource = sweptHit.hitSource;
  } else {
    ({ samples, hit, hitSource } = sampleBodyCollisionAt(
      game.collision,
      (px, py) => collisionDropship.shipCollisionPoints(game, px, py),
      game.ship.x,
      game.ship.y,
      false
    ));
  }
  const collides = !!hit;
  game.ship._samples = samples;
  game.ship._shipRadius = shipRadius;
  if (hit){
    const hitTri = (hitSource === "planet")
      ? (hit.tri || game.planet.radial.findTriAtWorld(hit.x, hit.y))
      : null;
    game.ship._collision = {
      x: hit.x,
      y: hit.y,
      tri: hitTri,
      node: (hitSource === "planet") ? game.planet.radial.nearestNodeOnRing(hit.x, hit.y) : null,
      contacts: Array.isArray(hit.contacts) ? hit.contacts : null,
      ...(hitSource ? { source: hitSource } : {}),
    };
  } else {
    game.ship._collision = null;
  }

  if (!collides) return;
  const prevCollider = collisionDropship.shipConvexHullSampleSet(game, prevShipX, prevShipY);
  const currCollider = collisionDropship.shipConvexHullSampleSet(game, attemptedShipX, attemptedShipY);
  resolveCollisionResponse({
    ship: game.ship,
    collision: game.collision,
    planet: game.planet,
    mothership: game.mothership,
    planetParams: game.planetParams,
    game: GAME,
    dt,
    eps,
    debugEnabled: game.debugState.devHudVisible,
    shipRadius,
    shipCollidesAt: (x, y) => collisionDropship.shipCollidesAt(game, x, y),
    shipCollidesMothershipAt: (x, y) => collisionDropship.shipCollidesWithMothershipAt(game, x, y),
    shipLocalConvexHull: collisionDropship.shipCollisionLocalConvexHull(game),
    shipCollisionPointsAt: (x, y) => collisionDropship.shipCollisionPoints(game, x, y),
    shipStartX: prevShipX,
    shipStartY: prevShipY,
    shipEndX: attemptedShipX,
    shipEndY: attemptedShipY,
    thrustInputActive,
    controlAccelX,
    controlAccelY,
    mothershipAngularVel,
    mothershipPrevPose,
    prevPoints: prevCollider.points,
    currPoints: currCollider.points,
    onCrash: () => triggerCrash(game),
    isDockedWithMothership: () => isDockedWithMothership(game),
    onSuccessfullyDocked: () => onSuccessfullyDocked(game),
  });
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function updateDamageState(game, dt){
  if (game.ship.hitCooldown > 0){
    game.ship.hitCooldown = Math.max(0, game.ship.hitCooldown - dt);
  }
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function finalizePose(game, dt){
  if (game.ship.state !== "crashed" && game.ship._collision && game.ship._collision.source === "planet"){
    collisionDropship.stabilizeShipAgainstPlanetPenetration(game, 10);
  }
  if (game.ship.state !== "flying"){
    audioState.setThrustLoopActive(game, false);
  }
  updateShipRenderAngle(game, dt);
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function updateFeatureContact(game, dt){
  if (game.ship.state === "crashed") return;
  const shipRadius = collisionDropship.shipRadius(game);
  game.planet.handleFeatureContact(game.ship.x, game.ship.y, shipRadius, dt, game.featureCallbacks);
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").FragmentDestroyedBy} destroyedBy
 * @returns {void}
 */
export function spawnShipDestructionFragments(game, destroyedBy){
  const start = game.fragments.length;
  spawnFragmentBurst(game.fragments, game.ship, "dropship", destroyedBy, { pieces: 6 });
  /** @type {[number, number, number]} */
  const shipSilverTop = [0.85, 0.87, 0.9];
  /** @type {[number, number, number]} */
  const shipSilverBottom = [0.55, 0.58, 0.62];
  /** @type {[number, number, number]} */
  const shipWindow = [0.05, 0.05, 0.05];
  const created = game.fragments.slice(start);
  for (let i = 0; i < created.length; i++){
    const frag = created[i];
    if (!frag) continue;
    if (i === 0){
      frag.cr = shipWindow[0];
      frag.cg = shipWindow[1];
      frag.cb = shipWindow[2];
      continue;
    }
    const t = Math.max(0, Math.min(1, (i - 1) / Math.max(1, created.length - 2)));
    frag.cr = shipSilverBottom[0] + (shipSilverTop[0] - shipSilverBottom[0]) * t;
    frag.cg = shipSilverBottom[1] + (shipSilverTop[1] - shipSilverBottom[1]) * t;
    frag.cb = shipSilverBottom[2] + (shipSilverTop[2] - shipSilverBottom[2]) * t;
  }
  /** @type {import("./types.d.js").FragmentOwnerType[]} */
  const cargo = [];
  for (let i = 0; i < game.ship.dropshipMiners; i++) cargo.push("miner");
  for (let i = 0; i < game.ship.dropshipPilots; i++) cargo.push("pilot");
  for (let i = 0; i < game.ship.dropshipEngineers; i++) cargo.push("engineer");
  const cargoCount = cargo.length;
  for (let i = 0; i < cargoCount; i++){
    const cargoType = cargo[i];
    if (!cargoType) continue;
    const ang = (i / Math.max(1, cargoCount)) * Math.PI * 2 + Math.random() * 0.35;
    const radius = 0.18 + Math.random() * 0.12;
    spawnFragmentBurst(game.fragments, {
      x: game.ship.x + Math.cos(ang) * radius,
      y: game.ship.y + Math.sin(ang) * radius,
      vx: game.ship.vx + Math.cos(ang) * (0.45 + Math.random() * 0.5),
      vy: game.ship.vy + Math.sin(ang) * (0.45 + Math.random() * 0.5),
    }, cargoType, destroyedBy, { pieces: 1 });
  }
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function onSuccessfullyDocked(game){
  let y = 0.5;
  const r = Math.hypot(game.ship.x, game.ship.y);
  const upx = game.ship.x / r;
  const upy = game.ship.y / r;
  const hullRestored = Math.max(0, game.ship.hpMax - game.ship.hpCur);
  const bombsRestored = Math.max(0, game.ship.bombsMax - game.ship.bombsCur);
  /** @param {string} msg */
  const addPopup = (msg) => {
    game.popups.push({
      x: game.ship.x + upx * y,
      y: game.ship.y + upy * y,
      vx: game.mothership.vx + upx * GAME.MINER_POPUP_SPEED,
      vy: game.mothership.vy + upy * GAME.MINER_POPUP_SPEED,
      text: msg,
      life: 2.0,
    });
    y += 0.25;
  };
  /**
   * @param {string} name
   * @param {number} count
   * @returns {void}
   */
  const addGroupPopup = (name, count) => {
    if (count <= 0) return;
    addPopup(name + " +" + count);
  };

  addGroupPopup("pilot", game.ship.dropshipPilots);
  addGroupPopup("engineer", game.ship.dropshipEngineers);
  addGroupPopup("miner", game.ship.dropshipMiners);
  addGroupPopup("hull", hullRestored);
  addGroupPopup("bomb", bombsRestored);

  const rescued = game.ship.dropshipMiners + game.ship.dropshipPilots + game.ship.dropshipEngineers;
  stats.recordRescue(game, rescued);
  if (game.hasLaunchedPlayerShip && (rescued > 0 || hullRestored > 0 || bombsRestored > 0)){
    stats.recordDock(game, 1);
  }
  game.ship.mothershipMiners += game.ship.dropshipMiners;
  game.ship.mothershipPilots += game.ship.dropshipPilots;
  game.ship.mothershipEngineers += game.ship.dropshipEngineers;
  game.ship.dropshipMiners = 0;
  game.ship.dropshipPilots = 0;
  game.ship.dropshipEngineers = 0;
  game.ship.hpCur = game.ship.hpMax;
  game.ship.bombsCur = game.ship.bombsMax;
  stats.markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @returns {boolean}
 */
export function isDockedWithMothership(game){
  return game.ship.state === "landed" && game.ship._dock !== null && game.ship._dock.ly > 0.5;
}


