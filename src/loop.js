// @ts-check

import { GAME } from "./config.js";
import { mulberry32 } from "./rng.js";
import { Enemies } from "./enemies.js";
import { collidesAtWorldPoints } from "./collision.js";

/** @typedef {import("./types.d.js").Ship} Ship */
/** @typedef {import("./types.d.js").Miner} Miner */
/** @typedef {import("./types.d.js").Ui} Ui */

export class GameLoop {
  /**
   * Main gameplay loop orchestrator.
   * @param {Object} deps
   * @param {typeof import("./config.js").CFG} deps.cfg
   * @param {import("./mapgen.js").MapGen} deps.mapgen
   * @param {import("./mesh.js").RingMesh} deps.mesh
   * @param {import("./rendering.js").Renderer} deps.renderer
   * @param {import("./input.js").Input} deps.input
   * @param {Ui} deps.ui
   * @param {HTMLCanvasElement} deps.canvas
   * @param {HTMLCanvasElement|null|undefined} deps.overlay
   * @param {HTMLElement} deps.hud
   */
  constructor({ cfg, mapgen, mesh, renderer, input, ui, canvas, hud, overlay }){
    this.cfg = cfg;
    this.mapgen = mapgen;
    this.mesh = mesh;
    this.renderer = renderer;
    this.input = input;
    this.ui = ui;
    this.canvas = canvas;
    this.hud = hud;
    this.overlay = overlay || null;
    this.overlayCtx = this.overlay ? this.overlay.getContext("2d") : null;

    this.TERRAIN_PAD = 0.5;
    this.TERRAIN_MAX = cfg.RMAX + this.TERRAIN_PAD;
    this.SHIP_RADIUS = 0.7 * 0.28 * GAME.SHIP_SCALE;
    this.MINER_HEIGHT = 0.36 * GAME.MINER_SCALE;
    this.MINER_SURFACE_EPS = 0.01 * GAME.MINER_SCALE;
    this.SURFACE_EPS = Math.max(0.12, cfg.RMAX / 280);
    this.COLLISION_EPS = Math.max(0.18, cfg.RMAX / 240);
    this.MINER_HEAD_OFFSET = this.MINER_HEIGHT;
    this.MINER_FOOT_OFFSET = 0.0;

    /** @type {Ship} */
    this.ship = {
      x: 0,
      y: cfg.RMAX + 0.9,
      vx: 0,
      vy: 0,
      state: "flying",
      explodeT: 0,
      lastAir: 1,
      hp: GAME.SHIP_MAX_HP,
      hitCooldown: 0,
    };
    /** @type {Array<{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number}>} */
    this.debris = [];
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    this.playerShots = [];
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    this.playerBombs = [];
    /** @type {Array<{x:number,y:number,life:number,radius?:number}>} */
    this.playerExplosions = [];
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

    this.level = 1;
    /** @type {Miner[]} */
    this.miners = [];
    this.minersRemaining = 0;
    this.minersDead = 0;
    this.minerCandidates = 0;
    this.enemies = new Enemies({ cfg, mapgen, mesh });

    this._spawnMiners();
    this.enemies.spawn(this._totalEnemiesForLevel(this.level), this.level);

    this.lastTime = performance.now();
    this.accumulator = 0;
    this.fpsTime = this.lastTime;
    this.fpsFrames = 0;
    this.fps = 0;
    this.debugCollisions = GAME.DEBUG_COLLISION;
    /** @type {boolean} */
    this.debugCollisions = this.debugCollisions;
  }

  /**
   * @param {number} lvl
   * @returns {number}
   */
  _totalEnemiesForLevel(lvl){
    return (lvl <= 1 ? 0 : 2 * (lvl - 1));
  }

  /**
   * @returns {void}
   */
  _resetShip(){
    const cfg = this.cfg;
    this.ship.x = 0;
    this.ship.y = cfg.RMAX + 0.9;
    this.ship.vx = 0;
    this.ship.vy = 0;
    this.ship.state = "flying";
    this.ship.explodeT = 0;
    this.debris.length = 0;
    this.playerShots.length = 0;
    this.playerBombs.length = 0;
    this.playerExplosions.length = 0;
    this.minerPopups.length = 0;
    this.shipHitPopups.length = 0;
    this.minersDead = 0;
    this.ship.hp = GAME.SHIP_MAX_HP;
    this.ship.hitCooldown = 0;
  }

