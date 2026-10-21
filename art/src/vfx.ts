// Effect textures for the particle system (art-direction.md §7, §9.5). White parts are meant to be
// tinted (dust by BIOMES[i].dust, rings by state color); confetti mini-shapes and XP orbs are baked
// in their colors. Every texture is centred, and its natural size is given in blocks.

import { INK, SIGNAL } from './config.ts';
import { ART_SHAPES } from './shapes.ts';
import { BUNTING_KEYS } from './checkpoint.ts';
import { type Ctx, TAU, circ, ctx2d, hash, makeCanvas, rr } from './util.ts';

/** Width and height in blocks of the effects that aren't square (VFX holds the larger side). */
const VFX_BOX: Partial<Record<keyof typeof VFX, [number, number]>> = { sweep: [1.3, 3.5], gust: [2.4, 0.62] };

/** Natural size of each effect in blocks (the larger side). */
export const VFX = {
  dot: 0.4,         // soft round: dust, glows, fireworks (tint)
  dotHard: 0.4,     // solid round (tint)
  puff: 0.6,        // lumpy dust or cloud puff at contacts (tint with the biome's dust color)
  stardust: 0.35,   // four-point twinkle for space landings and sparkles (tint)
  sparkle: 0.5,     // star with a glow: perfects, heart restored, spawn (tint)
  ring: 1,          // thin impact ring (tint)
  shockwave: 2,     // soft thick ring for claims (tint)
  flash: 1,         // soft radial contact flash (tint)
  speedline: 0.9,   // tapered vertical streak behind fast drops (tint)
  whoosh: 0.9,      // curved arc beside a rotating piece (tint)
  wobble: 0.5,      // two short curved strokes beside a wobbling piece (tint)
  crack: 0.8,       // Ink crack decal for a broken bond
  chip: 0.24,       // irregular stone chip, white with an Ink edge (tint stone colors)
  confetti: 0.2,    // a square with an Ink edge (tint shape colors)
  orb: 0.36,        // XP orb, violet
  rays: 2,          // sunburst for level-ups and big moments (tint)
  // Power-ups (gameplay.md §13)
  sweep: 3.5,       // Clean Slate's broom stroke: a tall band with bristle streaks, bright edge on the right (tint, move it left to right)
  honey: 0.32,      // Glue's honey drop, amber, point up
  spark: 0.4,       // a short streak with a bright head pointing +x: Glue's bond sparks (tint gold, rotate to the velocity)
  ripple: 1.2,      // two thin rings: Slow-Mo and Second Wind starting (tint)
  gust: 2.4,        // a wind streak that curls at its right end: Second Wind's gust (tint, move it left to right)
  shard: 0.3,       // a curved sliver of bubble film for the bubble's burst (tint)
} as const;

export type VfxName = keyof typeof VFX | `mini_${(typeof BUNTING_KEYS)[number]}`;

/** Every effect name, for prewarming. */
export const VFX_NAMES: VfxName[] = [...(Object.keys(VFX) as (keyof typeof VFX)[]), ...BUNTING_KEYS.map(k => `mini_${k}` as VfxName)];

const soft = (c: Ctx, x: number, y: number, r: number, stops: [number, number][]): void => {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, a] of stops) g.addColorStop(o, `rgba(255,255,255,${a})`);
  c.fillStyle = g; c.beginPath(); circ(c, x, y, r); c.fill();
};

function star(c: Ctx, x: number, y: number, r: number, inner: number): void {
  c.beginPath();
  for (let i = 0; i < 8; i++) { const a = -Math.PI / 2 + i * Math.PI / 4, d = i % 2 ? r * inner : r; if (i) c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); else c.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d); }
  c.closePath(); c.fill();
}

