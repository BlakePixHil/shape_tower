// App icon, splash and share card (art-direction.md §8.5, §9.5, §9.6).
// Icon: three Blocklings (I, O, T) stacked on a sky-to-space gradient with a gold star on top; three
// pieces at most so it reads at 60 px. Android's adaptive icon is the same art split into a background
// and a foreground kept inside the 66% safe circle. Splash: the logo over the Meadow sky. Share card:
// the run's height, biome postcard and badge around the player's money shot.
// Load Fredoka and Nunito first (the logo, numbers and labels are text).

import { FONT_BODY, FONT_DISPLAY, INK, PAPER, SIGNAL } from './config.ts';
import { BIOMES } from './biomes.ts';
import { cloud } from './meadow.ts';
import { drawPiece } from './piece.ts';
import { pose } from './shapes.ts';
import { part, rrPath, twinkle } from './sticker.ts';
import { type Ctx, TAU, ctx2d, hash, makeCanvas } from './util.ts';
import { drawBadge, titleFor } from './ui/badge.ts';
import { bakeLogo } from './ui/logo.ts';
import { bakePostcard } from './ui/postcard.ts';

const GOLD = ['#FFC23D', '#FFE08A', '#D9971A'] as const;

/** A five-point star path centred at the origin, radius r. */
function star5(r: number): Path2D {
  const p = new Path2D();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.48 : r;
    if (i) p.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else p.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  p.closePath();
  return p;
}

