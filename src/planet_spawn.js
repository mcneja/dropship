// @ts-check

import { CFG, GAME } from "./config.js";
import { dijkstraMap } from "./navigation.js";
import { mulberry32 } from "./rng.js";
import {
  buildStandablePoints,
  collectSupportNodeIndices,
  findStandableSupportNodeIndex,
  getStandablePoints,
  refreshTerrainPropSupportNodes,
  setSupportAnchor,
  setSupportNodeIndices,
} from "./terrain_support.js";

/** @typedef {import("./planet.js").Planet} Planet */
/** @typedef {import("./types.d.js").StandablePoint} StandablePoint */

/**
 * @typedef {{x:number,y:number,supportX?:number,supportY?:number,supportNodeIndex?:number,supportNodeIndices?:number[]}} MinerSpawnPlacement
 */

/**
 * @param {Planet} planet
 * @param {number} count
 * @param {number} seed
 * @param {number} [minDist=0.45]
 * @returns {Array<{x:number,y:number,nx:number,ny:number,supportNodeIndex:number}>}
 */
export function sampleCaveAttachmentPoints(planet, count, seed, minDist = 0.45){
  if (count <= 0) return [];
  const graph = planet.radialGraph;
  const nodes = graph && graph.nodes ? graph.nodes : [];
  const neighbors = graph && graph.neighbors ? graph.neighbors : [];
  const air = planet.airNodesBitmap;
  if (!nodes.length || !neighbors.length || !air || air.length !== nodes.length){
    return [];
  }
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  const surfaceBand = (cfg && cfg.defaults && typeof cfg.defaults.SURFACE_BAND === "number")
    ? cfg.defaults.SURFACE_BAND
    : 0;
  const surfaceR = planet.planetParams.RMAX * (1 - surfaceBand);
  const rMin = Math.max(0.7, planet.planetParams.RMAX * 0.12);
  const rMax = Math.max(rMin + 0.8, Math.min(planet.planetParams.RMAX - 0.5, surfaceR - 0.25));
  /** @type {Array<{x:number,y:number,nx:number,ny:number,supportNodeIndex:number}>} */
  const candidates = [];
  for (let i = 0; i < nodes.length; i++){
    if (!air[i]) continue;
    const n = nodes[i];
    if (!n) continue;
    const r = Math.hypot(n.x, n.y);
    if (r < rMin || r > rMax) continue;
    const neigh = neighbors[i] || [];
    let rockNeighbor = null;
    let rockDist2 = Infinity;
    for (const e of neigh){
      if (air[e.to]) continue;
      const nb = nodes[e.to];
      if (!nb) continue;
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
    const len = Math.hypot(dxr, dyr) || 1;
    const nx = dxr / len;
    const ny = dyr / len;
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
    candidates.push({ x: hi.x, y: hi.y, nx, ny, supportNodeIndex: rockNeighbor.i });
  }
  const rand = mulberry32(seed);
  for (let i = candidates.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    const tmp = /** @type {{x:number,y:number,nx:number,ny:number,supportNodeIndex:number}} */ (candidates[i]);
    candidates[i] = /** @type {{x:number,y:number,nx:number,ny:number,supportNodeIndex:number}} */ (candidates[j]);
    candidates[j] = tmp;
  }
  /** @type {Array<{x:number,y:number,nx:number,ny:number,supportNodeIndex:number}>} */
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
    picked.push(c);
    if (picked.length >= count) break;
  }
  return picked;
}

/**
 * @param {Planet} planet
 * @returns {void}
 */
export function alignTurretPadSpawnProps(planet){
  const props = planet.props || [];
  if (!props.length) return;
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  const forceHorizontalPads = !!(cfg && cfg.flags && cfg.flags.barrenPerimeter);
  const pads = [];
  for (const p of props){
    if (p.type === "turret_pad") pads.push(p);
  }
  if (!pads.length) return;
  if (!planet._standablePoints || !planet._standablePoints.length){
    planet._standablePoints = buildStandablePoints(planet);
  }
  const seed = (planet.getSeed() | 0) + 913;
  const minDist = GAME.MINER_MIN_SEP;
  /** @type {Array<any>} */
  let placed = [];
  if (forceHorizontalPads){
    const lookup = buildBarrenPadLookup(planet, seed);
    placed = lookup ? pickBarrenCandidates(lookup.inner, pads.length, minDist) : [];
  } else {
    const standable = planet._standablePoints || [];
    const flatPool = standable.filter((pt) => {
      const normal = planet._upAlignedNormalAtWorld(pt[0], pt[1]);
      const slope = planet._surfaceSlopeAtWorld(pt[0], pt[1], normal);
      if (!normal || slope === null) return false;
      const up = planet._upDirAt(pt[0], pt[1]);
      if (!up) return false;
      if (slope > 0.08) return false;
      if (normal.nx * up.ux + normal.ny * up.uy < 0.98) return false;
      const tx = -normal.ny;
      const ty = normal.nx;
      const shoulder = 0.38;
      for (const dir of [-1, 1]){
        const sx = pt[0] + tx * shoulder * dir;
        const sy = pt[1] + ty * shoulder * dir;
        if (planet.airValueAtWorld(sx + normal.nx * 0.12, sy + normal.ny * 0.12) <= 0.5) return false;
        if (planet.airValueAtWorld(sx - normal.nx * 0.09, sy - normal.ny * 0.09) > 0.5) return false;
      }
      return true;
    });
    const pool = (flatPool.length >= pads.length) ? flatPool : standable;
    if (pool !== standable){
      const saved = planet._standablePoints;
      planet._standablePoints = pool;
      placed = sampleStandablePoints(planet, pads.length, seed, "uniform", minDist, false)
        .map((pt) => ({ x: pt[0], y: pt[1] }));
      planet._standablePoints = saved;
    } else {
      placed = sampleStandablePoints(planet, pads.length, seed, "uniform", minDist, false)
        .map((pt) => ({ x: pt[0], y: pt[1] }));
    }
  }
  for (let i = 0; i < pads.length; i++){
    const p = pads[i];
    if (!p) continue;
    const pt = placed[i] || null;
    p.padReservedFor = null;
    if (!pt){
      p.dead = true;
      p.hp = 0;
      delete p.padRing;
      delete p.padDepth;
      delete p.padAnchorKind;
      delete p.padSourceKind;
      delete p.padSourceRing;
      delete p.padSourceIndex;
      continue;
    }
    p.dead = false;
    p.x = pt.x;
    p.y = pt.y;
    setSupportAnchor(p, pt.x, pt.y);
    if (forceHorizontalPads){
      p.padRing = pt.ring;
      p.padDepth = pt.depth;
      p.padAnchorKind = pt.anchorKind;
      p.padSourceKind = pt.sourceKind;
      p.padSourceRing = pt.sourceRing;
      p.padSourceIndex = pt.sourceIndex;
      setSupportNodeIndices(
        p,
        [],
        (pt.sourceKind === "rock" && Number.isFinite(pt.sourceIndex))
          ? Number(pt.sourceIndex)
          : findStandableSupportNodeIndex(planet, p.x, p.y),
      );
      const up = planet._upDirAt(p.x, p.y);
      if (up){
        p.padNx = up.ux;
        p.padNy = up.uy;
        continue;
      }
    } else {
      delete p.padRing;
      delete p.padDepth;
      delete p.padAnchorKind;
      delete p.padSourceKind;
      delete p.padSourceRing;
      delete p.padSourceIndex;
      setSupportNodeIndices(p, [], findStandableSupportNodeIndex(planet, p.x, p.y));
    }
    const normal = planet.normalAtWorld(p.x, p.y);
    if (normal){
      p.padNx = normal.nx;
      p.padNy = normal.ny;
    } else {
      const up = planet._upDirAt(p.x, p.y);
      if (up){
        p.padNx = up.ux;
        p.padNy = up.uy;
      }
    }
  }
}

/**
 * @param {Planet} planet
 * @returns {number}
 */
function minerSupportRadius(planet){
  void planet;
  return Math.max(0.08, (0.36 * GAME.MINER_SCALE) * 0.36);
}

/**
 * @param {Planet} planet
 * @param {number} x
 * @param {number} y
 * @param {number} [supportX=x]
 * @param {number} [supportY=y]
 * @param {number} [supportNodeIndex=-1]
 * @param {number[]|null} [supportNodeIndices=null]
 * @returns {MinerSpawnPlacement}
 */
function buildMinerSpawnPlacement(planet, x, y, supportX = x, supportY = y, supportNodeIndex = -1, supportNodeIndices = null){
  /** @type {MinerSpawnPlacement} */
  const placement = { x, y };
  if (Number.isFinite(supportX) && Number.isFinite(supportY)){
    setSupportAnchor(placement, supportX, supportY);
  }
  const graph = planet.getRadialGraph ? planet.getRadialGraph(false) : planet.radialGraph;
  const nodes = graph && graph.nodes ? graph.nodes : null;
  const air = planet.getAirNodesBitmap ? planet.getAirNodesBitmap(false) : planet.airNodesBitmap;
  const preferredIndex = Number.isFinite(supportNodeIndex) ? Number(supportNodeIndex) : -1;
  const footprint = Array.isArray(supportNodeIndices) && supportNodeIndices.length
    ? supportNodeIndices
    : (
      Number.isFinite(placement.supportX) && Number.isFinite(placement.supportY)
        ? collectSupportNodeIndices(nodes, air, Number(placement.supportX), Number(placement.supportY), minerSupportRadius(planet), preferredIndex, 4)
        : []
    );
  setSupportNodeIndices(placement, footprint, preferredIndex);
  return placement;
}

/**
 * @param {Planet} planet
 * @param {{x:number,y:number,supportX?:number,supportY?:number,supportNodeIndex?:number,supportNodeIndices?:number[]}} pad
 * @returns {MinerSpawnPlacement}
 */
