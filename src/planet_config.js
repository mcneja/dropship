// @ts-check

/**
 * Planet configuration presets and deterministic per-level sampling.
 * This file is standalone by design (no imports).
 */

/**
 * @typedef {"no_caves"|"molten"|"ice"|"gaia"|"water"|"cavern"|"mechanized"} PlanetTypeId
 */

/**
 * @typedef {{min:number, max:number}} Range
 */

/**
 * @typedef {Object} PlanetConfigRanges
 * @property {Range} RMAX
 * @property {Range} PAD
 * @property {Range} MOTHERSHIP_ORBIT_HEIGHT
 * @property {Range} SURFACE_G
 * @property {Range} DRAG_MULT
 * @property {Range} THRUST_MULT
 * @property {Range} TURN_RATE_MULT
 * @property {Range} LAND_FRICTION_MULT
 * @property {Range} CRASH_SPEED_MULT
 * @property {Range} LAND_SPEED_MULT
 * @property {Range} TARGET_FINAL_AIR
 * @property {Range} CA_STEPS
 * @property {Range} AIR_KEEP_N8
 * @property {Range} ROCK_TO_AIR_N8
 * @property {Range} ENTRANCES
 * @property {Range} ENTRANCE_OUTER
 * @property {Range} ENTRANCE_INNER
 * @property {Range} WARP_F
 * @property {Range} WARP_A
 * @property {Range} BASE_F
 * @property {Range} VEIN_F
 * @property {Range} VEIN_THRESH
 * @property {Range} VEIN_DILATE
 * @property {Range} VIS_RANGE
 * @property {Range} FOG_SEEN_ALPHA
 * @property {Range} FOG_UNSEEN_ALPHA
 * @property {Range} FOG_BUDGET_TRIS
 * @property {Range} CORE_RADIUS
 * @property {Range} CORE_DPS
 * @property {Range} ICE_CRUST_THICKNESS
 * @property {Range} WATER_LEVEL
 */

/**
 * @typedef {Object} PlanetConfig
 * @property {PlanetTypeId} id
 * @property {string} label
 * @property {PlanetConfigRanges} ranges
 * @property {Array<"hunter"|"ranger"|"crawler"|"turret"|"orbitingTurret">} enemyAllow
 * @property {string} [notes]
 * @property {Record<string, number>} [defaults]
 */

/**
 * Default/moderate range helpers
 * @param {number} min
 * @param {number} max
 * @returns {Range}
 */
function r(min, max){ return { min, max }; }

/**
 * @type {PlanetConfig[]}
 */
