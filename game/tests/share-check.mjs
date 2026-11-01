// Sharing, the store's rating card and the play stats in the built game (launch marketing plan): the
// summary's share button hands the card (1080 × 1350) and the Wordle-style line to the share sheet, the
// rating card is asked for once after a new best (and that run end skips its ad), not after a Daily, and
// the stats reach the server (the API's handler on this machine, never the live one) and stop with the
// Settings switch. Without a share sheet the text is copied. The share sheet and the store are stand-ins.
//   npm run build:game && node tests/share-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/share';
mkdirSync(out, { recursive: true });
const html = readFileSync(new URL('../dist-game/game.html', import.meta.url));
const server = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/game.html')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/game.html`;

const API_PORT = 19787 + Math.floor(Math.random() * 1000);
const api = `http://127.0.0.1:${API_PORT}`;
const dev = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../../online/scripts/dev-server.ts', import.meta.url).pathname, String(API_PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, fail) => { dev.stdout.once('data', ok); dev.once('exit', () => fail(new Error('dev server died'))); });
process.on('exit', () => dev.kill());
process.on('uncaughtException', e => { console.error(e); process.exit(1); });
process.on('unhandledRejection', e => { console.error(e); process.exit(1); });
const batches = () => fetch(`${api}/stats/batches`).then(r => r.json());
const summary = () => fetch(`${api}/stats`).then(r => r.json());

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info && !ok ? '  — ' + info : ''}`); };
const errors = [];

const PROFILE = {
  level: 6, xp: 40, total: 4000, runs: 20, streak: 1, lastDay: '2026-10-21', boostDay: '2026-10-21', sliceRuns: 21, player: 'p-share-check', seenGusts: true, seenBrittle: true,
  stats: { bestHeight: 0.3, bestBiome: 1, bricks: 900, perfects: 40, rows: 10, checkpoints: 30, clutches: 2 },
};

async function open(init) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.addInitScript(([profile, apiUrl]) => {
    if (!localStorage.getItem('shape-tower-profile-v1')) {
      localStorage.setItem('shape-tower-profile-v1', JSON.stringify(profile));
      localStorage.setItem('shape-tower-played', '1');
      localStorage.setItem('shape-tower-best', '0.3');
      localStorage.setItem('shape-tower-ladder-api', apiUrl);
    }
  }, [PROFILE, api]);
  await page.addInitScript(init);
  await page.goto(url);
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
  // The store's rating card and a pretend ad network that's always due, to see which run ends skip the ad.
  await page.evaluate(() => {
    const m = window.__wobble.marketing;
    window.__asked = 0;
    m.reviewer.available = true;
    m.reviewer.ask = async () => { window.__asked++; };
    window.__ads = 0;
    const sh = window.__wobble.shop;
    sh.useAds({ live: true, consent: async () => {}, prepare() {}, show: async () => { window.__ads++; return true; } });
    sh.adState.runMs = 10 * 60_000; // past the 6 minutes, so the next run end's ad is due
  });
  return { ctx, page };
}

/** Plays a few shapes, then lets the run run out of shapes and waits for the settled summary. */
async function playOut(page) {
  await page.waitForFunction(() => window.__wobble.scene.started && window.__wobble.scene.sim?.ctrl, null, { timeout: 15000 });
  for (let i = 0; i < 4; i++) {
    await page.evaluate(k => { const sim = window.__wobble.scene.sim; if (sim.ctrl) { sim.intent({ type: 'moveTo', x: sim.foundation.x - 1 + (k % 3) }); sim.intent({ type: 'hardDrop' }); } }, i);
    await page.waitForTimeout(900);
  }
  // A drop can reach the checkpoint line (the Daily's shapes are the same all day, so on some days they
  // do), and a claim resets the shapes used to 0, so the run would never end. Moving the line out of reach
  // first, as budget-check does, cancels any hold before the budget is spent.
  await page.evaluate(() => { const sim = window.__wobble.scene.sim; sim.tuning.infiniteHearts = true; sim.lineY += 40; sim.used = sim.budget; });
  await page.waitForSelector('.sc-root.show .ui-summary', { timeout: 60000 });
  await page.waitForTimeout(3500); // the XP tally
  if (await page.$('.sc-root [data-action="continue"]')) { await page.click('.sc-root [data-action="continue"]'); await page.waitForTimeout(300); }
  await page.waitForTimeout(1200); // the rating card's short wait
}

// ---------------------------------------------------------------- Endless with a new best

const shareStub = () => {
  window.__shared = [];
  navigator.canShare = () => true;
  navigator.share = async d => {
    const files = await Promise.all((d.files ?? []).map(async f => {
      const bmp = await createImageBitmap(f);
      const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      return { name: f.name, type: f.type, size: f.size, w: bmp.width, h: bmp.height, url };
    }));
    window.__shared.push({ text: d.text, files });
  };
};
const { ctx, page } = await open(shareStub);
const shot = name => page.screenshot({ path: `${out}/${name}.png` });
const first = await batches();
step('the game opening sends a session (an old player: no first_open), with the build and a stats id that isn\'t the ladder id',
  first.length >= 1 && first[0].events.some(e => e.e === 'session' && e.lv === 6) && !first.flatMap(b => b.events).some(e => e.e === 'first_open') && /^[0-9a-f]{24}$/.test(first[0].id), JSON.stringify(first));

await page.click('[data-action="play"]');
await playOut(page);
await shot('01-summary');
const s1 = await page.evaluate(() => ({
  share: !!document.querySelector('.ui-summary [data-action="share"]'), best: !!document.querySelector('.ui-best'), cause: window.__wobble.scene.sim.cause, asked: window.__asked,
  queued: window.__wobble.marketing.stats.queued.map(e => e.e),
}));
step('a run out of shapes with a new best: the summary has the share button', s1.share && s1.best && s1.cause === 'bricks', JSON.stringify(s1));
step('the rating card is asked for once the tally is done', s1.asked === 1, JSON.stringify(s1));

await page.$eval('.ui-summary [data-action="share"]', b => b.scrollIntoView({ block: 'center' }));
await shot('01b-share-button');
await page.click('.ui-summary [data-action="share"]');
await page.waitForFunction(() => window.__shared.length > 0, null, { timeout: 15000 });
const shared = await page.evaluate(() => window.__shared[0]);
if (shared.files[0]?.url) writeFileSync(`${out}/05-card.png`, Buffer.from(shared.files[0].url.split(',')[1], 'base64'));
writeFileSync(`${out}/shared.json`, JSON.stringify({ ...shared, files: shared.files.map(({ url: _, ...f }) => f) }, null, 1));
step('share: the card is a 1080 × 1350 PNG', shared.files.length === 1 && shared.files[0].type === 'image/png' && shared.files[0].w === 1080 && shared.files[0].h === 1350 && shared.files[0].size > 50_000, JSON.stringify(shared.files.map(f => f.size)));
const lines = shared.text.split('\n');
step('share: "Shape Tower: <m> m, <n> checkpoints (new best!)", then the link with the height to beat', /^Shape Tower: \d+\.\d m, \d+ checkpoints? \(new best!\)$/.test(lines[0]) && /^https:\/\/shape-tower\.shape-tower\.workers\.dev\/\?h=\d+\.\d$/.test(lines.at(-1)), shared.text);
await page.click('.ui-summary [data-action="home"]');
await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 15000 });
const ads1 = await page.evaluate(() => window.__ads);
step('no ad straight after the rating card (it stays due)', ads1 === 0, String(ads1));

await page.evaluate(() => window.__wobble.marketing.stats.flush());
await page.waitForTimeout(500);
const ev = (await batches()).flatMap(b => b.events);
const runEnd = ev.find(e => e.e === 'run_end');
step('stats: the run end (Endless, level, checkpoints, height), the share and the rating ask reach the server',
  runEnd?.m === 'endless' && runEnd.lv === 6 && runEnd.h > 0.3 && ev.some(e => e.e === 'share' && e.m === 'endless' && e.ok === 1) && ev.some(e => e.e === 'review'), JSON.stringify(ev));

// ---------------------------------------------------------------- the Daily's scored try

await page.click('[data-action="daily"]');
await page.waitForSelector('.ui-daily');
await page.click('.ui-daily [data-action="scored"]');
await page.click('.ui-daily [data-action="scored"]', { force: true });
await playOut(page);
await shot('02-daily-summary');
const s2 = await page.evaluate(() => ({ asked: window.__asked, share: !!document.querySelector('.ui-summary [data-action="share"]') }));
step('a Daily result: share button, and no second rating ask within 60 days', s2.share && s2.asked === 1, JSON.stringify(s2));
await page.click('.ui-summary [data-action="share"]');
await page.waitForFunction(() => window.__shared.length > 1, null, { timeout: 15000 });
const dtext = await page.evaluate(() => window.__shared[1].text);
const n = Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse('2026-10-21')) / 86_400_000) + 1;
step('share: "Shape Tower Daily #N: <m> m, <n> checkpoints", squares if any, then the Daily\'s own link', new RegExp(`^Shape Tower Daily #${n}: \\d+\\.\\d m, \\d+ checkpoints?\\n`).test(dtext) && new RegExp(`/d/${n}\\?h=\\d+\\.\\d$`).test(dtext), dtext);
await page.click('.ui-summary [data-action="home"]');
await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 15000 });
const ads2 = await page.evaluate(() => window.__ads);
step('that run end has its ad as usual (no rating card was asked)', ads2 === 1, String(ads2));
await page.evaluate(() => window.__wobble.marketing.stats.flush());
await page.waitForTimeout(500);
const sum = await summary();
const today = sum.days.at(-1).counts;
step('stats summary: an Endless run and a scored Daily, both shared, one rating ask, one active device',
  today['runs:endless'] === 1 && today['runs:daily'] === 1 && today['shared:daily'] === 1 && today['shared:endless'] === 1 && today.reviews === 1 && today.active === 1 && sum.dailyShareRate === 1, JSON.stringify(today));

