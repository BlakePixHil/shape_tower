// The look in the built game, headless (monetisation plan v2, cosmetics): the profile's "Your look" and
// level track; owned items picked and worn in a run; pass, set and Supporter items opening the Workshop
// and coming back; the Builder's Pass bought at level 12 unlocking every reward to 12 at once; a refund
// taking the items (and the hat) off; the Supporter frame and crown; the XP tally's greyed pass reward
// opening the Workshop; and the pass's one mention, the level-10 card, shown once. No prices anywhere
// but the Workshop. Greyed pass rewards are found by their data-action (workshop), not their class.
//   npm run build:game && node tests/look-check.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/look';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };
const errors = [];
/** XP from one level to the next (game/src/sim/tuning.ts). */
const levelStep = L => Math.round((50 * L ** 1.65 + 50) / 10) * 10;

/** A page with a player who has played before, at `level` with `xp` into it. */
async function open(level, xp) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.addInitScript(([level, xp]) => {
    // A stand-in for claude.ai's page database (as in workshop-check), so the ladder stays off the network.
    const docs = new Map();
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
    window.claude = { use: async name => (name === 'db' ? db : name === 'user' ? { id: async () => 'u-look' } : null) };
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const day = new Date(Date.now() - 864e5);
    const yesterday = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    localStorage.setItem('shape-tower-profile-v1', JSON.stringify({
      level, xp, total: 3000, runs: 20, streak: 1, lastDay: yesterday, boostDay: yesterday, windDay: yesterday, sliceRuns: 20, player: 'p-look-check',
      seenGusts: true, seenHazards: ['crosswind', 'junk', 'meteor', 'dust', 'sway'], seenBrittle: true, askedGhost: true,
      stats: { bestHeight: 20, bestBiome: 2, bricks: 300, perfects: 10, rows: 5, checkpoints: 6, clutches: 1 },
    }));
    localStorage.setItem('shape-tower-played', '1');
  }, [level, xp]);
  await page.goto(url);
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
  await page.waitForTimeout(1200);
  return page;
}

/** Prices and buy buttons on screen (anything but the Workshop should have none). */
const selling = page => page.evaluate(() => {
  const text = document.querySelector('.sc-root')?.textContent ?? '';
  return { buy: document.querySelectorAll('[data-action="buy"]').length, price: /\$\d|\d[.,]\d\d\s?€|£\d/.test(text) };
});
const screen = page => page.evaluate(() => document.querySelector('.sc-root')?.firstElementChild?.getAttribute('aria-label') ?? null);
const look = page => page.evaluate(() => ({ worn: window.__wobble.look.worn(), scene: window.__wobble.look.scene(), frame: window.__wobble.look.frame(), saved: window.__wobble.profile.look, hat: window.__wobble.profile.avatar.hat }));
/** The open "Your look" panel: each item's state by id (radio: owned, shop: opens the Workshop for data-id, locked: a level). */
const items = page => page.evaluate(() => {
  const p = document.querySelector('.sc-root [aria-label="Your look"][role="dialog"]');
  if (!p) return null;
  const r = {};
  p.querySelectorAll('input[data-slot]').forEach(i => { if (i.value) r[i.value] = { state: 'owned', on: i.checked }; });
  p.querySelectorAll('.ui-look-item.shop').forEach(b => { r[b.dataset.item] = { state: 'shop', product: b.dataset.id }; });
  p.querySelectorAll('.ui-look-item.locked').forEach(d => { const id = d.querySelector('img')?.getAttribute('src') ?? ''; r[`locked:${d.getAttribute('aria-label')}`] = { state: 'locked', id }; });
  return r;
});
const buy = async (page, id) => {
  await page.click(`.sc-root [data-action="buy"][data-id="${id}"]`);
  await page.waitForSelector('.sc-root [data-action="confirm"]', { timeout: 3000 });
  await page.click('.sc-root [data-action="confirm"]');
  await page.waitForTimeout(600);
};
/** Taps an item in "Your look" (switching to its tab first). */
const tapItem = async (page, slot, id) => {
  await page.click(`.sc-root [data-tab="${slot}"]`);
  await page.waitForTimeout(150);
  const radio = await page.$(`.sc-root input[data-slot="${slot}"][value="${id}"]`);
  if (radio) await radio.evaluate(i => i.closest('label').click());
  else await page.click(`.sc-root .ui-look-item[data-item="${id}"]`);
  await page.waitForTimeout(200);
};
const workshopOn = (page, id) => page.evaluate(i => {
  const b = document.querySelector(`.sc-root [data-action="buy"][data-id="${i}"]`) ?? document.querySelector(`.sc-root [data-id="${i}"]`);
  const r = b?.getBoundingClientRect();
  return { workshop: document.querySelector('.sc-root')?.firstElementChild?.getAttribute('aria-label') === 'Workshop' || /Everything here is optional/.test(document.querySelector('.sc-root')?.textContent ?? ''), found: !!b, inView: !!r && r.top >= 0 && r.bottom <= innerHeight };
}, id);
/** Plays a run, dropping `n` pieces, quits it, and returns once the summary shows. */
async function runAndQuit(page, n) {
  await page.click('.sc-root.show [data-action="play"]');
  await page.waitForFunction(() => window.__wobble.scene.sim?.ctrl !== null && window.__wobble.scene.started, null, { timeout: 10000 });
  let col = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const s = await page.evaluate(() => { const s = window.__wobble.scene.sim; return { ctrl: s.ctrl && { hard: s.ctrl.hard }, f: s.foundation, placed: s.stats.placed, state: s.state }; });
    if (s.state !== 'playing' || s.placed >= n) break;
    if (s.ctrl && !s.ctrl.hard) {
      const x = s.f.x - s.f.width / 2 + 1 + (col++ % Math.max(1, s.f.width - 2));
      await page.evaluate(x => { const sm = window.__wobble.scene.sim; sm.intent({ type: 'moveTo', x }); sm.intent({ type: 'hardDrop' }); }, x);
    }
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => window.__wobble.hud.pauseBtn.click());
  await page.waitForTimeout(200);
  await page.click('.sc-root [data-action="quit"]');
  await page.waitForSelector('.sc-root.show [data-action="again"], .sc-root.show [data-action="continue"]', { timeout: 20000 });
}

