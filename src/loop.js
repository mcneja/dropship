// @ts-check

import { GAME } from "./config.js";
import { mulberry32 } from "./rng.js";
import { Enemies } from "./enemies.js";
import { createCollisionRouter } from "./collision-router.js";
import { CFG } from './config.js';
import { Mothership, updateMothership, mothershipCollisionInfo } from "./mothership.js";

/** @typedef {import("./types.d.js").ViewState} ViewState */
/** @typedef {import("./types.d.js").Ship} Ship */
/** @typedef {import("./types.d.js").Miner} Miner */
/** @typedef {import("./types.d.js").Ui} Ui */

export class GameLoop {
  /**
   * Main gameplay loop orchestrator.
   * @param {Object} deps
   * @param {typeof import("./config.js").CFG} deps.cfg
   * @param {import("./mapgen.js").MapGen} deps.mapgen
   * @param {import("./planet.js").Planet} deps.planet
   * @param {import("./rendering.js").Renderer} deps.renderer
   * @param {import("./input.js").Input} deps.input
   * @param {Ui} deps.ui
   * @param {HTMLCanvasElement} deps.canvas
   * @param {HTMLCanvasElement|null|undefined} deps.overlay
   * @param {HTMLElement} deps.hud
   */
  constructor({ cfg, mapgen, planet, renderer, input, ui, canvas, hud, overlay }){
    this.cfg = cfg;
    this.mapgen = mapgen;
    this.planet = planet;
    this.radial = planet.radial;
    this.renderer = renderer;
    this.input = input;
    this.ui = ui;
    this.canvas = canvas;
    this.hud = hud;
    this.overlay = overlay || null;
    this.overlayCtx = this.overlay ? this.overlay.getContext("2d") : null;

    this.TERRAIN_PAD = 0.5;
    this.TERRAIN_MAX = cfg.RMAX + this.TERRAIN_PAD;
    this.TERRAIN_IMPACT_RADIUS = 0.6;
    this.SHIP_RADIUS = 0.7 * 0.28 * GAME.SHIP_SCALE;
    this.MINER_HEIGHT = 0.36 * GAME.MINER_SCALE;
    this.MINER_SURFACE_EPS = 0.01 * GAME.MINER_SCALE;
    this.SURFACE_EPS = Math.max(0.12, cfg.RMAX / 280);
    this.COLLISION_EPS = Math.max(0.18, cfg.RMAX / 240);
    this.MINER_HEAD_OFFSET = this.MINER_HEIGHT;
    this.MINER_FOOT_OFFSET = 0.0;

    const mothership = new Mothership(cfg, planet);

    /** @type {Ship} */
    this.ship = {
      x: mothership.x,
      y: mothership.y,
      vx: mothership.vx,
      vy: mothership.vy,
      state: "flying",
      explodeT: 0,
      lastAir: 1,
      hp: GAME.SHIP_MAX_HP,
      hitCooldown: 0,
      guidePath: null,
    };
    this.ship._dock = null;
    this.mothership = mothership;
    /** @type {Array<{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number}>} */
    this.debris = [];
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    this.playerShots = [];
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    this.playerBombs = [];
    /** @type {Array<{x:number,y:number,life:number,radius?:number}>} */
    this.entityExplosions = [];
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
    this.ENEMY_HIT_BLAST = 0.35;

    this.level = 1;
    /** @type {Miner[]} */
    this.miners = [];
    this.minersRemaining = 0;
    this.minersDead = 0;
    this.minerCandidates = 0;
    /** @type {import("./types.d.js").CollisionQuery} */
    this.collision = createCollisionRouter(this.planet, () => this.mothership);
    this.enemies = new Enemies({
      cfg,
      mapgen,
      planet,
      collision: this.collision,
    });

    this._spawnMiners();
    this.enemies.spawn(this._totalEnemiesForLevel(this.level), this.level);

    this.lastTime = performance.now();
    this.accumulator = 0;
    this.fpsTime = this.lastTime;
    this.fpsFrames = 0;
    this.fps = 0;
    this.debugCollisions = GAME.DEBUG_COLLISION;
  }

  /**
   * @param {number} lvl
   * @returns {number}
   */
  _totalEnemiesForLevel(lvl){
    return 30;//(lvl <= 1 ? 0 : 2 * (lvl - 1));
  }

