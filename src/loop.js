// @ts-check

import { GAME } from "./config.js";
import { Enemies } from "./enemies.js";
import { createCollisionRouter } from "./collision-router.js";
import { CFG } from "./config.js";
import { Mothership, updateMothership, mothershipCollisionInfo } from "./mothership.js";
import { Planet } from "./planet.js";
import { pickPlanetConfig, pickPlanetConfigById, resolvePlanetParams } from "./planet_config.js";
import { mulberry32 } from "./rng.js";

/** @typedef {import("./types.d.js").ViewState} ViewState */
/** @typedef {import("./types.d.js").Ship} Ship */
/** @typedef {import("./types.d.js").Miner} Miner */
/** @typedef {import("./types.d.js").Ui} Ui */
/** @typedef {import("./planet_config.js").PlanetTypeId} PlanetTypeId */
/** @typedef {import("./planet_config.js").PlanetConfig} PlanetConfig */

export class GameLoop {
  /**
   * Main gameplay loop orchestrator.
   * @param {Object} deps
   * @param {import("./rendering.js").Renderer} deps.renderer
   * @param {import("./input.js").Input} deps.input
   * @param {Ui} deps.ui
   * @param {HTMLCanvasElement} deps.canvas
   * @param {HTMLCanvasElement|null|undefined} deps.overlay
   * @param {HTMLElement} deps.hud
   * @param {HTMLElement} [deps.planetLabel]
   * @param {HTMLElement} [deps.objectiveLabel]
   * @param {HTMLElement} [deps.heatMeter]
   */
  constructor({ renderer, input, ui, canvas, hud, overlay, planetLabel, objectiveLabel, heatMeter }){
    this.level = 1;
    const planetConfig = this._planetConfigFromLevel(this.level);
    const planetParams = resolvePlanetParams(CFG.seed, this.level, planetConfig, GAME);
    this.planet = new Planet({ seed: CFG.seed, planetConfig, planetParams });
    this.planetParams = planetParams;
    this.renderer = renderer;
    this.renderer.setPlanet(this.planet);
    this.input = input;
    this.ui = ui;
    this.canvas = canvas;
    this.hud = hud;
    this.planetLabel = planetLabel || null;
    this.objectiveLabel = objectiveLabel || null;
    this.heatMeter = heatMeter || null;
    this.overlay = overlay || null;
    this.overlayCtx = this.overlay ? this.overlay.getContext("2d") : null;

    this.TERRAIN_PAD = 0.5;
    this.TERRAIN_MAX = this.planetParams.RMAX + this.TERRAIN_PAD;
    this.TERRAIN_IMPACT_RADIUS = 0.75;
    this.SHIP_RADIUS_BASE = 0.7 * 0.28 * GAME.SHIP_SCALE * 1.5;
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

      dropshipMiners: 0,
      dropshipPilots: 0,
      dropshipEngineers: 0,

      mothershipMiners: 0,
      mothershipPilots: 0,
      mothershipEngineers: 0,

      hpMax: GAME.SHIP_STARTING_MAX_HP,
      bombsMax: GAME.SHIP_STARTING_MAX_BOMBS,
      thrust: 0,
      rescueeDetector: false,
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
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    this.minerPopups = [];
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    this.shipHitPopups = [];
    /** @type {{x:number,y:number}|null} */
    this.lastAimWorld = null;
    /** @type {{x:number,y:number}|null} */
    this.lastAimScreen = null;

    this.PLAYER_SHOT_SPEED = 7.5;
    this.PLAYER_SHOT_LIFE = 1.2;
    this.PLAYER_SHOT_RADIUS = 0.22;
    this.PLAYER_BOMB_SPEED = 4.5;
    this.PLAYER_BOMB_LIFE = 3.2;
    this.PLAYER_BOMB_RADIUS = 0.35;
    this.PLAYER_BOMB_BLAST = 0.9;
    this.PLAYER_BOMB_DAMAGE = 1.2;
    this.SHIP_HIT_BLAST = 0.55;
    this.ENEMY_HIT_BLAST = 0.35;

    /** @type {Miner[]} */
    this.miners = [];
    this.minersRemaining = 0;
    this.minersDead = 0;
    this.minerTarget = 0;
    this.minerCandidates = 0;
    /** @type {import("./types.d.js").CollisionQuery} */
    this.collision = createCollisionRouter(this.planet, () => this.mothership);
    this.objective = this._buildObjective(planetConfig, this.level);
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
    });

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
    this.levelAdvanceReady = false;
    this.lastHeat = 0;

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
        enemy.hp = Math.max(0, enemy.hp - 1);
        enemy.hitT = 0.25;
        this.entityExplosions.push({ x: enemy.x, y: enemy.y, life: 0.25, radius: this.ENEMY_HIT_BLAST });
      },
      onMinerKilled: () => {
        this.minersRemaining = Math.max(0, this.minersRemaining - 1);
        this.minersDead++;
      },
    };
    this.planetView = false;
    this.fogEnabled = true;
    /** @type {{options:[{perk:string,text:string},{perk:string,text:string}], index:number, total:number}|null} */
    this.pendingPerkChoice = null;
    this.pendingPerkChoicesRemaining = 0;
    this.pendingPerkChoicesTotal = 0;
    this.perkChoicePrevInput = { left: false, right: false };
    this.perkChoiceArmed = false;
    this.blockControlsUntilRelease = false;
  }

  /**
   * @param {number} lvl
   * @returns {number}
   */
  _totalEnemiesForLevel(lvl){
    const cfg = this.planet ? this.planet.getPlanetConfig() : null;
    const base = (cfg && typeof cfg.enemyCountBase === "number") ? cfg.enemyCountBase : 5;
    const per = (cfg && typeof cfg.enemyCountPerLevel === "number") ? cfg.enemyCountPerLevel : 5;
    const cap = (cfg && typeof cfg.enemyCountCap === "number") ? cfg.enemyCountCap : 30;
    const count = base + Math.max(0, (lvl | 0) - 1) * per;
    return Math.min(cap, count);
  }

  /**
   * @returns {number}
   */
  _targetMinersForLevel(){
    const cfg = this.planet ? this.planet.getPlanetConfig() : null;
    const base = (cfg && typeof cfg.minerCountBase === "number") ? cfg.minerCountBase : 0;
    const per = (cfg && typeof cfg.minerCountPerLevel === "number") ? cfg.minerCountPerLevel : 0;
    const cap = (cfg && typeof cfg.minerCountCap === "number") ? cfg.minerCountCap : 0;
    return Math.min(cap, base + Math.max(0, this.level - 1) * per);
  }

  /**
   * @param {import("./planet_config.js").PlanetConfig} cfg
   * @param {number} lvl
   * @returns {{type:string,target:number}}
   */
  _buildObjective(cfg, lvl){
    const obj = cfg && cfg.objective ? cfg.objective : { type: "extract", count: 0 };
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
   * @returns {string}
   */
  _objectiveText(){
    if (!this.objective) return "";
    if (this.objective.type === "clear"){
      const remaining = this.enemies ? this.enemies.enemies.length : 0;
      const target = this.objective.target || 0;
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
    this.ship._dock = {lx: GAME.MOTHERSHIP_START_DOCK_X, ly: GAME.MOTHERSHIP_START_DOCK_Y};
    this.debris.length = 0;
    this.playerShots.length = 0;
    this.playerBombs.length = 0;
    this.entityExplosions.length = 0;
    this.minerPopups.length = 0;
    this.shipHitPopups.length = 0;
    this.planet.clearFeatureParticles();
    this.lastAimWorld = null;
    this.lastAimScreen = null;
    this.lastHeat = 0;
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
    this.ship.hpCur = Math.max(0, this.ship.hpCur - 1);
    this.ship.hitCooldown = GAME.SHIP_HIT_COOLDOWN;
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
   * @returns {ViewState}
   */
  _viewState() {
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
    // Bombs do not modify terrain.
    return;
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
        e.hp = Math.max(0, e.hp - 1);
        e.hitT = 0.25;
        this.entityExplosions.push({ x: e.x, y: e.y, life: 0.25, radius: this.ENEMY_HIT_BLAST });
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
      const turretPositions = this.enemies && this.enemies.enemies
        ? this.enemies.enemies.filter((e) => e.type === "turret").map((e) => [e.x, e.y])
        : [];
      const rand = mulberry32(seed + 17);
      for (let i = pads.length - 1; i > 0; i--){
        const j = Math.floor(rand() * (i + 1));
        const tmp = pads[i];
        pads[i] = pads[j];
        pads[j] = tmp;
      }
      const minDist = 0.9;
      placed = [];
      for (const pt of pads){
        let tooClose = false;
        for (const t of turretPositions){
          const dx = pt[0] - t[0];
          const dy = pt[1] - t[1];
          if (dx * dx + dy * dy < minDist * minDist){
            tooClose = true;
            break;
          }
        }
        if (tooClose) continue;
        placed.push(pt);
        if (placed.length >= count) break;
      }
    } else {
      const standable = this.planet.getStandablePoints();
      placed = this.planet.sampleStandablePoints(count, seed, "uniform", GAME.MINER_MIN_SEP, true);
      if (cfg && cfg.id === "molten"){
        const moltenOuter = this.planetParams.MOLTEN_RING_OUTER || 0;
        const minR = moltenOuter + 0.6;
        placed = placed.filter((p) => (Math.hypot(p[0], p[1]) >= minR));
      }
      if (placed.length < count){
        console.error("[Level] miners spawn insufficient standable points", {
          level: this.level,
          target: count,
          placed: placed.length,
          standable: standable.length,
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
   * @returns {void}
   */
  /**
   * @param {number} level 
   * @returns {PlanetConfig}
   */
  _planetConfigFromLevel(level){
    /** @type {PlanetTypeId|undefined} */
    const configOverride = undefined;
    const planetConfig =
      (configOverride !== undefined) ? pickPlanetConfigById(configOverride) :
      (level === 1) ? pickPlanetConfigById("barren_pickup") :
      (level === 2) ? pickPlanetConfigById("barren_clear") :
      pickPlanetConfig(CFG.seed, this.level);
    return planetConfig;
  }

  /**
   * @param {number} seed
   * @param {boolean} advanceLevel
   * @returns {void}
   */
  _beginLevel(seed, advanceLevel){
    if (advanceLevel) this.level++;
    const planetConfig = this._planetConfigFromLevel(this.level);
    const planetParams = resolvePlanetParams(seed, this.level, planetConfig, GAME);
    this.planet = new Planet({ seed, planetConfig, planetParams });
    this.planetParams = planetParams;
    this.objective = this._buildObjective(planetConfig, this.level);
    console.log("[Level] begin", {
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
    this.TERRAIN_MAX = this.planetParams.RMAX + this.TERRAIN_PAD;
    this.SURFACE_EPS = Math.max(0.12, this.planetParams.RMAX / 280);
    this.COLLISION_EPS = Math.max(0.18, this.planetParams.RMAX / 240);
    this.mothership = new Mothership({ RMAX: this.planetParams.RMAX, MOTHERSHIP_ORBIT_HEIGHT: this.planetParams.MOTHERSHIP_ORBIT_HEIGHT }, this.planet);
    this.collision = createCollisionRouter(this.planet, () => this.mothership);
    this.enemies = new Enemies({
      planet: this.planet,
      collision: this.collision,
      total: this._totalEnemiesForLevel(this.level),
      level: this.level,
      levelSeed: this.planet.getSeed(),
      placement: planetConfig.enemyPlacement || "random",
    });
    console.log("[Level] enemies spawned", { level: this.level, enemies: this.enemies.enemies.length });
    this.renderer.setPlanet(this.planet);
    this._resetShip();
    this.entityExplosions.length = 0;
    this._spawnMiners();
    this.planet.reconcileFeatures({
      enemies: this.enemies.enemies,
      miners: this.miners,
    });
    this.minerPopups.length = 0;
    this.planet.clearFeatureParticles();
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Array<[number, number]>}
   */
  _shipCollisionPoints(x, y){
    const camRot = Math.atan2(x, y || 1e-6);
    const shipRot = -camRot;
    const local = this._shipLocalHullPoints();
    /** @type {Array<[number, number]>} */
    const verts = [];
    const c = Math.cos(shipRot), s = Math.sin(shipRot);
    for (const [lx, ly] of local){
      const wx = c * lx - s * ly;
      const wy = s * lx + c * ly;
      verts.push([x + wx, y + wy]);
    }
    return verts;
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
  _shipHullDistance(px, py, shipX, shipY){
    const camRot = Math.atan2(shipX, shipY || 1e-6);
    const shipRot = -camRot;
    const local = this._shipLocalHullPoints();
    const c = Math.cos(shipRot);
    const s = Math.sin(shipRot);
    const verts = local.map(([lx, ly]) => {
      const wx = c * lx - s * ly;
      const wy = s * lx + c * ly;
      return [shipX + wx, shipY + wy];
    });
    let best = Infinity;
    for (let i = 0; i < verts.length; i++){
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const d = this._distPointToSegment(px, py, a[0], a[1], b[0], b[1]);
      if (d < best) best = d;
    }
    return best;
  }

  _shipRadius(){
    return this.SHIP_RADIUS_BASE * 1.2;
  }

  _shipGunPivotWorld(){
    const shipHWorld = 0.7 * GAME.SHIP_SCALE;
    const shipWWorld = 0.75 * GAME.SHIP_SCALE;
    const bodyLiftN = 0.18;
    const cargoHeightScale = 2.0;
    const cargoBottomN = -0.35;
    const cargoHeightN = (0.18 - cargoBottomN) * cargoHeightScale;
    const cargoTopN = cargoBottomN + cargoHeightN;
    const gstrutHN = 0.12;
    const gunLiftN = 0.04;
    const localX = 0;
    const localY = (cargoTopN + gstrutHN + gunLiftN + bodyLiftN) * shipHWorld;
    const camRot = Math.atan2(this.ship.x, this.ship.y || 1e-6);
    const shipRot = -camRot;
    const c = Math.cos(shipRot), s = Math.sin(shipRot);
    const wx = c * (localX * shipWWorld) - s * localY;
    const wy = s * (localX * shipWWorld) + c * localY;
    return { x: this.ship.x + wx, y: this.ship.y + wy };
  }

  _shipLocalHullPoints(){
    const shipHWorld = 0.7 * GAME.SHIP_SCALE;
    const shipWWorld = 0.7 * GAME.SHIP_SCALE;
    const bodyLiftN = 0.18;
    const bodyLift = shipHWorld * bodyLiftN;
    const cargoHeightScale = 2.0;
    const cargoWidthScale = 2 / 3;
    const cargoBottomN = -0.35;
    const cargoHeightN = (0.18 - cargoBottomN) * cargoHeightScale;
    const cargoTopN = cargoBottomN + cargoHeightN;
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
   * @param {number} x
   * @param {number} y
   * @param {number} shipRadius
   * @returns {boolean}
   */
  _shipCollidesAt(x, y, shipRadius){
    const samples = this._shipCollisionPoints(x, y);
    samples.push([x, y]);
    return this.collision.collidesAtPoints(samples);
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
    if (this.mothership){
      updateMothership(this.mothership, this.planet, dt);
    }
    let { left, right, thrust, down, reset, shoot, bomb, rescueAll, aim, aimShoot, aimBomb, aimShootFrom, aimShootTo, aimBombFrom, aimBombTo, spawnEnemyType } = inputState;
    if (this.blockControlsUntilRelease){
      const held = !!(left || right || thrust || down);
      if (held){
        left = false;
        right = false;
        thrust = false;
        down = false;
      } else {
        this.blockControlsUntilRelease = false;
      }
    }
    if (inputState.inputType === "gamepad"){
      const aimAdjusted = this._aimScreenAroundShip(aim);
      aim = aimAdjusted;
      aimShoot = aimAdjusted;
      aimBomb = aimAdjusted;
    }
    if (this.ship.invertT > 0){
      this.ship.invertT = Math.max(0, this.ship.invertT - dt);
      const tmp = left;
      left = right;
      right = tmp;
      const tmp2 = thrust;
      thrust = down;
      down = tmp2;
    }
    if (!aim && this.lastAimScreen){
      aim = this.lastAimScreen;
    }
    if (!aimShoot) aimShoot = aim;
    if (!aimBomb) aimBomb = aimShoot || aim;
    if (reset && this.ship.state === "crashed" && this.ship.mothershipPilots > 0){
      this._restartWithNewPilot();
    }
    if (rescueAll) {
      this._rescueAll();
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
    if (left && !right) this.ship.cabinSide = -1;
    if (right && !left) this.ship.cabinSide = 1;

    if (this.ship.state === "landed" && this.ship._dock && this.mothership){
      if (left || right || thrust){
        const shipRadius = this._shipRadius();
        const pushStep = shipRadius * 0.35;
        for (let i = 0; i < 8 && this._shipCollidesAt(this.ship.x, this.ship.y, shipRadius); i++){
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
      } else {
        const { lx, ly } = this.ship._dock;
        const c = Math.cos(this.mothership.angle);
        const s = Math.sin(this.mothership.angle);
        this.ship.x = this.mothership.x + c * lx - s * ly;
        this.ship.y = this.mothership.y + s * lx + c * ly;
        this.ship.vx = this.mothership.vx;
        this.ship.vy = this.mothership.vy;
        this.lastAimWorld = null;
        this.lastAimScreen = null;
        // Stay locked to the mothership; skip gravity/collision integration.
        this.enemies.update(this.ship, dt);
        return;
      }
    }

    if (this.ship.hitCooldown > 0){
      this.ship.hitCooldown = Math.max(0, this.ship.hitCooldown - dt);
    }

    if (this.ship.state === "flying"){
      let ax = 0, ay = 0;
      const r = Math.hypot(this.ship.x, this.ship.y) || 1;
      const rx = this.ship.x / r;
      const ry = this.ship.y / r;
      const tx = -ry;
      const ty = rx;

      const thrustMax = this.planetParams.THRUST * (1 + this.ship.thrust * 0.1);

      if (left){
        ax += tx * thrustMax;
        ay += ty * thrustMax;
      }
      if (right){
        ax -= tx * thrustMax;
        ay -= ty * thrustMax;
      }
      if (thrust){
        ax += rx * thrustMax;
        ay += ry * thrustMax;
      }
      if (down){
        ax += -rx * thrustMax;
        ay += -ry * thrustMax;
      }
      /*
      const aThrustSqr = ax*ax + ay*ay;
      if (aThrustSqr > thrustMax * thrustMax) {
        const thrustScale = thrustMax / Math.sqrt(aThrustSqr);
        ax *= thrustScale;
        ay *= thrustScale;
      }
      */

      const {x: gx, y: gy} = this.planet.gravityAt(this.ship.x, this.ship.y);

      this.ship.x += (this.ship.vx + 0.5 * (ax + gx) * dt) * dt;
      this.ship.y += (this.ship.vy + 0.5 * (ay + gy) * dt) * dt;

      const {x: gx2, y: gy2} = this.planet.gravityAt(this.ship.x, this.ship.y);

      this.ship.vx += (ax + (gx + gx2) / 2) * dt;
      this.ship.vy += (ay + (gy + gy2) / 2) * dt;

      /*
      const drag = Math.max(0, 1 - this.planetParams.DRAG * dt);
      this.ship.vx *= drag;
      this.ship.vy *= drag;
      */

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

      let collides = false;
      let { samples, hit, hitSource } = this.collision.sampleCollisionPoints(this._shipCollisionPoints(this.ship.x, this.ship.y));
      collides = !!hit;
      this.ship._samples = samples;
      this.ship._shipRadius = shipRadius;
      if (hit){
        this.ship._collision = {
          x: hit.x,
          y: hit.y,
          tri: this.planet.radial.findTriAtWorld(hit.x, hit.y),
          node: this.planet.radial.nearestNodeOnRing(hit.x, hit.y),
        };
      } else {
        this.ship._collision = null;
      }

      if (collides){
        const mothershipHit = (hitSource === "mothership" && this.mothership);
        if (!mothershipHit){
          // Planet collision: keep original simple response to avoid sticking.
          const gdx = this.planet.airValueAtWorld(this.ship.x + eps, this.ship.y)
            - this.planet.airValueAtWorld(this.ship.x - eps, this.ship.y);
          const gdy = this.planet.airValueAtWorld(this.ship.x, this.ship.y + eps)
            - this.planet.airValueAtWorld(this.ship.x, this.ship.y - eps);
          let nx = gdx;
          let ny = gdy;
          let nlen = Math.hypot(nx, ny);
          if (nlen < 1e-4){
            const c = this.ship._collision;
            if (c){
              nx = this.ship.x - c.x;
              ny = this.ship.y - c.y;
              nlen = Math.hypot(nx, ny);
            }
          }
          if (nlen < 1e-4){
            nx = this.ship.x;
            ny = this.ship.y;
            nlen = Math.hypot(nx, ny) || 1;
          }
          nx /= nlen;
          ny /= nlen;
          const dotUp = (nx * this.ship.x + ny * this.ship.y) / (Math.hypot(this.ship.x, this.ship.y) || 1);
          const vn = this.ship.vx * nx + this.ship.vy * ny;
          const vt = this.ship.vx * -ny + this.ship.vy * nx;

          if (vn < -this.planetParams.CRASH_SPEED) {
            const restitution = -vn;
            this.ship.vx += restitution * nx;
            this.ship.vy += restitution * ny;
            this._triggerCrash();
          } else {
            if (vn < 0) {
              const maxSlope = 1 - Math.cos(Math.PI / 8); // 22.5 deg
              const landSlope = Math.min((1 - GAME.SURFACE_DOT) + 0.03, maxSlope);
              const clearance = (this.ship._shipRadius || 0.25);
              if (dotUp < 0 || !this.planet.isLandableAtWorld(this.ship.x, this.ship.y, landSlope, clearance, 0.2)) {
                const restitution = (1 + GAME.BOUNCE_RESTITUTION) * -vn;
                this.ship.vx += restitution * nx;
                this.ship.vy += restitution * ny;
              } else if (vn >= -this.planetParams.LAND_SPEED && Math.abs(vt) < 0.5){
                this.ship.state = "landed";
                this.ship.vx = 0;
                this.ship.vy = 0;
              } else {
                const restitution = -vn;
                this.ship.vx += restitution * nx;
                this.ship.vy += restitution * ny;
                const friction = this.planetParams.LAND_FRICTION * -vt;
                this.ship.vx += friction * -ny;
                this.ship.vy += friction * nx;
              }
            }

            const maxSteps = 8;
            const stepSize = shipRadius * 0.2;
            for (let i = 0; i < maxSteps && this._shipCollidesAt(this.ship.x, this.ship.y, shipRadius); i++){
              this.ship.x += nx * stepSize;
              this.ship.y += ny * stepSize;
            }
          }
        } else {
          // Mothership collision: field-based handling (same gradient approach as planet).
          const gdx = this.collision.airValueAtWorld(this.ship.x + eps, this.ship.y)
            - this.collision.airValueAtWorld(this.ship.x - eps, this.ship.y);
          const gdy = this.collision.airValueAtWorld(this.ship.x, this.ship.y + eps)
            - this.collision.airValueAtWorld(this.ship.x, this.ship.y - eps);
          let nx = gdx;
          let ny = gdy;
          let nlen = Math.hypot(nx, ny);
          if (nlen < 1e-4){
            const c = this.ship._collision;
            if (c){
              nx = this.ship.x - c.x;
              ny = this.ship.y - c.y;
              nlen = Math.hypot(nx, ny);
            }
          }
          if (nlen < 1e-4){
            nx = this.ship.x;
            ny = this.ship.y;
            nlen = Math.hypot(nx, ny) || 1;
          }
          nx /= nlen;
          ny /= nlen;

          const baseVx = this.mothership.vx;
          const baseVy = this.mothership.vy;
          let relVx = this.ship.vx - baseVx;
          let relVy = this.ship.vy - baseVy;
          const vn = relVx * nx + relVy * ny;
          const vt = relVx * -ny + relVy * nx;

          if (vn < -this.planetParams.CRASH_SPEED) {
            this._triggerCrash();
          } else {
            let landedNow = false;
            if (vn < 0) {
              const maxSlope = 1 - Math.cos(Math.PI / 8); // 22.5 deg
              const landSlope = Math.min((1 - GAME.SURFACE_DOT) + 0.03, maxSlope);
              const cUp = Math.cos(this.mothership.angle);
              const sUp = Math.sin(this.mothership.angle);
              const upx = -sUp;
              const upy = cUp;
              const dotUpRaw = nx * upx + ny * upy;
              const slope = 1 - Math.abs(dotUpRaw);
              const landable = (dotUpRaw < 0 && slope <= landSlope);
              const landVn = this.planetParams.LAND_SPEED * 3.0;
              const landVt = 1.0;
              if (!landable) {
                const restitution = (1 + GAME.BOUNCE_RESTITUTION) * -vn;
                relVx += restitution * nx;
                relVy += restitution * ny;
              } else if (vn >= -landVn && Math.abs(vt) < landVt){
                this.ship.state = "landed";
                // Nudge outward to avoid immediate re-collision bounce.
                const shipRadius = this._shipRadius();
                const lift = shipRadius * 0.3;
                this.ship.x += nx * lift;
                this.ship.y += ny * lift;
                const clearStep = shipRadius * 0.2;
                for (let i = 0; i < 8 && this._shipCollidesAt(this.ship.x, this.ship.y, shipRadius); i++){
                  this.ship.x += nx * clearStep;
                  this.ship.y += ny * clearStep;
                }
                const dx2 = this.ship.x - this.mothership.x;
                const dy2 = this.ship.y - this.mothership.y;
                const c2 = Math.cos(-this.mothership.angle);
                const s2 = Math.sin(-this.mothership.angle);
                const lx2 = c2 * dx2 - s2 * dy2;
                const ly2 = s2 * dx2 + c2 * dy2;
                this.ship._dock = { lx: lx2, ly: ly2 };
                this.ship.vx = this.mothership.vx;
                this.ship.vy = this.mothership.vy;
                // If docked inside the mothership, replenish health and bombs.
                if (ly2 > 0.5) {
                  this._onSuccessfullyDocked();
                }
                landedNow = true;
              } else {
                const restitution = -vn;
                relVx += restitution * nx;
                relVy += restitution * ny;
                const friction = this.planetParams.LAND_FRICTION * -vt;
                relVx += friction * -ny;
                relVy += friction * nx;
                const vn2 = relVx * nx + relVy * ny;
                if (vn2 < 0){
                  relVx -= nx * vn2;
                  relVy -= ny * vn2;
                }
              }
            }

            if (!landedNow){
              const maxSteps = 8;
              const stepSize = shipRadius * 0.2;
              for (let i = 0; i < maxSteps && this._shipCollidesAt(this.ship.x, this.ship.y, shipRadius); i++){
                this.ship.x += nx * stepSize;
                this.ship.y += ny * stepSize;
              }
            }
          }
          if (this.ship.state !== "landed"){
            this.ship.vx = relVx + baseVx;
            this.ship.vy = relVy + baseVy;
          }
        }
      }
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
    this.lastAimWorld = aimWorld;
    if (aim) this.lastAimScreen = aim;

    if (this.ship.state === "crashed"){
      this.ship.guidePath = null;
    } else {
      this.ship.guidePath = this.planet.surfaceGuidePathTo(this.ship.x, this.ship.y, GAME.MINER_CALL_RADIUS);
    }

    if (this.ship.state !== "crashed"){
      if (shoot){
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
        }
      }
    }

    if (this.ship.state !== "crashed"){
      const shipRadius = this._shipRadius() * 0.8;
      this.planet.handleFeatureContact(this.ship.x, this.ship.y, shipRadius, this.featureCallbacks);
    }

    this.planet.updateFeatureEffects(dt, {
      ship: this.ship,
      enemies: this.enemies.enemies,
      miners: this.miners,
      onShipDamage: this.featureCallbacks.onShipDamage,
      onShipHeat: this.featureCallbacks.onShipHeat,
      onEnemyHit: this.featureCallbacks.onEnemyHit,
      onMinerKilled: this.featureCallbacks.onMinerKilled,
    });
    if (this.ship.state !== "crashed"){
      const cfg = this.planet.getPlanetConfig ? this.planet.getPlanetConfig() : null;
      if (cfg && cfg.id === "molten" && (this.ship.heat || 0) >= 100){
        this._triggerCrash();
      }
    }

    if (this.playerShots.length){
      for (let i = this.playerShots.length - 1; i >= 0; i--){
        const s = this.playerShots[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0 || this.collision.airValueAtWorld(s.x, s.y) <= 0.5){
          this.playerShots.splice(i, 1);
          continue;
        }
        if (this.planet.handleFeatureShot(s.x, s.y, this.PLAYER_SHOT_RADIUS, this.featureCallbacks)){
          this.playerShots.splice(i, 1);
          continue;
        }
        for (let j = this.enemies.enemies.length - 1; j >= 0; j--){
          const e = this.enemies.enemies[j];
          if (e.hp <= 0) continue;
          const dx = e.x - s.x;
          const dy = e.y - s.y;
            if (dx * dx + dy * dy <= this.PLAYER_SHOT_RADIUS * this.PLAYER_SHOT_RADIUS){
              e.hp -= 1;
              e.hitT = 0.25;
              this.entityExplosions.push({ x: e.x, y: e.y, life: 0.25, radius: this.ENEMY_HIT_BLAST });
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
          for (let j = this.enemies.enemies.length - 1; j >= 0; j--){
            const e = this.enemies.enemies[j];
            const dx = e.x - b.x;
            const dy = e.y - b.y;
            if (dx * dx + dy * dy <= this.PLAYER_BOMB_RADIUS * this.PLAYER_BOMB_RADIUS){
              this.enemies.enemies.splice(j, 1);
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
        }
      }
    }

    if (this.entityExplosions.length){
      for (let i = this.entityExplosions.length - 1; i >= 0; i--){
        this.entityExplosions[i].life -= dt;
        if (this.entityExplosions[i].life <= 0) this.entityExplosions.splice(i, 1);
      }
    }

    // Build bounding box for guide path for quick rejection
    const guidepathMargin = 1;
    let guidePathMinX = Infinity;
    let guidePathMinY = Infinity;
    let guidePathMaxX = -Infinity;
    let guidePathMaxY = -Infinity;
    const guidePath = this.ship.guidePath;
    if (guidePath) {
      for (const pos of guidePath.path) {
        guidePathMinX = Math.min(guidePathMinX, pos.x);
        guidePathMinY = Math.min(guidePathMinY, pos.y);
        guidePathMaxX = Math.max(guidePathMaxX, pos.x);
        guidePathMaxY = Math.max(guidePathMaxY, pos.y);
      }
      guidePathMinX -= guidepathMargin;
      guidePathMinY -= guidepathMargin;
      guidePathMaxX += guidepathMargin;
      guidePathMaxY += guidepathMargin;
    }

    const landed = this.ship.state === "landed";

    for (let i = this.miners.length - 1; i >= 0; i--){
      const miner = this.miners[i];

      let indexPathMiner = null;
      if (landed && miner.x >= guidePathMinX && miner.y >= guidePathMinY && miner.x <= guidePathMaxX && miner.y <= guidePathMaxY) {
        indexPathMiner = indexPathFromPos(guidePath.path, guidepathMargin, miner.x, miner.y);
      }

      miner.state = (indexPathMiner !== null) ? "running" :"idle";

      // Update jump cycle
      const r = Math.hypot(miner.x, miner.y) || 1;
      miner.jumpCycle += 1.5 * dt * r / this.planet.planetRadius;
      miner.jumpCycle -= Math.floor(miner.jumpCycle);

      if (miner.state === "running"){
        let indexPathTarget = guidePath.indexClosest;

        const distMax = (landed ? GAME.MINER_RUN_SPEED : GAME.MINER_JOG_SPEED) * dt;
        if (indexPathMiner < indexPathTarget) {
          indexPathMiner = moveAlongPathPositive(guidePath.path, indexPathMiner, distMax, indexPathTarget);
        } else if (indexPathMiner > indexPathTarget) {
          indexPathMiner = moveAlongPathNegative(guidePath.path, indexPathMiner, distMax, indexPathTarget);
          console.assert(indexPathMiner >= 0);
        }

        const posNew = posFromPathIndex(guidePath.path, indexPathMiner);
        const rNew = Math.hypot(posNew.x, posNew.y);
        const raiseAmount = 0.02; // raise the miner above the path by this to aid in visibility
        const scalePos = 1 + raiseAmount / rNew;
        miner.x = posNew.x * scalePos;
        miner.y = posNew.y * scalePos;
      }

      const upx = miner.x / r;
      const upy = miner.y / r;
      const headX = miner.x + upx * this.MINER_HEAD_OFFSET;
      const headY = miner.y + upy * this.MINER_HEAD_OFFSET;
      const hullDist = this._shipHullDistance(headX, headY, this.ship.x, this.ship.y);
      if (landed && hullDist <= GAME.MINER_BOARD_RADIUS){
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
        this.minerPopups.push({
          x: miner.x + upx * 0.1,
          y: miner.y + upy * 0.1,
          vx: upx * GAME.MINER_POPUP_SPEED + tx * jitter,
          vy: upy * GAME.MINER_POPUP_SPEED + ty * jitter,
          life: GAME.MINER_POPUP_LIFE,
        });
        this.miners.splice(i, 1);
      }
    }

    if (this.minerPopups.length){
      for (let i = this.minerPopups.length - 1; i >= 0; i--){
        const p = this.minerPopups[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt;
        if (p.life <= 0) this.minerPopups.splice(i, 1);
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

    if (this.ship.state !== "crashed"){
      const shipRadius = this._shipRadius();
      for (let i = this.enemies.shots.length - 1; i >= 0; i--){
        const s = this.enemies.shots[i];
        const dx = this.ship.x - s.x;
        const dy = this.ship.y - s.y;
        if (dx * dx + dy * dy <= shipRadius * shipRadius){
          this.enemies.shots.splice(i, 1);
          this._damageShip(s.x, s.y);
          break;
        }
      }
    }

    if (this.ship.state !== "crashed" && this.enemies.explosions.length){
      for (const ex of this.enemies.explosions){
        const r = ex.radius ?? 1.0;
        const dx = this.ship.x - ex.x;
        const dy = this.ship.y - ex.y;
        if (dx * dx + dy * dy <= r * r){
          this._damageShip(ex.x, ex.y);
          break;
        }
      }
    }

    if (this.ship.state === "landed"){
      if (left || right || thrust){
        this.ship.state = "flying";
        this.ship._dock = null;
      }
    }
  }

  /**
   * @returns {void}
   */
  _frame(){
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.accumulator += dt;

    const perkChoiceActive = !!this.pendingPerkChoice;
    const levelComplete = this._objectiveComplete();
    const docked = (this.ship.state === "landed" && this.ship._dock);
    this.levelAdvanceReady = !perkChoiceActive && !!(levelComplete && docked);
    this.input.setGameOver(this.ship.state === "crashed");
    this.input.setLevelComplete(this.levelAdvanceReady);
    const inputState = this.input.update();

    if (perkChoiceActive){
      this.accumulator = 0;
      this._handlePerkChoiceInput(inputState);
    } else {
      if (this.ship.state === "crashed"){
        this.ship.explodeT = Math.min(1.2, this.ship.explodeT + dt * 0.9);
      }

      if (inputState.regen){
        const nextSeed = this.planet.getSeed() + 1;
        this._beginLevel(nextSeed, false);
      }
      if (inputState.nextLevel){
        const nextSeed = this.planet.getSeed() + 1;
        this._beginLevel(nextSeed, true);
      }

      if (inputState.toggleDebug){
        this.debugCollisions = !this.debugCollisions;
      }
      if (inputState.togglePlanetView){
        this.planetView = !this.planetView;
      }
      if (inputState.toggleFog){
        this.fogEnabled = !this.fogEnabled;
      }

      const fixed = 1 / 60;
      const maxSteps = 4;
      let steps = 0;
      while (this.accumulator >= fixed && steps < maxSteps){
        this._step(fixed, inputState);
        this.accumulator -= fixed;
        steps++;
      }

      if (this.levelAdvanceReady && inputState.advanceLevel){
        const nextSeed = this.planet.getSeed() + 1;
        this._beginLevel(nextSeed, true);
      }
    }

    this.fpsFrames++;
    if (now - this.fpsTime >= 500){
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsTime));
      this.fpsFrames = 0;
      this.fpsTime = now;
    }

    const gameOver = this.ship.state === "crashed";
    this.planet.syncRenderFog(this.renderer, this.ship.x, this.ship.y);
    this.renderer.drawFrame({
      view: this._viewState(),
      ship: this.ship,
      mothership: this.mothership,
      debris: this.debris,
      input: inputState,
      debugCollisions: this.debugCollisions,
      debugNodes: GAME.DEBUG_NODES,
      debugCollisionSamples: this.debugCollisions ? (this.ship._samples || []) : null,
      debugPoints: (this.debugCollisions && GAME.DEBUG_NODES) ? this.planet.debugPoints() : null,
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
      aimWorld: this.lastAimWorld,
      aimOrigin: this._shipGunPivotWorld(),
      planetPalette: this._planetPalette(),
      touchUi: gameOver ? null : inputState.touchUi,
      touchStart: (gameOver || this.levelAdvanceReady) && inputState.inputType === "touch",
    }, this.planet);

    this._drawMinerPopups();

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
      inputType: inputState.inputType,
    });
    const cfg = this.planet.getPlanetConfig ? this.planet.getPlanetConfig() : null;
    const heat = this.ship.heat || 0;
    const showHeat = !!(cfg && cfg.id === "molten");
    const heating = showHeat && (heat > this.lastHeat + 0.1);
    this.lastHeat = heat;
    if (this.heatMeter && this.ui.updateHeatMeter){
      this.ui.updateHeatMeter(this.heatMeter, heat, showHeat, heating);
    }
    if (this.planetLabel && this.ui.updatePlanetLabel){
      const cfg = this.planet.getPlanetConfig();
      const label = cfg ? cfg.label : "";
      const prefix = `Level ${this.level}: `;
      this.ui.updatePlanetLabel(this.planetLabel, label ? `${prefix}${label}` : `Level ${this.level}`);
    }
    if (this.objectiveLabel && this.ui.updateObjectiveLabel){
      const prompt = this._objectivePromptText(inputState.inputType);
      this.ui.updateObjectiveLabel(this.objectiveLabel, prompt || this._objectiveText());
    }

    requestAnimationFrame(() => this._frame());
  }

  /**
   * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
   * @returns {string}
   */
  _objectivePromptText(inputType){
    const type = inputType || "keyboard";
    if (this.pendingPerkChoice){
      if (type === "touch") return "Choose upgrade: use left/right thrust controls.";
      if (type === "gamepad") return "Choose upgrade: press left/right.";
      return "Choose upgrade: press left/right.";
    }
    if (this.ship.state === "crashed"){
      if (this.ship.mothershipPilots > 0){
        if (type === "touch") return "Tap Restart to launch a new dropship.";
        if (type === "gamepad") return "Press Start to launch a new dropship.";
        return "Press R to launch a new dropship.";
      } else {
        return "Game Over! No more pilots. Reload page to restart.";
      }
    }
    if (this.levelAdvanceReady){
      if (type === "touch") return "Objective complete! Tap Restart to fly to next planet.";
      if (type === "gamepad") return "Objective complete! Press Start to fly to next planet.";
      return "Objective complete! Press Space to fly to next planet.";
    }
    return "";
  }

  /**
   * @returns {boolean}
   */
  _objectiveComplete(){
    const objType = this.objective ? this.objective.type : "extract";
    if (objType === "clear") return this.enemies.enemies.length === 0;
    if (objType === "extract") return this.minersRemaining === 0;
    return false;
  }

  /**
   * @returns {void}
   */
  start(){
    requestAnimationFrame(() => this._frame());
  }

  /**
   * @returns {void}
   */
  _onSuccessfullyDocked(){
    const rescuedEngineers = this.ship.dropshipEngineers;

    this.ship.mothershipMiners += this.ship.dropshipMiners;
    this.ship.mothershipPilots += this.ship.dropshipPilots;
    this.ship.mothershipEngineers += this.ship.dropshipEngineers;
    this.ship.dropshipMiners = 0;
    this.ship.dropshipPilots = 0;
    this.ship.dropshipEngineers = 0;

    if (rescuedEngineers > 0){
      if (this.pendingPerkChoicesRemaining <= 0){
        this.pendingPerkChoicesTotal = 0;
      }
      this.pendingPerkChoicesRemaining += rescuedEngineers;
      this.pendingPerkChoicesTotal += rescuedEngineers;
      this._presentNextPerkChoice();
    } else {
      // No engineers rescued, so refill immediately.
      this.ship.hpCur = this.ship.hpMax;
      this.ship.bombsCur = this.ship.bombsMax;
    }
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
    if (!this.ship.rescueeDetector){
      perksAvailable.push("rescueeDetector");
    }
    return perksAvailable;
  }

  /**
   * @param {Array<string>} perksAvailable
   * @returns {[string,string]}
   */
  _pickPerkChoices(perksAvailable){
    if (!perksAvailable.length){
      return ["hpMax", "bombsMax"];
    }
    if (perksAvailable.length === 1){
      return [perksAvailable[0], perksAvailable[0]];
    }
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
    if (perk === "rescueeDetector") return "Rescuee detector: locate stranded crew";
    return perk;
  }

  /**
   * @returns {void}
   */
  _presentNextPerkChoice(){
    if (this.pendingPerkChoicesRemaining <= 0){
      this.pendingPerkChoice = null;
      this.pendingPerkChoicesRemaining = 0;
      this.pendingPerkChoicesTotal = 0;
      this.ship.hpCur = this.ship.hpMax;
      this.ship.bombsCur = this.ship.bombsMax;
      this.blockControlsUntilRelease = true;
      return;
    }
    const total = Math.max(1, this.pendingPerkChoicesTotal || this.pendingPerkChoicesRemaining);
    const index = Math.max(1, total - this.pendingPerkChoicesRemaining + 1);
    const perksAvailable = this._perksAvailable();
    const [leftPerk, rightPerk] = this._pickPerkChoices(perksAvailable);
    this.pendingPerkChoice = {
      options: [
        { perk: leftPerk, text: this._perkChoiceText(leftPerk) },
        { perk: rightPerk, text: this._perkChoiceText(rightPerk) },
      ],
      index,
      total,
    };
    this.perkChoicePrevInput.left = false;
    this.perkChoicePrevInput.right = false;
    this.perkChoiceArmed = false;
  }

  /**
   * @param {string} perk
   * @returns {void}
   */
  _applyPerk(perk){
    console.log("Gained perk:", perk);
    if (perk === "hpMax"){
      ++this.ship.hpMax;
    } else if (perk === "bombsMax"){
      ++this.ship.bombsMax;
    } else if (perk === "thrust"){
      ++this.ship.thrust;
    } else if (perk === "rescueeDetector"){
      this.ship.rescueeDetector = true;
    }
  }

  /**
   * @param {ReturnType<import("./input.js").Input["update"]>} inputState
   * @returns {void}
   */
  _handlePerkChoiceInput(inputState){
    if (!this.pendingPerkChoice){
      this.perkChoicePrevInput.left = !!inputState.left;
      this.perkChoicePrevInput.right = !!inputState.right;
      return;
    }
    const leftPressed = !!inputState.left;
    const rightPressed = !!inputState.right;
    if (!this.perkChoiceArmed){
      if (!leftPressed && !rightPressed){
        this.perkChoiceArmed = true;
      }
      this.perkChoicePrevInput.left = leftPressed;
      this.perkChoicePrevInput.right = rightPressed;
      return;
    }
    const choseLeft = leftPressed && !this.perkChoicePrevInput.left;
    const choseRight = rightPressed && !this.perkChoicePrevInput.right;
    if (choseLeft || choseRight){
      const opt = choseLeft ? this.pendingPerkChoice.options[0] : this.pendingPerkChoice.options[1];
      if (opt){
        this._applyPerk(opt.perk);
      }
      this.pendingPerkChoicesRemaining = Math.max(0, this.pendingPerkChoicesRemaining - 1);
      this._presentNextPerkChoice();
    }
    this.perkChoicePrevInput.left = leftPressed;
    this.perkChoicePrevInput.right = rightPressed;
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
    if (!this.minerPopups.length && !this.shipHitPopups.length && !this.lastAimScreen && !this.pendingPerkChoice){
      return;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(12, Math.round(16 * dpr))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    const screenT = this._screenTransform(w / h);

    for (const p of this.minerPopups){
      const t = Math.max(0, Math.min(1, p.life / GAME.MINER_POPUP_LIFE));
      const alpha = 0.9 * t;
      const screen = this._worldToScreenNorm(p.x, p.y, screenT);
      const px = screen.x * w;
      const py = screen.y * h;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255, 236, 170, 1)";
      ctx.fillText("+1", px, py);
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
      const panelW = Math.min(w * 0.86, 900 * dpr);
      const panelH = Math.min(h * 0.42, 320 * dpr);
      const x = (w - panelW) * 0.5;
      const y = (h - panelH) * 0.5;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(10, 10, 18, 1)";
      ctx.fillRect(x, y, panelW, panelH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255, 215, 110, 0.95)";
      ctx.lineWidth = Math.max(1, Math.round(2 * dpr));
      ctx.strokeRect(x, y, panelW, panelH);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(255, 240, 190, 1)";
      ctx.font = `700 ${Math.max(12, Math.round(22 * dpr))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      ctx.fillText(`Choose a Perk (${this.pendingPerkChoice.index}/${this.pendingPerkChoice.total})`, x + panelW * 0.5, y + panelH * 0.20);

      const left = this.pendingPerkChoice.options[0];
      const right = this.pendingPerkChoice.options[1];
      ctx.font = `600 ${Math.max(11, Math.round(17 * dpr))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      ctx.fillStyle = "rgba(200, 235, 255, 1)";
      ctx.fillText(`[LEFT] ${left ? left.text : ""}`, x + panelW * 0.5, y + panelH * 0.48);
      ctx.fillStyle = "rgba(255, 214, 180, 1)";
      ctx.fillText(`[RIGHT] ${right ? right.text : ""}`, x + panelW * 0.5, y + panelH * 0.70);
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * 
 * @param {Array<{x:number, y:number}>} path 
 * @param {number} distMax
 * @param {number} x 
 * @param {number} y 
 * @returns {number|null}
 */
function indexPathFromPos(path, distMax, x, y) {
  let distClosestSqr = Infinity;
  let indexPath = null;
  for (let i = 1; i < path.length; ++i) {
    const pos0 = path[i-1];
    const pos1 = path[i];
    const dSegX = pos1.x - pos0.x;
    const dSegY = pos1.y - pos0.y;
    const dPosX = x - pos0.x;
    const dPosY = y - pos0.y;
    let u = (dSegX * dPosX + dSegY * dPosY) / (dSegX * dSegX + dSegY * dSegY);
    u = Math.max(0, Math.min(1, u));
    const dPosClosestX = dSegX * u - dPosX;
    const dPosClosestY = dSegY * u - dPosY;
    const distSqr = dPosClosestX*dPosClosestX + dPosClosestY*dPosClosestY;
    if (distSqr > distMax*distMax) continue;
    if (distSqr < distClosestSqr) {
      distClosestSqr = distSqr;
      indexPath = (i - 1) + u;
    }
  }
  return indexPath;
}

/**
 * 
 * @param {Array<{x:number, y:number}>} path 
 * @param {number} indexPath 
 * @returns {{x:number, y:number}}
 */
function posFromPathIndex(path, indexPath) {
  if (path.length === 0) {
    return path[0];
  }
  indexPath = Math.max(0, Math.min(path.length - 1, indexPath));
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;
  if (iSeg === path.length - 1) {
    iSeg -= 1;
    uSeg += 1;
  }
  const x0 = path[iSeg].x;
  const y0 = path[iSeg].y;
  const x1 = path[iSeg+1].x;
  const y1 = path[iSeg+1].y;
  const dSegX = x1 - x0;
  const dSegY = y1 - y0;
  return {x: x0 + dSegX * uSeg, y: y0 + dSegY * uSeg};
}

/**
 * 
 * @param {Array<{x:number, y:number}>} path
 * @param {number} indexPath
 * @param {number} distRemaining
 * @param {number} indexPathMax
 * @returns {number}
 */
function moveAlongPathPositive(path, indexPath, distRemaining, indexPathMax) {
  const iSegMax = Math.floor(indexPathMax);
  const uSegMax = indexPathMax - iSegMax;

  // Unpack indexPath into segment index and fraction of distance along the segment
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;

  while (iSeg > 0 && iSeg + 1 < path.length) {
    // Measure segment length
    const dSegX = path[iSeg+1].x - path[iSeg].x;
    const dSegY = path[iSeg+1].y - path[iSeg].y;
    const distSeg = Math.hypot(dSegX, dSegY);

    // Stop when we hit indexPathMax
    const distSegStop = (iSeg < iSegMax) ? Infinity : (uSegMax * distSeg);
    if (distRemaining >= distSegStop) {
      indexPath = indexPathMax;
      break;
    }

    // Stop when we exhaust distRemaining
    const distSegRemaining = (1 - uSeg) * distSeg;
    if (distRemaining < distSegRemaining) {
      indexPath += distRemaining / distSeg;
      break;
    }

    // Move on to the next segment
    distRemaining -= distSegRemaining;
    ++iSeg;
    uSeg = 0;
    indexPath = iSeg;
  }

  return indexPath;
}

/**
 * 
 * @param {Array<{x:number, y:number}>} path
 * @param {number} indexPath
 * @param {number} distRemaining
 * @param {number} indexPathMin
 * @returns {number}
 */
function moveAlongPathNegative(path, indexPath, distRemaining, indexPathMin) {
  const iSegMin = Math.floor(indexPathMin);
  const uSegMin = indexPathMin - iSegMin;

  // Unpack indexPath into segment index and fraction of distance along the segment
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;

  while (iSeg > 0 && iSeg + 1 < path.length) {
    // Measure segment length
    const dSegX = path[iSeg+1].x - path[iSeg].x;
    const dSegY = path[iSeg+1].y - path[iSeg].y;
    const distSeg = Math.hypot(dSegX, dSegY);

    // Stop when we hit indexPathMin
    const distSegStop = (iSeg > iSegMin) ? Infinity : ((1 - uSegMin) * distSeg);
    if (distRemaining >= distSegStop) {
      indexPath = indexPathMin;
      break;
    }

    // Stop when we exhaust distRemaining
    const distSegRemaining = uSeg * distSeg;
    if (distRemaining < distSegRemaining) {
      indexPath -= distRemaining / distSeg;
      break;
    }

    // Move on to the next segment
    distRemaining -= distSegRemaining;
    indexPath = iSeg;
    --iSeg;
    uSeg = 1;
  }

  return indexPath;
}
