// @ts-check

/** @typedef {import("./types.d.js").FragmentOwnerType} FragmentOwnerType */
/** @typedef {import("./types.d.js").FragmentDestroyedBy} FragmentDestroyedBy */
/** @typedef {import("./types.d.js").Debris} Debris */
/** @typedef {import("./types.d.js").DestroyedTerrainNode} DestroyedTerrainNode */
/** @typedef {import("./types.d.js").DetachedTerrainProp} DetachedTerrainProp */

/**
 * @param {FragmentOwnerType} type
 * @returns {[number,number,number]}
 */
export function fragmentBaseColor(type){
  if (type === "hunter"){
    return [0.92, 0.25, 0.2];
  }
  if (type === "ranger"){
    return [0.2, 0.75, 0.95];
  }
  if (type === "crawler"){
    return [0.95, 0.55, 0.2];
  }
  if (type === "dropship"){
    return [0.70, 0.73, 0.77];
  }
  if (type === "pilot"){
    return [0.1, 0.25, 0.98];
  }
  if (type === "engineer"){
    return [0.2, 0.98, 0.2];
  }
  if (type === "miner"){
    return [0.98, 0.85, 0.25];
  }
  if (type === "rock"){
    return [0.58, 0.36, 0.20];
  }
  return [0.5, 0.125, 1.0];
}

/**
 * @param {FragmentOwnerType} type
 * @param {FragmentDestroyedBy} destroyedBy
 * @returns {{
 *  pieces:number,
 *  speedMin:number,
 *  speedMax:number,
 *  lifeMin:number,
 *  lifeMax:number,
 *  offset:number,
 *  sizeMin:number,
 *  sizeMax:number,
 *  stretchMin:number,
 *  stretchMax:number,
 *  spinMin:number,
 *  spinMax:number,
 *  inheritVelocity:number,
 *  dragMul:number,
 * }}
 */
