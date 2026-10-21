// The UI icon set (art-direction.md §9.6). Two kinds, both stickers: controls (pause, back, rotate...)
// are solid Ink glyphs so they read at a glance on Paper buttons, and things (trophy, heart, brick...)
// are colored with a light lip and an Ink outline, like the power-up icons. Each draws in a unit box
// centred on the origin. Use uiIconUrl() for the DOM, or drawUiIcon() to paint into a canvas.

import { INK, PAPER, SIGNAL } from '../config.ts';
import { ART_SHAPES } from '../shapes.ts';
import { O, circlePath, heart, ink, part, rrPath, turn, twinkle } from '../sticker.ts';
import { type Ctx, TAU, ctx2d, makeCanvas } from '../util.ts';

export const UI_ICONS = [
  'pause', 'play', 'settings', 'sound', 'mute', 'music', 'haptics', 'close', 'back', 'share', 'info', 'home', 'restart',
  'rotate_l', 'rotate_r', 'drop', 'check',
  'profile', 'trophy', 'crown', 'flag', 'star', 'lock', 'heart', 'brick', 'hold', 'daily', 'zen', 'xp', 'gift',
  'stats', 'tower', 'biome', 'streak', 'perfect', 'row', 'clutch', 'score',
  'wind', 'junk', 'meteor', 'swirl', 'plumb',
] as const;
export type UiIcon = (typeof UI_ICONS)[number];

const GOLD = ['#FFC23D', '#FFE08A', '#D9971A'] as const;
const STONE = ['#B9B1A6', '#DDD7CE', '#8E867B'] as const;
const VIOLET = [SIGNAL.xp, '#B9A8FF', '#5236D6'] as const;
const RED = [SIGNAL.danger, '#FF8FA3', '#CC2E48'] as const;
const MINT = [SIGNAL.mint, '#B4FADF', '#1FB884'] as const;
const PAPERS = [PAPER, '#FFFFFF', '#E9DCC4'] as const;
type Tri = readonly [string, string, string];
const fill = (c: Ctx, p: Path2D, t: Tri, lip?: number) => part(c, p, t[0], t[1], t[2], lip);

/** A solid Ink glyph, its corners rounded by a matching stroke. */
function glyph(c: Ctx, p: Path2D, round = 0.05): void {
  c.fillStyle = INK; c.fill(p);
  if (round) { c.lineJoin = 'round'; c.lineWidth = round; c.strokeStyle = INK; c.stroke(p); }
}

/** A thick Ink line (open strokes: arcs, waves). */
function line(c: Ctx, p: Path2D, w: number, col = INK): void {
  c.lineJoin = 'round'; c.lineCap = 'round'; c.lineWidth = w; c.strokeStyle = col; c.stroke(p);
}

/** A colored line with an Ink outline around it. */
function tube(c: Ctx, p: Path2D, w: number, col: string): void { line(c, p, w + O * 2); line(c, p, w, col); }

function poly(pts: [number, number][]): Path2D {
  const p = new Path2D(); pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); return p;
}

function starPath(x: number, y: number, R: number, r: number, n = 5): Path2D {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n, d = i % 2 ? r : R; pts.push([x + Math.cos(a) * d, y + Math.sin(a) * d]); }
  return poly(pts);
}

/** A circular arrow: an arc from a0 to a1 (radians, clockwise) with a head at a1. */
function curlArrow(c: Ctx, r: number, a0: number, a1: number): void {
  const p = new Path2D(); p.arc(0, 0, r, a0, a1); line(c, p, 0.11);
  const hx = Math.cos(a1) * r, hy = Math.sin(a1) * r, tx = -Math.sin(a1), ty = Math.cos(a1), nx = Math.cos(a1), ny = Math.sin(a1), L = 0.17;
  glyph(c, poly([[hx + tx * L, hy + ty * L], [hx + nx * L * 0.85, hy + ny * L * 0.85], [hx - nx * L * 0.85, hy - ny * L * 0.85]]), 0.06);
}

