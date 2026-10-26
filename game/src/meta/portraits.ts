// Ladder portraits (gameplay.md §12.3, monetisation plan): the player's Blockling shown in a portrait
// style next to their name. Free styles come with levels, animated ones with the hardest achievements
// (never sold), and shop styles from the Workshop (never earned). All cosmetic: none changes a rank.
// Ids are permanent; Art draws them (art/src/ui/portraits.ts).

export type PortraitSource = 'level' | 'achievement' | 'shop' | 'pack';

export interface PortraitDef {
  id: string;
  source: PortraitSource;
  animated: boolean;
  /** 'level': the profile level that unlocks it. */
  level?: number;
  /** 'achievement': the achievement that unlocks it. */
  achievement?: string;
}

const P = (id: string, source: PortraitSource, animated: boolean, unlock: { level?: number; achievement?: string } = {}): PortraitDef => ({ id, source, animated, ...unlock });

export const PORTRAITS: PortraitDef[] = [
  P('meadow', 'level', false, { level: 1 }),
  P('sunset', 'level', false, { level: 4 }),
  P('nightsky', 'level', false, { level: 8 }),
  P('cloudland', 'level', false, { level: 12 }),
  P('moonwalk', 'achievement', true, { achievement: 'biome_7' }),
  P('dust_devil', 'achievement', true, { achievement: 'biome_8' }),
  P('ring_leader', 'achievement', true, { achievement: 'biome_9' }),
  P('deep_space', 'achievement', true, { achievement: 'biome_10' }),
  P('golden_crown', 'achievement', true, { achievement: 'cp_30' }),
  P('seventh_heaven', 'achievement', true, { achievement: 'combo_7' }),
  P('ironclad', 'achievement', true, { achievement: 'flawless_6' }),
  P('meteor_shower', 'achievement', true, { achievement: 'calm_7' }),
  P('bubblegum', 'shop', false),
  P('checkers', 'shop', false),
  P('retro', 'shop', false),
  P('rainbow', 'shop', true),
  P('lava_lamp', 'shop', true),
  P('disco', 'shop', true),
  P('supporter', 'pack', true),
];

export const DEFAULT_PORTRAIT = 'meadow';
const BY_ID = new Map(PORTRAITS.map(p => [p.id, p]));
export const portraitDef = (id: string): PortraitDef | undefined => BY_ID.get(id);
/** Bought in the Workshop (a shop style or the Supporter Pack's): the ladder shows it once a store receipt proves it. */
export const portraitBought = (id: string): boolean => ['shop', 'pack'].includes(BY_ID.get(id)?.source ?? '');

/** What unlocking needs from the player: their level, unlocked achievements, and bought portraits. */
export interface PortraitOwner { level: number; achievements: Record<string, unknown>; bought: string[] }

export function portraitOwned(id: string, o: PortraitOwner): boolean {
  const p = BY_ID.get(id);
  if (!p) return false;
  if (p.source === 'level') return o.level >= (p.level ?? 1);
  if (p.source === 'achievement') return !!p.achievement && p.achievement in o.achievements;
  return o.bought.includes(id);
}
