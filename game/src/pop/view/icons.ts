// Blockling Pop's power icons and bubbles (Pop plan §7, §8). Undo, Sweep (Art's broom) and Second Wind
// come from Art's kit as they are. Spin, Meteor and Fresh Deal are plain stand-ins drawn here until
// Art's own land in art/src/powers.ts; then they switch over and this file keeps only the names.

import { INK, POWER_COLORS, drawPowerIcon } from '@art/index.ts';
import type { PopPower } from '../sim/pop.ts';

export const POP_POWER_COLORS: Record<PopPower, string> = {
  undo: POWER_COLORS.undo,
  spin: '#FF7FC8',
  sweep: POWER_COLORS.clean,
  meteor: '#FF8A3D',
  fresh: '#5EC8FF',
};

export const POP_POWER_NAMES: Record<PopPower, string> = { undo: 'Undo', spin: 'Spin', sweep: 'Sweep', meteor: 'Meteor', fresh: 'Fresh Deal' };
export const POP_POWER_TAGS: Record<PopPower, string> = { undo: 'UNDO', spin: 'SPIN', sweep: 'SWEEP', meteor: 'METEOR', fresh: 'FRESH' };

type C = CanvasRenderingContext2D;
const LW = 0.06;

function inked(c: C, p: Path2D, fill: string): void {
  c.fillStyle = fill;
  c.fill(p);
  c.strokeStyle = INK;
  c.lineWidth = LW;
  c.lineJoin = 'round';
  c.stroke(p);
}

function rr(x: number, y: number, w: number, h: number, r: number): Path2D {
  const p = new Path2D();
  p.roundRect(x, y, w, h, r);
  return p;
}

/** Spin: a pink Blockling with two turning arrows round it. */
function drawSpin(c: C): void {
  inked(c, rr(-0.2, -0.2, 0.4, 0.4, 0.08), POP_POWER_COLORS.spin);
  c.fillStyle = INK;
  for (const x of [-0.07, 0.07]) { c.beginPath(); c.arc(x, -0.02, 0.035, 0, Math.PI * 2); c.fill(); }
  c.lineCap = 'round';
  for (const a0 of [-0.35, Math.PI - 0.35]) {
    const arc = new Path2D();
    arc.arc(0, 0, 0.38, a0, a0 + 1.9);
    c.strokeStyle = INK; c.lineWidth = 0.13; c.stroke(arc);
    c.strokeStyle = '#FFFFFF'; c.lineWidth = 0.07; c.stroke(arc);
    const a1 = a0 + 1.9, hx = Math.cos(a1) * 0.38, hy = Math.sin(a1) * 0.38;
    const tx = -Math.sin(a1), ty = Math.cos(a1);
    const head = new Path2D();
    head.moveTo(hx + tx * 0.13, hy + ty * 0.13);
    head.lineTo(hx - ty * 0.11, hy + tx * 0.11);
    head.lineTo(hx + ty * 0.11, hy - tx * 0.11);
    head.closePath();
    inked(c, head, '#FFFFFF');
  }
}

