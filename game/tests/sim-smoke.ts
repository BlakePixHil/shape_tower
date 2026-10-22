// Quick headless checks of the sim (Gameplay's own; QA owns the real suites).
// Run: npm run sim:smoke

import { readFileSync } from 'node:fs';
import { Box2DEngine } from '../src/sim/engine/box2d.ts';
import { colliderBoxes, rotQ } from '../src/sim/shapes.ts';
import { runBench } from '../src/sim/bench.ts';
import { createSim, replay, restore, useRapier } from '../src/sim/testApi.ts';
import { DEFAULT_TUNING, bondDelayFor, cosmosScale, fallSpeedFor, gustFor, hazardsFor, maxSlabWidthFor, minSlabWidthFor, mortarStrengthFor, rampFor, setStreakFor, slackFor, startWaitFor, type Tuning } from '../src/sim/tuning.ts';

if (process.env.SIM_ENGINE === 'rapier') await useRapier();

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

// T1: 8 × 8 wall of O pieces stands for 60 s (Mortar on and off). The line is moved up so the
// wall stays wood instead of claiming checkpoint 1.
for (const mortar of [true, false]) {
  const t = createSim({ tuning: { mortar, firstGap: 20 } });
  const ids: number[] = [];
  const start = new Map<number, [number, number]>();
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
    const x = -3 + col * 2, y = 1 + row * 2 + 0.001 * row;
    ids.push(t.placePiece({ shape: 'O', x, y }));
    start.set(ids[ids.length - 1], [x, y]);
  }
  t.step(60);
  const settledAt = new Map(t.pieces().map(p => [p.id, [p.x, p.y] as [number, number]]));
  t.step(3600);
  let maxDrift = 0;
  for (const p of t.pieces()) {
    const [x0, y0] = settledAt.get(p.id)!;
    maxDrift = Math.max(maxDrift, Math.hypot(p.x - x0, p.y - y0));
  }
  const states = new Set(t.pieces().map(p => p.state));
  check(`T1 8x8 O wall stands 60 s (mortar ${mortar ? 'on' : 'off'})`, maxDrift < 0.05, `max drift ${maxDrift.toFixed(4)}, states ${[...states]}`);
  if (mortar) check('T1 bonds formed', t.pieces().some(p => p.bonds > 0), `bonds ${t.pieces().reduce((a, p) => a + p.bonds, 0)}`);
  t.dispose();
}

// The wall made as wide as the 12-wide plinth, at the default line (8), claims checkpoint 1; its
// stone must not move.
{
  const t = createSim({});
  for (let row = 0; row < 4; row++) for (let col = 0; col < 6; col++) t.placePiece({ shape: 'O', x: -5 + col * 2, y: 1 + row * 2 + 0.001 * row });
  t.step(60);
  const before = new Map(t.pieces().map(p => [p.id, [p.x, p.y] as [number, number]]));
  t.step(600);
  const claim = t.drainEvents().find(e => e.name === 'checkpoint_claimed');
  let maxDrift = 0;
  for (const p of t.pieces()) { const [x0, y0] = before.get(p.id)!; maxDrift = Math.max(maxDrift, Math.hypot(p.x - x0, p.y - y0)); }
  const allStone = t.pieces().every(p => p.state === 'stone');
  check('Wall at line height claims CP1 with grade S and its stone stays put', !!claim && claim.payload.grade === 'S' && allStone && maxDrift < 0.01, `grade ${claim?.payload.grade} width ${claim?.payload.width} drift ${maxDrift.toFixed(4)} allStone ${allStone}`);
  t.dispose();
}

// Ghost accuracy: drop each shape in each rotation onto the flat plinth; compare first contact to the ghost.
{
  let worst = 0, n = 0;
  for (const shape of ['I', 'O', 'T', 'L', 'J', 'S', 'Z']) {
    for (let rot = 0; rot < 4; rot++) {
      const t = createSim({});
      t.spawnControlled({ shape, rot });
      const g = t.ghost()!;
      t.drainEvents();
      let landed: any = null;
      for (let i = 0; i < 600 && !landed; i++) {
        t.step();
        landed = t.drainEvents().find(e => e.name === 'piece_landed')?.payload;
      }
      const err = landed ? Math.abs((landed.pose as any).y - (g.y ?? NaN)) + Math.abs((landed.pose as any).x - g.x) : Infinity;
      worst = Math.max(worst, err);
      n++;
      t.dispose();
    }
  }
  check(`Ghost touchdown matches first contact (${n} drops)`, worst < 0.002, `worst error ${worst.toExponential(2)} blocks`);
}

// Ghost tint: an O hanging 1.5 off the plinth edge is red; centred is ok. (On an 8-wide plinth,
// like the other tests that place shapes by the plinth's edges.)
{
  const t = createSim({ tuning: { plinthWidth: 8 } });
  t.spawnControlled({ shape: 'O', x: 0 });
  check('Ghost centred O is ok', t.ghost()!.tint === 'ok', t.ghost()!.tint);
  t.intent({ type: 'moveTo', x: 3.5 });
  t.step();
  check('T7 ghost: O overhanging the edge by 0.5 is not red', ['ok', 'amber'].includes(t.ghost()!.tint), `x ${t.sim.ctrl?.x} tint ${t.ghost()!.tint}`);
  t.intent({ type: 'moveTo', x: 4.5 });
  t.step();
  check('T9 ghost: O overhanging by 1.5 is red', t.ghost()!.tint === 'red', `x ${t.sim.ctrl?.x} tint ${t.ghost()!.tint}`);
  t.intent({ type: 'moveTo', x: 5.5 });
  t.step();
  check('Ghost: O entirely past the edge shows a miss', t.ghost()!.tint === 'none' && t.ghost()!.y === null, `x ${t.sim.ctrl?.x} tint ${t.ghost()!.tint}`);
  t.dispose();
}

// Full row: two horizontal I pieces across an 8-wide plinth make a Solid Row.
{
  const t = createSim({ tuning: { plinthWidth: 8 } });
  t.spawnControlled({ shape: 'I', x: -2 });
  t.intent({ type: 'hardDrop' });
  t.step(120);
  t.spawnControlled({ shape: 'I', x: 2 });
  t.intent({ type: 'hardDrop' });
  t.step(180);
  const ev = t.drainEvents();
  const row = ev.find(e => e.name === 'row_solid');
  const stones = t.pieces().filter(p => p.state === 'stone').length;
  check('T15 full row turns to stone', !!row && stones === 2, `row ${JSON.stringify(row?.payload)} stones ${stones}`);
  t.dispose();
}

// Set streak (gameplay.md §9.1): from CP 7 full rows wait for 4 Clean or Perfect placements in a
// row. Two flat I pieces fill row 1 (ready, still wood); two more fill row 2 and reach the streak,
// so both rows turn to stone at once and the streak starts again.
{
  const t = createSim({ startCheckpoint: 7, tuning: { gusts: false, lateHazards: false, firstGap: 20, plinthWidth: 8 } });
  const drop = (x: number) => { t.spawnControlled({ shape: 'I', x }); t.intent({ type: 'hardDrop' }); t.step(150); };
  drop(-2); drop(2);
  const ev1 = t.drainEvents();
  const stone1 = t.pieces().filter(p => p.state === 'stone').length;
  const ready = ev1.find(e => e.name === 'row_ready');
  check('Set streak: a full row waits for the streak from CP 7', t.sim.setNeed === 4 && !!ready && stone1 === 0 && !ev1.some(e => e.name === 'row_solid'),
    `need ${t.sim.setNeed} streak ${t.sim.streak} ready ${JSON.stringify(ready?.payload)} stones ${stone1}`);
  drop(-2); drop(2);
  const ev2 = t.drainEvents();
  const row = ev2.find(e => e.name === 'row_solid');
  const stone2 = t.pieces().filter(p => p.state === 'stone').length;
  check('Set streak: the 4th clean placement sets both full rows, and the streak restarts', !!row && row.payload.count === 2 && stone2 === 4 && t.sim.streak === 0,
    `row ${JSON.stringify(row?.payload)} stones ${stone2} streak ${t.sim.streak} grades ${ev1.concat(ev2).filter(e => e.name === 'piece_settled').map(e => e.payload.grade)}`);
  t.dispose();
  const mid = createSim({ startCheckpoint: 3, tuning: { gusts: false } });
  const meadow = createSim({});
  check('Set streak: 3 in a row from CP 3, none in the Meadow, 0 turns it off', mid.sim.setNeed === 3 && meadow.sim.setNeed === 0 && setStreakFor({ ...DEFAULT_TUNING, setStreak: 0 }, 9) === 0,
    `CP 3 ${mid.sim.setNeed}, CP 1 ${meadow.sim.setNeed}`);
  mid.dispose(); meadow.dispose();
}

// Brittle shapes (gameplay.md §4.3): dealt from CP 5 as a shape first shows in the preview, about one
// in brittleEvery, never two within half that, never O, I or Plank, and never with another in play.
{
  const deal = (cp: number, tuning: Record<string, unknown> = {}) => {
    const t = createSim({ startCheckpoint: cp, tuning: { gusts: false, lateHazards: false, ...tuning } });
    const got: { shape: string; brittle: boolean }[] = [];
    for (let i = 0; i < 1200; i++) got.push((t.sim as any).takeNext());
    t.dispose();
    return got;
  };
  const d = deal(5);
  const idx = d.flatMap((g, i) => (g.brittle ? [i] : []));
  const minGap = Math.min(...idx.slice(1).map((v, i) => v - idx[i]));
  const rescue = d.filter(g => g.brittle && ['O', 'I', 'Plank'].includes(g.shape)).length;
  check('Brittle: about 1 in 12-18 shapes from CP 5, spaced, never a rescue shape', idx.length >= 1200 / 20 && idx.length <= 1200 / 10 && minGap > 6 && rescue === 0,
    `${idx.length} of 1200, min gap ${minGap}, rescue ${rescue}`);
  const none = [deal(4), deal(9, { brittleEvery: 0 }), deal(9, { holdUnlocked: false })].map(g => g.filter(x => x.brittle).length);
  check('Brittle: none before CP 5, with brittleEvery 0, or before Hold opens', none.every(n => n === 0), `${none}`);
}

