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
 * @typedef {"hunter"|"ranger"|"crawler"|"turret"|"orbitingTurret"} EnemyTypeId
 */

/**
 * @typedef {Object} PlanetObjective
 * @property {"clear"|"extract"|"find"|"deploy"|"deploy_and_extract"|"destroy_core"|"destroy_factories"} type
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
 * @property {Range} ATMOSPHERE_DRAG_MULT
 * @property {Range} [ATMOSPHERE_HEIGHT]
 * @property {Range} [ROCK_AIR_MIN]
 * @property {Range} [ROCK_AIR_MAX]
 * @property {Range} DRAG_MULT
 * @property {Range} THRUST_MULT
 * @property {Range} TURN_RATE_MULT
 * @property {Range} LAND_FRICTION_MULT
 * @property {Range} [WALL_FRICTION_MULT]
 * @property {Range} [BOUNCE_RESTITUTION]
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
 * @property {EnemyTypeId[]} enemyAllow
 * @property {number} [orbitingTurretCount]
 * @property {number} [factorySpawnCooldownMin]
 * @property {number} [factorySpawnCooldownMax]
 * @property {string} [notes]
 * @property {PlanetConfigDefaults} [defaults]
 * @property {{noCaves?:boolean,barrenPerimeter?:boolean,disableTerrainDestruction?:boolean}} [flags]
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
 * @property {{inner:[number,number,number,number], outer:[number,number,number,number], ringCount:number, ringOffset:number}} [ATMOSPHERE]
 */

/**
 * @typedef {Object} PlanetParams
 * @property {number} RMAX
 * @property {number} PAD
 * @property {number} MOTHERSHIP_ORBIT_HEIGHT
 * @property {number} SURFACE_G
 * @property {number} ATMOSPHERE_DRAG
 * @property {number} ATMOSPHERE_HEIGHT
 * @property {number} ROCK_AIR_MIN
 * @property {number} ROCK_AIR_MAX
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
 * @property {number} MOLTEN_VENT_COUNT
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
 * @property {number} WALL_FRICTION
 * @property {number} BOUNCE_RESTITUTION
 * @property {number} CRASH_SPEED
 * @property {number} LAND_SPEED
 * @property {boolean} NO_CAVES
 */

