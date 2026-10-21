// The composer: turns a biome's style into bars of notes (audio section 4).
// One tempo for the whole climb (100 BPM, 4/4). A theme is 32 bars in four
// 8-bar sections (A A' B A''), and each pass of a theme picks one of three
// variations, so the same 77 seconds never plays twice in a row. Melodies use
// the biome's pentatonic landing scale, so they never clash with landing notes.
// Everything is seeded: the same theme and bar always give the same notes.

import { hash } from '../bake/jobs';
import { DRUM } from '../synth/band';
import { mulberry32, type Rng } from '../synth/dsp';
import type { InstrumentId } from '../synth/instruments';
import type { NoteRequest } from '../bank';
import { PENTATONIC, type Key } from './theory';
import type { MusicStyle } from './styles';

export const BPM = 100;
export const BEAT = 60 / BPM;
export const BAR = 4 * BEAT;
export const SECTION_BARS = 8;
export const THEME_BARS = 32;
/** alternate versions of each section, cycled pass by pass */
export const VARIATIONS = 3;

export type Part = 'pad' | 'bass' | 'support' | 'drums' | 'lead' | 'tension' | 'riser';

export interface NoteEvent {
  part: Part;
  inst: InstrumentId;
  midis: number[];
  /** chord stagger in seconds, for strums */
  spread?: number;
  /** start, in beats after the bar's downbeat */
  beat: number;
  /** length in beats; the engine fades the note out after it */
  dur: number;
  /** linear level, before the part's mix level */
  vel: number;
}

const DIATONIC = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };
const STRUM = 0.012;

/** The key's tonic on the lowest MIDI note at or above `low`. */
export function tonicAt(key: Key, low: number): number {
  const pc = ((key.root % 12) + 12) % 12;
  return low + ((pc - (low % 12) + 12) % 12);
}

/** Semitones above the tonic for a diatonic degree (any integer). */
function dia(key: Key, d: number): number {
  const s = DIATONIC[key.mode];
  return s[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
}

/** Pitch classes of the triad on a diatonic degree. */
function triadPcs(key: Key, degree: number): number[] {
  return [0, 2, 4].map((k) => (((key.root + dia(key, degree + k)) % 12) + 12) % 12);
}

/** Close voicing: each pitch class on its lowest note at or above `low`, low to high. */
function voice(pcs: number[], low: number): number[] {
  return pcs.map((pc) => low + ((pc - (low % 12) + 12) % 12)).sort((a, b) => a - b);
}

/** MIDI note for a pentatonic step above the tonic at `base`. */
function pent(key: Key, base: number, p: number): number {
  const s = PENTATONIC[key.mode];
  return base + s[((p % 5) + 5) % 5] + 12 * Math.floor(p / 5);
}

const RHYTHMS: [number, number][][][] = [
  [
    [[0, 2], [2, 1], [3, 1], [4, 4]],
    [[0, 3], [3, 1], [4, 2], [6, 2]],
    [[0, 1], [1, 1], [2, 2], [4, 3], [7, 1]],
    [[0, 1.5], [1.5, 0.5], [2, 2], [4, 4]],
  ],
  [
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 2], [4, 1], [5, 1], [6, 2]],
    [[0, 1.5], [1.5, 0.5], [2, 1], [3, 1], [4, 3], [7, 1]],
    [[0.5, 0.5], [1, 1], [2, 1], [3, 1], [4, 2], [6, 1], [7, 1]],
    [[0, 1], [1, 1], [2, 1.5], [3.5, 0.5], [4, 2], [6, 2]],
  ],
  [
    [[0, 0.5], [0.5, 0.5], [1, 0.5], [1.5, 0.5], [2, 1], [3, 1], [4, 0.5], [4.5, 0.5], [5, 1], [6, 2]],
    [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1], [4, 1], [5, 0.5], [5.5, 0.5], [6, 1], [7, 1]],
    [[0, 1], [1, 0.5], [1.5, 0.5], [2, 0.5], [2.5, 0.5], [3, 1], [4, 1.5], [5.5, 0.5], [6, 2]],
  ],
];
const CADENCE: [number, number][] = [[0, 1], [1, 1], [2, 2], [4, 4]];
const LEAD_RANGE: [number, number] = [0, 8];

