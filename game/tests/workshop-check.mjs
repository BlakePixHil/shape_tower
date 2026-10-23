// The Workshop and the ads between runs in the built game, headless (monetisation plan v2): the
// Workshop opens from the menu and is the only place with prices or buy buttons; the test store asks
// first ("nothing is charged") and a cancel buys nothing; Second Wind, always ready has it waiting at the
// start of an Endless run (without spending the day's free one) but never in a scored Daily try; a
// bought portrait turns up owned in the portrait picker; Settings (from the menu only) says whether ads
// are on and restores or clears purchases. Then, with a pretend ad network standing in for AdMob:
// no ad during a run, on pause or on the summary, one when the player taps on after 6 minutes of run
// time, paused time not counted, none below level 3, at most one per run end, and none after Remove Ads.
// The web build's own network never shows any.
//   npm run build:game && node tests/workshop-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/workshop';
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
  if (!sessionStorage.getItem('seeded')) {
    sessionStorage.setItem('seeded', '1');
    // A level 5 player who has played before: today's Daily Boost and free Second Wind are still unused.
    const day = new Date(Date.now() - 864e5);
    const yesterday = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    localStorage.setItem('shape-tower-profile-v1', JSON.stringify({
      level: 5, xp: 10, total: 3000, runs: 20, streak: 1, lastDay: yesterday, boostDay: yesterday, windDay: yesterday, sliceRuns: 20, player: 'p-workshop-check',
      seenGusts: true, seenHazards: ['crosswind', 'junk', 'meteor', 'dust', 'sway'], seenBrittle: true, askedGhost: true,
      stats: { bestHeight: 20, bestBiome: 2, bricks: 300, perfects: 10, rows: 5, checkpoints: 6, clutches: 1 },
    }));
    localStorage.setItem('shape-tower-played', '1');
  }
});
await page.goto(url);
await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
await page.waitForTimeout(1200);
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const shot = name => page.screenshot({ path: `${out}/${name}.png` });
/** Prices and buy buttons anywhere outside the Workshop. */
const selling = () => page.evaluate(() => {
  const root = document.querySelector('.sc-root');
  const text = (root?.textContent ?? '') + (document.querySelector('.st-hud')?.textContent ?? '');
  return { buy: document.querySelectorAll('[data-action="buy"]').length, price: /\$\d|\d[.,]\d\d\s?€|£\d/.test(text) };
});
const screen = () => page.evaluate(() => window.__wobble.shell && document.querySelector('.sc-root')?.firstElementChild?.getAttribute('aria-label'));
const card = id => page.evaluate(i => {
  const b = document.querySelector(`.sc-root [data-id="${i}"]`);
  const c = b?.closest('[data-card], .ui-ws-card, article, li') ?? b?.parentElement;
  return { found: !!b, text: (c?.textContent ?? '').replace(/\s+/g, ' ').trim(), action: b?.getAttribute('data-action') ?? null, locked: b?.classList.contains('locked') ?? null };
}, id);
const shop = () => page.evaluate(() => { const s = window.__wobble.shop; return { owned: s.store.list(), ent: s.store.ent, kind: s.store.kind, ads: { ...s.adState }, check: s.adCheck() }; });

// ---------------------------------------------------------------- the menu and the Workshop

const menu = await selling();
step('the menu shows no prices and no buy buttons', !menu.buy && !menu.price, JSON.stringify(menu));
const wsBtn = await page.$('.sc-root.show [data-action="workshop"]');
step('the menu has a Workshop button', !!wsBtn);
await wsBtn?.click();
await page.waitForTimeout(600);
await shot('01-workshop');
const ws = await page.evaluate(() => {
  const root = document.querySelector('.sc-root');
  const ids = [...root.querySelectorAll('[data-action="buy"]')].map(b => b.getAttribute('data-id'));
  return { ids, text: root.textContent.replace(/\s+/g, ' ').trim(), restore: !!root.querySelector('[data-action="restore"]') };
});
step('the Workshop sells what has art today: Remove Ads, Second Wind always ready and the six shop portraits',
  ['remove_ads', 'second_wind_ready', 'portrait_bubblegum', 'portrait_checkers', 'portrait_retro', 'portrait_rainbow', 'portrait_lava_lamp', 'portrait_disco'].every(id => ws.ids.includes(id)), ws.ids.join(' '));
step('nothing else is for sale yet (no pass, Supporter Pack or sets without their rewards)', !ws.ids.some(id => /pass|supporter|set_/.test(id)), ws.ids.join(' '));
step('the plan\'s prices, in the Workshop only', /\$7\.99/.test(ws.text) && /\$1\.99/.test(ws.text) && /\$0\.99/.test(ws.text), ws.text.slice(0, 200));
step('the test store says nothing is charged', /nothing is charged/i.test(ws.text));
step('Restore purchases is in the Workshop', ws.restore);
step('nothing sells hearts, bricks, power-ups, XP or achievements', !/(\bhearts?\b|bricks?|power-ups?|\bXP\b|achievement)[^.]*\$\d/i.test(ws.text));

