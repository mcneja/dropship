// @ts-check

import { CFG, GAME } from "./config.js";

export class RingMesh {
  /**
   * Build mesh geometry and sampling helpers from a map source.
   * @param {import("./mapgen.js").MapGen} map Map generator.
   * @param {import("./planet_config.js").PlanetParams} params
   */
  constructor(map, params){
    this._params = params;
    this._map = map;
    this._OUTER_PAD = 0.0;
    // Keep the outer shell purely space so mapgen raster noise cannot create
    // phantom rock/collision slivers at the mesh boundary.
    this._OUTER_FORCED_AIR_RINGS = 0;
    this._R_MESH = Math.max(0, Math.floor(params.RMAX)) + 1;

    /**
     * @param {number} r
     */
    function ringCount(r){
      if (r<=0) return 1;
      return Math.max(CFG.N_MIN, Math.floor(2*Math.PI*r));
    }

    /**
     * @param {number} r
     */
    function ringVertices(r){
      if (r===0) return [{x:0,y:0,air:1}];
      const n = ringCount(r);
      const phase = (0.5/n) * 2*Math.PI;
      const out=[];
      for (let k=0;k<n;k++){
        const a = 2*Math.PI*k/n + phase;
        let rr = r;
        out.push({x:rr*Math.cos(a), y:rr*Math.sin(a), air:1});
      }
      return out;
    }

    /**
     * @param {{x:number,y:number,air:number}[]} inner
     * @param {{x:number,y:number,air:number}[]} outer
     */
    function stitchBand(inner, outer){
      const tris=[];
      const n0=inner.length, n1=outer.length;
      const I = inner.concat([inner[0]]);
      const O = outer.concat([outer[0]]);
      let i=0, j=0;
      while (i<n0 || j<n1){
        if (i>=n0){
          tris.push([I[i], O[j], O[j+1]]); j++; continue;
        }
        if (j>=n1){
          tris.push([I[i], O[j], I[i+1]]); i++; continue;
        }
        if ((i+1)/n0 < (j+1)/n1){
          tris.push([I[i], O[j], I[i+1]]); i++;
        } else {
          tris.push([I[i], O[j], O[j+1]]); j++;
        }
      }
      return tris;
    }

    /**
     * @param {number} x
     * @param {number} y
     */
    function shadeAt(x, y){
      const n = map.noise.fbm(x*0.16, y*0.16, 2, 0.6, 2.0);
      return Math.max(0, Math.min(1, 0.5 + 0.5*n));
    }

    /** @type {number[]} */
    const positions = [];
    /** @type {number[]} */
    const triCentroids = [];
    /** @type {Array<Array<{x:number,y:number,air:number}>>} */
    const triList = [];
    /** @type {number[]} */
    const airFlag = [];
    /** @type {number[]} */
    const shade = [];
    /** @type {Array<{x:number,y:number,air:number}>} */
    const vertRefs = [];

    /** @type {Array<{x:number,y:number,air:number}[]>} */
    const rings = [];
    /** @type {Array<Array<Array<{x:number,y:number,air:number}>>>} */
    const bandTris = [];
    const rMaxInt = Math.max(0, Math.floor(params.RMAX));
    for (let r=0;r<=rMaxInt;r++) rings.push(ringVertices(r));
    this._R_MESH = rings.length - 1;
    this.rings = rings;

      for (let r = 0; r < rings.length; r++){
        const ring = rings[r];
        for (const v of ring){
          v.air = this._sampleAirAtWorldExtended(v.x, v.y);
        }
      }
      this._applyMoltenOverrides();
      this._forceOuterShellAir();
      this._cleanupOuterRimSpikeArtifacts();

      for (let r=0;r<this._R_MESH;r++){
        const inner = rings[r];
        const outer = rings[r+1];
        if (!inner || !outer) continue;
        if (r===0){
        const tris = [];
        const center = inner && inner.length ? inner[0] : {x:0,y:0,air:this._sampleAirAtWorldExtended(0, 0)};
        for (let k=0;k<outer.length;k++){
          const a = center;
          const b = outer[k];
          const c = outer[(k+1)%outer.length];
          tris.push([a, b, c]);
          triCentroids.push((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3);
          triList.push([a, b, c]);
          for (const v of [a,b,c]){
            positions.push(v.x, v.y);
            airFlag.push(v.air);
            vertRefs.push(v);
            shade.push(shadeAt(v.x, v.y));
          }
        }
        bandTris[r] = tris;
        } else {
          const tris = stitchBand(inner, outer);
          bandTris[r] = tris;
          for (const tri of tris){
            triCentroids.push((tri[0].x + tri[1].x + tri[2].x) / 3, (tri[0].y + tri[1].y + tri[2].y) / 3);
            triList.push(tri);
            for (const v of tri){
              positions.push(v.x, v.y);
              airFlag.push(v.air);
              vertRefs.push(v);
              shade.push(shadeAt(v.x, v.y));
            }
          }
        }
      }

    this.vertCount = positions.length / 2;
    this.triCount = triCentroids.length / 2;

    /** @type {Float32Array} */
    this.positions = new Float32Array(positions);
    /** @type {Float32Array} */
    this.airFlag = new Float32Array(airFlag);
    /** @type {Float32Array} */
    this.shade = new Float32Array(shade);
    /** @type {Array<{x:number,y:number,air:number}[]>} */
    this.rings = rings;
    /** @type {Array<Array<Array<{x:number,y:number,air:number}>>>} */
    this.bandTris = bandTris;
    this._vertRefs = vertRefs;
    this._triCentroids = new Float32Array(triCentroids);
    this._triList = triList;

    this._fogCursor = 0;
    this._fogRange = params.VIS_RANGE;
    this._fogStep = GAME.VIS_STEP;
    this._fogSeenAlpha = params.FOG_SEEN_ALPHA;
    this._fogUnseenAlpha = params.FOG_UNSEEN_ALPHA;
    this._fogHoldFrames = GAME.FOG_HOLD_FRAMES;
    this._fogLosThresh = GAME.FOG_LOS_THRESH ?? 0.45;
    this._fogAlphaLerp = GAME.FOG_ALPHA_LERP ?? 0.2;
    this._fogBudgetTris = params.FOG_BUDGET_TRIS ?? 200;
    const total = this.triCount;
    this._fogAlpha = new Float32Array(total * 3);
    this._fogVisible = new Uint8Array(total);
    this._fogSeen = new Uint8Array(total);
    this._fogHold = new Uint8Array(total);
    const triIndexOf = new Map();
    let idx = 0;
    for (const band of this.bandTris){
      if (!band) continue;
      for (const tri of band){
        triIndexOf.set(tri, idx);
        idx++;
      }
    }
    this._triIndexOf = triIndexOf;

    const vertIdOf = new Map();
    let vid = 0;
    for (const ring of this.rings){
      if (!ring) continue;
      for (const v of ring){
        vertIdOf.set(v, vid++);
      }
    }
    this._vertIdOf = vertIdOf;
    this._guideContour = null;
    this._guideContourDirty = true;
  }

  /**
   * @param {number} px
   * @param {number} py
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @param {number} cx
   * @param {number} cy
   * @returns {boolean}
   */
  _pointInTri(px, py, ax, ay, bx, by, cx, cy){
    const v0x = cx - ax, v0y = cy - ay;
    const v1x = bx - ax, v1y = by - ay;
    const v2x = px - ax, v2y = py - ay;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const invDen = 1 / (dot00 * dot11 - dot01 * dot01 || 1);
    const u = (dot11 * dot02 - dot01 * dot12) * invDen;
    const v = (dot00 * dot12 - dot01 * dot02) * invDen;
    return (u >= -1e-6) && (v >= -1e-6) && (u + v <= 1 + 1e-6);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  _sampleAirAtWorldExtended(x, y){
    const r = Math.hypot(x, y);
    const coreR = (this._params.CORE_RADIUS > 1)
      ? this._params.CORE_RADIUS
      : (this._params.CORE_RADIUS * this._params.RMAX);
    if (coreR > 0 && r <= coreR) return 0;
    const forcedRings = Math.max(0, this._OUTER_FORCED_AIR_RINGS | 0);
    if (forcedRings > 0){
      const outerShellMinR = Math.max(0, this._R_MESH - forcedRings);
      if (r >= outerShellMinR) return 1;
    }
    if (r > this._params.RMAX) return 1;
    return this._map.airBinaryAtWorld(x, y);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {Array<{x:number,y:number,air:number}>|null}
   */
  findTriAtWorld(x, y){
    const r = Math.hypot(x, y);
    if (r <= 0) return null;
    const r0 = Math.floor(Math.min(this._R_MESH - 1, Math.max(0, r)));
    const bands = [r0, r0 - 1, r0 + 1];
    for (const bi of bands){
      if (bi < 0 || bi >= this._R_MESH) continue;
      const tris = this.bandTris[bi];
      if (!tris) continue;
      for (const tri of tris){
        const a = tri[0], b = tri[1], c = tri[2];
        if (this._pointInTri(x, y, a.x, a.y, b.x, b.y, c.x, c.y)) return tri;
      }
    }
    return null;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {{x:number,y:number,air:number}|null}
   */
  nearestNodeOnRing(x, y){
    const r = Math.hypot(x, y);
    const ri = Math.max(0, Math.min(this.rings.length - 1, Math.round(r)));
    const ring = this.rings[ri];
    if (!ring || ring.length === 0) return null;
    let best = ring[0];
    let bestD = 1e9;
    for (const v of ring){
      const dx = v.x - x;
      const dy = v.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD){ bestD = d; best = v; }
    }
    return best;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  airValueAtWorld(x, y){
    const r = Math.hypot(x, y);
    const rOuter = this.rings ? (this.rings.length - 1) : this._params.RMAX;
    if (r > rOuter + this._OUTER_PAD) return 1;
    if (r > this._params.RMAX + this._OUTER_PAD) return 1;
    return this._airValueAtWorldNoOuterClamp(x, y);
  }

  /**
   * Collision-focused air sampling.
   * Uses the same terrain field as rendering so visible terrain remains collidable.
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  airValueAtWorldForCollision(x, y){
    return this.airValueAtWorld(x, y);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {Array<{x:number,y:number,air:number}>} tri
   * @returns {number}
   */
  _airValueInTri(x, y, tri){
    const a = tri[0], b = tri[1], c = tri[2];
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-6){
      const n = this.nearestNodeOnRing(x, y);
      return n ? n.air : 1;
    }
    const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
    const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
    const l3 = 1 - l1 - l2;
    return a.air * l1 + b.air * l2 + c.air * l3;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  _airValueAtWorldNoOuterClamp(x, y){
    const r = Math.hypot(x, y);
    if (r <= 1e-6){
      return this.rings[0][0].air;
    }
    const tri = this.findTriAtWorld(x, y);
    if (!tri){
      const n = this.nearestNodeOnRing(x, y);
      return n ? n.air : 1;
    }
    return this._airValueInTri(x, y, tri);
  }

  /**
   * @param {{x:number,y:number,air:number}} a
   * @param {{x:number,y:number,air:number}} b
   * @returns {string}
   */
  _edgeKeyFromVerts(a, b){
    const ia = this._vertIdOf ? this._vertIdOf.get(a) : undefined;
    const ib = this._vertIdOf ? this._vertIdOf.get(b) : undefined;
    if (ia !== undefined && ib !== undefined){
      return (ia < ib) ? `${ia}:${ib}` : `${ib}:${ia}`;
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
   * Build contour graph from exact triangle-edge crossings at a threshold.
   * Nodes are edge crossing points; edges connect crossings within each triangle.
   * @param {number} [threshold]
   * @returns {{
   *  threshold:number,
   *  nodes:Array<{x:number,y:number}>,
   *  neighbors:Array<Array<{to:number,len:number,seg:number}>>,
   *  segments:Array<{a:number,b:number,len:number,slope:number,dotUp:number,rMid:number}>
   * }}
   */
  _ensureGuideContour(threshold = 0.5){
    if (this._guideContour && !this._guideContourDirty && this._guideContour.threshold === threshold){
      return this._guideContour;
    }
    /** @type {Array<{x:number,y:number}>} */
    const nodes = [];
    /** @type {Array<Array<{to:number,len:number,seg:number}>>} */
    const neighbors = [];
    /** @type {Array<{a:number,b:number,len:number,slope:number,dotUp:number,rMid:number}>} */
    const segments = [];
    const nodeOfEdge = new Map();
    const nodeOfPoint = new Map();
    const segmentKeys = new Set();

    /**
     * @param {number} x
     * @param {number} y
     * @returns {string}
     */
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
     * @param {{x:number,y:number,air:number}} v
     * @returns {number}
     */
    const getVertexNode = (v) => {
      const vid = this._vertIdOf ? this._vertIdOf.get(v) : undefined;
      const key = (vid !== undefined) ? `v:${vid}` : pointKey(v.x, v.y);
      return getOrCreateNode(v.x, v.y, key);
    };

    /**
     * @param {{x:number,y:number,air:number}} a
     * @param {{x:number,y:number,air:number}} b
     * @returns {number}
     */
    const getCrossNode = (a, b) => {
      const edgeKey = this._edgeKeyFromVerts(a, b);
      let nodeIdx = nodeOfEdge.get(edgeKey);
      if (nodeIdx !== undefined) return nodeIdx;
      const denom = b.air - a.air;
      const t = (Math.abs(denom) > 1e-8)
        ? Math.max(0, Math.min(1, (threshold - a.air) / denom))
        : 0.5;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      nodeIdx = getOrCreateNode(x, y, `e:${edgeKey}`);
      nodeOfEdge.set(edgeKey, nodeIdx);
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
      const dot0 = n0x * ux + n0y * uy;
      const dot1 = n1x * ux + n1y * uy;
      const dotUp = Math.max(dot0, dot1);
      const slope = 1 - dotUp;
      segmentKeys.add(segKey);
      const iSeg = segments.length;
      segments.push({ a: ia, b: ib, len, slope, dotUp, rMid });
      neighbors[ia].push({ to: ib, len, seg: iSeg });
      neighbors[ib].push({ to: ia, len, seg: iSeg });
    };

    const triList = this._triList || [];
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

    // Outer-shell collision special case: outside of the outer ring is forced air.
    // Add boundary segments along outer edges that have rock support so pathing
    // can follow the same surface that collision uses near the outer rim.
    const outer = this.rings && this.rings.length ? this.rings[this.rings.length - 1] : null;
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

    this._guideContour = { threshold, nodes, neighbors, segments };
    this._guideContourDirty = false;
    return this._guideContour;
  }

  /**
   * Continuous closest point index along a polyline path.
   * @param {Array<{x:number,y:number}>} path
   * @param {number} qx
   * @param {number} qy
   * @returns {number|null}
   */
  _closestPathIndex(path, qx, qy){
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
   * Build miner guide path directly from barycentric triangle contour segments.
   * @param {number} x
   * @param {number} y
   * @param {number} maxDistance
   * @returns {{path:Array<{x:number,y:number}>, indexClosest:number}|null}
   */
  surfaceGuidePathTo(x, y, maxDistance){
    const contour = this._ensureGuideContour(0.5);
    const nodes = contour.nodes;
    const segments = contour.segments;
    const neighbors = contour.neighbors;
    if (!nodes.length || !segments.length) return null;
    const maxSlope = Math.max(0.08, Math.min(0.6, Number.isFinite(GAME.MINER_WALK_MAX_SLOPE) ? GAME.MINER_WALK_MAX_SLOPE : 0.35));
    const minDotUp = Math.max(0.2, 1 - maxSlope);
    const rAnchor = Math.hypot(x, y);
    const radialBias = 2.5;
    const preferOuter = rAnchor >= (this._R_MESH - 0.75);
    const outerBandInner = rAnchor - 0.95;
    /** @type {Uint8Array} */
    const segAllowed = new Uint8Array(segments.length);
    for (let i = 0; i < segments.length; i++){
      const s = segments[i];
      if (!(s.dotUp >= minDotUp && s.slope <= maxSlope)){
        segAllowed[i] = 0;
        continue;
      }
      if (preferOuter && s.rMid < outerBandInner){
        segAllowed[i] = 0;
        continue;
      }
      segAllowed[i] = 1;
    }

    let bestSeg = -1;
    let bestScore = Infinity;
    let bestX = 0;
    let bestY = 0;
    for (let i = 0; i < segments.length; i++){
      if (!segAllowed[i]) continue;
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
      if (score < bestScore){
        bestScore = score;
        bestSeg = i;
        bestX = px;
        bestY = py;
      }
    }
    if (bestSeg < 0) return null;
    const dAnchor = Math.hypot(bestX - x, bestY - y);
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
     * @returns {Array<{x:number,y:number}>}
     */
    const walk = (firstNode, prevNode, limit) => {
      /** @type {Array<{x:number,y:number}>} */
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

    /** @type {Array<{x:number,y:number}>} */
    const path = [];
    const pushUnique = (p) => {
      const last = path.length ? path[path.length - 1] : null;
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-4){
        path.push({ x: p.x, y: p.y });
      }
    };
    for (const p of pathRaw) pushUnique(p);
    if (path.length < 2) return null;

    const idx = this._closestPathIndex(path, x, y);
    const indexClosest = (idx !== null) ? idx : Math.max(0, Math.min(path.length - 1, path.length * 0.5));
    return { path, indexClosest };
  }

  /**
   * @param {boolean} [resampleFromMap=true]
   * @returns {Float32Array}
   */
  updateAirFlags(resampleFromMap = true){
    if (resampleFromMap){
      for (const ring of this.rings){
        for (const v of ring){
          v.air = this._sampleAirAtWorldExtended(v.x, v.y);
        }
      }
    }
    this._applyMoltenOverrides();
    this._forceOuterShellAir();
    this._cleanupOuterRimSpikeArtifacts();
    for (let i = 0; i < this.vertCount; i++){
      this.airFlag[i] = this._vertRefs[i].air;
    }
    this._guideContourDirty = true;
    return new Float32Array(this.airFlag);
  }

  /**
   * Force outer shell rings to air.
   * @returns {void}
   */
  _forceOuterShellAir(){
    if (!this.rings || !this.rings.length) return;
    const ringCount = this.rings.length;
    const forceCount = Math.max(0, Math.min(ringCount, this._OUTER_FORCED_AIR_RINGS | 0));
    if (forceCount <= 0) return;
    const start = Math.max(0, ringCount - forceCount);
    for (let r = start; r < ringCount; r++){
      const ring = this.rings[r];
      if (!ring) continue;
      for (const v of ring){
        v.air = 1;
      }
    }
  }

  /**
   * Override radial air flags for molten band/core to avoid grid aliasing.
   * @returns {void}
   */
  _applyMoltenOverrides(){
    const params = this._params;
    const moltenInner = (typeof params.MOLTEN_RING_INNER === "number") ? Math.max(0, params.MOLTEN_RING_INNER) : 0;
    const moltenOuter = (typeof params.MOLTEN_RING_OUTER === "number") ? params.MOLTEN_RING_OUTER : 0;
    if (!(moltenOuter > moltenInner)) return;
    for (let r = 0; r < this.rings.length; r++){
      const ring = this.rings[r];
      if (!ring) continue;
      const inBand = (r >= moltenInner) && (r <= moltenOuter);
      const inCore = (moltenInner > 0) && (r <= moltenInner);
      if (!inBand && !inCore) continue;
      for (const v of ring){
        if (inBand) v.air = 1;
        if (inCore) v.air = 0;
      }
    }
  }

  /**
   * Remove isolated rock spikes in the penultimate ring that have no inward support.
   * This trims likely outer-rim raster artifacts while preserving actual thin terrain.
   * @returns {void}
   */
  _cleanupOuterRimSpikeArtifacts(){
    const outer = this.rings.length - 1;
    if (outer < 2) return;
    const rim = this.rings[outer - 1];
    const inner = this.rings[outer - 2];
    if (!rim || !inner || rim.length < 3 || inner.length < 3) return;
    const wrap = (i, n) => {
      let out = i % n;
      if (out < 0) out += n;
      return out;
    };
    /**
     * @param {number} i
     * @returns {boolean}
     */
    const hasInwardSupport = (i) => {
      const v = rim[i];
      const len = Math.hypot(v.x, v.y) || 1;
      const ux = v.x / len;
      const uy = v.y / len;
      let best = 0;
      let bestDot = -2;
      for (let j = 0; j < inner.length; j++){
        const iv = inner[j];
        const ilen = Math.hypot(iv.x, iv.y) || 1;
        const dot = (iv.x / ilen) * ux + (iv.y / ilen) * uy;
        if (dot > bestDot){
          bestDot = dot;
          best = j;
        }
      }
      const jl = wrap(best - 1, inner.length);
      const jr = wrap(best + 1, inner.length);
      return (inner[best].air <= 0.5) || (inner[jl].air <= 0.5) || (inner[jr].air <= 0.5);
    };

    /** @type {number[]} */
    const clear = [];
    /** @type {boolean[]} */
    const support = new Array(rim.length).fill(false);
    for (let i = 0; i < rim.length; i++){
      support[i] = hasInwardSupport(i);
    }

    // Clear isolated unsupported spikes.
    for (let i = 0; i < rim.length; i++){
      const v = rim[i];
      if (v.air > 0.5) continue;
      const prev = rim[wrap(i - 1, rim.length)];
      const next = rim[wrap(i + 1, rim.length)];
      if (prev.air <= 0.5 || next.air <= 0.5) continue;
      if (!support[i]){
        clear.push(i);
      }
    }

    // Also clear unsupported runs bounded by air (common in outer-shell artifacts).
    /** @type {boolean[]} */
    const visited = new Array(rim.length).fill(false);
    for (let i = 0; i < rim.length; i++){
      if (visited[i]) continue;
      if (rim[i].air > 0.5 || support[i]){
        visited[i] = true;
        continue;
      }
      let lenRun = 0;
      let j = i;
      while (!visited[j] && rim[j].air <= 0.5 && !support[j]){
        visited[j] = true;
        lenRun++;
        j = wrap(j + 1, rim.length);
      }
      const start = i;
      const end = wrap(j - 1, rim.length);
      const before = rim[wrap(start - 1, rim.length)];
      const after = rim[wrap(end + 1, rim.length)];
      if (before.air > 0.5 && after.air > 0.5){
        for (let k = 0; k < lenRun; k++){
          clear.push(wrap(start + k, rim.length));
        }
      }
    }

    for (const i of clear){
      rim[i].air = 1;
    }
  }

  /**
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @param {number} step
   * @returns {boolean}
   */
  _lineOfSightMesh(ax, ay, bx, by, step){
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.hypot(dx, dy);
    if (dist <= 1e-6) return true;
    const steps = Math.max(1, Math.ceil(dist / step));
    // Check only interior samples; the endpoint can lie on/inside terrain by design.
    for (let i = 1; i < steps; i++){
      const t = i / steps;
      const x = ax + dx * t;
      const y = ay + dy * t;
      if (this.airValueAtWorld(x, y) <= this._fogLosThresh) return false;
    }
    return true;
  }

  /**
   * @param {number} ax
   * @param {number} ay
   * @param {number} bx
   * @param {number} by
   * @returns {boolean}
   */
  lineOfSight(ax, ay, bx, by){
    return this._lineOfSightMesh(ax, ay, bx, by, this._fogStep);
  }

  /**
   * Update fog visibility for mesh triangles.
   * @param {number} shipX
   * @param {number} shipY
   * @returns {void}
   */
  updateFog(shipX, shipY){
    if (this._fogCursor === 0){
      this._fogVisible.fill(0);
    }
    const r2 = this._fogRange * this._fogRange;
    const c = this._triCentroids;
    const count = this._fogVisible.length;

    /**
     * @param {number} px
     * @param {number} py
     * @returns {boolean}
     */
    const pointVisible = (px, py) => {
      const dx = px - shipX;
      const dy = py - shipY;
      if (dx * dx + dy * dy > r2) return false;
      return this._lineOfSightMesh(shipX, shipY, px, py, this._fogStep);
    };

    const budget = Math.max(1, this._fogBudgetTris | 0);
    const start = this._fogCursor;
    const end = Math.min(count, start + budget);
    const lerp = this._fogAlphaLerp;

    for (let idx = start; idx < end; idx++){
      const tri = this._triList[idx];
      const cx = c[idx * 2];
      const cy = c[idx * 2 + 1];
      const m01x = (tri[0].x + tri[1].x) * 0.5;
      const m01y = (tri[0].y + tri[1].y) * 0.5;
      const m12x = (tri[1].x + tri[2].x) * 0.5;
      const m12y = (tri[1].y + tri[2].y) * 0.5;
      const m20x = (tri[2].x + tri[0].x) * 0.5;
      const m20y = (tri[2].y + tri[0].y) * 0.5;
      const visibleNow = pointVisible(cx, cy)
        || pointVisible(tri[0].x, tri[0].y)
        || pointVisible(tri[1].x, tri[1].y)
        || pointVisible(tri[2].x, tri[2].y)
        || pointVisible(m01x, m01y)
        || pointVisible(m12x, m12y)
        || pointVisible(m20x, m20y);

      if (visibleNow){
        this._fogHold[idx] = this._fogHoldFrames;
      } else if (this._fogHold[idx] > 0){
        this._fogHold[idx]--;
      }
      if (this._fogHold[idx] > 0){
        this._fogVisible[idx] = 1;
        this._fogSeen[idx] = 1;
      }

      const base = idx * 3;
      if (this._fogVisible[idx]){
        this._fogAlpha[base] = 0;
        this._fogAlpha[base + 1] = 0;
        this._fogAlpha[base + 2] = 0;
      } else {
        const target = this._fogSeen[idx] ? this._fogSeenAlpha : this._fogUnseenAlpha;
        const a0 = this._fogAlpha[base];
        const next = a0 + (target - a0) * lerp;
        this._fogAlpha[base] = next;
        this._fogAlpha[base + 1] = next;
        this._fogAlpha[base + 2] = next;
      }
    }

    this._fogCursor = end >= count ? 0 : end;
  }

  /**
   * @returns {Float32Array|undefined}
   */
  fogAlpha(){
    if (!this._fogAlpha) return undefined;
    return this._fogAlpha;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  fogVisibleAt(x, y){
    if (!this._fogVisible || !this._triIndexOf) return true;
    const tri = this.findTriAtWorld(x, y);
    if (!tri) return true;
    const idx = this._triIndexOf.get(tri);
    if (idx === undefined) return true;
    return !!this._fogVisible[idx];
  }

  /**
   * Sample fog alpha at world position (barycentric).
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  fogAlphaAtWorld(x, y){
    if (!this._fogAlpha) return 0;
    const tri = this.findTriAtWorld(x, y);
    if (!tri) return 0;
    const idx = this._triIndexOf ? this._triIndexOf.get(tri) : undefined;
    if (idx === undefined) return 0;
    const a = tri[0], b = tri[1], c = tri[2];
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-6) return this._fogAlpha[idx * 3];
    const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
    const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
    const l3 = 1 - l1 - l2;
    const base = idx * 3;
    return this._fogAlpha[base] * l1 + this._fogAlpha[base + 1] * l2 + this._fogAlpha[base + 2] * l3;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  fogSeenAt(x, y) {
    if (!this._fogSeen || !this._triIndexOf) return true;
    const tri = this.findTriAtWorld(x, y);
    if (!tri) return true;
    const idx = this._triIndexOf.get(tri);
    if (idx === undefined) return true;
    return !!this._fogSeen[idx];
  }

  /**
   * @returns {{
   *  alpha:Float32Array,
   *  visible:Uint8Array,
   *  seen:Uint8Array,
   *  hold:Uint8Array,
   *  cursor:number
   * }}
   */
  exportFogState(){
    return {
      alpha: new Float32Array(this._fogAlpha),
      visible: new Uint8Array(this._fogVisible),
      seen: new Uint8Array(this._fogSeen),
      hold: new Uint8Array(this._fogHold),
      cursor: this._fogCursor | 0,
    };
  }

  /**
   * @param {{
   *  alpha:Float32Array,
   *  visible:Uint8Array,
   *  seen:Uint8Array,
   *  hold:Uint8Array,
   *  cursor:number
   * }|null|undefined} state
   * @returns {boolean}
   */
  importFogState(state){
    if (!state) return false;
    if (!(state.alpha instanceof Float32Array)) return false;
    if (!(state.visible instanceof Uint8Array)) return false;
    if (!(state.seen instanceof Uint8Array)) return false;
    if (!(state.hold instanceof Uint8Array)) return false;
    if (state.alpha.length !== this._fogAlpha.length) return false;
    if (state.visible.length !== this._fogVisible.length) return false;
    if (state.seen.length !== this._fogSeen.length) return false;
    if (state.hold.length !== this._fogHold.length) return false;

    this._fogAlpha.set(state.alpha);
    this._fogVisible.set(state.visible);
    this._fogSeen.set(state.seen);
    this._fogHold.set(state.hold);
    const count = this._fogVisible.length;
    const nextCursor = Math.max(0, Math.min(count, state.cursor | 0));
    this._fogCursor = (nextCursor >= count) ? 0 : nextCursor;
    return true;
  }
}