/**
 * @typedef {PlanetParams & {
 *   ATMOSPHERE_DRAG_MULT?: number,
 *   ATMOSPHERE_HEIGHT?: number,
 *   ROCK_AIR_MIN?: number,
 *   ROCK_AIR_MAX?: number,
 *   DRAG_MULT: number,
 *   THRUST_MULT: number,
 *   TURN_RATE_MULT: number,
 *   LAND_FRICTION_MULT: number,
 *   WALL_FRICTION_MULT?: number,
 *   BOUNCE_RESTITUTION?: number,
 *   CRASH_SPEED_MULT: number,
 *   LAND_SPEED_MULT: number
 * }} PlanetRoll
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
    label: "Deadrock Frontier",
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
    notes: "A shell-world of knife ridges and clean vacuum. Touch down, grab the stranded crew, and burn back to orbit.",
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
      ATMOSPHERE_DRAG_MULT: r(1.0, 1.0),
      DRAG_MULT: r(0.9, 1.1),
      THRUST_MULT: r(0.95, 1.1),
      TURN_RATE_MULT: r(0.95, 1.1),
      LAND_FRICTION_MULT: r(0.7, 1.0),
      WALL_FRICTION_MULT: r(0.8, 1.1),
      BOUNCE_RESTITUTION: r(0.12, 0.22),
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
      TOPO_BAND: r(0.5, 1.6),
      TOPO_AMP: r(0.2, 1.7),
      TOPO_FREQ: r(2.0, 3.2),
      TOPO_OCTAVES: r(3, 4),
    },
  },
  {
    id: "barren_clear",
    label: "Turret Grave",
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
    notes: "A hard gray shell bristling with old gun nests. Sweep the emplacements and snatch any survivors you can.",
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
      ATMOSPHERE_DRAG_MULT: r(1.0, 1.0),
      DRAG_MULT: r(0.9, 1.1),
      THRUST_MULT: r(0.95, 1.1),
      TURN_RATE_MULT: r(0.95, 1.1),
      LAND_FRICTION_MULT: r(0.7, 1.0),
      WALL_FRICTION_MULT: r(0.8, 1.1),
      BOUNCE_RESTITUTION: r(0.12, 0.22),
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
    label: "Thunder Mesa",
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
    notes: "All badlands, no tunnels. Fast passes, brutal slopes, and nowhere to hide when the shooting starts.",
    flags: { noCaves: true },
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
      ATMOSPHERE_DRAG_MULT: r(1.0, 1.0),
      DRAG_MULT: r(0.9, 1.2),
      THRUST_MULT: r(0.9, 1.15),
      TURN_RATE_MULT: r(0.9, 1.15),
      LAND_FRICTION_MULT: r(0.8, 1.2),
      WALL_FRICTION_MULT: r(0.7, 1.0),
      BOUNCE_RESTITUTION: r(0.24, 0.36),
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
      TOPO_BAND: r(3.2, 4.8),
      TOPO_AMP: r(2.2, 3.4),
      TOPO_FREQ: r(1.1, 1.8),
      TOPO_OCTAVES: r(3, 4),
    },
  },
  {
    id: "molten",
    label: "Hellforge",
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
    notes: "The planet's heart is an open furnace. Skim the crust, dodge the heat, and never linger near the glow.",
    flags: { disableTerrainDestruction: true },
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
      ATMOSPHERE_DRAG_MULT: r(1.0, 1.0),
      DRAG_MULT: r(0.9, 1.2),
      THRUST_MULT: r(0.9, 1.1),
      TURN_RATE_MULT: r(0.9, 1.1),
      LAND_FRICTION_MULT: r(0.9, 1.1),
      WALL_FRICTION_MULT: r(0.45, 0.7),
      BOUNCE_RESTITUTION: r(0.32, 0.48),
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
      CORE_RADIUS: r(5, 5),
      CORE_DPS: r(0.4, 1.0),
      ICE_CRUST_THICKNESS: r(0.0, 0.0),
      WATER_LEVEL: r(0.0, 0.0),
      MOLTEN_RING_INNER: r(5.0, 5.0),
      MOLTEN_RING_OUTER: r(7.0, 7.0),
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
    label: "Shatterice",
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
    notes: "Blue-white crust, dead traction, and caves cold enough to bite through the hull. Every landing is a controlled slide.",
    defaults: {
      ROCK_DARK: [0.32, 0.40, 0.55],
      ROCK_LIGHT: [0.68, 0.80, 0.92],
      AIR_DARK: [0.18, 0.24, 0.30],
      AIR_LIGHT: [0.40, 0.52, 0.62],
      SURFACE_ROCK_DARK: [0.55, 0.70, 0.86],
      SURFACE_ROCK_LIGHT: [0.82, 0.92, 0.98],
      SURFACE_BAND: 0.2,
    },
    ranges: {
      RMAX: r(15, 23),
      PAD: r(1.0, 1.7),
      MOTHERSHIP_ORBIT_HEIGHT: r(12, 20),
      SURFACE_G: r(1.6, 2.3),
      ATMOSPHERE_DRAG_MULT: r(1.0, 1.0),
      DRAG_MULT: r(0.9, 1.1),
      THRUST_MULT: r(0.95, 1.15),
      TURN_RATE_MULT: r(0.95, 1.15),
      LAND_FRICTION_MULT: r(0.1, 0.1),
      WALL_FRICTION_MULT: r(0.05, 0.12),
      BOUNCE_RESTITUTION: r(0.08, 0.14),
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
    label: "Eden Bite",
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
    notes: "Green from orbit, hungry up close. Thick growth, heavy rock, and trouble tucked under every bright canopy.",
    defaults: {
      ROCK_DARK: [0.30, 0.20, 0.12],
      ROCK_LIGHT: [0.52, 0.34, 0.20],
      AIR_DARK: [0.17, 0.22, 0.18],
      AIR_LIGHT: [0.38, 0.50, 0.40],
      SURFACE_ROCK_DARK: [0.08, 0.30, 0.12],
      SURFACE_ROCK_LIGHT: [0.18, 0.55, 0.22],
      SURFACE_BAND: 0.25,
      ATMOSPHERE: {
        inner: [0.45, 0.72, 1.0, 0.22],
        outer: [0.45, 0.72, 1.0, 0.0],
        ringCount: 4,
        ringOffset: -1,
      },
    },
    ranges: {
      RMAX: r(20, 25),
      PAD: r(1.0, 1.5),
      MOTHERSHIP_ORBIT_HEIGHT: r(12, 18),
      SURFACE_G: r(1.8, 2.4),
      ATMOSPHERE_DRAG_MULT: r(1.0, 1.0),
      DRAG_MULT: r(0.95, 1.25),
      THRUST_MULT: r(0.95, 1.10),
      TURN_RATE_MULT: r(0.95, 1.10),
      LAND_FRICTION_MULT: r(0.8, 1.2),
      WALL_FRICTION_MULT: r(0.9, 1.15),
      BOUNCE_RESTITUTION: r(0.14, 0.24),
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
    label: "Drownstar",
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
    notes: "A flooded sinkhole world that flies like syrup. Buoyancy helps until the deep caverns start pulling you under.",
    defaults: {
      ROCK_DARK: [0.30, 0.32, 0.34],
      ROCK_LIGHT: [0.56, 0.58, 0.62],
      AIR_DARK: [0.03, 0.12, 0.26],
      AIR_LIGHT: [0.12, 0.34, 0.58],
      SURFACE_ROCK_DARK: [0.34, 0.36, 0.38],
      SURFACE_ROCK_LIGHT: [0.62, 0.64, 0.68],
      SURFACE_BAND: 0.10,
    },
    ranges: {
      RMAX: r(15, 22),
      PAD: r(1.1, 1.8),
      MOTHERSHIP_ORBIT_HEIGHT: r(12, 20),
      SURFACE_G: r(1.0, 1.6),
      ATMOSPHERE_DRAG_MULT: r(1.0, 1.0),
      DRAG_MULT: r(2.2, 3.1),
      THRUST_MULT: r(0.85, 1.00),
      TURN_RATE_MULT: r(0.80, 0.95),
      LAND_FRICTION_MULT: r(0.8, 1.1),
      WALL_FRICTION_MULT: r(0.35, 0.55),
      BOUNCE_RESTITUTION: r(0.04, 0.10),
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
    label: "Black Echo",
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
    notes: "The classic deathball: cavern mouths, ambush tunnels, and rescue runs that turn into running gunfights.",
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
      ATMOSPHERE_DRAG_MULT: r(1.0, 1.0),
      DRAG_MULT: r(0.95, 1.15),
      THRUST_MULT: r(0.95, 1.10),
      TURN_RATE_MULT: r(0.95, 1.10),
      LAND_FRICTION_MULT: r(0.8, 1.2),
      WALL_FRICTION_MULT: r(1.1, 1.35),
      BOUNCE_RESTITUTION: r(0.18, 0.28),
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
    label: "Iron Hive",
    enemyCountBase: 5,
    enemyCountPerLevel: 5,
    enemyCountCap: 30,
    enemyPlacement: "random",
    objective: { type: "destroy_factories", count: 0 },
    minerCountBase: 0,
    minerCountPerLevel: 0,
    minerCountCap: 0,
    platformCount: 10,
    enemyAllow: ["hunter", "ranger", "turret", "orbitingTurret"],
    factorySpawnCooldownMin: 6.5,
    factorySpawnCooldownMax: 10.5,
    notes: "Factory citadels have chained this rock in steel. Blast the line, crack the gates, and leave the assembly floor burning.",
    flags: {},
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
      RMAX: r(18, 26),
      PAD: r(1.0, 1.4),
      MOTHERSHIP_ORBIT_HEIGHT: r(14, 22),
      SURFACE_G: r(2.0, 2.6),
      ATMOSPHERE_DRAG_MULT: r(1.0, 1.0),
      DRAG_MULT: r(0.9, 1.1),
      THRUST_MULT: r(0.95, 1.05),
      TURN_RATE_MULT: r(0.9, 1.05),
      LAND_FRICTION_MULT: r(0.8, 1.1),
      WALL_FRICTION_MULT: r(0.55, 0.8),
      BOUNCE_RESTITUTION: r(0.28, 0.42),
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
  const fallback = PLANET_CONFIGS[0];
  if (!fallback){
    throw new Error("PLANET_CONFIGS must contain at least one config");
  }
  return fallback;
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
 * @typedef {Object} LevelProgressionRule
 * @property {number} start Inclusive level start.
 * @property {number|null} [end] Inclusive level end. Null/undefined means no upper bound.
 * @property {PlanetTypeId[]} planets Planet ids used by this segment.
 * @property {boolean} [randomOrder] Shuffle planet order deterministically for each cycle.
 * @property {number|number[]} [enemyTotal] Enemy total per level slot (or scalar for all slots).
 * @property {number} [enemyPerLevel] Additional enemies per slot from `start`.
 * @property {number|number[]} [enemyCap] Enemy cap per level slot (or scalar for all slots).
 * @property {Record<string, EnemyTypeId[]>} [enemyAllowByPlanet] Per-planet enemy allow override.
 * @property {EnemyTypeId[]} [enemyAllowAdd] Enemy types added on top of per-planet/default allow.
 * @property {Record<string, number|number[]>} [orbitingTurretCountByPlanet] Per-planet orbiting turret wave size.
 * @property {Record<string, number>} [platformCountByPlanet] Per-planet platform count override.
 * @property {Record<string, number>} [excludeWhenEnemyTotalAtOrAbove] Planet is excluded when level total >= threshold.
 */

