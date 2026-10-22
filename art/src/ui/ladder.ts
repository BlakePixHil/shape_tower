// The Daily ladder's screens (gameplay.md §12.3): the ladder list inside the Daily card, and the card
// where a player picks their ladder name and portrait. Same kit as daily.ts: plain data in, elements out,
// buttons with data-action. Portraits come from portraits.ts. Needs uiCss(); adds its own rules once.

import { portraitHtml } from './portraits.ts';
import type { AvatarSpec } from './screens.ts';
import { type UiIcon, uiIconUrl } from './icons.ts';

const esc = (s: string): string => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const icon = (name: UiIcon, px = 24): string => `<img alt="" src="${uiIconUrl(name, px)}">`;
const btn = (action: string, label: string, ic?: UiIcon, cls = ''): string =>
  `<button type="button" class="ui-btn${cls ? ` ${cls}` : ''}" data-action="${action}">${ic ? icon(ic, 22) : ''}<span>${label}</span></button>`;

export interface LadderRowData {
  /** The player's ladder id (never shown). */
  id: string;
  rank: number;
  /** The name to show: a stand-in ("Builder 4821") for one hidden by reports. */
  name: string;
  height: number;
  portrait: string;
  avatar: AvatarSpec;
  /** Still climbing. */
  live?: boolean;
  /** This player's own row. */
  me?: boolean;
  /** Reported by this player (or hidden by reports): no report button. */
  reported?: boolean;
}

export interface LadderPanelData {
  /** loading: waiting for it; ready: rows below; offline: couldn't reach it; none: no ladder in this copy of the game. */
  state: 'loading' | 'ready' | 'offline' | 'none';
  /** Who plays on it, for the header: "Everyone" (the app) or "This page" (the game page's own). */
  scope: string;
  /** How many players today. */
  total: number;
  rows: LadderRowData[];
  /** The player's row when it's below the top rows (pinned under them). */
  me: LadderRowData | null;
  /** Whether the player has a ladder name. */
  joined: boolean;
  /** Their name and look, for the "you" strip. */
  you: { name: string; portrait: string; avatar: AvatarSpec };
  /** A line under the list, e.g. why their try isn't on it. */
  note?: string;
  /** Hold animated portraits still (Reduce Motion). */
  still?: boolean;
}

/**
 * The ladder: today's top heights with portraits, the player's own row highlighted (and pinned below
 * when it's further down), a report button on everyone else's, and the "you" strip: join with a name,
 * or your name and look with Edit. Actions: join, edit, retry, report (data-id on the button).
 */
