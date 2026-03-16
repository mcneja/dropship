// @ts-check

import { mulberry32 } from "./rng.js";
import { findPathAStar, lineOfSightAir, nearestRadialNode } from "./navigation.js";
import { collidesAtOffsets, isAir } from "./collision_world.js";
import { CFG, GAME } from "./config.js";

/** @typedef {import("./types.d.js").Vec2} Vec2 */
/** @typedef {import("./types.d.js").EnemyType} EnemyType */
/** @typedef {import("./types.d.js").Enemy} Enemy */
/** @typedef {import("./types.d.js").Ship} Ship */
/** @typedef {import("./types.d.js").Shot} Shot */
/** @typedef {import("./types.d.js").Explosion} Explosion */
/** @typedef {import("./types.d.js").Debris} Debris */

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
   * @param {(enemy:Enemy, info?:{cause:"hp"|"detonate"})=>void} [deps.onEnemyDestroyed]
   */
  constructor({ planet, collision, total, level, levelSeed, placement, orbitingTurretCount, onEnemyShot, onEnemyDestroyed }){
    this.planet = planet;
    this.collision = collision;
    this.params = planet.getPlanetParams();
    this.onEnemyShot = (typeof onEnemyShot === "function") ? onEnemyShot : null;
    this.onEnemyDestroyed = (typeof onEnemyDestroyed === "function") ? onEnemyDestroyed : null;

    /** @type {Enemy[]} */
    this.enemies = [];
    /** @type {Shot[]} */
    this.shots = [];
    /** @type {Explosion[]} */
    this.explosions = [];
    /** @type {Debris[]} */
    this.debris = [];

    this._HUNTER_SPEED = 1.0;
    this._RANGER_SPEED = 1.6;
    this._HUNTER_SHOT_CD = 1.2;
    this._RANGER_SHOT_CD = 1.8;
    this._SHOT_SPEED = 6.5;
    this._TURRET_MAX_RANGE = 5.0;
    this._TURRET_SHOT_SPEED = 5.0;
    this._SHOT_LIFE = 3.0;
    this._APPROACH_RANGE = 2.0;
    this._DETONATE_RANGE = 0.5;
    this._DETONATE_FUSE = 0.6;
    this._LOS_STEP = 0.2;
    this._CRAWLER_BLAST_LIFE = 0.75;
    this._CRAWLER_BLAST_RADIUS = 1.15;

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
  }

  /**
   * @param {EnemyType} type
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  spawnDebug(type, x, y){
    const cooldown = Math.random();
    if (type === "hunter"){
      this.enemies.push({ type, x, y, vx: 0, vy: 0, cooldown, hp: 2, iNodeGoal: null });
    } else if (type === "ranger"){
      this.enemies.push({ type, x, y, vx: 0, vy: 0, cooldown, hp: 2, iNodeGoal: null });
    } else if (type === "crawler"){
      const dir = Math.random() * Math.PI * 2;
      const speed = 1.5;
      this.enemies.push({ type, x, y, vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, cooldown: 0, hp: 1, iNodeGoal: null });
    } else if (type === "turret"){
      this.enemies.push({ type, x, y, vx: 0, vy: 0, cooldown, hp: 1, iNodeGoal: null });
    } else if (type === "orbitingTurret"){
      this.enemies.push({ type, x, y, vx: 0, vy: 0, cooldown, hp: 1, iNodeGoal: null });
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

    const rHunterRangerMax = this.params.RMAX - 1.0;
    const hunterPts = planet.sampleAirPoints(hunters, seed + 1, rHunterRangerMax * 0.5, rHunterRangerMax, placement);
    const rangerPts = planet.sampleAirPoints(rangers, seed + 2, rHunterRangerMax * 0.75, rHunterRangerMax, placement);
    const crawlerPts = planet.sampleAirPoints(crawlers, seed + 3, 0.0, this.params.RMAX - 0.6, placement);
    const turretPts = planet.sampleTurretPoints(turrets, seed + 4, placement, GAME.MINER_MIN_SEP, true);
    if (turrets > 0 && turretPts.length < turrets){
      const standable = (planet.getStandablePoints && planet.getStandablePoints()) || [];
      console.error("[Level] turrets spawn insufficient standable points", {
        level,
        target: turrets,
        placed: turretPts.length,
        standable: standable.length,
      });
    }

    for (const [x, y] of hunterPts){
      this.enemies.push({ type: "hunter", x, y, vx: 0, vy: 0, cooldown: Math.random(), hp: 3, iNodeGoal: null });
    }
    for (const [x, y] of rangerPts){
      this.enemies.push({ type: "ranger", x, y, vx: 0, vy: 0, cooldown: Math.random(), hp: 2, iNodeGoal: null });
    }
    for (const [x, y] of crawlerPts){
      const dir = Math.random() * Math.PI * 2;
      const speed = Math.min(3, level * 0.25 + 0.5);
      const vx = Math.cos(dir) * speed;
      const vy = Math.sin(dir) * speed;
      this.enemies.push({ type: "crawler", x, y, vx: vx, vy: vy, cooldown: 0, hp: 1, iNodeGoal: null });
    }
    for (const [x, y] of turretPts){
      let tx = x;
      let ty = y;
      const res = planet.nudgeOutOfTerrain(tx, ty, 0.8, 0.08, 0.18);
      if (res && res.ok){
        tx = res.x;
        ty = res.y;
      }
      const info = planet.surfaceInfoAtWorld(tx, ty, 0.18);
      if (info){
        const lift = 0.18;
        tx += info.nx * lift;
        ty += info.ny * lift;
      }
      this.enemies.push({ type: "turret", x: tx, y: ty, vx: 0, vy: 0, cooldown: Math.random(), hp: 1, iNodeGoal: null });
    }
    {
      const rand = mulberry32(seed + 5);
      const directionCCW = (rand() < 0.5);
      const perigee = this.params.RMAX + 2;
      const eccentricity = rand() * 0.15;
      let angle = rand() * Math.PI * 2;
      for (let i = 0; i < orbitingTurrets; ++i){
        const {x: x, y: y, vx: vx, vy: vy} = planet.orbitStateFromElements(perigee, eccentricity, angle, directionCCW);
        this.enemies.push({ type: "orbitingTurret", x, y, vx, vy, cooldown: Math.random(), hp: 1, iNodeGoal: null });
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
    if (this.debris.length){
      for (let i = this.debris.length - 1; i >= 0; i--){
        const d = this.debris[i];
        const r = Math.hypot(d.x, d.y) || 1;
        const {x: gx, y: gy} = collision.gravityAt(d.x, d.y);
        d.vx += gx * dt;
        d.vy += gy * dt;
        d.vx *= Math.max(0, 1 - this.params.DRAG * dt);
        d.vy *= Math.max(0, 1 - this.params.DRAG * dt);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.a += d.w * dt;
        d.life -= dt;
        if (d.life <= 0) this.debris.splice(i, 1);
      }
    }
    for (let i = this.shots.length - 1; i >= 0; i--){
      const s = this.shots[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.life <= 0 || !isAir(collision, s.x, s.y)){
        this.shots.splice(i, 1);
      }
    }

    for (let i = this.explosions.length - 1; i >= 0; i--){
      this.explosions[i].life -= dt;
      if (this.explosions[i].life <= 0) this.explosions.splice(i, 1);
    }

    const shipTarget = (ship && ship.state !== "crashed") ? ship : null;

    for (let i = this.enemies.length - 1; i >= 0; i--){
      const e = this.enemies[i];
      if (e.hitT && e.hitT > 0){
        e.hitT = Math.max(0, e.hitT - dt);
      }
      if (e.hp <= 0){
        this._notifyEnemyDestroyed(e, "hp");
        this._spawnEnemyDebrisBurst(e, e.type === "crawler" ? 10 : 6);
        if (e.type === "crawler"){
          this._spawnCrawlerBlastVisual(e);
        } else {
          this.explosions.push({ x: e.x, y: e.y, life: 0.5, maxLife: 0.5, owner: e.type, radius: 0.8 });
        }
        this.enemies.splice(i, 1);
        continue;
      }

      if (e.type === "hunter"){
        this._updateHunter(e, shipTarget, dt);
      } else if (e.type === "ranger"){
        this._updateRanger(e, shipTarget, dt);
      } else if (e.type === "crawler"){
        if (!this._updateCrawler(e, shipTarget, dt)) {
          this._notifyEnemyDestroyed(e, "detonate");
          this._spawnEnemyDebrisBurst(e, 10);
          this.enemies.splice(i, 1);
        }
      } else if (e.type === "turret"){
        this._updateTurret(e, shipTarget, dt);
      } else if (e.type === "orbitingTurret"){
        this._updateOrbitingTurret(e, shipTarget, dt);
      }
    }
  }

  /**
   * @param {Enemy} e 
   * @param {Ship|null} ship 
   * @param {number} dt 
   * @returns {void}
   */
  _updateHunter(e, ship, dt) {
    if (this._tryMoveHunter(e, ship, dt)) {
      e.iNodeGoal = null;
    } else {
      this._wander(e, this._HUNTER_SPEED, dt);
    }

    this._updateTurret(e, ship, dt);
  }

  /**
   * @param {Enemy} e 
   * @param {Ship|null} ship 
   * @param {number} dt 
   * @returns {boolean}
   */
  _tryMoveHunter(e, ship, dt) {
    if (!ship) return false;

    if (Math.hypot(ship.x, ship.y) > this.planet.planetRadius + 1.0) return false;

    const maxPathDist = 16;

    if (Math.hypot(e.x - ship.x, e.y - ship.y) > maxPathDist) return false;

    const radialGraph = this.planet.radialGraph;

    const nodeShip = this.planet.nearestRadialNodeInAir(ship.x, ship.y);
    const nodeHunter = this.planet.nearestRadialNodeInAir(e.x, e.y);
    const pathNodes = findPathAStar(radialGraph, nodeHunter, nodeShip, this.planet.airNodesBitmap);
    if (!pathNodes || pathNodes.length < 2) return false;

    /**
     * @param {number} maxLength 
     * @returns {boolean}
     */
    const pathLengthExceeds = (maxLength) => {
      let pathLength = 0;
      let node0 = radialGraph.nodes[pathNodes[0]];
      for (let i = 1; i < pathNodes.length; ++i) {
        const node1 = radialGraph.nodes[pathNodes[i]];
        pathLength += Math.hypot(node1.x - node0.x, node1.y - node0.y);
        if (pathLength > maxLength) return true;
        node0 = node1;
      }
      return false;
    }

    if (pathLengthExceeds(maxPathDist)) return false;

    const nodeTarget = radialGraph.nodes[pathNodes[1]];

    let dx = nodeTarget.x - e.x;
    let dy = nodeTarget.y - e.y;
    const dist = Math.hypot(dx, dy);
    const maxMoveDist = this._HUNTER_SPEED * dt;
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
   * @param {Ship|null} ship 
   * @param {number} dt 
   * @returns {void}
   */
  _updateRanger(e, ship, dt) {
    const seesShip =
      ship &&
      Math.hypot(ship.x - e.x, ship.y - e.y) < this._TURRET_MAX_RANGE &&
      lineOfSightAir(this.collision, e.x, e.y, ship.x, ship.y, this._LOS_STEP);

    if (seesShip) {
      const decay = Math.exp(-5 * dt);
      const vxPrev = e.vx;
      const vyPrev = e.vy;
      e.vx *= decay;
      e.vy *= decay;
      e.x += (vxPrev + e.vx) * (dt / 2);
      e.y += (vyPrev + e.vy) * (dt / 2);
      e.iNodeGoal = null;
    } else {
      this._wander(e, this._RANGER_SPEED, dt);
    }

    this._updateTurret(e, ship, dt);
  }

  /**
   * @param {Enemy} e 
   * @param {number} speed
   * @param {number} dt 
   * @returns {void}
   */
  _wander(e, speed, dt) {
    const iNodeFrom = this.planet.nearestRadialNodeInAir(e.x, e.y);
    if (e.iNodeGoal === null || iNodeFrom === e.iNodeGoal) {
      e.iNodeGoal = this._iNodeWanderDirection(iNodeFrom, e.x, e.y, e.vx, e.vy);
    }
    const nodeGoal = this.planet.radialGraph.nodes[e.iNodeGoal];
    let dx = nodeGoal.x - e.x;
    let dy = nodeGoal.y - e.y;
    const dist = Math.hypot(dx, dy);
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
  }

  /**
   * @param {number} iNodeFrom
   * @param {number} x
   * @param {number} y
   * @param {number} vx
   * @param {number} vy
   * @returns {number}
   */
  _iNodeWanderDirection(iNodeFrom, x, y, vx, vy) {
    const radialGraph = this.planet.radialGraph;
    /** @type {Array<number>} */
    const iNodeCandidates = [];
    for (const n of radialGraph.neighbors[iNodeFrom]) {
      const iNode = n.to;
      if (this.planet.airNodesBitmap[iNode] === 0) continue;
      const node = radialGraph.nodes[iNode];
      const dx = node.x - x;
      const dy = node.y - y;
      const dot = dx*vx + dy*vy;
      if (dot <= 0) continue;
      iNodeCandidates.push(iNode);
    }
    if (iNodeCandidates.length === 0) {
      for (const n of radialGraph.neighbors[iNodeFrom]) {
        const iNode = n.to;
        if (this.planet.airNodesBitmap[iNode] === 0) continue;
        iNodeCandidates.push(iNode);
      }
    }

    if (iNodeCandidates.length === 0) {
      return iNodeFrom;
    }

    return iNodeCandidates[Math.floor(Math.random() * iNodeCandidates.length)];
  }

  /**
   * @param {Enemy} e 
   * @param {Ship|null} ship 
   * @param {number} dt 
   * @returns {boolean} keep alive?
   */
  _updateCrawler(e, ship, dt) {
    this._moveCrawler(e, ship, dt);

    if (!ship) return;

    const dx = ship.x - e.x;
    const dy = ship.y - e.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= this._DETONATE_RANGE){
      this._spawnCrawlerBlastVisual(e);
      return false;
    }
    return true;
  }

  /**
   * @param {Enemy} e
   * @param {"hp"|"detonate"} cause
   * @returns {void}
   */
  _notifyEnemyDestroyed(e, cause){
    if (this.onEnemyDestroyed){
      this.onEnemyDestroyed(e, { cause });
    }
  }

  /**
   * @param {Enemy} e
   * @param {number} pieces
   * @returns {void}
   */
  _spawnEnemyDebrisBurst(e, pieces){
    for (let k = 0; k < pieces; k++){
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.0 + Math.random() * 2.0;
      this.debris.push({
        x: e.x + Math.cos(ang) * 0.08,
        y: e.y + Math.sin(ang) * 0.08,
        vx: e.vx + Math.cos(ang) * sp,
        vy: e.vy + Math.sin(ang) * sp,
        a: Math.random() * Math.PI * 2,
        w: (Math.random() - 0.5) * 6,
        life: 1.1 + Math.random() * 0.8,
      });
    }
  }

  /**
   * @param {Enemy} e
   * @returns {void}
   */
  _spawnCrawlerBlastVisual(e){
    this.explosions.push({
      x: e.x,
      y: e.y,
      life: this._CRAWLER_BLAST_LIFE,
      maxLife: this._CRAWLER_BLAST_LIFE,
      owner: "crawler",
      radius: this._CRAWLER_BLAST_RADIUS,
    });
  }

  /**
   * @param {Enemy} e
   * @param {Ship|null} ship
   * @param {number} dt 
   */
  _moveCrawler(e, ship, dt) {
    this._approachPlayer(e, ship);
    this._reflectVelocityBackTowardPlanet(e);
    this._reflectVelocityAwayFromTerrain(e);
    e.x += e.vx * dt;
    e.y += e.vy * dt;
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
    const rMax = this.planet.planetRadius + 1;

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
   * @returns {void}
   */
  _reflectVelocityAwayFromTerrain(e) {
    const planet = this.planet;

    const distAboveGround = planet.airValueAtWorld(e.x, e.y) - 0.75;
    if (distAboveGround > 0) return;

    const eps = 0.18;
    const gdx = planet.airValueAtWorld(e.x + eps, e.y) - planet.airValueAtWorld(e.x - eps, e.y);
    const gdy = planet.airValueAtWorld(e.x, e.y + eps) - planet.airValueAtWorld(e.x, e.y - eps);
    let nx = gdx;
    let ny = gdy;
    let nlen = Math.hypot(nx, ny);
    if (nlen < 1e-4) return;
    nx /= nlen;
    ny /= nlen;

    const vNormal = nx * e.vx + ny * e.vy;
    if (vNormal >= 0) return;

    const impulse = -2 * vNormal;

    e.vx += impulse * nx;
    e.vy += impulse * ny;
  }

  /**
   * @param {Enemy} e 
   * @param {Ship} ship 
   * @param {number} dt
   * @returns {void}
   */
  _updateTurret(e, ship, dt) {
    if (!ship) return;

    e.cooldown = Math.max(0, e.cooldown - dt);

    const dx = ship.x - e.x;
    const dy = ship.y - e.y;

    const distSqrMax = this._TURRET_MAX_RANGE*this._TURRET_MAX_RANGE;

    // Short cooldown if ship is out of range, to give players a bit of
    // reaction time when an enemy comes on screen.

    if (dx*dx + dy*dy > distSqrMax) {
      e.cooldown = Math.max(e.cooldown, 0.5);
      return;
    }

    const dvx = ship.vx - e.vx;
    const dvy = ship.vy - e.vy;

    const dtHit = dTImpact(dx, dy, dvx, dvy, this._TURRET_SHOT_SPEED);
    const dxAim = dx + dvx * dtHit;
    const dyAim = dy + dvy * dtHit;

//    if (dxAim*dxAim + dyAim*dyAim > distSqrMax) return;

    // Put turret on extra cooldown when player is out of sight, to
    // give players the element of "surprise" when they get into view.

    if (!lineOfSightAir(this.collision, e.x, e.y, ship.x, ship.y, this._LOS_STEP)) {
      e.cooldown = Math.max(e.cooldown, 1.5);
      return;
    }

    if (e.cooldown > 0) return;

    e.cooldown = 1.0;
    this._shoot(e, this._TURRET_SHOT_SPEED, dxAim, dyAim);
  }

  /**
   * @param {Enemy} e 
   * @param {Ship} ship 
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
}

/**
 * 
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
