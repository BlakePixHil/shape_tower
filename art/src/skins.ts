// Shape skins (monetisation plan v2: Builder's Pass rewards and Workshop sets). A skin is a look for
// every shape, drawn instead of the biome finish. Every skin keeps the shape's hue family, Ink outline,
// light and shade lips and face (art-direction.md §4.6): it may wash the shape's own three colors
// toward white, Ink or a deep tint, then lays a pattern made from them, and leaves a clear patch where
// the face sits so eyes and mouth stay easy to read. Colorblind patterns still draw on top. Purely
// visual: the collider is the sim's (QA F10.1).

import { faceAnchor } from './geometry.ts';
import type { Pose } from './shapes.ts';
import { type Ctx, TAU, circ, hash, labToHex, mixLab, oklab, rgba, rr, star4 } from './util.ts';

export type SkinKind =
  | 'polka' | 'pinstripe' | 'stars' | 'checks' | 'hearts' | 'waves' | 'plaid' | 'zigzag' | 'glitter' | 'pastel' | 'neon' | 'galaxy'
  | 'candy' | 'robot' | 'dragon';

/** What the pattern is drawn in: the shape's own light or shade, white, or gold. */
export type SkinInk = 'light' | 'white' | 'gold' | 'shade';

export interface SkinLook { kind: SkinKind; ink: SkinInk; scale: number }

export interface ShapeColors { base: string; light: string; shade: string }

const INKS: SkinInk[] = ['light', 'white', 'gold', 'shade'];

/** A skin's look at variant `v` (0 = as drawn; later Builder's Pass levels bring variants): the pattern's ink turns, and every other variant is a size up. */
export function skinLook(kind: SkinKind, ink: SkinInk, v = 0): SkinLook {
  return { kind, ink: INKS[(INKS.indexOf(ink) + v) % INKS.length], scale: v % 2 ? 1.3 : 1 };
}

const mix = (a: string, b: string, t: number): string => labToHex(mixLab(oklab(a), oklab(b), t));

/** The shape's three colors under a skin: unchanged, or washed toward white, Ink or a deep tint (same hue family). */
export function skinColors(l: SkinLook, sh: ShapeColors): ShapeColors {
  switch (l.kind) {
    case 'pastel': return { base: mix(sh.base, '#FFFFFF', 0.42), light: mix(sh.light, '#FFFFFF', 0.5), shade: mix(sh.shade, '#FFFFFF', 0.3) };
    case 'neon': return { base: mix(sh.base, '#22183A', 0.42), light: sh.light, shade: mix(sh.shade, '#22183A', 0.55) };
    case 'galaxy': return { base: mix(sh.base, '#1B1440', 0.5), light: mix(sh.light, '#1B1440', 0.2), shade: mix(sh.shade, '#1B1440', 0.62) };
    case 'robot': return { base: mix(sh.base, '#A7B0C2', 0.28), light: mix(sh.light, '#E8ECF4', 0.3), shade: mix(sh.shade, '#5E667A', 0.3) };
    case 'dragon': return { base: sh.base, light: sh.light, shade: mix(sh.shade, '#22183A', 0.15) };
    default: return sh;
  }
}

function inkColor(l: SkinLook, cols: ShapeColors, a = 1): string {
  switch (l.ink) {
    case 'white': return `rgba(255,255,255,${0.62 * a})`;
    case 'gold': return `rgba(255,214,102,${0.9 * a})`;
    case 'shade': return rgba(cols.shade, 0.55 * a);
    default: return rgba(cols.light, 0.85 * a);
  }
}

function heartPath(c: Ctx, x: number, y: number, k: number): void {
  c.moveTo(x, y + k * 0.42);
  c.bezierCurveTo(x - k * 0.62, y + k * 0.02, x - k * 0.5, y - k * 0.5, x, y - k * 0.18);
  c.bezierCurveTo(x + k * 0.5, y - k * 0.5, x + k * 0.62, y + k * 0.02, x, y + k * 0.42);
}

