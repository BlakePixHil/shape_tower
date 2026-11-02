// The run-over panorama with a crooked tower, in the built game at Blake's phone size (Blake,
// 2026-11-02: "if it's built crooked, the tower gets cut off"). Builds a tower of stone shapes that
// leans right and back, quits, and watches every frame of the glide: every shape on screen must be
// whole in frame, and the camera must move smoothly sideways. Saves screenshots along the way.
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

// Watch the glide frame by frame, in the page.
const watching = page.evaluate(() => new Promise(resolve => {
  const scene = window.__wobble.scene;
  const frames = [];
  let seen = false;
  const t0 = performance.now();
  const tick = () => {
    const p = scene.pano;
    if (p) seen = true;
    if (p && p.t0 !== Infinity) {
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
      frames.push({ t: performance.now() - p.t0, blend: p.blendAt === undefined ? 1 : Math.min(1, (performance.now() - p.blendAt) / 900), y: cam.y, x: cam.x, across: cam.across, shown, worst });
    }
    const done = seen && (!p || !p.done);
    if (done || performance.now() - t0 > 20000) resolve({ frames, seen });
    else requestAnimationFrame(tick);
  };
  tick();
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
step('every shape on screen stays whole in frame through the glide', on.length > 10 && cut.length === 0, `${cut.length} of ${on.length} frames cut, worst ${worst.toFixed(2)} blocks`);
const xs = f.map(x => x.x);
step('the camera follows the lean', Math.max(...xs) - Math.min(...xs) > 6, `x ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}`);
// Smooth: per-frame moves small next to the frame time (headless frames are slow and uneven, so per ms).
let jump = 0;
for (let i = 1; i < f.length; i++) {
  const dt = Math.max(1, f[i].t - f[i - 1].t);
  jump = Math.max(jump, Math.abs(f[i].x - f[i - 1].x) / dt * 16.7, Math.abs(f[i].across - f[i - 1].across) / dt * 16.7);
}
step('sideways and zoom move without jumps', jump < 0.6, `most ${jump.toFixed(3)} blocks per 60 FPS frame`);
step('ends on the ground with the plinth in view', f.length > 0 && f[f.length - 1].y < 15, `last y ${f.at(-1)?.y.toFixed(1)}`);
step('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 1));
if (steps.some(s => !s.ok)) process.exit(1);
console.log('pano browser: all passed');
