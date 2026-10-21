// Per-biome audio data (audio section 4.4). Biome ids are the integers 1 to 10
// in the shared list order. Default materials follow Art's biome finishes table.

import type { Key } from './music/theory';
import type { Material } from './types';

export interface BedParams {
  /** noise color for the bed */
  color: 'white' | 'brown';
  lowpass: number;
  highpass: number;
  /** slow swell rate (Hz) and depth (0-1) */
  modRate: number;
  modDepth: number;
  /** optional tonal hum (Hz) mixed under the noise */
  hum?: number;
  /** adds rain patter */
  rain?: boolean;
  levelDb: number;
}

export type Sweetener = 'bird' | 'leaves' | 'thunder' | 'jet' | 'satellite' | 'crackle' | 'rover' | 'chime' | 'pulsar';

export interface BiomeAudio {
  id: number;
  name: string;
  key: Key;
  material: Material;
  /** shared reverb send for sfx (0 = dry, as in space) */
  air: number;
  bed: BedParams;
  sweeteners: Sweetener[];
  /** the last checkpoint climbed in this biome; claiming it enters the next (gameplay.md 8.2) */
  lastCheckpoint: number;
}

export const BIOMES: BiomeAudio[] = [
  {
    id: 1, name: 'Meadow', key: { root: 72, mode: 'major' }, material: 'wood', air: 0.1,
    bed: { color: 'brown', lowpass: 900, highpass: 120, modRate: 0.08, modDepth: 0.5, levelDb: -30 },
    sweeteners: ['bird', 'bird', 'bird'], lastCheckpoint: 2,
  },
  {
    id: 2, name: 'Treetops', key: { root: 67, mode: 'major' }, material: 'wood', air: 0.14,
    bed: { color: 'white', lowpass: 2600, highpass: 600, modRate: 0.15, modDepth: 0.6, levelDb: -34 },
    sweeteners: ['bird', 'leaves', 'bird'], lastCheckpoint: 4,
  },
  {
    id: 3, name: 'Cloudlands', key: { root: 74, mode: 'major' }, material: 'rubber', air: 0.32,
    bed: { color: 'brown', lowpass: 1200, highpass: 200, modRate: 0.06, modDepth: 0.7, levelDb: -31 },
    sweeteners: ['bird'], lastCheckpoint: 6,
  },
  {
    id: 4, name: 'Storm Belt', key: { root: 71, mode: 'minor' }, material: 'metal', air: 0.24,
    bed: { color: 'white', lowpass: 1600, highpass: 250, modRate: 0.2, modDepth: 0.8, rain: true, levelDb: -29 },
    sweeteners: ['thunder'], lastCheckpoint: 8,
  },
  {
    id: 5, name: 'Stratosphere', key: { root: 64, mode: 'minor' }, material: 'glass', air: 0.36,
    bed: { color: 'white', lowpass: 3200, highpass: 1400, modRate: 0.05, modDepth: 0.5, levelDb: -38 },
    sweeteners: ['jet'], lastCheckpoint: 10,
  },
  {
    id: 6, name: 'Orbit', key: { root: 69, mode: 'minor' }, material: 'metal', air: 0.03,
    bed: { color: 'brown', lowpass: 300, highpass: 40, modRate: 0.03, modDepth: 0.3, hum: 55, levelDb: -42 },
    sweeteners: ['satellite'], lastCheckpoint: 13,
  },
  {
    id: 7, name: 'Moon', key: { root: 62, mode: 'minor' }, material: 'rubber', air: 0.03,
    bed: { color: 'brown', lowpass: 250, highpass: 40, modRate: 0.02, modDepth: 0.3, hum: 49, levelDb: -42 },
    sweeteners: ['crackle'], lastCheckpoint: 16,
  },
  {
    id: 8, name: 'Red Planet', key: { root: 67, mode: 'minor' }, material: 'metal', air: 0.1,
    bed: { color: 'white', lowpass: 1800, highpass: 500, modRate: 0.12, modDepth: 0.8, levelDb: -33 },
    sweeteners: ['rover'], lastCheckpoint: 19,
  },
  {
    id: 9, name: 'Ringed Giant', key: { root: 60, mode: 'minor' }, material: 'ice', air: 0.18,
    bed: { color: 'brown', lowpass: 220, highpass: 30, modRate: 0.04, modDepth: 0.4, hum: 41, levelDb: -36 },
    sweeteners: ['chime'], lastCheckpoint: 22,
  },
  {
    id: 10, name: 'Deep Cosmos', key: { root: 65, mode: 'major' }, material: 'jelly', air: 0.12,
    bed: { color: 'white', lowpass: 1400, highpass: 300, modRate: 0.03, modDepth: 0.5, hum: 65, levelDb: -40 },
    sweeteners: ['pulsar'], lastCheckpoint: Infinity,
  },
];

/** Deep Cosmos rotates key every 6 checkpoints; every 4th rotation comes home to C major. */
export const DEEP_COSMOS_KEYS: Key[] = [
  { root: 65, mode: 'major' },
  { root: 70, mode: 'major' },
  { root: 63, mode: 'major' },
  { root: 72, mode: 'major' },
];

export const FIRST_DEEP_COSMOS_CHECKPOINT = 23;

export function biome(id: number): BiomeAudio {
  const i = Math.min(BIOMES.length, Math.max(1, Math.round(id))) - 1;
  return BIOMES[i];
}

/** Which Deep Cosmos rotation a run is on, from the checkpoints it has claimed. */
export function cosmosRotation(checkpoint: number): number {
  return Math.max(0, Math.floor((checkpoint - FIRST_DEEP_COSMOS_CHECKPOINT) / 6));
}

/** Key for a biome; Deep Cosmos depends on how many checkpoints into it the run is. */
export function biomeKey(id: number, checkpoint = 0): Key {
  const b = biome(id);
  if (b.id !== 10) return b.key;
  return DEEP_COSMOS_KEYS[cosmosRotation(checkpoint) % DEEP_COSMOS_KEYS.length];
}
