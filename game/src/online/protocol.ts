// What the game and the ladder server say to each other (gameplay.md §12.3). One POST per call, JSON in
// and out; a reply is either the answer or { error }. Shared by game/src/online/api.ts and online/.

import type { LadderAvatar, LadderView, SubmitProblem, Submission } from '../meta/ladder.ts';
import type { NameProblem } from '../meta/names/names.ts';

export type Op = 'me' | 'name' | 'look' | 'submit' | 'ladder' | 'report' | 'forget';

/** How the player looks on the ladder. */
export interface Look { portrait: string; avatar: LadderAvatar }

export interface Me {
  id: string;
  /** Null until they make one: then they only have personal bests. */
  name: string | null;
  portrait: string;
  avatar: LadderAvatar;
  /** Their name was hidden by reports: it shows as a stand-in until they pick another. */
  hidden: boolean;
  /** When they last picked a name (ms; 0 never). */
  renamedAt: number;
}

export type LadderError = NameProblem | SubmitProblem | 'taken' | 'renamed' | 'noname' | 'nokey' | 'self' | 'badop' | 'busy' | 'offline';

export interface LadderRequest {
  op: Op;
  /** The device key (every op but 'ladder'). */
  key?: string;
  name?: string;
  look?: Look;
  sub?: Submission;
  /** 'ladder': the day, and whose row to pick out. */
  day?: string;
  id?: string;
  /** 'report': whose name. */
  target?: string;
}

export type LadderReply = { error: LadderError } | { me: Me } | { view: LadderView } | { ok: true };

/** A name can change once a week, except to fix one hidden by reports or to change its capitals. */
export const RENAME_MS = 7 * 86_400_000;
