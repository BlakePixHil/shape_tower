// Avatar hats (art-direction.md §8.4, §9.6: "avatar builder parts, about 6 hats to start"). Stickers like
// the icons: flat fills, a light lip on top, a shade lip below and the Ink outline. Each draws in units
// of its base width with the origin at the middle of its base (where it sits on the head), y up negative.

import { INK } from '../config.ts';
import { ART_SHAPES } from '../shapes.ts';
import { circlePath, ink, part, rrPath } from '../sticker.ts';
import { type Ctx, TAU, ctx2d, makeCanvas } from '../util.ts';

export type Hat = 'party' | 'cap' | 'propeller' | 'daisies' | 'tophat' | 'crown';

export interface HatInfo { key: Hat; name: string; /** Profile level that unlocks it. */ level: number; /** Height over base width. */ h: number }

/** The hats in unlock order. The party hat comes with every profile. */
export const HATS: HatInfo[] = [
  { key: 'party', name: 'Party hat', level: 1, h: 1.02 },
  { key: 'cap', name: 'Sky cap', level: 4, h: 0.56 },
  { key: 'propeller', name: 'Propeller beanie', level: 7, h: 0.86 },
  { key: 'daisies', name: 'Daisy chain', level: 9, h: 0.36 },
  { key: 'tophat', name: 'Top hat', level: 12, h: 0.86 },
  { key: 'crown', name: 'Crown', level: 16, h: 0.66 },
];

const O = 0.085;
const C = (k: string): [string, string, string] => { const s = ART_SHAPES[k]; return [s.base, s.light, s.shade]; };
const GOLD: [string, string, string] = ['#FFC23D', '#FFE69A', '#E0961A'];

function party(c: Ctx): void {
  const cone = new Path2D(); cone.moveTo(-0.42, 0); cone.quadraticCurveTo(-0.1, -0.5, 0.06, -0.9); cone.lineTo(0.42, 0); cone.closePath();
  part(c, cone, ...C('T'));
  // Gold stripes across the cone, clipped to it.
  c.save(); c.clip(cone); c.strokeStyle = GOLD[0]; c.lineWidth = 0.1;
  for (const y of [-0.2, -0.5]) { c.beginPath(); c.moveTo(-0.6, y + 0.12); c.lineTo(0.6, y - 0.12); c.stroke(); }
  c.restore();
  ink(c, cone, O);
  const pom = circlePath(0.06, -0.92, 0.12);
  part(c, pom, '#FFFFFF', '#FFFFFF', '#DCE6F7', 0.04); ink(c, pom, O);
}

function cap(c: Ctx): void {
  const brim = new Path2D(); brim.moveTo(0.1, -0.02); brim.quadraticCurveTo(0.6, -0.16, 0.84, -0.04); brim.quadraticCurveTo(0.7, 0.06, 0.1, 0.06); brim.closePath();
  const [base, light, shade] = C('J');
  part(c, brim, shade, base, shade, 0.03);
  const dome = new Path2D(); dome.moveTo(-0.45, 0.02); dome.bezierCurveTo(-0.45, -0.66, 0.45, -0.66, 0.45, 0.02); dome.closePath();
  part(c, dome, base, light, shade);
  c.save(); c.clip(dome); c.strokeStyle = 'rgba(34,24,58,0.35)'; c.lineWidth = 0.035;
  c.beginPath(); c.moveTo(0, -0.5); c.quadraticCurveTo(-0.08, -0.25, -0.05, 0.05); c.stroke(); c.restore();
  ink(c, dome, O);
  const button = circlePath(0, -0.5, 0.07); c.fillStyle = shade; c.fill(button); ink(c, button, O * 0.7);
}

function propeller(c: Ctx): void {
  const dome = new Path2D(); dome.moveTo(-0.44, 0.02); dome.bezierCurveTo(-0.44, -0.6, 0.44, -0.6, 0.44, 0.02); dome.closePath();
  // Four panels in four shape colors.
  c.save(); c.clip(dome);
  const cols = [C('Z')[0], C('O')[0], C('J')[0], C('S')[0]];
  cols.forEach((col, i) => { c.fillStyle = col; c.fillRect(-0.44 + i * 0.22, -0.7, 0.22, 0.8); });
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(-0.5, -0.7, 1, 0.12);
  c.fillStyle = 'rgba(34,24,58,0.18)'; c.fillRect(-0.5, -0.04, 1, 0.1);
  c.restore(); ink(c, dome, O);
  const stem = rrPath(-0.035, -0.62, 0.07, 0.2, 0.03); c.fillStyle = '#AEB4C6'; c.fill(stem); ink(c, stem, O * 0.7);
  for (const [dx, col] of [[-1, C('Z')], [1, C('O')]] as [number, [string, string, string]][]) {
    const blade = new Path2D(); blade.ellipse(dx * 0.22, -0.66, 0.22, 0.07, dx * -0.12, 0, TAU);
    part(c, blade, ...col, 0.02); ink(c, blade, O * 0.8);
  }
  const hub = circlePath(0, -0.66, 0.06); c.fillStyle = GOLD[0]; c.fill(hub); ink(c, hub, O * 0.7);
}

