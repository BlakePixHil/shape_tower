// A Blockling Pop run as data (Pop plan §11, §15): its seed, mode, rules version and moves. The same
// record replays to the same board and score anywhere, which is how a run resumes after the app closes
// and, from milestone 4, how the server checks a score before it goes on a board.

import { PopSim, decodeIntent, type PopModeId } from './pop.ts';
import { POP_RULES_KNOWN } from './tuning.ts';

export interface PopRecord {
  /** The rules version the run was played under (tuning.ts POP_RULES). */
  v: number;
  seed: number;
  mode: PopModeId;
  /** Deal rule 2 for the whole run (one of the player's first Pop runs). */
  newPlayer: boolean;
  /** Daily Pop's shape set, when it has one. */
  set?: string[] | null;
  /** Rules 2: the run started with a power (level 6's head start) or Second Wind ready. */
  headStart?: boolean;
  windReady?: boolean;
  /** The moves, two base-36 characters each. */
  moves: string;
}

/** Moves as a compact string (two base-36 characters each: every intent number is under 1,296). */
export function encodeMoves(moves: readonly number[]): string {
  return moves.map(n => n.toString(36).padStart(2, '0')).join('');
}

export function decodeMoves(s: string): number[] | null {
  if (typeof s !== 'string' || s.length % 2 || !/^[0-9a-z]*$/.test(s)) return null;
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 2) out.push(parseInt(s.slice(i, i + 2), 36));
  return out;
}

/** The record of a run so far. */
export function recordOf(sim: PopSim): PopRecord {
  return {
    v: sim.rules, seed: sim.seed, mode: sim.mode, newPlayer: sim.newPlayer, ...(sim.set ? { set: [...sim.set] } : {}),
    ...(sim.headStart ? { headStart: true } : {}), ...(sim.windReady ? { windReady: true } : {}), moves: encodeMoves(sim.moves),
  };
}

/**
 * Plays a record back from its seed. Returns the sim where it stands after the last move, or null when
 * the record is from other rules, broken, or has a move the sim refuses (a tampered record).
 */
export function replay(r: PopRecord): PopSim | null {
  if (!r || !POP_RULES_KNOWN.includes(r.v) || typeof r.seed !== 'number') return null;
  const moves = decodeMoves(r.moves);
  if (!moves) return null;
  const sim = new PopSim({
    seed: r.seed, mode: r.mode === 'daily' ? 'daily' : 'endless', newPlayer: !!r.newPlayer, set: r.set ?? null, rules: r.v, headStart: !!r.headStart, windReady: !!r.windReady,
  });
  for (const n of moves) {
    const it = decodeIntent(n);
    if (!it || !sim.apply(it)) return null;
  }
  sim.events = [];
  return sim;
}
