// @ts-check

import { CFG, GAME } from "./config.js";
import * as miners from "./miners.js";

/** @typedef {{x:number,y:number,air:number}} MeshVertex */
/** @typedef {[MeshVertex, MeshVertex, MeshVertex]} MeshTri */
/** @typedef {MeshVertex[]} MeshRing */

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
      /** @type {MeshTri[]} */
      const tris=[];
      const n0=inner.length, n1=outer.length;
      const I = /** @type {MeshRing} */ (inner.concat([/** @type {MeshVertex} */ (inner[0])]));
      const O = /** @type {MeshRing} */ (outer.concat([/** @type {MeshVertex} */ (outer[0])]));
      let i=0, j=0;
      while (i<n0 || j<n1){
        if (i>=n0){
          tris.push([/** @type {MeshVertex} */ (I[i]), /** @type {MeshVertex} */ (O[j]), /** @type {MeshVertex} */ (O[j+1])]); j++; continue;
        }
        if (j>=n1){
          tris.push([/** @type {MeshVertex} */ (I[i]), /** @type {MeshVertex} */ (O[j]), /** @type {MeshVertex} */ (I[i+1])]); i++; continue;
        }
        if ((i+1)/n0 < (j+1)/n1){
          tris.push([/** @type {MeshVertex} */ (I[i]), /** @type {MeshVertex} */ (O[j]), /** @type {MeshVertex} */ (I[i+1])]); i++;
        } else {
          tris.push([/** @type {MeshVertex} */ (I[i]), /** @type {MeshVertex} */ (O[j]), /** @type {MeshVertex} */ (O[j+1])]); j++;
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
    /** @type {MeshTri[]} */
    const triList = [];
    /** @type {number[]} */
    const airFlag = [];
    /** @type {number[]} */
    const shade = [];
    /** @type {MeshVertex[]} */
    const vertRefs = [];

    /** @type {MeshRing[]} */
    const rings = [];
    /** @type {MeshTri[][]} */
    const bandTris = [];
    const rMaxInt = Math.max(0, Math.floor(params.RMAX));
    for (let r=0;r<=rMaxInt;r++) rings.push(ringVertices(r));
    this._R_MESH = rings.length - 1;
    this.rings = rings;

      for (let r = 0; r < rings.length; r++){
        const ring = /** @type {MeshRing} */ (rings[r]);
        for (const v of ring){
          v.air = this._sampleAirAtWorldExtended(v.x, v.y);
        }
      }
      this._applyMoltenOverrides();
      this._forceOuterShellAir();
      this._cleanupOuterRimSpikeArtifacts();

      for (let r=0;r<this._R_MESH;r++){
        const inner = /** @type {MeshRing} */ (rings[r]);
        const outer = /** @type {MeshRing} */ (rings[r+1]);
        if (r===0){
        /** @type {MeshTri[]} */
        const tris = [];
        const center = /** @type {MeshVertex} */ (inner[0]);
        for (let k=0;k<outer.length;k++){
          const a = center;
          const b = /** @type {MeshVertex} */ (outer[k]);
          const c = /** @type {MeshVertex} */ (outer[(k+1)%outer.length]);
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
    /** @type {MeshRing[]} */
    this.rings = rings;
    /** @type {MeshTri[][]} */
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
    this._fogAlpha.fill(this._fogUnseenAlpha);
    this._coreOverlaySeen = false;
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
    this._markOuterFogBandSeen();

    const vertIdOf = new Map();
    let vid = 0;
    for (const ring of this.rings){
      for (const v of ring){
        vertIdOf.set(v, vid++);
      }
    }
    this._vertIdOf = vertIdOf;
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
   * @returns {MeshTri|null}
   */
  findTriAtWorld(x, y){
    const r = Math.hypot(x, y);
    if (r <= 0) return null;
    const r0 = Math.floor(Math.min(this._R_MESH - 1, Math.max(0, r)));
    const bands = [r0, r0 - 1, r0 + 1];
    for (const bi of bands){
      if (bi < 0 || bi >= this._R_MESH) continue;
      const tris = /** @type {MeshTri[]} */ (this.bandTris[bi]);
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
    const ring = /** @type {MeshRing} */ (this.rings[ri]);
    if (ring.length === 0) return null;
    let best = /** @type {MeshVertex} */ (ring[0]);
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
   * Sample terrain shade at world position using the same noise field as the terrain mesh.
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  shadeAtWorld(x, y){
    const tri = this.findTriAtWorld(x, y);
    if (!tri){
      return this._shadeNoiseAtWorld(x, y);
    }
    const a = tri[0], b = tri[1], c = tri[2];
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-6){
      return this._shadeNoiseAtWorld(x, y);
    }
    const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
    const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
    const l3 = 1 - l1 - l2;
    const sa = this._shadeNoiseAtWorld(a.x, a.y);
    const sb = this._shadeNoiseAtWorld(b.x, b.y);
    const sc = this._shadeNoiseAtWorld(c.x, c.y);
    return sa * l1 + sb * l2 + sc * l3;
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
   * @param {MeshTri} tri
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
      return /** @type {MeshVertex} */ ((/** @type {MeshRing} */ (this.rings[0]))[0]).air;
    }
    const tri = this.findTriAtWorld(x, y);
    if (!tri){
      const n = this.nearestNodeOnRing(x, y);
      return n ? n.air : 1;
    }
    return this._airValueInTri(x, y, tri);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  _shadeNoiseAtWorld(x, y){
    const noise = this._map && this._map.noise;
    const n = noise && typeof noise.fbm === "function"
      ? noise.fbm(x * 0.16, y * 0.16, 2, 0.6, 2.0)
      : 0;
    return Math.max(0, Math.min(1, 0.5 + 0.5 * n));
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
    return miners.ensureSurfaceGuideContour(this, threshold);
  }

  /**
   * Continuous closest point index along a polyline path.
   * @param {Array<{x:number,y:number}>} path
   * @param {number} qx
   * @param {number} qy
   * @returns {number|null}
   */
  _closestPathIndex(path, qx, qy){
    return miners.closestPathIndex(path, qx, qy);
  }

  /**
   * Build miner guide path directly from barycentric triangle contour segments.
   * @param {number} x
   * @param {number} y
   * @param {number} maxDistance
   * @returns {{path:Array<{x:number,y:number}>, indexClosest:number}|null}
   */
  surfaceGuidePathTo(x, y, maxDistance){
    return miners.buildSurfaceGuidePath(this, x, y, maxDistance);
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
      this.airFlag[i] = /** @type {MeshVertex} */ (this._vertRefs[i]).air;
    }
    miners.invalidateSurfaceGuidePathCache(this);
    return new Float32Array(this.airFlag);
  }

  /**
   * Force outer shell rings to air.
   * @returns {void}
   */
  _forceOuterShellAir(){
    if (!this.rings.length) return;
    const ringCount = this.rings.length;
    const forceCount = Math.max(0, Math.min(ringCount, this._OUTER_FORCED_AIR_RINGS | 0));
    if (forceCount <= 0) return;
    const start = Math.max(0, ringCount - forceCount);
    for (let r = start; r < ringCount; r++){
      const ring = /** @type {MeshRing} */ (this.rings[r]);
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
      const ring = /** @type {MeshRing} */ (this.rings[r]);
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
    /**
     * @param {number} i
     * @param {number} n
     * @returns {number}
     */
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
      const v = /** @type {MeshVertex} */ (rim[i]);
      const len = Math.hypot(v.x, v.y) || 1;
      const ux = v.x / len;
      const uy = v.y / len;
      let best = 0;
      let bestDot = -2;
      for (let j = 0; j < inner.length; j++){
        const iv = /** @type {MeshVertex} */ (inner[j]);
        const ilen = Math.hypot(iv.x, iv.y) || 1;
        const dot = (iv.x / ilen) * ux + (iv.y / ilen) * uy;
        if (dot > bestDot){
          bestDot = dot;
          best = j;
        }
      }
      const jl = wrap(best - 1, inner.length);
      const jr = wrap(best + 1, inner.length);
      return (/** @type {MeshVertex} */ (inner[best])).air <= 0.5 || (/** @type {MeshVertex} */ (inner[jl])).air <= 0.5 || (/** @type {MeshVertex} */ (inner[jr])).air <= 0.5;
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
      const v = /** @type {MeshVertex} */ (rim[i]);
      if (v.air > 0.5) continue;
      const prev = /** @type {MeshVertex} */ (rim[wrap(i - 1, rim.length)]);
      const next = /** @type {MeshVertex} */ (rim[wrap(i + 1, rim.length)]);
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
      if ((/** @type {MeshVertex} */ (rim[i])).air > 0.5 || support[i]){
        visited[i] = true;
        continue;
      }
      let lenRun = 0;
      let j = i;
      while (!visited[j] && (/** @type {MeshVertex} */ (rim[j])).air <= 0.5 && !support[j]){
        visited[j] = true;
        lenRun++;
        j = wrap(j + 1, rim.length);
      }
      const start = i;
      const end = wrap(j - 1, rim.length);
      const before = /** @type {MeshVertex} */ (rim[wrap(start - 1, rim.length)]);
      const after = /** @type {MeshVertex} */ (rim[wrap(end + 1, rim.length)]);
      if (before.air > 0.5 && after.air > 0.5){
        for (let k = 0; k < lenRun; k++){
          clear.push(wrap(start + k, rim.length));
        }
      }
    }

    for (const i of clear){
      /** @type {MeshVertex} */ (rim[i]).air = 1;
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
      const tri = /** @type {MeshTri} */ (this._triList[idx]);
      const cx = /** @type {number} */ (c[idx * 2]);
      const cy = /** @type {number} */ (c[idx * 2 + 1]);
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

      const holdNow = /** @type {number} */ (this._fogHold[idx]);
      if (visibleNow){
        this._fogHold[idx] = this._fogHoldFrames;
      } else if (holdNow > 0){
        this._fogHold[idx] = holdNow - 1;
      }
      if ((/** @type {number} */ (this._fogHold[idx])) > 0){
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
        const a0 = /** @type {number} */ (this._fogAlpha[base]);
        const next = a0 + (target - a0) * lerp;
        this._fogAlpha[base] = next;
        this._fogAlpha[base + 1] = next;
        this._fogAlpha[base + 2] = next;
      }
    }

    this._fogCursor = end >= count ? 0 : end;
  }

  /**
   * Evaluate fog visibility for the full mesh in one pass.
   * @param {number} shipX
   * @param {number} shipY
   * @returns {Float32Array}
   */
  primeFog(shipX, shipY){
    if (!this._fogVisible || !this._fogVisible.length){
      return this._fogAlpha;
    }
    const start = this._fogCursor | 0;
    let first = true;
    while (first || this._fogCursor !== start){
      this.updateFog(shipX, shipY);
      first = false;
    }
    return this._fogAlpha;
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
    if (Math.abs(det) < 1e-6) return /** @type {number} */ (this._fogAlpha[idx * 3]);
    const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
    const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
    const l3 = 1 - l1 - l2;
    const base = idx * 3;
    return (/** @type {number} */ (this._fogAlpha[base])) * l1
      + (/** @type {number} */ (this._fogAlpha[base + 1])) * l2
      + (/** @type {number} */ (this._fogAlpha[base + 2])) * l3;
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
   * @param {number} coreRadius
   * @param {number} moltenOuterRadius
   * @returns {boolean}
   */
  hasSeenCoreOverlay(coreRadius, moltenOuterRadius){
    if (!(coreRadius > 0)) return false;
    if (this._coreOverlaySeen) return true;
    if (!this._fogSeen || !this._triCentroids || !this._triCentroids.length) return true;
    const baseOuter = moltenOuterRadius > coreRadius ? moltenOuterRadius : (coreRadius + 0.8);
    const revealOuterR = Math.max(coreRadius + 0.5, baseOuter + 0.5);
    const revealOuterR2 = revealOuterR * revealOuterR;
    for (let idx = 0; idx < this._fogSeen.length; idx++){
      if (!this._fogSeen[idx]) continue;
      const base = idx * 2;
      const cx = /** @type {number} */ (this._triCentroids[base]);
      const cy = /** @type {number} */ (this._triCentroids[base + 1]);
      if ((cx * cx + cy * cy) > revealOuterR2) continue;
      this._coreOverlaySeen = true;
      return true;
    }
    return false;
  }

  /**
   * Seed the outermost mesh band as explored after level generation.
   * This does not mark it currently visible.
   * @returns {void}
   */
  _markOuterFogBandSeen(){
    if (!this._triIndexOf || !this.bandTris || !this.bandTris.length) return;
    const outerBand = this.bandTris[this.bandTris.length - 1];
    if (!outerBand || !outerBand.length) return;
    for (const tri of outerBand){
      const idx = this._triIndexOf.get(tri);
      if (idx === undefined) continue;
      this._fogSeen[idx] = 1;
      const base = idx * 3;
      this._fogAlpha[base] = this._fogSeenAlpha;
      this._fogAlpha[base + 1] = this._fogSeenAlpha;
      this._fogAlpha[base + 2] = this._fogSeenAlpha;
    }
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
    this._coreOverlaySeen = false;
    const count = this._fogVisible.length;
    const nextCursor = Math.max(0, Math.min(count, state.cursor | 0));
    this._fogCursor = (nextCursor >= count) ? 0 : nextCursor;
    return true;
  }
}

