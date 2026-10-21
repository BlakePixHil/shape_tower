// The game's modes (gameplay.md §12): Endless, the Daily Tower (level 3) and Zen (level 8).
// A RunMode says which one a run is and anything it fixes before the run starts.

export type ModeId = 'endless' | 'daily' | 'zen';

export interface RunMode {
  id: ModeId;
  /** A fixed seed (the Daily Tower); a random one otherwise. */
  seed?: number;
  /** Daily Tower: the day's one scored attempt, or practice. */
  scored?: boolean;
  /** Daily Tower: the UTC date its seed belongs to (YYYY-MM-DD). */
  day?: string;
}

export const ENDLESS: RunMode = { id: 'endless' };
