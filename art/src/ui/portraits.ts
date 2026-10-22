// Portraits (Blake, 2026-10-22: "portraits next to the name ... unlock cooler animated portraits for
// unlocking challenging achievements as well as just being able to purchase portraits"). A portrait is the
// player's avatar (its Blockling, face and hat) in a style: a background disc, a frame, and for the
// animated styles a few baked layers that CSS moves with transform and opacity only, so twenty rows of a
// ladder stay cheap. The frame says where a style came from: free ones keep the avatar's plain Ink ring,
// shop ones a colored band, earned ones a gold medal rim with laurels, twinkles and a glint, and the two
// Platinum ones an iridescent rim that turns, under a gem or a crown. Needs uiCss().

import { INK, PAPER } from '../config.ts';
import { BIOMES } from '../biomes.ts';
import { circlePath, heart, twinkle } from '../sticker.ts';
import { type Ctx, TAU, ctx2d, hash, makeCanvas } from '../util.ts';
import { canvasBlobUrl, canvasUrl } from '../urls.ts';
import { type AvatarSpec, drawAvatarFigure } from './screens.ts';

export type PortraitId =
  | 'meadow' | 'sunset' | 'nightsky' | 'cloudland'
  | 'moonwalk' | 'dust_devil' | 'ring_leader' | 'deep_space' | 'golden_crown' | 'seventh_heaven' | 'ironclad' | 'meteor_shower'
  | 'bubblegum' | 'checkers' | 'retro' | 'rainbow' | 'lava_lamp' | 'disco'
  | 'supporter';

/** Where a style comes from: free by level, earned from an achievement (Platinum the rarest), the shop, or the Supporter Pack. */
export type PortraitKind = 'free' | 'earned' | 'platinum' | 'shop' | 'supporter';

export interface PortraitArt { id: PortraitId; name: string; animated: boolean; kind: PortraitKind }

/** Every portrait style. The ids are permanent (saved with profiles and sent to the ladder). */
export const PORTRAIT_ART: PortraitArt[] = [
  { id: 'meadow', name: 'Meadow', animated: false, kind: 'free' },
  { id: 'sunset', name: 'Sunset', animated: false, kind: 'free' },
  { id: 'nightsky', name: 'Night Sky', animated: false, kind: 'free' },
  { id: 'cloudland', name: 'Cloudland', animated: false, kind: 'free' },
  { id: 'moonwalk', name: 'Moonwalk', animated: true, kind: 'earned' },
  { id: 'dust_devil', name: 'Dust Devil', animated: true, kind: 'earned' },
  { id: 'ring_leader', name: 'Ring Leader', animated: true, kind: 'earned' },
  { id: 'deep_space', name: 'Deep Space', animated: true, kind: 'platinum' },
  { id: 'golden_crown', name: 'Golden Crown', animated: true, kind: 'platinum' },
  { id: 'seventh_heaven', name: 'Seventh Heaven', animated: true, kind: 'earned' },
  { id: 'ironclad', name: 'Ironclad', animated: true, kind: 'earned' },
  { id: 'meteor_shower', name: 'Meteor Shower', animated: true, kind: 'earned' },
  { id: 'bubblegum', name: 'Bubblegum', animated: false, kind: 'shop' },
  { id: 'checkers', name: 'Checkers', animated: false, kind: 'shop' },
  { id: 'retro', name: 'Retro', animated: false, kind: 'shop' },
  { id: 'rainbow', name: 'Rainbow', animated: true, kind: 'shop' },
  { id: 'lava_lamp', name: 'Lava Lamp', animated: true, kind: 'shop' },
  { id: 'disco', name: 'Disco', animated: true, kind: 'shop' },
  { id: 'supporter', name: 'Supporter', animated: true, kind: 'supporter' },
];

// ---------------------------------------------------------------------------------------------
// Layers

/** How a layer moves. Each starts from the layer as drawn, which is also the still frame. */
type Anim =
  /** Turn about the layer's centre once every `d` seconds. */
  | { k: 'spin'; d: number; rev?: boolean }
  /** Slide from `from` to `to` (fractions of the layer's own size) and jump back: a tiled layer loops seamlessly. */
  | { k: 'scroll'; d: number; from: [number, number]; to: [number, number] }
  /** Fade down and back (`at`: where in the cycle it starts, 0 to 1). */
  | { k: 'twinkle'; d: number; at?: number }
  /** A sparkle: shrink, turn and fade, then come back. */
  | { k: 'glitter'; d: number; at?: number }
  /** Float up by `amp` (a fraction of the layer's height) and back. */
  | { k: 'bob'; d: number; amp: number }
  /** A heartbeat: two quick swells, then a rest. */
  | { k: 'beat'; d: number }
  /** Rock `deg` each way about (ox, oy), fractions of the layer. */
  | { k: 'sway'; d: number; deg: number; ox: number; oy: number };

interface Layer {
  /** Draws in the layer's own units: (0, 0) is its top-left and 1 is the disc's diameter (disc layers) or the box (frame layers). */
  draw(c: Ctx): void;
  /** Its place and size in those units. Default: the whole disc or box. */
  x?: number; y?: number; w?: number; h?: number;
  anim?: Anim;
  /** Squash it to this much of its height, about its middle: a spinning ring seen at an angle. */
  tilt?: number;
}

interface Style {
  /** Under everything, outside the disc (the Platinum gold scallops). Box units. */
  under?: Layer[];
  /** Behind the figure, inside the disc. */
  back: Layer[];
  /** In front of the figure, inside the disc. */
  front?: Layer[];
  /** Over the disc, under the frame (the Platinum rim). Box units. */
  rim?: Layer[];
  /** The frame, centred on the origin (box units, the box is -0.5 to 0.5). */
  frame(c: Ctx): void;
  /** Over the frame (twinkles). Box units. */
  over?: Layer[];
  /** A shine that sweeps across now and then (earned styles). */
  glint?: boolean;
  /** The figure floats (no ground under it). */
  float?: boolean;
}

/** The disc's radius in box units: the frame fills the rest of the box. */
const RD = 0.42;

// ---------------------------------------------------------------------------------------------
// Drawing helpers. Disc layers draw in disc units: the disc is (0, 0) to (1, 1) and the figure stands on y = 0.8.

type Stops = [number, string][];

function vsky(c: Ctx, stops: Stops, w = 1, h = 1): void {
  const g = c.createLinearGradient(0, 0, 0, h);
  for (const [t, col] of stops) g.addColorStop(t, col);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
}

function glow(c: Ctx, x: number, y: number, r: number, stops: Stops): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [t, col] of stops) g.addColorStop(t, col);
  c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Calls `f` at (x, y) and at each copy of it one period over that could show in a `w` × `h` tiled layer. */
function wrap(w: number, h: number, x: number, y: number, r: number, f: (x: number, y: number) => void): void {
  for (let i = -1; i <= Math.ceil(w); i++) for (let j = -1; j <= Math.ceil(h); j++) {
    const X = x + i, Y = y + j;
    if (X + r > 0 && X - r < w && Y + r > 0 && Y - r < h) f(X, Y);
  }
}

/** Little round stars, seeded, in a box. */
function stars(c: Ctx, n: number, seed: number, x0: number, y0: number, x1: number, y1: number, r: number, col = '#FFFFFF'): void {
  c.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const x = x0 + hash(seed + i * 3.1) * (x1 - x0), y = y0 + hash(seed + i * 7.7) * (y1 - y0), rr = r * (0.5 + hash(seed + i * 5.3));
    c.globalAlpha = 0.55 + 0.45 * hash(seed + i * 1.9);
    c.beginPath(); c.arc(x, y, rr, 0, TAU); c.fill();
  }
  c.globalAlpha = 1;
}

