// Blockling Pop's balance sweep (Pop plan §16): runs the greedy bot (and the greedy bot with powers)
// over many seeds under the current tuning, or under overrides given as JSON, and prints the medians
// QA's balance targets are set against. Not part of the gate; QA and the Pop thread run it by hand.
// Run: node --experimental-strip-types tests/pop-tune.ts [runs] ['{"nudgeStart":0.15}']

import { greedyMove, playIntents, playOut, smartIntent } from '../src/pop/sim/bot.ts';
import { PopSim } from '../src/pop/sim/pop.ts';
import type { PopTuning } from '../src/pop/sim/tuning.ts';

const N = Number(process.argv[2] ?? 100);
const over = JSON.parse(process.argv[3] ?? '{}') as Partial<PopTuning>;
const med = (xs: number[]) => { const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
const pct = (xs: number[], q: number) => { const s = [...xs].sort((p, r) => p - r); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };

for (const bot of (process.env.BOTS ?? 'greedy,powers').split(',') as ('greedy' | 'powers')[]) {
  const runs: { p: number; l: number; s: number; c: number; cp: number; u: number; w: number }[] = [];
  const t0 = performance.now();
  for (let i = 0; i < N; i++) {
    const sim = new PopSim({ seed: 20000 + i, tuning: over, newPlayer: false, windReady: bot === 'powers' && i % 3 === 0 });
    if (bot === 'greedy') playOut(sim, greedyMove, 3000); else playIntents(sim, smartIntent, 3000);
    runs.push({ p: sim.placements, l: sim.lines, s: sim.score, c: sim.clears, cp: sim.cp, u: sim.powersUsed, w: sim.wind === 'used' ? 1 : 0 });
  }
  const ps = runs.map(r => r.p);
  const lpp = runs.reduce((a, r) => a + r.l, 0) / runs.reduce((a, r) => a + r.p, 0);
  console.log(`${bot.padEnd(6)} ${N} runs ${((performance.now() - t0) / 1000).toFixed(1)} s | placements p25 ${pct(ps, 0.25)} median ${med(ps)} p75 ${pct(ps, 0.75)} | score ${med(runs.map(r => r.s))} | lines ${med(runs.map(r => r.l))} (${lpp.toFixed(3)}/placement) | CPs ${med(runs.map(r => r.cp))} | All Clears/run ${(runs.reduce((a, r) => a + r.c, 0) / N).toFixed(2)}${bot === 'powers' ? ` | powers/run ${(runs.reduce((a, r) => a + r.u, 0) / N).toFixed(1)}, Second Wind used ${runs.reduce((a, r) => a + r.w, 0)}/${N}` : ''}`);
}
