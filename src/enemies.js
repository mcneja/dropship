// @ts-check

import { mulberry32 } from "./rng.js";
import { findPathAStar, lineOfSightAir } from "./navigation.js";
import { collidesAtOffsets, isAir } from "./collision_helpers.js";
import { GAME } from "./config.js";
import { spawnFragmentBurst, updateFragmentDebris } from "./fragment_fx.js";
import { PERF_FLAGS } from "./perf.js";
import * as planetSpawn from "./planet_spawn.js";
import * as terrainSupport from "./terrain_support.js";

/** @typedef {import("./types.d.js").Vec2} Vec2 */
/** @typedef {import("./types.d.js").EnemyType} EnemyType */
/** @typedef {import("./types.d.js").FragmentDestroyedBy} FragmentDestroyedBy */
/** @typedef {import("./types.d.js").Enemy} Enemy */
/** @typedef {import("./types.d.js").Ship} Ship */
/** @typedef {import("./types.d.js").Shot} Shot */
/** @typedef {import("./types.d.js").Explosion} Explosion */
/** @typedef {import("./types.d.js").Debris} Debris */
/** @typedef {{cooldown:number, shipNode:number, nodeGoal:number, navPadded:boolean}} PursuitState */
/** @typedef {{cause:"hp"|"detonate", destroyedBy:FragmentDestroyedBy}} EnemyDestroyInfo */
/** @typedef {(ax:number, ay:number, bx:number, by:number, radius?:number)=>boolean} SegmentBlocker */
/** @typedef {{mustAdvance:boolean, priority:number, minSeparation:number, canYield:boolean, formationRole:"melee"|"ranged"|"breaker"}} MovePolicy */
/** @typedef {{waitAge:number, holdNode:number|null, holdT:number, decisionCooldown:number}} EnemyMoveState */
/** @typedef {{graph:import("./navigation.js").RadialGraph, navMask:Uint8Array, occupiedCount:Int16Array, nodeOfEnemy:WeakMap<Enemy, number>, ship:Ship|null, corridorId:Int32Array, corridorCap:Int16Array, corridorOccupancy:Int16Array, rangerSectorCounts:Int16Array|null, rangerSectorOfEnemy:WeakMap<Enemy, number>}} MovementPlanner */

/**
 * @param {number} radius
 * @param {number} points
 * @returns {Array<[number, number]>}
 */
function circleOffsets(radius, points){
  /** @type {Array<[number, number]>} */
  const out = [];
  for (let i = 0; i < points; i++){
    const ang = (i / points) * Math.PI * 2;
    out.push([Math.cos(ang) * radius, Math.sin(ang) * radius]);
  }
  out.push([0, 0]);
  return out;
}

/**
 * @param {Enemy} e
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} collision
 * @param {number} dx
 * @param {number} dy
 * @param {number} speed
 * @param {number} dt
 * @param {Array<[number,number]>} [collider]
 * @returns {boolean}
 */
function tryMoveAir(e, collision, dx, dy, speed, dt, collider){
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return false;
  const nx = dx / len;
  const ny = dy / len;
  const step = speed * dt;
  const tx = e.x + nx * step;
  const ty = e.y + ny * step;
  if (!collider ? isAir(collision, tx, ty) : !collidesAtOffsets(collision, tx, ty, collider)){
    e.x = tx; e.y = ty;
    e.vx = nx * speed;
    e.vy = ny * speed;
    return true;
  }
  return false;
}

export class Enemies {
  /**
   * Build enemy state and behavior helpers.
   * @param {Object} deps
   * @param {import("./planet.js").Planet} deps.planet Planet (gravity/orbits).
   * @param {import("./types.d.js").CollisionQuery} deps.collision Collision query API.
   * @param {number} deps.total Initial enemy count to spawn.
   * @param {"uniform"|"random"|"clusters"} [deps.placement]
   * @param {number} [deps.orbitingTurretCount]
   * @param {number} deps.level Current level index.
   * @param {number} deps.levelSeed Base seed for this level.
   * @param {(enemy:Enemy)=>void} [deps.onEnemyShot]
   * @param {(enemy:Enemy, info?:EnemyDestroyInfo)=>void} [deps.onEnemyDestroyed]
   * @param {SegmentBlocker} [deps.solidPropSegmentBlocked]
   */
  constructor({
    planet,
    collision,
    total,
    level,
    levelSeed,
    placement,
    orbitingTurretCount,
    onEnemyShot = () => {},
    onEnemyDestroyed = () => {},
    solidPropSegmentBlocked = () => false,
  }){
    this.planet = planet;
    this.collision = collision;
    this.params = planet.getPlanetParams();
    this.onEnemyShot = onEnemyShot;
    this.onEnemyDestroyed = onEnemyDestroyed;
    this.solidPropSegmentBlocked = solidPropSegmentBlocked;

    /** @type {Enemy[]} */
    this.enemies = [];
    /** @type {Shot[]} */
    this.shots = [];
    /** @type {Explosion[]} */
    this.explosions = [];
    /** @type {Debris[]} */
    this.debris = [];
    /** @type {WeakMap<Enemy, PursuitState>} */
    this._pursuitState = new WeakMap();
    /** @type {WeakMap<Enemy, FragmentDestroyedBy>} */
    this._deathBy = new WeakMap();
    /** @type {WeakMap<Enemy, EnemyMoveState>} */
    this._moveState = new WeakMap();
    /** @type {WeakMap<Enemy, number>} */
    this._enemyId = new WeakMap();
    this._enemyIdNext = 1;
    /** @type {Uint8Array|null} */
    this._navMaskCacheBase = null;
    /** @type {Uint8Array|null} */
    this._navMaskCacheNavPadded = null;
    this._aiTick = 0;
    this._corridorAnalysisTick = -1;
    this._sectorAnalysisTick = -1;
    this._corridorGraph = null;
    /** @type {Int32Array|null} */
    this._corridorId = null;
    /** @type {Int16Array|null} */
    this._corridorCap = null;
    /** @type {Int16Array|null} */
    this._corridorOccupancy = null;
    /** @type {Int16Array|null} */
    this._rangerSectorCounts = null;
    /** @type {WeakMap<Enemy, number>|null} */
    this._rangerSectorOfEnemy = null;

    this._HUNTER_SPEED = 1.0;
    this._RANGER_SPEED = 1.6;
    this._HUNTER_SHOT_CD = 1.2;
    this._RANGER_SHOT_CD = 1.8;
    this._SHOT_SPEED = 6.5;
    this._HUNTER_SIGHT_RANGE = 8.0;
    this._HUNTER_HUNT_DURATION = 10.0
    this._TURRET_MAX_RANGE = 5.0;
    this._TURRET_SHOT_SPEED = 5.0;
    this._SHOT_LIFE = 3.0;
    this._GROUND_PURSUIT_MAX_ALT = 1.0;
    this._APPROACH_RANGE = 2.0;
    this._DETONATE_RANGE = 0.5;
    this._DETONATE_FUSE = 0.6;
    this._LOS_STEP = 0.2;
    this._CRAWLER_BLAST_LIFE = 0.75;
    this._CRAWLER_BLAST_RADIUS = 1.0;
    this._CRAWLER_BOUNCE_MIN_ALT = 0.0;
    this._CRAWLER_BOUNCE_MAX_ALT = 1.9;
    this._CRAWLER_OUTSIDE_BOUNCE_ENGAGE_ALT = 0.35;
    this._CRAWLER_BOUNCE_RADIAL_SPEED = 1.05;
    this._CRAWLER_BOUNCE_TANGENT_SPEED = 0.9;
    this._ENEMY_MIN_SEPARATION = Math.max(0.3, GAME.ENEMY_SCALE * 2.0);
    this._RANGER_FANOUT_BINS = 10;
    this._ANALYSIS_CORRIDOR_STRIDE = 10;
    this._ANALYSIS_SECTOR_STRIDE = 3;
    this._WAIT_DECISION_MIN = 0.09;
    this._WAIT_DECISION_MAX = 0.22;

    this._HUNTER_COLLIDER = circleOffsets(0.22, 6);
    this._RANGER_COLLIDER = circleOffsets(0.22, 6);
    this._CRAWLER_COLLIDER = circleOffsets(0.2, 6);

    this._placement = placement || "random";
    this.spawn(total, level, levelSeed, this._placement, orbitingTurretCount);
  }