/**
 * @typedef {Object} LevelProgressionOverride
 * @property {PlanetTypeId} planetId
 * @property {number} [enemyTotal]
 * @property {number} [enemyCap]
 * @property {EnemyTypeId[]} [enemyAllow]
 * @property {EnemyTypeId[]} [enemyAllowAdd]
 * @property {number} [orbitingTurretCount]
 * @property {number} [platformCount]
 */

/**
 * Campaign progression script.
 * Edit this table to control level sequencing and per-level combat tuning.
 * Random-order segments are deterministic from the run seed.
 * @type {LevelProgressionRule[]}
 */
export const LEVEL_PROGRESSION_RULES = [
  {
    start: 1,
    end: 1,
    planets: ["barren_pickup"],
    enemyTotal: 0,
    enemyCap: 0,
  },
  {
    start: 2,
    end: 2,
    planets: ["barren_clear"],
    enemyTotal: 5,
    enemyCap: 5,
  },
  {
    start: 3,
    end: 4,
    planets: ["cavern", "gaia"],
    randomOrder: true,
    enemyTotal: [10, 15],
    enemyCap: [10, 15],
    enemyAllowByPlanet: {
      cavern: ["crawler", "turret"],
      gaia: ["turret", "orbitingTurret"],
    },
    orbitingTurretCountByPlanet: {
      gaia: [10, 15],
    },
  },
  {
    start: 5,
    end: 6,
    planets: ["water", "molten"],
    randomOrder: true,
    enemyTotal: 20,
    enemyCap: 20,
    enemyAllowByPlanet: {
      water: ["hunter"],
      molten: ["ranger"],
    },
  },
  {
    start: 7,
    end: 8,
    planets: ["ice", "mechanized"],
    randomOrder: true,
    enemyTotal: [20, 25],
    enemyCap: 25,
    excludeWhenEnemyTotalAtOrAbove: {
      mechanized: 25,
    },
  },
  {
    start: 9,
    end: 12,
    planets: ["barren_pickup", "barren_clear", "cavern", "gaia"],
    randomOrder: true,
    enemyTotal: 25,
    enemyCap: 25,
    enemyAllowAdd: ["crawler", "orbitingTurret", "turret"],
  },
  {
    start: 13,
    end: 15,
    planets: ["water", "ice", "molten"],
    randomOrder: true,
    enemyTotal: 30,
    enemyCap: 30,
  },
  {
    start: 16,
    end: null,
    planets: ["mechanized"],
    enemyTotal: 40,
    enemyPerLevel: 10,
    enemyCap: 100,
    enemyAllowByPlanet: {
      mechanized: ["hunter", "ranger", "crawler", "turret", "orbitingTurret"],
    },
    platformCountByPlanet: {
      mechanized: 24,
    },
  },
];