// ================================================================ a level 12 player, nothing bought

let page = await open(12, 0);
await page.click('.sc-root.show [data-action="profile"]');
await page.waitForTimeout(600);
const prof = await page.evaluate(() => ({
  look: !!document.querySelector('.sc-root .sc-look'), track: !!document.querySelector('.sc-root .ui-trk'),
  locked: document.querySelectorAll('.sc-root .ui-trk-pass[data-action="workshop"][data-id="builders_pass"]').length,
  now: document.querySelector('.sc-root .ui-trk-col.now')?.dataset.level ?? null,
}));
await page.screenshot({ path: `${out}/01-profile.png` });
step('the profile has Your look and the level track, at the player\'s level', prof.look && prof.track && prof.now === '12', JSON.stringify(prof));
step('without the pass, its lane is greyed and opens the Workshop', prof.locked > 0, String(prof.locked));
let sell = await selling(page);
step('no prices or buy buttons on the profile', !sell.buy && !sell.price, JSON.stringify(sell));

await page.click('.sc-root .sc-look');
await page.waitForTimeout(500);
let it = await items(page);
await page.screenshot({ path: `${out}/02-your-look.png` });
step('Your look opens on the classic look', it?.skin_classic?.state === 'owned' && it.skin_classic.on, JSON.stringify(it?.skin_classic));
step('pass items open the Workshop on the pass, set items on their set, the crown on the Supporter Pack',
  it?.skin_polka?.product === 'builders_pass' && it?.skin_candy?.product === 'set_candy' && it?.hat_heart_crown?.product === 'supporter_pack', JSON.stringify([it?.skin_polka, it?.skin_candy, it?.hat_heart_crown]));
step('level hats to 12 are owned, the level 16 crown is still locked', it?.hat_tophat?.state === 'owned' && !it?.hat_crown && Object.keys(it ?? {}).some(k => /^locked:.*level 16/i.test(k)), Object.keys(it ?? {}).filter(k => k.startsWith('locked')).join(' | '));
sell = await selling(page);
step('no prices or buy buttons in Your look', !sell.buy && !sell.price, JSON.stringify(sell));

