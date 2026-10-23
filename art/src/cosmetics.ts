// The cosmetics catalogue (monetisation plan v2): every item's permanent id, name and slot, what gives it
// (a level, the Builder's Pass, a Workshop set or the Supporter Pack), and what each id draws as. Five
// slots: a skin for every shape, the landing burst, the foundation style (slabs and the pedestal), the
// claimed checkpoint's flag, and the avatar's hat. The game mirrors the ids and their unlocks in
// game/src/meta/cosmetics.ts. All purely visual: nothing here reaches a collider or the sim (QA F10.1).
//
// The Builder's Pass lane gives one item at every level from 2 to 60, then one every 5 levels for ever:
// after 60 it goes round the slots again with later variants of the same items (a skin's pattern turns
// colour and size; everything else turns its hues), named with a Roman numeral ("Polka Dots II").

import { type FlagKind, type FlagLook } from './flags.ts';
import { type FoundationKind } from './foundations.ts';
import { type LandingKind, type LandingStyle, landingStyle } from './landing.ts';
import { type SkinInk, type SkinKind, type SkinLook, skinLook } from './skins.ts';
import type { FoundationLook } from './slab.ts';
import { ALL_HATS, HATS, type Hat, type HatKey, hatKey } from './ui/hats.ts';
import { roman, variantTurn } from './util.ts';

export type CosmeticSlot = 'skin' | 'landing' | 'foundation' | 'flag' | 'hat';
/** What gives an item: there from the start, a profile level, the Builder's Pass lane, a Workshop set, or the Supporter Pack. */
export type CosmeticSource = 'default' | 'level' | 'pass' | 'set' | 'supporter';

export interface CosmeticDef {
  /** Permanent: saved in profiles and mirrored by the game. */
  id: string;
  name: string;
  slot: CosmeticSlot;
  source: CosmeticSource;
  /** 'level': the level that unlocks it. 'pass': the level whose Builder's Pass reward it is. */
  level?: number;
  /** 'set': the Workshop set (its product id). */
  set?: string;
  /** Later Builder's Pass variants (after level 60): 1 = the second ("II"). */
  variant?: number;
}

export const COSMETIC_SLOTS: CosmeticSlot[] = ['skin', 'landing', 'foundation', 'flag', 'hat'];
export const SLOT_NAMES: Record<CosmeticSlot, string> = { skin: 'Shape skin', landing: 'Landing', foundation: 'Foundation', flag: 'Flag', hat: 'Hat' };

// ---------------------------------------------------------------------------------------------
// What each id draws as

const SKINS: Record<string, [name: string, kind: SkinKind, ink: SkinInk]> = {
  skin_polka: ['Polka Dots', 'polka', 'white'], skin_stars: ['Starry', 'stars', 'gold'], skin_checks: ['Gingham', 'checks', 'white'],
  skin_hearts: ['Sweethearts', 'hearts', 'white'], skin_pinstripe: ['Pinstripe', 'pinstripe', 'light'], skin_waves: ['Ripples', 'waves', 'white'],
  skin_glitter: ['Glitter', 'glitter', 'gold'], skin_plaid: ['Picnic Plaid', 'plaid', 'shade'], skin_zigzag: ['Zigzag', 'zigzag', 'light'],
  skin_pastel: ['Pastel', 'pastel', 'white'], skin_neon: ['Neon', 'neon', 'light'], skin_galaxy: ['Galaxy', 'galaxy', 'white'],
  skin_candy: ['Peppermint', 'candy', 'white'], skin_robot: ['Robot Plate', 'robot', 'light'], skin_dragon: ['Dragon Scale', 'dragon', 'gold'],
};
const LANDINGS: Record<string, [name: string, kind: LandingKind]> = {
  landing_stars: ['Star Pop', 'stars'], landing_pixels: ['Pixel Pop', 'pixels'], landing_leaves: ['Leaf Flurry', 'leaves'],
  landing_hearts: ['Heart Puff', 'hearts'], landing_bubbles: ['Bubbles', 'bubbles'], landing_notes: ['Music Notes', 'notes'],
  landing_petals: ['Petal Drift', 'petals'], landing_snow: ['Snow Puff', 'snow'], landing_confetti: ['Confetti', 'confetti'],
  landing_sparks: ['Sparks', 'sparks'], landing_butterflies: ['Butterflies', 'butterflies'], landing_rainbow: ['Rainbow Puff', 'rainbow'],
  landing_sprinkles: ['Sprinkles', 'sprinkles'], landing_bolts: ['Nuts and Bolts', 'bolts'], landing_embers: ['Embers', 'embers'],
};
const FOUNDATIONS: Record<string, [name: string, kind: FoundationKind]> = {
  foundation_brick: ['Red Brick', 'brick'], foundation_log: ['Log Cabin', 'log'], foundation_marble: ['Marble', 'marble'],
  foundation_checker: ['Finish Line', 'checker'], foundation_moss: ['Mossy Stone', 'moss'], foundation_bamboo: ['Bamboo', 'bamboo'],
  foundation_ice: ['Ice Block', 'ice'], foundation_toy: ['Toy Blocks', 'toy'], foundation_cobble: ['Cobblestone', 'cobble'],
  foundation_jelly: ['Jelly', 'jelly'], foundation_crystal: ['Crystal', 'crystal'], foundation_gold: ['Gold Bar', 'gold'],
  foundation_cake: ['Layer Cake', 'cake'], foundation_steel: ['Steel Deck', 'steel'], foundation_obsidian: ['Obsidian', 'obsidian'],
};
const FLAGS: Record<string, [name: string, kind: FlagKind]> = {
  flag_pennant: ['Pennant', 'pennant'], flag_checkered: ['Checkered', 'checkered'], flag_heart: ['Heart', 'heart'],
  flag_daisy: ['Daisy', 'daisy'], flag_bolt: ['Thunderbolt', 'bolt'], flag_surf: ['Surf', 'surf'],
  flag_cloud: ['Fair Weather', 'cloud'], flag_paw: ['Paw Print', 'paw'], flag_blocks: ['Building Blocks', 'blocks'],
  flag_moon: ['Moonlight', 'moon'], flag_comet: ['Comet', 'comet'], flag_royal: ['Royal', 'royal'],
  flag_candy: ['Lollipop', 'candy'], flag_robot: ['Gearworks', 'robot'], flag_dragon: ['Dragonfire', 'dragon'],
};

