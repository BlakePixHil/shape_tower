// Checkpoint line parts (art-direction.md §7.1-7.2, §9.2): the rope with bunting in the shape
// colors, the numbered plaque, the hold-steady ring ticks and label, the planted flag of a claimed
// line, and the personal-best marker. The line is a gameplay object, so it gets Ink outlines.

import { FONT_DISPLAY, INK, SIGNAL } from './config.ts';
import type { Baked } from './piece.ts';
import { ART_SHAPES } from './shapes.ts';
import { type Ctx, TAU, circ, ctx2d, makeCanvas, rr, star4 } from './util.ts';

/** Bunting colors, in order along the rope: the seven tetromino hues. */
export const BUNTING_KEYS = ['I', 'O', 'T', 'L', 'J', 'S', 'Z'] as const;

export const CHECKPOINT = {
  /** Rope thickness, blocks. */
  rope: 0.2,
  /** Distance between pennants, blocks. */
  pennantSpacing: 0.75,
  /** Plaque radius, blocks. */
  plaqueR: 0.6,
  /** Hold-steady ring: tick count and radius, blocks. */
  holdTicks: 24,
  holdR: 0.86,
  /** Claimed flag: pole height above the rope, blocks. */
  flagPole: 1.5,
  /** Flag wave frames. */
  flagFrames: 4,
} as const;

const ROPE = {
  live: { base: '#FFF1D6', strand: '#E3C08A', hi: '#FFFFFF' },
  gold: { base: SIGNAL.gold, strand: '#E0A100', hi: '#FFE58F' },
};

/**
 * One tile of rope, 0.5 blocks long, that repeats seamlessly along x (use a TileSprite).
 * The active line's rope is cream; a claimed line's rope is gold (§7.2).
 */
export function bakeRopeTile(s: number, claimed: boolean): HTMLCanvasElement {
  const pt = s / 32, w = Math.max(4, Math.round(s * 0.5)), rh = CHECKPOINT.rope * s, h = Math.ceil(rh + 4 * pt);
  const canvas = makeCanvas(w, h), c = ctx2d(canvas), y0 = (canvas.height - rh) / 2, col = claimed ? ROPE.gold : ROPE.live;
  c.fillStyle = col.base; c.fillRect(0, y0, w, rh);
  // Twisted strands: two per tile so the pattern wraps exactly.
  const step = w / 2, slant = rh * 0.9;
  c.save(); c.beginPath(); c.rect(0, y0, w, rh); c.clip();
  for (let i = -2; i <= 4; i++) {
    const x = i * step;
    c.beginPath(); c.moveTo(x, y0 + rh); c.lineTo(x + slant, y0); c.lineTo(x + slant + step * 0.42, y0); c.lineTo(x + step * 0.42, y0 + rh); c.closePath();
    c.fillStyle = col.strand; c.fill();
    c.beginPath(); c.moveTo(x + step * 0.5, y0 + rh * 0.7); c.lineTo(x + step * 0.5 + slant * 0.55, y0 + rh * 0.12);
    c.lineWidth = 1.4 * pt; c.lineCap = 'round'; c.strokeStyle = col.hi; c.globalAlpha = 0.7; c.stroke(); c.globalAlpha = 1;
  }
  c.restore();
  c.fillStyle = INK;
  c.fillRect(0, y0 - 1.6 * pt, w, 1.8 * pt);
  c.fillRect(0, y0 + rh - 0.2 * pt, w, 1.8 * pt);
  return canvas;
}

/** A pennant in shape color `i` (BUNTING_KEYS), hanging from its top edge. Origin: top centre. */
export function bakePennant(i: number, s: number): Baked {
  const pt = s / 32, w = s * 0.46, h = s * 0.6, pad = Math.ceil(4 * pt);
  const canvas = makeCanvas(w + pad * 2, h + pad * 2), c = ctx2d(canvas);
  const sh = ART_SHAPES[BUNTING_KEYS[((i % 7) + 7) % 7]];
  c.translate(pad, pad);
  const tri = new Path2D(); tri.moveTo(0, 0); tri.lineTo(w, 0); tri.lineTo(w / 2, h); tri.closePath();
  c.save(); c.clip(tri);
  c.fillStyle = sh.base; c.fillRect(0, 0, w, h);
  c.fillStyle = sh.light; c.fillRect(0, 0, w, h * 0.2);
  c.fillStyle = sh.shade; c.beginPath(); c.moveTo(w, 0); c.lineTo(w / 2, h); c.lineTo(w * 0.62, 0); c.closePath(); c.globalAlpha = 0.45; c.fill();
  c.restore();
  c.lineJoin = 'round'; c.lineWidth = 2 * pt; c.strokeStyle = INK; c.stroke(tri);
  return { canvas, originX: (pad + w / 2) / canvas.width, originY: pad / canvas.height, s };
}