/**
 * @param {number|number[]|undefined} spec
 * @param {number} slot
 * @returns {number|undefined}
 */
function valueAtSlot(spec, slot){
  if (typeof spec === "number") return spec;
  if (!Array.isArray(spec) || spec.length === 0) return undefined;
  const i = Math.max(0, Math.min(spec.length - 1, slot | 0));
  return spec[i];
}

/**
 * @param {LevelProgressionRule} rule
 * @param {number} slot
 * @returns {number|undefined}
 */
function enemyTotalAtSlot(rule, slot){
  const base = valueAtSlot(rule.enemyTotal, slot);
  if (typeof base !== "number") return undefined;
  const extra = (typeof rule.enemyPerLevel === "number") ? Math.max(0, slot) * rule.enemyPerLevel : 0;
  return Math.max(0, Math.round(base + extra));
}

/**
 * @param {LevelProgressionRule} rule
 * @param {PlanetTypeId} planetId
 * @param {number|undefined} enemyTotal
 * @returns {boolean}
 */
function isPlanetExcluded(rule, planetId, enemyTotal){
  if (typeof enemyTotal !== "number") return false;
  if (!rule.excludeWhenEnemyTotalAtOrAbove) return false;
  const threshold = rule.excludeWhenEnemyTotalAtOrAbove[planetId];
  return typeof threshold === "number" && enemyTotal >= threshold;
}

