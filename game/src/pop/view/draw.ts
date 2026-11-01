// Blockling Pop's drawing (Pop plan §9): the board, its pieces and fragments, the tray shapes and the
// single cells that burst when a line pops. Everything is Art's Canvas 2D drawing baked once on the CPU
// (the issue #33 lesson) and cached by what it shows, so a frame is only drawImage calls.

import { ART_SHAPES, BIOMES, INK, PAPER, bakeCells, bakePiece, type Baked, type Expression, type Finish } from '@art/index.ts';
import { POP_KEYS } from '../sim/shapes.ts';

const keyOf = (s: number): string => POP_KEYS[s] ?? 'Pip';

/** The cache for one size and biome: cleared when either changes. */
export class PopArt {
  /** Device px per board cell. */
  readonly s: number;
  readonly finish: Finish | null;
  private cache = new Map<string, Baked>();
  private greys = new Map<HTMLCanvasElement, HTMLCanvasElement>();

  constructor(cellDevPx: number, biome: number) {
    this.s = Math.max(4, Math.round(cellDevPx));
    this.finish = BIOMES[biome]?.finish ?? null;
  }

  /** A whole shape in its turn (the tray, the held shape), at `scale` of a board cell. */
  shape(s: number, q: number, scale: number, face: Expression | null): Baked {
    const px = Math.max(3, Math.round(this.s * scale));
    const id = `p|${s}|${q}|${px}|${face}`;
    let b = this.cache.get(id);
    if (!b) { b = bakePiece(keyOf(s), q, px, { face, finish: this.finish, detail: px >= 20 }); this.cache.set(id, b); }
    return b;
  }

  /** A connected set of board cells of one shape (a piece, or a fragment of one), with or without its face. */
  cells(s: number, cells: [number, number][], face: Expression | null): Baked {
    const sig = cells.map(([x, y]) => y * 9 + x).sort((a, b) => a - b).join('.');
    const id = `c|${s}|${sig}|${face}`;
    let b = this.cache.get(id);
    if (!b) { b = bakeCells(keyOf(s), cells, this.s, { face, finish: this.finish }); this.cache.set(id, b); }
    return b;
  }

  /** A greyed copy of a baked canvas (a tray shape that can't fit anywhere). */
  grey(cv: HTMLCanvasElement): HTMLCanvasElement {
    let g = this.greys.get(cv);
    if (g) return g;
    g = document.createElement('canvas');
    g.width = cv.width; g.height = cv.height;
    const c = g.getContext('2d')!;
    c.drawImage(cv, 0, 0);
    c.globalCompositeOperation = 'saturation';
    c.fillStyle = 'rgba(128,128,128,0.9)';
    c.fillRect(0, 0, g.width, g.height);
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = 'rgba(255,247,232,0.35)';
    c.fillRect(0, 0, g.width, g.height);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(cv, 0, 0);
    this.greys.set(cv, g);
    return g;
  }
}

/** A shape number's colours (light, base, shade) for confetti and glows. */
export function shapeColors(s: number): { light: string; base: string; shade: string } {
  const a = ART_SHAPES[keyOf(s)];
  return { light: a.light, base: a.base, shade: a.shade };
}

/**
 * The board: an Ink-rimmed paper slab, its cells in two paper tints by 3×3 square with faint lines.
 * `cell` and `pad` are device px; the canvas includes the rim and its drop shadow.
 */
export function bakeBoard(cell: number, pad: number): HTMLCanvasElement {
  const inner = cell * 9, size = inner + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(size + pad * 0.6);
  cv.height = Math.ceil(size + pad * 0.9);
  const c = cv.getContext('2d')!;
  const r = pad * 1.1;
  const rr = (x: number, y: number, w: number, h: number, rad: number) => {
    c.beginPath();
    c.moveTo(x + rad, y);
    c.arcTo(x + w, y, x + w, y + h, rad);
    c.arcTo(x + w, y + h, x, y + h, rad);
    c.arcTo(x, y + h, x, y, rad);
    c.arcTo(x, y, x + w, y, rad);
    c.closePath();
  };
  // Drop shadow, rim, inner paper.
  c.fillStyle = 'rgba(34,24,58,0.28)';
  rr(pad * 0.15, pad * 0.45, size, size, r); c.fill();
  c.fillStyle = INK;
  rr(0, 0, size, size, r); c.fill();
  c.fillStyle = '#FFE9C2';
  rr(pad * 0.32, pad * 0.32, size - pad * 0.64, size - pad * 0.64, r * 0.7); c.fill();
  const x0 = pad, y0 = pad;
  for (let sq = 0; sq < 9; sq++) {
    const sx = (sq % 3) * 3, sy = Math.floor(sq / 3) * 3;
    c.fillStyle = sq % 2 === 0 ? PAPER : '#F1E2C6';
    c.fillRect(x0 + sx * cell, y0 + sy * cell, cell * 3, cell * 3);
  }
  // Cell lines, then the squares' lines a little stronger.
  c.strokeStyle = 'rgba(34,24,58,0.10)';
  c.lineWidth = Math.max(1, cell * 0.03);
  c.beginPath();
  for (let i = 1; i < 9; i++) {
    if (i % 3 === 0) continue;
    c.moveTo(x0 + i * cell, y0); c.lineTo(x0 + i * cell, y0 + inner);
    c.moveTo(x0, y0 + i * cell); c.lineTo(x0 + inner, y0 + i * cell);
  }
  c.stroke();
  c.strokeStyle = 'rgba(34,24,58,0.22)';
  c.lineWidth = Math.max(1.5, cell * 0.05);
  c.beginPath();
  for (const i of [3, 6]) {
    c.moveTo(x0 + i * cell, y0); c.lineTo(x0 + i * cell, y0 + inner);
    c.moveTo(x0, y0 + i * cell); c.lineTo(x0 + inner, y0 + i * cell);
  }
  c.stroke();
  // Inner edge so the paper reads as sunk into the rim.
  c.strokeStyle = 'rgba(34,24,58,0.35)';
  c.lineWidth = Math.max(1.5, pad * 0.12);
  c.strokeRect(x0, y0, inner, inner);
  return cv;
}

/** The bag's box under the tray: a paper tile with a dashed edge while empty. Device px. */
export function bakeBagBox(size: number, used: boolean): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = cv.height = Math.ceil(size + 6);
  const c = cv.getContext('2d')!;
  const r = size * 0.22, lw = Math.max(2, size * 0.05);
  c.translate(lw, lw);
  const s = size - lw * 2;
  c.beginPath();
  c.moveTo(r, 0);
  c.arcTo(s, 0, s, s, r); c.arcTo(s, s, 0, s, r); c.arcTo(0, s, 0, 0, r); c.arcTo(0, 0, s, 0, r);
  c.closePath();
  c.fillStyle = used ? 'rgba(241,226,198,0.92)' : 'rgba(255,247,232,0.92)';
  c.fill();
  c.lineWidth = lw;
  c.strokeStyle = INK;
  if (used) c.setLineDash([lw * 2, lw * 1.6]);
  c.stroke();
  return cv;
}
