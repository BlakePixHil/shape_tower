// Achievements in the built game (gameplay.md §18.3, §18.7): a returning player's history grant, the
// profile row and panel (secrets stay hidden), the in-run toast, and the summary strip with its XP lines.
//   npm run build:game && node tests/achievements-browser.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/achievements';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`${m.type()}: ${m.text()}`); });
await page.addInitScript(() => {
  window.claude = { use: async () => null };
  // A player from before achievements: four runs, Cloudlands reached, a few Perfects. Set once.
  if (!localStorage.getItem('shape-tower-profile-v1')) {
    localStorage.setItem('shape-tower-profile-v1', JSON.stringify({
      level: 4, xp: 40, total: 900, runs: 4, streak: 1, lastDay: '2026-10-21', boostDay: '2026-10-21', sliceRuns: 5, player: 'p-ach-check',
      stats: { bestHeight: 41.5, bestBiome: 3, bricks: 310, perfects: 12, rows: 0, checkpoints: 6, clutches: 0 },
    }));
    localStorage.setItem('shape-tower-played', '1');
    localStorage.setItem('shape-tower-best', '41.5');
  }
});
await page.goto(url);
const shot = async name => page.screenshot({ path: `${out}/${name}.png` });
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const SECRETS = ['Avalanche!', 'So Close!', 'Do-Over', 'Needle Threader'];

await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
const granted = await page.evaluate(() => Object.keys(window.__wobble.profile.achievements).sort());
step('history grant: first checkpoint, Treetops, Cloudlands, first Perfect', JSON.stringify(granted) === JSON.stringify(['biome_2', 'biome_3', 'cp_first', 'perfect']), granted.join(', '));

await page.click('[data-action="profile"]');
await page.waitForSelector('.ui-achrow');
await page.waitForTimeout(400);
await shot('01-profile');
const row = await page.evaluate(() => document.querySelector('.ui-achrow')?.textContent?.replace(/\s+/g, ' ').trim());
step('profile row counts 4 of 65 (49 tower, 16 Blockling Pop)', /Achievements\s*4 \/ 65/.test(row ?? ''), row);

await page.click('.ui-achrow');
await page.waitForSelector('.ui-achs');
await page.waitForTimeout(300);
await shot('02-panel');
const panel = await page.evaluate(secrets => {
  const p = document.querySelector('.ui-achs');
  const text = p.textContent ?? '';
  return {
    items: p.querySelectorAll('.ui-ach').length, earned: p.querySelectorAll('.ui-ach.got').length,
    leaked: secrets.filter(s => text.includes(s)), hidden: (text.match(/Keep playing to find this one\./g) ?? []).length,
    bricks: [...p.querySelectorAll('.ui-ach')].find(i => i.textContent.includes('Brick by Brick'))?.querySelector('.ui-ach-bar em')?.textContent,
    badges: [...p.querySelectorAll('.ui-ach > img')].filter(i => i.src.startsWith('data:image/png') && i.naturalWidth > 0).length,
    groups: [...p.querySelectorAll('h2.ui-h2')].map(h => h.firstChild.textContent),
    overflowX: document.documentElement.scrollWidth > window.innerWidth,
    // Pop! and Solid Ground share a tier and icon; Pop's badge has Art's Pop look, so they differ.
    popBadge: [...p.querySelectorAll('.ui-ach')].find(i => i.textContent.includes('Pop!'))?.querySelector(':scope > img')?.src ?? '',
    towerBadge: [...p.querySelectorAll('.ui-ach')].find(i => i.textContent.includes('Solid Ground'))?.querySelector(':scope > img')?.src ?? '',
  };
}, SECRETS);
step('panel lists 65, 4 earned, in seven groups (Blockling Pop last)', panel.items === 65 && panel.earned === 4 && panel.groups.join() === 'Climb,Craft,Survive,Power-ups,Lifetime,Secret,Blockling Pop', JSON.stringify(panel.groups));
step('secret names and texts stay out of the page', panel.leaked.length === 0 && panel.hidden === 4, `leaked ${panel.leaked}`);
step('counted ones show progress (Brick by Brick 310 / 1,000)', /310 \/ 1,000/.test(panel.bricks ?? ''), panel.bricks);
step('every row has a baked badge', panel.badges === 65, `${panel.badges} / 65`);
step('Blockling Pop badges have their own look (Pop! differs from Solid Ground)', panel.popBadge.length > 100 && panel.towerBadge.length > 100 && panel.popBadge !== panel.towerBadge, `${panel.popBadge.length} ${panel.towerBadge.length}`);
step('no sideways scroll at 390 px', !panel.overflowX);
await page.evaluate(() => document.querySelector('.ui-achs').scrollTo(0, 99999));
await page.waitForTimeout(200);
await shot('03-panel-secret');
await page.click('.ui-achs [data-action="close"]');
await page.waitForSelector('.ui-achrow');
step('closing the panel goes back to the profile', await page.evaluate(() => !!document.querySelector('.ui-profile')));

