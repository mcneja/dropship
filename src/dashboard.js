// @ts-check
/** @typedef {import("./game.js").Game} Game */

import { GAME } from "./config.js";
import * as dropship from "./dropship.js";
import * as meltdown from "./meltdown.js";
import * as missions from "./missions.js";
import * as planetFog from "./planet_fog.js";
import * as planetVisuals from "./planet_visuals.js";
import * as stats from "./stats.js";
import * as tether from "./tether.js";

export class DashboardState {
  constructor(){
    this.dirty = true;
    this.wasOpen = false;
    this.lastStatusText = "";
    this.lastPreviewRotation = Number.NaN;
  }
}

/**
 * @param {Game} game
 * @returns {string}
 */
export function dashboardMissionMeta(game){
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  return cfg ? `Level ${game.level} | ${cfg.label}` : `Level ${game.level}`;
}

/**
 * @param {Game} game
 * @returns {string}
 */
export function dashboardMissionSectionLabel(game){
  return missions.runEnded(game) ? "Epilogue" : "Current Objective";
}

/**
 * @param {Game} game
 * @returns {string}
 */
export function dashboardMissionTitle(game){
  if (missions.runEnded(game)){
    return dashboardFinalReportTitle(game);
  }
  return missions.objectiveText(game).replace(/^Objective:\s*/, "");
}

/**
 * @param {any} cfg
 * @returns {string}
 */
export function dashboardPlanetDescription(cfg){
  if (!cfg) return "";
  switch (cfg.id){
    case "barren_pickup": return "Airless shell-world with knife ridges, bright rock faces, and wide exposed approaches.";
    case "barren_clear": return "Hard gray badlands with old fortifications, sparse cover, and long clear sightlines.";
    case "molten": return "A furnace crust wrapped around an exposed molten interior with violent heat gradients.";
    case "ice": return "Blue-white ice crust, low traction, cold caverns, and long sliding landings.";
    case "gaia": return "Dense surface growth over heavy rock, with rich color, layered canopy, and hidden voids.";
    case "water": return "Flooded sinkhole world with drag-heavy air, buoyant shallows, and deep water chambers.";
    case "cavern": return "Classic cave world with ambush tunnels, broken chambers, and jagged interior routes.";
    case "mechanized": return "Industrial rock chained in steel, with factory structures and a rigid fortified shell.";
    default: return cfg.label || "";
  }
}

/**
 * @param {Game} game
 * @returns {string}
 */
export function dashboardMissionBody(game){
  if (missions.runEnded(game)){
    return dashboardFinalReportBody(game);
  }
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  const planetFluff = dashboardProceduralMissionBody(game);
  if (planetFluff) return planetFluff;
  if (game.objective && game.objective.type === "destroy_core"){
    return "The core is unstable and the whole world knows it. Cut the tethers, trigger the collapse, and run for open sky.";
  }
  if (game.objective && game.objective.type === "destroy_factories"){
    return "Industrial resistance is dug in deep. Crack the production line, keep pressure on the surface, and deny them time to rebuild.";
  }
  if (game.objective && game.objective.type === "clear"){
    return "This one calls for a hard sweep. Burn down every hostile contact you can find, then lift out before the debris settles.";
  }
  if (game.objective && game.objective.type === "extract"){
    return "The window is narrow. Touch down fast, pull the survivors out, and get them back upstairs before the locals regroup.";
  }
  return "Keep the mothership in sight, stay disciplined on approach, and leave the orbit cleaner than you found it.";
}

/**
 * @param {Game} game
 * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
 * @param {number} now
 * @returns {string}
 */
export function dashboardMissionStatus(game, inputType, now){
  if (missions.runEnded(game)){
    return objectivePromptText(game, inputType) || "Game over.";
  }
  if (objectiveComplete(game)){
    return dashboardMissionCompleteText(game);
  }
  if (now < game.feedbackState.statusCueUntil && game.feedbackState.statusCueText){
    return game.feedbackState.statusCueText;
  }
  return objectivePromptText(game, inputType) || "";
}

/**
 * @param {Game} game
 * @returns {string}
 */
export function dashboardMissionCompleteText(game){
  if (game.objective && game.objective.type === "destroy_core"){
    return game.coreMeltdownActive
      ? "Mission complete. Core collapse confirmed."
      : "Mission complete. Core defenses are down.";
  }
  if (game.objective && game.objective.type === "destroy_factories"){
    return "Mission complete. Factory production has been silenced.";
  }
  if (game.objective && game.objective.type === "clear"){
    return "Mission complete. Local hostile resistance has been cleared.";
  }
  return "Mission complete. Survivors are accounted for.";
}

/**
 * @param {Game} game
 * @returns {Array<{label:string,value:string}>}
 */
export function dashboardShipRows(game){
  return [
    { label: "Hull", value: `${game.ship.hpCur}/${game.ship.hpMax}` },
    { label: "Bombs", value: `${game.ship.bombsCur}/${game.ship.bombsMax}` },
    { label: "Tech", value: dashboardPerkSummary(game) || "None" },
  ];
}

/**
 * @param {Game} game
 * @returns {Array<{label:string,level:string,total:string}>}
 */
export function dashboardStatsRows(game){
  return [
    { label: "Rescues", level: String(game.levelStats.rescued), total: String(game.overallStats.rescued) },
    { label: "Miners Lost", level: String(game.levelStats.minersLost), total: String(game.overallStats.minersLost) },
    { label: "Dropships Lost", level: String(game.levelStats.dropshipsLost), total: String(game.overallStats.dropshipsLost) },
    { label: "Hostile Kills", level: String(game.levelStats.enemiesDestroyed), total: String(game.overallStats.enemiesDestroyed) },
    { label: "Hostiles", level: String(game.levelStats.hostiles), total: String(game.overallStats.hostiles) },
    { label: "Docks", level: String(game.levelStats.docks), total: String(game.overallStats.docks) },
    { label: "Shots Fired", level: String(game.levelStats.shotsFired), total: String(game.overallStats.shotsFired) },
    { label: "Bombs Fired", level: String(game.levelStats.bombsFired), total: String(game.overallStats.bombsFired) },
  ];
}

