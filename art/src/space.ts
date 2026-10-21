// The space biomes (art-direction.md §6.1, §6.5): Orbit, Moon, Red Planet and Ringed Giant share
// the star field and differ by a set piece, a tint and two or three props each.
// Orbit: Earth's glowing limb below, a space station, blinking satellites.
// Moon: Earthrise far off, and the Moon itself rising into frame with a planted flag and a waving astronaut.
// Red Planet: dust haze, a small lumpy moon, far mesas, layered red ground with a canyon, a rover and dust devils.
// Ringed Giant: a banded giant whose ring crosses behind the tower, ring dust at the screen edges in
// front, and drifting ice chunks. Flat and outline-free (§6.6), with the play column kept quiet.
//
// Also textures for the arrivals: the Red Planet's dust devil and the Ringed Giant's ring arc.

import type { BackdropPart } from './meadow.ts';
import { type Ctx, TAU, circ, ctx2d, hash, makeCanvas, rr } from './util.ts';

type Bake = (w: number, h: number, draw: (c: Ctx) => void) => HTMLCanvasElement;
const baker = (k: number): Bake => (w, h, draw) => { const cv = makeCanvas(w * k, h * k), c = ctx2d(cv); c.scale(k, k); draw(c); return cv; };

/** Earth as a disc of radius r: ocean, lumpy continents, cloud streaks along the latitudes and a polar cap. */
function earth(c: Ctx, cx: number, cy: number, r: number, seed: number): void {
  const g = c.createRadialGradient(cx - r * 0.3, cy - r * 0.3, 0, cx, cy, r);
  g.addColorStop(0, '#4A92D2'); g.addColorStop(1, '#1D4B8C');
  c.save(); c.beginPath(); circ(c, cx, cy, r); c.clip();
  c.fillStyle = g; c.fillRect(cx - r, cy - r, r * 2, r * 2);
  for (let i = 0; i < 4; i++) {
    const a = hash(seed + i) * TAU, d = r * (0.15 + 0.6 * hash(seed * 2 + i)), lx = cx + Math.cos(a) * d, ly = cy + Math.sin(a) * d;
    c.fillStyle = i === 2 ? '#B39B6A' : '#6E9A5E'; c.beginPath();
    for (let j = 0; j < 3; j++) circ(c, lx + (hash(seed + i * 9 + j) - 0.5) * r * 0.35, ly + (hash(seed + i * 7 + j) - 0.5) * r * 0.25, r * (0.12 + 0.12 * hash(seed + i * 5 + j)));
    c.fill();
  }
  c.fillStyle = 'rgba(255,255,255,0.6)';
  for (let i = 0; i < 6; i++) {
    const y = cy + (hash(seed * 5 + i) - 0.5) * r * 1.6, x = cx + (hash(seed * 7 + i) - 0.5) * r;
    c.beginPath(); c.ellipse(x, y, r * (0.25 + 0.2 * hash(seed * 3 + i)), r * 0.055, (hash(seed * 11 + i) - 0.5) * 0.3, 0, TAU); c.fill();
  }
  c.fillStyle = 'rgba(255,255,255,0.75)'; c.beginPath(); c.ellipse(cx, cy - r * 0.97, r * 0.45, r * 0.13, 0, 0, TAU); c.fill();
  c.restore();
}

/**
 * Earth's limb seen from orbit: only the top of a disc of radius R centred at (cx, cy) shows, so the
 * continents and cloud streaks are sized to the screen (s px per block) and foreshortened along the curve.
 */
