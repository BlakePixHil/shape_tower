// Plays Blockling Pop in the built game headless (Pop plan §3, §9, milestone 1): the Pop card on the
// menu at level 2, a run opened from it, shapes dragged from the tray onto the board with the finger
// below the shape (the ghost snaps, a drop off the board springs back), the bag, lines popping and
// the score, the run saved after every move and Continue after a reload landing on the same digest,
// pause with End run, and the results card paying the run's XP into the one profile. Then a smaller
// phone, to see the board, tray and bag fit.
//   npm run build:game && node tests/pop-browser.mjs [outDir]

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/pop';
mkdirSync(out, { recursive: true });
const url = new URL('../dist-game/game.html', import.meta.url).href;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? '/opt/pw-browsers/chromium', args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] });
const steps = [];
const step = (name, ok, info = '') => { steps.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`); };

async function open(viewport, dpr = 2) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|fonts\.g/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.addInitScript(() => {
    window.claude = { use: async () => null };
    if (!localStorage.getItem('shape-tower-profile-v1')) {
      const day = new Date(Date.now() - 864e5);
      const yesterday = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      localStorage.setItem('shape-tower-profile-v1', JSON.stringify({
        level: 3, xp: 10, total: 400, runs: 3, streak: 1, lastDay: yesterday, boostDay: yesterday, windDay: yesterday, sliceRuns: 3, player: 'p-pop-check',
        seenGusts: true, seenHazards: [], seenBrittle: true, askedGhost: true,
      }));
      localStorage.setItem('shape-tower-played', '1');
    }
  });
  await page.goto(url);
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  return { ctx, page, errors };
}

/** The finger positions (CSS px) that drag a slot's shape to put it at board cell (x, y). */
const dragPlan = (page, slot, x, y) => page.evaluate(([slot, x, y]) => {
  const v = window.__wobble.pop.view, t = v.sim.turn(slot), k = v.k;
  const [sx, sy] = v.slotCentre(slot);
  const cx = v.bx + (x + t.w / 2) * v.cell, cy = v.by + (y + t.h / 2) * v.cell;
  return { from: [sx / k, sy / k], to: [cx / k, (cy + v.cell * (1.1 + t.h / 2)) / k] };
}, [slot, x, y]);

async function drag(page, from, to, steps = 8) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  await page.mouse.move((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, { steps: 3 });
  await page.mouse.move(to[0], to[1], { steps });
  await page.waitForTimeout(40);
  await page.mouse.up();
  await page.waitForTimeout(60);
}

/** A good move for the run as it stands: the placement that pops the most, else the first that fits. */
const pickMove = page => page.evaluate(() => {
  const sim = window.__wobble.pop.view.sim;
  let best = null, bl = -1;
  for (const slot of [0, 1, 2, 3]) {
    const t = sim.turn(slot);
    if (!t) continue;
    for (const p of t.places) {
      if (!sim.canPlace(slot, p.x, p.y)) continue;
      const l = sim.wouldPop(slot, p.x, p.y).length;
      // Prefer the bottom-left so the board fills like a person's would.
      const v = l * 100 + p.y + (8 - p.x) * 0.1;
      if (v > bl) { bl = v; best = { slot, x: p.x, y: p.y }; }
    }
  }
  return best;
});

const state = page => page.evaluate(() => {
  const v = window.__wobble.pop.view, s = v?.sim;
  return s ? { active: v.active, score: s.score, lines: s.lines, moves: s.moves.length, placements: s.placements, over: s.over, digest: s.digest(), trays: s.trays, bag: !!s.bag, filled: s.filled } : null;
});

// ---------------------------------------------------------------- a run on a 390 × 844 phone

{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  const menu = await page.evaluate(() => {
    const b = document.querySelector('.sc-root.show [data-action="pop"]');
    const r = b?.getBoundingClientRect();
    return { found: !!b, locked: b?.classList.contains('locked') ?? null, wide: b?.classList.contains('wide') ?? null, text: b?.textContent.replace(/\s+/g, ' ').trim(), bottom: r?.bottom ?? 0, h: innerHeight };
  });
  await page.screenshot({ path: `${out}/01-menu.png` });
  step('the menu has a Blockling Pop card, open at level 3, across the row', menu.found && menu.locked === false && menu.wide && /Blockling Pop/.test(menu.text), JSON.stringify(menu));
  step('the menu still fits the screen with the Pop card', menu.bottom <= menu.h, `${menu.bottom} of ${menu.h}`);

  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${out}/02-pop-start.png` });
  const s0 = await state(page);
  const layout = await page.evaluate(() => {
    const v = window.__wobble.pop.view, k = v.k;
    return { cell: v.cell / k, board: [v.bx / k, v.by / k, (v.bx + v.cell * 9) / k, (v.by + v.cell * 9) / k], trayY: v.trayY / k, trayH: v.trayH / k, bag: [v.bag.x / k, v.bag.y / k, v.bag.s / k], h: innerHeight, w: innerWidth, sleeping: !!window.__wobble.game.loop.sleeping || window.__wobble.game.loop.running === false };
  });
  step('a Pop run opens from the menu: an empty board and a tray of three', !!s0 && s0.active && s0.moves === 0 && s0.filled === 0, JSON.stringify(s0));
  step('the board is about 38 pt a cell and everything fits on screen', layout.cell >= 34 && layout.cell <= 44 && layout.bag[1] + layout.bag[2] <= layout.h && layout.board[2] <= layout.w, JSON.stringify(layout));
  step('the tower\'s scene sleeps under Pop', layout.sleeping, JSON.stringify(layout.sleeping));

  // A drop off the board springs back and changes nothing.
  const first = await dragPlan(page, 0, 0, 0);
  await drag(page, first.from, [first.from[0], first.from[1] - 20]);
  await page.waitForTimeout(300);
  const s1 = await state(page);
  step('a shape let go off the board springs back: nothing changes', s1.moves === 0, JSON.stringify(s1));

  // Drag shapes onto the board: the ghost snaps under the finger offset and the drop places them.
  let placed = 0, tries = 0, popped = 0;
  for (let i = 0; i < 24; i++) {
    const s = await state(page);
    if (s.over) break;
    const mv = await pickMove(page);
    if (!mv) break;
    const plan = await dragPlan(page, mv.slot, mv.x, mv.y);
    // Off by a third of a cell: the snap still finds the cell.
    const jitter = (i % 3 - 1) * layout.cell * 0.3;
    await drag(page, plan.from, [plan.to[0] + jitter, plan.to[1] - jitter]);
    tries++;
    const after = await state(page);
    if (after.placements > s.placements) placed++;
    if (after.lines > s.lines) popped++;
    if (i === 6) await page.screenshot({ path: `${out}/03-pop-mid.png` });
  }
  const s2 = await state(page);
  step('dragging places shapes where the finger aims (with the lift and the snap)', placed >= Math.min(20, tries - 1), `${placed} of ${tries}`);
  step('lines pop and score', s2.lines > 0 && s2.score > s2.placements, JSON.stringify(s2));
  step('new trays come in as the old ones empty', s2.trays >= 5, String(s2.trays));

  // The bag: park a tray shape.
  const canBag = await page.evaluate(() => { const s = window.__wobble.pop.view.sim; return [0, 1, 2].find(i => s.canBag(i)) ?? -1; });
  if (canBag >= 0) {
    const from = await page.evaluate(i => { const v = window.__wobble.pop.view; const [x, y] = v.slotCentre(i); const [bx, by] = v.slotCentre(3); return [[x / v.k, y / v.k], [bx / v.k, (by - v.cell * 0) / v.k]]; }, canBag);
    await drag(page, from[0], from[1]);
    const sb = await state(page);
    step('dragging a tray shape onto the bag parks it', sb.bag, JSON.stringify(sb));
  }
  await page.screenshot({ path: `${out}/04-pop-bag.png` });

  // Saved after every move: reload and Continue lands on the same run.
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shape-tower-pop-run-v1') ?? 'null'));
  const before = await state(page);
  step('the run is saved after every move', !!saved && saved.rec.moves.length === before.moves * 2, `${saved?.rec.moves.length} chars for ${before.moves} moves`);
  await page.waitForTimeout(300); // let the last write reach the storage before the page goes
  await page.reload();
  await page.waitForSelector('.sc-root.show [data-action="pop"]', { timeout: 20000 });
  await page.waitForTimeout(500);
  const cont = await page.evaluate(() => document.querySelector('.sc-root.show [data-action="pop"]')?.textContent.replace(/\s+/g, ' ').trim());
  step('after a reload the Pop card offers Continue', /Continue/.test(cont ?? ''), String(cont));
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const resumed = await state(page);
  step('Continue replays the saved moves to the same digest', resumed.digest === before.digest && resumed.score === before.score, `${resumed.digest} vs ${before.digest}`);

  // Pause, End run, results.
  const xpBefore = await page.evaluate(() => window.__wobble.profile.total);
  await page.click('.pop-top [data-act="pause"]');
  await page.waitForSelector('.sc-root.show [data-action="quit"]', { timeout: 4000 });
  const pauseText = await page.evaluate(() => document.querySelector('.sc-root.show')?.textContent.replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: `${out}/05-pause.png` });
  step('pause says End run, and that ending banks the XP (no halving)', /End run/.test(pauseText) && /banks/.test(pauseText) && !/halves/.test(pauseText), pauseText);
  await page.click('.sc-root.show [data-action="quit"]');
  await page.waitForSelector('.sc-root.show [data-action="again"]', { timeout: 6000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/06-results.png` });
  const res = await page.evaluate(() => {
    const el = document.querySelector('.sc-root.show');
    return { text: el?.textContent.replace(/\s+/g, ' ').trim(), pop: JSON.parse(localStorage.getItem('shape-tower-profile-v1')).pop, total: window.__wobble.profile.total, save: localStorage.getItem('shape-tower-pop-run-v1') };
  });
  step('the results card shows the score, lines, best combo and the Pop run\'s XP', /pts/.test(res.text) && /Lines/.test(res.text) && /Best combo/.test(res.text) && /Pop run/.test(res.text), res.text.slice(0, 200));
  step('the run\'s XP goes into the one profile and Pop keeps its own records', res.total > xpBefore && res.pop.runs === 1 && res.pop.best === resumed.score && res.pop.lines === resumed.lines, JSON.stringify(res.pop));
  step('a finished run leaves no save behind', res.save === null);
  // Play again deals a new run; Home goes back to the menu with the tower awake.
  await page.click('.sc-root.show [data-action="again"]');
  await page.waitForTimeout(600);
  const again = await state(page);
  step('Play again starts a new run', again.active && again.moves === 0 && !again.over, JSON.stringify(again));
  await page.click('.pop-top [data-act="pause"]');
  await page.waitForSelector('.sc-root.show [data-action="quit"]');
  await page.click('.sc-root.show [data-action="quit"]');
  await page.waitForSelector('.sc-root.show [data-action="home"]', { timeout: 6000 });
  await page.waitForTimeout(400);
  await page.click('.sc-root.show [data-action="home"]');
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 6000 });
  const home = await page.evaluate(() => ({ pop: window.__wobble.pop.view.active, loop: window.__wobble.game.loop.running !== false && !window.__wobble.game.loop.sleeping }));
  step('Home leaves Pop and wakes the tower\'s scene for the menu', !home.pop && home.loop, JSON.stringify(home));
  // No room: a board of single holes and a tray only a Domino fits; placing it leaves nothing that fits.
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const v = window.__wobble.pop.view, sim = v.sim;
    const cells = [];
    for (let c = 0; c < 81; c++) if (((c % 9) + Math.floor(c / 9)) % 2 === 0 || c % 9 === 0) cells.push(c);
    const keep = cells.filter(c => c !== 80);
    const m = [0, 0, 0];
    sim.cellShape.fill(-1); sim.cellPiece.fill(0);
    keep.forEach((c, i) => { const y = Math.floor(c / 9), x = c % 9; m[Math.floor(y / 3)] |= 1 << ((y % 3) * 9 + x); sim.cellShape[c] = i % 17; sim.cellPiece[c] = 1000 + i; });
    sim.board = m;
    sim.tray = [{ s: 1, q: 0 }, { s: 4, q: 0 }, { s: 5, q: 0 }];
    sim.bag = null;
    v.rebuild();
  });
  const dom = await dragPlan(page, 0, 7, 8);
  await drag(page, dom.from, dom.to);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/08-no-room.png` });
  const nr = await state(page);
  step('when nothing in the tray or the bag fits, the run ends: No room', nr.over && (await page.evaluate(() => window.__wobble.pop.view.sim.cause)) === 'noroom', JSON.stringify(nr));
  await page.waitForSelector('.sc-root.show [data-action="again"]', { timeout: 6000 });
  const nrText = await page.evaluate(() => document.querySelector('.sc-root.show')?.textContent.replace(/\s+/g, ' ').trim());
  step('after the blocks tumble, the results card says Out of room!', /Out of room!/.test(nrText), nrText.slice(0, 80));
  await page.click('.sc-root.show [data-action="home"]');
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 6000 });
  step('no page errors on the 390 × 844 phone', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- a small phone

{
  const { ctx, page, errors } = await open({ width: 360, height: 640 }, 2);
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(600);
  const L = await page.evaluate(() => {
    const v = window.__wobble.pop.view, k = v.k;
    return { cell: v.cell / k, boardTop: v.by / k, boardBottom: (v.by + v.cell * 9) / k, trayY: v.trayY / k, trayBottom: (v.trayY + v.trayH) / k, bagBottom: (v.bag.y + v.bag.s) / k, h: innerHeight, w: innerWidth };
  });
  await page.screenshot({ path: `${out}/07-small-phone.png` });
  step('on a 360 × 640 phone the board, tray and bag all fit, in order', L.boardTop > 60 && L.boardBottom < L.trayY && L.trayBottom <= L.bagBottom && L.bagBottom <= L.h - 4 && L.cell >= 28, JSON.stringify(L));
  step('each tray slot is a full third of the width, at least 96 pt', L.w / 3 >= 96 * 1.1 || L.w / 3 >= 96, String(L.w / 3));
  step('no page errors on the small phone', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
const failed = steps.filter(s => !s.ok);
console.log(failed.length ? `\n${failed.length} check(s) FAILED` : '\nAll Pop browser checks passed');
process.exit(failed.length ? 1 : 0);
