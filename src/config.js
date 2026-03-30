// @ts-check

const PLANET_SHADOW_THICKNESS = 0.05;

export const CFG = Object.freeze({
  seed: 1337,
  RMAX: 18,
  N_MIN: 6,

  // cave grid resolution (simulation) - independent from mesh
  GRID: 360,
  PAD: 1.2,
  TARGET_FINAL_AIR: 0.50,

  // noise shaping
  WARP_F: 0.055,
  WARP_A: 2.0,
  BASE_F: 0.13,
  VEIN_F: 0.17,

  // CA smoothing
  CA_STEPS: 3,
  AIR_KEEP_N8: 3,
  ROCK_TO_AIR_N8: 6,

  // barriers
  VEIN_THRESH: 0.79,
  VEIN_MID_MIN: 0.35,
  VEIN_DILATE: 1,

  // entrances
  ENTRANCES: 4,
  ENTRANCE_OUTER: 0.70,
  ENTRANCE_INNER: 0.55,
  ENTRANCE_ANGLE_JITTER: 0.35,

  // render
  ROCK_DARK: [0x5f/255, 0x3a/255, 0x20/255], // darker end of the interior rock gradient; normalized RGB
  ROCK_LIGHT:[0x8a/255, 0x56/255, 0x31/255], // lighter end of the interior rock gradient; normalized RGB
  AIR_DARK:  [0x2b/255, 0x2b/255, 0x2b/255], // darker end of the cave-air gradient away from lit/open areas; normalized RGB
  AIR_LIGHT: [0x4a/255, 0x4a/255, 0x4a/255], // lighter end of the cave-air gradient; normalized RGB
  EDGE_DARK: [0x14/255, 0x14/255, 0x14/255], // legacy dark edge color constant; normalized RGB
  TERRAIN_EDGE_AIR_OCCLUSION: 0.24, // strength of the rock-casts-into-air darkening band along cave walls
  TERRAIN_EDGE_AIR_BAND_WORLD: PLANET_SHADOW_THICKNESS, // world-space thickness of the air-side wall darkening band
  TERRAIN_EDGE_AIR_HARDNESS: 0.0, // 0 = soft falloff, 1 = hard cutoff for the air-side wall darkening
  TERRAIN_EDGE_ROCK_LIGHT: 0.14, // strength of the lightened highlight band on the rock side of the boundary
  TERRAIN_EDGE_ROCK_BAND_WORLD: 0.05, // world-space thickness of the rock-side highlight band
  TERRAIN_EDGE_ROCK_HARDNESS: 0.0, // 0 = soft falloff, 1 = hard cutoff for the rock-side highlight
  TERRAIN_EDGE_OUTWARD_BIAS: 0.8, // biases rock-side highlighting toward outward-facing walls near the surface
  DROPSHIP_OUTLINE_WORLD: PLANET_SHADOW_THICKNESS, // ship silhouette shell thickness in world units; ~0.01-0.08 typical
  DROPSHIP_OUTLINE_TOP: [0x16/255, 0x16/255, 0x18/255], // top color for the dark outer shell; normalized RGB
  DROPSHIP_OUTLINE_BOTTOM: [0x16/255, 0x16/255, 0x18/255], // bottom color for the dark outer shell; normalized RGB
  DROPSHIP_OUTLINE_ALPHA_TOP: 0.1, // top opacity for the dark outer shell; ~0.02-0.3 typical
  DROPSHIP_OUTLINE_ALPHA_BOTTOM: 0.4, // bottom opacity for the dark outer shell; ~0.1-0.5 typical
  DROPSHIP_HULL_TOP: [0.70, 0.72, 0.75], // top-of-hull gradient color; normalized RGB
  DROPSHIP_HULL_BOTTOM: [0.52, 0.55, 0.60], // bottom-of-hull gradient color; normalized RGB
  DROPSHIP_WINDOW_COLOR: [0.08, 0.10, 0.13], // cockpit/window fill color; normalized RGB
  DROPSHIP_GUN_TOP: [0.42, 0.45, 0.50], // top-of-gun gradient color; normalized RGB
  DROPSHIP_GUN_BOTTOM: [0.18, 0.20, 0.24], // bottom-of-gun gradient color; normalized RGB
  DROPSHIP_GUN_OUTLINE_TOP: [0x2a/255, 0x2a/255, 0x2d/255], // top outline color for the gun; normalized RGB
  DROPSHIP_GUN_OUTLINE_BOTTOM: [0x10/255, 0x10/255, 0x12/255], // bottom outline color for the gun; normalized RGB
  DROPSHIP_HULL_SHEEN_ALPHA: 0.10, // centerline highlight strength; ~0-0.25 typical
  DROPSHIP_HULL_SHEEN_FALLOFF: 8.0, // centerline highlight tightness across X; ~3-14 typical
  STAR_SATURATION: 2, //1 = baseline, >1 more intense colors
});