function earthLimb(c: Ctx, W: number, cx: number, cy: number, R: number, s: number, seed: number): void {
  c.save(); c.beginPath(); circ(c, cx, cy, R); c.clip();
  const g = c.createRadialGradient(cx, cy, R - s * 6, cx, cy, R);
  g.addColorStop(0, '#1A447F'); g.addColorStop(0.8, '#2F6FB4'); g.addColorStop(1, '#4A92D2');
  c.fillStyle = g; c.fillRect(cx - R, cy - R, R * 2, R * 2);
  const at = (x: number, depth: number): [number, number, number] => {
    const a = -Math.PI / 2 + Math.asin(Math.max(-1, Math.min(1, (x - cx) / R)));
    return [cx + Math.cos(a) * (R - depth), cy + Math.sin(a) * (R - depth), a + Math.PI / 2];
  };
  // Continents: lumpy, squashed toward the limb.
  for (let i = 0; i < 5; i++) {
    const [x, y, rot] = at(-W * 0.1 + hash(seed + i * 3.1) * W * 1.2, s * (0.8 + 4.5 * hash(seed + i * 5.3)));
    c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, 0.45);
    c.fillStyle = i % 3 === 2 ? '#B39B6A' : '#6E9A5E';
    c.beginPath();
    for (let j = 0; j < 5; j++) circ(c, (hash(seed + i * 10 + j) - 0.5) * s * 3, (hash(seed + i * 20 + j) - 0.5) * s * 1.6, s * (0.6 + 0.7 * hash(seed + i * 30 + j)));
    c.fill(); c.restore();
  }
  // Cloud streaks along the curve.
  c.fillStyle = 'rgba(255,255,255,0.6)';
  for (let i = 0; i < 14; i++) {
    const [x, y, rot] = at(-W * 0.1 + hash(seed + i * 7.7) * W * 1.2, s * (0.3 + 6 * hash(seed + i * 9.1)));
    c.beginPath(); c.ellipse(x, y, s * (0.8 + 1.8 * hash(seed + i * 2.2)), s * (0.08 + 0.1 * hash(seed + i * 4.4)), rot + (hash(seed + i) - 0.5) * 0.2, 0, TAU); c.fill();
  }
  c.restore();
}

function solarWing(c: Ctx, x: number, y: number, w: number, h: number): void {
  c.fillStyle = '#3D4E8E'; c.fillRect(x, y, w, h);
  c.strokeStyle = '#6476B5'; c.lineWidth = Math.max(0.6, h * 0.06);
  c.beginPath();
  for (let i = 1; i < 6; i++) { c.moveTo(x + (w * i) / 6, y); c.lineTo(x + (w * i) / 6, y + h); }
  c.moveTo(x, y + h / 2); c.lineTo(x + w, y + h / 2); c.stroke();
}

function spaceStation(c: Ctx, x: number, y: number, u: number): void {
  c.fillStyle = '#A9B1C6'; c.fillRect(x - u * 2.6, y - u * 0.06, u * 5.2, u * 0.12);
  for (const sx of [-2.4, -1.5, 1.0, 1.9]) { solarWing(c, x + u * sx, y - u * 0.95, u * 0.5, u * 0.85); solarWing(c, x + u * sx, y + u * 0.1, u * 0.5, u * 0.85); }
  c.fillStyle = '#D6DBE6'; rr(c, x - u * 0.7, y - u * 0.22, u * 1.4, u * 0.44, u * 0.2); c.fill();
  c.fillStyle = '#C3C9D8'; rr(c, x - u * 0.16, y - u * 0.75, u * 0.32, u * 1.5, u * 0.15); c.fill();
  c.fillStyle = '#B4BBCD'; c.fillRect(x - u * 0.65, y - u * 0.04, u * 1.3, u * 0.08);
  c.fillStyle = '#EEF1F6'; c.fillRect(x + u * 0.3, y - u * 0.55, u * 0.5, u * 0.18);
}

function satellite(c: Ctx, x: number, y: number, u: number, light: boolean, color: string): void {
  solarWing(c, x - u * 1.25, y - u * 0.2, u * 0.85, u * 0.4);
  solarWing(c, x + u * 0.4, y - u * 0.2, u * 0.85, u * 0.4);
  c.fillStyle = '#C9A45A'; rr(c, x - u * 0.4, y - u * 0.32, u * 0.8, u * 0.64, u * 0.08); c.fill();
  c.fillStyle = '#E2C27A'; c.fillRect(x - u * 0.4, y - u * 0.32, u * 0.8, u * 0.14);
  c.fillStyle = '#D5D9E4'; c.beginPath(); c.ellipse(x, y - u * 0.5, u * 0.26, u * 0.1, 0, 0, TAU); c.fill();
  c.fillStyle = light ? color : '#3A3550'; c.beginPath(); circ(c, x + u * 0.3, y + u * 0.2, u * 0.08); c.fill();
  if (light) {
    const g = c.createRadialGradient(x + u * 0.3, y + u * 0.2, 0, x + u * 0.3, y + u * 0.2, u * 0.4);
    g.addColorStop(0, color.replace('rgb', 'rgba').replace(')', ',0.6)')); g.addColorStop(1, color.replace('rgb', 'rgba').replace(')', ',0)'));
    c.fillStyle = g; c.beginPath(); circ(c, x + u * 0.3, y + u * 0.2, u * 0.4); c.fill();
  }
}

