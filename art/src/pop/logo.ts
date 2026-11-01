// Blockling Pop's logo (Pop plan §9): "BLOCKLING" in bouncy sticker letters beside "POP" in chunky letter
// tiles like the tower logo's, with Pop's three small Blocklings (Pip, Elbow, Trio) bursting out of the O.
// popLogoElement() builds it for the DOM (the menu card), where the Blocklings pop out one by one and hop
// now and then; bakePopLogo() draws it still into a canvas (a splash, the share card's postmark).
// bakePopWord() letters any banner ("ALL CLEAR!") the same way as "BLOCKLING".

import { INK } from '../config.ts';
import type { Expression } from '../face.ts';
import { drawPiece } from '../piece.ts';
import { ART_SHAPES, pose } from '../shapes.ts';
import { part, rrPath, twinkle } from '../sticker.ts';
import { type Ctx, ctx2d, makeCanvas } from '../util.ts';
import { canvasUrl } from '../urls.ts';
import { CAP, popGlyph, popGlyphWidth } from './letters.ts';

const DPR = (): number => (typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1);

// ---------------------------------------------------------------------------------------------
// Lettering

/** Small tilts (degrees) and lifts (in caps) that make a word bounce; letter i takes entry i mod 9. */
const BOUNCE: [number, number][] = [[-5, 0.05], [4, -0.06], [-3, 0.03], [5, -0.05], [-4, 0.06], [3, -0.03], [-5, 0.05], [4, -0.06], [-2, 0.02]];

/** A word's layout: each letter's centre x and the whole width, in px for capital height `cap`. Widths only (no Path2D), so the logo's layout below can run at import, in Node too. */
function wordLayout(text: string, cap: number): { xs: (number | null)[]; w: number } {
  const k = cap / CAP, track = 0.13 * cap, xs: (number | null)[] = [];
  let x = 0;
  for (const ch of text) {
    const gw = popGlyphWidth(ch);
    if (gw === null) { xs.push(null); x += 0.42 * cap; continue; }
    if (x > 0) x += track;
    xs.push(x + (gw * k) / 2); x += gw * k;
  }
  return { xs, w: x };
}

/** One letter, capital `cap` px tall, centred at (x, y): an Ink drop under it, then white with an Ink edge. */
function drawLetter(c: Ctx, ch: string, x: number, y: number, cap: number, deg: number, fill: string): void {
  const g = popGlyph(ch);
  if (!g) return;
  const k = cap / CAP, edge = 0.24 * cap;
  c.save(); c.translate(x, y); c.rotate((deg * Math.PI) / 180); c.scale(k, k);
  c.lineJoin = 'round'; c.lineWidth = edge / k; c.strokeStyle = INK; c.fillStyle = INK;
  c.save(); c.translate(0, (0.13 * cap) / k); c.stroke(g.path); c.fill(g.path); c.restore();
  c.stroke(g.path);
  c.fillStyle = fill; c.fill(g.path);
  c.restore();
}

/** How a word is lettered: `bounce` (default true) tilts and lifts the letters; `fill` is one colour (default white) or one a letter, in turn. */
export interface PopWordOptions { bounce?: boolean; fill?: string | string[] }

/** The light Blockling colours "BLOCKLING" is lettered in, one a letter in turn; pass as `fill` for a banner in the logo's colours. */
export const POP_FILLS = ['#FF9DAA', '#FFCB85', '#FFE58F', '#A9F09A', '#9BE6FF', '#9DB3FF', '#D0A8FF', '#F7A3EC'];

/** Draw `text` in Pop's lettering, centred at (x, y) with capital height `cap` px. Unknown characters are gaps. */
export function drawPopWord(c: Ctx, text: string, x: number, y: number, cap: number, o: PopWordOptions = {}): void {
  const { xs, w } = wordLayout(text, cap), bounce = o.bounce ?? true, fills = [o.fill ?? '#FFFFFF'].flat();
  let n = 0;
  [...text].forEach((ch, i) => {
    const lx = xs[i];
    if (lx === null) return;
    const [deg, lift] = bounce ? BOUNCE[i % BOUNCE.length] : [0, 0];
    drawLetter(c, ch, x - w / 2 + lx, y - lift * cap, cap, deg, fills[n++ % fills.length]);
  });
}