  /**
   * @returns {void}
   */
  _resetShip(){
    this.ship.x = this.mothership.x;
    this.ship.y = this.mothership.y;
    this.ship.vx = this.mothership.vx;
    this.ship.vy = this.mothership.vy;
    this.ship.state = "flying";
    this.ship.explodeT = 0;
    this.ship.hp = GAME.SHIP_MAX_HP;
    this.ship.hitCooldown = 0;
    this.ship._dock = null;
    this.debris.length = 0;
    this.playerShots.length = 0;
    this.playerBombs.length = 0;
    this.entityExplosions.length = 0;
    this.minerPopups.length = 0;
    this.shipHitPopups.length = 0;
    this.minersDead = 0;
    this.lastAimWorld = null;
    this.lastAimScreen = null;
  }

  /**
   * @returns {void}
   */
  _triggerCrash(){
    if (this.ship.state === "crashed") return;
    this.ship.state = "crashed";
    this.ship.explodeT = 0;
    this.lastAimWorld = null;
    this.lastAimScreen = null;
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
    this.entityExplosions.push({ x, y, life: 0.5, radius: this.SHIP_HIT_BLAST });
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
    const viewState = this._viewState();
    const camRot = viewState.angle;
    const s = 1 / viewState.radius;
    const aspect = w / h;
    const sx = s / aspect;
    const sy = s;
    const px = xN / sx;
    const py = yN / sy;
    const c = Math.cos(-camRot), s2 = Math.sin(-camRot);
    const wx = c * px - s2 * py + viewState.xCenter;
    const wy = s2 * px + c * py + viewState.yCenter;
    return { x: wx, y: wy };
  }

