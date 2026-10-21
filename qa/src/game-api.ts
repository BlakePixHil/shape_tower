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
  const api = await import(pathToFileURL(path).href);
  const shapes = await import(pathToFileURL(resolve(dirname(path), 'shapes.ts')).href);
  const probe = new api.Sim({ seed: 1, autoSpawn: false });
  const powers = Array.isArray(probe.slots);
  const gusts = typeof probe.gust === 'object' && probe.gust !== null;
  probe.dispose();
  return { api, shapes, powers, gusts };
}
