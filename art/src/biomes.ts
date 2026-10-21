// The ten biomes (art-direction.md §3.4, §6). Biomes switch on checkpoint claims, not height.
// The sky is keyed to a continuous "sky position": biome index + 0.7 × progress through that biome's
// checkpoints; the last 0.3 eases in over 2 s when the biome is entered (§6.4).

import type { Finish } from './piece.ts';
import { type Lab, clamp, labToHex, mixLab, oklab, smooth } from './util.ts';

export interface Biome {
  id: string;
  name: string;
  /** First checkpoint of the biome (1-based, Gameplay §8). */
  firstCp: number;
  /** Sky keyframes: top, middle, bottom of the screen. */
  sky: [string, string, string];
  /** Landing dust color (§7.1). */
  dust: string;
  /** Default piece finish (§4.6). */
  finish: Finish | null;
  /** Piece lighting tint, 12% or less (§6.4). */
  tint: { color: string; alpha: number } | null;
}

export const BIOMES: Biome[] = [
  { id: 'meadow', name: 'Meadow', firstCp: 1, sky: ['#6EC3FF', '#A9DEFF', '#E4F7FF'], dust: '#C9A27A', finish: 'wood', tint: null },
  { id: 'treetops', name: 'Treetops', firstCp: 3, sky: ['#4DA8F0', '#86C9FA', '#CDEBFF'], dust: '#D8C9A0', finish: 'wood', tint: null },
  { id: 'cloudlands', name: 'Cloudlands', firstCp: 5, sky: ['#6FAFEF', '#B5D8FA', '#F6FAFF'], dust: '#FFFFFF', finish: null, tint: null },
  { id: 'storm', name: 'Storm Belt', firstCp: 7, sky: ['#3B4A6B', '#5F6F8F', '#8E9AB3'], dust: '#C5CEDD', finish: 'glass', tint: { color: '#506EAA', alpha: 0.1 } },
  { id: 'stratosphere', name: 'Stratosphere', firstCp: 9, sky: ['#2B2F7A', '#B26AC0', '#FFB27A'], dust: '#FFD9B8', finish: 'glass', tint: { color: '#FFAA78', alpha: 0.07 } },
  { id: 'orbit', name: 'Orbit', firstCp: 11, sky: ['#05081A', '#0B1230', '#162452'], dust: '#BFE3FF', finish: 'panel', tint: null },
  { id: 'moon', name: 'Moon', firstCp: 14, sky: ['#07081A', '#121530', '#262A45'], dust: '#D8DAE6', finish: null, tint: null },
  { id: 'redplanet', name: 'Red Planet', firstCp: 17, sky: ['#1A0710', '#4A1620', '#9A3B2A'], dust: '#FFB08A', finish: 'panel', tint: null },
  { id: 'ringed', name: 'Ringed Giant', firstCp: 20, sky: ['#0C0A24', '#2B1F52', '#8A6A3D'], dust: '#FFE3A8', finish: 'frost', tint: null },
  { id: 'cosmos', name: 'Deep Cosmos', firstCp: 23, sky: ['#09031A', '#1C0A38', '#3A1258'], dust: '#FFB8F0', finish: 'jelly', tint: null },
];

const LABS: Lab[][] = BIOMES.map(b => b.sky.map(oklab));

/** Biome index for a checkpoint number (the checkpoint you are climbing toward). */
export function biomeForCheckpoint(cp: number): number {
  let i = 0;
  while (i < BIOMES.length - 1 && cp >= BIOMES[i + 1].firstCp) i++;
  return i;
}

/** Sky colors (top, middle, bottom) at a sky position, mixed in OKLab. */
export function skyColors(sp: number): [string, string, string] {
  const i = clamp(Math.floor(sp), 0, 9), j = Math.min(9, i + 1), t = i === 9 ? 0 : clamp(sp - i, 0, 1);
  return [0, 1, 2].map(n => labToHex(mixLab(LABS[i][n], LABS[j][n], t))) as [string, string, string];
}

/** How present biome i's parallax props are at sky position sp (cross-fade over the biome's last checkpoint). */
export function presence(i: number, sp: number): number {
  const fin = i === 0 ? 1 : smooth(i - 0.28, i + 0.04, sp);
  const fout = i === 9 ? 1 : 1 - smooth(i + 0.74, i + 1.02, sp);
  return fin * fout;
}

/** Space rim strength: off below Stratosphere, full by its end (§6.4). */
export const rimAmount = (sp: number): number => smooth(4.1, 4.9, sp);
/** Star field strength: fades in through Stratosphere, full by Orbit. */
export const starAmount = (sp: number): number => smooth(3.6, 5.2, sp);

/**
 * Follows the sky position. Within a biome it tracks checkpoint progress (0.7 of the band);
 * on entering a new biome it eases the rest of the way over 2 s.
 */
export class SkyClock {
  sp = 0;
  private from = 0;
  private to = 0;
  private t = 1;
  private biome = 0;

  /** biome: current biome index. progress: 0..1 through that biome's checkpoints. */
  update(dt: number, biome: number, progress: number, reduceMotion = false): number {
    const target = biome + 0.7 * clamp(progress, 0, 1);
    if (biome !== this.biome) { this.biome = biome; this.from = this.sp; this.to = target; this.t = 0; }
    if (this.t < 1 && !reduceMotion) {
      this.t = Math.min(1, this.t + dt / 2);
      this.to = target;
      this.sp = this.from + (this.to - this.from) * smooth(0, 1, this.t);
    } else {
      this.sp += (target - this.sp) * Math.min(1, dt * 2);
      if (reduceMotion) this.sp = target;
    }
    return this.sp;
  }

  /** Jump straight to a position (new run, debug). */
  set(sp: number): void { this.sp = this.from = this.to = sp; this.t = 1; this.biome = clamp(Math.floor(sp), 0, 9); }
}
