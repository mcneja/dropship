// @ts-check

//@ts-ignore
import ambientMain256Url from "../gameaudio/ambientmain_0_256k.mp3?url";
//@ts-ignore
import spacelife256Url from "../gameaudio/spacelifeNo14_256k.mp3?url";
//@ts-ignore
import victoryMusicUrl from "../gameaudio/Space Sprinkles.mp3?url";
//@ts-ignore
import combatAwakeUrl from "../gameaudio/awake10_megaWall.mp3?url";
//@ts-ignore
import combatOrbitalUrl from "../gameaudio/Orbital Colossus.mp3?url";
//@ts-ignore
import bombLaunch256Url from "../gameaudio/rlaunch_256k.mp3?url";
//@ts-ignore
import pistol256Url from "../gameaudio/pistol_256k.mp3?url";
//@ts-ignore
import explosion256Url from "../gameaudio/8bit_gunloop_explosion_256k.mp3?url";
//@ts-ignore
import crash256Url from "../gameaudio/qubodup-crash_256k.mp3?url";
//@ts-ignore
import shipHitUrl from "../gameaudio/metalthunk.mp3?url";
//@ts-ignore
import enemyFireUrl from "../gameaudio/ghost_256k.mp3?url";
//@ts-ignore
//import thrustUrl from "../gameaudio/rocket_launch_256k.mp3?url";
import thrustUrl from "../gameaudio/engine_sound.mp3?url";
//@ts-ignore
import rescueUrl from "../gameaudio/key-176034.mp3?url";
//@ts-ignore
import levelCompleteUrl from "../gameaudio/levelcompletesplash.mp3?url";
//@ts-ignore
import hazardHeatUrl from "../gameaudio/lava_256k.mp3?url";
//@ts-ignore
import splash256Url from "../gameaudio/splash1_256k.mp3?url";

/**
 * Number of full plays per ambient track before advancing to the next one.
 */
export const TRACK_PLAY_COUNT = 2;

const AMBIENT_PLAYLIST = [
  ambientMain256Url,
  spacelife256Url,
];

const COMBAT_PLAYLIST = [
  combatAwakeUrl,
  combatOrbitalUrl,
];

const MUSIC_CROSSFADE_MS = 1400;
const COMBAT_TRIGGER_MIN_MS = 24000;
const COMBAT_TRIGGER_MAX_MS = 48000;
const COMBAT_RETRIGGER_COOLDOWN_MS = 18000;
const THRUST_LOOP_GAIN = 0.25;
const THRUST_LOOP_FADE_IN_MS = 90;
const THRUST_LOOP_FADE_OUT_MS = 320;

const MAX_PENDING_SFX = 24;
const DEFAULT_SFX_POOL_SIZE = 3;
/** @type {Readonly<Record<string, number>>} */
const SFX_POOL_SIZE = {
  ship_laser: 4,
  enemy_fire: 4,
  bomb_explosion: 3,
  water_splash: 4,
};
/** @type {Readonly<Record<string, number>>} */
const SFX_MIN_INTERVAL_MS = {
  ship_laser: 70,
};
const WEB_AUDIO_SFX_IDS = Object.freeze(["ship_laser", "enemy_fire"]);
/** @type {Readonly<Record<string, number[]>>} */
const WEB_AUDIO_SFX_VARIANT_RATES = Object.freeze({
  ship_laser: [0.96, 1.0, 1.04],
});

const SFX_PLACEHOLDER_URLS = {
  ship_laser: pistol256Url,
  bomb_launch: bombLaunch256Url,
  bomb_explosion: crash256Url,
  ship_hit: shipHitUrl,
  ship_crash: crash256Url,
  enemy_fire: enemyFireUrl,
  enemy_destroyed: explosion256Url,
  miner_rescued: rescueUrl,
  objective_complete: levelCompleteUrl,
  ship_thrust_loop: thrustUrl,
  heat_warning: hazardHeatUrl,
  water_splash: splash256Url,
  dock_refuel: null,
};

/**
 * Most important SFX to bring online first.
 * "trigger" points to the gameplay hook location.
 */
