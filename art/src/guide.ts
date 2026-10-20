// Landing guide parts (art-direction.md §5): the ghost's dashed double-stroke edge, beam fill and
// chevrons, contact dot and ring, state glyphs.
// White parts are meant to be tinted per state by the view; colored parts are baked in their color.

import { ART, GUIDE_TINT, INK, SIGNAL } from './config.ts';
import { PIECE_PAD, type Baked } from './piece.ts';
import { silhouette } from './geometry.ts';
import { pose } from './shapes.ts';
import { type Ctx, circ, ctx2d, makeCanvas, rgba } from './util.ts';

/** Edge looks: the four landing states that show a ghost, plus perfect fit (gold). */
export type EdgeState = 'stable' | 'risky' | 'tip' | 'perfect';
export type GlyphState = 'risky' | 'tip' | 'miss' | 'perfect';

export const edgeColor = (st: EdgeState): string => (st === 'perfect' ? SIGNAL.gold : GUIDE_TINT[st]);

function frame(key: string, q: number, s: number): { canvas: HTMLCanvasElement; c: Ctx; path: Path2D; w: number; h: number; pad: number } {
  const p = pose(key, q), pad = Math.ceil(PIECE_PAD * s);
  const canvas = makeCanvas(p.w * s + pad * 2, p.h * s + pad * 2), c = ctx2d(canvas);
  c.translate(pad, pad);
  return { canvas, c, path: silhouette(p, s), w: p.w * s, h: p.h * s, pad };
}
const done = (f: { canvas: HTMLCanvasElement; w: number; h: number; pad: number }, s: number): Baked =>
  ({ canvas: f.canvas, originX: (f.pad + f.w / 2) / f.canvas.width, originY: (f.pad + f.h / 2) / f.canvas.height, s });

/**
 * The ghost's edge: 2 pt dashes edged with Ink on both sides, so it reads on white cloud and black
 * space. The dashes are white: tint the sprite with edgeColor(state). High contrast swaps the dashes
 * for a solid 3 pt stroke (§5.3 settings). The ghost's fill is the white silhouette tinted with the
 * shape's base color at ART.guide.ghostFill.
 */
export function bakeGhostEdge(key: string, q: number, s: number, highContrast = false): Baked {
  const f = frame(key, q, s), c = f.c, pt = s / 32;
  c.lineJoin = 'round'; c.lineCap = 'butt';
  if (!highContrast) c.setLineDash([s * 0.19, s * 0.125]);
  c.lineWidth = (highContrast ? 6 : 5) * pt; c.strokeStyle = INK; c.stroke(f.path);
  c.lineWidth = (highContrast ? 3 : 2.4) * pt; c.strokeStyle = '#FFFFFF'; c.stroke(f.path);
  return done(f, s);
}

/**
 * One beam chevron per tile, white with a faint Ink edge so it shows on white cloud.
 * Use as a vertical TileSprite; tint per state and scroll it down at ART.guide.chevronSpeed.
 */
export function bakeChevron(s: number): HTMLCanvasElement {
  const pt = s / 32, w = Math.ceil(16 * pt), h = Math.ceil(ART.guide.chevronSpacing * s);
  const canvas = makeCanvas(w, h), c = ctx2d(canvas), cx = canvas.width / 2, cy = canvas.height / 2;
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(cx - 6 * pt, cy - 3 * pt); c.lineTo(cx, cy + 3 * pt); c.lineTo(cx + 6 * pt, cy - 3 * pt);
  c.lineWidth = 4 * pt; c.strokeStyle = rgba(INK, 0.25); c.stroke();
  c.lineWidth = 2 * pt; c.strokeStyle = 'rgba(255,255,255,0.75)'; c.stroke();
  return canvas;
}

/** Beam fill: a white vertical fade (20% to 6%). Stretch it over the drop column and tint it. */
export function bakeBeamFill(): HTMLCanvasElement {
  const canvas = makeCanvas(4, 128), c = ctx2d(canvas);
  const gr = c.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, `rgba(255,255,255,${ART.guide.beamFillTop})`); gr.addColorStop(1, `rgba(255,255,255,${ART.guide.beamFillBottom})`);
  c.fillStyle = gr; c.fillRect(0, 0, 4, 128);
  return canvas;
}