/** The icon's sky: space at the top with a few stars, day sky lower down, a grassy hill at the bottom. Units: 1 = icon size. */
function iconSky(c: Ctx): void {
  const g = c.createLinearGradient(0, 0, 0, 1);
  g.addColorStop(0, '#2B1F52'); g.addColorStop(0.3, '#4A3FA0'); g.addColorStop(0.62, '#4DA8F0'); g.addColorStop(1, '#BDE6FF');
  c.fillStyle = g; c.fillRect(0, 0, 1, 1);
  c.fillStyle = '#FFFFFF';
  for (let i = 0; i < 26; i++) {
    const x = hash(i * 3.7), y = hash(i * 9.1) * 0.36, r = 0.002 + 0.004 * hash(i * 5.3);
    c.globalAlpha = 0.5 + 0.5 * hash(i * 1.9) * (1 - y * 2);
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  c.globalAlpha = 1;
  cloud(c, 0.12, 0.8, 0.075, 'rgba(255,255,255,0.85)');
  cloud(c, 0.9, 0.74, 0.06, 'rgba(255,255,255,0.7)');
  // The hill.
  c.fillStyle = '#7FD36B';
  c.beginPath(); c.moveTo(0, 0.9); c.quadraticCurveTo(0.5, 0.78, 1, 0.9); c.lineTo(1, 1); c.lineTo(0, 1); c.closePath(); c.fill();
  c.fillStyle = '#5FB34F';
  c.beginPath(); c.moveTo(0, 0.95); c.quadraticCurveTo(0.5, 0.86, 1, 0.95); c.lineTo(1, 1); c.lineTo(0, 1); c.closePath(); c.fill();
}

/** The icon's stack, `u` units per block, its base centred at (cx, base). */
function iconStack(c: Ctx, cx: number, base: number, u: number): void {
  // I flat on the hill, O on its middle, T (bar on top) leaning on the O, the star over the T.
  const put = (key: string, q: number, col: number, row: number, face: 'idle' | 'proud', rot = 0) => {
    const p = pose(key, q);
    c.save();
    c.translate(cx + (col - 2) * u + (p.w * u) / 2, base - row * u - (p.h * u) / 2);
    c.rotate(rot);
    c.translate((-p.w * u) / 2, (-p.h * u) / 2);
    drawPiece(c, key, q, u, { face, shadow: true, detail: true });
    c.restore();
  };
  put('I', 0, 0, 0, 'idle');
  put('O', 0, 1, 1, 'proud');
  put('T', 2, 1.5, 3, 'idle', 0.07);
  // The gold star, with a ring of tiny sparkles.
  c.save(); c.translate(cx + 0.55 * u, base - 5.75 * u); c.rotate(0.12);
  part(c, star5(u * 0.62), GOLD[0], GOLD[1], GOLD[2], 0.08 * u);
  c.restore();
  c.fillStyle = '#FFFFFF';
  for (const [dx, dy, r] of [[-0.75, -6.1, 0.16], [1.6, -6.3, 0.12], [1.45, -5.2, 0.09]]) { c.save(); c.translate(cx + dx * u, base + dy * u); c.fill(twinkle(0, 0, r * u)); c.restore(); }
}

export type IconLayer = 'full' | 'foreground' | 'background';

/**
 * The app icon, `px` square. 'full' is the iOS / store icon (square, opaque; the OS rounds it).
 * 'background' and 'foreground' are Android's adaptive layers (108 dp): the foreground's art sits
 * inside the middle 66% so every mask shape keeps it.
 */
export function bakeAppIcon(px: number, layer: IconLayer = 'full'): HTMLCanvasElement {
  const cv = makeCanvas(px, px), c = ctx2d(cv);
  if (layer !== 'foreground') { c.save(); c.scale(px, px); iconSky(c); c.restore(); }
  if (layer !== 'background') {
    // In px (the piece renderer's line widths are px). Full: the stack is about 6.4 blocks tall.
    // Foreground: shrunk into the safe circle and centred on it.
    const fit = layer === 'full' ? 1 : 0.62, u = 0.128 * fit * px, base = layer === 'full' ? 0.885 * px : 0.5 * px + 3.05 * u;
    iconStack(c, (0.5 - 0.02 * fit) * px, base, u);
  }
  return cv;
}

/** The splash: the logo over the Meadow sky with clouds and the hills, `w` × `h` px. */
export function bakeSplash(w: number, h: number): HTMLCanvasElement {
  const cv = makeCanvas(w, h), c = ctx2d(cv), sky = BIOMES[0].sky, m = Math.min(w, h);
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, sky[0]); g.addColorStop(0.6, sky[1]); g.addColorStop(1, sky[2]);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  cloud(c, w * 0.18, h * 0.24, m * 0.07, 'rgba(255,255,255,0.9)');
  cloud(c, w * 0.84, h * 0.3, m * 0.05, 'rgba(255,255,255,0.8)');
  cloud(c, w * 0.7, h * 0.7, m * 0.06, 'rgba(255,255,255,0.75)');
  c.fillStyle = '#9BDB86'; c.beginPath(); c.moveTo(0, h * 0.86); c.quadraticCurveTo(w * 0.3, h * 0.8, w * 0.6, h * 0.86); c.quadraticCurveTo(w * 0.85, h * 0.9, w, h * 0.84); c.lineTo(w, h); c.lineTo(0, h); c.fill();
  c.fillStyle = '#7FD36B'; c.beginPath(); c.moveTo(0, h * 0.92); c.quadraticCurveTo(w * 0.5, h * 0.86, w, h * 0.93); c.lineTo(w, h); c.lineTo(0, h); c.fill();
  const lw = Math.min(w * 0.78, m * 0.9), logo = bakeLogo(lw);
  c.drawImage(logo, (w - logo.width) / 2, h * 0.42 - logo.height / 2);
  return cv;
}

export interface ShareCardData {
  /** Best height this run, in metres. */
  height: number;
  /** Highest biome reached. */
  biome: number;
  newBest?: boolean;
  /** The player's name and level, for the badge line. */
  name?: string;
  level?: number;
  score?: number;
  /** The money shot (a capture of the whole tower). Without one, the biome's postcard fills the frame. */
  shot?: CanvasImageSource & { width: number; height: number };
}