function star5(c: Ctx, x: number, y: number, R: number): void {
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, d = i % 2 ? R * 0.45 : R;
    if (i) c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); else c.moveTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  c.closePath();
}

/**
 * Draw skin `l` over a piece body already filled with `cols` (inside the body's clip, bounding box at
 * the origin, `s` px per block). W and H are the box in px with a little margin.
 */
export function drawSkin(c: Ctx, l: SkinLook, p: Pose, path: Path2D, s: number, W: number, H: number, cols: ShapeColors): void {
  const u = s * l.scale, ink = inkColor(l, cols);
  // Cells to decorate: the pose's, or every cell of the box for round and wedge shapes.
  const cells: [number, number][] = p.cells.length ? p.cells : (() => { const a: [number, number][] = []; for (let y = 0; y < Math.ceil(p.h); y++) for (let x = 0; x < Math.ceil(p.w); x++) a.push([x, y]); return a; })();
  const seed = (x: number, y: number, k: number) => hash(x * 13.7 + y * 7.1 + k * 3.3);
  c.save();
  c.fillStyle = ink; c.strokeStyle = ink; c.lineCap = 'round'; c.lineJoin = 'round';
  let clearFace = true;
  switch (l.kind) {
    case 'polka': {
      const g = u * 0.5;
      c.beginPath();
      for (let gy = 0; gy * g < H + g; gy++) for (let gx = -1; gx * g < W + g; gx++) circ(c, (gx + (gy % 2) * 0.5) * g, gy * g + g * 0.5, u * 0.095);
      c.fill();
      break;
    }
    case 'pinstripe': {
      c.lineWidth = Math.max(1, u * 0.045);
      c.beginPath();
      for (let x = -H; x < W + H; x += u * 0.24) { c.moveTo(x, H); c.lineTo(x + H, 0); }
      c.stroke();
      break;
    }
    case 'stars': {
      for (const [x, y] of cells) {
        c.beginPath(); star5(c, (x + 0.25 + seed(x, y, 1) * 0.5) * s, (y + 0.25 + seed(x, y, 2) * 0.5) * s, u * 0.14); c.fill();
        c.beginPath(); circ(c, (x + seed(x, y, 3)) * s, (y + seed(x, y, 4)) * s, u * 0.035); c.fill();
      }
      break;
    }
    case 'checks': {
      const g = u * 0.5;
      c.fillStyle = l.ink === 'shade' ? rgba(cols.shade, 0.35) : inkColor(l, cols, 0.45);
      for (let gy = 0; gy * g < H; gy++) for (let gx = 0; gx * g < W; gx++) if ((gx + gy) % 2) c.fillRect(gx * g, gy * g, g, g);
      break;
    }
    case 'hearts': {
      const g = u * 0.5;
      c.beginPath();
      for (let gy = 0; gy * g < H + g; gy++) for (let gx = -1; gx * g < W + g; gx++) heartPath(c, (gx + (gy % 2) * 0.5) * g, gy * g + g * 0.5, u * 0.24);
      c.fill();
      break;
    }
    case 'waves': {
      c.lineWidth = Math.max(1, u * 0.07);
      for (let y = u * 0.2; y < H + u * 0.3; y += u * 0.33) {
        c.beginPath();
        for (let x = -4; x <= W + 4; x += 3) { const yy = y + Math.sin((x / u) * TAU * 1.2) * u * 0.06; if (x > -4) c.lineTo(x, yy); else c.moveTo(x, yy); }
        c.stroke();
      }
      break;
    }
    case 'plaid': {
      const g = u * 0.5, w = u * 0.16;
      c.fillStyle = inkColor(l, cols, 0.42);
      for (let x = g * 0.3; x < W; x += g) c.fillRect(x, 0, w, H);
      for (let y = g * 0.3; y < H; y += g) c.fillRect(0, y, W, w);
      c.lineWidth = Math.max(1, u * 0.025); c.strokeStyle = l.ink === 'shade' ? rgba(cols.light, 0.7) : rgba(cols.shade, 0.5);
      c.beginPath();
      for (let x = g * 0.3 + w / 2; x < W; x += g) { c.moveTo(x, 0); c.lineTo(x, H); }
      for (let y = g * 0.3 + w / 2; y < H; y += g) { c.moveTo(0, y); c.lineTo(W, y); }
      c.stroke();
      break;
    }
    case 'zigzag': {
      c.lineWidth = Math.max(1, u * 0.07);
      for (let y = u * 0.3; y < H + u * 0.4; y += u * 0.5) {
        c.beginPath();
        for (let i = 0, x = -u * 0.25; x <= W + u * 0.25; i++, x += u * 0.25) { const yy = y + (i % 2 ? -1 : 1) * u * 0.09; if (i) c.lineTo(x, yy); else c.moveTo(x, yy); }
        c.stroke();
      }
      break;
    }
    case 'glitter': {
      for (const [x, y] of cells) for (let i = 0; i < 7; i++) {
        c.fillStyle = i % 3 === 0 ? 'rgba(255,214,102,0.95)' : 'rgba(255,255,255,0.85)';
        const px = (x + 0.08 + seed(x, y, i) * 0.84) * s, py = (y + 0.08 + seed(x, y, i + 9) * 0.84) * s;
        if (i % 2) star4(c, px, py, u * (0.05 + 0.04 * seed(x, y, i + 3))); else { c.beginPath(); circ(c, px, py, u * 0.025); c.fill(); }
      }
      break;
    }
    case 'pastel': {
      // A soft sheen from the top and a few white freckles.
      const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(255,255,255,0.35)'); g.addColorStop(0.6, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,0.7)';
      for (const [x, y] of cells) for (let i = 0; i < 2; i++) { c.beginPath(); circ(c, (x + 0.2 + seed(x, y, i) * 0.6) * s, (y + 0.2 + seed(x, y, i + 5) * 0.6) * s, u * 0.04); c.fill(); }
      clearFace = false;
      break;
    }
    case 'neon': {
      // A glowing tube just inside the outline, in the shape's own light color.
      c.lineWidth = s * 0.34; c.strokeStyle = rgba(cols.light, 0.25); c.stroke(path);
      c.lineWidth = s * 0.17; c.strokeStyle = rgba(cols.light, 0.55); c.stroke(path);
      c.lineWidth = s * 0.07; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.stroke(path);
      break;
    }
    case 'galaxy': {
      for (let i = 0; i < Math.max(2, cells.length); i++) {
        const [x, y] = cells[i % cells.length], gx = (x + 0.5) * s, gy = (y + 0.5) * s, r = s * (0.5 + 0.3 * seed(x, y, i));
        const g = c.createRadialGradient(gx, gy, 0, gx, gy, r); g.addColorStop(0, rgba(cols.light, 0.45)); g.addColorStop(1, rgba(cols.light, 0));
        c.fillStyle = g; c.fillRect(gx - r, gy - r, r * 2, r * 2);
      }
      for (const [x, y] of cells) for (let i = 0; i < 5; i++) {
        c.fillStyle = i ? 'rgba(255,255,255,0.8)' : '#FFFFFF';
        const px = (x + 0.1 + seed(x, y, i + 20) * 0.8) * s, py = (y + 0.1 + seed(x, y, i + 30) * 0.8) * s;
        if (i === 0) star4(c, px, py, u * 0.09); else { c.beginPath(); circ(c, px, py, u * (0.012 + 0.018 * seed(x, y, i))); c.fill(); }
      }
      break;
    }
    case 'candy': {
      // Peppermint stripes and sprinkles.
      c.fillStyle = 'rgba(255,255,255,0.72)';
      for (let x = -H; x < W + H; x += u * 0.44) { c.beginPath(); c.moveTo(x, H); c.lineTo(x + u * 0.16, H); c.lineTo(x + u * 0.16 + H, 0); c.lineTo(x + H, 0); c.closePath(); c.fill(); }
      const sprinkle = ['#FF7FB0', '#FFE066', '#7FE3F5', '#FFFFFF', '#B9F27F'];
      for (const [x, y] of cells) for (let i = 0; i < 3; i++) {
        c.save(); c.translate((x + 0.15 + seed(x, y, i) * 0.7) * s, (y + 0.15 + seed(x, y, i + 4) * 0.7) * s); c.rotate(seed(x, y, i + 8) * TAU);
        c.fillStyle = sprinkle[(x * 3 + y + i) % sprinkle.length]; rr(c, -u * 0.07, -u * 0.025, u * 0.14, u * 0.05, u * 0.025); c.fill();
        c.restore();
      }
      break;
    }
    case 'robot': {
      // A riveted panel in every cell, and a little status light in some.
      c.lineWidth = Math.max(1, s * 0.03); c.strokeStyle = rgba(cols.shade, 0.7);
      for (const [x, y] of cells) {
        c.strokeRect((x + 0.14) * s, (y + 0.16) * s, s * 0.72, s * 0.68);
        c.fillStyle = rgba(cols.light, 0.95);
        for (const [rx, ry] of [[0.22, 0.24], [0.78, 0.24], [0.22, 0.76], [0.78, 0.76]]) { c.beginPath(); circ(c, (x + rx) * s, (y + ry) * s, s * 0.035); c.fill(); }
        if (seed(x, y, 1) > 0.55) {
          const lx = (x + 0.5) * s, ly = (y + 0.78) * s, g = c.createRadialGradient(lx, ly, 0, lx, ly, s * 0.14);
          g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.35, rgba(cols.light, 0.9)); g.addColorStop(1, rgba(cols.light, 0));
          c.fillStyle = g; c.fillRect(lx - s * 0.14, ly - s * 0.14, s * 0.28, s * 0.28);
        }
      }
      break;
    }
    case 'dragon': {
      // Overlapping scales, a highlight in each, and a few gold glints.
      const g = u * 0.34;
      c.lineWidth = Math.max(1, s * 0.035);
      for (let row = 0, y = -g * 0.2; y < H + g; row++, y += g * 0.62) {
        for (let x = -g + (row % 2) * g * 0.5; x < W + g; x += g) {
          c.beginPath(); c.arc(x + g / 2, y, g / 2, 0, Math.PI); c.strokeStyle = rgba(cols.shade, 0.75); c.stroke();
          c.beginPath(); c.arc(x + g / 2, y + g * 0.08, g * 0.26, 0.3, Math.PI - 0.3); c.strokeStyle = rgba(cols.light, 0.7); c.stroke();
        }
      }
      c.fillStyle = 'rgba(255,214,102,0.95)';
      for (const [x, y] of cells) if (seed(x, y, 7) > 0.5) star4(c, (x + 0.2 + seed(x, y, 8) * 0.6) * s, (y + 0.2 + seed(x, y, 9) * 0.6) * s, s * 0.08);
      break;
    }
  }
  // Clear the pattern where the face sits, back to the body color, so it stays easy to read.
  if (clearFace) {
    const [ax, ay] = faceAnchor(p), fx = ax * s, fy = ay * s, r = s * 0.46;
    const g = c.createRadialGradient(fx, fy, r * 0.45, fx, fy, r);
    g.addColorStop(0, cols.base); g.addColorStop(1, rgba(cols.base, 0));
    c.fillStyle = g; c.beginPath(); c.ellipse(fx, fy, r * 1.15, r, 0, 0, TAU); c.fill();
  }
  c.restore();
}