// A brittle shape holds two O pieces (8 cells) with cracks, and crumbles under a third (12 cells).
// What it held drops into the gap. Off the tower it costs nothing; turned to stone it is safe.
{
  const mk = () => createSim({ startCheckpoint: 5, tuning: { gusts: false, lateHazards: false, firstGap: 20, plinthWidth: 8 } });
  const drop = (t: ReturnType<typeof mk>, shape: string, brittle = false) => { t.spawnControlled({ shape, brittle }); t.intent({ type: 'hardDrop' }); t.step(150); };
  const t = mk();
  drop(t, 'Domino', true); drop(t, 'O'); drop(t, 'O');
  t.step(600);
  const ev = t.drainEvents();
  const strain = ev.filter(e => e.name === 'brittle_strain').map(e => e.payload.stage);
  const dom = t.sim.pieceViews().find(v => v.shape === 'Domino');
  check('Brittle: two shapes on it crack it to stage 2 and it holds', !!dom && dom.brittle && dom.strain === 2 && strain.join() === '1,2' && !ev.some(e => e.name === 'brittle_broke'),
    `strain ${strain} now ${dom?.strain}`);
  const h0 = t.height().committed;
  drop(t, 'O');
  t.step(120);
  const ev2 = t.drainEvents();
  const broke = ev2.find(e => e.name === 'brittle_broke');
  const h1 = t.height().committed;
  check('Brittle: a third shape on it breaks it after the creak, and the column drops', !!broke && broke.payload.load === 12 && !t.sim.pieceViews().some(v => v.shape === 'Domino') && h1 < h0 + 2 - 0.5 && t.hearts === 3,
    `broke ${JSON.stringify(broke?.payload && { load: broke.payload.load, above: broke.payload.above })} height ${h0.toFixed(2)}→${h1.toFixed(2)} hearts ${t.hearts}`);
  t.dispose();

  const q = mk();
  drop(q, 'Domino', true); drop(q, 'O'); drop(q, 'O');
  q.sim.slots = ['quickset', null];
  q.drainEvents();
  const s0 = q.sim.score;
  q.intent({ type: 'power', slot: 0 });
  q.step(10);
  const mended = q.drainEvents().find(e => e.name === 'brittle_mended');
  drop(q, 'O'); drop(q, 'O');
  q.step(300);
  check('Brittle: turned to stone (Quick-Set) it is mended, pays 300 a biome, and never breaks', !!mended && q.sim.score - s0 >= 300 && q.sim.pieceViews().some(v => v.shape === 'Domino' && v.state === 'stone' && !v.brittle) && !q.drainEvents().some(e => e.name === 'brittle_broke'),
    `mended ${JSON.stringify(mended?.payload)}`);
  q.dispose();

  const m = mk();
  m.sim.streak = 2;
  m.spawnControlled({ shape: 'L', brittle: true });
  m.intent({ type: 'moveTo', x: 9 });
  m.step(400);
  const evm = m.drainEvents();
  check('Brittle: tossed off the tower it costs no heart and no brick, and keeps the streak', evm.some(e => e.name === 'brittle_tossed') && !evm.some(e => e.name === 'heart_lost') && m.hearts === 3 && m.sim.used === 0 && m.sim.streak === 2,
    `hearts ${m.hearts} used ${m.sim.used} streak ${m.sim.streak} events ${evm.filter(e => /lost|toss/.test(e.name)).map(e => e.name)}`);
  m.dispose();

  const hu = mk();
  hu.spawnControlled({ shape: 'L', brittle: true });
  hu.intent({ type: 'hold' });
  const held = hu.sim.held === 'L' && hu.sim.heldBrittle && !hu.sim.ctrl?.brittle;
  hu.intent({ type: 'hardDrop' }); hu.step(150);
  hu.spawnControlled({});
  hu.intent({ type: 'hold' });
  const back = hu.sim.ctrl?.shape === 'L' && hu.sim.ctrl.brittle;
  check('Brittle: Hold keeps it brittle both ways', held && !!back, `held ${hu.sim.held}/${hu.sim.heldBrittle} back ${hu.sim.ctrl?.shape}/${hu.sim.ctrl?.brittle}`);
  hu.dispose();
}

// Needle: two vertical I pieces claim checkpoint 1 and get a grade C foundation of the narrowest
// width for the claim: 10 in the Meadow (§7.3), 6 with slabBoost 0.
{
  const needle = (tuning: Record<string, unknown>) => {
    const t = createSim({ tuning: { mortar: true, ...tuning } });
    t.spawnControlled({ shape: 'I', x: 0.5, rot: 1 });
    t.intent({ type: 'hardDrop' });
    t.step(90);
    t.spawnControlled({ shape: 'I', x: 0.5, rot: 1 });
    t.intent({ type: 'hardDrop' });
    t.step(400);
    const claim = t.drainEvents().find(e => e.name === 'checkpoint_claimed');
    t.dispose();
    return claim?.payload;
  };
  const wide = needle({}), old = needle({ slabBoost: 0 }), zen = needle({ zen: true });
  check('T19 needle claims CP1 with grade C and the Meadow\'s narrowest slab, 10 wide (6 with slabBoost 0)',
    wide?.grade === 'C' && wide.width === 10 && old?.grade === 'C' && old.width === 6, `${JSON.stringify(wide ?? 'no claim')} / ${JSON.stringify(old ?? 'no claim')}`);
  check('Zen: a needle still gets the widest slab', zen?.grade === 'C' && zen.width === 12, JSON.stringify(zen ?? 'no claim'));
  const mins = [1, 2, 3, 4, 5, 6, 7, 10, 11, 20].map(n => minSlabWidthFor(DEFAULT_TUNING, n));
  check('Narrowest slab by claim: 10 in the Meadow, 9 in Treetops, 8 in Cloudlands, 7 in the Storm Belt, then 6', mins.join(',') === '10,10,9,9,8,8,7,6,6,6', mins.join(', '));
  const maxes = [1, 6, 7, 10, 11, 16, 17, 22, 23, 40].map(n => maxSlabWidthFor(n));
  check('Widest slab by stretch: 12 to Cloudlands, 11 to the Stratosphere, 10 to the Moon, 9 to the Ringed Giant, then 8', maxes.join(',') === '12,12,11,11,10,10,9,9,8,8', maxes.join(', '));
  const plinth = createSim({});
  check('The plinth is 12 wide', plinth.sim.foundation.width === 12, `${plinth.sim.foundation.width}`);
  plinth.dispose();
}

// A piece pushed off the edge is Lost and costs one heart.
{
  const t = createSim({ tuning: { plinthWidth: 8 } });
  t.spawnControlled({ shape: 'O', x: 6 });
  t.intent({ type: 'hardDrop' });
  t.step(400);
  const ev = t.drainEvents();
  check('Shape dropped beside the plinth is Lost and costs a heart', ev.some(e => e.name === 'piece_lost') && t.hearts === 2, `hearts ${t.hearts}`);
  t.dispose();
}

// QA-001: a thin piece falling fast onto a loose piece must not sink into it (F3.3: out within 3 steps).
{
  const t = createSim({ tuning: { mortar: false } });
  t.placePiece({ shape: 'O', x: 0, y: 1 });
  t.step(30);
  const id = t.placePiece({ shape: 'Domino', x: 0.3, y: 18 });
  let worst = 0, deep = 0, hitSpeed = 0;
  for (let i = 0; i < 180; i++) {
    t.step();
    const o = t.pieces().find(p => p.shape === 'O')!, d = t.pieces().find(p => p.id === id);
    if (!d) break;
    const sink = (o.y + 1) - (d.y - 0.5);
    if (sink > 0.02) { deep++; worst = Math.max(worst, sink); }
    if (sink < 0.3) hitSpeed = Math.max(hitSpeed, Math.abs(d.vy));
  }
  check('QA-001 fast Domino onto a loose O does not sink', deep <= 3 && worst < 0.1, `worst sink ${worst.toFixed(3)} blocks, ${deep} steps deep, hit at ${hitSpeed.toFixed(1)} blocks/s`);
  t.dispose();
}

// T4 needle (gameplay.md §16): 4 vertical I pieces with Mortar stand in calm air and a 0.08 g gust,
// fall in a 0.12 g gust (3 s).
{
  const needle = (wind: number) => {
    const t = createSim({ tuning: { mortar: true, firstGap: 100, gapCap: 100 } });
    for (let i = 0; i < 4; i++) { t.placePiece({ shape: 'I', x: 0, y: 2 + 4 * i, rot: 1 }); t.step(40); }
    t.step(60);
    if (wind) { t.retune({ wind }); t.step(180); t.retune({ wind: 0 }); }
    t.step(600);
    const top = Math.max(...t.pieces().filter(p => p.state !== 'lost').map(p => p.y));
    t.dispose();
    return top > 13;
  };
  const calm = needle(0), soft = needle(0.08), hard = needle(0.12);
  check('T4 needle stands calm and in 0.08 g, falls in a 0.12 g gust', calm && soft && !hard, `calm ${calm ? 'stands' : 'falls'}, 0.08 g ${soft ? 'stands' : 'falls'}, 0.12 g ${hard ? 'stands' : 'falls'}`);
}

// Snapshot and restore rebuild the same state.
{
  const t = createSim({ seed: 3, autoSpawn: true });
  for (let i = 0; i < 600; i++) { if (t.controlled() && i % 50 === 0) t.intent({ type: 'hardDrop' }); t.step(); }
  const snap = t.snapshot();
  const u = restore(snap);
  t.step(300); u.step(300);
  check('Snapshot and restore continue identically', t.digest() === u.digest() && u.stepIndex === 900, `${t.digest()} vs ${u.digest()}`);
  t.dispose(); u.dispose();
}

// QA-002: an upside-down shape bonded onto the wall must not explode (weld angle unwrap patch).
// Domino at -2 launches without the patch on this build; QA's O and Plank cases did on the last one.
for (const [shape, x] of [['Domino', -2], ['O', 2.5], ['Plank', -1.5]] as const) {
  const t = createSim({ tuning: { mortar: true, firstGap: 20 } });
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) t.placePiece({ shape: 'O', x: -3 + col * 2, y: 1 + row * 2 + 0.001 * row });
  t.step(60);
  const wall = new Map(t.pieces().map(p => [p.id, [p.x, p.y] as [number, number]]));
  t.spawnControlled({ shape, x, rot: 2 });
  let fastest = 0;
  for (let i = 0; i < 600; i++) { t.step(); for (const p of t.pieces()) if (!wall.has(p.id)) fastest = Math.max(fastest, p.vy); }
  let moved = 0;
  for (const p of t.pieces()) { const w = wall.get(p.id); if (w && Math.hypot(p.x - w[0], p.y - w[1]) > 0.1) moved++; }
  check(`QA-002 upside-down ${shape} bonded on the wall stays put`, fastest < 2 && moved === 0, `fastest upward ${fastest.toFixed(1)} blocks/s, ${moved} wall pieces moved`);
  t.dispose();
}