  /**
   * @returns {void}
   */
  _triggerCrash(){
    if (this.ship.state === "crashed") return;
    this.ship.state = "crashed";
    this.ship.explodeT = 0;
    this.ship.vx = 0; this.ship.vy = 0;
    this.debris.length = 0;
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
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  _damageShip(x, y){
    if (this.ship.state === "crashed") return;
    if (this.ship.hitCooldown > 0) return;
    this.ship.hp = Math.max(0, this.ship.hp - 1);
    this.ship.hitCooldown = GAME.SHIP_HIT_COOLDOWN;
    this.playerExplosions.push({ x, y, life: 0.5, radius: this.SHIP_HIT_BLAST });
    this.shipHitPopups.push({
      x: this.ship.x,
      y: this.ship.y,
      vx: 0,
      vy: 0,
      life: GAME.SHIP_HIT_POPUP_LIFE,
    });
    if (this.ship.hp <= 0){
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
    const camRot = Math.atan2(this.ship.x, this.ship.y || 1e-6);
    const s = GAME.ZOOM / (this.cfg.RMAX + this.cfg.PAD);
    const aspect = w / h;
    const sx = s / aspect;
    const sy = s;
    const px = xN / sx;
    const py = yN / sy;
    const c = Math.cos(-camRot), s2 = Math.sin(-camRot);
    const wx = c * px - s2 * py + this.ship.x;
    const wy = s2 * px + c * py + this.ship.y;
    return { x: wx, y: wy };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  _applyBombImpact(x, y){
    const candidates = [];
    const maxRing = Math.min(this.cfg.RMAX, this.mesh.rings.length - 1);
    for (let r = 0; r <= maxRing; r++){
      const ring = this.mesh.rings[r];
      if (!ring) continue;
      for (const v of ring){
        const dx = v.x - x;
        const dy = v.y - y;
        const d2 = dx * dx + dy * dy;
        candidates.push({ v, d2 });
      }
    }
    candidates.sort((a, b) => a.d2 - b.d2);
    let changed = false;
    for (let i = 0; i < 3 && i < candidates.length; i++){
      const v = candidates[i].v;
      if (v.air <= 0.5){
        v.air = 1;
        changed = true;
      }
    }
    if (changed){
      const newAir = this.mesh.updateAirFlags(false);
      this.renderer.updateAir(newAir);
    }
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
        this.enemies.enemies.splice(j, 1);
      }
    }
    for (let j = this.miners.length - 1; j >= 0; j--){
      const m = this.miners[j];
      if (m.state === "boarded") continue;
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
   * @template T
   * @param {T[]} items
   * @param {() => number} rand
   * @returns {void}
   */
  _shuffle(items, rand){
    for (let i = items.length - 1; i > 0; i--){
      const j = Math.floor(rand() * (i + 1));
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
  }

  /**
   * @param {number} ang
   * @param {number} ringLen
   * @returns {number}
   */
  _angleToRingIndex(ang, ringLen){
    let a = ang % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return Math.round((a / (Math.PI * 2)) * ringLen) % ringLen;
  }

  /**
   * Valid placement rule:
   * - On ring r: three consecutive air points with center at index i.
   * - On ring r-1: the center angle maps to two consecutive rock points (i-1,i+1 around mapped index).
   * @param {() => number} rand
   * @param {number} rMin
   * @param {number} rMax
   * @returns {{x:number,y:number,r:number,key:string}|null}
   */
  _sampleMinerCandidate(rand, rMin, rMax){
    const r = Math.max(rMin, Math.min(rMax, rMin + rand() * (rMax - rMin)));
    const ri = Math.max(2, Math.min(this.cfg.RMAX - 1, Math.round(r)));
    const ring = this.mesh.rings[ri];
    const inner = this.mesh.rings[ri - 1];
    if (!ring || !inner || ring.length < 3 || inner.length < 3) return null;

    const i = Math.floor(rand() * ring.length);
    const i0 = (i - 1 + ring.length) % ring.length;
    const i2 = (i + 1) % ring.length;
    if (ring[i0].air <= 0.5 || ring[i].air <= 0.5 || ring[i2].air <= 0.5) return null;

    const x = ring[i].x;
    const y = ring[i].y;
    const ang = Math.atan2(y, x);
    const j = this._angleToRingIndex(ang, inner.length);
    const j0 = (j - 1 + inner.length) % inner.length;
    const j2 = (j + 1) % inner.length;
    if (inner[j0].air > 0.5 || inner[j].air > 0.5 || inner[j2].air > 0.5) return null;

    const base = inner[j];
    const len = Math.hypot(base.x, base.y) || 1;
    const upx = base.x / len;
    const upy = base.y / len;
    const midX = (base.x + x) * 0.5;
    const midY = (base.y + y) * 0.5;
    const lift = this.MINER_SURFACE_EPS;
    const baseX = midX + upx * lift;
    const baseY = midY + upy * lift;
    return { x: baseX, y: baseY, r: len, key: `${ri},${i}` };
  }

  /**
   * @returns {void}
   */
  _spawnMiners(){
    const count = GAME.MINERS_PER_LEVEL;
    const seed = this.mapgen.getWorld().seed + this.level * 97;
    const rand = mulberry32(seed);
    const rMin = 1.0;
    const rMax = this.cfg.RMAX - 0.8;
    const target = count * 3;
    const attempts = Math.max(200, count * 120);

    /** @type {Array<{x:number,y:number,r:number,key?:string}>} */
    let candidates = [];
    for (let i = 0; i < attempts && candidates.length < target; i++){
      const cand = this._sampleMinerCandidate(rand, rMin, rMax);
      if (cand) candidates.push(cand);
    }

    if (!candidates.length){
      this.miners = [];
      this.minersRemaining = 0;
      this.minersDead = 0;
      this.minerCandidates = 0;
      return;
    }

    if (candidates.length > 1){
      const seen = new Set();
      const deduped = [];
      for (const c of candidates){
        if (seen.has(c.key)) continue;
        seen.add(c.key);
        deduped.push(c);
      }
      candidates = deduped;
    }
    this.minerCandidates = candidates.length;

    this._shuffle(candidates, rand);
    /** @type {Array<{x:number,y:number,r:number,key?:string}>} */
    const placed = [];
    const baseMinSep = GAME.MINER_MIN_SEP;
    /** @type {number} */
    let minSep = baseMinSep;

    const tryFill = () => {
      const minSep2 = minSep * minSep;
      for (const c of candidates){
        if (placed.length >= count) break;
        let ok = true;
        for (const p of placed){
          const dx = c.x - p.x;
          const dy = c.y - p.y;
          if (dx * dx + dy * dy < minSep2){ ok = false; break; }
        }
        if (ok) placed.push(c);
      }
    };

    tryFill();

    if (placed.length < count && candidates.length < count * 2){
      // Only relax spacing if the candidate pool is genuinely small.
      while (placed.length < count && minSep > 0.25){
        minSep = Math.max(0.25, minSep * 0.7);
        tryFill();
      }
    }

    if (placed.length < count){
      // Final fill without spacing; avoid duplicates.
      for (const c of candidates){
        if (placed.length >= count) break;
        let exists = false;
        for (const p of placed){
          if (p === c || (p.x === c.x && p.y === c.y)) { exists = true; break; }
        }
        if (!exists) placed.push(c);
      }
    }

    this.miners = placed.map((p) => ({ x: p.x, y: p.y, state: "idle" }));
    this.minersRemaining = this.miners.length;
    this.minersDead = 0;
  }

  /**
   * @param {number} seed
   * @param {boolean} advanceLevel
   * @returns {void}
   */
  _beginLevel(seed, advanceLevel){
    this.mapgen.regenWorld(seed);
    const newAir = this.mesh.updateAirFlags();
    this.renderer.updateAir(newAir);
    this._resetShip();
    this.playerExplosions.length = 0;
    if (advanceLevel) this.level++;
    this._spawnMiners();
    this.enemies.spawn(this._totalEnemiesForLevel(this.level), this.level);
    this.minerPopups.length = 0;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Array<[number, number]>}
   */
  _shipCollisionPoints(x, y){
    const camRot = Math.atan2(x, y || 1e-6);
    const shipRot = -camRot;
    const shipHWorld = 0.7 * GAME.SHIP_SCALE;
    const shipWWorld = 0.5 * GAME.SHIP_SCALE;
    const nose = shipHWorld * 0.6;
    const tail = shipHWorld * 0.4;
    /** @type {Array<[number, number]>} */
    const local = [
      [0, nose],
      [shipWWorld * 0.6, -tail],
      [-shipWWorld * 0.6, -tail],
    ];
    /** @type {Array<[number, number]>} */
    const verts = [];
    const c = Math.cos(shipRot), s = Math.sin(shipRot);
    for (const [lx, ly] of local){
      const wx = c * lx - s * ly;
      const wy = s * lx + c * ly;
      verts.push([x + wx, y + wy]);
    }
    return [
      verts[0], verts[1], verts[2],
      [(verts[0][0] + verts[1][0]) * 0.5, (verts[0][1] + verts[1][1]) * 0.5],
      [(verts[1][0] + verts[2][0]) * 0.5, (verts[1][1] + verts[2][1]) * 0.5],
      [(verts[2][0] + verts[0][0]) * 0.5, (verts[2][1] + verts[0][1]) * 0.5],
    ];
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
    const shipHWorld = 0.7 * GAME.SHIP_SCALE;
    const shipWWorld = 0.5 * GAME.SHIP_SCALE;
    const nose = shipHWorld * 0.6;
    const tail = shipHWorld * 0.4;
    const local = [
      [0, nose],
      [shipWWorld * 0.6, -tail],
      [0, -tail * 0.6],
      [-shipWWorld * 0.6, -tail],
    ];
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

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} shipRadius
   * @returns {boolean}
   */
  _shipCollidesAt(x, y, shipRadius){
    const rCenter = Math.hypot(x, y);
    if (rCenter - shipRadius > this.TERRAIN_MAX) return false;
    const samples = this._shipCollisionPoints(x, y);
    samples.push([x, y]);
    return collidesAtWorldPoints(this.mesh, samples);
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
    return collidesAtWorldPoints(this.mesh, [
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
    const { left, right, thrust, down, reset, shoot, bomb, aim, aimShoot, aimBomb, aimShootFrom, aimShootTo, aimBombFrom, aimBombTo } = inputState;
    if (reset) this._resetShip();
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
        const aimLen = 4.0;
        aimWorld = { x: this.ship.x + dirx * aimLen, y: this.ship.y + diry * aimLen };
      }
    }
    this.lastAimWorld = aimWorld;
    if (inputState.aim) this.lastAimScreen = inputState.aim;

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

      if (left){
        ax += tx * GAME.THRUST;
        ay += ty * GAME.THRUST;
      }
      if (right){
        ax -= tx * GAME.THRUST;
        ay -= ty * GAME.THRUST;
      }
      if (thrust){
        ax += rx * GAME.THRUST;
        ay += ry * GAME.THRUST;
      }
      if (down){
        ax += -rx * GAME.THRUST;
        ay += -ry * GAME.THRUST;
      }

      ax += -this.ship.x / r * GAME.GRAVITY;
      ay += -this.ship.y / r * GAME.GRAVITY;

      this.ship.vx += ax * dt;
      this.ship.vy += ay * dt;

      const drag = Math.max(0, 1 - GAME.DRAG * dt);
      this.ship.vx *= drag;
      this.ship.vy *= drag;

      const vt = this.ship.vx * tx + this.ship.vy * ty;
      const vtMax = GAME.MAX_TANGENTIAL_SPEED;
      if (Math.abs(vt) > vtMax){
        const excess = vt - Math.sign(vt) * vtMax;
        this.ship.vx -= tx * excess;
        this.ship.vy -= ty * excess;
      }

      this.ship.x += this.ship.vx * dt;
      this.ship.y += this.ship.vy * dt;

      const speed = Math.hypot(this.ship.vx, this.ship.vy);
      const eps = this.COLLISION_EPS;
      const shipRadius = this.SHIP_RADIUS;

      let collides = false;
      /** @type {Array<[number, number, boolean, number]>} */
      const samples = [];
      let hit = null;
      const rCenter = Math.hypot(this.ship.x, this.ship.y);
      if (rCenter - shipRadius <= this.TERRAIN_MAX){
        for (const [sx, sy] of this._shipCollisionPoints(this.ship.x, this.ship.y)){
          const av = this.mesh.airValueAtWorld(sx, sy);
          const air = av > 0.5;
          samples.push([sx, sy, air, av]);
          if (!air) {
            collides = true;
            if (!hit) hit = { x: sx, y: sy };
          }
        }
      }
      this.ship._samples = samples;
      this.ship._shipRadius = shipRadius;
      if (hit){
        this.ship._collision = {
          x: hit.x,
          y: hit.y,
          tri: this.mesh.findTriAtWorld(hit.x, hit.y),
          node: this.mesh.nearestNodeOnRing(hit.x, hit.y),
        };
      } else {
        this.ship._collision = null;
      }

      if (collides){
        const gdx = this.mesh.airValueAtWorld(this.ship.x + eps, this.ship.y) - this.mesh.airValueAtWorld(this.ship.x - eps, this.ship.y);
        const gdy = this.mesh.airValueAtWorld(this.ship.x, this.ship.y + eps) - this.mesh.airValueAtWorld(this.ship.x, this.ship.y - eps);
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
        const camRot = Math.atan2(this.ship.x, this.ship.y || 1e-6);
        const upx = Math.sin(camRot);
        const upy = Math.cos(camRot);
        const dotUp = nx * upx + ny * upy;
        const vn = this.ship.vx * nx + this.ship.vy * ny;
        const impactSpeed = Math.max(0, -vn);
        const resolvePenetration = () => {
          const maxSteps = 8;
          const stepSize = shipRadius * 0.2;
          for (let i = 0; i < maxSteps; i++){
            if (!this._shipCollidesAt(this.ship.x, this.ship.y, shipRadius)) break;
            this.ship.x += nx * stepSize;
            this.ship.y += ny * stepSize;
          }
        };

        if (impactSpeed <= GAME.LAND_SPEED && vn < -0.05 && dotUp >= GAME.SURFACE_DOT){
          this.ship.state = "landed";
          this.ship.vx = 0; this.ship.vy = 0;
          resolvePenetration();
        } else if (impactSpeed >= GAME.CRASH_SPEED){
          this._triggerCrash();
        } else {
          if (impactSpeed <= GAME.LAND_SPEED && vn < -0.05 && dotUp >= GAME.SURFACE_DOT){
            this.ship.vx -= nx * GAME.LAND_PULL * dt;
            this.ship.vy -= ny * GAME.LAND_PULL * dt;
            const tx = -ny;
            const ty = nx;
            const vt = this.ship.vx * tx + this.ship.vy * ty;
            this.ship.vx -= vt * tx * GAME.LAND_FRICTION * dt;
            this.ship.vy -= vt * ty * GAME.LAND_FRICTION * dt;
            resolvePenetration();
          } else if (vn < 0){
            const restitution = GAME.BOUNCE_RESTITUTION;
            this.ship.vx -= (1 + restitution) * vn * nx;
            this.ship.vy -= (1 + restitution) * vn * ny;
            const fast = speed >= (GAME.LAND_SPEED * 1.2);
            const push = shipRadius * (fast ? GAME.COLLIDE_PUSH_FAST : 0.02);
            this.ship.x += nx * push;
            this.ship.y += ny * push;
            resolvePenetration();
          }
        }
      }
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
          const dx = aimWorldShoot.x - this.ship.x;
          const dy = aimWorldShoot.y - this.ship.y;
          const dist = Math.hypot(dx, dy) || 1;
          dirx = dx / dist;
          diry = dy / dist;
        }
        if (dirx || diry){
          this.playerShots.push({
            x: this.ship.x + dirx * 0.45,
            y: this.ship.y + diry * 0.45,
            vx: dirx * this.PLAYER_SHOT_SPEED,
            vy: diry * this.PLAYER_SHOT_SPEED,
            life: this.PLAYER_SHOT_LIFE,
          });
        }
      }
      if (bomb){
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
          const dx = aimWorldBomb.x - this.ship.x;
          const dy = aimWorldBomb.y - this.ship.y;
          const dist = Math.hypot(dx, dy) || 1;
          dirx = dx / dist;
          diry = dy / dist;
        }
        if (dirx || diry){
          this.playerBombs.push({
            x: this.ship.x + dirx * 0.45,
            y: this.ship.y + diry * 0.45,
            vx: dirx * this.PLAYER_BOMB_SPEED,
            vy: diry * this.PLAYER_BOMB_SPEED,
            life: this.PLAYER_BOMB_LIFE,
          });
        }
      }
    }

    if (this.playerShots.length){
      for (let i = this.playerShots.length - 1; i >= 0; i--){
        const s = this.playerShots[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0 || this.mesh.airValueAtWorld(s.x, s.y) <= 0.5){
          this.playerShots.splice(i, 1);
          continue;
        }
        for (let j = this.enemies.enemies.length - 1; j >= 0; j--){
          const e = this.enemies.enemies[j];
          const dx = e.x - s.x;
          const dy = e.y - s.y;
          if (dx * dx + dy * dy <= this.PLAYER_SHOT_RADIUS * this.PLAYER_SHOT_RADIUS){
            e.hp -= 1;
            this.playerShots.splice(i, 1);
            if (e.hp <= 0) this.enemies.enemies.splice(j, 1);
            break;
          }
        }
        if (i >= this.playerShots.length) continue;
        for (let j = this.miners.length - 1; j >= 0; j--){
          const m = this.miners[j];
          if (m.state === "boarded") continue;
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
        if (b.life <= 0 || this.mesh.airValueAtWorld(b.x, b.y) <= 0.5){
          hit = true;
        } else {
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
              if (m.state === "boarded") continue;
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
          this._applyBombImpact(b.x, b.y);
          this._applyBombDamage(b.x, b.y);
          this.playerExplosions.push({ x: b.x, y: b.y, life: 0.8, radius: this.PLAYER_BOMB_BLAST });
        }
      }
    }

    if (this.playerExplosions.length){
      for (let i = this.playerExplosions.length - 1; i >= 0; i--){
        this.playerExplosions[i].life -= dt;
        if (this.playerExplosions[i].life <= 0) this.playerExplosions.splice(i, 1);
      }
    }

    if (this.miners.length){
      const landed = this.ship.state === "landed";
      for (const miner of this.miners){
        if (miner.state === "boarded") continue;
        const dx = this.ship.x - miner.x;
        const dy = this.ship.y - miner.y;
        const dist = Math.hypot(dx, dy);

        if (landed && dist <= GAME.MINER_CALL_RADIUS){
          miner.state = "running";
        } else if (!landed && miner.state === "running"){
          miner.state = "idle";
        }

        if (landed && miner.state === "running"){
          const speed = GAME.MINER_RUN_SPEED;
          const stepLen = speed * dt;
          const inv = 1 / (dist || 1);
          const dirx = dx * inv;
          const diry = dy * inv;

          /**
           * @param {number} tx
           * @param {number} ty
           */
          const tryMove = (tx, ty) => {
            const nx = miner.x + tx * stepLen;
            const ny = miner.y + ty * stepLen;
            if (!this._minerCollidesAt(nx, ny)){
              miner.x = nx;
              miner.y = ny;
              return true;
            }
            return false;
          };

          if (!tryMove(dirx, diry)){
            const r = Math.hypot(miner.x, miner.y) || 1;
            const upx = miner.x / r;
            const upy = miner.y / r;
            const dotUp = dirx * upx + diry * upy;
            const tx = dirx - upx * dotUp;
            const ty = diry - upy * dotUp;
            const tlen = Math.hypot(tx, ty);
            if (tlen > 1e-4){
              const tnx = tx / tlen;
              const tny = ty / tlen;
              if (!tryMove(tnx, tny)){
                tryMove(-tnx, -tny);
              }
            }
          }
        }

        const r = Math.hypot(miner.x, miner.y) || 1;
        const upx = miner.x / r;
        const upy = miner.y / r;
        const headX = miner.x + upx * this.MINER_HEAD_OFFSET;
        const headY = miner.y + upy * this.MINER_HEAD_OFFSET;
        const hullDist = this._shipHullDistance(headX, headY, this.ship.x, this.ship.y);
        if (landed && hullDist <= GAME.MINER_BOARD_RADIUS){
          miner.state = "boarded";
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
        }
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
        d.vx += (-d.x / r) * GAME.GRAVITY * dt;
        d.vy += (-d.y / r) * GAME.GRAVITY * dt;
        d.vx *= Math.max(0, 1 - GAME.DRAG * dt);
        d.vy *= Math.max(0, 1 - GAME.DRAG * dt);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.a += d.w * dt;
        d.life -= dt;
        if (d.life <= 0) this.debris.splice(i, 1);
      }
    }

    this.enemies.update(this.ship, dt);

    if (this.ship.state !== "crashed"){
      for (let i = this.enemies.shots.length - 1; i >= 0; i--){
        const s = this.enemies.shots[i];
        const dx = this.ship.x - s.x;
        const dy = this.ship.y - s.y;
        if (dx * dx + dy * dy <= this.SHIP_RADIUS * this.SHIP_RADIUS){
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

    const inputState = this.input.update();

    if (this.ship.state === "crashed"){
      this.ship.explodeT = Math.min(1.2, this.ship.explodeT + dt * 0.9);
    }

    if (inputState.regen){
      const nextSeed = this.mapgen.getWorld().seed + 1;
      this._beginLevel(nextSeed, false);
    }
    if (inputState.nextLevel){
      const nextSeed = this.mapgen.getWorld().seed + 1;
      this._beginLevel(nextSeed, true);
    }

    if (inputState.toggleDebug){
      this.debugCollisions = !this.debugCollisions;
    }

    const fixed = 1 / 60;
    const maxSteps = 4;
    let steps = 0;
    while (this.accumulator >= fixed && steps < maxSteps){
      this._step(fixed, inputState);
      this.accumulator -= fixed;
      steps++;
    }

    if (this.minersRemaining === 0 && this.ship.state === "flying"){
      const r = Math.hypot(this.ship.x, this.ship.y);
      if (r > this.cfg.RMAX + GAME.EXIT_MARGIN){
        const nextSeed = this.mapgen.getWorld().seed + 1;
        this._beginLevel(nextSeed, true);
      }
    }

    this.fpsFrames++;
    if (now - this.fpsTime >= 500){
      this.fps = Math.round((this.fpsFrames * 1000) / (now - this.fpsTime));
      this.fpsFrames = 0;
      this.fpsTime = now;
    }

    this.renderer.drawFrame({
      ship: this.ship,
      debris: this.debris,
      input: inputState,
      debugCollisions: this.debugCollisions,
      debugNodes: GAME.DEBUG_NODES,
      fps: this.fps,
      finalAir: this.mapgen.getWorld().finalAir,
      miners: this.miners,
      minersRemaining: this.minersRemaining,
      level: this.level,
      minersDead: this.minersDead,
      enemies: this.enemies.enemies,
      shots: this.enemies.shots,
      explosions: this.enemies.explosions,
      enemyDebris: this.enemies.debris,
      playerShots: this.playerShots,
      playerBombs: this.playerBombs,
      playerExplosions: this.playerExplosions,
      aimWorld: this.lastAimWorld,
      touchUi: inputState.touchUi,
    }, this.mesh);

    this._drawMinerPopups();

    this.ui.updateHud(this.hud, {
      fps: this.fps,
      state: this.ship.state,
      speed: Math.hypot(this.ship.vx, this.ship.vy),
      shipHp: this.ship.hp,
      verts: this.mesh.vertCount,
      air: this.mapgen.getWorld().finalAir,
      miners: this.minersRemaining,
      minersDead: this.minersDead,
      level: this.level,
      debug: this.debugCollisions,
      minerCandidates: this.minerCandidates,
    });

    requestAnimationFrame(() => this._frame());
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
    if (!this.minerPopups.length && !this.shipHitPopups.length && !this.lastAimScreen){
      return;
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `700 ${Math.max(12, Math.round(16 * dpr))}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
    const camRot = Math.atan2(this.ship.x, this.ship.y || 1e-6);
    const s = GAME.ZOOM / (this.cfg.RMAX + this.cfg.PAD);
    const sx = s / (w / h);
    const sy = s;
    const c = Math.cos(camRot), s2 = Math.sin(camRot);

    for (const p of this.minerPopups){
      const t = Math.max(0, Math.min(1, p.life / GAME.MINER_POPUP_LIFE));
      const alpha = 0.9 * t;
      const dx = p.x - this.ship.x;
      const dy = p.y - this.ship.y;
      const rx = c * dx - s2 * dy;
      const ry = s2 * dx + c * dy;
      const px = (rx * sx * 0.5 + 0.5) * w;
      const py = (1 - (ry * sy * 0.5 + 0.5)) * h;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255, 236, 170, 1)";
      ctx.fillText("+1", px, py);
    }
    for (const p of this.shipHitPopups){
      const t = Math.max(0, Math.min(1, p.life / GAME.SHIP_HIT_POPUP_LIFE));
      const alpha = 0.9 * t;
      const dx = p.x - this.ship.x;
      const dy = p.y - this.ship.y;
      const rx = c * dx - s2 * dy;
      const ry = s2 * dx + c * dy;
      const px = (rx * sx * 0.5 + 0.5) * w;
      const py = (1 - (ry * sy * 0.5 + 0.5)) * h;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255, 80, 80, 1)";
      ctx.fillText("-1", px, py);
    }

    if (this.lastAimScreen){
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
    ctx.globalAlpha = 1;
  }
}
