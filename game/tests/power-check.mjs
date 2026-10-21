// Plays the built Wobble Lab headless, steering into power bubbles and tapping the real HUD
// buttons, and saves screenshots of each power and of Second Wind.
//   npm run build && node tests/power-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/power';
mkdirSync(out, { recursive: true });
const url = new URL('../dist/index.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
await page.addInitScript(() => {
  const writes = (window.__dbWrites = []);
  const doc = (col, id = Math.random().toString(36).slice(2)) => ({ set: async d => { writes.push({ op: 'set', path: `${col}/${id}`, data: d }); }, update: async () => {} });
  window.claude = { use: async name => (name === 'db' ? { collection: col => ({ doc: id => doc(col, id) }) } : null) };
  // Bubbles every 2 shapes so the check sees several; infinite bricks so the run lasts.
  localStorage.setItem('shape-tower-lab-v1', JSON.stringify({ tuning: { bubbleGap: 2, infiniteBudget: true }, view: {} }));
});
await page.goto(url);
await page.waitForSelector('.st-panel', { timeout: 20000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/01-start.png` });
await page.click('.st-panel .st-big');
await page.waitForTimeout(800);

const sim = (fn, arg) => page.evaluate(fn, arg);
const state = () => sim(() => { const s = window.__wobble.scene.sim; return { ctrl: s.ctrl && { x: s.ctrl.x, y: s.ctrl.y, hard: s.ctrl.hard, xTarget: s.ctrl.xTarget }, bubble: s.bubble, slots: [...s.slots], wind: s.secondWind, glue: s.glueLeft, slow: s.slowLeft, hearts: s.hearts, state: s.state, placed: s.stats.placed, f: s.foundation }; });
const shots = {};
const shot = async name => { if (shots[name]) return; shots[name] = true; await page.screenshot({ path: `${out}/${String(Object.keys(shots).length + 1).padStart(2, '0')}-${name}.png` }); };
const used = [];
const tapped = new Set();
const t0 = Date.now();
while (Date.now() - t0 < 100_000) {
  const s = await state();
  if (s.state !== 'playing') break;
  if (s.bubble && !shots.bubble) await shot('bubble');
  if (s.ctrl && !s.ctrl.hard) {
    // Bubbles sit beside the foundation: steer out through one while the shape is above it, then
    // back over the foundation, and drop only once it is there.
    const chase = s.bubble && s.ctrl.y > s.bubble.y - 0.8;
    const x = chase ? s.bubble.x : s.f.x - s.f.width / 2 + 1 + (s.placed % Math.max(1, s.f.width - 2));
    if (Math.abs(s.ctrl.xTarget - x) > 0.01) await sim(x => window.__wobble.scene.sim.intent({ type: 'moveTo', x }), x);
    else if (!chase && Math.abs(s.ctrl.x - x) < 0.01) await sim(() => window.__wobble.scene.sim.intent({ type: 'hardDrop' }));
  }
  // Tap each kind of power once, through the HUD, after a few pieces are down.
  for (let k = 0; k < 2; k++) {
    const kind = s.slots[k];
    if (!kind || tapped.has(kind) || s.placed < 4) continue;
    if (!shots['slots']) await shot('slots');
    tapped.add(kind);
    await page.click(`[data-id="slot${k}"]`);
    await page.waitForTimeout(250);
    await shot(`used-${kind}`);
    const after = await state();
    used.push({ kind, emptied: after.slots[k] === null, glue: after.glue, slow: after.slow });
    break;
  }
  if (s.placed >= 18 && s.wind === 'ready' && !shots['wind-armed']) {
    await page.click('[data-id="wind"]');
    await page.waitForTimeout(120);
    await shot('wind-armed');
    await page.click('[data-id="wind"]', { force: true }); // it pulses while armed, so never "stable"
    await page.waitForTimeout(260);
    await shot('wind-used');
  }
  if (tapped.size >= 5 && shots['wind-used']) break;
  await page.waitForTimeout(150);
}
const end = await state();
await sim(() => window.__wobble.scene.sim.quit());
await page.waitForTimeout(3000);
await shot('results');
const rec = await sim(() => window.__dbWrites.find(w => w.op === 'set' && w.data.kind === 'run')?.data ?? null);
if (rec) writeFileSync(`${out}/run-record.json`, JSON.stringify(rec));
const counts = rec ? rec.inputs.reduce((a, i) => { a[i.i.type] = (a[i.i.type] ?? 0) + 1; return a; }, {}) : null;
console.log(JSON.stringify({ tapped: [...tapped], used, end: { wind: end.wind, slots: end.slots, placed: end.placed, hearts: end.hearts }, record: rec && { secondWind: rec.secondWind, steps: rec.steps, powers: rec.stats.powers, usedWind: rec.stats.secondWind, inputs: counts }, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
