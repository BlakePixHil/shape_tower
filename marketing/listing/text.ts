// The Play store listing's words (marketing plan, "Store listing (ASO)"). en-AU is the default
// language; en-GB uses the same words and en-US the same with US spelling. Google searches the title,
// the short description and the full description, so "stacking game", "balance" and "physics puzzle"
// each come up a couple of times, naturally. Every fact here is in the game as built.

export interface ListingText { title: string; shortDescription: string; fullDescription: string }

const title = 'Shape Tower: Stack & Balance';
const shortDescription = 'Stack wobbly shapes into an endless tower. One sloppy drop can topple it all!';

const full = `Build the tallest tower you can from wobbly, smiling shapes, and watch every drop sway with real physics.

Shape Tower is a stacking game about balance. Drag a shape into place, turn it, drop it, and hope it holds. A guide shows exactly where each shape will land, so every wobble is your own doing. Shapes that rest together bond, and when you reach a checkpoint the tower below turns to stone, safe for good. One sloppy drop above it, though, and the lot comes down.

CLIMB FROM THE MEADOW TO DEEP SPACE
Ten worlds stack up as you climb: Meadow, Treetops, Cloudlands, Storm Belt, Stratosphere, Orbit, the Moon, the Red Planet, a Ringed Giant and Deep Cosmos. Gravity changes as you go, and so do the hazards: gusts, crosswinds, space junk, meteors and dust devils all want your tower on the ground.

A NEW DAILY TOWER EVERY DAY
Everyone gets the same shapes each day. Take your one scored try, see where your height lands on the daily ladder, then practise on it as much as you like.

POWER-UPS AND A SECOND WIND
Steer through bubbles to pick up Glue, Slow-Mo, Quick-Set, Undo and Clean Slate. Earn a Second Wind that sweeps away the wreckage and gives your hearts back when it all goes wrong.

RELAX IN ZEN MODE
No shapes to count and no hearts to lose. Just build, as high as you like.

GROW AS A BUILDER
Earn XP every run and level up to unlock the bag, the Daily Tower, a head-start power-up and Zen mode. Chase 49 achievements, collect a postcard from every world, and dress up your Blocklings with hats, skins, landing bursts, flags and foundations.

A PHYSICS PUZZLE THAT PLAYS NICE
• Plays offline (the daily ladder needs a connection)
• Never an ad during a run
• Every landing plays a note, so your tower plays a tune as it grows
• Settings for reduce motion, screen shake, the landing guide and drag sensitivity

Shape Tower is free to play. Optional purchases are cosmetic or a convenience: no energy, no paid continues, and nothing that stops you playing.`;

/** en-AU and en-GB spelling to en-US. */
const US: [RegExp, string][] = [[/\bpractise\b/g, 'practice']];

export const LISTING: Record<'en-AU' | 'en-GB' | 'en-US', ListingText> = {
  'en-AU': { title, shortDescription, fullDescription: full },
  'en-GB': { title, shortDescription, fullDescription: full },
  'en-US': { title, shortDescription, fullDescription: US.reduce((s, [a, b]) => s.replace(a, b), full) },
};

/** Play's limits, and the naming rule (marketing plan: never another company's game). */
export function checkListing(t: ListingText): string[] {
  const out: string[] = [];
  if ([...t.title].length > 30) out.push(`title is ${[...t.title].length} characters (30 max)`);
  if ([...t.shortDescription].length > 80) out.push(`short description is ${[...t.shortDescription].length} characters (80 max)`);
  if ([...t.fullDescription].length > 4000) out.push(`full description is ${[...t.fullDescription].length} characters (4000 max)`);
  for (const s of [t.title, t.shortDescription, t.fullDescription]) if (/tetris|jenga/i.test(s)) out.push('names a trademark');
  return out;
}