export function ladderHtml(d: LadderPanelData): string {
  injectLadderCss();
  const row = (r: LadderRowData, pinned = false): string => `
    <li class="ui-ld-row${r.me ? ' me' : ''}${pinned ? ' pinned' : ''}" data-id="${esc(r.id)}">
      <span class="ui-ld-rank${r.rank <= 3 ? ` top${r.rank}` : ''}">${r.rank}</span>
      ${portraitHtml(r.portrait, r.avatar, 34, { still: d.still })}
      <span class="ui-ld-name">${esc(r.name)}${r.me ? ' <em>you</em>' : ''}${r.live ? ` <i class="ui-ld-live" title="Still climbing">${icon('tower', 14)}</i>` : ''}</span>
      <b class="ui-num">${r.height.toFixed(1)}<small> m</small></b>
      ${r.me || r.reported ? '<span class="ui-ld-flag"></span>' : `<button type="button" class="ui-ld-flag" data-action="report" data-id="${esc(r.id)}" aria-label="Report ${esc(r.name)}">${icon('flag', 16)}</button>`}
      <span class="ui-ld-confirm" hidden><span>Report this name?</span><button type="button" class="ui-btn sm danger" data-action="reportYes" data-id="${esc(r.id)}">Report</button><button type="button" class="ui-btn sm" data-action="reportNo">Cancel</button></span>
    </li>`;
  const you = d.joined
    ? `<div class="ui-ld-you">${portraitHtml(d.you.portrait, d.you.avatar, 40, { still: d.still })}<span><span class="ui-kicker">On the ladder as</span><b>${esc(d.you.name)}</b></span>${btn('edit', 'Edit', undefined, 'sm')}</div>`
    : `<div class="ui-ld-you join">${portraitHtml(d.you.portrait, d.you.avatar, 40, { still: d.still })}<span><b>Join the ladder</b><span>Pick a name to see your height here. Without one, it's your personal best.</span></span>${btn('join', 'Pick a name', undefined, 'sm primary')}</div>`;
  let body: string;
  if (d.state === 'none') body = `<p class="ui-ld-msg">${icon('info', 18)}<span>The ladder isn't available here. Your tries still count as personal bests.</span></p>`;
  else if (d.state === 'loading') body = `<p class="ui-ld-msg loading">${icon('tower', 18)}<span>Loading today's ladder…</span></p>`;
  else if (d.state === 'offline') body = `<p class="ui-ld-msg">${icon('info', 18)}<span>Can't reach the ladder right now.</span>${btn('retry', 'Try again', 'restart', 'sm')}</p>`;
  else if (!d.rows.length) body = `<p class="ui-ld-msg">${icon('crown', 18)}<span>Nobody's climbed today's tower yet. The top spot is yours to take.</span></p>`;
  else body = `<ol class="ui-ld-list">${d.rows.map(r => row(r)).join('')}${d.me && !d.rows.some(r => r.me) ? row(d.me, true) : ''}</ol>`;
  const count = d.state === 'ready' ? `<span class="ui-chip">${icon('profile', 16)}${d.total} ${d.total === 1 ? 'player' : 'players'}</span>` : '';
  return `<div class="ui-ld">
    <div class="ui-ld-head"><span class="ui-kicker">${esc(d.scope)} · highest tower wins</span>${count}</div>
    ${body}
    ${d.note ? `<p class="ui-ld-note">${esc(d.note)}</p>` : ''}
    ${d.state === 'none' ? '' : you}
  </div>`;
}

/** Shows (or hides, with null) the "Report this name?" question on one row of a ladder inside `root`. */
export function armReport(root: HTMLElement, id: string | null): void {
  root.querySelectorAll<HTMLElement>('.ui-ld-row').forEach(li => {
    const on = li.dataset.id === id;
    li.classList.toggle('asking', on);
    li.querySelector<HTMLElement>('.ui-ld-confirm')!.hidden = !on;
  });
}

// ---------------------------------------------------------------------------------------------
// The name card

export interface PortraitChoice {
  id: string;
  name: string;
  animated: boolean;
  owned: boolean;
  /** Why it's locked, shown under it: "Level 4", "Reach the Moon", "Workshop · Soon". */
  lock?: string;
}

export interface NameCardData {
  /** Their current name ('' for none). */
  name: string;
  portrait: string;
  avatar: AvatarSpec;
  portraits: PortraitChoice[];
  /** Whether they're already on the ladder (the button says Save, not Join). */
  joined: boolean;
  /** A line under the field: the weekly rename rule, or when the next change is allowed. */
  rule: string;
  /** Hold animated portraits still. */
  still?: boolean;
}

/**
 * Picking a ladder name and portrait: a big preview, the name field with a live hint under it (set it
 * with setNameHint as they type), and every portrait, locked ones with what unlocks them (shop ones say
 * the Workshop is coming; no prices here). Actions: close, save, forget (only once joined).
 * Read the choice with readNameCard.
 */
