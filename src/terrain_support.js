// @ts-check

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
    owner.supportNodeIndex = normalized[0];
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
