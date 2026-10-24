// The game's screens (design doc "UI and screens"): main menu, pause, settings, profile, the
// run-over summary with its XP tally, and the level-up takeover. Art's UI kit draws them from
// plain data (art/src/ui/screens.ts); this file keeps the flow: what each button does, the sounds,
// the XP tally's timing and QA's one-tap questions.

import {
  FORGET_LABEL, MENU_MODES, armDailyScored, armForget, armReport, avatarPanel, dailyCard, dailyChip, dailyMenuDot, injectLadderCss, injectUiCss, levelUp, mainMenu, nameCard, onAction, pauseCard, prewarmUi,
  profilePanel, readAvatar, readNameCard, readSettings, rewardAt, setDailyCountdown, setDailyLadder, setDailyTab, setNameBusy, setNameHint, setXpBar, settingsPanel,
  showAllXpLines, showXpLine, summaryCard, uiIconUrl, type DailyCardData, type DailyTab, type LadderPanelData, type NameCardData, type SettingGroup, type SettingValue,
  PURCHASE_SETTINGS, setWorkshopItem, setWorkshopNote, setWorkshopRestoring, setWorkshopStore, testPurchaseSheet, workshopPanel, type WorkshopData, type WorkshopItem, type WorkshopStore,
  levelRewards, levelTrack, lookPanel, lookPreviewUrl, readLook, type CosmeticOwner,
} from '@art/index.ts';
import { extraHats, lookOf, saveLook, wornLook } from './look.ts';
import type { Entitlements } from '../meta/shop.ts';
import type { Achievement } from '../meta/achievements.ts';
import { levelStep } from '../sim/tuning.ts';
import type { Award, Profile } from './profile.ts';
import { achievementCount, achievementsPanel, storeButton, summaryStrip } from './trophies.ts';
import type { PlayerSettings } from './settings.ts';
import { INK, INK_SOFT } from './palette.ts';

export type UiSound = 'tap' | 'tap2' | 'back' | 'toggleOn' | 'toggleOff' | 'slider' | 'tab' | 'open' | 'close' | 'error' | 'pause' | 'resume' | 'start' | 'badge' | 'unlock';

export interface ScreenSounds {
  ui(kind: UiSound): void;
  xpTick(): void;
  levelUp(level: number): void;
}

/** The sound each kit action makes; anything else is a plain tap. */
const ACTION_SOUND: Record<string, UiSound> = {
  play: 'start', again: 'start', resume: 'resume', profile: 'open', daily: 'open', zen: 'start', settings: 'open', share: 'open', avatar: 'open', name: 'open', done: 'tap2', achievements: 'open', stores: 'open', look: 'open',
  close: 'back', home: 'back', quit: 'back', continue: 'tap', scored: 'tap2', practice: 'start',
  tab: 'tab', join: 'open', edit: 'open', save: 'tap2', report: 'tap', reportYes: 'tap2', reportNo: 'back', forget: 'tap2', retry: 'tap',
  workshop: 'open', buy: 'tap2', confirm: 'tap2', cancel: 'back', restore: 'tap', clearTest: 'tap2',
};

/** How long the Daily's scored button (and the ladder's delete) stays armed after its first tap. */
const ARM_MS = 2500;

/** The Daily card's ladder: how to load it, and what its buttons do (gameplay.md §12.3). */
export interface DailyLadderHooks {
  /** Today's ladder for the card (also on Try again, and after a report). */
  load(): Promise<LadderPanelData>;
  /** Join or Edit: the name card. */
  onName(): void;
  /** A confirmed report; resolves when the row can redraw. */
  onReport(id: string): Promise<void>;
}

/**
 * Settings' purchases rows, from the main menu only (never from pause): whether ads are on, a line that
 * opens the Workshop (no buy button here), and Restore purchases. Each action resolves the line to show.
 */
export interface SettingsShop {
  /** 'on' (the phone app, before Remove Ads), 'off' (Remove Ads is owned), 'none' (a web build: never any). */
  ads: 'on' | 'off' | 'none';
  onWorkshop(): void;
  onRestore(): Promise<string>;
  /** The test store only: forget its test purchases. */
  onClearTest?(): Promise<string>;
}

/** An open Workshop: redraw a card, say how a buy went, and ask the test store's question. */
export interface WorkshopHandle {
  update(item: WorkshopItem): void;
  /** A toast over the bottom; `stay` keeps it up (a payment still pending). */
  note(text: string, tone?: 'good' | 'bad', stay?: boolean): void;
  /** The footer line, when the store answers (or can't be reached). */
  store(kind: WorkshopStore): void;
  /** Restore purchases is asking the store. */
  restoring(on: boolean): void;
  /** The test store's sheet: resolves whether they tapped Buy (test). */
  confirm(item: WorkshopItem): Promise<boolean>;
  /** Still showing. */
  readonly open: boolean;
}

