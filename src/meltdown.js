// @ts-check
/** @typedef {import("./game.js").Game} Game */

import * as levels from "./levels.js";
import * as tether from "./tether.js";
import * as audioState from "./audio.js";
import * as feedback from "./feedback.js";
import * as dropship from "./dropship.js";

/**
 * @param {Game} game
 * @returns {boolean}
 */
export function heatMechanicsActive(game){
  const cfg = game.planet && game.planet.getPlanetConfig ? game.planet.getPlanetConfig() : null;
  if (!cfg) return false;
  if (cfg.id === "molten") return true;
  return levels.isMechanizedCoreLevel(game);
}

/**
 * @param {Game} game
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {void}
 */
export function applyMeltdownAirEdit(game, x, y, radius){
  if (!game.planet || !game.renderer) return;
  const newAir = game.planet.applyAirEdit(x, y, radius, 1);
  if (newAir) game.renderer.updateAir(newAir);
}

/**
 * @param {Game} game
 * @returns {void}
 */
export function startCoreMeltdown(game){
  if (game.coreMeltdownActive) return;
  game.coreMeltdownActive = true;
  game.coreMeltdownT = 0;
  game.coreMeltdownEruptT = 0;
  tether.syncTetherProtectionStates(game);
  const coreR = game.planet && game.planet.getCoreRadius ? game.planet.getCoreRadius() : 0;
  game.entityExplosions.push({ x: 0, y: 0, life: 1.2, radius: Math.max(1.5, coreR * 0.6) });
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function updateCoreMeltdown(game, dt){
  if (!game.coreMeltdownActive) return;
  const coreR = game.planet && game.planet.getCoreRadius ? game.planet.getCoreRadius() : 0;
  if (coreR <= 0) return;
  game.coreMeltdownT += dt;
  const progress = Math.max(0, Math.min(1, game.coreMeltdownT / Math.max(0.001, game.coreMeltdownDuration)));
  if (!dropship.isDockedWithMothership(game)){
    feedback.queueRumble(game, 0.18 + progress * 0.18, 0.42 + progress * 0.34, 150);
  }
  const featureParticles = game.planet && game.planet.getFeatureParticles ? game.planet.getFeatureParticles() : null;
  const lava = featureParticles && featureParticles.lava ? featureParticles.lava : null;
  if (lava){
    const rate = 10 + 24 * progress;
    const emitBase = rate * dt;
    const emitWhole = Math.floor(emitBase);
    const emitCount = emitWhole + (Math.random() < (emitBase - emitWhole) ? 1 : 0);
    for (let i = 0; i < emitCount; i++){
      const ang = Math.random() * Math.PI * 2;
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      const tx = -ny;
      const ty = nx;
      const spread = (Math.random() * 2 - 1) * (0.22 + progress * 0.28);
      const speed = 2.2 + progress * 3.8 + Math.random() * 1.2;
      lava.push({
        x: nx * (coreR + 0.15),
        y: ny * (coreR + 0.15),
        vx: (nx + tx * spread) * speed,
        vy: (ny + ty * spread) * speed,
        life: 1.0 + Math.random() * 0.8,
      });
    }
  }
  game.coreMeltdownEruptT -= dt;
  if (game.coreMeltdownEruptT <= 0){
    game.coreMeltdownEruptT = Math.max(0.18, 0.95 - progress * 0.7);
    const maxReach = coreR + 1 + progress * Math.max(1.2, game.planetParams.RMAX - coreR - 0.8);
    const burstCount = 1 + ((Math.random() < (0.5 + progress * 0.35)) ? 1 : 0);
    for (let b = 0; b < burstCount; b++){
      const ang = Math.random() * Math.PI * 2;
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      const reach = coreR + 0.65 + Math.random() * Math.max(0.25, maxReach - coreR - 0.65);
      const segments = 2 + Math.floor(progress * 5);
      for (let s = 0; s < segments; s++){
        const t = segments <= 1 ? 1 : (s / (segments - 1));
        const r = coreR + 0.55 + (reach - coreR - 0.55) * t;
        const x = nx * r;
        const y = ny * r;
        const carveR = 0.45 + progress * 1.0 + Math.random() * 0.25;
        applyMeltdownAirEdit(game, x, y, carveR);
        game.entityExplosions.push({ x, y, life: 0.45 + progress * 0.4, radius: carveR * 0.85 });
      }
    }
  }
  if (game.coreMeltdownT >= game.coreMeltdownDuration && !dropship.isDockedWithMothership(game) && game.ship.state !== "crashed"){
    dropship.triggerCrash(game);
  }
}

/**
 * @param {Game} game
 * @param {number} dt
 * @returns {void}
 */
export function update(game, dt){
  if (!game.coreMeltdownActive && game.objective && game.objective.type === "destroy_core" && tether.tetherPropsAlive(game).length <= 0){
    startCoreMeltdown(game);
  }
  updateCoreMeltdown(game, dt);
  if (game.ship.state !== "crashed" && heatMechanicsActive(game) && (game.ship.heat || 0) >= 100){
    dropship.triggerCrash(game);
  }
}


