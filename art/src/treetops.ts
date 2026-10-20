// The Treetops backdrop (art-direction.md §6.1, §6.5): far blue mountains, mid clouds, a bird flock,
// hot-air balloons and kites near the screen edges, and tree canopies that fall away below as the
// tower climbs. Flat, outline-free and muted (§6.6), with the play column kept quiet.
//
// Parts are anchored to the screen at the moment the biome arrives ('entry'): y is screen px from
// the top at that moment, and each layer then sinks at its scroll factor as the view climbs.

import { type BackdropPart, cloud } from './meadow.ts';
import { type Ctx, TAU, circ, ctx2d, hash, makeCanvas } from './util.ts';

function mountains(c: Ctx, W: number, h: number): void {
  const range = (base: number, peaks: [number, number][], fill: string) => {
    c.fillStyle = fill; c.beginPath(); c.moveTo(-10, h);
    c.lineTo(-10, base);
    for (const [x, y] of peaks) { c.lineTo(x * W - W * 0.07, base + (y - base) * 0.15); c.lineTo(x * W, y); c.lineTo(x * W + W * 0.08, base + (y - base) * 0.1); }
    c.lineTo(W + 10, base); c.lineTo(W + 10, h); c.closePath(); c.fill();
  };
  range(h * 0.3, [[0.08, h * 0.08], [0.3, h * 0.16], [0.55, h * 0.04], [0.8, h * 0.12], [1.0, h * 0.06]], '#B9D2EE');
  range(h * 0.38, [[0.18, h * 0.16], [0.42, h * 0.24], [0.68, h * 0.14], [0.92, h * 0.2]], '#9DBFE6');
  // Snowcaps on the near range.
  c.fillStyle = '#EEF5FF';
  for (const [x, y] of [[0.18, h * 0.16], [0.68, h * 0.14], [0.92, h * 0.2]] as [number, number][]) {
    const px = x * W, w = W * 0.035;
    c.beginPath(); c.moveTo(px, y); c.lineTo(px + w, y + w * 0.9); c.lineTo(px + w * 0.4, y + w * 0.7); c.lineTo(px, y + w * 1.05); c.lineTo(px - w * 0.45, y + w * 0.7); c.lineTo(px - w * 0.9, y + w * 0.85); c.closePath(); c.fill();
  }
}

function canopyBand(c: Ctx, W: number, h: number, r: number, fills: [string, string, string], seed: number, keepClear = 0): void {
  const [base, shade, hi] = fills;
  c.fillStyle = shade; c.fillRect(0, r * 1.1, W, h);
  for (let pass = 0; pass < 2; pass++) {
    c.fillStyle = pass ? base : shade;
    c.beginPath();
    for (let x = -r; x < W + r; x += r * 1.15) {
      const j = hash(seed + x * 0.37), cx = x + j * r * 0.5;
      // Lower and smaller in the middle so the play column stays quiet.
      const mid = keepClear ? 1 - keepClear * Math.max(0, 1 - Math.abs(cx / W - 0.5) / 0.32) : 1;
      const rr = r * (0.75 + 0.45 * hash(seed * 3 + x)) * mid, cy = r * 1.1 + (1 - mid) * r * 0.9 + pass * r * 0.18;
      circ(c, cx, cy, rr);
    }
    c.fill();
  }
  c.fillStyle = hi; c.globalAlpha = 0.55; c.beginPath();
  for (let x = -r; x < W + r; x += r * 1.15) { const j = hash(seed + x * 0.37), cx = x + j * r * 0.5 - r * 0.25; circ(c, cx, r * 0.95 + hash(seed + x) * r * 0.3, r * 0.22); }
  c.fill(); c.globalAlpha = 1;
}

/** A big rounded canopy mass with a trunk-dark base, centred at (x, y), reaching down to h. */
function clump(c: Ctx, x: number, y: number, r: number, h: number, [base, shade, hi]: [string, string, string], seed: number): void {
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + hash(seed + i) * 0.5, d = r * (0.45 + 0.35 * hash(seed * 2 + i));
    blobs.push([x + Math.cos(a) * d * 1.3, y + Math.sin(a) * d * 0.8, r * (0.45 + 0.25 * hash(seed + i * 7))]);
  }
  c.fillStyle = shade; c.fillRect(x - r * 1.1, y, r * 2.2, h);
  c.beginPath(); for (const [bx, by, br] of blobs) circ(c, bx, by + r * 0.12, br); c.fill();
  c.fillStyle = base; c.beginPath(); circ(c, x, y, r * 0.95); for (const [bx, by, br] of blobs) if (by < y + r * 0.3) circ(c, bx, by, br * 0.92); c.fill();
  c.fillStyle = hi; c.globalAlpha = 0.6; c.beginPath();
  for (const [bx, by, br] of blobs) if (by < y) circ(c, bx - br * 0.25, by - br * 0.3, br * 0.32);
  c.fill(); c.globalAlpha = 1;
}