/** Ground from a gently domed line at `y` down to the bottom, with a lighter lip along its top. */
function ground(c: Ctx, y: number, col: string, lip?: string, dome = 0.025): void {
  const p = new Path2D();
  p.moveTo(-0.1, y + dome); p.quadraticCurveTo(0.5, y - dome, 1.1, y + dome); p.lineTo(1.1, 1.1); p.lineTo(-0.1, 1.1); p.closePath();
  c.fillStyle = col; c.fill(p);
  if (lip) {
    const l = new Path2D(); l.moveTo(-0.1, y + dome); l.quadraticCurveTo(0.5, y - dome, 1.1, y + dome);
    c.lineWidth = 0.025; c.strokeStyle = lip; c.stroke(l);
  }
}

/** A floor of cloud puffs along `y`. */
function cloudFloor(c: Ctx, y: number, col = '#FFFFFF', shade = '#D7E8FA'): void {
  for (const [fill, dy] of [[shade, 0.03], [col, 0]] as const) {
    c.fillStyle = fill; c.beginPath();
    for (let i = 0; i <= 6; i++) { const x = i / 6, r = 0.1 + 0.035 * hash(i * 2.7); c.moveTo(x + r, y + dy); c.arc(x, y + dy + 0.02, r, 0, TAU); }
    c.rect(-0.1, y + dy + 0.03, 1.2, 0.5); c.fill();
  }
}

function sparkle(c: Ctx, x: number, y: number, r: number, col = '#FFFFFF', outline = 0): void {
  const p = twinkle(x, y, r);
  c.fillStyle = col; c.fill(p);
  if (outline) { c.lineJoin = 'round'; c.lineWidth = outline; c.strokeStyle = INK; c.stroke(p); }
}

/** A small cloud shape. */
function puff(c: Ctx, x: number, y: number, r: number, col: string): void {
  c.fillStyle = col; c.beginPath();
  c.arc(x - r * 0.7, y, r * 0.55, 0, TAU); c.moveTo(x + r * 0.8, y); c.arc(x, y - r * 0.25, r * 0.75, 0, TAU);
  c.moveTo(x + r * 1.3, y); c.arc(x + r * 0.75, y + r * 0.05, r * 0.5, 0, TAU); c.fill();
}

/** A moon's surface with a few craters, from `y` down. */
function moonGround(c: Ctx, y: number, base: string, crater: string, rimLight: string): void {
  ground(c, y, base, rimLight, 0.04);
  for (const [x, yy, r] of [[0.18, y + 0.1, 0.07], [0.72, y + 0.08, 0.05], [0.5, y + 0.17, 0.08], [0.92, y + 0.15, 0.06]] as const) {
    c.fillStyle = crater; c.beginPath(); c.ellipse(x, yy, r, r * 0.38, 0, 0, TAU); c.fill();
    c.strokeStyle = rimLight; c.lineWidth = 0.012; c.beginPath(); c.ellipse(x, yy + r * 0.05, r, r * 0.38, 0, 0.1 * Math.PI, 0.9 * Math.PI); c.stroke();
  }
}

/** Light rays from (x, y), `n` of them, alternate wedges filled. */
function rays(c: Ctx, x: number, y: number, n: number, col: string, len = 1.2): void {
  c.fillStyle = col;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, w = TAU / n / 2;
    c.beginPath(); c.moveTo(x, y); c.arc(x, y, len, a, a + w); c.closePath(); c.fill();
  }
}

/** Dots round a circle of radius `r` about (cx, cy): ring particles or a swirl of dust, for a spinning layer. */
function particleRing(c: Ctx, n: number, seed: number, cols: string[], cx: number, cy: number, r: number, dot: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + hash(seed + i) * 0.3, rr = r * (0.85 + 0.2 * hash(seed + i * 2.3)), s = dot * (0.6 + 0.8 * hash(seed + i * 4.1));
    c.fillStyle = cols[i % cols.length]; c.beginPath(); c.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, s, 0, TAU); c.fill();
  }
}

// ---------------------------------------------------------------------------------------------
// Frames (box units, centred)

/** A filled outline with a light lip on top and a shade lip below, and an Ink edge just outside it. */
function solid(c: Ctx, p: Path2D, base: string | CanvasGradient, light: string, shade: string, lip = 0.014, edge = 0.024): void {
  c.lineJoin = 'round'; c.lineWidth = edge * 2; c.strokeStyle = INK; c.stroke(p);
  c.save(); c.clip(p);
  c.fillStyle = light; c.fill(p);
  c.translate(0, lip); c.fillStyle = base; c.fill(p);
  c.translate(0, -lip * 2.2);
  const band = new Path2D(); band.rect(-2, -2, 4, 4); band.addPath(p);
  c.fillStyle = shade; c.fill(band, 'evenodd');
  c.restore();
}

/** A ring between r0 and an outer edge `r1(a)`. */
function annulus(r0: number, r1: (a: number) => number = () => RD + 0.05, n = 120): Path2D {
  const p = new Path2D();
  for (let i = 0; i <= n; i++) { const a = (i / n) * TAU, r = r1(a); i ? p.lineTo(Math.cos(a) * r, Math.sin(a) * r) : p.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  p.closePath();
  p.moveTo(r0, 0); p.arc(0, 0, r0, 0, -TAU, true); p.closePath();
  return p;
}

/** A soft shine along the frame's upper left. */
function rimShine(c: Ctx, r: number, w = 0.016): void {
  c.lineCap = 'round'; c.lineWidth = w; c.strokeStyle = 'rgba(255,255,255,0.75)';
  c.beginPath(); c.arc(0, 0, r, Math.PI * 1.08, Math.PI * 1.38); c.stroke();
}

/** Free styles: a plain Paper band, as wide as the others so a ladder's rows line up. */
function plainFrame(c: Ctx): void {
  solid(c, annulus(RD - 0.01, () => RD + 0.045), PAPER, '#FFFFFF', '#E6D3B3');
}

/** Shop styles: a colored band between Ink lines. `base` may be a gradient maker. */
const bandFrame = (base: string | ((c: Ctx) => CanvasGradient), light: string, shade: string, extra?: (c: Ctx) => void) => (c: Ctx): void => {
  const p = annulus(RD - 0.01);
  solid(c, p, typeof base === 'string' ? base : base(c), light, shade);
  extra?.(c);
  rimShine(c, RD + 0.02);
};

/** Earned (Gold): a scalloped gold medal rim with laurel sprigs along its lower sides. */
function goldFrame(c: Ctx): void {
  solid(c, annulus(RD - 0.01, a => RD + 0.04 + 0.014 * Math.abs(Math.cos(a * 10)), 200), '#FFC23D', '#FFE08A', '#D9971A');
  // Laurels: leaves along the rim from the bottom up each side.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 - sx * (0.32 + i * 0.2), r = RD + 0.035, x = Math.cos(a) * r, y = Math.sin(a) * r;
      c.save(); c.translate(x, y); c.rotate(a + sx * 0.9 + Math.PI / 2);
      const leaf = new Path2D(); leaf.ellipse(0, 0, 0.042, 0.018, 0, 0, TAU);
      c.lineWidth = 0.014; c.strokeStyle = INK; c.stroke(leaf);
      c.fillStyle = i % 2 ? '#8FD16A' : '#6CBF4E'; c.fill(leaf);
      c.restore();
    }
  }
  rimShine(c, RD + 0.025);
}

