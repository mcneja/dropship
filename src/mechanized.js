// @ts-check
/** @typedef {import("./game.js").Game} Game */

import { GAME } from "./config.js";
import * as collisionDropship from "./collision_dropship.js";
import { findPathAStar } from "./navigation.js";
import * as levels from "./levels.js";
import * as missions from "./missions.js";
import * as dropship from "./dropship.js";

/**
 * @param {Game} game
 * @param {{x:number,y:number,nx?:number,ny?:number}} p
 * @returns {{nx:number,ny:number,tx:number,ty:number}}
 */
export function propBasis(game, p){
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
 * @param {Game} game
 * @returns {number}
 */
export function mechanizedLarvaSpawnCount(game){
  if (game.level <= 8){
    const seed = (game.planet && typeof game.planet.getSeed === "function")
      ? (game.planet.getSeed() | 0)
      : (game.progressionSeed | 0);
    return 2 + (Math.abs(seed) % 2);
  }
  return Math.max(2, Math.min(7, 2 + Math.floor(Math.max(0, (game.level | 0) - 1) / 3)));
}

/**
 * @param {Game} game
 * @returns {import("./types.d.js").EnemyType}
 */
export function pickMechanizedLarvaHatchType(game){
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  /** @type {import("./types.d.js").EnemyType[]} */
  const allow = (cfg && cfg.enemyAllow) ? cfg.enemyAllow : [];
  const pool = allow.filter((t) => t === "hunter" || t === "ranger" || t === "crawler");
  return pool.length
    ? /** @type {import("./types.d.js").EnemyType} */ (pool[Math.floor(Math.random() * pool.length)])
    : "hunter";
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").EnemyType} type
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function spawnHostileAt(game, type, x, y){
  if (!game.enemies || !game.enemies.enemies) return false;
  let px = x;
  let py = y;
  if (game.collision.airValueAtWorld(px, py) <= 0.5){
    const nudge = game.planet.nudgeOutOfTerrain(px, py, 0.9, 0.08, 0.18);
    if (!nudge.ok) return false;
    px = nudge.x;
    py = nudge.y;
    if (game.collision.airValueAtWorld(px, py) <= 0.5) return false;
  }
  const shotCooldown = Math.random();
  if (type === "hunter"){
    game.enemies.enemies.push({ type, x: px, y: py, vx: 0, vy: 0, hp: 3, shotCooldown, modeCooldown: 0, iNodeGoal: null });
  } else if (type === "ranger"){
    game.enemies.enemies.push({ type, x: px, y: py, vx: 0, vy: 0, hp: 2, shotCooldown, modeCooldown: 0, iNodeGoal: null });
  } else {
    const ang = Math.random() * Math.PI * 2;
    const speed = Math.min(3, game.level * 0.25 + 0.5);
    game.enemies.enemies.push({ type: "crawler", x: px, y: py, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, hp: 1, shotCooldown: 0, modeCooldown: 0, iNodeGoal: null });
  }
  if (game.objective && game.objective.type === "clear"){
    game.missionState.clearObjectiveTotal = Math.max(game.missionState.clearObjectiveTotal || 0, missions.remainingClearTargets(game)) + 1;
    game.objective.target = game.missionState.clearObjectiveTotal;
  }
  game.entityExplosions.push({ x: px, y: py, life: 0.35, radius: 0.45 });
  return true;
}

/**
 * @param {Game} game
 * @param {number} startNode
 * @param {Set<number>} usedTargets
 * @returns {{path:number[],targetNode:number}|null}
 */
export function findMechanizedLarvaEscapePath(game, startNode, usedTargets){
  const graph = game.planet && game.planet.getRadialGraph ? game.planet.getRadialGraph(false) : null;
  const passable = game.planet && game.planet.getAirNodesBitmap ? game.planet.getAirNodesBitmap(false) : null;
  if (!graph || !graph.nodes || !graph.neighbors || !passable || startNode < 0 || startNode >= graph.nodes.length || !passable[startNode]){
    return null;
  }
  const start = graph.nodes[startNode];
  if (!start) return null;
  const hops = new Int16Array(graph.nodes.length);
  hops.fill(-1);
  const queue = [startNode];
  hops[startNode] = 0;
  for (let head = 0; head < queue.length; head++){
    const idx = /** @type {number} */ (queue[head]);
    const nextHop = /** @type {number} */ (hops[idx]) + 1;
    const neigh = graph.neighbors[idx] || [];
    for (const edge of neigh){
      const next = edge.to;
      if (!/** @type {number} */ (passable[next]) || /** @type {number} */ (hops[next]) >= 0) continue;
      hops[next] = nextHop;
      queue.push(next);
    }
  }
  /** @type {Array<{idx:number,hops:number,r:number,d2:number}>} */
  const preferred = [];
  /** @type {Array<{idx:number,hops:number,r:number,d2:number}>} */
  const fallback = [];
  for (let i = 0; i < hops.length; i++){
    const h = /** @type {number} */ (hops[i]);
    if (h < 0 || i === startNode || usedTargets.has(i)) continue;
    const node = graph.nodes[i];
    if (!node) continue;
    const dx = node.x - start.x;
    const dy = node.y - start.y;
    const d2 = dx * dx + dy * dy;
    const info = { idx: i, hops: h, r: Math.hypot(node.x, node.y), d2 };
    fallback.push(info);
    if (h >= 10 && h <= 18){
      preferred.push(info);
    }
  }
  /**
   * @param {{idx:number,hops:number,r:number,d2:number}} a
   * @param {{idx:number,hops:number,r:number,d2:number}} b
   * @returns {number}
   */
  const rank = (a, b) => {
    if (b.r !== a.r) return b.r - a.r;
    if (b.hops !== a.hops) return b.hops - a.hops;
    return b.d2 - a.d2;
  };
  preferred.sort(rank);
  fallback.sort(rank);
  const pool = preferred.length ? preferred : fallback;
  for (const candidate of pool){
    const path = findPathAStar(graph, startNode, candidate.idx, passable);
    if (!path || path.length < 2) continue;
    return { path, targetNode: candidate.idx };
  }
  return null;
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").DestroyedTerrainNode[]} destroyedNodes
 * @returns {void}
 */
export function spawnMechanizedTerrainLarvae(game, destroyedNodes){
  if (!levels.isMechanizedLevel(game) || !destroyedNodes || !destroyedNodes.length) return;
  const graph = game.planet && game.planet.getRadialGraph ? game.planet.getRadialGraph(false) : null;
  if (!graph || !graph.nodes || !graph.nodes.length) return;
  const usedTargets = new Set();
  const spawnCount = mechanizedLarvaSpawnCount(game);
  for (let i = 0; i < spawnCount; i++){
    const anchor = destroyedNodes[i % destroyedNodes.length];
    if (!anchor) continue;
    const startNode = game.planet.nearestRadialNodeInAir(anchor.x, anchor.y);
    if (startNode < 0 || startNode >= graph.nodes.length) continue;
    const plan = findMechanizedLarvaEscapePath(game, startNode, usedTargets);
    if (!plan) continue;
    const node = graph.nodes[startNode];
    if (!node) continue;
    usedTargets.add(plan.targetNode);
    const size = 0.10 + Math.random() * 0.05;
    const speed = 1.65 + Math.min(1.0, game.level * 0.035) + Math.random() * 0.25;
    const dirX = anchor.x - node.x;
    const dirY = anchor.y - node.y;
    const dirLen = Math.hypot(dirX, dirY) || 1;
    game.mechanizedLarvae.push({
      x: node.x + (dirX / dirLen) * 0.04,
      y: node.y + (dirY / dirLen) * 0.04,
      vx: 0,
      vy: 0,
      speed,
      size,
      phase: Math.random() * Math.PI * 2,
      t: 0,
      path: plan.path,
      pathIndex: 1,
      hatchType: pickMechanizedLarvaHatchType(game),
    });
  }
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function updateMechanizedLarvae(game, dt){
  if (!game.mechanizedLarvae.length) return;
  const graph = game.planet && game.planet.getRadialGraph ? game.planet.getRadialGraph(false) : null;
  if (!graph || !graph.nodes || !graph.nodes.length){
    game.mechanizedLarvae.length = 0;
    return;
  }
  for (let i = game.mechanizedLarvae.length - 1; i >= 0; i--){
    const larva = /** @type {import("./types.d.js").MechanizedLarva} */ (game.mechanizedLarvae[i]);
    larva.t += dt;
    const path = larva.path || [];
    if (!path.length || larva.pathIndex >= path.length){
      spawnHostileAt(game, larva.hatchType, larva.x, larva.y);
      game.mechanizedLarvae.splice(i, 1);
      continue;
    }
    const nodeIdx = /** @type {number} */ (path[larva.pathIndex]);
    const target = (typeof nodeIdx === "number" && nodeIdx >= 0 && nodeIdx < graph.nodes.length)
      ? graph.nodes[nodeIdx]
      : null;
    if (!target){
      spawnHostileAt(game, larva.hatchType, larva.x, larva.y);
      game.mechanizedLarvae.splice(i, 1);
      continue;
    }
    const dx = target.x - larva.x;
    const dy = target.y - larva.y;
    const dist = Math.hypot(dx, dy);
    const step = larva.speed * dt;
    if (dist <= Math.max(0.02, step)){
      larva.x = target.x;
      larva.y = target.y;
      larva.vx = 0;
      larva.vy = 0;
      larva.pathIndex++;
      if (larva.pathIndex >= path.length){
        spawnHostileAt(game, larva.hatchType, larva.x, larva.y);
        game.mechanizedLarvae.splice(i, 1);
      }
      continue;
    }
    const inv = 1 / Math.max(1e-6, dist);
    larva.vx = dx * inv * larva.speed;
    larva.vy = dy * inv * larva.speed;
    larva.x += larva.vx * dt;
    larva.y += larva.vy * dt;
  }
}

/**
 * @param {Game} game
 * @param {any} p
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {{nx:number,ny:number,depth:number}|null}
 */
export function solidPropPenetration(game, p, x, y, radius){
  if (!p || p.dead) return null;
  if (p.type !== "gate" && p.type !== "factory" && p.type !== "tether") return null;
  const { nx, ny, tx, ty } = propBasis(game, p);
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
 * @param {Game} game
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} [radius]
 * @returns {any|null}
 */
export function firstSolidPropOnSegment(game, x0, y0, x1, y1, radius = 0.04){
  if (!levels.isMechanizedLevel(game)) return null;
  if (!game.planet || !game.planet.props || !game.planet.props.length) return null;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.hypot(dx, dy);
  const step = Math.max(0.05, radius * 0.9);
  const steps = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= steps; i++){
    const t = i / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    for (const p of game.planet.props){
      if (p.dead) continue;
      if (solidPropPenetration(game, p, x, y, radius)) return p;
    }
  }
  return null;
}

/**
 * @param {Game} game
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} [radius]
 * @returns {boolean}
 */
export function solidPropSegmentBlocked(game, x0, y0, x1, y1, radius = 0.04){
  return !!firstSolidPropOnSegment(game, x0, y0, x1, y1, radius);
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function resolveShipSolidPropCollisions(game){
  if (!levels.isMechanizedLevel(game)) return;
  if (!game.planet || !game.planet.props || !game.planet.props.length) return;
  if (game.ship.state === "crashed") return;
  const radius = collisionDropship.shipRadius(game);
  for (const p of game.planet.props){
    const hit = solidPropPenetration(game, p, game.ship.x, game.ship.y, radius);
    if (!hit) continue;
    if (p.type === "tether"){
      p.flashT = Math.max((typeof p.flashT === "number") ? p.flashT : 0, 0.18);
      game.entityExplosions.push({ x: game.ship.x, y: game.ship.y, life: 0.35, radius: Math.max(0.4, radius * 0.9) });
      dropship.triggerCrash(game, "explosion");
      return;
    }
    game.ship.x += hit.nx * (hit.depth + 0.01);
    game.ship.y += hit.ny * (hit.depth + 0.01);
    const vn = game.ship.vx * hit.nx + game.ship.vy * hit.ny;
    if (vn < 0){
      game.ship.vx -= hit.nx * vn;
      game.ship.vy -= hit.ny * vn;
    }
  }
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function resolveEnemySolidPropCollisions(game){
  if (!levels.isMechanizedLevel(game)) return;
  if (!game.planet || !game.planet.props || !game.planet.props.length) return;
  if (!game.enemies || !game.enemies.enemies || !game.enemies.enemies.length) return;
  const radius = 0.24 * GAME.ENEMY_SCALE;
  for (const e of game.enemies.enemies){
    for (const p of game.planet.props){
      const hit = solidPropPenetration(game, p, e.x, e.y, radius);
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


