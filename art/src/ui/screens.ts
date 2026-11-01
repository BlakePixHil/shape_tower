// Screen pieces for the full game (art-direction.md §8.3, §8.4): the main menu, pause card, run summary
// with the XP bar and lines, level-up takeover, profile and settings. Each builder takes plain data and
// returns an element to append to document.body; the game keeps the logic. Buttons carry data-action
// (bind them with onAction). Call injectUiCss() and await loadUiFonts() first: badges and logo letters
// are drawn text.

import { FONT_BODY, FONT_DISPLAY, INK } from '../config.ts';
import { drawPiece } from '../piece.ts';
import { ART_SHAPES, pose } from '../shapes.ts';
import { BIOMES } from '../biomes.ts';
import { type Expression, drawFace } from '../face.ts';
import { faceAnchor } from '../geometry.ts';
import { type Ctx, ctx2d, hash, makeCanvas } from '../util.ts';
import { achievementsRow } from './achievements.ts';
import { badgeTier, badgeUrl, newTitleAt, titleFor } from './badge.ts';
import { type UiIcon, uiIconUrl } from './icons.ts';
import { logoElement } from './logo.ts';
import { HATS, type Hat, drawHat, hatInfo, hatUrl } from './hats.ts';
import { postcardElement } from './postcard.ts';
import { SLOT_NAMES, passRewardAt } from '../cosmetics.ts';
import { cosmeticUrl } from './cosmeticArt.ts';
import { portraitHtml } from './portraits.ts';
import { part, rrPath } from '../sticker.ts';

const DPR = (): number => (typeof window !== 'undefined' ? Math.min(3, window.devicePixelRatio || 1) : 1);
const esc = (s: string): string => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const icon = (name: UiIcon, px = 24): string => `<img alt="" src="${uiIconUrl(name, px)}">`;
const badge = (level: number, px: number, cls = ''): string =>
  `<img class="ui-badge${badgeTier(level).name === 'Cosmic' ? ' cosmic' : ''}${cls ? ` ${cls}` : ''}" style="--s:${px}px" alt="Level ${level}" src="${badgeUrl(level, px)}">`;
const btn = (action: string, label: string, ic?: UiIcon, cls = ''): string =>
  `<button type="button" class="ui-btn${cls ? ` ${cls}` : ''}" data-action="${action}">${ic ? icon(ic, cls.includes('big') ? 30 : 24) : ''}${label}</button>`;
const iconBtn = (action: string, ic: UiIcon, label: string, cls = ''): string =>
  `<button type="button" class="ui-btn icon${cls ? ` ${cls}` : ''}" data-action="${action}" aria-label="${label}">${icon(ic, cls.includes('sm') ? 20 : 24)}</button>`;

function el(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

/** Wait for the kit's fonts (Fredoka, Nunito) so nothing bakes with a fallback face. Resolves anyway after `ms`. */
export async function loadUiFonts(ms = 3000): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return;
  const load = Promise.all([`700 20px ${FONT_DISPLAY}`, `600 20px ${FONT_DISPLAY}`, `700 20px ${FONT_BODY}`, `800 20px ${FONT_BODY}`].map(f => document.fonts.load(f)));
  await Promise.race([load.then(() => undefined, () => undefined), new Promise<void>(r => setTimeout(r, ms))]);
}

/** Calls fn(action, button) when any [data-action] inside root is tapped. Returns an unbind function. */
export function onAction(root: HTMLElement, fn: (action: string, target: HTMLElement) => void): () => void {
  const h = (e: Event): void => {
    const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (t && root.contains(t) && !t.classList.contains('locked')) fn(t.dataset.action!, t);
  };
  root.addEventListener('click', h);
  return () => root.removeEventListener('click', h);
}

// ---------------------------------------------------------------------------------------------
// Unlocks (gameplay.md §10.3) and what the XP bar is heading for

export interface Unlock { level: number; icon: UiIcon; name: string; text: string; /** A hat unlock shows the hat instead of the icon. */ hat?: Hat }

/** Gameplay unlocks. Titles (every 5 levels) and badge tiers (every 10) come from badge.ts. */
export const UNLOCKS: Unlock[] = [
  { level: 2, icon: 'hold', name: 'Hold slot', text: 'Tap the Hold card to save a shape for later.' },
  { level: 3, icon: 'daily', name: 'Daily Tower', text: 'The same tower for everyone. One scored try a day.' },
  { level: 6, icon: 'gift', name: 'Head start', text: 'Every run now starts with a power-up in a slot.' },
  { level: 8, icon: 'zen', name: 'Zen mode', text: 'No budget, unlimited hearts, half XP. Just build.' },
];

