// @ts-check

import { GAME } from "./config.js";
import { mulberry32 } from "./rng.js";
import { createEnemies } from "./enemies.js";

/**
 * @typedef {Object} Ship
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {string} state
 * @property {number} explodeT
 * @property {number} lastAir
 * @property {Array<[number,number,boolean,number]>|null} [_samples]
 * @property {{x:number,y:number,tri?:Array<{x:number,y:number}>|null,node?:{x:number,y:number}|null}|null} [_collision]
 * @property {number} [_shipRadius]
 */

/**
 * @typedef {Object} Miner
 * @property {number} x
 * @property {number} y
 * @property {"idle"|"running"|"boarded"} state
 */

/**
 * @param {Object} deps
 * @param {typeof import("./config.js").CFG} deps.cfg
 * @param {{ airBinaryAtWorld:(x:number,y:number)=>0|1, setAirAtWorld:(x:number,y:number,val?:0|1)=>boolean, getWorld:()=>{finalAir:number,seed:number,air:Uint8Array,entrances:Vec2[]}, regenWorld:(seed:number)=>{finalAir:number,seed:number}, noise: any, grid:{G:number,cell:number,inside:Uint8Array,idx:(i:number,j:number)=>number,toWorld:(i:number,j:number)=>[number,number],toGrid:(x:number,y:number)=>[number,number]} }} deps.mapgen
 * @param {{ updateAirFlags:()=>Float32Array, airValueAtWorld:(x:number,y:number)=>number, findTriAtWorld:(x:number,y:number)=>Array<{x:number,y:number}>|null, nearestNodeOnRing:(x:number,y:number)=>{x:number,y:number}|null, vertCount:number }} deps.mesh
 * @param {{ updateAir:(airFlag:Float32Array)=>void, drawFrame:(state:any, mesh:any)=>void }} deps.renderer
 * @param {{ update:()=>{left:boolean,right:boolean,thrust:boolean,down:boolean,reset:boolean,regen:boolean,toggleDebug:boolean,nextLevel:boolean,shoot:boolean,bomb:boolean,aim?:{x:number,y:number}|null,aimShoot?:{x:number,y:number}|null,aimBomb?:{x:number,y:number}|null,aimShootFrom?:{x:number,y:number}|null,aimShootTo?:{x:number,y:number}|null,aimBombFrom?:{x:number,y:number}|null,aimBombTo?:{x:number,y:number}|null,touchUi?:{leftTouch:{x:number,y:number}|null,laserTouch:{x:number,y:number}|null,bombTouch:{x:number,y:number}|null}|null,touchUiVisible?:boolean} }} deps.input
 * @param {{ updateHud:(hud:HTMLElement, stats:{fps:number,state:string,speed:number,verts:number,air:number,miners:number,minersDead:number,level:number,debug:boolean,minerCandidates:number})=>void }} deps.ui
 * @param {HTMLCanvasElement} deps.canvas
 * @param {HTMLElement} deps.hud
 */