  /**
   * Reset enemy and projectile lists.
   * @returns {void}
   */
  reset(){
    this.enemies.length = 0;
    this.shots.length = 0;
    this.explosions.length = 0;
    this.debris.length = 0;
    this._navMaskCacheBase = null;
    this._navMaskCacheNavPadded = null;
    this._pursuitState = new WeakMap();
    this._deathBy = new WeakMap();
    this._moveState = new WeakMap();
    this._enemyId = new WeakMap();
    this._enemyIdNext = 1;
    this._aiTick = 0;
    this._corridorAnalysisTick = -1;
    this._sectorAnalysisTick = -1;
    this._corridorGraph = null;
    this._corridorId = null;
    this._corridorCap = null;
    this._corridorOccupancy = null;
    this._rangerSectorCounts = null;
    this._rangerSectorOfEnemy = null;
  }

  /**
   * @param {Enemy|null|undefined} enemy
   * @param {FragmentDestroyedBy} destroyedBy
   * @returns {void}
   */
  markEnemyDestroyedBy(enemy, destroyedBy){
    if (!enemy) return;
    this._deathBy.set(enemy, destroyedBy);
  }

  /**
   * @param {boolean} [navPadded]
   * @returns {Uint8Array}
   */
  _enemyNavigationMask(navPadded = false){
    if (!navPadded && this._navMaskCacheBase) return this._navMaskCacheBase;
    if (navPadded && this._navMaskCacheNavPadded) return this._navMaskCacheNavPadded;
    const fallback = this.planet.getAirNodesBitmap
      ? this.planet.getAirNodesBitmap(navPadded)
      : this.planet.airNodesBitmap;
    const graph = this.planet.getRadialGraph
      ? this.planet.getRadialGraph(navPadded)
      : this.planet.radialGraph;
    const mask = this.planet.getEnemyNavigationMask
      ? this.planet.getEnemyNavigationMask(navPadded)
      : fallback;
    const resolved = (mask && graph && graph.nodes && mask.length === graph.nodes.length)
      ? mask
      : fallback;
    if (navPadded) this._navMaskCacheNavPadded = resolved;
    else this._navMaskCacheBase = resolved;
    return resolved;
  }

  /**
   * @param {boolean} [navPadded]
   * @returns {import("./navigation.js").RadialGraph}
   */
  _enemyNavigationGraph(navPadded = false){
    return this.planet.getRadialGraph
      ? this.planet.getRadialGraph(navPadded)
      : this.planet.radialGraph;
  }

  /**
   * @param {EnemyType} type
   * @returns {MovePolicy}
   */
  _enemyPolicyForType(type){
    if (type === "crawler"){
      return { mustAdvance: true, priority: 3, minSeparation: this._ENEMY_MIN_SEPARATION * 0.7, canYield: false, formationRole: "breaker" };
    }
    if (type === "hunter"){
      return { mustAdvance: false, priority: 2, minSeparation: this._ENEMY_MIN_SEPARATION, canYield: true, formationRole: "melee" };
    }
    if (type === "ranger"){
      return { mustAdvance: false, priority: 1, minSeparation: this._ENEMY_MIN_SEPARATION * 1.2, canYield: true, formationRole: "ranged" };
    }
    return { mustAdvance: false, priority: 0, minSeparation: this._ENEMY_MIN_SEPARATION, canYield: true, formationRole: "melee" };
  }

  /**
   * @param {Enemy} e
   * @returns {MovePolicy}
   */
  _enemyMovePolicy(e){
    return this._enemyPolicyForType(e.type);
  }

  /**
   * @param {Enemy} e
   * @returns {number}
   */
  _enemyStableId(e){
    const existing = this._enemyId.get(e);
    if (typeof existing === "number" && existing > 0) return existing;
    const next = this._enemyIdNext++;
    this._enemyId.set(e, next);
    return next;
  }

  /**
   * @param {Enemy} e
   * @returns {EnemyMoveState}
   */
  _enemyMoveState(e){
    const existing = this._moveState.get(e);
    if (existing) return existing;
    const init = { waitAge: 0, holdNode: null, holdT: 0, decisionCooldown: 0 };
    this._moveState.set(e, init);
    return init;
  }

  /**
   * @param {Enemy} e
   * @param {number} dt
   * @returns {void}
   */
  _advanceMoveStateTimers(e, dt){
    const state = this._enemyMoveState(e);
    if (state.holdT > 0){
      state.holdT = Math.max(0, state.holdT - Math.max(0, dt));
    }
    if (state.decisionCooldown > 0){
      state.decisionCooldown = Math.max(0, state.decisionCooldown - Math.max(0, dt));
    }
  }

  /**
   * @param {Enemy[]} movers
   * @returns {void}
   */
  _sortMoversByPolicy(movers){
    movers.sort((a, b) => {
      const pa = this._enemyMovePolicy(a);
      const pb = this._enemyMovePolicy(b);
      if (pa.mustAdvance !== pb.mustAdvance) return pa.mustAdvance ? -1 : 1;
      if (pa.priority !== pb.priority) return pb.priority - pa.priority;
      const sa = this._enemyMoveState(a);
      const sb = this._enemyMoveState(b);
      if (sa.waitAge !== sb.waitAge) return sb.waitAge - sa.waitAge;
      return this._enemyStableId(a) - this._enemyStableId(b);
    });
  }

  /**
   * @param {import("./navigation.js").RadialGraph} graph
   * @param {Uint8Array} navMask
   * @returns {void}
   */
  _rebuildCorridorAnalysis(graph, navMask){
    const nodeCount = graph.nodes.length;
    const corridorId = new Int32Array(nodeCount);
    corridorId.fill(-1);
    const corridorCap = new Int16Array(nodeCount);
    corridorCap.fill(0);
    let corridorCounter = 0;
    for (let i = 0; i < nodeCount; i++){
      if ((navMask[i] || 0) === 0 || (corridorId[i] ?? -1) >= 0) continue;
      const neigh = graph.neighbors[i] || [];
      if (neigh.length > 2) continue;
      const queue = [i];
      corridorId[i] = corridorCounter;
      /** @type {number[]} */
      const nodes = [i];
      for (let q = 0; q < queue.length; q++){
        const at = queue[q];
        if (typeof at !== "number") continue;
        const neighbors = graph.neighbors[at] || [];
        for (const edge of neighbors){
          const to = edge.to;
          if (to < 0 || to >= nodeCount || (navMask[to] || 0) === 0) continue;
          if ((corridorId[to] ?? -1) >= 0) continue;
          const toNeighbors = graph.neighbors[to] || [];
          if (toNeighbors.length > 2) continue;
          corridorId[to] = corridorCounter;
          queue.push(to);
          nodes.push(to);
        }
      }
      const cap = Math.max(2, Math.min(4, Math.floor(Math.sqrt(nodes.length)) + 1));
      for (const idx of nodes){
        corridorCap[idx] = cap;
      }
      corridorCounter++;
    }
    this._corridorId = corridorId;
    this._corridorCap = corridorCap;
    this._corridorGraph = graph;
    this._corridorAnalysisTick = this._aiTick;
  }

  /**
   * @param {Ship|null} ship
   * @param {Enemy[]} movers
   * @returns {MovementPlanner|null}
   */
  _buildMovementPlanner(ship, movers){
    const graph = this._enemyNavigationGraph(true);
    const navMask = this._enemyNavigationMask(true);
    if (!graph || !graph.nodes || !graph.neighbors || !navMask || navMask.length !== graph.nodes.length){
      return null;
    }
    this._aiTick++;
    if (
      this._corridorGraph !== graph
      || !this._corridorId
      || !this._corridorCap
      || (this._aiTick - this._corridorAnalysisTick) >= this._ANALYSIS_CORRIDOR_STRIDE
    ){
      this._rebuildCorridorAnalysis(graph, navMask);
    }
    const occupiedCount = new Int16Array(graph.nodes.length);
    /** @type {WeakMap<Enemy, number>} */
    const nodeOfEnemy = new WeakMap();
    for (const e of movers){
      const iNode = this.planet.nearestRadialNodeInAir(e.x, e.y, true);
      if (iNode < 0 || iNode >= occupiedCount.length || (navMask[iNode] || 0) === 0) continue;
      occupiedCount[iNode] = (occupiedCount[iNode] || 0) + 1;
      nodeOfEnemy.set(e, iNode);
    }
    /** @type {Int16Array} */
    const corridorOccupancy = new Int16Array(graph.nodes.length);
    if (this._corridorId){
      for (let i = 0; i < occupiedCount.length; i++){
        const occ = occupiedCount[i] || 0;
        if (occ <= 0) continue;
        const cid = this._corridorId[i] ?? -1;
        if (cid < 0 || cid >= corridorOccupancy.length) continue;
        corridorOccupancy[cid] = (corridorOccupancy[cid] || 0) + occ;
      }
    }

    if (!this._rangerSectorCounts || this._rangerSectorCounts.length !== this._RANGER_FANOUT_BINS){
      this._rangerSectorCounts = new Int16Array(this._RANGER_FANOUT_BINS);
    }
    if (!this._rangerSectorOfEnemy){
      this._rangerSectorOfEnemy = new WeakMap();
    }
    if ((this._aiTick - this._sectorAnalysisTick) >= this._ANALYSIS_SECTOR_STRIDE){
      this._rangerSectorCounts.fill(0);
      this._rangerSectorOfEnemy = new WeakMap();
      if (ship){
        for (const e of movers){
          if (e.type !== "ranger") continue;
          const bin = this._sectorBinForPoint(ship, e.x, e.y, this._RANGER_FANOUT_BINS);
          if (bin < 0) continue;
          this._rangerSectorCounts[bin] = (this._rangerSectorCounts[bin] || 0) + 1;
          this._rangerSectorOfEnemy.set(e, bin);
        }
      }
      this._sectorAnalysisTick = this._aiTick;
    }

    return {
      graph,
      navMask,
      occupiedCount,
      nodeOfEnemy,
      ship,
      corridorId: this._corridorId || new Int32Array(graph.nodes.length),
      corridorCap: this._corridorCap || new Int16Array(graph.nodes.length),
      corridorOccupancy,
      rangerSectorCounts: ship ? this._rangerSectorCounts : null,
      rangerSectorOfEnemy: this._rangerSectorOfEnemy || new WeakMap(),
    };
  }