/** The name card (the player's name and portrait): its data, the live hint, and saving or deleting (each resolves an error line, or null when done). */
export interface NameCardHooks {
  data: NameCardData;
  hint(name: string): { text: string; ok: boolean };
  onSave(name: string, portrait: string): Promise<string | null>;
  onForget(): Promise<string | null>;
  onClose(): void;
  /** A locked shop portrait was tapped: open the Workshop on it (its portrait id). */
  onWorkshop?(portrait: string): void;
}

/** The Profile's name and portrait (gameplay.md §10.3), the same ones the Daily ladder shows. */
export interface ProfileIdentity {
  get(): { portrait: string; nameAction?: 'edit' | 'pick'; nameNote?: string; still?: boolean };
  /** Opens the name card; `back` shows the profile again. */
  onName(back: () => void): void;
}

/**
 * The look's hooks (monetisation plan v2, cosmetics): what the player owns, and the Workshop for the
 * items a purchase unlocks (`product`: builders_pass, a set id or the Supporter offer). `back` is
 * where the Workshop's close goes; null from the run summary, which can't be gone back to.
 */
export interface LookHooks {
  ent(): Entitlements;
  owner(p: Profile): CosmeticOwner;
  onWorkshop(product: string, back: (() => void) | null): void;
  /** Reduce Motion: the look's animated previews hold still. */
  still(): boolean;
  /** A level-up's Builder's Pass card: its reward for owners, the one intro at level 10 (it marks itself shown), or none. */
  levelPass(from: number, to: number): { pass: 'owned' | 'intro'; passWaiting?: number } | null;
}

// Only what the kit doesn't style: the container, the testing note, the build tag and QA's questions.
const CSS = `
.sc-root { display: none; }
.sc-root.show { display: block; }
.sc-testing { background: rgba(255,247,232,0.94); border: 2px solid ${INK}; border-radius: 10px; font: 700 13px 'Nunito', sans-serif; color: ${INK}; padding: 4px 10px; text-align: center; }
.sc-build { font: 600 11px 'Nunito', sans-serif; color: rgba(34,24,58,0.6); text-align: center; }
.sc-ask { padding: 8px 0 2px; border-top: 2px dashed rgba(34,24,58,0.25); text-align: center; }
.sc-ask p { font: 700 15px 'Nunito', sans-serif; color: ${INK}; margin: 0 0 6px; }
.sc-ask .sc-answers { display: flex; gap: 8px; justify-content: center; }
.sc-share-note { font: 700 14px 'Nunito', sans-serif; color: ${INK}; text-align: center; margin: 0; min-height: 0; }
.sc-share-note:empty { display: none; }
.ui-summary [data-action="share"][aria-busy="true"] { opacity: 0.6; }
.sc-ask .ui-btn { min-height: 40px; padding: 4px 18px; font-size: 16px; }
.sc-ask .sc-face { font-size: 24px; padding: 2px 6px; min-width: 46px; }
.sc-ask .sc-thanks { font: 600 14px 'Nunito', sans-serif; color: ${INK_SOFT}; margin: 4px 0; }
.sc-ladder { margin-top: 10px; text-align: left; }
.sc-look { display: flex; align-items: center; gap: 12px; width: 100%; margin: 0 0 6px; padding: 8px 12px 8px 8px; text-align: left; }
.sc-look img { width: 96px; height: 48px; border: 2px solid ${INK}; border-radius: 10px; flex: none; }
.sc-look span { flex: 1; font: 700 14px/1.25 'Nunito', sans-serif; color: ${INK_SOFT}; }
.sc-look b { display: block; font: 800 17px/1.2 'Fredoka', sans-serif; color: ${INK}; }
.sc-ladder-msg { font: 700 13px 'Nunito', sans-serif; color: ${INK_SOFT}; margin: 4px 2px 0; min-height: 1em; }
`;

