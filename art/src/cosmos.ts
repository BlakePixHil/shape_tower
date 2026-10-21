// Deep Cosmos (art-direction.md §6.1, §6.5): the endless last biome. Everything repeats as the view
// climbs. A soft nebula in one of four palettes (the Backdrop cross-fades to the next palette every
// 6 checkpoints), two far galaxies, tetromino constellations, a comet, and space jellies drifting up
// the screen edges. Flat and outline-free (§6.6); the play column stays quiet.
//
// Each palette change brings a surprise landmark that drifts by in the far layer: a cosmic whale,
// a Butterblock constellation that smiles, a comet swarm, and a derelict wheel station.

import { INK } from './config.ts';
import type { BackdropPart } from './meadow.ts';
import { ART_SHAPES } from './shapes.ts';
import { type Ctx, TAU, circ, ctx2d, hash, makeCanvas, rgba, rr, star4 } from './util.ts';

type Bake = (w: number, h: number, draw: (c: Ctx) => void) => HTMLCanvasElement;
const baker = (k: number): Bake => (w, h, draw) => { const cv = makeCanvas(w * k, h * k), c = ctx2d(cv); c.scale(k, k); draw(c); return cv; };

export interface CosmosPalette {
  name: string;
  /** Nebula cloud colors, most used first. */
  colors: [string, string, string];
  /** The bright heart of the nebula. */
  core: string;
}

/** In order of appearance: Deep Cosmos opens on 0 and moves on one palette every 6 checkpoints. */
export const COSMOS_PALETTES: CosmosPalette[] = [
  { name: 'Bubblegum Nebula', colors: ['#FF5FC8', '#8A4DFF', '#3BC8FF'], core: '#FFD6F4' },
  { name: 'Lagoon Nebula', colors: ['#2EE6C8', '#2E7BFF', '#9BFF8A'], core: '#D6FFF6' },
  { name: 'Ember Nebula', colors: ['#FF8A3C', '#FF3F6E', '#FFD15C'], core: '#FFF0D6' },
  { name: 'Aurora Nebula', colors: ['#B48CFF', '#5CE1FF', '#FF9BE0'], core: '#EEE6FF' },
];

export interface LandmarkPose { x: number; y: number; sc: number; rot: number; alpha: number }
export interface Landmark {
  name: string;
  /** Seconds on screen. */
  dur: number;
  /** Where the landmark is at progress p (0..1) on a W x H screen: its centre, scale, rotation and alpha. */
  path: (p: number, W: number, H: number) => LandmarkPose;
}

/** One per palette, in the same order. */
export const LANDMARKS: Landmark[] = [
  { name: 'Cosmic whale', dur: 16, path: (p, W, H) => ({
    x: W * (-0.75 + 2.5 * p), y: H * 0.3 + Math.sin(p * TAU * 1.5) * H * 0.025, sc: 1, rot: Math.cos(p * TAU * 1.5) * 0.05, alpha: 0.9,
  }) },
  { name: 'Butterblock constellation', dur: 10, path: (p, W, H) => ({
    x: W * 0.27, y: H * (0.2 - 0.03 * p), sc: 0.9 + 0.1 * p, rot: -0.08 + 0.06 * p, alpha: 0.95,
  }) },
  { name: 'Comet swarm', dur: 4.5, path: (p, W, H) => ({
    x: W * (1.5 - 2 * p), y: H * (0.05 + 0.37 * p), sc: 1, rot: 0, alpha: 1,
  }) },
  { name: 'Derelict station', dur: 18, path: (p, W, H) => ({
    x: W * (1.45 - 1.9 * p), y: H * (0.17 + 0.1 * p), sc: 1, rot: 0.3 - 0.8 * p, alpha: 0.9,
  }) },
];

// ---- drawing ----

/**
 * A nebula tile W wide and period + H tall whose content repeats every `period` px, so it always
 * covers the screen as it wraps. Soft clouds biased to the screen edges, wispy filaments, dark dust
 * lanes, and a faded middle so the play column stays quiet.
 */
