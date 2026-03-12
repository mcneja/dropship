// @ts-check

import { GAME } from "./config.js";

/**
 * @typedef {{x:number,y:number,air:number}} MeshVertex
 * @typedef {{x:number,y:number}} Point
 * @typedef {{a:number,b:number,len:number,slope:number,dotUp:number,rMid:number}} GuideSegment
 * @typedef {{threshold:number,nodes:Array<Point>,neighbors:Array<Array<{to:number,len:number,seg:number}>>,segments:Array<GuideSegment>}} GuideContour
 */

/** @type {WeakMap<object, Map<number, GuideContour>>} */
const contourCache = new WeakMap();

/**
 * @param {any} mesh
 * @returns {Map<number, GuideContour>}
 */
function meshCache(mesh){
  let map = contourCache.get(mesh);
  if (!map){
    map = new Map();
    contourCache.set(mesh, map);
  }
  return map;
}

/**
 * @param {any} mesh
 * @returns {void}
 */
export function invalidateSurfaceGuidePathCache(mesh){
  contourCache.delete(mesh);
}

/**
 * @param {any} mesh
 * @param {MeshVertex} a
 * @param {MeshVertex} b
 * @returns {string}
 */
function edgeKeyFromVerts(mesh, a, b){
  if (mesh && typeof mesh._edgeKeyFromVerts === "function"){
    return mesh._edgeKeyFromVerts(a, b);
  }
  const ax = Math.round(a.x * 1000);
  const ay = Math.round(a.y * 1000);
  const bx = Math.round(b.x * 1000);
  const by = Math.round(b.y * 1000);
  if (ax < bx || (ax === bx && ay <= by)){
    return `${ax},${ay}|${bx},${by}`;
  }
  return `${bx},${by}|${ax},${ay}`;
}

/**
 * @param {Array<Point>} path
 * @param {number} qx
 * @param {number} qy
 * @returns {number|null}
 */
export function closestPathIndex(path, qx, qy){
  if (!path || path.length < 2) return null;
  let bestD2 = Infinity;
  let bestIndex = null;
  for (let i = 1; i < path.length; i++){
    const p0 = path[i - 1];
    const p1 = path[i];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const den = dx * dx + dy * dy;
    if (den < 1e-10) continue;
    let u = ((qx - p0.x) * dx + (qy - p0.y) * dy) / den;
    u = Math.max(0, Math.min(1, u));
    const cx = p0.x + dx * u;
    const cy = p0.y + dy * u;
    const ddx = qx - cx;
    const ddy = qy - cy;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < bestD2){
      bestD2 = d2;
      bestIndex = (i - 1) + u;
    }
  }
  return bestIndex;
}

/**
 * Build contour graph from exact triangle-edge crossings at a threshold.
 * @param {any} mesh
 * @param {number} [threshold]
 * @returns {GuideContour}
 */
