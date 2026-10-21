// Browser entry for bake-native-assets.mjs: Art's icon and the loading splash's parts.
// The splash's logo is the menu's own logo (Art's logoElement, still) so the splash can hand it over
// to the menu without a jump; the script photographs it at each screen density.
import { BIOMES } from '../../art/src/biomes.ts';
import { bakeAppIcon, type IconLayer } from '../../art/src/brand.ts';
import { cloud as drawCloud } from '../../art/src/meadow.ts';
import { drawPiece } from '../../art/src/piece.ts';
import { pose } from '../../art/src/shapes.ts';
import { injectUiCss } from '../../art/src/ui/css.ts';
import { logoElement } from '../../art/src/ui/logo.ts';

type Fmt = 'png' | 'webp';
const url = (cv: HTMLCanvasElement, fmt: Fmt): string => (fmt === 'png' ? cv.toDataURL('image/png') : cv.toDataURL('image/webp', 0.92));

function canvas(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(w); cv.height = Math.ceil(h);
  draw(cv.getContext('2d')!);
  return cv;
}

function icon(px: number, layer: IconLayer, round: boolean): string {
  const src = bakeAppIcon(px, layer);
  if (!round) return src.toDataURL('image/png');
  return canvas(px, px, c => {
    c.beginPath(); c.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2); c.clip();
    c.drawImage(src, 0, 0);
  }).toDataURL('image/png');
}

/**
 * Puts the menu's logo (tiles `tile` CSS px, still) on the page and returns the box around everything it
 * draws, `margin` px wider on each side, for the script to photograph. splash.ts measures the menu's logo
 * the same way when it hands over.
 */
async function logo(tile: number, margin: number): Promise<{ x: number; y: number; w: number; h: number }> {
  injectUiCss();
  const el = logoElement({ tile, still: true });
  Object.assign(el.style, { position: 'absolute', left: '100px', top: '100px' });
  document.body.appendChild(el);
  const imgs = [...el.querySelectorAll('img')];
  await Promise.all(imgs.map(i => i.decode()));
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const rs = imgs.map(i => i.getBoundingClientRect());
  const x = Math.floor(Math.min(...rs.map(r => r.left)) - margin), y = Math.floor(Math.min(...rs.map(r => r.top)) - margin);
  return { x, y, w: Math.ceil(Math.max(...rs.map(r => r.right)) + margin) - x, h: Math.ceil(Math.max(...rs.map(r => r.bottom)) + margin) - y };
}

/** A PNG (data URL) re-encoded as WebP. */
async function webp(png: string): Promise<string> {
  const img = new Image();
  img.src = png;
  await img.decode();
  return url(canvas(img.width, img.height, c => c.drawImage(img, 0, 0)), 'webp');
}

/** One cloud filling a `px` wide box (3.3 r wide, 1.95 r tall). */
function cloud(px: number, fmt: Fmt): string {
  const r = px / 3.3;
  return url(canvas(px, r * 1.95, c => drawCloud(c, r * 1.6, r * 1.27, r, 'rgba(255,255,255,0.9)')), fmt);
}

/** The two Meadow hills of Art's splash (brand.ts bakeSplash) as a strip `w` × `h` px, stretched across the bottom. */
function hills(w: number, h: number, fmt: Fmt): string {
  return url(canvas(w, h, c => {
    c.fillStyle = '#9BDB86'; c.beginPath(); c.moveTo(0, h * 0.36); c.quadraticCurveTo(w * 0.3, h * 0.09, w * 0.6, h * 0.36);
    c.quadraticCurveTo(w * 0.85, h * 0.55, w, h * 0.27); c.lineTo(w, h); c.lineTo(0, h); c.fill();
    c.fillStyle = '#7FD36B'; c.beginPath(); c.moveTo(0, h * 0.64); c.quadraticCurveTo(w * 0.5, h * 0.36, w, h * 0.68); c.lineTo(w, h); c.lineTo(0, h); c.fill();
  }), fmt);
}

/** A Blockling piece with its face, `cell` px per block, padded by `pad` blocks for the outline. */
function piece(key: string, q: number, cell: number, pad: number, fmt: Fmt): string {
  const p = pose(key, q);
  return url(canvas((p.w + pad * 2) * cell, (p.h + pad * 2) * cell, c => {
    c.translate(pad * cell, pad * cell);
    drawPiece(c, key, q, cell, { face: 'idle', shadow: false, detail: cell >= 20 });
  }), fmt);
}

/** A piece's size in blocks at rotation `q`. */
const dims = (key: string, q: number): [number, number] => { const p = pose(key, q); return [p.w, p.h]; };

/** The Meadow's sky, top to bottom (the splash's gradient). */
const sky = (): string[] => [...BIOMES[0].sky];

(window as unknown as { nativeAssets: unknown }).nativeAssets = { icon, logo, webp, cloud, hills, piece, dims, sky };