export const SFX_IMPORTANT = Object.freeze([
  { id: "ship_laser", priority: 1, trigger: "GameLoop._step when player shot is created", placeholderFile: "audio/fx/q009-sounds/q009/pistol_256k.mp3" },
  { id: "ship_hit", priority: 2, trigger: "GameLoop._damageShip", placeholderFile: "audio/fx/metalthunk.mp3" },
  { id: "ship_crash", priority: 3, trigger: "GameLoop._triggerCrash", placeholderFile: "audio/fx/qubodup-crash_256k.mp3" },
  { id: "bomb_explosion", priority: 4, trigger: "GameLoop player bomb detonation path", placeholderFile: "audio/fx/qubodup-crash_256k.mp3" },
  { id: "enemy_destroyed", priority: 5, trigger: "GameLoop enemy HP reaches 0 and removed", placeholderFile: "audio/fx/8bit_gunloop_explosion_256k.mp3" },
  { id: "enemy_fire", priority: 6, trigger: "Enemies._shoot", placeholderFile: "audio/fx/ghost_256k.mp3" },
  { id: "miner_rescued", priority: 7, trigger: "GameLoop miner boards ship", placeholderFile: "audio/fx/key-176034.mp3" },
  { id: "objective_complete", priority: 8, trigger: "When objective transitions to complete", placeholderFile: "audio/fx/levelcompletesplash.mp3" },
  { id: "ship_thrust_loop", priority: 9, trigger: "While ship thrust is active", placeholderFile: "audio/fx/engine_sound.mp3" },
  { id: "heat_warning", priority: 10, trigger: "Heat meter warning state", placeholderFile: "audio/fx/lava_256k.mp3" },
  { id: "water_splash", priority: 11, trigger: "GameLoop ship crosses water surface in/out", placeholderFile: "audio/fx/splash1_256k.mp3" },
  { id: "dock_refuel", priority: 12, trigger: "Docked and refilling hp/bombs", placeholderFile: "(placeholder only, pick clip)" },
]);

/**
 * @typedef {keyof typeof SFX_PLACEHOLDER_URLS} SfxId
 */

/**
 * Lightweight background music + SFX controller using native HTML audio.
 */
export class BackgroundMusic {
  /**
   * @param {{volume?:number}} [opts]
   */
  constructor(opts){
    const volume = opts && typeof opts.volume === "number" ? opts.volume : 0.35;
    this.musicVolume = Math.max(0, Math.min(1, volume));

    this.enabled = true;
    this.sfxEnabled = true;
    this.sfxMasterVolume = 0.7;
    this.combatMusicEnabled = true;
    /** @type {AudioContext|null} */
    this.webAudioCtx = null;
    /** @type {Map<SfxId, AudioBuffer>} */
    this.webAudioBuffers = new Map();
    /** @type {Map<SfxId, AudioBuffer[]>} */
    this.webAudioVariantBuffers = new Map();
    /** @type {Map<SfxId, Promise<AudioBuffer|null>>} */
    this.webAudioBufferPromises = new Map();
    /** @type {Set<SfxId>} */
    this.webAudioSfxIds = new Set(/** @type {SfxId[]} */ (WEB_AUDIO_SFX_IDS));

    this.audioUnlocked = false;
    this.sfxPrimed = false;

    this.trackIndex = 0;
    this.trackPlays = 0;
    this.mode = "ambient";
    this.victoryTriggered = false;

    this.combatActive = false;
    this.nextCombatEligibleAt = performance.now() + this._randomCombatDelayMs();
    this.lastCombatIndex = -1;

    this.audio = new Audio(AMBIENT_PLAYLIST[0]);
    this.audio.loop = false;
    this.audio.preload = "auto";
    this.audio.volume = this.musicVolume;
    this.audio.addEventListener("ended", () => this._onAmbientEnded());

    this.combatAudio = new Audio();
    this.combatAudio.loop = false;
    this.combatAudio.preload = "auto";
    this.combatAudio.volume = 0;
    this.combatAudio.addEventListener("ended", () => this._onCombatEnded());

    this.victoryAudio = new Audio(victoryMusicUrl);
    this.victoryAudio.loop = false;
    this.victoryAudio.preload = "auto";
    this.victoryAudio.volume = 0;
    this.victoryAudio.addEventListener("ended", () => this._onVictoryEnded());

    this.thrustLoopRequested = false;
    this.thrustLoopAudible = false;
    const thrustTemplateUrl = SFX_PLACEHOLDER_URLS.ship_thrust_loop;
    this.thrustLoopAudio = thrustTemplateUrl ? new Audio(thrustTemplateUrl) : null;
    if (this.thrustLoopAudio){
      this.thrustLoopAudio.loop = true;
      this.thrustLoopAudio.preload = "auto";
      this.thrustLoopAudio.volume = 0;
    }

    /** @type {Map<HTMLAudioElement, number>} */
    this.fadeTimers = new Map();

    /** @type {Map<SfxId, {voices:HTMLAudioElement[], next:number}>} */
    this.sfxPools = new Map();
    /** @type {Map<SfxId, number>} */
    this.sfxLastPlayAtMs = new Map();
    /** @type {Array<{id:SfxId,opts:{volume?:number,rate?:number}|undefined}>} */
    this.pendingSfx = [];
    for (const [id, url] of Object.entries(SFX_PLACEHOLDER_URLS)){
      if (!url) continue;
      if (id === "ship_thrust_loop") continue;
      const typedId = /** @type {SfxId} */ (id);
      const typedPoolId = /** @type {keyof typeof SFX_POOL_SIZE} */ (id);
      const voiceCount = (SFX_POOL_SIZE[typedPoolId] || DEFAULT_SFX_POOL_SIZE);
      /** @type {HTMLAudioElement[]} */
      const voices = [];
      for (let i = 0; i < voiceCount; i++){
        const el = new Audio(url);
        el.preload = "auto";
        voices.push(el);
      }
      this.sfxPools.set(typedId, { voices, next: 0 });
    }

    this._onFirstGesture = () => {
      this.audioUnlocked = true;
      this._detachGestureListeners();
      this._initWebAudioContext();
      this._preloadWebAudioSfx();
      this._playModeIfEnabled();
      this._primeSfx();
      this._flushPendingSfx();
      this._syncThrustLoopPlayback();
    };

    this._onVisibilityChange = () => {
      if (document.hidden){
        this._pauseAllMusic();
        if (this.thrustLoopAudio){
          this._cancelFade(this.thrustLoopAudio);
          this.thrustLoopAudio.pause();
          this.thrustLoopAudio.volume = 0;
        }
        this.thrustLoopAudible = false;
        return;
      }
      this._playModeIfEnabled();
      this._syncThrustLoopPlayback();
    };

    window.addEventListener("pointerdown", this._onFirstGesture, { passive: true });
    window.addEventListener("keydown", this._onFirstGesture, { passive: true });
    document.addEventListener("visibilitychange", this._onVisibilityChange, { passive: true });

    this._playModeIfEnabled();
  }

