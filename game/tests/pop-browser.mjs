// Plays Blockling Pop in the built game headless (Pop plan §3, §9, milestone 1): the Pop card on the
// menu at level 2, a run opened from it, shapes dragged from the tray onto the board with the finger
// below the shape (the ghost snaps, a drop off the board springs back), the bag, lines popping and
// the score, the run saved after every move and Continue after a reload landing on the same digest,
// pause with End run, and the results card paying the run's XP into the one profile. Then a smaller
// phone, to see the board, tray and bag fit; milestone 2's juice; and milestone 3's powers: the power
// bar, Undo, aiming Meteor and Sweep, Spin's taps, Fresh Deal, collecting a bubble, Second Wind's two
// taps, and No room waiting with End run. Last, a first Pop run's guide (the card, the hand, the tips),
// Pop's achievements and the profile's Pop stats. And Blake's 2026-11-01 notes: the top bar keeping inside
// the board frame on three phone widths, and split pieces merging into whole shapes (rules 3).
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
        // The first-run guide and its tips are their own check (milestone 3, part 2).
        pop: { seen: ['intro', 'bag', 'bubble', 'combo', 'next'] },
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

// ---------------------------------------------------------------- the top bar keeps inside the board's edges
// Blake's playtest (2026-11-01): on his 448 × 825 phone the area pill ("Meadow 3/8") stuck out past the
// board frame. The bar now lines up with the frame and the pill is two lines (count, then the area's name).

for (const vp of [{ width: 448, height: 825, dpr: 2.25 }, { width: 360, height: 640, dpr: 2 }, { width: 390, height: 844, dpr: 3 }]) {
  const { ctx, page, errors } = await open({ width: vp.width, height: vp.height }, vp.dpr);
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  const cases = [];
  for (const [count, area, score] of [[null, null, null], ['13/14', 'Stratosphere', '188,888'], ['12/13', 'Ringed Giant', '1,234,567']]) {
    cases.push(await page.evaluate(([count, area, score]) => {
      if (count) {
        document.querySelector('.pop-cp b').textContent = count;
        document.querySelector('.pop-cp small').textContent = area;
        document.querySelector('.pop-score b').textContent = score;
      }
      const v = window.__wobble.pop.view, k = v.k;
      const box = sel => { const r = document.querySelector(sel).getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom]; };
      const frame = [(v.bx - v.pad) / k, (v.bx + v.cell * 9 + v.pad) / k];
      const pill = box('.pop-cp'), num = box('.pop-cp b'), name = box('.pop-cp small'), sc = box('.pop-score b'), pause = box('.pop-top .ui-btn');
      const inside = (a, b) => a[0] >= b[0] - 0.5 && a[1] <= b[1] + 0.5 && a[2] >= b[2] - 0.5 && a[3] <= b[3] + 0.5;
      return {
        text: document.querySelector('.pop-cp').textContent.trim(),
        ok: pill[1] <= frame[1] + 0.5 && pause[0] >= frame[0] - 0.5 && inside(num, pill) && inside(name, pill) && pill[0] >= sc[1] && sc[0] >= pause[1],
        frame: frame.map(Math.round), pill: pill.map(Math.round), score: sc.slice(0, 2).map(Math.round), pause: pause.slice(0, 2).map(Math.round),
      };
    }, [count, area, score]));
    if (!count) await page.screenshot({ path: `${out}/08-top-bar-${vp.width}.png`, clip: { x: 0, y: 0, width: vp.width, height: 100 } });
  }
  step(`on a ${vp.width} × ${vp.height} phone the pause, score and area pill keep inside the board frame, the count and name inside the pill (long names, big scores too)`,
    cases.every(c => c.ok) && /^0\/\d+Meadow$/.test(cases[0].text), JSON.stringify(cases));
  if (vp.width === 448) {
    // Blake (2026-11-01 13:01): Pop's pause button had a see-through background; the tower's is filled off-white.
    // Pop's button must wear the tower's fill, border, corner, shadow and size (hud.ts .st-iconbtn).
    const look = await page.evaluate(() => {
      const keys = ['backgroundColor', 'borderTopWidth', 'borderTopStyle', 'borderTopColor', 'borderTopLeftRadius', 'boxShadow', 'width', 'height'];
      const css = el => { const s = getComputedStyle(el); return Object.fromEntries(keys.map(k => [k, s[k]])); };
      const tower = document.querySelector('[data-id="pause"].st-iconbtn');
      return { pop: css(document.querySelector('.pop-top [data-act="pause"]')), tower: tower ? css(tower) : null };
    });
    step('Pop\'s pause button looks like the tower\'s: filled off-white, same border, corner, shadow and 44 px size',
      !!look.tower && look.pop.backgroundColor === 'rgb(255, 247, 232)' && JSON.stringify(look.pop) === JSON.stringify(look.tower), JSON.stringify(look));
  }
  step(`no page errors on the ${vp.width} wide top bar`, errors.length === 0, errors.slice(0, 3).join(' | '));
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