export function ensureSurfaceGuideContour(mesh, threshold = 0.5){
  const cache = meshCache(mesh);
  const cached = cache.get(threshold);
  if (cached) return cached;

  /** @type {Array<Point>} */
  const nodes = [];
  /** @type {Array<Array<{to:number,len:number,seg:number}>>} */
  const neighbors = [];
  /** @type {Array<GuideSegment>} */
  const segments = [];
  const nodeOfEdge = new Map();
  const nodeOfPoint = new Map();
  const segmentKeys = new Set();

  const pointKey = (x, y) => `${Math.round(x * 1000)}:${Math.round(y * 1000)}`;

  /**
   * @param {number} x
   * @param {number} y
   * @param {string} [key]
   * @returns {number}
   */
  const getOrCreateNode = (x, y, key) => {
    const k = key || pointKey(x, y);
    const existing = nodeOfPoint.get(k);
    if (existing !== undefined) return existing;
    const idx = nodes.length;
    nodes.push({ x, y });
    neighbors.push([]);
    nodeOfPoint.set(k, idx);
    return idx;
  };

  /**
   * @param {MeshVertex} v
   * @returns {number}
   */
  const getVertexNode = (v) => {
    const vid = mesh && mesh._vertIdOf ? mesh._vertIdOf.get(v) : undefined;
    const key = (vid !== undefined) ? `v:${vid}` : pointKey(v.x, v.y);
    return getOrCreateNode(v.x, v.y, key);
  };

  /**
   * @param {MeshVertex} a
   * @param {MeshVertex} b
   * @returns {number}
   */
  const getCrossNode = (a, b) => {
    const eKey = edgeKeyFromVerts(mesh, a, b);
    let nodeIdx = nodeOfEdge.get(eKey);
    if (nodeIdx !== undefined) return nodeIdx;
    const denom = b.air - a.air;
    const t = (Math.abs(denom) > 1e-8)
      ? Math.max(0, Math.min(1, (threshold - a.air) / denom))
      : 0.5;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    nodeIdx = getOrCreateNode(x, y, `e:${eKey}`);
    nodeOfEdge.set(eKey, nodeIdx);
    return nodeIdx;
  };

  /**
   * @param {number} ia
   * @param {number} ib
   * @returns {void}
   */
  const addSegment = (ia, ib) => {
    if (ia === ib) return;
    const segKey = (ia < ib) ? `${ia}:${ib}` : `${ib}:${ia}`;
    if (segmentKeys.has(segKey)) return;
    const pa = nodes[ia];
    const pb = nodes[ib];
    if (!pa || !pb) return;
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    if (!(len > 1e-6)) return;
    const tx = (pb.x - pa.x) / len;
    const ty = (pb.y - pa.y) / len;
    const mx = (pa.x + pb.x) * 0.5;
    const my = (pa.y + pb.y) * 0.5;
    const rMid = Math.hypot(mx, my) || 1;
    const ux = mx / rMid;
    const uy = my / rMid;
    const n0x = -ty;
    const n0y = tx;
    const n1x = ty;
    const n1y = -tx;

    const probe = 0.08;
    const a0 = mesh.airValueAtWorld(mx + n0x * probe, my + n0y * probe);
    const b0 = mesh.airValueAtWorld(mx - n0x * probe, my - n0y * probe);
    const a1 = mesh.airValueAtWorld(mx + n1x * probe, my + n1y * probe);
    const b1 = mesh.airValueAtWorld(mx - n1x * probe, my - n1y * probe);
    const o0 = a0 - b0;
    const o1 = a1 - b1;
    let nx = n0x;
    let ny = n0y;
    if (o1 > o0){
      nx = n1x;
      ny = n1y;
    }
    const dotUp = nx * ux + ny * uy;
    const slope = 1 - dotUp;

    segmentKeys.add(segKey);
    const iSeg = segments.length;
    segments.push({ a: ia, b: ib, len, slope, dotUp, rMid });
    neighbors[ia].push({ to: ib, len, seg: iSeg });
    neighbors[ib].push({ to: ia, len, seg: iSeg });
  };

  const triList = mesh._triList || [];
  for (const tri of triList){
    if (!tri || tri.length < 3) continue;
    const crossed = [];
    const edges = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
    for (const edge of edges){
      const a = edge[0];
      const b = edge[1];
      const aboveA = a.air > threshold;
      const aboveB = b.air > threshold;
      if (aboveA === aboveB) continue;
      crossed.push(getCrossNode(a, b));
    }
    if (crossed.length !== 2) continue;
    addSegment(crossed[0], crossed[1]);
  }

  const outer = mesh.rings && mesh.rings.length ? mesh.rings[mesh.rings.length - 1] : null;
  if (outer && outer.length > 1){
    for (let i = 0; i < outer.length; i++){
      const v0 = outer[i];
      const v1 = outer[(i + 1) % outer.length];
      const rock0 = v0.air <= threshold;
      const rock1 = v1.air <= threshold;
      if (!rock0 && !rock1) continue;
      if (rock0 && rock1){
        addSegment(getVertexNode(v0), getVertexNode(v1));
        continue;
      }
      if (rock0){
        addSegment(getVertexNode(v0), getCrossNode(v0, v1));
      } else {
        addSegment(getCrossNode(v0, v1), getVertexNode(v1));
      }
    }
  }

  const contour = { threshold, nodes, neighbors, segments };
  cache.set(threshold, contour);
  return contour;
}

/**
 * Build miner guide path directly from barycentric contour segments.
 * @param {any} mesh
 * @param {number} x
 * @param {number} y
 * @param {number} maxDistance
 * @returns {{path:Array<Point>, indexClosest:number}|null}
 */
