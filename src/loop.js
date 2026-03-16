// @ts-check

import { Enemies } from "./enemies.js";
import {
  createCollisionRouter,
  findCollisionExactAt,
  findFirstCollisionOnSegmentExact,
  findMothershipCollisionExactAtPose,
  findPlanetCollisionExactAt,
  resolveCollisionResponse,
  sampleBodyCollisionAt,
  stabilizePlanetPenetration,
} from "./collision_world.js";
import { GAME, CFG } from "./config.js";
import {
  buildDropshipLocalConvexHullPoints,
  buildDropshipWorldConvexHullSampleSet,
  buildDropshipWorldConvexHullVertices,
  computeDropshipConvexHullBoundRadius,
  computeDropshipAcceleration,
  getDropshipGunPivotLocal,
  hasDropshipThrustInput,
  pointDistanceToDropshipWorldConvexHull,
  resolveDropshipFacing,
  wantsDropshipLiftoff,
} from "./dropship.js";
import { Mothership, updateMothership, mothershipCollisionInfo } from "./mothership.js";
import { Planet } from "./planet.js";
import { pickPlanetConfig, pickPlanetConfigById, resolveLevelProgression, resolvePlanetParams } from "./planet_config.js";
import { mulberry32 } from "./rng.js";
import { clearSavedGame, createLoopSaveSnapshot, restoreLoopFromSaveSnapshot } from "./save_state.js";
import { copyGameplayScreenshotToClipboard, drawStartTitle } from "./screenshot.js";
import { JumpdriveTransition } from "./jumpdrive_transition.js";
import {
  extractPathSegment,
  findGuidePathTargetIndex,
  findMinerGuideAttachIndex,
  moveAlongPathNegative,
  moveAlongPathPositive,
  posFromPathIndex,
} from "./surface_guide_path.js";

/** @typedef {import("./types.d.js").RenderState} RenderState */
import { lerpAngleShortest, sweptShipVsMovingMothership } from "./collision_mothership.js";

/** @typedef {import("./types.d.js").ViewState} ViewState */
/** @typedef {import("./types.d.js").Ship} Ship */
/** @typedef {import("./types.d.js").Miner} Miner */
/** @typedef {import("./types.d.js").Ui} Ui */
/** @typedef {import("./help_popup.js").HelpPopup} HelpPopup */
/** @typedef {import("./planet_config.js").PlanetTypeId} PlanetTypeId */
/** @typedef {import("./planet_config.js").PlanetConfig} PlanetConfig */

export class GameLoop {
  /**
   * Main gameplay loop orchestrator.
   * @param {Object} deps
   * @param {import("./rendering.js").Renderer} deps.renderer
   * @param {import("./input.js").Input} deps.input
   * @param {Ui} deps.ui
   * @param {{toggleMuted?:()=>boolean,toggleCombatMusicEnabled?:()=>boolean,stepMusicVolume?:(direction:number)=>number,stepSfxVolume?:(direction:number)=>number,setCombatActive?:(active:boolean)=>boolean,triggerCombatImmediate?:()=>boolean,triggerVictoryMusic?:()=>boolean,returnToAmbient?:(withFade?:boolean)=>void,playSfx?:(id:string,opts?:{volume?:number,rate?:number})=>boolean,setThrustLoopActive?:(active:boolean)=>boolean}|null|undefined} [deps.audio]
   * @param {HTMLCanvasElement} deps.canvas
   * @param {HTMLCanvasElement|null|undefined} deps.overlay
   * @param {HTMLElement} deps.hud
   * @param {HTMLElement} [deps.planetLabel]
   * @param {HTMLElement} [deps.objectiveLabel]
   * @param {HTMLElement} [deps.shipStatusLabel]
   * @param {HTMLElement} [deps.heatMeter]
   * @param {HelpPopup} [deps.helpPopup]
   */
  constructor({ renderer, input, ui, audio, canvas, hud, overlay, planetLabel, objectiveLabel, shipStatusLabel, heatMeter, helpPopup }){
    this.level = 1;
    // const seed = CFG.seed;
    const seed = performance.now();
    this.progressionSeed = seed | 0;
    const planetConfig = this._planetConfigFromLevel(this.level);
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
    this.planetLabel = planetLabel || null;
    this.objectiveLabel = objectiveLabel || null;
    this.shipStatusLabel = shipStatusLabel || null;
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
    /** @type {Array<[number, number]>} */
    this.shipCollisionLocalConvexHull = buildDropshipLocalConvexHullPoints(GAME);
    this.shipCollisionEdgeSamplesPerEdge = 2;
    this.shipCollisionMaxSampleSpacing = 0.03;
    this.shipCollisionConvexHullBoundRadius = computeDropshipConvexHullBoundRadius(this.shipCollisionLocalConvexHull);
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
      thrust: GAME.SHIP_STARTING_THRUST,
      gunPower: GAME.SHIP_STARTING_GUN_POWER,
      rescueeDetector: false,
      planetScanner: false,
    };
    this.mothership = mothership;
    /** @type {Array<{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number}>} */
    this.debris = [];
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
    /** @type {{x:number,y:number}|null} */
    this.lastAimWorld = null;
    /** @type {{x:number,y:number}|null} */
    this.lastAimScreen = null;
    this._shipWasInWater = false;

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
    this.CRAWLER_DEATH_BLAST = 1.15;
    this.CRAWLER_DEATH_DAMAGE = 1.0;
    this.CRAWLER_TERRAIN_BLAST = 0.55;
    this.CRAWLER_DEATH_FLASH_LIFE = 0.8;
    this.SHIP_HIT_BLAST = 0.55;
    this.ENEMY_HIT_BLAST = 0.35;
    this.NONLETHAL_HIT_FLASH_LIFE = 0.25;
    this.FACTORY_HIT_FLASH_T = 0.35;

    /** @type {Miner[]} */
    this.miners = [];
    this.minersRemaining = 0;
    this.minersDead = 0;
    this.minerTarget = 0;
    this.minerCandidates = 0;
    /** @type {import("./types.d.js").CollisionQuery} */
    this.collision = createCollisionRouter(this.planet, () => this.mothership);
    this.objective = this._buildObjective(planetConfig, this.level);
    this.clearObjectiveTotal = 0;
    this.coreMeltdownActive = false;
    this.coreMeltdownT = 0;
    this.coreMeltdownDuration = 120;
    this.coreMeltdownEruptT = 0;
    console.log("[Level] init", {
      level: this.level,
      planetId: planetConfig.id,
      enemies: this._totalEnemiesForLevel(this.level),
      miners: this._targetMinersForLevel(),
      platformCount: planetConfig.platformCount,
      props: (this.planet.props || []).length,
    });
    if (this.planet.props && this.planet.props.length){
      console.log("[Level] props sample", this.planet.props.slice(0, 3).map((p) => ({ type: p.type, x: p.x, y: p.y, dead: !!p.dead })));
    }
    this.enemies = new Enemies({
      planet: this.planet,
      collision: this.collision,
      total: this._totalEnemiesForLevel(this.level),
      level: this.level,
      levelSeed: this.planet.getSeed(),
      placement: planetConfig.enemyPlacement || "random",
      onEnemyShot: () => {
        this._playSfx("enemy_fire", { volume: 0.55 });
        this._markCombatThreat();
        this._triggerCombatImmediate();
      },
      onEnemyDestroyed: (enemy) => {
        this._handleEnemyDestroyed(enemy);
      },
    });
    this._initializeClearObjectiveTracking();
    this._syncTetherProtectionStates();

    this._spawnMiners();
    this.planet.reconcileFeatures({
      enemies: this.enemies.enemies,
      miners: this.miners,
    });

    this.lastTime = performance.now();
    this.accumulator = 0;
    this.fpsTime = this.lastTime;
    this.fpsFrames = 0;
    this.fps = 0;
    this.debugCollisions = GAME.DEBUG_COLLISION;
    this.debugPlanetTriangles = false;
    this.debugCollisionContours = false;
    this.debugFrameStepMode = false;
    this.debugMinerGuidePath = false;
    this.debugRingVertices = false;
    this.debugMinerPathToMiner = null;
    this.devHudVisible = false;
    if (this.input && typeof this.input.setDebugCommandsEnabled === "function"){
      this.input.setDebugCommandsEnabled(this.devHudVisible);
    }
    this.levelAdvanceReady = false;
    this.lastHeat = 0;
    this.statusCueText = "";
    this.statusCueUntil = 0;
    this.screenshotCopyInFlight = false;
    this._lastLandingDebugConsoleLine = "";
    this._landingDebugSessionIdNext = 1;
    this._landingDebugSessionId = 0;
    this._landingDebugSessionFrame = 0;
    this._landingDebugSessionActive = false;
    this._landingDebugSessionSource = "";
    this._minerPathDebugCooldown = 0;
    this._resetStartTitle();
    this.pendingBootJumpdriveIntro = true;
    this.NEW_GAME_HELP_PROMPT_SECS = 10;
    this.newGameHelpPromptT = 0;
    this.newGameHelpPromptArmed = true;
    this.START_TITLE_FADE_PER_SEC = 1.8;
    this.COMBAT_THREAT_HOLD_MS = 12000;
    this.OBJECTIVE_COMPLETE_SFX_DELAY_MS = 1000;
    this.combatThreatUntilMs = 0;

