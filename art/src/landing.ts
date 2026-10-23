// Landing effects (monetisation plan v2: Builder's Pass rewards and Workshop sets): the little burst when
// a shape lands, in place of some of the biome dust. Each is a recipe for the game's own particle system
// (view/fx.ts Particles) plus the sprites it uses, drawn white with an Ink edge so the recipe's colours
// tint them. Bursts stay small, short and low (under a block up, gone in about half a second), so they
// never cover the ghost, the beam or the Next preview; spawn them under the guide's depth. Purely visual
// (QA F10.1).

import { INK } from './config.ts';
import { heart, rrPath, twinkle } from './sticker.ts';
import { type Ctx, TAU, ctx2d, hexNum, makeCanvas, turnHex } from './util.ts';

/** Natural size of each landing sprite in blocks (the larger side). Every sprite is centred. */
export const LANDING_TEX = {
  star: 0.4, heart: 0.36, petal: 0.32, leaf: 0.36, note: 0.4, snow: 0.34, bubble: 0.36, pixel: 0.25,
  butterfly: 0.42, ribbon: 0.34, spark: 0.4, puff: 0.5, sprinkle: 0.26, gear: 0.34, nut: 0.34, ember: 0.36,
} as const;
export type LandingTex = keyof typeof LANDING_TEX;
export const LANDING_TEX_NAMES = Object.keys(LANDING_TEX) as LandingTex[];

const LIGHT = '#FFFFFF', SHADE = '#D9DFEC';

function outlined(c: Ctx, p: Path2D, w: number, fill = LIGHT): void {
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.lineWidth = w; c.strokeStyle = INK; c.stroke(p);
  c.fillStyle = fill; c.fill(p);
}

function star5(r: number, inner = 0.48): Path2D {
  const p = new Path2D();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? r * inner : r; if (i) p.lineTo(Math.cos(a) * d, Math.sin(a) * d); else p.moveTo(Math.cos(a) * d, Math.sin(a) * d); }
  p.closePath();
  return p;
}

