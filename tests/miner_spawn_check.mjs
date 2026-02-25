// @ts-check

import { CFG, GAME } from "../src/config.js";
import { createMapGen } from "../src/mapgen.js";
import { buildRingMesh } from "../src/mesh.js";

const SHIP_RADIUS = 0.7 * 0.28;

function gatherMinerCandidates(mapgen, mesh, minDot, traversable){
  const { G, inside, idx, toWorld, cell } = mapgen.grid;
  const air = mapgen.getWorld().air;
  const eps = cell * 0.5;
  const candidates = [];

  for (let j = 1; j < G - 1; j++){
    for (let i = 1; i < G - 1; i++){
      const k = idx(i, j);
      if (!inside[k] || !air[k]) continue;
      if (traversable && !traversable[k]) continue;
      const [x, y] = toWorld(i, j);
      const r = Math.hypot(x, y);
      if (r < 1) continue;

      const upx = x / r;
      const upy = y / r;
      const belowX = x - upx * cell * 0.7;
      const belowY = y - upy * cell * 0.7;
      if (mesh.airValueAtWorld(belowX, belowY) > 0.5) continue;

      const aboveX = x + upx * cell * 0.4;
      const aboveY = y + upy * cell * 0.4;
      if (mesh.airValueAtWorld(aboveX, aboveY) <= 0.5) continue;

      const gdx = mesh.airValueAtWorld(x + eps, y) - mesh.airValueAtWorld(x - eps, y);
      const gdy = mesh.airValueAtWorld(x, y + eps) - mesh.airValueAtWorld(x, y - eps);
      const nlen = Math.hypot(gdx, gdy);
      if (nlen < 1e-4) continue;
      const nx = gdx / nlen;
      const ny = gdy / nlen;
      const dotUp = nx * upx + ny * upy;
      if (dotUp < minDot) continue;

      candidates.push({
        x: x + upx * GAME.MINER_STAND_OFFSET,
        y: y + upy * GAME.MINER_STAND_OFFSET,
        r,
        key: `${i},${j}`,
      });
    }
  }

  return candidates;
}

function buildTraversableMask(mapgen){
  const { G, inside, idx, toGrid, cell } = mapgen.grid;
  const air = mapgen.getWorld().air;
  const clearance = Math.max(1, Math.ceil((SHIP_RADIUS * 1.1) / cell));
  const safe = new Uint8Array(G * G);

  for (let j = 0; j < G; j++){
    for (let i = 0; i < G; i++){
      const k = idx(i, j);
      if (!inside[k] || !air[k]) continue;
      let ok = true;
      for (let dy = -clearance; dy <= clearance && ok; dy++){
        const y = j + dy;
        if (y < 0 || y >= G){ ok = false; break; }
        for (let dx = -clearance; dx <= clearance; dx++){
          const x = i + dx;
          if (x < 0 || x >= G){ ok = false; break; }
          const kk = idx(x, y);
          if (!inside[kk] || !air[kk]) { ok = false; break; }
        }
      }
      if (ok) safe[k] = 1;
    }
  }

  const entrances = mapgen.getWorld().entrances;
  if (!entrances || !entrances.length) return null;

  const vis = new Uint8Array(G * G);
  const qx = new Int32Array(G * G);
  const qy = new Int32Array(G * G);
  let qh = 0, qt = 0;
  const seedPad = Math.max(1, Math.min(3, clearance + 1));

  for (const [ex, ey] of entrances){
    const [ix, iy] = toGrid(ex * 0.97, ey * 0.97);
    for (let dy = -seedPad; dy <= seedPad; dy++){
      for (let dx = -seedPad; dx <= seedPad; dx++){
        const x = ix + dx;
        const y = iy + dy;
        if (x < 0 || x >= G || y < 0 || y >= G) continue;
        const k = idx(x, y);
        if (!inside[k] || !safe[k] || vis[k]) continue;
        vis[k] = 1;
        qx[qt] = x; qy[qt] = y; qt++;
      }
    }
  }

  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (qh < qt){
    const x = qx[qh], y = qy[qh]; qh++;
    for (const [dx, dy] of dirs){
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || xx >= G || yy < 0 || yy >= G) continue;
      const kk = idx(xx, yy);
      if (!inside[kk] || !safe[kk] || vis[kk]) continue;
      vis[kk] = 1;
      qx[qt] = xx; qy[qt] = yy; qt++;
    }
  }

  if (qt === 0) return null;
  return vis;
}

function dedupeCandidates(candidates){
  if (candidates.length <= 1) return candidates;
  const seen = new Set();
  const out = [];
  for (const c of candidates){
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    out.push(c);
  }
  return out;
}

const samples = Number(process.argv[2] || 200);
const baseSeed = Number(process.argv[3] || CFG.seed);

const mapgen = createMapGen(CFG);
const count = GAME.MINERS_PER_LEVEL;
const minDots = [GAME.SURFACE_DOT + 0.1, GAME.SURFACE_DOT, GAME.SURFACE_DOT - 0.1];

let short = 0;
let minCount = Infinity;
let maxCount = -Infinity;
const shortSeeds = [];

for (let s = 0; s < samples; s++){
  const seed = baseSeed + s;
  mapgen.regenWorld(seed);
  const mesh = buildRingMesh(CFG, mapgen);
  const traversable = buildTraversableMask(mapgen);

  let candidates = [];
  for (const minDot of minDots){
    candidates = gatherMinerCandidates(mapgen, mesh, minDot, traversable);
    candidates = dedupeCandidates(candidates);
    if (candidates.length >= count * 3) break;
  }
  if (candidates.length < count){
    for (const minDot of minDots){
      candidates = gatherMinerCandidates(mapgen, mesh, minDot, null);
      candidates = dedupeCandidates(candidates);
      if (candidates.length >= count * 3) break;
    }
  }

  const n = candidates.length;
  minCount = Math.min(minCount, n);
  maxCount = Math.max(maxCount, n);
  if (n < count){
    short++;
    if (shortSeeds.length < 10) shortSeeds.push(seed);
  }
}

console.log(`samples=${samples} baseSeed=${baseSeed} target=${count}`);
console.log(`minCandidates=${minCount} maxCandidates=${maxCount}`);
console.log(`shortCount=${short}`);
if (shortSeeds.length){
  console.log(`exampleShortSeeds=${shortSeeds.join(",")}`);
}
