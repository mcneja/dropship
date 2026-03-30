// @ts-check
/** @typedef {import("./game.js").Game} Game */

import * as collisionDropship from "./collision_dropship.js";
import * as dropship from "./dropship.js";
import * as factories from "./factories.js";
import * as feedback from "./feedback.js";
import * as levels from "./levels.js";
import { BENCH_CONFIG, reportBenchmarkResult } from "./perf.js";
import * as tether from "./tether.js";
import * as audioState from "./audio.js";

export class DebugState {
  constructor(){
    this.collisions = false;
    this.planetTriangles = false;
    this.collisionContours = false;
    this.frameStepMode = false;
    this.minerGuidePath = false;
    this.ringVertices = false;
    /** @type {Array<{x:number,y:number}>|null} */
    this.minerPathToMiner = null;
    this.devHudVisible = false;
    this.lastLandingDebugConsoleLine = "";
    this.landingDebugSessionIdNext = 1;
    this.landingDebugSessionId = 0;
    this.landingDebugSessionFrame = 0;
    this.landingDebugSessionActive = false;
    this.landingDebugSessionSource = "";
    this.minerPathDebugCooldown = 0;
  }
}

/**
 * @param {Game} game
 * @param {boolean} visible
 * @returns {void}
 */
export function setDevHudVisible(game, visible){
  game.debugState.devHudVisible = !!visible;
  if (game.hud && game.hud.style){
    game.hud.style.display = game.debugState.devHudVisible ? "block" : "none";
  }
  if (game.input && typeof game.input.setDebugCommandsEnabled === "function"){
    game.input.setDebugCommandsEnabled(game.debugState.devHudVisible);
  }
}

/**
 * @param {Game} game
 * @param {{DEBUG_COLLISION?:boolean}} config
 * @returns {void}
 */