/** Draw sprite `name` in a unit box centred on the origin (1 = its natural size). */
function drawLandingTex(c: Ctx, name: LandingTex): void {
  const w = 0.1;
  switch (name) {
    case 'star': { const p = star5(0.44); outlined(c, p, w); c.save(); c.clip(p); c.fillStyle = SHADE; c.fillRect(-0.5, 0.12, 1, 0.5); c.restore(); break; }
    case 'heart': { const p = heart(0, 0.02, 0.92); outlined(c, p, w); c.fillStyle = 'rgba(255,255,255,0.9)'; c.beginPath(); c.ellipse(-0.18, -0.14, 0.07, 0.04, -0.6, 0, TAU); c.fill(); break; }
    case 'petal': {
      const p = new Path2D(); p.moveTo(0, -0.44); p.bezierCurveTo(0.34, -0.2, 0.3, 0.3, 0, 0.44); p.bezierCurveTo(-0.3, 0.3, -0.34, -0.2, 0, -0.44); p.closePath();
      outlined(c, p, w * 0.8); c.strokeStyle = SHADE; c.lineWidth = 0.06; c.beginPath(); c.moveTo(0, -0.3); c.quadraticCurveTo(0.04, 0, 0, 0.32); c.stroke(); break;
    }
    case 'leaf': {
      const p = new Path2D(); p.moveTo(-0.42, 0.3); p.bezierCurveTo(-0.4, -0.2, 0.0, -0.44, 0.44, -0.42); p.bezierCurveTo(0.42, 0.04, 0.1, 0.4, -0.42, 0.3); p.closePath();
      outlined(c, p, w); c.strokeStyle = SHADE; c.lineWidth = 0.07; c.beginPath(); c.moveTo(-0.36, 0.26); c.quadraticCurveTo(0.02, 0.02, 0.36, -0.36); c.stroke(); break;
    }
    case 'note': {
      const p = new Path2D(); p.ellipse(-0.16, 0.26, 0.17, 0.12, -0.4, 0, TAU); p.rect(-0.02, -0.4, 0.08, 0.66);
      p.moveTo(0.06, -0.4); p.quadraticCurveTo(0.34, -0.3, 0.3, -0.04); p.quadraticCurveTo(0.24, -0.2, 0.06, -0.2); p.closePath();
      outlined(c, p, w); break;
    }
    case 'snow': {
      const p = new Path2D();
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6, ca = Math.cos(a), sa = Math.sin(a);
        p.moveTo(0, 0); p.lineTo(ca * 0.42, sa * 0.42);
        for (const sgn of [-1, 1]) { const b = a + sgn * 0.7; p.moveTo(ca * 0.24, sa * 0.24); p.lineTo(ca * 0.24 + Math.cos(b) * 0.14, sa * 0.24 + Math.sin(b) * 0.14); }
      }
      c.lineCap = 'round'; c.lineWidth = 0.1 + w * 1.6; c.strokeStyle = INK; c.stroke(p); c.lineWidth = 0.1; c.strokeStyle = LIGHT; c.stroke(p); break;
    }
    case 'bubble': {
      c.fillStyle = 'rgba(255,255,255,0.3)'; c.beginPath(); c.arc(0, 0, 0.42, 0, TAU); c.fill();
      c.lineWidth = 0.07; c.strokeStyle = LIGHT; c.stroke();
      c.lineWidth = 0.035; c.strokeStyle = 'rgba(34,24,58,0.45)'; c.beginPath(); c.arc(0, 0, 0.47, 0, TAU); c.stroke();
      c.fillStyle = LIGHT; c.beginPath(); c.ellipse(-0.17, -0.18, 0.1, 0.06, -0.7, 0, TAU); c.fill(); break;
    }
    case 'pixel': {
      const p = new Path2D(); p.rect(-0.36, -0.36, 0.72, 0.72); outlined(c, p, w * 1.2);
      c.fillStyle = SHADE; c.fillRect(-0.36, 0.14, 0.72, 0.22); c.fillStyle = LIGHT; c.fillRect(-0.36, -0.36, 0.72, 0.16); break;
    }
    case 'butterfly': {
      const wings = new Path2D();
      for (const sx of [-1, 1]) { wings.ellipse(sx * 0.22, -0.12, 0.2, 0.25, sx * 0.5, 0, TAU); wings.ellipse(sx * 0.18, 0.2, 0.14, 0.17, -sx * 0.4, 0, TAU); }
      outlined(c, wings, w);
      c.fillStyle = SHADE; for (const sx of [-1, 1]) { c.beginPath(); c.arc(sx * 0.26, -0.16, 0.07, 0, TAU); c.fill(); }
      c.fillStyle = INK; c.beginPath(); c.ellipse(0, 0.02, 0.05, 0.28, 0, 0, TAU); c.fill();
      c.strokeStyle = INK; c.lineWidth = 0.035; c.beginPath(); c.moveTo(0, -0.24); c.quadraticCurveTo(-0.06, -0.38, -0.14, -0.42); c.moveTo(0, -0.24); c.quadraticCurveTo(0.06, -0.38, 0.14, -0.42); c.stroke();
      break;
    }
    case 'ribbon': {
      const p = new Path2D(); p.moveTo(-0.4, -0.12);
      p.bezierCurveTo(-0.2, -0.42, 0.0, 0.2, 0.18, -0.08); p.bezierCurveTo(0.26, -0.2, 0.36, -0.14, 0.42, -0.02);
      c.lineCap = 'round'; c.lineWidth = 0.16 + w * 1.6; c.strokeStyle = INK; c.stroke(p); c.lineWidth = 0.16; c.strokeStyle = LIGHT; c.stroke(p); break;
    }
    case 'spark': {
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 0.5); g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(-0.5, -0.5, 1, 1);
      c.fillStyle = LIGHT; c.fill(twinkle(0, 0, 0.42)); break;
    }
    case 'puff': {
      const p = new Path2D();
      for (const [x, y, r] of [[-0.18, 0.06, 0.2], [0.14, 0.08, 0.22], [0, -0.12, 0.24], [-0.26, -0.1, 0.14], [0.28, -0.08, 0.14]]) { p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); }
      c.lineWidth = w * 1.6; c.strokeStyle = 'rgba(34,24,58,0.7)'; c.stroke(p); c.fillStyle = LIGHT; c.fill(p);
      c.fillStyle = SHADE; c.beginPath(); c.ellipse(0.02, 0.2, 0.3, 0.08, 0, 0, TAU); c.fill(); break;
    }
    case 'sprinkle': {
      const p = rrPath(-0.42, -0.14, 0.84, 0.28, 0.14); outlined(c, p, w * 1.1);
      c.fillStyle = 'rgba(255,255,255,0.9)'; c.fillRect(-0.28, -0.08, 0.4, 0.06); break;
    }
    case 'gear': {
      const p = new Path2D(), n = 8;
      for (let i = 0; i < n * 2; i++) {
        const a0 = (i / (n * 2)) * TAU, a1 = ((i + 1) / (n * 2)) * TAU, r = i % 2 ? 0.32 : 0.44;
        if (!i) p.moveTo(Math.cos(a0) * r, Math.sin(a0) * r); else p.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
        p.lineTo(Math.cos(a1) * r, Math.sin(a1) * r);
      }
      p.closePath(); p.moveTo(0.13, 0); p.arc(0, 0, 0.13, 0, TAU, true);
      c.lineJoin = 'round'; c.lineWidth = w; c.strokeStyle = INK; c.stroke(p); c.fillStyle = LIGHT; c.fill(p, 'evenodd'); break;
    }
    case 'nut': {
      const p = new Path2D();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * TAU / 6; if (i) p.lineTo(Math.cos(a) * 0.42, Math.sin(a) * 0.42); else p.moveTo(Math.cos(a) * 0.42, Math.sin(a) * 0.42); }
      p.closePath(); p.moveTo(0.16, 0); p.arc(0, 0, 0.16, 0, TAU, true);
      c.lineJoin = 'round'; c.lineWidth = w; c.strokeStyle = INK; c.stroke(p); c.fillStyle = LIGHT; c.fill(p, 'evenodd');
      c.fillStyle = SHADE; c.beginPath(); c.moveTo(-0.36, 0.21); c.lineTo(0, 0.42); c.lineTo(0.36, 0.21); c.lineTo(0.28, 0.16); c.lineTo(0, 0.32); c.lineTo(-0.28, 0.16); c.closePath(); c.fill();
      break;
    }
    case 'ember': {
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 0.5); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(-0.5, -0.5, 1, 1); break;
    }
  }
}