/** `text` in Pop's lettering on a transparent canvas, capital `cap` px tall, with room for the edge and drop. */
export function bakePopWord(text: string, cap: number, o: PopWordOptions = {}): HTMLCanvasElement {
  const { w } = wordLayout(text, cap), pad = Math.ceil(cap * 0.3);
  const cv = makeCanvas(Math.ceil(w + pad * 2), Math.ceil(cap * 1.75));
  drawPopWord(ctx2d(cv), text, cv.width / 2, cap * 0.8, cap, o);
  return cv;
}

/** bakePopWord as a cached PNG URL, capital `capCss` CSS px tall at the device's resolution. */
export function popWordUrl(text: string, capCss: number, dpr = DPR(), o: PopWordOptions = {}): string {
  const cap = Math.round(capCss * dpr);
  return canvasUrl(`popword:${text}:${cap}:${o.bounce ?? true}:${[o.fill ?? ''].flat().join(',')}`, () => bakePopWord(text, cap, o));
}

// ---------------------------------------------------------------------------------------------
// The logo

interface PopTile { ch: string; key: string; deg: number }
/** "POP": its letter tiles, their shape colours and tilts. The O is where the Blocklings burst out. */
export const POP_TILES: PopTile[] = [{ ch: 'P', key: 'Z', deg: -6 }, { ch: 'O', key: 'O', deg: 4 }, { ch: 'P', key: 'I', deg: -3 }];

interface Burster { key: 'Pip' | 'Elbow' | 'Trio'; q: number; x: number; y: number; deg: number; cell: number; face: Expression }
/** Pop's three small Blocklings bursting out of the O, centred at (x, y) from the O's middle, in tiles. */
const BURST: Burster[] = [
  { key: 'Pip', q: 0, x: -0.8, y: -1.0, deg: -20, cell: 0.44, face: 'proud' },
  { key: 'Elbow', q: 0, x: 0.03, y: -1.3, deg: 10, cell: 0.32, face: 'impact' },
  { key: 'Trio', q: 0, x: 0.9, y: -0.98, deg: 36, cell: 0.29, face: 'proud' },
];

/** Where everything sits, in tiles (u), origin at the O tile's middle. */
const L = (() => {
  const cap = 0.5, word = wordLayout('BLOCKLING', cap), gapToPop = 0.3, step = 1.07;
  const tilesX = [0, 1, 2].map(i => (i - 1) * step);
  const left = tilesX[0] - 0.5 - gapToPop - word.w;
  return { cap, word, wordX: left + word.w / 2, wordY: 0.12, tilesX, x0: left - 0.16, x1: tilesX[2] + 0.66, y0: -1.66, y1: 0.66 };
})();

/** The logo's width over its height. */
export const POP_LOGO_ASPECT = (L.x1 - L.x0) / (L.y1 - L.y0);

