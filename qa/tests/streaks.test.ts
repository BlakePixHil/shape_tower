// The set streak and brittle shapes, gameplay.md §9.1 and §4.3, testable rules §16 items 11 to 14
// (Blake's playtest, #43). Game only, on builds whose tuning has setStreak and brittleEvery. Rows wait
// for the streak from CP 3 and set together once it is reached; Messy placements and lost pieces reset
// it, Quick-Set ignores it. Brittle shapes are dealt from CP 5 with Hold open, never two within 6 shapes,
// never O, I or Plank, never two in play; they hold two shapes, break under a third 1.2 s later, never
// once stone, and cost nothing when lost. The brittle stream leaves the shape bag alone, and runs with
// brittle shapes replay exactly.
import { afterEach, describe, expect, it } from 'vitest';
import { FULL, loadSim } from '../src/adapters/index';
import { Bot, type BotSim } from '../src/bot';
import { loadGameApi } from '../src/game-api';
import { fmt, writeReport } from '../src/report';

const sut = await loadSim();
const game = await loadGameApi(sut);
const has = (key: string) => {
  if (!game) return false;
  const probe = new game.api.Sim({ seed: 1, autoSpawn: false });
  const ok = typeof probe.tuning?.[key] === 'number';
  probe.dispose();
  return ok;
};
const streaky = has('setStreak');
const brittly = has('brittleEvery');

type Ev = { name: string; step: number; payload: Record<string, any> };
type T = Record<string, any>;
const S = (t: T) => t.sim as Record<string, any>;

// gameplay.md §9.1 and §4.3, written out from the doc rather than read from the game's tuning.
const needAt = (n: number) => (n <= 2 ? 0 : n <= 6 ? 3 : 4);
const RESCUE = new Set(['O', 'I', 'Plank']);
const BRITTLE_FROM = 5;
const BRITTLE_GAP = 6;
const FUSE_STEPS = 72;