export function buildSurfaceGuidePath(mesh, x, y, maxDistance){
  const contour = ensureSurfaceGuideContour(mesh, 0.5);
  const nodes = contour.nodes;
  const segments = contour.segments;
  const neighbors = contour.neighbors;
  if (!nodes.length || !segments.length) return null;

  const maxSlope = Math.max(0.08, Math.min(0.6, Number.isFinite(GAME.MINER_WALK_MAX_SLOPE) ? GAME.MINER_WALK_MAX_SLOPE : 0.35));
  const minDotUp = Math.max(0.2, 1 - maxSlope);
  const rAnchor = Math.hypot(x, y);
  const radialBias = 2.5;
  const preferOuter = rAnchor >= (mesh._R_MESH - 1.8);

  /**
   * @param {number} outerSlack
   * @returns {Uint8Array}
   */
  const buildSegAllowed = (outerSlack) => {
    const out = new Uint8Array(segments.length);
    const outerBandInner = rAnchor - outerSlack;
    for (let i = 0; i < segments.length; i++){
      const s = segments[i];
      if (!(s.dotUp >= minDotUp && s.slope <= maxSlope)){
        out[i] = 0;
        continue;
      }
      if (preferOuter && s.rMid < outerBandInner){
        out[i] = 0;
        continue;
      }
      out[i] = 1;
    }
    return out;
  };

  /**
   * @param {Uint8Array} mask
   * @returns {{seg:number,x:number,y:number,d:number}|null}
   */
  const pickBestSegment = (mask) => {
    let seg = -1;
    let scoreBest = Infinity;
    let pxBest = 0;
    let pyBest = 0;
    let dBest = Infinity;
    for (let i = 0; i < segments.length; i++){
      if (!mask[i]) continue;
      const s = segments[i];
      const a = nodes[s.a];
      const b = nodes[s.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const den = dx * dx + dy * dy;
      if (den < 1e-10) continue;
      let u = ((x - a.x) * dx + (y - a.y) * dy) / den;
      u = Math.max(0, Math.min(1, u));
      const px = a.x + dx * u;
      const py = a.y + dy * u;
      const ddx = x - px;
      const ddy = y - py;
      const d2 = ddx * ddx + ddy * ddy;
      const rDiff = s.rMid - rAnchor;
      const score = d2 + radialBias * (rDiff * rDiff);
      if (score < scoreBest){
        scoreBest = score;
        seg = i;
        pxBest = px;
        pyBest = py;
        dBest = Math.hypot(ddx, ddy);
      }
    }
    if (seg < 0) return null;
    return { seg, x: pxBest, y: pyBest, d: dBest };
  };

  let segAllowed = buildSegAllowed(0.55);
  let pick = pickBestSegment(segAllowed);
  if (!pick && preferOuter){
    segAllowed = buildSegAllowed(1.35);
    pick = pickBestSegment(segAllowed);
  }
  if (!pick && preferOuter){
    segAllowed = buildSegAllowed(2.2);
    pick = pickBestSegment(segAllowed);
  }
  if (!pick) return null;

  const bestSeg = pick.seg;
  const bestX = pick.x;
  const bestY = pick.y;
  const dAnchor = pick.d;
  if (Number.isFinite(maxDistance) && maxDistance > 0 && dAnchor > maxDistance){
    return null;
  }

  const start = segments[bestSeg];
  const maxLen = Math.max(0.15, Number.isFinite(maxDistance) ? maxDistance : 4.0);

  /**
   * @param {number} nodeIdx
   * @param {number} prevIdx
   * @param {number} fromX
   * @param {number} fromY
   * @returns {number}
   */
  const pickNextNode = (nodeIdx, prevIdx, fromX, fromY) => {
    const list = neighbors[nodeIdx];
    if (!list || !list.length) return -1;
    const node = nodes[nodeIdx];
    const inDx = node.x - fromX;
    const inDy = node.y - fromY;
    const inLen = Math.hypot(inDx, inDy);
    let best = -1;
    let bestScore = -Infinity;
    for (const e of list){
      if (e.to === prevIdx) continue;
      if (!segAllowed[e.seg]) continue;
      const n = nodes[e.to];
      const outDx = n.x - node.x;
      const outDy = n.y - node.y;
      const outLen = Math.hypot(outDx, outDy);
      if (outLen < 1e-8) continue;
      let score = 0;
      if (inLen > 1e-8){
        score = (inDx / inLen) * (outDx / outLen) + (inDy / inLen) * (outDy / outLen);
      }
      if (score > bestScore){
        bestScore = score;
        best = e.to;
      }
    }
    return best;
  };

  /**
   * @param {number} firstNode
   * @param {number} prevNode
   * @param {number} limit
   * @returns {Array<Point>}
   */
  const walk = (firstNode, prevNode, limit) => {
    /** @type {Array<Point>} */
    const out = [{ x: bestX, y: bestY }];
    let remaining = Math.max(0, limit);
    let fromX = bestX;
    let fromY = bestY;
    let nodeIdx = firstNode;
    let prevIdx = prevNode;

    while (remaining > 1e-6){
      const node = nodes[nodeIdx];
      const dx = node.x - fromX;
      const dy = node.y - fromY;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-8){
        if (dist > remaining){
          const t = remaining / dist;
          out.push({ x: fromX + dx * t, y: fromY + dy * t });
          break;
        }
        out.push({ x: node.x, y: node.y });
        remaining -= dist;
      }
      const next = pickNextNode(nodeIdx, prevIdx, fromX, fromY);
      if (next < 0) break;
      prevIdx = nodeIdx;
      fromX = node.x;
      fromY = node.y;
      nodeIdx = next;
    }
    return out;
  };

  const walkA = walk(start.a, start.b, maxLen);
  const walkB = walk(start.b, start.a, maxLen);
  const pathRaw = walkA.slice().reverse().concat(walkB.slice(1));
  if (pathRaw.length < 2) return null;

  /** @type {Array<Point>} */
  const path = [];
  const pushUnique = (p) => {
    const last = path.length ? path[path.length - 1] : null;
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-4){
      path.push({ x: p.x, y: p.y });
    }
  };
  for (const p of pathRaw) pushUnique(p);
  if (path.length < 2) return null;

  const idx = closestPathIndex(path, x, y);
  const indexClosest = (idx !== null) ? idx : Math.max(0, Math.min(path.length - 1, path.length * 0.5));
  return { path, indexClosest };
}