/** Bake effect `name` at s px per block. Origin: centre. */
export function bakeVfx(name: VfxName, s: number): HTMLCanvasElement {
  const pt = s / 32;
  if (name.startsWith('mini_')) {
    // A tiny Blockling silhouette in its color, for confetti.
    const sh = ART_SHAPES[name.slice(5)], cells = sh.cells ?? [[0, 0]], u = s * 0.11, pad = Math.ceil(2 * pt);
    const w = Math.max(...cells.map(c => c[0])) + 1, h = Math.max(...cells.map(c => c[1])) + 1;
    const cv = makeCanvas(w * u + pad * 2, h * u + pad * 2), c = ctx2d(cv);
    c.fillStyle = INK;
    for (const [x, y] of cells) c.fillRect(pad + x * u - pt, pad + (h - 1 - y) * u - pt, u + 2 * pt, u + 2 * pt);
    c.fillStyle = sh.base;
    for (const [x, y] of cells) c.fillRect(pad + x * u + pt * 0.3, pad + (h - 1 - y) * u + pt * 0.3, u - pt * 0.6, u - pt * 0.6);
    c.fillStyle = sh.light;
    for (const [x, y] of cells) c.fillRect(pad + x * u + pt * 0.3, pad + (h - 1 - y) * u + pt * 0.3, u - pt * 0.6, u * 0.25);
    return cv;
  }
  const n = name as keyof typeof VFX, box = VFX_BOX[n];
  if (box) return bakeLong(n, box[0] * s, box[1] * s, pt);
  const size = Math.ceil(VFX[n] * s + 4 * pt), cv = makeCanvas(size, size), c = ctx2d(cv), m = size / 2, r = VFX[n] * s / 2;
  switch (n) {
    case 'dot': soft(c, m, m, r, [[0, 1], [0.6, 0.8], [1, 0]]); break;
    case 'dotHard': c.fillStyle = '#FFFFFF'; c.beginPath(); circ(c, m, m, r); c.fill(); break;
    case 'puff': {
      c.fillStyle = '#FFFFFF'; c.beginPath();
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU + 0.4, d = r * 0.38; circ(c, m + Math.cos(a) * d, m + Math.sin(a) * d * 0.8, r * (0.42 + 0.12 * hash(i))); }
      circ(c, m, m, r * 0.5); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.08)'; c.beginPath(); circ(c, m + r * 0.15, m + r * 0.25, r * 0.4); c.fill();
      break;
    }
    case 'stardust': soft(c, m, m, r * 0.7, [[0, 0.8], [1, 0]]); c.fillStyle = '#FFFFFF'; star(c, m, m, r, 0.22); break;
    case 'sparkle': soft(c, m, m, r * 0.85, [[0, 0.7], [0.5, 0.25], [1, 0]]); c.fillStyle = '#FFFFFF'; star(c, m, m, r * 0.9, 0.28); break;
    case 'ring': c.beginPath(); circ(c, m, m, r - 2 * pt); c.lineWidth = 2.2 * pt; c.strokeStyle = '#FFFFFF'; c.stroke(); break;
    case 'shockwave': {
      const g = c.createRadialGradient(m, m, r * 0.7, m, m, r);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); circ(c, m, m, r); c.fill();
      break;
    }
    case 'flash': soft(c, m, m, r, [[0, 1], [0.3, 0.7], [1, 0]]); break;
    case 'speedline': {
      const w = 0.08 * s, g = c.createLinearGradient(0, m - r, 0, m + r);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,0.95)');
      c.fillStyle = g; c.beginPath(); c.moveTo(m, m - r); c.lineTo(m + w / 2, m + r - w / 2); c.arc(m, m + r - w / 2, w / 2, 0, Math.PI); c.closePath(); c.fill();
      break;
    }
    case 'whoosh': {
      c.lineCap = 'round'; c.strokeStyle = '#FFFFFF';
      for (const [rad, wd, a0] of [[0.92, 3, 0], [0.7, 2.2, 0.25]] as [number, number, number][]) {
        c.lineWidth = wd * pt; c.beginPath(); c.arc(m, m, r * rad, -Math.PI * 0.95 + a0, -Math.PI * 0.35); c.stroke();
      }
      break;
    }
    case 'wobble': {
      c.lineCap = 'round'; c.strokeStyle = '#FFFFFF'; c.lineWidth = 2.4 * pt;
      for (const dx of [-0.35, 0.35]) { c.beginPath(); c.moveTo(m + dx * r, m - r * 0.7); c.quadraticCurveTo(m + dx * r * 1.9, m, m + dx * r, m + r * 0.7); c.stroke(); }
      break;
    }
    case 'crack': {
      c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = INK;
      const pts: [number, number][] = [[-0.9, 0.1], [-0.5, -0.15], [-0.15, 0.2], [0.2, -0.1], [0.55, 0.15], [0.9, -0.05]];
      c.lineWidth = 2.4 * pt; c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo : c.moveTo).call(c, m + x * r, m + y * r)); c.stroke();
      c.lineWidth = 1.6 * pt; c.beginPath(); c.moveTo(m - 0.15 * r, m + 0.2 * r); c.lineTo(m - 0.05 * r, m + 0.6 * r); c.moveTo(m + 0.2 * r, m - 0.1 * r); c.lineTo(m + 0.32 * r, m - 0.55 * r); c.stroke();
      break;
    }
    case 'chip': {
      c.beginPath();
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU, d = r * (0.6 + 0.4 * hash(i * 2.3)); if (i) c.lineTo(m + Math.cos(a) * d, m + Math.sin(a) * d); else c.moveTo(m + Math.cos(a) * d, m + Math.sin(a) * d); }
      c.closePath(); c.fillStyle = '#FFFFFF'; c.fill(); c.lineWidth = 1.5 * pt; c.strokeStyle = INK; c.stroke();
      break;
    }
    case 'confetti': rr(c, m - r * 0.8, m - r * 0.55, r * 1.6, r * 1.1, r * 0.15); c.fillStyle = '#FFFFFF'; c.fill(); c.lineWidth = 1.2 * pt; c.strokeStyle = INK; c.stroke(); break;
    case 'orb': {
      const g = c.createRadialGradient(m - r * 0.3, m - r * 0.3, 0, m, m, r);
      g.addColorStop(0, '#E4DBFF'); g.addColorStop(0.45, SIGNAL.xp); g.addColorStop(1, '#4E36C2');
      c.fillStyle = g; c.beginPath(); circ(c, m, m, r * 0.82); c.fill(); c.lineWidth = 1.6 * pt; c.strokeStyle = INK; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); circ(c, m - r * 0.3, m - r * 0.32, r * 0.18); c.fill();
      break;
    }
    case 'rays': {
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * TAU, w = 0.11;
        const g = c.createRadialGradient(m, m, r * 0.15, m, m, r);
        g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.moveTo(m, m); c.arc(m, m, r, a - w, a + w); c.closePath(); c.fill();
      }
      break;
    }
    case 'honey': {
      // A drop falling point-up, with a bright cap and an Ink edge so it reads on any sky.
      const b = r * 0.6, by = m + r * 0.32;
      c.beginPath(); c.moveTo(m, m - r);
      c.bezierCurveTo(m + r * 0.15, m - r * 0.45, m + b, by - b * 0.6, m + b, by);
      c.arc(m, by, b, 0, Math.PI);
      c.bezierCurveTo(m - b, by - b * 0.6, m - r * 0.15, m - r * 0.45, m, m - r);
      const g = c.createLinearGradient(0, m - r, 0, by + b);
      g.addColorStop(0, '#FFD27A'); g.addColorStop(0.55, SIGNAL.amber); g.addColorStop(1, '#E07F12');
      c.fillStyle = g; c.fill(); c.lineWidth = 1.4 * pt; c.lineJoin = 'round'; c.strokeStyle = INK; c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.ellipse(m - b * 0.38, by - b * 0.25, b * 0.2, b * 0.3, 0.4, 0, TAU); c.fill();
      break;
    }
    case 'spark': {
      const g = c.createLinearGradient(m - r, 0, m + r, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,1)');
      const w = 0.07 * s;
      c.fillStyle = g; c.beginPath(); c.moveTo(m - r, m); c.lineTo(m + r * 0.7, m - w / 2); c.arc(m + r * 0.7, m, w / 2, -Math.PI / 2, Math.PI / 2); c.closePath(); c.fill();
      soft(c, m + r * 0.7, m, r * 0.3, [[0, 1], [0.4, 0.6], [1, 0]]);
      break;
    }
    case 'ripple':
      c.strokeStyle = '#FFFFFF';
      c.beginPath(); circ(c, m, m, r - 2 * pt); c.lineWidth = 2 * pt; c.stroke();
      c.globalAlpha = 0.6; c.beginPath(); circ(c, m, m, r * 0.7); c.lineWidth = 1.5 * pt; c.stroke(); c.globalAlpha = 1;
      break;
    case 'shard':
      c.strokeStyle = '#FFFFFF'; c.lineCap = 'round'; c.lineWidth = 2.4 * pt;
      c.beginPath(); c.arc(m, m + r * 0.9, r * 1.5, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); c.stroke();
      break;
  }
  return cv;
}