function balloon(c: Ctx, x: number, y: number, r: number, a: string, b: string): void {
  // Envelope with vertical gores, ropes and a basket.
  c.save(); c.translate(x, y);
  const env = new Path2D();
  env.moveTo(0, r * 1.25);
  env.bezierCurveTo(-r * 0.55, r * 0.95, -r * 1.05, r * 0.35, -r, -r * 0.1);
  env.bezierCurveTo(-r * 0.95, -r * 0.85, -r * 0.45, -r * 1.1, 0, -r * 1.1);
  env.bezierCurveTo(r * 0.45, -r * 1.1, r * 0.95, -r * 0.85, r, -r * 0.1);
  env.bezierCurveTo(r * 1.05, r * 0.35, r * 0.55, r * 0.95, 0, r * 1.25);
  c.fillStyle = a; c.fill(env);
  c.save(); c.clip(env); c.fillStyle = b;
  for (const gx of [-0.62, 0.1]) c.fillRect(gx * r, -r * 1.2, r * 0.42, r * 2.5);
  c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.ellipse(-r * 0.45, -r * 0.45, r * 0.22, r * 0.45, 0.2, 0, TAU); c.fill();
  c.fillStyle = 'rgba(40,40,80,0.1)'; c.beginPath(); c.ellipse(r * 0.55, r * 0.15, r * 0.45, r * 0.9, 0, 0, TAU); c.fill();
  c.restore();
  c.strokeStyle = 'rgba(90,70,60,0.6)'; c.lineWidth = Math.max(1, r * 0.04);
  c.beginPath(); c.moveTo(-r * 0.32, r * 1.08); c.lineTo(-r * 0.2, r * 1.55); c.moveTo(r * 0.32, r * 1.08); c.lineTo(r * 0.2, r * 1.55); c.stroke();
  c.fillStyle = '#A07C58'; c.fillRect(-r * 0.24, r * 1.52, r * 0.48, r * 0.3);
  c.restore();
}

function kite(c: Ctx, x: number, y: number, r: number, a: string, b: string, tail: string): void {
  c.save(); c.translate(x, y);
  // String down out of view, then the tail with bows.
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = Math.max(1, r * 0.03);
  c.beginPath(); c.moveTo(0, r * 1.1); c.quadraticCurveTo(r * 0.6, r * 3, r * 0.2, r * 5.2); c.stroke();
  c.strokeStyle = tail; c.lineWidth = Math.max(1, r * 0.05);
  c.beginPath(); c.moveTo(0, r * 1.1); c.bezierCurveTo(-r * 0.6, r * 1.7, r * 0.5, r * 2.2, -r * 0.2, r * 2.9); c.stroke();
  c.fillStyle = tail;
  for (const [bx, by] of [[-0.12, 1.6], [0.05, 2.15], [-0.1, 2.65]]) { const px = bx * r, py = by * r, w = r * 0.18; c.beginPath(); c.moveTo(px, py); c.lineTo(px - w, py - w * 0.6); c.lineTo(px - w, py + w * 0.6); c.closePath(); c.moveTo(px, py); c.lineTo(px + w, py - w * 0.6); c.lineTo(px + w, py + w * 0.6); c.closePath(); c.fill(); }
  // Diamond sail in four panels.
  const pts: [number, number][] = [[0, -r * 1.1], [r * 0.75, -r * 0.2], [0, r * 1.1], [-r * 0.75, -r * 0.2]];
  const quad = (i: number, fill: string) => { c.fillStyle = fill; c.beginPath(); c.moveTo(0, -r * 0.2); c.lineTo(...pts[i]); c.lineTo(...pts[(i + 1) % 4]); c.closePath(); c.fill(); };
  quad(0, a); quad(1, b); quad(2, a); quad(3, b);
  c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = Math.max(1, r * 0.04);
  c.beginPath(); c.moveTo(0, -r * 1.1); c.lineTo(0, r * 1.1); c.moveTo(-r * 0.75, -r * 0.2); c.lineTo(r * 0.75, -r * 0.2); c.stroke();
  c.restore();
}

/** A small flat bird, wings up (frame 0) or down (frame 1). */
export function bird(c: Ctx, x: number, y: number, r: number, frame: number, fill: string): void {
  c.fillStyle = fill; c.beginPath();
  const up = frame === 0 ? -1 : 0.35;
  c.moveTo(x - r, y + up * r * 0.6);
  c.quadraticCurveTo(x - r * 0.45, y + up * r * 0.1 - r * 0.15, x, y + r * 0.12);
  c.quadraticCurveTo(x + r * 0.45, y + up * r * 0.1 - r * 0.15, x + r, y + up * r * 0.6);
  c.quadraticCurveTo(x + r * 0.4, y + up * r * 0.05 + r * 0.05, x, y + r * 0.32);
  c.quadraticCurveTo(x - r * 0.4, y + up * r * 0.05 + r * 0.05, x - r, y + up * r * 0.6);
  c.fill();
}

