// Gusts, qa-section.md F7.1, F7.6, F7.8 and Q25 (gameplay.md §8.2, §8.3). Game only, from game/slice.
// The schedule per checkpoint, the 2 s warning, half strength the first time ever, no gust starting in a
// hold or the claim pause and gusts easing off in one, the steered shape never pushed, a wide wall
// standing through every stretch's gusts, and runs with gusts replaying exactly.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FULL, REPO_ROOT, loadSim } from '../src/adapters/index';
import { Bot, type BotSim } from '../src/bot';
import { loadGameApi } from '../src/game-api';
import { g1Tolerance } from '../src/guide';
import { knownIssue } from '../src/known-issues';
import { fmt, writeReport } from '../src/report';

const sut = await loadSim();
const game = await loadGameApi(sut);
const periodBug = knownIssue('F7.1 gust period', sut);

type Ev = { name: string; step: number; payload: Record<string, any> };
type T = Record<string, any>;
const S = (t: T) => t.sim as Record<string, any>;

/** gameplay.md §8.2 (retuned 2026-10-22): gust strength in g and how often they come, per checkpoint. None outside 3 to 10. */
const SPEC: Record<number, { strength: number; every: number }> = {
  3: { strength: 0.04, every: 20 }, 4: { strength: 0.06, every: 18 },
  5: { strength: 0.07, every: 16 }, 6: { strength: 0.08, every: 15 },
  7: { strength: 0.09, every: 14 }, 8: { strength: 0.1, every: 13 },
  9: { strength: 0.11, every: 12 }, 10: { strength: 0.12, every: 12 },
};
const WARN_STEPS = 120;

const live: { dispose(): void }[] = [];
const own = <X>(x: X): X => (live.push(x as unknown as { dispose(): void }), x);
afterEach(() => {
  for (const x of live.splice(0)) x.dispose();
});
function make(tuning: Record<string, unknown> = {}, opts: Record<string, unknown> = {}): T {
  return own(game!.api.createSim({ engine: sut.engine, seed: 7, tuning: { firstGap: 1000, infiniteHearts: true, infiniteBudget: true, powerUps: false, ...tuning }, ...opts }) as T);
}
const gustEvents = (ev: Ev[]) => ev.filter((e) => e.name.startsWith('hazard_') && e.payload.type === 'gust');