/** The checkpoint's numbered plaque: a gold medallion with "CP" over the number. Origin: centre. */
export function bakePlaque(n: number, s: number): HTMLCanvasElement {
  const pt = s / 32, r = CHECKPOINT.plaqueR * s, size = Math.ceil(r * 2 + 10 * pt);
  const canvas = makeCanvas(size, size), c = ctx2d(canvas), m = size / 2;
  c.beginPath(); circ(c, m, m + 3 * pt, r); c.fillStyle = INK; c.fill();
  const gr = c.createLinearGradient(0, m - r, 0, m + r); gr.addColorStop(0, '#FFE58F'); gr.addColorStop(0.55, SIGNAL.gold); gr.addColorStop(1, '#F0A92A');
  c.beginPath(); circ(c, m, m, r); c.fillStyle = gr; c.fill(); c.lineWidth = 3 * pt; c.strokeStyle = INK; c.stroke();
  c.beginPath(); circ(c, m, m, r * 0.8); c.lineWidth = 1.5 * pt; c.strokeStyle = 'rgba(34,24,58,0.3)'; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.7)'; c.beginPath(); c.ellipse(m - r * 0.38, m - r * 0.52, r * 0.22, r * 0.11, -0.6, 0, TAU); c.fill();
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  c.font = `700 ${Math.round(r * 0.36)}px ${FONT_DISPLAY}`; c.fillStyle = 'rgba(34,24,58,0.75)';
  c.fillText('CP', m, m - r * 0.46);
  const label = String(n), fs = Math.round(r * (label.length > 2 ? 0.66 : label.length > 1 ? 0.82 : 0.95));
  c.font = `700 ${fs}px ${FONT_DISPLAY}`;
  c.lineWidth = 3.5 * pt; c.strokeStyle = '#FFFFFF'; c.strokeText(label, m, m + r * 0.16);
  c.fillStyle = INK; c.fillText(label, m, m + r * 0.16);
  return canvas;
}

/** One tick of the hold-steady ring: white with an Ink edge, so it tints mint when lit. Origin: centre. */
export function bakeHoldTick(s: number): HTMLCanvasElement {
  const pt = s / 32, w = s * 0.1, h = s * 0.26, pad = Math.ceil(2 * pt);
  const canvas = makeCanvas(w + pad * 2, h + pad * 2), c = ctx2d(canvas);
  rr(c, pad, pad, w, h, w / 2); c.fillStyle = '#FFFFFF'; c.fill(); c.lineWidth = 1.6 * pt; c.strokeStyle = INK; c.stroke();
  return canvas;
}

/** A word in the display face, white with an Ink edge ("HOLD STEADY!", "BEST"). Origin: centre. */
export function bakeLabel(text: string, s: number, size = 0.36): HTMLCanvasElement {
  const pt = s / 32, fs = Math.round(size * s), probe = ctx2d(makeCanvas(1, 1));
  probe.font = `700 ${fs}px ${FONT_DISPLAY}`;
  const w = probe.measureText(text).width, pad = Math.ceil(5 * pt);
  const canvas = makeCanvas(w + pad * 2, fs * 1.3 + pad * 2), c = ctx2d(canvas);
  c.font = probe.font; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  c.lineWidth = 4.5 * pt; c.strokeStyle = INK; c.strokeText(text, canvas.width / 2, canvas.height / 2);
  c.fillStyle = '#FFFFFF'; c.fillText(text, canvas.width / 2, canvas.height / 2);
  return canvas;
}

