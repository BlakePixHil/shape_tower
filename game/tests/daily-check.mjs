// The Daily Tower in the built game (gameplay.md §12, QA F17, Q31, Q32): the menu button and its "!",
// the Daily card, practice and the scored try with their rules, the one-try lock across reloads, the
// summary chip, the Daily achievements, and the next day's tower.
//   npm run build:game && node tests/daily-check.mjs [outDir]      (QA_FONTS=<dir> serves the fonts)

import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/daily';
mkdirSync(out, { recursive: true });
// Served over http: on a file:// page, Chromium sometimes hands a reloaded page an empty localStorage,
// and this check reloads to stand in for an app that was closed.
const html = readFileSync(new URL('../dist-game/game.html', import.meta.url));
const missing = [];
const server = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/game.html')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
  // The browser asks for /favicon.ico on its own; anything else missing is a real error.
  if (req.url !== '/favicon.ico') missing.push(req.url);
  res.writeHead(req.url === '/favicon.ico' ? 204 : 404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/game.html`;
const fonts = process.env.QA_FONTS;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const errors = [];

// Daily #2 is 22 October 2026 (UTC). Each page load starts its clock at the test's time and lets it run
// (Playwright's fixed clock stalls the page's screenshots under SwiftShader).
const DAY1 = new Date('2026-10-22T15:00:00Z');
const DAY2 = new Date('2026-10-23T09:00:00Z');

async function open(viewport, time) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(`console: ${m.text()}`); });
  if (fonts && existsSync(`${fonts}/fonts.css`)) {
    await page.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: readFileSync(`${fonts}/fonts.css`, 'utf8') }));
    await page.route('https://fonts.gstatic.com/**', r => {
      const f = `${fonts}/${new URL(r.request().url()).pathname.split('/').pop()}`;
      return existsSync(f) ? r.fulfill({ contentType: 'font/woff2', body: readFileSync(f) }) : r.abort();
    });
  }
  await page.addInitScript(t => {
    const want = Number(localStorage.getItem('__test_now')) || t, off = want - Date.now(), Real = Date;
    class TestDate extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); } static now() { return Real.now() + off; } }
    window.Date = TestDate;
  }, time.getTime());
  await page.addInitScript(() => {
    window.claude = { use: async () => null };
    // A level 6 player (the head-start power-up is on), Daily unlocked at 3. Set once per context.
    if (!localStorage.getItem('shape-tower-profile-v1')) {
      localStorage.setItem('shape-tower-profile-v1', JSON.stringify({
        level: 6, xp: 40, total: 4000, runs: 20, streak: 1, lastDay: '2026-10-21', boostDay: '2026-10-21', sliceRuns: 21, player: 'p-daily-check', seenGusts: true,
        stats: { bestHeight: 41.5, bestBiome: 3, bricks: 900, perfects: 40, rows: 10, checkpoints: 30, clutches: 2 },
      }));
      localStorage.setItem('shape-tower-played', '1');
      localStorage.setItem('shape-tower-best', '41.5');
    }
  });
  await page.goto(url);
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
  return { ctx, page };
}

const menuDaily = page => page.evaluate(() => {
  const b = document.querySelector('.ui-mode[data-action="daily"]');
  return { locked: b?.classList.contains('locked'), sub: b?.querySelector('span')?.textContent, dot: !!b?.querySelector('.ui-dl-dot') };
});
const card = page => page.evaluate(() => {
  const c = document.querySelector('.ui-daily');
  if (!c) return null;
  return {
    title: c.querySelector('.ui-h1')?.textContent, count: c.querySelector('.ui-dl-count b')?.textContent,
    opening: [...c.querySelectorAll('.ui-dl-opening img')].map(i => i.dataset.shape), openingOk: [...c.querySelectorAll('.ui-dl-opening img')].every(i => i.naturalWidth > 0),
    scoredBtn: !!c.querySelector('[data-action="scored"]'), scoredText: c.querySelector('[data-action="scored"]')?.textContent?.trim(),
    result: c.querySelector('.ui-dl-result .ui-score b')?.textContent ?? null, practice: c.querySelector('.ui-dl-line')?.textContent?.replace(/\s+/g, ' ').trim(),
    best: [...c.querySelectorAll('.ui-dl-best li')].map(l => l.textContent.replace(/\s+/g, ' ').trim()),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    buttonsFit: [...c.querySelectorAll('button')].filter(b => b.offsetParent).every(b => { const r = b.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; }),
  };
});
const run = page => page.evaluate(() => {
  const sim = window.__wobble.scene.sim, hud = document.querySelector('[data-id="mode"]');
  return { seed: sim.seed, secondWind: sim.secondWind, slots: sim.slots.filter(Boolean).length, tag: hud?.hidden ? null : hud?.textContent, gold: hud?.classList.contains('gold'), state: sim.state };
});
const daily = page => page.evaluate(() => JSON.parse(localStorage.getItem('shape-tower-profile-v1')).daily);
async function toSummary(page) {
  await page.evaluate(() => window.__wobble.scene.sim.quit());
  await page.waitForFunction(() => window.__wobble.scene.sim.state !== 'playing', null, { timeout: 10000 });
  for (let i = 0; i < 40 && !(await page.$('.sc-root.show .ui-summary')); i++) { await page.evaluate(() => window.__wobble.scene.skipPanorama?.()); await page.waitForTimeout(250); }
  await page.waitForSelector('.sc-root.show .ui-summary', { timeout: 20000 });
  await page.waitForTimeout(2500); // the XP tally
}
const summary = page => page.evaluate(() => ({
  chip: document.querySelector('.ui-dl-chip')?.textContent?.trim(), again: document.querySelector('.ui-summary [data-action="again"]')?.textContent?.trim(),
  strip: [...document.querySelectorAll('.ui-achstrip img')].map(i => i.alt),
}));
const setNow = (page, t) => page.evaluate(ms => localStorage.setItem('__test_now', String(ms)), t.getTime());
const play = async page => { await page.waitForTimeout(600); return page.evaluate(() => window.__wobble.scene.sim.stepIndex); };

// ---------------------------------------------------------------- day 1 (Daily #2)

const { ctx, page } = await open({ width: 390, height: 844 }, DAY1);
const shot = name => page.screenshot({ path: `${out}/${name}.png` });
let m = await menuDaily(page);
step('menu: Daily open at level 6, "#2 is ready" with a "!"', !m.locked && m.sub === '#2 is ready' && m.dot, JSON.stringify(m));
await shot('01-menu');

await page.click('[data-action="daily"]');
await page.waitForSelector('.ui-daily');
await page.waitForTimeout(400);
await shot('02-card');
let c = await card(page);
step('card: Daily #2, a countdown to 00:00 UTC (9h 0m), today\'s 3 or 5 shapes (§12.3)', c.title === '#2' && /^(9h 0m|8h 59m)$/.test(c.count) && [3, 5].includes(c.opening.length) && c.openingOk, JSON.stringify(c));
step('card: scored and practice buttons, all tappable (44 px), no sideways scroll', c.scoredBtn && c.buttonsFit && !c.overflowX);
const opening = c.opening;

// Practice: same seed, Second Wind to earn, the level 6 head start kept.
await page.click('.ui-daily [data-action="practice"]');
await page.waitForFunction(() => window.__wobble.scene.started && window.__wobble.scene.sim?.stepIndex > 0, null, { timeout: 10000 });
let r = await run(page);
const seed2 = r.seed;
step('practice: HUD says DAILY #2 · PRACTICE, Second Wind to earn, head start kept', r.tag === 'DAILY #2 · PRACTICE' && !r.gold && r.secondWind === 'earn' && r.slots === 1, JSON.stringify(r));
const dealt = await page.evaluate(() => { const sim = window.__wobble.scene.sim; return [sim.ctrl?.shape ?? '?', ...sim.queue.slice(0, 4)]; });
step('the run deals only the card\'s shapes', dealt.length > 0 && dealt.every(k => opening.includes(k)), `card ${opening.join(' ')} · run ${dealt.join(' ')}`);
await toSummary(page);
await shot('03-practice-summary');
let s = await summary(page);
step('practice summary: "Daily #2 · Practice" chip, again says "Practice again"', s.chip === 'Daily #2 · Practice' && s.again === 'Practice again', JSON.stringify(s));
let d = await daily(page);
step('practice is kept for the day and the scored try is still open', d.practice['2026-10-22']?.runs === 1 && !d.scored['2026-10-22'], JSON.stringify(d));

// Practice again: the same seed.
await page.click('.ui-summary [data-action="again"]');
await page.waitForFunction(() => window.__wobble.scene.started && window.__wobble.scene.sim?.stepIndex > 0 && window.__wobble.scene.sim.state === 'playing', null, { timeout: 10000 });
r = await run(page);
step('practice again: the same seed', r.seed === seed2 && r.tag === 'DAILY #2 · PRACTICE', String(r.seed));
const pausedRestart = await (async () => {
  await page.click('[data-id="pause"]');
  await page.waitForSelector('.sc-root.show [data-action="resume"]');
  const has = !!(await page.$('.sc-root.show [data-action="restart"]'));
  await page.click('.sc-root.show [data-action="resume"]');
  return has;
})();
step('practice can be restarted from pause', pausedRestart);
await toSummary(page);
await page.click('.ui-summary [data-action="home"]');
await page.waitForSelector('.sc-root.show [data-action="play"]');
m = await menuDaily(page);
step('menu still shows the "!" after practice', m.dot && m.sub === '#2 is ready', JSON.stringify(m));

// The scored try: a first tap only arms it.
await page.click('[data-action="daily"]');
await page.waitForSelector('.ui-daily');
await page.click('.ui-daily [data-action="scored"]');
await page.waitForTimeout(200);
c = await card(page);
const armed = await page.evaluate(() => document.querySelector('.ui-daily [data-action="scored"]')?.classList.contains('armed'));
step('scored: the first tap arms it ("Tap again to start") and starts nothing', armed && c.scoredText === 'Tap again to start' && !!(await page.$('.ui-daily')) && !(await daily(page)).scored['2026-10-22'], c.scoredText);
await shot('04-armed');
await page.waitForTimeout(2700);
c = await card(page);
step('scored: it disarms after 2.5 s', c.scoredText === 'Scored try', c.scoredText);
// The armed button pulses, so Playwright's wait for a still element would sit out the 2.5 s: force the second tap.
await page.click('.ui-daily [data-action="scored"]');
await page.click('.ui-daily [data-action="scored"]', { force: true });
await page.waitForFunction(() => window.__wobble.scene.started && window.__wobble.scene.sim?.stepIndex > 0 && window.__wobble.scene.sim.state === 'playing', null, { timeout: 10000 });
await play(page);
r = await run(page);
step('scored: same seed, gold "DAILY #2 · SCORED", no Second Wind, empty slots at level 6', r.seed === seed2 && r.tag === 'DAILY #2 · SCORED' && r.gold && r.secondWind === 'off' && r.slots === 0, JSON.stringify(r));
await shot('05-scored-hud');
d = await daily(page);
step('scored: spent once the first shape spawned (saved, not finished)', !!d.scored['2026-10-22'] && d.scored['2026-10-22'].finished === false, JSON.stringify(d.scored));
await page.click('[data-id="pause"]');
await page.waitForSelector('.sc-root.show [data-action="resume"]');
step('scored: pause has no Restart', !(await page.$('.sc-root.show [data-action="restart"]')));
await shot('06-scored-pause');
await page.click('.sc-root.show [data-action="resume"]');
await toSummary(page);
await shot('07-scored-summary');
s = await summary(page);
step('scored summary: gold "Daily #2 · Scored" chip, again says "Practice"', s.chip === 'Daily #2 · Scored' && s.again === 'Practice', JSON.stringify(s));
step('scored summary: pays the Daily Grind achievement', s.strip.includes('Daily Grind'), s.strip.join(', '));
d = await daily(page);
step('scored: finished and kept', d.scored['2026-10-22']?.finished === true, JSON.stringify(d.scored));
await page.click('.ui-summary [data-action="home"]');
await page.waitForSelector('.sc-root.show [data-action="play"]');
m = await menuDaily(page);
step('menu: no "!" once scored, "Done today · new in …"', !m.dot && /^Done today · new in \d+h \d+m$/.test(m.sub ?? ''), JSON.stringify(m));

// A reload (or a force-quit) never gives the try back (F17.1, D14).
await page.reload();
await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
await page.click('[data-action="daily"]');
await page.waitForSelector('.ui-daily');
await page.waitForTimeout(300);
c = await card(page);
step('after a reload the card shows today\'s score and no scored button', !c.scoredBtn && c.result !== null && c.best.length === 1 && /today/.test(c.best[0]), JSON.stringify(c));
await shot('08-card-done');
await ctx.close();

// ---------------------------------------------------------------- an unfinished try, then the next day

{
  // A try the app died in: spent with what it had, shown as unfinished.
  const { ctx, page } = await open({ width: 360, height: 640 }, DAY1);
  await page.click('[data-action="daily"]');
  await page.waitForSelector('.ui-daily');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/09-card-360.png` });
  c = await card(page);
  step('card fits a 360 x 640 phone: no sideways scroll, buttons 44 px', !c.overflowX && c.buttonsFit, JSON.stringify({ overflowX: c.overflowX, fit: c.buttonsFit }));
  await page.click('.ui-daily [data-action="scored"]');
  await page.click('.ui-daily [data-action="scored"]', { force: true });
  await page.waitForFunction(() => window.__wobble.scene.started && window.__wobble.scene.sim?.stepIndex > 0 && window.__wobble.scene.sim.state === 'playing', null, { timeout: 10000 });
  await play(page);
  await page.reload(); // the app is killed mid-try
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
  await page.click('[data-action="daily"]');
  await page.waitForSelector('.ui-daily');
  c = await card(page);
  const unfinished = await page.evaluate(() => !!document.querySelector('.ui-dl-unfinished'));
  step('a try the app died in stays spent, shown as unfinished', !c.scoredBtn && unfinished, JSON.stringify(c));
  await page.screenshot({ path: `${out}/10-card-unfinished.png` });

  // The next day: a new seed, the try is open again, and yesterday sits in the best days.
  await setNow(page, DAY2);
  await page.reload();
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
  m = await menuDaily(page);
  step('next day: "#3 is ready" with the "!" again', m.sub === '#3 is ready' && m.dot, JSON.stringify(m));
  await page.click('[data-action="daily"]');
  await page.waitForSelector('.ui-daily');
  c = await card(page);
  step('next day: Daily #3, its own first shapes and an open scored try', c.title === '#3' && c.scoredBtn && /^(15h 0m|14h 59m)$/.test(c.count), JSON.stringify(c));
  await page.click('.ui-daily [data-action="practice"]');
  await page.waitForFunction(() => window.__wobble.scene.started && window.__wobble.scene.sim?.stepIndex > 0, null, { timeout: 10000 });
  r = await run(page);
  step('next day: a different seed', r.seed !== seed2 && r.tag === 'DAILY #3 · PRACTICE', `${seed2} → ${r.seed}`);

  // A clock moved back never reopens a played seed (Q31).
  await setNow(page, DAY1);
  await page.reload();
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
  m = await menuDaily(page);
  step('clock moved back: #2 stays played', !m.dot && /^Done today/.test(m.sub ?? ''), JSON.stringify(m));
  await ctx.close();
}

// ---------------------------------------------------------------- locked below level 3

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.claude = { use: async () => null }; localStorage.setItem('shape-tower-profile-v1', JSON.stringify({ level: 2, xp: 0, total: 100, runs: 1, sliceRuns: 2 })); localStorage.setItem('shape-tower-played', '1'); });
  await page.goto(url);
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
  m = await menuDaily(page);
  await page.click('[data-action="daily"]', { force: true });
  await page.waitForTimeout(300);
  step('level 2: Daily locked ("Unlocks at level 3"), no "!", and a tap opens nothing', m.locked && m.sub === 'Unlocks at level 3' && !m.dot && !(await page.$('.ui-daily')), JSON.stringify(m));
  await ctx.close();
}

step('no page errors or missing files', errors.length === 0 && missing.length === 0, [...missing.map(u => `missing: ${u}`), ...errors].slice(0, 3).join(' / '));
writeFileSync(`${out}/report.json`, JSON.stringify({ steps, errors }, null, 2));
await browser.close();
server.close();
const failed = steps.filter(s => !s.ok).length;
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
