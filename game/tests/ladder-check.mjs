// The Daily ladder in the built game (gameplay.md §12.3): today's ladder in the Daily card, joining with
// a name (the filter's hints, a taken name), portraits, the scored try reaching the ladder and the
// player's own row, the Profile's name and portrait being the ladder's (§10.3), reporting a name,
// deleting a name and scores from Settings, the ladder offline, and the game page's own ladder on a
// stand-in page database. The app's ladder runs against the API's
// handler on this machine (online/scripts/dev-server.ts), never the live one.
//   npm run build:game && node tests/ladder-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/ladder';
mkdirSync(out, { recursive: true });
const html = readFileSync(new URL('../dist-game/game.html', import.meta.url));
const missing = [];
const server = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/game.html')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
  if (req.url !== '/favicon.ico') missing.push(req.url);
  res.writeHead(req.url === '/favicon.ico' ? 204 : 404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/game.html`;

// The API on this machine, in memory.
const API_PORT = 18787 + Math.floor(Math.random() * 1000);
const api = `http://127.0.0.1:${API_PORT}`;
const dev = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', new URL('../../online/scripts/dev-server.ts', import.meta.url).pathname, String(API_PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((ok, fail) => { dev.stdout.once('data', ok); dev.once('exit', () => fail(new Error('dev server died'))); });
// The server goes when the check does, however it ends.
process.on('exit', () => dev.kill());
process.on('uncaughtException', e => { console.error(e); process.exit(1); });
process.on('unhandledRejection', e => { console.error(e); process.exit(1); });
const post = body => fetch(api, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const errors = [];

// Twelve other players climbed today already (real time: the server checks the clock).
const today = new Date().toISOString().slice(0, 10);
const key = n => n.toString(16).padStart(2, '0').repeat(32);
const others = ['Tower Tess', 'Plank Pete', 'Wobbly Wen', 'Brick Queen', 'Sir Stacksalot', 'Domino Dan', 'Gusty', 'Ava', 'Hat Trick Hal', 'Lou', 'Mo Stacks', 'Nell'];
for (let i = 0; i < others.length; i++) {
  await post({ op: 'name', key: key(i + 1), name: others[i], look: { portrait: ['golden_crown', 'disco', 'moonwalk', 'sunset'][i % 4], avatar: { shape: 'TLOSJZI'[i % 7], face: 'idle', hat: null } } });
  const r = await post({ op: 'submit', key: key(i + 1), sub: { day: today, height: 150 - i * 11.5, score: 40000 - i * 2000, checkpoints: 10 - Math.floor(i / 2), finished: i !== 1, startedAt: Date.now() - 900_000 } });
  if (!r.ok) throw new Error(`seeding ${others[i]}: ${JSON.stringify(r)}`);
}

const PROFILE = {
  level: 6, xp: 40, total: 4000, runs: 20, streak: 1, lastDay: '2026-10-21', boostDay: '2026-10-21', sliceRuns: 21, player: 'p-ladder-check', seenGusts: true,
  stats: { bestHeight: 41.5, bestBiome: 3, bricks: 900, perfects: 40, rows: 10, checkpoints: 30, clutches: 2 },
};

async function open(viewport, init) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|net::ERR|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.addInitScript(([profile, apiUrl]) => {
    if (!localStorage.getItem('shape-tower-profile-v1')) {
      localStorage.setItem('shape-tower-profile-v1', JSON.stringify(profile));
      localStorage.setItem('shape-tower-played', '1');
      if (apiUrl) localStorage.setItem('shape-tower-ladder-api', apiUrl);
    }
  }, [PROFILE, init?.api ?? null]);
  if (init?.script) await page.addInitScript(init.script);
  await page.goto(url);
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
  return { ctx, page };
}

const ladder = page => page.evaluate(() => {
  const c = document.querySelector('.ui-daily');
  const l = c?.querySelector('.ui-ld');
  if (!l) return null;
  const rows = [...l.querySelectorAll('.ui-ld-row')].map(r => ({
    rank: Number(r.querySelector('.ui-ld-rank')?.textContent), name: r.querySelector('.ui-ld-name')?.childNodes[0]?.textContent?.trim(), height: parseFloat(r.querySelector('b')?.textContent ?? ''),
    me: r.classList.contains('me'), pinned: r.classList.contains('pinned'), flag: !!r.querySelector('button.ui-ld-flag'), portrait: r.querySelector('.ui-portrait')?.dataset.portrait,
  }));
  const you = l.querySelector('.ui-ld-you');
  return {
    head: l.querySelector('.ui-ld-head')?.textContent?.replace(/\s+/g, ' ').trim(), msg: l.querySelector('.ui-ld-msg')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    rows, join: !!you?.classList.contains('join'), you: you?.querySelector('b')?.textContent ?? null, youPortrait: you?.querySelector('.ui-portrait')?.dataset.portrait ?? null,
    note: l.querySelector('.ui-ld-note')?.textContent ?? null, tab: c.querySelector('.ui-dl-tab.on')?.dataset.tab,
    shapes: [...c.querySelectorAll('.ui-dl-set img')].map(i => i.dataset.shape), only: c.querySelector('.ui-dl-sethead .ui-chip')?.textContent,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    // Layout sizes: the card may still be popping in (scaled).
    small: [...c.querySelectorAll('button')].filter(b => b.offsetParent).map(b => ({ b: `${b.dataset.action ?? b.className}`, w: b.offsetWidth, h: b.offsetHeight })).filter(x => x.w < 44 || x.h < 44),
  };
});
const openDaily = async page => {
  await page.click('[data-action="daily"]');
  await page.waitForSelector('.ui-daily .ui-ld');
  await page.waitForFunction(() => !document.querySelector('.ui-daily .ui-ld-msg.loading'), null, { timeout: 15000 });
  await page.waitForTimeout(300);
};
const nameCardState = page => page.evaluate(() => {
  const c = document.querySelector('.ui-namecard');
  if (!c) return null;
  const picks = [...c.querySelectorAll('.ui-pt-pick')].map(p => ({
    id: p.querySelector('input').value, locked: p.querySelector('input').disabled, label: p.querySelector('small')?.textContent, workshop: p.dataset.action === 'workshop' && p.dataset.id === p.querySelector('input').value,
  }));
  return {
    title: c.querySelector('.ui-h1')?.textContent, hint: c.querySelector('.ui-nc-hint')?.textContent?.trim(), bad: c.querySelector('.ui-nc-hint')?.classList.contains('bad'),
    saveLocked: c.querySelector('[data-action="save"]')?.classList.contains('locked'), picks, rule: c.querySelector('.ui-nc-rule')?.textContent, value: c.querySelector('.ui-nc-input')?.value,
    priced: /\$|price|buy/i.test(c.textContent ?? ''), forget: !!c.querySelector('[data-action="forget"]'),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
  };
});
const profileState = page => page.evaluate(() => {
  const c = document.querySelector('.ui-profile');
  if (!c) return null;
  return {
    name: c.querySelector('.ui-prof-id > b')?.textContent, edit: !!c.querySelector('.ui-prof-head [data-action="name"]'), pick: !!c.querySelector('.ui-prof-pick [data-action="name"]'),
    portrait: c.querySelector('.ui-prof-head .ui-portrait')?.dataset.portrait ?? null, note: c.querySelector('.ui-prof-note')?.textContent ?? null,
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    small: [...c.querySelectorAll('button')].filter(b => b.offsetParent).map(b => ({ b: b.dataset.action ?? b.className, w: b.offsetWidth, h: b.offsetHeight })).filter(x => x.w < 44 || x.h < 44),
  };
});
const openProfile = async page => { await page.click('.ui-menu [data-action="profile"]'); await page.waitForSelector('.ui-profile'); await page.waitForTimeout(300); };
const typeName = async (page, name) => { await page.fill('.ui-namecard input[type="text"]', name); await page.waitForTimeout(100); };
async function toSummary(page) {
  await page.evaluate(() => window.__wobble.scene.sim.quit());
  await page.waitForFunction(() => window.__wobble.scene.sim.state !== 'playing', null, { timeout: 10000 });
  for (let i = 0; i < 40 && !(await page.$('.sc-root.show .ui-summary')); i++) { await page.evaluate(() => window.__wobble.scene.skipPanorama?.()); await page.waitForTimeout(250); }
  await page.waitForSelector('.sc-root.show .ui-summary', { timeout: 20000 });
  await page.waitForTimeout(2500);
}

// ---------------------------------------------------------------- the app's ladder

{
  const { ctx, page } = await open({ width: 390, height: 844 }, { api });
  const shot = name => page.screenshot({ path: `${out}/${name}.png` });

  // The Profile before they have a name: Builder, and a strip to pick one (§10.3).
  await openProfile(page);
  let pr = await profileState(page);
  await shot('00-profile');
  step('the Profile without a name: Builder, a "Pick a name" strip, their Blockling in a portrait', pr.name === 'Builder' && pr.pick && !pr.edit && pr.portrait === 'meadow' && !pr.overflowX && !pr.small.length, JSON.stringify(pr));
  await page.click('.ui-profile .ui-prof-pick [data-action="name"]');
  await page.waitForSelector('.ui-namecard');
  let n = await nameCardState(page);
  step('"Pick a name" on the Profile opens the name card, which says it\'s the ladder\'s too', n.title === 'Pick a name' && /profile and on the Daily ladder/.test(n.rule), JSON.stringify({ title: n.title, rule: n.rule }));
  await page.click('.ui-namecard [data-action="close"]');
  await page.waitForSelector('.ui-profile');
  await page.click('.ui-profile [data-action="close"]');
  await page.waitForSelector('.sc-root.show [data-action="play"]');

  await openDaily(page);
  let l = await ladder(page);
  await shot('01-ladder');
  step('the card shows today\'s shapes, "Only these N", and opens on the Ladder tab', [3, 5].includes(l.shapes.length) && l.only === `Only these ${l.shapes.length}` && l.tab === 'ladder', JSON.stringify({ shapes: l.shapes, only: l.only, tab: l.tab }));
  step('the ladder: 12 players, highest first, ranks 1 to 12, portraits on every row', l.rows.length === 12 && l.rows[0].name === 'Tower Tess' && l.rows.every((r, i) => r.rank === i + 1 && (i === 0 || r.height <= l.rows[i - 1].height) && r.portrait)
    && /Everyone/.test(l.head) && /12 players/.test(l.head), JSON.stringify({ head: l.head, rows: l.rows.slice(0, 3) }));
  step('without a name: a "Pick a name" strip, a report flag on every row', l.join && l.you === 'Not on the ladder yet' && l.rows.every(r => r.flag && !r.me), JSON.stringify({ join: l.join, you: l.you }));
  step('the card fits: no sideways scroll, every button 44 px', !l.overflowX && !l.small.length, JSON.stringify(l.small));

  // Joining: the filter's hints, a taken name, then a good one.
  await page.click('.ui-daily [data-action="join"]');
  await page.waitForSelector('.ui-namecard');
  n = await nameCardState(page);
  await shot('02-namecard');
  step('the name card: "Pick a name", Save locked while empty, no prices anywhere', n.title === 'Pick a name' && n.saveLocked && !n.priced && !n.forget, JSON.stringify({ title: n.title, saveLocked: n.saveLocked, priced: n.priced }));
  const pick = id => n.picks.find(p => p.id === id);
  step('portraits: level ones owned to level 6, the rest locked with what unlocks them', !pick('meadow').locked && !pick('sunset').locked && pick('nightsky').locked && pick('nightsky').label === 'Level 8'
    && pick('disco').locked && pick('disco').label === 'Workshop' && pick('supporter').label === 'Supporter Pack' && pick('moonwalk').locked && !!pick('moonwalk').label
    // Shop ones (only) say workshop when tapped, for the Workshop to open on them.
    && n.picks.filter(p => p.workshop).map(p => p.id).join() === 'bubblegum,checkers,retro,rainbow,lava_lamp,disco,supporter',
  JSON.stringify(n.picks.map(p => `${p.id}:${p.locked ? p.label : 'owned'}`)));
  await typeName(page, 'ab');
  n = await nameCardState(page);
  step('"ab": "At least 3 characters", Save locked', n.bad && /At least 3/.test(n.hint) && n.saveLocked, n.hint);
  await typeName(page, 'sh1tstack');
  n = await nameCardState(page);
  step('a rude name: "That name isn\'t allowed", Save locked', n.bad && /isn't allowed/.test(n.hint) && n.saveLocked, n.hint);
  await typeName(page, 'me@mail.com');
  n = await nameCardState(page);
  step('an email: refused before the server sees it', n.bad && n.saveLocked, n.hint);
  await typeName(page, 'tower tess');
  n = await nameCardState(page);
  step('"tower tess" looks good here...', !n.bad && n.hint === 'Looks good' && !n.saveLocked, n.hint);
  await page.click('.ui-namecard [data-action="save"]');
  await page.waitForTimeout(800);
  n = await nameCardState(page);
  step('...but the ladder says it\'s taken', n && n.bad && /already has that name/.test(n.hint), n?.hint);
  await typeName(page, 'Blake Builds');
  await page.click('.ui-namecard input[value="sunset"] + span');
  await page.click('.ui-namecard [data-action="save"]');
  await page.waitForSelector('.ui-daily .ui-ld', { timeout: 10000 });
  await page.waitForFunction(() => !document.querySelector('.ui-daily .ui-ld-msg.loading'), null, { timeout: 15000 });
  l = await ladder(page);
  await shot('03-joined');
  step('joined: "On the ladder as Blake Builds" with the Sunset portrait', !l.join && l.you === 'Blake Builds' && l.youPortrait === 'sunset', JSON.stringify({ you: l.you, portrait: l.youPortrait }));
  const menuName = await page.evaluate(() => { document.querySelector('.ui-daily [data-action="close"]').click(); return new Promise(r => setTimeout(() => r(document.querySelector('.ui-menu')?.textContent ?? ''), 300)); });
  step('the menu greets them by their ladder name', /Blake Builds/.test(menuName), menuName.slice(0, 80));

  // The scored try reaches the ladder: at its first shape, and finished at its end.
  await openDaily(page);
  await page.click('.ui-daily [data-action="scored"]');
  await page.click('.ui-daily [data-action="scored"]', { force: true });
  await page.waitForFunction(() => window.__wobble.scene.started && window.__wobble.scene.sim?.stepIndex > 0 && window.__wobble.scene.sim.state === 'playing', null, { timeout: 15000 });
  const queue = await page.evaluate(() => { const s = window.__wobble.scene.sim; return [s.ctrl?.shape, ...s.queue]; });
  step('the scored try deals only today\'s shapes', queue.every(k => l.shapes.includes(k)), `${queue.join(' ')} of ${l.shapes.join(' ')}`);
  await page.waitForTimeout(1500);
  let v = await fetch(`${api}/?day=${today}`).then(r => r.json());
  const mine = v.view.top.find(r => r.name === 'Blake Builds');
  step('on the ladder from its first shape, still climbing', !!mine && mine.finished === false && mine.portrait === 'sunset', JSON.stringify(mine));
  await toSummary(page);
  await page.click('.ui-summary [data-action="home"]');
  await page.waitForTimeout(1500);
  v = await fetch(`${api}/?day=${today}`).then(r => r.json());
  step('finished on the ladder once the run ends', v.view.top.find(r => r.name === 'Blake Builds')?.finished === true, JSON.stringify(v.view.top.find(r => r.name === 'Blake Builds')));
  await openDaily(page);
  l = await ladder(page);
  await shot('04-my-row');
  const me = l.rows.find(r => r.me);
  step('their row: highlighted, marked you, no report flag, ranked 13 of 13', !!me && me.rank === 13 && !me.flag && /13 players/.test(l.head), JSON.stringify({ me, head: l.head }));

  // The Profile: the same name and portrait, and changed from there (§10.3).
  await page.click('.ui-daily [data-action="close"]');
  await openProfile(page);
  pr = await profileState(page);
  await shot('04b-profile-named');
  step('the Profile: their name with Edit, their Blockling in the Sunset portrait, no "Pick a name"', pr.name === 'Blake Builds' && pr.edit && !pr.pick && pr.portrait === 'sunset' && !pr.small.length, JSON.stringify(pr));
  await page.click('.ui-profile [data-action="name"]');
  await page.waitForSelector('.ui-namecard');
  n = await nameCardState(page);
  step('Edit on the Profile opens the same card: "Your name and portrait", their name in it', n.title === 'Your name and portrait' && n.value === 'Blake Builds' && n.forget, JSON.stringify({ title: n.title, value: n.value }));
  await page.click('.ui-namecard input[value="meadow"] + span');
  await page.click('.ui-namecard [data-action="save"]');
  await page.waitForSelector('.ui-profile', { timeout: 10000 });
  pr = await profileState(page);
  step('saved: back on the Profile, now in the Meadow portrait', pr.name === 'Blake Builds' && pr.portrait === 'meadow', JSON.stringify(pr));
  await page.click('.ui-profile [data-action="close"]');
  await openDaily(page);
  l = await ladder(page);
  step('the Daily card follows: their strip and their row in Meadow', l.youPortrait === 'meadow' && l.rows.find(r => r.me)?.portrait === 'meadow', JSON.stringify({ you: l.youPortrait, row: l.rows.find(r => r.me) }));
  v = await fetch(`${api}/?day=${today}`).then(r => r.json());
  step('...and so does their row for everyone', v.view.top.find(r => r.name === 'Blake Builds')?.portrait === 'meadow', JSON.stringify(v.view.top.find(r => r.name === 'Blake Builds')));

  // Reporting: hidden for them at once, behind a "Report this name?" question.
  await page.click('.ui-daily .ui-ld-row:nth-child(2) button.ui-ld-flag');
  await page.waitForTimeout(200);
  const asking = await page.evaluate(() => !document.querySelector('.ui-daily .ui-ld-row:nth-child(2) .ui-ld-confirm').hidden);
  await shot('05-report-ask');
  step('a flag asks "Report this name?" first', asking);
  await page.click('.ui-daily .ui-ld-row:nth-child(2) [data-action="reportYes"]');
  await page.waitForTimeout(1200);
  l = await ladder(page);
  step('the reported name shows as a stand-in for them at once, with no flag', /^Builder \d{4}$/.test(l.rows[1].name) && !l.rows[1].flag, JSON.stringify(l.rows[1]));
  await shot('06-reported');

  // The best-days tab still works.
  await page.click('.ui-daily [data-action="tab"][data-tab="best"]');
  const best = await page.evaluate(() => ({ ladderHidden: document.querySelector('.ui-dl-pane[data-pane="ladder"]').hidden, best: document.querySelectorAll('.ui-dl-best li').length }));
  step('the "Your best days" tab swaps the ladder out', best.ladderHidden && best.best === 1, JSON.stringify(best));
  await page.click('.ui-daily [data-action="tab"][data-tab="ladder"]');

  // Edit: their name stays (once a week), the portrait changes any time.
  await page.click('.ui-daily [data-action="edit"]');
  await page.waitForSelector('.ui-namecard');
  n = await nameCardState(page);
  step('Edit on the Daily card: the same card, the weekly rule, a delete button', n.title === 'Your name and portrait' && /once a week/.test(n.rule) && n.forget, JSON.stringify({ title: n.title, rule: n.rule }));
  await typeName(page, 'Blake Again');
  await page.click('.ui-namecard [data-action="save"]');
  await page.waitForTimeout(800);
  n = await nameCardState(page);
  step('a new name within the week: "once a week"', n && /once a week/.test(n.hint), n?.hint);
  await page.click('.ui-namecard [data-action="close"]');

  // Settings: delete my ladder name and scores (two taps).
  await page.click('.ui-daily [data-action="close"]');
  await page.click('[data-action="settings"]');
  await page.waitForSelector('.sc-ladder [data-action="forget"]');
  const label = await page.evaluate(() => document.querySelector('.sc-ladder')?.textContent);
  await page.click('.sc-ladder [data-action="forget"]');
  const armed = await page.evaluate(() => document.querySelector('.sc-ladder [data-action="forget"]').textContent);
  await page.click('.sc-ladder [data-action="forget"]');
  await page.waitForTimeout(1200);
  const done = await page.evaluate(() => document.querySelector('.sc-ladder-msg')?.textContent);
  await shot('07-deleted');
  step('Settings: "Your name", delete takes two taps, then says it\'s done', /Your name/.test(label) && /Delete my name and Daily scores/.test(label) && /Tap again/.test(armed) && /gone/.test(done ?? ''), `${armed} / ${done}`);
  v = await fetch(`${api}/?day=${today}`).then(r => r.json());
  step('their row and name are gone from the ladder', !v.view.top.some(r => r.name === 'Blake Builds') && v.view.total === 12, String(v.view.total));
  await page.click('.sc-root [data-action="close"]');
  await openDaily(page);
  l = await ladder(page);
  step('back to "Pick a name", today\'s try a personal best', l.join && !l.rows.some(r => r.me), JSON.stringify({ join: l.join, note: l.note }));
  await page.click('.ui-daily [data-action="close"]');
  await openProfile(page);
  pr = await profileState(page);
  step('the Profile is Builder again, with "Pick a name"', pr.name === 'Builder' && pr.pick && !pr.edit, JSON.stringify(pr));
  await page.click('.ui-profile [data-action="close"]');
  await openDaily(page);

  // A small phone.
  await page.setViewportSize({ width: 360, height: 640 });
  await page.waitForTimeout(300);
  l = await ladder(page);
  await shot('08-small');
  step('a 360 x 640 phone: no sideways scroll, buttons 44 px', !l.overflowX && !l.small.length, JSON.stringify(l.small));
  await ctx.close();
}

// ---------------------------------------------------------------- offline

{
  const { ctx, page } = await open({ width: 390, height: 844 }, { api: 'http://127.0.0.1:9' });
  await openDaily(page);
  const l = await ladder(page);
  await page.screenshot({ path: `${out}/09-offline.png` });
  step('offline: "Can\'t reach the ladder right now" with Try again, practice and the scored try still there',
    /Can't reach/.test(l.msg ?? '') && !!(await page.$('.ui-daily [data-action="retry"]')) && !!(await page.$('.ui-daily [data-action="practice"]')), l.msg);
  await ctx.close();
}

// ---------------------------------------------------------------- the game page's own ladder

// A stand-in for claude.ai's page database: one shared map, two viewers' rows already in it.
const pageDb = () => {
  const docs = new Map([
    ['ladder/u-ann', { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Page Ann', nameKey: 'pageann', portrait: 'cloudland', avatar: { shape: 'T' }, renamedAt: 1, entry: null }],
    ['ladder/u-bo', { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Page Bo', nameKey: 'pagebo', portrait: 'meadow', avatar: { shape: 'L' }, renamedAt: 1, entry: null }],
  ]);
  const day = new Date().toISOString().slice(0, 10), now = Date.now();
  docs.get('ladder/u-ann').entry = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', name: 'Page Ann', portrait: 'cloudland', avatar: { shape: 'T' }, height: 61.5, score: 9000, checkpoints: 4, finished: true, at: now - 600000, day };
  docs.get('ladder/u-bo').entry = { id: 'bbbbbbbbbbbbbbbbbbbbbbbb', name: 'Page Bo', portrait: 'meadow', avatar: { shape: 'L' }, height: 33, score: 5000, checkpoints: 2, finished: false, at: now - 300000, day };
  const snap = (path, d) => ({ id: path.split('/').pop(), exists: !!d, data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined) });
  const query = (col, filters = [], n = 1000) => ({
    where: (f, op, v) => query(col, [...filters, [f, v]], n),
    limit: m => query(col, filters, m),
    get: async () => ({ docs: [...docs.entries()].filter(([p, d]) => p.startsWith(col + '/') && p.split('/').length === 2 && filters.every(([f, v]) => d[f] === v)).slice(0, n).map(([p, d]) => snap(p, d)) }),
  });
  const db = {
    doc: path => ({ get: async () => snap(path, docs.get(path)), set: async d => { docs.set(path, JSON.parse(JSON.stringify(d))); }, delete: async () => { docs.delete(path); } }),
    collection: col => ({ ...query(col), doc: id => db.doc(`${col}/${id ?? Math.random().toString(36).slice(2)}`) }),
  };
  window.__pageDocs = docs;
  window.claude = { use: async name => (name === 'db' ? db : name === 'user' ? { id: async () => 'u-me' } : null) };
};

{
  const { ctx, page } = await open({ width: 390, height: 844 }, { script: pageDb });
  await openDaily(page);
  let l = await ladder(page);
  step('the game page: its own ladder, "This page", its two players', /This page/.test(l.head) && l.rows.map(r => r.name).join(',') === 'Page Ann,Page Bo', JSON.stringify({ head: l.head, rows: l.rows.map(r => r.name) }));
  // Here the name is picked on the Profile, and the Daily card uses it.
  await page.click('.ui-daily [data-action="close"]');
  await openProfile(page);
  await page.click('.ui-profile [data-action="name"]');
  await page.waitForSelector('.ui-namecard');
  await typeName(page, 'page ann');
  await page.click('.ui-namecard [data-action="save"]');
  await page.waitForTimeout(500);
  const n = await nameCardState(page);
  step('the page ladder: a name another viewer holds is taken', n && /already has that name/.test(n.hint), n?.hint);
  await typeName(page, 'Page Me');
  await page.click('.ui-namecard [data-action="save"]');
  await page.waitForSelector('.ui-profile');
  const pr = await profileState(page);
  step('the page: named on the Profile, which shows it with Edit', pr.name === 'Page Me' && pr.edit && !pr.pick, JSON.stringify(pr));
  await page.click('.ui-profile [data-action="close"]');
  await openDaily(page);
  l = await ladder(page);
  step('the page\'s Daily card: on the ladder as the Profile\'s name', !l.join && l.you === 'Page Me', JSON.stringify({ join: l.join, you: l.you }));
  await page.click('.ui-daily [data-action="scored"]');
  await page.click('.ui-daily [data-action="scored"]', { force: true });
  await page.waitForFunction(() => window.__wobble.scene.started && window.__wobble.scene.sim?.stepIndex > 0 && window.__wobble.scene.sim.state === 'playing', null, { timeout: 15000 });
  await toSummary(page);
  await page.click('.ui-summary [data-action="home"]');
  await page.waitForTimeout(800);
  await openDaily(page);
  l = await ladder(page);
  await page.screenshot({ path: `${out}/10-page-ladder.png` });
  const meRow = l.rows.find(r => r.me);
  step('the page ladder: their finished try is on it, third, as Page Me', meRow?.name === 'Page Me' && meRow.rank === 3 && l.rows.length === 3, JSON.stringify(l.rows));
  const row = await page.evaluate(() => window.__pageDocs.get('ladder/u-me'));
  step('the page keeps their row at ladder/<their id> only', row?.name === 'Page Me' && row.entry?.finished === true, JSON.stringify(row));
  await ctx.close();
}

// ---------------------------------------------------------------- no database (signed out)

{
  const { ctx, page } = await open({ width: 390, height: 844 }, { script: () => { window.claude = { use: async () => null }; } });
  await openDaily(page);
  const l = await ladder(page);
  step('no database: "The ladder isn\'t available here", no join strip', /isn't available/.test(l.msg ?? '') && l.you === null, l.msg);
  await page.click('.ui-daily [data-action="close"]');
  await openProfile(page);
  const pr = await profileState(page);
  step('no database: the Profile has no name button (names live on the ladder)', pr.name === 'Builder' && !pr.edit && !pr.pick, JSON.stringify(pr));
  await ctx.close();
}

step('no page errors or missing files', errors.length === 0 && missing.length === 0, [...missing.map(u => `missing: ${u}`), ...errors].slice(0, 3).join(' / '));
writeFileSync(`${out}/report.json`, JSON.stringify({ steps, errors }, null, 2));
await browser.close();
server.close();
dev.kill();
const failed = steps.filter(s => !s.ok).length;
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