    this.featureCallbacks = {
      onExplosion: (info) => {
        this.entityExplosions.push(info);
      },
      onDebris: (info) => {
        this.debris.push(info);
      },
      onAreaDamage: (x, y, radius) => {
        this._applyAreaDamage(x, y, radius);
      },
      onShipDamage: (x, y) => {
        this._damageShip(x, y);
      },
      onShipHeat: (amount) => {
        if (this.ship.state === "crashed") return;
        this.ship.heat = Math.min(100, (this.ship.heat || 0) + Math.max(0, amount));
      },
      onShipCrash: () => {
        this._triggerCrash();
      },
      onShipConfuse: (duration) => {
        if (this.ship.state === "crashed") return;
        const d = Math.max(0.1, duration || 0);
        this.ship.invertT = Math.max(this.ship.invertT || 0, d);
      },
      onEnemyHit: (enemy, x, y) => {
        this._damageEnemy(enemy, 1);
      },
      onEnemyStun: (enemy, duration) => {
        this._stunEnemy(enemy, duration);
      },
      onMinerKilled: () => {
        this.minersRemaining = Math.max(0, this.minersRemaining - 1);
        this.minersDead++;
      },
    };
    this.planetView = false;
    this.fogEnabled = true;
    /** @type {boolean} */
    this.manualZoomActive = false;
    /** @type {number} */
    this.manualZoomMultiplier = 1;
    this.hasLaunchedPlayerShip = false;
    /** @type {Array<{perk:string,text:string}>|null} */
    this.pendingPerkChoice = null;
    this.objectiveCompleteSfxPlayed = this._objectiveComplete();
    this.objectiveCompleteSfxDueAtMs = Number.POSITIVE_INFINITY;
    this.victoryMusicTriggered = false;
  }

  /**
   * @param {PlanetConfig|null|undefined} cfg
   * @param {number} lvl
   * @returns {number}
   */
  _enemyTotalForConfig(cfg, lvl){
    const base = (cfg && typeof cfg.enemyCountBase === "number") ? cfg.enemyCountBase : 5;
    const per = (cfg && typeof cfg.enemyCountPerLevel === "number") ? cfg.enemyCountPerLevel : 5;
    const cap = (cfg && typeof cfg.enemyCountCap === "number") ? cfg.enemyCountCap : 30;
    const count = base + Math.max(0, (lvl | 0) - 1) * per;
    return Math.min(cap, count);
  }

  /**
   * @param {number} lvl
   * @returns {number}
   */
  _totalEnemiesForLevel(lvl){
    const cfg = this.planet ? this.planet.getPlanetConfig() : null;
    return this._enemyTotalForConfig(cfg, lvl);
  }

  /**
   * @param {PlanetConfig|null|undefined} cfg
   * @param {number} lvl
   * @returns {number}
   */
  _minerTargetForConfig(cfg, lvl){
    const base = (cfg && typeof cfg.minerCountBase === "number") ? cfg.minerCountBase : 0;
    const per = (cfg && typeof cfg.minerCountPerLevel === "number") ? cfg.minerCountPerLevel : 0;
    const cap = (cfg && typeof cfg.minerCountCap === "number") ? cfg.minerCountCap : 0;
    return Math.min(cap, base + Math.max(0, (lvl | 0) - 1) * per);
  }

  /**
   * @returns {number}
   */
  _targetMinersForLevel(){
    const cfg = this.planet ? this.planet.getPlanetConfig() : null;
    return this._minerTargetForConfig(cfg, this.level);
  }

  /**
   * @param {import("./planet_config.js").PlanetConfig} cfg
   * @param {number} lvl
   * @returns {{type:string,target:number}}
   */
  _buildObjective(cfg, lvl){
    const obj = cfg && cfg.objective ? cfg.objective : { type: "extract", count: 0 };
    if (cfg && cfg.id === "mechanized" && lvl >= 16){
      const target = this._tetherPropsAll().length;
      if (target > 0){
        return { type: "destroy_core", target };
      }
    }
    if (obj.type === "clear"){
      const target = (obj.count && obj.count > 0) ? obj.count : this._totalEnemiesForLevel(lvl);
      return { type: "clear", target };
    }
    if (obj.type === "extract"){
      const base = (cfg && typeof cfg.minerCountBase === "number") ? cfg.minerCountBase : 5;
      const per = (cfg && typeof cfg.minerCountPerLevel === "number") ? cfg.minerCountPerLevel : 2;
      const cap = (cfg && typeof cfg.minerCountCap === "number") ? cfg.minerCountCap : 30;
      const target = (obj.count && obj.count > 0)
        ? obj.count
        : Math.min(cap, base + Math.max(0, (lvl | 0) - 1) * per);
      return { type: "extract", target };
    }
    return { type: obj.type || "extract", target: obj.count || 0 };
  }

  /**
   * @returns {boolean}
   */
  _isMechanizedLevel(){
    const cfg = this.planet && this.planet.getPlanetConfig ? this.planet.getPlanetConfig() : null;
    return !!(cfg && cfg.id === "mechanized");
  }

  /**
   * @returns {boolean}
   */
  _isMechanizedCoreLevel(){
    return this._isMechanizedLevel() && !!(this.planet && this.planet.getCoreRadius && this.planet.getCoreRadius() > 0.5);
  }

  /**
   * @returns {Array<any>}
   */
  _factoryPropsAlive(){
    const out = [];
    if (!this.planet || !this.planet.props || !this.planet.props.length) return out;
    for (const p of this.planet.props){
      if (p.type !== "factory") continue;
      if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
      out.push(p);
    }
    return out;
  }

  /**
   * @returns {Array<any>}
   */
  _tetherPropsAlive(){
    const out = [];
    if (!this.planet || !this.planet.props || !this.planet.props.length) return out;
    for (const p of this.planet.props){
      if (p.type !== "tether") continue;
      if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
      out.push(p);
    }
    return out;
  }

  /**
   * @returns {Array<any>}
   */
  _tetherPropsAll(){
    const out = [];
    if (!this.planet || !this.planet.props || !this.planet.props.length) return out;
    for (const p of this.planet.props){
      if (p.type === "tether") out.push(p);
    }
    return out;
  }

  /**
   * @param {number} propId
   * @returns {any|null}
   */
  _findFactoryById(propId){
    if (!this.planet || !this.planet.props || !this.planet.props.length) return null;
    for (const p of this.planet.props){
      if (p.type !== "factory") continue;
      if ((p.propId | 0) === (propId | 0)) return p;
    }
    return null;
  }

  /**
   * @param {any} tether
   * @returns {boolean}
   */
  _isTetherUnlocked(tether){
    if (!tether) return false;
    const protectedBy = (typeof tether.protectedBy === "number") ? tether.protectedBy : -1;
    if (protectedBy < 0) return true;
    const factory = this._findFactoryById(protectedBy);
    if (!factory) return true;
    if (factory.dead) return true;
    if (typeof factory.hp === "number" && factory.hp <= 0) return true;
    return false;
  }

  /**
   * @returns {void}
   */
  _syncTetherProtectionStates(){
    const tethers = this._tetherPropsAll();
    if (!tethers.length) return;
    for (const t of tethers){
      t.locked = !this._isTetherUnlocked(t);
    }
  }

  /**
   * @returns {number}
   */
  _remainingCombatEnemies(){
    if (!this.enemies || !this.enemies.enemies) return 0;
    let c = 0;
    for (const e of this.enemies.enemies){
      if (!e || e.hp <= 0) continue;
      c++;
    }
    return c;
  }

  /**
   * @returns {number}
   */
  _remainingClearTargets(){
    let remaining = this._remainingCombatEnemies();
    if (this._isMechanizedLevel()){
      remaining += this._factoryPropsAlive().length;
    }
    return remaining;
  }

  /**
   * Recompute clear-objective totals at level init.
   * @returns {void}
   */
  _initializeClearObjectiveTracking(){
    if (!this.objective || this.objective.type !== "clear"){
      this.clearObjectiveTotal = 0;
      return;
    }
    const remaining = this._remainingClearTargets();
    this.clearObjectiveTotal = Math.max(this.objective.target || 0, remaining);
    this.objective.target = this.clearObjectiveTotal;
  }

  /**
   * @returns {string}
   */
  _objectiveText(){
    if (!this.objective) return "";
    if (this.objective.type === "destroy_core"){
      const target = Math.max(this.objective.target || 0, this._tetherPropsAll().length);
      const remaining = this._tetherPropsAlive().length;
      const done = target ? Math.max(0, target - remaining) : 0;
      if (this.coreMeltdownActive){
        const timeLeft = Math.max(0, this.coreMeltdownDuration - this.coreMeltdownT);
        return `Objective: Escape to mothership ${Math.ceil(timeLeft)}s`;
      }
      return `Objective: Destroy core ${done}${target ? `/${target}` : ""}`;
    }
    if (this.objective.type === "clear"){
      const remaining = this._remainingClearTargets();
      const target = Math.max(this.objective.target || 0, this.clearObjectiveTotal || 0, remaining);
      const done = target ? Math.max(0, target - remaining) : 0;
      return `Objective: Clear ${done}${target ? `/${target}` : ""}`;
    }
    if (this.objective.type === "extract"){
      const remaining = this.minersRemaining;
      const target = this.objective.target || 0;
      const rescued = target ? Math.max(0, target - remaining) : 0;
      return `Objective: Extract ${rescued}${target ? `/${target}` : ""} (dead ${this.minersDead})`;
    }
    if (this.minerTarget > 0){
      const remaining = this.enemies ? this.enemies.enemies.length : 0;
      const clearTarget = this.objective && this.objective.target ? this.objective.target : 0;
      const cleared = clearTarget ? Math.max(0, clearTarget - remaining) : 0;
      const rescued = Math.max(0, this.minerTarget - this.minersRemaining);
      return `Objective: Clear ${cleared}/${clearTarget} | Rescue ${rescued}/${this.minerTarget} (dead ${this.minersDead})`;
    }
    return `Objective: ${this.objective.type}`;
  }


  /**
   * @returns {void}
   */
  _resetShip(){
    const c = Math.cos(this.mothership.angle);
    const s = Math.sin(this.mothership.angle);
    this.ship.x = this.mothership.x + c * GAME.MOTHERSHIP_START_DOCK_X - s * GAME.MOTHERSHIP_START_DOCK_Y;
    this.ship.y = this.mothership.y + s * GAME.MOTHERSHIP_START_DOCK_X + c * GAME.MOTHERSHIP_START_DOCK_Y;
    this.ship.vx = this.mothership.vx;
    this.ship.vy = this.mothership.vy;
    this.ship.state = "landed";
    this.ship.explodeT = 0;
    this.ship.hpCur = this.ship.hpMax;
    this.ship.bombsCur = this.ship.bombsMax;
    this.ship.heat = 0;
    this.ship.invertT = 0;
    this.ship.hitCooldown = 0;
    this.ship.dropshipMiners = 0;
    this.ship.dropshipPilots = 0;
    this.ship.dropshipEngineers = 0;
    // Always reset dock anchor so stale wall-contact dock offsets cannot
    // survive respawn/restart and pin the ship in a bad location.
    this.ship._dock = {lx: GAME.MOTHERSHIP_START_DOCK_X, ly: GAME.MOTHERSHIP_START_DOCK_Y};
    this.ship._collision = null;
    this.ship._samples = null;
    this.ship._landingDebug = null;
    this.debris.length = 0;
    this.playerShots.length = 0;
    this.playerBombs.length = 0;
    this.entityExplosions.length = 0;
    this.popups.length = 0;
    this.shipHitPopups.length = 0;
    this.playerShotCooldown = 0;
    this.planet.clearFeatureParticles();
    this.lastAimWorld = null;
    this.lastAimScreen = null;
    this.lastHeat = 0;
    this._shipWasInWater = false;
    this.combatThreatUntilMs = 0;
    this._setCombatActive(false);
    this._setThrustLoopActive(false);
  }

  /**
   * @returns {void}
   */
  _putShipInLowOrbit(){
    const orbitState = this.planet.orbitStateFromElements(this.planet.planetRadius + 1, 0, 0, true);
    this.ship.x = orbitState.x;
    this.ship.y = orbitState.y;
    this.ship.vx = orbitState.vx;
    this.ship.vy = orbitState.vy;
    this.ship.state = "flying";
    this.ship._dock = null;
  }

  /**
   * @returns {void}
   */
  _triggerCrash(){
    if (this.ship.state === "crashed") return;
    this.ship.state = "crashed";
    this.ship.explodeT = 0;
    this.combatThreatUntilMs = 0;
    this._setCombatActive(false);
    this._setThrustLoopActive(false);
    this._playSfx("ship_crash", { volume: 0.9 });
    this.lastAimWorld = null;
    this.lastAimScreen = null;
    const pieces = 10;
    for (let i = 0; i < pieces; i++){
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2.5;
      this.debris.push({
        x: this.ship.x + Math.cos(ang) * 0.1,
        y: this.ship.y + Math.sin(ang) * 0.1,
        vx: this.ship.vx + Math.cos(ang) * sp,
        vy: this.ship.vy + Math.sin(ang) * sp,
        a: Math.random() * Math.PI * 2,
        w: (Math.random() - 0.5) * 4,
        life: 2.5 + Math.random() * 1.5,
      });
    }
    this.minersDead += this.ship.dropshipMiners;
    this.minersDead += this.ship.dropshipPilots;
    this.minersDead += this.ship.dropshipEngineers;
    this.ship.dropshipMiners = 0;
    this.ship.dropshipPilots = 0;
    this.ship.dropshipEngineers = 0;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  _damageShip(x, y){
    if (this.ship.state === "crashed") return;
    if (this.ship.hitCooldown > 0) return;
    this._markCombatThreat();
    this._triggerCombatImmediate();
    this.ship.hpCur = Math.max(0, this.ship.hpCur - 1);
    this.ship.hitCooldown = GAME.SHIP_HIT_COOLDOWN;
    this._playSfx("ship_hit", { volume: 0.8 });
    this.entityExplosions.push({ x, y, life: 0.5, radius: this.SHIP_HIT_BLAST });
    this.shipHitPopups.push({
      x: this.ship.x,
      y: this.ship.y,
      vx: 0,
      vy: 0,
      life: GAME.SHIP_HIT_POPUP_LIFE,
    });
    if (this.ship.hpCur <= 0){
      this._triggerCrash();
    }
  }

  /**
   * @param {{x:number,y:number,hitT?:number}} enemy
   * @returns {void}
   */
  _applyEnemyHitFeedback(enemy){
    enemy.hitT = 0.25;
    this.entityExplosions.push({
      x: enemy.x,
      y: enemy.y,
      life: this.NONLETHAL_HIT_FLASH_LIFE,
      radius: this.ENEMY_HIT_BLAST,
    });
  }

  /**
   * @param {{x:number,y:number,hp:number,hitT?:number}} enemy
   * @param {number} amount
   * @returns {void}
   */
  _damageEnemy(enemy, amount){
    if (!enemy || enemy.hp <= 0) return;
    const dmg = Math.max(0, amount || 0);
    if (dmg <= 0) return;
    enemy.hp = Math.max(0, enemy.hp - dmg);
    if (enemy.hp > 0){
      this._applyEnemyHitFeedback(enemy);
    }
  }

  /**
   * @param {{x:number,y:number,hp:number,stunT?:number,hitT?:number}} enemy
   * @param {number} duration
   * @returns {void}
   */
  _stunEnemy(enemy, duration){
    if (!enemy || enemy.hp <= 0) return;
    enemy.stunT = Math.max(0.1, duration || 0);
    this._applyEnemyHitFeedback(enemy);
  }

  /**
   * @param {{type?:string,x:number,y:number,vx?:number,vy?:number}} enemy
   * @returns {void}
   */
  _handleEnemyDestroyed(enemy){
    this._playSfx("enemy_destroyed", { volume: 0.8 });
    if (!enemy || enemy.type !== "crawler"){
      return;
    }
    this._applyCrawlerDeathBlast(enemy);
  }

  /**
   * @param {{x:number,y:number,vx?:number,vy?:number}} enemy
   * @returns {void}
   */
  _applyCrawlerDeathBlast(enemy){
    const x = enemy.x;
    const y = enemy.y;
    this.entityExplosions.push({
      x,
      y,
      life: this.CRAWLER_DEATH_FLASH_LIFE,
      radius: this.CRAWLER_DEATH_BLAST,
    });
    this._spawnDebrisBurst(x, y, {
      pieces: 10,
      speedMin: 1.2,
      speedMax: 2.2,
      lifeMin: 0.75,
      lifeMax: 0.65,
      offset: 0.1,
      spin: 7,
      baseVx: enemy.vx || 0,
      baseVy: enemy.vy || 0,
    });
    this._applyCrawlerBlastDamage(x, y, this.CRAWLER_DEATH_BLAST, enemy);
    this._applyCrawlerTerrainImpact(x, y);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {{x:number,y:number}|null|undefined} sourceEnemy
   * @returns {void}
   */
  _applyCrawlerBlastDamage(x, y, radius, sourceEnemy){
    const r2 = radius * radius;
    for (let j = this.enemies.enemies.length - 1; j >= 0; j--){
      const e = this.enemies.enemies[j];
      if (!e || e === sourceEnemy || e.hp <= 0) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy > r2) continue;
      e.hp = Math.max(0, e.hp - this.CRAWLER_DEATH_DAMAGE);
      if (e.hp > 0){
        this._applyEnemyHitFeedback(e);
      }
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  _applyCrawlerTerrainImpact(x, y){
    const cfg = this.planet ? this.planet.getPlanetConfig() : null;
    if (cfg && cfg.flags && cfg.flags.disableTerrainDestruction) return;
    const newAir = this.planet.applyAirEdit(x, y, this.CRAWLER_TERRAIN_BLAST, 1);
    if (newAir) this.renderer.updateAir(newAir);
  }

  /**
   * @param {{x:number,y:number,scale?:number,hitT?:number}} factory
   * @returns {void}
   */
  _applyFactoryHitFeedback(factory){
    factory.hitT = this.FACTORY_HIT_FLASH_T;
    this.entityExplosions.push({
      x: factory.x,
      y: factory.y,
      life: this.NONLETHAL_HIT_FLASH_LIFE,
      radius: 0.4 * (factory.scale || 1),
    });
  }

  /**
   * @param {string} id
   * @param {{volume?:number,rate?:number}} [opts]
   * @returns {void}
   */
  _playSfx(id, opts){
    if (!this.audio || typeof this.audio.playSfx !== "function") return;
    this.audio.playSfx(id, opts);
  }

  /**
   * @param {string} text
   * @param {number} [duration]
   * @returns {void}
   */
  _showStatusCue(text, duration = 1.5){
    this.statusCueText = text || "";
    this.statusCueUntil = performance.now() + Math.max(0.1, duration) * 1000;
  }

  /**
   * @param {boolean} active
   * @returns {void}
   */
  _setThrustLoopActive(active){
    if (!this.audio || typeof this.audio.setThrustLoopActive !== "function") return;
    this.audio.setThrustLoopActive(active);
  }

  /**
   * @param {boolean} active
   * @returns {void}
   */
  _setCombatActive(active){
    if (!this.audio || typeof this.audio.setCombatActive !== "function") return;
    this.audio.setCombatActive(active);
  }

  /**
   * @param {number} [holdMs]
   * @returns {void}
   */
  _markCombatThreat(holdMs){
    const hold = Number.isFinite(holdMs) ? holdMs : this.COMBAT_THREAT_HOLD_MS;
    const now = performance.now();
    this.combatThreatUntilMs = Math.max(this.combatThreatUntilMs, now + Math.max(0, hold));
  }

  /**
   * @returns {void}
   */
  _triggerCombatImmediate(){
    if (this.ship.state === "crashed") return;
    if (this._objectiveComplete()) return;
    if (!this.audio || typeof this.audio.triggerCombatImmediate !== "function") return;
    this.audio.triggerCombatImmediate();
  }

  /**
   * @returns {void}
   */
  _triggerVictoryMusic(){
    if (!this.audio || typeof this.audio.triggerVictoryMusic !== "function") return;
    this.audio.triggerVictoryMusic();
  }

  /**
   * @param {{x:number,y:number}|null|undefined} aim
   * @returns {{x:number,y:number}|null}
   */
  _toWorldFromAim(aim){
    if (!aim) return null;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const xN = aim.x * 2 - 1;
    const yN = (1 - aim.y) * 2 - 1;
    const viewState = this._viewState();
    const camRot = viewState.angle;
    const s = 1 / viewState.radius;
    const aspect = w / h;
    const sx = s / aspect;
    const sy = s;
    const px = xN / sx;
    const py = yN / sy;
    const c = Math.cos(-camRot), s2 = Math.sin(-camRot);
    const wx = c * px - s2 * py + viewState.xCenter;
    const wy = s2 * px + c * py + viewState.yCenter;
    return { x: wx, y: wy };
  }

  /**
   * @param {number} aspect
   * @returns {{xCenter:number,yCenter:number,c:number,s:number,sx:number,sy:number}}
   */
  _screenTransform(aspect){
    const viewState = this._viewState();
    const camRot = viewState.angle;
    const s = 1 / viewState.radius;
    return {
      xCenter: viewState.xCenter,
      yCenter: viewState.yCenter,
      c: Math.cos(camRot),
      s: Math.sin(camRot),
      sx: s / aspect,
      sy: s,
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{xCenter:number,yCenter:number,c:number,s:number,sx:number,sy:number}} t
   * @returns {{x:number,y:number}}
   */
  _worldToScreenNorm(x, y, t){
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
   * @returns {{x:number,y:number}|null}
   */
  _aimScreenAroundShip(aim){
    if (!aim) return null;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const aspect = w / h;
    const t = this._screenTransform(aspect);
    const ship = this._worldToScreenNorm(this.ship.x, this.ship.y, t);
    const ox = aim.x - 0.5;
    const oy = aim.y - 0.5;
    return {
      x: ship.x + ox,
      y: ship.y + oy,
    };
  }

  /**
   * @param {number} screenFrac
   * @returns {number}
   */
  _aimWorldDistance(screenFrac){
    const s = GAME.PLANETSIDE_ZOOM / (this.planetParams.RMAX + this.planetParams.PAD);
    return (2 * screenFrac) / s;
  }

  /**
   * Seed a stable default reticle ahead of the ship when no pointer/stick aim exists.
   * @returns {{x:number,y:number}|null}
   */
  _defaultAimScreenFromShip(){
    const r = Math.hypot(this.ship.x, this.ship.y) || 1;
    const upx = this.ship.x / r;
    const upy = this.ship.y / r;
    const rightx = upy;
    const righty = -upx;
    const side = this.ship.cabinSide || 1;
    const dirx = rightx * side;
    const diry = righty * side;
    const gunOrigin = this._shipGunPivotWorld();
    const aimLen = Math.max(4.0, this._aimWorldDistance(GAME.AIM_SCREEN_RADIUS || 0.25));
    const aimWorldX = gunOrigin.x + dirx * aimLen;
    const aimWorldY = gunOrigin.y + diry * aimLen;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const screen = this._worldToScreenNorm(aimWorldX, aimWorldY, this._screenTransform(w / h));
    return {
      x: Math.max(0, Math.min(1, screen.x)),
      y: Math.max(0, Math.min(1, screen.y)),
    };
  }

  /**
   * @returns {number}
   */
  _manualZoomMinMultiplier(){
    return 0.35;
  }

  /**
   * @returns {number}
   */
  _manualZoomMaxMultiplier(){
    return 4.0;
  }

  /**
   * @returns {number}
   */
  _currentZoomMultiplier(){
    if (!this.manualZoomActive) return 1;
    const minMul = this._manualZoomMinMultiplier();
    const maxMul = this._manualZoomMaxMultiplier();
    const raw = Number.isFinite(this.manualZoomMultiplier) ? this.manualZoomMultiplier : 1;
    return Math.max(minMul, Math.min(maxMul, raw));
  }

  /**
   * @returns {void}
   */
  _resetManualZoom(){
    this.manualZoomActive = false;
    this.manualZoomMultiplier = 1;
  }

  /**
   * @returns {void}
   */
  _showZoomCue(){
    this._showStatusCue(`Zoom ${this._currentZoomMultiplier().toFixed(2)}x`, 1.0);
  }

  /**
   * @param {number} delta
   * @returns {void}
   */
  _applyManualZoomDelta(delta){
    if (!Number.isFinite(delta) || Math.abs(delta) < 1e-4) return;
    if (this.planetView) return;
    if (!this.manualZoomActive){
      this.manualZoomActive = true;
    }
    const step = Math.max(-6, Math.min(6, delta));
    const factor = Math.pow(1.1, step);
    const minMul = this._manualZoomMinMultiplier();
    const maxMul = this._manualZoomMaxMultiplier();
    const nextMul = Math.max(minMul, Math.min(maxMul, this.manualZoomMultiplier / factor));
    if (Math.abs(nextMul - 1) <= 0.02){
      this._resetManualZoom();
      this._showZoomCue();
      return;
    }
    this.manualZoomMultiplier = nextMul;
    this._showZoomCue();
  }

  /**
   * @returns {ViewState}
   */
  _autoViewState() {
    if (this.planetView){
      return {
        xCenter: 0,
        yCenter: 0,
        radius: (this.planet.planetRadius + CFG.PAD) * 1.05,
        angle: 0,
      };
    }

    const radiusViewMin = GAME.PLANETSIDE_ZOOM;
    const rShip = Math.hypot(this.ship.x, this.ship.y);
    const rPlanet = this.planetParams.RMAX + this.planetParams.PAD;

    let uTransition = Math.max(0, Math.min(1, (rShip - rPlanet) / rPlanet));
    uTransition = (3.0 - 2.0 * uTransition) * uTransition * uTransition;
    const rFramedMin = (rShip - radiusViewMin) + (-rPlanet - (rShip - radiusViewMin)) * uTransition;
    const rFramedMax = rShip + radiusViewMin;

    const rViewCenter = (rFramedMin + rFramedMax) / 2;

    const scale = rViewCenter / rShip;
    const posViewCenterX = scale * this.ship.x;
    const posViewCenterY = scale * this.ship.y;
    const radiusView = (rFramedMax - rFramedMin) / 2;

    const view = {
      xCenter: posViewCenterX,
      yCenter: posViewCenterY,
      radius: radiusView,
      angle: Math.atan2(this.ship.x, this.ship.y || 1e-6)
    };
    if (this.mothership){
      const dx = this.ship.x - this.mothership.x;
      const dy = this.ship.y - this.mothership.y;
      const d = Math.hypot(dx, dy);
      let t = Math.max(0, Math.min(1, (12 - d) / 8));
      t = (3 - 2 * t) * t * t;
      view.xCenter = view.xCenter * (1 - t) + this.ship.x * t;
      view.yCenter = view.yCenter * (1 - t) + this.ship.y * t;
      view.radius = radiusView * (1 - t) + GAME.MOTHERSHIP_ZOOM * t;
    }
    if (this.coreMeltdownActive && !this._isDockedWithMothership()){
      const t = (this.lastTime || performance.now()) * 0.001;
      const progress = Math.max(0, Math.min(1, this.coreMeltdownT / Math.max(0.001, this.coreMeltdownDuration)));
      const amp = 0.035 + 0.085 * progress;
      view.xCenter += Math.sin(t * 24.7) * amp + Math.sin(t * 41.3) * amp * 0.45;
      view.yCenter += Math.cos(t * 19.9) * amp + Math.cos(t * 37.1) * amp * 0.45;
    }
    return view;
  }

  /**
   * @returns {ViewState}
   */
  _viewState() {
    const view = this._autoViewState();
    if (!this.manualZoomActive || this.planetView) return view;
    const zoomMul = this._currentZoomMultiplier();
    const baseRadius = Math.max(1e-6, view.radius);
    const radiusScaled = baseRadius / zoomMul;
    const ratio = radiusScaled / baseRadius;
    // Apply wheel zoom around the ship so auto-framing offsets do not shift unpredictably.
    view.xCenter = this.ship.x + (view.xCenter - this.ship.x) * ratio;
    view.yCenter = this.ship.y + (view.yCenter - this.ship.y) * ratio;
    view.radius = radiusScaled;
    return view;
  }

  /**
   * @returns {{rockDark:[number,number,number],rockLight:[number,number,number],airDark:[number,number,number],airLight:[number,number,number],surfaceRockDark:[number,number,number],surfaceRockLight:[number,number,number],surfaceBand:number}}
   */
  _planetPalette(){
    const cfg = this.planet ? this.planet.getPlanetConfig() : null;
    const def = (cfg && cfg.defaults) ? cfg.defaults : null;
    if (!def){
      return {
        rockDark: /** @type {[number,number,number]} */ (CFG.ROCK_DARK),
        rockLight: /** @type {[number,number,number]} */ (CFG.ROCK_LIGHT),
        airDark: /** @type {[number,number,number]} */ (CFG.AIR_DARK),
        airLight: /** @type {[number,number,number]} */ (CFG.AIR_LIGHT),
        surfaceRockDark: /** @type {[number,number,number]} */ (CFG.ROCK_DARK),
        surfaceRockLight: /** @type {[number,number,number]} */ (CFG.ROCK_LIGHT),
        surfaceBand: 0,
      };
    }
    return {
      rockDark: def.ROCK_DARK ?? /** @type {[number,number,number]} */ (CFG.ROCK_DARK),
      rockLight: def.ROCK_LIGHT ?? /** @type {[number,number,number]} */ (CFG.ROCK_LIGHT),
      airDark: def.AIR_DARK ?? /** @type {[number,number,number]} */ (CFG.AIR_DARK),
      airLight: def.AIR_LIGHT ?? /** @type {[number,number,number]} */ (CFG.AIR_LIGHT),
      surfaceRockDark: def.SURFACE_ROCK_DARK ?? def.ROCK_DARK ?? /** @type {[number,number,number]} */ (CFG.ROCK_DARK),
      surfaceRockLight: def.SURFACE_ROCK_LIGHT ?? def.ROCK_LIGHT ?? /** @type {[number,number,number]} */ (CFG.ROCK_LIGHT),
      surfaceBand: (typeof def.SURFACE_BAND === "number") ? def.SURFACE_BAND : 0,
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  _applyBombImpact(x, y){
    const cfg = this.planet ? this.planet.getPlanetConfig() : null;
    if (cfg && cfg.flags && cfg.flags.disableTerrainDestruction) return;
    const newAir = this.planet.applyAirEdit(x, y, this.TERRAIN_IMPACT_RADIUS, 1);
    if (newAir) this.renderer.updateAir(newAir);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  _applyBombDamage(x, y){
    const r2 = this.PLAYER_BOMB_DAMAGE * this.PLAYER_BOMB_DAMAGE;
    if (this.ship.state !== "crashed"){
      const dx = this.ship.x - x;
      const dy = this.ship.y - y;
      if (dx * dx + dy * dy <= r2){
        this._damageShip(x, y);
      }
    }
    for (let j = this.enemies.enemies.length - 1; j >= 0; j--){
      const e = this.enemies.enemies[j];
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= r2){
        e.hp = 0;
      }
    }
    for (let j = this.miners.length - 1; j >= 0; j--){
      const m = this.miners[j];
      const dx = m.x - x;
      const dy = m.y - y;
      if (dx * dx + dy * dy <= r2){
        this.miners.splice(j, 1);
        this.minersRemaining = Math.max(0, this.minersRemaining - 1);
        this.minersDead++;
      }
    }
    this._damageFactoriesAt(x, y, this.PLAYER_BOMB_DAMAGE, 999, true);
    this._destroyTethersAt(x, y, this.PLAYER_BOMB_DAMAGE);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {void}
   */
  _applyAreaDamage(x, y, radius){
    const r2 = radius * radius;
    if (this.ship.state !== "crashed"){
      const dx = this.ship.x - x;
      const dy = this.ship.y - y;
      if (dx * dx + dy * dy <= r2){
        this._damageShip(x, y);
      }
    }
    for (let j = this.enemies.enemies.length - 1; j >= 0; j--){
      const e = this.enemies.enemies[j];
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= r2){
        e.hp = Math.max(0, e.hp - this.ship.gunPower);
        if (e.hp > 0){
          this._applyEnemyHitFeedback(e);
        }
      }
    }
    for (let j = this.miners.length - 1; j >= 0; j--){
      const m = this.miners[j];
      const dx = m.x - x;
      const dy = m.y - y;
      if (dx * dx + dy * dy <= r2){
        this.miners.splice(j, 1);
        this.minersRemaining = Math.max(0, this.minersRemaining - 1);
        this.minersDead++;
      }
    }
  }

  /**
   * @param {{x:number,y:number,nx?:number,ny?:number}} p
   * @returns {{nx:number,ny:number,tx:number,ty:number}}
   */
  _propBasis(p){
    let nx = (typeof p.nx === "number") ? p.nx : 0;
    let ny = (typeof p.ny === "number") ? p.ny : 0;
    if (!nx && !ny){
      const r = Math.hypot(p.x, p.y) || 1;
      nx = p.x / r;
      ny = p.y / r;
    } else {
      const len = Math.hypot(nx, ny) || 1;
      nx /= len;
      ny /= len;
    }
    return { nx, ny, tx: -ny, ty: nx };
  }

  /**
   * @param {any} p
   * @returns {number}
   */
  _factoryHitRadius(p){
    const s = p && p.scale ? p.scale : 1;
    return 0.42 * s;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{
   *  pieces?:number,
   *  speedMin?:number,
   *  speedMax?:number,
   *  lifeMin?:number,
   *  lifeMax?:number,
   *  offset?:number,
   *  spin?:number,
   *  baseVx?:number,
   *  baseVy?:number,
   * }} [opts]
   * @returns {void}
   */
  _spawnDebrisBurst(x, y, opts){
    const pieces = (opts && typeof opts.pieces === "number") ? Math.max(1, opts.pieces | 0) : 6;
    const speedMin = (opts && typeof opts.speedMin === "number") ? opts.speedMin : 1.0;
    const speedMax = (opts && typeof opts.speedMax === "number") ? opts.speedMax : 2.0;
    const lifeMin = (opts && typeof opts.lifeMin === "number") ? opts.lifeMin : 0.9;
    const lifeMax = (opts && typeof opts.lifeMax === "number") ? opts.lifeMax : 0.8;
    const offset = (opts && typeof opts.offset === "number") ? opts.offset : 0.08;
    const spin = (opts && typeof opts.spin === "number") ? opts.spin : 6;
    const baseVx = (opts && typeof opts.baseVx === "number") ? opts.baseVx : 0;
    const baseVy = (opts && typeof opts.baseVy === "number") ? opts.baseVy : 0;
    for (let i = 0; i < pieces; i++){
      const ang = Math.random() * Math.PI * 2;
      const sp = speedMin + Math.random() * speedMax;
      this.debris.push({
        x: x + Math.cos(ang) * offset,
        y: y + Math.sin(ang) * offset,
        vx: baseVx + Math.cos(ang) * sp,
        vy: baseVy + Math.sin(ang) * sp,
        a: Math.random() * Math.PI * 2,
        w: (Math.random() - 0.5) * spin,
        life: lifeMin + Math.random() * lifeMax,
      });
    }
  }

  /**
   * @param {any} p
   * @returns {void}
   */
  _destroyFactoryProp(p){
    if (!p || p.dead) return;
    p.hp = 0;
    p.dead = true;
    const s = p.scale || 1;
    this.entityExplosions.push({ x: p.x, y: p.y, life: 0.65, radius: 0.95 * s });
    this._spawnDebrisBurst(p.x, p.y, {
      pieces: 9,
      speedMin: 0.95,
      speedMax: 1.8,
      lifeMin: 0.8,
      lifeMax: 0.7,
      offset: 0.1 * s,
      spin: 7,
    });
    this._playSfx("enemy_destroyed", {
      volume: 0.78,
      rate: 0.85 + Math.random() * 0.14,
    });
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {number} damage
   * @param {boolean} forceKill
   * @returns {boolean}
   */
  _damageFactoriesAt(x, y, radius, damage = 1, forceKill = false){
    if (!this._isMechanizedLevel()) return false;
    return this._damageFactoryPropsAt(this._factoryPropsAlive(), x, y, radius, damage, forceKill);
  }

  /**
   * @param {Array<any>|null|undefined} factories
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {number} damage
   * @param {boolean} forceKill
   * @returns {boolean}
   */
  _damageFactoryPropsAt(factories, x, y, radius, damage = 1, forceKill = false){
    if (!factories || !factories.length) return false;
    let hit = false;
    let factoryDestroyed = false;
    for (const p of factories){
      if (!p || p.type !== "factory") continue;
      if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
      const rr = radius + this._factoryHitRadius(p);
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy > rr * rr) continue;
      hit = true;
      if (forceKill){
        p.hp = 0;
      } else {
        const cur = (typeof p.hp === "number") ? p.hp : 5;
        p.hp = Math.max(0, cur - Math.max(0.1, damage));
      }
      if ((p.hp || 0) <= 0){
        this._destroyFactoryProp(p);
        factoryDestroyed = true;
      } else {
        this._applyFactoryHitFeedback(p);
      }
    }
    if (factoryDestroyed){
      this._syncTetherProtectionStates();
    }
    return hit;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {boolean}
   */
  _destroyTethersAt(x, y, radius){
    if (!this._isMechanizedCoreLevel()) return false;
    const tethers = this._tetherPropsAlive();
    if (!tethers.length) return false;
    let destroyed = false;
    for (const t of tethers){
      if (!this._isTetherUnlocked(t)) continue;
      if (!this._solidPropPenetration(t, x, y, radius)) continue;
      t.dead = true;
      t.hp = 0;
      destroyed = true;
      const blastR = Math.max(0.5, (typeof t.halfLength === "number" ? t.halfLength : 0.9) * 0.35);
      this.entityExplosions.push({ x: t.x, y: t.y, life: 0.75, radius: blastR });
    }
    if (destroyed && this._tetherPropsAlive().length <= 0){
      this._startCoreMeltdown();
    }
    return destroyed;
  }

  /**
   * @returns {boolean}
   */
  _heatMechanicsActive(){
    const cfg = this.planet && this.planet.getPlanetConfig ? this.planet.getPlanetConfig() : null;
    if (!cfg) return false;
    if (cfg.id === "molten") return true;
    return this._isMechanizedCoreLevel();
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {void}
   */
  _applyMeltdownAirEdit(x, y, radius){
    if (!this.planet || !this.renderer) return;
    const newAir = this.planet.applyAirEdit(x, y, radius, 1);
    if (newAir) this.renderer.updateAir(newAir);
  }

  /**
   * @returns {void}
   */
  _startCoreMeltdown(){
    if (this.coreMeltdownActive) return;
    this.coreMeltdownActive = true;
    this.coreMeltdownT = 0;
    this.coreMeltdownEruptT = 0;
    this._syncTetherProtectionStates();
    const coreR = this.planet && this.planet.getCoreRadius ? this.planet.getCoreRadius() : 0;
    this.entityExplosions.push({ x: 0, y: 0, life: 1.2, radius: Math.max(1.5, coreR * 0.6) });
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  _updateCoreMeltdown(dt){
    if (!this.coreMeltdownActive) return;
    const coreR = this.planet && this.planet.getCoreRadius ? this.planet.getCoreRadius() : 0;
    if (coreR <= 0) return;
    this.coreMeltdownT += dt;
    const progress = Math.max(0, Math.min(1, this.coreMeltdownT / Math.max(0.001, this.coreMeltdownDuration)));
    const featureParticles = this.planet && this.planet.getFeatureParticles ? this.planet.getFeatureParticles() : null;
    const lava = featureParticles && featureParticles.lava ? featureParticles.lava : null;
    if (lava){
      const rate = 10 + 24 * progress;
      const emitBase = rate * dt;
      const emitWhole = Math.floor(emitBase);
      const emitCount = emitWhole + (Math.random() < (emitBase - emitWhole) ? 1 : 0);
      for (let i = 0; i < emitCount; i++){
        const ang = Math.random() * Math.PI * 2;
        const nx = Math.cos(ang);
        const ny = Math.sin(ang);
        const tx = -ny;
        const ty = nx;
        const spread = (Math.random() * 2 - 1) * (0.22 + progress * 0.28);
        const speed = 2.2 + progress * 3.8 + Math.random() * 1.2;
        lava.push({
          x: nx * (coreR + 0.15),
          y: ny * (coreR + 0.15),
          vx: (nx + tx * spread) * speed,
          vy: (ny + ty * spread) * speed,
          life: 1.0 + Math.random() * 0.8,
        });
      }
    }

    this.coreMeltdownEruptT -= dt;
    if (this.coreMeltdownEruptT <= 0){
      this.coreMeltdownEruptT = Math.max(0.18, 0.95 - progress * 0.7);
      const maxReach = coreR + 1 + progress * Math.max(1.2, this.planetParams.RMAX - coreR - 0.8);
      const burstCount = 1 + ((Math.random() < (0.5 + progress * 0.35)) ? 1 : 0);
      for (let b = 0; b < burstCount; b++){
        const ang = Math.random() * Math.PI * 2;
        const nx = Math.cos(ang);
        const ny = Math.sin(ang);
        const reach = coreR + 0.65 + Math.random() * Math.max(0.25, maxReach - coreR - 0.65);
        const segments = 2 + Math.floor(progress * 5);
        for (let s = 0; s < segments; s++){
          const t = segments <= 1 ? 1 : (s / (segments - 1));
          const r = coreR + 0.55 + (reach - coreR - 0.55) * t;
          const x = nx * r;
          const y = ny * r;
          const carveR = 0.45 + progress * 1.0 + Math.random() * 0.25;
          this._applyMeltdownAirEdit(x, y, carveR);
          this.entityExplosions.push({ x, y, life: 0.45 + progress * 0.4, radius: carveR * 0.85 });
        }
      }
    }

    if (this.coreMeltdownT >= this.coreMeltdownDuration && !this._isDockedWithMothership() && this.ship.state !== "crashed"){
      this._triggerCrash();
    }
  }

  /**
   * @param {any} factory
   * @returns {boolean}
   */
  _spawnEnemyFromFactory(factory){
    if (!factory || factory.dead || (factory.hp || 0) <= 0) return false;
    if (!this.enemies || !this.enemies.enemies) return false;
    const cfg = this.planet && this.planet.getPlanetConfig ? this.planet.getPlanetConfig() : null;
    const maxEnemies = (cfg && typeof cfg.enemyCountCap === "number") ? Math.max(0, cfg.enemyCountCap | 0) : 30;
    if (this._remainingCombatEnemies() >= maxEnemies) return false;
    const allow = (cfg && cfg.enemyAllow) ? cfg.enemyAllow : [];
    const pool = allow.filter((t) => t === "hunter" || t === "ranger" || t === "crawler");
    const type = pool.length ? pool[Math.floor(Math.random() * pool.length)] : "hunter";
    const { nx, ny, tx, ty } = this._propBasis(factory);
    const s = factory.scale || 1;
    let x = factory.x + nx * (0.58 * s + 0.28);
    let y = factory.y + ny * (0.58 * s + 0.28);
    x += tx * ((Math.random() * 2 - 1) * 0.16);
    y += ty * ((Math.random() * 2 - 1) * 0.16);
    if (this.collision.airValueAtWorld(x, y) <= 0.5){
      const nudge = this.planet.nudgeOutOfTerrain(x, y, 0.9, 0.08, 0.18);
      if (!nudge.ok) return false;
      x = nudge.x;
      y = nudge.y;
      if (this.collision.airValueAtWorld(x, y) <= 0.5) return false;
    }
    const cooldown = Math.random();
    if (type === "hunter"){
      this.enemies.enemies.push({ type, x, y, vx: 0, vy: 0, cooldown, hp: 3, iNodeGoal: null });
    } else if (type === "ranger"){
      this.enemies.enemies.push({ type, x, y, vx: 0, vy: 0, cooldown, hp: 2, iNodeGoal: null });
    } else {
      const ang = Math.random() * Math.PI * 2;
      const speed = Math.min(3, this.level * 0.25 + 0.5);
      this.enemies.enemies.push({ type: "crawler", x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, cooldown: 0, hp: 1, iNodeGoal: null });
    }
    if (this.objective && this.objective.type === "clear"){
      this.clearObjectiveTotal = Math.max(this.clearObjectiveTotal || 0, this._remainingClearTargets()) + 1;
      this.objective.target = this.clearObjectiveTotal;
    }
    this.entityExplosions.push({ x, y, life: 0.35, radius: 0.45 });
    return true;
  }

  /**
   * @param {number} dt
   * @returns {void}
   */
  _updateFactorySpawns(dt){
    if (!this._isMechanizedLevel()) return;
    const factories = this._factoryPropsAlive();
    if (!factories.length) return;
    for (const p of factories){
      p.spawnCd = (typeof p.spawnCd === "number" && p.spawnCd > 0) ? p.spawnCd : (6.5 + Math.random() * 4.0);
      p.spawnT = (typeof p.spawnT === "number") ? (p.spawnT + dt) : (Math.random() * p.spawnCd);
      if (p.spawnT < p.spawnCd) continue;
      p.spawnT -= p.spawnCd;
      p.spawnCd = 6.5 + Math.random() * 4.0;
      this._spawnEnemyFromFactory(p);
    }
  }

  /**
   * @param {any} p
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {{nx:number,ny:number,depth:number}|null}
   */
  _solidPropPenetration(p, x, y, radius){
    if (!p || p.dead) return null;
    if (p.type !== "gate" && p.type !== "factory" && p.type !== "tether") return null;
    const { nx, ny, tx, ty } = this._propBasis(p);
    const dx = x - p.x;
    const dy = y - p.y;
    const lx = dx * tx + dy * ty;
    const ly = dx * nx + dy * ny;
    const s = p.scale || 1;
    const halfW = (p.type === "gate")
      ? (0.62 * s)
      : (p.type === "factory")
        ? (0.45 * s)
        : ((typeof p.halfWidth === "number" ? p.halfWidth : 0.12) * s);
    const halfN = (p.type === "gate")
      ? (0.12 * s)
      : (p.type === "factory")
        ? (0.20 * s)
        : ((typeof p.halfLength === "number" ? p.halfLength : 0.9) * s);
    const overX = (halfW + radius) - Math.abs(lx);
    const overY = (halfN + radius) - Math.abs(ly);
    if (overX <= 0 || overY <= 0) return null;
    const sign = (ly >= 0) ? 1 : -1;
    return { nx: nx * sign, ny: ny * sign, depth: overY };
  }

  /**
   * @returns {void}
   */
  _resolveShipSolidPropCollisions(){
    if (!this._isMechanizedLevel()) return;
    if (!this.planet || !this.planet.props || !this.planet.props.length) return;
    if (this.ship.state === "crashed") return;
    const radius = this._shipRadius();
    for (const p of this.planet.props){
      const hit = this._solidPropPenetration(p, this.ship.x, this.ship.y, radius);
      if (!hit) continue;
      this.ship.x += hit.nx * (hit.depth + 0.01);
      this.ship.y += hit.ny * (hit.depth + 0.01);
      const vn = this.ship.vx * hit.nx + this.ship.vy * hit.ny;
      if (vn < 0){
        this.ship.vx -= hit.nx * vn;
        this.ship.vy -= hit.ny * vn;
      }
    }
  }

  /**
   * @returns {void}
   */
  _resolveEnemySolidPropCollisions(){
    if (!this._isMechanizedLevel()) return;
    if (!this.planet || !this.planet.props || !this.planet.props.length) return;
    if (!this.enemies || !this.enemies.enemies || !this.enemies.enemies.length) return;
    const radius = 0.24 * GAME.ENEMY_SCALE;
    for (const e of this.enemies.enemies){
      for (const p of this.planet.props){
        const hit = this._solidPropPenetration(p, e.x, e.y, radius);
        if (!hit) continue;
        e.x += hit.nx * (hit.depth + 0.01);
        e.y += hit.ny * (hit.depth + 0.01);
        const vn = e.vx * hit.nx + e.vy * hit.ny;
        if (vn < 0){
          e.vx -= hit.nx * vn;
          e.vy -= hit.ny * vn;
        }
      }
    }
  }

  /**
   * @param {{x:number,y:number,scale:number}|null} info
   * @returns {void}
   */

  /**
   * @returns {void}
   */
  _spawnMiners(){
    const cfg = this.planet ? this.planet.getPlanetConfig() : null;
    const base = (cfg && typeof cfg.minerCountBase === "number") ? cfg.minerCountBase : 0;
    const per = (cfg && typeof cfg.minerCountPerLevel === "number") ? cfg.minerCountPerLevel : 0;
    const cap = (cfg && typeof cfg.minerCountCap === "number") ? cfg.minerCountCap : 0;
    const count = Math.min(cap, base + Math.max(0, this.level - 1) * per);
    const seed = this.planet.getSeed() + this.level * 97;
    const barrenPerimeter = !!(cfg && cfg.flags && cfg.flags.barrenPerimeter);
    let placed;
    if (barrenPerimeter){
      /** @type {Array<[number, number]>} */
      const pads = [];
      for (const p of (this.planet.props || [])){
        if (p.type === "turret_pad" && !p.dead) pads.push([p.x, p.y]);
      }
      const rand = mulberry32(seed + 17);
      placed = [];
      /** @type {number[]} */
      const shuffledPadIndices = pads.map((_, i) => i);
      for (let i = shuffledPadIndices.length - 1; i > 0; i--){
        const j = Math.floor(rand() * (i + 1));
        const tmp = shuffledPadIndices[i];
        shuffledPadIndices[i] = shuffledPadIndices[j];
        shuffledPadIndices[j] = tmp;
      }
      /** @type {Map<number, Array<{type:string,x:number,y:number}>>} */
      const turretsByPad = new Map();
      if (this.enemies && this.enemies.enemies && pads.length){
        const padOccupancyRadius = 0.48;
        const padOccupancyRadiusSq = padOccupancyRadius * padOccupancyRadius;
        for (const e of this.enemies.enemies){
          if (e.type !== "turret") continue;
          let nearestPad = -1;
          let nearestPadDistSq = Infinity;
          for (let i = 0; i < pads.length; i++){
            const pt = pads[i];
            const dx = e.x - pt[0];
            const dy = e.y - pt[1];
            const d2 = dx * dx + dy * dy;
            if (d2 < nearestPadDistSq){
              nearestPadDistSq = d2;
              nearestPad = i;
            }
          }
          if (nearestPad < 0 || nearestPadDistSq > padOccupancyRadiusSq) continue;
          if (!turretsByPad.has(nearestPad)) turretsByPad.set(nearestPad, []);
          turretsByPad.get(nearestPad).push(e);
        }
      }
      /** @type {Set<{type:string,x:number,y:number}>} */
      const turretsToRemove = new Set();
      for (const i of shuffledPadIndices){
        if (placed.length >= count) break;
        if (turretsByPad.has(i)) continue;
        placed.push(pads[i]);
      }
      // Miner priority: reclaim occupied pads from turrets when pad supply is tight.
      if (placed.length < count){
        for (const i of shuffledPadIndices){
          if (placed.length >= count) break;
          const turrets = turretsByPad.get(i);
          if (!turrets || !turrets.length) continue;
          for (const t of turrets){
            turretsToRemove.add(t);
          }
          placed.push(pads[i]);
          turretsByPad.delete(i);
        }
      }
      if (turretsToRemove.size && this.enemies && this.enemies.enemies){
        this.enemies.enemies = this.enemies.enemies.filter((e) => !turretsToRemove.has(e));
        if (this.objective && this.objective.type === "clear"){
          const remaining = this._remainingClearTargets();
          this.clearObjectiveTotal = remaining;
          this.objective.target = remaining;
        }
      }
      if (placed.length < count){
        const extras = this.planet.sampleStandablePoints(
          Math.max(count * 2, count),
          seed + 71,
          "uniform",
          GAME.MINER_MIN_SEP,
          false
        );
        for (const pt of extras){
          if (placed.length >= count) break;
          let exists = false;
          for (const q of placed){
            const dx = pt[0] - q[0];
            const dy = pt[1] - q[1];
            if (dx * dx + dy * dy < 1e-6){
              exists = true;
              break;
            }
          }
          if (exists) continue;
          placed.push(pt);
        }
      }
    } else {
      const standable = this.planet.getStandablePoints();
      if (cfg && cfg.id === "molten"){
        const moltenOuter = this.planetParams.MOLTEN_RING_OUTER || 0;
        const minR = moltenOuter + 0.6;
        placed = this.planet.sampleStandablePointsMinRadius
          ? this.planet.sampleStandablePointsMinRadius(count, seed, "uniform", GAME.MINER_MIN_SEP, true, minR)
          : this.planet.sampleStandablePoints(count, seed, "uniform", GAME.MINER_MIN_SEP, true)
            .filter((p) => (Math.hypot(p[0], p[1]) >= minR));
      } else {
        placed = this.planet.sampleStandablePoints(count, seed, "uniform", GAME.MINER_MIN_SEP, true);
      }
      if (placed.length < count){
        const availability = this.planet.debugAvailableStandableCount
          ? this.planet.debugAvailableStandableCount(GAME.MINER_MIN_SEP)
          : { standable: standable.length, available: standable.length, reservations: 0 };
        const propCounts = this.planet.debugPropCounts ? this.planet.debugPropCounts() : null;
        console.error("[Level] miners spawn insufficient standable points", {
          level: this.level,
          target: count,
          placed: placed.length,
          standable: standable.length,
          available: availability.available,
          reservations: availability.reservations,
          props: propCounts,
          moltenFiltered: 0,
        });
      }
    }
    console.log("[Level] miners spawn", { level: this.level, target: count, placed: placed.length });
    this.minerCandidates = placed.length;
    const cutoffPilot = (this.ship.mothershipPilots < 3) ? 1 : 0;
    const cutoffEngineer = cutoffPilot + 1;
    /** @type {Array<Miner>} */
    const nudged = [];
    for (const p of placed){
      const minerType =
        (nudged.length < cutoffPilot) ? "pilot" :
        (nudged.length < cutoffEngineer) ? "engineer" :
        "miner";
      if (barrenPerimeter){
        let x = p[0];
        let y = p[1];
        const info = this.planet.surfaceInfoAtWorld(x, y, 0.18);
        if (info){
          x += info.nx * 0.02;
          y += info.ny * 0.02;
        }
        nudged.push({ x, y, jumpCycle: Math.random(), type: minerType, state: "idle" });
      } else {
        const res = this.planet.nudgeOutOfTerrain(p[0], p[1]);
        if (!res.ok){
          continue;
        }
        nudged.push({ x: res.x, y: res.y, jumpCycle: Math.random(), type: minerType, state: "idle" });
      }
    }
    this.miners = nudged;
    this.minersRemaining = this.miners.length;
    const missed = Math.max(0, count - this.miners.length);
    this.minersDead = missed;
    this.minerTarget = count;
  }

  /**
   * @param {PlanetConfig} base
   * @param {{planetId?:PlanetTypeId,enemyTotal?:number,enemyCap?:number,enemyAllow?:Array<"hunter"|"ranger"|"crawler"|"turret"|"orbitingTurret">,enemyAllowAdd?:Array<"hunter"|"ranger"|"crawler"|"turret"|"orbitingTurret">,orbitingTurretCount?:number,platformCount?:number}|null} progression
   * @returns {PlanetConfig}
   */
  _applyProgressionOverrides(base, progression){
    if (!progression) return base;
    /** @type {PlanetConfig} */
    const out = { ...base };
    if (typeof progression.enemyTotal === "number"){
      out.enemyCountBase = Math.max(0, Math.round(progression.enemyTotal));
      out.enemyCountPerLevel = 0;
      const cap = (typeof progression.enemyCap === "number") ? progression.enemyCap : out.enemyCountCap;
      out.enemyCountCap = Math.max(out.enemyCountBase, Math.round(Math.max(0, cap)));
    } else if (typeof progression.enemyCap === "number"){
      out.enemyCountCap = Math.max(0, Math.round(progression.enemyCap));
    }
    if (Array.isArray(progression.enemyAllow)){
      out.enemyAllow = progression.enemyAllow.slice();
    }
    if (Array.isArray(progression.enemyAllowAdd) && progression.enemyAllowAdd.length){
      const merged = new Set(out.enemyAllow || []);
      for (const type of progression.enemyAllowAdd){
        merged.add(type);
      }
      out.enemyAllow = Array.from(merged);
    }
    if (typeof progression.orbitingTurretCount === "number"){
      out.orbitingTurretCount = Math.max(0, Math.round(progression.orbitingTurretCount));
    }
    if (typeof progression.platformCount === "number"){
      out.platformCount = Math.max(1, Math.round(progression.platformCount));
    }
    return out;
  }

  /**
   * @param {number} level
   * @param {number} [progressionSeedOverride]
   * @returns {PlanetConfig}
   */
  _planetConfigFromLevel(level, progressionSeedOverride){
    const progressionSeed = Number.isFinite(progressionSeedOverride) ? +progressionSeedOverride : (this.progressionSeed || CFG.seed);
    const progression = resolveLevelProgression(progressionSeed, level);
    /** @type {PlanetTypeId|undefined} */
    const configOverride = progression ? progression.planetId : undefined;
    const planetConfig =
      (configOverride !== undefined) ? pickPlanetConfigById(configOverride) :
      pickPlanetConfig(progressionSeed, level);
    const out = this._applyProgressionOverrides(planetConfig, progression);
    // Scale barren turret-pad count with progression while guaranteeing
    // enough pads for both enemy and miner budgets on this level.
    if (out.id === "barren_pickup" || out.id === "barren_clear"){
      const basePads = Math.max(1, Math.round(out.platformCount || 1));
      const growth = Math.floor(Math.max(0, (level | 0) - 1) / 2);
      const enemyBudget = Math.max(1, this._enemyTotalForConfig(out, level));
      const minerBudget = Math.max(0, this._minerTargetForConfig(out, level));
      // Barren perimeter worlds use pads for both turrets and miner spawn points.
      // Guarantee enough pads for this level's total enemy + miner budget.
      const platformBudget = enemyBudget + minerBudget;
      out.platformCount = Math.max(basePads + growth, platformBudget);
    }
    return out;
  }

  /**
   * @param {number} seed
   * @param {number} level
   * @param {import("./types.d.js").MapWorld|null} [mapWorld]
   * @returns {{seed:number, level:number, planetConfig:PlanetConfig, planetParams:import("./planet_config.js").PlanetParams, planet:Planet, objective:any, mothership:Mothership, collision:import("./types.d.js").CollisionQuery, enemies:Enemies}}
   */
  _buildLevelBundle(seed, level, mapWorld = null){
    const planetConfig = this._planetConfigFromLevel(level, (level === 1) ? (seed | 0) : undefined);
    const planetParams = resolvePlanetParams(seed, level, planetConfig, GAME);
    const planet = new Planet({ seed, planetConfig, planetParams, mapWorld });
    const mothership = new Mothership({ RMAX: planetParams.RMAX, MOTHERSHIP_ORBIT_HEIGHT: planetParams.MOTHERSHIP_ORBIT_HEIGHT }, planet);
    const collision = createCollisionRouter(planet, () => mothership);
    const enemies = new Enemies({
      planet,
      collision,
      total: this._totalEnemiesForLevel(level),
      level,
      levelSeed: planet.getSeed(),
      placement: planetConfig.enemyPlacement || "random",
      onEnemyShot: () => {
        this._playSfx("enemy_fire", { volume: 0.55 });
        this._markCombatThreat();
        this._triggerCombatImmediate();
      },
      onEnemyDestroyed: (enemy) => {
        this._handleEnemyDestroyed(enemy);
      },
    });
    return {
      seed,
      level,
      planetConfig,
      planetParams,
      planet,
      objective: this._buildObjective(planetConfig, level),
      mothership,
      collision,
      enemies,
    };
  }

  /**
   * @param {{seed:number, level:number, planetConfig:PlanetConfig, planetParams:import("./planet_config.js").PlanetParams, planet:Planet, objective:any, mothership:Mothership, collision:import("./types.d.js").CollisionQuery, enemies:Enemies}} bundle
   * @param {number} previousLevel
   * @returns {void}
   */
  _applyLevelBundle(bundle, previousLevel){
    this.level = bundle.level;
    if (bundle.level === 1){
      this.progressionSeed = bundle.seed | 0;
    }
    this.planet = bundle.planet;
    this.planetParams = bundle.planetParams;
    this.objective = bundle.objective;
    this.TERRAIN_MAX = this.planetParams.RMAX + this.TERRAIN_PAD;
    this.SURFACE_EPS = Math.max(0.12, this.planetParams.RMAX / 280);
    this.COLLISION_EPS = Math.max(0.18, this.planetParams.RMAX / 240);
    this.mothership = bundle.mothership;
    this.collision = bundle.collision;
    this.enemies = bundle.enemies;
    console.log("[Level] begin", {
      level: this.level,
      planetId: bundle.planetConfig.id,
      enemies: this._totalEnemiesForLevel(this.level),
      miners: this._targetMinersForLevel(),
      platformCount: bundle.planetConfig.platformCount,
      props: (this.planet.props || []).length,
    });
    if (this.planet.props && this.planet.props.length){
      console.log("[Level] props sample", this.planet.props.slice(0, 3).map((p) => ({ type: p.type, x: p.x, y: p.y, dead: !!p.dead })));
    }
    this._initializeClearObjectiveTracking();
    this.coreMeltdownActive = false;
    this.coreMeltdownT = 0;
    this.coreMeltdownEruptT = 0;
    this._syncTetherProtectionStates();
    console.log("[Level] enemies spawned", { level: this.level, enemies: this.enemies.enemies.length });
    this.renderer.setPlanet(this.planet);
    this._resetShip();
    this.entityExplosions.length = 0;
    this._spawnMiners();
    this.planet.reconcileFeatures({
      enemies: this.enemies.enemies,
      miners: this.miners,
    });
    this.popups.length = 0;
    this.planet.clearFeatureParticles();

    if (this.level === 1){
      this.hasLaunchedPlayerShip = false;
      this.newGameHelpPromptT = 0;
      this.newGameHelpPromptArmed = true;
      this._resetStartTitle();
      this.manualZoomActive = false;
      this.manualZoomMultiplier = 1;
      this.ship.mothershipMiners = 0;
      this.ship.mothershipPilots = 0;
      this.ship.mothershipEngineers = 0;
      this.ship.hpMax = GAME.SHIP_STARTING_MAX_HP;
      this.ship.hpCur = GAME.SHIP_STARTING_MAX_HP;
      this.ship.bombsMax = GAME.SHIP_STARTING_MAX_BOMBS;
      this.ship.bombsCur = GAME.SHIP_STARTING_MAX_BOMBS;
      this.ship.thrust = GAME.SHIP_STARTING_THRUST;
      this.ship.gunPower = GAME.SHIP_STARTING_GUN_POWER;
      this.ship.rescueeDetector = false;
      this.ship.planetScanner = false;
      this.pendingPerkChoice = null;
      this.victoryMusicTriggered = false;
    }
    this.objectiveCompleteSfxPlayed = this._objectiveComplete();
    this.objectiveCompleteSfxDueAtMs = Number.POSITIVE_INFINITY;
    this.combatThreatUntilMs = 0;
    this._setCombatActive(false);
    if (this.audio && typeof this.audio.returnToAmbient === "function"){
      this.audio.returnToAmbient(true);
    }
    this._setThrustLoopActive(false);
    if (previousLevel !== this.level){
      this.levelAdvanceReady = false;
    }
  }

  /**
   * @param {number} seed
   * @param {number} level
   * @param {import("./types.d.js").MapWorld|null} [mapWorld]
   * @param {boolean} [keepTransition]
   * @returns {void}
   */
  _beginLevel(seed, level, mapWorld = null, keepTransition = false){
    if (!keepTransition){
      this.jumpdriveTransition.cancel();
    }
    const previousLevel = this.level;
    const bundle = this._buildLevelBundle(seed, level, mapWorld);
    this._applyLevelBundle(bundle, previousLevel);
  }

  /**
   * @param {number} seed
   * @param {number} level
   * @returns {void}
   */
  _startJumpdriveTransition(seed, level){
    if (this.jumpdriveTransition.isActive()) return;
    this.manualZoomActive = false;
    this.manualZoomMultiplier = 1;
    this.planetView = false;
    this.levelAdvanceReady = false;
    this._setThrustLoopActive(false);
    const planetConfig = this._planetConfigFromLevel(level);
    const planetParams = resolvePlanetParams(seed, level, planetConfig, GAME);
    this.jumpdriveTransition.start({
      seed,
      level,
      planetConfig,
      planetParams,
      view: this._autoViewState(),
      mothership: this.mothership,
      ship: this.ship,
      currentPlanetRadius: this.planet ? this.planet.planetRadius : (this.planetParams ? this.planetParams.RMAX : 0),
    });
  }

  /**
   * @returns {import("./types.d.js").MapWorld|null}
   */
  _currentMapWorldClone(){
    if (!this.planet || !this.planet.mapgen || typeof this.planet.mapgen.getWorld !== "function") return null;
    const world = this.planet.mapgen.getWorld();
    if (!world || !world.air) return null;
    return {
      seed: +world.seed || 0,
      air: new Uint8Array(world.air),
      entrances: Array.isArray(world.entrances) ? world.entrances.map((p) => [p[0], p[1]]) : [],
      finalAir: +world.finalAir || 0,
    };
  }

  /**
   * @returns {void}
   */
  _startCurrentLevelJumpdriveIntro(){
    if (this.jumpdriveTransition.isActive() || !this.mothership || !this.planet) return;
    this.manualZoomActive = false;
    this.manualZoomMultiplier = 1;
    this.planetView = false;
    this.levelAdvanceReady = false;
    this._setThrustLoopActive(false);
    const planetConfig = this.planet.getPlanetConfig();
    const planetParams = this.planet.getPlanetParams();
    const mapWorld = this._currentMapWorldClone();
    if (!planetConfig || !planetParams || !mapWorld) return;
    this.jumpdriveTransition.start({
      seed: this.planet.getSeed(),
      level: this.level,
      planetConfig,
      planetParams,
      mapWorld,
      view: this._autoViewState(),
      mothership: this.mothership,
      ship: this.ship,
      currentPlanetRadius: this.planet.planetRadius,
    });
  }

  /**
   * @param {number} seed
   * @returns {void}
   */
  _beginNewGameWithIntro(seed){
    this._beginLevel(seed, 1);
    this._startCurrentLevelJumpdriveIntro();
  }

  /**
   * @param {Array<[number, number]>} points
   * @returns {number}
   */
  /**
   * Set an arbitrary local convex hull for ship collisions.
   * @param {Array<[number, number]>} localConvexHull
   * @param {number} [edgeSamplesPerEdge]
   * @returns {void}
   */
  setShipCollisionConvexHull(localConvexHull, edgeSamplesPerEdge = 1){
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
    this.shipCollisionLocalConvexHull = clean;
    this.shipCollisionEdgeSamplesPerEdge = Math.max(0, edgeSamplesPerEdge | 0);
    this.shipCollisionConvexHullBoundRadius = computeDropshipConvexHullBoundRadius(clean);
  }

  /**
   * Back-compat wrapper.
   * @param {Array<[number, number]>} localConvexHull
   * @param {number} [edgeSamplesPerEdge]
   * @returns {void}
   */
  setShipCollisionHull(localConvexHull, edgeSamplesPerEdge = 1){
    this.setShipCollisionConvexHull(localConvexHull, edgeSamplesPerEdge);
  }

  /**
   * @returns {Array<[number, number]>}
   */
  _shipCollisionLocalConvexHull(){
    if (Array.isArray(this.shipCollisionLocalConvexHull) && this.shipCollisionLocalConvexHull.length >= 3){
      return this.shipCollisionLocalConvexHull;
    }
    return buildDropshipLocalConvexHullPoints(GAME);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Array<[number, number]>}
   */
  _shipConvexHullWorldVertices(x, y){
    return buildDropshipWorldConvexHullVertices(this._shipCollisionLocalConvexHull(), x, y);
  }

  /**
   * Collision sample points from convex hull vertices, with originating convex-hull edge metadata.
   * Optional per-edge subdivisions increase persistent tracked collision points.
   * @param {number} x
   * @param {number} y
   * @returns {{points:Array<[number, number]>, edgeIdxByPoint:number[], pointMetaByPoint:Array<{kind:"vertex"|"edge",edgeIdx:number,vertexIdx:number,t:number}>}}
   */
  _shipConvexHullSampleSet(x, y){
    return buildDropshipWorldConvexHullSampleSet(
      this._shipCollisionLocalConvexHull(),
      x,
      y,
      this.shipCollisionEdgeSamplesPerEdge,
      this.shipCollisionMaxSampleSpacing
    );
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Array<[number, number]>}
   */
  _shipCollisionPoints(x, y){
    return this._shipConvexHullSampleSet(x, y).points;
  }

  _shipCollisionExactCtx(){
    return {
      planet: this.planet,
      mothership: this.mothership,
      collision: this.collision,
      collisionEps: this.COLLISION_EPS,
      shipRadius: () => this._shipRadius(),
      shipLocalConvexHull: () => this._shipCollisionLocalConvexHull(),
      shipConvexHullWorldVertices: (x, y) => this._shipConvexHullWorldVertices(x, y),
    };
  }

  /**
   * Interpolate angle along the shortest arc.
   * @param {number} a
   * @param {number} b
   * @param {number} t
   * @returns {number}
   */
  _lerpAngleShortest(a, b, t){
    return lerpAngleShortest(a, b, t);
  }

  /**
   * Swept collision against moving mothership using exact hull-vs-solid-tri overlap.
   * @param {number} shipX0
   * @param {number} shipY0
   * @param {number} shipX1
   * @param {number} shipY1
   * @param {number} shipRadius
   * @param {{x:number,y:number,angle:number}} mothershipPrev
   * @param {{x:number,y:number,angle:number}} mothershipCurr
   * @returns {{x:number,y:number,hit:import("./types.d.js").CollisionHit,hitSource:"mothership"}|null}
   */
  _sweptShipVsMovingMothership(shipX0, shipY0, shipX1, shipY1, shipRadius, mothershipPrev, mothershipCurr){
    return sweptShipVsMovingMothership(
      this._shipCollisionExactCtx(),
      shipX0,
      shipY0,
      shipX1,
      shipY1,
      shipRadius,
      mothershipPrev,
      mothershipCurr
    );
  }

  /**
   * Nudge miners out of terrain after mode changes; kill if deeply buried.
   * @returns {void}
   */
  _nudgeMinersFromTerrain(){
    for (let i = this.miners.length - 1; i >= 0; i--){
      const m = this.miners[i];
      const res = this.planet.nudgeOutOfTerrain(m.x, m.y);
      if (!res.ok){
        this.miners.splice(i, 1);
        this.minersRemaining = Math.max(0, this.minersRemaining - 1);
        this.minersDead++;
        continue;
      }
      m.x = res.x;
      m.y = res.y;
    }
  }

  /**
   * @param {number} px
   * @param {number} py
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @returns {number}
   */
  _distPointToSegment(px, py, ax, ay, bx, by){
    const dx = bx - ax;
    const dy = by - ay;
    const denom = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denom));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    return Math.hypot(px - cx, py - cy);
  }

  /**
   * @param {number} px
   * @param {number} py
   * @param {number} shipX
   * @param {number} shipY
   * @returns {number}
   */
  _shipConvexHullDistance(px, py, shipX, shipY){
    return pointDistanceToDropshipWorldConvexHull(
      this._shipCollisionLocalConvexHull(),
      px,
      py,
      shipX,
      shipY,
      this._shipRadius()
    );
  }

  /**
   * Conservative line-of-sight check against planet terrain for short miner
   * approach steps to a guide path attach point.
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {number} [sidePad]
   * @returns {boolean}
   */
  _segmentPlanetAirClear(x0, y0, x1, y1, sidePad = 0.02){
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6){
      return this.collision.planetAirValueAtWorld(x0, y0) > 0.5;
    }
    const tx = dx / len;
    const ty = dy / len;
    const nx = -ty;
    const ny = tx;
    const steps = Math.max(2, Math.min(24, Math.ceil(len / 0.06) + 1));
    for (let i = 0; i < steps; i++){
      const t = (steps <= 1) ? 1 : (i / (steps - 1));
      const sx = x0 + dx * t;
      const sy = y0 + dy * t;
      if (this.collision.planetAirValueAtWorld(sx, sy) <= 0.5) return false;
      if (sidePad > 1e-6){
        if (this.collision.planetAirValueAtWorld(sx + nx * sidePad, sy + ny * sidePad) <= 0.5) return false;
        if (this.collision.planetAirValueAtWorld(sx - nx * sidePad, sy - ny * sidePad) <= 0.5) return false;
      }
    }
    return true;
  }

  /**
   * Convert world point to ship-local coordinates where local X is ship-right
   * and local Y is ship-up (with ship orientation locked to planet tangent).
   * @param {number} px
   * @param {number} py
   * @param {number} shipX
   * @param {number} shipY
   * @returns {{x:number,y:number}}
   */
  _shipLocalPoint(px, py, shipX, shipY){
    const camRot = Math.atan2(shipX, shipY || 1e-6);
    const shipRot = -camRot;
    const c = Math.cos(shipRot);
    const s = Math.sin(shipRot);
    const dx = px - shipX;
    const dy = py - shipY;
    return {
      x: c * dx + s * dy,
      y: -s * dx + c * dy,
    };
  }

  _shipRadius(){
    if (!(this.shipCollisionConvexHullBoundRadius > 0)){
      this.shipCollisionConvexHullBoundRadius = computeDropshipConvexHullBoundRadius(this._shipCollisionLocalConvexHull());
    }
    return this.shipCollisionConvexHullBoundRadius;
  }

  /**
   * Swept enemy-shot vs ship hit test to avoid tunneling between frames.
   * @param {{x:number,y:number,vx:number,vy:number}} shot
   * @param {number} dt
   * @returns {boolean}
   */
  _enemyShotHitsShip(shot, dt){
    const shotX0 = shot.x - shot.vx * dt;
    const shotY0 = shot.y - shot.vy * dt;
    const shotX1 = shot.x;
    const shotY1 = shot.y;
    const shipX1 = this.ship.x;
    const shipY1 = this.ship.y;
    // Approximate previous ship center from current velocity for relative swept test.
    const shipX0 = shipX1 - this.ship.vx * dt;
    const shipY0 = shipY1 - this.ship.vy * dt;
    const hitPad = 0.02;
    const shipR = this._shipRadius() + hitPad;
    const broadR = shipR
      + Math.hypot(shot.vx, shot.vy) * dt
      + Math.hypot(this.ship.vx, this.ship.vy) * dt
      + 0.35;
    const dxBroad = shotX1 - shipX1;
    const dyBroad = shotY1 - shipY1;
    if (dxBroad * dxBroad + dyBroad * dyBroad > broadR * broadR){
      return false;
    }

    // Swept shot vs moving convex hull via segment sampling against hull distance.
    const shotTravel = Math.hypot(shotX1 - shotX0, shotY1 - shotY0);
    const shipTravel = Math.hypot(shipX1 - shipX0, shipY1 - shipY0);
    const steps = Math.max(2, Math.min(20, Math.ceil((shotTravel + shipTravel) / 0.06) + 1));
    for (let i = 0; i < steps; i++){
      const t = (steps <= 1) ? 1 : (i / (steps - 1));
      const px = shotX0 + (shotX1 - shotX0) * t;
      const py = shotY0 + (shotY1 - shotY0) * t;
      const sx = shipX0 + (shipX1 - shipX0) * t;
      const sy = shipY0 + (shipY1 - shipY0) * t;
      if (this._shipConvexHullDistance(px, py, sx, sy) <= hitPad){
        return true;
      }
    }
    return false;
  }

  _shipGunPivotWorld(){
    const localPivot = getDropshipGunPivotLocal(GAME);
    const camRot = Math.atan2(this.ship.x, this.ship.y || 1e-6);
    const shipRot = -camRot;
    const c = Math.cos(shipRot), s = Math.sin(shipRot);
    const wx = c * localPivot.x - s * localPivot.y;
    const wy = s * localPivot.x + c * localPivot.y;
    return { x: this.ship.x + wx, y: this.ship.y + wy };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  _shipCollidesAt(x, y){
    return !!this._shipCollisionExactAt(x, y);
  }

  /**
   * Mothership-only overlap check at ship pose.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  _shipCollidesWithMothershipAt(x, y){
    return !!this._shipMothershipCollisionExactWithPose(x, y, this.mothership);
  }

  /**
   * Exact hull-vs-planet-rock overlap at pose.
   * @param {number} x
   * @param {number} y
   * @returns {import("./types.d.js").CollisionHit|null}
   */
  _shipPlanetCollisionExact(x, y){
    return findPlanetCollisionExactAt(this._shipCollisionExactCtx(), x, y);
  }

  /**
   * Exact hull-vs-mothership-solid overlap at pose.
   * @param {number} x
   * @param {number} y
   * @param {Pick<import("./mothership.js").Mothership, "x"|"y"|"angle"|"bounds"|"points"|"tris"|"triAir">|null|undefined} mothershipPose
   * @returns {import("./types.d.js").CollisionHit|null}
   */
  _shipMothershipCollisionExactWithPose(x, y, mothershipPose){
    return findMothershipCollisionExactAtPose(this._shipCollisionExactCtx(), x, y, mothershipPose);
  }

  /**
   * Exact ship overlap at pose.
   * @param {number} x
   * @param {number} y
   * @returns {{hit:import("./types.d.js").CollisionHit, hitSource:"planet"|"mothership"}|null}
   */
  _shipCollisionExactAt(x, y){
    return findCollisionExactAt(this._shipCollisionExactCtx(), x, y);
  }

  /**
   * Continuous sweep using exact hull overlap checks.
   * @param {number} x0
   * @param {number} y0
   * @param {number} x1
   * @param {number} y1
   * @param {number} stepLen
   * @param {number} maxSteps
   * @returns {{x:number,y:number,hit:import("./types.d.js").CollisionHit,hitSource:"planet"|"mothership"}|null}
   */
  _firstShipCollisionOnSegmentExact(x0, y0, x1, y1, stepLen, maxSteps){
    return findFirstCollisionOnSegmentExact(this._shipCollisionExactCtx(), x0, y0, x1, y1, stepLen, maxSteps);
  }

  /**
   * Hard post-collision depenetration against planet terrain.
   * Prevents sustained control input from nudging the ship through rock.
   * @param {number} [maxIters]
   * @returns {void}
   */
  _stabilizeShipAgainstPlanetPenetration(maxIters = 12){
    stabilizePlanetPenetration({
      ship: this.ship,
      collision: this.collision,
      planet: this.planet,
      collisionEps: this.COLLISION_EPS,
      shipCollisionPointsAt: (x, y) => this._shipCollisionPoints(x, y),
      shipRadius: () => this._shipRadius(),
    }, maxIters);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  _minerCollidesAt(x, y){
    const r = Math.hypot(x, y) || 1;
    const upx = x / r;
    const upy = y / r;
    const footX = x + upx * this.MINER_FOOT_OFFSET;
    const footY = y + upy * this.MINER_FOOT_OFFSET;
    const headX = x + upx * this.MINER_HEAD_OFFSET;
    const headY = y + upy * this.MINER_HEAD_OFFSET;
    return this.collision.collidesAtPoints([
      [footX, footY],
      [headX, headY],
    ]);
  }

  /**
   * @param {number} dt
   * @param {ReturnType<import("./input.js").Input["update"]>} inputState
   * @returns {void}
   */
  _step(dt, inputState){
    if (this.jumpdriveTransition.isActive()){
      this._setThrustLoopActive(false);
      this.jumpdriveTransition.update(dt);
      const preparedLevel = this.jumpdriveTransition.consumePreparedLevel();
      if (preparedLevel){
        this._beginLevel(preparedLevel.seed, preparedLevel.level, preparedLevel.mapWorld, true);
        this.jumpdriveTransition.applyPreparedLevel({
          mothership: this.mothership,
          view: this._autoViewState(),
        });
      }
      return;
    }

    let {
      stickThrust,
      left,
      right,
      thrust,
      down,
      reset,
      abandonRun,
      shootHeld = false,
      shootPressed = false,
      shoot = false,
      bomb,
      aim,
      aimShoot,
      aimBomb,
      aimShootFrom,
      aimShootTo,
      aimBombFrom,
      aimBombTo,
      spawnEnemyType,
    } = inputState;
    if (!shootPressed && shoot){
      shootPressed = true;
    }

    if (abandonRun){
      this._abandonRunAndRestart();
      inputState.abandonRun = false;
      inputState.abandonHoldActive = false;
      inputState.abandonHoldRemainingMs = 0;
      return;
    }
    this.playerShotCooldown = Math.max(0, this.playerShotCooldown - dt);

    if (inputState.inputType === "gamepad"){
      const aimAdjusted = this._aimScreenAroundShip(aim);
      aim = aimAdjusted;
      aimShoot = aimAdjusted;
      aimBomb = aimAdjusted;
    }
    if (!aim && this.lastAimScreen){
      aim = this.lastAimScreen;
    }
    if (!aimShoot) aimShoot = aim;
    if (!aimBomb) aimBomb = aimShoot || aim;

    if (reset){
      if (this.ship.state === "crashed"){
        if (this.ship.mothershipPilots > 0){
          this._restartWithNewPilot();
        } else {
          const nextSeed = this.planet.getSeed() + 1;
          this._beginNewGameWithIntro(nextSeed);
        }
      } else if (this._isDockedWithMothership()) {
        if (this.pendingPerkChoice === null && this.ship.mothershipEngineers > 0){
          this._presentNextPerkChoice();
        } else if (this.levelAdvanceReady){
          const nextSeed = this.planet.getSeed() + 1;
          this._startJumpdriveTransition(nextSeed, this.level + 1);
        } else if (this.ship.planetScanner){
          this.planetView = !this.planetView;
        }
      } else {
        // Always allow a hard ship reset when away from dock/crash states.
        // This avoids soft-locks from pathological collision states.
        this._resetShip();
        return;
      }
    }

    // Perk selection
    if (this.pendingPerkChoice !== null){
      this._setThrustLoopActive(false);
      this._handlePerkChoiceInput(left || stickThrust.x < -0.5, right || stickThrust.x > 0.5);
      return;
    }
    this._syncTetherProtectionStates();
    if (!this.coreMeltdownActive && this.objective && this.objective.type === "destroy_core" && this._tetherPropsAlive().length <= 0){
      this._startCoreMeltdown();
    }

    // Cancel flight input while viewing planet
    if (this.planetView){
      left = false;
      right = false;
      thrust = false;
      down = false;
      stickThrust.x = 0;
      stickThrust.y = 0;
    }

    // Handle control inversion
    if (this.ship.invertT > 0){
      this.ship.invertT = Math.max(0, this.ship.invertT - dt);
      const tmp = left;
      left = right;
      right = tmp;
      const tmp2 = thrust;
      thrust = down;
      down = tmp2;
      stickThrust.x = -stickThrust.x;
      stickThrust.y = -stickThrust.y;
    }

    /** @type {{x:number,y:number,angle:number}|null} */
    let mothershipPrevPose = null;
    let mothershipAngularVel = 0;
    if (this.mothership){
      mothershipPrevPose = {
        x: this.mothership.x,
        y: this.mothership.y,
        angle: this.mothership.angle,
      };
      updateMothership(this.mothership, this.planet, dt);
      let da = this.mothership.angle - mothershipPrevPose.angle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      mothershipAngularVel = da / Math.max(1e-6, dt);
    }
    if (spawnEnemyType){
      const map = {
        "1": "hunter",
        "2": "ranger",
        "3": "crawler",
        "4": "turret",
        "5": "orbitingTurret",
      };
      const type = map[spawnEnemyType];
      if (type){
        const ang = Math.random() * Math.PI * 2;
        const dist = 10;
        const sx = this.ship.x + Math.cos(ang) * dist;
        const sy = this.ship.y + Math.sin(ang) * dist;
        this.enemies.spawnDebug(type, sx, sy);
      }
    }
    const planetCfg = this.planet && this.planet.getPlanetConfig ? this.planet.getPlanetConfig() : null;

    if (this.ship.state === "landed" && this.ship._dock && this.mothership){
      if (thrust || stickThrust.y > 0.5){
        const shipRadius = this._shipRadius();
        const pushStep = shipRadius * 0.35;
        for (let i = 0; i < 8 && this._shipCollidesAt(this.ship.x, this.ship.y); i++){
          const info = mothershipCollisionInfo(this.mothership, this.ship.x, this.ship.y);
          if (!info) break;
          this.ship.x += info.nx * pushStep;
          this.ship.y += info.ny * pushStep;
        }
        // Nudge outward so takeoff doesn't scrape the surface.
        const info = mothershipCollisionInfo(this.mothership, this.ship.x, this.ship.y);
        if (info){
          const lift = shipRadius * 0.25;
          this.ship.x += info.nx * lift;
          this.ship.y += info.ny * lift;
          this.ship.vx += info.nx * 0.05;
          this.ship.vy += info.ny * 0.05;
        }
        this.ship.state = "flying";
        this.ship._dock = null;
        this.hasLaunchedPlayerShip = true;
        if (this.newGameHelpPromptArmed){
          this.newGameHelpPromptT = this.NEW_GAME_HELP_PROMPT_SECS;
          this.newGameHelpPromptArmed = false;
        }
        if (!aim && !aimShoot && !aimBomb && !this.lastAimScreen){
          const seededAim = this._defaultAimScreenFromShip();
          if (seededAim){
            aim = seededAim;
            aimShoot = seededAim;
            aimBomb = seededAim;
          }
        }
      } else {
        const { lx, ly } = this.ship._dock;
        const c = Math.cos(this.mothership.angle);
        const s = Math.sin(this.mothership.angle);
        this.ship.x = this.mothership.x + c * lx - s * ly;
        this.ship.y = this.mothership.y + s * lx + c * ly;
        this.ship.vx = this.mothership.vx;
        this.ship.vy = this.mothership.vy;
        this.ship._shipRadius = this._shipRadius();
        this.ship._samples = sampleBodyCollisionAt(
          this.collision,
          (px, py) => this._shipCollisionPoints(px, py),
          this.ship.x,
          this.ship.y,
          false
        ).samples;
        this.lastAimWorld = null;
        this.lastAimScreen = null;
      }
    }

    if (this.ship.hitCooldown > 0){
      this.ship.hitCooldown = Math.max(0, this.ship.hitCooldown - dt);
    }
    if (this.planet && this.planet.props && this.planet.props.length){
      for (const p of this.planet.props){
        if (p.type !== "factory") continue;
        if (!p.hitT || p.hitT <= 0) continue;
        p.hitT = Math.max(0, p.hitT - dt);
      }
    }

    if (this.ship.state === "flying"){
      this.ship.cabinSide = resolveDropshipFacing(this.ship.cabinSide || 1, {
        left,
        right,
        stickThrust,
      });
      this._setThrustLoopActive(hasDropshipThrustInput({
        left,
        right,
        thrust,
        down,
        stickThrust,
      }));

      const isWaterWorld = !!(planetCfg && planetCfg.id === "water");
      const outerRingR = (this.planet && this.planet.radial && this.planet.radial.rings && this.planet.radial.rings.length)
        ? (this.planet.radial.rings.length - 1)
        : Math.floor(this.planetParams.RMAX || 0);
      const thrustMax = this.planetParams.THRUST * (1 + this.ship.thrust * 0.1);
      const thrustAccel = computeDropshipAcceleration(this.ship, { left, right, thrust, down, stickThrust }, thrustMax);
      let ax = thrustAccel.ax;
      let ay = thrustAccel.ay;
      const { r, rx, ry, tx, ty } = thrustAccel;
      const waterR = isWaterWorld ? Math.max(0, outerRingR) : 0;
      const shipInWaterBefore = !!(isWaterWorld && waterR > 0 && r <= waterR + 0.02 && this.planet.airValueAtWorld(this.ship.x, this.ship.y) > 0.5);

      /*
      const aThrustSqr = ax*ax + ay*ay;
      if (aThrustSqr > thrustMax * thrustMax) {
        const thrustScale = thrustMax / Math.sqrt(aThrustSqr);
        ax *= thrustScale;
        ay *= thrustScale;
      }
      */

      if (isWaterWorld && shipInWaterBefore){
        let buoyancy = Math.max(0, this.planetParams.SURFACE_G * 0.45);
        buoyancy = Math.max(buoyancy, this.planetParams.SURFACE_G * 0.95);
        ax += rx * buoyancy;
        ay += ry * buoyancy;
      }

      const prevShipX = this.ship.x;
      const prevShipY = this.ship.y;
      const {x: gx, y: gy} = this.planet.gravityAt(this.ship.x, this.ship.y);

      this.ship.x += (this.ship.vx + 0.5 * (ax + gx) * dt) * dt;
      this.ship.y += (this.ship.vy + 0.5 * (ay + gy) * dt) * dt;

      const {x: gx2, y: gy2} = this.planet.gravityAt(this.ship.x, this.ship.y);

      this.ship.vx += (ax + (gx + gx2) / 2) * dt;
      this.ship.vy += (ay + (gy + gy2) / 2) * dt;
      const shipWaterSpeed = Math.hypot(this.ship.vx, this.ship.vy);

      /*
      const drag = Math.max(0, 1 - this.planetParams.DRAG * dt);
      this.ship.vx *= drag;
      this.ship.vy *= drag;
      */
      if (isWaterWorld){
        const rNow = Math.hypot(this.ship.x, this.ship.y) || 1;
        const shipInWaterNow = !!(waterR > 0 && rNow <= waterR + 0.02 && this.planet.airValueAtWorld(this.ship.x, this.ship.y) > 0.5);
        if (shipInWaterNow && !this._shipWasInWater){
          this._playSfx("water_splash", {
            volume: Math.max(0.35, Math.min(0.95, 0.42 + shipWaterSpeed * 0.12)),
            rate: Math.max(0.86, Math.min(1.16, 0.9 + shipWaterSpeed * 0.04)),
          });
        } else if (!shipInWaterNow && this._shipWasInWater){
          this._playSfx("water_splash", {
            volume: Math.max(0.3, Math.min(0.8, 0.36 + shipWaterSpeed * 0.1)),
            rate: Math.max(0.9, Math.min(1.22, 1.02 + shipWaterSpeed * 0.03)),
          });
        }
        if (shipInWaterNow){
          const depth = Math.max(0, waterR - rNow);
          const edgeBand = Math.max(0.35, waterR * 0.22);
          const edgeMix = Math.max(0, Math.min(1, 1 - depth / edgeBand));
          const dragK = this.planetParams.DRAG * (4.8 + edgeMix * 5.4);
          const drag = Math.max(0, 1 - dragK * dt);
          this.ship.vx *= drag;
          this.ship.vy *= drag;
          const maxWaterSpeed = Math.max(1.35, thrustMax * 0.55);
          const speed = Math.hypot(this.ship.vx, this.ship.vy);
          if (speed > maxWaterSpeed){
            const s = maxWaterSpeed / speed;
            this.ship.vx *= s;
            this.ship.vy *= s;
          }
          if (!this._shipWasInWater){
            this.ship.vx *= 0.68;
            this.ship.vy *= 0.68;
          }
        }
        this._shipWasInWater = shipInWaterNow;
      } else {
        this._shipWasInWater = false;
      }

      /*
      const vt = this.ship.vx * tx + this.ship.vy * ty;
      const vtMax = GAME.MAX_TANGENTIAL_SPEED;
      if (Math.abs(vt) > vtMax){
        const excess = vt - Math.sign(vt) * vtMax;
        this.ship.vx -= tx * excess;
        this.ship.vy -= ty * excess;
      }
      */

      const eps = this.COLLISION_EPS;
      const shipRadius = this._shipRadius();
      const attemptedShipX = this.ship.x;
      const attemptedShipY = this.ship.y;
      const travelDist = Math.hypot(attemptedShipX - prevShipX, attemptedShipY - prevShipY);
      const sweepStep = Math.max(0.03, Math.min(0.05, shipRadius * 0.2));
      const sweepMaxSteps = Math.max(18, Math.min(96, Math.ceil(travelDist / sweepStep) + 2));
      this.ship._landingDebug = null;
      let sweptHit = this._firstShipCollisionOnSegmentExact(
        prevShipX,
        prevShipY,
        this.ship.x,
        this.ship.y,
        sweepStep,
        sweepMaxSteps
      );
      if (!sweptHit && this.mothership && mothershipPrevPose){
        const mothershipCurrPose = {
          x: this.mothership.x,
          y: this.mothership.y,
          angle: this.mothership.angle,
        };
        sweptHit = this._sweptShipVsMovingMothership(
          prevShipX,
          prevShipY,
          this.ship.x,
          this.ship.y,
          shipRadius,
          mothershipPrevPose,
          mothershipCurrPose
        );
      }
      let samples;
      let hit;
      let hitSource;
      if (sweptHit){
        this.ship.x = sweptHit.x;
        this.ship.y = sweptHit.y;
        samples = sampleBodyCollisionAt(
          this.collision,
          (px, py) => this._shipCollisionPoints(px, py),
          this.ship.x,
          this.ship.y,
          false
        ).samples;
        hit = sweptHit.hit;
        hitSource = sweptHit.hitSource;
      } else {
        ({ samples, hit, hitSource } = sampleBodyCollisionAt(
          this.collision,
          (px, py) => this._shipCollisionPoints(px, py),
          this.ship.x,
          this.ship.y,
          false
        ));
      }
      const collides = !!hit;
      this.ship._samples = samples;
      this.ship._shipRadius = shipRadius;
      if (hit){
        const hitTri = (hitSource === "planet")
          ? (hit.tri || this.planet.radial.findTriAtWorld(hit.x, hit.y))
          : null;
        this.ship._collision = {
          x: hit.x,
          y: hit.y,
          source: hitSource,
          tri: hitTri,
          node: (hitSource === "planet") ? this.planet.radial.nearestNodeOnRing(hit.x, hit.y) : null,
          contacts: Array.isArray(hit.contacts) ? hit.contacts : null,
        };
      } else {
        this.ship._collision = null;
      }

      if (collides){
        const prevCollider = this._shipConvexHullSampleSet(prevShipX, prevShipY);
        // Use attempted (pre-resolution) pose so swept contact reconstruction
        // sees actual crossings, not the post-clamp safe pose.
        const currCollider = this._shipConvexHullSampleSet(attemptedShipX, attemptedShipY);
        resolveCollisionResponse({
          ship: this.ship,
          collision: this.collision,
          planet: this.planet,
          mothership: this.mothership,
          planetParams: this.planetParams,
          game: GAME,
          dt,
          eps,
          debugEnabled: this.devHudVisible,
          shipRadius,
          shipCollidesAt: (x, y) => this._shipCollidesAt(x, y),
          shipCollidesMothershipAt: (x, y) => this._shipCollidesWithMothershipAt(x, y),
          shipLocalConvexHull: this._shipCollisionLocalConvexHull(),
          shipCollisionPointsAt: (x, y) => this._shipCollisionPoints(x, y),
          shipStartX: prevShipX,
          shipStartY: prevShipY,
          shipEndX: attemptedShipX,
          shipEndY: attemptedShipY,
          mothershipAngularVel,
          mothershipPrevPose,
          prevPoints: prevCollider.points,
          currPoints: currCollider.points,
          onCrash: () => this._triggerCrash(),
          isDockedWithMothership: () => this._isDockedWithMothership(),
          onSuccessfullyDocked: () => this._onSuccessfullyDocked(),
        });
      }
    }
    if (this.ship.state !== "crashed" && this.ship._collision && this.ship._collision.source === "planet"){
      this._stabilizeShipAgainstPlanetPenetration(10);
    }
    if (this.ship.state !== "flying"){
      this._setThrustLoopActive(false);
    }
    const gunOrigin = this._shipGunPivotWorld();
    const aimWorldShoot = this._toWorldFromAim(aimShoot || aim);
    const aimWorldBomb = this._toWorldFromAim(aimBomb || aimShoot || aim);
    let aimWorld = (aimShootTo && this._toWorldFromAim(aimShootTo)) || aimWorldShoot || (aimBombTo && this._toWorldFromAim(aimBombTo)) || aimWorldBomb;
    if ((aimShootFrom && aimShootTo) || (aimBombFrom && aimBombTo)){
      const from = aimShootFrom || aimBombFrom;
      const to = aimShootTo || aimBombTo;
      const wFrom = from ? this._toWorldFromAim(from) : null;
      const wTo = to ? this._toWorldFromAim(to) : null;
      if (wFrom && wTo){
        const dx = wTo.x - wFrom.x;
        const dy = wTo.y - wFrom.y;
        const dist = Math.hypot(dx, dy) || 1;
        const dirx = dx / dist;
        const diry = dy / dist;
        const aimLen = Math.max(4.0, this._aimWorldDistance(GAME.AIM_SCREEN_RADIUS || 0.25));
        aimWorld = { x: gunOrigin.x + dirx * aimLen, y: gunOrigin.y + diry * aimLen };
      }
    }
    if (!this._isDockedWithMothership()){
      this.lastAimWorld = aimWorld;
      if (aim) this.lastAimScreen = aim;
    }

    if (this.ship.state === "crashed"){
      this.ship.guidePath = null;
    } else {
      /**
       * @param {number} px
       * @param {number} py
       * @returns {{path:Array<{x:number,y:number}>,indexClosest:number}|null}
       */
      const tryGuidePath = (px, py) => {
        const gp = this.planet.surfaceGuidePathTo(px, py, GAME.MINER_CALL_RADIUS);
        if (!gp || !gp.path || gp.path.length < 1){
          return null;
        }
        if (!Number.isFinite(gp.indexClosest)) return null;
        for (const p of gp.path){
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)){
            return null;
          }
        }
        return gp;
      };

      /**
       * @param {{path:Array<{x:number,y:number}>,indexClosest:number}|null} gp
       * @returns {boolean}
       */
      const guidePathUsable = (gp) => !!(gp && gp.path && gp.path.length > 1 && Number.isFinite(gp.indexClosest));

      let guideAnchorX = this.ship.x;
      let guideAnchorY = this.ship.y;
      const shipContact = this.ship._collision;
      if (this.ship.state === "landed" && shipContact && shipContact.source === "planet"){
        let anchorBest = { x: shipContact.x, y: shipContact.y };
        let rBest = Math.hypot(anchorBest.x, anchorBest.y);
        const samples = this.ship._samples;
        if (samples && samples.length){
          for (const s of samples){
            if (!s || s.length < 3) continue;
            const sx = s[0];
            const sy = s[1];
            const isAir = !!s[2];
            if (isAir) continue;
            if (this.collision.planetAirValueAtWorld(sx, sy) > 0.5) continue;
            const rs = Math.hypot(sx, sy);
            if (rs > rBest){
              rBest = rs;
              anchorBest = { x: sx, y: sy };
            }
          }
        }
        guideAnchorX = anchorBest.x;
        guideAnchorY = anchorBest.y;
      }
      let guidePath = tryGuidePath(guideAnchorX, guideAnchorY);
      // Restored landed positions can occasionally sit on a degenerate sample point.
      // Probe nearby points and keep the first usable multi-segment path.
      if (!guidePathUsable(guidePath) && this.ship.state === "landed"){
        const info = this.planet.surfaceInfoAtWorld(guideAnchorX, guideAnchorY, 0.24);
        if (info){
          const tx = -info.ny;
          const ty = info.nx;
          const nx = info.nx;
          const ny = info.ny;
          const probes = [
            [ tx * 0.30, ty * 0.30],
            [-tx * 0.30,-ty * 0.30],
            [ tx * 0.60, ty * 0.60],
            [-tx * 0.60,-ty * 0.60],
            [ nx * 0.18, ny * 0.18],
            [-nx * 0.18,-ny * 0.18],
          ];
          for (let i = 0; i < probes.length && !guidePathUsable(guidePath); i++){
            const p = probes[i];
            guidePath = tryGuidePath(guideAnchorX + p[0], guideAnchorY + p[1]);
          }
        }
        if (!guidePathUsable(guidePath)){
          const ringOffsets = [0.35, 0.65];
          for (let i = 0; i < ringOffsets.length && !guidePathUsable(guidePath); i++){
            const r = ringOffsets[i];
            for (let a = 0; a < 8 && !guidePathUsable(guidePath); a++){
              const ang = (Math.PI * 2 * a) / 8;
              guidePath = tryGuidePath(guideAnchorX + Math.cos(ang) * r, guideAnchorY + Math.sin(ang) * r);
            }
          }
        }
        if (!guidePathUsable(guidePath)){
          const posClosest = this.planet.posClosest(guideAnchorX, guideAnchorY);
          if (posClosest && Number.isFinite(posClosest.x) && Number.isFinite(posClosest.y)){
            guidePath = { path: [{ x: posClosest.x, y: posClosest.y }], indexClosest: 0 };
          }
        }
      }
      this.ship.guidePath = guidePath;
    }
    this._resolveShipSolidPropCollisions();

    if (this.ship.state !== "crashed" && !this._isDockedWithMothership()){
      const wantsShoot = !!(shootPressed || shootHeld);
      if (wantsShoot && this.playerShotCooldown <= 0){
        let dirx = 0, diry = 0;
        if (aimShootFrom && aimShootTo){
          const wFrom = this._toWorldFromAim(aimShootFrom);
          const wTo = this._toWorldFromAim(aimShootTo);
          if (wFrom && wTo){
            const dx = wTo.x - wFrom.x;
            const dy = wTo.y - wFrom.y;
            const dist = Math.hypot(dx, dy) || 1;
            dirx = dx / dist;
            diry = dy / dist;
          }
        } else if (aimWorldShoot){
          const dx = aimWorldShoot.x - gunOrigin.x;
          const dy = aimWorldShoot.y - gunOrigin.y;
          const dist = Math.hypot(dx, dy) || 1;
          dirx = dx / dist;
          diry = dy / dist;
        }
        if (dirx || diry){
          this.playerShots.push({
            x: gunOrigin.x + dirx * 0.45,
            y: gunOrigin.y + diry * 0.45,
            vx: dirx * this.PLAYER_SHOT_SPEED + this.ship.vx,
            vy: diry * this.PLAYER_SHOT_SPEED + this.ship.vy,
            life: this.PLAYER_SHOT_LIFE,
          });
          this.playerShotCooldown = this.PLAYER_SHOT_INTERVAL;
          this._playSfx("ship_laser", {
            volume: 0.1,
          });
        }
      }
      if (bomb && this.ship.bombsCur > 0){
        let dirx = 0, diry = 0;
        if (aimBombFrom && aimBombTo){
          const wFrom = this._toWorldFromAim(aimBombFrom);
          const wTo = this._toWorldFromAim(aimBombTo);
          if (wFrom && wTo){
            const dx = wTo.x - wFrom.x;
            const dy = wTo.y - wFrom.y;
            const dist = Math.hypot(dx, dy) || 1;
            dirx = dx / dist;
            diry = dy / dist;
          }
        } else if (aimWorldBomb){
          const dx = aimWorldBomb.x - gunOrigin.x;
          const dy = aimWorldBomb.y - gunOrigin.y;
          const dist = Math.hypot(dx, dy) || 1;
          dirx = dx / dist;
          diry = dy / dist;
        }
        if (dirx || diry){
          --this.ship.bombsCur;
          this.playerBombs.push({
            x: gunOrigin.x + dirx * 0.45,
            y: gunOrigin.y + diry * 0.45,
            vx: dirx * this.PLAYER_BOMB_SPEED + this.ship.vx,
            vy: diry * this.PLAYER_BOMB_SPEED + this.ship.vy,
            life: this.PLAYER_BOMB_LIFE,
          });
          this._playSfx("bomb_launch", {
            volume: 0.55,
            rate: 0.96 + Math.random() * 0.08,
          });
        }
      }
    }

    if (this.ship.state !== "crashed"){
      const shipRadius = this._shipRadius();
      this.planet.handleFeatureContact(this.ship.x, this.ship.y, shipRadius, this.featureCallbacks);
    }

    this._updateCoreMeltdown(dt);
    this.planet.updateFeatureEffects(dt, {
      ship: this.ship,
      enemies: this.enemies.enemies,
      miners: this.miners,
      onShipDamage: this.featureCallbacks.onShipDamage,
      onShipHeat: this.featureCallbacks.onShipHeat,
      onShipConfuse: this.featureCallbacks.onShipConfuse,
      onEnemyHit: this.featureCallbacks.onEnemyHit,
      onEnemyStun: this.featureCallbacks.onEnemyStun,
      onMinerKilled: this.featureCallbacks.onMinerKilled,
    });
    if (this.ship.state !== "crashed"){
      if (this._heatMechanicsActive() && (this.ship.heat || 0) >= 100){
        this._triggerCrash();
      }
    }
    const mechanizedLevel = this._isMechanizedLevel();
    /** @type {Array<any>|null} */
    let mechShotBlockers = null;
    /** @type {Array<any>|null} */
    let mechBombBlockers = null;
    /** @type {Array<any>|null} */
    let mechFactories = null;
    if (mechanizedLevel && this.planet && this.planet.props && this.planet.props.length){
      mechShotBlockers = [];
      mechBombBlockers = [];
      mechFactories = [];
      for (const p of this.planet.props){
        if (!p) continue;
        if (p.type === "factory"){
          mechFactories.push(p);
          mechBombBlockers.push(p);
        } else if (p.type === "gate" || p.type === "tether"){
          mechShotBlockers.push(p);
          mechBombBlockers.push(p);
        }
      }
    }

    if (this.playerShots.length){
      for (let i = this.playerShots.length - 1; i >= 0; i--){
        const s = this.playerShots[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0){
          this.playerShots.splice(i, 1);
          continue;
        }
        if (this.planet.handleFeatureShot(s.x, s.y, this.PLAYER_SHOT_RADIUS, this.featureCallbacks)){
          this.playerShots.splice(i, 1);
          continue;
        }
        if (this.collision.airValueAtWorld(s.x, s.y) <= 0.5){
          this.playerShots.splice(i, 1);
          continue;
        }
        if (mechanizedLevel){
          let blocked = false;
          if (mechShotBlockers){
            for (const p of mechShotBlockers){
              if (p.dead) continue;
              if (this._solidPropPenetration(p, s.x, s.y, this.PLAYER_SHOT_RADIUS * 0.5)){
                blocked = true;
                break;
              }
            }
          }
          if (blocked){
            this.playerShots.splice(i, 1);
            continue;
          }
          if (this._damageFactoryPropsAt(mechFactories, s.x, s.y, this.PLAYER_SHOT_RADIUS, 1, false)){
            this.playerShots.splice(i, 1);
            continue;
          }
        }
        for (let j = this.enemies.enemies.length - 1; j >= 0; j--){
          const e = this.enemies.enemies[j];
          if (e.hp <= 0) continue;
          const dx = e.x - s.x;
          const dy = e.y - s.y;
          if (dx * dx + dy * dy <= this.PLAYER_SHOT_RADIUS * this.PLAYER_SHOT_RADIUS){
            e.hp -= this.ship.gunPower;
            if (e.hp > 0){
              this._applyEnemyHitFeedback(e);
            }
            this.playerShots.splice(i, 1);
            if (e.hp <= 0) e.hp = 0;
            break;
          }
        }
        if (i >= this.playerShots.length) continue;
        for (let j = this.miners.length - 1; j >= 0; j--){
          const m = this.miners[j];
          const dx = m.x - s.x;
          const dy = m.y - s.y;
          if (dx * dx + dy * dy <= this.PLAYER_SHOT_RADIUS * this.PLAYER_SHOT_RADIUS){
            this.miners.splice(j, 1);
            this.minersRemaining = Math.max(0, this.minersRemaining - 1);
            this.minersDead++;
            this.playerShots.splice(i, 1);
            break;
          }
        }
      }
    }

    if (this.playerBombs.length){
      for (let i = this.playerBombs.length - 1; i >= 0; i--){
        const b = this.playerBombs[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        let hit = false;
        let hitSource = "planet";
        if (b.life <= 0){
          hit = true;
        } else {
          const sample = this.collision.sampleAtWorld(b.x, b.y);
          if (sample.air <= 0.5){
            hit = true;
            hitSource = sample.source;
          }
        }
        if (!hit){
          if (mechanizedLevel && mechBombBlockers){
            for (const p of mechBombBlockers){
              if (p.dead) continue;
              if (this._solidPropPenetration(p, b.x, b.y, this.PLAYER_BOMB_RADIUS * 0.8)){
                hit = true;
                hitSource = "planet";
                break;
              }
            }
          }
        }
        if (!hit){
          for (let j = this.enemies.enemies.length - 1; j >= 0; j--){
            const e = this.enemies.enemies[j];
            const dx = e.x - b.x;
            const dy = e.y - b.y;
            if (dx * dx + dy * dy <= this.PLAYER_BOMB_RADIUS * this.PLAYER_BOMB_RADIUS){
              this.enemies.enemies.splice(j, 1);
              this._playSfx("enemy_destroyed", { volume: 0.8 });
              hit = true;
              break;
            }
          }
          if (!hit){
            for (let j = this.miners.length - 1; j >= 0; j--){
              const m = this.miners[j];
              const dx = m.x - b.x;
              const dy = m.y - b.y;
              if (dx * dx + dy * dy <= this.PLAYER_BOMB_RADIUS * this.PLAYER_BOMB_RADIUS){
                this.miners.splice(j, 1);
                this.minersRemaining = Math.max(0, this.minersRemaining - 1);
                this.minersDead++;
                hit = true;
                break;
              }
            }
          }
        }
        if (hit){
          this.playerBombs.splice(i, 1);
          if (hitSource === "planet"){
            this._applyBombImpact(b.x, b.y);
          }
          this.planet.handleFeatureBomb(b.x, b.y, this.TERRAIN_IMPACT_RADIUS, this.PLAYER_BOMB_RADIUS, this.featureCallbacks);
          this._applyBombDamage(b.x, b.y);
          this.entityExplosions.push({ x: b.x, y: b.y, life: 0.8, radius: this.PLAYER_BOMB_BLAST });
          this._playSfx("bomb_explosion", {
            volume: 0.9,
            rate: 0.95 + Math.random() * 0.1,
          });
        }
      }
    }

    if (this.entityExplosions.length){
      for (let i = this.entityExplosions.length - 1; i >= 0; i--){
        this.entityExplosions[i].life -= dt;
        if (this.entityExplosions[i].life <= 0) this.entityExplosions.splice(i, 1);
      }
    }

    const guidepathMargin = Math.max(0.15, GAME.MINER_GUIDE_ATTACH_RADIUS || 0.75);
    const guidepathAttachTolerance = 0.12;
    const attachDist = guidepathMargin + guidepathAttachTolerance;
    const guidePath = this.ship.guidePath;
    const guidePathUsable = !!(guidePath && guidePath.path && guidePath.path.length > 1 && Number.isFinite(guidePath.indexClosest));
    let debugMinerPathToMiner = null;
    let debugMinerPathScore = Infinity;
    const minerPathDebugEnabled = this.debugMinerGuidePath;
    if (this._minerPathDebugCooldown > 0){
      this._minerPathDebugCooldown = Math.max(0, this._minerPathDebugCooldown - dt);
    }
    let minerPathDebugRecord = null;
    const pathRaiseAmount = 0.02;

    const landed = this.ship.state === "landed";
    const guidePathIndexShip = (landed && guidePathUsable) ? findGuidePathTargetIndex(guidePath, this.ship.x, this.ship.y) : null;

    for (let i = this.miners.length - 1; i >= 0; i--){
      const miner = this.miners[i];
      const prevMinerX = miner.x;
      const prevMinerY = miner.y;

      let indexPathMiner = null;
      /** @type {{radialTolBase?:number,sameRingIdx?:number|null,nearbyRingIdx?:number|null,plainIdx?:number|null,chosenStage?:string,chosenIdx?:number|null,chosenDist?:number,chosenR?:number,nearestIdx?:number|null,nearestDist?:number,nearestR?:number}|null} */
      let attachDebug = null;
      if (landed && guidePathUsable) {
        const rMiner = Math.hypot(miner.x, miner.y);
        attachDebug = minerPathDebugEnabled ? {} : null;
        indexPathMiner = findMinerGuideAttachIndex(guidePath.path, attachDist, miner.x, miner.y, rMiner, attachDebug);
        if (indexPathMiner !== null){
          const targetForDebug = (guidePathIndexShip !== null) ? guidePathIndexShip : guidePath.indexClosest;
          const score = Math.abs(indexPathMiner - targetForDebug);
          if (score < debugMinerPathScore){
            debugMinerPathScore = score;
            debugMinerPathToMiner = extractPathSegment(guidePath.path, targetForDebug, indexPathMiner);
          }
        }
      }

      miner.state = (indexPathMiner !== null) ? "running" :"idle";
      const indexPathMinerInitial = indexPathMiner;
      let indexPathTarget = null;
      let distMax = 0;
      let dAttach = null;
      let attachSnap = Math.max(0.03, guidepathAttachTolerance);
      let attachBlocked = false;

      // Update jump cycle
      const r = Math.hypot(miner.x, miner.y) || 1;
      miner.jumpCycle += 1.5 * dt * r / this.planet.planetRadius;
      miner.jumpCycle -= Math.floor(miner.jumpCycle);

      if (miner.state === "running"){
        indexPathTarget = (guidePathIndexShip !== null) ? guidePathIndexShip : guidePath.indexClosest;
        distMax = (landed ? GAME.MINER_RUN_SPEED : GAME.MINER_JOG_SPEED) * dt;
        const posAttach = posFromPathIndex(guidePath.path, indexPathMiner);
        const dxAttach = posAttach.x - miner.x;
        const dyAttach = posAttach.y - miner.y;
        dAttach = Math.hypot(dxAttach, dyAttach);
        if (dAttach > attachSnap){
          attachBlocked = !this._segmentPlanetAirClear(miner.x, miner.y, posAttach.x, posAttach.y, 0.02);
        }
        if (attachBlocked){
          // Prevent cliff-climb style snapping through rock.
          miner.state = "idle";
          indexPathMiner = null;
        } else
        if (dAttach > attachSnap){
          // Never teleport onto the path: move at most one miner step.
          const step = Math.min(distMax, dAttach);
          miner.x += (dxAttach / dAttach) * step;
          miner.y += (dyAttach / dAttach) * step;
        } else {
          if (indexPathMiner < indexPathTarget) {
            indexPathMiner = moveAlongPathPositive(guidePath.path, indexPathMiner, distMax, indexPathTarget);
          } else if (indexPathMiner > indexPathTarget) {
            indexPathMiner = moveAlongPathNegative(guidePath.path, indexPathMiner, distMax, indexPathTarget);
            console.assert(indexPathMiner >= 0);
          }

          const posNew = posFromPathIndex(guidePath.path, indexPathMiner);
          const rNew = Math.hypot(posNew.x, posNew.y);
          const scalePos = 1 + pathRaiseAmount / rNew;
          miner.x = posNew.x * scalePos;
          miner.y = posNew.y * scalePos;

          // Final leg to ship center after reaching the on-surface target index.
          if (Math.abs(indexPathMiner - indexPathTarget) <= 0.08){
            const dxShip = this.ship.x - miner.x;
            const dyShip = this.ship.y - miner.y;
            const dShip = Math.hypot(dxShip, dyShip);
            if (dShip > 1e-5){
              const stepShip = Math.min(distMax, dShip);
              miner.x += (dxShip / dShip) * stepShip;
              miner.y += (dyShip / dShip) * stepShip;
            }
          }
        }
      }
      const minerMoved = Math.hypot(miner.x - prevMinerX, miner.y - prevMinerY);
      if (
        minerPathDebugEnabled &&
        this._minerPathDebugCooldown <= 0 &&
        !minerPathDebugRecord &&
        dt > 0 &&
        landed &&
        guidePathUsable
      ){
        const rMiner = Math.hypot(prevMinerX, prevMinerY);
        if (
          indexPathMinerInitial === null &&
          attachDebug &&
          Number.isFinite(attachDebug.nearestDist) &&
          attachDebug.nearestDist <= attachDist * 2.25
        ){
          minerPathDebugRecord = {
            reason: "idle_no_attach",
            minerIndex: i,
            minerType: miner.type,
            ship: { x: this.ship.x, y: this.ship.y },
            miner: { x: prevMinerX, y: prevMinerY, r: rMiner },
            attachDist,
            attach: attachDebug,
          };
        } else if (indexPathMinerInitial !== null){
          const pathDelta = (indexPathTarget !== null) ? Math.abs(indexPathMinerInitial - indexPathTarget) : 0;
          const shouldStepToAttach = Number.isFinite(dAttach) && dAttach > (attachSnap + 1e-4);
          const shouldStepAlongPath = Number.isFinite(pathDelta) && pathDelta > 0.06;
          if (attachBlocked){
            minerPathDebugRecord = {
              reason: "attach_blocked_by_terrain",
              minerIndex: i,
              minerType: miner.type,
              ship: { x: this.ship.x, y: this.ship.y },
              miner: { x: prevMinerX, y: prevMinerY, moved: minerMoved, r: rMiner },
              path: {
                indexInitial: indexPathMinerInitial,
                indexFinal: indexPathMiner,
                indexTarget: indexPathTarget,
                deltaToTarget: pathDelta,
              },
              step: {
                distMax,
                dAttach,
                attachSnap,
              },
              attachDist,
              attach: attachDebug,
            };
          } else if ((shouldStepToAttach || shouldStepAlongPath) && distMax > 1e-4 && minerMoved < 1e-5){
            minerPathDebugRecord = {
              reason: "running_no_step",
              minerIndex: i,
              minerType: miner.type,
              ship: { x: this.ship.x, y: this.ship.y },
              miner: { x: prevMinerX, y: prevMinerY, moved: minerMoved, r: rMiner },
              path: {
                indexInitial: indexPathMinerInitial,
                indexFinal: indexPathMiner,
                indexTarget: indexPathTarget,
                deltaToTarget: pathDelta,
              },
              step: {
                distMax,
                dAttach,
                attachSnap,
              },
              attachDist,
              attach: attachDebug,
            };
          }
        }
      }

      const upx = miner.x / r;
      const upy = miner.y / r;
      const headX = miner.x + upx * this.MINER_HEAD_OFFSET;
      const headY = miner.y + upy * this.MINER_HEAD_OFFSET;
      const footX = miner.x - upx * this.MINER_HEAD_OFFSET * 0.32;
      const footY = miner.y - upy * this.MINER_HEAD_OFFSET * 0.32;
      const hullDistHead = this._shipConvexHullDistance(headX, headY, this.ship.x, this.ship.y);
      const hullDistBody = this._shipConvexHullDistance(miner.x, miner.y, this.ship.x, this.ship.y);
      const hullDistFeet = this._shipConvexHullDistance(footX, footY, this.ship.x, this.ship.y);
      const hullDist = Math.min(hullDistHead, hullDistBody, hullDistFeet);
      const centerDist = Math.min(
        Math.hypot(headX - this.ship.x, headY - this.ship.y),
        Math.hypot(miner.x - this.ship.x, miner.y - this.ship.y),
        Math.hypot(footX - this.ship.x, footY - this.ship.y),
      );
      const boardNearShip = centerDist <= (this._shipRadius() + GAME.MINER_BOARD_RADIUS);
      if (landed && hullDist <= GAME.MINER_BOARD_RADIUS && boardNearShip){
        if (miner.type === "miner"){
          ++this.ship.dropshipMiners;
        } else if (miner.type === "pilot"){
          ++this.ship.dropshipPilots;
        } else if (miner.type === "engineer"){
          ++this.ship.dropshipEngineers;
        }
        this.minersRemaining = Math.max(0, this.minersRemaining - 1);
        const tx = -upy;
        const ty = upx;
        const jitter = (Math.random() * 2 - 1) * GAME.MINER_POPUP_TANGENTIAL;
        this.popups.push({
          x: miner.x + upx * 0.1,
          y: miner.y + upy * 0.1,
          vx: upx * GAME.MINER_POPUP_SPEED + tx * jitter,
          vy: upy * GAME.MINER_POPUP_SPEED + ty * jitter,
          text: "+1",
          life: GAME.MINER_POPUP_LIFE,
        });
        this._playSfx("miner_rescued", {
          volume: 0.45,
          rate: 0.95 + Math.random() * 0.1,
        });
        this.miners.splice(i, 1);
      }
    }
    this.debugMinerPathToMiner = (landed && guidePathUsable) ? debugMinerPathToMiner : null;
    if (minerPathDebugEnabled && this._minerPathDebugCooldown <= 0 && minerPathDebugRecord){
      console.log("[minerDbg]", minerPathDebugRecord);
      this._minerPathDebugCooldown = 0.35;
    }

    if (this.popups.length){
      for (let i = this.popups.length - 1; i >= 0; i--){
        const p = this.popups[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) this.popups.splice(i, 1);
      }
    }

    if (this.shipHitPopups.length){
      for (let i = this.shipHitPopups.length - 1; i >= 0; i--){
        const p = this.shipHitPopups[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) this.shipHitPopups.splice(i, 1);
      }
    }

    if (this.debris.length){
      for (let i = this.debris.length - 1; i >= 0; i--){
        const d = this.debris[i];
        const r = Math.hypot(d.x, d.y) || 1;
        const {x: gx, y: gy} = this.planet.gravityAt(d.x, d.y);
        d.vx += gx * dt;
        d.vy += gy * dt;
        d.vx *= Math.max(0, 1 - this.planetParams.DRAG * dt);
        d.vy *= Math.max(0, 1 - this.planetParams.DRAG * dt);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.a += d.w * dt;
        d.life -= dt;
        if (d.life <= 0) this.debris.splice(i, 1);
      }
    }

    this.enemies.update(this.ship, dt);
    this._updateFactorySpawns(dt);
    this._resolveEnemySolidPropCollisions();

    if (this.ship.state !== "crashed"){
      for (let i = this.enemies.shots.length - 1; i >= 0; i--){
        const s = this.enemies.shots[i];
        if (this._enemyShotHitsShip(s, dt)){
          this.enemies.shots.splice(i, 1);
          this._damageShip(s.x, s.y);
          continue;
        }
      }
    }

    if (this.ship.state !== "crashed" && this.enemies.explosions.length){
      const shipR = this._shipRadius();
      for (const ex of this.enemies.explosions){
        const r = (ex.radius ?? 1.0) + shipR;
        const dx = this.ship.x - ex.x;
        const dy = this.ship.y - ex.y;
        if (dx * dx + dy * dy <= r * r){
          this._damageShip(ex.x, ex.y);
          break;
        }
      }
    }

    if (this.ship.state === "landed"){
      if (wantsDropshipLiftoff({ left, right, thrust, stickThrust })){
        this.ship.state = "flying";
        this.ship._dock = null;
        this.hasLaunchedPlayerShip = true;
      }
    }
  }

  /**
   * @returns {void}
   */
  _frame(){
    const now = performance.now();
    const rawDt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    const transitionActive = this.jumpdriveTransition.isActive();
    const touchStartActionMode = transitionActive ? null : this._touchStartActionMode();
    const touchStartPromptActive = touchStartActionMode !== null;
    this.input.setTouchStartPromptActive(touchStartPromptActive);
    this.input.setGameOver(!transitionActive && this.ship.state === "crashed");
    if (this.input && typeof this.input.setDebugCommandsEnabled === "function"){
      this.input.setDebugCommandsEnabled(this.devHudVisible);
    }
    const inputState = this.input.update();
    if (!transitionActive && inputState.toggleFrameStep){
      this.debugFrameStepMode = !this.debugFrameStepMode;
      this.accumulator = 0;
      this._showStatusCue(this.debugFrameStepMode ? "Frame step on (Alt+L, Space steps)" : "Frame step off");
    }
    if (this.debugFrameStepMode || transitionActive){
      inputState.thrust = false;
    }
    if (!transitionActive && inputState.zoomReset){
      this._resetManualZoom();
      this._showZoomCue();
    }
    if (!transitionActive && typeof inputState.zoomDelta === "number" && Math.abs(inputState.zoomDelta) > 1e-4){
      this._applyManualZoomDelta(inputState.zoomDelta);
    }
    if (this.helpPopup && typeof this.helpPopup.setTouchMode === "function"){
      this.helpPopup.setTouchMode(inputState.inputType === "touch");
    }
    const helpOpen = !!(this.helpPopup && this.helpPopup.isOpen && this.helpPopup.isOpen());
    const fixed = 1 / 60;
    const stepFrame = !!(this.debugFrameStepMode && inputState.stepFrame && !helpOpen);
    const dt = helpOpen ? 0 : (this.debugFrameStepMode ? (stepFrame ? fixed : 0) : rawDt);
    if (this.newGameHelpPromptT > 0){
      this.newGameHelpPromptT = Math.max(0, this.newGameHelpPromptT - dt);
    }
    if (helpOpen){
      this.accumulator = 0;
      this._setThrustLoopActive(false);
    } else if (this.debugFrameStepMode){
      this.accumulator = stepFrame ? fixed : 0;
      if (!stepFrame){
        this._setThrustLoopActive(false);
      }
    } else {
      this.accumulator += dt;
    }

    this.levelAdvanceReady =
      !transitionActive &&
      this.pendingPerkChoice === null &&
      this.ship.mothershipEngineers <= 0 &&
      this._objectiveComplete() &&
      this._isDockedWithMothership();
    if (!transitionActive){
      this._updateStartTitle(dt, inputState);
    }

    if (!transitionActive && this.ship.state === "crashed"){
      this.ship.explodeT = Math.min(1.2, this.ship.explodeT + dt * 0.9);
    }

    if (!transitionActive && inputState.regen){
      const nextSeed = this.planet.getSeed() + 1;
      this._beginLevel(nextSeed, this.level);
    }
    if (!transitionActive && inputState.prevLevel){
      if (this.level > 1){
        const nextSeed = this.planet.getSeed() + 1;
        this._startJumpdriveTransition(nextSeed, this.level - 1);
      }
    } else if (!transitionActive && inputState.nextLevel){
      const nextSeed = this.planet.getSeed() + 1;
      this._startJumpdriveTransition(nextSeed, this.level + 1);
    }
    if (inputState.toggleDebug){
      this.debugCollisions = !this.debugCollisions;
    }
    if (inputState.toggleDevHud){
      this.devHudVisible = !this.devHudVisible;
      this.hud.style.display = this.devHudVisible ? "block" : "none";
      if (this.input && typeof this.input.setDebugCommandsEnabled === "function"){
        this.input.setDebugCommandsEnabled(this.devHudVisible);
      }
    }
    if (inputState.togglePlanetView){
      this.planetView = !this.planetView;
    }
    if (inputState.toggleRingVertices){
      this.debugRingVertices = !this.debugRingVertices;
      this._showStatusCue(this.debugRingVertices ? "Ring vertex debug on" : "Ring vertex debug off");
    }
    if (inputState.togglePlanetTriangles){
      this.debugPlanetTriangles = !this.debugPlanetTriangles;
      this._showStatusCue(this.debugPlanetTriangles ? "Planet triangle outlines on" : "Planet triangle outlines off");
    }
    if (inputState.toggleCollisionContours){
      this.debugCollisionContours = !this.debugCollisionContours;
      this._showStatusCue(this.debugCollisionContours ? "Collision contour debug on" : "Collision contour debug off");
    }
    if (inputState.toggleMinerGuidePath){
      this.debugMinerGuidePath = !this.debugMinerGuidePath;
      this._showStatusCue(this.debugMinerGuidePath ? "Miner guide path debug on" : "Miner guide path debug off");
    }
    if (inputState.toggleFog){
      this.fogEnabled = !this.fogEnabled;
    }
    if (inputState.toggleMusic && this.audio && typeof this.audio.toggleMuted === "function"){
      this.audio.toggleMuted();
    }
    if (inputState.toggleCombatMusic && this.audio && typeof this.audio.toggleCombatMusicEnabled === "function"){
      this.audio.toggleCombatMusicEnabled();
    }
    if (inputState.musicVolumeDown && this.audio && typeof this.audio.stepMusicVolume === "function"){
      const nextPct = this.audio.stepMusicVolume(-1);
      this._showStatusCue(`Music volume ${nextPct}%`);
    } else if (inputState.musicVolumeUp && this.audio && typeof this.audio.stepMusicVolume === "function"){
      const nextPct = this.audio.stepMusicVolume(1);
      this._showStatusCue(`Music volume ${nextPct}%`);
    } else if (inputState.sfxVolumeDown && this.audio && typeof this.audio.stepSfxVolume === "function"){
      const nextPct = this.audio.stepSfxVolume(-1);
      this._showStatusCue(`FX volume ${nextPct}%`);
    } else if (inputState.sfxVolumeUp && this.audio && typeof this.audio.stepSfxVolume === "function"){
      const nextPct = this.audio.stepSfxVolume(1);
      this._showStatusCue(`FX volume ${nextPct}%`);
    }
    if (inputState.rescueAll) {
      this._rescueAll();
    }
    if (inputState.killAllEnemies){
      this._killAllEnemiesAndFactories();
    }
    const captureScreenshot = !!inputState.copyScreenshot;
    const captureScreenshotClean = !!inputState.copyScreenshotClean;
    const captureScreenshotCleanTitle = !!inputState.copyScreenshotCleanTitle;

    const maxSteps = 4;
    let steps = 0;
    while (this.accumulator >= fixed && steps < maxSteps){
      this._step(fixed, inputState);
      // One-shot actions are generated once per rendered frame. Consume them
      // after the first fixed step so catch-up substeps cannot replay them.
      inputState.reset = false;
      inputState.abandonRun = false;
      inputState.shootPressed = false;
      inputState.shoot = false;
      inputState.bomb = false;
      inputState.spawnEnemyType = null;
      this.accumulator -= fixed;
      steps++;
    }
    const objectiveCompleteNow = this._objectiveComplete();
    if (objectiveCompleteNow && this.level >= 16 && !this.victoryMusicTriggered){
      this.victoryMusicTriggered = true;
      this._triggerVictoryMusic();
    }
    if (objectiveCompleteNow && !this.objectiveCompleteSfxPlayed){
      if (!Number.isFinite(this.objectiveCompleteSfxDueAtMs)){
        this.objectiveCompleteSfxDueAtMs = now + this.OBJECTIVE_COMPLETE_SFX_DELAY_MS;
      } else if (now >= this.objectiveCompleteSfxDueAtMs){
        this.objectiveCompleteSfxPlayed = true;
        this.objectiveCompleteSfxDueAtMs = Number.POSITIVE_INFINITY;
        this._playSfx("objective_complete", { volume: 0.75 });
      }
    } else if (!objectiveCompleteNow){
      this.objectiveCompleteSfxDueAtMs = Number.POSITIVE_INFINITY;
    }
    const combatActive =
      !objectiveCompleteNow &&
      this.ship.state !== "crashed" &&
      performance.now() < this.combatThreatUntilMs;
    this._setCombatActive(combatActive);

    const landingDbg = this.devHudVisible ? this.ship._landingDebug : null;
    if (!this.devHudVisible){
      this.ship._landingDebug = null;
      this.ship._lastMothershipCollisionDiag = null;
      this._lastLandingDebugConsoleLine = "";
      this._landingDebugSessionActive = false;
      this._landingDebugSessionFrame = 0;
      this._landingDebugSessionSource = "";
    } else if (landingDbg){
      const fmt = (n) => Number.isFinite(n) ? Number(n).toFixed(2) : "-";
      const fmtI = (n) => Number.isFinite(n) ? String(Math.round(Number(n))) : "-";
      const fmtVec = (v) => {
        if (!v) return "-";
        return `${fmt(v.vx)},${fmt(v.vy)}@${fmt(v.speed)}/${fmt(v.dirDeg)}deg`;
      };
      const fmtNormal = (n) => {
        if (!n) return "-";
        return `${fmt(n.nx)},${fmt(n.ny)}`;
      };
      const fmtHits = (e) => {
        if (!e || !Array.isArray(e.hits)) return "-";
        return e.hits.map((h) => {
          const kind = h && h.kind ? h.kind : "?";
          const edge = Number.isFinite(h && h.edgeIdx) ? h.edgeIdx : "-";
          const hull = Number.isFinite(h && h.hullIdx) ? h.hullIdx : "-";
          return `${kind}[e${edge}/h${hull}]`;
        }).join(",");
      };
      const reason = String(landingDbg.reason || "-");
      let mothershipRelatedNoContact = false;
      if (reason === "mothership_no_contact" && landingDbg.source === "mothership" && this.mothership){
        const shipRadius = this._shipRadius();
        const dx = this.ship.x - this.mothership.x;
        const dy = this.ship.y - this.mothership.y;
        const nearMothership = (dx * dx + dy * dy) <= Math.pow((this.mothership.bounds || 0) + shipRadius + 0.8, 2);
        const overlap = nearMothership && this._shipCollidesWithMothershipAt(this.ship.x, this.ship.y);
        const activeHit = !!(this.ship._collision && this.ship._collision.source === "mothership");
        mothershipRelatedNoContact = overlap || activeHit;
      }
      const hasCollisionEvidence =
        (Number(landingDbg.contactsCount) > 0)
        || (Number(landingDbg.overlapBeforeCount) > 0)
        || (Number(landingDbg.overlapAfterCount) > 0)
        || (Number(landingDbg.depenPush) > 0);
      const landedState = reason.includes("landed");
      const quietState = (reason.includes("no_contact") || reason.includes("graze")) && !hasCollisionEvidence;
      const mothershipSessionCandidate =
        landingDbg.source === "mothership" && reason.startsWith("mothership_") && hasCollisionEvidence;
      // Session ownership follows actual collision/depenetration evidence, not the
      // human-readable reason label. For mothership debugging, keep all emitted
      // mothership lines grouped under a real session id so misclassified
      // `mothership_no_contact` frames do not fall back to sid:-.
      const sessionActive = !!(!landedState && (
        hasCollisionEvidence
        || mothershipRelatedNoContact
        || mothershipSessionCandidate
      ));
      let sessionId = this._landingDebugSessionActive ? this._landingDebugSessionId : 0;
      let sessionFrame = this._landingDebugSessionActive ? this._landingDebugSessionFrame : 0;
      if (sessionActive){
        if (!this._landingDebugSessionActive){
          this._landingDebugSessionActive = true;
          this._landingDebugSessionId = this._landingDebugSessionIdNext++;
          this._landingDebugSessionFrame = 1;
          this._landingDebugSessionSource = String(landingDbg.source || "");
          console.log(`[landDbgStart] sid:${this._landingDebugSessionId} src:${landingDbg.source || "-"} r:${reason}`);
        } else {
          this._landingDebugSessionFrame += 1;
        }
        sessionId = this._landingDebugSessionId;
        sessionFrame = this._landingDebugSessionFrame;
      } else if (this._landingDebugSessionActive){
        console.log(
          `[landDbgEnd] sid:${this._landingDebugSessionId} frames:${this._landingDebugSessionFrame} end:${reason}`
        );
        this._landingDebugSessionActive = false;
        this._landingDebugSessionFrame = 0;
        this._landingDebugSessionSource = "";
        sessionId = 0;
        sessionFrame = 0;
      }
      if (landingDbg.collisionDiag){
        landingDbg.collisionDiag.session = {
          id: sessionId,
          frame: sessionFrame,
          active: this._landingDebugSessionActive,
          reason,
        };
      }
      const line =
        `[landDbg] sid:${sessionId || "-"} sf:${sessionFrame || "-"} src:${landingDbg.source || "-"} r:${reason} `
        + `lu:${fmt(landingDbg.dotUp)} sl:${fmt(landingDbg.slope)}<=${fmt(landingDbg.landSlope)} `
        + `vn:${fmt(landingDbg.vn)} vt:${fmt(landingDbg.vt)} sp:${fmt(landingDbg.speed)} `
        + `af:${fmt(landingDbg.airFront)} ab:${fmt(landingDbg.airBack)} `
        + `sup:${landingDbg.support ? 1 : 0}@${fmt(landingDbg.supportDist)} `
        + `ok:${landingDbg.landable ? 1 : 0} `
        + `c:${landingDbg.contactsCount ?? -1} bd:${fmt(landingDbg.bestDotUpAny)}/${fmt(landingDbg.bestDotUpUnder)} `
        + `ip:${landingDbg.impactPoint ?? -1}@${fmt(landingDbg.impactT)} sp:${landingDbg.supportPoint ?? -1}@${fmt(landingDbg.supportT)} `
        + `tri:o${landingDbg.supportTriOuterCount ?? -1} a:${fmt(landingDbg.supportTriAirMin)}-${fmt(landingDbg.supportTriAirMax)} `
        + `r:${fmt(landingDbg.supportTriRMin)}-${fmt(landingDbg.supportTriRMax)} `
        + `ov:${fmtI(landingDbg.overlapBeforeCount)}>${fmtI(landingDbg.overlapAfterCount)} `
        + `ovm:${fmt(landingDbg.overlapBeforeMin)}>${fmt(landingDbg.overlapAfterMin)} `
        + `dep:${fmt(landingDbg.depenPush)} csh:${fmt(landingDbg.depenCushion)} d:${fmtI(landingDbg.depenDir)} i:${fmtI(landingDbg.depenIter)} clr:${landingDbg.depenCleared ? 1 : 0}`;
      const diag = landingDbg.collisionDiag || null;
      const detailLine = diag
        ? ` phase:${diag.phase || "-"}`
          + ` hits:${diag.hitCount ?? "-"}`
          + ` avgNormal:${fmtNormal(diag.averageNormal)}`
          + ` baseW:${fmtVec(diag.baseAtContact)}`
          + ` relInW:${fmtVec(diag.relIn)}`
          + ` relOutW:${fmtVec(diag.relOut)}`
          + ` baseL:${fmtVec(diag.baseAtContactLocal)}`
          + ` relInL:${fmtVec(diag.relInLocal)}`
          + ` relOutL:${fmtVec(diag.relOutLocal)}`
          + ` vnIn:${fmt(diag.vnIn)}`
          + ` vtIn:${fmt(diag.vtIn)}`
          + ` vnOut:${fmt(diag.vnOut)}`
          + ` vtOut:${fmt(diag.vtOut)}`
          + ` evidence:${diag.evidence && diag.evidence.reason ? diag.evidence.reason : "-"}`
          + ` hitList:${fmtHits(diag.evidence)}`
          + ` sweepDbg:${diag.evidence && diag.evidence.debug ? [
            `s${diag.evidence.debug.sampleCount ?? 0}`,
            `e${diag.evidence.debug.edgeCount ?? 0}`,
            `cand${diag.evidence.debug.candidateCount ?? 0}`,
            `air${diag.evidence.debug.rejectStartNotAir ?? 0}`,
            `solid${diag.evidence.debug.rejectEndNotSolid ?? 0}`,
            `seg${diag.evidence.debug.rejectSegment ?? 0}`,
            `t${diag.evidence.debug.rejectT ?? 0}`,
            `feat${diag.evidence.debug.featureKeptCount ?? 0}/${diag.evidence.debug.featureGroupCount ?? 0}`,
            `early${diag.evidence.debug.earliestCandidateCount ?? 0}`,
            `keep${diag.evidence.debug.clusterKeptCount ?? 0}/${diag.evidence.debug.clusterInputCount ?? 0}`,
            `inside${diag.evidence.debug.insideCount ?? 0}`,
          ].join("|") : "-"}`
          + ` dock:${diag.dock ? `${fmt(diag.dock.lx)},${fmt(diag.dock.ly)} n:${fmt(diag.dock.localNx)},${fmt(diag.dock.localNy)} floor:${diag.dock.dockFloorNormal ? 1 : 0}` : "-"}`
          + ` backoff:${diag.backoff ? `${fmt(diag.backoff.dist)} dir:${fmt(diag.backoff.dirX)},${fmt(diag.backoff.dirY)} clear:${diag.backoff.cleared ? 1 : 0}` : "-"}`
          + ` overlapNow:${diag.overlap ? `${diag.overlap.before ? 1 : 0}->${diag.overlap.after ? 1 : 0}` : "-"}`
        : "";
      const combinedLine = line + detailLine;
      const idleNoContact = (!sessionActive && reason === "mothership_no_contact" && !mothershipRelatedNoContact);
      const shouldLog = !idleNoContact && (sessionActive || line !== this._lastLandingDebugConsoleLine);
      if (shouldLog){
        console.log(combinedLine);
        this._lastLandingDebugConsoleLine = line;
      }
    } else if (this.devHudVisible && this.mothership){
      const shipRadius = this._shipRadius();
      const dx = this.ship.x - this.mothership.x;
      const dy = this.ship.y - this.mothership.y;
      const nearMothership = (dx * dx + dy * dy) <= Math.pow((this.mothership.bounds || 0) + shipRadius + 0.8, 2);
      const overlap = nearMothership && this._shipCollidesWithMothershipAt(this.ship.x, this.ship.y);
      if (this._landingDebugSessionActive && this._landingDebugSessionSource !== "mothership"){
        console.log(
          `[landDbgEnd] sid:${this._landingDebugSessionId} frames:${this._landingDebugSessionFrame} end:no_debug`
        );
        this._landingDebugSessionActive = false;
        this._landingDebugSessionFrame = 0;
        this._landingDebugSessionSource = "";
      }
      if (!this._landingDebugSessionActive && overlap){
        this._landingDebugSessionActive = true;
        this._landingDebugSessionId = this._landingDebugSessionIdNext++;
        this._landingDebugSessionFrame = 0;
        this._landingDebugSessionSource = "mothership";
        console.log(`[landDbgStart] sid:${this._landingDebugSessionId} src:mothership r:mothership_trace_overlap`);
      }
      if (this._landingDebugSessionActive && this._landingDebugSessionSource === "mothership"){
        if (nearMothership){
          this._landingDebugSessionFrame += 1;
          const sid = this._landingDebugSessionId;
          const sf = this._landingDebugSessionFrame;
          const c = Math.cos(-this.mothership.angle);
          const s = Math.sin(-this.mothership.angle);
          const lx = c * dx - s * dy;
          const ly = s * dx + c * dy;
          const relVx = this.ship.vx - this.mothership.vx;
          const relVy = this.ship.vy - this.mothership.vy;
          const relLx = c * relVx - s * relVy;
          const relLy = s * relVx + c * relVy;
          const traceLine =
            `[landDbgGap] sid:${sid} sf:${sf} src:mothership `
            + `r:${overlap ? "mothership_trace_overlap" : "mothership_trace_near"} `
            + `ship:${this.ship.x.toFixed(2)},${this.ship.y.toFixed(2)} `
            + `dock:${lx.toFixed(2)},${ly.toFixed(2)} `
            + `relW:${relVx.toFixed(2)},${relVy.toFixed(2)}@${Math.hypot(relVx, relVy).toFixed(2)} `
            + `relL:${relLx.toFixed(2)},${relLy.toFixed(2)}@${Math.hypot(relLx, relLy).toFixed(2)} `
            + `overlap:${overlap ? 1 : 0}`;
          if (traceLine !== this._lastLandingDebugConsoleLine){
            console.log(traceLine);
            this._lastLandingDebugConsoleLine = traceLine;
          }
        } else {
          console.log(
            `[landDbgEnd] sid:${this._landingDebugSessionId} frames:${this._landingDebugSessionFrame} end:trace_far`
          );
          this._landingDebugSessionActive = false;
          this._landingDebugSessionFrame = 0;
          this._landingDebugSessionSource = "";
        }
      }
    } else if (this.devHudVisible && this._landingDebugSessionActive){
      console.log(
        `[landDbgEnd] sid:${this._landingDebugSessionId} frames:${this._landingDebugSessionFrame} end:no_debug`
      );
      this._landingDebugSessionActive = false;
      this._landingDebugSessionFrame = 0;
      this._landingDebugSessionSource = "";
    }

    this.levelAdvanceReady =
      this.pendingPerkChoice === null &&
      this.ship.mothershipEngineers <= 0 &&
      objectiveCompleteNow &&
      this._isDockedWithMothership();

    this.fpsFrames++;
    if (now - this.fpsTime >= 500){
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsTime));
      this.fpsFrames = 0;
      this.fpsTime = now;
    }

    const gameOver = !transitionActive && this.ship.state === "crashed";
    if (!transitionActive){
      this.planet.syncRenderFog(this.renderer, this.ship.x, this.ship.y);
    }
    /** @type {RenderState} */
    let renderState = {
      view: this._viewState(),
      ship: this.ship,
      mothership: this.mothership,
      debris: this.debris,
      input: inputState,
      debugCollisions: this.debugCollisions,
      debugNodes: GAME.DEBUG_NODES,
      debugPlanetTriangles: this.debugPlanetTriangles,
      debugCollisionContours: this.debugCollisionContours,
      debugRingVertices: this.debugRingVertices,
      debugMinerGuidePath: this.debugMinerGuidePath,
      debugMinerPathToMiner: this.debugMinerPathToMiner,
      debugCollisionSamples: (this.debugCollisions || this.debugCollisionContours) ? (this.ship._samples || []) : null,
      debugPoints: ((this.debugCollisions && GAME.DEBUG_NODES) || this.debugRingVertices) ? this.planet.debugPoints() : null,
      fogEnabled: this.fogEnabled,
      fps: this.fps,
      finalAir: this.planet.getFinalAir(),
      miners: this.miners,
      minersRemaining: this.minersRemaining,
      minerTarget: this.minerTarget,
      level: this.level,
      minersDead: this.minersDead,
      enemies: this.enemies.enemies,
      shots: this.enemies.shots,
      explosions: this.enemies.explosions,
      enemyDebris: this.enemies.debris,
      playerShots: this.playerShots,
      playerBombs: this.playerBombs,
      featureParticles: this.planet.getFeatureParticles(),
      entityExplosions: this.entityExplosions,
      aimWorld: gameOver ? null : this.lastAimWorld,
      aimOrigin: gameOver ? null : this._shipGunPivotWorld(),
      planetPalette: this._planetPalette(),
      touchUi: gameOver ? null : inputState.touchUi,
      touchStart: inputState.inputType === "touch" && touchStartPromptActive,
      touchStartMode: inputState.inputType === "touch" ? touchStartActionMode : null,
    };
    if (transitionActive){
      renderState = this.jumpdriveTransition.decorateRenderState(renderState);
    }
    this._lastRenderState = renderState;
    this.renderer.drawFrame(renderState, this.planet);

    this._drawMinerPopups();
    if ((captureScreenshotClean || captureScreenshot || captureScreenshotCleanTitle) && !this.screenshotCopyInFlight){
      const mode = captureScreenshotCleanTitle ? "cleanTitle" : (captureScreenshotClean ? "clean" : "full");
      const clean = mode !== "full";
      const includeStartTitle = mode === "cleanTitle" || (clean && !this.startTitleSeen && this.startTitleAlpha > 0);
      this.screenshotCopyInFlight = true;
      void copyGameplayScreenshotToClipboard({
        canvas: this.canvas,
        overlay: this.overlay,
        renderState,
        clean,
        drawFrame: (state) => this.renderer.drawFrame(state, this.planet),
        redrawOverlay: () => this._drawMinerPopups(),
        includeStartTitle,
        startTitleText: this.startTitleText || "DROPSHIP",
        startTitleAlpha: (mode === "cleanTitle")
          ? 1
          : this.startTitleAlpha,
      }).then((result) => {
        if (result === "ok"){
          this._showStatusCue(
            mode === "cleanTitle"
              ? "Title screenshot copied"
              : clean
                ? "Clean screenshot copied"
                : "Screenshot copied"
          );
        } else if (result === "unsupported"){
          this._showStatusCue("Clipboard image copy unsupported");
        } else {
          this._showStatusCue("Screenshot copy failed");
        }
      }).finally(() => {
        this.screenshotCopyInFlight = false;
      });
    }

    if (this.devHudVisible){
      this.ui.updateHud(this.hud, {
        fps: this.fps,
        state: this.ship.state,
        speed: Math.hypot(this.ship.vx, this.ship.vy),
        shipHp: this.ship.hpCur,
        bombs: this.ship.bombsCur,
        verts: this.planet.radial.vertCount,
        air: this.planet.getFinalAir(),
        miners: this.minersRemaining,
        minersDead: this.minersDead,
        level: this.level,
        debug: this.debugCollisions,
        minerCandidates: this.minerCandidates,
        landingDebug: this.ship._landingDebug || null,
        inputType: inputState.inputType,
      });
    }
    const heat = this.ship.heat || 0;
    const showHeat = !transitionActive && this._heatMechanicsActive();
    const heating = showHeat && (heat > this.lastHeat + 0.1);
    this.lastHeat = heat;
    if (this.heatMeter && this.ui.updateHeatMeter){
      this.ui.updateHeatMeter(this.heatMeter, heat, showHeat, heating);
    }
    const titleShowing = !this.startTitleSeen && this.startTitleAlpha > 0;
    if (this.planetLabel){
      this.planetLabel.style.visibility = (titleShowing || transitionActive) ? "hidden" : "visible";
      if (!titleShowing && !transitionActive && this.ui.updatePlanetLabel){
        const cfg = this.planet.getPlanetConfig();
        const label = cfg ? cfg.label : "";
        const prefix = `Level ${this.level}: `;
        this.ui.updatePlanetLabel(this.planetLabel, label ? `${prefix}${label}` : `Level ${this.level}`);
      }
    }
    if (this.objectiveLabel){
      this.objectiveLabel.style.visibility = transitionActive ? "hidden" : "visible";
      const abandonHoldActive = !!inputState.abandonHoldActive;
      const abandonHoldRemainingMs = (typeof inputState.abandonHoldRemainingMs === "number")
        ? inputState.abandonHoldRemainingMs
        : 0;
      this.objectiveLabel.style.color = abandonHoldActive ? "rgb(255, 72, 72)" : "";
      if (this.ui.updateObjectiveLabel){
        if (abandonHoldActive){
          this.ui.updateObjectiveLabel(this.objectiveLabel, this._abandonHoldCountdownText(abandonHoldRemainingMs));
        } else {
          const cue = (now < this.statusCueUntil) ? this.statusCueText : "";
          if (cue){
            this.ui.updateObjectiveLabel(this.objectiveLabel, cue);
          } else if (titleShowing && this.ship.state !== "crashed"){
            this.ui.updateObjectiveLabel(this.objectiveLabel, this._startObjectiveText(inputState.inputType));
          } else {
            const prompt = this._objectivePromptText(inputState.inputType);
            const objectiveText = prompt || this._objectiveText();
            if (this.ship.state !== "crashed" && this.newGameHelpPromptT > 0){
              const helpLine = this._helpPromptLine(inputState.inputType);
              this.ui.updateObjectiveLabel(this.objectiveLabel, objectiveText ? `${helpLine}\n${objectiveText}` : helpLine);
            } else {
              this.ui.updateObjectiveLabel(this.objectiveLabel, objectiveText);
            }
          }
        }
      }
    }
    if (this.shipStatusLabel){
      this.shipStatusLabel.style.visibility = (titleShowing || transitionActive) ? "hidden" : "visible";
      if (!titleShowing && !transitionActive && this.ui.updateShipStatusLabel){
        this.ui.updateShipStatusLabel(this.shipStatusLabel, {
          shipHp: this.ship.hpCur,
          shipHpMax: this.ship.hpMax,
          bombs: this.ship.bombsCur,
          bombsMax: this.ship.bombsMax,
        });
      }
    }

    requestAnimationFrame(() => this._frame());
  }

  /**
   * @param {number} dt
   * @param {import("./types.d.js").InputState} inputState
   * @returns {void}
   */
  _updateStartTitle(dt, inputState){
    if (this.startTitleSeen) return;

    if (!this.startTitleFade && this._hasAnyPlayerInput(inputState)){
      this.startTitleFade = true;
    }
    if (!this.startTitleFade) return;

    this.startTitleAlpha = Math.max(0, this.startTitleAlpha - this.START_TITLE_FADE_PER_SEC * Math.max(0, dt));
    if (this.startTitleAlpha <= 0){
      this.startTitleSeen = true;
      this.startTitleAlpha = 0;
    }
  }

  /**
   * @param {import("./types.d.js").InputState} inputState
   * @returns {boolean}
   */
  _hasAnyPlayerInput(inputState){
    if (inputState.left || inputState.right || inputState.thrust || inputState.down) return true;
    if (inputState.shootHeld || inputState.shootPressed || inputState.shoot || inputState.bomb || inputState.reset || inputState.abandonRun) return true;
    if (inputState.regen || inputState.nextLevel || inputState.prevLevel) return true;
    if (inputState.toggleDebug || inputState.toggleDevHud || inputState.togglePlanetView || inputState.toggleCollisionContours || inputState.toggleMinerGuidePath || inputState.toggleFog) return true;
    if (inputState.copyScreenshot || inputState.copyScreenshotClean || inputState.copyScreenshotCleanTitle) return true;
    if (inputState.zoomReset) return true;
    if (typeof inputState.zoomDelta === "number" && Math.abs(inputState.zoomDelta) > 1e-4) return true;
    if (inputState.rescueAll || inputState.spawnEnemyType !== null) return true;
    if (inputState.inputType === "touch" && (inputState.aim || inputState.aimShoot || inputState.aimBomb)) return true;
    if (inputState.inputType === "gamepad" && (inputState.aim || inputState.aimShoot || inputState.aimBomb)) return true;
    const st = inputState.stickThrust;
    return !!(st && (st.x * st.x + st.y * st.y) > 0);
  }

  /**
   * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
   * @returns {string}
   */
  _objectivePromptText(inputType){
    const type = inputType || "keyboard";
    const startButtonPrefix =
      (type === "touch") ? "Tap Play to " :
      (type === "gamepad") ? "Press Button0 to " :
      "Press R to ";
    if (this.pendingPerkChoice){
      if (type === "touch") return "Choose upgrade: use left/right thrust controls.";
      if (type === "gamepad") return "Choose upgrade: press left/right.";
      return "Choose upgrade: press left/right.";
    } else if (this.ship.state === "crashed"){
      if (this.ship.mothershipPilots > 0){
        return startButtonPrefix + "launch a new dropship.";
      } else {
        return "Game over. " + startButtonPrefix + "start a new game.";
      }
    } else if (this._isDockedWithMothership()) {
      if (this.ship.mothershipEngineers > 0){
        return startButtonPrefix + "choose an upgrade.";
      } else if (this.levelAdvanceReady){
        return startButtonPrefix + "fly to next planet.";
      } else if (this.ship.planetScanner){
        if (this.planetView){
          return startButtonPrefix + "exit planet scan.";
        } else {
          return startButtonPrefix + "view planet scan.";
        }
      }
    } else if (this._objectiveComplete()) {
      if (this.objective && this.objective.type === "destroy_core"){
        return "Core meltdown! Return to mothership.";
      }
      return "Objective complete! Return to mothership.";
    }
    return "";
  }

  /**
   * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
   * @returns {string}
   */
  _startObjectiveText(inputType){
    return `Lift off to start, or press ${this._helpActionLabel(inputType)} for help.`;
  }

  /**
   * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
   * @returns {string}
   */
  _helpPromptLine(inputType){
    return `Press ${this._helpActionLabel(inputType)} for help. ${this._abandonPromptText(inputType || "keyboard")}`;
  }

  /**
   * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
   * @returns {string}
   */
  _abandonPromptText(inputType){
    const type = inputType || "keyboard";
    if (type === "touch") return "Hold ↻ to restart.";
    if (type === "gamepad") return "Hold Start to restart.";
    return "Hold Shift+R to restart.";
  }

  /**
   * @returns {string}
   */
  _abandonHoldCountdownText(remainingMs){
    const ms = Math.max(0, remainingMs || 0);
    return `Abandoning run in ${Math.ceil(ms / 1000)} seconds`;
  }

  /**
   * @returns {void}
   */
  _resetStartTitle(){
    this.startTitleText = "DROPSHIP";
    this.startTitleAlpha = 1;
    this.startTitleFade = false;
    this.startTitleSeen = false;
  }

  /**
   * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
   * @returns {string}
   */
  _helpActionLabel(inputType){
    const type = inputType || "keyboard";
    if (type === "touch") return "the ? button";
    if (type === "gamepad") return "Button3";
    return "/";
  }

  /**
   * @returns {"respawnShip"|"restartGame"|"upgrade"|"nextLevel"|"viewMap"|"exitMap"|null}
   */
  _touchStartActionMode(){
    if (this.ship.state === "crashed"){
      return (this.ship.mothershipPilots > 0) ? "respawnShip" : "restartGame";
    }
    if (!this._isDockedWithMothership()){
      return null;
    }
    if (this.pendingPerkChoice !== null){
      return null;
    }
    if (this.ship.mothershipEngineers > 0) return "upgrade";
    if (this.levelAdvanceReady) return "nextLevel";
    if (this.ship.planetScanner) return this.planetView ? "exitMap" : "viewMap";
    return null;
  }

  /**
   * @returns {boolean}
   */
  _objectiveComplete(){
    const objType = this.objective ? this.objective.type : "extract";
    if (objType === "clear") return this._remainingClearTargets() === 0;
    if (objType === "extract") return this.minersRemaining === 0;
    if (objType === "destroy_core") return this.coreMeltdownActive || this._tetherPropsAlive().length === 0;
    return false;
  }

  /**
   * @returns {void}
   */
  start(){
    if (this.pendingBootJumpdriveIntro){
      this.pendingBootJumpdriveIntro = false;
      this._startCurrentLevelJumpdriveIntro();
    }
    requestAnimationFrame(() => this._frame());
  }

  /**
   * @returns {void}
   */
  _onSuccessfullyDocked(){
    let y = 0.5;
    const r = Math.hypot(this.ship.x, this.ship.y);
    const upx = this.ship.x / r;
    const upy = this.ship.y / r;
    const addPopup = (msg) => {
      this.popups.push({
        x: this.ship.x + upx * y,
        y: this.ship.y + upy * y,
        vx: this.mothership.vx + upx * GAME.MINER_POPUP_SPEED,
        vy: this.mothership.vy + upy * GAME.MINER_POPUP_SPEED,
        text: msg,
        life: 2.0,
      });
      y += 0.25;
    };
    const addGroupPopup = (name, count) => {
      if (count <= 0) return;
      addPopup(name + " +" + count);
    };

    addGroupPopup("pilot", this.ship.dropshipPilots);
    addGroupPopup("engineer", this.ship.dropshipEngineers);
    addGroupPopup("miner", this.ship.dropshipMiners);
    addGroupPopup("hull", this.ship.hpMax - this.ship.hpCur);
    addGroupPopup("bomb", this.ship.bombsMax - this.ship.bombsCur);

    this.ship.mothershipMiners += this.ship.dropshipMiners;
    this.ship.mothershipPilots += this.ship.dropshipPilots;
    this.ship.mothershipEngineers += this.ship.dropshipEngineers;
    this.ship.dropshipMiners = 0;
    this.ship.dropshipPilots = 0;
    this.ship.dropshipEngineers = 0;
    this.ship.hpCur = this.ship.hpMax;
    this.ship.bombsCur = this.ship.bombsMax;
  }

  /**
   * @returns {boolean}
   */
  _isDockedWithMothership(){
    // need to be docked inside mothership, not on the roof
    return (this.ship.state === "landed" && this.ship._dock !== null && this.ship._dock.ly > 0.5);
  }

  /**
   * @returns {Array<string>}
   */
  _perksAvailable(){
    /** @type {Array<string>} */
    const perksAvailable = [];
    perksAvailable.push("hpMax");
    perksAvailable.push("bombsMax");
    if (this.ship.thrust < 3){
      perksAvailable.push("thrust");
    }
    if (this.ship.gunPower < 2){
      perksAvailable.push("gunPower");
    }
    if (!this.ship.rescueeDetector){
      perksAvailable.push("rescueeDetector");
    }
    if (!this.ship.planetScanner){
      perksAvailable.push("planetScanner");
    }
    return perksAvailable;
  }

  /**
   * @param {Array<string>} perksAvailable
   * @returns {Array<string>}
   */
  _pickPerkChoices(perksAvailable){
    console.assert(perksAvailable.length >= 2);
    const idx0 = Math.floor(Math.random() * perksAvailable.length);
    let idx1 = Math.floor(Math.random() * (perksAvailable.length - 1));
    if (idx1 >= idx0) idx1 += 1;
    return [perksAvailable[idx0], perksAvailable[idx1]];
  }

  /**
   * @param {string} perk
   * @returns {string}
   */
  _perkChoiceText(perk){
    if (perk === "hpMax") return "Reinforced hull: +1 max HP";
    if (perk === "bombsMax") return "Expanded payload bay: +1 max bomb";
    if (perk === "thrust") return "Engine tune-up: +10% thrust power";
    if (perk === "gunPower") return "Firepower: +1 HP damage";
    if (perk === "rescueeDetector") return "Rescuee detector: locate stranded crew";
    if (perk === "planetScanner") return "Planet scanner: scan planet from mothership";
    return perk;
  }

  /**
   * @returns {void}
   */
  _presentNextPerkChoice(){
    console.assert(this.ship.mothershipEngineers > 0);
    const perksAvailable = this._perksAvailable();
    const perkChoices = this._pickPerkChoices(perksAvailable);
    this.pendingPerkChoice = perkChoices.map((perk) => {return { perk: perk, text: this._perkChoiceText(perk)};});
    --this.ship.mothershipEngineers;
  }

  /**
   * @param {string} perk
   * @returns {void}
   */
  _applyPerk(perk){
    if (perk === "hpMax"){
      ++this.ship.hpMax;
      this.ship.hpCur = this.ship.hpMax;
    } else if (perk === "bombsMax"){
      ++this.ship.bombsMax;
      this.ship.bombsCur = this.ship.bombsMax;
    } else if (perk === "thrust"){
      ++this.ship.thrust;
    } else if (perk === "gunPower"){
      ++this.ship.gunPower;
    } else if (perk === "rescueeDetector"){
      this.ship.rescueeDetector = true;
    } else if (perk === "planetScanner"){
      this.ship.planetScanner = true;
    }
  }

  /**
   * @param {boolean} leftPressed
   * @param {boolean} rightPressed
   * @returns {void}
   */
  _handlePerkChoiceInput(leftPressed, rightPressed){
    const i = leftPressed ? 0 : rightPressed ? 1 : 2;
    if (i < this.pendingPerkChoice.length){
      this._applyPerk(this.pendingPerkChoice[i].perk);
      this.pendingPerkChoice = null;
    }
  }

  /**
   * @returns {void}
   */
  _restartWithNewPilot(){
    console.log('Restart: num pilots', this.ship.mothershipPilots);
    this.ship.mothershipPilots = Math.max(0, this.ship.mothershipPilots - 1);
    this._resetShip();
  }

  /**
   * Abandon current run: clear persisted save and start from level 1.
   * @returns {void}
   */
  _abandonRunAndRestart(){
    clearSavedGame();
    const nextSeed = this.planet.getSeed() + 1;
    this._beginNewGameWithIntro(nextSeed);
  }

  /**
   * @returns {void}
   */
  _rescueAll(){
    for (let i = this.miners.length - 1; i >= 0; i--){
      const miner = this.miners[i];
      if (miner.type === "miner"){
        ++this.ship.dropshipMiners;
      } else if (miner.type === "pilot"){
        ++this.ship.dropshipPilots;
      } else if (miner.type === "engineer"){
        ++this.ship.dropshipEngineers;
      }
      this.minersRemaining = Math.max(0, this.minersRemaining - 1);
      this.miners.splice(i, 1);
    }

    if (this._isDockedWithMothership()){
      this._onSuccessfullyDocked();
    }
  }

  /**
   * Debug helper: remove all active enemies and destroy all active factories.
   * @returns {void}
   */
  _killAllEnemiesAndFactories(){
    let enemyCount = 0;
    if (this.enemies && this.enemies.enemies){
      for (const e of this.enemies.enemies){
        if (e && (e.hp || 0) > 0) enemyCount++;
      }
      this.enemies.enemies.length = 0;
      if (this.enemies.shots) this.enemies.shots.length = 0;
      if (this.enemies.explosions) this.enemies.explosions.length = 0;
      if (this.enemies.debris) this.enemies.debris.length = 0;
    }

    let factories = 0;
    if (this.planet && this.planet.props){
      for (const p of this.planet.props){
        if (p.type !== "factory") continue;
        if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
        this._destroyFactoryProp(p);
        factories++;
      }
    }
    if (factories > 0){
      this._syncTetherProtectionStates();
    }
    if (enemyCount > 0 || factories > 0){
      this._showStatusCue(`Debug clear: ${enemyCount} enemies, ${factories} factories`);
    } else {
      this._showStatusCue("Debug clear: no enemies or factories alive");
    }
  }

  /**
   * Build a versioned runtime snapshot suitable for localStorage.
   * @returns {any}
   */
  createSaveSnapshot(){
    return createLoopSaveSnapshot(this);
  }

  /**
   * Restore a previously serialized runtime snapshot.
   * @param {any} snapshot
   * @returns {boolean}
   */
  restoreFromSaveSnapshot(snapshot){
    this.pendingBootJumpdriveIntro = false;
    this.jumpdriveTransition.cancel();
    return restoreLoopFromSaveSnapshot(this, snapshot);
  }

  /**
   * @returns {void}
   */
  _drawMinerPopups(){
    if (!this.overlay || !this.overlayCtx){
      return;
    }

    const ctx = this.overlayCtx;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = Math.floor(this.overlay.clientWidth * dpr);
    const h = Math.floor(this.overlay.clientHeight * dpr);
    if (this.overlay.width !== w || this.overlay.height !== h){
      this.overlay.width = w;
      this.overlay.height = h;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (this.jumpdriveTransition.isActive()){
      this.jumpdriveTransition.drawOverlay(ctx, w, h, dpr, this._lastRenderState);
      ctx.globalAlpha = 1;
      return;
    }
    const showStartTitle = !this.startTitleSeen && this.startTitleAlpha > 0;
    if (!showStartTitle && !this.popups.length && !this.shipHitPopups.length && !this.lastAimScreen && !this.pendingPerkChoice){
      return;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(12, Math.round(16 * dpr))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    const screenT = this._screenTransform(w / h);

    for (const p of this.popups){
      const t = Math.max(0, Math.min(1, p.life / GAME.MINER_POPUP_LIFE));
      const alpha = 0.9 * t;
      const screen = this._worldToScreenNorm(p.x, p.y, screenT);
      const px = screen.x * w;
      const py = screen.y * h;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255, 236, 170, 1)";
      ctx.fillText(p.text, px, py);
    }
    for (const p of this.shipHitPopups){
      const t = Math.max(0, Math.min(1, p.life / GAME.SHIP_HIT_POPUP_LIFE));
      const alpha = 0.9 * t;
      const screen = this._worldToScreenNorm(p.x, p.y, screenT);
      const px = screen.x * w;
      const py = screen.y * h;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255, 80, 80, 1)";
      ctx.fillText("-1", px, py);
    }

    if (this.lastAimScreen && this.ship.state !== "crashed"){
      const px = this.lastAimScreen.x * w;
      const py = this.lastAimScreen.y * h;
      const r = Math.max(6, Math.round(10 * dpr));
      const cross = Math.max(4, Math.round(r * 0.6));
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = "rgba(120, 255, 220, 1)";
      ctx.lineWidth = Math.max(1, Math.round(2 * dpr));
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.moveTo(px - cross, py);
      ctx.lineTo(px + cross, py);
      ctx.moveTo(px, py - cross);
      ctx.lineTo(px, py + cross);
      ctx.stroke();
    }

    if (this.pendingPerkChoice){
      const panelW = Math.min(w * 0.92, 900 * dpr);
      const panelH = Math.min(h * 0.52, 380 * dpr);
      const x = (w - panelW) * 0.5;
      const y = (h - panelH) * 0.5;

      const panelGrad = ctx.createLinearGradient(0, y, 0, y + panelH);
      panelGrad.addColorStop(0, "rgba(14, 16, 28, 0.96)");
      panelGrad.addColorStop(1, "rgba(8, 10, 18, 0.96)");
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = panelGrad;
      ctx.fillRect(x, y, panelW, panelH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255, 215, 110, 0.95)";
      ctx.lineWidth = Math.max(1, Math.round(2 * dpr));
      ctx.strokeRect(x, y, panelW, panelH);
      const lineY = y + panelH * 0.30;
      const linePad = panelW * 0.12;
      ctx.strokeStyle = "rgba(120, 210, 255, 0.55)";
      ctx.lineWidth = Math.max(1, Math.round(1.25 * dpr));
      ctx.beginPath();
      ctx.moveTo(x + linePad, lineY);
      ctx.lineTo(x + panelW - linePad, lineY);
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255, 240, 190, 1)";
      const fontFamily = "\"Science Gothic\", ui-sans-serif, system-ui, sans-serif";
      const titlePx = fitCanvasFontPx(ctx, "Choose an Upgrade", 700, Math.round(24 * dpr), Math.round(14 * dpr), panelW * 0.84, fontFamily);
      ctx.font = `700 ${titlePx}px ${fontFamily}`;
      ctx.fillText("Choose an Upgrade", x + panelW * 0.5, y + panelH * 0.18);

      const left = this.pendingPerkChoice[0];
      const right = this.pendingPerkChoice[1];
      const bodyPx = Math.max(Math.round(12 * dpr), Math.round(panelW * 0.017));
      const lineHeight = Math.max(Math.round(15 * dpr), Math.round(bodyPx * 1.24));
      ctx.font = `600 ${bodyPx}px ${fontFamily}`;
      ctx.fillStyle = "rgba(200, 235, 255, 1)";
      drawCenteredWrappedText(ctx, `[LEFT] ${left ? left.text : ""}`, x + panelW * 0.5, y + panelH * 0.40, panelW * 0.84, lineHeight, 2);
      ctx.fillStyle = "rgba(255, 214, 180, 1)";
      drawCenteredWrappedText(ctx, `[RIGHT] ${right ? right.text : ""}`, x + panelW * 0.5, y + panelH * 0.64, panelW * 0.84, lineHeight, 2);
    }

    if (showStartTitle){
      drawStartTitle(ctx, w, h, dpr, this.startTitleText, this.startTitleAlpha);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} weight
 * @param {number} maxPx
 * @param {number} minPx
 * @param {number} maxWidth
 * @param {string} family
 * @returns {number}
 */
function fitCanvasFontPx(ctx, text, weight, maxPx, minPx, maxWidth, family){
  let px = Math.max(minPx, maxPx);
  while (px > minPx){
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px -= 1;
  }
  return Math.max(minPx, px);
}

/**
 * Draw centered wrapped text from a top anchor.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} cx
 * @param {number} topY
 * @param {number} maxWidth
 * @param {number} lineHeight
 * @param {number} maxLines
 * @returns {void}
 */
function drawCenteredWrappedText(ctx, text, cx, topY, maxWidth, lineHeight, maxLines){
  const rawWords = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!rawWords.length) return;
  /** @type {string[]} */
  const words = [];
  for (const token of rawWords){
    if (ctx.measureText(token).width <= maxWidth){
      words.push(token);
      continue;
    }
    let chunk = "";
    for (const ch of token){
      const next = chunk + ch;
      if (chunk && ctx.measureText(next).width > maxWidth){
        words.push(chunk);
        chunk = ch;
      } else {
        chunk = next;
      }
    }
    if (chunk) words.push(chunk);
  }

  /** @type {string[]} */
  const lines = [];
  let line = "";
  for (const word of words){
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth){
      lines.push(line);
      line = word;
      if (lines.length >= maxLines - 1) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines){
    lines.push(line);
  }
  if (!lines.length) return;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let i = 0; i < lines.length; i++){
    ctx.fillText(lines[i], cx, topY + i * lineHeight);
  }
}
