// The store listings' eight phone screenshots: frames of the real game (bot runs replayed in the built
// app, and the app's own screens), each framed on the brand's sky under a caption. PNGs with no
// transparency, in the order the store shows them: 1080 x 1920 for Play, and with --appstore 1290 x 2796
// for the App Store (an iPhone 6.9"/6.7" screen, the game filmed at an iPhone's taller shape), plus
// review-workshop.png, the unframed Workshop that Apple's in-app purchase review asks for.
//
//   node --experimental-strip-types scripts/listing-shots.ts [--appstore] [--candidates] [--only stack] [--out <folder>] [--no-build]
//
// --candidates saves every candidate frame of each shot to <out>/raw/ so a better one can be picked
// (each shot's `pick` in listing/shots.ts). Default folder: /mnt/project-files/marketing/listing/screenshots/
// (app-store/ with --appstore).

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { RUNS, SHOTS } from '../listing/shots.ts';
import { ROOT, VIEW, launch, openGame, renderClip, setView, type CaptionLine } from '../src/render.ts';
import type { RunResult } from '../src/runs.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const appstore = args.includes('--appstore');
const OUT = flag('--out') ?? `/mnt/project-files/marketing/listing/${appstore ? 'app-store' : 'screenshots'}`;
/** The picture and where the game sits in it: Play's 9:16 phone, or the App Store's iPhone 6.9"/6.7" (430 x 932 points). */
const FRAME = appstore
  ? { width: 1290, height: 2796, top: 96, size: 110, stroke: 19, shot: { left: 140, top: 452, width: 1010, height: 2189, radius: 66, border: 9 } }
  : { width: 1080, height: 1920, top: 64, size: 92, stroke: 16, shot: { left: 112, top: 330, width: 856, height: 1522, radius: 56, border: 8 } };
if (appstore) setView({ width: 430, height: 932, dpr: 2.5 });
const RAW = join(OUT, 'raw');
const candidates = args.includes('--candidates');
const only = flag('--only');

// ------------------------------------------------------------------ a seasoned player, for the screens
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const EARNED = ['cp_first', 'biome_2', 'biome_3', 'biome_4', 'biome_5', 'biome_6', 'biome_7', 'pb', 'perfect', 'combo_5', 'combo_7', 'row', 'row_2', 'clutch',
  'last_heart', 'calm_2', 'flawless_3', 'bubble', 'toolbox', 'comeback', 'streak_3', 'daily_first', 'avalanche', 'so_close'];
/** The test store's purchases (game/src/store/store.ts): the Builder's Pass, so the look shows its items. */
const STORE = { 'shape-tower-test-store-v1': '["builders_pass"]', 'shape-tower-owned-v1:test': '["builders_pass"]' };
const SEASONED = {
  level: 18, xp: 340, total: 14800, runs: 140, streak: 6, lastDay: today, boostDay: today, askedGhost: true, windDay: today, sliceRuns: 2, player: 'p-clips',
  stats: { bestHeight: 214.6, bestBiome: 7, bricks: 6240, perfects: 980, rows: 210, checkpoints: 420, clutches: 61 },
  seenGusts: true, seenHazards: ['crosswind', 'junk', 'meteor', 'dust', 'sway'], seenBrittle: true, passIntro: true,
  postcards: [...Array(7).fill(today), null, null, null], avatar: { shape: 'O', face: 'idle', hat: 'cowboy' },
  // Builder's Pass items up to level 18 (art/src/cosmetics.ts PASS_ITEMS).
  look: { skin: 'skin_stars', landing: 'landing_hearts', foundation: 'foundation_marble', flag: 'flag_heart' },
  // Their last few scored Dailies (today's try still open).
  daily: { scored: Object.fromEntries([[1, 41.2, 3, 2], [2, 63.8, 4, 3], [3, 52.5, 4, 3]].map(([d, h, c, b]) => [daysAgo(d), { height: h, score: Math.round(h * 950), checkpoints: c, biome: b, finished: true, at: `${daysAgo(d)}T08:00:00.000Z`, v: 2 }])), practice: {} },
  achievements: Object.fromEntries(EARNED.map((id, i) => [id, { at: daysAgo(30 - i), paid: true }])),
  achCounts: { bubbles: 40, powers: ['glue', 'slowmo', 'undo', 'quickset', 'clean'] },
};

async function screen(browser: Browser, taps: string[], path: string, storage: Record<string, string> = STORE): Promise<void> {
  const { ctx, page, problems } = await openGame(browser, { profile: SEASONED, storage });
  try {
    for (const t of taps) {
      await page.evaluate(sel => {
        const b = document.querySelector<HTMLElement>(`.sc-root.show ${sel.startsWith('[') ? sel : `[data-action="${sel}"]`}`);
        if (!b) throw new Error(`no ${sel} button`);
        b.click();
      }, t);
      for (let i = 0; i < 12; i++) { await page.evaluate(() => (window as any).__clock.run(100)); await page.waitForTimeout(15); }
    }
    const cdp = await ctx.newCDPSession(page);
    const png = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: VIEW.width, height: VIEW.height, scale: VIEW.dpr } });
    writeFileSync(path, Buffer.from(png.data, 'base64'));
    if (problems.length) console.log(`  PROBLEMS: ${problems.join('; ')}`);
  } finally {
    await ctx.close();
  }
}

// ------------------------------------------------------------------ the frame around each shot
const font = readFileSync(join(ROOT, 'game', 'assets', 'fonts', 'fredoka-latin.woff2')).toString('base64');
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

