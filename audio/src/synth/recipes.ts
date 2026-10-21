// Procedural placeholder sound recipes (audio section 6). Each recipe renders
// one variation as a mono Float32Array; the SoundBank bakes them into
// AudioBuffers at startup. Real recorded files can later replace any name
// without code changes, because the director only ever asks the bank by name.

import {
  ahr, alloc, biquad, brown, burst, clamp, crackle, decay, fadeEdges, loopify, mixInto, noise,
  normalize, osc, partials, rand, resonate, saturate, scale, shape, trimTail, type Rng, TAU,
} from './dsp';
import { renderNote } from './instruments';
import type { BedParams } from '../biomes';
import { MATERIALS, type Material } from '../types';

export type Recipe = (sr: number, rng: Rng, variant: number) => Float32Array;

export interface SoundDef {
  variants: number;
  render: Recipe;
  /** baked as a seamless loop */
  loop?: boolean;
  /** peak level the bank normalizes to (default 0.9) */
  peak?: number;
  /**
   * Fraction of the context's sample rate to bake at. Dark sounds with nothing
   * above a few kHz (rumbles, wind, swells) use 0.5 to halve their memory;
   * Web Audio resamples them on playback.
   */
  rate?: number;
}

const finish = (y: Float32Array, sr: number, pk = 0.9) => trimTail(fadeEdges(normalize(y, pk), sr, 0.3, 6), sr);

// ---------------------------------------------------------------- impacts

interface MatSpec {
  modes: [number, number, number][];
  exMs: number;
  exColor: number;
  thump: number;
  grit?: number;
  ringScale?: number;
}

const MODAL: Partial<Record<Material, MatSpec>> = {
  wood: { modes: [[420, 1, 0.07], [1130, 0.55, 0.045], [2350, 0.3, 0.025], [3600, 0.15, 0.015]], exMs: 2.5, exColor: 3500, thump: 95 },
  stone: { modes: [[230, 1, 0.045], [690, 0.6, 0.035], [1580, 0.35, 0.02], [3100, 0.2, 0.012]], exMs: 5, exColor: 2600, thump: 70, grit: 0.35 },
  ice: { modes: [[1750, 1, 0.2], [3900, 0.6, 0.14], [6150, 0.35, 0.09], [8200, 0.2, 0.06]], exMs: 1.2, exColor: 9000, thump: 150, ringScale: 1.2 },
  metal: { modes: [[540, 1, 0.26], [1420, 0.7, 0.2], [2730, 0.5, 0.13], [4080, 0.3, 0.09], [5650, 0.2, 0.06]], exMs: 1.5, exColor: 7000, thump: 90, ringScale: 1.1 },
  glass: { modes: [[2350, 1, 0.26], [5150, 0.5, 0.16], [7900, 0.3, 0.1]], exMs: 1, exColor: 10000, thump: 170, ringScale: 1.2 },
  base: { modes: [[160, 1, 0.11], [430, 0.6, 0.07], [910, 0.3, 0.04]], exMs: 4, exColor: 2500, thump: 75 },
};

const TIER_LEN = [0, 0.26, 0.36, 0.5, 0.8];

function modalImpact(spec: MatSpec, tier: number): Recipe {
  return (sr, rng) => {
    const det = rand(rng, 0.94, 1.06);
    const n = Math.round(sr * TIER_LEN[tier] * (spec.ringScale ?? 1));
    const ex = burst(sr, rng, spec.exMs * (0.7 + 0.3 * tier), spec.exColor * (0.45 + 0.18 * tier), n);
    const y = resonate(ex, sr, spec.modes.map(([f, a, tau]) => ({ f: f * det * rand(rng, 0.98, 1.02), a, tau: tau * (0.75 + 0.12 * tier) })));
    normalize(y, 0.8);
    // a bright click keeps every hit readable on a phone speaker (audio section 8.5)
    const click = biquad(burst(sr, rng, 0.6, 14000, n), sr, 'bandpass', 2600 * det, 1.1);
    mixInto(y, normalize(click, 1), sr, 0, 0.12 + 0.05 * tier);
    if (tier >= 3) {
      const th = osc(n, sr, (t) => spec.thump * det * (1 + 1.2 * Math.exp(-t / 0.012)), 'sine');
      saturate(decay(th, sr, 0.04 + 0.02 * tier, 0.0015), 1.6);
      mixInto(y, th, sr, 0, tier === 4 ? 0.85 : 0.6);
    }
    if (spec.grit) {
      const g = decay(biquad(noise(n, rng), sr, 'bandpass', 3200, 0.8), sr, 0.03 + 0.015 * tier);
      mixInto(y, g, sr, 0, spec.grit * (0.5 + 0.15 * tier));
    }
    if (tier === 4) {
      const deb = biquad(crackle(n, sr, rng, 90, (t) => Math.exp(-t / 0.18)), sr, 'bandpass', 3000, 0.7);
      mixInto(y, deb, sr, 0.03, 0.35);
    }
    return finish(y, sr);
  };
}

function rubberImpact(tier: number): Recipe {
  // pieces never truly bounce (restitution 0), so the boing rides the landing squash
  return (sr, rng) => {
    const det = rand(rng, 0.94, 1.06);
    const f0 = [0, 270, 225, 190, 160][tier] * det;
    const n = Math.round(sr * (0.32 + 0.1 * tier));
    const pitch = (t: number) => f0 * (1 + 0.7 * Math.exp(-t / 0.022)) * (1 + 0.07 * Math.sin(TAU * 15 * t) * Math.exp(-t / 0.12));
    const y = osc(n, sr, pitch, 'sine');
    mixInto(y, osc(n, sr, (t) => pitch(t) * 2, 'tri'), sr, 0, 0.18);
    decay(y, sr, 0.09 + 0.035 * tier, 0.002);
    const thud = decay(biquad(noise(n, rng), sr, 'lowpass', 900, 0.8), sr, 0.025);
    mixInto(y, thud, sr, 0, 0.5);
    mixInto(y, biquad(burst(sr, rng, 0.6, 12000, n), sr, 'bandpass', 2200, 1.2), sr, 0, 0.15);
    return finish(y, sr);
  };
}

function jellyImpact(tier: number): Recipe {
  return (sr, rng) => {
    const det = rand(rng, 0.92, 1.08);
    const n = Math.round(sr * (0.35 + 0.12 * tier));
    const sq = biquad(noise(n, rng), sr, 'bandpass', (t) => 350 + 1100 * det * Math.exp(-t / 0.05), 3);
    decay(sq, sr, 0.06 + 0.025 * tier, 0.003);
    const y = normalize(sq, 0.7);
    const wob = osc(n, sr, (t) => 130 * det * (1 + 0.05 * Math.sin(TAU * 8 * t) * Math.exp(-t / 0.2)), 'sine');
    mixInto(y, decay(wob, sr, 0.16 + 0.05 * tier, 0.008), sr, 0, 0.5);
    const blup = decay(osc(n, sr, (t) => 520 * det * Math.exp(-t / 0.05), 'sine'), sr, 0.04);
    mixInto(y, blup, sr, 0, 0.35);
    return finish(y, sr);
  };
}

