// @ts-check

/** @typedef {{x:number,y:number}} Point */

/**
 * @typedef {Object} RadialGraph
 * @property {{x:number,y:number,r:number,i:number}[]} nodes
 * @property {Array<{to:number,cost:number}[]>} neighbors
 * @property {Array<number[]>} ringIndex
 * @property {Map<Point, number>} nodeOfRef
 */

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
   */
  push(node, f, g){
    const item = { node, f, g };
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0){
      const p = (i - 1) >> 1;
      if (items[p].f <= item.f) break;
      items[i] = items[p];
      i = p;
    }
    items[i] = item;
  }
  pop(){
    const items = this.items;
    if (!items.length) return null;
    const root = items[0];
    const last = items.pop();
    if (!items.length) return root;
    items[0] = last;
    let i = 0;
    const n = items.length;
    while (true){
      const l = i * 2 + 1;
      const r = l + 1;
      if (l >= n) break;
      let m = l;
      if (r < n && items[r].f < items[l].f) m = r;
      if (items[i].f <= items[m].f) break;
      const tmp = items[i];
      items[i] = items[m];
      items[m] = tmp;
      i = m;
    }
    return root;
  }
  get size(){ return this.items.length; }
}

/**
 * Build a navigation graph using discrete radial point adjacencies.
 * Uses mesh ring points and band triangulation to infer edges.
 * @param {{rings: Array<Point[]>, bandTris: Array<Array<Array<Point>>>}} mesh
 * @returns {RadialGraph}
 */
export function buildRadialGraph(mesh){
  const { rings, bandTris } = mesh;
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
    for (let i = 0; i < ring.length; i++){
      const v = ring[i];
      const idx = nodes.length;
      nodes.push({ x: v.x, y: v.y, r, i });
      neighbors.push([]);
      ringIndex[r].push(idx);
      nodeOfRef.set(v, idx);
    }
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
    neighbors[a].push({ to: b, cost });
    neighbors[b].push({ to: a, cost });
  }

  // Same-ring adjacencies
  for (let r = 0; r < rings.length; r++){
    const ring = rings[r] || [];
    const n = ring.length;
    if (n <= 1) continue;
    for (let i = 0; i < n; i++){
      const a = ringIndex[r][i];
      const b = ringIndex[r][(i + 1) % n];
      addEdge(a, b);
    }
  }

  // Triangulation adjacencies (between rings)
  for (const tris of bandTris){
    if (!tris) continue;
    for (const tri of tris){
      const ia = nodeOfRef.get(tri[0]);
      const ib = nodeOfRef.get(tri[1]);
      const ic = nodeOfRef.get(tri[2]);
      if (ia === undefined || ib === undefined || ic === undefined) continue;
      addEdge(ia, ib);
      addEdge(ib, ic);
      addEdge(ic, ia);
    }
  }

  // Connect center to first ring if needed
  if (ringIndex[0] && ringIndex[0].length === 1 && ringIndex[1]){
    const center = ringIndex[0][0];
    for (const idx of ringIndex[1]){
      addEdge(center, idx);
    }
  }

  return { nodes, neighbors, ringIndex, nodeOfRef };
}

/**
 * Build a passability mask for the radial graph.
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {RadialGraph} graph
 * @param {number} [threshold]
 */
export function buildPassableMask(mesh, graph, threshold = 0.5){
  const passable = new Uint8Array(graph.nodes.length);
  for (let i = 0; i < graph.nodes.length; i++){
    const n = graph.nodes[i];
    passable[i] = mesh.airValueAtWorld(n.x, n.y) > threshold ? 1 : 0;
  }
  return passable;
}

/**
 * Find nearest radial node to world point using ring radius.
 * @param {RadialGraph} graph
 * @param {{ nearestNodeOnRing:(x:number,y:number)=>Point|null }} mesh
 * @param {number} x
 * @param {number} y
 */
export function nearestRadialNode(graph, mesh, x, y){
  const ref = mesh.nearestNodeOnRing(x, y);
  if (ref && graph.nodeOfRef.has(ref)) return graph.nodeOfRef.get(ref);
  let best = -1;
  let bestD = 1e9;
  for (let i = 0; i < graph.nodes.length; i++){
    const n = graph.nodes[i];
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
 */
export function dijkstraMap(graph, sources, passable){
  const n = graph.nodes.length;
  const dist = new Float32Array(n);
  dist.fill(Number.POSITIVE_INFINITY);
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
    if (g !== dist[node]) continue;
    for (const edge of graph.neighbors[node]){
      if (!passable[edge.to]) continue;
      const nd = g + edge.cost;
      if (nd < dist[edge.to]){
        dist[edge.to] = nd;
        heap.push(edge.to, nd, nd);
      }
    }
  }

  return dist;
}

/**
 * A* path on radial graph.
 * @param {RadialGraph} graph
 * @param {number} start
 * @param {number} goal
 * @param {Uint8Array} passable
 */
export function findPathAStar(graph, start, goal, passable){
  const n = graph.nodes.length;
  if (start < 0 || start >= n || goal < 0 || goal >= n) return null;
  if (!passable[start] || !passable[goal]) return null;

  const gScore = new Float32Array(n);
  gScore.fill(Number.POSITIVE_INFINITY);
  gScore[start] = 0;
  const cameFrom = new Int32Array(n);
  cameFrom.fill(-1);

  const heap = new MinHeap();
  const h = (a) => {
    const na = graph.nodes[a];
    const nb = graph.nodes[goal];
    return Math.hypot(na.x - nb.x, na.y - nb.y);
  };
  heap.push(start, h(start), 0);

  while (heap.size){
    const item = heap.pop();
    if (!item) break;
    const { node, g } = item;
    if (node === goal) break;
    if (g !== gScore[node]) continue;
    for (const edge of graph.neighbors[node]){
      if (!passable[edge.to]) continue;
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
    cur = cameFrom[cur];
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
 */
export function lineOfSightShipTo(mesh, ship, target, step){
  return lineOfSightAir(mesh, ship.x, ship.y, target.x, target.y, step);
}
