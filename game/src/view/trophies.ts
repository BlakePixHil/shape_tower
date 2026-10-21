// Achievements on screen (gameplay.md §18.3): the toast during a run, the "New achievements" strip on
// the run summary, the profile's Achievements row and the Achievements panel. Until Art's badges land,
// a badge is a disc in its tier's colour with a UI kit icon (biome ones show their postcard).

import { postcardUrl, uiIconUrl, type UiIcon } from '@art/index.ts';
import { ACHIEVEMENTS, GROUPS, earnedCount, progress, type Achievement, type Tier } from '../meta/achievements.ts';
import type { Profile } from './profile.ts';
import { INK, INK_SOFT } from './palette.ts';

/** Face and rim of each tier's disc. */
const TIER_COLORS: Record<Tier, [string, string]> = {
  bronze: ['#F0A766', '#B8692E'], silver: ['#EEF2F7', '#9AA6B6'], gold: ['#FFD25E', '#D9971A'], platinum: ['#C9F6FF', '#4FB8D6'],
};
export const TIER_NAMES: Record<Tier, string> = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };

const TOAST_MS = 2200;
const GAP_MS = 250;

const CSS = `
.tr-badge { --s: 44px; position: relative; flex: none; width: var(--s); height: var(--s); border-radius: 50%; display: grid; place-items: center;
  background: var(--face); border: 2.5px solid ${INK}; box-shadow: inset 0 0 0 calc(var(--s) * 0.07) var(--rim), 0 2px 0 ${INK}; overflow: hidden; }
.tr-badge img { width: 62%; height: 62%; position: relative; }
.tr-badge img.tr-pc { width: 74%; height: 74%; border-radius: 50%; object-fit: cover; border: 2px solid ${INK}; }
.tr-badge em.tr-q { font: 700 calc(var(--s) * 0.5)/1 'Fredoka', sans-serif; font-style: normal; color: ${INK}; }
.tr-badge.locked { filter: grayscale(1) brightness(1.05); opacity: 0.55; }
${(Object.keys(TIER_COLORS) as Tier[]).map(t => `.tr-badge.t-${t} { --face: ${TIER_COLORS[t][0]}; --rim: ${TIER_COLORS[t][1]}; }`).join('\n')}
.tr-toast { position: fixed; left: 50%; top: calc(env(safe-area-inset-top, 0px) + 84px); z-index: 6; pointer-events: none; display: flex; align-items: center; gap: 9px;
  background: #FFF7E8; border: 3px solid ${INK}; border-radius: 999px; box-shadow: 0 4px 0 ${INK}; padding: 5px 16px 5px 6px; max-width: calc(100vw - 32px);
  font-family: 'Fredoka', 'Nunito', system-ui, sans-serif; color: ${INK}; transform: translate(-50%, -160%); opacity: 0; transition: transform 320ms cubic-bezier(.2,1.4,.4,1), opacity 200ms; }
.tr-toast.in { transform: translate(-50%, 0); opacity: 1; }
.tr-toast.still { transform: translate(-50%, 0); transition: opacity 260ms; }
.tr-toast > span { display: flex; flex-direction: column; min-width: 0; }
.tr-toast small { font: 700 11px/1.1 'Fredoka', sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: ${INK_SOFT}; }
.tr-toast b { font: 700 17px/1.15 'Fredoka', sans-serif; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr-toast i { font: 700 12px/1.1 'Nunito', sans-serif; font-style: normal; color: ${INK_SOFT}; }
.tr-toast .tr-shine { position: absolute; inset: 0; border-radius: 999px; overflow: hidden; pointer-events: none; }
.tr-toast .tr-shine::after { content: ''; position: absolute; top: -20%; bottom: -20%; width: 30%; left: -40%; background: linear-gradient(100deg, transparent, #fff9, transparent); animation: tr-sweep 900ms 260ms ease-out; }
@keyframes tr-sweep { to { left: 120%; } }
.tr-strip { padding: 8px 0 4px; border-top: 2px dashed rgba(34,24,58,0.25); text-align: left; }
.tr-strip-row { display: flex; flex-wrap: wrap; gap: 6px 10px; margin-top: 6px; }
.tr-chip { display: flex; align-items: center; gap: 6px; font: 700 14px/1.15 'Fredoka', sans-serif; color: ${INK}; max-width: 100%; }
.tr-chip span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tr-row { appearance: none; -webkit-appearance: none; width: 100%; margin: 14px 0 0; display: flex; align-items: center; gap: 10px; text-align: left; cursor: pointer;
  background: #fff; border: 3px solid ${INK}; border-radius: 12px; box-shadow: 0 3px 0 ${INK}; padding: 7px 10px; color: ${INK}; font: inherit; min-height: 48px; }
.tr-row:active { transform: translateY(3px); box-shadow: 0 0 0 ${INK}; }
.tr-row > img { width: 28px; height: 28px; flex: none; }
.tr-row .tr-mid { flex: 1; min-width: 0; }
.tr-row b { display: flex; justify-content: space-between; font: 700 16px/1.2 'Fredoka', sans-serif; }
.tr-row b em { font-style: normal; font-variant-numeric: tabular-nums; }
.tr-bar { display: block; height: 10px; margin-top: 4px; background: #F3E7D3; border: 2px solid ${INK}; border-radius: 999px; overflow: hidden; }
.tr-bar > i { display: block; height: 100%; background: #FFC23D; }
.ui-panel.tr-panel { text-align: left; }
.tr-panel h2 { font: 700 22px/1.2 'Fredoka', sans-serif; margin: 0 0 4px; }
.tr-panel .tr-sum { font: 700 14px/1.2 'Nunito', sans-serif; color: ${INK_SOFT}; margin-bottom: 4px; }
.tr-panel h3 { font: 700 16px/1.2 'Fredoka', sans-serif; margin: 14px 0 6px; display: flex; justify-content: space-between; }
.tr-panel h3 em { font-style: normal; color: ${INK_SOFT}; font-size: 13px; }
.tr-list { display: flex; flex-direction: column; gap: 6px; }
.tr-item { display: flex; align-items: center; gap: 10px; background: #fff; border: 3px solid ${INK}; border-radius: 12px; padding: 6px 8px; }
.tr-item.locked { background: #FBF5EA; border-color: rgba(34,24,58,0.45); }
.tr-item .tr-mid { flex: 1; min-width: 0; }
.tr-item b { display: block; font: 700 15px/1.2 'Fredoka', sans-serif; }
.tr-item span { display: block; font: 600 12px/1.25 'Nunito', sans-serif; color: ${INK_SOFT}; }
.tr-item .tr-meta em { font-style: normal; }
.tr-item .tr-meta { display: flex; justify-content: space-between; gap: 8px; margin-top: 3px; font: 700 11px/1.2 'Fredoka', sans-serif; color: ${INK_SOFT}; letter-spacing: 0.04em; text-transform: uppercase; }
.tr-item .tr-bar { height: 8px; margin-top: 4px; }
`;

