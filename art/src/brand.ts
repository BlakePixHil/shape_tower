// App icon, splash and share card (art-direction.md §8.5, §9.5, §9.6).
// Icon: Blocklings bursting up out of a little planet, store-icon loud (it replaced the stacked I, O, T
// on 2026-10-21). Android's adaptive icon is the same art split into a background and a foreground whose
// faces stay inside the 66% safe circle. Splash: the logo over the Meadow sky. Share card:
// the run's height, biome postcard and badge around the player's money shot.
// Load Fredoka and Nunito first (numbers and labels are text; the logo is drawn as outlines).

import { FONT_BODY, FONT_DISPLAY, INK, PAPER, SIGNAL } from './config.ts';
import { BIOMES } from './biomes.ts';
import { cloud } from './meadow.ts';
import { drawEyes, drawFace, drawPupil, FACE } from './face.ts';
import { faceAnchor } from './geometry.ts';
import { drawPiece } from './piece.ts';
import { bakePanorama, type PanoramaData } from './panorama.ts';
import { pose } from './shapes.ts';
import { circlePath, ink, rrPath, twinkle } from './sticker.ts';
import { type Ctx, TAU, ctx2d, hash, makeCanvas } from './util.ts';
import { drawBadge, titleFor } from './ui/badge.ts';
import { bakeLogo } from './ui/logo.ts';
import { bakePostcard } from './ui/postcard.ts';

// The icon (Blake's playtest, 2026-10-21: "a close up of a few shapes bursting out with a world below
// them ... like a classic click-bait store icon"). Units: 1 = the icon's size. The Blocklings blast up out
// of a little grassy planet through a yellow burst, with dirt flying and speed lines behind them, on a
// sunny glow that fades through blue sky to violet space in the corners. Big eyes looking at you.
const BX = 0.5, BY = 0.8;
const PX = 0.5, PY = 1.66, PR = 0.88;

/** The backdrop, overfilled past the icon's square so Android's background layer can bleed. */
function iconSky(c: Ctx): void {
  const g = c.createRadialGradient(0.5, 0.56, 0, 0.5, 0.56, 0.86);
  g.addColorStop(0, '#FFFBE3'); g.addColorStop(0.17, '#FFE27A'); g.addColorStop(0.4, '#5FCBFF');
  g.addColorStop(0.72, '#2C6BE0'); g.addColorStop(1, '#3B1E8C');
  c.fillStyle = g; c.fillRect(-1, -1, 3, 3);
  // Rays fanning up from the burst.
  c.save(); c.translate(BX, BY); c.fillStyle = 'rgba(255,255,255,0.17)';
  const n = 20;
  for (let i = 0; i < n; i += 2) {
    const a = (i / n) * TAU + 0.08, w = TAU / n;
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 2.2, a, a + w); c.closePath(); c.fill();
  }
  c.restore();
  // Stars in space, up in the corners.
  c.fillStyle = '#FFFFFF';
  for (let i = 0; i < 30; i++) {
    const x = hash(i * 3.7) * 1.6 - 0.3, y = hash(i * 9.1) * 0.5 - 0.25, d = Math.hypot(x - 0.5, y - 0.56);
    if (d < 0.6) continue;
    c.globalAlpha = Math.min(1, (d - 0.6) * 4);
    if (i % 5) { c.beginPath(); c.arc(x, y, 0.003 + 0.004 * hash(i * 5.3), 0, TAU); c.fill(); } else c.fill(twinkle(x, y, 0.018));
  }
  c.globalAlpha = 1;
}

