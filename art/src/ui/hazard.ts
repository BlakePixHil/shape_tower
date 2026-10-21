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

const SOCK_STRIPES = ['#FF7A2E', '#FFFFFF', '#FF7A2E', '#FFFFFF', '#FF7A2E'];

/**
 * The crosswind's HUD windsock (Storm Belt, Stratosphere): a Paper card with a striped sock on a pole. The
 * sock points the way the wind blows and fills out with its strength; when the wind flips it swings
 * across over 2 s. Place it in the HUD yourself (it's 56 px square). Update it with setWindsock().
 */
export function windsock(o: { dir?: -1 | 1; strength?: number } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ui ui-gauge ui-sock';
  el.setAttribute('role', 'img');
  // The sock: five stripes tapering from the mouth (x 17) to the tail (x 50), pointing +x.
  const top = (x: number) => 6.5 + (x - 17) * 0.16, bot = (x: number) => 21.5 - (x - 17) * 0.16;
  const seg = SOCK_STRIPES.map((col, i) => {
    const x0 = 17 + i * 6.6, x1 = x0 + 6.6;
    return `<path d="M${x0} ${top(x0)} L${x1} ${top(x1)} L${x1} ${bot(x1)} L${x0} ${bot(x0)} Z" fill="${col}"/>`;
  }).join('');
  el.innerHTML = `<span class="ui-gauge-cap">WIND</span><svg viewBox="0 0 56 56" aria-hidden="true">`
    + `<rect x="11.5" y="10" width="5" height="40" rx="2.5" fill="#FFF7E8" stroke="var(--ink)" stroke-width="2.5"/>`
    + `<g class="ui-sock-arm"><g class="ui-sock-flap">${seg}`
    + `<path d="M17 ${top(17)} L50 ${top(50)} L50 ${bot(50)} L17 ${bot(17)} Z" fill="none" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>`
    + `<ellipse cx="17" cy="14" rx="2.6" ry="7.5" fill="#FFC23D" stroke="var(--ink)" stroke-width="2.2"/></g></g>`
    + `<circle cx="14" cy="10" r="3.2" fill="var(--gold)" stroke="var(--ink)" stroke-width="2"/></svg>`;
  setWindsock(el, o.dir ?? 1, o.strength ?? 0.6);
  return el;
}

/** Point the windsock: `dir` the way the wind blows (1 = to the right), `strength` 0 (limp) to 1 (full). */
export function setWindsock(el: HTMLElement, dir: -1 | 1, strength: number): void {
  const s = Math.max(0, Math.min(1, strength)), droop = 72 * (1 - s);
  el.style.setProperty('--a', `${dir > 0 ? droop : 180 - droop}deg`);
  el.style.setProperty('--len', (0.62 + 0.38 * s).toFixed(3));
  el.style.setProperty('--flap', `${(0.9 - 0.55 * s).toFixed(2)}s`);
  el.setAttribute('aria-label', s < 0.05 ? 'No crosswind' : `Crosswind ${s > 0.66 ? 'strong' : s > 0.33 ? 'steady' : 'light'}, blowing ${dir > 0 ? 'right' : 'left'}`);
}

/**
 * The tidal sway's HUD plumb-bob (Ringed Giant): a gold bob on a string that leans the way gravity is
 * about to tilt, over a little scale. 56 px square; update it with setPlumb().
 */
export function plumbBob(o: { tilt?: number } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ui ui-gauge ui-plumb';
  el.setAttribute('role', 'img');
  const tick = (deg: number, len: number) => {
    const a = (deg * Math.PI) / 180, r0 = 41, x0 = 28 + Math.sin(a) * r0, y0 = 8 + Math.cos(a) * r0, x1 = 28 + Math.sin(a) * (r0 + len), y1 = 8 + Math.cos(a) * (r0 + len);
    return `M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}`;
  };
  el.innerHTML = `<span class="ui-gauge-cap">TILT</span><svg viewBox="0 0 56 56" aria-hidden="true">`
    + `<path d="M8.4 43.6 A41 41 0 0 0 47.6 43.6" fill="none" stroke="rgba(34,24,58,0.25)" stroke-width="2.5" stroke-linecap="round"/>`
    + `<path d="${tick(-24, 5)} ${tick(24, 5)} ${tick(0, 6)}" stroke="rgba(34,24,58,0.5)" stroke-width="2.5" stroke-linecap="round"/>`
    + `<g class="ui-plumb-arm"><path d="M28 8 L28 32" stroke="var(--ink)" stroke-width="2"/>`
    + `<path d="M28 49 C24 44 20.5 40 20.5 36.5 a7.5 7.5 0 0 1 15 0 C35.5 40 32 44 28 49 Z" fill="var(--gold)" stroke="var(--ink)" stroke-width="2.5" stroke-linejoin="round"/>`
    + `<ellipse cx="25" cy="35.5" rx="2" ry="2.8" fill="#FFF3C4"/></g>`
    + `<path d="M20 8 L36 8" stroke="var(--ink)" stroke-width="3" stroke-linecap="round"/><circle cx="28" cy="8" r="2.2" fill="var(--paper)" stroke="var(--ink)" stroke-width="2"/></svg>`;
  setPlumb(el, o.tilt ?? 0);
  return el;
}

/** Lean the plumb-bob: -1 (gravity about to pull left) to 1 (right). */
export function setPlumb(el: HTMLElement, tilt: number): void {
  const t = Math.max(-1, Math.min(1, tilt));
  // The bob swings toward the pull: a pull to the right moves it right, which is a counter-clockwise turn about the hook.
  el.style.setProperty('--a', `${(-t * 24).toFixed(1)}deg`);
  el.setAttribute('aria-label', Math.abs(t) < 0.1 ? 'Gravity level' : `Gravity tilting ${t > 0 ? 'right' : 'left'}`);
}
