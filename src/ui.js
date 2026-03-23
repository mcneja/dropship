// @ts-check

import { PERF_FLAGS } from "./perf.js";

import { GAME } from "./config.js";

const MOTHERSHIP_DASHBOARD_STYLE_ID = "mothership-dashboard-style";
const dashboardStateByRoot = new WeakMap();
const planetPreviewCacheByCanvas = new WeakMap();

/** @typedef {[number,number,number]} RgbTriplet */
/**
 * @typedef {Object} PlanetPreviewPlanet
 * @property {(x:number,y:number)=>number} airValueAtWorld
 * @property {(x:number,y:number)=>number} [shadeAtWorld]
 * @property {(x:number,y:number)=>boolean} [fogSeenAt]
 * @property {(x:number,y:number)=>number} [fogAlphaAtWorld]
 * @property {()=>number} [getSeed]
 */
/**
 * @typedef {Object} PlanetPreviewPalette
 * @property {RgbTriplet} rockDark
 * @property {RgbTriplet} rockLight
 * @property {RgbTriplet} airDark
 * @property {RgbTriplet} airLight
 * @property {RgbTriplet} surfaceRockDark
 * @property {RgbTriplet} surfaceRockLight
 * @property {number} surfaceBand
 */
/**
 * @typedef {Object} PlanetPreview
 * @property {PlanetPreviewPlanet} planet
 * @property {PlanetPreviewPalette|null} [palette]
 * @property {number} worldRadius
 * @property {number} surfaceRadius
 * @property {boolean} fogEnabled
 * @property {number} [rotation]
 */
/**
 * @typedef {Object} NullablePlanetPreview
 * @property {PlanetPreviewPlanet|null} planet
 * @property {PlanetPreviewPalette|null} [palette]
 * @property {number} worldRadius
 * @property {number} surfaceRadius
 * @property {boolean} fogEnabled
 * @property {number} [rotation]
 */

/**
 * @param {HTMLElement} hud
 * @param {{fps:number,state:string,speed:number,verts:number,air:number,miners:number,minersDead:number,level:number,debug:boolean,minerCandidates:number,shipHp:number,bombs:number,landingDebug?:{source?:string,reason?:string,dotUp?:number,slope?:number,landSlope?:number,vn?:number,vt?:number,speed?:number,airFront?:number,airBack?:number,landable?:boolean,landed?:boolean,support?:boolean,supportDist?:number,contactsCount?:number,bestDotUpAny?:number,bestDotUpUnder?:number,impactPoint?:number,supportPoint?:number,impactT?:number,supportT?:number,impactX?:number,impactY?:number,supportX?:number,supportY?:number,supportTriOuterCount?:number,supportTriAirMin?:number,supportTriAirMax?:number,supportTriRMin?:number,supportTriRMax?:number}|null,inputType:("keyboard"|"mouse"|"touch"|"gamepad"|null|undefined),frameStats?:{sampleCount:number,avgMs:number,avgFps:number,p50Ms:number,p95Ms:number,p99Ms:number,low1Fps:number,over16_7:number,over25:number,over33_3:number,maxMs:number}|null,benchState?:string|null,perfFlags?:readonly string[]|null}} stats
 * @returns {void}
 */
export function updateHud(hud, stats){
  const landingDbg = stats.landingDebug;
  const landingSuffix = landingDbg
    ? ` | landDbg src:${landingDbg.source || "-"} r:${landingDbg.reason || "-"} lu:${fmtN(landingDbg.dotUp)} sl:${fmtN(landingDbg.slope)}<=${fmtN(landingDbg.landSlope)} vn:${fmtN(landingDbg.vn)} vt:${fmtN(landingDbg.vt)} sp:${fmtN(landingDbg.speed)} af:${fmtN(landingDbg.airFront)} ab:${fmtN(landingDbg.airBack)} sup:${landingDbg.support ? 1 : 0}@${fmtN(landingDbg.supportDist)} ok:${landingDbg.landable ? 1 : 0}`
    : "";
  const frameStats = stats.frameStats || null;
  const frameSuffix = frameStats
    ? ` | ft avg:${frameStats.avgMs.toFixed(2)}ms p95:${frameStats.p95Ms.toFixed(2)} p99:${frameStats.p99Ms.toFixed(2)} 1%:${frameStats.low1Fps.toFixed(1)} >16:${frameStats.over16_7} max:${frameStats.maxMs.toFixed(2)}`
    : "";
  const perfFlags = Array.isArray(stats.perfFlags) ? stats.perfFlags : [];
  const debugSuffix = stats.debug ? ` | miner candidates: ${stats.minerCandidates}${landingSuffix}` : "";
  const perfLine = perfRecordingLine(stats.benchState, perfFlags);
  hud.textContent =
    `fps: ${stats.fps} | hull: ${stats.shipHp} | bombs: ${stats.bombs} | level: ${stats.level} | state: ${stats.state} | speed: ${stats.speed.toFixed(1)} | miners: ${stats.miners} | dead: ${stats.minersDead} | verts: ${stats.verts.toLocaleString()} | air: ${stats.air.toFixed(3)}${frameSuffix}${debugSuffix}\nLMB: shoot | RMB: bomb | Wheel: zoom | 0: zoom reset | -/=: music vol | Alt+M: new map | Alt+N: next level | Alt+Shift+N: prev level | Alt+K: jump to level | Alt+G/H: ring vertices | Alt+T: planet tri outline | Alt+Y: collision contours | Alt+U: miner path debug | Alt+I: debug collisions | Alt+V: view map | Alt+F: toggle fog | P/Alt+P: collect miners | Alt+X: clear enemies | Alt+E: remove entities | Alt+C: copy screenshot | Alt+Shift+C: copy clean screenshot | Alt+Shift+G: copy title screenshot | Alt+\\: toggle dev HUD | M/B: music | J: combat tracks | R: restart\n${perfLine}`;
}