/** Bake every Treetops part for a W×H view at k texture px per screen px. */
export function bakeTreetops(W: number, H: number, k: number): BackdropPart[] {
  const s = W / 12, parts: BackdropPart[] = [];
  const bake = (w: number, h: number, draw: (c: Ctx) => void): HTMLCanvasElement => {
    const cv = makeCanvas(w * k, h * k), c = ctx2d(cv); c.scale(k, k); draw(c); return cv;
  };
  const scale = W / 390;

  // L2 far mountains, barely moving.
  const mh = H * 0.5;
  parts.push({ key: 'tt_mountains', anchor: 'entry', z: 1, factor: 0.05, x: 0, y: H * 0.6, canvas: bake(W, mh, c => mountains(c, W, mh)) });

  // L3 mid clouds that keep drifting by as the view climbs.
  [[0.2, 0.22, 1.1, 6], [0.78, 0.48, 1.35, 9]].forEach(([fx, fy, sc, sp], i) => {
    const r = s * 0.62 * sc, cw = r * 3.2, ch = r * 2;
    parts.push({ key: `tt_cloud${i}`, anchor: 'entry', z: 2, factor: 0.14, wrapY: H * 1.6, x: W * fx, y: H * fy, originX: 0.5, originY: 0.5, drift: sp * scale, canvas: bake(cw, ch, c => cloud(c, cw * 0.45, ch * 0.62, r, 'rgba(255,255,255,0.9)')) });
  });

  // A loose flock gliding across the top.
  {
    const r = s * 0.16, fw = s * 3, fh = s * 1.6;
    parts.push({ key: 'tt_birds', anchor: 'entry', z: 3, factor: 0.16, wrapY: H * 1.7, x: W * 0.3, y: H * 0.16, originX: 0.5, originY: 0.5, drift: 16 * scale, bob: 3 * scale, canvas: bake(fw, fh, c => {
      const pts = [[0.15, 0.55], [0.32, 0.35], [0.46, 0.62], [0.6, 0.28], [0.74, 0.5], [0.88, 0.3]];
      pts.forEach(([px, py], i) => bird(c, px * fw, py * fh, r * (0.8 + 0.4 * hash(i)), i % 2, 'rgba(58,74,106,0.55)'));
    }) });
  }

  // Hot-air balloons at the edges.
  ([[0.1, 0.34, 0.55, '#E9A9A0', '#FFF2E2'], [0.9, 0.56, 0.7, '#A7C7E8', '#FFF2E2'], [0.84, 0.16, 0.42, '#EAD290', '#EDA889']] as [number, number, number, string, string][]).forEach(([fx, fy, rs, a, b], i) => {
    const r = s * rs, w = r * 2.4, h = r * 3.2;
    parts.push({ key: `tt_balloon${i}`, anchor: 'entry', z: 4, factor: 0.2 + i * 0.03, wrapY: H * 1.8, x: W * fx, y: H * fy, originX: 0.5, originY: 0.4, bob: (3 + i) * scale, canvas: bake(w, h, c => balloon(c, w / 2, h * 0.4, r, a, b)) });
  });

  // L3 far canopy band, sinking away.
  const ch = H * 0.6, cr = s * 0.9;
  parts.push({ key: 'tt_canopy_far', anchor: 'entry', z: 5, factor: 0.3, x: 0, y: H * 0.8, canvas: bake(W, ch, c => canopyBand(c, W, ch, cr, ['#86B98A', '#74A87B', '#A2CFA0'], 3.1, 0.35)) });

  // Kites near the edges, swaying.
  ([[0.07, 0.42, '#F2B0C8', '#FFE3EC', '#E98AAE'], [0.93, 0.3, '#A9DCC4', '#E6F7EF', '#6FBF9C'], [0.9, 0.74, '#F2D490', '#FFF3D6', '#E5B34E']] as [number, number, string, string, string][]).forEach(([fx, fy, a, b, t], i) => {
    const r = s * 0.42, w = r * 2.2, h = r * 6.6;
    parts.push({ key: `tt_kite${i}`, anchor: 'entry', z: 6, factor: 0.38, wrapY: H * 2, x: W * fx, y: H * fy, originX: 0.5, originY: 0.12, sway: 0.12, canvas: bake(w, h, c => kite(c, w / 2, r * 1.2, r, a, b, t)) });
  });

  // L4 near canopy clumps in the bottom corners: these fall away fastest.
  const nh = H * 0.55, nr = s * 1.5;
  parts.push({ key: 'tt_canopy_near', anchor: 'entry', z: 7, factor: 0.62, x: 0, y: H * 0.86, canvas: bake(W, nh, c => {
    clump(c, W * 0.06, nr * 0.95, nr, nh, ['#64A06E', '#538F5F', '#7DB884'], 7.7);
    clump(c, W * 0.97, nr * 0.75, nr * 1.1, nh, ['#5E9A68', '#4F8A5C', '#77B27F'], 2.9);
  }) });

  return parts;
}
