// @ts-check

import { GAME } from "./config.js";
import { MapGen } from "./mapgen.js";

/**
 * @typedef {import("./mothership.js").Mothership} Mothership
 * @typedef {Pick<Mothership, "x"|"y"|"vx"|"vy"|"angle"|"points"|"tris"|"triAir"|"renderPoints"|"renderTris"|"bounds"|"spacing"|"rows"|"cols">} JumpdriveMothershipPose
 * @typedef {import("./types.d.js").MapWorld} MapWorld
 * @typedef {import("./types.d.js").RenderState} RenderState
 * @typedef {import("./types.d.js").ViewState} ViewState
 */

const PHASE_ALIGN = "align";
const PHASE_JUMPDRIVE = "jumpdrive";
const PHASE_WAIT_APPLY = "waitApply";
const PHASE_REVEAL = "reveal";
const PHASE_FOCUS = "focus";

/**
 * @param {number} x
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(x, min, max){
  return Math.max(min, Math.min(max, x));
}

/**
 * @param {number} t
 * @returns {number}
 */
function clamp01(t){
  return Math.max(0, Math.min(1, t));
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerp(a, b, t){
  return a + (b - a) * t;
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerpAngleShortest(a, b, t){
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

/**
 * @param {number} from
 * @param {number} to
 * @returns {number}
 */
function shortestAngleDelta(from, to){
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/**
 * @param {number} t
 * @returns {number}
 */
function easeOutCubic(t){
  const u = 1 - clamp01(t);
  return 1 - u * u * u;
}

/**
 * @param {number} t
 * @returns {number}
 */
function easeInOutCubic(t){
  const u = clamp01(t);
  return (u < 0.5)
    ? (4 * u * u * u)
    : (1 - Math.pow(-2 * u + 2, 3) * 0.5);
}

/**
 * @param {number} angle
 * @returns {{x:number,y:number}}
 */
function angleVec(angle){
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/**
 * @param {ViewState} view
 * @param {number} w
 * @param {number} h
 * @param {number} x
 * @param {number} y
 * @returns {{x:number,y:number}}
 */
function worldToScreenPx(view, w, h, x, y){
  const s = 1 / Math.max(1e-6, view.radius);
  let sx;
  let sy;
  if (w > h){
    sy = s;
    sx = s * h / Math.max(1, w);
  } else {
    sx = s;
    sy = s * w / Math.max(1, h);
  }
  const dx = x - view.xCenter;
  const dy = y - view.yCenter;
  const c = Math.cos(view.angle);
  const s2 = Math.sin(view.angle);
  const rx = c * dx - s2 * dy;
  const ry = s2 * dx + c * dy;
  return {
    x: (rx * sx * 0.5 + 0.5) * w,
    y: (0.5 - ry * sy * 0.5) * h,
  };
}

/**
 * @param {number} worldAngle
 * @param {number} viewAngle
 * @returns {{x:number,y:number}}
 */
function screenDirFromWorldAngle(worldAngle, viewAngle){
  const ang = worldAngle + viewAngle;
  return { x: Math.cos(ang), y: -Math.sin(ang) };
}

/**
 * @param {JumpdriveMothershipPose|null|undefined} mothership
 * @returns {{x:number,y:number}}
 */
function mothershipSternLocalCenter(mothership){
  const points = mothership && (mothership.renderPoints || mothership.points);
  if (!points || !points.length){
    return { x: 0, y: 0 };
  }
  let minX = Number.POSITIVE_INFINITY;
  for (const p of points){
    if (p.x < minX) minX = p.x;
  }
  const eps = Math.max(0.02, (mothership && mothership.spacing ? mothership.spacing : 0.4) * 0.45);
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const p of points){
    if (p.x <= minX + eps){
      sumX += p.x;
      sumY += p.y;
      count++;
    }
  }
  if (!count){
    return { x: minX, y: 0 };
  }
  return {
    x: sumX / count,
    y: sumY / count,
  };
}

/**
 * @param {JumpdriveMothershipPose|null|undefined} mothership
 * @returns {{x:number,y:number}}
 */
function mothershipSternWorld(mothership){
  if (!mothership){
    return { x: 0, y: 0 };
  }
  const stern = mothershipSternLocalCenter(mothership);
  const c = Math.cos(mothership.angle);
  const s = Math.sin(mothership.angle);
  return {
    x: mothership.x + c * stern.x - s * stern.y,
    y: mothership.y + s * stern.x + c * stern.y,
  };
}

/**
 * @param {JumpdriveMothershipPose|null|undefined} mothership
 * @returns {JumpdriveMothershipPose|null}
 */
function cloneMothershipPose(mothership){
  if (!mothership) return null;
  return {
    x: mothership.x,
    y: mothership.y,
    vx: mothership.vx,
    vy: mothership.vy,
    angle: mothership.angle,
    points: mothership.points,
    tris: mothership.tris,
    triAir: mothership.triAir,
    renderPoints: mothership.renderPoints,
    renderTris: mothership.renderTris,
    bounds: mothership.bounds,
    spacing: mothership.spacing,
    rows: mothership.rows,
    cols: mothership.cols,
  };
}

/**
 * @param {RenderState} state
 * @returns {RenderState}
 */
function cloneRenderState(state){
  return {
    ...state,
    ship: { ...state.ship },
  };
}

/**
 * @param {any} ship
 * @param {Pick<JumpdriveMothershipPose, "x"|"y"|"vx"|"vy"|"angle">|null|undefined} mothership
 * @returns {any}
 */
function shipDockPoseForMothership(ship, mothership){
  if (!ship || !mothership){
    return ship ? { ...ship, explodeT: 0 } : ship;
  }
  const dock = ship._dock || { lx: GAME.MOTHERSHIP_START_DOCK_X, ly: GAME.MOTHERSHIP_START_DOCK_Y };
  const c = Math.cos(mothership.angle);
  const s = Math.sin(mothership.angle);
  return {
    ...ship,
    x: mothership.x + c * dock.lx - s * dock.ly,
    y: mothership.y + s * dock.lx + c * dock.ly,
    vx: mothership.vx,
    vy: mothership.vy,
    state: "landed",
    explodeT: 0,
    _dock: { lx: dock.lx, ly: dock.ly },
    renderAngle: mothership.angle + Math.PI,
  };
}

export class JumpdriveTransition {
  constructor(){
    this.cfg = GAME.JUMPDRIVE;
    this.active = false;
    this.phase = PHASE_ALIGN;
    this.phaseTime = 0;
    this.phaseDuration = 0;
    this.totalTime = 0;
    this.startView = null;
    this.stoppedView = null;
    this.revealStartView = null;
    this.revealEndView = null;
    this.revealView = null;
    this.focusStartView = null;
    this.focusEndView = null;
    /** @type {JumpdriveMothershipPose|null} */
    this.startMothership = null;
    /** @type {JumpdriveMothershipPose|null} */
    this.visualMothership = null;
    /** @type {JumpdriveMothershipPose|null} */
    this.finalMothership = null;
    this.hiddenShip = null;
    this.seed = 0;
    this.level = 0;
    this.planetConfig = null;
    this.planetParams = null;
    this.mapWorld = null;
    this.worker = null;
    this.workerRequestId = 0;
    this.pendingPreparedLevel = null;
    this.awaitingApply = false;
    this.loadFailed = false;
    this.loadError = "";
    this.launchCamAngle = 0;
    this.launchWorldAngle = 0;
    this.startCamAngularVel = 0;
    this.currentPlanetRadius = 0;
    this.starSeed = Math.random() * 1000;
  }

  /**
   * @returns {boolean}
   */
  isActive(){
    return this.active;
  }

  /**
   * @returns {void}
   */
  cancel(){
    this.active = false;
    this.phase = PHASE_ALIGN;
    this.phaseTime = 0;
    this.phaseDuration = 0;
    this.totalTime = 0;
    this.startView = null;
    this.stoppedView = null;
    this.revealStartView = null;
    this.revealEndView = null;
    this.revealView = null;
    this.focusStartView = null;
    this.focusEndView = null;
    this.startMothership = null;
    this.visualMothership = null;
    this.finalMothership = null;
    this.hiddenShip = null;
    this.mapWorld = null;
    this.pendingPreparedLevel = null;
    this.awaitingApply = false;
    this.loadFailed = false;
    this.loadError = "";
  }

  /**
   * @param {{seed:number, level:number, planetConfig:import("./planet_config.js").PlanetConfig, planetParams:import("./planet_config.js").PlanetParams, view:ViewState, mothership:Mothership|null|undefined, ship:any, currentPlanetRadius:number, mapWorld?:MapWorld|null}} opts
   * @returns {void}
   */
  start(opts){
    this.cancel();
    this.active = true;
    this.phase = PHASE_ALIGN;
    this.phaseTime = 0;
    this.phaseDuration = Math.max(0.05, this.cfg.alignDuration || 0.5);
    this.totalTime = 0;
    this.seed = opts.seed;
    this.level = opts.level;
    this.planetConfig = opts.planetConfig;
    this.planetParams = opts.planetParams;
    this.startView = { ...opts.view };
    this.currentPlanetRadius = opts.currentPlanetRadius || 0;
    this.startMothership = cloneMothershipPose(opts.mothership);
    this.visualMothership = cloneMothershipPose(opts.mothership);
    const mothership = opts.mothership;
    this.hiddenShip = shipDockPoseForMothership({
      ...opts.ship,
      _dock: (opts.ship && opts.ship._dock) ? opts.ship._dock : { lx: GAME.MOTHERSHIP_START_DOCK_X, ly: GAME.MOTHERSHIP_START_DOCK_Y },
    }, mothership);
    if (mothership){
      const r2 = mothership.x * mothership.x + mothership.y * mothership.y;
      this.startCamAngularVel = (r2 > 1e-6)
        ? ((mothership.x * mothership.vy - mothership.y * mothership.vx) / r2)
        : 0;
    } else {
      this.startCamAngularVel = 0;
    }
    const stopOffset = this.startCamAngularVel * this.phaseDuration * 0.5;
    this.launchCamAngle = this.startView.angle + stopOffset;
    const launchTiltDeg = Number.isFinite(this.cfg.launchTiltDeg) ? this.cfg.launchTiltDeg : 38;
    const launchTilt = clamp(launchTiltDeg, -85, 85) * (Math.PI / 180);
    if (mothership){
      const currentAngle = mothership.angle;
      const outwardAngle = Math.atan2(mothership.y, mothership.x);
      const outwardDelta = shortestAngleDelta(currentAngle, outwardAngle);
      const turn = clamp(outwardDelta, -Math.abs(launchTilt), Math.abs(launchTilt));
      this.launchWorldAngle = currentAngle + turn;
    } else {
      this.launchWorldAngle = (Math.PI * 0.5 - this.launchCamAngle) - launchTilt;
    }
    if (opts.mapWorld){
      this.mapWorld = opts.mapWorld;
      this.pendingPreparedLevel = {
        seed: this.seed,
        level: this.level,
        planetConfig: this.planetConfig,
        planetParams: this.planetParams,
        mapWorld: opts.mapWorld,
      };
    } else {
      this._requestMapWorld();
    }
  }

  /**
   * @returns {void}
   */
  _requestMapWorld(){
    const requestId = ++this.workerRequestId;
    const finishPrepared = (mapWorld) => {
      if (!this.active || requestId !== this.workerRequestId) return;
      this.mapWorld = mapWorld;
      this.pendingPreparedLevel = {
        seed: this.seed,
        level: this.level,
        planetConfig: this.planetConfig,
        planetParams: this.planetParams,
        mapWorld,
      };
    };
    const failPrepared = (error) => {
      if (!this.active || requestId !== this.workerRequestId) return;
      this.loadFailed = true;
      this.loadError = error || "";
      const mapgen = new MapGen(this.seed, this.planetParams);
      const world = mapgen.getWorld();
      finishPrepared({
        seed: world.seed,
        air: world.air,
        entrances: world.entrances,
        finalAir: world.finalAir,
      });
    };

    if (typeof Worker !== "undefined"){
      try {
        if (!this.worker){
          this.worker = new Worker(new URL("./workers/jumpdrive_level_worker.js", import.meta.url), { type: "module" });
        }
        const worker = this.worker;
        const onMessage = (event) => {
          const data = event && event.data ? event.data : null;
          if (!data || (data.requestId | 0) !== requestId) return;
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          if (!data.ok){
            failPrepared(data.error || "worker_failed");
            return;
          }
          finishPrepared(data.mapWorld);
        };
        const onError = () => {
          worker.removeEventListener("message", onMessage);
          worker.removeEventListener("error", onError);
          failPrepared("worker_error");
        };
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.postMessage({
          requestId,
          seed: this.seed,
          planetParams: this.planetParams,
        });
        return;
      } catch (err) {
        failPrepared(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    failPrepared("worker_unavailable");
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  update(dt){
    if (!this.active) return;
    const safeDt = Math.max(0, dt);
    this.totalTime += safeDt;
    this.phaseTime += safeDt;
    if (this.phase === PHASE_ALIGN){
      this._updateAlign();
      if (this.phaseTime >= this.phaseDuration){
        this.phase = PHASE_JUMPDRIVE;
        this.phaseTime = 0;
        this.phaseDuration = Math.max(0.1, this.cfg.jumpdriveMinDuration || 1.0);
      }
      return;
    }
    if (this.phase === PHASE_JUMPDRIVE){
      this._updateJumpdrive();
      if (this.phaseTime >= this.phaseDuration && this.pendingPreparedLevel){
        this.phase = PHASE_WAIT_APPLY;
        this.awaitingApply = true;
      }
      return;
    }
    if (this.phase === PHASE_REVEAL){
      this._updateReveal();
      if (this.phaseTime >= this.phaseDuration){
        this.revealView = this.revealEndView ? { ...this.revealEndView } : this.revealView;
        this.focusStartView = this.revealEndView
          ? { ...this.revealEndView }
          : (this.revealView ? { ...this.revealView } : this.focusStartView);
        this.phase = PHASE_FOCUS;
        this.phaseTime = 0;
        this.phaseDuration = Math.max(0.05, this.cfg.focusDuration || 0.65);
      }
      return;
    }
    if (this.phase === PHASE_FOCUS){
      if (this.phaseTime >= this.phaseDuration){
        this.cancel();
      }
    }
  }

  /**
   * @returns {void}
   */
  _updateAlign(){
    if (!this.startView || !this.startMothership || !this.visualMothership) return;
    const u = clamp01(this.phaseTime / Math.max(1e-6, this.phaseDuration));
    const eased = easeOutCubic(u);
    const angleOffset = this.startCamAngularVel * this.phaseDuration * (u - 0.5 * u * u);
    const camAngle = this.startView.angle + angleOffset;
    const zoomMul = lerp(1, this.cfg.alignZoomMultiplier || 1.12, eased);
    this.stoppedView = {
      xCenter: this.startMothership.x,
      yCenter: this.startMothership.y,
      radius: this.startView.radius * zoomMul,
      angle: camAngle,
    };
    this.visualMothership.x = this.startMothership.x;
    this.visualMothership.y = this.startMothership.y;
    this.visualMothership.angle = lerpAngleShortest(this.startMothership.angle, this.launchWorldAngle, eased);
  }

  /**
   * @returns {void}
   */
  _updateJumpdrive(){
    if (!this.startMothership || !this.visualMothership || !this.stoppedView) return;
    const minDuration = Math.max(0.1, this.cfg.jumpdriveMinDuration || 1.0);
    const u = clamp01(this.phaseTime / minDuration);
    const travel = easeOutCubic(u);
    const launchDir = angleVec(this.launchWorldAngle);
    const launchDistance = Math.max(
      this.startView ? this.startView.radius * (this.cfg.launchDistanceMultiplier || 3.2) : 10,
      (this.currentPlanetRadius || 0) * 1.6
    );
    const mx = this.startMothership.x + launchDir.x * launchDistance * travel;
    const my = this.startMothership.y + launchDir.y * launchDistance * travel;
    this.visualMothership.x = mx;
    this.visualMothership.y = my;
    this.visualMothership.angle = this.launchWorldAngle;
    this.visualMothership.vx = launchDir.x;
    this.visualMothership.vy = launchDir.y;
  }

  /**
   * @returns {void}
   */
  _updateReveal(){
    if (!this.revealView || !this.visualMothership || !this.finalMothership) return;
    const u = clamp01(this.phaseTime / Math.max(1e-6, this.phaseDuration));
    const eased = easeInOutCubic(u);
    const startPose = this.arrivalStartPose;
    if (!startPose) return;
    this.visualMothership.x = lerp(startPose.x, this.finalMothership.x, eased);
    this.visualMothership.y = lerp(startPose.y, this.finalMothership.y, eased);
    this.visualMothership.angle = lerpAngleShortest(startPose.angle, this.finalMothership.angle, eased);
  }

  /**
   * @returns {null|{seed:number,level:number,planetConfig:any,planetParams:any,mapWorld:MapWorld}}
   */
  consumePreparedLevel(){
    if (!this.awaitingApply || !this.pendingPreparedLevel) return null;
    this.awaitingApply = false;
    return this.pendingPreparedLevel;
  }

  /**
   * @param {{mothership:Mothership|null|undefined, view:ViewState}} applied
   * @returns {void}
   */
  applyPreparedLevel(applied){
    const finalMothership = cloneMothershipPose(applied.mothership);
    if (!this.active || !finalMothership) return;
    this.finalMothership = finalMothership;
    this.visualMothership = cloneMothershipPose(finalMothership);
    const revealAngle = applied.view.angle;
    const revealRadius = Math.max(
      applied.view.radius * (this.cfg.revealZoomMultiplier || 1.85),
      (this.planetParams && this.planetParams.RMAX ? this.planetParams.RMAX : 0) * 1.5
    );
    const revealStartRadius = Math.max(
      applied.view.radius * (this.cfg.revealStartZoomMultiplier || ((this.cfg.revealZoomMultiplier || 1.85) * 1.9)),
      revealRadius * 1.35
    );
    this.revealStartView = {
      xCenter: 0,
      yCenter: 0,
      radius: revealStartRadius,
      angle: revealAngle,
    };
    this.revealEndView = {
      xCenter: 0,
      yCenter: 0,
      radius: revealRadius,
      angle: revealAngle,
    };
    this.revealView = { ...this.revealStartView };
    this.focusStartView = { ...this.revealEndView };
    this.focusEndView = { ...applied.view };
    const up = angleVec(Math.PI * 0.5 - revealAngle);
    const side = { x: -up.y, y: up.x };
    const orbitRadius = Math.hypot(finalMothership.x, finalMothership.y);
    const arriveOffset = orbitRadius * (this.cfg.arrivalOffsetMultiplier || 1.9);
    const lateralOffset = orbitRadius * (this.cfg.arrivalLateralMultiplier || 0.42);
    this.arrivalStartPose = {
      x: finalMothership.x + up.x * arriveOffset + side.x * lateralOffset,
      y: finalMothership.y + up.y * arriveOffset + side.y * lateralOffset,
      angle: this.launchWorldAngle,
    };
    this.phase = PHASE_REVEAL;
    this.phaseTime = 0;
    this.phaseDuration = Math.max(0.05, this.cfg.revealDuration || 0.85);
  }

  /**
   * @param {RenderState} state
   * @returns {RenderState}
   */
  decorateRenderState(state){
    if (!this.active) return state;
    const nextState = cloneRenderState(state);
    nextState.showGameplayIndicators = false;
    nextState.touchUi = null;
    nextState.touchStart = false;
    nextState.touchStartMode = null;
    nextState.aimWorld = null;
    nextState.aimOrigin = null;
    nextState.ship = shipDockPoseForMothership(
      this.hiddenShip || nextState.ship,
      this.visualMothership || nextState.mothership || null
    );
    const view = this._currentView(state.view);
    nextState.view = view;
    if (this.visualMothership){
      nextState.mothership = /** @type {RenderState["mothership"]} */ ({ ...this.visualMothership });
    }
    return nextState;
  }

  /**
   * @param {ViewState} fallback
   * @returns {ViewState}
   */
  _currentView(fallback){
    if (!this.active) return fallback;
    if (this.phase === PHASE_ALIGN || this.phase === PHASE_JUMPDRIVE || this.phase === PHASE_WAIT_APPLY){
      if (!this.stoppedView) return fallback;
      const base = { ...this.stoppedView };
      if (this.phase !== PHASE_ALIGN){
        base.radius = this.stoppedView.radius * (this.cfg.jumpdriveZoomMultiplier || 1.45);
        if (this.visualMothership){
          base.xCenter = this.visualMothership.x;
          base.yCenter = this.visualMothership.y;
        }
      }
      return base;
    }
    if (this.phase === PHASE_REVEAL){
      if (this.revealStartView && this.revealEndView){
        const u = clamp01(this.phaseTime / Math.max(1e-6, this.phaseDuration));
        const eased = easeInOutCubic(u);
        const view = {
          xCenter: lerp(this.revealStartView.xCenter, this.revealEndView.xCenter, eased),
          yCenter: lerp(this.revealStartView.yCenter, this.revealEndView.yCenter, eased),
          radius: lerp(this.revealStartView.radius, this.revealEndView.radius, eased),
          angle: lerpAngleShortest(this.revealStartView.angle, this.revealEndView.angle, eased),
        };
        this.revealView = view;
        return view;
      }
      return this.revealView ? { ...this.revealView } : fallback;
    }
    if (this.phase === PHASE_FOCUS && this.focusStartView && this.focusEndView){
      const u = clamp01(this.phaseTime / Math.max(1e-6, this.phaseDuration));
      const eased = easeInOutCubic(u);
      return {
        xCenter: lerp(this.focusStartView.xCenter, this.focusEndView.xCenter, eased),
        yCenter: lerp(this.focusStartView.yCenter, this.focusEndView.yCenter, eased),
        radius: lerp(this.focusStartView.radius, this.focusEndView.radius, eased),
        angle: lerpAngleShortest(this.focusStartView.angle, this.focusEndView.angle, eased),
      };
    }
    return fallback;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   * @param {number} dpr
   * @param {RenderState|null|undefined} renderState
   * @returns {boolean}
   */
  drawOverlay(ctx, w, h, dpr, renderState){
    if (!this.active || !renderState) return false;
    const view = renderState.view;
    const phaseStrength =
      (this.phase === PHASE_ALIGN) ? clamp01(this.phaseTime / Math.max(1e-6, this.phaseDuration)) * 0.35 :
      (this.phase === PHASE_JUMPDRIVE || this.phase === PHASE_WAIT_APPLY) ? 1 :
      (this.phase === PHASE_REVEAL) ? (1 - easeInOutCubic(clamp01(this.phaseTime / Math.max(1e-6, this.phaseDuration)))) :
      0.12;
    if (phaseStrength > 0){
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgba(8, 18, 34, ${0.18 + phaseStrength * 0.32})`);
      grad.addColorStop(0.55, `rgba(4, 10, 26, ${0.28 + phaseStrength * 0.28})`);
      grad.addColorStop(1, `rgba(0, 0, 0, ${0.45 + phaseStrength * 0.2})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
      this._drawStarStreaks(ctx, w, h, dpr, phaseStrength);
    }
    this._drawMothershipThrusters(ctx, w, h, dpr, view);
    if ((this.phase === PHASE_JUMPDRIVE || this.phase === PHASE_WAIT_APPLY) && !this.pendingPreparedLevel){
      this._drawLoadingText(ctx, w, h, dpr);
    }
    return true;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   * @param {number} dpr
   * @param {number} strength
   * @returns {void}
   */
  _drawStarStreaks(ctx, w, h, dpr, strength){
    const count = Math.max(24, (this.cfg.streakCount || 84) | 0);
    const speed = (this.phase === PHASE_REVEAL) ? 0.22 : 1.0;
    const t = this.totalTime * (0.85 + strength * 2.8) + this.starSeed;
    const view = this._currentView({
      xCenter: 0,
      yCenter: 0,
      radius: 1,
      angle: this.launchCamAngle,
    });
    const dir0 = screenDirFromWorldAngle(this.launchWorldAngle, view.angle);
    const dirLen = Math.hypot(dir0.x, dir0.y) || 1;
    const dir = { x: dir0.x / dirLen, y: dir0.y / dirLen };
    const side = { x: -dir.y, y: dir.x };
    const span = Math.hypot(w, h);
    const travelSpan = span * 2.2;
    for (let i = 0; i < count; i++){
      const seed = i * 12.9898 + this.starSeed * 31.7;
      const depth = 0.2 + fract(Math.sin(seed * 2.371) * 9631.417);
      const speedMul = speed * (0.35 + depth * 1.2);
      const lane = (fract(Math.sin(seed * 1.123) * 43758.5453) * 2 - 1) * span;
      const along = (fract(Math.sin(seed * 4.711) * 28541.94 + t * speedMul) * 2 - 0.5) * travelSpan;
      const headX = w * 0.5 + side.x * lane + dir.x * along;
      const headY = h * 0.5 + side.y * lane + dir.y * along;
      const len = (6 + strength * 70) * depth * dpr;
      const tailX = headX - dir.x * len;
      const tailY = headY - dir.y * len;
      const alpha = clamp01(0.15 + strength * 0.9) * (0.45 + depth * 0.5);
      ctx.strokeStyle = `rgba(${Math.round(180 + depth * 70)}, ${Math.round(215 + depth * 30)}, 255, ${alpha})`;
      ctx.lineWidth = Math.max(1, (0.8 + strength * 1.8) * depth * dpr);
      ctx.beginPath();
      ctx.moveTo(headX, headY);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   * @param {number} dpr
   * @param {ViewState} view
   * @returns {void}
   */
  _drawMothershipThrusters(ctx, w, h, dpr, view){
    if (!this.visualMothership) return;
    const sternWorld = mothershipSternWorld(this.visualMothership);
    const stern = worldToScreenPx(view, w, h, sternWorld.x, sternWorld.y);
    const forward = screenDirFromWorldAngle(this.visualMothership.angle, view.angle);
    const back = { x: -forward.x, y: -forward.y };
    const right = { x: -back.y, y: back.x };
    const phaseBoost =
      (this.phase === PHASE_ALIGN) ? 0.35 + 0.65 * easeOutCubic(clamp01(this.phaseTime / Math.max(1e-6, this.phaseDuration))) :
      (this.phase === PHASE_JUMPDRIVE || this.phase === PHASE_WAIT_APPLY) ? 1 :
      (this.phase === PHASE_REVEAL) ? (0.9 - 0.35 * easeInOutCubic(clamp01(this.phaseTime / Math.max(1e-6, this.phaseDuration)))) :
      0.15;
    const plumeScale = Math.max(0.1, Number.isFinite(this.cfg.plumeScale) ? this.cfg.plumeScale : 1);
    const coreLen = (24 + 52 * phaseBoost) * dpr * plumeScale;
    const coreSpread = (8 + 14 * phaseBoost) * dpr * plumeScale;
    const baseOffset = 8 * dpr * plumeScale;
    const jitter = 0.88 + 0.22 * Math.sin(this.totalTime * 34);
    const baseX = stern.x + back.x * baseOffset;
    const baseY = stern.y + back.y * baseOffset;
    const leftX = baseX + right.x * coreSpread;
    const leftY = baseY + right.y * coreSpread;
    const rightX = baseX - right.x * coreSpread;
    const rightY = baseY - right.y * coreSpread;
    const tipX = stern.x + back.x * (baseOffset + coreLen * jitter);
    const tipY = stern.y + back.y * (baseOffset + coreLen * jitter);

    ctx.save();
    const outer = ctx.createLinearGradient(baseX, baseY, tipX, tipY);
    outer.addColorStop(0, "rgba(255, 220, 120, 0.28)");
    outer.addColorStop(1, "rgba(120, 220, 255, 0)");
    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.moveTo(leftX, leftY);
    ctx.lineTo(rightX, rightY);
    ctx.lineTo(tipX, tipY);
    ctx.closePath();
    ctx.fill();

    const innerSpread = coreSpread * 0.42;
    const innerBaseX = stern.x + back.x * (baseOffset * 0.62);
    const innerBaseY = stern.y + back.y * (baseOffset * 0.62);
    const innerTipX = stern.x + back.x * (baseOffset + coreLen * 0.7 * jitter);
    const innerTipY = stern.y + back.y * (baseOffset + coreLen * 0.7 * jitter);
    ctx.fillStyle = "rgba(255, 248, 210, 0.78)";
    ctx.beginPath();
    ctx.moveTo(innerBaseX + right.x * innerSpread, innerBaseY + right.y * innerSpread);
    ctx.lineTo(innerBaseX - right.x * innerSpread, innerBaseY - right.y * innerSpread);
    ctx.lineTo(innerTipX, innerTipY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} w
   * @param {number} h
   * @param {number} dpr
   * @returns {void}
   */
  _drawLoadingText(ctx, w, h, dpr){
    const text = "CHARGING JUMPDRIVE";
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(10, Math.round(14 * dpr))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    ctx.fillStyle = "rgba(190, 228, 255, 0.88)";
    ctx.fillText(text, w * 0.5, h * 0.84);
    ctx.restore();
  }
}

/**
 * @param {number} value
 * @returns {number}
 */
function fract(value){
  return value - Math.floor(value);
}