/** The settings the game has today, in the kit's layout format (gameplay.md §2, audio section). */
const LAYOUT: SettingGroup[] = [
  { title: 'Sound', items: [
    { key: 'music', kind: 'slider', label: 'Music', icon: 'music' },
    { key: 'sfx', kind: 'slider', label: 'Sounds', icon: 'sound' },
    { key: 'voices', kind: 'slider', label: 'Shape voices' },
    { key: 'haptics', kind: 'choice', label: 'Haptics', icon: 'haptics', options: [['off', 'Off'], ['light', 'Light'], ['full', 'Full']] },
  ] },
  { title: 'Controls', items: [
    { key: 'splitTap', kind: 'toggle', label: 'Split-tap rotation' },
    { key: 'sensitivity', kind: 'slider', label: 'Drag sensitivity', min: 0.75, max: 1.5, step: 0.05 },
    { key: 'guideOpacity', kind: 'slider', label: 'Landing guide', min: 0.5, max: 1.5, step: 0.05 },
  ] },
  { title: 'Comfort', items: [
    { key: 'reduceMotion', kind: 'toggle', label: 'Reduce motion' },
    { key: 'shake', kind: 'choice', label: 'Screen shake', options: [['off', 'Off'], ['low', 'Low'], ['full', 'Full']] },
    { key: 'faces', kind: 'toggle', label: 'Block faces' },
  ] },
];

/** The play stats' switch (PRIVACY.md, "Anonymous play stats"): the phone apps only. */
const PRIVACY: SettingGroup = { title: 'Privacy', items: [{ key: 'stats', kind: 'toggle', label: 'Send anonymous play stats' }] };

/** Art's Purchases group for this build: what the ads line says, and the test store's reset. */
function purchases(shop: SettingsShop): SettingGroup {
  const sub = { on: 'Remove ads in the Workshop', off: 'Removed for good', none: 'Only ever in the phone app' }[shop.ads];
  const items = PURCHASE_SETTINGS.items.map(it => (it.key === 'ads' && it.kind === 'action' ? { ...it, sub } : it));
  if (shop.onClearTest) items.push({ key: 'clearTest', kind: 'action', label: 'Clear test purchases', icon: 'restart', action: 'clearTest', sub: 'Test store: nothing was ever charged' });
  return { ...PURCHASE_SETTINGS, items };
}

const CAUSES: Record<string, string> = { bricks: 'Out of shapes!', hearts: 'Out of hearts!', quit: 'You quit', zen: 'Nicely built!' };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const xpOf = (p: Profile) => ({ level: p.level, into: p.xp, need: levelStep(p.level) });

export interface SummaryStats {
  /** Why it ended: bricks, hearts, quit, or zen (a finished Zen tower). */
  cause: string;
  height: number;
  newBest: boolean;
  /** The "New best!" chip's text when it isn't Endless's best (Zen keeps its own). */
  bestLabel?: string;
  /** Highest biome reached, 0 = Meadow (its postcard goes on the card). */
  biome: number;
  checkpoints: number;
  perfects: number;
  rows: number;
  clutches: number;
  score: number;
}

export interface SummaryOptions {
  stats: SummaryStats;
  award: Award;
  /** Achievements earned this run, and earlier ones whose XP this tally pays (gameplay.md §18.3). */
  achievements?: Achievement[];
  /** One-tap prompts for QA, in order. 'faces' is five faces stored as 1 to 5. */
  questions: { id: string; text: string; kind?: 'yesno' | 'faces' }[];
  onAnswer(id: string, answer: string | number): void;
  onAgain(): void;
  onProfile(): void;
  onHome(): void;
  reducedMotion: boolean;
  /** A Daily Tower run: its chip under the height, and the again button's label ("Practice"). */
  daily?: { number: number; scored: boolean; again: string };
  /**
   * The share button (launch marketing plan): bakes the card and opens the share sheet, resolving a line to
   * show under the buttons (or null for none). Without it, where nothing can share, the button stays out.
   */
  onShare?(): Promise<string | null>;
  /** The tally has finished and any level-up has been closed: the summary is just sitting there. */
  onSettled?(): void;
}

export class Screens {
  readonly root: HTMLDivElement;
  private name = '';
  private unbind: (() => void) | null = null;
  /** The player's name on the menu and profile: the one they picked (it's their ladder name too), until then Builder. */
  playerName = 'Builder';
  /** The phone's game service for the Achievements panel's button (game.ts): its name, or null for none. */
  stores: { label(): string | null; open(): void } | null = null;
  /** The look's hooks; without them (the Wobble Lab) the profile has no look rows. */
  looks: LookHooks | null = null;
  /** The Daily card's tab, kept between visits. */
  private dailyTab: DailyTab = 'ladder';
  /** Settings shows the Privacy switch for the play stats (the phone apps: nothing else sends any). */
  statsSetting = false;

  constructor(parent: HTMLElement, private sounds: ScreenSounds) {
    injectUiCss();
    void prewarmUi(); // Art bakes the HUD's icons and postcards while the menu is up (issue #33)
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.className = 'sc-root';
    parent.appendChild(this.root);
  }

  /** Which screen is showing ('' when none). */
  get current(): string { return this.name; }

