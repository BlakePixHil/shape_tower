// Foundation slabs, one style per biome (art-direction.md §6.2), the Meadow's first wooden pedestal,
// and the grade stamp. Slabs are gameplay objects, so they get the Ink outline.

import { FONT_DISPLAY, INK } from './config.ts';
import { type Ctx, TAU, circ, ctx2d, makeCanvas, rr, star4 } from './util.ts';

/** Visual slab thickness in blocks, measured down from the top surface pieces rest on. */
export const SLAB_DEPTH = 0.6;

function flag(c: Ctx, x: number, y: number, r: number, pt: number, col = '#FF4D6D'): void {
  c.save(); c.strokeStyle = '#E8E8F0'; c.lineWidth = 1.5 * pt;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - r * 1.4); c.stroke();
  c.fillStyle = col; c.fillRect(x, y - r * 1.4, r * 0.8, r * 0.5); c.restore();
}

/**
 * Draw biome `bi`'s slab with its top-left at (x, y), w by h pixels. Decorations may reach outside
 * the box (cloud puffs below, balloons above, solar wings at the sides); bakeSlab pads for them.
 */
export function drawSlab(c: Ctx, x: number, y: number, w: number, h: number, bi: number, pt: number): void {
  c.save(); c.lineJoin = 'round';
  const out = () => { c.lineWidth = 2.5 * pt; c.strokeStyle = INK; c.stroke(); };
  const body = (fill: string) => {
    rr(c, x, y + 3 * pt, w, h, h * 0.18); c.fillStyle = INK; c.fill();
    rr(c, x, y, w, h, h * 0.18); c.fillStyle = fill; c.fill(); out();
  };
  const lip = (fill: string, frac: number) => { c.fillStyle = fill; c.fillRect(x + 3 * pt, y + 3 * pt, w - 6 * pt, h * frac); };
  switch (bi) {
    case 0: // Meadow: plank scaffold
      body('#C68A4E'); lip('#E3A96B', 0.22);
      c.strokeStyle = 'rgba(90,50,20,0.45)'; c.lineWidth = 1.5 * pt;
      for (let i = 1; i < w / (h * 1.2); i++) { c.beginPath(); c.moveTo(x + i * h * 1.2, y + h * 0.3); c.lineTo(x + i * h * 1.2, y + h - 3 * pt); c.stroke(); }
      c.fillStyle = '#7A5230';
      for (const bx of [x + h * 0.4, x + w - h * 0.4]) { c.beginPath(); circ(c, bx, y + h * 0.62, h * 0.09); c.fill(); }
      break;
    case 1: // Treetops: treehouse deck
      body('#A8743F'); lip('#C9935A', 0.25);
      c.fillStyle = '#4FA85A';
      for (const lx of [x + 4 * pt, x + w - 4 * pt]) { c.beginPath(); circ(c, lx, y + h * 0.35, h * 0.3); circ(c, lx + (lx < x + w / 2 ? 6 : -6) * pt, y + h * 0.15, h * 0.22); c.fill(); }
      c.strokeStyle = '#E8D3A8'; c.lineWidth = 1.5 * pt; c.beginPath(); c.moveTo(x + 6 * pt, y + h * 0.65);
      for (let i = 1; i <= 6; i++) c.quadraticCurveTo(x + (i - 0.5) * w / 6, y + h * 0.85, x + i * w / 6 - 2 * pt, y + h * 0.65);
      c.stroke();
      break;
    case 2: // Cloudlands: cloud raft
      c.fillStyle = INK; c.beginPath(); for (let i = 0; i <= 5; i++) circ(c, x + i * w / 5, y + h * 0.75 + 3 * pt, h * 0.42); c.fill();
      c.fillStyle = '#FFFFFF'; c.beginPath(); for (let i = 0; i <= 5; i++) circ(c, x + i * w / 5, y + h * 0.75, h * 0.42); c.fill();
      c.strokeStyle = INK; c.lineWidth = 2 * pt; c.stroke();
      body('#D9A066'); lip('#F2C891', 0.22);
      break;
    case 3: // Storm Belt: steel scaffold with hazard stripes
      body('#8C96A8');
      c.save(); rr(c, x, y, w, h, h * 0.18); c.clip();
      c.fillStyle = '#FFCC33'; c.fillRect(x, y + h * 0.58, w, h * 0.42); c.fillStyle = INK;
      for (let sx = x - h; sx < x + w; sx += h * 0.6) { c.beginPath(); c.moveTo(sx, y + h); c.lineTo(sx + h * 0.3, y + h * 0.58); c.lineTo(sx + h * 0.6, y + h * 0.58); c.lineTo(sx + h * 0.3, y + h); c.closePath(); c.fill(); }
      c.restore(); rr(c, x, y, w, h, h * 0.18); out();
      c.fillStyle = '#5A6274'; for (let i = 0; i < w / (h * 0.7); i++) { c.beginPath(); circ(c, x + h * 0.35 + i * h * 0.7, y + h * 0.3, h * 0.07); c.fill(); }
      break;
    case 4: // Stratosphere: balloon deck
      for (const bx of [x + w * 0.2, x + w * 0.8]) {
        c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 1.2 * pt; c.beginPath(); c.moveTo(bx, y); c.lineTo(bx, y - h * 1.3); c.stroke();
        c.fillStyle = '#F4F4FA'; c.beginPath(); c.ellipse(bx, y - h * 1.7, h * 0.4, h * 0.48, 0, 0, TAU); c.fill(); c.lineWidth = 2 * pt; c.strokeStyle = INK; c.stroke();
      }
      body('#8E7CC3'); lip('#B7A8E8', 0.22);
      break;
    case 5: // Orbit: satellite truss with solar wings
      body('#B9C2D6'); c.strokeStyle = '#6B7590'; c.lineWidth = 1.5 * pt; c.beginPath();
      for (let i = 0; i < w / h; i++) { c.moveTo(x + i * h, y + 3 * pt); c.lineTo(x + (i + 1) * h, y + h - 3 * pt); c.moveTo(x + (i + 1) * h, y + 3 * pt); c.lineTo(x + i * h, y + h - 3 * pt); }
      c.stroke();
      c.fillStyle = '#2F5BB8';
      for (const sx of [-1, 1]) { const px = sx < 0 ? x - h * 1.1 : x + w + h * 0.1; rr(c, px, y + h * 0.1, h, h * 0.8, 3 * pt); c.fill(); c.lineWidth = 2 * pt; c.strokeStyle = INK; c.stroke(); }
      break;
    case 6: // Moon: rock shelf with a tiny flag
      body('#A9ADBF'); c.fillStyle = 'rgba(80,84,104,0.45)';
      for (let i = 0; i < w / (h * 0.9); i++) { c.beginPath(); c.ellipse(x + h * 0.5 + i * h * 0.9, y + h * (0.4 + 0.2 * (i % 2)), h * 0.18, h * 0.11, 0, 0, TAU); c.fill(); }
      flag(c, x + w - h * 0.5, y, h * 0.7, pt);
      break;
    case 7: // Red Planet: rust mesa
      body('#B4533A'); lip('#D9774F', 0.25);
      c.fillStyle = '#8E3A28'; c.fillRect(x + 3 * pt, y + h * 0.62, w - 6 * pt, h * 0.12);
      c.strokeStyle = 'rgba(60,20,15,0.4)'; c.lineWidth = 1 * pt;
      for (let i = 0; i < w / (8 * pt); i++) { c.beginPath(); c.moveTo(x + (6 + i * 8) * pt, y + h * 0.4); c.lineTo(x + (10 + i * 8) * pt, y + h * 0.4); c.stroke(); }
      break;
    case 8: // Ringed Giant: ring ice
      body('rgba(190,235,255,0.92)'); lip('rgba(255,255,255,0.7)', 0.2);
      c.fillStyle = '#FFFFFF';
      for (let i = 0; i < 5; i++) { c.globalAlpha = 0.6 + 0.4 * ((i * 37) % 10) / 10; star4(c, x + w * (0.1 + i * 0.2), y + h * (0.45 + 0.2 * (i % 2)), 3 * pt); }
      c.globalAlpha = 1;
      break;
    default: { // Deep Cosmos: star-metal with a constellation inlay
      body('#2A2148');
      const pts: [number, number][] = [[0.15, 0.5], [0.35, 0.3], [0.55, 0.6], [0.8, 0.35]];
      c.strokeStyle = 'rgba(160,140,255,0.6)'; c.lineWidth = 1.2 * pt; c.beginPath();
      pts.forEach(([a, b], i) => (i ? c.lineTo(x + w * a, y + h * b) : c.moveTo(x + w * a, y + h * b))); c.stroke();
      c.fillStyle = '#FFB8F0'; for (const [a, b] of pts) star4(c, x + w * a, y + h * b, 3.5 * pt);
      c.strokeStyle = 'rgba(255,184,240,0.5)'; c.lineWidth = 2 * pt; rr(c, x, y, w, h, h * 0.18); c.stroke();
    }
  }
  c.restore();
}

