// The Meadow backdrop (art-direction.md §6.1, §6.5): sun, drifting clouds, far hills with a windmill
// farmhouse, near hills with trees, a picket fence and the cow that watches the tower, and the grass
// strip the first pedestal stands on. Backgrounds are flat and outline-free (§6.6).
//
// Everything is baked for one view size. Positions are in screen px; vertical offsets are measured
// from the ground line (negative = above it), so the view can slide each layer at its scroll factor.

import { type Ctx, TAU, circ, ctx2d, hash, makeCanvas, rr } from './util.ts';

export interface BackdropPart {
  key: string;
  canvas: HTMLCanvasElement;
  /** Left edge (or centre, for parts with an origin of 0.5) in screen px. */
  x: number;
  /** Top edge (or centre) relative to the ground line, in screen px. */
  y: number;
  /** Parallax: 0 = fixed to the screen, 1 = moves with the world. */
  factor: number;
  /** Draw order inside the backdrop, back to front. */
  z: number;
  originX?: number;
  originY?: number;
  /** Horizontal drift in px/s; wraps around the screen width. */
  drift?: number;
  /** Rotation speed in rad/s (windmill sails). */
  spin?: number;
  /** Idle bob amplitude in px (the cow). */
  bob?: number;
  /**
   * What y is measured from. 'ground' (default): the world's ground line, for the Meadow.
   * 'entry': the top of the screen at the moment the biome arrives, for every biome above it.
   */
  anchor?: 'ground' | 'entry';
  /** Vertical repeat period in screen px, for ambient props that should keep coming as the view climbs. */
  wrapY?: number;
  /** Rotation sway amplitude in radians (kites). */
  sway?: number;
  /** Vertical drift in px/s, for falling rain or a rising balloon. Needs wrapY (or tile) to keep coming. */
  fall?: number;
  /**
   * With wrapY: the canvas is a vertical tile whose content repeats every wrapY px and is wrapY + H
   * tall, so it always covers the screen (rain, nebulae).
   */
  tile?: boolean;
  /** Animation frames (the first is `canvas`) and their rate. */
  frames?: HTMLCanvasElement[];
  fps?: number;
  /** Repeating flash: visible only for `dur` s every `every` s, peaking at `alpha` (far lightning, a beacon). Hidden under reduce motion. */
  flash?: { every: number; dur: number; alpha: number; offset?: number };
  /** Slow alpha shimmer: [Hz, lowest alpha factor] (aurora). */
  pulse?: [number, number];
  /** On the biome's arrival: rise from dy px below over dur s and/or fade in, after delay s. */
  enter?: { dy?: number; dur: number; delay?: number; fade?: boolean };
  /** Drawn in front of the playfield at the Backdrop's frontDepth. Keep these to the screen edges. */
  front?: boolean;
  /** Texture px per screen px relative to k, for soft art baked at low resolution (nebulae). Default 1. */
  res?: number;
  /** Deep Cosmos: shown only while this nebula palette is current (cross-fades on change). */
  palette?: number;
}

export function cloud(c: Ctx, x: number, y: number, r: number, fill: string): void {
  c.fillStyle = fill; c.beginPath();
  circ(c, x - r * 0.95, y, r * 0.62); circ(c, x - r * 0.25, y - r * 0.42, r * 0.82); circ(c, x + r * 0.55, y - r * 0.2, r * 0.7); circ(c, x + r * 1.15, y + r * 0.05, r * 0.5);
  c.rect(x - r * 0.95, y, r * 2.1, r * 0.55); c.fill();
}

export function hillPath(c: Ctx, W: number, top: number, bottom: number, amp: number, len: number, ph: number): void {
  c.beginPath(); c.moveTo(-10, bottom); c.lineTo(-10, top + amp);
  for (let x = -10; x <= W + 10; x += 6) c.lineTo(x, top + amp - amp * (0.5 + 0.5 * Math.sin(x / len + ph)));
  c.lineTo(W + 10, bottom); c.closePath();
}

function tree(c: Ctx, x: number, y: number, r: number, fill: string): void {
  c.fillStyle = '#8A6A4A'; c.fillRect(x - r * 0.12, y - r * 0.6, r * 0.24, r * 0.9);
  c.fillStyle = fill; c.beginPath(); circ(c, x, y - r * 1.05, r * 0.7); circ(c, x - r * 0.45, y - r * 0.75, r * 0.45); circ(c, x + r * 0.45, y - r * 0.75, r * 0.45); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); circ(c, x - r * 0.25, y - r * 1.3, r * 0.28); c.fill();
}