function drawFlag(c: Ctx, s: number, pt: number, pole: number, cloth: [number, number], color: string, phase: number, star: boolean): void {
  const [cw, ch] = cloth, top = -pole * s, amp = 0.06 * s;
  // Pole.
  rr(c, -0.05 * s, top, 0.1 * s, pole * s, 0.05 * s); c.fillStyle = '#FFF7E8'; c.fill(); c.lineWidth = 2 * pt; c.strokeStyle = INK; c.stroke();
  // Cloth: a waving rectangle hung from the top of the pole.
  const x0 = 0.05 * s, n = 10, wave = (x: number) => Math.sin(phase + (x / (cw * s)) * Math.PI * 1.6) * amp * (x / (cw * s));
  c.beginPath(); c.moveTo(x0, top + 0.06 * s);
  for (let i = 1; i <= n; i++) { const x = (i / n) * cw * s; c.lineTo(x0 + x, top + 0.06 * s + wave(x)); }
  for (let i = n; i >= 0; i--) { const x = (i / n) * cw * s; c.lineTo(x0 + x, top + 0.06 * s + ch * s + wave(x)); }
  c.closePath();
  c.fillStyle = color; c.fill(); c.lineJoin = 'round'; c.lineWidth = 2 * pt; c.strokeStyle = INK; c.stroke();
  if (star) { const sx = x0 + cw * s * 0.48; c.fillStyle = '#FFFFFF'; star4(c, sx, top + 0.06 * s + ch * s / 2 + wave(cw * s * 0.48), ch * s * 0.3); }
  // Finial.
  c.beginPath(); circ(c, 0, top, 0.1 * s); c.fillStyle = SIGNAL.gold; c.fill(); c.lineWidth = 1.8 * pt; c.strokeStyle = INK; c.stroke();
}

/** The flag planted on a claimed line, wave frame `f` of CHECKPOINT.flagFrames. Origin: foot of the pole. */
export function bakeFlag(f: number, s: number): Baked {
  const pt = s / 32, pole = CHECKPOINT.flagPole, cw = 0.85, pad = Math.ceil(0.2 * s);
  const canvas = makeCanvas((cw + 0.2) * s + pad * 2, (pole + 0.2) * s + pad * 2), c = ctx2d(canvas);
  const ox = pad + 0.1 * s, oy = canvas.height - pad;
  c.translate(ox, oy);
  drawFlag(c, s, pt, pole, [cw, 0.55], SIGNAL.gold, (f / CHECKPOINT.flagFrames) * TAU, true);
  return { canvas, originX: ox / canvas.width, originY: oy / canvas.height, s };
}

/** The personal-best flag: smaller and mint. Origin: foot of the pole. */
export function bakePbFlag(s: number): Baked {
  const pt = s / 32, pole = 0.95, cw = 0.6, pad = Math.ceil(0.2 * s);
  const canvas = makeCanvas((cw + 0.2) * s + pad * 2, (pole + 0.2) * s + pad * 2), c = ctx2d(canvas);
  const ox = pad + 0.1 * s, oy = canvas.height - pad;
  c.translate(ox, oy);
  drawFlag(c, s, pt, pole, [cw, 0.4], SIGNAL.mint, 0.8, true);
  return { canvas, originX: ox / canvas.width, originY: oy / canvas.height, s };
}

/** One dash of the personal-best line, white with an Ink edge, as a repeating tile 0.5 blocks long. */
export function bakePbDash(s: number): HTMLCanvasElement {
  const pt = s / 32, w = Math.max(4, Math.round(s * 0.5)), th = 0.08 * s, h = Math.ceil(th + 4 * pt);
  const canvas = makeCanvas(w, h), c = ctx2d(canvas);
  rr(c, 1.5 * pt, (canvas.height - th) / 2, w * 0.5, th, th / 2); c.fillStyle = '#FFFFFF'; c.fill(); c.lineWidth = 1.5 * pt; c.strokeStyle = INK; c.stroke();
  return canvas;
}

/** A soft white band (Gaussian across its height) for the line's glow. Stretch it and tint it gold. */
export function bakeGlowBand(): HTMLCanvasElement {
  const canvas = makeCanvas(4, 64), c = ctx2d(canvas), img = c.createImageData(4, 64);
  for (let y = 0; y < 64; y++) {
    const a = Math.exp(-(((y + 0.5 - 32) / 13) ** 2));
    for (let x = 0; x < 4; x++) { const i = (y * 4 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255); }
  }
  c.putImageData(img, 0, 0);
  return canvas;
}

/** A soft white glint that runs along the rope while the player holds steady. Origin: centre. */
export function bakeGlint(s: number): HTMLCanvasElement {
  const w = Math.ceil(s * 1.2), h = Math.ceil(s * 0.4), canvas = makeCanvas(w, h), c = ctx2d(canvas);
  c.translate(w / 2, h / 2); c.scale(w / h, 1);
  const gr = c.createRadialGradient(0, 0, 0, 0, 0, h / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = gr; c.beginPath(); circ(c, 0, 0, h / 2); c.fill();
  return canvas;
}
