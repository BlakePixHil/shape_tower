// Runs the silent benchmark off the main thread and posts the result back once: Box2D first, then
// Rapier for the engine bake-off (gameplay.md §15). Rapier comes from a CDN here so its 3.4 MB stay
// out of the game page; if it can't load or run, the Box2D result still goes back with the reason.

import { RapierEngine, initRapier } from './sim/engine/rapier.ts';
import { runBench } from './sim/bench.ts';
import { registerEngine } from './sim/sim.ts';

const RAPIER_URL = 'https://cdn.jsdelivr.net/npm/@dimforge/rapier2d-deterministic-compat@0.21.0/dist/rapier.mjs';

const scope = self as unknown as { postMessage(msg: unknown): void };

async function main(): Promise<void> {
  let result;
  try {
    result = runBench();
  } catch (e) {
    scope.postMessage({ ok: false, error: String(e) });
    return;
  }
  let rapier = null, rapierError = null;
  try {
    await initRapier(() => import(/* @vite-ignore */ RAPIER_URL));
    registerEngine('rapier', s => new RapierEngine(s));
    rapier = runBench(undefined, 'rapier');
  } catch (e) {
    rapierError = String(e);
  }
  scope.postMessage({ ok: true, result, rapier, rapierError });
}

void main();