  /**
   * @param {Ship} ship
   * @param {number} x
   * @param {number} y
   * @param {number} bins
   * @returns {number}
   */
  _sectorBinForPoint(ship, x, y, bins){
    if (bins <= 0) return -1;
    const ang = Math.atan2(y - ship.y, x - ship.x);
    const t = ((ang + Math.PI) / (Math.PI * 2));
    let bin = Math.floor(t * bins);
    if (bin < 0) bin = 0;
    if (bin >= bins) bin = bins - 1;
    return bin;
  }

  /**
   * @param {MovementPlanner|null} planner
   * @param {Enemy} e
   * @returns {number}
   */
  _plannerNodeOfEnemy(planner, e){
    if (!planner) return -1;
    const existing = planner.nodeOfEnemy.get(e);
    if (typeof existing === "number" && existing >= 0 && existing < planner.graph.nodes.length){
      return existing;
    }
    const iNode = this.planet.nearestRadialNodeInAir(e.x, e.y, true);
    if (iNode >= 0 && iNode < planner.graph.nodes.length){
      planner.nodeOfEnemy.set(e, iNode);
      return iNode;
    }
    return -1;
  }

  /**
   * @param {MovementPlanner|null} planner
   * @param {Enemy} e
   * @param {number} prevNode
   * @returns {void}
   */
  _plannerCommitEnemyPosition(planner, e, prevNode){
    if (!planner) return;
    const iNode = this.planet.nearestRadialNodeInAir(e.x, e.y, true);
    if (prevNode >= 0 && prevNode < planner.occupiedCount.length){
      planner.occupiedCount[prevNode] = Math.max(0, (planner.occupiedCount[prevNode] || 0) - 1);
    }
    if (iNode >= 0 && iNode < planner.occupiedCount.length){
      planner.occupiedCount[iNode] = (planner.occupiedCount[iNode] || 0) + 1;
      planner.nodeOfEnemy.set(e, iNode);
    }
    if (planner.ship && planner.rangerSectorCounts && e.type === "ranger"){
      const bins = planner.rangerSectorCounts.length;
      const oldBin = planner.rangerSectorOfEnemy.get(e);
      const newBin = this._sectorBinForPoint(planner.ship, e.x, e.y, bins);
      if (typeof oldBin === "number" && oldBin >= 0 && oldBin < bins){
        planner.rangerSectorCounts[oldBin] = Math.max(0, (planner.rangerSectorCounts[oldBin] || 0) - 1);
      }
      if (newBin >= 0 && newBin < bins){
        planner.rangerSectorCounts[newBin] = (planner.rangerSectorCounts[newBin] || 0) + 1;
        planner.rangerSectorOfEnemy.set(e, newBin);
      }
    }
  }

  /**
   * @param {MovementPlanner|null} planner
   * @param {Enemy} e
   * @returns {void}
   */
  _plannerRemoveEnemy(planner, e){
    if (!planner) return;
    const iNode = this._plannerNodeOfEnemy(planner, e);
    if (iNode >= 0 && iNode < planner.occupiedCount.length){
      planner.occupiedCount[iNode] = Math.max(0, (planner.occupiedCount[iNode] || 0) - 1);
    }
    if (planner.ship && planner.rangerSectorCounts && e.type === "ranger"){
      const bin = planner.rangerSectorOfEnemy.get(e);
      if (typeof bin === "number" && bin >= 0 && bin < planner.rangerSectorCounts.length){
        planner.rangerSectorCounts[bin] = Math.max(0, (planner.rangerSectorCounts[bin] || 0) - 1);
      }
    }
  }

  /**
   * @param {MovementPlanner} planner
   * @param {number} iNode
   * @param {Enemy} self
   * @param {number} minSeparation
   * @returns {boolean}
   */
  _plannerNodeCrowded(planner, iNode, self, minSeparation){
    if (iNode < 0 || iNode >= planner.graph.nodes.length) return true;
    const selfNode = this._plannerNodeOfEnemy(planner, self);
    const visited = new Uint8Array(planner.graph.nodes.length);
    /** @type {Array<{node:number,dist:number}>} */
    const queue = [{ node: iNode, dist: 0 }];
    for (let q = 0; q < queue.length; q++){
      const item = queue[q];
      if (!item) continue;
      const node = item.node;
      if (visited[node]) continue;
      visited[node] = 1;
      const occ = planner.occupiedCount[node] || 0;
      const selfAllowance = node === selfNode ? 1 : 0;
      if (occ > selfAllowance){
        return true;
      }
      if (item.dist >= minSeparation) continue;
      const neighbors = planner.graph.neighbors[node] || [];
      for (const edge of neighbors){
        const to = edge.to;
        if (to < 0 || to >= planner.graph.nodes.length) continue;
        if ((planner.navMask[to] || 0) === 0) continue;
        const nodeFrom = planner.graph.nodes[node];
        const nodeTo = planner.graph.nodes[to];
        if (!nodeFrom || !nodeTo) continue;
        const edgeCost = Number.isFinite(edge.cost) ? edge.cost : NaN;
        const step = Number.isFinite(edgeCost) ? edgeCost : Math.hypot(nodeTo.x - nodeFrom.x, nodeTo.y - nodeFrom.y);
        const dist = item.dist + step;
        if (dist > minSeparation + 1e-4) continue;
        queue.push({ node: to, dist });
      }
    }
    return false;
  }

  /**
   * @param {MovementPlanner} planner
   * @param {number} iNodeFrom
   * @param {number} iNodeTo
   * @returns {number}
   */
  _plannerCorridorPenalty(planner, iNodeFrom, iNodeTo){
    if (iNodeTo < 0 || iNodeTo >= planner.corridorId.length) return 0;
    const cidTo = planner.corridorId[iNodeTo] ?? -1;
    if (cidTo < 0 || cidTo >= planner.corridorOccupancy.length) return 0;
    const cap = planner.corridorCap[iNodeTo] || 0;
    if (cap <= 0) return 0;
    const occ = planner.corridorOccupancy[cidTo] || 0;
    const cidFrom = (iNodeFrom >= 0 && iNodeFrom < planner.corridorId.length) ? (planner.corridorId[iNodeFrom] ?? -1) : -1;
    const entering = cidFrom !== cidTo;
    if (!entering) return 0;
    if (occ < cap) return 0;
    return 5 + (occ - cap) * 2;
  }

