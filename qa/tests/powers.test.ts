// Power-ups and Second Wind, qa-section.md F18 (gameplay.md §13). Game only, from build 81540e9.
// Each power's effect and its refusal, bubbles, picks, grants, Second Wind, physics under powers,
// rule checks over whole bot runs, and exact replays of runs that use powers.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FULL, REPO_ROOT, loadSim } from '../src/adapters/index';
import { Bot, type BotSim } from '../src/bot';
import { loadGameApi } from '../src/game-api';
import { knownIssue } from '../src/known-issues';
import { MAX_UPWARD_SPEED } from '../src/measure';
import { fmt, pct, writeReport } from '../src/report';
import { CORE_SHAPES } from '../src/shapes';

const sut = await loadSim();
const game = await loadGameApi(sut);

type Ev = { name: string; step: number; payload: Record<string, any> };
type T = Record<string, any>;
const S = (t: T) => t.sim as Record<string, any>;

// Box2D has a fixed number of world slots, so every sim a test makes is disposed after it.
const live: { dispose(): void }[] = [];
const own = <X>(x: X): X => (live.push(x as unknown as { dispose(): void }), x);
afterEach(() => {
  for (const x of live.splice(0)) x.dispose();
});
/** A test sim: no claims, no run over from hearts, and no bubbles unless asked for. */
function make(tuning: Record<string, unknown> = {}, opts: Record<string, unknown> = {}): T {
  return own(game!.api.createSim({ engine: sut.engine, seed: 7, tuning: { firstGap: 1000, infiniteHearts: true, powerUps: false, ...tuning }, ...opts }) as T);
}
/** A game Sim with auto spawn, for bot runs; disposed after the test like the rest. */
function makeRun(opts: Record<string, unknown>): any {
  return own(new game!.api.Sim({ autoSpawn: true, rookieOpening: false, ...opts }));
}
const drain = (t: T, log?: Ev[]): Ev[] => {
  const e = t.drainEvents() as Ev[];
  log?.push(...e);
  return e;
};
/** Hard-drops a shape and returns its piece id once it has landed (-1 if it was Lost). */
function drop(t: T, shape: string, x: number, rot = 0, log?: Ev[]): number {
  t.spawnControlled({ shape, x, rot });
  t.intent({ type: 'hardDrop' });
  for (let i = 0; i < 600 && S(t).ctrl; i++) t.step();
  const landed = drain(t, log).find((e) => e.name === 'piece_landed');
  return landed ? (landed.payload.id as number) : -1;
}
const use = (t: T, slot: number, log?: Ev[]) => {
  t.intent({ type: 'power', slot });
  return drain(t, log);
};
const give = (t: T, slot: number, kind: string) => (S(t).slots[slot] = kind);
const named = (ev: Ev[], name: string) => ev.filter((e) => e.name === name);
const loose = (t: T) => [...S(t).pieces.values()].filter((p: any) => !p.claimed && p.state !== 'stone' && p.state !== 'lost');
const ids = (t: T) => new Set((S(t).pieceViews() as { id: number }[]).map((v) => v.id));
/** Fastest any piece except the steered shape moves over `steps`, and the most it moves upward. */
function watch(t: T, steps: number, only?: Set<number>): { fastest: number; maxUp: number } {
  let fastest = 0;
  let maxUp = 0;
  for (let i = 0; i < steps; i++) {
    t.step();
    for (const v of S(t).pieceViews() as { id: number; state: string; vx: number; vy: number }[]) {
      if (v.state === 'controlled' || v.state === 'lost' || (only && !only.has(v.id))) continue;
      fastest = Math.max(fastest, Math.hypot(v.vx, v.vy));
      maxUp = Math.max(maxUp, v.vy);
    }
  }
  return { fastest, maxUp };
}
/** Drops O pieces at x until the next checkpoint is claimed; returns that step's events. */
function claimWith(t: T, xs: number[], log: Ev[]): Ev[] {
  for (const x of xs) drop(t, 'O', S(t).foundation.x + x, 0, log);
  for (let i = 0; i < 600; i++) {
    t.step();
    const ev = drain(t, log);
    if (named(ev, 'checkpoint_claimed').length) return ev;
  }
  throw new Error('no claim');
}

/**
 * Where a bubble may be (gameplay.md §13.1, from game/power-fixes; 2026-10-22 for the bigger
 * platforms): beside the foundation, 1 or 1.5 blocks out from its edge, at most 1.25 out on slabs 8
 * wide or more and at most 5.25 from its centre on narrower ones. Never over the foundation, however
 * wide. Null when it is.
 */
function besideFoundation(x: number, f: { x: number; width: number }): string | null {
  const d = Math.abs(x - f.x);
  const near = f.width / 2 + 1;
  const far = f.width >= 8 ? f.width / 2 + 1.25 : Math.min(f.width / 2 + 1.5, 5.25);
  if (Math.abs(d - near) < 1e-9 || Math.abs(d - far) < 1e-9) return null;
  return `x ${fmt(x - f.x, 2)} from the centre of a ${f.width}-wide foundation, not ±${near} or ±${far}`;
}