export const GAME = Object.freeze({
  PLANETSIDE_ZOOM: 4.5,
  MOTHERSHIP_ZOOM: 6,
  MOTHERSHIP_START_DOCK_X: 0,
  MOTHERSHIP_START_DOCK_Y: 0.7,
  SHIP_SCALE: 0.5,
  MINER_SCALE: 0.5,
  ENEMY_SCALE: 0.25,
  FRAGMENT_PLANET_COLLISION: true,
  THRUST: 4.5,
  TURN_RATE: 2.4,
  DRAG: 0.12,
  // Base corrective acceleration unlocked by inertial drive level 1 while input is held (set to 0 to disable)
  INERTIAL_DRIVE_THRUST: 2.25,
  INERTIAL_DRIVE_UPGRADE_FACTOR: 0.2,
  // Share of inertial-drive thrust allowed to oppose velocity opposite the desired input direction.
  INERTIAL_DRIVE_REVERSE_FRACTION: 1.0,
  // Share of inertial-drive thrust allowed to oppose velocity sideways to the desired input direction.
  INERTIAL_DRIVE_LATERAL_FRACTION: 1.0,
  // Quadratic drag in planetary air. Set to 0 to disable atmosphere drag entirely.
  ATMOSPHERE_DRAG: 0.2,
  // Thickness of the atmosphere band above the outer surface, in world units.
  ATMOSPHERE_HEIGHT: 0.0,
  // Encoded vertex-air range used for solid terrain samples (must stay below 0.5).
  // Keep both at 0 for binary rock. Example: -0.25..0.25 shifts the 0.5 isosurface.
  ROCK_AIR_MIN: -0.4,
  ROCK_AIR_MAX: 0.4,
  CRASH_SPEED: 6.0,
  LAND_SPEED: 4.0,
  LAND_MAX_TANGENT_SPEED: 1.0,
  SURFACE_DOT: 0.7,
  LAND_FRICTION: 10,
  MOTHERSHIP_FRICTION: 10,
  MOTHERSHIP_RESTITUTION: 0.2,
  BOUNCE_RESTITUTION: 0.1,
  /** @type {boolean} */
  DEBUG_COLLISION: false,
  /** @type {boolean} */
  DEBUG_NODES: true,
  MINERS_PER_LEVEL: 10,
  MINER_CALL_RADIUS: 4.0,
  MINER_GUIDE_ATTACH_RADIUS: 1.1,
  MINER_WALK_MAX_SLOPE: 0.35,
  MINER_WALK_CLEARANCE: 0.2,
  MINER_WALK_SIDE_CLEARANCE: 0.25,
  MINER_GUIDE_STEP: 0.22,
  MINER_GUIDE_MAX_SEGMENT: 0.45,
  MINER_JOG_SPEED: 0.8,
  MINER_RUN_SPEED: 1.2,
  MINER_BOARD_RADIUS: 0.12,
  MINER_MIN_SEP: 1.4,
  MINER_STAND_OFFSET: 0.12,
  MINER_POPUP_LIFE: 0.9,
  MINER_POPUP_SPEED: 0.6,
  MINER_POPUP_TANGENTIAL: 0.18,
  MAX_TANGENTIAL_SPEED: 4.0,
  SHIP_STARTING_MAX_HP: 3,
  SHIP_STARTING_MAX_BOMBS: 3,
  SHIP_STARTING_BOMB_STRENGTH: 0,
  SHIP_STARTING_THRUST: 0,
  SHIP_STARTING_INERTIAL_DRIVE: 0,
  SHIP_MAX_INERTIAL_DRIVE: 3,
  SHIP_STARTING_GUN_POWER: 1,
  SHIP_HIT_COOLDOWN: 0.25,
  SHIP_HIT_POPUP_LIFE: 0.6,
  AIM_SCREEN_RADIUS: 0.25,
  VIS_RANGE: 7.0,
  VIS_STEP: 0.25,
  FOG_COLOR: [0.1, 0.1, 0.1],
  FOG_UNSEEN_ALPHA: 0.95,
  FOG_SEEN_ALPHA: 0.0625,
  FOG_HOLD_FRAMES: 4,
  FOG_BUDGET_TRIS: 300,
  FOG_LOS_THRESH: 0.5,
  FOG_ALPHA_LERP: 0.2,
  JUMPDRIVE: Object.freeze({
    // Seconds spent damping camera rotation and pitching the mothership up.
    alignDuration: 0.5,
    // Minimum seconds spent in the star-streak jumpdrive run.
    jumpdriveMinDuration: 1.1,
    // Seconds spent revealing the next planet while staying zoomed out.
    revealDuration: 3.05,
    // Seconds spent zooming back into the normal gameplay framing.
    focusDuration: 0.7,
    // Max degrees the mothership pitches from its current heading toward open space.
    launchTiltDeg: 38,
    // Camera radius multiplier reached by the end of the align phase.
    alignZoomMultiplier: 1.12,
    // Additional camera radius multiplier used during the jumpdrive run.
    jumpdriveZoomMultiplier: 1.45,
    // Camera radius multiplier used at the start of the arrival reveal.
    revealStartZoomMultiplier: 3.5,
    // Camera radius multiplier reached by the end of the wide arrival reveal.
    revealZoomMultiplier: 1.85,
    // Overall scale multiplier for the mothership jumpdrive rocket plume.
    plumeScale: 1.5,
    // How far the mothership travels during launch, in view-radius units.
    launchDistanceMultiplier: 3.2,
    // How far above the final orbit position the arrival path starts.
    arrivalOffsetMultiplier: 1.9,
    // Sideways offset applied to the arrival path for a curved orbit entry.
    arrivalLateralMultiplier: 0.42,
    // Number of star streaks drawn in the jumpdrive overlay.
    streakCount: 84,
  }),
});

export const TOUCH_UI = Object.freeze({
  left: { x: 0.13, y: 0.67, r: 0.13 },
  laser: { x: 0.87, y: 0.67, r: 0.12 },
  bomb: { x: 0.87, y: 0.30, r: 0.11 },
  dead: 0.04,
  aimRadius: 0.09,
  activationScale: 1.4,
});

