// @ts-check

/**
 * @typedef {{x:number,y:number,air:number}} MothershipPoint
 */

const SQRT3_OVER_2 = Math.sqrt(3) / 2;

const SHIPMAP = [
  "###XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX#",
  "##XXXXXX000000000000000XX0000000000000XX##",
  "#XX000XX0000000000000000XX00000000000XX###",
  "#XX0000XX000000000000000000000000000XX####",
  "##XX0000XX0000000000000000000000000000XX##",
  "###XX0000XX0000000000000000XX0000000000XX#",
  "####XXXXXXXXXXXXXXXXXXXXXXXXXX0000000000XX",
];

/**
 * Triangle tiling: column step is s/2, row step is s*sqrt(3)/2.
 * Parity (col+row) even = up, odd = down.
 * @param {number} col
 * @param {number} parityCol
 * @param {number} row
 * @param {number} s
 * @returns {[{x:number,y:number},{x:number,y:number},{x:number,y:number}]}
 */
function triangleVerticesForCell(col, parityCol, row, s){
  const h = s * SQRT3_OVER_2;
  const x0 = col * (s / 2);
  const y0 = row * h;
  const up = ((parityCol + row) & 1) === 1;
  if (up){
    return [
      { x: x0,       y: y0 + h },
      { x: x0 + s/2, y: y0     },
      { x: x0 + s,   y: y0 + h },
    ];
  }
  return [
    { x: x0,       y: y0     },
    { x: x0 + s,   y: y0     },
    { x: x0 + s/2, y: y0 + h },
  ];
}

/**
 * @param {typeof import("./config.js").CFG} cfg
 * @param {import("./planet.js").Planet} planet
 * @returns {Mothership}
 */
export class Mothership {
  /**
   * @param {typeof import("./config.js").CFG} cfg
   * @param {import("./planet.js").Planet} planet
   * @param {string[]} [shipMap]
   */
  constructor(cfg, planet, shipMap){
    const map = (shipMap && shipMap.length) ? shipMap : SHIPMAP;
    const rows = map.length;
    const cols = Math.max(0, ...map.map((row) => row.length));
    const spacing = 0.8;
    this.scale = 0.5;
    /** @type {MothershipPoint[]} */
    const points = [];
    /** @type {Array<[number, number, number]>} */
    const tris = [];
    /** @type {number[]} */
    const triAir = [];
    const vertAirSum = [];
    const vertAirCount = [];
    /** @type {Map<string, number>} */
    const vertIndex = new Map();

    const keyOf = (x, y) => `${x.toFixed(5)},${y.toFixed(5)}`;
    for (let row = 0; row < rows; row++){
      for (let col = 0; col < cols; col++){
      const rowMask = map[row];
      const colMask = rowMask ? (rowMask.length - 1 - col) : -1;
      const ch = (rowMask && colMask >= 0 && colMask < rowMask.length) ? rowMask[colMask] : "O";
      if (ch === "#" || ch === " ") continue;
      const air = (ch === "X" || ch === "x") ? 0 : 1;
      const parityCol = (colMask >= 0) ? colMask : col;
      const verts = triangleVerticesForCell(col, parityCol, row, spacing * this.scale);
        const triIdx = [];
        for (const v of verts){
          const key = keyOf(v.x, v.y);
          let idx = vertIndex.get(key);
          if (idx == null){
            idx = points.length;
            points.push({ x: v.x, y: v.y, air: 1 });
            vertAirSum.push(0);
            vertAirCount.push(0);
            vertIndex.set(key, idx);
          }
          vertAirSum[idx] += air;
          vertAirCount[idx] += 1;
          triIdx.push(idx);
        }
        tris.push([triIdx[0], triIdx[1], triIdx[2]]);
        triAir.push(air);
      }
    }

    // Center mesh and finalize per-vertex air.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points){
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const cx = (minX + maxX) * 0.5;
    const cy = (minY + maxY) * 0.5;
    let maxR2 = 0;
    for (let i = 0; i < points.length; i++){
      const p = points[i];
      p.x -= cx;
      p.y -= cy;
      const count = vertAirCount[i] || 1;
      p.air = vertAirSum[i] / count;
      const r2 = p.x * p.x + p.y * p.y;
      if (r2 > maxR2) maxR2 = r2;
    }

    const orbitRadius = cfg.RMAX + 15;
    const mu = planet.gravitationalConstant;
    const speed = Math.sqrt(mu / orbitRadius);

    this.x = orbitRadius;
    this.y = 0;
    this.vx = 0;
    this.vy = speed;
    this.angle = Math.PI / 2;
    this.spacing = spacing * this.scale;
    this.bounds = Math.sqrt(maxR2) + (spacing * this.scale);
    this.rows = rows;
    this.cols = cols;
    this.points = points;
    this.tris = tris;
    this.triAir = triAir;
    this.renderPoints = points;
    this.renderTris = tris;
  }
}

/**
 * @param {Mothership} mothership
 * @param {import("./planet.js").Planet} planet
 * @param {number} dt
 * @returns {void}
 */
