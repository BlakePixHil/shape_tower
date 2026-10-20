// Physics stability, qa-section.md F3: canonical towers, creep, tunnelling, explosions, sleeping, determinism.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FULL, loadSim, mortarTuning, sandboxTuning } from '../src/adapters/index';
import { MAX_UPWARD_SPEED, newTracker, rng, runTower, stepUntilQuiet, track, type TowerResult } from '../src/measure';
import { firstDivergence, makeScript, playScript } from '../src/replay';
import { knownIssue } from '../src/known-issues';
import { fmt, writeReport } from '../src/report';
import { rotatedSize } from '../src/shapes';
import { CANONICAL, GUIDE_BASES } from '../src/towers';
import { CORE_SHAPES, RECT_SHAPES } from '../src/shapes';
import { supportedShapes, sweep } from '../src/guide';

const sut = await loadSim();
const isGame = sut.kind === 'game';
const SEEDS = FULL ? 100 : 3;
const tunnelBug = knownIssue('F3.2', sut);
const bondBug = knownIssue('F3.3 bonds', sut);

describe(`physics on ${sut.kind} (${sut.engine})`, () => {
  it('F3.4 canonical towers give their expected outcome on every seed (F3.3 no explosions)', async () => {
    const results: (TowerResult & { mortar: 'off' | 'on' })[] = [];
    const mortars: ('off' | 'on')[] = isGame ? ['off', 'on'] : ['off'];
    const runnable = CANONICAL.filter((t) => !t.needsRules && (isGame || t.windG === undefined));
    for (const def of runnable) {
      for (const mortar of mortars) {
        for (let seed = 1; seed <= SEEDS; seed++) {
          const r = await runTower(sut.createSim, def, {
            seed,
            jitter: 0.01,
            mortar,
            engine: sut.engine,
            // T1 is held for 60 s (gameplay.md §16 test 1); the rest for 30 s.
            measureSteps: def.id === 'T1' ? 3600 : 1800,
            tuning: sandboxTuning(sut, { ...mortarTuning(sut, mortar === 'on'), ...(def.windG ? { wind: def.windG } : {}) }),
            // Bonds only form between rested pieces, so Mortar towers are built one piece at a time.
            incremental: mortar === 'on' ? { bondSteps: 90 } : undefined,
          });
          results.push({ ...r, mortar });
        }
      }
    }
    const lines: string[] = [];
    const wrong: string[] = [];
    for (const def of runnable) {
      for (const mortar of mortars) {
        const rs = results.filter((r) => r.id === def.id && r.mortar === mortar);
        const outcomes = new Map<string, number>();
        for (const r of rs) outcomes.set(r.outcome, (outcomes.get(r.outcome) ?? 0) + 1);
        const expected = rs[0].expected;
        const bad = rs.filter((r) => r.pass === false);
        const worst = Math.max(...rs.map((r) => r.maxDispAfterSettle));
        const line = `${def.id} ${def.title}, Mortar ${mortar}: expected ${expected}, got ${[...outcomes].map(([k, v]) => `${k} ×${v}`).join(', ')}; worst drift after settling ${fmt(worst)} blocks, max upward speed ${fmt(Math.max(...rs.map((r) => r.maxUpSpeed)), 2)}, longest overlap ${Math.max(...rs.map((r) => r.longestOverlapRun))} steps`;
        lines.push(`${bad.length ? 'FAIL ' : ''}${line}`);
        if (bad.length) wrong.push(line);
      }
    }
    for (const def of CANONICAL.filter((t) => t.needsRules)) lines.push(`${def.id} ${def.title}: needs game rules (${def.needsRules}), not run here yet`);
    const exploded = results.filter((r) => r.maxUpSpeed > MAX_UPWARD_SPEED || r.longestOverlapRun > 3);
    for (const r of exploded) lines.push(`FAIL F3.3 ${r.id} seed ${r.seed} Mortar ${r.mortar}: upward speed ${fmt(r.maxUpSpeed, 2)}, overlap ${fmt(r.maxOverlap)} for ${r.longestOverlapRun} steps`);
    // The reference sim isn't the game, so its tower outcomes are information, not a verdict.
    const verdict = !isGame ? 'info' : wrong.length || exploded.length ? 'fail' : 'pass';
    writeReport({ suite: 'towers', sim: sut, full: FULL }, verdict, [`${SEEDS} seeds per tower, sideways jitter ±0.01 blocks; Mortar towers built one piece at a time, each resting 1.5 s after settling`, ...lines], results);
    expect(exploded.map((r) => `${r.id}/${r.seed}/${r.mortar}`)).toEqual([]);
    if (isGame) expect(wrong).toEqual([]);
  });

  it('F3.1 no creep: an 8 × 8 wall drifts under 0.05 blocks in 60 s', async () => {
    const t1 = CANONICAL.find((t) => t.id === 'T1')!;
    const r = await runTower(sut.createSim, t1, { seed: 11, measureSteps: 3600, engine: sut.engine, tuning: sandboxTuning(sut, mortarTuning(sut, false)) });
    expect(r.maxDispAfterSettle).toBeLessThan(0.05);
    expect(r.lost).toBe(0);
  });

  it('F3.7 sleeping: a settled wall goes quiet within 5 s', async () => {
    const t1 = CANONICAL.find((t) => t.id === 'T1')!;
    const sim = await sut.createSim({ engine: sut.engine, seed: 3, tuning: sandboxTuning(sut) });
    for (const p of t1.pieces) sim.placePiece(p);
    // Quiet = gameplay.md §3.5's settle thresholds (0.05 m/s and 3°/s) held for 0.4 s.
    const steps = stepUntilQuiet(sim, 300, { speed: 0.05, spin: (3 * Math.PI) / 180, hold: 24 });
    sim.dispose();
    expect(steps).toBeGreaterThan(0);
  });

  (tunnelBug ? it.fails : it)(`F3.2 no tunnelling: shapes dropped a full stretch (16 blocks) never pass through the plinth or sink into a resting shape${tunnelBug ? ` (known bug ${tunnelBug.id})` : ''}`, async () => {
    const drops = FULL ? 1000 : 40;
    const r = rng(2026);
    const problems: string[] = [];
    let worstOverlap = 0;
    for (let i = 0; i < drops; i++) {
      const sim = await sut.createSim({ engine: sut.engine, seed: i + 1, tuning: sandboxTuning(sut) });
      const onShape = i % 2 === 1;
      if (onShape) sim.placePiece({ shape: 'O', x: 0, y: 1, rot: 0, as: 'dynamic' });
      const shape = r() < 0.5 ? 'Domino' : 'O';
      const rot = Math.floor(r() * 4);
      const x = onShape ? (r() - 0.5) * 1.5 : (r() - 0.5) * 6;
      // 16 blocks is the longest stretch (gameplay.md §7.2), about 24 blocks/s at impact.
      const id = sim.placePiece({ shape, x, y: 18, rot, as: 'dynamic' });
      const t = newTracker();
      for (let s = 0; s < 300; s++) {
        sim.step();
        track(t, sim.pieces());
      }
      worstOverlap = Math.max(worstOverlap, t.maxOverlap);
      const p = sim.pieces().find((q) => q.id === id);
      const half = rotatedSize(shape, rot).h / 2;
      if (!onShape && (!p || p.y - half < -0.05)) problems.push(`drop ${i}: ${shape} rot ${rot} at x ${x.toFixed(2)} ${p ? `ended at y ${p.y.toFixed(3)}` : 'fell through'}`);
      if (t.longestOverlapRun > 3) problems.push(`drop ${i}: ${shape} overlapped a resting shape by ${t.maxOverlap.toFixed(3)} for ${t.longestOverlapRun} steps`);
      sim.dispose();
    }
    const verdict = !isGame ? 'info' : problems.length ? 'fail' : 'pass';
    const known = tunnelBug ? [`Known bug ${tunnelBug.id} (${tunnelBug.owner}, since ${tunnelBug.since}): ${tunnelBug.summary}`] : [];
    writeReport({ suite: 'tunnelling', sim: sut, full: FULL }, verdict, [...known, `${drops} drops from y = 18 (16 blocks above a resting O, about 24 blocks/s at impact), half onto a resting O`, `worst overlap ${fmt(worstOverlap)} blocks`, ...problems], { problems });
    // The reference sim is only a stand-in, so its result is information; the game must pass.
    if (isGame) expect(problems).toEqual([]);
  });

  // A shape at rot 2 sits at angle ±π, where a bond that doesn't unwind its angle sees a full turn of error.
  (bondBug ? it.fails : it)(`F3.3 no explosions: upside-down shapes landing on a stack stay put once Mortar bonds them${bondBug ? ` (known bug ${bondBug.id})` : ''}`, async () => {
    const tuning = sandboxTuning(sut, mortarTuning(sut, true));
    const shapes = await supportedShapes(sut.createSim, FULL ? RECT_SHAPES : CORE_SHAPES, { engine: sut.engine, tuning });
    const bases = FULL ? GUIDE_BASES : GUIDE_BASES.filter((b) => b.id === 'T1');
    // 120 steps after touchdown covers the bond delay (0.5 s) and the shape being flung.
    const { results } = await sweep({ createSim: sut.createSim, engine: sut.engine, bases, shapes, rots: [2], afterSteps: 120, tuning });
    const landed = results.filter((r) => r.outcome === 'landed');
    const flung = landed.filter((r) => r.maxUpAfter! > MAX_UPWARD_SPEED);
    const lines = [
      `${landed.length} upside-down drops landed on ${bases.map((b) => b.id).join(', ')} (${shapes.join(', ')}; natural fall and hard drop; Mortar on); ${flung.length} then sent a piece upward faster than ${MAX_UPWARD_SPEED} blocks/s`,
      ...flung.slice(0, 20).map((r) => `FAIL ${r.base} ${r.shape} rot 2 x ${r.x} ${r.mode}: upward ${fmt(r.maxUpAfter!, 1)} blocks/s`),
    ];
    if (bondBug) lines.unshift(`Known bug ${bondBug.id} (${bondBug.owner}, since ${bondBug.since}): ${bondBug.summary}`);
    writeReport({ suite: 'bonds', sim: sut, full: FULL }, flung.length ? 'fail' : 'pass', lines, { flung });
    expect(landed.length).toBeGreaterThan(0);
    expect(flung.map((r) => `${r.base} ${r.shape} x ${r.x} ${r.mode}`)).toEqual([]);
  });

  it('F3.6 determinism: the same script gives the same hashes twice in one process and in a second process', async () => {
    const seeds = FULL ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2];
    const lines: string[] = [];
    const bad: string[] = [];
    for (const seed of seeds) {
      const script = makeScript(seed, FULL ? 30 : 12);
      const runA = playScript(await sut.createSim({ engine: sut.engine, seed, tuning: sandboxTuning(sut) }), script);
      const runB = playScript(await sut.createSim({ engine: sut.engine, seed, tuning: sandboxTuning(sut) }), script);
      const child = spawnSync(resolve('node_modules/.bin/tsx'), [resolve('scripts/determinism-child.ts'), String(seed), String(script.drops.length)], { env: process.env, encoding: 'utf8', timeout: 300_000 });
      if (child.status !== 0) throw new Error(`child run failed: ${child.stderr}`);
      const runC = JSON.parse(child.stdout.trim().split('\n').pop()!) as { hashes: string[] };
      const ab = firstDivergence(runA.hashes, runB.hashes);
      const ac = firstDivergence(runA.hashes, runC.hashes);
      const line = `seed ${seed}: ${script.drops.length} drops, ${runA.landed} landed, ${runA.steps} steps, ${runA.hashes.length} hashes; same process ${ab < 0 ? 'match' : `differ from hash ${ab}`}; second process ${ac < 0 ? 'match' : `differ from hash ${ac}`}`;
      lines.push(line);
      if (ab >= 0 || ac >= 0) bad.push(line);
    }
    writeReport({ suite: 'determinism', sim: sut, full: FULL }, bad.length ? 'fail' : 'pass', lines, { lines });
    expect(bad).toEqual([]);
  });
});
