// The Workshop's products (monetisation plan v2, "What's for sale"): their ids, starting prices, what
// owning each one gives, and which Supporter offer a player sees. Pure, so Node checks it
// (tests/shop-check.ts). The ids are permanent: they're the store product ids (Play Console, App Store
// Connect), and every one is a one-time, restorable purchase. Nothing here sells hearts, bricks,
// power-ups, XP, score, modes or achievements, and nothing is random.

export type ProductKind = 'pass' | 'noads' | 'wind' | 'portrait' | 'supporter' | 'set';

export interface Product {
  id: string;
  kind: ProductKind;
  /** The US starting price in cents: the test store's price and the label until the store's own arrives. */
  cents: number;
  name: string;
  /** One line: what it gives. */
  text: string;
  /** Portraits: the portrait id it unlocks (meta/portraits.ts). */
  portrait?: string;
  /** Supporter upgrades: what the player must already own to see this one. */
  owns?: 'pass' | 'ads' | 'both';
  /** Not on sale yet (nothing is today: kept for products whose rewards aren't drawn yet). */
  soon?: boolean;
  /** Sets: Art's set id (art/src/cosmetics.ts WORKSHOP_SETS), which is also the product id. */
  set?: string;
}

const SUPPORTER_TEXT = 'The Builder\'s Pass and Remove Ads, plus a supporter hat, badge frame and animated portrait found nowhere else.';
const portrait = (id: string, name: string, animated: boolean): Product => ({
  id: `portrait_${id}`, kind: 'portrait', cents: animated ? 199 : 99, name, portrait: id,
  text: animated ? 'An animated style for your Daily ladder portrait.' : 'A style for your Daily ladder portrait.',
});

const set = (id: string, name: string, cents: number): Product => ({
  id, kind: 'set', cents, name, set: id, text: 'Five matching pieces for your look: a shape skin, a landing, a foundation, a flag and a hat.',
});

/** Everything the Workshop can sell, in the order it shows them. */
export const PRODUCTS: Product[] = [
  { id: 'supporter_pack', kind: 'supporter', cents: 1299, name: 'Supporter Pack', text: SUPPORTER_TEXT },
  { id: 'supporter_upgrade_pass', kind: 'supporter', cents: 799, name: 'Supporter Pack', text: SUPPORTER_TEXT, owns: 'pass' },
  { id: 'supporter_upgrade_ads', kind: 'supporter', cents: 499, name: 'Supporter Pack', text: SUPPORTER_TEXT, owns: 'ads' },
  { id: 'supporter_upgrade_both', kind: 'supporter', cents: 99, name: 'Supporter Pack', text: SUPPORTER_TEXT, owns: 'both' },
  { id: 'builders_pass', kind: 'pass', cents: 499, name: 'Builder\'s Pass', text: 'A second reward at every level from 2 to 60, then every 5 levels for ever. Rewards you\'ve passed unlock at once.' },
  { id: 'remove_ads', kind: 'noads', cents: 799, name: 'Remove Ads', text: 'No more ads between runs, for good. Nothing else changes.' },
  { id: 'second_wind_ready', kind: 'wind', cents: 199, name: 'Second Wind, always ready', text: 'Second Wind waits at the start of every Endless run. Still once a run, and off in scored Daily tries.' },
  portrait('bubblegum', 'Bubblegum', false),
  portrait('checkers', 'Checkers', false),
  portrait('retro', 'Retro', false),
  portrait('rainbow', 'Rainbow', true),
  portrait('lava_lamp', 'Lava Lamp', true),
  portrait('disco', 'Disco', true),
  set('set_candy', 'Candy Shop', 199),
  set('set_robot', 'Robot Works', 199),
  set('set_dragon', 'Dragon\'s Hoard', 299),
];

const BY_ID = new Map(PRODUCTS.map(p => [p.id, p]));
export const product = (id: string): Product | undefined => BY_ID.get(id);

/** The products that can be bought today. */
export const ON_SALE: Product[] = PRODUCTS.filter(p => !p.soon);

/** What a set of owned product ids gives. Unknown ids (a product from a newer version) give nothing. */
export interface Entitlements {
  /** The Builder's Pass lane. */
  pass: boolean;
  /** No ads between runs. */
  noAds: boolean;
  /** Second Wind ready at the start of every Endless run. */
  windAlways: boolean;
  /** The supporter hat and badge frame. */
  supporter: boolean;
  /** Bought portrait ids (shop styles, and 'supporter' with the pack). */
  portraits: string[];
  /** Bought Workshop sets (their ids, which Art's cosmetics name). */
  sets: string[];
}

export function entitlements(owned: Iterable<string>): Entitlements {
  const e: Entitlements = { pass: false, noAds: false, windAlways: false, supporter: false, portraits: [], sets: [] };
  for (const id of owned) {
    const p = BY_ID.get(id);
    if (!p) continue;
    if (p.kind === 'pass') e.pass = true;
    if (p.kind === 'noads') e.noAds = true;
    if (p.kind === 'wind') e.windAlways = true;
    if (p.kind === 'portrait' && p.portrait && !e.portraits.includes(p.portrait)) e.portraits.push(p.portrait);
    if (p.kind === 'set' && p.set && !e.sets.includes(p.set)) e.sets.push(p.set);
    if (p.kind === 'supporter') {
      e.pass = e.noAds = e.supporter = true;
      if (!e.portraits.includes('supporter')) e.portraits.push('supporter');
    }
  }
  return e;
}

/**
 * The one Supporter offer for what the player owns: the full pack, or the upgrade for the price
 * difference (never under $0.99, the lowest store price). Null once they're a supporter.
 */
export function supporterOffer(owned: Iterable<string>): Product | null {
  const ids = new Set(owned);
  if ([...ids].some(id => BY_ID.get(id)?.kind === 'supporter')) return null;
  const pass = ids.has('builders_pass'), ads = ids.has('remove_ads');
  return BY_ID.get(pass && ads ? 'supporter_upgrade_both' : pass ? 'supporter_upgrade_pass' : ads ? 'supporter_upgrade_ads' : 'supporter_pack')!;
}

/** A price in cents as the test store shows it ("$4.99"). */
export const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