// The test store asks first, and a cancel buys nothing.
await page.click('.sc-root [data-action="buy"][data-id="second_wind_ready"]');
await page.waitForTimeout(400);
const sheet = await page.evaluate(() => {
  const c = document.querySelector('.sc-root [data-action="confirm"]'), x = document.querySelector('.sc-root [data-action="cancel"]');
  return { confirm: !!c, cancel: !!x, text: (c?.closest('[role="dialog"]') ?? c?.parentElement)?.textContent.replace(/\s+/g, ' ').trim() ?? '' };
});
await shot('02-test-sheet');
step('buying in the test store shows the "nothing is charged" sheet', sheet.confirm && sheet.cancel && /nothing is charged/i.test(sheet.text), sheet.text);
await page.click('.sc-root [data-action="cancel"]');
await page.waitForTimeout(300);
let st = await shop();
step('a cancel buys nothing', !st.owned.includes('second_wind_ready') && !st.ent.windAlways, JSON.stringify(st.owned));
await page.click('.sc-root [data-action="buy"][data-id="second_wind_ready"]');
await page.waitForSelector('.sc-root [data-action="confirm"]', { timeout: 3000 });
await page.click('.sc-root [data-action="confirm"]');
await page.waitForTimeout(600);
st = await shop();
const swCard = await card('second_wind_ready');
await shot('03-bought');
step('Buy (test) buys it: owned, and its card says so', st.owned.includes('second_wind_ready') && st.ent.windAlways && /owned|yours|ready at the start/i.test(swCard.text), `${JSON.stringify(st.owned)} ${swCard.text}`);
// A portrait too, for the picker below.
await page.click('.sc-root [data-action="buy"][data-id="portrait_disco"]');
await page.waitForSelector('.sc-root [data-action="confirm"]', { timeout: 3000 });
await page.click('.sc-root [data-action="confirm"]');
await page.waitForTimeout(500);
st = await shop();
step('a shop portrait can be bought on its own', st.owned.includes('portrait_disco') && st.ent.portraits.includes('disco'), JSON.stringify(st.ent.portraits));
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(400);

// ---------------------------------------------------------------- Second Wind, always ready

await page.click('.sc-root.show [data-action="play"]');
await page.waitForFunction(() => window.__wobble.scene.sim?.ctrl !== null && window.__wobble.scene.started, null, { timeout: 10000 });
await page.waitForTimeout(400);
const run = await page.evaluate(() => ({ wind: window.__wobble.scene.sim.secondWind, windDay: window.__wobble.profile.windDay, rec: window.__wobble.shell.record?.start?.secondWind ?? null }));
step('an Endless run starts with Second Wind ready', run.wind === 'ready', JSON.stringify(run));
const inRun = await selling();
step('no prices or buy buttons during a run', !inRun.buy && !inRun.price, JSON.stringify(inRun));
// Pause: nothing sold there, Settings from pause has no purchases rows, and paused time doesn't count.
await page.evaluate(() => { window.__wobble.shop.adState.runMs = 0; });
await page.evaluate(() => window.__wobble.hud.pauseBtn.click());
await page.waitForTimeout(300);
const paused = await selling();
step('no prices or buy buttons on the pause card', !paused.buy && !paused.price, JSON.stringify(paused));
await page.click('.sc-root [data-action="settings"]');
await page.waitForTimeout(300);
const pauseSettings = await page.evaluate(() => ({ shop: !!document.querySelector('.sc-root .sc-shop'), restore: !!document.querySelector('.sc-root [data-action="restore"]') }));
step('Settings opened from pause has no purchases rows', !pauseSettings.shop && !pauseSettings.restore, JSON.stringify(pauseSettings));
await page.waitForTimeout(2500);
const pausedMs = (await shop()).ads.runMs;
step('paused time doesn\'t count toward an ad', pausedMs === 0, String(pausedMs));
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(200);
await page.click('.sc-root [data-action="resume"]');
await page.waitForTimeout(3200);
const playedMs = (await shop()).ads.runMs;
step('playing time does count (level 3 and up)', playedMs >= 1500 && playedMs <= 5000, String(playedMs));
await page.evaluate(() => window.__wobble.hud.pauseBtn.click());
await page.waitForTimeout(200);
await page.click('.sc-root [data-action="quit"]');
await page.waitForSelector('.sc-root.show [data-action="again"]', { timeout: 20000 });
await page.waitForTimeout(800);
const windDay = await page.evaluate(() => window.__wobble.profile.windDay);
step('the upgrade doesn\'t spend the day\'s free Second Wind', windDay === run.windDay, `${windDay} vs ${run.windDay}`);
const summary = await selling();
step('no prices or buy buttons on the run summary', !summary.buy && !summary.price, JSON.stringify(summary));
await page.click('.sc-root [data-action="home"]');
await page.waitForTimeout(500);