let styled = false;
function style(): void {
  if (styled || typeof document === 'undefined') return;
  const el = document.createElement('style');
  el.textContent = CSS;
  document.head.appendChild(el);
  styled = true;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const num = (n: number) => Math.round(n).toLocaleString('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-21' as '21 Oct 2026'. */
const dateText = (d: string) => { const [y, m, day] = d.split('-').map(Number); return y && m && day ? `${day} ${MONTHS[m - 1]} ${y}` : d; };

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

/** A badge: the tier's disc with the icon (biome ones on their postcard). A secret one not yet earned shows "?". */
export function badgeHtml(a: Achievement, got: boolean, px = 44): string {
  style();
  const face = a.secret && !got ? '<em class="tr-q">?</em>'
    : a.biome ? `<img class="tr-pc" alt="" src="${postcardUrl(a.biome - 1, Math.round(px * 0.74), Math.round(px * 0.74))}">`
    : `<img alt="" src="${uiIconUrl(a.icon as UiIcon, Math.round(px * 0.58))}">`;
  return `<span class="tr-badge t-${a.tier}${got ? '' : ' locked'}" style="--s:${px}px" aria-hidden="true">${face}</span>`;
}

export interface ToastOptions {
  reducedMotion(): boolean;
  /** Gate 1: with juice off the toast still shows, without its shine. */
  juice(): boolean;
  /** The unlock sound for each toast shown. */
  sound(a: Achievement): void;
}

/**
 * The in-run toast: drops in under the height counter, stays 2.2 s, ignores touches. One at a time;
 * it waits while a biome title card holds that spot. A burst of more than three ends with "+N more".
 */
export class TrophyToasts {
  private queue: Achievement[] = [];
  private busyUntil = 0;
  private timer = 0;
  private current: HTMLElement | null = null;
  private burst = 0;

  constructor(private o: ToastOptions) { style(); }

  push(a: Achievement): void {
    this.queue.push(a);
    if (!this.current && !this.timer) this.pump();
  }

  /** Keeps the spot free for `ms` (a biome title card is showing there). */
  holdFor(ms: number): void {
    this.busyUntil = Math.max(this.busyUntil, performance.now() + ms);
  }

  /** Drops everything (a new run, the menu). */
  clear(): void {
    clearTimeout(this.timer);
    this.timer = 0;
    this.queue = [];
    this.current?.remove();
    this.current = null;
    this.burst = 0;
  }

  private pump(): void {
    this.timer = 0;
    const wait = this.busyUntil - performance.now();
    if (wait > 0) { this.timer = window.setTimeout(() => this.pump(), wait); return; }
    const a = this.queue.shift();
    if (!a) { this.burst = 0; return; }
    this.burst++;
    let more = 0;
    if (this.burst === 3 && this.queue.length) { more = this.queue.length; this.queue = []; }
    this.show(a, more);
  }

  private show(a: Achievement, more: number): void {
    const still = this.o.reducedMotion();
    const t = el(`<div class="tr-toast${still ? ' still' : ''}" role="status" aria-live="polite">
      ${this.o.juice() && !still ? '<span class="tr-shine"></span>' : ''}${badgeHtml(a, true, 40)}
      <span><small>Achievement!</small><b>${esc(a.name)}</b>${more ? `<i>+${more} more</i>` : ''}</span></div>`);
    document.body.appendChild(t);
    this.current = t;
    this.o.sound(a);
    void t.offsetWidth;
    t.classList.add('in');
    this.timer = window.setTimeout(() => {
      t.classList.remove('in');
      this.timer = window.setTimeout(() => {
        t.remove();
        if (this.current === t) this.current = null;
        this.pump();
      }, still ? 260 : 320 + GAP_MS);
    }, TOAST_MS);
  }
}

/** The run summary's "New achievements" strip (goes in the card's .ui-sum-extra, above QA's questions). */
export function summaryStrip(list: Achievement[]): HTMLElement {
  style();
  const chips = list.map(a => `<div class="tr-chip">${badgeHtml(a, true, 32)}<span>${esc(a.name)}</span></div>`).join('');
  return el(`<div class="tr-strip" aria-label="New achievements"><span class="ui-kicker">New achievements</span><div class="tr-strip-row">${chips}</div></div>`);
}

/** The profile's Achievements row: count and bar. Its action is "achievements". */
export function profileRow(p: Profile): HTMLElement {
  style();
  const n = earnedCount(p), total = ACHIEVEMENTS.length;
  return el(`<button type="button" class="tr-row" data-action="achievements" aria-label="Achievements, ${n} of ${total}">
    <img alt="" src="${uiIconUrl('trophy', 28)}"><span class="tr-mid"><b>Achievements<em>${n} / ${total}</em></b>
    <span class="tr-bar"><i style="width:${((n / total) * 100).toFixed(1)}%"></i></span></span></button>`);
}

/** The Achievements panel: every group, earned ones with their date, counted ones with progress. Action: close. */
export function achievementsPanel(p: Profile): HTMLElement {
  style();
  const n = earnedCount(p), total = ACHIEVEMENTS.length;
  const groups = GROUPS.map(g => {
    const list = ACHIEVEMENTS.filter(a => a.group === g.id);
    const have = list.filter(a => p.achievements[a.id]).length;
    const items = list.map(a => {
      const got = p.achievements[a.id];
      const hide = a.secret && !got;
      const pr = got ? null : progress(p, a);
      const meta = got ? `<span class="tr-meta"><em>${TIER_NAMES[a.tier]}</em><em>${esc(dateText(got.at))}</em></span>`
        : pr ? `<span class="tr-meta"><em>${TIER_NAMES[a.tier]}</em><em>${num(pr[0])} / ${num(pr[1])}</em></span><span class="tr-bar"><i style="width:${((pr[0] / pr[1]) * 100).toFixed(1)}%"></i></span>`
        : `<span class="tr-meta"><em>${TIER_NAMES[a.tier]}</em></span>`;
      return `<div class="tr-item${got ? '' : ' locked'}" data-id="${hide ? '' : a.id}">${badgeHtml(a, !!got, 44)}<div class="tr-mid">
        <b>${hide ? '???' : esc(a.name)}</b><span>${hide ? 'Secret: keep playing' : esc(a.text)}</span>${meta}</div></div>`;
    }).join('');
    return `<h3>${g.name}<em>${have} / ${list.length}</em></h3><div class="tr-list">${items}</div>`;
  }).join('');
  return el(`<div class="ui ui-overlay" role="dialog" aria-label="Achievements"><div class="ui-panel tr-panel">
    <button type="button" class="ui-btn icon sm ui-close" data-action="close" aria-label="Close"><img alt="" src="${uiIconUrl('close', 20)}"></button>
    <h2>Achievements</h2><div class="tr-sum">${n} of ${total} earned</div>
    <span class="tr-bar"><i style="width:${((n / total) * 100).toFixed(1)}%"></i></span>
    ${groups}
  </div></div>`);
}
