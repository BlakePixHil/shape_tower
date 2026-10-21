// Celebration textures (art-direction.md §7.1, §9.5): fireworks for crossing the best height, and the
// three milestone celebrations: a balloon release, a rainbow arc and a comet shower. Fireworks and comets
// are light, so they have no outline and their white parts take a tint; balloons and the rainbow are
// stickers with the Ink outline, like the confetti. Sizes in blocks; everything is centred unless noted.

import { BUNTING_KEYS } from './checkpoint.ts';
import { INK } from './config.ts';
import { drawFace } from './face.ts';
import type { Baked } from './piece.ts';
import { ART_SHAPES } from './shapes.ts';
import { rrPath } from './sticker.ts';
import { type Ctx, TAU, ctx2d, makeCanvas } from './util.ts';

/** Natural size of each texture in blocks, [width, height] (padding comes on top). */
export const CELEB = {
  star: [0.4, 0.4],
  trail: [1.3, 0.18],
  balloon: [0.9, 2.1],
  rainbow: [9, 4.6],
  cloud: [2.2, 1.1],
  comet: [3.4, 0.8],
} as const;

/** Balloon colors: one per shape color, in BUNTING_KEYS order. */
export const BALLOONS = BUNTING_KEYS.length;
export type CelebTex = Exclude<keyof typeof CELEB, 'balloon'> | `balloon${0 | 1 | 2 | 3 | 4 | 5 | 6}`;
export const CELEB_TEX: CelebTex[] = ['star', 'trail', 'rainbow', 'cloud', 'comet', ...BUNTING_KEYS.map((_, i) => `balloon${i}` as CelebTex)];

/** The rainbow's bands, outside in: brighter than the Cloudlands backdrop's, in the shape family's hues. */
const BANDS = ['#FF6B7A', '#FFA23D', '#FFD84A', '#5ED15A', '#3FA9F5', '#8C6BFF'];

/** A firework star: a hot core in a soft glow, white so it takes the burst's tint. */
function star(c: Ctx): void {
  const g = c.createRadialGradient(0, 0, 0, 0, 0, 0.2);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.32, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(0, 0, 0.2, 0, TAU); c.fill();
}

/** A tapered streak, its head at the right: the rising shell's trail and the willow's drooping streaks. */
function trail(c: Ctx, w: number, h: number): void {
  const g = c.createLinearGradient(-w / 2, 0, w / 2, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,1)');
  c.fillStyle = g; c.beginPath();
  c.moveTo(-w / 2, 0); c.quadraticCurveTo(0, -h * 0.28, w / 2 - h / 2, -h / 2);
  c.arc(w / 2 - h / 2, 0, h / 2, -Math.PI / 2, Math.PI / 2);
  c.quadraticCurveTo(0, h * 0.28, -w / 2, 0); c.closePath(); c.fill();
}

/** A party balloon in shape color `i` with a knot and a curly string; the odd ones smile. Origin: the balloon's middle. */
function balloon(c: Ctx, i: number, s: number): void {
  const sh = ART_SHAPES[BUNTING_KEYS[i]], rx = 0.36, ry = 0.44, cy = -0.55;
  // String first, so the knot sits over it.
  c.lineCap = 'round'; c.strokeStyle = 'rgba(34,24,58,0.75)'; c.lineWidth = 0.035;
  c.beginPath(); c.moveTo(0, cy + ry + 0.08);
  c.bezierCurveTo(0.2, cy + ry + 0.35, -0.2, cy + ry + 0.6, 0, cy + ry + 0.85);
  c.bezierCurveTo(0.18, cy + ry + 1.05, -0.12, cy + ry + 1.25, 0.04, cy + ry + 1.45);
  c.stroke();
  const knot = new Path2D(); knot.moveTo(0, cy + ry - 0.02); knot.lineTo(0.09, cy + ry + 0.1); knot.lineTo(-0.09, cy + ry + 0.1); knot.closePath();
  c.fillStyle = sh.shade; c.fill(knot);
  c.lineJoin = 'round'; c.lineWidth = 0.05; c.strokeStyle = INK; c.stroke(knot);
  // Body: base, a shade crescent bottom right, a light lip top left, then two glints.
  const body = new Path2D();
  body.moveTo(0, cy - ry);
  body.bezierCurveTo(rx * 1.1, cy - ry, rx * 1.05, cy + ry * 0.55, 0, cy + ry);
  body.bezierCurveTo(-rx * 1.05, cy + ry * 0.55, -rx * 1.1, cy - ry, 0, cy - ry);
  c.save(); c.clip(body);
  c.fillStyle = sh.base; c.fill(body);
  c.fillStyle = sh.shade; c.beginPath(); c.ellipse(rx * 0.35, cy + ry * 0.35, rx * 0.95, ry * 0.95, 0, 0, TAU);
  c.ellipse(rx * 0.1, cy + ry * 0.05, rx * 0.95, ry * 0.95, 0, 0, TAU); c.fill('evenodd');
  c.fillStyle = sh.light; c.beginPath(); c.ellipse(-rx * 0.15, cy - ry * 0.12, rx * 0.95, ry * 0.95, 0, 0, TAU);
  c.ellipse(-rx * 0.05, cy - ry * 0.02, rx * 0.95, ry * 0.95, 0, 0, TAU); c.fill('evenodd');
  c.restore();
  c.lineWidth = 0.06; c.strokeStyle = INK; c.stroke(body);
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.beginPath(); c.ellipse(-rx * 0.48, cy - ry * 0.42, 0.05, 0.11, 0.45, 0, TAU); c.fill();
  c.beginPath(); c.arc(-rx * 0.6, cy - ry * 0.05, 0.03, 0, TAU); c.fill();
  // Faces draw in pixels (their line widths have pixel floors), so undo the block scale for them.
  if (i % 2) { c.save(); c.scale(1 / s, 1 / s); drawFace(c, 0, (cy + 0.06) * s, 0.62 * s, 'idle', { detail: s * 0.62 >= 20 }); c.restore(); }
}