/** Bake every Orbit part. */
export function bakeOrbit(W: number, H: number, k: number): BackdropPart[] {
  const s = W / 12, parts: BackdropPart[] = [], bake = baker(k), scale = W / 390;

  // L2 Earth's limb across the bottom, tilted, with its blue atmosphere.
  const eh = H * 0.5, R = W * 1.5;
  parts.push({ key: 'or_earth', anchor: 'entry', z: 2, factor: 0.06, x: 0, y: H * 0.68, canvas: bake(W, eh, c => {
    const cx = W * 0.2, cy = s * 1.6 + R;
    const glow = c.createRadialGradient(cx, cy, R, cx, cy, R + s * 1.3);
    glow.addColorStop(0, 'rgba(130,200,255,0.65)'); glow.addColorStop(0.35, 'rgba(110,180,255,0.25)'); glow.addColorStop(1, 'rgba(110,180,255,0)');
    c.fillStyle = glow; c.fillRect(0, 0, W, eh);
    earthLimb(c, W, cx, cy, R, s, 3.3);
    c.strokeStyle = 'rgba(190,235,255,0.95)'; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, R - 1, Math.PI * 1.25, Math.PI * 1.85); c.stroke();
  }) });

  // L3 the station drifting high on the right; satellites blinking at the sides.
  {
    const u = s * 0.62, w = u * 5.6, h = u * 2.2;
    parts.push({ key: 'or_station', anchor: 'entry', z: 4, factor: 0.12, wrapY: H * 2.2, x: W * 0.74, y: H * 0.2, originX: 0.5, originY: 0.5, drift: 2 * scale, canvas: bake(w, h, c => spaceStation(c, w / 2, h / 2, u)) });
  }
  [[0.12, 0.42, 0.5, 4, 'rgb(255,120,120)'], [0.9, 0.62, 0.42, -3, 'rgb(120,255,170)']].forEach(([fx, fy, sc, sp, col], i) => {
    const u = s * (sc as number), w = u * 3, h = u * 1.3;
    const frame = (on: boolean) => bake(w, h, c => satellite(c, w / 2, h / 2, u, on, col as string));
    const off = frame(false);
    parts.push({ key: `or_sat${i}`, anchor: 'entry', z: 5 + i * 0.1, factor: 0.2 + i * 0.05, wrapY: H * 1.9, x: W * (fx as number), y: H * (fy as number), originX: 0.5, originY: 0.5, drift: (sp as number) * scale, fps: 1.6, frames: [off, frame(true)], canvas: off });
  });
  return parts;
}

/** An astronaut standing at (x, base), waving with arm angle `arm` (radians up from the side). */
function astronaut(c: Ctx, x: number, base: number, u: number, arm: number): void {
  const suit = '#E9ECF3', shade = '#C4C9D6';
  c.fillStyle = shade; rr(c, x - u * 0.34, base - u * 1.25, u * 0.3, u * 0.62, u * 0.08); c.fill();            // backpack
  c.fillStyle = suit;
  rr(c, x - u * 0.2, base - u * 0.48, u * 0.16, u * 0.48, u * 0.06); c.fill();                                 // legs
  rr(c, x + u * 0.04, base - u * 0.48, u * 0.16, u * 0.48, u * 0.06); c.fill();
  rr(c, x - u * 0.24, base - u * 1.15, u * 0.48, u * 0.75, u * 0.16); c.fill();                                 // body
  c.beginPath(); circ(c, x, base - u * 1.32, u * 0.27); c.fill();                                               // helmet
  c.fillStyle = '#D9A64A'; c.beginPath(); c.ellipse(x + u * 0.06, base - u * 1.32, u * 0.17, u * 0.13, 0, 0, TAU); c.fill();
  c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse(x + u * 0.0, base - u * 1.37, u * 0.05, u * 0.03, -0.5, 0, TAU); c.fill();
  c.fillStyle = suit; rr(c, x - u * 0.38, base - u * 1.05, u * 0.14, u * 0.45, u * 0.06); c.fill();              // left arm down
  c.save(); c.translate(x + u * 0.2, base - u * 1.02); c.rotate(-Math.PI / 2 - arm + Math.PI / 2);
  c.rotate(Math.PI - arm); rr(c, -u * 0.07, 0, u * 0.14, u * 0.45, u * 0.06); c.fill();                       // waving arm
  c.fillStyle = shade; c.beginPath(); circ(c, 0, u * 0.48, u * 0.08); c.fill();
  c.restore();
  c.fillStyle = '#A9AEC0'; c.fillRect(x - u * 0.12, base - u * 0.9, u * 0.24, u * 0.12);
}

