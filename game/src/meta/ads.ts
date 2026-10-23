// End-of-run ads (monetisation plan v2, "Ads between runs"): when one is due. Pure, so Node checks it
// (tests/shop-check.ts). The game counts active run time only: paused time, menus and the run-over
// screens don't count. An ad is due once 6 minutes of it have built up since the last ad, and it shows
// after the summary of the run that crosses that line, when the player taps to go on. At most one per
// run end and 8 a local day, none below profile level 3 (and time before level 3 doesn't count, so the
// first ad comes a good stretch after it), and none at all with Remove Ads. If no ad loads, nothing
// shows and it stays due. Only the store apps show ads; web builds never do.

/** The tuning: change these from soft-launch data. If ads hurt retention or reviews, lengthen the gap first. */
export const ADS = {
  /** Active run time between ads. */
  gapMs: 6 * 60_000,
  /** Ads in one local day. */
  perDay: 8,
  /** The profile level ads start at. */
  minLevel: 3,
};

export interface AdState {
  /** Active run time since the last ad (only time played at level 3 or above). */
  runMs: number;
  /** The local date `today` counts. */
  day: string;
  /** Ads shown on `day`. */
  today: number;
  /** Ads shown ever, for QA. */
  total: number;
}

export const freshAds = (): AdState => ({ runMs: 0, day: '', today: 0, total: 0 });

/** A saved state made safe (missing or damaged fields start fresh). */
export function loadAds(raw: unknown): AdState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AdState>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return { runMs: n(r.runMs), day: typeof r.day === 'string' ? r.day : '', today: n(r.today), total: n(r.total) };
}

export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Adds active run time. `level` is the player's profile level while it was played. */
export function addRunTime(s: AdState, ms: number, level: number): void {
  if (level >= ADS.minLevel && ms > 0) s.runMs += ms;
}

/** Why no ad shows now, or 'due'. */
export type AdCheck = 'due' | 'noads' | 'level' | 'cap' | 'time';

export function adCheck(s: AdState, o: { level: number; noAds: boolean; now?: Date }): AdCheck {
  if (o.noAds) return 'noads';
  if (o.level < ADS.minLevel) return 'level';
  if (s.day === localDay(o.now ?? new Date()) && s.today >= ADS.perDay) return 'cap';
  if (s.runMs < ADS.gapMs) return 'time';
  return 'due';
}

/** An ad was shown: the gap starts again and today's count goes up. */
export function adShown(s: AdState, now = new Date()): void {
  const day = localDay(now);
  if (s.day !== day) { s.day = day; s.today = 0; }
  s.today++;
  s.total++;
  s.runMs = 0;
}
