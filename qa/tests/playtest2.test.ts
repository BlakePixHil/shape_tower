// Blake's 11:29 playtest (#51), gameplay.md §16 items 15 to 17: a new shape's start wait (§8.1), wider
// slabs early (§7.3), and the shapes-left warnings (§7.2). Game only, on builds whose tuning has
// startWait and slabBoost. A new shape waits 1.5 s, 1.0 s, 0.5 s at the top in the first three
// stretches and steers while it waits; a drop ends the wait for good. A claim's slab is never narrower
// than 10, 10, 9, 9, 8, 8, 7, 7, then 6, never wider than its stretch's widest (12 to 8), Zen always
// gets the widest, and the grade doesn't change (bigger platforms, 2026-10-22). budget_low fires at 5, 3 and 1 left after
// a landing or a miss; bricks_out fires once when the last shape is used, and the run ends on bricks.
import { afterEach, describe, expect, it } from 'vitest';
import { FULL, loadSim } from '../src/adapters/index';
import { Bot, type BotSim } from '../src/bot';
import { loadGameApi } from '../src/game-api';
import { fmt, writeReport } from '../src/report';

const sut = await loadSim();
const game = await loadGameApi(sut);
const defaults: Record<string, any> = (() => {
  if (!game) return {};
  const probe = new game.api.Sim({ seed: 1, autoSpawn: false });
  const t = { ...probe.tuning };
  probe.dispose();
  return t;
})();
const waity = typeof defaults.startWait === 'number';
const wide = typeof defaults.slabBoost === 'number';

type Ev = { name: string; step: number; payload: Record<string, any> };
type T = Record<string, any>;
const S = (t: T) => t.sim as Record<string, any>;

// gameplay.md §8.1, §7.3 and §7.2, written out from the doc rather than read from the game's tuning.
const waitAt = (n: number) => [1.5, 1.0, 0.5][n - 1] ?? 0;
const minSlabAt = (n: number) => (n <= 2 ? 10 : n <= 4 ? 9 : n <= 6 ? 8 : n <= 8 ? 7 : 6);
/** The widest slab of stretch n (§7.3); a claim at checkpoint n lays the foundation of stretch n + 1. */
const maxSlabFor = (n: number) => (n <= 6 ? 12 : n <= 10 ? 11 : n <= 16 ? 10 : n <= 22 ? 9 : 8);
const PLINTH = 12;
const WARN_AT = new Set([5, 3, 1]);
const GRACE = 3;

const live: { dispose(): void }[] = [];
const own = <X>(x: X): X => (live.push(x as unknown as { dispose(): void }), x);
afterEach(() => {
  for (const x of live.splice(0)) x.dispose();
});
/** A test sim at checkpoint n: no hazards, power-ups or bubbles; the line far away unless asked. */
function make(n: number, tuning: Record<string, unknown> = {}, opts: Record<string, unknown> = {}, seed = 600 + n): T {
  return own(game!.api.createSim({ engine: sut.engine, seed, startCheckpoint: n, ...opts, tuning: { firstGap: 1000, infiniteHearts: true, infiniteBudget: true, powerUps: false, gusts: false, lateHazards: false, ...tuning } }) as T);
}
const named = (ev: Ev[], name: string) => ev.filter((e) => e.name === name);
const run = (t: T, steps: number, into?: Ev[]) => {
  for (let i = 0; i < steps; i++) { t.step(); const ev = t.drainEvents() as Ev[]; into?.push(...ev); }
};

