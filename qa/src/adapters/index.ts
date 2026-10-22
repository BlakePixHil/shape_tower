// Picks the sim under test. Every suite gets its sim from here, never directly.
//
//   QA_SIM=game       the real simulation in game/ (default once it exists)
//   QA_SIM=reference  the harness's own test-only Rapier sim, for self-tests
//   QA_ENGINE=box2d|rapier  which physics engine the game sim uses (default: the game's own default)
//   QA_GAME_SIM=path  where the game's test API lives (default: game/src/sim/testApi.ts)
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CreateSim, EngineId } from '../contract';
import { wrapGameSim, type GameCreateSim } from './game';
import { createReferenceSim } from './reference/referenceSim';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../../..');

export interface SimUnderTest {
  /** 'game' or 'reference'. */
  kind: 'game' | 'reference';
  engine: EngineId;
  createSim: CreateSim;
  /** Where the sim came from, for reports. */
  source: string;
}

export function gameSimPath(): string {
  return resolve(REPO_ROOT, process.env.QA_GAME_SIM ?? 'game/src/sim/testApi.ts');
}

export async function loadSim(): Promise<SimUnderTest> {
  const wanted = process.env.QA_SIM ?? (existsSync(gameSimPath()) ? 'game' : 'reference');
  if (wanted === 'reference') {
    return { kind: 'reference', engine: 'reference', createSim: createReferenceSim, source: 'qa/src/adapters/reference' };
  }
  if (wanted !== 'game') throw new Error(`QA_SIM must be "game" or "reference", not "${wanted}"`);
  const path = gameSimPath();
  if (!existsSync(path)) throw new Error(`QA_SIM=game but ${path} does not exist yet`);
  const mod = (await import(pathToFileURL(path).href)) as { createSim?: GameCreateSim; useRapier?: () => Promise<void> };
  if (typeof mod.createSim !== 'function') throw new Error(`${path} does not export createSim`);
  const engine = (process.env.QA_ENGINE ?? 'box2d') as EngineId;
  // Rapier's WebAssembly loads on request, so bundles of the test API that never use it stay small.
  if (engine === 'rapier' && typeof mod.useRapier === 'function') await mod.useRapier();
  const create = wrapGameSim(mod.createSim);
  return {
    kind: 'game',
    engine,
    // The game picks its engine from options.engine; suites never pass their own.
    createSim: (o) => create({ ...o, engine }),
    source: path.startsWith(REPO_ROOT) ? path.slice(REPO_ROOT.length + 1) : path,
  };
}

/** True for the full run (QA_FULL=1); the default is the fast set that runs before every push. */
export const FULL = process.env.QA_FULL === '1';

/**
 * Tuning that keeps the game's rules out of a physics or guide test: no checkpoint claims
 * (a claim adds a slab mid-drop), and no run over from hearts or bricks.
 */
export function sandboxTuning(sut: SimUnderTest, extra: Record<string, unknown> = {}): Record<string, unknown> | undefined {
  if (sut.kind !== 'game') return Object.keys(extra).length ? extra : undefined;
  // The canonical towers and guide bases are drawn on an 8-wide plinth, as the reference sim's is;
  // the game's plinth is 12 since 2026-10-22 (gameplay.md §7.3, §16), so the sandbox pins 8.
  return { firstGap: 1000, infiniteHearts: true, infiniteBudget: true, plinthWidth: 8, ...extra };
}

/** Mortar on or off, in the sim's own tuning terms (the reference sim has no Mortar). */
export function mortarTuning(sut: SimUnderTest, on: boolean): Record<string, unknown> {
  return sut.kind === 'game' ? { mortar: on } : {};
}
