// Biome postcards (art-direction.md §8.3, §8.4): each biome's sky and props as they look on arrival,
// baked small into a portrait card. The run summary shows the highest biome's; the profile shows one
// per biome, stamped with the date first reached, and a "???" card for biomes not reached yet.

import { BIOME_BAKERS } from '../backdrops.ts';
import { BIOMES, starAmount } from '../biomes.ts';
import { STAR_LAYERS, bakeStarTile } from '../stars.ts';
import { ctx2d, makeCanvas } from '../util.ts';
import { canvasUrl } from '../urls.ts';

/** The virtual screen the props are laid out on, in game px; the card shows it scaled to fit. */
const VW = 390;

/**
 * Biome `biome`'s postcard picture, w x h CSS px at k device px per CSS px. Portrait cards (about 3:4)
 * show the most. Flashes show at their peak (Storm Belt lightning), pulses at their middle.
 */
export function bakePostcard(biome: number, w: number, h: number, k: number): HTMLCanvasElement {
  const b = BIOMES[biome], VH = (VW * h) / w, sc = w / VW, kk = k * sc;
  const cv = makeCanvas(w * k, h * k), c = ctx2d(cv);
  // Sky, as the Backdrop paints it.
  const g = c.createLinearGradient(0, 0, 0, cv.height);
  g.addColorStop(0, b.sky[0]); g.addColorStop(0.55, b.sky[1]); g.addColorStop(1, b.sky[2]);
  c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
  const stars = starAmount(biome + 0.3);
  if (stars > 0.01) {
    c.globalAlpha = stars;
    STAR_LAYERS.forEach((_, i) => {
      const t = bakeStarTile(i, kk);
      for (let y = 0; y < cv.height; y += t.height) for (let x = 0; x < cv.width; x += t.width) c.drawImage(t, x, y);
    });
    c.globalAlpha = 1;
  }
  // Props at their arrival positions; the Meadow's sit on a ground line near the bottom.
  const ground = VH * 0.84;
  c.scale(kk, kk);
  for (const P of BIOME_BAKERS[biome](VW, VH, kk).sort((p, q) => p.z - q.z)) {
    if (P.palette !== undefined && P.palette !== 0) continue;
    if (P.flash && (P.flash.offset ?? 0) !== 0) continue;
    let a = 1;
    if (P.flash) a = Math.min(1, P.flash.alpha * 3);
    if (P.pulse) a = (1 + P.pulse[1]) / 2;
    const r = P.res ?? 1, pw = P.canvas.width / (kk * r), ph = P.canvas.height / (kk * r);
    const x = P.x - (P.originX ?? 0) * pw, y = (P.anchor === 'entry' ? P.y : ground + P.y) - (P.originY ?? 0) * ph;
    c.globalAlpha = a;
    c.drawImage(P.canvas, x, y, pw, ph);
  }
  c.globalAlpha = 1;
  return cv;
}

/** bakePostcard as a cached PNG URL, at the device's resolution. */
export function postcardUrl(biome: number, w: number, h: number, dpr = typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1): string {
  return canvasUrl(`postcard:${biome}:${w}x${h}@${dpr}`, () => bakePostcard(biome, w, h, dpr));
}

export interface PostcardOptions {
  biome: number;
  /** Width in CSS px (default 104); the card is 4:3 portrait. */
  width?: number;
  /** The postmark, e.g. "21 OCT 2026". Omit for none. */
  date?: string;
  /** Not reached yet: a "???" card. */
  locked?: boolean;
}

/** A framed postcard for the DOM: the picture, the biome's name, a stamp and an optional postmark. Needs uiCss(). */
export function postcardElement(o: PostcardOptions): HTMLElement {
  const w = o.width ?? 104, h = Math.round((w * 4) / 3), b = BIOMES[o.biome];
  const el = document.createElement('div');
  el.className = `ui ui-postcard${o.locked ? ' locked' : ''}`;
  el.style.setProperty('--w', `${w}px`);
  const art = o.locked
    ? `<div class="ui-pc-art ui-pc-q" style="aspect-ratio:${w - 12}/${h - 30};background:linear-gradient(${b.sky[0]},${b.sky[2]})"><span>???</span></div>`
    : `<img class="ui-pc-art" alt="" src="${postcardUrl(o.biome, w - 12, h - 30)}">`;
  el.innerHTML = `${art}<span class="ui-pc-name">${o.locked ? '???' : b.name}</span><span class="ui-pc-stamp" style="--c:${b.sky[1]}">${o.biome + 1}</span>${o.date && !o.locked ? `<span class="ui-pc-mark">${o.date}</span>` : ''}`;
  el.setAttribute('aria-label', o.locked ? 'Biome not reached yet' : `${b.name} postcard`);
  return el;
}