describe.runIf(waity)(`start wait on ${sut.kind} (${sut.engine})`, () => {
  it('§16.15 a new shape waits 1.5 s, 1.0 s, 0.5 s at the top in stretches 1 to 3 and not from CP 4; it steers and turns while it waits; a soft or hard drop ends the wait for good', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    for (const n of FULL ? [1, 2, 3, 4, 5, 8] : [1, 2, 3, 4]) {
      const want = Math.round(waitAt(n) * 60);
      // 1. Left alone: it sits still for the wait, then falls.
      {
        const t = make(n);
        const s = S(t);
        t.spawnControlled({ shape: 'T', wait: true });
        const spawned = named(t.drainEvents() as Ev[], 'piece_spawned')[0];
        if (!spawned || Math.abs(Number(spawned.payload.wait) - waitAt(n)) > 1e-6) problems.push(`CP ${n}: piece_spawned says wait ${spawned?.payload.wait}, the doc says ${waitAt(n)} s`);
        const y0 = s.ctrl.y;
        let still = 0;
        for (let i = 0; i < want + 30 && s.ctrl && s.ctrl.y === y0; i++) { t.step(); t.drainEvents(); if (s.ctrl?.y === y0) still++; }
        if (Math.abs(still - want) > 1) problems.push(`CP ${n}: the shape sat still for ${still} steps, not ${want} (${waitAt(n)} s)`);
        else lines.push(`CP ${n}: a new T sits still for ${fmt(still / 60, 2)} s, then falls (doc ${waitAt(n)} s)`);
      }
      if (!want) continue;
      // 2. Steering and turning while it waits: it moves and turns, but doesn't drop.
      {
        const t = make(n);
        const s = S(t);
        t.spawnControlled({ shape: 'T', wait: true });
        const y0 = s.ctrl.y;
        const x0 = s.ctrl.x;
        const r0 = s.ctrl.rot;
        run(t, 10);
        t.intent({ type: 'moveTo', x: x0 + 2 });
        run(t, 2);
        t.intent({ type: 'rotate', dir: 1 });
        run(t, 2);
        const c = s.ctrl;
        if (!c || c.x === x0 || c.rot === r0 || c.y !== y0 || !s.waiting) problems.push(`CP ${n}: while waiting, steering and a turn gave x ${c?.x} (from ${x0}), rot ${c?.rot} (from ${r0}), y ${c?.y} (from ${y0}), waiting ${s.waiting}`);
      }
      // 3. A soft drop ends the wait, and letting go doesn't park it again.
      {
        const t = make(n);
        const s = S(t);
        t.spawnControlled({ shape: 'T', wait: true });
        const y0 = s.ctrl.y;
        run(t, 10);
        t.intent({ type: 'softDrop', on: true });
        run(t, 3);
        t.intent({ type: 'softDrop', on: false });
        const ys: number[] = [];
        for (let i = 0; i < 20 && s.ctrl; i++) { run(t, 1); if (s.ctrl) ys.push(s.ctrl.y); }
        const falling = ys.length > 5 && ys.every((y, i) => y < (i ? ys[i - 1] : y0));
        if (!falling || s.waiting) problems.push(`CP ${n}: after a soft drop in the wait and letting go, it ${falling ? 'fell' : 'stopped'} (waiting ${s.waiting})`);
      }
      // 4. A hard drop in the wait brings it straight down.
      {
        const t = make(n);
        const s = S(t);
        t.spawnControlled({ shape: 'T', wait: true });
        run(t, 10);
        t.intent({ type: 'hardDrop' });
        const ev: Ev[] = [];
        for (let i = 0; i < 60 && !named(ev, 'piece_landed').length; i++) run(t, 1, ev);
        const landedAt = ev.find((e) => e.name === 'piece_landed')?.step;
        if (landedAt === undefined) problems.push(`CP ${n}: a hard drop in the wait didn't land within 1 s`);
        else if (s.ctrl && s.waiting) problems.push(`CP ${n}: still waiting after a hard drop`);
      }
    }
    // In real runs: every new shape's wait matches its stretch, and it never moves down while it waits.
    const { shapes } = game!;
    const counts = { spawned: 0, waitedOut: 0, dropped: 0 };
    for (const [from, seed] of (FULL ? [[1, 1], [2, 2], [3, 3], [4, 4], [6, 5]] : [[1, 1], [3, 2]]) as [number, number][]) {
      const sim = own(new game!.api.Sim({ seed, startCheckpoint: from, tuning: { mortar: true, infiniteHearts: true, infiniteBudget: true }, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
      const bot = new Bot({ seed, naturalFall: 0.3 }, shapes.extents);
      let cur: { c: unknown; y: number; waited: number } | null = null;
      while (sim.stepIndex < 60 * (FULL ? 240 : 120) && sim.state === 'playing') {
        bot.tick(sim);
        sim.step();
        const ev = sim.drainEvents() as Ev[];
        const lifted = ev.some((e) => e.name === 'piece_lifted');
        for (const e of named(ev, 'piece_spawned')) {
          counts.spawned++;
          const want = waitAt(sim.checkpoint);
          if (Math.abs(Number(e.payload.wait) - want) > 1e-6 && problems.length < 24) problems.push(`from CP ${from} seed ${seed}: a shape spawned at CP ${sim.checkpoint} with wait ${e.payload.wait}, the doc says ${want} s`);
        }
        const c = sim.ctrl as { y: number } | null;
        if (!c) { cur = null; continue; }
        if (!cur || cur.c !== c) cur = { c, y: c.y, waited: 0 };
        if (sim.waiting) {
          cur.waited++;
          if (c.y !== cur.y && !lifted && problems.length < 24) problems.push(`from CP ${from} seed ${seed}: a waiting shape moved down from ${cur.y} to ${c.y} at CP ${sim.checkpoint}`);
        } else if (cur.waited && cur.waited >= Math.round(waitAt(sim.checkpoint) * 60) - 1) { counts.waitedOut++; cur.waited = 0; }
        cur.y = c.y;
      }
    }
    lines.push(`bot runs: ${counts.spawned} shapes spawned, ${counts.waitedOut} waited out their full start wait; none moved down while waiting`);
    if (!counts.waitedOut) problems.push('setup: no shape in the bot runs waited out its start wait');
    writeReport({ suite: 'start-wait', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], { counts });
    expect(problems).toEqual([]);
  });
});

describe.runIf(wide)(`slab minimums on ${sut.kind} (${sut.engine})`, () => {
  it('§16.16 a claim\'s new slab is never narrower than 10 at CP 1-2, 9 at CP 3-4, 8 at CP 5-6, 7 at CP 7-8 and 6 after, never wider than its stretch allows, the widest in Zen, and the grade is unchanged; the plinth is 12', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    /** A one-O-wide stone column up to the line, held until the claim. */
    const claimWith = (n: number, boost: number, zen = false) => {
      // Disposed here rather than in afterEach: three dozen worlds at once run Box2D out of memory.
      const t = game!.api.createSim({ engine: sut.engine, seed: 600 + n, startCheckpoint: n, tuning: { firstGap: defaults.firstGap, infiniteHearts: true, infiniteBudget: true, powerUps: false, gusts: false, lateHazards: false, slabBoost: boost, ...(zen ? { zen: true } : {}) } }) as T;
      const s = S(t);
      if (s.foundation.width !== PLINTH) problems.push(`CP ${n}: the plinth is ${s.foundation.width} wide, the doc says ${PLINTH}`);
      const top = s.foundation.top;
      for (let k = 0; top + 2 * k < s.lineY; k++) t.placePiece({ shape: 'O', x: s.foundation.x, y: top + 1 + 2 * k, as: 'stone' });
      const ev: Ev[] = [];
      for (let i = 0; i < 600 && !named(ev, 'checkpoint_claimed').length; i++) run(t, 1, ev);
      const c = named(ev, 'checkpoint_claimed')[0];
      const out = c ? { width: Number(c.payload.width), grade: String(c.payload.grade), coverage: Number(c.payload.coverage), slab: s.foundation.width as number } : null;
      t.dispose();
      return out;
    };
    for (const n of FULL ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 22, 23] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 22]) {
      const boosted = claimWith(n, defaults.slabBoost);
      const plain = claimWith(n, 0);
      const zen = claimWith(n, defaults.slabBoost, true);
      if (!boosted || !plain || !zen) { problems.push(`setup: the column at CP ${n} never claimed`); continue; }
      lines.push(`CP ${n}: a 2-wide column claims grade ${boosted.grade} (coverage ${boosted.coverage}) and gets a ${boosted.width}-wide slab (doc minimum ${minSlabAt(n)}); without the boost ${plain.width} wide, grade ${plain.grade}; in Zen ${zen.width} wide (doc widest ${maxSlabFor(n + 1)}), grade ${zen.grade}`);
      if (zen.width !== maxSlabFor(n + 1)) problems.push(`CP ${n}: Zen's slab is ${zen.width} wide, the doc says always the widest, ${maxSlabFor(n + 1)}`);
      if (zen.grade !== boosted.grade) problems.push(`CP ${n}: Zen's widest slab changed the grade (${boosted.grade} -> ${zen.grade})`);
      if (boosted.width !== minSlabAt(n)) problems.push(`CP ${n}: the narrowest slab is ${boosted.width}, the doc says ${minSlabAt(n)}`);
      if (boosted.slab !== boosted.width) problems.push(`CP ${n}: checkpoint_claimed says width ${boosted.width}, the new foundation is ${boosted.slab}`);
      if (boosted.grade !== plain.grade || boosted.coverage !== plain.coverage) problems.push(`CP ${n}: the wider minimum changed the grade (${plain.grade} -> ${boosted.grade}) or coverage (${plain.coverage} -> ${boosted.coverage})`);
    }
    // In real runs no claim's slab is narrower than the doc's minimum for its checkpoint.
    const { shapes } = game!;
    let claims = 0;
    for (const [from, seed] of (FULL ? [[1, 1], [3, 2], [5, 3], [7, 4]] : [[1, 1], [4, 2]]) as [number, number][]) {
      const sim = own(new game!.api.Sim({ seed, startCheckpoint: from, tuning: { mortar: true, infiniteHearts: true, infiniteBudget: true }, autoSpawn: true, rookieOpening: false })) as BotSim & Record<string, any>;
      const bot = new Bot({ seed, naturalFall: 0.3 }, shapes.extents);
      while (sim.stepIndex < 60 * (FULL ? 300 : 150) && sim.state === 'playing') {
        bot.tick(sim);
        sim.step();
        for (const e of named(sim.drainEvents() as Ev[], 'checkpoint_claimed')) {
          claims++;
          const n = Number(e.payload.n);
          if (Number(e.payload.width) < minSlabAt(n)) problems.push(`from CP ${from} seed ${seed}: the CP ${n} claim gave a ${e.payload.width}-wide slab, under the doc's ${minSlabAt(n)}`);
          if (Number(e.payload.width) > maxSlabFor(n + 1)) problems.push(`from CP ${from} seed ${seed}: the CP ${n} claim gave a ${e.payload.width}-wide slab, over the doc's ${maxSlabFor(n + 1)}`);
        }
      }
    }
    lines.push(`bot runs: ${claims} claims, none under the minimum or over the widest`);
    if (!claims) problems.push('setup: the bot runs never claimed');
    writeReport({ suite: 'slab-minimum', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });
});

describe.runIf(waity)(`shapes-left warnings on ${sut.kind} (${sut.engine})`, () => {
  it('§16.17 budget_low fires at 5, 3 and 1 left whether the shape landed or missed; bricks_out fires once when the last shape is used; the run ends on bricks', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    // L lands on the tower, M misses it off the side. Each pattern puts a landing and a miss on each warning.
    for (const pattern of ['LMLLMML', 'MLMMLLM']) {
      const t = make(1, { infiniteBudget: false }, {}, 91);
      const s = S(t);
      const budget = s.budget as number;
      s.used = budget - pattern.length;
      const ev: Ev[] = [];
      const warned: string[] = [];
      for (const move of pattern) {
        const before = budget - s.used;
        const f = s.foundation;
        t.spawnControlled({ shape: 'T', x: move === 'L' ? f.x : f.x + f.width / 2 + 3 });
        t.intent({ type: 'hardDrop' });
        const from = ev.length;
        for (let i = 0; i < 300 && s.ctrl; i++) run(t, 1, ev);
        run(t, 20, ev);
        const mine = ev.slice(from);
        const lows = named(mine, 'budget_low');
        const left = budget - s.used;
        const kind = move === 'L' ? 'landing' : 'miss';
        const landed = named(mine, 'piece_landed').length > 0;
        if (landed !== (move === 'L')) problems.push(`${pattern}: setup: the T meant as a ${kind} ${landed ? 'landed' : 'missed'}`);
        if (left !== before - 1) problems.push(`${pattern}: a ${kind} with ${before} left left ${left}`);
        if (WARN_AT.has(left)) {
          if (lows.length !== 1 || lows[0].payload.left !== left) problems.push(`${pattern}: a ${kind} down to ${left} left gave ${lows.length} budget_low (${lows.map((e) => e.payload.left).join(', ')}), the doc says one at ${left}`);
          else warned.push(`${left} after a ${kind}`);
        } else if (lows.length) problems.push(`${pattern}: budget_low fired at ${lows.map((e) => e.payload.left).join(', ')} after a ${kind} down to ${left}`);
      }
      // Hand the run back to the sim's own spawning: with no shapes left it starts the grace.
      s.autoSpawn = true;
      // The last shape is used: bricks_out once, then the run ends on bricks after the grace.
      const out: Ev[] = [];
      for (let i = 0; i < 60 * 8 && s.state === 'playing'; i++) run(t, 1, out);
      const bo = named([...ev, ...out], 'bricks_out');
      const over = named(out, 'run_over')[0];
      if (bo.length !== 1) problems.push(`${pattern}: bricks_out fired ${bo.length} times`);
      else if (Number(bo[0].payload.grace) !== GRACE) problems.push(`${pattern}: bricks_out says grace ${bo[0].payload.grace} s, the doc says ${GRACE}`);
      if (!over || over.payload.cause !== 'bricks' || s.cause !== 'bricks') problems.push(`${pattern}: the run ended with ${over ? `cause ${over.payload.cause}` : 'no run_over'}`);
      else if (bo.length === 1) {
        const wait = (over.step - bo[0].step) / 60;
        if (Math.abs(wait - GRACE) > 0.1) problems.push(`${pattern}: the run ended ${fmt(wait, 2)} s after bricks_out, not ${GRACE} s`);
        lines.push(`${pattern}: warnings at ${warned.join(', ')}; bricks_out once (grace ${bo[0].payload.grace} s), run over on bricks ${fmt(wait, 2)} s later`);
      }
    }
    writeReport({ suite: 'shapes-left', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });
});