function speaker(c: Ctx): void {
  glyph(c, poly([[-0.34, -0.11], [-0.2, -0.11], [-0.02, -0.28], [-0.02, 0.28], [-0.2, 0.11], [-0.34, 0.11]]), 0.07);
}

/** A cell of a piece at (x, y), u wide, in shape key's colors. */
function cell(c: Ctx, key: string, x: number, y: number, u: number): void {
  const s = ART_SHAPES[key];
  part(c, rrPath(x, y, u, u, u * 0.22), s.base, s.light, s.shade, u * 0.16);
}

function eyes(c: Ctx, x: number, y: number, gap: number, r: number): void {
  c.fillStyle = INK;
  for (const sx of [-1, 1]) { c.beginPath(); c.ellipse(x + sx * gap, y, r * 0.8, r, 0, 0, TAU); c.fill(); }
  c.fillStyle = '#FFFFFF';
  for (const sx of [-1, 1]) { c.beginPath(); c.arc(x + sx * gap - r * 0.25, y - r * 0.4, r * 0.32, 0, TAU); c.fill(); }
}

const DRAW: Record<UiIcon, (c: Ctx) => void> = {
  pause: c => { glyph(c, rrPath(-0.24, -0.3, 0.17, 0.6, 0.06)); glyph(c, rrPath(0.07, -0.3, 0.17, 0.6, 0.06)); },
  play: c => glyph(c, poly([[-0.2, -0.32], [0.32, 0], [-0.2, 0.32]]), 0.1),
  settings: c => {
    const p = new Path2D(), n = 8;
    for (let i = 0; i < n * 4; i++) {
      const a = (i / (n * 4)) * TAU, d = (i % 4 < 2) ? 0.42 : 0.31;
      i ? p.lineTo(Math.cos(a) * d, Math.sin(a) * d) : p.moveTo(Math.cos(a) * d, Math.sin(a) * d);
    }
    p.closePath(); p.arc(0, 0, 0.13, 0, TAU);
    c.fillStyle = INK; c.fill(p, 'evenodd'); c.lineJoin = 'round'; c.lineWidth = 0.05; c.strokeStyle = INK; c.stroke(p);
  },
  sound: c => {
    speaker(c);
    for (const r of [0.15, 0.29]) { const p = new Path2D(); p.arc(0.02, 0, r, -0.85, 0.85); line(c, p, 0.08); }
  },
  mute: c => {
    speaker(c);
    const p = new Path2D(); p.moveTo(0.1, -0.12); p.lineTo(0.34, 0.12); p.moveTo(0.34, -0.12); p.lineTo(0.1, 0.12); line(c, p, 0.09);
  },
  music: c => {
    glyph(c, poly([[-0.16, -0.24], [0.3, -0.36], [0.3, -0.22], [-0.16, -0.1]]), 0.05);
    const st = new Path2D(); st.moveTo(-0.13, -0.2); st.lineTo(-0.13, 0.2); st.moveTo(0.27, -0.3); st.lineTo(0.27, 0.1); line(c, st, 0.08);
    c.fillStyle = INK;
    for (const [x, y] of [[-0.23, 0.22], [0.17, 0.12]]) { c.beginPath(); c.ellipse(x, y, 0.13, 0.1, -0.4, 0, TAU); c.fill(); }
  },
  haptics: c => {
    fill(c, rrPath(-0.15, -0.32, 0.3, 0.64, 0.08), PAPERS);
    c.fillStyle = INK; c.beginPath(); c.arc(0, 0.22, 0.035, 0, TAU); c.fill();
    for (const sx of [-1, 1]) {
      const p = new Path2D(); p.moveTo(sx * 0.27, -0.16); p.lineTo(sx * 0.35, -0.08); p.lineTo(sx * 0.27, 0); p.lineTo(sx * 0.35, 0.08); p.lineTo(sx * 0.27, 0.16);
      line(c, p, 0.06);
    }
  },
  close: c => { const b = rrPath(-0.34, -0.075, 0.68, 0.15, 0.075); glyph(c, turn(b, 45, 0, 0), 0); glyph(c, turn(b, -45, 0, 0), 0); },
  back: c => glyph(c, poly([[-0.34, 0], [-0.04, -0.3], [-0.04, -0.11], [0.32, -0.11], [0.32, 0.11], [-0.04, 0.11], [-0.04, 0.3]]), 0.08),
  share: c => {
    const box = new Path2D(); box.moveTo(-0.12, -0.08); box.lineTo(-0.28, -0.08); box.lineTo(-0.28, 0.34); box.lineTo(0.28, 0.34); box.lineTo(0.28, -0.08); box.lineTo(0.12, -0.08);
    line(c, box, 0.08);
    glyph(c, poly([[0, -0.4], [0.17, -0.22], [0.06, -0.22], [0.06, 0.14], [-0.06, 0.14], [-0.06, -0.22], [-0.17, -0.22]]), 0.06);
  },
  info: c => {
    c.fillStyle = INK; c.beginPath(); c.arc(0, 0, 0.4, 0, TAU); c.fill();
    c.fillStyle = PAPER; c.beginPath(); c.arc(0, -0.19, 0.065, 0, TAU); c.fill();
    c.fill(rrPath(-0.055, -0.07, 0.11, 0.33, 0.05));
  },
  home: c => {
    fill(c, rrPath(-0.26, -0.06, 0.52, 0.4, 0.05), PAPERS);
    c.fillStyle = INK; c.fill(rrPath(-0.07, 0.1, 0.14, 0.24, 0.04));
    fill(c, poly([[-0.4, 0.0], [0, -0.38], [0.4, 0.0]]), RED, 0.05);
  },
  restart: c => curlArrow(c, 0.27, -Math.PI * 0.35, Math.PI * 1.35),
  rotate_l: c => { c.scale(-1, 1); curlArrow(c, 0.26, -Math.PI * 0.85, Math.PI * 0.55); },
  rotate_r: c => curlArrow(c, 0.26, -Math.PI * 0.85, Math.PI * 0.55),
  drop: c => {
    glyph(c, poly([[-0.07, -0.38], [0.07, -0.38], [0.07, 0.0], [0.2, 0.0], [0, 0.2], [-0.2, 0.0], [-0.07, 0.0]]), 0.06);
    glyph(c, rrPath(-0.3, 0.26, 0.6, 0.1, 0.05));
  },
  check: c => { const p = new Path2D(); p.moveTo(-0.28, 0.02); p.lineTo(-0.08, 0.22); p.lineTo(0.3, -0.2); tube(c, p, 0.12, SIGNAL.mint); },

  profile: c => {
    const s = ART_SHAPES.O;
    part(c, rrPath(-0.34, -0.32, 0.68, 0.64, 0.14), s.base, s.light, s.shade, 0.07);
    c.fillStyle = 'rgba(255,255,255,0.5)'; c.fill(rrPath(-0.25, -0.22, 0.16, 0.07, 0.035));
    eyes(c, 0, -0.02, 0.12, 0.06);
    c.strokeStyle = INK; c.lineWidth = 0.045; c.lineCap = 'round'; c.beginPath(); c.arc(0, 0.08, 0.08, 0.35, Math.PI - 0.35); c.stroke();
  },
  trophy: c => {
    for (const sx of [-1, 1]) { const p = new Path2D(); p.arc(sx * 0.25, -0.14, 0.1, sx > 0 ? -1.4 : Math.PI - 1.7, sx > 0 ? 1.7 : Math.PI + 1.4); tube(c, p, 0.05, GOLD[0]); }
    fill(c, rrPath(-0.07, 0.04, 0.14, 0.2, 0.02), GOLD, 0.03);
    fill(c, rrPath(-0.22, 0.2, 0.44, 0.15, 0.05), [INK, '#4A3F66', INK], 0.03);
    const cup = new Path2D(); cup.moveTo(-0.27, -0.34); cup.lineTo(0.27, -0.34); cup.lineTo(0.24, -0.1); cup.quadraticCurveTo(0.18, 0.1, 0, 0.1); cup.quadraticCurveTo(-0.18, 0.1, -0.24, -0.1); cup.closePath();
    fill(c, cup, GOLD);
    c.fillStyle = '#FFFFFF'; c.fill(starPath(0, -0.14, 0.09, 0.04));
  },
  crown: c => {
    fill(c, poly([[-0.32, 0.22], [-0.36, -0.2], [-0.16, -0.02], [0, -0.3], [0.16, -0.02], [0.36, -0.2], [0.32, 0.22]]), GOLD, 0.05);
    for (const [x, y] of [[-0.36, -0.22], [0, -0.32], [0.36, -0.22]]) { const p = circlePath(x, y, 0.055); c.fillStyle = '#FFFFFF'; c.fill(p); ink(c, p, O * 0.8); }
    for (const [x, col] of [[-0.17, SIGNAL.danger], [0, '#4A72FF'], [0.17, SIGNAL.mint]] as [number, string][]) { const p = circlePath(x, 0.1, 0.05); c.fillStyle = col; c.fill(p); ink(c, p, O * 0.7); }
  },
  flag: c => {
    fill(c, rrPath(-0.3, -0.38, 0.07, 0.76, 0.035), STONE, 0.02);
    const cloth = new Path2D(); cloth.moveTo(-0.23, -0.34); cloth.quadraticCurveTo(0.04, -0.42, 0.34, -0.3); cloth.lineTo(0.3, 0.02); cloth.quadraticCurveTo(0.02, -0.08, -0.23, 0.0); cloth.closePath();
    fill(c, cloth, GOLD);
    c.fillStyle = '#FFFFFF'; c.fill(starPath(0.05, -0.16, 0.09, 0.04));
  },
  star: c => fill(c, starPath(0, 0.03, 0.42, 0.19), GOLD, 0.07),
  lock: c => {
    const sh = new Path2D(); sh.moveTo(-0.15, -0.02); sh.lineTo(-0.15, -0.16); sh.arc(0, -0.16, 0.15, Math.PI, 0); sh.lineTo(0.15, -0.02);
    tube(c, sh, 0.07, STONE[0]);
    fill(c, rrPath(-0.27, -0.06, 0.54, 0.42, 0.09), GOLD);
    c.fillStyle = INK; c.beginPath(); c.arc(0, 0.1, 0.055, 0, TAU); c.fill(); c.fill(rrPath(-0.025, 0.1, 0.05, 0.13, 0.02));
  },
  heart: c => fill(c, heart(0, 0.04, 0.82), RED, 0.07),
  brick: c => {
    const b = rrPath(-0.38, -0.21, 0.76, 0.42, 0.06);
    part(c, b, '#D2694A', '#F09A7C', '#A3452C');
    c.save(); c.clip(b);
    const m = new Path2D(); m.moveTo(-0.4, 0); m.lineTo(0.4, 0); m.moveTo(-0.05, -0.22); m.lineTo(-0.05, 0); m.moveTo(-0.22, 0); m.lineTo(-0.22, 0.22); m.moveTo(0.14, 0); m.lineTo(0.14, 0.22);
    line(c, m, 0.04, 'rgba(255,235,215,0.85)'); c.restore();
    ink(c, b);
  },
  hold: c => {
    const u = 0.17;
    for (const [x, y] of [[-1.5, -1.9], [-0.5, -1.9], [0.5, -1.9], [-0.5, -0.9]]) cell(c, 'T', x * u, y * u, u);
    const tray = new Path2D(); tray.moveTo(-0.38, -0.02); tray.lineTo(-0.38, 0.3); tray.quadraticCurveTo(-0.38, 0.38, -0.3, 0.38); tray.lineTo(0.3, 0.38); tray.quadraticCurveTo(0.38, 0.38, 0.38, 0.3); tray.lineTo(0.38, -0.02);
    tube(c, tray, 0.08, PAPER);
  },
  daily: c => {
    fill(c, rrPath(-0.34, -0.28, 0.68, 0.64, 0.09), PAPERS);
    const top = rrPath(-0.34, -0.28, 0.68, 0.18, 0.09);
    c.save(); c.clip(rrPath(-0.34, -0.28, 0.68, 0.64, 0.09)); c.fillStyle = SIGNAL.danger; c.fill(top); c.fillRect(-0.34, -0.19, 0.68, 0.09); c.restore();
    ink(c, rrPath(-0.34, -0.28, 0.68, 0.64, 0.09));
    for (const x of [-0.17, 0.17]) fill(c, rrPath(x - 0.04, -0.38, 0.08, 0.18, 0.04), STONE, 0.02);
    fill(c, starPath(0, 0.12, 0.17, 0.08), GOLD, 0.03);
  },
  zen: c => {
    for (const [a, col] of [[-50, MINT], [50, MINT], [0, ['#FF9BE0', '#FFD3F1', '#D965B6'] as Tri]] as [number, Tri][]) {
      const p = new Path2D(); p.moveTo(0, 0.26); p.quadraticCurveTo(-0.17, 0.02, 0, -0.32); p.quadraticCurveTo(0.17, 0.02, 0, 0.26); p.closePath();
      fill(c, turn(p, a, 0, 0.2), col, 0.04);
    }
    const w = new Path2D(); w.moveTo(-0.36, 0.34); w.quadraticCurveTo(-0.18, 0.26, 0, 0.34); w.quadraticCurveTo(0.18, 0.42, 0.36, 0.34); line(c, w, 0.06);
  },
  xp: c => {
    fill(c, circlePath(0, 0, 0.36), VIOLET, 0.08);
    c.fillStyle = '#FFFFFF'; c.fill(twinkle(-0.1, -0.1, 0.14));
    c.fillStyle = 'rgba(255,255,255,0.6)'; c.beginPath(); c.arc(0.12, 0.1, 0.045, 0, TAU); c.fill();
  },
  gift: c => {
    fill(c, rrPath(-0.3, -0.06, 0.6, 0.42, 0.06), VIOLET);
    fill(c, rrPath(-0.36, -0.18, 0.72, 0.16, 0.05), VIOLET, 0.03);
    c.fillStyle = GOLD[0]; c.fillRect(-0.06, -0.17, 0.12, 0.52);
    ink(c, rrPath(-0.06, -0.18, 0.12, 0.54, 0.0), O * 0.8);
    for (const sx of [-1, 1]) {
      const p = new Path2D(); p.moveTo(0, -0.18); p.bezierCurveTo(sx * 0.1, -0.42, sx * 0.34, -0.34, 0, -0.18); fill(c, p, GOLD, 0.03);
    }
  },
  stats: c => {
    ([[-0.3, 0.1, MINT], [-0.08, -0.12, GOLD], [0.14, -0.3, VIOLET]] as [number, number, Tri][]).forEach(([x, y, t]) => fill(c, rrPath(x, y, 0.16, 0.3 - y, 0.04), t, 0.03));
    glyph(c, rrPath(-0.38, 0.3, 0.76, 0.08, 0.04), 0.02);
  },
  tower: c => {
    const u = 0.21;
    cell(c, 'O', -u, 0.38 - u, u); cell(c, 'O', 0, 0.38 - u, u);
    cell(c, 'T', -u * 0.5, 0.38 - u * 2, u);
    cell(c, 'I', -u * 0.5, 0.38 - u * 3, u);
    fill(c, starPath(0, 0.38 - u * 3 - 0.1, 0.1, 0.045), GOLD, 0.02);
  },
  biome: c => {
    const frame = rrPath(-0.38, -0.3, 0.76, 0.6, 0.08);
    c.save(); c.clip(frame);
    const g = c.createLinearGradient(0, -0.3, 0, 0.3); g.addColorStop(0, '#6EC3FF'); g.addColorStop(1, '#E4F7FF');
    c.fillStyle = g; c.fill(frame);
    c.fillStyle = '#FFE08A'; c.beginPath(); c.arc(0.18, -0.12, 0.09, 0, TAU); c.fill();
    c.fillStyle = '#8FD06A'; c.beginPath(); c.ellipse(-0.18, 0.32, 0.38, 0.26, 0, 0, TAU); c.fill();
    c.fillStyle = '#5FB04E'; c.beginPath(); c.ellipse(0.25, 0.36, 0.34, 0.2, 0, 0, TAU); c.fill();
    c.restore(); ink(c, frame);
  },
  streak: c => {
    const p = new Path2D(); p.moveTo(0, 0.38); p.bezierCurveTo(-0.34, 0.36, -0.36, 0.0, -0.16, -0.14); p.quadraticCurveTo(-0.12, 0.0, -0.04, 0.02);
    p.quadraticCurveTo(-0.1, -0.24, 0.08, -0.4); p.quadraticCurveTo(0.08, -0.18, 0.22, -0.06); p.bezierCurveTo(0.38, 0.1, 0.32, 0.36, 0, 0.38); p.closePath();
    fill(c, p, ['#FF8A3C', '#FFC56B', '#D9581A'], 0.05);
    const q = new Path2D(); q.moveTo(0, 0.32); q.bezierCurveTo(-0.16, 0.3, -0.16, 0.12, -0.04, 0.04); q.quadraticCurveTo(0.02, 0.14, 0.08, 0.08); q.bezierCurveTo(0.18, 0.18, 0.14, 0.3, 0, 0.32);
    c.fillStyle = '#FFE08A'; c.fill(q);
  },
  perfect: c => {
    for (const [x, y, r] of [[-0.06, 0.04, 0.34], [0.26, -0.24, 0.13], [0.24, 0.26, 0.09]]) fill(c, twinkle(x, y, r), GOLD, r * 0.16);
  },
  row: c => {
    const u = 0.19;
    ['S', 'O', 'T', 'I'].forEach((k, i) => cell(c, k, -0.38 + i * u, -u / 2, u));
    const p = new Path2D(); p.moveTo(-0.4, 0.22); p.lineTo(0.4, 0.22); tube(c, p, 0.06, SIGNAL.gold);
  },
  clutch: c => {
    const p = new Path2D(), n = 9;
    for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU - Math.PI / 2, d = i % 2 ? 0.29 : 0.42; i ? p.lineTo(Math.cos(a) * d, Math.sin(a) * d) : p.moveTo(Math.cos(a) * d, Math.sin(a) * d); }
    p.closePath(); fill(c, p, VIOLET, 0.05);
    c.fillStyle = '#FFFFFF'; c.fill(rrPath(-0.055, -0.24, 0.11, 0.28, 0.05)); c.beginPath(); c.arc(0, 0.15, 0.065, 0, TAU); c.fill();
  },
  score: c => {
    for (const sx of [-1, 1]) fill(c, poly([[sx * 0.04, 0.1], [sx * 0.24, 0.1], [sx * 0.22, 0.42], [sx * 0.13, 0.34], [sx * 0.04, 0.42]]), RED, 0.03);
    fill(c, circlePath(0, -0.08, 0.3), GOLD, 0.06);
    ink(c, circlePath(0, -0.08, 0.21), O * 0.6);
    c.fillStyle = INK; c.fill(starPath(0, -0.07, 0.13, 0.06));
  },

  wind: c => {
    const w = (y: number, len: number, curl: number) => {
      const p = new Path2D(); p.moveTo(-0.38, y); p.lineTo(-0.38 + len, y); p.arc(-0.38 + len, y - curl, curl, Math.PI / 2, -Math.PI * 0.75, true); return p;
    };
    tube(c, w(-0.16, 0.5, 0.11), 0.07, '#BFF3FF'); tube(c, w(0.04, 0.62, 0.0001), 0.07, '#7FD8FF'); tube(c, w(0.22, 0.38, 0.09), 0.07, '#BFF3FF');
  },
  junk: c => {
    const hex: [number, number][] = [];
    for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU + 0.3; hex.push([-0.04 + Math.cos(a) * 0.32, 0.04 + Math.sin(a) * 0.32]); }
    c.save(); c.clip(poly(hex)); part(c, poly(hex), STONE[0], STONE[1], STONE[2]); c.restore();
    c.fillStyle = INK; c.beginPath(); c.arc(-0.04, 0.04, 0.12, 0, TAU); c.fill();
    ink(c, poly(hex));
    const l = circlePath(0.26, -0.26, 0.08); c.fillStyle = SIGNAL.danger; c.fill(l); ink(c, l, O * 0.8);
    const m = new Path2D(); m.moveTo(0.36, 0.2); m.lineTo(0.44, 0.24); m.moveTo(0.3, 0.32); m.lineTo(0.38, 0.4); line(c, m, 0.05);
  },
  meteor: c => {
    const t = new Path2D(); t.moveTo(-0.16, -0.06); t.lineTo(0.42, -0.42); t.lineTo(0.06, 0.16); t.closePath();
    fill(c, t, ['#FF8A3C', '#FFE08A', '#D9581A'], 0.04);
    const r = new Path2D();
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU, d = 0.2 * (0.85 + 0.15 * Math.sin(i * 2.7)); i ? r.lineTo(-0.12 + Math.cos(a) * d, 0.14 + Math.sin(a) * d) : r.moveTo(-0.12 + Math.cos(a) * d, 0.14 + Math.sin(a) * d); }
    r.closePath(); fill(c, r, ['#9A7A68', '#C9AE9C', '#6E5446'], 0.04);
    c.fillStyle = 'rgba(70,50,40,0.5)'; c.beginPath(); c.arc(-0.16, 0.18, 0.045, 0, TAU); c.arc(-0.06, 0.08, 0.03, 0, TAU); c.fill();
  },
  swirl: c => {
    const p = new Path2D();
    for (let i = 0; i <= 60; i++) { const t = i / 60, a = t * TAU * 2.1, d = 0.04 + t * 0.32; i ? p.lineTo(Math.cos(a) * d, Math.sin(a) * d * 0.8) : p.moveTo(Math.cos(a) * d, Math.sin(a) * d * 0.8); }
    tube(c, p, 0.08, '#E8A07E');
  },
  plumb: c => {
    const s = new Path2D(); s.moveTo(0, -0.42); s.lineTo(0, -0.12); line(c, s, 0.05);
    const b = new Path2D(); b.moveTo(0, 0.42); b.bezierCurveTo(-0.08, 0.3, -0.24, 0.1, -0.2, -0.02); b.quadraticCurveTo(-0.16, -0.14, 0, -0.14); b.quadraticCurveTo(0.16, -0.14, 0.2, -0.02); b.bezierCurveTo(0.24, 0.1, 0.08, 0.3, 0, 0.42); b.closePath();
    fill(c, b, GOLD, 0.05);
  },
};

/** Draw icon `name` centred at (x, y), `size` px square. */
export function drawUiIcon(c: Ctx, name: UiIcon, x: number, y: number, size: number): void {
  c.save(); c.translate(x, y); c.scale(size, size);
  DRAW[name](c);
  c.restore();
}

/** Bake icon `name` into a canvas `px` square. */
export function bakeUiIcon(name: UiIcon, px: number): HTMLCanvasElement {
  const cv = makeCanvas(px, px);
  drawUiIcon(ctx2d(cv), name, cv.width / 2, cv.height / 2, cv.width);
  return cv;
}

const urls = new Map<string, string>();

/** A PNG data URL of icon `name`, `cssPx` CSS px square at the device's resolution. Cached. */
export function uiIconUrl(name: UiIcon, cssPx: number, dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1): string {
  const key = `${name}:${Math.round(cssPx * dpr)}`;
  let u = urls.get(key);
  if (!u) { u = bakeUiIcon(name, Math.round(cssPx * dpr)).toDataURL('image/png'); urls.set(key, u); }
  return u;
}
