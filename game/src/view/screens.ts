// The game's screens (design doc "UI and screens"): main menu, pause, settings, profile, the
// run-over summary with its XP tally, and the level-up takeover. Art's UI kit draws them from
// plain data (art/src/ui/screens.ts); this file keeps the flow: what each button does, the sounds,
// the XP tally's timing and QA's one-tap questions.

import {
  MENU_MODES, avatarPanel, injectUiCss, levelUp, mainMenu, onAction, pauseCard, prewarmUi, profilePanel, readAvatar, readSettings, rewardAt, setXpBar, settingsPanel,
  showAllXpLines, showXpLine, summaryCard, type SettingGroup, type SettingValue,
} from '@art/index.ts';
import type { Achievement } from '../meta/achievements.ts';
import { levelStep } from '../sim/tuning.ts';
import type { Award, Profile } from './profile.ts';
import { achievementCount, achievementsPanel, summaryStrip } from './trophies.ts';
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
  play: 'start', again: 'start', resume: 'resume', profile: 'open', settings: 'open', share: 'open', avatar: 'open', done: 'tap2', achievements: 'open',
  close: 'back', home: 'back', quit: 'back', continue: 'tap',
};

// Only what the kit doesn't style: the container, the testing note, the build tag and QA's questions.
const CSS = `
.sc-root { display: none; }
.sc-root.show { display: block; }
.sc-testing { background: rgba(255,247,232,0.94); border: 2px solid ${INK}; border-radius: 10px; font: 700 13px 'Nunito', sans-serif; color: ${INK}; padding: 4px 10px; text-align: center; }
.sc-build { font: 600 11px 'Nunito', sans-serif; color: rgba(34,24,58,0.6); text-align: center; }
.sc-ask { padding: 8px 0 2px; border-top: 2px dashed rgba(34,24,58,0.25); text-align: center; }
.sc-ask p { font: 700 15px 'Nunito', sans-serif; color: ${INK}; margin: 0 0 6px; }
.sc-ask .sc-answers { display: flex; gap: 8px; justify-content: center; }
.sc-ask .ui-btn { min-height: 40px; padding: 4px 18px; font-size: 16px; }
.sc-ask .sc-face { font-size: 24px; padding: 2px 6px; min-width: 46px; }
.sc-ask .sc-thanks { font: 600 14px 'Nunito', sans-serif; color: ${INK_SOFT}; margin: 4px 0; }
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

const CAUSES: Record<string, string> = { bricks: 'Out of bricks!', hearts: 'Out of hearts!', quit: 'You quit' };
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const xpOf = (p: Profile) => ({ level: p.level, into: p.xp, need: levelStep(p.level) });

export interface SummaryStats {
  cause: string;
  height: number;
  newBest: boolean;
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
}

export class Screens {
  readonly root: HTMLDivElement;
  private name = '';
  private unbind: (() => void) | null = null;
  /** The player's name on the menu and profile (no naming screen yet). */
  playerName = 'Builder';

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
  private open(name: string, el: HTMLElement, handlers: Record<string, () => void>): HTMLElement {
    this.close();
    this.name = name;
    this.root.appendChild(el);
    this.root.classList.add('show');
    this.unbind = this.bind(el, handlers);
    return el;
  }

  private bind(el: HTMLElement, handlers: Record<string, () => void>): () => void {
    return onAction(el, action => {
      const fn = handlers[action];
      if (!fn) return;
      this.sounds.ui(ACTION_SOUND[action] ?? 'tap');
      fn();
    });
  }

  // ---------------------------------------------------------------- main menu

  menu(o: { profile: Profile; build: string; note?: string; still?: boolean; onPlay(): void; onProfile(): void; onSettings(): void }): void {
    const p = o.profile;
    // Daily Tower and Zen open at their levels but aren't built yet.
    const modes = MENU_MODES.map(m => (p.level >= (m.unlockAt ?? 0) ? { ...m, sub: 'Coming in the next build' } : m));
    const el = mainMenu({ name: this.playerName, ...xpOf(p), avatar: p.avatar, modes, still: o.still });
    const bottom = el.querySelector('.ui-menu-bottom')!;
    if (o.note) bottom.insertAdjacentHTML('afterbegin', `<div class="sc-testing">${esc(o.note)}</div>`);
    bottom.insertAdjacentHTML('beforeend', `<div class="sc-build">build ${esc(o.build)}</div>`);
    this.open('menu', el, { play: o.onPlay, profile: o.onProfile, settings: o.onSettings });
  }

  // ---------------------------------------------------------------- pause

  pause(o: { onResume(): void; onRestart(): void; onSettings(): void; onQuit(): void }): void {
    this.open('pause', pauseCard(), { resume: o.onResume, restart: o.onRestart, settings: o.onSettings, quit: o.onQuit });
  }

  // ---------------------------------------------------------------- settings

  settings(s: PlayerSettings, onChange: (s: PlayerSettings) => void, onBack: () => void): void {
    const el = settingsPanel(s as unknown as Record<string, SettingValue>, LAYOUT);
    const apply = () => { Object.assign(s, readSettings(el)); onChange(s); };
    el.addEventListener('input', e => { if ((e.target as HTMLInputElement).type === 'range') apply(); });
    el.addEventListener('change', e => {
      const i = e.target as HTMLInputElement;
      this.sounds.ui(i.type === 'checkbox' ? (i.checked ? 'toggleOn' : 'toggleOff') : i.type === 'radio' ? 'tab' : 'slider');
      apply();
    });
    this.open('settings', el, { close: onBack });
  }

  // ---------------------------------------------------------------- profile

  /** The profile; tapping the avatar opens the picker, and `onSave` stores a new choice. */
  profile(p: Profile, onBack: () => void, onSave: () => void): void {
    const st = p.stats;
    const el = profilePanel({
      name: this.playerName, ...xpOf(p), avatar: p.avatar,
      stats: { bestHeight: st.bestHeight, bestBiome: Math.max(0, st.bestBiome - 1), bricks: st.bricks, perfects: st.perfects, rows: st.rows, checkpoints: st.checkpoints, runs: p.runs, streak: p.streak },
      postcards: p.postcards,
      // Achievements (gameplay.md §18.3): a row under the stats opens the panel.
      achievements: achievementCount(p),
    });
    const back = () => this.profile(p, onBack, onSave);
    this.open('profile', el, { close: onBack, avatar: () => this.avatar(p, back, onSave), achievements: () => this.achievements(p, back) });
  }

  /** Every achievement by group: earned ones with their date, counted ones with progress. */
  achievements(p: Profile, onBack: () => void): void {
    this.open('achievements', achievementsPanel(p), { close: onBack });
  }

  /** Art's avatar picker: shape, face and a hat (hats above the player's level stay locked). Done keeps the choice. */
  private avatar(p: Profile, onBack: () => void, onSave: () => void): void {
    const el = avatarPanel({ avatar: p.avatar, level: p.level });
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
    // There's no share sheet yet, so the share button stays out.
    el.querySelector('[data-action="share"]')?.remove();
    this.open('summary', el, { again: o.onAgain, profile: o.onProfile, home: o.onHome });
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
      if (a.levelsGained > 0 && this.name === 'summary') this.levelUp(a.before.level, a.after.level, () => {});
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
    const el = levelUp({ level: to, from });
    this.root.appendChild(el);
    const keep = this.name;
    this.name = 'levelup';
    this.sounds.levelUp(to);
    if (rewardAt(to)) setTimeout(() => this.sounds.ui('unlock'), 700);
    const unbind = this.bind(el, {
      continue: () => { unbind(); el.remove(); this.name = keep; done(); },
    });
  }
}