/**
 * @param {Game} game
 * @returns {number}
 */
export function signalStrength(game){
  let dMin = Infinity;
  for (const m of game.miners){
    const dx = m.x - game.ship.x;
    const dy = m.y - game.ship.y;
    const d = Math.hypot(dx, dy);
    dMin = Math.min(dMin, d);
  }
  return Math.ceil(Math.max(0, 10 - dMin));
}

/**
 * @param {Game} game
 * @param {boolean} transitionActive
 * @returns {void}
 */
export function syncInputUi(game, transitionActive){
  const dockedNow = dropship.isDockedWithMothership(game);
  const touchStartMode = transitionActive ? null : touchStartActionMode(game);
  game.input.setTouchActionMode(touchStartMode);
  game.input.setTouchDocked(!transitionActive && dockedNow);
  game.input.setMouseDocked(!transitionActive && dockedNow);
  game.input.setTouchPerkChoiceActive(game.pendingPerkChoice !== null);
  game.input.setGameOver(!transitionActive && game.ship.state === "crashed");
}

/**
 * @param {Game} game
 * @param {import("./types.d.js").InputState} inputState
 * @param {number} now
 * @param {any} renderState
 * @param {{hudVisible:boolean,dashboardOpen:boolean,titleShowing:boolean,transitionActive:boolean,dt:number}} opts
 * @returns {void}
 */