/** A planted flag: the Shape Tower banner, gold with a white star. Origin is the foot of the pole. */
function moonFlag(c: Ctx, x: number, base: number, u: number, wave: number): void {
  c.fillStyle = '#B9BDCB'; c.fillRect(x - u * 0.03, base - u * 1.6, u * 0.06, u * 1.6);
  const fw = u * 0.9, fh = u * 0.56, top = base - u * 1.55;
  c.fillStyle = '#E8B84A'; c.beginPath(); c.moveTo(x, top);
  for (let i = 0; i <= 8; i++) { const t = i / 8; c.lineTo(x + t * fw, top + Math.sin(t * Math.PI * 1.5 + wave) * u * 0.05 * t); }
  for (let i = 8; i >= 0; i--) { const t = i / 8; c.lineTo(x + t * fw, top + fh + Math.sin(t * Math.PI * 1.5 + wave) * u * 0.05 * t); }
  c.closePath(); c.fill();
  c.fillStyle = '#FFF7E8';
  const sx = x + fw * 0.45, sy = top + fh / 2 + Math.sin(0.45 * Math.PI * 1.5 + wave) * u * 0.02, sr = fh * 0.3;
  c.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? sr * 0.45 : sr; if (i) c.lineTo(sx + Math.cos(a) * d, sy + Math.sin(a) * d); else c.moveTo(sx + Math.cos(a) * d, sy + Math.sin(a) * d); }
  c.closePath(); c.fill();
}

/** Bake every Moon part. The Moon, the flag and the astronaut rise into frame together on arrival. */
export function bakeMoon(W: number, H: number, k: number): BackdropPart[] {
  const s = W / 12, parts: BackdropPart[] = [], bake = baker(k);
  const rise = { dy: H * 0.5, dur: 2.6 };

  // L1 Earthrise far off: a small half-lit Earth.
  const er = s * 0.75, ew = er * 3;
  parts.push({ key: 'mo_earth', anchor: 'entry', z: 1, factor: 0.02, x: W * 0.22, y: H * 0.18, originX: 0.5, originY: 0.5, canvas: bake(ew, ew, c => {
    const m = ew / 2, g = c.createRadialGradient(m, m, er, m, m, er * 1.45);
    g.addColorStop(0, 'rgba(120,190,255,0.45)'); g.addColorStop(1, 'rgba(120,190,255,0)');
    c.fillStyle = g; c.beginPath(); circ(c, m, m, er * 1.45); c.fill();
    earth(c, m, m, er, 7.7);
    c.save(); c.beginPath(); circ(c, m, m, er); c.clip();
    const sh = c.createLinearGradient(m - er * 0.1, 0, m + er * 0.6, 0);
    sh.addColorStop(0, 'rgba(7,8,26,0)'); sh.addColorStop(1, 'rgba(7,8,26,0.85)');
    c.fillStyle = sh; c.fillRect(m - er, m - er, er * 2, er * 2); c.restore();
  }) });

  // L2 the Moon's crest across the bottom of the screen, with craters.
  const mh = H * 0.5, R = W * 1.25, top = H * 0.7;
  const crest = (x: number) => s * 1.2 + R - Math.sqrt(R * R - (x - W * 0.5) ** 2);
  parts.push({ key: 'mo_moon', anchor: 'entry', z: 3, factor: 0.1, x: 0, y: top, enter: rise, canvas: bake(W, mh, c => {
    const cx = W * 0.5, cy = s * 1.2 + R;
    const g = c.createLinearGradient(0, s * 1.2, 0, mh);
    g.addColorStop(0, '#C9CCD8'); g.addColorStop(1, '#8C90A2');
    c.save(); c.beginPath(); circ(c, cx, cy, R); c.clip();
    c.fillStyle = g; c.fillRect(0, 0, W, mh);
    for (let i = 0; i < 16; i++) {
      const x = hash(i * 3.1) * W, y = crest(x) + s * (0.3 + hash(i * 5.3) * 5), r = s * (0.18 + 0.5 * hash(i * 7.7)) * (0.5 + y / mh);
      c.fillStyle = 'rgba(120,124,142,0.45)'; c.beginPath(); c.ellipse(x, y, r, r * 0.38, 0, 0, TAU); c.fill();
      c.fillStyle = 'rgba(232,234,242,0.55)'; c.beginPath(); c.ellipse(x, y + r * 0.1, r, r * 0.38, 0, 0.15, Math.PI - 0.15); c.ellipse(x, y + r * 0.05, r * 0.9, r * 0.3, 0, Math.PI - 0.15, 0.15, true); c.fill();
    }
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, cy, R - 0.5, Math.PI * 1.32, Math.PI * 1.68); c.stroke();
  }) });

  // The flag (left) and the astronaut (right) stand on the crest, outside the play column.
  {
    const u = s * 0.8, fx = W * 0.1, w = u * 1.3, h = u * 1.9;
    const frame = (n: number) => bake(w, h, c => moonFlag(c, u * 0.1, h - 1, u, n * 1.2));
    const f0 = frame(0);
    parts.push({ key: 'mo_flag', anchor: 'entry', z: 4, factor: 0.1, x: fx, y: top + crest(fx) + 2, originX: 0.08, originY: 1, enter: rise, fps: 3, frames: [f0, frame(1), frame(2)], canvas: f0 });
  }
  {
    const u = s * 0.85, ax = W * 0.87, w = u * 1.4, h = u * 1.9;
    const frame = (arm: number) => bake(w, h, c => astronaut(c, w / 2, h - 1, u, arm));
    const f0 = frame(2.3);
    parts.push({ key: 'mo_astro', anchor: 'entry', z: 4.1, factor: 0.1, x: ax, y: top + crest(ax) + 2, originX: 0.5, originY: 1, enter: rise, fps: 2.5, frames: [f0, frame(2.9)], canvas: f0 });
  }
  return parts;
}

