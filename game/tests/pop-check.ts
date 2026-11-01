// Blockling Pop's rules without a browser (Pop plan §3-§5, §16): the shapes and their turns (the same
// cells Art draws), the 27 lines, placing and popping (rows, columns, squares, crossings, no gravity),
// every row of the scoring table and the worked examples, the combo and its sparks, All Clear,
// checkpoints and biomes, the bag's one swap per tray, No room, the deal's fairness rules, determinism
// and replays, then greedy and random bots over many seeds against the plan's first balance targets.
// Run: npm run pop:check

import { ART_SHAPES, pose } from '../../art/src/shapes.ts';
import { Rng } from '../src/sim/rng.ts';
import { CELLS, EMPTY, LINES, LINE_CELLS, type Mask, cellBit, count, fits, fullLines, isEmpty } from '../src/pop/sim/board.ts';
import { greedyMove, legalMoves, playOut, randomMove } from '../src/pop/sim/bot.ts';
import { type Slot, dealTray, slotFits, wholeTrayFits } from '../src/pop/sim/deal.ts';
import { BAG, PopSim, decodeIntent, encodeIntent, popBiome } from '../src/pop/sim/pop.ts';
import { decodeMoves, encodeMoves, recordOf, replay } from '../src/pop/sim/record.ts';
import { POP_KEYS, POP_SHAPES, SHAPE_BY_KEY } from '../src/pop/sim/shapes.ts';
import { POP_TUNING, comboMult, linePoints, shapeWeight } from '../src/pop/sim/tuning.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

const maskOf = (cells: number[]): Mask => {
  const m: Mask = [0, 0, 0];
  for (const c of cells) { const [w, b] = cellBit(c); m[w] |= b; }
  return m;
};
const row = (y: number, skip: number[] = []) => Array.from({ length: 9 }, (_, x) => y * 9 + x).filter(c => !skip.includes(c % 9));
const slotOf = (key: string, q = 0): Slot => ({ s: SHAPE_BY_KEY[key].id, q });
/** A sim set up by hand: this board, this tray, an empty bag. */
function staged(cells: number[], tray: (Slot | null)[], o: { combo?: number; sparks?: number } = {}): PopSim {
  const sim = new PopSim({ seed: 1 });
  sim.board = maskOf(cells);
  sim.cellShape.fill(-1);
  for (const c of cells) sim.cellShape[c] = 0;
  sim.tray = tray.map(s => (s ? { ...s } : null));
  sim.bag = null;
  sim.combo = o.combo ?? 0;
  sim.sparks = o.sparks ?? 2;
  sim.score = 0;
  return sim;
}

// ---------------------------------------------------------------- shapes

{
  check('17 shapes: the tower\'s 14 plus Pip, Trio and Elbow', POP_SHAPES.length === 17 && ['Pip', 'Trio', 'Elbow'].every(k => SHAPE_BY_KEY[k]));
  const turns = Object.fromEntries(POP_SHAPES.map(s => [s.key, s.turns.length]));
  const want: Record<string, number> = { O: 1, Pip: 1, Plus: 1, Domino: 2, Trio: 2, I: 2, S: 2, Z: 2, Plank: 2, L: 4, J: 4, T: 4, Elbow: 4, P: 4, U: 4, V: 4, Arch: 4 };
  check('distinct quarter turns: O, Pip, Plus one; Domino, Trio, I, S, Z, Plank two; the rest four', Object.entries(want).every(([k, n]) => turns[k] === n), JSON.stringify(turns));
  let same = true;
  for (const sh of POP_SHAPES) {
    if (!ART_SHAPES[sh.key]) continue;
    for (let q = 0; q < 4; q++) {
      const a = pose(sh.key, q), t = sh.turns[sh.byQ[q]];
      const key = (cs: [number, number][]) => cs.map(([x, y]) => y * 16 + x).sort((p, r) => p - r).join();
      if (a.w !== t.w || a.h !== t.h || key(a.cells) !== key(t.cells)) same = false;
    }
  }
  check('every turn has the cells Art\'s pose() draws', same);
  const sizes = POP_SHAPES.map(s => s.size);
  check('sizes run 1 to 5', Math.min(...sizes) === 1 && Math.max(...sizes) === 5);
  check('every placement mask covers exactly the shape\'s cells', POP_SHAPES.every(s => s.turns.every(t => t.places.every(p => count(p.m) === s.size))));
  check('the I-shape lying flat has 6 × 9 places', SHAPE_BY_KEY.I.turns[0].places.length === 54, String(SHAPE_BY_KEY.I.turns[0].places.length));
}

