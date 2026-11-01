// Each biome's band (audio section 4.4): who plays lead, support, pad and bass,
// the drum kit and groove feel, and the chord progressions its themes use.
// Registers are absolute MIDI floors, so every key sits in a comfortable range.

import { DRUM } from '../synth/band';
import type { InstrumentId } from '../synth/instruments';

export type SupportPattern = 'arp' | 'strum' | 'offbeat' | 'sparkle' | 'bells';
export type BassPattern = 'bounce' | 'roots' | 'walk' | 'pulse' | 'long';
/** How the pad part plays: held chords (the tower), or Blockling Pop's keys: café stabs, a sway, a slow bloom. */
export type PadPattern = 'hold' | 'comp' | 'sway' | 'bloom';

/** Blockling Pop's extra voices for a style (styles-pop.ts). */
export interface PopVoices {
  family: 'ground' | 'sky' | 'space';
  /** the board's instrument: landing notes, the pop glissando and its answer */
  board: InstrumentId;
  boardLow: number;
  /** the Sparkle layer's arpeggios */
  sparkle: InstrumentId;
  sparkleLow: number;
}

export interface Kit {
  kick: number;
  snare: number;
  hat: number;
  /** extra colour: woodblocks, toms, bongos, triangle */
  perc: number[];
}

export interface MusicStyle {
  lead: InstrumentId;
  /** lowest MIDI note the lead's tonic may sit on */
  leadLow: number;
  support: InstrumentId;
  supportLow: number;
  supportPattern: SupportPattern;
  pad: InstrumentId;
  padLow: number;
  bass: InstrumentId;
  bassLow: number;
  bassPattern: BassPattern;
  kit: Kit;
  /** half-time drums: the backbeat lands on beat 3 (low gravity from Orbit on, and the Ringed Giant's heavy brass) */
  half: boolean;
  /** how late the off-beat 8ths land, in beats */
  swing: number;
  /** two progressions of four chords (diatonic degrees, 0 = tonic), two bars each: A and B sections */
  progressions: [number[], number[]];
  /** 0 = sparse and lyrical, 2 = busy */
  busy: 0 | 1 | 2;
  /** part levels in dB */
  mix: { pad: number; bass: number; support: number; drums: number; lead: number };
  /** whose tunes to play (a biome id); Deep Cosmos's home rotation plays the Meadow's */
  tune?: number;
  /** tempo (default 100, the tower's) */
  bpm?: number;
  /** default 'hold' */
  padPattern?: PadPattern;
  /** the pad plays seventh chords */
  sevenths?: boolean;
  /** a held pad under a patterned one (Pop's choir and analog pads) */
  hold?: InstrumentId;
  holdLow?: number;
  /** swing the lead and the pad's off-beats too, not just support and drums */
  swingAll?: boolean;
  /** every note bakes at half rate (Pop) */
  low?: boolean;
  pop?: PopVoices;
}

const kit = (kick: number, snare: number, hat: number, ...perc: number[]): Kit => ({ kick, snare, hat, perc });