/**
 * Continuous closest-point path index constrained to a max distance.
 * @param {Array<Point>} path
 * @param {number} distMax
 * @param {number} x
 * @param {number} y
 * @param {number|null} [rHint]
 * @param {number} [rTol]
 * @returns {number|null}
 */
export function indexPathFromPos(path, distMax, x, y, rHint = null, rTol = Infinity){
  if (!path || path.length < 2) return null;
  const distMaxSqr = distMax * distMax;
  let distClosestSqr = Infinity;
  let indexPath = null;
  for (let i = 1; i < path.length; ++i){
    const pos0 = path[i - 1];
    const pos1 = path[i];
    if (rHint !== null && Number.isFinite(rHint) && Number.isFinite(rTol)){
      const r0 = Math.hypot(pos0.x, pos0.y);
      const r1 = Math.hypot(pos1.x, pos1.y);
      const rMin = Math.min(r0, r1) - rTol;
      const rMax = Math.max(r0, r1) + rTol;
      if (rHint < rMin || rHint > rMax) continue;
    }
    const dSegX = pos1.x - pos0.x;
    const dSegY = pos1.y - pos0.y;
    const dSeg2 = dSegX * dSegX + dSegY * dSegY;
    if (dSeg2 < 1e-10) continue;
    const dPosX = x - pos0.x;
    const dPosY = y - pos0.y;
    let u = (dSegX * dPosX + dSegY * dPosY) / dSeg2;
    u = Math.max(0, Math.min(1, u));
    const dPosClosestX = dSegX * u - dPosX;
    const dPosClosestY = dSegY * u - dPosY;
    const distSqr = dPosClosestX * dPosClosestX + dPosClosestY * dPosClosestY;
    if (distSqr > distMaxSqr) continue;
    if (distSqr < distClosestSqr){
      distClosestSqr = distSqr;
      indexPath = (i - 1) + u;
    }
  }
  return indexPath;
}

/**
 * Interpolate world position from a continuous path index.
 * @param {Array<Point>} path
 * @param {number} indexPath
 * @returns {Point}
 */
export function posFromPathIndex(path, indexPath){
  if (!path || path.length === 0){
    return { x: 0, y: 0 };
  }
  if (path.length === 1){
    return { x: path[0].x, y: path[0].y };
  }
  indexPath = Math.max(0, Math.min(path.length - 1, indexPath));
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;
  if (iSeg === path.length - 1){
    iSeg -= 1;
    uSeg += 1;
  }
  const x0 = path[iSeg].x;
  const y0 = path[iSeg].y;
  const x1 = path[iSeg + 1].x;
  const y1 = path[iSeg + 1].y;
  return {
    x: x0 + (x1 - x0) * uSeg,
    y: y0 + (y1 - y0) * uSeg,
  };
}

