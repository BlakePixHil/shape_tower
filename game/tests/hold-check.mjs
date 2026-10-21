// Plays the built game headless to a checkpoint's hold (Blake, 2026-10-21: "when the checkpoint is
// counting down, the screen should slightly fade grayscale (not fully) and pause on shape interactions
// briefly"): the screen fades part-way to grey as the hold fills, a knock during it freezes the frame
// for a beat, and colour comes back once the checkpoint is claimed.
//   npm run build:game && node tests/hold-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/hold';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
await page.addInitScript(() => { window.claude = { use: async () => null }; });
await page.goto(url);
const shot = async name => page.screenshot({ path: `${out}/${name}.png` });
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); };
const mood = () => page.evaluate(() => { const sc = window.__wobble.scene, f = sc.holdFilter; return { grey: sc.grey, active: !!f?.active, alpha: f?.colorMatrix.alpha ?? null, hold: sc.sim.holdState(), juice: sc.view.juice !== false }; });

await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
await page.waitForTimeout(2000);
await page.click('[data-action="play"]');
await page.waitForFunction(() => window.__wobble.scene.sim.ctrl !== null, null, { timeout: 10000 });
const before = await mood();
step('a run starts in full colour, with the filter off', before.juice && before.grey === 0 && before.active === false, JSON.stringify(before));

// Log the scene's hit-stops, and whether a hold was filling at the time.
await page.evaluate(() => {
  const sc = window.__wobble.scene, orig = sc.hooks.onJuice;
  window.__stops = [];
  sc.hooks.onJuice = (n, p) => { if (n === 'hitstop') window.__stops.push({ ms: p.ms, hold: sc.sim.holdState().active }); orig?.(n, p); };
  sc.sim.tuning.infiniteHearts = true;
  sc.sim.tuning.infiniteBudget = true;
});
// Two shapes on the slab, then bring the line down to the tower so the hold starts.
const drop = x => page.evaluate(x => { const sim = window.__wobble.scene.sim; if (sim.ctrl && !sim.ctrl.hard) { sim.intent({ type: 'moveTo', x }); sim.intent({ type: 'hardDrop' }); return true; } return false; }, x);
for (let i = 0, t0 = Date.now(); i < 2 && Date.now() - t0 < 20000;) { if (await drop(i * 2 - 1)) i++; await page.waitForTimeout(300); }
await page.waitForFunction(() => { const s = window.__wobble.scene.sim; return s.stats.placed >= 2 && s.height().committed > s.foundation.top + 0.5; }, null, { timeout: 30000 });
await page.evaluate(() => { const s = window.__wobble.scene.sim; s.lineY = s.height().committed; });
await page.waitForFunction(() => window.__wobble.scene.sim.holdState().active, null, { timeout: 15000 });
await page.waitForFunction(() => window.__wobble.scene.grey > 0.15, null, { timeout: 15000 }).catch(() => {});
const during = await mood();
await shot('01-hold-grey');
step('the screen fades part-way to grey while the hold fills', during.hold.active && during.active && during.grey > 0.15 && during.grey <= 0.56 && during.alpha === during.grey, JSON.stringify(during));

// A hard drop onto the tower during the hold knocks it: a freeze-frame.
for (let t0 = Date.now(); Date.now() - t0 < 20000;) { if (await drop(0)) break; await page.waitForTimeout(200); }
await page.waitForFunction(() => window.__stops.some(s => s.hold), null, { timeout: 20000 }).catch(() => {});
const stops = await page.evaluate(() => window.__stops);
const knock = stops.find(s => s.hold);
step('a knock during the hold freezes the frame for a beat', !!knock && knock.ms >= 60 && knock.ms <= 120, JSON.stringify(stops));

// Let it claim (the line sits just under the tower top), then colour comes back.
await page.evaluate(() => { const s = window.__wobble.scene.sim; s.lineY = Math.min(s.lineY, s.height().committed); });
await page.waitForFunction(() => window.__wobble.scene.sim.checkpoint >= 2, null, { timeout: 60000 }).catch(() => {});
await page.waitForFunction(() => window.__wobble.scene.grey === 0, null, { timeout: 15000 }).catch(() => {});
const after = await mood();
await shot('02-claimed');
step('after the claim the colour is back and the filter is off', after.grey === 0 && after.active === false && (await page.evaluate(() => window.__wobble.scene.sim.checkpoint)) >= 2, JSON.stringify(after));

const failed = steps.filter(s => !s.ok).map(s => s.name);
console.log(JSON.stringify({ steps, failed, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
if (failed.length || errors.length) process.exitCode = 1;
