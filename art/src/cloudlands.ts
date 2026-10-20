// The Cloudlands backdrop (art-direction.md §6.1, §6.5): a faint rainbow behind a cloud castle on
// the far cloud bank, a passing plane with a contrail, a blimp, drifting puffs, and mid and near
// cloud banks that sink away as the tower climbs. Flat, outline-free, and soft blue-lilac shading
// so white pieces and the ghost still read against it (§6.6).
//
// Also the arrival moment's "punch-through" cloud layer, which the Backdrop plays on entry.

import { type BackdropPart, cloud } from './meadow.ts';
import { type Ctx, TAU, circ, ctx2d, hash, makeCanvas, rr } from './util.ts';

/** A long cloud bank: a row of puffs along the top edge over a solid body, with a shaded underside. */
function bank(c: Ctx, W: number, h: number, r: number, fill: string, shade: string, seed: number, keepClear = 0): void {
  c.fillStyle = shade; c.fillRect(0, r, W, h);
  c.beginPath();
  for (let x = -r; x < W + r; x += r * 1.05) {
    const cx = x + hash(seed + x) * r * 0.5;
    const mid = keepClear ? 1 - keepClear * Math.max(0, 1 - Math.abs(cx / W - 0.5) / 0.3) : 1;
    circ(c, cx, r * 1.05 + (1 - mid) * r * 0.8, r * (0.7 + 0.5 * hash(seed * 5 + x)) * mid);
  }
  c.fill();
  c.fillStyle = fill; c.beginPath();
  for (let x = -r; x < W + r; x += r * 1.05) {
    const cx = x + hash(seed + x) * r * 0.5;
    const mid = keepClear ? 1 - keepClear * Math.max(0, 1 - Math.abs(cx / W - 0.5) / 0.3) : 1;
    circ(c, cx - r * 0.08, r * 0.98 + (1 - mid) * r * 0.8, r * (0.7 + 0.5 * hash(seed * 5 + x)) * mid * 0.9);
  }
  c.fill();
  // The body fades from the puffs' white into the shaded underside, with no hard edge.
  const g = c.createLinearGradient(0, r * 1.2, 0, r * 1.2 + h * 0.3);
  g.addColorStop(0, fill); g.addColorStop(1, shade);
  c.fillStyle = g; c.fillRect(0, r * 1.2, W, h * 0.3);
}

function castle(c: Ctx, x: number, base: number, u: number): void {
  const wall = '#DCE5F6', dark = '#C9D5EC';
  const tower = (tx: number, w: number, h: number, roof: number) => {
    c.fillStyle = wall; c.fillRect(tx - w / 2, base - h, w, h);
    c.fillStyle = dark; c.beginPath(); c.moveTo(tx - w * 0.62, base - h); c.lineTo(tx, base - h - roof); c.lineTo(tx + w * 0.62, base - h); c.closePath(); c.fill();
    c.fillStyle = dark; rr(c, tx - w * 0.12, base - h * 0.62, w * 0.24, w * 0.36, w * 0.12); c.fill();
    // Pennant.
    c.strokeStyle = dark; c.lineWidth = Math.max(1, u * 0.05); c.beginPath(); c.moveTo(tx, base - h - roof); c.lineTo(tx, base - h - roof - u * 0.5); c.stroke();
    c.fillStyle = '#E8C9D8'; c.beginPath(); c.moveTo(tx, base - h - roof - u * 0.5); c.lineTo(tx + u * 0.35, base - h - roof - u * 0.4); c.lineTo(tx, base - h - roof - u * 0.3); c.closePath(); c.fill();
  };
  c.fillStyle = wall; c.fillRect(x - u * 2.2, base - u * 1.3, u * 4.4, u * 1.3);
  for (let i = 0; i < 9; i++) c.fillRect(x - u * 2.2 + i * u * 0.5, base - u * 1.5, u * 0.3, u * 0.25);
  tower(x - u * 2.1, u * 0.9, u * 2.2, u * 0.9);
  tower(x + u * 2.1, u * 0.9, u * 2.0, u * 0.85);
  tower(x - u * 0.7, u * 0.8, u * 2.9, u * 0.8);
  tower(x + u * 0.6, u * 1.1, u * 3.6, u * 1.1);
  c.fillStyle = '#C9D5EC'; rr(c, x - u * 0.35, base - u * 0.85, u * 0.7, u * 0.85, u * 0.35); c.fill();
}

