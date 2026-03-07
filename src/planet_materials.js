// @ts-check

import { mulberry32 } from "./rng.js";
import { GAME } from "./config.js";

/**
 * Feature routing for planet-specific hazards and props.
 * Loop should delegate to Planet, which delegates here.
 */

/**
 * @param {number} x
 * @param {number} y
 * @param {number} minDist
 * @param {Array<{x:number,y:number,r:number}>} reservations
 * @returns {boolean}
 */
function isFarFromReservations(x, y, minDist, reservations){
  if (minDist <= 0 || !reservations.length) return true;
  for (const rsv of reservations){
    const dx = x - rsv.x;
    const dy = y - rsv.y;
    const rr = minDist + (rsv.r || 0);
    if (dx * dx + dy * dy < rr * rr) return false;
  }
  return true;
}

/**
 * Place molten vents along cave walls using the radial graph.
 * @param {import("./planet.js").Planet} planet
 * @param {PlanetProp[]} props
 * @returns {void}
 */
function placeMoltenVents(planet, props){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!cfg || cfg.id !== "molten") return;
  const params = planet.getPlanetParams ? planet.getPlanetParams() : null;
  if (!params) return;
  const target = Math.max(0, params.MOLTEN_VENT_COUNT || 0);
  if (target <= 0) return;

  for (let i = props.length - 1; i >= 0; i--){
    if (props[i].type === "vent") props.splice(i, 1);
  }

  const nodes = planet.radialGraph.nodes;
  const neighbors = planet.radialGraph.neighbors;
  const air = planet.airNodesBitmap;
  const moltenOuter = params.MOLTEN_RING_OUTER || 0;
  const rMin = Math.max(0, moltenOuter + 0.6);
  const rMax = Math.max(rMin + 0.5, params.RMAX - 0.6);
  const minDist = 0.9;
  /** @type {Array<{x:number,y:number,r:number}>} */
  const reservations = [];
  const baseReserve = Math.max(0.4, GAME.MINER_MIN_SEP * 0.6);
  for (const p of props){
    if (p.dead) continue;
    if (p.type === "vent") continue;
    if (p.type === "turret_pad") continue;
    reservations.push({ x: p.x, y: p.y, r: baseReserve });
  }

  /** @type {Array<{n:{x:number,y:number,r:number,i:number},rockNeighbor:{x:number,y:number,r:number,i:number}|null,nx:number,ny:number}>} */
  const candidates = [];
  for (let i = 0; i < nodes.length; i++){
    if (!air[i]) continue;
    const n = nodes[i];
    const r = Math.hypot(n.x, n.y);
    if (r < rMin || r > rMax) continue;
    if (!isFarFromReservations(n.x, n.y, minDist, reservations)) continue;
    const neigh = neighbors[i] || [];
    let airCount = 0;
    let rockNeighbor = null;
    let rockDist2 = Infinity;
    for (const e of neigh){
      if (air[e.to]) airCount++;
      else {
        const nb = nodes[e.to];
        if (nb){
          const dx = n.x - nb.x;
          const dy = n.y - nb.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < rockDist2){
            rockDist2 = d2;
            rockNeighbor = nb;
          }
        }
      }
    }
    if (airCount < 3 || !rockNeighbor) continue;
    const dxr = n.x - rockNeighbor.x;
    const dyr = n.y - rockNeighbor.y;
    const nlen = Math.hypot(dxr, dyr) || 1;
    const nx = dxr / nlen;
    const ny = dyr / nlen;
    candidates.push({ n, rockNeighbor, nx, ny });
  }

  const rand = mulberry32((planet.getSeed() + 991) | 0);
  for (let i = candidates.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }

  /** @type {Array<{n:{x:number,y:number,r:number,i:number},rockNeighbor:{x:number,y:number,r:number,i:number}|null,nx:number,ny:number}>} */
  const picked = [];
  for (const c of candidates){
    const n = c.n;
    let tooClose = false;
    for (const p of picked){
      const dx = n.x - p.n.x;
      const dy = n.y - p.n.y;
      if (dx * dx + dy * dy < minDist * minDist){
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    picked.push(c);
    if (picked.length >= target) break;
  }

  const recess = 0.08;
  for (const entry of picked){
    if (!entry.rockNeighbor) continue;
    const n = entry.n;
    const rn = entry.rockNeighbor;
    const nx = entry.nx;
    const ny = entry.ny;
    let lo = { x: rn.x, y: rn.y };
    let hi = { x: n.x, y: n.y };
    for (let i = 0; i < 8; i++){
      const mx = (lo.x + hi.x) * 0.5;
      const my = (lo.y + hi.y) * 0.5;
      if (planet.airValueAtWorld(mx, my) > 0.5){
        hi = { x: mx, y: my };
      } else {
        lo = { x: mx, y: my };
      }
    }
    const bx = hi.x - nx * recess;
    const by = hi.y - ny * recess;
    const rot = Math.atan2(ny, nx) - Math.PI * 0.5;
    const scale = 0.55 + rand() * 0.25;
    props.push({ type: "vent", x: bx, y: by, scale, rot, nx, ny });
  }
}

/**
 * Remove molten vents that would fire directly into target points.
 * @param {import("./planet.js").Planet} planet
 * @param {PlanetProp[]} props
 * @param {Array<{x:number,y:number}>} points
 * @returns {number}
 */
function pruneMoltenVentsAgainstPoints(planet, props, points){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!cfg || cfg.id !== "molten") return 0;
  if (!props || !props.length) return 0;
  if (!points || !points.length) return 0;
  const inFront = (vx, vy, nx, ny, px, py, maxDist, cosLimit, maxSide) => {
    const dx = px - vx;
    const dy = py - vy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= 1e-6 || d2 > maxDist * maxDist) return false;
    const d = Math.sqrt(d2);
    const dir = (dx * nx + dy * ny) / d;
    if (dir < cosLimit) return false;
    const side = Math.abs(dx * -ny + dy * nx);
    return side <= maxSide;
  };
  let removed = 0;
  for (let i = props.length - 1; i >= 0; i--){
    const p = props[i];
    if (p.type !== "vent" || p.dead) continue;
    const nx = (typeof p.nx === "number") ? p.nx : 0;
    const ny = (typeof p.ny === "number") ? p.ny : 0;
    const nlen = Math.hypot(nx, ny) || 1;
    const ux = nx / nlen;
    const uy = ny / nlen;
    let bad = false;
    for (const t of points){
      if (inFront(p.x, p.y, ux, uy, t.x, t.y, 7.5, 0.6, 0.9)){
        bad = true;
        break;
      }
    }
    if (bad){
      props.splice(i, 1);
      removed++;
    }
  }
  return removed;
}