function nebula(c: Ctx, W: number, period: number, H: number, pal: CosmosPalette, seed: number): void {
  const h = period + H;
  // Anything drawn at y is drawn again a period above and below so the tile wraps seamlessly.
  const rep = (y: number, r: number, draw: (yy: number) => void) => {
    for (let n = -1; n <= 2; n++) { const yy = y + n * period; if (yy + r > 0 && yy - r < h) draw(yy); }
  };
  const blob = (x: number, y: number, rx: number, ry: number, rot: number, col: string, a: number) => rep(y, Math.max(rx, ry), yy => {
    c.save(); c.translate(x, yy); c.rotate(rot); c.scale(rx / ry, 1);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, ry);
    g.addColorStop(0, rgba(col, a)); g.addColorStop(0.45, rgba(col, a * 0.5)); g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g; c.beginPath(); circ(c, 0, 0, ry); c.fill(); c.restore();
  });
  const edgeX = (i: number) => { const side = hash(seed + i * 3.1) < 0.5, d = hash(seed + i * 1.3); return W * (side ? d * 0.38 : 1 - d * 0.38); };

  c.globalCompositeOperation = 'lighter';
  // Big clouds.
  for (let i = 0; i < 8; i++) {
    const r = W * (0.28 + 0.3 * hash(seed + i * 7.3));
    blob(edgeX(i), hash(seed + i * 5.7) * period, r * 1.4, r, hash(seed + i * 2.9) * TAU, pal.colors[i % 3], 0.3 + 0.18 * hash(seed + i * 1.9));
  }
  // Filaments: strings of small soft puffs along a wave.
  for (let f = 0; f < 5; f++) {
    const y0 = hash(seed + f * 11.3) * period, x0 = edgeX(f + 20), len = W * (0.5 + 0.4 * hash(seed + f * 4.1));
    const ang = (hash(seed + f * 6.7) - 0.5) * 1.6, col = pal.colors[(f + 1) % 3], amp = W * 0.05, ph = hash(seed + f * 8.2) * TAU;
    for (let i = 0; i < 46; i++) {
      const t = i / 45 - 0.5, along = t * len, wob = Math.sin(t * 7 + ph) * amp;
      const x = x0 + Math.cos(ang) * along - Math.sin(ang) * wob, y = y0 + Math.sin(ang) * along + Math.cos(ang) * wob;
      const r = W * (0.035 + 0.03 * hash(seed + f * 100 + i)) * (1 - Math.abs(t) * 0.9);
      blob(x, y, r, r, 0, col, 0.12);
    }
  }
  // The bright heart, near one edge.
  {
    const x = edgeX(40), y = hash(seed + 41) * period;
    blob(x, y, W * 0.22, W * 0.15, hash(seed + 42) * TAU, pal.core, 0.32);
    blob(x, y, W * 0.07, W * 0.06, 0, '#FFFFFF', 0.35);
  }

  c.globalCompositeOperation = 'destination-out';
  // Dark dust lanes.
  for (let i = 0; i < 3; i++) {
    const r = W * (0.1 + 0.08 * hash(seed + i * 9.9));
    blob(edgeX(i + 60), hash(seed + i * 13.1) * period, r * 2.6, r * 0.5, (hash(seed + i * 5.1) - 0.5) * 1.4, '#000000', 0.45);
  }
  // Quiet the play column.
  const g = c.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.32, 'rgba(0,0,0,0.4)'); g.addColorStop(0.5, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.68, 'rgba(0,0,0,0.4)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, W, h);
  c.globalCompositeOperation = 'source-over';
}