/** The two long effects: Clean Slate's sweep (tall) and Second Wind's gust (wide). Origin: centre. */
function bakeLong(n: keyof typeof VFX, w: number, h: number, pt: number): HTMLCanvasElement {
  const pad = Math.ceil(2 * pt), cv = makeCanvas(w + pad * 2, h + pad * 2), c = ctx2d(cv);
  c.translate(pad, pad);
  if (n === 'sweep') {
    // A soft band, brightest at its leading (right) edge, combed with bristle streaks.
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(255,255,255,0.45)'); g.addColorStop(0.88, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    const v = c.createLinearGradient(0, 0, 0, h);
    v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.12, 'rgba(0,0,0,0)'); v.addColorStop(0.88, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)');
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    c.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const x = w * (0.15 + 0.8 * hash(i * 3.1)), y0 = h * (0.04 + 0.2 * hash(i * 5.7)), y1 = h * (0.76 + 0.2 * hash(i * 7.3));
      c.strokeStyle = `rgba(255,255,255,${0.35 + 0.5 * hash(i * 9.1)})`; c.lineWidth = (1.2 + 1.8 * hash(i * 2.3)) * pt;
      c.beginPath(); c.moveTo(x - w * 0.12, y0); c.quadraticCurveTo(x, (y0 + y1) / 2, x - w * 0.12, y1); c.stroke();
    }
    // Fade the top and bottom ends.
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = v; c.fillRect(0, 0, w, h); c.globalCompositeOperation = 'source-over';
  } else {
    // A streak that thickens to the right and curls up at its head.
    const y = h * 0.62, cr = h * 0.3, hx = w - cr - 3 * pt;
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,1)');
    c.strokeStyle = g; c.lineCap = 'round'; c.lineJoin = 'round';
    c.lineWidth = 3 * pt;
    c.beginPath(); c.moveTo(0, y); c.lineTo(hx, y); c.arc(hx, y - cr, cr, Math.PI / 2, -Math.PI * 0.95, true); c.stroke();
    c.lineWidth = 1.6 * pt; c.globalAlpha = 0.7;
    c.beginPath(); c.moveTo(w * 0.25, y + h * 0.24); c.lineTo(hx - cr * 0.6, y + h * 0.24); c.stroke();
    c.globalAlpha = 1;
  }
  return cv;
}
