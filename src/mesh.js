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
      if (r===0) return [{x:0,y:0}];
      const n = ringCount(r);
      const phase = (0.5/n) * 2*Math.PI;
      const out=[];
      for (let k=0;k<n;k++){
        const a = 2*Math.PI*k/n + phase;
        out.push({x:r*Math.cos(a), y:r*Math.sin(a)});
      }
      return out;
    }

    /**
     * @param {{x:number,y:number}[]} inner
     * @param {{x:number,y:number}[]} outer
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
    const airFlag = [];
    /** @type {number[]} */
    const shade = [];

    /** @type {Array<{x:number,y:number}[]>} */
    const rings = [];
    /** @type {Array<Array<Array<{x:number,y:number}>>>} */
    const bandTris = [];
    for (let r=0;r<=cfg.RMAX;r++) rings.push(ringVertices(r));
    rings.push(ringVertices(cfg.RMAX + this._OUTER_PAD));

    for (let r=0;r<this._R_MESH;r++){
      const inner = rings[r];
      const outer = rings[r+1];
      if (r===0){
        for (let k=0;k<outer.length;k++){
          const a = {x:0,y:0};
          const b = outer[k];
          const c = outer[(k+1)%outer.length];
          for (const v of [a,b,c]){
            positions.push(v.x, v.y);
            airFlag.push(this._sampleAirAtWorldExtended(v.x, v.y));
            shade.push(shadeAt(v.x, v.y));
          }
        }
      } else {
        const tris = stitchBand(inner, outer);
        bandTris[r] = tris;
        for (const tri of tris){
          for (const v of tri){
            positions.push(v.x, v.y);
            airFlag.push(this._sampleAirAtWorldExtended(v.x, v.y));
            shade.push(shadeAt(v.x, v.y));
          }
        }
      }
    }

    this.vertCount = positions.length / 2;

    /** @type {Float32Array} */
    this.positions = new Float32Array(positions);
    /** @type {Float32Array} */
    this.airFlag = new Float32Array(airFlag);
    /** @type {Float32Array} */
    this.shade = new Float32Array(shade);
    /** @type {Array<{x:number,y:number}[]>} */
    this.rings = rings;
    /** @type {Array<Array<Array<{x:number,y:number}>>>} */
    this.bandTris = bandTris;
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
   * @returns {Array<{x:number,y:number}>|null}
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
   * @returns {{x:number,y:number}|null}
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
      return this._sampleAirAtWorldExtended(x, y);
    }
    const tri = this.findTriAtWorld(x, y);
    if (!tri) return this._sampleAirAtWorldExtended(x, y);
    const a = tri[0], b = tri[1], c = tri[2];
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-6) return this._sampleAirAtWorldExtended(x, y);
    const l1 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
    const l2 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
    const l3 = 1 - l1 - l2;
    const a0 = this._sampleAirAtWorldExtended(a.x, a.y);
    const a1 = this._sampleAirAtWorldExtended(b.x, b.y);
    const a2 = this._sampleAirAtWorldExtended(c.x, c.y);
    return a0 * l1 + a1 * l2 + a2 * l3;
  }

  /**
   * @returns {Float32Array}
   */
  updateAirFlags(){
    for (let i = 0; i < this.vertCount; i++){
      const x = this.positions[i * 2];
      const y = this.positions[i * 2 + 1];
      this.airFlag[i] = this._sampleAirAtWorldExtended(x, y);
    }
    return new Float32Array(this.airFlag);
  }
}