/** A spiral galaxy of radius r, squashed to `squash` by its tilt. */
function galaxy(c: Ctx, x: number, y: number, r: number, tilt: number, squash: number, arm: string, core: string, seed: number): void {
  c.save(); c.translate(x, y); c.rotate(tilt); c.scale(1, squash);
  const halo = c.createRadialGradient(0, 0, 0, 0, 0, r * 1.1);
  halo.addColorStop(0, rgba(arm, 0.35)); halo.addColorStop(0.5, rgba(arm, 0.12)); halo.addColorStop(1, rgba(arm, 0));
  c.fillStyle = halo; c.beginPath(); circ(c, 0, 0, r * 1.1); c.fill();
  for (let a = 0; a < 2; a++) {
    for (let i = 0; i < 70; i++) {
      const t = i / 69, ang = a * Math.PI + t * 3.4 + (hash(seed + a * 100 + i) - 0.5) * 0.25, d = r * (0.12 + 0.85 * t);
      const pr = r * (0.11 * (1 - t) + 0.025), px = Math.cos(ang) * d, py = Math.sin(ang) * d;
      const g = c.createRadialGradient(px, py, 0, px, py, pr);
      g.addColorStop(0, rgba(t < 0.4 ? core : arm, 0.5 * (1 - t) + 0.12)); g.addColorStop(1, rgba(arm, 0));
      c.fillStyle = g; c.beginPath(); circ(c, px, py, pr); c.fill();
    }
  }
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r * 0.3);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, rgba(core, 0.7)); g.addColorStop(1, rgba(core, 0));
  c.fillStyle = g; c.beginPath(); circ(c, 0, 0, r * 0.3); c.fill();
  c.restore();
}

/** A soft star point with a glow; `sparkle` adds a four-point glint. */
function starPoint(c: Ctx, x: number, y: number, r: number, col: string, sparkle = false): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r * 4);
  g.addColorStop(0, rgba(col, 0.55)); g.addColorStop(1, rgba(col, 0));
  c.fillStyle = g; c.beginPath(); circ(c, x, y, r * 4); c.fill();
  c.fillStyle = '#FFFFFF'; c.beginPath(); circ(c, x, y, r); c.fill();
  if (sparkle) { c.fillStyle = 'rgba(255,255,255,0.85)'; star4(c, x, y, r * 4.2); }
}

/** A tetromino as a constellation: a star on each cell, lines between neighbouring cells, a faint glow per cell. */
function constellation(c: Ctx, x: number, y: number, cells: [number, number][], u: number, col: string, seed: number): void {
  const pts = cells.map(([cx, cy]) => [x + cx * u, y - cy * u] as const);
  for (const [px, py] of pts) { c.fillStyle = rgba(col, 0.06); rr(c, px - u * 0.46, py - u * 0.46, u * 0.92, u * 0.92, u * 0.14); c.fill(); }
  c.strokeStyle = rgba(col, 0.45); c.lineWidth = Math.max(1, u * 0.04); c.lineCap = 'round';
  c.beginPath();
  cells.forEach(([ax, ay], i) => cells.forEach(([bx, by], j) => {
    if (j > i && Math.abs(ax - bx) + Math.abs(ay - by) === 1) { c.moveTo(pts[i][0], pts[i][1]); c.lineTo(pts[j][0], pts[j][1]); }
  }));
  c.stroke();
  pts.forEach(([px, py], i) => starPoint(c, px, py, u * (0.06 + 0.04 * hash(seed + i)), col, i === 0));
}

/** A comet with its head at (x, y) and its tail pointing at angle `ang`. */
function comet(c: Ctx, x: number, y: number, len: number, r: number, ang: number, dust: string, ion: string): void {
  c.save(); c.translate(x, y); c.rotate(ang);
  // Ion tail: straight and thin. Dust tail: wider and gently curved.
  for (const [col, w, bend, l] of [[ion, 0.55, 0, 1.15], [dust, 1, 0.22, 1]] as [string, number, number, number][]) {
    const g = c.createLinearGradient(0, 0, len * l, 0);
    g.addColorStop(0, rgba(col, 0.75)); g.addColorStop(0.35, rgba(col, 0.3)); g.addColorStop(1, rgba(col, 0));
    c.fillStyle = g; c.beginPath(); c.moveTo(0, -r * w);
    c.quadraticCurveTo(len * l * 0.5, -r * w * 1.6 + len * bend * 0.3, len * l, -r * w * 2 + len * bend * 0.45);
    c.lineTo(len * l, r * w * 2 + len * bend * 0.45); c.quadraticCurveTo(len * l * 0.5, r * w * 1.6 + len * bend * 0.3, 0, r * w);
    c.closePath(); c.fill();
  }
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r * 3);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, rgba(dust, 0.8)); g.addColorStop(1, rgba(dust, 0));
  c.fillStyle = g; c.beginPath(); circ(c, 0, 0, r * 3); c.fill();
  c.restore();
}

