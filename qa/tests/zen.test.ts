// Zen (F17.4, Q33; gameplay.md §12.1, #57). Game only, on builds whose tuning has `zen`. Zen has nothing
// to count and nothing to lose: no budget, no hearts, no Second Wind, exactly half XP, and only quitting
// ends it. Since 2026-10-22 it is also gentler: the difficulty ramp at half pace and every hazard at half
// strength. Since 2026-11-02 (Blake) it has no checkpoints either: no line, hold, claim or slab. The
// tower just grows, setting to stone a few blocks under its top, and its hidden "stretches" end at the
// heights Endless's lines would be at, so the skies, hazards and ramp follow height. Gameplay's sim:smoke
// checks those rules on built towers; this plays them with QA's bot, tossing every other shape.
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { FULL, gameSimPath, loadSim } from '../src/adapters/index';
import { Bot, type BotSim } from '../src/bot';
import { loadGameApi } from '../src/game-api';
import { writeReport } from '../src/report';

const sut = await loadSim();
const game = await loadGameApi(sut);
/** Builds with Zen, and Zen without checkpoints (it sends zen_stretch: 2026-11-02 on). */
const zenny = (() => {
  if (!game) return false;
  const probe = new game.api.Sim({ seed: 1, autoSpawn: false });
  const has = typeof (probe.tuning as Record<string, unknown>).zen === 'boolean' && typeof (probe as Record<string, unknown>).zenStart === 'function';
  probe.dispose();
  return has;
})();
const tuning = zenny ? await import(pathToFileURL(resolve(dirname(gameSimPath()), 'tuning.ts')).href) : null;

type Ev = { name: string; step: number; payload: Record<string, any> };
type S = BotSim & Record<string, any>;

const live: { dispose(): void }[] = [];
const own = <X>(x: X): X => (live.push(x as unknown as { dispose(): void }), x);
afterEach(() => {
  for (const x of live.splice(0)) x.dispose();
});

// Events Zen never sends (§12.1): nothing to count, nothing to lose, no Second Wind, no checkpoints.
const NEVER = ['heart_lost', 'last_heart', 'budget_low', 'bricks_out', 'second_wind_ready', 'second_wind', 'run_over', 'checkpoint_near', 'checkpoint_hold', 'checkpoint_claimed', 'checkpoint_cancelled'];

interface Seen {
  counts: Record<string, number>;
  digests: string[];
  stretches: { n: number; y: number; at: number }[];
  biomes: { id: number; cp: number }[];
  /** Stone found above the set line (other than Solid Rows), and the set line coming down or rising too high. */
  stoneAbove: string[];
  lineWrong: string[];
}

/**
 * QA's bot plays, and every other shape is thrown off the edge so some are lost and the run goes past
 * an ordinary stretch's budget. It checks the stone line: Zen's foundation is a stand-in at the set
 * line, which only rises, rises to zenSetDepth under the settled top, and has no stone above it but
 * Solid Rows' (any settled piece starting under a solid row).
 */