export function nameCard(d: NameCardData): HTMLElement {
  injectLadderCss();
  const pick = (p: PortraitChoice): string => `
    <label class="ui-pt-pick${p.owned ? '' : ' locked'}" title="${esc(p.name)}">
      <input type="radio" name="ui-pt" value="${esc(p.id)}"${p.id === d.portrait ? ' checked' : ''}${p.owned ? '' : ' disabled'} aria-label="${esc(p.name)}${p.lock ? `, ${esc(p.lock)}` : ''}">
      <span>${portraitHtml(p.id, d.avatar, 56, { still: d.still || !p.owned })}${p.owned ? '' : `<i>${icon('lock', 14)}</i>`}</span>
      <small>${p.owned ? esc(p.name) : esc(p.lock ?? 'Locked')}</small>
    </label>`;
  const groups: [string, (p: PortraitChoice) => boolean][] = [
    ['Yours', p => p.owned],
    ['Earn them', p => !p.owned && !/workshop|supporter/i.test(p.lock ?? '')],
    ['Workshop', p => !p.owned && /workshop|supporter/i.test(p.lock ?? '')],
  ];
  const root = el(`<div class="ui ui-overlay" role="dialog" aria-label="Your ladder name"><div class="ui-panel ui-namecard">
    <button type="button" class="ui-btn icon sm ui-close" data-action="close" aria-label="Close">${icon('close', 20)}</button>
    <h1 class="ui-h1">${d.joined ? 'Your ladder name' : 'Join the ladder'}</h1>
    <div class="ui-nc-preview">${portraitHtml(d.portrait, d.avatar, 96, { still: d.still })}</div>
    <label class="ui-nc-field"><span class="ui-kicker">Name</span>
      <input class="ui-nc-input" type="text" maxlength="16" autocomplete="off" autocapitalize="words" spellcheck="false" enterkeyhint="done" value="${esc(d.name)}" placeholder="3 to 16 letters or numbers">
    </label>
    <p class="ui-nc-hint" aria-live="polite">&nbsp;</p>
    <p class="ui-nc-rule">${esc(d.rule)}</p>
    ${groups.map(([title, f]) => {
      const ps = d.portraits.filter(f);
      return ps.length ? `<h2 class="ui-h2">${title}</h2><div class="ui-nc-picks">${ps.map(pick).join('')}</div>` : '';
    }).join('')}
    <div class="ui-stack ui-nc-actions">
      ${btn('save', d.joined ? 'Save' : 'Join the ladder', 'check', 'primary big wide')}
      ${d.joined ? `<button type="button" class="ui-nc-forget" data-action="forget">Delete my ladder name and scores</button>` : ''}
    </div>
  </div></div>`);
  root.addEventListener('change', e => {
    const t = e.target as HTMLInputElement;
    if (t.name !== 'ui-pt') return;
    root.querySelector('.ui-nc-preview')!.innerHTML = portraitHtml(t.value, d.avatar, 96, { still: d.still });
  });
  return root;
}

/** The name card's choice now. */
export function readNameCard(card: HTMLElement): { name: string; portrait: string } {
  return {
    name: card.querySelector<HTMLInputElement>('.ui-nc-input')?.value ?? '',
    portrait: card.querySelector<HTMLInputElement>('input[name="ui-pt"]:checked')?.value ?? '',
  };
}

/** The hint under the name field: what's wrong (`ok` false, red) or that it's good to go. Disables Save while wrong. */
export function setNameHint(card: HTMLElement, text: string, ok: boolean): void {
  const p = card.querySelector<HTMLElement>('.ui-nc-hint');
  if (p) { p.textContent = text || ' '; p.classList.toggle('bad', !ok); p.classList.toggle('good', ok && !!text); }
  const save = card.querySelector<HTMLButtonElement>('[data-action="save"]');
  if (save) save.classList.toggle('locked', !ok);
}

/** The name card's busy state while the ladder answers. */
export function setNameBusy(card: HTMLElement, busy: boolean): void {
  card.querySelector('.ui-namecard')?.classList.toggle('busy', busy);
}

/** The delete button's "are you sure" state (two taps, like the Daily's scored try). */
export function armForget(card: HTMLElement, on: boolean): void {
  const b = card.querySelector<HTMLElement>('[data-action="forget"]');
  if (!b) return;
  b.classList.toggle('armed', on);
  b.textContent = on ? 'Tap again to delete your name and scores' : 'Delete my ladder name and scores';
}

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