/** Platinum: Ink edges, lips and a jewel over the turning iridescent rim (rim layer below). */
const platinumFrame = (jewel: 'gem' | 'crown') => (c: Ctx): void => {
  const p = annulus(RD - 0.022, () => RD + 0.045);
  c.lineJoin = 'round'; c.lineWidth = 0.024; c.strokeStyle = INK;
  c.beginPath(); c.arc(0, 0, RD + 0.045, 0, TAU); c.stroke();
  c.beginPath(); c.arc(0, 0, RD - 0.022, 0, TAU); c.stroke();
  // The lips stay put while the colors turn under them.
  c.save(); c.clip(p);
  c.translate(0, -0.016);
  const band = new Path2D(); band.rect(-2, -2, 4, 4); band.addPath(p);
  c.fillStyle = 'rgba(120,110,170,0.32)'; c.fill(band, 'evenodd');
  c.translate(0, 0.032); c.fillStyle = 'rgba(255,255,255,0.4)'; c.fill(band, 'evenodd');
  c.restore();
  rimShine(c, RD + 0.025, 0.02);
  if (jewel === 'gem') {
    const y = -(RD + 0.015), gem = new Path2D();
    gem.moveTo(0, y - 0.05); gem.lineTo(0.05, y); gem.lineTo(0, y + 0.05); gem.lineTo(-0.05, y); gem.closePath();
    solid(c, gem, '#7FE3F5', '#D2F8FF', '#3AA9C9', 0.012, 0.016);
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.beginPath(); c.moveTo(-0.022, y - 0.01); c.lineTo(0, y - 0.034); c.lineTo(0.007, y - 0.017); c.closePath(); c.fill();
  } else {
    // A gold crown sitting over the rim's top, with three jewels.
    const y = -0.355, cr = new Path2D();
    cr.moveTo(-0.14, y); cr.lineTo(-0.16, y - 0.095); cr.lineTo(-0.075, y - 0.04); cr.lineTo(0, y - 0.11);
    cr.lineTo(0.075, y - 0.04); cr.lineTo(0.16, y - 0.095); cr.lineTo(0.14, y); cr.closePath();
    solid(c, cr, '#FFC23D', '#FFE08A', '#D9971A', 0.012, 0.016);
    c.fillStyle = '#FFF2B8'; c.fillRect(-0.11, y - 0.028, 0.22, 0.011);
    for (const [x, yy, col] of [[-0.16, y - 0.1, '#FF4F64'], [0, y - 0.115, '#7FE3F5'], [0.16, y - 0.1, '#FF4F64']] as const) {
      const j = circlePath(x, yy, 0.02); c.fillStyle = col; c.fill(j); c.lineWidth = 0.012; c.strokeStyle = INK; c.stroke(j);
    }
  }
};

/** The Platinum rim's colors: holographic foil around the ring, turned by its layer. */
function pearlRim(c: Ctx): void {
  c.translate(0.5, 0.5);
  const p = annulus(RD - 0.022, () => RD + 0.045), cols = ['#FF9BE0', '#B9A3FF', '#7FDBFF', '#86F2C6', '#FFEA80', '#FF9BE0'];
  c.save(); c.clip(p);
  const n = 90;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * (cols.length - 1), k = Math.floor(t), a = (i / n) * TAU;
    c.fillStyle = mix(cols[k], cols[k + 1], t - k);
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 0.6, a, a + TAU / n + 0.01); c.closePath(); c.fill();
  }
  c.restore();
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return `rgb(${[0, 1, 2].map(i => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t)).join(',')})`;
}

/** Twinkles on the frame, each blinking on its own beat. Box layers. */
function frameTwinkles(at: [number, number, number][], d = 2.6): Layer[] {
  return at.map(([x, y, r], i) => ({
    x: x - r, y: y - r, w: r * 2, h: r * 2,
    draw: c => sparkle(c, r, r, r * 0.95, '#FFFFFF', r * 0.16),
    anim: { k: 'glitter', d, at: i * 0.37 },
  }));
}

const GOLD_TWINKLES = frameTwinkles([[0.86, 0.17, 0.07], [0.13, 0.84, 0.055]]);
const PLAT_TWINKLES = frameTwinkles([[0.87, 0.2, 0.08], [0.1, 0.3, 0.055], [0.84, 0.86, 0.06]], 2.2);
const PLAT_RIM: Layer = { draw: pearlRim, anim: { k: 'spin', d: 6 } };
/** Gold scallops round the outside of the Platinum rim: a gold medal's edge with the foil inside it. */
const PLAT_GOLD: Layer = { draw: c => { c.translate(0.5, 0.5); solid(c, annulus(RD + 0.02, a => RD + 0.057 + 0.011 * Math.abs(Math.cos(a * 12)), 240), '#FFC23D', '#FFE08A', '#D9971A', 0.01, 0.012); } };

// ---------------------------------------------------------------------------------------------
// The styles

