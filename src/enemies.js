// @ts-check

import { mulberry32 } from "./rng.js";
import { lineOfSightAir } from "./navigation.js";
import { collidesAtOffsets, isAir } from "./collision.js";
import { GAME } from "./config.js";
import { planetGravity } from "./loop.js";

/** @typedef {import("./types.d.js").Vec2} Vec2 */
/** @typedef {import("./types.d.js").EnemyType} EnemyType */
/** @typedef {import("./types.d.js").Enemy} Enemy */
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
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {number} x
 * @param {number} y
 * @param {number} eps
 * @returns {[number, number]}
 */
function airGradient(mesh, x, y, eps){
  const gdx = mesh.airValueAtWorld(x + eps, y) - mesh.airValueAtWorld(x - eps, y);
  const gdy = mesh.airValueAtWorld(x, y + eps) - mesh.airValueAtWorld(x, y - eps);
  return [gdx, gdy];
}

/**
 * @param {Enemy} e
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {number} dx
 * @param {number} dy
 * @param {number} speed
 * @param {number} dt
 * @returns {boolean}
 */
function tryMoveAir(e, mesh, dx, dy, speed, dt, collider){
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return false;
  const nx = dx / len;
  const ny = dy / len;
  const step = speed * dt;
  const tx = e.x + nx * step;
  const ty = e.y + ny * step;
  if (!collider ? isAir(mesh, tx, ty) : !collidesAtOffsets(mesh, tx, ty, collider)){
    e.x = tx; e.y = ty;
    e.vx = nx * speed;
    e.vy = ny * speed;
    return true;
  }
  return false;
}

/**
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {number} x
 * @param {number} y
 * @returns {[number, number]}
 */
function nudgeTowardSurface(mesh, x, y){
  const eps = 0.12;
  const [gdx, gdy] = airGradient(mesh, x, y, eps);
  const nlen = Math.hypot(gdx, gdy);
  if (nlen < 1e-5) return [x, y];
  const nx = gdx / nlen;
  const ny = gdy / nlen;
  const air = mesh.airValueAtWorld(x, y);
  const push = 0.08;
  if (air > 0.55){
    return [x - nx * push, y - ny * push];
  }
  if (air < 0.45){
    return [x + nx * push, y + ny * push];
  }
  return [x, y];
}

/**
 * @param {number} count
 * @param {number} seed
 * @param {number} minR
 * @param {number} maxR
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @returns {Vec2[]}
 */
function pickAirPoints(count, seed, minR, maxR, mesh){
  const rand = mulberry32(seed);
  /** @type {Vec2[]} */
  const points = [];
  const attempts = Math.max(200, count * 80);
  for (let i = 0; i < attempts && points.length < count; i++){
    const ang = rand() * Math.PI * 2;
    const r = minR + rand() * (maxR - minR);
    const x = r * Math.cos(ang);
    const y = r * Math.sin(ang);
    if (mesh.airValueAtWorld(x, y) <= 0.5) continue;
    points.push([x, y]);
  }
  return points;
}

/**
 * @param {number} count
 * @param {number} seed
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {number} rMax
 * @returns {Vec2[]}
 */
