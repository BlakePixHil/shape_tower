// The creative for a Google Ads App campaign (installs): ad videos in all three shapes Google serves
// (portrait, landscape and square) and images at its three ratios, plus copy.md with the campaign's
// words (listing/ads.ts). The portrait videos are the promo and two clips filmed like the weekly ones
// but ending on "Free on Google Play" (the campaign only runs where the game is on Play); landscape
// and square put the portrait video in a phone on the brand's sky beside the logo. Images use the
// store screenshots' raw frames (scripts/listing-shots.ts makes them).
//
//   node --experimental-strip-types scripts/ads.ts [--out <folder>] [--only images|videos] [--no-build]
//
// Default folder: /mnt/project-files/marketing/ads/<YYYY-MM>/ (videos/, images/, copy.md).
// Google's specs: images .jpg or .png up to 5 MB at 1200x628, 1200x1200 and 1200x1500; videos on
// YouTube (Google Ads uploads a file there itself), any orientation.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright';
import { AD_CTA, AD_TEXT, checkAd } from '../listing/ads.ts';
import { checkWords, clipFor } from '../src/clips.ts';
import { ROOT, launch, renderClip, type CaptionLine } from '../src/render.ts';
import { findMoments, playRun, specFor, type Moment, type RunResult } from '../src/runs.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = flag('--out') ?? `/mnt/project-files/marketing/ads/${new Date().toISOString().slice(0, 7)}`;
const PROMO = flag('--promo') ?? '/mnt/project-files/marketing/promo/shape-tower-promo.mp4';
const RAW = flag('--shots') ?? '/mnt/project-files/marketing/listing/screenshots/raw';
const only = flag('--only');
const want = (part: 'images' | 'videos') => !only || only === part;

const problems = checkAd(AD_TEXT);
if (problems.length) throw new Error(`ad words: ${problems.join('; ')}`);

// ------------------------------------------------------------------ the look (the store screenshots' sky and ink)
const b64 = (path: string) => readFileSync(path).toString('base64');
const FONTS = `
@font-face { font-family: Fredoka; src: url(data:font/woff2;base64,${b64(join(ROOT, 'game', 'assets', 'fonts', 'fredoka-latin.woff2'))}) format('woff2'); font-weight: 300 700; }
@font-face { font-family: Nunito; src: url(data:font/woff2;base64,${b64(join(ROOT, 'game', 'assets', 'fonts', 'nunito-latin.woff2'))}) format('woff2'); font-weight: 400 900; }`;
const LOGO = `data:image/webp;base64,${b64(join(ROOT, 'game', 'assets', 'splash', 'logo.webp'))}`; // 978 x 390
const shot = (name: string) => {
  const path = join(RAW, `${name}.png`);
  if (!existsSync(path)) throw new Error(`no ${path}: run scripts/listing-shots.ts first`);
  return `data:image/png;base64,${b64(path)}`;
};
const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const lines = (ls: CaptionLine[]) => ls.map(l => `<div${l.hi ? ' class="hi"' : ''}>${esc(l.text)}</div>`).join('');

function page(w: number, h: number, body: string, css = ''): string {
  return `<!doctype html><meta charset="utf-8"><style>${FONTS}
html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; }
body { background: linear-gradient(180deg, #6EC3FF 0%, #A9DCFF 45%, #DDF2FF 75%, #FFF7E8 100%); font-family: Fredoka, sans-serif; position: relative; }
.sun { position: absolute; left: 30%; top: -50%; width: 120%; height: 100%; transform: translateX(-50%); border-radius: 50%; background: radial-gradient(closest-side, rgba(255,255,255,.6), rgba(255,255,255,0)); }
.logo { position: absolute; display: block; filter: drop-shadow(0 6px 0 rgba(43,33,64,.18)); }
.cap { position: absolute; text-align: center; font-weight: 700; line-height: 1.04; color: #fff; -webkit-text-stroke: var(--stroke, 12px) #2B2140; paint-order: stroke fill; letter-spacing: 0.5px; }
.cap .hi { color: #FFD23F; }
.cta { position: absolute; font-weight: 700; color: #2B2140; background: #FFC93C; border: 4px solid #2B2140; border-radius: 22px; box-shadow: 0 7px 0 #2B2140; text-align: center; white-space: nowrap; }
.phone { position: absolute; border: var(--bezel, 10px) solid #2B2140; border-radius: var(--radius, 40px); overflow: hidden; background: #2B2140;
  box-shadow: 0 18px 0 rgba(43,33,64,.22), 0 36px 70px rgba(43,33,64,.25); }
.phone img { display: block; width: 100%; height: 100%; object-fit: cover; }
${css}</style><div class="sun"></div>${body}`;
}
/** A phone at (x, y), w wide and 16:9 tall, turned `deg`. */
const phone = (src: string, x: number, y: number, w: number, deg = 0, z = 1) =>
  `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;height:${Math.round((w * 16) / 9)}px;transform:rotate(${deg}deg);z-index:${z}"><img src="${src}"></div>`;