  /**
   * @returns {number}
   */
  _randomCombatDelayMs(){
    return COMBAT_TRIGGER_MIN_MS + Math.random() * (COMBAT_TRIGGER_MAX_MS - COMBAT_TRIGGER_MIN_MS);
  }

  /**
   * @returns {void}
   */
  _onAmbientEnded(){
    if (this.mode !== "ambient") return;
    this.trackPlays += 1;
    if (this.trackPlays < TRACK_PLAY_COUNT){
      this.audio.currentTime = 0;
      this._playAmbientIfEnabled();
      return;
    }
    this.trackPlays = 0;
    this.trackIndex = (this.trackIndex + 1) % AMBIENT_PLAYLIST.length;
    this.audio.src = AMBIENT_PLAYLIST[this.trackIndex];
    this.audio.load();
    this._playAmbientIfEnabled();
  }

  /**
   * @returns {void}
   */
  _onCombatEnded(){
    if (this.mode !== "combat") return;
    this._switchToAmbient(true);
    this.nextCombatEligibleAt =
      performance.now() + COMBAT_RETRIGGER_COOLDOWN_MS + this._randomCombatDelayMs();
  }

  /**
   * @returns {void}
   */
  _onVictoryEnded(){
    if (this.mode !== "victory") return;
    this._switchToAmbient(true);
  }

  /**
   * @param {HTMLAudioElement} el
   * @returns {void}
   */
  _playAudio(el){
    const maybePromise = el.play();
    if (maybePromise && typeof maybePromise.then === "function"){
      maybePromise.catch(() => {});
    }
  }

  /**
   * @returns {AudioContext|null}
   */
  _initWebAudioContext(){
    if (this.webAudioCtx) return this.webAudioCtx;
    const Ctor = window.AudioContext ||
      /** @type {typeof AudioContext | undefined} */ (/** @type {any} */ (window).webkitAudioContext);
    if (!Ctor) return null;
    try {
      this.webAudioCtx = new Ctor();
    } catch (_err){
      this.webAudioCtx = null;
    }
    return this.webAudioCtx;
  }

