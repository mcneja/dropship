// @ts-check

import { Enemies } from "./enemies.js";
import * as audioState from "./audio.js";
import * as camera from "./camera.js";
import * as controls from "./controls.js";
import * as enemyEffects from "./enemies_effects.js";
import {
  createCollisionRouter,
} from "./collision_world.js";
import { GAME } from "./config.js";
import * as factories from "./factories.js";
import * as feedback from "./feedback.js";
import * as dropship from "./dropship.js";
import * as dashboardUi from "./dashboard.js";
import * as mechanized from "./mechanized.js";
import * as meltdown from "./meltdown.js";
import * as miners from "./miners.js";
import * as levels from "./levels.js";
import * as missions from "./missions.js";
import * as planetFeatures from "./planet_features.js";
import * as stats from "./stats.js";
import * as tether from "./tether.js";
import * as titleScreen from "./title.js";
import * as weapons from "./weapons.js";
import { Mothership, updateLoopMothership } from "./mothership.js";
import { Planet } from "./planet.js";
import { resolvePlanetParams } from "./planet_config.js";
import { createGameSaveSnapshot, restoreGameFromSaveSnapshot } from "./save_state.js";
import { JumpdriveTransition } from "./jumpdrive_transition.js";
import * as fragmentFx from "./fragment_fx.js";
import * as perf from "./perf.js";
import { Camera } from "./camera.js";
import * as debug from "./debug.js";
import * as worldView from "./world_view.js";

/** @typedef {import("./types.d.js").RenderState} RenderState */

/** @typedef {import("./types.d.js").ViewState} ViewState */
/** @typedef {import("./types.d.js").Ship} Ship */
/** @typedef {import("./types.d.js").Miner} Miner */
/** @typedef {import("./types.d.js").HealthPickup} HealthPickup */
/** @typedef {import("./types.d.js").Ui} Ui */
/** @typedef {import("./types.d.js").DestroyedTerrainNode} DestroyedTerrainNode */
/** @typedef {import("./types.d.js").MechanizedLarva} MechanizedLarva */
/** @typedef {import("./help_popup.js").HelpPopup} HelpPopup */
/** @typedef {import("./save_state.js").GameSaveSnapshot} GameSaveSnapshot */
/** @typedef {Gamepad & {hapticActuators?: Array<{pulse:(value:number, durationMs:number)=>Promise<void>}>}} LegacyHapticGamepad */

