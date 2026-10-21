// Zen (F17.4, Q33; gameplay.md §12.1, #57). Game only, on builds whose tuning has `zen`. Zen is Endless
// with nothing to count and nothing to lose: no budget, no hearts, no Second Wind, exactly half XP, and
// only quitting ends it. Everything else is Endless, so a Zen run and an Endless run with unlimited
// hearts and budget and Second Wind off, on the same seed with the same player, stay step for step the
// same. Gameplay's sim:smoke checks one Zen run against itself; this checks Zen against Endless.
import { afterEach, describe, expect, it } from 'vitest';
import { FULL, loadSim } from '../src/adapters/index';
import { Bot, type BotSim } from '../src/bot';
import { loadGameApi } from '../src/game-api';
import { writeReport } from '../src/report';

const sut = await loadSim();
const game = await loadGameApi(sut);
const zenny = (() => {
  if (!game) return false;
  const probe = new game.api.Sim({ seed: 1, autoSpawn: false });
  const has = typeof (probe.tuning as Record<string, unknown>).zen === 'boolean';
  probe.dispose();
  return has;
})();

type Ev = { name: string; step: number; payload: Record<string, any> };
type S = BotSim & Record<string, any>;

const live: { dispose(): void }[] = [];
const own = <X>(x: X): X => (live.push(x as unknown as { dispose(): void }), x);
afterEach(() => {
  for (const x of live.splice(0)) x.dispose();
});

// Events Zen never sends (§12.1): nothing to count, nothing to lose, no Second Wind.
const NEVER = ['heart_lost', 'last_heart', 'budget_low', 'bricks_out', 'second_wind_ready', 'second_wind', 'run_over'];

/** QA's bot plays, and every fourth shape is thrown off the edge so some are lost. */
function play(sim: S, seed: number, seconds: number, counts: Record<string, number>, digests: string[]): void {
  const bot = new Bot({ seed, naturalFall: 0.3 }, game!.shapes.extents);
  let spawned = 0, toss = false;
  while (sim.stepIndex < 60 * seconds && sim.state === 'playing') {
    const c = sim.ctrl as { hard?: boolean } | null;
    if (toss && c && !c.hard) {
      sim.intent({ type: 'moveTo', x: sim.foundation.x + 7 });
      sim.intent({ type: 'hardDrop' });
    } else bot.tick(sim);
    sim.step();
    if (sim.used > sim.budget) counts.pastBudget = 1;
    for (const e of sim.drainEvents() as Ev[]) {
      counts[e.name] = (counts[e.name] ?? 0) + 1;
      if (e.name === 'piece_spawned') toss = ++spawned % 4 === 0;
    }
    if (sim.stepIndex % 60 === 0) digests.push(sim.digest());
  }
}

describe.runIf(zenny)(`Zen on ${sut.kind} (${sut.engine})`, () => {
  it('F17.4 Zen is Endless with no budget, no hearts and no Second Wind: the same seed and player give the same tower step for step, no loss is ever counted, and only quitting ends the run', () => {
    const problems: string[] = [];
    const lines: string[] = [];
    const seconds = FULL ? 300 : 150;
    let pastBudget = 0;
    for (const seed of FULL ? [1, 2, 3, 4, 5, 6] : [1, 2]) {
      const zen = own(new game!.api.Sim({ seed, tuning: { zen: true }, secondWind: 'ready', autoSpawn: true, rookieOpening: false })) as S;
      const endless = own(new game!.api.Sim({ seed, tuning: { infiniteHearts: true, infiniteBudget: true }, secondWind: 'off', autoSpawn: true, rookieOpening: false })) as S;
      if (zen.secondWind !== 'off') problems.push(`seed ${seed}: Zen asked for Second Wind 'ready' and got '${zen.secondWind}', not 'off'`);
      const zc: Record<string, number> = {}, ec: Record<string, number> = {};
      const zd: string[] = [], ed: string[] = [];
      play(zen, seed, seconds, zc, zd);
      play(endless, seed, seconds, ec, ed);
      pastBudget += zc.pastBudget ?? 0;
      const split = zd.findIndex((d, i) => d !== ed[i]);
      if (split >= 0 || zd.length !== ed.length) problems.push(`seed ${seed}: Zen and Endless part at ${split >= 0 ? split + 1 : Math.min(zd.length, ed.length)} s (${zd.length} and ${ed.length} digests)`);
      for (const n of NEVER) if (zc[n]) problems.push(`seed ${seed}: Zen sent ${n} ${zc[n]} times`);
      if (zen.state !== 'playing') problems.push(`seed ${seed}: the Zen run ended on its own (${zen.state}, ${zen.cause})`);
      const hearts = (zen.tuning as Record<string, unknown>).hearts;
      if (zen.hearts !== hearts) problems.push(`seed ${seed}: Zen hearts went from ${hearts} to ${zen.hearts}`);
      // Setup: shapes were lost, the run went past an ordinary budget, and there was something to claim.
      if ((zc.piece_lost ?? 0) < 3) problems.push(`setup: seed ${seed} lost only ${zc.piece_lost ?? 0} shapes`);
      if (!ec.heart_lost) problems.push(`setup: seed ${seed}'s Endless twin lost no heart, so the comparison shows nothing`);
      // Exactly half the twin's XP, and quitting doesn't halve it again (Q33).
      const zx = zen.xp(false), zq = zen.xp(true), ex = endless.xp(false), eq = endless.xp(true);
      if (zx !== zq) problems.push(`seed ${seed}: Zen pays ${zx}, but ${zq} on quitting`);
      if (Math.abs(ex / 2 - zx) > 0.5 || zx !== eq) problems.push(`seed ${seed}: Zen pays ${zx}; Endless pays ${ex}, ${eq} on quitting`);
      lines.push(`seed ${seed}: ${zd.length} s the same as Endless, ${zen.stats.placed} placed, ${zc.piece_lost ?? 0} lost (Endless twin ${ec.heart_lost ?? 0} heart_lost), CP ${zen.stats.checkpoints}, XP ${zx} against Endless ${ex}`);
      // Quitting is how it ends, with that XP.
      zen.intent({ type: 'quit' });
      zen.step();
      const over = (zen.drainEvents() as Ev[]).find((e) => e.name === 'run_over');
      if (over?.payload.cause !== 'quit' || over.payload.xp !== zx) problems.push(`seed ${seed}: quitting gave run_over ${JSON.stringify(over?.payload)}, wanted cause quit with ${zx} XP`);
    }
    if (!pastBudget) problems.push('setup: no Zen run went past an ordinary stretch budget, so "no budget" was never tested');
    writeReport({ suite: 'zen', sim: sut, full: FULL }, problems.length ? 'fail' : 'pass', [...lines, ...problems.map((p) => `FAIL ${p}`)], {});
    expect(problems).toEqual([]);
  });
});
