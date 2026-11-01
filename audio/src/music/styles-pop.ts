// Blockling Pop's score (Pop plan, Music and sound): a laid-back, bouncy "toy-box lounge" at 96 BPM
// with a light swing, played by the tower's band plus the soft electric keys. The tower's music
// climbs and tightens toward each checkpoint; Pop has no clock, so its music is cosy and loops
// forever, and the excitement comes from the pops. Four arrangement families follow the sky, in
// the tower's biome keys; every note bakes at half rate.
//
//   Ground (Meadow, Treetops)                            keys and uke, marimba, walking bass, brushes and snaps
//   Sky (Cloudlands, Storm Belt, Stratosphere)           vibes lead, harp arpeggios, a soft choir pad
//   Space (Orbit, Moon, Red Planet, Ringed Giant)        music box lead, analog pad, sub bass, half-time drums
//   Cosmos (Deep Cosmos)                                 the three in turn, over a nebula choir

import { DRUM } from '../synth/band';
import type { MusicStyle } from './styles';

export type PopFamily = 'ground' | 'sky' | 'space';

const kit = (kick: number, snare: number, hat: number, ...perc: number[]) => ({ kick, snare, hat, perc });

/** Shared by every family: the tempo, the swing on the lead and keys, sevenths, half-rate notes. */
const LOUNGE_FEEL = { bpm: 96, swingAll: true, sevenths: true, low: true } as const;

export const POP_FAMILIES: Record<PopFamily, MusicStyle> = {
  // A sunny café: keys comping and a keys melody, an offbeat uke, walking bass, felt kick, snaps on 2 and 4,
  // shaker eighths and brush accents. The board plays marimba.
  ground: {
    ...LOUNGE_FEEL,
    lead: 'keys', leadLow: 72, support: 'uke', supportLow: 60, supportPattern: 'offbeat',
    pad: 'keys', padLow: 55, padPattern: 'comp', bass: 'bassPluck', bassLow: 36, bassPattern: 'walk',
    kit: kit(DRUM.feltKick, DRUM.snap, DRUM.shaker, DRUM.brush), half: false, swing: 0.08,
    // Imaj7 vi7 ii7 V7, then IVmaj7 iii7 ii7 V7
    progressions: [[0, 5, 1, 4], [3, 2, 1, 4]], busy: 1,
    mix: { pad: -18, bass: -15, support: -25, drums: -19, lead: -16 },
    pop: { family: 'ground', board: 'marimba', boardLow: 60, sparkle: 'celesta', sparkleLow: 79 },
  },
  // Airy and floating: vibes over harp arpeggios, the keys swaying under a soft "ooh" choir, brushes.
  // The board plays a glass bell.
  sky: {
    ...LOUNGE_FEEL,
    lead: 'vibes', leadLow: 67, support: 'harp', supportLow: 55, supportPattern: 'arp',
    pad: 'keys', padLow: 53, padPattern: 'sway', hold: 'choir', holdLow: 55,
    bass: 'bassSoft', bassLow: 38, bassPattern: 'roots',
    kit: kit(DRUM.feltKick, DRUM.brush, DRUM.shaker, DRUM.snap), half: false, swing: 0.06,
    progressions: [[0, 3, 5, 4], [3, 4, 2, 5]], busy: 0,
    mix: { pad: -19, bass: -16, support: -24, drums: -21, lead: -16 },
    pop: { family: 'sky', board: 'glassBell', boardLow: 67, sparkle: 'celesta', sparkleLow: 79 },
  },
  // Dreamy and slow: a music box over an analog pad, one keys chord a bar, sub bass, half-time drums.
  // The board plays celesta.
  space: {
    ...LOUNGE_FEEL,
    lead: 'musicBox', leadLow: 69, support: 'vibes', supportLow: 57, supportPattern: 'bells',
    pad: 'keys', padLow: 52, padPattern: 'bloom', hold: 'padAnalog', holdLow: 57,
    bass: 'bassSub', bassLow: 33, bassPattern: 'long',
    kit: kit(DRUM.feltKick, DRUM.snap, DRUM.shaker, DRUM.triangle), half: true, swing: 0.05,
    progressions: [[0, 5, 3, 4], [5, 3, 0, 4]], busy: 0,
    mix: { pad: -18, bass: -15, support: -25, drums: -21, lead: -16 },
    pop: { family: 'space', board: 'celesta', boardLow: 64, sparkle: 'glassBell', sparkleLow: 76 },
  },
};

/** Which family plays in a biome (1 to 10). */
export function popFamily(biomeId: number, rotation = 0): PopFamily {
  const id = Math.min(10, Math.max(1, Math.round(biomeId)));
  if (id <= 2) return 'ground';
  if (id <= 5) return 'sky';
  if (id <= 9) return 'space';
  return (['ground', 'sky', 'space'] as const)[Math.max(0, rotation) % 3];
}

/**
 * Pop's band for a biome. Each biome keeps its own tunes (the theme is seeded by the biome id) in its
 * own key; Deep Cosmos rotates through the three families over a nebula choir, and its home rotation
 * plays the Meadow's tunes.
 */
export function popStyleFor(biomeId: number, rotation = 0): MusicStyle {
  const id = Math.min(10, Math.max(1, Math.round(biomeId)));
  const s = POP_FAMILIES[popFamily(id, rotation)];
  if (id !== 10) return s;
  const r = Math.max(0, rotation);
  return { ...s, hold: 'choir', holdLow: 53, ...(r % 4 === 3 ? { tune: 1 } : {}) };
}

/** The Pop hub and world map, and Pop's results loop: a lounge arrangement of the Meadow theme. */
export const LOUNGE: MusicStyle = {
  ...POP_FAMILIES.ground,
  tune: 1,
  mix: { pad: -19, bass: -17, support: -26, drums: -24, lead: -18 },
};
