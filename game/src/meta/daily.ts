// The Daily Tower (gameplay.md §12, QA F17): one seed per UTC day for everyone, one scored attempt
// per seed ever, unlimited practice, and local results until online leaderboards arrive (QA Q23).
// Plain data and pure functions, so it runs in Node for tests; the profile stores the state.

/** Daily #1 is the UTC day the mode shipped. */
export const DAILY_EPOCH = '2026-10-21';
const DAY_MS = 86_400_000;
/** Practice results are kept for this many days (scored ones forever: they key the one-per-seed rule). */
const PRACTICE_DAYS = 7;

export interface DailyResult {
  /** Best height in metres above the first foundation. */
  height: number;
  score: number;
  checkpoints: number;
  /** Highest biome reached, 1 = Meadow. */
  biome: number;
  /** False while the run is going, and for good if the app died mid-run (the attempt still counts). */
  finished: boolean;
  /** When it started (ISO time). */
  at: string;
}

export interface DailyState {
  /** Scored attempts by seed day (YYYY-MM-DD, UTC). One per seed, ever (QA Q31). */
  scored: Record<string, DailyResult>;
  /** Practice on recent days: how many runs and the best one. */
  practice: Record<string, { runs: number; best: DailyResult | null }>;
}

export const freshDaily = (): DailyState => ({ scored: {}, practice: {} });

/** The seed day for a moment: the UTC date, so the tower changes at 00:00 UTC for everyone (F17.2). */
export function dailyDay(now = new Date()): string {
  return new Date(now.getTime()).toISOString().slice(0, 10);
}

/** Daily #N: 1 on DAILY_EPOCH. */
export function dailyNumber(day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${DAILY_EPOCH}T00:00:00Z`)) / DAY_MS) + 1;
}

/** The day's seed: a 32-bit hash of the date, the same on every device. */
export function dailySeed(day: string): number {
  let h = 0x811c9dc5;
  const s = `shape-tower-daily:${day}`;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  // Finish with murmur3's mixer so neighbouring dates land far apart.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Milliseconds until the next seed (00:00 UTC). */
export function msToNextDaily(now = new Date()): number {
  const t = now.getTime();
  return (Math.floor(t / DAY_MS) + 1) * DAY_MS - t;
}

/** "5h 12m", "12m", "40s" until the next seed. */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Whether the scored attempt for this seed is gone. A clock moved back never reopens it (D14). */
export const scoredUsed = (s: DailyState, day: string): boolean => day in s.scored;

/**
 * Uses up the day's scored attempt (call it when its first shape spawns, QA Q32). Returns false,
 * changing nothing, if it was already used.
 */
export function beginScored(s: DailyState, day: string, now = new Date()): boolean {
  if (scoredUsed(s, day)) return false;
  s.scored[day] = { height: 0, score: 0, checkpoints: 0, biome: 1, finished: false, at: now.toISOString() };
  return true;
}

/** Progress during a scored attempt, and its end. Values only grow, so a late call can't lower a result. */
export function updateScored(s: DailyState, day: string, r: Omit<DailyResult, 'at' | 'finished'>, finished = false): void {
  const e = s.scored[day];
  if (!e || e.finished) return;
  e.height = Math.max(e.height, round(r.height));
  e.score = Math.max(e.score, Math.round(r.score));
  e.checkpoints = Math.max(e.checkpoints, r.checkpoints);
  e.biome = Math.max(e.biome, r.biome);
  e.finished = finished;
}

/** Score first, then height: the order the leaderboard will use. */
export function better(a: DailyResult, b: DailyResult | null | undefined): boolean {
  if (!b) return true;
  return a.score !== b.score ? a.score > b.score : a.height > b.height;
}

/** Adds a finished practice run. Returns whether it beat the day's practice best. */
export function addPractice(s: DailyState, day: string, r: Omit<DailyResult, 'finished'>): boolean {
  const p = (s.practice[day] ??= { runs: 0, best: null });
  p.runs++;
  const res: DailyResult = { ...r, height: round(r.height), score: Math.round(r.score), finished: true };
  const best = better(res, p.best);
  if (best) p.best = res;
  prunePractice(s, day);
  return best;
}

/** Drops practice older than a week before `today`. */
export function prunePractice(s: DailyState, today: string): void {
  const n = dailyNumber(today);
  for (const d of Object.keys(s.practice)) if (n - dailyNumber(d) >= PRACTICE_DAYS) delete s.practice[d];
}

/**
 * Consecutive days with a scored attempt, ending today, or yesterday while today's is still open
 * (so the streak doesn't look lost before the player has had the chance).
 */
export function dailyStreak(s: DailyState, today: string): number {
  let n = dailyNumber(today);
  if (!scoredUsed(s, dayOf(n))) n--;
  let streak = 0;
  while (scoredUsed(s, dayOf(n))) { streak++; n--; }
  return streak;
}

/** The player's best scored days, best first. */
export function bestDays(s: DailyState, count = 3): { day: string; number: number; result: DailyResult }[] {
  return Object.entries(s.scored)
    .map(([day, result]) => ({ day, number: dailyNumber(day), result }))
    .sort((a, b) => (better(a.result, b.result) ? -1 : better(b.result, a.result) ? 1 : b.number - a.number))
    .slice(0, count);
}

/** How many scored attempts were played to the end. */
export const scoredFinished = (s: DailyState | undefined): number => Object.values(s?.scored ?? {}).filter(r => r.finished).length;

/** The UTC date of Daily #n. */
export function dayOf(n: number): string {
  return new Date(Date.parse(`${DAILY_EPOCH}T00:00:00Z`) + (n - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** Cleans a stored state: anything malformed is dropped rather than trusted. */
export function loadDaily(raw: unknown): DailyState {
  const s = freshDaily();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Partial<DailyState>;
  const ok = (x: unknown): x is DailyResult => !!x && typeof x === 'object' && typeof (x as DailyResult).score === 'number' && typeof (x as DailyResult).height === 'number';
  const fix = (x: DailyResult): DailyResult => ({ height: x.height, score: x.score, checkpoints: x.checkpoints ?? 0, biome: x.biome ?? 1, finished: !!x.finished, at: String(x.at ?? '') });
  const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (r.scored && typeof r.scored === 'object') for (const [d, x] of Object.entries(r.scored)) if (isDay(d) && ok(x)) s.scored[d] = fix(x);
  if (r.practice && typeof r.practice === 'object') {
    for (const [d, p] of Object.entries(r.practice)) {
      if (!isDay(d) || !p || typeof p !== 'object') continue;
      s.practice[d] = { runs: Number(p.runs) || 0, best: ok(p.best) ? fix(p.best) : null };
    }
  }
  return s;
}

const round = (x: number) => Math.round(x * 10) / 10;