export function createGameLoop({ cfg, mapgen, mesh, renderer, input, ui, canvas, hud }){
  const TERRAIN_PAD = 0.5;
  const TERRAIN_MAX = cfg.RMAX + TERRAIN_PAD;
  const SHIP_RADIUS = 0.7 * 0.28;
  const MINER_HEIGHT = 0.36;
  const MINER_SURFACE_EPS = 0.01;
  /** @type {Ship} */
  const ship = {
    x: 0,
    y: cfg.RMAX + 0.9,
    vx: 0,
    vy: 0,
    state: "flying",
    explodeT: 0,
    lastAir: 1,
  };
  const debris = [];
  const playerShots = [];
  const playerBombs = [];
  const playerExplosions = [];
  let lastAimWorld = null;

  const PLAYER_SHOT_SPEED = 7.5;
  const PLAYER_SHOT_LIFE = 1.2;
  const PLAYER_SHOT_RADIUS = 0.22;
  const PLAYER_BOMB_SPEED = 4.5;
  const PLAYER_BOMB_LIFE = 3.2;
  const PLAYER_BOMB_RADIUS = 0.35;
  const PLAYER_BOMB_BLAST = 1.2;
  const PLAYER_BOMB_DAMAGE = 1.7;

  /**
   * Reset the ship and player projectiles.
   */
  function resetShip(){
    ship.x = 0;
    ship.y = cfg.RMAX + 0.9;
    ship.vx = 0;
    ship.vy = 0;
    ship.state = "flying";
    ship.explodeT = 0;
    debris.length = 0;
    playerShots.length = 0;
    playerBombs.length = 0;
    playerExplosions.length = 0;
    minersDead = 0;
  }

  let level = 1;
  /** @type {Miner[]} */
  let miners = [];
  let minersRemaining = 0;
  let minersDead = 0;
  let minerCandidates = 0;
  const enemies = createEnemies({ cfg, mapgen, mesh });

  /**
   * @param {number} lvl
   */
  const totalEnemiesForLevel = (lvl) => (lvl <= 1 ? 0 : 2 * (lvl - 1));

  /**
   * Transition the ship to a crashed state and spawn debris.
   */
  function triggerCrash(){
    if (ship.state === "crashed") return;
    ship.state = "crashed";
    ship.explodeT = 0;
    ship.vx = 0; ship.vy = 0;
    debris.length = 0;
    const pieces = 10;
    for (let i = 0; i < pieces; i++){
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2.5;
      debris.push({
        x: ship.x + Math.cos(ang) * 0.1,
        y: ship.y + Math.sin(ang) * 0.1,
        vx: ship.vx + Math.cos(ang) * sp,
        vy: ship.vy + Math.sin(ang) * sp,
        a: Math.random() * Math.PI * 2,
        w: (Math.random() - 0.5) * 4,
        life: 2.5 + Math.random() * 1.5,
      });
    }
  }

  /**
   * @param {{x:number,y:number}|null|undefined} aim
   */
  function toWorldFromAim(aim){
    if (!aim) return null;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const xN = aim.x * 2 - 1;
    const yN = (1 - aim.y) * 2 - 1;
    const camRot = Math.atan2(ship.x, ship.y || 1e-6);
    const s = GAME.ZOOM / (cfg.RMAX + cfg.PAD);
    const aspect = w / h;
    const sx = s / aspect;
    const sy = s;
    const px = xN / sx;
    const py = yN / sy;
    const c = Math.cos(-camRot), s2 = Math.sin(-camRot);
    const wx = c * px - s2 * py + ship.x;
    const wy = s2 * px + c * py + ship.y;
    return { x: wx, y: wy };
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  function applyBombImpact(x, y){
    const candidates = [];
    const maxRing = Math.min(cfg.RMAX, mesh.rings.length - 1);
    for (let r = 0; r <= maxRing; r++){
      const ring = mesh.rings[r];
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
      if (mapgen.setAirAtWorld(v.x, v.y, 1)) changed = true;
    }
    if (changed){
      const newAir = mesh.updateAirFlags();
      renderer.updateAir(newAir);
    }
  }

  /**
   * @param {number} x
   * @param {number} y
   */
  function applyBombDamage(x, y){
    const r2 = PLAYER_BOMB_DAMAGE * PLAYER_BOMB_DAMAGE;
    if (ship.state !== "crashed"){
      const dx = ship.x - x;
      const dy = ship.y - y;
      if (dx * dx + dy * dy <= r2){
        triggerCrash();
      }
    }
    for (let j = enemies.enemies.length - 1; j >= 0; j--){
      const e = enemies.enemies[j];
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= r2){
        enemies.enemies.splice(j, 1);
      }
    }
    for (let j = miners.length - 1; j >= 0; j--){
      const m = miners[j];
      if (m.state === "boarded") continue;
      const dx = m.x - x;
      const dy = m.y - y;
      if (dx * dx + dy * dy <= r2){
        miners.splice(j, 1);
        minersRemaining = Math.max(0, minersRemaining - 1);
        minersDead++;
      }
    }
  }

  /**
   * @param {Array<any>} items
   * @param {() => number} rand
   */
  function shuffle(items, rand){
    for (let i = items.length - 1; i > 0; i--){
      const j = Math.floor(rand() * (i + 1));
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
  }

  /**
   * @param {Uint8Array|null} traversable
   */
  /**
   * @param {number} minDot
   * @param {Uint8Array|null} traversable
   */
  function gatherMinerCandidates(minDot, traversable){
    const { G, inside, idx, toWorld, cell } = mapgen.grid;
    const air = mapgen.getWorld().air;
    const eps = cell * 0.5;
    const candidates = [];

    for (let j = 1; j < G - 1; j++){
      for (let i = 1; i < G - 1; i++){
        const k = idx(i, j);
        if (!inside[k] || !air[k]) continue;
        if (traversable && !traversable[k]) continue;
        const [x, y] = toWorld(i, j);
        const r = Math.hypot(x, y);
        if (r < 1) continue;

        const upx = x / r;
        const upy = y / r;
        const tdx = Math.abs(upx) > Math.abs(upy) ? 0 : 1;
        const tdy = Math.abs(upx) > Math.abs(upy) ? 1 : 0;
        const k0 = idx(i - tdx, j - tdy);
        const k1 = idx(i + tdx, j + tdy);
        if (!inside[k0] || !inside[k1]) continue;
        if (!air[k0] || !air[k1]) continue;
        if (traversable && (!traversable[k0] || !traversable[k1])) continue;
        const rdx = Math.abs(upx) >= Math.abs(upy) ? (upx >= 0 ? 1 : -1) : 0;
        const rdy = Math.abs(upy) > Math.abs(upx) ? (upy >= 0 ? 1 : -1) : 0;
        const kb = idx(i - rdx, j - rdy);
        if (!inside[kb]) continue;
        if (air[kb]) continue;

        // Find the interpolated terrain surface along the radial line.
        let ax = x - upx * cell * 0.75;
        let ay = y - upy * cell * 0.75;
        let bx = x + upx * cell * 0.75;
        let by = y + upy * cell * 0.75;
        let aAir = mesh.airValueAtWorld(ax, ay) > 0.5;
        let bAir = mesh.airValueAtWorld(bx, by) > 0.5;
        if (aAir === bAir){
          // Ensure a rock->air span for binary search.
          ax = x - upx * cell * 1.2;
          ay = y - upy * cell * 1.2;
          bx = x + upx * cell * 1.2;
          by = y + upy * cell * 1.2;
          aAir = mesh.airValueAtWorld(ax, ay) > 0.5;
          bAir = mesh.airValueAtWorld(bx, by) > 0.5;
          if (aAir === bAir) continue;
        }
        let lx = ax, ly = ay, hx = bx, hy = by;
        let lAir = aAir;
        for (let it = 0; it < 8; it++){
          const mx = (lx + hx) * 0.5;
          const my = (ly + hy) * 0.5;
          const mAir = mesh.airValueAtWorld(mx, my) > 0.5;
          if (mAir === lAir){
            lx = mx; ly = my;
          } else {
            hx = mx; hy = my;
          }
        }
        const baseX = ((lx + hx) * 0.5) + upx * MINER_SURFACE_EPS;
        const baseY = ((ly + hy) * 0.5) + upy * MINER_SURFACE_EPS;

        const gdx = mesh.airValueAtWorld(x + eps, y) - mesh.airValueAtWorld(x - eps, y);
        const gdy = mesh.airValueAtWorld(x, y + eps) - mesh.airValueAtWorld(x, y - eps);
        const nlen = Math.hypot(gdx, gdy);
        if (nlen < 1e-4) continue;
        const nx = gdx / nlen;
        const ny = gdy / nlen;
        const dotUp = nx * upx + ny * upy;
        if (dotUp < minDot) continue;

        candidates.push({
          x: baseX,
          y: baseY,
          r,
          key: `${i},${j}`,
        });
      }
    }

    return candidates;
  }

  /**
   * @param {boolean} [useClearance]
   */
  /**
   * @param {boolean} [useClearance]
   */
  function buildTraversableMask(useClearance = true){
    const { G, inside, idx, toGrid, cell } = mapgen.grid;
    const air = mapgen.getWorld().air;
    const clearance = Math.max(1, Math.ceil((SHIP_RADIUS * 1.1) / cell));
    const safe = new Uint8Array(G * G);

    for (let j = 0; j < G; j++){
      for (let i = 0; i < G; i++){
        const k = idx(i, j);
        if (!inside[k] || !air[k]) continue;
        let ok = true;
        for (let dy = -clearance; dy <= clearance && ok; dy++){
          const y = j + dy;
          if (y < 0 || y >= G){ ok = false; break; }
          for (let dx = -clearance; dx <= clearance; dx++){
            const x = i + dx;
            if (x < 0 || x >= G){ ok = false; break; }
            const kk = idx(x, y);
            if (!inside[kk] || !air[kk]) { ok = false; break; }
          }
        }
        if (ok) safe[k] = 1;
      }
    }

    const entrances = mapgen.getWorld().entrances;
    if (!entrances || !entrances.length) return null;

    /**
     * @param {Uint8Array} field
     */
    function floodFromEntrances(field){
      const vis = new Uint8Array(G * G);
      const qx = new Int32Array(G * G);
      const qy = new Int32Array(G * G);
      let qh = 0, qt = 0;
      const seedPad = Math.max(1, Math.min(3, clearance + 1));

      for (const [ex, ey] of entrances){
        const [ix, iy] = toGrid(ex * 0.97, ey * 0.97);
        for (let dy = -seedPad; dy <= seedPad; dy++){
          for (let dx = -seedPad; dx <= seedPad; dx++){
            const x = ix + dx;
            const y = iy + dy;
            if (x < 0 || x >= G || y < 0 || y >= G) continue;
            const k = idx(x, y);
            if (!inside[k] || !field[k] || vis[k]) continue;
            vis[k] = 1;
            qx[qt] = x; qy[qt] = y; qt++;
          }
        }
      }

      const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
      while (qh < qt){
        const x = qx[qh], y = qy[qh]; qh++;
        for (const [dx, dy] of dirs){
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || xx >= G || yy < 0 || yy >= G) continue;
          const kk = idx(xx, yy);
          if (!inside[kk] || !field[kk] || vis[kk]) continue;
          vis[kk] = 1;
          qx[qt] = xx; qy[qt] = yy; qt++;
        }
      }

      if (qt === 0) return null;
      return vis;
    }

    if (useClearance){
      const visSafe = floodFromEntrances(safe);
      if (visSafe) return visSafe;
    }
    return floodFromEntrances(air);
  }

  /**
   * Spawn miners for the current level.
   */
  function spawnMiners(){
    const count = GAME.MINERS_PER_LEVEL;
    const seed = mapgen.getWorld().seed + level * 97;
    const rand = mulberry32(seed);
    const minDots = [
      GAME.SURFACE_DOT + 0.1,
      GAME.SURFACE_DOT,
      GAME.SURFACE_DOT - 0.1,
      GAME.SURFACE_DOT - 0.25,
      GAME.SURFACE_DOT - 0.4,
    ];
    let traversable = buildTraversableMask(true);

    let candidates = [];
    for (const minDot of minDots){
      candidates = gatherMinerCandidates(minDot, traversable);
      if (candidates.length >= count * 3) break;
    }

    if (!candidates.length && traversable){
      traversable = buildTraversableMask(false);
      for (const minDot of minDots){
        candidates = gatherMinerCandidates(minDot, traversable);
        if (candidates.length >= count * 3) break;
      }
    }

    if (!candidates.length){
      // Simple surface rule: air cell with rock just below.
      candidates = [];
      const { G, inside, idx, toWorld, cell } = mapgen.grid;
      const air = mapgen.getWorld().air;
      for (let j = 1; j < G - 1; j++){
        for (let i = 1; i < G - 1; i++){
          const k = idx(i, j);
          if (!inside[k] || !air[k]) continue;
          if (traversable && !traversable[k]) continue;
          const [x, y] = toWorld(i, j);
          const r = Math.hypot(x, y);
          if (r < 1) continue;
          const upx = x / r;
          const upy = y / r;
          const tdx = Math.abs(upx) > Math.abs(upy) ? 0 : 1;
          const tdy = Math.abs(upx) > Math.abs(upy) ? 1 : 0;
          const k0 = idx(i - tdx, j - tdy);
          const k1 = idx(i + tdx, j + tdy);
          if (!inside[k0] || !inside[k1]) continue;
          if (!air[k0] || !air[k1]) continue;
          if (traversable && (!traversable[k0] || !traversable[k1])) continue;
          const rdx = Math.abs(upx) >= Math.abs(upy) ? (upx >= 0 ? 1 : -1) : 0;
          const rdy = Math.abs(upy) > Math.abs(upx) ? (upy >= 0 ? 1 : -1) : 0;
          const kb = idx(i - rdx, j - rdy);
          if (!inside[kb]) continue;
          if (air[kb]) continue;

          let ax = x - upx * cell * 0.75;
          let ay = y - upy * cell * 0.75;
          let bx = x + upx * cell * 0.75;
          let by = y + upy * cell * 0.75;
          let aAir = mesh.airValueAtWorld(ax, ay) > 0.5;
          let bAir = mesh.airValueAtWorld(bx, by) > 0.5;
          if (aAir === bAir){
            ax = x - upx * cell * 1.2;
            ay = y - upy * cell * 1.2;
            bx = x + upx * cell * 1.2;
            by = y + upy * cell * 1.2;
            aAir = mesh.airValueAtWorld(ax, ay) > 0.5;
            bAir = mesh.airValueAtWorld(bx, by) > 0.5;
            if (aAir === bAir) continue;
          }
          let lx = ax, ly = ay, hx = bx, hy = by;
          let lAir = aAir;
          for (let it = 0; it < 8; it++){
            const mx = (lx + hx) * 0.5;
            const my = (ly + hy) * 0.5;
            const mAir = mesh.airValueAtWorld(mx, my) > 0.5;
            if (mAir === lAir){
              lx = mx; ly = my;
            } else {
              hx = mx; hy = my;
            }
          }
          const baseX = ((lx + hx) * 0.5) + upx * MINER_SURFACE_EPS;
          const baseY = ((ly + hy) * 0.5) + upy * MINER_SURFACE_EPS;
          candidates.push({ x: baseX, y: baseY, r, key: `${i},${j}` });
        }
      }
    }

    if (!candidates.length){
      miners = [];
      minersRemaining = 0;
      minersDead = 0;
      minerCandidates = 0;
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
    minerCandidates = candidates.length;

    shuffle(candidates, rand);
    const placed = [];
    const baseMinSep = GAME.MINER_MIN_SEP;
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

    miners = placed.map((p) => ({ x: p.x, y: p.y, state: "idle" }));
    minersRemaining = miners.length;
    minersDead = 0;
  }

  /**
   * @param {number} seed
   * @param {boolean} advanceLevel
   */
  function beginLevel(seed, advanceLevel){
    mapgen.regenWorld(seed);
    const newAir = mesh.updateAirFlags();
    renderer.updateAir(newAir);
    resetShip();
    playerExplosions.length = 0;
    if (advanceLevel) level++;
    spawnMiners();
    enemies.spawn(totalEnemiesForLevel(level), level);
  }

  spawnMiners();
  enemies.spawn(totalEnemiesForLevel(level), level);

  /**
   * @param {number} x
   * @param {number} y
   */
  function shipCollisionPoints(x, y){
    const camRot = Math.atan2(x, y || 1e-6);
    const shipRot = -camRot;
    const shipHWorld = 0.7;
    const shipWWorld = 0.5;
    const nose = shipHWorld * 0.6;
    const tail = shipHWorld * 0.4;
    const local = [
      [0, nose],
      [shipWWorld * 0.6, -tail],
      [-shipWWorld * 0.6, -tail],
    ];
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
   * @param {number} x
   * @param {number} y
   * @param {number} shipRadius
   */
  function shipCollidesAt(x, y, shipRadius){
    const rCenter = Math.hypot(x, y);
    if (rCenter - shipRadius > TERRAIN_MAX) return false;
    if (mesh.airValueAtWorld(x, y) <= 0.5) return true;
    for (const [sx, sy] of shipCollisionPoints(x, y)){
      const av = mesh.airValueAtWorld(sx, sy);
      if (av <= 0.5) return true;
    }
    return false;
  }

  /**
   * @param {number} dt
   * @param {{left:boolean,right:boolean,thrust:boolean,down:boolean,reset:boolean,regen:boolean,toggleDebug:boolean,nextLevel:boolean,shoot:boolean,bomb:boolean,aim?:{x:number,y:number}|null,aimShoot?:{x:number,y:number}|null,aimBomb?:{x:number,y:number}|null,aimShootFrom?:{x:number,y:number}|null,aimShootTo?:{x:number,y:number}|null,aimBombFrom?:{x:number,y:number}|null,aimBombTo?:{x:number,y:number}|null}} inputState
   */
  function step(dt, inputState){
    const { left, right, thrust, down, reset, shoot, bomb, aim, aimShoot, aimBomb, aimShootFrom, aimShootTo, aimBombFrom, aimBombTo } = inputState;
    if (reset) resetShip();
    const aimWorldShoot = toWorldFromAim(aimShoot || aim);
    const aimWorldBomb = toWorldFromAim(aimBomb || aimShoot || aim);
    let aimWorld = (aimShootTo && toWorldFromAim(aimShootTo)) || aimWorldShoot || (aimBombTo && toWorldFromAim(aimBombTo)) || aimWorldBomb;
    if ((aimShootFrom && aimShootTo) || (aimBombFrom && aimBombTo)){
      const from = aimShootFrom || aimBombFrom;
      const to = aimShootTo || aimBombTo;
      const wFrom = from ? toWorldFromAim(from) : null;
      const wTo = to ? toWorldFromAim(to) : null;
      if (wFrom && wTo){
        const dx = wTo.x - wFrom.x;
        const dy = wTo.y - wFrom.y;
        const dist = Math.hypot(dx, dy) || 1;
        const dirx = dx / dist;
        const diry = dy / dist;
        const aimLen = 4.0;
        aimWorld = { x: ship.x + dirx * aimLen, y: ship.y + diry * aimLen };
      }
    }
    lastAimWorld = aimWorld;

    if (ship.state === "flying"){
      let ax = 0, ay = 0;
      const r = Math.hypot(ship.x, ship.y) || 1;
      const rx = ship.x / r;
      const ry = ship.y / r;
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

      ax += -ship.x / r * GAME.GRAVITY;
      ay += -ship.y / r * GAME.GRAVITY;

      ship.vx += ax * dt;
      ship.vy += ay * dt;

      const drag = Math.max(0, 1 - GAME.DRAG * dt);
      ship.vx *= drag;
      ship.vy *= drag;

      const vt = ship.vx * tx + ship.vy * ty;
      const vtMax = GAME.MAX_TANGENTIAL_SPEED;
      if (Math.abs(vt) > vtMax){
        const excess = vt - Math.sign(vt) * vtMax;
        ship.vx -= tx * excess;
        ship.vy -= ty * excess;
      }

      ship.x += ship.vx * dt;
      ship.y += ship.vy * dt;

      const speed = Math.hypot(ship.vx, ship.vy);
      const eps = mapgen.grid.cell * 0.75;
      const shipHWorld = 0.7;
      const shipRadius = SHIP_RADIUS;

      let collides = false;
      const samples = [];
      let hit = null;
      const rCenter = Math.hypot(ship.x, ship.y);
      if (rCenter - shipRadius <= TERRAIN_MAX){
        for (const [sx, sy] of shipCollisionPoints(ship.x, ship.y)){
          const av = mesh.airValueAtWorld(sx, sy);
          const air = av > 0.5;
          samples.push([sx, sy, air, av]);
          if (!air) {
            collides = true;
            if (!hit) hit = { x: sx, y: sy };
          }
        }
      }
      ship._samples = samples;
      ship._shipRadius = shipRadius;
      if (hit){
        ship._collision = {
          x: hit.x,
          y: hit.y,
          tri: mesh.findTriAtWorld(hit.x, hit.y),
          node: mesh.nearestNodeOnRing(hit.x, hit.y),
        };
      } else {
        ship._collision = null;
      }

      if (collides){
        const gdx = mesh.airValueAtWorld(ship.x + eps, ship.y) - mesh.airValueAtWorld(ship.x - eps, ship.y);
        const gdy = mesh.airValueAtWorld(ship.x, ship.y + eps) - mesh.airValueAtWorld(ship.x, ship.y - eps);
        let nx = gdx;
        let ny = gdy;
        let nlen = Math.hypot(nx, ny);
        if (nlen < 1e-4){
          const c = ship._collision;
          if (c){
            nx = ship.x - c.x;
            ny = ship.y - c.y;
            nlen = Math.hypot(nx, ny);
          }
        }
        if (nlen < 1e-4){
          nx = ship.x;
          ny = ship.y;
          nlen = Math.hypot(nx, ny) || 1;
        }
        nx /= nlen;
        ny /= nlen;
        const camRot = Math.atan2(ship.x, ship.y || 1e-6);
        const upx = Math.sin(camRot);
        const upy = Math.cos(camRot);
        const dotUp = nx * upx + ny * upy;
        const vn = ship.vx * nx + ship.vy * ny;
        const impactSpeed = Math.max(0, -vn);
        const resolvePenetration = () => {
          const maxSteps = 8;
          const stepSize = shipRadius * 0.2;
          for (let i = 0; i < maxSteps; i++){
            if (!shipCollidesAt(ship.x, ship.y, shipRadius)) break;
            ship.x += nx * stepSize;
            ship.y += ny * stepSize;
          }
        };

        if (impactSpeed <= GAME.LAND_SPEED && vn < -0.05 && dotUp >= GAME.SURFACE_DOT){
          ship.state = "landed";
          ship.vx = 0; ship.vy = 0;
          resolvePenetration();
        } else if (impactSpeed >= GAME.CRASH_SPEED){
          triggerCrash();
        } else {
          if (impactSpeed <= GAME.LAND_SPEED && vn < -0.05 && dotUp >= GAME.SURFACE_DOT){
            ship.vx -= nx * GAME.LAND_PULL * dt;
            ship.vy -= ny * GAME.LAND_PULL * dt;
            const tx = -ny;
            const ty = nx;
            const vt = ship.vx * tx + ship.vy * ty;
            ship.vx -= vt * tx * GAME.LAND_FRICTION * dt;
            ship.vy -= vt * ty * GAME.LAND_FRICTION * dt;
            resolvePenetration();
          } else if (vn < 0){
            const restitution = GAME.BOUNCE_RESTITUTION;
            ship.vx -= (1 + restitution) * vn * nx;
            ship.vy -= (1 + restitution) * vn * ny;
            const fast = speed >= (GAME.LAND_SPEED * 1.2);
            const push = shipRadius * (fast ? GAME.COLLIDE_PUSH_FAST : 0.02);
            ship.x += nx * push;
            ship.y += ny * push;
            resolvePenetration();
          }
        }
      }
    }

    if (ship.state !== "crashed"){
      if (shoot){
        let dirx = 0, diry = 0;
        if (aimShootFrom && aimShootTo){
          const wFrom = toWorldFromAim(aimShootFrom);
          const wTo = toWorldFromAim(aimShootTo);
          if (wFrom && wTo){
            const dx = wTo.x - wFrom.x;
            const dy = wTo.y - wFrom.y;
            const dist = Math.hypot(dx, dy) || 1;
            dirx = dx / dist;
            diry = dy / dist;
          }
        } else if (aimWorldShoot){
          const dx = aimWorldShoot.x - ship.x;
          const dy = aimWorldShoot.y - ship.y;
          const dist = Math.hypot(dx, dy) || 1;
          dirx = dx / dist;
          diry = dy / dist;
        }
        if (dirx || diry){
          playerShots.push({
            x: ship.x + dirx * 0.45,
            y: ship.y + diry * 0.45,
            vx: dirx * PLAYER_SHOT_SPEED,
            vy: diry * PLAYER_SHOT_SPEED,
            life: PLAYER_SHOT_LIFE,
          });
        }
      }
      if (bomb){
        let dirx = 0, diry = 0;
        if (aimBombFrom && aimBombTo){
          const wFrom = toWorldFromAim(aimBombFrom);
          const wTo = toWorldFromAim(aimBombTo);
          if (wFrom && wTo){
            const dx = wTo.x - wFrom.x;
            const dy = wTo.y - wFrom.y;
            const dist = Math.hypot(dx, dy) || 1;
            dirx = dx / dist;
            diry = dy / dist;
          }
        } else if (aimWorldBomb){
          const dx = aimWorldBomb.x - ship.x;
          const dy = aimWorldBomb.y - ship.y;
          const dist = Math.hypot(dx, dy) || 1;
          dirx = dx / dist;
          diry = dy / dist;
        }
        if (dirx || diry){
          playerBombs.push({
            x: ship.x + dirx * 0.45,
            y: ship.y + diry * 0.45,
            vx: dirx * PLAYER_BOMB_SPEED,
            vy: diry * PLAYER_BOMB_SPEED,
            life: PLAYER_BOMB_LIFE,
          });
        }
      }
    }

    if (playerShots.length){
      for (let i = playerShots.length - 1; i >= 0; i--){
        const s = playerShots[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.life -= dt;
        if (s.life <= 0 || mesh.airValueAtWorld(s.x, s.y) <= 0.5){
          playerShots.splice(i, 1);
          continue;
        }
        for (let j = enemies.enemies.length - 1; j >= 0; j--){
          const e = enemies.enemies[j];
          const dx = e.x - s.x;
          const dy = e.y - s.y;
          if (dx * dx + dy * dy <= PLAYER_SHOT_RADIUS * PLAYER_SHOT_RADIUS){
            e.hp -= 1;
            playerShots.splice(i, 1);
            if (e.hp <= 0) enemies.enemies.splice(j, 1);
            break;
          }
        }
        if (i >= playerShots.length) continue;
        for (let j = miners.length - 1; j >= 0; j--){
          const m = miners[j];
          if (m.state === "boarded") continue;
          const dx = m.x - s.x;
          const dy = m.y - s.y;
          if (dx * dx + dy * dy <= PLAYER_SHOT_RADIUS * PLAYER_SHOT_RADIUS){
            miners.splice(j, 1);
            minersRemaining = Math.max(0, minersRemaining - 1);
            minersDead++;
            playerShots.splice(i, 1);
            break;
          }
        }
      }
    }

    if (playerBombs.length){
      for (let i = playerBombs.length - 1; i >= 0; i--){
        const b = playerBombs[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.life -= dt;
        let hit = false;
        if (b.life <= 0 || mesh.airValueAtWorld(b.x, b.y) <= 0.5){
          hit = true;
        } else {
          for (let j = enemies.enemies.length - 1; j >= 0; j--){
            const e = enemies.enemies[j];
            const dx = e.x - b.x;
            const dy = e.y - b.y;
            if (dx * dx + dy * dy <= PLAYER_BOMB_RADIUS * PLAYER_BOMB_RADIUS){
              enemies.enemies.splice(j, 1);
              hit = true;
              break;
            }
          }
          if (!hit){
            for (let j = miners.length - 1; j >= 0; j--){
              const m = miners[j];
              if (m.state === "boarded") continue;
              const dx = m.x - b.x;
              const dy = m.y - b.y;
              if (dx * dx + dy * dy <= PLAYER_BOMB_RADIUS * PLAYER_BOMB_RADIUS){
                miners.splice(j, 1);
                minersRemaining = Math.max(0, minersRemaining - 1);
                minersDead++;
                hit = true;
                break;
              }
            }
          }
        }
        if (hit){
          playerBombs.splice(i, 1);
          applyBombImpact(b.x, b.y);
          applyBombDamage(b.x, b.y);
          playerExplosions.push({ x: b.x, y: b.y, life: 0.8, radius: PLAYER_BOMB_BLAST });
        }
      }
    }

    if (playerExplosions.length){
      for (let i = playerExplosions.length - 1; i >= 0; i--){
        playerExplosions[i].life -= dt;
        if (playerExplosions[i].life <= 0) playerExplosions.splice(i, 1);
      }
    }

    if (miners.length){
      const landed = ship.state === "landed";
      for (const miner of miners){
        if (miner.state === "boarded") continue;
        const dx = ship.x - miner.x;
        const dy = ship.y - miner.y;
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

          const tryMove = (tx, ty) => {
            const nx = miner.x + tx * stepLen;
            const ny = miner.y + ty * stepLen;
            if (mesh.airValueAtWorld(nx, ny) > 0.5){
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

        const postDx = ship.x - miner.x;
        const postDy = ship.y - miner.y;
        const postDist = Math.hypot(postDx, postDy);
        if (landed && postDist <= GAME.MINER_BOARD_RADIUS){
          miner.state = "boarded";
          minersRemaining = Math.max(0, minersRemaining - 1);
        }
      }
    }

    if (debris.length){
      for (let i = debris.length - 1; i >= 0; i--){
        const d = debris[i];
        const r = Math.hypot(d.x, d.y) || 1;
        d.vx += (-d.x / r) * GAME.GRAVITY * dt;
        d.vy += (-d.y / r) * GAME.GRAVITY * dt;
        d.vx *= Math.max(0, 1 - GAME.DRAG * dt);
        d.vy *= Math.max(0, 1 - GAME.DRAG * dt);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.a += d.w * dt;
        d.life -= dt;
        if (d.life <= 0) debris.splice(i, 1);
      }
    }

    enemies.update(ship, dt);

    if (ship.state !== "crashed"){
      for (let i = enemies.shots.length - 1; i >= 0; i--){
        const s = enemies.shots[i];
        const dx = ship.x - s.x;
        const dy = ship.y - s.y;
        if (dx * dx + dy * dy <= SHIP_RADIUS * SHIP_RADIUS){
          enemies.shots.splice(i, 1);
          triggerCrash();
          break;
        }
      }
    }

    if (ship.state !== "crashed" && enemies.explosions.length){
      for (const ex of enemies.explosions){
        const r = ex.radius ?? 1.0;
        const dx = ship.x - ex.x;
        const dy = ship.y - ex.y;
        if (dx * dx + dy * dy <= r * r){
          triggerCrash();
          break;
        }
      }
    }

    if (ship.state === "landed"){
      if (left || right || thrust){
        ship.state = "flying";
      }
    }
  }

  let lastTime = performance.now();
  let accumulator = 0;
  let fpsTime = lastTime;
  let fpsFrames = 0;
  let fps = 0;
  let debugCollisions = GAME.DEBUG_COLLISION;

  /**
   * Advance a render frame.
   */
  function frame(){
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    accumulator += dt;

    const inputState = input.update();

    if (ship.state === "crashed"){
      ship.explodeT = Math.min(1.2, ship.explodeT + dt * 0.9);
    }

    if (inputState.regen){
      const nextSeed = mapgen.getWorld().seed + 1;
      beginLevel(nextSeed, false);
    }
    if (inputState.nextLevel){
      const nextSeed = mapgen.getWorld().seed + 1;
      beginLevel(nextSeed, true);
    }

    if (inputState.toggleDebug){
      debugCollisions = !debugCollisions;
    }

    const fixed = 1 / 60;
    const maxSteps = 4;
    let steps = 0;
    while (accumulator >= fixed && steps < maxSteps){
      step(fixed, inputState);
      accumulator -= fixed;
      steps++;
    }

    if (minersRemaining === 0 && ship.state === "flying"){
      const r = Math.hypot(ship.x, ship.y);
      if (r > cfg.RMAX + GAME.EXIT_MARGIN){
        const nextSeed = mapgen.getWorld().seed + 1;
        beginLevel(nextSeed, true);
      }
    }

    fpsFrames++;
    if (now - fpsTime >= 500){
      fps = Math.round((fpsFrames * 1000) / (now - fpsTime));
      fpsFrames = 0;
      fpsTime = now;
    }

    renderer.drawFrame({
      ship,
      debris,
      input: inputState,
      debugCollisions,
      debugNodes: GAME.DEBUG_NODES,
      fps,
      finalAir: mapgen.getWorld().finalAir,
      miners,
      minersRemaining,
      level,
      minersDead,
      enemies: enemies.enemies,
      shots: enemies.shots,
      explosions: enemies.explosions,
      enemyDebris: enemies.debris,
      playerShots,
      playerBombs,
      playerExplosions,
      aimWorld: lastAimWorld,
      touchUi: inputState.touchUi,
    }, mesh);

    ui.updateHud(hud, {
      fps,
      state: ship.state,
      speed: Math.hypot(ship.vx, ship.vy),
      verts: mesh.vertCount,
      air: mapgen.getWorld().finalAir,
      miners: minersRemaining,
      minersDead,
      level,
      debug: debugCollisions,
      minerCandidates,
    });

    requestAnimationFrame(frame);
  }

  /**
   * Begin the animation loop.
   */
  function start(){
    requestAnimationFrame(frame);
  }

  return { start, ship, debris };
}