function farmhouse(c: Ctx, x: number, y: number, r: number): void {
  // Barn with a tower for the sails (the sails are a separate spinning part).
  c.fillStyle = '#E9DCC8'; c.fillRect(x - r * 0.18, y - r * 1.25, r * 0.36, r * 1.25);
  c.fillStyle = '#C9634F'; c.beginPath(); c.moveTo(x - r * 0.26, y - r * 1.2); c.lineTo(x, y - r * 1.5); c.lineTo(x + r * 0.26, y - r * 1.2); c.closePath(); c.fill();
  c.fillStyle = '#D9735B'; c.fillRect(x - r * 0.95, y - r * 0.55, r * 0.8, r * 0.55);
  c.fillStyle = '#B8543F'; c.beginPath(); c.moveTo(x - r * 1.05, y - r * 0.55); c.lineTo(x - r * 0.55, y - r * 0.9); c.lineTo(x - r * 0.05, y - r * 0.55); c.closePath(); c.fill();
  c.fillStyle = '#FFF4E0'; c.fillRect(x - r * 0.68, y - r * 0.38, r * 0.26, r * 0.38);
  c.strokeStyle = '#D9735B'; c.lineWidth = Math.max(1, r * 0.04); c.beginPath(); c.moveTo(x - r * 0.68, y - r * 0.38); c.lineTo(x - r * 0.42, y); c.moveTo(x - r * 0.42, y - r * 0.38); c.lineTo(x - r * 0.68, y); c.stroke();
}

function sails(c: Ctx, cx: number, cy: number, r: number): void {
  c.save(); c.translate(cx, cy);
  for (let i = 0; i < 4; i++) {
    c.rotate(TAU / 4);
    c.fillStyle = '#FFFFFF'; c.fillRect(-r * 0.07, r * 0.08, r * 0.14, r * 0.85);
    c.fillStyle = 'rgba(160,140,130,0.5)'; c.fillRect(-r * 0.01, r * 0.08, r * 0.02, r * 0.85);
  }
  c.fillStyle = '#8A6A4A'; c.beginPath(); circ(c, 0, 0, r * 0.09); c.fill();
  c.restore();
}

function cow(c: Ctx, x: number, y: number, r: number): void {
  c.save(); c.translate(x, y);
  c.fillStyle = '#FFFFFF'; c.strokeStyle = '#3A2E40'; c.lineWidth = Math.max(1, r * 0.06);
  for (const lx of [-0.7, -0.3, 0.3, 0.6]) { c.fillStyle = '#3A2E40'; c.fillRect(lx * r, -r * 0.1, r * 0.14, r * 0.45); }
  c.fillStyle = '#FFFFFF'; rr(c, -r, -r * 0.9, r * 1.8, r * 0.9, r * 0.35); c.fill(); c.stroke();
  c.fillStyle = '#3A2E40'; c.beginPath(); circ(c, -r * 0.4, -r * 0.55, r * 0.22); circ(c, r * 0.35, -r * 0.6, r * 0.18); c.fill();
  // Tail.
  c.strokeStyle = '#3A2E40'; c.beginPath(); c.moveTo(-r, -r * 0.7); c.quadraticCurveTo(-r * 1.3, -r * 0.5, -r * 1.2, -r * 0.15); c.stroke();
  // Head, turned toward the tower (the view's centre) with big watching eyes.
  c.fillStyle = '#FFFFFF'; rr(c, r * 0.62, -r * 1.3, r * 0.66, r * 0.6, r * 0.22); c.fill(); c.strokeStyle = '#3A2E40'; c.stroke();
  c.fillStyle = '#FFB3C1'; rr(c, r * 0.86, -r * 0.98, r * 0.44, r * 0.28, r * 0.12); c.fill();
  c.fillStyle = '#3A2E40'; c.beginPath(); circ(c, r * 1.0, -r * 0.86, r * 0.04); circ(c, r * 1.16, -r * 0.86, r * 0.04); c.fill();
  c.fillStyle = '#FFFFFF'; c.beginPath(); circ(c, r * 0.85, -r * 1.14, r * 0.11); circ(c, r * 1.08, -r * 1.14, r * 0.11); c.fill(); c.stroke();
  c.fillStyle = '#3A2E40'; c.beginPath(); circ(c, r * 0.89, -r * 1.17, r * 0.055); circ(c, r * 1.12, -r * 1.17, r * 0.055); c.fill();
  c.fillStyle = '#E8DCC0'; c.beginPath(); c.ellipse(r * 0.66, -r * 1.3, r * 0.08, r * 0.14, -0.6, 0, TAU); c.ellipse(r * 1.24, -r * 1.3, r * 0.08, r * 0.14, 0.6, 0, TAU); c.fill();
  c.restore();
}

