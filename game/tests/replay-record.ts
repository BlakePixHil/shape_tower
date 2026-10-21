// Replays a run record (from the page database or play-check) and compares digests.
//   node --experimental-strip-types tests/replay-record.ts path/to/run-record.json

import { readFileSync } from 'node:fs';
import { replay } from '../src/sim/testApi.ts';

const rec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { digests, sim } = replay({ seed: rec.seed, tuning: rec.tuning, rookieOpening: rec.rookieOpening, secondWind: rec.secondWind, inputs: rec.inputs, steps: rec.steps });
let first = -1;
for (let i = 0; i < rec.digests.length; i++) if (digests[i] !== rec.digests[i]) { first = i; break; }
const final = sim.digest() === rec.finalDigest;
console.log(first === -1 && final ? `MATCH  ${rec.digests.length} digests and the final state` : `MISMATCH  first at second ${first + 1}, final ${final ? 'matches' : 'differs'}`);
process.exit(first === -1 && final ? 0 : 1);