/** The share card, 1080 × 1350 by default (4:5, fits every feed): the shot in a sticker frame, the height, biome, badge and logo. */
export function bakeShareCard(d: ShareCardData, w = 1080, h = 1350): HTMLCanvasElement {
  const cv = makeCanvas(w, h), c = ctx2d(cv), u = w / 1080, b = BIOMES[d.biome];
  // Paper with the biome's sky across the top.
  c.fillStyle = PAPER; c.fillRect(0, 0, w, h);
  const g = c.createLinearGradient(0, 0, 0, h * 0.62);
  g.addColorStop(0, b.sky[0]); g.addColorStop(1, b.sky[2]);
  c.fillStyle = g; c.fillRect(0, 0, w, h * 0.62);
  // The picture, framed like a postcard and tilted a little.
  const fw = 760 * u, fh = 880 * u, fx = 70 * u, fy = 70 * u;
  c.save(); c.translate(fx + fw / 2, fy + fh / 2); c.rotate(-0.025);
  c.fillStyle = INK; c.fill(rrPath(-fw / 2 + 6 * u, -fh / 2 + 10 * u, fw, fh, 26 * u));
  c.fillStyle = '#FFFFFF'; c.fill(rrPath(-fw / 2, -fh / 2, fw, fh, 26 * u));
  c.lineWidth = 7 * u; c.strokeStyle = INK; c.stroke(rrPath(-fw / 2, -fh / 2, fw, fh, 26 * u));
  const iw = fw - 36 * u, ih = fh - 110 * u;
  c.save(); c.beginPath(); c.roundRect(-iw / 2, -fh / 2 + 18 * u, iw, ih, 14 * u); c.clip();
  const img = d.shot ?? bakePostcard(d.biome, Math.round(iw / 2), Math.round(ih / 2), 2);
  const sc = Math.max(iw / img.width, ih / img.height);
  c.drawImage(img, -img.width * sc / 2, -fh / 2 + 18 * u + ih / 2 - img.height * sc / 2, img.width * sc, img.height * sc);
  c.restore();
  c.font = `700 ${46 * u}px ${FONT_DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = INK;
  c.fillText(b.name, 0, fh / 2 - 46 * u);
  c.restore();

  // The height, big, on a gold sticker that overlaps the frame's corner.
  const hx = 820 * u, hy = 860 * u;
  c.save(); c.translate(hx, hy); c.rotate(0.06);
  const tag = rrPath(-200 * u, -110 * u, 400 * u, 220 * u, 34 * u);
  c.fillStyle = INK; c.translate(0, 10 * u); c.fill(tag); c.translate(0, -10 * u);
  c.fillStyle = SIGNAL.gold; c.fill(tag); c.lineWidth = 7 * u; c.strokeStyle = INK; c.stroke(tag);
  c.fillStyle = INK; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
  c.font = `800 ${30 * u}px ${FONT_BODY}`; c.fillText(d.newBest ? 'NEW BEST!' : 'I BUILT', 0, -50 * u);
  c.font = `700 ${120 * u}px ${FONT_DISPLAY}`; c.fillText(`${d.height.toFixed(1)}m`, 0, 70 * u);
  c.restore();

  // Bottom band: badge, name and title, score, and the logo.
  const by = 1120 * u;
  if (d.level) {
    drawBadge(c, d.level, 130 * u, by, 150 * u);
    c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillStyle = INK;
    c.font = `700 ${50 * u}px ${FONT_DISPLAY}`; c.fillText(d.name ?? 'Builder', 215 * u, by - 6 * u);
    c.font = `700 ${30 * u}px ${FONT_BODY}`; c.fillStyle = '#5B4F7A'; c.fillText(titleFor(d.level), 215 * u, by + 38 * u);
  }
  if (d.score !== undefined) {
    c.textAlign = 'left'; c.fillStyle = '#5B4F7A'; c.font = `800 ${26 * u}px ${FONT_BODY}`; c.fillText('SCORE', 215 * u, by + 96 * u);
    c.fillStyle = INK; c.font = `700 ${40 * u}px ${FONT_DISPLAY}`; c.fillText(Math.round(d.score).toLocaleString('en-US'), 330 * u, by + 99 * u);
  }
  const logo = bakeLogo(330 * u);
  c.drawImage(logo, w - logo.width - 50 * u, by - logo.height / 2 + 20 * u);
  return cv;
}