describe.runIf(game?.powers)(`power-ups on ${sut.kind} (${sut.engine})`, () => {
  it('F18.1 Clean Slate sweeps every loose piece of the stretch and refunds its bricks; refused with nothing loose', () => {
    const t = make();
    const problems: string[] = [];
    give(t, 0, 'clean');
    const refused = use(t, 0);
    if (!named(refused, 'power_refused').length || S(t).slots[0] !== 'clean') problems.push('with nothing loose it was not refused, or it left the slot');
    const dropped = [drop(t, 'O', -2), drop(t, 'T', 1), drop(t, 'I', -1, 0)];
    t.step(120);
    const stone = t.placePiece({ shape: 'O', x: 3, y: S(t).foundation.top + 1, as: 'stone' });
    drain(t);
    const usedBefore = S(t).used;
    t.spawnControlled({ shape: 'L', x: 0 });
    const ghostBefore = t.ghost().y;
    const ev = use(t, 0);
    const used = named(ev, 'power_used')[0];
    const now = ids(t);
    if (!used || used.payload.pieces?.length !== 3) problems.push(`power_used should list the 3 loose pieces, got ${JSON.stringify(used?.payload.pieces?.length)}`);
    if (dropped.some((id) => now.has(id))) problems.push('a loose piece is still in the world');
    if (!now.has(stone)) problems.push('the stone piece was swept');
    if (S(t).used !== usedBefore - 3) problems.push(`bricks used went ${usedBefore} -> ${S(t).used}, expected ${usedBefore - 3}`);
    if (S(t).slots[0] !== null) problems.push('the slot was not emptied');
    if (!S(t).ctrl || S(t).ctrl.shape !== 'L') problems.push('the shape in hand was touched');
    if (!(t.ghost().y < ghostBefore)) problems.push(`the guide did not drop to the cleared tower (${ghostBefore} -> ${t.ghost().y})`);
    writeReport({ suite: 'power-clean', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', problems.length ? problems : ['Clean Slate refused with nothing loose; swept 3 loose pieces, kept stone and the shape in hand, refunded 3 bricks'], {});
    expect(problems).toEqual([]);
  });

  it('F18.1 Clean Slate keeps pieces of claimed stretches', () => {
    const t = make({ firstGap: 2, gapGrowth: 0 });
    const log: Ev[] = [];
    claimWith(t, [-1], log);
    t.step(120);
    const claimed = [...S(t).pieces.values()].filter((p: any) => p.claimed).map((p: any) => p.id);
    const fresh = drop(t, 'O', S(t).foundation.x, 0, log);
    t.step(60);
    give(t, 0, 'clean');
    use(t, 0, log);
    const now = ids(t);
    const problems: string[] = [];
    if (!claimed.length) problems.push('setup: nothing was claimed');
    if (claimed.some((id: number) => !now.has(id))) problems.push('a piece from the claimed stretch was swept');
    if (now.has(fresh)) problems.push('the loose piece above the claim stayed');
    expect(problems).toEqual([]);
  });

  it('F18.2 Quick-Set turns everything resting to stone, leaves free fall and the hand alone, counts rows; refused with nothing resting', () => {
    // The F3.8 row below is 8 wide, so it pins the plinth it was drawn for (12 since 2026-10-22).
    const t = make({ plinthWidth: 8 });
    const problems: string[] = [];
    give(t, 0, 'quickset');
    if (!named(use(t, 0), 'power_refused').length || S(t).slots[0] !== 'quickset') problems.push('with nothing resting it was not refused, or it left the slot');
    const top = S(t).foundation.top;
    // The F3.8 Solid Row (J, L, O) placed loose, plus a T just landed and an O in mid-air.
    const row = [t.placePiece({ shape: 'J', x: -2.5, y: top + 1 }), t.placePiece({ shape: 'L', x: 0.5, y: top + 1 }), t.placePiece({ shape: 'O', x: 3, y: top + 1 })];
    t.step(30);
    const flying = t.placePiece({ shape: 'O', x: 0, y: top + 12 });
    t.step(2);
    t.spawnControlled({ shape: 'S', x: 0 });
    const ev = use(t, 0);
    const state = (id: number) => S(t).pieces.get(id)?.state;
    if (!named(ev, 'power_used').length) problems.push('Quick-Set was not used');
    if (row.some((id) => state(id) !== 'stone')) problems.push(`row pieces should be stone: ${row.map(state).join(', ')}`);
    if (state(flying) === 'stone') problems.push('a piece in free fall turned to stone');
    if (!S(t).ctrl || S(t).ctrl.shape !== 'S') problems.push('the shape in hand was touched');
    if (!named(ev, 'row_solid').length) problems.push('the completed row did not count as a Solid Row');
    writeReport({ suite: 'power-quickset', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', problems.length ? problems : ['Quick-Set refused with nothing resting; turned the resting row to stone and scored it as a Solid Row; the falling O and the shape in hand stayed as they were'], {});
    expect(problems).toEqual([]);
  });

  it('F18.2 F3.8 nothing gets a kick after Quick-Set, Mortar on', () => {
    const t = make({ mortar: true });
    drop(t, 'J', -2.5);
    drop(t, 'L', 0.5);
    drop(t, 'T', 2.5);
    t.step(240); // rest and bond
    give(t, 0, 'quickset');
    use(t, 0);
    const before = ids(t);
    drop(t, 'O', -1);
    const w = watch(t, 240, before);
    expect({ fastest: Number(w.fastest.toFixed(3)) }).toEqual({ fastest: 0 });
    const w2 = watch(t, 1);
    expect(w2.maxUp).toBeLessThanOrEqual(MAX_UPWARD_SPEED);
  });

  it('F18.3 Undo gives the last shape back with its brick and points, the falling shape goes back to the front of the queue; refusals', () => {
    const t = make();
    const problems: string[] = [];
    give(t, 0, 'undo');
    if (!named(use(t, 0), 'power_refused').length || S(t).slots[0] !== 'undo') problems.push('with nothing placed it was not refused, or it left the slot');
    const scoreStart = S(t).score;
    const usedStart = S(t).used;
    const placedStart = S(t).stats.placed;
    const id = drop(t, 'T', 0);
    t.step(180); // settle and be graded
    const pts = S(t).pieces.get(id)?.points ?? 0;
    t.spawnControlled();
    const falling = S(t).ctrl.shape;
    const ev = use(t, 0);
    if (!named(ev, 'power_used').length) problems.push('Undo was not used');
    if (ids(t).has(id)) problems.push('the undone piece is still in the world');
    if (S(t).ctrl?.shape !== 'T') problems.push(`the hand holds ${S(t).ctrl?.shape}, expected the undone T`);
    if (S(t).used !== usedStart) problems.push(`bricks used ${S(t).used}, expected ${usedStart}`);
    if (Math.abs(S(t).score - scoreStart) > 1e-9) problems.push(`score ${S(t).score}, expected ${scoreStart} (the T scored ${pts})`);
    if (S(t).stats.placed !== placedStart) problems.push(`placed count ${S(t).stats.placed}, expected ${placedStart}`);
    if (S(t).queue[0] !== falling) problems.push(`front of the queue is ${S(t).queue[0]}, expected the falling ${falling}`);
    if (!(pts > 0)) problems.push('setup: the T scored no points before the Undo');
    // Already undone, then stone, then Lost.
    give(t, 0, 'undo');
    if (!named(use(t, 0), 'power_refused').length) problems.push('a second Undo of the same shape was not refused');
    t.intent({ type: 'hardDrop' });
    for (let i = 0; i < 600 && S(t).ctrl; i++) t.step();
    t.step(30);
    give(t, 1, 'quickset');
    use(t, 1);
    if (!named(use(t, 0), 'power_refused').length) problems.push('Undo of a shape turned to stone was not refused');
    const lost = drop(t, 'O', S(t).foundation.x + S(t).foundation.width / 2 + 2);
    if (lost !== -1) problems.push('setup: the O off the edge landed');
    t.step(60);
    if (!named(use(t, 0), 'power_refused').length) problems.push('Undo of a Lost shape was not refused');
    if (S(t).slots[0] !== 'undo') problems.push('a refused Undo left its slot');
    writeReport({ suite: 'power-undo', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', problems.length ? problems : [`Undo gave the T back with its brick and ${pts} points, put the falling ${falling} at the front of the queue, and was refused with nothing placed, twice for one shape, on stone and on a Lost shape`], {});
    expect(problems).toEqual([]);
  });

  it('F18.4 Glue bonds the next 3 shapes on touch at ×2 strength (Mortar on); refused while running', () => {
    const t = make();
    const problems: string[] = [];
    const log: Ev[] = [];
    t.spawnControlled({ shape: 'O', x: -2 });
    give(t, 0, 'glue');
    use(t, 0, log);
    if (S(t).glueLeft !== 3) problems.push(`Glue should run for 3 shapes, glueLeft ${S(t).glueLeft}`);
    give(t, 1, 'glue');
    if (!named(use(t, 1), 'power_refused').length || S(t).slots[1] !== 'glue') problems.push('a second Glue while running was not refused, or it left the slot');
    t.intent({ type: 'hardDrop' });
    for (let i = 0; i < 600 && S(t).ctrl; i++) t.step();
    const landing = drain(t, log);
    const first = named(landing, 'piece_landed')[0];
    t.step(18); // 0.3 s
    const bonds = named([...landing, ...drain(t, log)], 'bond_formed').filter((e) => e.payload.glue);
    if (!first?.payload.glue) problems.push('the shape in hand did not land glued');
    if (!bonds.length) problems.push('the glued shape did not bond within 0.3 s of landing');
    const welds = [...S(t).welds.values()] as { a: number; k: number }[];
    if (bonds.length && !welds.some((w) => w.k === 2)) problems.push(`glued bonds should be ×2, got ×${welds.map((w) => w.k).join(', ')}`);
    drop(t, 'O', 0, 0, log);
    drop(t, 'O', 2, 0, log);
    if (!named(log, 'power_ended').some((e) => e.payload.kind === 'glue')) problems.push('Glue did not end after 3 shapes');
    const fourth = drop(t, 'O', -2, 0, log);
    const landed4 = log.filter((e) => e.name === 'piece_landed' && e.payload.id === fourth)[0];
    if (landed4?.payload.glue) problems.push('the 4th shape was glued');
    writeReport({ suite: 'power-glue', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', problems.length ? problems : ['Glue ran for 3 shapes, bonded the shape in hand within 0.3 s at ×2, was refused while running, and ended'], {});
    expect(problems).toEqual([]);
  });

  // Glue only bonds through Mortar, so with Mortar off it is never offered, and one already in a
  // slot is refused (Gameplay's call on QA-006).
  it('F18.4 with Mortar off Glue is never picked, and a Glue in a slot is refused', () => {
    const t = make({ mortar: false, powerUps: true });
    const s = S(t);
    const problems: string[] = [];
    s.tuning.infiniteBudget = false;
    s.tuning.infiniteHearts = false;
    let glue = 0;
    // Calm, tense (glue boosted) and with the other slot taken.
    for (const [tension, slots] of [[0, [null, null]], [0.6, [null, null]], [0.6, ['undo', null]]] as const) {
      s.tensionValue = tension;
      s.slots = [...slots];
      for (let i = 0; i < 4000; i++) if (s.pickKind() === 'glue') glue++;
    }
    if (glue) problems.push(`Glue was picked ${glue} times in 12000 picks with Mortar off`);
    s.slots = [null, null];
    t.spawnControlled({ shape: 'O', x: 0 });
    give(t, 0, 'glue');
    const ev = use(t, 0);
    if (!named(ev, 'power_refused').length) problems.push('a Glue in a slot was used with Mortar off');
    if (s.slots[0] !== 'glue') problems.push('the refused Glue left its slot');
    if (s.glueLeft) problems.push(`glueLeft ${s.glueLeft} after a refused Glue`);
    writeReport({ suite: 'power-glue-mortar-off', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', problems.length ? problems : ['with Mortar off Glue was never picked in 12000 picks, and a Glue in a slot was refused and kept'], {});
    expect(problems).toEqual([]);
  });

  it('F18.5 Slow-Mo halves the fall of the next 3 shapes; soft drop still speeds them up, hard drop unchanged; refused while running', () => {
    const t = make();
    const n = make();
    const problems: string[] = [];
    const fall = (x: T, n: number) => {
      const y0 = S(x).ctrl.y;
      x.step(n);
      return y0 - S(x).ctrl.y;
    };
    t.spawnControlled({ shape: 'O', x: 0 });
    n.spawnControlled({ shape: 'O', x: 0 });
    give(t, 0, 'slowmo');
    use(t, 0);
    give(t, 1, 'slowmo');
    if (!named(use(t, 1), 'power_refused').length || S(t).slots[1] !== 'slowmo') problems.push('a second Slow-Mo while running was not refused, or it left the slot');
    const slow = fall(t, 20);
    const normal = fall(n, 20);
    if (Math.abs(slow / normal - 0.5) > 1e-9) problems.push(`fall ratio ${fmt(slow / normal)}, expected 0.5`);
    t.intent({ type: 'softDrop', on: true });
    n.intent({ type: 'softDrop', on: true });
    const slowSoft = fall(t, 5);
    const normalSoft = fall(n, 5);
    if (!(slowSoft > slow / 4)) problems.push('soft drop did not speed up a Slow-Mo shape');
    if (Math.abs(slowSoft / normalSoft - 0.5) > 1e-9) problems.push(`soft drop under Slow-Mo ${fmt(slowSoft / normalSoft)} of normal, expected 0.5`);
    t.intent({ type: 'hardDrop' });
    n.intent({ type: 'hardDrop' });
    t.step();
    n.step();
    if (S(t).ctrl && S(n).ctrl && S(t).ctrl.speed !== S(n).ctrl.speed) problems.push(`hard drop speed ${S(t).ctrl.speed} under Slow-Mo vs ${S(n).ctrl.speed}`);
    for (let i = 0; i < 600 && (S(t).ctrl || S(n).ctrl); i++) {
      t.step();
      n.step();
    }
    const log: Ev[] = [];
    drop(t, 'O', 2, 0, log);
    drop(t, 'O', -2, 0, log);
    if (!named(log, 'power_ended').some((e) => e.payload.kind === 'slowmo')) problems.push('Slow-Mo did not end after 3 shapes');
    t.spawnControlled({ shape: 'O', x: 0 });
    n.spawnControlled({ shape: 'O', x: 0 });
    const after = fall(t, 10);
    const ref = fall(n, 10);
    if (Math.abs(after - ref) > 1e-9) problems.push('the 4th shape still fell slowly');
    writeReport({ suite: 'power-slowmo', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', problems.length ? problems : ['Slow-Mo halved natural fall and soft drop, left hard drop alone, was refused while running and ended after 3 shapes'], {});
    expect(problems).toEqual([]);
  });

  it('F18.5 G1 the guide is still exact under Slow-Mo', () => {
    const t = make();
    give(t, 0, 'slowmo');
    const errs: number[] = [];
    for (const [shape, x, rot] of [['O', 0, 0], ['T', 1, 2], ['I', -2, 1]] as const) {
      t.spawnControlled({ shape, x, rot });
      if (S(t).slots[0]) use(t, 0);
      const g = t.ghost();
      for (let i = 0; i < 2000 && S(t).ctrl; i++) t.step();
      const landed = named(drain(t), 'piece_landed')[0];
      errs.push(Math.abs(landed.payload.pose.y - g.y));
      t.step(60);
    }
    expect(Math.max(...errs)).toBeLessThanOrEqual(0.01);
  });

  it('F18.6 a refused power never changes the world', () => {
    const t = make({ mortar: true });
    drop(t, 'O', -2);
    t.step(200);
    const before = t.digest();
    const problems: string[] = [];
    S(t).glueLeft = 2;
    S(t).slowLeft = 2;
    for (const kind of ['glue', 'slowmo']) {
      give(t, 0, kind);
      if (!named(use(t, 0), 'power_refused').length) problems.push(`${kind} was not refused while running`);
    }
    t.intent({ type: 'secondWind' }); // not earned yet
    if (!named(drain(t), 'power_refused').length) problems.push('Second Wind before it is earned was not refused');
    if (t.digest() !== before) problems.push('a refused power changed the world');
    expect(problems).toEqual([]);
  });

  it('F18.7 bubbles: every 5 to 8 shapes while a slot is free, beside the foundation, last 3 shapes, fade when buried, collected by a hard drop, never by full slots', () => {
    const t = make({ powerUps: true });
    const problems: string[] = [];
    const lines: string[] = [];
    const log: Ev[] = [];
    let shapes = 0;
    let lastGone = 0; // shape count when the last bubble went (0 = run start)
    const gaps: number[] = [];
    const lives: number[] = [];
    const where: string[] = [];
    const sides = new Set<number>();
    // Drop shapes away from any bubble, so none is collected, and record when bubbles come and go.
    const avoid = () => {
      const b = S(t).bubble;
      return b ? (b.x >= S(t).foundation.x ? -3 : 3) : (shapes % 2 ? -3 : 3);
    };
    let born = -1;
    // Flat I pieces add only 1 block, and bubbles sit at least 1.6 blocks clear of the tower, so
    // none is buried and each should last its full 3 shapes.
    for (let i = 0; i < (FULL ? 400 : 120); i++) {
      t.spawnControlled({ shape: 'I', x: 0, rot: 0 });
      shapes++;
      const spawned = named(drain(t, log), 'bubble_spawned')[0];
      if (spawned) {
        gaps.push(shapes - 1 - lastGone);
        born = shapes;
        const b = S(t).bubble;
        const top = Math.max(S(t).height().provisional, S(t).foundation.top);
        const f = S(t).foundation;
        const dy = b.y - top;
        const off = besideFoundation(b.x, f);
        if (off) where.push(off);
        sides.add(Math.sign(b.x - f.x));
        if (dy < 2.2 - 1e-9 || dy > 4.2 + 1e-9) where.push(`y is ${fmt(dy, 2)} above the tower, outside 2.2 to 4.2`);
      }
      // A hard drop falls from where the shape is now, so the new column goes in as lockX.
      t.intent({ type: 'hardDrop', lockX: avoid() });
      for (let k = 0; k < 600 && S(t).ctrl; k++) t.step();
      const ev = drain(t, log);
      if (named(ev, 'power_collected').length) problems.push('setup: a bubble was collected while avoiding it');
      if (named(ev, 'bubble_expired').length) {
        lives.push(shapes - born + 1);
        lastGone = shapes;
      }
      // Sweep after every shape so the tower stays at the foundation and no bubble is buried.
      {
        give(t, 0, 'clean');
        use(t, 0);
        drain(t, log);
      }
    }
    const badGap = gaps.filter((g) => g < 5 || g > 8);
    const badLife = lives.filter((l) => l !== 3);
    lines.push(`${gaps.length} bubbles over ${shapes} shapes; shapes between bubbles ${Math.min(...gaps)} to ${Math.max(...gaps)} (rule 5 to 8); each lasted ${[...new Set(lives)].join(' or ')} shapes (rule 3)`);
    if (badGap.length) problems.push(`gaps outside 5 to 8: ${badGap.join(', ')}`);
    if (badLife.length) problems.push(`bubbles that didn't last 3 shapes: ${badLife.join(', ')}`);
    if (where.length) problems.push(...[...new Set(where)].slice(0, 5));
    if (sides.size < 2) problems.push(`bubbles only turned up on one side of the foundation`);

    // Collected by a hard drop through it.
    const c = make({ powerUps: true, bubbleGap: 2 });
    let collected = 0;
    let tries = 0;
    for (let i = 0; i < 40 && tries < 8; i++) {
      c.spawnControlled({ shape: 'O', x: 0 });
      drain(c);
      const b = S(c).bubble;
      if (b && S(c).slots.includes(null)) {
        tries++;
        const kind = b.kind;
        c.intent({ type: 'moveTo', x: b.x });
        c.step();
        const early = named(drain(c), 'power_collected').length;
        c.intent({ type: 'hardDrop' });
        for (let k = 0; k < 600 && S(c).ctrl; k++) c.step();
        const got = named(drain(c), 'power_collected')[0];
        if (!early && got && S(c).slots[got.payload.slot] === kind) collected++;
        give(c, 0, null as unknown as string);
        S(c).slots[1] = null;
      } else {
        c.intent({ type: 'hardDrop' });
        for (let k = 0; k < 600 && S(c).ctrl; k++) c.step();
      }
      give(c, 0, 'clean');
      use(c, 0);
      S(c).slots[0] = null;
      drain(c);
    }
    lines.push(`hard drops straight through ${tries} bubbles collected ${collected}`);
    if (collected !== tries || !tries) problems.push(`hard drops collected ${collected} of ${tries} bubbles`);

    // Buried: the tower grows up into it, and it fades on the next shape.
    const u = make({ powerUps: true, bubbleGap: 2 });
    let buried = false;
    for (let i = 0; i < 20 && !buried; i++) {
      u.spawnControlled({ shape: 'O', x: 0 });
      drain(u);
      const b = S(u).bubble;
      if (b && b.shapesLeft === 3) {
        for (let y = S(u).foundation.top + 1; y < b.y; y += 2) u.placePiece({ shape: 'O', x: b.x >= 0 ? -3 : 3, y, as: 'stone' });
        u.intent({ type: 'hardDrop', lockX: b.x >= 0 ? -3 : 3 });
        for (let k = 0; k < 600 && S(u).ctrl; k++) u.step();
        buried = named(drain(u), 'bubble_expired').length > 0;
        if (!buried) problems.push('a bubble the tower grew into did not fade on the next shape');
        break;
      }
      u.intent({ type: 'hardDrop' });
      for (let k = 0; k < 600 && S(u).ctrl; k++) u.step();
      drain(u);
    }
    lines.push(buried ? 'a bubble the tower grew into faded on the next shape' : 'burial case not reached');

    // Full slots: a bubble can't be collected, and no new one turns up.
    const f = make({ powerUps: true, bubbleGap: 2 });
    let passedThrough = false;
    let spawnedWhileFull = 0;
    for (let i = 0; i < 30; i++) {
      f.spawnControlled({ shape: 'O', x: 0 });
      const ev = drain(f);
      const b = S(f).bubble;
      if (S(f).slots.every((s: string | null) => s) && named(ev, 'bubble_spawned').length) spawnedWhileFull++;
      if (b && !passedThrough) {
        give(f, 0, 'glue');
        give(f, 1, 'slowmo');
        f.intent({ type: 'moveTo', x: b.x });
        f.step();
        f.intent({ type: 'hardDrop' });
        for (let k = 0; k < 600 && S(f).ctrl; k++) f.step();
        if (named(drain(f), 'power_collected').length) problems.push('a bubble was collected with both slots full');
        passedThrough = true;
        continue;
      }
      f.intent({ type: 'hardDrop' });
      for (let k = 0; k < 600 && S(f).ctrl; k++) f.step();
      drain(f);
    }
    if (spawnedWhileFull) problems.push(`${spawnedWhileFull} bubbles turned up while both slots were full`);
    lines.push(`with both slots full: ${passedThrough ? 'passing through a bubble collected nothing' : 'not reached'}, and ${spawnedWhileFull} new bubbles turned up in 30 shapes`);
    writeReport({ suite: 'power-bubbles', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], { gaps, lives });
    expect(problems).toEqual([]);
  });

  it('F18.7 a shape dropped onto the foundation never collects a bubble, by hard drop or natural fall', () => {
    const t = make({ powerUps: true, bubbleGap: 2 });
    const { extents } = game!.shapes;
    const problems: string[] = [];
    const seen = new Set<number>();
    let collected = 0;
    let seed = 99;
    const r = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const N = FULL ? 700 : 160;
    for (let i = 0; i < N; i++) {
      const shape = CORE_SHAPES[i % CORE_SHAPES.length];
      const rot = Math.floor(r() * 4);
      t.spawnControlled({ shape, x: 0, rot });
      drain(t);
      const f = S(t).foundation;
      const e = extents(shape, rot);
      // A column on the 0.5 grid with the whole shape over the foundation.
      const lo = Math.ceil((f.x - f.width / 2 - e.minX) * 2) / 2;
      const hi = Math.floor((f.x + f.width / 2 - e.maxX) * 2) / 2;
      const x = lo + Math.floor(r() * ((hi - lo) * 2 + 1)) / 2;
      if (S(t).bubble) seen.add(S(t).bubble.id);
      if (i % 3 === 0) t.intent({ type: 'moveTo', x });
      else t.intent({ type: 'hardDrop', lockX: x });
      for (let k = 0; k < 1500 && S(t).ctrl; k++) {
        t.step();
        if (S(t).bubble) seen.add(S(t).bubble.id);
      }
      const got = named(drain(t), 'power_collected');
      if (got.length && collected < 3) problems.push(`a ${shape} (rot ${rot}) ${i % 3 === 0 ? 'falling' : 'hard-dropped'} at x ${x} over the foundation collected a bubble`);
      collected += got.length;
      // Keep the tower at the foundation so no bubble is buried, and the slots free.
      S(t).slots = ['clean', null];
      use(t, 0);
      S(t).slots = [null, null];
      drain(t);
    }
    if (seen.size < N / 12) problems.push(`only ${seen.size} bubbles turned up in ${N} shapes`);
    writeReport({ suite: 'power-bubble-reach', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [`${N} shapes dropped onto the foundation (a third falling naturally) under ${seen.size} bubbles collected ${collected}`, ...problems], { shapes: N, bubbles: seen.size, collected });
    expect(problems).toEqual([]);
  });

  it('F18.8 picks follow §13.1 weights, and power-ups never change the bag', () => {
    const t = make({ powerUps: true });
    const s = S(t);
    const kinds = ['clean', 'quickset', 'undo', 'glue', 'slowmo'];
    // The rule as written: everything 2, then the boosts, and a kind already in a slot counts half,
    // rounded down (QA-007, Gameplay's call).
    const expected = (c: { lastHeart: boolean; bricks: number; tension: number; cp: number; slots: (string | null)[] }) => {
      const w: Record<string, number> = { clean: 2, quickset: 2, undo: 2, glue: 2, slowmo: 2 };
      if (c.lastHeart) w.clean += 2;
      if (c.bricks <= 4) { w.clean += 2; w.undo += 1; }
      if (c.tension >= 0.5) { w.quickset += 2; w.glue += 1; }
      if (c.cp >= 4) w.slowmo += 1;
      for (const k of c.slots) if (k) w[k] = Math.max(1, Math.floor(w[k] / 2));
      const sum = kinds.reduce((a, k) => a + w[k], 0);
      return Object.fromEntries(kinds.map((k) => [k, w[k] / sum]));
    };
    const cases = [
      { name: 'calm', lastHeart: false, bricks: 20, tension: 0, cp: 1, slots: [null, null] },
      { name: 'last heart', lastHeart: true, bricks: 20, tension: 0, cp: 1, slots: [null, null] },
      { name: '4 bricks left', lastHeart: false, bricks: 4, tension: 0, cp: 1, slots: [null, null] },
      { name: 'tense', lastHeart: false, bricks: 20, tension: 0.6, cp: 1, slots: [null, null] },
      { name: 'checkpoint 4', lastHeart: false, bricks: 20, tension: 0, cp: 4, slots: [null, null] },
      { name: 'Glue in a slot', lastHeart: false, bricks: 20, tension: 0, cp: 1, slots: ['glue', null] },
      { name: '4 bricks left, Undo in a slot', lastHeart: false, bricks: 4, tension: 0, cp: 1, slots: ['undo', null] },
    ];
    const N = FULL ? 40000 : 6000;
    const lines: string[] = [];
    const problems: string[] = [];
    s.tuning.infiniteHearts = false;
    s.tuning.infiniteBudget = false;
    for (const c of cases) {
      s.hearts = c.lastHeart ? 1 : 3;
      s.budget = 100;
      s.used = 100 - c.bricks;
      s.tensionValue = c.tension;
      s.checkpoint = c.cp;
      s.slots = [...c.slots];
      const n: Record<string, number> = Object.fromEntries(kinds.map((k) => [k, 0]));
      for (let i = 0; i < N; i++) n[s.pickKind()]++;
      const exp = expected(c);
      const off = kinds.filter((k) => Math.abs(n[k] / N - exp[k]) > 4 * Math.sqrt((exp[k] * (1 - exp[k])) / N) + 0.002);
      lines.push(`${off.length ? 'FAIL ' : ''}${c.name}: ${kinds.map((k) => `${k} ${pct(n[k] / N, 1)} (rule ${pct(exp[k], 1)})`).join(', ')}`);
      if (off.length) problems.push(`${c.name}: ${off.join(', ')} off the rule`);
    }
    // The bag: the same seed gives the same shapes with power-ups on or off.
    const bag = (powerUps: boolean) => {
      const b = make({ powerUps, bubbleGap: 2 }, { seed: 11 });
      b.step();
      const out: string[] = [];
      for (let i = 0; i < 60; i++) {
        b.spawnControlled();
        out.push(S(b).ctrl.shape);
        b.intent({ type: 'hardDrop', lockX: (i % 5) * 1.5 - 3 });
        for (let k = 0; k < 600 && S(b).ctrl; k++) b.step();
        if (i % 8 === 7) { S(b).slots = ['clean', null]; use(b, 0); }
        drain(b);
      }
      return out.join('');
    };
    const sameBag = bag(true) === bag(false);
    lines.push(sameBag ? 'the first 60 shapes are the same with power-ups on and off' : 'FAIL the bag changes when power-ups are on');
    if (!sameBag) problems.push('power-ups change the bag');
    writeReport({ suite: 'power-picks', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', lines, {});
    expect(problems).toEqual([]);
  });

  it('F18.8 a kind already in a slot counts half, odd weights rounded down', () => {
    const t = make({ powerUps: true });
    const s = S(t);
    s.tuning.infiniteBudget = false;
    s.budget = 100;
    s.used = 96; // 4 left: undo 3
    s.slots = ['undo', null];
    const N = 12000;
    let undo = 0;
    for (let i = 0; i < N; i++) if (s.pickKind() === 'undo') undo++;
    // clean 4, quickset 2, undo 3 halved to 1, glue 2, slowmo 2
    const exp = 1 / 11;
    expect(Math.abs(undo / N - exp)).toBeLessThan(4 * Math.sqrt((exp * (1 - exp)) / N) + 0.002);
  });

  it('F18.9 grants: an S grade gives a power-up; checkpoint 2 earns Second Wind, or gives a power-up to ready, used and off runs', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    const tuning = { firstGap: 2, gapGrowth: 0, powerUps: true, bubbleGap: 1000 };
    // S grade: a row of O pieces covers the whole foundation (six on the 12-wide plinth).
    const wall = (t: T) => Array.from({ length: S(t).foundation.width / 2 }, (_, k) => -S(t).foundation.width / 2 + 1 + 2 * k);
    {
      const t = make(tuning);
      const log: Ev[] = [];
      const ev = claimWith(t, wall(t), log);
      const grade = named(ev, 'checkpoint_claimed')[0].payload.grade;
      const granted = named(ev, 'power_granted').filter((e) => e.payload.why === 'grade');
      lines.push(`a full-width claim graded ${grade} and granted ${granted.map((e) => e.payload.kind).join(', ') || 'nothing'}`);
      if (grade !== 'S') problems.push(`setup: the full-width claim graded ${grade}`);
      else if (granted.length !== 1 || S(t).slots[granted[0].payload.slot] !== granted[0].payload.kind) problems.push('an S grade did not put a power-up in a free slot');
      // A C grade gives nothing.
      const t2 = make(tuning);
      const ev2 = claimWith(t2, [0], []);
      if (named(ev2, 'power_granted').length) problems.push('a C grade granted a power-up');
      // Both slots full: nothing granted, nothing replaced.
      const t3 = make(tuning);
      give(t3, 0, 'glue');
      give(t3, 1, 'slowmo');
      const ev3 = claimWith(t3, wall(t3), []);
      if (named(ev3, 'power_granted').length || S(t3).slots.join() !== 'glue,slowmo') problems.push('an S grade with full slots changed the slots');
    }
    for (const mode of ['earn', 'ready', 'used', 'off'] as const) {
      const t = make(tuning, { secondWind: mode === 'used' ? 'ready' : mode });
      const log: Ev[] = [];
      drain(t, log);
      if (mode === 'ready' && !named(log, 'second_wind_ready').some((e) => e.payload.how === 'start')) problems.push('a ready run did not start with second_wind_ready');
      if (mode === 'used') {
        drop(t, 'O', 2);
        t.intent({ type: 'secondWind' });
        if (!named(drain(t, log), 'second_wind').length) problems.push('setup: Second Wind was not used');
      }
      claimWith(t, [0], log);
      if (mode === 'earn' && S(t).secondWind !== 'earn') problems.push(`Second Wind became ${S(t).secondWind} at checkpoint 1`);
      const ev = claimWith(t, [0], log);
      const n = named(ev, 'checkpoint_claimed')[0].payload.n;
      const ready = named(ev, 'second_wind_ready');
      const granted = named(ev, 'power_granted').filter((e) => e.payload.why === 'second_wind');
      const state = S(t).secondWind;
      lines.push(`${mode} run, checkpoint ${n}: Second Wind ${state}, ${ready.length ? 'earned' : 'not earned'}, power-up ${granted.map((e) => e.payload.kind).join(', ') || 'none'}`);
      if (n !== 2) problems.push(`setup: ${mode} run claimed checkpoint ${n}, not 2`);
      if (mode === 'earn' && (state !== 'ready' || !ready.some((e) => e.payload.how === 'earned') || granted.length)) problems.push('an earn run did not get Second Wind (and only that) at checkpoint 2');
      if (mode !== 'earn' && (granted.length !== 1 || ready.length)) problems.push(`a ${mode} run did not get a power-up instead at checkpoint 2`);
      if (mode === 'off' && state !== 'off') problems.push('an off run has Second Wind');
    }
    writeReport({ suite: 'power-grants', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });

  it('F18.10 Second Wind sweeps, refills hearts and the stretch budget, works once per run, and is refused until ready', () => {
    const problems: string[] = [];
    const t = make({ infiniteHearts: false }, { secondWind: 'ready' });
    const log: Ev[] = [];
    const kept = [drop(t, 'O', -2, 0, log), drop(t, 'T', 1, 0, log)];
    // Two shapes off the edge cost two hearts.
    drop(t, 'O', S(t).foundation.x + S(t).foundation.width / 2 + 2, 0, log);
    t.step(120);
    drop(t, 'O', S(t).foundation.x - S(t).foundation.width / 2 - 2, 0, log);
    t.step(200);
    drain(t, log);
    const heartsBefore = S(t).hearts;
    const usedBefore = S(t).used;
    t.intent({ type: 'secondWind' });
    const ev = drain(t, log);
    const sw = named(ev, 'second_wind')[0];
    if (heartsBefore !== 1) problems.push(`setup: hearts ${heartsBefore} before Second Wind, expected 1`);
    if (!sw) problems.push('Second Wind was not used');
    if (S(t).hearts !== S(t).tuning.hearts) problems.push(`hearts ${S(t).hearts} after, expected ${S(t).tuning.hearts}`);
    if (S(t).used !== 0) problems.push(`bricks used ${S(t).used} after, expected 0 (was ${usedBefore})`);
    if (loose(t).length) problems.push(`${loose(t).length} loose pieces left`);
    if (kept.some((id) => ids(t).has(id))) problems.push('a loose piece is still in the world');
    if (S(t).secondWind !== 'used' || !S(t).stats.secondWind) problems.push('Second Wind not marked used');
    t.intent({ type: 'secondWind' });
    if (!named(drain(t), 'power_refused').length) problems.push('a second Second Wind was not refused');
    for (const mode of ['earn', 'off'] as const) {
      const u = make({}, { secondWind: mode });
      drop(u, 'O', 0);
      u.intent({ type: 'secondWind' });
      if (!named(drain(u), 'power_refused').length || S(u).secondWind !== mode) problems.push(`Second Wind in a ${mode} run was not refused`);
    }
    writeReport({ suite: 'second-wind', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', problems.length ? problems : [`Second Wind at 1 heart and ${usedBefore} bricks used swept the loose pieces and gave back 3 hearts and the whole stretch budget; refused the second time, and in earn and off runs before checkpoint 2`], { sw: sw?.payload });
    expect(problems).toEqual([]);
  });

  it('F18.14 F3.3 glued drops never fling anything, upside-down included', () => {
    const shapes = FULL ? CORE_SHAPES : ['O', 'I', 'T', 'L', 'S'];
    const xs = FULL ? [-2.5, -1, 0, 1.5, 3] : [-1, 1];
    let worst = 0;
    let drops = 0;
    let where = '';
    for (const mortar of [true, false]) {
      for (const shape of shapes) {
        for (let rot = 0; rot < 4; rot++) {
          for (const x of xs) {
            const t = make({ mortar });
            const top = S(t).foundation.top;
            t.placePiece({ shape: 'O', x: -1, y: top + 1 });
            t.placePiece({ shape: 'O', x: 1, y: top + 1 });
            t.placePiece({ shape: 'I', x: 0, y: top + 2.5 });
            t.step(90);
            t.spawnControlled({ shape, x, rot });
            give(t, 0, 'glue');
            use(t, 0);
            t.intent({ type: 'hardDrop' });
            const w = watch(t, 180);
            drops++;
            if (w.maxUp > worst) { worst = w.maxUp; where = `${shape} rot ${rot} at x ${x}, Mortar ${mortar ? 'on' : 'off'}`; }
            live.splice(live.indexOf(t as unknown as { dispose(): void }), 1);
            t.dispose();
          }
        }
      }
    }
    writeReport({ suite: 'power-glue-fling', sim: sut, full: FULL }, worst > MAX_UPWARD_SPEED ? 'fail' : 'pass', [`${drops} glued drops (${shapes.join(', ')}, 4 rotations, Mortar on and off) onto a small tower: fastest upward speed ${fmt(worst, 2)} blocks/s${where ? ` (${where})` : ''}, limit ${MAX_UPWARD_SPEED}`], {});
    expect(worst).toBeLessThanOrEqual(MAX_UPWARD_SPEED);
  });

  it('F18.14 Clean Slate and Undo never kick the pieces that stay', () => {
    const problems: string[] = [];
    for (const kind of ['clean', 'undo']) {
      const t = make({ mortar: true });
      const top = S(t).foundation.top;
      const stone = [t.placePiece({ shape: 'O', x: -1, y: top + 1, as: 'stone' }), t.placePiece({ shape: 'O', x: 1, y: top + 1, as: 'stone' })];
      const base = drop(t, 'I', 0, 0);
      t.step(240);
      drop(t, 'O', 0);
      t.step(240); // bonded on top of the I
      give(t, 0, kind);
      use(t, 0);
      const stay = new Set([...ids(t)].filter((id) => kind === 'undo' || stone.includes(id)));
      const w = watch(t, 240, stay);
      if (w.fastest > 0.5) problems.push(`${kind}: a piece that stayed moved at ${fmt(w.fastest, 2)} blocks/s`);
      if (kind === 'undo' && !ids(t).has(base)) problems.push('undo: the I under the undone O went too');
    }
    expect(problems).toEqual([]);
  });

  it('F18.15 every power-up and Second Wind rule holds over whole bot runs', () => {
    const { shapes } = game!;
    const cases = (FULL ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 3]).map((seed) => ({
      seed,
      mode: (['earn', 'ready', 'off'] as const)[seed % 3],
      mortar: FULL ? seed % 2 === 1 : false,
      seconds: FULL ? 300 : 120,
    }));
    const problems: string[] = [];
    const lines: string[] = [];
    const totals: Record<string, number> = {};
    const count = (k: string) => (totals[k] = (totals[k] ?? 0) + 1);
    for (const c of cases) {
      const sim = makeRun({ seed: c.seed, tuning: { mortar: c.mortar, bubbleGap: 4 }, secondWind: c.mode });
      const bot = new Bot({ seed: c.seed, powers: true, naturalFall: 0.3 }, shapes.extents);
      const bad = (s: string) => problems.push(`seed ${c.seed} (${c.mode}) at ${(sim.stepIndex / 60).toFixed(1)} s: ${s}`);
      const loosePieces = () => [...sim.pieces.values()].filter((p: any) => !p.claimed && p.state !== 'stone' && p.state !== 'lost');
      const resting = () => [...sim.pieces.values()].filter((p: any) => p.state !== 'stone' && p.state !== 'lost' && (p.state === 'settled' || sim.engine.contacts(p.id).length > 0));
      const undoable = () => {
        const p = sim.lastPlaced === null ? undefined : sim.pieces.get(sim.lastPlaced);
        return !!p && !p.claimed && p.state !== 'stone' && p.state !== 'lost';
      };
      // Check each power intent against the state just before it.
      const intent = sim.intent.bind(sim);
      sim.intent = (i: Record<string, any>) => {
        if (i.type !== 'power' && i.type !== 'secondWind') return intent(i);
        const pre = { slots: [...sim.slots], glue: sim.glueLeft, slow: sim.slowLeft, wind: sim.secondWind, loose: loosePieces().length, resting: resting().length, undoable: undoable(), shape: (() => { const p = sim.lastPlaced === null ? undefined : sim.pieces.get(sim.lastPlaced); return p?.shape; })() };
        // The bus keeps a log; read this intent's events without draining them from the step loop.
        const from = sim.bus.log.length;
        intent(i);
        const ev = sim.bus.log.slice(from) as Ev[];
        if (i.type === 'secondWind') {
          const sw = named(ev, 'second_wind').length;
          if (pre.wind === 'ready') {
            count('second wind used');
            if (!sw) bad('a ready Second Wind was not used');
            if (!sim.tuning.infiniteHearts && sim.hearts !== sim.tuning.hearts) bad(`hearts ${sim.hearts} after Second Wind`);
            if (sim.used !== 0) bad(`bricks used ${sim.used} after Second Wind`);
            if (loosePieces().length) bad('loose pieces left after Second Wind');
          } else {
            count('second wind refused');
            if (sw || !named(ev, 'power_refused').length) bad(`Second Wind in state ${pre.wind} was not refused`);
          }
          return;
        }
        const kind = pre.slots[i.slot];
        if (!kind) {
          if (ev.some((e) => e.name.startsWith('power'))) bad('tapping an empty slot did something');
          return;
        }
        const refused = named(ev, 'power_refused').length > 0;
        const shouldRefuse = kind === 'clean' ? pre.loose === 0 : kind === 'quickset' ? pre.resting === 0 : kind === 'undo' ? !pre.undoable : kind === 'glue' ? pre.glue > 0 || !sim.tuning.mortar : pre.slow > 0;
        count(`${kind} ${refused ? 'refused' : 'used'}`);
        if (refused !== shouldRefuse) bad(`${kind} ${refused ? 'refused' : 'used'} when it should have been ${shouldRefuse ? 'refused' : 'used'}`);
        if (refused && sim.slots[i.slot] !== kind) bad(`a refused ${kind} left its slot`);
        if (!refused && sim.slots[i.slot] !== null) bad(`a used ${kind} stayed in its slot`);
        if (!refused) {
          if (kind === 'clean' && loosePieces().length) bad('loose pieces left after Clean Slate');
          if (kind === 'quickset' && resting().length) bad('resting pieces left after Quick-Set');
          if (kind === 'undo' && sim.ctrl?.shape !== pre.shape) bad(`Undo put ${sim.ctrl?.shape} in hand, not ${pre.shape}`);
          if (kind === 'glue' && sim.glueLeft !== sim.tuning.glueShapes) bad(`glueLeft ${sim.glueLeft} after Glue`);
          if (kind === 'slowmo' && sim.slowLeft !== sim.tuning.slowShapes) bad(`slowLeft ${sim.slowLeft} after Slow-Mo`);
        }
      };
      let winds = 0;
      let bubbleShapes = 0;
      let placements = 0;
      let crashed: string | null = null;
      try {
        while (sim.stepIndex < 60 * c.seconds && sim.state === 'playing') {
          const pre = { slots: [...sim.slots], wind: sim.secondWind, bubble: sim.bubble?.id ?? null, left: sim.bubble?.shapesLeft ?? 0, f: { x: sim.foundation.x, width: sim.foundation.width } };
          bot.tick(sim);
          sim.step();
          const ev = sim.drainEvents() as Ev[];
          if (!c.mortar && sim.slots.includes('glue') && !pre.slots.includes('glue')) bad('Glue reached a slot with Mortar off');
          for (const e of ev) {
            if (e.name === 'second_wind') winds++;
            if (e.name === 'piece_landed') placements++;
            if (e.name === 'bubble_spawned') {
              count('bubbles');
              if (pre.slots.every((s) => s)) bad('a bubble turned up with both slots full');
              // Beside the foundation it spawned over (a claim in the same step moves the foundation).
              const off = besideFoundation(e.payload.x, pre.f) && besideFoundation(e.payload.x, sim.foundation);
              if (off) bad(`bubble ${off}`);
              bubbleShapes = 0;
            }
            // Fades at the end of its 3 shapes, or early once the tower is as high as the bubble.
            if (e.name === 'bubble_expired') count(pre.left > 1 ? 'bubbles faded early (tower reached them)' : 'bubbles faded after 3 shapes');
            if (e.name === 'power_collected') {
              count('bubbles collected');
              if (sim.slots[e.payload.slot] !== e.payload.kind && sim.slots[e.payload.slot] !== null) bad('a collected power-up is not in its slot');
            }
            if (e.name === 'checkpoint_claimed') {
              const granted = named(ev, 'power_granted');
              const free = pre.slots.filter((s) => !s).length;
              if (e.payload.n === 2) {
                count('checkpoint 2');
                if (pre.wind === 'earn' && !named(ev, 'second_wind_ready').length) bad('Second Wind not earned at checkpoint 2');
                if (pre.wind !== 'earn' && free > 0 && !granted.some((g) => g.payload.why === 'second_wind')) bad(`no power-up at checkpoint 2 for a ${pre.wind} run`);
              }
              if (e.payload.grade === 'S') {
                count('S grades');
                const used = e.payload.n === 2 && pre.wind !== 'earn' ? 1 : 0;
                if (free - used > 0 && !granted.some((g) => g.payload.why === 'grade')) bad('no power-up for an S grade');
              }
            }
          }
          if (sim.bubble && pre.bubble === sim.bubble.id && ev.some((e) => e.name === 'piece_landed' || e.name === 'piece_lost')) bubbleShapes++;
          if (sim.bubble && bubbleShapes > 3) bad('a bubble outlived 3 shapes');
        }
      } catch (err) {
        crashed = (err as Error).message;
      }
      if (winds > 1) bad(`Second Wind used ${winds} times`);
      const end = crashed ? `stopped by "${crashed}" (QA-005)` : `ended by ${sim.cause || 'the time cap'}`;
      lines.push(`seed ${c.seed}, ${c.mode}, Mortar ${c.mortar ? 'on' : 'off'}: ${(sim.stepIndex / 60).toFixed(0)} s, ${placements} placed, ${sim.stats.checkpoints} checkpoints, ${sim.stats.powers} powers used, Second Wind ${sim.stats.secondWind ? 'used' : 'not used'}, ${end}`);
      if (crashed && !/must be awake/.test(crashed)) bad(`threw "${crashed}"`);
    }
    lines.push(`totals: ${Object.entries(totals).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    writeReport({ suite: 'power-rules', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.slice(0, 20).map((p) => `FAIL ${p}`)], { totals });
    expect(problems.slice(0, 20)).toEqual([]);
  });

  it('F18.13 runs that use powers, Second Wind and quit replay exactly, in this process and a fresh one', () => {
    const { api, shapes } = game!;
    const records = (FULL ? [1, 2, 3, 4, 5, 6] : [1, 2]).map((seed) => {
      const secondWind = (['earn', 'ready', 'off'] as const)[seed % 3];
      const tuning = { mortar: false, bubbleGap: 3 };
      const sim = makeRun({ seed, tuning, rookieOpening: seed % 2 === 0, secondWind });
      const bot = new Bot({ seed, powers: true, naturalFall: 0.3, quitAt: 60 * (FULL ? 200 : 75) }, shapes.extents);
      const digests: string[] = [];
      while (sim.stepIndex < 60 * 300 && sim.state === 'playing') {
        bot.tick(sim);
        sim.step();
        if (sim.stepIndex % 60 === 0) digests.push(sim.digest());
      }
      const end = { cause: sim.cause, score: Math.round(sim.score), powers: sim.stats.powers, wind: sim.secondWind, slots: sim.slots.join() };
      return { seed, tuning, rookieOpening: seed % 2 === 0, secondWind, inputs: sim.inputLog.map((x: any) => ({ s: x.s, i: { ...x.i } })), steps: sim.stepIndex, digests, finalDigest: sim.digest(), end };
    });
    const problems: string[] = [];
    const lines: string[] = [];
    for (const r of records) {
      const { digests, sim } = api.replay(r);
      const end = { cause: sim.cause, score: Math.round(sim.score), powers: sim.stats.powers, wind: sim.secondWind, slots: sim.slots.join() };
      const first = r.digests.findIndex((d: string, i: number) => d !== digests[i]);
      const same = first === -1 && sim.digest() === r.finalDigest && JSON.stringify(end) === JSON.stringify(r.end);
      const kinds = r.inputs.reduce((a: Record<string, number>, x: any) => ((a[x.i.type] = (a[x.i.type] ?? 0) + 1), a), {});
      lines.push(`seed ${r.seed} (${r.secondWind}): ${(r.steps / 60).toFixed(0)} s, ${kinds.power ?? 0} power taps, ${kinds.secondWind ?? 0} Second Wind taps, ${kinds.quit ? 'quit' : `ended by ${r.end.cause}`}, ${r.end.powers} powers used; replay ${same ? 'MATCH' : 'MISMATCH'}`);
      if (!same) problems.push(`seed ${r.seed}: in-process replay differs (first digest ${first})`);
      if (!kinds.power) problems.push(`setup: seed ${r.seed} tapped no powers`);
      sim.dispose();
    }
    const dir = resolve(REPO_ROOT, 'qa/scratch');
    mkdirSync(dir, { recursive: true });
    const file = resolve(dir, 'power-records.json');
    writeFileSync(file, JSON.stringify(records));
    const child = spawnSync('npx', ['tsx', 'scripts/replay-child.ts', file], { cwd: resolve(REPO_ROOT, 'qa'), encoding: 'utf8', env: process.env });
    const out = JSON.parse(child.stdout.trim().split('\n').pop() ?? '[]') as { seed: number; same: boolean }[];
    for (const r of records) {
      const o = out.find((x) => x.seed === r.seed);
      if (!o?.same) problems.push(`seed ${r.seed}: replay in a fresh process differs${child.status ? ` (${child.stderr.slice(0, 200)})` : ''}`);
    }
    lines.push(`fresh process: ${out.filter((o) => o.same).length} of ${records.length} match`);
    writeReport({ suite: 'power-replays', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });
});