export function initLoopDebugState(game, config){
  game.debugState.collisions = !!(config && config.DEBUG_COLLISION);
  game.debugState.planetTriangles = false;
  game.debugState.collisionContours = false;
  game.debugState.frameStepMode = false;
  game.debugState.minerGuidePath = false;
  game.debugState.ringVertices = false;
  game.debugState.minerPathToMiner = null;
  setDevHudVisible(game, BENCH_CONFIG.enabled);
  game.debugState.lastLandingDebugConsoleLine = "";
  game.debugState.landingDebugSessionIdNext = 1;
  game.debugState.landingDebugSessionId = 0;
  game.debugState.landingDebugSessionFrame = 0;
  game.debugState.landingDebugSessionActive = false;
  game.debugState.landingDebugSessionSource = "";
  game.debugState.minerPathDebugCooldown = 0;
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function applyBenchmarkSetup(game){
  applyBenchmarkSetupImpl.call(game);
}

/**
 * @param {Game} game
 * @param {number} now
 * @param {number} frameMs
 * @returns {void}
 */
export function recordFrameTiming(game, now, frameMs){
  recordFrameTimingImpl.call(game, now, frameMs);
}

/**
 * @param {Game} game
 * @param {any} planetConfig
 * @returns {void}
 */
export function logLevelInit(game, planetConfig){
  logLevelInitImpl.call(game, planetConfig);
}

/**
 * @param {Game} game
 * @param {any} spawnPlan
 * @param {number} count
 * @returns {void}
 */
export function logMinerSpawnDiagnostics(game, spawnPlan, count){
  logMinerSpawnDiagnosticsImpl.call(game, spawnPlan, count);
}

/**
 * @param {Game} game
 * @param {any} bundle
 * @returns {void}
 */
export function logLevelBegin(game, bundle){
  logLevelBeginImpl.call(game, bundle);
}

/**
 * @param {Game} game
 * @param {any} inputState
 * @param {boolean} transitionActive
 * @returns {void}
 */
export function handleFrameDebugInput(game, inputState, transitionActive){
  handleFrameDebugInputImpl.call(game, inputState, transitionActive);
}

/**
 * @param {Game} game
 * @param {any} inputState
 * @param {boolean} transitionActive
 * @returns {void}
 */
export function syncFrameStep(game, inputState, transitionActive){
  const debugState = game.debugState;
  if (!transitionActive && inputState.toggleFrameStep){
    debugState.frameStepMode = !debugState.frameStepMode;
    game.accumulator = 0;
    feedback.showStatusCue(game, debugState.frameStepMode ? "Frame step on (Alt+L, Space steps)" : "Frame step off");
  }
  if (debugState.frameStepMode || transitionActive){
    inputState.thrust = false;
  }
}

/**
 * @param {Game} game
 * @param {number} rawDt
 * @param {any} inputState
 * @param {boolean} helpOpen
 * @returns {{fixed:number,stepFrame:boolean,dt:number}}
 */
export function resolveFrameDt(game, rawDt, inputState, helpOpen){
  const fixed = 1 / 60;
  const stepFrame = !!(game.debugState.frameStepMode && inputState.stepFrame && !helpOpen);
  const dt = helpOpen ? 0 : (game.debugState.frameStepMode ? (stepFrame ? fixed : 0) : rawDt);
  if (helpOpen){
    game.accumulator = 0;
    audioState.setThrustLoopActive(game, false);
  } else if (game.debugState.frameStepMode){
    game.accumulator = stepFrame ? fixed : 0;
    if (!stepFrame){
      audioState.setThrustLoopActive(game, false);
    }
  } else {
    game.accumulator += dt;
  }
  return { fixed, stepFrame, dt };
}

/**
 * @param {Game} game
 * @param {string|null|undefined} spawnEnemyType
 * @returns {void}
 */
export function handleSpawnEnemyType(game, spawnEnemyType){
  handleSpawnEnemyTypeImpl.call(game, spawnEnemyType);
}

/**
 * @param {Game} game
 * @param {any} minerPathDebugRecord
 * @param {Array<any>|null} debugMinerPathToMiner
 * @param {boolean} landed
 * @param {boolean} guidePathUsable
 * @returns {void}
 */
export function updateMinerPathDebugState(game, minerPathDebugRecord, debugMinerPathToMiner, landed, guidePathUsable){
  updateMinerPathDebugStateImpl.call(game, minerPathDebugRecord, debugMinerPathToMiner, landed, guidePathUsable);
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function updateLandingDebug(game){
  updateLandingDebugImpl.call(game);
}

/**
 * @this {any}
 * @returns {void}
 */
function applyBenchmarkSetupImpl(){
  const perfState = this.perfState;
  this.pendingBootJumpdriveIntro = false;
  this.titleState.seen = true;
  this.titleState.fade = true;
  this.titleState.alpha = 0;
  this.titleState.newGameHelpPromptT = 0;
  this.titleState.newGameHelpPromptArmed = false;
  setDevHudVisible(this, true);
  if (BENCH_CONFIG.start === "orbit"){
    dropship.putShipInLowOrbit(this);
    this.hasLaunchedPlayerShip = true;
  }
  const perfText = perfState.flags.length ? ` | ${perfState.flags.join(",")}` : "";
  feedback.showStatusCue(this, `Benchmark warmup ${Math.ceil(BENCH_CONFIG.warmupMs / 1000)}s${perfText}`, 2.5);
}

/**
 * @this {any}
 * @param {number} now
 * @param {number} frameMs
 * @returns {void}
 */
function recordFrameTimingImpl(now, frameMs){
  const perfState = this.perfState;
  perfState.frameStatsTracker.record(frameMs);
  if (!perfState.frameStats || (now - perfState.frameStatsUpdatedAt) >= 500){
    perfState.frameStats = perfState.frameStatsTracker.snapshot();
    perfState.frameStatsUpdatedAt = now;
  }

  if (!perfState.benchmarkRun || perfState.benchmarkRun.finished) return;
  if (!perfState.benchmarkRun.startedAtMs){
    perfState.benchmarkRun.startedAtMs = now;
    perfState.benchmarkRun.sampleStartAtMs = now + BENCH_CONFIG.warmupMs;
    perfState.benchmarkRun.sampleEndAtMs = perfState.benchmarkRun.sampleStartAtMs + BENCH_CONFIG.durationMs;
  }
  if (now < perfState.benchmarkRun.sampleStartAtMs){
    perfState.benchmarkRun.stateText = `warmup ${Math.max(0, Math.ceil((perfState.benchmarkRun.sampleStartAtMs - now) / 1000))}s`;
    return;
  }
  if (!perfState.benchmarkRun.active){
    perfState.benchmarkRun.active = true;
    perfState.benchmarkRun.tracker.reset();
    feedback.showStatusCue(this, `Benchmark recording ${Math.ceil(BENCH_CONFIG.durationMs / 1000)}s`, 1.5);
  }
  perfState.benchmarkRun.tracker.record(frameMs);
  const remainingMs = perfState.benchmarkRun.sampleEndAtMs - now;
  if (remainingMs > 0){
    perfState.benchmarkRun.stateText = `run ${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
    return;
  }
  perfState.benchmarkRun.finished = true;
  perfState.benchmarkRun.stateText = "done";
  perfState.benchmarkRun.result = perfState.benchmarkRun.tracker.snapshot();
  reportBenchmarkResult({
    bench: BENCH_CONFIG,
    stats: perfState.benchmarkRun.result,
    perfFlags: perfState.flags,
    planetSeed: this.planet.getSeed(),
  });
  feedback.showStatusCue(this, "Benchmark complete; see console", 3.5);
}

/**
 * @this {any}
 * @param {any} planetConfig
 * @returns {void}
 */
function logLevelInitImpl(planetConfig){
  console.log("[Level] init", {
    level: this.level,
    planetId: planetConfig.id,
    enemies: levels.totalEnemiesForLevel(this, this.level),
    miners: levels.targetMinersForLevel(this),
    platformCount: planetConfig.platformCount,
    props: (this.planet.props || []).length,
  });
  if (this.planet.props && this.planet.props.length){
    console.log("[Level] props sample", this.planet.props.slice(0, 3).map((/** @type {{type?:string,x:number,y:number,dead?:boolean}} */ p) => ({ type: p.type, x: p.x, y: p.y, dead: !!p.dead })));
  }
}

/**
 * @this {any}
 * @param {any} spawnPlan
 * @param {number} count
 * @returns {void}
 */
function logMinerSpawnDiagnosticsImpl(spawnPlan, count){
  const placed = spawnPlan.placements;
  if (placed.length < count){
    if (spawnPlan.debug.mode === "barren"){
      console.error("[Level] miners spawn insufficient barren pads", {
        level: this.level,
        target: count,
        placed: placed.length,
        pads: spawnPlan.debug.pads || 0,
      });
    } else {
      console.error("[Level] miners spawn insufficient standable points", {
        level: this.level,
        target: count,
        placed: placed.length,
        standable: spawnPlan.debug.standable || 0,
        available: spawnPlan.debug.available || 0,
        reservations: spawnPlan.debug.reservations || 0,
        props: spawnPlan.debug.props || null,
        moltenFiltered: spawnPlan.debug.filteredStandable || 0,
        minR: spawnPlan.debug.minR || 0,
      });
    }
  }
  console.log("[Level] miners spawn", { level: this.level, target: count, placed: placed.length });
}

/**
 * @this {any}
 * @param {any} bundle
 * @returns {void}
 */
function logLevelBeginImpl(bundle){
  console.log("[Level] begin", {
    level: this.level,
    planetId: bundle.planetConfig.id,
    enemies: levels.totalEnemiesForLevel(this, this.level),
    miners: levels.targetMinersForLevel(this),
    platformCount: bundle.planetConfig.platformCount,
    props: (this.planet.props || []).length,
  });
  if (this.planet.props && this.planet.props.length){
    console.log("[Level] props sample", this.planet.props.slice(0, 3).map((/** @type {{type?:string,x:number,y:number,dead?:boolean}} */ p) => ({ type: p.type, x: p.x, y: p.y, dead: !!p.dead })));
  }
  console.log("[Level] enemies spawned", { level: this.level, enemies: this.enemies.enemies.length });
}

/**
 * @this {any}
 * @param {any} inputState
 * @param {boolean} transitionActive
 * @returns {void}
 */
function handleFrameDebugInputImpl(inputState, transitionActive){
  const debugState = this.debugState;
  if (!transitionActive && inputState.regen){
    const nextSeed = this.planet.getSeed() + 1;
    levels.beginLevel(this, nextSeed, this.level);
  }
  if (!transitionActive && inputState.promptLevelJump){
    promptDevJumpToLevelImpl.call(this);
  }
  if (!transitionActive && inputState.prevLevel){
    if (this.level > 1){
      levels.devJumpToLevel(this, this.level - 1);
    }
  } else if (!transitionActive && inputState.nextLevel){
    if (this.planet){
      const nextSeed = this.planet.getSeed() + 1;
      levels.startJumpdriveTransition(this, nextSeed, this.level + 1);
    }
  }
  if (inputState.toggleDebug){
    debugState.collisions = !debugState.collisions;
  }
  if (inputState.toggleDevHud){
    setDevHudVisible(this, !debugState.devHudVisible);
  }
  if (inputState.toggleRingVertices){
    debugState.ringVertices = !debugState.ringVertices;
    feedback.showStatusCue(this, debugState.ringVertices ? "Ring vertex debug on" : "Ring vertex debug off");
  }
  if (inputState.togglePlanetTriangles){
    debugState.planetTriangles = !debugState.planetTriangles;
    feedback.showStatusCue(this, debugState.planetTriangles ? "Planet triangle outlines on" : "Planet triangle outlines off");
  }
  if (inputState.toggleCollisionContours){
    debugState.collisionContours = !debugState.collisionContours;
    feedback.showStatusCue(this, debugState.collisionContours ? "Collision contour debug on" : "Collision contour debug off");
  }
  if (inputState.toggleMinerGuidePath){
    debugState.minerGuidePath = !debugState.minerGuidePath;
    feedback.showStatusCue(this, debugState.minerGuidePath ? "Miner guide path debug on" : "Miner guide path debug off");
  }
  if (inputState.rescueAll){
    rescueAllImpl.call(this);
  }
  if (inputState.killAllEnemies){
    killAllEnemiesImpl.call(this);
  }
  if (inputState.removeEntities){
    killAllEnemiesAndFactoriesImpl.call(this);
  }
}

/**
 * @this {any}
 * @param {string|null|undefined} spawnEnemyType
 * @returns {void}
 */
function handleSpawnEnemyTypeImpl(spawnEnemyType){
  if (!spawnEnemyType) return;
  /** @type {Record<"1"|"2"|"3"|"4"|"5", import("./types.d.js").EnemyType>} */
  const map = {
    "1": "hunter",
    "2": "ranger",
    "3": "crawler",
    "4": "turret",
    "5": "orbitingTurret",
  };
  /** @type {import("./types.d.js").EnemyType} */
  const type = (spawnEnemyType in map)
    ? map[/** @type {"1"|"2"|"3"|"4"|"5"} */ (spawnEnemyType)]
    : /** @type {import("./types.d.js").EnemyType} */ (spawnEnemyType);
  if (!type) return;
  const ang = Math.random() * Math.PI * 2;
  const dist = 10;
  const sx = this.ship.x + Math.cos(ang) * dist;
  const sy = this.ship.y + Math.sin(ang) * dist;
  this.enemies.spawnDebug(type, sx, sy);
}

/**
 * @this {any}
 * @param {any} minerPathDebugRecord
 * @param {Array<any>|null} debugMinerPathToMiner
 * @param {boolean} landed
 * @param {boolean} guidePathUsable
 * @returns {void}
 */
function updateMinerPathDebugStateImpl(minerPathDebugRecord, debugMinerPathToMiner, landed, guidePathUsable){
  const debugState = this.debugState;
  debugState.minerPathToMiner = (landed && guidePathUsable) ? debugMinerPathToMiner : null;
  if (debugState.minerGuidePath && debugState.minerPathDebugCooldown <= 0 && minerPathDebugRecord){
    console.log("[minerDbg]", minerPathDebugRecord);
    debugState.minerPathDebugCooldown = 0.35;
  }
}

/**
 * @this {any}
 * @returns {void}
 */
function updateLandingDebugImpl(){
  const debugState = this.debugState;
  const landingDbg = debugState.devHudVisible ? this.ship._landingDebug : null;
  if (!debugState.devHudVisible){
    this.ship._landingDebug = null;
    this.ship._lastMothershipCollisionDiag = null;
    debugState.lastLandingDebugConsoleLine = "";
    debugState.landingDebugSessionActive = false;
    debugState.landingDebugSessionFrame = 0;
    debugState.landingDebugSessionSource = "";
  } else if (landingDbg){
    /** @param {number|undefined|null} n */
    const fmt = (n) => Number.isFinite(n) ? Number(n).toFixed(2) : "-";
    /** @param {number|undefined|null} n */
    const fmtI = (n) => Number.isFinite(n) ? String(Math.round(Number(n))) : "-";
    /** @param {{vx?:number,vy?:number,speed?:number,dirDeg?:number}|null|undefined} v */
    const fmtVec = (v) => {
      if (!v) return "-";
      return `${fmt(v.vx)},${fmt(v.vy)}@${fmt(v.speed)}/${fmt(v.dirDeg)}deg`;
    };
    /** @param {{nx?:number,ny?:number}|null|undefined} n */
    const fmtNormal = (n) => {
      if (!n) return "-";
      return `${fmt(n.nx)},${fmt(n.ny)}`;
    };
    /** @param {{hits?:Array<{kind?:string,edgeIdx?:number,hullIdx?:number}>}|null|undefined} e */
    const fmtHits = (e) => {
      if (!e || !Array.isArray(e.hits)) return "-";
      return e.hits.map((h) => {
        const kind = h && h.kind ? h.kind : "?";
        const edge = Number.isFinite(h && h.edgeIdx) ? h.edgeIdx : "-";
        const hull = Number.isFinite(h && h.hullIdx) ? h.hullIdx : "-";
        return `${kind}[e${edge}/h${hull}]`;
      }).join(",");
    };
    /** @param {Array<{ax:number,ay:number,bx:number,by:number,nx:number,ny:number,d2:number,u:number,preferVn:number,fallbackDot:number,chosen:boolean}>|null|undefined} edges */
    const fmtEdges = (edges) => {
      if (!Array.isArray(edges) || !edges.length) return "-";
      return edges.map((e, idx) => {
        if (!e) return `e${idx}:?`;
        return `e${idx}${e.chosen ? "*" : ""}[${fmt(e.ax)},${fmt(e.ay)}>${fmt(e.bx)},${fmt(e.by)} n:${fmt(e.nx)},${fmt(e.ny)} d2:${fmt(e.d2)} u:${fmt(e.u)} pv:${fmt(e.preferVn)} fd:${fmt(e.fallbackDot)}]`;
      }).join("|");
    };
    /** @param {Array<{pointIndex:number,t:number,entryVn:number,x:number,y:number,nx:number,ny:number}>|null|undefined} contacts */
    const fmtImpactContacts = (contacts) => {
      if (!Array.isArray(contacts) || !contacts.length) return "-";
      return contacts.map((c) => (
        `p${fmtI(c.pointIndex)}@${fmt(c.t)} vn:${fmt(c.entryVn)} `
        + `pt:${fmt(c.x)},${fmt(c.y)} n:${fmt(c.nx)},${fmt(c.ny)}`
      )).join("|");
    };
    const reason = String(landingDbg.reason || "-");
    let mothershipRelatedNoContact = false;
    if (reason === "mothership_no_contact" && landingDbg.source === "mothership" && this.mothership){
      const shipRadius = collisionDropship.shipRadius(this);
      const dx = this.ship.x - this.mothership.x;
      const dy = this.ship.y - this.mothership.y;
      const nearMothership = (dx * dx + dy * dy) <= Math.pow((this.mothership.bounds || 0) + shipRadius + 0.8, 2);
      const overlap = nearMothership && collisionDropship.shipCollidesWithMothershipAt(this, this.ship.x, this.ship.y);
      const activeHit = !!(this.ship._collision && this.ship._collision.source === "mothership");
      mothershipRelatedNoContact = overlap || activeHit;
    }
    const hasCollisionEvidence =
      (Number(landingDbg.contactsCount) > 0)
      || (Number(landingDbg.overlapBeforeCount) > 0)
      || (Number(landingDbg.overlapAfterCount) > 0)
      || (Number(landingDbg.depenPush) > 0);
    const landedState = reason.includes("landed");
    const mothershipSessionCandidate =
      landingDbg.source === "mothership" && reason.startsWith("mothership_") && hasCollisionEvidence;
    const sessionActive = !!(!landedState && (
      hasCollisionEvidence
      || mothershipRelatedNoContact
      || mothershipSessionCandidate
    ));
    let sessionId = debugState.landingDebugSessionActive ? debugState.landingDebugSessionId : 0;
    let sessionFrame = debugState.landingDebugSessionActive ? debugState.landingDebugSessionFrame : 0;
    if (sessionActive){
      if (!debugState.landingDebugSessionActive){
        debugState.landingDebugSessionActive = true;
        debugState.landingDebugSessionId = debugState.landingDebugSessionIdNext++;
        debugState.landingDebugSessionFrame = 1;
        debugState.landingDebugSessionSource = String(landingDbg.source || "");
        console.log(`[landDbgStart] sid:${debugState.landingDebugSessionId} src:${landingDbg.source || "-"} r:${reason}`);
      } else {
        debugState.landingDebugSessionFrame += 1;
      }
      sessionId = debugState.landingDebugSessionId;
      sessionFrame = debugState.landingDebugSessionFrame;
    } else if (debugState.landingDebugSessionActive){
      console.log(
        `[landDbgEnd] sid:${debugState.landingDebugSessionId} frames:${debugState.landingDebugSessionFrame} end:${reason}`
      );
      debugState.landingDebugSessionActive = false;
      debugState.landingDebugSessionFrame = 0;
      debugState.landingDebugSessionSource = "";
      sessionId = 0;
      sessionFrame = 0;
    }
    if (landingDbg.collisionDiag){
      landingDbg.collisionDiag.session = {
        id: sessionId,
        frame: sessionFrame,
        active: debugState.landingDebugSessionActive,
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
      + `ov:${fmtI(landingDbg.overlapBeforeCount)}>${fmtI(landingDbg.overlapAfterCount)} `
      + `ovm:${fmt(landingDbg.overlapBeforeMin)}>${fmt(landingDbg.overlapAfterMin)} `
      + `dep:${fmt(landingDbg.depenPush)} csh:${fmt(landingDbg.depenCushion)} d:${fmtI(landingDbg.depenDir)} i:${fmtI(landingDbg.depenIter)} clr:${landingDbg.depenCleared ? 1 : 0}`
      + ` ship:${fmt(landingDbg.shipX)},${fmt(landingDbg.shipY)} v:${fmt(landingDbg.shipVx)},${fmt(landingDbg.shipVy)} `
      + `start:${fmt(landingDbg.shipStartX)},${fmt(landingDbg.shipStartY)} end:${fmt(landingDbg.shipEndX)},${fmt(landingDbg.shipEndY)} `
      + `in:L${landingDbg.inputLeft ? 1 : 0} R${landingDbg.inputRight ? 1 : 0} T${landingDbg.inputThrust ? 1 : 0} D${landingDbg.inputDown ? 1 : 0} `
      + `stick:${fmt(landingDbg.inputStickX)},${fmt(landingDbg.inputStickY)} a:${fmt(landingDbg.inputAccelX)},${fmt(landingDbg.inputAccelY)} g:${fmt(landingDbg.inputGravityX)},${fmt(landingDbg.inputGravityY)} `
      + `impN:${fmt(landingDbg.impactNormalX)},${fmt(landingDbg.impactNormalY)} `
      + `relI:${fmt(landingDbg.impactRelX)},${fmt(landingDbg.impactRelY)} relS:${fmt(landingDbg.supportRelX)},${fmt(landingDbg.supportRelY)}`;
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
    const planetDetailLine = landingDbg.source === "planet"
      ? ` edges:${fmtEdges(landingDbg.impactEdges)}`
        + ` contacts:${fmtImpactContacts(landingDbg.impactContacts)}`
      : "";
    const combinedLine = line + detailLine + planetDetailLine;
    const idleNoContact = (!sessionActive && reason === "mothership_no_contact" && !mothershipRelatedNoContact);
    const shouldLog = !idleNoContact && (sessionActive || line !== debugState.lastLandingDebugConsoleLine);
    if (shouldLog){
      console.log(combinedLine);
      debugState.lastLandingDebugConsoleLine = line;
    }
  } else if (debugState.devHudVisible && this.mothership){
    const shipRadius = collisionDropship.shipRadius(this);
    const dx = this.ship.x - this.mothership.x;
    const dy = this.ship.y - this.mothership.y;
    const nearMothership = (dx * dx + dy * dy) <= Math.pow((this.mothership.bounds || 0) + shipRadius + 0.8, 2);
    const overlap = nearMothership && collisionDropship.shipCollidesWithMothershipAt(this, this.ship.x, this.ship.y);
    if (debugState.landingDebugSessionActive && debugState.landingDebugSessionSource !== "mothership"){
      console.log(
        `[landDbgEnd] sid:${debugState.landingDebugSessionId} frames:${debugState.landingDebugSessionFrame} end:no_debug`
      );
      debugState.landingDebugSessionActive = false;
      debugState.landingDebugSessionFrame = 0;
      debugState.landingDebugSessionSource = "";
    }
    if (!debugState.landingDebugSessionActive && overlap){
      debugState.landingDebugSessionActive = true;
      debugState.landingDebugSessionId = debugState.landingDebugSessionIdNext++;
      debugState.landingDebugSessionFrame = 0;
      debugState.landingDebugSessionSource = "mothership";
      console.log(`[landDbgStart] sid:${debugState.landingDebugSessionId} src:mothership r:mothership_trace_overlap`);
    }
    if (debugState.landingDebugSessionActive && debugState.landingDebugSessionSource === "mothership"){
      if (nearMothership){
        debugState.landingDebugSessionFrame += 1;
        const sid = debugState.landingDebugSessionId;
        const sf = debugState.landingDebugSessionFrame;
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
        if (traceLine !== debugState.lastLandingDebugConsoleLine){
          console.log(traceLine);
          debugState.lastLandingDebugConsoleLine = traceLine;
        }
      } else {
        console.log(
          `[landDbgEnd] sid:${debugState.landingDebugSessionId} frames:${debugState.landingDebugSessionFrame} end:trace_far`
        );
        debugState.landingDebugSessionActive = false;
        debugState.landingDebugSessionFrame = 0;
        debugState.landingDebugSessionSource = "";
      }
    }
  } else if (debugState.devHudVisible && debugState.landingDebugSessionActive){
    console.log(
      `[landDbgEnd] sid:${debugState.landingDebugSessionId} frames:${debugState.landingDebugSessionFrame} end:no_debug`
    );
    debugState.landingDebugSessionActive = false;
    debugState.landingDebugSessionFrame = 0;
    debugState.landingDebugSessionSource = "";
  }
}

/**
 * @this {any}
 * @returns {void}
 */
function promptDevJumpToLevelImpl(){
  if (typeof window === "undefined" || typeof window.prompt !== "function") return;
  const raw = window.prompt("Jump to level number", String(this.level));
  if (raw === null) return;
  const targetLevel = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(targetLevel) || targetLevel < 1){
    feedback.showStatusCue(this, "Invalid level number");
    return;
  }
  levels.devJumpToLevel(this, targetLevel);
}

/**
 * @this {any}
 * @returns {void}
 */
function rescueAllImpl(){
  let rescued = 0;
  for (let i = this.miners.length - 1; i >= 0; i--){
    const miner = this.miners[i];
    if (miner.type === "miner"){
      ++this.ship.dropshipMiners;
    } else if (miner.type === "pilot"){
      ++this.ship.dropshipPilots;
    } else if (miner.type === "engineer"){
      ++this.ship.dropshipEngineers;
    }
    rescued++;
    this.minersRemaining = Math.max(0, this.minersRemaining - 1);
    this.miners.splice(i, 1);
  }

  if (dropship.isDockedWithMothership(this)){
    dropship.onSuccessfullyDocked(this);
  }
  feedback.showStatusCue(this, rescued > 0 ? `Debug rescue: ${rescued} collected` : "Debug rescue: no miners left");
}

/**
 * @this {any}
 * @returns {void}
 */
function killAllEnemiesImpl(){
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
  feedback.showStatusCue(this, enemyCount > 0 ? `Debug clear: ${enemyCount} enemies` : "Debug clear: no enemies alive");
}

/**
 * @this {any}
 * @returns {void}
 */
function killAllEnemiesAndFactoriesImpl(){
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

  let factoryCount = 0;
  if (this.planet && this.planet.props){
    for (const p of this.planet.props){
      if (p.type !== "factory") continue;
      if (p.dead || (typeof p.hp === "number" && p.hp <= 0)) continue;
      factories.destroyFactoryProp(this, p);
      factoryCount++;
    }
  }
  if (factoryCount > 0){
    tether.syncTetherProtectionStates(this);
  }
  if (enemyCount > 0 || factoryCount > 0){
    feedback.showStatusCue(this, `Debug clear: ${enemyCount} enemies, ${factoryCount} factories`);
  } else {
    feedback.showStatusCue(this, "Debug clear: no enemies or factories alive");
  }
}


