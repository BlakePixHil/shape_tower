// "Your look" and the level track (monetisation plan v2; build plan Part B): the picker for the five
// cosmetic slots, the two-lane level track for the profile, and the pass reward beside the free one in
// the XP tally. Locked items say what unlocks them ("Level 12", "Builder's Pass", "Workshop", "Supporter
// Pack"), never a price; the ones a purchase unlocks open the Workshop when tapped (action workshop,
// data-id the product, data-item the cosmetic). Needs uiCss(); adds its own rules once.

import {
  COSMETIC_SLOTS, type CosmeticDef, type CosmeticLook, type CosmeticSlot, DEFAULT_LOOK, PASS_LAST_NEW, SLOT_NAMES,
  cosmetic, passRewardAt, passRewardsBetween, slotItems,
} from '../cosmetics.ts';
import { cosmeticUrl, lookPreviewUrl } from './cosmeticArt.ts';
import { hatUrl } from './hats.ts';
import { type UiIcon, uiIconUrl } from './icons.ts';
import { type AvatarSpec, rewardAt } from './screens.ts';

const esc = (s: string): string => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const icon = (name: UiIcon, px = 24): string => `<img alt="" src="${uiIconUrl(name, px)}">`;

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

// ---------------------------------------------------------------------------------------------
// Who owns what

/** What the player has: their level, and what they've bought (from the store). */
export interface CosmeticOwner {
  level: number;
  /** Owns the Builder's Pass (directly or through the Supporter Pack). */
  pass: boolean;
  /** Workshop set product ids they own. */
  sets?: string[];
  /** Owns the Supporter Pack (or its upgrade). */
  supporter?: boolean;
}

/** Whether the player has item `id` (a default, a level reached, a pass reward reached with the pass, a set or the supporter hat they own). */
export function cosmeticOwned(id: string, o: CosmeticOwner): boolean {
  const d = cosmetic(id);
  if (!d) return false;
  switch (d.source) {
    case 'default': return true;
    case 'level': return o.level >= (d.level ?? 1);
    case 'pass': return o.pass && o.level >= (d.level ?? 1);
    case 'set': return !!d.set && !!o.sets?.includes(d.set);
    case 'supporter': return !!o.supporter;
  }
}

/**
 * What a locked item says, the chip on its tile (short enough for a 64 px tile: the pass's chip is its
 * ticket and "Pass"), and the product that unlocks it (tapping opens the Workshop there). Null if it's theirs.
 */
export interface CosmeticLock { label: string; chip: string; product?: string }

export function cosmeticLock(id: string, o: CosmeticOwner): CosmeticLock | null {
  const d = cosmetic(id);
  if (!d || cosmeticOwned(id, o)) return null;
  if (d.source === 'level' || (d.source === 'pass' && o.pass)) return { label: `Level ${d.level}`, chip: `Level ${d.level}` };
  if (d.source === 'pass') return { label: "Builder's Pass", chip: 'Pass', product: 'builders_pass' };
  if (d.source === 'set') return { label: 'Workshop', chip: 'Workshop', product: d.set };
  return { label: 'Supporter Pack', chip: 'Supporter', product: 'supporter_pack' };
}

/** A look with every slot filled in, falling back to the default for missing ids and ids the player doesn't own. */
export function ownedLook(look: CosmeticLook, o: CosmeticOwner): Required<CosmeticLook> {
  const pick = (slot: Exclude<CosmeticSlot, 'hat'>): string => { const id = look[slot]; return id && cosmetic(id)?.slot === slot && cosmeticOwned(id, o) ? id : DEFAULT_LOOK[slot]!; };
  const hat = look.hat === null ? null : look.hat && cosmetic(look.hat)?.slot === 'hat' && cosmeticOwned(look.hat, o) ? look.hat : look.hat === undefined ? DEFAULT_LOOK.hat! : null;
  return { skin: pick('skin'), landing: pick('landing'), foundation: pick('foundation'), flag: pick('flag'), hat };
}

// ---------------------------------------------------------------------------------------------
// "Your look"

const SLOT_ICON: Record<CosmeticSlot, string> = { skin: 'skin_polka', landing: 'landing_stars', foundation: 'foundation_brick', flag: 'flag_pennant', hat: 'hat_hardhat' };

export interface LookPanelData {
  /** The current picks (unowned or unknown ids show as the default). */
  look: CosmeticLook;
  owner: CosmeticOwner;
  /** The player's Blockling, for the preview (its shape; the hat comes from the look). */
  avatar?: AvatarSpec;
  /** The tab to open on (default skin). */
  slot?: CosmeticSlot;
  still?: boolean;
}

