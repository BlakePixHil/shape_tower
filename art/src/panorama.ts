// The money shot (art-direction.md §7.4): the whole run in one still. The sky climbs from the Meadow
// through every biome reached, each biome's props sit in its own stretch, and the tower stands whole at
// the scale that fits: the plinth, every foundation, every piece (claimed ones in stone), a gold flag at
// each claimed checkpoint and the mint best-height flag. Plain data in (the sim's pieces and foundations
// when the run ends), a canvas out. bakeShareCard draws it when given `tower`.

import { BIOME_BAKERS } from './backdrops.ts';
import { BIOMES, biomeForCheckpoint, skyColors, starAmount } from './biomes.ts';
import { bakeFlag, bakePbFlag } from './checkpoint.ts';
import { FONT_DISPLAY, INK } from './config.ts';
import { drawPiece } from './piece.ts';
import { pose } from './shapes.ts';
import { SLAB_DEPTH, drawPedestal, drawSlab, type Grade } from './slab.ts';
import { clamp, ctx2d, hash, makeCanvas, smooth } from './util.ts';

const HALF_PI = Math.PI / 2;
/** The plinth's legs in blocks, as the game draws it (deck 0.6 + legs 0.4 = the sim's 1-block plinth). */
const PLINTH_LEGS = 0.4;
/** Where the ground is, in world blocks. */
const GROUND = -1;

export interface TowerPiece {
  shape: string;
  /** Centre of the piece's bounding box, in world blocks with y up (the sim's PieceView x and y). */
  x: number;
  y: number;
  /** Radians, counter-clockwise: Math.atan2(view.s, view.c). */
  angle: number;
  /** Claimed or Solid Row stone. */
  stone?: boolean;
}

/** A foundation (the sim's FoundationView): centre x, top surface and width in blocks. */
export interface TowerSlab {
  x: number;
  top: number;
  width: number;
  grade?: Grade;
}

export interface PanoramaData {
  /** Every piece still standing when the run ends. */
  pieces: TowerPiece[];
  /** The foundations bottom up: the starting plinth (top at 0, the ground a block below), then one per claimed checkpoint. */
  slabs: TowerSlab[];
  /** The highest the tower got this run, in world blocks. */
  top: number;
  /** Best height before this run, in world blocks: the mint flag. Omit for none. */
  pb?: number;
  /** Each biome's name where it starts, down the left edge (default true). */
  labels?: boolean;
}

/** The highest biome a run reached: claims are the foundations after the plinth. */
export const panoramaBiome = (d: PanoramaData): number => biomeForCheckpoint(Math.max(1, d.slabs.length));

/**
 * The panorama, w x h canvas px. Any aspect works; the tower is scaled to fit the height (and the width,
 * for a short wide one) and centred. About 30 to 60 ms on a laptop and a few times that on a phone, so
 * bake it once when the run ends.
 */