/**
 * @typedef {Object} FeatureCallbacks
 * @property {(info:{x:number,y:number,life:number,radius:number})=>void} [onExplosion]
 * @property {(info:{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number})=>void} [onDebris]
 * @property {(x:number,y:number,radius:number)=>void} [onAreaDamage]
 * @property {(amount:number)=>void} [onShipHeat]
 * @property {(x:number,y:number)=>void} [onShipCrash]
 * @property {(duration:number)=>void} [onShipConfuse]
 */

/**
 * @typedef {Object} FeatureUpdateState
 * @property {import("./types.d.js").Ship} ship
 * @property {Array<{x:number,y:number,hp:number,hitT?:number}>} enemies
 * @property {import("./types.d.js").Miner[]} miners
 * @property {(x:number,y:number)=>void} [onShipDamage]
 * @property {(amount:number)=>void} [onShipHeat]
 * @property {(enemy:{x:number,y:number,hp:number,hitT?:number}, x:number, y:number)=>void} [onEnemyHit]
 * @property {(miner:import("./types.d.js").Miner)=>void} [onMinerKilled]
 */

/**
 * @param {import("./planet.js").Planet} planet
 * @param {PlanetProp[]} props
 * @param {{burst:(prop:PlanetProp)=>{x:number,y:number,scale:number}|null, hitAt:(x:number,y:number,radius:number)=>PlanetProp|null, burstAllInRadius:(x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>, breakIfExposed:(planet:import("./planet.js").Planet, x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>}|null} iceShardHazard
 * @param {{burst:(prop:PlanetProp)=>{x:number,y:number,scale:number}|null, hitAt:(x:number,y:number,radius:number)=>PlanetProp|null, burstAllInRadius:(x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>}|null} mushroomHazard
 */
