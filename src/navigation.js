// @ts-check

import { CFG } from "./config.js";

/** @typedef {import("./types.d.js").Point} Point */
/** @typedef {Point & {air:number}} AirPoint */

/**
 * @template T
 * @param {T|undefined|null} value
 * @returns {T}
 */
function expectDefined(value){
  if (value === undefined || value === null){
    throw new Error("Expected value");
  }
  return value;
}

/**
 * @param {number} r
 * @returns {number}
 */
function ringVertexCount(r){
  if (r <= 0) return 1;
  return Math.max(CFG.N_MIN, Math.floor(2 * Math.PI * r));
}

/**
 * @param {number} radius
 * @returns {AirPoint[]}
 */
function makeNavPaddingRing(radius){
  if (radius <= 0) return [{ x: 0, y: 0, air: 1 }];
  const n = ringVertexCount(radius);
  const phase = (0.5 / n) * Math.PI * 2;
  /** @type {AirPoint[]} */
  const out = [];
  for (let k = 0; k < n; k++){
    const a = ((k / n) * Math.PI * 2) + phase;
    out.push({ x: radius * Math.cos(a), y: radius * Math.sin(a), air: 1 });
  }
  return out;
}

/**
 * @param {Point[]} inner
 * @param {Point[]} outer
 * @returns {Array<[Point, Point, Point]>}
 */
function stitchBand(inner, outer){
  /** @type {Array<[Point, Point, Point]>} */
  const tris = [];
  if (!inner.length || !outer.length) return tris;
  const n0 = inner.length;
  const n1 = outer.length;
  const I = inner.concat([expectDefined(inner[0])]);
  const O = outer.concat([expectDefined(outer[0])]);
  let i = 0;
  let j = 0;
  while (i < n0 || j < n1){
    if (i >= n0){
      tris.push([expectDefined(I[i]), expectDefined(O[j]), expectDefined(O[j + 1])]);
      j++;
      continue;
    }
    if (j >= n1){
      tris.push([expectDefined(I[i]), expectDefined(O[j]), expectDefined(I[i + 1])]);
      i++;
      continue;
    }
    if ((i + 1) / n0 < (j + 1) / n1){
      tris.push([expectDefined(I[i]), expectDefined(O[j]), expectDefined(I[i + 1])]);
      i++;
    } else {
      tris.push([expectDefined(I[i]), expectDefined(O[j]), expectDefined(O[j + 1])]);
      j++;
    }
  }
  return tris;
}

class MinHeap {
  /**
   * @constructor
   */
  constructor(){
    /** @type {{node:number, f:number, g:number}[]} */
    this.items = [];
  }
  /**
   * @param {number} node
   * @param {number} f
   * @param {number} g
   * @returns {void}
   */
  push(node, f, g){
    const item = { node, f, g };
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0){
      const p = (i - 1) >> 1;
      const parent = expectDefined(items[p]);
      if (parent.f <= item.f) break;
      items[i] = parent;
      i = p;
    }
    items[i] = item;
  }
  /**
   * @returns {{node:number, f:number, g:number}|null}
   */
  pop(){
    const items = this.items;
    if (!items.length) return null;
    const root = expectDefined(items[0]);
    const last = items.pop();
    if (!last || !items.length) return root;
    items[0] = last;
    let i = 0;
    const n = items.length;
    while (true){
      const l = i * 2 + 1;
      const r = l + 1;
      if (l >= n) break;
      let m = l;
      const left = expectDefined(items[l]);
      if (r < n && expectDefined(items[r]).f < left.f) m = r;
      if (expectDefined(items[i]).f <= expectDefined(items[m]).f) break;
      const tmp = expectDefined(items[i]);
      items[i] = expectDefined(items[m]);
      items[m] = tmp;
      i = m;
    }
    return root;
  }
  /**
   * @returns {number}
   */
  get size(){ return this.items.length; }
}

/**
 * Build a navigation graph using discrete radial point adjacencies.
 * Uses mesh ring points and band triangulation to infer edges.
 */
