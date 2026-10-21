// Replays run records in a fresh process and prints, per record, whether every digest, the final
// state and the run's end match (F18.13). Usage: tsx scripts/replay-child.ts <records.json>
// Replays on the engine QA_ENGINE names, like the suite that spawned it.
import { readFileSync } from 'node:fs';
import { loadSim } from '../src/adapters/index';
import { loadGameApi } from '../src/game-api';

const records = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { api } = (await loadGameApi(await loadSim()))!;
const out = [];
for (const r of records) {
  const { digests, sim } = api.replay(r);
  const end = { cause: sim.cause, score: Math.round(sim.score), powers: sim.stats.powers, wind: sim.secondWind, slots: sim.slots.join() };
  const same = r.digests.every((d: string, i: number) => d === digests[i]) && sim.digest() === r.finalDigest && JSON.stringify(end) === JSON.stringify(r.end);
  out.push({ seed: r.seed, same });
  sim.dispose();
}
console.log(JSON.stringify(out));
