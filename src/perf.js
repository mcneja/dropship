// @ts-check
/** @typedef {import("./game.js").Game} Game */
/**
 * @typedef {{
 *  sampleCount:number,
 *  avgMs:number,
 *  avgFps:number,
 *  p50Ms:number,
 *  p95Ms:number,
 *  p99Ms:number,
 *  low1Fps:number,
 *  over16_7:number,
 *  over25:number,
 *  over33_3:number,
 *  maxMs:number
 * }} FrameStatsSnapshot
 */

/**
 * @param {string} key
 * @returns {string|null}
 */
function queryParam(key){
  if (typeof window === "undefined" || typeof window.location === "undefined") return null;
  const params = new URLSearchParams(window.location.search || "");
  const value = params.get(key);
  return value == null ? null : value.trim();
}

/**
 * @param {string|null} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function parseBool(value, fallback){
  if (value == null || value === "") return fallback;
  const lower = value.toLowerCase();
  if (lower === "1" || lower === "true" || lower === "yes" || lower === "on") return true;
  if (lower === "0" || lower === "false" || lower === "no" || lower === "off") return false;
  return fallback;
}

/**
 * @param {string|null} value
 * @param {number} fallback
 * @returns {number}
 */
function parseFiniteNumber(value, fallback){
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {string} key
 * @param {boolean} fallback
 * @returns {boolean}
 */
function boolParam(key, fallback = false){
  return parseBool(queryParam(key), fallback);
}

/**
 * @param {string} key
 * @param {number} fallback
 * @returns {number}
 */
function numberParam(key, fallback){
  return parseFiniteNumber(queryParam(key), fallback);
}

/**
 * @param {string} key
 * @param {number} fallbackSeconds
 * @returns {number}
 */
function secondsParam(key, fallbackSeconds){
  return Math.max(0, numberParam(key, fallbackSeconds)) * 1000;
}

const maxDprRaw = numberParam("perf_max_dpr", NaN);
const maxDpr = Number.isFinite(maxDprRaw) && maxDprRaw >= 1 ? maxDprRaw : null;

export const PERF_FLAGS = Object.freeze({
  maxDpr,
  disableMsaa: boolParam("perf_disable_msaa", false),
  disableFogSync: boolParam("perf_disable_fog", false),
  disableDynamicOverlay: boolParam("perf_disable_dynamic_overlay", false),
  disableOverlayCanvas: boolParam("perf_disable_overlay_canvas", false),
  disableHudLayout: boolParam("perf_disable_hud_layout", false),
  disableEnemyAi: boolParam("perf_disable_enemy_ai", false),
  disableAudioPlayback: boolParam("perf_disable_audio_playback", false),
  disableMusicPlayback: boolParam("perf_disable_music_playback", false),
  disableSfxPlayback: boolParam("perf_disable_sfx_playback", false),
});

export const ACTIVE_PERF_FLAGS = Object.freeze((() => {
  /** @type {string[]} */
  const out = [];
  if (PERF_FLAGS.maxDpr !== null) out.push(`dpr<=${PERF_FLAGS.maxDpr}`);
  if (PERF_FLAGS.disableMsaa) out.push("msaa=off");
  if (PERF_FLAGS.disableFogSync) out.push("fog=off");
  if (PERF_FLAGS.disableDynamicOverlay) out.push("dynOverlay=off");
  if (PERF_FLAGS.disableOverlayCanvas) out.push("canvasOverlay=off");
  if (PERF_FLAGS.disableHudLayout) out.push("hudLayout=off");
  if (PERF_FLAGS.disableEnemyAi) out.push("enemyAI=off");
  if (PERF_FLAGS.disableAudioPlayback) out.push("audioPlayback=off");
  if (PERF_FLAGS.disableMusicPlayback) out.push("musicPlayback=off");
  if (PERF_FLAGS.disableSfxPlayback) out.push("sfxPlayback=off");
  return out;
})());

const benchEnabled = boolParam("bench", false);
const benchStartRaw = (queryParam("bench_start") || "").toLowerCase();

export const BENCH_CONFIG = Object.freeze({
  enabled: benchEnabled,
  seed: numberParam("bench_seed", 1337),
  level: Math.max(1, Math.floor(numberParam("bench_level", 1))),
  start: benchStartRaw === "docked" ? "docked" : "orbit",
  warmupMs: secondsParam("bench_warmup", 3),
  durationMs: secondsParam("bench_duration", 20),
});

/**
 * @returns {number}
 */
export function getEffectiveDevicePixelRatio(){
  const base = Math.max(1, (typeof window !== "undefined" ? (window.devicePixelRatio || 1) : 1));
  return PERF_FLAGS.maxDpr == null ? base : Math.min(base, PERF_FLAGS.maxDpr);
}

export class RollingFrameStats {
  /**
   * @param {number} [capacity]
   */
  constructor(capacity = 600){
    this.capacity = Math.max(30, capacity | 0);
    this.samples = new Float32Array(this.capacity);
    this.count = 0;
    this.cursor = 0;
  }

  /**
   * @returns {void}
   */
  reset(){
    this.count = 0;
    this.cursor = 0;
  }

  /**
   * @param {number} frameMs
   * @returns {void}
   */
  record(frameMs){
    if (!Number.isFinite(frameMs) || frameMs < 0) return;
    this.samples[this.cursor] = frameMs;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /**
   * @returns {number[]}
   */
  _orderedSamples(){
    /** @type {number[]} */
    const out = new Array(this.count);
    if (this.count < this.capacity){
      for (let i = 0; i < this.count; i++) out[i] = /** @type {number} */ (this.samples[i]);
      return out;
    }
    for (let i = 0; i < this.count; i++){
      out[i] = /** @type {number} */ (this.samples[(this.cursor + i) % this.capacity]);
    }
    return out;
  }

  /**
   * @param {number[]} sorted
   * @param {number} p
   * @returns {number}
   */
  _percentile(sorted, p){
    if (!sorted.length) return 0;
    const idx = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * p));
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const a = sorted[lo];
    const b = sorted[hi];
    if (a === undefined || b === undefined) return 0;
    if (lo === hi) return a;
    return a + (b - a) * (idx - lo);
  }

  /**
   * @returns {FrameStatsSnapshot|null}
   */
  snapshot(){
    if (!this.count) return null;
    const ordered = this._orderedSamples();
    let sum = 0;
    let maxMs = 0;
    let over16_7 = 0;
    let over25 = 0;
    let over33_3 = 0;
    for (let i = 0; i < ordered.length; i++){
      const sample = ordered[i] || 0;
      sum += sample;
      if (sample > maxMs) maxMs = sample;
      if (sample > 16.7) over16_7++;
      if (sample > 25) over25++;
      if (sample > 33.3) over33_3++;
    }
    const avgMs = sum / ordered.length;
    const sorted = ordered.slice().sort((a, b) => a - b);
    const slowCount = Math.max(1, Math.ceil(sorted.length * 0.01));
    let slowSum = 0;
    for (let i = sorted.length - slowCount; i < sorted.length; i++){
      slowSum += sorted[i] || 0;
    }
    const slowAvgMs = slowSum / slowCount;
    return {
      sampleCount: ordered.length,
      avgMs,
      avgFps: avgMs > 0 ? 1000 / avgMs : 0,
      p50Ms: this._percentile(sorted, 0.50),
      p95Ms: this._percentile(sorted, 0.95),
      p99Ms: this._percentile(sorted, 0.99),
      low1Fps: slowAvgMs > 0 ? 1000 / slowAvgMs : 0,
      over16_7,
      over25,
      over33_3,
      maxMs,
    };
  }
}

