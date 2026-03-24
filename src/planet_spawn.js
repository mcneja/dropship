// @ts-check

import { GAME } from "./config.js";
import { mulberry32 } from "./rng.js";
import { collectSupportNodeIndices, setSupportAnchor, setSupportNodeIndices } from "./terrain_support.js";

/** @typedef {import("./planet.js").Planet} Planet */
/** @typedef {import("./types.d.js").StandablePoint} StandablePoint */

/**
 * @template T
 * @param {T|null|undefined} value
 * @returns {T}
 */
function expectDefined(value){
  if (value == null){
    throw new Error("Expected value to be defined");
  }
  return value;
}

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
    const tmp = expectDefined(candidates[i]);
    candidates[i] = expectDefined(candidates[j]);
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
    planet._standablePoints = planet._buildStandablePoints();
  }
  const seed = (planet.getSeed() | 0) + 913;
  const minDist = GAME.MINER_MIN_SEP;
  /** @type {Array<any>} */
  let placed = [];
  if (forceHorizontalPads){
    const lookup = planet._buildBarrenPadLookup(seed);
    placed = lookup ? planet._pickBarrenCandidates(lookup.inner, pads.length, minDist) : [];
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
      placed = planet.sampleStandablePoints(pads.length, seed, "uniform", minDist, false)
        .map((pt) => ({ x: pt[0], y: pt[1] }));
      planet._standablePoints = saved;
    } else {
      placed = planet.sampleStandablePoints(pads.length, seed, "uniform", minDist, false)
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
          : planet._findStandableSupportNodeIndex(p.x, p.y),
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
      setSupportNodeIndices(p, [], planet._findStandableSupportNodeIndex(p.x, p.y));
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
  const standable = planet.getStandablePoints()
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
    if (typeof planet.reserveBarrenPadsForMiners === "function"){
      planet.reserveBarrenPadsForMiners(count, seed, minDist);
    }
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

  const standable = planet.getStandablePoints();
  const protectedR = (planet && typeof planet.getProtectedTerrainRadius === "function")
    ? planet.getProtectedTerrainRadius()
    : 0;
  const params = planet.getPlanetParams ? planet.getPlanetParams() : null;
  const moltenOuter = (params && typeof params.MOLTEN_RING_OUTER === "number")
    ? params.MOLTEN_RING_OUTER
    : 0;
  const minR = Math.max(0, Math.max(protectedR, moltenOuter) + 0.6);
  placements = planet.sampleStandablePoints(count, seed, "uniform", minDist, true, minR)
    .map((pt) => buildMinerSpawnPlacement(planet, Number(pt[0]), Number(pt[1])));
  if (placements.length < count){
    const extra = pickFallbackMinerSpawnPoints(planet, count - placements.length, seed + 17, minDist, minR, placements);
    if (extra.length){
      placements.push(...extra);
    }
  }
  const availability = planet.debugAvailableStandableCount
    ? planet.debugAvailableStandableCount(minDist)
    : { standable: standable.length, available: standable.length, reservations: 0 };
  const propCounts = planet.debugPropCounts ? planet.debugPropCounts() : null;
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
  const points = planet.sampleLandablePoints(vents.length, seed, 0.30, 0.2, "random");
  if (!points.length) return;
  for (let i = 0; i < vents.length; i++){
    const p = vents[i];
    const pt = points[i % points.length];
    if (!p || !pt) continue;
    p.x = pt[0];
    p.y = pt[1];
    setSupportAnchor(p, pt[0], pt[1]);
    setSupportNodeIndices(p, [], planet._findStandableSupportNodeIndex(pt[0], pt[1]));
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
      : planet._buildStandablePoints();
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
      const tmp = expectDefined(shuffled[i]);
      shuffled[i] = expectDefined(shuffled[j]);
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
    const points = planet.sampleUndergroundPoints(mush.length, seed, "random");
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
    planet._standablePoints = planet._buildStandablePoints();
  }
  const seed = (planet.getSeed() | 0) + ((cfg.id === "no_caves") ? 1207 : 1239);
  const placement = (cfg.id === "no_caves") ? "uniform" : "random";
  const minDist = (cfg.id === "no_caves") ? 0.5 : 0.4;
  const points = planet.sampleStandablePoints(debris.length, seed, placement, minDist, false);
  for (let i = 0; i < debris.length; i++){
    const p = debris[i];
    const pt = points[i];
    if (!p) continue;
    if (!pt){
      p.dead = true;
      continue;
    }
    setSupportAnchor(p, pt[0], pt[1]);
    setSupportNodeIndices(p, [], planet._findStandableSupportNodeIndex(pt[0], pt[1]));
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
    planet._standablePoints = planet._buildStandablePoints();
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
    const standable = planet._filterReachableStandable(planet.getStandablePoints())
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

  const factoryPts = planet.sampleStandablePoints(factories.length, seed, "uniform", 1.5, false);
  for (let i = 0; i < factories.length; i++){
    const p = factories[i];
    if (!p) continue;
    const pt = factoryPts[i];
    if (!pt){
      p.dead = true;
      continue;
    }
    setSupportAnchor(p, pt[0], pt[1]);
    setSupportNodeIndices(p, [], planet._findStandableSupportNodeIndex(pt[0], pt[1]));
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

  const gatePts = planet.sampleStandablePoints(gates.length, seed + 97, "clusters", 2.0, false);
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