/** The sticker rainbow: six bands with an Ink edge outside and in, and a white lip along the top. Origin: bottom centre. */
function rainbow(c: Ctx, w: number, h: number): void {
  const R = Math.min(w / 2, h) - 0.12, band = R * 0.075, cy = h / 2 - 0.08;
  const a0 = Math.PI, a1 = TAU;
  BANDS.forEach((col, i) => {
    c.lineWidth = band + 0.01; c.strokeStyle = col;
    c.beginPath(); c.arc(0, cy, R - band * (i + 0.5), a0, a1); c.stroke();
  });
  c.lineWidth = band * 0.32; c.strokeStyle = 'rgba(255,255,255,0.55)';
  c.beginPath(); c.arc(0, cy, R - band * 0.28, a0 + 0.06, a1 - 0.06); c.stroke();
  c.lineWidth = 0.07; c.strokeStyle = INK; c.lineCap = 'butt';
  c.beginPath(); c.arc(0, cy, R, a0, a1); c.stroke();
  c.beginPath(); c.arc(0, cy, R - band * BANDS.length, a0, a1); c.stroke();
}

/** A puffy sticker cloud for the rainbow's feet. Origin: bottom centre. */
function cloud(c: Ctx, h: number): void {
  const b = h / 2 - 0.08, p = rrPath(-0.95, b - 0.32, 1.9, 0.32, 0.16);
  for (const [x, y, r] of [[-0.62, 0.3, 0.3], [-0.2, 0.55, 0.45], [0.32, 0.48, 0.4], [0.72, 0.26, 0.28]]) { p.moveTo(x + r, b - y); p.arc(x, b - y, r, 0, TAU); }
  // The union's outline: a wide Ink stroke under the white fill, then a shade band along the bottom.
  c.lineJoin = 'round'; c.lineWidth = 0.13; c.strokeStyle = INK; c.stroke(p);
  c.fillStyle = '#FFFFFF'; c.fill(p);
  c.save(); c.clip(p); c.fillStyle = '#DCE6F7'; c.fillRect(-1.2, b - 0.14, 2.4, 0.3); c.restore();
}

/** A comet, head at the right with its tail streaming left: white, so it takes a tint. Origin: the head. */
function comet(c: Ctx, w: number, h: number): void {
  const hx = w / 2 - h * 0.5;
  for (const [a, k, bend] of [[0.35, 1, 0.12], [0.75, 0.45, 0]] as [number, number, number][]) {
    const g = c.createLinearGradient(-w / 2, 0, hx, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.65, `rgba(255,255,255,${a * 0.5})`); g.addColorStop(1, `rgba(255,255,255,${a})`);
    c.fillStyle = g; c.beginPath();
    c.moveTo(hx, -h * 0.22 * k); c.quadraticCurveTo(0, -h * 0.42 * k + h * bend, -w / 2, -h * 0.5 * k + h * bend * 1.6);
    c.lineTo(-w / 2, h * 0.5 * k + h * bend * 1.6); c.quadraticCurveTo(0, h * 0.42 * k + h * bend, hx, h * 0.22 * k); c.closePath(); c.fill();
  }
  const g = c.createRadialGradient(hx, 0, 0, hx, 0, h * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.beginPath(); c.arc(hx, 0, h * 0.5, 0, TAU); c.fill();
}

/** Bake celebration texture `name` at `s` px per block. */
export function bakeCelebration(name: CelebTex, s: number): Baked {
  const kind = (name.startsWith('balloon') ? 'balloon' : name) as keyof typeof CELEB, [bw, bh] = CELEB[kind], pad = Math.ceil(0.08 * s);
  const cv = makeCanvas(Math.ceil(bw * s + pad * 2), Math.ceil(bh * s + pad * 2)), c = ctx2d(cv);
  c.translate(cv.width / 2, cv.height / 2); c.scale(s, s);
  let ox = 0.5, oy = 0.5;
  if (kind === 'star') star(c);
  else if (kind === 'trail') trail(c, bw, bh);
  else if (kind === 'balloon') { balloon(c, Number(name.slice(-1)), s); oy = (cv.height / 2 - 0.55 * s) / cv.height; }
  else if (kind === 'rainbow') { rainbow(c, bw, bh); oy = (cv.height / 2 + (bh / 2 - 0.08) * s) / cv.height; }
  else if (kind === 'cloud') { cloud(c, bh); oy = (cv.height / 2 + (bh / 2 - 0.08) * s) / cv.height; }
  else if (kind === 'comet') { comet(c, bw, bh); ox = (cv.width / 2 + (bw / 2 - bh * 0.5) * s) / cv.width; }
  return { canvas: cv, originX: ox, originY: oy, s };
}