export function fragmentBurstProfile(type, destroyedBy){
  const explosive = destroyedBy === "bomb" || destroyedBy === "explosion" || destroyedBy === "detonate";
  const crawler = type === "crawler";
  if (crawler){
    const baseCrawler = {
      pieces: 8,
      speedMin: 0.95,
      speedMax: 2.8,
      lifeMin: 0.95,
      lifeMax: 1.45,
      offset: 0.20,
      sizeMin: 0.18,
      sizeMax: 0.31,
      stretchMin: 1.6,
      stretchMax: 2.6,
      spinMin: 2.6,
      spinMax: 8.8,
      inheritVelocity: 0.55,
      dragMul: 1.45,
    };
    if (destroyedBy === "bomb"){
      return {
        ...baseCrawler,
        speedMin: baseCrawler.speedMin * 2,
        speedMax: baseCrawler.speedMax * 2,
        dragMul: 1.7,
      };
    }
    if (explosive){
      return {
        ...baseCrawler,
        speedMin: baseCrawler.speedMin * 1.35,
        speedMax: baseCrawler.speedMax * 1.35,
        dragMul: 1.55,
      };
    }
    return baseCrawler;
  }
  if (type === "turret"){
    const baseTurret = {
      pieces: 4,
      speedMin: 0.18,
      speedMax: 0.7,
      lifeMin: 0.7,
      lifeMax: 1.05,
      offset: 0.10,
      sizeMin: 0.12,
      sizeMax: 0.20,
      stretchMin: 1.35,
      stretchMax: 2.1,
      spinMin: 1.6,
      spinMax: 5.8,
      inheritVelocity: 0.55,
      dragMul: 1.0,
    };
    if (explosive){
      return {
        ...baseTurret,
        speedMin: 0.9,
        speedMax: 2.2,
      };
    }
    return baseTurret;
  }
  if (type === "dropship"){
    if (explosive){
      return {
        pieces: 6,
        speedMin: 0.75,
        speedMax: 1.8,
        lifeMin: 1.0,
        lifeMax: 1.45,
        offset: 0.20,
        sizeMin: 0.22,
        sizeMax: 0.34,
        stretchMin: 1.5,
        stretchMax: 2.35,
        spinMin: 1.9,
        spinMax: 6.0,
        inheritVelocity: 0.45,
        dragMul: 1.1,
      };
    }
    return {
      pieces: 6,
      speedMin: 0.22,
      speedMax: 0.75,
      lifeMin: 0.85,
      lifeMax: 1.25,
      offset: 0.14,
      sizeMin: 0.18,
      sizeMax: 0.28,
      stretchMin: 1.35,
      stretchMax: 2.0,
      spinMin: 1.4,
      spinMax: 4.6,
      inheritVelocity: 0.6,
      dragMul: 1.0,
    };
  }
  if (type === "miner" || type === "pilot" || type === "engineer"){
    if (explosive){
      return {
        pieces: 1,
        speedMin: 0.45,
        speedMax: 1.15,
        lifeMin: 0.9,
        lifeMax: 1.2,
        offset: 0.13,
        sizeMin: 0.12,
        sizeMax: 0.18,
        stretchMin: 1.35,
        stretchMax: 1.9,
        spinMin: 1.5,
        spinMax: 4.8,
        inheritVelocity: 0.5,
        dragMul: 1.0,
      };
    }
    return {
      pieces: 1,
      speedMin: 0.12,
      speedMax: 0.45,
      lifeMin: 0.7,
      lifeMax: 1.0,
      offset: 0.09,
      sizeMin: 0.11,
      sizeMax: 0.16,
      stretchMin: 1.2,
      stretchMax: 1.7,
      spinMin: 1.0,
      spinMax: 3.6,
      inheritVelocity: 0.65,
      dragMul: 1.0,
    };
  }
  const baseEnemy = {
    pieces: 6,
    speedMin: 0.18,
    speedMax: 0.7,
    lifeMin: 0.7,
    lifeMax: 1.05,
    offset: 0.10,
    sizeMin: 0.12,
    sizeMax: 0.20,
    stretchMin: 1.35,
    stretchMax: 2.1,
    spinMin: 1.6,
    spinMax: 5.8,
    inheritVelocity: 0.55,
    dragMul: 1.0,
  };
  if (explosive){
    return {
      ...baseEnemy,
      speedMin: 0.9,
      speedMax: 2.2,
    };
  }
  return baseEnemy;
}

/**
 * @param {Debris[]} out
 * @param {{x:number,y:number,vx?:number,vy?:number}} source
 * @param {FragmentOwnerType} ownerType
 * @param {FragmentDestroyedBy} destroyedBy
 * @param {Partial<ReturnType<typeof fragmentBurstProfile>>} [overrides]
 * @returns {void}
 */