  close(): void {
    this.unbind?.();
    this.unbind = null;
    this.root.classList.remove('show');
    this.root.replaceChildren();
    this.name = '';
  }

  /** Shows one kit screen and routes its data-action buttons, each with its sound. */
  private open(name: string, el: HTMLElement, handlers: Record<string, (target: HTMLElement) => void>): HTMLElement {
    this.close();
    this.name = name;
    this.root.appendChild(el);
    this.root.classList.add('show');
    this.unbind = this.bind(el, handlers);
    return el;
  }

  private bind(el: HTMLElement, handlers: Record<string, (target: HTMLElement) => void>): () => void {
    return onAction(el, (action, target) => {
      const fn = handlers[action];
      if (!fn) return;
      this.sounds.ui(ACTION_SOUND[action] ?? 'tap');
      fn(target);
    });
  }

  // ---------------------------------------------------------------- main menu

  /**
   * The main menu: Play is Endless, and the Daily Tower and Zen buttons open at their levels
   * (gameplay.md §10.3, §12). `subs` replaces a mode's second line (the Daily's state today).
   */
  menu(o: {
    profile: Profile; build: string; note?: string; still?: boolean; subs?: Partial<Record<'daily' | 'zen', string>>;
    /** Today's scored Daily try is still open: a "!" on the Daily button. */
    dailyDot?: boolean;
    onPlay(): void; onMode(id: 'daily' | 'zen'): void; onProfile(): void; onSettings(): void;
    /** The Workshop button next to the profile (monetisation plan v2). */
    onWorkshop?(): void;
  }): void {
    const p = o.profile;
    const modes = MENU_MODES.map(m => {
      const sub = o.subs?.[m.id as 'daily' | 'zen'];
      return sub && p.level >= (m.unlockAt ?? 0) ? { ...m, sub } : m;
    });
    const el = mainMenu({ name: this.playerName, ...xpOf(p), avatar: p.avatar, modes, still: o.still, workshop: !!o.onWorkshop });
    const bottom = el.querySelector('.ui-menu-bottom')!;
    if (o.note) bottom.insertAdjacentHTML('afterbegin', `<div class="sc-testing">${esc(o.note)}</div>`);
    bottom.insertAdjacentHTML('beforeend', `<div class="sc-build">build ${esc(o.build)}</div>`);
    const dailyBtn = el.querySelector('.ui-mode[data-action="daily"]:not(.locked)');
    if (o.dailyDot && dailyBtn) dailyBtn.appendChild(dailyMenuDot());
    this.open('menu', el, { play: o.onPlay, daily: () => o.onMode('daily'), zen: () => o.onMode('zen'), profile: o.onProfile, settings: o.onSettings, workshop: () => o.onWorkshop?.() });
  }

  // ---------------------------------------------------------------- Workshop

  /**
   * The Workshop (monetisation plan v2): the only screen with buy buttons. Each card's button is
   * data-action="buy" with its product id; `focus` scrolls one card into view.
   */
  workshop(o: { data: WorkshopData; focus?: string; onBuy(id: string): void; onRestore(): void; onClose(): void }): WorkshopHandle {
    const el = workshopPanel(o.data);
    this.open('workshop', el, { close: o.onClose, restore: o.onRestore, buy: t => { if (t.dataset.id) o.onBuy(t.dataset.id); } });
    const unbind = this.unbind;
    let sheet: { el: HTMLElement; done(ok: boolean): void } | null = null;
    this.unbind = () => { sheet?.done(false); unbind?.(); };
    if (o.focus) requestAnimationFrame(() => el.querySelector(`[data-id="${o.focus}"]`)?.scrollIntoView({ block: 'center' }));
    return {
      update: item => setWorkshopItem(el, item),
      note: (text, tone, stay) => setWorkshopNote(el, text, tone, { stay }),
      store: kind => setWorkshopStore(el, kind),
      restoring: on => setWorkshopRestoring(el, on),
      confirm: item => new Promise<boolean>(resolve => {
        sheet?.done(false);
        const s = testPurchaseSheet(item, { avatar: o.data.avatar, still: o.data.still });
        this.root.appendChild(s);
        const off = this.bind(s, { confirm: () => me.done(true), cancel: () => me.done(false) });
        const me = { el: s, done: (ok: boolean) => { off(); s.remove(); if (sheet === me) sheet = null; resolve(ok); } };
        sheet = me;
      }),
      get open() { return el.isConnected; },
    };
  }

  // ---------------------------------------------------------------- pause

