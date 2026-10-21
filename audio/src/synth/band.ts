// The band: instruments the music plays (audio section 4.4), synthesized per
// note like the landing-note instruments. Leads, pads and basses are baked long
// and the sequencer cuts them to length; drums are one instrument whose MIDI
// note picks the piece. Everything here bakes at half rate (nothing needs more
// than 12 kHz), which halves the memory two loaded biomes take.

import {
  alloc, biquad, burst, clamp, decay, fm, midiToHz, mixInto, noise, osc, partials, resonate,
  saturate, scale, shape, type Rng, TAU,
} from './dsp';

export type BandInstrument =
  | 'recorder' | 'harp' | 'pizz' | 'musicBox' | 'theremin' | 'brass' | 'uke'
  | 'padSoft' | 'choir' | 'padStrings' | 'padGlass' | 'padAnalog'
  | 'bassPluck' | 'bassSoft' | 'bassSub'
  | 'drums';

export const BAND: readonly BandInstrument[] = [
  'recorder', 'harp', 'pizz', 'musicBox', 'theremin', 'brass', 'uke',
  'padSoft', 'choir', 'padStrings', 'padGlass', 'padAnalog',
  'bassPluck', 'bassSoft', 'bassSub', 'drums',
];

/** Baked length in seconds: long enough for the longest note the sequencer asks for. */
const LENGTH: Record<BandInstrument, number> = {
  recorder: 1.7, harp: 1.8, pizz: 0.6, musicBox: 1.3, theremin: 1.7, brass: 1.7, uke: 1.0,
  padSoft: 5.2, choir: 5.2, padStrings: 5.2, padGlass: 5.2, padAnalog: 5.2,
  bassPluck: 1.3, bassSoft: 1.4, bassSub: 1.4, drums: 0.7,
};

/** Drum pieces by MIDI note (roughly General MIDI). */
export const DRUM = {
  feltKick: 35, kick: 36, boomKick: 34, snap: 37, snare: 38, clap: 39, brush: 40,
  floorTom: 41, hat: 42, softHat: 44, lowTom: 45, openHat: 46, hiTom: 48,
  tambourine: 54, zap: 55, bongoHi: 60, bongoLo: 61, rainstick: 69, shaker: 70,
  blockHi: 76, blockLo: 77, triangle: 81,
} as const;