function play(sim: S, seed: number, seconds: number): Seen {
  const seen: Seen = { counts: {}, digests: [], stretches: [], biomes: [], stoneAbove: [], lineWrong: [] };
  const bot = new Bot({ seed, naturalFall: 0.3 }, game!.shapes.extents);
  const depth = Number((sim.tuning as Record<string, unknown>).zenSetDepth);
  let spawned = 0, toss = false, lastTop = sim.foundation.top;
  while (sim.stepIndex < 60 * seconds && sim.state === 'playing') {
    const c = sim.ctrl as { hard?: boolean } | null;
    if (toss && c && !c.hard) {
      // Clear of the tower's edge. The drop takes its column with it: a moveTo just before a hard drop
      // never gets to move the shape.
      sim.intent({ type: 'hardDrop', lockX: sim.foundation.x + sim.foundation.width / 2 + 3 });
    } else bot.tick(sim);
    sim.step();
    if (sim.used > sim.budget) seen.counts.pastBudget = 1;
    for (const e of sim.drainEvents() as Ev[]) {
      seen.counts[e.name] = (seen.counts[e.name] ?? 0) + 1;
      if (e.name === 'piece_spawned') toss = ++spawned % 2 === 0;
      if (e.name === 'zen_stretch') seen.stretches.push({ n: Number(e.payload.n), y: Number(e.payload.y), at: sim.stats.maxHeight });
      if (e.name === 'biome_entered') seen.biomes.push({ id: Number(e.payload.id), cp: sim.checkpoint });
      if (e.name === 'zen_set') {
        const y = Number(e.payload.y), top = sim.height().committed;
        if (y > top - depth + 0.1 && seen.lineWrong.length < 6) seen.lineWrong.push(`at ${sim.stepIndex}: the set line rose to ${y}, within ${depth} of the top ${top.toFixed(2)}`);
      }
    }
    if (sim.stepIndex % 30 === 0) {
      const f = sim.foundation, solid = f.top + Number(sim.solidTo ?? 0);
      if (f.top < lastTop - 1e-6 && seen.lineWrong.length < 6) seen.lineWrong.push(`at ${sim.stepIndex}: the set line came down from ${lastTop} to ${f.top}`);
      lastTop = f.top;
      for (const p of (sim.pieces as Map<number, { id: number; state: string; top: number; bottom: number }>).values()) {
        if (p.state === 'stone' && p.top > f.top + 0.05 && p.bottom >= solid - 0.01 && seen.stoneAbove.length < 6) seen.stoneAbove.push(`at ${sim.stepIndex}: piece ${p.id} is stone from ${p.bottom.toFixed(2)} to ${p.top.toFixed(2)}, above the set line ${f.top} and Solid Rows to ${solid}`);
      }
    }
    if (sim.stepIndex % 60 === 0) seen.digests.push(sim.digest());
  }
  return seen;
}