function groundImpact(tier: number): Recipe {
  return (sr, rng) => {
    const n = Math.round(sr * (0.3 + 0.1 * tier));
    const y = decay(biquad(brown(n, rng), sr, 'lowpass', 380, 0.7), sr, 0.05 + 0.025 * tier, 0.002);
    const th = saturate(decay(osc(n, sr, (t) => 58 * (1 + Math.exp(-t / 0.01)), 'sine'), sr, 0.07, 0.002), 1.8);
    mixInto(y, th, sr, 0, 0.8);
    const knock = decay(biquad(burst(sr, rng, 3, 4000, n), sr, 'bandpass', 650, 1.4), sr, 0.03);
    mixInto(y, normalize(knock, 1), sr, 0, 0.35);
    if (tier >= 2) mixInto(y, decay(biquad(noise(n, rng), sr, 'highpass', 3200, 0.7), sr, 0.05), sr, 0.005, 0.12 * tier);
    return finish(y, sr);
  };
}

export function impactRecipe(mat: Material, tier: number): Recipe {
  if (mat === 'rubber') return rubberImpact(tier);
  if (mat === 'jelly') return jellyImpact(tier);
  if (mat === 'ground') return groundImpact(tier);
  return modalImpact(MODAL[mat] ?? MODAL.wood!, tier);
}

// ---------------------------------------------------------------- helpers

const sweep = (sr: number, rng: Rng, sec: number, f0: number, f1: number, q: number, env: (t: number) => number) => {
  const n = Math.round(sr * sec);
  const y = biquad(noise(n, rng), sr, 'bandpass', (t) => f0 * Math.pow(f1 / f0, t / sec), q);
  return shape(y, sr, env);
};

const blipTone = (sr: number, sec: number, f0: number, f1: number, tau: number, wave: 'sine' | 'tri' = 'sine') => {
  const n = Math.round(sr * sec);
  return decay(osc(n, sr, (t) => f0 * Math.pow(f1 / f0, Math.min(1, t / sec)), wave), sr, tau, 0.002);
};

const tick = (sr: number, rng: Rng, f: number, tau = 0.01, sec = 0.05) =>
  resonate(burst(sr, rng, 0.4, 12000, Math.round(sr * sec)), sr, [{ f, a: 1, tau }, { f: f * 1.7, a: 0.4, tau: tau * 0.6 }]);

const sparkles = (sr: number, rng: Rng, sec: number, count: number, lo: number, hi: number) => {
  const y = alloc(sr, sec);
  for (let i = 0; i < count; i++) {
    const p = partials(Math.round(sr * 0.25), sr, [{ f: rand(rng, lo, hi), a: 1, tau: 0.05 }, { f: rand(rng, lo, hi) * 1.5, a: 0.3, tau: 0.03 }], rng);
    mixInto(y, p, sr, rand(rng, 0, sec * 0.65), rand(rng, 0.4, 1));
  }
  return y;
};

const thunk = (sr: number, rng: Rng, f: number, sec = 0.25, color = 2500) =>
  resonate(burst(sr, rng, 3, color, Math.round(sr * sec)), sr, [{ f, a: 1, tau: 0.06 }, { f: f * 2.3, a: 0.4, tau: 0.03 }]);

// ---------------------------------------------------------------- the library