/** A dust devil, frame f of 3, about `u` wide at the top. Origin: bottom centre. */
export function bakeDustDevil(f: number, u: number, k: number): HTMLCanvasElement {
  const w = u * 1.4, h = u * 2.6, N = 20;
  return baker(k)(w, h, c => {
    // A leaning funnel, densest at the ground, with swirl bands that climb one step per frame.
    const half = (t: number) => u * (0.08 + 0.5 * t ** 1.3), y = (t: number) => h - u * 0.12 - t * (h - u * 0.3);
    const mid = (t: number) => w / 2 + Math.sin(t * 3 + f * 0.8) * u * 0.06 + (t - 0.5) * u * 0.1;
    const p = new Path2D();
    p.moveTo(mid(0) - half(0), y(0));
    for (let i = 1; i <= N; i++) p.lineTo(mid(i / N) - half(i / N), y(i / N));
    p.quadraticCurveTo(mid(1), y(1) - u * 0.14, mid(1) + half(1), y(1));
    for (let i = N; i >= 0; i--) p.lineTo(mid(i / N) + half(i / N), y(i / N));
    p.closePath();
    const g = c.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0, 'rgba(214,140,104,0.6)'); g.addColorStop(1, 'rgba(214,140,104,0.1)');
    c.fillStyle = g; c.fill(p);
    c.save(); c.clip(p);
    c.strokeStyle = 'rgba(248,196,166,0.4)'; c.lineWidth = u * 0.05; c.lineCap = 'round';
    for (let j = 0; j < 6; j++) {
      const t = (j + f / 3) / 6;
      c.beginPath(); c.ellipse(mid(t), y(t), half(t) * 0.95, u * 0.07, -0.2, Math.PI * 0.15, Math.PI * 0.85); c.stroke();
    }
    c.restore();
    const sk = c.createRadialGradient(0, 0, 0, 0, 0, u * 0.45);
    sk.addColorStop(0, 'rgba(214,140,104,0.45)'); sk.addColorStop(1, 'rgba(214,140,104,0)');
    c.save(); c.translate(mid(0), h - u * 0.12); c.scale(1, 0.25); c.fillStyle = sk; c.beginPath(); circ(c, 0, 0, u * 0.45); c.fill(); c.restore();
  });
}

function rover(c: Ctx, x: number, base: number, u: number): void {
  c.fillStyle = '#3A2A2E';
  for (const dx of [-0.55, 0, 0.55]) { c.beginPath(); circ(c, x + dx * u, base - u * 0.14, u * 0.14); c.fill(); }
  c.fillStyle = '#7A6A62'; c.fillRect(x - u * 0.65, base - u * 0.32, u * 1.3, u * 0.08);
  c.fillStyle = '#D8C7B0'; rr(c, x - u * 0.5, base - u * 0.62, u * 1.0, u * 0.32, u * 0.06); c.fill();
  c.fillStyle = '#3F4A7A'; c.fillRect(x - u * 0.6, base - u * 0.68, u * 1.2, u * 0.07);
  c.fillStyle = '#C9B8A0'; c.fillRect(x + u * 0.28, base - u * 1.05, u * 0.06, u * 0.4);
  c.fillStyle = '#E3D5C0'; rr(c, x + u * 0.2, base - u * 1.14, u * 0.24, u * 0.13, u * 0.03); c.fill();
}

