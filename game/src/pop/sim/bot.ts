// Bots for Blockling Pop (Pop plan §16), on the same sim the phone plays: a random bot (any legal move)
// and a greedy bot (best immediate points plus an open-board score, standing in for an average player).
// QA's balance runs and the rule checks use them; nothing in the game imports this.

import { CELLS, type Mask, count, fits, has, placeAndPop } from './board.ts';
import { BAG, type PopIntent, type PopSim } from './pop.ts';
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

/** The greedy bot's pick: the placement with the best points plus openness afterwards. */
export function greedyMove(sim: PopSim): Move | null {
  let best: Move | null = null, bestV = -Infinity;
  for (const mv of legalMoves(sim)) {
    const m = sim.maskAt(mv.slot, mv.x, mv.y)!;
    const { board, lines } = placeAndPop(sim.board, m);
    const cells = m.reduce((a, w) => a + popc(w), 0);
    const v = cells + lines.length * 120 + (lines.length > 1 ? lines.length * 60 : 0) + openness(board);
    if (v > bestV) { bestV = v; best = mv; }
  }
  return best;
}

export function randomMove(sim: PopSim, rng: Rng): Move | null {
  const all = legalMoves(sim);
  return all.length ? all[rng.int(all.length)] : null;
}

/** Plays a run to its end with a bot. `cap` stops runaway runs. */
export function playOut(sim: PopSim, pickMove: (s: PopSim) => Move | null, cap = 5000): void {
  while (!sim.over && sim.placements < cap) {
    const mv = pickMove(sim);
    const it: PopIntent = mv ? { t: 'place', ...mv } : { t: 'end' };
    if (!sim.apply(it)) sim.apply({ t: 'end' });
  }
  if (!sim.over) sim.apply({ t: 'end' });
}

function popc(v: number): number {
  let n = 0;
  while (v) { v &= v - 1; n++; }
  return n;
}