export function spawnFragmentBurst(out, source, ownerType, destroyedBy, overrides = {}){
  const profile = { ...fragmentBurstProfile(ownerType, destroyedBy), ...overrides };
  const baseVx = (source.vx || 0) * profile.inheritVelocity;
  const baseVy = (source.vy || 0) * profile.inheritVelocity;
  const pieces = Math.max(1, profile.pieces | 0);
  for (let k = 0; k < pieces; k++){
    const angBase = (k / pieces) * Math.PI * 2;
    const ang = angBase + (Math.random() * 2 - 1) * (Math.PI / Math.max(3, pieces));
    const radial = profile.offset * (0.55 + Math.random() * 0.9);
    const sp = profile.speedMin + Math.random() * Math.max(0, profile.speedMax - profile.speedMin);
    const life = profile.lifeMin + Math.random() * Math.max(0, profile.lifeMax - profile.lifeMin);
    const spinMag = profile.spinMin + Math.random() * Math.max(0, profile.spinMax - profile.spinMin);
    out.push({
      x: source.x + Math.cos(ang) * radial,
      y: source.y + Math.sin(ang) * radial,
      vx: baseVx + Math.cos(ang) * sp,
      vy: baseVy + Math.sin(ang) * sp,
      a: ang + (Math.random() - 0.5) * 0.8,
      w: (Math.random() < 0.5 ? -1 : 1) * spinMag,
      life,
      maxLife: life,
      ownerType,
      size: profile.sizeMin + Math.random() * Math.max(0, profile.sizeMax - profile.sizeMin),
      stretch: profile.stretchMin + Math.random() * Math.max(0, profile.stretchMax - profile.stretchMin),
      dragMul: profile.dragMul,
    });
  }
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
 * @param {{x:number,y:number}} point
 * @param {{x:number,y:number}} explosionSource
 * @param {number|undefined} fallbackNx
 * @param {number|undefined} fallbackNy
 * @returns {{dirX:number,dirY:number,tanX:number,tanY:number}}
 */
function basisFromExplosion(point, explosionSource, fallbackNx, fallbackNy){
  let baseX = point.x - explosionSource.x;
  let baseY = point.y - explosionSource.y;
  let baseLen = Math.hypot(baseX, baseY);
  if (baseLen <= 1e-4 && Number.isFinite(fallbackNx) && Number.isFinite(fallbackNy)){
    baseX = Number(fallbackNx);
    baseY = Number(fallbackNy);
    baseLen = Math.hypot(baseX, baseY);
  }
  if (baseLen <= 1e-4){
    const a = Math.random() * Math.PI * 2;
    baseX = Math.cos(a);
    baseY = Math.sin(a);
    baseLen = 1;
  }
  const dirX = baseX / baseLen;
  const dirY = baseY / baseLen;
  return { dirX, dirY, tanX: -dirY, tanY: dirX };
}

/**
 * @param {Debris[]} out
 * @param {DestroyedTerrainNode[]} nodes
 * @param {{x:number,y:number}} explosionSource
 * @param {{rockDark:[number,number,number],rockLight:[number,number,number]}} palette
 * @returns {void}
 */
export function spawnTerrainHexFragments(out, nodes, explosionSource, palette){
  if (!out || !nodes || !nodes.length || !explosionSource || !palette) return;
  const rockDark = palette.rockDark || [0.58, 0.36, 0.20];
  const rockLight = palette.rockLight || rockDark;
  for (const node of nodes){
    if (!node) continue;
    const { dirX, dirY, tanX, tanY } = basisFromExplosion(node, explosionSource, node.nx, node.ny);
    const ringRadius = 0.30;
    for (let i = 0; i < 7; i++){
      const ringIndex = i - 1;
      const localAng = ringIndex >= 0 ? (ringIndex / 6) * Math.PI * 2 : 0;
      const localR = ringIndex >= 0 ? ringRadius : 0;
      const localJitter = ringIndex >= 0 ? (Math.random() * 2 - 1) * 0.02 : 0;
      const ringCos = Math.cos(localAng);
      const ringSin = Math.sin(localAng);
      const localX = dirX * (ringCos * localR + localJitter) + tanX * (ringSin * localR);
      const localY = dirY * (ringCos * localR + localJitter) + tanY * (ringSin * localR);
      let velX = node.x + localX - explosionSource.x;
      let velY = node.y + localY - explosionSource.y;
      let velLen = Math.hypot(velX, velY);
      if (velLen <= 1e-4){
        velX = dirX;
        velY = dirY;
        velLen = 1;
      }
      velX /= velLen;
      velY /= velLen;
      const angleNoise = (Math.random() * 2 - 1) * 0.42;
      const ca = Math.cos(angleNoise);
      const sa = Math.sin(angleNoise);
      const ux = velX * ca - velY * sa;
      const uy = velX * sa + velY * ca;
      const speed = 0.24 + Math.random() * 0.62;
      const life = 1.2 + Math.random() * 0.75;
      const shadeT = 0.35 + Math.random() * 0.3;
      out.push({
        x: node.x + localX,
        y: node.y + localY,
        vx: ux * speed,
        vy: uy * speed,
        a: Math.random() * Math.PI * 2,
        w: (Math.random() - 0.5) * 4.8,
        life,
        maxLife: life,
        ownerType: "rock",
        size: ringIndex < 0 ? 0.185 + Math.random() * 0.025 : 0.165 + Math.random() * 0.025,
        dragMul: 1.1,
        alpha: 0.96,
        cr: lerp(rockDark[0], rockLight[0], shadeT),
        cg: lerp(rockDark[1], rockLight[1], shadeT),
        cb: lerp(rockDark[2], rockLight[2], shadeT),
        sides: 6,
      });
    }
  }
}

/**
 * @param {Debris[]} out
 * @param {DetachedTerrainProp[]} props
 * @param {{x:number,y:number}} explosionSource
 * @param {{rockDark:[number,number,number],rockLight:[number,number,number]}} palette
 * @returns {void}
 */
export function spawnTerrainPropFragments(out, props, explosionSource, palette){
  if (!out || !props || !props.length || !explosionSource || !palette) return;
  const rockDark = palette.rockDark || [0.58, 0.36, 0.20];
  const rockLight = palette.rockLight || rockDark;
  for (const prop of props){
    if (!prop) continue;
    const scale = Math.max(0.2, prop.scale || 1);
    const { dirX, dirY, tanX, tanY } = basisFromExplosion(prop, explosionSource, prop.nx, prop.ny);
    if (prop.type === "boulder"){
      const speed = 0.2 + Math.random() * 0.45;
      const life = 1.3 + Math.random() * 0.7;
      const shadeT = 0.4 + Math.random() * 0.2;
      out.push({
        x: prop.x + dirX * 0.06 * scale,
        y: prop.y + dirY * 0.06 * scale,
        vx: dirX * speed,
        vy: dirY * speed,
        a: (prop.rot || 0) + (Math.random() - 0.5) * 0.4,
        w: (Math.random() - 0.5) * 3.6,
        life,
        maxLife: life,
        ownerType: "rock",
        size: 0.24 * scale,
        dragMul: 1.05,
        alpha: 0.96,
        cr: lerp(rockDark[0], rockLight[0], shadeT),
        cg: lerp(rockDark[1], rockLight[1], shadeT),
        cb: lerp(rockDark[2], rockLight[2], shadeT),
        sides: 6,
      });
      continue;
    }
    if (prop.type !== "tree") continue;
    /** @type {Array<{localX:number,localY:number,size:number,stretch:number,spin:number,color:[number,number,number]}>} */
    const pieces = [
      { localX: -0.08 * scale, localY: 0.14 * scale, size: 0.13 * scale, stretch: 1.7, spin: 4.2, color: [0.45, 0.30, 0.18] },
      { localX: 0.08 * scale, localY: 0.30 * scale, size: 0.12 * scale, stretch: 1.8, spin: 4.9, color: [0.45, 0.30, 0.18] },
      { localX: -0.18 * scale, localY: 0.62 * scale, size: 0.18 * scale, stretch: 1.65, spin: 5.4, color: [0.22, 0.64, 0.24] },
      { localX: 0.18 * scale, localY: 0.66 * scale, size: 0.18 * scale, stretch: 1.65, spin: 5.1, color: [0.20, 0.58, 0.22] },
      { localX: -0.04 * scale, localY: 0.92 * scale, size: 0.17 * scale, stretch: 1.55, spin: 4.8, color: [0.18, 0.56, 0.20] },
      { localX: -0.22 * scale, localY: 0.82 * scale, size: 0.16 * scale, stretch: 1.55, spin: 5.6, color: [0.20, 0.60, 0.22] },
      { localX: 0.22 * scale, localY: 0.84 * scale, size: 0.16 * scale, stretch: 1.55, spin: 5.2, color: [0.18, 0.54, 0.20] },
    ];
    for (const piece of pieces){
      const worldX = prop.x + tanX * piece.localX + dirX * piece.localY;
      const worldY = prop.y + tanY * piece.localX + dirY * piece.localY;
      let velX = worldX - explosionSource.x;
      let velY = worldY - explosionSource.y;
      let velLen = Math.hypot(velX, velY);
      if (velLen <= 1e-4){
        velX = dirX;
        velY = dirY;
        velLen = 1;
      }
      velX /= velLen;
      velY /= velLen;
      const angleNoise = (Math.random() * 2 - 1) * 0.36;
      const ca = Math.cos(angleNoise);
      const sa = Math.sin(angleNoise);
      const ux = velX * ca - velY * sa;
      const uy = velX * sa + velY * ca;
      const speed = 0.24 + Math.random() * 0.56;
      const life = 1.0 + Math.random() * 0.55;
      out.push({
        x: worldX,
        y: worldY,
        vx: ux * speed,
        vy: uy * speed,
        a: Math.atan2(uy, ux) + (Math.random() - 0.5) * 0.7,
        w: (Math.random() < 0.5 ? -1 : 1) * piece.spin,
        life,
        maxLife: life,
        ownerType: "rock",
        size: piece.size,
        stretch: piece.stretch,
        dragMul: 1.08,
        alpha: 0.96,
        cr: piece.color[0],
        cg: piece.color[1],
        cb: piece.color[2],
      });
    }
  }
}

/**
 * @param {Debris[]} debris
 * @param {{
 *  gravityAt:(x:number,y:number)=>{x:number,y:number},
 *  dragCoeff:number,
 *  dt:number,
 *  terrainCrossing?:((p1:{x:number,y:number}, p2:{x:number,y:number})=>{x:number,y:number,nx:number,ny:number}|null)|null,
 *  terrainCollisionEnabled?:boolean,
 *  restitution?:number,
 * }} opts
 * @returns {void}
 */
export function updateFragmentDebris(debris, opts){
  if (!debris || !debris.length) return;
  const gravityAt = opts.gravityAt;
  const dragCoeff = Math.max(0, opts.dragCoeff || 0);
  const dt = Math.max(0, opts.dt || 0);
  const terrainCrossing = opts.terrainCrossing || null;
  const terrainCollisionEnabled = !!(opts.terrainCollisionEnabled && terrainCrossing);
  const restitution = Number.isFinite(opts.restitution) ? Math.max(0, Math.min(1, Number(opts.restitution))) : 0.58;
  for (let i = debris.length - 1; i >= 0; i--){
    const d = debris[i];
    if (!d) continue;
    const prevX = d.x;
    const prevY = d.y;
    const g = gravityAt(d.x, d.y);
    const dragMul = Number.isFinite(d.dragMul) ? Math.max(0, Number(d.dragMul)) : 1;
    d.vx += g.x * dt;
    d.vy += g.y * dt;
    d.vx *= Math.max(0, 1 - dragCoeff * dragMul * dt);
    d.vy *= Math.max(0, 1 - dragCoeff * dragMul * dt);
    d.x += d.vx * dt;
    d.y += d.vy * dt;
    if (terrainCollisionEnabled && terrainCrossing){
      const crossing = terrainCrossing({ x: prevX, y: prevY }, { x: d.x, y: d.y });
      if (crossing){
        const nx = crossing.nx;
        const ny = crossing.ny;
        const vNormal = nx * d.vx + ny * d.vy;
        if (vNormal < 0){
          const tangentDamp = 0.92;
          const tx = -ny;
          const ty = nx;
          const vTangent = d.vx * tx + d.vy * ty;
          const nextVNormal = -vNormal * restitution;
          d.vx = tx * (vTangent * tangentDamp) + nx * nextVNormal;
          d.vy = ty * (vTangent * tangentDamp) + ny * nextVNormal;
        }
        d.x = crossing.x + nx * 0.03 + d.vx * Math.min(dt, 0.04) * 0.5;
        d.y = crossing.y + ny * 0.03 + d.vy * Math.min(dt, 0.04) * 0.5;
      }
    }
    d.a += d.w * dt;
    d.life -= dt;
    if (d.life <= 0) debris.splice(i, 1);
  }
}
