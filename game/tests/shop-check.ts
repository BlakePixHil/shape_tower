// The Workshop's rules without a browser (monetisation plan v2): the products and their prices, what
// owning each one gives (with the look's items from Art's catalogue: the pass lane up to the player's
// level at once, sets, the Supporter crown, refunds), the one Supporter offer, and the end-of-run ad pacing:
// 6 minutes of active run time, at most 8 a day, none below level 3 (and time before it doesn't count),
// none with Remove Ads, and an ad that didn't show staying due. The rules that never change: nothing sold
// touches play, and achievements, power-ups, XP, hearts and bricks aren't for sale.
// Run: npm run shop:check

import { ADS, addRunTime, adCheck, adShown, freshAds, loadAds, localDay } from '../src/meta/ads.ts';
import { PRODUCTS, ON_SALE, entitlements, product, supporterOffer, usd } from '../src/meta/shop.ts';
import { PORTRAITS } from '../src/meta/portraits.ts';
import { DEFAULT_AVATAR, freshLook } from '../src/view/profile.ts';
import { COSMETICS, DEFAULT_LOOK, PASS_LAST_NEW, WORKSHOP_SETS, hatCosmeticId, passRewardAt, passRewardsBetween } from '../../art/src/cosmetics.ts';
import { cosmeticOwned, ownedLook } from '../../art/src/ui/look.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

const MIN = 60_000;
const at = (iso: string) => new Date(iso);

// ---------------------------------------------------------------- products

{
  const ids = PRODUCTS.map(p => p.id);
  check('every product id is unique and a valid store id (lowercase letters, digits, _ and .)', new Set(ids).size === ids.length && ids.every(id => /^[a-z0-9][a-z0-9_.]*$/.test(id)), ids.join(' '));
  const price = (id: string) => product(id)?.cents;
  check('the plan\'s prices: Builder\'s Pass $4.99, Remove Ads $7.99, Second Wind always ready $1.99, Supporter Pack $12.99',
    price('builders_pass') === 499 && price('remove_ads') === 799 && price('second_wind_ready') === 199 && price('supporter_pack') === 1299);
  const shop = PORTRAITS.filter(p => p.source === 'shop');
  const sold = PRODUCTS.filter(p => p.kind === 'portrait');
  check('each of the six shop portraits is sold on its own: static $0.99, animated $1.99',
    shop.length === 6 && sold.length === 6 && shop.every(p => sold.some(s => s.portrait === p.id && s.cents === (p.animated ? 199 : 99))));
  check('achievement and level portraits are never sold', PORTRAITS.filter(p => p.source === 'achievement' || p.source === 'level').every(p => !sold.some(s => s.portrait === p.id)));
  check('the supporter portrait comes only with the Supporter Pack', !sold.some(s => s.portrait === 'supporter') && entitlements(['supporter_pack']).portraits.includes('supporter'));
  check('nothing sold is a hearts, bricks, power-up, XP, mode or achievement product',
    PRODUCTS.every(p => ['pass', 'noads', 'wind', 'portrait', 'supporter', 'set'].includes(p.kind)) && !ids.some(id => /heart|brick|power|xp|boost|zen|daily|achiev|retry|continue|gem|coin/.test(id)));
  check('the test store\'s labels', usd(499) === '$4.99' && usd(99) === '$0.99' && usd(1299) === '$12.99');
  check('everything is on sale now that its rewards are drawn (Art\'s cosmetics)', ON_SALE.length === PRODUCTS.length && PRODUCTS.every(p => !p.soon));
  check('Remove Ads and Second Wind always ready are on sale', ON_SALE.some(p => p.id === 'remove_ads') && ON_SALE.some(p => p.id === 'second_wind_ready'));
  const sets = PRODUCTS.filter(p => p.kind === 'set');
  check('the three Workshop sets are Art\'s, at $1.99, $1.99 and $2.99', sets.map(p => p.id).join() === WORKSHOP_SETS.map(w => w.id).join() && sets.map(p => p.cents).join() === '199,199,299' && sets.every(p => p.set === p.id), sets.map(p => `${p.id} ${p.cents}`).join(', '));
}

// ---------------------------------------------------------------- what owning gives

