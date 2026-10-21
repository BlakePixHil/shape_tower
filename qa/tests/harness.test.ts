// Self-tests: the harness must catch the faults it exists to catch. These always use the
// reference sim, whatever QA_SIM says, so they test the harness and not the game.
import { describe, expect, it } from 'vitest';
import { createReferenceSim } from '../src/adapters/reference/referenceSim';
import type { CreateSim } from '../src/contract';
import { sweep } from '../src/guide';
import { runTower } from '../src/measure';
import { firstDivergence, makeScript, playScript } from '../src/replay';
import { CANONICAL, FLAT, GUIDE_BASES } from '../src/towers';

const withFaults =
  (faults: Record<string, number>): CreateSim =>
  (o) =>
    createReferenceSim({ ...o, tuning: { ...o.tuning, faults } });

const tower = (id: string) => CANONICAL.find((t) => t.id === id)!;

describe('harness self-tests (reference sim)', () => {
  it('a correct guide passes the sweep', async () => {
    const { summary } = await sweep({ createSim: createReferenceSim, bases: [FLAT, tower('T5')], shapes: ['O', 'I', 'L'], sample: 0.3, modes: ['fall'] });
    expect(summary.g1Within).toBe(1);
    expect(summary.failures).toEqual([]);
  });

  it('a guide drawn 0.05 blocks too high fails G1', async () => {
    const { summary } = await sweep({ createSim: withFaults({ ghostBiasY: 0.05 }), bases: [FLAT], shapes: ['O', 'I'], sample: 0.3, modes: ['fall'] });
    expect(summary.g1Within).toBe(0);
    expect(summary.g1Over3x).toBeGreaterThan(0);
  });

  it('a guide drawn half a block to the side fails G1 and G4', async () => {
    const { summary } = await sweep({ createSim: withFaults({ ghostBiasX: 0.5 }), bases: [GUIDE_BASES[1]], shapes: ['O'], sample: 0.3, modes: ['hard'] });
    expect(summary.g1Within).toBeLessThan(0.5);
    expect(summary.g4Failures).toBeGreaterThan(0);
  });

  it('tower outcomes are classified: a wall stands, an O hanging 1.5 off the edge falls', async () => {
    const stands = await runTower(createReferenceSim, tower('T1'), { seed: 1 });
    const falls = await runTower(createReferenceSim, tower('T9'), { seed: 1 });
    expect(stands.outcome).toBe('stands');
    expect(falls.outcome).toBe('falls');
  });

  it('determinism checks notice a sim that differs between runs', async () => {
    const script = makeScript(5, 4);
    const a = playScript(await createReferenceSim({ engine: 'reference', seed: 5 }), script);
    const b = playScript(await createReferenceSim({ engine: 'reference', seed: 5 }), script);
    expect(firstDivergence(a.hashes, b.hashes)).toBe(-1);
    // A 0.01 m/s push on one piece mid-run must show up as a divergence.
    const c = playScript(await withFaults({ nudgeAtStep: 400 })({ engine: 'reference', seed: 5 }), script);
    expect(firstDivergence(a.hashes, c.hashes)).toBeGreaterThanOrEqual(0);
  });

  it('snapshot and restore resume to the same hashes (D10)', async () => {
    const sim = await createReferenceSim({ engine: 'reference', seed: 9 });
    for (const p of tower('T5').pieces) sim.placePiece(p);
    sim.step(90);
    const snap = sim.snapshot();
    sim.step(120);
    const a = sim.hash();
    sim.restore(snap);
    sim.step(120);
    expect(sim.hash()).toBe(a);
    sim.dispose();
  });
});