/** Bake landing sprite `name` at s px per block. Origin: centre. */
export function bakeLandingTex(name: LandingTex, s: number): HTMLCanvasElement {
  const px = Math.max(4, Math.ceil(LANDING_TEX[name] * s * 1.1)), cv = makeCanvas(px, px), c = ctx2d(cv);
  c.translate(px / 2, px / 2); c.scale(px / 1.1, px / 1.1);
  drawLandingTex(c, name);
  return cv;
}

/** Draw sprite `name` centred at (x, y), `size` px across, in `color` (for icons; the game tints instead). */
export function drawLandingSprite(c: Ctx, name: LandingTex, x: number, y: number, size: number, color: string, rot = 0): void {
  const k = Math.max(2, Math.ceil(size * 1.2)), base = makeCanvas(k, k), bc = ctx2d(base);
  bc.translate(k / 2, k / 2); bc.scale(size, size); drawLandingTex(bc, name);
  let img = base;
  if (color.toUpperCase() !== '#FFFFFF') {
    // Tint like Phaser does (multiply), keeping the sprite's own alpha.
    img = makeCanvas(k, k);
    const oc = ctx2d(img);
    oc.drawImage(base, 0, 0);
    oc.globalCompositeOperation = 'multiply'; oc.fillStyle = color; oc.fillRect(0, 0, k, k);
    oc.globalCompositeOperation = 'destination-in'; oc.drawImage(base, 0, 0);
  }
  c.save(); c.translate(x, y); c.rotate(rot); c.drawImage(img, -k / 2, -k / 2); c.restore();
}