// ---------------------------------------------------------------- the board

{
  check('27 lines of 9 cells each, every cell in exactly 3', LINES.length === 27 && LINE_CELLS.every(l => l.length === 9)
    && Array.from({ length: CELLS }, (_, c) => LINE_CELLS.filter(l => l.includes(c)).length).every(n => n === 3));
  check('the masks agree with the cell lists', LINES.every((m, i) => count(m) === 9 && LINE_CELLS[i].every(c => fits(EMPTY(), maskOf([c])) && !fits(m, maskOf([c])))));
  const b = maskOf([...row(0), ...row(4, [3])]);
  check('a full row is a line; a row with a gap isn\'t', JSON.stringify(fullLines(b)) === '[0]');
  const sq = maskOf([30, 31, 32, 39, 40, 41, 48, 49, 50]);
  check('a full 3×3 square is a line (square 4 is the middle one)', JSON.stringify(fullLines(sq)) === '[22]');
}

// ---------------------------------------------------------------- placing and popping

{
  // A row one I-shape short: the I fills it.
  const sim = staged(row(8, [0, 1, 2, 3]), [slotOf('I', 0), slotOf('Pip'), slotOf('Pip')]);
  check('a shape can\'t go off the board or over a block', !sim.canPlace(0, 6, 0) && !sim.canPlace(0, 4, 8) && sim.canPlace(0, 0, 8));
  check('the preview says which lines would pop', JSON.stringify(sim.wouldPop(0, 0, 8)) === '[8]' && sim.wouldPop(0, 0, 7).length === 0);
  const ok = sim.apply({ t: 'place', slot: 0, x: 0, y: 8 });
  check('placing the I completes the row and it pops: the board is empty', ok && isEmpty(sim.board) && sim.lines === 1);
  check('the I scores its 4 cells + 100 for the line + 3,000 for the All Clear', sim.score === 3104, String(sim.score));
  check('an emptied board is an All Clear', sim.clears === 1 && sim.events.some(e => e.name === 'pop_all_clear'));
}
{
  // No gravity: blocks above a popped row stay where they are.
  const sim = staged([...row(8, [8]), 0, 9], [slotOf('Pip'), slotOf('Pip'), slotOf('Pip')]);
  sim.apply({ t: 'place', slot: 0, x: 8, y: 8 });
  check('no gravity: blocks above a popped row stay put', sim.lines === 1 && count(sim.board) === 2 && !fits(sim.board, maskOf([0])) && !fits(sim.board, maskOf([9])));
  check('a pop that leaves blocks is no All Clear', sim.clears === 0 && sim.score === 1 + 100, String(sim.score));
}
{
  // A cell in two full lines pops once but counts for both: a row and a column crossing at (4, 4).
  const cells = [...row(4, [4]), ...Array.from({ length: 9 }, (_, y) => y * 9 + 4).filter(c => c !== 40)];
  const sim = staged([...cells, 0], [slotOf('Pip'), slotOf('Pip'), slotOf('Pip')]);
  sim.apply({ t: 'place', slot: 0, x: 4, y: 4 });
  const ev = sim.events.find(e => e.name === 'pop_lines')!;
  check('a row and a column crossing: 2 lines, 17 cells pop, "Double!" pays 250', sim.lines === 2 && (ev.payload.cells as number[]).length === 17 && sim.score === 1 + 250, `${sim.lines} ${sim.score}`);
  check('the square they cross isn\'t full, so it doesn\'t count', (ev.payload.lines as number[]).length === 2);
}

// ---------------------------------------------------------------- scoring