export function createPlanetFeatures(planet, props, iceShardHazard, mushroomHazard){
 const tuning = {
    iceShard: {
      blast: 0.8,
      damage: 0.9,
      pieces: 8,
      debrisLifeMin: 0.8,
      debrisLifeMax: 0.7,
      debrisSpeedMin: 1.2,
      debrisSpeedMax: 2.0,
    },
    lava: {
      life: 1.4,
      speed: 2.8,
      radius: 0.22,
      burstRate: 18,
      flashDuration: 2.0,
      ventPeriod: 6.5,
      heatHit: 14,
    },
    coreHeatRadius: 2.0,
    coreHeatRise: 22,
    coreHeatDecay: 10,
    mushroom: {
      life: 1.0,
      speed: 4.0,
      radius: 0.25,
      pieces: 12,
      confuseTime: 5.0,
    },
  };

  const particles = {
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    lava: [],
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    mushroom: [],
  };

  placeMoltenVents(planet, props || []);
  const ventReserve = (props || []).filter((p) => p.type === "vent").map((p) => ({ x: p.x, y: p.y }));
  if (ventReserve.length && planet.reserveSpawnPoints){
    const minDist = Math.max(0.4, GAME.MINER_MIN_SEP * 0.6);
    planet.reserveSpawnPoints(ventReserve, minDist);
  }
  let ventsPruned = false;

  /**
   * @param {{x:number,y:number,scale:number}|null} info
   * @param {FeatureCallbacks} callbacks
   */
  const emitIceShardBurst = (info, callbacks) => {
    if (!info) return;
    const x = info.x;
    const y = info.y;
    if (callbacks.onExplosion){
      callbacks.onExplosion({ x, y, life: 0.5, radius: tuning.iceShard.blast });
    }
    if (callbacks.onAreaDamage){
      callbacks.onAreaDamage(x, y, tuning.iceShard.damage);
    }
    if (callbacks.onDebris){
      const pieces = tuning.iceShard.pieces;
      for (let i = 0; i < pieces; i++){
        const ang = Math.random() * Math.PI * 2;
        const sp = tuning.iceShard.debrisSpeedMin + Math.random() * tuning.iceShard.debrisSpeedMax;
        callbacks.onDebris({
          x: x + Math.cos(ang) * 0.08,
          y: y + Math.sin(ang) * 0.08,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          a: Math.random() * Math.PI * 2,
          w: (Math.random() - 0.5) * 8,
          life: tuning.iceShard.debrisLifeMin + Math.random() * tuning.iceShard.debrisLifeMax,
        });
      }
    }
  };

  /**
   * @param {{x:number,y:number,scale:number}} info
   */
  const spawnMushroomBurst = (info) => {
    if (!info) return;
    const { x, y } = info;
    const pieces = tuning.mushroom.pieces;
    for (let i = 0; i < pieces; i++){
      const ang = (i / pieces) * Math.PI * 2 + Math.random() * 0.4;
      const sp = tuning.mushroom.speed * (0.8 + Math.random() * 0.4);
      particles.mushroom.push({
        x,
        y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: tuning.mushroom.life,
      });
    }
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {FeatureCallbacks} callbacks
   * @returns {boolean}
   */
  const handleShipContact = (x, y, radius, callbacks) => {
    let hit = false;
    if (props && props.length){
      for (const p of props){
        if (p.type !== "vent" || p.dead) continue;
        const info = planet.surfaceInfoAtWorld ? planet.surfaceInfoAtWorld(p.x, p.y, 0.18) : null;
        const nx = info ? info.nx : (p.x / (Math.hypot(p.x, p.y) || 1));
        const ny = info ? info.ny : (p.y / (Math.hypot(p.x, p.y) || 1));
        const tx = -ny;
        const ty = nx;
        const dx = x - p.x;
        const dy = y - p.y;
        const localX = dx * tx + dy * ty;
        const localY = dx * nx + dy * ny;
        const s = p.scale || 1;
        const halfH = 0.45 * s;
        const halfW0 = 0.22 * s;
        const halfW1 = 0.12 * s;
        if (localY < -halfH - radius || localY > halfH + radius) continue;
        const t = Math.max(0, Math.min(1, (localY + halfH) / (2 * halfH || 1)));
        const halfW = halfW0 + (halfW1 - halfW0) * t;
        if (Math.abs(localX) <= halfW + radius){
          p.dead = true;
          if (callbacks.onShipCrash) callbacks.onShipCrash(p.x, p.y);
          hit = true;
          break;
        }
      }
    }
    if (mushroomHazard){
      const hitProp = mushroomHazard.hitAt(x, y, radius);
      if (hitProp){
        const info = mushroomHazard.burst(hitProp);
        if (info) spawnMushroomBurst(info);
        if (callbacks.onShipConfuse) callbacks.onShipConfuse(tuning.mushroom.confuseTime);
        hit = true;
      }
    }
    if (iceShardHazard){
      const hitProp = iceShardHazard.hitAt(x, y, radius);
      if (hitProp){
        const info = iceShardHazard.burst(hitProp);
        emitIceShardBurst(info, callbacks);
        hit = true;
      }
    }
    return hit;
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {FeatureCallbacks} callbacks
   * @returns {boolean}
   */
  const handleShot = (x, y, radius, callbacks) => {
    let hit = false;
    if (iceShardHazard){
      const hitProp = iceShardHazard.hitAt(x, y, radius);
      if (hitProp){
        const info = iceShardHazard.burst(hitProp);
        emitIceShardBurst(info, callbacks);
        hit = true;
      }
    }
    if (mushroomHazard){
      const hitProp = mushroomHazard.hitAt(x, y, radius);
      if (hitProp){
        const info = mushroomHazard.burst(hitProp);
        if (info) spawnMushroomBurst(info);
        hit = true;
      }
    }
    return hit;
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} impactRadius
   * @param {number} bombRadius
   * @param {FeatureCallbacks} callbacks
   * @returns {boolean}
   */
  const handleBomb = (x, y, impactRadius, bombRadius, callbacks) => {
    let hit = false;
    if (iceShardHazard){
      const exposed = iceShardHazard.breakIfExposed(planet, x, y, impactRadius + 0.4);
      for (const info of exposed){
        emitIceShardBurst(info, callbacks);
        hit = true;
      }
      const direct = iceShardHazard.burstAllInRadius(x, y, bombRadius);
      for (const info of direct){
        emitIceShardBurst(info, callbacks);
        hit = true;
      }
    }
    if (mushroomHazard){
      const bursts = mushroomHazard.burstAllInRadius(x, y, bombRadius);
      if (bursts.length){
        hit = true;
        for (const info of bursts) spawnMushroomBurst(info);
      }
    }
    return hit;
  };

  /**
   * @param {number} dt
   * @param {FeatureUpdateState} state
   */
  const updateCoreHeat = (dt, state) => {
    const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
    if (!cfg || cfg.id !== "molten") return;
    const coreR = planet.getCoreRadius();
    if (coreR <= 0) return;
    const heatR = coreR + tuning.coreHeatRadius;
    const heatR2 = heatR * heatR;
    const ship = state.ship;
    if (ship){
      const shipR2 = ship.x * ship.x + ship.y * ship.y;
      const shipR = Math.sqrt(shipR2);
      const inHeat = shipR2 <= heatR2;
      if (ship.heat === undefined) ship.heat = 0;
      if (inHeat){
        const t = Math.max(0, Math.min(1, 1 - (shipR - coreR) / Math.max(0.001, tuning.coreHeatRadius)));
        ship.heat = Math.min(100, ship.heat + tuning.coreHeatRise * t * dt);
      } else {
        ship.heat = Math.max(0, ship.heat - tuning.coreHeatDecay * dt);
      }
    }

    const coreR2 = coreR * coreR;
    if (state.enemies){
      for (let i = state.enemies.length - 1; i >= 0; i--){
        const e = state.enemies[i];
        const r2 = e.x * e.x + e.y * e.y;
        if (r2 <= coreR2) e.hp = 0;
      }
    }
    if (state.miners){
      for (let i = state.miners.length - 1; i >= 0; i--){
        const m = state.miners[i];
        const r2 = m.x * m.x + m.y * m.y;
        if (r2 <= coreR2){
          state.miners.splice(i, 1);
          if (state.onMinerKilled) state.onMinerKilled(m);
        }
      }
    }
  };

  /**
   * @param {number} dt
   */
  const updateVents = (dt) => {
    if (!props || !props.length) return;
    for (const p of props){
      if (p.type !== "vent") continue;
      p.ventT = (p.ventT || 0) + dt;
      const phase = (p.ventT % tuning.lava.ventPeriod);
      const active = phase >= (tuning.lava.ventPeriod - tuning.lava.flashDuration);
      p.ventHeat = active ? 1 : 0;
      if (!active) continue;
      const rate = tuning.lava.burstRate * dt;
      const emitCount = Math.max(0, Math.floor(rate));
      const frac = rate - emitCount;
      const total = emitCount + (Math.random() < frac ? 1 : 0);
      let nx = (typeof p.nx === "number") ? p.nx : 0;
      let ny = (typeof p.ny === "number") ? p.ny : 0;
      if (!nx && !ny){
        const info = planet.surfaceInfoAtWorld ? planet.surfaceInfoAtWorld(p.x, p.y, 0.18) : null;
        nx = info ? info.nx : (p.x / (Math.hypot(p.x, p.y) || 1));
        ny = info ? info.ny : (p.y / (Math.hypot(p.x, p.y) || 1));
      }
      const nlen = Math.hypot(nx, ny) || 1;
      nx /= nlen;
      ny /= nlen;
      const tx = -ny;
      const ty = nx;
      for (let i = 0; i < total; i++){
        const jitter = (Math.random() * 2 - 1) * 0.25;
        const spread = (Math.random() * 2 - 1) * 0.35;
        const vx = (nx + tx * spread) * tuning.lava.speed;
        const vy = (ny + ty * spread) * tuning.lava.speed;
        particles.lava.push({
          x: p.x + nx * 0.12,
          y: p.y + ny * 0.12,
          vx: vx + jitter * 0.4,
          vy: vy + jitter * 0.4,
          life: tuning.lava.life,
        });
      }
    }
  };

  /**
   * @param {number} dt
   * @param {FeatureUpdateState} state
   */
  const updateLavaParticles = (dt, state) => {
    const lava = particles.lava;
    if (!lava.length) return;
    const hitR2 = tuning.lava.radius * tuning.lava.radius;
    for (let i = lava.length - 1; i >= 0; i--){
      const p = lava[i];
      const { x: gx, y: gy } = planet.gravityAt(p.x, p.y);
      p.vx += gx * dt;
      p.vy += gy * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0 || planet.airValueAtWorld(p.x, p.y) <= 0.5){
        lava.splice(i, 1);
        continue;
      }
      if (state.ship){
        const dxs = state.ship.x - p.x;
        const dys = state.ship.y - p.y;
        if (dxs * dxs + dys * dys <= hitR2){
          if (state.onShipHeat) state.onShipHeat(tuning.lava.heatHit);
          lava.splice(i, 1);
          continue;
        }
      }
      let hit = false;
      if (state.enemies){
        for (let j = state.enemies.length - 1; j >= 0; j--){
          const e = state.enemies[j];
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          if (dx * dx + dy * dy <= hitR2){
            if (state.onEnemyHit) state.onEnemyHit(e, p.x, p.y);
            lava.splice(i, 1);
            hit = true;
            break;
          }
        }
      }
      if (hit) continue;
      if (state.miners){
        for (let j = state.miners.length - 1; j >= 0; j--){
          const m = state.miners[j];
          const dx = m.x - p.x;
          const dy = m.y - p.y;
          if (dx * dx + dy * dy <= hitR2){
            state.miners.splice(j, 1);
            if (state.onMinerKilled) state.onMinerKilled(m);
            lava.splice(i, 1);
            break;
          }
        }
      }
    }
  };

  /**
   * @param {number} dt
   * @param {FeatureUpdateState} state
   */
  const updateMushroomParticles = (dt, state) => {
    const mush = particles.mushroom;
    if (!mush.length) return;
    const hitR2 = tuning.mushroom.radius * tuning.mushroom.radius;
    for (let i = mush.length - 1; i >= 0; i--){
      const p = mush[i];
      const { x: gx, y: gy } = planet.gravityAt(p.x, p.y);
      p.vx += gx * dt;
      p.vy += gy * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        mush.splice(i, 1);
        continue;
      }
      if (!state.enemies) continue;
      for (let j = state.enemies.length - 1; j >= 0; j--){
        const e = state.enemies[j];
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        if (dx * dx + dy * dy <= hitR2){
          if (state.onEnemyHit) state.onEnemyHit(e, p.x, p.y);
          mush.splice(i, 1);
          break;
        }
      }
    }
  };

  return {
    getParticles: () => particles,
    clearParticles: () => {
      particles.lava.length = 0;
      particles.mushroom.length = 0;
    },
    reconcile: (state) => {
      if (ventsPruned) return;
      if (!state) return;
      const points = [];
      if (state.enemies){
        for (const e of state.enemies){
          points.push({ x: e.x, y: e.y });
        }
      }
      if (state.miners){
        for (const m of state.miners){
          points.push({ x: m.x, y: m.y });
        }
      }
      if (!points.length) return;
      pruneMoltenVentsAgainstPoints(planet, props, points);
      ventsPruned = true;
    },
    update: (dt, state) => {
      updateCoreHeat(dt, state);
      updateVents(dt);
      updateLavaParticles(dt, state);
      updateMushroomParticles(dt, state);
    },
    handleShipContact,
    handleShot,
    handleBomb,
  };
}