const STYLES: Record<PortraitId, Style> = {
  // Free --------------------------------------------------------------------------------------
  meadow: {
    back: [{ draw: c => { const s = BIOMES[0].sky; vsky(c, [[0, s[0]], [1, s[2]]]); c.fillStyle = '#7FD36B'; c.fillRect(0, 0.8, 1, 0.3); } }],
    frame: plainFrame,
  },
  sunset: {
    back: [{
      draw: c => {
        vsky(c, [[0, '#5B3F9E'], [0.45, '#FF7E8A'], [0.8, '#FFC46B']]);
        glow(c, 0.5, 0.78, 0.45, [[0, 'rgba(255,240,180,0.9)'], [1, 'rgba(255,240,180,0)']]);
        const g = c.createLinearGradient(0, 0.52, 0, 0.8); g.addColorStop(0, '#FFE89A'); g.addColorStop(1, '#FF9F4A');
        c.fillStyle = g; c.beginPath(); c.arc(0.5, 0.8, 0.25, 0, TAU); c.fill();
        c.fillStyle = '#A4527A'; c.beginPath(); c.moveTo(-0.1, 0.8); c.quadraticCurveTo(0.2, 0.68, 0.45, 0.8); c.quadraticCurveTo(0.75, 0.66, 1.1, 0.78); c.lineTo(1.1, 1.1); c.lineTo(-0.1, 1.1); c.fill();
        ground(c, 0.81, '#6B3A6E');
      },
    }],
    frame: plainFrame,
  },
  nightsky: {
    back: [{
      draw: c => {
        vsky(c, [[0, '#0B1033'], [0.75, '#1F2A6B'], [1, '#2E3F86']]);
        stars(c, 26, 3, 0, 0, 1, 0.75, 0.008);
        // A crescent moon.
        c.save(); c.beginPath(); c.rect(-1, -1, 3, 3); c.arc(0.79, 0.21, 0.1, 0, TAU, true); c.clip();
        glow(c, 0.73, 0.25, 0.2, [[0, 'rgba(255,243,196,0.35)'], [1, 'rgba(255,243,196,0)']]);
        c.fillStyle = '#FFF3C4'; c.beginPath(); c.arc(0.73, 0.25, 0.11, 0, TAU); c.fill();
        c.restore();
        ground(c, 0.8, '#18344A', '#2C5670');
      },
    }],
    frame: plainFrame,
  },
  cloudland: {
    back: [{
      draw: c => {
        const s = BIOMES[2].sky; vsky(c, [[0, s[0]], [0.7, s[1]], [1, s[2]]]);
        puff(c, 0.2, 0.3, 0.09, 'rgba(255,255,255,0.85)'); puff(c, 0.78, 0.18, 0.07, 'rgba(255,255,255,0.75)');
        cloudFloor(c, 0.81);
      },
    }],
    frame: plainFrame,
  },

  // Earned (Gold) -----------------------------------------------------------------------------
  moonwalk: {
    back: [
      {
        draw: c => {
          vsky(c, [[0, '#07081A'], [1, '#22264A']]);
          stars(c, 18, 11, 0, 0, 1, 0.7, 0.007);
          // The Earth, far off.
          glow(c, 0.24, 0.26, 0.2, [[0, 'rgba(120,200,255,0.45)'], [1, 'rgba(120,200,255,0)']]);
          const e = circlePath(0.24, 0.26, 0.1);
          c.fillStyle = '#3DB4F2'; c.fill(e);
          c.save(); c.clip(e); c.fillStyle = '#6CD35A';
          c.beginPath(); c.ellipse(0.2, 0.22, 0.05, 0.035, 0.5, 0, TAU); c.fill();
          c.beginPath(); c.ellipse(0.29, 0.31, 0.04, 0.03, -0.3, 0, TAU); c.fill();
          c.fillStyle = 'rgba(255,255,255,0.8)'; c.fillRect(0.12, 0.27, 0.12, 0.014);
          c.fillStyle = 'rgba(7,8,26,0.35)'; c.beginPath(); c.arc(0.28, 0.29, 0.1, 0, TAU); c.fill();
          c.restore();
          c.lineWidth = 0.012; c.strokeStyle = INK; c.stroke(e);
          moonGround(c, 0.79, '#C9CCD8', '#A3A7BA', '#ECEEF5');
        },
      },
      { draw: c => stars(c, 12, 29, 0.35, 0.05, 1, 0.6, 0.012), anim: { k: 'twinkle', d: 2.4 } },
      { draw: c => stars(c, 10, 47, 0, 0.4, 0.6, 0.7, 0.011), anim: { k: 'twinkle', d: 3.1, at: 0.5 } },
    ],
    frame: goldFrame, over: GOLD_TWINKLES, glint: true,
  },
  dust_devil: {
    back: [
      {
        draw: c => {
          vsky(c, [[0, '#3A0E1C'], [0.6, '#9A3B2A'], [1, '#E07A4A']]);
          stars(c, 8, 5, 0, 0, 1, 0.35, 0.006);
          c.fillStyle = '#E8C9B8'; c.beginPath(); c.arc(0.8, 0.16, 0.035, 0, TAU); c.fill();
          c.fillStyle = '#C9A898'; c.beginPath(); c.arc(0.66, 0.1, 0.02, 0, TAU); c.fill();
          c.fillStyle = '#B04A2C'; c.beginPath(); c.moveTo(-0.1, 0.8); c.quadraticCurveTo(0.3, 0.7, 0.62, 0.79); c.quadraticCurveTo(0.85, 0.72, 1.1, 0.76); c.lineTo(1.1, 1.1); c.lineTo(-0.1, 1.1); c.fill();
          ground(c, 0.82, '#D9663A', '#F08C58');
          // The dust devil's haze, a funnel of dust the swirls turn round.
          for (const [y, r] of [[0.34, 0.17], [0.5, 0.13], [0.64, 0.09], [0.76, 0.06]] as const) glow(c, 0.23, y, r, [[0, 'rgba(255,196,150,0.5)'], [1, 'rgba(255,196,150,0)']]);
        },
      },
      // Three swirls of dust, wide at the top, each turning.
      ...([[0.23, 0.36, 0.34, 1.6], [0.23, 0.52, 0.24, 1.2], [0.23, 0.68, 0.15, 0.9]] as const).map(([x, y, s, d], i): Layer => ({
        x: x - s / 2, y: y - s / 2, w: s, h: s, tilt: 0.32,
        draw: c => particleRing(c, 18, i * 13 + 2, ['#FFE6CC', '#F2A070', '#FFFFFF'], s / 2, s / 2, s * 0.42, 0.016),
        anim: { k: 'spin', d, rev: true },
      })),
      // Dust drifting across.
      { w: 2, h: 1, draw: c => { for (let i = 0; i < 14; i++) wrap(2, 1, hash(i * 3.3) * 2, 0.45 + hash(i * 5.1) * 0.4, 0.02, (x, y) => { c.fillStyle = 'rgba(255,214,180,0.7)'; c.beginPath(); c.arc(x, y, 0.008 + 0.01 * hash(i), 0, TAU); c.fill(); }); }, anim: { k: 'scroll', d: 7, from: [0, 0], to: [-0.5, 0] } },
    ],
    frame: goldFrame, over: GOLD_TWINKLES, glint: true,
  },
  ring_leader: {
    back: [
      {
        draw: c => {
          vsky(c, [[0, '#0C0A24'], [0.6, '#2B1F52'], [1, '#5A3E7A']]);
          stars(c, 22, 17, 0, 0, 1, 0.75, 0.007);
          // The ringed giant: the back of its ring, the banded planet, the front of its ring.
          const ring = (from: number, to: number) => {
            c.lineWidth = 0.05; c.strokeStyle = '#E8CF94'; c.beginPath(); c.ellipse(0.66, 0.38, 0.36, 0.08, -0.32, from, to); c.stroke();
            c.lineWidth = 0.014; c.strokeStyle = '#B8935A'; c.beginPath(); c.ellipse(0.66, 0.38, 0.3, 0.064, -0.32, from, to); c.stroke();
          };
          ring(Math.PI, TAU);
          const pl = circlePath(0.66, 0.38, 0.2);
          c.save(); c.clip(pl);
          ([['#F2D49A', 0.18], ['#D49A4E', 0.28], ['#E8B96A', 0.34], ['#C4843E', 0.42], ['#F0C988', 0.48], ['#B87838', 0.56]] as const).forEach(([col, y]) => { c.fillStyle = col; c.fillRect(0.4, y, 0.6, 0.1); });
          c.fillStyle = 'rgba(12,10,36,0.3)'; c.beginPath(); c.arc(0.72, 0.43, 0.2, 0, TAU); c.fill();
          c.restore();
          c.lineWidth = 0.014; c.strokeStyle = INK; c.stroke(pl);
          ring(0, Math.PI);
          // An icy moon to stand on.
          ground(c, 0.8, '#BFD7EA', '#EAF4FB', 0.04);
          c.fillStyle = '#9DBBD3'; c.beginPath(); c.ellipse(0.25, 0.88, 0.06, 0.02, 0, 0, TAU); c.fill(); c.beginPath(); c.ellipse(0.78, 0.92, 0.05, 0.017, 0, 0, TAU); c.fill();
        },
      },
      // Sparkling ring particles orbiting the giant.
      { x: 0.66 - 0.42, y: 0.38 - 0.42, w: 0.84, h: 0.84, tilt: 0.24, draw: c => particleRing(c, 24, 9, ['#FFF3C2', '#FFFFFF', '#FFD98A'], 0.42, 0.42, 0.34, 0.014), anim: { k: 'spin', d: 9 } },
      { draw: c => stars(c, 10, 61, 0, 0.05, 0.5, 0.6, 0.012), anim: { k: 'twinkle', d: 2.7 } },
    ],
    frame: goldFrame,
    // Sparkles circling the frame like a ring.
    over: [...GOLD_TWINKLES, { draw: c => { c.translate(0.5, 0.5); for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; sparkle(c, Math.cos(a) * (RD + 0.035), Math.sin(a) * (RD + 0.035), i % 2 ? 0.022 : 0.032, '#FFF6D6', 0.006); } }, anim: { k: 'spin', d: 14 } }],
    glint: true,
  },
  seventh_heaven: {
    back: [
      { draw: c => { vsky(c, [[0, '#FFE6F4'], [0.55, '#FFF6E0'], [1, '#DFF2FF']]); glow(c, 0.5, 0.05, 0.6, [[0, 'rgba(255,236,160,0.9)'], [1, 'rgba(255,236,160,0)']]); } },
      // Heavenly rays from above, rocking gently.
      { draw: c => { for (let i = 0; i < 7; i++) { const a = Math.PI * (0.3 + i * 0.065); c.fillStyle = i % 2 ? 'rgba(255,214,120,0.32)' : 'rgba(255,255,255,0.55)'; c.beginPath(); c.moveTo(0.5, -0.05); c.arc(0.5, -0.05, 1.3, a, a + 0.035); c.closePath(); c.fill(); } }, anim: { k: 'sway', d: 6, deg: 7, ox: 0.5, oy: -0.05 } },
      { draw: c => { cloudFloor(c, 0.8, '#FFFFFF', '#FFE6B0'); puff(c, 0.16, 0.42, 0.07, '#FFFFFF'); puff(c, 0.84, 0.36, 0.06, '#FFFFFF'); } },
    ],
    // Seven golden sparkles.
    front: ([[0.18, 0.2, 0.05], [0.82, 0.16, 0.045], [0.1, 0.6, 0.035], [0.9, 0.58, 0.04], [0.3, 0.08, 0.03], [0.7, 0.3, 0.03], [0.5, 0.06, 0.035]] as const).map(([x, y, r], i): Layer => ({
      x: x - r, y: y - r, w: r * 2, h: r * 2, draw: c => sparkle(c, r, r, r * 0.95, '#FFD23F', r * 0.14), anim: { k: 'glitter', d: 2.1, at: i / 7 },
    })),
    frame: goldFrame, over: GOLD_TWINKLES, glint: true,
  },
  ironclad: {
    back: [
      {
        draw: c => {
          vsky(c, [[0, '#D5DDE8'], [1, '#8B97AB']]);
          // Riveted plates.
          c.strokeStyle = 'rgba(70,80,100,0.45)'; c.lineWidth = 0.012;
          for (const x of [0.33, 0.67]) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 0.8); c.stroke(); }
          c.beginPath(); c.moveTo(0, 0.4); c.lineTo(1, 0.4); c.stroke();
          for (const [x, y] of [[0.3, 0.06], [0.36, 0.06], [0.64, 0.06], [0.7, 0.06], [0.3, 0.44], [0.36, 0.44], [0.64, 0.44], [0.7, 0.44], [0.1, 0.36], [0.9, 0.36]]) {
            c.fillStyle = '#6E7A90'; c.beginPath(); c.arc(x, y, 0.014, 0, TAU); c.fill();
            c.fillStyle = '#F2F5FA'; c.beginPath(); c.arc(x - 0.004, y - 0.004, 0.006, 0, TAU); c.fill();
          }
          ground(c, 0.8, '#5B667A', '#8A96AA', 0);
          for (const x of [0.12, 0.38, 0.62, 0.88]) { c.fillStyle = '#3E4758'; c.beginPath(); c.arc(x, 0.88, 0.012, 0, TAU); c.fill(); }
        },
      },
      // A steel-rimmed heart behind the Blockling that beats.
      {
        x: 0.2, y: 0.12, w: 0.6, h: 0.6,
        draw: c => {
          const h = heart(0.3, 0.33, 0.46);
          c.lineJoin = 'round'; c.lineWidth = 0.07; c.strokeStyle = INK; c.stroke(h);
          c.lineWidth = 0.045; c.strokeStyle = '#C9D3E0'; c.stroke(h);
          c.fillStyle = '#FF4F64'; c.fill(h);
          c.fillStyle = 'rgba(255,255,255,0.45)'; c.beginPath(); c.ellipse(0.2, 0.25, 0.04, 0.022, -0.6, 0, TAU); c.fill();
        },
        anim: { k: 'beat', d: 1.6 },
      },
    ],
    frame: goldFrame, over: GOLD_TWINKLES, glint: true,
  },
  meteor_shower: {
    back: [
      {
        draw: c => {
          vsky(c, [[0, '#0B0F2E'], [0.6, '#2A1E5C'], [1, '#4A2A6E']]);
          stars(c, 22, 23, 0, 0, 1, 0.75, 0.007);
          moonGround(c, 0.8, '#8E8BA8', '#6F6C8C', '#B9B6D2');
        },
      },
      // Meteors streaking down to the left, two speeds. Tiled 2 × 2 so the loop is seamless.
      ...([[2.4, 5, 0.9], [3.8, 4, 0.6]] as const).map(([d, n, k], li): Layer => ({
        w: 2, h: 2,
        draw: c => {
          for (let i = 0; i < n; i++) {
            const x0 = hash(li * 31 + i * 3.7) * 2, y0 = hash(li * 17 + i * 5.9) * 2, len = 0.22 * k;
            wrap(2, 2, x0, y0, len + 0.05, (x, y) => {
              const g = c.createLinearGradient(x, y, x + len, y - len); g.addColorStop(0, 'rgba(255,230,190,0.95)'); g.addColorStop(1, 'rgba(255,230,190,0)');
              c.strokeStyle = g; c.lineCap = 'round'; c.lineWidth = 0.022 * k; c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y - len); c.stroke();
              c.fillStyle = '#FFF4DE'; c.beginPath(); c.arc(x, y, 0.016 * k, 0, TAU); c.fill();
            });
          }
        },
        anim: { k: 'scroll', d, from: [0, -0.5], to: [-0.5, 0] },
      })),
    ],
    frame: goldFrame, over: GOLD_TWINKLES, glint: true,
  },

  // Earned (Platinum) -------------------------------------------------------------------------
  deep_space: {
    back: [
      { draw: c => { c.fillStyle = '#09031A'; c.fillRect(0, 0, 1, 1); stars(c, 30, 41, 0, 0, 1, 1, 0.006); } },
      // The nebula, turning slowly.
      {
        draw: c => {
          for (const [x, y, r, col] of [[0.3, 0.3, 0.45, '176,63,208'], [0.75, 0.55, 0.4, '63,200,224'], [0.45, 0.75, 0.35, '255,110,180'], [0.8, 0.15, 0.25, '120,90,255']] as const) {
            glow(c, x, y, r, [[0, `rgba(${col},0.55)`], [1, `rgba(${col},0)`]]);
          }
        },
        anim: { k: 'spin', d: 40 },
      },
      // A little spiral galaxy, turning.
      {
        x: 0.08, y: 0.1, w: 0.34, h: 0.34, tilt: 0.55,
        draw: c => {
          const m = 0.17;
          glow(c, m, m, m, [[0, 'rgba(255,240,255,0.95)'], [0.25, 'rgba(255,170,240,0.55)'], [1, 'rgba(255,170,240,0)']]);
          c.fillStyle = 'rgba(255,255,255,0.9)';
          for (let arm = 0; arm < 2; arm++) for (let i = 0; i < 24; i++) { const t = i / 24, a = arm * Math.PI + t * 4.2, r = m * (0.08 + t * 0.85); c.beginPath(); c.arc(m + Math.cos(a) * r, m + Math.sin(a) * r, m * (0.07 * (1 - t) + 0.02), 0, TAU); c.fill(); }
        },
        anim: { k: 'spin', d: 12 },
      },
      { draw: c => stars(c, 14, 73, 0, 0, 1, 1, 0.012, '#FFF0FF'), anim: { k: 'twinkle', d: 2.2 } },
      { draw: c => { glow(c, 0.5, 0.82, 0.3, [[0, 'rgba(200,140,255,0.7)'], [1, 'rgba(200,140,255,0)']]); } },
    ],
    float: true,
    under: [PLAT_GOLD], rim: [PLAT_RIM],
    frame: platinumFrame('gem'), over: PLAT_TWINKLES, glint: true,
  },
  golden_crown: {
    back: [
      { draw: c => glow(c, 0.5, 0.5, 0.75, [[0, '#FFF6D0'], [0.4, '#FFD45A'], [1, '#E0861E']]) },
      { draw: c => rays(c, 0.5, 0.5, 18, 'rgba(255,255,255,0.28)'), anim: { k: 'spin', d: 18 } },
      {
        draw: c => {
          // A royal carpet with gold trim.
          ground(c, 0.8, '#C8243C', '#FFD45A', 0);
          c.fillStyle = '#9E1A30'; c.fillRect(-0.1, 0.9, 1.2, 0.2);
          c.fillStyle = '#FFD45A'; c.fillRect(-0.1, 0.885, 1.2, 0.015);
        },
      },
    ],
    // Gold confetti falling.
    front: [{
      w: 1, h: 2,
      draw: c => {
        const cols = ['#FFE08A', '#FFFFFF', '#FFC23D', '#FF8FA3'];
        for (let i = 0; i < 16; i++) wrap(1, 2, hash(i * 2.9), hash(i * 6.1) * 2, 0.03, (x, y) => {
          c.save(); c.translate(x, y); c.rotate(hash(i * 4.4) * TAU); c.fillStyle = cols[i % cols.length]; c.fillRect(-0.016, -0.007, 0.032, 0.014); c.restore();
        });
      },
      anim: { k: 'scroll', d: 6, from: [0, -0.5], to: [0, 0] },
    }],
    under: [PLAT_GOLD], rim: [PLAT_RIM],
    frame: platinumFrame('crown'), over: PLAT_TWINKLES, glint: true,
  },

  // Shop ---------------------------------------------------------------------------------------
  bubblegum: {
    back: [{
      draw: c => {
        vsky(c, [[0, '#FFC2E1'], [1, '#FF9FD0']]);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { c.fillStyle = (x + y) % 3 ? 'rgba(255,255,255,0.55)' : 'rgba(255,95,174,0.5)'; c.beginPath(); c.arc((x + (y % 2) * 0.5) / 6, y / 6 + 0.04, 0.03, 0, TAU); c.fill(); }
        ground(c, 0.8, '#FF5FAE', '#FFB3D9', 0.015);
      },
    }],
    frame: bandFrame('#FF7FBF', '#FFC2E1', '#D9529A'),
  },
  checkers: {
    back: [{
      draw: c => {
        const n = 6;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { c.fillStyle = (x + y) % 2 ? '#2EC4B6' : '#CBF3EC'; c.fillRect(x / n, y / n, 1 / n + 0.001, 1 / n + 0.001); }
        vsky(c, [[0, 'rgba(255,255,255,0.25)'], [0.7, 'rgba(255,255,255,0)']]);
        ground(c, 0.8, '#1E8F84', '#5FD8C8', 0.015);
      },
    }],
    frame: bandFrame('#2EC4B6', '#9AEFE5', '#1E8F84'),
  },
  retro: {
    back: [{
      draw: c => {
        vsky(c, [[0, '#2B1055'], [0.5, '#C2378F'], [0.78, '#FF9F43']]);
        // The striped sun.
        c.save(); c.beginPath(); c.rect(0, 0, 1, 0.56);
        for (let i = 0; i < 4; i++) c.rect(0, 0.56 + i * 0.055 + i * 0.006, 1, 0.04 - i * 0.006);
        c.clip();
        const g = c.createLinearGradient(0, 0.36, 0, 0.78); g.addColorStop(0, '#FFE45C'); g.addColorStop(1, '#FF4FA2');
        c.fillStyle = g; c.beginPath(); c.arc(0.5, 0.6, 0.25, 0, TAU); c.fill();
        c.restore();
        // A neon grid floor.
        c.fillStyle = '#1A0B3A'; c.fillRect(0, 0.78, 1, 0.3);
        c.strokeStyle = '#FF4FD8'; c.lineWidth = 0.01;
        for (let i = 0; i < 5; i++) { const y = 0.78 + 0.25 * (i / 5) ** 1.7; c.beginPath(); c.moveTo(0, y); c.lineTo(1, y); c.stroke(); }
        for (let i = -6; i <= 6; i++) { c.beginPath(); c.moveTo(0.5 + i * 0.03, 0.78); c.lineTo(0.5 + i * 0.22, 1.05); c.stroke(); }
      },
    }],
    frame: bandFrame('#FF5FA2', '#FFB0D0', '#C23A78'),
  },
  rainbow: {
    back: [
      {
        draw: c => {
          const cols = ['#FF5E7E', '#FFB347', '#FFE45C', '#7CE07C', '#5EC8FF', '#9B7CFF', '#FF5E7E'], n = 120;
          for (let i = 0; i < n; i++) {
            const t = (i / n) * (cols.length - 1), k = Math.floor(t), a = (i / n) * TAU;
            c.fillStyle = mix(cols[k], cols[k + 1], t - k); c.beginPath(); c.moveTo(0.5, 0.5); c.arc(0.5, 0.5, 0.75, a, a + TAU / n + 0.01); c.closePath(); c.fill();
          }
        },
        anim: { k: 'spin', d: 10 },
      },
      { draw: c => { glow(c, 0.5, 0.5, 0.55, [[0, 'rgba(255,255,255,0.85)'], [0.5, 'rgba(255,255,255,0.35)'], [1, 'rgba(255,255,255,0)']]); cloudFloor(c, 0.81); } },
    ],
    front: ([[0.18, 0.22, 0.05], [0.84, 0.3, 0.04], [0.74, 0.1, 0.03]] as const).map(([x, y, r], i): Layer => ({
      x: x - r, y: y - r, w: r * 2, h: r * 2, draw: c => sparkle(c, r, r, r * 0.95), anim: { k: 'glitter', d: 1.8, at: i / 3 },
    })),
    frame: bandFrame(c => { const g = c.createLinearGradient(-0.5, -0.5, 0.5, 0.5); ['#FF5E7E', '#FFB347', '#FFE45C', '#7CE07C', '#5EC8FF', '#9B7CFF'].forEach((col, i) => g.addColorStop(i / 5, col)); return g; }, '#FFFFFF', 'rgba(60,40,120,0.4)'),
  },
  lava_lamp: {
    back: [
      { draw: c => { vsky(c, [[0, '#2A0B3D'], [1, '#7A1F5E']]); glow(c, 0.5, 0.9, 0.6, [[0, 'rgba(255,140,60,0.5)'], [1, 'rgba(255,140,60,0)']]); } },
      // Blobs rising, two speeds, tiled 1 × 2.
      ...([[11, 5, 0.11, ['#FF7A3D', '#FF4F9A']], [7, 6, 0.065, ['#FFC93A', '#FF8A4D']]] as const).map(([d, n, r0, cols], li): Layer => ({
        w: 1, h: 2,
        draw: c => {
          for (let i = 0; i < n; i++) {
            const r = r0 * (0.7 + 0.6 * hash(li * 9 + i * 2.1));
            wrap(1, 2, 0.1 + hash(li * 7 + i * 3.3) * 0.8, hash(li * 5 + i * 4.7) * 2, r * 1.3, (x, y) => {
              const g = c.createRadialGradient(x - r * 0.3, y - r * 0.4, 0, x, y, r * 1.2);
              g.addColorStop(0, '#FFE8B0'); g.addColorStop(0.35, cols[i % 2]); g.addColorStop(1, cols[(i + 1) % 2]);
              c.fillStyle = g; c.beginPath(); c.ellipse(x, y, r, r * 1.2, 0, 0, TAU); c.fill();
            });
          }
        },
        anim: { k: 'scroll', d, from: [0, 0], to: [0, -0.5] },
      })),
      // The lamp's base under the Blockling.
      { draw: c => { const g = c.createLinearGradient(0, 0.8, 0, 1); g.addColorStop(0, '#5A4A78'); g.addColorStop(1, '#2B2140'); c.fillStyle = g; c.fillRect(0, 0.8, 1, 0.3); c.fillStyle = '#9A8AC0'; c.fillRect(0, 0.8, 1, 0.014); } },
    ],
    frame: bandFrame('#FF7A3D', '#FFC09A', '#C2481A'),
  },
  disco: {
    back: [
      { draw: c => vsky(c, [[0, '#1A0B3A'], [1, '#3A1466']]) },
      // Light spots swinging round the room.
      {
        draw: c => {
          const cols = ['255,95,174', '94,200,255', '255,228,92', '155,124,255'];
          for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU, r = 0.18 + 0.28 * hash(i * 3.9); c.fillStyle = `rgba(${cols[i % 4]},0.55)`; c.beginPath(); c.arc(0.5 + Math.cos(a) * r, 0.5 + Math.sin(a) * r, 0.035 + 0.025 * hash(i * 1.3), 0, TAU); c.fill(); }
        },
        anim: { k: 'spin', d: 7 },
      },
      {
        draw: c => {
          // The mirror ball, top right, on its string.
          c.strokeStyle = '#B9B2DE'; c.lineWidth = 0.01; c.beginPath(); c.moveTo(0.78, -0.05); c.lineTo(0.78, 0.06); c.stroke();
          const b = circlePath(0.78, 0.16, 0.1);
          const g = c.createRadialGradient(0.75, 0.13, 0, 0.78, 0.16, 0.1); g.addColorStop(0, '#FFFFFF'); g.addColorStop(1, '#8E98AB');
          c.fillStyle = g; c.fill(b);
          c.save(); c.clip(b); c.strokeStyle = 'rgba(60,70,100,0.5)'; c.lineWidth = 0.006;
          for (let i = -4; i <= 4; i++) { c.beginPath(); c.moveTo(0.68, 0.16 + i * 0.025); c.lineTo(0.88, 0.16 + i * 0.025); c.stroke(); c.beginPath(); c.moveTo(0.78 + i * 0.025, 0.06); c.lineTo(0.78 + i * 0.025, 0.26); c.stroke(); }
          c.restore();
          c.lineWidth = 0.012; c.strokeStyle = INK; c.stroke(b);
          // A dance floor of colored tiles.
          const cols = ['#FF5FAE', '#5EC8FF', '#FFE45C', '#9B7CFF'];
          for (let x = 0; x < 6; x++) for (let y = 0; y < 2; y++) { c.fillStyle = cols[(x + y * 2) % 4]; c.fillRect(x / 6, 0.8 + y * 0.1, 1 / 6 + 0.002, 0.1 + 0.002); }
          c.strokeStyle = '#1A0B3A'; c.lineWidth = 0.008; for (let x = 1; x < 6; x++) { c.beginPath(); c.moveTo(x / 6, 0.8); c.lineTo(x / 6, 1); c.stroke(); } c.beginPath(); c.moveTo(0, 0.9); c.lineTo(1, 0.9); c.stroke();
        },
      },
      // Half the tiles flash.
      { draw: c => { for (let x = 0; x < 6; x++) for (let y = 0; y < 2; y++) if ((x + y) % 2) { c.fillStyle = 'rgba(255,255,255,0.65)'; c.fillRect(x / 6 + 0.005, 0.805 + y * 0.1, 1 / 6 - 0.01, 0.09); } }, anim: { k: 'twinkle', d: 0.9 } },
    ],
    front: ([[0.72, 0.1, 0.04], [0.86, 0.22, 0.03]] as const).map(([x, y, r], i): Layer => ({
      x: x - r, y: y - r, w: r * 2, h: r * 2, draw: c => sparkle(c, r, r, r * 0.95), anim: { k: 'glitter', d: 1.3, at: i / 2 },
    })),
    frame: bandFrame('#D9DEEA', '#FFFFFF', '#8E98AB', c => {
      // Mirror tiles round the band.
      c.strokeStyle = 'rgba(80,90,120,0.55)'; c.lineWidth = 0.008;
      for (let i = 0; i < 28; i++) { const a = (i / 28) * TAU; c.beginPath(); c.moveTo(Math.cos(a) * (RD - 0.01), Math.sin(a) * (RD - 0.01)); c.lineTo(Math.cos(a) * (RD + 0.05), Math.sin(a) * (RD + 0.05)); c.stroke(); }
    }),
  },

  // Supporter Pack ----------------------------------------------------------------------------
  supporter: {
    back: [
      { draw: c => { glow(c, 0.5, 0.55, 0.75, [[0, '#FFF4D6'], [0.45, '#FFC2D4'], [1, '#FF8FB0']]); } },
      // Hearts floating up, tiled 1 × 2.
      {
        w: 1, h: 2,
        draw: c => {
          const cols = ['#FF4F64', '#FF9DB8', '#FFFFFF'];
          for (let i = 0; i < 9; i++) {
            const k = 0.07 + 0.06 * hash(i * 2.2);
            wrap(1, 2, 0.08 + hash(i * 3.7) * 0.84, hash(i * 6.3) * 2, k, (x, y) => {
              const h = heart(x, y, k); c.fillStyle = cols[i % 3]; c.fill(h); c.lineJoin = 'round'; c.lineWidth = 0.01; c.strokeStyle = 'rgba(34,24,58,0.6)'; c.stroke(h);
            });
          }
        },
        anim: { k: 'scroll', d: 8, from: [0, 0], to: [0, -0.5] },
      },
      { draw: c => { const g = c.createLinearGradient(0, 0.8, 0, 1); g.addColorStop(0, '#F7B996'); g.addColorStop(1, '#D98A6A'); ground(c, 0.8, '#E9A27D', '#FFD6C2', 0.015); c.fillStyle = g; c.fillRect(0, 0.86, 1, 0.2); } },
    ],
    frame: bandFrame('#F2A98A', '#FFD6C2', '#C97B5E', c => {
      // A heart badge at the bottom of the band.
      const h = heart(0, RD + 0.005, 0.17);
      c.lineJoin = 'round'; c.lineWidth = 0.04; c.strokeStyle = INK; c.stroke(h);
      c.fillStyle = '#FF4F64'; c.fill(h);
      c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.ellipse(-0.03, RD - 0.025, 0.018, 0.01, -0.6, 0, TAU); c.fill();
    }),
  },
};

