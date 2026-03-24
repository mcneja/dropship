// @ts-check

import { BENCH_CONFIG, reportBenchmarkResult } from "./perf.js";

/**
 * @param {any} loop
 * @param {boolean} visible
 * @returns {void}
 */
export function setDevHudVisible(loop, visible){
  loop.devHudVisible = !!visible;
  if (loop.hud && loop.hud.style){
    loop.hud.style.display = loop.devHudVisible ? "block" : "none";
  }
  if (loop.input && typeof loop.input.setDebugCommandsEnabled === "function"){
    loop.input.setDebugCommandsEnabled(loop.devHudVisible);
  }
}

/**
 * @param {any} loop
 * @param {{DEBUG_COLLISION?:boolean}} game
 * @returns {void}
 */
export function initLoopDebugState(loop, game){
  loop.debugCollisions = !!(game && game.DEBUG_COLLISION);
  loop.debugPlanetTriangles = false;
  loop.debugCollisionContours = false;
  loop.debugFrameStepMode = false;
  loop.debugMinerGuidePath = false;
  loop.debugRingVertices = false;
  loop.debugMinerPathToMiner = null;
  setDevHudVisible(loop, BENCH_CONFIG.enabled);
  loop._lastLandingDebugConsoleLine = "";
  loop._landingDebugSessionIdNext = 1;
  loop._landingDebugSessionId = 0;
  loop._landingDebugSessionFrame = 0;
  loop._landingDebugSessionActive = false;
  loop._landingDebugSessionSource = "";
  loop._minerPathDebugCooldown = 0;
}

/**
 * @param {any} loop
 * @returns {void}
 */
export function applyBenchmarkSetup(loop){
  applyBenchmarkSetupImpl.call(loop);
}

/**
 * @param {any} loop
 * @param {number} now
 * @param {number} frameMs
 * @returns {void}
 */
export function recordFrameTiming(loop, now, frameMs){
  recordFrameTimingImpl.call(loop, now, frameMs);
}

/**
 * @param {any} loop
 * @param {any} planetConfig
 * @returns {void}
 */
export function logLevelInit(loop, planetConfig){
  logLevelInitImpl.call(loop, planetConfig);
}

/**
 * @param {any} loop
 * @param {any} spawnPlan
 * @param {number} count
 * @returns {void}
 */
export function logMinerSpawnDiagnostics(loop, spawnPlan, count){
  logMinerSpawnDiagnosticsImpl.call(loop, spawnPlan, count);
}

/**
 * @param {any} loop
 * @param {any} bundle
 * @returns {void}
 */
export function logLevelBegin(loop, bundle){
  logLevelBeginImpl.call(loop, bundle);
}

/**
 * @param {any} loop
 * @param {any} inputState
 * @param {boolean} transitionActive
 * @returns {void}
 */
export function handleFrameDebugInput(loop, inputState, transitionActive){
  handleFrameDebugInputImpl.call(loop, inputState, transitionActive);
}

/**
 * @param {any} loop
 * @param {string|null|undefined} spawnEnemyType
 * @returns {void}
 */
export function handleSpawnEnemyType(loop, spawnEnemyType){
  handleSpawnEnemyTypeImpl.call(loop, spawnEnemyType);
}

/**
 * @param {any} loop
 * @param {any} minerPathDebugRecord
 * @param {Array<any>|null} debugMinerPathToMiner
 * @param {boolean} landed
 * @param {boolean} guidePathUsable
 * @returns {void}
 */
export function updateMinerPathDebugState(loop, minerPathDebugRecord, debugMinerPathToMiner, landed, guidePathUsable){
  updateMinerPathDebugStateImpl.call(loop, minerPathDebugRecord, debugMinerPathToMiner, landed, guidePathUsable);
}

/**
 * @param {any} loop
 * @returns {void}
 */
export function updateLandingDebug(loop){
  updateLandingDebugImpl.call(loop);
}

/**
 * @this {any}
 * @returns {void}
 */
function applyBenchmarkSetupImpl(){
  this.pendingBootJumpdriveIntro = false;
  this.startTitleSeen = true;
  this.startTitleFade = true;
  this.startTitleAlpha = 0;
  this.newGameHelpPromptT = 0;
  this.newGameHelpPromptArmed = false;
  setDevHudVisible(this, true);
  if (BENCH_CONFIG.start === "orbit"){
    this._putShipInLowOrbit();
    this.hasLaunchedPlayerShip = true;
  }
  const perfText = this.perfFlags.length ? ` | ${this.perfFlags.join(",")}` : "";
  this._showStatusCue(`Benchmark warmup ${Math.ceil(BENCH_CONFIG.warmupMs / 1000)}s${perfText}`, 2.5);
}

