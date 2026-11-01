// Blockling Pop's power icons and bubbles (Pop plan §7, §8). Every icon is Art's (art/src/powers.ts):
// Undo, Sweep (the broom), Spin, Meteor, Fresh Deal and Second Wind. The bubble a power floats in on
// the board is Pop's own, tinted in the power's colour.

import { POWER_COLORS, drawPowerIcon, type PowerIcon } from '@art/index.ts';
import type { PopPower } from '../sim/pop.ts';

export const POP_POWER_COLORS: Record<PopPower, string> = {
  undo: POWER_COLORS.undo,
  spin: POWER_COLORS.spin,
  sweep: POWER_COLORS.clean,
  meteor: POWER_COLORS.meteor,
  fresh: POWER_COLORS.fresh,
};

export const POP_POWER_NAMES: Record<PopPower, string> = { undo: 'Undo', spin: 'Spin', sweep: 'Sweep', meteor: 'Meteor', fresh: 'Fresh Deal' };
export const POP_POWER_TAGS: Record<PopPower, string> = { undo: 'UNDO', spin: 'SPIN', sweep: 'SWEEP', meteor: 'METEOR', fresh: 'FRESH' };

type C = CanvasRenderingContext2D;

/** Art's icon for each power (Sweep is Art's broom, 'clean'). */
const ART_ICON: Record<PopPower | 'wind', PowerIcon> = { undo: 'undo', spin: 'spin', sweep: 'clean', meteor: 'meteor', fresh: 'fresh', wind: 'wind' };

/** Draws power `kind`'s icon centred at (x, y), `size` px across. */
export function drawPopIcon(c: C, kind: PopPower | 'wind', x: number, y: number, size: number): void {
  drawPowerIcon(c, ART_ICON[kind], x, y, size);
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
