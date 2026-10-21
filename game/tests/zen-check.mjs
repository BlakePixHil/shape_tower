// Plays Zen in the built game headless (gameplay.md §12): it opens from the menu at level 8, the HUD
// shows no shapes to count, no hearts to lose and no Second Wind, lost shapes cost nothing, pause has
// Finish instead of Quit, and the summary pays exactly half XP (the Daily Boost still applies, no
// quit halving) without touching Endless's best, best biome, postcards or the day's free Second Wind.
//   npm run build:game && node tests/zen-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/zen';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
const BEST = 41.5;
await page.addInitScript(best => {
  window.claude = { use: async () => null };
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1');
    // A level 9 player who has climbed to Cloudlands, with today's Daily Boost and free Second Wind unused.
    const day = new Date(Date.now() - 864e5);
    const yesterday = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    localStorage.setItem('shape-tower-profile-v1', JSON.stringify({
      level: 9, xp: 10, total: 9000, runs: 30, streak: 1, lastDay: yesterday, boostDay: yesterday, windDay: yesterday, sliceRuns: 30, player: 'p-zen-check',
      seenGusts: true, seenHazards: ['crosswind', 'junk', 'meteor', 'dust', 'sway'], seenBrittle: true, askedGhost: true,
      stats: { bestHeight: best, bestBiome: 3, bricks: 400, perfects: 20, rows: 10, checkpoints: 9, clutches: 1 },
      postcards: [yesterday, yesterday, yesterday, null, null, null, null, null, null, null],
    }));
    localStorage.setItem('shape-tower-played', '1');
    localStorage.setItem('shape-tower-best', String(best));
  }
}, BEST);
await page.goto(url);
await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
await page.waitForTimeout(1500);
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const shot = name => page.screenshot({ path: `${out}/${name}.png` });

// ---------------------------------------------------------------- the menu
const menu = await page.evaluate(() => {
  const b = document.querySelector('.sc-root.show [data-action="zen"]');
  return { found: !!b, locked: b?.classList.contains('locked') ?? null, text: b?.textContent.replace(/\s+/g, ' ').trim() };
});
await shot('01-menu');
step('Zen is open on the menu at level 9', menu.found && menu.locked === false && /Zen/.test(menu.text) && !/Coming/.test(menu.text), JSON.stringify(menu));

// ---------------------------------------------------------------- a Zen run
await page.click('.sc-root.show [data-action="zen"]');
await page.waitForFunction(() => window.__wobble.scene.sim.ctrl !== null, null, { timeout: 10000 });
await page.waitForSelector('[data-id="zen"]', { timeout: 6000 }).catch(() => null);
await page.waitForTimeout(500);
await shot('02-zen-start');
const start = await page.evaluate(() => {
  const w = window.__wobble, sim = w.scene.sim, hud = w.hud.root;
  return {
    zen: sim.tuning.zen, budget: sim.tuning.infiniteBudget, hearts: sim.tuning.infiniteHearts, wind: sim.secondWind,
    card: hud.querySelector('[data-id="zen"]')?.textContent.replace(/\s+/g, ' ').trim() ?? null,
    heartsText: hud.querySelector('[data-id="hearts"]').textContent.trim(),
    shapesText: hud.querySelector('[data-id="shapes"] b')?.textContent.trim(),
    windHidden: hud.querySelector('[data-id="wind"]').classList.contains('hide'),
    best: w.scene.bestHeight,
  };
});
step('a Zen run: no budget, no hearts to lose, Second Wind off', start.zen && start.budget && start.hearts && start.wind === 'off', JSON.stringify(start));
step('the HUD shows ∞ hearts and ∞ shapes and hides Second Wind', start.heartsText.includes('∞') && start.shapesText === '∞' && start.windHidden, JSON.stringify(start));
step('a Zen card says what Zen is and how to finish', !!start.card && /Zen mode/.test(start.card) && /Finish/.test(start.card), String(start.card));
step('the tower marks no best before the first Zen tower (Endless\'s best stays out)', start.best === 0, String(start.best));