const live: { dispose(): void }[] = [];
const own = <X>(x: X): X => (live.push(x as unknown as { dispose(): void }), x);
afterEach(() => {
  for (const x of live.splice(0)) x.dispose();
});
/** A test sim at checkpoint n: no claims, no run over, no hazards or bubbles. */
function make(n: number, tuning: Record<string, unknown> = {}, seed = 500 + n): T {
  return own(game!.api.createSim({ engine: sut.engine, seed, startCheckpoint: n, tuning: { firstGap: 1000, infiniteHearts: true, infiniteBudget: true, powerUps: false, gusts: false, lateHazards: false, ...tuning } }) as T);
}
function botRun(seed: number, from: number, tuning: Record<string, unknown>, powers = false): BotSim & Record<string, any> {
  return own(new game!.api.Sim({ seed, startCheckpoint: from, tuning: { mortar: true, infiniteHearts: true, infiniteBudget: true, ...tuning }, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
}
const named = (ev: Ev[], name: string) => ev.filter((e) => e.name === name);

describe.runIf(streaky)(`set streak on ${sut.kind} (${sut.engine})`, () => {
  it('§16.11 rows wait for the set streak from CP 3 (3, then 4 from CP 7) and set together; Messy and lost pieces reset it; Quick-Set ignores it', () => {
    const { shapes } = game!;
    const problems: string[] = [];
    const lines: string[] = [];
    const runs = (FULL ? [[1, 1], [2, 2], [3, 3], [4, 4], [6, 5], [7, 6], [9, 7], [12, 8]] : [[1, 1], [3, 2], [7, 3]]) as [number, number][];
    const totals = { settled: 0, messy: 0, lost: 0, ready: 0, streakSets: 0, quickSets: 0, meadowSets: 0 };
    for (const [from, seed] of runs) {
      for (const powers of [false, true]) {
        const sim = botRun(seed, from, { powerUps: powers }, powers);
        const bot = new Bot({ seed, naturalFall: 0.3, powers }, shapes.extents);
        const bad = (m: string) => problems.length < 24 && problems.push(`from CP ${from} seed ${seed}${powers ? ' with powers' : ''} at ${(sim.stepIndex / 60).toFixed(1)} s: ${m}`);
        let model = 0;
        while (sim.stepIndex < 60 * (FULL ? 300 : 150) && sim.state === 'playing') {
          const claimed = new Set([...sim.pieces.values()].filter((p: any) => p.claimed).map((p: any) => p.id));
          bot.tick(sim);
          sim.step();
          const ev = sim.drainEvents() as Ev[];
          const need = needAt(sim.checkpoint);
          const quick = ev.some((e) => e.name === 'power_used' && e.payload.kind === 'quickset');
          if (quick) totals.quickSets++;
          for (const e of ev) {
            if (e.name === 'piece_settled') {
              totals.settled++;
              if (e.payload.grade === 'messy') totals.messy++;
              model = e.payload.grade === 'messy' ? 0 : model + 1;
            } else if (e.name === 'piece_lost' && !e.payload.brittle && !claimed.has(e.payload.id)) {
              totals.lost++;
              model = 0;
            } else if (e.name === 'set_streak') {
              if (e.payload.need !== need) bad(`set_streak says ${e.payload.need} are needed at CP ${sim.checkpoint}, the doc says ${need}`);
            } else if (e.name === 'row_ready') {
              totals.ready++;
              if (need === 0) bad(`a row waited (row_ready) at CP ${sim.checkpoint}, where rows set at once`);
              if (model >= need) bad(`a row waited with the streak at ${model} of ${need}`);
            } else if (e.name === 'row_solid') {
              if (need === 0) {
                totals.meadowSets++;
                if (e.payload.streak) bad(`a Meadow row_solid says it needed a streak`);
              } else if (e.payload.streak) {
                totals.streakSets++;
                if (model < need) bad(`${e.payload.count} row(s) set with the streak at ${model} of ${need}`);
                model = 0;
              } else if (!quick) bad(`${e.payload.count} row(s) set at CP ${sim.checkpoint} without the streak or Quick-Set`);
            }
          }
          if (sim.streak !== model) {
            bad(`the sim's streak is ${sim.streak} where QA counts ${model} (${ev.filter((e) => /settled|lost|row_|streak|power_used/.test(e.name)).map((e) => `${e.name}${e.payload.grade ? ` ${e.payload.grade}` : ''}`).join(', ')})`);
            model = sim.streak;
          }
        }
        lines.push(`from CP ${from} seed ${seed}${powers ? ' with powers' : ''}: ${(sim.stepIndex / 60).toFixed(0)} s, reached CP ${sim.checkpoint}, ${sim.stats.rows} rows set`);
      }
    }
    lines.push(`${totals.settled} placements (${totals.messy} Messy), ${totals.lost} lost; ${totals.meadowSets} Meadow row sets, ${totals.ready} rows waiting, ${totals.streakSets} streak sets, ${totals.quickSets} Quick-Sets`);
    if (!totals.ready || !totals.streakSets || !totals.meadowSets) problems.push(`setup: the runs never showed a waiting row, a streak set and a Meadow set (${totals.ready}, ${totals.streakSets}, ${totals.meadowSets})`);
    writeReport({ suite: 'set-streak', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], { totals });
    expect(problems).toEqual([]);
  });
});

describe.runIf(brittly)(`brittle shapes on ${sut.kind} (${sut.engine})`, () => {
  it('§16.12 brittle shapes: none before CP 5 or with Hold locked, never two within 6 shapes, never O, I or Plank, never two in play; the preview never changes its mind', () => {
    const { shapes } = game!;
    const problems: string[] = [];
    const lines: string[] = [];
    let dealt = 0;
    let brittle = 0;
    const runs = (FULL ? [[1, 1, true], [3, 2, true], [5, 3, true], [6, 4, true], [8, 5, true], [11, 6, true], [5, 7, false], [9, 8, false]] : [[3, 1, true], [5, 2, true], [8, 3, true], [6, 4, false]]) as [number, number, boolean][];
    for (const [from, seed, hold] of runs) {
      const sim = botRun(seed, from, { holdUnlocked: hold });
      const bot = new Bot({ seed, naturalFall: 0.3 }, shapes.extents);
      const bad = (m: string) => problems.length < 24 && problems.push(`from CP ${from} seed ${seed}${hold ? '' : ' (Hold locked)'} at ${(sim.stepIndex / 60).toFixed(1)} s: ${m}`);
      // Every deal, in order, as the shape first shows in the preview.
      const deals: { shape: string; brittle: boolean; cp: number }[] = [];
      const deal = sim.dealBrittle.bind(sim);
      sim.dealBrittle = (shape: string) => {
        const b = deal(shape);
        deals.push({ shape, brittle: b, cp: sim.checkpoint });
        return b;
      };
      let promised: boolean | null = null;
      while (sim.stepIndex < 60 * (FULL ? 300 : 160) && sim.state === 'playing') {
        bot.tick(sim);
        sim.step();
        const ev = sim.drainEvents() as Ev[];
        // A Hold swap brings in the held shape (its piece_spawned comes before the hold_swap).
        const swapped = ev.some((e) => e.name === 'hold_swap');
        for (const e of ev) {
          if (e.name !== 'piece_spawned') continue;
          if (promised !== null && !swapped && e.payload.brittle !== promised) bad(`the preview showed the next ${e.payload.shape} as ${promised ? '' : 'not '}brittle, then dealt it ${e.payload.brittle ? '' : 'not '}brittle`);
          promised = e.payload.nextBrittle?.[0] ?? null;
        }
        let inPlay = 0;
        if ((sim.ctrl as { brittle?: boolean } | null)?.brittle) inPlay++;
        if (sim.held !== null && sim.heldBrittle) inPlay++;
        inPlay += (sim.queueBrittle as boolean[]).filter((b) => b).length;
        for (const p of sim.pieces.values() as Iterable<any>) if (p.brittle && p.state !== 'lost' && p.state !== 'stone') inPlay++;
        if (inPlay > 1) bad(`${inPlay} brittle shapes in play at once`);
      }
      let since = Infinity;
      for (const d of deals) {
        if (d.cp >= BRITTLE_FROM && hold) dealt++;
        if (!d.brittle) { since++; continue; }
        brittle++;
        if (d.cp < BRITTLE_FROM) bad(`a brittle ${d.shape} was dealt at CP ${d.cp}`);
        if (!hold) bad(`a brittle ${d.shape} was dealt with Hold locked`);
        if (RESCUE.has(d.shape)) bad(`a brittle ${d.shape} was dealt`);
        if (since < BRITTLE_GAP) bad(`two brittle shapes were dealt with only ${since} shapes between them`);
        since = 0;
      }
      lines.push(`from CP ${from} seed ${seed}${hold ? '' : ' (Hold locked)'}: ${deals.length} shapes dealt, ${deals.filter((d) => d.brittle).length} brittle, reached CP ${sim.checkpoint}`);
    }
    lines.push(`from CP 5 with Hold open: ${brittle} brittle of ${dealt} dealt (1 in ${fmt(dealt / Math.max(1, brittle), 1)}; the doc says about 1 in 15)`);
    if (!brittle) problems.push('setup: no brittle shape was dealt');
    writeReport({ suite: 'brittle-deal', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });

  it('§16.13 a brittle shape holds 8 cells, breaks under 12 about 1.2 s after the third shape lands, and never once it is stone', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    for (const mortar of [false, true]) {
      const t = make(5, { mortar });
      const top = S(t).foundation.top;
      const id = t.placePiece({ shape: 'O', x: 0, y: top + 1, brittle: true });
      t.step(90);
      const ev: Ev[] = [];
      const stack = (k: number) => {
        t.placePiece({ shape: 'O', x: 0, y: top + 1 + 2 * k });
        for (let i = 0; i < 120; i++) { t.step(); ev.push(...(t.drainEvents() as Ev[])); }
      };
      stack(1);
      stack(2);
      for (let i = 0; i < 300; i++) { t.step(); ev.push(...(t.drainEvents() as Ev[])); }
      const two = S(t).pieces.get(id);
      const where = `Mortar ${mortar ? 'on' : 'off'}`;
      if (!two || two.state === 'lost' || named(ev, 'brittle_broke').length) problems.push(`${where}: it broke under two O pieces (8 cells)`);
      else lines.push(`${where}: under 8 cells it holds for 7 s at stage ${two.strain}, load ${two.load}`);
      const before = ev.length;
      t.placePiece({ shape: 'O', x: 0, y: top + 7 });
      for (let i = 0; i < 400 && !named(ev.slice(before), 'brittle_broke').length; i++) { t.step(); ev.push(...(t.drainEvents() as Ev[])); }
      const late = ev.slice(before);
      const creak = late.find((e) => e.name === 'brittle_strain' && e.payload.stage === 3 && e.payload.id === id);
      const broke = late.find((e) => e.name === 'brittle_broke' && e.payload.id === id);
      if (!creak || !broke) problems.push(`${where}: under 12 cells it ${creak ? 'creaked but never broke' : 'never creaked'}`);
      else {
        const wait = broke.step - creak.step;
        lines.push(`${where}: under 12 cells it creaked, then broke ${fmt(wait / 60, 2)} s later, dropping ${broke.payload.above.length} pieces`);
        if (Math.abs(wait - FUSE_STEPS) > 6) problems.push(`${where}: it broke ${wait} steps after creaking, not 1.2 s (72)`);
      }
    }
    // Stone: Quick-Set mends it, and then nothing on it breaks it.
    const t = make(5, { mortar: true, powerUps: true });
    const top = S(t).foundation.top;
    const id = t.placePiece({ shape: 'O', x: 0, y: top + 1, brittle: true });
    t.step(90);
    t.drainEvents();
    S(t).slots[0] = 'quickset';
    t.intent({ type: 'power', slot: 0 });
    const mended = named(t.drainEvents() as Ev[], 'brittle_mended').find((e) => e.payload.id === id);
    if (!mended) problems.push('Quick-Set did not mend the brittle shape');
    const ev: Ev[] = [];
    for (let k = 1; k <= 4; k++) {
      t.placePiece({ shape: 'O', x: 0, y: top + 1 + 2 * k });
      for (let i = 0; i < 120; i++) { t.step(); ev.push(...(t.drainEvents() as Ev[])); }
    }
    for (let i = 0; i < 300; i++) { t.step(); ev.push(...(t.drainEvents() as Ev[])); }
    const p = S(t).pieces.get(id);
    if (!p || p.state !== 'stone' || named(ev, 'brittle_broke').length || named(ev, 'brittle_strain').length) problems.push(`once stone it strained or broke under 16 cells (state ${p?.state})`);
    else lines.push(`mended by Quick-Set (+${mended?.payload.points}), it carries 16 cells for 13 s as stone`);
    writeReport({ suite: 'brittle-load', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });

  it('§16.14 a brittle shape lost off the tower costs no heart, gives its brick back and keeps the set streak; an ordinary one costs all three', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    for (const brittle of [true, false]) {
      const t = make(5, { infiniteHearts: false, infiniteBudget: false }, 77);
      const s = S(t);
      t.placePiece({ shape: 'O', x: 0, y: s.foundation.top + 1 });
      t.step(90);
      s.streak = 2;
      t.drainEvents();
      const hearts = t.hearts;
      const used = t.budget.used;
      t.spawnControlled({ shape: 'T', x: s.foundation.x + s.foundation.width / 2 + 3, brittle });
      t.intent({ type: 'hardDrop' });
      const ev: Ev[] = [];
      for (let i = 0; i < 900 && !named(ev, 'piece_lost').length; i++) { t.step(); ev.push(...(t.drainEvents() as Ev[])); }
      for (let i = 0; i < 180; i++) { t.step(); ev.push(...(t.drainEvents() as Ev[])); }
      const lost = named(ev, 'piece_lost')[0];
      const what = brittle ? 'brittle T' : 'ordinary T';
      if (!lost) { problems.push(`setup: the ${what} dropped off the side was never lost`); continue; }
      const got = { hearts: t.hearts - hearts, bricks: t.budget.used - used, streak: s.streak, flag: lost.payload.brittle, tossed: named(ev, 'brittle_tossed').length };
      lines.push(`${what} lost off the side: hearts ${got.hearts}, bricks used ${got.bricks >= 0 ? '+' : ''}${got.bricks}, streak ${got.streak}, piece_lost brittle ${got.flag}, brittle_tossed ${got.tossed}`);
      if (brittle && (got.hearts !== 0 || got.bricks !== 0 || got.streak !== 2 || !got.flag || got.tossed !== 1)) problems.push(`the brittle T lost off the side was not free: ${JSON.stringify(got)}`);
      if (!brittle && (got.hearts !== -1 || got.bricks !== 1 || got.streak !== 0 || got.flag)) problems.push(`the ordinary T lost off the side did not cost a heart, a brick and the streak: ${JSON.stringify(got)}`);
    }
    writeReport({ suite: 'brittle-toss', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });

  it('F3.6 runs with brittle shapes replay exactly; the brittle stream leaves the shape bag alone', () => {
    const { api, shapes } = game!;
    const problems: string[] = [];
    const lines: string[] = [];
    for (const [from, seed] of (FULL ? [[5, 11], [7, 12], [10, 13], [14, 14]] : [[5, 11], [8, 12]]) as [number, number][]) {
      const sim = own(new api.Sim({ seed, startCheckpoint: from, tuning: { mortar: true }, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
      const bot = new Bot({ seed, naturalFall: 0.3 }, shapes.extents);
      const digests: string[] = [];
      let events = 0;
      while (sim.stepIndex < 60 * (FULL ? 240 : 120) && sim.state === 'playing') {
        bot.tick(sim);
        sim.step();
        events += (sim.drainEvents() as Ev[]).filter((e) => e.name.startsWith('brittle_')).length;
        if (sim.stepIndex % 60 === 0) digests.push(sim.digest());
      }
      const rec = { seed, tuning: { mortar: true }, startCheckpoint: from, rookieOpening: false, inputs: sim.inputLog.map((x: any) => ({ s: x.s, i: { ...x.i } })), steps: sim.stepIndex };
      const r = api.replay(rec);
      const first = digests.findIndex((d, i) => d !== r.digests[i]);
      const same = first === -1 && r.sim.digest() === sim.digest();
      lines.push(`from CP ${from} seed ${seed}: ${(sim.stepIndex / 60).toFixed(0)} s, ${sim.stats.brittle} brittle dealt, ${events} brittle events; replay ${same ? 'MATCH' : `MISMATCH from second ${first + 1}`}`);
      if (!same) problems.push(`from CP ${from} seed ${seed}: replay differs from second ${first + 1}`);
      r.sim.dispose();
    }
    // The bag: with brittle shapes on and off, the same seed deals the same shapes in the same stretch.
    const bag = (every: number) => {
      const sim = own(new api.Sim({ seed: 21, startCheckpoint: 5, tuning: { brittleEvery: every, mortar: true, infiniteHearts: true }, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
      const bot = new Bot({ seed: 21, naturalFall: 0.3 }, shapes.extents);
      const out: string[] = [];
      let last: unknown = null;
      while (sim.stepIndex < 60 * 200 && sim.state === 'playing' && sim.checkpoint === 5) {
        bot.tick(sim);
        sim.step();
        if (sim.ctrl && sim.ctrl !== last) { last = sim.ctrl; out.push(sim.ctrl.shape); }
      }
      return { out, brittle: sim.stats.brittle };
    };
    const on = bag(12);
    const off = bag(0);
    const n = Math.min(on.out.length, off.out.length);
    const diff = on.out.slice(0, n).findIndex((s, i) => s !== off.out[i]);
    lines.push(`bag from CP 5, seed 21: ${n} shapes compared, ${on.brittle} brittle with them on; ${diff === -1 ? 'same order' : `differs at shape ${diff + 1}`}`);
    if (diff !== -1) problems.push(`brittle shapes changed the bag at shape ${diff + 1} (${on.out[diff]} vs ${off.out[diff]})`);
    if (n < 20 || !on.brittle) problems.push(`setup: only ${n} shapes compared, ${on.brittle} brittle`);
    writeReport({ suite: 'brittle-replays', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });
});
