// @ts-check

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
  ROCK_DARK: [0x5f/255, 0x3a/255, 0x20/255],
  ROCK_LIGHT:[0x8a/255, 0x56/255, 0x31/255],
  AIR_DARK:  [0x2b/255, 0x2b/255, 0x2b/255],
  AIR_LIGHT: [0x4a/255, 0x4a/255, 0x4a/255],
  EDGE_DARK: [0x14/255, 0x14/255, 0x14/255],
});

const surfaceGravityAcceleration = 2.0;
const rocketAcceleration = 4.5;

export const GAME = Object.freeze({
  ZOOM: 3.0, // ~12% of the world visible
  SHIP_SCALE: 0.5,
  MINER_SCALE: 0.5,
  ENEMY_SCALE: 1.0,
  THRUST: rocketAcceleration,
  TURN_RATE: 2.4,
  DRAG: 0.12,
  GRAVITY: surfaceGravityAcceleration * CFG.RMAX * CFG.RMAX,
  CRASH_SPEED: 4.5,
  LAND_SPEED: 2.0,
  SURFACE_DOT: 0.7,
  LAND_FRICTION: 0.6,
  BOUNCE_RESTITUTION: 0.1,
  COLLIDE_PUSH_FAST: 0.08,
  /** @type {boolean} */
  DEBUG_COLLISION: false,
  /** @type {boolean} */
  DEBUG_NODES: true,
  MINERS_PER_LEVEL: 10,
  MINER_CALL_RADIUS: 4.0,
  MINER_RUN_SPEED: 1.6,
  MINER_BOARD_RADIUS: 0.12,
  MINER_MIN_SEP: 1.4,
  MINER_STAND_OFFSET: 0.12,
  MINER_POPUP_LIFE: 0.9,
  MINER_POPUP_SPEED: 0.6,
  MINER_POPUP_TANGENTIAL: 0.18,
  EXIT_MARGIN: 1.0,
  MAX_TANGENTIAL_SPEED: 4.0,
  SHIP_MAX_HP: 3,
  SHIP_HIT_COOLDOWN: 0.25,
  SHIP_HIT_POPUP_LIFE: 0.6,
});

export const TOUCH_UI = Object.freeze({
  left: { x: 0.13, y: 0.72, r: 0.13 },
  laser: { x: 0.87, y: 0.72, r: 0.12 },
  bomb: { x: 0.87, y: 0.30, r: 0.11 },
  dead: 0.04,
  aimRadius: 0.09,
});