// QA-003: a shape dragged across a ledge as it reaches it slides past instead of snagging.
{
  const slide = (touchGrace: number) => {
    const t = createSim({ tuning: { touchGrace, firstGap: 20 } });
    t.placePiece({ shape: 'O', x: -1, y: 1 });
    t.step(30);
    t.spawnControlled({ shape: 'I', x: 0.5, rot: 1 });
    while (t.controlled() && t.controlled()!.y - 2 > 2.06) t.step();
    for (const x of [-0.5, -1.5, -2.5]) { t.intent({ type: 'moveTo', x }); t.step(2); }
    t.step(240);
    const p = t.pieces().find(q => q.shape === 'I')!;
    t.dispose();
    return p;
  };
  const withGrace = slide(0.12), without = slide(0);
  check('QA-003 touchdown grace lets a dragged shape slide past a ledge', Math.abs(withGrace.x + 2.5) < 0.1 && withGrace.y < 2.2 && Math.abs(without.x + 2.5) > 0.5,
    `with grace x ${withGrace.x.toFixed(2)} y ${withGrace.y.toFixed(2)}; without x ${without.x.toFixed(2)} y ${without.y.toFixed(2)}`);
}

// QA-003: a sideways step lifts the shape over a lip a hair higher than what it rests on.
{
  const step = (stepUp: number) => {
    const t = createSim({ tuning: { stepUp, firstGap: 20 } });
    t.placePiece({ shape: 'O', x: 1, y: 1, as: 'stone' });
    t.placePiece({ shape: 'O', x: -1, y: 1.04, as: 'stone' }); // 0.04 higher
    t.spawnControlled({ shape: 'O', x: 1 });
    while (t.controlled() && t.controlled()!.y - 3 > 0.05) t.step();
    t.intent({ type: 'moveTo', x: 1.5 }); t.step(3); // still steering as it touches down
    t.intent({ type: 'moveTo', x: 0 }); t.step();
    const c = t.controlled();
    t.dispose();
    return c;
  };
  const up = step(0.15), flat = step(0);
  check('QA-003 a sideways step lifts over a 0.04 lip', up?.x === 0 && Math.abs(up.y - 3.04) < 0.01 && flat?.x === 1,
    `with step-up x ${up?.x} y ${up?.y.toFixed(3)}; without x ${flat?.x}`);
}

// QA-003: a J turned to stone acts about its own origin. The Box2D port kept its old
// centre-of-mass offset, so a bond to it yanked the piece on it as soon as it was solved.
{
  const t = DEFAULT_TUNING;
  const e = new Box2DEngine({ gravity: t.gravity, pushoutVelocity: t.pushoutVelocity, hitThreshold: 0.3 });
  const body = (id: number, x: number, y: number) => e.addBody({
    id, boxes: colliderBoxes('J', 0, t.inset, t.cornerRadius), x, y, rot: rotQ(0), vx: 0, vy: 0, dynamic: true,
    friction: t.friction, density: t.density, linearDamping: t.linearDamping, angularDamping: t.angularDamping,
  });
  body(1, 0, 1);
  e.setStatic(1);
  body(2, -1, 3); // its bottom row rests on the stone's top cell
  e.addWeld(2, 1, -1, 2, t.bondHertz, t.bondDamping);
  let fastest = 0;
  for (let i = 0; i < 60; i++) { e.step(1 / 60, t.subSteps); const v = e.velocity(2); fastest = Math.max(fastest, Math.hypot(v.vx, v.vy)); }
  e.dispose();
  check('QA-003 a bond to a J turned to stone holds still', fastest < 0.1, `fastest ${fastest.toFixed(2)} blocks/s`);
}

// QA-004: the physics path uses only maths every JavaScript engine computes bit for bit the same.
// atan2, exp, pow and the rest may differ in their last bits between engines, so an Android phone
// drifted from Node. sin and cos of 0 are exact, so those are allowed.
{
  const M = Math as unknown as Record<string, (...a: number[]) => number>;
  const names = ['atan2', 'atan', 'sin', 'cos', 'tan', 'exp', 'expm1', 'log', 'log1p', 'log2', 'log10', 'pow', 'hypot', 'cbrt', 'asin', 'acos', 'sinh', 'cosh', 'tanh'];
  const saved = names.map(n => M[n]);
  const used = new Map<string, number>();
  names.forEach((n, k) => { M[n] = (...a: number[]) => { if (!((n === 'sin' || n === 'cos') && a[0] === 0)) used.set(n, (used.get(n) ?? 0) + 1); return saved[k](...a); }; });
  try {
    const t = createSim({ autoSpawn: true, seed: 11, tuning: { firstGap: 4, wind: 0.05, infiniteHearts: true, infiniteBudget: true } });
    let bonds = 0;
    for (let i = 0; i < 60 * 40 && t.sim.state === 'playing'; i++) {
      const c = t.sim.ctrl;
      if (c && c.speed > 0 && !c.hard) { t.intent({ type: 'moveTo', x: -1.5 + (i % 4) }); t.intent({ type: 'hardDrop' }); }
      t.step();
      bonds += t.drainEvents().filter(e => e.name === 'bond_formed').length;
    }
    t.dispose();
    check('QA-004 the physics path uses only exactly-rounded maths', used.size === 0 && bonds > 5, `${bonds} bonds; ${used.size ? [...used].map(([n, k]) => `${n} ×${k}`).join(', ') : 'no atan2, exp, pow, … calls'}`);
  } finally {
    names.forEach((n, k) => { M[n] = saved[k]; });
  }
}

// Start wait (§8.1): early on a new shape waits at the top before it falls, and can be steered meanwhile.
{
  const waitFor = (startCheckpoint: number) => {
    const t = createSim({ autoSpawn: true, startCheckpoint });
    t.step(1);
    const y0 = t.sim.ctrl!.y;
    let still = 0;
    for (let i = 0; i < 200 && t.sim.ctrl && t.sim.ctrl.y === y0; i++) { t.step(); still++; }
    t.dispose();
    return still;
  };
  const steps = [1, 2, 3, 4].map(waitFor);
  const waits = [1, 2, 3, 4, 9].map(n => startWaitFor(DEFAULT_TUNING, n));
  check('Start wait: a new shape waits 1.5 s, 1.0 s, 0.5 s, then none from CP 4', waits.join(',') === '1.5,1,0.5,0,0' &&
    Math.abs(steps[0] - 90) <= 2 && Math.abs(steps[1] - 60) <= 2 && Math.abs(steps[2] - 30) <= 2 && steps[3] <= 1, `still for ${steps.join(', ')} steps`);
  const t = createSim({ autoSpawn: true });
  t.step(1);
  const x0 = t.sim.ctrl!.x, y0 = t.sim.ctrl!.y;
  t.intent({ type: 'moveTo', x: x0 + 2 });
  t.step(10);
  const steered = t.sim.ctrl!.x === x0 + 2 && t.sim.ctrl!.y === y0 && t.sim.waiting;
  t.intent({ type: 'softDrop', on: true });
  t.step(5);
  t.intent({ type: 'softDrop', on: false });
  t.step(5);
  const falling = t.sim.ctrl!.y < y0 - 0.5 && !t.sim.waiting && t.sim.ctrl!.speed > 0;
  t.dispose();
  const h = createSim({ autoSpawn: true });
  h.step(1);
  h.intent({ type: 'hardDrop' });
  h.step(30);
  const dropped = h.drainEvents().some(e => e.name === 'piece_landed');
  h.dispose();
  check('Start wait: the shape steers while it waits, a soft drop ends the wait for good, a hard drop lands at once', steered && falling && dropped,
    `steered ${steered}, falling after the soft drop ${falling}, hard drop landed ${dropped}`);
}

// Shapes left (§7.2): warnings at 5, 3 and 1 also when a shape misses the tower, then bricks_out and the run ends on bricks.
{
  const t = createSim({ autoSpawn: true, tuning: { infiniteHearts: true } });
  t.step(1);
  (t.sim as any).budget = 4;
  t.intent({ type: 'moveTo', x: t.sim.foundation.x + 9 });
  t.intent({ type: 'hardDrop' });
  const ev: { name: string; payload: Record<string, any> }[] = [];
  let at = -1;
  for (let i = 0; i < 60 * 30 && t.sim.state !== 'over'; i++) {
    const c = t.sim.ctrl;
    if (c && !c.hard && t.sim.used > 0) t.intent({ type: 'hardDrop' });
    t.step();
    for (const e of t.drainEvents()) { ev.push(e); if (e.name === 'bricks_out') at = i; }
  }
  const lows = ev.filter(e => e.name === 'budget_low').map(e => e.payload.left);
  const out = ev.find(e => e.name === 'bricks_out'), over = ev.find(e => e.name === 'run_over');
  check('Shapes left: warnings at 3 (a miss) and 1, then bricks_out with a 3 s grace, then the run ends on bricks',
    lows.join(',') === '3,1' && out?.payload.grace === 3 && over?.payload.cause === 'bricks' && t.sim.cause === 'bricks' && at > 0,
    `budget_low ${lows.join(', ')}; bricks_out ${JSON.stringify(out?.payload)}; over ${over?.payload.cause}`);
  t.dispose();
}

// Auto-play smoke: a run with auto spawn and a naive bot keeps going without errors.
{
  const t = createSim({ autoSpawn: true, rookieOpening: true });
  let landed = 0;
  const t0 = performance.now();
  for (let i = 0; i < 60 * 120; i++) {
    const c = t.sim.ctrl;
    if (c && !c.hard && !t.sim.hovering) {
      // naive bot: walk to a rotating column across the foundation, then hard drop
      const f = t.sim.foundation;
      const x = f.x - f.width / 2 + 1 + ((landed * 2) % Math.max(1, f.width - 1));
      if (Math.abs(c.x - x) > 0.01) t.intent({ type: 'moveTo', x });
      else t.intent({ type: 'hardDrop' });
    }
    t.step();
    landed += t.drainEvents().filter(e => e.name === 'piece_landed').length;
    if (t.sim.state === 'over') break;
  }
  const ms = performance.now() - t0;
  check('Auto-play 2 min runs', landed > 10, `landed ${landed}, height ${t.height().committed.toFixed(1)}, cp ${t.checkpoint.n}, state ${t.sim.state} ${t.sim.cause}, ${(ms / Math.max(1, t.stepIndex)).toFixed(2)} ms/step`);
  t.dispose();
}

// Replay: a recorded bot run replays to the same digests, step for step.
{
  const t = createSim({ autoSpawn: true, rookieOpening: true, seed: 7 });
  const digests: string[] = [];
  let landed = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const c = t.sim.ctrl;
    if (c && c.speed > 0 && !c.hard) {
      t.intent({ type: 'rotate', dir: landed % 3 === 0 ? 1 : -1 });
      t.intent({ type: 'moveTo', x: -2 + (landed % 5) });
      t.intent({ type: 'hardDrop' });
    }
    t.step();
    landed += t.drainEvents().filter(e => e.name === 'piece_landed').length;
    if (t.stepIndex % 60 === 0) digests.push(t.digest());
  }
  const r = replay({ seed: 7, rookieOpening: true, inputs: t.sim.inputLog, steps: t.stepIndex });
  const firstDiff = digests.findIndex((d, k) => d !== r.digests[k]);
  check('Recorded run replays to identical digests', firstDiff === -1 && r.digests.length === digests.length, `${digests.length} digests, ${landed} landed, first mismatch ${firstDiff === -1 ? 'none' : 'at second ' + (firstDiff + 1)}`);
  r.sim.dispose();
  t.dispose();
}