function buildMinerSpawnPlacementFromPad(planet, pad){
  return buildMinerSpawnPlacement(
    planet,
    pad.x,
    pad.y,
    Number.isFinite(pad.supportX) ? Number(pad.supportX) : pad.x,
    Number.isFinite(pad.supportY) ? Number(pad.supportY) : pad.y,
    Number.isFinite(pad.supportNodeIndex) ? Number(pad.supportNodeIndex) : -1,
    Array.isArray(pad.supportNodeIndices) ? pad.supportNodeIndices.slice() : null,
  );
}

/**
 * @param {Planet} planet
 * @param {StandablePoint} pt
 * @returns {MinerSpawnPlacement}
 */
function buildMinerSpawnPlacementFromStandablePoint(planet, pt){
  return buildMinerSpawnPlacement(
    planet,
    Number(pt[0]),
    Number(pt[1]),
    Number(pt[0]),
    Number(pt[1]),
    Number.isFinite(pt[4]) ? Number(pt[4]) : -1,
    null,
  );
}

/**
 * @param {Planet} planet
 * @param {number} count
 * @param {number} seed
 * @param {number} minDist
 * @param {number} [minR]
 * @param {MinerSpawnPlacement[]} [existing]
 * @returns {MinerSpawnPlacement[]}
 */
function pickFallbackMinerSpawnPoints(planet, count, seed, minDist, minR = 0, existing = []){
  if (!(count > 0)) return [];
  const standable = getStandablePoints(planet)
    .filter((pt) => !minR || pt[3] >= minR)
    .slice()
    .sort((a, b) => a[2] - b[2]);
  if (!standable.length) return [];
  const rotate = (((seed | 0) % standable.length) + standable.length) % standable.length;
  const ordered = rotate
    ? standable.slice(rotate).concat(standable.slice(0, rotate))
    : standable;
  /** @type {MinerSpawnPlacement[]} */
  const out = [];
  const chosen = existing.map((pt) => ({ x: pt.x, y: pt.y }));
  const usedSupport = new Set(
    existing
      .filter((pt) => Number.isFinite(pt.supportNodeIndex))
      .map((pt) => Number(pt.supportNodeIndex))
  );
  const passes = [minDist, minDist * 0.6, 0.06];
  for (const passMinDist of passes){
    const minDistSq = passMinDist * passMinDist;
    for (const pt of ordered){
      if (out.length >= count) return out;
      const supportIndex = Number.isFinite(pt[4]) ? Number(pt[4]) : -1;
      if (supportIndex >= 0 && passMinDist > 0.06 && usedSupport.has(supportIndex)) continue;
      let ok = true;
      for (const picked of chosen){
        const dx = pt[0] - picked.x;
        const dy = pt[1] - picked.y;
        if (dx * dx + dy * dy < minDistSq){
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const candidate = buildMinerSpawnPlacementFromStandablePoint(planet, pt);
      out.push(candidate);
      chosen.push({ x: candidate.x, y: candidate.y });
      if (supportIndex >= 0) usedSupport.add(supportIndex);
    }
  }
  return out;
}

/**
 * @param {Planet} planet
 * @param {number} count
 * @param {number} seed
 * @param {number} [minDist]
 * @returns {{
 *  placements: MinerSpawnPlacement[],
 *  debug: {
 *    mode: "barren"|"standable",
 *    pads?: number,
 *    standable?: number,
 *    available?: number,
 *    reservations?: number,
 *    props?: Record<string, number>|null,
 *    minR?: number,
 *    filteredStandable?: number,
 *  }
 * }}
 */
export function planMinerSpawnPlacements(planet, count, seed, minDist = GAME.MINER_MIN_SEP){
  /** @type {MinerSpawnPlacement[]} */
  let placements = [];
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  const barrenPerimeter = !!(cfg && cfg.flags && cfg.flags.barrenPerimeter);
  if (barrenPerimeter){
    reserveBarrenPadsForMiners(planet, count, seed, minDist);
    const reservedPads = [];
    for (const p of (planet.props || [])){
      if (p.type !== "turret_pad" || p.dead || p.padReservedFor !== "miner") continue;
      reservedPads.push(p);
    }
    reservedPads.sort((a, b) => {
      const ringA = (typeof a.padRing === "number") ? a.padRing : Number.MAX_SAFE_INTEGER;
      const ringB = (typeof b.padRing === "number") ? b.padRing : Number.MAX_SAFE_INTEGER;
      if (ringA !== ringB) return ringA - ringB;
      return Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x);
    });
    placements = reservedPads.slice(0, count).map((p) => buildMinerSpawnPlacementFromPad(planet, p));
    if (placements.length < count){
      for (const p of (planet.props || [])){
        if (placements.length >= count) break;
        if (p.type !== "turret_pad" || p.dead || p.padReservedFor === "miner") continue;
        const duplicate = placements.some((candidate) => Math.hypot(candidate.x - p.x, candidate.y - p.y) <= 0.05);
        if (duplicate) continue;
        placements.push(buildMinerSpawnPlacementFromPad(planet, p));
      }
    }
    if (placements.length < count){
      const extra = pickFallbackMinerSpawnPoints(planet, count - placements.length, seed + 17, minDist, 0, placements);
      if (extra.length){
        placements.push(...extra);
      }
    }
    return {
      placements,
      debug: {
        mode: "barren",
        pads: reservedPads.length,
      },
    };
  }

  const standable = getStandablePoints(planet);
  const protectedR = (planet && typeof planet.getProtectedTerrainRadius === "function")
    ? planet.getProtectedTerrainRadius()
    : 0;
  const params = planet.getPlanetParams ? planet.getPlanetParams() : null;
  const moltenOuter = (params && typeof params.MOLTEN_RING_OUTER === "number")
    ? params.MOLTEN_RING_OUTER
    : 0;
  const minR = Math.max(0, Math.max(protectedR, moltenOuter) + 0.6);
  placements = sampleStandablePoints(planet, count, seed, "uniform", minDist, true, minR)
    .map((pt) => buildMinerSpawnPlacement(planet, Number(pt[0]), Number(pt[1])));
  if (placements.length < count){
    const extra = pickFallbackMinerSpawnPoints(planet, count - placements.length, seed + 17, minDist, minR, placements);
    if (extra.length){
      placements.push(...extra);
    }
  }
  const availability = debugAvailableStandableCount(planet, minDist);
  const propCounts = debugPropCounts(planet);
  return {
    placements,
    debug: {
      mode: "standable",
      standable: standable.length,
      available: availability.available,
      reservations: availability.reservations,
      props: propCounts,
      minR,
      filteredStandable: minR > 0 ? standable.filter((pt) => pt[3] >= minR).length : standable.length,
    },
  };
}

/**
 * @param {Planet} planet
 * @returns {void}
 */
export function alignVentSpawnProps(planet){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (cfg && cfg.id === "molten") return;
  const props = planet.props || [];
  if (!props.length) return;
  const vents = props.filter((p) => p.type === "vent");
  if (!vents.length) return;
  const seed = (planet.getSeed() | 0) + 1721;
  const points = sampleLandablePoints(planet, vents.length, seed, 0.30, 0.2, "random");
  if (!points.length) return;
  for (let i = 0; i < vents.length; i++){
    const p = vents[i];
    const pt = points[i % points.length];
    if (!p || !pt) continue;
    p.x = pt[0];
    p.y = pt[1];
    setSupportAnchor(p, pt[0], pt[1]);
    setSupportNodeIndices(p, [], findStandableSupportNodeIndex(planet, pt[0], pt[1]));
  }
}

/**
 * @param {Planet} planet
 * @returns {void}
 */
export function alignGaiaSpawnProps(planet){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!cfg || cfg.id !== "gaia") return;
  const props = planet.props || [];
  if (!props.length) return;
  const trees = props.filter((p) => p.type === "tree");
  const mush = props.filter((p) => p.type === "mushroom");
  if (trees.length){
    const seed = (planet.getSeed() | 0) + 811;
    const surfaceBand = (cfg.defaults && typeof cfg.defaults.SURFACE_BAND === "number") ? cfg.defaults.SURFACE_BAND : 0;
    const surfaceR = planet.planetParams.RMAX * (1 - surfaceBand);
    const rMax = planet.planetParams.RMAX - 0.2;
    const minDist = 0.35;
    const rand = mulberry32(seed);
    const standable = (planet._standablePoints && planet._standablePoints.length)
      ? planet._standablePoints
      : buildStandablePoints(planet);
    const bandPoints = standable.filter((p) => p[3] >= surfaceR && p[3] <= rMax);
    const flatPoints = bandPoints.filter((p) => {
      const normal = planet.normalAtWorld(p[0], p[1]);
      if (!normal) return false;
      const r = Math.hypot(p[0], p[1]) || 1;
      const nx = p[0] / r;
      const ny = p[1] / r;
      return normal.nx * nx + normal.ny * ny >= 0.98;
    });
    const pool = flatPoints.length ? flatPoints : (bandPoints.length ? bandPoints : standable);
    const shuffled = pool.slice();
    for (let i = shuffled.length - 1; i > 0; i--){
      const j = Math.floor(rand() * (i + 1));
      const tmp = /** @type {StandablePoint} */ (shuffled[i]);
      shuffled[i] = /** @type {StandablePoint} */ (shuffled[j]);
      shuffled[j] = tmp;
    }
    /** @type {StandablePoint[]} */
    const points = [];
    for (const sp of shuffled){
      if (points.length >= trees.length) break;
      if (!sp) continue;
      let ok = true;
      for (const q of points){
        const dx = sp[0] - q[0];
        const dy = sp[1] - q[1];
        if (dx * dx + dy * dy < minDist * minDist){
          ok = false;
          break;
        }
      }
      if (ok) points.push(sp);
    }
    for (let i = 0; i < trees.length; i++){
      const p = trees[i];
      if (!p) continue;
      const pt = points[i];
      if (!pt){
        p.dead = true;
        continue;
      }
      setSupportAnchor(p, pt[0], pt[1]);
      setSupportNodeIndices(p, [], Number.isFinite(pt[4]) ? Number(pt[4]) : -1);
      p.x = pt[0];
      p.y = pt[1];
      const normal = planet.normalAtWorld(p.x, p.y);
      if (normal){
        p.nx = normal.nx;
        p.ny = normal.ny;
        const recess = 0.02;
        p.x -= normal.nx * recess;
        p.y -= normal.ny * recess;
      }
    }
  }
  if (mush.length){
    const seed = (planet.getSeed() | 0) + 877;
    const points = sampleUndergroundPoints(planet, mush.length, seed, "random");
    for (let i = 0; i < mush.length && i < points.length; i++){
      const p = mush[i];
      const pt = points[i];
      if (!p || !pt) continue;
      p.x = pt[0];
      p.y = pt[1];
    }
  }
}

