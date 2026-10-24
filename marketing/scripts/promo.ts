// The 30 second promo video for the store listing (and a pinned post): six beats of real play cut
// together, a tower falling in the first two seconds, the climb to deep space last, then the logo.
// Each beat is filmed like a clip (src/render.ts) with the game's own sound; ffmpeg joins them with
// short cross-fades.
//
//   node --experimental-strip-types scripts/promo.ts [--out <file>] [--no-build]
//
// Default file: /mnt/project-files/marketing/promo/shape-tower-promo.mp4 (and a .jpg cover beside it).

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkWords } from '../src/clips.ts';
import { ROOT, launch, renderClip, type Caption, type ClipJob } from '../src/render.ts';
import { findMoments, playRun, specFor, type Moment, type RunResult } from '../src/runs.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = flag('--out') ?? '/mnt/project-files/marketing/promo/shape-tower-promo.mp4';
/** Seconds each cut overlaps the next. */
const FADE = 0.2;

// ------------------------------------------------------------------ the runs (the first weekly batch's)
const run = {
  collapse: playRun(specFor('endless', 2075900, 'careful', 2075907)),
  checkpoint: playRun(specFor('endless', 2075906, 'careful', 2075913)),
  combo: playRun(specFor('endless', 2075909, 'careful', 2075916)),
  clutch: playRun(specFor('endless', 2075911, 'reckless', 2075918)),
  daily: playRun(specFor('daily', 0, 'careful', 20759, { day: '2026-11-04' })),
  zen: playRun(specFor('zen', 2075999, 'careful', 20759, { quitAt: { biome: 10, placed: 3 }, maxSteps: 40 * 60 * 60 })),
};
const best = (r: RunResult, kind: Moment['kind']) => {
  const m = findMoments(r).filter(x => x.kind === kind).sort((a, b) => b.score - a.score)[0];
  if (!m) throw new Error(`no ${kind} moment in seed ${r.spec.seed}`);
  return m;
};
const first = (r: RunResult, name: string, after: number) => r.events.find(e => e.name === name && e.s >= after && !e.p.brittle)!.s;

const cap = (at: number, lines: Caption['lines'], size = 40): Caption => ({ at, lines, size });
const capAt = (step: number, lines: Caption['lines'], size = 46): Caption => ({ atStep: step, lines, size });

// ------------------------------------------------------------------ the beats
type Beat = Omit<ClipJob, 'out'>;
const beats: Beat[] = [];
{
  // 1. The hook: a tall tower already toppling.
  const m = best(run.collapse, 'collapse'), lost = first(run.collapse, 'piece_lost', m.from);
  beats.push({ run: run.collapse, from: lost - 40, to: lost + 600, maxMs: 4200, captions: [cap(0, [{ text: 'One sloppy drop…', hi: true }]), capAt(lost + 20, [{ text: 'TIMBER!', hi: true }])] });
}
{
  // 2. The checkpoint hold, and the claim.
  const m = best(run.checkpoint, 'checkpoint'), claim = first(run.checkpoint, 'checkpoint_claimed', m.from);
  beats.push({ run: run.checkpoint, from: claim - 210, to: claim + 120, tailMs: 400, maxMs: 4600, captions: [cap(0, [{ text: 'Hold steady…', hi: true }]), capAt(claim, [{ text: 'Checkpoint!', hi: true }])] });
}
{
  // 3. Perfect drops, each one a note.
  const m = best(run.combo, 'combo');
  beats.push({ run: run.combo, from: m.to - 240, to: m.to, tailMs: 300, maxMs: 4000, captions: [cap(0, [{ text: 'Every drop' }, { text: 'plays a note', hi: true }])] });
}
{
  // 4. The Daily Tower.
  const m = best(run.daily, 'daily');
  beats.push({ run: run.daily, from: m.from + 120, to: m.to, maxMs: 4000, tag: 'DAILY TOWER · SCORED', captions: [cap(0, [{ text: 'A new Daily Tower' }, { text: 'every day', hi: true }])] });
}
{
  // 5. The clutch save.
  const m = best(run.clutch, 'clutch'), at = first(run.clutch, 'clutch', m.from);
  beats.push({ run: run.clutch, from: at - 180, to: at + 60, tailMs: 400, maxMs: 4400, captions: [cap(0, [{ text: 'Wait for it…', hi: true }]), capAt(at, [{ text: 'SAVED IT!', hi: true }])] });
}
{
  // 6. The climb: the panorama from the top of space down to the meadow, then the logo.
  const m = best(run.zen, 'climb');
  beats.push({
    run: run.zen, from: m.from, to: m.to, tailMs: 9000, maxMs: 7500, end: { cta: 'Free to play', ms: 2600 },
    captions: [cap(0, [{ text: 'From the meadow' }, { text: 'to deep space', hi: true }])],
  });
}
checkWords(...beats.flatMap(b => [...b.captions.flatMap(c => c.lines.map(l => l.text)), b.tag ?? '', b.end?.cta ?? '']));

// ------------------------------------------------------------------ film and join
if (!args.includes('--no-build')) {
  const b = spawnSync('npm', ['run', 'build:app'], { cwd: join(ROOT, 'game'), stdio: 'inherit' });
  if (b.status !== 0) throw new Error('game build failed');
}
const tmp = mkdtempSync(join(tmpdir(), 'promo-'));
const browser = await launch();
const parts: { path: string; seconds: number }[] = [];
try {
  for (const [i, b] of beats.entries()) {
    const path = join(tmp, `${i}.mp4`);
    console.log(`beat ${i + 1}: ${b.run.spec.mode} seed ${b.run.spec.seed}, step ${b.from}`);
    const r = await renderClip(browser, { ...b, out: path, log: s => console.log(`  ${s}`) });
    if (r.problems.length) console.log(`  PROBLEMS: ${r.problems.join('; ')}`);
    parts.push({ path, seconds: r.seconds });
  }
} finally {
  await browser.close();
}

// Video cross-fades and audio cross-fades of FADE s at each join.
const inputs = parts.flatMap(p => ['-i', p.path]);
const v: string[] = [], a: string[] = [];
let vLast = '[0:v]', aLast = '[0:a]', offset = 0;
for (let i = 1; i < parts.length; i++) {
  offset += parts[i - 1].seconds - FADE;
  v.push(`${vLast}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}[v${i}]`);
  a.push(`${aLast}[${i}:a]acrossfade=d=${FADE}[a${i}]`);
  vLast = `[v${i}]`; aLast = `[a${i}]`;
}
mkdirSync(dirname(OUT), { recursive: true });
const ff = spawnSync('ffmpeg', [
  '-y', '-loglevel', 'error', ...inputs, '-filter_complex', [...v, ...a].join(';'), '-map', vLast, '-map', aLast,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', '30',
  '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', OUT,
], { encoding: 'utf8' });
if (ff.status !== 0) throw new Error(`ffmpeg: ${ff.stderr}`);
// A cover: the logo end card.
const total = parts.reduce((s, p) => s + p.seconds, 0) - FADE * (parts.length - 1);
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', (total - 1).toFixed(2), '-i', OUT, '-frames:v', '1', '-q:v', '2', OUT.replace(/\.mp4$/, '.jpg')]);
rmSync(tmp, { recursive: true, force: true });
console.log(`done: ${OUT} (${total.toFixed(1)} s)`);
