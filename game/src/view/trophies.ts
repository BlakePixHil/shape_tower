// Achievements on screen (gameplay.md §18.3): the toast during a run, the "New achievements" strip on
// the run summary and the Achievements panel, all from Art's kit (the profile's row is profilePanel's
// `achievements` option). This file maps the game's list onto Art's data and queues the toasts.

import { achievementStrip, achievementToast, achievementsPanel as artPanel, type AchievementGroup, type UiIcon } from '@art/index.ts';
import { ACHIEVEMENTS, GROUPS, earnedCount, progress, type Achievement } from '../meta/achievements.ts';
import type { Profile } from './profile.ts';

const GAP_MS = 250;
/** Art's toast takes 2.2 s and removes itself; this is the backstop if its animation never ends. */
const TOAST_MAX_MS = 4000;

/** The game numbers biomes from 1 (Meadow); Art from 0. */
const art = (a: Achievement) => ({ name: a.name, tier: a.tier, icon: a.icon as UiIcon, biome: a.biome ? a.biome - 1 : undefined });

export interface ToastOptions {
  reducedMotion(): boolean;
  /** Gate 1: with juice off the toast still shows, without its stamp, shine and sparkle. */
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
  private o: ToastOptions;

  constructor(o: ToastOptions) { this.o = o; }

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
    const t = achievementToast({ ...art(a), more: more || undefined }, { still: this.o.reducedMotion(), plain: !this.o.juice() });
    document.body.appendChild(t);
    this.current = t;
    this.o.sound(a);
    const done = () => {
      if (this.current !== t) return;
      t.remove();
      this.current = null;
      if (!this.queue.length) this.burst = 0; // nothing waiting: the next unlock starts a new burst
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.pump(), GAP_MS);
    };
    t.addEventListener('animationend', e => { if (e.target === t) done(); });
    this.timer = window.setTimeout(done, TOAST_MAX_MS);
  }
}

/** The run summary's "New achievements" strip (goes in the card's .ui-sum-extra, above QA's questions). */
export function summaryStrip(list: Achievement[]): HTMLElement {
  return achievementStrip(list.map(art));
}

/** The profile row's numbers, for profilePanel's `achievements` option. */
export function achievementCount(p: Profile): { got: number; total: number } {
  return { got: earnedCount(p), total: ACHIEVEMENTS.length };
}

/** The Achievements panel: every group, earned ones with their date, counted ones with progress. Action: close. */
export function achievementsPanel(p: Profile): HTMLElement {
  const groups: AchievementGroup[] = GROUPS.map(g => ({
    name: g.name,
    items: ACHIEVEMENTS.filter(a => a.group === g.id).map(a => {
      const got = p.achievements[a.id];
      return { id: a.id, ...art(a), text: a.text, secret: a.secret, got: got?.at, progress: got ? undefined : progress(p, a) ?? undefined };
    }),
  }));
  return artPanel({ groups });
}

/** Under the panel's total in the phone app: the same achievements in Google Play Games or Game Center. Action: stores. */
export function storeButton(name: string): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ui-btn wide ui-ach-store';
  b.dataset.action = 'stores';
  b.style.marginTop = '12px';
  b.textContent = `Open in ${name}`;
  return b;
}