/**
 * Move forward (increasing index) along a path by distance up to indexPathMax.
 * @param {Array<Point>} path
 * @param {number} indexPath
 * @param {number} distRemaining
 * @param {number} indexPathMax
 * @returns {number}
 */
export function moveAlongPathPositive(path, indexPath, distRemaining, indexPathMax){
  if (!(distRemaining > 0)) return indexPath;
  if (!(indexPath < indexPathMax)) return indexPathMax;
  const iSegMax = Math.floor(indexPathMax);
  const uSegMax = indexPathMax - iSegMax;
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;

  while (iSeg >= 0 && iSeg + 1 < path.length){
    const dSegX = path[iSeg + 1].x - path[iSeg].x;
    const dSegY = path[iSeg + 1].y - path[iSeg].y;
    const distSeg = Math.hypot(dSegX, dSegY);
    if (distSeg < 1e-10){
      indexPath = iSeg + 1;
      ++iSeg;
      uSeg = 0;
      continue;
    }
    const distSegStop = (iSeg < iSegMax) ? Infinity : Math.max(0, (uSegMax - uSeg) * distSeg);
    if (distRemaining >= distSegStop){
      indexPath = indexPathMax;
      break;
    }
    const distSegRemaining = (1 - uSeg) * distSeg;
    if (distRemaining < distSegRemaining){
      indexPath += distRemaining / distSeg;
      break;
    }
    distRemaining -= distSegRemaining;
    ++iSeg;
    uSeg = 0;
    indexPath = iSeg;
  }

  return indexPath;
}

/**
 * Move backward (decreasing index) along a path by distance down to indexPathMin.
 * @param {Array<Point>} path
 * @param {number} indexPath
 * @param {number} distRemaining
 * @param {number} indexPathMin
 * @returns {number}
 */
export function moveAlongPathNegative(path, indexPath, distRemaining, indexPathMin){
  if (!(distRemaining > 0)) return indexPath;
  if (!(indexPath > indexPathMin)) return indexPathMin;
  const iSegMin = Math.floor(indexPathMin);
  const uSegMin = indexPathMin - iSegMin;
  let iSeg = Math.floor(indexPath);
  let uSeg = indexPath - iSeg;
  if (iSeg >= path.length - 1){
    // If starting exactly at the last path point, step from the final segment.
    iSeg = path.length - 2;
    uSeg = 1;
    indexPath = path.length - 1;
  }

  while (iSeg >= 0 && iSeg + 1 < path.length){
    const dSegX = path[iSeg + 1].x - path[iSeg].x;
    const dSegY = path[iSeg + 1].y - path[iSeg].y;
    const distSeg = Math.hypot(dSegX, dSegY);
    if (distSeg < 1e-10){
      indexPath = iSeg;
      --iSeg;
      uSeg = 1;
      continue;
    }
    const distSegStop = (iSeg > iSegMin) ? Infinity : Math.max(0, (uSeg - uSegMin) * distSeg);
    if (distRemaining >= distSegStop){
      indexPath = indexPathMin;
      break;
    }
    const distSegRemaining = uSeg * distSeg;
    if (distRemaining < distSegRemaining){
      indexPath -= distRemaining / distSeg;
      break;
    }
    distRemaining -= distSegRemaining;
    indexPath = iSeg;
    --iSeg;
    uSeg = 1;
  }

  return indexPath;
}

/**
 * Extract a contiguous polyline segment between two path indexes.
 * @param {Array<Point>} path
 * @param {number} indexA
 * @param {number} indexB
 * @returns {Array<Point>|null}
 */
export function extractPathSegment(path, indexA, indexB){
  if (!path || path.length < 2) return null;
  if (!Number.isFinite(indexA) || !Number.isFinite(indexB)) return null;
  const lo = Math.min(indexA, indexB);
  const hi = Math.max(indexA, indexB);
  const forward = indexA <= indexB;
  /** @type {Array<Point>} */
  const out = [];
  const pushUnique = (p) => {
    const last = out.length ? out[out.length - 1] : null;
    if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-4){
      out.push({ x: p.x, y: p.y });
    }
  };
  pushUnique(posFromPathIndex(path, lo));
  const iMin = Math.max(0, Math.ceil(lo));
  const iMax = Math.min(path.length - 1, Math.floor(hi));
  for (let i = iMin; i <= iMax; i++){
    pushUnique(path[i]);
  }
  pushUnique(posFromPathIndex(path, hi));
  if (!forward) out.reverse();
  return out.length >= 2 ? out : null;
}

