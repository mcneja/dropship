// @ts-check

import { mulberry32 } from "./rng.js";
import { GAME } from "./config.js";
import { lineOfSightAir } from "./navigation.js";

/** @typedef {{x:number,y:number,r:number,i:number,navPadded?:boolean}} RadialNode */
/** @typedef {{to:number}} NavEdgeRef */
/** @typedef {{n:RadialNode,rockNeighbor:RadialNode,nx:number,ny:number}} WallAttachCandidate */
/** @typedef {import("./types.d.js").DestroyedTerrainNode} DestroyedTerrainNode */
/** @typedef {import("./types.d.js").DetachedTerrainProp} DetachedTerrainProp */

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
    const prop = /** @type {PlanetProp} */ (props[i]);
    if (prop.type === "vent") props.splice(i, 1);
  }

  /** @type {RadialNode[]} */
  const nodes = planet.radialGraph.nodes;
  /** @type {NavEdgeRef[][]} */
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

  /** @type {WallAttachCandidate[]} */
  const candidates = [];
  for (let i = 0; i < nodes.length; i++){
    if (!air[i]) continue;
    const n = /** @type {RadialNode} */ (nodes[i]);
    const r = Math.hypot(n.x, n.y);
    if (r < rMin || r > rMax) continue;
    if (!isFarFromReservations(n.x, n.y, minDist, reservations)) continue;
    const neigh = /** @type {NavEdgeRef[]} */ (neighbors[i] || []);
    let airCount = 0;
    /** @type {RadialNode|null} */
    let rockNeighbor = null;
    let rockDist2 = Infinity;
    for (const e of neigh){
      if (air[e.to]) airCount++;
      else {
        const nb = /** @type {RadialNode} */ (nodes[e.to]);
        const dx = n.x - nb.x;
        const dy = n.y - nb.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < rockDist2){
          rockDist2 = d2;
          rockNeighbor = nb;
        }
      }
    }
    if (airCount < 3 || !rockNeighbor) continue;
    const dxr = n.x - rockNeighbor.x;
    const dyr = n.y - rockNeighbor.y;
    const nlen = Math.hypot(dxr, dyr) || 1;
    const nx = dxr / nlen;
    const ny = dyr / nlen;
    candidates.push({ n, rockNeighbor: /** @type {RadialNode} */ (rockNeighbor), nx, ny });
  }

  const rand = mulberry32((planet.getSeed() + 991) | 0);
  for (let i = candidates.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    const tmp = /** @type {WallAttachCandidate} */ (candidates[i]);
    candidates[i] = /** @type {WallAttachCandidate} */ (candidates[j]);
    candidates[j] = tmp;
  }

  /** @type {WallAttachCandidate[]} */
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
    props.push({
      type: "vent",
      x: bx,
      y: by,
      scale,
      rot,
      nx,
      ny,
      supportX: hi.x,
      supportY: hi.y,
      supportNodeIndex: rn.i,
    });
  }
}

/**
 * Place ice shards along cave walls using the radial graph.
 * @param {import("./planet.js").Planet} planet
 * @param {PlanetProp[]} props
 * @returns {void}
 */
function placeIceShards(planet, props){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!cfg || cfg.id !== "ice") return;
  const params = planet.getPlanetParams ? planet.getPlanetParams() : null;
  if (!params) return;

  for (let i = props.length - 1; i >= 0; i--){
    const prop = /** @type {PlanetProp} */ (props[i]);
    if (prop.type === "ice_shard") props.splice(i, 1);
  }

  /** @type {RadialNode[]} */
  const nodes = planet.radialGraph.nodes;
  /** @type {NavEdgeRef[][]} */
  const neighbors = planet.radialGraph.neighbors;
  const air = planet.airNodesBitmap;
  const surfaceBand = (cfg && cfg.defaults && typeof cfg.defaults.SURFACE_BAND === "number") ? cfg.defaults.SURFACE_BAND : 0;
  const surfaceR = params.RMAX * (1 - surfaceBand);
  const surfaceExclude = Math.max(2.0, params.RMAX * 0.08);
  const rMax = Math.max(0.5, Math.min(params.RMAX - 0.6, surfaceR - surfaceExclude));
  const minDist = 0.55;
  /** @type {Array<{x:number,y:number,r:number}>} */
  const reservations = [];
  for (const p of props){
    if (p.dead) continue;
    if (p.type === "turret_pad") continue;
    reservations.push({ x: p.x, y: p.y, r: 0.35 });
  }

  /** @type {WallAttachCandidate[]} */
  const candidates = [];
  for (let i = 0; i < nodes.length; i++){
    if (!air[i]) continue;
    const n = /** @type {RadialNode} */ (nodes[i]);
    const r = Math.hypot(n.x, n.y);
    if (r > rMax) continue;
    if (!isFarFromReservations(n.x, n.y, minDist, reservations)) continue;
    const neigh = /** @type {NavEdgeRef[]} */ (neighbors[i] || []);
    /** @type {RadialNode|null} */
    let rockNeighbor = null;
    let rockDist2 = Infinity;
    for (const e of neigh){
      if (air[e.to]) continue;
      const nb = /** @type {RadialNode} */ (nodes[e.to]);
      const dx = n.x - nb.x;
      const dy = n.y - nb.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < rockDist2){
        rockDist2 = d2;
        rockNeighbor = nb;
      }
    }
    if (!rockNeighbor) continue;
    if (Math.hypot(rockNeighbor.x, rockNeighbor.y) >= surfaceR - surfaceExclude) continue;
    const dxr = n.x - rockNeighbor.x;
    const dyr = n.y - rockNeighbor.y;
    const nlen = Math.hypot(dxr, dyr) || 1;
    const nx = dxr / nlen;
    const ny = dyr / nlen;
    candidates.push({ n, rockNeighbor: /** @type {RadialNode} */ (rockNeighbor), nx, ny });
  }

  const rand = mulberry32((planet.getSeed() + 7331) | 0);
  for (let i = candidates.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    const tmp = /** @type {WallAttachCandidate} */ (candidates[i]);
    candidates[i] = /** @type {WallAttachCandidate} */ (candidates[j]);
    candidates[j] = tmp;
  }

  const target = Math.max(70, Math.min(270, Math.floor(candidates.length * 0.525)));
  /** @type {WallAttachCandidate[]} */
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

  const recess = 0.06;
  for (const entry of picked){
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
    const scale = 0.32 + rand() * 0.45;
    props.push({
      type: "ice_shard",
      x: bx,
      y: by,
      scale,
      rot,
      nx,
      ny,
      hp: 1,
      supportX: hi.x,
      supportY: hi.y,
      supportNodeIndex: rn.i,
    });
  }
}

/**
 * Place mushrooms along cave walls using the radial graph.
 * @param {import("./planet.js").Planet} planet
 * @param {PlanetProp[]} props
 * @returns {void}
 */