/** Bake every Red Planet part. */
export function bakeRedPlanet(W: number, H: number, k: number): BackdropPart[] {
  const s = W / 12, parts: BackdropPart[] = [], bake = baker(k), scale = W / 390;

  // L1 dust haze over the horizon, and a small lumpy moon.
  parts.push({ key: 'rp_haze', anchor: 'entry', z: 1, factor: 0.02, x: 0, y: H * 0.35, canvas: bake(W, H * 0.6, c => {
    const g = c.createLinearGradient(0, 0, 0, H * 0.6);
    g.addColorStop(0, 'rgba(255,150,110,0)'); g.addColorStop(0.7, 'rgba(255,150,110,0.22)'); g.addColorStop(1, 'rgba(255,170,130,0.3)');
    c.fillStyle = g; c.fillRect(0, 0, W, H * 0.6);
  }) });
  {
    const r = s * 0.55, w = r * 2.6;
    parts.push({ key: 'rp_moon', anchor: 'entry', z: 1.5, factor: 0.025, x: W * 0.2, y: H * 0.16, originX: 0.5, originY: 0.5, canvas: bake(w, w, c => {
      const m = w / 2;
      c.fillStyle = '#8C7466'; c.beginPath(); c.ellipse(m, m, r * 1.2, r * 0.85, 0.4, 0, TAU); c.fill();
      c.fillStyle = 'rgba(60,40,40,0.35)'; c.beginPath(); c.ellipse(m + r * 0.3, m + r * 0.2, r * 0.9, r * 0.6, 0.4, 0, TAU); c.fill();
      c.fillStyle = 'rgba(70,50,46,0.5)'; c.beginPath(); circ(c, m - r * 0.4, m - r * 0.1, r * 0.2); circ(c, m + r * 0.2, m - r * 0.35, r * 0.12); c.fill();
    }) });
  }

  // L2 far mesas along the horizon.
  const fh = H * 0.45;
  parts.push({ key: 'rp_mesas', anchor: 'entry', z: 2, factor: 0.07, x: 0, y: H * 0.62, canvas: bake(W, fh, c => {
    const mesa = (x0: number, x1: number, top: number, col: string) => {
      c.fillStyle = col; c.beginPath(); c.moveTo(x0 - s * 0.8, fh); c.lineTo(x0, top); c.lineTo(x1, top); c.lineTo(x1 + s * 0.8, fh); c.closePath(); c.fill();
      // A sunlit cap and strata, and the shaded right slope.
      c.fillStyle = 'rgba(255,190,150,0.2)'; c.fillRect(x0, top, x1 - x0, s * 0.12);
      c.fillStyle = 'rgba(255,190,150,0.08)'; c.fillRect(x0 - s * 0.1, top + (fh - top) * 0.3, x1 - x0 + s * 0.2, s * 0.08);
      c.fillStyle = 'rgba(60,20,24,0.22)'; c.beginPath(); c.moveTo(x1 - s * 0.25, top); c.lineTo(x1, top); c.lineTo(x1 + s * 0.8, fh); c.lineTo(x1 + s * 0.2, fh); c.closePath(); c.fill();
    };
    mesa(-W * 0.05, W * 0.18, fh * 0.12, '#8A3E34'); mesa(W * 0.62, W * 0.95, fh * 0.2, '#8A3E34'); mesa(W * 0.3, W * 0.42, fh * 0.28, '#7E3A31');
    c.fillStyle = '#9A4A3A'; c.fillRect(0, fh * 0.42, W, fh);
  }) });

  // L3 layered red ground with a canyon on the left, a rover and two dust devils on it.
  const gh = H * 0.45, gy = H * 0.8;
  parts.push({ key: 'rp_ground', anchor: 'entry', z: 4, factor: 0.3, x: 0, y: gy, canvas: bake(W, gh, c => {
    const bands = ['#B85A40', '#A64E38', '#934332', '#82392C'];
    bands.forEach((col, i) => { c.fillStyle = col; c.fillRect(0, s * 0.3 + i * gh * 0.18, W, gh); });
    c.fillStyle = '#6E2C24';
    c.beginPath(); c.moveTo(W * 0.08, s * 0.3); c.lineTo(W * 0.2, s * 0.3); c.lineTo(W * 0.16, gh * 0.55); c.lineTo(W * 0.13, gh * 0.55); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,200,170,0.18)'; c.fillRect(0, s * 0.3, W, s * 0.08);
  }) });
  {
    const u = s * 0.75, w = u * 1.6, h = u * 1.3;
    parts.push({ key: 'rp_rover', anchor: 'entry', z: 5, factor: 0.3, x: W * 0.7, y: gy + s * 0.32, originX: 0.5, originY: 1, drift: 6 * scale, canvas: bake(w, h, c => rover(c, w / 2, h, u)) });
  }
  [[0.9, -7, 0.9], [0.32, 9, 0.7]].forEach(([fx, sp, sc], i) => {
    const u = s * sc, frames = [0, 1, 2].map(f => bakeDustDevil(f, u, k));
    parts.push({ key: `rp_devil${i}`, anchor: 'entry', z: 5.5, factor: 0.3, x: W * fx, y: gy + s * 0.34, originX: 0.5, originY: 1, drift: sp * scale, fps: 9, frames, canvas: frames[0] });
  });

  // L4 near rocks in the bottom corners.
  parts.push({ key: 'rp_rocks', anchor: 'entry', z: 7, factor: 0.62, x: 0, y: H * 0.9, canvas: bake(W, H * 0.5, c => {
    c.fillStyle = '#6E2C24';
    c.beginPath(); c.moveTo(0, s * 0.4); c.lineTo(W * 0.1, s * 0.1); c.lineTo(W * 0.16, s * 0.7); c.lineTo(W * 0.2, H * 0.5); c.lineTo(0, H * 0.5); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(W, s * 0.2); c.lineTo(W * 0.9, s * 0.5); c.lineTo(W * 0.84, s * 1.1); c.lineTo(W * 0.8, H * 0.5); c.lineTo(W, H * 0.5); c.closePath(); c.fill();
    c.fillStyle = '#84382D'; c.beginPath(); c.moveTo(W * 0.1, s * 0.1); c.lineTo(W * 0.16, s * 0.7); c.lineTo(W * 0.12, s * 0.75); c.closePath(); c.fill();
  }) });
  return parts;
}