// A pick is kept with Done, and the hat goes on the avatar.
await tapItem(page, 'hat', 'hat_tophat');
await page.click('.sc-root [data-action="done"]');
await page.waitForTimeout(400);
let lk = await look(page);
step('Done keeps the picks: the top hat goes on the avatar', lk.worn.hat === 'hat_tophat' && lk.hat === 'tophat' && (await screen(page)) !== 'Your look', JSON.stringify({ worn: lk.worn.hat, hat: lk.hat }));
step('and the profile is saved', await page.evaluate(() => JSON.parse(localStorage.getItem('shape-tower-profile-v1')).avatar.hat === 'tophat'));

// The level track's greyed pass reward opens the Workshop, and its close comes back to the profile.
await page.click('.sc-root .ui-trk-col[data-level="13"] .ui-trk-pass[data-action="workshop"]');
await page.waitForTimeout(600);
let ws = await workshopOn(page, 'builders_pass');
await page.screenshot({ path: `${out}/03-workshop-from-track.png` });
step('a greyed pass reward on the track opens the Workshop on the pass', ws.workshop && ws.found && ws.inView, JSON.stringify(ws));
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(500);
step('closing it goes back to the profile', !!(await page.$('.sc-root .sc-look')));

// From Your look: a pass item opens the Workshop; buying the pass there gives every reward to 12 at once.
await page.click('.sc-root .sc-look');
await page.waitForTimeout(400);
await tapItem(page, 'skin', 'skin_polka');
await page.waitForTimeout(400);
ws = await workshopOn(page, 'builders_pass');
step('a pass item in Your look opens the Workshop on the pass', ws.workshop && ws.found && ws.inView, JSON.stringify(ws));
await buy(page, 'builders_pass');
const note = await page.evaluate(() => document.querySelector('.sc-root')?.textContent.replace(/\s+/g, ' ') ?? '');
step('the Workshop says the rewards are waiting', /rewards are waiting|Pick them in Your look/i.test(note), (note.match(/[^.]*(waiting|Your look)[^.]*\./i) ?? [''])[0]);
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(500);
it = await items(page);
await page.screenshot({ path: `${out}/04-your-look-pass.png` });
const PASS_TO_12 = ['skin_polka', 'landing_stars', 'flag_pennant', 'foundation_brick', 'hat_hardhat', 'skin_stars', 'landing_pixels', 'flag_checkered', 'foundation_log', 'hat_beanie', 'skin_checks'];
step('closing the Workshop comes back to Your look', !!it);
step('with the pass bought at level 12, all 11 rewards from level 2 to 12 are owned at once', PASS_TO_12.every(id => it?.[id]?.state === 'owned'), PASS_TO_12.filter(id => it?.[id]?.state !== 'owned').join(' '));
step('and the ones above 12 still wait for their level', !it?.skin_hearts && !it?.landing_leaves && Object.keys(it ?? {}).some(k => /^locked:.*level 17/i.test(k)));
step('sets and the crown still open the Workshop', it?.skin_candy?.product === 'set_candy' && it?.hat_heart_crown?.product === 'supporter_pack');

for (const [slot, id] of [['skin', 'skin_checks'], ['landing', 'landing_pixels'], ['foundation', 'foundation_log'], ['flag', 'flag_checkered'], ['hat', 'hat_beanie']]) await tapItem(page, slot, id);
await page.click('.sc-root [data-action="done"]');
await page.waitForTimeout(400);
lk = await look(page);
step('the new look is saved', lk.saved.skin === 'skin_checks' && lk.saved.landing === 'landing_pixels' && lk.saved.foundation === 'foundation_log' && lk.saved.flag === 'flag_checkered' && lk.hat === 'beanie', JSON.stringify({ ...lk.saved, hat: lk.hat }));
step('and the run wears it: skin, landing, foundation and flag', lk.scene.ids.skin === 'skin_checks' && lk.scene.ids.landing === 'landing_pixels' && lk.scene.ids.foundation === 'foundation_log' && lk.scene.ids.flag === 'flag_checkered' && !!lk.scene.skin && lk.scene.landing && !!lk.scene.foundation && !!lk.scene.flag, JSON.stringify(lk.scene));
const prof2 = await page.evaluate(() => ({ pass: !!document.querySelector('.sc-root .ui-trk.has-pass'), locked: document.querySelectorAll('.sc-root .ui-trk-pass[data-action="workshop"]').length, got: document.querySelectorAll('.sc-root .ui-trk-pass.got').length }));
step('the track\'s pass lane is in colour, ticked to 12', prof2.pass && prof2.locked === 0 && prof2.got === 11, JSON.stringify(prof2));
await page.click('.sc-root [data-action="avatar"]');
await page.waitForTimeout(400);
const av = await page.evaluate(() => ({ beanie: !!document.querySelector('.sc-root input[data-kind="hat"][value="beanie"]'), on: document.querySelector('.sc-root input[data-kind="hat"]:checked')?.value ?? null }));
step('the avatar picker has the pass hats owned, with the beanie on', av.beanie && av.on === 'beanie', JSON.stringify(av));
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(300);
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(400);