export function renderHudPanels(game, inputState, now, renderState, opts){
  const {
    hudVisible,
    dashboardOpen,
    titleShowing,
    transitionActive,
    dt,
  } = opts;
  const dashboardState = game.dashboardState;
  const feedbackState = game.feedbackState;
  const titleState = game.titleState;
  const perfState = game.perfState;
  const perkChoiceVisible = game.pendingPerkChoice !== null;
  const cornerHudSuppressed = titleShowing || transitionActive || dashboardOpen || perkChoiceVisible;
  const objectiveHudSuppressed = transitionActive || perkChoiceVisible;

  if (hudVisible){
    game.ui.updateHud(game.hud, {
      fps: perfState.fps,
      state: game.ship.state,
      speed: Math.hypot(game.ship.vx, game.ship.vy),
      shipHp: game.ship.hpCur,
      bombs: game.ship.bombsCur,
      verts: game.planet.radial.vertCount,
      air: game.planet.getFinalAir(),
      miners: game.minersRemaining,
      minersDead: game.minersDead,
      level: game.level,
      debug: game.debugState.collisions,
      minerCandidates: game.minerCandidates,
      landingDebug: game.ship._landingDebug || null,
      inputType: inputState.inputType,
      frameStats: perfState.frameStats,
      benchState: perfState.benchmarkRun ? perfState.benchmarkRun.stateText : null,
      perfFlags: perfState.flags,
    });
  }

  if (game.dashboard && game.ui.updateMothershipDashboard){
    if (dashboardOpen){
      const missionStatus = dashboardMissionStatus(game, inputState.inputType, now);
      const previewRotation = renderState.view.angle;
      const lastPreviewRotation = dashboardState.lastPreviewRotation;
      const previewRotationDelta = Number.isFinite(lastPreviewRotation)
        ? Math.abs(Math.atan2(
          Math.sin(previewRotation - lastPreviewRotation),
          Math.cos(previewRotation - lastPreviewRotation)
        ))
        : Infinity;
      if (
        dashboardState.dirty
        || !dashboardState.wasOpen
        || missionStatus !== dashboardState.lastStatusText
        || previewRotationDelta > 0.005
      ){
        const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
        const worldRadius = game.planet && game.planet.getWorldRadius
          ? game.planet.getWorldRadius()
          : game.planetParams.RMAX;
        const surfaceRadius = game.planet && game.planet.getSurfaceShellRadius
          ? game.planet.getSurfaceShellRadius()
          : Math.max(0, worldRadius - 0.5);
        game.ui.updateMothershipDashboard(game.dashboard, {
          open: true,
          shipRows: dashboardShipRows(game),
          statsRows: dashboardStatsRows(game),
          missionHeader: missions.runEnded(game) ? "Final Report" : "Mission Brief",
          missionSectionLabel: dashboardMissionSectionLabel(game),
          missionMeta: dashboardMissionMeta(game),
          missionTitle: dashboardMissionTitle(game),
          missionBody: dashboardMissionBody(game),
          missionStatus,
          planetLabel: cfg ? cfg.label : `Level ${game.level}`,
          planetNote: dashboardPlanetDescription(cfg),
            planetPreview: {
              planet: {
                airValueAtWorld: (/** @type {number} */ x, /** @type {number} */ y) => game.planet.airValueAtWorld(x, y),
                shadeAtWorld: (/** @type {number} */ x, /** @type {number} */ y) => game.planet.shadeAtWorld(x, y),
                fogSeenAt: (/** @type {number} */ x, /** @type {number} */ y) => planetFog.fogSeenAt(game.planet, x, y),
                fogAlphaAtWorld: (/** @type {number} */ x, /** @type {number} */ y) => planetFog.fogAlphaAtWorld(game.planet, x, y),
                getSeed: () => game.planet.getSeed(),
              },
            palette: planetVisuals.planetPalette(game),
            worldRadius,
            surfaceRadius,
            fogEnabled: game.fogEnabled,
            rotation: previewRotation,
          },
        });
        dashboardState.dirty = false;
        dashboardState.lastStatusText = missionStatus;
        dashboardState.lastPreviewRotation = previewRotation;
      }
      const dashboardScrollY = dashboardScrollAxis();
      if (Math.abs(dashboardScrollY) > 0.01 && game.ui.scrollMothershipDashboard){
        game.ui.scrollMothershipDashboard(game.dashboard, dashboardScrollY * 720 * dt);
      }
      dashboardState.wasOpen = true;
    } else {
      if (dashboardState.wasOpen){
        game.ui.updateMothershipDashboard(game.dashboard, { open: false, shipRows: [], statsRows: [], missionTitle: "", missionBody: "", missionStatus: "" });
        dashboardState.lastStatusText = "";
        dashboardState.lastPreviewRotation = NaN;
      }
      dashboardState.wasOpen = false;
    }
  }

  const heat = game.ship.heat || 0;
  const showHeat = !hudVisible && !cornerHudSuppressed && meltdown.heatMechanicsActive(game);
  const heating = showHeat && (heat > game.lastHeat + 0.1);
  game.lastHeat = heat;
  if (game.heatMeter && game.ui.updateHeatMeter){
    game.ui.updateHeatMeter(game.heatMeter, heat, showHeat, heating);
  }

  if (game.planetLabel){
    game.planetLabel.style.visibility = cornerHudSuppressed ? "hidden" : "visible";
    if (!cornerHudSuppressed && game.ui.updatePlanetLabel){
      const cfg = game.planet.getPlanetConfig();
      const label = cfg ? cfg.label : "";
      const prefix = `Level ${game.level}: `;
      game.ui.updatePlanetLabel(game.planetLabel, label ? `${prefix}${label}` : `Level ${game.level}`);
    }
  }

  if (game.objectiveLabel){
    game.objectiveLabel.style.visibility = objectiveHudSuppressed ? "hidden" : "visible";
    game.objectiveLabel.classList.toggle("objective-centered", !!dashboardOpen);
    const abandonHoldActive = !!inputState.abandonHoldActive;
    const abandonHoldRemainingMs = (typeof inputState.abandonHoldRemainingMs === "number")
      ? inputState.abandonHoldRemainingMs
      : 0;
    game.objectiveLabel.style.color = abandonHoldActive ? "rgb(255, 72, 72)" : "";
    if (!objectiveHudSuppressed && game.ui.updateObjectiveLabel){
      if (abandonHoldActive){
        game.ui.updateObjectiveLabel(game.objectiveLabel, abandonHoldCountdownText(abandonHoldRemainingMs));
      } else {
        const cue = (now < feedbackState.statusCueUntil) ? feedbackState.statusCueText : "";
        if (cue){
          game.ui.updateObjectiveLabel(game.objectiveLabel, cue);
        } else if (titleShowing && game.ship.state !== "crashed"){
          game.ui.updateObjectiveLabel(game.objectiveLabel, startObjectiveText(inputState.inputType));
        } else {
          const prompt = objectivePromptText(game, inputState.inputType);
          const objectiveText = prompt || missions.objectiveText(game);
          if (game.ship.state !== "crashed" && titleState.newGameHelpPromptT > 0){
            const helpLine = helpPromptLine(inputState.inputType);
            game.ui.updateObjectiveLabel(game.objectiveLabel, objectiveText ? `${helpLine}\n${objectiveText}` : helpLine);
          } else {
            game.ui.updateObjectiveLabel(game.objectiveLabel, objectiveText);
          }
        }
      }
    }
  }

  if (game.shipStatusLabel){
    game.shipStatusLabel.style.visibility = cornerHudSuppressed ? "hidden" : "visible";
    if (!cornerHudSuppressed && game.ui.updateShipStatusLabel){
      game.ui.updateShipStatusLabel(game.shipStatusLabel, {
        shipHp: game.ship.hpCur,
        shipHpMax: game.ship.hpMax,
        bombs: game.ship.bombsCur,
        bombsMax: game.ship.bombsMax,
      });
    }
  }

  if (game.signalMeter && game.ui.updateSignalMeter){
    game.ui.updateSignalMeter(game.signalMeter, signalStrength(game), !hudVisible && !cornerHudSuppressed);
  }
}

/**
 * @param {Game} game
 * @param {boolean} transitionActive
 * @param {boolean} runEnded
 * @returns {boolean}
 */
export function dashboardOpen(game, transitionActive, runEnded){
  return !transitionActive
    && game.pendingPerkChoice === null
    && !game.planetView
    && (game.hasLaunchedPlayerShip || runEnded)
    && (dropship.isDockedWithMothership(game) || runEnded);
}

/**
 * @param {Game} game
 * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
 * @returns {string}
 */
export function objectivePromptText(game, inputType){
  const type = inputType || "keyboard";
  const startButtonPrefix =
    (type === "touch") ? `Tap ${touchActionPromptLabel(touchStartActionMode(game))} to ` :
    (type === "gamepad") ? "Press Button0 to " :
    "Press R to ";
  if (game.pendingPerkChoice){
    if (type === "touch") return "Choose upgrade: tap left or right option.";
    if (type === "mouse") return "Choose upgrade: click a card or press left/right.";
    return "Choose upgrade: press left/right.";
  }
  if (game.ship.state === "crashed"){
    if (game.ship.mothershipPilots > 0){
      return startButtonPrefix + "launch a new dropship.";
    }
    return "Game over. " + startButtonPrefix + "start a new game.";
  }
  if (dropship.isDockedWithMothership(game)){
    if (game.ship.mothershipEngineers > 0) return startButtonPrefix + "choose an upgrade.";
    if (game.missionState.levelAdvanceReady) return startButtonPrefix + "fly to next planet.";
    if (game.ship.planetScanner){
      return game.planetView ? startButtonPrefix + "exit planet scan." : startButtonPrefix + "view planet scan.";
    }
  }
  if (objectiveComplete(game)){
    if (game.objective && game.objective.type === "destroy_core"){
      return "Core meltdown! Return to mothership.";
    }
    return "Objective complete! Return to mothership.";
  }
  return "";
}

