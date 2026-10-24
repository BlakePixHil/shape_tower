// The anonymous play stats (launch marketing plan, "What to measure"): the few counts the phone app
// sends our own server so we can see whether players come back, where new ones stop and how many Daily
// results get shared. No third-party analytics, nothing personalised: a random id that isn't the ladder
// id, the app version and Android or iPhone, and these events. Pure rules shared by the game
// (online/stats.ts) and the server (online/src/stats.ts): what a batch holds and how it's cleaned.

/** How the run was played: Endless, the Daily's scored try, Daily practice, or Zen. */
export type RunKind = 'endless' | 'daily' | 'practice' | 'zen';
export const RUN_KINDS: readonly RunKind[] = ['endless', 'daily', 'practice', 'zen'];

/** One thing that happened, at `t` (ms). */
export type StatEvent =
  /** The first time this copy of the game opens (once per install). */
  | { e: 'first_open'; t: number }
  /** The game opened, or came back after half an hour away; the player's level then. */
  | { e: 'session'; t: number; lv: number }
  /** A run ended: how, the level after it, checkpoints claimed and height (m, one decimal). */
  | { e: 'run_end'; t: number; m: RunKind; lv: number; cp: number; h: number }
  /** The share button: `ok` 1 when the share sheet went through, 0 when it was cancelled or failed. */
  | { e: 'share'; t: number; m: RunKind; ok: 0 | 1 }
  /** The game asked the store for a rating (the store decides whether its card shows). */
  | { e: 'review'; t: number };

export type StatName = StatEvent['e'];
export const STAT_NAMES: readonly StatName[] = ['first_open', 'session', 'run_end', 'share', 'review'];

export type Platform = 'android' | 'ios' | 'web';

/** What the app sends: POST <api>/stats. */
export interface StatBatch {
  /** The device's stats id (statsId). */
  id: string;
  p: Platform;
  /** The build: its commit. */
  b: string;
  events: StatEvent[];
  /** Stats turned off in Settings: the server deletes this device's row (events are ignored). */
  forget?: boolean;
}

export const STATS_ID_RE = /^[0-9a-f]{24}$/;
/** Events in one batch, events kept on the device while it can't send, and the oldest worth sending. */
export const MAX_BATCH = 50;
export const MAX_QUEUE = 200;
export const MAX_AGE_MS = 14 * 86_400_000;
/** Clocks run fast: events up to this far in the future are taken as now. */
const SKEW_MS = 10 * 60_000;

/**
 * The device's stats id: made from the ladder's device key, so deleting the ladder name (a new key) also
 * starts a new id, but hashed apart from the ladder id, so stats can never be matched to a ladder name.
 */
export async function statsId(key: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`shape-tower-stats:${key}`));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

const int = (v: unknown, max: number): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : 0;
};

/** One event as the server keeps it, or null when it isn't one we know. */
export function cleanEvent(raw: unknown, now: number): StatEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  let t = Number(r.t);
  if (!Number.isFinite(t) || t < now - MAX_AGE_MS || t > now + SKEW_MS) return null;
  t = Math.min(Math.floor(t), now);
  const kind = (): RunKind | null => (RUN_KINDS.includes(r.m as RunKind) ? (r.m as RunKind) : null);
  switch (r.e) {
    case 'first_open': return { e: 'first_open', t };
    case 'review': return { e: 'review', t };
    case 'session': return { e: 'session', t, lv: int(r.lv, 999) };
    case 'run_end': {
      const m = kind();
      return m ? { e: 'run_end', t, m, lv: int(r.lv, 999), cp: int(r.cp, 999), h: Math.round(Math.max(0, Math.min(9999, Number(r.h) || 0)) * 10) / 10 } : null;
    }
    case 'share': {
      const m = kind();
      return m ? { e: 'share', t, m, ok: r.ok ? 1 : 0 } : null;
    }
    default: return null;
  }
}

/** A batch as the server takes it: a good id, a known platform, at most MAX_BATCH known events. Null: refuse. */
export function cleanBatch(raw: unknown, now: number): StatBatch | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !STATS_ID_RE.test(r.id)) return null;
  const p: Platform = r.p === 'android' || r.p === 'ios' ? r.p : 'web';
  const b = typeof r.b === 'string' ? r.b.replace(/[^0-9A-Za-z._-]/g, '').slice(0, 16) : '';
  if (r.forget === true) return { id: r.id, p, b, events: [], forget: true };
  if (!Array.isArray(r.events)) return null;
  const events = r.events.slice(0, MAX_BATCH).map(e => cleanEvent(e, now)).filter((e): e is StatEvent => !!e);
  return { id: r.id, p, b, events };
}