function frameHtml(shot: string, lines: CaptionLine[]): string {
  return `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Fredoka; src: url(data:font/woff2;base64,${font}) format('woff2'); font-weight: 300 700; }
html, body { margin: 0; width: ${FRAME.width}px; height: ${FRAME.height}px; overflow: hidden; }
body { background: linear-gradient(180deg, #6EC3FF 0%, #A9DCFF 45%, #DDF2FF 75%, #FFF7E8 100%); font-family: Fredoka, sans-serif; position: relative; }
.sun { position: absolute; left: 50%; top: -420px; width: 1400px; height: 900px; transform: translateX(-50%); border-radius: 50%; background: radial-gradient(closest-side, rgba(255,255,255,.55), rgba(255,255,255,0)); }
.cap { position: absolute; top: ${FRAME.top}px; left: 40px; right: 40px; text-align: center; font-weight: 700; font-size: ${FRAME.size}px; line-height: 1.04; color: #fff;
  -webkit-text-stroke: ${FRAME.stroke}px #2B2140; paint-order: stroke fill; letter-spacing: 0.5px; }
.cap .hi { color: #FFD23F; }
.shot { position: absolute; left: ${FRAME.shot.left}px; top: ${FRAME.shot.top}px; width: ${FRAME.shot.width}px; height: ${FRAME.shot.height}px; border-radius: ${FRAME.shot.radius}px; border: ${FRAME.shot.border}px solid #2B2140; overflow: hidden;
  box-shadow: 0 22px 0 rgba(43,33,64,.22), 0 40px 80px rgba(43,33,64,.25); background: #2B2140; }
.shot img { display: block; width: 100%; height: 100%; object-fit: cover; }
</style><div class="sun"></div>
<div class="cap">${lines.map(l => `<div${l.hi ? ' class="hi"' : ''}>${esc(l.text)}</div>`).join('')}</div>
<div class="shot"><img src="data:image/png;base64,${readFileSync(shot).toString('base64')}"></div>`;
}

/** Both stores want no alpha channel in screenshots; `size` scales it too ("1290:2796"). */
function opaque(from: string, to: string, size?: string): void {
  const ff = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', from, ...(size ? ['-vf', `scale=${size}:flags=lanczos`] : []), '-pix_fmt', 'rgb24', to], { encoding: 'utf8' });
  if (ff.status !== 0) throw new Error(`ffmpeg: ${ff.stderr}`);
}

async function compose(browser: Browser, shot: string, lines: CaptionLine[], out: string): Promise<void> {
  const page = await browser.newPage({ viewport: { width: FRAME.width, height: FRAME.height }, deviceScaleFactor: 1 });
  try {
    await page.setContent(frameHtml(shot, lines));
    await page.evaluate(() => document.fonts.ready);
    const tmp = `${out}.rgba.png`;
    await page.screenshot({ path: tmp });
    opaque(tmp, out);
    rmSync(tmp);
  } finally {
    await page.close();
  }
}

// ------------------------------------------------------------------ main
const shots = SHOTS.filter(s => !only || s.name.includes(only));
const runs = new Map<string, RunResult>();
for (const s of shots) if ('run' in s.source && !runs.has(s.source.run)) runs.set(s.source.run, RUNS[s.source.run]());
if (!args.includes('--no-build')) {
  const b = spawnSync('npm', ['run', 'build:app'], { cwd: join(ROOT, 'game'), stdio: 'inherit' });
  if (b.status !== 0) throw new Error('game build failed');
}
mkdirSync(RAW, { recursive: true });
const browser = await launch();
try {
  for (const s of shots) {
    const raw = join(RAW, `${s.name}.png`);
    const src = s.source;
    if ('taps' in src) {
      console.log(`${s.name}: screen ${src.taps.join(' > ')}`);
      await screen(browser, src.taps, raw);
    } else {
      const run = runs.get(src.run)!;
      const from = typeof src.from === 'function' ? src.from(run) : src.from;
      const at = candidates ? src.at : [src.at[src.pick]];
      console.log(`${s.name}: ${src.run} run, step ${from}, ${at.length} frame(s)`);
      const paths = at.map((ms, k) => (candidates ? join(RAW, `${s.name}-${k}.png`) : raw));
      const r = await renderClip(browser, {
        run, from, to: from + Math.ceil((Math.max(...at) / 1000) * 60) + 60, tailMs: 20000, maxMs: Math.max(...at) + 2000, captions: [],
        out: '', stills: at.map((ms, k) => ({ at: ms, path: paths[k] })), stillsOnly: true, log: x => console.log(`  ${x}`),
      });
      if (r.problems.length) console.log(`  PROBLEMS: ${r.problems.join('; ')}`);
      if (candidates) { console.log(`  candidates in ${RAW}`); copyFileSync(paths[src.pick], raw); }
    }
    await compose(browser, raw, s.lines, join(OUT, `${s.name}.png`));
  }
  if (appstore && !only) {
    console.log('review-workshop: screen workshop');
    const raw = join(RAW, 'review-workshop.png');
    await screen(browser, ['workshop'], raw, {}); // nothing bought yet, so every product shows its price
    // Apple takes a review screenshot only at a screenshot size, so the 1075 x 2330 page goes up to 1290 x 2796.
    opaque(raw, join(OUT, 'review-workshop.png'), `${FRAME.width}:${FRAME.height}`);
  }
} finally {
  await browser.close();
}
console.log(`done: ${OUT}`);