/**
 * @param {Planet} planet
 * @returns {void}
 */
export function alignSurfaceDebrisSpawnProps(planet){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!cfg || (cfg.id !== "no_caves" && cfg.id !== "water")) return;
  const props = planet.props || [];
  if (!props.length) return;
  const debris = props.filter((p) => p.type === "boulder" || p.type === "ridge_spike");
  if (!debris.length) return;
  if (!planet._standablePoints || !planet._standablePoints.length){
    planet._standablePoints = buildStandablePoints(planet);
  }
  const seed = (planet.getSeed() | 0) + ((cfg.id === "no_caves") ? 1207 : 1239);
  const placement = (cfg.id === "no_caves") ? "uniform" : "random";
  const minDist = (cfg.id === "no_caves") ? 0.5 : 0.4;
  const points = sampleStandablePoints(planet, debris.length, seed, placement, minDist, false);
  for (let i = 0; i < debris.length; i++){
    const p = debris[i];
    const pt = points[i];
    if (!p) continue;
    if (!pt){
      p.dead = true;
      continue;
    }
    setSupportAnchor(p, pt[0], pt[1]);
    setSupportNodeIndices(p, [], findStandableSupportNodeIndex(planet, pt[0], pt[1]));
    p.x = pt[0];
    p.y = pt[1];
    const info = planet.normalAtWorld(p.x, p.y);
    if (!info) continue;
    p.nx = info.nx;
    p.ny = info.ny;
    const sink = (p.type === "boulder") ? (0.06 * (p.scale || 1)) : (0.035 * (p.scale || 1));
    p.x -= info.nx * sink;
    p.y -= info.ny * sink;
    p.rot = Math.atan2(info.ny, info.nx) - Math.PI * 0.5;
  }
}

/**
 * @param {Planet} planet
 * @returns {void}
 */
export function alignCavernDebrisSpawnProps(planet){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!cfg || cfg.id !== "cavern") return;
  const props = planet.props || [];
  if (!props.length) return;
  const stal = props.filter((p) => p.type === "stalactite");
  const boulders = props.filter((p) => p.type === "boulder");
  const spikes = props.filter((p) => p.type === "ridge_spike");
  const total = stal.length + boulders.length + spikes.length;
  if (!total) return;
  const seed = (planet.getSeed() | 0) + 1327;
  const points = sampleCaveAttachmentPoints(planet, total, seed, 0.45);
  let cursor = 0;
  /**
   * @param {any} p
   * @param {number} sinkMul
   * @returns {void}
   */
  const applyAttach = (p, sinkMul) => {
    if (!p) return;
    const pt = points[cursor++];
    if (!pt){
      p.dead = true;
      return;
    }
    p.nx = pt.nx;
    p.ny = pt.ny;
    setSupportAnchor(p, pt.x, pt.y);
    setSupportNodeIndices(p, [], pt.supportNodeIndex);
    p.rot = Math.atan2(pt.ny, pt.nx) - Math.PI * 0.5;
    const sink = sinkMul * (p.scale || 1);
    p.x = pt.x - pt.nx * sink;
    p.y = pt.y - pt.ny * sink;
  };
  for (const p of stal) applyAttach(p, 0.025);
  for (const p of boulders) applyAttach(p, 0.10);
  for (const p of spikes) applyAttach(p, 0.05);
}

/**
 * @param {Planet} planet
 * @returns {void}
 */
export function alignMechanizedStructureSpawnProps(planet){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!cfg || cfg.id !== "mechanized") return;
  const factorySpawnCooldownMin = (cfg && typeof cfg.factorySpawnCooldownMin === "number") ? cfg.factorySpawnCooldownMin : 6.5;
  const factorySpawnCooldownMax = (cfg && typeof cfg.factorySpawnCooldownMax === "number") ? cfg.factorySpawnCooldownMax : 10.5;
  const cooldownMin = Math.max(0.1, Math.min(factorySpawnCooldownMin, factorySpawnCooldownMax));
  const cooldownMax = Math.max(cooldownMin, Math.max(factorySpawnCooldownMin, factorySpawnCooldownMax));
  const props = planet.props || [];
  if (!props.length) return;
  const coreR = planet.getCoreRadius ? planet.getCoreRadius() : 0;
  const factories = [];
  const gates = [];
  const tethers = [];
  for (const p of props){
    if (p.type === "factory") factories.push(p);
    else if (p.type === "gate") gates.push(p);
    else if (p.type === "tether") tethers.push(p);
  }
  if (!factories.length && !gates.length && !tethers.length) return;
  if (!planet._standablePoints || !planet._standablePoints.length){
    planet._standablePoints = buildStandablePoints(planet);
  }
  const seed = (planet.getSeed() | 0) + 1907;
  const rand = mulberry32(seed + 31);
  const coreMode = coreR > 0.5 && tethers.length > 0;
  if (coreMode){
    for (const p of gates){
      p.dead = true;
    }
    const innerR = Math.max(0.6, coreR + 0.55);
    const outerCap = Math.max(innerR + 0.8, planet.planetParams.RMAX - 0.5);
    const standable = filterReachableStandable(planet, getStandablePoints(planet))
      .filter((p) => p[3] >= innerR + 0.9);
    const landableStandable = standable.filter((p) => planet.isLandableAtWorld(p[0], p[1], 0.32, 0.2, 0.18));
    const factorySites = landableStandable.length ? landableStandable : standable;
    /** @type {number[]} */
    const usedAngles = [];
    const usedSites = new Set();
    /**
     * @param {number} a
     * @param {number} b
     * @returns {number}
     */
    const wrapDiff = (a, b) => {
      let d = Math.abs(a - b);
      if (d > Math.PI) d = Math.abs(d - Math.PI * 2);
      return d;
    };
    /**
     * @param {number} x
     * @returns {number}
     */
    const normalizeAngle = (x) => {
      let a = x % (Math.PI * 2);
      if (a < 0) a += Math.PI * 2;
      return a;
    };
    /**
     * @param {number} ang
     * @returns {{nx:number,ny:number,outerR:number}|null}
     */
    const evaluateTetherAngle = (ang) => {
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      let firstAir = -1;
      let rockAfterAir = -1;
      for (let r = innerR + 0.25; r <= outerCap; r += 0.16){
        const isAir = planet.airValueAtWorld(nx * r, ny * r) > 0.5;
        if (isAir){
          if (firstAir < 0) firstAir = r;
        } else if (firstAir >= 0){
          rockAfterAir = r;
          break;
        }
      }
      if (firstAir < 0 || rockAfterAir < 0) return null;
      return {
        nx,
        ny,
        outerR: Math.max(innerR + 0.9, rockAfterAir - 0.08),
      };
    };
    /**
     * @param {number} ang
     * @param {number} minR
     * @returns {number}
     */
    const pickFactoryStandableIndex = (ang, minR) => {
      if (!factorySites.length) return -1;
      let best = -1;
      let bestScore = Infinity;
      const thresholds = [0.42, 0.68];
      for (const th of thresholds){
        best = -1;
        bestScore = Infinity;
        for (let i = 0; i < factorySites.length; i++){
          if (usedSites.has(i)) continue;
          const sp = factorySites[i];
          if (!sp || sp[3] < minR) continue;
          const dAng = wrapDiff(sp[2], ang);
          if (dAng > th) continue;
          const score = dAng * 3.0 + Math.max(0, sp[3] - minR) * 0.03;
          if (score < bestScore){
            bestScore = score;
            best = i;
          }
        }
        if (best >= 0) return best;
      }
      return -1;
    };
    /**
     * @param {any} factory
     * @param {number} idx
     * @param {number} iFactory
     * @returns {void}
     */
    const placeFactoryAtStandable = (factory, idx, iFactory) => {
      if (!factory || idx < 0 || idx >= factorySites.length){
        if (factory) factory.dead = true;
        return;
      }
      usedSites.add(idx);
      const pt = factorySites[idx];
      if (!pt){
        factory.dead = true;
        return;
      }
      setSupportAnchor(factory, pt[0], pt[1]);
      setSupportNodeIndices(factory, [], Number.isFinite(pt[4]) ? Number(pt[4]) : -1);
      factory.x = pt[0];
      factory.y = pt[1];
      const normal = planet.normalAtWorld(factory.x, factory.y);
      if (normal){
        factory.nx = normal.nx;
        factory.ny = normal.ny;
        factory.x -= normal.nx * (0.05 * (factory.scale || 1));
        factory.y -= normal.ny * (0.05 * (factory.scale || 1));
        factory.rot = Math.atan2(normal.ny, normal.nx) - Math.PI * 0.5;
      }
      factory.propId = iFactory;
      factory.hp = (typeof factory.hp === "number") ? Math.max(1, factory.hp) : 5;
      factory.spawnCd = cooldownMin + rand() * (cooldownMax - cooldownMin);
      factory.spawnT = rand() * factory.spawnCd;
    };
    for (let i = 0; i < tethers.length; i++){
      const tether = tethers[i];
      if (!tether) continue;
      let picked = null;
      const minAngSep = 0.4;
      const base = normalizeAngle((i / Math.max(1, tethers.length)) * Math.PI * 2 + (rand() - 0.5) * 0.35);
      for (let attempt = 0; attempt < 56; attempt++){
        const jitter = (rand() * 2 - 1) * (0.18 + 0.015 * attempt);
        const ang = normalizeAngle(base + jitter);
        if (usedAngles.some((a) => wrapDiff(a, ang) < minAngSep)) continue;
        const evalRes = evaluateTetherAngle(ang);
        if (!evalRes) continue;
        const fIdx = pickFactoryStandableIndex(ang, evalRes.outerR + 0.45);
        if (fIdx < 0) continue;
        picked = { ang, fIdx, ...evalRes };
        break;
      }
      if (!picked){
        for (let attempt = 0; attempt < 140; attempt++){
          const ang = normalizeAngle(rand() * Math.PI * 2);
          if (usedAngles.some((a) => wrapDiff(a, ang) < minAngSep)) continue;
          const evalRes = evaluateTetherAngle(ang);
          if (!evalRes) continue;
          const fIdx = pickFactoryStandableIndex(ang, evalRes.outerR + 0.25);
          if (fIdx < 0) continue;
          picked = { ang, fIdx, ...evalRes };
          break;
        }
      }
      if (!picked){
        tether.dead = true;
        tether.hp = 0;
        continue;
      }
      usedAngles.push(picked.ang);
      const centerR = 0.5 * (innerR + picked.outerR);
      tether.x = picked.nx * centerR;
      tether.y = picked.ny * centerR;
      tether.nx = picked.nx;
      tether.ny = picked.ny;
      tether.rot = Math.atan2(picked.ny, picked.nx) - Math.PI * 0.5;
      tether.halfLength = Math.max(0.5, 0.5 * (picked.outerR - innerR));
      tether.halfWidth = Math.max(0.08, Math.min(0.18, (typeof tether.halfWidth === "number") ? tether.halfWidth : (0.11 + rand() * 0.04)));
      const factory = (i < factories.length) ? factories[i] : null;
      if (factory){
        placeFactoryAtStandable(factory, picked.fIdx, i);
        tether.protectedBy = (typeof factory.propId === "number") ? factory.propId : i;
      } else {
        tether.protectedBy = -1;
      }
    }
    for (let i = tethers.length; i < factories.length; i++){
      const factory = factories[i];
      if (!factory) continue;
      let idx = -1;
      for (let j = 0; j < factorySites.length; j++){
        if (usedSites.has(j)) continue;
        idx = j;
        break;
      }
      placeFactoryAtStandable(factory, idx, i);
    }
    return;
  }

  const factoryPts = sampleStandablePoints(planet, factories.length, seed, "uniform", 1.5, false);
  for (let i = 0; i < factories.length; i++){
    const p = factories[i];
    if (!p) continue;
    const pt = factoryPts[i];
    if (!pt){
      p.dead = true;
      continue;
    }
    setSupportAnchor(p, pt[0], pt[1]);
    setSupportNodeIndices(p, [], findStandableSupportNodeIndex(planet, pt[0], pt[1]));
    p.x = pt[0];
    p.y = pt[1];
    const normal = planet.normalAtWorld(p.x, p.y);
    if (normal){
      p.nx = normal.nx;
      p.ny = normal.ny;
      p.x -= normal.nx * (0.05 * (p.scale || 1));
      p.y -= normal.ny * (0.05 * (p.scale || 1));
      p.rot = Math.atan2(normal.ny, normal.nx) - Math.PI * 0.5;
    }
    p.propId = i;
    p.hp = (typeof p.hp === "number") ? Math.max(1, p.hp) : 5;
    p.spawnCd = cooldownMin + rand() * (cooldownMax - cooldownMin);
    p.spawnT = rand() * p.spawnCd;
  }

  const gatePts = sampleStandablePoints(planet, gates.length, seed + 97, "clusters", 2.0, false);
  for (let i = 0; i < gates.length; i++){
    const p = gates[i];
    if (!p) continue;
    const pt = gatePts[i];
    if (!pt){
      p.dead = true;
      continue;
    }
    p.x = pt[0];
    p.y = pt[1];
    const normal = planet.normalAtWorld(p.x, p.y);
    if (normal){
      p.nx = normal.nx;
      p.ny = normal.ny;
      p.x -= normal.nx * (0.03 * (p.scale || 1));
      p.y -= normal.ny * (0.03 * (p.scale || 1));
      p.rot = Math.atan2(normal.ny, normal.nx) - Math.PI * 0.5;
    }
  }
}