// ---------------------------------------------------------------------------------------------
// Baking and the DOM

const DPR = (): number => (typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1);
const idOf = (id: string): PortraitId => (Object.prototype.hasOwnProperty.call(STYLES, id) ? id as PortraitId : 'meadow');
/** The disc's size in px for a `px` box. */
const discPx = (px: number): number => Math.round(px * RD * 2);

/** Draws a layer at its place (its top-left at (ox, oy) px), as it stands before it moves. `unit` is px per layer unit. */
function drawLayer(c: Ctx, L: Layer, unit: number, ox: number, oy: number): void {
  const w = (L.w ?? 1) * unit, h = (L.h ?? 1) * unit, a = L.anim;
  c.save(); c.translate(ox + (L.x ?? 0) * unit, oy + (L.y ?? 0) * unit);
  if (L.tilt) { c.translate(0, h / 2); c.scale(1, L.tilt); c.translate(0, -h / 2); }
  if (a?.k === 'scroll') c.translate(a.from[0] * w, a.from[1] * h);
  c.scale(unit, unit);
  L.draw(c);
  c.restore();
}

function bakeLayer(L: Layer, unit: number): HTMLCanvasElement {
  const cv = makeCanvas((L.w ?? 1) * unit, (L.h ?? 1) * unit), c = ctx2d(cv);
  c.scale(unit, unit); L.draw(c);
  return cv;
}