export const SOUNDS: Record<string, SoundDef> = {
  // input and lifecycle (6.1)
  spawn: {
    variants: 4,
    render: (sr, rng) => {
      const y = sweep(sr, rng, 0.2, 700, 3200, 2, ahr(0.06, 0.04, 0.2));
      mixInto(y, sparkles(sr, rng, 0.22, 3, 2500, 4500), sr, 0.08, 0.25);
      return finish(y, sr, 0.6);
    },
  },
  preview: { variants: 1, render: (sr) => finish(blipTone(sr, 0.09, 320, 640, 0.04), sr, 0.5) },
  move: { variants: 6, render: (sr, rng) => finish(tick(sr, rng, rand(rng, 2200, 2600), 0.006, 0.03), sr, 0.35) },
  'rotate.cw': {
    variants: 6,
    render: (sr, rng) => {
      const y = alloc(sr, 0.09);
      mixInto(y, tick(sr, rng, rand(rng, 2900, 3200), 0.008), sr, 0, 1);
      mixInto(y, tick(sr, rng, rand(rng, 2300, 2500), 0.01), sr, 0.028, 0.8);
      return finish(y, sr, 0.55);
    },
  },
  'rotate.ccw': {
    variants: 6,
    render: (sr, rng) => {
      const y = alloc(sr, 0.09);
      mixInto(y, tick(sr, rng, rand(rng, 2300, 2500), 0.01), sr, 0, 1);
      mixInto(y, tick(sr, rng, rand(rng, 1800, 2000), 0.012), sr, 0.028, 0.8);
      return finish(y, sr, 0.55);
    },
  },
  'rotate.blocked': {
    variants: 4,
    render: (sr, rng) => {
      const y = thunk(sr, rng, rand(rng, 170, 200), 0.22, 1800);
      mixInto(y, blipTone(sr, 0.12, 260, 190, 0.05), sr, 0, 0.3);
      return finish(y, sr, 0.6);
    },
  },
  drop: {
    variants: 4,
    render: (sr, rng) => {
      const y = sweep(sr, rng, 0.26, 600, 2400, 2.5, ahr(0.04, 0.08, 0.26));
      mixInto(y, decay(osc(Math.round(sr * 0.26), sr, (t) => 520 + 1400 * t, 'sine'), sr, 0.12), sr, 0, 0.12);
      return finish(y, sr, 0.5);
    },
  },
  harddrop: {
    variants: 4,
    render: (sr, rng) => finish(sweep(sr, rng, 0.38, 400, 3600, 2, (t) => Math.min(1, t / 0.3) * (t < 0.33 ? 1 : Math.max(0, 1 - (t - 0.33) / 0.05))), sr, 0.65),
  },
  swap: {
    variants: 3,
    render: (sr, rng) => {
      const y = sweep(sr, rng, 0.18, 2400, 700, 2, ahr(0.03, 0.05, 0.18));
      mixInto(y, blipTone(sr, 0.07, 500, 900, 0.03), sr, 0.15, 0.6);
      return finish(y, sr, 0.5);
    },
  },
  lockon: {
    variants: 3,
    render: (sr, rng) => {
      const n = Math.round(sr * 0.3);
      const y = partials(n, sr, [{ f: 2093 * rand(rng, 0.995, 1.005), a: 1, tau: 0.06 }, { f: 3136, a: 0.6, tau: 0.05 }, { f: 4186, a: 0.25, tau: 0.03 }], rng);
      return finish(y, sr, 0.35);
    },
  },
  settle: { variants: 4, render: (sr, rng) => finish(tick(sr, rng, rand(rng, 1700, 1950), 0.018, 0.08), sr, 0.4) },

  'scrape.rough': {
    variants: 1, loop: true,
    render: (sr, rng) => {
      const n = Math.round(sr * 2.2);
      const y = biquad(noise(n, rng), sr, 'bandpass', 1300, 0.9);
      mixInto(y, biquad(crackle(n, sr, rng, 220), sr, 'bandpass', 1800, 0.8), sr, 0, 0.6);
      shape(y, sr, (t) => 0.8 + 0.2 * Math.sin(TAU * 3.1 * t));
      return loopify(normalize(y, 0.6), sr, 0.2);
    },
  },
  'scrape.smooth': {
    variants: 1, loop: true,
    render: (sr, rng) => loopify(normalize(biquad(noise(Math.round(sr * 2.2), rng), sr, 'highpass', 2600, 0.7), 0.4), sr, 0.2),
  },
  'scrape.squeak': {
    variants: 1, loop: true,
    render: (sr, rng) => {
      const n = Math.round(sr * 2.0);
      const y = osc(n, sr, (t) => 900 + 160 * Math.sin(TAU * 2.3 * t) + 60 * Math.sin(TAU * 7 * t), 'tri');
      mixInto(y, biquad(noise(n, rng), sr, 'bandpass', 1500, 2), sr, 0, 0.4);
      return loopify(normalize(y, 0.3), sr, 0.2);
    },
  },

  // stability and danger (6.3)
  creak: {
    variants: 5,
    render: (sr, rng) => {
      const sec = rand(rng, 0.45, 0.8);
      const n = Math.round(sr * sec);
      const ex = new Float32Array(n);
      // stick-slip: an irregular pulse train whose rate drifts
      let ph = 0;
      const r0 = rand(rng, 28, 40), r1 = rand(rng, 45, 70);
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += (r0 + (r1 - r0) * (t / sec)) * (1 + 0.25 * (rng() - 0.5)) / sr;
        if (ph >= 1) { ph -= 1; ex[i] = rand(rng, 0.5, 1); }
      }
      const y = resonate(ex, sr, [{ f: rand(rng, 280, 340), a: 1, tau: 0.02 }, { f: rand(rng, 680, 760), a: 0.6, tau: 0.012 }, { f: 1500, a: 0.3, tau: 0.008 }]);
      shape(y, sr, (t) => Math.sin(Math.PI * clamp(t / sec, 0, 1)));
      return finish(y, sr, 0.6);
    },
  },
  groan: {
    rate: 0.5,
    variants: 4,
    render: (sr, rng) => {
      const sec = rand(rng, 0.9, 1.4);
      const n = Math.round(sr * sec);
      const ex = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        ph += (16 + 14 * Math.sin((Math.PI * i) / n)) * (1 + 0.3 * (rng() - 0.5)) / sr;
        if (ph >= 1) { ph -= 1; ex[i] = rand(rng, 0.6, 1); }
      }
      const y = resonate(ex, sr, [{ f: rand(rng, 130, 160), a: 1, tau: 0.03 }, { f: rand(rng, 320, 360), a: 0.7, tau: 0.02 }, { f: 820, a: 0.4, tau: 0.01 }]);
      shape(y, sr, (t) => Math.pow(Math.sin(Math.PI * clamp(t / sec, 0, 1)), 0.7));
      return finish(saturate(y, 1.4), sr, 0.7);
    },
  },
  heartbeat: {
    variants: 2,
    render: (sr, rng) => {
      const y = alloc(sr, 0.45);
      const beat = (f: number, a: number) => {
        const n = Math.round(sr * 0.16);
        const b = osc(n, sr, (t) => f * (1 + 0.6 * Math.exp(-t / 0.015)), 'sine');
        decay(b, sr, 0.05, 0.004);
        // upper "knock" so the beat is audible on phone speakers, which have no sub
        const k = decay(biquad(burst(sr, rng, 4, 2000, n), sr, 'bandpass', 220, 1.5), sr, 0.03);
        mixInto(b, normalize(k, 1), sr, 0, 0.45);
        return scale(saturate(b, 2), a);
      };
      mixInto(y, beat(58, 1), sr, 0, 1);
      mixInto(y, beat(50, 0.7), sr, 0.17, 1);
      return finish(y, sr, 0.85);
    },
  },
  teeter: { variants: 4, render: (sr, rng) => finish(thunk(sr, rng, rand(rng, 850, 950), 0.12, 5000), sr, 0.4) },

  // losing (6.3)
  fallwhistle: {
    rate: 0.5,
    variants: 3,
    render: (sr, rng) => {
      const sec = 1.1;
      const n = Math.round(sr * sec);
      const f0 = rand(rng, 1700, 1950);
      const y = osc(n, sr, (t) => (f0 - 1250 * (t / sec)) * (1 + 0.012 * Math.sin(TAU * 6 * t)), 'sine');
      mixInto(y, biquad(noise(n, rng), sr, 'bandpass', (t) => f0 - 1250 * (t / sec), 6), sr, 0, 0.15);
      shape(y, sr, (t) => Math.min(1, t / 0.05) * (1 - 0.6 * (t / sec)));
      return finish(y, sr, 0.5);
    },
  },
  plonk: {
    variants: 3,
    render: (sr, rng) => {
      const y = impactRecipe('wood', 2)(sr, rng, 0);
      const d = biquad(y, sr, 'lowpass', 900, 0.7);
      mixInto(d, decay(osc(d.length, sr, 70, 'sine'), sr, 0.06, 0.002), sr, 0, 0.4);
      return finish(d, sr, 0.5);
    },
  },
  boop: {
    variants: 2,
    render: (sr, rng) => {
      const f0 = rand(rng, 410, 470);
      return finish(shape(osc(Math.round(sr * 0.4), sr, (t) => f0 * Math.pow(0.75, t / 0.4), 'sine'), sr, ahr(0.01, 0.15, 0.4)), sr, 0.45);
    },
  },
  heartpop: {
    variants: 3,
    render: (sr, rng) => {
      const y = blipTone(sr, 0.12, 600, 1300, 0.035);
      mixInto(y, decay(biquad(burst(sr, rng, 2, 9000, Math.round(sr * 0.08)), sr, 'highpass', 1500, 0.7), sr, 0.02), sr, 0, 0.5);
      return finish(y, sr, 0.7);
    },
  },
  heartup: {
    variants: 2,
    render: (sr, rng) => {
      const y = blipTone(sr, 0.35, 300, 760, 0.2);
      mixInto(y, sparkles(sr, rng, 0.4, 4, 2500, 5000), sr, 0.1, 0.3);
      return finish(y, sr, 0.6);
    },
  },
  'collapse.crack': {
    variants: 3,
    render: (sr, rng) => {
      const n = Math.round(sr * 0.6);
      const y = normalize(decay(biquad(noise(n, rng), sr, 'highpass', 1200, 0.7), sr, 0.02, 0.0005), 1);
      mixInto(y, biquad(crackle(n, sr, rng, 260, (t) => Math.exp(-t / 0.15)), sr, 'bandpass', 2800, 0.7), sr, 0.01, 0.7);
      mixInto(y, thunk(sr, rng, 140, 0.4, 2000), sr, 0, 0.5);
      return finish(y, sr, 0.9);
    },
  },
  'collapse.rumble': {
    rate: 0.5,
    variants: 2,
    render: (sr, rng) => {
      const sec = 1.8;
      const n = Math.round(sr * sec);
      const y = biquad(brown(n, rng), sr, 'lowpass', 260, 0.7);
      const mid = biquad(noise(n, rng), sr, 'bandpass', 300, 0.8);
      mixInto(y, mid, sr, 0, 0.25);
      shape(y, sr, (t) => Math.min(1, t / 0.05) * Math.exp(-t / 0.7) * (0.75 + 0.25 * Math.sin(TAU * 7 * t)));
      return finish(saturate(normalize(y, 1), 1.5), sr, 0.85);
    },
  },

  // building mechanics (6.9)
  'bond.tink': { variants: 3, render: (sr, rng) => finish(partials(Math.round(sr * 0.08), sr, [{ f: rand(rng, 4000, 4600), a: 1, tau: 0.015 }], rng), sr, 0.2) },
  'bond.snap': {
    variants: 4,
    render: (sr, rng) => {
      const n = Math.round(sr * 0.25);
      const y = normalize(decay(biquad(noise(n, rng), sr, 'highpass', 2000, 0.7), sr, 0.008, 0.0003), 1);
      for (let i = 0; i < 5; i++) mixInto(y, tick(sr, rng, rand(rng, 3000, 6000), 0.006), sr, rand(rng, 0.02, 0.14), rand(rng, 0.2, 0.5));
      return finish(y, sr, 0.75);
    },
  },
  'row.clack': {
    variants: 2,
    render: (sr, rng) => {
      const n = Math.round(sr * 0.6);
      const y = resonate(burst(sr, rng, 5, 2400, n), sr, [{ f: 140, a: 1, tau: 0.14 }, { f: 330, a: 0.7, tau: 0.08 }, { f: 720, a: 0.4, tau: 0.05 }]);
      mixInto(y, decay(biquad(noise(n, rng), sr, 'bandpass', 3000, 0.8), sr, 0.05), sr, 0, 0.3);
      return finish(saturate(normalize(y, 1), 1.3), sr, 0.85);
    },
  },
  tick: { variants: 3, render: (sr, rng) => finish(tick(sr, rng, 2600, 0.012, 0.06), sr, 0.45) },
  'hold.tick': { variants: 2, render: (sr, rng) => finish(tick(sr, rng, 3100, 0.008, 0.05), sr, 0.4) },
  'hold.womp': {
    variants: 2,
    render: (sr, rng) => {
      const n = Math.round(sr * 0.5);
      const f0 = rand(rng, 245, 275);
      const y = biquad(osc(n, sr, (t) => f0 * Math.pow(0.45, t / 0.5), 'saw'), sr, 'lowpass', (t) => 1400 * Math.pow(0.15, t / 0.5) + 150, 2);
      return finish(shape(y, sr, ahr(0.01, 0.2, 0.5)), sr, 0.55);
    },
  },
  flag: {
    variants: 2,
    render: (sr, rng) => {
      const y = thunk(sr, rng, 240, 0.3, 2200);
      mixInto(y, decay(biquad(noise(Math.round(sr * 0.2), rng), sr, 'bandpass', 1600, 1), sr, 0.03), sr, 0.02, 0.4);
      return finish(y, sr, 0.75);
    },
  },
  stonewave: {
    variants: 2,
    render: (sr, rng) => {
      const sec = 0.9;
      const n = Math.round(sr * sec);
      const g = crackle(n, sr, rng, 900, (t) => Math.sin(Math.PI * clamp(t / sec, 0, 1)));
      const y = biquad(g, sr, 'lowpass', (t) => 6000 * Math.pow(0.12, t / sec) + 500, 0.7);
      mixInto(y, shape(biquad(brown(n, rng), sr, 'lowpass', 500, 0.7), sr, (t) => Math.sin(Math.PI * clamp(t / sec, 0, 1))), sr, 0, 0.4);
      return finish(y, sr, 0.6);
    },
  },
  foundation: {
    variants: 2,
    render: (sr, rng) => {
      const y = alloc(sr, 0.5);
      mixInto(y, resonate(burst(sr, rng, 3, 3000, Math.round(sr * 0.3)), sr, [{ f: 180, a: 1, tau: 0.1 }, { f: 450, a: 0.6, tau: 0.06 }]), sr, 0, 1);
      mixInto(y, resonate(burst(sr, rng, 1.5, 8000, Math.round(sr * 0.3)), sr, [{ f: 900, a: 1, tau: 0.12 }, { f: 2300, a: 0.6, tau: 0.08 }, { f: 3700, a: 0.3, tau: 0.05 }]), sr, 0.15, 0.6);
      return finish(y, sr, 0.8);
    },
  },
  kaching: {
    variants: 2,
    render: (sr, rng) => {
      const y = alloc(sr, 0.35);
      mixInto(y, partials(Math.round(sr * 0.25), sr, [{ f: 2637, a: 1, tau: 0.05 }, { f: 5274, a: 0.3, tau: 0.03 }], rng), sr, 0, 1);
      mixInto(y, partials(Math.round(sr * 0.3), sr, [{ f: 3520, a: 1, tau: 0.08 }, { f: 7040, a: 0.25, tau: 0.04 }], rng), sr, 0.055, 0.9);
      return finish(y, sr, 0.45);
    },
  },

  // progress and rewards (6.4)
  confetti: {
    variants: 4,
    render: (sr, rng) => {
      const y = decay(biquad(noise(Math.round(sr * 0.2), rng), sr, 'bandpass', rand(rng, 1800, 2600), 1.2), sr, 0.02, 0.0005);
      mixInto(y, blipTone(sr, 0.1, 900, 300, 0.03), sr, 0, 0.4);
      mixInto(y, sparkles(sr, rng, 0.3, 3, 4000, 7000), sr, 0.03, 0.25);
      return finish(y, sr, 0.55);
    },
  },
  shimmer: { variants: 4, render: (sr, rng) => finish(sparkles(sr, rng, 0.45, 7, 3000, 7000), sr, 0.4) },
  swell: {
    rate: 0.5,
    variants: 2,
    render: (sr, rng) => {
      const sec = 1.6;
      const n = Math.round(sr * sec);
      const y = biquad(noise(n, rng), sr, 'lowpass', (t) => 300 + 5000 * Math.sin(Math.PI * clamp(t / sec, 0, 1)), 0.9);
      return finish(shape(y, sr, (t) => Math.pow(Math.sin(Math.PI * clamp(t / sec, 0, 1)), 1.5)), sr, 0.5);
    },
  },
  firework: {
    variants: 3,
    render: (sr, rng) => {
      const y = alloc(sr, 1.4);
      const w = osc(Math.round(sr * 0.5), sr, (t) => 600 + 3600 * t, 'sine');
      mixInto(y, shape(w, sr, (t) => Math.min(1, t / 0.05) * (1 - t / 0.5)), sr, 0, 0.25);
      const boom = decay(biquad(noise(Math.round(sr * 0.3), rng), sr, 'lowpass', 2500, 0.7), sr, 0.05, 0.001);
      mixInto(y, boom, sr, 0.5, 0.9);
      mixInto(y, biquad(crackle(Math.round(sr * 0.8), sr, rng, 160, (t) => Math.exp(-t / 0.35)), sr, 'highpass', 2500, 0.7), sr, 0.55, 0.6);
      return finish(y, sr, 0.75);
    },
  },
  gear: {
    variants: 2,
    render: (sr, rng) => {
      const y = alloc(sr, 0.25);
      mixInto(y, tick(sr, rng, 1500, 0.015), sr, 0, 1);
      mixInto(y, tick(sr, rng, 1100, 0.02), sr, 0.07, 0.9);
      mixInto(y, decay(biquad(noise(Math.round(sr * 0.15), rng), sr, 'bandpass', 800, 3), sr, 0.04), sr, 0.05, 0.2);
      return finish(y, sr, 0.45);
    },
  },
  blip: { variants: 1, render: (sr) => finish(blipTone(sr, 0.08, 1320, 1320, 0.03), sr, 0.3) },
  phew: {
    variants: 2,
    render: (sr, rng) => {
      const sec = 0.7;
      const y = sweep(sr, rng, sec, 1600, 500, 3, ahr(0.06, 0.15, sec));
      mixInto(y, decay(osc(Math.round(sr * 0.6), sr, 1568, 'sine'), sr, 0.15, 0.003), sr, 0.35, 0.25);
      return finish(y, sr, 0.5);
    },
  },
  drumroll: {
    variants: 1, loop: true,
    render: (sr, rng) => {
      const y = alloc(sr, 1.0);
      for (let i = 0; i < 24; i++) {
        const hit = decay(biquad(noise(Math.round(sr * 0.05), rng), sr, 'bandpass', rand(rng, 1800, 2300), 0.9), sr, 0.012, 0.0005);
        mixInto(y, hit, sr, i / 24 + rand(rng, -0.002, 0.002), rand(rng, 0.7, 1));
      }
      return normalize(y, 0.5);
    },
  },

  // UI (6.6)
  'ui.tap': { variants: 3, render: (sr, rng) => finish(resonate(burst(sr, rng, 0.8, 9000, Math.round(sr * 0.08)), sr, [{ f: rand(rng, 1450, 1550), a: 1, tau: 0.014 }, { f: 3300, a: 0.4, tau: 0.008 }, { f: 420, a: 0.5, tau: 0.02 }]), sr, 0.45) },
  'ui.tap2': { variants: 3, render: (sr, rng) => finish(resonate(burst(sr, rng, 1, 7000, Math.round(sr * 0.08)), sr, [{ f: rand(rng, 1050, 1150), a: 1, tau: 0.014 }, { f: 330, a: 0.5, tau: 0.02 }]), sr, 0.4) },
  'ui.back': {
    variants: 2,
    render: (sr, rng) => {
      const y = alloc(sr, 0.12);
      mixInto(y, tick(sr, rng, 1500, 0.01), sr, 0, 1);
      mixInto(y, tick(sr, rng, 1100, 0.012), sr, 0.045, 0.8);
      return finish(y, sr, 0.4);
    },
  },
  'ui.on': { variants: 1, render: (sr, rng) => { const y = tick(sr, rng, 1500, 0.01, 0.15); mixInto(y, blipTone(sr, 0.08, 700, 1050, 0.03), sr, 0.02, 0.5); return finish(y, sr, 0.4); } },
  'ui.off': { variants: 1, render: (sr, rng) => { const y = tick(sr, rng, 1300, 0.01, 0.15); mixInto(y, blipTone(sr, 0.08, 1050, 700, 0.03), sr, 0.02, 0.5); return finish(y, sr, 0.4); } },
  'ui.slider': { variants: 2, render: (sr, rng) => finish(tick(sr, rng, 2800, 0.004, 0.03), sr, 0.25) },
  'ui.open': { variants: 1, render: (sr, rng) => finish(sweep(sr, rng, 0.16, 600, 2400, 2, ahr(0.03, 0.04, 0.16)), sr, 0.35) },
  'ui.close': { variants: 1, render: (sr, rng) => finish(sweep(sr, rng, 0.16, 2400, 600, 2, ahr(0.03, 0.04, 0.16)), sr, 0.35) },
  'ui.error': {
    variants: 2,
    render: (sr, rng) => {
      const y = thunk(sr, rng, 210, 0.25, 1600);
      mixInto(y, blipTone(sr, 0.18, 300, 200, 0.06), sr, 0, 0.5);
      return finish(y, sr, 0.5);
    },
  },
  'ui.pause': { variants: 1, render: (sr) => { const y = alloc(sr, 0.2); mixInto(y, blipTone(sr, 0.07, 880, 880, 0.03), sr, 0, 1); mixInto(y, blipTone(sr, 0.08, 660, 660, 0.03), sr, 0.08, 1); return finish(y, sr, 0.35); } },
  'ui.resume': { variants: 1, render: (sr) => { const y = alloc(sr, 0.2); mixInto(y, blipTone(sr, 0.07, 660, 660, 0.03), sr, 0, 1); mixInto(y, blipTone(sr, 0.08, 880, 880, 0.03), sr, 0.08, 1); return finish(y, sr, 0.35); } },
  'xp.tick': { variants: 1, render: (sr) => finish(blipTone(sr, 0.05, 1400, 1500, 0.015, 'tri'), sr, 0.3) },
  stamp: {
    variants: 1,
    render: (sr, rng) => {
      const y = thunk(sr, rng, 200, 0.3, 2000);
      mixInto(y, sparkles(sr, rng, 0.4, 4, 3000, 6000), sr, 0.05, 0.3);
      return finish(y, sr, 0.6);
    },
  },

  // power-ups and Second Wind (6.11)
  'bubble.spawn': {
    rate: 0.5,
    variants: 2,
    render: (sr, rng) => {
      const sec = 0.4;
      const f0 = rand(rng, 320, 380);
      // a soft bloop: a quick upward glide that wobbles as it settles
      const y = osc(Math.round(sr * sec), sr, (t) => f0 * (1 + 1.1 * (1 - Math.exp(-t / 0.03))) * (1 + 0.03 * Math.sin(TAU * 9 * t)), 'sine');
      shape(y, sr, ahr(0.008, 0.05, sec));
      mixInto(y, sparkles(sr, rng, 0.3, 2, 2800, 4200), sr, 0.06, 0.15);
      return finish(y, sr, 0.45);
    },
  },
  'bubble.pop': {
    variants: 2,
    render: (sr, rng) => {
      const n = Math.round(sr * 0.14);
      const f0 = rand(rng, 900, 1150);
      const y = decay(osc(n, sr, (t) => f0 * Math.exp(-t / 0.02) + 260, 'sine'), sr, 0.03, 0.0008);
      mixInto(y, decay(biquad(burst(sr, rng, 1.2, 12000, n), sr, 'highpass', 2500, 0.7), sr, 0.006), sr, 0, 0.6);
      return finish(y, sr, 0.7);
    },
  },
  sweep: {
    rate: 0.5,
    variants: 1,
    render: (sr, rng) => {
      // a broom stroke: brushy noise rising through the band, with bristle ticks
      const sec = 0.6;
      const n = Math.round(sr * sec);
      const env = (t: number) => Math.pow(Math.sin(Math.PI * clamp(t / sec, 0, 1)), 1.2) * (1 - 0.4 * (t / sec));
      const y = sweep(sr, rng, sec, 500, 2600, 1.4, env);
      mixInto(y, shape(biquad(crackle(n, sr, rng, 320), sr, 'highpass', 3000, 0.7), sr, env), sr, 0, 0.5);
      return finish(y, sr, 0.6);
    },
  },
  quickset: {
    rate: 0.5,
    variants: 1,
    render: (sr, rng) => {
      // stone setting from the top down: crackles and knocks that fall in pitch, then a low set
      const sec = 1.2;
      const n = Math.round(sr * sec);
      const y = biquad(crackle(n, sr, rng, 240, (t) => (t < 0.9 ? 1 : 0)), sr, 'bandpass', (t) => 3500 * Math.pow(0.3, t / 0.9), 0.8);
      scale(y, 0.5);
      for (let i = 0; i < 8; i++) {
        const f = 900 * Math.pow(0.86, i) * rand(rng, 0.97, 1.03);
        const k = resonate(burst(sr, rng, 2, 3000, Math.round(sr * 0.15)), sr, [{ f, a: 1, tau: 0.03 }, { f: f * 2.7, a: 0.4, tau: 0.015 }]);
        mixInto(y, normalize(k, 1), sr, i * 0.1 + rand(rng, -0.01, 0.01), 0.55 + 0.04 * i);
      }
      mixInto(y, normalize(thunk(sr, rng, 120, 0.4, 1600), 1), sr, 0.82, 0.9);
      return finish(saturate(y, 1.2), sr, 0.8);
    },
  },
  undo: {
    rate: 0.5,
    variants: 1,
    render: (sr, rng) => {
      // a reverse fwip: swells up and stops dead, like a sound played backwards
      const sec = 0.3;
      const n = Math.round(sr * sec);
      const rise = (t: number) => Math.exp((t - sec) / 0.07);
      const y = sweep(sr, rng, sec, 600, 3000, 1.8, rise);
      mixInto(y, shape(osc(n, sr, (t) => 480 + 520 * (t / sec), 'tri'), sr, rise), sr, 0, 0.35);
      mixInto(y, tick(sr, rng, 2400, 0.006, 0.04), sr, sec - 0.01, 0.25);
      return finish(y, sr, 0.55);
    },
  },
  'glue.on': {
    rate: 0.5,
    variants: 1,
    render: (sr, rng) => {
      const sec = 0.45;
      const n = Math.round(sr * sec);
      // a gloopy blorp: a wobbling tone through a resonant filter that opens and closes
      const y = osc(n, sr, (t) => 190 + 140 * Math.sin(Math.PI * clamp(t / 0.3, 0, 1)) + 12 * Math.sin(TAU * 11 * t), 'tri');
      biquad(y, sr, 'lowpass', (t) => 400 + 1400 * Math.sin(Math.PI * clamp(t / sec, 0, 1)), 5);
      mixInto(y, biquad(crackle(n, sr, rng, 60, (t) => Math.exp(-t / 0.15)), sr, 'bandpass', 1500, 3), sr, 0.02, 0.4);
      return finish(shape(y, sr, ahr(0.02, 0.12, sec)), sr, 0.6);
    },
  },
  'glue.squelch': {
    rate: 0.5,
    variants: 2,
    render: (sr, rng) => {
      const sec = 0.18;
      const y = sweep(sr, rng, sec, rand(rng, 280, 340), 1400, 7, ahr(0.01, 0.03, sec));
      mixInto(y, decay(osc(Math.round(sr * sec), sr, (t) => 220 + 900 * t, 'tri'), sr, 0.05, 0.004), sr, 0, 0.3);
      return finish(y, sr, 0.45);
    },
  },
  'slow.in': {
    rate: 0.5,
    variants: 1,
    render: (sr, rng) => {
      // time stretching down: tone and air both sink, the wobble slowing as they go
      const sec = 0.9;
      const n = Math.round(sr * sec);
      let ph = 0;
      const y = osc(n, sr, (t) => {
        ph += (7 - 5 * (t / sec)) / sr;
        return 880 * Math.pow(0.375, t / sec) * (1 + 0.02 * Math.sin(TAU * ph));
      }, 'tri');
      mixInto(y, sweep(sr, rng, sec, 2400, 400, 2, () => 1), sr, 0, 0.3);
      return finish(shape(y, sr, ahr(0.03, 0.3, sec)), sr, 0.5);
    },
  },
  'slow.out': {
    rate: 0.5,
    variants: 1,
    render: (sr, rng) => {
      const sec = 0.6;
      const n = Math.round(sr * sec);
      const y = osc(n, sr, (t) => 330 * Math.pow(2.67, t / sec), 'tri');
      mixInto(y, sweep(sr, rng, sec, 400, 2400, 2, () => 1), sr, 0, 0.3);
      return finish(shape(y, sr, ahr(0.05, 0.25, sec)), sr, 0.45);
    },
  },
  windgust: {
    rate: 0.5,
    variants: 1,
    render: (sr, rng) => {
      // Second Wind: a big gust that rises, blows through and clears away
      const sec = 1.8;
      const n = Math.round(sr * sec);
      const env = (t: number) => (t < 0.7 ? Math.pow(t / 0.7, 1.5) : Math.exp(-(t - 0.7) / 0.4));
      const y = biquad(noise(n, rng), sr, 'bandpass', (t) => (t < 0.7 ? 220 + 1580 * (t / 0.7) : 1800 - 1100 * clamp((t - 0.7) / 1.1, 0, 1)), 0.9);
      mixInto(y, biquad(brown(n, rng), sr, 'lowpass', 500, 0.7), sr, 0, 0.5);
      mixInto(y, biquad(noise(n, rng), sr, 'bandpass', (t) => 900 + 1500 * Math.sin(Math.PI * clamp(t / sec, 0, 1)), 6), sr, 0, 0.25);
      return finish(saturate(shape(normalize(y, 1), sr, env), 1.3), sr, 0.8);
    },
  },

  // hazards (6.10)
  'gust.warn': {
    rate: 0.5,
    variants: 2,
    render: (sr, rng) => finish(sweep(sr, rng, 2.1, 250, 1300, 1.2, (t) => Math.pow(clamp(t / 2.0, 0, 1), 1.6) * (t > 2.0 ? Math.max(0, 1 - (t - 2.0) / 0.1) : 1)), sr, 0.45),
  },
  'gust.push': {
    rate: 0.5,
    variants: 3,
    render: (sr, rng) => finish(sweep(sr, rng, 1.4, 1100, 350, 0.9, ahr(0.08, 0.3, 1.4)), sr, 0.55),
  },
  'wind.loop': {
    rate: 0.5,
    variants: 1, loop: true,
    render: (sr, rng) => {
      const n = Math.round(sr * 6);
      const y = biquad(noise(n, rng), sr, 'bandpass', (t) => 600 + 300 * Math.sin(TAU * 0.33 * t) + 150 * Math.sin(TAU * 0.71 * t), 0.8);
      shape(y, sr, (t) => 0.7 + 0.3 * Math.sin(TAU * 0.5 * t));
      return loopify(normalize(y, 0.5), sr, 0.6);
    },
  },
  radar: {
    variants: 1,
    render: (sr) => {
      const y = alloc(sr, 0.5);
      mixInto(y, decay(osc(Math.round(sr * 0.2), sr, 1250, 'sine'), sr, 0.05, 0.003), sr, 0, 1);
      mixInto(y, decay(osc(Math.round(sr * 0.2), sr, 1250, 'sine'), sr, 0.05, 0.003), sr, 0.14, 0.3);
      return finish(y, sr, 0.35);
    },
  },
  'meteor.whistle': {
    variants: 3,
    render: (sr, rng) => {
      const sec = 0.8;
      const n = Math.round(sr * sec);
      const f0 = rand(rng, 2200, 2700);
      const y = osc(n, sr, (t) => f0 - 1500 * (t / sec), 'sine');
      mixInto(y, biquad(noise(n, rng), sr, 'bandpass', 1800, 1.5), sr, 0, 0.3);
      return finish(shape(y, sr, (t) => Math.min(1, t / 0.6)), sr, 0.4);
    },
  },
  'meteor.pop': {
    variants: 4,
    render: (sr, rng) => {
      const y = normalize(decay(biquad(noise(Math.round(sr * 0.25), rng), sr, 'bandpass', 1400, 0.8), sr, 0.03, 0.0005), 1);
      mixInto(y, biquad(crackle(Math.round(sr * 0.25), sr, rng, 200, (t) => Math.exp(-t / 0.06)), sr, 'highpass', 2000, 0.7), sr, 0, 0.5);
      return finish(y, sr, 0.6);
    },
  },
  'dust.swirl': {
    rate: 0.5,
    variants: 2,
    render: (sr, rng) => {
      const sec = 2.2;
      const n = Math.round(sr * sec);
      const y = biquad(noise(n, rng), sr, 'bandpass', (t) => 900 + 600 * Math.sin(TAU * 2.2 * t), 2);
      return finish(shape(y, sr, ahr(0.8, 0.8, sec)), sr, 0.45);
    },
  },
  'tidal.loop': {
    rate: 0.5,
    variants: 1, loop: true,
    render: (sr) => {
      const n = Math.round(sr * 8);
      const y = osc(n, sr, 55, 'sine');
      mixInto(y, osc(n, sr, 110.4, 'sine'), sr, 0, 0.5);
      mixInto(y, osc(n, sr, 164.5, 'tri'), sr, 0, 0.25);
      shape(y, sr, (t) => 0.75 + 0.25 * Math.sin(TAU * 0.25 * t));
      return loopify(normalize(y, 0.5), sr, 1);
    },
  },

  // ambience sweeteners (6.7)
  'amb.bird': {
    variants: 6,
    render: (sr, rng) => {
      const y = alloc(sr, 0.9);
      const chirps = 2 + Math.floor(rng() * 4);
      const base = rand(rng, 2600, 4200);
      let t0 = 0;
      for (let i = 0; i < chirps; i++) {
        const sec = rand(rng, 0.05, 0.12);
        const up = rng() < 0.5;
        const c = osc(Math.round(sr * sec), sr, (t) => base * (up ? 1 + 0.5 * (t / sec) : 1.4 - 0.5 * (t / sec)) * (1 + 0.04 * Math.sin(TAU * 60 * t)), 'sine');
        shape(c, sr, (t) => Math.sin(Math.PI * clamp(t / sec, 0, 1)));
        mixInto(y, c, sr, t0, rand(rng, 0.6, 1));
        t0 += sec + rand(rng, 0.03, 0.12);
      }
      return finish(y, sr, 0.5);
    },
  },
  'amb.leaves': { variants: 3, render: (sr, rng) => finish(shape(biquad(noise(Math.round(sr * 1.2), rng), sr, 'highpass', 2500, 0.7), sr, (t) => Math.pow(Math.sin(Math.PI * clamp(t / 1.2, 0, 1)), 2) * (0.6 + 0.4 * rng())), sr, 0.4) },
  'amb.thunder': {
    rate: 0.5,
    variants: 3,
    render: (sr, rng) => {
      const sec = 3;
      const y = biquad(brown(Math.round(sr * sec), rng), sr, 'lowpass', 380, 0.7);
      shape(y, sr, (t) => Math.min(1, t / 0.08) * Math.exp(-t / 0.9) * (0.7 + 0.3 * Math.sin(TAU * 3 * t + rng())));
      return finish(saturate(y, 1.4), sr, 0.8);
    },
  },
  'amb.jet': { rate: 0.5, variants: 2, render: (sr, rng) => finish(sweep(sr, rng, 3, 400, 1600, 0.6, (t) => Math.pow(Math.sin(Math.PI * clamp(t / 3, 0, 1)), 2)), sr, 0.45) },
  'amb.satellite': {
    variants: 2,
    render: (sr, _rng, v) => {
      const y = alloc(sr, 0.6);
      // two call signs: three high beeps, or two lower ones
      const beeps = v === 0 ? 3 : 2;
      for (let i = 0; i < beeps; i++) mixInto(y, decay(osc(Math.round(sr * 0.1), sr, v === 0 ? 1760 : 1568, 'square'), sr, 0.03, 0.002), sr, i * (v === 0 ? 0.15 : 0.22), 0.5);
      return finish(biquad(y, sr, 'lowpass', 3500, 0.7), sr, 0.25);
    },
  },
  'amb.crackle': { variants: 2, render: (sr, rng) => finish(biquad(crackle(Math.round(sr * 1.0), sr, rng, 40), sr, 'bandpass', 2000, 0.6), sr, 0.25) },
  'amb.rover': {
    variants: 2,
    render: (sr, _rng, v) => {
      const y = alloc(sr, 0.5);
      // a little two-note "boo-bee" that either falls or rises
      const [a, b] = v === 0 ? [980, 740] : [740, 980];
      mixInto(y, decay(osc(Math.round(sr * 0.12), sr, a, 'tri'), sr, 0.05, 0.003), sr, 0, 1);
      mixInto(y, decay(osc(Math.round(sr * 0.14), sr, b, 'tri'), sr, 0.06, 0.003), sr, 0.14, 1);
      return finish(y, sr, 0.3);
    },
  },
  'amb.chime': { variants: 3, render: (sr, rng) => finish(sparkles(sr, rng, 1.2, 5, 3500, 6500), sr, 0.25) },
  'amb.pulsar': { variants: 1, render: (sr, rng) => finish(tick(sr, rng, 5200, 0.003, 0.03), sr, 0.2) },

  // biome entry moments (audio section 4.4)
  'entry.1': {
    variants: 1,
    render: (sr, rng) => {
      const y = alloc(sr, 2.2);
      for (let i = 0; i < 7; i++) mixInto(y, SOUNDS['amb.bird'].render(sr, rng, i), sr, rand(rng, 0, 1.4), rand(rng, 0.5, 1));
      return finish(y, sr, 0.5);
    },
  },
  'entry.2': {
    variants: 1,
    render: (sr, rng) => {
      const y = alloc(sr, 1.6);
      mixInto(y, shape(biquad(noise(Math.round(sr * 0.7), rng), sr, 'highpass', 2200, 0.7), sr, ahr(0.05, 0.1, 0.7)), sr, 0, 0.5);
      // cuckoo: a falling major third, D6 to B5 in G major
      mixInto(y, renderNote('whistle', 86, sr, rng), sr, 0.55, 0.8);
      mixInto(y, renderNote('whistle', 83, sr, rng), sr, 0.95, 0.8);
      return finish(y, sr, 0.6);
    },
  },
  'entry.3': {
    variants: 1,
    render: (sr, rng) => finish(biquad(sweep(sr, rng, 0.9, 1800, 200, 0.7, ahr(0.15, 0.1, 0.9)), sr, 'lowpass', 1500, 0.7), sr, 0.6),
  },
  'entry.4': {
    variants: 1,
    render: (sr, rng) => {
      const y = normalize(decay(biquad(noise(Math.round(sr * 0.3), rng), sr, 'highpass', 800, 0.7), sr, 0.04, 0.0005), 1);
      mixInto(y, SOUNDS['amb.thunder'].render(sr, rng, 0), sr, 0.02, 0.9);
      return finish(y, sr, 0.85);
    },
  },
  'entry.5': {
    variants: 1,
    render: (sr, rng) => {
      const y = alloc(sr, 1.2);
      mixInto(y, tick(sr, rng, 900, 0.01, 0.08), sr, 0, 0.8);
      mixInto(y, biquad(sweep(sr, rng, 1.1, 2500, 300, 0.8, (t) => Math.exp(-t / 0.35)), sr, 'lowpass', 2000, 0.7), sr, 0.02, 0.6);
      return finish(y, sr, 0.5);
    },
  },
  'entry.6': {
    variants: 1,
    render: (sr, rng) => {
      const y = alloc(sr, 1.5);
      mixInto(y, shape(biquad(noise(Math.round(sr * 0.6), rng), sr, 'bandpass', 2500, 0.5), sr, (t) => (t < 0.55 ? 1 : 0)), sr, 0, 0.5);
      mixInto(y, decay(osc(Math.round(sr * 0.3), sr, 1760, 'sine'), sr, 0.12, 0.003), sr, 1.0, 0.7);
      return finish(y, sr, 0.5);
    },
  },
  'entry.7': {
    variants: 1,
    render: (sr, rng) => {
      const sec = 2.4;
      const y = shape(osc(Math.round(sr * sec), sr, 55, 'sine'), sr, (t) => Math.sin(Math.PI * clamp(t / sec, 0, 1)));
      mixInto(y, osc(y.length, sr, 110, 'tri'), sr, 0, 0.15);
      saturate(y, 1.5);
      mixInto(y, SOUNDS['impact.rubber.2'].render(sr, rng, 0).map((v, i, a) => a[Math.floor(i * 0.6)] ?? v), sr, 0.8, 0.6);
      return finish(y, sr, 0.7);
    },
  },
  'entry.8': {
    variants: 1,
    render: (sr, rng) => {
      const y = alloc(sr, 1.8);
      mixInto(y, SOUNDS['amb.rover'].render(sr, rng, 0), sr, 0, 0.8);
      mixInto(y, renderNote('twang', 55, sr, rng), sr, 0.45, 0.8);
      return finish(y, sr, 0.7);
    },
  },
  'entry.9': {
    variants: 1,
    render: (sr, rng) => {
      const y = renderNote('gong', 48, sr, rng);
      const whomp = saturate(decay(osc(Math.round(sr * 0.5), sr, (t) => 45 * (1 + Math.exp(-t / 0.02)), 'sine'), sr, 0.15, 0.003), 1.8);
      mixInto(y, whomp, sr, 0, 0.8);
      return finish(y, sr, 0.8);
    },
  },
  'entry.10': {
    variants: 1,
    render: (sr, rng) => {
      const y = alloc(sr, 2.2);
      [77, 81, 84, 89].forEach((m, i) => mixInto(y, renderNote('glassBell', m, sr, rng), sr, i * 0.09, 0.6));
      mixInto(y, sparkles(sr, rng, 1.5, 9, 3000, 7000), sr, 0.2, 0.4);
      return finish(y, sr, 0.6);
    },
  },
};

