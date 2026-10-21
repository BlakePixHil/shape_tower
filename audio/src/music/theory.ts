// Keys, pentatonic scales and chords. Every pitched sound in the game (landing
// notes, stingers, chords) is built from these so it always sits in the key of
// the current biome.

export type Mode = 'major' | 'minor';

export interface Key {
  /** MIDI note of the tonic in the register the landing ladder starts from */
  root: number;
  mode: Mode;
}

export const PENTATONIC: Record<Mode, number[]> = {
  major: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
};

const TRIAD: Record<Mode, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
};

/** MIDI note for a pentatonic scale degree (any integer, wraps across octaves). */
export function scaleNote(key: Key, degree: number): number {
  const s = PENTATONIC[key.mode];
  const oct = Math.floor(degree / s.length);
  const idx = ((degree % s.length) + s.length) % s.length;
  return key.root + 12 * oct + s[idx];
}

/** The note a pentatonic "third" above the given degree (two scale steps up). */
export function harmonyAbove(key: Key, degree: number): number {
  return scaleNote(key, degree + 2);
}

/** Triad on the tonic, optionally widened: 1 = triad, 2 = plus octave, 3 = full bloom. */
export function tonicChord(key: Key, size: 1 | 2 | 3 = 1, octave = 0): number[] {
  const base = key.root + 12 * octave;
  const t = TRIAD[key.mode].map((i) => base + i);
  if (size >= 2) t.push(base + 12);
  if (size >= 3) t.push(base + 12 + TRIAD[key.mode][1], base + 19, base - 12);
  return t;
}

/** Ascending arpeggio of the first `count` pentatonic degrees from `start`. */
export function run(key: Key, start: number, count: number, stride = 1): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(scaleNote(key, start + i * stride));
  return out;
}

export const keyName = (key: Key): string => {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  return `${names[((key.root % 12) + 12) % 12]} ${key.mode}`;
};