  /**
   * The pause card. In Zen, Quit is Finish: it's how a Zen run ends, and it doesn't halve XP (gameplay.md §12).
   * `restart: false` takes Restart off (a scored Daily try can't be restarted).
   */
  pause(o: { zen?: boolean; restart?: boolean; onResume(): void; onRestart(): void; onSettings(): void; onQuit(): void }): void {
    const el = pauseCard({ quitHalves: !o.zen });
    if (o.zen) {
      const quit = el.querySelector('[data-action="quit"]')!;
      quit.innerHTML = `<img alt="" src="${uiIconUrl('flag', 24)}">Finish`;
      quit.insertAdjacentHTML('afterend', `<p class="ui-note"><img alt="" src="${uiIconUrl('zen', 16)}">Finish to see your tower and bank its XP</p>`);
    }
    if (o.restart === false) el.querySelector('[data-action="restart"]')?.remove();
    this.open('pause', el, { resume: o.onResume, restart: o.onRestart, settings: o.onSettings, quit: o.onQuit });
  }

  // ---------------------------------------------------------------- Daily Tower

  /**
   * The Daily card (gameplay.md §12). The countdown ticks while it's open, and at 00:00 UTC the card
   * redraws for the new tower. The scored button needs two taps, so a stray one can't spend the day's
   * only try (QA Q32: it's spent once its first shape spawns).
   */
  daily(o: { data(): DailyCardData; countdown(): { ms: number; text: string }; onScored(): void; onPractice(): void; onClose(): void; ladder: DailyLadderHooks }): void {
    const el = dailyCard({ ...o.data(), tab: this.dailyTab });
    let armedAt = 0;
    let disarm = 0;
    let asking: string | null = null; // the row whose report question is showing
    const load = () => o.ladder.load().then(d => { if (el.isConnected) setDailyLadder(el, d); }, () => {});
    this.open('daily', el, {
      close: o.onClose,
      practice: o.onPractice,
      scored: () => {
        if (performance.now() - armedAt < ARM_MS) { clearTimeout(disarm); this.sounds.ui('start'); o.onScored(); return; }
        armedAt = performance.now();
        armDailyScored(el, true);
        clearTimeout(disarm);
        disarm = window.setTimeout(() => { armedAt = 0; armDailyScored(el, false); }, ARM_MS);
      },
      join: o.ladder.onName,
      edit: o.ladder.onName,
      retry: () => { void load(); },
      reportNo: () => { asking = null; armReport(el, null); },
      // These need their button (the click listener below); listed here for their sounds.
      tab: () => {}, report: () => {}, reportYes: () => {},
    });
    // The buttons that need to know which tab or row they belong to.
    const pick = (e: Event): void => {
      const t = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
      if (!t || !el.contains(t)) return;
      if (t.dataset.action === 'tab') { this.dailyTab = t.dataset.tab as DailyTab; setDailyTab(el, this.dailyTab); }
      else if (t.dataset.action === 'report') { asking = t.dataset.id ?? null; armReport(el, asking); }
      else if (t.dataset.action === 'reportYes' && asking) { const id = asking; asking = null; void o.ladder.onReport(id).then(load); }
    };
    el.addEventListener('click', pick);
    void load();
    const tick = window.setInterval(() => {
      if (this.name !== 'daily' || !el.isConnected) { clearInterval(tick); return; }
      const c = o.countdown();
      setDailyCountdown(el, c.text);
      if (c.ms < 1000) { clearInterval(tick); clearTimeout(disarm); window.setTimeout(() => { if (this.name === 'daily' && el.isConnected) this.daily(o); }, 1200); }
    }, 1000);
    const unbind = this.unbind;
    this.unbind = () => { clearInterval(tick); clearTimeout(disarm); el.removeEventListener('click', pick); unbind?.(); };
  }