/** The world: a little grassy planet with lakes and trees, its glow, and the crater the shapes burst out of. */
function iconPlanet(c: Ctx): void {
  const glow = c.createRadialGradient(PX, PY, PR * 0.97, PX, PY, PR + 0.11);
  glow.addColorStop(0, 'rgba(200,245,255,0.95)'); glow.addColorStop(1, 'rgba(200,245,255,0)');
  c.fillStyle = glow; c.beginPath(); c.arc(PX, PY, PR + 0.11, 0, TAU); c.fill();
  // Trees round the rim, standing out from the ground.
  for (const t of [-0.5, -0.4, -0.31, 0.3, 0.38, 0.49]) {
    const x = PX + Math.sin(t) * PR, y = PY - Math.cos(t) * PR, r = 0.032 + 0.008 * hash(t * 7);
    c.save(); c.translate(x, y); c.rotate(t);
    c.fillStyle = '#8A5A2E'; c.fillRect(-0.007, -r * 1.3, 0.014, r * 1.4);
    const crown = circlePath(0, -r * 1.6, r);
    c.fillStyle = '#3E9E3A'; c.fill(crown); c.lineWidth = 0.008; c.strokeStyle = INK; c.stroke(crown);
    c.fillStyle = 'rgba(255,255,255,0.35)'; c.beginPath(); c.arc(-r * 0.3, -r * 1.9, r * 0.32, 0, TAU); c.fill();
    c.restore();
  }
  const body = circlePath(PX, PY, PR);
  const g = c.createLinearGradient(0, PY - PR, 0, PY - PR + 0.3);
  g.addColorStop(0, '#93E866'); g.addColorStop(1, '#3E9E3A');
  c.fillStyle = g; c.fill(body);
  c.save(); c.clip(body);
  c.fillStyle = '#3DB4F2';
  c.beginPath(); c.ellipse(0.06, 0.98, 0.2, 0.09, 0.45, 0, TAU); c.fill();
  c.beginPath(); c.ellipse(0.98, 0.96, 0.18, 0.08, -0.5, 0, TAU); c.fill();
  c.beginPath(); c.ellipse(0.62, 1.04, 0.1, 0.035, 0, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.45)';
  c.beginPath(); c.ellipse(0.02, 0.95, 0.07, 0.02, 0.45, 0, TAU); c.fill();
  c.beginPath(); c.ellipse(0.95, 0.93, 0.06, 0.018, -0.5, 0, TAU); c.fill();
  // Sunlight on the rim.
  c.lineWidth = 0.03; c.strokeStyle = 'rgba(230,255,190,0.8)'; c.beginPath(); c.arc(PX, PY + 0.018, PR, -Math.PI * 0.85, -Math.PI * 0.15); c.stroke();
  // Cracks from the crater.
  c.lineWidth = 0.011; c.strokeStyle = INK; c.lineCap = 'round'; c.lineJoin = 'round';
  for (const [a, len] of [[0.35, 0.2], [1.2, 0.16], [2.0, 0.17], [2.8, 0.21]] as const) {
    c.beginPath(); c.moveTo(BX, BY + 0.02);
    for (let i = 1; i <= 3; i++) { const t = (i / 3) * len, k = i % 2 ? 0.03 : -0.03; c.lineTo(BX + Math.cos(a) * t - Math.sin(a) * k, BY + 0.02 + Math.sin(a) * t + Math.cos(a) * k * 0.6); }
    c.stroke();
  }
  c.restore();
  c.lineWidth = 0.016; c.strokeStyle = INK; c.stroke(body);
  // Clouds round its shoulders.
  cloud(c, 0.1, 0.86, 0.06, '#FFFFFF');
  cloud(c, 0.9, 0.84, 0.05, '#FFFFFF');
}

/** The burst: a spiky yellow blast on the planet's top, with chunks of dirt flying out. */
function iconBurst(c: Ctx): void {
  c.save(); c.translate(BX, BY);
  const spikes = (n: number, ro: number, ri: number, wob: number) => {
    const p = new Path2D();
    for (let i = 0; i < n * 2; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / n, r = i % 2 ? ri : ro * (1 - wob * hash(i * 2.3));
      if (i) p.lineTo(Math.cos(a) * r, Math.sin(a) * r * 0.82); else p.moveTo(Math.cos(a) * r, Math.sin(a) * r * 0.82);
    }
    p.closePath();
    return p;
  };
  const outer = spikes(13, 0.25, 0.13, 0.35);
  c.fillStyle = '#FFC93A'; c.fill(outer); ink(c, outer, 0.016);
  c.fillStyle = '#FFF4B8'; c.fill(spikes(13, 0.15, 0.08, 0.3));
  c.restore();
  // Dirt chunks: brown with a grass top, tumbling outwards.
  for (const [x, y, r, a] of [[0.36, 0.7, 0.032, 0.5], [0.67, 0.67, 0.034, -0.4], [0.41, 0.6, 0.02, 1.1], [0.6, 0.57, 0.018, -1], [0.27, 0.77, 0.02, 0.2], [0.74, 0.76, 0.022, 0.9]] as const) {
    c.save(); c.translate(x, y); c.rotate(a);
    const ch = new Path2D(); ch.moveTo(-r, -r * 0.6); ch.lineTo(r * 0.9, -r * 0.8); ch.lineTo(r * 1.1, r * 0.5); ch.lineTo(r * 0.1, r * 0.95); ch.lineTo(-r * 0.95, r * 0.55); ch.closePath();
    c.fillStyle = '#A8723E'; c.fill(ch);
    c.save(); c.clip(ch); c.fillStyle = '#5FB34F'; c.fillRect(-r * 2, -r * 2, r * 4, r * 1.45); c.restore();
    ink(c, ch, 0.009);
    c.restore();
  }
}