/**
 * Find the ship's target index on a guide path, preferring geometric projection.
 * @param {{path:Array<Point>,indexClosest:number}|null} guidePath
 * @param {number} shipX
 * @param {number} shipY
 * @returns {number|null}
 */
export function findGuidePathTargetIndex(guidePath, shipX, shipY){
  if (!guidePath || !guidePath.path || guidePath.path.length < 2){
    return null;
  }
  const projected = indexPathFromPos(guidePath.path, Number.POSITIVE_INFINITY, shipX, shipY);
  if (projected !== null) return projected;
  if (Number.isFinite(guidePath.indexClosest)){
    return Math.max(0, Math.min(guidePath.path.length - 1, guidePath.indexClosest));
  }
  return null;
}

/**
 * Miner attach-to-guide checks with radial-band preference.
 * @param {Array<Point>} path
 * @param {number} attachDist
 * @param {number} minerX
 * @param {number} minerY
 * @param {number|null} [rHint]
 * @param {{radialTolBase?:number,sameRingIdx?:number|null,nearbyRingIdx?:number|null,plainIdx?:number|null,chosenStage?:string,chosenIdx?:number|null,chosenDist?:number,chosenR?:number,nearestIdx?:number|null,nearestDist?:number,nearestR?:number}|null} [debug]
 * @returns {number|null}
 */
export function findMinerGuideAttachIndex(path, attachDist, minerX, minerY, rHint = null, debug = null){
  const radialTolBase = Math.max(0.12, Math.min(0.28, attachDist * 0.28));
  let sameRingIdx = null;
  let nearbyRingIdx = null;
  let plainIdx = null;
  if (debug){
    debug.radialTolBase = radialTolBase;
    debug.sameRingIdx = sameRingIdx;
    debug.nearbyRingIdx = nearbyRingIdx;
    debug.plainIdx = plainIdx;
    debug.chosenStage = "none";
    debug.chosenIdx = null;
    debug.chosenDist = Number.POSITIVE_INFINITY;
    debug.chosenR = Number.POSITIVE_INFINITY;
    debug.nearestIdx = null;
    debug.nearestDist = Number.POSITIVE_INFINITY;
    debug.nearestR = Number.POSITIVE_INFINITY;
  }
  if (rHint !== null && Number.isFinite(rHint)){
    sameRingIdx = indexPathFromPos(path, attachDist, minerX, minerY, rHint, radialTolBase);
    if (debug) debug.sameRingIdx = sameRingIdx;
    nearbyRingIdx = indexPathFromPos(path, attachDist, minerX, minerY, rHint, radialTolBase * 2);
    if (debug) debug.nearbyRingIdx = nearbyRingIdx;
  }
  plainIdx = indexPathFromPos(path, attachDist, minerX, minerY);
  if (debug) debug.plainIdx = plainIdx;

  let chosenIdx = null;
  let chosenStage = "none";
  if (sameRingIdx !== null){
    chosenIdx = sameRingIdx;
    chosenStage = "same_ring";
  } else if (nearbyRingIdx !== null){
    chosenIdx = nearbyRingIdx;
    chosenStage = "nearby_ring";
  } else if (plainIdx !== null){
    chosenIdx = plainIdx;
    chosenStage = "plain";
  }

  if (debug){
    const nearestIdx = indexPathFromPos(path, Number.POSITIVE_INFINITY, minerX, minerY);
    debug.nearestIdx = nearestIdx;
    if (nearestIdx !== null){
      const nearestPos = posFromPathIndex(path, nearestIdx);
      debug.nearestDist = Math.hypot(nearestPos.x - minerX, nearestPos.y - minerY);
      debug.nearestR = Math.hypot(nearestPos.x, nearestPos.y);
    }
    if (chosenIdx !== null){
      const chosenPos = posFromPathIndex(path, chosenIdx);
      debug.chosenDist = Math.hypot(chosenPos.x - minerX, chosenPos.y - minerY);
      debug.chosenR = Math.hypot(chosenPos.x, chosenPos.y);
    }
    debug.chosenIdx = chosenIdx;
    debug.chosenStage = chosenStage;
  }

  return chosenIdx;
}
