// The Daily Tower's ladder (gameplay.md §12.3): today's scored tries from every player with a name,
// highest first. Pure rules shared by the game, the game page's own store and the server: what an
// entry holds, the order, which submissions are believable, and when a name is hidden.

import { dailyDay, dayOf, dailyNumber } from './daily.ts';
import { nameShowable, placeholderName } from './names/names.ts';
import { portraitDef } from './portraits.ts';

/** The player's Blockling as the ladder carries it (art's AvatarSpec, kept loose so the server needs no art). */
export interface LadderAvatar { shape?: string; face?: string; hat?: string | null }

export interface LadderEntry {
  /** The player's id: a hash of their device key (app) or their claude.ai id (game page). */
  id: string;
  name: string;
  portrait: string;
  avatar: LadderAvatar;
  height: number;
  score: number;
  checkpoints: number;
  /** False while the try is going, and for good if the app died mid-run (it still counts as it stood). */
  finished: boolean;
  /** When the try started (ms): ties go to whoever got there first. */
  at: number;
  /** Hidden by reports: shown under a stand-in name until its owner picks another. */
  hidden?: boolean;
}

export interface LadderRow extends LadderEntry { rank: number }

/** One day's ladder as a device sees it: the top rows, how many played, and the player's own row. */
export interface LadderView {
  day: string;
  total: number;
  top: LadderRow[];
  me: LadderRow | null;
}

/** What a device sends: its scored try so far. */
export interface Submission {
  day: string;
  height: number;
  score: number;
  checkpoints: number;
  finished: boolean;
  /** When the try started on the device (ms). */
  startedAt: number;
}

/** How many rows a ladder shows. */
export const LADDER_TOP = 50;
/** Different players' reports that hide a name. */
export const REPORTS_TO_HIDE = 3;
/** A try that started before 00:00 UTC may still finish and report this long after. */
export const LATE_MS = 2 * 3600_000;
/** The fastest believable climb: metres per second, plus a head start for the first slab and a lucky stack. */
export const CLIMB_RATE = 2;
export const CLIMB_SLACK = 30;
/** Highest believable height (Deep Cosmos is about 1 km up). */
export const MAX_HEIGHT = 5000;

/** Height first, then score, then whoever started first: "the highest distance wins". */
export function compareEntries(a: LadderEntry, b: LadderEntry): number {
  return b.height - a.height || b.score - a.score || a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Ranks a day's entries (equal height and score share a rank) and picks out the top and the player's own row. */
export function rankLadder(day: string, entries: LadderEntry[], meId: string | null, top = LADDER_TOP): LadderView {
  const sorted = [...entries].sort(compareEntries);
  const rows: LadderRow[] = [];
  sorted.forEach((e, i) => {
    const prev = rows[i - 1];
    const tie = prev && prev.height === e.height && prev.score === e.score;
    rows.push({ ...e, rank: tie ? prev.rank : i + 1 });
  });
  return { day, total: rows.length, top: rows.slice(0, top), me: rows.find(r => r.id === meId) ?? null };
}

/** The name a row shows: a stand-in while hidden by reports or when today's filter refuses it. */
export function shownName(e: Pick<LadderEntry, 'id' | 'name' | 'hidden'>): string {
  return e.hidden || !e.name || !nameShowable(e.name) ? placeholderName(e.id) : e.name;
}

export type SubmitProblem = 'bad' | 'closed' | 'early' | 'implausible' | 'finished';

/**
 * Whether a submission may change the ladder: well formed, for a day still open (today, or yesterday
 * for a try that started before midnight), not before the try began, no faster than anyone can climb,
 * and never touching a try already finished. `prev` is the stored entry; `now` the receiver's clock.
 */
export function submitProblem(s: Submission, prev: LadderEntry | undefined, now: number): SubmitProblem | null {
  const num = (x: unknown, max: number): boolean => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max;
  if (!s || typeof s.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.day) || dailyNumber(s.day) < 1) return 'bad';
  if (!num(s.height, MAX_HEIGHT) || !num(s.score, 1e9) || !num(s.checkpoints, 1000) || !Number.isInteger(s.checkpoints) || typeof s.finished !== 'boolean' || !num(s.startedAt, 1e14)) return 'bad';
  const today = dailyDay(new Date(now)), yesterday = dayOf(dailyNumber(today) - 1);
  const dayStart = Date.parse(`${s.day}T00:00:00Z`);
  if (s.day !== today && !(s.day === yesterday && now - Date.parse(`${today}T00:00:00Z`) < LATE_MS)) return 'closed';
  if (s.startedAt < dayStart || s.startedAt > dayStart + 86_400_000 || s.startedAt > now + 60_000) return 'early';
  if (prev?.finished) return 'finished';
  const from = Math.min(s.startedAt, prev?.at ?? Infinity);
  if (s.height > CLIMB_SLACK + CLIMB_RATE * Math.max(0, now - from) / 1000) return 'implausible';
  return null;
}

/** A submission folded into the stored entry: progress only grows, and a finished try freezes. */
export function mergeEntry(prev: LadderEntry | undefined, s: Submission, who: Pick<LadderEntry, 'id' | 'name' | 'portrait' | 'avatar'>): LadderEntry {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return {
    id: who.id, name: who.name, portrait: who.portrait, avatar: who.avatar,
    height: Math.max(prev?.height ?? 0, r1(s.height)),
    score: Math.max(prev?.score ?? 0, Math.round(s.score)),
    checkpoints: Math.max(prev?.checkpoints ?? 0, s.checkpoints),
    finished: s.finished,
    at: Math.min(prev?.at ?? Infinity, s.startedAt),
    ...(prev?.hidden ? { hidden: true } : {}),
  };
}

/**
 * A look as sent, made safe: a known portrait (else `fallback`'s) and an avatar of plain words. Which
 * portraits a player owns is the game's business; a wrong one is only a picture.
 */
export function cleanLook(l: unknown, fallback: { portrait: string; avatar: LadderAvatar }): { portrait: string; avatar: LadderAvatar } {
  const look = (l && typeof l === 'object' ? l : {}) as { portrait?: unknown; avatar?: unknown };
  const word = (x: unknown): string | undefined => (typeof x === 'string' && /^[A-Za-z_]{1,16}$/.test(x) ? x : undefined);
  const a = (look.avatar && typeof look.avatar === 'object' ? look.avatar : {}) as LadderAvatar;
  return {
    portrait: typeof look.portrait === 'string' && portraitDef(look.portrait) ? look.portrait : fallback.portrait,
    avatar: { shape: word(a.shape) ?? fallback.avatar.shape, face: word(a.face) ?? fallback.avatar.face, hat: a.hat === null ? null : word(a.hat) ?? fallback.avatar.hat ?? null },
  };
}

/** A device's secret key: 32 random bytes as hex, made once and kept on the device. */
export const KEY_RE = /^[0-9a-f]{64}$/;

/** The public id a device key stands for (the key itself never leaves the device except to the server). */
export async function playerId(key: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`shape-tower:${key}`));
  return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