/**
 * The very first base (§6.2): a wooden toy pedestal standing on the grass. The plank top is the
 * physics surface; the pedestal below is decoration down to the ground, `legs` blocks tall.
 */
export function drawPedestal(c: Ctx, x: number, y: number, w: number, s: number, legs: number, pt: number): void {
  const h = SLAB_DEPTH * s, by = y + h, bh = legs * s, inset = Math.min(w * 0.12, s * 0.7);
  c.save(); c.lineJoin = 'round';
  // Pedestal block: a slightly tapered body with a darker band and a cream trim.
  c.beginPath(); c.moveTo(x + inset, by - 2 * pt); c.lineTo(x + w - inset, by - 2 * pt); c.lineTo(x + w - inset * 0.6, by + bh); c.lineTo(x + inset * 0.6, by + bh); c.closePath();
  c.fillStyle = '#A8723E'; c.fill(); c.lineWidth = 2.5 * pt; c.strokeStyle = INK; c.stroke();
  c.save(); c.clip();
  c.fillStyle = '#C68A4E'; c.fillRect(x, by, w * 0.5, bh);
  c.fillStyle = '#8E5E32'; c.fillRect(x, by + bh * 0.62, w, bh * 0.12);
  c.fillStyle = 'rgba(255,240,210,0.55)'; c.fillRect(x, by + bh * 0.08, w, bh * 0.06);
  c.strokeStyle = 'rgba(90,50,20,0.35)'; c.lineWidth = 1.2 * pt;
  for (let i = 0; i < 4; i++) { c.beginPath(); for (let u = 0; u <= bh; u += 6) { const xx = x + inset + (i + 0.6) * (w - inset * 2) / 4 + Math.sin(u / (s * 0.5) + i) * s * 0.03; if (u) c.lineTo(xx, by + u); else c.moveTo(xx, by + u); } c.stroke(); }
  c.restore();
  // Feet.
  c.fillStyle = '#7A5230';
  for (const fx of [x + inset * 0.6 - 2 * pt, x + w - inset * 0.6 - s * 0.45 + 2 * pt]) { rr(c, fx, by + bh - s * 0.12, s * 0.45, s * 0.2, s * 0.06); c.fill(); c.lineWidth = 2 * pt; c.strokeStyle = INK; c.stroke(); }
  c.restore();
  drawSlab(c, x, y, w, h, 0, pt);
}

