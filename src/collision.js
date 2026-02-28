// @ts-check

/**
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function isAir(mesh, x, y){
  return mesh.airValueAtWorld(x, y) > 0.5;
}

/**
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {Array<[number, number]>} points
 * @returns {boolean}
 */
export function collidesAtWorldPoints(mesh, points){
  for (const [x, y] of points){
    if (mesh.airValueAtWorld(x, y) <= 0.5) return true;
  }
  return false;
}

/**
 * @param {{ airValueAtWorld:(x:number,y:number)=>number }} mesh
 * @param {number} x
 * @param {number} y
 * @param {Array<[number, number]>} offsets
 * @returns {boolean}
 */
export function collidesAtOffsets(mesh, x, y, offsets){
  for (const [dx, dy] of offsets){
    if (mesh.airValueAtWorld(x + dx, y + dy) <= 0.5) return true;
  }
  return false;
}
