// The Storm Belt and Stratosphere backdrops (art-direction.md §6.1, §6.5).
// Storm Belt: slate thunderheads with soft far lightning (20% alpha, one flash every 4.5 s at
// most), a storm-chaser weather station on the mid bank, a windsock on the near cloud, and rain
// streaks at the screen edges only. Stratosphere: dusk above the storm, Earth's curve below with the
// storm tops falling away, a low sun, aurora ribbons that unfurl on arrival, high wisps and a weather
// balloon. Flat and outline-free (§6.6); the play column stays quiet.
//
// Also the two arrival effects' textures: the Storm Belt's rumble glow and the Stratosphere's sun flare.

import { type BackdropPart, cloud } from './meadow.ts';
import { type Ctx, TAU, circ, ctx2d, hash, makeCanvas, rr } from './util.ts';

type Bake = (w: number, h: number, draw: (c: Ctx) => void) => HTMLCanvasElement;
const baker = (k: number): Bake => (w, h, draw) => { const cv = makeCanvas(w * k, h * k), c = ctx2d(cv); c.scale(k, k); draw(c); return cv; };

/**
 * A cumulonimbus: a billowing tower, pinched a little in the middle and leaning downwind (right),
 * under a flat-topped anvil that streams out to the right. Lit along its upper left.
 */
function thunderhead(c: Ctx, x: number, base: number, w: number, h: number, body: string, lit: string, seed: number): void {
  const p = new Path2D(), n = 24;
  for (let i = 0; i < n; i++) {
    // Lumps scattered up the tower: broad at the base and under the anvil, a little narrower between.
    const t = (i + hash(seed + i * 1.7) * 0.6) / n, half = w * (0.34 - 0.07 * Math.sin(t * Math.PI));
    const cx = x + (hash(seed + i * 3.3) - 0.5) * half * 1.1 + t * w * 0.08, cy = base - t * h * 0.74;
    const r = half * (0.55 + 0.3 * hash(seed * 3 + i * 2.1));
    p.moveTo(cx + r, cy); p.arc(cx, cy, r, 0, TAU);
  }
  // The anvil: flat on top, sloping underneath, its downwind end thinning out.
  const ay = base - h * 0.86, aw = w * 0.9, ax = x + w * 0.08;
  p.moveTo(ax - aw * 0.4, ay + h * 0.06);
  p.quadraticCurveTo(ax - aw * 0.52, ay - h * 0.02, ax - aw * 0.32, ay - h * 0.07);
  p.lineTo(ax + aw * 0.72, ay - h * 0.1);
  p.quadraticCurveTo(ax + aw * 0.86, ay - h * 0.095, ax + aw * 0.74, ay - h * 0.06);
  p.quadraticCurveTo(ax + aw * 0.3, ay + h * 0.0, ax + w * 0.02, ay + h * 0.13);
  p.closePath();
  c.fillStyle = lit; c.fill(p);
  c.save(); c.clip(p); c.translate(w * 0.045, h * 0.03); c.fillStyle = body; c.fill(p); c.restore();
}

/** A long lumpy bank (like Cloudlands', in storm colors), quieter in the middle when keepClear > 0. */
function stormBank(c: Ctx, W: number, h: number, r: number, body: string, lit: string, seed: number, keepClear = 0): void {
  const p = new Path2D();
  for (let x = -r; x < W + r; x += r * 1.1) {
    const cx = x + hash(seed + x) * r * 0.5, mid = keepClear ? 1 - keepClear * Math.max(0, 1 - Math.abs(cx / W - 0.5) / 0.3) : 1;
    const rr0 = r * (0.7 + 0.5 * hash(seed * 5 + x)) * mid, cy = r * 1.05 + (1 - mid) * r * 0.8;
    p.moveTo(cx + rr0, cy); p.arc(cx, cy, rr0, 0, TAU);
  }
  p.rect(-r, r * 1.1, W + r * 2, h);
  c.fillStyle = lit; c.fill(p);
  c.save(); c.clip(p); c.translate(r * 0.08, r * 0.12); c.fillStyle = body; c.fill(p); c.restore();
}