/** A space jelly with a little face. f: 0 relaxed (wide bell, trailing tentacles) .. 1 squeezed (tall bell, tentacles spread). */
function jelly(c: Ctx, x: number, y: number, u: number, f: number, col: string, seed: number): void {
  const rx = u * (0.6 - 0.12 * f), ry = u * (0.44 + 0.14 * f);
  const glow = c.createRadialGradient(x, y - ry * 0.3, 0, x, y - ry * 0.3, u * 1.2);
  glow.addColorStop(0, rgba(col, 0.32)); glow.addColorStop(1, rgba(col, 0));
  c.fillStyle = glow; c.beginPath(); circ(c, x, y - ry * 0.3, u * 1.2); c.fill();
  c.lineCap = 'round';
  for (let i = 0; i < 5; i++) {
    const tx = x + (i - 2) * rx * 0.36, len = u * (0.95 + 0.3 * hash(seed + i * 3.3)) * (1 - 0.2 * f), spread = (i - 2) * u * 0.1 * f;
    const w = u * (0.15 - 0.04 * f) * (i % 2 ? 1 : -1);
    c.strokeStyle = rgba(col, 0.55); c.lineWidth = u * (i === 2 ? 0.1 : 0.065);
    c.beginPath(); c.moveTo(tx, y - u * 0.02);
    c.bezierCurveTo(tx + w + spread * 0.3, y + len * 0.33, tx - w + spread * 0.6, y + len * 0.66, tx + spread, y + len); c.stroke();
  }
  // The bell, with a scalloped skirt.
  const bell = new Path2D();
  bell.ellipse(x, y, rx, ry, 0, Math.PI, TAU);
  const n = 5;
  for (let i = n; i > 0; i--) {
    const x0 = x - rx + (2 * rx * i) / n, x1 = x - rx + (2 * rx * (i - 1)) / n;
    bell.quadraticCurveTo((x0 + x1) / 2, y + u * 0.14, x1, y);
  }
  bell.closePath();
  const g = c.createLinearGradient(0, y - ry, 0, y + u * 0.1);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.45, rgba(col, 0.85)); g.addColorStop(1, rgba(col, 0.6));
  c.fillStyle = g; c.fill(bell);
  c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.ellipse(x - rx * 0.42, y - ry * 0.62, rx * 0.2, ry * 0.12, -0.6, 0, TAU); c.fill();
  // Face: dot eyes and a small smile.
  c.fillStyle = INK;
  c.beginPath(); circ(c, x - rx * 0.3, y - ry * 0.32, u * 0.055); circ(c, x + rx * 0.3, y - ry * 0.32, u * 0.055); c.fill();
  c.strokeStyle = INK; c.lineWidth = u * 0.04;
  c.beginPath(); c.arc(x, y - ry * 0.26, u * 0.09, 0.35, Math.PI - 0.35); c.stroke();
  c.fillStyle = 'rgba(255,120,170,0.45)';
  c.beginPath(); circ(c, x - rx * 0.52, y - ry * 0.18, u * 0.06); circ(c, x + rx * 0.52, y - ry * 0.18, u * 0.06); c.fill();
}