export class RadialGraph {
  /**
   * Build a navigation graph using discrete radial point adjacencies.
   * @param {{rings: Array<Point[]>, bandTris: Array<Array<Array<Point>>>, airValueAtWorld:(x:number,y:number)=>number}} mesh Mesh rings and band triangles.
   * @param {{navPadding?:number}} [opts]
   */
  constructor(mesh, opts = {}){
    const { rings, bandTris } = mesh;
    const outerMeshRingIndex = Math.max(0, rings.length - 1);
    const outerMeshRing = rings[outerMeshRingIndex] || [];
    const outerMeshRadius = outerMeshRing.length
      ? Math.max(...outerMeshRing.map((v) => Math.hypot(v.x, v.y)))
      : outerMeshRingIndex;
    const requestedNavPadding = (typeof opts.navPadding === "number")
      ? Math.max(0, opts.navPadding)
      : 0;
    const navPaddedRingRadius = requestedNavPadding > 0
      ? outerMeshRadius + requestedNavPadding
      : NaN;
    const hasNavPadding = Number.isFinite(navPaddedRingRadius) && navPaddedRingRadius > outerMeshRadius + 1e-6;
    /** @type {RadialGraph["nodes"]} */
    const nodes = [];
    /** @type {RadialGraph["neighbors"]} */
    const neighbors = [];
    /** @type {RadialGraph["ringIndex"]} */
    const ringIndex = [];
    /** @type {RadialGraph["nodeOfRef"]} */
    const nodeOfRef = new Map();

    for (let r = 0; r < rings.length; r++){
      const ring = rings[r] || [];
      ringIndex[r] = [];
      const ringRefs = expectDefined(ringIndex[r]);
      for (let i = 0; i < ring.length; i++){
        const v = ring[i];
        if (!v) continue;
        const idx = nodes.length;
        nodes.push({ x: v.x, y: v.y, r, i, navPadded: false });
        neighbors.push([]);
        ringRefs.push(idx);
        nodeOfRef.set(v, idx);
      }
    }

    /** @type {Point[]|null} */
    const navPaddingRing = hasNavPadding
      ? makeNavPaddingRing(navPaddedRingRadius)
      : null;
    const navPaddedRingIndex = ringIndex.length;
    if (navPaddingRing && navPaddingRing.length){
      ringIndex[navPaddedRingIndex] = [];
      const navPaddedRefs = expectDefined(ringIndex[navPaddedRingIndex]);
      for (let i = 0; i < navPaddingRing.length; i++){
        const v = navPaddingRing[i];
        if (!v) continue;
        const idx = nodes.length;
        nodes.push({ x: v.x, y: v.y, r: navPaddedRingIndex, i, navPadded: true });
        neighbors.push([]);
        navPaddedRefs.push(idx);
        nodeOfRef.set(v, idx);
      }
    }

    /** @type {Array<Array<Array<Point>>>} */
    const graphBandTris = bandTris.slice();
    if (navPaddingRing && navPaddingRing.length && outerMeshRing.length){
      graphBandTris.push(stitchBand(outerMeshRing, navPaddingRing));
    }

    /** @param {number} a @param {number} b */
    function addEdge(a, b){
      if (a === b) return;
      if (a < 0 || b < 0) return;
      const na = nodes[a];
      const nb = nodes[b];
      if (!na || !nb) return;
      const dx = na.x - nb.x;
      const dy = na.y - nb.y;
      const cost = Math.hypot(dx, dy);
      expectDefined(neighbors[a]).push({ to: b, cost });
      expectDefined(neighbors[b]).push({ to: a, cost });
    }

    /**
     * Keep nav-padded-to-mesh links only when the segment stays in air.
     * @param {number} a
     * @param {number} b
     * @returns {boolean}
     */
    function canConnect(a, b){
      const na = nodes[a];
      const nb = nodes[b];
      if (!na || !nb) return false;
      if (!na.navPadded && !nb.navPadded) return true;
      if (na.navPadded && nb.navPadded) return true;
      return lineOfSightAir(mesh, na.x, na.y, nb.x, nb.y);
    }

    // Same-ring adjacencies
    for (let r = 0; r < rings.length; r++){
      const ring = rings[r] || [];
      const n = ring.length;
      if (n <= 1) continue;
      const ringRefs = ringIndex[r];
      if (!ringRefs) continue;
      for (let i = 0; i < n; i++){
        const a = ringRefs[i];
        const b = ringRefs[(i + 1) % n];
        if (a === undefined || b === undefined) continue;
        addEdge(a, b);
      }
    }
    if (navPaddingRing && navPaddingRing.length){
      const n = navPaddingRing.length;
      const ringRefs = ringIndex[navPaddedRingIndex];
      if (ringRefs){
        for (let i = 0; i < n; i++){
          const a = ringRefs[i];
          const b = ringRefs[(i + 1) % n];
          if (a === undefined || b === undefined) continue;
          addEdge(a, b);
        }
      }
    }

    // Triangulation adjacencies (between rings)
    for (const tris of graphBandTris){
      if (!tris) continue;
      for (const tri of tris){
        const va = tri[0];
        const vb = tri[1];
        const vc = tri[2];
        if (!va || !vb || !vc) continue;
        const ia = nodeOfRef.get(va);
        const ib = nodeOfRef.get(vb);
        const ic = nodeOfRef.get(vc);
        if (ia === undefined || ib === undefined || ic === undefined) continue;
        if (canConnect(ia, ib)) addEdge(ia, ib);
        if (canConnect(ib, ic)) addEdge(ib, ic);
        if (canConnect(ic, ia)) addEdge(ic, ia);
      }
    }

    // Connect center to first ring if needed
    if (ringIndex[0] && ringIndex[0].length === 1 && ringIndex[1]){
      const center = ringIndex[0][0];
      if (center === undefined) return;
      for (const idx of ringIndex[1]){
        if (idx === undefined) continue;
        addEdge(center, idx);
      }
    }

    /** @type {{x:number,y:number,r:number,i:number,navPadded?:boolean}[]} */
    this.nodes = nodes;
    /** @type {Array<{to:number,cost:number}[]>} */
    this.neighbors = neighbors;
    /** @type {Array<number[]>} */
    this.ringIndex = ringIndex;
    /** @type {Map<Point, number>} */
    this.nodeOfRef = nodeOfRef;
    /** @type {boolean} */
    this.navPadded = !!(navPaddingRing && navPaddingRing.length);
    /** @type {number} */
    this.outerMeshRingIndex = outerMeshRingIndex;
    /** @type {number} */
    this.outerMeshRadius = outerMeshRadius;
    /** @type {number|null} */
    this.navPaddedRingIndex = this.navPadded ? navPaddedRingIndex : null;
    /** @type {number|null} */
    this.navPaddedRingRadius = this.navPadded ? navPaddedRingRadius : null;
    /** @type {number} */
    this.navPadding = this.navPadded ? requestedNavPadding : 0;
  }
}

