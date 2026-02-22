// @ts-check

import { GAME } from "./config.js";

/**
 * @typedef {Object} Ship
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {string} state
 * @property {number} explodeT
 * @property {number} lastAir
 * @property {Array<[number,number,boolean,number]>|null} [_samples]
 * @property {{x:number,y:number,tri?:Array<{x:number,y:number}>|null,node?:{x:number,y:number}|null}|null} [_collision]
 * @property {number} [_shipRadius]
 */

/**
 * @param {Object} deps
 * @param {typeof import("./config.js").CFG} deps.cfg
 * @param {{ airBinaryAtWorld:(x:number,y:number)=>0|1, getWorld:()=>{finalAir:number,seed:number}, regenWorld:(seed:number)=>{finalAir:number,seed:number}, noise: any, grid:{cell:number} }} deps.mapgen
 * @param {{ updateAirFlags:()=>Float32Array, airValueAtWorld:(x:number,y:number)=>number, findTriAtWorld:(x:number,y:number)=>Array<{x:number,y:number}>|null, nearestNodeOnRing:(x:number,y:number)=>{x:number,y:number}|null, vertCount:number }} deps.mesh
 * @param {{ updateAir:(airFlag:Float32Array)=>void, drawFrame:(state:any, mesh:any)=>void }} deps.renderer
 * @param {{ update:()=>{left:boolean,right:boolean,thrust:boolean,down:boolean,reset:boolean,regen:boolean,toggleDebug:boolean} }} deps.input
 * @param {{ updateHud:(hud:HTMLElement, stats:{fps:number,state:string,speed:number,verts:number,air:number})=>void }} deps.ui
 * @param {HTMLCanvasElement} deps.canvas
 * @param {HTMLElement} deps.hud
 */
