// Blockling Pop's tray generator (Pop plan §4): seeded, weighted, opening harder shapes as checkpoints
// pass, and checking every tray against the board so a run is varied but never unfair. It reads the
// board, but the same seed and the same moves always give the same trays.
//
// The rules, in the order they apply:
//  1. Something always fits when dealt (against the board as it stands at deal time).
//  2. Mercy: whole trays that fit in some order, pops included (new players, early checkpoints);
//     up to `redraws` tries, then rule 1.
//  3. Line-maker nudge: a share of trays has a shape that completes a line at deal time.
//  4. Rescue: on a crowded board, one small shape half the time.
//  5. Variety: never three of a kind, no pairs early, no shape too often in a row.
//  6. Size budget: cells per tray and 5-cell shapes per tray.

import type { Rng } from '../../sim/rng.ts';
import { CELLS, type Mask, count, fits, fullLines, placeAndPop } from './board.ts';
import { POP_SHAPES, SHAPE_BY_KEY, SMALL_SET, type PopShape, type Turn } from './shapes.ts';
import { type PopTuning, shapeWeight } from './tuning.ts';

/** One tray shape: its number in POP_KEYS and its quarter turn (Art's q of the turn it came in). */
export interface Slot { s: number; q: number }

export interface DealContext {
  board: Mask;
  /** Checkpoints claimed so far. */
  cp: number;
  /** Rule 2 is on for this deal. */
  mercy: boolean;
  /** Shape numbers dealt before, oldest first (only the last repeatWindow − 1 matter). */
  history: number[];
  deal: Rng;
  turns: Rng;
  tuning: PopTuning;
  /** Only these shapes (Daily Pop's set); all of them when absent. */
  set?: readonly string[] | null;
}

const turnOfSlot = (sl: Slot): Turn => { const sh = POP_SHAPES[sl.s]; return sh.turns[sh.byQ[sl.q & 3]]; };

/** Whether the slot's shape fits anywhere on b. */
export function slotFits(b: Mask, sl: Slot): boolean {
  for (const p of turnOfSlot(sl).places) if (fits(b, p.m)) return true;
  return false;
}

/** Whether the slot's shape can complete a line somewhere on b. */
function completesLine(b: Mask, sl: Slot): boolean {
  for (const p of turnOfSlot(sl).places) {
    if (!fits(b, p.m)) continue;
    if (fullLines([b[0] | p.m[0], b[1] | p.m[1], b[2] | p.m[2]]).length) return true;
  }
  return false;
}

/**
 * Whether every slot can be placed, in some order, pops included. Visits at most `budget` placements
 * and calls the tray fair when it runs out (a crowded board with many options is fair enough).
 */
export function wholeTrayFits(b: Mask, slots: Slot[], budget: number): boolean {
  let left = budget;
  const go = (board: Mask, rest: Slot[]): boolean => {
    if (!rest.length) return true;
    if (rest.length === 1) return slotFits(board, rest[0]);
    const tried = new Set<string>();
    for (let i = 0; i < rest.length; i++) {
      const id = `${rest[i].s}/${turnOfSlot(rest[i]).q}`;
      if (tried.has(id)) continue;
      tried.add(id);
      const others = rest.filter((_, j) => j !== i);
      for (const p of turnOfSlot(rest[i]).places) {
        if (!fits(board, p.m)) continue;
        if (--left < 0) return true;
        if (go(placeAndPop(board, p.m).board, others)) return true;
      }
    }
    return false;
  };
  return go(b, slots);
}

/** A weighted pick from `pool` by the current weights (deal stream). */
function pick(ctx: DealContext, pool: PopShape[]): PopShape {
  const ws = pool.map(sh => shapeWeight(ctx.tuning, sh.key, ctx.cp));
  const total = ws.reduce((a, b) => a + b, 0);
  // Weights are quarters at most four places deep: scale to integers so every engine picks alike.
  let r = ctx.deal.int(Math.max(1, Math.round(total * 10000)));
  for (let i = 0; i < pool.length; i++) {
    r -= Math.round(ws[i] * 10000);
    if (r < 0) return pool[i];
  }
  return pool[pool.length - 1];
}

const turnFor = (ctx: DealContext, sh: PopShape): Slot => ({ s: sh.id, q: sh.turns[ctx.turns.int(sh.turns.length)].q });

/** The shapes that can be dealt now: open by checkpoint and in the day's set. */
function openPool(ctx: DealContext): PopShape[] {
  return POP_SHAPES.filter(sh => shapeWeight(ctx.tuning, sh.key, ctx.cp) > 0 && (!ctx.set || ctx.set.includes(sh.key)));
}

