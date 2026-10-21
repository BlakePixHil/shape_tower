// Landing-guide accuracy, qa-section.md §5 (G1 to G8, G11) against the sim under test.
import { describe, expect, it } from 'vitest';
import { FULL, loadSim, sandboxTuning } from '../src/adapters/index';
import { g1Tolerance, sameStepUpdate, steeredTouchdown, supportedShapes, sweep, type GuideResult } from '../src/guide';
import { MAX_UPWARD_SPEED } from '../src/measure';
import { fmt, pct, writeReport } from '../src/report';
import { CORE_SHAPES, RECT_SHAPES } from '../src/shapes';
import { GUIDE_BASES } from '../src/towers';

const sut = await loadSim();
const tuning = sandboxTuning(sut);

describe(`landing guide on ${sut.kind} (${sut.engine})`, () => {
  it('G1–G4, G6, G8: every drop lands where the guide said', async () => {
    const wanted = FULL ? RECT_SHAPES : CORE_SHAPES;
    const shapes = await supportedShapes(sut.createSim, wanted, { engine: sut.engine, tuning });
    const absent = wanted.filter((k) => !shapes.includes(k));
    const { results, summary } = await sweep({
      createSim: sut.createSim,
      engine: sut.engine,
      bases: GUIDE_BASES,
      shapes,
      sample: FULL ? 1 : 0.05,
      afterSteps: 120,
      tuning,
    });
    const s = summary;
    const red = s.tint.red;
    const g1Line = `G1 touchdown error: ${pct(s.g1Within)} within tolerance (target 99.9%), worst ${fmt(s.g1Worst, 5)} blocks, ${s.g1Over3x} over 3× (target 0)`;
    const otherLine = `G2 rotation mismatches: ${s.g2Failures} · G3 wrong support: ${s.g3Failures} · G4 misaligned: ${s.g4Failures} · G6 flicker: ${s.g6Failures} · G8 wrong miss call: ${s.g8Failures} (all target 0)`;
    const lines = [
      `${s.cases} drops (${FULL ? 'full sweep' : '5% sample'}) on ${GUIDE_BASES.length} bases, ${shapes.length} shapes, 4 rotations, natural fall and hard drop: ${s.landed} landed, ${s.missed} missed, ${s.timeouts} timed out, in ${(s.ms / 1000).toFixed(1)} s`,
      ...(absent.length ? [`Shapes not in this build yet, so not swept: ${absent.join(', ')}`] : []),
      g1Line,
      otherLine,
      `G11 contact dots (reported only, until dots are pinned down): worst ${fmt(s.g11Worst)} blocks from the shape's underside`,
      `Tint on single drops (calibration for G10, not the bar): red ${red ? `${red.tipped}/${red.shown} tipped (${pct(red.tipped / red.shown, 0)})` : 'never shown'}, ` +
        Object.entries(s.tint)
          .filter(([k]) => k !== 'red')
          .map(([k, v]) => `${k} ${v.tipped}/${v.shown} tipped`)
          .join(', '),
      `F3.3 after touchdown (judged in the physics suite): ${s.flung.length} drops sent a piece upward faster than ${MAX_UPWARD_SPEED} blocks/s${s.flung.length ? `, for example ${s.flung.slice(0, 4).map((f) => `${f.base} ${f.shape} rot ${f.rot} x ${f.x} ${f.mode} (${fmt(f.maxUpAfter!, 1)})`).join(', ')}` : ''}`,
      ...s.failures.slice(0, 20).map((f: GuideResult) => `FAIL ${f.base} ${f.shape} rot ${f.rot} x ${f.x} ${f.mode}: ${f.failures.join('; ')}`),
    ];
    const ok = s.g1Within >= 0.999 && s.g1Over3x === 0 && s.g2Failures + s.g3Failures + s.g4Failures + s.g6Failures + s.g8Failures + s.timeouts === 0;
    writeReport({ suite: 'guide', sim: sut, full: FULL }, ok ? 'pass' : 'fail', lines, { summary: { ...s, failures: s.failures.length, flung: s.flung.length }, failures: s.failures, flung: s.flung, sample: results.slice(0, 50) });
    expect(s.g1Within, g1Line).toBeGreaterThanOrEqual(0.999);
    expect(s.g1Over3x, g1Line).toBe(0);
    expect(s.g2Failures + s.g3Failures + s.g4Failures + s.g6Failures + s.g8Failures, otherLine).toBe(0);
    expect(s.timeouts).toBe(0);
    // The full sweep is over 100,000 drops on one core; give it an hour so a busy machine doesn't
    // fail it on time alone.
  }, FULL ? 3_600_000 : undefined);

  // QA-003: a shape steered onto a ledge as it reached it landed the next frame, so its red guide
  // showed for 16 ms. The game's controls rule (gameplay.md §2) belongs to the game, not the stand-in.
  it.runIf(sut.kind === 'game')('G12: a landing the player steers into shows its guide for at least 0.1 s first', async () => {
    const cases: [string, number][] = [['O', 0], ['I', 0], ['I', 1], ['T', 0], ['L', 0], ['J', 0]];
    const results = [];
    for (const [shape, rot] of cases) {
      const sim = await sut.createSim({ engine: sut.engine, seed: 9, tuning });
      // 6 steps is 0.1 s; touchdown grace is capped at 0.35 s (21 steps), plus a step either side.
      results.push(steeredTouchdown(sim, shape, rot, { minSteps: 6, maxSteps: 23 }));
      sim.dispose();
    }
    const lines = results.map((r) => `${r.failures.length ? 'FAIL ' : ''}${r.shape} rot ${r.rot}: landed ${r.stepsToLand ?? 'never'} steps after the move, guide on the spot for ${r.shownSteps}${r.failures.length ? `; ${r.failures.join('; ')}` : ''}`);
    writeReport({ suite: 'steered-touchdown', sim: sut, full: FULL }, results.some((r) => r.failures.length) ? 'fail' : 'pass', lines, { results });
    expect(results.filter((r) => r.failures.length).map((r) => `${r.shape} rot ${r.rot}: ${r.failures.join('; ')}`)).toEqual([]);
  });

  it('G5: the guide follows a move or rotation before the next step', async () => {
    const problems: string[] = [];
    for (const shape of CORE_SHAPES) {
      const sim = await sut.createSim({ engine: sut.engine, seed: 7, tuning });
      sim.placePiece({ shape: 'O', x: 2, y: 1, rot: 0, as: 'stone' });
      sim.step(5);
      problems.push(...sameStepUpdate(sim, shape).map((p) => `${shape}: ${p}`));
      sim.dispose();
    }
    expect(problems).toEqual([]);
  });

  it('G1 tolerance is 1 px at 1170 px across 12 blocks, or 1% of the smallest side', () => {
    expect(g1Tolerance('I')).toBeCloseTo(12 / 1170, 6);
    expect(g1Tolerance('O')).toBeCloseTo(0.02, 6);
  });
});