export function updateMothership(mothership, planet, dt){
  const { x: gx, y: gy } = planet.gravityAt(mothership.x, mothership.y);
  mothership.x += (mothership.vx + 0.5 * gx * dt) * dt;
  mothership.y += (mothership.vy + 0.5 * gy * dt) * dt;
  const { x: gx2, y: gy2 } = planet.gravityAt(mothership.x, mothership.y);
  mothership.vx += 0.5 * (gx + gx2) * dt;
  mothership.vy += 0.5 * (gy + gy2) * dt;
  mothership.angle = Math.atan2(mothership.vy, mothership.vx || 1e-6);
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
function pointInTri(px, py, ax, ay, bx, by, cx, cy){
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
 * @param {Mothership} mothership
 * @param {number} lx
 * @param {number} ly
 * @returns {number|null}
 */
function mothershipAirAtLocal(mothership, lx, ly){
  const points = mothership.points;
  const tris = mothership.tris;
  for (let i = 0; i < tris.length; i++){
    const tri = tris[i];
    const a = points[tri[0]];
    const b = points[tri[1]];
    const c = points[tri[2]];
    if (!pointInTri(lx, ly, a.x, a.y, b.x, b.y, c.x, c.y)) continue;
    return mothership.triAir ? mothership.triAir[i] : 1;
  }
  return null;
}

/**
 * @param {Mothership} mothership
 * @param {number} x
 * @param {number} y
 * @returns {number|null}
 */
export function mothershipAirAtWorld(mothership, x, y){
  const dx = x - mothership.x;
  const dy = y - mothership.y;
  if (dx * dx + dy * dy > mothership.bounds * mothership.bounds) return null;
  const c = Math.cos(-mothership.angle);
  const s = Math.sin(-mothership.angle);
  const lx = c * dx - s * dy;
  const ly = s * dx + c * dy;
  return mothershipAirAtLocal(mothership, lx, ly);
}

/**
 * @param {Mothership} mothership
 * @param {number} x
 * @param {number} y
 * @returns {{nx:number,ny:number,isFloor:boolean}|null}
 */
/**
 * @param {Mothership|null} mothership
 * @param {number} x
 * @param {number} y
 * @returns {{air:number, source:"mothership"}|null}
 */
export function mothershipCollisionSample(mothership, x, y){
  if (!mothership) return null;
  const v = mothershipAirAtWorld(mothership, x, y);
  if (v === null) return null;
  return { air: v, source: "mothership" };
}

export function mothershipCollisionInfo(mothership, x, y){
  const dx = x - mothership.x;
  const dy = y - mothership.y;
  if (dx * dx + dy * dy > mothership.bounds * mothership.bounds) return null;
  const c = Math.cos(-mothership.angle);
  const s = Math.sin(-mothership.angle);
  const lx = c * dx - s * dy;
  const ly = s * dx + c * dy;
  const points = mothership.points;
  const tris = mothership.tris;
  let triHit = null;
  for (let i = 0; i < tris.length; i++){
    const tri = tris[i];
    const a = points[tri[0]];
    const b = points[tri[1]];
    const cpt = points[tri[2]];
    if (pointInTri(lx, ly, a.x, a.y, b.x, b.y, cpt.x, cpt.y)){
      triHit = [a, b, cpt];
      break;
    }
  }
  if (!triHit) return null;
  const [a, b, cpt] = triHit;
  const edges = [
    [a, b],
    [b, cpt],
    [cpt, a],
  ];
  let bestD = 1e9;
  let bestN = null;
  const eps = mothership.spacing * 0.1;
  for (const [p0, p1] of edges){
    const dx0 = p1.x - p0.x;
    const dy0 = p1.y - p0.y;
    const denom = dx0 * dx0 + dy0 * dy0 || 1;
    const t = Math.max(0, Math.min(1, ((lx - p0.x) * dx0 + (ly - p0.y) * dy0) / denom));
    const ex = p0.x + dx0 * t;
    const ey = p0.y + dy0 * t;
    const ddx = lx - ex;
    const ddy = ly - ey;
    const d2 = ddx * ddx + ddy * ddy;
    if (d2 < bestD){
      bestD = d2;
      // Candidate normal (perp to edge)
      let nx = -dy0;
      let ny = dx0;
      const nlen = Math.hypot(nx, ny) || 1;
      nx /= nlen;
      ny /= nlen;
      // Choose normal that points toward air.
      const airPos = mothershipAirAtLocal(mothership, lx + nx * eps, ly + ny * eps);
      const airNeg = mothershipAirAtLocal(mothership, lx - nx * eps, ly - ny * eps);
      const airPosV = (airPos === null) ? 1 : airPos;
      const airNegV = (airNeg === null) ? 1 : airNeg;
      if (airNegV > airPosV){
        nx = -nx;
        ny = -ny;
      }
      bestN = [nx, ny];
    }
  }
  if (!bestN) return null;
  let nx = bestN[0];
  let ny = bestN[1];
  const c2 = Math.cos(mothership.angle);
  const s2 = Math.sin(mothership.angle);
  const nxw = c2 * nx - s2 * ny;
  const nyw = s2 * nx + c2 * ny;
  return { nx: nxw, ny: nyw, isFloor: false };
}