// ------------------------------------------------------------------ images: two sets, three ratios each
interface Variant { name: string; line: CaptionLine[]; shots: [string, string, string] }
const VARIANTS: Variant[] = [
  { name: 'a', line: [{ text: 'Stack wobbly shapes' }, { text: 'sky-high', hi: true }], shots: ['2-timber', '1-stack', '5-powers'] },
  { name: 'b', line: [{ text: 'From the meadow' }, { text: 'to deep space', hi: true }], shots: ['3-climb', '6-zen', '1-stack'] },
];
const IMAGES = {
  // 1.91:1: the logo and words on the left, two phones leaning in on the right.
  landscape: { w: 1200, h: 628, html: (v: Variant) => page(1200, 628, `
<img class="logo" src="${LOGO}" style="left:48px;top:58px;width:520px">
<div class="cap" style="left:28px;width:560px;top:282px;font-size:58px;--stroke:11px">${lines(v.line)}</div>
<div class="cta" style="left:118px;top:452px;width:380px;font-size:36px;padding:12px 0">${esc(AD_CTA)}</div>
${phone(shot(v.shots[1]), 640, 64, 300, -7, 1)}${phone(shot(v.shots[0]), 870, 36, 300, 6, 2)}`) },
  // 1:1: the logo and words up top, three phones fanned below.
  square: { w: 1200, h: 1200, html: (v: Variant) => page(1200, 1200, `
<img class="logo" src="${LOGO}" style="left:290px;top:40px;width:620px">
<div class="cap" style="left:0;right:0;top:300px;font-size:68px;--stroke:12px">${lines(v.line)}</div>
${phone(shot(v.shots[1]), 120, 560, 330, -10, 1)}${phone(shot(v.shots[2]), 750, 560, 330, 10, 1)}${phone(shot(v.shots[0]), 425, 480, 350, 0, 2)}`) },
  // 4:5: the words up top, one big phone, the logo across its foot.
  portrait: { w: 1200, h: 1500, html: (v: Variant) => page(1200, 1500, `
<div class="cap" style="left:0;right:0;top:56px;font-size:88px;--stroke:14px">${lines(v.line)}</div>
${phone(shot(v.shots[1]), 120, 360, 340, -9, 1)}${phone(shot(v.shots[2]), 740, 360, 340, 9, 1)}${phone(shot(v.shots[0]), 380, 290, 440, 0, 2)}
<div style="position:absolute;left:0;right:0;bottom:0;height:300px;z-index:3;background:linear-gradient(180deg, rgba(255,247,232,0), #FFF7E8 55%)"></div>
<img class="logo" src="${LOGO}" style="left:310px;top:1136px;width:580px;z-index:4">
<div class="cta" style="left:390px;top:1376px;width:420px;font-size:38px;padding:10px 0;z-index:4">${esc(AD_CTA)}</div>`) },
} as const;

// ------------------------------------------------------------------ video frames: the portrait video in a phone beside the logo
const BEZEL = 14;
const FRAMES = {
  landscape: { w: 1920, h: 1080, video: { x: 1186, y: 44, w: 558, h: 992 }, html: (vx: number, vy: number, vw: number, vh: number) => page(1920, 1080, `
<img class="logo" src="${LOGO}" style="left:150px;top:200px;width:800px">
<div class="cap" style="left:100px;width:900px;top:560px;font-size:84px;--stroke:15px">${lines([{ text: 'Stack wobbly shapes' }, { text: 'sky-high', hi: true }])}</div>
<div class="cta" style="left:290px;top:820px;width:520px;font-size:48px;padding:14px 0">${esc(AD_CTA)}</div>
<div class="phone" style="--bezel:${BEZEL}px;--radius:46px;left:${vx - BEZEL}px;top:${vy - BEZEL}px;width:${vw}px;height:${vh}px"></div>`) },
  square: { w: 1080, h: 1080, video: { x: 62, y: 60, w: 540, h: 960 }, html: (vx: number, vy: number, vw: number, vh: number) => page(1080, 1080, `
<img class="logo" src="${LOGO}" style="left:636px;top:250px;width:410px">
<div class="cap" style="left:626px;width:430px;top:450px;font-size:52px;--stroke:10px">${lines([{ text: 'Stack wobbly' }, { text: 'shapes' }, { text: 'sky-high', hi: true }])}</div>
<div class="cta" style="left:646px;top:700px;width:390px;font-size:32px;padding:12px 0">${esc(AD_CTA)}</div>
<div class="phone" style="--bezel:${BEZEL}px;--radius:44px;left:${vx - BEZEL}px;top:${vy - BEZEL}px;width:${vw}px;height:${vh}px"></div>`) },
} as const;

async function snap(browser: Browser, html: string, w: number, h: number, out: string): Promise<void> {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  try {
    await p.setContent(html);
    await p.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.decode())); });
    const png = await p.screenshot({ type: 'png' });
    if (out.endsWith('.png')) { writeFileSync(out, png); return; }
    const tmp = `${out}.png`;
    writeFileSync(tmp, png);
    ff(['-i', tmp, '-q:v', '2', out]);
    rmSync(tmp);
  } finally {
    await p.close();
  }
}