export function bakePanorama(d: PanoramaData, w: number, h: number): HTMLCanvasElement {
  const cv = makeCanvas(w, h), c = ctx2d(cv);
  const claims = d.slabs.slice(1).map(f => f.top);
  const gap = claims.length >= 2 ? claims[claims.length - 1] - claims[claims.length - 2] : claims[0] ?? 12;

  // Fit: the ground near the bottom, a little sky over the top, the tower at most 70% of the width.
  let x0 = Infinity, x1 = -Infinity;
  for (const f of d.slabs) { x0 = Math.min(x0, f.x - f.width / 2); x1 = Math.max(x1, f.x + f.width / 2); }
  for (const p of d.pieces) { x0 = Math.min(x0, p.x - 1.5); x1 = Math.max(x1, p.x + 1.5); }
  if (!isFinite(x0)) { x0 = -3; x1 = 3; }
  const span = Math.max(d.top, d.pb ?? 0, 4) + 3.5 - GROUND, ground = h * 0.9;
  const s = Math.min(ground * 0.95 / span, (w * 0.7) / (x1 - x0), w / 7);
  const cx = (x0 + x1) / 2;
  const X = (x: number): number => w / 2 + (x - cx) * s, Y = (y: number): number => ground - (y - GROUND) * s;
  const worldAt = (py: number): number => GROUND + (ground - py) / s;

  // Sky position at a height: checkpoint progress as the game's sky clock tracks it, easing into each new biome.
  const spAt = (y: number): number => {
    let n = 0;
    while (n < claims.length && claims[n] <= y) n++;
    const base = n ? claims[n - 1] : 0, next = n < claims.length ? claims[n] : base + gap;
    const f = clamp((y - base) / Math.max(1, next - base), 0, 1), toward = n + 1;
    const b = biomeForCheckpoint(toward), first = BIOMES[b].firstCp, count = (BIOMES[b + 1]?.firstCp ?? first + 6) - first;
    let sp = b + 0.7 * clamp((toward - first + f) / count, 0, 1);
    if (BIOMES[b + 1]?.firstCp === toward + 1) sp += (b + 1 - sp) * smooth(0.75, 1, f);
    return sp;
  };

  // The sky, row by row, then stars where it's dark enough.
  for (let py = 0; py < h; py += 2) { c.fillStyle = skyColors(spAt(worldAt(py)))[1]; c.fillRect(0, py, w, 2); }
  const k = w / 720;
  for (let i = 0, n = Math.round((w * h) / 1400); i < n; i++) {
    const px = hash(i * 1.71) * w, py = hash(i * 3.17 + 0.5) * h, a = starAmount(spAt(worldAt(py)));
    if (a < 0.05) continue;
    c.globalAlpha = a * (0.45 + 0.55 * hash(i * 7.3));
    c.fillStyle = '#FFFFFF'; c.beginPath(); c.arc(px, py, (0.6 + 1.1 * hash(i * 5.9)) * k, 0, Math.PI * 2); c.fill();
  }
  c.globalAlpha = 1;

  // Each biome's props in its stretch, at about half their phone size; the Meadow's stand on the ground.
  // Each stretch is drawn on its own layer and feathered into its neighbours, so no prop ends in a hard line.
  const top = panoramaBiome(d), starts = BIOMES.map((b, i) => (i === 0 ? GROUND : claims[b.firstCp - 2]));
  const sc = (w / 390) * 0.5, feather = 44 * k, layer = makeCanvas(w, h), lc = ctx2d(layer);
  for (let b = 0; b <= top; b++) {
    const y0 = starts[b], y1 = b < top ? starts[b + 1] : Math.max(d.top, y0 + gap) + 3.5;
    if (y0 === undefined || y1 === undefined) continue;
    const bandTop = Y(y1), bandBot = Y(y0), VW = w / sc, VH = Math.max(120, (bandBot - bandTop) / sc);
    lc.setTransform(1, 0, 0, 1, 0, 0); lc.globalCompositeOperation = 'source-over'; lc.globalAlpha = 1; lc.clearRect(0, 0, w, h);
    for (const P of BIOME_BAKERS[b](VW, VH, sc).sort((p, q) => p.z - q.z)) {
      if ((P.palette ?? 0) !== 0 || (P.flash && (P.flash.offset ?? 0) !== 0)) continue;
      let a = 1;
      if (P.flash) a = Math.min(1, P.flash.alpha * 3);
      if (P.pulse) a = (1 + P.pulse[1]) / 2;
      const r = P.res ?? 1, pw = P.canvas.width / r, ph = P.canvas.height / r;
      const px = P.x * sc - (P.originX ?? 0) * pw;
      const py = (P.anchor === 'entry' ? bandTop + P.y * sc : bandBot + P.y * sc) - (P.originY ?? 0) * ph;
      lc.globalAlpha = a;
      if (P.tile) {
        // A repeating tile (nebula): lay it down the stretch.
        for (let ty = bandTop - ph; ty < bandBot; ty += ph * 0.9) lc.drawImage(P.canvas, px, ty, pw, ph);
      } else lc.drawImage(P.canvas, px, py, pw, ph);
    }
    // Keep the stretch, fading out over `feather` past each end (the top biome runs to the top edge, the Meadow to the bottom).
    lc.globalAlpha = 1; lc.globalCompositeOperation = 'destination-in';
    const t0 = b === top ? -1 : bandTop - feather, b1 = b === 0 ? h + 1 : bandBot + feather * 0.5;
    const g = lc.createLinearGradient(0, Math.max(-1, t0), 0, Math.min(h + 1, b1)), L = Math.min(h + 1, b1) - Math.max(-1, t0);
    const at = (py: number): number => clamp((py - Math.max(-1, t0)) / Math.max(1, L), 0, 1);
    g.addColorStop(0, b === top ? '#000' : 'rgba(0,0,0,0)');
    g.addColorStop(at(b === top ? 0 : bandTop + feather * 0.6), '#000');
    g.addColorStop(at(b === 0 ? h : bandBot - feather * 0.3), '#000');
    g.addColorStop(1, b === 0 ? '#000' : 'rgba(0,0,0,0)');
    lc.fillStyle = g; lc.fillRect(0, 0, w, h);
    c.drawImage(layer, 0, 0);
  }
  c.globalAlpha = 1;

  // The foundations: the plinth on the ground, then each claim's slab in its biome's style.
  const pt = s / 32;
  d.slabs.forEach((f, j) => {
    const lx = X(f.x - f.width / 2), ty = Y(f.top);
    if (j === 0) drawPedestal(c, lx, ty, f.width * s, s, PLINTH_LEGS, pt);
    else drawSlab(c, lx, ty, f.width * s, SLAB_DEPTH * s, biomeForCheckpoint(j + 1), pt);
  });

  // The old best: a dashed line across behind the tower (the flag goes on after it).
  const fs = clamp(s * 1.6, 24 * k, 44 * k);
  if (d.pb !== undefined && d.pb > 0) {
    const py = Y(d.pb), lx0 = X(x0) - fs * 0.9, lx1 = X(x1) + fs * 0.4;
    c.save(); c.setLineDash([6 * k, 5 * k]); c.lineCap = 'round';
    c.lineWidth = 4.5 * k; c.strokeStyle = INK; c.beginPath(); c.moveTo(lx0, py); c.lineTo(lx1, py); c.stroke();
    c.lineWidth = 2.2 * k; c.strokeStyle = '#FFFFFF'; c.stroke();
    c.restore();
  }

  // The tower. Faces only where they'd read; the top piece is proud of itself.
  const order = [...d.pieces].sort((p, q) => p.y - q.y), highest = order[order.length - 1];
  for (const p of order) {
    const q = Math.round(p.angle / HALF_PI), ps = pose(p.shape, q);
    c.save();
    c.translate(X(p.x), Y(p.y)); c.rotate(-(p.angle - q * HALF_PI)); c.translate((-ps.w * s) / 2, (-ps.h * s) / 2);
    drawPiece(c, p.shape, q, s, { stone: p.stone, detail: s >= 20, shadow: false, finish: null, face: p.stone || s < 7 ? null : p === highest ? 'proud' : 'idle' });
    c.restore();
  }

  // Flags: gold at every claimed checkpoint (with its number), mint at the old best. Big enough to read.
  const num = Math.round(fs * 0.72);
  c.font = `700 ${num}px ${FONT_DISPLAY}`; c.textBaseline = 'middle'; c.lineJoin = 'round';
  d.slabs.slice(1).forEach((f, j) => {
    const fl = bakeFlag(0, fs), fx = X(f.x + f.width / 2) + 2 * k, fy = Y(f.top);
    c.drawImage(fl.canvas, fx - fl.originX * fl.canvas.width, fy - fl.originY * fl.canvas.height);
    const tx = fx + fs * 1.02, ty = fy - fs * 0.88;
    c.textAlign = 'left'; c.lineWidth = Math.max(2, num * 0.22); c.strokeStyle = INK; c.strokeText(String(j + 1), tx, ty);
    c.fillStyle = '#FFFFFF'; c.fillText(String(j + 1), tx, ty);
  });
  if (d.pb !== undefined && d.pb > 0) {
    const fl = bakePbFlag(fs), fx = X(x0) - fs * 0.9, fy = Y(d.pb);
    c.save(); c.translate(fx, fy); c.scale(-1, 1);
    c.drawImage(fl.canvas, -fl.originX * fl.canvas.width, -fl.originY * fl.canvas.height);
    c.restore();
  }

  // Biome names down the left edge, where each biome starts.
  if (d.labels ?? true) {
    const ls = Math.round(21 * k);
    c.font = `700 ${ls}px ${FONT_DISPLAY}`; c.textAlign = 'left'; c.textBaseline = 'bottom'; c.lineWidth = Math.max(2, ls * 0.26);
    for (let b = 1; b <= top; b++) {
      const y0 = starts[b];
      if (y0 === undefined) continue;
      const ty = Y(y0) - 4 * k, name = BIOMES[b].name.toUpperCase();
      c.strokeStyle = INK; c.strokeText(name, 12 * k, ty); c.fillStyle = '#FFFFFF'; c.fillText(name, 12 * k, ty);
    }
  }
  return cv;
}
