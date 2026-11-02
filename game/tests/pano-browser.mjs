// The run-over panorama with a crooked tower, in the built game at Blake's phone size (Blake,
// 2026-11-02: "if it's built crooked, the tower gets cut off"). Builds a tower of stone shapes that
// leans right and back, quits, and watches every frame of the glide: every shape on screen must be
// whole in frame, the camera must sit on its planned path, and that path and the ease onto it must have
// no jumps. Saves screenshots along the way.
//   npm run build:game && node tests/pano-browser.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/pano';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 448, height: 825 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
await page.addInitScript(() => {
  window.claude = { use: async () => null };
  // Not the first run: no rookie opening, no tips.
  try { localStorage.setItem('shape-tower-played', '1'); } catch { /* none */ }
});
await page.goto(url);
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ` (${info})` : ''}`); };

await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
await page.waitForTimeout(1500);
await page.click('[data-action="play"]');
await page.waitForTimeout(800);

// The crooked tower: pairs of O shapes in stone, drifting 12 blocks right over 60, then back 8 over 40.
const built = await page.evaluate(() => {
  const sim = window.__wobble.scene.sim;
  const lean = y => (y < 60 ? (12 * y) / 60 : 12 - (8 * (y - 60)) / 40);
  let n = 0;
  for (let y = 1; y < 100; y += 2) {
    sim.placePiece({ shape: 'O', x: lean(y), y, as: 'stone' });
    sim.placePiece({ shape: 'O', x: lean(y) + 2, y, as: 'stone' });
    n += 2;
  }
  return n;
});
step('crooked tower built', built === 100, `${built} stone shapes`);
// Let the camera climb to the top, then quit from pause.
await page.waitForTimeout(3500);
await page.click('[data-id="pause"]');
await page.waitForTimeout(300);
await page.click('[data-action="quit"]');

// Watch the glide frame by frame, in the page: sampled in the scene's postupdate, right after the
// frame that moved the camera, so each sample is one game frame and its time is that frame's (a sample
// taken on the page's own clock can straddle two game steps under load and fake a jump, QA 2026-11-02).
const watching = page.evaluate(() => new Promise(resolve => {
  const scene = window.__wobble.scene;
  const frames = [];
  let seen = false, track = null, finished = false;
  const t0 = performance.now();
  const finish = () => {
    if (finished) return;
    finished = true;
    scene.events.off('postupdate', sample);
    resolve({ frames, seen, track });
  };
  const sample = () => {
    const p = scene.pano;
    if (p) seen = true;
    if (p && p.t0 !== Infinity) {
      const now = performance.now();
      if (!track && p.track) track = { y0: p.track.y0, step: p.track.step, x: [...p.track.x], across: [...p.track.across], from: p.from, to: p.to, dur: p.dur, lead: p.t0 - p.blendAt };
      const cam = scene.cam, aspect = scene.H / scene.W;
      const l = cam.x - cam.across / 2, r = cam.x + cam.across / 2;
      const half = (cam.across * aspect) / 2;
      let worst = 0, shown = 0;
      for (const v of scene.sim.pieceViews()) {
        if (v.state === 'lost' || v.state === 'controlled' || v.shape !== 'O') continue;
        if (v.y + 1 < cam.y - half || v.y - 1 > cam.y + half) continue;
        shown++;
        worst = Math.max(worst, l - (v.x - 1), v.x + 1 - r);
      }
      frames.push({ t: now - p.t0, blend: p.blendAt === undefined ? 1 : Math.min(1, (now - p.blendAt) / 900), since: p.blendAt === undefined ? Infinity : now - p.blendAt, y: cam.y, x: cam.x, across: cam.across, shown, worst });
    }
    if ((seen && (!p || !p.done)) || performance.now() - t0 > 20000) finish();
  };
  scene.events.on('postupdate', sample);
  setTimeout(finish, 21000);
}));
// Screenshots along the glide while the page watches.
let ended = false;
watching.then(() => { ended = true; }, () => { ended = true; });
for (let i = 0; !ended && i < 20; i++) {
  await page.waitForTimeout(700);
  if (!ended) await page.screenshot({ path: `${out}/pano-${String(i).padStart(2, '0')}.png` }).catch(() => {});
}
const watch = await watching;
await page.screenshot({ path: `${out}/pano-end.png` });
writeFileSync(`${out}/frames.json`, JSON.stringify(watch.frames, null, 1));
const f = watch.frames;
step('the panorama played', watch.seen && f.length > 10, `${f.length} frames`);
// The first 0.9 s eases over from where play left the camera (which follows the top foundation, so
// this test's tower, built off to the side, starts part cut); from then on nothing may be cut.
const on = f.filter(x => x.blend >= 1);
const cut = on.filter(x => x.shown > 0 && x.worst > 0.05);
const worst = Math.max(0, ...on.map(x => x.worst));
step('every shape on screen stays whole in frame through the glide', on.length > 5 && cut.length === 0, `${cut.length} of ${on.length} frames cut, worst ${worst.toFixed(2)} blocks`);
const xs = f.map(x => x.x);
step('the camera follows the lean', Math.max(...xs) - Math.min(...xs) > 6, `x ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}`);
// Smooth, judged without the clock: once eased on, the camera sits exactly on the planned path at its
// height, and the path itself moves sideways and zooms gently per block of the glide (no steps in it).
const tr = watch.track;
const at = y => {
  const n = tr.x.length, fi = Math.max(0, Math.min(n - 1, (y - tr.y0) / tr.step)), i = Math.min(n - 2, Math.floor(fi)), u = fi - i;
  return { x: tr.x[i] + (tr.x[i + 1] - tr.x[i]) * u, across: tr.across[i] + (tr.across[i + 1] - tr.across[i]) * u };
};
// (A frame's sample comes a moment after the camera moved, so judge from 0.1 s after the ease ends.)
let off = 0;
const settled = f.filter(x => x.since >= 1000);
for (const x of settled) { const a = at(x.y); off = Math.max(off, Math.abs(x.x - a.x), Math.abs(x.across - a.across)); }
step('once eased on, the camera follows the planned path', !!tr && settled.length > 5 && off < 1e-3, `most ${off.toExponential(1)} blocks off over ${settled.length} frames`);
let slope = 0, bend = 0;
if (tr) {
  const i0 = Math.max(1, Math.floor((tr.to - tr.y0) / tr.step)), i1 = Math.min(tr.x.length - 2, Math.ceil((tr.from - tr.y0) / tr.step));
  for (let i = i0; i <= i1; i++) {
    slope = Math.max(slope, Math.abs(tr.x[i] - tr.x[i - 1]) / tr.step, Math.abs(tr.across[i] - tr.across[i - 1]) / tr.step);
    bend = Math.max(bend, Math.abs(tr.x[i + 1] - 2 * tr.x[i] + tr.x[i - 1]), Math.abs(tr.across[i + 1] - 2 * tr.across[i] + tr.across[i - 1]));
  }
}
step('the path moves sideways and zooms without jumps', !!tr && slope < 1.5 && bend < 0.05, `most ${slope.toFixed(3)} blocks per block down, bend ${bend.toFixed(4)}`);
// The ease from play's camera onto the path runs on time. The time each frame's camera was placed at
// comes from its own height: the glide's ease (scene.ts updateCamera) turned back into time.
const glideMs = x => {
  const e = Math.max(0, Math.min(1, (x.y - tr.from) / (tr.to - tr.from)));
  return tr.dur * (e < 0.5 ? Math.sqrt(e / 2) : 1 - Math.sqrt(2 * (1 - e)) / 2);
};
let jump = 0, easing = 0;
for (let i = 1; tr && i < f.length; i++) {
  const a = glideMs(f[i - 1]), b = glideMs(f[i]);
  if (a + tr.lead >= 900 || b - a < 1) continue; // eased on (the path checks cover it) or the camera didn't move
  easing++;
  jump = Math.max(jump, Math.abs(f[i].x - f[i - 1].x) / (b - a) * 16.7, Math.abs(f[i].across - f[i - 1].across) / (b - a) * 16.7);
}
step('the ease onto the path has no jumps', jump < 0.6, `most ${jump.toFixed(3)} blocks per 60 FPS frame over ${easing} frames`);
step('ends on the ground with the plinth in view', f.length > 0 && f[f.length - 1].y < 15, `last y ${f.at(-1)?.y.toFixed(1)}`);
step('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 1));
if (steps.some(s => !s.ok)) process.exit(1);
console.log('pano browser: all passed');
