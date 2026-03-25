// @ts-check
/** @typedef {import("./game.js").Game} Game */

import * as collisionDropship from "./collision_dropship.js";
import { GAME } from "./config.js";
import * as dashboardUi from "./dashboard.js";
import { drawGameOverlay } from "./overlay.js";
import * as feedback from "./feedback.js";
import { PERF_FLAGS } from "./perf.js";
import * as planetVisuals from "./planet_visuals.js";
import { copyGameplayScreenshotToClipboard } from "./screenshot.js";

/** @typedef {import("./types.d.js").RenderState} RenderState */

/** @type {any[]} */
const EMPTY_RENDER_ARRAY = [];
Object.freeze(EMPTY_RENDER_ARRAY);

const EMPTY_FEATURE_PARTICLES = Object.freeze({
  iceShard: [],
  lava: [],
  ventPlume: [],
  spores: [],
  bubbles: [],
  splashes: [],
});

/**
 * @param {Game} game
 * @param {boolean} transitionActive
 * @param {{x:number,y:number}|null} transitionFogOrigin
 * @returns {boolean}
 */
export function syncRenderFog(game, transitionActive, transitionFogOrigin){
  const fogSyncEnabled = !PERF_FLAGS.disableFogSync;
  if (!game.planet || !game.renderer || !fogSyncEnabled) return fogSyncEnabled;
  if (!transitionActive){
    game.planet.syncRenderFog(game.renderer, game.ship.x, game.ship.y);
  } else if (transitionFogOrigin){
    game.planet.syncRenderFog(game.renderer, transitionFogOrigin.x, transitionFogOrigin.y);
  }
  return fogSyncEnabled;
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").InputState} inputState
 * @param {{transitionActive:boolean,fogSyncEnabled:boolean}} opts
 * @returns {RenderState}
 */
export function buildRenderState(game, inputState, opts){
  const dynamicOverlayEnabled = !PERF_FLAGS.disableDynamicOverlay;
  const debugState = game.debugState;
  const perfState = game.perfState;
  /** @type {RenderState} */
  let renderState = {
    view: game.camera.view,
    ship: game.ship,
    mothership: game.mothership,
    debris: game.debris,
    input: inputState,
    debugCollisions: debugState.collisions,
    debugNodes: GAME.DEBUG_NODES,
    debugPlanetTriangles: debugState.planetTriangles,
    debugCollisionContours: debugState.collisionContours,
    debugRingVertices: debugState.ringVertices,
    debugMinerGuidePath: debugState.minerGuidePath,
    debugMinerPathToMiner: debugState.minerPathToMiner,
    debugCollisionSamples: (debugState.collisions || debugState.collisionContours) ? (game.ship._samples || []) : null,
    debugPoints: ((debugState.collisions && GAME.DEBUG_NODES) || debugState.ringVertices) ? game.planet.debugPoints() : null,
    fogEnabled: game.fogEnabled && opts.fogSyncEnabled,
    fps: perfState.fps,
    finalAir: game.planet.getFinalAir(),
    miners: dynamicOverlayEnabled ? game.miners : EMPTY_RENDER_ARRAY,
    fallenMiners: dynamicOverlayEnabled ? game.fallenMiners : EMPTY_RENDER_ARRAY,
    minersRemaining: game.minersRemaining,
    minerTarget: game.minerTarget,
    level: game.level,
    minersDead: game.minersDead,
    healthPickups: dynamicOverlayEnabled ? game.healthPickups : EMPTY_RENDER_ARRAY,
    pickupAnimations: dynamicOverlayEnabled ? game.pickupAnimations : EMPTY_RENDER_ARRAY,
    enemies: dynamicOverlayEnabled ? game.enemies.enemies : EMPTY_RENDER_ARRAY,
    mechanizedLarvae: dynamicOverlayEnabled ? game.mechanizedLarvae : EMPTY_RENDER_ARRAY,
    shots: dynamicOverlayEnabled ? game.enemies.shots : EMPTY_RENDER_ARRAY,
    explosions: dynamicOverlayEnabled ? game.enemies.explosions : EMPTY_RENDER_ARRAY,
    fragments: dynamicOverlayEnabled ? game.fragments.concat(game.enemies.debris) : EMPTY_RENDER_ARRAY,
    playerShots: dynamicOverlayEnabled ? game.playerShots : EMPTY_RENDER_ARRAY,
    playerBombs: dynamicOverlayEnabled ? game.playerBombs : EMPTY_RENDER_ARRAY,
    featureParticles: dynamicOverlayEnabled ? game.planet.getFeatureParticles() : EMPTY_FEATURE_PARTICLES,
    entityExplosions: dynamicOverlayEnabled ? game.entityExplosions : EMPTY_RENDER_ARRAY,
    aimWorld: game.ship.state === "crashed" ? null : game.lastAimWorld,
    aimOrigin: game.ship.state === "crashed" ? null : collisionDropship.shipGunPivotWorld(game),
    planetPalette: planetVisuals.planetPalette(game),
    touchUi: game.ship.state === "crashed" ? null : inputState.touchUi,
  };
  if (opts.transitionActive){
    renderState = game.jumpdriveTransition.decorateRenderState(renderState);
  }
  return renderState;
}

/**
 * @param {Game} game
 * @param {RenderState} renderState
 * @returns {void}
 */
export function draw(game, renderState){
  game._lastRenderState = renderState;
  game.renderer.drawFrame(renderState, game.planet);
  drawGameOverlay(game);
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").InputState} inputState
 * @param {RenderState} renderState
 * @returns {void}
 */
export function handleScreenshotCapture(game, inputState, renderState){
  const feedbackState = game.feedbackState;
  const titleState = game.titleState;
  const captureScreenshot = !!inputState.copyScreenshot;
  const captureScreenshotClean = !!inputState.copyScreenshotClean;
  const captureScreenshotCleanTitle = !!inputState.copyScreenshotCleanTitle;
  if (!(captureScreenshot || captureScreenshotClean || captureScreenshotCleanTitle)) return;
  if (feedbackState.screenshotCopyInFlight) return;

  const mode = captureScreenshotCleanTitle ? "cleanTitle" : (captureScreenshotClean ? "clean" : "full");
  const clean = mode !== "full";
  const includeStartTitle = mode === "cleanTitle" || (clean && !titleState.seen && titleState.alpha > 0);
  feedbackState.screenshotCopyInFlight = true;
  void copyGameplayScreenshotToClipboard({
    canvas: game.canvas,
    overlay: game.overlay,
    renderState,
    clean,
    drawFrame: (state) => game.renderer.drawFrame(state, game.planet),
    redrawOverlay: () => drawGameOverlay(game),
    includeStartTitle,
    startTitleText: titleState.text || "DROPSHIP",
    startTitleAlpha: mode === "cleanTitle" ? 1 : titleState.alpha,
  }).then((result) => {
    if (result === "ok"){
      feedback.showStatusCue(
        game,
        mode === "cleanTitle"
          ? "Title screenshot copied"
          : clean
            ? "Clean screenshot copied"
            : "Screenshot copied"
      );
    } else if (result === "unsupported"){
      feedback.showStatusCue(game, "Clipboard image copy unsupported");
    } else {
      feedback.showStatusCue(game, "Screenshot copy failed");
    }
  }).finally(() => {
    feedbackState.screenshotCopyInFlight = false;
  });
}

/**
 * Render-only frame phase. By the time this runs, gameplay state updates for the
 * current frame should already be complete.
 * @param {Game} game
 * @param {import("./types.d.js").InputState} inputState
 * @param {{
 *  now:number,
 *  dt:number,
 *  transitionActive:boolean,
 *  transitionFogOrigin:{x:number,y:number}|null,
 *  hudVisible:boolean,
 *  titleShowing:boolean,
 *  runEnded:boolean,
 * }} opts
 * @returns {RenderState}
 */
export function renderFrame(game, inputState, opts){
  const fogSyncEnabled = syncRenderFog(game, opts.transitionActive, opts.transitionFogOrigin);
  const renderState = buildRenderState(game, inputState, {
    transitionActive: opts.transitionActive,
    fogSyncEnabled,
  });
  draw(game, renderState);
  handleScreenshotCapture(game, inputState, renderState);
  dashboardUi.renderHudPanels(game, inputState, opts.now, renderState, {
    hudVisible: opts.hudVisible,
    dashboardOpen: dashboardUi.dashboardOpen(game, opts.transitionActive, opts.runEnded),
    titleShowing: opts.titleShowing,
    transitionActive: opts.transitionActive,
    dt: opts.dt,
  });
  return renderState;
}


