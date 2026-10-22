// The Daily Tower's screens (gameplay.md §12, §12.3): the Daily card the menu's Daily button opens, its
// menu badge, and the chip the run summary wears. Same "sticker toy" kit as screens.ts: plain data in, an
// element out, buttons with data-action (bind them with onAction). Needs uiCss(); adds its own rules once.

import { ART_SHAPES } from '../shapes.ts';
import { bakePiece } from '../piece.ts';
import { canvasUrl } from '../urls.ts';
import { type UiIcon, uiIconUrl } from './icons.ts';
import { ladderHtml, type LadderPanelData } from './ladder.ts';

const esc = (s: string): string => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const icon = (name: UiIcon, px = 24): string => `<img alt="" src="${uiIconUrl(name, px)}">`;
const btn = (action: string, label: string, ic?: UiIcon, cls = ''): string =>
  `<button type="button" class="ui-btn${cls ? ` ${cls}` : ''}" data-action="${action}">${ic ? icon(ic, cls.includes('big') ? 30 : 24) : ''}<span>${label}</span></button>`;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export interface DailyResultData {
  height: number;
  score: number;
  checkpoints: number;
  /** False when the app closed mid-run: the try still counts, with what it reached. */
  finished: boolean;
}

export interface DailyCardData {
  /** Daily #N. */
  number: number;
  /** The seed's UTC date, YYYY-MM-DD: the calendar sticker shows its month and day. */
  day: string;
  /** Time until the next tower, e.g. "5h 12m" (update it with setDailyCountdown). */
  countdown: string;
  /** Today's shapes (ART_SHAPES keys): the only ones that fall today, 3 or 5, the same for everyone. */
  shapes: string[];
  /** Today's scored try, or null while it's still open. */
  scored: DailyResultData | null;
  /** Today's practice: how many runs and the best one. */
  practice: { runs: number; best: DailyResultData | null };
  /** Days in a row with a scored try. */
  streak: number;
  /** The player's best scored days, best first (today's marked). */
  bestDays: { number: number; height: number; score: number; today?: boolean }[];
  /** Today's ladder (update it with setDailyLadder when it arrives). */
  ladder: LadderPanelData;
  /** Which tab shows: the ladder (default) or the player's best days. */
  tab?: DailyTab;
}

export type DailyTab = 'ladder' | 'best';

/**
 * The Daily card: a calendar sticker with today's number, the countdown to the next tower, today's
 * shapes, the scored try (its rules, or its result) and practice, the streak, then two tabs: today's
 * ladder (ladder.ts) and the player's best days. Actions: close, scored (only while it's open), practice,
 * tab (data-tab), and the ladder's own (join, edit, retry, report).
 */