/**
 * @param {Game} game
 * @param {number} now
 * @returns {void}
 */
export function updateFps(game, now){
  const perfState = game.perfState;
  perfState.fpsFrames++;
  if (now - perfState.fpsTime < 500) return;
  perfState.fps = Math.round((perfState.fpsFrames * 1000) / (now - perfState.fpsTime));
  perfState.fpsFrames = 0;
  perfState.fpsTime = now;
}

export class PerfState {
  /**
   * @param {number} nowMs
   */
  constructor(nowMs){
    this.fpsTime = nowMs;
    this.fpsFrames = 0;
    this.fps = 0;
    /** @type {FrameStatsSnapshot|null} */
    this.frameStats = null;
    this.frameStatsTracker = new RollingFrameStats(BENCH_CONFIG.enabled ? 2400 : 600);
    this.frameStatsUpdatedAt = nowMs;
    this.flags = ACTIVE_PERF_FLAGS;
    this.benchmarkRun = BENCH_CONFIG.enabled ? {
      startedAtMs: 0,
      sampleStartAtMs: 0,
      sampleEndAtMs: 0,
      active: false,
      finished: false,
      stateText: `warmup ${Math.ceil(BENCH_CONFIG.warmupMs / 1000)}s`,
      tracker: new RollingFrameStats(Math.max(600, Math.ceil((BENCH_CONFIG.durationMs / 1000) * 180))),
      result: null,
    } : null;
  }
}

/**
 * @param {{
 *  bench:{seed:number, level:number, start:string, warmupMs:number, durationMs:number},
 *  stats:{
 *    sampleCount:number,
 *    avgMs:number,
 *    avgFps:number,
 *    p50Ms:number,
 *    p95Ms:number,
 *    p99Ms:number,
 *    low1Fps:number,
 *    over16_7:number,
 *    over25:number,
 *    over33_3:number,
 *    maxMs:number
 *  }|null,
 *  perfFlags:readonly string[],
 *  planetSeed:number
 * }} result
 * @returns {void}
 */
export function reportBenchmarkResult(result){
  const stats = result.stats;
  const summary = stats ? {
    sample_count: stats.sampleCount,
    avg_fps: Number(stats.avgFps.toFixed(2)),
    low_1pct_fps: Number(stats.low1Fps.toFixed(2)),
    avg_ms: Number(stats.avgMs.toFixed(2)),
    p50_ms: Number(stats.p50Ms.toFixed(2)),
    p95_ms: Number(stats.p95Ms.toFixed(2)),
    p99_ms: Number(stats.p99Ms.toFixed(2)),
    max_ms: Number(stats.maxMs.toFixed(2)),
    over_16_7ms: stats.over16_7,
    over_25ms: stats.over25,
    over_33_3ms: stats.over33_3,
  } : { error: "No frame samples captured" };
  console.groupCollapsed("[Bench] Result");
  console.log("config", {
    bench_seed: result.bench.seed,
    planet_seed: result.planetSeed,
    bench_level: result.bench.level,
    bench_start: result.bench.start,
    bench_warmup_s: result.bench.warmupMs / 1000,
    bench_duration_s: result.bench.durationMs / 1000,
    perf_flags: result.perfFlags.join(", ") || "none",
  });
  console.table(summary);
  console.groupEnd();
  if (typeof window !== "undefined"){
    /** @type {any} */ (window).__dropshipBenchLast = { ...result, summary };
  }
}

if (typeof window !== "undefined"){
  /** @type {any} */ (window).__dropshipPerfConfig = PERF_FLAGS;
  /** @type {any} */ (window).__dropshipBenchConfig = BENCH_CONFIG;
}