function itemHtml(d: CosmeticDef, o: CosmeticOwner, on: boolean): string {
  const lock = cosmeticLock(d.id, o), img = `<img alt="" src="${cosmeticUrl(d.id, 52)}">`, name = `<b>${esc(d.name)}</b>`;
  if (!lock) return `<label class="ui-look-item"><input type="radio" name="ui-look-${d.slot}" data-slot="${d.slot}" value="${esc(d.id)}"${on ? ' checked' : ''} aria-label="${esc(d.name)}"><span>${img}</span>${name}</label>`;
  const chip = `<i>${icon(lock.product === 'builders_pass' ? 'pass' : 'lock', 12)}${esc(lock.chip)}</i>`;
  if (lock.product) return `<button type="button" class="ui-look-item shop" data-action="workshop" data-id="${esc(lock.product)}" data-item="${esc(d.id)}" aria-label="${esc(d.name)}, ${esc(lock.label)}"><span>${img}${chip}</span>${name}</button>`;
  return `<div class="ui-look-item locked" aria-label="${esc(d.name)}, unlocks at ${esc(lock.label.toLowerCase())}"><span>${img}${chip}</span>${name}</div>`;
}

function slotList(slot: CosmeticSlot, o: CosmeticOwner): CosmeticDef[] {
  const base = slotItems(slot);
  // Later pass variants they've reached, after the rest of the pass items.
  const later = o.pass && o.level > PASS_LAST_NEW ? passRewardsBetween(PASS_LAST_NEW + 1, o.level).filter(d => d.slot === slot) : [];
  const i = base.findIndex(d => d.source === 'set' || d.source === 'supporter');
  return i < 0 ? [...base, ...later] : [...base.slice(0, i), ...later, ...base.slice(i)];
}

/**
 * "Your look": a preview of the whole look over five tabs (Shape skin, Landing, Foundation, Flag, Hat),
 * each a grid of items. Owned items are picked with a tap (the preview follows; read them with
 * readLook); level-locked ones show their level; the rest open the Workshop. Actions: close, done,
 * workshop (data-id: builders_pass, set_<theme> or supporter_pack; data-item: the cosmetic).
 */
export function lookPanel(d: LookPanelData): HTMLElement {
  injectLookCss();
  const o = d.owner, look = ownedLook(d.look, o), shape = d.avatar?.shape ?? 'O', open = d.slot ?? 'skin';
  const tabs = COSMETIC_SLOTS.map(sl => `<button type="button" role="tab" class="ui-look-tab${sl === open ? ' on' : ''}" data-tab="${sl}" aria-selected="${sl === open}"><img alt="" src="${cosmeticUrl(SLOT_ICON[sl], 30)}"><span>${esc(SLOT_NAMES[sl])}</span></button>`).join('');
  const grids = COSMETIC_SLOTS.map(sl => {
    const items = slotList(sl, o).map(it => itemHtml(it, o, look[sl] === it.id));
    if (sl === 'hat') items.unshift(`<label class="ui-look-item"><input type="radio" name="ui-look-hat" data-slot="hat" value=""${look.hat ? '' : ' checked'} aria-label="No hat"><span>${icon('close', 30)}</span><b>No hat</b></label>`);
    return `<div class="ui-look-grid" role="tabpanel" data-grid="${sl}"${sl === open ? '' : ' hidden'}>${items.join('')}</div>`;
  }).join('');
  const root = el(`<div class="ui ui-overlay${d.still ? ' ui-still' : ''}" role="dialog" aria-label="Your look"><div class="ui-panel ui-look">
    <button type="button" class="ui-btn icon sm ui-close" data-action="close" aria-label="Close">${icon('close', 20)}</button>
    <h1 class="ui-h1">Your look</h1>
    <img class="ui-look-prev" alt="Your look" src="${lookPreviewUrl(look, shape)}">
    <div class="ui-look-tabs" role="tablist">${tabs}</div>
    ${grids}
    <button type="button" class="ui-btn primary" data-action="done">Done</button>
  </div></div>`);
  root.addEventListener('click', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (!t) return;
    const sl = t.dataset.tab!;
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach(b => { b.classList.toggle('on', b === t); b.setAttribute('aria-selected', String(b === t)); });
    root.querySelectorAll<HTMLElement>('[data-grid]').forEach(g => { g.hidden = g.dataset.grid !== sl; });
  });
  root.addEventListener('change', () => {
    (root.querySelector('.ui-look-prev') as HTMLImageElement).src = lookPreviewUrl(readLook(root), shape);
  });
  return root;
}