// Build on the foundation, and send every third shape off the edge, until a checkpoint is claimed
// and a few shapes are lost (or 100 s pass).
let i = 0;
const until = Date.now() + 100_000;
let s;
while (Date.now() < until) {
  s = await page.evaluate(() => {
    const sim = window.__wobble.scene.sim;
    return { state: sim.state, ctrl: !!sim.ctrl && !sim.ctrl.hard && sim.ctrl.speed > 0, x: sim.foundation.x, lost: sim.stats.lost ?? null, cps: sim.stats.checkpoints, hearts: sim.hearts, placed: sim.stats.placed };
  });
  if (s.state !== 'playing') break;
  if (s.cps >= 1 && i >= 14) break;
  if (s.ctrl) {
    const x = i % 3 === 2 ? s.x + 7 : s.x - 1 + (i % 3);
    await page.evaluate(x => { const sim = window.__wobble.scene.sim; sim.intent({ type: 'moveTo', x }); sim.intent({ type: 'hardDrop' }); }, x);
    i++;
  }
  await page.waitForTimeout(200);
}
await page.waitForTimeout(1500);
await shot('03-zen-built');
const mid = await page.evaluate(() => {
  const sim = window.__wobble.scene.sim;
  return { state: sim.state, hearts: sim.hearts, max: sim.tuning.hearts, cps: sim.stats.checkpoints, lost: [...sim.pieces.values()].filter(p => p.state === 'lost').length, dropped: sim.stats.placed, height: sim.stats.maxHeight - sim.foundations[0].top, xp: sim.xp() };
});
step('lost shapes cost nothing and the run keeps going', mid.state === 'playing' && mid.hearts === mid.max && i >= 9, JSON.stringify({ ...mid, shapes: i }));

// ---------------------------------------------------------------- pause and Finish
await page.click('[data-id="pause"]');
await page.waitForSelector('.sc-root.show [data-action="quit"]', { timeout: 5000 });
await page.waitForTimeout(300);
await shot('04-pause');
const pause = await page.evaluate(() => {
  const root = document.querySelector('.sc-root.show');
  return { quit: root.querySelector('[data-action="quit"]').textContent.trim(), text: root.textContent.replace(/\s+/g, ' ').trim() };
});
step('pause offers Finish, says it banks the XP, and doesn\'t warn about halving', pause.quit === 'Finish' && /bank/.test(pause.text) && !/halves/.test(pause.text), JSON.stringify(pause));

const xpBefore = await page.evaluate(() => window.__wobble.scene.sim.xp());
await page.click('.sc-root.show [data-action="quit"]');
await page.waitForFunction(() => window.__wobble.scene.sim.state === 'over', null, { timeout: 5000 });
const over = await page.evaluate(() => ({ cause: window.__wobble.scene.sim.cause, xp: window.__wobble.scene.sim.xp(true), height: window.__wobble.scene.sim.stats.maxHeight - window.__wobble.scene.sim.foundations[0].top }));
// Skip the panorama with a tap once it starts, then let the tally run.
await page.waitForTimeout(1800);
await page.mouse.click(10, 400);
await page.waitForSelector('.sc-root.show [data-action="again"]', { timeout: 60000 });
await page.waitForTimeout(3500);
await shot('05-summary');
const sum = await page.evaluate(() => {
  const root = document.querySelector('.sc-root.show');
  const lines = [...root.querySelectorAll('.ui-line')].map(l => [...l.children].map(c => c.textContent.trim()));
  return { kicker: root.querySelector('.ui-kicker')?.textContent.trim(), best: root.querySelector('.ui-best')?.textContent.trim() ?? null, lines };
});
const run = sum.lines.find(l => /Zen run/.test(l[0]));
step('the summary says "Nicely built!" with no best yet', sum.kicker === 'Nicely built!' && sum.best === null, JSON.stringify(sum));
step('exactly half XP: the run line is the sim\'s half, not halved again on Finish', over.cause === 'quit' && run && run[1] === `+${over.xp}` && over.xp === xpBefore, JSON.stringify({ over, xpBefore, run }));
step('the Daily Boost still applies to a Zen run, and no best bonus', sum.lines.some(l => l[0] === 'Daily Boost') && !sum.lines.some(l => l[0] === 'New best'), JSON.stringify(sum.lines));