/**
 * Build a passability mask for the radial graph.
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {RadialGraph} graph
 * @param {number} [threshold]
 * @returns {Uint8Array}
 */
export function buildPassableMask(mesh, graph, threshold = 0.5){
  const passable = new Uint8Array(graph.nodes.length);
  for (let i = 0; i < graph.nodes.length; i++){
    const n = graph.nodes[i];
    if (!n) continue;
    passable[i] = n && n.navPadded
      ? 1
      : (mesh.airValueAtWorld(n.x, n.y) > threshold ? 1 : 0);
  }
  return passable;
}

/**
 * Find nearest radial node to world point using ring radius.
 * @param {RadialGraph} graph
 * @param {{ nearestNodeOnRing:(x:number,y:number)=>Point|null }} mesh
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
export function nearestRadialNode(graph, mesh, x, y){
  if (graph.navPadded && graph.navPaddedRingIndex !== null){
    const r = Math.hypot(x, y);
    if (r > graph.outerMeshRadius){
      let best = -1;
      let bestD = Infinity;
      const candidateRings = [graph.outerMeshRingIndex, graph.navPaddedRingIndex];
      for (const ringIdx of candidateRings){
        const ring = graph.ringIndex[ringIdx] || [];
        for (const idx of ring){
          const n = graph.nodes[idx];
          if (!n) continue;
          const dx = n.x - x;
          const dy = n.y - y;
          const d = dx * dx + dy * dy;
          if (d < bestD){
            bestD = d;
            best = idx;
          }
        }
      }
      if (best >= 0) return best;
    }
  }
  const ref = mesh.nearestNodeOnRing(x, y);
  if (ref && graph.nodeOfRef.has(ref)) return graph.nodeOfRef.get(ref) ?? -1;
  let best = -1;
  let bestD = 1e9;
  for (let i = 0; i < graph.nodes.length; i++){
    const n = graph.nodes[i];
    if (!n) continue;
    const dx = n.x - x;
    const dy = n.y - y;
    const d = dx * dx + dy * dy;
    if (d < bestD){ bestD = d; best = i; }
  }
  return best;
}

/**
 * Dijkstra distance map from one or more sources.
 * @param {RadialGraph} graph
 * @param {number[]} sources
 * @param {Uint8Array} passable
 * @returns {Float32Array}
 */