// impacts: every material at tiers 1-4 (T0 taps reuse tier 1, much quieter)
for (const m of MATERIALS) for (let t = 1; t <= 4; t++) SOUNDS[`impact.${m}.${t}`] = { variants: 4, render: impactRecipe(m, t) };

/** Ambience bed (mono, seamless loop). */
export function renderBed(p: BedParams, sr: number, rng: Rng, seconds = 24): Float32Array {
  const n = Math.round(sr * seconds);
  const src = p.color === 'brown' ? brown(n, rng) : noise(n, rng);
  let y = biquad(biquad(src, sr, 'lowpass', p.lowpass, 0.6), sr, 'highpass', p.highpass, 0.6);
  // slow swells, with two incommensurate rates so the loop doesn't pulse
  const ph = rng() * TAU;
  shape(y, sr, (t) => 1 - p.modDepth * 0.5 * (1 + 0.6 * Math.sin(TAU * p.modRate * t + ph) + 0.4 * Math.sin(TAU * p.modRate * 2.37 * t)));
  y = normalize(y, 0.8);
  if (p.hum) {
    const h = osc(n, sr, p.hum, 'sine');
    mixInto(h, osc(n, sr, p.hum * 2.01, 'sine'), sr, 0, 0.3);
    shape(h, sr, (t) => 0.7 + 0.3 * Math.sin(TAU * 0.07 * t));
    mixInto(y, h, sr, 0, 0.35);
  }
  if (p.rain) {
    const r = biquad(crackle(n, sr, rng, 900), sr, 'highpass', 2500, 0.7);
    mixInto(y, r, sr, 0, 0.35);
  }
  return loopify(normalize(y, 0.8), sr, 2);
}