// A scored Daily try: Second Wind stays off, upgrade or not.
await page.click('.sc-root.show [data-action="daily"]');
await page.waitForTimeout(600);
await page.click('.sc-root [data-action="scored"]');
await page.waitForTimeout(150);
await page.click('.sc-root [data-action="scored"]');
await page.waitForFunction(() => window.__wobble.scene.sim?.ctrl !== null && window.__wobble.scene.started, null, { timeout: 10000 });
const daily = await page.evaluate(() => window.__wobble.scene.sim.secondWind);
step('a scored Daily try has Second Wind off, even with the upgrade', daily === 'off', daily);
await page.evaluate(() => window.__wobble.hud.pauseBtn.click());
await page.waitForTimeout(200);
await page.click('.sc-root [data-action="quit"]');
await page.waitForSelector('.sc-root.show [data-action="home"]', { timeout: 20000 });
await page.waitForTimeout(500);
await page.click('.sc-root [data-action="home"]');
await page.waitForTimeout(500);

// ---------------------------------------------------------------- the portrait picker

const picker = await page.evaluate(async () => {
  // The Daily card's ladder tab has Join (or Edit); the profile may open the same card.
  const open = document.querySelector('.sc-root.show [data-action="daily"]');
  open?.click();
  await new Promise(r => setTimeout(r, 700));
  (document.querySelector('.sc-root [data-action="join"]') ?? document.querySelector('.sc-root [data-action="edit"]'))?.click();
  await new Promise(r => setTimeout(r, 700));
  const pick = id => document.querySelector(`.sc-root input[name="ui-pt"][value="${id}"]`);
  const disco = pick('disco'), rainbow = pick('rainbow');
  const label = el => el?.closest('label')?.textContent.replace(/\s+/g, ' ').trim() ?? null;
  return { found: !!disco, disco: disco ? !disco.disabled : null, rainbow: rainbow ? !rainbow.disabled : null, rainbowLabel: label(rainbow), text: document.querySelector('.sc-root')?.textContent ?? '' };
});
await shot('04-picker');
step('a bought portrait is owned in the picker; one not bought is still locked', picker.found && picker.disco === true && picker.rainbow === false, JSON.stringify({ ...picker, text: undefined }));
step('a locked shop portrait points at the Workshop, with no price', /Workshop/.test(picker.rainbowLabel ?? '') && !/Soon/.test(picker.rainbowLabel ?? '') && !/\$\d/.test(picker.text), String(picker.rainbowLabel));
await page.evaluate(() => document.querySelector('.sc-root [data-action="close"]')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.sc-root [data-action="close"]')?.click());
await page.waitForTimeout(400);

// ---------------------------------------------------------------- Settings

await page.click('.sc-root.show [data-action="settings"]');
await page.waitForTimeout(400);
const set1 = await page.evaluate(() => {
  const s = document.querySelector('.sc-root .sc-shop');
  return { found: !!s, text: s?.textContent.replace(/\s+/g, ' ').trim() ?? '', buy: document.querySelectorAll('.sc-root [data-action="buy"]').length, clear: !!s?.querySelector('[data-action="clearTest"]') };
});
await shot('05-settings');
step('Settings says this version has no ads, with Restore purchases and no buy button', set1.found && /None in this version/.test(set1.text) && /Restore purchases/.test(set1.text) && !set1.buy && !/\$\d/.test(set1.text), set1.text);
await page.click('.sc-root [data-action="restore"]');
await page.waitForTimeout(500);
const restored = await page.evaluate(() => document.querySelector('.sc-root .sc-shop-msg')?.textContent ?? '');
step('Restore purchases answers', /already here|Restored/.test(restored), restored);
step('the test store can clear its purchases', set1.clear);
await page.click('.sc-root [data-action="clearTest"]');
await page.waitForTimeout(300);
st = await shop();
step('clearing test purchases takes them away', st.owned.length === 0 && !st.ent.windAlways, JSON.stringify(st.owned));
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(400);

// ---------------------------------------------------------------- ads, with a pretend network

step('the game page\'s own network never shows ads', await page.evaluate(() => window.__wobble.shop.ads.live === false));
await page.evaluate(() => {
  window.__ads = { shows: [], prepares: 0 };
  window.__wobble.shop.useAds({
    live: true,
    prepare() { window.__ads.prepares++; },
    consent: async () => true,
    async show() {
      const w = window.__wobble;
      window.__ads.shows.push({ screen: document.querySelector('.sc-root')?.firstElementChild?.getAttribute('aria-label') ?? '', playing: w.scene.sim?.state === 'playing' && w.scene.started, at: Date.now() });
      return true;
    },
  });
});
/** Plays a run for `ms`, quits it, and returns once the summary shows (the tally still going). */
async function runAndQuit(ms) {
  await page.click('.sc-root.show [data-action="play"]');
  await page.waitForFunction(() => window.__wobble.scene.sim?.ctrl !== null && window.__wobble.scene.started, null, { timeout: 10000 });
  await page.waitForTimeout(ms);
  await page.evaluate(() => window.__wobble.hud.pauseBtn.click());
  await page.waitForTimeout(200);
  await page.click('.sc-root [data-action="quit"]');
  await page.waitForSelector('.sc-root.show [data-action="again"]', { timeout: 20000 });
}
await page.evaluate(() => { window.__wobble.shop.adState.runMs = 5.9 * 60_000; });
await runAndQuit(1500);
let a = await page.evaluate(() => ({ shows: window.__ads.shows.length, prepares: window.__ads.prepares, check: window.__wobble.shop.adCheck() }));
step('6 minutes of run time crossed in this run: due, loading behind the summary, nothing shown yet', a.check === 'due' && a.prepares >= 1 && a.shows === 0, JSON.stringify(a));
await page.waitForTimeout(2500);
a = await page.evaluate(() => ({ shows: window.__ads.shows.length }));
step('no ad while the summary and its tally are up', a.shows === 0, JSON.stringify(a));
await page.click('.sc-root [data-action="home"]');
await page.waitForTimeout(600);
a = await page.evaluate(() => ({ shows: window.__ads.shows, today: window.__wobble.shop.adState.today, runMs: window.__wobble.shop.adState.runMs, menu: !!document.querySelector('.sc-root.show [data-action="play"]') }));
step('tapping on from the summary shows one ad, then goes on', a.shows.length === 1 && !a.shows[0].playing && a.today === 1 && a.runMs < 60_000 && a.menu, JSON.stringify(a));
await runAndQuit(1200);
await page.click('.sc-root [data-action="again"]');
await page.waitForTimeout(800);
a = await page.evaluate(() => ({ shows: window.__ads.shows.length, playing: window.__wobble.scene.sim?.state === 'playing' }));
step('a short run right after: no ad, straight into the next run', a.shows === 1 && a.playing, JSON.stringify(a));
// Below level 3: none, however long the play.
await page.evaluate(() => { const w = window.__wobble; w.profile.level = 2; w.shop.adState.runMs = 30 * 60_000; });
await page.evaluate(() => window.__wobble.hud.pauseBtn.click());
await page.waitForTimeout(200);
await page.click('.sc-root [data-action="quit"]');
await page.waitForSelector('.sc-root.show [data-action="again"]', { timeout: 20000 });
await page.evaluate(() => { window.__wobble.profile.level = 2; });
await page.click('.sc-root [data-action="home"]');
await page.waitForTimeout(500);
a = await page.evaluate(() => ({ shows: window.__ads.shows.length }));
step('no ads below level 3', a.shows === 1, JSON.stringify(a));
// Remove Ads: none ever after.
await page.evaluate(() => { const w = window.__wobble; w.profile.level = 6; w.shop.adState.runMs = 30 * 60_000; });
await page.click('.sc-root.show [data-action="workshop"]');
await page.waitForTimeout(500);
await page.click('.sc-root [data-action="buy"][data-id="remove_ads"]');
await page.waitForSelector('.sc-root [data-action="confirm"]', { timeout: 3000 });
await page.click('.sc-root [data-action="confirm"]');
await page.waitForTimeout(400);
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(400);
await runAndQuit(1000);
await page.click('.sc-root [data-action="home"]');
await page.waitForTimeout(500);
a = await page.evaluate(() => ({ shows: window.__ads.shows.length, check: window.__wobble.shop.adCheck() }));
step('after Remove Ads: no ad, however long the play', a.shows === 1 && a.check === 'noads', JSON.stringify(a));
const set2 = await page.evaluate(async () => {
  document.querySelector('.sc-root.show [data-action="settings"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  return document.querySelector('.sc-root .sc-shop')?.textContent.replace(/\s+/g, ' ').trim() ?? '';
});
step('Settings then says ads are off, with no Remove ads line', /Off for good/.test(set2) && !/Remove ads in the Workshop/.test(set2), set2);
await shot('06-settings-noads');

step('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = steps.filter(s => !s.ok).length;
console.log(failed ? `\n${failed} of ${steps.length} failed` : `\nall ${steps.length} passed`);
process.exit(failed ? 1 : 0);
