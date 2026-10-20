// Pitched placeholder instruments, synthesized per note. The landing ladder,
// stingers and chords all play through these, so every material has a voice
// (audio section 5: wood = marimba, stone = low kalimba, ice = glass bell,
// rubber = bouncy pluck, jelly = wobbly synth, metal = vibraphone, glass = celesta).

import {
  burst, decay, fadeEdges, fm, midiToHz, mixInto, normalize, osc, partials, resonate, shape,
  biquad, trimTail, alloc, type Rng, TAU,
} from './dsp';
import type { Material } from '../types';

export type InstrumentId =
  | 'marimba' | 'kalimba' | 'glassBell' | 'pluck' | 'wobble' | 'vibes' | 'celesta'
  | 'whistle' | 'bellLow' | 'clonk' | 'gong' | 'twang';

export const MATERIAL_INSTRUMENT: Record<Material, { inst: InstrumentId; octave: number }> = {
  wood: { inst: 'marimba', octave: 0 },
  stone: { inst: 'kalimba', octave: -1 },
  ice: { inst: 'glassBell', octave: 0 },
  rubber: { inst: 'pluck', octave: 0 },
  jelly: { inst: 'wobble', octave: 0 },
  metal: { inst: 'vibes', octave: 0 },
  glass: { inst: 'celesta', octave: 0 },
  ground: { inst: 'marimba', octave: -1 },
  base: { inst: 'marimba', octave: -1 },
};