  /**
   * @param {number} aspect
   * @returns {{xCenter:number,yCenter:number,c:number,s:number,sx:number,sy:number}}
   */
  _screenTransform(aspect){
    const viewState = this._viewState();
    const camRot = viewState.angle;
    const s = 1 / viewState.radius;
    return {
      xCenter: viewState.xCenter,
      yCenter: viewState.yCenter,
      c: Math.cos(camRot),
      s: Math.sin(camRot),
      sx: s / aspect,
      sy: s,
    };
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {{xCenter:number,yCenter:number,c:number,s:number,sx:number,sy:number}} t
   * @returns {{x:number,y:number}}
   */
  _worldToScreenNorm(x, y, t){
    const dx = x - t.xCenter;
    const dy = y - t.yCenter;
    const rx = t.c * dx - t.s * dy;
    const ry = t.s * dx + t.c * dy;
    return {
      x: rx * t.sx * 0.5 + 0.5,
      y: 0.5 - ry * t.sy * 0.5,
    };
  }

  /**
   * @param {{x:number,y:number}|null|undefined} aim
   * @returns {{x:number,y:number}|null}
   */
  _aimScreenAroundShip(aim){
    if (!aim) return null;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const aspect = w / h;
    const t = this._screenTransform(aspect);
    const ship = this._worldToScreenNorm(this.ship.x, this.ship.y, t);
    const ox = aim.x - 0.5;
    const oy = aim.y - 0.5;
    return {
      x: ship.x + ox,
      y: ship.y + oy,
    };
  }

  /**
   * @param {number} screenFrac
   * @returns {number}
   */
  _aimWorldDistance(screenFrac){
    const s = GAME.ZOOM / (this.cfg.RMAX + this.cfg.PAD);
    return (2 * screenFrac) / s;
  }

  /**
   * @returns {ViewState}
   */
  _viewState() {
    const radiusViewMin = GAME.ZOOM;
    const rShip = Math.hypot(this.ship.x, this.ship.y);
    const rPlanet = CFG.RMAX + CFG.PAD;

    let uTransition = Math.max(0, Math.min(1, (rShip - rPlanet) / rPlanet));
    uTransition = (3.0 - 2.0 * uTransition) * uTransition * uTransition;
    const rFramedMin = (rShip - radiusViewMin) + (-rPlanet - (rShip - radiusViewMin)) * uTransition;
    const rFramedMax = rShip + radiusViewMin;

    const rViewCenter = (rFramedMin + rFramedMax) / 2;

    const scale = rViewCenter / rShip;
    const posViewCenterX = scale * this.ship.x;
    const posViewCenterY = scale * this.ship.y;
    const radiusView = (rFramedMax - rFramedMin) / 2;

    const view = {
      xCenter: posViewCenterX,
      yCenter: posViewCenterY,
      radius: radiusView,
      angle: Math.atan2(this.ship.x, this.ship.y || 1e-6)
    };
    if (this.mothership){
      const dx = this.ship.x - this.mothership.x;
      const dy = this.ship.y - this.mothership.y;
      const d = Math.hypot(dx, dy);
      const t = Math.max(0, Math.min(1, (12 - d) / 8));
      view.xCenter = view.xCenter * (1 - t) + this.ship.x * t;
      view.yCenter = view.yCenter * (1 - t) + this.ship.y * t;
      view.radius = radiusView * (1 - t) + radiusViewMin * t;
    }
    return view;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {void}
   */
  _applyBombImpact(x, y){
    const newAir = this.planet.applyAirEdit(x, y, this.TERRAIN_IMPACT_RADIUS, 1);
    this._syncPlanetRender(newAir);
  }

  /**
   * @param {Float32Array|undefined|null} newAir
   * @returns {void}
   */
  _syncPlanetRender(newAir){
    if (this.planet.mode === "radial"){
      if (newAir) this.renderer.updateAir(newAir);
    } else {
      this.planet.syncRenderResources(this.renderer);
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
        e.hp = 0;
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
    const ring = this.radial.rings[ri];
    const inner = this.radial.rings[ri - 1];
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

    /** @type {Array<Miner>} */
    const nudged = [];
    let dead = 0;
    for (const p of placed){
      const res = this.planet.nudgeOutOfTerrain(p.x, p.y);
      if (!res.ok){
        dead++;
        continue;
      }
      nudged.push({ x: res.x, y: res.y, jumpCycle: Math.random(), state: "idle" });
    }
    this.miners = nudged;
    this.minersRemaining = this.miners.length;
    this.minersDead = dead;
  }

  /**
   * @param {number} seed
   * @param {boolean} advanceLevel
   * @returns {void}
   */
  _beginLevel(seed, advanceLevel){
    this.mapgen.regenWorld(seed);
    const newAir = this.planet.regenFromMap();
    this._syncPlanetRender(newAir);
    this.radial.resetFog();
    this._resetShip();
    this.entityExplosions.length = 0;
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
    /** @type {Array<[number, number]>} */
    const samples = [
      verts[0], verts[1], verts[2],
      [(verts[0][0] + verts[1][0]) * 0.5, (verts[0][1] + verts[1][1]) * 0.5],
      [(verts[1][0] + verts[2][0]) * 0.5, (verts[1][1] + verts[2][1]) * 0.5],
      [(verts[2][0] + verts[0][0]) * 0.5, (verts[2][1] + verts[0][1]) * 0.5],
    ];
    return samples;
  }

  /**
   * Nudge miners out of terrain after mode changes; kill if deeply buried.
   * @returns {void}
   */
  _nudgeMinersFromTerrain(){
    for (let i = this.miners.length - 1; i >= 0; i--){
      const m = this.miners[i];
      if (m.state === "boarded") continue;
      const res = this.planet.nudgeOutOfTerrain(m.x, m.y);
      if (!res.ok){
        this.miners.splice(i, 1);
        this.minersRemaining = Math.max(0, this.minersRemaining - 1);
        this.minersDead++;
        continue;
      }
      m.x = res.x;
      m.y = res.y;
    }
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
    const samples = this._shipCollisionPoints(x, y);
    samples.push([x, y]);
    return this.collision.collidesAtPoints(samples);
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
    return this.collision.collidesAtPoints([
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
    const prevShipX = this.ship.x;
    const prevShipY = this.ship.y;
    if (this.mothership){
      updateMothership(this.mothership, this.planet, dt);
    }
    let { left, right, thrust, down, reset, shoot, bomb, aim, aimShoot, aimBomb, aimShootFrom, aimShootTo, aimBombFrom, aimBombTo } = inputState;
    if (inputState.inputType === "gamepad"){
      const aimAdjusted = this._aimScreenAroundShip(aim);
      aim = aimAdjusted;
      aimShoot = aimAdjusted;
      aimBomb = aimAdjusted;
    }
    if (reset) this._resetShip();

    if (this.ship.state === "landed" && this.ship._dock && this.mothership){
      if (left || right || thrust){
        const pushStep = this.SHIP_RADIUS * 0.35;
        for (let i = 0; i < 8 && this._shipCollidesAt(this.ship.x, this.ship.y, this.SHIP_RADIUS); i++){
          const info = mothershipCollisionInfo(this.mothership, this.ship.x, this.ship.y);
          if (!info) break;
          this.ship.x += info.nx * pushStep;
          this.ship.y += info.ny * pushStep;
        }
        // Nudge outward so takeoff doesn't scrape the surface.
        const info = mothershipCollisionInfo(this.mothership, this.ship.x, this.ship.y);
        if (info){
          const lift = this.SHIP_RADIUS * 0.25;
          this.ship.x += info.nx * lift;
          this.ship.y += info.ny * lift;
          this.ship.vx += info.nx * 0.05;
          this.ship.vy += info.ny * 0.05;
        }
        this.ship.state = "flying";
        this.ship._dock = null;
      } else {
        const { lx, ly } = this.ship._dock;
        const c = Math.cos(this.mothership.angle);
        const s = Math.sin(this.mothership.angle);
        this.ship.x = this.mothership.x + c * lx - s * ly;
        this.ship.y = this.mothership.y + s * lx + c * ly;
        this.ship.vx = this.mothership.vx;
        this.ship.vy = this.mothership.vy;
        this.lastAimWorld = null;
        this.lastAimScreen = null;
        // Stay locked to the mothership; skip gravity/collision integration.
        this.enemies.update(this.ship, dt);
        return;
      }
    }

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
      /*
      const aThrustSqr = ax*ax + ay*ay;
      if (aThrustSqr > GAME.THRUST*GAME.THRUST) {
        const thrustScale = GAME.THRUST / Math.sqrt(aThrustSqr);
        ax *= thrustScale;
        ay *= thrustScale;
      }
      */

      const {x: gx, y: gy} = this.planet.gravityAt(this.ship.x, this.ship.y);

      this.ship.x += (this.ship.vx + 0.5 * (ax + gx) * dt) * dt;
      this.ship.y += (this.ship.vy + 0.5 * (ay + gy) * dt) * dt;

      const {x: gx2, y: gy2} = this.planet.gravityAt(this.ship.x, this.ship.y);

      this.ship.vx += (ax + (gx + gx2) / 2) * dt;
      this.ship.vy += (ay + (gy + gy2) / 2) * dt;

      /*
      const drag = Math.max(0, 1 - GAME.DRAG * dt);
      this.ship.vx *= drag;
      this.ship.vy *= drag;
      */

      /*
      const vt = this.ship.vx * tx + this.ship.vy * ty;
      const vtMax = GAME.MAX_TANGENTIAL_SPEED;
      if (Math.abs(vt) > vtMax){
        const excess = vt - Math.sign(vt) * vtMax;
        this.ship.vx -= tx * excess;
        this.ship.vy -= ty * excess;
      }
      */

      const speed = Math.hypot(this.ship.vx, this.ship.vy);
      const eps = this.COLLISION_EPS;
      const shipRadius = this.SHIP_RADIUS;
      const rCenter = Math.hypot(this.ship.x, this.ship.y);
      const nearTerrain = (rCenter - shipRadius <= this.TERRAIN_MAX);

      let collides = false;
      let { samples, hit, hitSource } = this.collision.sampleCollisionPoints(this._shipCollisionPoints(this.ship.x, this.ship.y));
      collides = !!hit;
      this.ship._samples = samples;
      this.ship._shipRadius = shipRadius;
      if (hit){
        this.ship._collision = {
          x: hit.x,
          y: hit.y,
          tri: this.radial.findTriAtWorld(hit.x, hit.y),
          node: this.radial.nearestNodeOnRing(hit.x, hit.y),
        };
      } else {
        this.ship._collision = null;
      }

      if (collides){
        const mothershipHit = (hitSource === "mothership" && this.mothership);
        if (!mothershipHit){
          // Planet collision: keep original simple response to avoid sticking.
          const gdx = this.planet.airValueAtWorld(this.ship.x + eps, this.ship.y)
            - this.planet.airValueAtWorld(this.ship.x - eps, this.ship.y);
          const gdy = this.planet.airValueAtWorld(this.ship.x, this.ship.y + eps)
            - this.planet.airValueAtWorld(this.ship.x, this.ship.y - eps);
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
          const dotUp = (nx * this.ship.x + ny * this.ship.y) / (Math.hypot(this.ship.x, this.ship.y) || 1);
          const vn = this.ship.vx * nx + this.ship.vy * ny;
          const vt = this.ship.vx * -ny + this.ship.vy * nx;

          if (vn < -GAME.CRASH_SPEED) {
            const restitution = -vn;
            this.ship.vx += restitution * nx;
            this.ship.vy += restitution * ny;
            this._triggerCrash();
          } else {
            if (vn < 0) {
              const maxSlope = 1 - Math.cos(Math.PI / 8); // 22.5 deg
              const landSlope = Math.min((1 - GAME.SURFACE_DOT) + 0.03, maxSlope);
              const clearance = (this.ship._shipRadius || 0.25);
              if (dotUp < 0 || !this.planet.isLandableAtWorld(this.ship.x, this.ship.y, landSlope, clearance, 0.2)) {
                const restitution = (1 + GAME.BOUNCE_RESTITUTION) * -vn;
                this.ship.vx += restitution * nx;
                this.ship.vy += restitution * ny;
              } else if (vn >= -GAME.LAND_SPEED && Math.abs(vt) < 0.5){
                this.ship.state = "landed";
                this.ship.vx = 0;
                this.ship.vy = 0;
              } else {
                const restitution = -vn;
                this.ship.vx += restitution * nx;
                this.ship.vy += restitution * ny;
                const friction = GAME.LAND_FRICTION * -vt;
                this.ship.vx += friction * -ny;
                this.ship.vy += friction * nx;
              }
            }

            const maxSteps = 8;
            const stepSize = shipRadius * 0.2;
            for (let i = 0; i < maxSteps && this._shipCollidesAt(this.ship.x, this.ship.y, shipRadius); i++){
              this.ship.x += nx * stepSize;
              this.ship.y += ny * stepSize;
            }
          }
        } else {
          // Mothership collision: field-based handling (same gradient approach as planet).
          const gdx = this.collision.airValueAtWorld(this.ship.x + eps, this.ship.y)
            - this.collision.airValueAtWorld(this.ship.x - eps, this.ship.y);
          const gdy = this.collision.airValueAtWorld(this.ship.x, this.ship.y + eps)
            - this.collision.airValueAtWorld(this.ship.x, this.ship.y - eps);
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

          const baseVx = this.mothership.vx;
          const baseVy = this.mothership.vy;
          let relVx = this.ship.vx - baseVx;
          let relVy = this.ship.vy - baseVy;
          const vn = relVx * nx + relVy * ny;
          const vt = relVx * -ny + relVy * nx;

          if (vn < -GAME.CRASH_SPEED) {
            this._triggerCrash();
          } else {
            let landedNow = false;
            if (vn < 0) {
              const maxSlope = 1 - Math.cos(Math.PI / 8); // 22.5 deg
              const landSlope = Math.min((1 - GAME.SURFACE_DOT) + 0.03, maxSlope);
              const cUp = Math.cos(this.mothership.angle);
              const sUp = Math.sin(this.mothership.angle);
              const upx = -sUp;
              const upy = cUp;
              const dotUpRaw = nx * upx + ny * upy;
              const slope = 1 - Math.abs(dotUpRaw);
              const landable = (dotUpRaw < 0 && slope <= landSlope);
              const landVn = GAME.LAND_SPEED * 3.0;
              const landVt = 1.0;
              if (!landable) {
                const restitution = (1 + GAME.BOUNCE_RESTITUTION) * -vn;
                relVx += restitution * nx;
                relVy += restitution * ny;
              } else if (vn >= -landVn && Math.abs(vt) < landVt){
                this.ship.state = "landed";
                // Nudge outward to avoid immediate re-collision bounce.
                const lift = this.SHIP_RADIUS * 0.3;
                this.ship.x += nx * lift;
                this.ship.y += ny * lift;
                const clearStep = this.SHIP_RADIUS * 0.2;
                for (let i = 0; i < 8 && this._shipCollidesAt(this.ship.x, this.ship.y, this.SHIP_RADIUS); i++){
                  this.ship.x += nx * clearStep;
                  this.ship.y += ny * clearStep;
                }
                const dx2 = this.ship.x - this.mothership.x;
                const dy2 = this.ship.y - this.mothership.y;
                const c2 = Math.cos(-this.mothership.angle);
                const s2 = Math.sin(-this.mothership.angle);
                const lx2 = c2 * dx2 - s2 * dy2;
                const ly2 = s2 * dx2 + c2 * dy2;
                this.ship._dock = { lx: lx2, ly: ly2 };
                this.ship.vx = this.mothership.vx;
                this.ship.vy = this.mothership.vy;
                landedNow = true;
              } else {
                const restitution = -vn;
                relVx += restitution * nx;
                relVy += restitution * ny;
                const friction = GAME.LAND_FRICTION * -vt;
                relVx += friction * -ny;
                relVy += friction * nx;
                const vn2 = relVx * nx + relVy * ny;
                if (vn2 < 0){
                  relVx -= nx * vn2;
                  relVy -= ny * vn2;
                }
              }
            }

            if (!landedNow){
              const maxSteps = 8;
              const stepSize = shipRadius * 0.2;
              for (let i = 0; i < maxSteps && this._shipCollidesAt(this.ship.x, this.ship.y, shipRadius); i++){
                this.ship.x += nx * stepSize;
                this.ship.y += ny * stepSize;
              }
            }
          }
          if (this.ship.state !== "landed"){
            this.ship.vx = relVx + baseVx;
            this.ship.vy = relVy + baseVy;
          }
        }
      }
    }
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
        const aimLen = Math.max(4.0, this._aimWorldDistance(GAME.AIM_SCREEN_RADIUS || 0.25));
        aimWorld = { x: this.ship.x + dirx * aimLen, y: this.ship.y + diry * aimLen };
      }
    }
    this.lastAimWorld = aimWorld;
    if (aim) this.lastAimScreen = aim;

    if (this.ship.state === "crashed"){
      this.ship.guidePath = null;
    } else {
      this.ship.guidePath = this.planet.surfaceGuidePathTo(this.ship.x, this.ship.y, GAME.MINER_CALL_RADIUS);
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
            vx: dirx * this.PLAYER_SHOT_SPEED + this.ship.vx,
            vy: diry * this.PLAYER_SHOT_SPEED + this.ship.vy,
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
            vx: dirx * this.PLAYER_BOMB_SPEED + this.ship.vx,
            vy: diry * this.PLAYER_BOMB_SPEED + this.ship.vy,
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
        if (s.life <= 0 || this.collision.airValueAtWorld(s.x, s.y) <= 0.5){
          this.playerShots.splice(i, 1);
          continue;
        }
        for (let j = this.enemies.enemies.length - 1; j >= 0; j--){
          const e = this.enemies.enemies[j];
          if (e.hp <= 0) continue;
          const dx = e.x - s.x;
          const dy = e.y - s.y;
          if (dx * dx + dy * dy <= this.PLAYER_SHOT_RADIUS * this.PLAYER_SHOT_RADIUS){
            e.hp -= 1;
            this.entityExplosions.push({ x: e.x, y: e.y, life: 0.25, radius: this.ENEMY_HIT_BLAST });
            this.playerShots.splice(i, 1);
            if (e.hp <= 0) e.hp = 0;
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
        let hitSource = "planet";
        if (b.life <= 0){
          hit = true;
        } else {
          const sample = this.collision.sampleAtWorld(b.x, b.y);
          if (sample.air <= 0.5){
            hit = true;
            hitSource = sample.source;
          }
        }
        if (!hit){
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
          if (hitSource === "planet"){
            this._applyBombImpact(b.x, b.y);
          }
          this._applyBombDamage(b.x, b.y);
          this.entityExplosions.push({ x: b.x, y: b.y, life: 0.8, radius: this.PLAYER_BOMB_BLAST });
        }
      }
    }

    if (this.entityExplosions.length){
      for (let i = this.entityExplosions.length - 1; i >= 0; i--){
        this.entityExplosions[i].life -= dt;
        if (this.entityExplosions[i].life <= 0) this.entityExplosions.splice(i, 1);
      }
    }

    // Build bounding box for guide path for quick rejection
    const guidepathMargin = 1;
    let guidePathMinX = Infinity;
    let guidePathMinY = Infinity;
    let guidePathMaxX = -Infinity;
    let guidePathMaxY = -Infinity;
    const guidePath = this.ship.guidePath;
    if (guidePath) {
      for (const pos of guidePath.path) {
        guidePathMinX = Math.min(guidePathMinX, pos.x);
        guidePathMinY = Math.min(guidePathMinY, pos.y);
        guidePathMaxX = Math.max(guidePathMaxX, pos.x);
        guidePathMaxY = Math.max(guidePathMaxY, pos.y);
      }
      guidePathMinX -= guidepathMargin;
      guidePathMinY -= guidepathMargin;
      guidePathMaxX += guidepathMargin;
      guidePathMaxY += guidepathMargin;
    }

    const landed = this.ship.state === "landed";

    for (const miner of this.miners){
      if (miner.state === "boarded") continue;

      let indexPathMiner = null;
      if (landed && miner.x >= guidePathMinX && miner.y >= guidePathMinY && miner.x <= guidePathMaxX && miner.y <= guidePathMaxY) {
        indexPathMiner = indexPathFromPos(guidePath.path, guidepathMargin, miner.x, miner.y);
      }

      miner.state = (indexPathMiner !== null) ? "running" :"idle";

      // Update jump cycle
      const r = Math.hypot(miner.x, miner.y) || 1;
      miner.jumpCycle += 1.5 * dt * r / this.planet.planetRadius;
      miner.jumpCycle -= Math.floor(miner.jumpCycle);

      if (miner.state === "running"){
        let indexPathTarget = guidePath.indexClosest;

        const distMax = (landed ? GAME.MINER_RUN_SPEED : GAME.MINER_JOG_SPEED) * dt;
        if (indexPathMiner < indexPathTarget) {
          indexPathMiner = moveAlongPathPositive(guidePath.path, indexPathMiner, distMax, indexPathTarget);
        } else if (indexPathMiner > indexPathTarget) {
          indexPathMiner = moveAlongPathNegative(guidePath.path, indexPathMiner, distMax, indexPathTarget);
          console.assert(indexPathMiner >= 0);
        }

        const posNew = posFromPathIndex(guidePath.path, indexPathMiner);
        const rNew = Math.hypot(posNew.x, posNew.y);
        const raiseAmount = 0.02; // raise the miner above the path by this to aid in visibility
        const scalePos = 1 + raiseAmount / rNew;
        miner.x = posNew.x * scalePos;
        miner.y = posNew.y * scalePos;
      }

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
        const {x: gx, y: gy} = this.planet.gravityAt(d.x, d.y);
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
        this.ship._dock = null;
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

    this.input.setGameOver(this.ship.state === "crashed");
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
    if (inputState.toggleRender){
      this.planet.toggleMode();
      this.renderer.setRenderMode(this.planet.mode);
      const newAir = this.planet.ensureModeUpdated();
      this._syncPlanetRender(newAir);
      this.planet.syncRenderFog(this.renderer, this.ship.x, this.ship.y);
      this._nudgeMinersFromTerrain();
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

    const gameOver = this.ship.state === "crashed";
    this.planet.syncRenderFog(this.renderer, this.ship.x, this.ship.y);
    this.renderer.drawFrame({
      view: this._viewState(),
      ship: this.ship,
      mothership: this.mothership,
      debris: this.debris,
      input: inputState,
      debugCollisions: this.debugCollisions,
      debugNodes: GAME.DEBUG_NODES,
      debugCollisionSamples: this.debugCollisions ? (this.ship._samples || []) : null,
      debugPoints: (this.debugCollisions && GAME.DEBUG_NODES) ? this.planet.debugPoints() : null,
      renderMode: this.planet.mode,
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
      entityExplosions: this.entityExplosions,
      aimWorld: this.lastAimWorld,
      touchUi: gameOver ? null : inputState.touchUi,
      touchStart: gameOver && inputState.inputType === "touch",
    }, this.planet);

    this._drawMinerPopups();

    this.ui.updateHud(this.hud, {
      fps: this.fps,
      state: this.ship.state,
      speed: Math.hypot(this.ship.vx, this.ship.vy),
      shipHp: this.ship.hp,
      verts: this.radial.vertCount,
      air: this.mapgen.getWorld().finalAir,
      miners: this.minersRemaining,
      minersDead: this.minersDead,
      level: this.level,
      debug: this.debugCollisions,
      minerCandidates: this.minerCandidates,
      inputType: inputState.inputType,
      renderMode: this.planet.mode,
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
    const screenT = this._screenTransform(w / h);

    for (const p of this.minerPopups){
      const t = Math.max(0, Math.min(1, p.life / GAME.MINER_POPUP_LIFE));
      const alpha = 0.9 * t;
      const screen = this._worldToScreenNorm(p.x, p.y, screenT);
      const px = screen.x * w;
      const py = screen.y * h;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255, 236, 170, 1)";
      ctx.fillText("+1", px, py);
    }
    for (const p of this.shipHitPopups){
      const t = Math.max(0, Math.min(1, p.life / GAME.SHIP_HIT_POPUP_LIFE));
      const alpha = 0.9 * t;
      const screen = this._worldToScreenNorm(p.x, p.y, screenT);
      const px = screen.x * w;
      const py = screen.y * h;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "rgba(255, 80, 80, 1)";
      ctx.fillText("-1", px, py);
    }

    if (this.lastAimScreen && this.ship.state !== "crashed"){
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

/**
 * 
 * @param {Array<{x:number, y:number}>} path 
 * @param {number} distMax
 * @param {number} x 
 * @param {number} y 
 * @returns {number|null}
 */
function indexPathFromPos(path, distMax, x, y) {
  let distClosestSqr = Infinity;
  let indexPath = null;
  for (let i = 1; i < path.length; ++i) {
    const pos0 = path[i-1];
    const pos1 = path[i];
    const dSegX = pos1.x - pos0.x;
    const dSegY = pos1.y - pos0.y;
    const dPosX = x - pos0.x;
    const dPosY = y - pos0.y;
    let u = (dSegX * dPosX + dSegY * dPosY) / (dSegX * dSegX + dSegY * dSegY);
    u = Math.max(0, Math.min(1, u));
    const dPosClosestX = dSegX * u - dPosX;
    const dPosClosestY = dSegY * u - dPosY;
    const distSqr = dPosClosestX*dPosClosestX + dPosClosestY*dPosClosestY;
    if (distSqr > distMax*distMax) continue;
    if (distSqr < distClosestSqr) {
      distClosestSqr = distSqr;
      indexPath = (i - 1) + u;
    }
  }
  return indexPath;
}

/**
 * 
 * @param {Array<{x:number, y:number}>} path 
 * @param {number} indexPath 
 * @returns {{x:number, y:number}}
 */
function posFromPathIndex(path, indexPath) {
  if (path.length === 0) {
    return path[0];
  }
  indexPath = Math.max(0, Math.min(path.length - 1, indexPath));
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;
  if (iSeg === path.length - 1) {
    iSeg -= 1;
    uSeg += 1;
  }
  const x0 = path[iSeg].x;
  const y0 = path[iSeg].y;
  const x1 = path[iSeg+1].x;
  const y1 = path[iSeg+1].y;
  const dSegX = x1 - x0;
  const dSegY = y1 - y0;
  return {x: x0 + dSegX * uSeg, y: y0 + dSegY * uSeg};
}

/**
 * 
 * @param {Array<{x:number, y:number}>} path
 * @param {number} indexPath
 * @param {number} distRemaining
 * @param {number} indexPathMax
 * @returns {number}
 */
function moveAlongPathPositive(path, indexPath, distRemaining, indexPathMax) {
  const iSegMax = Math.floor(indexPathMax);
  const uSegMax = indexPathMax - iSegMax;

  // Unpack indexPath into segment index and fraction of distance along the segment
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;

  while (iSeg > 0 && iSeg + 1 < path.length) {
    // Measure segment length
    const dSegX = path[iSeg+1].x - path[iSeg].x;
    const dSegY = path[iSeg+1].y - path[iSeg].y;
    const distSeg = Math.hypot(dSegX, dSegY);

    // Stop when we hit indexPathMax
    const distSegStop = (iSeg < iSegMax) ? Infinity : (uSegMax * distSeg);
    if (distRemaining >= distSegStop) {
      indexPath = indexPathMax;
      break;
    }

    // Stop when we exhaust distRemaining
    const distSegRemaining = (1 - uSeg) * distSeg;
    if (distRemaining < distSegRemaining) {
      indexPath += distRemaining / distSeg;
      break;
    }

    // Move on to the next segment
    distRemaining -= distSegRemaining;
    ++iSeg;
    uSeg = 0;
    indexPath = iSeg;
  }

  return indexPath;
}

/**
 * 
 * @param {Array<{x:number, y:number}>} path
 * @param {number} indexPath
 * @param {number} distRemaining
 * @param {number} indexPathMin
 * @returns {number}
 */
function moveAlongPathNegative(path, indexPath, distRemaining, indexPathMin) {
  const iSegMin = Math.floor(indexPathMin);
  const uSegMin = indexPathMin - iSegMin;

  // Unpack indexPath into segment index and fraction of distance along the segment
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;

  while (iSeg > 0 && iSeg + 1 < path.length) {
    // Measure segment length
    const dSegX = path[iSeg+1].x - path[iSeg].x;
    const dSegY = path[iSeg+1].y - path[iSeg].y;
    const distSeg = Math.hypot(dSegX, dSegY);

    // Stop when we hit indexPathMin
    const distSegStop = (iSeg > iSegMin) ? Infinity : ((1 - uSegMin) * distSeg);
    if (distRemaining >= distSegStop) {
      indexPath = indexPathMin;
      break;
    }

    // Stop when we exhaust distRemaining
    const distSegRemaining = uSeg * distSeg;
    if (distRemaining < distSegRemaining) {
      indexPath -= distRemaining / distSeg;
      break;
    }

    // Move on to the next segment
    distRemaining -= distSegRemaining;
    indexPath = iSeg;
    --iSeg;
    uSeg = 1;
  }

  return indexPath;
}
