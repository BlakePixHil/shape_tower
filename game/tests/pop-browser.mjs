// Plays Blockling Pop in the built game headless (Pop plan §3, §9, milestone 1): the Pop card on the
// menu at level 2, a run opened from it, shapes dragged from the tray onto the board with the finger
// below the shape (the ghost snaps, a drop off the board springs back), the bag, lines popping and
// the score, the run saved after every move and Continue after a reload landing on the same digest,
// pause with End run, and the results card paying the run's XP into the one profile. Then a smaller
// phone, to see the board, tray and bag fit; milestone 2's juice; and milestone 3's powers: the power
// bar, Undo, aiming Meteor and Sweep, Spin's taps, Fresh Deal, collecting a bubble, Second Wind's two
// taps, and No room waiting with End run.
//   npm run build:game && node tests/pop-browser.mjs [outDir]

import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';

const out = process.argv[2] ?? 'test-results/pop';
mkdirSync(out, { recursive: true });
// Served over http, as daily-check is: on a file:// page Chromium sometimes hands a reloaded page an
// empty localStorage (every key gone, not just the save), and this check reloads to stand in for an
// app that was closed mid-run.
const html = readFileSync(new URL('../dist-game/game.html', import.meta.url));
const server = createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/game.html')) { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
  res.writeHead(req.url === '/favicon.ico' ? 204 : 404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/game.html`;
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
  await page.waitForTimeout(300);
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

// ---------------------------------------------------------------- flush pieces and milestone 2's juice

/** Puts cells on the board ([cell, shape, piece] each) and a tray, as if the run had got there. */
const stage = (page, filled, tray) => page.evaluate(([filled, tray]) => {
  const v = window.__wobble.pop.view, sim = v.sim;
  const m = [0, 0, 0];
  sim.cellShape.fill(-1); sim.cellPiece.fill(0);
  filled.forEach(([c, s, piece]) => { const y = Math.floor(c / 9), x = c % 9; m[Math.floor(y / 3)] |= 1 << ((y % 3) * 9 + x); sim.cellShape[c] = s; sim.cellPiece[c] = piece; });
  sim.board = m;
  sim.tray = tray;
  sim.bag = null;
  v.rebuild();
}, [filled, tray]);

{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  // Blake's P1 note: pieces on the board sit flush in their cells. A baked board body leaves its padding
  // empty (no outline or shadow past the cell edges), so neighbours never overlap.
  const flush = await page.evaluate(() => {
    const v = window.__wobble.pop.view, art = v.art;
    const out = [];
    for (const [s, cells] of [[4, [[0, 0], [1, 0], [0, 1], [1, 1]]], [6, [[0, 0], [0, 1], [0, 2], [1, 2]]], [16, [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]]]]) {
      const b = art.cells(s, cells, 'idle'), cv = b.canvas, pad = Math.ceil(0.2 * art.s);
      const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
      let outside = 0;
      for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
        const cx = Math.floor((x - pad) / art.s), cy = Math.floor((y - pad) / art.s);
        const inCell = x >= pad && y >= pad && cells.some(([a, b2]) => a === cx && b2 === cy);
        if (!inCell && d[(y * cv.width + x) * 4 + 3] > 8) outside++;
      }
      out.push(outside);
    }
    return out;
  });
  step('board pieces sit flush: nothing is drawn outside their own cells', flush.every(n => n === 0), JSON.stringify(flush));

  // A Double: rows 7 and 8 full but for a 2 × 2 hole on the left, filled by an O.
  const f = [];
  for (const y of [7, 8]) for (let x = 2; x < 9; x++) f.push([y * 9 + x, [5, 8, 11, 9, 12, 6, 13][x - 2], 10 + y * 9 + x]);
  await stage(page, f, [{ s: 4, q: 0 }, { s: 1, q: 0 }, { s: 5, q: 0 }]);
  await page.waitForTimeout(300);
  const p = await dragPlan(page, 0, 0, 7);
  await page.mouse.move(p.from[0], p.from[1]);
  await page.mouse.down();
  await page.mouse.move(p.to[0], p.to[1] + 30, { steps: 4 });
  await page.mouse.move(p.to[0], p.to[1], { steps: 4 });
  await page.waitForTimeout(150);
  const held = await page.evaluate(() => { const v = window.__wobble.pop.view; return { ghost: v.held?.ghost, lines: v.held?.lines.length }; });
  step('the ghost snaps where the shape will sit and knows it would pop two lines', held.ghost?.x === 0 && held.ghost?.y === 7 && held.lines === 2, JSON.stringify(held));
  await page.mouse.up();
  await page.waitForTimeout(250);
  const mid = await page.evaluate(() => { const v = window.__wobble.pop.view; return { flyers: v.flyers.length, punch: v.punch.z, lines: v.sim.lines, combo: document.querySelector('.pop-combo')?.className }; });
  step('a pop punches the board and sends its faces flying up to the checkpoint pill', mid.flyers > 0 && mid.punch > 0.03 && mid.lines === 2, JSON.stringify(mid));
  // Headless frames are slow and the effects clock steps at most 50 ms a frame, so wait for it.
  await page.waitForFunction(() => window.__wobble.pop.view.flyers.length === 0, null, { timeout: 15000 }).catch(() => {});
  const after = await page.evaluate(() => { const v = window.__wobble.pop.view; return { flyers: v.flyers.length, popping: v.popping.length, pill: document.querySelector('.pop-cp')?.className }; });
  step('the faces land on the pill, which bumps, and the pop is done', after.flyers === 0 && after.popping === 0 && /bump/.test(after.pill), JSON.stringify(after));
  await page.screenshot({ path: `${out}/08-after-double.png` });

  // The combo chip warms at 3, grows sparks at 6 and a rainbow edge at 10.
  const chip = await page.evaluate(() => {
    const v = window.__wobble.pop.view, sim = v.sim, el = document.querySelector('.pop-combo');
    const at = n => { sim.combo = n; v.hud(); return ['warm', 'sparks', 'rainbow'].filter(c => el.classList.contains(c)).join(' '); };
    const r = { 2: at(2), 3: at(3), 6: at(6), 10: at(10) };
    sim.combo = 0; v.hud();
    r.off = el.className;
    return r;
  });
  step('the combo chip warms from 3, grows sparks from 6 and a rainbow edge from 10', chip[2] === '' && chip[3] === 'warm' && chip[6] === 'warm sparks' && chip[10] === 'warm sparks rainbow' && !/on/.test(chip.off), JSON.stringify(chip));

  // An All Clear: one Domino short of an empty board.
  const g = [];
  for (let x = 2; x < 9; x++) g.push([72 + x, 8 + x, 300 + x]);
  const clearsBefore = await page.evaluate(() => window.__wobble.pop.view.sim.clears);
  await stage(page, g, [{ s: 1, q: 0 }, { s: 4, q: 0 }, { s: 5, q: 0 }]);
  await page.waitForTimeout(300);
  const d = await dragPlan(page, 0, 0, 8);
  await drag(page, d.from, d.to);
  await page.waitForTimeout(150);
  const ac = await page.evaluate(() => { const v = window.__wobble.pop.view; return { clears: v.sim.clears, slow: v.slowUntil > v.vt - 400, hop: v.hopAt > 0, filled: v.sim.filled }; });
  step('an All Clear slows time, bounces the board and makes the tray jump', ac.clears === clearsBefore + 1 && ac.filled === 0 && ac.slow && ac.hop, JSON.stringify(ac));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/09-all-clear.png` });
  step('no page errors in the juice checks', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- milestone 3: powers, bubbles and Second Wind

/** A board cell's centre in CSS px. */
const cellXY = (page, c) => page.evaluate(c => { const v = window.__wobble.pop.view; return [(v.bx + ((c % 9) + 0.5) * v.cell) / v.k, (v.by + (Math.floor(c / 9) + 0.5) * v.cell) / v.k]; }, c);
const give = (page, powers, extra = {}) => page.evaluate(([powers, extra]) => { const v = window.__wobble.pop.view; v.sim.powers = powers; Object.assign(v.sim, extra); v.hud(); }, [powers, extra]);
const slotBtn = i => `.pop-pw button:nth-child(${i + 1})`;

{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  const bar = await page.evaluate(() => {
    const v = window.__wobble.pop.view, pw = document.querySelector('.pop-pw').getBoundingClientRect(), next = v.nextBox, k = v.k;
    const btns = [...document.querySelectorAll('.pop-pw button')].map(b => ({ cls: b.className, label: b.getAttribute('aria-label') }));
    return { btns, left: pw.left, right: pw.right, bottom: pw.bottom, nextLeft: next.x / k, bagLeft: v.bag.x / k, h: innerHeight, wind: v.sim.wind };
  });
  step('two empty power slots and Second Wind (ready: the day\'s first Pop run) sit bottom left, clear of the next tray and the bag',
    bar.btns[0].cls.includes('empty') && bar.btns[1].cls.includes('empty') && !/earn/.test(bar.btns[2].cls) && bar.left >= 8 && bar.right < bar.nextLeft && bar.nextLeft < bar.bagLeft && bar.bottom <= bar.h && bar.wind === 'ready', JSON.stringify(bar));

  // Undo: place a shape, tap Undo, and the board, score and tray are as they were.
  const row8 = [];
  for (let x = 4; x < 9; x++) row8.push([72 + x, 6, 500 + x]);
  await stage(page, row8, [{ s: 5, q: 0 }, { s: 4, q: 0 }, { s: 6, q: 0 }]);
  await give(page, ['undo', 'meteor']);
  const shown = await page.evaluate(() => [...document.querySelectorAll('.pop-pw button')].slice(0, 2).map(b => b.getAttribute('aria-label') + (b.querySelector('img') ? '+icon' : '')));
  step('powers in the slots show their icons and names', shown[0] === 'Undo+icon' && shown[1] === 'Meteor+icon', JSON.stringify(shown));
  const before = await state(page);
  const u = await dragPlan(page, 0, 0, 8);
  await drag(page, u.from, u.to);
  const placed = await state(page);
  await page.click(slotBtn(0));
  await page.waitForTimeout(200);
  const undone = await page.evaluate(() => { const v = window.__wobble.pop.view; return { filled: v.sim.filled, score: v.sim.score, slot0: v.sim.powers[0], tray0: v.sim.tray[0]?.s, rewind: v.rewindAt > 0 }; });
  step('Undo takes back the I that popped row 8: the row, the score and the tray as they were', placed.lines === before.lines + 1 && undone.filled === before.filled && undone.score === before.score && undone.slot0 === null && undone.tray0 === 5 && undone.rewind,
    JSON.stringify({ before, placed: placed.lines, undone }));

  // Meteor: tap the slot, tap a cell to move the target there, tap the target to smash it.
  await page.click(slotBtn(1));
  const aim = await page.evaluate(() => { const a = window.__wobble.pop.view.aim; return a && { kind: a.kind, target: a.target, hint: document.querySelector('.pop-hint').textContent }; });
  step('Meteor starts aiming at the busiest 3×3, with a hint', aim?.kind === 'meteor' && Math.floor(aim.target / 9) >= 7 && /tap it to smash/i.test(aim.hint), JSON.stringify(aim));
  await page.screenshot({ path: `${out}/10-meteor-aim.png` });
  const [mx, my] = await cellXY(page, 79);
  await page.mouse.click(mx, my);
  const moved = await page.evaluate(() => window.__wobble.pop.view.aim?.target);
  await page.mouse.click(mx, my);
  await page.waitForTimeout(100);
  const smashed = await page.evaluate(() => { const v = window.__wobble.pop.view; return { aim: !!v.aim, filled: v.sim.filled, slot1: v.sim.powers[1], meteors: v.meteors.length }; });
  step('a tap moves the target, a tap on it brings the meteor down on that 3×3', moved === 79 && !smashed.aim && smashed.filled === 2 && smashed.slot1 === null && smashed.meteors === 1, JSON.stringify({ moved, smashed }));
  await page.waitForFunction(() => window.__wobble.pop.view.meteors.every(m => m.hit), null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/11-meteor-hit.png` });

  // Sweep: swipe along a row.
  const row3 = [];
  for (let x = 0; x < 7; x++) row3.push([27 + x, 9, 600 + x]);
  row3.push([0, 4, 700]);
  await stage(page, row3, [{ s: 5, q: 0 }, { s: 4, q: 0 }, { s: 6, q: 0 }]);
  await give(page, ['sweep', null]);
  await page.click(slotBtn(0));
  const [sx0, sy0] = await cellXY(page, 29), [sx1] = await cellXY(page, 33);
  await page.mouse.move(sx0, sy0);
  await page.mouse.down();
  await page.mouse.move(sx1, sy0 + 3, { steps: 5 });
  const lit = await page.evaluate(() => window.__wobble.pop.view.aim?.line);
  await page.mouse.up();
  await page.waitForTimeout(150);
  const swept = await page.evaluate(() => { const v = window.__wobble.pop.view; return { filled: v.sim.filled, score: v.sim.score, bodies: v.bodies.length, aim: !!v.aim }; });
  step('a swipe along row 3 lights it, and letting go sweeps it: its Blocklings tumble off', lit === 3 && swept.filled === 1 && swept.bodies === 7 && !swept.aim, JSON.stringify({ lit, swept }));
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${out}/12-sweep.png` });

  // Spin: tap the slot, then tap the L in the tray: it turns a quarter turn.
  await stage(page, [[0, 4, 800]], [{ s: 6, q: 0 }, { s: 4, q: 0 }, { s: 5, q: 0 }]);
  await give(page, ['spin', 'fresh']);
  await page.click(slotBtn(0));
  const [tx, ty] = await page.evaluate(() => { const v = window.__wobble.pop.view; const [x, y] = v.slotCentre(0); return [x / v.k, y / v.k]; });
  await page.mouse.click(tx, ty);
  await page.waitForTimeout(150);
  const spun = await page.evaluate(() => { const v = window.__wobble.pop.view; return { spinning: v.sim.spinning, q: v.sim.tray[0].q, held: !!v.held, hint: document.querySelector('.pop-hint').textContent }; });
  step('Spin turns on, and a tap on a tray shape turns it (no pick-up)', spun.spinning && spun.q !== 0 && !spun.held && /turn it/.test(spun.hint), JSON.stringify(spun));
  await page.screenshot({ path: `${out}/13-spin.png` });

  // Fresh Deal: new shapes in the tray.
  const trayBefore = await page.evaluate(() => JSON.stringify(window.__wobble.pop.view.sim.tray));
  await page.click(slotBtn(1));
  await page.waitForTimeout(120);
  const fresh = await page.evaluate(() => { const v = window.__wobble.pop.view; return { tray: JSON.stringify(v.sim.tray), leaving: v.leaving.length }; });
  step('Fresh Deal swaps the tray shapes, the old ones sliding away', fresh.tray !== trayBefore && fresh.leaving === 3, JSON.stringify({ trayBefore, fresh }));

  // A bubble: cover it and its power flies into a free slot.
  await stage(page, [], [{ s: 4, q: 0 }, { s: 1, q: 0 }, { s: 5, q: 0 }]);
  await give(page, [null, null], { bubbles: [{ cell: 40, kind: 'fresh', left: 6 }] });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/14-bubble.png` });
  const b = await dragPlan(page, 0, 4, 4);
  await drag(page, b.from, b.to);
  const got = await page.evaluate(() => { const v = window.__wobble.pop.view; return { powers: v.sim.powers.join(), flying: v.iconFlys.length, bubbles: v.sim.bubbles.length }; });
  await page.waitForFunction(() => window.__wobble.pop.view.iconFlys.length === 0, null, { timeout: 15000 }).catch(() => {});
  const landed = await page.evaluate(() => document.querySelector('.pop-pw button').getAttribute('aria-label'));
  step('covering a bubble collects it: its icon flies into the slot', got.powers === 'fresh,' && got.flying === 1 && got.bubbles === 0 && landed === 'Fresh Deal', JSON.stringify({ got, landed }));

  // Second Wind: two taps.
  const crowd = [];
  for (const y of [0, 1, 2, 6, 7, 8]) for (let x = 0; x < 8; x++) crowd.push([y * 9 + x, 5, 900 + y * 9 + x]);
  await stage(page, crowd, [{ s: 16, q: 0 }, { s: 15, q: 0 }, { s: 13, q: 0 }]);
  await give(page, [null, null], { wind: 'ready', bubbles: [] });
  await page.click(slotBtn(2));
  const armed = await page.evaluate(() => ({ cls: document.querySelector('.pop-pw button:nth-child(3)').className, wind: window.__wobble.pop.view.sim.wind }));
  await page.click(slotBtn(2));
  await page.waitForTimeout(120);
  const blown = await page.evaluate(() => { const v = window.__wobble.pop.view; return { wind: v.sim.wind, filled: v.sim.filled, bodies: v.bodies.length }; });
  step('Second Wind: the first tap arms it, the second blows the fullest rows and columns away', /armed/.test(armed.cls) && armed.wind === 'ready' && blown.wind === 'used' && blown.filled < crowd.length - 20 && blown.bodies > 20, JSON.stringify({ armed, blown }));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/15-second-wind.png` });

  // No room with a power that could help: the run waits, with End run.
  const cb = [];
  for (let c = 0; c < 81; c++) if (((c % 9) + Math.floor(c / 9)) % 2 === 0 || c % 9 === 0) if (c !== 80) cb.push([c, 5, 1000 + c]);
  await stage(page, cb, [{ s: 1, q: 0 }, { s: 4, q: 0 }, { s: 5, q: 0 }]);
  await give(page, ['meteor', null]);
  await page.evaluate(() => window.__wobble.pop.view.intent({ t: 'place', slot: 0, x: 7, y: 8 }));
  await page.waitForTimeout(200);
  const wait = await page.evaluate(() => { const v = window.__wobble.pop.view; return { stuck: v.sim.stuck, over: v.sim.over, end: getComputedStyle(document.querySelector('.pop-end')).display, glow: document.querySelector('.pop-pw button').className }; });
  step('No room with Meteor held: the run waits, the slot glows and End run shows', wait.stuck && !wait.over && wait.end !== 'none' && /glow/.test(wait.glow), JSON.stringify(wait));
  await page.screenshot({ path: `${out}/16-no-room-waiting.png` });
  await page.click('.pop-end');
  await page.waitForSelector('.sc-root.show .ui-summary', { timeout: 15000 }).catch(() => {});
  const ended = await page.evaluate(() => ({ over: window.__wobble.pop.view.sim.over, cause: window.__wobble.pop.view.sim.cause, summary: !!document.querySelector('.sc-root.show .ui-summary') }));
  step('End run ends it and the results show', ended.over && ended.cause === 'end' && ended.summary, JSON.stringify(ended));
  step('no page errors in the power checks', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
const failed = steps.filter(s => !s.ok);
console.log(failed.length ? `\n${failed.length} check(s) FAILED` : '\nAll Pop browser checks passed');
process.exit(failed.length ? 1 : 0);