export class Game {
  /**
   * Main gameplay state orchestrator.
   * @param {Object} deps
   * @param {import("./rendering.js").Renderer} deps.renderer
   * @param {import("./input.js").Input} deps.input
   * @param {Ui} deps.ui
   * @param {{toggleMuted?:()=>boolean,toggleCombatMusicEnabled?:()=>boolean,stepMusicVolume?:(direction:number)=>number,stepSfxVolume?:(direction:number)=>number,setCombatActive?:(active:boolean)=>boolean,triggerCombatImmediate?:()=>boolean,triggerVictoryMusic?:()=>boolean,returnToAmbient?:(withFade?:boolean)=>void,playSfx?:(id:string,opts?:{volume?:number,rate?:number})=>boolean,setThrustLoopActive?:(active:boolean)=>boolean,isPlaybackBypassed?:()=>boolean,setPlaybackBypassed?:(bypassed:boolean)=>boolean}|null|undefined} [deps.audio]
   * @param {HTMLCanvasElement} deps.canvas
   * @param {HTMLCanvasElement|null|undefined} deps.overlay
   * @param {HTMLElement} deps.hud
   * @param {HTMLElement} [deps.dashboard]
   * @param {HTMLElement} [deps.planetLabel]
   * @param {HTMLElement} [deps.objectiveLabel]
   * @param {HTMLElement} [deps.shipStatusLabel]
   * @param {HTMLElement} [deps.signalMeter]
   * @param {HTMLElement} [deps.heatMeter]
   * @param {HelpPopup} [deps.helpPopup]
   */
  constructor({ renderer, input, ui, audio, canvas, hud, dashboard, overlay, planetLabel, objectiveLabel, shipStatusLabel, signalMeter, heatMeter, helpPopup }){
    this.level = perf.BENCH_CONFIG.enabled ? perf.BENCH_CONFIG.level : 1;
    // const seed = CFG.seed;
    const seed = perf.BENCH_CONFIG.enabled ? perf.BENCH_CONFIG.seed : performance.now();
    this.progressionSeed = seed | 0;
    const planetConfig = levels.planetConfigFromLevel(this, this.level);
    const planetParams = resolvePlanetParams(seed, this.level, planetConfig, GAME);
    this.planet = new Planet({ seed: seed, planetConfig, planetParams });
    this.planetParams = planetParams;
    this.renderer = renderer;
    this.renderer.setPlanet(this.planet);
    this.input = input;
    this.ui = ui;
    this.audio = audio || null;
    this.canvas = canvas;
    this.hud = hud;
    this.dashboard = dashboard || null;
    this.planetLabel = planetLabel || null;
    this.objectiveLabel = objectiveLabel || null;
    this.shipStatusLabel = shipStatusLabel || null;
    this.signalMeter = signalMeter || null;
    this.heatMeter = heatMeter || null;
    this.helpPopup = helpPopup || null;
    this.overlay = overlay || null;
    this.overlayCtx = this.overlay ? this.overlay.getContext("2d") : null;
    this.jumpdriveTransition = new JumpdriveTransition();
    /** @type {RenderState|null} */
    this._lastRenderState = null;

    this.TERRAIN_PAD = 0.5;
    this.TERRAIN_MAX = this.planetParams.RMAX + this.TERRAIN_PAD;
    this.TERRAIN_IMPACT_RADIUS = 0.75;
    this.TERRAIN_NODE_IMPACT_RANGE = 1.0;
    /** @type {Array<[number, number]>} */
    this.shipCollisionLocalConvexHull = dropship.buildDropshipLocalConvexHullPoints(GAME);
    this.shipCollisionEdgeSamplesPerEdge = 2;
    this.shipCollisionMaxSampleSpacing = 0.03;
    this.shipCollisionConvexHullBoundRadius = dropship.computeDropshipConvexHullBoundRadius(this.shipCollisionLocalConvexHull);
    this.MINER_HEIGHT = 0.36 * GAME.MINER_SCALE;
    this.MINER_SURFACE_EPS = 0.01 * GAME.MINER_SCALE;
    this.SURFACE_EPS = Math.max(0.12, this.planetParams.RMAX / 280);
    this.COLLISION_EPS = Math.max(0.18, this.planetParams.RMAX / 240);
    this.MINER_HEAD_OFFSET = this.MINER_HEIGHT;
    this.MINER_FOOT_OFFSET = 0.0;

    const mothership = new Mothership({ RMAX: this.planetParams.RMAX, MOTHERSHIP_ORBIT_HEIGHT: this.planetParams.MOTHERSHIP_ORBIT_HEIGHT }, this.planet);

    const c = Math.cos(mothership.angle);
    const s = Math.sin(mothership.angle);

    /** @type {Ship} */
    this.ship = {
      x: mothership.x + c * GAME.MOTHERSHIP_START_DOCK_X - s * GAME.MOTHERSHIP_START_DOCK_Y,
      y: mothership.y + s * GAME.MOTHERSHIP_START_DOCK_X + c * GAME.MOTHERSHIP_START_DOCK_Y,
      vx: mothership.vx,
      vy: mothership.vy,
      state: "landed",
      explodeT: 0,
      lastAir: 1,
      hpCur: GAME.SHIP_STARTING_MAX_HP,
      bombsCur: GAME.SHIP_STARTING_MAX_BOMBS,
      heat: 0,
      invertT: 0,
      hitCooldown: 0,
      cabinSide: 1,
      guidePath: null,
      _dock: {lx: GAME.MOTHERSHIP_START_DOCK_X, ly: GAME.MOTHERSHIP_START_DOCK_Y},
      _landingDebug: null,

      dropshipMiners: 0,
      dropshipPilots: 0,
      dropshipEngineers: 0,

      mothershipMiners: 0,
      mothershipPilots: 0,
      mothershipEngineers: 0,

      hpMax: GAME.SHIP_STARTING_MAX_HP,
      bombsMax: GAME.SHIP_STARTING_MAX_BOMBS,
      bombStrength: GAME.SHIP_STARTING_BOMB_STRENGTH,
      thrust: GAME.SHIP_STARTING_THRUST,
      inertialDrive: GAME.SHIP_STARTING_INERTIAL_DRIVE,
      gunPower: GAME.SHIP_STARTING_GUN_POWER,
      rescueeDetector: false,
      planetScanner: false,
      bounceShots: false,
    };
    this.mothership = mothership;
    /** @type {Array<import("./types.d.js").Debris>} */
    this.debris = [];
    /** @type {Array<import("./types.d.js").Debris>} */
    this.fragments = [];
    /** @type {MechanizedLarva[]} */
    this.mechanizedLarvae = [];
    /** @type {Array<import("./types.d.js").FallenMiner>} */
    this.fallenMiners = [];
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    this.playerShots = [];
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    this.playerBombs = [];
    /** @type {Array<{x:number,y:number,life:number,radius?:number}>} */
    this.entityExplosions = [];
    /** @type {Array<{x:number,y:number,vx:number,vy:number,text:string,life:number}>} */
    this.popups = [];
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    this.shipHitPopups = [];
    /** @type {Array<import("./types.d.js").PickupAnimation>} */
    this.pickupAnimations = [];
    /** @type {{x:number,y:number}|null} */
    this.lastAimWorld = null;
    /** @type {{x:number,y:number}|null} */
    this.lastAimScreen = null;
    this._shipWasInWater = false;
    this.ship.renderAngle = dropship.getDropshipWorldRotation(this.ship.x, this.ship.y);

    this.PLAYER_SHOT_SPEED = 7.5;
    this.PLAYER_SHOT_LIFE = 1.2;
    this.PLAYER_SHOT_RADIUS = 0.22;
    this.PLAYER_SHOT_INTERVAL = 0.2;
    this.playerShotCooldown = 0;
    this.PLAYER_BOMB_SPEED = 4.5;
    this.PLAYER_BOMB_LIFE = 3.2;
    this.PLAYER_BOMB_RADIUS = 0.35;
    this.PLAYER_BOMB_BLAST = 0.9;
    this.PLAYER_BOMB_DAMAGE = 1.2;
    this.CRAWLER_DEATH_BLAST = 1.0;
    this.CRAWLER_BOMB_DEATH_BLAST = 2.0;
    this.CRAWLER_DEATH_DAMAGE = 1.0;
    this.CRAWLER_DEATH_FLASH_LIFE = 0.8;
    this.SHIP_HIT_BLAST = 0.55;
    this.ENEMY_HIT_BLAST = 0.35;
    this.NONLETHAL_HIT_FLASH_LIFE = 0.25;
    this.FACTORY_HIT_FLASH_T = 0.35;
    this.MINER_SHOT_DEATH_LIFE = 1.1;
    this.MINER_EXPLOSION_DEATH_LIFE = 1.45;
    this.MINER_EXPLOSION_DEATH_SPEED_MIN = 0.5;
    this.MINER_EXPLOSION_DEATH_SPEED_MAX = 1.1;
    this.PICKUP_ANIMATION_DURATION = 0.18;

    /** @type {Miner[]} */
    this.miners = [];
    this.minersRemaining = 0;
    this.minersDead = 0;
    this.minerTarget = 0;
    this.minerCandidates = 0;
    this.levelStats = stats.createRunStats(this);
    this.overallStats = stats.createRunStats(this);
    /** @type {import("./types.d.js").CollisionQuery} */
    this.collision = createCollisionRouter(this.planet, () => this.mothership);
    this.objective = levels.buildObjective(this, planetConfig, this.level);
    this.missionState = new missions.MissionState();
    this.coreMeltdownActive = false;
    this.coreMeltdownT = 0;
    this.coreMeltdownDuration = 120;
    this.coreMeltdownEruptT = 0;
    this.camera = new Camera();
    this.feedbackState = new feedback.FeedbackState();
    this.titleState = new titleScreen.TitleState();
    this.dashboardState = new dashboardUi.DashboardState();
    /** @type {"keyboard"|"mouse"|"touch"|"gamepad"|null} */
    this.activeInputType = null;
    debug.logLevelInit(this, planetConfig);
    levels.prepareBarrenMinerPadReservations(this, this.planet, planetConfig, this.level);
    this.enemies = new Enemies({
      planet: this.planet,
      collision: this.collision,
      total: levels.totalEnemiesForLevel(this, this.level),
      level: this.level,
      levelSeed: this.planet.getSeed(),
      placement: planetConfig.enemyPlacement || "random",
      solidPropSegmentBlocked: (ax, ay, bx, by, radius) => mechanized.solidPropSegmentBlocked(this, ax, ay, bx, by, radius),
      onEnemyShot: () => {
        audioState.playSfx(this, "enemy_fire", { volume: 0.55 });
        audioState.markCombatThreat(this);
        audioState.triggerCombatImmediate(this);
      },
      onEnemyDestroyed: (enemy, info) => {
        enemyEffects.handleEnemyDestroyed(this, enemy, info);
      },
    });
    stats.setHostileBudget(this, this.enemies.enemies.length);
    /** @type {Array<HealthPickup>} */
    this.healthPickups = [];
    missions.initializeClearObjectiveTracking(this);
    tether.syncTetherProtectionStates(this);

    miners.spawnMiners(this);
    this.planet.reconcileFeatures({
      enemies: this.enemies.enemies,
      miners: this.miners,
    });

    this.lastTime = performance.now();
    this.accumulator = 0;
    this.perfState = new perf.PerfState(this.lastTime);
    this.debugState = new debug.DebugState();
    debug.initLoopDebugState(this, GAME);
    this.lastHeat = 0;
    this.pendingBootJumpdriveIntro = !perf.BENCH_CONFIG.enabled;
    this.NEW_GAME_HELP_PROMPT_SECS = 10;
    this.START_TITLE_FADE_PER_SEC = 1.8;
    this.COMBAT_THREAT_HOLD_MS = 12000;
    this.OBJECTIVE_COMPLETE_SFX_DELAY_MS = 1000;
    this.combatThreatUntilMs = 0;

    /** @type {{
     *   onExplosion:(info:{x:number,y:number,life:number,radius:number})=>void,
     *   onDebris:(info:{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number,maxLife?:number,size?:number,cr?:number,cg?:number,cb?:number,alpha?:number})=>void,
     *   onAreaDamage:(x:number,y:number,radius:number)=>void,
     *   onShipDamage:(x:number,y:number)=>void,
     *   onShipHeat:(amount:number)=>void,
     *   onShipCrash:()=>void,
     *   onShipConfuse:(duration:number)=>void,
     *   onEnemyHit:(enemy:{x:number,y:number,hp:number,hitT?:number,stunT?:number}, x:number, y:number)=>void,
     *   onEnemyStun:(enemy:{x:number,y:number,hp:number,hitT?:number,stunT?:number}, duration:number, source?:"spores"|"lava")=>void,
     *   onMinerKilled:()=>void,
     *   onScreenShake:(amount:number)=>void,
     *   onRumble:(weak:number, strong:number, durationMs?:number)=>void,
     * }}
     */
    this.featureCallbacks = {
      onExplosion: (info) => {
        this.entityExplosions.push(info);
      },
      onDebris: (info) => {
        this.debris.push(info);
      },
      onAreaDamage: (x, y, radius) => {
        weapons.applyAreaDamage(this, x, y, radius);
      },
      onShipDamage: (x, y) => {
        dropship.damageShip(this, x, y);
      },
      onShipHeat: (amount) => {
        if (this.ship.state === "crashed") return;
        this.ship.heat = Math.min(100, (this.ship.heat || 0) + Math.max(0, amount));
      },
      onShipCrash: () => {
        dropship.triggerCrash(this, );
      },
      onShipConfuse: (duration) => {
        if (this.ship.state === "crashed") return;
        const d = Math.max(0.1, duration || 0);
        this.ship.invertT = Math.max(this.ship.invertT || 0, d);
      },
      onEnemyHit: (enemy, x, y) => {
        enemyEffects.damageEnemy(this, enemy, 1);
      },
      onEnemyStun: (enemy, duration, source) => {
        enemyEffects.stunEnemy(this, enemy, duration, source);
      },
      onMinerKilled: () => {
        this.minersRemaining = Math.max(0, this.minersRemaining - 1);
        stats.registerMinerLoss(this, 1);
      },
      onScreenShake: (amount) => {
        this.camera.addScreenShake(amount);
      },
      onRumble: (weak, strong, durationMs) => {
        feedback.queueRumble(this, weak, strong, durationMs);
      },
    };
    this.planetView = false;
    this.fogEnabled = true;
    this.hasLaunchedPlayerShip = false;
    /** @type {Array<{perk:string,text:string}>|null} */
    this.pendingPerkChoice = null;
    this.missionState.objectiveCompleteSfxPlayed = dashboardUi.objectiveComplete(this);
    this.missionState.objectiveCompleteSfxDueAtMs = Number.POSITIVE_INFINITY;
    this.missionState.victoryMusicTriggered = false;
    if (perf.BENCH_CONFIG.enabled){
      debug.applyBenchmarkSetup(this);
    }
    this.camera.snapToScene(camera.cameraScene(this));
  }

