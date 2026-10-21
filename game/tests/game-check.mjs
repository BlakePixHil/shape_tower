// Plays the built game headless at phone size through every screen: the menu with its demo tower,
// a run, pause, settings, the run-over panorama, the summary with its XP tally, the level-up
// takeover, profile and home. Saves a screenshot of each and the run record.
//   npm run build:game && node tests/game-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/game';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
await page.addInitScript(() => {
  const writes = (window.__dbWrites = []);
  const doc = (col, id = Math.random().toString(36).slice(2)) => ({ set: async d => { writes.push({ op: 'set', path: `${col}/${id}`, data: d }); }, update: async d => { writes.push({ op: 'update', path: `${col}/${id}`, data: d }); } });
  window.claude = { use: async name => (name === 'db' ? { collection: col => ({ doc: id => doc(col, id) }) } : null) };
});
await page.goto(url);
const shot = async name => page.screenshot({ path: `${out}/${name}.png` });
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); };

await page.waitForSelector('.sc-root.show [data-act="play"]', { timeout: 20000 });
await page.waitForTimeout(6500); // the logo drops in and the demo tower builds
await shot('01-menu');
const demo = await page.evaluate(() => { const s = window.__wobble.scene.sim; return { pieces: s.pieceViews().length, record: window.__wobble.shell.record }; });
step('menu shows the demo tower and records nothing', demo.pieces >= 5 && demo.record === null, `${demo.pieces} pieces`);

await page.click('[data-act="settings"]');
await page.waitForTimeout(400);
await shot('02-settings');
await page.click('.sc-seg[data-key="shake"] button[data-v="low"]');
await page.click('[data-act="back"]');
const shake = await page.evaluate(() => JSON.parse(localStorage.getItem('shape-tower-settings-v1') ?? '{}').shake);
step('settings save', shake === 'low', `shake ${shake}`);

await page.waitForTimeout(300);
await page.click('[data-act="profile"]');
await page.waitForTimeout(400);
await shot('03-profile');
await page.click('[data-act="back"]');
await page.waitForTimeout(300);

await page.click('[data-act="play"]');
await page.waitForTimeout(600);
const started = await page.evaluate(() => { const s = window.__wobble.scene; return { started: s.started, menu: document.querySelector('.sc-root.show') !== null, hold: s.sim.tuning.holdUnlocked, mortar: s.sim.tuning.mortarStrength }; });
step('Play starts a run with the level-1 settings', started.started && !started.menu && started.hold === false && started.mortar === 1.2, JSON.stringify(started));

// Play a few shapes, then pause.
const sim = (fn, arg) => page.evaluate(fn, arg);
const t0 = Date.now();
let col = 0;
while (Date.now() - t0 < 12000) {
  const s = await sim(() => { const s = window.__wobble.scene.sim; return { ctrl: s.ctrl && { hard: s.ctrl.hard }, f: s.foundation, placed: s.stats.placed }; });
  if (s.ctrl && !s.ctrl.hard) {
    const x = s.f.x - s.f.width / 2 + 1 + (col++ % Math.max(1, s.f.width - 2));
    await sim(x => { const sm = window.__wobble.scene.sim; sm.intent({ type: 'moveTo', x }); sm.intent({ type: 'hardDrop' }); }, x);
  }
  if (s.placed >= 6) break;
  await page.waitForTimeout(200);
}
await shot('04-play');
const rail = await page.evaluate(() => ({ bands: document.querySelectorAll('.st-rail .st-band').length, ticks: document.querySelectorAll('.st-rail .st-tick.next').length, me: parseFloat(document.querySelector('.st-rail .st-me').style.bottom), rail: getComputedStyle(document.querySelector('.st-rail')).display }));
step('the altitude rail shows the stretch, the next checkpoint and the tower top', rail.rail !== 'none' && rail.bands >= 1 && rail.ticks === 1 && rail.me > 0, JSON.stringify(rail));
await page.click('[data-id="pause"]');
await page.waitForTimeout(400);
await shot('05-pause');
const paused = await sim(() => window.__wobble.scene.paused);
step('pause stops the run', paused === true);
await page.click('[data-act="settings"]');
await page.waitForTimeout(300);
await page.click('[data-act="back"]');
await page.waitForTimeout(300);
const backToPause = await page.evaluate(() => document.querySelector('[data-act="resume"]') !== null);
step('settings from pause returns to pause', backToPause);
await page.click('[data-act="resume"]');
await page.waitForTimeout(300);

