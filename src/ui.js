// @ts-check

/**
 * @param {HTMLElement} hud
 * @param {{fps:number,state:string,speed:number,verts:number,air:number,miners:number,minersDead:number,level:number,debug:boolean,minerCandidates:number,shipHp:number,inputType:("keyboard"|"mouse"|"touch"|"gamepad"|null|undefined)}} stats
 * @returns {void}
 */
export function updateHud(hud, stats){
  if (stats.state === "crashed"){
    hud.textContent = "Game over";
    return;
  }
  const debugSuffix = stats.debug ? ` | miner candidates: ${stats.minerCandidates}` : "";
  const base =
    `fps: ${stats.fps} | hull: ${stats.shipHp} | level: ${stats.level} | state: ${stats.state} | speed: ${stats.speed.toFixed(2)} | miners: ${stats.miners} | dead: ${stats.minersDead} | verts: ${stats.verts.toLocaleString()} | air: ${stats.air.toFixed(3)}${debugSuffix} | LMB: shoot | RMB: bomb | M: new map | N: next level | C: debug collisions | R: restart`;
  hud.textContent = base;
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
  const text = el.querySelector(".heat-text");
  if (text) text.textContent = `Heat ${value}`;
  const fill = el.querySelector(".heat-bar-fill");
  if (fill) fill.style.width = `${value}%`;
}