  /**
   * @param {number} dt
   * @param {ReturnType<import("./input.js").Input["update"]>} inputState
   * @returns {void}
  */
  _step(dt, inputState){
    const titleState = this.titleState;
    if (this.jumpdriveTransition.isActive()){
      audioState.setThrustLoopActive(this, false);
      this.jumpdriveTransition.update(dt);
      const preparedLevel = this.jumpdriveTransition.consumePreparedLevel();
      if (preparedLevel){
        levels.beginLevel(this, preparedLevel.seed, preparedLevel.level, preparedLevel.mapWorld, true);
        this.jumpdriveTransition.applyPreparedLevel({
          mothership: this.mothership,
          view: this.camera.autoView(camera.cameraScene(this)),
        });
        this.planet.primeRenderFog(this.renderer, this.ship.x, this.ship.y);
      }
      return;
    }

    const stepInput = controls.normalizeStepInput(this, inputState, dt);
    let {
      stickThrust,
      left,
      right,
      thrust,
      down,
      shootHeld,
      shootPressed,
      bomb,
      aim,
      aimShoot,
      aimBomb,
      aimShootFrom,
      aimShootTo,
      aimBombFrom,
      aimBombTo,
      spawnEnemyType,
    } = stepInput;
    if (controls.handleStepCommands(this, stepInput, inputState)){
      audioState.setThrustLoopActive(this, false);
      return;
    }
    tether.update(this, dt);

    const mothershipMotion = updateLoopMothership(this, dt);
    debug.handleSpawnEnemyType(this, spawnEnemyType);
    const { gunOrigin, aimWorldShoot, aimWorldBomb } = dropship.updateStep(this, dt, {
      left,
      right,
      thrust,
      down,
      stickThrust,
      aim,
      aimShoot,
      aimBomb,
      aimShootFrom,
      aimShootTo,
      aimBombFrom,
      aimBombTo,
    }, titleState, mothershipMotion);
    camera.updateLoopCamera(this, dt);

    mechanized.resolveShipSolidPropCollisions(this);

    weapons.update(this, dt, {
      shootHeld,
      shootPressed,
      bomb,
      gunOrigin,
      aimWorldShoot,
      aimWorldBomb,
      aimShootFrom,
      aimShootTo,
      aimBombFrom,
      aimBombTo,
    });

    meltdown.update(this, dt);
    planetFeatures.updateFeatureEffects(this, dt);

    miners.update(this, dt);

    feedback.updateTransientPopups(this, dt);
    fragmentFx.updateFragmentsAndDebris(this, dt);

    mechanized.updateMechanizedLarvae(this, dt);
    this.enemies.update(this.ship, dt);
    factories.update(this, dt);
    mechanized.resolveEnemySolidPropCollisions(this);

    dropship.updateHostileDamage(this, dt);
    dropship.updateLandedState(this, { left, right, thrust, stickThrust });
  }