function ff(a: string[]): void {
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...a], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
}

/** The portrait video in the frame's phone; the sound comes along as it is. */
function framed(bg: string, video: string, at: { x: number; y: number; w: number; h: number }, out: string): void {
  ff(['-loop', '1', '-framerate', '30', '-i', bg, '-i', video, '-filter_complex',
    `[1:v]scale=${at.w}:${at.h}:flags=lanczos[v];[0:v][v]overlay=${at.x}:${at.y}:shortest=1,format=yuv420p[o]`,
    '-map', '[o]', '-map', '1:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-profile:v', 'high', '-r', '30',
    '-c:a', 'copy', '-movflags', '+faststart', out]);
}

// ------------------------------------------------------------------ the portrait clips (the first weekly batch's runs)
const CLIPS: { name: string; kind: Moment['kind']; run: () => RunResult }[] = [
  { name: 'portrait-collapse', kind: 'collapse', run: () => playRun(specFor('endless', 2075900, 'careful', 2075907)) },
  { name: 'portrait-clutch', kind: 'clutch', run: () => playRun(specFor('endless', 2075911, 'reckless', 2075918)) },
];

// ------------------------------------------------------------------ main
mkdirSync(join(OUT, 'images'), { recursive: true });
mkdirSync(join(OUT, 'videos'), { recursive: true });
if (want('videos') && !args.includes('--no-build')) {
  const b = spawnSync('npm', ['run', 'build:app'], { cwd: join(ROOT, 'game'), stdio: 'inherit' });
  if (b.status !== 0) throw new Error('game build failed');
}
const browser = await launch();
const made: string[] = [];
try {
  if (want('images')) {
    for (const v of VARIANTS) for (const [kind, spec] of Object.entries(IMAGES)) {
      const out = join(OUT, 'images', `${kind}-${v.name}.jpg`);
      checkWords(...v.line.map(l => l.text));
      await snap(browser, spec.html(v), spec.w, spec.h, out);
      made.push(out);
      console.log(`${out} (${spec.w}x${spec.h}, ${(statSync(out).size / 1024).toFixed(0)} KB)`);
    }
  }
  if (want('videos')) {
    for (const c of CLIPS) {
      const run = c.run();
      const m = findMoments(run).filter(x => x.kind === c.kind).sort((a, b) => b.score - a.score)[0];
      if (!m) throw new Error(`no ${c.kind} moment in seed ${run.spec.seed}`);
      const job = clipFor(run, m, 0).job;
      checkWords(...job.captions.flatMap(x => x.lines.map(l => l.text)));
      const out = join(OUT, 'videos', `${c.name}.mp4`);
      console.log(`${c.name}: seed ${run.spec.seed}, steps ${m.from}-${m.to}`);
      const r = await renderClip(browser, { run, ...job, end: { cta: AD_CTA, ms: 2200 }, out, log: s => console.log(`  ${s}`) });
      if (r.problems.length) throw new Error(`${c.name}: ${r.problems.join('; ')}`);
      made.push(out);
    }
    if (!existsSync(PROMO)) throw new Error(`no ${PROMO}: run scripts/promo.ts first`);
    copyFileSync(PROMO, join(OUT, 'videos', 'portrait-promo.mp4'));
    made.push(join(OUT, 'videos', 'portrait-promo.mp4'));
    for (const [kind, f] of Object.entries(FRAMES)) {
      const bg = join(OUT, 'videos', `${kind}-frame.png`);
      const v = f.video;
      await snap(browser, f.html(v.x, v.y, v.w, v.h), f.w, f.h, bg);
      for (const src of ['promo', 'collapse']) {
        const out = join(OUT, 'videos', `${kind}-${src}.mp4`);
        framed(bg, join(OUT, 'videos', `portrait-${src}.mp4`), v, out);
        made.push(out);
        console.log(`${out} (${f.w}x${f.h})`);
      }
      rmSync(bg);
    }
  }
} finally {
  await browser.close();
}

// ------------------------------------------------------------------ copy.md: the words to paste
const md = [
  '# Shape Tower: Google Ads App campaign words',
  '',
  'Paste these into the ad group (Google allows 5 headlines of 30 characters and 5 descriptions of 90).',
  '',
  '## Headlines',
  '',
  ...AD_TEXT.headlines.map(h => `- ${h}`),
  '',
  '## Descriptions',
  '',
  ...AD_TEXT.descriptions.map(d => `- ${d}`),
  '',
  '## Files',
  '',
  ...made.map(p => `- ${p.replace(`${OUT}/`, '')}`),
  '',
  'Made by marketing/scripts/ads.ts (words in marketing/listing/ads.ts).',
  '',
];
if (!only) writeFileSync(join(OUT, 'copy.md'), md.join('\n'));
console.log(`done: ${OUT}`);
