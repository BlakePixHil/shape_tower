// Direct access to the game's own modules, for suites that test game rules (bots, power-ups)
// rather than the physics contract the adapter wraps. Null when the sim under test isn't the game.
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gameSimPath, type SimUnderTest } from './adapters/index';

export interface GameApi {
  /** game/src/sim/testApi.ts: createSim, replay, restore and the Sim class. */
  api: Record<string, any>;
  /** game/src/sim/shapes.ts: extents and geometry. */
  shapes: Record<string, any>;
  /** Whether this build has power-ups and Second Wind (gameplay.md §13, from 81540e9). */
  powers: boolean;
  /** Whether this build has gusts (gameplay.md §8.2, §8.3, from game/slice). */
  gusts: boolean;
}

export async function loadGameApi(sut: SimUnderTest): Promise<GameApi | null> {
  if (sut.kind !== 'game') return null;
  const path = gameSimPath();
  const raw = await import(pathToFileURL(path).href);
  // Suites build the game's Sim and replay runs directly, so both follow QA_ENGINE as the adapter
  // does. Without this they quietly ran Box2D under QA_ENGINE=rapier.
  const engine = sut.engine === 'rapier' ? { engine: 'rapier' } : {};
  class Sim extends raw.Sim {
    constructor(o: Record<string, unknown> = {}) {
      super({ ...engine, ...o });
    }
  }
  const api = { ...raw, Sim, replay: (r: Record<string, unknown>) => raw.replay({ ...engine, ...r }) };
  const shapes = await import(pathToFileURL(resolve(dirname(path), 'shapes.ts')).href);
  const probe = new api.Sim({ seed: 1, autoSpawn: false });
  const powers = Array.isArray(probe.slots);
  const gusts = typeof probe.gust === 'object' && probe.gust !== null;
  probe.dispose();
  return { api, shapes, powers, gusts };
}
