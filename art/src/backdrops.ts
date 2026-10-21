// Every biome's parallax prop baker, by biome index. The Phaser Backdrop streams these; postcards bake
// them small.

import { bakeCloudlands } from './cloudlands.ts';
import { bakeCosmos } from './cosmos.ts';
import { type BackdropPart, bakeMeadow } from './meadow.ts';
import { bakeMoon, bakeOrbit, bakeRedPlanet, bakeRinged } from './space.ts';
import { bakeStorm, bakeStratosphere } from './storm.ts';
import { bakeTreetops } from './treetops.ts';

export type BiomeBaker = (W: number, H: number, k: number) => BackdropPart[];

export const BIOME_BAKERS: BiomeBaker[] = [
  bakeMeadow, bakeTreetops, bakeCloudlands, bakeStorm, bakeStratosphere, bakeOrbit, bakeMoon, bakeRedPlanet, bakeRinged, bakeCosmos,
];