export function renderBandNote(inst: BandInstrument, midi: number, sr: number, rng: Rng): Float32Array {
  if (inst === 'drums') return renderDrum(midi, sr, rng);
  const f = midiToHz(midi);
  const n = Math.round(sr * LENGTH[inst]);
  const sec = n / sr;
  switch (inst) {
    case 'recorder': {
      // breathy and nearly pure, with a chiff on the attack and vibrato that grows in
      const vib = (t: number) => f * (1 + 0.004 * Math.sin(TAU * 5.2 * t) * Math.min(1, t / 0.3));
      const y = osc(n, sr, vib, 'sine');
      mixInto(y, osc(n, sr, (t) => 2 * vib(t), 'sine'), sr, 0, 0.1);
      mixInto(y, osc(n, sr, (t) => 3 * vib(t), 'sine'), sr, 0, 0.16);
      mixInto(y, biquad(noise(n, rng), sr, 'bandpass', Math.min(f, sr * 0.4), 8), sr, 0, 0.06);
      mixInto(y, decay(biquad(noise(Math.round(sr * 0.06), rng), sr, 'bandpass', Math.min(f * 3, sr * 0.4), 3), sr, 0.015), sr, 0, 0.35);
      return shape(y, sr, held(0.03, sec));
    }
    case 'harp': {
      const y = pluckF(n, sr, f, rng, 0.9985, 0.35);
      mixInto(y, decay(osc(n, sr, f, 'sine'), sr, 0.6, 0.002), sr, 0, 0.4);
      return decay(y, sr, 0.9, 0.001);
    }
    case 'pizz': {
      const y = biquad(pluckF(n, sr, f, rng, 0.992, 0.25), sr, 'lowpass', Math.min(f * 6, sr * 0.4), 0.7);
      mixInto(y, decay(osc(n, sr, f, 'sine'), sr, 0.12, 0.002), sr, 0, 0.5);
      return decay(y, sr, 0.22, 0.001);
    }
    case 'musicBox': {
      // a tuned steel tine: bright inharmonic overtones that die fast, a soft click
      const y = partials(n, sr, [
        { f, a: 1, tau: 0.7 }, { f: f * 3.01, a: 0.12, tau: 0.25 }, { f: f * 5.43, a: 0.18, tau: 0.09 }, { f: f * 8.9, a: 0.06, tau: 0.04 },
      ], rng);
      mixInto(y, burst(sr, rng, 0.6, 8000), sr, 0, 0.15);
      return y;
    }
    case 'theremin': {
      // slides up into the note, then a wide slow vibrato
      const fr = (t: number) => f * (1 - 0.05 * Math.exp(-t / 0.05)) * (1 + 0.012 * Math.sin(TAU * 5.5 * t) * Math.min(1, t / 0.4));
      const y = osc(n, sr, fr, 'sine');
      mixInto(y, osc(n, sr, (t) => 2 * fr(t), 'sine'), sr, 0, 0.12);
      return shape(y, sr, held(0.08, sec));
    }
    case 'brass': {
      // a soft "bwah": the filter opens on the attack and settles
      const fr = (t: number) => f * (1 + 0.003 * Math.sin(TAU * 5 * t) * Math.min(1, t / 0.4));
      const y = osc(n, sr, fr, 'saw');
      mixInto(y, osc(n, sr, (t) => fr(t) * 0.5, 'tri'), sr, 0, 0.3);
      const bright = (t: number) => Math.min(sr * 0.4, 200 + f * (2.5 + 3.5 * Math.exp(-t / 0.12)) * Math.min(1, t / 0.05));
      return shape(biquad(y, sr, 'lowpass', bright, 0.9), sr, held(0.04, sec));
    }
    case 'uke': {
      const y = pluckF(n, sr, f, rng, 0.996, 0.55);
      mixInto(y, biquad(burst(sr, rng, 4, 3000, n), sr, 'bandpass', 380, 3), sr, 0, 0.25);
      return decay(y, sr, 0.35, 0.001);
    }
    case 'padSoft': {
      const y = alloc(sr, sec);
      for (const d of [0.996, 1, 1.0045]) mixInto(y, osc(n, sr, f * d, 'tri'), sr, 0, 0.5);
      mixInto(y, biquad(osc(n, sr, f * 1.002, 'saw'), sr, 'lowpass', Math.min(1400, sr * 0.4), 0.7), sr, 0, 0.25);
      shape(y, sr, (t) => 1 + 0.06 * Math.sin(TAU * 0.7 * t));
      return shape(y, sr, held(0.6, sec, 0.8));
    }
    case 'choir': {
      // "ooh": a buzzy source through two low formants, with vibrato and breath
      const fr = (t: number) => f * (1 + 0.006 * Math.sin(TAU * 5 * t + 1));
      const src = osc(n, sr, fr, 'saw');
      mixInto(src, osc(n, sr, (t) => fr(t) * 1.003, 'saw'), sr, 0, 0.7);
      const y = biquad(src, sr, 'bandpass', 330, 3);
      mixInto(y, biquad(src, sr, 'bandpass', 820, 5), sr, 0, 0.45);
      mixInto(y, biquad(noise(n, rng), sr, 'bandpass', 900, 2), sr, 0, 0.04);
      return shape(y, sr, held(0.5, sec, 0.8));
    }
    case 'padStrings': {
      const y = alloc(sr, sec);
      for (const d of [0.994, 0.998, 1.002, 1.006]) mixInto(y, osc(n, sr, (t) => f * d * (1 + 0.003 * Math.sin(TAU * 5.5 * t + d * 40)), 'saw'), sr, 0, 0.3);
      return shape(biquad(y, sr, 'lowpass', Math.min(2400, sr * 0.4), 0.7), sr, held(0.35, sec, 0.7));
    }
    case 'padGlass': {
      const y = fm(n, sr, f, 2, 0.9, 2.5);
      mixInto(y, osc(n, sr, f * 2.005, 'sine'), sr, 0, 0.25);
      mixInto(y, osc(n, sr, f * 0.5, 'sine'), sr, 0, 0.3);
      return shape(y, sr, held(0.4, sec, 0.9));
    }
    case 'padAnalog': {
      const y = osc(n, sr, f * 0.998, 'square');
      mixInto(y, osc(n, sr, f * 1.003, 'saw'), sr, 0, 0.8);
      const cut = (t: number) => Math.min(sr * 0.4, 500 + 1300 * Math.sin(Math.PI * clamp(t / sec, 0, 1)));
      return shape(biquad(scale(y, 0.5), sr, 'lowpass', cut, 1.4), sr, held(0.45, sec, 0.8));
    }
    case 'bassPluck': {
      const y = biquad(pluckF(n, sr, f, rng, 0.995, 0.3), sr, 'lowpass', Math.min(1500, sr * 0.4), 0.7);
      mixInto(y, decay(osc(n, sr, f, 'sine'), sr, 0.5, 0.003), sr, 0, 0.6);
      return decay(y, sr, 0.6, 0.002);
    }
    case 'bassSoft': {
      const y = osc(n, sr, f, 'sine');
      mixInto(y, osc(n, sr, f, 'tri'), sr, 0, 0.3);
      // the 2nd and 3rd harmonics are what a phone speaker actually plays
      mixInto(y, osc(n, sr, f * 2, 'sine'), sr, 0, 0.25);
      mixInto(y, osc(n, sr, f * 3, 'sine'), sr, 0, 0.08);
      return shape(y, sr, held(0.012, sec, 0.3));
    }
    case 'bassSub': {
      const y = saturate(osc(n, sr, f, 'sine'), 2.2);
      mixInto(y, decay(biquad(burst(sr, rng, 1, 3000, n), sr, 'bandpass', 900, 1), sr, 0.01), sr, 0, 0.3);
      return decay(y, sr, 0.7, 0.004);
    }
  }
}