/**
 * Constructor-time prop placement and spawn reservation setup.
 * @param {Planet} planet
 * @returns {void}
 */
export function initializePlanetProps(planet){
  rebuildSpawnReachabilityMask(planet);
  spreadIceShardsUniform(planet);
  snapIceShardsToSurface(planet);
  alignTurretPadSpawnProps(planet);
  alignVentSpawnProps(planet);
  alignGaiaSpawnProps(planet);
  alignSurfaceDebrisSpawnProps(planet);
  alignCavernDebrisSpawnProps(planet);
  refreshTerrainPropSupportNodes(planet);
  alignMechanizedStructureSpawnProps(planet);
  reserveSpawnPointsFromProps(planet);
  if (!planet._standablePoints || !planet._standablePoints.length){
    planet._standablePoints = buildStandablePoints(planet);
  }
}

/**
 * @param {Planet} planet
 * @param {number} count
 * @param {number} seed
 * @param {"uniform"|"random"|"clusters"} [placement]
 * @returns {Array<[number,number]>}
 */
export function sampleUndergroundPoints(planet, count, seed, placement = "random"){
  if (count <= 0) return [];
  const rand = mulberry32(seed);
  /** @type {Array<[number,number]>} */
  const points = [];
  const rMax = planet.planetParams.RMAX * 0.9;
  const attempts = Math.max(200, count * 140);
  /** @param {number} i */
  const angleAt = (i) => {
    if (placement === "uniform"){
      const base = (i / count) * Math.PI * 2;
      return base + (rand() - 0.5) * 0.35;
    }
    return rand() * Math.PI * 2;
  };
  for (let i = 0; i < attempts && points.length < count; i++){
    const ang = angleAt(points.length);
    const r = Math.sqrt(rand()) * rMax;
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    if (planet.airValueAtWorld(x, y) > 0.5) continue;
    const eps = 0.18;
    if (planet.airValueAtWorld(x + eps, y) > 0.5) continue;
    if (planet.airValueAtWorld(x - eps, y) > 0.5) continue;
    if (planet.airValueAtWorld(x, y + eps) > 0.5) continue;
    if (planet.airValueAtWorld(x, y - eps) > 0.5) continue;
    points.push([x, y]);
  }
  return points;
}

/**
 * @param {Planet} planet
 * @param {number} count
 * @param {number} seed
 * @param {"uniform"|"random"|"clusters"} [placement]
 * @returns {Array<[number,number]>}
 */
export function sampleSurfacePoints(planet, count, seed, placement = "random"){
  if (count <= 0) return [];
  const rand = mulberry32(seed);
  /** @type {Array<[number,number]>} */
  const points = [];
  const rMin = 1.0;
  const shell = (planet.planetParams.NO_CAVES && planet.mapgen && planet.mapgen.grid)
    ? Math.max(planet.mapgen.grid.cell * 1.5, 0.35)
    : 0;
  const rMax = Math.max(rMin + 0.5, planet.planetParams.RMAX - shell - 0.15);
  const attempts = Math.max(200, count * 120);
  /** @param {number} i */
  const angleAt = (i) => {
    if (placement === "uniform"){
      const base = (i / count) * Math.PI * 2;
      return base + (rand() - 0.5) * 0.35;
    }
    return rand() * Math.PI * 2;
  };
  for (let i = 0; i < attempts && points.length < count; i++){
    const ang = angleAt(points.length);
    const surf = findSurfaceAtAngle(planet, ang, rMin, rMax);
    if (!surf) continue;
    points.push([surf.x, surf.y]);
  }
  return points;
}

/**
 * @param {Planet} planet
 * @param {number} count
 * @param {number} seed
 * @param {number} rMin
 * @param {number} rMax
 * @param {"uniform"|"random"|"clusters"} [placement]
 * @returns {Array<[number,number]>}
 */
export function sampleAirPoints(planet, count, seed, rMin, rMax, placement = "random"){
  if (rMin >= rMax || count <= 0) return [];
  const rand = mulberry32(seed);
  const restrictReachability = !!planet._spawnReachableMask;
  /** @type {Array<[number,number]>} */
  const points = [];
  const attempts = Math.max(200, count * 80);
  if (placement === "uniform"){
    const jitter = 0.35;
    for (let i = 0; i < count; i++){
      const base = (i / count) * Math.PI * 2;
      const ang = base + (rand() - 0.5) * jitter;
      const rr = rMin * rMin + rand() * (rMax * rMax - rMin * rMin);
      const r = Math.sqrt(Math.max(0, rr));
      const x = r * Math.cos(ang);
      const y = r * Math.sin(ang);
      if (planet.airValueAtWorld(x, y) <= 0.5) continue;
      if (restrictReachability && !isSpawnReachableAt(planet, x, y)) continue;
      points.push([x, y]);
    }
    return points;
  }
  for (let i = 0; i < attempts && points.length < count; i++){
    const ang = rand() * Math.PI * 2;
    const r = Math.sqrt(rMin * rMin + rand() * (rMax * rMax - rMin * rMin));
    const x = r * Math.cos(ang);
    const y = r * Math.sin(ang);
    if (planet.airValueAtWorld(x, y) <= 0.5) continue;
    if (restrictReachability && !isSpawnReachableAt(planet, x, y)) continue;
    points.push([x, y]);
  }
  return points;
}

