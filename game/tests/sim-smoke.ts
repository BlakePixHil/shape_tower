// Quick headless checks of the sim (Gameplay's own; QA owns the real suites).
// Run: npm run sim:smoke

import { createSim, replay, restore } from '../src/sim/testApi.ts';

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

console.log(failures ? `\n${failures} failing` : '\nall passing');
(globalThis as any).process.exitCode = failures ? 1 : 0;
