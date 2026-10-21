// Second Wind in the real HUD (qa-section.md F18.11 and F18.12, gameplay.md §13.3 and the monetisation plan's
// "Second chance"): drives a built game in headless Chromium and checks the two-tap arming, the
// glow, that no pop-up offers it at pause or game over, the greyed "CP 2" state, and the day's
// free one (profile.windDay, spent on the first landing).
// Usage: node scripts/ui-second-wind.mjs [game/dist/index.html]   (after `npm run build` in game/)
// Playwright comes from game/node_modules; Chromium from PLAYWRIGHT_BROWSERS_PATH.
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const html = readFileSync(resolve(process.argv[2] ?? `${root}/game/dist/index.html`));
const { chromium } = createRequire(`${root}/game/`)('playwright');
const server = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/index.html')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); }
  else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`); };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// The container's Chromium when Playwright's own build for this version isn't installed.
const executablePath = process.env.CHROMIUM || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({ executablePath, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`HTTP ${r.status()} ${r.url()}`); });

const st = () => page.evaluate(() => {
  const w = window.__wobble;
  const s = w?.scene?.sim;
  const b = document.querySelector('.st-wind');
  const cs = b ? getComputedStyle(b) : null;
  const icon = b?.querySelector('.st-icon');
  const ics = icon ? getComputedStyle(icon) : null;
  const overlay = document.querySelector('.st-panel');
  let prof = {};
  try { prof = JSON.parse(localStorage.getItem('shape-tower-profile-v1') || '{}'); } catch {}
  return {
    wind: s?.secondWind, state: s?.state, cause: s?.cause, hearts: s?.hearts, used: s?.used, budget: s?.budget, placed: s?.stats.placed, windStat: s?.stats.secondWind,
    cls: b?.className ?? '', tag: b?.querySelector('.st-tag')?.textContent ?? '', opacity: cs?.opacity, iconOpacity: ics?.opacity, iconFilter: ics?.filter, border: cs?.borderStyle, pe: cs?.pointerEvents, display: cs?.display,
    card: overlay?.innerText ?? '', cardOpen: w?.hud?.cardOpen ?? false, cardButtons: [...(overlay?.querySelectorAll('button') ?? [])].map((x) => x.textContent),
    windDay: prof.windDay, step: s?.stepIndex,
  };
});
const waitFor = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await st(); if (fn(s)) return s; await page.waitForTimeout(100); } return st(); };
const play = async () => { await page.locator('.st-panel button', { hasText: 'Play' }).click(); return waitFor((s) => s.state === 'playing' && !s.cardOpen); };
const setProfile = (p) => page.evaluate((p) => localStorage.setItem('shape-tower-profile-v1', JSON.stringify(p)), p);
const tapWind = () => page.locator('.st-wind').click({ force: true });
// Hard-drops the next shape in hand and waits for it to land (headless frames are slow, so this
// waits on the sim, not the clock).
const mess = async () => {
  await page.waitForFunction(() => !!window.__wobble.scene.sim.ctrl, null, { timeout: 60000 });
  const n = (await st()).placed;
  await page.evaluate(() => window.__wobble.scene.sim.intent({ type: 'hardDrop' }));
  await page.waitForFunction((n) => window.__wobble.scene.sim.stats.placed > n, n, { timeout: 60000 });
};
// The HUD redraws on the next frame.
const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

// 1. Fresh profile: the day's first run starts with Second Wind ready, and it isn't spent until a shape lands.
await page.goto(url);
await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.st-panel button');
let s = await play();
check('fresh profile: the first run of the day starts with Second Wind ready', s.wind === 'ready' && !/earn|hide/.test(s.cls) && s.tag === '2ND WIND', `${s.wind}, "${s.cls}", tag ${s.tag}`);
check('the free one is not spent before a shape lands', !s.windDay, `windDay "${s.windDay}" at ${s.placed} placed`);
await mess();
s = await st();
check('the free one is spent (windDay = today) on the first landing', s.windDay === today(), `windDay "${s.windDay}" after ${s.placed} placed`);
check('spending the free one does not use up this run\'s Second Wind', s.wind === 'ready', s.wind);

// 2. One tap arms it, and it disarms after 2.5 s without being used.
for (let i = 0; i < 3; i++) await mess();
await tapWind();
await frame();
s = await st();
check('one tap arms Second Wind ("TAP AGAIN") and uses nothing', /armed/.test(s.cls) && s.tag === 'TAP AGAIN' && s.wind === 'ready', `"${s.cls}", tag ${s.tag}, ${s.wind}`);
// Headless frames are slow, so the window is timed in the page: taps at set times after the first.
const tapsApart = (ms) => page.evaluate((ms) => new Promise((r) => {
  const b = document.querySelector('.st-wind');
  b.click();
  setTimeout(() => { b.click(); r(window.__wobble.scene.sim.secondWind); }, ms);
}), ms);
await page.waitForFunction(() => performance.now() > window.__wobble.hud.windArmedUntil, null, { timeout: 5000 });
await frame();
s = await st();
check('disarmed after 2.5 s and still ready', !/armed/.test(s.cls) && s.tag === '2ND WIND' && s.wind === 'ready', `"${s.cls}", tag ${s.tag}, ${s.wind}`);
const window_ = await page.evaluate(() => { document.querySelector('.st-wind').click(); return window.__wobble.hud.windArmedUntil - performance.now(); });
check('the arming window is 2.5 s', window_ > 2450 && window_ <= 2500, `${Math.round(window_)} ms left just after the tap`);
await page.waitForFunction(() => performance.now() > window.__wobble.hud.windArmedUntil, null, { timeout: 5000 });
await frame();
const late = await tapsApart(2700);
await frame();
s = await st();
check('two taps 2.7 s apart do not use it (the second one arms it again)', late === 'ready' && s.wind === 'ready' && /armed/.test(s.cls), `${s.wind}, "${s.cls}"`);
await page.waitForFunction(() => performance.now() > window.__wobble.hud.windArmedUntil, null, { timeout: 5000 });
await frame();

// 3. The glow: last heart, or 3 or fewer bricks left, while ready.
const setSim = (patch) => page.evaluate((p) => Object.assign(window.__wobble.scene.sim, p), patch);
await setSim({ hearts: 3, used: 0 });
await frame();
s = await st();
check('no glow with 3 hearts and a full budget', !/glow/.test(s.cls), `"${s.cls}"`);
await setSim({ hearts: 1 });
await frame();
s = await st();
check('glows on the last heart', /glow/.test(s.cls), `"${s.cls}"`);
await setSim({ hearts: 3, used: s.budget - 3 });
await frame();
s = await st();
check('glows at 3 bricks left', /glow/.test(s.cls), `"${s.cls}", ${s.budget - s.used} left`);
await setSim({ used: s.budget - 4 });
await frame();
s = await st();
check('no glow at 4 bricks left', !/glow/.test(s.cls), `"${s.cls}", ${s.budget - s.used} left`);
await setSim({ hearts: 1 });
await frame();
await tapWind();
await frame();
s = await st();
check('the glow stops while armed (the pulse takes over)', /armed/.test(s.cls) && !/glow/.test(s.cls), `"${s.cls}"`);

// 4. Second tap within 2.5 s uses it: sweep, hearts and bricks back to full, then the button goes.
await page.waitForFunction(() => performance.now() > window.__wobble.hud.windArmedUntil, null, { timeout: 5000 });
await frame();
const inTime = await tapsApart(2300);
await frame();
s = await st();
check('two taps 2.3 s apart use Second Wind', inTime === 'used' && s.windStat === true, `${inTime}`);
check('hearts and bricks back to full', s.hearts === 3 && s.used === 0, `hearts ${s.hearts}, used ${s.used}`);
await page.waitForTimeout(700);
s = await st();
check('the button is hidden once used', /hide/.test(s.cls) && s.display === 'none', `"${s.cls}", display ${s.display}`);
await tapWind().catch(() => {});
s = await st();
check('no second use in the same run', s.wind === 'used', s.wind);

// 5. Pause: no Second Wind pop-up.
await page.keyboard.press('p');
s = await waitFor((x) => x.cardOpen, 2000);
check('pause card has no Second Wind offer', s.cardOpen && !/wind/i.test(s.card) && s.cardButtons.join() === 'Resume,End run', `card "${s.card.replace(/\s+/g, ' ')}", buttons ${s.cardButtons.join('/')}`);
await page.locator('.st-panel button', { hasText: 'End run' }).click();
s = await waitFor((x) => x.state === 'over' && x.cardOpen, 8000);
check('game over card has no Second Wind offer', s.cardOpen && !/wind|second chance|continue/i.test(s.card), `buttons ${s.cardButtons.join('/')}`);

// 6. Next run the same day: greyed until checkpoint 2, and taps do nothing.
const again = s.cardButtons.find((b) => /again|play/i.test(b ?? ''));
await page.locator('.st-panel button', { hasText: again }).click();
s = await waitFor((x) => x.state === 'playing' && !x.cardOpen && x.step > 0, 5000);
check('the next run the same day starts with Second Wind to earn', s.wind === 'earn', s.wind);
// Art's look for it: a dashed empty-slot style with the icon greyed out (art/src/powers.ts).
check('the button is greyed (dashed, grey icon) with a "CP 2" tag and ignores taps', /earn/.test(s.cls) && s.tag === 'CP 2' && Number(s.iconOpacity) < 0.7 && /grayscale/.test(s.iconFilter) && s.border === 'dashed' && s.pe === 'none', `"${s.cls}", tag ${s.tag}, icon opacity ${s.iconOpacity}, ${s.iconFilter}, border ${s.border}, pointer-events ${s.pe}`);
await tapWind().catch(() => {});
await frame();
await tapWind().catch(() => {});
s = await st();
check('tapping the greyed button twice does nothing', s.wind === 'earn' && !s.windStat, s.wind);
await setSim({ hearts: 1 });
await frame();
s = await st();
check('the greyed button does not glow on the last heart', !/glow/.test(s.cls), `"${s.cls}"`);

// 7. A reload the same day keeps the free one spent.
await page.reload();
await page.waitForSelector('.st-panel button');
s = await play();
check('after a reload the same day, Second Wind is still to earn', s.wind === 'earn', s.wind);

// 8. The next day: ready again, and a run that ends before any landing doesn't spend it.
const prof = await page.evaluate(() => JSON.parse(localStorage.getItem('shape-tower-profile-v1')));
await setProfile({ ...prof, windDay: '2026-10-20' });
await page.reload();
await page.waitForSelector('.st-panel button');
s = await play();
check('a new day gives a free Second Wind again', s.wind === 'ready', s.wind);
await page.keyboard.press('p');
await waitFor((x) => x.cardOpen, 2000);
await page.locator('.st-panel button', { hasText: 'End run' }).click();
s = await waitFor((x) => x.state === 'over' && x.cardOpen, 8000);
check('quitting before any shape lands leaves the free one unspent', s.windDay === '2026-10-20' && s.placed === 0, `windDay ${s.windDay}, ${s.placed} placed`);
await page.locator('.st-panel button', { hasText: again }).click();
s = await waitFor((x) => x.state === 'playing' && !x.cardOpen, 5000);
check('so the next run still starts with it ready', s.wind === 'ready', s.wind);

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
server.close();
const bad = results.filter((r) => !r.ok).length;
console.log(`${results.length - bad} of ${results.length} checks pass`);
process.exitCode = bad ? 1 : 0;