/** Sample-rate factor the bank bakes band notes at. */
export const BAND_RATE = 0.5;

/** Attack, then full level, then a release over the last `rel` seconds. */
function held(attack: number, total: number, rel = 0.15): (t: number) => number {
  return (t) => Math.min(1, t / attack) * Math.min(1, Math.max(0, (total - t) / rel));
}

/** Karplus-Strong with a fractional delay, so high strings stay in tune at low sample rates. */
function pluckF(n: number, sr: number, f: number, rng: Rng, damp: number, bright: number): Float32Array {
  const period = sr / f;
  const len = Math.ceil(period) + 2;
  const buf = new Float32Array(len);
  for (let i = 0; i < len; i++) buf[i] = rng() * 2 - 1;
  const y = new Float32Array(n);
  const k = 0.5 + 0.5 * bright;
  let w = 0;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    // read `period` samples behind the write head, with linear interpolation
    const r = w - period;
    const ri = Math.floor(r);
    const fr = r - ri;
    const a = buf[((ri % len) + len) % len];
    const b = buf[(((ri + 1) % len) + len) % len];
    const out = a + (b - a) * fr;
    const v = damp * (k * out + (1 - k) * prev);
    prev = out;
    y[i] = out;
    buf[w % len] = v;
    w++;
  }
  return y;
}