// ---------------------------------------------------------------------------------------------
// The Builder's Pass lane, the Workshop sets, the Supporter Pack

/** The order the lane goes round the slots (5 levels a lap). */
export const PASS_SLOT_ORDER: CosmeticSlot[] = ['skin', 'landing', 'flag', 'foundation', 'hat'];

/** Each slot's Builder's Pass items in lane order: 12 of each and 11 hats, 59 for levels 2 to 60. */
export const PASS_ITEMS: Record<CosmeticSlot, string[]> = {
  skin: ['skin_polka', 'skin_stars', 'skin_checks', 'skin_hearts', 'skin_pinstripe', 'skin_waves', 'skin_glitter', 'skin_plaid', 'skin_zigzag', 'skin_pastel', 'skin_neon', 'skin_galaxy'],
  landing: ['landing_stars', 'landing_pixels', 'landing_leaves', 'landing_hearts', 'landing_bubbles', 'landing_notes', 'landing_petals', 'landing_snow', 'landing_confetti', 'landing_sparks', 'landing_butterflies', 'landing_rainbow'],
  flag: ['flag_pennant', 'flag_checkered', 'flag_heart', 'flag_daisy', 'flag_bolt', 'flag_surf', 'flag_cloud', 'flag_paw', 'flag_blocks', 'flag_moon', 'flag_comet', 'flag_royal'],
  foundation: ['foundation_brick', 'foundation_log', 'foundation_marble', 'foundation_checker', 'foundation_moss', 'foundation_bamboo', 'foundation_ice', 'foundation_toy', 'foundation_cobble', 'foundation_jelly', 'foundation_crystal', 'foundation_gold'],
  hat: ['hat_hardhat', 'hat_beanie', 'hat_cowboy', 'hat_chef', 'hat_beret', 'hat_bunny', 'hat_pirate', 'hat_viking', 'hat_gradcap', 'hat_wizard', 'hat_halo'],
};

/** The last level whose pass reward is a new item; after it, one every PASS_EVERY levels. */
export const PASS_LAST_NEW = 60;
export const PASS_EVERY = 5;

export interface WorkshopSet {
  /** The product id (store and Workshop). */
  id: string;
  name: string;
  /** One line for the Workshop card. */
  text: string;
  /** Its five items: skin, landing, foundation, flag, hat. */
  items: string[];
}