/**
 * @param {number|undefined|null} n
 * @returns {string}
 */
function fmtN(n){
  return Number.isFinite(n) ? Number(n).toFixed(2) : "-";
}

/**
 * @param {string|null|undefined} benchState
 * @param {readonly string[]} perfFlags
 * @returns {string}
 */
function perfRecordingLine(benchState, perfFlags){
  let stateLabel = "idle";
  let detail = "";
  const text = typeof benchState === "string" ? benchState.trim() : "";
  if (text){
    if (text.startsWith("warmup")){
      stateLabel = "pending";
      detail = text;
    } else if (text.startsWith("run")){
      stateLabel = "active";
      detail = text;
    } else if (text === "done"){
      stateLabel = "done";
    } else {
      stateLabel = text;
    }
  }
  const flagsText = perfFlags.length ? ` | perf: ${perfFlags.join(",")}` : "";
  return `perf recording: ${stateLabel}${detail ? ` (${detail})` : ""}${flagsText}`;
}

/**
 * @param {HTMLElement} el
 * @param {string} label
 * @returns {void}
 */
export function updatePlanetLabel(el, label){
  el.textContent = label || "";
}

/**
 * @param {HTMLElement} el
 * @param {string} text
 * @returns {void}
 */
export function updateObjectiveLabel(el, text){
  el.textContent = text || "";
}

/**
 * @param {HTMLElement} el
 * @param {{shipHp:number,shipHpMax:number,bombs:number,bombsMax:number}} stats
 * @returns {void}
 */
export function updateShipStatusLabel(el, stats){
  el.textContent = `Hull ${stats.shipHp}/${stats.shipHpMax} | Bombs ${stats.bombs}/${stats.bombsMax}`;
}

/**
 * @param {HTMLElement} el
 * @param {number} signalStrength
 * @param {boolean} show
 * @returns {void}
 */
export function updateSignalMeter(el, signalStrength, show){
  if (!el) return;
  if (!show){
    el.style.display = "none";
    return;
  }
  el.style.display = "block";
  const fill = /** @type {HTMLElement|null} */ (el.querySelector(".signal-bar-fill"));
  if (fill){
    const pct = Math.max(0, Math.min(100, signalStrength * 10));
    fill.style.width = `${pct}%`;
  }
  if (!PERF_FLAGS.disableHudLayout) layoutSignalMeter(el);
}

/**
 * @param {HTMLElement} el
 * @param {number} heat
 * @param {boolean} show
 * @param {boolean} flashing
 * @returns {void}
 */
export function updateHeatMeter(el, heat, show, flashing){
  if (!el) return;
  if (!show){
    el.style.display = "none";
    el.classList.remove("heat-flash");
    return;
  }
  el.style.display = "block";
  el.classList.toggle("heat-flash", !!flashing);
  const value = Math.max(0, Math.min(100, Math.round(heat)));
  const fill = /** @type {HTMLElement|null} */ (el.querySelector(".heat-bar-fill"));
  if (fill) fill.style.width = `${value}%`;
  if (!PERF_FLAGS.disableHudLayout) layoutHeatMeter(el);
}

/**
 * @param {HTMLElement} root
 * @param {{
 *   open:boolean,
 *   shipRows:Array<{label:string,value:string}>,
 *   statsRows:Array<{label:string,level:string,total:string}>,
 *   missionHeader?:string,
 *   missionTitle:string,
 *   missionBody:string,
 *   missionStatus:string,
 *   missionMeta?:string,
 *   planetLabel?:string,
 *   planetNote?:string,
 *   planetPreview?:NullablePlanetPreview|null,
 * }} stats
 * @returns {void}
 */
