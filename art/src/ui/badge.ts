// Level badges and titles (art-direction.md §8.4, gameplay.md §10). The badge is a Blockling tile in its
// tier's material with the level number on it: Wood (1-9), Stone (10-19), Bronze (20-29), Silver
// (30-39), Gold (40-49), Crystal (50-69), Cosmic (70+, whose nebula drifts in the DOM). Titles change
// every 5 levels. Load Fredoka before baking: the number is drawn text.

import { FONT_DISPLAY, INK } from '../config.ts';
import { O, ink, part, rrPath, twinkle } from '../sticker.ts';
import { type Ctx, TAU, ctx2d, hash, makeCanvas } from '../util.ts';
import { canvasUrl } from '../urls.ts';

export interface BadgeTier { name: string; from: number; base: string; light: string; shade: string }

export const BADGE_TIERS: BadgeTier[] = [
  { name: 'Wood', from: 1, base: '#D9A066', light: '#F2C891', shade: '#A8723E' },
  { name: 'Stone', from: 10, base: '#A9AFC0', light: '#D4D8E2', shade: '#6E7487' },
  { name: 'Bronze', from: 20, base: '#D08A4E', light: '#F2B98A', shade: '#9A5A2A' },
  { name: 'Silver', from: 30, base: '#C9D1DE', light: '#F4F7FB', shade: '#8E98AB' },
  { name: 'Gold', from: 40, base: '#FFC23D', light: '#FFE08A', shade: '#D9971A' },
  { name: 'Crystal', from: 50, base: '#7FE3F5', light: '#D2F8FF', shade: '#3AA9C9' },
  { name: 'Cosmic', from: 70, base: '#6B3FD9', light: '#B48CFF', shade: '#3A1F8C' },
];

export function badgeTier(level: number): BadgeTier {
  let t = BADGE_TIERS[0];
  for (const b of BADGE_TIERS) if (level >= b.from) t = b;
  return t;
}

/** Titles every 5 levels (§8.4); from level 65 Cosmic Mason counts up in Roman numerals. */
export const TITLES: [number, string][] = [
  [1, 'Pebble Stacker'], [5, 'Brick Layer'], [10, 'Tower Tinkerer'], [15, 'Block Wrangler'], [20, 'Cloud Climber'],
  [25, 'Storm Chaser'], [30, 'Sky Architect'], [35, 'Orbit Mason'], [40, 'Moonwalker'], [45, 'Red Rock Roofer'],
  [50, 'Ring Rider'], [55, 'Star Builder'], [60, 'Cosmic Mason'],
];

function roman(n: number): string {
  const r: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, t] of r) while (n >= v) { s += t; n -= v; }
  return s;
}

export function titleFor(level: number): string {
  if (level >= 65) return `Cosmic Mason ${roman(Math.floor((level - 60) / 5) + 1)}`;
  let t = TITLES[0][1];
  for (const [from, name] of TITLES) if (level >= from) t = name;
  return t;
}

/** True when reaching `level` earns a new title (show the title plate on the level-up). */
export const newTitleAt = (level: number): boolean => level === 1 || level % 5 === 0;

