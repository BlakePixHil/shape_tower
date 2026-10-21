// The silent phone benchmark (qa-section.md §10.1 item 9): S1's tower with Mortar on, first 60 and
// then about 150 awake bodies, 2.5 s of steps each. Pure TS so it runs in a worker or in Node.

import { DT, Sim } from './sim.ts';

export interface BenchPhase { bodies: number; awake: number; steps: number; mean: number; p50: number; p95: number; max: number; times: number[] }
export interface BenchResult { engine: string; phases: BenchPhase[]; totalMs: number }

const ROW = [-3, -1, 1, 3];

export function runBench(now: () => number = () => performance.now()): BenchResult {
  const t0 = now();
  // A light crosswind keeps every loose body awake; the line is out of reach so nothing turns to stone.
  const sim = new Sim({ seed: 1, autoSpawn: false, tuning: { mortar: true, wind: 0.03, firstGap: 1000, gapCap: 1000, infiniteBudget: true, infiniteHearts: true } });
  const phases: BenchPhase[] = [];
  let rows = 0;
  const addRows = (n: number) => {
    for (let r = 0; r < n; r++, rows++) for (const x of ROW) sim.placePiece({ shape: 'O', x, y: 1 + 2 * rows + 0.001 * rows });
  };
  const measure = (steps: number) => {
    const times: number[] = [];
    for (let i = 0; i < steps; i++) {
      const a = now();
      sim.step();
      times.push(now() - a);
    }
    const sorted = [...times].sort((x, y) => x - y);
    const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    phases.push({
      bodies: sim.pieceViews().length, awake: sim.pieceViews().filter(v => sim.engine.isAwake(v.id)).length, steps,
      mean: round(times.reduce((s, x) => s + x, 0) / steps), p50: round(pick(0.5)), p95: round(pick(0.95)), max: round(sorted[sorted.length - 1]),
      times: times.map(round),
    });
  };
  const steps = Math.round(2.5 / DT);
  addRows(15);   // 60 bodies
  measure(steps);
  addRows(23);   // 152 bodies
  measure(steps);
  sim.dispose();
  return { engine: 'box2d', phases, totalMs: round(now() - t0) };
}

const round = (x: number) => Math.round(x * 1000) / 1000;
