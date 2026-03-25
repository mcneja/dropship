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
    return "The run is over. Review the level and total columns for the final tally before starting again.";
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
      ? "Mission complete. Core collapse confirmed. Break orbit and return to the mothership."
      : "Mission complete. Core defenses are down. Return to the mothership.";
  }
  if (game.objective && game.objective.type === "destroy_factories"){
    return "Mission complete. Factory production has been silenced. Return to the mothership.";
  }
  if (game.objective && game.objective.type === "clear"){
    return "Mission complete. Local hostile resistance has been cleared. Return to the mothership.";
  }
  return "Mission complete. Survivors are accounted for. Return to the mothership.";
}

/**
 * @param {Game} game
 * @returns {Array<{label:string,value:string}>}
 */
export function dashboardShipRows(game){
  return [
    { label: "Hull", value: `${game.ship.hpCur}/${game.ship.hpMax}` },
    { label: "Bombs", value: `${game.ship.bombsCur}/${game.ship.bombsMax}` },
    { label: "Upgrades", value: dashboardPerkSummary(game) || "None" },
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
  if (game.input && typeof game.input.setTouchActionMode === "function"){
    game.input.setTouchActionMode(touchStartMode);
  }
  if (game.input && typeof game.input.setTouchDocked === "function"){
    game.input.setTouchDocked(!transitionActive && dockedNow);
  }
  if (game.input && typeof game.input.setTouchPerkChoiceActive === "function"){
    game.input.setTouchPerkChoiceActive(game.pendingPerkChoice !== null);
  }
  if (game.input && typeof game.input.setGameOver === "function"){
    game.input.setGameOver(!transitionActive && game.ship.state === "crashed");
  }
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
      const missionStatusBase = dashboardMissionStatus(game, inputState.inputType, now);
      const missionStatus = inputState.inputType === "gamepad"
        ? [missionStatusBase, "Right stick scrolls both panels."].filter(Boolean).join(" ")
        : missionStatusBase;
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
        game.ui.updateMothershipDashboard(game.dashboard, {
          open: true,
          shipRows: dashboardShipRows(game),
          statsRows: dashboardStatsRows(game),
          missionHeader: missions.runEnded(game) ? "Final Report" : "Mission Brief",
          missionMeta: dashboardMissionMeta(game),
          missionTitle: missions.objectiveText(game).replace(/^Objective:\s*/, ""),
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
            worldRadius: game.planetParams.RMAX,
            surfaceRadius: game.planetParams.RMAX,
            fogEnabled: game.fogEnabled,
            rotation: previewRotation,
          },
        });
        dashboardState.dirty = false;
        dashboardState.lastStatusText = missionStatus;
        dashboardState.lastPreviewRotation = previewRotation;
      }
      const dashboardScrollY = inputState.dashboardScroll && Number.isFinite(inputState.dashboardScroll.y)
        ? inputState.dashboardScroll.y
        : 0;
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
  const showHeat = !hudVisible && !titleShowing && !transitionActive && !dashboardOpen && meltdown.heatMechanicsActive(game);
  const heating = showHeat && (heat > game.lastHeat + 0.1);
  game.lastHeat = heat;
  if (game.heatMeter && game.ui.updateHeatMeter){
    game.ui.updateHeatMeter(game.heatMeter, heat, showHeat, heating);
  }

  if (game.planetLabel){
    game.planetLabel.style.visibility = (titleShowing || transitionActive || dashboardOpen) ? "hidden" : "visible";
    if (!titleShowing && !transitionActive && !dashboardOpen && game.ui.updatePlanetLabel){
      const cfg = game.planet.getPlanetConfig();
      const label = cfg ? cfg.label : "";
      const prefix = `Level ${game.level}: `;
      game.ui.updatePlanetLabel(game.planetLabel, label ? `${prefix}${label}` : `Level ${game.level}`);
    }
  }

  if (game.objectiveLabel){
    game.objectiveLabel.style.visibility = transitionActive ? "hidden" : "visible";
    game.objectiveLabel.classList.toggle("objective-centered", !!dashboardOpen);
    const abandonHoldActive = !!inputState.abandonHoldActive;
    const abandonHoldRemainingMs = (typeof inputState.abandonHoldRemainingMs === "number")
      ? inputState.abandonHoldRemainingMs
      : 0;
    game.objectiveLabel.style.color = abandonHoldActive ? "rgb(255, 72, 72)" : "";
    if (game.ui.updateObjectiveLabel){
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
    game.shipStatusLabel.style.visibility = (titleShowing || transitionActive || dashboardOpen) ? "hidden" : "visible";
    if (!titleShowing && !transitionActive && !dashboardOpen && game.ui.updateShipStatusLabel){
      game.ui.updateShipStatusLabel(game.shipStatusLabel, {
        shipHp: game.ship.hpCur,
        shipHpMax: game.ship.hpMax,
        bombs: game.ship.bombsCur,
        bombsMax: game.ship.bombsMax,
      });
    }
  }

  if (game.signalMeter && game.ui.updateSignalMeter){
    game.ui.updateSignalMeter(game.signalMeter, signalStrength(game), !hudVisible && !titleShowing && !transitionActive && !dashboardOpen);
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
 * @param {Game} game
 * @returns {string}
 */
function dashboardPerkSummary(game){
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
  const planetSeed = (game.planet && typeof game.planet.getSeed === "function")
    ? (game.planet.getSeed() | 0)
    : (game.progressionSeed | 0);
  const objType = game.objective ? game.objective.type : "";
  let seed = (planetSeed ^ Math.imul((game.level | 0) + 1, 1103515245)) >>> 0;
  seed ^= dashboardTextHash(tag);
  seed ^= dashboardTextHash(cfg && cfg.id ? cfg.id : "");
  seed ^= dashboardTextHash(objType);
  return options.length > 1 ? options[seed % options.length] : options[0];
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