/** Drum steps (16 per bar) by groove density. */
const GROOVE = {
  kick: [
    [1, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 0, 0, 0.8, 0, 0.5, 0, 0, 0, 0, 0],
    [1, 0, 0, 0.4, 0, 0, 0, 0, 0.9, 0, 0.5, 0, 0, 0, 0.4, 0],
  ],
  kickHalf: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0],
  snare: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0.25, 0, 0, 0, 0, 1, 0, 0, 0.3],
  ],
  snareHalf: [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
  hat: [
    [0.5, 0, 0.35, 0, 0.5, 0, 0.35, 0, 0.5, 0, 0.35, 0, 0.5, 0, 0.35, 0],
    [0.65, 0, 0.45, 0, 0.65, 0, 0.45, 0, 0.65, 0, 0.45, 0, 0.65, 0, 0.45, 0],
    [0.65, 0.25, 0.45, 0.25, 0.65, 0.25, 0.45, 0.25, 0.65, 0.25, 0.45, 0.25, 0.65, 0.25, 0.45, 0.3],
  ],
  perc: [
    [],
    [[6, 0.5], [14, 0.5]],
    [[3, 0.4], [6, 0.6], [11, 0.4], [14, 0.6]],
  ] as [number, number][][],
};

/** A biome's theme in one key: bars of notes for every part, cached per section. */
export class Theme {
  private melodies = new Map<string, NoteEvent[]>();

  constructor(readonly style: MusicStyle, readonly key: Key, readonly tune: number) {}

  /** Every note of bar `bar` (counted from the theme's start) for the foundation, groove and lead. */
  bar(bar: number, density: 0 | 1 | 2): NoteEvent[] {
    const s = this.style;
    const pass = Math.floor(bar / THEME_BARS);
    const inTheme = ((bar % THEME_BARS) + THEME_BARS) % THEME_BARS;
    const section = Math.floor(inTheme / SECTION_BARS);
    const inSection = inTheme % SECTION_BARS;
    const prog = s.progressions[section === 2 ? 1 : 0];
    const chord = prog[Math.floor(inSection / 2) % prog.length];
    const next = inSection === SECTION_BARS - 1 ? s.progressions[section === 1 ? 1 : 0][0] : prog[Math.floor((inSection + 1) / 2) % prog.length];
    const rng = mulberry32(hash(`${this.tune}:${pass % VARIATIONS}:${inTheme}:${density}`));
    const out: NoteEvent[] = [];
    const pcs = triadPcs(this.key, chord);

    // pad: one chord per two bars, held across both
    if (inSection % 2 === 0) out.push({ part: 'pad', inst: s.pad, midis: voice(pcs, s.padLow), beat: 0, dur: 8, vel: 1 });

    this.bass(out, chord, next, rng);
    this.support(out, pcs, rng, density);
    this.drums(out, density, inSection === SECTION_BARS - 1, rng);
    for (const e of this.melody(pass % VARIATIONS, section, prog)) {
      const local = e.beat - inSection * 4;
      if (local >= 0 && local < 4) out.push({ ...e, beat: local });
    }
    return out;
  }

  /** L4: a low pulse on the chord root, with ticks when the tower is about to go. */
  tension(bar: number, level: number): NoteEvent[] {
    const s = this.style;
    const inTheme = ((bar % THEME_BARS) + THEME_BARS) % THEME_BARS;
    const section = Math.floor(inTheme / SECTION_BARS);
    const prog = s.progressions[section === 2 ? 1 : 0];
    const root = voice([triadPcs(this.key, prog[Math.floor((inTheme % SECTION_BARS) / 2) % prog.length])[0]], s.bassLow)[0];
    const out: NoteEvent[] = [];
    for (let i = 0; i < 8; i++) out.push({ part: 'tension', inst: 'bassSub', midis: [root], beat: i / 2, dur: 0.45, vel: i % 2 ? 0.55 : 0.85 });
    if (level > 0.75) for (let i = 0; i < 16; i++) out.push({ part: 'tension', inst: 'drums', midis: [DRUM.blockHi], beat: i / 4, dur: 0.25, vel: i % 4 ? 0.25 : 0.4 });
    return out;
  }

  /** L5: a rising run in this key on the next biome's lead, previewing it. */
  riser(step: number, next: MusicStyle): NoteEvent[] {
    const base = tonicAt(this.key, next.leadLow);
    const out: NoteEvent[] = [];
    for (let i = 0; i < 8; i++) {
      const p = Math.min(9, ((step * 4) % 6) + i);
      out.push({ part: 'riser', inst: next.lead, midis: [pent(this.key, base, p)], beat: i / 2, dur: 0.5, vel: 0.35 + 0.05 * i });
    }
    return out;
  }

