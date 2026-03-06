// @ts-check

/**
 * Planet configuration presets and deterministic per-level sampling.
 * This file is standalone by design (no imports).
 */

/**
 * @typedef {"no_caves"|"molten"|"ice"|"gaia"|"water"|"cavern"|"mechanized"|"barren_pickup"|"barren_clear"} PlanetTypeId
 */

/**
 * @typedef {"uniform"|"random"|"clusters"} EnemyPlacement
 */

/**
 * @typedef {Object} PlanetObjective
 * @property {"clear"|"extract"|"find"|"deploy"|"deploy_and_extract"} type
 * @property {number} count
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
 * @property {Range} MOLTEN_RING_INNER
 * @property {Range} MOLTEN_RING_OUTER
 * @property {Range} EXCAVATE_RINGS
 * @property {Range} EXCAVATE_RING_THICKNESS
 * @property {Range} TOPO_BAND
 * @property {Range} TOPO_AMP
 * @property {Range} TOPO_FREQ
 * @property {Range} TOPO_OCTAVES
 */

/**
 * @typedef {Object} PlanetConfig
 * @property {PlanetTypeId} id
 * @property {string} label
 * @property {PlanetConfigRanges} ranges
 * @property {number} enemyCountBase
 * @property {number} enemyCountPerLevel
 * @property {number} enemyCountCap
 * @property {EnemyPlacement} enemyPlacement
 * @property {PlanetObjective} objective
 * @property {number} minerCountBase
 * @property {number} minerCountPerLevel
 * @property {number} minerCountCap
 * @property {number} platformCount
 * @property {Array<"hunter"|"ranger"|"crawler"|"turret"|"orbitingTurret">} enemyAllow
 * @property {string} [notes]
 * @property {PlanetConfigDefaults} [defaults]
 * @property {{noCaves?:boolean,barrenPerimeter?:boolean}} [flags]
 */

/**
 * @typedef {Object} PlanetConfigDefaults
 * @property {[number, number, number]} ROCK_DARK
 * @property {[number, number, number]} ROCK_LIGHT
 * @property {[number, number, number]} AIR_DARK
 * @property {[number, number, number]} AIR_LIGHT
 * @property {[number, number, number]} SURFACE_ROCK_DARK
 * @property {[number, number, number]} SURFACE_ROCK_LIGHT
 * @property {number} SURFACE_BAND
 */

