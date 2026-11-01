// Achievements on Google Play Games and Game Center (gameplay.md §18.5). The device stays the source of
// truth: unlocks happen here exactly as before, and this passes them on to the phone's game service when
// the player is signed in to it. Sign-in is never prompted by the game: Play Games and Game Center sign
// returning players in on their own, and the Achievements panel's button asks only when tapped. On the
// game page (no native app) and in builds made before the consoles are set up, all of this does nothing.

import { ACHIEVEMENTS, BY_ID, TIER_POINTS, progress, type Achievement } from './achievements.ts';
import { STORE_IDS } from './store-ids.ts';
import type { Profile } from '../view/profile.ts';

export type StoreService = 'play' | 'gamecenter';

/** The native plugin (plugins/game-services): Play Games on Android, Game Center on iOS. */
export interface GameServicesApi {
  status(): Promise<{ available: boolean; signedIn: boolean; service: StoreService }>;
  signIn(): Promise<{ signedIn: boolean }>;
  unlock(o: { id: string }): Promise<{ sent: boolean }>;
  progress(o: { id: string; steps: number; total: number }): Promise<{ sent: boolean }>;
  show(): Promise<unknown>;
  addListener(event: 'signInChanged', cb: (e: { signedIn: boolean }) => void): Promise<unknown>;
}

export const SERVICE_NAMES: Record<StoreService, string> = { play: 'Google Play Games', gamecenter: 'Game Center' };

/**
 * Counted ones the stores show as progress too (Play Games incremental steps, Game Center percent). Streaks
 * can break, and both stores only count up, so they stay plain unlocks.
 */
export const isIncremental = (a: Achievement): boolean => !!a.goal && !a.id.startsWith('streak_');

/** One achievement as both consoles need it: the import kit and the uploads read this. */
export interface StoreRow {
  id: string;
  name: string;
  text: string;
  tier: Achievement['tier'];
  points: number;
  /** Hidden until earned (the game's secret ones). */
  hidden: boolean;
  /** Incremental: steps to unlock (Play Games); Game Center gets percent of it. */
  steps?: number;
  play: string;
  gameCenter: string;
  /** Console sort order. */
  order: number;
}

/** The ones the consoles have: Pop's in-game-only ones stay out (Pop plan §12). */
export const STORE_ACHIEVEMENTS = ACHIEVEMENTS.filter(a => !a.local);

export function storeRows(ids = STORE_IDS): StoreRow[] {
  return STORE_ACHIEVEMENTS.map((a, i) => ({
    id: a.id, name: a.name, text: a.text, tier: a.tier, points: TIER_POINTS[a.tier], hidden: !!a.secret,
    steps: isIncremental(a) ? a.goal : undefined,
    play: ids.play.achievements[a.id] ?? '', gameCenter: ids.gameCenter.prefix + a.id, order: i + 1,
  }));
}

/** Keeps the phone's game service in step with the profile's achievements. */
export class StoreSync {
  service: StoreService | null = null;
  /** The native side is there and this store's console ids are set. */
  available = false;
  signedIn = false;
  private api: GameServicesApi | null;
  private ids: typeof STORE_IDS;
  /** What was sent this session: unlocked ids, and the last steps per counted one. */
  private sent = new Set<string>();
  private steps = new Map<string, number>();
  private profile: Profile | null = null;

  constructor(api: GameServicesApi | null, ids = STORE_IDS) {
    this.api = api;
    this.ids = ids;
  }

  /** At launch: reads the sign-in Play Games or Game Center did on its own and, if signed in, catches up. */
  async start(p: Profile): Promise<void> {
    this.profile = p;
    if (!this.api) return;
    try {
      const s = await this.api.status();
      this.service = s.service;
      this.available = s.available && this.configured(s.service);
      if (!this.available) return;
      this.signedIn = s.signedIn;
      void this.api.addListener('signInChanged', e => {
        this.signedIn = e.signedIn;
        if (e.signedIn && this.profile) void this.sync(this.profile);
      });
      if (this.signedIn) await this.sync(p);
    } catch {
      this.available = false;
    }
  }

  private configured(service: StoreService): boolean {
    return service === 'play' ? /^\d+$/.test(this.ids.play.projectId) : this.ids.gameCenter.enabled;
  }

  /** This store's id for one of the game's achievements ('' when the console doesn't have it yet). */
  storeId(id: string): string {
    if (BY_ID.get(id)?.local) return '';
    if (this.service === 'play') return this.ids.play.achievements[id] ?? '';
    return this.service === 'gamecenter' ? this.ids.gameCenter.prefix + id : '';
  }

  /** Name for the panel's button, or null when there is nothing to open. */
  label(): string | null {
    return this.available && this.service ? SERVICE_NAMES[this.service] : null;
  }

  /** One new unlock, straight away. A counted one is sent as all its steps (Play Games unlocks incremental ones that way). */
  async report(id: string): Promise<void> {
    const sid = this.storeId(id), a = BY_ID.get(id);
    if (!this.api || !this.available || !this.signedIn || !sid || !a || this.sent.has(id)) return;
    try {
      const r = isIncremental(a) ? await this.api.progress({ id: sid, steps: a.goal!, total: a.goal! }) : await this.api.unlock({ id: sid });
      if (r.sent) this.sent.add(id);
    } catch { /* the next sync tries again */ }
  }

  /** Every unlock the profile has (the stores ignore repeats) and the counted ones' progress. */
  async sync(p: Profile): Promise<void> {
    this.profile = p;
    if (!this.api || !this.available || !this.signedIn) return;
    for (const a of STORE_ACHIEVEMENTS) {
      if (p.achievements[a.id]) await this.report(a.id);
      else if (isIncremental(a)) await this.reportSteps(p, a);
    }
  }

  private async reportSteps(p: Profile, a: Achievement): Promise<void> {
    const sid = this.storeId(a.id), pr = progress(p, a);
    if (!this.api || !sid || !pr || pr[0] <= (this.steps.get(a.id) ?? 0)) return;
    try {
      if ((await this.api.progress({ id: sid, steps: pr[0], total: pr[1] })).sent) this.steps.set(a.id, pr[0]);
    } catch { /* the next sync tries again */ }
  }

  /** The panel's button: signs in if needed (the only time the game asks), catches up, then opens the store's screen. */
  async open(p: Profile): Promise<boolean> {
    if (!this.api || !this.available) return false;
    try {
      if (!this.signedIn) this.signedIn = (await this.api.signIn()).signedIn;
      if (!this.signedIn) return false;
      await this.sync(p);
      await this.api.show();
      return true;
    } catch {
      return false;
    }
  }
}