/** @typedef {import("./types.d.js").Vec2} Vec2 */

/**
 * @typedef {Object} PlanetProp
 * @property {string} type
 * @property {number} x
 * @property {number} y
 * @property {number} scale
 * @property {number} rot
 * @property {number} [rotSpeed]
 * @property {number} [hp]
 * @property {boolean} [dead]
 * @property {number} [mushT]
 * @property {number} [padNx]
 * @property {number} [padNy]
 * @property {number} [ventT]
 * @property {number} [ventHeat]
 * @property {number} [nx]
 * @property {number} [ny]
 */

/**
 * Build material grid + props for a planet.
 * @param {import("./mapgen.js").MapGen} mapgen
 * @param {import("./planet_config.js").PlanetConfig} planetConfig
 * @param {import("./planet_config.js").PlanetParams} params
 * @returns {{material: Uint8Array, props: PlanetProp[]}}
 */
export function buildPlanetMaterials(mapgen, planetConfig, params){
  const { G, inside, idx, toWorld } = mapgen.grid;
  const world = mapgen.getWorld();
  const air = world.air;
  const material = new Uint8Array(G * G);

  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++){
    const k = idx(i, j);
    if (!inside[k]) continue;
    const [x, y] = toWorld(i, j);
    const r = Math.hypot(x, y);
    const coreR = (params.CORE_RADIUS > 1) ? params.CORE_RADIUS : (params.CORE_RADIUS * params.RMAX);
    const rf = r / params.RMAX;
    const isAir = !!air[k];
    let mat = 0;

    switch (planetConfig.id){
      case "molten":
        if (!isAir && r <= Math.max(0.2, coreR)) mat = 2;
        break;
      case "ice":
        if (!isAir && rf >= Math.max(0.0, 1 - params.ICE_CRUST_THICKNESS)) mat = 1;
        break;
      case "gaia":
        if (!isAir && rf >= 0.58) mat = 3;
        break;
      case "water":
        if (isAir && rf <= params.WATER_LEVEL) mat = 5;
        break;
      case "mechanized": {
        if (!isAir){
          const ang = Math.atan2(y, x);
          const band = (ang / (Math.PI * 2) + 1) % 1;
          if (band < 0.12 && rf >= 0.45 && rf <= 0.9) mat = 4;
        }
        break;
      }
      default:
        break;
    }
    material[k] = mat;
  }

  const props = buildProps(mapgen, planetConfig, params, material);
  return { material, props };
}

