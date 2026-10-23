// Pictures of cosmetics for the DOM (monetisation plan v2): an icon for any item id (pickers, the level
// track, the XP tally, the Workshop), and a little scene of a whole look for the "Your look" picker.
// Cached PNG URLs, baked on the CPU like every *Url helper.

import { BIOMES } from '../biomes.ts';
import { CHECKPOINT, bakeFlag } from '../checkpoint.ts';
import { type CosmeticLook, cosmetic, flagFor, foundationFor, hatFor, landingFor, skinFor } from '../cosmetics.ts';
import { faceAnchor } from '../geometry.ts';
import { type LandingStyle, LANDING_TEX, drawLandingSprite } from '../landing.ts';
import { drawPiece } from '../piece.ts';
import { pose } from '../shapes.ts';
import type { SkinLook } from '../skins.ts';
import { SLAB_DEPTH, bakeSlab } from '../slab.ts';
import { type Ctx, ctx2d, hash, makeCanvas } from '../util.ts';
import { canvasUrl } from '../urls.ts';
import { drawHat, hatInfo } from './hats.ts';

const DPR = (): number => (typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1);
const DUST = '#D9C7A8';

/** Draw a baked image so its own box (w × h) fits a `size` square centred at (x, y), scaled down to `k` of it. */
function fit(c: Ctx, img: HTMLCanvasElement, x: number, y: number, size: number, k = 0.92): void {
  const f = Math.min((size * k) / img.width, (size * k) / img.height), w = img.width * f, h = img.height * f;
  c.drawImage(img, x - w / 2, y - h / 2, w, h);
}

function skinIcon(c: Ctx, skin: SkinLook | null, x: number, y: number, size: number): void {
  const s = (size * 0.84) / 3, p = pose('T', 0);
  c.save(); c.translate(x - (p.w * s) / 2, y - (p.h * s) / 2 + s * 0.04);
  drawPiece(c, 'T', 0, s, { skin, face: 'idle', shadow: false, detail: s >= 20 });
  c.restore();
}

/** Icon sizes per sprite, relative to the rest: small ones up, soft glows bigger. */
const SPRITE_K: Partial<Record<keyof typeof LANDING_TEX, number>> = { pixel: 0.8, sprinkle: 1.05, nut: 0.9, puff: 1.25, spark: 1.2, ember: 1.4, butterfly: 1.15 };

/** Where a burst's sprites sit around a landed block in icons, in units of the icon's size from the block's bottom middle. */
const BURST_AT: [number, number, number][] = [[-0.34, -0.02, 0.2], [-0.4, -0.2, -0.5], [-0.22, -0.34, 0.6], [0.34, -0.02, -0.3], [0.41, -0.2, 0.4], [0.2, -0.36, -0.7]];

function burst(c: Ctx, st: LandingStyle | null, x: number, y: number, size: number, scale = 1): void {
  BURST_AT.forEach(([dx, dy, rot], i) => {
    const tex = st ? st.tex[i % st.tex.length] : 'puff', color = st ? st.colors[i % st.colors.length] : DUST;
    const px = size * scale * 0.21 * (SPRITE_K[tex] ?? 1);
    drawLandingSprite(c, tex, x + dx * size * scale, y + dy * size * scale, px, color, st?.upright ? rot * 0.3 : rot);
  });
}

function landingIcon(c: Ctx, st: LandingStyle | null, x: number, y: number, size: number): void {
  const s = size * 0.2, p = pose('Domino', 0), by = y + size * 0.3;
  // A strip of ground, the block that just landed, and the burst at its foot.
  c.save(); c.fillStyle = 'rgba(34,24,58,0.12)'; c.beginPath(); c.ellipse(x, by + s * 0.08, size * 0.42, s * 0.16, 0, 0, Math.PI * 2); c.fill(); c.restore();
  burst(c, st, x, by, size * 0.9);
  c.save(); c.translate(x - (p.w * s) / 2, by - p.h * s);
  drawPiece(c, 'Domino', 0, s, { face: 'impact', shadow: false, detail: s >= 20 });
  c.restore();
}

/** Draw the icon for cosmetic `id` centred at (x, y) in a `size` px square. Unknown ids draw nothing. */
export function drawCosmetic(c: Ctx, id: string, x: number, y: number, size: number): void {
  const d = cosmetic(id);
  if (!d) return;
  switch (d.slot) {
    case 'skin': skinIcon(c, skinFor(id), x, y, size); break;
    case 'landing': landingIcon(c, landingFor(id), x, y, size); break;
    case 'foundation': {
      const s = Math.max(8, Math.round(size / 3.2));
      fit(c, bakeSlab(0, 2, s, foundationFor(id)).canvas, x, y, size, 0.96);
      break;
    }
    case 'flag': {
      const s = Math.max(8, Math.round((size * 0.8) / (CHECKPOINT.flagPole + 0.3)));
      fit(c, bakeFlag(3, s, flagFor(id)).canvas, x + size * 0.04, y, size, 0.9);
      break;
    }
    case 'hat': {
      const hat = hatFor(id), info = hatInfo(hat);
      if (!hat || !info) return;
      const w = (size * 0.8) / Math.max(1.35, info.h + 0.1);
      drawHat(c, hat, x, y + (info.h * w) / 2, w);
      break;
    }
  }
}