/**
 * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
 * @returns {string}
 */
export function startObjectiveText(inputType){
  if ((inputType || "keyboard") === "touch"){
    return `Tap ${touchLaunchPromptLabel()} to lift off, or tap ${helpActionLabel(inputType)} for help.`;
  }
  return `Lift off to start, or press ${helpActionLabel(inputType)} for help.`;
}

/**
 * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
 * @returns {string}
 */
export function helpPromptLine(inputType){
  if ((inputType || "keyboard") === "touch"){
    return `Tap ${helpActionLabel(inputType)} for help. ${abandonPromptText(inputType || "keyboard")}`;
  }
  return `Press ${helpActionLabel(inputType)} for help. ${abandonPromptText(inputType || "keyboard")}`;
}

/**
 * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
 * @returns {string}
 */
export function abandonPromptText(inputType){
  const type = inputType || "keyboard";
  if (type === "touch") return "Hold ↻ to restart.";
  if (type === "gamepad") return "Hold Start to restart.";
  return "Hold Shift+R to restart.";
}

/**
 * @param {number} remainingMs
 * @returns {string}
 */
export function abandonHoldCountdownText(remainingMs){
  return `Abandoning run in ${Math.ceil(Math.max(0, remainingMs || 0) / 1000)} seconds`;
}

/**
 * @param {Game} game
 * @returns {"respawnShip"|"restartGame"|"upgrade"|"nextLevel"|"viewMap"|"exitMap"|null}
 */
export function touchStartActionMode(game){
  if (game.ship.state === "crashed"){
    return (game.ship.mothershipPilots > 0) ? "respawnShip" : "restartGame";
  }
  if (!dropship.isDockedWithMothership(game) || game.pendingPerkChoice !== null){
    return null;
  }
  if (game.ship.mothershipEngineers > 0) return "upgrade";
  if (game.missionState.levelAdvanceReady) return "nextLevel";
  if (game.ship.planetScanner) return game.planetView ? "exitMap" : "viewMap";
  return null;
}

/**
 * @param {Game} game
 * @returns {boolean}
 */
