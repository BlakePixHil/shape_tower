// Scripted runs for determinism checks (F3.6, D10): the same script on the same seed must give
// the same hash sequence every time, in any process.
import type { Sim } from './contract';
import { rng } from './measure';
import { CORE_SHAPES } from './shapes';

export interface Drop {
  shape: string;
  x: number;
  turns: number;
  hard: boolean;
  /** Steps to wait after touchdown before the next spawn. */
  wait: number;
}

export interface Script {
  seed: number;
  drops: Drop[];
}

/** A random but repeatable script: shapes, positions, turns and drop styles all come from the seed. */
export function makeScript(seed: number, count = 12): Script {
  const r = rng(seed);
  const drops: Drop[] = [];
  for (let i = 0; i < count; i++) {
    drops.push({
      shape: CORE_SHAPES[Math.floor(r() * CORE_SHAPES.length)],
      x: Math.round((r() * 6 - 3) * 2) / 2,
      turns: Math.floor(r() * 4),
      hard: r() < 0.5,
      wait: 20 + Math.floor(r() * 40),
    });
  }
  return { seed, drops };
}

export interface ScriptRun {
  /** State hash every `every` steps, then the final one. */
  hashes: string[];
  steps: number;
  landed: number;
}

/**
 * Plays a script. `stopAt` pauses at that step index and calls `onPause` (used to snapshot or
 * restore mid-run), then carries on.
 */
export function playScript(sim: Sim, script: Script, every = 30, onStep?: (sim: Sim) => void): ScriptRun {
  const hashes: string[] = [];
  let landed = 0;
  const tick = () => {
    sim.step();
    onStep?.(sim);
    if (sim.stepIndex % every === 0) hashes.push(sim.hash());
  };
  for (const d of script.drops) {
    const id = sim.spawnControlled({ shape: d.shape, x: 0, rot: 0 });
    for (let t = 0; t < d.turns; t++) sim.intent({ type: 'rotate', dir: 1 });
    sim.intent({ type: 'moveTo', x: d.x });
    if (d.hard) sim.intent({ type: 'hardDrop' });
    let done = false;
    for (let i = 0; i < 60 * 30 && !done; i++) {
      tick();
      for (const e of sim.drainEvents()) if ((e.type === 'piece_landed' || e.type === 'piece_lost') && e.id === id) done = true;
    }
    if (done) landed++;
    for (let i = 0; i < d.wait; i++) tick();
    sim.drainEvents();
  }
  for (let i = 0; i < 120; i++) tick();
  hashes.push(sim.hash());
  return { hashes, steps: sim.stepIndex, landed };
}

/** Index of the first differing hash, or -1 when the runs match. */
export function firstDivergence(a: string[], b: string[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
}