{
  const none = entitlements([]);
  check('owning nothing gives nothing', !none.pass && !none.noAds && !none.windAlways && !none.supporter && none.portraits.length === 0);
  const ads = entitlements(['remove_ads']);
  check('Remove Ads removes ads and changes nothing else', ads.noAds && !ads.pass && !ads.windAlways && !ads.supporter && ads.portraits.length === 0);
  const wind = entitlements(['second_wind_ready']);
  check('Second Wind always ready gives only that', wind.windAlways && !wind.noAds && !wind.pass);
  for (const id of ['supporter_pack', 'supporter_upgrade_pass', 'supporter_upgrade_ads', 'supporter_upgrade_both']) {
    const e = entitlements([id]);
    check(`${id} gives the pass, Remove Ads and the supporter things`, e.pass && e.noAds && e.supporter && e.portraits.includes('supporter') && !e.windAlways);
  }
  const p = entitlements(['portrait_disco', 'portrait_retro', 'portrait_disco']);
  check('a bought portrait unlocks that portrait, once', p.portraits.length === 2 && p.portraits.includes('disco') && p.portraits.includes('retro'));
  const set = entitlements(['set_robot', 'set_robot']);
  check('a set gives that set, once, and nothing else', set.sets.join() === 'set_robot' && !set.pass && !set.noAds && !set.supporter);
  const future = entitlements(['some_newer_product', 'remove_ads']);
  check('an id from a newer version is ignored, the rest still count', future.noAds && !future.pass);
}

// ---------------------------------------------------------------- the look: what owning gives (Art's catalogue)

{
  const owner = (level: number, owned: string[]) => { const e = entitlements(owned); return { level, pass: e.pass, sets: e.sets, supporter: e.supporter }; };
  const passItems = COSMETICS.filter(d => d.source === 'pass');
  check('without the pass, no pass reward is owned, at any level', passItems.every(d => !cosmeticOwned(d.id, owner(99, []))));
  const at30 = owner(30, ['builders_pass']);
  check('buying the pass at level 30 gives the 29 rewards from level 2 to 30 at once, and none above', passRewardsBetween(2, 30).length === 29 && passRewardsBetween(2, 30).every(d => cosmeticOwned(d.id, at30)) && passItems.filter(d => (d.level ?? 0) > 30).every(d => !cosmeticOwned(d.id, at30)));
  check('the Supporter Pack gives the pass lane and the heart crown', cosmeticOwned('hat_heart_crown', owner(5, ['supporter_pack'])) && cosmeticOwned(passRewardAt(5)!.id, owner(5, ['supporter_upgrade_ads'])) && !cosmeticOwned('hat_heart_crown', owner(60, ['builders_pass'])));
  const candy = WORKSHOP_SETS.find(w => w.id === 'set_candy')!;
  check('a set gives its five items at any level, and only to its owner', candy.items.length === 5 && candy.items.every(id => cosmeticOwned(id, owner(1, ['set_candy']))) && candy.items.every(id => !cosmeticOwned(id, owner(80, ['set_robot', 'builders_pass']))));
  const worn = ownedLook({ skin: candy.items[0], landing: passRewardAt(3)!.id, foundation: 'foundation_classic', flag: 'flag_classic', hat: 'hat_heart_crown' }, owner(40, []));
  check('a worn item no longer owned (a refund) shows as the default, and an unowned hat comes off', worn.skin === 'skin_classic' && worn.landing === 'landing_classic' && worn.hat === null, JSON.stringify(worn));
  check('after level 60 the pass keeps giving, every 5 levels', !!passRewardAt(65) && !passRewardAt(63) && passRewardAt(65)!.id.endsWith('_ii') && PASS_LAST_NEW === 60);
  const fl = freshLook();
  check('a new profile wears Art\'s default look (the four saved slots, and the party hat on the avatar)', (['skin', 'landing', 'foundation', 'flag'] as const).every(k => fl[k] === DEFAULT_LOOK[k]) && hatCosmeticId(DEFAULT_AVATAR.hat!) === DEFAULT_LOOK.hat, JSON.stringify(fl));
  check('nothing in the catalogue changes play: only the five look slots', COSMETICS.every(d => ['skin', 'landing', 'foundation', 'flag', 'hat'].includes(d.slot)));
}

// ---------------------------------------------------------------- the one Supporter offer

