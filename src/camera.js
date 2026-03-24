// @ts-check

import { GAME } from "./config.js";
import { getDropshipWorldRotation } from "./dropship.js";
import { lerpAngleShortest } from "./collision_mothership.js";

/** @typedef {import("./types.d.js").Ship} Ship */
/** @typedef {import("./types.d.js").ViewState} ViewState */

/**
 * @typedef {{
 *   ship: Ship,
 *   mothership: {x:number,y:number}|null|undefined,
 *   planetView: boolean,
 *   planetRadius: number,
 *   framedPlanetRadius: number,
 *   coreMeltdownActive: boolean,
 *   coreMeltdownT: number,
 *   coreMeltdownDuration: number,
 *   dockedWithMothership: boolean,
 *   nowMs: number,
 * }} CameraScene
 */

/**
 * @typedef {{
 *   xCenter:number,
 *   yCenter:number,
 *   c:number,
 *   s:number,
 *   sx:number,
 *   sy:number,
 * }} ScreenTransform
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(value, min, max){
  return Math.max(min, Math.min(max, value));
}

/**
 * @param {ViewState} view
 * @returns {ViewState}
 */
function cloneView(view){
  return {
    xCenter: view.xCenter,
    yCenter: view.yCenter,
    radius: view.radius,
    angle: view.angle,
  };
}

/**
 * @param {number} rate
 * @param {number} dt
 * @returns {number}
 */
function expFollow(rate, dt){
  if (!(dt > 0) || !(rate > 0)) return 0;
  return 1 - Math.exp(-rate * dt);
}

export class Camera {
  constructor(){
    /** @type {ViewState} */
    this.view = {
      xCenter: 0,
      yCenter: 0,
      radius: GAME.PLANETSIDE_ZOOM,
      angle: 0,
    };
    /** @type {ViewState} */
    this.targetView = cloneView(this.view);
    /** @type {ViewState} */
    this.baseView = cloneView(this.view);
    /** @type {boolean} */
    this.manualZoomActive = false;
    /** @type {number} */
    this.manualZoomMultiplier = 1;
    /** @type {number} */
    this.screenShakeTrauma = 0;
    /** @type {number} */
    this.screenShakeClock = 0;
    /** @type {boolean} */
    this._needsSnap = true;

    this.positionFollowRate = 52;
    this.radiusFollowRate = 44;
    this.angleFollowRate = 58;
    this.positionSnapDistance = 3.2;
    this.radiusSnapDistance = 2.8;
    this.angleSnapDistance = Math.PI * 0.42;
  }

  /**
   * @returns {number}
   */
  manualZoomMinMultiplier(){
    return 0.35;
  }

  /**
   * @returns {number}
   */
  manualZoomMaxMultiplier(){
    return 4.0;
  }

  /**
   * @returns {number}
   */
  currentZoomMultiplier(){
    if (!this.manualZoomActive) return 1;
    const minMul = this.manualZoomMinMultiplier();
    const maxMul = this.manualZoomMaxMultiplier();
    const raw = Number.isFinite(this.manualZoomMultiplier) ? this.manualZoomMultiplier : 1;
    return clamp(raw, minMul, maxMul);
  }

  /**
   * @returns {void}
   */
  resetManualZoom(){
    this.manualZoomActive = false;
    this.manualZoomMultiplier = 1;
  }

  /**
   * @returns {void}
   */
  clearScreenShake(){
    this.screenShakeTrauma = 0;
    this.screenShakeClock = 0;
  }

  /**
   * @returns {void}
   */
  reset(){
    this.resetManualZoom();
    this.clearScreenShake();
    this._needsSnap = true;
  }

  /**
   * @returns {void}
   */
  snapNextUpdate(){
    this._needsSnap = true;
  }

  /**
   * @param {number} amount
   * @returns {void}
   */
  addScreenShake(amount){
    const add = Math.max(0, amount || 0);
    if (!(add > 0)) return;
    this.screenShakeTrauma = Math.min(1.2, this.screenShakeTrauma + add);
  }

