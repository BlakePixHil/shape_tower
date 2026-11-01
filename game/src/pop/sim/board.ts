// Blockling Pop's board (Pop plan §3, §15): 9×9 cells as a bitboard of three 27-bit words, one word per
// band of three rows. Fit is one AND per word, placing an OR, a full line a mask compare. Integer maths
// only, so it is the same on every JS engine (the phone, QA's bots and the server).

export const N = 9;
export const CELLS = N * N;

/** Three 27-bit words: rows 0-2, 3-5 and 6-8. Bit (y % 3) * 9 + x of word floor(y / 3). */
export type Mask = [number, number, number];

/** Which word and which bit a cell index (y * 9 + x) lives in. */
export function cellBit(i: number): [number, number] {
  const y = (i / N) | 0, x = i - y * N;
  return [(y / 3) | 0, 1 << ((y % 3) * N + x)];
}

export const EMPTY = (): Mask => [0, 0, 0];

/** The 27 lines: 9 rows (ids 0-8), 9 columns (9-17), 9 squares (18-26, left to right, top to bottom). */
export const LINES: Mask[] = [];
/** Each line's cells, in order along it (rows left to right, columns top to bottom, squares row by row). */
export const LINE_CELLS: number[][] = [];
export type LineKind = 'row' | 'col' | 'square';
export const lineKind = (id: number): LineKind => (id < 9 ? 'row' : id < 18 ? 'col' : 'square');

{
  const add = (cells: number[]) => {
    const m: Mask = [0, 0, 0];
    for (const i of cells) { const [w, b] = cellBit(i); m[w] |= b; }
    LINES.push(m);
    LINE_CELLS.push(cells);
  };
  for (let y = 0; y < N; y++) add(Array.from({ length: N }, (_, x) => y * N + x));
  for (let x = 0; x < N; x++) add(Array.from({ length: N }, (_, y) => y * N + x));
  for (let s = 0; s < N; s++) {
    const sx = (s % 3) * 3, sy = ((s / 3) | 0) * 3, cells: number[] = [];
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) cells.push((sy + dy) * N + sx + dx);
    add(cells);
  }
}

export const fits = (b: Mask, m: Mask): boolean => ((b[0] & m[0]) | (b[1] & m[1]) | (b[2] & m[2])) === 0;
export const has = (b: Mask, i: number): boolean => { const [w, bit] = cellBit(i); return (b[w] & bit) !== 0; };
export const isEmpty = (b: Mask): boolean => (b[0] | b[1] | b[2]) === 0;

function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

/** Filled cells. */
export const count = (b: Mask): number => popcount(b[0]) + popcount(b[1]) + popcount(b[2]);

/** The ids of every full line on b. */
export function fullLines(b: Mask): number[] {
  const out: number[] = [];
  for (let i = 0; i < LINES.length; i++) {
    const L = LINES[i];
    if ((b[0] & L[0]) === L[0] && (b[1] & L[1]) === L[1] && (b[2] & L[2]) === L[2]) out.push(i);
  }
  return out;
}

/** The union of some lines' masks. */
export function linesMask(ids: number[]): Mask {
  const m: Mask = [0, 0, 0];
  for (const id of ids) { const L = LINES[id]; m[0] |= L[0]; m[1] |= L[1]; m[2] |= L[2]; }
  return m;
}

/** b with m placed and every line it completes popped: the new board and the lines that popped. */
export function placeAndPop(b: Mask, m: Mask): { board: Mask; lines: number[] } {
  const p: Mask = [b[0] | m[0], b[1] | m[1], b[2] | m[2]];
  const lines = fullLines(p);
  if (!lines.length) return { board: p, lines };
  const c = linesMask(lines);
  return { board: [p[0] & ~c[0], p[1] & ~c[1], p[2] & ~c[2]], lines };
}

/** The cell indices set in m, in index order. */
export function cellsOf(m: Mask): number[] {
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (has(m, i)) out.push(i);
  return out;
}
