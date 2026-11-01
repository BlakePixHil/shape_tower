// Blockling Pop's shapes (Pop plan §4): the tower's 14 polyominoes plus three small Blocklings for the
// grid, Pip (1 cell), Trio (3 in a line) and Elbow (3-cell corner). Each shape comes in its distinct
// quarter turns, and every turn carries a precomputed board mask for every position it fits at.
//
// Board coordinates are screen style: x 0..8 left to right, y 0..8 top to bottom, a cell's index is
// y * 9 + x. A turn's cells are the art kit's pose(key, q) cells (y down, bounding box at 0,0), so the
// board draws them with Art's piece drawing as they are.

import { SHAPES } from '../../sim/shapes.ts';
import { N, type Mask, cellBit } from './board.ts';

/** The order shapes are numbered in (saves, records and digests use the number). Never reorder; add at the end. */
export const POP_KEYS = ['Pip', 'Domino', 'Trio', 'Elbow', 'O', 'I', 'L', 'J', 'T', 'S', 'Z', 'Plank', 'P', 'U', 'V', 'Arch', 'Plus'] as const;
export type PopKey = (typeof POP_KEYS)[number];

/** The three small Blocklings, in the sim's y-up cells (rotation 0), like SHAPES. */
const SMALL: Record<string, [number, number][]> = {
  Pip: [[0, 0]],
  Trio: [[0, 0], [1, 0], [2, 0]],
  Elbow: [[0, 0], [1, 0], [0, 1]],
};

/** The rescue set (Pop plan §4, rule 4): dealt half the time when the board is crowded. */
export const SMALL_SET: readonly PopKey[] = ['Pip', 'Domino', 'Trio', 'Elbow'];

export interface Placement {
  x: number;
  y: number;
  /** The cell index of the anchor (y * 9 + x). */
  at: number;
  m: Mask;
}

export interface Turn {
  /** Quarter turns counter-clockwise from rotation 0 (Art's pose q). */
  q: number;
  w: number;
  h: number;
  /** Cells, y down, bounding box at (0, 0). */
  cells: [number, number][];
  /** Every anchor (top-left of the bounding box) where the turn lies inside the board, row by row. */
  places: Placement[];
  /** The mask at each anchor cell index, or null where it would leave the board. */
  at: (Mask | null)[];
}

export interface PopShape {
  key: PopKey;
  /** Its number in POP_KEYS. */
  id: number;
  size: number;
  /** The distinct turns, in q order (O, Pip and Plus have one). */
  turns: Turn[];
  /** For each q (0 to 3), its index in turns: turns that look the same share one. */
  byQ: number[];
}

/** Rotate a y-up point q quarter turns counter-clockwise about (px, py): Art's pose() maths, exact. */
function rotUp(x: number, y: number, px: number, py: number, q: number): [number, number] {
  let dx = x - px, dy = y - py;
  for (let i = 0; i < q; i++) [dx, dy] = [-dy, dx];
  return [px + dx, py + dy];
}

/** A shape's cells at quarter turn q, y down with the bounding box at (0, 0), as art/src/shapes.ts pose() makes them. */
export function poseCells(cells0: [number, number][], q: number): { w: number; h: number; cells: [number, number][] } {
  let w0 = 0, h0 = 0;
  for (const [x, y] of cells0) { w0 = Math.max(w0, x + 1); h0 = Math.max(h0, y + 1); }
  const ctr = cells0.map(([x, y]) => rotUp(x + 0.5, y + 0.5, w0 / 2, h0 / 2, q));
  const minX = Math.min(...ctr.map(c => c[0])), minY = Math.min(...ctr.map(c => c[1]));
  const up = ctr.map(([x, y]) => [Math.round(x - minX - 0.5), Math.round(y - minY - 0.5)] as [number, number]);
  const w = Math.max(...up.map(c => c[0])) + 1, h = Math.max(...up.map(c => c[1])) + 1;
  return { w, h, cells: up.map(([x, y]) => [x, h - 1 - y] as [number, number]) };
}

const sig = (cells: [number, number][]): string => cells.map(([x, y]) => y * 16 + x).sort((a, b) => a - b).join(',');

function makeTurn(q: number, w: number, h: number, cells: [number, number][]): Turn {
  const places: Placement[] = [];
  const at: (Mask | null)[] = Array(N * N).fill(null);
  for (let y = 0; y + h <= N; y++) {
    for (let x = 0; x + w <= N; x++) {
      const m: Mask = [0, 0, 0];
      for (const [cx, cy] of cells) {
        const [wi, bit] = cellBit((y + cy) * N + x + cx);
        m[wi] |= bit;
      }
      const p = { x, y, at: y * N + x, m };
      places.push(p);
      at[p.at] = m;
    }
  }
  return { q, w, h, cells, places, at };
}

function makeShape(key: PopKey, id: number): PopShape {
  const cells0 = SMALL[key] ?? SHAPES[key]?.cells;
  if (!cells0) throw new Error(`No cells for Pop shape ${key}`);
  const seen = new Map<string, number>();
  const turns: Turn[] = [];
  const byQ: number[] = [];
  for (let q = 0; q < 4; q++) {
    const p = poseCells(cells0, q);
    const s = sig(p.cells);
    if (!seen.has(s)) { seen.set(s, turns.length); turns.push(makeTurn(q, p.w, p.h, p.cells)); }
    byQ.push(seen.get(s)!);
  }
  return { key, id, size: cells0.length, turns, byQ };
}

export const POP_SHAPES: PopShape[] = POP_KEYS.map((k, i) => makeShape(k, i));
export const SHAPE_BY_KEY: Record<string, PopShape> = Object.fromEntries(POP_SHAPES.map(s => [s.key, s]));

/** A shape's turn by Art's q (any q: turns that look the same share one). */
export function turnOf(shape: PopShape, q: number): Turn {
  return shape.turns[shape.byQ[((q % 4) + 4) % 4]];
}