  /**
   * @param {number} delta
   * @param {boolean} allowManualZoom
   * @returns {boolean}
   */
  applyManualZoomDelta(delta, allowManualZoom){
    if (!allowManualZoom) return false;
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-4) return false;
    if (!this.manualZoomActive){
      this.manualZoomActive = true;
    }
    const step = clamp(delta, -6, 6);
    const factor = Math.pow(1.1, step);
    const nextMul = clamp(
      this.manualZoomMultiplier / factor,
      this.manualZoomMinMultiplier(),
      this.manualZoomMaxMultiplier()
    );
    if (Math.abs(nextMul - 1) <= 0.02){
      this.resetManualZoom();
      return true;
    }
    this.manualZoomMultiplier = nextMul;
    return true;
  }

  /**
   * @param {number} dt
   * @param {CameraScene} scene
   * @returns {ViewState}
   */
  update(dt, scene){
    if (dt > 0){
      this.screenShakeClock += dt;
      this.screenShakeTrauma = Math.max(0, this.screenShakeTrauma - dt * 1.7);
    }
    const target = this._composeTargetView(scene);
    this.targetView = cloneView(target);
    // Keep the gameplay camera locked to the resolved simulation pose. The
    // ship already smooths the singular core flip via renderAngle, so adding a
    // second follow pass here reintroduces visible position/radius judder.
    this.baseView = cloneView(target);
    this._needsSnap = false;
    this.view = this._applyScreenShake(this.baseView);
    return this.view;
  }

  /**
   * @param {CameraScene} scene
   * @returns {ViewState}
   */
  autoView(scene){
    return this._computeAutoView(scene);
  }

  /**
   * @param {CameraScene} scene
   * @returns {ViewState}
   */
  snapToScene(scene){
    const target = this._composeTargetView(scene);
    this.targetView = cloneView(target);
    this.baseView = cloneView(target);
    this.view = this._applyScreenShake(this.baseView);
    this._needsSnap = false;
    return this.view;
  }

  /**
   * @param {number} aspect
   * @param {ViewState} [view=this.view]
   * @returns {ScreenTransform}
   */
  screenTransform(aspect, view = this.view){
    const safeAspect = Math.max(1e-6, aspect);
    const scale = 1 / Math.max(1e-6, view.radius);
    return {
      xCenter: view.xCenter,
      yCenter: view.yCenter,
      c: Math.cos(view.angle),
      s: Math.sin(view.angle),
      sx: scale / safeAspect,
      sy: scale,
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {ScreenTransform} t
   * @returns {{x:number,y:number}}
   */
  worldToScreenNorm(x, y, t){
    const dx = x - t.xCenter;
    const dy = y - t.yCenter;
    const rx = t.c * dx - t.s * dy;
    const ry = t.s * dx + t.c * dy;
    return {
      x: rx * t.sx * 0.5 + 0.5,
      y: 0.5 - ry * t.sy * 0.5,
    };
  }

  /**
   * @param {{x:number,y:number}|null|undefined} aim
   * @param {number} width
   * @param {number} height
   * @param {ViewState} [view=this.view]
   * @returns {{x:number,y:number}|null}
   */
  toWorldFromAim(aim, width, height, view = this.view){
    if (!aim) return null;
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    const xN = aim.x * 2 - 1;
    const yN = (1 - aim.y) * 2 - 1;
    const camRot = view.angle;
    const scale = 1 / Math.max(1e-6, view.radius);
    const aspect = w / h;
    const sx = scale / aspect;
    const sy = scale;
    const px = xN / sx;
    const py = yN / sy;
    const c = Math.cos(-camRot);
    const s = Math.sin(-camRot);
    return {
      x: c * px - s * py + view.xCenter,
      y: s * px + c * py + view.yCenter,
    };
  }

  /**
   * @param {number} screenFrac
   * @param {ViewState} [view=this.view]
   * @returns {number}
   */
  aimWorldDistance(screenFrac, view = this.view){
    return 2 * screenFrac * Math.max(1e-4, view.radius);
  }

  /**
   * Seed a stable default reticle ahead of the ship when no pointer/stick aim exists.
   * @param {Ship} ship
   * @param {{x:number,y:number}} gunOrigin
   * @param {number} width
   * @param {number} height
   * @param {ViewState} [view=this.view]
   * @returns {{x:number,y:number}|null}
   */
  defaultAimScreenFromShip(ship, gunOrigin, width, height, view = this.view){
    if (!ship || !gunOrigin) return null;
    const r = Math.hypot(ship.x, ship.y) || 1;
    const upx = ship.x / r;
    const upy = ship.y / r;
    const rightx = upy;
    const righty = -upx;
    const side = ship.cabinSide || 1;
    const dirx = rightx * side;
    const diry = righty * side;
    const aimLen = Math.max(4.0, this.aimWorldDistance(GAME.AIM_SCREEN_RADIUS || 0.25, view));
    const aimWorldX = gunOrigin.x + dirx * aimLen;
    const aimWorldY = gunOrigin.y + diry * aimLen;
    const screen = this.worldToScreenNorm(
      aimWorldX,
      aimWorldY,
      this.screenTransform(Math.max(1, width) / Math.max(1, height), view)
    );
    return {
      x: clamp(screen.x, 0, 1),
      y: clamp(screen.y, 0, 1),
    };
  }

  /**
   * @param {CameraScene} scene
   * @returns {ViewState}
   */
  _computeAutoView(scene){
    if (scene.planetView){
      return {
        xCenter: 0,
        yCenter: 0,
        radius: Math.max(1e-6, scene.planetRadius) * 1.05,
        angle: 0,
      };
    }

    const ship = scene.ship;
    const radiusViewMin = GAME.PLANETSIDE_ZOOM;
    const rShip = Math.max(1e-6, Math.hypot(ship.x, ship.y));
    const rPlanet = Math.max(1e-6, scene.framedPlanetRadius);

    let uTransition = clamp((rShip - rPlanet) / rPlanet, 0, 1);
    uTransition = (3.0 - 2.0 * uTransition) * uTransition * uTransition;
    const rFramedMin = (rShip - radiusViewMin) + (-rPlanet - (rShip - radiusViewMin)) * uTransition;
    const rFramedMax = rShip + radiusViewMin;
    const rViewCenter = (rFramedMin + rFramedMax) / 2;
    const scale = rViewCenter / rShip;
    const shipAngle = Number.isFinite(ship.renderAngle)
      ? Number(ship.renderAngle)
      : getDropshipWorldRotation(ship.x, ship.y);

    /** @type {ViewState} */
    const view = {
      xCenter: scale * ship.x,
      yCenter: scale * ship.y,
      radius: (rFramedMax - rFramedMin) / 2,
      angle: -shipAngle,
    };
    if (scene.mothership){
      const dx = ship.x - scene.mothership.x;
      const dy = ship.y - scene.mothership.y;
      const d = Math.hypot(dx, dy);
      let t = clamp((12 - d) / 8, 0, 1);
      t = (3 - 2 * t) * t * t;
      view.xCenter = view.xCenter * (1 - t) + ship.x * t;
      view.yCenter = view.yCenter * (1 - t) + ship.y * t;
      view.radius = view.radius * (1 - t) + GAME.MOTHERSHIP_ZOOM * t;
    }
    if (scene.coreMeltdownActive && !scene.dockedWithMothership){
      const t = (scene.nowMs || performance.now()) * 0.001;
      const progress = clamp(scene.coreMeltdownT / Math.max(0.001, scene.coreMeltdownDuration), 0, 1);
      const amp = 0.035 + 0.085 * progress;
      view.xCenter += Math.sin(t * 24.7) * amp + Math.sin(t * 41.3) * amp * 0.45;
      view.yCenter += Math.cos(t * 19.9) * amp + Math.cos(t * 37.1) * amp * 0.45;
    }
    return view;
  }

  /**
   * @param {CameraScene} scene
   * @returns {ViewState}
   */
  _composeTargetView(scene){
    const view = this._computeAutoView(scene);
    if (this.manualZoomActive && !scene.planetView){
      const zoomMul = this.currentZoomMultiplier();
      const baseRadius = Math.max(1e-6, view.radius);
      const radiusScaled = baseRadius / zoomMul;
      const ratio = radiusScaled / baseRadius;
      view.xCenter = scene.ship.x + (view.xCenter - scene.ship.x) * ratio;
      view.yCenter = scene.ship.y + (view.yCenter - scene.ship.y) * ratio;
      view.radius = radiusScaled;
    }
    return view;
  }

  /**
   * @param {ViewState} target
   * @returns {boolean}
   */
  _shouldSnapToTarget(target){
    const dx = target.xCenter - this.baseView.xCenter;
    const dy = target.yCenter - this.baseView.yCenter;
    const dist = Math.hypot(dx, dy);
    const radiusDelta = Math.abs(target.radius - this.baseView.radius);
    let angleDelta = (target.angle - this.baseView.angle) % (Math.PI * 2);
    if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
    if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
    if (dist > this.positionSnapDistance) return true;
    if (radiusDelta > this.radiusSnapDistance) return true;
    if (Math.abs(angleDelta) > this.angleSnapDistance) return true;
    if (!Number.isFinite(this.baseView.radius) || this.baseView.radius <= 0) return true;
    return false;
  }

  /**
   * @param {ViewState} target
   * @param {number} dt
   * @returns {void}
   */
  _smoothBaseViewTowardTarget(target, dt){
    const posT = expFollow(this.positionFollowRate, dt);
    const radiusT = expFollow(this.radiusFollowRate, dt);
    const angleT = expFollow(this.angleFollowRate, dt);
    this.baseView.xCenter += (target.xCenter - this.baseView.xCenter) * posT;
    this.baseView.yCenter += (target.yCenter - this.baseView.yCenter) * posT;
    this.baseView.radius += (target.radius - this.baseView.radius) * radiusT;
    this.baseView.angle = lerpAngleShortest(this.baseView.angle, target.angle, angleT);
  }

  /**
   * @param {ViewState} view
   * @returns {ViewState}
   */
  _applyScreenShake(view){
    const shaken = cloneView(view);
    if (this.screenShakeTrauma > 1e-4){
      const t = this.screenShakeClock;
      const trauma = clamp(this.screenShakeTrauma, 0, 1.2);
      const amp = (0.015 + 0.095 * trauma * trauma) * Math.max(0.55, shaken.radius / GAME.PLANETSIDE_ZOOM);
      shaken.xCenter += Math.sin(t * 23.7) * amp + Math.sin(t * 41.9) * amp * 0.42;
      shaken.yCenter += Math.cos(t * 19.3) * amp + Math.cos(t * 36.1) * amp * 0.42;
    }
    return shaken;
  }
}