function pickSurfacePoints(count, seed, mesh, rMax){
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
    let prevAir = mesh.airValueAtWorld(cx * prevR, cy * prevR) > 0.5;
    for (let i = 1; i <= steps; i++){
      const r = rMin + (i / steps) * (rMax - rMin);
      const curAir = mesh.airValueAtWorld(cx * r, cy * r) > 0.5;
      if (curAir !== prevAir){
        let lo = prevR;
        let hi = r;
        const loAir = prevAir;
        for (let it = 0; it < 8; it++){
          const mid = (lo + hi) * 0.5;
          const midAir = mesh.airValueAtWorld(cx * mid, cy * mid) > 0.5;
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
    if (mesh.airValueAtWorld(upx * below, upy * below) > 0.5) continue;
    if (mesh.airValueAtWorld(upx * above, upy * above) <= 0.5) continue;
    points.push([surf.x, surf.y]);
  }
  return points;
}

export class Enemies {
  /**
   * Build enemy state and behavior helpers.
   * @param {Object} deps
   * @param {typeof import("./config.js").CFG} deps.cfg Game config constants.
   * @param {import("./mapgen.js").MapGen} deps.mapgen Map generator.
   * @param {import("./mesh.js").RingMesh} deps.mesh Mesh query API.
   */
  constructor({ cfg, mapgen, mesh }){
    this.cfg = cfg;
    this.mapgen = mapgen;
    this.mesh = mesh;

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
    this._CRAWLER_SPEED = 1.2;
    this._HUNTER_SHOT_CD = 1.2;
    this._RANGER_SHOT_CD = 1.8;
    this._SHOT_SPEED = 6.5;
    this._SHOT_LIFE = 3.0;
    this._DETONATE_RANGE = 1.6;
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
   * @returns {void}
   */
  spawn(total, level){
    const { cfg, mapgen, mesh } = this;
    this.enemies.length = 0;
    this.shots.length = 0;
    this.explosions.length = 0;
    this.debris.length = 0;
    if (total <= 0) return;
    const seed = mapgen.getWorld().seed + level * 133;
    const hunters = Math.max(0, Math.floor(total * 0.5));
    const rangers = Math.max(0, Math.floor(total * 0.25));
    const crawlers = Math.max(0, total - hunters - rangers);

    const hunterPts = pickAirPoints(hunters, seed + 1, 2.0, cfg.RMAX - 1.0, mesh);
    const rangerPts = pickAirPoints(rangers, seed + 2, 3.0, cfg.RMAX - 1.0, mesh);
    const crawlerPts = pickSurfacePoints(crawlers, seed + 3, mesh, cfg.RMAX - 0.6);

    for (const [x, y] of hunterPts){
      this.enemies.push({ type: "hunter", x, y, vx: 0, vy: 0, cooldown: Math.random(), hp: 2, dir: 1, fuse: 0 });
    }
    for (const [x, y] of rangerPts){
      this.enemies.push({ type: "ranger", x, y, vx: 0, vy: 0, cooldown: Math.random(), hp: 2, dir: -1, fuse: 0 });
    }
    for (const [x, y] of crawlerPts){
      this.enemies.push({ type: "crawler", x, y, vx: 0, vy: 0, cooldown: 0, hp: 1, dir: Math.random() < 0.5 ? -1 : 1, fuse: 0 });
    }
  }

  /**
   * @param {{x:number,y:number}} ship
   * @param {number} dt
   * @returns {void}
   */
  update(ship, dt){
    const { mesh } = this;
    if (this.debris.length){
      for (let i = this.debris.length - 1; i >= 0; i--){
        const d = this.debris[i];
        const r = Math.hypot(d.x, d.y) || 1;
        const {x: gx, y: gy} = planetGravity(d.x, d.y);
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
      if (s.life <= 0 || !isAir(mesh, s.x, s.y)){
        this.shots.splice(i, 1);
      }
    }

    for (let i = this.explosions.length - 1; i >= 0; i--){
      this.explosions[i].life -= dt;
      if (this.explosions[i].life <= 0) this.explosions.splice(i, 1);
    }

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
            vx: Math.cos(ang) * sp,
            vy: Math.sin(ang) * sp,
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
      e.cooldown = Math.max(0, e.cooldown - dt);

      if (e.type === "hunter"){
        if (!tryMoveAir(e, mesh, dx, dy, this._HUNTER_SPEED, dt, this._HUNTER_COLLIDER)){
          const [gx, gy] = airGradient(mesh, e.x, e.y, 0.18);
          const tlen = Math.hypot(gx, gy);
          if (tlen > 1e-4){
            const tx = -gy / tlen;
            const ty = gx / tlen;
            tryMoveAir(e, mesh, tx, ty, this._HUNTER_SPEED, dt, this._HUNTER_COLLIDER) || tryMoveAir(e, mesh, -tx, -ty, this._HUNTER_SPEED, dt, this._HUNTER_COLLIDER);
          }
        }
        if (e.cooldown <= 0 && dist < 10 && lineOfSightAir(mesh, e.x, e.y, ship.x, ship.y, this._LOS_STEP)){
          const inv = 1 / (dist || 1);
          this.shots.push({ x: e.x, y: e.y, vx: dx * inv * this._SHOT_SPEED + e.vx, vy: dy * inv * this._SHOT_SPEED + e.vy, life: this._SHOT_LIFE, owner: "hunter" });
          e.cooldown = this._HUNTER_SHOT_CD;
        }
      } else if (e.type === "ranger"){
        if (dist < this._RANGER_MIN){
          tryMoveAir(e, mesh, -dx, -dy, this._RANGER_SPEED, dt, this._RANGER_COLLIDER);
        } else if (dist > this._RANGER_MAX){
          tryMoveAir(e, mesh, dx, dy, this._RANGER_SPEED, dt, this._RANGER_COLLIDER);
        }
        if (e.cooldown <= 0 && dist > this._RANGER_MIN * 0.8 && lineOfSightAir(mesh, e.x, e.y, ship.x, ship.y, this._LOS_STEP)){
          const inv = 1 / (dist || 1);
          this.shots.push({ x: e.x, y: e.y, vx: dx * inv * this._SHOT_SPEED + e.vx, vy: dy * inv * this._SHOT_SPEED + e.vy, life: this._SHOT_LIFE, owner: "ranger" });
          e.cooldown = this._RANGER_SHOT_CD;
        }
      } else if (e.type === "crawler"){
        const [gx, gy] = airGradient(mesh, e.x, e.y, 0.16);
        const nlen = Math.hypot(gx, gy);
        if (nlen > 1e-4){
          const nx = gx / nlen;
          const ny = gy / nlen;
          const tx = -ny * e.dir;
          const ty = nx * e.dir;
          const step = this._CRAWLER_SPEED * dt;
          const txw = e.x + tx * step;
          const tyw = e.y + ty * step;
          if (!collidesAtOffsets(mesh, txw, tyw, this._CRAWLER_COLLIDER)){
            e.x = txw;
            e.y = tyw;
          }
          const nudged = nudgeTowardSurface(mesh, e.x, e.y);
          if (!collidesAtOffsets(mesh, nudged[0], nudged[1], this._CRAWLER_COLLIDER)){
            e.x = nudged[0];
            e.y = nudged[1];
          }
        }

        if (dist <= this._DETONATE_RANGE){
          e.fuse += dt;
          if (e.fuse >= this._DETONATE_FUSE){
            this.explosions.push({ x: e.x, y: e.y, life: 0.5, owner: "crawler", radius: 1.1 });
            this.enemies.splice(i, 1);
          }
        } else {
          e.fuse = Math.max(0, e.fuse - dt * 0.5);
        }
      }
    }
  }
}