export function updateMothershipDashboard(root, stats){
  if (!root) return;
  const state = ensureMothershipDashboard(root);
  const open = !!stats.open;
  if (open){
    if (state.hideTimer){
      clearTimeout(state.hideTimer);
      state.hideTimer = 0;
    }
    const wasHidden = root.style.display === "none";
    if (root.style.display === "none"){
      root.style.display = "";
    }
    if (!state.open && wasHidden){
      root.classList.toggle("dashboard-open", false);
      void root.offsetWidth;
    }
    root.classList.toggle("dashboard-open", true);
    root.setAttribute("aria-hidden", "false");
  } else {
    root.classList.toggle("dashboard-open", false);
    root.setAttribute("aria-hidden", "true");
    syncDashboardViewportState(root, state, false);
    if (state.open && !state.hideTimer){
      state.hideTimer = window.setTimeout(() => {
        root.style.display = "none";
        state.hideTimer = 0;
      }, 280);
    } else if (!state.open && !state.hideTimer){
      root.style.display = "none";
    }
    state.open = false;
    return;
  }
  state.open = true;
  syncDashboardViewportState(root, state, true);

  renderDashboardRows(state.shipRows, stats.shipRows || [], state, "shipRowsKey");
  renderDashboardStatsTable(state.statsBody, stats.statsRows || [], state);

  setTextIfChanged(state.missionHeader, stats.missionHeader || "Mission Brief");
  setTextIfChanged(state.missionMeta, stats.missionMeta || "");
  setTextIfChanged(state.missionTitle, stats.missionTitle || "");
  setTextIfChanged(state.missionBody, stats.missionBody || "");
  setTextIfChanged(state.missionStatus, stats.missionStatus || "");
  setTextIfChanged(state.planetLabel, stats.planetLabel || "Planet scan");
  setTextIfChanged(state.planetNote, stats.planetNote || "");

  if (stats.planetPreview && stats.planetPreview.planet){
    drawPlanetPreview(state.planetCanvas, /** @type {PlanetPreview} */ (stats.planetPreview));
  } else {
    clearPlanetPreview(state.planetCanvas);
  }
}

/**
 * @param {HTMLElement} root
 * @param {number} deltaY
 * @returns {void}
 */
export function scrollMothershipDashboard(root, deltaY){
  if (!root || !Number.isFinite(deltaY) || Math.abs(deltaY) < 0.1) return;
  const state = ensureMothershipDashboard(root);
  if (!state.open) return;
  state.leftScroll.scrollTop += deltaY;
  state.rightScroll.scrollTop += deltaY;
}

/**
 * @param {HTMLElement} root
 * @returns {{
 *   shipRows:HTMLElement,
 *   statsBody:HTMLElement,
 *   missionHeader:HTMLElement,
 *   missionMeta:HTMLElement,
 *   missionTitle:HTMLElement,
 *   missionBody:HTMLElement,
 *   missionStatus:HTMLElement,
 *   leftScroll:HTMLElement,
 *   rightScroll:HTMLElement,
 *   leftPanel:HTMLElement,
 *   rightPanel:HTMLElement,
 *   planetCanvas:HTMLCanvasElement,
 *   planetLabel:HTMLElement,
 *   planetNote:HTMLElement,
 *   open:boolean,
 *   hideTimer:number,
 *   shipRowsKey:string,
 *   statsTableKey:string,
 *   centerWidth:number,
 * }}
 */
function ensureMothershipDashboard(root){
  const existing = dashboardStateByRoot.get(root);
  if (existing) return existing;
  ensureMothershipDashboardStyles();
  root.id = root.id || "mothership-dashboard";
  root.classList.add("mothership-dashboard");
  root.style.display = "none";
  root.innerHTML = `
    <section class="dashboard-panel dashboard-panel-left" aria-label="Ship status and game stats">
      <header class="dashboard-header">Ship Status</header>
      <div class="dashboard-scroll dashboard-left-scroll">
        <div class="dashboard-rows dashboard-ship-rows"></div>
        <div class="dashboard-section-label">Stats</div>
        <div class="dashboard-stats-wrap">
          <table class="dashboard-stats-table">
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col">Lvl</th>
                <th scope="col">Tot</th>
              </tr>
            </thead>
            <tbody class="dashboard-stats-body"></tbody>
          </table>
        </div>
      </div>
    </section>
    <section class="dashboard-panel dashboard-panel-right" aria-label="Mission brief and planet scan">
      <header class="dashboard-header dashboard-mission-header">Mission Brief</header>
      <div class="dashboard-right-body">
        <div class="dashboard-scroll dashboard-text-scroll">
          <div class="dashboard-copy dashboard-mission-meta"></div>
          <div class="dashboard-section-label">Current Objective</div>
          <div class="dashboard-copy dashboard-mission-title"></div>
          <div class="dashboard-copy dashboard-mission-body"></div>
          <div class="dashboard-copy dashboard-mission-status"></div>
          <div class="dashboard-section-label">Planet Profile</div>
          <div class="dashboard-copy dashboard-planet-label"></div>
          <div class="dashboard-copy dashboard-planet-note"></div>
        </div>
        <div class="dashboard-planet-render">
          <canvas class="dashboard-planet-canvas" aria-hidden="true"></canvas>
        </div>
      </div>
    </section>
  `;
  const state = {
    shipRows: /** @type {HTMLElement} */ (root.querySelector(".dashboard-ship-rows")),
    statsBody: /** @type {HTMLElement} */ (root.querySelector(".dashboard-stats-body")),
    missionHeader: /** @type {HTMLElement} */ (root.querySelector(".dashboard-mission-header")),
    missionMeta: /** @type {HTMLElement} */ (root.querySelector(".dashboard-mission-meta")),
    missionTitle: /** @type {HTMLElement} */ (root.querySelector(".dashboard-mission-title")),
    missionBody: /** @type {HTMLElement} */ (root.querySelector(".dashboard-mission-body")),
    missionStatus: /** @type {HTMLElement} */ (root.querySelector(".dashboard-mission-status")),
    leftScroll: /** @type {HTMLElement} */ (root.querySelector(".dashboard-left-scroll")),
    rightScroll: /** @type {HTMLElement} */ (root.querySelector(".dashboard-text-scroll")),
    leftPanel: /** @type {HTMLElement} */ (root.querySelector(".dashboard-panel-left")),
    rightPanel: /** @type {HTMLElement} */ (root.querySelector(".dashboard-panel-right")),
    planetCanvas: /** @type {HTMLCanvasElement} */ (root.querySelector(".dashboard-planet-canvas")),
    planetLabel: /** @type {HTMLElement} */ (root.querySelector(".dashboard-planet-label")),
    planetNote: /** @type {HTMLElement} */ (root.querySelector(".dashboard-planet-note")),
    open: false,
    hideTimer: 0,
    shipRowsKey: "",
    statsTableKey: "",
    centerWidth: 0,
  };
  dashboardStateByRoot.set(root, state);
  return state;
}

