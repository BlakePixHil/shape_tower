// Plays the built Wobble Lab in headless Chromium at phone size and saves screenshots.
//   npm run build && node tests/play-check.mjs [outDir] [seconds]
// Uses gestures for the first shapes, then a bot that sends intents so a run reaches checkpoint 1.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = process.argv[2] ?? 'test-results/play';
const seconds = Number(process.argv[3] ?? 60);
mkdirSync(out, { recursive: true });
const url = new URL('../dist/index.html', import.meta.url).href;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
// A stand-in for the claude.ai page database so run records and the benchmark can be checked.
await page.addInitScript(() => {
  const writes = (window.__dbWrites = []);
  const doc = (col, id = Math.random().toString(36).slice(2)) => ({
    set: async d => { writes.push({ op: 'set', path: `${col}/${id}`, bytes: JSON.stringify(d).length, data: d }); },
    update: async d => { writes.push({ op: 'update', path: `${col}/${id}`, data: d }); },
  });
  const db = { collection: col => ({ doc: id => doc(col, id) }) };
  window.claude = { use: async name => (name === 'db' ? db : null) };
});
await page.goto(url);
await page.waitForSelector('.st-panel', { timeout: 20000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${out}/01-start.png` });
await page.click('.st-panel .st-big');
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/02-first-shape.png` });

const W = 390, H = 844;
const state = () => page.evaluate(() => {
  const s = window.__wobble.scene.sim;
  return { ctrl: s.ctrl && { x: s.ctrl.x, y: s.ctrl.y, rot: s.ctrl.rot, shape: s.ctrl.shape }, state: s.state, cp: s.checkpoint, h: s.height().committed, f: s.foundation, line: s.lineY, hearts: s.hearts, placed: s.stats.placed };
});

// Gestures: drag right two blocks, tap to rotate, flick down.
await page.mouse.move(W / 2, H * 0.6);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(W / 2 + i * 6.5, H * 0.6); await page.waitForTimeout(16); }
await page.mouse.up();
let s1 = await state();
await page.mouse.click(W / 2, H * 0.6);
await page.waitForTimeout(150);
let s2 = await state();
await page.screenshot({ path: `${out}/03-steered.png` });
await page.mouse.move(W / 2, H * 0.4);
await page.mouse.down();
for (let i = 1; i <= 5; i++) { await page.mouse.move(W / 2, H * 0.4 + i * 40); await page.waitForTimeout(16); }
await page.mouse.up();
const gestures = { dragTo: s1.ctrl?.x, rotAfterTap: s2.ctrl?.rot, rotBefore: s1.ctrl?.rot };
await page.waitForTimeout(700);
await page.screenshot({ path: `${out}/04-landed.png` });

// Bot: fill the foundation left to right with hard drops, flat rotations.
const frames = await page.evaluate(() => { window.__ft = []; let last = performance.now(); const f = t => { window.__ft.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); return true; });
let shot = 5, lastShot = Date.now(), col = 0;
const t0 = Date.now();
let claimedShot = false;
while (Date.now() - t0 < seconds * 1000) {
  const s = await state();
  if (s.state !== 'playing') break;
  if (s.ctrl) {
    const f = s.f;
    const flatRot = s.ctrl.shape === 'I' || s.ctrl.shape === 'Plank' ? 0 : 0;
    const x = f.x - f.width / 2 + 1 + (col % Math.max(1, f.width - 2));
    col += 2;
    await page.evaluate(({ x, rot }) => {
      const sc = window.__wobble.scene;
      const sim = sc.sim;
      while (sim.ctrl && sim.ctrl.rot !== rot) sim.intent({ type: 'rotate', dir: 1 });
      sim.intent({ type: 'moveTo', x });
    }, { x, rot: flatRot });
    await page.waitForTimeout(250);
    await page.evaluate(() => window.__wobble.scene.sim.intent({ type: 'hardDrop' }));
  }
  await page.waitForTimeout(350);
  const s2b = await state();
  if (!claimedShot && s2b.cp > 1) { claimedShot = true; await page.waitForTimeout(250); await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-claim.png` }); }
  if (Date.now() - lastShot > 8000) { lastShot = Date.now(); await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-run.png` }); }
}
const end = await state();
const ft = await page.evaluate(() => { const a = window.__ft.slice(30).sort((x, y) => x - y); return { n: a.length, p50: a[Math.floor(a.length * 0.5)], p95: a[Math.floor(a.length * 0.95)], max: a[a.length - 1] }; });
// End the run to see the results card.
if (end.state === 'playing') await page.evaluate(() => window.__wobble.scene.sim.quit());
await page.waitForTimeout(3200);
await page.screenshot({ path: `${out}/${String(shot++).padStart(2, '0')}-results.png` });
await page.click('.st-ask .st-btn').catch(() => {});
await page.waitForTimeout(300);
const runRecord = await page.evaluate(() => window.__dbWrites.find(w => w.op === 'set' && w.data.kind === 'run')?.data ?? null);
if (runRecord) writeFileSync(`${out}/run-record.json`, JSON.stringify(runRecord));
const writes = await page.evaluate(() => window.__dbWrites.map(w => w.op === 'set'
  ? { op: w.op, path: w.path.split('/')[0], bytes: w.bytes, keys: w.data.kind === 'bench' ? { ok: w.data.ok, phases: w.data.result?.phases?.map(p => [p.bodies, p.awake, p.p50, p.p95]) } : { steps: w.data.steps, inputs: w.data.inputs.length, digests: w.data.digests.length, cause: w.data.cause, frames: w.data.frames.p95, audio: w.data.audio } }
  : { op: w.op, path: w.path.split('/')[0], data: w.data }));
const audio = await page.evaluate(() => { const a = window.__wobble.audio; return a ? { ok: true, state: a.debugState?.().mix ?? null } : { ok: false }; }).catch(e => ({ err: String(e) }));
console.log(JSON.stringify({ gestures, end, frameMs: ft, audio: !!audio.ok, writes, errors: errors.slice(0, 20) }, null, 1));
await browser.close();