/**
 * Build the per-cycle planet order with exclusion constraints applied.
 * @param {number} seed
 * @param {LevelProgressionRule} rule
 * @param {number} cycleIndex
 * @returns {PlanetTypeId[]}
 */
function planetCycleForRule(seed, rule, cycleIndex){
  const order = rule.planets.slice();
  if (order.length <= 1) return order;
  if (rule.randomOrder){
    const cycleSeed = hash32((seed | 0) + (rule.start | 0) * 8191 + (cycleIndex | 0) * 131071);
    const rand = mulberry32(cycleSeed);
    for (let i = order.length - 1; i > 0; i--){
      const j = Math.floor(rand() * (i + 1));
      const tmp = /** @type {PlanetTypeId} */ (order[i]);
      order[i] = /** @type {PlanetTypeId} */ (order[j]);
      order[j] = tmp;
    }
  }
  if (!rule.excludeWhenEnemyTotalAtOrAbove) return order;

  const cycleLen = order.length;
  for (let i = 0; i < cycleLen; i++){
    const slotI = cycleIndex * cycleLen + i;
    const totalI = enemyTotalAtSlot(rule, slotI);
    const planetI = /** @type {PlanetTypeId} */ (order[i]);
    if (!isPlanetExcluded(rule, planetI, totalI)) continue;
    let swapped = false;
    for (let j = 0; j < cycleLen; j++){
      if (j === i) continue;
      const slotJ = cycleIndex * cycleLen + j;
      const totalJ = enemyTotalAtSlot(rule, slotJ);
      const planetJ = /** @type {PlanetTypeId} */ (order[j]);
      if (isPlanetExcluded(rule, planetJ, totalI)) continue;
      if (isPlanetExcluded(rule, planetI, totalJ)) continue;
      const tmp = planetI;
      order[i] = planetJ;
      order[j] = tmp;
      swapped = true;
      break;
    }
    if (swapped) continue;
    for (const alt of rule.planets){
      if (isPlanetExcluded(rule, alt, totalI)) continue;
      order[i] = alt;
      swapped = true;
      break;
    }
    if (!swapped){
      // Keep original planet if no valid alternative exists.
    }
  }
  return order;
}

/**
 * Resolve the progression override for a specific level.
 * Returns null if no rule applies.
 * @param {number} seed
 * @param {number} level
 * @returns {LevelProgressionOverride|null}
 */