/**
 * @param {import("./mapgen.js").MapGen} mapgen
 * @param {import("./planet_config.js").PlanetConfig} planetConfig
 * @param {import("./planet_config.js").PlanetParams} params
 * @param {Uint8Array} material
 * @returns {PlanetProp[]}
 */
function buildProps(mapgen, planetConfig, params, material){
  const rng = mulberry32((mapgen.getWorld().seed + params.RMAX * 97) | 0);
  /** @type {PlanetProp[]} */
  const props = [];

  const surface = sampleSurfacePoints(mapgen, params, 120);

  /**@type {(type:string, x:number, y:number, scale:number, rot:number, rotSpeed?:number, extra?:Object)=>void} */
  const add = (type, x, y, scale, rot, rotSpeed = 0, extra = undefined) => {
    props.push({ type, x, y, scale, rot, rotSpeed, ...(extra || {}) });
  };

  switch (planetConfig.id){
    case "barren_pickup":
    case "barren_clear": {
      const count = Math.max(1, planetConfig.platformCount || 10);
      for (let i = 0; i < count; i++){
        const a = (i / count) * Math.PI * 2;
        const r = params.RMAX * 0.98;
        add("turret_pad", Math.cos(a) * r, Math.sin(a) * r, 0.55, a, 0);
      }
      break;
    }
    case "no_caves": {
      for (const p of surface){
        if (rng() < 0.08) add("boulder", p[0], p[1], 0.35 + rng() * 0.3, rng() * Math.PI * 2, 0);
        if (rng() < 0.05) add("ridge_spike", p[0], p[1], 0.45 + rng() * 0.4, rng() * Math.PI * 2, 0);
      }
      break;
    }
    case "molten": {
      break;
    }
    case "ice": {
      const iceSurface = sampleSurfacePointsByMaterial(mapgen, material, 1, params, 140);
      for (const p of iceSurface){
        if (rng() < 0.14) {
          const rot = Math.atan2(p[1], p[0]);
          add("ice_shard", p[0], p[1], 0.35 + rng() * 0.4, rot, 0, { hp: 1 });
        }
      }
      break;
    }
    case "gaia": {
      for (const p of surface){
        if (rng() < 0.10) add("tree", p[0], p[1], 0.45 + rng() * 0.35, rng() * Math.PI * 2, 0);
        else if (rng() < 0.08) add("mushroom", p[0], p[1], 0.35 + rng() * 0.25, rng() * Math.PI * 2, 0, { hp: 1 });
      }
      break;
    }
    case "water": {
      for (const p of surface){
        if (rng() < 0.10) add("bubble_hex", p[0], p[1], 0.35 + rng() * 0.3, rng() * Math.PI * 2, (rng() * 1.6 - 0.8));
      }
      break;
    }
    case "cavern": {
      const cave = sampleCaveBoundaryPoints(mapgen, params, 80);
      for (const p of cave){
        if (rng() < 0.10) add("stalactite", p[0], p[1], 0.35 + rng() * 0.4, rng() * Math.PI * 2, 0);
      }
      break;
    }
    case "mechanized": {
      for (const p of surface){
        if (rng() < 0.08) add("gate", p[0], p[1], 0.55 + rng() * 0.3, rng() * Math.PI * 2, 0);
        else if (rng() < 0.06) add("factory", p[0], p[1], 0.55 + rng() * 0.4, rng() * Math.PI * 2, 0);
      }
      break;
    }
    default:
      break;
  }

  return props;
}