export function objectiveComplete(game){
  const objType = game.objective ? game.objective.type : "extract";
  if (objType === "clear") return missions.remainingClearTargets(game) === 0;
  if (objType === "destroy_factories"){
    const progress = missions.factoryObjectiveProgress(game);
    return progress.target <= 0 || progress.done >= progress.target;
  }
  if (objType === "extract") return game.minersRemaining === 0;
  if (objType === "destroy_core") return game.coreMeltdownActive || tether.tetherPropsAlive(game).length === 0;
  return false;
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function presentNextPerkChoice(game){
  console.assert(game.ship.mothershipEngineers > 0);
  const choices = pickPerkChoices(perksAvailable(game));
  game.pendingPerkChoice = choices.map((perk) => ({ perk, text: perkChoiceText(game, perk) }));
  --game.ship.mothershipEngineers;
  stats.markDashboardDirty(game);
}

/**
 * @param {Game} game
 * @param {boolean} leftPressed
 * @param {boolean} rightPressed
 * @returns {void}
 */
export function handlePerkChoiceInput(game, leftPressed, rightPressed){
  const i = leftPressed ? 0 : rightPressed ? 1 : 2;
  const pending = game.pendingPerkChoice;
  if (pending && i < pending.length){
    applyPerk(game, /** @type {{perk:string}} */ (pending[i]).perk);
    game.pendingPerkChoice = null;
    stats.markDashboardDirty(game);
  }
}

/**
 * @param {Game} game
 * @returns {string}
 */
function dashboardProceduralMissionBody(game){
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  return [
    dashboardWorldSentence(game, cfg),
    dashboardThreatSentence(game, cfg),
    dashboardObjectiveSentence(game, cfg),
  ].filter(Boolean).join(" ");
}

/**
 * @returns {number}
 */
function dashboardScrollAxis(){
  return rawDashboardGamepadScrollAxis();
}

/**
 * @returns {number}
 */
function rawDashboardGamepadScrollAxis(){
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") return 0;
  const pads = navigator.getGamepads() || [];
  let best = 0;
  for (const pad of pads){
    if (!pad || pad.connected === false) continue;
    const raw = (pad.axes && pad.axes.length > 3 ? pad.axes[3] : 0) ?? 0;
    const normalized = normalizeDashboardScrollAxis(raw);
    if (Math.abs(normalized) > Math.abs(best)){
      best = normalized;
    }
  }
  return best;
}

/**
 * @param {number} raw
 * @returns {number}
 */
function normalizeDashboardScrollAxis(raw){
  const dead = 0.2;
  if (!Number.isFinite(raw) || Math.abs(raw) <= dead) return 0;
  return Math.sign(raw) * Math.max(0, Math.min(1, (Math.abs(raw) - dead) / (1 - dead)));
}

/**
 * @param {Game} game
 * @returns {string}
 */
function dashboardFinalReportTitle(game){
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  const rescued = Math.max(0, game.overallStats.rescued | 0);
  const kills = Math.max(0, game.overallStats.enemiesDestroyed | 0);
  if (objectiveComplete(game) && game.objective && game.objective.type === "destroy_core"){
    return dashboardPickReportLine(game, [
      "Core Down, Fleet Spent",
      "Objective Complete, Return Denied",
      "The Planet Lost First",
    ], "report-title-core", cfg);
  }
  if (objectiveComplete(game)){
    return dashboardPickReportLine(game, [
      "Mission Complete, Costs Pending",
      "Contract Fulfilled, Hangar Empty",
      "Success With Familiar Complications",
    ], "report-title-complete", cfg);
  }
  if (rescued > 0 && rescued >= kills){
    return dashboardPickReportLine(game, [
      "Rescue Ledger, Closed Early",
      "Survivors Up, Fleet Down",
      "Partial Evacuation, Final Entry",
    ], "report-title-rescue", cfg);
  }
  return dashboardPickReportLine(game, [
    "Campaign Terminated by Reality",
    "Final Report, Filed In Ash",
    "End of Shift, End of Fleet",
  ], "report-title-failed", cfg);
}

/**
 * @param {Game} game
 * @returns {string}
 */
function dashboardFinalReportBody(game){
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  const level = Math.max(1, game.level | 0);
  const rescued = Math.max(0, game.overallStats.rescued | 0);
  const kills = Math.max(0, game.overallStats.enemiesDestroyed | 0);
  const minersLost = Math.max(0, game.overallStats.minersLost | 0);
  const dropshipsLost = Math.max(0, game.overallStats.dropshipsLost | 0);
  const factoriesDestroyed = Math.max(0, game.overallStats.factoriesDestroyed | 0);
  const docks = Math.max(0, game.overallStats.docks | 0);
  const shots = Math.max(0, game.overallStats.shotsFired | 0);
  const bombs = Math.max(0, game.overallStats.bombsFired | 0);
  const objectiveText = dashboardFinalObjectiveSummary(game);
  const progressText = dashboardFinalProgressSentence(game, cfg, level, objectiveText);
  const tallyText = dashboardFinalTallySentence({
    rescued,
    kills,
    minersLost,
    dropshipsLost,
    factoriesDestroyed,
  });
  const styleText = dashboardFinalStyleSentence(game, {
    docks,
    shots,
    bombs,
    rescued,
    kills,
    dropshipsLost,
  }, cfg);
  return [progressText, tallyText, styleText].filter(Boolean).join(" ");
}

/**
 * @param {Game} game
 * @returns {string}
 */
function dashboardFinalObjectiveSummary(game){
  return missions.objectiveText(game).replace(/^Objective:\s*/, "");
}

/**
 * @param {Game} game
 * @param {any} cfg
 * @param {number} level
 * @param {string} objectiveText
 * @returns {string}
 */
function dashboardFinalProgressSentence(game, cfg, level, objectiveText){
  const site = cfg && cfg.label ? cfg.label : `Level ${level}`;
  if (objectiveComplete(game) && game.objective && game.objective.type === "destroy_core" && game.coreMeltdownActive){
    return dashboardPickReportLine(game, [
      `The run reached ${site}, cut the core loose, and then ran out of ships before anyone could enjoy surviving it.`,
      `${site} did lose its core. The fleet simply failed to remain attached to that good news.`,
      `By ${site}, the core was in collapse and the hangar inventory was down to historical records.`,
    ], "report-progress-core", cfg);
  }
  if (objectiveComplete(game)){
    return dashboardPickReportLine(game, [
      `The crew pushed as far as ${site} and technically got the job done before the last hull stopped coming back.`,
      `${site} went on the books as a completed operation, even if the return leg never made the schedule.`,
      `The contract was effectively settled at ${site}, followed immediately by an unrecoverable shortage of dropships.`,
    ], "report-progress-complete", cfg);
  }
  return dashboardPickReportLine(game, [
    `The run stalled at ${site} with ${objectiveText.toLowerCase()} still unresolved.`,
    `${site} turned into the last stop; ${objectiveText.toLowerCase()} remained unfinished when the fleet gave out.`,
    `By the time the campaign hit ${site}, the job was still reading "${objectiveText.toLowerCase()}" and the replacement ships had stopped arriving.`,
  ], "report-progress-failed", cfg);
}

/**
 * @param {{rescued:number,kills:number,minersLost:number,dropshipsLost:number,factoriesDestroyed:number}} stats
 * @returns {string}
 */
function dashboardFinalTallySentence(stats){
  const parts = [];
  if (stats.rescued > 0){
    parts.push(`${stats.rescued} ${pluralize("miner", stats.rescued)} made it back upstairs`);
  } else {
    parts.push("No miners made it back upstairs");
  }
  if (stats.kills > 0 && stats.factoriesDestroyed > 0){
    parts.push(`${stats.kills} hostiles and ${stats.factoriesDestroyed} ${pluralize("factory", stats.factoriesDestroyed)} were written off`);
  } else if (stats.kills > 0){
    parts.push(`${stats.kills} hostile ${pluralize("contact", stats.kills)} were removed from the ledger`);
  } else if (stats.factoriesDestroyed > 0){
    parts.push(`${stats.factoriesDestroyed} hostile ${pluralize("factory", stats.factoriesDestroyed)} stopped producing anything except debris`);
  }
  if (stats.minersLost > 0){
    parts.push(`${stats.minersLost} ${pluralize("miner", stats.minersLost)} were lost planetside`);
  }
  if (stats.dropshipsLost > 0){
    parts.push(`${stats.dropshipsLost} ${pluralize("dropship", stats.dropshipsLost)} failed to make the long-term inventory list`);
  }
  return parts.length ? `${parts.join("; ")}.` : "";
}

/**
 * @param {Game} game
 * @param {{docks:number,shots:number,bombs:number,rescued:number,kills:number,dropshipsLost:number}} stats
 * @param {any} cfg
 * @returns {string}
 */
function dashboardFinalStyleSentence(game, stats, cfg){
  if (stats.bombs >= Math.max(8, Math.floor(stats.shots * 0.18))){
    return dashboardPickReportLine(game, [
      "The debrief notes generous bomb usage and a corresponding shortage of subtlety.",
      "Ordnance expenditure was high, which is a polite way to say the terrain did not enjoy meeting you.",
      "Subtlety was officially replaced with high explosives somewhere around the mid-campaign paperwork.",
    ], "report-style-bombs", cfg);
  }
  if (stats.docks >= Math.max(3, game.level + 1)){
    return dashboardPickReportLine(game, [
      "Orbit logged a steady rhythm of dock, repair, reload, and one more bad idea.",
      "The mothership saw enough turnaround traffic to qualify as a very nervous airport.",
      "Repeated dockings kept the campaign alive longer than anyone in accounting would have preferred.",
    ], "report-style-docks", cfg);
  }
  if (stats.rescued > stats.kills && stats.rescued > 0){
    return dashboardPickReportLine(game, [
      "For all the noise, the campaign leaned more toward extraction than extermination.",
      "The file reads like a rescue operation that kept tripping over a war zone.",
      "Beneath the weapons fire, most of the effort still went into getting people home.",
    ], "report-style-rescue", cfg);
  }
  if (stats.kills > 0 || stats.dropshipsLost > 0){
    return dashboardPickReportLine(game, [
      "It was not a subtle run, but subtle runs rarely produce this much debris.",
      "The final audit describes a loud campaign, an overworked hangar, and several now-theoretical enemies.",
      "Hostile negotiations remained brief, direct, and mostly one-sided until the fleet finally ran dry.",
    ], "report-style-combat", cfg);
  }
  return dashboardPickReportLine(game, [
    "Mostly it ended the way these contracts do: abruptly, expensively, and in need of a new filing code.",
    "The archive will probably classify it as a routine loss, which feels optimistic.",
    "Officially this will become a short report; unofficially it was a very long day.",
  ], "report-style-default", cfg);
}

/**
 * @param {Game} game
 * @returns {string}
 */
export function dashboardPerkSummary(game){
  /** @type {Array<string>} */
  const parts = [];
  /** @param {string} text @param {number} count */
  const addCountPart = (text, count) => {
    const n = Math.max(0, count | 0);
    if (n <= 0) return;
    parts.push(n > 1 ? `${text} (x${n})` : text);
  };
  addCountPart("Reinforced Hull", game.ship.hpMax - GAME.SHIP_STARTING_MAX_HP);
  addCountPart("Payload Bay", game.ship.bombsMax - GAME.SHIP_STARTING_MAX_BOMBS);
  addCountPart("Heavy Charges", game.ship.bombStrength - GAME.SHIP_STARTING_BOMB_STRENGTH);
  addCountPart("Engine Tune-Up", game.ship.thrust - GAME.SHIP_STARTING_THRUST);
  addCountPart("Inertial Drive", game.ship.inertialDrive - GAME.SHIP_STARTING_INERTIAL_DRIVE);
  addCountPart("Firepower", game.ship.gunPower - GAME.SHIP_STARTING_GUN_POWER);
  if (game.ship.rescueeDetector) parts.push("Rescuee Detector");
  if (game.ship.planetScanner) parts.push("Planet Scanner");
  if (game.ship.bounceShots) parts.push("Bounce Shots");
  return parts.join(", ");
}

/**
 * @param {Game} game
 * @param {readonly string[]} options
 * @param {string} tag
 * @param {any} cfg
 * @returns {string}
 */
function dashboardPickMissionLine(game, options, tag, cfg){
  if (!Array.isArray(options) || options.length === 0) return "";
  const planetSeed = game.planet.getSeed() | 0;
  const objType = game.objective ? game.objective.type : "";
  let seed = (planetSeed ^ Math.imul((game.level | 0) + 1, 1103515245)) >>> 0;
  seed ^= dashboardTextHash(tag);
  seed ^= dashboardTextHash(cfg && cfg.id ? cfg.id : "");
  seed ^= dashboardTextHash(objType);
  return options.length > 1 ? options[seed % options.length] : options[0];
}

/**
 * @param {Game} game
 * @param {readonly string[]} options
 * @param {string} tag
 * @param {any} cfg
 * @returns {string}
 */
function dashboardPickReportLine(game, options, tag, cfg){
  if (!Array.isArray(options) || options.length === 0) return "";
  const seed = dashboardReportSeed(game, tag, cfg);
  return options.length > 1 ? options[seed % options.length] : options[0];
}

/**
 * @param {Game} game
 * @param {string} tag
 * @param {any} cfg
 * @returns {number}
 */
function dashboardReportSeed(game, tag, cfg){
  const planetSeed = game.planet.getSeed() | 0;
  let seed = (planetSeed ^ Math.imul((game.level | 0) + 1, 1103515245)) >>> 0;
  seed ^= dashboardTextHash(tag);
  seed ^= dashboardTextHash(cfg && cfg.id ? cfg.id : "");
  seed ^= dashboardTextHash(game.objective && game.objective.type ? game.objective.type : "");
  seed ^= Math.imul((game.overallStats.rescued | 0) + 11, 2246822519) >>> 0;
  seed ^= Math.imul((game.overallStats.enemiesDestroyed | 0) + 17, 3266489917) >>> 0;
  seed ^= Math.imul((game.overallStats.minersLost | 0) + 23, 668265263) >>> 0;
  seed ^= Math.imul((game.overallStats.dropshipsLost | 0) + 29, 374761393) >>> 0;
  seed ^= Math.imul((game.overallStats.factoriesDestroyed | 0) + 31, 1274126177) >>> 0;
  return seed >>> 0;
}

/**
 * @param {string} text
 * @returns {number}
 */
function dashboardTextHash(text){
  let h = 2166136261 >>> 0;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * @param {string} text
 * @returns {string}
 */
function dashboardCap(text){
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
}

/**
 * @param {string} word
 * @param {number} count
 * @returns {string}
 */
function pluralize(word, count){
  return Math.abs(count) === 1 ? word : `${word}s`;
}

/**
 * @param {any} cfg
 * @returns {string}
 */
function dashboardThreatFlavor(cfg){
  if (!cfg || !Array.isArray(cfg.enemyAllow) || !cfg.enemyAllow.length){
    return "support hardware that is still pretending to be scenery";
  }
  /** @type {Array<string>} */
  const parts = [];
  if (cfg.enemyAllow.includes("hunter")) parts.push("hunter drones");
  if (cfg.enemyAllow.includes("ranger")) parts.push("survey rangers");
  if (cfg.enemyAllow.includes("crawler")) parts.push("maintenance crawlers");
  if (cfg.enemyAllow.includes("turret")) parts.push("point-defense nests");
  if (cfg.enemyAllow.includes("orbitingTurret")) parts.push("orbiting sentries");
  if (!parts.length) return "support hardware with concerning initiative";
  if (parts.length === 1) return parts[0] || "support hardware with concerning initiative";
  if (parts.length === 2) return `${parts[0] || "support hardware"} and ${parts[1] || "more support hardware"}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1] || "more support hardware"}`;
}

/**
 * @param {Game} game
 * @param {any} cfg
 * @returns {string}
 */
function dashboardThreatSentence(game, cfg){
  const threat = dashboardThreatFlavor(cfg);
  if (!cfg || !Array.isArray(cfg.enemyAllow) || !cfg.enemyAllow.length){
    return dashboardPickMissionLine(game, [
      "Most of the old support kit still looks harmless, which is how it likes to start the conversation.",
      "Nothing here seems especially dangerous yet, which is rarely a stable condition.",
    ], "threat-none", cfg);
  }
  return dashboardPickMissionLine(game, [
    `Expect ${threat} anywhere the old support network still has power.`,
    `The rogue support stack is fielding ${threat}, because apparently customer service now includes suppressive fire.`,
    `${dashboardCap(threat)} are active on this site, and they seem oddly committed to the new management plan.`,
  ], "threat", cfg);
}

/**
 * @param {Game} game
 * @param {any} cfg
 * @returns {string}
 */
function dashboardWorldSentence(game, cfg){
  switch (cfg && cfg.id){
    case "barren_pickup": return dashboardPickMissionLine(game, ["Routine pickup on a dead shell, about as glamorous as the paperwork promised.", "Quiet vacuum, bright rock, and one allegedly simple extraction."], "world-barren-pickup", cfg);
    case "barren_clear": return dashboardPickMissionLine(game, ["Our miners opened an old fort and its antique security package woke up furious.", "The fort on this rock was supposed to stay historical, but its defenses have updated their opinion."], "world-barren-clear", cfg);
    case "no_caves": return dashboardPickMissionLine(game, ["Wide badlands, no caves, and nowhere to hide once the shooting starts.", "Open ridges and long approaches make every pass here a public performance."], "world-no-caves", cfg);
    case "molten": return dashboardPickMissionLine(game, ["The mining stack under this crust has gone full furnace tantrum.", "Heat shimmer, open lava, and a support network that now thinks in weapons-grade terms."], "world-molten", cfg);
    case "ice": return dashboardPickMissionLine(game, ["Everything here is slick enough to turn braking into a theory problem.", "Blue ice, cold caves, and exactly the amount of traction you were hoping not to hear about."], "world-ice", cfg);
    case "gaia": return dashboardPickMissionLine(game, ["The old terraforming kit went feral and landscaped itself a kill zone.", "Green from orbit, rude up close; the local support tech has chosen a very aggressive gardening style."], "world-gaia", cfg);
    case "water": return dashboardPickMissionLine(game, ["This flooded job site flies like syrup and keeps most of its bad ideas underwater.", "Buoyancy helps right up until the drowned machinery remembers it has opinions."], "world-water", cfg);
    case "cavern": return dashboardPickMissionLine(game, ["These tunnels were built for mining and later repurposed for ambushes.", "Legacy excavation routes now double as a maze for very motivated hardware."], "world-cavern", cfg);
    case "mechanized": return dashboardPickMissionLine(game, ["The mining support network has stopped supporting and started industrial empire-building.", "This is what happens when a company town lets the automation write policy."], "world-mechanized", cfg);
    default: return dashboardPickMissionLine(game, ["Local conditions remain unfriendly and increasingly automated.", "The site is active, hostile, and somehow still filed under support operations."], "world-default", cfg);
  }
}

/**
 * @param {Game} game
 * @param {any} cfg
 * @returns {string}
 */
function dashboardObjectiveSentence(game, cfg){
  if (game.objective && game.objective.type === "extract"){
    if (game.level === 1){
      return dashboardPickMissionLine(game, ["Touch down, load the survivors, and leave before the job site discovers ambition.", "Collect the crew, keep the ship tidy, and clock out before routine becomes memorable."], "objective-extract-l1", cfg);
    }
    return dashboardPickMissionLine(game, ["Get the crew out fast and do not stay to troubleshoot the locals.", "Pull the survivors, keep the lanes clear, and resist any urge to linger.", "Make the pickup, keep moving, and let orbit handle the paperwork."], "objective-extract", cfg);
  }
  if (game.objective && game.objective.type === "clear"){
    if (game.level === 2 || (cfg && cfg.id === "barren_clear")){
      return dashboardPickMissionLine(game, ["Sweep the active guns, keep moving, and try not to wake whatever else the fort buried under its budget.", "Clear the old defenses, silence anything still tracking you, and mark the site as less retired than advertised."], "objective-clear-early", cfg);
    }
    return dashboardPickMissionLine(game, ["Sweep the site, shut down anything still hostile, and make the report sound routine.", "Clear the active hardware, keep your exits open, and leave before it starts networking again.", "Burn down local resistance, then break orbit before the neighborhood compares notes."], "objective-clear", cfg);
  }
  if (game.objective && game.objective.type === "destroy_factories"){
    return dashboardPickMissionLine(game, ["Break the production line, pull the teeth from local security, and remind the machines that quotas are optional.", "Crack the factories, spoil the rollout, and leave the assembly floor arguing with itself.", "Smash the line, ruin the schedule, and make expansion a tomorrow problem for someone else."], "objective-factories", cfg);
  }
  if (game.objective && game.objective.type === "destroy_core"){
    return dashboardPickMissionLine(game, ["Cut the tethers, start the collapse, and be somewhere else when the accounting catches up.", "Trip the core, outrun the consequences, and let the machines explain the loss to themselves.", "Bring the heart down, dodge the last defenses, and leave before the planet files a complaint."], "objective-core", cfg);
  }
  return dashboardPickMissionLine(game, ["Stay on task, keep the ship intact, and leave orbit cleaner than you found it.", "Keep the approach tidy, do the job, and try not to improve the disaster."], "objective-default", cfg);
}

/**
 * @param {"keyboard"|"mouse"|"touch"|"gamepad"|null|undefined} inputType
 * @returns {string}
 */
function helpActionLabel(inputType){
  const type = inputType || "keyboard";
  if (type === "touch") return "?";
  if (type === "gamepad") return "Button3";
  return "/";
}

/**
 * @param {"respawnShip"|"restartGame"|"upgrade"|"nextLevel"|"viewMap"|"exitMap"|null} mode
 * @returns {string}
 */
function touchActionPromptLabel(mode){
  if (mode === "upgrade") return "UP";
  if (mode === "nextLevel") return "GO";
  if (mode === "viewMap") return "MAP";
  if (mode === "exitMap") return "BACK";
  if (mode === "respawnShip") return "SHIP";
  if (mode === "restartGame") return "NEW";
  return touchLaunchPromptLabel();
}

/**
 * @returns {string}
 */
function touchLaunchPromptLabel(){
  return "▲";
}

/**
 * @param {Game} game
 * @returns {Array<string>}
 */
function perksAvailable(game){
  /** @type {Array<string>} */
  const out = ["hpMax", "bombsMax"];
  if (game.ship.bombStrength < 2) out.push("bombStrength");
  if (game.ship.thrust < 3) out.push("thrust");
  if (game.ship.inertialDrive < GAME.SHIP_MAX_INERTIAL_DRIVE) out.push("inertialDrive");
  if (game.level > 5 && game.ship.gunPower < 2) out.push("gunPower");
  if (!game.ship.rescueeDetector) out.push("rescueeDetector");
  if (!game.ship.planetScanner) out.push("planetScanner");
  if (!game.ship.bounceShots) out.push("bounceShots");
  return out;
}

/**
 * @param {Array<string>} available
 * @returns {Array<string>}
 */
function pickPerkChoices(available){
  console.assert(available.length >= 2);
  const idx0 = Math.floor(Math.random() * available.length);
  let idx1 = Math.floor(Math.random() * (available.length - 1));
  if (idx1 >= idx0) idx1 += 1;
  return [
    /** @type {string} */ (available[idx0]),
    /** @type {string} */ (available[idx1]),
  ];
}

/**
 * @param {Game} game
 * @param {string} perk
 * @returns {string}
 */
function perkChoiceText(game, perk){
  if (perk === "hpMax") return "Reinforced hull:\n+1 max HP";
  if (perk === "bombsMax") return "Expanded payload bay:\n+1 max bomb";
  if (perk === "bombStrength") return "Heavy charges:\nbigger bomb blast";
  if (perk === "thrust") return "Engine tune-up:\n+10% thrust power";
  if (perk === "inertialDrive"){
    if (game.ship.inertialDrive <= 0) return "Inertial drive:\ncorrective thrust";
    return `Inertial drive:\n+${Math.round(GAME.INERTIAL_DRIVE_UPGRADE_FACTOR * 100)}% corrective thrust`;
  }
  if (perk === "gunPower") return "Firepower:\n+1 HP damage";
  if (perk === "rescueeDetector") return "Rescuee detector:\nlocate stranded crew";
  if (perk === "planetScanner") return "Planet scanner:\nview from mothership";
  if (perk === "bounceShots") return "Bounce shots";
  return perk;
}

/**
 * @param {Game} game
 * @param {string} perk
 * @returns {void}
 */
function applyPerk(game, perk){
  if (perk === "hpMax"){
    ++game.ship.hpMax;
    game.ship.hpCur = game.ship.hpMax;
  } else if (perk === "bombsMax"){
    ++game.ship.bombsMax;
    game.ship.bombsCur = game.ship.bombsMax;
  } else if (perk === "bombStrength"){
    game.ship.bombStrength = Math.min(2, game.ship.bombStrength + 1);
  } else if (perk === "thrust"){
    ++game.ship.thrust;
  } else if (perk === "inertialDrive"){
    game.ship.inertialDrive = Math.min(GAME.SHIP_MAX_INERTIAL_DRIVE, game.ship.inertialDrive + 1);
  } else if (perk === "gunPower"){
    ++game.ship.gunPower;
  } else if (perk === "rescueeDetector"){
    game.ship.rescueeDetector = true;
  } else if (perk === "planetScanner"){
    game.ship.planetScanner = true;
  } else if (perk === "bounceShots"){
    game.ship.bounceShots = true;
  }
  stats.markDashboardDirty(game);
}