/**
 * @param {HTMLElement} root
 * @param {{leftPanel:HTMLElement,rightPanel:HTMLElement,open:boolean,centerWidth:number}} state
 * @param {boolean} open
 * @returns {void}
 */
function syncDashboardViewportState(root, state, open){
  if (typeof document === "undefined" || !document.body) return;
  const body = document.body;
  body.classList.toggle("dashboard-visible", !!open);
  if (!open){
    state.centerWidth = 0;
    body.style.removeProperty("--dashboard-center-width");
    return;
  }
  const rootRect = root.getBoundingClientRect();
  const leftWidth = state.leftPanel.getBoundingClientRect().width;
  const rightWidth = state.rightPanel.getBoundingClientRect().width;
  const rootStyle = window.getComputedStyle(root);
  const gap = parseFloat(rootStyle.columnGap || rootStyle.gap || "0") || 0;
  const padLeft = parseFloat(rootStyle.paddingLeft || "0") || 0;
  const padRight = parseFloat(rootStyle.paddingRight || "0") || 0;
  const centerWidth = Math.max(
    96,
    Math.round(rootRect.width - padLeft - padRight - leftWidth - rightWidth - gap - 24)
  );
  if (centerWidth === state.centerWidth) return;
  state.centerWidth = centerWidth;
  body.style.setProperty("--dashboard-center-width", `${centerWidth}px`);
}

/**
 * @param {HTMLElement} container
 * @param {Array<{label:string,value:string}>} rows
 * @param {any} state
 * @param {"shipRowsKey"} keyField
 * @returns {void}
 */
function renderDashboardRows(container, rows, state, keyField){
  const nextKey = JSON.stringify(rows || []);
  if (state[keyField] === nextKey) return;
  state[keyField] = nextKey;
  container.textContent = "";
  const frag = document.createDocumentFragment();
  for (const row of rows){
    const wrap = document.createElement("div");
    wrap.className = "dashboard-row";
    const key = document.createElement("div");
    key.className = "dashboard-k";
    key.textContent = row.label || "";
    const value = document.createElement("div");
    value.className = "dashboard-v";
    value.textContent = row.value || "";
    wrap.append(key, value);
    frag.appendChild(wrap);
  }
  container.appendChild(frag);
}

/**
 * @param {HTMLElement} body
 * @param {Array<{label:string,level:string,total:string}>} rows
 * @param {{statsTableKey:string}} state
 * @returns {void}
 */
function renderDashboardStatsTable(body, rows, state){
  const nextKey = JSON.stringify(rows || []);
  if (state.statsTableKey === nextKey) return;
  state.statsTableKey = nextKey;
  body.textContent = "";
  const frag = document.createDocumentFragment();
  for (const row of rows){
    const tr = document.createElement("tr");
    const metric = document.createElement("th");
    metric.scope = "row";
    metric.textContent = row.label || "";
    const level = document.createElement("td");
    level.textContent = row.level || "0";
    const total = document.createElement("td");
    total.textContent = row.total || "0";
    tr.append(metric, level, total);
    frag.appendChild(tr);
  }
  body.appendChild(frag);
}

/**
 * @param {HTMLElement} el
 * @param {string} value
 * @returns {void}
 */
function setTextIfChanged(el, value){
  if (el.textContent === value) return;
  el.textContent = value;
}