/** The Workshop sets: the first two at the lower price, the Dragon set the fancy one (build plan: $1.99, $1.99, $2.99). */
export const WORKSHOP_SETS: WorkshopSet[] = [
  { id: 'set_candy', name: 'Candy Shop', text: 'Peppermint shapes, sprinkle landings, a layer-cake foundation, a lollipop flag and a cupcake hat.', items: ['skin_candy', 'landing_sprinkles', 'foundation_cake', 'flag_candy', 'hat_cupcake'] },
  { id: 'set_robot', name: 'Robot Works', text: 'Riveted shapes, nuts-and-bolts landings, a steel deck, a gear flag and an antenna.', items: ['skin_robot', 'landing_bolts', 'foundation_steel', 'flag_robot', 'hat_robot'] },
  { id: 'set_dragon', name: "Dragon's Hoard", text: 'Gold-flecked dragon scales, glowing embers, an obsidian foundation with lava cracks, a fire flag and horns.', items: ['skin_dragon', 'landing_embers', 'foundation_obsidian', 'flag_dragon', 'hat_horns'] },
];

/** The Supporter Pack's hat (its portrait is portraits.ts 'supporter'; its badge frame is badge.ts setBadgeFrame('supporter')). */
export const SUPPORTER_HAT = 'hat_heart_crown';

// ---------------------------------------------------------------------------------------------
// The catalogue

const DEFAULTS: CosmeticDef[] = [
  { id: 'skin_classic', name: 'Classic', slot: 'skin', source: 'default' },
  { id: 'landing_classic', name: 'Dust', slot: 'landing', source: 'default' },
  { id: 'foundation_classic', name: 'Biome', slot: 'foundation', source: 'default' },
  { id: 'flag_classic', name: 'Gold Star', slot: 'flag', source: 'default' },
];

/** The look a new profile has: today's (the biome's finish and dust, the biome's slabs, the gold flag, the party hat). */
export const DEFAULT_LOOK: CosmeticLook = { skin: 'skin_classic', landing: 'landing_classic', foundation: 'foundation_classic', flag: 'flag_classic', hat: 'hat_party' };

const NAMES: Record<string, string> = Object.fromEntries([
  ...Object.entries(SKINS).map(([id, v]) => [id, v[0]]), ...Object.entries(LANDINGS).map(([id, v]) => [id, v[0]]),
  ...Object.entries(FOUNDATIONS).map(([id, v]) => [id, v[0]]), ...Object.entries(FLAGS).map(([id, v]) => [id, v[0]]),
]);

function build(): CosmeticDef[] {
  const out: CosmeticDef[] = [...DEFAULTS];
  for (const h of HATS) out.push({ id: `hat_${h.key}`, name: h.name, slot: 'hat', source: h.level > 1 ? 'level' : 'default', level: h.level > 1 ? h.level : undefined });
  for (let L = 2; L <= PASS_LAST_NEW; L++) {
    const slot = PASS_SLOT_ORDER[(L - 2) % 5], id = PASS_ITEMS[slot][Math.floor((L - 2) / 5)];
    out.push({ id, name: nameOf(id), slot, source: 'pass', level: L });
  }
  for (const set of WORKSHOP_SETS) set.items.forEach((id, i) => out.push({ id, name: nameOf(id), slot: COSMETIC_SLOTS[i], source: 'set', set: set.id }));
  out.push({ id: SUPPORTER_HAT, name: nameOf(SUPPORTER_HAT), slot: 'hat', source: 'supporter' });
  return out;
}

const HAT_NAMES = new Map(ALL_HATS.map(h => [h.key as string, h.name]));
const nameOf = (id: string): string => (id.startsWith('hat_') ? HAT_NAMES.get(id.slice(4)) : NAMES[id]) ?? id;

/** Every item that isn't a later variant: defaults, level hats, the pass lane to 60, the sets and the supporter hat. */
export const COSMETICS: CosmeticDef[] = build();
const BY_ID = new Map<string, CosmeticDef>(COSMETICS.map(d => [d.id, d]));

/** An item's base id and variant: 'skin_polka_iii' -> ['skin_polka', 2]. Null for an id this copy doesn't know. */
export function cosmeticVariant(id: string): [string, number] | null {
  if (BY_ID.has(id)) return [id, 0];
  const i = id.lastIndexOf('_'), base = id.slice(0, i), num = id.slice(i + 1);
  const def = BY_ID.get(base);
  if (i < 1 || !def || def.source !== 'pass' || !/^[ivxlcdm]+$/.test(num)) return null;
  for (let n = 2; n < 4000; n++) if (roman(n).toLowerCase() === num) return [base, n - 1];
  return null;
}

/** The id of variant `v` of a pass item (0: the item itself). */
export const variantId = (base: string, v: number): string => (v ? `${base}_${roman(v + 1).toLowerCase()}` : base);

