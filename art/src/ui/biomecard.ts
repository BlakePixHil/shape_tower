// The biome title card (art-direction.md §6.4): on biome_entered a sticker banner in the biome's color
// drops in under the HUD ("Now entering CLOUDLANDS"), its postcard pops up beside the name and gets
// postmarked, then the banner holds 1.5 s and slides back up. The first time a biome is reached, a
// "New postcard!" chip pops under it. Needs uiCss(). Ignores touches.

import { BIOMES } from '../biomes.ts';
import { uiIconUrl } from './icons.ts';
import { postcardUrl } from './postcard.ts';
import { RAIL_COLORS } from './rail.ts';

export interface BiomeCardOptions {
  /** The first time this biome is reached: the "New postcard!" chip pops in. */
  newPostcard?: boolean;
  /** Vertical position (CSS length). Default: just under the HUD's height counter (84 px below the safe area). */
  top?: string;
  /** No motion: the card fades in and out on the same timing (Reduce Motion). */
  still?: boolean;
  /** Keep it on screen after it lands (no slide-out); remove it yourself. */
  stay?: boolean;
}

/** The postmark: two rings, the biome's number and a few wavy cancel lines, over a white halo so it reads on dark cards. */
function postmark(n: number): string {
  const wave = (y: number) => `M-14 ${y} q4 -3 8 0 t8 0 t8 0`;
  const marks = (w: number) => `<circle cx="22" cy="20" r="15.5" stroke-width="${2.6 + w}"/><circle cx="22" cy="20" r="11" stroke-width="${1.4 + w}"/>`
    + `<path stroke-width="${2 + w}" d="${wave(13)} ${wave(20)} ${wave(27)}"/>`;
  return `<svg class="ui-bt-mark" viewBox="-16 0 56 40" aria-hidden="true"><g fill="none" stroke-linecap="round">`
    + `<g stroke="rgba(255,255,255,0.7)">${marks(2.4)}</g><g stroke="currentColor">${marks(0)}</g></g>`
    + `<text x="22" y="25.5" text-anchor="middle">${n}</text></svg>`;
}

/**
 * Biome `biome`'s title card (0 = Meadow). Append it to the HUD on biome_entered; it plays through in
 * about 2.3 s and removes itself.
 */
export function biomeCard(biome: number, o: BiomeCardOptions = {}): HTMLElement {
  const b = BIOMES[biome];
  const el = document.createElement('div');
  el.className = `ui ui-btitle${o.still ? ' ui-still' : ''}${o.stay ? ' stay' : ''}${o.newPostcard ? ' new' : ''}`;
  el.style.setProperty('--bc', RAIL_COLORS[biome]);
  if (o.top) el.style.setProperty('--top', o.top);
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', `Now entering ${b.name}${o.newPostcard ? '. New postcard!' : ''}`);
  el.innerHTML = `<div class="ui-bt-card"><span class="ui-bt-shine"></span>`
    + `<span class="ui-bt-pc"><img alt="" src="${postcardUrl(biome, 40, 52)}">${postmark(biome + 1)}</span>`
    + `<span class="ui-bt-text"><span class="ui-bt-kick">Now entering</span><span class="ui-bt-name">${b.name}</span></span></div>`
    + (o.newPostcard ? `<span class="ui-chip gold ui-bt-new"><img alt="" src="${uiIconUrl('star', 18)}">New postcard!</span>` : '');
  if (!o.stay) {
    el.addEventListener('animationend', e => { if (e.target === el) el.remove(); });
    setTimeout(() => el.remove(), 4000);
  }
  return el;
}
