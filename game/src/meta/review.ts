// When the game asks the store for a rating (launch marketing plan, store listing): only right after a
// happy moment (a new best height, or a Daily result with a checkpoint in it), never after a run that
// just went badly, and rarely. The store decides whether its card actually shows; we only ever ask.
// Pure rules, so they run in Node for tests; the device keeps when it last asked.

export interface ReviewState {
  /** When the game asked the store (ms), oldest first. */
  asked: number[];
}

/** Runs and level before the first ask: the player knows the game by then. */
export const REVIEW_MIN_RUNS = 8;
export const REVIEW_MIN_LEVEL = 3;
/** Days between asks, and the most asks ever (the App Store shows its card at most 3 times a year anyway). */
export const REVIEW_GAP_DAYS = 60;
export const REVIEW_MAX = 3;

const DAY_MS = 86_400_000;

export const freshReview = (): ReviewState => ({ asked: [] });

export function loadReview(raw: unknown): ReviewState {
  const a = (raw as Partial<ReviewState> | null)?.asked;
  return { asked: Array.isArray(a) ? a.filter(x => typeof x === 'number' && isFinite(x)).slice(-REVIEW_MAX) : [] };
}

/** How the run that just ended went. */
export interface ReviewMoment {
  mode: 'endless' | 'daily' | 'zen';
  /** A scored Daily try (practice doesn't count). */
  scored?: boolean;
  /** The summary says "New best!" (Endless only). */
  newBest: boolean;
  checkpoints: number;
  quit: boolean;
  /** The player's runs and level after this one. */
  runs: number;
  level: number;
}

/** A happy moment: a new Endless best, or a scored Daily try that claimed a checkpoint. Never a quit or Zen. */
export function happyMoment(m: ReviewMoment): boolean {
  if (m.quit || m.mode === 'zen') return false;
  if (m.mode === 'endless') return m.newBest;
  return !!m.scored && m.checkpoints >= 1;
}

/** Ask the store now? A happy moment, enough play behind it, and the last ask long enough ago. */
export function shouldAskReview(s: ReviewState, m: ReviewMoment, now = Date.now()): boolean {
  if (!happyMoment(m) || m.runs < REVIEW_MIN_RUNS || m.level < REVIEW_MIN_LEVEL) return false;
  if (s.asked.length >= REVIEW_MAX) return false;
  const last = s.asked[s.asked.length - 1];
  return last === undefined || now - last >= REVIEW_GAP_DAYS * DAY_MS;
}

export function markAsked(s: ReviewState, now = Date.now()): void {
  s.asked = [...s.asked, now].slice(-REVIEW_MAX);
}