export function createGameLoop({ cfg, mapgen, mesh, renderer, input, ui, canvas, hud }){
  /** @type {Ship} */
  const ship = {
    x: 0,
    y: cfg.RMAX + 0.9,
    vx: 0,
    vy: 0,
    state: "flying",
    explodeT: 0,
    lastAir: 1,
  };
  const debris = [];

  function resetShip(){
    ship.x = 0;
    ship.y = cfg.RMAX + 0.9;
    ship.vx = 0;
    ship.vy = 0;
    ship.state = "flying";
    ship.explodeT = 0;
    debris.length = 0;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} shipRadius
   */
  function shipCollidesAt(x, y, shipRadius){
    const rCenter = Math.hypot(x, y);
    if (rCenter - shipRadius > cfg.RMAX) return false;
    for (let i = 0; i < 6; i++){
      const a = (i / 6) * Math.PI * 2;
      const sx = x + Math.cos(a) * shipRadius;
      const sy = y + Math.sin(a) * shipRadius;
      const av = mesh.airValueAtWorld(sx, sy);
      if (av <= 0.5) return true;
    }
    return false;
  }

  function step(dt, inputState){
    const { left, right, thrust, down, reset } = inputState;
    if (reset) resetShip();

    if (ship.state === "flying"){
      let ax = 0, ay = 0;
      const r = Math.hypot(ship.x, ship.y) || 1;
      const rx = ship.x / r;
      const ry = ship.y / r;
      const tx = -ry;
      const ty = rx;

      if (left){
        ax += tx * GAME.THRUST;
        ay += ty * GAME.THRUST;
      }
      if (right){
        ax -= tx * GAME.THRUST;
        ay -= ty * GAME.THRUST;
      }
      if (thrust){
        ax += rx * GAME.THRUST;
        ay += ry * GAME.THRUST;
      }
      if (down){
        ax += -rx * GAME.THRUST;
        ay += -ry * GAME.THRUST;
      }

      ax += -ship.x / r * GAME.GRAVITY;
      ay += -ship.y / r * GAME.GRAVITY;

      ship.vx += ax * dt;
      ship.vy += ay * dt;

      const drag = Math.max(0, 1 - GAME.DRAG * dt);
      ship.vx *= drag;
      ship.vy *= drag;

      ship.x += ship.vx * dt;
      ship.y += ship.vy * dt;

      const speed = Math.hypot(ship.vx, ship.vy);
      const eps = mapgen.grid.cell * 0.75;
      const shipHWorld = 0.7;
      const shipRadius = shipHWorld * 0.28;

      let collides = false;
      const samples = [];
      let hit = null;
      const rCenter = Math.hypot(ship.x, ship.y);
      if (rCenter - shipRadius <= cfg.RMAX){
        for (let i = 0; i < 6; i++){
          const a = (i / 6) * Math.PI * 2;
          const sx = ship.x + Math.cos(a) * shipRadius;
          const sy = ship.y + Math.sin(a) * shipRadius;
          const av = mesh.airValueAtWorld(sx, sy);
          const air = av > 0.5;
          samples.push([sx, sy, air, av]);
          if (!air) {
            collides = true;
            if (!hit) hit = { x: sx, y: sy };
          }
        }
      }
      ship._samples = samples;
      ship._shipRadius = shipRadius;
      if (hit){
        ship._collision = {
          x: hit.x,
          y: hit.y,
          tri: mesh.findTriAtWorld(hit.x, hit.y),
          node: mesh.nearestNodeOnRing(hit.x, hit.y),
        };
      } else {
        ship._collision = null;
      }

      if (collides){
        const gdx = mesh.airValueAtWorld(ship.x + eps, ship.y) - mesh.airValueAtWorld(ship.x - eps, ship.y);
        const gdy = mesh.airValueAtWorld(ship.x, ship.y + eps) - mesh.airValueAtWorld(ship.x, ship.y - eps);
        let nx = gdx;
        let ny = gdy;
        let nlen = Math.hypot(nx, ny);
        if (nlen < 1e-4){
          const c = ship._collision;
          if (c){
            nx = ship.x - c.x;
            ny = ship.y - c.y;
            nlen = Math.hypot(nx, ny);
          }
        }
        if (nlen < 1e-4){
          nx = ship.x;
          ny = ship.y;
          nlen = Math.hypot(nx, ny) || 1;
        }
        nx /= nlen;
        ny /= nlen;
        const camRot = Math.atan2(ship.x, ship.y || 1e-6);
        const upx = Math.sin(camRot);
        const upy = Math.cos(camRot);
        const dotUp = nx * upx + ny * upy;
        const vn = ship.vx * nx + ship.vy * ny;
        const impactSpeed = Math.max(0, -vn);
        const resolvePenetration = () => {
          const maxSteps = 8;
          const stepSize = shipRadius * 0.2;
          for (let i = 0; i < maxSteps; i++){
            if (!shipCollidesAt(ship.x, ship.y, shipRadius)) break;
            ship.x += nx * stepSize;
            ship.y += ny * stepSize;
          }
        };

        if (impactSpeed <= GAME.LAND_SPEED && vn < -0.05 && dotUp >= GAME.SURFACE_DOT){
          ship.state = "landed";
          ship.vx = 0; ship.vy = 0;
          resolvePenetration();
        } else if (impactSpeed >= GAME.CRASH_SPEED){
          ship.state = "crashed";
          ship.explodeT = 0;
          ship.vx = 0; ship.vy = 0;
          debris.length = 0;
          const pieces = 10;
          for (let i = 0; i < pieces; i++){
            const ang = Math.random() * Math.PI * 2;
            const sp = 1.5 + Math.random() * 2.5;
            debris.push({
              x: ship.x + Math.cos(ang) * 0.1,
              y: ship.y + Math.sin(ang) * 0.1,
              vx: ship.vx + Math.cos(ang) * sp,
              vy: ship.vy + Math.sin(ang) * sp,
              a: Math.random() * Math.PI * 2,
              w: (Math.random() - 0.5) * 4,
              life: 2.5 + Math.random() * 1.5,
            });
          }
        } else {
          if (impactSpeed <= GAME.LAND_SPEED && vn < -0.05 && dotUp >= GAME.SURFACE_DOT){
            ship.vx -= nx * GAME.LAND_PULL * dt;
            ship.vy -= ny * GAME.LAND_PULL * dt;
            const tx = -ny;
            const ty = nx;
            const vt = ship.vx * tx + ship.vy * ty;
            ship.vx -= vt * tx * GAME.LAND_FRICTION * dt;
            ship.vy -= vt * ty * GAME.LAND_FRICTION * dt;
            resolvePenetration();
          } else if (vn < 0){
            const restitution = GAME.BOUNCE_RESTITUTION;
            ship.vx -= (1 + restitution) * vn * nx;
            ship.vy -= (1 + restitution) * vn * ny;
            const fast = speed >= (GAME.LAND_SPEED * 1.2);
            const push = shipRadius * (fast ? GAME.COLLIDE_PUSH_FAST : 0.02);
            ship.x += nx * push;
            ship.y += ny * push;
            resolvePenetration();
          }
        }
      }
    }

    if (debris.length){
      for (let i = debris.length - 1; i >= 0; i--){
        const d = debris[i];
        const r = Math.hypot(d.x, d.y) || 1;
        d.vx += (-d.x / r) * GAME.GRAVITY * dt;
        d.vy += (-d.y / r) * GAME.GRAVITY * dt;
        d.vx *= Math.max(0, 1 - GAME.DRAG * dt);
        d.vy *= Math.max(0, 1 - GAME.DRAG * dt);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        d.a += d.w * dt;
        d.life -= dt;
        if (d.life <= 0) debris.splice(i, 1);
      }
    }

    if (ship.state === "landed"){
      if (left || right || thrust){
        ship.state = "flying";
      }
    }
  }

  let lastTime = performance.now();
  let accumulator = 0;
  let fpsTime = lastTime;
  let fpsFrames = 0;
  let fps = 0;
  let debugCollisions = GAME.DEBUG_COLLISION;

  function frame(){
    const now = performance.now();
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    accumulator += dt;

    const inputState = input.update();

    if (ship.state === "crashed"){
      ship.explodeT = Math.min(1.2, ship.explodeT + dt * 0.9);
    }

    if (inputState.regen){
      const nextSeed = mapgen.getWorld().seed + 1;
      mapgen.regenWorld(nextSeed);
      resetShip();
      const newAir = mesh.updateAirFlags();
      renderer.updateAir(newAir);
    }

    if (inputState.toggleDebug){
      debugCollisions = !debugCollisions;
    }

    const fixed = 1 / 60;
    const maxSteps = 4;
    let steps = 0;
    while (accumulator >= fixed && steps < maxSteps){
      step(fixed, inputState);
      accumulator -= fixed;
      steps++;
    }

    fpsFrames++;
    if (now - fpsTime >= 500){
      fps = Math.round((fpsFrames * 1000) / (now - fpsTime));
      fpsFrames = 0;
      fpsTime = now;
    }

    renderer.drawFrame({
      ship,
      debris,
      input: inputState,
      debugCollisions,
      debugNodes: GAME.DEBUG_NODES,
      fps,
      finalAir: mapgen.getWorld().finalAir,
    }, mesh);

    ui.updateHud(hud, {
      fps,
      state: ship.state,
      speed: Math.hypot(ship.vx, ship.vy),
      verts: mesh.vertCount,
      air: mapgen.getWorld().finalAir,
    });

    requestAnimationFrame(frame);
  }

  function start(){
    requestAnimationFrame(frame);
  }

  return { start, ship, debris };
}
