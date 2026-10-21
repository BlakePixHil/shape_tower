// Gust textures (art-direction.md §6.3, §9.4): curled wind streaks that build at the upwind edge during
// the telegraph, long streaks that race across in the gust, and the drifters it carries: leaves in the
// Treetops, cloud wisps from Cloudlands up. All point +x (wind blowing left to right); flip the sprite's
// x scale for wind the other way. White parts can be tinted. Centred; sizes in blocks.

import { INK } from './config.ts';
import { type Ctx, TAU, ctx2d, hash, makeCanvas } from './util.ts';

/** Natural size of each texture in blocks, [width, height]. */
export const WIND = {
  curl: [2.1, 0.9],
  streak: [3.4, 0.34],
  leaf: [0.36, 0.36],
  wisp: [1.0, 0.44],
} as const;

export type WindKind = keyof typeof WIND;
/** Variants per kind. */
export const WIND_VARIANTS: Record<WindKind, number> = { curl: 3, streak: 3, leaf: 3, wisp: 2 };
export type WindTex = `${WindKind}${0 | 1 | 2}`;

/** Leaf colors: two greens and an autumn orange, [base, light, vein]. */
const LEAVES: [string, string, string][] = [['#5ED15A', '#A9F09A', '#34A13A'], ['#3FB27F', '#8EE6B8', '#23845A'], ['#FF9A2E', '#FFCB85', '#D96F0A']];

/** A stroke that fades in from the tail (left) and is brightest at the head (right). */
function tailGradient(c: Ctx, w: number, head = 1): CanvasGradient {
  const g = c.createLinearGradient(0, 0, w, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.4, 'rgba(255,255,255,0.65)'); g.addColorStop(1, `rgba(255,255,255,${head})`);
  return g;
}

/** Bake wind texture `name` (e.g. 'curl1') at `s` px per block. */
export function bakeWind(name: WindTex, s: number): HTMLCanvasElement {
  const kind = name.slice(0, -1) as WindKind, v = Number(name.slice(-1)), [bw, bh] = WIND[kind];
  const pt = s / 32, pad = Math.ceil(3 * pt), w = bw * s, h = bh * s;
  const cv = makeCanvas(Math.ceil(w + pad * 2), Math.ceil(h + pad * 2)), c = ctx2d(cv);
  c.translate(pad, pad);
  c.lineCap = 'round'; c.lineJoin = 'round';

  if (kind === 'curl') {
    // A tail that rises gently into a loop at the head, the classic cartoon gust; a thin echo below.
    const R = h * (0.3 - v * 0.03), cx = w - R - 2 * pt, cy = h * 0.42, y0 = h * (0.72 + v * 0.06);
    c.strokeStyle = tailGradient(c, w); c.lineWidth = 3.6 * pt;
    c.beginPath(); c.moveTo(0, y0);
    c.bezierCurveTo(w * 0.35, y0 + h * 0.08, w * 0.55, cy + R, cx, cy + R);
    // The loop: 1.2 turns, tightening.
    const turns = 1.15 + v * 0.1;
    for (let i = 1; i <= 40; i++) {
      const t = i / 40, a = Math.PI / 2 - t * turns * TAU, r = R * (1 - 0.55 * t);
      c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.95);
    }
    c.stroke();
    c.lineWidth = 1.6 * pt; c.strokeStyle = tailGradient(c, w, 0.7);
    c.beginPath(); c.moveTo(w * 0.18, y0 + h * 0.2); c.quadraticCurveTo(w * 0.5, y0 + h * 0.26, cx - R * 0.4, cy + R * 1.45); c.stroke();
  } else if (kind === 'streak') {
    // A long thin line with a slow wave, faded at both ends, brightest just behind the head.
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(255,255,255,0.7)'); g.addColorStop(0.88, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.strokeStyle = g;
    const wave = (y: number, amp: number, ph: number, lw: number) => {
      c.lineWidth = lw; c.beginPath();
      for (let i = 0; i <= 48; i++) { const x = (i / 48) * w, yy = y + Math.sin((i / 48) * TAU * (0.8 + v * 0.3) + ph) * amp; if (i) c.lineTo(x, yy); else c.moveTo(x, yy); }
      c.stroke();
    };
    wave(h * 0.4, h * 0.22, v * 1.3, 3.2 * pt);
    if (v !== 1) { c.globalAlpha = 0.6; wave(h * 0.8, h * 0.12, v * 1.3 + 1.2, 1.6 * pt); c.globalAlpha = 1; }
  } else if (kind === 'leaf') {
    // An almond leaf with an Ink edge, a midrib and a little stem, pointing +x.
    const [base, light, vein] = LEAVES[v], L = w * 0.42, W = h * 0.2 + v * h * 0.02;
    c.translate(w / 2, h / 2); c.rotate(-0.3);
    const p = new Path2D();
    p.moveTo(-L, 0); p.quadraticCurveTo(-L * 0.1, -W * 1.9, L, 0); p.quadraticCurveTo(-L * 0.1, W * 1.9, -L, 0); p.closePath();
    c.fillStyle = base; c.fill(p);
    c.save(); c.clip(p); c.fillStyle = light; c.beginPath(); c.ellipse(-L * 0.15, -W * 0.7, L * 0.7, W * 0.6, 0, 0, TAU); c.fill(); c.restore();
    c.strokeStyle = vein; c.lineWidth = 1.1 * pt;
    c.beginPath(); c.moveTo(-L * 0.8, 0); c.lineTo(L * 0.75, 0); c.stroke();
    c.strokeStyle = INK; c.lineWidth = 1.6 * pt; c.stroke(p);
    c.beginPath(); c.moveTo(-L, 0); c.lineTo(-L - 3.5 * pt, 1.5 * pt); c.stroke();
  } else {
    // A soft, stretched cloud wisp: a few lobes along a line, feathered at the tail.
    for (let i = 0; i < 6; i++) {
      const t = i / 5, x = w * (0.18 + 0.66 * t), y = h * (0.55 - 0.08 * Math.sin(t * 3 + v)), r = h * (0.26 + 0.14 * Math.sin(t * Math.PI) + 0.06 * hash(i + v * 7));
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.35 + 0.55 * t;
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.6, `rgba(255,255,255,${a * 0.75})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
  }
  return cv;
}

/** Which drifters a biome's gusts carry: leaves in the Meadow and Treetops, wisps from Cloudlands to the Stratosphere, none in space. */
export function windDrifters(biome: number): 'leaves' | 'wisps' | 'none' {
  return biome <= 1 ? 'leaves' : biome <= 4 ? 'wisps' : 'none';
}
