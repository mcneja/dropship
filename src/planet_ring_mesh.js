// @ts-check

export class RingMesh {
  /**
   * Build mesh geometry and sampling helpers from a map source.
   * @param {typeof import("./config.js").CFG} cfg Mesh config constants.
   * @param {import("./mapgen.js").MapGen} map Map generator.
   */
  constructor(cfg, map){
    this._cfg = cfg;
    this._map = map;
    this._OUTER_PAD = 1.0;
    this._R_MESH = cfg.RMAX + this._OUTER_PAD;

    /**
     * @param {number} r
     */
    function ringCount(r){
      if (r<=0) return 1;
      return Math.max(cfg.N_MIN, Math.floor(2*Math.PI*r));
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
        out.push({x:r*Math.cos(a), y:r*Math.sin(a), air:1});
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
    for (let r=0;r<=cfg.RMAX;r++) rings.push(ringVertices(r));
    rings.push(ringVertices(cfg.RMAX + this._OUTER_PAD));

    for (const ring of rings){
      for (const v of ring){
        v.air = this._sampleAirAtWorldExtended(v.x, v.y);
      }
    }

    for (let r=0;r<this._R_MESH;r++){
      const inner = rings[r];
      const outer = rings[r+1];
      if (r===0){
        const tris = [];
        for (let k=0;k<outer.length;k++){
          const a = {x:0,y:0,air:1};
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

    this._fogRange = 0;
    this._fogStep = 0.25;
    this._fogSeenAlpha = 0.55;
    this._fogUnseenAlpha = 0.85;
    this._fogHoldFrames = 4;
    this._fogLosThresh = 0.45;
    this._fogAlphaLerp = 0.2;
    this._fogAlpha = null;
    this._fogVisible = null;
    this._fogSeen = null;
    this._triIndexOf = null;
    this._fogHold = null;
    this._fogCursor = 0;
    this._fogBudgetTris = 200;
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
    if (r > this._cfg.RMAX) return 1;
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
    const ri = Math.max(0, Math.min(this._cfg.RMAX, Math.round(r)));
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
    if (r > this._cfg.RMAX + this._OUTER_PAD) return 1;
    const r0 = Math.floor(Math.min(this._R_MESH - 1, Math.max(0, r)));
    if (r0 <= 0){
      return this.rings[0][0].air;
    }
    const tri = this.findTriAtWorld(x, y);
    if (!tri) return this.nearestNodeOnRing(x, y).air;
    const a = tri[0], b = tri[1], c = tri[2];
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-6) return this.nearestNodeOnRing(x, y).air;
    const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
    const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
    const l3 = 1 - l1 - l2;
    const a0 = a.air;
    const a1 = b.air;
    const a2 = c.air;
    return a0 * l1 + a1 * l2 + a2 * l3;
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
    for (let i = 0; i < this.vertCount; i++){
      this.airFlag[i] = this._vertRefs[i].air;
    }
    return new Float32Array(this.airFlag);
  }

  /**
   * Initialize fog buffers tied to the mesh triangles.
   * @param {{VIS_RANGE:number,VIS_STEP:number,FOG_SEEN_ALPHA:number,FOG_UNSEEN_ALPHA:number,FOG_HOLD_FRAMES:number,FOG_LOS_THRESH?:number,FOG_ALPHA_LERP?:number,FOG_BUDGET_TRIS?:number}} game
   * @returns {void}
   */
  initFog(game){
    this._fogRange = game.VIS_RANGE;
    this._fogStep = game.VIS_STEP;
    this._fogSeenAlpha = game.FOG_SEEN_ALPHA;
    this._fogUnseenAlpha = game.FOG_UNSEEN_ALPHA;
    this._fogHoldFrames = game.FOG_HOLD_FRAMES;
    this._fogLosThresh = game.FOG_LOS_THRESH ?? 0.45;
    this._fogAlphaLerp = game.FOG_ALPHA_LERP ?? 0.2;
    this._fogBudgetTris = game.FOG_BUDGET_TRIS ?? 200;
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
  }

  /**
   * @returns {void}
   */
  resetFog(){
    if (!this._fogVisible || !this._fogSeen || !this._fogAlpha || !this._fogHold) return;
    this._fogVisible.fill(0);
    this._fogSeen.fill(0);
    this._fogHold.fill(0);
    this._fogAlpha.fill(this._fogUnseenAlpha);
    this._fogCursor = 0;
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
    for (let i = 1; i <= steps; i++){
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
    if (!this._fogVisible || !this._fogSeen || !this._triCentroids || !this._fogAlpha || !this._fogHold || !this._triList) return;
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
}
