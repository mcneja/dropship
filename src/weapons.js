// @ts-check
/** @typedef {import("./game.js").Game} Game */

import * as audioState from "./audio.js";
import * as camera from "./camera.js";
import * as collisionDropship from "./collision_dropship.js";
import { GAME } from "./config.js";
import * as dropship from "./dropship.js";
import * as enemyEffects from "./enemies_effects.js";
import { emitTerrainDestructionFragments } from "./fragment_fx.js";
import * as factories from "./factories.js";
import * as mechanized from "./mechanized.js";
import * as miners from "./miners.js";
import * as stats from "./stats.js";
import * as tether from "./tether.js";

/**
 * @param {Game} game
 * @returns {number}
 */
function playerBombTerrainImpactRange(game){
  if (game.ship.bombStrength >= 2) return 1.8;
  if (game.ship.bombStrength >= 1) return 1.5;
  return game.TERRAIN_NODE_IMPACT_RANGE;
}

/**
 * @param {Game} game
 * @returns {number}
 */
function playerBombTerrainNodeLimit(game){
  if (game.ship.bombStrength >= 2) return 3;
  if (game.ship.bombStrength >= 1) return 2;
  return 1;
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function applyBombImpact(game, x, y){
  const cfg = game.planet ? game.planet.getPlanetConfig() : null;
  if (cfg && cfg.flags && cfg.flags.disableTerrainDestruction){
    if (cfg.id === "molten"){
      game.planet.handleFeatureImpact(x, y, playerBombTerrainImpactRange(game), "bomb", game.featureCallbacks);
    }
    return;
  }
  const result = game.planet.destroyRockRadialNodesInRange(
    x,
    y,
    playerBombTerrainImpactRange(game),
    playerBombTerrainNodeLimit(game)
  );
  if (!result) return;
  emitTerrainDestructionFragments(game, result, x, y);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @returns {void}
 */
function applyBombDamage(game, x, y){
  const r2 = game.PLAYER_BOMB_DAMAGE * game.PLAYER_BOMB_DAMAGE;
  if (game.ship.state !== "crashed"){
    const dx = game.ship.x - x;
    const dy = game.ship.y - y;
    if (dx * dx + dy * dy <= r2){
      dropship.damageShip(game, x, y, "explosion");
    }
  }
  for (let j = game.enemies.enemies.length - 1; j >= 0; j--){
    const e = /** @type {import("./types.d.js").Enemy} */ (game.enemies.enemies[j]);
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy <= r2){
      e.hp = 0;
      game.enemies.markEnemyDestroyedBy(e, "bomb");
    }
  }
  for (let j = game.miners.length - 1; j >= 0; j--){
    const m = /** @type {import("./types.d.js").Miner} */ (game.miners[j]);
    const dx = m.x - x;
    const dy = m.y - y;
    if (dx * dx + dy * dy <= r2){
      miners.killMinerAt(game, j, "exploded", { x, y });
    }
  }
  factories.damageFactoriesAt(game, x, y, game.PLAYER_BOMB_DAMAGE, 999, true);
  tether.destroyTethersAt(game, x, y, game.PLAYER_BOMB_DAMAGE);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {void}
 */
function applyAreaDamage(game, x, y, radius){
  const r2 = radius * radius;
  if (game.ship.state !== "crashed"){
    const dx = game.ship.x - x;
    const dy = game.ship.y - y;
    if (dx * dx + dy * dy <= r2){
      dropship.damageShip(game, x, y, "explosion");
    }
  }
  for (let j = game.enemies.enemies.length - 1; j >= 0; j--){
    const e = /** @type {import("./types.d.js").Enemy} */ (game.enemies.enemies[j]);
    const dx = e.x - x;
    const dy = e.y - y;
    if (dx * dx + dy * dy <= r2){
      e.hp = Math.max(0, e.hp - game.ship.gunPower);
      if (e.hp > 0){
        enemyEffects.applyEnemyHitFeedback(game, e);
      } else {
        game.enemies.markEnemyDestroyedBy(e, "explosion");
      }
    }
  }
  for (let j = game.miners.length - 1; j >= 0; j--){
    const m = /** @type {import("./types.d.js").Miner} */ (game.miners[j]);
    const dx = m.x - x;
    const dy = m.y - y;
    if (dx * dx + dy * dy <= r2){
      miners.killMinerAt(game, j, "exploded", { x, y });
    }
  }
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {{
 *  pieces?:number,
 *  speedMin?:number,
 *  speedMax?:number,
 *  lifeMin?:number,
 *  lifeMax?:number,
 *  offset?:number,
 *  spin?:number,
 *  baseVx?:number,
 *  baseVy?:number,
 *  size?:number,
 *  cr?:number,
 *  cg?:number,
 *  cb?:number,
 *  alpha?:number,
 *  normalX?:number,
 *  normalY?:number,
 * }} [opts]
 * @returns {void}
 */
function spawnDebrisBurst(game, x, y, opts){
  const pieces = (opts && typeof opts.pieces === "number") ? Math.max(1, opts.pieces | 0) : 6;
  const speedMin = (opts && typeof opts.speedMin === "number") ? opts.speedMin : 1.0;
  const speedMax = (opts && typeof opts.speedMax === "number") ? opts.speedMax : 2.0;
  const lifeMin = (opts && typeof opts.lifeMin === "number") ? opts.lifeMin : 0.9;
  const lifeMax = (opts && typeof opts.lifeMax === "number") ? opts.lifeMax : 0.8;
  const offset = (opts && typeof opts.offset === "number") ? opts.offset : 0.08;
  const spin = (opts && typeof opts.spin === "number") ? opts.spin : 6;
  const baseVx = (opts && typeof opts.baseVx === "number") ? opts.baseVx : 0;
  const baseVy = (opts && typeof opts.baseVy === "number") ? opts.baseVy : 0;
  const size = (opts && typeof opts.size === "number") ? opts.size : undefined;
  const cr = (opts && typeof opts.cr === "number") ? opts.cr : undefined;
  const cg = (opts && typeof opts.cg === "number") ? opts.cg : undefined;
  const cb = (opts && typeof opts.cb === "number") ? opts.cb : undefined;
  const alpha = (opts && typeof opts.alpha === "number") ? opts.alpha : undefined;
  const normalX = (opts && typeof opts.normalX === "number") ? opts.normalX : 0;
  const normalY = (opts && typeof opts.normalY === "number") ? opts.normalY : 0;
  const normalLen = Math.hypot(normalX, normalY);
  const useHemisphere = normalLen > 1e-5;
  const nx = useHemisphere ? normalX / normalLen : 0;
  const ny = useHemisphere ? normalY / normalLen : 0;
  let burstBaseVx = baseVx;
  let burstBaseVy = baseVy;
  if (useHemisphere){
    const baseNormal = burstBaseVx * nx + burstBaseVy * ny;
    if (baseNormal < 0){
      burstBaseVx -= 2 * baseNormal * nx;
      burstBaseVy -= 2 * baseNormal * ny;
    }
  }
  for (let i = 0; i < pieces; i++){
    const ang = Math.random() * Math.PI * 2;
    let dirX = Math.cos(ang);
    let dirY = Math.sin(ang);
    if (useHemisphere && dirX * nx + dirY * ny < 0){
      dirX = -dirX;
      dirY = -dirY;
    }
    const sp = speedMin + Math.random() * speedMax;
    const life = lifeMin + Math.random() * lifeMax;
    game.debris.push(/** @type {import("./types.d.js").Debris} */ ({
      x: x + dirX * offset,
      y: y + dirY * offset,
      vx: burstBaseVx + dirX * sp,
      vy: burstBaseVy + dirY * sp,
      a: Math.random() * Math.PI * 2,
      w: (Math.random() - 0.5) * spin,
      life,
      maxLife: life,
      size,
      cr,
      cg,
      cb,
      alpha,
    }));
  }
}

/**
 * @param {Game} game
 * @param {"shot"|"bomb"} kind
 * @param {number} x
 * @param {number} y
 * @param {number} [baseVx]
 * @param {number} [baseVy]
 * @param {{normalX?:number,normalY?:number}|null} [impact]
 * @returns {void}
 */
function spawnWeaponImpactFragments(game, kind, x, y, baseVx = 0, baseVy = 0, impact = null){
  if (kind === "bomb"){
    spawnDebrisBurst(game, x, y, {
      pieces: 12,
      speedMin: 0.95,
      speedMax: 1.95,
      lifeMin: 0.45,
      lifeMax: 0.45,
      offset: 0.12,
      spin: 8,
      baseVx: baseVx * 0.2,
      baseVy: baseVy * 0.2,
      size: 0.12,
      cr: 1.0,
      cg: 0.72,
      cb: 0.2,
      alpha: 0.95,
    });
    return;
  }
  const normalX = impact && typeof impact.normalX === "number" ? impact.normalX : undefined;
  const normalY = impact && typeof impact.normalY === "number" ? impact.normalY : undefined;
  spawnDebrisBurst(game, x, y, /** @type {{
    *  pieces?:number,
    *  speedMin?:number,
    *  speedMax?:number,
    *  lifeMin?:number,
    *  lifeMax?:number,
    *  offset?:number,
    *  spin?:number,
    *  baseVx?:number,
    *  baseVy?:number,
    *  size?:number,
    *  cr?:number,
    *  cg?:number,
    *  cb?:number,
    *  alpha?:number,
    *  normalX?:number,
    *  normalY?:number,
    * }} */ ({
    pieces: 6,
    speedMin: 0.4,
    speedMax: 0.9,
    lifeMin: 0.22,
    lifeMax: 0.22,
    offset: 0.04,
    spin: 6,
    baseVx: baseVx * 0.15,
    baseVy: baseVy * 0.15,
    size: 0.07,
    cr: 0.96,
    cg: 0.96,
    cb: 0.96,
    alpha: 0.92,
    normalX,
    normalY,
  }));
}

/**
 * @param {Game} game
 * @param {"miner"|"pilot"|"engineer"|"health"} kind
 * @param {number} worldX
 * @param {number} worldY
 * @param {number} [toLocalX]
 * @param {number} [toLocalY]
 * @returns {void}
 */
function spawnPickupAnimation(game, kind, worldX, worldY, toLocalX = 0, toLocalY = 0){
  const local = collisionDropship.shipLocalPoint(game, worldX, worldY, game.ship.x, game.ship.y);
  game.pickupAnimations.push({
    x: worldX,
    y: worldY,
    kind,
    t: 0,
    duration: game.PICKUP_ANIMATION_DURATION,
    fromLocalX: local.x,
    fromLocalY: local.y,
    toLocalX,
    toLocalY,
  });
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
function updatePickupAnimations(game, dt){
  if (!game.pickupAnimations.length) return;
  const c1 = 1.70158;
  const c3 = c1 + 1;
  for (let i = game.pickupAnimations.length - 1; i >= 0; i--){
    const anim = /** @type {import("./types.d.js").PickupAnimation} */ (game.pickupAnimations[i]);
    anim.t += dt;
    const raw = Math.max(0, Math.min(1, anim.t / Math.max(0.001, anim.duration || game.PICKUP_ANIMATION_DURATION)));
    const u = raw - 1;
    const eased = 1 + c3 * u * u * u + c1 * u * u;
    const lx = anim.fromLocalX + (anim.toLocalX - anim.fromLocalX) * eased;
    const ly = anim.fromLocalY + (anim.toLocalY - anim.fromLocalY) * eased;
    const world = collisionDropship.shipWorldPoint(game, lx, ly, game.ship.x, game.ship.y);
    anim.x = world.x;
    anim.y = world.y;
    if (raw >= 1){
      game.pickupAnimations.splice(i, 1);
    }
  }
}

/**
 * @param {Game} game
 * @param {number} dt
 * @param {{
 *  shootHeld:boolean,
 *  shootPressed:boolean,
 *  bomb:boolean,
 *  gunOrigin:{x:number,y:number},
 *  aimWorldShoot:{x:number,y:number}|null,
 *  aimWorldBomb:{x:number,y:number}|null,
 *  aimShootFrom:{x:number,y:number}|null|undefined,
 *  aimShootTo:{x:number,y:number}|null|undefined,
 *  aimBombFrom:{x:number,y:number}|null|undefined,
 *  aimBombTo:{x:number,y:number}|null|undefined,
 * }} fireState
 * @returns {void}
 */
function updateCombat(game, dt, fireState){
  const {
    shootHeld,
    shootPressed,
    bomb,
    gunOrigin,
    aimWorldShoot,
    aimWorldBomb,
    aimShootFrom,
    aimShootTo,
    aimBombFrom,
    aimBombTo,
  } = fireState;

  if (game.ship.state !== "crashed" && !dropship.isDockedWithMothership(game)){
    const muzzleOffset = dropship.getDropshipGunTipForwardOffset(GAME);
    const wantsShoot = !!(shootPressed || shootHeld);
    if (wantsShoot && game.playerShotCooldown <= 0){
      let dirx = 0;
      let diry = 0;
      if (aimShootFrom && aimShootTo){
        const wFrom = camera.toWorldFromAim(game, aimShootFrom);
        const wTo = camera.toWorldFromAim(game, aimShootTo);
        if (wFrom && wTo){
          const dx = wTo.x - wFrom.x;
          const dy = wTo.y - wFrom.y;
          const dist = Math.hypot(dx, dy) || 1;
          dirx = dx / dist;
          diry = dy / dist;
        }
      } else if (aimWorldShoot){
        const dx = aimWorldShoot.x - gunOrigin.x;
        const dy = aimWorldShoot.y - gunOrigin.y;
        const dist = Math.hypot(dx, dy) || 1;
        dirx = dx / dist;
        diry = dy / dist;
      }
      if (dirx || diry){
        const { vx, vy } = dropship.muzzleVelocity(dirx, diry, game.ship.vx, game.ship.vy, game.PLAYER_SHOT_SPEED);
        game.playerShots.push({
          x: gunOrigin.x + dirx * muzzleOffset,
          y: gunOrigin.y + diry * muzzleOffset,
          vx,
          vy,
          life: game.PLAYER_SHOT_LIFE,
        });
        stats.recordShotsFired(game, 1);
        game.playerShotCooldown = game.PLAYER_SHOT_INTERVAL;
        audioState.playSfx(game, "ship_laser", { volume: 0.1 });
      }
    }
    if (bomb && game.ship.bombsCur > 0){
      let dirx = 0;
      let diry = 0;
      if (aimBombFrom && aimBombTo){
        const wFrom = camera.toWorldFromAim(game, aimBombFrom);
        const wTo = camera.toWorldFromAim(game, aimBombTo);
        if (wFrom && wTo){
          const dx = wTo.x - wFrom.x;
          const dy = wTo.y - wFrom.y;
          const dist = Math.hypot(dx, dy) || 1;
          dirx = dx / dist;
          diry = dy / dist;
        }
      } else if (aimWorldBomb){
        const dx = aimWorldBomb.x - gunOrigin.x;
        const dy = aimWorldBomb.y - gunOrigin.y;
        const dist = Math.hypot(dx, dy) || 1;
        dirx = dx / dist;
        diry = dy / dist;
      }
      if (dirx || diry){
        const { vx, vy } = dropship.muzzleVelocity(dirx, diry, game.ship.vx, game.ship.vy, game.PLAYER_BOMB_SPEED);
        --game.ship.bombsCur;
        game.playerBombs.push({
          x: gunOrigin.x + dirx * muzzleOffset,
          y: gunOrigin.y + diry * muzzleOffset,
          vx,
          vy,
          life: game.PLAYER_BOMB_LIFE,
        });
        stats.recordBombsFired(game, 1);
        audioState.playSfx(game, "bomb_launch", {
          volume: 0.55,
          rate: 0.96 + Math.random() * 0.08,
        });
      }
    }
  }

  const mechanizedLevel = !!(game.planet && game.planet.getPlanetConfig && game.planet.getPlanetConfig().id === "mechanized");
  /** @type {Array<any>|null} */
  let mechShotBlockers = null;
  /** @type {Array<any>|null} */
  let mechBombBlockers = null;
  /** @type {Array<any>|null} */
  let mechFactories = null;
  if (mechanizedLevel && game.planet && game.planet.props && game.planet.props.length){
    mechShotBlockers = [];
    mechBombBlockers = [];
    mechFactories = [];
    for (const p of game.planet.props){
      if (!p) continue;
      if (p.type === "factory"){
        mechFactories.push(p);
        mechBombBlockers.push(p);
      } else if (p.type === "gate" || p.type === "tether"){
        mechShotBlockers.push(p);
        mechBombBlockers.push(p);
      }
    }
  }

  for (let i = game.playerShots.length - 1; i >= 0; i--){
    const s = /** @type {import("./types.d.js").Shot} */ (game.playerShots[i]);
    const prevX = s.x;
    const prevY = s.y;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.life <= 0){
      game.playerShots.splice(i, 1);
      continue;
    }
    if (game.planet.handleFeatureShot(s.x, s.y, game.PLAYER_SHOT_RADIUS, game.featureCallbacks)){
      spawnWeaponImpactFragments(game, "shot", s.x, s.y, s.vx, s.vy);
      game.playerShots.splice(i, 1);
      continue;
    }
    if (game.collision.airValueAtWorld(s.x, s.y) <= 0.5){
      const crossing = game.planet.terrainCrossing(
        { x: prevX, y: prevY },
        { x: s.x, y: s.y }
      );
      if (game.ship.bounceShots){
        if (crossing){
          const { nx, ny } = crossing;
          const vNormal = nx * s.vx + ny * s.vy;
          if (vNormal < 0){
            s.x = prevX;
            s.y = prevY;
            s.vx -= 2 * vNormal * nx;
            s.vy -= 2 * vNormal * ny;
            continue;
          }
        }
      }
      const impactX = crossing ? crossing.x + crossing.nx * 0.02 : s.x;
      const impactY = crossing ? crossing.y + crossing.ny * 0.02 : s.y;
      spawnWeaponImpactFragments(
        game,
        "shot",
        impactX,
        impactY,
        s.vx,
        s.vy,
        crossing ? { normalX: crossing.nx, normalY: crossing.ny } : null
      );
      game.playerShots.splice(i, 1);
      continue;
    }
    if (mechanizedLevel){
      let blocked = false;
      if (mechShotBlockers){
        for (const p of mechShotBlockers){
          if (p.dead) continue;
          if (mechanized.solidPropPenetration(game, p, s.x, s.y, game.PLAYER_SHOT_RADIUS * 0.5)){
            blocked = true;
            break;
          }
        }
      }
      if (blocked){
        spawnWeaponImpactFragments(game, "shot", s.x, s.y, s.vx, s.vy);
        game.playerShots.splice(i, 1);
        continue;
      }
      if (factories.damageFactoryPropsAt(game, mechFactories, s.x, s.y, game.PLAYER_SHOT_RADIUS, 1, false)){
        spawnWeaponImpactFragments(game, "shot", s.x, s.y, s.vx, s.vy);
        game.playerShots.splice(i, 1);
        continue;
      }
    }
    for (let j = game.enemies.enemies.length - 1; j >= 0; j--){
      const e = /** @type {import("./types.d.js").Enemy} */ (game.enemies.enemies[j]);
      if (e.hp <= 0) continue;
      const dx = e.x - s.x;
      const dy = e.y - s.y;
      if (dx * dx + dy * dy <= game.PLAYER_SHOT_RADIUS * game.PLAYER_SHOT_RADIUS){
        e.hp -= game.ship.gunPower;
        if (e.hp > 0){
          enemyEffects.applyEnemyHitFeedback(game, e);
        }
        spawnWeaponImpactFragments(game, "shot", s.x, s.y, s.vx, s.vy);
        game.playerShots.splice(i, 1);
        if (e.hp <= 0){
          e.hp = 0;
          game.enemies.markEnemyDestroyedBy(e, "bullet");
        }
        break;
      }
    }
    if (i >= game.playerShots.length) continue;
    for (let j = game.miners.length - 1; j >= 0; j--){
      const m = /** @type {import("./types.d.js").Miner} */ (game.miners[j]);
      const dx = m.x - s.x;
      const dy = m.y - s.y;
      if (dx * dx + dy * dy <= game.PLAYER_SHOT_RADIUS * game.PLAYER_SHOT_RADIUS){
        spawnWeaponImpactFragments(game, "shot", s.x, s.y, s.vx, s.vy);
        miners.killMinerAt(game, j, "shot", { x: s.x, y: s.y, vx: s.vx, vy: s.vy });
        game.playerShots.splice(i, 1);
        break;
      }
    }
  }

  if (game.playerBombs.length){
    for (let i = game.playerBombs.length - 1; i >= 0; i--){
      const b = /** @type {{x:number,y:number,vx:number,vy:number,life:number}} */ (game.playerBombs[i]);
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      let hit = false;
      if (b.life <= 0){
        hit = true;
      } else {
        const sample = game.collision.sampleAtWorld(b.x, b.y);
        if (sample.air <= 0.5){
          hit = true;
        }
      }
      if (!hit && mechanizedLevel && mechBombBlockers){
        for (const p of mechBombBlockers){
          if (p.dead) continue;
          if (mechanized.solidPropPenetration(game, p, b.x, b.y, game.PLAYER_BOMB_RADIUS * 0.8)){
            hit = true;
            break;
          }
        }
      }
      if (!hit && game.planet.handleFeatureBombContact(b.x, b.y, game.PLAYER_BOMB_RADIUS)){
        hit = true;
      }
      if (!hit){
        for (let j = game.enemies.enemies.length - 1; j >= 0; j--){
          const e = /** @type {import("./types.d.js").Enemy} */ (game.enemies.enemies[j]);
          const dx = e.x - b.x;
          const dy = e.y - b.y;
          if (dx * dx + dy * dy <= game.PLAYER_BOMB_RADIUS * game.PLAYER_BOMB_RADIUS){
            e.hp = 0;
            game.enemies.markEnemyDestroyedBy(e, "bomb");
            hit = true;
            break;
          }
        }
        if (!hit){
          for (let j = game.miners.length - 1; j >= 0; j--){
            const m = /** @type {import("./types.d.js").Miner} */ (game.miners[j]);
            const dx = m.x - b.x;
            const dy = m.y - b.y;
            if (dx * dx + dy * dy <= game.PLAYER_BOMB_RADIUS * game.PLAYER_BOMB_RADIUS){
              miners.killMinerAt(game, j, "exploded", { x: b.x, y: b.y, vx: b.vx, vy: b.vy });
              hit = true;
              break;
            }
          }
        }
      }
      if (hit){
        game.playerBombs.splice(i, 1);
        spawnWeaponImpactFragments(game, "bomb", b.x, b.y, b.vx, b.vy);
        applyBombImpact(game, b.x, b.y);
        game.planet.handleFeatureBomb(b.x, b.y, game.TERRAIN_IMPACT_RADIUS, game.PLAYER_BOMB_RADIUS, game.featureCallbacks);
        applyBombDamage(game, b.x, b.y);
        game.entityExplosions.push({ x: b.x, y: b.y, life: 0.8, radius: game.PLAYER_BOMB_BLAST });
        audioState.playSfx(game, "bomb_explosion", {
          volume: 0.9,
          rate: 0.95 + Math.random() * 0.1,
        });
      }
    }
  }

  if (game.entityExplosions.length){
    for (let i = game.entityExplosions.length - 1; i >= 0; i--){
      const explosion = /** @type {import("./types.d.js").Explosion} */ (game.entityExplosions[i]);
      explosion.life -= dt;
      if (explosion.life <= 0) game.entityExplosions.splice(i, 1);
    }
  }

  for (let i = game.healthPickups.length - 1; i >= 0; i--){
    const pickup = /** @type {import("./types.d.js").HealthPickup} */ (game.healthPickups[i]);
    if (Math.hypot(pickup.x - game.ship.x, pickup.y - game.ship.y) < GAME.SHIP_SCALE){
      const prevHp = game.ship.hpCur;
      game.ship.hpCur = Math.min(game.ship.hpMax, game.ship.hpCur + 1);
      spawnPickupAnimation(game, "health", pickup.x, pickup.y, 0, 0);
      if (game.ship.hpCur > prevHp){
        const r = Math.hypot(pickup.x, pickup.y) || 1;
        const upx = pickup.x / r;
        const upy = pickup.y / r;
        const tx = -upy;
        const ty = upx;
        const jitter = (Math.random() * 2 - 1) * GAME.MINER_POPUP_TANGENTIAL;
        game.popups.push({
          x: pickup.x + upx * 0.1,
          y: pickup.y + upy * 0.1,
          vx: upx * GAME.MINER_POPUP_SPEED + tx * jitter,
          vy: upy * GAME.MINER_POPUP_SPEED + ty * jitter,
          text: "+1 hull",
          life: GAME.MINER_POPUP_LIFE,
        });
        audioState.playSfx(game, "miner_rescued", {
          volume: 0.45,
          rate: 0.95 + Math.random() * 0.1,
        });
      }
      game.healthPickups.splice(i, 1);
    } else {
      pickup.life -= dt;
      if (pickup.life <= 0) game.healthPickups.splice(i, 1);
    }
  }

  updatePickupAnimations(game, dt);
}

/**
 * @param {Game} game
 * @param {number} dt
 * @param {{
 *  shootHeld:boolean,
 *  shootPressed:boolean,
 *  bomb:boolean,
 *  gunOrigin:{x:number,y:number},
 *  aimWorldShoot:{x:number,y:number}|null,
 *  aimWorldBomb:{x:number,y:number}|null,
 *  aimShootFrom:{x:number,y:number}|null|undefined,
 *  aimShootTo:{x:number,y:number}|null|undefined,
 *  aimBombFrom:{x:number,y:number}|null|undefined,
 *  aimBombTo:{x:number,y:number}|null|undefined,
 * }} fireState
 * @returns {void}
 */
export function update(game, dt, fireState){
  game.playerShotCooldown = Math.max(0, game.playerShotCooldown - dt);
  updateCombat(game, dt, fireState);
}

export {
  applyAreaDamage,
  applyBombDamage,
  applyBombImpact,
  playerBombTerrainImpactRange,
  playerBombTerrainNodeLimit,
  spawnDebrisBurst,
  spawnPickupAnimation,
  spawnWeaponImpactFragments,
  updatePickupAnimations,
};


