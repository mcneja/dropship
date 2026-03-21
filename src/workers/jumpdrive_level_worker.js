// @ts-check

import { MapGen } from "../mapgen.js";

/** @type {{onmessage:((event:MessageEvent)=>void)|null, postMessage:(message:any, transfer?:Transferable[])=>void}} */
const workerScope = /** @type {any} */ (self);

workerScope.onmessage = (event) => {
  const data = event && event.data ? event.data : null;
  const requestId = data && Number.isFinite(data.requestId) ? (data.requestId | 0) : 0;
  try {
    const seed = data && Number.isFinite(data.seed) ? +data.seed : 0;
    const planetParams = data ? data.planetParams : null;
    const mapgen = new MapGen(seed, planetParams);
    const world = mapgen.getWorld();
    workerScope.postMessage({
      requestId,
      ok: true,
      mapWorld: {
        seed: world.seed,
        air: world.air,
        entrances: world.entrances,
        finalAir: world.finalAir,
      },
    }, [world.air.buffer]);
  } catch (err) {
    workerScope.postMessage({
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
