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
    `fps: ${stats.fps} | hull: ${stats.shipHp} | bombs: ${stats.bombs} | level: ${stats.level} | state: ${stats.state} | speed: ${stats.speed.toFixed(2)} | miners: ${stats.miners} | dead: ${stats.minersDead} | verts: ${stats.verts.toLocaleString()} | air: ${stats.air.toFixed(3)}${debugSuffix} | LMB: shoot | RMB: bomb | M: new map | N: next level | Shift+N: prev level | C: debug collisions | \\: toggle dev HUD | R: restart`;
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
}