/** A jagged bolt from (x, y) downward, with a fork. */
function bolt(c: Ctx, x: number, y: number, len: number, seed: number): void {
  c.strokeStyle = '#FFFFFF'; c.lineJoin = 'round'; c.lineCap = 'round';
  const pts: [number, number][] = [[x, y]];
  for (let i = 1; i <= 7; i++) pts.push([x + (hash(seed + i) - 0.5) * len * 0.22, y + (i / 7) * len]);
  c.lineWidth = len * 0.022; c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.stroke();
  const [fx, fy] = pts[3];
  c.lineWidth = len * 0.014; c.beginPath(); c.moveTo(fx, fy); c.lineTo(fx + len * 0.12, fy + len * 0.14); c.lineTo(fx + len * 0.1, fy + len * 0.28); c.stroke();
}

/** The storm-chaser station: a mast with a rooster weathervane and anemometer cups. `on` lights the beacon. */
function station(c: Ctx, x: number, base: number, u: number, on: boolean): void {
  const ink = '#2E3850';
  c.fillStyle = ink;
  rr(c, x - u * 0.55, base - u * 0.7, u * 1.1, u * 0.7, u * 0.1); c.fill();
  c.fillRect(x - u * 0.05, base - u * 2.6, u * 0.1, u * 1.95);
  // Lattice braces.
  c.strokeStyle = ink; c.lineWidth = u * 0.04;
  for (let i = 0; i < 4; i++) { const y0 = base - u * 0.7 - i * u * 0.45; c.beginPath(); c.moveTo(x - u * 0.2, y0); c.lineTo(x + u * 0.2, y0 - u * 0.45); c.moveTo(x + u * 0.2, y0); c.lineTo(x - u * 0.2, y0 - u * 0.45); c.stroke(); }
  // Rooster on top, facing the wind.
  const ty = base - u * 2.65;
  c.beginPath(); c.moveTo(x - u * 0.35, ty); c.quadraticCurveTo(x - u * 0.35, ty - u * 0.35, x, ty - u * 0.32); c.lineTo(x + u * 0.12, ty - u * 0.55); c.lineTo(x + u * 0.22, ty - u * 0.42);
  c.lineTo(x + u * 0.36, ty - u * 0.4); c.lineTo(x + u * 0.24, ty - u * 0.3); c.quadraticCurveTo(x + u * 0.28, ty, x, ty); c.closePath(); c.fill();
  c.fillRect(x - u * 0.45, ty + u * 0.06, u * 0.9, u * 0.04);
  // Anemometer: three cups on a cross arm.
  const ay = base - u * 1.8;
  c.fillRect(x, ay, u * 0.5, u * 0.05);
  c.beginPath(); for (const dx of [0.32, 0.5, 0.68]) { circ(c, x + u * dx, ay - u * 0.08 + (dx === 0.5 ? -u * 0.1 : 0), u * 0.07); } c.fill();
  c.fillStyle = on ? '#FF6B6B' : '#5C3A48'; c.beginPath(); circ(c, x, base - u * 2.15, u * 0.08); c.fill();
  if (on) {
    const g = c.createRadialGradient(x, base - u * 2.15, 0, x, base - u * 2.15, u * 0.4);
    g.addColorStop(0, 'rgba(255,120,120,0.6)'); g.addColorStop(1, 'rgba(255,120,120,0)');
    c.fillStyle = g; c.beginPath(); circ(c, x, base - u * 2.15, u * 0.4); c.fill();
  }
}

/** A windsock pointing right from its ring at (0, 0), drooping a little. */
function windsock(c: Ctx, len: number): void {
  const segs = 5, h0 = len * 0.32, h1 = len * 0.16;
  for (let i = segs - 1; i >= 0; i--) {
    const a = i / segs, b = (i + 1) / segs, ha = h0 + (h1 - h0) * a, hb = h0 + (h1 - h0) * b, da = a * a * len * 0.12, db = b * b * len * 0.12;
    c.fillStyle = i % 2 ? '#E2DCD3' : '#C98A5A';
    c.beginPath(); c.moveTo(a * len, da - ha / 2); c.lineTo(b * len, db - hb / 2); c.lineTo(b * len, db + hb / 2); c.lineTo(a * len, da + ha / 2); c.closePath(); c.fill();
  }
  c.fillStyle = '#4A5470'; c.fillRect(-len * 0.03, -h0 * 0.55, len * 0.05, h0 * 1.1);
}