/** A landing effect: what it spawns and how it moves. Speeds in blocks per second, sizes in blocks. */
export interface LandingStyle {
  /** Sprites, taken in turn. */
  tex: LandingTex[];
  /** Tints, taken in turn ('#FFFFFF' keeps the sprite white). */
  colors: string[];
  /** Particles: count[0] + count[1] × impact (impact 0..1). */
  count: [number, number];
  /** Start size range in blocks; `end` is the end size as a fraction of the start. */
  size: [number, number];
  end: number;
  /** Sideways speed range (away from the shape's middle) and upward speed range. */
  speed: [number, number];
  rise: [number, number];
  /** Blocks per second² (+ is down; a little negative floats). */
  gravity: number;
  drag: number;
  /** Most spin in radians per second (random sign). */
  spin: number;
  life: [number, number];
  /** Upright sprites (notes, butterflies) start level and turn only a little. */
  upright?: boolean;
  /** Additive blend, for glows. */
  add?: boolean;
  /** How much of the biome's dust still puffs out with it (0..1). */
  dust: number;
}

const SHAPE_COLS = ['#FF4F64', '#FF9A2E', '#FFCC33', '#5ED15A', '#33C3F0', '#4A72FF', '#A35CFF'];

/** The recipes, by effect (cosmetics.ts names the items that use them). */
export const LANDING_STYLES = {
  stars: { tex: ['star'], colors: ['#FFD666', '#FFFFFF', '#FFB3CF'], count: [3, 4], size: [0.25, 0.39], end: 0.3, speed: [0.8, 2.2], rise: [1.2, 2.4], gravity: 6, drag: 2.5, spin: 5, life: [0.4, 0.6], dust: 0.4 },
  pixels: { tex: ['pixel'], colors: SHAPE_COLS, count: [4, 5], size: [0.17, 0.25], end: 0.6, speed: [1, 2.6], rise: [1.4, 2.6], gravity: 9, drag: 1.5, spin: 0, life: [0.35, 0.55], upright: true, dust: 0.3 },
  leaves: { tex: ['leaf'], colors: ['#7FD36B', '#B9E86B', '#4FA85A'], count: [3, 3], size: [0.25, 0.36], end: 0.6, speed: [0.8, 2], rise: [0.8, 1.6], gravity: 2.5, drag: 3, spin: 4, life: [0.5, 0.7], dust: 0.5 },
  hearts: { tex: ['heart'], colors: ['#FF7FA0', '#FF4F64', '#FFB3CF'], count: [2, 3], size: [0.25, 0.36], end: 0.5, speed: [0.4, 1.2], rise: [0.6, 1.1], gravity: -0.6, drag: 2.5, spin: 1.2, life: [0.5, 0.65], upright: true, dust: 0.4 },
  bubbles: { tex: ['bubble'], colors: ['#BDEBFF', '#FFFFFF', '#D8C8FF'], count: [3, 3], size: [0.2, 0.36], end: 1.1, speed: [0.3, 1], rise: [0.5, 1], gravity: -0.8, drag: 2, spin: 0, life: [0.45, 0.65], upright: true, dust: 0.3 },
  notes: { tex: ['note'], colors: ['#A35CFF', '#4A72FF', '#E84FD0'], count: [2, 2], size: [0.28, 0.39], end: 0.7, speed: [0.5, 1.2], rise: [0.7, 1.2], gravity: -0.4, drag: 2, spin: 1, life: [0.5, 0.65], upright: true, dust: 0.5 },
  petals: { tex: ['petal'], colors: ['#FFB3CF', '#FFFFFF', '#FFD3DC'], count: [4, 4], size: [0.2, 0.31], end: 0.6, speed: [0.8, 2], rise: [0.6, 1.4], gravity: 2, drag: 3, spin: 5, life: [0.5, 0.7], dust: 0.4 },
  snow: { tex: ['snow'], colors: ['#FFFFFF', '#CFEFFF'], count: [3, 4], size: [0.2, 0.34], end: 0.5, speed: [0.6, 1.6], rise: [0.6, 1.2], gravity: 1.5, drag: 3, spin: 3, life: [0.5, 0.7], dust: 0.4 },
  confetti: { tex: ['ribbon'], colors: SHAPE_COLS, count: [4, 5], size: [0.22, 0.34], end: 0.6, speed: [1, 2.4], rise: [1.2, 2.2], gravity: 6, drag: 2.5, spin: 8, life: [0.4, 0.6], dust: 0.3 },
  sparks: { tex: ['spark'], colors: ['#FFD666', '#FFB13D', '#FFFFFF'], count: [4, 5], size: [0.22, 0.36], end: 0.1, speed: [1.2, 3], rise: [1, 2.2], gravity: 7, drag: 3, spin: 6, life: [0.3, 0.45], add: true, dust: 0.5 },
  butterflies: { tex: ['butterfly'], colors: ['#FF9A2E', '#33C3F0', '#FF7FA0'], count: [2, 1], size: [0.34, 0.42], end: 0.6, speed: [0.5, 1], rise: [0.8, 1.2], gravity: -0.4, drag: 2, spin: 1.5, life: [0.55, 0.7], upright: true, dust: 0.5 },
  rainbow: { tex: ['puff'], colors: SHAPE_COLS, count: [5, 6], size: [0.31, 0.5], end: 0.5, speed: [1, 2.6], rise: [0.3, 1], gravity: 0, drag: 4, spin: 2, life: [0.4, 0.5], dust: 0 },
  sprinkles: { tex: ['sprinkle'], colors: ['#FF7FB0', '#FFE066', '#7FE3F5', '#FFFFFF', '#B9F27F'], count: [5, 5], size: [0.17, 0.25], end: 0.7, speed: [1, 2.4], rise: [1.2, 2.2], gravity: 8, drag: 2, spin: 9, life: [0.4, 0.55], dust: 0.3 },
  bolts: { tex: ['gear', 'nut'], colors: ['#C9D1DE', '#FFC23D', '#8E98AB'], count: [3, 4], size: [0.22, 0.34], end: 0.7, speed: [1, 2.2], rise: [1.2, 2.2], gravity: 9, drag: 1.5, spin: 7, life: [0.4, 0.55], dust: 0.4 },
  embers: { tex: ['ember', 'spark'], colors: ['#FF7A2E', '#FFC23D', '#FF4F3A'], count: [5, 5], size: [0.2, 0.36], end: 0.15, speed: [0.6, 1.8], rise: [1, 1.8], gravity: -0.8, drag: 2.5, spin: 3, life: [0.35, 0.55], add: true, dust: 0.3 },
} satisfies Record<string, LandingStyle>;
export type LandingKind = keyof typeof LANDING_STYLES;