{
  const offer = (owned: string[]) => supporterOffer(owned)?.id ?? null;
  check('owning neither: the full pack at $12.99', offer([]) === 'supporter_pack' && product('supporter_pack')!.cents === 1299);
  check('owning the pass: the upgrade for the difference ($12.99 - $4.99 = $8.00, store tier $7.99)', offer(['builders_pass']) === 'supporter_upgrade_pass' && product('supporter_upgrade_pass')!.cents === 799);
  check('owning Remove Ads: $12.99 - $7.99 = $5.00, tier $4.99', offer(['remove_ads', 'portrait_disco']) === 'supporter_upgrade_ads' && product('supporter_upgrade_ads')!.cents === 499);
  check('owning both: never under $0.99', offer(['builders_pass', 'remove_ads']) === 'supporter_upgrade_both' && product('supporter_upgrade_both')!.cents === 99);
  check('a supporter sees no offer', offer(['supporter_pack']) === null && offer(['supporter_upgrade_both', 'builders_pass']) === null);
  check('every upgrade costs no more than the pack minus what it replaces, and at least $0.99',
    (product('supporter_upgrade_pass')!.cents <= 1299 - 499) && (product('supporter_upgrade_ads')!.cents <= 1299 - 799) && PRODUCTS.filter(p => p.owns).every(p => p.cents >= 99));
}

// ---------------------------------------------------------------- ads between runs

{
  const s = freshAds();
  const now = at('2026-10-23T12:00:00');
  check('the plan\'s numbers: 6 minutes, 8 a day, level 3', ADS.gapMs === 6 * MIN && ADS.perDay === 8 && ADS.minLevel === 3);
  check('no ad below level 3', adCheck({ ...s, runMs: 60 * MIN }, { level: 2, noAds: false, now }) === 'level');
  addRunTime(s, 30 * MIN, 2);
  check('time played below level 3 doesn\'t count toward the first ad', s.runMs === 0);
  addRunTime(s, 3 * MIN, 3);
  check('a 3-minute run at level 3: not due yet', adCheck(s, { level: 3, noAds: false, now }) === 'time');
  addRunTime(s, 2.5 * MIN, 3);
  check('5.5 minutes: still not due (two short runs bring about one ad)', adCheck(s, { level: 3, noAds: false, now }) === 'time');
  addRunTime(s, 0.5 * MIN, 3);
  check('6 minutes of run time: due', adCheck(s, { level: 3, noAds: false, now }) === 'due');
  check('Remove Ads: never', adCheck(s, { level: 30, noAds: true, now }) === 'noads');
  check('an ad that didn\'t load stays due (nothing changes until one shows)', adCheck(s, { level: 3, noAds: false, now }) === 'due');
  adShown(s, now);
  check('once shown, the gap starts again', s.runMs === 0 && s.today === 1 && s.day === localDay(now) && adCheck(s, { level: 3, noAds: false, now }) === 'time');
  for (let i = 1; i < 8; i++) { addRunTime(s, 10 * MIN, 5); adShown(s, now); }
  addRunTime(s, 10 * MIN, 5);
  check('at most 8 in a day', s.today === 8 && adCheck(s, { level: 5, noAds: false, now }) === 'cap');
  const tomorrow = at('2026-10-24T08:00:00');
  check('the next local day starts a new count', adCheck(s, { level: 5, noAds: false, now: tomorrow }) === 'due');
  adShown(s, tomorrow);
  check('and counts from one', s.today === 1 && s.day === localDay(tomorrow) && s.total === 9);
  const quick = freshAds();
  for (let i = 0; i < 20; i++) addRunTime(quick, 15_000, 4);
  check('twenty quick 15-second fails bring no ad: only 5 minutes of play', adCheck(quick, { level: 4, noAds: false, now }) === 'time');
  const damaged = loadAds({ runMs: -5, day: 7, today: 'x', total: NaN });
  check('a damaged save starts fresh', damaged.runMs === 0 && damaged.day === '' && damaged.today === 0 && damaged.total === 0);
  const kept = loadAds(JSON.parse(JSON.stringify({ runMs: 120_000, day: '2026-10-23', today: 3, total: 40 })));
  check('a saved meter comes back as it was', kept.runMs === 120_000 && kept.day === '2026-10-23' && kept.today === 3 && kept.total === 40);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