function rainbow(c: Ctx, cx: number, cy: number, r: number, band: number): void {
  const cols = ['#F4A7A7', '#F5C99E', '#F2E6A0', '#B9E2B2', '#A9CDEE', '#C3B3E8'];
  c.lineWidth = band; c.lineCap = 'butt';
  cols.forEach((col, i) => { c.strokeStyle = col; c.beginPath(); c.arc(cx, cy, r - i * band, Math.PI * 1.08, Math.PI * 1.92); c.stroke(); });
}

function blimp(c: Ctx, x: number, y: number, u: number): void {
  c.save(); c.translate(x, y);
  // Fins, body, stripe, gondola.
  c.fillStyle = '#B6C3DC';
  c.beginPath(); c.moveTo(-u * 1.05, -u * 0.05); c.lineTo(-u * 1.5, -u * 0.55); c.lineTo(-u * 1.3, -u * 0.05); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(-u * 1.05, u * 0.05); c.lineTo(-u * 1.5, u * 0.55); c.lineTo(-u * 1.3, u * 0.05); c.closePath(); c.fill();
  c.fillStyle = '#D5DEEE'; c.beginPath(); c.ellipse(0, 0, u * 1.35, u * 0.5, 0, 0, TAU); c.fill();
  c.save(); c.beginPath(); c.ellipse(0, 0, u * 1.35, u * 0.5, 0, 0, TAU); c.clip();
  c.fillStyle = '#E7A9A0'; c.fillRect(-u * 0.25, -u, u * 0.3, u * 2);
  c.fillStyle = 'rgba(255,255,255,0.4)'; c.beginPath(); c.ellipse(-u * 0.2, -u * 0.22, u * 0.9, u * 0.12, 0, 0, TAU); c.fill();
  c.restore();
  c.fillStyle = '#9AA8C4'; rr(c, -u * 0.32, u * 0.45, u * 0.6, u * 0.2, u * 0.08); c.fill();
  c.restore();
}

function plane(c: Ctx, x: number, y: number, u: number): void {
  // Contrail behind (to the left), then a small white plane flying right.
  const g = c.createLinearGradient(x - u * 5, 0, x - u * 0.4, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.75)');
  c.fillStyle = g; rr(c, x - u * 5, y - u * 0.05, u * 4.6, u * 0.1, u * 0.05); c.fill();
  c.fillStyle = '#F7F9FF';
  c.beginPath(); c.ellipse(x, y, u * 0.5, u * 0.09, 0, 0, TAU); c.fill();
  c.beginPath(); c.moveTo(x - u * 0.05, y); c.lineTo(x - u * 0.25, y + u * 0.32); c.lineTo(x + u * 0.05, y + u * 0.32); c.lineTo(x + u * 0.15, y); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(x - u * 0.38, y); c.lineTo(x - u * 0.52, y - u * 0.22); c.lineTo(x - u * 0.38, y - u * 0.22); c.lineTo(x - u * 0.28, y); c.closePath(); c.fill();
  c.fillStyle = '#AFC0DC'; c.beginPath(); circ(c, x + u * 0.28, y - u * 0.01, u * 0.035); circ(c, x + u * 0.16, y - u * 0.01, u * 0.035); c.fill();
}