/**
 * Ice shard hazard helpers.
 * @param {PlanetProp[]} props
 * @returns {{
 *  burst:(prop:PlanetProp)=>{x:number,y:number,scale:number}|null,
 *  hitAt:(x:number,y:number,radius:number)=>PlanetProp|null,
 *  burstAllInRadius:(x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>,
 *  breakIfExposed:(planet:import("./planet.js").Planet, x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>
 * }}
 */
export function createIceShardHazard(props){
  /**
   * @param {PlanetProp} p
   */
  const isAliveShard = (p) => p.type === "ice_shard" && !p.dead && !(typeof p.hp === "number" && p.hp <= 0);
  const burstProp = (prop) => {
    if (!isAliveShard(prop)) return null;
    prop.dead = true;
    prop.hp = 0;
    return { x: prop.x, y: prop.y, scale: prop.scale || 1 };
  };
  return {
    burst: (prop) => {
      return burstProp(prop);
    },
    hitAt: (x, y, radius) => {
      for (const p of props){
        if (!isAliveShard(p)) continue;
        const sr = 0.32 * (p.scale || 1);
        const dx = p.x - x;
        const dy = p.y - y;
        const r2 = (radius + sr) * (radius + sr);
        if (dx * dx + dy * dy <= r2){
          return p;
        }
      }
      return null;
    },
    burstAllInRadius: (x, y, radius) => {
      /** @type {Array<{x:number,y:number,scale:number}>} */
      const bursts = [];
      for (const p of props){
        if (!isAliveShard(p)) continue;
        const sr = 0.32 * (p.scale || 1);
        const dx = p.x - x;
        const dy = p.y - y;
        const r2 = (radius + sr) * (radius + sr);
        if (dx * dx + dy * dy <= r2){
          const info = burstProp(p);
          if (info) bursts.push(info);
        }
      }
      return bursts;
    },
    breakIfExposed: (planet, x, y, radius) => {
      /** @type {Array<{x:number,y:number,scale:number}>} */
      const bursts = [];
      for (const p of props){
        if (!isAliveShard(p)) continue;
        const sr = 0.32 * (p.scale || 1);
        const dx = p.x - x;
        const dy = p.y - y;
        const r2 = (radius + sr) * (radius + sr);
        if (dx * dx + dy * dy > r2) continue;
        if (planet.airValueAtWorld(p.x, p.y) > 0.5){
          const info = burstProp(p);
          if (info) bursts.push(info);
        }
      }
      return bursts;
    },
  };
}