/**
 * @this {any}
 * @param {number} now
 * @param {number} frameMs
 * @returns {void}
 */
function recordFrameTimingImpl(now, frameMs){
  this.frameStatsTracker.record(frameMs);
  if (!this.frameStats || (now - this.frameStatsUpdatedAt) >= 500){
    this.frameStats = this.frameStatsTracker.snapshot();
    this.frameStatsUpdatedAt = now;
  }

  if (!this.benchmarkRun || this.benchmarkRun.finished) return;
  if (!this.benchmarkRun.startedAtMs){
    this.benchmarkRun.startedAtMs = now;
    this.benchmarkRun.sampleStartAtMs = now + BENCH_CONFIG.warmupMs;
    this.benchmarkRun.sampleEndAtMs = this.benchmarkRun.sampleStartAtMs + BENCH_CONFIG.durationMs;
  }
  if (now < this.benchmarkRun.sampleStartAtMs){
    this.benchmarkRun.stateText = `warmup ${Math.max(0, Math.ceil((this.benchmarkRun.sampleStartAtMs - now) / 1000))}s`;
    return;
  }
  if (!this.benchmarkRun.active){
    this.benchmarkRun.active = true;
    this.benchmarkRun.tracker.reset();
    this._showStatusCue(`Benchmark recording ${Math.ceil(BENCH_CONFIG.durationMs / 1000)}s`, 1.5);
  }
  this.benchmarkRun.tracker.record(frameMs);
  const remainingMs = this.benchmarkRun.sampleEndAtMs - now;
  if (remainingMs > 0){
    this.benchmarkRun.stateText = `run ${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
    return;
  }
  this.benchmarkRun.finished = true;
  this.benchmarkRun.stateText = "done";
  this.benchmarkRun.result = this.benchmarkRun.tracker.snapshot();
  reportBenchmarkResult({
    bench: BENCH_CONFIG,
    stats: this.benchmarkRun.result,
    perfFlags: this.perfFlags,
    planetSeed: this.planet.getSeed(),
  });
  this._showStatusCue("Benchmark complete; see console", 3.5);
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
    enemies: this._totalEnemiesForLevel(this.level),
    miners: this._targetMinersForLevel(),
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
    enemies: this._totalEnemiesForLevel(this.level),
    miners: this._targetMinersForLevel(),
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
  if (!transitionActive && inputState.regen){
    const nextSeed = this.planet.getSeed() + 1;
    this._beginLevel(nextSeed, this.level);
  }
  if (!transitionActive && inputState.promptLevelJump){
    promptDevJumpToLevelImpl.call(this);
  }
  if (!transitionActive && inputState.prevLevel){
    if (this.level > 1){
      this._devJumpToLevel(this.level - 1);
    }
  } else if (!transitionActive && inputState.nextLevel){
    if (this.planet){
      const nextSeed = this.planet.getSeed() + 1;
      this._startJumpdriveTransition(nextSeed, this.level + 1);
    }
  }
  if (inputState.toggleDebug){
    this.debugCollisions = !this.debugCollisions;
  }
  if (inputState.toggleDevHud){
    setDevHudVisible(this, !this.devHudVisible);
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
  this.debugMinerPathToMiner = (landed && guidePathUsable) ? debugMinerPathToMiner : null;
  if (this.debugMinerGuidePath && this._minerPathDebugCooldown <= 0 && minerPathDebugRecord){
    console.log("[minerDbg]", minerPathDebugRecord);
    this._minerPathDebugCooldown = 0.35;
  }
}

/**
 * @this {any}
 * @returns {void}
 */
function updateLandingDebugImpl(){
  const landingDbg = this.devHudVisible ? this.ship._landingDebug : null;
  if (!this.devHudVisible){
    this.ship._landingDebug = null;
    this.ship._lastMothershipCollisionDiag = null;
    this._lastLandingDebugConsoleLine = "";
    this._landingDebugSessionActive = false;
    this._landingDebugSessionFrame = 0;
    this._landingDebugSessionSource = "";
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
    const mothershipSessionCandidate =
      landingDbg.source === "mothership" && reason.startsWith("mothership_") && hasCollisionEvidence;
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
    this._showStatusCue("Invalid level number");
    return;
  }
  this._devJumpToLevel(targetLevel);
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

  if (this._isDockedWithMothership()){
    this._onSuccessfullyDocked();
  }
  this._showStatusCue(rescued > 0 ? `Debug rescue: ${rescued} collected` : "Debug rescue: no miners left");
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
  this._showStatusCue(enemyCount > 0 ? `Debug clear: ${enemyCount} enemies` : "Debug clear: no enemies alive");
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
