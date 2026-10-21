// The bag (Blake's playtest, 2026-10-21): it replaces the Hold card. Tap it to swap the falling shape
// with the one in the bag. A shopping tote drawn in two layers so the held shape stands inside it: the
// back (handle and the dark opening) under the game's preview canvas, the front (panel, band and a swap
// sticker) over it. drawBag draws both with a shape between for the 'bag' icon.

import { INK, PAPER } from '../config.ts';
import { O, ink, part, rrPath } from '../sticker.ts';
import { type Ctx, ctx2d, makeCanvas } from '../util.ts';
import { canvasUrl } from '../urls.ts';
import { uiIconUrl } from './icons.ts';

const BAG = ['#F4B860', '#FFDCA3', '#C98336'] as const;
const BAND = ['#3EC9E6', '#A6EEFA', '#1E93B8'] as const;
const INSIDE = '#6E4322';

// Unit space: the icon's square is -0.5..0.5, y down. A shopping tote: the handle arches over the top and
// the body fills the lower half; the held shape stands in the opening, in front of the handle and behind
// the front panel.
const TOP = -0.02, BOT = 0.46, TW = 0.39, BW = 0.43;

/** The front panel: a slightly flared box with soft corners. */
function panel(): Path2D {
  const p = new Path2D(), r = 0.06;
  p.moveTo(-TW + r, TOP); p.lineTo(TW - r, TOP); p.quadraticCurveTo(TW, TOP, TW + 0.004, TOP + r);
  p.lineTo(BW, BOT - r); p.quadraticCurveTo(BW + 0.004, BOT, BW - r, BOT); p.lineTo(-BW + r, BOT);
  p.quadraticCurveTo(-BW - 0.004, BOT, -BW, BOT - r); p.lineTo(-TW - 0.004, TOP + r); p.quadraticCurveTo(-TW, TOP, -TW + r, TOP);
  p.closePath();
  return p;
}

function line(c: Ctx, p: Path2D, w: number, col: string): void {
  c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = w; c.strokeStyle = col; c.stroke(p);
}
const tube = (c: Ctx, p: Path2D, w: number, col: string) => { line(c, p, w + O * 2, INK); line(c, p, w, col); };

/** The tote's back: the handle and the dark inside of the opening the held shape stands in. */
export function drawBagBack(c: Ctx): void {
  const h = new Path2D(); h.moveTo(-0.22, TOP + 0.02); h.bezierCurveTo(-0.24, -0.5, 0.24, -0.5, 0.22, TOP + 0.02);
  tube(c, h, 0.075, BAG[2]);
  const shine = new Path2D(); shine.moveTo(-0.205, TOP - 0.06); shine.bezierCurveTo(-0.215, -0.45, 0.215, -0.45, 0.205, TOP - 0.06);
  line(c, shine, 0.022, BAG[0]);
  // The back wall's top edge peeks above the front panel; the inside is dark.
  const back = rrPath(-TW + 0.02, TOP - 0.07, (TW - 0.02) * 2, 0.12, 0.04);
  c.fillStyle = BAG[2]; c.fill(back); ink(c, back);
  const inside = rrPath(-TW + 0.05, TOP - 0.045, (TW - 0.05) * 2, 0.08, 0.03);
  c.fillStyle = INSIDE; c.fill(inside);
}