{
  const T = POP_TUNING;
  check('pop points: 100, 250, 450, 700, then 1,000 + 300 a line over 5', [1, 2, 3, 4, 5, 6, 7].map(n => linePoints(T, n)).join() === '100,250,450,700,1000,1300,1600');
  check('the combo multiplier: ×1 at 1, ×1.5 at 3, ×2 at 5, ×2.25 at 6, ×4 from 13', [1, 3, 5, 6, 12, 13, 20].map(n => comboMult(T, n)).join() === '1,1.5,2,2.25,3.75,4,4');
  // Worked example 3: a T that pops a row and a square, third pop in a row: 4 + 375 = 379.
  // Row 8 missing (3,8),(4,8),(5,8); square 7 (cols 3-5, rows 6-8) missing those and (4,7): a T pointing up.
  const sq7 = [57, 58, 59, 66, 68];
  const sim = staged([...row(8, [3, 4, 5]), ...sq7, 0], [slotOf('T', 0), slotOf('Pip'), slotOf('Pip')], { combo: 2 });
  const ok = sim.apply({ t: 'place', slot: 0, x: 3, y: 7 });
  check('worked example: a T pops a row and a square on the third pop in a row: 4 + 375 = 379', ok && sim.score === 379 && sim.combo === 3, `${ok} ${sim.score} combo ${sim.combo}`);
  // Worked example 1: a Pip that pops nothing keeps the combo and spends a spark: 1 point.
  const sim2 = staged([0], [slotOf('Pip'), slotOf('Pip'), slotOf('Pip')], { combo: 4 });
  sim2.apply({ t: 'place', slot: 0, x: 8, y: 8 });
  check('worked example: a Pip that pops nothing scores 1 and spends a spark, the combo lives', sim2.score === 1 && sim2.combo === 4 && sim2.sparks === 1);
  sim2.apply({ t: 'place', slot: 1, x: 7, y: 8 });
  check('a second placement without a pop spends the last spark', sim2.combo === 4 && sim2.sparks === 0);
  sim2.apply({ t: 'place', slot: 2, x: 6, y: 8 });
  check('a third in a row ends the combo (and the sparks refill)', sim2.combo === 0 && sim2.sparks === 2 && sim2.events.some(e => e.name === 'pop_combo_end'));
  // Worked example 4: a Plus that pops a row, a column and a square and empties the board, sixth pop: 5 + 1,012 + 3,000.
  // Plus centred at (4,4): cells (4,3), (3,4), (4,4), (5,4), (4,5). Row 4, column 4 and square 4 full without them.
  const r4 = row(4, [3, 4, 5]), c4 = Array.from({ length: 9 }, (_, y) => y * 9 + 4).filter(c => ![31, 40, 49].includes(c)), s4 = [30, 32, 48, 50];
  const sim3 = staged([...new Set([...r4, ...c4, ...s4])], [slotOf('Plus'), slotOf('Pip'), slotOf('Pip')], { combo: 5 });
  const ok3 = sim3.apply({ t: 'place', slot: 0, x: 3, y: 3 });
  check('worked example: a Plus pops a row, a column and a square, empties the board, sixth pop: 4,017', ok3 && sim3.score === 4017 && sim3.clears === 1, `${ok3} ${sim3.score}`);
  // A pop refills both sparks.
  const sim4 = staged(row(0, [8]), [slotOf('Pip'), slotOf('Pip'), slotOf('Pip')], { combo: 3, sparks: 0 });
  sim4.apply({ t: 'place', slot: 0, x: 8, y: 0 });
  check('any pop refills both sparks', sim4.sparks === 2 && sim4.combo === 4);
}

// ---------------------------------------------------------------- checkpoints and biomes