// QA-005: QA's stacking bot froze the game with Mortar on. A bond made while a piece slept got
// no index in the port, and removing it later left a stale joint that made every step throw.
// QA's record threw at step 1420 before the install patch's fix.
{
  const rec = JSON.parse(readFileSync(new URL('./fixtures/qa-005-repro-run.json', import.meta.url).pathname, 'utf8'));
  let err = '';
  let r: ReturnType<typeof replay> | null = null;
  try { r = replay({ seed: rec.seed, tuning: rec.tuning, rookieOpening: rec.rookieOpening, secondWind: rec.secondWind, inputs: rec.inputs, steps: rec.steps + 600 }); }
  catch (e) { err = String((e as Error).message); }
  check('QA-005 a bond made in sleep and removed later does not freeze the world', !err && !!r, err ? `threw: ${err.slice(0, 80)}` : `${r!.sim.stepIndex} steps, ${r!.sim.stats.placed} placed`);
  r?.sim.dispose();
}

// Blake: a claim landing while a shape was still falling felt unfair. The shape in hand now hovers
// through the hold and the slab drop, is lifted clear of the new slab, then falls again.
{
  const t = createSim({});
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) t.placePiece({ shape: 'O', x: -3 + col * 2, y: 1 + row * 2 + 0.001 * row });
  t.step(60);
  t.spawnControlled({ shape: 'O', x: 0 });
  t.sim.ctrl!.y = 10.2; // 1.2 above the wall, which is at the line
  const y0 = t.sim.ctrl!.y;
  t.step(30);
  const duringHold = t.sim.ctrl!.y, holding = t.checkpoint.hold.active;
  const claim = stepUntil(t, 'checkpoint_claimed', 600);
  const events = t.drainEvents();
  const slabTop = t.sim.foundation.top;
  const lifted = t.sim.ctrl!.y;
  t.step(60);
  const inPause = t.sim.ctrl!.y;
  t.step(60);
  const after = t.sim.ctrl!.y;
  check('A shape in hand hovers through a hold, is lifted clear of the new slab, then falls',
    holding && !!claim && duringHold === y0 && Math.abs(lifted - 1 - (slabTop + 2.5)) < 1e-9 && inPause === lifted && after < lifted - 0.5,
    `hold ${holding}, y ${y0} → ${duringHold} in the hold, lifted to ${lifted.toFixed(2)} over slab ${slabTop.toFixed(2)}, ${inPause.toFixed(2)} in the pause, ${after.toFixed(2)} after, ${events.some(e => e.name === 'piece_lifted') ? 'lift event' : 'no lift event'}`);
  t.dispose();
}

// ---- Power-ups and Second Wind (gameplay.md §13) ----

/** Steps until an event fires (or `max` steps pass); returns its payload. */
function stepUntil(t: ReturnType<typeof createSim>, name: string, max = 600): Record<string, any> | null {
  for (let i = 0; i < max; i++) {
    t.step();
    const e = t.drainEvents().find(ev => ev.name === name);
    if (e) return e.payload as Record<string, any>;
  }
  return null;
}
const loose = (t: ReturnType<typeof createSim>) => t.pieces().filter(p => p.state !== 'stone' && p.state !== 'lost');

// Bubbles turn up every few shapes in a real run, and a shape steered through one collects it.
{
  const t = createSim({ autoSpawn: true, seed: 5, tuning: { infiniteBudget: true, infiniteHearts: true } });
  let spawned = 0, collected = 0, landed = 0;
  for (let i = 0; i < 60 * 90; i++) {
    const c = t.sim.ctrl, b = t.sim.bubble;
    if (c && !c.hard && c.speed > 0) {
      // Head for the bubble when there is one, otherwise a column; drop once the bubble is gone.
      const x = b ? b.x : -2 + (landed % 5);
      if (Math.abs(c.xTarget - x) > 0.01) t.intent({ type: 'moveTo', x });
      else if (!b) t.intent({ type: 'hardDrop' });
    }
    t.step();
    for (const e of t.drainEvents()) {
      if (e.name === 'bubble_spawned') spawned++;
      if (e.name === 'power_collected') collected++;
      if (e.name === 'piece_landed') landed++;
    }
    // Spend powers as they arrive so slots stay free.
    for (let s = 0; s < 2; s++) if (t.sim.slots[s] === 'glue' || t.sim.slots[s] === 'slowmo') t.intent({ type: 'power', slot: s });
    if (t.sim.slots[0] && t.sim.slots[1]) t.sim.slots[1] = null;
  }
  check('Power bubbles turn up and steering through one collects it', spawned >= 3 && collected >= 2, `${landed} landed, ${spawned} bubbles, ${collected} collected`);
  t.dispose();
}

// Bubbles sit beside the foundation, so a player who only builds on it rarely collects one (QA).
{
  const t = createSim({ autoSpawn: true, seed: 5, tuning: { infiniteBudget: true, infiniteHearts: true } });
  let spawned = 0, collected = 0, landed = 0, inside = 0;
  for (let i = 0; i < 60 * 120; i++) {
    const c = t.sim.ctrl;
    if (c && !c.hard && c.speed > 0) {
      // Build across the current foundation, wherever the last claim put it.
      const x = t.sim.foundation.x - 1 + (landed % 3);
      if (Math.abs(c.xTarget - x) > 0.01) t.intent({ type: 'moveTo', x });
      else t.intent({ type: 'softDrop', on: true });
    }
    t.step();
    for (const e of t.drainEvents()) {
      if (e.name === 'bubble_spawned') {
        spawned++;
        const f = t.sim.foundation, b = e.payload as { x: number };
        if (Math.abs(b.x - f.x) < Math.min(f.width / 2 + 1, 5.25) - 1e-9) inside++;
      }
      if (e.name === 'power_collected') collected++;
      if (e.name === 'piece_landed') landed++;
    }
    for (let s = 0; s < 2; s++) t.sim.slots[s] = null;
  }
  check('Bubbles sit beside the foundation and building on it rarely collects one', spawned >= 4 && inside === 0 && collected <= spawned / 4, `${landed} landed, ${spawned} bubbles, ${inside} over the foundation, ${collected} collected`);
  t.dispose();
}

// With Mortar off, Glue is never offered and a Glue already in a slot is refused (QA-006).
{
  const t = createSim({ autoSpawn: true, seed: 11, tuning: { mortar: false, bubbleGap: 1 } });
  const kinds = new Set<string>();
  for (let i = 0; i < 400; i++) kinds.add((t.sim as unknown as { pickKind(): string }).pickKind());
  t.sim.slots[0] = 'glue';
  t.intent({ type: 'power', slot: 0 });
  const refused = t.drainEvents().some(e => e.name === 'power_refused');
  check('Mortar off: Glue is never offered and a slotted Glue is refused', !kinds.has('glue') && kinds.size === 4 && refused && t.sim.slots[0] === 'glue' && t.sim.glueLeft === 0, `kinds ${[...kinds]}, refused ${refused}`);
  t.dispose();
}

// A shape falling through a bubble fills the first free slot; a full pair of slots leaves it.
{
  const t = createSim({});
  t.sim.bubble = { id: 1, kind: 'glue', x: 0.5, y: 4, r: 0.6, shapesLeft: 3 };
  t.spawnControlled({ shape: 'O', x: 0 });
  const got = stepUntil(t, 'power_collected');
  const t2 = createSim({});
  t2.sim.slots = ['clean', 'undo'];
  t2.sim.bubble = { id: 1, kind: 'glue', x: 0.5, y: 4, r: 0.6, shapesLeft: 3 };
  t2.spawnControlled({ shape: 'O', x: 0 });
  const missed = stepUntil(t2, 'power_collected');
  check('A shape through a bubble fills a free slot, not a full pair', got?.kind === 'glue' && t.sim.slots[0] === 'glue' && !missed && t2.sim.bubble !== null, `slots ${t.sim.slots}; full pair kept bubble ${t2.sim.bubble !== null}`);
  t.dispose(); t2.dispose();
}

// Clean Slate: every loose piece of the stretch goes and its bricks come back; stone stays.
{
  const t = createSim({});
  t.placePiece({ shape: 'I', x: 0, y: 0.5, as: 'stone' });
  for (const x of [-2, 0, 2]) t.placePiece({ shape: 'O', x, y: 2.01 });
  t.step(120);
  t.sim.used = 5;
  t.sim.slots = ['clean', null];
  t.drainEvents();
  t.intent({ type: 'power', slot: 0 });
  const used = t.drainEvents().find(e => e.name === 'power_used')?.payload as any;
  t.step(30);
  const left = t.pieces();
  check('Clean Slate sweeps loose pieces and refunds their bricks', loose(t).length === 0 && left.length === 1 && left[0].state === 'stone' && t.sim.used === 2 && used?.refund === 3 && t.sim.slots[0] === null,
    `left ${left.map(p => p.state)}, used ${t.sim.used}, refund ${used?.refund}`);
  t.intent({ type: 'power', slot: 0 });
  t.sim.slots = ['clean', null];
  t.drainEvents();
  t.intent({ type: 'power', slot: 0 });
  const refused = t.drainEvents().some(e => e.name === 'power_refused');
  check('Clean Slate with nothing loose stays in its slot', refused && t.sim.slots[0] === 'clean');
  t.dispose();
}

// Quick-Set: a needle that falls in a 0.12 g gust stands once it is stone.
{
  const t = createSim({ tuning: { firstGap: 20 } });
  for (let k = 0; k < 4; k++) t.placePiece({ shape: 'I', x: 0, y: 2 + 4 * k + 0.001 * k, rot: 1 });
  t.step(90);
  t.sim.slots = ['quickset', null];
  t.intent({ type: 'power', slot: 0 });
  const stone = t.pieces().every(p => p.state === 'stone');
  const before = t.pieces().map(p => [p.x, p.y]);
  t.retune({ wind: 0.12 });
  t.step(600);
  const drift = Math.max(...t.pieces().map((p, k) => Math.hypot(p.x - before[k][0], p.y - before[k][1])));
  check('Quick-Set turns the stretch to stone and a 0.12 g gust cannot move it', stone && drift < 1e-6, `all stone ${stone}, drift ${drift.toExponential(1)}`);
  t.dispose();
}

