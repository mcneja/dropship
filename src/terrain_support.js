// @ts-check

import { buildPassableMask } from "./navigation.js";

/** @typedef {import("./planet.js").Planet} Planet */
/** @typedef {import("./types.d.js").StandablePoint} StandablePoint */

/**
 * @typedef {{supportX?:number,supportY?:number,supportNodeIndex?:number,supportNodeIndices?:number[]}} TerrainSupportOwner
 */

/**
 * @param {Array<{x:number,y:number}|undefined|null>|null|undefined} nodes
 * @param {Uint8Array|null|undefined} airBitmap
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} [preferredIndex=-1]
 * @param {number} [maxCount=8]
 * @returns {number[]}
 */
export function collectSupportNodeIndices(nodes, airBitmap, x, y, radius, preferredIndex = -1, maxCount = 8){
  if (!nodes || !airBitmap || airBitmap.length !== nodes.length) return [];
  const radiusSq = Math.max(0.02, radius) * Math.max(0.02, radius);
  /** @type {Array<{idx:number,d2:number}>} */
  const hits = [];
  for (let i = 0; i < nodes.length; i++){
    if (airBitmap[i]) continue;
    const node = nodes[i];
    if (!node) continue;
    const dx = node.x - x;
    const dy = node.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > radiusSq) continue;
    hits.push({ idx: i, d2 });
  }
  hits.sort((a, b) => a.d2 - b.d2);
  /** @type {number[]} */
  const out = [];
  const seen = new Set();
  /** @param {number} idx */
  const addIndex = (idx) => {
    if (!Number.isFinite(idx) || idx < 0 || idx >= nodes.length) return;
    if (airBitmap[idx] || seen.has(idx)) return;
    seen.add(idx);
    out.push(idx);
  };
  addIndex(preferredIndex);
  for (const hit of hits){
    addIndex(hit.idx);
    if (out.length >= Math.max(1, maxCount | 0)) break;
  }
  return out;
}

/**
 * @param {TerrainSupportOwner|null|undefined} owner
 * @returns {number[]}
 */
export function getSupportNodeIndices(owner){
  if (!owner) return [];
  if (Array.isArray(owner.supportNodeIndices) && owner.supportNodeIndices.length){
    return owner.supportNodeIndices
      .filter((idx) => Number.isFinite(idx))
      .map((idx) => Number(idx));
  }
  return Number.isFinite(owner.supportNodeIndex) ? [Number(owner.supportNodeIndex)] : [];
}

/**
 * @param {TerrainSupportOwner|null|undefined} owner
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
export function setSupportAnchor(owner, x, y){
  if (!owner) return;
  owner.supportX = Number(x);
  owner.supportY = Number(y);
}

/**
 * @param {TerrainSupportOwner|null|undefined} owner
 * @returns {void}
 */
export function clearTerrainSupport(owner){
  if (!owner) return;
  delete owner.supportX;
  delete owner.supportY;
  delete owner.supportNodeIndex;
  delete owner.supportNodeIndices;
}

/**
 * @param {TerrainSupportOwner|null|undefined} owner
 * @param {number[]|null|undefined} indices
 * @param {number} [preferredIndex=-1]
 * @returns {boolean}
 */
export function setSupportNodeIndices(owner, indices, preferredIndex = -1){
  if (!owner) return false;
  const normalized = Array.isArray(indices)
    ? indices.filter((idx) => Number.isFinite(idx)).map((idx) => Number(idx))
    : [];
  if (normalized.length){
    owner.supportNodeIndices = normalized;
    owner.supportNodeIndex = /** @type {number} */ (normalized[0]);
    return true;
  }
  delete owner.supportNodeIndices;
  if (Number.isFinite(preferredIndex) && preferredIndex >= 0){
    owner.supportNodeIndex = Number(preferredIndex);
    return true;
  }
  delete owner.supportNodeIndex;
  return false;
}

/**
 * Precompute a dense set of standable surface points based on mesh vertices.
 * @param {Planet} planet
 * @returns {StandablePoint[]}
 */
export function buildStandablePoints(planet){
  const maxSlope = 0.28;
  const clearance = 0.2;
  const eps = 0.18;
  const sideClearance = 0.25;
  const graph = planet.radialGraph;
  /** @type {StandablePoint[]} */
  const points = [];
  if (!graph || !graph.nodes || !graph.nodes.length) return points;
  const passable = buildPassableMask(planet.radial, graph, 0.5);
  for (let i = 0; i < graph.nodes.length; i++){
    if (!passable[i]) continue;
    const n = graph.nodes[i];
    if (!n) continue;
    let inner = -1;
    let innerR = -1;
    const neigh = graph.neighbors[i] || [];
    for (const edge of neigh){
      const nb = graph.nodes[edge.to];
      if (!nb || nb.r >= n.r) continue;
      if (passable[edge.to]) continue;
      if (nb.r > innerR){
        innerR = nb.r;
        inner = edge.to;
      }
    }
    if (inner < 0) continue;
    const nb = graph.nodes[inner];
    if (!nb) continue;
    const aOuter = planet.radial.airValueAtWorld(n.x, n.y);
    const aInner = planet.radial.airValueAtWorld(nb.x, nb.y);
    const denom = (aOuter - aInner);
    const t = denom !== 0 ? Math.max(0, Math.min(1, (0.5 - aInner) / denom)) : 0.5;
    const sx = nb.x + (n.x - nb.x) * t;
    const sy = nb.y + (n.y - nb.y) * t;
    const normal = planet._upAlignedNormalAtWorld(sx, sy);
    if (!normal) continue;
    const px = sx + normal.nx * 0.02;
    const py = sy + normal.ny * 0.02;
    if (!planet.isStandableAtWorld(px, py, maxSlope, clearance, eps, sideClearance)) continue;
    const ang = Math.atan2(py, px);
    const r = Math.hypot(px, py);
    points.push([px, py, ang, r, inner]);
  }
  return points;
}

