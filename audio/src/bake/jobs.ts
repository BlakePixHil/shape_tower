// Bake jobs: every procedural render the bank needs, as plain data, so the same
// code runs on the main thread or in the bake worker and gives identical audio.

import { biome } from '../biomes';
import { mixInto, mulberry32, normalize, reverbIR } from '../synth/dsp';
import { renderNote, type InstrumentId } from '../synth/instruments';
import { SOUNDS, renderBed } from '../synth/recipes';

export type BakeJob =
  | { kind: 'sound'; name: string; sr: number; seed: number }
  | { kind: 'note'; inst: InstrumentId; midi: number; sr: number; low?: boolean }
  | { kind: 'chord'; inst: InstrumentId; midis: number[]; spread: number; sr: number; low?: boolean }
  | { kind: 'bed'; biome: number; sr: number }
  | { kind: 'ir'; seconds: number; seed: number; sr: number };

/** Renders one job; a sound returns one array per variation. */
export function runJob(j: BakeJob): Float32Array[] {
  switch (j.kind) {
    case 'sound': {
      const def = SOUNDS[j.name];
      if (!def) return [];
      const out: Float32Array[] = [];
      for (let v = 0; v < def.variants; v++) out.push(def.render(j.sr, mulberry32(hash(j.name) ^ (j.seed * 7919 + v * 104729)), v));
      return out;
    }
    case 'note':
      return [renderNote(j.inst, j.midi, j.sr, mulberry32(hash(`${j.inst}:${j.midi}`)))];
    case 'chord': {
      const parts = j.midis.map((m) => renderNote(j.inst, m, j.sr, mulberry32(hash(`${j.inst}:${m}`))));
      const len = Math.max(...parts.map((p, i) => p.length + Math.round(i * j.spread * j.sr)));
      const mix = new Float32Array(len);
      parts.forEach((p, i) => mixInto(mix, p, j.sr, i * j.spread, 1));
      return [normalize(mix, 0.85)];
    }
    case 'bed':
      return [renderBed(biome(j.biome).bed, j.sr, mulberry32(hash(`bed${j.biome}`)))];
    case 'ir':
      return reverbIR(j.sr, j.seconds, mulberry32(j.seed));
  }
}

/** Cache key for a job's result. */
export function jobKey(j: BakeJob): string {
  switch (j.kind) {
    case 'sound':
      return j.name;
    // a note baked at a lower rate than its instrument's own (Pop's) is a different buffer
    case 'note':
      return `${j.inst}:${j.midi}${j.low ? '~' : ''}`;
    case 'chord':
      return `${j.inst}:[${j.midis.join(',')}]:${j.spread}${j.low ? '~' : ''}`;
    case 'bed':
      return `bed:${j.biome}`;
    case 'ir':
      return `ir:${j.seconds}:${j.seed}`;
  }
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export interface BakeRequest {
  id: number;
  jobs: BakeJob[];
}

export type BakeResponse = { id: number; out: Float32Array[][] } | { id: number; error: string };
