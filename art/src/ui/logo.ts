// The logo (art-direction.md §8.5): "SHAPE" stacked on "TOWER" in chunky letter tiles, each tile a
// Blockling cell in a shape color tilted a few degrees as if stacked, with a Blockling peeking out from
// behind the O. logoElement() builds it for the DOM, where the letters drop in one by one with a squash;
// bakeLogo() draws it still into a canvas (splash, share card). Load Fredoka first: the letters are text.

import { FONT_DISPLAY, INK } from '../config.ts';
import { ART_SHAPES } from '../shapes.ts';
import { part, rrPath } from '../sticker.ts';
import { type Ctx, TAU, ctx2d, makeCanvas } from '../util.ts';

interface Tile { ch: string; key: string; deg: number }

/** Letters, their shape colors and tilts, row by row. The O of TOWER has the peeking Blockling. */
export const LOGO_ROWS: Tile[][] = [
  [{ ch: 'S', key: 'S', deg: -4 }, { ch: 'H', key: 'I', deg: 3 }, { ch: 'A', key: 'O', deg: -2 }, { ch: 'P', key: 'T', deg: 4 }, { ch: 'E', key: 'L', deg: -3 }],
  [{ ch: 'T', key: 'Z', deg: 3 }, { ch: 'O', key: 'J', deg: -3 }, { ch: 'W', key: 'Domino', deg: 2 }, { ch: 'E', key: 'S', deg: -4 }, { ch: 'R', key: 'I', deg: 3 }],
];

/** One letter tile, u px wide, centred at the origin, unrotated. */
function drawTile(c: Ctx, t: Tile, u: number): void {
  const s = ART_SHAPES[t.key];
  c.save(); c.scale(u, u);
  part(c, rrPath(-0.46, -0.46, 0.92, 0.92, 0.2), s.base, s.light, s.shade, 0.08);
  c.fillStyle = 'rgba(255,255,255,0.5)'; c.fill(rrPath(-0.33, -0.33, 0.24, 0.1, 0.05));
  c.restore();
  // The letter at its real pixel size, not a 0.7px font under a scale: WebKit can mis-draw sub-pixel
  // font sizes, the likely cause of a missing W on Blake's phone (2026-10-21).
  c.save();
  c.font = `700 ${0.7 * u}px ${FONT_DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.lineJoin = 'round'; c.lineWidth = 0.12 * u; c.strokeStyle = INK; c.strokeText(t.ch, 0, 0.05 * u);
  c.fillStyle = '#FFFFFF'; c.fillText(t.ch, 0, 0.05 * u);
  c.restore();
}

/** The Blockling that peeks out from behind the O: a Butterblock head looking left, u px wide. */
function drawPeeker(c: Ctx, u: number): void {
  const s = ART_SHAPES.O;
  c.save(); c.scale(u, u);
  part(c, rrPath(-0.4, -0.4, 0.8, 0.8, 0.2), s.base, s.light, s.shade, 0.08);
  c.fillStyle = INK;
  for (const ex of [-0.2, 0.06]) { c.beginPath(); c.ellipse(ex, -0.14, 0.07, 0.09, 0, 0, TAU); c.fill(); }
  c.fillStyle = '#FFFFFF';
  for (const ex of [-0.2, 0.06]) { c.beginPath(); c.arc(ex - 0.03, -0.18, 0.028, 0, TAU); c.fill(); }
  c.restore();
}

function bake(w: number, h: number, draw: (c: Ctx) => void): HTMLCanvasElement {
  const cv = makeCanvas(w, h); draw(ctx2d(cv)); return cv;
}

const urls = new Map<string, string>();
function cached(key: string, make: () => HTMLCanvasElement): string {
  let u = urls.get(key);
  if (!u) { u = make().toDataURL('image/png'); urls.set(key, u); }
  return u;
}

/** A letter tile as a PNG data URL, `cssPx` square. Row r, column i of LOGO_ROWS. */
export function logoTileUrl(r: number, i: number, cssPx: number, dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1): string {
  const px = Math.round(cssPx * dpr), t = LOGO_ROWS[r][i];
  return cached(`${r}${i}:${px}`, () => bake(px, px, c => { c.translate(px / 2, px / 2); drawTile(c, t, px); }));
}

export function logoPeekerUrl(cssPx: number, dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1): string {
  const px = Math.round(cssPx * dpr);
  return cached(`peek:${px}`, () => bake(px, px, c => { c.translate(px / 2, px / 2); drawPeeker(c, px); }));
}

/**
 * The logo as DOM: two rows of letter tiles that drop in one by one with a squash, then the Blockling
 * peeks out. `tile` is the tile size in CSS px (default 58). `still` skips the animation (Reduce Motion).
 * Needs uiCss() on the page.
 */
export function logoElement(o: { tile?: number; still?: boolean } = {}): HTMLElement {
  const tile = o.tile ?? 58, root = document.createElement('div');
  root.className = `ui ui-logo${o.still ? ' ui-still' : ''}`;
  root.style.setProperty('--tile', `${tile}px`);
  root.setAttribute('role', 'img'); root.setAttribute('aria-label', 'Shape Tower');
  let n = 0;
  LOGO_ROWS.forEach((row, r) => {
    const div = document.createElement('div');
    div.className = 'ui-logo-row';
    row.forEach((t, i) => {
      const img = document.createElement('img');
      img.className = 'ui-logo-tile'; img.alt = ''; img.src = logoTileUrl(r, i, tile);
      img.style.setProperty('--i', String(n++)); img.style.setProperty('--r', `${t.deg}deg`);
      if (t.ch === 'O') {
        const wrap = document.createElement('span');
        wrap.className = 'ui-logo-o';
        const peek = document.createElement('img');
        peek.className = 'ui-logo-peek'; peek.alt = ''; peek.src = logoPeekerUrl(tile * 0.62);
        wrap.append(peek, img); div.appendChild(wrap);
      } else div.appendChild(img);
    });
    root.appendChild(div);
  });
  return root;
}

/** The whole logo drawn still into a canvas `width` px wide (splash, share card). */
export function bakeLogo(width: number): HTMLCanvasElement {
  const u = width / 5.9, gap = u * 0.04, w = width, h = u * 2.5;
  return bake(w, h, c => {
    LOGO_ROWS.forEach((row, r) => {
      const x0 = (w - (row.length * (u + gap) - gap)) / 2 + (r ? u * 0.28 : -u * 0.08), y = u * 0.75 + r * (u + gap);
      row.forEach((t, i) => {
        const x = x0 + i * (u + gap) + u / 2;
        if (t.ch === 'O') { c.save(); c.translate(x + u * 0.3, y - u * 0.42); c.rotate(0.18); drawPeeker(c, u * 0.62); c.restore(); }
        c.save(); c.translate(x, y); c.rotate((t.deg * Math.PI) / 180); drawTile(c, t, u); c.restore();
      });
    });
  });
}