/** White speed streaks behind a piece at (x, y), pointing back to the burst. */
function streaks(c: Ctx, x: number, y: number, size: number): void {
  const dx = x - BX, dy = y - BY, d = Math.hypot(dx, dy), ux = dx / d, uy = dy / d;
  c.save(); c.lineCap = 'round';
  for (const [o, from, len] of [[-0.55, 0.35, 0.9], [0.05, 0.55, 1.2], [0.6, 0.3, 0.8]] as const) {
    const sx = x - ux * size * from - uy * size * o, sy = y - uy * size * from + ux * size * o;
    const g = c.createLinearGradient(sx, sy, sx - ux * size * len, sy - uy * size * len);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.strokeStyle = g; c.lineWidth = size * 0.09;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx - ux * size * len, sy - uy * size * len); c.stroke();
  }
  c.restore();
}

type IconFace = 'grin' | 'shock' | 'happy';

/** A big open grin with teeth and a tongue, and rosy cheeks: the store-icon face. At the face's origin. */
function bigGrin(c: Ctx, s: number): void {
  const er = FACE.eyeR * s, my = FACE.eyeY * s + er * 1.7, w = er * 1.3, h = er * 1.3, sp = FACE.eyeX * s;
  c.fillStyle = 'rgba(255,105,140,0.45)';
  for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(sx * sp * 1.8, my - er * 0.25, er * 0.6, er * 0.36, 0, 0, TAU); c.fill(); }
  const m = new Path2D();
  m.moveTo(-w, my); m.quadraticCurveTo(0, my + er * 0.3, w, my); m.bezierCurveTo(w * 0.95, my + h * 1.25, -w * 0.95, my + h * 1.25, -w, my); m.closePath();
  c.fillStyle = '#5A1530'; c.fill(m);
  c.save(); c.clip(m);
  c.fillStyle = '#FF7A9A'; c.beginPath(); c.ellipse(0, my + h, w * 0.62, h * 0.42, 0, 0, TAU); c.fill();
  c.fillStyle = '#FFFFFF'; c.fillRect(-w, my - er, w * 2, er * 1.32);
  c.restore();
  c.lineJoin = 'round'; c.lineWidth = Math.max(1.1, s * 0.045); c.strokeStyle = INK; c.stroke(m);
}

/**
 * A Blockling centred at (x, y) in icon units, `u` units per block, turned `rot`. `k` is px per unit:
 * the piece renderer works in px (its thinnest lines are a pixel), so it draws at that scale.
 */
function iconPiece(c: Ctx, k: number, key: string, q: number, x: number, y: number, u: number, rot: number, face: IconFace, faceScale = 1.3, at?: [number, number]): void {
  const p = pose(key, q), s = u * k;
  c.save(); c.translate(x, y); c.rotate(rot); c.scale(1 / k, 1 / k); c.translate((-p.w * s) / 2, (-p.h * s) / 2);
  drawPiece(c, key, q, s, { shadow: true, detail: true });
  const [ax, ay] = at ?? faceAnchor(p), fs = s * faceScale;
  c.translate(ax * s, ay * s);
  if (face === 'shock') drawFace(c, 0, 0, fs, 'panic', { look: [0, 0] });
  else if (face === 'happy') drawFace(c, 0, 0, fs, 'proud');
  else {
    // Wide eyes looking straight out, and a big open grin.
    drawEyes(c, fs, 'falling');
    for (const ox of [-FACE.eyeX * fs, FACE.eyeX * fs]) drawPupil(c, ox, FACE.eyeY * fs, fs, 1.15);
    bigGrin(c, fs);
  }
  c.restore();
}

