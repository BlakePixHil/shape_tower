// Voice allocation (audio section 8.2 and 8.3). Pure logic with no Web Audio
// dependency, so the caps and stealing rules are unit-tested directly.

import type { Category, Priority } from './types';

export const FULL_CAPS: Record<Category, number> = {
  impact: 8, note: 4, scrape: 2, creak: 2, ui: 4, stinger: 3, ambience: 3, misc: 6,
};
export const FULL_GLOBAL_CAP = 32;

export interface VoiceInfo {
  id: number;
  category: Category;
  priority: Priority;
  /** linear gain the voice was started at; quieter voices are stolen first */
  loudness: number;
  start: number;
  end: number;
  stop: (when: number) => void;
}

export interface VoiceRequest {
  category: Category;
  priority: Priority;
  loudness: number;
  now: number;
}

export type Admission = { ok: true; victims: VoiceInfo[] } | { ok: false; reason: string };

export class VoiceAllocator {
  private active: VoiceInfo[] = [];
  private recentHigh: number[] = [];
  private nextId = 1;
  /** highest simultaneous count seen, for QA */
  peakCount = 0;
  readonly caps: Record<Category, number>;
  readonly globalCap: number;

  constructor(lowEnd = false) {
    const k = lowEnd ? 0.5 : 1;
    this.caps = Object.fromEntries(Object.entries(FULL_CAPS).map(([c, v]) => [c, Math.max(1, Math.round(v * k))])) as Record<Category, number>;
    this.globalCap = Math.round(FULL_GLOBAL_CAP * k);
  }

  newId(): number {
    return this.nextId++;
  }

  prune(now: number): void {
    if (this.active.length) this.active = this.active.filter((v) => v.end > now);
    if (this.recentHigh.length) this.recentHigh = this.recentHigh.filter((t) => now - t < 0.1);
  }

  count(category?: Category): number {
    return category ? this.active.filter((v) => v.category === category).length : this.active.length;
  }

  counts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const v of this.active) out[v.category] = (out[v.category] ?? 0) + 1;
    return out;
  }

  /** Decides whether a new voice may start, and which voices it replaces. */
  admit(req: VoiceRequest): Admission {
    this.prune(req.now);
    // P3 yields when the moment is already crowded with critical or input sounds
    if (req.priority === 3 && this.recentHigh.length >= 3) return { ok: false, reason: 'crowded' };

    const victims: VoiceInfo[] = [];
    const inCat = this.active.filter((v) => v.category === req.category);
    if (inCat.length >= this.caps[req.category]) {
      const v = this.pickVictim(inCat, req, true);
      if (v) victims.push(v);
      else if (req.priority !== 1) return { ok: false, reason: 'category full' };
    }
    const total = this.active.length - victims.length;
    if (total >= this.globalCap) {
      const pool = this.active.filter((v) => !victims.includes(v));
      const v = this.pickVictim(pool, req, false);
      if (v) victims.push(v);
      else if (req.priority !== 1) return { ok: false, reason: 'global full' };
    }
    return { ok: true, victims };
  }

  /** Least important first: lower priority, then quieter, then older. P1 is never stolen. */
  private pickVictim(pool: VoiceInfo[], req: VoiceRequest, sameCategory: boolean): VoiceInfo | undefined {
    const candidates = pool.filter((v) => {
      if (v.priority === 1) return false;
      if (v.priority > req.priority) return true;
      // within a category, an equally important but quieter voice can be replaced by a louder one
      return sameCategory && v.priority === req.priority && v.loudness <= req.loudness;
    });
    candidates.sort((a, b) => b.priority - a.priority || a.loudness - b.loudness || a.start - b.start);
    return candidates[0];
  }

  add(v: VoiceInfo): void {
    this.active.push(v);
    if (v.priority <= 2) this.recentHigh.push(v.start);
    if (this.active.length > this.peakCount) this.peakCount = this.active.length;
  }

  remove(id: number): void {
    this.active = this.active.filter((v) => v.id !== id);
  }

  all(): readonly VoiceInfo[] {
    return this.active;
  }
}

/** Per-key cooldowns (per-body impact spacing, rate limits). */
export class Cooldowns {
  private last = new Map<string, number>();

  /** True (and records the time) if at least `gap` seconds passed since the last accepted call for key. */
  ready(key: string, now: number, gap: number): boolean {
    const t = this.last.get(key);
    if (t !== undefined && now - t < gap) return false;
    this.last.set(key, now);
    if (this.last.size > 512) {
      // forget the oldest half so long runs don't grow this without bound
      const keys = [...this.last.keys()].slice(0, 256);
      for (const k of keys) this.last.delete(k);
    }
    return true;
  }

  clear(): void {
    this.last.clear();
  }
}
