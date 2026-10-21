// Plays one determinism script in a fresh process and prints its hashes as JSON (F3.6).
// Usage: tsx scripts/determinism-child.ts <seed> <drops>
import { loadSim, sandboxTuning } from '../src/adapters/index';
import { makeScript, playScript } from '../src/replay';

const seed = Number(process.argv[2] ?? 1);
const drops = Number(process.argv[3] ?? 12);
const sut = await loadSim();
const sim = await sut.createSim({ engine: sut.engine, seed, tuning: sandboxTuning(sut) });
const run = playScript(sim, makeScript(seed, drops));
sim.dispose();
console.log(JSON.stringify({ hashes: run.hashes }));