  /**
   * @param {MovementPlanner} planner
   * @param {Enemy} e
   * @param {number} iNodeFrom
   * @param {number} iNodeDesired
   * @param {Ship|null} ship
   * @returns {number}
   */
  _chooseAdvanceNode(planner, e, iNodeFrom, iNodeDesired, ship){
    const policy = this._enemyMovePolicy(e);
    const state = this._enemyMoveState(e);
    const neighbors = planner.graph.neighbors[iNodeFrom] || [];
    /** @type {number[]} */
    const candidates = [];
    for (const edge of neighbors){
      const iNode = edge.to;
      if (iNode < 0 || iNode >= planner.navMask.length) continue;
      if (!planner.navMask[iNode]) continue;
      candidates.push(iNode);
    }
    if (iNodeDesired >= 0 && iNodeDesired < planner.navMask.length && planner.navMask[iNodeDesired] && !candidates.includes(iNodeDesired)){
      candidates.push(iNodeDesired);
    }
    if (!policy.mustAdvance){
      candidates.push(iNodeFrom);
    }
    if (candidates.length === 0){
      return iNodeFrom;
    }

    if (
      state.decisionCooldown > 0
      && state.holdNode !== null
      && candidates.includes(state.holdNode)
      && !this._plannerNodeCrowded(planner, state.holdNode, e, policy.minSeparation)
    ){
      return state.holdNode;
    }

    const desiredNode = (iNodeDesired >= 0 && iNodeDesired < planner.graph.nodes.length)
      ? planner.graph.nodes[iNodeDesired]
      : null;
    let bestNode = iNodeFrom;
    let bestScore = Infinity;
    for (const iNode of candidates){
      const node = planner.graph.nodes[iNode];
      if (!node) continue;
      let score = 0;
      if (desiredNode){
        score += Math.hypot(node.x - desiredNode.x, node.y - desiredNode.y) * 2.0;
      }
      if (iNode !== iNodeFrom){
        if (this._plannerNodeCrowded(planner, iNode, e, policy.minSeparation)){
          score += policy.mustAdvance ? 1.5 : 100;
        }
      }
      score += this._plannerCorridorPenalty(planner, iNodeFrom, iNode);
      const deg = (planner.graph.neighbors[iNode] || []).length;
      if (policy.formationRole === "ranged" && deg <= 2){
        score += 1.4;
      }
      if (ship && policy.formationRole === "ranged"){
        const dist = Math.hypot(node.x - ship.x, node.y - ship.y);
        const preferred = 3.4;
        score += Math.abs(dist - preferred) * 1.8;
        if (dist < 2.0) score += 4.0;
        if (planner.rangerSectorCounts){
          const bin = this._sectorBinForPoint(ship, node.x, node.y, planner.rangerSectorCounts.length);
          const myBin = planner.rangerSectorOfEnemy.get(e);
          let sectorOcc = planner.rangerSectorCounts[bin] || 0;
          if (typeof myBin === "number" && myBin === bin){
            sectorOcc = Math.max(0, sectorOcc - 1);
          }
          score += sectorOcc * 2.2;
        }
      }
      if (!policy.mustAdvance && iNode === iNodeFrom){
        score += 0.8;
      }
      if (state.holdNode !== null && iNode === state.holdNode && state.holdT > 0){
        score -= 0.45;
      }
      if (score < bestScore){
        bestScore = score;
        bestNode = iNode;
      }
    }
    state.holdNode = bestNode;
    state.holdT = 0.18;
    state.decisionCooldown = this._WAIT_DECISION_MIN + Math.random() * (this._WAIT_DECISION_MAX - this._WAIT_DECISION_MIN);
    return bestNode;
  }

  /**
   * @param {Enemy} e
   * @param {Ship|null} ship
   * @param {number} maxPathDist
   * @param {number} dt
   * @param {boolean} [navPadded]
   * @returns {{graph:import("./navigation.js").RadialGraph,nodeTarget:{x:number,y:number},nodeTargetIndex:number}|null}
   */
  _nextPursuitNode(e, ship, maxPathDist, dt, navPadded = false){
    if (!ship) return null;
    if (Math.hypot(e.x - ship.x, e.y - ship.y) > maxPathDist) return null;
    const graph = this._enemyNavigationGraph(navPadded);
    const navMask = this._enemyNavigationMask(navPadded);
    if (!graph || !graph.nodes || !graph.neighbors || !navMask || navMask.length !== graph.nodes.length){
      return null;
    }
    const nodeShip = this.planet.nearestRadialNodeInAir(ship.x, ship.y, navPadded);
    const nodeEnemy = this.planet.nearestRadialNodeInAir(e.x, e.y, navPadded);
    /** @type {PursuitState} */
    const pursuitState = this._pursuitState.get(e) || { cooldown: 0, shipNode: -1, nodeGoal: -1, navPadded: false };
    pursuitState.cooldown = Math.max(0, (pursuitState.cooldown || 0) - dt);
    if (
      pursuitState.cooldown > 0
      && pursuitState.shipNode === nodeShip
      && pursuitState.navPadded === navPadded
      && pursuitState.nodeGoal >= 0
      && pursuitState.nodeGoal < graph.nodes.length
      && pursuitState.nodeGoal !== nodeEnemy
      && navMask[pursuitState.nodeGoal]
    ){
      const nodeTarget = graph.nodes[pursuitState.nodeGoal];
      if (nodeTarget){
        this._pursuitState.set(e, pursuitState);
        return { graph, nodeTarget, nodeTargetIndex: pursuitState.nodeGoal };
      }
    }
    const pathNodes = findPathAStar(graph, nodeEnemy, nodeShip, navMask);
    if (!pathNodes || pathNodes.length < 2) return null;
    const startIdx = pathNodes[0];
    const nextIdx = pathNodes[1];
    if (startIdx === undefined || nextIdx === undefined) return null;
    const nodeStart = graph.nodes[startIdx];
    if (!nodeStart) return null;
    let pathLength = 0;
    let node0 = nodeStart;
    for (let i = 1; i < pathNodes.length; i++){
      const pathIdx = pathNodes[i];
      if (pathIdx === undefined) return null;
      const node1 = graph.nodes[pathIdx];
      if (!node1) return null;
      pathLength += Math.hypot(node1.x - node0.x, node1.y - node0.y);
      if (pathLength > maxPathDist) return null;
      node0 = node1;
    }
    const nodeTarget = graph.nodes[nextIdx];
    pursuitState.cooldown = 0.18;
    pursuitState.shipNode = nodeShip;
    pursuitState.nodeGoal = nextIdx;
    pursuitState.navPadded = navPadded;
    this._pursuitState.set(e, pursuitState);
    return nodeTarget ? { graph, nodeTarget, nodeTargetIndex: nextIdx } : null;
  }