  /** Every note and chord this theme (and its riser into `next`) can ask for, so the bank can bake them first. */
  notes(next?: MusicStyle): NoteRequest[] {
    const seen = new Map<string, NoteRequest>();
    const add = (e: NoteEvent) => {
      const k = `${e.inst}:${e.midis.join(',')}:${e.spread ?? 0}`;
      if (!seen.has(k)) seen.set(k, { inst: e.inst, midis: e.midis, spread: e.spread });
    };
    for (let pass = 0; pass < VARIATIONS; pass++) {
      for (let b = 0; b < THEME_BARS; b++) {
        for (const d of [0, 1, 2] as const) this.bar(pass * THEME_BARS + b, d).forEach(add);
        this.tension(b, 1).forEach(add);
      }
    }
    if (next) for (let i = 0; i < 4; i++) this.riser(i, next).forEach(add);
    return [...seen.values()];
  }

  private bass(out: NoteEvent[], chord: number, next: number, rng: Rng): void {
    const s = this.style;
    const pcs = triadPcs(this.key, chord);
    const root = voice([pcs[0]], s.bassLow)[0];
    const fifth = voice([pcs[2]], s.bassLow)[0];
    const third = voice([pcs[1]], s.bassLow)[0];
    const n = (midi: number, beat: number, dur: number, vel: number) => out.push({ part: 'bass', inst: s.bass, midis: [midi], beat, dur, vel });
    switch (s.bassPattern) {
      case 'bounce':
        n(root, 0, 1, 1);
        n(fifth, 2, 1, 0.8);
        if (rng() < 0.4) n(root, 3.5, 0.5, 0.6);
        break;
      case 'roots':
        n(root, 0, 2, 1);
        n(rng() < 0.3 ? fifth : root, 2, 2, 0.8);
        break;
      case 'walk': {
        // root, third, fifth, then a step into the next chord's root
        const approach = voice([(((this.key.root + dia(this.key, next - 1)) % 12) + 12) % 12], s.bassLow)[0];
        n(root, 0, 1, 1);
        n(third, 1, 1, 0.7);
        n(fifth, 2, 1, 0.8);
        n(approach, 3, 1, 0.7);
        break;
      }
      case 'pulse':
        for (let i = 0; i < 8; i++) n(root, i / 2, 0.45, i % 2 ? 0.55 : 0.85);
        break;
      case 'long':
        n(root, 0, 4, 1);
        break;
    }
  }

  private support(out: NoteEvent[], pcs: number[], rng: Rng, density: 0 | 1 | 2): void {
    const s = this.style;
    const tones = voice(pcs, s.supportLow);
    const swing = (beat: number) => (beat % 1 === 0.5 ? beat + s.swing : beat);
    const n = (midis: number[], beat: number, dur: number, vel: number, spread?: number) =>
      out.push({ part: 'support', inst: s.support, midis, beat: swing(beat), dur, vel: vel * (0.92 + 0.16 * rng()), spread });
    switch (s.supportPattern) {
      case 'arp': {
        const up = [...tones, tones[0] + 12];
        const order = [0, 1, 2, 3, 2, 1, 2, 1];
        order.forEach((k, i) => n([up[k]], i / 2, 0.5, i % 2 ? 0.5 : 0.7));
        break;
      }
      case 'strum':
        [[0, 0.8], [1.5, 0.5], [2, 0.65], [3, 0.5]].forEach(([b, v]) => n(tones, b, 1, v, STRUM));
        break;
      case 'offbeat':
        [0.5, 1.5, 2.5, 3.5].forEach((b) => n(tones, b, 0.4, 0.55));
        break;
      case 'sparkle': {
        const base = tonicAt(this.key, s.supportLow);
        const count = 3 + density + Math.floor(rng() * 2);
        for (let i = 0; i < count; i++) n([pent(this.key, base, Math.floor(rng() * 8))], Math.floor(rng() * 16) / 4, 0.5, 0.35 + 0.25 * rng());
        break;
      }
      case 'bells':
        n([tones[Math.floor(rng() * tones.length)] + 12], rng() < 0.5 ? 0 : 2, 4, 0.6);
        break;
    }
  }

