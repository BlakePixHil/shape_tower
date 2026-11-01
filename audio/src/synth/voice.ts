// Blockling voices (audio section 6.8): tiny gibberish reactions, Animal
// Crossing style, so nothing needs translating. A buzzy pulse goes through three
// formant resonances that glide between vowels. The director pitches each
// shape's voice up or down, so a Gumdrop squeaks and a Plank grumbles.

import { alloc, biquad, clamp, mixInto, noise, normalize, shape, TAU, type Rng } from './dsp';

export type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'uh' | 'y';

/** Formants (Hz) of a small, bright voice: adult values raised by about a quarter. */
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [1000, 1550, 3300], e: [620, 2400, 3300], i: [380, 2950, 3800], o: [650, 1080, 3000],
  u: [430, 980, 2900], uh: [820, 1500, 3050], y: [360, 2800, 3700],
};
const FORMANT_GAIN = [1, 0.55, 0.22];
const FORMANT_Q = [5, 9, 12];

export interface Syllable {
  /** start (s) */
  at: number;
  dur: number;
  /** pitch contour (Hz), spread evenly across the syllable */
  f0: number[];
  /** vowel path, spread evenly across the syllable */
  vowels: Vowel[];
  /** breathy onset ("h", "wh") in seconds */
  breath?: number;
  level?: number;
}

/** A band-limited sawtooth (harmonics up to just under Nyquist), so voices baked at a low rate don't alias. */
function glottal(n: number, sr: number, f0: (t: number) => number): Float32Array {
  const y = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const f = f0(i / sr);
    const k = Math.max(1, Math.floor((0.45 * sr) / f));
    let v = 0;
    for (let h = 1; h <= k; h++) v += Math.sin(h * ph) / h;
    y[i] = v * 0.55;
    ph += (TAU * f) / sr;
    if (ph > TAU) ph -= TAU;
  }
  return y;
}

/** Piecewise-linear value along evenly spaced points, at fraction u (0 to 1). */
function along(points: number[], u: number): number {
  if (points.length === 1) return points[0];
  const x = clamp(u, 0, 1) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(x));
  return points[i] + (points[i + 1] - points[i]) * (x - i);
}

/** Renders one reaction from its syllables. `pitch` and `size` scale the whole voice (variation per take). */
export function renderVoice(sr: number, rng: Rng, syllables: Syllable[], pitch = 1, size = 1): Float32Array {
  const end = Math.max(...syllables.map((s) => s.at + s.dur));
  const y = alloc(sr, end + 0.05);
  for (const s of syllables) {
    const n = Math.round(s.dur * sr);
    const vib = 5.5 + rng() * 1.5;
    const jitter = rng() * TAU;
    const f0 = (t: number) => pitch * along(s.f0, t / s.dur) * (1 + 0.025 * Math.sin(TAU * vib * t + jitter) * Math.min(1, t / 0.12));
    // a pulse rich in harmonics, softened, with a touch of breath in it
    const src = biquad(glottal(n, sr, f0), sr, 'lowpass', 5200, 0.6);
    const air = noise(n, rng);
    for (let i = 0; i < n; i++) src[i] = 0.9 * src[i] + 0.05 * air[i];
    const out = new Float32Array(n);
    for (let k = 0; k < 3; k++) {
      const fk = (t: number) => (size * along(s.vowels.map((v) => FORMANTS[v][k]), t / s.dur));
      mixInto(out, biquad(src, sr, 'bandpass', fk, FORMANT_Q[k]), sr, 0, FORMANT_GAIN[k] * (k === 0 ? 1 : 1.6));
    }
    const att = 0.018, rel = Math.min(0.07, s.dur * 0.35);
    shape(out, sr, (t) => Math.min(1, t / att) * Math.min(1, Math.max(0, (s.dur - t) / rel)));
    if (s.breath) {
      const b = Math.round(s.breath * sr * 1.6);
      const h = biquad(noise(b, rng), sr, 'bandpass', size * FORMANTS[s.vowels[0]][1], 1.6);
      shape(h, sr, (t) => Math.sin(Math.PI * clamp(t / (s.breath! * 1.6), 0, 1)));
      mixInto(out, h, sr, 0, 0.35);
    }
    mixInto(y, out, sr, s.at, s.level ?? 1);
  }
  return normalize(y, 0.85);
}

/** The reactions (audio section 6.8). Each take varies the pitch, the voice size and the timing a little. */
export const REACTIONS: Record<string, (rng: Rng) => Syllable[]> = {
  // a fast drop: "wheee!" rising
  whee: (rng) => {
    const top = 760 + 140 * rng();
    return [{ at: 0, dur: 0.5 + 0.12 * rng(), f0: [400, 520, top, top * 1.04], vowels: ['u', 'i', 'i', 'i'], breath: 0.05 }];
  },
  // tumbling off the tower: "wheee..." falling away
  fall: (rng) => {
    const top = 820 + 120 * rng();
    return [{ at: 0, dur: 0.85 + 0.2 * rng(), f0: [top * 0.9, top, top * 0.62, top * 0.38], vowels: ['u', 'i', 'i', 'e'], breath: 0.05 }];
  },
  // a hard landing: "oof"
  oof: (rng) => [{ at: 0, dur: 0.2 + 0.05 * rng(), f0: [340 + 40 * rng(), 300, 220], vowels: ['o', 'u', 'u'], breath: 0.04 }],
  // danger: "uh-oh"
  uhoh: (rng) => {
    const p = 400 + 50 * rng();
    return [
      { at: 0, dur: 0.15, f0: [p, p * 1.05], vowels: ['uh', 'uh'] },
      { at: 0.2 + 0.03 * rng(), dur: 0.27, f0: [p * 0.86, p * 0.82, p * 0.66], vowels: ['o', 'o', 'u'], breath: 0.03 },
    ];
  },
  // a checkpoint: "yay!"
  yay: (rng) => {
    const p = 470 + 60 * rng();
    return [{ at: 0, dur: 0.38 + 0.08 * rng(), f0: [p, p * 1.3, p * 1.42, p * 1.3], vowels: ['y', 'a', 'a', 'e'] }];
  },
  // game over: a sad "aww"
  aww: (rng) => {
    const p = 430 + 40 * rng();
    return [{ at: 0, dur: 0.55 + 0.1 * rng(), f0: [p, p * 1.05, p * 0.8, p * 0.64], vowels: ['a', 'a', 'o', 'o'] }];
  },
};

/** Which voice each shape has: semitones up or down, so small shapes squeak and long ones grumble. */
export const SHAPE_VOICE: Record<string, number> = {
  Domino: 5, Z: 3, J: 2, I: 1, T: 0, L: -1, S: -2, O: -3, Plank: -5,
  // the later tower shapes, and Blockling Pop's three small ones (Pip squeaks highest)
  P: -2, U: -3, V: -1, Arch: -4, Plus: -4, Pip: 7, Elbow: 6, Trio: 4,
};

/** Blockling Pop's shapes by number (game/src/pop/sim/shapes.ts POP_KEYS), so an event can name one either way. */
export const POP_SHAPE_KEYS = ['Pip', 'Domino', 'Trio', 'Elbow', 'O', 'I', 'L', 'J', 'T', 'S', 'Z', 'Plank', 'P', 'U', 'V', 'Arch', 'Plus'] as const;