export interface BakedSlab {
  canvas: HTMLCanvasElement;
  /** The centre of the top surface, as a fraction of the canvas size, for setOrigin(). */
  originX: number;
  originY: number;
  s: number;
}

/** Bake biome `bi`'s slab `widthBlocks` wide at `s` px per block. Origin: centre of the top surface. */
export function bakeSlab(bi: number, widthBlocks: number, s: number): BakedSlab {
  const pt = s / 32, w = widthBlocks * s, h = SLAB_DEPTH * s;
  const padX = Math.ceil(bi === 5 ? h * 1.3 : s * 0.4), padTop = Math.ceil(bi === 4 ? h * 2.3 : s * 0.5), padBot = Math.ceil(bi === 2 ? h * 0.9 : s * 0.3);
  const canvas = makeCanvas(w + padX * 2, h + padTop + padBot), c = ctx2d(canvas);
  drawSlab(c, padX, padTop, w, h, bi, pt);
  return { canvas, originX: (padX + w / 2) / canvas.width, originY: padTop / canvas.height, s };
}

/** Pedestal height from its top surface to the grass, in blocks: place its top this far above the ground. */
export const pedestalHeight = (legs = 1.6): number => SLAB_DEPTH + legs;

/** Bake the Meadow's starting pedestal. Origin: centre of the top surface. */
export function bakePedestal(widthBlocks: number, s: number, legs = 1.6): BakedSlab {
  const pt = s / 32, w = widthBlocks * s, pad = Math.ceil(s * 0.4);
  const canvas = makeCanvas(w + pad * 2, (SLAB_DEPTH + legs + 0.2) * s + pad * 2), c = ctx2d(canvas);
  drawPedestal(c, pad, pad, w, s, legs, pt);
  return { canvas, originX: (pad + w / 2) / canvas.width, originY: pad / canvas.height, s };
}

export type Grade = 'S' | 'A' | 'B' | 'C';
const GRADE_COLORS: Record<Grade, [string, string]> = { S: ['#FFE58F', '#FFC23D'], A: ['#F4F6FB', '#C9CFDD'], B: ['#F2C08A', '#D18A4A'], C: ['#FFF7E8', '#E9E1D2'] };

/** The grade stamp that slams onto a new slab (§6.2), about 1.1 blocks across. Origin at the centre. */
export function bakeGradeStamp(g: Grade, s: number): HTMLCanvasElement {
  const pt = s / 32, r = s * 0.55, size = Math.ceil(r * 2 + 12 * pt);
  const canvas = makeCanvas(size, size), c = ctx2d(canvas), m = size / 2;
  const [hi, lo] = GRADE_COLORS[g];
  c.beginPath(); circ(c, m, m + 3 * pt, r); c.fillStyle = INK; c.fill();
  const gr = c.createLinearGradient(0, m - r, 0, m + r); gr.addColorStop(0, hi); gr.addColorStop(1, lo);
  c.beginPath(); circ(c, m, m, r); c.fillStyle = gr; c.fill(); c.lineWidth = 3 * pt; c.strokeStyle = INK; c.stroke();
  c.beginPath(); circ(c, m, m, r * 0.78); c.lineWidth = 1.5 * pt; c.strokeStyle = 'rgba(34,24,58,0.35)'; c.stroke();
  c.font = `700 ${Math.round(r * 1.05)}px ${FONT_DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineJoin = 'round'; c.lineWidth = 4 * pt; c.strokeStyle = '#FFFFFF'; c.strokeText(g, m, m + r * 0.06);
  c.fillStyle = INK; c.fillText(g, m, m + r * 0.06);
  if (g === 'S') { c.fillStyle = '#FFFFFF'; for (const [a, d] of [[-0.8, 1.05], [0.5, 1.12], [2.3, 1.02]]) star4(c, m + Math.cos(a) * r * d, m + Math.sin(a) * r * d, 4 * pt); }
  return canvas;
}
