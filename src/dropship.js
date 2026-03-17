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
    const a = verts[i];
    const b = verts[(i + 1) % n];
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
    const a = verts[i];
    const b = verts[(i + 1) % verts.length];
    const d = distPointToSegment(px, py, a[0], a[1], b[0], b[1]);
    if (d < best) best = d;
  }

  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++){
    const xi = verts[i][0], yi = verts[i][1];
    const xj = verts[j][0], yj = verts[j][1];
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