const STYLES: Record<number, MusicStyle> = {
  // Meadow: whistled melody and marimba, ukulele, glockenspiel, shakers
  1: {
    lead: 'whistle', leadLow: 72, support: 'marimba', supportLow: 60, supportPattern: 'arp',
    pad: 'padSoft', padLow: 55, bass: 'bassPluck', bassLow: 36, bassPattern: 'bounce',
    kit: kit(DRUM.feltKick, DRUM.snap, DRUM.shaker, DRUM.triangle), half: false, swing: 0.04,
    progressions: [[0, 3, 4, 0], [5, 3, 0, 4]], busy: 1,
    mix: { pad: -22, bass: -15, support: -19, drums: -17, lead: -15 },
  },
  // Treetops: wooden recorder, ukulele, woodblocks, finger snaps
  2: {
    lead: 'recorder', leadLow: 67, support: 'uke', supportLow: 55, supportPattern: 'strum',
    pad: 'padSoft', padLow: 55, bass: 'bassPluck', bassLow: 36, bassPattern: 'walk',
    kit: kit(DRUM.feltKick, DRUM.snap, DRUM.shaker, DRUM.blockHi, DRUM.blockLo), half: false, swing: 0.06,
    progressions: [[0, 4, 5, 3], [3, 0, 3, 4]], busy: 1,
    mix: { pad: -23, bass: -15, support: -20, drums: -16, lead: -15 },
  },
  // Cloudlands: harp, soft "ooh" choir, kalimba, brushed drums
  3: {
    lead: 'harp', leadLow: 62, support: 'kalimba', supportLow: 62, supportPattern: 'sparkle',
    pad: 'choir', padLow: 55, bass: 'bassSoft', bassLow: 38, bassPattern: 'roots',
    kit: kit(DRUM.feltKick, DRUM.brush, DRUM.softHat, DRUM.triangle), half: false, swing: 0.03,
    progressions: [[0, 5, 3, 4], [3, 4, 2, 5]], busy: 0,
    mix: { pad: -20, bass: -16, support: -21, drums: -19, lead: -15 },
  },
  // Storm Belt: pizzicato cello and tremolo strings, deep toms, rain-stick shakers
  4: {
    lead: 'pizz', leadLow: 59, support: 'pizz', supportLow: 47, supportPattern: 'offbeat',
    pad: 'padStrings', padLow: 52, bass: 'bassSoft', bassLow: 35, bassPattern: 'pulse',
    kit: kit(DRUM.kick, DRUM.snare, DRUM.rainstick, DRUM.lowTom, DRUM.floorTom), half: false, swing: 0,
    progressions: [[0, 5, 2, 6], [3, 5, 6, 0]], busy: 2,
    mix: { pad: -22, bass: -15, support: -21, drums: -16, lead: -14 },
  },
  // Stratosphere: celesta, glassy synth arpeggios, light kick
  5: {
    lead: 'celesta', leadLow: 76, support: 'glassBell', supportLow: 64, supportPattern: 'sparkle',
    pad: 'padGlass', padLow: 52, bass: 'bassSub', bassLow: 40, bassPattern: 'roots',
    kit: kit(DRUM.kick, DRUM.clap, DRUM.hat, DRUM.tambourine), half: false, swing: 0,
    progressions: [[0, 6, 5, 6], [5, 2, 6, 0]], busy: 1,
    mix: { pad: -21, bass: -16, support: -23, drums: -18, lead: -15 },
  },
  // Orbit: music box, analog synth pads, sub bass
  6: {
    lead: 'musicBox', leadLow: 69, support: 'vibes', supportLow: 57, supportPattern: 'arp',
    pad: 'padAnalog', padLow: 57, bass: 'bassSub', bassLow: 33, bassPattern: 'pulse',
    kit: kit(DRUM.boomKick, DRUM.zap, DRUM.hat, DRUM.triangle), half: true, swing: 0,
    progressions: [[0, 3, 0, 4], [5, 3, 6, 6]], busy: 1,
    mix: { pad: -21, bass: -15, support: -23, drums: -19, lead: -15 },
  },
  // Moon: theremin lead, sparse bells, half-time drums
  7: {
    lead: 'theremin', leadLow: 62, support: 'glassBell', supportLow: 74, supportPattern: 'bells',
    pad: 'padAnalog', padLow: 50, bass: 'bassSub', bassLow: 38, bassPattern: 'long',
    kit: kit(DRUM.boomKick, DRUM.zap, DRUM.shaker, DRUM.triangle), half: true, swing: 0,
    progressions: [[0, 5, 0, 6], [3, 3, 0, 0]], busy: 0,
    mix: { pad: -20, bass: -15, support: -22, drums: -19, lead: -16 },
  },
  // Red Planet: twangy space-western guitar, plucked synth, hand drums
  8: {
    lead: 'twang', leadLow: 55, support: 'uke', supportLow: 55, supportPattern: 'strum',
    pad: 'padAnalog', padLow: 50, bass: 'bassPluck', bassLow: 31, bassPattern: 'bounce',
    kit: kit(DRUM.kick, DRUM.snap, DRUM.shaker, DRUM.bongoHi, DRUM.bongoLo), half: true, swing: 0.07,
    progressions: [[0, 6, 5, 4], [0, 3, 6, 0]], busy: 1,
    mix: { pad: -23, bass: -15, support: -20, drums: -16, lead: -14 },
  },
  // Ringed Giant: big slow brass, deep gongs
  9: {
    lead: 'brass', leadLow: 55, support: 'brass', supportLow: 48, supportPattern: 'offbeat',
    pad: 'padStrings', padLow: 48, bass: 'brass', bassLow: 36, bassPattern: 'long',
    kit: kit(DRUM.boomKick, DRUM.snare, DRUM.openHat, DRUM.floorTom, DRUM.lowTom), half: true, swing: 0,
    progressions: [[0, 5, 3, 4], [5, 6, 0, 0]], busy: 0,
    mix: { pad: -21, bass: -16, support: -23, drums: -16, lead: -14 },
  },
  // Deep Cosmos: earlier leads, re-keyed, over a nebula choir pad
  10: {
    lead: 'harp', leadLow: 65, support: 'celesta', supportLow: 65, supportPattern: 'sparkle',
    pad: 'choir', padLow: 53, bass: 'bassSub', bassLow: 34, bassPattern: 'roots',
    kit: kit(DRUM.boomKick, DRUM.zap, DRUM.hat, DRUM.triangle), half: false, swing: 0,
    progressions: [[0, 4, 5, 3], [3, 4, 0, 0]], busy: 1,
    mix: { pad: -20, bass: -15, support: -23, drums: -18, lead: -15 },
  },
};

/** Deep Cosmos rotates through the earlier biomes' leads, one per key rotation. */
const COSMOS_LEADS: { lead: InstrumentId; leadLow: number }[] = [
  { lead: 'harp', leadLow: 65 }, { lead: 'celesta', leadLow: 77 }, { lead: 'theremin', leadLow: 63 },
  { lead: 'musicBox', leadLow: 70 },
];

/** The band for a biome. In Deep Cosmos, `rotation` picks the lead; on the home rotation the Meadow tune returns. */
export function styleFor(biomeId: number, rotation = 0): MusicStyle {
  const id = Math.min(10, Math.max(1, Math.round(biomeId)));
  if (id !== 10) return STYLES[id];
  const r = Math.max(0, rotation);
  const s = { ...STYLES[10], ...COSMOS_LEADS[r % COSMOS_LEADS.length] };
  // every fourth rotation comes home to C major: the Meadow progressions, on cosmic instruments
  return r % 4 === 3 ? { ...s, progressions: STYLES[1].progressions, tune: 1 } : s;
}

/** Title and menus: a lullaby arrangement of the Meadow theme (audio section 4.5). */
export const LULLABY: MusicStyle = {
  ...STYLES[1], lead: 'musicBox', leadLow: 72, support: 'celesta', supportLow: 72, supportPattern: 'bells',
  bassPattern: 'long', busy: 0,
  mix: { pad: -22, bass: -19, support: -24, drums: -60, lead: -17 },
};