/** Bake every Deep Cosmos part. */
export function bakeCosmos(W: number, H: number, k: number): BackdropPart[] {
  const s = W / 12, parts: BackdropPart[] = [], bake = baker(k), scale = W / 390;

  // L1 nebulae: one soft repeating tile per palette, baked at low resolution; only the current palette shows.
  const period = H * 1.4, res = 0.35;
  COSMOS_PALETTES.forEach((pal, p) => {
    parts.push({ key: `cz_neb${p}`, anchor: 'entry', z: 0.1 + p * 0.05, factor: 0.03, x: 0, y: 0, wrapY: period, tile: true, res, palette: p,
      canvas: baker(k * res)(W, period + H, c => nebula(c, W, period, H, pal, 17 + p * 31.7)) });
  });

  // L2 two far galaxies: one face-on and slowly turning, one tilted.
  {
    const r = s * 1.5, w = r * 2.4;
    parts.push({ key: 'cz_gal0', anchor: 'entry', z: 1, factor: 0.045, wrapY: H * 2.1, x: W * 0.82, y: H * 0.16, originX: 0.5, originY: 0.5, spin: 0.025,
      canvas: bake(w, w, c => galaxy(c, w / 2, w / 2, r, 0, 0.85, '#9FB4FF', '#FFE6F7', 3)) });
    const r2 = s * 1.1, w2 = r2 * 2.4;
    parts.push({ key: 'cz_gal1', anchor: 'entry', z: 1.1, factor: 0.06, wrapY: H * 2.1, x: W * 0.13, y: H * 1.2, originX: 0.5, originY: 0.5,
      canvas: bake(w2, w2, c => galaxy(c, w2 / 2, w2 / 2, r2, 0.5, 0.38, '#FF9BE0', '#FFF1D6', 9)) });
  }

  // L3 tetromino constellations near the edges, twinkling slowly.
  ([['T', 0.04, 0.12], ['L', 0.7, 0.5], ['S', 0.06, 0.86]] as [string, number, number][]).forEach(([key, fx, fy], i) => {
    const sh = ART_SHAPES[key], cells = sh.cells ?? [], u = s * 0.85, cw = u * 3.6, ch = u * 2.6;
    parts.push({ key: `cz_con${i}`, anchor: 'entry', z: 2 + i * 0.1, factor: 0.05 + i * 0.01, wrapY: H * 1.7, x: W * fx, y: H * fy, pulse: [0.18 + i * 0.05, 0.55],
      canvas: bake(cw, ch, c => constellation(c, u * 0.55, ch - u * 0.75, cells, u, sh.light, i * 5.3)) });
  });

  // L4 a comet crossing high up, its tail trailing behind.
  {
    const w = s * 5.2, h = s * 1.6;
    parts.push({ key: 'cz_comet', anchor: 'entry', z: 3, factor: 0.09, wrapY: H * 2.4, x: W * 0.3, y: H * 0.07, originX: 0.85, originY: 0.5, drift: 22 * scale,
      canvas: bake(w, h, c => comet(c, w * 0.85, h * 0.5, w * 0.8, s * 0.09, Math.PI + 0.08, '#FFE3F7', '#8FD8FF')) });
  }

  // L5 space jellies drifting up the screen edges, pulsing.
  ([[0.09, 0.55, 1, '#FFB8F0', 4], [0.9, 0.25, 0.8, '#8FE6FF', -3], [0.88, 1.05, 0.65, '#C9A8FF', 2]] as [number, number, number, string, number][]).forEach(([fx, fy, sc, col, dr], i) => {
    const u = s * 0.85 * sc, w = u * 2.6, h = u * 2.8;
    const frame = (f: number) => bake(w, h, c => jelly(c, w / 2, h * 0.32, u, f, col, i * 7.7));
    const f0 = frame(0), f1 = frame(0.5), f2 = frame(1);
    parts.push({ key: `cz_jelly${i}`, anchor: 'entry', z: 5 + i * 0.1, factor: 0.2 + i * 0.06, wrapY: H * 1.6, x: W * fx, y: H * fy, originX: 0.5, originY: 0.32,
      fall: -11 * scale * sc, drift: dr * scale, bob: 4 * scale, fps: 2.4, frames: [f0, f1, f2, f1], canvas: f0 });
  });
  return parts;
}

// ---- landmarks ----