export function resolveLevelProgression(seed, level){
  const lvl = Math.max(1, level | 0);
  /** @type {LevelProgressionRule|undefined} */
  let rule = undefined;
  for (const r of LEVEL_PROGRESSION_RULES){
    const end = (typeof r.end === "number") ? r.end : Infinity;
    if (lvl >= r.start && lvl <= end){
      rule = r;
      break;
    }
  }
  if (!rule || !rule.planets || !rule.planets.length) return null;

  const slot = Math.max(0, lvl - rule.start);
  const cycleLen = Math.max(1, rule.planets.length);
  const cycleIndex = Math.floor(slot / cycleLen);
  const cyclePos = slot % cycleLen;
  const cycle = planetCycleForRule(seed, rule, cycleIndex);
  const planetId = /** @type {PlanetTypeId} */ (cycle[Math.max(0, Math.min(cycle.length - 1, cyclePos))]);

  const enemyTotal = enemyTotalAtSlot(rule, slot);
  const enemyCapRaw = valueAtSlot(rule.enemyCap, slot);
  const enemyCap = (typeof enemyCapRaw === "number") ? Math.max(0, Math.round(enemyCapRaw)) : undefined;

  const baseAllow = rule.enemyAllowByPlanet ? rule.enemyAllowByPlanet[planetId] : undefined;
  const enemyAllowAdd = Array.isArray(rule.enemyAllowAdd) ? rule.enemyAllowAdd : [];
  /** @type {EnemyTypeId[]|undefined} */
  let enemyAllow = undefined;
  if (Array.isArray(baseAllow)){
    enemyAllow = baseAllow.slice();
  }
  const enemyAllowAddOut = enemyAllowAdd.length ? enemyAllowAdd.slice() : undefined;

  const orbitRaw = rule.orbitingTurretCountByPlanet ? rule.orbitingTurretCountByPlanet[planetId] : undefined;
  const orbitValue = valueAtSlot(orbitRaw, slot);
  const orbitingTurretCount = (typeof orbitValue === "number") ? Math.max(0, Math.round(orbitValue)) : undefined;

  const platformRaw = rule.platformCountByPlanet ? rule.platformCountByPlanet[planetId] : undefined;
  const platformCount = (typeof platformRaw === "number") ? Math.max(1, Math.round(platformRaw)) : undefined;

  /** @type {LevelProgressionOverride} */
  const out = { planetId };
  if (typeof enemyTotal === "number") out.enemyTotal = enemyTotal;
  if (typeof enemyCap === "number") out.enemyCap = enemyCap;
  if (enemyAllow) out.enemyAllow = enemyAllow;
  if (enemyAllowAddOut) out.enemyAllowAdd = enemyAllowAddOut;
  if (typeof orbitingTurretCount === "number") out.orbitingTurretCount = orbitingTurretCount;
  if (typeof platformCount === "number") out.platformCount = platformCount;
  return out;
}

/**
 * Pick a planet config deterministically from seed + level.
 * @param {number} seed
 * @param {number} level
 * @returns {PlanetConfig}
 */