function placeMushrooms(planet, props){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!cfg || cfg.id !== "gaia") return;
  const params = planet.getPlanetParams ? planet.getPlanetParams() : null;
  if (!params) return;

  for (let i = props.length - 1; i >= 0; i--){
    const prop = /** @type {PlanetProp} */ (props[i]);
    if (prop.type === "mushroom") props.splice(i, 1);
  }

  /** @type {RadialNode[]} */
  const nodes = planet.radialGraph.nodes;
  /** @type {NavEdgeRef[][]} */
  const neighbors = planet.radialGraph.neighbors;
  const air = planet.airNodesBitmap;
  const surfaceBand = (cfg.defaults && typeof cfg.defaults.SURFACE_BAND === "number") ? cfg.defaults.SURFACE_BAND : 0;
  const surfaceR = params.RMAX * (1 - surfaceBand);
  const rMax = Math.max(0.5, surfaceR - 0.5);
  const minDist = 0.7;
  /** @type {Array<{x:number,y:number,r:number}>} */
  const reservations = [];
  for (const p of props){
    if (p.dead) continue;
    if (p.type === "turret_pad") continue;
    reservations.push({ x: p.x, y: p.y, r: 0.45 });
  }

  /** @type {WallAttachCandidate[]} */
  const candidates = [];
  for (let i = 0; i < nodes.length; i++){
    if (!air[i]) continue;
    const n = /** @type {RadialNode} */ (nodes[i]);
    const r = Math.hypot(n.x, n.y);
    if (r > rMax) continue;
    if (!isFarFromReservations(n.x, n.y, minDist, reservations)) continue;
    const neigh = /** @type {NavEdgeRef[]} */ (neighbors[i] || []);
    /** @type {RadialNode|null} */
    let rockNeighbor = null;
    let rockDist2 = Infinity;
    for (const e of neigh){
      if (air[e.to]) continue;
      const nb = /** @type {RadialNode} */ (nodes[e.to]);
      const dx = n.x - nb.x;
      const dy = n.y - nb.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < rockDist2){
        rockDist2 = d2;
        rockNeighbor = nb;
      }
    }
    if (!rockNeighbor) continue;
    const dxr = n.x - rockNeighbor.x;
    const dyr = n.y - rockNeighbor.y;
    const nlen = Math.hypot(dxr, dyr) || 1;
    const nx = dxr / nlen;
    const ny = dyr / nlen;
    candidates.push({ n, rockNeighbor: /** @type {RadialNode} */ (rockNeighbor), nx, ny });
  }

  const rand = mulberry32((planet.getSeed() + 3313) | 0);
  for (let i = candidates.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    const tmp = /** @type {WallAttachCandidate} */ (candidates[i]);
    candidates[i] = /** @type {WallAttachCandidate} */ (candidates[j]);
    candidates[j] = tmp;
  }

  const target = Math.max(30, Math.min(120, Math.floor(candidates.length * 0.18)));
  /** @type {WallAttachCandidate[]} */
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

  const recess = 0.04;
  for (const entry of picked){
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
    const bx = hi.x + nx * recess;
    const by = hi.y + ny * recess;
    const rot = Math.atan2(ny, nx) - Math.PI * 0.5;
    const scale = 0.28 + rand() * 0.24;
    props.push({
      type: "mushroom",
      x: bx,
      y: by,
      scale,
      rot,
      nx,
      ny,
      hp: 1,
      supportX: hi.x,
      supportY: hi.y,
      supportNodeIndex: rn.i,
    });
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
  /**
   * @param {number} vx
   * @param {number} vy
   * @param {number} nx
   * @param {number} ny
   * @param {number} px
   * @param {number} py
   * @param {number} maxDist
   * @param {number} cosLimit
   * @param {number} maxSide
   * @returns {boolean}
   */
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
    const p = /** @type {PlanetProp} */ (props[i]);
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
 * Build rock-attached bubble emitters for water worlds using radial graph boundaries.
 * @param {import("./planet.js").Planet} planet
 * @param {number} target
 * @returns {Array<{x:number,y:number,nx:number,ny:number,t:number,supportX:number,supportY:number,supportNodeIndex:number}>}
 */
function collectWaterBubbleSources(planet, target){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!cfg || cfg.id !== "water") return [];
  const params = planet.getPlanetParams ? planet.getPlanetParams() : null;
  if (!params || target <= 0) return [];
  if (!planet.radialGraph || !planet.radialGraph.nodes || !planet.radialGraph.neighbors) return [];
  /** @type {RadialNode[]} */
  const nodes = planet.radialGraph.nodes;
  /** @type {NavEdgeRef[][]} */
  const neighbors = planet.radialGraph.neighbors;
  const air = planet.airNodesBitmap || null;
  if (!air || air.length !== nodes.length) return [];

  const rings = (planet && planet.radial && planet.radial.rings) ? planet.radial.rings : null;
  const outerRingR = (rings && rings.length) ? (rings.length - 1) : Math.floor(params.RMAX);
  const mediumR = Math.max(0.8, outerRingR - 0.5);
  const rMin = Math.max(0.7, params.RMAX * 0.12);
  const minDist = 0.65;
  /** @type {Array<{x:number,y:number,nx:number,ny:number,supportX:number,supportY:number,supportNodeIndex:number}>} */
  const candidates = [];
  for (let i = 0; i < nodes.length; i++){
    if (!air[i]) continue;
    const n = /** @type {RadialNode} */ (nodes[i]);
    const r = Math.hypot(n.x, n.y);
    if (r < rMin || r > mediumR) continue;
    const neigh = /** @type {NavEdgeRef[]} */ (neighbors[i] || []);
    /** @type {RadialNode|null} */
    let rockNeighbor = null;
    let rockDist2 = Infinity;
    for (const e of neigh){
      if (air[e.to]) continue;
      const nb = /** @type {RadialNode} */ (nodes[e.to]);
      const dx = n.x - nb.x;
      const dy = n.y - nb.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < rockDist2){
        rockDist2 = d2;
        rockNeighbor = nb;
      }
    }
    if (!rockNeighbor) continue;
    const dxr = n.x - rockNeighbor.x;
    const dyr = n.y - rockNeighbor.y;
    const nlen = Math.hypot(dxr, dyr) || 1;
    const nx = dxr / nlen;
    const ny = dyr / nlen;
    const upx = n.x / (r || 1);
    const upy = n.y / (r || 1);
    const dotUp = nx * upx + ny * upy;
    if (dotUp < 0.2) continue;
    let lo = { x: rockNeighbor.x, y: rockNeighbor.y };
    let hi = { x: n.x, y: n.y };
    for (let it = 0; it < 8; it++){
      const mx = (lo.x + hi.x) * 0.5;
      const my = (lo.y + hi.y) * 0.5;
      if (planet.airValueAtWorld(mx, my) > 0.5){
        hi = { x: mx, y: my };
      } else {
        lo = { x: mx, y: my };
      }
    }
    const sx = hi.x + nx * 0.06;
    const sy = hi.y + ny * 0.06;
    if (Math.hypot(sx, sy) > mediumR - 0.03) continue;
    if (planet.airValueAtWorld(sx, sy) <= 0.5) continue;
    if (planet.airValueAtWorld(sx + upx * 0.20, sy + upy * 0.20) <= 0.5) continue;
    candidates.push({ x: sx, y: sy, nx, ny, supportX: hi.x, supportY: hi.y, supportNodeIndex: rockNeighbor.i });
  }

  const rand = mulberry32((planet.getSeed() + 14011) | 0);
  for (let i = candidates.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    const tmp = /** @type {{x:number,y:number,nx:number,ny:number,supportX:number,supportY:number,supportNodeIndex:number}} */ (candidates[i]);
    candidates[i] = /** @type {{x:number,y:number,nx:number,ny:number,supportX:number,supportY:number,supportNodeIndex:number}} */ (candidates[j]);
    candidates[j] = tmp;
  }

  /** @type {Array<{x:number,y:number,nx:number,ny:number,t:number,supportX:number,supportY:number,supportNodeIndex:number}>} */
  const picked = [];
  for (const c of candidates){
    let tooClose = false;
    for (const p of picked){
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      if (dx * dx + dy * dy < minDist * minDist){
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    picked.push({
      x: c.x,
      y: c.y,
      nx: c.nx,
      ny: c.ny,
      t: rand() * 2.2,
      supportX: c.supportX,
      supportY: c.supportY,
      supportNodeIndex: c.supportNodeIndex,
    });
    if (picked.length >= target) break;
  }
  return picked;
}

/**
 * @typedef {Object} FeatureCallbacks
 * @property {(info:{x:number,y:number,life:number,radius:number})=>void} [onExplosion]
 * @property {(info:{x:number,y:number,vx:number,vy:number,a:number,w:number,life:number})=>void} [onDebris]
 * @property {(x:number,y:number,radius:number)=>void} [onAreaDamage]
 * @property {(x:number,y:number)=>void} [onShipDamage]
 * @property {(amount:number)=>void} [onShipHeat]
 * @property {()=>void} [onShipCrash]
 * @property {(duration:number)=>void} [onShipConfuse]
 * @property {(enemy:{x:number,y:number,hp:number,hitT?:number,stunT?:number}, x:number, y:number)=>void} [onEnemyHit]
 * @property {(enemy:{x:number,y:number,hp:number,hitT?:number,stunT?:number}, duration:number, source?:"mushroom"|"lava")=>void} [onEnemyStun]
 * @property {(miner:import("./types.d.js").Miner)=>void} [onMinerKilled]
 * @property {(amount:number)=>void} [onScreenShake]
 * @property {(weak:number, strong:number, durationMs?:number)=>void} [onRumble]
 */

/**
 * @typedef {Object} FeatureUpdateState
 * @property {import("./types.d.js").Ship} ship
 * @property {Array<{x:number,y:number,hp:number,hitT?:number,stunT?:number}>} enemies
 * @property {import("./types.d.js").Miner[]} miners
 * @property {(x:number,y:number)=>void} [onShipDamage]
 * @property {(amount:number)=>void} [onShipHeat]
 * @property {(duration:number)=>void} [onShipConfuse]
 * @property {(enemy:{x:number,y:number,hp:number,hitT?:number,stunT?:number}, x:number, y:number)=>void} [onEnemyHit]
 * @property {(enemy:{x:number,y:number,hp:number,hitT?:number,stunT?:number}, duration:number, source?:"mushroom"|"lava")=>void} [onEnemyStun]
 * @property {(miner:import("./types.d.js").Miner)=>void} [onMinerKilled]
 * @property {(amount:number)=>void} [onScreenShake]
 * @property {(weak:number, strong:number, durationMs?:number)=>void} [onRumble]
 */

/**
 * @param {import("./planet.js").Planet} planet
 * @param {PlanetProp[]} props
 * @param {{burst:(prop:PlanetProp)=>{x:number,y:number,scale:number,nx:number,ny:number}|null, hitAt:(x:number,y:number,radius:number)=>PlanetProp|null, burstAllInRadius:(x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number,nx:number,ny:number}>, breakIfExposed:(planet:import("./planet.js").Planet, x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number,nx:number,ny:number}>}|null} iceShardHazard
 * @param {{burst:(prop:PlanetProp)=>{x:number,y:number,scale:number}|null, hitAt:(x:number,y:number,radius:number)=>PlanetProp|null, burstAllInRadius:(x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>, breakIfExposed:(planet:import("./planet.js").Planet, x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>}|null} ridgeSpikeHazard
 * @param {{burst:(prop:PlanetProp)=>{x:number,y:number,scale:number}|null, hitAt:(x:number,y:number,radius:number)=>PlanetProp|null, listInRadius?:(x:number,y:number,radius:number)=>PlanetProp[], burstAllInRadius:(x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>, breakIfExposed:(planet:import("./planet.js").Planet, x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>}|null} mushroomHazard
 */
export function createPlanetFeatures(planet, props, iceShardHazard, ridgeSpikeHazard, mushroomHazard){
 const tuning = {
    iceShard: {
      blast: 0.55,
      piecesMin: 3,
      piecesMax: 6,
      range: 5.0,
      speedMin: 6.0,
      speedMax: 9.0,
      radius: 0.22,
      sizeMin: 0.13,
      sizeMax: 0.22,
      spread: 0.78,
    },
    ridgeSpike: {
      blast: 0.36,
      pieces: 6,
      debrisLifeMin: 0.7,
      debrisLifeMax: 0.55,
      debrisSpeedMin: 1.0,
      debrisSpeedMax: 1.6,
    },
    lava: {
      life: 1.4,
      speed: 2.8,
      radius: 0.22,
      burstRate: 18,
      flashDuration: 2.0,
      ventPeriod: 6.5,
      heatHit: 14,
      stunTime: 0.9,
      ventContactHeatRise: 24,
      unsafeReach: 2.0,
      unsafeBaseWidth: 0.34,
      unsafeWidthGrow: 0.18,
      enemyAvoidAfterLaunchGrace: 1.0,
      enemyAvoidBeforeLaunchGrace: 1.0,
      shotTriggerDuration: 1.0,
      shotTriggerKick: 0.18,
      bombTriggerDuration: 5.0,
      bombTriggerKick: 0.45,
      bombRateMul: 2.35,
      bombSpeedMul: 1.45,
      terrainBurstCount: 5,
      terrainBurstCountJitter: 3,
      terrainSpeedMul: 1.18,
      terrainVentChance: 0.16,
      terrainVentMinDist: 1.05,
      terrainVentKick: 0.35,
      terrainVentRateMul: 1.2,
      terrainVentSpeedMul: 1.08,
    },
    tremor: {
      searchRadius: 1.6,
      minSeparation: 0.55,
      emitterLifeMin: 0.65,
      emitterLifeMax: 1.15,
      burstRate: 40,
      speedMin: 3.8,
      speedMax: 6.0,
      radius: 0.24,
      sizeMin: 0.11,
      sizeMax: 0.19,
      lifeMin: 0.42,
      lifeMax: 0.72,
      bombCountMin: 2,
      bombCountMax: 4,
      crawlerCountMin: 1,
      crawlerCountMax: 3,
      shipShake: 0.62,
      rumbleWeak: 0.45,
      rumbleStrong: 0.9,
      rumbleMs: 360,
      debrisPieces: 14,
      debrisSpeedMin: 1.0,
      debrisSpeedMax: 2.8,
      contactHeat: 10,
    },
    // Wider hot-core heat falloff so the danger zone reaches farther from the core.
    coreHeatRadius: 3.2,
    coreHeatRise: 22,
    coreHeatDecay: 10,
    mushroom: {
      lifeMin: 2.0,
      lifeMax: 3.0,
      speed: 4.0,
      radius: 0.25,
      pieces: 12,
      confuseTime: 5.0,
      stunTime: 3.0,
    },
    water: {
      sourceRate: 2.1,
      sourceJitter: 0.45,
      shipRateMin: 0.07,
      shipRateMax: 0.22,
      rise: 1.25,
      drift: 0.32,
      lifeMin: 1.2,
      lifeMax: 2.0,
      sizeMin: 0.032,
      sizeMax: 0.072,
      sourcePropScaleMin: 0.22,
      sourcePropScaleMax: 0.34,
      entryBurstCount: 10,
      entrySprayCount: 8,
      exitSprayCount: 12,
      splashLifeMin: 1.34,
      splashLifeMax: 1.56,
      splashSizeMin: 0.08,
      splashSizeMax: 0.15,
      splashSpeedMin: 1.4,
      splashSpeedMax: 3.6,
    },
  };

  const particles = {
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number}>} */
    iceShard: [],
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    lava: [],
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number}>} */
    tremorLava: [],
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number}>} */
    mushroom: [],
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,spin:number}>} */
    bubbles: [],
    /** @type {Array<{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,cr:number,cg:number,cb:number}>} */
    splashes: [],
  };

  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  const isMolten = !!(cfg && cfg.id === "molten");
  /** @type {Array<{x:number,y:number,nx:number,ny:number,life:number,maxLife:number,rateMul:number}>} */
  const tremorEruptions = [];

  placeMoltenVents(planet, props || []);
  const ventReserve = (props || []).filter((p) => p.type === "vent").map((p) => ({ x: p.x, y: p.y }));
  if (ventReserve.length && planet.reserveSpawnPoints){
    const minDist = Math.max(0.4, GAME.MINER_MIN_SEP * 0.6);
    planet.reserveSpawnPoints(ventReserve, minDist);
  }
  placeIceShards(planet, props || []);
  const iceReserve = (props || []).filter((p) => p.type === "ice_shard").map((p) => ({ x: p.x, y: p.y }));
  if (iceReserve.length && planet.reserveSpawnPoints){
    planet.reserveSpawnPoints(iceReserve, 0.5);
  }
  placeMushrooms(planet, props || []);
  const mushReserve = (props || []).filter((p) => p.type === "mushroom").map((p) => ({ x: p.x, y: p.y }));
  if (mushReserve.length && planet.reserveSpawnPoints){
    planet.reserveSpawnPoints(mushReserve, 0.5);
  }
  let ventsPruned = false;
  const waterCfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  const isWater = !!(waterCfg && waterCfg.id === "water");
  const waterParams = planet.getPlanetParams ? planet.getPlanetParams() : null;
  const outerRingR = (planet && planet.radial && planet.radial.rings && planet.radial.rings.length)
    ? (planet.radial.rings.length - 1)
    : ((waterParams && typeof waterParams.RMAX === "number") ? Math.floor(waterParams.RMAX) : 0);
  const waterRadius = isWater ? Math.max(0, outerRingR) : 0;
  const bubbleSources = isWater ? collectWaterBubbleSources(planet, 36) : [];
  if (isWater && bubbleSources.length && props){
    const rand = mulberry32((planet.getSeed() + 14591) | 0);
    for (const src of bubbleSources){
      props.push({
        type: "bubble_hex",
        x: src.x - src.nx * 0.02,
        y: src.y - src.ny * 0.02,
        scale: tuning.water.sourcePropScaleMin + rand() * (tuning.water.sourcePropScaleMax - tuning.water.sourcePropScaleMin),
        rot: Math.atan2(src.ny, src.nx),
        rotSpeed: (rand() * 2 - 1) * 0.10,
        nx: src.nx,
        ny: src.ny,
        supportX: src.supportX,
        supportY: src.supportY,
        supportNodeIndex: src.supportNodeIndex,
      });
    }
  }
  let shipBubbleT = tuning.water.shipRateMin;
  let shipUnderwater = false;
  /** @type {Uint8Array|null} */
  let enemyVentNavMask = null;
  let enemyVentMaskActive = false;

  /**
   * @param {PlanetProp} p
   * @returns {{nx:number,ny:number,tx:number,ty:number}}
   */
  const ventAxes = (p) => {
    let nx = (typeof p.nx === "number") ? p.nx : 0;
    let ny = (typeof p.ny === "number") ? p.ny : 0;
    if (!nx && !ny){
      const normal = planet.normalAtWorld ? planet.normalAtWorld(p.x, p.y) : null;
      nx = normal ? normal.nx : (p.x / (Math.hypot(p.x, p.y) || 1));
      ny = normal ? normal.ny : (p.y / (Math.hypot(p.x, p.y) || 1));
    }
    const nlen = Math.hypot(nx, ny) || 1;
    nx /= nlen;
    ny /= nlen;
    return { nx, ny, tx: -ny, ty: nx };
  };

  /**
   * @param {PlanetProp} p
   * @returns {number}
   */
  const ventCyclePhase = (p) => {
    const period = Math.max(0.001, tuning.lava.ventPeriod);
    const raw = (typeof p.ventT === "number") ? p.ventT : 0;
    return ((raw % period) + period) % period;
  };

  /**
   * @param {PlanetProp} p
   * @returns {boolean}
   */
  const ventBaseActive = (p) => (
    ventCyclePhase(p) >= (tuning.lava.ventPeriod - tuning.lava.flashDuration)
  );

  /**
   * @param {PlanetProp} p
   * @returns {boolean}
   */
  const ventForcedActive = (p) => (
    ((p.ventShotT || 0) > 0) || ((p.ventBombT || 0) > 0)
  );

  /**
   * @param {PlanetProp} p
   * @returns {boolean}
   */
  const ventIsEmitting = (p) => ventBaseActive(p) || ventForcedActive(p);

  /**
   * @param {PlanetProp} p
   * @returns {boolean}
   */
  const ventBlocksEnemies = (p) => {
    if (p.type !== "vent" || p.dead) return false;
    if (ventForcedActive(p) || ventBaseActive(p)) return true;
    const phase = ventCyclePhase(p);
    const activeStart = tuning.lava.ventPeriod - tuning.lava.flashDuration;
    if (phase <= tuning.lava.enemyAvoidAfterLaunchGrace) return false;
    if ((activeStart - phase) <= tuning.lava.enemyAvoidBeforeLaunchGrace) return false;
    return true;
  };

  /**
   * @param {PlanetProp} p
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {boolean}
   */
  const pointInVentBody = (p, x, y, radius = 0) => {
    const { nx, ny, tx, ty } = ventAxes(p);
    const dx = x - p.x;
    const dy = y - p.y;
    const localX = dx * tx + dy * ty;
    const localY = dx * nx + dy * ny;
    const s = p.scale || 1;
    const halfH = 0.45 * s;
    const halfW0 = 0.22 * s;
    const halfW1 = 0.12 * s;
    if (localY < -halfH - radius || localY > halfH + radius) return false;
    const t = Math.max(0, Math.min(1, (localY + halfH) / (2 * halfH || 1)));
    const halfW = halfW0 + (halfW1 - halfW0) * t;
    return Math.abs(localX) <= halfW + radius;
  };

  /**
   * @param {PlanetProp} p
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {boolean}
   */
  const pointInVentPlume = (p, x, y, radius = 0) => {
    const { nx, ny } = ventAxes(p);
    const dx = x - p.x;
    const dy = y - p.y;
    const forward = dx * nx + dy * ny;
    if (forward < -radius || forward > tuning.lava.unsafeReach + radius) return false;
    const side = Math.abs(dx * -ny + dy * nx);
    const width = tuning.lava.unsafeBaseWidth + Math.max(0, forward) * tuning.lava.unsafeWidthGrow;
    return side <= width + radius;
  };

  /**
   * @param {PlanetProp} p
   * @returns {void}
   */
  const ensureVentUnsafeNodes = (p) => {
    if (p.ventUnsafeNodes) return;
    const graph = planet.radialGraph;
    const air = planet.airNodesBitmap;
    /** @type {number[]} */
    const nodes = [];
    if (graph && graph.nodes && air && air.length === graph.nodes.length){
      for (let i = 0; i < graph.nodes.length; i++){
        if (!air[i]) continue;
        const n = /** @type {RadialNode} */ (graph.nodes[i]);
        if (pointInVentPlume(p, n.x, n.y, 0.08)){
          nodes.push(i);
        }
      }
    }
    p.ventUnsafeNodes = nodes;
  };

  /**
   * @returns {void}
   */
  const rebuildEnemyVentNavMask = () => {
    const base = planet.airNodesBitmap;
    if (!base || !base.length || !props || !props.length){
      enemyVentMaskActive = false;
      enemyVentNavMask = null;
      return;
    }
    let blocked = false;
    for (const p of props){
      if (p.type !== "vent" || p.dead) continue;
      if (!ventBlocksEnemies(p)) continue;
      blocked = true;
      break;
    }
    enemyVentMaskActive = blocked;
    if (!blocked){
      enemyVentNavMask = null;
      return;
    }
    if (!enemyVentNavMask || enemyVentNavMask.length !== base.length){
      enemyVentNavMask = new Uint8Array(base.length);
    }
    enemyVentNavMask.set(base);
    for (const p of props){
      if (p.type !== "vent" || p.dead) continue;
      if (!ventBlocksEnemies(p)) continue;
      ensureVentUnsafeNodes(p);
      const unsafeNodes = p.ventUnsafeNodes || [];
      for (const iNode of unsafeNodes){
        if (iNode < 0 || iNode >= enemyVentNavMask.length) continue;
        enemyVentNavMask[iNode] = 0;
      }
    }
  };

  /**
   * @param {PlanetProp} p
   * @param {number} dt
   * @param {number} [rateMul]
   * @param {number} [speedMul]
   * @returns {void}
   */
  const emitVentLava = (p, dt, rateMul = 1, speedMul = 1) => {
    if (dt <= 0) return;
    const { nx, ny, tx, ty } = ventAxes(p);
    const rate = tuning.lava.burstRate * Math.max(0, rateMul) * dt;
    const emitCount = Math.max(0, Math.floor(rate));
    const frac = rate - emitCount;
    const total = emitCount + (Math.random() < frac ? 1 : 0);
    const speed = tuning.lava.speed * Math.max(0, speedMul);
    for (let i = 0; i < total; i++){
      const jitter = (Math.random() * 2 - 1) * 0.25;
      const spread = (Math.random() * 2 - 1) * 0.35;
      const vx = (nx + tx * spread) * speed;
      const vy = (ny + ty * spread) * speed;
      particles.lava.push({
        x: p.x + nx * 0.12,
        y: p.y + ny * 0.12,
        vx: vx + jitter * 0.4 * Math.max(1, speedMul),
        vy: vy + jitter * 0.4 * Math.max(1, speedMul),
        life: tuning.lava.life,
      });
    }
  };

  /**
   * @param {PlanetProp} p
   * @returns {boolean}
   */
  const triggerVentShot = (p) => {
    if (ventIsEmitting(p)) return false;
    p.ventShotT = Math.max(p.ventShotT || 0, tuning.lava.shotTriggerDuration);
    p.ventHeat = 1;
    emitVentLava(p, tuning.lava.shotTriggerKick, 1, 1);
    rebuildEnemyVentNavMask();
    return true;
  };

  /**
   * @param {PlanetProp} p
   * @returns {boolean}
   */
  const triggerVentBomb = (p) => {
    p.ventBombT = Math.max(p.ventBombT || 0, tuning.lava.bombTriggerDuration);
    p.ventHeat = 1;
    emitVentLava(p, tuning.lava.bombTriggerKick, tuning.lava.bombRateMul, tuning.lava.bombSpeedMul);
    rebuildEnemyVentNavMask();
    return true;
  };

  /**
   * @param {number} r
   * @returns {number}
   */
  const moltenTerrainHeat = (r) => {
    const protectedR = planet.getProtectedTerrainRadius ? planet.getProtectedTerrainRadius() : 0;
    const params = planet.getPlanetParams ? planet.getPlanetParams() : null;
    const rMax = (params && typeof params.RMAX === "number") ? params.RMAX : Math.max(r, protectedR + 1);
    const falloff = Math.max(2.2, rMax - protectedR);
    return Math.max(0.2, Math.min(1, 1 - Math.max(0, r - protectedR) / falloff));
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} nx
   * @param {number} ny
   * @param {number} heat
   * @returns {void}
   */
  const emitTerrainLavaBurst = (x, y, nx, ny, heat) => {
    const len = Math.hypot(nx, ny) || 1;
    const dirX = nx / len;
    const dirY = ny / len;
    const tanX = -dirY;
    const tanY = dirX;
    const base = Math.max(1, tuning.lava.terrainBurstCount);
    const jitter = Math.max(0, tuning.lava.terrainBurstCountJitter);
    const total = Math.max(1, base + Math.floor(Math.random() * (jitter + 1)));
    const speed = tuning.lava.speed * tuning.lava.terrainSpeedMul * (0.8 + 0.4 * heat);
    for (let i = 0; i < total; i++){
      const spread = (Math.random() * 2 - 1) * (0.22 + 0.18 * heat);
      const kick = speed * (0.75 + Math.random() * 0.45);
      particles.lava.push({
        x: x + dirX * 0.08,
        y: y + dirY * 0.08,
        vx: (dirX + tanX * spread) * kick,
        vy: (dirY + tanY * spread) * kick,
        life: tuning.lava.life * (0.75 + 0.35 * heat),
      });
    }
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} minDist
   * @returns {boolean}
   */
  const canGrowVentAt = (x, y, minDist) => {
    /** @type {Array<{x:number,y:number,r:number}>} */
    const reservations = [];
    const baseReserve = Math.max(0.4, GAME.MINER_MIN_SEP * 0.6);
    for (const p of props || []){
      if (!p || p.dead) continue;
      if (p.type === "turret_pad") continue;
      reservations.push({ x: p.x, y: p.y, r: baseReserve });
    }
    return isFarFromReservations(x, y, minDist, reservations);
  };

  /**
   * @param {RadialNode} airNode
   * @param {RadialNode} rockNeighbor
   * @returns {{x:number,y:number,nx:number,ny:number,supportX:number,supportY:number,supportNodeIndex:number}}
   */
  const buildWallAttachPoint = (airNode, rockNeighbor) => {
    let lo = { x: rockNeighbor.x, y: rockNeighbor.y };
    let hi = { x: airNode.x, y: airNode.y };
    for (let i = 0; i < 8; i++){
      const mx = (lo.x + hi.x) * 0.5;
      const my = (lo.y + hi.y) * 0.5;
      if (planet.airValueAtWorld(mx, my) > 0.5){
        hi = { x: mx, y: my };
      } else {
        lo = { x: mx, y: my };
      }
    }
    const dxr = hi.x - rockNeighbor.x;
    const dyr = hi.y - rockNeighbor.y;
    const nlen = Math.hypot(dxr, dyr) || 1;
    const nx = dxr / nlen;
    const ny = dyr / nlen;
    return {
      x: hi.x - nx * 0.06,
      y: hi.y - ny * 0.06,
      nx,
      ny,
      supportX: hi.x,
      supportY: hi.y,
      supportNodeIndex: rockNeighbor.i,
    };
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {Array<{x:number,y:number,nx:number,ny:number,supportX:number,supportY:number,supportNodeIndex:number,score:number}>}
   */
  const collectMoltenImpactWallCandidates = (x, y, radius) => {
    if (!isMolten) return [];
    const graph = planet.radialGraph;
    const nodes = graph && graph.nodes ? graph.nodes : null;
    const neighbors = graph && graph.neighbors ? graph.neighbors : null;
    const air = planet.airNodesBitmap;
    if (!nodes || !neighbors || !air) return [];
    const maxR = Math.max(0.75, radius);
    const maxR2 = maxR * maxR;
    /** @type {Array<{x:number,y:number,nx:number,ny:number,supportX:number,supportY:number,supportNodeIndex:number,score:number}>} */
    const candidates = [];
    for (let i = 0; i < nodes.length; i++){
      if (!air[i]) continue;
      const node = /** @type {RadialNode} */ (nodes[i]);
      const dx = node.x - x;
      const dy = node.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > maxR2) continue;
      const neigh = /** @type {NavEdgeRef[]} */ (neighbors[i] || []);
      let airCount = 0;
      /** @type {RadialNode|null} */
      let rockNeighbor = null;
      let rockDist2 = Infinity;
      for (const edge of neigh){
        if (!edge || edge.to < 0 || edge.to >= nodes.length) continue;
        const nb = /** @type {RadialNode|null} */ (nodes[edge.to] || null);
        if (!nb) continue;
        if (air[edge.to]){
          airCount++;
          continue;
        }
        const edx = node.x - nb.x;
        const edy = node.y - nb.y;
        const eDist2 = edx * edx + edy * edy;
        if (eDist2 < rockDist2){
          rockDist2 = eDist2;
          rockNeighbor = nb;
        }
      }
      if (airCount < 2 || !rockNeighbor) continue;
      const attach = buildWallAttachPoint(node, rockNeighbor);
      const adx = attach.x - x;
      const ady = attach.y - y;
      const attachD2 = adx * adx + ady * ady;
      candidates.push({
        ...attach,
        score: attachD2 + rockDist2 * 0.25,
      });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates;
  };

  /**
   * @param {{x:number,y:number,nx:number,ny:number,rateMul?:number}} source
   * @returns {void}
   */
  const emitTremorLava = (source) => {
    const dirLen = Math.hypot(source.nx, source.ny) || 1;
    const nx = source.nx / dirLen;
    const ny = source.ny / dirLen;
    const tx = -ny;
    const ty = nx;
    const speedBase = tuning.tremor.speedMin + Math.random() * (tuning.tremor.speedMax - tuning.tremor.speedMin);
    const speed = speedBase * Math.max(0.6, source.rateMul || 1);
    const spread = (Math.random() * 2 - 1) * 0.42;
    const lift = 0.86 + Math.random() * 0.34;
    const vx = (nx * lift + tx * spread) * speed;
    const vy = (ny * lift + ty * spread) * speed;
    const life = tuning.tremor.lifeMin + Math.random() * (tuning.tremor.lifeMax - tuning.tremor.lifeMin);
    particles.tremorLava.push({
      x: source.x + nx * 0.08,
      y: source.y + ny * 0.08,
      vx,
      vy,
      life,
      maxLife: life,
      size: tuning.tremor.sizeMin + Math.random() * (tuning.tremor.sizeMax - tuning.tremor.sizeMin),
    });
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} impactRadius
   * @param {"bomb"|"crawler"} kind
   * @param {FeatureCallbacks} callbacks
   * @returns {boolean}
   */
  const triggerMoltenImpactTremor = (x, y, impactRadius, kind, callbacks) => {
    if (!isMolten) return false;
    const candidates = collectMoltenImpactWallCandidates(x, y, impactRadius + tuning.tremor.searchRadius);
    if (!candidates.length) return false;
    const minCount = kind === "bomb" ? tuning.tremor.bombCountMin : tuning.tremor.crawlerCountMin;
    const maxCount = kind === "bomb" ? tuning.tremor.bombCountMax : tuning.tremor.crawlerCountMax;
    const targetCount = Math.max(minCount, Math.min(maxCount, minCount + Math.floor(Math.random() * Math.max(1, maxCount - minCount + 1))));
    /** @type {Array<{x:number,y:number,nx:number,ny:number,supportX:number,supportY:number,supportNodeIndex:number,score:number}>} */
    const picked = [];
    const minSep2 = tuning.tremor.minSeparation * tuning.tremor.minSeparation;
    for (const candidate of candidates){
      let tooClose = false;
      for (const existing of picked){
        const dx = existing.x - candidate.x;
        const dy = existing.y - candidate.y;
        if (dx * dx + dy * dy < minSep2){
          tooClose = true;
          break;
        }
      }
      if (tooClose) continue;
      picked.push(candidate);
      if (picked.length >= targetCount) break;
    }
    if (!picked.length) return false;
    for (const candidate of picked){
      const life = tuning.tremor.emitterLifeMin + Math.random() * (tuning.tremor.emitterLifeMax - tuning.tremor.emitterLifeMin);
      tremorEruptions.push({
        x: candidate.x,
        y: candidate.y,
        nx: candidate.nx,
        ny: candidate.ny,
        life,
        maxLife: life,
        rateMul: kind === "bomb" ? 1.15 : 0.9,
      });
      const kickoff = kind === "bomb" ? 3 : 2;
      for (let i = 0; i < kickoff; i++){
        emitTremorLava({
          x: candidate.x,
          y: candidate.y,
          nx: candidate.nx,
          ny: candidate.ny,
          rateMul: kind === "bomb" ? 1.12 : 0.92,
        });
      }
    }
    if (callbacks.onExplosion){
      callbacks.onExplosion({
        x,
        y,
        life: kind === "bomb" ? 0.8 : 0.65,
        radius: 0.75 + picked.length * 0.16,
      });
    }
    if (callbacks.onDebris){
      for (let i = 0; i < tuning.tremor.debrisPieces; i++){
        const ang = Math.random() * Math.PI * 2;
        const speed = tuning.tremor.debrisSpeedMin + Math.random() * (tuning.tremor.debrisSpeedMax - tuning.tremor.debrisSpeedMin);
        callbacks.onDebris({
          x,
          y,
          vx: Math.cos(ang) * speed,
          vy: Math.sin(ang) * speed,
          a: Math.random() * Math.PI * 2,
          w: (Math.random() * 2 - 1) * 8,
          life: 0.35 + Math.random() * 0.45,
        });
      }
    }
    if (callbacks.onScreenShake){
      callbacks.onScreenShake(tuning.tremor.shipShake + 0.06 * (picked.length - 1));
    }
    if (callbacks.onRumble){
      callbacks.onRumble(
        tuning.tremor.rumbleWeak,
        tuning.tremor.rumbleStrong,
        tuning.tremor.rumbleMs + picked.length * 35
      );
    }
    return true;
  };

  /**
   * @param {DestroyedTerrainNode} destroyed
   * @param {number} heat
   * @returns {PlanetProp|null}
   */
  const growVentFromDestroyedTerrain = (destroyed, heat) => {
    if (!destroyed || !Number.isFinite(destroyed.idx)) return null;
    const graph = planet.radialGraph;
    const nodes = graph && graph.nodes ? graph.nodes : null;
    const neighbors = graph && graph.neighbors ? graph.neighbors : null;
    const air = planet.airNodesBitmap;
    if (!nodes || !neighbors || !air || destroyed.idx < 0 || destroyed.idx >= nodes.length) return null;
    const params = planet.getPlanetParams ? planet.getPlanetParams() : null;
    if (!params) return null;
    const r = Math.hypot(destroyed.x, destroyed.y);
    const rMin = Math.max(planet.getProtectedTerrainRadius ? planet.getProtectedTerrainRadius() : 0, params.MOLTEN_RING_OUTER || 0) + 0.2;
    const rMax = Math.max(rMin + 0.3, params.RMAX - 0.45);
    if (r < rMin || r > rMax) return null;
    const node = nodes[destroyed.idx];
    if (!node || !air[destroyed.idx]) return null;
    const neigh = neighbors[destroyed.idx] || [];
    let airCount = 0;
    /** @type {RadialNode|null} */
    let rockNeighbor = null;
    let rockDist2 = Infinity;
    for (const e of neigh){
      if (!e || e.to < 0 || e.to >= nodes.length) continue;
      const nb = nodes[e.to];
      if (!nb) continue;
      if (air[e.to]){
        airCount++;
        continue;
      }
      const dx = node.x - nb.x;
      const dy = node.y - nb.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < rockDist2){
        rockDist2 = d2;
        rockNeighbor = nb;
      }
    }
    if (airCount < 2 || !rockNeighbor) return null;
    const dxr = node.x - rockNeighbor.x;
    const dyr = node.y - rockNeighbor.y;
    const nlen = Math.hypot(dxr, dyr) || 1;
    const nx = dxr / nlen;
    const ny = dyr / nlen;
    let lo = { x: rockNeighbor.x, y: rockNeighbor.y };
    let hi = { x: node.x, y: node.y };
    for (let i = 0; i < 8; i++){
      const mx = (lo.x + hi.x) * 0.5;
      const my = (lo.y + hi.y) * 0.5;
      if (planet.airValueAtWorld(mx, my) > 0.5){
        hi = { x: mx, y: my };
      } else {
        lo = { x: mx, y: my };
      }
    }
    const bx = hi.x - nx * 0.08;
    const by = hi.y - ny * 0.08;
    if (!canGrowVentAt(bx, by, tuning.lava.terrainVentMinDist)) return null;
    const vent = {
      type: "vent",
      x: bx,
      y: by,
      scale: 0.48 + Math.random() * 0.20,
      rot: Math.atan2(ny, nx) - Math.PI * 0.5,
      nx,
      ny,
      supportX: hi.x,
      supportY: hi.y,
      supportNodeIndex: rockNeighbor.i,
      ventHeat: Math.max(0.6, heat),
      ventBombT: tuning.lava.bombTriggerDuration * (0.18 + 0.16 * heat),
    };
    props.push(vent);
    emitVentLava(vent, tuning.lava.terrainVentKick, tuning.lava.terrainVentRateMul, tuning.lava.terrainVentSpeedMul);
    rebuildEnemyVentNavMask();
    return vent;
  };

  /**
   * @param {DestroyedTerrainNode[]} destroyedNodes
   * @param {FeatureCallbacks} callbacks
   * @returns {void}
   */
  const handleTerrainDestroyed = (destroyedNodes, callbacks) => {
    const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
    if (!(cfg && cfg.id === "molten") || !destroyedNodes || !destroyedNodes.length) return;
    let grewVent = false;
    for (const destroyed of destroyedNodes){
      if (!destroyed) continue;
      const r = Math.hypot(destroyed.x, destroyed.y);
      const heat = moltenTerrainHeat(r);
      const nx = Number.isFinite(destroyed.nx) ? /** @type {number} */ (destroyed.nx) : (destroyed.x / (r || 1));
      const ny = Number.isFinite(destroyed.ny) ? /** @type {number} */ (destroyed.ny) : (destroyed.y / (r || 1));
      emitTerrainLavaBurst(destroyed.x, destroyed.y, nx, ny, heat);
      if (!grewVent && Math.random() < tuning.lava.terrainVentChance * heat){
        grewVent = !!growVentFromDestroyedTerrain(destroyed, heat);
      }
    }
    if (callbacks && callbacks.onExplosion){
      const anchor = destroyedNodes[0];
      if (anchor){
        callbacks.onExplosion({
          x: anchor.x,
          y: anchor.y,
          life: 0.22,
          radius: 0.18 + 0.10 * destroyedNodes.length,
        });
      }
    }
  };

  /**
   * @param {{x:number,y:number,scale:number,nx:number,ny:number}|null} info
   * @param {FeatureCallbacks} callbacks
   */
  const emitIceShardBurst = (info, callbacks) => {
    if (!info) return;
    const x = info.x;
    const y = info.y;
    if (callbacks.onExplosion){
      callbacks.onExplosion({ x, y, life: 0.5, radius: tuning.iceShard.blast });
    }
    const pieces = tuning.iceShard.piecesMin + Math.floor(Math.random() * (tuning.iceShard.piecesMax - tuning.iceShard.piecesMin + 1));
    const nLen = Math.hypot(info.nx, info.ny) || 1;
    const baseNx = info.nx / nLen;
    const baseNy = info.ny / nLen;
    const baseAng = Math.atan2(baseNy, baseNx);
    for (let i = 0; i < pieces; i++){
      const t = (pieces <= 1) ? 0.5 : (i / (pieces - 1));
      const ang = baseAng + (t * 2 - 1) * tuning.iceShard.spread + (Math.random() * 2 - 1) * 0.16;
      const sp = tuning.iceShard.speedMin + Math.random() * (tuning.iceShard.speedMax - tuning.iceShard.speedMin);
      const maxLife = tuning.iceShard.range / sp;
      particles.iceShard.push({
        x: x + Math.cos(ang) * 0.10,
        y: y + Math.sin(ang) * 0.10,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: maxLife,
        maxLife,
        size: tuning.iceShard.sizeMin + Math.random() * (tuning.iceShard.sizeMax - tuning.iceShard.sizeMin),
      });
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
        life: tuning.mushroom.lifeMin + Math.random() * (tuning.mushroom.lifeMax - tuning.mushroom.lifeMin),
      });
    }
  };

  const mushroomProximityRadius = 4.0;
  const mushroomLosStep = 0.2;

  /**
   * @param {number} x
   * @param {number} y
   * @returns {PlanetProp[]}
   */
  const mushroomCandidatesNear = (x, y) => {
    if (!mushroomHazard || mushroomProximityRadius <= 0) return [];
    if (typeof mushroomHazard.listInRadius === "function"){
      return mushroomHazard.listInRadius(x, y, mushroomProximityRadius);
    }
    return [];
  };

  /**
   * @param {{x:number,y:number,scale:number}|null} info
   */
  const triggerMushroomBurst = (info) => {
    if (!info) return;
    spawnMushroomBurst(info);
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {number} dt
   * @param {FeatureCallbacks} callbacks
   * @returns {boolean}
   */
  const handleShipContact = (x, y, radius, dt, callbacks) => {
    let hit = false;
    if (props && props.length){
      for (const p of props){
        if (p.type !== "vent" || p.dead) continue;
        if (pointInVentBody(p, x, y, radius)){
          if (callbacks.onShipHeat) callbacks.onShipHeat(tuning.lava.ventContactHeatRise * Math.max(0, dt));
          hit = true;
          break;
        }
      }
    }
    if (mushroomHazard){
      const hitProp = mushroomHazard.hitAt(x, y, radius);
      if (hitProp){
        const info = mushroomHazard.burst(hitProp);
        triggerMushroomBurst(info);
        hit = true;
      }
    }
    if (mushroomHazard && !hit){
      const candidates = mushroomCandidatesNear(x, y);
      if (candidates.length){
        let triggered = false;
        for (const candidate of candidates){
          if (!lineOfSightAir(planet, x, y, candidate.x, candidate.y, mushroomLosStep)) continue;
          const info = mushroomHazard.burst(candidate);
          triggerMushroomBurst(info);
          triggered = true;
        }
        if (triggered) hit = true;
      }
    }
    if (ridgeSpikeHazard){
      const hitProp = ridgeSpikeHazard.hitAt(x, y, radius);
      if (hitProp){
        const info = ridgeSpikeHazard.burst(hitProp);
        emitRidgeSpikeBurst(info, callbacks, true);
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
   * @returns {boolean}
   */
  const handleBombContact = (x, y, radius) => {
    const lava = particles.lava;
    if (!lava.length) return false;
    const hitRadius = Math.max(0, tuning.lava.radius + Math.max(0, radius));
    const hitR2 = hitRadius * hitRadius;
    for (let i = lava.length - 1; i >= 0; i--){
      const p = /** @type {{x:number,y:number}} */ (lava[i]);
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy > hitR2) continue;
      lava.splice(i, 1);
      return true;
    }
    return false;
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
    if (props && props.length){
      for (const p of props){
        if (p.type !== "vent" || p.dead) continue;
        const sourceHit = pointInVentBody(p, x, y, radius);
        if (!sourceHit) continue;
        triggerVentShot(p);
        hit = true;
        break;
      }
    }
    if (ridgeSpikeHazard){
      const hitProp = ridgeSpikeHazard.hitAt(x, y, radius);
      if (hitProp){
        const info = ridgeSpikeHazard.burst(hitProp);
        emitRidgeSpikeBurst(info, callbacks, false);
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
    if (mushroomHazard){
      const hitProp = mushroomHazard.hitAt(x, y, radius);
      if (hitProp){
        const info = mushroomHazard.burst(hitProp);
        triggerMushroomBurst(info);
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
    if (props && props.length){
      const ventRadius = Math.max(impactRadius, bombRadius);
      let triggeredVent = false;
      for (const p of props){
        if (p.type !== "vent" || p.dead) continue;
        const sourceHit = pointInVentBody(p, x, y, ventRadius);
        if (!sourceHit) continue;
        triggerVentBomb(p);
        triggeredVent = true;
      }
      if (triggeredVent) hit = true;
    }
    if (ridgeSpikeHazard){
      const exposed = ridgeSpikeHazard.breakIfExposed(planet, x, y, impactRadius + 0.4);
      for (const info of exposed){
        emitRidgeSpikeBurst(info, callbacks, false);
        hit = true;
      }
      const direct = ridgeSpikeHazard.burstAllInRadius(x, y, bombRadius);
      for (const info of direct){
        emitRidgeSpikeBurst(info, callbacks, false);
        hit = true;
      }
    }
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
      const exposed = mushroomHazard.breakIfExposed(planet, x, y, impactRadius + 0.4);
      for (const info of exposed){
        triggerMushroomBurst(info);
        hit = true;
      }
      const bursts = mushroomHazard.burstAllInRadius(x, y, Math.max(bombRadius, mushroomProximityRadius));
      if (bursts.length){
        hit = true;
        for (const info of bursts) triggerMushroomBurst(info);
      }
    }
    return hit;
  };

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} impactRadius
   * @param {"bomb"|"crawler"} kind
   * @param {FeatureCallbacks} callbacks
   * @returns {boolean}
   */
  const handleImpact = (x, y, impactRadius, kind, callbacks) => {
    return triggerMoltenImpactTremor(x, y, impactRadius, kind, callbacks);
  };

  /**
   * @param {number} dt
   * @param {FeatureUpdateState} state
   */
  const updateCoreHeat = (dt, state) => {
    const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
    const coreR = planet.getCoreRadius();
    const coreHeatWorld = !!(cfg && (cfg.id === "molten" || (cfg.id === "mechanized" && coreR > 0.5)));
    if (!coreHeatWorld) return;
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
        const e = /** @type {{x:number,y:number,hp:number,hitT?:number,stunT?:number}} */ (state.enemies[i]);
        const r2 = e.x * e.x + e.y * e.y;
        if (r2 <= coreR2) e.hp = 0;
      }
    }
    if (state.miners){
      for (let i = state.miners.length - 1; i >= 0; i--){
        const m = /** @type {import("./types.d.js").Miner} */ (state.miners[i]);
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
   * @param {FeatureUpdateState} state
   */
  const updateVents = (dt, state) => {
    if (!props || !props.length) return;
    let moltenFeedback = 0;
    for (const p of props){
      if (p.type !== "vent") continue;
      p.ventT = (p.ventT || 0) + dt;
      p.ventShotT = Math.max(0, (p.ventShotT || 0) - dt);
      p.ventBombT = Math.max(0, (p.ventBombT || 0) - dt);
      const baseActive = ventBaseActive(p);
      const bombActive = (p.ventBombT || 0) > 0;
      const shotActive = (p.ventShotT || 0) > 0;
      const active = baseActive || shotActive || bombActive;
      p.ventHeat = active ? 1 : 0;
      if (!active) continue;
      const rateMul = bombActive ? tuning.lava.bombRateMul : 1;
      const speedMul = bombActive ? tuning.lava.bombSpeedMul : 1;
      emitVentLava(p, dt, rateMul, speedMul);
      if (isMolten && state && state.ship && state.ship.state !== "crashed"){
        const dx = state.ship.x - p.x;
        const dy = state.ship.y - p.y;
        const dist = Math.hypot(dx, dy);
        const reach = 4.2;
        if (dist < reach){
          const proximity = 1 - (dist / reach);
          moltenFeedback += proximity * proximity * (bombActive ? 1.2 : 0.8);
        }
      }
    }
    rebuildEnemyVentNavMask();
    if (moltenFeedback > 0 && state){
      const strength = Math.min(1.35, moltenFeedback);
      if (state.onScreenShake){
        state.onScreenShake(0.012 * strength * dt * 60);
      }
      if (state.onRumble){
        state.onRumble(0.05 * strength, 0.02 + 0.04 * strength, 110);
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
      const p = /** @type {{x:number,y:number,vx:number,vy:number,life:number}} */ (lava[i]);
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
          const e = /** @type {{x:number,y:number,hp:number,hitT?:number,stunT?:number}} */ (state.enemies[j]);
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          if (dx * dx + dy * dy <= hitR2){
          if (state.onEnemyStun) state.onEnemyStun(e, tuning.lava.stunTime, "lava");
            lava.splice(i, 1);
            hit = true;
            break;
          }
        }
      }
      if (hit) continue;
      if (state.miners){
        for (let j = state.miners.length - 1; j >= 0; j--){
          const m = /** @type {import("./types.d.js").Miner} */ (state.miners[j]);
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
   * @returns {void}
   */
  const updateTremorEruptions = (dt) => {
    if (!tremorEruptions.length) return;
    for (let i = tremorEruptions.length - 1; i >= 0; i--){
      const eruption = /** @type {{x:number,y:number,nx:number,ny:number,life:number,maxLife:number,rateMul:number}} */ (tremorEruptions[i]);
      eruption.life -= dt;
      if (eruption.life <= 0){
        tremorEruptions.splice(i, 1);
        continue;
      }
      const rate = tuning.tremor.burstRate * Math.max(0.4, eruption.rateMul || 1) * dt;
      const emitWhole = Math.floor(rate);
      const emitCount = emitWhole + (Math.random() < (rate - emitWhole) ? 1 : 0);
      for (let j = 0; j < emitCount; j++){
        emitTremorLava(eruption);
      }
    }
  };

  /**
   * @param {number} dt
   * @param {FeatureUpdateState} state
   * @returns {void}
   */
  const updateTremorLavaParticles = (dt, state) => {
    const tremorLava = particles.tremorLava;
    if (!tremorLava.length) return;
    const hitR2 = tuning.tremor.radius * tuning.tremor.radius;
    for (let i = tremorLava.length - 1; i >= 0; i--){
      const p = /** @type {{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number}} */ (tremorLava[i]);
      const xPrev = p.x;
      const yPrev = p.y;
      const { x: gx, y: gy } = planet.gravityAt(p.x, p.y);
      p.vx += gx * dt * 1.18;
      p.vy += gy * dt * 1.18;
      const drag = Math.max(0, 1 - 0.14 * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      const crossing = planet.terrainCrossing
        ? planet.terrainCrossing({ x: xPrev, y: yPrev }, { x: p.x, y: p.y })
        : null;
      if (p.life <= 0 || crossing || planet.airValueAtWorld(p.x, p.y) <= 0.5){
        tremorLava.splice(i, 1);
        continue;
      }
      if (state.ship && state.ship.state !== "crashed"){
        const dxs = state.ship.x - p.x;
        const dys = state.ship.y - p.y;
        if (dxs * dxs + dys * dys <= hitR2){
          if (state.onShipDamage) state.onShipDamage(p.x, p.y);
          if (state.onShipHeat) state.onShipHeat(tuning.tremor.contactHeat);
          tremorLava.splice(i, 1);
          continue;
        }
      }
      let hit = false;
      if (state.enemies){
        for (let j = state.enemies.length - 1; j >= 0; j--){
          const e = /** @type {{x:number,y:number,hp:number,hitT?:number,stunT?:number}} */ (state.enemies[j]);
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          if (dx * dx + dy * dy <= hitR2){
            if (state.onEnemyHit) state.onEnemyHit(e, p.x, p.y);
            tremorLava.splice(i, 1);
            hit = true;
            break;
          }
        }
      }
      if (hit) continue;
      if (state.miners){
        for (let j = state.miners.length - 1; j >= 0; j--){
          const m = /** @type {import("./types.d.js").Miner} */ (state.miners[j]);
          const dx = m.x - p.x;
          const dy = m.y - p.y;
          if (dx * dx + dy * dy <= hitR2){
            state.miners.splice(j, 1);
            if (state.onMinerKilled) state.onMinerKilled(m);
            tremorLava.splice(i, 1);
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
      const p = /** @type {{x:number,y:number,vx:number,vy:number,life:number}} */ (mush[i]);
      const xPrev = p.x;
      const yPrev = p.y;
      const sporeDrag = -0.25;
      const vSquared = p.vx*p.vx + p.vy*p.vy;
      p.vx += p.vx * sporeDrag * vSquared * dt;
      p.vy += p.vy * sporeDrag * vSquared * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) {
        mush.splice(i, 1);
        continue;
      }
      const crossing = planet.terrainCrossing({ x: xPrev, y: yPrev }, { x: p.x, y: p.y });
      if (crossing){
        // Keep spores in-air by reflecting velocity off terrain boundaries.
        const nx = crossing.nx;
        const ny = crossing.ny;
        const vn = p.vx * nx + p.vy * ny;
        if (vn < 0){
          const bounce = 0.72;
          const impulse = -(1 + bounce) * vn;
          p.vx += impulse * nx;
          p.vy += impulse * ny;
        }
        p.vx *= 0.94;
        p.vy *= 0.94;
        p.x = xPrev;
        p.y = yPrev;
        if (planet.airValueAtWorld(p.x, p.y) <= 0.5){
          p.x += nx * 0.05;
          p.y += ny * 0.05;
        }
      }
      if (mushroomHazard){
        const hitProp = mushroomHazard.hitAt(p.x, p.y, tuning.mushroom.radius);
        if (hitProp){
          const info = mushroomHazard.burst(hitProp);
          triggerMushroomBurst(info);
          mush.splice(i, 1);
          continue;
        }
      }
      if (state.ship){
        const dxs = state.ship.x - p.x;
        const dys = state.ship.y - p.y;
        if (dxs * dxs + dys * dys <= hitR2){
          if (state.onShipConfuse) state.onShipConfuse(tuning.mushroom.confuseTime);
          mush.splice(i, 1);
          continue;
        }
      }
      if (!state.enemies) continue;
      for (let j = state.enemies.length - 1; j >= 0; j--){
        const e = /** @type {{x:number,y:number,hp:number,hitT?:number,stunT?:number}} */ (state.enemies[j]);
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        if (dx * dx + dy * dy <= hitR2){
          if (state.onEnemyStun) state.onEnemyStun(e, tuning.mushroom.stunTime, "mushroom");
          mush.splice(i, 1);
          break;
        }
      }
    }
  };

  /**
   * @param {number} dt
   * @param {FeatureUpdateState} state
   */
  const updateIceShardParticles = (dt, state) => {
    const ice = particles.iceShard;
    if (!ice.length) return;
    const hitR2 = tuning.iceShard.radius * tuning.iceShard.radius;
    for (let i = ice.length - 1; i >= 0; i--){
      const p = /** @type {{x:number,y:number,vx:number,vy:number,life:number}} */ (ice[i]);
      const xPrev = p.x;
      const yPrev = p.y;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      const crossing = planet.terrainCrossing
        ? planet.terrainCrossing({ x: xPrev, y: yPrev }, { x: p.x, y: p.y })
        : null;
      if (p.life <= 0 || crossing || planet.airValueAtWorld(p.x, p.y) <= 0.5){
        ice.splice(i, 1);
        continue;
      }
      if (state.ship){
        const dxs = state.ship.x - p.x;
        const dys = state.ship.y - p.y;
        if (dxs * dxs + dys * dys <= hitR2){
          if (state.onShipDamage) state.onShipDamage(p.x, p.y);
          ice.splice(i, 1);
          continue;
        }
      }
      let hit = false;
      if (state.enemies){
        for (let j = state.enemies.length - 1; j >= 0; j--){
          const e = /** @type {{x:number,y:number,hp:number,hitT?:number,stunT?:number}} */ (state.enemies[j]);
          const dx = e.x - p.x;
          const dy = e.y - p.y;
          if (dx * dx + dy * dy <= hitR2){
            if (state.onEnemyHit) state.onEnemyHit(e, p.x, p.y);
            ice.splice(i, 1);
            hit = true;
            break;
          }
        }
      }
      if (hit) continue;
      if (state.miners){
        for (let j = state.miners.length - 1; j >= 0; j--){
          const m = /** @type {import("./types.d.js").Miner} */ (state.miners[j]);
          const dx = m.x - p.x;
          const dy = m.y - p.y;
          if (dx * dx + dy * dy <= hitR2){
            state.miners.splice(j, 1);
            if (state.onMinerKilled) state.onMinerKilled(m);
            ice.splice(i, 1);
            break;
          }
        }
      }
    }
  };

  /**
   * @param {{x:number,y:number,scale:number}|null} info
   * @param {FeatureCallbacks} callbacks
   * @param {boolean} [damageShip]
   */
  const emitRidgeSpikeBurst = (info, callbacks, damageShip = false) => {
    if (!info) return;
    const x = info.x;
    const y = info.y;
    const scale = info.scale || 1;
    if (callbacks.onExplosion){
      callbacks.onExplosion({ x, y, life: 0.35, radius: tuning.ridgeSpike.blast * scale });
    }
    if (callbacks.onDebris){
      const pieces = tuning.ridgeSpike.pieces;
      for (let i = 0; i < pieces; i++){
        const ang = Math.random() * Math.PI * 2;
        const sp = tuning.ridgeSpike.debrisSpeedMin + Math.random() * tuning.ridgeSpike.debrisSpeedMax;
        callbacks.onDebris({
          x: x + Math.cos(ang) * 0.06,
          y: y + Math.sin(ang) * 0.06,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          a: Math.random() * Math.PI * 2,
          w: (Math.random() - 0.5) * 7,
          life: tuning.ridgeSpike.debrisLifeMin + Math.random() * tuning.ridgeSpike.debrisLifeMax,
        });
      }
    }
    if (damageShip && callbacks.onShipDamage){
      callbacks.onShipDamage(x, y);
    }
  };

  /**
   * @param {number} dt
   * @param {FeatureUpdateState} state
   */
  const updateWaterBubbles = (dt, state) => {
    if (!isWater) return;
    const bubbles = particles.bubbles;
    const splashes = particles.splashes;
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} baseUpX
     * @param {number} baseUpY
     * @returns {void}
     */
    const spawnBubble = (x, y, baseUpX, baseUpY) => {
      if (waterRadius > 0 && Math.hypot(x, y) > waterRadius + 0.02) return;
      if (planet.airValueAtWorld(x, y) <= 0.5) return;
      const t = Math.random() * 2 - 1;
      const tx = -baseUpY;
      const ty = baseUpX;
      const rise = tuning.water.rise * (0.75 + Math.random() * 0.5);
      const drift = tuning.water.drift * t;
      const vx = baseUpX * rise + tx * drift;
      const vy = baseUpY * rise + ty * drift;
      const life = tuning.water.lifeMin + Math.random() * (tuning.water.lifeMax - tuning.water.lifeMin);
      const size = tuning.water.sizeMin + Math.random() * (tuning.water.sizeMax - tuning.water.sizeMin);
      bubbles.push({
        x,
        y,
        vx,
        vy,
        life,
        maxLife: life,
        size,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() * 2 - 1) * 1.6,
      });
    };
    /**
     * @param {number} x
     * @param {number} y
     * @param {number} baseUpX
     * @param {number} baseUpY
     * @param {number} [baseVx=0]
     * @param {number} [baseVy=0]
     * @param {number} [impactSpeed=0]
     * @returns {void}
     */
    const spawnSplash = (x, y, baseUpX, baseUpY, baseVx = 0, baseVy = 0, impactSpeed = 0) => {
      const t = Math.random() * 2 - 1;
      const tx = -baseUpY;
      const ty = baseUpX;
      const spBase = tuning.water.splashSpeedMin + Math.random() * (tuning.water.splashSpeedMax - tuning.water.splashSpeedMin);
      const impactMul = Math.min(3.5, 1 + Math.max(0, impactSpeed) * 0.28);
      const sp = spBase * impactMul;
      const vx = baseVx + baseUpX * sp + tx * (0.9 * t);
      const vy = baseVy + baseUpY * sp + ty * (0.9 * t);
      const life = tuning.water.splashLifeMin + Math.random() * (tuning.water.splashLifeMax - tuning.water.splashLifeMin);
      const size = tuning.water.splashSizeMin + Math.random() * (tuning.water.splashSizeMax - tuning.water.splashSizeMin);
      const cmix = Math.random();
      const cr = Math.max(0, Math.min(1, 0.05 + cmix * 0.24 + Math.random() * 0.04));
      const cg = Math.max(0, Math.min(1, 0.24 + cmix * 0.44 + Math.random() * 0.05));
      const cb = Math.max(0, Math.min(1, 0.58 + cmix * 0.38 + Math.random() * 0.04));
      splashes.push({
        x,
        y,
        vx,
        vy,
        life,
        maxLife: life,
        size,
        rot: Math.random() * Math.PI * 2,
        cr,
        cg,
        cb,
      });
    };

    if (bubbleSources.length){
      for (const src of bubbleSources){
        src.t -= dt;
        if (src.t > 0) continue;
        src.t = (1 / tuning.water.sourceRate) + Math.random() * tuning.water.sourceJitter;
        const r = Math.hypot(src.x, src.y) || 1;
        const upx = src.x / r;
        const upy = src.y / r;
        spawnBubble(src.x + src.nx * 0.015, src.y + src.ny * 0.015, upx, upy);
        if (Math.random() < 0.55){
          spawnBubble(src.x + src.nx * 0.03, src.y + src.ny * 0.03, upx, upy);
        }
      }
    }

    const ship = state && state.ship ? state.ship : null;
    let shipNowUnderwater = false;
    if (ship && ship.state !== "crashed" && waterRadius > 0){
      const sr = Math.hypot(ship.x, ship.y);
      const upx = sr > 1e-6 ? (ship.x / sr) : 1;
      const upy = sr > 1e-6 ? (ship.y / sr) : 0;
      const airAtShip = planet.airValueAtWorld(ship.x, ship.y) > 0.5;
      const nearSurfaceBand = Math.abs(sr - waterRadius) <= 0.35;
      const shipInSpaceBand = (sr > waterRadius + 0.02) && airAtShip;
      shipNowUnderwater = (sr <= waterRadius + 0.02 && airAtShip);
      if (shipNowUnderwater && !shipUnderwater && nearSurfaceBand){
        const inwardSpeed = Math.max(0, -(ship.vx * upx + ship.vy * upy));
        const crashSpeed = Math.max(inwardSpeed, Math.hypot(ship.vx, ship.vy) * 0.45);
        for (let i = 0; i < tuning.water.entrySprayCount; i++){
          const t = (Math.random() * 2 - 1) * 0.22;
          const tx = -upy;
          const ty = upx;
          spawnSplash(
            ship.x + tx * t + upx * 0.05,
            ship.y + ty * t + upy * 0.05,
            upx,
            upy,
            ship.vx * 0.12,
            ship.vy * 0.12,
            crashSpeed
          );
        }
        for (let i = 0; i < tuning.water.entryBurstCount; i++){
          const t = (Math.random() * 2 - 1) * 0.16;
          const tx = -upy;
          const ty = upx;
          spawnBubble(
            ship.x - upx * (0.16 + Math.random() * 0.14) + tx * t,
            ship.y - upy * (0.16 + Math.random() * 0.14) + ty * t,
            upx,
            upy
          );
        }
      }
      if (!shipNowUnderwater && shipUnderwater && shipInSpaceBand && nearSurfaceBand){
        for (let i = 0; i < tuning.water.exitSprayCount; i++){
          const t = (Math.random() * 2 - 1) * 0.22;
          const tx = -upy;
          const ty = upx;
          spawnSplash(
            ship.x + tx * t,
            ship.y + ty * t,
            upx,
            upy,
            ship.vx * 0.18,
            ship.vy * 0.18
          );
        }
      }
      if (shipNowUnderwater){
        shipBubbleT -= dt;
        if (shipBubbleT <= 0){
          shipBubbleT = tuning.water.shipRateMin + Math.random() * (tuning.water.shipRateMax - tuning.water.shipRateMin);
          spawnBubble(
            ship.x - upx * 0.2 + (Math.random() * 2 - 1) * 0.05,
            ship.y - upy * 0.2 + (Math.random() * 2 - 1) * 0.05,
            upx,
            upy
          );
        }
      }
    }
    shipUnderwater = shipNowUnderwater;

    if (bubbles.length){
      for (let i = bubbles.length - 1; i >= 0; i--){
        const p = /** @type {{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,spin:number}} */ (bubbles[i]);
        const r = Math.hypot(p.x, p.y) || 1;
        const upx = p.x / r;
        const upy = p.y / r;
        p.vx += upx * 0.55 * dt;
        p.vy += upy * 0.55 * dt;
        const drag = Math.max(0, 1 - 1.5 * dt);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.spin * dt;
        p.life -= dt;
        p.size += dt * 0.013;
        const pr = Math.hypot(p.x, p.y);
        if (waterRadius > 0 && pr >= waterRadius - 0.03){
          p.life -= dt * 1.8;
          p.size += dt * 0.04;
        }
        if (p.life <= 0 || planet.airValueAtWorld(p.x, p.y) <= 0.5){
          bubbles.splice(i, 1);
        }
      }
    }

    if (splashes.length){
      for (let i = splashes.length - 1; i >= 0; i--){
        const p = /** @type {{x:number,y:number,vx:number,vy:number,life:number,maxLife:number,size:number,rot:number,cr:number,cg:number,cb:number}} */ (splashes[i]);
        const { x: gx, y: gy } = planet.gravityAt(p.x, p.y);
        p.vx += gx * dt * 0.55;
        p.vy += gy * dt * 0.55;
        const drag = Math.max(0, 1 - 0.75 * dt);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += dt * 3.2;
        p.life -= dt;
        if (p.life <= 0 || planet.airValueAtWorld(p.x, p.y) <= 0.5){
          splashes.splice(i, 1);
        }
      }
    }
  };

  rebuildEnemyVentNavMask();

  return {
    getParticles: () => particles,
    clearParticles: () => {
      particles.iceShard.length = 0;
      particles.lava.length = 0;
      particles.tremorLava.length = 0;
      particles.mushroom.length = 0;
      particles.bubbles.length = 0;
      particles.splashes.length = 0;
      tremorEruptions.length = 0;
    },
    getEnemyNavigationMask: () => {
      if (!enemyVentMaskActive || !enemyVentNavMask) return planet.airNodesBitmap;
      return enemyVentNavMask;
    },
    /** @param {{enemies:Array<{x:number,y:number}>, miners:Array<{x:number,y:number}>}} state */
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
      rebuildEnemyVentNavMask();
    },
    /**
     * @param {number} dt
     * @param {FeatureUpdateState} state
     */
    update: (dt, state) => {
      updateCoreHeat(dt, state);
      updateVents(dt, state);
      updateTremorEruptions(dt);
      updateIceShardParticles(dt, state);
      updateLavaParticles(dt, state);
      updateTremorLavaParticles(dt, state);
      updateMushroomParticles(dt, state);
      updateWaterBubbles(dt, state);
    },
    /**
     * @param {DetachedTerrainProp[]} detachedProps
     * @param {FeatureCallbacks} callbacks
     */
    emitDetachedPropBursts: (detachedProps, callbacks) => {
      if (!detachedProps || !detachedProps.length) return;
      let ventDetached = false;
      for (const p of detachedProps){
        if (!p) continue;
        if (p.type === "vent") ventDetached = true;
        if (p.type === "ridge_spike" || p.type === "stalactite"){
          emitRidgeSpikeBurst({ x: p.x, y: p.y, scale: p.scale || 1 }, callbacks, false);
          continue;
        }
        if (p.type === "ice_shard"){
          emitIceShardBurst({
            x: p.x,
            y: p.y,
            scale: p.scale || 1,
            nx: Number.isFinite(p.nx) ? /** @type {number} */ (p.nx) : 0,
            ny: Number.isFinite(p.ny) ? /** @type {number} */ (p.ny) : 0,
          }, callbacks);
        }
      }
      if (ventDetached){
        rebuildEnemyVentNavMask();
      }
    },
    handleTerrainDestroyed,
    handleShipContact,
    handleBombContact,
    handleShot,
    handleBomb,
    handleImpact,
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
 * @property {number} [padRing]
 * @property {number} [padDepth]
 * @property {"outer_rock"|"under_air"} [padAnchorKind]
 * @property {"miner"|"turret"|null} [padReservedFor]
 * @property {"rock"|"air"} [padSourceKind]
 * @property {number} [padSourceRing]
 * @property {number} [padSourceIndex]
 * @property {number} [ventT]
 * @property {number} [ventHeat]
 * @property {number} [ventShotT]
 * @property {number} [ventBombT]
 * @property {number[]} [ventUnsafeNodes]
 * @property {number} [nx]
 * @property {number} [ny]
 * @property {number} [supportX]
 * @property {number} [supportY]
 * @property {number} [supportNodeIndex]
 * @property {number[]} [supportNodeIndices]
 * @property {number} [spawnT]
 * @property {number} [spawnCd]
 * @property {number} [propId]
 * @property {number} [protectedBy]
 * @property {number} [halfLength]
 * @property {number} [halfWidth]
 * @property {boolean} [locked]
 * @property {number} [flashT]
 * @property {number} [hitT]
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
        if (isAir){
          const waterSurfaceR = Math.max(0, Math.floor(params.RMAX));
          if (r <= waterSurfaceR) mat = 5;
        }
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
  const coreR = (params.CORE_RADIUS > 1) ? params.CORE_RADIUS : (params.CORE_RADIUS * params.RMAX);

  const surface = sampleSurfacePoints(mapgen, params, 120);

  /**@type {(type:string, x:number, y:number, scale:number, rot:number, rotSpeed?:number, extra?:Object)=>void} */
  const add = (type, x, y, scale, rot, rotSpeed = 0, extra = undefined) => {
    props.push({ type, x, y, scale, rot, rotSpeed, ...(extra || {}) });
  };

  switch (planetConfig.id){
    case "barren_pickup":
    case "barren_clear": {
      const countRaw = (typeof planetConfig.platformCount === "number")
        ? Math.round(planetConfig.platformCount)
        : 10;
      const count = Math.max(0, countRaw);
      for (let i = 0; i < count; i++){
        const a = (i / count) * Math.PI * 2;
        const r = params.RMAX * 0.98;
        add("turret_pad", Math.cos(a) * r, Math.sin(a) * r, 0.55, a, 0);
      }
      break;
    }
    case "no_caves": {
      const base = Math.max(18, Math.round(params.RMAX * 2.2));
      const boulderCount = Math.max(8, Math.round(base * 0.50));
      const spikeCount = Math.max(6, Math.round(base * 0.35));
      for (let i = 0; i < boulderCount; i++){
        add("boulder", 0, 0, 0.35 + rng() * 0.35, rng() * Math.PI * 2, 0);
      }
      for (let i = 0; i < spikeCount; i++){
        add("ridge_spike", 0, 0, 0.45 + rng() * 0.45, rng() * Math.PI * 2, 0);
      }
      break;
    }
    case "molten": {
      break;
    }
    case "ice": {
      break;
    }
    case "gaia": {
      for (const p of surface){
        if (rng() < 0.30) add("tree", p[0], p[1], 0.45 + rng() * 0.35, rng() * Math.PI * 2, 0);
      }
      break;
    }
    case "water": {
      const boulderCount = Math.max(10, Math.round(params.RMAX * 1.1));
      const spikeCount = Math.max(6, Math.round(params.RMAX * 0.6));
      for (let i = 0; i < boulderCount; i++){
        add("boulder", 0, 0, 0.30 + rng() * 0.32, rng() * Math.PI * 2, 0);
      }
      for (let i = 0; i < spikeCount; i++){
        add("ridge_spike", 0, 0, 0.40 + rng() * 0.36, rng() * Math.PI * 2, 0);
      }
      break;
    }
    case "cavern": {
      const stalCount = Math.max(40, Math.round(params.RMAX * 2.3));
      const boulderCount = Math.max(12, Math.round(params.RMAX * 0.95));
      const spikeCount = Math.max(10, Math.round(params.RMAX * 0.8));
      for (let i = 0; i < stalCount; i++){
        add("stalactite", 0, 0, 0.34 + rng() * 0.42, rng() * Math.PI * 2, 0);
      }
      for (let i = 0; i < boulderCount; i++){
        add("boulder", 0, 0, 0.28 + rng() * 0.28, rng() * Math.PI * 2, 0);
      }
      for (let i = 0; i < spikeCount; i++){
        add("ridge_spike", 0, 0, 0.36 + rng() * 0.32, rng() * Math.PI * 2, 0);
      }
      break;
    }
    case "mechanized": {
      if (coreR > 0.5){
        const base = Math.max(3, Math.round((planetConfig.platformCount || 10) * 0.32));
        const tetherCount = Math.max(3, Math.min(8, base + Math.floor(rng() * 2)));
        for (let i = 0; i < tetherCount; i++){
          add("factory", 0, 0, 0.68 + rng() * 0.24, rng() * Math.PI * 2, 0, { hp: 6, spawnT: 0, spawnCd: 0 });
        }
        for (let i = 0; i < tetherCount; i++){
          add("tether", 0, 0, 1, 0, 0, { hp: 1, halfLength: 1.2 + rng() * 0.8, halfWidth: 0.12 + rng() * 0.05 });
        }
      } else {
        const base = Math.max(5, Math.round((planetConfig.platformCount || 10) * 0.7));
        for (let i = 0; i < base; i++){
          add("factory", 0, 0, 0.62 + rng() * 0.36, rng() * Math.PI * 2, 0, { hp: 5, spawnT: 0, spawnCd: 0 });
        }
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
 *  burst:(prop:PlanetProp)=>{x:number,y:number,scale:number,nx:number,ny:number}|null,
 *  hitAt:(x:number,y:number,radius:number)=>PlanetProp|null,
 *  burstAllInRadius:(x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number,nx:number,ny:number}>,
 *  breakIfExposed:(planet:import("./planet.js").Planet, x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number,nx:number,ny:number}>
 * }}
 */
export function createIceShardHazard(props){
  /**
   * @param {PlanetProp} p
   */
  const isAliveShard = (p) => p.type === "ice_shard" && !p.dead && !(typeof p.hp === "number" && p.hp <= 0);
  /**
   * @param {PlanetProp} prop
   * @returns {{x:number,y:number,scale:number,nx:number,ny:number}|null}
   */
  const burstProp = (prop) => {
    if (!isAliveShard(prop)) return null;
    prop.dead = true;
    prop.hp = 0;
    let nx = (typeof prop.nx === "number") ? prop.nx : 0;
    let ny = (typeof prop.ny === "number") ? prop.ny : 0;
    let len = Math.hypot(nx, ny);
    if (len < 1e-4){
      len = Math.hypot(prop.x, prop.y) || 1;
      nx = prop.x / len;
      ny = prop.y / len;
    } else {
      nx /= len;
      ny /= len;
    }
    return { x: prop.x, y: prop.y, scale: prop.scale || 1, nx, ny };
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
      /** @type {Array<{x:number,y:number,scale:number,nx:number,ny:number}>} */
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
      /** @type {Array<{x:number,y:number,scale:number,nx:number,ny:number}>} */
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
 * @returns {{
 *  burst:(prop:PlanetProp)=>{x:number,y:number,scale:number}|null,
 *  hitAt:(x:number,y:number,radius:number)=>PlanetProp|null,
 *  burstAllInRadius:(x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>,
 *  breakIfExposed:(planet:import("./planet.js").Planet, x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>
 * }}
 */
export function createRidgeSpikeHazard(props){
  /**
   * @param {PlanetProp} p
   * @returns {boolean}
   */
  const isAlive = (p) => (p.type === "ridge_spike" || p.type === "stalactite") && !p.dead && !(typeof p.hp === "number" && p.hp <= 0);
  /**
   * @param {PlanetProp} prop
   * @returns {{x:number,y:number,scale:number}|null}
   */
  const burstProp = (prop) => {
    if (!isAlive(prop)) return null;
    prop.dead = true;
    prop.hp = 0;
    return { x: prop.x, y: prop.y, scale: prop.scale || 1 };
  };
  /**
   * @param {PlanetProp} p
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @returns {boolean}
   */
  const overlapsSpike = (p, x, y, radius) => {
    const s = p.scale || 1;
    // Fallback radial overlap keeps spike hits reliable even if surface normals are noisy.
    const dx = x - p.x;
    const dy = y - p.y;
    const radial = radius + 0.42 * s;
    if (dx * dx + dy * dy <= radial * radial) return true;

    let nx = (typeof p.nx === "number") ? p.nx : 0;
    let ny = (typeof p.ny === "number") ? p.ny : 0;
    if (!nx && !ny){
      const r = Math.hypot(p.x, p.y) || 1;
      nx = p.x / r;
      ny = p.y / r;
    } else {
      const nlen = Math.hypot(nx, ny) || 1;
      nx /= nlen;
      ny /= nlen;
    }
    const tx = -ny;
    const ty = nx;
    const localX = dx * tx + dy * ty;
    const localY = dx * nx + dy * ny;
    const minY = -0.10 * s;
    const maxY = 0.62 * s;
    if (localY < minY - radius || localY > maxY + radius) return false;
    const t = Math.max(0, Math.min(1, (localY - minY) / Math.max(0.001, maxY - minY)));
    const halfW = (0.20 * (1 - t)) * s;
    return Math.abs(localX) <= halfW + radius;
  };
  return {
    burst: (prop) => burstProp(prop),
    hitAt: (x, y, radius) => {
      for (const p of props){
        if (!isAlive(p)) continue;
        if (overlapsSpike(p, x, y, radius)){
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
        if (overlapsSpike(p, x, y, radius)){
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
        if (!isAlive(p)) continue;
        if (!overlapsSpike(p, x, y, radius)) continue;
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
 * @returns {{
 *  burst:(prop:PlanetProp)=>{x:number,y:number,scale:number}|null,
 *  hitAt:(x:number,y:number,radius:number)=>PlanetProp|null,
 *  listInRadius:(x:number,y:number,radius:number)=>PlanetProp[],
 *  burstAllInRadius:(x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>,
 *  breakIfExposed:(planet:import("./planet.js").Planet, x:number,y:number,radius:number)=>Array<{x:number,y:number,scale:number}>
 * }}
 */
export function createMushroomHazard(props){
  /**
   * @param {PlanetProp} p
   * @returns {boolean}
   */
  const isAlive = (p) => p.type === "mushroom" && !p.dead && !(typeof p.hp === "number" && p.hp <= 0);
  /**
   * @param {PlanetProp} prop
   * @returns {{x:number,y:number,scale:number}|null}
   */
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
    listInRadius: (x, y, radius) => {
      /** @type {PlanetProp[]} */
      const out = [];
      for (const p of props){
        if (!isAlive(p)) continue;
        const sr = 0.28 * (p.scale || 1);
        const dx = p.x - x;
        const dy = p.y - y;
        const r2 = (radius + sr) * (radius + sr);
        if (dx * dx + dy * dy <= r2){
          out.push(p);
        }
      }
      return out;
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
    breakIfExposed: (planet, x, y, radius) => {
      /** @type {Array<{x:number,y:number,scale:number}>} */
      const bursts = [];
      for (const p of props){
        if (!isAlive(p)) continue;
        const sr = 0.28 * (p.scale || 1);
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
