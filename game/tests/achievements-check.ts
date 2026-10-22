// Achievements (gameplay.md §18.7): every condition from scripted events, each with a near miss,
// exactly-once unlock and XP, the history grant, flat XP in the tally, and a real bot run whose
// digests are the same with the tracker reading it.
// Run: npm run achievements:check

import {
  ACHIEVEMENTS, BY_ID, RunTracker, TIER_POINTS, TIER_XP, freshCounts, grantHistory, grantStreaks, payAchievements, progress,
} from '../src/meta/achievements.ts';
import { readFileSync } from 'node:fs';
import type { BusEvent } from '../src/sim/bus.ts';
import type { Sim } from '../src/sim/sim.ts';
import { createSim } from '../src/sim/testApi.ts';
import { DEFAULT_TUNING, type Tuning } from '../src/sim/tuning.ts';
import { award, updateStreak, type Profile } from '../src/view/profile.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

function profile(over: Partial<Profile> = {}): Profile {
  return {
    level: 1, xp: 0, total: 0, runs: 0, streak: 0, lastDay: '', boostDay: '', askedGhost: false, windDay: '',
    stats: { bestHeight: 0, bestBiome: 1, bricks: 0, perfects: 0, rows: 0, checkpoints: 0, clutches: 0 },
    sliceRuns: 0, player: 'test', seenGusts: false, seenHazards: [], postcards: Array(10).fill(null),
    avatar: { shape: 'O', face: 'idle', hat: 'party' }, achievements: {}, achCounts: freshCounts(), ...over,
  } as Profile;
}

/** A stand-in for the sim: only what the tracker reads. */
function fakeSim(tuning: Partial<Tuning> = {}) {
  return {
    tuning: { ...DEFAULT_TUNING, ...tuning }, hearts: 3, foundations: [{ top: 0 }],
    stats: { placed: 0, perfects: 0, rows: 0, checkpoints: 0, maxHeight: 0 },
  };
}

/** Plays a script of [name, payload] (or [name, payload, step]) and returns the ids earned, in order. */
function play(script: [string, Record<string, unknown>?, number?][], o: { p?: Profile; tuning?: Partial<Tuning>; bestBefore?: number; sim?: ReturnType<typeof fakeSim> } = {}): string[] {
  const p = o.p ?? profile();
  const sim = o.sim ?? fakeSim(o.tuning);
  const got: string[] = [];
  const t = new RunTracker(sim as unknown as Sim, p, { bestBefore: o.bestBefore ?? 0, onUnlock: a => got.push(a.id), save: () => {} });
  let step = 0;
  for (const [name, payload = {}, at] of script) {
    step = at ?? step + 1;
    t.handle({ name, step, payload } as BusEvent);
  }
  return got;
}

const has = (ids: string[], id: string) => ids.includes(id);
const claim = (n: number, grade = 'B', leftover = 3, width = 6): [string, Record<string, unknown>] => ['checkpoint_claimed', { n, grade, leftover, width }];
const restore = (left: number): [string, Record<string, unknown>] => ['heart_restored', { left }];
const lose = (left: number): [string, Record<string, unknown>] => ['heart_lost', { count: 1, left }];
/** Claims 1..n with the usual heart back, entering biomes where the sim would. */
function climb(to: number, from = 1): [string, Record<string, unknown>?][] {
  const out: [string, Record<string, unknown>?][] = [];
  const firsts = [3, 5, 7, 9, 11, 14, 17, 20, 23];
  for (let n = from; n <= to; n++) {
    out.push(claim(n));
    const b = firsts.indexOf(n + 1);
    if (b >= 0) out.push(['biome_entered', { id: b + 2 }]);
  }
  return out;
}

// ---------------------------------------------------------------- the list