describe.runIf(zenny)(`Zen on ${sut.kind} (${sut.engine})`, () => {
  it('F17.4 Zen has no budget, no hearts, no Second Wind and no checkpoints: its stretches end where Endless\'s lines would be and bring the skies by height, the tower sets to stone under its top, no loss is ever counted, the run replays exactly, and only quitting ends it, with exactly half XP', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    const seconds = FULL ? 300 : 150;
    let pastBudget = 0;
    // Late starts too, so the half-pace ramp and half-strength late hazards are played.
    for (const [seed, from] of (FULL ? [[1, 1], [2, 1], [3, 1], [4, 7], [5, 11], [6, 17], [7, 20], [8, 23]] : [[1, 1], [2, 1], [3, 17]]) as [number, number][]) {
      const opts = { seed, startCheckpoint: from, tuning: { zen: true }, secondWind: 'ready', autoSpawn: true, rookieOpening: false };
      const zen = own(new game!.api.Sim(opts)) as S;
      if (zen.secondWind !== 'off') problems.push(`seed ${seed}: Zen asked for Second Wind 'ready' and got '${zen.secondWind}', not 'off'`);
      // Endless's first line from the same start, for where Zen's first stretch should end.
      const endless = new game!.api.Sim({ ...opts, tuning: {} }) as S;
      const endlessLine = endless.lineY as number;
      endless.dispose();
      const ground = zen.foundations[0].top as number;
      const z = play(zen, seed, seconds);
      pastBudget += z.counts.pastBudget ?? 0;
      for (const n of NEVER) if (z.counts[n]) problems.push(`seed ${seed}: Zen sent ${n} ${z.counts[n]} times`);
      if (zen.foundations.length !== 1) problems.push(`seed ${seed}: Zen laid ${zen.foundations.length - 1} slabs`);
      if (zen.stats.checkpoints !== 0) problems.push(`seed ${seed}: Zen counted ${zen.stats.checkpoints} checkpoints`);
      if (zen.state !== 'playing') problems.push(`seed ${seed}: the Zen run ended on its own (${zen.state}, ${zen.cause})`);
      const hearts = (zen.tuning as Record<string, unknown>).hearts;
      if (zen.hearts !== hearts) problems.push(`seed ${seed}: Zen hearts went from ${hearts} to ${zen.hearts}`);
      // Stretches: one after another, each ending where Endless's line for that checkpoint would be if
      // every slab were laid at its line, and only once the tower has grown that high.
      let want = ground;
      z.stretches.forEach((s, k) => {
        want += tuning.gapFor(zen.tuning, from + k);
        if (k === 0 && Math.abs(s.y - endlessLine) > 1e-6) problems.push(`seed ${seed}: the first stretch ends at ${s.y}, Endless's first line is at ${endlessLine}`);
        if (s.n !== from + k + 1 || Math.abs(s.y - want) > 1e-6) problems.push(`seed ${seed}: stretch ${k + 1} is n ${s.n} ending at ${s.y}, wanted n ${from + k + 1} at ${want}`);
        if (s.at < s.y - 0.1) problems.push(`seed ${seed}: stretch ${s.n} ended at ${s.y} with the tower only ${s.at.toFixed(2)} high`);
      });
      if (zen.checkpoint !== from + z.stretches.length || zen.stats.stretches !== z.stretches.length) problems.push(`seed ${seed}: ${z.stretches.length} stretches, but checkpoint ${zen.checkpoint} and stats.stretches ${zen.stats.stretches}`);
      // Skies by height: a biome arrives on the stretch that starts it, and on no other (the first is the
      // run's own, at its start).
      const wantBiomes = [`${tuning.biomeFor(from).id}@${from}`, ...z.stretches.filter((s) => tuning.biomeFor(s.n).id !== tuning.biomeFor(s.n - 1).id).map((s) => `${tuning.biomeFor(s.n).id}@${s.n}`)];
      const got = z.biomes.map((b) => `${b.id}@${b.cp}`);
      if (got.join() !== wantBiomes.join()) problems.push(`seed ${seed}: biomes arrived ${got.join(', ') || 'never'}, wanted ${wantBiomes.join(', ') || 'none'}`);
      problems.push(...z.stoneAbove.map((s) => `seed ${seed}: ${s}`), ...z.lineWrong.map((s) => `seed ${seed}: ${s}`));
      // Setup: shapes were lost, the tower grew past a stretch's end and set to stone.
      if ((z.counts.piece_lost ?? 0) < 3) problems.push(`setup: seed ${seed} lost only ${z.counts.piece_lost ?? 0} shapes`);
      if (!z.stretches.length) problems.push(`setup: seed ${seed} never grew past a stretch's end`);
      if (!z.counts.zen_set) problems.push(`setup: seed ${seed}'s tower never set to stone`);
      if (from >= 7 && !z.counts.hazard_start) problems.push(`setup: seed ${seed} from CP ${from} met no hazard`);
      // Half XP, and quitting doesn't halve it again (Q33). Every stretch grown past pays at least half of
      // a B grade's claim (30).
      const zx = zen.xp(false), zq = zen.xp(true);
      if (zx !== zq) problems.push(`seed ${seed}: Zen pays ${zx}, but ${zq} on quitting`);
      if (zx < 15 * z.stretches.length) problems.push(`seed ${seed}: Zen pays ${zx} for ${z.stretches.length} stretches, under 15 each`);
      // The same seed and inputs build the same tower, step for step.
      const again = own(new game!.api.Sim(opts)) as S;
      const a = play(again, seed, Math.min(seconds, 60));
      const split = a.digests.findIndex((d, i) => d !== z.digests[i]);
      if (split >= 0) problems.push(`seed ${seed}: the same Zen run parts from itself at ${split + 1} s`);
      lines.push(`seed ${seed} from CP ${from}: ${(zen.stats.maxHeight - ground).toFixed(1)} high, ${z.stretches.length} stretches (${z.stretches.map((s) => s.y).join(', ')}), biomes ${got.join(', ') || 'none'}, set line ${zen.foundation.top}, ${z.counts.hazard_start ?? 0} hazards, ${zen.stats.placed} placed, ${z.counts.piece_lost ?? 0} lost, XP ${zx}; replays the same for ${a.digests.length} s`);
      // Quitting is how it ends, with that XP.
      zen.intent({ type: 'quit' });
      zen.step();
      const over = (zen.drainEvents() as Ev[]).find((e) => e.name === 'run_over');
      if (over?.payload.cause !== 'quit' || over.payload.xp !== zx) problems.push(`seed ${seed}: quitting gave run_over ${JSON.stringify(over?.payload)}, wanted cause quit with ${zx} XP`);
      for (const x of live.splice(0)) x.dispose(); // two Box2D worlds at a time
    }
    if (!pastBudget) problems.push('setup: no Zen run went past an ordinary stretch budget, so "no budget" was never tested');
    writeReport({ suite: 'zen', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });
});