export const PLANET_CONFIGS = [
  {
    id: "no_caves",
    label: "Barren Ridge",
    enemyAllow: ["hunter", "ranger", "crawler"],
    notes: "Solid interior; entrances only. Emphasize surface play.",
    ranges: {
      RMAX: r(16, 22),
      PAD: r(1.0, 1.6),
      MOTHERSHIP_ORBIT_HEIGHT: r(12, 20),
      SURFACE_G: r(1.8, 2.6),
      DRAG_MULT: r(0.9, 1.2),
      THRUST_MULT: r(0.9, 1.15),
      TURN_RATE_MULT: r(0.9, 1.15),
      LAND_FRICTION_MULT: r(0.8, 1.2),
      CRASH_SPEED_MULT: r(0.9, 1.1),
      LAND_SPEED_MULT: r(0.9, 1.1),
      TARGET_FINAL_AIR: r(0.12, 0.22),
      CA_STEPS: r(1, 2),
      AIR_KEEP_N8: r(3, 4),
      ROCK_TO_AIR_N8: r(6, 7),
      ENTRANCES: r(1, 3),
      ENTRANCE_OUTER: r(0.55, 0.75),
      ENTRANCE_INNER: r(0.38, 0.60),
      WARP_F: r(0.035, 0.055),
      WARP_A: r(1.4, 2.0),
      BASE_F: r(0.09, 0.12),
      VEIN_F: r(0.12, 0.16),
      VEIN_THRESH: r(0.80, 0.90),
      VEIN_DILATE: r(1, 2),
      VIS_RANGE: r(6.2, 7.8),
      FOG_SEEN_ALPHA: r(0.50, 0.62),
      FOG_UNSEEN_ALPHA: r(0.80, 0.90),
      FOG_BUDGET_TRIS: r(220, 360),
      CORE_RADIUS: r(0.15, 0.25),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
    },
  },
  {
    id: "molten",
    label: "Molten Core",
    enemyAllow: ["hunter", "ranger", "crawler", "turret"],
    notes: "Heat hazard in inner radius.",
    ranges: {
      RMAX: r(14, 21),
      PAD: r(1.0, 1.5),
      MOTHERSHIP_ORBIT_HEIGHT: r(11, 19),
      SURFACE_G: r(2.0, 2.8),
      DRAG_MULT: r(0.9, 1.2),
      THRUST_MULT: r(0.9, 1.1),
      TURN_RATE_MULT: r(0.9, 1.1),
      LAND_FRICTION_MULT: r(0.9, 1.1),
      CRASH_SPEED_MULT: r(0.9, 1.1),
      LAND_SPEED_MULT: r(0.9, 1.1),
      TARGET_FINAL_AIR: r(0.42, 0.56),
      CA_STEPS: r(2, 4),
      AIR_KEEP_N8: r(3, 4),
      ROCK_TO_AIR_N8: r(6, 7),
      ENTRANCES: r(2, 4),
      ENTRANCE_OUTER: r(0.65, 0.80),
      ENTRANCE_INNER: r(0.48, 0.65),
      WARP_F: r(0.045, 0.070),
      WARP_A: r(1.6, 2.4),
      BASE_F: r(0.11, 0.15),
      VEIN_F: r(0.16, 0.20),
      VEIN_THRESH: r(0.74, 0.84),
      VEIN_DILATE: r(1, 2),
      VIS_RANGE: r(6.0, 7.5),
      FOG_SEEN_ALPHA: r(0.52, 0.60),
      FOG_UNSEEN_ALPHA: r(0.82, 0.90),
      FOG_BUDGET_TRIS: r(240, 380),
      CORE_RADIUS: r(0.28, 0.42),
      CORE_DPS: r(0.4, 1.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
    },
  },
  {
    id: "ice",
    label: "Ice World",
    enemyAllow: ["hunter", "ranger", "crawler"],
    notes: "Slippery landings; icy crust.",
    ranges: {
      RMAX: r(15, 23),
      PAD: r(1.0, 1.7),
      MOTHERSHIP_ORBIT_HEIGHT: r(12, 20),
      SURFACE_G: r(1.6, 2.3),
      DRAG_MULT: r(0.9, 1.1),
      THRUST_MULT: r(0.95, 1.15),
      TURN_RATE_MULT: r(0.95, 1.15),
      LAND_FRICTION_MULT: r(0.35, 0.70),
      CRASH_SPEED_MULT: r(0.9, 1.1),
      LAND_SPEED_MULT: r(0.85, 1.05),
      TARGET_FINAL_AIR: r(0.45, 0.62),
      CA_STEPS: r(2, 4),
      AIR_KEEP_N8: r(3, 4),
      ROCK_TO_AIR_N8: r(6, 7),
      ENTRANCES: r(2, 4),
      ENTRANCE_OUTER: r(0.60, 0.80),
      ENTRANCE_INNER: r(0.44, 0.62),
      WARP_F: r(0.040, 0.060),
      WARP_A: r(1.5, 2.3),
      BASE_F: r(0.10, 0.14),
      VEIN_F: r(0.14, 0.18),
      VEIN_THRESH: r(0.78, 0.88),
      VEIN_DILATE: r(1, 2),
      VIS_RANGE: r(6.5, 8.2),
      FOG_SEEN_ALPHA: r(0.50, 0.58),
      FOG_UNSEEN_ALPHA: r(0.80, 0.88),
      FOG_BUDGET_TRIS: r(220, 360),
      CORE_RADIUS: r(0.12, 0.20),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.18, 0.32),
      WATER_LEVEL: r(0.0, 0.0),
    },
  },
  {
    id: "gaia",
    label: "Gaia",
    enemyAllow: ["hunter", "ranger", "crawler", "orbitingTurret"],
    notes: "Lush surface; slightly denser interior.",
    ranges: {
      RMAX: r(16, 22),
      PAD: r(1.0, 1.5),
      MOTHERSHIP_ORBIT_HEIGHT: r(12, 18),
      SURFACE_G: r(1.8, 2.4),
      DRAG_MULT: r(0.95, 1.25),
      THRUST_MULT: r(0.95, 1.10),
      TURN_RATE_MULT: r(0.95, 1.10),
      LAND_FRICTION_MULT: r(0.8, 1.2),
      CRASH_SPEED_MULT: r(0.9, 1.1),
      LAND_SPEED_MULT: r(0.9, 1.1),
      TARGET_FINAL_AIR: r(0.40, 0.55),
      CA_STEPS: r(3, 4),
      AIR_KEEP_N8: r(3, 4),
      ROCK_TO_AIR_N8: r(6, 7),
      ENTRANCES: r(2, 4),
      ENTRANCE_OUTER: r(0.65, 0.80),
      ENTRANCE_INNER: r(0.48, 0.65),
      WARP_F: r(0.050, 0.070),
      WARP_A: r(1.7, 2.6),
      BASE_F: r(0.11, 0.15),
      VEIN_F: r(0.14, 0.18),
      VEIN_THRESH: r(0.76, 0.86),
      VEIN_DILATE: r(1, 2),
      VIS_RANGE: r(6.2, 7.8),
      FOG_SEEN_ALPHA: r(0.50, 0.60),
      FOG_UNSEEN_ALPHA: r(0.80, 0.90),
      FOG_BUDGET_TRIS: r(220, 360),
      CORE_RADIUS: r(0.12, 0.20),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
    },
  },
  {
    id: "water",
    label: "Water World",
    enemyAllow: ["hunter", "ranger", "crawler"],
    notes: "Viscous atmosphere; water level for air material.",
    ranges: {
      RMAX: r(15, 22),
      PAD: r(1.1, 1.8),
      MOTHERSHIP_ORBIT_HEIGHT: r(12, 20),
      SURFACE_G: r(1.7, 2.4),
      DRAG_MULT: r(1.3, 1.9),
      THRUST_MULT: r(0.95, 1.10),
      TURN_RATE_MULT: r(0.95, 1.10),
      LAND_FRICTION_MULT: r(0.8, 1.1),
      CRASH_SPEED_MULT: r(0.9, 1.1),
      LAND_SPEED_MULT: r(0.9, 1.1),
      TARGET_FINAL_AIR: r(0.48, 0.65),
      CA_STEPS: r(2, 4),
      AIR_KEEP_N8: r(3, 4),
      ROCK_TO_AIR_N8: r(6, 7),
      ENTRANCES: r(2, 4),
      ENTRANCE_OUTER: r(0.60, 0.80),
      ENTRANCE_INNER: r(0.44, 0.62),
      WARP_F: r(0.040, 0.065),
      WARP_A: r(1.6, 2.4),
      BASE_F: r(0.11, 0.15),
      VEIN_F: r(0.14, 0.19),
      VEIN_THRESH: r(0.75, 0.86),
      VEIN_DILATE: r(1, 2),
      VIS_RANGE: r(5.8, 7.2),
      FOG_SEEN_ALPHA: r(0.55, 0.65),
      FOG_UNSEEN_ALPHA: r(0.85, 0.95),
      FOG_BUDGET_TRIS: r(220, 360),
      CORE_RADIUS: r(0.12, 0.20),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.20, 0.45),
    },
  },
  {
    id: "cavern",
    label: "Cavern",
    enemyAllow: ["hunter", "ranger", "crawler", "turret"],
    notes: "Baseline cave world.",
    ranges: {
      RMAX: r(16, 20),
      PAD: r(1.0, 1.4),
      MOTHERSHIP_ORBIT_HEIGHT: r(12, 17),
      SURFACE_G: r(1.9, 2.4),
      DRAG_MULT: r(0.95, 1.15),
      THRUST_MULT: r(0.95, 1.10),
      TURN_RATE_MULT: r(0.95, 1.10),
      LAND_FRICTION_MULT: r(0.8, 1.2),
      CRASH_SPEED_MULT: r(0.9, 1.1),
      LAND_SPEED_MULT: r(0.9, 1.1),
      TARGET_FINAL_AIR: r(0.45, 0.55),
      CA_STEPS: r(3, 4),
      AIR_KEEP_N8: r(3, 4),
      ROCK_TO_AIR_N8: r(6, 7),
      ENTRANCES: r(3, 4),
      ENTRANCE_OUTER: r(0.65, 0.75),
      ENTRANCE_INNER: r(0.50, 0.60),
      WARP_F: r(0.050, 0.065),
      WARP_A: r(1.8, 2.4),
      BASE_F: r(0.12, 0.14),
      VEIN_F: r(0.16, 0.18),
      VEIN_THRESH: r(0.77, 0.83),
      VEIN_DILATE: r(1, 2),
      VIS_RANGE: r(6.3, 7.6),
      FOG_SEEN_ALPHA: r(0.52, 0.60),
      FOG_UNSEEN_ALPHA: r(0.82, 0.90),
      FOG_BUDGET_TRIS: r(240, 360),
      CORE_RADIUS: r(0.12, 0.20),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
    },
  },
  {
    id: "mechanized",
    label: "Mechanized",
    enemyAllow: ["hunter", "ranger", "turret", "orbitingTurret"],
    notes: "Industrial look; tighter corridors.",
    ranges: {
      RMAX: r(15, 21),
      PAD: r(1.0, 1.4),
      MOTHERSHIP_ORBIT_HEIGHT: r(12, 18),
      SURFACE_G: r(2.0, 2.6),
      DRAG_MULT: r(0.9, 1.1),
      THRUST_MULT: r(0.95, 1.05),
      TURN_RATE_MULT: r(0.9, 1.05),
      LAND_FRICTION_MULT: r(0.8, 1.1),
      CRASH_SPEED_MULT: r(0.9, 1.1),
      LAND_SPEED_MULT: r(0.9, 1.1),
      TARGET_FINAL_AIR: r(0.40, 0.52),
      CA_STEPS: r(2, 3),
      AIR_KEEP_N8: r(3, 4),
      ROCK_TO_AIR_N8: r(6, 7),
      ENTRANCES: r(2, 4),
      ENTRANCE_OUTER: r(0.62, 0.78),
      ENTRANCE_INNER: r(0.46, 0.64),
      WARP_F: r(0.035, 0.055),
      WARP_A: r(1.2, 2.0),
      BASE_F: r(0.10, 0.13),
      VEIN_F: r(0.18, 0.24),
      VEIN_THRESH: r(0.80, 0.90),
      VEIN_DILATE: r(1, 2),
      VIS_RANGE: r(6.0, 7.2),
      FOG_SEEN_ALPHA: r(0.52, 0.60),
      FOG_UNSEEN_ALPHA: r(0.84, 0.92),
      FOG_BUDGET_TRIS: r(240, 380),
      CORE_RADIUS: r(0.12, 0.20),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
    },
  },
];

