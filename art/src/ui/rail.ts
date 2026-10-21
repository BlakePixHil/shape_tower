// The altitude rail and the off-screen chips (art-direction.md §8.2). The rail sits at the right edge
// under the Next column: a bar in biome colors with checkpoint ticks, the best-height flag, and a tiny
// Blockling head at the tower's top. It shows a window about three stretches tall that scrolls with
// the climb. Drawn into a canvas, so calling setRail every frame is cheap (it redraws only on change).
// Needs uiCss() for its placement.

import { INK, PAPER, SIGNAL } from '../config.ts';
import { ART_SHAPES } from '../shapes.ts';
import { BIOMES, biomeForCheckpoint } from '../biomes.ts';
import { rrPath, part } from '../sticker.ts';
import { TAU, clamp, ctx2d, makeCanvas, rgba } from '../util.ts';

/** One color per biome for the rail, picked to tell neighbours apart (the skies are too alike). */
export const RAIL_COLORS = ['#7FD36B', '#2FA37A', '#8EC8FF', '#6E7FA3', '#F08AB4', '#2E58C9', '#C9CCD8', '#D2694A', '#E8B65A', '#8A4FD8'];

export interface RailState {
  /** The tower's settled top, in blocks above the foundation. */
  top: number;
  /** Heights of checkpoints 1, 2, 3, ... in blocks, as far as known (at least through the next one). */
  cps: number[];
  /** How many checkpoints are claimed. */
  claimed: number;
  /** Best height, in blocks. Omit for none. */
  pb?: number;
  /** Blocks the rail shows (default: three times the next stretch). */
  span?: number;
}

const W = 46, BAR = 12;

/** The rail element, `height` CSS px tall (default 220). Position it with CSS (.ui-rail has right-edge defaults). */
export function altitudeRail(height = 220): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ui ui-rail';
  el.setAttribute('aria-hidden', 'true');
  const dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1;
  const cv = makeCanvas(Math.round(W * dpr), Math.round(height * dpr));
  cv.style.width = `${W}px`; cv.style.height = `${height}px`;
  el.appendChild(cv);
  return el;
}

/** Height of checkpoint n (1-based), extending the last known stretch past the end of `cps`. */
function cpHeight(cps: number[], n: number): number {
  if (n <= 0) return 0;
  if (n <= cps.length) return cps[n - 1];
  const last = cps[cps.length - 1] ?? 0, gap = cps.length >= 2 ? last - cps[cps.length - 2] : last || 10;
  return last + gap * (n - cps.length);
}