/** What reaching `level` gives, for the level-up's unlock card: a gameplay unlock, a hat, else a new badge or title. */
export function rewardAt(level: number): Unlock | undefined {
  const u = UNLOCKS.find(x => x.level === level);
  if (u) return u;
  const h = HATS.find(x => x.level === level && level > 1);
  if (h) return { level, icon: 'gift', name: h.name, text: 'A new hat for your Blockling. Try it on in your profile.', hat: h.key };
  const t = badgeTier(level);
  if (t.from === level && level > 1) return { level, icon: 'star', name: `${t.name} badge`, text: 'A new frame for your level badge.' };
  if (newTitleAt(level) && level > 1) return { level, icon: 'crown', name: titleFor(level), text: 'A new title for your profile.' };
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// XP bar

export interface XpState {
  level: number;
  /** XP into the current level. */
  into: number;
  /** XP this level's step needs (gameplay.md §10.2: 50 × L^1.65 + 50, rounded to 10). */
  need: number;
}

function nextHtml(level: number): string {
  const r = rewardAt(level + 1);
  return r ? (r.hat ? `<img alt="" src="${hatUrl(r.hat, 20)}">` : icon(r.icon, 18)) : badge(level + 1, 24);
}

/** The XP bar: badge, striped violet track with "1,240 / 1,930 XP", and what the next level gives. `badge: false` leaves the badge off. */
export function xpBar(s: XpState, o: { badge?: boolean } = {}): HTMLElement {
  const root = el(`<div class="ui ui-xp" data-level="${s.level}">${o.badge === false ? '' : badge(s.level, 34)}<div class="ui-xp-track"><div class="ui-xp-fill"></div><div class="ui-xp-text"></div></div><span class="ui-xp-next" title="Next level"></span></div>`);
  setXpBar(root, s);
  return root;
}

/** Update a bar built by xpBar (or any element containing one). The fill eases; the badge swaps on a new level. */
export function setXpBar(host: HTMLElement, s: XpState): void {
  const root = host.classList.contains('ui-xp') ? host : host.querySelector<HTMLElement>('.ui-xp');
  if (!root) return;
  const f = Math.max(0, Math.min(1, s.need > 0 ? s.into / s.need : 0));
  root.querySelector<HTMLElement>('.ui-xp-fill')!.style.setProperty('--fill', `${(f * 100).toFixed(2)}%`);
  root.querySelector<HTMLElement>('.ui-xp-text')!.textContent = `${num(s.into)} / ${num(s.need)} XP`;
  const next = root.querySelector<HTMLElement>('.ui-xp-next')!;
  if (root.dataset.level !== String(s.level) || !next.firstChild) {
    root.dataset.level = String(s.level);
    const b = root.querySelector(':scope > .ui-badge');
    if (b) b.outerHTML = badge(s.level, 34);
    next.innerHTML = nextHtml(s.level);
    next.classList.toggle('lvl', !rewardAt(s.level + 1));
  }
}

// ---------------------------------------------------------------------------------------------
// Pause

export interface PauseOptions {
  /** Show "Quitting halves this run's XP" (default true; off in Zen, where quitting is how a run ends). */
  quitHalves?: boolean;
}

/** The pause card on an Ink overlay. Actions: resume, restart, settings, quit. */
export function pauseCard(o: PauseOptions = {}): HTMLElement {
  return el(`<div class="ui ui-overlay" role="dialog" aria-label="Paused"><div class="ui-panel">
    <h1 class="ui-h1">Paused</h1>
    <div class="ui-stack">
      ${btn('resume', 'Resume', 'play', 'primary big wide')}
      <div class="ui-row">${btn('restart', 'Restart', 'restart', 'wide')}${btn('settings', 'Settings', 'settings', 'wide')}</div>
      ${btn('quit', 'Quit', 'home', 'wide')}
    </div>
    ${o.quitHalves === false ? '' : `<p class="ui-note">${icon('info', 16)}Quitting halves this run's XP</p>`}
  </div></div>`);
}

// ---------------------------------------------------------------------------------------------
// Run summary

export interface SummaryData {
  /** The headline: "Out of bricks!", "Out of hearts!", "You quit". */
  cause: string;
  /** Best height this run, in metres. */
  height: number;
  newBest?: boolean;
  /** Highest biome reached (0 = Meadow); its postcard goes on the card. */
  biome: number;
  score: number;
  checkpoints: number;
  perfects: number;
  rows: number;
  clutches: number;
  /** The bar as it stood before this run. */
  xp: XpState;
  /** The XP lines (profile Award.lines), shown one at a time with showXpLine. */
  lines: [string, string][];
  /** This run's total XP, the last line. */
  gained: number;
}

/**
 * The run summary card, sliding up on an overlay. XP lines start hidden: reveal them with showXpLine
 * while the bar fills with setXpBar. Put extra rows (QA's one-tap questions) in `.ui-sum-extra`.
 * Actions: again, profile, home, share.
 */
export function summaryCard(d: SummaryData): HTMLElement {
  const stat = (ic: UiIcon, n: number, label: string): string => `<div class="ui-stat">${icon(ic, 26)}<div><b>${num(n)}</b><span>${label}</span></div></div>`;
  const lines = [...d.lines.map(([k, v]) => `<div class="ui-line"><span>${esc(k)}</span><b>${esc(v)}</b></div>`),
    `<div class="ui-line total"><span>Total</span><b>+${num(d.gained)} XP</b></div>`].join('');
  const root = el(`<div class="ui ui-overlay" role="dialog" aria-label="Run summary"><div class="ui-panel ui-summary rise">
    <div class="ui-sum-head">
      <span class="ui-kicker">${esc(d.cause)}</span>
      <div class="ui-height ui-num">${d.height.toFixed(1)}<small>m</small></div>
      ${d.newBest ? `<span class="ui-chip gold ui-best">${icon('trophy', 18)}New best!</span>` : ''}
    </div>
    <div class="ui-sum-mid">
      <div class="ui-sum-card"></div>
      <div class="ui-sum-right">
        <div class="ui-score"><span>Score</span><b>${num(d.score)}</b></div>
        <div class="ui-stats">${stat('flag', d.checkpoints, 'Checkpoints')}${stat('perfect', d.perfects, 'Perfects')}${stat('row', d.rows, 'Solid Rows')}${stat('clutch', d.clutches, 'Clutches')}</div>
      </div>
    </div>
    <div class="ui-sum-xp"><div class="ui-lines">${lines}</div></div>
    <div class="ui-sum-extra"></div>
    <div class="ui-sum-actions">
      ${btn('again', 'Play again', 'restart', 'primary big wide')}
      <div class="ui-row">${btn('profile', 'Profile', 'profile', 'wide')}${btn('home', 'Home', 'home', 'wide')}${iconBtn('share', 'share', 'Share')}</div>
    </div>
  </div></div>`);
  root.querySelector('.ui-sum-card')!.replaceWith(postcardElement({ biome: d.biome, width: 104 }));
  root.querySelector('.ui-sum-xp')!.prepend(xpBar(d.xp));
  return root;
}

/** Reveal XP line i (the total is the last). Returns false when there is no line i. */
export function showXpLine(card: HTMLElement, i: number): boolean {
  const line = card.querySelectorAll('.ui-line')[i];
  if (!line) return false;
  line.classList.add('in');
  return true;
}

/** Reveal every XP line at once (Reduce Motion, or a tap to skip). */
export function showAllXpLines(card: HTMLElement): void {
  card.querySelectorAll('.ui-line').forEach(l => l.classList.add('in'));
}

// ---------------------------------------------------------------------------------------------
// Level up

export interface LevelUpOptions {
  level: number;
  /** The badge it flips from (default level - 1). */
  from?: number;
  /** The unlock card; default rewardAt(level). Pass null for none. */
  unlock?: Unlock | null;
  /**
   * The level's Builder's Pass reward (cosmetics.ts passRewardAt): 'owned' shows it unlocked under the free
   * one. 'intro' is the pass's one mention, on the level-10 card for players without it: the reward
   * greyed, a line about the pass, and "Take a look" (action workshop, data-id builders_pass) beside a
   * plain "Not now" (action continue). Leave it out for neither.
   */
  pass?: 'owned' | 'intro' | null;
  /** With 'intro': how many pass rewards they'd get at once (passRewardsBetween(2, level).length). */
  passWaiting?: number;
}

/** The level-up's Builder's Pass card. */
function passCard(level: number, mode: 'owned' | 'intro', waiting: number): string {
  const pr = passRewardAt(level);
  if (!pr) return '';
  const kicker = `<span class="ui-kicker">${icon('pass', 13)}Builder's Pass</span>`;
  const text = mode === 'owned' ? `A new ${SLOT_NAMES[pr.slot].toLowerCase()} for your look.`
    : `The pass adds a second reward like this at every level.${waiting > 1 ? ` ${waiting} are waiting for you already.` : ''}`;
  return `<div class="ui-unlock ui-lu-pass${mode === 'intro' ? ' intro' : ''}"><img alt="" src="${cosmeticUrl(pr.id, 52)}"><div>${kicker}<b>${esc(pr.name)}</b><span>${esc(text)}</span></div></div>`;
}

const CONFETTI = ['I', 'O', 'T', 'L', 'J', 'S', 'Z', 'Domino'].map(k => ART_SHAPES[k].base);

/** The level-up takeover: rays, the badge flips to the new number, confetti, title and unlock card (and the pass's, see `pass`). Action: continue (and workshop for the pass intro). */
export function levelUp(o: LevelUpOptions): HTMLElement {
  const L = o.level, from = o.from ?? Math.max(1, L - 1), u = o.unlock === undefined ? rewardAt(L) : o.unlock;
  let confetti = '';
  for (let i = 0; i < 46; i++) {
    const r = (k: number): number => hash(i * 7.31 + k * 1.7);
    confetti += `<i style="--x:${(r(1) * 100).toFixed(1)}%;--w:${(9 + r(2) * 9).toFixed(0)}px;--c:${CONFETTI[i % CONFETTI.length]};--d:${(1.8 + r(3) * 1.6).toFixed(2)}s;--t:${(0.55 + r(4) * 0.9).toFixed(2)}s;--dx:${((r(5) - 0.5) * 140).toFixed(0)}px;--rot:${((r(6) - 0.5) * 1080).toFixed(0)}deg"></i>`;
  }
  const title = newTitleAt(L) ? `<span class="ui-kicker">New title</span><span class="ui-plate">${esc(titleFor(L))}</span>` : `<span class="ui-plate">${esc(titleFor(L))}</span>`;
  // A new title is already the reward: skip a crown card that would repeat it.
  const card = u && !(u.icon === 'crown' && newTitleAt(L)) ? `<div class="ui-unlock">${u.hat ? `<img alt="" src="${hatUrl(u.hat, 52)}">` : icon(u.icon, 52)}<div><span class="ui-kicker">Unlocked</span><b>${esc(u.name)}</b><span>${esc(u.text)}</span></div></div>` : '';
  return el(`<div class="ui ui-levelup" role="dialog" aria-label="Level ${L}">
    <div class="ui-rays"></div>
    <div class="ui-confetti">${confetti}</div>
    <div class="ui-lu-title">Level up!</div>
    <div class="ui-flip"><div class="ui-flip-in"><img alt="" src="${badgeUrl(from, 132)}"><img alt="Level ${L}" src="${badgeUrl(L, 132)}"></div></div>
    <div class="ui-lu-name">${title}</div>
    ${card}
    ${o.pass ? passCard(L, o.pass, o.passWaiting ?? 0) : ''}
    ${o.pass === 'intro' && passRewardAt(L)
    ? `<div class="ui-lu-btns">${btn('workshop', 'Take a look', 'pass', 'primary').replace('data-action="workshop"', 'data-action="workshop" data-id="builders_pass"')}${btn('continue', 'Not now')}</div>`
    : btn('continue', 'Nice!', undefined, 'primary')}
  </div>`);
}

// ---------------------------------------------------------------------------------------------
// Avatar

export interface AvatarSpec {
  /** A key of ART_SHAPES (default 'O', the Butterblock). */
  shape?: string;
  face?: Expression;
  /** Default none. */
  hat?: Hat | null;
}

const avatars = new Map<string, string>();

/** The player's Blockling on a round sky disc, wearing its hat, as a cached PNG data URL `cssPx` square. */
export function avatarUrl(a: AvatarSpec = {}, cssPx = 56, dpr = DPR()): string {
  const key = a.shape ?? 'O', face = a.face ?? 'idle', hat = hatInfo(a.hat);
  const px = Math.round(cssPx * dpr), id = `${key}:${face}:${hat?.key ?? ''}:${px}`;
  let u = avatars.get(id);
  if (u) return u;
  const cv = makeCanvas(px, px), c = ctx2d(cv), R = px / 2, lw = Math.max(2, px * 0.055);
  const sky = BIOMES[0].sky, g = c.createLinearGradient(0, 0, 0, px);
  g.addColorStop(0, sky[0]); g.addColorStop(1, sky[2]);
  c.beginPath(); c.arc(R, R, R - lw / 2, 0, Math.PI * 2); c.fillStyle = g; c.fill();
  c.save(); c.clip();
  c.fillStyle = '#7FD36B'; c.fillRect(0, px * 0.8, px, px);
  drawAvatarFigure(c, a, px);
  c.restore();
  c.beginPath(); c.arc(R, R, R - lw / 2, 0, Math.PI * 2); c.lineWidth = lw; c.strokeStyle = INK; c.stroke();
  u = cv.toDataURL('image/png');
  avatars.set(id, u);
  return u;
}

/**
 * The avatar's Blockling in its hat, standing on the line 80% of the way down a `px` square disc (where
 * the avatar's grass starts), with nothing behind it. Portraits put it on their own backgrounds.
 */
export function drawAvatarFigure(c: Ctx, a: AvatarSpec, px: number): void {
  const key = a.shape ?? 'O', face = a.face ?? 'idle', hat = hatInfo(a.hat), R = px / 2;
  // A hat (about a block across) sits over the face; shrink the Blockling so both fit the disc. The flat
  // I would be a sliver at that size, so it spans most of the disc's width instead.
  const p = pose(key, 0), hw = 1.35, fit = p.w >= p.h * 3 ? (px * 0.8) / p.w : (px * 0.56) / Math.max(p.w, p.h, 1.6);
  const s = Math.min(fit, hat ? (px * 0.7) / (p.h + hat.h * hw) : Infinity);
  c.save();
  c.translate(R - (p.w * s) / 2, px * 0.8 - p.h * s + s * 0.04);
  drawPiece(c, key, 0, s, { face, shadow: false, detail: s >= 20 });
  if (hat) {
    const [ax] = faceAnchor(p), col = Math.min(p.w - 1, Math.floor(ax)), top = p.cells.length ? Math.min(...p.cells.filter(([x]) => x === col).map(([, y]) => y)) : 0;
    drawHat(c, hat.key, ax * s, top * s + s * 0.06, hw * s);
  }
  c.restore();
}

// ---------------------------------------------------------------------------------------------
// Main menu

export interface MenuMode {
  /** The data-action its button carries. */
  id: string;
  name: string;
  sub: string;
  icon: UiIcon;
  /** Level that unlocks it; locked below that, with a "Lv N" tag. */
  unlockAt?: number;
  /** Spans the whole row (Blockling Pop, a mode of its own rather than a way to play the tower). */
  wide?: boolean;
}

export const MENU_MODES: MenuMode[] = [
  { id: 'pop', name: 'Blockling Pop', sub: 'Fit shapes, pop lines', icon: 'shapes', unlockAt: 2, wide: true },
  { id: 'daily', name: 'Daily Tower', sub: 'Same tower for all', icon: 'daily', unlockAt: 3 },
  { id: 'zen', name: 'Zen', sub: 'Just build', icon: 'zen', unlockAt: 8 },
];

export interface MenuData extends XpState {
  name: string;
  avatar?: AvatarSpec;
  modes?: MenuMode[];
  /** Show the Workshop button beside the profile chip (action workshop). */
  workshop?: boolean;
  /** Skip the logo's drop-in (Reduce Motion, or coming back from a run). */
  still?: boolean;
}

/** The XP ring around the avatar: Ink rim, white track, violet progress from 12 o'clock. */
function ring(f: number): string {
  const r = 23, C = 2 * Math.PI * r, d = (Math.max(0, Math.min(1, f)) * C).toFixed(1);
  return `<svg viewBox="0 0 52 52" width="52" height="52" aria-hidden="true">
    <circle cx="26" cy="26" r="${r}" fill="none" stroke="${INK}" stroke-width="8"/>
    <circle cx="26" cy="26" r="${r}" fill="none" stroke="#fff" stroke-width="3.5"/>
    <circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--xp)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${d} ${C.toFixed(1)}"/></svg>`;
}

/**
 * The main menu overlay, for over the Meadow scene: profile chip (avatar, XP ring, badge, name, title)
 * top-left with the Workshop button beside it (when `workshop`), settings top-right, the logo, then Play
 * and the modes. Actions: profile, workshop, settings, play, and each mode's id (locked modes get
 * .locked and data-locked="N" and don't fire).
 */
export function mainMenu(d: MenuData): HTMLElement {
  const modes = (d.modes ?? MENU_MODES).map(m => {
    const locked = m.unlockAt !== undefined && d.level < m.unlockAt;
    return `<button type="button" class="ui-mode${m.wide ? ' wide' : ''}${locked ? ' locked' : ''}" data-action="${m.id}"${locked ? ` data-locked="${m.unlockAt}" aria-disabled="true"` : ''}>
      ${icon(m.icon, 34)}<div><b>${esc(m.name)}</b><span>${locked ? `Unlocks at level ${m.unlockAt}` : esc(m.sub)}</span></div>
      ${locked ? `<span class="ui-lock">${icon('lock', 16)}${m.unlockAt}</span>` : ''}</button>`;
  }).join('');
  const root = el(`<div class="ui ui-menu">
    <div class="ui-menu-top">
      <div class="ui-menu-left">
        <button type="button" class="ui-profile-chip" data-action="profile" aria-label="Profile">
          <span class="ui-ring">${ring(d.need > 0 ? d.into / d.need : 0)}<img class="ui-avatar" alt="" src="${avatarUrl(d.avatar, 38)}">${badge(d.level, 26)}</span>
          <span><b>${esc(d.name)}</b><span>${esc(titleFor(d.level))}</span></span>
        </button>
        ${d.workshop ? `<button type="button" class="ui-btn icon ui-menu-shop" data-action="workshop" aria-label="Workshop">${icon('workshop', 34)}</button>` : ''}
      </div>
      ${iconBtn('settings', 'settings', 'Settings')}
    </div>
    <div class="ui-menu-logo"></div>
    <div class="ui-menu-bottom">
      ${btn('play', 'Play', 'play', 'primary big wide')}
      ${modes ? `<div class="ui-modes">${modes}</div>` : ''}
    </div>
  </div>`);
  root.querySelector('.ui-menu-logo')!.replaceWith(logoElement({ tile: 58, still: d.still }));
  return root;
}

// ---------------------------------------------------------------------------------------------
// Profile

export interface ProfileStats {
  bestHeight: number;
  bestBiome: number;
  bricks: number;
  perfects: number;
  rows: number;
  checkpoints: number;
  runs: number;
  streak: number;
}

export interface ProfileData extends XpState {
  name: string;
  avatar?: AvatarSpec;
  /** Their portrait (portraits.ts): the avatar sits in it, as on the Daily ladder. Without one, the bare avatar. */
  portrait?: string;
  /**
   * The name's button (action name): 'edit' once they have a name, 'pick' (a strip under the head) while
   * they don't. Leave it out where names can't be set (no ladder in this copy of the game).
   */
  nameAction?: 'edit' | 'pick';
  /** A line under the head about their name, e.g. that it was reported. */
  nameNote?: string;
  /** Hold an animated portrait still (Reduce Motion). */
  still?: boolean;
  stats: ProfileStats;
  /** One entry per biome: the postmark date when first reached ('' for no date), or null if not reached yet. */
  postcards: (string | null)[];
  /** Earned and total: shows the Achievements row under the stats (action achievements). */
  achievements?: { got: number; total: number };
}

/**
 * The profile panel: portrait and avatar, name, badge and title, the XP bar, stats, the Achievements row and the
 * biome postcards. The name and portrait are the player's on the Daily ladder too.
 * Actions: close, avatar (tapping the avatar: open avatarPanel), name (Edit or Pick a name: open nameCard),
 * achievements (the row: open achievementsPanel).
 */
export function profilePanel(d: ProfileData): HTMLElement {
  const s = d.stats;
  const stat = (ic: UiIcon, v: string, label: string): string => `<div class="ui-stat">${icon(ic, 26)}<div><b${v.length > 9 ? ' class="sm"' : ''}>${v}</b><span>${label}</span></div></div>`;
  const root = el(`<div class="ui ui-overlay" role="dialog" aria-label="Profile"><div class="ui-panel ui-profile">
    ${iconBtn('close', 'close', 'Close', 'sm ui-close')}
    <div class="ui-prof-head">
      <button type="button" class="ui-av-edit" data-action="avatar" aria-label="Change your Blockling">${d.portrait ? portraitHtml(d.portrait, d.avatar, 76, { still: d.still }) : `<img class="ui-avatar" alt="" src="${avatarUrl(d.avatar, 72)}">`}<i><img alt="" src="${hatUrl('party', 18)}"></i></button>
      <div class="ui-prof-id">
        <b${d.name.length > 12 ? ' class="long"' : ''}>${esc(d.name)}</b>
        <div class="ui-row">${badge(d.level, 34)}<span class="ui-plate">${esc(titleFor(d.level))}</span>${d.nameAction === 'edit' ? `<button type="button" class="ui-btn ui-prof-edit" data-action="name" aria-label="Change your name and portrait">Edit</button>` : ''}</div>
      </div>
    </div>
    ${d.nameNote ? `<p class="ui-prof-note">${esc(d.nameNote)}</p>` : ''}
    ${d.nameAction === 'pick' ? `<div class="ui-prof-pick"><span><b>No name yet</b><span>Your name and portrait show here and on the Daily ladder.</span></span>${btn('name', 'Pick a name', undefined, 'primary')}</div>` : ''}
    <div class="ui-prof-xp"></div>
    <h2 class="ui-h2">Stats</h2>
    <div class="ui-stats">
      ${stat('tower', `${s.bestHeight.toFixed(1)} m`, 'Best height')}${stat('biome', esc(BIOMES[s.bestBiome]?.name ?? '-'), 'Best biome')}
      ${stat('brick', num(s.bricks), 'Bricks placed')}${stat('perfect', num(s.perfects), 'Perfects')}
      ${stat('row', num(s.rows), 'Solid Rows')}${stat('flag', num(s.checkpoints), 'Checkpoints')}
      ${stat('stats', num(s.runs), 'Runs')}${stat('streak', `${num(s.streak)} ${s.streak === 1 ? 'day' : 'days'}`, 'Streak')}
    </div>
    <div class="ui-prof-ach"></div>
    <h2 class="ui-h2">Postcards</h2>
    <div class="ui-cards"></div>
  </div></div>`);
  root.querySelector('.ui-prof-xp')!.replaceWith(xpBar(d, { badge: false }));
  const ach = root.querySelector('.ui-prof-ach')!;
  if (d.achievements) ach.replaceWith(achievementsRow(d.achievements)); else ach.remove();
  const cards = root.querySelector('.ui-cards')!;
  BIOMES.forEach((_, i) => {
    const date = d.postcards[i];
    cards.appendChild(postcardElement({ biome: i, width: 60, locked: date === null || date === undefined, date: date || undefined }));
  });
  return root;
}

// ---------------------------------------------------------------------------------------------
// Avatar picker

/** What the avatar picker offers: seven Blocklings, six faces, and the hats (HATS). */
export const AVATAR_SHAPES = ['O', 'T', 'L', 'J', 'S', 'Z', 'I'];
export const AVATAR_FACES: Expression[] = ['idle', 'proud', 'blink', 'squint', 'falling', 'dizzy'];

export interface AvatarPanelData {
  avatar?: AvatarSpec;
  /** The player's level: hats it hasn't reached are locked, with the level they need. */
  level: number;
  /** Hats they own beyond the level hats (Builder's Pass, Workshop sets, Supporter Pack), listed after them. */
  hats?: string[];
}

/**
 * The avatar picker: a big preview over rows of Blocklings, faces and hats (locked hats show their
 * level). Picking updates the preview; read the choice back with readAvatar. Actions: close, done.
 */
export function avatarPanel(d: AvatarPanelData): HTMLElement {
  const a = { shape: d.avatar?.shape ?? 'O', face: d.avatar?.face ?? 'idle', hat: d.avatar?.hat ?? null };
  const opt = (kind: string, value: string, img: string, label: string, on: boolean, lock = 0): string =>
    `<label class="ui-pick${lock ? ' locked' : ''}"><input type="radio" name="ui-av-${kind}" data-kind="${kind}" value="${value}"${on ? ' checked' : ''}${lock ? ' disabled' : ''} aria-label="${esc(label)}${lock ? `, unlocks at level ${lock}` : ''}">`
    + `<span><img alt="" src="${img}">${lock ? `<i>${icon('lock', 14)}${lock}</i>` : ''}</span></label>`;
  const hats = [opt('hat', '', uiIconUrl('close', 20), 'No hat', !a.hat)]
    .concat(HATS.map(h => opt('hat', h.key, hatUrl(h.key, 34), h.name, a.hat === h.key, h.level > d.level ? h.level : 0)))
    .concat((d.hats ?? []).map(hatInfo).filter(h => h && !HATS.includes(h)).map(h => opt('hat', h!.key, hatUrl(h!.key, 34), h!.name, a.hat === h!.key)));
  const root = el(`<div class="ui ui-overlay" role="dialog" aria-label="Your Blockling"><div class="ui-panel ui-avpick">
    ${iconBtn('close', 'close', 'Close', 'sm ui-close')}
    <h1 class="ui-h1" style="text-align:center">Your Blockling</h1>
    <img class="ui-avatar ui-av-big" alt="Your avatar" src="${avatarUrl(a, 112)}">
    <h2 class="ui-h2">Blockling</h2>
    <div class="ui-picks">${AVATAR_SHAPES.map(k => opt('shape', k, avatarUrl({ shape: k }, 34), ART_SHAPES[k].name, a.shape === k)).join('')}</div>
    <h2 class="ui-h2">Face</h2>
    <div class="ui-picks">${AVATAR_FACES.map(f => opt('face', f, faceUrl(a.shape, f, 34), f, a.face === f)).join('')}</div>
    <h2 class="ui-h2">Hat</h2>
    <div class="ui-picks">${hats.join('')}</div>
    ${btn('done', 'Done', undefined, 'primary')}
  </div></div>`);
  root.addEventListener('change', () => {
    const now = readAvatar(root);
    (root.querySelector('.ui-av-big') as HTMLImageElement).src = avatarUrl(now, 112);
    root.querySelectorAll<HTMLInputElement>('input[data-kind="face"]').forEach(i => {
      (i.nextElementSibling!.firstElementChild as HTMLImageElement).src = faceUrl(now.shape ?? 'O', i.value as Expression, 34);
    });
  });
  return root;
}

/** A face swatch for the picker: one block of the shape's color, close up, wearing `face`. */
function faceUrl(shape: string, face: Expression, cssPx: number, dpr = DPR()): string {
  const px = Math.round(cssPx * dpr), id = `face:${shape}:${face}:${px}`;
  let u = avatars.get(id);
  if (u) return u;
  const sh = ART_SHAPES[shape], cv = makeCanvas(px, px), c = ctx2d(cv), R = px / 2, cell = px * 0.52;
  c.save(); c.translate(R, R + px * 0.02); c.scale(cell, cell);
  const block = rrPath(-0.5, -0.5, 1, 1, 0.14);
  part(c, block, sh.base, sh.light, sh.shade, 0.09);
  c.lineWidth = 0.12; c.lineJoin = 'round'; c.strokeStyle = INK; c.stroke(block);
  c.restore();
  drawFace(c, R, R + px * 0.02, cell, face, { detail: cell >= 20 });
  u = cv.toDataURL('image/png');
  avatars.set(id, u);
  return u;
}

/** The avatar an avatar picker shows now. */
export function readAvatar(panel: HTMLElement): AvatarSpec {
  const v = (kind: string): string | undefined => panel.querySelector<HTMLInputElement>(`input[data-kind="${kind}"]:checked`)?.value;
  return { shape: v('shape') ?? 'O', face: (v('face') ?? 'idle') as Expression, hat: (v('hat') || null) as Hat | null };
}

// ---------------------------------------------------------------------------------------------
// Settings

export type SettingValue = boolean | number | string;
export type SettingItem =
  | { key: string; kind: 'toggle'; label: string; icon?: UiIcon }
  | { key: string; kind: 'slider'; label: string; icon?: UiIcon; min?: number; max?: number; step?: number }
  | { key: string; kind: 'choice'; label: string; icon?: UiIcon; options: [value: string, label: string][] }
  /** A row that's a button: fires `action` (e.g. "Remove ads" opening the Workshop, Restore purchases), with `value` on the right and `sub` under the label. */
  | { key: string; kind: 'action'; label: string; icon?: UiIcon; action: string; value?: string; sub?: string };
export interface SettingGroup { title: string; items: SettingItem[] }

/** The settings from gameplay.md §2 and the audio section. Pass your own layout to settingsPanel to change it. */
export const SETTINGS_LAYOUT: SettingGroup[] = [
  { title: 'Sound', items: [
    { key: 'music', kind: 'slider', label: 'Music', icon: 'music' },
    { key: 'sfx', kind: 'slider', label: 'Sounds', icon: 'sound' },
    { key: 'haptics', kind: 'toggle', label: 'Haptics', icon: 'haptics' },
  ] },
  { title: 'Controls', items: [
    { key: 'controls', kind: 'choice', label: 'Play with', options: [['gestures', 'Gestures'], ['buttons', 'Buttons']] },
    { key: 'splitTap', kind: 'toggle', label: 'Split-tap rotation' },
    { key: 'safeDrop', kind: 'toggle', label: 'Safe drop (double-tap)' },
    { key: 'leftHand', kind: 'toggle', label: 'Left-hand buttons' },
    { key: 'sensitivity', kind: 'slider', label: 'Drag sensitivity', min: 0.75, max: 1.5, step: 0.05 },
  ] },
  { title: 'Comfort', items: [
    { key: 'reducedMotion', kind: 'toggle', label: 'Reduce motion' },
    { key: 'shake', kind: 'slider', label: 'Screen shake' },
    { key: 'patterns', kind: 'toggle', label: 'Colour-blind patterns' },
  ] },
];

/**
 * Settings' Purchases group (monetisation plan v2), for the game to add to its layout once the store is in:
 * whether ads show (its value: put 'On' or 'Off' under the `ads` key; the row opens the Workshop) and
 * Restore purchases. No buy buttons here.
 */
export const PURCHASE_SETTINGS: SettingGroup = { title: 'Purchases', items: [
  { key: 'ads', kind: 'action', label: 'Ads between runs', icon: 'noads', action: 'workshop', sub: 'Remove ads in the Workshop' },
  { key: 'restore', kind: 'action', label: 'Restore purchases', icon: 'restore', action: 'restore' },
] };

function sliderFill(i: HTMLInputElement): void {
  const min = Number(i.min || 0), max = Number(i.max || 1);
  i.style.setProperty('--v', `${(((Number(i.value) - min) / (max - min || 1)) * 100).toFixed(1)}%`);
}

/**
 * The settings panel, filled from `values` (an action row shows a string value on its right). Read it back
 * with readSettings; it fires input and change events as usual. Actions: close, and each action row's.
 */
export function settingsPanel(values: Record<string, SettingValue>, layout: SettingGroup[] = SETTINGS_LAYOUT): HTMLElement {
  const label = (it: SettingItem): string => `<span>${it.icon ? icon(it.icon, 22) : ''}${esc(it.label)}</span>`;
  const item = (it: SettingItem): string => {
    const v = values[it.key], name = `ui-set-${it.key}`;
    if (it.kind === 'action') {
      const val = typeof v === 'string' ? v : it.value;
      return `<button type="button" class="ui-set act" data-action="${esc(it.action)}" data-key="${esc(it.key)}"><span>${it.icon ? icon(it.icon, 22) : ''}<span>${esc(it.label)}${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></span>`
        + `<em>${val ? esc(val) : ''}<i aria-hidden="true">›</i></em></button>`;
    }
    if (it.kind === 'toggle') return `<label class="ui-set">${label(it)}<input class="ui-toggle" type="checkbox" name="${name}" data-key="${it.key}"${v ? ' checked' : ''}></label>`;
    if (it.kind === 'slider') {
      const min = it.min ?? 0, max = it.max ?? 1, step = it.step ?? 0.05;
      return `<label class="ui-set">${label(it)}<input class="ui-slider" type="range" name="${name}" data-key="${it.key}" min="${min}" max="${max}" step="${step}" value="${typeof v === 'number' ? v : (min + max) / 2}"></label>`;
    }
    return `<div class="ui-set col">${label(it)}<div class="ui-seg" role="radiogroup">${it.options.map(([val, l]) =>
      `<label><input type="radio" name="${name}" data-key="${it.key}" value="${esc(val)}"${v === val ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div></div>`;
  };
  const root = el(`<div class="ui ui-overlay" role="dialog" aria-label="Settings"><div class="ui-panel ui-settings">
    ${iconBtn('close', 'close', 'Close', 'sm ui-close')}
    <h1 class="ui-h1" style="text-align:center">Settings</h1>
    ${layout.map(g => `<h2 class="ui-h2">${esc(g.title)}</h2><div class="ui-group">${g.items.map(item).join('')}</div>`).join('')}
  </div></div>`);
  root.querySelectorAll<HTMLInputElement>('.ui-slider').forEach(i => { sliderFill(i); i.addEventListener('input', () => sliderFill(i)); });
  return root;
}

/** The values a settings panel shows now: toggles as booleans, sliders as numbers, choices as strings. */
export function readSettings(panel: HTMLElement): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  panel.querySelectorAll<HTMLInputElement>('input[data-key]').forEach(i => {
    const k = i.dataset.key!;
    if (i.type === 'checkbox') out[k] = i.checked;
    else if (i.type === 'range') out[k] = Number(i.value);
    else if (i.type === 'radio' && i.checked) out[k] = i.value;
  });
  return out;
}
