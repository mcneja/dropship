// @ts-check

/**
 * @param {HTMLElement} hud
 * @param {{fps:number,state:string,speed:number,verts:number,air:number,miners:number,minersDead:number,level:number,debug:boolean,minerCandidates:number,shipHp:number,inputType:("keyboard"|"mouse"|"touch"|"gamepad"|null|undefined)}} stats
 * @returns {void}
 */
export function updateHud(hud, stats){
  if (stats.state === "crashed"){
    const inputType = stats.inputType || "keyboard";
    if (inputType === "touch"){
      hud.textContent = "Game over";
    } else if (inputType === "gamepad"){
      hud.textContent = "Game over, press start to play again";
    } else {
      hud.textContent = "Game over, press R to restart";
    }
    return;
  }
  const debugSuffix = stats.debug ? ` | miner candidates: ${stats.minerCandidates}` : "";
  hud.textContent =
    `fps: ${stats.fps} | hull: ${stats.shipHp} | level: ${stats.level} | state: ${stats.state} | speed: ${stats.speed.toFixed(2)} | miners: ${stats.miners} | dead: ${stats.minersDead} | verts: ${stats.verts.toLocaleString()} | air: ${stats.air.toFixed(3)}${debugSuffix} | LMB: shoot | RMB: bomb | M: new map | N: next level | C: debug collisions | R: restart`;
}