// Keep building, then quit from the pause menu.
const t1 = Date.now();
while (Date.now() - t1 < 25000) {
  const s = await sim(() => { const s = window.__wobble.scene.sim; return { ctrl: s.ctrl && { hard: s.ctrl.hard }, f: s.foundation, placed: s.stats.placed, state: s.state }; });
  if (s.state !== 'playing') break;
  if (s.ctrl && !s.ctrl.hard) {
    const x = s.f.x - s.f.width / 2 + 1 + (col++ % Math.max(1, s.f.width - 2));
    await sim(x => { const sm = window.__wobble.scene.sim; sm.intent({ type: 'moveTo', x }); sm.intent({ type: 'hardDrop' }); }, x);
  }
  if (s.placed >= 16) break;
  await page.waitForTimeout(200);
}
await page.click('[data-id="pause"]');
await page.waitForTimeout(300);
await page.click('[data-act="quit"]');
await page.waitForTimeout(2600);
await shot('06-panorama');
await page.waitForSelector('.sc-root.show [data-act="go"], .sc-root.show [data-act="again"]', { timeout: 15000 });
await page.waitForTimeout(500);
await shot('07-after-run');
const lvl = await page.evaluate(() => document.querySelector('[data-act="go"]') !== null);
step('the first run levels up to 2 with the Hold unlock card', lvl);
if (lvl) {
  await page.waitForTimeout(1200);
  await shot('08-levelup');
  await page.click('[data-act="go"]');
  await page.waitForTimeout(400);
}
await shot('09-summary');
const summary = await page.evaluate(() => ({ again: document.querySelector('[data-act="again"]') !== null, xp: document.querySelector('.sc-xpn')?.textContent, level: document.querySelector('.sc-lv')?.textContent }));
step('the summary shows the XP tally and Play again', summary.again && /\+\d+ XP/.test(summary.xp ?? ''), JSON.stringify(summary));
await page.click('.sc-ask .sc-btn');
const rec = await sim(() => window.__dbWrites.find(w => w.op === 'set' && w.data.kind === 'run')?.data ?? null);
if (rec) writeFileSync(`${out}/run-record.json`, JSON.stringify(rec));
step('the first run record: app game, juice-on warm-up, player id, feel answer', rec?.app === 'game' && rec?.juice === 'on' && rec?.juiceRun === 0 && /^p-/.test(rec?.player ?? '') && rec?.cause === 'quit', rec ? `${rec.app} ${rec.juice} run ${rec.juiceRun} ${rec.player} ${rec.cause} ${rec.stats?.placed} placed` : 'none');
const answered = await sim(() => window.__dbWrites.filter(w => w.op === 'update').map(w => w.data));
step('the face answer is saved as a number', answered.some(d => d.answers?.feel === 1), JSON.stringify(answered));

await page.click('[data-act="home"]');
await page.waitForTimeout(1500);
await shot('10-home');
const home = await page.evaluate(() => ({ menu: document.querySelector('[data-act="play"]') !== null, level: document.querySelector('.sc-chip b')?.textContent }));
step('Home goes back to the menu at the new level', home.menu && home.level === 'Level 2', JSON.stringify(home));
await page.click('[data-act="play"]');
await page.waitForTimeout(600);
const again = await sim(() => ({ hold: window.__wobble.scene.sim.tuning.holdUnlocked, locked: document.querySelector('[data-id="holdcard"]').classList.contains('locked'), juice: window.__wobble.scene.view.juice }));
step('level 2 opens Hold', again.hold === true && again.locked === false, JSON.stringify(again));
step('the second run is the first of a block: juice off', again.juice === false, JSON.stringify(again));
const exits = await sim(() => window.__dbWrites.filter(w => w.op === 'update' && w.data.exit).map(w => w.data.exit));
step('leaving the card records exit', exits[0] === 'menu', JSON.stringify(exits));

console.log(JSON.stringify({ steps, failed: steps.filter(s => !s.ok).map(s => s.name), errors: errors.slice(0, 10) }, null, 1));
await browser.close();