{
  check('biomes follow the tower\'s schedule: Treetops at CP 2, Orbit at 10, Moon at 13, Deep Cosmos from 22', popBiome(0) === 0 && popBiome(1) === 0 && popBiome(2) === 1 && popBiome(4) === 2
    && popBiome(10) === 5 && popBiome(13) === 6 && popBiome(22) === 9 && popBiome(60) === 9);
  const sim = staged(row(0, [8]), [slotOf('Pip'), slotOf('Pip'), slotOf('Pip')]);
  sim.lines = 15;
  sim.cp = 1;
  sim.apply({ t: 'place', slot: 0, x: 8, y: 0 });
  check('the 16th line claims checkpoint 2 and enters Treetops', sim.cp === 2 && sim.events.some(e => e.name === 'pop_checkpoint' && e.payload.n === 2) && sim.events.some(e => e.name === 'biome_entered' && e.payload.id === 1));
  check('shapes open by checkpoint: S and Z at 2, Plank at 4, P/U/V at 6, Arch and Plus at 10', shapeWeight(POP_TUNING, 'S', 1) === 0 && shapeWeight(POP_TUNING, 'S', 2) > 0
    && shapeWeight(POP_TUNING, 'Plank', 3) === 0 && shapeWeight(POP_TUNING, 'Plank', 4) > 0 && shapeWeight(POP_TUNING, 'U', 6) > 0 && shapeWeight(POP_TUNING, 'Plus', 9) === 0 && shapeWeight(POP_TUNING, 'Plus', 10) > 0);
}

// ---------------------------------------------------------------- the tray, the bag and No room

{
  const sim = new PopSim({ seed: 7 });
  check('a run starts with a tray of three and the next tray showing', sim.tray.every(Boolean) && sim.next.length === 3 && sim.trays === 1);
  const bagged = sim.tray[1]!;
  check('the bag takes a tray shape', sim.apply({ t: 'bag', slot: 1 }) && sim.bag?.s === bagged.s && sim.tray[1] === null);
  check('only one bag move per tray', !sim.canBag(0) && !sim.apply({ t: 'bag', slot: 0 }));
  // Place the bagged shape: that doesn't need the swap.
  const bt = sim.turn(BAG)!;
  const spot = bt.places.find(p => fits(sim.board, p.m))!;
  check('a bagged shape can go on the board any time', sim.apply({ t: 'place', slot: BAG, x: spot.x, y: spot.y }) && sim.bag === null);
  const next = sim.next.map(s => s.s).join();
  for (const i of [0, 2]) {
    const t = sim.turn(i)!;
    const p = t.places.find(pp => fits(sim.board, pp.m))!;
    sim.apply({ t: 'place', slot: i, x: p.x, y: p.y });
  }
  check('once the tray is empty, the next tray slides in and a new one is dealt', sim.trays === 2 && sim.tray.map(s => s!.s).join() === next && !sim.bagUsed);
  check('the bag swaps again with the new tray', sim.canBag(0));
  check('a refused move changes nothing', !sim.apply({ t: 'place', slot: 0, x: 9, y: 9 }) && sim.moves.length === 4);
}
{
  // No room: a board with only single-cell holes in a checker pattern, and a tray of big shapes.
  const cells: number[] = [];
  for (let c = 0; c < CELLS; c++) if ((c % 9 + Math.floor(c / 9)) % 2 === 0 || c % 9 === 0) cells.push(c);
  const sim = staged(cells, [slotOf('O'), slotOf('I'), null]);
  // Placing nothing changes nothing; ending the run is an intent too.
  check('No room is noticed after a move, before the player is stuck', sim.fitsAnywhere(0) === false && sim.fitsAnywhere(1) === false);
  const sim2 = staged(cells.filter(c => c !== 80 && c !== 79), [slotOf('Domino', 0), slotOf('O'), slotOf('I')]);
  sim2.apply({ t: 'place', slot: 0, x: 7, y: 8 });
  check('when nothing in the tray or the bag fits, the run ends: No room', sim2.over && sim2.cause === 'noroom' && sim2.events.some(e => e.name === 'pop_no_room') && sim2.events.some(e => e.name === 'run_over'),
    `over ${sim2.over} cause ${sim2.cause}`);
  check('a run that is over takes no more moves', !sim2.apply({ t: 'place', slot: 1, x: 0, y: 0 }));
  const sim3 = new PopSim({ seed: 3 });
  check('End run ends the run', sim3.apply({ t: 'end' }) && sim3.over && sim3.cause === 'end');
}

// ---------------------------------------------------------------- the deal