const prof = await page.evaluate(() => {
  const p = JSON.parse(localStorage.getItem('shape-tower-profile-v1'));
  return { stats: p.stats, postcards: p.postcards, windDay: p.windDay, runs: p.runs, best: localStorage.getItem('shape-tower-best'), zenBest: localStorage.getItem('shape-tower-best-zen') };
});
step('Endless\'s best height, best biome and postcards are untouched', prof.best === String(BEST) && prof.stats.bestHeight === BEST && prof.stats.bestBiome === 3 && prof.postcards.filter(Boolean).length === 3, JSON.stringify({ best: prof.best, stats: prof.stats, cards: prof.postcards.filter(Boolean).length }));
step('the lifetime totals still count the Zen run', prof.stats.bricks > 400 && prof.runs === 31, JSON.stringify({ bricks: prof.stats.bricks, runs: prof.runs }));
const d = new Date(Date.now() - 864e5), yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
step('Zen keeps its own best, and the day\'s free Second Wind is not spent', Math.abs(Number(prof.zenBest) - over.height) < 0.01 && prof.windDay === yesterday, JSON.stringify({ zenBest: prof.zenBest, windDay: prof.windDay, yesterday }));

// ---------------------------------------------------------------- again, then Endless
await page.click('.sc-root.show [data-action="again"]');
await page.waitForFunction(() => window.__wobble.scene.sim.ctrl !== null, null, { timeout: 10000 });
const again = await page.evaluate(() => ({ zen: window.__wobble.scene.sim.tuning.zen, best: window.__wobble.scene.bestHeight }));
step('Play again starts another Zen run, climbing past the Zen best', again.zen === true && Math.abs(again.best - over.height) < 0.01, JSON.stringify(again));
await page.click('[data-id="pause"]');
await page.waitForSelector('.sc-root.show [data-action="quit"]', { timeout: 5000 });
await page.click('.sc-root.show [data-action="quit"]');
await page.waitForTimeout(1800);
await page.mouse.click(10, 400);
await page.waitForSelector('.sc-root.show [data-action="home"]', { timeout: 60000 });
await page.waitForTimeout(500);
if (await page.evaluate(() => document.querySelector('[data-action="continue"]') !== null)) await page.click('[data-action="continue"]');
await page.click('.sc-root.show [data-action="home"]');
await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 10000 });
await page.click('.sc-root.show [data-action="play"]');
await page.waitForFunction(() => window.__wobble.scene.sim.ctrl !== null, null, { timeout: 10000 });
await page.waitForTimeout(400);
const endless = await page.evaluate(() => {
  const w = window.__wobble, sim = w.scene.sim;
  return { zen: sim.tuning.zen, budget: sim.tuning.infiniteBudget, hearts: sim.tuning.infiniteHearts, wind: sim.secondWind, best: w.scene.bestHeight, card: !!w.hud.root.querySelector('[data-id="zen"]') };
});
await shot('06-endless-after');
step('Endless afterwards has its budget, hearts, its own best and the day\'s free Second Wind', endless.zen === false && !endless.budget && !endless.hearts && endless.wind === 'ready' && endless.best === BEST && !endless.card, JSON.stringify(endless));

const failed = steps.filter(x => !x.ok).map(x => x.name);
console.log(JSON.stringify({ failed, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
if (failed.length || errors.length) process.exitCode = 1;