/**
 * @param {PlanetProp[]} props
 * @returns {{burst:(prop:PlanetProp)=>{x:number,y:number,scale:number}|null, hitAt:(x:number,y:number,radius:number)=>PlanetProp|null, burstAllInRadius:(x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>}}
 */
export function createMushroomHazard(props){
  const isAlive = (p) => p.type === "mushroom" && !p.dead && !(typeof p.hp === "number" && p.hp <= 0);
  const burstProp = (prop) => {
    if (!isAlive(prop)) return null;
    prop.dead = true;
    prop.hp = 0;
    return { x: prop.x, y: prop.y, scale: prop.scale || 1 };
  };
  return {
    burst: (prop) => burstProp(prop),
    hitAt: (x, y, radius) => {
      for (const p of props){
        if (!isAlive(p)) continue;
        const sr = 0.28 * (p.scale || 1);
        const dx = p.x - x;
        const dy = p.y - y;
        const r2 = (radius + sr) * (radius + sr);
        if (dx * dx + dy * dy <= r2){
          return p;
        }
      }
      return null;
    },
    burstAllInRadius: (x, y, radius) => {
      /** @type {Array<{x:number,y:number,scale:number}>} */
      const bursts = [];
      for (const p of props){
        if (!isAlive(p)) continue;
        const sr = 0.28 * (p.scale || 1);
        const dx = p.x - x;
        const dy = p.y - y;
        const r2 = (radius + sr) * (radius + sr);
        if (dx * dx + dy * dy <= r2){
          const info = burstProp(p);
          if (info) bursts.push(info);
        }
      }
      return bursts;
    },
  };
}