/** Rules 5 and 6 for adding `sh` to a tray that holds `tray`. */
function allowed(ctx: DealContext, tray: Slot[], sh: PopShape): boolean {
  const t = ctx.tuning;
  const same = tray.filter(x => x.s === sh.id).length;
  if (same >= 2 || (same >= 1 && ctx.cp < t.pairCp)) return false;
  const recent = ctx.history.slice(-(t.repeatWindow - 1)).filter(s => s === sh.id).length;
  if (recent + same >= t.repeatMax) return false;
  if (sh.size === 5 && tray.filter(x => POP_SHAPES[x.s].size === 5).length >= (ctx.cp >= t.fiveLateCp ? 2 : 1)) return false;
  return true;
}

/** Three shapes by weight, with variety and the size budget (rules 5 and 6). */
function drawTray(ctx: DealContext, pool: PopShape[]): Slot[] {
  const t = ctx.tuning, max = ctx.cp >= t.lateCp ? t.trayMaxLate : t.trayMax;
  let tray: Slot[] = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    tray = [];
    for (let i = 0; i < 3; i++) {
      let sh = pick(ctx, pool);
      for (let k = 0; k < 30 && !allowed(ctx, tray, sh); k++) sh = pick(ctx, pool);
      tray.push(turnFor(ctx, sh));
    }
    const cells = tray.reduce((a, x) => a + POP_SHAPES[x.s].size, 0);
    if (cells >= t.trayMin && cells <= max) break;
  }
  return tray;
}

/** Deals one tray of three (rules 1 to 6). */
export function dealTray(ctx: DealContext): Slot[] {
  const t = ctx.tuning;
  const pool = openPool(ctx);
  const small = pool.filter(sh => SMALL_SET.includes(sh.key));
  const fill = count(ctx.board) / CELLS;
  const nudgeK = Math.min(1, Math.max(0, (ctx.cp - t.nudgeFrom) / Math.max(1, t.nudgeTo - t.nudgeFrom)));
  const nudge = t.nudgeStart + (t.nudgeEnd - t.nudgeStart) * nudgeK;
  let fair: Slot[] | null = null;
  for (let attempt = 0; attempt < t.redraws; attempt++) {
    const tray = drawTray(ctx, pool);
    // Rule 4: a small shape for a crowded board, in place of the biggest.
    if (fill >= t.rescueFill && small.length && ctx.deal.int(1000) < t.rescueChance * 1000 && !tray.some(x => SMALL_SET.includes(POP_SHAPES[x.s].key))) {
      let big = 0;
      tray.forEach((x, i) => { if (POP_SHAPES[x.s].size > POP_SHAPES[tray[big].s].size) big = i; });
      tray[big] = turnFor(ctx, pick(ctx, small));
    }
    // Rule 3: a line-maker, when none of the three is one already.
    if (ctx.deal.int(1000) < nudge * 1000 && !tray.some(x => completesLine(ctx.board, x))) {
      const slot = ctx.deal.int(3);
      const start = ctx.deal.int(pool.length);
      for (let k = 0; k < pool.length; k++) {
        const sh = pool[(start + k) % pool.length];
        const others = tray.filter((_, i) => i !== slot);
        if (!allowed(ctx, others, sh)) continue;
        const turn0 = ctx.turns.int(sh.turns.length);
        const hit = sh.turns.map((_, j) => sh.turns[(turn0 + j) % sh.turns.length]).find(tr => completesLine(ctx.board, { s: sh.id, q: tr.q }));
        if (hit) { tray[slot] = { s: sh.id, q: hit.q }; break; }
      }
    }
    // Rule 1, then rule 2 when it's on.
    if (!tray.some(x => slotFits(ctx.board, x))) continue;
    fair ??= tray;
    if (!ctx.mercy || wholeTrayFits(ctx.board, tray, t.searchBudget)) return tray;
  }
  if (fair) return fair;
  // A board so full nothing drawn fits: the first slot becomes a shape that does (a Pip always fits an empty cell).
  const tray = drawTray(ctx, pool);
  const order = [...pool].sort((a, b) => a.size - b.size);
  for (const sh of order) {
    const tr = sh.turns.find(x => slotFits(ctx.board, { s: sh.id, q: x.q }));
    if (tr) { tray[0] = { s: sh.id, q: tr.q }; break; }
  }
  if (!tray.some(x => slotFits(ctx.board, x))) tray[0] = { s: SHAPE_BY_KEY.Pip.id, q: 0 };
  return tray;
}