export function dailyCard(d: DailyCardData): HTMLElement {
  injectDailyCss();
  const [, m, dd] = d.day.split('-').map(Number);
  const open = d.scored === null;
  const result = (r: DailyResultData, big: boolean): string => `
    <div class="ui-dl-result${big ? ' big' : ''}">
      <div class="ui-score"><span>Score</span><b>${num(r.score)}</b></div>
      <div class="ui-dl-facts"><span>${icon('tower', 18)}<b class="ui-num">${r.height.toFixed(1)}</b> m</span><span>${icon('flag', 18)}<b class="ui-num">${r.checkpoints}</b> CP</span></div>
      ${r.finished ? '' : '<span class="ui-dl-unfinished">The app closed mid-run: it counts as it stood</span>'}
    </div>`;
  const shapes = d.shapes.map(k => `<img alt="${esc(ART_SHAPES[k]?.name ?? k)}" data-shape="${esc(k)}" src="${shapeUrl(k)}">`).join('');
  const scored = open
    ? `<div class="ui-dl-box gold">
        <div class="ui-dl-boxhead"><span class="ui-kicker">Scored try</span><span class="ui-chip gold">1 a day</span></div>
        <ul class="ui-dl-rules">
          <li>${icon('daily', 18)}One try. It counts once the first shape drops.</li>
          <li>${icon('wind', 18)}No Second Wind, and power-up slots start empty.</li>
          <li>${icon('crown', 18)}Highest tower wins today's ladder.</li>
        </ul>
      </div>`
    : `<div class="ui-dl-box">
        <div class="ui-dl-boxhead"><span class="ui-kicker">Today's score</span><span class="ui-chip mint">${icon('check', 16)}Done</span></div>
        ${result(d.scored!, true)}
      </div>`;
  const p = d.practice;
  const practice = p.runs > 0 && p.best
    ? `<p class="ui-dl-line">${icon('restart', 18)}<span>Practice: ${p.runs} ${p.runs === 1 ? 'run' : 'runs'}, best <b class="ui-num">${p.best.height.toFixed(1)} m</b></span></p>`
    : `<p class="ui-dl-line">${icon('restart', 18)}<span>Practice as often as you like. It never counts.</span></p>`;
  const best = d.bestDays.length
    ? `<ol class="ui-dl-best">${d.bestDays.map((b, i) => `
        <li${b.today ? ' class="today"' : ''}><span class="ui-dl-rank">${i + 1}</span><span class="ui-dl-no">#${b.number}${b.today ? ' <em>today</em>' : ''}</span><b class="ui-num">${b.height.toFixed(1)} m</b><span class="ui-num">${num(b.score)}</span></li>`).join('')}
      </ol>`
    : `<p class="ui-dl-line">${icon('daily', 18)}<span>Your best scored days show here.</span></p>`;
  const tab = d.tab ?? 'ladder';
  const tabBtn = (t: DailyTab, label: string, ic: UiIcon) =>
    `<button type="button" class="ui-dl-tab${tab === t ? ' on' : ''}" data-action="tab" data-tab="${t}" aria-pressed="${tab === t}">${icon(ic, 18)}<span>${label}</span></button>`;
  const streak = d.streak > 0 ? `<span class="ui-chip amber">${icon('streak', 18)}${d.streak}-day streak</span>` : '';
  const root = el(`<div class="ui ui-overlay" role="dialog" aria-label="Daily Tower"><div class="ui-panel ui-daily">
    <button type="button" class="ui-btn icon sm ui-close" data-action="close" aria-label="Close">${icon('close', 20)}</button>
    <div class="ui-dl-head">
      <div class="ui-cal" aria-hidden="true"><span>${MONTHS[(m || 1) - 1]}</span><b>${dd || 1}</b></div>
      <div>
        <span class="ui-kicker">Daily Tower</span>
        <h1 class="ui-h1">#${d.number}</h1>
        <div class="ui-row ui-dl-chips"><span class="ui-chip ui-dl-count">${icon('daily', 18)}<span>New in <b class="ui-num">${esc(d.countdown)}</b></span></span>${streak}</div>
      </div>
    </div>
    <div class="ui-dl-opening"><div class="ui-dl-sethead"><span class="ui-kicker">Today's shapes</span><span class="ui-chip violet">Only these ${d.shapes.length}</span></div><div class="ui-dl-set n${d.shapes.length}">${shapes}</div></div>
    ${scored}
    ${practice}
    <div class="ui-stack ui-dl-actions">
      ${open ? btn('scored', 'Scored try', 'play', 'primary big wide') : ''}
      ${btn('practice', 'Practice', 'restart', open ? 'wide' : 'primary big wide')}
    </div>
    <div class="ui-dl-tabs" role="group" aria-label="Show">${tabBtn('ladder', 'Ladder', 'trophy')}${tabBtn('best', 'Your best days', 'star')}</div>
    <div class="ui-dl-pane" data-pane="ladder"${tab === 'ladder' ? '' : ' hidden'}>${ladderHtml(d.ladder)}</div>
    <div class="ui-dl-pane" data-pane="best"${tab === 'best' ? '' : ' hidden'}>${best}</div>
  </div></div>`);
  return root;
}

/** Shows a tab of the Daily card: the ladder or the player's best days. */
export function setDailyTab(card: HTMLElement, tab: DailyTab): void {
  card.querySelectorAll<HTMLElement>('.ui-dl-tab').forEach(b => { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); });
  card.querySelectorAll<HTMLElement>('.ui-dl-pane').forEach(p => { p.hidden = p.dataset.pane !== tab; });
}

/** Redraws the Daily card's ladder (it arrives after the card opens, and changes after a report or a new name). */
export function setDailyLadder(card: HTMLElement, d: LadderPanelData): void {
  const pane = card.querySelector<HTMLElement>('.ui-dl-pane[data-pane="ladder"]');
  if (pane) pane.innerHTML = ladderHtml(d);
}

/** Updates the card's countdown text (call it every second or so while the card is open). */
export function setDailyCountdown(card: HTMLElement, text: string): void {
  const b = card.querySelector('.ui-dl-count b');
  if (b && b.textContent !== text) b.textContent = text;
}

/**
 * The scored button's "are you sure" state: the first tap arms it ("Tap again to start") for a moment,
 * so a stray tap can't spend the day's only try. Pass false to disarm.
 */
export function armDailyScored(card: HTMLElement, on: boolean): void {
  const b = card.querySelector<HTMLElement>('[data-action="scored"]');
  if (!b) return;
  b.classList.toggle('armed', on);
  b.querySelector('span')!.textContent = on ? 'Tap again to start' : 'Scored try';
}

/** The run summary's chip: "Daily #12 · Scored" (gold) or "· Practice". */
export function dailyChip(number: number, scored: boolean): HTMLElement {
  injectDailyCss();
  return el(`<span class="ui ui-chip ${scored ? 'gold' : ''} ui-dl-chip">${icon('daily', 18)}Daily #${number} · ${scored ? 'Scored' : 'Practice'}</span>`);
}