describe.runIf(game?.gusts)(`gusts on ${sut.kind} (${sut.engine})`, () => {
  (periodBug ? it.fails : it)(`F7.1 F7.8 the gust schedule per checkpoint: strength, 2 to 3 s long, warned 2 s ahead, how often${periodBug ? ` (known bug ${periodBug.id})` : ''}`, () => {
    const seconds = FULL ? 1200 : 400;
    const problems: string[] = [];
    const lines: string[] = [];
    for (let n = 1; n <= 12; n++) {
      const t = make({ hazardIntro: false }, { seed: 100 + n });
      S(t).checkpoint = n;
      const ev: Ev[] = [];
      for (let i = 0; i < seconds; i++) {
        t.step(60);
        ev.push(...gustEvents(t.drainEvents() as Ev[]));
      }
      const spec = SPEC[n];
      if (!spec) {
        if (ev.length) problems.push(`checkpoint ${n}: ${ev.length} gust events, expected none`);
        lines.push(`checkpoint ${n}: no gusts${ev.length ? ` (FAIL: ${ev.length} events)` : ''}`);
        continue;
      }
      const warns = ev.filter((e) => e.name === 'hazard_warning');
      const starts = ev.filter((e) => e.name === 'hazard_start');
      const ends = ev.filter((e) => e.name === 'hazard_end');
      const durations: number[] = [];
      const dirs = new Set<number>();
      for (const s of starts) {
        const w = warns.filter((x) => x.step <= s.step).pop();
        if (!w || s.step - w.step < WARN_STEPS) problems.push(`checkpoint ${n}: a gust at step ${s.step} was warned only ${w ? s.step - w.step : 0} steps ahead`);
        if (w && w.payload.eta < 2) problems.push(`checkpoint ${n}: warning eta ${w.payload.eta} s`);
        if (Math.abs(s.payload.strength - spec.strength) > 1e-9) problems.push(`checkpoint ${n}: strength ${s.payload.strength} g, table ${spec.strength} g`);
        const e = ends.find((x) => x.step > s.step);
        if (e) {
          const d = (e.step - s.step) / 60;
          durations.push(d);
          if (d < 2 - 1 / 60 || d > 3 + 1 / 60) problems.push(`checkpoint ${n}: a gust lasted ${fmt(d, 2)} s, outside 2 to 3`);
        }
        dirs.add(s.payload.dir);
      }
      if (ends.some((e) => e.payload.cancelled)) problems.push(`checkpoint ${n}: a warning was called off with no hold`);
      const firstAt = warns[0] ? warns[0].step / 60 : Infinity;
      if (firstAt < 4 - 1e-9 || firstAt > 6 + 1 / 60) problems.push(`checkpoint ${n}: the stretch's first warning came at ${fmt(firstAt, 2)} s, not 4 to 6`);
      const periods = starts.slice(1).map((s, i) => (s.step - starts[i].step) / 60);
      const mean = periods.reduce((a, b) => a + b, 0) / Math.max(1, periods.length);
      // "Every 18 s" read as the average time from one gust's start to the next.
      if (periods.length < 5) problems.push(`checkpoint ${n}: only ${starts.length} gusts in ${seconds} s`);
      else if (Math.abs(mean - spec.every) > 0.1 * spec.every) problems.push(`checkpoint ${n}: gusts come every ${fmt(mean, 1)} s on average, the table says every ${spec.every} s`);
      if (dirs.size < 2) problems.push(`checkpoint ${n}: gusts only blew one way`);
      lines.push(`checkpoint ${n}: ${starts.length} gusts of ${spec.strength} g in ${seconds} s, every ${fmt(mean, 1)} s on average (${fmt(Math.min(...periods), 1)} to ${fmt(Math.max(...periods), 1)}; table ${spec.every}), lasting ${fmt(Math.min(...durations), 2)} to ${fmt(Math.max(...durations), 2)} s, first warned at ${fmt(firstAt, 2)} s`);
    }
    if (periodBug) lines.unshift(`Known bug ${periodBug.id} (${periodBug.owner}, since ${periodBug.since}): ${periodBug.summary}`);
    writeReport({ suite: 'gust-schedule', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.slice(0, 12).map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });

  it("F7.8 a player's first gust ever blows at half strength, once; later runs blow full", () => {
    const problems: string[] = [];
    for (const intro of [true, false]) {
      const t = make({ hazardIntro: intro });
      S(t).checkpoint = 6;
      const ev: Ev[] = [];
      for (let i = 0; i < 90; i++) {
        t.step(60);
        ev.push(...gustEvents(t.drainEvents() as Ev[]));
      }
      const warns = ev.filter((e) => e.name === 'hazard_warning');
      const starts = ev.filter((e) => e.name === 'hazard_start');
      if (starts.length < 3) { problems.push(`intro ${intro}: only ${starts.length} gusts`); continue; }
      const want = (i: number) => SPEC[6].strength * (intro && i === 0 ? 0.5 : 1);
      starts.forEach((s, i) => { if (Math.abs(s.payload.strength - want(i)) > 1e-9) problems.push(`intro ${intro}: gust ${i + 1} at ${s.payload.strength} g, expected ${want(i)} g`); });
      if (!warns[0]?.payload.first || warns.slice(1).some((w) => w.payload.first)) problems.push(`intro ${intro}: "first" should mark only the run's first warning`);
      if (!!warns[0]?.payload.intro !== intro || warns.slice(1).some((w) => w.payload.intro)) problems.push(`intro ${intro}: "intro" should mark only the first ever gust`);
    }
    writeReport({ suite: 'gust-intro', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', problems.length ? problems : ['the first ever gust blew at half strength and was marked intro; every later gust, and every gust of a later run, blew at full strength'], {});
    expect(problems).toEqual([]);
  });

  it('F7.6 gusts push loose pieces, never stone or the steered shape; the guide stays exact in a gust', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    const t = make({ hazardIntro: false, mortar: false });
    const s = S(t);
    s.checkpoint = 10;
    const stone = t.placePiece({ shape: 'O', x: -3, y: s.foundation.top + 1, as: 'stone' });
    // Wait for a gust to blow, then check a falling loose piece drifts with it.
    let start: Ev | undefined;
    for (let i = 0; i < 60 * 30 && !start; i++) {
      t.step();
      start = gustEvents(t.drainEvents() as Ev[]).find((e) => e.name === 'hazard_start');
    }
    if (!start) throw new Error('no gust in 30 s');
    t.step(30); // past the 0.4 s ease-in
    const loose = t.placePiece({ shape: 'O', x: 2, y: s.foundation.top + 14, as: 'dynamic' });
    t.step(12);
    const view = (id: number) => (s.pieceViews() as { id: number; x: number; y: number; vx: number }[]).find((v) => v.id === id)!;
    const lv = view(loose);
    if (!(Math.sign(lv.vx) === start.payload.dir && Math.abs(lv.vx) > 0.01)) problems.push(`a loose piece falling in the gust moved at vx ${fmt(lv.vx, 3)}, not with the gust (dir ${start.payload.dir})`);
    const sv = view(stone);
    if (Math.abs(sv.x + 3) > 1e-6) problems.push(`the stone piece moved to x ${sv.x}`);
    lines.push(`a loose piece falling 0.2 s into a ${start.payload.strength} g gust drifted at ${fmt(lv.vx, 3)} blocks/s with it; stone stayed put`);
    // The steered shape: spawned in a gust, falling on its own, it never moves sideways and lands on its guide.
    let worstDrift = 0;
    let worstGuide = 0;
    let shapesInGust = 0;
    for (const shape of ['O', 'I', 'T', 'L', 'S']) {
      let blowing = false;
      for (let i = 0; i < 60 * 30 && !blowing; i++) {
        t.step();
        blowing = s.gust.phase === 'blow';
        t.drainEvents();
      }
      t.spawnControlled({ shape, x: 0 });
      const ghost = t.ghost();
      let inGust = false;
      while (s.ctrl) {
        inGust ||= s.gust.phase === 'blow' && s.gust.strength > 0;
        worstDrift = Math.max(worstDrift, Math.abs(s.ctrl.x));
        t.step();
      }
      if (inGust) shapesInGust++;
      const landed = (t.drainEvents() as Ev[]).find((e) => e.name === 'piece_landed');
      if (!landed) { problems.push(`${shape} did not land`); continue; }
      const err = Math.abs(landed.payload.pose.y - ghost.y);
      worstGuide = Math.max(worstGuide, err / g1Tolerance(shape));
      if (landed.payload.pose.x !== 0) problems.push(`${shape} landed at x ${landed.payload.pose.x}, steered to 0`);
      t.step(90);
      s.slots = ['clean', null];
      t.intent({ type: 'power', slot: 0 });
      t.drainEvents();
    }
    if (worstDrift > 0) problems.push(`a steered shape drifted ${worstDrift} blocks sideways`);
    if (worstGuide > 1) problems.push(`a steered shape landed ${fmt(worstGuide, 2)}× the G1 tolerance from its guide`);
    if (shapesInGust < 3) problems.push(`setup: only ${shapesInGust} of 5 shapes fell during a gust`);
    lines.push(`${shapesInGust} of 5 steered shapes fell during a gust: sideways drift ${worstDrift} blocks, worst landing ${fmt(worstGuide, 2)}× the G1 tolerance from the guide`);
    writeReport({ suite: 'gust-push', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });

  it('F7.6 a wide wall stands through every stretch\'s gusts for 60 s, Mortar on and off', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    for (const mortar of [true, false]) {
      for (const n of FULL ? [3, 4, 5, 6, 7, 8, 9, 10] : [4, 6, 10]) {
        const t = make({ hazardIntro: false, mortar }, { seed: 200 + n });
        const s = S(t);
        s.checkpoint = n;
        // T1-style: an 8-wide wall of O pieces, 4 rows high, built row by row and settled.
        const ids: number[] = [];
        for (let row = 0; row < 4; row++) {
          for (let c = 0; c < 4; c++) ids.push(t.placePiece({ shape: 'O', x: -3 + 2 * c, y: s.foundation.top + 1 + 2 * row, as: 'dynamic' }));
          t.step(60);
        }
        t.step(120);
        const at = new Map((s.pieceViews() as { id: number; x: number; y: number }[]).map((v) => [v.id, v]));
        let gusts = 0;
        for (let i = 0; i < 60; i++) {
          t.step(60);
          gusts += gustEvents(t.drainEvents() as Ev[]).filter((e) => e.name === 'hazard_start').length;
        }
        const now = new Map((s.pieceViews() as { id: number; x: number; y: number; state: string }[]).map((v) => [v.id, v]));
        let worst = 0;
        let lost = 0;
        for (const id of ids) {
          const a = at.get(id)!, b = now.get(id);
          if (!b || b.state === 'lost') { lost++; continue; }
          worst = Math.max(worst, Math.hypot(b.x - a.x, b.y - a.y));
        }
        if (lost || worst > 0.25) problems.push(`checkpoint ${n}, Mortar ${mortar ? 'on' : 'off'}: the wall lost ${lost} pieces and moved up to ${fmt(worst, 3)} blocks`);
        if (!gusts) problems.push(`setup: checkpoint ${n} had no gust in 60 s`);
        lines.push(`checkpoint ${n} (${SPEC[n].strength} g), Mortar ${mortar ? 'on' : 'off'}: ${gusts} gusts in 60 s, the wall moved at most ${fmt(worst, 4)} blocks${lost ? `, ${lost} lost` : ''}`);
      }
    }
    writeReport({ suite: 'gust-wall', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });

  it('F7.8 Q25 over whole bot runs: no gust starts in a hold or the claim pause, warnings cut short are called off, gusts ease out in a hold and back after', () => {
    const { api, shapes } = game!;
    const problems: string[] = [];
    const lines: string[] = [];
    const totals = { gusts: 0, cancelled: 0, holds: 0, holdsInGust: 0, claims: 0 };
    for (const seed of FULL ? [1, 2, 3, 4, 5, 6, 7, 8] : [1, 2, 3]) {
      const sim = own(new api.Sim({ seed, tuning: { mortar: seed % 2 === 1 }, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
      const bot = new Bot({ seed, naturalFall: 0.3 }, shapes.extents);
      const bad = (m: string) => problems.length < 20 && problems.push(`seed ${seed} at ${(sim.stepIndex / 60).toFixed(1)} s: ${m}`);
      let warnAt = -1;
      let claimAt = -Infinity;
      let holdFrom = -1;
      let holdEnd = -1;
      let blowAtHold = false;
      while (sim.stepIndex < 60 * (FULL ? 300 : 200) && sim.state === 'playing') {
        const holdBefore = sim.holdState().active;
        const phaseBefore = sim.gust.phase;
        bot.tick(sim);
        sim.step();
        const holdAfter = sim.holdState().active;
        const ev = sim.drainEvents() as Ev[];
        if (!holdBefore && holdAfter) { holdFrom = sim.stepIndex; totals.holds++; blowAtHold = phaseBefore === 'blow'; if (blowAtHold) totals.holdsInGust++; }
        if (holdBefore && !holdAfter) holdEnd = sim.stepIndex;
        for (const e of ev) {
          if (e.name === 'checkpoint_claimed') { claimAt = sim.stepIndex; totals.claims++; }
          if (e.payload?.type !== 'gust') continue;
          if (e.name === 'hazard_warning') {
            warnAt = sim.stepIndex;
            if (holdBefore && holdAfter) bad('a gust was warned during a hold');
            const spec = SPEC[sim.checkpoint];
            if (!spec) bad(`a gust was warned at checkpoint ${sim.checkpoint}`);
          }
          if (e.name === 'hazard_start') {
            totals.gusts++;
            if (holdBefore && holdAfter) bad('a gust started during a hold');
            if (sim.stepIndex - claimAt < 90) bad(`a gust started ${sim.stepIndex - claimAt} steps after a claim (the claim pause is 90)`);
            if (warnAt < 0 || sim.stepIndex - warnAt < WARN_STEPS) bad(`a gust started ${warnAt < 0 ? 'unwarned' : `${sim.stepIndex - warnAt} steps after its warning`}`);
            warnAt = -1;
          }
          if (e.name === 'hazard_end' && e.payload.cancelled) {
            totals.cancelled++;
            if (!holdAfter && sim.stepIndex - claimAt > 1) bad('a warning was called off with no hold or claim');
            warnAt = -1;
          }
        }
        // Q25: hazards fade to zero over 0.5 s while the ring fills and come back over 1 s after.
        if (holdAfter && sim.stepIndex - holdFrom === 31 && sim.hazardScale > 1e-9) bad(`0.5 s into a hold the gusts are still at ${fmt(sim.hazardScale, 3)}`);
        if (!holdAfter && holdEnd > 0 && sim.stepIndex - holdEnd === 61 && sim.hazardScale < 1 - 1e-9) bad(`1 s after a hold the gusts are only back to ${fmt(sim.hazardScale, 3)}`);
      }
      lines.push(`seed ${seed}, Mortar ${seed % 2 === 1 ? 'on' : 'off'}: ${(sim.stepIndex / 60).toFixed(0)} s, ${sim.stats.checkpoints} checkpoints, ${sim.stats.gusts} gusts, ended by ${sim.cause || 'the time cap'}`);
    }
    lines.push(`totals: ${totals.gusts} gusts, ${totals.cancelled} warnings called off, ${totals.holds} holds (${totals.holdsInGust} began mid-gust), ${totals.claims} claims`);
    if (!totals.gusts) problems.push('setup: the bots met no gusts');
    writeReport({ suite: 'gust-holds', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], totals);
    expect(problems).toEqual([]);
  });

  it('F3.6 P20 runs with gusts replay exactly, in this process and a fresh one, and gusts never change the shape bag', () => {
    const { api, shapes } = game!;
    const problems: string[] = [];
    const lines: string[] = [];
    const records = (FULL ? [1, 2, 3, 4, 5, 6] : [1, 2]).map((seed) => {
      const tuning = { mortar: seed % 2 === 1 };
      const sim = own(new api.Sim({ seed, tuning, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
      const bot = new Bot({ seed, naturalFall: 0.3 }, shapes.extents);
      const digests: string[] = [];
      while (sim.stepIndex < 60 * (FULL ? 300 : 180) && sim.state === 'playing') {
        bot.tick(sim);
        sim.step();
        if (sim.stepIndex % 60 === 0) digests.push(sim.digest());
      }
      const end = { cause: sim.cause, score: Math.round(sim.score), powers: sim.stats.powers, wind: sim.secondWind, slots: sim.slots?.join() };
      return { seed, tuning, rookieOpening: false, inputs: sim.inputLog.map((x: any) => ({ s: x.s, i: { ...x.i } })), steps: sim.stepIndex, digests, finalDigest: sim.digest(), end, gusts: sim.stats.gusts };
    });
    for (const r of records) {
      const { digests, sim } = api.replay(r);
      const first = r.digests.findIndex((d: string, i: number) => d !== digests[i]);
      const same = first === -1 && sim.digest() === r.finalDigest;
      lines.push(`seed ${r.seed}: ${(r.steps / 60).toFixed(0)} s with ${r.gusts} gusts; replay ${same ? 'MATCH' : `MISMATCH from second ${first + 1}`}`);
      if (!same) problems.push(`seed ${r.seed}: in-process replay differs`);
      if (!r.gusts) problems.push(`setup: seed ${r.seed} met no gusts`);
      sim.dispose();
    }
    const dir = resolve(REPO_ROOT, 'qa/scratch');
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, 'gust-records.json');
    writeFileSync(file, JSON.stringify(records));
    const child = spawnSync('npx', ['tsx', 'scripts/replay-child.ts', file], { cwd: resolve(REPO_ROOT, 'qa'), encoding: 'utf8', env: process.env });
    const out = JSON.parse(child.stdout.trim().split('\n').pop() ?? '[]') as { seed: number; same: boolean }[];
    for (const r of records) if (!out.find((x) => x.seed === r.seed)?.same) problems.push(`seed ${r.seed}: replay in a fresh process differs${child.status ? ` (${child.stderr.slice(0, 200)})` : ''}`);
    lines.push(`fresh process: ${out.filter((o) => o.same).length} of ${records.length} match`);
    // The bag: with gusts on or off, the same seed deals the same shapes.
    const bag = (gusts: boolean) => {
      const sim = own(new api.Sim({ seed: 2, tuning: { gusts, mortar: false }, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
      const bot = new Bot({ seed: 2 }, shapes.extents);
      const seen: string[] = [];
      const at: number[] = [];
      let last: unknown = null;
      while (sim.stepIndex < 60 * 300 && sim.state === 'playing' && seen.length < 200) {
        bot.tick(sim);
        sim.step();
        if (sim.ctrl && sim.ctrl !== last) { last = sim.ctrl; seen.push(sim.ctrl.shape); at.push(sim.checkpoint); }
      }
      return { seq: seen.join(''), at, cps: sim.stats.checkpoints };
    };
    const on = bag(true), off = bag(false);
    // Shape weights change with the checkpoint (late shapes ramp in over their biome), so compare
    // only while both runs are in the same stretch: gusts may change when a run claims, never the draws.
    let n = Math.min(on.seq.length, off.seq.length);
    for (let i = 0; i < n; i++) if (on.at[i] !== off.at[i]) { n = i; break; }
    if (on.seq.slice(0, n) !== off.seq.slice(0, n)) problems.push('gusts change the shape bag');
    if (n < 40) problems.push(`setup: only ${n} shapes were dealt in the same stretch, too few to compare`);
    if (on.cps < 3) problems.push(`setup: the bag run only reached checkpoint ${on.cps + 1}, before any gusts`);
    lines.push(`the first ${n} shapes are the same with gusts on and off (the run with gusts reached checkpoint ${on.cps + 1})`);
    writeReport({ suite: 'gust-replays', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });
});