/** Draw the badge for `level` centred at (x, y), `size` px square (ornaments included). */
export function drawBadge(c: Ctx, level: number, x: number, y: number, size: number): void {
  const t = badgeTier(level), n = t.name;
  c.save(); c.translate(x, y); c.scale(size, size);
  // RING drops the Cosmic orbit below the number's middle so three digits stay readable.
  const tile = rrPath(-0.37, -0.33, 0.74, 0.74, 0.17), cy = 0.04, RING = 0.15;

  if (n === 'Cosmic') {
    // The back half of the orbit ring, behind the tile.
    c.save(); c.rotate(-0.3); c.beginPath(); c.ellipse(0, cy + RING, 0.5, 0.15, 0, Math.PI, TAU);
    c.lineWidth = 0.075 + O * 2; c.strokeStyle = INK; c.stroke(); c.lineWidth = 0.075; c.strokeStyle = '#FF9BE0'; c.stroke(); c.restore();
  }
  if (n === 'Gold' || n === 'Crystal' || n === 'Cosmic') {
    // A little crown on top.
    const cr = new Path2D();
    cr.moveTo(-0.17, -0.3); cr.lineTo(-0.2, -0.47); cr.lineTo(-0.09, -0.38); cr.lineTo(0, -0.5); cr.lineTo(0.09, -0.38); cr.lineTo(0.2, -0.47); cr.lineTo(0.17, -0.3); cr.closePath();
    part(c, cr, '#FFC23D', '#FFE08A', '#D9971A', 0.03);
  }

  part(c, tile, t.base, t.light, t.shade, 0.07);
  c.save(); c.clip(tile);
  if (n === 'Wood') {
    c.strokeStyle = 'rgba(140,86,40,0.45)'; c.lineWidth = 0.025; c.lineCap = 'round';
    for (const yy of [-0.2, -0.04, 0.14, 0.3]) { c.beginPath(); c.moveTo(-0.4, yy); c.bezierCurveTo(-0.15, yy - 0.05, 0.1, yy + 0.05, 0.4, yy - 0.02); c.stroke(); }
    c.beginPath(); c.ellipse(0.2, 0.2, 0.06, 0.03, 0, 0, TAU); c.stroke();
  } else if (n === 'Stone') {
    c.fillStyle = 'rgba(70,74,90,0.35)';
    for (let i = 0; i < 18; i++) { c.beginPath(); c.arc(-0.35 + hash(i * 3.1) * 0.7, -0.3 + hash(i * 7.3) * 0.7, 0.012 + 0.012 * hash(i), 0, TAU); c.fill(); }
    c.strokeStyle = 'rgba(70,74,90,0.5)'; c.lineWidth = 0.02; c.beginPath(); c.moveTo(0.37, -0.1); c.lineTo(0.24, -0.02); c.lineTo(0.27, 0.08); c.stroke();
  } else if (n === 'Crystal') {
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.moveTo(-0.37, -0.33); c.lineTo(0, cy); c.lineTo(0.37, -0.33); c.closePath(); c.fill();
    c.fillStyle = 'rgba(30,110,150,0.25)'; c.beginPath(); c.moveTo(-0.37, 0.41); c.lineTo(0, cy); c.lineTo(0.37, 0.41); c.closePath(); c.fill();
  } else if (n === 'Cosmic') {
    const g = c.createRadialGradient(-0.1, -0.1, 0, 0, cy, 0.5);
    g.addColorStop(0, 'rgba(255,155,224,0.75)'); g.addColorStop(0.5, 'rgba(122,92,255,0.35)'); g.addColorStop(1, 'rgba(20,8,50,0.5)');
    c.fillStyle = g; c.fillRect(-0.4, -0.4, 0.8, 0.8);
    c.fillStyle = '#FFFFFF';
    for (let i = 0; i < 12; i++) { c.beginPath(); c.arc(-0.33 + hash(i * 5.7) * 0.66, -0.29 + hash(i * 9.1) * 0.66, 0.008 + 0.012 * hash(i * 2.3), 0, TAU); c.fill(); }
  }
  if (n === 'Bronze' || n === 'Silver' || n === 'Gold') {
    // A diagonal shine and four rivets.
    c.fillStyle = 'rgba(255,255,255,0.32)'; c.beginPath(); c.moveTo(-0.1, -0.4); c.lineTo(0.06, -0.4); c.lineTo(-0.3, 0.45); c.lineTo(-0.46, 0.45); c.closePath(); c.fill();
    for (const [rx, ry] of [[-0.27, -0.23], [0.27, -0.23], [-0.27, 0.31], [0.27, 0.31]]) {
      c.fillStyle = t.shade; c.beginPath(); c.arc(rx, ry + 0.01, 0.035, 0, TAU); c.fill();
      c.fillStyle = t.light; c.beginPath(); c.arc(rx, ry, 0.03, 0, TAU); c.fill();
    }
  }
  c.restore();
  ink(c, tile);

  // The number: white with an Ink outline, smaller for three digits.
  const s = String(level), fs = s.length >= 3 ? 0.3 : s.length === 2 ? 0.4 : 0.46;
  c.font = `700 ${fs}px ${FONT_DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineJoin = 'round'; c.lineWidth = 0.09; c.strokeStyle = INK; c.strokeText(s, 0, cy + 0.015);
  c.fillStyle = '#FFFFFF'; c.fillText(s, 0, cy + 0.015);

  if (n === 'Cosmic') {
    c.save(); c.rotate(-0.3); c.beginPath(); c.ellipse(0, cy + RING, 0.5, 0.15, 0, 0, Math.PI);
    c.lineWidth = 0.075 + O * 2; c.strokeStyle = INK; c.stroke(); c.lineWidth = 0.075; c.strokeStyle = '#FF9BE0'; c.stroke(); c.restore();
  }
  if (n === 'Crystal' || n === 'Cosmic') { const p = twinkle(0.31, -0.27, 0.11); c.fillStyle = '#FFFFFF'; c.fill(p); ink(c, p, O * 0.7); }
  c.restore();
}

export function bakeBadge(level: number, px: number): HTMLCanvasElement {
  const cv = makeCanvas(px, px);
  drawBadge(ctx2d(cv), level, cv.width / 2, cv.height / 2, cv.width);
  return cv;
}

/** A PNG URL of the badge for `level`, `cssPx` CSS px square at the device's resolution. Cached. */
export function badgeUrl(level: number, cssPx: number, dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1): string {
  const px = Math.round(cssPx * dpr);
  return canvasUrl(`badge:${level}:${px}`, () => bakeBadge(level, px));
}
