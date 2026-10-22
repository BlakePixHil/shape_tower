// The Daily Tower's rules without a browser (gameplay.md §12, QA F1.7, F17.1, F17.2, D14, Q31, Q32):
// the UTC seed day and its number, one seed for everyone that changes at 00:00 UTC, one scored try per
// seed ever, practice, the streak and the best days, a damaged save, the Daily achievements, each day's
// shape set (§12.3), the rules change on 22 October (v2), and that two players who play the same seed
// differently are dealt the same shapes.
// Run: npm run daily:check

import { BY_ID, freshCounts, grantDaily, progress } from '../src/meta/achievements.ts';
import {
  RULES_V, V2_DAY, addPractice, beginScored, bestDays, countdown, dailyDay, dailyNumber, dailySeed, dailyShapes, dailyStreak, dayOf, freshDaily, ladderReady, loadDaily,
  msToNextDaily, scoredFinished, scoredUsed, updateScored,
} from '../src/meta/daily.ts';
import { createSim } from '../src/sim/testApi.ts';
import type { Profile } from '../src/view/profile.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

const at = (iso: string) => new Date(iso);
const res = (score: number, height = score / 100) => ({ height, score, checkpoints: Math.floor(height / 8), biome: 1 });

// ---------------------------------------------------------------- the seed day

{
  check('the seed day is the UTC date, whatever the time zone', dailyDay(at('2026-10-22T23:59:59.999Z')) === '2026-10-22' && dailyDay(at('2026-10-23T00:00:00Z')) === '2026-10-23'
    && dailyDay(at('2026-10-22T20:00:00-08:00')) === '2026-10-23', dailyDay(at('2026-10-22T20:00:00-08:00')));
  check('Daily #1 is 21 October 2026, #2 the day after, #366 a year on', dailyNumber('2026-10-21') === 1 && dailyNumber('2026-10-22') === 2 && dailyNumber('2027-10-21') === 366
    && dayOf(366) === '2027-10-21' && dayOf(1) === '2026-10-21');
  check('the countdown reaches 00:00 UTC', msToNextDaily(at('2026-10-22T23:59:00Z')) === 60_000 && msToNextDaily(at('2026-10-22T00:00:00Z')) === 86_400_000
    && countdown(9 * 3600_000) === '9h 0m' && countdown(61_000) === '1m' && countdown(59_500) === '1m' && countdown(40_000) === '40s' && countdown(-5) === '0s');
  const seeds = new Set<number>();
  for (let n = 1; n <= 3650; n++) seeds.add(dailySeed(dayOf(n)));
  check('a different 32-bit seed every day for ten years', seeds.size === 3650 && [...seeds].every(s => Number.isInteger(s) && s >= 0 && s <= 0xffffffff), `${seeds.size} distinct`);
  check('the same seed on every device: a fixed hash of the date', dailySeed('2026-10-22') === dailySeed('2026-10-22') && dailySeed('2026-10-22') === 3181824874, String(dailySeed('2026-10-22')));
}

// ---------------------------------------------------------------- one scored try per seed, ever

{
  const s = freshDaily(), day = '2026-10-22';
  check('a new day has its scored try open', !scoredUsed(s, day));
  check('the first spawn spends it (Q32)', beginScored(s, day, at('2026-10-22T10:00:00Z')) && scoredUsed(s, day) && s.scored[day].finished === false);
  check('it can never be started again (F17.1)', !beginScored(s, day) && Object.keys(s.scored).length === 1);
  updateScored(s, day, res(4000));
  updateScored(s, day, res(2500));
  check('progress only grows during the try', s.scored[day].score === 4000 && s.scored[day].height === 40, JSON.stringify(s.scored[day]));
  updateScored(s, day, res(5200), true);
  updateScored(s, day, res(9999), true);
  check('the end result is kept and then frozen', s.scored[day].score === 5200 && s.scored[day].finished, JSON.stringify(s.scored[day]));
  const saved = loadDaily(JSON.parse(JSON.stringify(s)));
  check('a reload keeps it spent (force-quit, reinstall with the save, D14)', scoredUsed(saved, day) && !beginScored(saved, day));
  check('a clock moved back never reopens a played seed (Q31)', scoredUsed(saved, dailyDay(at('2026-10-22T03:00:00Z'))));
  check('a clock moved forward reaches the next seed early (the known offline limit)', !scoredUsed(saved, dailyDay(at('2026-10-23T03:00:00Z'))));
  const died = freshDaily();
  beginScored(died, day);
  updateScored(died, day, res(1800));
  check('a try the app died in stays spent with what it reached', scoredUsed(died, day) && died.scored[day].score === 1800 && !died.scored[day].finished && scoredFinished(died) === 0);
}

