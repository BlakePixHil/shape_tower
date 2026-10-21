// Plays the built game headless and checks the avatar picker (profile → avatar → pick → Done, locked
// hats) and the celebrations (a height milestone and a crossed best, with juice on and off).
//   npm run build:game && node tests/avatar-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/avatar';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
await page.addInitScript(() => {
  window.claude = { use: async () => null };
  // A level 9 player, so four hats are open and two stay locked.
  localStorage.setItem('shape-tower-profile-v1', JSON.stringify({ level: 9, xp: 10, total: 5000, runs: 12, sliceRuns: 12, player: 'p-test' }));
  localStorage.setItem('shape-tower-played', '1');
});
await page.goto(url);
await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
await page.waitForTimeout(1500);
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

const first = await page.evaluate(() => window.__wobble.profile.avatar);
await page.screenshot({ path: `${out}/01-menu.png` });
step('a profile saved before avatars gets the O in the party hat', first.shape === 'O' && first.hat === 'party', JSON.stringify(first));

await page.click('[data-action="profile"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/02-profile.png` });
await page.click('.sc-root.show [data-action="avatar"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/03-picker.png` });
const picker = await page.evaluate(() => {
  const root = document.querySelector('.sc-root.show');
  const opts = [...root.querySelectorAll('input[data-kind="hat"]')];
  return { shown: !!root.querySelector('[data-action="done"]'), hats: opts.length, locked: opts.filter(o => o.disabled).length };
});
step('the avatar picker opens from the profile, with the top hat and crown locked at level 9', picker.shown && picker.hats === 7 && picker.locked === 2, `${picker.hats} hat options, ${picker.locked} locked`);

// Pick the T, the proud face and the propeller beanie (level 7), then Done.
await page.click('.sc-root.show label:has(> input[data-kind="shape"][value="T"])');
await page.click('.sc-root.show label:has(> input[data-kind="face"][value="proud"])');
await page.click('.sc-root.show label:has(> input[data-kind="hat"][value="propeller"])');
const crownLocked = await page.evaluate(() => document.querySelector('.sc-root.show input[data-kind="hat"][value="crown"]').disabled);
await page.screenshot({ path: `${out}/04-picked.png` });
await page.click('.sc-root.show [data-action="done"]');
await page.waitForTimeout(400);
const saved = await page.evaluate(() => ({ now: document.querySelector('.sc-root.show [data-action="avatar"]') !== null, stored: JSON.parse(localStorage.getItem('shape-tower-profile-v1')).avatar }));
await page.screenshot({ path: `${out}/05-profile-after.png` });
step('Done saves the avatar and returns to the profile; locked hats cannot be picked', saved.now && saved.stored.shape === 'T' && saved.stored.face === 'proud' && saved.stored.hat === 'propeller' && crownLocked, JSON.stringify(saved));

// Close goes home; the menu shows the new avatar (same image as the profile's).
await page.click('.sc-root.show [data-action="close"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/06-menu-after.png` });

// Celebrations: a milestone right away, then a personal best crossed.
await page.click('[data-action="play"]');
await page.waitForTimeout(800);
const celebrate = juice => page.evaluate(async juice => {
  const sc = window.__wobble.scene, names = [];
  sc.applyView({ ...sc.view, juice });
  const orig = sc.hooks.onJuice; let activeAfter = null;
  sc.hooks.onJuice = (n, p) => { names.push(n); orig?.(n, p); if (n === 'height_milestone') setTimeout(() => { activeAfter = sc.party.active; }, 0); };
  const sim = sc.sim;
  sim.tuning.infiniteHearts = true; // nothing this test drops may end the run
  sim.tuning.infiniteBudget = true; // nor running out of shapes (#34)
  sc.nextMilestone = sim.height().committed + 0.5; sc.bestHeight = sim.height().committed + 1.2; sc.pbCrossed = false;
  // Stack over the foundation's middle until both fire. A loaded machine runs few frames, so this
  // waits on the events, up to a minute, not on a fixed number of drops.
  const until = Date.now() + 60_000;
  for (let i = 0; Date.now() < until && sim.state === 'playing' && !(names.includes('height_milestone') && names.includes('pb_crossed')); i++) {
    if (sim.ctrl && !sim.ctrl.hard) { sim.intent({ type: 'moveTo', x: sim.foundation.x - 1 + (i % 3) }); sim.intent({ type: 'hardDrop' }); }
    await new Promise(r => setTimeout(r, 300));
  }
  await new Promise(r => setTimeout(r, 50));
  sc.hooks.onJuice = orig;
  return { names: names.filter(n => n === 'height_milestone' || n === 'pb_crossed'), activeAfter, playing: sim.state === 'playing' };
}, juice);
const on = await celebrate(true);
await page.screenshot({ path: `${out}/07-celebration.png` });
step('juice on: a milestone and a crossed best fire their events, and a celebration plays', on.names.includes('height_milestone') && on.names.includes('pb_crossed') && on.activeAfter === true, JSON.stringify(on));
// Wait for the juice-on celebration to finish (wall time varies with load), then the same with juice off.
const quiet = await page.waitForFunction(() => !window.__wobble.scene.party.active, null, { timeout: 30000, polling: 250 }).then(() => true, () => false);
const live = await page.evaluate(() => window.__wobble.scene.sim.state === 'playing');
if (!quiet || !live) step('juice off: the run is still going and the last celebration has finished', false, `celebration finished ${quiet}, run playing ${live}`);
else {
  const off = await celebrate(false);
  step('juice off: the events still fire for Sound, with no celebration', off.names.includes('height_milestone') && off.activeAfter === false, JSON.stringify(off));
}
await browser.close();
const failed = [...steps.filter(s => !s.ok).map(s => s.name), ...errors];
console.log(JSON.stringify({ failed, errors }, null, 1));
process.exit(failed.length ? 1 : 0);