  /**
   * @param {Enemy} e
   * @param {{x:number,y:number}} nodeTarget
   * @param {number} speed
   * @param {number} dt
   * @returns {boolean}
   */
  _moveTowardNode(e, nodeTarget, speed, dt){
    let dx = nodeTarget.x - e.x;
    let dy = nodeTarget.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 1e-6) return false;
    const maxMoveDist = speed * dt;
    if (dist > maxMoveDist) {
      const scale = maxMoveDist / dist;
      dx *= scale;
      dy *= scale;
    }
    e.x += dx;
    e.y += dy;
    e.vx = dx / dt;
    e.vy = dy / dt;
    return true;
  }

  /**
   * @param {Enemy} e
   * @param {{x:number,y:number}} nodeTarget
   * @param {number} [speedOverride]
   * @returns {boolean}
   */
  _steerTowardNode(e, nodeTarget, speedOverride){
    const dx = nodeTarget.x - e.x;
    const dy = nodeTarget.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= 1e-6) return false;
    const speedCandidate = (typeof speedOverride === "number" && Number.isFinite(speedOverride))
      ? speedOverride
      : Math.hypot(e.vx, e.vy);
    const speed = Math.max(0.001, speedCandidate);
    e.vx = (dx / dist) * speed;
    e.vy = (dy / dist) * speed;
    return true;
  }

  /**
   * @param {EnemyType} type
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  spawnDebug(type, x, y){
    const shotCooldown = Math.random();
    const modeCooldown = 0;
    if (type === "hunter"){
      this.enemies.push({ type, x, y, vx: 0, vy: 0, hp: 3, shotCooldown, modeCooldown, iNodeGoal: null });
    } else if (type === "ranger"){
      this.enemies.push({ type, x, y, vx: 0, vy: 0, hp: 2, shotCooldown, modeCooldown, iNodeGoal: null });
    } else if (type === "crawler"){
      const dir = Math.random() * Math.PI * 2;
      const speed = 1.5;
      this.enemies.push({ type, x, y, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, hp: 1, shotCooldown: 0, modeCooldown: 0, iNodeGoal: null });
    } else if (type === "turret"){
      this.enemies.push({ type, x, y, vx: 0, vy: 0, hp: 1, shotCooldown, modeCooldown, iNodeGoal: null });
    } else if (type === "orbitingTurret"){
      this.enemies.push({ type, x, y, vx: 0, vy: 0, hp: 1, shotCooldown, modeCooldown, iNodeGoal: null });
    }
  }

  /**
   * @param {number} total
   * @param {number} level
   * @param {number} levelSeed
   * @param {"uniform"|"random"|"clusters"} [placement]
   * @param {number} [orbitingTurretCount]
   * @returns {void}
   */
  spawn(total, level, levelSeed, placement, orbitingTurretCount){
    this.enemies.length = 0;
    this.shots.length = 0;
    this.explosions.length = 0;
    this.debris.length = 0;
    if (total <= 0) return;
    const planet = this.planet;
    const planetCfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
    const allowedSet = new Set((planetCfg && planetCfg.enemyAllow) ? planetCfg.enemyAllow : []);
    if (allowedSet.size === 0){
      allowedSet.add("hunter");
    }
    /** @type {EnemyType[]} */
    const fallbackOrder = ["hunter", "ranger", "crawler", "turret"];
    /** @type {EnemyType} */
    const fallbackType = fallbackOrder.find((t) => allowedSet.has(t)) || "hunter";
    const seed = levelSeed + level * 133;
    let numEnemiesRemaining = total;
    let hunters = Math.min(numEnemiesRemaining, Math.floor(total * 0.125));
    numEnemiesRemaining -= hunters;
    let rangers = Math.min(numEnemiesRemaining, Math.floor(total * 0.25));
    numEnemiesRemaining -= rangers;
    let crawlers = Math.min(numEnemiesRemaining, Math.floor(total * 0.25));
    numEnemiesRemaining -= crawlers;
    let turrets = numEnemiesRemaining;
    const cfgOrbiting = (planetCfg && typeof planetCfg.orbitingTurretCount === "number")
      ? Math.max(0, Math.round(planetCfg.orbitingTurretCount))
      : undefined;
    let orbitingTurrets = (typeof orbitingTurretCount === "number")
      ? Math.max(0, Math.round(orbitingTurretCount))
      : (typeof cfgOrbiting === "number" ? cfgOrbiting : 8);

    let remainder = 0;
    if (!allowedSet.has("hunter")){ remainder += hunters; hunters = 0; }
    if (!allowedSet.has("ranger")){ remainder += rangers; rangers = 0; }
    if (!allowedSet.has("crawler")){ remainder += crawlers; crawlers = 0; }
    if (!allowedSet.has("turret")){ remainder += turrets; turrets = 0; }
    if (remainder > 0){
      if (fallbackType === "hunter") hunters += remainder;
      else if (fallbackType === "ranger") rangers += remainder;
      else if (fallbackType === "crawler") crawlers += remainder;
      else turrets += remainder;
    }
    if (!allowedSet.has("orbitingTurret")) orbitingTurrets = 0;

    const shellR = planet.getSurfaceShellRadius();
    const rHunterRangerMax = Math.max(0.8, shellR - 0.5);
    const hunterPts = planetSpawn.sampleAirPoints(planet, hunters, seed + 1, rHunterRangerMax * 0.5, rHunterRangerMax, placement);
    const rangerPts = planetSpawn.sampleAirPoints(planet, rangers, seed + 2, rHunterRangerMax * 0.75, rHunterRangerMax, placement);
    const crawlerPts = planetSpawn.sampleAirPoints(planet, crawlers, seed + 3, 0.0, Math.max(0.7, shellR - 0.1), placement);
    const turretPts = planetSpawn.sampleTurretPoints(planet, turrets, seed + 4, placement, GAME.MINER_MIN_SEP, true);
    if (turrets > 0 && turretPts.length < turrets){
      const standable = terrainSupport.getStandablePoints(planet);
      console.error("[Level] turrets spawn insufficient standable points", {
        level,
        target: turrets,
        placed: turretPts.length,
        standable: standable.length,
      });
    }

    for (const [x, y] of hunterPts){
      this.enemies.push({ type: "hunter", x, y, vx: 0, vy: 0, hp: 3, shotCooldown: Math.random(), modeCooldown: 0, iNodeGoal: null });
    }
    for (const [x, y] of rangerPts){
      this.enemies.push({ type: "ranger", x, y, vx: 0, vy: 0, hp: 2, shotCooldown: Math.random(), modeCooldown: 0, iNodeGoal: null });
    }
    for (const [x, y] of crawlerPts){
      const dir = Math.random() * Math.PI * 2;
      const speed = Math.min(3, level * 0.25 + 0.5);
      const vx = Math.cos(dir) * speed;
      const vy = Math.sin(dir) * speed;
      this.enemies.push({ type: "crawler", x, y, vx: vx, vy: vy, hp: 1, shotCooldown: 0, modeCooldown: 0, iNodeGoal: null });
    }
    const barrenPerimeter = !!(planetCfg && planetCfg.flags && planetCfg.flags.barrenPerimeter);
    const turretBaseLift = GAME.ENEMY_SCALE * 0.75;
    for (const [x, y] of turretPts){
      let tx = x;
      let ty = y;
      const res = planet.nudgeOutOfTerrain(tx, ty, 0.8, 0.08, 0.18);
      if (res && res.ok){
        tx = res.x;
        ty = res.y;
      }
      const info = barrenPerimeter
        ? (() => {
          const up = planet._upDirAt(tx, ty);
          return up ? { nx: up.ux, ny: up.uy } : planet._upAlignedNormalAtWorld(tx, ty);
        })()
        : planet._upAlignedNormalAtWorld(tx, ty);
      if (info){
        tx += info.nx * turretBaseLift;
        ty += info.ny * turretBaseLift;
      } else {
        const len = Math.hypot(tx, ty) || 1;
        tx += (tx / len) * turretBaseLift;
        ty += (ty / len) * turretBaseLift;
      }
      this.enemies.push({ type: "turret", x: tx, y: ty, vx: 0, vy: 0, hp: 1, shotCooldown: Math.random(), modeCooldown: 0, iNodeGoal: null });
    }
    {
      const rand = mulberry32(seed + 5);
      const directionCCW = (rand() < 0.5);
      const perigee = this.params.RMAX + 2;
      const eccentricity = rand() * 0.15;
      let angle = rand() * Math.PI * 2;
      for (let i = 0; i < orbitingTurrets; ++i){
        const {x: x, y: y, vx: vx, vy: vy} = planet.orbitStateFromElements(perigee, eccentricity, angle, directionCCW);
        this.enemies.push({ type: "orbitingTurret", x, y, vx, vy, hp: 1, shotCooldown: Math.random(), modeCooldown: 0, iNodeGoal: null });
        angle += 0.1;
      }
    }
  }

  /**
   * @param {Ship} ship
   * @param {number} dt
   * @returns {void}
   */
  update(ship, dt){
    const { collision } = this;
    this._navMaskCacheBase = null;
    this._navMaskCacheNavPadded = null;
    updateFragmentDebris(this.debris, {
      gravityAt: (x, y) => collision.gravityAt(x, y),
      dragCoeff: this.params.DRAG,
      dt,
      terrainCrossing: GAME.FRAGMENT_PLANET_COLLISION
        ? (p1, p2) => this.planet.terrainCrossing(p1, p2)
        : null,
      terrainCollisionEnabled: GAME.FRAGMENT_PLANET_COLLISION,
      restitution: Number.isFinite(this.params.BOUNCE_RESTITUTION)
        ? Number(this.params.BOUNCE_RESTITUTION)
        : GAME.BOUNCE_RESTITUTION,
    });
    for (let i = this.shots.length - 1; i >= 0; i--){
      const s = this.shots[i];
      if (!s) continue;
      const prevX = s.x;
      const prevY = s.y;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      const blockedBySolidProp = !!(this.solidPropSegmentBlocked && this.solidPropSegmentBlocked(prevX, prevY, s.x, s.y, 0.04));
      if (s.life <= 0 || !isAir(collision, s.x, s.y) || blockedBySolidProp){
        this.shots.splice(i, 1);
      }
    }

    for (let i = this.explosions.length - 1; i >= 0; i--){
      const explosion = this.explosions[i];
      if (!explosion) continue;
      explosion.life -= dt;
      if (explosion.life <= 0) this.explosions.splice(i, 1);
    }

    if (PERF_FLAGS.disableEnemyAi){
      return;
    }

    const shipTarget = (ship && ship.state !== "crashed") ? ship : null;
    /** @type {Enemy[]} */
    const mobile = [];

    for (let i = this.enemies.length - 1; i >= 0; i--){
      const e = this.enemies[i];
      if (!e) continue;
      if (e.hitT && e.hitT > 0){
        e.hitT = Math.max(0, e.hitT - dt);
      }
      if (e.stunT && e.stunT > 0){
        e.stunT = Math.max(0, e.stunT - dt);
      }
      if (e.hp <= 0){
        const deathInfo = this._consumeEnemyDestroyInfo(e, "hp");
        this._notifyEnemyDestroyed(e, deathInfo);
        this._spawnEnemyDeathFragments(e, deathInfo.destroyedBy);
        if (e.type === "crawler"){
          this._spawnCrawlerBlastVisual(e, deathInfo.destroyedBy === "bomb" ? 2.0 : this._CRAWLER_BLAST_RADIUS);
        }
        this.enemies.splice(i, 1);
        continue;
      }
      if (e.stunT && e.stunT > 0){
        continue;
      }

      if (e.type === "hunter" || e.type === "ranger" || e.type === "crawler"){
        mobile.push(e);
      } else if (e.type === "turret"){
        if (!shipTarget) continue;
        this._updateTurret(e, shipTarget, dt);
      } else if (e.type === "orbitingTurret"){
        if (!shipTarget) continue;
        this._updateOrbitingTurret(e, shipTarget, dt);
      }
    }

    if (mobile.length === 0) return;
    const useCrowdPlanner = !PERF_FLAGS.disableEnemyCrowdPlanner;
    if (useCrowdPlanner){
      this._sortMoversByPolicy(mobile);
    }
    const planner = useCrowdPlanner ? this._buildMovementPlanner(shipTarget, mobile) : null;
    for (const e of mobile){
      if (useCrowdPlanner){
        this._advanceMoveStateTimers(e, dt);
      }
      if (e.type === "hunter"){
        this._updateHunter(e, shipTarget, dt, planner);
      } else if (e.type === "ranger"){
        this._updateRanger(e, shipTarget, dt, planner);
      } else if (e.type === "crawler"){
        if (!this._updateCrawler(e, shipTarget, dt, planner)) {
          const deathInfo = this._consumeEnemyDestroyInfo(e, "detonate", "detonate");
          this._notifyEnemyDestroyed(e, deathInfo);
          this._spawnEnemyDeathFragments(e, deathInfo.destroyedBy);
          this._plannerRemoveEnemy(planner, e);
          const idx = this.enemies.indexOf(e);
          if (idx >= 0) this.enemies.splice(idx, 1);
        }
      }
    }
  }

  /**
   * @param {Ship|null} ship
   * @param {number} maxAltFromSurface
   * @param {boolean} [useSurfaceShell]
   * @returns {boolean}
   */
  _shipWithinRadialBand(ship, maxAltFromSurface, useSurfaceShell = true){
    if (!ship) return false;
    const radius = Math.hypot(ship.x, ship.y);
    const surfaceRadius = useSurfaceShell && this.planet.getSurfaceShellRadius
      ? this.planet.getSurfaceShellRadius()
      : this.planet.planetRadius;
    const maxRadius = surfaceRadius + Math.max(0, maxAltFromSurface);
    return radius <= maxRadius;
  }

  /**
   * @param {Enemy} e 
   * @param {Ship|null} ship 
   * @param {number} dt 
   * @param {MovementPlanner|null} [planner]
   * @returns {void}
   */
  _updateHunter(e, ship, dt, planner = null) {
    const seesShip =
      ship &&
      Math.hypot(ship.x - e.x, ship.y - e.y) < this._HUNTER_SIGHT_RANGE &&
      this._hasLineOfSight(e.x, e.y, ship.x, ship.y);

    if (seesShip) {
      e.modeCooldown = Math.max(e.modeCooldown, this._HUNTER_HUNT_DURATION);
    } else {
      e.modeCooldown = Math.max(0, e.modeCooldown - dt);
    }

    if (e.modeCooldown <= 0 || !this._tryMoveHunter(e, ship, dt, planner)) {
      const prevNode = this._plannerNodeOfEnemy(planner, e);
      this._wander(e, this._HUNTER_SPEED, dt);
      this._plannerCommitEnemyPosition(planner, e, prevNode);
    }

    if (ship) this._updateTurret(e, ship, dt);
  }

  /**
   * @param {Enemy} e 
   * @param {Ship|null} ship 
   * @param {number} dt 
   * @param {MovementPlanner|null} [planner]
   * @returns {boolean}
   */
  _tryMoveHunter(e, ship, dt, planner = null) {
    if (!ship) return false;

    if (!this._shipWithinRadialBand(ship, this._GROUND_PURSUIT_MAX_ALT, false)) return false;

    const maxPathDist = 16;
    const pursuit = this._nextPursuitNode(e, ship, maxPathDist, dt, true);
    if (!pursuit) return false;
    if (!planner){
      return this._moveTowardNode(e, pursuit.nodeTarget, this._HUNTER_SPEED, dt);
    }
    const state = this._enemyMoveState(e);
    const iNodeFrom = this._plannerNodeOfEnemy(planner, e);
    if (iNodeFrom < 0){
      return this._moveTowardNode(e, pursuit.nodeTarget, this._HUNTER_SPEED, dt);
    }
    const iNodeChosen = this._chooseAdvanceNode(planner, e, iNodeFrom, pursuit.nodeTargetIndex, ship);
    if (iNodeChosen === iNodeFrom){
      state.waitAge += 1;
      const forcedMove = this._moveTowardNode(e, pursuit.nodeTarget, this._HUNTER_SPEED, dt);
      if (forcedMove){
        state.waitAge = Math.max(0, state.waitAge - 1);
        this._plannerCommitEnemyPosition(planner, e, iNodeFrom);
        return true;
      }
      e.vx *= 0.7;
      e.vy *= 0.7;
      return false;
    }
    const nodeTarget = planner.graph.nodes[iNodeChosen] || pursuit.nodeTarget;
    const moved = this._moveTowardNode(e, nodeTarget, this._HUNTER_SPEED, dt);
    if (moved){
      state.waitAge = Math.max(0, state.waitAge - 1);
      this._plannerCommitEnemyPosition(planner, e, iNodeFrom);
    } else {
      state.waitAge += 1;
    }
    return moved;
  }

  /**
   * @param {Enemy} e 
   * @param {Ship|null} ship 
   * @param {number} dt 
   * @param {MovementPlanner|null} [planner]
   * @returns {void}
   */
  _updateRanger(e, ship, dt, planner = null) {
    const shipInPursuitBand = this._shipWithinRadialBand(ship, this._GROUND_PURSUIT_MAX_ALT, false);
    const seesShip =
      ship &&
      Math.hypot(ship.x - e.x, ship.y - e.y) < this._TURRET_MAX_RANGE &&
      this._hasLineOfSight(e.x, e.y, ship.x, ship.y);

    let handledByTactical = false;
    if (!seesShip && ship && shipInPursuitBand){
      handledByTactical = this._tryMoveSeeker(e, ship, this._RANGER_SPEED, dt, planner);
    }
    if (seesShip) {
      const decay = Math.exp(-5 * dt);
      const vxPrev = e.vx;
      const vyPrev = e.vy;
      e.vx *= decay;
      e.vy *= decay;
      e.x += (vxPrev + e.vx) * (dt / 2);
      e.y += (vyPrev + e.vy) * (dt / 2);
      e.iNodeGoal = null;
    } else if (!handledByTactical) {
      const prevNode = this._plannerNodeOfEnemy(planner, e);
      this._wander(e, this._RANGER_SPEED, dt);
      this._plannerCommitEnemyPosition(planner, e, prevNode);
    } else {
      e.iNodeGoal = null;
    }

    if (ship) this._updateTurret(e, ship, dt);
  }

  /**
   * @param {Enemy} e 
   * @param {number} speed
   * @param {number} dt 
   * @returns {void}
   */
  _wander(e, speed, dt) {
    const graph = this._enemyNavigationGraph(false);
    const iNodeFrom = this.planet.nearestRadialNodeInAir(e.x, e.y, false);
    const navMask = this._enemyNavigationMask(false);
    if (!graph || !graph.nodes || !graph.neighbors || iNodeFrom < 0) return;
    if (
      e.iNodeGoal === null
      || iNodeFrom === e.iNodeGoal
      || !navMask[e.iNodeGoal]
    ) {
      e.iNodeGoal = this._iNodeWanderDirection(graph, navMask, iNodeFrom, e.x, e.y, e.vx, e.vy);
    }
    const nodeGoal = graph.nodes[e.iNodeGoal];
    if (!nodeGoal) return;
    this._moveTowardNode(e, nodeGoal, speed, dt);
  }

  /**
   * @param {Enemy} e
   * @param {Ship|null} ship
   * @param {number} speed
   * @param {number} dt
   * @param {MovementPlanner|null} [planner]
   * @returns {boolean}
   */
  _tryMoveSeeker(e, ship, speed, dt, planner = null){
    const pursuit = this._nextPursuitNode(e, ship, 16, dt, true);
    if (!pursuit) return false;
    if (!planner){
      return this._moveTowardNode(e, pursuit.nodeTarget, speed, dt);
    }
    const state = this._enemyMoveState(e);
    const iNodeFrom = this._plannerNodeOfEnemy(planner, e);
    if (iNodeFrom < 0){
      return this._moveTowardNode(e, pursuit.nodeTarget, speed, dt);
    }
    const iNodeChosen = this._chooseAdvanceNode(planner, e, iNodeFrom, pursuit.nodeTargetIndex, ship);
    if (iNodeChosen === iNodeFrom){
      state.waitAge += 1;
      e.vx *= 0.7;
      e.vy *= 0.7;
      return true;
    }
    const nodeTarget = planner.graph.nodes[iNodeChosen] || pursuit.nodeTarget;
    const moved = this._moveTowardNode(e, nodeTarget, speed, dt);
    if (moved){
      state.waitAge = Math.max(0, state.waitAge - 1);
      this._plannerCommitEnemyPosition(planner, e, iNodeFrom);
    } else {
      state.waitAge += 1;
    }
    return moved;
  }

  /**
   * @param {import("./navigation.js").RadialGraph} radialGraph
   * @param {Uint8Array} navMask
   * @param {number} iNodeFrom
   * @param {number} x
   * @param {number} y
   * @param {number} vx
   * @param {number} vy
   * @returns {number}
   */
  _iNodeWanderDirection(radialGraph, navMask, iNodeFrom, x, y, vx, vy) {
    /** @type {Array<number>} */
    const iNodeCandidates = [];
    const neighborList = radialGraph.neighbors[iNodeFrom] || [];
    for (const n of neighborList) {
      const iNode = n.to;
      if (navMask[iNode] === 0) continue;
      const node = radialGraph.nodes[iNode];
      if (!node) continue;
      const dx = node.x - x;
      const dy = node.y - y;
      const dot = dx*vx + dy*vy;
      if (dot <= 0) continue;
      iNodeCandidates.push(iNode);
    }
    if (iNodeCandidates.length === 0) {
      for (const n of neighborList) {
        const iNode = n.to;
        if (navMask[iNode] === 0) continue;
        iNodeCandidates.push(iNode);
      }
    }

    if (iNodeCandidates.length === 0) {
      return iNodeFrom;
    }

    const choice = iNodeCandidates[Math.floor(Math.random() * iNodeCandidates.length)];
    return (typeof choice === "number") ? choice : iNodeFrom;
  }

  /**
   * @param {Enemy} e 
   * @param {Ship|null} ship 
   * @param {number} dt 
   * @param {MovementPlanner|null} [planner]
   * @returns {boolean} keep alive?
   */
  _updateCrawler(e, ship, dt, planner = null) {
    this._moveCrawler(e, ship, dt, planner);

    if (!ship) return true;

    const dx = ship.x - e.x;
    const dy = ship.y - e.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= this._DETONATE_RANGE && this._shipWithinRadialBand(ship, this._CRAWLER_BOUNCE_MAX_ALT)){
      this._spawnCrawlerBlastVisual(e);
      return false;
    }
    return true;
  }

  /**
   * @param {Enemy|null|undefined} e
   * @param {"hp"|"detonate"} cause
   * @param {FragmentDestroyedBy} [fallbackDestroyedBy]
   * @returns {EnemyDestroyInfo}
   */
  _consumeEnemyDestroyInfo(e, cause, fallbackDestroyedBy = "unknown"){
    let destroyedBy = fallbackDestroyedBy;
    if (e){
      const marked = this._deathBy.get(e);
      if (marked) destroyedBy = marked;
      this._deathBy.delete(e);
    }
    return { cause, destroyedBy };
  }

  /**
   * @param {Enemy} e
   * @param {EnemyDestroyInfo} info
   * @returns {void}
   */
  _notifyEnemyDestroyed(e, info){
    if (this.onEnemyDestroyed){
      this.onEnemyDestroyed(e, info);
    }
  }

  /**
   * @param {Enemy} e
   * @param {FragmentDestroyedBy} destroyedBy
   * @returns {void}
   */
  _spawnEnemyDeathFragments(e, destroyedBy){
    spawnFragmentBurst(this.debris, e, e.type, destroyedBy);
  }

  /**
   * @param {Enemy} e
   * @param {number} [radius]
   * @returns {void}
   */
  _spawnCrawlerBlastVisual(e, radius = this._CRAWLER_BLAST_RADIUS){
    this.explosions.push({
      x: e.x,
      y: e.y,
      life: this._CRAWLER_BLAST_LIFE,
      maxLife: this._CRAWLER_BLAST_LIFE,
      owner: "crawler",
      radius,
    });
  }

  /**
   * @param {Enemy} e
   * @param {Ship|null} ship
   * @param {number} dt 
   * @param {MovementPlanner|null} [planner]
   */
  _moveCrawler(e, ship, dt, planner = null) {
    const prevNode = this._plannerNodeOfEnemy(planner, e);
    const prev = { x: e.x, y: e.y };
    const shipInBounceBand = this._shipWithinRadialBand(ship, this._CRAWLER_BOUNCE_MAX_ALT);
    const shouldLunge = !!(shipInBounceBand && ship && Math.hypot(ship.x - e.x, ship.y - e.y) < this._APPROACH_RANGE);
    const surfaceRadius = this.planet.getSurfaceShellRadius ? this.planet.getSurfaceShellRadius() : this.planet.planetRadius;
    const rEnemy = Math.hypot(e.x, e.y);
    const altitude = rEnemy - surfaceRadius;
    const crawlerOutside = altitude >= 0;
    const outsideBounceActive = altitude >= this._CRAWLER_OUTSIDE_BOUNCE_ENGAGE_ALT;
    let seekingShip = false;
    if (shouldLunge){
      seekingShip = this._steerCrawlerTowardShip(e, ship, dt, planner);
      this._approachPlayer(e, ship);
    } else if (outsideBounceActive){
      this._bounceCrawlerOutsidePlanet(e);
    } else if (shipInBounceBand){
      seekingShip = this._steerCrawlerTowardShip(e, ship, dt, planner);
      this._approachPlayer(e, ship);
    } else {
      // Keep existing momentum when ship is out of crawler pursuit band.
      seekingShip = false;
    }
    this._reflectVelocityBackTowardPlanet(e);
    const next = { x: e.x + e.vx * dt, y: e.y + e.vy * dt };
    this._reflectVelocityAwayFromTerrain(e, prev, next);
    if (!crawlerOutside){
      this._deflectCrawlerFromUnsafeNodes(e, dt, seekingShip);
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    this._plannerCommitEnemyPosition(planner, e, prevNode);
  }

  /**
   * @param {Enemy} e
   * @param {Ship|null} ship
   * @param {number} dt
   * @param {MovementPlanner|null} [planner]
   * @returns {boolean}
   */
  _steerCrawlerTowardShip(e, ship, dt, planner = null){
    if (!this._shipWithinRadialBand(ship, this._CRAWLER_BOUNCE_MAX_ALT)) return false;
    const pursuit = this._nextPursuitNode(e, ship, 16, dt, true);
    if (!pursuit) return false;
    if (planner){
      const iNodeFrom = this._plannerNodeOfEnemy(planner, e);
      if (iNodeFrom >= 0){
        const iNodeChosen = this._chooseAdvanceNode(planner, e, iNodeFrom, pursuit.nodeTargetIndex, ship);
        const nodeChosen = planner.graph.nodes[iNodeChosen];
        if (nodeChosen){
          const currentSpeed = Math.max(1.2, Math.hypot(e.vx, e.vy));
          return this._steerTowardNode(e, nodeChosen, currentSpeed);
        }
      }
    }
    const currentSpeed = Math.max(1.2, Math.hypot(e.vx, e.vy));
    return this._steerTowardNode(e, pursuit.nodeTarget, currentSpeed);
  }

  /**
   * @param {Enemy} e
   * @returns {void}
   */
  _bounceCrawlerOutsidePlanet(e){
    const rEnemy = Math.hypot(e.x, e.y);
    if (rEnemy <= 1e-6) return;
    const nx = e.x / rEnemy;
    const ny = e.y / rEnemy;
    const surfaceRadius = this.planet.getSurfaceShellRadius ? this.planet.getSurfaceShellRadius() : this.planet.planetRadius;
    const altitude = rEnemy - surfaceRadius;
    if (altitude < this._CRAWLER_BOUNCE_MAX_ALT) return;
    const stableId = this._enemyStableId(e);
    const tx = -ny;
    const ty = nx;
    const tangentNow = e.vx * tx + e.vy * ty;
    let tangentSign = (tangentNow >= 0) ? 1 : -1;
    if (Math.abs(tangentNow) < 0.05){
      tangentSign = (stableId % 2 === 0) ? 1 : -1;
    }
    const tangentSpeed = this._CRAWLER_BOUNCE_TANGENT_SPEED;
    const radialSpeed = -this._CRAWLER_BOUNCE_RADIAL_SPEED;
    e.vx = tx * tangentSpeed * tangentSign + nx * radialSpeed;
    e.vy = ty * tangentSpeed * tangentSign + ny * radialSpeed;
  }

  /**
   * @param {Enemy} e
   * @param {number} dt
   * @param {boolean} [navPadded]
   * @returns {void}
   */
  _deflectCrawlerFromUnsafeNodes(e, dt, navPadded = false){
    const navMask = this._enemyNavigationMask(navPadded);
    const graph = this._enemyNavigationGraph(navPadded);
    if (!graph || !graph.nodes || !graph.neighbors) return;
    const nextX = e.x + e.vx * dt;
    const nextY = e.y + e.vy * dt;
    const iNodeNext = this.planet.nearestRadialNodeInAir(nextX, nextY, navPadded);
    if (iNodeNext < 0 || iNodeNext >= navMask.length || navMask[iNodeNext]) return;
    const iNodeFrom = this.planet.nearestRadialNodeInAir(e.x, e.y, navPadded);
    if (iNodeFrom < 0 || iNodeFrom >= graph.neighbors.length) return;
    const neighborList = graph.neighbors[iNodeFrom];
    if (!neighborList) return;
    let bestDx = 0;
    let bestDy = 0;
    let bestScore = -Infinity;
    for (const edge of neighborList){
      const iNode = edge.to;
      if (iNode < 0 || iNode >= navMask.length || !navMask[iNode]) continue;
      const node = graph.nodes[iNode];
      if (!node) continue;
      const dx = node.x - e.x;
      const dy = node.y - e.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= 1e-6) continue;
      const score = (dx * e.vx + dy * e.vy) / dist;
      if (score > bestScore){
        bestScore = score;
        bestDx = dx / dist;
        bestDy = dy / dist;
      }
    }
    if (bestScore <= -Infinity) return;
    const speed = Math.max(0.001, Math.hypot(e.vx, e.vy));
    e.vx = bestDx * speed;
    e.vy = bestDy * speed;
  }

  /**
   * @param {Enemy} e 
   * @param {Ship|null} ship 
   * @returns {void}
   */
  _approachPlayer(e, ship) {
    if (!ship) return;
    const dx = ship.x - e.x;
    const dy = ship.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= this._APPROACH_RANGE) return;
    if (dist < 1e-4) return;
    const s = Math.hypot(e.vx, e.vy) / dist;
    e.vx = dx * s;
    e.vy = dy * s;
  }

  /**
   * @param {Enemy} e 
   * @returns {void}
   */
  _reflectVelocityBackTowardPlanet(e) {
    const surfaceRadius = this.planet.getSurfaceShellRadius ? this.planet.getSurfaceShellRadius() : this.planet.planetRadius;
    const rMax = surfaceRadius + this._CRAWLER_BOUNCE_MAX_ALT;

    const rEnemy = Math.hypot(e.x, e.y);
    if (rEnemy < rMax) return;

    const nx = e.x / rEnemy;
    const ny = e.y / rEnemy;

    const vNormal = e.vx * nx + e.vy * ny;
    if (vNormal <= 0) return;

    const impulse = -2 * vNormal;

    e.vx += impulse * nx;
    e.vy += impulse * ny;
  }

  /**
   * 
   * @param {Enemy} e 
   * @param {{x:number,y:number}} prev
   * @param {{x:number,y:number}} next
   * @returns {boolean}
   */
  _reflectVelocityAwayFromTerrain(e, prev, next) {
    const planet = this.planet;
    const crossing = planet.terrainCrossing(prev, next);
    if (!crossing) return false;
    const nx = crossing.nx;
    const ny = crossing.ny;

    const vNormal = nx * e.vx + ny * e.vy;
    if (vNormal >= 0) return false;

    const impulse = -2 * vNormal;

    e.vx += impulse * nx;
    e.vy += impulse * ny;
    return true;
  }

  /**
   * @param {Enemy} e 
   * @param {Ship} ship 
   * @param {number} dt
   * @returns {void}
   */
  _updateTurret(e, ship, dt) {
    if (!ship) return;

    e.shotCooldown = Math.max(0, e.shotCooldown - dt);

    const dx = ship.x - e.x;
    const dy = ship.y - e.y;

    const distSqrMax = this._TURRET_MAX_RANGE*this._TURRET_MAX_RANGE;

    // Short cooldown if ship is out of range, to give players a bit of
    // reaction time when an enemy comes on screen.

    if (dx*dx + dy*dy > distSqrMax) {
      e.shotCooldown = Math.max(e.shotCooldown, 0.5);
      return;
    }

    const dvx = ship.vx - e.vx;
    const dvy = ship.vy - e.vy;

    // Orbiting turrets use target leading so they can aim ahead since the player is typically
    // traveling fast. Other enemies just shoot at where the player is now.

    const dtHit = e.type === "orbitingTurret" ? dTImpact(dx, dy, dvx, dvy, this._TURRET_SHOT_SPEED) : 0;
    const dxAim = dx + dvx * dtHit;
    const dyAim = dy + dvy * dtHit;

    // Put turret on extra cooldown when player is out of sight, to
    // give players the element of "surprise" when they get into view.

    if (!this._hasLineOfSight(e.x, e.y, ship.x, ship.y)) {
      e.shotCooldown = Math.max(e.shotCooldown, 1.5);
      return;
    }

    if (e.shotCooldown > 0) return;

    e.shotCooldown = 1.0;
    this._shoot(e, this._TURRET_SHOT_SPEED, dxAim, dyAim);
  }

  /**
   * @param {Enemy} e 
   * @param {Ship} ship 
   * @param {number} dt
   * @returns {void}
   */
  _updateOrbitingTurret(e, ship, dt) {
    // Integrate orbital motion
    const {x: gx, y: gy} = this.planet.gravityAt(e.x, e.y);

    e.x += (e.vx + 0.5 * gx * dt) * dt;
    e.y += (e.vy + 0.5 * gy * dt) * dt;

    const {x: gx2, y: gy2} = this.planet.gravityAt(e.x, e.y);

    e.vx += ((gx + gx2) / 2) * dt;
    e.vy += ((gy + gy2) / 2) * dt;

    // Do normal turret update
    this._updateTurret(e, ship, dt);
  }

  /**
   * Shoot a bullet in the specified direction
   * @param {Enemy} e
   * @param {number} shotSpeed
   * @param {number} dx
   * @param {number} dy
   * @returns {void}
   */
  _shoot(e, shotSpeed, dx, dy) {
    const vScale = shotSpeed / (Math.hypot(dx, dy) || 1);
    this.shots.push({
      x: e.x,
      y: e.y,
      vx: e.vx + dx * vScale,
      vy: e.vy + dy * vScale,
      life: this._SHOT_LIFE,
      owner: e.type
    });
    if (this.onEnemyShot){
      this.onEnemyShot(e);
    }
  }

  /**
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @returns {boolean}
   */
  _hasLineOfSight(ax, ay, bx, by){
    if (!lineOfSightAir(this.collision, ax, ay, bx, by, this._LOS_STEP)) return false;
    if (this.solidPropSegmentBlocked && this.solidPropSegmentBlocked(ax, ay, bx, by, 0.05)) return false;
    return true;
  }
}

/**
 * Compute time-to-impact, given relative position and velocity of the target
 * and bullet speed s. Use the time-to-impact to project the target's position
 * forward to determine where to aim.
 * @param {number} x 
 * @param {number} y 
 * @param {number} vx 
 * @param {number} vy 
 * @param {number} s 
 * @returns {number}
 */
function dTImpact(x, y, vx, vy, s) {
  const a = s*s - vx*vx - vy*vy;
  const b = x*vx + y*vy;
  const c = x*x + y*y;
  const d = b*b + a*c;
  if (d < 0) return 0;
  const t = Math.max(0, (b + Math.sqrt(d)) / a);
  return t;
}