/** Redraw the rail for state `s`. */
export function setRail(rail: HTMLElement, s: RailState): void {
  const cv = rail.querySelector('canvas');
  if (!cv) return;
  const key = `${s.top.toFixed(2)}|${s.cps.length}|${s.claimed}|${s.pb?.toFixed(2)}|${s.span}`;
  if (cv.dataset.key === key) return;
  cv.dataset.key = key;
  const c = ctx2d(cv), k = cv.width / W, H = cv.height / k;
  c.setTransform(k, 0, 0, k, 0, 0);
  c.clearRect(0, 0, W, H);

  // The window: the next stretch's height × 3, with the tower top a third of the way up.
  const next = s.claimed + 1, gap = Math.max(4, cpHeight(s.cps, next) - cpHeight(s.cps, next - 1));
  const span = s.span ?? gap * 3, lo = Math.max(0, s.top - span * 0.35), hi = lo + span;
  const pad = 9, y0 = H - pad, y1 = pad + 6, Y = (h: number): number => y0 - ((h - lo) / (hi - lo)) * (y0 - y1);
  const x0 = (W - BAR) / 2 + 4, bar = rrPath(x0, y1, BAR, y0 - y1, BAR / 2);

  // Backing and biome bands: climbed part full color, the rest washed out.
  c.save(); c.clip(bar);
  c.fillStyle = PAPER; c.fillRect(x0, y1, BAR, y0 - y1);
  for (let n = 1; ; n++) {
    const a = cpHeight(s.cps, n - 1), b = cpHeight(s.cps, n);
    if (a > hi) break;
    if (b < lo) continue;
    c.fillStyle = RAIL_COLORS[biomeForCheckpoint(n)];
    c.fillRect(x0, Y(b), BAR, Y(a) - Y(b) + 0.5);
  }
  const ty = clamp(Y(s.top), y1, y0);
  c.fillStyle = 'rgba(255,247,232,0.45)'; c.fillRect(x0, y1, BAR, ty - y1);
  c.fillStyle = 'rgba(255,255,255,0.35)'; c.fillRect(x0 + 2, y1, 3, y0 - y1);
  c.restore();
  c.lineWidth = 2.5; c.strokeStyle = INK; c.stroke(bar);

  // Checkpoint ticks: claimed ones Ink, the next one gold and longer, later ones faint.
  for (let n = 1; ; n++) {
    const h = cpHeight(s.cps, n);
    if (h > hi) break;
    if (h < lo) continue;
    const y = Y(h), isNext = n === next, done = n <= s.claimed;
    c.lineCap = 'round';
    if (isNext) {
      c.lineWidth = 5.5; c.strokeStyle = INK; c.beginPath(); c.moveTo(x0 - 5, y); c.lineTo(x0 + BAR + 5, y); c.stroke();
      c.lineWidth = 2.5; c.strokeStyle = SIGNAL.gold; c.stroke();
    } else {
      c.lineWidth = 2; c.strokeStyle = done ? INK : rgba(INK, 0.45);
      c.beginPath(); c.moveTo(x0 - 2, y); c.lineTo(x0 + BAR + 2, y); c.stroke();
    }
    // A biome's first checkpoint gets a dot in the new biome's color.
    if (BIOMES.some(b => b.firstCp === n + 1)) {
      c.beginPath(); c.arc(x0 + BAR + 6, y, 3, 0, TAU); c.fillStyle = RAIL_COLORS[biomeForCheckpoint(n + 1)]; c.fill(); c.lineWidth = 1.5; c.strokeStyle = INK; c.stroke();
    }
  }

  // Best height: a little mint flag on the left; pinned to the top edge when it's above the window.
  if (s.pb !== undefined && s.pb >= lo) {
    const above = s.pb > hi, y = above ? y1 - 2 : Y(s.pb), px = x0 - 3;
    c.globalAlpha = above ? 0.7 : 1;
    c.lineWidth = 1.8; c.strokeStyle = INK; c.lineCap = 'round';
    c.beginPath(); c.moveTo(px, y + 3); c.lineTo(px, y - 9); c.stroke();
    const f = new Path2D(); f.moveTo(px, y - 9); f.lineTo(px - 10, y - 6); f.lineTo(px, y - 3); f.closePath();
    c.fillStyle = SIGNAL.mint; c.fill(f); c.lineWidth = 1.5; c.stroke(f);
    c.globalAlpha = 1;
  }

  // The tower top: a Butterblock head on the bar.
  const hs = 15, sh = ART_SHAPES.O;
  c.save(); c.translate(x0 + BAR / 2, ty); c.scale(hs, hs);
  part(c, rrPath(-0.5, -0.5, 1, 1, 0.24), sh.base, sh.light, sh.shade, 0.1);
  c.lineWidth = 0.12; c.strokeStyle = INK; c.stroke(rrPath(-0.5, -0.5, 1, 1, 0.24));
  c.fillStyle = INK;
  for (const ex of [-0.18, 0.18]) { c.beginPath(); c.ellipse(ex, -0.06, 0.08, 0.11, 0, 0, TAU); c.fill(); }
  c.restore();
}

export interface OffscreenChipOptions {
  /** 'up' sits at the top edge with ▲ (a checkpoint above); 'down' at the bottom with ▼ (a lost piece). */
  dir: 'up' | 'down';
  /** The text after the arrow, e.g. the checkpoint number. */
  label: string;
  /** Gold (default for up) or danger red (default for down). */
  tone?: 'gold' | 'danger';
}

/**
 * An off-screen chip: gold "▲ 4" at the top edge for a checkpoint above the view, or a red "▼" at the
 * bottom edge for a piece falling out of view. Set its x with the CSS variable --x (default 50%).
 * Add .show to pop it in; remove it to tuck it away.
 */
export function offscreenChip(o: OffscreenChipOptions): HTMLElement {
  const tone = o.tone ?? (o.dir === 'up' ? 'gold' : 'danger');
  const el = document.createElement('div');
  el.className = `ui ui-offchip ${o.dir} ${tone}`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<span class="ui-oc-arrow">${o.dir === 'up' ? '▲' : '▼'}</span>${o.label ? `<b>${o.label}</b>` : ''}`;
  return el;
}

/** The checkpoint chip: offscreenChip({ dir: 'up', label: String(n) }). */
export const checkpointChip = (n: number): HTMLElement => offscreenChip({ dir: 'up', label: String(n) });

/** Update a chip's label (and keep its arrow). */
export function setOffscreenChip(chip: HTMLElement, label: string): void {
  let b = chip.querySelector('b');
  if (!b) { b = document.createElement('b'); chip.appendChild(b); }
  if (b.textContent !== label) b.textContent = label;
}