/** The cosmic whale, swimming right: a starry back, a pale belly, a happy eye, sparkles trailing behind. */
function whale(c: Ctx, w: number, h: number, glow: string): void {
  const cy = h * 0.5, u = h * 0.4, x0 = w * 0.3, L = w - x0;
  const X = (f: number) => x0 + L * f;
  c.save(); c.translate(X(0.55), cy); c.scale(L * 0.62 / (h * 0.49), 1);
  const halo = c.createRadialGradient(0, 0, 0, 0, 0, h * 0.49);
  halo.addColorStop(0, rgba(glow, 0.3)); halo.addColorStop(1, rgba(glow, 0));
  c.fillStyle = halo; c.beginPath(); circ(c, 0, 0, h * 0.49); c.fill(); c.restore();
  // Sparkle trail.
  for (let i = 0; i < 26; i++) {
    const t = hash(i * 3.7), x = X(0.05) - t * x0 * 0.95, y = cy + (hash(i * 5.3) - 0.5) * u * (0.4 + t * 1.2) + Math.sin(t * 9) * u * 0.15;
    starPoint(c, x, y, u * 0.025 * (1 - t * 0.6), glow, i % 7 === 0);
  }
  // Tail flukes.
  c.fillStyle = '#3A3C8E';
  for (const sgn of [-1, 1]) {
    c.beginPath(); c.moveTo(X(0.1), cy + u * 0.02);
    c.quadraticCurveTo(X(0.02), cy + sgn * u * 0.2, X(-0.04), cy + sgn * u * 0.62);
    c.quadraticCurveTo(X(0.06), cy + sgn * u * 0.42, X(0.14), cy + sgn * u * 0.05);
    c.closePath(); c.fill();
  }
  // Body.
  const body = new Path2D();
  body.moveTo(X(0.08), cy - u * 0.06);
  body.bezierCurveTo(X(0.3), cy - u * 0.22, X(0.5), cy - u * 0.95, X(0.75), cy - u * 0.88);
  body.bezierCurveTo(X(0.92), cy - u * 0.82, X(1.0), cy - u * 0.38, X(0.99), cy - u * 0.04);
  body.bezierCurveTo(X(0.98), cy + u * 0.48, X(0.82), cy + u * 0.72, X(0.62), cy + u * 0.68);
  body.bezierCurveTo(X(0.42), cy + u * 0.62, X(0.26), cy + u * 0.22, X(0.08), cy + u * 0.08);
  body.closePath();
  c.fillStyle = '#4447A6'; c.fill(body);
  c.save(); c.clip(body);
  // Pale belly with throat pleats.
  c.fillStyle = '#9AA6EE'; c.beginPath(); c.ellipse(X(0.66), cy + u * 0.78, L * 0.42, u * 0.62, -0.08, 0, TAU); c.fill();
  c.strokeStyle = 'rgba(68,71,166,0.45)'; c.lineWidth = u * 0.035; c.lineCap = 'round';
  for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(X(0.62), cy + u * (0.3 + i * 0.1)); c.quadraticCurveTo(X(0.8), cy + u * (0.36 + i * 0.1), X(0.95), cy + u * (0.12 + i * 0.1)); c.stroke(); }
  // Light along the back, and stars on it.
  c.fillStyle = 'rgba(150,160,255,0.35)'; c.beginPath(); c.ellipse(X(0.66), cy - u * 0.9, L * 0.3, u * 0.32, 0.05, 0, TAU); c.fill();
  for (let i = 0; i < 16; i++) {
    const t = 0.18 + 0.75 * hash(i * 2.3), x = X(t), y = cy - u * (0.15 + 0.6 * hash(i * 4.1)) * Math.min(1, t * 1.6);
    c.fillStyle = `rgba(255,255,255,${0.5 + 0.4 * hash(i * 6.6)})`; c.beginPath(); circ(c, x, y, u * (0.02 + 0.025 * hash(i * 8.8))); c.fill();
  }
  c.restore();
  // Pectoral fin.
  c.fillStyle = '#3A3C8E'; c.beginPath(); c.ellipse(X(0.6), cy + u * 0.6, L * 0.12, u * 0.14, 0.55, 0, TAU); c.fill();
  // Face: a happy closed eye and a smile, a rosy cheek.
  c.strokeStyle = INK; c.lineCap = 'round'; c.lineWidth = u * 0.06;
  c.beginPath(); c.arc(X(0.86), cy + u * 0.06, u * 0.08, Math.PI + 0.3, TAU - 0.3); c.stroke();
  c.lineWidth = u * 0.045;
  c.beginPath(); c.moveTo(X(0.78), cy + u * 0.3); c.quadraticCurveTo(X(0.9), cy + u * 0.4, X(0.985), cy + u * 0.16); c.stroke();
  c.fillStyle = 'rgba(255,130,190,0.5)'; c.beginPath(); c.ellipse(X(0.87), cy + u * 0.24, u * 0.09, u * 0.06, 0, 0, TAU); c.fill();
}