/** Contact dot: white with an Ink ring (4 pt radius at 32 pt per block). Origin at the centre. */
export function bakeContactDot(s: number): HTMLCanvasElement {
  const pt = s / 32, r = 4 * pt, size = Math.ceil((r + 2 * pt) * 2);
  const canvas = makeCanvas(size, size), c = ctx2d(canvas), m = size / 2;
  c.beginPath(); circ(c, m, m, r); c.fillStyle = '#FFFFFF'; c.fill(); c.lineWidth = 1.6 * pt; c.strokeStyle = INK; c.stroke();
  return canvas;
}

/** The expanding ring around a contact dot, at its largest (15 pt radius). Scale it up from 0.27 and fade it. */
export function bakeContactRing(s: number): HTMLCanvasElement {
  const pt = s / 32, r = 15 * pt, size = Math.ceil((r + 2 * pt) * 2);
  const canvas = makeCanvas(size, size), c = ctx2d(canvas), m = size / 2;
  c.beginPath(); circ(c, m, m, r); c.lineWidth = 2 * pt; c.strokeStyle = '#FFFFFF'; c.stroke();
  return canvas;
}

/** Draw a state glyph centred at (x, y) with radius r: a colored disc with an Ink symbol and drop. */
export function drawGlyph(c: Ctx, st: GlyphState, x: number, y: number, r: number): void {
  const col = st === 'perfect' ? SIGNAL.gold : GUIDE_TINT[st];
  c.save(); c.translate(x, y);
  c.beginPath(); circ(c, 0, r * 0.15, r); c.fillStyle = INK; c.fill();
  c.beginPath(); circ(c, 0, 0, r); c.fillStyle = col; c.fill(); c.lineWidth = Math.max(1.5, r * 0.2); c.strokeStyle = INK; c.stroke();
  c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = Math.max(1.6, r * 0.2); c.lineCap = 'round'; c.lineJoin = 'round';
  if (st === 'perfect') {
    c.beginPath();
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? r * 0.3 : r * 0.68; if (i) c.lineTo(Math.cos(a) * q, Math.sin(a) * q); else c.moveTo(Math.cos(a) * q, Math.sin(a) * q); }
    c.closePath(); c.fill();
  } else if (st === 'risky') {
    c.save(); c.rotate(0.45); c.strokeRect(-r * 0.3, -r * 0.55, r * 0.6, r * 0.6); c.restore();
    c.beginPath(); c.moveTo(-r * 0.6, r * 0.45); c.lineTo(r * 0.6, r * 0.45); c.stroke();
  } else if (st === 'tip') {
    c.save(); c.rotate(0.9); c.strokeRect(-r * 0.28, -r * 0.5, r * 0.56, r * 0.56); c.restore();
    c.beginPath(); c.arc(0, 0, r * 0.62, -2.6, -0.9); c.stroke();
    c.beginPath(); c.moveTo(r * 0.48, -r * 0.62); c.lineTo(r * 0.38, -r * 0.3); c.lineTo(r * 0.05, -r * 0.42); c.stroke();
  } else {
    c.beginPath(); c.moveTo(-r * 0.42, -r * 0.42); c.lineTo(r * 0.42, r * 0.42); c.moveTo(r * 0.42, -r * 0.42); c.lineTo(-r * 0.42, r * 0.42); c.stroke();
  }
  c.restore();
}

/** A glyph texture (10 pt radius at 32 pt per block; the miss ✕ is 11 pt). Origin at the centre. */
export function bakeGlyph(st: GlyphState, s: number): HTMLCanvasElement {
  const pt = s / 32, r = (st === 'miss' ? 11 : 10) * pt, size = Math.ceil(r * 2 + 6 * pt);
  const canvas = makeCanvas(size, size), c = ctx2d(canvas);
  drawGlyph(c, st, size / 2, size / 2 - pt, r);
  return canvas;
}

