// Checks that bot runs play step for step the same on two builds, e.g. that a build adding power-ups
// leaves runs without power intents unchanged (gameplay.md §13.4). The bot records runs on one
// build; another build replays them from their inputs and compares the digests.
// Usage:
//   QA_GAME_SIM=<old checkout>/game/src/sim/testApi.ts tsx scripts/cross-build.ts record <runs.json> [count] [--powers]
//   QA_GAME_SIM=<new checkout>/game/src/sim/testApi.ts tsx scripts/cross-build.ts replay <runs.json>
// Replaying on the build that recorded them is the control: it shows the bot's ghost queries
// left no trace in the sim.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gameSimPath } from '../src/adapters/index';
import { Bot, runBot, type BotSim } from '../src/bot';

const [mode, file, countArg, flag] = process.argv.slice(2);
if ((mode !== 'record' && mode !== 'replay') || !file) throw new Error('usage: tsx scripts/cross-build.ts record|replay <runs.json> [count] [--powers]');
const api = await import(pathToFileURL(gameSimPath()).href);
const where = gameSimPath();

if (mode === 'record') {
  const { extents } = await import(pathToFileURL(resolve(dirname(where), 'shapes.ts')).href);
  const count = Number(countArg ?? 8);
  const powers = flag === '--powers' || countArg === '--powers';
  const runs = [];
  for (let seed = 1; seed <= count; seed++) {
    const tuning = seed % 2 ? {} : { mortar: false };
    const rookieOpening = seed % 3 === 0;
    const secondWind = powers ? (['earn', 'ready', 'off'] as const)[seed % 3] : undefined;
    const sim = new api.Sim({ seed, tuning, autoSpawn: true, rookieOpening, secondWind }) as BotSim & Record<string, any>;
    // Quitting is only an intent from 81540e9 on (older builds ignore it), so only power runs quit.
    const bot = new Bot({ seed, powers, naturalFall: 0.3, quitAt: powers && seed % 4 === 0 ? 60 * 150 : undefined }, extents);
    const run = runBot(sim, bot, 60 * 300);
    runs.push({ seed, tuning, rookieOpening, secondWind, ...run, end: { cause: sim.cause ?? null, placed: sim.stats.placed, checkpoints: sim.stats.checkpoints, powers: sim.stats.powers ?? 0, secondWind: sim.stats.secondWind ?? false, score: Math.round(sim.score) } });
    console.log(`seed ${seed}: ${(run.steps / 60).toFixed(0)} s, ${sim.stats.placed} placed, ${sim.stats.checkpoints} checkpoints, ended by ${sim.cause ?? 'time'}${powers ? `, ${sim.stats.powers} powers used, Second Wind ${sim.stats.secondWind ? 'used' : 'not used'}` : ''}`);
    sim.dispose?.();
  }
  writeFileSync(file, JSON.stringify({ recordedWith: where, runs }));
} else {
  const { runs, recordedWith } = JSON.parse(readFileSync(file, 'utf8'));
  let bad = 0;
  for (const r of runs) {
    const { digests, sim } = api.replay({ seed: r.seed, tuning: r.tuning, rookieOpening: r.rookieOpening, secondWind: r.secondWind, inputs: r.inputs, steps: r.steps });
    const first = r.digests.findIndex((d: string, i: number) => d !== digests[i]);
    const final = sim.digest() === r.finalDigest;
    const end = { cause: sim.cause ?? null, placed: sim.stats.placed, checkpoints: sim.stats.checkpoints, powers: sim.stats.powers ?? 0, secondWind: sim.stats.secondWind ?? false, score: Math.round(sim.score) };
    const sameEnd = JSON.stringify(end) === JSON.stringify(r.end);
    const ok = first === -1 && final && sameEnd;
    if (!ok) bad++;
    console.log(`seed ${r.seed}: ${ok ? 'MATCH' : `MISMATCH (first digest ${first === -1 ? 'none' : `at second ${first + 1}`}, final ${final ? 'matches' : 'differs'}, end ${sameEnd ? 'matches' : `${JSON.stringify(end)} vs ${JSON.stringify(r.end)}`})`}`);
    sim.dispose?.();
  }
  console.log(`${runs.length - bad} of ${runs.length} runs recorded on ${recordedWith} replay exactly on ${where}`);
  process.exitCode = bad ? 1 : 0;
}