/** Bake every Storm Belt part for a W×H view at k texture px per screen px. */
export function bakeStorm(W: number, H: number, k: number): BackdropPart[] {
  const s = W / 12, parts: BackdropPart[] = [], bake = baker(k), scale = W / 390;

  // L1/L2 far thunderheads with soft lightning glowing over them.
  const fh = H * 0.9;
  parts.push({ key: 'sb_far', anchor: 'entry', z: 2, factor: 0.06, x: 0, y: H * 0.05, canvas: bake(W, fh, c => {
    thunderhead(c, W * 0.1, fh * 0.66, W * 0.46, fh * 0.42, '#53628A', '#6F7EA3', 1);
    thunderhead(c, W * 0.62, fh * 0.64, W * 0.5, fh * 0.56, '#55658C', '#7180A6', 2);
    thunderhead(c, W * 1.02, fh * 0.68, W * 0.4, fh * 0.34, '#52618A', '#6D7CA2', 3);
    c.save(); c.translate(0, fh * 0.6 - s * 1.1); stormBank(c, W, fh, s * 1.0, '#56668B', '#6878A0', 8.3); c.restore();
  }) });
  for (const [i, fx, fy, off] of [[0, 0.22, 0.32, 0], [1, 0.7, 0.24, 4.5]] as [number, number, number, number][]) {
    const w = W * 0.55, h = H * 0.5;
    parts.push({ key: `sb_flash${i}`, anchor: 'entry', z: 3, factor: 0.06, x: W * fx, y: H * fy, originX: 0.5, originY: 0, flash: { every: 9, dur: 0.5, alpha: 0.2, offset: off }, canvas: bake(w, h, c => {
      const g = c.createRadialGradient(w / 2, h * 0.25, 0, w / 2, h * 0.25, w * 0.5);
      g.addColorStop(0, 'rgba(235,240,255,1)'); g.addColorStop(0.5, 'rgba(220,228,255,0.45)'); g.addColorStop(1, 'rgba(220,228,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, w, h);
      bolt(c, w * 0.5, h * 0.3, h * 0.6, i * 11 + 3);
    }) });
  }

  // L3 mid bank with the weather station, and drifting dark puffs.
  const mh = H * 0.5, mr = s * 1.05;
  parts.push({ key: 'sb_bank_mid', anchor: 'entry', z: 5, factor: 0.3, x: 0, y: H * 0.8, canvas: bake(W, mh, c => stormBank(c, W, mh, mr, '#46557A', '#5E6D92', 5.1, 0.45)) });
  {
    const u = s * 0.6, w = u * 1.4, h = u * 3.4, base = h - u * 0.05;
    const frame = (on: boolean) => bake(w, h, c => station(c, w / 2, base, u, on));
    parts.push({ key: 'sb_station', anchor: 'entry', z: 4, factor: 0.3, x: W * 0.86, y: H * 0.8 + mr * 0.5, originX: 0.5, originY: 1, fps: 1.4, frames: [frame(false), frame(false), frame(true)], canvas: frame(false) });
  }
  [[0.1, 0.24, 1.2, 5], [0.9, 0.46, 1.0, -4], [0.18, 0.6, 1.4, 6]].forEach(([fx, fy, sc, sp], i) => {
    const r = s * 0.62 * sc, cw = r * 3.2, ch = r * 2;
    parts.push({ key: `sb_puff${i}`, anchor: 'entry', z: 6, factor: 0.32 + i * 0.04, wrapY: H * 1.7, x: W * fx, y: H * fy, originX: 0.5, originY: 0.5, drift: sp * scale, canvas: bake(cw, ch, c => {
      cloud(c, cw * 0.45, ch * 0.66, r, '#4A5878'); cloud(c, cw * 0.43, ch * 0.6, r * 0.96, '#5A6889');
    }) });
  });

  // L4 near storm clouds in the bottom corners, with a windsock on a pole from the left one.
  const nh = H * 0.55, nr = s * 1.6;
  parts.push({ key: 'sb_bank_near', anchor: 'entry', z: 8, factor: 0.62, x: 0, y: H * 0.9, canvas: bake(W, nh, c => {
    for (const [cx, sc] of [[W * 0.03, 1.05], [W * 0.99, 1.15]] as [number, number][]) {
      const r = nr * sc, p = new Path2D();
      for (const [dx, dy, rr1] of [[0, 0.95, 1], [-0.9, 1.2, 0.75], [0.9, 1.25, 0.7]]) { p.moveTo(cx + dx * r + rr1 * r, dy * r); p.arc(cx + dx * r, dy * r, rr1 * r, 0, TAU); }
      p.rect(cx - r * 1.6, r * 1.2, r * 3.2, nh);
      c.fillStyle = '#4C5A78'; c.fill(p);
      c.save(); c.clip(p); c.translate(r * 0.07, r * 0.1); c.fillStyle = '#39465F'; c.fill(p); c.restore();
    }
  }) });
  {
    const px = W * 0.11, base = H * 0.9 + nr * 0.25, ph = s * 2.3;
    parts.push({ key: 'sb_pole', anchor: 'entry', z: 7, factor: 0.62, x: px, y: base, originX: 0.5, originY: 1, canvas: bake(s * 0.3, ph, c => {
      c.fillStyle = '#3A4560'; c.fillRect(s * 0.1, 0, s * 0.1, ph); c.beginPath(); circ(c, s * 0.15, s * 0.06, s * 0.07); c.fill();
    }) });
    const len = s * 1.5, w = len * 1.1, h = len * 0.6;
    parts.push({ key: 'sb_windsock', anchor: 'entry', z: 7.5, factor: 0.62, x: px, y: base - ph + s * 0.2, originX: 0.04, originY: 0.4, sway: 0.12, canvas: bake(w, h, c => { c.translate(w * 0.04, h * 0.4); windsock(c, len); }) });
  }

  // L6 rain at the screen edges only, falling fast; tiles repeat every screen height.
  for (const side of [0, 1]) {
    const w = W * 0.16, h = H * 2;
    parts.push({ key: `sb_rain${side}`, anchor: 'entry', z: 10, factor: 1.3, x: side ? W - w : 0, y: 0, wrapY: H, tile: true, fall: 560 * scale, canvas: bake(w, h, c => {
      const g = c.createLinearGradient(side ? w : 0, 0, side ? 0 : w, 0);
      g.addColorStop(0, 'rgba(205,218,242,0.42)'); g.addColorStop(1, 'rgba(205,218,242,0)');
      c.strokeStyle = g; c.lineCap = 'round';
      for (let i = 0; i < 46; i++) {
        const x = hash(i * 3.7 + side) * w, y = hash(i * 9.1 + side) * H, len = s * (0.35 + 0.35 * hash(i * 1.3));
        c.lineWidth = 1 + hash(i * 5.5);
        for (const dy of [0, H]) { c.beginPath(); c.moveTo(x, y + dy); c.lineTo(x - len * 0.18, y + dy + len); c.stroke(); }
      }
    }) });
  }
  return parts;
}

/** The Storm Belt arrival's rumble: a wide soft glow that rolls across the far clouds. Origin: centre. */
export function bakeRumble(W: number, H: number, k: number): HTMLCanvasElement {
  const w = W * 0.9, h = H * 0.32;
  return baker(k)(w, h, c => {
    c.save(); c.translate(w / 2, h / 2); c.scale(1, h / w);
    const g = c.createRadialGradient(0, 0, 0, 0, 0, w / 2);
    g.addColorStop(0, 'rgba(225,232,255,1)'); g.addColorStop(0.4, 'rgba(210,220,255,0.5)'); g.addColorStop(1, 'rgba(210,220,255,0)');
    c.fillStyle = g; c.beginPath(); circ(c, 0, 0, w / 2); c.fill(); c.restore();
  });
}

/** An aurora curtain: vertical rays along a wave, bright at the hem and fading upward. */
function aurora(c: Ctx, W: number, h: number, hem: string, top: string, seed: number): void {
  // Columns 2 px wide that just touch (overlaps would stripe), brighter in soft rays.
  const base = c.globalAlpha;
  for (let x = 0; x < W; x += 2) {
    const y = h * 0.62 + Math.sin(x / W * TAU * 1.3 + seed) * h * 0.16 + Math.sin(x / W * TAU * 3.1 + seed * 2) * h * 0.05;
    const len = Math.min(y * 0.97, h * (0.35 + 0.25 * (0.5 + 0.5 * Math.sin(x / W * TAU * 2.2 + seed * 3))));
    const g = c.createLinearGradient(0, y - len, 0, y);
    g.addColorStop(0, top); g.addColorStop(0.75, hem); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.globalAlpha = base * (0.6 + 0.4 * (0.5 + 0.5 * Math.sin(x * 0.19 + seed)) * (0.5 + 0.5 * Math.sin(x * 0.071 + seed * 2)));
    c.fillStyle = g; c.fillRect(x, y - len, 2, len);
  }
  c.globalAlpha = base;
}

/** Bake every Stratosphere part. */
export function bakeStratosphere(W: number, H: number, k: number): BackdropPart[] {
  const s = W / 12, parts: BackdropPart[] = [], bake = baker(k), scale = W / 390;

  // L1 the low sun and its glow, sitting on the horizon to the right.
  const sr = W * 0.62;
  parts.push({ key: 'st_sun', anchor: 'entry', z: 1, factor: 0.03, x: W * 0.8, y: H * 0.84, originX: 0.5, originY: 0.5, canvas: bake(sr * 2, sr * 2, c => {
    const g = c.createRadialGradient(sr, sr, 0, sr, sr, sr);
    g.addColorStop(0, 'rgba(255,236,200,1)'); g.addColorStop(0.07, 'rgba(255,226,180,0.95)'); g.addColorStop(0.12, 'rgba(255,200,150,0.45)'); g.addColorStop(0.45, 'rgba(255,170,130,0.16)'); g.addColorStop(1, 'rgba(255,170,130,0)');
    c.fillStyle = g; c.fillRect(0, 0, sr * 2, sr * 2);
  }) });

  // L1 aurora ribbons, unfurling after the flare.
  const ah = H * 0.32;
  parts.push({ key: 'st_aurora0', anchor: 'entry', z: 2, factor: 0.04, x: 0, y: H * 0.02, pulse: [0.18, 0.6], enter: { fade: true, dur: 2.6, delay: 1 }, canvas: bake(W, ah, c => { c.globalAlpha = 0.55; aurora(c, W, ah, 'rgba(124,240,200,0.9)', 'rgba(124,240,200,0)', 1.2); }) });
  parts.push({ key: 'st_aurora1', anchor: 'entry', z: 2.1, factor: 0.045, x: 0, y: H * 0.16, pulse: [0.13, 0.5], enter: { fade: true, dur: 3, delay: 1.6 }, canvas: bake(W, ah, c => { c.globalAlpha = 0.4; aurora(c, W, ah, 'rgba(232,150,230,0.85)', 'rgba(232,150,230,0)', 4.1); }) });

  // L2 Earth's curve with its glowing limb, and the storm tops below it.
  const eh = H * 0.42, R = W * 2.4;
  parts.push({ key: 'st_earth', anchor: 'entry', z: 3, factor: 0.08, x: 0, y: H * 0.74, canvas: bake(W, eh, c => {
    const cx = W * 0.45, cy = s * 1.2 + R;
    const glow = c.createRadialGradient(cx, cy, R - s * 0.2, cx, cy, R + s * 1.4);
    glow.addColorStop(0, 'rgba(255,190,140,0.75)'); glow.addColorStop(0.3, 'rgba(255,170,140,0.35)'); glow.addColorStop(1, 'rgba(255,160,140,0)');
    c.fillStyle = glow; c.fillRect(0, 0, W, eh);
    const g = c.createLinearGradient(0, s * 1.2, 0, eh);
    g.addColorStop(0, '#4B3F86'); g.addColorStop(1, '#2A2560');
    c.fillStyle = g; c.beginPath(); circ(c, cx, cy, R); c.fill();
    c.strokeStyle = 'rgba(255,214,180,0.9)'; c.lineWidth = 1.6; c.beginPath(); c.arc(cx, cy, R, Math.PI * 1.3, Math.PI * 1.7); c.stroke();
  }) });
  const th = H * 0.4, tr = s * 1.2;
  parts.push({ key: 'st_stormtops', anchor: 'entry', z: 4, factor: 0.22, x: 0, y: H * 0.86, canvas: bake(W, th, c => stormBank(c, W, th, tr, '#4A4479', '#6A5F96', 8.3, 0.5)) });

  // L3 high wisps, and a weather balloon rising slowly through the view.
  [[0.15, 0.3, 1], [0.82, 0.5, 0.8], [0.3, 0.66, 0.9]].forEach(([fx, fy, sc], i) => {
    const w = s * 4.5 * sc, h = s * 0.7;
    parts.push({ key: `st_wisp${i}`, anchor: 'entry', z: 5, factor: 0.18 + i * 0.05, wrapY: H * 1.8, x: W * fx, y: H * fy, originX: 0.5, originY: 0.5, drift: (4 + i * 2) * scale, canvas: bake(w, h, c => {
      c.fillStyle = 'rgba(255,214,220,0.32)';
      for (let j = 0; j < 4; j++) { c.beginPath(); c.ellipse(w * (0.3 + j * 0.13), h * (0.4 + 0.12 * Math.sin(j * 2)), w * (0.28 - j * 0.04), h * 0.13, 0, 0, TAU); c.fill(); }
    }) });
  });
  {
    const u = s * 0.7, w = u * 1.6, h = u * 3.6;
    parts.push({ key: 'st_balloon', anchor: 'entry', z: 6, factor: 0.25, wrapY: H * 2, x: W * 0.84, y: H * 0.35, originX: 0.5, originY: 0, drift: 3 * scale, fall: -9 * scale, bob: 3 * scale, canvas: bake(w, h, c => {
      const bx = w / 2, by = u * 0.75;
      c.fillStyle = '#EDE3F0'; c.beginPath(); c.ellipse(bx, by, u * 0.62, u * 0.72, 0, 0, TAU); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.55)'; c.beginPath(); c.ellipse(bx - u * 0.2, by - u * 0.28, u * 0.16, u * 0.24, -0.4, 0, TAU); c.fill();
      c.fillStyle = '#D9CCE2'; c.beginPath(); c.moveTo(bx - u * 0.08, by + u * 0.7); c.lineTo(bx + u * 0.08, by + u * 0.7); c.lineTo(bx, by + u * 0.85); c.closePath(); c.fill();
      c.strokeStyle = '#B9A9C8'; c.lineWidth = 1; c.beginPath(); c.moveTo(bx, by + u * 0.85); c.lineTo(bx, h - u * 0.55); c.stroke();
      c.fillStyle = '#E8A87C'; c.beginPath(); c.arc(bx, h - u * 1.3, u * 0.3, Math.PI, 0); c.fill();
      c.fillStyle = '#D9895E'; rr(c, bx - u * 0.17, h - u * 0.55, u * 0.34, u * 0.28, u * 0.04); c.fill();
    }) });
  }
  return parts;
}

