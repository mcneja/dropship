// @ts-check
/** @typedef {import("./game.js").Game} Game */

import { GAME } from "./config.js";
import * as audioState from "./audio.js";
import * as collisionDropship from "./collision_dropship.js";
import * as collisionWorld from "./collision_world.js";
import * as debug from "./debug.js";
import * as planetSpawn from "./planet_spawn.js";
import * as stats from "./stats.js";
import * as weapons from "./weapons.js";
import {
  clearTerrainSupport,
  collectSupportNodeIndices,
  getSupportNodeIndices,
  setSupportAnchor,
  setSupportNodeIndices,
} from "./terrain_support.js";
import * as terrainSupport from "./terrain_support.js";

/**
 * @param {Game} game
 * @param {import("./types.d.js").Miner} miner
 * @param {"shot"|"exploded"} mode
 * @param {{x?:number,y?:number,vx?:number,vy?:number}|null|undefined} [impact]
 * @returns {void}
 */
function spawnFallenMiner(game, miner, mode, impact){
  if (!miner) return;
  const r = Math.hypot(miner.x, miner.y) || 1;
  const upx = miner.x / r;
  const upy = miner.y / r;
  const tx = -upy;
  const ty = upx;
  if (mode === "exploded"){
    let dirX = miner.x - (impact && Number.isFinite(impact.x) ? Number(impact.x) : miner.x - upx * 0.1);
    let dirY = miner.y - (impact && Number.isFinite(impact.y) ? Number(impact.y) : miner.y - upy * 0.1);
    let dirLen = Math.hypot(dirX, dirY);
    if (dirLen <= 1e-4){
      dirX = upx;
      dirY = upy;
      dirLen = 1;
    }
    dirX /= dirLen;
    dirY /= dirLen;
    const speed = game.MINER_EXPLOSION_DEATH_SPEED_MIN + Math.random() * (game.MINER_EXPLOSION_DEATH_SPEED_MAX - game.MINER_EXPLOSION_DEATH_SPEED_MIN);
    const life = game.MINER_EXPLOSION_DEATH_LIFE + Math.random() * 0.35;
    game.fallenMiners.push({
      x: miner.x,
      y: miner.y,
      vx: dirX * speed + ((impact && impact.vx) || 0) * 0.16,
      vy: dirY * speed + ((impact && impact.vy) || 0) * 0.16,
      life,
      maxLife: life,
      upx,
      upy,
      rot: Math.atan2(dirY, dirX),
      spin: (Math.random() < 0.5 ? -1 : 1) * (5.5 + Math.random() * 5.5),
      leanDir: (Math.random() < 0.5 ? -1 : 1),
      type: miner.type,
      mode,
    });
    audioState.playSfx(game, "miner_down", { volume: 0.42, rate: 0.68 + Math.random() * 0.08 });
    return;
  }
  const tangential = ((impact && impact.vx) || 0) * tx + ((impact && impact.vy) || 0) * ty;
  const leanDir = tangential < -1e-4 ? -1 : (tangential > 1e-4 ? 1 : (Math.random() < 0.5 ? -1 : 1));
  let impactDirX = (impact && Number.isFinite(impact.vx)) ? Number(impact.vx) : 0;
  let impactDirY = (impact && Number.isFinite(impact.vy)) ? Number(impact.vy) : 0;
  let impactDirLen = Math.hypot(impactDirX, impactDirY);
  if (impactDirLen <= 1e-4 && impact && Number.isFinite(impact.x) && Number.isFinite(impact.y)){
    impactDirX = miner.x - Number(impact.x);
    impactDirY = miner.y - Number(impact.y);
    impactDirLen = Math.hypot(impactDirX, impactDirY);
  }
  if (impactDirLen <= 1e-4){
    impactDirX = tx * leanDir;
    impactDirY = ty * leanDir;
    impactDirLen = 1;
  }
  impactDirX /= impactDirLen;
  impactDirY /= impactDirLen;
  const hitPush = 0.07 + Math.random() * 0.06;
  const sidewaysSlide = 0.03 + Math.random() * 0.05;
  const life = game.MINER_SHOT_DEATH_LIFE + Math.random() * 0.25;
  game.fallenMiners.push({
    x: miner.x,
    y: miner.y,
    vx: impactDirX * hitPush + tx * leanDir * sidewaysSlide,
    vy: impactDirY * hitPush + ty * leanDir * sidewaysSlide,
    life,
    maxLife: life,
    upx,
    upy,
    rot: Math.atan2(upy, upx),
    spin: 0,
    leanDir,
    type: miner.type,
    mode,
  });
  audioState.playSfx(game, "miner_down", { volume: 0.35, rate: 0.78 + Math.random() * 0.08 });
}

/**
 * @param {Game} game
 * @param {number} index
 * @param {"shot"|"exploded"} mode
 * @param {{x?:number,y?:number,vx?:number,vy?:number}|null|undefined} [impact]
 * @returns {void}
 */