{
  const rng = new Rng(99);
  let rule1 = true, mercyOk = true, variety = true, budget = true, n = 0;
  const T = POP_TUNING;
  for (let k = 0; k < 400; k++) {
    // Random boards from empty to crowded.
    const fill = rng.int(70);
    const cells: number[] = [];
    for (let c = 0; c < CELLS; c++) if (rng.int(100) < fill) cells.push(c);
    let b = maskOf(cells);
    for (const id of fullLines(b)) { const L = LINES[id]; b = [b[0] & ~L[0], b[1] & ~L[1], b[2] & ~L[2]]; }
    const cp = rng.int(16), mercy = rng.int(2) === 0;
    const tray = dealTray({ board: b, cp, mercy, history: [], deal: new Rng(k), turns: new Rng(k + 1000), tuning: T });
    n++;
    if (!tray.some(s => slotFits(b, s))) rule1 = false;
    const ids = tray.map(s => s.s);
    const counts = ids.map(id => ids.filter(x => x === id).length);
    if (Math.max(...counts) >= 3 || (cp < T.pairCp && Math.max(...counts) >= 2)) variety = false;
    const cellsN = tray.reduce((a, s) => a + POP_SHAPES[s.s].size, 0);
    if (cellsN > (cp >= T.lateCp ? T.trayMaxLate : T.trayMax)) budget = false;
    if (mercy && count(b) < 20 && !wholeTrayFits(b, tray, 1e6)) mercyOk = false;
  }
  check(`deal rule 1: something always fits when dealt (${n} random boards)`, rule1);
  check('deal rule 2: with mercy on, an open board gets a whole tray that fits', mercyOk);
  check('deal rule 5: never three of a kind, no pairs before checkpoint 6', variety);
  check('deal rule 6: trays keep to the size budget', budget);
  const closed = ['S', 'Z', 'Plank', 'P', 'U', 'V', 'Arch', 'Plus'].map(k => SHAPE_BY_KEY[k].id);
  let early = true;
  for (let k = 0; k < 200; k++) {
    const tray = dealTray({ board: EMPTY(), cp: 0, mercy: true, history: [], deal: new Rng(k), turns: new Rng(k + 7), tuning: T });
    if (tray.some(s => closed.includes(s.s))) early = false;
  }
  check('only the start shapes are dealt before checkpoint 2', early);
  const day = ['O', 'T', 'L'];
  const dayTray = dealTray({ board: EMPTY(), cp: 0, mercy: false, history: [], deal: new Rng(5), turns: new Rng(6), tuning: T, set: [...day, 'Pip', 'Domino', 'Trio', 'Elbow'] });
  check('a shape set (Daily Pop) deals only its shapes', dayTray.every(s => [...day, 'Pip', 'Domino', 'Trio', 'Elbow'].includes(POP_KEYS[s.s])));
}

// ---------------------------------------------------------------- determinism and records

{
  check('intents encode to small numbers and back', [{ t: 'place', slot: 2, x: 4, y: 7 } as const, { t: 'bag', slot: 1 } as const, { t: 'end' } as const]
    .every(it => JSON.stringify(decodeIntent(encodeIntent(it))) === JSON.stringify(it)) && encodeIntent({ t: 'place', slot: 3, x: 8, y: 8 }) === 323);
  check('moves pack two characters each', decodeMoves(encodeMoves([0, 323, 330, 35]))!.join() === '0,323,330,35' && decodeMoves('zz!') === null);
  const a = new PopSim({ seed: 1234 }), b = new PopSim({ seed: 1234 });
  playOut(a, greedyMove);
  playOut(b, greedyMove);
  check('the same seed and the same bot give the same run, digest for digest', a.digest() === b.digest() && a.score === b.score && a.moves.join() === b.moves.join());
  const r = replay(recordOf(a));
  check('a record replays to the same board, score and digest', !!r && r.digest() === a.digest() && r.score === a.score && r.over === a.over);
  // Resume mid-run: replay the first half and carry on with the same moves.
  const half = recordOf(a);
  half.moves = half.moves.slice(0, Math.floor(half.moves.length / 4) * 2);
  const mid = replay(half)!;
  for (const n of a.moves.slice(half.moves.length / 2)) mid.apply(decodeIntent(n)!);
  check('a run resumed from its saved moves ends the same', mid.digest() === a.digest());
  const bad = recordOf(a);
  bad.moves = encodeMoves([...decodeMoves(bad.moves)!.slice(0, 3), 80, 80]);
  check('a tampered record is refused', replay(bad) === null || replay(bad)!.digest() !== a.digest());
  check('a record from other rules is refused', replay({ ...recordOf(a), v: 999 }) === null);
  const deals = (seed: number) => { const s = new PopSim({ seed }); return [...s.tray, ...s.next].map(x => `${x!.s}/${x!.q}`).join(); };
  check('a different seed deals differently', deals(1235) !== deals(1234));
}

