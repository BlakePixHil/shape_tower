// Quick headless checks of the sim (Gameplay's own; QA owns the real suites).
// Run: npm run sim:smoke

import { readFileSync } from 'node:fs';
import { Box2DEngine } from '../src/sim/engine/box2d.ts';
import { colliderBoxes, rotQ } from '../src/sim/shapes.ts';
import { createSim, replay, restore } from '../src/sim/testApi.ts';
import { DEFAULT_TUNING } from '../src/sim/tuning.ts';

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

// The same wall with the default line (8) claims checkpoint 1; its stone must not move.
{
  const t = createSim({});
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) t.placePiece({ shape: 'O', x: -3 + col * 2, y: 1 + row * 2 + 0.001 * row });
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

// Ghost tint: an O hanging 1.5 off the plinth edge is red; centred is ok.
{
  const t = createSim({});
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

// Full row: two horizontal I pieces across the 8-wide plinth make a Solid Row.
{
  const t = createSim({});
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

// Needle: two vertical I pieces claim checkpoint 1 and get a 3-wide grade C foundation.
{
  const t = createSim({ tuning: { mortar: true } });
  t.spawnControlled({ shape: 'I', x: 0.5, rot: 1 });
  t.intent({ type: 'hardDrop' });
  t.step(90);
  t.spawnControlled({ shape: 'I', x: 0.5, rot: 1 });
  t.intent({ type: 'hardDrop' });
  t.step(400);
  const ev = t.drainEvents();
  const claim = ev.find(e => e.name === 'checkpoint_claimed');
  check('T19 needle claims CP1 with grade C and a 3-wide slab', !!claim && claim.payload.grade === 'C' && claim.payload.width === 3, JSON.stringify(claim?.payload ?? 'no claim'));
  t.dispose();
}

// A piece pushed off the edge is Lost and costs one heart.
{
  const t = createSim({});
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

// Auto-play smoke: a run with auto spawn and a naive bot keeps going without errors.
{
  const t = createSim({ autoSpawn: true, rookieOpening: true });
  let landed = 0;
  const t0 = performance.now();
  for (let i = 0; i < 60 * 120; i++) {
    const c = t.sim.ctrl;
    if (c && c.speed > 0 && !c.hard) {
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

// Glue: a glued O hanging 1.5 off the plinth sticks where it lands; without Glue it falls.
{
  const result: Record<string, string> = {};
  for (const glue of [false, true]) {
    const t = createSim({});
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

/** Builds two short stretches (2-block gaps) out of O walls, claiming checkpoints 1 and 2. */
function twoClaims(t: ReturnType<typeof createSim>): Record<string, any>[] {
  const out: Record<string, any>[] = [];
  for (let n = 0; n < 2; n++) {
    const top = t.sim.foundation.top;
    for (const x of [-3, -1, 1, 3]) t.placePiece({ shape: 'O', x, y: top + 1.001 });
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

console.log(failures ? `\n${failures} failing` : '\nall passing');
(globalThis as any).process.exitCode = failures ? 1 : 0;