/** The gas giant with its rings; the back half of the ring passes behind the planet. */
function giant(c: Ctx, cx: number, cy: number, r: number): void {
  const tilt = -0.21, rx = r * 2.1, ry = r * 0.42;
  // The ring as many fine bands: a bright inner ring, a dark gap, and a fainter outer ring.
  const ringBands: [number, string][] = [];
  for (let i = 0; i < 16; i++) {
    const f = 0.68 + i * 0.021, gap = f > 0.86 && f < 0.9;
    ringBands.push([f, gap ? 'rgba(40,30,70,0.15)' : `rgba(${i % 3 ? '232,213,174' : '246,232,204'},${(f < 0.86 ? 0.5 : 0.32) * (0.75 + 0.25 * hash(i * 3.7))})`]);
  }
  // Each band is a filled annulus; `back` draws the half behind the planet, else the half in front.
  const ring = (back: boolean) => {
    c.save(); c.translate(cx, cy); c.rotate(tilt);
    c.beginPath(); c.rect(-rx * 1.1, back ? -ry * 1.1 : 0, rx * 2.2, ry * 1.1); c.clip();
    for (const [f, col] of ringBands) {
      c.fillStyle = col; c.beginPath();
      c.ellipse(0, 0, rx * (f + 0.021), ry * (f + 0.021), 0, 0, TAU); c.ellipse(0, 0, rx * f, ry * f, 0, 0, TAU);
      c.fill('evenodd');
    }
    c.restore();
  };
  ring(true);
  c.save(); c.beginPath(); circ(c, cx, cy, r); c.clip();
  c.translate(cx, cy); c.rotate(tilt);
  const bands = ['#E6D3B0', '#C9A77A', '#D9BE8E', '#A97E55', '#E1C9A0', '#BC9465', '#D2B485'];
  bands.forEach((col, i) => { c.fillStyle = col; c.fillRect(-r * 1.2, -r + (i / bands.length) * r * 2, r * 2.4, (r * 2) / bands.length + 1); });
  c.fillStyle = 'rgba(190,120,90,0.6)'; c.beginPath(); c.ellipse(r * 0.3, r * 0.25, r * 0.16, r * 0.09, 0, 0, TAU); c.fill();
  c.rotate(-tilt); c.translate(-cx, -cy);
  const sh = c.createRadialGradient(cx + r * 0.35, cy - r * 0.35, r * 0.3, cx, cy, r * 1.05);
  sh.addColorStop(0, 'rgba(12,10,36,0)'); sh.addColorStop(1, 'rgba(12,10,36,0.6)');
  c.fillStyle = sh; c.fillRect(cx - r, cy - r, r * 2, r * 2);
  c.restore();
  ring(false);
}

