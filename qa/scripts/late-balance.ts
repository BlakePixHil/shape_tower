// QA's balance read of the late game (gameplay.md §7.1, §8.2): QA's stacking bot starts at Orbit (CP 11)
// with 3 hearts and a real brick budget, and plays until the run ends or 10 minutes pass. Three rule sets:
// before the late challenge (no late hazards, a heart back every claim), late hazards only, and the late
// challenge as built (late hazards, a heart back every third claim). Report only; nothing is judged.
// Usage: QA_GAME_SIM=<checkout>/game/src/sim/testApi.ts [QA_ENGINE=rapier] tsx scripts/late-balance.ts [seeds]
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, loadSim } from '../src/adapters/index';
import { Bot, type BotSim } from '../src/bot';
import { loadGameApi } from '../src/game-api';

const seeds = Number(process.argv[2] ?? 12);
const sut = await loadSim();
const { api, shapes } = (await loadGameApi(sut))!;
const LATE = ['crosswind', 'junk', 'meteor', 'dust', 'sway'];
const RULES = [
  { name: 'before (no late hazards, heart every claim)', tuning: { lateHazards: false, heartsEveryFrom: 0 } },
  { name: 'late hazards, heart every claim', tuning: { lateHazards: true, heartsEveryFrom: 0 } },
  { name: 'as built (late hazards, heart every third claim)', tuning: { lateHazards: true, heartsEveryFrom: 11 } },
];
const out: Record<string, unknown>[] = [];
const lines: string[] = [];
for (const rule of RULES) {
  const runs: { seed: number; cp: number; seconds: number; cause: string; lost: number; hits: number }[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const sim = new api.Sim({ seed: 900 + seed, startCheckpoint: 11, tuning: { mortar: true, seenHazards: LATE, hazardIntro: false, ...rule.tuning }, autoSpawn: true, rookieOpening: false, secondWind: 'off' }) as BotSim & Record<string, any>;
    const bot = new Bot({ seed: 900 + seed, naturalFall: 0.3 }, shapes.extents);
    let lost = 0;
    let hits = 0;
    while (sim.stepIndex < 60 * 600 && sim.state === 'playing') {
      bot.tick(sim);
      sim.step();
      for (const e of sim.drainEvents() as { name: string }[]) {
        if (e.name === 'heart_lost') lost++;
        if (e.name === 'hazard_hit') hits++;
      }
    }
    runs.push({ seed, cp: sim.checkpoint, seconds: Math.round(sim.stepIndex / 60), cause: sim.state === 'over' ? String(sim.cause) : 'time cap', lost, hits });
    sim.dispose();
  }
  const cps = runs.map((r) => r.cp - 11).sort((a, b) => a - b);
  const median = cps[Math.floor(cps.length / 2)];
  const mean = cps.reduce((a, b) => a + b, 0) / cps.length;
  const lostPerCp = runs.reduce((a, r) => a + r.lost, 0) / Math.max(1, runs.reduce((a, r) => a + (r.cp - 11), 0));
  const causes = runs.reduce<Record<string, number>>((a, r) => ((a[r.cause] = (a[r.cause] ?? 0) + 1), a), {});
  lines.push(`${rule.name}: claimed ${mean.toFixed(1)} checkpoints past CP 10 on average (median ${median}, ${cps[0]} to ${cps[cps.length - 1]}), ${lostPerCp.toFixed(2)} hearts lost per claim, ended by ${Object.entries(causes).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  out.push({ rule: rule.name, tuning: rule.tuning, runs });
}
const dir = resolve(REPO_ROOT, 'qa/reports');
mkdirSync(dir, { recursive: true });
const md = [`# late balance (${sut.engine}, report only)`, '', `QA's bot from CP 11 with 3 hearts and a real budget, Mortar on, Second Wind off, ${seeds} seeds per rule set, up to 10 minutes.`, '', ...lines.map((l) => `- ${l}`), ''].join('\n');
writeFileSync(resolve(dir, `late-balance-${sut.engine}.md`), md);
writeFileSync(resolve(dir, `late-balance-${sut.engine}.json`), JSON.stringify(out, null, 1));
console.log(md);