/**
 * Local RNG: Mulberry32
 * @param {number} a
 * @returns {() => number}
 */
function mulberry32(a){
  let t = a >>> 0;
  return function(){
    t += 0x6D2B79F5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Simple integer hash for seed+level+type index.
 * @param {number} x
 * @returns {number}
 */
function hash32(x){
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Pick a planet config deterministically from seed + level.
 * @param {number} seed
 * @param {number} level
 * @returns {PlanetConfig}
 */
export function pickPlanetConfig(seed, level){
  const lvl = Math.max(1, level | 0);
  const base = (seed | 0) + lvl * 9973;
  const idx = hash32(base) % PLANET_CONFIGS.length;
  return PLANET_CONFIGS[idx];
}

/**
 * Roll a per-level config sample from a planet config.
 * @param {number} seed
 * @param {number} level
 * @param {PlanetConfig} cfg
 * @returns {Record<string, number>}
 */
export function rollPlanetConfig(seed, level, cfg){
  const lvl = Math.max(1, level | 0);
  const base = (seed | 0) + lvl * 977 + hash32(cfg.id.length * 131 + cfg.label.length * 17);
  const rand = mulberry32(base);
  /** @type {Record<string, number>} */
  const out = {};
  for (const [key, range] of Object.entries(cfg.ranges)){
    const v = range.min + (range.max - range.min) * rand();
    out[key] = v;
  }
  // Integer fields
  for (const k of ["CA_STEPS", "AIR_KEEP_N8", "ROCK_TO_AIR_N8", "ENTRANCES", "VEIN_DILATE", "FOG_BUDGET_TRIS"]){
    if (k in out) out[k] = Math.round(out[k]);
  }
  return out;
}

/**
 * Clamp a rolled config to conservative safety bounds.
 * @param {Record<string, number>} sample
 * @returns {Record<string, number>}
 */
export function clampPlanetConfig(sample){
  /** @type {Record<string, [number, number]>} */
  const limits = {
    RMAX: [8, 26],
    PAD: [0.8, 2.0],
    MOTHERSHIP_ORBIT_HEIGHT: [8, 26],
    SURFACE_G: [1.2, 3.2],
    DRAG_MULT: [0.7, 2.0],
    THRUST_MULT: [0.7, 1.4],
    TURN_RATE_MULT: [0.7, 1.4],
    LAND_FRICTION_MULT: [0.2, 1.6],
    CRASH_SPEED_MULT: [0.6, 1.5],
    LAND_SPEED_MULT: [0.6, 1.5],
    TARGET_FINAL_AIR: [0.08, 0.75],
    CA_STEPS: [1, 6],
    AIR_KEEP_N8: [2, 5],
    ROCK_TO_AIR_N8: [5, 8],
    ENTRANCES: [1, 6],
    ENTRANCE_OUTER: [0.40, 0.90],
    ENTRANCE_INNER: [0.25, 0.80],
    WARP_F: [0.02, 0.09],
    WARP_A: [0.8, 3.0],
    BASE_F: [0.06, 0.20],
    VEIN_F: [0.08, 0.26],
    VEIN_THRESH: [0.65, 0.95],
    VEIN_DILATE: [1, 3],
    VIS_RANGE: [4.5, 9.0],
    FOG_SEEN_ALPHA: [0.35, 0.70],
    FOG_UNSEEN_ALPHA: [0.65, 0.98],
    FOG_BUDGET_TRIS: [120, 450],
    CORE_RADIUS: [0.0, 0.5],
    CORE_DPS: [0.0, 3.0],
    ICE_CRUST_THICKNESS: [0.0, 0.6],
    WATER_LEVEL: [0.0, 0.8],
  };

  /** @type {Record<string, number>} */
  const out = { ...sample };
  for (const [key, [lo, hi]] of Object.entries(limits)){
    if (!(key in out)) continue;
    const v = out[key];
    out[key] = Math.max(lo, Math.min(hi, v));
  }

  if ("ENTRANCE_OUTER" in out && "ENTRANCE_INNER" in out){
    if (out.ENTRANCE_INNER >= out.ENTRANCE_OUTER){
      out.ENTRANCE_INNER = Math.max(0.25, out.ENTRANCE_OUTER - 0.12);
    }
  }

  if ("ENTRANCES" in out){
    out.ENTRANCES = Math.max(1, Math.round(out.ENTRANCES));
  }

  return out;
}

// Example usage:
// const type = pickPlanetConfig(seed, level);
// const rolled = clampPlanetConfig(rollPlanetConfig(seed, level, type));

