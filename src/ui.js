// @ts-check

/**
 * @param {HTMLElement} hud
 * @param {{fps:number,state:string,speed:number,verts:number,air:number}} stats
 */
export function updateHud(hud, stats){
  hud.textContent =
    `fps: ${stats.fps} | state: ${stats.state} | speed: ${stats.speed.toFixed(2)} | verts: ${stats.verts.toLocaleString()} | air: ${stats.air.toFixed(3)} | M: new map | C: debug collisions | R: restart`;
}