/**
 * @param {Planet} planet
 * @param {number} count
 * @param {number} seed
 * @param {number} maxSlope
 * @param {number} clearance
 * @param {"uniform"|"random"|"clusters"} [placement]
 * @returns {Array<[number,number]>}
 */
export function sampleLandablePoints(planet, count, seed, maxSlope = 0.28, clearance = 0.2, placement = "random"){
  if (count <= 0) return [];
  const rand = mulberry32(seed);
  /** @type {Array<[number,number]>} */
  const points = [];
  const rMin = 1.0;
  const rMax = planet.planetParams.RMAX + 1.2;
  const attempts = Math.max(200, count * 120);
  /** @param {number} i */
  const angleAt = (i) => {
    if (placement === "uniform"){
      const base = (i / count) * Math.PI * 2;
      return base + (rand() - 0.5) * 0.35;
    }
    return rand() * Math.PI * 2;
  };
  for (let i = 0; i < attempts && points.length < count; i++){
    const ang = angleAt(points.length);
    const surf = findSurfaceAtAngle(planet, ang, rMin, rMax);
    if (!surf) continue;
    const nx = surf.x / (Math.hypot(surf.x, surf.y) || 1);
    const ny = surf.y / (Math.hypot(surf.x, surf.y) || 1);
    const x = surf.x + nx * 0.02;
    const y = surf.y + ny * 0.02;
    if (!planet.isLandableAtWorld(x, y, maxSlope, clearance, 0.18)) continue;
    points.push([x, y]);
  }
  return points;
}

/**
 * @param {Planet} planet
 * @returns {void}
 */
function snapIceShardsToSurface(planet){
  if (!planet.props || !planet.props.length) return;
  for (const prop of planet.props){
    if (prop.type !== "ice_shard") continue;
    if (prop.dead || (typeof prop.hp === "number" && prop.hp <= 0)) continue;
    let normal = planet.normalAtWorld(prop.x, prop.y);
    if (!normal){
      prop.dead = true;
      prop.hp = 0;
      continue;
    }
    if (planet.airValueAtWorld(prop.x, prop.y) > 0.5){
      for (let i = 0; i < 6; i++){
        prop.x -= normal.nx * 0.06;
        prop.y -= normal.ny * 0.06;
        if (planet.airValueAtWorld(prop.x, prop.y) <= 0.5) break;
      }
    } else {
      const res = planet.nudgeOutOfTerrain(prop.x, prop.y, 0.8, 0.08, 0.18);
      if (res.ok){
        prop.x = res.x;
        prop.y = res.y;
      }
    }
    normal = planet.normalAtWorld(prop.x, prop.y);
    if (!normal){
      prop.dead = true;
      prop.hp = 0;
      continue;
    }
    prop.x -= normal.nx * 0.03;
    prop.y -= normal.ny * 0.03;
  }
}

/**
 * @param {Planet} planet
 * @returns {void}
 */
function spreadIceShardsUniform(planet){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!cfg || cfg.id !== "ice") return;
  if (!planet.props || !planet.props.length) return;
  const shards = [];
  for (const prop of planet.props){
    if (prop.type === "ice_shard") shards.push(prop);
  }
  if (!shards.length) return;
  const seed = (planet.mapgen.getWorld().seed | 0) + 331;
  const points = sampleSurfacePoints(planet, shards.length, seed, "uniform");
  if (!points.length) return;
  const rand = mulberry32(seed + 17);
  for (let i = 0; i < shards.length; i++){
    const prop = shards[i];
    if (!prop) continue;
    const pt = points[i % points.length];
    if (!pt) continue;
    prop.x = pt[0];
    prop.y = pt[1];
    const normal = planet.normalAtWorld(prop.x, prop.y);
    if (normal){
      const tx = -normal.ny;
      const ty = normal.nx;
      const base = Math.atan2(ty, tx);
      prop.rot = base + (rand() - 0.5) * 0.6;
    } else {
      prop.rot = rand() * Math.PI * 2;
    }
  }
}

/**
 * @param {Planet} planet
 * @param {number} minerCount
 * @param {number} turretCount
 * @param {number} seed
 * @param {number} [minDist]
 * @returns {void}
 */
export function layoutBarrenPadsForRoles(planet, minerCount, turretCount, seed, minDist = GAME.MINER_MIN_SEP){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!(cfg && cfg.flags && cfg.flags.barrenPerimeter)) return;
  const pads = (planet.props || []).filter((p) => p.type === "turret_pad");
  if (!pads.length) return;
  const lookup = buildBarrenPadLookup(planet, seed);
  if (!lookup) return;
  /** @type {Array<any>} */
  const chosenMiners = [];
  /** @type {Array<any>} */
  const chosenTurrets = [];
  /** @type {Set<any>} */
  const used = new Set();
  const pairedTarget = Math.min(Math.max(0, minerCount | 0), Math.max(0, turretCount | 0));
  if (pairedTarget > 0){
    for (const candidate of lookup.inner){
      if (chosenMiners.length >= pairedTarget) break;
      if (used.has(candidate)) continue;
      if (!barrenCandidateHasSpacing(candidate, chosenMiners, minDist)) continue;
      const overwatch = findBarrenOverwatchCandidate(planet, candidate, lookup, used, chosenTurrets, minDist);
      if (!overwatch) continue;
      used.add(candidate);
      used.add(overwatch);
      chosenMiners.push(candidate);
      chosenTurrets.push(overwatch);
    }
  }
  for (const candidate of lookup.inner){
    if (chosenMiners.length >= minerCount) break;
    if (used.has(candidate)) continue;
    if (!barrenCandidateHasSpacing(candidate, chosenMiners, minDist)) continue;
    used.add(candidate);
    chosenMiners.push(candidate);
  }
  if (chosenTurrets.length < turretCount){
    for (const miner of chosenMiners){
      if (chosenTurrets.length >= turretCount) break;
      const overwatch = findBarrenOverwatchCandidate(planet, miner, lookup, used, chosenTurrets, minDist);
      if (!overwatch) continue;
      used.add(overwatch);
      chosenTurrets.push(overwatch);
    }
  }
  if (chosenTurrets.length < turretCount){
    for (const candidate of lookup.outer){
      if (chosenTurrets.length >= turretCount) break;
      if (used.has(candidate)) continue;
      if (!barrenCandidateHasSpacing(candidate, chosenTurrets, minDist)) continue;
      used.add(candidate);
      chosenTurrets.push(candidate);
    }
  }
  /** @type {Array<{candidate:any,reservedFor:"miner"|"turret"|null}>} */
  const placements = [];
  for (const candidate of chosenMiners){
    placements.push({ candidate, reservedFor: "miner" });
  }
  for (const candidate of chosenTurrets){
    placements.push({ candidate, reservedFor: null });
  }
  for (let i = 0; i < pads.length; i++){
    const prop = pads[i];
    if (!prop) continue;
    const placement = placements[i] || null;
    if (!placement){
      prop.dead = true;
      prop.hp = 0;
      delete prop.padRing;
      delete prop.padDepth;
      delete prop.padAnchorKind;
      delete prop.padSourceKind;
      delete prop.padSourceRing;
      delete prop.padSourceIndex;
      prop.padReservedFor = null;
      continue;
    }
    applyBarrenPadCandidateToProp(planet, placement.candidate, prop, placement.reservedFor);
  }
}

/**
 * @param {Planet} planet
 * @param {number} seed
 * @param {boolean} [innerFirst=true]
 * @returns {Array<any>}
 */
export function orderedBarrenPadProps(planet, seed, innerFirst = true){
  const pads = (planet.props || []).filter((prop) => (
    prop.type === "turret_pad"
    && !prop.dead
    && typeof prop.padRing === "number"
  ));
  return orderBarrenByRing(pads, seed, innerFirst, (pad) => Number(pad.padRing));
}

/**
 * @param {Planet} planet
 * @param {number} count
 * @param {number} seed
 * @param {number} [minDist]
 * @returns {Array<[number,number]>}
 */