// ---------------------------------------------------------------- bots against the balance targets

{
  const N = Number(process.env.POP_RUNS ?? 150);
  const t0 = performance.now();
  const runs: { placements: number; lines: number; score: number; clears: number; cp: number; combo: number }[] = [];
  let unfair = 0, pairs = 0, overEarly = 0, fitsOk = true;
  for (let i = 0; i < N; i++) {
    const sim = new PopSim({ seed: 1000 + i, newPlayer: i % 4 === 0 });
    sim.sink = {
      emit(name, p) {
        if (name !== 'pop_tray') return;
        const tray = p.tray as Slot[];
        const ids = tray.map(s => s.s);
        if (sim.cp < POP_TUNING.pairCp && new Set(ids).size < 3) pairs++;
        // Rule 1 holds for the new preview against the board it was dealt on.
        if (!(p.next as Slot[]).some(s => slotFits(sim.board, s))) unfair++;
      },
    };
    playOut(sim, s => {
      const mv = greedyMove(s);
      if (mv && !s.canPlace(mv.slot, mv.x, mv.y)) fitsOk = false;
      return mv;
    });
    if (sim.cause === 'noroom' && sim.placements < 30) overEarly++;
    runs.push({ placements: sim.placements, lines: sim.lines, score: sim.score, clears: sim.clears, cp: sim.cp, combo: sim.bestCombo });
  }
  const ms = performance.now() - t0;
  const med = (xs: number[]) => { const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  const sum = (f: (r: (typeof runs)[number]) => number) => runs.reduce((a, r) => a + f(r), 0);
  const lpp = sum(r => r.lines) / Math.max(1, sum(r => r.placements));
  check('greedy bot: every move it picks is legal', fitsOk);
  check('greedy bot: deal rule 1 held for every tray dealt', unfair === 0, `${unfair} unfair`);
  check('greedy bot: no pairs in a tray before checkpoint 6', pairs === 0, `${pairs}`);
  console.log(`INFO  greedy bot, ${N} runs in ${(ms / 1000).toFixed(1)} s (${(ms / Math.max(1, sum(r => r.placements))).toFixed(3)} ms a placement):`);
  console.log(`INFO    median placements ${med(runs.map(r => r.placements))} (target 120-180), median score ${med(runs.map(r => r.score))}, median lines ${med(runs.map(r => r.lines))}, median CPs ${med(runs.map(r => r.cp))}`);
  console.log(`INFO    lines per placement ${lpp.toFixed(3)} (target 0.30-0.40), All Clears per run ${(sum(r => r.clears) / N).toFixed(2)} (target ~0.33), No room inside 30 placements ${((overEarly / N) * 100).toFixed(1)}% (target < 5%)`);
  console.log(`INFO    best combo median ${med(runs.map(r => r.combo))}, XP-ish median ${med(runs.map(r => 6 * r.lines + 40 * r.cp + r.placements + 100 * r.clears))}`);
  check('greedy bot: runs last (median 40+ placements) and pop lines', med(runs.map(r => r.placements)) >= 40 && lpp > 0.15);
  check('greedy bot: No room inside 30 placements in under 10% of runs', overEarly / N < 0.1, `${overEarly}/${N}`);
  // The random bot loses fast but never breaks a rule.
  let randOk = true;
  const rng = new Rng(5);
  for (let i = 0; i < 100; i++) {
    const sim = new PopSim({ seed: 5000 + i });
    playOut(sim, s => randomMove(s, rng));
    if (!sim.over || legalMoves(sim).length && sim.cause === 'noroom') randOk = false;
  }
  check('random bot: 100 runs end cleanly (No room only when nothing fits)', randOk);
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll Pop checks passed');
process.exit(failures ? 1 : 0);