/**
 * Cached standable points. Do not mutate.
 * @param {Planet} planet
 * @returns {StandablePoint[]}
 */
export function getStandablePoints(planet){
  return planet._standablePoints || [];
}

/**
 * @param {Planet} planet
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function findStandableSupportNodeIndex(planet, x, y){
  const points = getStandablePoints(planet);
  let bestIdx = -1;
  let bestD2 = Infinity;
  for (const p of points){
    if (!p) continue;
    const dx = p[0] - x;
    const dy = p[1] - y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= bestD2) continue;
    bestD2 = d2;
    bestIdx = Number.isFinite(p[4]) ? Number(p[4]) : -1;
    if (d2 <= 1e-10 && bestIdx >= 0) break;
  }
  return bestIdx;
}

/**
 * @param {{type:string,scale?:number}|null|undefined} prop
 * @returns {number}
 */
export function terrainPropSupportRadius(prop){
  const scale = Math.max(0.2, prop && prop.scale ? prop.scale : 1);
  if (!prop) return 0.28;
  if (prop.type === "tree") return Math.max(0.24, 0.18 + scale * 0.16);
  if (prop.type === "boulder") return Math.max(0.26, 0.18 + scale * 0.22);
  if (prop.type === "ridge_spike") return Math.max(0.24, 0.16 + scale * 0.18);
  if (prop.type === "stalactite") return Math.max(0.22, 0.15 + scale * 0.16);
  if (prop.type === "ice_shard") return Math.max(0.18, 0.12 + scale * 0.14);
  if (prop.type === "factory") return Math.max(0.22, 0.16 + scale * 0.18);
  if (prop.type === "vent") return Math.max(0.18, 0.12 + scale * 0.12);
  if (prop.type === "mushroom") return Math.max(0.16, 0.10 + scale * 0.12);
  if (prop.type === "bubble_hex") return Math.max(0.10, 0.08 + scale * 0.10);
  if (prop.type === "turret_pad") return Math.max(0.24, 0.18 + scale * 0.14);
  return 0.28;
}

/**
 * @param {{type?:string}|null|undefined} prop
 * @returns {boolean}
 */
export function propTracksTerrainSupport(prop){
  if (!prop) return false;
  return prop.type === "tree"
    || prop.type === "boulder"
    || prop.type === "ridge_spike"
    || prop.type === "stalactite"
    || prop.type === "ice_shard"
    || prop.type === "factory"
    || prop.type === "vent"
    || prop.type === "mushroom"
    || prop.type === "bubble_hex"
    || prop.type === "turret_pad";
}

/**
 * @param {{type?:string}|null|undefined} prop
 * @returns {boolean}
 */
export function propDetachesWithTerrain(prop){
  if (!propTracksTerrainSupport(prop)) return false;
  return !!(prop && prop.type !== "bubble_hex");
}

/**
 * @param {Planet} planet
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {number} [preferredIndex=-1]
 * @returns {number[]}
 */
export function collectRockSupportNodeIndices(planet, x, y, radius, preferredIndex = -1){
  const graph = planet.radialGraph;
  const nodes = graph && graph.nodes ? graph.nodes : null;
  return collectSupportNodeIndices(nodes, planet.airNodesBitmap, x, y, radius, preferredIndex, 8);
}

/**
 * Rebuild support-node footprints for terrain-attached props after placement.
 * @param {Planet} planet
 * @returns {void}
 */
export function refreshTerrainPropSupportNodes(planet){
  if (!planet.props || !planet.props.length) return;
  for (const prop of planet.props){
    if (!prop || prop.dead) continue;
    if (!propTracksTerrainSupport(prop)) continue;
    const anchorX = Number.isFinite(prop.supportX) ? Number(prop.supportX) : prop.x;
    const anchorY = Number.isFinite(prop.supportY) ? Number(prop.supportY) : prop.y;
    const supportIndices = collectRockSupportNodeIndices(
      planet,
      anchorX,
      anchorY,
      terrainPropSupportRadius(prop),
      Number.isFinite(prop.supportNodeIndex) ? Number(prop.supportNodeIndex) : -1,
    );
    if (!supportIndices.length) continue;
    setSupportNodeIndices(prop, supportIndices, Number.isFinite(prop.supportNodeIndex) ? Number(prop.supportNodeIndex) : -1);
  }
}