/**
 * @typedef {Object} PlanetParams
  * @property {number} RMAX
 * @property {number} PAD
 * @property {number} MOTHERSHIP_ORBIT_HEIGHT
 * @property {number} SURFACE_G
 * @property {number} TARGET_FINAL_AIR
 * @property {number} CA_STEPS
 * @property {number} AIR_KEEP_N8
 * @property {number} ROCK_TO_AIR_N8
 * @property {number} ENTRANCES
 * @property {number} ENTRANCE_OUTER
 * @property {number} ENTRANCE_INNER
 * @property {number} WARP_F
 * @property {number} WARP_A
 * @property {number} BASE_F
 * @property {number} VEIN_F
 * @property {number} VEIN_THRESH
 * @property {number} VEIN_DILATE
 * @property {number} VIS_RANGE
 * @property {number} FOG_SEEN_ALPHA
 * @property {number} FOG_UNSEEN_ALPHA
 * @property {number} FOG_BUDGET_TRIS
 * @property {number} CORE_RADIUS
 * @property {number} CORE_DPS
 * @property {number} ICE_CRUST_THICKNESS
 * @property {number} WATER_LEVEL
 * @property {number} MOLTEN_RING_INNER
 * @property {number} MOLTEN_RING_OUTER
 * @property {number} EXCAVATE_RINGS
 * @property {number} EXCAVATE_RING_THICKNESS
 * @property {number} TOPO_BAND
 * @property {number} TOPO_AMP
 * @property {number} TOPO_FREQ
 * @property {number} TOPO_OCTAVES
 * @property {number} DRAG
 * @property {number} THRUST
 * @property {number} TURN_RATE
 * @property {number} LAND_FRICTION
 * @property {number} CRASH_SPEED
 * @property {number} LAND_SPEED
 * @property {boolean} NO_CAVES
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
    id: "barren_pickup",
    label: "Barren Perimeter",
    enemyCountBase: 0,
    enemyCountPerLevel: 0,
    enemyCountCap: 0,
    enemyPlacement: "uniform",
    objective: { type: "extract", count: 5 },
    minerCountBase: 5,
    minerCountPerLevel: 0,
    minerCountCap: 5,
    platformCount: 5,
    enemyAllow: [],
    notes: "Solid interior, external topography only, miner pickup.",
    flags: { noCaves: true, barrenPerimeter: true },
    defaults: {
      ROCK_DARK: [0.20, 0.20, 0.22],
      ROCK_LIGHT: [0.46, 0.46, 0.50],
      AIR_DARK: [0.14, 0.14, 0.16],
      AIR_LIGHT: [0.26, 0.26, 0.30],
      SURFACE_ROCK_DARK: [0.24, 0.24, 0.26],
      SURFACE_ROCK_LIGHT: [0.60, 0.60, 0.66],
      SURFACE_BAND: 0.12,
    },
    ranges: {
      RMAX: r(10, 12),
      PAD: r(1.0, 1.4),
      MOTHERSHIP_ORBIT_HEIGHT: r(8, 12),
      SURFACE_G: r(1.6, 2.2),
      DRAG_MULT: r(0.9, 1.1),
      THRUST_MULT: r(0.95, 1.1),
      TURN_RATE_MULT: r(0.95, 1.1),
      LAND_FRICTION_MULT: r(0.7, 1.0),
      CRASH_SPEED_MULT: r(0.9, 1.1),
      LAND_SPEED_MULT: r(0.9, 1.1),
      TARGET_FINAL_AIR: r(0.0, 0.0),
      CA_STEPS: r(1, 1),
      AIR_KEEP_N8: r(3, 3),
      ROCK_TO_AIR_N8: r(6, 6),
      ENTRANCES: r(0, 0),
      ENTRANCE_OUTER: r(0.0, 0.0),
      ENTRANCE_INNER: r(0.0, 0.0),
      WARP_F: r(0.0, 0.0),
      WARP_A: r(0.0, 0.0),
      BASE_F: r(0.0, 0.0),
      VEIN_F: r(0.0, 0.0),
      VEIN_THRESH: r(0.0, 0.0),
      VEIN_DILATE: r(0, 0),
      VIS_RANGE: r(6.0, 7.5),
      FOG_SEEN_ALPHA: r(0.50, 0.60),
      FOG_UNSEEN_ALPHA: r(0.80, 0.90),
      FOG_BUDGET_TRIS: r(220, 320),
      CORE_RADIUS: r(0.0, 0.0),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
      MOLTEN_RING_INNER: r(0.0, 0.0),
      MOLTEN_RING_OUTER: r(0.0, 0.0),
      EXCAVATE_RINGS: r(0, 0),
      EXCAVATE_RING_THICKNESS: r(0.0, 0.0),
      TOPO_BAND: r(2.0, 2.6),
      TOPO_AMP: r(1.2, 1.6),
      TOPO_FREQ: r(2.6, 3.2),
      TOPO_OCTAVES: r(3, 4),
    },
  },
  {
    id: "barren_clear",
    label: "Ominous Rock",
    enemyCountBase: 5,
    enemyCountPerLevel: 0,
    enemyCountCap: 5,
    enemyPlacement: "uniform",
    objective: { type: "clear", count: 5 },
    minerCountBase: 5,
    minerCountPerLevel: 0,
    minerCountCap: 5,
    platformCount: 10,
    enemyAllow: ["turret"],
    notes: "Solid interior, external topography only, clear turrets; optional miner rescue.",
    flags: { noCaves: true, barrenPerimeter: true },
    defaults: {
      ROCK_DARK: [0.20, 0.20, 0.22],
      ROCK_LIGHT: [0.46, 0.46, 0.50],
      AIR_DARK: [0.14, 0.14, 0.16],
      AIR_LIGHT: [0.26, 0.26, 0.30],
      SURFACE_ROCK_DARK: [0.24, 0.24, 0.26],
      SURFACE_ROCK_LIGHT: [0.60, 0.60, 0.66],
      SURFACE_BAND: 0.12,
    },
    ranges: {
      RMAX: r(10, 12),
      PAD: r(1.0, 1.4),
      MOTHERSHIP_ORBIT_HEIGHT: r(8, 12),
      SURFACE_G: r(1.6, 2.2),
      DRAG_MULT: r(0.9, 1.1),
      THRUST_MULT: r(0.95, 1.1),
      TURN_RATE_MULT: r(0.95, 1.1),
      LAND_FRICTION_MULT: r(0.7, 1.0),
      CRASH_SPEED_MULT: r(0.9, 1.1),
      LAND_SPEED_MULT: r(0.9, 1.1),
      TARGET_FINAL_AIR: r(0.0, 0.0),
      CA_STEPS: r(1, 1),
      AIR_KEEP_N8: r(3, 3),
      ROCK_TO_AIR_N8: r(6, 6),
      ENTRANCES: r(0, 0),
      ENTRANCE_OUTER: r(0.0, 0.0),
      ENTRANCE_INNER: r(0.0, 0.0),
      WARP_F: r(0.0, 0.0),
      WARP_A: r(0.0, 0.0),
      BASE_F: r(0.0, 0.0),
      VEIN_F: r(0.0, 0.0),
      VEIN_THRESH: r(0.0, 0.0),
      VEIN_DILATE: r(0, 0),
      VIS_RANGE: r(6.0, 7.5),
      FOG_SEEN_ALPHA: r(0.50, 0.60),
      FOG_UNSEEN_ALPHA: r(0.80, 0.90),
      FOG_BUDGET_TRIS: r(220, 320),
      CORE_RADIUS: r(0.0, 0.0),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
      MOLTEN_RING_INNER: r(0.0, 0.0),
      MOLTEN_RING_OUTER: r(0.0, 0.0),
      EXCAVATE_RINGS: r(0, 0),
      EXCAVATE_RING_THICKNESS: r(0.0, 0.0),
      TOPO_BAND: r(2.8, 4.0),
      TOPO_AMP: r(1.8, 2.6),
      TOPO_FREQ: r(2.9, 3.6),
      TOPO_OCTAVES: r(4, 5),
    },
  },
  {
    id: "no_caves",
    label: "Barren Ridge",
    enemyCountBase: 5,
    enemyCountPerLevel: 5,
    enemyCountCap: 30,
    enemyPlacement: "random",
    objective: { type: "extract", count: 0 },
    minerCountBase: 5,
    minerCountPerLevel: 2,
    minerCountCap: 30,
    platformCount: 10,
    enemyAllow: ["hunter", "ranger", "crawler"],
    notes: "Solid interior; entrances only. Emphasize surface play.",
    defaults: {
      ROCK_DARK: [0.40, 0.26, 0.16],
      ROCK_LIGHT: [0.62, 0.42, 0.26],
      AIR_DARK: [0.16, 0.16, 0.16],
      AIR_LIGHT: [0.30, 0.30, 0.30],
      SURFACE_ROCK_DARK: [0.45, 0.32, 0.20],
      SURFACE_ROCK_LIGHT: [0.70, 0.52, 0.32],
      SURFACE_BAND: 0.10,
    },
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
      CORE_RADIUS: r(0.0, 0.0),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
      MOLTEN_RING_INNER: r(0.0, 0.0),
      MOLTEN_RING_OUTER: r(0.0, 0.0),
      EXCAVATE_RINGS: r(0, 0),
      EXCAVATE_RING_THICKNESS: r(0.0, 0.0),
      TOPO_BAND: r(2.8, 4.0),
      TOPO_AMP: r(1.8, 2.6),
      TOPO_FREQ: r(2.9, 3.6),
      TOPO_OCTAVES: r(4, 5),
    },
  },
  {
    id: "molten",
    label: "Molten Core",
    enemyCountBase: 5,
    enemyCountPerLevel: 5,
    enemyCountCap: 30,
    enemyPlacement: "random",
    objective: { type: "extract", count: 0 },
    minerCountBase: 5,
    minerCountPerLevel: 2,
    minerCountCap: 30,
    platformCount: 12,
    enemyAllow: ["hunter", "ranger", "crawler", "turret"],
    notes: "Heat hazard in inner radius.",
    defaults: {
      ROCK_DARK: [0.38, 0.12, 0.10],
      ROCK_LIGHT: [0.78, 0.26, 0.18],
      AIR_DARK: [0.20, 0.14, 0.16],
      AIR_LIGHT: [0.38, 0.22, 0.26],
      SURFACE_ROCK_DARK: [0.24, 0.10, 0.10],
      SURFACE_ROCK_LIGHT: [0.44, 0.18, 0.16],
      SURFACE_BAND: 0.08,
    },
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
      CORE_RADIUS: r(8, 8),
      CORE_DPS: r(0.4, 1.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
      MOLTEN_RING_INNER: r(6, 6),
      MOLTEN_RING_OUTER: r(8, 8),
      EXCAVATE_RINGS: r(0, 0),
      EXCAVATE_RING_THICKNESS: r(0.0, 0.0),
      TOPO_BAND: r(2.8, 4.0),
      TOPO_AMP: r(1.8, 2.6),
      TOPO_FREQ: r(2.9, 3.6),
      TOPO_OCTAVES: r(4, 5),
    },
  },
  {
    id: "ice",
    label: "Ice World",
    enemyCountBase: 5,
    enemyCountPerLevel: 5,
    enemyCountCap: 30,
    enemyPlacement: "random",
    objective: { type: "extract", count: 0 },
    minerCountBase: 5,
    minerCountPerLevel: 2,
    minerCountCap: 30,
    platformCount: 10,
    enemyAllow: ["hunter", "ranger", "crawler"],
    notes: "Slippery landings; icy crust.",
    defaults: {
      ROCK_DARK: [0.32, 0.40, 0.55],
      ROCK_LIGHT: [0.68, 0.80, 0.92],
      AIR_DARK: [0.18, 0.24, 0.30],
      AIR_LIGHT: [0.40, 0.52, 0.62],
      SURFACE_ROCK_DARK: [0.55, 0.70, 0.86],
      SURFACE_ROCK_LIGHT: [0.82, 0.92, 0.98],
      SURFACE_BAND: 0.12,
    },
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
      CORE_RADIUS: r(0.0, 0.0),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.18, 0.32),
      WATER_LEVEL: r(0.0, 0.0),
      MOLTEN_RING_INNER: r(0.0, 0.0),
      MOLTEN_RING_OUTER: r(0.0, 0.0),
      EXCAVATE_RINGS: r(0, 0),
      EXCAVATE_RING_THICKNESS: r(0.0, 0.0),
      TOPO_BAND: r(2.8, 4.0),
      TOPO_AMP: r(1.8, 2.6),
      TOPO_FREQ: r(2.9, 3.6),
      TOPO_OCTAVES: r(4, 5),
    },
  },
  {
    id: "gaia",
    label: "Gaia",
    enemyCountBase: 5,
    enemyCountPerLevel: 5,
    enemyCountCap: 30,
    enemyPlacement: "random",
    objective: { type: "extract", count: 0 },
    minerCountBase: 5,
    minerCountPerLevel: 2,
    minerCountCap: 30,
    platformCount: 10,
    enemyAllow: ["hunter", "ranger", "crawler", "orbitingTurret"],
    notes: "Lush surface; slightly denser interior.",
    defaults: {
      ROCK_DARK: [0.30, 0.20, 0.12],
      ROCK_LIGHT: [0.52, 0.34, 0.20],
      AIR_DARK: [0.17, 0.22, 0.18],
      AIR_LIGHT: [0.38, 0.50, 0.40],
      SURFACE_ROCK_DARK: [0.08, 0.30, 0.12],
      SURFACE_ROCK_LIGHT: [0.18, 0.55, 0.22],
      SURFACE_BAND: 0.12,
    },
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
      CORE_RADIUS: r(0.0, 0.0),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
      MOLTEN_RING_INNER: r(0.0, 0.0),
      MOLTEN_RING_OUTER: r(0.0, 0.0),
      EXCAVATE_RINGS: r(0, 0),
      EXCAVATE_RING_THICKNESS: r(0.0, 0.0),
      TOPO_BAND: r(2.8, 4.0),
      TOPO_AMP: r(1.8, 2.6),
      TOPO_FREQ: r(2.9, 3.6),
      TOPO_OCTAVES: r(4, 5),
    },
  },
  {
    id: "water",
    label: "Water World",
    enemyCountBase: 5,
    enemyCountPerLevel: 5,
    enemyCountCap: 30,
    enemyPlacement: "random",
    objective: { type: "extract", count: 0 },
    minerCountBase: 5,
    minerCountPerLevel: 2,
    minerCountCap: 30,
    platformCount: 10,
    enemyAllow: ["hunter", "ranger", "crawler"],
    notes: "Viscous atmosphere; water level for air material.",
    defaults: {
      ROCK_DARK: [0.20, 0.18, 0.16],
      ROCK_LIGHT: [0.40, 0.36, 0.30],
      AIR_DARK: [0.10, 0.16, 0.20],
      AIR_LIGHT: [0.22, 0.38, 0.44],
      SURFACE_ROCK_DARK: [0.14, 0.22, 0.24],
      SURFACE_ROCK_LIGHT: [0.28, 0.40, 0.44],
      SURFACE_BAND: 0.10,
    },
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
      CORE_RADIUS: r(0.0, 0.0),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.20, 0.45),
      MOLTEN_RING_INNER: r(0.0, 0.0),
      MOLTEN_RING_OUTER: r(0.0, 0.0),
      EXCAVATE_RINGS: r(0, 0),
      EXCAVATE_RING_THICKNESS: r(0.0, 0.0),
      TOPO_BAND: r(2.8, 4.0),
      TOPO_AMP: r(1.8, 2.6),
      TOPO_FREQ: r(2.9, 3.6),
      TOPO_OCTAVES: r(4, 5),
    },
  },
  {
    id: "cavern",
    label: "Cavern",
    enemyCountBase: 5,
    enemyCountPerLevel: 5,
    enemyCountCap: 30,
    enemyPlacement: "random",
    objective: { type: "extract", count: 0 },
    minerCountBase: 5,
    minerCountPerLevel: 2,
    minerCountCap: 30,
    platformCount: 10,
    enemyAllow: ["hunter", "ranger", "crawler", "turret"],
    notes: "Baseline cave world.",
    defaults: {
      ROCK_DARK: [0.3725, 0.2275, 0.125],
      ROCK_LIGHT: [0.541, 0.337, 0.192],
      AIR_DARK: [0.1686, 0.1686, 0.1686],
      AIR_LIGHT: [0.290, 0.290, 0.290],
      SURFACE_ROCK_DARK: [0.40, 0.28, 0.18],
      SURFACE_ROCK_LIGHT: [0.62, 0.44, 0.28],
      SURFACE_BAND: 0.08,
    },
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
      CORE_RADIUS: r(0.0, 0.0),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
      MOLTEN_RING_INNER: r(0.0, 0.0),
      MOLTEN_RING_OUTER: r(0.0, 0.0),
      EXCAVATE_RINGS: r(0, 0),
      EXCAVATE_RING_THICKNESS: r(0.0, 0.0),
      TOPO_BAND: r(2.8, 4.0),
      TOPO_AMP: r(1.8, 2.6),
      TOPO_FREQ: r(2.9, 3.6),
      TOPO_OCTAVES: r(4, 5),
    },
  },
  {
    id: "mechanized",
    label: "Mechanized",
    enemyCountBase: 5,
    enemyCountPerLevel: 5,
    enemyCountCap: 30,
    enemyPlacement: "random",
    objective: { type: "extract", count: 0 },
    minerCountBase: 5,
    minerCountPerLevel: 2,
    minerCountCap: 30,
    platformCount: 10,
    enemyAllow: ["hunter", "ranger", "turret", "orbitingTurret"],
    notes: "Industrial look; tighter corridors.",
    defaults: {
      ROCK_DARK: [0.20, 0.20, 0.22],
      ROCK_LIGHT: [0.45, 0.45, 0.50],
      AIR_DARK: [0.16, 0.18, 0.20],
      AIR_LIGHT: [0.32, 0.36, 0.40],
      SURFACE_ROCK_DARK: [0.26, 0.28, 0.30],
      SURFACE_ROCK_LIGHT: [0.55, 0.58, 0.62],
      SURFACE_BAND: 0.08,
    },
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
      CORE_RADIUS: r(0.0, 0.0),
      CORE_DPS: r(0.0, 0.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
      MOLTEN_RING_INNER: r(0.0, 0.0),
      MOLTEN_RING_OUTER: r(0.0, 0.0),
      EXCAVATE_RINGS: r(0, 0),
      EXCAVATE_RING_THICKNESS: r(0.0, 0.0),
      TOPO_BAND: r(2.8, 4.0),
      TOPO_AMP: r(1.8, 2.6),
      TOPO_FREQ: r(2.9, 3.6),
      TOPO_OCTAVES: r(4, 5),
    },
  },
];

/**
 * @param {PlanetTypeId} id
 * @returns {PlanetConfig}
 */