/** A small "!" badge for the menu's Daily button while today's scored try is still open. */
export function dailyMenuDot(): HTMLElement {
  injectDailyCss();
  return el('<i class="ui-dl-dot" aria-label="Today\'s scored try is open">!</i>');
}

function shapeUrl(key: string): string {
  return canvasUrl(`daily-shape:${key}`, () => bakePiece(key, 0, 40, { finish: 'wood' }).canvas);
}

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

const CSS = `
.ui-daily { padding-top: 16px; }
.ui-dl-head { display: flex; gap: 14px; align-items: center; text-align: left; margin-right: 40px; }
.ui-dl-head .ui-h1 { margin: 2px 0 6px; font-size: 34px; }
.ui-dl-chips { justify-content: flex-start; flex-wrap: wrap; gap: 6px; }
.ui-dl-chips .ui-chip { font-size: 13px; padding: 3px 7px; }
.ui-cal { flex: none; width: 74px; border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 4px 0 var(--ink); background: #fff; overflow: hidden; transform: rotate(-4deg); text-align: center; }
.ui-cal span { display: block; background: var(--danger); color: #fff; font: 700 14px/22px var(--display); letter-spacing: 0.12em; border-bottom: 3px solid var(--ink); }
.ui-cal b { display: block; font: 700 38px/48px var(--display); font-variant-numeric: tabular-nums; }
.ui-dl-opening { margin: 12px 0 0; text-align: left; }
.ui-dl-sethead { display: flex; justify-content: space-between; align-items: center; }
.ui-dl-sethead .ui-chip { font-size: 12px; padding: 2px 7px; border-width: 2px; }
.ui-dl-set { display: flex; gap: 6px; align-items: center; justify-content: space-evenly; margin-top: 6px; background: rgba(255,255,255,0.7); border: 3px solid var(--ink); border-radius: 12px; padding: 6px 8px; min-height: 56px; }
.ui-dl-set img { max-height: 42px; max-width: 56px; min-width: 0; flex: 0 1 auto; }
.ui-dl-set.n3 img { max-height: 46px; max-width: 70px; }
.ui-dl-tabs { display: flex; margin: 14px 0 8px; border: 3px solid var(--ink); border-radius: 12px; overflow: hidden; box-shadow: 0 3px 0 var(--ink); }
.ui-dl-tab { flex: 1; display: flex; gap: 5px; align-items: center; justify-content: center; min-height: 44px; border: 0; background: #fff; font: 600 14px/1 var(--display); color: var(--ink); padding: 6px; cursor: pointer; }
.ui-dl-tab + .ui-dl-tab { border-left: 3px solid var(--ink); }
.ui-dl-tab.on { background: var(--gold); }
.ui-dl-tab img { width: 18px; height: 18px; }
.ui-dl-pane[hidden] { display: none; }
.ui-dl-box { margin-top: 12px; background: #fff; border: 3px solid var(--ink); border-radius: 14px; padding: 8px 10px 10px; text-align: left; }
.ui-dl-box.gold { background: #FFF3CF; }
.ui-dl-boxhead { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.ui-dl-boxhead .ui-chip { font-size: 13px; padding: 2px 7px; }
.ui-dl-rules { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
.ui-dl-rules li { display: flex; gap: 6px; align-items: center; font: 700 13px/1.25 var(--body); }
.ui-dl-rules img { width: 18px; height: 18px; flex: none; }
.ui-dl-result { display: flex; flex-direction: column; gap: 6px; }
.ui-dl-facts { display: flex; gap: 14px; font: 700 14px/1 var(--body); color: var(--ink-soft); }
.ui-dl-facts span { display: flex; gap: 4px; align-items: center; }
.ui-dl-facts b { font: 700 18px/1 var(--display); color: var(--ink); }
.ui-dl-facts img { width: 18px; height: 18px; }
.ui-dl-unfinished { font: 700 12px/1.2 var(--body); color: var(--ink-soft); }
.ui-dl-line { display: flex; gap: 6px; align-items: center; font: 700 13px/1.3 var(--body); color: var(--ink-soft); margin: 10px 2px 0; text-align: left; }
.ui-dl-line img { width: 18px; height: 18px; flex: none; }
.ui-dl-line b { color: var(--ink); font-family: var(--display); }
.ui-dl-best { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ui-dl-best li { display: grid; grid-template-columns: 26px 1fr auto auto; gap: 8px; align-items: center; background: #fff; border: 2px solid var(--ink); border-radius: 10px; padding: 3px 8px 3px 4px; font: 700 13px/1.2 var(--body); text-align: left; }
.ui-dl-best li.today { background: #FFF3CF; }
.ui-dl-best b { font: 700 16px/1 var(--display); min-width: 64px; text-align: right; }
.ui-dl-best li > span:last-child { min-width: 56px; text-align: right; color: var(--ink-soft); }
.ui-dl-best em { font-style: normal; color: var(--xp); }
.ui-dl-rank { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--gold); border: 2px solid var(--ink); font: 700 12px/1 var(--display); }
.ui-dl-actions { margin-top: 14px; }
.ui-btn.armed { background: var(--danger); color: #fff; animation: ui-dl-pulse 520ms ease-in-out infinite; }
@keyframes ui-dl-pulse { 50% { transform: scale(1.04); } }
.ui-dl-chip { font-size: 14px; padding: 3px 8px; margin-top: 4px; }
.ui .ui-dl-dot { position: absolute; font-style: normal; top: -9px; right: -7px; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--danger); color: #fff; border: 3px solid var(--ink); box-shadow: 0 2px 0 var(--ink); font: 700 14px/1 var(--display); animation: ui-dl-pulse 1.2s ease-in-out infinite; }
@media (max-height: 700px) {
  .ui-daily { padding: 12px 14px 14px; }
  .ui-daily .ui-h2 { margin: 8px 0 5px; font-size: 16px; }
  .ui-dl-head { gap: 10px; }
  .ui-dl-head .ui-h1 { font-size: 28px; margin: 0 0 4px; }
  .ui-cal { width: 58px; }
  .ui-cal span { font-size: 12px; line-height: 18px; }
  .ui-cal b { font-size: 28px; line-height: 36px; }
  .ui-dl-opening { margin-top: 8px; }
  .ui-dl-set { min-height: 44px; padding: 4px 8px; }
  .ui-dl-set img, .ui-dl-set.n3 img { max-height: 32px; }
  .ui-dl-tabs { margin: 10px 0 6px; }
  .ui-dl-box { margin-top: 8px; padding: 6px 10px 8px; }
  .ui-dl-line { margin-top: 8px; }
  .ui-dl-best li { padding: 1px 8px 1px 4px; }
  .ui-dl-actions { margin-top: 10px; gap: 8px; }
  .ui-dl-actions .ui-btn.big { min-height: 54px; font-size: 22px; padding: 8px 20px; }
}
`;

function injectDailyCss(): void {
  if (typeof document === 'undefined' || document.getElementById('st-ui-daily')) return;
  const style = document.createElement('style');
  style.id = 'st-ui-daily';
  style.textContent = CSS;
  document.head.appendChild(style);
}