{
  const ids = new Set(ACHIEVEMENTS.map(a => a.id));
  check('49 achievements with unique ids', ACHIEVEMENTS.length === 49 && ids.size === 49, `${ACHIEVEMENTS.length} / ${ids.size}`);
  const tiers = { bronze: 0, silver: 0, gold: 0, platinum: 0 };
  for (const a of ACHIEVEMENTS) tiers[a.tier]++;
  check('17 Bronze, 19 Silver, 11 Gold, 2 Platinum (§18.2, with the Daily Tower\'s two)', tiers.bronze === 17 && tiers.silver === 19 && tiers.gold === 11 && tiers.platinum === 2, JSON.stringify(tiers));
  const xp = ACHIEVEMENTS.reduce((s, a) => s + TIER_XP[a.tier], 0);
  const pts = ACHIEVEMENTS.reduce((s, a) => s + TIER_POINTS[a.tier], 0);
  check('All XP adds up to 2,890 (§18.1)', xp === 2890, String(xp));
  check('Console points 955, under 1,000, each a multiple of 5 and at most 100 (§18.5)', pts === 955 && Object.values(TIER_POINTS).every(v => v % 5 === 0 && v <= 100), String(pts));
  // Read as text: Art's icon module needs a canvas to load.
  const kit = readFileSync(new URL('../../art/src/ui/icons.ts', import.meta.url).pathname, 'utf8');
  const icons = new Set([...(/UI_ICONS = \[([^\]]*)\]/.exec(kit)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(m => m[1]));
  const bad = ACHIEVEMENTS.filter(a => !icons.has(a.icon)).map(a => `${a.id}:${a.icon}`);
  check("Every badge's glyph is in Art's UI_ICONS", icons.size > 40 && bad.length === 0, bad.join(', ') || `${icons.size} icons`);
  const biomes = ACHIEVEMENTS.filter(a => a.biome !== undefined).map(a => a.biome!);
  check('Biome badges name biomes 2 to 10 (1 = Meadow; Art counts from 0)', biomes.join() === '2,3,4,5,6,7,8,9,10', biomes.join());
}

// ---------------------------------------------------------------- climb

{
  check('First claim: Off the Ground', has(play([claim(1)]), 'cp_first'));
  const ids = play(climb(22));
  check('Every biome from the Treetops to Deep Cosmos on biome_entered', [2, 3, 4, 5, 6, 7, 8, 9, 10].every(b => has(ids, `biome_${b}`)));
  check('Meadow (biome 1) is not an achievement', !has(play([['biome_entered', { id: 1 }]]), 'biome_1'));
  check('Checkpoint 30 earns Off the Map; 29 does not', has(play([claim(30)]), 'cp_30') && !has(play([claim(29)]), 'cp_30'));
  const sim = fakeSim();
  sim.stats.maxHeight = 10.04;
  check('Best height by 0.04 is not New Heights', !has(play([['piece_settled', { id: 1, grade: 'clean' }]], { sim, bestBefore: 10 }), 'pb'));
  sim.stats.maxHeight = 10.1;
  check('Best height by 0.1 is New Heights', has(play([['piece_settled', { id: 1, grade: 'clean' }]], { sim, bestBefore: 10 }), 'pb'));
  check('No best yet: no New Heights', !has(play([['piece_settled', { id: 1, grade: 'clean' }]], { sim, bestBefore: 0 }), 'pb'));
}

// ---------------------------------------------------------------- craft

{
  const combo = (n: number) => play(Array.from({ length: n }, (_, i) => ['perfect', { combo: i + 1 }] as [string, Record<string, unknown>]));
  check('A Perfect: Pixel Perfect', has(combo(1), 'perfect'));
  check('Combo 4: no In the Zone; 5: yes', !has(combo(4), 'combo_5') && has(combo(5), 'combo_5'));
  check('Combo 6: no Seventh Heaven; 7: yes', !has(combo(6), 'combo_7') && has(combo(7), 'combo_7'));
  const rows = (n: number) => play([['row_solid', { count: n }]]);
  check('Rows from one shape: 1 Solid Ground, 2 Double!, 3 Triple!', has(rows(1), 'row') && !has(rows(1), 'row_2') && has(rows(2), 'row_2') && !has(rows(2), 'row_3') && has(rows(3), 'row_3'));
  check('S grade: Flat Out', has(play([claim(1, 'S')]), 'grade_s') && !has(play([claim(1, 'A')]), 'grade_s'));
  check('S, S, A, S: no Spirit Level', !has(play([claim(1, 'S'), claim(2, 'S'), claim(3, 'A'), claim(4, 'S')]), 'grade_s3'));
  check('S, S, S: Spirit Level', has(play([claim(1, 'S'), claim(2, 'S'), claim(3, 'S')]), 'grade_s3'));
  check('Penny Pincher: A with 8 spare yes, A with 7 no, B with 10 no',
    has(play([claim(1, 'A', 8)]), 'thrifty') && !has(play([claim(1, 'A', 7)]), 'thrifty') && !has(play([claim(1, 'B', 10)]), 'thrifty'));
  check('Just Enough: 0 left yes, 1 left no, endless budget no',
    has(play([claim(1, 'B', 0)]), 'last_brick') && !has(play([claim(1, 'B', 1)]), 'last_brick') && !has(play([claim(1, 'B', 0)], { tuning: { infiniteBudget: true } }), 'last_brick'));
  check('Needle Threader: the narrowest slab for the claim at C (10 wide at CP 1, 6 at CP 11) yes, a block wider no, B no',
    has(play([claim(1, 'C', 3, 10)]), 'needle') && !has(play([claim(1, 'C', 3, 11)]), 'needle') && !has(play([claim(1, 'B', 3, 10)]), 'needle') &&
    has(play([claim(11, 'C', 3, 6)]), 'needle') && !has(play([claim(11, 'C', 3, 7)]), 'needle'));
  check('Clutch: one earns Clutch!, two not Nerves of Steel, three yes',
    has(play([['clutch']]), 'clutch') && !has(play([['clutch'], ['clutch']]), 'clutch_3') && has(play([['clutch'], ['clutch'], ['clutch']]), 'clutch_3'));
}

// ---------------------------------------------------------------- survive

{
  // On the last heart: the claim's heart_restored comes just before checkpoint_claimed.
  check('By a Thread: 1 heart, claim gives one back', has(play([lose(2), lose(1), restore(2), claim(1)]), 'last_heart'));
  check('By a Thread: 2 hearts is a miss', !has(play([lose(2), restore(3), claim(1)]), 'last_heart'));
  check('By a Thread: 1 heart, late claim with no heart back', has(play([lose(2), lose(1), claim(12)]), 'last_heart'));
  check('By a Thread: Second Wind earlier in the run refilled hearts', !has(play([lose(2), lose(1), ['second_wind', { hearts: 3 }], restore(3), ['piece_landed', { id: 1, shape: 'O' }], claim(1)]), 'last_heart'));
  const calm = climb(4);
  check('Weathervane: through the Treetops with no heart lost', has(play(calm), 'calm_2'));
  const hit3 = [...climb(2), lose(2), ...climb(4, 3)];
  check('Weathervane: a heart lost in stretch 3 misses it', !has(play(hit3), 'calm_2'));
  const hit2 = [claim(1), lose(2), ...climb(4, 2)];
  check('A heart lost in the Meadow: Weathervane yes, Steady Hands no', has(play(hit2), 'calm_2') && !has(play(hit2), 'flawless_3'));
  check('Steady Hands: Cloudlands with no heart lost', has(play(climb(4)), 'flawless_3'));
  // A heart lost on the same step as a claim, after it, belongs to the next stretch.
  const sameStep: [string, Record<string, unknown>?, number?][] = [claim(1, 'B', 3, 6), claim(2), ['biome_entered', { id: 2 }], claim(3, 'B', 3, 6), ['heart_lost', { count: 1, left: 2 }, 4], claim(4, 'B', 3, 6)];
  sameStep[3][2] = 4;
  check('A heart lost right after claim 3 (same step) counts in stretch 4: no Weathervane', !has(play(sameStep), 'calm_2'));
  check('Iron Tower: Orbit with no heart lost; one lost anywhere misses it', has(play(climb(10)), 'flawless_6') && !has(play([...climb(5), lose(2), ...climb(10, 6)]), 'flawless_6'));
  check('Eye of the Storm, Dodgeball, Meteor Proof: their biomes clean', ['calm_4', 'calm_6', 'calm_7'].every(id => has(play(climb(16)), id)));
  check('Meteor Proof: a heart lost at CP 15 misses only the Moon', (() => { const ids = play([...climb(14), lose(2), ...climb(16, 15)]); return !has(ids, 'calm_7') && has(ids, 'calm_6'); })());
}

// ---------------------------------------------------------------- power-ups

{
  const p = profile();
  check('Bubble Pop on a bubble', has(play([['power_collected', { kind: 'glue' }]], { p }), 'bubble') && p.achCounts.bubbles === 1);
  const p49 = profile({ achCounts: { bubbles: 49, powers: [] } });
  check('Bubble Wrap: the 50th bubble', has(play([['power_collected', { kind: 'glue' }]], { p: p49 }), 'bubbles_50'));
  const tp = profile();
  const four = ['clean', 'quickset', 'undo', 'glue', 'glue'].map(k => ['power_used', { kind: k, shape: 'O' }] as [string, Record<string, unknown>]);
  check('Toolbox: four kinds (one twice) no', !has(play(four, { p: tp }), 'toolbox') && tp.achCounts.powers.length === 4);
  check('Toolbox: the fifth kind in a later run', has(play([['power_used', { kind: 'slowmo' }]], { p: tp }), 'toolbox'));
  check('Toolbox progress shows 5 / 5', JSON.stringify(progress(tp, BY_ID.get('toolbox')!)) === '[5,5]');
  const wind = (more: number) => play([claim(1), claim(2), ['second_wind', { hearts: 3 }], ...climb(2 + more, 3)]);
  check('Comeback Kid: 3 claims after Second Wind yes, 2 no', has(wind(3), 'comeback') && !has(wind(2), 'comeback'));
  check('No Help Needed: Storm Belt untouched', has(play(climb(6)), 'purist'));
  check('No Help Needed: a power used misses it', !has(play([claim(1), ['power_used', { kind: 'glue' }], ...climb(6, 2)]), 'purist'));
  check('No Help Needed: Second Wind used misses it', !has(play([claim(1), claim(2), ['second_wind', { hearts: 3 }], ...climb(6, 3)]), 'purist'));
}

// ---------------------------------------------------------------- lifetime

{
  const p = profile();
  p.stats.bricks = 999;
  const sim = fakeSim();
  sim.stats.placed = 1;
  check('Brick by Brick: the 1,000th brick, mid-run', has(play([['piece_landed', { id: 1, shape: 'O' }]], { p, sim }), 'bricks_1k'));
  const p2 = profile();
  p2.stats.bricks = 998;
  check('999 bricks is a miss', !has(play([['piece_landed', { id: 1, shape: 'O' }]], { p: p2, sim }), 'bricks_1k'));
  const p3 = profile();
  p3.stats.perfects = 249;
  const s3 = fakeSim();
  s3.stats.perfects = 1;
  check('Perfectionist: the 250th Perfect', has(play([['perfect', { combo: 1 }]], { p: p3, sim: s3 }), 'perfects_250'));
  const p4 = profile();
  p4.stats.checkpoints = 99;
  const s4 = fakeSim();
  s4.stats.checkpoints = 1;
  check('Centurion: the 100th checkpoint', has(play([claim(1)], { p: p4, sim: s4 }), 'cps_100'));
  const sp = profile({ streak: 2, lastDay: '2026-10-20' });
  updateStreak(sp, new Date(2026, 9, 21, 12));
  const ids = grantStreaks(sp, new Date(2026, 9, 21, 12));
  check('Hooked on the third day in a row, not Creature of Habit', ids.includes('streak_3') && !ids.includes('streak_7'), `streak ${sp.streak}, ${ids}`);
  const gap = profile({ streak: 6, lastDay: '2026-10-19' });
  updateStreak(gap, new Date(2026, 9, 21, 12));
  check('A missed day resets the streak: no Creature of Habit', !grantStreaks(gap).includes('streak_7') && gap.streak === 1);
}

// ---------------------------------------------------------------- secret

{
  const lost = (steps: number[]) => play(steps.map(s => ['piece_lost', { id: s, shape: 'O' }, s] as [string, Record<string, unknown>, number]));
  check('Avalanche!: 5 lost, each within 1.5 s', has(lost([10, 40, 70, 100, 130]), 'avalanche'));
  check('Avalanche!: 4 lost is a miss', !has(lost([10, 40, 70, 100]), 'avalanche'));
  check('Avalanche!: a 1.6 s gap splits the tumble', !has(lost([10, 40, 70, 166, 196]), 'avalanche'));
  const over = (cause: string) => ['run_over', { cause }] as [string, Record<string, unknown>];
  check('So Close!: a block from the line, out of bricks', has(play([['checkpoint_near', { blocks: 2 }], ['checkpoint_near', { blocks: 1 }], over('bricks')]), 'so_close'));
  check('So Close!: two blocks away is a miss', !has(play([['checkpoint_near', { blocks: 2 }], over('bricks')]), 'so_close'));
  check('So Close!: a hold that slipped counts', has(play([['checkpoint_hold', { progress: 0 }], ['checkpoint_cancelled'], over('bricks')]), 'so_close'));
  check('So Close!: out of hearts is a miss', !has(play([['checkpoint_near', { blocks: 1 }], over('hearts')]), 'so_close'));
  check('So Close!: near the last line, not this one', !has(play([['checkpoint_near', { blocks: 1 }], claim(1), over('bricks')]), 'so_close'));
  const undo = (grade: string) => play([['power_used', { kind: 'undo', shape: 'T', id: 4 }], ['piece_landed', { id: 9, shape: 'T' }], ['piece_settled', { id: 9, grade }]]);
  check('Do-Over: the undone shape placed Perfect', has(undo('perfect'), 'do_over'));
  check('Do-Over: placed Clean is a miss', !has(undo('clean'), 'do_over'));
  check('Do-Over: another piece settling Perfect is a miss', !has(play([['power_used', { kind: 'undo', shape: 'T' }], ['piece_landed', { id: 9, shape: 'T' }], ['piece_settled', { id: 3, grade: 'perfect' }]]), 'do_over'));
}

// ---------------------------------------------------------------- once, Zen, after the run

{
  const p = profile();
  const first = play([claim(1, 'S'), ['perfect', { combo: 1 }]], { p });
  const again = play([claim(1, 'S'), ['perfect', { combo: 1 }]], { p });
  check('Each achievement unlocks once across runs', first.length === 3 && again.length === 0, `${first} / ${again}`);
  const zen = play([claim(1, 'S', 0, 3), ['perfect', { combo: 7 }], ['piece_landed', { id: 1, shape: 'O' }]], { tuning: { infiniteBudget: true, infiniteHearts: true }, p: Object.assign(profile(), { stats: { ...profile().stats, bricks: 1500 } }) });
  check('Zen: run feats stay locked, lifetime counts still move', zen.length === 1 && zen[0] === 'bricks_1k', String(zen));
  check('Nothing counts after run_over', play([['run_over', { cause: 'hearts' }], claim(1)]).length === 0);
}

// ---------------------------------------------------------------- XP

{
  const p = profile();
  for (const id of ['cp_first', 'biome_2', 'grade_s', 'combo_7', 'biome_10']) p.achievements[id] = { at: '2026-10-21', paid: false };
  const pay = payAchievements(p);
  // In list order: Off the Ground, Branching Out, Into the Deep, then Flat Out and Seventh Heaven share a line.
  check('Pay: three named lines and one for the rest', pay.lines.length === 4 && pay.lines[2][0] === '🏆 Into the Deep' && pay.lines[3][0] === '🏆 2 more' && pay.lines[3][1] === '+150', JSON.stringify(pay.lines));
  check('Pay: 20 + 20 + 50 + 100 + 250 = 440 XP', pay.xp === 440, String(pay.xp));
  check('Pay: marked paid, so paying again is empty', payAchievements(p).xp === 0 && Object.values(p.achievements).every(s => s.paid));
  // Flat XP: Daily Boost and streak multiply the run, not the achievements; a quit doesn't halve them.
  const now = new Date(2026, 9, 21, 12);
  const base = (extra?: { lines: [string, string][]; xp: number }, quit = false) => {
    const q = profile({ runs: 5, total: 5000, level: 8, streak: 4, lastDay: '2026-10-20' });
    return award(q, 200, { newBest: false, quit, now, extra }).gained;
  };
  const plain = base(), withAch = base({ lines: [['🏆 Liftoff', '+50']], xp: 50 });
  check('Award: achievement XP is added flat after the boosts', withAch - plain === 50, `${plain} -> ${withAch}`);
  check('Award: a quit run still pays it in full', base({ lines: [['🏆 Liftoff', '+50']], xp: 50 }, true) - base(undefined, true) === 50);
}

// ---------------------------------------------------------------- history

{
  const p = profile({ streak: 3 });
  Object.assign(p.stats, { bestBiome: 4, checkpoints: 12, perfects: 30, rows: 0, clutches: 2, bricks: 1200 });
  const ids = grantHistory(p);
  const want = ['cp_first', 'biome_2', 'biome_3', 'biome_4', 'perfect', 'clutch', 'bricks_1k', 'streak_3'];
  check('History: grants what the stats prove', want.every(id => ids.includes(id)) && ids.length === want.length, String(ids));
  check('History: nothing twice, and unpaid until a tally', grantHistory(p).length === 0 && ids.every(id => !p.achievements[id].paid));
}

// ---------------------------------------------------------------- a real run

// A bot run with the tracker reading every event: same digests as without it, and the obvious ones earned.
{
  const runBot = (track: boolean) => {
    const t = createSim({ autoSpawn: true, rookieOpening: true, seed: 11 });
    const p = profile();
    const got: string[] = [];
    const tracker = track ? new RunTracker(t.sim, p, { bestBefore: 0, onUnlock: a => got.push(a.id), save: () => {} }) : null;
    const digests: string[] = [];
    let landed = 0;
    for (let i = 0; i < 60 * 150; i++) {
      const c = t.sim.ctrl;
      if (c && c.speed > 0 && !c.hard) {
        const f = t.sim.foundation;
        const x = f.x - f.width / 2 + 1 + ((landed * 2) % Math.max(1, f.width - 1));
        if (Math.abs(c.x - x) > 0.01) t.intent({ type: 'moveTo', x });
        else t.intent({ type: 'hardDrop' });
      }
      t.step();
      for (const e of t.drainEvents()) {
        if (e.name === 'piece_landed') landed++;
        tracker?.handle(e as BusEvent);
      }
      if (t.stepIndex % 60 === 0) digests.push(t.digest());
      if (t.sim.state === 'over') break;
    }
    const out = { digests, got, cp: t.sim.stats.checkpoints, steps: t.stepIndex };
    t.dispose();
    return out;
  };
  const a = runBot(true), b = runBot(false);
  // A wall at line height across the 12-wide plinth claims checkpoint 1 with an S foundation (sim-smoke's setup), read live.
  {
    const t = createSim({});
    const got: string[] = [];
    const tracker = new RunTracker(t.sim, profile(), { bestBefore: 0, onUnlock: x => got.push(x.id), save: () => {} });
    for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) t.placePiece({ shape: 'O', x: -5 + col * 2, y: 1 + row * 2 + 0.001 * row });
    for (let i = 0; i < 660; i++) { t.step(); for (const e of t.drainEvents()) tracker.handle(e as BusEvent); }
    check('A real claim with an S foundation earns Off the Ground and Flat Out', got.includes('cp_first') && got.includes('grade_s'), got.join(', '));
    t.dispose();
  }
  check('A tracked bot run has the same digests as an untracked one', a.digests.length > 10 && a.digests.join() === b.digests.join(), `${a.digests.length} digests`);
  check('The bot run earns Off the Ground when it claims', a.cp === 0 || a.got.includes('cp_first'), `claims ${a.cp}, earned ${a.got.join(', ')}`);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
