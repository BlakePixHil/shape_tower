// The player's look (monetisation plan v2, cosmetics): five slots from Art's catalogue that change how a
// run looks and nothing else. Four are saved in the profile (skin, landing, foundation, flag); the fifth
// is the avatar's hat, kept as the plain hat key the avatar and the ladder take. What a player owns comes
// from their level and the store: the Builder's Pass gives every pass reward up to their level at once,
// sets and the Supporter Pack their own items. A worn item they no longer own (a refund) shows as the
// default, so nothing here can stay unlocked without its purchase.

import {
  PASS_LAST_NEW, cosmeticOwned, hatCosmeticId, hatFor, ownedLook, passRewardsBetween, slotItems, type CosmeticLook, type CosmeticOwner, type Hat,
} from '@art/index.ts';
import type { Entitlements } from '../meta/shop.ts';
import type { Profile } from './profile.ts';
import type { RunLook } from './scene.ts';

/** What the player owns, as Art's look screens take it. */
export function ownerOf(p: Profile, e: Entitlements): CosmeticOwner {
  return { level: p.level, pass: e.pass, sets: e.sets, supporter: e.supporter };
}

/** The saved picks, all five slots (the hat from the avatar; no hat is null). */
export function lookOf(p: Profile): CosmeticLook {
  return { ...p.look, hat: p.avatar.hat ? hatCosmeticId(p.avatar.hat) : null };
}

/** What the player wears: the saved picks, with anything they don't own as the default. */
export function wornLook(p: Profile, e: Entitlements): Required<CosmeticLook> {
  return ownedLook(lookOf(p), ownerOf(p, e));
}

/** What a run draws. */
export function runLook(p: Profile, e: Entitlements): RunLook {
  const l = wornLook(p, e);
  return { skin: l.skin ?? undefined, landing: l.landing ?? undefined, foundation: l.foundation ?? undefined, flag: l.flag ?? undefined };
}

/** Saves "Your look"'s picks (the hat goes to the avatar). */
export function saveLook(p: Profile, l: CosmeticLook): void {
  p.look = { skin: l.skin ?? p.look.skin, landing: l.landing ?? p.look.landing, foundation: l.foundation ?? p.look.foundation, flag: l.flag ?? p.look.flag };
  p.avatar = { ...p.avatar, hat: l.hat ? hatFor(l.hat) : null };
}

/** The hats owned beyond the level hats (pass rewards reached, sets, the supporter crown), for the avatar picker. */
export function extraHats(o: CosmeticOwner): Hat[] {
  const later = o.pass && o.level > PASS_LAST_NEW ? passRewardsBetween(PASS_LAST_NEW + 1, o.level) : [];
  return [...slotItems('hat'), ...later.filter(d => d.slot === 'hat')]
    .filter(d => d.source !== 'default' && d.source !== 'level' && cosmeticOwned(d.id, o))
    .map(d => hatFor(d.id)).filter((h): h is Hat => !!h);
}