  /**
   * @param {AudioContext} ctx
   * @param {ArrayBuffer} data
   * @returns {Promise<AudioBuffer>}
   */
  _decodeAudioData(ctx, data){
    return new Promise((resolve, reject) => {
      /** @param {AudioBuffer} buffer */
      const done = (buffer) => resolve(buffer);
      /** @param {unknown} err */
      const fail = (err) => reject(err);
      try {
        const maybe = ctx.decodeAudioData(data, done, fail);
        if (maybe && typeof maybe.then === "function"){
          maybe.then(done).catch(fail);
        }
      } catch (err){
        reject(err);
      }
    });
  }

  /**
   * Pre-render one pitch-shifted variant so playback can stay at rate=1.
   * @param {AudioBuffer} baseBuffer
   * @param {number} rate
   * @returns {Promise<AudioBuffer|null>}
   */
  _renderPitchVariant(baseBuffer, rate){
    const r = Math.max(0.5, Math.min(2, rate));
    /** @type {typeof OfflineAudioContext|undefined} */
    const OfflineCtor = window.OfflineAudioContext
      || /** @type {any} */ (window).webkitOfflineAudioContext;
    if (!OfflineCtor) return Promise.resolve(null);
    try {
      const channels = Math.max(1, baseBuffer.numberOfChannels || 1);
      const length = Math.max(1, Math.ceil(baseBuffer.length / r));
      const offline = new OfflineCtor(channels, length, baseBuffer.sampleRate);
      const source = offline.createBufferSource();
      source.buffer = baseBuffer;
      source.playbackRate.value = r;
      source.connect(offline.destination);
      source.start(0);
      return offline.startRendering().catch(() => null);
    } catch (_err){
      return Promise.resolve(null);
    }
  }