/**
 * The Stratosphere arrival's sun flare: a long horizontal streak with a few soft ghost discs along
 * the diagonal, drawn for additive blending. Origin: centre.
 */
export function bakeFlare(W: number, H: number, k: number): HTMLCanvasElement {
  const w = W * 1.4, h = H * 0.5;
  return baker(k)(w, h, c => {
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,200,150,0)'); g.addColorStop(0.5, 'rgba(255,230,200,0.9)'); g.addColorStop(1, 'rgba(255,200,150,0)');
    c.fillStyle = g; c.fillRect(0, h / 2 - 2, w, 4);
    const core = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, h * 0.3);
    core.addColorStop(0, 'rgba(255,240,215,0.9)'); core.addColorStop(1, 'rgba(255,220,180,0)');
    c.fillStyle = core; c.beginPath(); circ(c, w / 2, h / 2, h * 0.3); c.fill();
    const ghosts: [number, number, string][] = [[-0.16, 0.05, 'rgba(255,190,170,0.35)'], [-0.27, 0.035, 'rgba(200,180,255,0.3)'], [0.12, 0.025, 'rgba(255,230,160,0.35)'], [0.22, 0.06, 'rgba(170,220,255,0.22)']];
    for (const [d, r, col] of ghosts) { c.fillStyle = col; c.beginPath(); circ(c, w / 2 + d * w, h / 2 - d * h * 1.4, r * w); c.fill(); }
  });
}