// Undo: the last shape comes back to hand with its brick; the shape in hand goes back to the queue.
{
  const t = createSim({});
  t.spawnControlled({ shape: 'L', x: 0 });
  t.intent({ type: 'hardDrop' });
  stepUntil(t, 'piece_landed');
  t.step(90);
  t.spawnControlled({ shape: 'I', x: 0 });
  const usedBefore = t.sim.used, scoreBefore = t.sim.score;
  t.sim.slots = [null, 'undo'];
  t.intent({ type: 'power', slot: 1 });
  const c = t.controlled();
  check('Undo takes back the last shape: brick, points and all', t.pieces().length === 0 && c?.shape === 'L' && t.sim.queue[0] === 'I' && t.sim.used === usedBefore - 1 && t.sim.score < scoreBefore,
    `pieces ${t.pieces().length}, in hand ${c?.shape}, next ${t.sim.queue[0]}, used ${usedBefore}→${t.sim.used}, score ${scoreBefore}→${t.sim.score}`);
  t.dispose();
}

// Glue: a glued O hanging 1.5 off an 8-wide plinth sticks where it lands; without Glue it falls.
{
  const result: Record<string, string> = {};
  for (const glue of [false, true]) {
    const t = createSim({ tuning: { plinthWidth: 8 } });
    t.spawnControlled({ shape: 'O', x: 4.5 });
    if (glue) { t.sim.slots = ['glue', null]; t.intent({ type: 'power', slot: 0 }); }
    t.intent({ type: 'hardDrop' });
    const landed = stepUntil(t, 'piece_landed');
    t.step(12);
    const bondsEarly = t.pieces()[0]?.bonds ?? 0;
    t.step(240);
    const p = t.pieces()[0];
    result[glue ? 'glue' : 'plain'] = `${p?.state ?? 'gone'}, bonds at 0.2 s ${bondsEarly}, glueLeft ${t.sim.glueLeft}`;
    if (glue) check('Glue: a glued O off the edge bonds at once and stays; a plain one falls', !!landed?.glue && bondsEarly > 0 && !!p && p.state !== 'lost' && t.sim.glueLeft === 2 && /^(lost|gone)/.test(result.plain), JSON.stringify(result));
    t.dispose();
  }
}

// Slow-Mo: the next shapes fall at half speed.
{
  const speeds: number[] = [];
  for (const slow of [false, true]) {
    const t = createSim({});
    t.spawnControlled({ shape: 'O', x: 0 });
    if (slow) { t.sim.slots = ['slowmo', null]; t.intent({ type: 'power', slot: 0 }); }
    t.step(2);
    const y0 = t.controlled()!.y;
    t.step(30);
    speeds.push((y0 - t.controlled()!.y) / (30 / 60));
    t.dispose();
  }
  check('Slow-Mo halves the fall speed', Math.abs(speeds[1] / speeds[0] - 0.5) < 1e-6, `${speeds[0].toFixed(3)} → ${speeds[1].toFixed(3)} blocks/s`);
}

/** Builds two short stretches (2-block gaps) out of O walls as wide as the foundation (grade S), claiming checkpoints 1 and 2. */
function twoClaims(t: ReturnType<typeof createSim>): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (let n = 0; n < 2; n++) {
    const f = t.sim.foundation, top = f.top;
    for (let x = f.x - f.width / 2 + 1; x < f.x + f.width / 2; x += 2) t.placePiece({ shape: 'O', x, y: top + 1.001 });
    const e = stepUntil(t, 'checkpoint_claimed', 900);
    if (e) out.push(e);
    t.step(100);
  }
  return out;
}

// Second Wind: earned at checkpoint 2, then once per run it sweeps the stretch and refills
// hearts and bricks. Already ready (the day's first run, or the upgrade): a power-up instead.
{
  const tune = { firstGap: 2, gapGrowth: 0 };
  const t = createSim({ tuning: tune });
  const claims = twoClaims(t);
  const earned = t.sim.secondWind;
  for (const x of [-1, 1]) t.placePiece({ shape: 'O', x, y: t.sim.foundation.top + 1.001 });
  t.step(60);
  t.sim.hearts = 1;
  t.sim.used = t.sim.budget;
  t.drainEvents();
  t.intent({ type: 'secondWind' });
  const sw = t.drainEvents().find(e => e.name === 'second_wind')?.payload as any;
  const after = { hearts: t.sim.hearts, used: t.sim.used, loose: loose(t).length, state: t.sim.secondWind };
  t.intent({ type: 'secondWind' });
  const again = t.drainEvents().some(e => e.name === 'power_refused');
  check('Second Wind: earned at CP2, sweeps, refills hearts and bricks, once per run',
    claims.length === 2 && earned === 'ready' && !!sw && after.hearts === 3 && after.used === 0 && after.loose === 0 && after.state === 'used' && again,
    `claims ${claims.length}, after CP2 ${earned}, ${JSON.stringify(after)}, second try refused ${again}`);
  t.dispose();

  const r = createSim({ tuning: tune, secondWind: 'ready' });
  const startReady = r.sim.secondWind === 'ready';
  r.drainEvents();
  twoClaims(r);
  const off = createSim({ tuning: tune, secondWind: 'off' });
  twoClaims(off);
  // Both claims are grade S (one power each), plus one for CP2 in place of Second Wind.
  const filled = (x: typeof r) => x.sim.slots.filter(Boolean).length;
  check('Second Wind starting ready (or off) gives a power-up at CP2 instead', startReady && r.sim.secondWind === 'ready' && filled(r) === 2 && off.sim.secondWind === 'off' && filled(off) === 2,
    `ready run: ${r.sim.secondWind}, slots ${r.sim.slots}; off run: ${off.sim.secondWind}, slots ${off.sim.slots}`);
  r.dispose(); off.dispose();
}

// A run that uses powers and Second Wind replays to the same digests.
{
  const t = createSim({ autoSpawn: true, seed: 9, secondWind: 'ready', tuning: { bubbleGap: 3 } });
  const digests: string[] = [];
  let landed = 0, wind = false;
  for (let i = 0; i < 60 * 60; i++) {
    const c = t.sim.ctrl, b = t.sim.bubble;
    if (c && !c.hard && c.speed > 0) {
      const x = b ? b.x : -2 + (landed % 5);
      if (Math.abs(c.xTarget - x) > 0.01) t.intent({ type: 'moveTo', x });
      else if (!b || c.y < b.y - 1) t.intent({ type: 'hardDrop' });
    }
    t.step();
    if (t.stepIndex % 60 === 0) digests.push(t.digest()); // before this step's intents, as replay() does
    for (const e of t.drainEvents()) if (e.name === 'piece_landed') landed++;
    for (let s = 0; s < 2; s++) if (t.sim.slots[s] && t.stepIndex % 50 === 0) t.intent({ type: 'power', slot: s });
    if (!wind && t.sim.hearts <= 1) { t.intent({ type: 'secondWind' }); wind = true; }
    if (t.sim.state === 'over') break;
  }
  const r = replay({ seed: 9, secondWind: 'ready', tuning: { bubbleGap: 3 }, inputs: t.sim.inputLog, steps: t.stepIndex });
  const firstDiff = digests.findIndex((d, k) => d !== r.digests[k]);
  check('A run using powers and Second Wind replays exactly', firstDiff === -1 && r.digests.length === digests.length && t.sim.stats.powers > 0,
    `${digests.length} digests, ${landed} landed, ${t.sim.stats.powers} powers used, second wind ${t.sim.stats.secondWind}, first mismatch ${firstDiff === -1 ? 'none' : 'at second ' + (firstDiff + 1)}`);
  t.dispose();
}

// Gusts (gameplay.md §8.2, §8.3): none before Treetops; each warned exactly 2 s ahead; never
// starting during a hold or the claim pause; the run's first at half strength; Treetops strengths
// and gaps; and a run with gusts replays exactly.
{
  const tuning = { firstGap: 4, gapGrowth: 0, infiniteBudget: true, infiniteHearts: true, powerUps: false };
  const t = createSim({ autoSpawn: true, seed: 21, tuning });
  const digests: string[] = [];
  const warns: { step: number; cp: number; strength: number; first: boolean; intro: boolean }[] = [];
  const starts: { step: number; cp: number; hold: boolean; dur: number; strength: number }[] = [];
  const ends: { step: number; cancelled: boolean }[] = [];
  let landed = 0, early = 0;
  for (let i = 0; i < 60 * 400 && t.sim.checkpoint <= 4; i++) {
    const c = t.sim.ctrl;
    if (c && !c.hard && c.speed > 0) {
      // Hard drops before Treetops to get there quickly, then shapes fall on their own.
      const f = t.sim.foundation;
      const x = f.x - f.width / 2 + 1 + (landed % Math.max(1, f.width - 2));
      if (Math.abs(c.xTarget - x) > 0.01) t.intent({ type: 'moveTo', x });
      else if (t.sim.checkpoint < 3) t.intent({ type: 'hardDrop' });
    }
    const hold = t.sim.holdState().active;
    t.step();
    if (t.stepIndex % 60 === 0) digests.push(t.digest());
    for (const e of t.drainEvents()) {
      const p = e.payload as Record<string, number & boolean>;
      if (e.name === 'piece_landed') landed++;
      if (e.name === 'hazard_warning') { warns.push({ step: e.step, cp: t.sim.checkpoint, strength: p.strength, first: p.first, intro: p.intro }); if (t.sim.checkpoint < 3) early++; }
      if (e.name === 'hazard_start') starts.push({ step: e.step, cp: t.sim.checkpoint, hold: hold || t.sim.holdState().active, dur: p.duration, strength: p.strength });
      if (e.name === 'hazard_end') ends.push({ step: e.step, cancelled: !!p.cancelled });
    }
  }
  const lead = starts.every(st => warns.some(w => st.step - w.step === 120));
  const inHold = starts.filter(st => st.hold).length;
  const firstHalf = warns.length > 1 && warns[0].first && warns[0].intro && Math.abs(warns[0].strength - 0.02) < 1e-9 && !warns[warns.length - 1].first && !warns[warns.length - 1].intro;
  const strengths = starts.slice(1).every(st => Math.abs(st.strength - (st.cp === 3 ? 0.04 : st.cp === 4 ? 0.06 : st.strength)) < 1e-9);
  const durs = starts.every(st => st.dur >= 2 && st.dur <= 3);
  check('Gusts: none before Treetops, warned 2 s ahead, never start in a hold, first at half strength', early === 0 && starts.length >= 2 && lead && inHold === 0 && firstHalf && strengths && durs,
    `reached CP ${t.sim.checkpoint}, ${warns.length} warnings, ${starts.length} gusts, ${ends.filter(e => e.cancelled).length} called off by a hold, early ${early}, lead ${lead}, in hold ${inHold}, first ${warns[0]?.strength} ${warns[0]?.first} ${warns[0]?.intro}`);
  const r = replay({ seed: 21, tuning, inputs: t.sim.inputLog, steps: t.stepIndex });
  const firstDiff = digests.findIndex((d, k) => d !== r.digests[k]);
  check('A run with gusts replays exactly', firstDiff === -1 && r.digests.length === digests.length && t.sim.stats.gusts > 0, `${digests.length} digests, ${t.sim.stats.gusts} gusts, first mismatch ${firstDiff === -1 ? 'none' : 'at second ' + (firstDiff + 1)}`);
  t.dispose();
}