export function renderNote(inst: InstrumentId, midi: number, sr: number, rng: Rng): Float32Array {
  const f = midiToHz(midi);
  let y: Float32Array;
  switch (inst) {
    case 'marimba': {
      const n = Math.round(sr * 1.1);
      const ex = burst(sr, rng, 2.2, 5000, n);
      y = resonate(ex, sr, [
        { f, a: 1, tau: 0.45 * Math.pow(440 / f, 0.35) },
        { f: f * 3.93, a: 0.22, tau: 0.09 },
        { f: f * 9.2, a: 0.06, tau: 0.03 },
      ]);
      break;
    }
    case 'kalimba': {
      const n = Math.round(sr * 1.2);
      const ex = burst(sr, rng, 1.5, 7000, n);
      y = resonate(ex, sr, [
        { f, a: 1, tau: 0.6 },
        { f: f * 5.95, a: 0.18, tau: 0.08 },
        { f: f * 2.01, a: 0.08, tau: 0.25 },
      ]);
      break;
    }
    case 'glassBell': {
      const n = Math.round(sr * 1.8);
      y = partials(n, sr, [
        { f, a: 1, tau: 0.9 },
        { f: f * 2.76, a: 0.45, tau: 0.5 },
        { f: f * 5.4, a: 0.25, tau: 0.25 },
        { f: f * 8.93, a: 0.12, tau: 0.12 },
      ], rng);
      mixInto(y, decay(fm(n, sr, f * 2, 1.5, 1.2, 0.05), sr, 0.08), sr, 0, 0.15);
      fadeEdges(y, sr, 1.5, 10);
      break;
    }
    case 'pluck': {
      // bouncy synth pluck: a quick pitch drop gives it the "boing"
      const n = Math.round(sr * 0.8);
      y = osc(n, sr, (t) => f * (1 + 0.45 * Math.exp(-t / 0.018)), 'tri');
      const body = biquad(osc(n, sr, (t) => f * (1 + 0.45 * Math.exp(-t / 0.018)), 'saw'), sr, 'lowpass', (t) => 300 + 3000 * Math.exp(-t / 0.06), 1.2);
      mixInto(y, body, sr, 0, 0.35);
      decay(y, sr, 0.22, 0.002);
      break;
    }
    case 'wobble': {
      const n = Math.round(sr * 1.0);
      y = osc(n, sr, (t) => f * Math.pow(2, (0.6 * Math.sin(TAU * 7 * t) * Math.exp(-t / 0.35)) / 12), 'tri');
      mixInto(y, osc(n, sr, f * 2, 'sine'), sr, 0, 0.15);
      shape(y, sr, (t) => Math.min(1, t / 0.015) * Math.exp(-t / 0.35));
      break;
    }
    case 'vibes': {
      const n = Math.round(sr * 1.6);
      y = partials(n, sr, [
        { f, a: 1, tau: 0.9 },
        { f: f * 4, a: 0.3, tau: 0.3 },
        { f: f * 10, a: 0.08, tau: 0.08 },
      ], rng);
      shape(y, sr, (t) => 1 - 0.28 * (0.5 + 0.5 * Math.sin(TAU * 5.5 * t)));
      mixInto(y, burst(sr, rng, 1, 6000), sr, 0, 0.3);
      fadeEdges(y, sr, 1, 10);
      break;
    }
    case 'celesta': {
      const n = Math.round(sr * 1.0);
      y = partials(n, sr, [
        { f, a: 1, tau: 0.5 },
        { f: f * 2, a: 0.35, tau: 0.28 },
        { f: f * 3, a: 0.18, tau: 0.14 },
        { f: f * 4.2, a: 0.08, tau: 0.07 },
      ], rng);
      mixInto(y, burst(sr, rng, 0.8, 9000), sr, 0, 0.2);
      fadeEdges(y, sr, 1, 10);
      break;
    }
    case 'whistle': {
      const n = Math.round(sr * 0.45);
      y = osc(n, sr, (t) => f * Math.pow(2, (0.25 * Math.sin(TAU * 6 * t)) / 12), 'sine');
      const breath = biquad(new Float32Array(n).map(() => rng() * 2 - 1), sr, 'bandpass', f, 4);
      mixInto(y, breath, sr, 0, 0.12);
      shape(y, sr, (t) => Math.min(1, t / 0.03) * (t < 0.3 ? 1 : Math.max(0, 1 - (t - 0.3) / 0.15)));
      break;
    }
    case 'bellLow': {
      const n = Math.round(sr * 2.6);
      y = fm(n, sr, f, 1.4, 3, 0.4);
      decay(y, sr, 0.9, 0.003);
      mixInto(y, decay(osc(n, sr, f * 2.0, 'sine'), sr, 0.5), sr, 0, 0.2);
      break;
    }
    case 'clonk': {
      // the slightly detuned "wrong" note for a messy placement
      const n = Math.round(sr * 0.4);
      const ex = burst(sr, rng, 3, 2200, n);
      y = resonate(ex, sr, [
        { f: f * 0.97, a: 1, tau: 0.08 },
        { f: f * 2.43, a: 0.4, tau: 0.04 },
        { f: f * 3.6, a: 0.15, tau: 0.02 },
      ]);
      break;
    }
    case 'gong': {
      const n = Math.round(sr * 3.0);
      y = fm(n, sr, f, 2.41, 6, 0.8);
      mixInto(y, fm(n, sr, f * 1.48, 1.73, 3, 0.5), sr, 0, 0.5);
      decay(y, sr, 1.1, 0.004);
      break;
    }
    case 'twang': {
      // space-western guitar: plucked string with a slide up into the note
      const n = Math.round(sr * 1.4);
      y = pluckSlide(n, sr, f, rng);
      break;
    }
  }
  normalize(y, 0.85);
  return trimTail(fadeEdges(y, sr, 0.3, 12), sr);
}

function pluckSlide(n: number, sr: number, f: number, rng: Rng): Float32Array {
  const y = osc(n, sr, (t) => f * Math.pow(2, (-3 * Math.exp(-t / 0.08)) / 12), 'saw');
  const out = biquad(y, sr, 'lowpass', (t) => 400 + 4000 * Math.exp(-t / 0.15), 1.5);
  const pick = alloc(sr, 0.01);
  for (let i = 0; i < pick.length; i++) pick[i] = (rng() * 2 - 1) * (1 - i / pick.length);
  mixInto(out, pick, sr, 0, 0.3);
  return decay(out, sr, 0.45, 0.002);
}