function killMinerAt(game, index, mode, impact){
  const miner = /** @type {import("./types.d.js").Miner|undefined} */ (game.miners[index]);
  if (!miner) return;
  spawnFallenMiner(game, miner, mode, impact);
  game.miners.splice(index, 1);
  game.minersRemaining = Math.max(0, game.minersRemaining - 1);
  stats.registerMinerLoss(game, 1);
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
function updateFallenMiners(game, dt){
  if (!game.fallenMiners.length) return;
  const drag = Math.max(0, 1 - game.planetParams.DRAG * 0.8 * dt);
  for (let i = game.fallenMiners.length - 1; i >= 0; i--){
    const miner = game.fallenMiners[i];
    if (!miner) continue;
    if (miner.mode === "exploded"){
      const g = game.planet.gravityAt(miner.x, miner.y);
      miner.vx += g.x * dt;
      miner.vy += g.y * dt;
      miner.vx *= drag;
      miner.vy *= drag;
      miner.x += miner.vx * dt;
      miner.y += miner.vy * dt;
      miner.rot += miner.spin * dt;
    } else {
      miner.vx *= Math.max(0, 1 - 5.0 * dt);
      miner.vy *= Math.max(0, 1 - 5.0 * dt);
      miner.x += miner.vx * dt;
      miner.y += miner.vy * dt;
    }
    miner.life -= dt;
    if (miner.life <= 0){
      game.fallenMiners.splice(i, 1);
    }
  }
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function minerCollidesAt(game, x, y){
  const r = Math.hypot(x, y) || 1;
  const upx = x / r;
  const upy = y / r;
  const footX = x + upx * game.MINER_FOOT_OFFSET;
  const footY = y + upy * game.MINER_FOOT_OFFSET;
  const headX = x + upx * game.MINER_HEAD_OFFSET;
  const headY = y + upy * game.MINER_HEAD_OFFSET;
  return game.collision.collidesAtPoints([
    [footX, footY],
    [headX, headY],
  ]);
}

/**
 * @param {Game} game
 * @returns {void}
 */
function spawnMiners(game){
  const cfg = game.planet ? game.planet.getPlanetConfig() : null;
  const base = (cfg && typeof cfg.minerCountBase === "number") ? cfg.minerCountBase : 0;
  const per = (cfg && typeof cfg.minerCountPerLevel === "number") ? cfg.minerCountPerLevel : 0;
  const cap = (cfg && typeof cfg.minerCountCap === "number") ? cfg.minerCountCap : 0;
  const count = Math.min(cap, base + Math.max(0, game.level - 1) * per);
  const seed = game.planet.getSeed() + game.level * 97;
  const barrenPerimeter = !!(cfg && cfg.flags && cfg.flags.barrenPerimeter);
  const spawnPlan = planetSpawn.planMinerSpawnPlacements(game.planet, count, seed, GAME.MINER_MIN_SEP);
  const placed = spawnPlan.placements;
  debug.logMinerSpawnDiagnostics(game, spawnPlan, count);
  game.minerCandidates = placed.length;
  const cutoffPilot = (game.ship.mothershipPilots < 3) ? 1 : 0;
  const cutoffEngineer = cutoffPilot + 1;
  /** @type {Array<import("./types.d.js").Miner>} */
  const nudged = [];
  for (const p of placed){
    const minerType =
      (nudged.length < cutoffPilot) ? "pilot" :
      (nudged.length < cutoffEngineer) ? "engineer" :
      "miner";
    let x = Number(p.x);
    let y = Number(p.y);
    if (barrenPerimeter){
      const normal = game.planet.normalAtWorld(x, y);
      if (normal){
        x += normal.nx * 0.02;
        y += normal.ny * 0.02;
      }
    } else {
      let res = game.planet.nudgeOutOfTerrain(x, y);
      if (!res.ok && Number.isFinite(p.supportX) && Number.isFinite(p.supportY)){
        const anchorX = Number(p.supportX);
        const anchorY = Number(p.supportY);
        const normal = game.planet.normalAtWorld(anchorX, anchorY);
        const fallbackX = normal ? (anchorX + normal.nx * Math.max(0.03, game.MINER_SURFACE_EPS * 3)) : anchorX;
        const fallbackY = normal ? (anchorY + normal.ny * Math.max(0.03, game.MINER_SURFACE_EPS * 3)) : anchorY;
        res = game.planet.nudgeOutOfTerrain(fallbackX, fallbackY, 0.35, 0.03, 0.08);
        if (!res.ok && game.collision.airValueAtWorld(fallbackX, fallbackY) > 0.5){
          res = { ok: true, x: fallbackX, y: fallbackY };
        }
      }
      if (!res.ok){
        continue;
      }
      x = res.x;
      y = res.y;
    }
    /** @type {import("./types.d.js").Miner} */
    const miner = { x, y, jumpCycle: Math.random(), type: minerType, state: "idle", vx: 0, vy: 0, fallTime: 0 };
    refreshMinerSupport(game, miner, p);
    nudged.push(miner);
  }
  game.miners = nudged;
  game.minersRemaining = game.miners.length;
  const missed = Math.max(0, count - game.miners.length);
  game.minersDead = missed;
  game.levelStats.minersLost = missed;
  game.overallStats.minersLost += missed;
  game.minerTarget = count;
}

/**
 * Nudge miners out of terrain after mode changes; kill if deeply buried.
 * @param {Game} game
 * @returns {void}
 */
function nudgeMinersFromTerrain(game){
  for (let i = game.miners.length - 1; i >= 0; i--){
    const m = /** @type {import("./types.d.js").Miner} */ (game.miners[i]);
    if (m.state === "falling") continue;
    const res = game.planet.nudgeOutOfTerrain(m.x, m.y);
    if (!res.ok){
      game.miners.splice(i, 1);
      game.minersRemaining = Math.max(0, game.minersRemaining - 1);
      stats.registerMinerLoss(game, 1);
      continue;
    }
    m.x = res.x;
    m.y = res.y;
    refreshMinerSupport(game, m);
  }
}

/**
 * @param {Game} game
 * @returns {number}
 */
function minerSupportRadius(game){
  return Math.max(0.08, game.MINER_HEIGHT * 0.36);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {number} [preferredIndex=-1]
 * @returns {number[]}
 */
function collectMinerSupportFootprint(game, x, y, preferredIndex = -1){
  const graph = game.planet && game.planet.getRadialGraph
    ? game.planet.getRadialGraph(false)
    : (game.planet ? game.planet.radialGraph : null);
  const nodes = graph && graph.nodes ? graph.nodes : null;
  const air = game.planet && game.planet.getAirNodesBitmap
    ? game.planet.getAirNodesBitmap(false)
    : (game.planet ? game.planet.airNodesBitmap : null);
  return collectSupportNodeIndices(nodes, air, x, y, minerSupportRadius(game), preferredIndex, 4);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {number} [maxDist]
 * @param {number} [minR]
 * @returns {import("./types.d.js").StandablePoint|null}
 */
function nearestMinerStandablePoint(game, x, y, maxDist = Infinity, minR = 0){
  if (!game.planet) return null;
  const points = terrainSupport.getStandablePoints(game.planet);
  if (!points || !points.length) return null;
  const maxDistSq = Number.isFinite(maxDist) ? (Number(maxDist) * Number(maxDist)) : Infinity;
  /** @type {import("./types.d.js").StandablePoint|null} */
  let best = null;
  let bestD2 = maxDistSq;
  for (const pt of points){
    if (!pt) continue;
    if (minR > 0 && pt[3] < minR) continue;
    const dx = pt[0] - x;
    const dy = pt[1] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= bestD2) continue;
    bestD2 = d2;
    best = pt;
  }
  return best;
}

/**
 * @param {Game} _loop
 * @param {import("./types.d.js").Miner|null|undefined} miner
 * @returns {number[]}
 */
function minerSupportIndices(_loop, miner){
  return getSupportNodeIndices(miner);
}

/**
 * @param {Game} _loop
 * @param {import("./types.d.js").Miner|null|undefined} miner
 * @returns {void}
 */
function clearMinerSupportState(_loop, miner){
  clearTerrainSupport(miner);
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").Miner} miner
 * @param {number} anchorX
 * @param {number} anchorY
 * @param {number} [preferredIndex=-1]
 * @param {number[]|null} [explicitIndices=null]
 * @returns {boolean}
 */
function setMinerSupportAnchorState(game, miner, anchorX, anchorY, preferredIndex = -1, explicitIndices = null){
  if (!miner || !Number.isFinite(anchorX) || !Number.isFinite(anchorY)) return false;
  setSupportAnchor(miner, anchorX, anchorY);
  const supportIndices = Array.isArray(explicitIndices) && explicitIndices.length
    ? explicitIndices.filter((idx) => Number.isFinite(idx)).map((idx) => Number(idx))
    : collectMinerSupportFootprint(game, anchorX, anchorY, preferredIndex);
  return setSupportNodeIndices(miner, supportIndices, preferredIndex);
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").Miner} miner
 * @param {{supportX?:number,supportY?:number,supportNodeIndex?:number,supportNodeIndices?:number[]}|null} [hint]
 * @returns {boolean}
 */
function refreshMinerSupport(game, miner, hint = null){
  if (!miner || miner.state === "falling") return false;
  if (hint && Number.isFinite(hint.supportX) && Number.isFinite(hint.supportY)){
    return setMinerSupportAnchorState(
      game,
      miner,
      Number(hint.supportX),
      Number(hint.supportY),
      Number.isFinite(hint.supportNodeIndex) ? Number(hint.supportNodeIndex) : -1,
      Array.isArray(hint.supportNodeIndices) ? hint.supportNodeIndices : null,
    );
  }
  const pt = nearestMinerStandablePoint(game, miner.x, miner.y, Math.max(0.18, game.MINER_HEIGHT * 1.4));
  if (!pt){
    clearMinerSupportState(game, miner);
    return false;
  }
  return setMinerSupportAnchorState(
    game,
    miner,
    Number(pt[0]),
    Number(pt[1]),
    Number.isFinite(pt[4]) ? Number(pt[4]) : -1,
    null,
  );
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").Miner} miner
 * @returns {boolean|null}
 */
function minerTrackedSupportIntact(game, miner){
  const supportIndices = minerSupportIndices(game, miner);
  if (!supportIndices.length) return null;
  const graph = game.planet && game.planet.getRadialGraph
    ? game.planet.getRadialGraph(false)
    : (game.planet ? game.planet.radialGraph : null);
  const nodes = graph && graph.nodes ? graph.nodes : null;
  const air = game.planet && game.planet.getAirNodesBitmap
    ? game.planet.getAirNodesBitmap(false)
    : (game.planet ? game.planet.airNodesBitmap : null);
  if (!nodes || !air || air.length !== nodes.length) return null;
  for (const idx of supportIndices){
    if (!Number.isFinite(idx) || idx < 0 || idx >= air.length || air[idx]){
      return false;
    }
  }
  return true;
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").Miner} miner
 * @returns {boolean}
 */
function minerHasTerrainSupport(game, miner){
  if (!miner) return false;
  const trackedSupport = minerTrackedSupportIntact(game, miner);
  if (trackedSupport !== null){
    return trackedSupport;
  }
  const r = Math.hypot(miner.x, miner.y) || 1;
  const upx = miner.x / r;
  const upy = miner.y / r;
  const tx = -upy;
  const ty = upx;
  const footBaseX = miner.x - upx * (game.MINER_HEAD_OFFSET * 0.32 + game.MINER_SURFACE_EPS * 2.5);
  const footBaseY = miner.y - upy * (game.MINER_HEAD_OFFSET * 0.32 + game.MINER_SURFACE_EPS * 2.5);
  const probeDepth = Math.max(0.05, game.MINER_HEIGHT * 0.32);
  const probeWidth = Math.max(0.04, GAME.MINER_SCALE * 0.14);
  const offsets = [0, -probeWidth, probeWidth];
  for (const offset of offsets){
    const px = footBaseX + tx * offset - upx * probeDepth;
    const py = footBaseY + ty * offset - upy * probeDepth;
    if (game.planet.airValueAtWorld(px, py) <= 0.5){
      return true;
    }
  }
  return false;
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").DestroyedTerrainNode[]} destroyedNodes
 * @param {{x?:number,y?:number}|null} [impact]
 * @returns {number}
 */
function killMinersAttachedToTerrainNodes(game, destroyedNodes, impact = null){
  if (!destroyedNodes || !destroyedNodes.length || !game.miners.length) return 0;
  const destroyedByIndex = new Map(destroyedNodes.map((node) => [node.idx, node]));
  let count = 0;
  for (let i = game.miners.length - 1; i >= 0; i--){
    const miner = /** @type {import("./types.d.js").Miner} */ (game.miners[i]);
    const supportIndices = minerSupportIndices(game, miner);
    if (!supportIndices.length) continue;
    let hitNode = null;
    for (const idx of supportIndices){
      const node = destroyedByIndex.get(idx);
      if (!node) continue;
      hitNode = node;
      break;
    }
    if (!hitNode) continue;
    killMinerAt(game, i, "exploded", {
      x: Number.isFinite(hitNode.x) ? Number(hitNode.x) : (Number.isFinite(miner.supportX) ? Number(miner.supportX) : (impact && Number.isFinite(impact.x) ? Number(impact.x) : miner.x)),
      y: Number.isFinite(hitNode.y) ? Number(hitNode.y) : (Number.isFinite(miner.supportY) ? Number(miner.supportY) : (impact && Number.isFinite(impact.y) ? Number(impact.y) : miner.y)),
    });
    count++;
  }
  return count;
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").Miner} miner
 * @param {number} [vx=0]
 * @param {number} [vy=0]
 * @returns {void}
 */
function startMinerFalling(game, miner, vx = 0, vy = 0){
  if (!miner || miner.state === "falling") return;
  miner.state = "falling";
  miner.vx = vx;
  miner.vy = vy;
  miner.fallTime = 0;
  clearMinerSupportState(game, miner);
}

/**
 * @param {Game} game
 * @param {number} index
 * @param {import("./types.d.js").Miner} miner
 * @param {number} dt
 * @returns {boolean}
 */
function updateFallingMiner(game, index, miner, dt){
  const prevX = miner.x;
  const prevY = miner.y;
  const g = game.planet.gravityAt(miner.x, miner.y);
  miner.vx = (miner.vx || 0) + g.x * dt;
  miner.vy = (miner.vy || 0) + g.y * dt;
  const drag = Math.max(0, 1 - game.planetParams.DRAG * 0.45 * dt);
  miner.vx *= drag;
  miner.vy *= drag;
  miner.x += miner.vx * dt;
  miner.y += miner.vy * dt;
  miner.fallTime = (miner.fallTime || 0) + dt;
  miner.jumpCycle += dt * 0.6;
  miner.jumpCycle -= Math.floor(miner.jumpCycle);
  const crossing = game.planet.terrainCrossing({ x: prevX, y: prevY }, { x: miner.x, y: miner.y });
  if (!crossing) return true;
  const impactSpeed = Math.hypot(miner.vx || 0, miner.vy || 0);
  if (impactSpeed > 1.35 || (miner.fallTime || 0) > 0.9){
    killMinerAt(game, index, "exploded", {
      x: crossing.x,
      y: crossing.y,
      vx: miner.vx,
      vy: miner.vy,
    });
    return true;
  }
  const settleX = crossing.x + crossing.nx * Math.max(0.03, game.MINER_SURFACE_EPS * 3);
  const settleY = crossing.y + crossing.ny * Math.max(0.03, game.MINER_SURFACE_EPS * 3);
  const res = game.planet.nudgeOutOfTerrain(settleX, settleY, 0.35, 0.03, 0.08);
  miner.x = res.ok ? res.x : settleX;
  miner.y = res.ok ? res.y : settleY;
  miner.vx = 0;
  miner.vy = 0;
  miner.fallTime = 0;
  miner.state = "idle";
  refreshMinerSupport(game, miner);
  return true;
}

/**
 * @param {Game} game
 * @returns {void}
 */
function updateGuidePath(game){
  if (game.ship.state === "crashed"){
    game.ship.guidePath = null;
    return;
  }

  /**
   * @param {number} px
   * @param {number} py
   * @returns {{path:Array<{x:number,y:number}>,indexClosest:number}|null}
   */
  const tryGuidePath = (px, py) => {
    const guidePath = game.planet.surfaceGuidePathTo(px, py, GAME.MINER_CALL_RADIUS);
    if (!guidePath || !guidePath.path || guidePath.path.length < 1) return null;
    if (!Number.isFinite(guidePath.indexClosest)) return null;
    for (const point of guidePath.path){
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)){
        return null;
      }
    }
    return guidePath;
  };

  /**
   * @param {{path:Array<{x:number,y:number}>,indexClosest:number}|null} guidePath
   * @returns {boolean}
   */
  const guidePathUsable = (guidePath) => !!(
    guidePath &&
    guidePath.path &&
    guidePath.path.length > 1 &&
    Number.isFinite(guidePath.indexClosest)
  );

  let guideAnchorX = game.ship.x;
  let guideAnchorY = game.ship.y;
  const shipContact = game.ship._collision;
  if (game.ship.state === "landed" && shipContact && shipContact.source === "planet"){
    let anchorBest = { x: shipContact.x, y: shipContact.y };
    let bestRadius = Math.hypot(anchorBest.x, anchorBest.y);
    const samples = game.ship._samples;
    if (samples && samples.length){
      for (const sample of samples){
        if (!sample || sample.length < 3) continue;
        const sx = sample[0];
        const sy = sample[1];
        if (sample[2]) continue;
        if (game.collision.planetAirValueAtWorld(sx, sy) > 0.5) continue;
        const radius = Math.hypot(sx, sy);
        if (radius > bestRadius){
          bestRadius = radius;
          anchorBest = { x: sx, y: sy };
        }
      }
    }
    guideAnchorX = anchorBest.x;
    guideAnchorY = anchorBest.y;
  }

  let guidePath = tryGuidePath(guideAnchorX, guideAnchorY);
  if (!guidePathUsable(guidePath) && game.ship.state === "landed"){
    const normal = game.planet.normalAtWorld(guideAnchorX, guideAnchorY);
    if (normal){
      const tx = -normal.ny;
      const ty = normal.nx;
      const probes = [
        [ tx * 0.30, ty * 0.30],
        [-tx * 0.30,-ty * 0.30],
        [ tx * 0.60, ty * 0.60],
        [-tx * 0.60,-ty * 0.60],
        [ normal.nx * 0.18, normal.ny * 0.18],
        [-normal.nx * 0.18,-normal.ny * 0.18],
      ];
      for (let i = 0; i < probes.length && !guidePathUsable(guidePath); i++){
        const probe = /** @type {[number, number]} */ (probes[i]);
        guidePath = tryGuidePath(guideAnchorX + probe[0], guideAnchorY + probe[1]);
      }
    }
    if (!guidePathUsable(guidePath)){
      /** @type {number[]} */
      const ringOffsets = [0.35, 0.65];
      for (let i = 0; i < ringOffsets.length && !guidePathUsable(guidePath); i++){
        const radius = /** @type {number} */ (ringOffsets[i]);
        for (let a = 0; a < 8 && !guidePathUsable(guidePath); a++){
          const angle = (Math.PI * 2 * a) / 8;
          guidePath = tryGuidePath(
            guideAnchorX + Math.cos(angle) * radius,
            guideAnchorY + Math.sin(angle) * radius
          );
        }
      }
    }
    if (!guidePathUsable(guidePath)){
      const closest = game.planet.posClosest(guideAnchorX, guideAnchorY);
      if (closest && Number.isFinite(closest.x) && Number.isFinite(closest.y)){
        guidePath = { path: [{ x: closest.x, y: closest.y }], indexClosest: 0 };
      }
    }
  }

  game.ship.guidePath = guidePath;
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
function updateMiners(game, dt){
  const guidepathMargin = Math.max(0.15, GAME.MINER_GUIDE_ATTACH_RADIUS || 0.75);
  const guidepathAttachTolerance = 0.12;
  const attachDist = guidepathMargin + guidepathAttachTolerance;
  const guidePath = game.ship.guidePath;
  const guidePathUsable = !!(guidePath && guidePath.path && guidePath.path.length > 1 && Number.isFinite(guidePath.indexClosest));
  let debugMinerPathToMiner = null;
  let debugMinerPathScore = Infinity;
  const minerPathDebugEnabled = game.debugState.minerGuidePath;
  if (game.debugState.minerPathDebugCooldown > 0){
    game.debugState.minerPathDebugCooldown = Math.max(0, game.debugState.minerPathDebugCooldown - dt);
  }
  let minerPathDebugRecord = null;
  const pathRaiseAmount = 0.02;
  const boardTargetLocalY = GAME.SHIP_SCALE * 0.12;

  const landed = game.ship.state === "landed";
  const shipRadius = collisionDropship.shipRadius(game);
  const boardTarget = landed ? collisionDropship.shipWorldPoint(game, 0, boardTargetLocalY, game.ship.x, game.ship.y) : null;
  const directBoardRange = shipRadius + Math.max(0.28, (GAME.MINER_GUIDE_ATTACH_RADIUS || 0) * 0.3);
  const guidePathIndexShip = (landed && guidePathUsable) ? findGuidePathTargetIndex(guidePath, game.ship.x, game.ship.y) : null;

  for (let i = game.miners.length - 1; i >= 0; i--){
    const miner = /** @type {import("./types.d.js").Miner} */ (game.miners[i]);
    const prevMinerX = miner.x;
    const prevMinerY = miner.y;
    if (miner.state === "falling"){
      updateFallingMiner(game, i, miner, dt);
      continue;
    }

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

    miner.state = (indexPathMiner !== null) ? "running" : "idle";
    const indexPathMinerInitial = indexPathMiner;
    let indexPathTarget = null;
    let distMax = 0;
    let dAttach = null;
    let attachSnap = Math.max(0.03, guidepathAttachTolerance);
    let attachBlocked = false;

    const r = Math.hypot(miner.x, miner.y) || 1;
    miner.jumpCycle += 1.5 * dt * r / game.planet.planetRadius;
    miner.jumpCycle -= Math.floor(miner.jumpCycle);

    if (miner.state === "running"){
      const activeGuidePath = /** @type {NonNullable<typeof guidePath>} */ (guidePath);
      indexPathTarget = (guidePathIndexShip !== null) ? guidePathIndexShip : activeGuidePath.indexClosest;
      distMax = (landed ? GAME.MINER_RUN_SPEED : GAME.MINER_JOG_SPEED) * dt;
      const posAttach = posFromPathIndex(activeGuidePath.path, /** @type {number} */ (indexPathMiner));
      const dxAttach = posAttach.x - miner.x;
      const dyAttach = posAttach.y - miner.y;
      dAttach = Math.hypot(dxAttach, dyAttach);
      if (dAttach > attachSnap){
        attachBlocked = !collisionWorld.segmentPlanetAirClear(game, miner.x, miner.y, posAttach.x, posAttach.y, 0.02);
      }
      if (attachBlocked){
        miner.state = "idle";
        indexPathMiner = null;
      } else if (dAttach > attachSnap){
        const step = Math.min(distMax, dAttach);
        miner.x += (dxAttach / dAttach) * step;
        miner.y += (dyAttach / dAttach) * step;
      } else {
        const atBoardingSegment = Math.abs(/** @type {number} */ (indexPathMiner) - /** @type {number} */ (indexPathTarget)) <= 0.08;
        if (!atBoardingSegment && /** @type {number} */ (indexPathMiner) < /** @type {number} */ (indexPathTarget)) {
          indexPathMiner = moveAlongPathPositive(activeGuidePath.path, /** @type {number} */ (indexPathMiner), distMax, /** @type {number} */ (indexPathTarget));
        } else if (!atBoardingSegment && /** @type {number} */ (indexPathMiner) > /** @type {number} */ (indexPathTarget)) {
          indexPathMiner = moveAlongPathNegative(activeGuidePath.path, /** @type {number} */ (indexPathMiner), distMax, /** @type {number} */ (indexPathTarget));
          console.assert(indexPathMiner >= 0);
        }

        if (!atBoardingSegment){
          const posNew = posFromPathIndex(activeGuidePath.path, /** @type {number} */ (indexPathMiner));
          const rNew = Math.hypot(posNew.x, posNew.y);
          const scalePos = 1 + pathRaiseAmount / rNew;
          miner.x = posNew.x * scalePos;
          miner.y = posNew.y * scalePos;
        }

        if (atBoardingSegment){
          const boardTargetNow = /** @type {{x:number,y:number}} */ (boardTarget);
          const dxShip = boardTargetNow.x - miner.x;
          const dyShip = boardTargetNow.y - miner.y;
          const dShip = Math.hypot(dxShip, dyShip);
          if (dShip > 1e-5){
            const stepShip = Math.min(distMax, dShip);
            miner.x += (dxShip / dShip) * stepShip;
            miner.y += (dyShip / dShip) * stepShip;
          }
        }
      }
    }

    if (landed && miner.state !== "running" && boardTarget){
      const bodyHullDist = collisionDropship.shipConvexHullDistance(game, miner.x, miner.y, game.ship.x, game.ship.y);
      const centerDistDirect = Math.hypot(miner.x - game.ship.x, miner.y - game.ship.y);
      const nearShipForDirectBoard = centerDistDirect <= directBoardRange || bodyHullDist <= Math.max(0.18, GAME.MINER_BOARD_RADIUS * 2.5);
      if (nearShipForDirectBoard){
        const boardLineClear = bodyHullDist <= 0.05 || collisionWorld.segmentPlanetAirClear(game, miner.x, miner.y, boardTarget.x, boardTarget.y, 0.02);
        if (boardLineClear){
          const dxShip = boardTarget.x - miner.x;
          const dyShip = boardTarget.y - miner.y;
          const dShip = Math.hypot(dxShip, dyShip);
          if (dShip > 1e-5){
            const stepShip = Math.min(GAME.MINER_RUN_SPEED * dt, dShip);
            miner.x += (dxShip / dShip) * stepShip;
            miner.y += (dyShip / dShip) * stepShip;
          }
        }
      }
    }
    const minerMoved = Math.hypot(miner.x - prevMinerX, miner.y - prevMinerY);
    if (
      minerPathDebugEnabled &&
      game.debugState.minerPathDebugCooldown <= 0 &&
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
        /** @type {number} */ (attachDebug.nearestDist) <= attachDist * 2.25
      ){
        minerPathDebugRecord = {
          reason: "idle_no_attach",
          minerIndex: i,
          minerType: miner.type,
          ship: { x: game.ship.x, y: game.ship.y },
          miner: { x: prevMinerX, y: prevMinerY, r: rMiner },
          attachDist,
          attach: attachDebug,
        };
      } else if (indexPathMinerInitial !== null){
        const pathDelta = (indexPathTarget !== null) ? Math.abs(indexPathMinerInitial - indexPathTarget) : 0;
        const attachDistance = dAttach ?? Number.NaN;
        const shouldStepToAttach = Number.isFinite(attachDistance) && attachDistance > (attachSnap + 1e-4);
        const shouldStepAlongPath = Number.isFinite(pathDelta) && pathDelta > 0.06;
        if (attachBlocked){
          minerPathDebugRecord = {
            reason: "attach_blocked_by_terrain",
            minerIndex: i,
            minerType: miner.type,
            ship: { x: game.ship.x, y: game.ship.y },
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
            ship: { x: game.ship.x, y: game.ship.y },
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
    const headX = miner.x + upx * game.MINER_HEAD_OFFSET;
    const headY = miner.y + upy * game.MINER_HEAD_OFFSET;
    const footX = miner.x - upx * game.MINER_HEAD_OFFSET * 0.32;
    const footY = miner.y - upy * game.MINER_HEAD_OFFSET * 0.32;
    const hullDistHead = collisionDropship.shipConvexHullDistance(game, headX, headY, game.ship.x, game.ship.y);
    const hullDistBody = collisionDropship.shipConvexHullDistance(game, miner.x, miner.y, game.ship.x, game.ship.y);
    const hullDistFeet = collisionDropship.shipConvexHullDistance(game, footX, footY, game.ship.x, game.ship.y);
    const hullDist = Math.min(hullDistHead, hullDistBody, hullDistFeet);
    const boardAcceptRadius = Math.max(GAME.MINER_BOARD_RADIUS, GAME.SHIP_SCALE * 0.28);
    const minerLocalBody = collisionDropship.shipLocalPoint(game, miner.x, miner.y, game.ship.x, game.ship.y);
    const minerLocalHead = collisionDropship.shipLocalPoint(game, headX, headY, game.ship.x, game.ship.y);
    const centerDist = Math.min(
      Math.hypot(headX - game.ship.x, headY - game.ship.y),
      Math.hypot(miner.x - game.ship.x, miner.y - game.ship.y),
      Math.hypot(footX - game.ship.x, footY - game.ship.y),
    );
    const boardNearShip = centerDist <= (shipRadius + boardAcceptRadius);
    const boardPastCenterLine = Math.max(minerLocalBody.y, minerLocalHead.y) >= -(GAME.SHIP_SCALE * 0.08);
    const boardAtTarget = !!(boardTarget && Math.hypot(miner.x - boardTarget.x, miner.y - boardTarget.y) <= Math.max(boardAcceptRadius, GAME.SHIP_SCALE * 0.18));
    if (landed && hullDist <= boardAcceptRadius && boardNearShip && (boardPastCenterLine || boardAtTarget)){
      weapons.spawnPickupAnimation(game, miner.type, miner.x, miner.y, 0, 0);
      if (miner.type === "miner"){
        ++game.ship.dropshipMiners;
      } else if (miner.type === "pilot"){
        ++game.ship.dropshipPilots;
      } else if (miner.type === "engineer"){
        ++game.ship.dropshipEngineers;
      }
      game.minersRemaining = Math.max(0, game.minersRemaining - 1);
      const tx = -upy;
      const ty = upx;
      const jitter = (Math.random() * 2 - 1) * GAME.MINER_POPUP_TANGENTIAL;
      game.popups.push({
        x: miner.x + upx * 0.1,
        y: miner.y + upy * 0.1,
        vx: upx * GAME.MINER_POPUP_SPEED + tx * jitter,
        vy: upy * GAME.MINER_POPUP_SPEED + ty * jitter,
        text: "+1",
        life: GAME.MINER_POPUP_LIFE,
      });
      audioState.playSfx(game, "miner_rescued", {
        volume: 0.45,
        rate: 0.95 + Math.random() * 0.1,
      });
      game.miners.splice(i, 1);
      continue;
    }

    const supportBypass = landed && (
      boardNearShip
      || hullDist <= Math.max(0.16, boardAcceptRadius * 1.8)
      || !!(boardTarget && Math.hypot(miner.x - boardTarget.x, miner.y - boardTarget.y) <= directBoardRange)
    );
    if (!supportBypass){
      if (minerMoved > 1e-5 || !minerSupportIndices(game, miner).length){
        refreshMinerSupport(game, miner);
      }
      if (minerTrackedSupportIntact(game, miner) === false){
        killMinerAt(game, i, "exploded", {
          x: Number.isFinite(miner.supportX) ? Number(miner.supportX) : miner.x,
          y: Number.isFinite(miner.supportY) ? Number(miner.supportY) : miner.y,
        });
        continue;
      }
    }
    if (!supportBypass && !minerHasTerrainSupport(game, miner)){
      const minerVx = dt > 1e-5 ? (miner.x - prevMinerX) / dt : 0;
      const minerVy = dt > 1e-5 ? (miner.y - prevMinerY) / dt : 0;
      startMinerFalling(game, miner, minerVx, minerVy);
      continue;
    }
  }

  debug.updateMinerPathDebugState(game, minerPathDebugRecord, debugMinerPathToMiner, landed, guidePathUsable);
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function update(game, dt){
  updateGuidePath(game);
  updateMiners(game, dt);
  updateFallenMiners(game, dt);
}

export {
  clearMinerSupportState,
  collectMinerSupportFootprint,
  killMinerAt,
  killMinersAttachedToTerrainNodes,
  minerHasTerrainSupport,
  minerSupportIndices,
  minerSupportRadius,
  minerTrackedSupportIntact,
  nearestMinerStandablePoint,
  nudgeMinersFromTerrain,
  refreshMinerSupport,
  setMinerSupportAnchorState,
  spawnFallenMiner,
  spawnMiners,
  startMinerFalling,
  updateFallingMiner,
};


/**
 * @typedef {{x:number,y:number,air:number}} MeshVertex
 * @typedef {{x:number,y:number}} Point
 * @typedef {{a:number,b:number,len:number,slope:number,dotUp:number,rMid:number}} GuideSegment
 * @typedef {{threshold:number,nodes:Array<Point>,neighbors:Array<Array<{to:number,len:number,seg:number}>>,segments:Array<GuideSegment>}} GuideContour
 */

/** @type {WeakMap<object, Map<number, GuideContour>>} */
const contourCache = new WeakMap();

/**
 * @template T
 * @param {T|null|undefined} value
 * @returns {T}
 */
function expectDefined(value){
  if (value == null){
    throw new Error("Expected value to be defined");
  }
  return value;
}

/**
 * @param {any} mesh
 * @returns {Map<number, GuideContour>}
 */
function meshCache(mesh){
  let map = contourCache.get(mesh);
  if (!map){
    map = new Map();
    contourCache.set(mesh, map);
  }
  return map;
}

/**
 * @param {any} mesh
 * @returns {void}
 */
export function invalidateSurfaceGuidePathCache(mesh){
  contourCache.delete(mesh);
}

/**
 * @param {any} mesh
 * @param {MeshVertex} a
 * @param {MeshVertex} b
 * @returns {string}
 */
function edgeKeyFromVerts(mesh, a, b){
  if (mesh && typeof mesh._edgeKeyFromVerts === "function"){
    return mesh._edgeKeyFromVerts(a, b);
  }
  const ax = Math.round(a.x * 1000);
  const ay = Math.round(a.y * 1000);
  const bx = Math.round(b.x * 1000);
  const by = Math.round(b.y * 1000);
  if (ax < bx || (ax === bx && ay <= by)){
    return `${ax},${ay}|${bx},${by}`;
  }
  return `${bx},${by}|${ax},${ay}`;
}

/**
 * @param {Array<Point>} path
 * @param {number} qx
 * @param {number} qy
 * @returns {number|null}
 */
export function closestPathIndex(path, qx, qy){
  if (!path || path.length < 2) return null;
  let bestD2 = Infinity;
  let bestIndex = null;
  for (let i = 1; i < path.length; i++){
    const p0 = expectDefined(path[i - 1]);
    const p1 = expectDefined(path[i]);
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const den = dx * dx + dy * dy;
    if (den < 1e-10) continue;
    let u = ((qx - p0.x) * dx + (qy - p0.y) * dy) / den;
    u = Math.max(0, Math.min(1, u));
    const cx = p0.x + dx * u;
    const cy = p0.y + dy * u;
    const ddx = qx - cx;
    const ddy = qy - cy;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < bestD2){
      bestD2 = d2;
      bestIndex = (i - 1) + u;
    }
  }
  return bestIndex;
}

/**
 * Build contour graph from exact triangle-edge crossings at a threshold.
 * @param {any} mesh
 * @param {number} [threshold]
 * @returns {GuideContour}
 */
export function ensureSurfaceGuideContour(mesh, threshold = 0.5){
  const cache = meshCache(mesh);
  const cached = cache.get(threshold);
  if (cached) return cached;

  /** @type {Array<Point>} */
  const nodes = [];
  /** @type {Array<Array<{to:number,len:number,seg:number}>>} */
  const neighbors = [];
  /** @type {Array<GuideSegment>} */
  const segments = [];
  const nodeOfEdge = new Map();
  const nodeOfPoint = new Map();
  const segmentKeys = new Set();

  /**
   * @param {number} x
   * @param {number} y
   * @returns {string}
   */
  const pointKey = (x, y) => `${Math.round(x * 1000)}:${Math.round(y * 1000)}`;

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} [key]
   * @returns {number}
   */
  const getOrCreateNode = (x, y, key) => {
    const k = key || pointKey(x, y);
    const existing = nodeOfPoint.get(k);
    if (existing !== undefined) return existing;
    const idx = nodes.length;
    nodes.push({ x, y });
    neighbors.push([]);
    nodeOfPoint.set(k, idx);
    return idx;
  };

  /**
   * @param {MeshVertex} v
   * @returns {number}
   */
  const getVertexNode = (v) => {
    const vid = mesh && mesh._vertIdOf ? mesh._vertIdOf.get(v) : undefined;
    const key = (vid !== undefined) ? `v:${vid}` : pointKey(v.x, v.y);
    return getOrCreateNode(v.x, v.y, key);
  };

  /**
   * @param {MeshVertex} a
   * @param {MeshVertex} b
   * @returns {number}
   */
  const getCrossNode = (a, b) => {
    const eKey = edgeKeyFromVerts(mesh, a, b);
    let nodeIdx = nodeOfEdge.get(eKey);
    if (nodeIdx !== undefined) return nodeIdx;
    const denom = b.air - a.air;
    const t = (Math.abs(denom) > 1e-8)
      ? Math.max(0, Math.min(1, (threshold - a.air) / denom))
      : 0.5;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    nodeIdx = getOrCreateNode(x, y, `e:${eKey}`);
    nodeOfEdge.set(eKey, nodeIdx);
    return nodeIdx;
  };

  /**
   * @param {number} ia
   * @param {number} ib
   * @returns {void}
   */
  const addSegment = (ia, ib) => {
    if (ia === ib) return;
    const segKey = (ia < ib) ? `${ia}:${ib}` : `${ib}:${ia}`;
    if (segmentKeys.has(segKey)) return;
    const pa = nodes[ia];
    const pb = nodes[ib];
    if (!pa || !pb) return;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (!(len > 1e-6)) return;
    const tx = (pb.x - pa.x) / len;
    const ty = (pb.y - pa.y) / len;
    const mx = (pa.x + pb.x) * 0.5;
    const my = (pa.y + pb.y) * 0.5;
    const rMid = Math.hypot(mx, my) || 1;
    const ux = mx / rMid;
    const uy = my / rMid;
    const n0x = -ty;
    const n0y = tx;
    const n1x = ty;
    const n1y = -tx;

    const probe = 0.08;
    const a0 = mesh.airValueAtWorld(mx + n0x * probe, my + n0y * probe);
    const b0 = mesh.airValueAtWorld(mx - n0x * probe, my - n0y * probe);
    const a1 = mesh.airValueAtWorld(mx + n1x * probe, my + n1y * probe);
    const b1 = mesh.airValueAtWorld(mx - n1x * probe, my - n1y * probe);
    const o0 = a0 - b0;
    const o1 = a1 - b1;
    let nx = n0x;
    let ny = n0y;
    if (o1 > o0){
      nx = n1x;
      ny = n1y;
    }
    const dotUp = nx * ux + ny * uy;
    const slope = 1 - dotUp;

    segmentKeys.add(segKey);
    const iSeg = segments.length;
    segments.push({ a: ia, b: ib, len, slope, dotUp, rMid });
    expectDefined(neighbors[ia]).push({ to: ib, len, seg: iSeg });
    expectDefined(neighbors[ib]).push({ to: ia, len, seg: iSeg });
  };

  const triList = mesh._triList || [];
  for (const tri of triList){
    if (!tri || tri.length < 3) continue;
    const crossed = [];
    const edges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
    for (const edge of edges){
      const a = expectDefined(edge[0]);
      const b = expectDefined(edge[1]);
      const aboveA = a.air > threshold;
      const aboveB = b.air > threshold;
      if (aboveA === aboveB) continue;
      crossed.push(getCrossNode(a, b));
    }
    if (crossed.length !== 2) continue;
    addSegment(expectDefined(crossed[0]), expectDefined(crossed[1]));
  }

  const outer = mesh.rings && mesh.rings.length ? mesh.rings[mesh.rings.length - 1] : null;
  if (outer && outer.length > 1){
    for (let i = 0; i < outer.length; i++){
      const v0 = expectDefined(outer[i]);
      const v1 = expectDefined(outer[(i + 1) % outer.length]);
      const rock0 = v0.air <= threshold;
      const rock1 = v1.air <= threshold;
      if (!rock0 && !rock1) continue;
      if (rock0 && rock1){
        addSegment(getVertexNode(v0), getVertexNode(v1));
        continue;
      }
      if (rock0){
        addSegment(getVertexNode(v0), getCrossNode(v0, v1));
      } else {
        addSegment(getCrossNode(v0, v1), getVertexNode(v1));
      }
    }
  }

  const contour = { threshold, nodes, neighbors, segments };
  cache.set(threshold, contour);
  return contour;
}

/**
 * Build miner guide path directly from barycentric contour segments.
 * @param {any} mesh
 * @param {number} x
 * @param {number} y
 * @param {number} maxDistance
 * @returns {{path:Array<Point>, indexClosest:number}|null}
 */
export function buildSurfaceGuidePath(mesh, x, y, maxDistance){
  const contour = ensureSurfaceGuideContour(mesh, 0.5);
  const nodes = contour.nodes;
  const segments = contour.segments;
  const neighbors = contour.neighbors;
  if (!nodes.length || !segments.length) return null;

  const maxSlope = Math.max(0.08, Math.min(0.6, Number.isFinite(GAME.MINER_WALK_MAX_SLOPE) ? GAME.MINER_WALK_MAX_SLOPE : 0.35));
  const minDotUp = Math.max(0.2, 1 - maxSlope);
  const rAnchor = Math.hypot(x, y);
  const radialBias = 2.5;
  const preferOuter = rAnchor >= (mesh._R_MESH - 1.8);

  /**
   * @param {number} outerSlack
   * @returns {Uint8Array}
   */
  const buildSegAllowed = (outerSlack) => {
    const out = new Uint8Array(segments.length);
    const outerBandInner = rAnchor - outerSlack;
    for (let i = 0; i < segments.length; i++){
      const s = expectDefined(segments[i]);
      if (!(s.dotUp >= minDotUp && s.slope <= maxSlope)){
        out[i] = 0;
        continue;
      }
      if (preferOuter && s.rMid < outerBandInner){
        out[i] = 0;
        continue;
      }
      out[i] = 1;
    }
    return out;
  };

  /**
   * @param {Uint8Array} mask
   * @returns {{seg:number,x:number,y:number,d:number}|null}
   */
  const pickBestSegment = (mask) => {
    let seg = -1;
    let scoreBest = Infinity;
    let pxBest = 0;
    let pyBest = 0;
    let dBest = Infinity;
    for (let i = 0; i < segments.length; i++){
      if (!mask[i]) continue;
      const s = expectDefined(segments[i]);
      const a = expectDefined(nodes[s.a]);
      const b = expectDefined(nodes[s.b]);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const den = dx * dx + dy * dy;
      if (den < 1e-10) continue;
      let u = ((x - a.x) * dx + (y - a.y) * dy) / den;
      u = Math.max(0, Math.min(1, u));
      const px = a.x + dx * u;
      const py = a.y + dy * u;
      const ddx = x - px;
      const ddy = y - py;
      const d2 = ddx * ddx + ddy * ddy;
      const rDiff = s.rMid - rAnchor;
      const score = d2 + radialBias * (rDiff * rDiff);
      if (score < scoreBest){
        scoreBest = score;
        seg = i;
        pxBest = px;
        pyBest = py;
        dBest = Math.hypot(ddx, ddy);
      }
    }
    if (seg < 0) return null;
    return { seg, x: pxBest, y: pyBest, d: dBest };
  };

  let segAllowed = buildSegAllowed(0.55);
  let pick = pickBestSegment(segAllowed);
  if (!pick && preferOuter){
    segAllowed = buildSegAllowed(1.35);
    pick = pickBestSegment(segAllowed);
  }
  if (!pick && preferOuter){
    segAllowed = buildSegAllowed(2.2);
    pick = pickBestSegment(segAllowed);
  }
  if (!pick) return null;

  const bestSeg = pick.seg;
  const bestX = pick.x;
  const bestY = pick.y;
  const dAnchor = pick.d;
  if (Number.isFinite(maxDistance) && maxDistance > 0 && dAnchor > maxDistance){
    return null;
  }

  const start = expectDefined(segments[bestSeg]);
  const maxLen = Math.max(0.15, Number.isFinite(maxDistance) ? maxDistance : 4.0);

  /**
   * @param {number} nodeIdx
   * @param {number} prevIdx
   * @param {number} fromX
   * @param {number} fromY
   * @returns {number}
   */
  const pickNextNode = (nodeIdx, prevIdx, fromX, fromY) => {
    const list = neighbors[nodeIdx];
    if (!list || !list.length) return -1;
    const node = expectDefined(nodes[nodeIdx]);
    const inDx = node.x - fromX;
    const inDy = node.y - fromY;
    const inLen = Math.hypot(inDx, inDy);
    let best = -1;
    let bestScore = -Infinity;
    for (const e of list){
      if (e.to === prevIdx) continue;
      if (!segAllowed[e.seg]) continue;
      const n = expectDefined(nodes[e.to]);
      const outDx = n.x - node.x;
      const outDy = n.y - node.y;
      const outLen = Math.hypot(outDx, outDy);
      if (outLen < 1e-8) continue;
      let score = 0;
      if (inLen > 1e-8){
        score = (inDx / inLen) * (outDx / outLen) + (inDy / inLen) * (outDy / outLen);
      }
      if (score > bestScore){
        bestScore = score;
        best = e.to;
      }
    }
    return best;
  };

  /**
   * @param {number} firstNode
   * @param {number} prevNode
   * @param {number} limit
   * @returns {Array<Point>}
   */
  const walk = (firstNode, prevNode, limit) => {
    /** @type {Array<Point>} */
    const out = [{ x: bestX, y: bestY }];
    let remaining = Math.max(0, limit);
    let fromX = bestX;
    let fromY = bestY;
    let nodeIdx = firstNode;
    let prevIdx = prevNode;

    while (remaining > 1e-6){
      const node = expectDefined(nodes[nodeIdx]);
      const dx = node.x - fromX;
      const dy = node.y - fromY;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-8){
        if (dist > remaining){
          const t = remaining / dist;
          out.push({ x: fromX + dx * t, y: fromY + dy * t });
          break;
        }
        out.push({ x: node.x, y: node.y });
        remaining -= dist;
      }
      const next = pickNextNode(nodeIdx, prevIdx, fromX, fromY);
      if (next < 0) break;
      prevIdx = nodeIdx;
      fromX = node.x;
      fromY = node.y;
      nodeIdx = next;
    }
    return out;
  };

  const walkA = walk(start.a, start.b, maxLen);
  const walkB = walk(start.b, start.a, maxLen);
  const pathRaw = walkA.slice().reverse().concat(walkB.slice(1));
  if (pathRaw.length < 2) return null;

  /** @type {Array<Point>} */
  const path = [];
  /**
   * @param {Point} p
   * @returns {void}
   */
  const pushUnique = (p) => {
    const last = path.length ? path[path.length - 1] : null;
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-4){
      path.push({ x: p.x, y: p.y });
    }
  };
  for (const p of pathRaw) pushUnique(p);
  if (path.length < 2) return null;

  const idx = closestPathIndex(path, x, y);
  const indexClosest = (idx !== null) ? idx : Math.max(0, Math.min(path.length - 1, path.length * 0.5));
  return { path, indexClosest };
}

/**
 * Continuous closest-point path index constrained to a max distance.
 * @param {Array<Point>} path
 * @param {number} distMax
 * @param {number} x
 * @param {number} y
 * @param {number|null} [rHint]
 * @param {number} [rTol]
 * @returns {number|null}
 */
export function indexPathFromPos(path, distMax, x, y, rHint = null, rTol = Infinity){
  if (!path || path.length < 2) return null;
  const distMaxSqr = distMax * distMax;
  let distClosestSqr = Infinity;
  let indexPath = null;
  for (let i = 1; i < path.length; ++i){
    const pos0 = expectDefined(path[i - 1]);
    const pos1 = expectDefined(path[i]);
    if (rHint !== null && Number.isFinite(rHint) && Number.isFinite(rTol)){
      const r0 = Math.hypot(pos0.x, pos0.y);
      const r1 = Math.hypot(pos1.x, pos1.y);
      const rMin = Math.min(r0, r1) - rTol;
      const rMax = Math.max(r0, r1) + rTol;
      if (rHint < rMin || rHint > rMax) continue;
    }
    const dSegX = pos1.x - pos0.x;
    const dSegY = pos1.y - pos0.y;
    const dSeg2 = dSegX * dSegX + dSegY * dSegY;
    if (dSeg2 < 1e-10) continue;
    const dPosX = x - pos0.x;
    const dPosY = y - pos0.y;
    let u = (dSegX * dPosX + dSegY * dPosY) / dSeg2;
    u = Math.max(0, Math.min(1, u));
    const dPosClosestX = dSegX * u - dPosX;
    const dPosClosestY = dSegY * u - dPosY;
    const distSqr = dPosClosestX * dPosClosestX + dPosClosestY * dPosClosestY;
    if (distSqr > distMaxSqr) continue;
    if (distSqr < distClosestSqr){
      distClosestSqr = distSqr;
      indexPath = (i - 1) + u;
    }
  }
  return indexPath;
}

/**
 * Interpolate world position from a continuous path index.
 * @param {Array<Point>} path
 * @param {number} indexPath
 * @returns {Point}
 */
export function posFromPathIndex(path, indexPath){
  if (!path || path.length === 0){
    return { x: 0, y: 0 };
  }
  if (path.length === 1){
    const only = expectDefined(path[0]);
    return { x: only.x, y: only.y };
  }
  indexPath = Math.max(0, Math.min(path.length - 1, indexPath));
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;
  if (iSeg === path.length - 1){
    iSeg -= 1;
    uSeg += 1;
  }
  const start = expectDefined(path[iSeg]);
  const end = expectDefined(path[iSeg + 1]);
  const x0 = start.x;
  const y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;
  return {
    x: x0 + (x1 - x0) * uSeg,
    y: y0 + (y1 - y0) * uSeg,
  };
}

/**
 * Move forward (increasing index) along a path by distance up to indexPathMax.
 * @param {Array<Point>} path
 * @param {number} indexPath
 * @param {number} distRemaining
 * @param {number} indexPathMax
 * @returns {number}
 */
export function moveAlongPathPositive(path, indexPath, distRemaining, indexPathMax){
  if (!(distRemaining > 0)) return indexPath;
  if (!(indexPath < indexPathMax)) return indexPathMax;
  const iSegMax = Math.floor(indexPathMax);
  const uSegMax = indexPathMax - iSegMax;
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;

  while (iSeg >= 0 && iSeg + 1 < path.length){
    const a = expectDefined(path[iSeg]);
    const b = expectDefined(path[iSeg + 1]);
    const dSegX = b.x - a.x;
    const dSegY = b.y - a.y;
    const distSeg = Math.hypot(dSegX, dSegY);
    if (distSeg < 1e-10){
      indexPath = iSeg + 1;
      ++iSeg;
      uSeg = 0;
      continue;
    }
    const distSegStop = (iSeg < iSegMax) ? Infinity : Math.max(0, (uSegMax - uSeg) * distSeg);
    if (distRemaining >= distSegStop){
      indexPath = indexPathMax;
      break;
    }
    const distSegRemaining = (1 - uSeg) * distSeg;
    if (distRemaining < distSegRemaining){
      indexPath += distRemaining / distSeg;
      break;
    }
    distRemaining -= distSegRemaining;
    ++iSeg;
    uSeg = 0;
    indexPath = iSeg;
  }

  return indexPath;
}

/**
 * Move backward (decreasing index) along a path by distance down to indexPathMin.
 * @param {Array<Point>} path
 * @param {number} indexPath
 * @param {number} distRemaining
 * @param {number} indexPathMin
 * @returns {number}
 */
export function moveAlongPathNegative(path, indexPath, distRemaining, indexPathMin){
  if (!(distRemaining > 0)) return indexPath;
  if (!(indexPath > indexPathMin)) return indexPathMin;
  const iSegMin = Math.floor(indexPathMin);
  const uSegMin = indexPathMin - iSegMin;
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;
  if (iSeg >= path.length - 1){
    // If starting exactly at the last path point, step from the final segment.
    iSeg = path.length - 2;
    uSeg = 1;
    indexPath = path.length - 1;
  }

  while (iSeg >= 0 && iSeg + 1 < path.length){
    const a = expectDefined(path[iSeg]);
    const b = expectDefined(path[iSeg + 1]);
    const dSegX = b.x - a.x;
    const dSegY = b.y - a.y;
    const distSeg = Math.hypot(dSegX, dSegY);
    if (distSeg < 1e-10){
      indexPath = iSeg;
      --iSeg;
      uSeg = 1;
      continue;
    }
    const distSegStop = (iSeg > iSegMin) ? Infinity : Math.max(0, (uSeg - uSegMin) * distSeg);
    if (distRemaining >= distSegStop){
      indexPath = indexPathMin;
      break;
    }
    const distSegRemaining = uSeg * distSeg;
    if (distRemaining < distSegRemaining){
      indexPath -= distRemaining / distSeg;
      break;
    }
    distRemaining -= distSegRemaining;
    indexPath = iSeg;
    --iSeg;
    uSeg = 1;
  }

  return indexPath;
}

/**
 * Extract a contiguous polyline segment between two path indexes.
 * @param {Array<Point>} path
 * @param {number} indexA
 * @param {number} indexB
 * @returns {Array<Point>|null}
 */
export function extractPathSegment(path, indexA, indexB){
  if (!path || path.length < 2) return null;
  if (!Number.isFinite(indexA) || !Number.isFinite(indexB)) return null;
  const lo = Math.min(indexA, indexB);
  const hi = Math.max(indexA, indexB);
  const forward = indexA <= indexB;
  /** @type {Array<Point>} */
  const out = [];
  /**
   * @param {Point} p
   * @returns {void}
   */
  const pushUnique = (p) => {
    const last = out.length ? out[out.length - 1] : null;
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-4){
      out.push({ x: p.x, y: p.y });
    }
  };
  pushUnique(posFromPathIndex(path, lo));
  const iMin = Math.max(0, Math.ceil(lo));
  const iMax = Math.min(path.length - 1, Math.floor(hi));
  for (let i = iMin; i <= iMax; i++){
    pushUnique(expectDefined(path[i]));
  }
  pushUnique(posFromPathIndex(path, hi));
  if (!forward) out.reverse();
  return out.length >= 2 ? out : null;
}

/**
 * Find the ship's target index on a guide path, preferring geometric projection.
 * @param {{path:Array<Point>,indexClosest:number}|null} guidePath
 * @param {number} shipX
 * @param {number} shipY
 * @returns {number|null}
 */
export function findGuidePathTargetIndex(guidePath, shipX, shipY){
  if (!guidePath || !guidePath.path || guidePath.path.length < 2){
    return null;
  }
  const projected = indexPathFromPos(guidePath.path, Number.POSITIVE_INFINITY, shipX, shipY);
  if (projected !== null) return projected;
  if (Number.isFinite(guidePath.indexClosest)){
    return Math.max(0, Math.min(guidePath.path.length - 1, guidePath.indexClosest));
  }
  return null;
}

/**
 * Miner attach-to-guide checks with radial-band preference.
 * @param {Array<Point>} path
 * @param {number} attachDist
 * @param {number} minerX
 * @param {number} minerY
 * @param {number|null} [rHint]
 * @param {{radialTolBase?:number,sameRingIdx?:number|null,nearbyRingIdx?:number|null,plainIdx?:number|null,chosenStage?:string,chosenIdx?:number|null,chosenDist?:number,chosenR?:number,nearestIdx?:number|null,nearestDist?:number,nearestR?:number}|null} [debug]
 * @returns {number|null}
 */
export function findMinerGuideAttachIndex(path, attachDist, minerX, minerY, rHint = null, debug = null){
  const radialTolBase = Math.max(0.12, Math.min(0.28, attachDist * 0.28));
  let sameRingIdx = null;
  let nearbyRingIdx = null;
  let plainIdx = null;
  if (debug){
    debug.radialTolBase = radialTolBase;
    debug.sameRingIdx = sameRingIdx;
    debug.nearbyRingIdx = nearbyRingIdx;
    debug.plainIdx = plainIdx;
    debug.chosenStage = "none";
    debug.chosenIdx = null;
    debug.chosenDist = Number.POSITIVE_INFINITY;
    debug.chosenR = Number.POSITIVE_INFINITY;
    debug.nearestIdx = null;
    debug.nearestDist = Number.POSITIVE_INFINITY;
    debug.nearestR = Number.POSITIVE_INFINITY;
  }
  if (rHint !== null && Number.isFinite(rHint)){
    sameRingIdx = indexPathFromPos(path, attachDist, minerX, minerY, rHint, radialTolBase);
    if (debug) debug.sameRingIdx = sameRingIdx;
    nearbyRingIdx = indexPathFromPos(path, attachDist, minerX, minerY, rHint, radialTolBase * 2);
    if (debug) debug.nearbyRingIdx = nearbyRingIdx;
  }
  plainIdx = indexPathFromPos(path, attachDist, minerX, minerY);
  if (debug) debug.plainIdx = plainIdx;

  let chosenIdx = null;
  let chosenStage = "none";
  if (sameRingIdx !== null){
    chosenIdx = sameRingIdx;
    chosenStage = "same_ring";
  } else if (nearbyRingIdx !== null){
    chosenIdx = nearbyRingIdx;
    chosenStage = "nearby_ring";
  } else if (plainIdx !== null){
    chosenIdx = plainIdx;
    chosenStage = "plain";
  }

  if (debug){
    const nearestIdx = indexPathFromPos(path, Number.POSITIVE_INFINITY, minerX, minerY);
    debug.nearestIdx = nearestIdx;
    if (nearestIdx !== null){
      const nearestPos = posFromPathIndex(path, nearestIdx);
      debug.nearestDist = Math.hypot(nearestPos.x - minerX, nearestPos.y - minerY);
      debug.nearestR = Math.hypot(nearestPos.x, nearestPos.y);
    }
    if (chosenIdx !== null){
      const chosenPos = posFromPathIndex(path, chosenIdx);
      debug.chosenDist = Math.hypot(chosenPos.x - minerX, chosenPos.y - minerY);
      debug.chosenR = Math.hypot(chosenPos.x, chosenPos.y);
    }
    debug.chosenIdx = chosenIdx;
    debug.chosenStage = chosenStage;
  }

  return chosenIdx;
}