export function pickPlanetConfig(seed, level){
  const lvl = Math.max(1, level | 0);
  if (!PLANET_CONFIGS.length){
    throw new Error("PLANET_CONFIGS must contain at least one config");
  }
  const base = (seed | 0) + lvl * 9973;
  const idx = hash32(base) % PLANET_CONFIGS.length;
  return /** @type {PlanetConfig} */ (PLANET_CONFIGS[idx]);
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
    if (k in out) out[k] = Math.round(/** @type {number} */ (out[k]));
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
    MOTHERSHIP_ORBIT_HEIGHT: [4, 26],
    SURFACE_G: [1.2, 3.2],
    ATMOSPHERE_DRAG_MULT: [0.0, 4.0],
    ATMOSPHERE_HEIGHT: [0.0, 12.0],
    ROCK_AIR_MIN: [-1.0, 0.49],
    ROCK_AIR_MAX: [-1.0, 0.49],
    DRAG_MULT: [0.7, 2.0],
    THRUST_MULT: [0.7, 1.4],
    TURN_RATE_MULT: [0.7, 1.4],
    LAND_FRICTION_MULT: [0.2, 1.6],
    WALL_FRICTION_MULT: [0.0, 1.6],
    BOUNCE_RESTITUTION: [0.0, 1.0],
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
    const v = /** @type {number} */ (out[key]);
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
  const roll = /** @type {PlanetRoll} */ (
    /** @type {unknown} */ (clampPlanetConfig(rollPlanetConfig(seed, level, cfg)))
  );
  const isMechanizedCoreLevel = !!(cfg && cfg.id === "mechanized" && level >= 16);
  const mechanizedCoreRadius = isMechanizedCoreLevel ? 8 : (roll.CORE_RADIUS ?? 0);
  const moltenInner = isMechanizedCoreLevel ? mechanizedCoreRadius : (roll.MOLTEN_RING_INNER ?? 0);
  const moltenOuter = isMechanizedCoreLevel ? (mechanizedCoreRadius + 2.2) : (roll.MOLTEN_RING_OUTER ?? 0);
  // PlanetParams fields are the authoritative set used at runtime:
  // Geometry: RMAX, PAD, MOTHERSHIP_ORBIT_HEIGHT
  // Gravity: SURFACE_G
  // Mapgen: TARGET_FINAL_AIR, CA_STEPS, AIR_KEEP_N8, ROCK_TO_AIR_N8, ENTRANCES, ENTRANCE_OUTER, ENTRANCE_INNER,
  //         WARP_F, WARP_A, BASE_F, VEIN_F, VEIN_THRESH, VEIN_DILATE
  // Visibility: VIS_RANGE, FOG_SEEN_ALPHA, FOG_UNSEEN_ALPHA, FOG_BUDGET_TRIS
  // Gameplay: ATMOSPHERE_DRAG, ATMOSPHERE_HEIGHT, ROCK_AIR_MIN, ROCK_AIR_MAX, DRAG, THRUST, TURN_RATE,
  //           LAND_FRICTION, WALL_FRICTION, BOUNCE_RESTITUTION, CRASH_SPEED, LAND_SPEED
  const rockAirMin = Number.isFinite(roll.ROCK_AIR_MIN) ? Number(roll.ROCK_AIR_MIN) : Number(baseGame.ROCK_AIR_MIN ?? 0);
  const rockAirMax = Number.isFinite(roll.ROCK_AIR_MAX) ? Number(roll.ROCK_AIR_MAX) : Number(baseGame.ROCK_AIR_MAX ?? 0);
  const rockMinClamped = Math.max(-1, Math.min(0.49, rockAirMin));
  const rockMaxClamped = Math.max(rockMinClamped, Math.min(0.49, rockAirMax));
  return {
    RMAX: roll.RMAX,
    PAD: roll.PAD,
    MOTHERSHIP_ORBIT_HEIGHT: roll.MOTHERSHIP_ORBIT_HEIGHT,
    SURFACE_G: roll.SURFACE_G,
    ATMOSPHERE_DRAG: baseGame.ATMOSPHERE_DRAG * (roll.ATMOSPHERE_DRAG_MULT ?? 1),
    ATMOSPHERE_HEIGHT: Number.isFinite(roll.ATMOSPHERE_HEIGHT) ? Math.max(0, Number(roll.ATMOSPHERE_HEIGHT)) : baseGame.ATMOSPHERE_HEIGHT,
    ROCK_AIR_MIN: rockMinClamped,
    ROCK_AIR_MAX: rockMaxClamped,
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
    CORE_RADIUS: mechanizedCoreRadius,
    CORE_DPS: roll.CORE_DPS ?? 0,
    ICE_CRUST_THICKNESS: roll.ICE_CRUST_THICKNESS ?? 0,
    WATER_LEVEL: roll.WATER_LEVEL ?? 0,
      MOLTEN_RING_INNER: moltenInner,
      MOLTEN_RING_OUTER: moltenOuter,
      MOLTEN_VENT_COUNT: (cfg && cfg.id === "molten") ? Math.max(0, level * 5) : 0,
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
    WALL_FRICTION: baseGame.LAND_FRICTION * (roll.WALL_FRICTION_MULT ?? roll.LAND_FRICTION_MULT ?? 1),
    BOUNCE_RESTITUTION: Number.isFinite(roll.BOUNCE_RESTITUTION)
      ? Math.max(0, Math.min(1, Number(roll.BOUNCE_RESTITUTION)))
      : Math.max(0, Math.min(1, baseGame.BOUNCE_RESTITUTION)),
    CRASH_SPEED: baseGame.CRASH_SPEED * roll.CRASH_SPEED_MULT,
    LAND_SPEED: baseGame.LAND_SPEED * roll.LAND_SPEED_MULT,
    NO_CAVES: !!(cfg.flags && cfg.flags.noCaves),
  };
}

// Example usage:
// const type = pickPlanetConfig(seed, level);
// const rolled = clampPlanetConfig(rollPlanetConfig(seed, level, type));

