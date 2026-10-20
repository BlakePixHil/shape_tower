// Replays a run record from a phone (the prototype's `runs` collection) and prints what happened:
// each landing with the ghost the player saw just before it, losses, hearts, claims, bond breaks,
// and any piece moving upward faster than F3.3 allows. It also checks the record's digests (P2).
// Usage: tsx scripts/run-story.ts <record.json> [--zoom <pieceId,...>]
//   --zoom prints the controlled shape and its ghost for the 14 steps before those landings.
// Replay with the game build the record names (record.build); QA_GAME_SIM points at that checkout.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gameSimPath } from '../src/adapters/index';
import { MAX_UPWARD_SPEED } from '../src/measure';

const [recPath, flag, zoomArg] = process.argv.slice(2);
if (!recPath) throw new Error('usage: tsx scripts/run-story.ts <record.json> [--zoom <pieceId,...>]');
const zoom = new Set(flag === '--zoom' && zoomArg ? zoomArg.split(',').map(Number) : []);
const rec = JSON.parse(readFileSync(recPath, 'utf8'));
// The game's own Sim class, not the test API: a recorded run uses auto spawn and the real rules.
const { Sim } = await import(pathToFileURL(gameSimPath()).href);
const sim = new Sim({ seed: rec.seed, tuning: rec.tuning, autoSpawn: true, rookieOpening: rec.rookieOpening ?? false });

const SHOWN = new Set(['piece_landed', 'piece_lost', 'heart_lost', 'heart_restored', 'last_heart', 'bond_broken', 'checkpoint_claimed', 'checkpoint_cancelled', 'row_solid', 'run_over', 'clutch', 'hold_swap']);
const t = (s: number) => `${(s / 60).toFixed(1)}s`;
const round = (_k: string, v: unknown) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const lastSteps: string[] = [];
let lastGhost: { tint: string; x: number; y: number | null; rot: number; supportIds: number[] } | null = null;
let lastFlung = -999;
const digests: string[] = [];
let k = 0;

console.log(`run ${rec.runNumber ?? '?'} on build ${rec.build}, ${rec.device?.ua?.match(/\(([^)]*)\)/)?.[1] ?? 'unknown device'}; seed ${rec.seed}; answers ${JSON.stringify(rec.answers ?? {})}`);
while (sim.stepIndex < rec.steps) {
  const applied: string[] = [];
  while (k < rec.inputs.length && rec.inputs[k].s === sim.stepIndex) {
    const i = rec.inputs[k++].i;
    applied.push(`${i.type}${i.x !== undefined ? ` ${i.x}` : ''}${i.on !== undefined ? ` ${i.on}` : ''}`);
    if (i.type === 'retune') sim.retune(i.patch);
    else sim.intent(i);
  }
  const c = sim.ctrl;
  const g = c ? sim.ghost() : null;
  if (g) lastGhost = g;
  if (c) {
    lastSteps.push(`    step ${sim.stepIndex} ${applied.join(', ').padEnd(26)} shape x ${c.x} y ${c.y.toFixed(2)} | ghost x ${g?.x} y ${g?.y?.toFixed(2) ?? 'miss'} ${g?.tint ?? ''} on ${JSON.stringify(g?.supportIds ?? [])}`);
    if (lastSteps.length > 14) lastSteps.shift();
  }
  sim.step();
  if (sim.stepIndex % 60 === 0) digests.push(sim.digest());
  for (const e of sim.drainEvents()) {
    if (!SHOWN.has(e.name)) continue;
    if (e.name === 'piece_landed' && lastGhost) {
      console.log(`${t(e.step)} ${e.payload.shape} ${e.payload.id} landed at x ${e.payload.x}; ghost just before: ${lastGhost.tint}, rot ${lastGhost.rot}, on ${JSON.stringify(lastGhost.supportIds)}`);
      if (zoom.has(e.payload.id)) console.log(lastSteps.join('\n'));
      continue;
    }
    console.log(`${t(e.step)} ${e.name} ${JSON.stringify(e.payload, round)}`);
  }
  const flung = sim.pieceViews().filter((v: { state: string; vy: number }) => v.state !== 'controlled' && v.vy > MAX_UPWARD_SPEED);
  if (flung.length && sim.stepIndex - lastFlung > 30) {
    lastFlung = sim.stepIndex;
    console.log(`${t(sim.stepIndex)} FLUNG (F3.3) ${flung.map((v: { id: number; shape: string; vy: number }) => `${v.shape} ${v.id} upward ${v.vy.toFixed(1)} blocks/s`).join('; ')}`);
  }
}
const first = rec.digests.findIndex((d: string, i: number) => d !== digests[i]);
const final = sim.digest() === rec.finalDigest;
console.log(first === -1 && final ? `replay MATCH: ${rec.digests.length} digests and the final state` : `replay MISMATCH: first at second ${first + 1}, final ${final ? 'matches' : 'differs'}`);
process.exitCode = first === -1 && final ? 0 : 1;
