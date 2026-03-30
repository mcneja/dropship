// @ts-check
/** @typedef {import("./game.js").Game} Game */

import { Enemies } from "./enemies.js";
import { createCollisionRouter } from "./collision_world.js";
import { GAME, CFG } from "./config.js";
import * as audioState from "./audio.js";
import * as camera from "./camera.js";
import * as dashboard from "./dashboard.js";
import * as debug from "./debug.js";
import * as dropship from "./dropship.js";
import * as enemyEffects from "./enemies_effects.js";
import * as factories from "./factories.js";
import * as miners from "./miners.js";
import { Mothership } from "./mothership.js";
import { Planet } from "./planet.js";
import { pickPlanetConfig, pickPlanetConfigById, resolveLevelProgression, resolvePlanetParams } from "./planet_config.js";
import * as mechanized from "./mechanized.js";
import * as missions from "./missions.js";
import * as planetSpawn from "./planet_spawn.js";
import * as sessionTitle from "./title.js";
import * as stats from "./stats.js";
import * as tether from "./tether.js";
import * as feedback from "./feedback.js";

/**
 * @param {Game} game
 * @param {any} cfg
 * @param {number} lvl
 * @returns {number}
 */
function enemyTotalForConfig(game, cfg, lvl){
  const base = (cfg && typeof cfg.enemyCountBase === "number") ? cfg.enemyCountBase : 5;
  const per = (cfg && typeof cfg.enemyCountPerLevel === "number") ? cfg.enemyCountPerLevel : 5;
  const cap = (cfg && typeof cfg.enemyCountCap === "number") ? cfg.enemyCountCap : 30;
  const count = base + Math.max(0, (lvl | 0) - 1) * per;
  return Math.min(cap, count);
}

/**
 * @param {Game} game
 * @param {number} lvl
 * @returns {number}
 */
function totalEnemiesForLevel(game, lvl){
  const cfg = game.planet ? game.planet.getPlanetConfig() : null;
  return enemyTotalForConfig(game, cfg, lvl);
}

/**
 * @param {Game} game
 * @param {any} cfg
 * @param {number} lvl
 * @returns {number}
 */
function minerTargetForConfig(game, cfg, lvl){
  const base = (cfg && typeof cfg.minerCountBase === "number") ? cfg.minerCountBase : 0;
  const per = (cfg && typeof cfg.minerCountPerLevel === "number") ? cfg.minerCountPerLevel : 0;
  const cap = (cfg && typeof cfg.minerCountCap === "number") ? cfg.minerCountCap : 0;
  return Math.min(cap, base + Math.max(0, (lvl | 0) - 1) * per);
}

/**
 * @param {Game} game
 * @returns {number}
 */
function targetMinersForLevel(game){
  const cfg = game.planet ? game.planet.getPlanetConfig() : null;
  return minerTargetForConfig(game, cfg, game.level);
}

/**
 * Reserve barren pads for miners before turrets sample remaining platforms.
 * @param {Game} game
 * @param {Planet} planet
 * @param {any} cfg
 * @param {number} level
 * @returns {void}
 */
function prepareBarrenMinerPadReservations(game, planet, cfg, level){
  if (!planet || !(cfg && cfg.flags && cfg.flags.barrenPerimeter)) return;
  const minerTarget = minerTargetForConfig(game, cfg, level);
  const turretTarget = enemyTotalForConfig(game, cfg, level);
  const seed = planet.getSeed() + level * 97;
  if (minerTarget > 0 || turretTarget > 0){
    planetSpawn.layoutBarrenPadsForRoles(planet, minerTarget, turretTarget, seed, GAME.MINER_MIN_SEP);
  }
  if (minerTarget <= 0) return;
  planetSpawn.reserveBarrenPadsForMiners(planet, minerTarget, seed, GAME.MINER_MIN_SEP);
}

/**
 * @param {Game} game
 * @param {any} cfg
 * @param {number} lvl
 * @returns {{type:string,target:number}}
 */