// ---------------------------------------------------------------- split pieces merge (rules 3)
// Blake's playtest (2026-11-01): split pieces that touch merge into the biggest whole shape. The view
// keeps their old look while the pop plays, then they snap into one Blockling with a face and a flash.

{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  const at = (x, y) => y * 9 + x;
  // A Trio standing at x 0, Dominoes standing at x 1 and 2, Pips along the bottom row to x 7.
  await stage(page, [
    [at(0, 6), 2, 1], [at(0, 7), 2, 1], [at(0, 8), 2, 1],
    [at(1, 7), 1, 2], [at(1, 8), 1, 2], [at(2, 7), 1, 3], [at(2, 8), 1, 3],
    ...[3, 4, 5, 6, 7].map((x, i) => [at(x, 8), 0, 4 + i]),
  ], [{ s: 0, q: 0 }, { s: 4, q: 0 }, { s: 4, q: 0 }]);
  await page.evaluate(() => { window.__wobble.pop.view.sim.placements = 8; });
  const plan = await dragPlan(page, 0, 8, 8);
  await drag(page, plan.from, plan.to);
  const four = [at(0, 6), at(0, 7), at(1, 7), at(2, 7)];
  const look = () => page.evaluate(four => {
    const v = window.__wobble.pop.view, sim = v.sim;
    const comp = v.comps.find(c => c.cells.some(([x, y]) => y * 9 + x === four[0]));
    return { lines: sim.lines, sim: four.map(c => `${sim.cellShape[c]}:${sim.cellPiece[c]}`), comp: comp && { s: comp.s, piece: comp.piece, size: comp.size, face: comp.face }, comps: v.comps.length };
  }, four);
  const during = await look();
  await page.screenshot({ path: `${out}/09-merge-during.png` });
  await page.waitForTimeout(650);
  const after = await look();
  await page.screenshot({ path: `${out}/10-merge-after.png` });
  step('the pop splits the Trio and Dominoes, and the sim merges the touching bits into one J of four',
    during.lines === 1 && new Set(during.sim).size === 1 && during.sim[0].startsWith('7:-'), JSON.stringify(during.sim));
  step('while the pop plays the bits keep their old look (the Trio\'s two cells, its own piece)', during.comp?.s === 2 && during.comp.piece === 1 && during.comp.size === 2, JSON.stringify(during.comp));
  step('then they snap into one J Blockling with a face', after.comp?.s === 7 && after.comp.size === 4 && after.comp.face && after.comp.piece < 0, JSON.stringify(after.comp));
  step('no page errors with merging', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- Blake's evening notes (2026-11-01, rules 4)
// "I got to 5/5 meadow and it didn't take me to the next background": every checkpoint is an area now.
// "I'd like the background to animate kind of like it does in tower mode": Art's props move, and a new area
// climbs in; Reduce motion keeps the still postcard. "If there is a greater shape they can merge into it
// should happen": a placed shape merges with the pieces it touches.

{
  const { ctx, page, errors } = await open({ width: 448, height: 825 }, 2.25);
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  const sky = () => page.evaluate(() => {
    const v = window.__wobble.pop.view;
    return { biome: v.bg?.biome, still: v.bg?.still, probe: v.bg?.probe(), skies: document.querySelectorAll('.pop-sky').length, moving: [...document.querySelectorAll('.pop-sky-part.moving')].map(e => e.style.transform).join('|') };
  });
  const s0 = await sky();
  await page.waitForTimeout(700);
  const s1 = await sky();
  step('the Meadow sky is alive: Art\'s props drift, bob and spin (their places change over 0.7 s)', s0.biome === 0 && !s0.still && s0.probe.moving >= 3 && s0.moving !== s1.moving, JSON.stringify({ s0: s0.probe, moved: s0.moving !== s1.moving }));
  // Four lines popped, then a fifth: the Meadow's target. The bottom row waits for a Pip at x 8.
  const at = (x, y) => y * 9 + x;
  await stage(page, [...[0, 1, 2, 3, 4, 5, 6, 7].map((x, i) => [at(x, 8), 0, 1 + i])], [{ s: 0, q: 0 }, { s: 4, q: 0 }, { s: 4, q: 0 }]);
  await page.evaluate(() => { const v = window.__wobble.pop.view; v.sim.lines = 4; v.sim.placements = 8; v.hud(); });
  const pill0 = await page.textContent('.pop-cp');
  const plan = await dragPlan(page, 0, 8, 8);
  await drag(page, plan.from, plan.to);
  await page.waitForTimeout(900);
  const mid = await sky();
  await page.screenshot({ path: `${out}/11-climb-mid.png` });
  await page.waitForTimeout(1900);
  const end = await sky();
  const pill1 = await page.textContent('.pop-cp');
  await page.screenshot({ path: `${out}/12-treetops.png` });
  const sim1 = await page.evaluate(() => ({ cp: window.__wobble.pop.view.sim.cp, biome: window.__wobble.pop.view.sim.biome }));
  step('the pill reads 4/5 in the Meadow, and the 5th line takes the run to Treetops (checkpoint 1)', /4\/5\s*Meadow/.test(pill0.trim()) && sim1.cp === 1 && sim1.biome === 1 && /0\/6\s*Treetops/.test(pill1.trim()), JSON.stringify({ pill0, pill1, sim1 }));
  step('Treetops climbs in over the Meadow (both skies part-way), then the Meadow\'s is gone', mid.skies === 2 && mid.biome === 1 && end.skies === 1 && end.biome === 1 && end.probe.moving >= 3, JSON.stringify({ mid: [mid.skies, mid.biome], end: [end.skies, end.biome, end.probe] }));
  // A Pip placed beside a Pip: one Domino Blockling.
  await stage(page, [[at(4, 4), 0, 1]], [{ s: 0, q: 0 }, { s: 4, q: 0 }, { s: 4, q: 0 }]);
  await page.evaluate(() => { window.__wobble.pop.view.sim.placements = 1; });
  const pp = await dragPlan(page, 0, 5, 4);
  await drag(page, pp.from, pp.to);
  await page.waitForTimeout(450);
  const dom = await page.evaluate(c => {
    const v = window.__wobble.pop.view, sim = v.sim, comp = v.comps.find(k => k.cells.some(([x, y]) => y * 9 + x === c));
    return { sim: [sim.cellShape[c], sim.cellShape[c + 1], sim.cellPiece[c] === sim.cellPiece[c + 1]], comp: comp && { s: comp.s, size: comp.size, face: comp.face }, why: sim.events.find(e => e.name === 'pop_merge')?.payload.why };
  }, at(4, 4));
  await page.screenshot({ path: `${out}/13-place-merge.png` });
  step('a Pip placed beside a Pip merges into one Domino Blockling with a face', dom.why === 'place' && dom.sim[0] === 1 && dom.sim[1] === 1 && dom.sim[2] && dom.comp?.s === 1 && dom.comp.size === 2 && !!dom.comp.face, JSON.stringify(dom));
  step('no page errors with the live sky, the climb and placement merges', errors.length === 0, errors.slice(0, 3).join(' | '));
  // Reduce motion: the still postcard, no moving props.
  await page.evaluate(k => { const s = JSON.parse(localStorage.getItem(k) || '{}'); s.reduceMotion = true; localStorage.setItem(k, JSON.stringify(s)); }, 'shape-tower-settings-v1');
  await page.reload();
  await page.waitForSelector('.sc-root.show [data-action="play"]', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  const still = await sky();
  const card = await page.evaluate(() => !!document.querySelector('.pop-sky .pop-sky-card'));
  step('under Reduce motion the sky is the still postcard: no moving props', still.still === true && card && still.moving === '' && still.probe.moving === 0, JSON.stringify({ still, card }));
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
  // The armed button pulses (a scale animation), which Playwright waits out as "not stable", sometimes past
  // the 2.5 s window: a finger doesn't wait, so neither does this tap.
  await page.click(slotBtn(2), { force: true });
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

// ---------------------------------------------------------------- milestone 3, part 2: the guide, achievements and Pop stats

{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  // A player who has never played Pop: no Pop runs, no tips seen.
  await page.evaluate(() => {
    const p = JSON.parse(localStorage.getItem('shape-tower-profile-v1'));
    p.pop = { ...(p.pop ?? {}), runs: 0, seen: [] };
    localStorage.setItem('shape-tower-profile-v1', JSON.stringify(p));
  });
  await page.reload();
  await page.waitForSelector('.sc-root.show [data-action="pop"]', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => {
    const v = window.__wobble.pop.view, sim = v.sim;
    return { card: document.querySelector('.pop-intro')?.textContent.replace(/\s+/g, ' ').trim() ?? '', guide: sim.guide, filled: sim.filled, row8: Array.from({ length: 9 }, (_, x) => sim.cellShape[72 + x] >= 0 ? 1 : 0).join(''), first: sim.tray[0], seen: JSON.parse(localStorage.getItem('shape-tower-profile-v1')).pop.seen };
  });
  step('a first Pop run opens with one card, and the board starts with the bottom row one I short', /Drag shapes onto the board/.test(card.card) && card.guide && card.row8 === '111110000' && card.filled === 9 && card.first.s === 5 && card.seen.includes('intro'), JSON.stringify(card));
  await page.screenshot({ path: `${out}/17-guide-card.png` });
  await page.click('.pop-intro button');
  await page.waitForTimeout(900);
  const hand = await page.evaluate(() => ({ card: !!document.querySelector('.pop-intro'), hand: window.__wobble.pop.view.handAt >= 0 }));
  step('"Let\'s pop!" closes the card and the hand shows the first drag', !hand.card && hand.hand, JSON.stringify(hand));
  await page.screenshot({ path: `${out}/18-guide-hand.png` });
  const g = await dragPlan(page, 0, 5, 8);
  await drag(page, g.from, g.to);
  await page.waitForTimeout(250);
  const popped = await page.evaluate(() => {
    const v = window.__wobble.pop.view, p = JSON.parse(localStorage.getItem('shape-tower-profile-v1'));
    return { lines: v.sim.lines, clears: v.sim.clears, hand: v.handAt, toast: document.querySelector('.ui-achtoast')?.textContent ?? '', got: Object.keys(p.achievements).filter(id => id.startsWith('pop_')) };
  });
  step('the I in the gap pops the row (not a free All Clear), the hand goes, and Pop! is earned with a toast', popped.lines === 1 && popped.clears === 0 && popped.hand === -1 && popped.got.includes('pop_first') && /Pop!/.test(popped.toast), JSON.stringify(popped));
  await page.screenshot({ path: `${out}/19-first-pop.png` });

  // The combo tip, once, at a combo of 2: two Pips each finishing a row.
  const rows = [];
  for (let x = 0; x < 8; x++) { rows.push([x, 5, 1100 + x]); rows.push([9 + x, 6, 1200 + x]); }
  await stage(page, rows, [{ s: 0, q: 0 }, { s: 0, q: 0 }, { s: 4, q: 0 }]);
  await page.waitForTimeout(700);
  await page.evaluate(() => { const v = window.__wobble.pop.view; v.sim.combo = 0; v.intent({ t: 'place', slot: 0, x: 8, y: 0 }); v.intent({ t: 'place', slot: 1, x: 8, y: 1 }); });
  await page.waitForTimeout(250);
  const combo = await page.evaluate(() => ({ tip: document.querySelector('.pop-coach.show')?.textContent ?? '', combo: window.__wobble.pop.view.sim.combo, seen: JSON.parse(localStorage.getItem('shape-tower-profile-v1')).pop.seen }));
  step('the combo tip shows at the first combo of 2, and counts as seen', /Combo!/.test(combo.tip) && combo.combo === 2 && combo.seen.includes('combo'), JSON.stringify(combo));
  await page.screenshot({ path: `${out}/20-combo-tip.png` });
  // Any touch closes a tip.
  const mid = await cellXY(page, 40);
  await page.mouse.click(mid[0], mid[1]);
  await page.waitForTimeout(700);
  const closed = await page.evaluate(() => !document.querySelector('.pop-coach.show'));
  step('a touch anywhere closes the tip', closed);

  // The bag tip: an I that fits nowhere while the bag is free.
  const crowd = [];
  // Columns 2, 5 and 8 down to row 7, and two blocks in row 8: no gap 4 wide anywhere, and no line full.
  for (let c = 0; c < 81; c++) if ((c % 3 === 2 && c < 72) || c === 75 || c === 78) crowd.push([c, 4, 1300 + c]);
  // The I lying flat (whichever quarter turn that is), so the full columns leave it nowhere to go.
  const flatQ = await page.evaluate(() => { const sim = window.__wobble.pop.view.sim; for (let q = 0; q < 4; q++) { sim.tray = [null, { s: 5, q }, null]; if (sim.turn(1)?.h === 1) return q; } return 0; });
  await stage(page, crowd, [{ s: 0, q: 0 }, { s: 5, q: flatQ }, { s: 0, q: 0 }]);
  await page.evaluate(() => window.__wobble.pop.view.intent({ t: 'place', slot: 0, x: 0, y: 0 }));
  await page.waitForTimeout(250);
  const bagTip = await page.evaluate(() => {
    const v = window.__wobble.pop.view, el = document.querySelector('.pop-coach.show'), r = el?.getBoundingClientRect();
    return { tip: el?.textContent ?? '', fits: v.sim.fitsAnywhere(1), above: r ? r.bottom <= v.bag.y / v.k + 2 : false, through: el ? getComputedStyle(el).pointerEvents : '' };
  });
  step('the first shape that can\'t fit gets the bag tip, over the bag, and touches go through it', /bag/.test(bagTip.tip) && !bagTip.fits && bagTip.above && bagTip.through === 'none', JSON.stringify(bagTip));
  await page.screenshot({ path: `${out}/21-bag-tip.png` });

  // End the run: the results, then the profile opens on Pop's stats.
  await page.click('.pop-top [data-act="pause"]');
  await page.waitForSelector('.sc-root.show [data-action="quit"]');
  await page.click('.sc-root.show [data-action="quit"]');
  await page.waitForSelector('.sc-root.show .ui-summary', { timeout: 15000 });
  await page.waitForTimeout(400);
  const strip = await page.evaluate(() => document.querySelector('.sc-root.show .ui-summary')?.textContent ?? '');
  step('the results list the run\'s new achievements', /Pop!/.test(strip), strip.slice(0, 160));
  await page.click('.sc-root.show [data-action="profile"]');
  await page.waitForSelector('.sc-root.show .ui-profile', { timeout: 8000 });
  await page.waitForTimeout(300);
  const prof = await page.evaluate(() => {
    const vis = el => !!el && getComputedStyle(el).display !== 'none';
    const pop = document.querySelector('.sc-popstats'), tower = document.querySelector('.ui-profile .ui-stats:not(.sc-popstats)');
    return { tab: document.querySelector('.sc-statseg input:checked')?.value, pop: vis(pop), tower: vis(tower), text: pop?.textContent.replace(/\s+/g, ' ') ?? '' };
  });
  step('from Pop\'s results the profile opens on Pop\'s stats: best score, lines, combo, biome, All Clears, runs', prof.tab === 'pop' && prof.pop && !prof.tower && /Best score/.test(prof.text) && /Pop runs/.test(prof.text) && /1Pop runs/.test(prof.text), JSON.stringify(prof));
  await page.screenshot({ path: `${out}/22-profile-pop.png` });
  await page.click('.sc-statseg label:first-child');
  await page.waitForTimeout(150);
  const tow = await page.evaluate(() => ({ pop: getComputedStyle(document.querySelector('.sc-popstats')).display, tower: getComputedStyle(document.querySelector('.ui-profile .ui-stats:not(.sc-popstats)')).display }));
  step('the switch shows the tower\'s stats again', tow.pop === 'none' && tow.tower !== 'none', JSON.stringify(tow));
  await page.click('.sc-root.show [data-action="achievements"]');
  await page.waitForTimeout(400);
  const ach = await page.evaluate(() => document.querySelector('.sc-root.show')?.textContent.replace(/\s+/g, ' ') ?? '');
  step('the Achievements panel has a Blockling Pop group with Pop! earned', /Blockling Pop/.test(ach) && /Double Trouble/.test(ach) && /Pop!/.test(ach), ach.slice(ach.indexOf('Blockling Pop'), ach.indexOf('Blockling Pop') + 120));
  await page.screenshot({ path: `${out}/23-pop-achievements.png` });
  step('no page errors in the guide, achievement and stats checks', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ---------------------------------------------------------------- milestone 3: Pop's settings

{
  const { ctx, page, errors } = await open({ width: 390, height: 844 });
  await page.click('.sc-root.show [data-action="settings"]');
  await page.waitForTimeout(300);
  const group = await page.evaluate(() => document.querySelector('.sc-root.show')?.textContent.replace(/\s+/g, ' ') ?? '');
  step('Settings has a Blockling Pop group: shape above finger, tap to place, left-handed, pop preview, strong grid',
    ['Blockling Pop', 'Shape above finger', 'Tap to place', 'Left-handed', 'Pop preview', 'Strong grid'].every(w => group.includes(w)), group.slice(group.indexOf('Blockling Pop'), group.indexOf('Blockling Pop') + 110));
  await page.screenshot({ path: `${out}/24-pop-settings.png`, fullPage: true });
  // Left-handed, strong grid, tap mode and no lift, saved as the panel would.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('shape-tower-settings-v1') ?? '{}');
    localStorage.setItem('shape-tower-settings-v1', JSON.stringify({ ...s, popLeft: true, popGrid: true, popTap: true, popDrag: 'off', popPreview: false }));
  });
  await page.reload();
  await page.waitForSelector('.sc-root.show [data-action="pop"]', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.click('.sc-root.show [data-action="pop"]');
  await page.waitForFunction(() => window.__wobble.pop?.view?.active, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const lay = await page.evaluate(() => {
    const v = window.__wobble.pop.view, k = v.k, pw = document.querySelector('.pop-pw').getBoundingClientRect();
    return { bagRight: (v.bag.x + v.bag.s) / k, nextLeft: v.nextBox.x / k, nextRight: (v.nextBox.x + v.nextBox.w) / k, pwLeft: pw.left, pwRight: pw.right, w: innerWidth, laid: v.laidFor };
  });
  step('left-handed: the bag on the left, the next tray in the middle, the power slots on the right', lay.bagRight < lay.nextLeft && lay.nextRight < lay.pwLeft && lay.pwRight <= lay.w - 8 && lay.laid === 'true|true', JSON.stringify(lay));
  await page.screenshot({ path: `${out}/25-left-handed-grid.png` });
  // Tap mode: tap a shape, tap a cell, tap the ghost.
  await stage(page, [], [{ s: 4, q: 0 }, { s: 5, q: 0 }, { s: 0, q: 0 }]);
  const before = await state(page);
  const [sx, sy] = await page.evaluate(() => { const v = window.__wobble.pop.view, [x, y] = v.slotCentre(0); return [x / v.k, y / v.k]; });
  await page.mouse.click(sx, sy);
  await page.waitForTimeout(150);
  const lifted = await page.evaluate(() => { const h = window.__wobble.pop.view.held; return h ? { slot: h.slot, tap: h.tap, ghost: h.ghost } : null; });
  const c40 = await cellXY(page, 40);
  await page.mouse.click(c40[0], c40[1]);
  await page.waitForTimeout(150);
  const aimed = await page.evaluate(() => { const v = window.__wobble.pop.view, h = v.held, t = v.sim.turn(0); const [cx, cy] = h ? v.heldCentre(h, t) : [0, 0]; return { ghost: h?.ghost, onFinger: h ? Math.abs(cy - (v.by + 4.5 * v.cell)) < 1 && Math.abs(cx - (v.bx + 4.5 * v.cell)) < 1 : false, lines: h?.lines.length }; });
  const placedBefore = before.placements;
  await page.mouse.click(c40[0], c40[1]);
  await page.waitForTimeout(250);
  const placed = await state(page);
  step('tap mode: a tap lifts the O, a tap on the board aims it there (centred, lift Off), a tap on its ghost places it',
    lifted?.slot === 0 && lifted.tap && !lifted.ghost && aimed.ghost && aimed.onFinger && placed.placements === placedBefore + 1 && placed.filled === 4, JSON.stringify({ lifted, aimed, placements: placed.placements, filled: placed.filled }));
  step('no page errors with Pop\'s settings on', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

await browser.close();
server.close();
const failed = steps.filter(s => !s.ok);
console.log(failed.length ? `\n${failed.length} check(s) FAILED` : '\nAll Pop browser checks passed');
process.exit(failed.length ? 1 : 0);