  private drums(out: NoteEvent[], density: 0 | 1 | 2, fill: boolean, rng: Rng): void {
    const s = this.style;
    if (s.mix.drums <= -60) return;
    const k = s.kit;
    const hit = (midi: number, step: number, vel: number) => {
      if (vel <= 0) return;
      const sw = step % 4 === 2 ? s.swing : step % 2 === 1 ? s.swing / 2 : 0;
      out.push({ part: 'drums', inst: 'drums', midis: [midi], beat: step / 4 + sw + (rng() - 0.5) * 0.02, dur: 1, vel: vel * (0.9 + 0.2 * rng()) });
    };
    const kick = s.half ? GROOVE.kickHalf : GROOVE.kick[density];
    const snare = s.half ? GROOVE.snareHalf : GROOVE.snare[density];
    const hat = GROOVE.hat[density];
    const end = fill && density > 0 ? 12 : 16;
    for (let i = 0; i < end; i++) {
      hit(k.kick, i, kick[i]);
      hit(k.snare, i, snare[i]);
      hit(k.hat, i, hat[i] * (s.half && i % 4 ? 0.7 : 1));
    }
    if (k.perc.length) for (const [i, v] of GROOVE.perc[density]) if (i < end) hit(k.perc[(i >> 2) % k.perc.length], i, v);
    // a short fill into the next section
    if (end === 12) {
      const pieces = k.perc.length ? k.perc : [k.snare];
      for (let i = 12; i < 16; i++) hit(pieces[(i - 12) % pieces.length], i, 0.5 + 0.12 * (i - 12));
      hit(k.kick, 12, 0.8);
    }
  }

  /** The lead for one 8-bar section: two bars stated, answered, contrasted, then a cadence. */
  private melody(variation: number, section: number, prog: number[]): NoteEvent[] {
    const key = `${variation}:${section}`;
    const hit = this.melodies.get(key);
    if (hit) return hit;
    const s = this.style;
    const base = tonicAt(this.key, s.leadLow);
    // A, A' and A'' share their opening; B is new material
    const seedA = hash(`${this.tune}:A:${variation}`);
    const seed = section === 2 ? hash(`${this.tune}:B:${variation}`) : seedA;
    const pick = (r: Rng) => RHYTHMS[s.busy][Math.floor(r() * RHYTHMS[s.busy].length)];
    const r0 = mulberry32(seed);
    const rhythmA = pick(r0);
    const rhythmC = pick(mulberry32(seed ^ (section * 977 + 31)));
    const out: NoteEvent[] = [];
    let p = 4;
    const units: { rhythm: [number, number][]; seed: number; contour: 1 | -1; end?: 'tonic' | 'chord' }[] = [
      { rhythm: rhythmA, seed, contour: 1 },
      { rhythm: rhythmA, seed, contour: 1 },
      { rhythm: rhythmC, seed: seed ^ (0x9e37 + section), contour: -1 },
      { rhythm: CADENCE, seed: seed ^ (0x51ed + section * 13), contour: -1, end: section === 3 ? 'tonic' : 'chord' },
    ];
    units.forEach((u, ui) => {
      const pcs = triadPcs(this.key, prog[ui % prog.length]);
      const rng = mulberry32(u.seed);
      // the answer (second unit) starts where the statement did, so it echoes it over the new chord
      if (ui === 1) p = 4;
      u.rhythm.forEach(([b, d], i) => {
        if (i > 0) {
          const r = rng();
          const dir = rng() < 0.68 ? u.contour : -u.contour;
          p += r < 0.15 ? 0 : r < 0.78 ? dir : 2 * dir;
        } else rng();
        if (p < LEAD_RANGE[0]) p = LEAD_RANGE[0] + (LEAD_RANGE[0] - p);
        if (p > LEAD_RANGE[1]) p = LEAD_RANGE[1] - (p - LEAD_RANGE[1]);
        const last = i === u.rhythm.length - 1;
        if (last && u.end === 'tonic') p = p >= 3 ? 5 : 0;
        else if (b % 2 === 0 || (last && u.end)) p = this.nearestChordTone(p, pcs, base);
        out.push({ part: 'lead', inst: s.lead, midis: [pent(this.key, base, p)], beat: ui * 8 + b, dur: d, vel: (b % 1 === 0 ? 0.85 : 0.65) * (last ? 1 : 0.95) });
      });
    });
    this.melodies.set(key, out);
    return out;
  }

  private nearestChordTone(p: number, pcs: number[], base: number): number {
    for (const d of [0, -1, 1, -2, 2]) {
      const q = p + d;
      if (q < LEAD_RANGE[0] || q > LEAD_RANGE[1]) continue;
      if (pcs.includes(pent(this.key, base, q) % 12)) return q;
    }
    return p;
  }
}