// ---------------------------------------------------------------- practice, streak, best days, a damaged save

{
  const s = freshDaily();
  const p1 = addPractice(s, '2026-10-22', { ...res(1000), at: '' });
  const p2 = addPractice(s, '2026-10-22', { ...res(800), at: '' });
  const p3 = addPractice(s, '2026-10-22', { ...res(1500), at: '' });
  check('practice counts runs and keeps the best (score, then height)', s.practice['2026-10-22'].runs === 3 && s.practice['2026-10-22'].best?.score === 1500 && p1 && !p2 && p3);
  check('practice never touches the scored try', !scoredUsed(s, '2026-10-22'));
  addPractice(s, '2026-10-29', { ...res(10), at: '' });
  check('practice older than a week is dropped', !('2026-10-22' in s.practice) && '2026-10-29' in s.practice, Object.keys(s.practice).join());

  const t = freshDaily();
  for (const [d, sc] of [['2026-10-20', 900], ['2026-10-21', 3000], ['2026-10-22', 1200], ['2026-10-23', 3000]] as const) { beginScored(t, d); updateScored(t, d, res(sc, sc === 3000 && d === '2026-10-23' ? 35 : sc / 100), true); }
  check('the streak counts days in a row up to today', dailyStreak(t, '2026-10-23') === 4, String(dailyStreak(t, '2026-10-23')));
  check('today not played yet: the streak still stands from yesterday', dailyStreak(t, '2026-10-24') === 4);
  check('a missed day ends it', dailyStreak(t, '2026-10-25') === 0);
  const best = bestDays(t, 3);
  check('best days: score first, then height, best first', best.map(b => b.day).join() === '2026-10-23,2026-10-21,2026-10-22' && best[0].number === 3, best.map(b => `${b.day}:${b.result.score}/${b.result.height}`).join(' '));

  const bad = loadDaily({ scored: { '2026-10-22': { score: 'lots' }, 'yesterday': res(1), '2026-10-21': { ...res(700), finished: true, at: 'x' } }, practice: { '2026-10-22': { runs: 'x', best: null }, '2026-1': {} } });
  check('a damaged save loads what it can and drops the rest', Object.keys(bad.scored).join() === '2026-10-21' && bad.practice['2026-10-22']?.runs === 0 && !('2026-1' in bad.practice), JSON.stringify(bad));
  check('no save at all is a fresh start', JSON.stringify(loadDaily(undefined)) === JSON.stringify(freshDaily()) && JSON.stringify(loadDaily('junk')) === JSON.stringify(freshDaily()));
}

// ---------------------------------------------------------------- the Daily achievements

{
  const p = { daily: freshDaily(), achievements: {}, achCounts: freshCounts(), stats: { bricks: 0, perfects: 0, rows: 0, checkpoints: 0 }, streak: 0 } as unknown as Profile;
  beginScored(p.daily, '2026-10-21');
  check('an unfinished try earns nothing', grantDaily(p).length === 0);
  updateScored(p.daily, '2026-10-21', res(100), true);
  check('a finished scored try earns Daily Grind once', grantDaily(p).join() === 'daily_first' && grantDaily(p).length === 0);
  for (let n = 2; n <= 12; n++) { const d = dayOf(n); addPractice(p.daily, d, { ...res(50), at: '' }); if (n < 12) { beginScored(p.daily, d); updateScored(p.daily, d, res(100), true); } }
  check('practice doesn\'t count toward Daily Dozen (11 of 12)', grantDaily(p).length === 0 && progress(p, BY_ID.get('daily_12')!)?.join() === '11,12', progress(p, BY_ID.get('daily_12')!)?.join());
  beginScored(p.daily, dayOf(12)); updateScored(p.daily, dayOf(12), res(100), true);
  check('the 12th finished scored try earns Daily Dozen', grantDaily(p).join() === 'daily_12');
}

// ---------------------------------------------------------------- the day's shape set (§12.3)

{
  const RESCUE = ['O', 'I', 'Domino', 'Plank'];
  const sets = Array.from({ length: 3650 }, (_, i) => dailyShapes(dayOf(i + 1)));
  const sizes = sets.map(x => x.length);
  const threes = sizes.filter(n => n === 3).length;
  check('every day deals 3 or 5 shapes, no repeats, each with a flat rescue shape', sets.every(x => (x.length === 3 || x.length === 5) && new Set(x).size === x.length && x.some(k => RESCUE.includes(k))));
  check('about two days in five are 3-shape days', threes > 3650 * 0.35 && threes < 3650 * 0.45, `${threes} of 3650`);
  check('the same set on every device, and it changes day to day', dailyShapes('2026-10-22').join() === dailyShapes('2026-10-22').join() && new Set(sets.slice(0, 30).map(x => x.join())).size >= 25,
    `#2: ${dailyShapes('2026-10-22').join(' ')}`);
  const all = new Set(sets.flat());
  check('over a year every shape has its days', all.size === 14, [...all].join(' '));
}