/**
 * @param {import("./mapgen.js").MapGen} mapgen
 * @param {import("./planet_config.js").PlanetParams} params
 * @param {number} limit
 * @returns {Vec2[]}
 */
function sampleSurfacePoints(mapgen, params, limit){
  const { G, inside, idx, toWorld } = mapgen.grid;
  const air = mapgen.getWorld().air;
  /** @type {Vec2[]} */
  const pts = [];
  for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++){
    const k = idx(i, j);
    if (!inside[k]) continue;
    if (air[k]) continue;
    const kk0 = idx(i + 1, j);
    const kk1 = idx(i - 1, j);
    const kk2 = idx(i, j + 1);
    const kk3 = idx(i, j - 1);
    const touchesOutside = !inside[kk0] || !inside[kk1] || !inside[kk2] || !inside[kk3];
    const touchesAir = air[kk0] || air[kk1] || air[kk2] || air[kk3];
    if (!touchesOutside && !touchesAir) continue;
    const [x, y] = toWorld(i, j);
    const r = Math.hypot(x, y);
    if (r < params.RMAX * 0.75) continue;
    pts.push([x, y]);
    if (pts.length >= limit) return pts;
  }
  return pts;
}

/**
 * @param {import("./mapgen.js").MapGen} mapgen
 * @param {Uint8Array} material
 * @param {number} matId
 * @param {import("./planet_config.js").PlanetParams} params
 * @param {number} limit
 * @returns {Vec2[]}
 */
function sampleSurfacePointsByMaterial(mapgen, material, matId, params, limit){
  const { G, inside, idx, toWorld } = mapgen.grid;
  const air = mapgen.getWorld().air;
  /** @type {Vec2[]} */
  const pts = [];
  for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++){
    const k = idx(i, j);
    if (!inside[k]) continue;
    if (air[k]) continue;
    if (material[k] !== matId) continue;
    const kk0 = idx(i + 1, j);
    const kk1 = idx(i - 1, j);
    const kk2 = idx(i, j + 1);
    const kk3 = idx(i, j - 1);
    const touchesOutside = !inside[kk0] || !inside[kk1] || !inside[kk2] || !inside[kk3];
    const touchesAir = air[kk0] || air[kk1] || air[kk2] || air[kk3];
    if (!touchesOutside && !touchesAir) continue;
    const [x, y] = toWorld(i, j);
    const r = Math.hypot(x, y);
    if (r < params.RMAX * 0.75) continue;
    pts.push([x, y]);
    if (pts.length >= limit) return pts;
  }
  return pts;
}

/**
 * @param {import("./mapgen.js").MapGen} mapgen
 * @param {import("./planet_config.js").PlanetParams} params
 * @param {number} limit
 * @returns {Vec2[]}
 */
function sampleCaveBoundaryPoints(mapgen, params, limit){
  const { G, inside, idx, toWorld } = mapgen.grid;
  const air = mapgen.getWorld().air;
  /** @type {Vec2[]} */
  const pts = [];
  for (let j = 1; j < G - 1; j++) for (let i = 1; i < G - 1; i++){
    const k = idx(i, j);
    if (!inside[k]) continue;
    if (air[k]) continue;
    const kk0 = idx(i + 1, j);
    const kk1 = idx(i - 1, j);
    const kk2 = idx(i, j + 1);
    const kk3 = idx(i, j - 1);
    const touchesAir = air[kk0] || air[kk1] || air[kk2] || air[kk3];
    if (!touchesAir) continue;
    const [x, y] = toWorld(i, j);
    const r = Math.hypot(x, y);
    if (r > params.RMAX * 0.9) continue;
    pts.push([x, y]);
    if (pts.length >= limit) return pts;
  }
  return pts;
}