  /**
   * @returns {void}
  */
  _frame(){
    const titleState = this.titleState;
    const debugState = this.debugState;
    const now = performance.now();
    const frameMs = Math.max(0, now - this.lastTime);
    const rawDt = Math.min(0.05, frameMs / 1000);
    this.lastTime = now;
    debug.recordFrameTiming(this, now, frameMs);
    const transitionActive = this.jumpdriveTransition.isActive();
    dashboardUi.syncInputUi(this, transitionActive);
    if (this.input && typeof this.input.setDebugCommandsEnabled === "function"){
      this.input.setDebugCommandsEnabled(debugState.devHudVisible);
    }
    const inputState = this.input.update();
    this.activeInputType = inputState.inputType || this.activeInputType;
    debug.syncFrameStep(this, inputState, transitionActive);
    camera.handleZoomInput(this, inputState, transitionActive);
    if (this.helpPopup && typeof this.helpPopup.setTouchMode === "function"){
      this.helpPopup.setTouchMode(inputState.inputType === "touch");
    }
    const helpOpen = !!(this.helpPopup && this.helpPopup.isOpen && this.helpPopup.isOpen());
    const { fixed, dt } = debug.resolveFrameDt(this, rawDt, inputState, helpOpen);
    titleScreen.tickHelpPrompt(this, dt);

    missions.updateLevelAdvanceReady(this, transitionActive);
    if (!transitionActive){
      titleScreen.updateStartTitle(this, dt, inputState);
    }

    if (!transitionActive && this.ship.state === "crashed"){
      this.ship.explodeT = Math.min(1.2, this.ship.explodeT + dt * 0.9);
    }

    debug.handleFrameDebugInput(this, inputState, transitionActive);
    controls.applyFrameToggles(this, inputState);
    audioState.handleHotkeys(this, inputState);
    const maxSteps = 4;
    let steps = 0;
    while (this.accumulator >= fixed && steps < maxSteps){
      this._step(fixed, inputState);
      // One-shot actions are generated once per rendered frame. Consume them
      // after the first fixed step so catch-up substeps cannot replay them.
      controls.consumeFrameOneShots(inputState);
      this.accumulator -= fixed;
      steps++;
    }
    if (steps === 0){
      camera.updateLoopCamera(this, rawDt);
    }
    feedback.flushRumble(this, this.activeInputType, now);
    const frameMission = missions.finalizeFrameState(this, now, transitionActive);
    const objectiveCompleteNow = frameMission.objectiveCompleteNow;

    debug.updateLandingDebug(this);
    perf.updateFps(this, now);

    // Render phase: from here on, compose and draw the current frame only.
    // Gameplay simulation/state mutation for this frame should already be finished.
    const titleShowing = !titleState.seen && titleState.alpha > 0;
    const runEnded = frameMission.runEnded;
    const hudVisible = debugState.devHudVisible;
    this.hud.style.display = hudVisible ? "block" : "none";
    worldView.renderFrame(this, inputState, {
      now,
      dt,
      transitionActive,
      transitionFogOrigin: transitionActive ? this.jumpdriveTransition.fogOrigin(this.ship) : null,
      hudVisible,
      titleShowing,
      runEnded,
    });

    requestAnimationFrame(() => this._frame());
  }

  /**
   * @returns {void}
   */
  start(){
    if (this.pendingBootJumpdriveIntro){
      this.pendingBootJumpdriveIntro = false;
      levels.startCurrentLevelJumpdriveIntro(this);
    }
    requestAnimationFrame(() => this._frame());
  }

  /**
   * Build a versioned runtime snapshot suitable for localStorage.
   * @returns {GameSaveSnapshot}
   */
  createSaveSnapshot(){
    return createGameSaveSnapshot(this);
  }

  /**
   * Restore a previously serialized runtime snapshot.
   * @param {GameSaveSnapshot} snapshot
   * @returns {boolean}
   */
  restoreFromSaveSnapshot(snapshot){
    this.pendingBootJumpdriveIntro = false;
    this.jumpdriveTransition.cancel();
    const restored = restoreGameFromSaveSnapshot(this, snapshot);
    if (restored){
      dropship.resetShipRenderAngle(this);
      this.camera.snapToScene(camera.cameraScene(this));
    }
    return restored;
  }

}