/** A Butterblock (2 x 2) traced in stars, with a star-smile. */
function butterConstellation(c: Ctx, w: number, h: number): void {
  const col = ART_SHAPES.O.light, u = w * 0.36, x0 = (w - u * 2) / 2, y0 = (h - u * 2) / 2;
  c.fillStyle = rgba(col, 0.07); rr(c, x0, y0, u * 2, u * 2, u * 0.3); c.fill();
  const corner: [number, number][] = [];
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++) if (i !== 1 || j !== 1) corner.push([x0 + i * u, y0 + j * u]);
  c.strokeStyle = rgba(col, 0.5); c.lineWidth = Math.max(1, u * 0.025); c.lineCap = 'round';
  c.beginPath(); c.rect(x0, y0, u * 2, u * 2); c.stroke();
  c.strokeStyle = rgba(col, 0.2); c.beginPath(); c.moveTo(x0 + u, y0); c.lineTo(x0 + u, y0 + u * 2); c.moveTo(x0, y0 + u); c.lineTo(x0 + u * 2, y0 + u); c.stroke();
  corner.forEach(([x, y], i) => starPoint(c, x, y, u * (0.035 + 0.02 * hash(i * 3.1)), col, i === 0 || i === 7));
  // Eyes: two bright stars. Smile: an arc of small ones.
  starPoint(c, x0 + u * 0.62, y0 + u * 0.78, u * 0.06, '#FFFFFF', true);
  starPoint(c, x0 + u * 1.38, y0 + u * 0.78, u * 0.06, '#FFFFFF', true);
  for (let i = 0; i < 5; i++) {
    const a = Math.PI * (0.2 + 0.15 * i);
    starPoint(c, x0 + u + Math.cos(a) * u * 0.42, y0 + u * 1.05 + Math.sin(a) * u * 0.42, u * 0.028, col);
  }
}

/** Five comets in a loose flock, tails pointing back along their path. */
function cometSwarm(c: Ctx, w: number, h: number, W: number, H: number): void {
  const ang = Math.atan2(-0.37 * H, 2 * W), s = W / 12;
  [[0.2, 0.62, 1], [0.38, 0.38, 0.7], [0.5, 0.78, 0.55], [0.12, 0.3, 0.45], [0.62, 0.55, 0.4]].forEach(([fx, fy, sc], i) => {
    comet(c, w * fx, h * fy, W * 0.42 * sc, s * 0.13 * sc, ang + (hash(i * 3.3) - 0.5) * 0.05, i % 2 ? '#FFF1C9' : '#FFD6F4', '#8FD8FF');
  });
}

