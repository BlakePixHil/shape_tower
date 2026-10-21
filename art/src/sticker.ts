// Sticker drawing helpers shared by the icon sets (power-ups, UI): flat fills with a light lip along the
// top, a shade lip along the bottom and an Ink outline (art-direction.md §8.1). Icons draw in a unit box
// centred on the origin, so one drawing serves every size.

import { INK } from './config.ts';
import { type Ctx, TAU } from './util.ts';

/** Ink outline width, in icon units (1 = the icon box). */
export const O = 0.062;

export function ink(c: Ctx, p: Path2D, w = O): void {
  c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = w; c.strokeStyle = INK; c.stroke(p);
}

/** Fill a part with a light lip along its top and a shade lip along its bottom, then outline it. */
export function part(c: Ctx, p: Path2D, base: string, light: string, shade: string, lip = 0.06): void {
  c.save(); c.clip(p);
  c.fillStyle = light; c.fill(p);
  c.translate(0, lip); c.fillStyle = base; c.fill(p);
  c.translate(0, -lip * 2.2);
  const band = new Path2D(); band.rect(-2, -2, 4, 4); band.addPath(p);
  c.fillStyle = shade; c.fill(band, 'evenodd');
  c.restore();
  ink(c, p);
}

export function rrPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath();
  return p;
}

export const circlePath = (x: number, y: number, r: number): Path2D => { const p = new Path2D(); p.arc(x, y, r, 0, TAU); return p; };

/** Rotate a path by deg about the origin, then move it. Lighting stays screen-up because the lips are added after. */
export function turn(p: Path2D, deg: number, x: number, y: number): Path2D {
  const q = new Path2D(); q.addPath(p, new DOMMatrix().translateSelf(x, y).rotateSelf(deg)); return q;
}

export function twinkle(x: number, y: number, r: number): Path2D {
  const p = new Path2D(), k = r * 0.26;
  p.moveTo(x, y - r); p.quadraticCurveTo(x + k, y - k, x + r, y); p.quadraticCurveTo(x + k, y + k, x, y + r);
  p.quadraticCurveTo(x - k, y + k, x - r, y); p.quadraticCurveTo(x - k, y - k, x, y - r); p.closePath();
  return p;
}

export function heart(x: number, y: number, k: number): Path2D {
  const p = new Path2D();
  p.moveTo(x, y + k * 0.42);
  p.bezierCurveTo(x - k * 0.62, y + k * 0.02, x - k * 0.5, y - k * 0.5, x, y - k * 0.18);
  p.bezierCurveTo(x + k * 0.5, y - k * 0.5, x + k * 0.62, y + k * 0.02, x, y + k * 0.42);
  p.closePath();
  return p;
}

