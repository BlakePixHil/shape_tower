// A week of clips, one a day from Monday: the bot plays a few dozen runs, the best moment of each
// format is picked, and each one is filmed, mixed and captioned. Writes the MP4s, a cover frame for
// each, posts.md (what to post each day) and plan.json (enough to film any clip again).
//
//   node --experimental-strip-types scripts/weekly.ts [--week 2026-11-02] [--out <folder>] [--only 3] [--no-build]
//
// Default week: the next Monday. Default folder: /mnt/project-files/marketing/clips/<week>/.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkWords, clipFor, ctaFor, type Post } from '../src/clips.ts';
import { ROOT, launch, renderClip } from '../src/render.ts';
import { findMoments, playRun, specFor, type Moment, type RunResult } from '../src/runs.ts';
import { dailyNumber } from '../../game/src/meta/daily.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const DAY_MS = 86400000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const nextMonday = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return iso(d.getTime() + (((8 - d.getUTCDay()) % 7) || 7) * DAY_MS); };
const week = flag('--week') ?? nextMonday();
if (new Date(`${week}T00:00:00Z`).getUTCDay() !== 1) throw new Error(`--week ${week} is not a Monday`);
const out = flag('--out') ?? `/mnt/project-files/marketing/clips/${week}`;
const only = flag('--only') ? Number(flag('--only')) : null;
const dayOf = (i: number) => iso(Date.parse(`${week}T00:00:00Z`) + i * DAY_MS);
const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
/** The share server's store redirect (online/cloudflare, #101): the one link every account's bio carries. */
const BIO_LINK = 'https://shape-tower.shape-tower.workers.dev/get';

/** The week's slots: which format goes out which day (the plan's formats; the solo-dev one is Blake's). */
const SLOTS: Moment['kind'][] = ['collapse', 'clutch', 'daily', 'checkpoint', 'combo', 'climb', 'soclose'];

// ------------------------------------------------------------------ the runs
const base = Date.parse(`${week}T00:00:00Z`) / DAY_MS; // a different set of seeds every week
const runs: RunResult[] = [];
const t0 = Date.now();
for (let k = 0; k < 18; k++) {
  const style = (['careful', 'sloppy', 'reckless'] as const)[k % 3];
  runs.push(playRun(specFor('endless', base * 100 + k, style, base * 100 + k + 7)));
}
const dailyDay = dayOf(SLOTS.indexOf('daily'));
runs.push(playRun(specFor('daily', 0, 'careful', base, { day: dailyDay })));
runs.push(playRun(specFor('zen', base * 100 + 99, 'careful', base, { quitAt: { biome: 10, placed: 3 }, maxSteps: 40 * 60 * 60 })));
console.log(`${runs.length} runs in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// ------------------------------------------------------------------ the picks
const moments = runs.flatMap(run => findMoments(run).map(m => ({ run, m })));
const used = new Set<RunResult>();
const picks: { day: string; slot: number; run: RunResult; m: Moment }[] = [];
// The climb is the Zen run's and the Daily is its own; every other format comes from Endless runs.
const modeFor = (kind: Moment['kind']) => (kind === 'climb' ? 'zen' : kind === 'daily' ? 'daily' : 'endless');
const order = [...SLOTS.keys()].sort((a, b) => Number(modeFor(SLOTS[b]) !== 'endless') - Number(modeFor(SLOTS[a]) !== 'endless'));
for (const slot of order) {
  const kind = SLOTS[slot];
  const of = (k: Moment['kind']) => moments.filter(x => x.m.kind === k && x.run.spec.mode === modeFor(kind) && x.m.from > 600 && !picks.some(p => p.m === x.m)).sort((a, b) => b.m.score - a.m.score);
  const pool = of(kind);
  // A run films once a week where it can, so the week shows different towers.
  const best = pool.find(x => !used.has(x.run)) ?? pool[0] ?? (kind === 'soclose' ? of('collapse').find(x => !used.has(x.run)) : undefined);
  if (!best) { console.log(`no ${kind} moment this week`); continue; }
  used.add(best.run);
  picks.push({ day: dayOf(slot), slot, run: best.run, m: best.m });
}
picks.sort((a, b) => a.slot - b.slot);

// ------------------------------------------------------------------ the clips
for (const p of picks) console.log(`${p.day} ${p.m.kind}: ${p.run.spec.mode} ${p.run.spec.bot.style} seed ${p.run.spec.seed}, steps ${p.m.from}-${p.m.to}, ${JSON.stringify(p.m.facts)}`);
if (args.includes('--dry')) process.exit(0);
if (!args.includes('--no-build')) {
  const b = spawnSync('npm', ['run', 'build:app'], { cwd: join(ROOT, 'game'), stdio: 'inherit' });
  if (b.status !== 0) throw new Error('game build failed');
}
mkdirSync(out, { recursive: true });
const browser = await launch();
const posts: Post[] = [];
const plan: unknown[] = [];
try {
  for (const p of picks) {
    if (only !== null && p.slot + 1 !== only) continue;
    const c = clipFor(p.run, p.m, p.slot + base);
    const name = `${String(p.slot + 1).padStart(2, '0')}-${DOW[p.slot]}-${p.m.kind}`;
    checkWords(c.text, ...c.job.captions.flatMap(x => x.lines.map(l => l.text)));
    console.log(`${name}: ${p.run.spec.mode} seed ${p.run.spec.seed} (${p.run.spec.bot.style}), ${JSON.stringify(p.m.facts)}`);
    const r = await renderClip(browser, {
      run: p.run, ...c.job, end: ctaFor(p.day), out: join(out, `${name}.mp4`),
      cover: { at: 1500, path: join(out, `${name}.jpg`) }, log: s => console.log(`  ${s}`),
    });
    if (r.problems.length) console.log(`  PROBLEMS: ${r.problems.join('; ')}`);
    console.log(`  ${r.seconds.toFixed(1)} s`);
    posts.push({ file: `${name}.mp4`, kind: p.m.kind, day: p.day, title: c.title, text: c.text, tags: c.tags });
    plan.push({ file: `${name}.mp4`, day: p.day, spec: p.run.spec, moment: p.m, seconds: Math.round(r.seconds * 10) / 10, problems: r.problems });
  }
} finally {
  await browser.close();
}

const lines = [
  `# Shape Tower clips, week of ${week}`,
  '',
  'One clip a day on TikTok, YouTube Shorts and Instagram Reels (the same clip on all three). Each is 1080 x 1920 at 30 fps with the game\'s own sound; the captions are already in the video. The .jpg next to each clip is a cover frame if a platform asks for one.',
  '',
  ...posts.flatMap(p => [
    `## ${new Date(`${p.day}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}: ${p.title}`,
    '',
    `File: ${p.file}`,
    '',
    '```',
    `${p.text} ${p.tags.join(' ')}`,
    '```',
    '',
  ]),
  `Bio link for every account: ${BIO_LINK} (a phone goes straight to its store page; Play's page opens to everyone once pre-registration starts on 26 November).`,
  '',
  `Daily #${dailyNumber(dailyDay)} is ${dailyDay}. Made by marketing/scripts/weekly.ts; plan.json has each clip's run and moment.`,
];
if (only === null) {
  writeFileSync(join(out, 'posts.md'), lines.join('\n') + '\n');
  writeFileSync(join(out, 'plan.json'), JSON.stringify(plan, null, 1));
}
console.log(`done: ${out}`);
