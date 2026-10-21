// Plays the built game headless down to its last shapes (Blake's playtest, 2026-10-21): the bag sits
// bottom right, a new shape waits at the top early on, the counter and banners warn at 5, 3 and 1
// left, the red edge comes on at 3, and a run that ends on shapes says so, through the panorama,
// and on the summary card.
//   npm run build:game && node tests/budget-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/budget';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
await page.addInitScript(() => {
  window.claude = { use: async () => null };
  // Every banner that goes up, in order: its kind and its words.
  window.__banners = [];
  new MutationObserver(ms => {
    for (const m of ms) {
      for (const n of m.addedNodes) {
        if (n instanceof HTMLElement && n.classList.contains('ui-salert')) window.__banners.push({ kind: [...n.classList].find(c => ['soft', 'hard', 'out'].includes(c)), text: n.textContent.trim(), onPage: n.parentElement === document.body });
        if (n instanceof HTMLElement && n.dataset.id === 'run-end') window.__stamp = { at: performance.now() };
      }
      for (const n of m.removedNodes) if (n instanceof HTMLElement && n.dataset.id === 'run-end' && window.__stamp) window.__stamp.gone = performance.now();
    }
  }).observe(document, { childList: true, subtree: true });
});
await page.goto(url);
const shot = async name => page.screenshot({ path: `${out}/${name}.png` });
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); };

await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
await page.waitForTimeout(2000);
await page.click('[data-action="play"]');
await page.waitForFunction(() => window.__wobble.scene.sim.ctrl !== null, null, { timeout: 10000 });

const first = await page.evaluate(() => {
  const sim = window.__wobble.scene.sim, bag = document.querySelector('[data-id="holdcard"]').getBoundingClientRect();
  return { waiting: sim.waiting, speed: sim.ctrl.speed, bagRight: innerWidth - bag.right, bagBottom: innerHeight - bag.bottom, bag: document.querySelector('[data-id="holdcard"]').className };
});
step('a new shape waits at the top in the first stretch', first.waiting && first.speed === 0, JSON.stringify(first));
step('the bag sits bottom right, locked at level 1', first.bagRight >= 0 && first.bagRight < 24 && first.bagBottom >= 0 && first.bagBottom < 40 && /ui-bag/.test(first.bag) && /locked/.test(first.bag), JSON.stringify(first));

// Down to 6 left, then drop shapes until the budget runs dry. Hearts can't end it, and the line
// moves out of reach so a claim can't hand out more shapes.
await page.evaluate(() => { const sim = window.__wobble.scene.sim; sim.tuning.infiniteHearts = true; sim.used = sim.budget - 6; sim.lineY += 40; });
// Watched in the page, so a slow round trip can't miss it: the moment the HUD hides for the
// panorama (1.3 s after the end). A short tower's glide can finish at once, so the summary may
// already be up then, and has taken the stamp down.
const hidden = page.evaluate(() => new Promise(res => {
  const t0 = performance.now();
  const tick = () => {
    const el = document.querySelector('[data-id="run-end"]');
    if (getComputedStyle(window.__wobble.hud.root).display === 'none') res({ text: el?.textContent.trim() ?? null, summary: !!document.querySelector('.sc-root.show .ui-summary'), stamp: window.__stamp });
    else if (performance.now() - t0 > 120_000) res(null);
    else setTimeout(tick, 30);
  };
  tick();
}));
const seen = { low: false, alert: false, edge: false };
const until = Date.now() + 90_000;
let i = 0;
while (Date.now() < until) {
  const s = await page.evaluate(() => {
    const sim = window.__wobble.scene.sim, c = document.querySelector('[data-id="shapes"]');
    return { state: sim.state, ctrl: !!sim.ctrl && !sim.ctrl.hard, x: sim.foundation.x, left: sim.budget - sim.used, cls: c?.className ?? '', edge: !!document.querySelector('.ui-edge.on') };
  });
  if (s.left <= 5 && /\blow\b/.test(s.cls)) seen.low = true;
  if (s.left <= 3 && /\balert\b/.test(s.cls)) seen.alert = true;
  if (s.left <= 3 && s.edge) seen.edge = true;
  if (s.state !== 'playing') break;
  if (s.ctrl && s.left > 0) await page.evaluate(x => { const sim = window.__wobble.scene.sim; sim.intent({ type: 'moveTo', x }); sim.intent({ type: 'hardDrop' }); }, s.x - 1 + (i++ % 3));
  if (s.left === 3 && !seen.shot3) { seen.shot3 = true; await page.waitForTimeout(400); await shot('01-three-left'); }
  await page.waitForTimeout(250);
}
const banners = await page.evaluate(() => window.__banners);
step('the counter turns amber at 5 and red at 3, with the red edge', seen.low && seen.alert && seen.edge, JSON.stringify(seen));
const words = banners.map(b => b.text);
step('banners at 5, 3 and 1 left', words.some(w => /5 shapes left/.test(w)) && words.some(w => /3 SHAPES LEFT!/.test(w)) && words.some(w => /LAST SHAPE!/.test(w)), JSON.stringify(words));
const cause = await page.evaluate(() => window.__wobble.scene.sim.cause);
step('the run ends on shapes', cause === 'bricks', String(cause));
const during = await hidden;
await shot('02-out-of-shapes');
const upFor = during?.stamp ? (during.stamp.gone ?? Infinity) - during.stamp.at : 0;
step('"OUT OF SHAPES!" is stamped on the page and stays up into the panorama or until the summary', banners.at(-1)?.kind === 'out' && banners.at(-1)?.onPage && (during?.text === 'OUT OF SHAPES!' || (during?.summary && upFor >= 1200)), JSON.stringify({ during, upFor, last: banners.at(-1) }));
await page.waitForSelector('.sc-root.show [data-action="continue"], .sc-root.show [data-action="again"]', { timeout: 60000 });
await page.waitForTimeout(3500); // the tally runs; a first run then levels up
if (await page.evaluate(() => document.querySelector('[data-action="continue"]') !== null)) {
  await page.waitForTimeout(1200);
  await page.click('[data-action="continue"]');
  await page.waitForTimeout(400);
}
await shot('03-summary');
const summary = await page.evaluate(() => ({ text: document.querySelector('.sc-root.show')?.textContent ?? '', stamp: !!document.querySelector('[data-id="run-end"]') }));
step('the summary says "Out of shapes!" and the stamp has gone', summary.text.includes('Out of shapes!') && !summary.stamp, summary.text.slice(0, 80));

const failed = steps.filter(s => !s.ok).map(s => s.name);
console.log(JSON.stringify({ steps, failed, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
if (failed.length || errors.length) process.exitCode = 1;