export function pickPlanetConfigById(id){
  for (const cfg of PLANET_CONFIGS){
    if (cfg.id === id) return cfg;
  }
  return PLANET_CONFIGS[0];
}

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
  for (const k of ["CA_STEPS", "AIR_KEEP_N8", "ROCK_TO_AIR_N8", "ENTRANCES", "VEIN_DILATE", "FOG_BUDGET_TRIS", "EXCAVATE_RINGS", "TOPO_OCTAVES"]){
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
    ENTRANCES: [0, 6],
    ENTRANCE_OUTER: [0.0, 0.90],
    ENTRANCE_INNER: [0.0, 0.80],
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
    CORE_RADIUS: [0.0, 10.0],
    CORE_DPS: [0.0, 3.0],
    ICE_CRUST_THICKNESS: [0.0, 0.6],
    WATER_LEVEL: [0.0, 0.8],
    MOLTEN_RING_INNER: [0.0, 12.0],
    MOLTEN_RING_OUTER: [0.0, 16.0],
    EXCAVATE_RINGS: [0, 8],
    EXCAVATE_RING_THICKNESS: [0.0, 1.2],
    TOPO_BAND: [0.0, 6.0],
    TOPO_AMP: [0.0, 4.0],
    TOPO_FREQ: [0.5, 4.5],
    TOPO_OCTAVES: [1, 6],
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
    out.ENTRANCES = Math.max(0, Math.round(out.ENTRANCES));
  }

  return out;
}