function daisies(c: Ctx): void {
  const vine = new Path2D(); vine.moveTo(-0.5, -0.04); vine.quadraticCurveTo(0, -0.2, 0.5, -0.04);
  c.lineCap = 'round'; c.lineWidth = 0.1 + O; c.strokeStyle = INK; c.stroke(vine);
  c.lineWidth = 0.1; c.strokeStyle = C('S')[0]; c.stroke(vine);
  for (const [x, y, r, rot] of [[-0.42, -0.08, 0.13, 0.2], [-0.15, -0.16, 0.15, 0.7], [0.15, -0.16, 0.15, 0.3], [0.42, -0.08, 0.13, 0.9]]) {
    const petals = new Path2D();
    for (let i = 0; i < 6; i++) { const a = rot + i * TAU / 6; petals.ellipse(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.5, r * 0.3, a, 0, TAU); }
    ink(c, petals, O * 1.6); c.fillStyle = '#FFFFFF'; c.fill(petals);
    const mid = circlePath(x, y, r * 0.38); c.fillStyle = GOLD[0]; c.fill(mid); ink(c, mid, O * 0.6);
  }
}

function tophat(c: Ctx): void {
  const crown = rrPath(-0.3, -0.84, 0.6, 0.78, 0.06);
  part(c, crown, '#4A3A78', '#6D5BA3', '#2E2350');
  const band = new Path2D(); band.rect(-0.3, -0.26, 0.6, 0.14);
  c.save(); c.clip(crown); c.fillStyle = C('Z')[0]; c.fill(band); c.restore();
  ink(c, crown, O);
  const brim = rrPath(-0.5, -0.1, 1.0, 0.13, 0.065);
  part(c, brim, '#4A3A78', '#6D5BA3', '#2E2350', 0.03); ink(c, brim, O);
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(-0.2, -0.76, 0.06, 0.44);
}

function crown(c: Ctx): void {
  const p = new Path2D();
  p.moveTo(-0.4, 0); p.lineTo(-0.44, -0.5); p.lineTo(-0.2, -0.28); p.lineTo(0, -0.58); p.lineTo(0.2, -0.28); p.lineTo(0.44, -0.5); p.lineTo(0.4, 0); p.closePath();
  part(c, p, ...GOLD);
  for (const [x, y] of [[-0.44, -0.52], [0, -0.6], [0.44, -0.52]]) { const b = circlePath(x, y, 0.06); part(c, b, ...GOLD, 0.02); ink(c, b, O * 0.7); }
  for (const [x, col] of [[-0.22, C('Z')], [0, C('J')], [0.22, C('S')]] as [number, [string, string, string]][]) {
    const g = new Path2D(); g.moveTo(x, -0.2); g.lineTo(x + 0.07, -0.12); g.lineTo(x, -0.04); g.lineTo(x - 0.07, -0.12); g.closePath();
    c.fillStyle = col[0]; c.fill(g); ink(c, g, O * 0.6);
  }
  c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse(-0.3, -0.18, 0.03, 0.08, 0.2, 0, TAU); c.fill();
}

const DRAW: Record<Hat, (c: Ctx) => void> = { party, cap, propeller, daisies, tophat, crown };

/** Draw `hat` with the middle of its base at (x, y), `w` px across its base. */
export function drawHat(c: Ctx, hat: Hat, x: number, y: number, w: number): void {
  c.save(); c.translate(x, y); c.scale(w, w);
  c.lineJoin = 'round'; c.lineCap = 'round';
  DRAW[hat](c);
  c.restore();
}

const urls = new Map<string, string>();

/** A hat on its own, centred in a `px` square, as a cached PNG data URL (for pickers and unlock cards). */
export function hatUrl(hat: Hat, cssPx = 48, dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1): string {
  const px = Math.round(cssPx * dpr), id = `${hat}:${px}`;
  let u = urls.get(id);
  if (u) return u;
  const info = HATS.find(h => h.key === hat)!, w = px * 0.8 / Math.max(1.1, info.h + 0.1);
  const cv = makeCanvas(px, px);
  drawHat(ctx2d(cv), hat, px / 2, px / 2 + info.h * w / 2, w);
  u = cv.toDataURL('image/png');
  urls.set(id, u);
  return u;
}