/** The picks a "Your look" panel shows now. `hat` is the cosmetic id (null: no hat); hatFor(id) gives avatar.hat. */
export function readLook(panel: HTMLElement): Required<CosmeticLook> {
  const v = (slot: string): string | undefined => panel.querySelector<HTMLInputElement>(`input[data-slot="${slot}"]:checked`)?.value;
  return { skin: v('skin') ?? DEFAULT_LOOK.skin!, landing: v('landing') ?? DEFAULT_LOOK.landing!, foundation: v('foundation') ?? DEFAULT_LOOK.foundation!, flag: v('flag') ?? DEFAULT_LOOK.flag!, hat: v('hat') || null };
}

// ---------------------------------------------------------------------------------------------
// The level track

export interface LevelTrackData {
  level: number;
  /** Owns the Builder's Pass: its lane shows in colour. Without it the lane is greyed and opens the Workshop. */
  pass: boolean;
  /** Last level shown (default: 60, or 15 past their level, whichever is further, to a multiple of 5). */
  to?: number;
}

function freeIcon(level: number, px: number): string {
  const r = rewardAt(level);
  if (!r) return '';
  return r.hat ? `<img alt="" src="${hatUrl(r.hat, px)}">` : `<img alt="" src="${uiIconUrl(r.icon, px)}">`;
}

/**
 * The two-lane level track for the profile: the free lane (what levels give) over the Builder's Pass lane,
 * a column per level with the player's level marked, scrolled to it. For non-owners the pass lane's
 * rewards are small greyed icons labelled Builder's Pass, and tapping one opens the Workshop (action
 * workshop, data-id builders_pass, data-item the reward). Every level to 60, then each one with a reward
 * and the player's own.
 */
export function levelTrack(d: LevelTrackData): HTMLElement {
  injectLookCss();
  const L = d.level, to = d.to ?? Math.ceil(Math.max(PASS_LAST_NEW, L + 15) / 5) * 5, cols: string[] = [];
  for (let lv = 1; lv <= to; lv++) {
    const pr = passRewardAt(lv), fr = rewardAt(lv);
    if (lv > PASS_LAST_NEW && !pr && !fr && lv !== L) continue;
    const st = lv < L ? 'got' : lv === L ? 'now' : 'next';
    const free = `<div class="ui-trk-free" title="${esc(fr?.name ?? '')}">${lv > 1 ? freeIcon(lv, 30) : ''}</div>`;
    const pass = !pr ? '<div class="ui-trk-pass"></div>' : d.pass
      ? `<div class="ui-trk-pass${lv <= L ? ' got' : ''}" title="${esc(pr.name)}"><img alt="${esc(pr.name)}" src="${cosmeticUrl(pr.id, 34)}">${lv <= L ? `<i>${icon('check', 12)}</i>` : ''}</div>`
      : `<button type="button" class="ui-trk-pass locked" data-action="workshop" data-id="builders_pass" data-item="${esc(pr.id)}" aria-label="${esc(pr.name)}, Builder's Pass"><img alt="" src="${cosmeticUrl(pr.id, 34)}"><i>${icon('lock', 11)}</i></button>`;
    cols.push(`<div class="ui-trk-col ${st}" data-level="${lv}">${free}<div class="ui-trk-lv"><span>${lv}</span></div>${pass}</div>`);
  }
  const root = el(`<div class="ui ui-trk${d.pass ? ' has-pass' : ''}">
    <div class="ui-trk-names"><span>Free</span><span>Level</span><span class="pass">${icon('pass', 16)}Builder's Pass</span></div>
    <div class="ui-trk-scroll"><div class="ui-trk-row">${cols.join('')}</div></div>
  </div>`);
  const go = () => scrollTrackTo(root, L, false);
  if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(go);
  return root;
}

/** Scroll a level track so `level`'s column sits in the middle. */
export function scrollTrackTo(track: HTMLElement, level: number, smooth = true): void {
  const sc = track.querySelector<HTMLElement>('.ui-trk-scroll'), col = track.querySelector<HTMLElement>(`.ui-trk-col[data-level="${level}"]`);
  if (!sc || !col) return;
  sc.scrollTo({ left: col.offsetLeft - sc.clientWidth / 2 + col.offsetWidth / 2, behavior: smooth ? 'smooth' : 'auto' });
}

// ---------------------------------------------------------------------------------------------
// The XP tally's rewards

/**
 * What reaching `level` gave, for the run summary's XP tally: the free reward, and beside it the level's
 * Builder's Pass reward. For non-owners that one is greyed and labelled Builder's Pass, and tapping it
 * opens the Workshop (action workshop, data-id builders_pass); it's not a button to look at. Null when
 * the level gives neither.
 */