function ensureMothershipDashboardStyles(){
  if (document.getElementById(MOTHERSHIP_DASHBOARD_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = MOTHERSHIP_DASHBOARD_STYLE_ID;
  style.textContent = `
    #mothership-dashboard {
      position: fixed;
      inset: 0;
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 12px;
      padding:
        calc(var(--ui-top) + 2px)
        var(--ui-right)
        calc(var(--ui-bottom) + 2px)
        var(--ui-left);
      pointer-events: none;
      z-index: 12;
    }
    #mothership-dashboard .dashboard-panel {
      position: relative;
      width: min(100%, 500px);
      max-height: calc(100dvh - var(--ui-top) - var(--ui-bottom) - 8px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(255, 215, 110, 0.62);
      border-radius: 12px;
      background: linear-gradient(180deg, rgba(9, 13, 22, 0.88), rgba(8, 11, 19, 0.70));
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28), inset 0 0 0 1px rgba(255,255,255,0.05);
      color: #e8f0ff;
      opacity: 0;
      transition:
        transform 240ms cubic-bezier(.16,.88,.22,1),
        opacity 180ms ease,
        box-shadow 220ms ease;
      pointer-events: auto;
      backdrop-filter: blur(7px);
      user-select: none;
      -webkit-user-select: none;
    }
    #mothership-dashboard.dashboard-open .dashboard-panel {
      opacity: 1;
      box-shadow: 0 16px 36px rgba(0, 0, 0, 0.34), inset 0 0 0 1px rgba(255,255,255,0.05);
    }
    #mothership-dashboard .dashboard-panel-left {
      justify-self: start;
      align-self: start;
      transform: translateX(calc(-100% - 44px)) scale(0.96);
    }
    #mothership-dashboard .dashboard-panel-right {
      justify-self: end;
      align-self: start;
      width: min(100%, 560px);
      transform: translateX(calc(100% + 44px)) scale(0.96);
    }
    #mothership-dashboard.dashboard-open .dashboard-panel-left,
    #mothership-dashboard.dashboard-open .dashboard-panel-right {
      transform: translateX(0) scale(1);
    }
    #mothership-dashboard .dashboard-header {
      padding: 10px 12px 8px;
      border-bottom: 1px solid rgba(255, 215, 110, 0.24);
      background: linear-gradient(90deg, rgba(255, 215, 110, 0.12), rgba(120, 210, 255, 0.10));
      color: rgba(255, 240, 190, 0.98);
      font: 700 clamp(12px, 1.65vw, 15px)/1.08 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    #mothership-dashboard .dashboard-scroll {
      overflow: auto;
      min-height: 0;
      padding: 10px 12px 12px;
      scrollbar-width: thin;
      scrollbar-color: rgba(136, 210, 255, 0.85) rgba(255, 255, 255, 0.08);
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
    }
    #mothership-dashboard .dashboard-scroll::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    #mothership-dashboard .dashboard-scroll::-webkit-scrollbar-track {
      background: rgba(255, 255, 255, 0.08);
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.10);
    }
    #mothership-dashboard .dashboard-scroll::-webkit-scrollbar-thumb {
      background: linear-gradient(180deg, rgba(176, 226, 255, 0.95), rgba(120, 210, 255, 0.90));
      border-radius: 999px;
      border: 1px solid rgba(255, 255, 255, 0.24);
    }
    #mothership-dashboard .dashboard-rows {
      display: grid;
      gap: 7px;
    }
    #mothership-dashboard .dashboard-left-scroll {
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1 1 auto;
      min-height: 0;
    }
    #mothership-dashboard .dashboard-row {
      display: grid;
      grid-template-columns: minmax(80px, 0.44fr) 1fr;
      gap: 10px;
      align-items: start;
      padding: 6px 8px;
      border-radius: 8px;
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
    }
    #mothership-dashboard .dashboard-k {
      color: rgba(200, 235, 255, 0.95);
      font: 650 clamp(11px, 1.5vw, 13px)/1.12 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    #mothership-dashboard .dashboard-v,
    #mothership-dashboard .dashboard-copy {
      color: rgba(232, 240, 255, 0.95);
      font: 550 clamp(12px, 1.55vw, 14px)/1.24 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
    }
    #mothership-dashboard .dashboard-copy + .dashboard-copy {
      margin-top: 8px;
    }
    #mothership-dashboard .dashboard-section-label {
      color: rgba(165, 206, 228, 0.94);
      font: 700 clamp(11px, 1.45vw, 12px)/1.1 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    #mothership-dashboard .dashboard-mission-meta {
      color: rgba(165, 206, 228, 0.94);
      font-size: clamp(11px, 1.4vw, 12px);
      letter-spacing: 0.04em;
      text-transform: uppercase;
    }
    #mothership-dashboard .dashboard-right-body {
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 1 1 auto;
    }
    #mothership-dashboard .dashboard-text-scroll {
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1 1 auto;
      min-height: 0;
      max-height: none;
    }
    #mothership-dashboard .dashboard-planet-note {
      color: rgba(196, 220, 232, 0.94);
      font-size: clamp(11px, 1.45vw, 13px);
      line-height: 1.28;
    }
    #mothership-dashboard .dashboard-mission-title,
    #mothership-dashboard .dashboard-planet-label {
      color: rgba(255, 240, 190, 0.98);
      font-size: clamp(14px, 1.8vw, 17px);
      font-weight: 700;
      line-height: 1.15;
    }
    #mothership-dashboard .dashboard-mission-status {
      color: rgba(136, 220, 255, 0.98);
    }
    #mothership-dashboard .dashboard-planet-render {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      padding: 0 12px 12px;
    }
    #mothership-dashboard .dashboard-stats-wrap {
      overflow: visible;
      min-height: auto;
    }
    #mothership-dashboard .dashboard-stats-table {
      width: 100%;
      border-collapse: collapse;
      font: 550 clamp(12px, 1.5vw, 14px)/1.24 "Science Gothic", ui-sans-serif, system-ui, sans-serif;
      color: rgba(232, 240, 255, 0.95);
    }
    #mothership-dashboard .dashboard-stats-table th,
    #mothership-dashboard .dashboard-stats-table td {
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    #mothership-dashboard .dashboard-stats-table thead th {
      position: sticky;
      top: 0;
      background: rgba(9, 13, 22, 0.96);
      color: rgba(255, 240, 190, 0.98);
      font-weight: 700;
      z-index: 1;
    }
    #mothership-dashboard .dashboard-stats-table thead th:first-child {
      text-align: left;
    }
    #mothership-dashboard .dashboard-stats-table thead th:not(:first-child) {
      text-align: center;
    }
    #mothership-dashboard .dashboard-stats-table tbody th {
      color: rgba(200, 235, 255, 0.95);
      font-weight: 650;
      text-align: left;
      white-space: nowrap;
    }
    #mothership-dashboard .dashboard-stats-table td {
      text-align: center;
      font-variant-numeric: tabular-nums;
    }
    #mothership-dashboard .dashboard-planet-canvas {
      width: auto;
      height: auto;
      display: block;
      align-self: center;
      flex: 0 0 auto;
      max-width: 100%;
      max-height: min(44dvh, 420px);
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.12);
      background: rgba(8, 11, 19, 0.96);
      image-rendering: auto;
    }
    @media (max-width: 960px), (max-height: 760px) {
      #mothership-dashboard {
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
      }
      #mothership-dashboard .dashboard-panel {
        width: min(33vw, 240px);
        min-width: 150px;
        max-height: calc(100dvh - var(--ui-top) - var(--ui-bottom) - 8px);
        border-radius: 10px;
      }
      #mothership-dashboard .dashboard-panel-left,
      #mothership-dashboard .dashboard-panel-right {
        align-self: start;
      }
      #mothership-dashboard .dashboard-header {
        padding: 7px 9px 6px;
        font-size: 11px;
      }
      #mothership-dashboard .dashboard-scroll {
        padding: 7px 8px 8px;
      }
      #mothership-dashboard .dashboard-left-scroll {
        gap: 8px;
      }
      #mothership-dashboard .dashboard-row {
        grid-template-columns: minmax(44px, 0.52fr) 1fr;
        gap: 6px;
        padding: 4px 5px;
      }
      #mothership-dashboard .dashboard-k,
      #mothership-dashboard .dashboard-v,
      #mothership-dashboard .dashboard-copy,
      #mothership-dashboard .dashboard-stats-table {
        font-size: 11px;
        line-height: 1.18;
      }
      #mothership-dashboard .dashboard-section-label,
      #mothership-dashboard .dashboard-mission-meta {
        font-size: 10px;
      }
      #mothership-dashboard .dashboard-mission-title,
      #mothership-dashboard .dashboard-planet-label {
        font-size: 12px;
      }
      #mothership-dashboard .dashboard-text-scroll {
        gap: 5px;
      }
      #mothership-dashboard .dashboard-planet-render {
        padding: 0 8px 8px;
      }
      #mothership-dashboard .dashboard-planet-canvas {
        max-height: 104px;
      }
      #mothership-dashboard .dashboard-stats-table th,
      #mothership-dashboard .dashboard-stats-table td {
        padding: 5px 6px;
      }
    }
    @media (max-width: 860px) {
      #mothership-dashboard {
        padding:
          calc(var(--ui-top) + 2px)
          max(8px, env(safe-area-inset-right))
          calc(var(--ui-bottom) + 2px)
          max(8px, env(safe-area-inset-left));
      }
    }
    @media (max-width: 560px) {
      #mothership-dashboard .dashboard-panel {
        width: min(34vw, 200px);
        min-width: 132px;
        max-height: calc(100dvh - var(--ui-top) - var(--ui-bottom) - 8px);
      }
    }
  `;
  document.head.appendChild(style);
}

/**
 * Keep heat meter from overlapping corner status text on small screens.
 * @param {HTMLElement} el
 * @returns {void}
 */
function layoutHeatMeter(el){
  const pad = 10;
  const baseBottom = 14;
  const minViewportInset = 12;
  const vH = window.innerHeight || document.documentElement.clientHeight || 0;
  const objective = /** @type {HTMLElement|null} */ (document.getElementById("objective-label"));
  const planet = /** @type {HTMLElement|null} */ (document.getElementById("planet-label"));
  const shipStatus = /** @type {HTMLElement|null} */ (document.getElementById("ship-status-label"));
  const signalMeter = /** @type {HTMLElement|null} */ (document.getElementById("signal-meter"));

  el.style.left = "50%";
  el.style.transform = "translateX(-50%)";
  el.style.top = "auto";
  el.style.bottom = `${baseBottom}px`;

  const meterRect = el.getBoundingClientRect();
  const labels = [objective, planet]
    .filter((node) => !!node)
    .map((node) => /** @type {HTMLElement} */ (node).getBoundingClientRect());

  const overlaps = labels.filter((r) => rectsOverlap(meterRect, r, pad));
  if (!overlaps.length) return;

  let minTop = /** @type {DOMRect} */ (overlaps[0]).top;
  for (let i = 1; i < overlaps.length; i++){
    const overlapRect = /** @type {DOMRect} */ (overlaps[i]);
    if (overlapRect.top < minTop) minTop = overlapRect.top;
  }
  const liftedBottom = Math.max(baseBottom, Math.round(vH - minTop + pad));
  const maxLiftedBottom = Math.max(baseBottom, Math.round(vH - meterRect.height - minViewportInset));
  el.style.bottom = `${Math.min(liftedBottom, maxLiftedBottom)}px`;
  el.style.top = "auto";

  const liftedRect = el.getBoundingClientRect();
  const stillOverlaps = labels.some((r) => rectsOverlap(liftedRect, r, pad));
  if (!stillOverlaps) return;

  const topAnchors = [shipStatus, signalMeter]
    .filter((node) => !!node && /** @type {HTMLElement} */ (node).style.display !== "none")
    .map((node) => /** @type {HTMLElement} */ (node).getBoundingClientRect().bottom);
  const topY = topAnchors.length
    ? Math.round(Math.max(...topAnchors) + pad)
    : minViewportInset;
  const maxTop = Math.max(minViewportInset, Math.round(vH - liftedRect.height - minViewportInset));
  el.style.top = `${Math.min(maxTop, Math.max(minViewportInset, topY))}px`;
  el.style.bottom = "auto";
}

/**
 * Keep the top-center signal meter from overlapping the top-left ship status on narrow screens.
 * @param {HTMLElement} el
 * @returns {void}
 */
function layoutSignalMeter(el){
  const pad = 10;
  const minViewportInset = 12;
  const vH = window.innerHeight || document.documentElement.clientHeight || 0;
  const shipStatus = /** @type {HTMLElement|null} */ (document.getElementById("ship-status-label"));

  el.style.left = "50%";
  el.style.transform = "translateX(-50%)";
  el.style.top = "var(--ui-top)";
  el.style.bottom = "auto";

  if (!shipStatus) return;

  const meterRect = el.getBoundingClientRect();
  const shipRect = shipStatus.getBoundingClientRect();
  if (!rectsOverlap(meterRect, shipRect, pad)) return;

  const topY = Math.round(shipRect.bottom + pad);
  const maxTop = Math.max(minViewportInset, Math.round(vH - meterRect.height - minViewportInset));
  el.style.top = `${Math.min(maxTop, Math.max(minViewportInset, topY))}px`;
}

/**
 * @param {DOMRect} a
 * @param {DOMRect} b
 * @param {number} margin
 * @returns {boolean}
 */
function rectsOverlap(a, b, margin){
  return !(
    a.right < b.left - margin ||
    a.left > b.right + margin ||
    a.bottom < b.top - margin ||
    a.top > b.bottom + margin
  );
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {PlanetPreview} preview
 * @returns {void}
 */
function drawPlanetPreview(canvas, preview){
  const wrap = canvas.parentElement instanceof HTMLElement ? canvas.parentElement : null;
  const wrapWidthCss = wrap ? wrap.clientWidth : (canvas.clientWidth || 220);
  const widthCss = Math.max(120, Math.round(wrapWidthCss || 220));
  const compactPreview = window.matchMedia("(max-width: 960px), (max-height: 760px)").matches;
  const canvasStyle = window.getComputedStyle(canvas);
  const maxHeightCss = Number.parseFloat(canvasStyle.maxHeight || "");
  const sizeLimitCss = Number.isFinite(maxHeightCss) && maxHeightCss > 0
    ? maxHeightCss
    : (compactPreview ? 104 : 420);
  // Keep the preview modest on compact layouts, but make it roughly 2x larger
  // on roomy screens where the dashboard has enough space for a more legible scan.
  const targetSideCss = compactPreview ? 84 : 168;
  const sideCss = Math.max(84, Math.min(widthCss, sizeLimitCss, targetSideCss));
  canvas.style.width = `${Math.round(sideCss)}px`;
  canvas.style.height = `${Math.round(sideCss)}px`;
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const side = Math.max(96, Math.min(compactPreview ? 256 : 512, Math.round(sideCss * dpr)));
  const seed = preview.planet && typeof preview.planet.getSeed === "function" ? preview.planet.getSeed() : 0;
  const rotation = (typeof preview.rotation === "number" && Number.isFinite(preview.rotation)) ? preview.rotation : 0;
  const rasterKey = `${seed}:${side}:${preview.worldRadius.toFixed(2)}:${preview.surfaceRadius.toFixed(2)}:${preview.fogEnabled ? 1 : 0}`;
  const drawKey = `${rasterKey}:${rotation.toFixed(4)}`;
  if (canvas.width !== side || canvas.height !== side){
    canvas.width = side;
    canvas.height = side;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cache = ensurePlanetPreviewCache(canvas);
  if (cache.lastDrawKey === drawKey) return;

  if (cache.rasterKey !== rasterKey || !cache.rasterCanvas){
    const rasterCanvas = document.createElement("canvas");
    rasterCanvas.width = side;
    rasterCanvas.height = side;
    cache.rasterCanvas = rasterCanvas;
    cache.rasterKey = rasterKey;
    renderPlanetPreviewRaster(rasterCanvas, preview, side);
  }

  const rasterCanvas = cache.rasterCanvas;
  if (!rasterCanvas) return;
  cache.lastDrawKey = drawKey;
  ctx.clearRect(0, 0, side, side);
  ctx.save();
  ctx.translate(side * 0.5, side * 0.5);
  ctx.rotate(-rotation);
  ctx.translate(-side * 0.5, -side * 0.5);
  ctx.drawImage(rasterCanvas, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(side * 0.5, side * 0.5, side * 0.5 - 1.5, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 1;
  for (let i = 1; i <= 4; i++){
    const yy = Math.round(side * (0.18 + i * 0.15));
    ctx.beginPath();
    ctx.moveTo(side * 0.12, yy);
    ctx.lineTo(side * 0.88, yy);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {PlanetPreview} preview
 * @param {number} side
 * @returns {void}
 */
function renderPlanetPreviewRaster(canvas, preview, side){
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(side, side);
  const data = img.data;
  const palette = preview.palette || null;
  const worldRadius = Math.max(0.01, preview.worldRadius);
  const surfaceRadius = Math.max(0.01, preview.surfaceRadius);
  const renderRadius = Math.min(worldRadius, surfaceRadius);
  const frameRadius = renderRadius * 1.08;
  const center = side * 0.5;
  const pxToWorld = (frameRadius * 2) / side;
  /** @type {RgbTriplet} */
  const fogColor = Array.isArray(GAME.FOG_COLOR) && GAME.FOG_COLOR.length >= 3
    ? /** @type {RgbTriplet} */ (GAME.FOG_COLOR)
    : [0.1, 0.1, 0.1];

  for (let y = 0; y < side; y++){
    const ly = -(y + 0.5 - center) * pxToWorld;
    for (let x = 0; x < side; x++){
      const lx = (x + 0.5 - center) * pxToWorld;
      const idx = (y * side + x) * 4;
      const r = Math.hypot(lx, ly);
      if (r > renderRadius){
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
        continue;
      }
      const air = preview.planet.airValueAtWorld(lx, ly);
      const shade = preview.planet.shadeAtWorld ? clamp01(preview.planet.shadeAtWorld(lx, ly)) : 0.5;
      const fogAlpha = !preview.fogEnabled || !preview.planet.fogAlphaAtWorld ? 0 : clamp01(preview.planet.fogAlphaAtWorld(lx, ly));
      const base = samplePlanetPreviewColor(r, air, shade, palette, surfaceRadius);
      const fog = preview.fogEnabled ? fogAlpha : 0;
      data[idx] = Math.round(lerp(base[0], fogColor[0], fog) * 255);
      data[idx + 1] = Math.round(lerp(base[1], fogColor[1], fog) * 255);
      data[idx + 2] = Math.round(lerp(base[2], fogColor[2], fog) * 255);
      data[idx + 3] = 255;
    }
  }

  ctx.clearRect(0, 0, side, side);
  ctx.putImageData(img, 0, 0);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {void}
 */
function clearPlanetPreview(canvas){
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  if (!canvas.width || !canvas.height){
    const widthCss = Math.max(120, Math.round(canvas.clientWidth || 220));
    canvas.width = widthCss;
    canvas.height = widthCss;
  }
  const cache = planetPreviewCacheByCanvas.get(canvas);
  if (cache){
    cache.lastDrawKey = "";
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{rasterKey:string,lastDrawKey:string,rasterCanvas:HTMLCanvasElement|null}}
 */
function ensurePlanetPreviewCache(canvas){
  const existing = planetPreviewCacheByCanvas.get(canvas);
  if (existing) return existing;
  const cache = {
    rasterKey: "",
    lastDrawKey: "",
    rasterCanvas: null,
  };
  planetPreviewCacheByCanvas.set(canvas, cache);
  return cache;
}

/**
 * @param {number} r
 * @param {number} air
 * @param {number} shade
 * @param {PlanetPreviewPalette|null} palette
 * @param {number} surfaceRadius
 * @returns {RgbTriplet}
 */
function samplePlanetPreviewColor(r, air, shade, palette, surfaceRadius){
  const t = clamp01(shade);
  /** @type {RgbTriplet} */
  const rockDark = palette ? palette.rockDark : [0.17, 0.18, 0.21];
  /** @type {RgbTriplet} */
  const rockLight = palette ? palette.rockLight : [0.42, 0.44, 0.50];
  /** @type {RgbTriplet} */
  const airDark = palette ? palette.airDark : [0.16, 0.17, 0.20];
  /** @type {RgbTriplet} */
  const airLight = palette ? palette.airLight : [0.25, 0.28, 0.34];
  /** @type {RgbTriplet} */
  const surfaceDark = palette ? palette.surfaceRockDark : rockDark;
  /** @type {RgbTriplet} */
  const surfaceLight = palette ? palette.surfaceRockLight : rockLight;
  const surfaceBand = palette && typeof palette.surfaceBand === "number" ? Math.max(0, palette.surfaceBand) : 0;
  const useSurface = surfaceBand > 0 && r > (surfaceRadius - surfaceBand * surfaceRadius);

  if (air > 0.5){
    return mixColor(airDark, airLight, t);
  }
  return useSurface
    ? mixColor(surfaceDark, surfaceLight, t)
    : mixColor(rockDark, rockLight, t);
}

/**
 * @param {RgbTriplet} a
 * @param {RgbTriplet} b
 * @param {number} t
 * @returns {RgbTriplet}
 */
function mixColor(a, b, t){
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
  ];
}

/**
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
function lerp(a, b, t){
  return a + (b - a) * t;
}

/**
 * @param {number} v
 * @returns {number}
 */
function clamp01(v){
  return Math.max(0, Math.min(1, v));
}