  /**
   * @param {SfxId} id
   * @param {AudioBuffer} baseBuffer
   * @returns {Promise<AudioBuffer[]>}
   */
  async _buildWebAudioVariants(id, baseBuffer){
    const rates = WEB_AUDIO_SFX_VARIANT_RATES[id];
    if (!Array.isArray(rates) || rates.length <= 1){
      return [baseBuffer];
    }
    /** @type {AudioBuffer[]} */
    const out = [];
    for (const rate of rates){
      if (Math.abs(rate - 1) < 1e-6){
        out.push(baseBuffer);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const variant = await this._renderPitchVariant(baseBuffer, rate);
      out.push(variant || baseBuffer);
    }
    return out.length ? out : [baseBuffer];
  }

  /**
   * @param {SfxId} id
   * @returns {Promise<AudioBuffer|null>}
   */
  _ensureWebAudioBuffer(id){
    if (!this.webAudioSfxIds.has(id)) return Promise.resolve(null);
    const existing = this.webAudioBuffers.get(id);
    if (existing) return Promise.resolve(existing);
    const pending = this.webAudioBufferPromises.get(id);
    if (pending) return pending;
    const url = SFX_PLACEHOLDER_URLS[id];
    const ctx = this._initWebAudioContext();
    if (!url || !ctx) return Promise.resolve(null);
    const request = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("SFX fetch failed");
        return r.arrayBuffer();
      })
      .then((ab) => this._decodeAudioData(ctx, ab))
      .then(async (buffer) => {
        this.webAudioBuffers.set(id, buffer);
        this.webAudioVariantBuffers.set(id, [buffer]);
        const variants = await this._buildWebAudioVariants(id, buffer);
        this.webAudioVariantBuffers.set(id, variants);
        this.webAudioBufferPromises.delete(id);
        return buffer;
      })
      .catch((_err) => {
        this.webAudioBufferPromises.delete(id);
        return null;
      });
    this.webAudioBufferPromises.set(id, request);
    return request;
  }

  /**
   * @returns {void}
   */
  _preloadWebAudioSfx(){
    this.webAudioSfxIds.forEach((id) => {
      this._ensureWebAudioBuffer(id);
    });
  }

  /**
   * @param {SfxId} id
   * @param {number} volume
   * @param {number} rate
   * @returns {boolean}
   */
  _playWebAudioSfx(id, volume, rate){
    if (!this.webAudioSfxIds.has(id)) return false;
    const ctx = this._initWebAudioContext();
    if (!ctx) return false;
    if (ctx.state === "suspended"){
      const maybe = ctx.resume();
      if (maybe && typeof maybe.then === "function"){
        maybe.catch(() => {});
      }
    }
    const variants = this.webAudioVariantBuffers.get(id);
    let buffer = null;
    if (variants && variants.length){
      const i = (variants.length > 1) ? Math.floor(Math.random() * variants.length) : 0;
      buffer = variants[i];
    } else {
      buffer = this.webAudioBuffers.get(id) || null;
    }
    if (!buffer){
      this._ensureWebAudioBuffer(id);
      return false;
    }
    try {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      const usePreBakedPitch = !!(variants && variants.length > 1);
      source.playbackRate.value = usePreBakedPitch ? 1 : Math.max(0.5, Math.min(2, rate));
      gain.gain.value = Math.max(0, Math.min(1, volume * this.sfxMasterVolume));
      source.connect(gain);
      gain.connect(ctx.destination);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start(0);
      return true;
    } catch (_err){
      return false;
    }
  }

  /**
   * @returns {void}
   */
  _playAmbientIfEnabled(){
    if (!this.enabled || !this.audioUnlocked || document.hidden) return;
    this._playAudio(this.audio);
  }

  /**
   * @returns {void}
   */
  _playCombatIfEnabled(){
    if (!this.enabled || !this.audioUnlocked || document.hidden) return;
    this._playAudio(this.combatAudio);
  }

  /**
   * @returns {void}
   */
  _playVictoryIfEnabled(){
    if (!this.enabled || !this.audioUnlocked || document.hidden) return;
    this._playAudio(this.victoryAudio);
  }

  /**
   * @returns {void}
   */
  _playModeIfEnabled(){
    if (!this.enabled || !this.audioUnlocked || document.hidden) return;
    if (this.mode === "combat"){
      this._playCombatIfEnabled();
    } else if (this.mode === "victory"){
      this._playVictoryIfEnabled();
    } else {
      this._playAmbientIfEnabled();
    }
  }

  /**
   * @returns {void}
   */
  _pauseAllMusic(){
    this.audio.pause();
    this.combatAudio.pause();
    this.victoryAudio.pause();
  }

  /**
   * @param {HTMLAudioElement} el
   * @returns {void}
   */
  _cancelFade(el){
    const id = this.fadeTimers.get(el);
    if (typeof id === "number"){
      window.clearInterval(id);
      this.fadeTimers.delete(el);
    }
  }

  /**
   * @returns {void}
   */
  _cancelAllFades(){
    this.fadeTimers.forEach((id, el) => {
      window.clearInterval(id);
      this.fadeTimers.delete(el);
    });
  }

  /**
   * @param {HTMLAudioElement} el
   * @param {number} targetVolume
   * @param {number} durationMs
   * @param {(()=>void)|undefined} [onDone]
   * @returns {void}
   */
  _fadeAudio(el, targetVolume, durationMs, onDone){
    const target = Math.max(0, Math.min(1, targetVolume));
    this._cancelFade(el);
    if (durationMs <= 0){
      el.volume = target;
      if (onDone) onDone();
      return;
    }
    const startVol = el.volume;
    const startTime = performance.now();
    const timerId = window.setInterval(() => {
      const t = Math.max(0, Math.min(1, (performance.now() - startTime) / durationMs));
      el.volume = startVol + (target - startVol) * t;
      if (t >= 1){
        this._cancelFade(el);
        if (onDone) onDone();
      }
    }, 33);
    this.fadeTimers.set(el, timerId);
  }

  /**
   * @returns {string|null}
   */
  _pickCombatTrack(){
    if (!COMBAT_PLAYLIST.length) return null;
    if (COMBAT_PLAYLIST.length === 1){
      this.lastCombatIndex = 0;
      return COMBAT_PLAYLIST[0];
    }
    let i = Math.floor(Math.random() * COMBAT_PLAYLIST.length);
    if (i === this.lastCombatIndex){
      i = (i + 1 + Math.floor(Math.random() * (COMBAT_PLAYLIST.length - 1))) % COMBAT_PLAYLIST.length;
    }
    this.lastCombatIndex = i;
    return COMBAT_PLAYLIST[i];
  }

  /**
   * @returns {boolean}
   */
  _startCombatTrackRandom(){
    const track = this._pickCombatTrack();
    if (!track) return false;

    this.mode = "combat";
    this._cancelAllFades();
    this.combatAudio.src = track;
    this.combatAudio.currentTime = 0;
    this.combatAudio.load();
    this.combatAudio.volume = 0;

    this._playCombatIfEnabled();
    this._fadeAudio(this.audio, 0, MUSIC_CROSSFADE_MS, () => {
      this.audio.pause();
      this.audio.volume = this.musicVolume;
    });
    this._fadeAudio(this.victoryAudio, 0, MUSIC_CROSSFADE_MS, () => {
      this.victoryAudio.pause();
      this.victoryAudio.currentTime = 0;
    });
    this._fadeAudio(this.combatAudio, this.musicVolume, MUSIC_CROSSFADE_MS);
    return true;
  }

  /**
   * @param {boolean} withFade
   * @returns {void}
   */
  _switchToAmbient(withFade){
    this.mode = "ambient";
    if (!withFade){
      this._cancelAllFades();
      this.combatAudio.pause();
      this.combatAudio.currentTime = 0;
      this.victoryAudio.pause();
      this.victoryAudio.currentTime = 0;
      this.audio.volume = this.musicVolume;
      this._playAmbientIfEnabled();
      return;
    }
    this._cancelAllFades();
    this.audio.volume = 0;
    this._playAmbientIfEnabled();
    this._fadeAudio(this.combatAudio, 0, MUSIC_CROSSFADE_MS, () => {
      this.combatAudio.pause();
      this.combatAudio.currentTime = 0;
    });
    this._fadeAudio(this.victoryAudio, 0, MUSIC_CROSSFADE_MS, () => {
      this.victoryAudio.pause();
      this.victoryAudio.currentTime = 0;
    });
    this._fadeAudio(this.audio, this.musicVolume, MUSIC_CROSSFADE_MS);
  }

  /**
   * @param {boolean} active
   * @returns {boolean}
   */
  setCombatActive(active){
    this.combatActive = !!active;
    if (!this.combatActive && this.mode === "combat"){
      this._switchToAmbient(true);
      this.nextCombatEligibleAt = performance.now() + this._randomCombatDelayMs();
      return false;
    }
    if (!this.combatMusicEnabled || this.victoryTriggered) return false;
    if (!this.enabled || !this.audioUnlocked || document.hidden) return false;
    if (this.mode === "combat") return true;
    if (!this.combatActive) return false;
    if (performance.now() < this.nextCombatEligibleAt) return false;
    const started = this._startCombatTrackRandom();
    if (started){
      this.nextCombatEligibleAt = Number.POSITIVE_INFINITY;
    }
    return started;
  }

  /**
   * Immediately start combat music when combat is already active.
   * Bypasses randomized eligibility delay used for ambient pacing.
   * @returns {boolean}
   */
  triggerCombatImmediate(){
    this.combatActive = true;
    this.nextCombatEligibleAt = 0;
    if (!this.combatMusicEnabled || this.victoryTriggered) return false;
    if (this.mode === "combat") return true;
    if (!this.enabled || !this.audioUnlocked || document.hidden) return false;
    const started = this._startCombatTrackRandom();
    if (started){
      this.nextCombatEligibleAt = Number.POSITIVE_INFINITY;
    }
    return started;
  }

  /**
   * @returns {boolean}
   */
  toggleCombatMusicEnabled(){
    this.combatMusicEnabled = !this.combatMusicEnabled;
    if (!this.combatMusicEnabled){
      this.nextCombatEligibleAt = Number.POSITIVE_INFINITY;
      if (this.mode === "combat"){
        this._switchToAmbient(true);
      }
    } else {
      const now = performance.now();
      const next = now + this._randomCombatDelayMs();
      const soon = now + 7000 + Math.random() * 5000;
      this.nextCombatEligibleAt = this.combatActive ? Math.min(next, soon) : next;
    }
    return !this.combatMusicEnabled;
  }

  /**
   * @returns {boolean}
   */
  triggerVictoryMusic(){
    if (this.victoryTriggered) return false;
    this.victoryTriggered = true;
    this.combatActive = false;
    this.nextCombatEligibleAt = Number.POSITIVE_INFINITY;
    this.mode = "victory";
    this._cancelAllFades();

    this.victoryAudio.currentTime = 0;
    this.victoryAudio.volume = this.audioUnlocked ? 0 : this.musicVolume;
    this._playVictoryIfEnabled();
    this._fadeAudio(this.audio, 0, MUSIC_CROSSFADE_MS, () => {
      this.audio.pause();
      this.audio.volume = this.musicVolume;
    });
    this._fadeAudio(this.combatAudio, 0, MUSIC_CROSSFADE_MS, () => {
      this.combatAudio.pause();
      this.combatAudio.currentTime = 0;
    });
    this._fadeAudio(this.victoryAudio, this.musicVolume, MUSIC_CROSSFADE_MS);
    return true;
  }

  /**
   * @returns {void}
   */
  _detachGestureListeners(){
    window.removeEventListener("pointerdown", this._onFirstGesture);
    window.removeEventListener("keydown", this._onFirstGesture);
  }

  /**
   * @returns {void}
   */
  _syncThrustLoopPlayback(){
    if (!this.thrustLoopAudio) return;
    const shouldPlay = this.sfxEnabled && this.thrustLoopRequested && !document.hidden;
    const targetVolume = Math.max(0, Math.min(1, this.sfxMasterVolume * THRUST_LOOP_GAIN));
    if (shouldPlay === this.thrustLoopAudible){
      if (shouldPlay){
        if (this.thrustLoopAudio.paused){
          this._playAudio(this.thrustLoopAudio);
        }
        this.thrustLoopAudio.volume = targetVolume;
      }
      return;
    }

    this.thrustLoopAudible = shouldPlay;
    if (shouldPlay){
      if (this.thrustLoopAudio.paused){
        this._playAudio(this.thrustLoopAudio);
      }
      this._fadeAudio(this.thrustLoopAudio, targetVolume, THRUST_LOOP_FADE_IN_MS);
      return;
    }

    this._fadeAudio(this.thrustLoopAudio, 0, THRUST_LOOP_FADE_OUT_MS, () => {
      if (!this.thrustLoopAudio || this.thrustLoopAudible) return;
      this.thrustLoopAudio.pause();
    });
  }

  /**
   * @param {boolean} active
   * @returns {boolean}
   */
  setThrustLoopActive(active){
    const next = !!active;
    if (next === this.thrustLoopRequested) return this.thrustLoopRequested;
    this.thrustLoopRequested = next;
    this._syncThrustLoopPlayback();
    return this.thrustLoopRequested;
  }

  /**
   * Best-effort warm-up for first-play latency after user unlock.
   * @returns {void}
   */
  _primeSfx(){
    if (this.sfxPrimed) return;
    this.sfxPrimed = true;
    this.sfxPools.forEach((pool) => {
      const voice = pool.voices[0];
      if (!voice) return;
      voice.muted = true;
      const maybePromise = voice.play();
      if (maybePromise && typeof maybePromise.then === "function"){
        maybePromise
          .then(() => {
            voice.pause();
            voice.currentTime = 0;
            voice.muted = false;
          })
          .catch(() => {
            voice.muted = false;
          });
      } else {
        voice.pause();
        voice.currentTime = 0;
        voice.muted = false;
      }
    });
    if (this.thrustLoopAudio){
      this.thrustLoopAudio.muted = true;
      const maybePromise = this.thrustLoopAudio.play();
      if (maybePromise && typeof maybePromise.then === "function"){
        maybePromise
          .then(() => {
            if (this.thrustLoopAudio){
              this.thrustLoopAudio.pause();
              this.thrustLoopAudio.currentTime = 0;
              this.thrustLoopAudio.muted = false;
            }
          })
          .catch(() => {
            if (this.thrustLoopAudio){
              this.thrustLoopAudio.muted = false;
            }
          });
      } else {
        this.thrustLoopAudio.pause();
        this.thrustLoopAudio.currentTime = 0;
        this.thrustLoopAudio.muted = false;
      }
    }
  }

  /**
   * @param {SfxId} id
   * @param {{volume?:number,rate?:number}|undefined} opts
   * @returns {void}
   */
  _queuePendingSfx(id, opts){
    this.pendingSfx.push({ id, opts });
    if (this.pendingSfx.length > MAX_PENDING_SFX){
      this.pendingSfx.splice(0, this.pendingSfx.length - MAX_PENDING_SFX);
    }
  }

  /**
   * @returns {void}
   */
  _flushPendingSfx(){
    if (!this.pendingSfx.length) return;
    const queued = this.pendingSfx.slice();
    this.pendingSfx.length = 0;
    for (const item of queued){
      this.playSfx(item.id, item.opts);
    }
  }

  /**
   * Placeholder one-shot SFX trigger.
   * @param {SfxId} id
   * @param {{volume?:number, rate?:number}} [opts]
   * @returns {boolean}
   */
  playSfx(id, opts){
    if (!this.sfxEnabled) return false;
    if (!this.audioUnlocked){
      this._queuePendingSfx(id, opts);
      return false;
    }
    const nowMs = performance.now();
    const minInterval = SFX_MIN_INTERVAL_MS[id] || 0;
    const lastPlay = this.sfxLastPlayAtMs.get(id) || -Infinity;
    if (minInterval > 0 && (nowMs - lastPlay) < minInterval){
      return false;
    }
    const volume = opts && typeof opts.volume === "number" ? opts.volume : 1;
    const rate = opts && typeof opts.rate === "number" ? opts.rate : 1;
    if (this._playWebAudioSfx(id, volume, rate)){
      this.sfxLastPlayAtMs.set(id, nowMs);
      return true;
    }
    const pool = this.sfxPools.get(id);
    if (!pool || !pool.voices.length) return false;
    let voice = pool.voices.find((v) => v.paused || v.ended);
    if (!voice){
      voice = /** @type {HTMLAudioElement} */ (pool.voices[pool.next]);
      pool.next = (pool.next + 1) % pool.voices.length;
    }
    voice.currentTime = 0;
    voice.volume = Math.max(0, Math.min(1, volume * this.sfxMasterVolume));
    voice.playbackRate = Math.max(0.5, Math.min(2, rate));
    const maybePromise = voice.play();
    if (maybePromise && typeof maybePromise.then === "function"){
      maybePromise.catch(() => {});
    }
    this.sfxLastPlayAtMs.set(id, nowMs);
    return true;
  }

  /**
   * @returns {boolean}
   */
  toggleSfxMuted(){
    this.sfxEnabled = !this.sfxEnabled;
    this._syncThrustLoopPlayback();
    return !this.sfxEnabled;
  }

  /**
   * @returns {ReadonlyArray<{id:string,priority:number,trigger:string,placeholderFile:string}>}
   */
  listImportantSfx(){
    return SFX_IMPORTANT;
  }

  /**
   * Step music volume in 10% increments and apply immediately.
   * @param {number} direction Positive to increase, negative to decrease.
   * @returns {number} New volume in percent [0..100].
   */
  stepMusicVolume(direction){
    const dir = (direction || 0) >= 0 ? 1 : -1;
    const stepPercent = 10;
    const currentPercent = Math.round(this.musicVolume * 100);
    const nextPercent = (dir > 0)
      ? Math.min(100, (Math.floor(currentPercent / stepPercent) + 1) * stepPercent)
      : Math.max(0, (Math.ceil(currentPercent / stepPercent) - 1) * stepPercent);
    this.musicVolume = nextPercent / 100;

    this._cancelAllFades();
    if (this.mode === "combat"){
      this.audio.volume = 0;
      this.victoryAudio.volume = 0;
      this.combatAudio.volume = this.enabled ? this.musicVolume : 0;
    } else if (this.mode === "victory"){
      this.audio.volume = 0;
      this.combatAudio.volume = 0;
      this.victoryAudio.volume = this.enabled ? this.musicVolume : 0;
    } else {
      this.combatAudio.volume = 0;
      this.victoryAudio.volume = 0;
      this.audio.volume = this.enabled ? this.musicVolume : 0;
    }
    return nextPercent;
  }

  /**
   * Step SFX master volume in 10% increments and apply immediately.
   * @param {number} direction Positive to increase, negative to decrease.
   * @returns {number} New volume in percent [0..100].
   */
  stepSfxVolume(direction){
    const dir = (direction || 0) >= 0 ? 1 : -1;
    const stepPercent = 10;
    const currentPercent = Math.round(this.sfxMasterVolume * 100);
    const nextPercent = (dir > 0)
      ? Math.min(100, (Math.floor(currentPercent / stepPercent) + 1) * stepPercent)
      : Math.max(0, (Math.ceil(currentPercent / stepPercent) - 1) * stepPercent);
    this.sfxMasterVolume = nextPercent / 100;
    this._syncThrustLoopPlayback();
    return nextPercent;
  }

  /**
   * @returns {boolean}
   */
  toggleMuted(){
    this.enabled = !this.enabled;
    if (this.enabled){
      this._playModeIfEnabled();
    } else {
      this._pauseAllMusic();
    }
    this._syncThrustLoopPlayback();
    return !this.enabled;
  }

  /**
   * Force music back to ambient playlist, used on level transitions.
   * @param {boolean} [withFade]
   * @returns {void}
   */
  returnToAmbient(withFade = true){
    this.victoryTriggered = false;
    this.combatActive = false;
    this.mode = "ambient";
    this._switchToAmbient(!!withFade);
    this.nextCombatEligibleAt = performance.now() + this._randomCombatDelayMs();
  }
}