function bakeFrame(st: Style, px: number): HTMLCanvasElement {
  const cv = makeCanvas(px, px), c = ctx2d(cv);
  c.translate(px / 2, px / 2); c.scale(px, px); st.frame(c);
  return cv;
}

function bakeFigure(a: AvatarSpec, D: number): HTMLCanvasElement {
  const cv = makeCanvas(D, D);
  drawAvatarFigure(ctx2d(cv), a, D);
  return cv;
}

const figKey = (a: AvatarSpec, D: number): string => `ptfig:${a.shape ?? 'O'}:${a.face ?? 'idle'}:${a.hat ?? ''}:${D}`;

/** The whole portrait, still, `px` square. */
export function bakePortrait(id: string, a: AvatarSpec, px: number): HTMLCanvasElement {
  const st = STYLES[idOf(id)], D = discPx(px), off = (px - D) / 2, cv = makeCanvas(px, px), c = ctx2d(cv);
  for (const L of st.under ?? []) drawLayer(c, L, px, 0, 0);
  c.save(); c.beginPath(); c.arc(px / 2, px / 2, D / 2, 0, TAU); c.clip();
  for (const L of st.back) drawLayer(c, L, D, off, off);
  c.drawImage(bakeFigure(a, D), off, off);
  for (const L of st.front ?? []) drawLayer(c, L, D, off, off);
  c.restore();
  for (const L of st.rim ?? []) drawLayer(c, L, px, 0, 0);
  c.save(); c.translate(px / 2, px / 2); c.scale(px, px); st.frame(c); c.restore();
  for (const L of st.over ?? []) drawLayer(c, L, px, 0, 0);
  return cv;
}