/** Everything in front of the backdrop and planet: the burst, the Blocklings, the streaks. */
function iconBlast(c: Ctx, k: number): void {
  // Two small ones far off, up in the sky.
  iconPiece(c, k, 'I', 0, 0.19, 0.16, 0.045, -0.55, 'happy', 1.1);
  iconPiece(c, k, 'O', 0, 0.81, 0.13, 0.055, 0.35, 'happy', 1.1);
  iconBurst(c);
  // The two flanking, flung out sideways, then the hero, biggest and nearest.
  streaks(c, 0.16, 0.55, 0.22); streaks(c, 0.85, 0.5, 0.22); streaks(c, 0.5, 0.39, 0.32);
  iconPiece(c, k, 'L', 0, 0.17, 0.55, 0.125, 0.5, 'shock', 1.5);
  iconPiece(c, k, 'Z', 1, 0.85, 0.5, 0.125, -0.38, 'grin', 1.45);
  // The hero's face fills the T's bar.
  iconPiece(c, k, 'T', 2, 0.5, 0.39, 0.17, -0.12, 'grin', 1.75, [1.5, 0.56]);
}

export type IconLayer = 'full' | 'foreground' | 'background';

/**
 * The app icon, `px` square. 'full' is the iOS / store icon (square, opaque; the OS rounds it).
 * 'background' and 'foreground' are Android's adaptive layers (108 dp): the full icon's art scaled into
 * the 72 dp the launcher shows, the sky and planet in the background bleeding to the edges, the burst and
 * the Blocklings in the foreground. Their faces stay inside the 66 dp safe circle.
 */
export function bakeAppIcon(px: number, layer: IconLayer = 'full'): HTMLCanvasElement {
  const cv = makeCanvas(px, px), c = ctx2d(cv), f = layer === 'full' ? 1 : 72 / 108, k = px * f;
  c.translate((px * (1 - f)) / 2, (px * (1 - f)) / 2); c.scale(k, k);
  if (layer !== 'foreground') { iconSky(c); iconPlanet(c); }
  if (layer !== 'background') iconBlast(c, k);
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
  /** The tower at the end of the run: the frame shows its panorama (bakePanorama). */
  tower?: PanoramaData;
  /** The run's date for the postmark on the frame, e.g. "21 OCT 2026". Omit for none. */
  date?: string;
  /** A picture to frame instead (cover-fitted). Without `tower` or `shot`, the biome's postcard fills the frame. */
  shot?: CanvasImageSource & { width: number; height: number };
}

/** An ink postmark: two rings with the date inside and wavy cancel lines to the left, over a white halo. */
function postmark(c: Ctx, x: number, y: number, r: number, date: string): void {
  const cut = date.lastIndexOf(' '), lines = cut > 0 ? [date.slice(0, cut), date.slice(cut + 1)] : [date];
  c.save(); c.translate(x, y); c.rotate(-0.22); c.lineCap = 'round';
  for (const [col, extra] of [['rgba(255,255,255,0.7)', r * 0.09], ['rgba(34,24,58,0.85)', 0]] as const) {
    c.strokeStyle = col;
    c.lineWidth = r * 0.075 + extra; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke();
    c.lineWidth = r * 0.04 + extra; c.beginPath(); c.arc(0, 0, r * 0.76, 0, TAU); c.stroke();
    c.lineWidth = r * 0.06 + extra;
    for (const dy of [-0.42, 0, 0.42]) {
      c.beginPath(); c.moveTo(-r * 2.5, dy * r);
      for (let i = 1; i <= 24; i++) { const t = i / 24; c.lineTo(-r * 2.5 + t * r * 1.4, dy * r + Math.sin(t * TAU * 1.5) * r * 0.1); }
      c.stroke();
    }
  }
  c.font = `700 ${r * 0.3}px ${FONT_DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineJoin = 'round';
  lines.forEach((t, i) => {
    const ty = (i - (lines.length - 1) / 2) * r * 0.36;
    c.lineWidth = r * 0.08; c.strokeStyle = 'rgba(255,255,255,0.75)'; c.strokeText(t, 0, ty);
    c.fillStyle = 'rgba(34,24,58,0.85)'; c.fillText(t, 0, ty);
  });
  c.restore();
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
  const img = d.shot ?? (d.tower ? bakePanorama(d.tower, Math.round(iw), Math.round(ih)) : bakePostcard(d.biome, Math.round(iw / 2), Math.round(ih / 2), 2));
  const sc = Math.max(iw / img.width, ih / img.height);
  c.drawImage(img, -img.width * sc / 2, -fh / 2 + 18 * u + ih / 2 - img.height * sc / 2, img.width * sc, img.height * sc);
  c.restore();
  c.font = `700 ${46 * u}px ${FONT_DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = INK;
  c.fillText(b.name, 0, fh / 2 - 46 * u);
  if (d.date) postmark(c, fw / 2 - 118 * u, -fh / 2 + 112 * u, 72 * u, d.date);
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