function iceChunk(c: Ctx, x: number, y: number, r: number, seed: number): void {
  const n = 6, pts: [number, number][] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * TAU + hash(seed + i) * 0.4, d = r * (0.7 + 0.3 * hash(seed * 3 + i)); pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d]); }
  c.fillStyle = '#B7CEE2'; c.beginPath(); pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath(); c.fill();
  c.fillStyle = '#E3EFF8'; c.beginPath(); c.moveTo(x, y); c.lineTo(pts[3][0], pts[3][1]); c.lineTo(pts[4][0], pts[4][1]); c.lineTo(pts[5][0], pts[5][1]); c.closePath(); c.fill();
  c.fillStyle = '#93AFCB'; c.beginPath(); c.moveTo(x, y); c.lineTo(pts[0][0], pts[0][1]); c.lineTo(pts[1][0], pts[1][1]); c.closePath(); c.fill();
}

/** Bake every Ringed Giant part. */
export function bakeRinged(W: number, H: number, k: number): BackdropPart[] {
  const s = W / 12, parts: BackdropPart[] = [], bake = baker(k), scale = W / 390;

  // L1 the giant, high on the right and partly off screen.
  const r = W * 0.36, w = W * 1.6, h = r * 2.4;
  parts.push({ key: 'rg_giant', anchor: 'entry', z: 1, factor: 0.03, x: 0, y: H * 0.05, canvas: bake(w, h, c => giant(c, W * 0.82, h / 2, r)) });

  // L3 ice chunks tumbling through.
  [[0.08, 0.3, 0.5, 5, 0.3], [0.92, 0.48, 0.38, -4, -0.4], [0.16, 0.7, 0.3, 3, 0.5], [0.86, 0.15, 0.25, -6, 0.6], [0.5, 0.05, 0.2, 4, -0.7]].forEach(([fx, fy, sc, sp, spin], i) => {
    const rr0 = s * sc, cw = rr0 * 2.4;
    parts.push({ key: `rg_ice${i}`, anchor: 'entry', z: 4 + i * 0.1, factor: 0.18 + i * 0.07, wrapY: H * 1.8, x: W * fx, y: H * fy, originX: 0.5, originY: 0.5, drift: sp * scale, spin, canvas: bake(cw, cw, c => iceChunk(c, cw / 2, cw / 2, rr0, i * 7.1)) });
  });

  // L4 the ring's near edge, passing in front at the screen edges only.
  for (const side of [0, 1]) {
    const ew = W * 0.17, eh = H * 0.9;
    parts.push({ key: `rg_edge${side}`, anchor: 'entry', z: 9, factor: 0.65, front: true, x: side ? W - ew : 0, y: H * 0.1, canvas: bake(ew, eh, c => {
      // A haze of ring dust along an arc, with specks of ice in it.
      const ox = side ? ew * 2.6 : -ew * 1.6, oy = eh * 0.5, ax = ew * 2.2, ay = eh * 0.62;
      c.save(); c.translate(ox, oy);
      for (const [lw, a] of [[s * 1.1, 0.06], [s * 0.55, 0.08], [s * 0.18, 0.12]]) {
        c.strokeStyle = `rgba(240,224,190,${a})`; c.lineWidth = lw; c.beginPath(); c.ellipse(0, 0, ax, ay, 0, 0, TAU); c.stroke();
      }
      for (let i = 0; i < 60; i++) {
        const t = hash(i * 3.1 + side * 50) * TAU, d = 1 + (hash(i * 7.7 + side) - 0.5) * (s * 1.1 / ax), pr = 0.6 + 1.8 * hash(i * 5.3) ** 2;
        c.fillStyle = `rgba(250,240,220,${0.35 + 0.4 * hash(i * 9.9)})`; c.beginPath(); circ(c, Math.cos(t) * ax * d, Math.sin(t) * ay * d, pr); c.fill();
      }
      c.restore();
    }) });
  }
  return parts;
}

/** The Ringed Giant arrival's ring arc: a glowing elliptical arc for additive blending. Origin: centre. */
export function bakeRingArc(W: number, H: number, k: number): HTMLCanvasElement {
  const w = W * 1.6, h = H * 0.3;
  return baker(k)(w, h, c => {
    c.translate(w / 2, h / 2);
    for (const [f, a, lw] of [[1, 0.5, 6], [0.94, 0.3, 4], [0.88, 0.2, 3]]) {
      c.strokeStyle = `rgba(255,230,180,${a})`; c.lineWidth = lw; c.beginPath(); c.ellipse(0, 0, w * 0.48 * f, h * 0.4 * f, 0, Math.PI * 0.05, Math.PI * 0.95); c.stroke();
    }
  });
}