/** Everything about an id, including later variants ("Polka Dots II", with the level that gives it). Undefined if unknown. */
export function cosmetic(id: string | null | undefined): CosmeticDef | undefined {
  if (!id) return undefined;
  const hit = BY_ID.get(id);
  if (hit) return hit;
  const cv = cosmeticVariant(id);
  if (!cv) return undefined;
  const b = BY_ID.get(cv[0])!, list = PASS_ITEMS[b.slot], si = PASS_SLOT_ORDER.indexOf(b.slot), k = list.indexOf(b.id) + (cv[1] - 1) * list.length;
  return { ...b, id, name: `${b.name} ${roman(cv[1] + 1)}`, variant: cv[1], level: PASS_LAST_NEW + PASS_EVERY * (k * 5 + si + 1) };
}

/** The Builder's Pass reward at `level`: a new item from 2 to 60, then a later variant every 5 levels. Undefined between. */
export function passRewardAt(level: number): CosmeticDef | undefined {
  if (level < 2) return undefined;
  if (level <= PASS_LAST_NEW) return BY_ID.get(PASS_ITEMS[PASS_SLOT_ORDER[(level - 2) % 5]][Math.floor((level - 2) / 5)]);
  if ((level - PASS_LAST_NEW) % PASS_EVERY) return undefined;
  const n = (level - PASS_LAST_NEW) / PASS_EVERY, slot = PASS_SLOT_ORDER[(n - 1) % 5], k = Math.floor((n - 1) / 5), list = PASS_ITEMS[slot];
  return cosmetic(variantId(list[k % list.length], 1 + Math.floor(k / list.length)));
}

/** The pass rewards from level `from` to `to` (both included), e.g. what buying the pass at level 12 unlocks at once. */
export function passRewardsBetween(from: number, to: number): CosmeticDef[] {
  const out: CosmeticDef[] = [];
  for (let L = Math.max(2, from); L <= to; L++) { const r = passRewardAt(L); if (r) out.push(r); }
  return out;
}

/** The items of a slot that aren't later variants, in picker order: default and level items, the pass lane, the sets, the supporter hat. */
export function slotItems(slot: CosmeticSlot): CosmeticDef[] {
  const rank: Record<CosmeticSource, number> = { default: 0, level: 1, pass: 2, set: 3, supporter: 4 };
  return COSMETICS.filter(d => d.slot === slot).sort((a, b) => rank[a.source] - rank[b.source] || (a.level ?? 0) - (b.level ?? 0));
}

/** The player's picks, one id per slot (a missing or unknown id draws the default). */
export interface CosmeticLook { skin?: string; landing?: string; foundation?: string; flag?: string; hat?: string | null }

/** The skin an id draws, or null for the classic look (the biome's finish). */
export function skinFor(id: string | null | undefined): SkinLook | null {
  const cv = id ? cosmeticVariant(id) : null, s = cv && SKINS[cv[0]];
  return s ? skinLook(s[1], s[2], cv[1]) : null;
}

/** The landing burst an id spawns, or null for the classic biome dust. */
export function landingFor(id: string | null | undefined): LandingStyle | null {
  const cv = id ? cosmeticVariant(id) : null, l = cv && LANDINGS[cv[0]];
  return l ? landingStyle(l[1], variantTurn(cv[1])) : null;
}

/** The foundation style an id draws, or null for the biome's own slabs. */
export function foundationFor(id: string | null | undefined): FoundationLook | null {
  const cv = id ? cosmeticVariant(id) : null, f = cv && FOUNDATIONS[cv[0]];
  return f ? { kind: f[1], turn: variantTurn(cv[1]) } : null;
}

/** The flag style an id draws, or null for the gold star flag. */
export function flagFor(id: string | null | undefined): FlagLook | null {
  const cv = id ? cosmeticVariant(id) : null, f = cv && FLAGS[cv[0]];
  return f ? { kind: f[1], turn: variantTurn(cv[1]) } : null;
}

/** The avatar hat key an id stands for ('hat_hardhat_ii' -> 'hardhat_ii'), or null. This key is what avatar.hat holds. */
export function hatFor(id: string | null | undefined): Hat | null {
  if (!id?.startsWith('hat_')) return null;
  const cv = cosmeticVariant(id);
  return cv ? hatKey(cv[0].slice(4) as HatKey, cv[1]) : null;
}

/** The cosmetic id for an avatar hat key ('crown' -> 'hat_crown'). */
export const hatCosmeticId = (hat: string | null | undefined): string | null => (hat ? `hat_${hat}` : null);