/** Bake every Cloudlands part for a W×H view at k texture px per screen px. */
export function bakeCloudlands(W: number, H: number, k: number): BackdropPart[] {
  const s = W / 12, parts: BackdropPart[] = [];
  const bake = (w: number, h: number, draw: (c: Ctx) => void): HTMLCanvasElement => {
    const cv = makeCanvas(w * k, h * k), c = ctx2d(cv); c.scale(k, k); draw(c); return cv;
  };
  const scale = W / 390;

  // L1 rainbow, very faint, behind the castle.
  const rr0 = W * 0.42, rb = s * 0.16, rw = rr0 * 2 + 8, rh = rr0 + 8;
  parts.push({ key: 'cl_rainbow', anchor: 'entry', z: 1, factor: 0.04, x: W * 0.74, y: H * 0.72, originX: 0.5, originY: 1, canvas: bake(rw, rh, c => { c.globalAlpha = 0.42; rainbow(c, rw / 2, rh - 2, rr0, rb); }) });

  // L2 far bank with the cloud castle on it.
  const fh = H * 0.5, fr = s * 0.9;
  parts.push({ key: 'cl_bank_far', anchor: 'entry', z: 3, factor: 0.08, x: 0, y: H * 0.68 - s * 4.8, canvas: bake(W, fh + s * 4.8, c => {
    c.translate(0, s * 4.8);
    castle(c, W * 0.8, fr * 1.2, s * 0.62);
    bank(c, W, fh, fr, '#F5F8FF', '#DEE6F5', 1.7);
  }) });

  // A plane crossing high up, and a slow blimp.
  {
    const w = s * 6, h = s * 0.9;
    parts.push({ key: 'cl_plane', anchor: 'entry', z: 4, factor: 0.1, wrapY: H * 1.8, x: W * 0.3, y: H * 0.12, originX: 0.5, originY: 0.5, drift: 30 * scale, canvas: bake(w, h, c => plane(c, w - s * 0.8, h / 2, s)) });
  }
  {
    const u = s * 0.9, w = u * 3.2, h = u * 1.6;
    parts.push({ key: 'cl_blimp', anchor: 'entry', z: 5, factor: 0.18, wrapY: H * 1.9, x: W * 0.78, y: H * 0.3, originX: 0.5, originY: 0.5, drift: -7 * scale, bob: 4 * scale, canvas: bake(w, h, c => blimp(c, w * 0.55, h * 0.45, u)) });
  }

  // L3 drifting puffs at the sides.
  [[0.08, 0.2, 1.3, 4], [0.92, 0.42, 1.1, 6], [0.15, 0.6, 1.5, 5]].forEach(([fx, fy, sc, sp], i) => {
    const r = s * 0.62 * sc, cw = r * 3.2, ch = r * 2;
    parts.push({ key: `cl_puff${i}`, anchor: 'entry', z: 6, factor: 0.3 + i * 0.04, wrapY: H * 1.7, x: W * fx, y: H * fy, originX: 0.5, originY: 0.5, drift: sp * scale, canvas: bake(cw, ch, c => {
      cloud(c, cw * 0.45, ch * 0.66, r, '#E6EDF9'); cloud(c, cw * 0.43, ch * 0.6, r * 0.96, 'rgba(255,255,255,0.97)');
    }) });
  });

  // L3 mid bank, quieter in the middle.
  const mh = H * 0.55, mr = s * 1.1;
  parts.push({ key: 'cl_bank_mid', anchor: 'entry', z: 7, factor: 0.3, x: 0, y: H * 0.82, canvas: bake(W, mh, c => bank(c, W, mh, mr, '#FFFFFF', '#E1E8F6', 4.2, 0.45)) });

  // L4 near banks in the bottom corners, falling away fastest.
  const nh = H * 0.55, nr = s * 1.6;
  parts.push({ key: 'cl_bank_near', anchor: 'entry', z: 8, factor: 0.62, x: 0, y: H * 0.9, canvas: bake(W, nh, c => {
    for (const [cx, sc] of [[W * 0.04, 1], [W * 0.98, 1.15]] as [number, number][]) {
      const r = nr * sc;
      c.fillStyle = '#DCE4F4'; c.beginPath(); circ(c, cx, r * 0.95, r); circ(c, cx - r * 0.9, r * 1.2, r * 0.75); circ(c, cx + r * 0.9, r * 1.25, r * 0.7); c.rect(cx - r * 1.6, r * 1.2, r * 3.2, nh); c.fill();
      c.fillStyle = '#FFFFFF'; c.beginPath(); circ(c, cx - r * 0.06, r * 0.88, r * 0.9); circ(c, cx - r * 0.95, r * 1.14, r * 0.66); circ(c, cx + r * 0.84, r * 1.18, r * 0.6); c.fill();
    }
  }) });

  return parts;
}

/**
 * The punch-through layer for the Cloudlands arrival: heavy cloud at both edges and thin wisps
 * across the middle, so the tower stays readable while the screen edges white out. One screen
 * wide and 0.6 screens tall; the Backdrop sweeps it down past the camera.
 */
export function bakePunchThrough(W: number, H: number, k: number): HTMLCanvasElement {
  const s = W / 12, h = H * 0.6, cv = makeCanvas(W * k, h * k), c = ctx2d(cv);
  c.scale(k, k);
  for (const side of [0, 1]) {
    const x0 = side ? W : 0, dir = side ? -1 : 1;
    for (let i = 0; i < 7; i++) {
      const y = (i + 0.5) / 7 * h, r = s * (1.6 + hash(i * 3 + side) * 1.2);
      c.fillStyle = i % 2 ? '#F4F7FF' : '#FFFFFF';
      c.beginPath(); circ(c, x0 + dir * (s * 0.6 + hash(i + side * 9) * s * 1.4), y, r); c.fill();
    }
  }
  c.globalAlpha = 0.5;
  for (let i = 0; i < 5; i++) { const y = hash(i * 7.7) * h, x = W * (0.25 + hash(i * 2.1) * 0.5); c.fillStyle = '#FFFFFF'; c.beginPath(); c.ellipse(x, y, s * (1.2 + hash(i) * 1.5), s * 0.22, 0, 0, TAU); c.fill(); }
  return cv;
}