// ---------------------------------------------------------------- Settings: the switch

await page.click('[data-action="settings"]');
await page.waitForSelector('.ui-settings');
await shot('03-settings');
const sw = await page.evaluate(() => {
  const i = document.querySelector('.ui-settings input[data-key="stats"]');
  return { there: !!i, on: i?.checked, label: i?.closest('.ui-set')?.textContent?.trim() };
});
step('Settings has "Send anonymous play stats", on', sw.there && sw.on && sw.label === 'Send anonymous play stats', JSON.stringify(sw));
await page.click('.ui-settings input[data-key="stats"]', { force: true });
await page.waitForTimeout(600);
const off = await page.evaluate(() => ({ saved: JSON.parse(localStorage.getItem('shape-tower-settings-v1')).stats, queued: window.__wobble.marketing.stats.queued.length, active: window.__wobble.marketing.stats.active }));
const afterOff = await summary();
step('switched off: saved, nothing waiting, and the server forgot this device', off.saved === false && off.queued === 0 && !off.active && afterOff.devices.total === 0 && afterOff.days.at(-1).counts.forgets === 1, JSON.stringify({ off, devices: afterOff.devices }));
await page.click('.ui-settings [data-action="close"]');
const before = (await batches()).length;
await page.click('[data-action="play"]');
await playOut(page);
await page.evaluate(() => window.__wobble.marketing.stats.flush());
await page.waitForTimeout(500);
step('and nothing more is sent', (await batches()).length === before);
await ctx.close();

// ---------------------------------------------------------------- no share sheet: copy the text

const noShare = await open(() => {
  delete Navigator.prototype.share;
  delete Navigator.prototype.canShare;
  window.__copied = null;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async t => { window.__copied = t; } } });
});
await noShare.page.click('[data-action="play"]');
await playOut(noShare.page);
await noShare.page.click('.ui-summary [data-action="share"]');
await noShare.page.waitForFunction(() => window.__copied !== null, null, { timeout: 15000 });
await noShare.page.waitForTimeout(200);
const copied = await noShare.page.evaluate(() => ({ text: window.__copied, note: document.querySelector('.sc-share-note')?.textContent }));
await noShare.page.screenshot({ path: `${out}/04-copied.png` });
step('without a share sheet the text line is copied, and the summary says so', /^Shape Tower: /.test(copied.text ?? '') && copied.note === 'Copied! Paste it to a friend.', JSON.stringify(copied));
await noShare.ctx.close();

step('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close();
server.close();
writeFileSync(`${out}/steps.json`, JSON.stringify(steps, null, 1));
const failed = steps.filter(s => !s.ok).length;
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