// A run wears it from the start.
await page.click('.sc-root.show [data-action="play"]');
await page.waitForFunction(() => window.__wobble.scene.sim?.ctrl !== null && window.__wobble.scene.started, null, { timeout: 10000 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/05-run.png` });
lk = await look(page);
step('a run starts in the new look', lk.scene.ids.skin === 'skin_checks' && lk.scene.ids.foundation === 'foundation_log' && lk.scene.skin === 'checks', JSON.stringify(lk.scene));
await page.evaluate(() => window.__wobble.hud.pauseBtn.click());
await page.waitForTimeout(200);
await page.click('.sc-root [data-action="quit"]');
await page.waitForSelector('.sc-root.show [data-action="again"]', { timeout: 20000 });
await page.waitForTimeout(600);
await page.click('.sc-root [data-action="home"]');
await page.waitForTimeout(500);

// A refund (clearing the test store): the look falls back to the classic and the pass hat comes off.
await page.click('.sc-root.show [data-action="settings"]');
await page.waitForTimeout(400);
await page.click('.sc-root [data-action="clearTest"]');
await page.waitForTimeout(500);
lk = await look(page);
step('after a refund the run wears the classic look again', lk.worn.skin === 'skin_classic' && lk.worn.foundation === 'foundation_classic' && lk.scene.ids.skin === 'skin_classic' && lk.scene.skin === null, JSON.stringify(lk.worn));
step('and the pass hat comes off the avatar', lk.hat === null && lk.worn.hat === null, String(lk.hat));
step('the saved picks stay, for if they buy it again', lk.saved.skin === 'skin_checks', lk.saved.skin);
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(400);

// The Supporter Pack: the frame, the crown, and the pass lane.
step('no Supporter frame without the pack', lk.frame === null, String(lk.frame));
await page.click('.sc-root.show [data-action="workshop"]');
await page.waitForTimeout(500);
await buy(page, 'supporter_pack');
lk = await look(page);
step('the Supporter Pack puts the Supporter frame on the badge', lk.frame === 'supporter', String(lk.frame));
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(400);
await page.click('.sc-root.show [data-action="profile"]');
await page.waitForTimeout(500);
await page.click('.sc-root .sc-look');
await page.waitForTimeout(400);
it = await items(page);
step('and the heart crown and the pass rewards are owned', it?.hat_heart_crown?.state === 'owned' && PASS_TO_12.every(id => it?.[id]?.state === 'owned'), JSON.stringify(it?.hat_heart_crown));
step('the saved picks come back with it', lk.worn.skin === 'skin_checks' && (await look(page)).scene.ids.skin === 'skin_checks');
await page.context().close();

// ================================================================ a level 9 player, one brick from level 10

page = await open(9, levelStep(9) - 1);
await runAndQuit(page, 3);
await page.waitForSelector('.sc-root [data-action="continue"]', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
const lu = await page.evaluate(() => {
  const c = document.querySelector('.sc-root .ui-lu-pass');
  const take = document.querySelector('.sc-root .ui-levelup [data-action="workshop"][data-id="builders_pass"]');
  return { level: window.__wobble.profile.level, intro: !!c?.classList.contains('intro'), text: c?.textContent.replace(/\s+/g, ' ').trim() ?? '', take: take?.textContent.trim() ?? null, notNow: document.querySelector('.sc-root .ui-levelup [data-action="continue"]')?.textContent.trim() ?? null };
});
await page.screenshot({ path: `${out}/06-level-10.png` });
step('reaching level 10 shows the pass\'s one mention: its reward, how many wait, Take a look and Not now', lu.level === 10 && lu.intro && /Builder's Pass/.test(lu.text) && /9 are waiting/.test(lu.text) && /Take a look/.test(lu.take ?? '') && /Not now/.test(lu.notNow ?? ''), JSON.stringify(lu));
step('with no price on it', !(await selling(page)).price);
step('the mention is saved as shown', await page.evaluate(() => JSON.parse(localStorage.getItem('shape-tower-profile-v1')).passIntro === true));
const tally = await page.evaluate(() => [...document.querySelectorAll('.sc-root .ui-sum-xp .ui-lvr-item.pass')].map(e => ({ greyed: e.dataset.action === 'workshop', item: e.dataset.item ?? null, action: e.dataset.action ?? null })));
step('the XP tally shows level 10\'s pass reward, greyed, pointing at the Workshop', tally.length === 1 && tally[0].greyed && tally[0].item === 'foundation_log' && tally[0].action === 'workshop', JSON.stringify(tally));
await page.click('.sc-root .ui-levelup [data-action="workshop"][data-id="builders_pass"]');
await page.waitForTimeout(600);
ws = await workshopOn(page, 'builders_pass');
step('Take a look opens the Workshop on the pass', ws.workshop && ws.found && ws.inView, JSON.stringify(ws));
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(600);
step('and closing it goes home (no ad for this run end)', !!(await page.$('.sc-root.show [data-action="play"]')) && (await page.evaluate(() => window.__wobble.shop.adState.today ?? 0)) === 0);

// The next level: no second mention, and the tally's greyed reward opens the Workshop too.
await page.evaluate(xp => { window.__wobble.profile.xp = xp; }, levelStep(10) - 1);
await runAndQuit(page, 3);
await page.waitForSelector('.sc-root [data-action="continue"]', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
const lu2 = await page.evaluate(() => ({ level: window.__wobble.profile.level, pass: !!document.querySelector('.sc-root .ui-lu-pass'), take: !!document.querySelector('.sc-root .ui-levelup [data-action="workshop"]'), btn: document.querySelector('.sc-root [data-action="continue"]')?.textContent.trim() ?? null }));
step('level 11: no second mention of the pass', lu2.level === 11 && !lu2.pass && !lu2.take && /Nice/.test(lu2.btn ?? ''), JSON.stringify(lu2));
await page.click('.sc-root [data-action="continue"]');
await page.waitForTimeout(400);
await page.click('.sc-root .ui-sum-xp .ui-lvr-item.pass[data-action="workshop"]');
await page.waitForTimeout(600);
ws = await workshopOn(page, 'builders_pass');
step('tapping the tally\'s greyed reward opens the Workshop on the pass', ws.workshop && ws.found, JSON.stringify(ws));
await buy(page, 'builders_pass');
await page.click('.sc-root [data-action="close"]');
await page.waitForTimeout(600);
step('closing it goes home', !!(await page.$('.sc-root.show [data-action="play"]')));

// With the pass: the level-up card shows the new reward as theirs, and the tally in colour.
await page.evaluate(xp => { window.__wobble.profile.xp = xp; }, levelStep(11) - 1);
await runAndQuit(page, 3);
await page.waitForSelector('.sc-root [data-action="continue"]', { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
const lu3 = await page.evaluate(() => {
  const c = document.querySelector('.sc-root .ui-lu-pass');
  return { level: window.__wobble.profile.level, owned: !!c && !c.classList.contains('intro'), text: c?.textContent.replace(/\s+/g, ' ').trim() ?? '', tally: [...document.querySelectorAll('.sc-root .ui-sum-xp .ui-lvr-item.pass')].map(e => e.dataset.action === 'workshop') };
});
await page.screenshot({ path: `${out}/07-level-12-pass.png` });
step('with the pass, level 12\'s card shows its reward as theirs', lu3.level === 12 && lu3.owned && /for your look/.test(lu3.text), JSON.stringify(lu3));
step('and the tally shows it in colour', lu3.tally.length === 1 && lu3.tally[0] === false, JSON.stringify(lu3.tally));
await page.context().close();

step('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = steps.filter(s => !s.ok).length;
console.log(failed ? `\n${failed} of ${steps.length} failed` : `\nall ${steps.length} passed`);
process.exit(failed ? 1 : 0);