function buildObjective(game, cfg, lvl){
  const obj = cfg && cfg.objective ? cfg.objective : { type: "extract", count: 0 };
  if (cfg && cfg.id === "mechanized" && game.planet && game.planet.getCoreRadius && game.planet.getCoreRadius() > 0.5){
    const target = tether.tetherPropsAll(game).length;
    if (target > 0){
      return { type: "destroy_core", target };
    }
  }
  if (obj.type === "clear"){
    const target = (obj.count && obj.count > 0) ? obj.count : enemyTotalForConfig(game, cfg, lvl);
    return { type: "clear", target };
  }
  if (obj.type === "destroy_factories"){
    const target = (obj.count && obj.count > 0) ? obj.count : factories.factoryPropsAlive(game).length;
    return { type: "destroy_factories", target };
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
 * @param {Game} game
 * @returns {boolean}
 */
function isMechanizedLevel(game){
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  return !!(cfg && cfg.id === "mechanized");
}

/**
 * @param {Game} game
 * @returns {boolean}
 */
function isMechanizedCoreLevel(game){
  return isMechanizedLevel(game) && !!(game.planet && game.planet.getCoreRadius && game.planet.getCoreRadius() > 0.5);
}

/**
 * @param {Game} game
 * @param {any} base
 * @param {any} progression
 * @returns {any}
 */
function applyProgressionOverrides(game, base, progression){
  if (!progression) return base;
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
 * @param {Game} game
 * @param {number} level
 * @param {number} [progressionSeedOverride]
 * @returns {any}
 */
function planetConfigFromLevel(game, level, progressionSeedOverride){
  const overrideSeed = progressionSeedOverride ?? Number.NaN;
  const progressionSeed = Number.isFinite(overrideSeed) ? overrideSeed : (game.progressionSeed || CFG.seed);
  const progression = resolveLevelProgression(progressionSeed, level);
  const configOverride = progression ? progression.planetId : undefined;
  const planetConfig =
    (configOverride !== undefined) ? pickPlanetConfigById(configOverride) :
    pickPlanetConfig(progressionSeed, level);
  const out = applyProgressionOverrides(game, planetConfig, progression);
  if (out.id === "barren_pickup" || out.id === "barren_clear"){
    const basePads = Math.max(1, Math.round(out.platformCount || 1));
    const growth = Math.floor(Math.max(0, (level | 0) - 1) / 2);
    const enemyBudget = Math.max(1, enemyTotalForConfig(game, out, level));
    const minerBudget = Math.max(0, minerTargetForConfig(game, out, level));
    const platformBudget = enemyBudget + minerBudget;
    out.platformCount = Math.max(basePads + growth, platformBudget);
  }
  return out;
}

/**
 * @param {Game} game
 * @param {number} seed
 * @param {number} level
 * @param {import("./types.d.js").MapWorld|null} [mapWorld]
 * @returns {any}
 */
function buildLevelBundle(game, seed, level, mapWorld = null){
  const planetConfig = planetConfigFromLevel(game, level, (level === 1) ? (seed | 0) : undefined);
  const planetParams = resolvePlanetParams(seed, level, planetConfig, GAME);
  const planet = new Planet({ seed, planetConfig, planetParams, mapWorld });
  prepareBarrenMinerPadReservations(game, planet, planetConfig, level);
  const mothership = new Mothership({ RMAX: planetParams.RMAX, MOTHERSHIP_ORBIT_HEIGHT: planetParams.MOTHERSHIP_ORBIT_HEIGHT }, planet);
  const collision = createCollisionRouter(planet, () => mothership);
  const enemies = new Enemies({
    planet,
    collision,
    total: enemyTotalForConfig(game, planetConfig, level),
    level,
    levelSeed: planet.getSeed(),
    placement: planetConfig.enemyPlacement || "random",
    solidPropSegmentBlocked: (ax, ay, bx, by, radius) => mechanized.solidPropSegmentBlocked(game, ax, ay, bx, by, radius),
    onEnemyShot: () => {
      audioState.playSfx(game, "enemy_fire", { volume: 0.55 });
      audioState.markCombatThreat(game);
      audioState.triggerCombatImmediate(game);
    },
    onEnemyDestroyed: (enemy, info) => {
      enemyEffects.handleEnemyDestroyed(game, enemy, info);
    },
  });
  return {
    seed,
    level,
    planetConfig,
    planetParams,
    planet,
    objective: buildObjective(game, planetConfig, level),
    mothership,
    collision,
    enemies,
  };
}

/**
 * @param {Game} game
 * @param {any} bundle
 * @param {number} previousLevel
 * @returns {void}
 */
function applyLevelBundle(game, bundle, previousLevel){
  game.level = bundle.level;
  if (bundle.level === 1){
    game.progressionSeed = bundle.seed | 0;
  }
  game.planet = bundle.planet;
  game.planetParams = bundle.planetParams;
  game.objective = bundle.objective;
  game.TERRAIN_MAX = game.planetParams.RMAX + game.TERRAIN_PAD;
  game.SURFACE_EPS = Math.max(0.12, game.planetParams.RMAX / 280);
  game.COLLISION_EPS = Math.max(0.18, game.planetParams.RMAX / 240);
  game.mothership = bundle.mothership;
  game.collision = bundle.collision;
  game.enemies = bundle.enemies;
  game.healthPickups = [];
  debug.logLevelBegin(game, bundle);
  if (game.level === 1){
    game.overallStats = stats.createRunStats(game);
  }
  stats.resetLevelStats(game);
  stats.setHostileBudget(game, game.enemies.enemies.length);
  missions.initializeClearObjectiveTracking(game);
  game.coreMeltdownActive = false;
  game.coreMeltdownT = 0;
  game.coreMeltdownEruptT = 0;
  tether.syncTetherProtectionStates(game);
  game.renderer.setPlanet(game.planet);
  dropship.resetShip(game);
  game.entityExplosions.length = 0;
  game.mechanizedLarvae.length = 0;
  game.camera.clearScreenShake();
  game.feedbackState.rumbleWeak = 0;
  game.feedbackState.rumbleStrong = 0;
  game.feedbackState.rumbleUntilMs = 0;
  game.feedbackState.lastRumbleWeakApplied = 0;
  game.feedbackState.lastRumbleStrongApplied = 0;
  game.feedbackState.lastRumbleApplyMs = 0;
  game.feedbackState.lastBrowserVibrateMs = 0;
  game.feedbackState.statusCueText = "";
  game.feedbackState.statusCueUntil = 0;
  game.feedbackState.screenshotCopyInFlight = false;
  miners.spawnMiners(game);
  game.planet.reconcileFeatures({
    enemies: game.enemies.enemies,
    miners: game.miners,
  });
  game.popups.length = 0;
  game.pickupAnimations.length = 0;
  game.planet.clearFeatureParticles();

  if (game.level === 1){
    game.hasLaunchedPlayerShip = false;
    sessionTitle.resetStartTitle(game);
    game.camera.resetManualZoom();
    game.ship.mothershipMiners = 0;
    game.ship.mothershipPilots = 0;
    game.ship.mothershipEngineers = 0;
    game.ship.hpMax = GAME.SHIP_STARTING_MAX_HP;
    game.ship.hpCur = GAME.SHIP_STARTING_MAX_HP;
    game.ship.bombsMax = GAME.SHIP_STARTING_MAX_BOMBS;
    game.ship.bombsCur = GAME.SHIP_STARTING_MAX_BOMBS;
    game.ship.bombStrength = GAME.SHIP_STARTING_BOMB_STRENGTH;
    game.ship.thrust = GAME.SHIP_STARTING_THRUST;
    game.ship.inertialDrive = GAME.SHIP_STARTING_INERTIAL_DRIVE;
    game.ship.gunPower = GAME.SHIP_STARTING_GUN_POWER;
    game.ship.rescueeDetector = false;
    game.ship.planetScanner = false;
    game.ship.bounceShots = false;
    game.pendingPerkChoice = null;
    game.missionState.victoryMusicTriggered = false;
  }
  game.missionState.objectiveCompleteSfxPlayed = dashboard.objectiveComplete(game);
  game.missionState.objectiveCompleteSfxDueAtMs = Number.POSITIVE_INFINITY;
  game.combatThreatUntilMs = 0;
  audioState.setCombatActive(game, false);
  game.audio.returnToAmbient(true);
  audioState.setThrustLoopActive(game, false);
  if (previousLevel !== game.level){
    game.missionState.levelAdvanceReady = false;
  }
  game.camera.snapToScene(camera.cameraScene(game));
  stats.markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @param {number} seed
 * @param {number} level
 * @param {import("./types.d.js").MapWorld|null} [mapWorld]
 * @param {boolean} [keepTransition]
 * @returns {void}
 */
function beginLevel(game, seed, level, mapWorld = null, keepTransition = false){
  if (!keepTransition){
    game.jumpdriveTransition.cancel();
  }
  const previousLevel = game.level;
  const bundle = buildLevelBundle(game, seed, level, mapWorld);
  applyLevelBundle(game, bundle, previousLevel);
}

/**
 * @param {Game} game
 * @param {number} seed
 * @param {number} level
 * @returns {void}
 */
function startJumpdriveTransition(game, seed, level){
  if (game.jumpdriveTransition.isActive()) return;
  game.camera.resetManualZoom();
  game.planetView = false;
  game.missionState.levelAdvanceReady = false;
  audioState.setThrustLoopActive(game, false);
  const planetConfig = planetConfigFromLevel(game, level);
  const planetParams = resolvePlanetParams(seed, level, planetConfig, GAME);
  game.jumpdriveTransition.start({
    seed,
    level,
    planetConfig,
    planetParams,
    view: game.camera.autoView(camera.cameraScene(game)),
    mothership: game.mothership,
    ship: game.ship,
    currentPlanetRadius: game.planet ? game.planet.planetRadius : (game.planetParams ? game.planetParams.RMAX : 0),
  });
}

/**
 * Dev-only level jump that keeps map generation but skips the jumpdrive overlay.
 * @param {Game} game
 * @param {number} level
 * @returns {void}
 */
function devJumpToLevel(game, level){
  if (!game.planet) return;
  const targetLevel = Math.max(1, Math.floor(level));
  if (!Number.isFinite(targetLevel)) return;
  const reloadingCurrentLevel = targetLevel === game.level;
  const nextSeed = game.planet.getSeed() + 1;
  game.camera.resetManualZoom();
  game.planetView = false;
  game.missionState.levelAdvanceReady = false;
  audioState.setThrustLoopActive(game, false);
  beginLevel(game, nextSeed, targetLevel);
  feedback.showStatusCue(game, reloadingCurrentLevel ? `Reloaded level ${targetLevel}` : `Jumped to level ${targetLevel}`);
}

/**
 * @param {Game} game
 * @returns {import("./types.d.js").MapWorld|null}
 */
function currentMapWorldClone(game){
  if (!game.planet || !game.planet.mapgen) return null;
  const world = game.planet.mapgen.getWorld();
  if (!world || !world.air) return null;
  return {
    seed: +world.seed || 0,
    air: new Uint8Array(world.air),
    entrances: Array.isArray(world.entrances) ? world.entrances.map((/** @type {[number, number]} */ p) => [p[0], p[1]]) : [],
    finalAir: +world.finalAir || 0,
  };
}

/**
 * @param {Game} game
 * @returns {void}
 */
function startCurrentLevelJumpdriveIntro(game){
  if (game.jumpdriveTransition.isActive() || !game.mothership || !game.planet) return;
  game.camera.resetManualZoom();
  game.planetView = false;
  game.missionState.levelAdvanceReady = false;
  audioState.setThrustLoopActive(game, false);
  const planetConfig = game.planet.getPlanetConfig();
  const planetParams = game.planet.getPlanetParams();
  const mapWorld = currentMapWorldClone(game);
  if (!planetConfig || !planetParams || !mapWorld) return;
  game.jumpdriveTransition.start({
    seed: game.planet.getSeed(),
    level: game.level,
    planetConfig,
    planetParams,
    mapWorld,
    view: game.camera.autoView(camera.cameraScene(game)),
    mothership: game.mothership,
    ship: game.ship,
    currentPlanetRadius: game.planet.planetRadius,
  });
}

/**
 * @param {Game} game
 * @param {number} seed
 * @returns {void}
 */
function beginNewGameWithIntro(game, seed){
  beginLevel(game, seed, 1);
  startCurrentLevelJumpdriveIntro(game);
}

export {
  applyLevelBundle,
  applyProgressionOverrides,
  beginLevel,
  beginNewGameWithIntro,
  buildLevelBundle,
  buildObjective,
  currentMapWorldClone,
  devJumpToLevel,
  enemyTotalForConfig,
  isMechanizedCoreLevel,
  isMechanizedLevel,
  minerTargetForConfig,
  planetConfigFromLevel,
  prepareBarrenMinerPadReservations,
  startCurrentLevelJumpdriveIntro,
  startJumpdriveTransition,
  targetMinersForLevel,
  totalEnemiesForLevel,
};