/** A still PNG of the portrait (its first frame), `cssPx` square at the device's resolution, as a cached data URL. */
export function portraitUrl(id: string, a: AvatarSpec = {}, cssPx = 48, dpr = DPR()): string {
  const px = Math.round(cssPx * dpr), pid = idOf(id);
  return canvasUrl(`pt:${pid}:${a.shape ?? 'O'}:${a.face ?? 'idle'}:${a.hat ?? ''}:${px}`, () => bakePortrait(pid, a, px));
}

const pc = (v: number): string => `${+(v * 100).toFixed(3)}%`;

function animAttrs(a: Anim | undefined): { cls: string; css: string } {
  if (!a) return { cls: '', css: '' };
  const d = `--d:${a.d}s;`;
  switch (a.k) {
    case 'spin': return { cls: `ui-pt-spin${a.rev ? ' rev' : ''}`, css: d };
    case 'scroll': {
      const f = `translate(${pc(a.from[0])},${pc(a.from[1])})`, t = `translate(${pc(a.to[0])},${pc(a.to[1])})`;
      return { cls: 'ui-pt-scroll', css: `${d}--f:${f};--t:${t};transform:${f};` };
    }
    case 'twinkle': return { cls: 'ui-pt-twinkle', css: `${d}animation-delay:${-(a.at ?? 0) * a.d}s;` };
    case 'glitter': return { cls: 'ui-pt-glitter', css: `${d}animation-delay:${-(a.at ?? 0) * a.d}s;` };
    case 'bob': return { cls: 'ui-pt-bob', css: `${d}--a:${pc(-a.amp)};` };
    case 'beat': return { cls: 'ui-pt-beat', css: d };
    case 'sway': return { cls: 'ui-pt-sway', css: `${d}--g:${a.deg}deg;transform-origin:${pc(a.ox)} ${pc(a.oy)};` };
  }
}