/** A wheel station, long abandoned: a broken rim, spokes, a hub with a dangling solar wing, one window still lit. */
function derelict(c: Ctx, w: number, h: number): void {
  const x = w / 2, y = h / 2, R = w * 0.4, rim = R * 0.16;
  // Debris drifting out of the broken rim.
  c.fillStyle = '#6A6F88';
  for (let i = 0; i < 6; i++) {
    const a = 0.1 + hash(i * 2.7) * 0.5, d = R * (1.08 + hash(i * 4.4) * 0.12), r = rim * (0.12 + 0.18 * hash(i * 6.1));
    c.save(); c.translate(x + Math.cos(a) * d, y + Math.sin(a) * d); c.rotate(hash(i * 9.1) * TAU); c.fillRect(-r, -r * 0.6, r * 2, r * 1.2); c.restore();
  }
  // Spokes.
  c.strokeStyle = '#7D8299'; c.lineWidth = rim * 0.35;
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + 0.4; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); c.stroke(); }
  // The rim, with its broken gap.
  const gap0 = 0.12, gap1 = 0.62;
  c.lineCap = 'butt';
  c.strokeStyle = '#4E5269'; c.lineWidth = rim; c.beginPath(); c.arc(x, y + rim * 0.08, R, gap1, TAU + gap0); c.stroke();
  c.strokeStyle = '#8C91A9'; c.lineWidth = rim * 0.8; c.beginPath(); c.arc(x, y, R, gap1, TAU + gap0); c.stroke();
  c.strokeStyle = '#B3B8CC'; c.lineWidth = rim * 0.22; c.beginPath(); c.arc(x, y, R - rim * 0.25, gap1 + 0.02, TAU + gap0 - 0.02); c.stroke();
  // Segment seams and windows: all dark but one.
  for (let i = 0; i < 18; i++) {
    const a = gap1 + 0.1 + (i / 18) * (TAU + gap0 - gap1 - 0.2), cx = x + Math.cos(a) * R, cy = y + Math.sin(a) * R;
    c.fillStyle = i === 11 ? '#FFC46B' : '#3B3E52'; c.beginPath(); circ(c, cx, cy, rim * 0.16); c.fill();
    if (i === 11) { const g = c.createRadialGradient(cx, cy, 0, cx, cy, rim * 0.9); g.addColorStop(0, 'rgba(255,196,107,0.55)'); g.addColorStop(1, 'rgba(255,196,107,0)'); c.fillStyle = g; c.beginPath(); circ(c, cx, cy, rim * 0.9); c.fill(); }
  }
  // Hub.
  c.fillStyle = '#9DA2B8'; c.beginPath(); circ(c, x, y, R * 0.2); c.fill();
  c.fillStyle = '#C4C8D8'; c.beginPath(); circ(c, x - R * 0.04, y - R * 0.04, R * 0.12); c.fill();
  c.fillStyle = '#5E627A'; c.beginPath(); circ(c, x, y, R * 0.05); c.fill();
  // A solar wing hanging off the hub at a crooked angle.
  c.save(); c.translate(x + R * 0.12, y - R * 0.12); c.rotate(-0.95);
  c.fillStyle = '#7D8299'; c.fillRect(0, -rim * 0.08, R * 0.35, rim * 0.16);
  c.fillStyle = '#34417A'; c.fillRect(R * 0.35, -rim * 0.9, R * 0.5, rim * 1.8);
  c.strokeStyle = '#5363A0'; c.lineWidth = rim * 0.08; c.beginPath();
  for (let i = 1; i < 5; i++) { c.moveTo(R * (0.35 + 0.1 * i), -rim * 0.9); c.lineTo(R * (0.35 + 0.1 * i), rim * 0.9); }
  c.stroke();
  c.fillStyle = '#1E2546'; c.beginPath(); c.moveTo(R * 0.7, rim * 0.9); c.lineTo(R * 0.85, rim * 0.9); c.lineTo(R * 0.85, -rim * 0.1); c.closePath(); c.fill();
  c.restore();
}

/** Landmark n's texture at k texture px per screen px. Its centre is the pose's (x, y). */
export function bakeLandmark(n: number, W: number, H: number, k: number): HTMLCanvasElement {
  const bake = baker(k), i = ((n % LANDMARKS.length) + LANDMARKS.length) % LANDMARKS.length;
  const pal = COSMOS_PALETTES[i % COSMOS_PALETTES.length];
  if (i === 0) { const w = W * 1.25, h = W * 0.55; return bake(w, h, c => whale(c, w, h, pal.colors[0])); }
  if (i === 1) { const w = W * 0.42; return bake(w, w, c => butterConstellation(c, w, w)); }
  if (i === 2) { const w = W * 0.9, h = H * 0.4; return bake(w, h, c => cometSwarm(c, w, h, W, H)); }
  const w = W * 0.62;
  return bake(w, w, c => derelict(c, w, w));
}