// Play Games / Game Center (§18.5): nothing on the game page; in the app, a button under the list.
const web = await page.evaluate(() => ({ available: window.__wobble.trophies.stores.available, button: !!document.querySelector('.ui-ach-store') }));
step('the game page has no store button and no game service', !web.available && !web.button, JSON.stringify(web));
await page.evaluate(() => {
  // What the phone app's plugin would be, signed out of Play Games.
  const calls = window.__storeCalls = [];
  const s = window.__wobble.trophies.stores;
  s.api = {
    signIn: async () => { calls.push('signIn'); return { signedIn: true }; },
    unlock: async ({ id }) => { calls.push('unlock ' + id); return { sent: true }; },
    progress: async ({ id, steps }) => { calls.push(`progress ${id} ${steps}`); return { sent: true }; },
    show: async () => { calls.push('show'); },
  };
  s.ids = { play: { projectId: '1', achievements: { cp_first: 'CgkIcp', bricks_1k: 'CgkIbr' } }, gameCenter: { enabled: false, prefix: 'shapetower.' } };
  Object.assign(s, { available: true, service: 'play', signedIn: false });
});
await page.click('.ui-achrow');
await page.waitForSelector('.ui-ach-store');
await page.waitForTimeout(300);
await shot('03b-panel-store');
const label = await page.evaluate(() => document.querySelector('.ui-ach-store').textContent);
await page.click('.ui-ach-store');
await page.waitForFunction(() => window.__storeCalls.includes('show'), null, { timeout: 3000 }).catch(() => {});
const calls = await page.evaluate(() => window.__storeCalls);
step('in the app: "Open in Google Play Games" signs in, sends the unlocks and progress, opens Play Games', label === 'Open in Google Play Games' && calls.join() === 'signIn,unlock CgkIcp,progress CgkIbr 310,show', `${label}: ${calls.join(', ')}`);
await page.evaluate(() => Object.assign(window.__wobble.trophies.stores, { available: false, api: null }));
await page.click('.ui-achs [data-action="close"]');
await page.waitForSelector('.ui-achrow');
await page.click('.ui-profile [data-action="close"]');
await page.waitForTimeout(300);

// A run: a clutch through the real tracker shows the toast and saves it straight away.
await page.click('[data-action="play"]');
await page.waitForFunction(() => !!window.__wobble.trophies.tracker, null, { timeout: 5000 });
await page.waitForTimeout(2600); // the Meadow's title card holds the toast's spot first
await page.evaluate(() => window.__wobble.trophies.tracker.handle({ name: 'clutch', step: 1, payload: {} }));
await page.waitForSelector('.ui-achtoast', { timeout: 4000 });
await page.waitForTimeout(400);
await shot('04-toast');
const toast = await page.evaluate(() => ({ text: document.querySelector('.ui-achtoast')?.textContent?.replace(/\s+/g, ' ').trim(), touch: getComputedStyle(document.querySelector('.ui-achtoast')).pointerEvents, saved: JSON.parse(localStorage.getItem('shape-tower-profile-v1')).achievements?.clutch }));
step('toast says Achievement! Clutch!, ignores touches, already saved', /Achievement!\s*Clutch!/.test(toast.text ?? '') && toast.touch === 'none' && !!toast.saved && toast.saved.paid === false, JSON.stringify(toast));
await page.waitForFunction(() => !document.querySelector('.ui-achtoast'), null, { timeout: 5000 }).catch(() => {});
step('the toast leaves by itself', await page.evaluate(() => !document.querySelector('.ui-achtoast')));

// A burst of four: one toast at a time, and the third says "+1 more" instead of showing a fourth.
const seen = await page.evaluate(async () => {
  const names = ['One', 'Two', 'Three', 'Four'], seen = [];
  const watch = new MutationObserver(() => { const t = document.querySelector('.ui-achtoast'); const s = t?.textContent.replace(/\s+/g, ' ').trim(); if (s && !seen.includes(s)) seen.push(s); });
  watch.observe(document.body, { childList: true });
  for (const n of names) window.__wobble.trophies.toasts.push({ id: n, name: n, text: '', tier: 'silver', group: 'craft', icon: 'combo' });
  await new Promise(r => setTimeout(r, 9000));
  watch.disconnect();
  return { seen, many: document.querySelectorAll('.ui-achtoast').length };
});
step('a burst of four shows three, the last with "+1 more"', seen.seen.length === 3 && /Three\s*\+1 more/.test(seen.seen[2] ?? '') && seen.many === 0, JSON.stringify(seen.seen));

// Quit: the summary strip shows all five unpaid ones, and the tally pays them as flat lines.
await page.evaluate(() => window.__wobble.scene.sim.quit());
await page.waitForFunction(() => document.querySelector('.sc-root.show .ui-summary'), null, { timeout: 30000 }).catch(() => {});
await page.evaluate(() => window.__wobble.scene.skipPanorama?.());
await page.waitForSelector('.ui-achstrip', { timeout: 30000 });
await page.waitForTimeout(3200);
await shot('05-summary');
const sum = await page.evaluate(() => ({
  strip: [...document.querySelectorAll('.ui-achstrip img')].map(c => c.alt),
  lines: [...document.querySelectorAll('.ui-line')].map(l => l.textContent.replace(/\s+/g, ' ').trim()),
  paid: Object.values(window.__wobble.profile.achievements).every(s => s.paid),
}));
step('summary strip shows the 4 from history and the clutch', sum.strip.length === 5 && sum.strip.includes('Clutch!'), sum.strip.join(', '));
step('tally pays them: three named lines and "2 more"', sum.lines.filter(l => l.startsWith('🏆')).length === 4 && sum.lines.some(l => /🏆 2 more\s*\+40/.test(l)), sum.lines.join(' | '));
step('all paid once the tally is done', sum.paid);

step('no page errors', errors.length === 0, errors.slice(0, 3).join(' / '));
writeFileSync(`${out}/report.json`, JSON.stringify({ steps, errors }, null, 2));
await browser.close();
const failed = steps.filter(s => !s.ok).length;
console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