/**
 * Resolve a flat, authoritative parameter set for a level.
 * Values are derived from planetConfig ranges and rolled per seed+level.
 * @param {number} seed
 * @param {number} level
 * @param {PlanetConfig} cfg
 * @param {typeof import("./config.js").GAME} baseGame
 * @returns {PlanetParams}
 */
export function resolvePlanetParams(seed, level, cfg, baseGame){
  const roll = clampPlanetConfig(rollPlanetConfig(seed, level, cfg));
  // PlanetParams fields are the authoritative set used at runtime:
  // Geometry: RMAX, PAD, MOTHERSHIP_ORBIT_HEIGHT
  // Gravity: SURFACE_G
  // Mapgen: TARGET_FINAL_AIR, CA_STEPS, AIR_KEEP_N8, ROCK_TO_AIR_N8, ENTRANCES, ENTRANCE_OUTER, ENTRANCE_INNER,
  //         WARP_F, WARP_A, BASE_F, VEIN_F, VEIN_THRESH, VEIN_DILATE
  // Visibility: VIS_RANGE, FOG_SEEN_ALPHA, FOG_UNSEEN_ALPHA, FOG_BUDGET_TRIS
  // Gameplay: DRAG, THRUST, TURN_RATE, LAND_FRICTION, CRASH_SPEED, LAND_SPEED
  return {
    RMAX: roll.RMAX,
    PAD: roll.PAD,
    MOTHERSHIP_ORBIT_HEIGHT: roll.MOTHERSHIP_ORBIT_HEIGHT,
    SURFACE_G: roll.SURFACE_G,
    TARGET_FINAL_AIR: roll.TARGET_FINAL_AIR,
    CA_STEPS: roll.CA_STEPS,
    AIR_KEEP_N8: roll.AIR_KEEP_N8,
    ROCK_TO_AIR_N8: roll.ROCK_TO_AIR_N8,
    ENTRANCES: roll.ENTRANCES,
    ENTRANCE_OUTER: roll.ENTRANCE_OUTER,
    ENTRANCE_INNER: roll.ENTRANCE_INNER,
    WARP_F: roll.WARP_F,
    WARP_A: roll.WARP_A,
    BASE_F: roll.BASE_F,
    VEIN_F: roll.VEIN_F,
    VEIN_THRESH: roll.VEIN_THRESH,
    VEIN_DILATE: roll.VEIN_DILATE,
    VIS_RANGE: roll.VIS_RANGE,
    FOG_SEEN_ALPHA: roll.FOG_SEEN_ALPHA,
    FOG_UNSEEN_ALPHA: roll.FOG_UNSEEN_ALPHA,
    FOG_BUDGET_TRIS: roll.FOG_BUDGET_TRIS,
    CORE_RADIUS: roll.CORE_RADIUS ?? 0,
    CORE_DPS: roll.CORE_DPS ?? 0,
    ICE_CRUST_THICKNESS: roll.ICE_CRUST_THICKNESS ?? 0,
    WATER_LEVEL: roll.WATER_LEVEL ?? 0,
      MOLTEN_RING_INNER: roll.MOLTEN_RING_INNER ?? 0,
      MOLTEN_RING_OUTER: roll.MOLTEN_RING_OUTER ?? 0,
      EXCAVATE_RINGS: roll.EXCAVATE_RINGS ?? 0,
      EXCAVATE_RING_THICKNESS: roll.EXCAVATE_RING_THICKNESS ?? 0,
      TOPO_BAND: roll.TOPO_BAND ?? 0,
      TOPO_AMP: roll.TOPO_AMP ?? 0,
      TOPO_FREQ: roll.TOPO_FREQ ?? 0,
      TOPO_OCTAVES: roll.TOPO_OCTAVES ?? 0,
    DRAG: baseGame.DRAG * roll.DRAG_MULT,
    THRUST: baseGame.THRUST * roll.THRUST_MULT,
    TURN_RATE: baseGame.TURN_RATE * roll.TURN_RATE_MULT,
    LAND_FRICTION: baseGame.LAND_FRICTION * roll.LAND_FRICTION_MULT,
    CRASH_SPEED: baseGame.CRASH_SPEED * roll.CRASH_SPEED_MULT,
    LAND_SPEED: baseGame.LAND_SPEED * roll.LAND_SPEED_MULT,
    NO_CAVES: !!(cfg.flags && cfg.flags.noCaves),
  };
}

// Example usage:
// const type = pickPlanetConfig(seed, level);
// const rolled = clampPlanetConfig(rollPlanetConfig(seed, level, type));