function drawPopTile(c: Ctx, t: PopTile, u: number): void {
  const s = ART_SHAPES[t.key];
  c.save(); c.scale(u, u);
  part(c, rrPath(-0.46, -0.46, 0.92, 0.92, 0.2), s.base, s.light, s.shade, 0.08);
  c.fillStyle = 'rgba(255,255,255,0.5)'; c.fill(rrPath(-0.33, -0.33, 0.24, 0.1, 0.05));
  c.restore();
  const g = popGlyph(t.ch)!, k = (0.76 * u) / 1000;
  c.save(); c.translate(0, 0.018 * u); c.scale(k, k);
  // The O is a hole the Blocklings burst out of: dark inside, with a glint of the light they came from.
  if (t.ch === 'O') {
    c.fillStyle = INK; c.beginPath(); c.ellipse(0, 10, 190, 200, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#FFE58F'; c.beginPath(); c.ellipse(-50, -70, 46, 30, -0.5, 0, Math.PI * 2); c.fill();
  }
  c.lineJoin = 'round'; c.lineWidth = (0.12 * u) / k; c.strokeStyle = INK; c.stroke(g.path);
  c.fillStyle = '#FFFFFF'; c.fill(g.path);
  c.restore();
}

/** The comic pop lines and sparkles around the O, drawn behind the tiles, between the Blocklings. (ox, oy) is the O's middle. */
function drawBurstLines(c: Ctx, ox: number, oy: number, u: number): void {
  // A comic "pop" star behind the O, showing above the tiles where the Blocklings fly out.
  const star = new Path2D(), n = 14, cy = oy - 0.2 * u;
  for (let i = 0; i < n * 2; i++) {
    const a = Math.PI * (i / n) - Math.PI / 2 + 0.11, r = (i % 2 ? 0.7 : i % 4 ? 1.02 : 1.12) * u;
    const x = ox + Math.cos(a) * r * 1.08, y = cy + Math.sin(a) * r;
    if (i) star.lineTo(x, y); else star.moveTo(x, y);
  }
  star.closePath();
  c.save(); c.beginPath(); c.rect(ox - 1.4 * u, oy - 1.4 * u, 2.8 * u, 1.4 * u); c.clip();
  c.lineJoin = 'round'; c.lineWidth = 0.08 * u; c.strokeStyle = INK; c.stroke(star); c.fillStyle = '#FFE58F'; c.fill(star);
  c.fillStyle = '#FFF8DC'; c.beginPath(); c.ellipse(ox, cy, 0.62 * u, 0.56 * u, 0, 0, Math.PI * 2); c.fill(); c.restore();
  c.save(); c.lineCap = 'round';
  for (const [deg, r0, r1] of [[-168, 0.68, 0.9], [-142, 0.68, 0.86], [-38, 0.68, 0.86], [-12, 0.68, 0.9]]) {
    const a = (deg * Math.PI) / 180;
    c.beginPath(); c.moveTo(ox + Math.cos(a) * r0 * u, oy + Math.sin(a) * r0 * u); c.lineTo(ox + Math.cos(a) * r1 * u, oy + Math.sin(a) * r1 * u);
    c.strokeStyle = INK; c.lineWidth = 0.12 * u; c.stroke();
    c.strokeStyle = '#FFE58F'; c.lineWidth = 0.05 * u; c.stroke();
  }
  c.restore();
  for (const [dx, dy, r, col] of [[-1.28, -0.62, 0.13, '#FFCC33'], [1.36, -1.42, 0.12, '#FFCC33'], [-0.42, -1.52, 0.08, '#FFFFFF'], [0.5, -1.58, 0.07, '#FFFFFF']] as [number, number, number, string][]) {
    const p = twinkle(ox + dx * u, oy + dy * u, r * u);
    c.save(); c.lineJoin = 'round'; c.lineWidth = 0.06 * u; c.strokeStyle = INK; c.stroke(p); c.fillStyle = col; c.fill(p); c.restore();
  }
}

/** One bursting Blockling, centred at the origin, cells `cell` px. */
function drawBurster(c: Ctx, b: Burster, cell: number): void {
  const p = pose(b.key, b.q);
  c.save(); c.rotate((b.deg * Math.PI) / 180); c.translate((-p.w * cell) / 2, (-p.h * cell) / 2);
  drawPiece(c, b.key, b.q, cell, { face: b.face, shadow: false, detail: cell >= 20 });
  c.restore();
}

/** Everything but the bursting Blocklings, with the logo's top-left at (0, 0) and tiles `u` px. */
function drawPopLogoBase(c: Ctx, u: number): void {
  const ox = -L.x0 * u, oy = -L.y0 * u;
  drawBurstLines(c, ox, oy, u);
  drawPopWord(c, 'BLOCKLING', ox + L.wordX * u, oy + L.wordY * u, L.cap * u, { fill: POP_FILLS });
  POP_TILES.forEach((t, i) => { c.save(); c.translate(ox + L.tilesX[i] * u, oy); c.rotate((t.deg * Math.PI) / 180); drawPopTile(c, t, u); c.restore(); });
}

/** The whole logo drawn still into a canvas `width` px wide (a splash, the share card's postmark). */
export function bakePopLogo(width: number): HTMLCanvasElement {
  const u = width / (L.x1 - L.x0), cv = makeCanvas(Math.round(width), Math.round(width / POP_LOGO_ASPECT)), c = ctx2d(cv);
  drawPopLogoBase(c, u);
  const ox = -L.x0 * u, oy = -L.y0 * u;
  for (const b of BURST) { c.save(); c.translate(ox + b.x * u, oy + b.y * u); drawBurster(c, b, b.cell * u); c.restore(); }
  return cv;
}

/** bakePopLogo as a cached PNG URL, `cssW` CSS px wide at the device's resolution. */
export function popLogoUrl(cssW: number, dpr = DPR()): string {
  const w = Math.round(cssW * dpr);
  return canvasUrl(`poplogo:${w}`, () => bakePopLogo(w));
}

/**
 * The logo as DOM, `width` CSS px wide (default 280): the lettering and tiles as one image, and the three
 * Blocklings as their own, popping out of the O one by one (then a hop every few seconds). `still` skips
 * the animation (Reduce Motion, or a menu seen before). Needs uiCss() on the page.
 */
export function popLogoElement(o: { width?: number; still?: boolean } = {}): HTMLElement {
  injectPopLogoCss();
  const width = o.width ?? 280, dpr = DPR(), u = (width * dpr) / (L.x1 - L.x0), W = L.x1 - L.x0, H = L.y1 - L.y0;
  const root = document.createElement('div');
  root.className = `ui-poplogo${o.still ? ' ui-still' : ''}`;
  root.style.width = `${width}px`;
  root.setAttribute('role', 'img'); root.setAttribute('aria-label', 'Blockling Pop');
  const base = document.createElement('img');
  base.alt = ''; base.className = 'ui-poplogo-base';
  base.src = canvasUrl(`poplogo-base:${Math.round(width * dpr)}`, () => {
    const cv = makeCanvas(Math.round(width * dpr), Math.round((width * dpr) / POP_LOGO_ASPECT)); drawPopLogoBase(ctx2d(cv), u); return cv;
  });
  root.appendChild(base);
  BURST.forEach((b, i) => {
    const p = pose(b.key, b.q), cell = b.cell * u, size = Math.ceil(Math.hypot(p.w, p.h) * cell + 0.3 * u);
    const img = document.createElement('img');
    img.alt = ''; img.className = 'ui-poplogo-bit';
    img.src = canvasUrl(`poplogo-bit:${b.key}:${Math.round(width * dpr)}`, () => {
      const cv = makeCanvas(size, size), c = ctx2d(cv); c.translate(size / 2, size / 2); drawBurster(c, b, cell); return cv;
    });
    const sz = size / u;
    img.style.cssText = `left:${(((b.x - L.x0 - sz / 2) / W) * 100).toFixed(2)}%;top:${(((b.y - L.y0 - sz / 2) / H) * 100).toFixed(2)}%;width:${((sz / W) * 100).toFixed(2)}%;`
      + `--fx:${(-b.x / sz * 100).toFixed(1)}%;--fy:${((-b.y) / sz * 100).toFixed(1)}%;--i:${i}`;
    root.appendChild(img);
  });
  return root;
}

const POP_LOGO_CSS = `
.ui-poplogo { position: relative; max-width: 100%; aspect-ratio: ${POP_LOGO_ASPECT.toFixed(4)}; flex: none; pointer-events: none; }
.ui-poplogo img { position: absolute; display: block; }
.ui-poplogo-base { inset: 0; width: 100%; height: 100%; }
.ui-poplogo-bit { height: auto; animation: ui-poplogo-out 520ms cubic-bezier(.2,1.5,.45,1) calc(380ms + var(--i) * 110ms) both, ui-poplogo-hop 3.6s ease-in-out calc(1.6s + var(--i) * 140ms) infinite; }
@keyframes ui-poplogo-out { from { transform: translate(var(--fx), var(--fy)) scale(0.2) rotate(-30deg); opacity: 0; } 30% { opacity: 1; } to { transform: none; opacity: 1; } }
@keyframes ui-poplogo-hop { 0%, 82%, 100% { transform: none; } 88% { transform: translateY(-14%) scale(1.04, 0.96); } 94% { transform: translateY(2%) scale(0.96, 1.04); } }
.ui-poplogo.ui-still .ui-poplogo-bit, .ui-still .ui-poplogo-bit { animation: none; }
@media (prefers-reduced-motion: reduce) { .ui-poplogo-bit { animation: none; } }
`;

function injectPopLogoCss(): void {
  if (typeof document === 'undefined' || document.getElementById('st-ui-poplogo')) return;
  const style = document.createElement('style');
  style.id = 'st-ui-poplogo'; style.textContent = POP_LOGO_CSS;
  document.head.appendChild(style);
}