export function levelRewards(level: number, o: { pass: boolean }): HTMLElement | null {
  injectLookCss();
  const fr = level > 1 ? rewardAt(level) : undefined, pr = passRewardAt(level);
  if (!fr && !pr) return null;
  const free = fr ? `<div class="ui-lvr-item">${freeIcon(level, 40)}<div><span class="ui-kicker">Level ${level}</span><b>${esc(fr.name)}</b></div></div>` : '';
  const pass = !pr ? '' : o.pass
    ? `<div class="ui-lvr-item pass"><img alt="" src="${cosmeticUrl(pr.id, 40)}"><div><span class="ui-kicker">${icon('pass', 12)}Builder's Pass</span><b>${esc(pr.name)}</b></div></div>`
    : `<div class="ui-lvr-item pass locked" data-action="workshop" data-id="builders_pass" data-item="${esc(pr.id)}"><img alt="" src="${cosmeticUrl(pr.id, 40)}"><div><span class="ui-kicker">${icon('lock', 12)}Builder's Pass</span><b>${esc(pr.name)}</b></div></div>`;
  return el(`<div class="ui ui-lvr">${free}${pass}</div>`);
}

const CSS = `
.ui-look { width: min(380px, 100%); max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); overflow-y: auto; overscroll-behavior: contain; padding: 16px 14px; }
.ui-look .ui-h1 { margin: 0 0 10px; }
.ui-look-prev { display: block; width: 100%; aspect-ratio: 2 / 1; border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 3px 0 var(--ink); background: #CDEBFF; }
.ui-look-tabs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin: 12px 0 10px; }
.ui-look-tab { appearance: none; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 52px; padding: 4px 2px; background: #fff; border: 3px solid var(--ink); border-radius: 12px; box-shadow: 0 3px 0 var(--ink); font: 700 10px/1.1 var(--display); color: var(--ink); cursor: pointer; }
.ui-look-tab img { width: 28px; height: 28px; }
.ui-look-tab.on { background: var(--gold); }
.ui-look-tab:active { transform: translateY(3px); box-shadow: 0 0 0 var(--ink); }
.ui-look-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 10px 6px; margin-bottom: 14px; }
.ui-look-grid[hidden] { display: none; }
.ui-look-item { appearance: none; margin: 0; padding: 0; position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px; background: none; border: 0; font: inherit; color: var(--ink); cursor: pointer; min-width: 0; }
.ui-look-item input { position: absolute; opacity: 0; pointer-events: none; }
.ui-look-item > span { position: relative; display: grid; place-items: center; width: 64px; height: 64px; background: #fff; border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 3px 0 var(--ink); transition: transform 120ms; }
.ui-look-item > span > img { width: 52px; height: 52px; }
.ui-look-item b { font: 700 11px/1.15 var(--display); text-align: center; max-width: 76px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ui-look-item input:checked + span { background: var(--gold); box-shadow: 0 0 0 3px var(--gold), 0 3px 0 3px var(--ink); transform: scale(1.04); }
.ui-look-item input:focus-visible + span { outline: 3px solid var(--xp); outline-offset: 3px; }
.ui-look-item:active > span { transform: translateY(3px) scale(0.96); box-shadow: 0 0 0 var(--ink); }
.ui-look-item.locked, .ui-look-item.shop { cursor: default; }
.ui-look-item.shop { cursor: pointer; }
.ui-look-item.locked > span, .ui-look-item.shop > span { background: var(--paper-2); border-color: var(--ink-soft); box-shadow: 0 3px 0 var(--ink-soft); }
.ui-look-item.locked > span > img, .ui-look-item.shop > span > img { filter: grayscale(0.85); opacity: 0.55; }
.ui-look-item.locked b, .ui-look-item.shop b { color: var(--ink-soft); }
.ui-look-item i { position: absolute; left: 50%; bottom: -9px; transform: translateX(-50%); display: flex; align-items: center; gap: 2px; font: 700 9.5px/1 var(--display); font-style: normal; white-space: nowrap;
  background: var(--paper); border: 2px solid var(--ink); border-radius: 8px; padding: 2px 5px 2px 3px; box-shadow: 0 2px 0 var(--ink); }
.ui-look-item i img { width: 11px; height: 11px; }
.ui-look-item.shop i { background: #E6DEFF; }
.ui-look-item > b { margin-top: 6px; }
.ui-look > .ui-btn.primary { width: 100%; }

.ui-trk { display: flex; align-items: stretch; gap: 6px; background: #fff; border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 3px 0 var(--ink); padding: 6px 0 6px 6px; overflow: hidden; }
.ui-trk-names { flex: none; display: grid; grid-template-rows: 44px 26px 50px; align-items: center; font: 700 10px/1.1 var(--display); color: var(--ink-soft); text-align: left; width: 58px; }
.ui-trk-names .pass { display: flex; align-items: center; gap: 2px; color: #6F35D1; }
.ui-trk-names .pass img { width: 16px; height: 16px; flex: none; }
.ui-trk-scroll { flex: 1; min-width: 0; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 10px, #000 calc(100% - 14px), transparent); mask-image: linear-gradient(90deg, transparent 0, #000 10px, #000 calc(100% - 14px), transparent); }
.ui-trk-scroll::-webkit-scrollbar { display: none; }
.ui-trk-row { display: flex; padding: 0 12px 0 6px; }
.ui-trk-col { flex: none; width: 48px; display: grid; grid-template-rows: 44px 26px 50px; justify-items: center; align-items: center; position: relative; }
.ui-trk-free img { width: 30px; height: 30px; }
.ui-trk-lv { position: relative; width: 100%; height: 26px; display: grid; place-items: center; }
.ui-trk-lv::before { content: ''; position: absolute; left: 0; right: 0; top: 50%; height: 6px; margin-top: -3px; background: var(--paper-2); border-top: 2px solid var(--ink); border-bottom: 2px solid var(--ink); }
.ui-trk-col.got .ui-trk-lv::before, .ui-trk-col.now .ui-trk-lv::before { background: var(--xp); }
.ui-trk-lv span { position: relative; min-width: 24px; height: 22px; padding: 0 3px; display: grid; place-items: center; font: 700 11px/1 var(--display); background: var(--paper); border: 2px solid var(--ink); border-radius: 11px; font-variant-numeric: tabular-nums; }
.ui-trk-col.got .ui-trk-lv span { background: #E6DEFF; }
.ui-trk-col.now .ui-trk-lv span { background: var(--gold); transform: scale(1.18); box-shadow: 0 2px 0 var(--ink); }
.ui-trk-col.now::after { content: ''; position: absolute; inset: 0 2px; border-radius: 10px; background: rgba(255,194,61,0.18); z-index: -1; }
.ui-trk-pass { appearance: none; margin: 0; padding: 0; position: relative; width: 44px; height: 44px; display: grid; place-items: center; background: #F3ECFF; border: 2px solid var(--ink); border-radius: 10px; }
.ui-trk-pass:empty { background: none; border: 0; }
.ui-trk-pass img { width: 34px; height: 34px; }
.ui-trk-pass i { position: absolute; right: -5px; bottom: -5px; width: 18px; height: 18px; display: grid; place-items: center; background: var(--mint); border: 2px solid var(--ink); border-radius: 50%; }
.ui-trk-pass i img { width: 12px; height: 12px; }
.ui-trk-pass.locked { background: var(--paper-2); border-color: var(--ink-soft); cursor: pointer; }
.ui-trk-pass.locked img { filter: grayscale(1); opacity: 0.45; }
.ui-trk-pass.locked i { background: var(--paper); border-color: var(--ink-soft); }
.ui-trk-col.next .ui-trk-free img { opacity: 0.6; }

.ui-lvr { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
.ui-lvr-item { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 140px; max-width: 220px; text-align: left; background: #fff; border: 3px solid var(--ink); border-radius: 14px; box-shadow: 0 3px 0 var(--ink); padding: 6px 10px 6px 6px; }
.ui-lvr-item > img { width: 40px; height: 40px; flex: none; }
.ui-lvr-item .ui-kicker { display: flex; align-items: center; gap: 3px; font-size: 10px; }
.ui-lvr-item .ui-kicker img { width: 12px; height: 12px; }
.ui-lvr-item b { display: block; font: 700 14px/1.15 var(--display); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-lvr-item.pass { background: #F3ECFF; }
.ui-lvr-item.locked { background: var(--paper-2); border-color: var(--ink-soft); box-shadow: 0 3px 0 var(--ink-soft); cursor: pointer; }
.ui-lvr-item.locked > img { filter: grayscale(1); opacity: 0.5; }
.ui-lvr-item.locked b { color: var(--ink-soft); }

`;

/** Add the look, track and tally rules to the page once (the builders here call it). */
export function injectLookCss(): void {
  if (typeof document === 'undefined' || document.getElementById('st-ui-look')) return;
  const style = document.createElement('style');
  style.id = 'st-ui-look';
  style.textContent = CSS;
  document.head.appendChild(style);
}