export function dijkstraMap(graph, sources, passable){
  const n = graph.nodes.length;
  const dist = new Array(n).fill(Infinity);
  const heap = new MinHeap();

  for (const s of sources){
    if (s < 0 || s >= n) continue;
    if (!passable[s]) continue;
    dist[s] = 0;
    heap.push(s, 0, 0);
  }

  while (heap.size){
    const item = heap.pop();
    if (!item) break;
    const { node, g } = item;
    if (g > dist[node]) continue;
    const neighbors = graph.neighbors[node] || [];
    for (const edge of neighbors){
      if (!passable[edge.to]) continue;
      const nd = g + edge.cost;
      if (nd < dist[edge.to]){
        dist[edge.to] = nd;
        heap.push(edge.to, nd, nd);
      }
    }
  }

  return Float32Array.from(dist);
}

/**
 * A* path on radial graph.
 * @param {RadialGraph} graph
 * @param {number} start
 * @param {number} goal
 * @param {Uint8Array} passable
 * @returns {number[]|null}
 */
export function findPathAStar(graph, start, goal, passable){
  const n = graph.nodes.length;
  if (start < 0 || start >= n || goal < 0 || goal >= n) return null;

  const gScore = new Array(n).fill(Infinity);
  gScore[start] = 0;
  const cameFrom = new Int32Array(n).fill(-1);

  const heap = new MinHeap();
  /**
   * @param {number} a
   */
  const h = (a) => {
    const na = graph.nodes[a];
    const nb = graph.nodes[goal];
    if (!na || !nb) return Infinity;
    return Math.hypot(na.x - nb.x, na.y - nb.y);
  };
  heap.push(start, h(start), 0);

  while (heap.size){
    const item = heap.pop();
    if (!item) break;
    const { node, g } = item;
    if (node === goal) break;
    if (g > gScore[node]) continue;
    const neighbors = graph.neighbors[node] || [];
    for (const edge of neighbors){
      if (!passable[edge.to]){
        continue;
      }
      const tentative = g + edge.cost;
      if (tentative < gScore[edge.to]){
        gScore[edge.to] = tentative;
        cameFrom[edge.to] = node;
        const f = tentative + h(edge.to);
        heap.push(edge.to, f, tentative);
      }
    }
  }

  if (start !== goal && cameFrom[goal] === -1) return null;
  const path = [];
  let cur = goal;
  path.push(cur);
  while (cur !== start){
    const prev = cameFrom[cur];
    if (prev === undefined) return null;
    cur = prev;
    if (cur === -1) return null;
    path.push(cur);
  }
  path.reverse();
  return path;
}

/**
 * Line-of-sight test through air between two points.
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @param {number} [step]
 * @returns {boolean}
 */
export function lineOfSightAir(mesh, ax, ay, bx, by, step = 0.25){
  const dx = bx - ax;
  const dy = by - ay;
  const dist = Math.hypot(dx, dy);
  if (dist <= 1e-6) return true;
  const steps = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i < steps; i++){
    const t = i / steps;
    const x = ax + dx * t;
    const y = ay + dy * t;
    if (mesh.airValueAtWorld(x, y) <= 0.5) return false;
  }
  return true;
}

/**
 * Convenience LOS: ship to node or ship to entity.
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {{x:number,y:number}} ship
 * @param {{x:number,y:number}} target
 * @param {number} [step]
 * @returns {boolean}
 */
export function lineOfSightShipTo(mesh, ship, target, step){
  return lineOfSightAir(mesh, ship.x, ship.y, target.x, target.y, step);
}