// Gust periods (QA-008): start to start, each within §8.2's interval × 0.85 to 1.15 when nothing
// holds them back (no checkpoint to hold in this sandbox).
for (const cp of [3, 6]) {
  const t = createSim({ seed: 5, tuning: { firstGap: 1000, gapCap: 1000, infiniteBudget: true, infiniteHearts: true, powerUps: false } });
  t.sim.checkpoint = cp;
  const startsAt: number[] = [];
  for (let i = 0; i < 60 * 200; i++) {
    t.step();
    for (const e of t.drainEvents()) if (e.name === 'hazard_start') startsAt.push(e.step);
  }
  t.dispose();
  const interval = gustFor(cp)!.interval;
  const periods = startsAt.slice(1).map((s, k) => (s - startsAt[k]) / 60);
  const mean = periods.reduce((a, b) => a + b, 0) / Math.max(1, periods.length);
  const inBand = periods.every(p => p >= interval * 0.85 - 0.02 && p <= interval * 1.15 + 0.02);
  check(`Gusts at checkpoint ${cp} come every ${interval} s, start to start`, periods.length >= 8 && inBand && Math.abs(mean - interval) < interval * 0.08,
    `${periods.length} periods, mean ${mean.toFixed(1)} s, range ${Math.min(...periods).toFixed(1)} to ${Math.max(...periods).toFixed(1)} s`);
}

// A gust pushes the tower: a loose O resting on the plinth slides with the wind, the same O with
// gusts off doesn't move.
{
  const drift = (gusts: boolean) => {
    const t = createSim({ seed: 3, tuning: { gusts, infiniteBudget: true, infiniteHearts: true, mortar: false, friction: 0.02, foundationFriction: 0.02 } });
    t.sim.checkpoint = 6; // Cloudlands: 0.08 g, the run's first gust at half that
    t.placePiece({ shape: 'O', x: 0, y: 1, as: 'dynamic' });
    t.step(60);
    const x0 = t.pieces()[0].x;
    let blew = 0;
    for (let i = 0; i < 60 * 14; i++) { t.step(); if (t.sim.gust.phase === 'blow') blew++; }
    const dx = t.pieces()[0].x - x0;
    t.dispose();
    return { dx, blew };
  };
  const on = drift(true), off = drift(false);
  check('A gust pushes a loose piece; with gusts off nothing moves', on.blew > 60 && Math.abs(on.dx) > 0.05 && Math.abs(off.dx) < 1e-6, `on: moved ${on.dx.toFixed(3)} over ${on.blew} steps of gust; off: ${off.dx.toExponential(1)}`);
}

// ---------------------------------------------------------------- late hazards (gameplay.md §8.2)

const QUIET = { firstGap: 1000, gapCap: 1000, infiniteBudget: true, infiniteHearts: true, powerUps: false, gusts: false } as const;
type Ev = { name: string; step: number; payload: Record<string, any> };

// The schedule: one new hazard per biome from the Storm Belt, ramping over the biome.
{
  const h = (n: number) => hazardsFor(n);
  const ok = h(6).crosswind === 0 && h(7).crosswind === 0.03 && h(10).crosswind === 0.06 && h(11).crosswind === 0
    && h(10).junk === 0 && h(11).junk === 20 && h(13).junk === 16 && h(14).junk === 0
    && h(14).meteor === 24 && h(16).meteor === 18 && h(17).meteor === 0
    && h(17).dust?.strength === 0.1 && h(19).dust?.strength === 0.16 && h(20).dust === null
    && h(20).sway?.amplitude === 0.07 && h(22).sway?.amplitude === 0.11 && h(20).fallMult === 1.15 && h(19).fallMult === 1 && h(23).fallMult === 1
    && h(11).gust === null && h(10).gust?.strength === 0.12;
  const dc = hazardsFor(30, ['junk', 'dust']);
  const dcOk = dc.junk === 16 / cosmosScale(30) && dc.dust!.strength === 0.16 * cosmosScale(30) && dc.meteor === 0 && dc.gust === null && dc.sway?.period === 24
    && hazardsFor(30, ['sway', 'gust']).sway?.period === 8 && cosmosScale(23) === 1.05 && cosmosScale(60) === 2;
  check('Late hazards: crosswind 7-10, junk 11-13, meteors 14-16, dust devils 17-19, tidal sway 20-22, Deep Cosmos remixes', ok && dcOk,
    `CP 7 crosswind ${h(7).crosswind}, CP 13 junk every ${h(13).junk} s, CP 16 showers every ${h(16).meteor} s, CP 19 dust ${h(19).dust?.strength} g, CP 22 sway ±${h(22).sway?.amplitude} g; CP 30 remix junk every ${dc.junk.toFixed(1)} s`);
}

// Crosswind: warned 2 s into the stretch, then a steady push one way; the next checkpoint flips it.
{
  // 0.03 g is under any real friction, so the O sits on near-ice here (0.02) to show the push.
  const t = createSim({ seed: 3, startCheckpoint: 7, tuning: { ...QUIET, mortar: false, friction: 0.02, foundationFriction: 0.02, seenHazards: ['crosswind'] } });
  t.placePiece({ shape: 'O', x: 0, y: 1, as: 'dynamic' });
  const evs: Ev[] = [];
  const run = (secs: number) => { for (let i = 0; i < 60 * secs; i++) { t.step(); evs.push(...t.drainEvents()); } };
  run(1);
  const x0 = t.pieces()[0].x;
  run(5);
  const x1 = t.pieces()[0].x;
  const warn = evs.find(e => e.name === 'hazard_warning' && e.payload.type === 'crosswind');
  const start = evs.find(e => e.name === 'hazard_start' && e.payload.type === 'crosswind');
  const dir1 = t.sim.weather.crossDir;
  t.sim.checkpoint = 8;
  run(6);
  const x2 = t.pieces()[0].x;
  const dir2 = t.sim.weather.crossDir;
  t.dispose();
  const lead = warn && start ? (start.step - warn.step) / 60 : -1;
  check('Crosswind is warned 2 s ahead, pushes steadily its way, and flips at the next checkpoint',
    lead === 2 && warn!.payload.strength === 0.03 && Math.sign(x1 - x0) === dir1 && Math.abs(x1 - x0) > 0.05 && dir2 === -dir1 && Math.sign(x2 - x1) === dir2 && !warn!.payload.intro,
    `lead ${lead} s, ${warn?.payload.strength} g, moved ${(x1 - x0).toFixed(2)} (dir ${dir1}), then ${(x2 - x1).toFixed(2)} (dir ${dir2})`);
}

// A first-ever late hazard comes at half strength with its card; met before, it's full.
{
  const first = (seen: string[]) => {
    const t = createSim({ seed: 3, startCheckpoint: 7, tuning: { ...QUIET, seenHazards: seen } });
    t.step(60 * 3);
    const w = t.drainEvents().find(e => e.name === 'hazard_warning' && e.payload.type === 'crosswind');
    t.dispose();
    return w?.payload;
  };
  const fresh = first([]), seen = first(['crosswind']);
  check('A first-ever crosswind is half strength with intro; a seen one is full', fresh?.intro === true && fresh?.strength === 0.015 && seen?.intro === false && seen?.strength === 0.03,
    `fresh ${fresh?.strength} intro ${fresh?.intro}; seen ${seen?.strength} intro ${seen?.intro}`);
}

// Space junk (Orbit): a reticle on an outer piece 2 s ahead, it cracks its mortar and shoves it outward, and leaves.
{
  const t = createSim({ seed: 4, startCheckpoint: 11, tuning: { ...QUIET, friction: 0.005, foundationFriction: 0.005, seenHazards: ['junk'] } });
  t.placePiece({ shape: 'O', x: -0.5, y: 1, as: 'dynamic' });
  const id = t.placePiece({ shape: 'O', x: 2, y: 1, as: 'dynamic' });
  const evs: Ev[] = [];
  let dv = 0, flyStep = -1, steered = 0;
  for (let i = 0; i < 60 * 40 && !evs.some(e => e.name === 'hazard_end' && e.payload.type === 'junk'); i++) {
    const before = t.pieces().find(p => p.id === id)!;
    t.step();
    const now = t.drainEvents();
    evs.push(...now);
    const after = t.pieces().find(p => p.id === id)!;
    if (now.some(e => e.name === 'hazard_hit')) dv = Math.hypot(after.vx - before.vx, after.vy - before.vy);
    const s = t.sim.shots[0];
    if (s && s.phase === 'fly' && flyStep < 0) flyStep = t.stepIndex;
    if (s && s.phase === 'fly') steered++;
  }
  const warn = evs.find(e => e.name === 'hazard_warning' && e.payload.type === 'junk');
  const hit = evs.find(e => e.name === 'hazard_hit');
  const end = evs.find(e => e.name === 'hazard_end' && e.payload.type === 'junk');
  t.dispose();
  const lead = warn && hit ? (hit.step - warn.step) / 60 : -1;
  const cracked = evs.some(e => e.name === 'bond_broken' && e.payload.by === 'junk');
  check('Space junk is aimed at an outer piece 2 s ahead, cracks its mortar and shoves it outward, then leaves',
    lead === 2 && hit!.payload.pieceId === id && hit!.payload.dir === 1 && cracked && dv > 0.5 && !!end && !end.payload.cancelled && flyStep > warn!.step,
    `lead ${lead} s, hit piece ${hit?.payload.pieceId} at (${hit?.payload.x.toFixed(2)}, ${hit?.payload.y.toFixed(2)}) pushing ${hit?.payload.dir}, cracked ${cracked}, Δv ${dv.toFixed(2)} m/s, flew ${steered} steps`);
}