function fence(c: Ctx, x0: number, x1: number, y: number, h: number): void {
  c.fillStyle = '#FFF4E4';
  c.fillRect(x0, y - h * 0.72, x1 - x0, h * 0.12); c.fillRect(x0, y - h * 0.38, x1 - x0, h * 0.12);
  for (let x = x0; x <= x1; x += h * 0.42) {
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h * 0.85); c.lineTo(x + h * 0.09, y - h); c.lineTo(x + h * 0.18, y - h * 0.85); c.lineTo(x + h * 0.18, y); c.closePath(); c.fill();
  }
}

/**
 * Bake every Meadow part for a W×H view. `k` is texture px per screen px (device pixel ratio,
 * capped at 2). Returned canvases are k times larger than their screen size; draw them at scale 1/k.
 */
export function bakeMeadow(W: number, H: number, k: number): BackdropPart[] {
  const s = W / 12, parts: BackdropPart[] = [];
  const bake = (w: number, h: number, draw: (c: Ctx) => void): HTMLCanvasElement => {
    const cv = makeCanvas(w * k, h * k), c = ctx2d(cv); c.scale(k, k); draw(c); return cv;
  };
  const below = H * 0.75; // how far each hill layer reaches under its top edge, so nothing shows through

  // L1 sun glow.
  const sr = W * 0.28;
  parts.push({ key: 'meadow_sun', z: 1, factor: 0.03, x: W * 0.2, y: -H * 0.62, originX: 0.5, originY: 0.5, canvas: bake(sr * 2, sr * 2, c => {
    const g = c.createRadialGradient(sr, sr, 0, sr, sr, sr);
    g.addColorStop(0, 'rgba(255,250,215,1)'); g.addColorStop(0.18, 'rgba(255,244,190,0.85)'); g.addColorStop(0.45, 'rgba(255,240,170,0.3)'); g.addColorStop(1, 'rgba(255,240,170,0)');
    c.fillStyle = g; c.fillRect(0, 0, sr * 2, sr * 2);
  }) });

  // L2/L3 clouds, drifting right at different speeds.
  [[0.15, 0.56, 1.5, 5], [0.62, 0.47, 1.2, 8], [0.4, 0.36, 1.0, 11]].forEach(([fx, fy, sc, sp], i) => {
    const r = s * 0.62 * sc, cw = r * 3.2, ch = r * 2;
    parts.push({ key: `meadow_cloud${i}`, z: 2, factor: 0.08 + i * 0.03, x: W * fx, y: -H * fy, originX: 0.5, originY: 0.5, drift: sp * (W / 390), canvas: bake(cw, ch, c => cloud(c, cw * 0.45, ch * 0.62, r, 'rgba(255,255,255,0.94)')) });
  });

  // L2 far hills with the farmhouse; the sails spin on their own part.
  const farTop = -H * 0.075, farAmp = H * 0.05;
  const mill = { x: W * 0.13, r: s * 0.9 };
  parts.push({ key: 'meadow_far', z: 3, factor: 0.12, x: 0, y: farTop - s * 1.6, canvas: bake(W, below + s * 1.6, c => {
    c.translate(0, s * 1.6);
    hillPath(c, W, 0, below, farAmp, W * 0.16, 0.7); c.fillStyle = '#A9DDB2'; c.fill();
    const hy = farAmp - farAmp * (0.5 + 0.5 * Math.sin(mill.x / (W * 0.16) + 0.7));
    farmhouse(c, mill.x, hy + s * 0.12, mill.r);
    c.fillStyle = 'rgba(255,255,255,0.12)'; hillPath(c, W, farAmp * 0.6, below, farAmp * 0.4, W * 0.09, 2.1); c.fill();
  }) });
  {
    const hy = farAmp - farAmp * (0.5 + 0.5 * Math.sin(mill.x / (W * 0.16) + 0.7));
    const sz = mill.r * 2;
    parts.push({ key: 'meadow_sails', z: 4, factor: 0.12, x: mill.x, y: farTop + hy + s * 0.12 - mill.r * 1.25, originX: 0.5, originY: 0.5, spin: 0.8, canvas: bake(sz, sz, c => sails(c, sz / 2, sz / 2, mill.r)) });
  }

  // L3 near hills: trees and a picket fence near the screen edges, the cow on the right.
  const nearTop = -H * 0.035, nearAmp = H * 0.032;
  parts.push({ key: 'meadow_near', z: 5, factor: 0.35, x: 0, y: nearTop - s * 1.4, canvas: bake(W, below + s * 1.4, c => {
    c.translate(0, s * 1.4);
    hillPath(c, W, 0, below, nearAmp, W * 0.11, 2.2); c.fillStyle = '#86CF84'; c.fill();
    const hillY = (x: number) => nearAmp - nearAmp * (0.5 + 0.5 * Math.sin(x / (W * 0.11) + 2.2));
    for (const fx of [0.05, 0.21]) tree(c, W * fx, hillY(W * fx) + s * 0.2, s * 0.62, fx > 0.1 ? '#58B062' : '#4FA85A');
    tree(c, W * 0.97, hillY(W * 0.97) + s * 0.1, s * 0.55, '#4FA85A');
    fence(c, W * 0.77, W * 1.01, hillY(W * 0.88) + s * 0.3, s * 0.42);
    c.fillStyle = 'rgba(255,255,255,0.12)'; hillPath(c, W, nearAmp * 0.8, below, nearAmp * 0.3, W * 0.07, 0.4); c.fill();
  }) });
  {
    const cx = W * 0.865, cr = s * 0.5, hy = nearAmp - nearAmp * (0.5 + 0.5 * Math.sin(cx / (W * 0.11) + 2.2));
    const cw = cr * 3.2, ch = cr * 2.2;
    parts.push({ key: 'meadow_cow', z: 6, factor: 0.35, x: cx, y: nearTop + hy + s * 0.18 - ch * 0.72, originX: 0.5, originY: 0, bob: 0.6, canvas: bake(cw, ch, c => cow(c, cw * 0.45, ch * 0.72, cr)) });
  }

  // L5 ground: grass lip, dirt, flowers. Locked to the world (factor 1); its top is the ground line.
  const gh = H * 0.8;
  parts.push({ key: 'meadow_ground', z: 7, factor: 1, x: 0, y: -s * 0.2, canvas: bake(W, gh, c => {
    const g0 = s * 0.2;
    const dirt = c.createLinearGradient(0, g0, 0, gh); dirt.addColorStop(0, '#B98252'); dirt.addColorStop(1, '#8E5E36');
    c.fillStyle = dirt; c.fillRect(0, g0 + s * 0.3, W, gh);
    c.fillStyle = 'rgba(70,40,20,0.18)';
    for (let i = 0; i < 40; i++) { c.beginPath(); c.ellipse(hash(i * 3.7) * W, g0 + s * 0.7 + hash(i * 1.9) * (gh - s), s * (0.06 + hash(i) * 0.08), s * 0.04, 0, 0, TAU); c.fill(); }
    c.fillStyle = '#6CC25A'; c.beginPath(); c.moveTo(0, g0 + s * 0.45);
    for (let x = 0; x <= W; x += 8) c.lineTo(x, g0 - Math.abs(Math.sin(x * 0.21)) * s * 0.12);
    c.lineTo(W, g0 + s * 0.45);
    for (let x = W; x >= 0; x -= 10) c.lineTo(x, g0 + s * 0.38 + Math.sin(x * 0.4) * s * 0.05);
    c.closePath(); c.fill();
    c.fillStyle = '#5AAE4A'; c.fillRect(0, g0 + s * 0.3, W, s * 0.1);
    for (let i = 0; i < 22; i++) {
      const fx = hash(i * 3.3) * W, fy = g0 + hash(i * 5.1) * s * 0.22;
      c.fillStyle = ['#FF7AA8', '#FFE58F', '#FFFFFF', '#B9A3FF'][i % 4];
      c.beginPath(); for (let p = 0; p < 5; p++) circ(c, fx + Math.cos(p * 1.257) * s * 0.05, fy + Math.sin(p * 1.257) * s * 0.05, s * 0.04); c.fill();
      c.fillStyle = '#FFCC33'; c.beginPath(); circ(c, fx, fy, s * 0.03); c.fill();
    }
  }) });

  return parts;
}