function renderDrum(midi: number, sr: number, rng: Rng): Float32Array {
  const len = (s: number) => Math.round(sr * s);
  const tone = (s: number, f0: number, f1: number, tauF: number, tau: number) =>
    decay(osc(len(s), sr, (t) => f1 + (f0 - f1) * Math.exp(-t / tauF), 'sine'), sr, tau, 0.001);
  const hiss = (s: number, type: 'highpass' | 'bandpass' | 'lowpass', fc: number, q: number, tau: number, attack = 0.0005) =>
    decay(biquad(noise(len(s), rng), sr, type, Math.min(fc, sr * 0.45), q), sr, tau, attack);
  switch (midi) {
    case DRUM.feltKick: {
      const y = tone(0.35, 110, 52, 0.03, 0.16);
      mixInto(y, hiss(0.03, 'lowpass', 1500, 0.7, 0.006), sr, 0, 0.3);
      return saturate(y, 1.4);
    }
    case DRUM.kick: {
      const y = tone(0.4, 160, 50, 0.025, 0.22);
      mixInto(y, hiss(0.02, 'bandpass', 3000, 1, 0.004), sr, 0, 0.35);
      return saturate(y, 1.8);
    }
    case DRUM.boomKick: return saturate(tone(0.7, 75, 44, 0.05, 0.45), 2.4);
    case DRUM.snap: {
      const y = hiss(0.08, 'bandpass', 2200, 2, 0.012);
      mixInto(y, hiss(0.05, 'highpass', 4000, 0.7, 0.006), sr, 0, 0.5);
      return y;
    }
    case DRUM.snare: {
      const y = hiss(0.25, 'highpass', 1400, 0.7, 0.09);
      mixInto(y, tone(0.15, 220, 185, 0.01, 0.05), sr, 0, 0.6);
      return y;
    }
    case DRUM.clap: {
      const y = alloc(sr, 0.3);
      for (let i = 0; i < 3; i++) mixInto(y, hiss(0.03, 'bandpass', 1600, 1.2, 0.006), sr, i * 0.011, 0.8);
      mixInto(y, hiss(0.25, 'bandpass', 1500, 1, 0.07), sr, 0.03, 0.5);
      return y;
    }
    case DRUM.brush: return hiss(0.3, 'bandpass', 3200, 0.7, 0.1, 0.025);
    case DRUM.floorTom: return mixInto(tone(0.5, 100, 82, 0.05, 0.3), hiss(0.06, 'lowpass', 2000, 0.7, 0.02), sr, 0, 0.3);
    case DRUM.lowTom: return mixInto(tone(0.45, 135, 110, 0.04, 0.25), hiss(0.05, 'lowpass', 2500, 0.7, 0.02), sr, 0, 0.3);
    case DRUM.hiTom: return mixInto(tone(0.4, 200, 165, 0.04, 0.2), hiss(0.05, 'lowpass', 3000, 0.7, 0.02), sr, 0, 0.3);
    case DRUM.hat: return hiss(0.08, 'highpass', 7000, 0.7, 0.022);
    case DRUM.softHat: return hiss(0.1, 'highpass', 6000, 0.7, 0.03, 0.004);
    case DRUM.openHat: return hiss(0.5, 'highpass', 6500, 0.7, 0.2);
    case DRUM.tambourine: {
      const y = hiss(0.3, 'highpass', 5500, 0.7, 0.09);
      mixInto(y, partials(len(0.3), sr, [{ f: 5200, a: 1, tau: 0.06 }, { f: 7300, a: 0.7, tau: 0.05 }, { f: 9800, a: 0.4, tau: 0.04 }], rng), sr, 0, 0.3);
      return y;
    }
    case DRUM.zap: {
      const y = hiss(0.2, 'bandpass', 2600, 1.2, 0.07);
      mixInto(y, tone(0.15, 900, 260, 0.02, 0.05), sr, 0, 0.6);
      return y;
    }
    case DRUM.bongoHi: return mixInto(tone(0.2, 470, 410, 0.01, 0.08), hiss(0.02, 'bandpass', 3500, 1, 0.004), sr, 0, 0.4);
    case DRUM.bongoLo: return mixInto(tone(0.25, 330, 285, 0.012, 0.1), hiss(0.02, 'bandpass', 3000, 1, 0.004), sr, 0, 0.4);
    case DRUM.rainstick: {
      const y = biquad(crackleN(len(0.5), sr, rng, 900), sr, 'bandpass', 4500, 1);
      return shape(y, sr, (t) => Math.min(1, t / 0.08) * Math.exp(-t / 0.18));
    }
    case DRUM.shaker: return hiss(0.12, 'bandpass', 6500, 1.5, 0.04, 0.012);
    case DRUM.blockHi: return resonate(burst(sr, rng, 0.8, 9000, len(0.12)), sr, [{ f: 1850, a: 1, tau: 0.03 }, { f: 4900, a: 0.3, tau: 0.012 }]);
    case DRUM.blockLo: return resonate(burst(sr, rng, 0.8, 9000, len(0.14)), sr, [{ f: 1250, a: 1, tau: 0.035 }, { f: 3300, a: 0.3, tau: 0.014 }]);
    case DRUM.triangle: return partials(len(0.7), sr, [{ f: 4200, a: 1, tau: 0.5 }, { f: 6150, a: 0.5, tau: 0.3 }, { f: 8900, a: 0.25, tau: 0.2 }], rng);
    default: return hiss(0.05, 'highpass', 5000, 0.7, 0.015);
  }
}

/** Dense random grains (seeds in a rain stick). */
function crackleN(n: number, sr: number, rng: Rng, density: number): Float32Array {
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) if (rng() < density / sr) y[i] = rng() * 2 - 1;
  return y;
}
