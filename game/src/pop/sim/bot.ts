// Bots for Blockling Pop (Pop plan §16), on the same sim the phone plays: a random bot (any legal move),
// a greedy bot (best immediate points plus an open-board score, standing in for an average player), and
// the greedy bot with powers (it covers bubbles, and uses its powers and Second Wind when they help).
// QA's balance runs and the rule checks use them; nothing in the game imports this.

import { CELLS, LINE_CELLS, type Mask, cellBit, count, fits, has, placeAndPop } from './board.ts';
import { slotFits } from './deal.ts';
import { BAG, type PopIntent, type PopSim } from './pop.ts';
import { POP_SHAPES } from './shapes.ts';
import type { Rng } from '../../sim/rng.ts';

export interface Move { slot: number; x: number; y: number }

/** Every legal placement for the tray and the bag. */
export function legalMoves(sim: PopSim): Move[] {
  const out: Move[] = [];
  for (let slot = 0; slot <= BAG; slot++) {
    const t = sim.turn(slot);
    if (!t) continue;
    for (const p of t.places) if (fits(sim.board, p.m)) out.push({ slot, x: p.x, y: p.y });
  }
  return out;
}

/** How open a board is: empty cells count for it; ragged edges and boxed-in single cells count against it. */
export function openness(b: Mask): number {
  let edges = 0, lonely = 0;
  for (let i = 0; i < CELLS; i++) {
    if (has(b, i)) continue;
    const x = i % 9, y = (i / 9) | 0;
    let open = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx > 8 || ny > 8) continue;
      if (has(b, ny * 9 + nx)) edges++; else open++;
    }
    if (open === 0) lonely++;
  }
  return (CELLS - count(b)) * 2 - edges * 0.6 - lonely * 6;
}

/** The greedy bot's pick: the placement with the best points plus openness afterwards (plus `bubble` for covering a bubble). */
export function greedyMove(sim: PopSim, bubble = 0): Move | null {
  let best: Move | null = null, bestV = -Infinity;
  const bubbles = bubble ? sim.bubbles.map(b => b.cell) : [];
  for (const mv of legalMoves(sim)) {
    const m = sim.maskAt(mv.slot, mv.x, mv.y)!;
    const { board, lines } = placeAndPop(sim.board, m);
    const cells = m.reduce((a, w) => a + popc(w), 0);
    let v = cells + lines.length * 120 + (lines.length > 1 ? lines.length * 60 : 0) + openness(board);
    for (const c of bubbles) if (has(m, c)) v += bubble;
    if (v > bestV) { bestV = v; best = mv; }
  }
  return best;
}

const without = (b: Mask, cells: number[]): Mask => {
  const m: Mask = [b[0], b[1], b[2]];
  for (const c of cells) { const [w, bit] = cellBit(c); m[w] &= ~bit; }
  return m;
};

/** The best target for an aimed power: the one that leaves the most open board. */
function bestAim(sim: PopSim, kind: 'sweep' | 'meteor'): number | null {
  let best: number | null = null, bestV = -Infinity;
  const n = kind === 'sweep' ? 18 : CELLS;
  for (let a = 0; a < n; a++) {
    if (kind === 'sweep' ? !sim.canSweep(a) : !sim.canMeteor(a)) continue;
    const v = openness(without(sim.board, kind === 'sweep' ? LINE_CELLS[a] : sim.meteorCells(a)));
    if (v > bestV) { bestV = v; best = a; }
  }
  return best;
}

/** Whether slot `i`'s shape fits nowhere as it is but would fit turned. */
function turnHelps(sim: PopSim, i: number): boolean {
  const sl = sim.slot(i);
  if (!sl || sim.fitsAnywhere(i)) return false;
  return POP_SHAPES[sl.s].turns.some(t => t.q !== sl.q && slotFits(sim.board, { s: sl.s, q: t.q }));
}

/** A power intent worth using now, or null: `need` when the run is stuck (anything that helps). */
function powerIntent(sim: PopSim, need: boolean): PopIntent | null {
  const fill = sim.filled / CELLS;
  const trayStuck = [0, 1, 2].some(i => sim.slot(i) && !sim.fitsAnywhere(i));
  const spinHelps = [0, 1, 2, BAG].some(i => turnHelps(sim, i));
  // Spin on: turn a shape that doesn't fit, while a turn of it would.
  if (sim.spinning) {
    for (const i of [0, 1, 2, BAG]) if (sim.canSpin(i) && turnHelps(sim, i)) return { t: 'spin', slot: i };
  }
  for (let slot = 0; slot < 2; slot++) {
    const k = sim.powers[slot];
    if (!k || !sim.canPower(slot)) continue;
    if ((k === 'meteor' || k === 'sweep') && (need || fill >= 0.62)) {
      const arg = bestAim(sim, k);
      if (arg !== null) return { t: 'power', slot, arg };
    }
    if (k === 'fresh' && (need || trayStuck)) return { t: 'power', slot };
    if (k === 'spin' && spinHelps) return { t: 'power', slot };
    if (k === 'undo' && need) return { t: 'power', slot };
  }
  if (need && sim.wind === 'ready') return { t: 'wind' };
  return null;
}

/** The greedy bot with powers: covers bubbles, uses powers when they help, and Second Wind when stuck. */
export function smartIntent(sim: PopSim): PopIntent {
  if (sim.stuck) return powerIntent(sim, true) ?? { t: 'end' };
  const p = powerIntent(sim, false);
  if (p) return p;
  const mv = greedyMove(sim, sim.powers.includes(null) ? 60 : 0);
  return mv ? { t: 'place', ...mv } : { t: 'end' };
}

export function randomMove(sim: PopSim, rng: Rng): Move | null {
  const all = legalMoves(sim);
  return all.length ? all[rng.int(all.length)] : null;
}

/** Plays a run to its end with a bot. `cap` stops runaway runs. */
export function playOut(sim: PopSim, pickMove: (s: PopSim) => Move | null, cap = 5000): void {
  playIntents(sim, s => { const mv = pickMove(s); return mv ? { t: 'place', ...mv } : { t: 'end' }; }, cap);
}

/** Plays a run to its end with an intent bot (one that may use powers). */
export function playIntents(sim: PopSim, pick: (s: PopSim) => PopIntent, cap = 5000): void {
  let guard = 0;
  while (!sim.over && sim.placements < cap && guard++ < cap * 4) {
    if (!sim.apply(pick(sim))) sim.apply({ t: 'end' });
  }
  if (!sim.over) sim.apply({ t: 'end' });
}

function popc(v: number): number {
  let n = 0;
  while (v) { v &= v - 1; n++; }
  return n;
}
