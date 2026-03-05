// @ts-check

import { mulberry32 } from "./rng.js";
import { lineOfSightAir } from "./navigation.js";
import { collidesAtOffsets, isAir } from "./collision.js";
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
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} collision
 * @param {number} x
 * @param {number} y
 * @param {number} eps
 * @returns {[number, number]}
 */
function airGradient(collision, x, y, eps){
  const gdx = collision.airValueAtWorld(x + eps, y) - collision.airValueAtWorld(x - eps, y);
  const gdy = collision.airValueAtWorld(x, y + eps) - collision.airValueAtWorld(x, y - eps);
  return [gdx, gdy];
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

/**
 * @param {number} count
 * @param {number} seed
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} collision
 * @param {number} rMin
 * @param {number} rMax
 * @returns {Vec2[]}
 */
function pickAirPoints(count, seed, collision, rMin, rMax){
  if (rMin >= rMax) return [];
  const rand = mulberry32(seed);

  /** @type {Vec2[]} */
  const points = [];
  const attempts = Math.max(200, count * 80);
  for (let i = 0; i < attempts && points.length < count; i++){
    const ang = rand() * Math.PI * 2;
    const r = Math.sqrt(rMin*rMin + rand() * (rMax*rMax - rMin*rMin));
    const x = r * Math.cos(ang);
    const y = r * Math.sin(ang);
    if (collision.airValueAtWorld(x, y) <= 0.5) continue;
    points.push([x, y]);
  }
  return points;
}

/**
 * @param {number} count
 * @param {number} seed
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} collision
 * @param {number} rMax
 * @returns {Vec2[]}
 */
function pickSurfacePoints(count, seed, collision, rMax){
  const rand = mulberry32(seed);
  /** @type {Vec2[]} */
  const points = [];
  const eps = 0.12;
  const rMin = 1.0;
  const steps = 64;

  /**
   * @param {number} ang
   * @returns {{x:number,y:number,r:number}|null}
   */
  const findSurface = (ang) => {
    const cx = Math.cos(ang);
    const cy = Math.sin(ang);
    let prevR = rMin;
    let prevAir = collision.airValueAtWorld(cx * prevR, cy * prevR) > 0.5;
    for (let i = 1; i <= steps; i++){
      const r = rMin + (i / steps) * (rMax - rMin);
      const curAir = collision.airValueAtWorld(cx * r, cy * r) > 0.5;
      if (curAir !== prevAir){
        let lo = prevR;
        let hi = r;
        const loAir = prevAir;
        for (let it = 0; it < 8; it++){
          const mid = (lo + hi) * 0.5;
          const midAir = collision.airValueAtWorld(cx * mid, cy * mid) > 0.5;
          if (midAir === loAir){
            lo = mid;
          } else {
            hi = mid;
          }
        }
        const baseR = (lo + hi) * 0.5 + (loAir ? -eps : eps);
        return { x: cx * baseR, y: cy * baseR, r: baseR };
      }
      prevR = r;
      prevAir = curAir;
    }
    return null;
  };

  const attempts = Math.max(200, count * 120);
  for (let i = 0; i < attempts && points.length < count; i++){
    const ang = rand() * Math.PI * 2;
    const surf = findSurface(ang);
    if (!surf) continue;
    const upx = surf.x / (Math.hypot(surf.x, surf.y) || 1);
    const upy = surf.y / (Math.hypot(surf.x, surf.y) || 1);
    const below = surf.r - eps * 2.0;
    const above = surf.r + eps * 2.0;
    if (collision.airValueAtWorld(upx * below, upy * below) > 0.5) continue;
    if (collision.airValueAtWorld(upx * above, upy * above) <= 0.5) continue;
    points.push([surf.x, surf.y]);
  }
  return points;
}

export class Enemies {
  /**
   * Build enemy state and behavior helpers.
   * @param {Object} deps
   * @param {import("./planet.js").Planet} deps.planet Planet (gravity/orbits).
   * @param {import("./types.d.js").CollisionQuery} deps.collision Collision query API.
   */
  constructor({ planet, collision }){
    this.planet = planet;
    this.collision = collision;

    /** @type {Enemy[]} */
    this.enemies = [];
    /** @type {Shot[]} */
    this.shots = [];
    /** @type {Explosion[]} */
    this.explosions = [];
    /** @type {Debris[]} */
    this.debris = [];

    this._HUNTER_SPEED = 2.3;
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
    this._RANGER_MIN = 5.0;
    this._RANGER_MAX = 9.0;

    this._HUNTER_COLLIDER = circleOffsets(0.22, 6);
    this._RANGER_COLLIDER = circleOffsets(0.22, 6);
    this._CRAWLER_COLLIDER = circleOffsets(0.2, 6);
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
   * @param {number} total
   * @param {number} level
   * @param {number} levelSeed
   * @returns {void}
   */
  spawn(total, level, levelSeed){
    const { collision, planet } = this;
    this.enemies.length = 0;
    this.shots.length = 0;
    this.explosions.length = 0;
    this.debris.length = 0;
    if (total <= 0) return;
    const seed = levelSeed + level * 133;
    let numEnemiesRemaining = total;
    const hunters = Math.min(numEnemiesRemaining, Math.floor(total * 0.125));
    numEnemiesRemaining -= hunters;
    const rangers = Math.min(numEnemiesRemaining, Math.floor(total * 0.25));
    numEnemiesRemaining -= rangers;
    const crawlers = Math.min(numEnemiesRemaining, Math.floor(total * 0.25));
    numEnemiesRemaining -= crawlers;
    const turrets = numEnemiesRemaining;
    const orbitingTurrets = 8;

    const rHunterRangerMax = CFG.RMAX - 1.0;
    const hunterPts = pickAirPoints(hunters, seed + 1, collision, rHunterRangerMax * 0.5, rHunterRangerMax);
    const rangerPts = pickAirPoints(rangers, seed + 2, collision, rHunterRangerMax * 0.75, rHunterRangerMax);
    const crawlerPts = pickAirPoints(crawlers, seed + 3, collision, 0.0, CFG.RMAX - 0.6);
    const turretPts = pickAirPoints(turrets, seed + 4, collision, 0.0, CFG.RMAX + 0.5);

    for (const [x, y] of hunterPts){
      this.enemies.push({ type: "hunter", x, y, vx: 0, vy: 0, cooldown: Math.random(), hp: 2 });
    }
    for (const [x, y] of rangerPts){
      this.enemies.push({ type: "ranger", x, y, vx: 0, vy: 0, cooldown: Math.random(), hp: 2 });
    }
    for (const [x, y] of crawlerPts){
      const dir = Math.random() * Math.PI * 2;
      const speed = Math.min(3, level * 0.25 + 0.5);
      const vx = Math.cos(dir) * speed;
      const vy = Math.sin(dir) * speed;
      this.enemies.push({ type: "crawler", x, y, vx: vx, vy: vy, cooldown: 0, hp: 1 });
    }
    for (const [x, y] of turretPts){
      this.enemies.push({ type: "turret", x, y, vx: 0, vy: 0, cooldown: Math.random(), hp: 1 });
    }
    {
      const rand = mulberry32(seed + 5);
      const directionCCW = (rand() < 0.5);
      const perigee = CFG.RMAX + 2;
      const eccentricity = rand() * 0.15;
      let angle = rand() * Math.PI * 2;
      for (let i = 0; i < orbitingTurrets; ++i){
        const {x: x, y: y, vx: vx, vy: vy} = planet.orbitStateFromElements(perigee, eccentricity, angle, directionCCW);
        this.enemies.push({ type: "orbitingTurret", x, y, vx, vy, cooldown: Math.random(), hp: 1 });
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
        d.vx *= Math.max(0, 1 - GAME.DRAG * dt);
        d.vy *= Math.max(0, 1 - GAME.DRAG * dt);
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

    const targetable = ship && ship.state !== "crashed";
    for (let i = this.enemies.length - 1; i >= 0; i--){
      const e = this.enemies[i];
      if (e.hp <= 0){
        const pieces = 6;
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
        this.explosions.push({ x: e.x, y: e.y, life: 0.5, owner: e.type, radius: 0.8 });
        this.enemies.splice(i, 1);
        continue;
      }

      const dx = ship.x - e.x;
      const dy = ship.y - e.y;
      const dist = Math.hypot(dx, dy);

      if (e.type === "hunter"){
        if (!tryMoveAir(e, collision, dx, dy, this._HUNTER_SPEED, dt, this._HUNTER_COLLIDER)){
          const [gx, gy] = airGradient(collision, e.x, e.y, 0.18);
          const tlen = Math.hypot(gx, gy);
          if (tlen > 1e-4){
            const tx = -gy / tlen;
            const ty = gx / tlen;
            tryMoveAir(e, collision, tx, ty, this._HUNTER_SPEED, dt, this._HUNTER_COLLIDER) || tryMoveAir(e, collision, -tx, -ty, this._HUNTER_SPEED, dt, this._HUNTER_COLLIDER);
          }
        }
        e.cooldown = Math.max(0, e.cooldown - dt);
        if (targetable && e.cooldown <= 0 && dist < 10 && lineOfSightAir(collision, e.x, e.y, ship.x, ship.y, this._LOS_STEP)){
          this._shoot(e, this._SHOT_SPEED, dx, dy);
          e.cooldown = this._HUNTER_SHOT_CD;
        }
      } else if (e.type === "ranger"){
        if (dist < this._RANGER_MIN){
          tryMoveAir(e, collision, -dx, -dy, this._RANGER_SPEED, dt, this._RANGER_COLLIDER);
        } else if (dist > this._RANGER_MAX){
          tryMoveAir(e, collision, dx, dy, this._RANGER_SPEED, dt, this._RANGER_COLLIDER);
        }
        e.cooldown = Math.max(0, e.cooldown - dt);
        if (targetable && e.cooldown <= 0 && dist > this._RANGER_MIN * 0.8 && lineOfSightAir(collision, e.x, e.y, ship.x, ship.y, this._LOS_STEP)){
          this._shoot(e, this._SHOT_SPEED, dx, dy);
          e.cooldown = this._RANGER_SHOT_CD;
        }
      } else if (e.type === "crawler"){
        if (!this._updateCrawler(e, ship, dt)) {
          this.enemies.splice(i, 1);
        }
      } else if (e.type === "turret"){
        this._updateTurret(e, ship, dt);
      } else if (e.type === "orbitingTurret"){
        this._updateOrbitingTurret(e, ship, dt);
      }
    }
  }

  /**
   * @param {Enemy} e 
   * @param {Ship} ship 
   * @param {number} dt 
   * @returns {boolean} keep alive?
   */
  _updateCrawler(e, ship, dt) {
    this._moveCrawler(e, ship, dt);

    const dx = ship.x - e.x;
    const dy = ship.y - e.y;
    const dist = Math.hypot(dx, dy);

    if (dist <= this._DETONATE_RANGE){
      this.explosions.push({ x: e.x, y: e.y, life: 0.5, owner: "crawler", radius: 1.1 });
      return false;
    }
    return true;
  }

  /**
   * @param {Enemy} e
   * @param {Ship} ship
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
   * @param {Ship} ship 
   * @returns {void}
   */
  _approachPlayer(e, ship) {
    if (!ship || ship.state === "crashed") return;
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
    const cooldownNext = Math.max(0, e.cooldown - dt);
    e.cooldown = cooldownNext;
    if (e.cooldown > 0) return;

    if (!ship || ship.state === "crashed") return;

    const dx = ship.x - e.x;
    const dy = ship.y - e.y;
    const dvx = ship.vx - e.vx;
    const dvy = ship.vy - e.vy;

    const dtHit = dTImpact(dx, dy, dvx, dvy, this._TURRET_SHOT_SPEED);
    const dxAim = dx + dvx * dtHit;
    const dyAim = dy + dvy * dtHit;

    const dAim = Math.hypot(dxAim, dyAim);

    if (dAim >= this._TURRET_MAX_RANGE) return;
    if (!lineOfSightAir(this.collision, e.x, e.y, ship.x, ship.y, this._LOS_STEP)) {
      // Put turret on extra cooldown when player is out of sight, to
      // give players the element of "surprise" when they get into view.
      e.cooldown = Math.max(e.cooldown, 2.5);
      return;
    }
    if (!lineOfSightAir(this.collision, e.x, e.y, e.x + dxAim, e.y + dyAim, this._LOS_STEP)) return;

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
