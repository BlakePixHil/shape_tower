// Hazard telegraphs for the HUD (art-direction.md §6.3, gameplay.md §8.3): an amber sticker chip at the
// screen edge the hazard comes from, with its icon, a countdown ring that fills over the warning and
// chevrons showing which way it pushes; and the one-line card for a hazard's first appearance. Needs
// uiCss(). The chip ignores touches.

import { type UiIcon, uiIconUrl } from './icons.ts';

export type HazardType = 'gust' | 'crosswind' | 'junk' | 'meteor' | 'dust' | 'sway';

/** Each hazard's icon and its first-appearance card copy. */
export const HAZARDS: Record<HazardType, { icon: UiIcon; title: string; tip: string }> = {
  gust: { icon: 'wind', title: 'Gusts ahead!', tip: 'Keep it wide.' },
  crosswind: { icon: 'wind', title: 'Crosswind!', tip: 'Build into the wind.' },
  junk: { icon: 'junk', title: 'Space junk!', tip: 'Watch the target.' },
  meteor: { icon: 'meteor', title: 'Meteor shower!', tip: 'Keep the top solid.' },
  dust: { icon: 'swirl', title: 'Dust devils!', tip: 'Keep the top low and wide.' },
  sway: { icon: 'plumb', title: 'Tidal sway!', tip: 'Build down the middle.' },
};

const RING = 2 * Math.PI * 19;

export interface HazardChipOptions {
  type: HazardType;
  /** The way it pushes: 1 = left to right, so the chip sits at the left edge. */
  dir: -1 | 1;
  /** Seconds until it starts; the ring fills over this (gameplay sends 2). */
  eta: number;
  /** Vertical position (CSS length, default 30%): about where the tower's top is. */
  y?: string;
  /** Seconds of the warning already gone (a chip rebuilt after a resume); the ring starts that far in. */
  elapsed?: number;
}

/**
 * The telegraph chip. Append it to the HUD on hazard_warning; call hazardChipGo(chip) on
 * hazard_start (the ring is full and the chip pushes) and hazardChipEnd(chip) on hazard_end (it slides
 * out and removes itself). Add the class `paused` while the game is paused to hold the countdown.
 */
export function hazardChip(o: HazardChipOptions): HTMLElement {
  const h = HAZARDS[o.type], left = o.dir > 0;
  const el = document.createElement('div');
  el.className = `ui ui-hazard ${left ? 'from-left' : 'from-right'}`;
  el.style.setProperty('--eta', `${Math.max(0.1, o.eta)}s`);
  if (o.y) el.style.setProperty('--y', o.y);
  if (o.elapsed) el.style.setProperty('--el', `${-o.elapsed}s`);
  el.setAttribute('role', 'status');
  el.setAttribute('aria-label', `${h.title.replace('!', '')} from the ${left ? 'left' : 'right'}`);
  const chev = '<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M3 3 L9 10 L3 17"/></svg>';
  el.innerHTML = `<span class="ui-hz-dial"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="19"/><circle class="cd" cx="22" cy="22" r="19" style="stroke-dasharray:${RING.toFixed(1)}"/></svg>`
    + `<img alt="" src="${uiIconUrl(h.icon, 26)}"></span><span class="ui-hz-arrow">${chev}${chev}</span>`;
  return el;
}

/** The hazard has started: ring full, the chip leans and pushes (at most 2 Hz). */
export function hazardChipGo(chip: HTMLElement): void { chip.classList.add('go'); }

/** The hazard is over: the chip slides out to its edge, then removes itself. */
export function hazardChipEnd(chip: HTMLElement): void {
  if (chip.classList.contains('out')) return;
  chip.classList.add('out');
  const done = () => chip.remove();
  chip.addEventListener('animationend', e => { if (e.animationName === 'ui-hz-out') done(); });
  setTimeout(done, 600);
}

/**
 * The one-line card for a hazard's first appearance ("Gusts ahead! Keep it wide."), styled like the
 * biome title. Append it to the HUD; it drops in, holds about 2.5 s, floats away and removes itself.
 * `top` is a CSS length (default 18%, above the chip).
 */
export function hazardCard(type: HazardType, o: { top?: string; still?: boolean } = {}): HTMLElement {
  const h = HAZARDS[type];
  const el = document.createElement('div');
  el.className = `ui ui-hcard${o.still ? ' ui-still' : ''}`;
  if (o.top) el.style.setProperty('--top', o.top);
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="ui-hc-title"><img alt="" src="${uiIconUrl(h.icon, 40)}"><span>${h.title}</span></div><span class="ui-chip amber">${h.tip}</span>`;
  el.addEventListener('animationend', e => { if (e.animationName.startsWith('ui-hc')) el.remove(); });
  setTimeout(() => el.remove(), 4000);
  return el;
}