// Meteor showers (Moon): 2 to 4 meteors, each warned 2 s ahead, 0.35 s apart.
{
  const t = createSim({ seed: 9, startCheckpoint: 14, tuning: { ...QUIET, seenHazards: ['meteor'] } });
  for (const x of [-2, 0, 2]) t.placePiece({ shape: 'O', x, y: 1, as: 'dynamic' });
  const evs: Ev[] = [];
  for (let i = 0; i < 60 * 30; i++) { t.step(); evs.push(...t.drainEvents()); if (evs.some(e => e.name === 'hazard_warning' && e.payload.type === 'meteor') && !t.sim.shots.length) break; }
  const warn = evs.find(e => e.name === 'hazard_warning' && e.payload.type === 'meteor');
  const hits = evs.filter(e => e.name === 'hazard_hit' && e.payload.type === 'meteor');
  const misses = evs.filter(e => e.name === 'hazard_end' && e.payload.type === 'meteor' && e.payload.missed);
  t.dispose();
  const n = warn?.payload.count ?? 0;
  const gaps = hits.map(h => (h.step - warn!.step) / 60);
  const timed = gaps.every((g, k) => Math.abs(g - (2 + 0.35 * k)) < 0.02);
  const cracked = evs.some(e => e.name === 'bond_broken' && e.payload.by === 'meteor');
  check('A meteor shower brings 2 to 4 meteors, the first 2 s after the warning, then 0.35 s apart, cracking mortar', n >= 2 && n <= 4 && hits.length + misses.length === n && hits.length > 0 && timed && cracked,
    `${n} meteors, ${hits.length} hits at ${gaps.map(g => g.toFixed(2)).join(', ')} s, ${misses.length} missed, cracked ${cracked}`);
}

// Dust devils (Red Planet): warned at their side, then they cross the top and push it their way.
{
  const t = createSim({ seed: 2, startCheckpoint: 17, tuning: { ...QUIET, mortar: false, friction: 0.005, foundationFriction: 0.005, seenHazards: ['dust'] } });
  const id = t.placePiece({ shape: 'I', x: 0, y: 1, as: 'dynamic' });
  const evs: Ev[] = [];
  let x0 = 0, x1 = 0;
  for (let i = 0; i < 60 * 30; i++) {
    t.step();
    const now = t.drainEvents();
    evs.push(...now);
    if (now.some(e => e.name === 'hazard_start' && e.payload.type === 'dust')) x0 = t.pieces().find(p => p.id === id)!.x;
    if (now.some(e => e.name === 'hazard_end' && e.payload.type === 'dust')) { x1 = t.pieces().find(p => p.id === id)!.x; break; }
  }
  const warn = evs.find(e => e.name === 'hazard_warning' && e.payload.type === 'dust');
  const start = evs.find(e => e.name === 'hazard_start' && e.payload.type === 'dust');
  t.dispose();
  const lead = warn && start ? (start.step - warn.step) / 60 : -1;
  const dir = warn?.payload.dir ?? 0;
  check('A dust devil is warned 2 s ahead on its side, then crosses the top and pushes it its way', lead === 2 && Math.sign(warn!.payload.x) === -dir && Math.sign(x1 - x0) === dir && Math.abs(x1 - x0) > 0.05,
    `lead ${lead} s, from x ${warn?.payload.x.toFixed(1)} going ${dir}, piece moved ${(x1 - x0).toFixed(2)}`);
}

// Tidal sway (Ringed Giant): gravity leans side to side, ±0.08 g every 8 s, and shapes fall 15% faster.
{
  const t = createSim({ seed: 5, startCheckpoint: 20, tuning: { ...QUIET, seenHazards: ['sway'] } });
  const tilts: number[] = [];
  for (let i = 0; i < 60 * 30; i++) { t.step(); tilts.push(t.sim.tilt); }
  t.drainEvents();
  const late = tilts.slice(60 * 6);
  const hi = Math.max(...late), lo = Math.min(...late);
  const crossings: number[] = [];
  for (let k = 1; k < late.length; k++) if (late[k - 1] < 0 && late[k] >= 0) crossings.push(k / 60);
  const period = crossings.length >= 2 ? (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1) : 0;
  t.spawnControlled({ shape: 'O' });
  t.step(2);
  const speed = t.sim.ctrl?.speed ?? 0;
  t.dispose();
  check('Tidal sway leans ±0.07 g on an 8 s swing and shapes fall 15% faster', Math.abs(hi - 0.07) < 0.002 && Math.abs(lo + 0.07) < 0.002 && Math.abs(period - 8) < 0.05 && Math.abs(speed - fallSpeedFor(DEFAULT_TUNING, 20) * 1.15) < 1e-9,
    `tilt ${lo.toFixed(3)} to ${hi.toFixed(3)} g, period ${period.toFixed(2)} s, fall ${speed.toFixed(3)} blocks/s`);
}

// Dust devils crack the mortar of what their middle passes through.
{
  const t = createSim({ seed: 2, startCheckpoint: 17, tuning: { ...QUIET, seenHazards: ['dust'] } });
  t.placePiece({ shape: 'O', x: 0, y: 1, as: 'dynamic' });
  let cracked = 0, ended = false;
  for (let i = 0; i < 60 * 30 && !ended; i++) {
    t.step();
    for (const e of t.drainEvents()) { if (e.name === 'bond_broken' && e.payload.by === 'dust') cracked++; if (e.name === 'hazard_end' && e.payload.type === 'dust') ended = true; }
  }
  t.dispose();
  check('A dust devil cracks the mortar of a piece its middle passes through', ended && cracked > 0, `ended ${ended}, ${cracked} bonds cracked`);
}

// Hearts from the Red Planet on: a heart back every third claim (19, 22, 25, ...), never a full refill.
{
  const back = (cp: number, tuning: Record<string, unknown> = {}) => {
    const t = createSim({ seed: 1, startCheckpoint: cp, tuning: { ...QUIET, infiniteHearts: false, lateHazards: false, ...tuning } });
    t.placePiece({ shape: 'O', x: 0, y: 1, as: 'dynamic' });
    t.step(120);
    t.sim.hearts = 1;
    (t.sim as any).claim(t.sim.height().committed);
    const h = t.sim.hearts;
    t.dispose();
    return h;
  };
  const got = [9, 10, 11, 12, 13, 14, 16, 17, 18, 19, 22, 23, 25].map(n => back(n));
  const old = [17, 18, 19].map(n => back(n, { heartsEveryFrom: 0 }));
  check('Hearts: +1 a claim and a refill at a biome\'s end up to CP 16; from CP 17, +1 every third claim', got.join() === '2,3,2,2,3,2,3,1,1,2,2,1,2' && old.join() === '2,2,3',
    `from 1 heart, claiming CP 9..25 leaves ${got.join(', ')}; with the old rule CP 17-19 leave ${old.join(', ')}`);
}

// The difficulty ramp (Blake, 2026-10-22: "easy beginning, slightly harder middle and hard end
// game"): half a step a stretch to CP 6, a step a stretch to CP 16, a step and a half after. Fall
// speed, mortar, bond delay and budget slack follow it; Zen ramps at half the pace.
{
  const t = DEFAULT_TUNING, z = { ...DEFAULT_TUNING, zen: true };
  const near = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
  const cps = [1, 6, 7, 16, 17, 22];
  const ramp = cps.map(n => rampFor(t, n)), fall = cps.map(n => fallSpeedFor(t, n)), mortar = cps.map(n => mortarStrengthFor(t, n));
  const ok = near(ramp, [0, 2.5, 3, 12, 13, 20.5]) && near(fall, [1.5, 1.75, 1.8, 2.7, 2.8, 3.55]) && near(mortar, [1, 0.9375, 0.925, 0.7, 0.675, 0.4875])
    && near([bondDelayFor(t, 17), slackFor(t, 17), slackFor(t, 22)], [1.15, 1.21, 1.15]) && near([rampFor(z, 17), fallSpeedFor(z, 17), mortarStrengthFor(z, 17)], [6.5, 2.15, 0.8375]);
  check('Ramp: gentle to CP 6, steady to CP 16, steep after; Zen at half pace', ok,
    `steps ${ramp.join(', ')}; fall ${fall.map(x => x.toFixed(2)).join(', ')}; mortar ${mortar.map(x => x.toFixed(3)).join(', ')}; CP 17 bond ${bondDelayFor(t, 17).toFixed(2)} s, slack ${slackFor(t, 17).toFixed(2)}; Zen CP 17 fall ${fallSpeedFor(z, 17).toFixed(2)}`);
}

// Zen's hazards push at half strength.
{
  const warn = (zen: boolean) => {
    const t = createSim({ seed: 3, startCheckpoint: 17, tuning: { ...QUIET, zen, seenHazards: ['dust'] } });
    let w: Record<string, any> | undefined;
    for (let i = 0; i < 60 * 12 && !w; i++) { t.step(); w = t.drainEvents().find(e => e.name === 'hazard_warning' && e.payload.type === 'dust')?.payload; }
    t.dispose();
    return w?.strength;
  };
  const endless = warn(false), zen = warn(true);
  check('Zen: a dust devil blows at half strength', endless === 0.1 && zen === 0.05, `endless ${endless} g, zen ${zen} g`);
}

// Zen's easing is exactly the levers an Endless run can set (so QA can still compare the two step for
// step): half rampPace, half gustScale and hazardStrength, widest slabs, unlimited hearts and budget.
{
  const run = (tuning: Partial<Tuning>) => {
    const t = createSim({ autoSpawn: true, seed: 5, startCheckpoint: 7, secondWind: 'off', tuning: { seenHazards: ['crosswind', 'junk', 'meteor', 'dust', 'sway'], ...tuning } });
    const digests: string[] = [];
    // Hard drops down the middle: a crosswind-blown pile that claims once, about 140 s in.
    for (let i = 0; i < 60 * 150 && t.sim.state === 'playing'; i++) {
      const c = t.sim.ctrl;
      if (c && !c.hard && c.speed > 0) {
        if (Math.abs(c.xTarget - t.sim.foundation.x) > 0.01) t.intent({ type: 'moveTo', x: t.sim.foundation.x });
        else t.intent({ type: 'hardDrop' });
      }
      t.step();
      t.drainEvents();
      if (t.sim.stepIndex % 60 === 0) digests.push(t.sim.digest());
    }
    const out = { digests, claims: t.sim.stats.checkpoints, width: t.sim.foundation.width };
    t.dispose();
    return out;
  };
  const zen = run({ zen: true });
  const twin = run({ infiniteHearts: true, infiniteBudget: true, rampPace: 0.5, gustScale: 0.5, hazardStrength: 0.5, widestSlabs: true });
  const split = zen.digests.findIndex((d, i) => d !== twin.digests[i]);
  check('Zen: the same run as Endless with half rampPace, gustScale and hazardStrength, widest slabs, no budget and no hearts',
    split < 0 && zen.digests.length === twin.digests.length && zen.claims >= 1,
    `${zen.digests.length} and ${twin.digests.length} digests, part at ${split}; ${zen.claims} claims, slab ${zen.width}`);
}

