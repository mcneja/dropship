// @ts-check

/**
 * @param {HTMLElement} hud
 * @param {{fps:number,state:string,speed:number,verts:number,air:number,miners:number,minersDead:number,level:number,debug:boolean,minerCandidates:number,shipHp:number,bombs:number,inputType:("keyboard"|"mouse"|"touch"|"gamepad"|null|undefined)}} stats
 * @returns {void}
 */
export function updateHud(hud, stats){
  if (stats.state === "crashed"){
    hud.textContent = "Game over";
    return;
  }
  const debugSuffix = stats.debug ? ` | miner candidates: ${stats.minerCandidates}` : "";
  hud.textContent =
    `fps: ${stats.fps} | hull: ${stats.shipHp} | bombs: ${stats.bombs} | level: ${stats.level} | state: ${stats.state} | speed: ${stats.speed.toFixed(2)} | miners: ${stats.miners} | dead: ${stats.minersDead} | verts: ${stats.verts.toLocaleString()} | air: ${stats.air.toFixed(3)}${debugSuffix} | LMB: shoot | RMB: bomb | -/=: music vol | Alt+M: new map | Alt+N: next level | Alt+Shift+N: prev level | Alt+C: debug collisions | Alt+V: view map | Alt+X: clear enemies | Alt+\\: toggle dev HUD | B: music | J: combat tracks | R: restart`;
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
  const text = /** @type {HTMLElement|null} */ (el.querySelector(".heat-text"));
  if (text) text.textContent = `Heat ${value}`;
  const fill = /** @type {HTMLElement|null} */ (el.querySelector(".heat-bar-fill"));
  if (fill) fill.style.width = `${value}%`;
  layoutHeatMeter(el);
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

  // Default placement: bottom center.
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

  let minTop = overlaps[0].top;
  for (let i = 1; i < overlaps.length; i++){
    if (overlaps[i].top < minTop) minTop = overlaps[i].top;
  }
  const liftedBottom = Math.max(baseBottom, Math.round(vH - minTop + pad));
  const maxLiftedBottom = Math.max(baseBottom, Math.round(vH - meterRect.height - minViewportInset));
  el.style.bottom = `${Math.min(liftedBottom, maxLiftedBottom)}px`;
  el.style.top = "auto";

  const liftedRect = el.getBoundingClientRect();
  const stillOverlaps = labels.some((r) => rectsOverlap(liftedRect, r, pad));
  if (!stillOverlaps) return;

  // Fallback on very small screens: place below top-left ship status zone.
  const topY = shipStatus ? Math.round(shipStatus.getBoundingClientRect().bottom + pad) : minViewportInset;
  const maxTop = Math.max(minViewportInset, Math.round(vH - liftedRect.height - minViewportInset));
  el.style.top = `${Math.min(maxTop, Math.max(minViewportInset, topY))}px`;
  el.style.bottom = "auto";
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