  /**
   * The name card, from the Profile or the Daily card: a name with a live hint, a portrait, and (once they
   * have a name) deleting it and their Daily scores, which takes two taps.
   */
  ladderName(o: NameCardHooks): void {
    const el = nameCard(o.data);
    const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    const hint = () => { const h = o.hint(input.value); setNameHint(el, h.text, h.ok); return h.ok; };
    hint();
    input.addEventListener('input', hint);
    let armedAt = 0;
    let disarm = 0;
    const busy = async (job: () => Promise<string | null>) => {
      setNameBusy(el, true);
      const error = await job();
      if (!el.isConnected) return;
      setNameBusy(el, false);
      if (error) { this.sounds.ui('error'); setNameHint(el, error, false); }
    };
    const save = () => {
      if (!hint()) { this.sounds.ui('error'); input.focus(); return; }
      const c = readNameCard(el);
      void busy(() => o.onSave(c.name, c.portrait || o.data.portrait));
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); save(); } });
    this.open('name', el, {
      close: o.onClose,
      save,
      workshop: t => o.onWorkshop?.(t.dataset.id ?? ''),
      forget: () => {
        if (performance.now() - armedAt < ARM_MS) { clearTimeout(disarm); void busy(o.onForget); return; }
        armedAt = performance.now();
        armForget(el, true);
        clearTimeout(disarm);
        disarm = window.setTimeout(() => { armedAt = 0; armForget(el, false); }, ARM_MS);
      },
    });
    const unbind = this.unbind;
    this.unbind = () => { clearTimeout(disarm); unbind?.(); };
    // Typing straight away on a first join; an edit opens on the portraits.
    if (!o.data.joined) window.setTimeout(() => { if (el.isConnected) input.focus(); }, 350);
  }

  // ---------------------------------------------------------------- settings

  /**
   * Settings. `forgetLadder`: the player has a name, so a last row deletes it and their Daily scores (two taps).
   * `shop`: the purchases rows (from the main menu only).
   */
  settings(s: PlayerSettings, onChange: (s: PlayerSettings) => void, onBack: () => void, forgetLadder?: () => Promise<string | null>, shop?: SettingsShop): void {
    const values = s as unknown as Record<string, SettingValue>;
    const layout = [...LAYOUT, ...(this.statsSetting ? [PRIVACY] : []), ...(shop ? [purchases(shop)] : [])];
    const el = settingsPanel(shop ? { ...values, ads: { on: 'On', off: 'Off', none: 'None' }[shop.ads] } : values, layout);
    let armedAt = 0;
    let disarm = 0;
    // How Restore (or clearing the test store) went, under the Purchases rows.
    if (shop) el.querySelector('[data-action="restore"]')?.closest('.ui-group')?.insertAdjacentHTML('afterend', '<p class="sc-ladder-msg sc-shop-msg" aria-live="polite"></p>');
    const shopMsg = (text: string) => { const m = el.querySelector<HTMLElement>('.sc-shop-msg'); if (m) m.textContent = text; };
    if (forgetLadder) {
      injectLadderCss();
      el.querySelector('.ui-panel')?.insertAdjacentHTML('beforeend',
        `<div class="sc-ladder"><h2 class="ui-h2">Your name</h2><button type="button" class="ui-nc-forget" data-action="forget">${FORGET_LABEL}</button><p class="sc-ladder-msg"></p></div>`);
    }
    const apply = () => { Object.assign(s, readSettings(el)); onChange(s); };
    el.addEventListener('input', e => { if ((e.target as HTMLInputElement).type === 'range') apply(); });
    el.addEventListener('change', e => {
      const i = e.target as HTMLInputElement;
      this.sounds.ui(i.type === 'checkbox' ? (i.checked ? 'toggleOn' : 'toggleOff') : i.type === 'radio' ? 'tab' : 'slider');
      apply();
    });
    this.open('settings', el, {
      close: onBack,
      workshop: () => shop?.onWorkshop(),
      restore: () => { shopMsg('Asking the store…'); void shop?.onRestore().then(shopMsg); },
      clearTest: () => { void shop?.onClearTest?.().then(shopMsg); },
      forget: () => {
        if (!forgetLadder) return;
        if (performance.now() - armedAt < ARM_MS) {
          clearTimeout(disarm);
          void forgetLadder().then(error => {
            const msg = el.querySelector<HTMLElement>('.sc-ladder-msg');
            if (msg) msg.textContent = error ?? 'Done: your name and Daily scores are gone.';
            if (!error) el.querySelector('.sc-ladder [data-action="forget"]')?.remove();
          });
          return;
        }
        armedAt = performance.now();
        armForget(el, true);
        clearTimeout(disarm);
        disarm = window.setTimeout(() => { armedAt = 0; armForget(el, false); }, ARM_MS);
      },
    });
    const unbind = this.unbind;
    this.unbind = () => { clearTimeout(disarm); unbind?.(); };
  }

  // ---------------------------------------------------------------- profile

  /**
   * The profile; tapping the avatar opens the picker, and `onSave` stores a new choice. `id` is the name and
   * portrait (the Daily ladder's too): read fresh each time it's shown, and `onName` opens the name card.
   */
  profile(p: Profile, onBack: () => void, onSave: () => void, id?: ProfileIdentity): void {
    const st = p.stats;
    const el = profilePanel({
      name: this.playerName, ...xpOf(p), avatar: p.avatar, ...id?.get(),
      stats: { bestHeight: st.bestHeight, bestBiome: Math.max(0, st.bestBiome - 1), bricks: st.bricks, perfects: st.perfects, rows: st.rows, checkpoints: st.checkpoints, runs: p.runs, streak: p.streak },
      postcards: p.postcards,
      // Achievements (gameplay.md §18.3): a row under the stats opens the panel.
      achievements: achievementCount(p),
    });
    const back = () => this.profile(p, onBack, onSave, id);
    const lk = this.looks;
    if (lk) {
      // Your look and the two-lane level track, under the XP bar (monetisation plan v2).
      const owner = lk.owner(p), look = wornLook(p, lk.ent());
      const rows = document.createElement('div');
      rows.innerHTML = `<h2 class="ui-h2">Your look</h2><button type="button" class="ui-btn sc-look" data-action="look"><img alt="" src="${lookPreviewUrl(look, p.avatar.shape ?? 'O', 96, 48)}"><span><b>Your look</b>Shape skin, landing, foundation, flag and hat</span></button><h2 class="ui-h2">Level rewards</h2>`;
      rows.appendChild(levelTrack({ level: p.level, pass: owner.pass }));
      el.querySelector('.ui-xp')?.after(...rows.childNodes);
    }
    this.open('profile', el, {
      close: onBack, avatar: () => this.avatar(p, back, onSave), name: () => id?.onName(back), achievements: () => this.achievements(p, back),
      look: () => this.look(p, back, onSave),
      workshop: t => lk?.onWorkshop(t.dataset.id ?? 'builders_pass', back),
    });
  }

  /** "Your look": the five slots, owned items to pick, the rest saying what unlocks them (a purchase's open the Workshop). Done keeps the picks. */
  private look(p: Profile, onBack: () => void, onSave: () => void): void {
    const lk = this.looks;
    if (!lk) return;
    const el = lookPanel({ look: lookOf(p), owner: lk.owner(p), avatar: p.avatar, still: lk.still() });
    const again = () => this.look(p, onBack, onSave);
    this.open('look', el, {
      close: onBack,
      done: () => { saveLook(p, readLook(el)); onSave(); onBack(); },
      workshop: t => lk.onWorkshop(t.dataset.id ?? 'builders_pass', again),
    });
  }

  /** Every achievement by group: earned ones with their date, counted ones with progress. */
  achievements(p: Profile, onBack: () => void): void {
    const panel = achievementsPanel(p), name = this.stores?.label();
    // In the phone app, once the store's console is set up: open them in Play Games or Game Center.
    if (name) panel.querySelector('.ui-ach-total')?.after(storeButton(name));
    this.open('achievements', panel, { close: onBack, stores: () => this.stores?.open() });
  }

  /** Art's avatar picker: shape, face and a hat (hats above the player's level stay locked). Done keeps the choice. */
  private avatar(p: Profile, onBack: () => void, onSave: () => void): void {
    const el = avatarPanel({ avatar: p.avatar, level: p.level, hats: this.looks ? extraHats(this.looks.owner(p)) : undefined });
    this.open('avatar', el, {
      close: onBack,
      done: () => { p.avatar = readAvatar(el); onSave(); onBack(); },
    });
  }

  // ---------------------------------------------------------------- run over

  /** The summary card: stats, then the XP lines tick in while the bar fills. A level-up takes over and hands back. */
  summary(o: SummaryOptions): void {
    const s = o.stats, a = o.award;
    const el = summaryCard({
      cause: CAUSES[s.cause] ?? 'Run over', height: s.height, newBest: s.newBest, biome: s.biome, score: Math.round(s.score),
      checkpoints: s.checkpoints, perfects: s.perfects, rows: s.rows, clutches: s.clutches,
      xp: { level: a.before.level, into: a.before.xp, need: levelStep(a.before.level) }, lines: a.lines, gained: a.gained,
    });
    // Sharing (the card and its text line) where this copy of the game can; elsewhere the button stays out.
    if (!o.onShare) el.querySelector('[data-action="share"]')?.remove();
    else el.querySelector('.ui-sum-actions')?.insertAdjacentHTML('beforeend', '<p class="sc-share-note" aria-live="polite"></p>');
    let sharing = false;
    const chip = el.querySelector('.ui-best');
    if (chip && s.bestLabel) chip.lastChild!.textContent = s.bestLabel;
    if (o.daily) {
      el.querySelector('.ui-sum-head')?.appendChild(dailyChip(o.daily.number, o.daily.scored));
      const again = el.querySelector('[data-action="again"]');
      const label = again && [...again.childNodes].find(n => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
      if (label) label.textContent = o.daily.again;
    }
    this.open('summary', el, {
      again: o.onAgain, profile: o.onProfile, home: o.onHome,
      share: t => {
        if (sharing || !o.onShare) return;
        sharing = true;
        t.setAttribute('aria-busy', 'true');
        const note = el.querySelector<HTMLElement>('.sc-share-note');
        if (note) note.textContent = '';
        void o.onShare().catch(() => 'Couldn\'t share that one. Try again?').then(line => {
          sharing = false;
          t.removeAttribute('aria-busy');
          if (note) note.textContent = line ?? '';
        });
      },
      // A greyed pass reward in the tally (shown once it has counted up): the Workshop, then home.
      workshop: t => this.looks?.onWorkshop(t.dataset.id ?? 'builders_pass', null),
    });
    const extra = el.querySelector<HTMLElement>('.ui-sum-extra')!;
    if (o.achievements?.length) extra.appendChild(summaryStrip(o.achievements));
    for (const q of o.questions) extra.appendChild(this.ask(q, o.onAnswer));
    this.sounds.ui('open');
    this.tally(el, o);
  }

  private ask(q: SummaryOptions['questions'][number], onAnswer: SummaryOptions['onAnswer']): HTMLElement {
    const ask = document.createElement('div');
    ask.className = 'sc-ask';
    ask.innerHTML = `<p>${esc(q.text)}</p><div class="sc-answers"></div>`;
    const answers: [string, string | number][] = q.kind === 'faces'
      ? ['😖', '😕', '😐', '🙂', '😄'].map((f, i) => [f, i + 1])
      : [['Yes', 'yes'], ['No', 'no']];
    const row = ask.querySelector('.sc-answers')!;
    for (const [label, ans] of answers) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-btn' + (q.kind === 'faces' ? ' sc-face' : '');
      b.textContent = label;
      b.setAttribute('aria-label', q.kind === 'faces' ? `${ans} of 5` : label);
      b.onclick = () => { this.sounds.ui('tap'); onAnswer(q.id, ans); ask.innerHTML = '<p class="sc-thanks">Thanks!</p>'; };
      row.appendChild(b);
    }
    return ask;
  }

  /** XP lines appear one at a time while the bar fills, wrapping at each level, then the level-up. */
  private tally(el: HTMLElement, o: SummaryOptions): void {
    const a = o.award;
    const lineCount = a.lines.length + 1; // the total is the last line
    let level = a.before.level, into = a.before.xp, shown = 0;
    const bar = () => setXpBar(el, { level, into, need: levelStep(level) });
    const finish = () => {
      level = a.after.level; into = a.after.xp; shown = a.gained;
      showAllXpLines(el);
      bar();
      // What each level reached gave, with the pass's reward beside it (greyed without the pass).
      const pass = !!this.looks?.ent().pass;
      for (let lv = a.before.level + 1; lv <= a.after.level; lv++) {
        const r = levelRewards(lv, { pass });
        if (r) el.querySelector('.ui-sum-xp')?.appendChild(r);
      }
      if (a.levelsGained > 0 && this.name === 'summary') this.levelUp(a.before.level, a.after.level, () => o.onSettled?.());
      else o.onSettled?.();
    };
    if (o.reducedMotion || a.gained <= 0) { finish(); return; }
    const lineMs = 260, dur = Math.max(1200, lineCount * lineMs + 400);
    const t0 = performance.now();
    let lastTick = 0, lines = 0;
    const frame = (now: number) => {
      if (!el.isConnected || this.name !== 'summary') return;
      const t = Math.min(1, (now - t0) / dur);
      while (lines < lineCount && now - t0 >= lines * lineMs) showXpLine(el, lines++);
      const target = a.gained * (1 - (1 - t) ** 2);
      let d = target - shown;
      shown = target;
      while (d > 0) {
        const room = levelStep(level) - into;
        if (d < room) { into += d; break; }
        d -= room;
        level++;
        into = 0;
      }
      if (now - lastTick > 70) { lastTick = now; this.sounds.xpTick(); }
      bar();
      if (t < 1) requestAnimationFrame(frame); else finish();
    };
    requestAnimationFrame(frame);
  }

  /**
   * The level-up takeover over the current screen: rays, the badge flipping to the new number,
   * confetti and the unlock card. "Nice!" removes it and calls done.
   */
  levelUp(from: number, to: number, done: () => void): void {
    const el = levelUp({ level: to, from, ...this.looks?.levelPass(from, to) });
    this.root.appendChild(el);
    const keep = this.name;
    this.name = 'levelup';
    this.sounds.levelUp(to);
    if (rewardAt(to)) setTimeout(() => this.sounds.ui('unlock'), 700);
    const unbind = this.bind(el, {
      continue: () => { unbind(); el.remove(); this.name = keep; done(); },
      // The level-10 card's "Take a look" (the pass's one mention): the Workshop, then home.
      workshop: t => { unbind(); el.remove(); this.name = keep; this.looks?.onWorkshop(t.dataset.id ?? 'builders_pass', null); },
    });
  }
}