/** Meteor: a stone with a flame tail, streaking down to the left. */
function drawMeteor(c: C): void {
  const tail = new Path2D();
  tail.moveTo(-0.05, -0.24);
  tail.quadraticCurveTo(0.25, -0.38, 0.46, -0.46);
  tail.quadraticCurveTo(0.34, -0.2, 0.24, 0.05);
  tail.closePath();
  inked(c, tail, '#FFC23D');
  const inner = new Path2D();
  inner.moveTo(0.02, -0.15);
  inner.quadraticCurveTo(0.22, -0.28, 0.36, -0.36);
  inner.quadraticCurveTo(0.26, -0.18, 0.16, 0.0);
  inner.closePath();
  c.fillStyle = '#FF6A3D'; c.fill(inner);
  const rock = new Path2D();
  rock.arc(-0.1, 0.1, 0.27, 0, Math.PI * 2);
  inked(c, rock, '#A8927E');
  c.fillStyle = 'rgba(80,60,44,0.4)';
  for (const [x, y, r] of [[-0.2, 0.04, 0.05], [-0.02, 0.2, 0.04], [-0.15, 0.22, 0.03]]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse(-0.18, -0.04, 0.06, 0.035, -0.6, 0, Math.PI * 2); c.fill();
}

/** Fresh Deal: three tray tiles fanned like cards, with a sparkle. */
function drawFresh(c: C): void {
  const cols = ['#FFE08A', '#A6F4C5', POP_POWER_COLORS.fresh];
  [-0.38, 0, 0.38].forEach((a, i) => {
    c.save();
    c.translate(0, 0.32);
    c.rotate(a);
    inked(c, rr(-0.14, -0.6, 0.28, 0.42, 0.06), '#FFF7E8');
    c.fillStyle = cols[i];
    c.fill(rr(-0.08, -0.52, 0.16, 0.16, 0.03));
    c.restore();
  });
  const s = new Path2D();
  const x = 0.33, y = -0.3, r = 0.11;
  s.moveTo(x, y - r); s.quadraticCurveTo(x, y, x + r, y); s.quadraticCurveTo(x, y, x, y + r); s.quadraticCurveTo(x, y, x - r, y); s.quadraticCurveTo(x, y, x, y - r);
  inked(c, s, '#FFFFFF');
}

const STANDIN: Partial<Record<PopPower, (c: C) => void>> = { spin: drawSpin, meteor: drawMeteor, fresh: drawFresh };

/** Draws power `kind`'s icon centred at (x, y), `size` px across. */
export function drawPopIcon(c: C, kind: PopPower | 'wind', x: number, y: number, size: number): void {
  if (kind === 'undo' || kind === 'wind') { drawPowerIcon(c, kind, x, y, size); return; }
  if (kind === 'sweep') { drawPowerIcon(c, 'clean', x, y, size); return; }
  c.save();
  c.translate(x, y);
  c.scale(size, size);
  STANDIN[kind]!(c);
  c.restore();
}

const baked = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();

/** Power `kind`'s icon baked `px` square (cached). */
export function bakePopIcon(kind: PopPower | 'wind', px: number): HTMLCanvasElement {
  const key = `${kind}:${px}`;
  let cv = baked.get(key);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = Math.max(1, Math.round(px));
    drawPopIcon(cv.getContext('2d')!, kind, cv.width / 2, cv.height / 2, cv.width);
    baked.set(key, cv);
  }
  return cv;
}

/** A PNG URL of the icon for a DOM button, `cssPx` across at the screen's resolution (cached). */
export function popIconUrl(kind: PopPower | 'wind', cssPx: number): string {
  const px = Math.round(cssPx * Math.min(3, window.devicePixelRatio || 1));
  const key = `${kind}:${px}`;
  let u = urls.get(key);
  if (!u) { u = bakePopIcon(kind, px).toDataURL(); urls.set(key, u); }
  return u;
}

/**
 * The bubble a power floats in on the board, `r` px in radius: a soap bubble tinted in the power's
 * colour with an Ink edge, its icon inside and a gloss on top. Cached per kind and size. Origin: centre.
 */
export function bakePopBubble(kind: PopPower, r: number): HTMLCanvasElement {
  const key = `bubble:${kind}:${Math.round(r)}`;
  let cv = baked.get(key);
  if (cv) return cv;
  const pt = r / 19, size = Math.ceil(2 * r + 6 * pt);
  cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d')!, m = size / 2, col = POP_POWER_COLORS[kind];
  const disc = (rad: number) => { c.beginPath(); c.arc(m, m, rad, 0, Math.PI * 2); };
  disc(r);
  const g = c.createRadialGradient(m - r * 0.25, m - r * 0.3, 0, m, m, r);
  g.addColorStop(0, 'rgba(255,255,255,0.3)');
  g.addColorStop(0.6, hexA(col, 0.25));
  g.addColorStop(1, hexA(col, 0.7));
  c.fillStyle = g;
  c.fill();
  drawPopIcon(c, kind, m, m, r * 1.25);
  disc(r - 2.6 * pt); c.strokeStyle = col; c.lineWidth = 3.4 * pt; c.stroke();
  disc(r); c.strokeStyle = 'rgba(34,24,58,0.9)'; c.lineWidth = 2 * pt; c.stroke();
  // The gloss: a white crescent top left and a glint.
  c.beginPath();
  c.arc(m, m, r * 0.8, Math.PI * 1.08, Math.PI * 1.48);
  c.arc(m + r * 0.1, m + r * 0.1, r * 0.8, Math.PI * 1.44, Math.PI * 1.12, true);
  c.closePath();
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.fill();
  c.beginPath(); c.arc(m + r * 0.3, m - r * 0.72, r * 0.07, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill();
  baked.set(key, cv);
  return cv;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
