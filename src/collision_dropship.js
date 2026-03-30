// @ts-check
/** @typedef {import("./game.js").Game} Game */

import {
  findCollisionExactAt,
  findFirstCollisionOnSegmentExact,
  findMothershipCollisionExactAtPose,
  findPlanetCollisionExactAt,
  stabilizePlanetPenetration,
} from "./collision_world.js";
import { sweptShipVsMovingMothership } from "./collision_mothership.js";
import { GAME } from "./config.js";
import {
  buildDropshipLocalConvexHullPoints,
  buildDropshipWorldConvexHullSampleSet,
  buildDropshipWorldConvexHullVertices,
  computeDropshipConvexHullBoundRadius,
  getDropshipGunPivotLocal,
  getDropshipWorldRotation,
  pointDistanceToDropshipWorldConvexHull,
} from "./dropship.js";

/**
 * @param {Game} game
 * @param {Array<[number, number]>} localConvexHull
 * @param {number} [edgeSamplesPerEdge]
 * @returns {void}
 */
export function setShipCollisionConvexHull(game, localConvexHull, edgeSamplesPerEdge = 1){
  if (!Array.isArray(localConvexHull) || localConvexHull.length < 3) return;
  /** @type {Array<[number, number]>} */
  const clean = [];
  for (const p of localConvexHull){
    if (!p || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    clean.push([x, y]);
  }
  if (clean.length < 3) return;
  game.shipCollisionLocalConvexHull = clean;
  game.shipCollisionEdgeSamplesPerEdge = Math.max(0, edgeSamplesPerEdge | 0);
  game.shipCollisionConvexHullBoundRadius = computeDropshipConvexHullBoundRadius(clean);
}

/**
 * @param {Game} game
 * @param {Array<[number, number]>} localConvexHull
 * @param {number} [edgeSamplesPerEdge]
 * @returns {void}
 */
export function setShipCollisionHull(game, localConvexHull, edgeSamplesPerEdge = 1){
  setShipCollisionConvexHull(game, localConvexHull, edgeSamplesPerEdge);
}

/**
 * @param {Game} game
 * @returns {Array<[number, number]>}
 */
export function shipCollisionLocalConvexHull(game){
  if (Array.isArray(game.shipCollisionLocalConvexHull) && game.shipCollisionLocalConvexHull.length >= 3){
    return game.shipCollisionLocalConvexHull;
  }
  return buildDropshipLocalConvexHullPoints(GAME);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @returns {Array<[number, number]>}
 */
export function shipConvexHullWorldVertices(game, x, y){
  return buildDropshipWorldConvexHullVertices(shipCollisionLocalConvexHull(game), x, y);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @returns {{points:Array<[number, number]>, edgeIdxByPoint:number[], pointMetaByPoint:Array<{kind:"vertex"|"edge",edgeIdx:number,vertexIdx:number,t:number}>}}
 */
export function shipConvexHullSampleSet(game, x, y){
  return buildDropshipWorldConvexHullSampleSet(
    shipCollisionLocalConvexHull(game),
    x,
    y,
    game.shipCollisionEdgeSamplesPerEdge,
    game.shipCollisionMaxSampleSpacing
  );
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @returns {Array<[number, number]>}
 */
export function shipCollisionPoints(game, x, y){
  return shipConvexHullSampleSet(game, x, y).points;
}

/**
 * @param {Game} game
 * @returns {any}
 */
export function shipCollisionExactCtx(game){
  return {
    planet: game.planet,
    mothership: game.mothership,
    collision: game.collision,
    collisionEps: game.COLLISION_EPS,
    shipRadius: () => shipRadius(game),
    shipLocalConvexHull: () => shipCollisionLocalConvexHull(game),
    shipConvexHullWorldVertices: shipConvexHullWorldVertices.bind(null, game),
  };
}

/**
 * @param {Game} game
 * @param {number} shipX0
 * @param {number} shipY0
 * @param {number} shipX1
 * @param {number} shipY1
 * @param {number} radius
 * @param {{x:number,y:number,angle:number}} mothershipPrev
 * @param {{x:number,y:number,angle:number}} mothershipCurr
 * @returns {{x:number,y:number,hit:any,hitSource:"mothership"}|null}
 */
export function sweptShipVsMovingMothershipAt(game, shipX0, shipY0, shipX1, shipY1, radius, mothershipPrev, mothershipCurr){
  return sweptShipVsMovingMothership(
    shipCollisionExactCtx(game),
    shipX0,
    shipY0,
    shipX1,
    shipY1,
    radius,
    mothershipPrev,
    mothershipCurr
  );
}

/**
 * @param {Game} game
 * @param {number} px
 * @param {number} py
 * @param {number} shipX
 * @param {number} shipY
 * @returns {number}
 */
export function shipConvexHullDistance(game, px, py, shipX, shipY){
  return pointDistanceToDropshipWorldConvexHull(
    shipCollisionLocalConvexHull(game),
    px,
    py,
    shipX,
    shipY,
    shipRadius(game)
  );
}

/**
 * @param {Game} game
 * @param {number} px
 * @param {number} py
 * @param {number} shipX
 * @param {number} shipY
 * @returns {{x:number,y:number}}
 */
export function shipLocalPoint(game, px, py, shipX, shipY){
  const camRot = -(Number.isFinite(game.ship.renderAngle)
    ? /** @type {number} */ (game.ship.renderAngle)
    : getDropshipWorldRotation(shipX, shipY));
  const shipRot = -camRot;
  const c = Math.cos(shipRot);
  const s = Math.sin(shipRot);
  const dx = px - shipX;
  const dy = py - shipY;
  return { x: c * dx + s * dy, y: -s * dx + c * dy };
}

/**
 * @param {Game} game
 * @param {number} lx
 * @param {number} ly
 * @param {number} shipX
 * @param {number} shipY
 * @returns {{x:number,y:number}}
 */
export function shipWorldPoint(game, lx, ly, shipX, shipY){
  const camRot = -(Number.isFinite(game.ship.renderAngle)
    ? /** @type {number} */ (game.ship.renderAngle)
    : getDropshipWorldRotation(shipX, shipY));
  const shipRot = -camRot;
  const c = Math.cos(shipRot);
  const s = Math.sin(shipRot);
  return { x: shipX + c * lx - s * ly, y: shipY + s * lx + c * ly };
}

/**
 * @param {Game} game
 * @returns {number}
 */
export function shipRadius(game){
  if (!(game.shipCollisionConvexHullBoundRadius > 0)){
    game.shipCollisionConvexHullBoundRadius = computeDropshipConvexHullBoundRadius(shipCollisionLocalConvexHull(game));
  }
  return game.shipCollisionConvexHullBoundRadius;
}

/**
 * @param {Game} game
 * @param {{x:number,y:number,vx:number,vy:number}} shot
 * @param {number} dt
 * @returns {boolean}
 */
export function enemyShotHitsShip(game, shot, dt){
  const shotX0 = shot.x - shot.vx * dt;
  const shotY0 = shot.y - shot.vy * dt;
  const shotX1 = shot.x;
  const shotY1 = shot.y;
  const shipX1 = game.ship.x;
  const shipY1 = game.ship.y;
  const shipX0 = shipX1 - game.ship.vx * dt;
  const shipY0 = shipY1 - game.ship.vy * dt;
  const hitPad = 0.02;
  const hullRadius = shipRadius(game) + hitPad;
  const broadR = hullRadius
    + Math.hypot(shot.vx, shot.vy) * dt
    + Math.hypot(game.ship.vx, game.ship.vy) * dt
    + 0.35;
  const dxBroad = shotX1 - shipX1;
  const dyBroad = shotY1 - shipY1;
  if (dxBroad * dxBroad + dyBroad * dyBroad > broadR * broadR){
    return false;
  }

  const shotTravel = Math.hypot(shotX1 - shotX0, shotY1 - shotY0);
  const shipTravel = Math.hypot(shipX1 - shipX0, shipY1 - shipY0);
  const steps = Math.max(2, Math.min(20, Math.ceil((shotTravel + shipTravel) / 0.06) + 1));
  for (let i = 0; i < steps; i++){
    const t = (steps <= 1) ? 1 : (i / (steps - 1));
    const px = shotX0 + (shotX1 - shotX0) * t;
    const py = shotY0 + (shotY1 - shotY0) * t;
    const sx = shipX0 + (shipX1 - shipX0) * t;
    const sy = shipY0 + (shipY1 - shipY0) * t;
    if (shipConvexHullDistance(game, px, py, sx, sy) <= hitPad){
      return true;
    }
  }
  return false;
}

/**
 * @param {Game} game
 * @returns {{x:number,y:number}}
 */
export function shipGunPivotWorld(game){
  const localPivot = getDropshipGunPivotLocal(GAME);
  const camRot = -(Number.isFinite(game.ship.renderAngle)
    ? /** @type {number} */ (game.ship.renderAngle)
    : getDropshipWorldRotation(game.ship.x, game.ship.y));
  const shipRot = -camRot;
  const c = Math.cos(shipRot);
  const s = Math.sin(shipRot);
  const wx = c * localPivot.x - s * localPivot.y;
  const wy = s * localPivot.x + c * localPivot.y;
  return { x: game.ship.x + wx, y: game.ship.y + wy };
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function shipCollidesAt(game, x, y){
  return !!shipCollisionExactAt(game, x, y);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function shipCollidesWithMothershipAt(game, x, y){
  return !!shipMothershipCollisionExactWithPose(game, x, y, game.mothership);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {any} mothershipPose
 * @returns {any}
 */
export function shipMothershipCollisionExactWithPose(game, x, y, mothershipPose){
  return findMothershipCollisionExactAtPose(shipCollisionExactCtx(game), x, y, mothershipPose);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @returns {{hit:any,hitSource:"planet"|"mothership"}|null}
 */
export function shipCollisionExactAt(game, x, y){
  return findCollisionExactAt(shipCollisionExactCtx(game), x, y);
}

/**
 * @param {Game} game
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} stepLen
 * @param {number} maxSteps
 * @returns {{x:number,y:number,hit:any,hitSource:"planet"|"mothership"}|null}
 */
export function firstShipCollisionOnSegmentExact(game, x0, y0, x1, y1, stepLen, maxSteps){
  return findFirstCollisionOnSegmentExact(shipCollisionExactCtx(game), x0, y0, x1, y1, stepLen, maxSteps);
}

/**
 * @param {Game} game
 * @param {number} [maxIters]
 * @returns {void}
 */
export function stabilizeShipAgainstPlanetPenetration(game, maxIters = 12){
  stabilizePlanetPenetration({
    ship: game.ship,
    collision: game.collision,
    planet: game.planet,
    collisionEps: game.COLLISION_EPS,
    shipCollisionPointsAt: (x, y) => shipCollisionPoints(game, x, y),
    shipRadius: () => shipRadius(game),
  }, maxIters);
}


