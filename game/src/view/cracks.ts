// The cracks on a brittle shape (gameplay.md §4.3). Paths are in the shape's own frame: blocks from
// the middle of its bounding box, y up, as the sim's geometry() cells. One pattern per shape, so the
// cracks stay put from the preview to the tower; each strain stage shows more of them.

import { geometry } from '../sim/shapes.ts';

export type CrackPath = [number, number][];

const cache = new Map<string, CrackPath[][]>();

/** The crack paths to draw at strain `stage` (0: just dealt, 3: about to break). */
export function crackPaths(shape: string, stage: number): CrackPath[] {
  let all = cache.get(shape);
  if (!all) { all = build(shape); cache.set(shape, all); }
  return all[Math.max(0, Math.min(3, stage))];
}

function build(shape: string): CrackPath[][] {
  const cells = geometry(shape).cells;
  let s = 2166136261;
  for (let i = 0; i < shape.length; i++) s = Math.imul(s ^ shape.charCodeAt(i), 16777619) >>> 0;
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  // A jagged line across one cell, edge to edge, with three kinks.
  const across = ([cx, cy]: [number, number]): CrackPath => {
    const flat = rnd() < 0.5, a = rnd() * 0.5 - 0.25, b = rnd() * 0.5 - 0.25;
    const path: CrackPath = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4 - 0.5;
      const off = a + (b - a) * (t + 0.5) + (k > 0 && k < 4 ? (rnd() - 0.5) * 0.28 : 0);
      path.push(flat ? [cx + t * 0.9, cy + off] : [cx + off, cy + t * 0.9]);
    }
    return path;
  };
  // A short fork off a crack's middle.
  const fork = (p: CrackPath): CrackPath => {
    const [mx, my] = p[2], ang = rnd() * Math.PI * 2, len = 0.24 + rnd() * 0.12;
    return [[mx, my], [mx + Math.cos(ang) * len * 0.55, my + Math.sin(ang) * len * 0.55], [mx + Math.cos(ang + 0.6) * len, my + Math.sin(ang + 0.6) * len]];
  };
  const order = cells.map(c => ({ c, k: rnd() })).sort((x, y) => x.k - y.k).map(o => o.c);
  const main = order.map(across), forks = main.map(fork);
  const half = Math.ceil(cells.length / 2);
  return [main.slice(0, half), main, [...main, ...forks.slice(0, half)], [...main, ...forks]];
}

/**
 * Draws the stage-0 cracks onto a baked piece canvas (Art's bakePiece at quarter turn 0), only where
 * the piece is painted. `s` is its pixels per block; the pose's bounding box starts at (pad, pad).
 */
export function crackCanvas(src: HTMLCanvasElement, shape: string, s: number, pad: number, ink: string): HTMLCanvasElement {
  const out = document.createElement('canvas');
  out.width = src.width; out.height = src.height;
  const c = out.getContext('2d')!;
  c.drawImage(src, 0, 0);
  const g = geometry(shape);
  const px = (x: number) => pad + (x + g.width / 2) * s, py = (y: number) => pad + (g.height / 2 - y) * s;
  c.globalCompositeOperation = 'source-atop';
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const [w, col] of [[0.11, 'rgba(255,255,255,0.55)'], [0.07, ink]] as const) {
    c.lineWidth = Math.max(1.5, s * w);
    c.strokeStyle = col;
    for (const p of crackPaths(shape, 1)) {
      c.beginPath();
      p.forEach(([x, y], i) => (i ? c.lineTo(px(x), py(y)) : c.moveTo(px(x), py(y))));
      c.stroke();
    }
  }
  return out;
}