/** Variant `v` of a style: the same burst with its colours' hues turned. */
export function landingStyle(kind: LandingKind, turn = 0): LandingStyle {
  const st: LandingStyle = LANDING_STYLES[kind];
  return turn ? { ...st, colors: st.colors.map(c => turnHex(c, turn)) } : st;
}

/** One particle of a burst, in game pixels (+y down). `size`/`endSize` are in blocks. */
export interface LandingParticle {
  x: number; y: number; vx: number; vy: number;
  tex: LandingTex; tint: number; size: number; endSize: number;
  life: number; gravity: number; drag: number; spin: number; angle?: number; add: boolean;
}

export interface LandingAt {
  /** The landed shape's bottom edge, game px (+y down), from x0 to x1. */
  x0: number; x1: number; y: number;
  /** Landing impact, 0..1 (the sim's). */
  impact: number;
  /** Game px per block. */
  ppb: number;
  /** Random numbers in 0..1 (default Math.random). */
  rand?: () => number;
}

/** The particles of one landing burst. The game spawns each with its own Particles (see ArtTextures.landingBurst). */
export function landingParticles(st: LandingStyle, at: LandingAt): LandingParticle[] {
  const R = at.rand ?? Math.random, n = Math.round(st.count[0] + st.count[1] * Math.max(0, Math.min(1, at.impact)));
  const mid = (at.x0 + at.x1) / 2, out: LandingParticle[] = [], k = at.ppb;
  const span = (r: [number, number]) => r[0] + R() * (r[1] - r[0]);
  for (let i = 0; i < n; i++) {
    const x = at.x0 + R() * (at.x1 - at.x0), dir = x < mid ? -1 : 1, size = span(st.size);
    out.push({
      x, y: at.y, vx: dir * span(st.speed) * k, vy: -span(st.rise) * k,
      tex: st.tex[i % st.tex.length], tint: hexNum(st.colors[i % st.colors.length]), size, endSize: size * st.end,
      life: span(st.life), gravity: st.gravity * k, drag: st.drag, spin: (R() * 2 - 1) * st.spin,
      angle: st.upright ? (R() - 0.5) * 0.4 : undefined, add: !!st.add,
    });
  }
  return out;
}