export function reserveBarrenPadsForMiners(planet, count, seed, minDist = GAME.MINER_MIN_SEP){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (!(cfg && cfg.flags && cfg.flags.barrenPerimeter) || count <= 0) return [];
  const ordered = orderedBarrenPadProps(planet, seed, true);
  const existing = ordered.filter((pad) => pad.padReservedFor === "miner");
  if (existing.length >= count){
    return existing.slice(0, count).map((pad) => [pad.x, pad.y]);
  }
  /** @type {Array<any>} */
  const chosen = existing.slice();
  for (const pad of ordered){
    if (chosen.length >= count) break;
    if (pad.padReservedFor) continue;
    if (!isFarFromReservations(pad.x, pad.y, minDist, planet._spawnReservations)) continue;
    let ok = true;
    for (const cur of chosen){
      const dx = pad.x - cur.x;
      const dy = pad.y - cur.y;
      if (dx * dx + dy * dy < minDist * minDist){
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pad.padReservedFor = "miner";
    chosen.push(pad);
  }
  if (chosen.length > existing.length){
    reserveSpawnPoints(planet, chosen.slice(existing.length).map((pad) => ({ x: pad.x, y: pad.y })), minDist);
  }
  return chosen.map((pad) => [pad.x, pad.y]);
}

/**
 * @param {Planet} planet
 * @param {Array<{x:number,y:number}>} points
 * @param {number} [minDist=0]
 * @returns {void}
 */
export function reserveSpawnPoints(planet, points, minDist = 0){
  if (!points || !points.length) return;
  const r = Math.max(0, minDist);
  for (const point of points){
    planet._spawnReservations.push({ x: point.x, y: point.y, r });
  }
}

/**
 * @param {Planet} planet
 * @param {number} count
 * @param {number} seed
 * @param {"uniform"|"random"|"clusters"} [placement]
 * @param {number} [minDist]
 * @param {boolean} [reserve]
 * @param {number} [minR]
 * @returns {Array<[number,number]>}
 */
export function sampleStandablePoints(planet, count, seed, placement = "random", minDist = 0, reserve = false, minR = 0){
  if (count <= 0) return [];
  const basePoints = filterReachableStandable(planet, getStandablePoints(planet));
  const points = (minR > 0) ? basePoints.filter((p) => p[3] >= minR) : basePoints;
  if (!points.length) return [];
  const rand = mulberry32(seed);
  const rMax = (planet.planetParams.RMAX || CFG.RMAX) || 1;
  const bias = 0.35;
  const take = Math.min(count, points.length);
  /** @type {Array<[number,number]>} */
  const out = [];
  /** @type {Array<number>} */
  const indices = points.map((_, i) => i);
  const used = new Set();
  /** @type {Array<{x:number,y:number,r:number}>} */
  const reservations = planet._spawnReservations || [];
  if (placement === "uniform"){
    indices.sort((a, b) => /** @type {StandablePoint} */ (points[a])[2] - /** @type {StandablePoint} */ (points[b])[2]);
    const offset = rand();
    const step = (Math.PI * 2) / take;
    const window = step * 0.65;
    for (let i = 0; i < take; i++){
      const target = (i + offset) * step;
      let picked = -1;
      let pickedScore = Infinity;
      for (const idx of indices){
        const p = points[idx];
        if (!p) continue;
        const ang = p[2];
        let d = Math.abs(ang - target);
        d = Math.min(d, Math.abs(d - Math.PI * 2));
        if (d > window) continue;
        if (used.has(idx)) continue;
        if (!isFarFromReservations(p[0], p[1], minDist, reservations)) continue;
        let ok = true;
        for (const q of out){
          const dx = p[0] - q[0];
          const dy = p[1] - q[1];
          if (dx * dx + dy * dy < minDist * minDist){
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const r = p[3];
        const biasScore = (r / rMax) * bias;
        const score = d / window + biasScore;
        if (score < pickedScore){
          pickedScore = score;
          picked = idx;
        }
      }
      if (picked >= 0){
        const p = points[picked];
        if (!p) continue;
        used.add(picked);
        out.push([p[0], p[1]]);
        if (out.length >= take) break;
      }
    }
  } else if (placement === "clusters"){
    const clusterCount = Math.max(1, Math.floor(Math.sqrt(take)));
    /** @type {number[]} */
    const centers = [];
    for (let i = 0; i < indices.length && centers.length < clusterCount; i++){
      const idx = indices[Math.floor(rand() * indices.length)];
      if (idx === undefined) continue;
      const p = points[idx];
      if (!p) continue;
      centers.push(p[2]);
    }
    if (!centers.length) return out;
    let clusterIndex = 0;
    const window = (Math.PI * 2) / Math.max(6, clusterCount * 2);
    for (let i = 0; i < take; i++){
      const target = centers[clusterIndex % centers.length];
      if (target === undefined) continue;
      clusterIndex++;
      let picked = -1;
      let pickedScore = Infinity;
      for (const idx of indices){
        if (used.has(idx)) continue;
        const p = points[idx];
        if (!p) continue;
        let d = Math.abs(p[2] - target);
        d = Math.min(d, Math.abs(d - Math.PI * 2));
        if (d > window) continue;
        if (!isFarFromReservations(p[0], p[1], minDist, reservations)) continue;
        let ok = true;
        for (const q of out){
          const dx = p[0] - q[0];
          const dy = p[1] - q[1];
          if (dx * dx + dy * dy < minDist * minDist){
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const r = p[3];
        const biasScore = (r / rMax) * bias;
        const score = d / window + biasScore;
        if (score < pickedScore){
          pickedScore = score;
          picked = idx;
        }
      }
      if (picked >= 0){
        const p = points[picked];
        if (!p) continue;
        used.add(picked);
        out.push([p[0], p[1]]);
        if (out.length >= take) break;
      }
    }
  } else {
    for (let i = indices.length - 1; i > 0; i--){
      const j = Math.floor(rand() * (i + 1));
      const tmp = /** @type {number} */ (indices[i]);
      indices[i] = /** @type {number} */ (indices[j]);
      indices[j] = tmp;
    }
    for (const idx of indices){
      const p = points[idx];
      if (!p) continue;
      if (used.has(idx)) continue;
      if (!isFarFromReservations(p[0], p[1], minDist, reservations)) continue;
      let ok = true;
      for (const q of out){
        const dx = p[0] - q[0];
        const dy = p[1] - q[1];
        if (dx * dx + dy * dy < minDist * minDist){
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const r = p[3];
      const w = 1 + bias * Math.max(0, 1 - r / rMax);
      const maxW = 1 + bias;
      if (rand() > (w / maxW)) continue;
      used.add(idx);
      out.push([p[0], p[1]]);
      if (out.length >= take) break;
    }
  }
  if (out.length < take){
    for (const idx of indices){
      if (out.length >= take) break;
      if (used.has(idx)) continue;
      const p = points[idx];
      if (!p) continue;
      if (!isFarFromReservations(p[0], p[1], minDist, reservations)) continue;
      let ok = true;
      for (const q of out){
        const dx = p[0] - q[0];
        const dy = p[1] - q[1];
        if (dx * dx + dy * dy < minDist * minDist){
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      used.add(idx);
      out.push([p[0], p[1]]);
    }
  }
  if (reserve && out.length){
    reserveSpawnPoints(planet, out.map((p) => ({ x: p[0], y: p[1] })), minDist);
  }
  return out;
}

/**
 * @param {Planet} planet
 * @param {number} minDist
 * @returns {{standable:number, available:number, reservations:number}}
 */
export function debugAvailableStandableCount(planet, minDist = 0){
  const points = getStandablePoints(planet);
  const reservations = planet._spawnReservations || [];
  let available = 0;
  for (const p of points){
    if (isFarFromReservations(p[0], p[1], minDist, reservations)){
      available++;
    }
  }
  return { standable: points.length, available, reservations: reservations.length };
}

/**
 * @param {Planet} planet
 * @returns {Record<string, number>}
 */
export function debugPropCounts(planet){
  /** @type {Record<string, number>} */
  const counts = {};
  if (!planet.props || !planet.props.length) return counts;
  for (const prop of planet.props){
    const key = prop.type || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/**
 * @param {Planet} planet
 * @param {number} count
 * @param {number} seed
 * @param {"uniform"|"random"|"clusters"} [placement]
 * @param {number} [minDist]
 * @param {boolean} [reserve]
 * @returns {Array<[number,number]>}
 */
export function sampleTurretPoints(planet, count, seed, placement = "random", minDist = 0, reserve = false){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  if (cfg && cfg.flags && cfg.flags.barrenPerimeter){
    const pads = orderedBarrenPadProps(planet, seed, false).filter((pad) => !pad.padReservedFor);
    if (pads.length){
      /** @type {Array<any>} */
      const chosen = [];
      for (const pad of pads){
        if (chosen.length >= count) break;
        if (!isFarFromReservations(pad.x, pad.y, minDist, planet._spawnReservations)) continue;
        let ok = true;
        for (const cur of chosen){
          const dx = pad.x - cur.x;
          const dy = pad.y - cur.y;
          if (dx * dx + dy * dy < minDist * minDist){
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        chosen.push(pad);
      }
      if (reserve && chosen.length){
        for (const pad of chosen){
          if (!pad.padReservedFor) pad.padReservedFor = "turret";
        }
        reserveSpawnPoints(planet, chosen.map((pad) => ({ x: pad.x, y: pad.y })), minDist);
      }
      return chosen.map((pad) => [pad.x, pad.y]);
    }
  }
  const pool = sampleStandablePoints(planet, Math.max(count * 3, count), seed, placement, minDist, false);
  const coreR = planet.getCoreRadius ? planet.getCoreRadius() : 0;
  const moltenOuter = planet.planetParams && typeof planet.planetParams.MOLTEN_RING_OUTER === "number"
    ? planet.planetParams.MOLTEN_RING_OUTER
    : 0;
  const minR = Math.max(0, Math.max(coreR, moltenOuter) + 0.6);
  const out = (minR > 0)
    ? pool.filter((p) => (Math.hypot(p[0], p[1]) >= minR)).slice(0, count)
    : pool.slice(0, count);
  if (reserve && out.length){
    reserveSpawnPoints(planet, out.map((pt) => ({ x: pt[0], y: pt[1] })), minDist);
  }
  return out;
}

/**
 * @param {Planet} planet
 * @returns {void}
 */
export function rebuildSpawnReachabilityMask(planet){
  if (!restrictToReachableSpawns(planet)){
    planet._spawnReachableMask = null;
    return;
  }
  const graph = planet.radialGraph;
  const passable = planet.airNodesBitmap;
  if (!graph || !graph.nodes || !graph.nodes.length || !passable || passable.length !== graph.nodes.length){
    planet._spawnReachableMask = null;
    return;
  }
  const nearSurfaceR = Math.max(0, (planet.planetParams.RMAX || planet.planetRadius || 0) - 0.9);
  /** @type {number[]} */
  const sources = [];
  for (let i = 0; i < graph.nodes.length; i++){
    if (!passable[i]) continue;
    const node = graph.nodes[i];
    if (!node) continue;
    const r = Math.hypot(node.x, node.y);
    if (r >= nearSurfaceR){
      sources.push(i);
    }
  }
  if (!sources.length){
    for (let i = 0; i < passable.length; i++){
      if (passable[i]){
        sources.push(i);
        break;
      }
    }
  }
  if (!sources.length){
    planet._spawnReachableMask = null;
    return;
  }
  const dist = dijkstraMap(graph, sources, passable);
  const mask = new Uint8Array(passable.length);
  for (let i = 0; i < passable.length; i++){
    if (!passable[i]) continue;
    if (Number.isFinite(dist[i])) mask[i] = 1;
  }
  planet._spawnReachableMask = mask;
}

/**
 * @param {Planet} planet
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function isSpawnReachableAt(planet, x, y){
  if (!planet._spawnReachableMask) return true;
  const iNode = planet.nearestRadialNodeInAir(x, y);
  if (iNode < 0 || iNode >= planet._spawnReachableMask.length) return false;
  return !!planet._spawnReachableMask[iNode];
}

/**
 * @param {Planet} planet
 * @param {StandablePoint[]} points
 * @returns {StandablePoint[]}
 */
export function filterReachableStandable(planet, points){
  if (!planet._spawnReachableMask) return points;
  /** @type {StandablePoint[]} */
  const out = [];
  for (const point of points){
    if (!isSpawnReachableAt(planet, point[0], point[1])) continue;
    out.push(point);
  }
  return out;
}

/**
 * @param {number} x
 * @param {number} y
 * @param {number} minDist
 * @param {Array<{x:number,y:number,r:number}>} reservations
 * @returns {boolean}
 */
export function isFarFromReservations(x, y, minDist, reservations){
  if (minDist <= 0 || !reservations.length) return true;
  for (const reservation of reservations){
    const dx = x - reservation.x;
    const dy = y - reservation.y;
    const rr = Math.max(minDist, reservation.r || 0);
    if (dx * dx + dy * dy < rr * rr) return false;
  }
  return true;
}

/**
 * @param {Planet} planet
 * @returns {void}
 */
function reserveSpawnPointsFromProps(planet){
  if (!planet.props || !planet.props.length) return;
  const base = Math.max(0.4, GAME.MINER_MIN_SEP * 0.6);
  for (const prop of planet.props){
    if (prop.dead) continue;
    if (prop.type === "turret_pad") continue;
    planet._spawnReservations.push({ x: prop.x, y: prop.y, r: base });
  }
}

/**
 * @param {Planet} planet
 * @returns {boolean}
 */
function restrictToReachableSpawns(planet){
  const cfg = planet.getPlanetConfig ? planet.getPlanetConfig() : null;
  return !!(cfg && cfg.flags && cfg.flags.disableTerrainDestruction);
}

/**
 * @param {Planet} planet
 * @param {number} ang
 * @param {number} rMin
 * @param {number} rMax
 * @param {number} [steps=64]
 * @returns {{x:number,y:number,r:number}|null}
 */
function findSurfaceAtAngle(planet, ang, rMin, rMax, steps = 64){
  const cx = Math.cos(ang);
  const cy = Math.sin(ang);
  let prevR = rMin;
  let prevAir = planet.airValueAtWorld(cx * prevR, cy * prevR) > 0.5;
  for (let i = 1; i <= steps; i++){
    const r = rMin + (i / steps) * (rMax - rMin);
    const curAir = planet.airValueAtWorld(cx * r, cy * r) > 0.5;
    if (curAir !== prevAir){
      let lo = prevR;
      let hi = r;
      const loAir = prevAir;
      for (let it = 0; it < 8; it++){
        const mid = (lo + hi) * 0.5;
        const midAir = planet.airValueAtWorld(cx * mid, cy * mid) > 0.5;
        if (midAir === loAir){
          lo = mid;
        } else {
          hi = mid;
        }
      }
      const baseR = (lo + hi) * 0.5;
      return { x: cx * baseR, y: cy * baseR, r: baseR };
    }
    prevR = r;
    prevAir = curAir;
  }
  return null;
}

/**
 * @param {number} a
 * @returns {number}
 */
function normalizeAngle(a){
  const tau = Math.PI * 2;
  let out = a % tau;
  if (out < 0) out += tau;
  return out;
}

/**
 * @param {Planet} planet
 * @param {number} ringIndex
 * @param {number} angle
 * @returns {{ring:Array<{x:number,y:number,air:number}>,minusIdx:number,plusIdx:number,minusVertex:{x:number,y:number,air:number},plusVertex:{x:number,y:number,air:number}}|null}
 */
function ringVerticesAroundAngle(planet, ringIndex, angle){
  const rings = planet.radial && planet.radial.rings ? planet.radial.rings : null;
  if (!rings || ringIndex < 0 || ringIndex >= rings.length) return null;
  const ring = rings[ringIndex];
  if (!ring || !ring.length) return null;
  const target = normalizeAngle(angle);
  let plusIdx = 0;
  let plusDiff = Infinity;
  for (let i = 0; i < ring.length; i++){
    const v = ring[i];
    if (!v) continue;
    const ang = normalizeAngle(Math.atan2(v.y, v.x));
    let diff = ang - target;
    if (diff < 0) diff += Math.PI * 2;
    if (diff < plusDiff){
      plusDiff = diff;
      plusIdx = i;
    }
  }
  const minusIdx = (plusIdx - 1 + ring.length) % ring.length;
  const minusVertex = ring[minusIdx];
  const plusVertex = ring[plusIdx];
  if (!minusVertex || !plusVertex) return null;
  return {
    ring,
    minusIdx,
    plusIdx,
    minusVertex,
    plusVertex,
  };
}

/**
 * @param {Planet} planet
 * @returns {Uint8Array}
 */
function buildOuterAirReachableMask(planet){
  const graph = planet.radialGraph;
  const rings = planet.radial && planet.radial.rings ? planet.radial.rings : null;
  if (!graph || !graph.nodes || !graph.neighbors || !graph.nodeOfRef || !rings || !rings.length){
    return new Uint8Array(0);
  }
  const reachable = new Uint8Array(graph.nodes.length);
  /** @type {number[]} */
  const queue = [];
  const outerRing = rings[rings.length - 1] || [];
  for (const vertex of outerRing){
    if (!vertex || vertex.air <= 0.5) continue;
    const idx = graph.nodeOfRef.get(vertex);
    if (idx === undefined || reachable[idx]) continue;
    reachable[idx] = 1;
    queue.push(idx);
  }
  for (let q = 0; q < queue.length; q++){
    const idx = /** @type {number} */ (queue[q]);
    const neigh = graph.neighbors[idx] || [];
    for (const edge of neigh){
      const next = edge.to;
      if (reachable[next]) continue;
      const node = graph.nodes[next];
      if (!node) continue;
      const ring = rings[node.r];
      const vertex = ring && ring[node.i];
      if (!vertex || vertex.air <= 0.5) continue;
      reachable[next] = 1;
      queue.push(next);
    }
  }
  return reachable;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} seed
 * @returns {T[]}
 */
function shuffleDeterministic(items, seed){
  const out = items.slice();
  const rand = mulberry32(seed | 0);
  for (let i = out.length - 1; i > 0; i--){
    const j = Math.floor(rand() * (i + 1));
    const tmp = /** @type {T} */ (out[i]);
    out[i] = /** @type {T} */ (out[j]);
    out[j] = tmp;
  }
  return out;
}

/**
 * @param {number} ring
 * @param {number} seed
 * @returns {number}
 */
function ringShuffleSeed(ring, seed){
  return ((seed | 0) ^ (((ring + 1) * 2654435761) | 0)) | 0;
}

/**
 * @param {Planet} planet
 * @returns {Array<{x:number,y:number,angle:number,r:number,ring:number,depth:number,anchorKind:"outer_rock"|"under_air",sourceKind:"rock"|"air",sourceRing:number,sourceIndex:number}>}
 */
function buildBarrenPadCandidates(planet){
  const graph = planet.radialGraph;
  const rings = planet.radial && planet.radial.rings ? planet.radial.rings : null;
  if (!graph || !graph.nodes || !graph.neighbors || !graph.nodeOfRef || !rings || !rings.length){
    return [];
  }
  const outerRingIndex = rings.length - 1;
  const reachableAir = buildOuterAirReachableMask(planet);
  /** @type {Array<{x:number,y:number,angle:number,r:number,ring:number,depth:number,anchorKind:"outer_rock"|"under_air",sourceKind:"rock"|"air",sourceRing:number,sourceIndex:number}>} */
  const out = [];
  const seen = new Set();
  const outerRing = rings[outerRingIndex] || [];
  for (let i = 0; i < outerRing.length; i++){
    const vertex = outerRing[i];
    if (!vertex || vertex.air > 0.5) continue;
    const key = `outer:${outerRingIndex}:${i}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      x: vertex.x,
      y: vertex.y,
      angle: Math.atan2(vertex.y, vertex.x),
      r: Math.hypot(vertex.x, vertex.y),
      ring: outerRingIndex,
      depth: 0,
      anchorKind: "outer_rock",
      sourceKind: "rock",
      sourceRing: outerRingIndex,
      sourceIndex: i,
    });
  }
  for (let ringIndex = outerRingIndex - 1; ringIndex >= 0; ringIndex--){
    const upperRing = rings[ringIndex + 1] || [];
    for (let airIndex = 0; airIndex < upperRing.length; airIndex++){
      const airVertex = upperRing[airIndex];
      if (!airVertex || airVertex.air <= 0.5) continue;
      const airNode = graph.nodeOfRef.get(airVertex);
      if (airNode === undefined || !reachableAir[airNode]) continue;
      const around = ringVerticesAroundAngle(planet, ringIndex, Math.atan2(airVertex.y, airVertex.x));
      if (!around) continue;
      if (around.minusVertex.air > 0.5 || around.plusVertex.air > 0.5) continue;
      const minusNode = graph.nodeOfRef.get(around.minusVertex);
      const plusNode = graph.nodeOfRef.get(around.plusVertex);
      if (minusNode === undefined || plusNode === undefined) continue;
      let minusLinked = false;
      let plusLinked = false;
      for (const edge of (graph.neighbors[airNode] || [])){
        if (edge.to === minusNode) minusLinked = true;
        if (edge.to === plusNode) plusLinked = true;
        if (minusLinked && plusLinked) break;
      }
      if (!minusLinked || !plusLinked) continue;
      const angle = Math.atan2(airVertex.y, airVertex.x);
      const supportRadius = (Math.hypot(around.minusVertex.x, around.minusVertex.y) + Math.hypot(around.plusVertex.x, around.plusVertex.y)) * 0.5;
      const airRadius = Math.hypot(airVertex.x, airVertex.y);
      const radius = (supportRadius + airRadius) * 0.5;
      const key = `inner:${ringIndex}:${airIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        angle,
        r: radius,
        ring: ringIndex,
        depth: outerRingIndex - ringIndex,
        anchorKind: "under_air",
        sourceKind: "air",
        sourceRing: ringIndex + 1,
        sourceIndex: airIndex,
      });
    }
  }
  return out;
}

/**
 * @param {{x:number,y:number}} candidate
 * @param {Array<{x:number,y:number}>} picked
 * @param {number} minDist
 * @returns {boolean}
 */
function barrenCandidateHasSpacing(candidate, picked, minDist){
  for (const cur of picked){
    const dx = candidate.x - cur.x;
    const dy = candidate.y - cur.y;
    if (dx * dx + dy * dy < minDist * minDist){
      return false;
    }
  }
  return true;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} seed
 * @param {boolean} innerFirst
 * @param {(item:T)=>number} getRing
 * @returns {T[]}
 */
function orderBarrenByRing(items, seed, innerFirst, getRing){
  const groups = new Map();
  for (const item of items){
    const ring = getRing(item);
    const group = groups.get(ring);
    if (group) group.push(item);
    else groups.set(ring, [item]);
  }
  const ringOrder = Array.from(groups.keys()).sort((a, b) => innerFirst ? (a - b) : (b - a));
  /** @type {T[]} */
  const out = [];
  for (const ring of ringOrder){
    out.push(...shuffleDeterministic(groups.get(ring) || [], ringShuffleSeed(ring, seed)));
  }
  return out;
}

/**
 * @param {Array<any>} ordered
 * @param {number} count
 * @param {number} minDist
 * @returns {Array<any>}
 */
function pickBarrenCandidates(ordered, count, minDist){
  if (count <= 0 || !ordered.length) return [];
  /** @type {Array<any>} */
  const picked = [];
  for (const spacing of [Math.max(0, minDist), Math.max(0.18, minDist * 0.55)]){
    for (const candidate of ordered){
      if (picked.length >= count) break;
      if (picked.includes(candidate)) continue;
      if (!barrenCandidateHasSpacing(candidate, picked, spacing)) continue;
      picked.push(candidate);
    }
    if (picked.length >= count) break;
  }
  return picked;
}

/**
 * @param {Planet} planet
 * @param {number} seed
 * @returns {{inner:Array<any>,outer:Array<any>,outerRockByIndex:Map<number, any>,underAirByNode:Map<number, Array<any>>,outerRingIndex:number}|null}
 */
function buildBarrenPadLookup(planet, seed){
  const graph = planet.radialGraph;
  const rings = planet.radial && planet.radial.rings ? planet.radial.rings : null;
  if (!graph || !graph.nodeOfRef || !rings || !rings.length){
    return null;
  }
  const candidates = buildBarrenPadCandidates(planet);
  const outerRingIndex = rings.length - 1;
  const outerRockByIndex = new Map();
  const underAirByNode = new Map();
  for (const candidate of candidates){
    if (candidate.anchorKind === "outer_rock" && candidate.sourceRing === outerRingIndex){
      outerRockByIndex.set(candidate.sourceIndex, candidate);
      continue;
    }
    if (candidate.anchorKind !== "under_air") continue;
    const ring = rings[candidate.sourceRing];
    const vertex = ring && ring[candidate.sourceIndex];
    const nodeIdx = vertex ? graph.nodeOfRef.get(vertex) : undefined;
    if (nodeIdx === undefined) continue;
    const bucket = underAirByNode.get(nodeIdx);
    if (bucket) bucket.push(candidate);
    else underAirByNode.set(nodeIdx, [candidate]);
  }
  return {
    inner: orderBarrenByRing(candidates, seed, true, (item) => item.ring),
    outer: orderBarrenByRing(candidates, seed + 17, false, (item) => item.ring),
    outerRockByIndex,
    underAirByNode,
    outerRingIndex,
  };
}

/**
 * @param {Planet} planet
 * @param {{x:number,y:number,angle:number,r:number,ring:number,depth:number,anchorKind:"outer_rock"|"under_air",sourceKind:"rock"|"air",sourceRing:number,sourceIndex:number}} candidate
 * @param {{underAirByNode:Map<number, Array<any>>,outerRockByIndex:Map<number, any>,outerRingIndex:number}|null} lookup
 * @param {Set<any>} used
 * @param {Array<any>} chosenTurrets
 * @param {number} minDist
 * @returns {any|null}
 */
function findBarrenOverwatchCandidate(planet, candidate, lookup, used, chosenTurrets, minDist){
  const graph = planet.radialGraph;
  const rings = planet.radial && planet.radial.rings ? planet.radial.rings : null;
  if (!lookup || !graph || !graph.nodes || !graph.neighbors || !graph.nodeOfRef || !rings || !rings.length){
    return null;
  }
  const { underAirByNode, outerRockByIndex, outerRingIndex } = lookup;
  /** @param {any} cand */
  const canUseCandidate = (cand) => (
    cand
    && cand !== candidate
    && !used.has(cand)
    && barrenCandidateHasSpacing(cand, chosenTurrets, minDist)
  );
  /** @param {number} baseIndex */
  const searchOuterRing = (baseIndex) => {
    const outerRing = rings[outerRingIndex] || [];
    const n = outerRing.length;
    if (!n || !Number.isFinite(baseIndex)) return null;
    for (let off = 1; off < n; off++){
      const left = ((baseIndex - off) % n + n) % n;
      const right = (baseIndex + off) % n;
      for (const idx of [left, right]){
        const cand = outerRockByIndex.get(idx);
        if (!canUseCandidate(cand)) continue;
        return cand;
      }
    }
    return null;
  };
  /** @param {number} nodeIdx */
  const isAirNode = (nodeIdx) => {
    const node = graph.nodes[nodeIdx];
    if (!node) return false;
    const ring = rings[node.r];
    const vertex = ring && ring[node.i];
    return !!(vertex && vertex.air > 0.5);
  };
  if (candidate.anchorKind === "outer_rock"){
    return searchOuterRing(candidate.sourceIndex);
  }
  if (candidate.sourceKind !== "air"){
    return null;
  }
  const sourceRing = rings[candidate.sourceRing] || null;
  const sourceVertex = sourceRing && sourceRing[candidate.sourceIndex];
  const startNode = sourceVertex ? graph.nodeOfRef.get(sourceVertex) : undefined;
  if (startNode === undefined) return null;
  const start = graph.nodes[startNode];
  if (!start) return null;
  const visited = new Set([startNode]);
  /** @type {number[]} */
  let frontier = [startNode];
  for (let nextRing = start.r + 1; nextRing <= outerRingIndex; nextRing++){
    /** @type {number[]} */
    const ringAir = [];
    /** @type {number[]} */
    const queue = [];
    for (const nodeIdx of frontier){
      const neigh = graph.neighbors[nodeIdx] || [];
      for (const edge of neigh){
        const nextIdx = edge.to;
        if (visited.has(nextIdx)) continue;
        const nextNode = graph.nodes[nextIdx];
        if (!nextNode || nextNode.r !== nextRing || !isAirNode(nextIdx)) continue;
        visited.add(nextIdx);
        queue.push(nextIdx);
      }
    }
    for (let qi = 0; qi < queue.length; qi++){
      const nodeIdx = /** @type {number} */ (queue[qi]);
      ringAir.push(nodeIdx);
      const neigh = graph.neighbors[nodeIdx] || [];
      for (const edge of neigh){
        const nextIdx = edge.to;
        if (visited.has(nextIdx)) continue;
        const nextNode = graph.nodes[nextIdx];
        if (!nextNode || nextNode.r !== nextRing || !isAirNode(nextIdx)) continue;
        visited.add(nextIdx);
        queue.push(nextIdx);
      }
    }
    if (!ringAir.length) return null;
    if (nextRing < outerRingIndex){
      for (const nodeIdx of ringAir){
        for (const cand of (underAirByNode.get(nodeIdx) || [])){
          if (cand.ring <= candidate.ring) continue;
          if (!canUseCandidate(cand)) continue;
          return cand;
        }
      }
      frontier = ringAir;
      continue;
    }
    for (const nodeIdx of ringAir){
      const node = graph.nodes[nodeIdx];
      if (!node) continue;
      const overwatch = searchOuterRing(node.i);
      if (overwatch) return overwatch;
    }
    return null;
  }
  return null;
}

/**
 * @param {Planet} planet
 * @param {{x:number,y:number,angle:number,r:number,ring:number,depth:number,anchorKind:"outer_rock"|"under_air",sourceKind:"rock"|"air",sourceRing:number,sourceIndex:number}} candidate
 * @param {any} prop
 * @param {"miner"|"turret"|null} reservedFor
 * @returns {void}
 */
function applyBarrenPadCandidateToProp(planet, candidate, prop, reservedFor){
  prop.dead = false;
  prop.x = candidate.x;
  prop.y = candidate.y;
  prop.padRing = candidate.ring;
  prop.padDepth = candidate.depth;
  prop.padAnchorKind = candidate.anchorKind;
  prop.padSourceKind = candidate.sourceKind;
  prop.padSourceRing = candidate.sourceRing;
  prop.padSourceIndex = candidate.sourceIndex;
  prop.padReservedFor = reservedFor;
  const up = planet._upDirAt(prop.x, prop.y);
  if (up){
    prop.padNx = up.ux;
    prop.padNy = up.uy;
    return;
  }
  const normal = planet.normalAtWorld(prop.x, prop.y);
  if (normal){
    prop.padNx = normal.nx;
    prop.padNy = normal.ny;
  }
}