const CSS = `
.ui-ld { display: flex; flex-direction: column; gap: 6px; text-align: left; }
.ui-ld-head { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.ui-ld-head .ui-chip { font-size: 12px; padding: 2px 7px; border-width: 2px; }
.ui-ld-head .ui-chip img { width: 14px; height: 14px; }
.ui-ld-list { list-style: none; margin: 0; padding: 2px; display: flex; flex-direction: column; gap: 4px; max-height: min(38vh, 300px); overflow-y: auto; overscroll-behavior: contain; }
.ui-ld-row { position: relative; display: grid; grid-template-columns: 24px 34px minmax(0, 1fr) auto 30px; gap: 7px; align-items: center; background: #fff; border: 2px solid var(--ink); border-radius: 12px; padding: 3px 4px 3px 4px; font: 700 14px/1.2 var(--body); }
.ui-ld-row.me { background: #FFF3CF; border-width: 3px; }
.ui-ld-row.pinned { margin-top: 6px; }
.ui-ld-row.pinned::before { content: '⋯'; position: absolute; top: -13px; left: 0; right: 0; text-align: center; font: 700 14px/1 var(--display); color: var(--ink-soft); }
.ui-ld-rank { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--paper-2); border: 2px solid var(--ink); font: 700 12px/1 var(--display); font-variant-numeric: tabular-nums; }
.ui-ld-rank.top1 { background: var(--gold); } .ui-ld-rank.top2 { background: #DDE3EA; } .ui-ld-rank.top3 { background: #E8B07A; }
.ui-ld-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-ld-name em { font-style: normal; font-size: 11px; color: #fff; background: var(--xp); border-radius: 6px; padding: 1px 5px; vertical-align: 1px; }
.ui-ld-live img { width: 14px; height: 14px; vertical-align: -2px; opacity: 0.7; }
.ui-ld-row b { font: 700 16px/1 var(--display); text-align: right; font-variant-numeric: tabular-nums; }
.ui-ld-row b small { font-size: 11px; }
/* The flag is small to look at, 44 px to tap (it reaches past the row's padding). */
.ui-ld-flag { display: grid; place-items: center; width: 44px; height: 44px; margin: -8px -8px -8px -6px; border: 0; padding: 0; background: none; border-radius: 50%; cursor: pointer; opacity: 0.45; }
.ui-ld-flag:active, button.ui-ld-flag:hover { opacity: 1; background: var(--paper-2); }
.ui-ld-flag img { width: 16px; height: 16px; }
.ui-ld-row.asking { background: #FFE9EC; }
.ui-ld-confirm { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; padding: 2px 2px 2px 4px; font: 700 13px/1.2 var(--body); }
.ui-ld-confirm[hidden] { display: none; }
.ui-ld-confirm > span { margin-right: auto; }
.ui-ld-confirm .ui-btn { min-height: 44px; padding: 4px 12px; font-size: 15px; }
.ui-btn.danger { background: var(--danger); color: #fff; }
.ui-ld-msg { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 2px 0; padding: 10px; background: rgba(255,255,255,0.7); border: 3px dashed rgba(34,24,58,0.3); border-radius: 12px; font: 700 13px/1.3 var(--body); color: var(--ink-soft); }
.ui-ld-msg > img { width: 18px; height: 18px; flex: none; }
.ui-ld-msg > span { flex: 1 1 160px; }
.ui-ld-msg.loading > img { animation: ui-ld-bob 900ms ease-in-out infinite; }
@keyframes ui-ld-bob { 50% { transform: translateY(-3px); } }
.ui-ld-note { margin: 0 2px; font: 700 12px/1.3 var(--body); color: var(--ink-soft); }
.ui-ld-you { display: grid; grid-template-columns: 40px minmax(0, 1fr) auto; gap: 8px; align-items: center; background: #fff; border: 3px solid var(--ink); border-radius: 14px; padding: 5px 6px 5px 5px; }
.ui-ld-you.join { background: #EFEAFF; }
.ui-ld-you > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ui-ld-you b { font: 700 17px/1.1 var(--display); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-ld-you span span { font: 700 12px/1.25 var(--body); color: var(--ink-soft); }
.ui-ld-you .ui-kicker { color: var(--ink-soft); }
.ui-ld-you .ui-btn, .ui-ld-msg .ui-btn { min-height: 44px; padding: 4px 12px; font-size: 15px; }
.ui-namecard { padding-top: 16px; text-align: center; }
.ui-namecard.busy { pointer-events: none; }
.ui-namecard.busy [data-action="save"] { opacity: 0.6; }
.ui-namecard .ui-h1 { margin: 0 34px 8px; }
.ui-nc-preview { display: flex; justify-content: center; margin-bottom: 8px; }
.ui-nc-field { display: flex; flex-direction: column; gap: 4px; text-align: left; }
.ui-nc-input { -webkit-user-select: text; user-select: text; width: 100%; font: 700 20px/1.2 var(--display); color: var(--ink); background: #fff; border: 3px solid var(--ink); border-radius: 12px; padding: 9px 12px; box-shadow: inset 0 3px 0 rgba(34,24,58,0.08); outline: none; }
.ui-nc-input:focus { border-color: var(--xp); box-shadow: 0 0 0 3px rgba(124,92,255,0.25); }
.ui-nc-hint { min-height: 1.3em; margin: 4px 2px 0; font: 700 13px/1.3 var(--body); text-align: left; color: var(--ink-soft); }
.ui-nc-hint.bad { color: var(--danger); }
.ui-nc-hint.good { color: #1FA071; }
.ui-nc-rule { margin: 2px 2px 0; font: 600 12px/1.3 var(--body); text-align: left; color: var(--ink-soft); }
.ui-nc-picks { display: grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); gap: 8px 6px; }
.ui-pt-pick { position: relative; display: flex; flex-direction: column; align-items: center; gap: 11px; cursor: pointer; }
.ui-pt-pick input { position: absolute; opacity: 0; pointer-events: none; }
.ui-pt-pick > span { position: relative; display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; transition: transform 120ms; }
.ui-pt-pick input:checked + span { box-shadow: 0 0 0 4px var(--gold), 0 0 0 7px var(--ink); transform: scale(1.04); }
.ui-pt-pick input:focus-visible + span { outline: 3px solid var(--xp); outline-offset: 5px; }
.ui-pt-pick.locked { cursor: default; }
.ui-pt-pick.locked .ui-portrait { filter: grayscale(0.85) brightness(1.05); opacity: 0.6; }
.ui-pt-pick > span > i { position: absolute; right: -2px; bottom: -2px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 2px solid var(--ink); }
.ui-pt-pick > span > i img { width: 13px; height: 13px; }
.ui-pt-pick small { font: 700 11px/1.15 var(--body); color: var(--ink-soft); max-width: 76px; }
.ui-nc-actions { margin-top: 14px; }
.ui-nc-forget { min-height: 44px; border: 0; background: none; font: 700 13px/1.3 var(--body); color: var(--danger); text-decoration: underline; padding: 6px; cursor: pointer; }
.ui-nc-forget.armed { color: #fff; background: var(--danger); border-radius: 10px; text-decoration: none; }
@media (max-height: 700px) {
  .ui-ld-list { max-height: 30vh; }
  .ui-nc-preview .ui-portrait { --s: 72px !important; }
}
`;

/** Adds the ladder's rules to the page (the screens here do it themselves; for a delete button elsewhere). */
export function injectLadderCss(): void {
  if (typeof document === 'undefined' || document.getElementById('st-ui-ladder')) return;
  const style = document.createElement('style');
  style.id = 'st-ui-ladder';
  style.textContent = CSS;
  document.head.appendChild(style);
}