/** The tote's front: the panel with a colored band, its top fold, and a swap sticker. */
export function drawBagFront(c: Ctx): void {
  const p = panel();
  part(c, p, BAG[0], BAG[1], BAG[2], 0.05);
  c.save(); c.clip(p);
  // A band of color across the middle, like a shop's bag; a fold line under the top edge.
  c.fillStyle = BAND[0]; c.fillRect(-0.6, 0.12, 1.2, 0.2);
  c.fillStyle = BAND[1]; c.fillRect(-0.6, 0.12, 1.2, 0.03);
  c.fillStyle = BAND[2]; c.fillRect(-0.6, 0.29, 1.2, 0.03);
  const fold = new Path2D(); fold.moveTo(-0.5, TOP + 0.075); fold.lineTo(0.5, TOP + 0.075);
  line(c, fold, 0.02, 'rgba(201,131,54,0.9)');
  c.restore();
  ink(c, p);
  // The swap sticker: a Paper disc with two arrows passing each other.
  const disc = new Path2D(); disc.arc(0, 0.22, 0.16, 0, Math.PI * 2);
  c.fillStyle = PAPER; c.fill(disc); ink(c, disc, 0.05);
  const arrow = (y: number, d: 1 | -1) => {
    const a = new Path2D(); a.moveTo(-0.085 * d, y); a.lineTo(0.03 * d, y); line(c, a, 0.04, INK);
    const hd = new Path2D(); hd.moveTo(0.1 * d, y); hd.lineTo(0.025 * d, y - 0.055); hd.lineTo(0.025 * d, y + 0.055); hd.closePath();
    c.fillStyle = INK; c.fill(hd); c.lineJoin = 'round'; c.lineWidth = 0.025; c.strokeStyle = INK; c.stroke(hd);
  };
  arrow(0.18, 1); arrow(0.265, -1);
}

/** The whole bag with `inside` drawn in its opening (the 'bag' icon puts a T there). */
export function drawBag(c: Ctx, inside?: (c: Ctx) => void): void {
  drawBagBack(c);
  if (inside) { c.save(); inside(c); c.restore(); }
  drawBagFront(c);
}

function bakeLayer(layer: 'back' | 'front', px: number): HTMLCanvasElement {
  const cv = makeCanvas(px, px), c = ctx2d(cv);
  c.translate(px / 2, px / 2); c.scale(px, px);
  if (layer === 'back') drawBagBack(c); else drawBagFront(c);
  return cv;
}

const DPR = (): number => (typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1);

/** One layer of the bag as a cached PNG URL, `cssPx` square at the device's resolution. */
export function bagLayerUrl(layer: 'back' | 'front', cssPx: number, dpr = DPR()): string {
  const px = Math.round(cssPx * dpr);
  return canvasUrl(`bag:${layer}:${px}`, () => bakeLayer(layer, px));
}

export interface BagState {
  /** Something is in the bag (otherwise the opening shows empty). */
  held?: boolean;
  /** Already swapped this drop: the bag dims until the next shape. */
  used?: boolean;
  /** Locked until a level: the text to show (e.g. "Lv 2"), or null when unlocked. */
  locked?: string | null;
}

/**
 * The bag button, `size` CSS px square (default 64). Put your held-shape preview canvas in
 * `el.querySelector('.ui-bag-slot')`: it's stretched to fit the slot (keep it square) and sits inside the
 * sack, between its back and its front. It fires the action `bag`. Set its state with setBag and play
 * the swap with bagSwap.
 */
export function bagButton(o: { size?: number; state?: BagState } = {}): HTMLButtonElement {
  const size = o.size ?? 64;
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ui ui-bag empty';
  el.dataset.action = 'bag';
  el.style.setProperty('--s', `${size}px`);
  el.setAttribute('aria-label', 'Bag: swap the falling shape');
  el.innerHTML = `<img class="ui-bag-back" alt="" src="${bagLayerUrl('back', size)}"><span class="ui-bag-slot"></span>`
    + `<img class="ui-bag-front" alt="" src="${bagLayerUrl('front', size)}">`
    + `<span class="ui-bag-lock"><img alt="" src="${uiIconUrl('lock', 14)}"><b></b></span>`;
  if (o.state) setBag(el, o.state);
  return el;
}

/** Updates the bag's state classes (`empty`, `used`, `locked`). */
export function setBag(el: HTMLElement, s: BagState): void {
  if (s.held !== undefined) el.classList.toggle('empty', !s.held);
  if (s.used !== undefined) el.classList.toggle('used', s.used);
  if (s.locked !== undefined) {
    el.classList.toggle('locked', !!s.locked);
    el.querySelector('.ui-bag-lock b')!.textContent = s.locked ?? '';
    el.toggleAttribute('disabled', !!s.locked);
  }
}

/** The swap: the sack squashes and the new shape drops in. Call it on each swap. */
export function bagSwap(el: HTMLElement): void {
  el.classList.remove('swap');
  void el.offsetWidth;
  el.classList.add('swap');
}