/** An icon for cosmetic `id`, `cssPx` square at the device's resolution, as a cached PNG URL (transparent; empty for an unknown id). */
export function cosmeticUrl(id: string, cssPx = 56, dpr = DPR()): string {
  const px = Math.round(cssPx * dpr);
  return canvasUrl(`cos:${id}:${px}`, () => { const cv = makeCanvas(px, px); drawCosmetic(ctx2d(cv), id, px / 2, px / 2, px); return cv; });
}

/**
 * A little scene of a whole look, `cssW` × `cssH`: a short tower in the skin on a slab in the foundation
 * style, the flag planted at its end, the landing burst at the top piece's foot, and the player's
 * Blockling on top in its hat.
 */
export function bakeLookPreview(look: CosmeticLook, shape: string, w: number, h: number): HTMLCanvasElement {
  const cv = makeCanvas(w, h), c = ctx2d(cv), sky = BIOMES[0].sky;
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, sky[0]); g.addColorStop(1, sky[2]);
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  // Clouds and grass.
  c.fillStyle = 'rgba(255,255,255,0.8)';
  for (let i = 0; i < 3; i++) { const cx = w * (0.15 + i * 0.36 + hash(i) * 0.06), cy = h * (0.16 + hash(i + 4) * 0.12), r = h * 0.07; c.beginPath(); c.arc(cx, cy, r, 0, 7); c.arc(cx + r, cy + r * 0.2, r * 0.8, 0, 7); c.arc(cx - r, cy + r * 0.25, r * 0.7, 0, 7); c.fill(); }
  c.fillStyle = '#7FD36B'; c.fillRect(0, h * 0.86, w, h * 0.14);
  c.fillStyle = '#5FB84E'; c.fillRect(0, h * 0.86, w, h * 0.025);

  const s = Math.round(h / 7.2), top = Math.round(h * 0.86 - (SLAB_DEPTH + 0.12) * s), x0 = Math.round(w / 2 - 3.6 * s);
  const skin = skinFor(look.skin), found = foundationFor(look.foundation), flag = flagFor(look.flag), land = landingFor(look.landing);
  const slab = bakeSlab(0, 6.4, s, found);
  c.drawImage(slab.canvas, x0 + 3.2 * s - slab.originX * slab.canvas.width, top - slab.originY * slab.canvas.height);
  // The flag at the slab's right end.
  const fl = bakeFlag(2, s, flag);
  c.drawImage(fl.canvas, x0 + 6.0 * s - fl.originX * fl.canvas.width, top - fl.originY * fl.canvas.height);
  // Two pieces on the slab (tops level), the player's Blockling on top, the landing burst at its foot.
  const put = (key: string, q: number, x: number, y: number, face: 'idle' | 'proud' | 'blink') => { c.save(); c.translate(x, y); drawPiece(c, key, q, s, { skin, face, detail: s >= 20 }); c.restore(); };
  put('O', 0, x0 + 0.3 * s, top - 2 * s, 'blink');
  put('T', 0, x0 + 2.5 * s, top - 2 * s, 'idle');
  const p = pose(shape, 0), mid = x0 + 2.4 * s, ax = mid - (p.w * s) / 2, ay = top - 2 * s - p.h * s;
  burst(c, land, mid, top - 2 * s, s * 3.4, 0.62);
  put(shape, 0, ax, ay, 'proud');
  const hat = hatFor(look.hat ?? null), info = hatInfo(hat);
  if (hat && info) {
    const [fx] = faceAnchor(p), col = Math.min(p.w - 1, Math.floor(fx)), cellTop = p.cells.length ? Math.min(...p.cells.filter(([x]) => x === col).map(([, y]) => y)) : 0;
    drawHat(c, hat, ax + fx * s, ay + cellTop * s + s * 0.06, 1.35 * s);
  }
  return cv;
}

/** bakeLookPreview as a cached PNG URL, `cssW` × `cssH` CSS px at the device's resolution. */
export function lookPreviewUrl(look: CosmeticLook, shape = 'O', cssW = 300, cssH = 150, dpr = DPR()): string {
  const w = Math.round(cssW * dpr), h = Math.round(cssH * dpr);
  return canvasUrl(`look:${look.skin}:${look.landing}:${look.foundation}:${look.flag}:${look.hat ?? ''}:${shape}:${w}x${h}`, () => bakeLookPreview(look, shape, w, h));
}