// ---------------------------------------------------------------- the rules change (v2, 22 October)

{
  const s = freshDaily();
  // A scored try under the old rules on the day the new ones arrived (an app that updated mid-day).
  s.scored[V2_DAY] = { ...res(900), at: '2026-10-22T01:00:00Z', finished: true };
  s.scored['2026-10-21'] = { ...res(700), at: '2026-10-21T09:00:00Z', finished: true };
  check('an old-rules try from before the change still spends its day', scoredUsed(s, '2026-10-21'));
  check("an old-rules try on the change day leaves today's new try open, and isn't on the ladder", !scoredUsed(s, V2_DAY) && !ladderReady(s.scored[V2_DAY]));
  check('the new try replaces it and is ladder-ready', beginScored(s, V2_DAY) && scoredUsed(s, V2_DAY) && s.scored[V2_DAY].v === RULES_V && ladderReady(s.scored[V2_DAY]) && s.scored[V2_DAY].score === 0);
  const back = loadDaily(JSON.parse(JSON.stringify(s)));
  check('a reload keeps the rules version', back.scored[V2_DAY]?.v === RULES_V && scoredUsed(back, V2_DAY));
}

// ---------------------------------------------------------------- the same shapes for everyone (F1.7)

{
  // Two players on Daily #2's seed: one hard-drops each shape across the slab, the other steers left and
  // right, turns and waits (no budget or hearts, so neither run ends first). The bag has its own stream, so both are dealt the same shapes in the same order.
  const seed = dailySeed('2026-10-22'), set = dailyShapes('2026-10-22');
  const dealt = (style: 'drop' | 'steer'): string[] => {
    const t = createSim({ seed, autoSpawn: true, rookieOpening: false, secondWind: 'off', tuning: { holdUnlocked: true, startPower: false, infiniteBudget: true, infiniteHearts: true, shapeSet: set } });
    const out: string[] = [];
    for (let i = 0; i < 60 * 300 && out.length < 20 && t.sim.state === 'playing'; i++) {
      for (const e of t.drainEvents()) if (e.name === 'piece_spawned') out.push(String(e.payload.shape));
      const c = t.controlled();
      if (c && !c.hard) {
        if (style === 'drop') { const x = [-2, 1, -1, 2][out.length % 4]; if (c.xTarget !== x) t.intent({ type: 'moveTo', x }); else t.intent({ type: 'hardDrop' }); }
        else if (i % 37 === 0) t.intent({ type: 'moveTo', x: ((i / 37) % 5) - 2 });
        else if (i % 53 === 0) t.intent({ type: 'rotate', dir: 1 });
        else if (i % 90 === 0) t.intent({ type: 'hardDrop' });
      }
      t.step();
    }
    t.dispose();
    return out;
  };
  const a = dealt('drop'), b = dealt('steer');
  const n = Math.min(a.length, b.length);
  check('two players playing the same seed differently get the same shapes', n >= 12 && a.slice(0, n).join() === b.slice(0, n).join(), `${a.length} and ${b.length} dealt: ${a.slice(0, n).join(' ')}`);
  check("only the day's set falls, and every shape in it turns up", a.every(k => set.includes(k)) && set.every(k => a.includes(k)), `${set.join(' ')}`);
  const q = createSim({ seed, autoSpawn: false, rookieOpening: false, tuning: { shapeSet: set } });
  check('the run deals from the first shape the same way', q.sim.queue.slice(0, 5).join(' ') === a.slice(0, 5).join(' '), q.sim.queue.slice(0, 5).join(' '));
  const day3 = dailyShapes('2026-10-23');
  const other = createSim({ seed: dailySeed('2026-10-23'), autoSpawn: false, rookieOpening: false, tuning: { shapeSet: day3 } });
  check('the next day deals its own set', other.sim.queue.slice(0, 10).every(k => day3.includes(k)) && other.sim.queue.slice(0, 10).join() !== q.sim.queue.slice(0, 10).join(), `${day3.join(' ')}: ${other.sim.queue.slice(0, 10).join(' ')}`);
  q.dispose();
  other.dispose();
}

console.log(failures ? `\n${failures} failed` : '\nall passing');
process.exit(failures ? 1 : 0);