// Deep Cosmos: each stretch remixes two earlier hazards; gravity drifts unless sway is one of them.
{
  const picks = new Set<string>();
  let ok = true;
  for (let seed = 1; seed <= 12; seed++) {
    const t = createSim({ seed, startCheckpoint: 23, tuning: QUIET });
    const r = t.sim.stretch.remix;
    picks.add(r.join('+'));
    ok &&= r.length === 2 && r[0] !== r[1] && (t.sim.stretch.sway?.period === (r.includes('sway') ? 8 : 24));
    t.dispose();
  }
  check('Deep Cosmos remixes two different earlier hazards a stretch, with the gravity drift', ok && picks.size >= 5, `${picks.size} different pairs over 12 seeds: ${[...picks].slice(0, 5).join(', ')}…`);
}

// No late hazard is warned in a hold or the claim pause, and runs with them replay exactly.
for (const cp of [11, 17, 23]) {
  const t = createSim({ seed: 30 + cp, startCheckpoint: cp, autoSpawn: true, tuning: { seenHazards: ['crosswind', 'junk', 'meteor', 'dust', 'sway'] } });
  const digests: string[] = [];
  let landed = 0, inHold = 0, warnings = 0;
  for (let i = 0; i < 60 * 120 && t.sim.state === 'playing'; i++) {
    const c = t.sim.ctrl;
    if (c && c.speed > 0 && !c.hard) {
      const f = t.sim.foundation;
      const x = f.x - f.width / 2 + 1 + ((landed * 2) % Math.max(1, f.width - 1));
      if (Math.abs(c.x - x) > 0.01) t.intent({ type: 'moveTo', x }); else t.intent({ type: 'hardDrop' });
    }
    const calm = t.sim.holdState().active || (t.sim as any).claimPauseUntil > t.sim.time + 1e-9;
    t.step();
    for (const e of t.drainEvents()) {
      if (e.name === 'piece_landed') landed++;
      if (e.name === 'hazard_warning' && e.payload.type !== 'gust') { warnings++; if (calm || t.sim.holdState().active) inHold++; }
    }
    if (t.stepIndex % 60 === 0) digests.push(t.digest());
  }
  const r = replay({ seed: 30 + cp, startCheckpoint: cp, tuning: { seenHazards: ['crosswind', 'junk', 'meteor', 'dust', 'sway'] }, inputs: t.sim.inputLog, steps: t.stepIndex });
  const firstDiff = digests.findIndex((d, k) => d !== r.digests[k]);
  check(`Late hazards from checkpoint ${cp}: never warned in a hold, and the run replays exactly`, inHold === 0 && warnings > 0 && firstDiff === -1,
    `${warnings} warnings, ${inHold} in a hold, ${landed} landed, cp ${t.checkpoint.n}, ${t.sim.stats.hits} hits, first mismatch ${firstDiff === -1 ? 'none' : 'at second ' + (firstDiff + 1)}`);
  r.sim.dispose();
  t.dispose();
}

// Late shapes: P, U and V from the Storm Belt, Arch and Plus from the Red Planet; each one settles.
{
  const bagOf = (cp: number) => {
    const t = createSim({ seed: 8, startCheckpoint: cp, tuning: QUIET });
    const counts: Record<string, number> = {};
    for (let i = 0; i < 40; i++) for (const k of (t.sim as any).makeBag() as string[]) counts[k] = (counts[k] ?? 0) + 1;
    t.dispose();
    return counts;
  };
  const b6 = bagOf(6), b7 = bagOf(7), b19 = bagOf(19);
  const bagOk = !b6.P && !b6.Arch && b7.P > 0 && b7.U > 0 && b7.V > 0 && !b7.Arch && b19.Arch > 0 && b19.Plus > 0 && b19.P > b7.P;
  let settled = 0, total = 0;
  for (const shape of ['P', 'U', 'V', 'Arch', 'Plus']) for (let rot = 0; rot < 4; rot++) {
    const t = createSim({ seed: 1, tuning: QUIET });
    t.placePiece({ shape, x: 0, y: 1.6, rot, as: 'dynamic' });
    t.step(240);
    const p = t.pieces()[0];
    total++;
    if (p && p.state === 'settled' && Number.isFinite(p.y) && p.y > 0.5 && p.y < 3) settled++;
    t.dispose();
  }
  check('Late shapes: P, U, V from checkpoint 7, Arch and Plus from 17, and every rotation settles', bagOk && settled === total,
    `CP 7 bag P ${b7.P} U ${b7.U} V ${b7.V}; CP 19 P ${b19.P} Arch ${b19.Arch} Plus ${b19.Plus}; ${settled}/${total} settle`);
}

// ---------------------------------------------------------------- Zen (gameplay.md §12)

// Zen: no budget, no hearts to lose and no Second Wind. Shapes keep coming past any budget, and
// shapes dropped off the edge are only lost: no heart events, and the run never ends on its own.
{
  // Tight budgets (Zen's slabs are always the widest), so the run soon passes them.
  const ZEN_TEST = { zen: true, plinthWidth: 8, slackStart: 0.3, slackFloor: 0.3 };
  const t = createSim({ autoSpawn: true, seed: 11, tuning: ZEN_TEST });
  const counts: Record<string, number> = {};
  let landed = 0, pastBudget = false;
  for (let i = 0; i < 60 * 150 && t.sim.state === 'playing'; i++) {
    if (t.sim.used > t.sim.budget) pastBudget = true;
    const c = t.sim.ctrl;
    if (c && !c.hard && c.speed > 0) {
      // Every third shape goes off the edge; the rest build on the foundation.
      const x = landed % 3 === 2 ? t.sim.foundation.x + 7 : t.sim.foundation.x - 1 + (landed % 3);
      if (Math.abs(c.xTarget - x) > 0.01) t.intent({ type: 'moveTo', x });
      else t.intent({ type: 'hardDrop' });
    }
    t.step();
    for (const e of t.drainEvents()) {
      counts[e.name] = (counts[e.name] ?? 0) + 1;
      if (e.name === 'piece_landed' || e.name === 'piece_lost') landed++;
    }
  }
  const sim = t.sim;
  const quiet = !counts.heart_lost && !counts.last_heart && !counts.budget_low && !counts.bricks_out && !counts.run_over;
  check('Zen: shapes keep coming past the budget, lost ones cost nothing, and only quitting ends it',
    sim.state === 'playing' && sim.tuning.infiniteBudget && sim.tuning.infiniteHearts && sim.secondWind === 'off' && (counts.piece_lost ?? 0) >= 5 && pastBudget && sim.hearts === sim.tuning.hearts && quiet,
    `${counts.piece_spawned} spawned, ${sim.stats.placed} placed, ${counts.piece_lost ?? 0} lost, hearts ${sim.hearts}, second wind ${sim.secondWind}, checkpoints ${sim.stats.checkpoints}`);
  // Exactly half XP, and quitting doesn't halve it again (QA Q33).
  const xpZen = sim.xp(), xpQuit = sim.xp(true);
  t.intent({ type: 'quit' });
  t.step();
  const over = t.drainEvents().find(e => e.name === 'run_over');
  check('Zen: quitting ends it with exactly half XP, not halved again', xpZen === xpQuit && over?.payload.cause === 'quit' && over?.payload.xp === xpZen && xpZen > 5, `xp ${xpZen}, on quit ${xpQuit}, run_over ${JSON.stringify(over?.payload)}`);
  // The same tower outside Zen: half of its XP (rounded) is what Zen paid.
  sim.tuning.zen = false;
  const full = sim.xp(false), half = sim.xp(true);
  check('Zen: half of what the same tower pays in Endless', half === xpZen && Math.abs(full / 2 - xpZen) <= 0.5, `endless ${full}, half ${half}, zen ${xpZen}`);
  sim.tuning.zen = true;
  // A Zen run replays exactly from its record: the tuning patch carries zen.
  const steps = sim.stepIndex;
  const a = replay({ seed: 11, tuning: ZEN_TEST, inputs: sim.inputLog, steps });
  const b = replay({ seed: 11, tuning: ZEN_TEST, inputs: sim.inputLog, steps });
  check('Zen: a run replays step for step from its inputs', a.digests.join() === b.digests.join() && a.sim.digest() === sim.digest() && a.sim.state === 'over', `${a.digests.length} digests, ${a.sim.digest()} vs ${sim.digest()}`);
  a.sim.dispose(); b.sim.dispose();
  t.dispose();
}

// What a run banks stops at run over (QA #76): a shape still settling when the run ends doesn't
// change its stats, score or XP afterwards, though the tower itself still grows.
{
  const t = createSim({ autoSpawn: false, seed: 5 });
  for (const x of [-1, 1]) { t.spawnControlled({ shape: 'O', x }); t.intent({ type: 'hardDrop' }); t.step(150); }
  t.spawnControlled({ shape: 'I', x: 0 });
  t.intent({ type: 'hardDrop' });
  for (let i = 0; i < 120 && t.sim.ctrl; i++) t.step();
  t.step(2);
  t.intent({ type: 'quit' });
  t.step();
  const over = t.drainEvents().find(e => e.name === 'run_over')?.payload;
  const snap = () => ({ xp: t.sim.xp(true), score: Math.round(t.sim.score), height: t.sim.stats.maxHeight, placed: t.sim.stats.placed, perfects: t.sim.stats.perfects, cleans: t.sim.stats.cleans, messies: t.sim.stats.messies });
  const atEnd = snap(), top = t.sim.height().committed;
  t.step(300);
  const later = snap(), grew = t.sim.height().committed - top;
  check('A run\'s stats, score and XP stop at run over while the tower settles on', JSON.stringify(later) === JSON.stringify(atEnd) && over?.xp === atEnd.xp && over?.height === atEnd.height && grew > 0.5,
    `at the end ${JSON.stringify(atEnd)}, later ${JSON.stringify(later)}, run_over ${JSON.stringify(over)}, tower grew ${grew.toFixed(2)} after`);
  t.dispose();
}

// Zen never earns Second Wind: checkpoint 2 hands out a power-up instead, as in a scored Daily.
{
  const t = createSim({ autoSpawn: false, seed: 3, tuning: { zen: true }, secondWind: 'earn' });
  check('Zen: Second Wind is off whatever the run asks for', t.sim.secondWind === 'off', t.sim.secondWind);
  t.dispose();
}

// The phone bench ends each phase with the world's digest, the same on every run, so a phone's
// bench (both engines) can be checked against Node without the game running on that engine.
{
  const engine = process.env.SIM_ENGINE === 'rapier' ? 'rapier' : 'box2d';
  const a = runBench(undefined, engine), b = runBench(undefined, engine);
  const da = a.phases.map(p => p.digest), db = b.phases.map(p => p.digest);
  check(`Bench phases carry a world digest that repeats run to run (${engine})`, da.length === 2 && da.every(d => /^[0-9a-f]{8}$/.test(d)) && da.join() === db.join() && da[0] !== da[1], da.join(', '));
}

console.log(failures ? `\n${failures} failing` : '\nall passing');
(globalThis as any).process.exitCode = failures ? 1 : 0;