/** One layer as an <img>, placed in % of its parent (the disc or the box), wrapped in a squashing span when tilted. */
function layerHtml(L: Layer, key: string, unit: number): string {
  const src = canvasBlobUrl(key, () => bakeLayer(L, unit)), { cls, css } = animAttrs(L.anim);
  const box = `left:${pc(L.x ?? 0)};top:${pc(L.y ?? 0)};width:${pc(L.w ?? 1)};height:${pc(L.h ?? 1)};`;
  if (L.tilt) return `<span class="ui-pt-tilt" style="${box}transform:scaleY(${L.tilt})"><img class="ui-pt-l ${cls}" alt="" src="${src}" style="left:0;top:0;width:100%;height:100%;${css}"></span>`;
  return `<img class="ui-pt-l ${cls}" alt="" src="${src}" style="${box}${css}">`;
}

let glints = 0;

/**
 * A portrait as HTML: a `.ui-portrait` element `cssPx` square, the player's avatar in the style `id`
 * (unknown ids show Meadow). Animated styles move by CSS alone and hold still under `still` (Reduce
 * Motion in the game's settings) or the OS's Reduce Motion, where they look like portraitUrl's PNG.
 * The images are cached blob URLs, so twenty rows of one style cost one set of images.
 */
export function portraitHtml(id: string, a: AvatarSpec = {}, cssPx = 48, o: { still?: boolean } = {}): string {
  const pid = idOf(id), st = STYLES[pid], art = PORTRAIT_ART.find(p => p.id === pid)!, px = Math.round(cssPx * DPR()), D = discPx(px);
  const k = (part: string, i: number) => `pt:${pid}:${part}${i}:${px}`;
  const fig = canvasBlobUrl(figKey(a, D), () => bakeFigure(a, D));
  const figCss = st.float ? animAttrs({ k: 'bob', d: 3.2, amp: 0.035 }) : { cls: '', css: '' };
  const glint = st.glint ? `<span class="ui-pt-glint"><i style="animation-delay:${-((glints++ * 1.37) % 4.2).toFixed(2)}s"></i></span>` : '';
  return `<span class="ui ui-portrait ${art.kind}${o.still ? ' ui-still' : ''}" data-portrait="${pid}" role="img" aria-label="${art.name} portrait" style="--s:${cssPx}px">`
    + (st.under ?? []).map((L, i) => layerHtml(L, k('u', i), px)).join('')
    + `<span class="ui-pt-disc">${st.back.map((L, i) => layerHtml(L, k('b', i), D)).join('')}`
    + `<img class="ui-pt-l ui-pt-fig ${figCss.cls}" alt="" src="${fig}" style="left:0;top:0;width:100%;height:100%;${figCss.css}">`
    + `${(st.front ?? []).map((L, i) => layerHtml(L, k('f', i), D)).join('')}</span>`
    + (st.rim ?? []).map((L, i) => layerHtml(L, k('r', i), px)).join('')
    + `<img class="ui-pt-l ui-pt-frame" alt="" src="${canvasBlobUrl(k('frame', 0), () => bakeFrame(st, px))}" style="left:0;top:0;width:100%;height:100%">`
    + (st.over ?? []).map((L, i) => layerHtml(L, k('o', i), px)).join('')
    + glint + '</span>';
}

/** portraitHtml as an element. */
export function portraitElement(id: string, a: AvatarSpec = {}, cssPx = 48, o: { still?: boolean } = {}): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = portraitHtml(id, a, cssPx, o);
  return t.content.firstElementChild as HTMLElement;
}
