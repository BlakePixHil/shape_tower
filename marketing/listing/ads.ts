// The words for a Google Ads App campaign (installs): Google builds each ad from these, the store
// listing and the images and videos that scripts/ads.ts makes. Every fact here is in the game as built.
// Google's limits: up to 5 headlines of 30 characters and 5 descriptions of 90. Its editorial rules
// refuse an exclamation mark in a headline, words in capitals for emphasis and gimmicky punctuation,
// so none of that here either. Public words never name another company's game.

export interface AdText { headlines: string[]; descriptions: string[] }

export const AD_TEXT: AdText = {
  headlines: [
    'Stack wobbly shapes sky-high',
    'How high can you stack?',
    'From the meadow to deep space',
    'A new Daily Tower every day',
    'Cute shapes, real physics',
  ],
  descriptions: [
    'Drag, turn and drop wobbly shapes, then hope they hold. A guide shows where each lands.',
    'Climb ten worlds from the meadow to deep space, past gusts, meteors and space junk.',
    'Same shapes for everyone each day. Take your one scored try and top the daily ladder.',
    'Never an ad during a run, and it plays offline. Relax in Zen or chase your best height.',
    'Every landing plays a note, so your tower plays a tune as it grows. Free to play.',
  ],
};

/** The call to action on the ad videos' end cards and the images (the campaign only runs where the game is on Play). */
export const AD_CTA = 'Free on Google Play';

/** Problems with a set of ad words, empty when Google's limits and the naming rule are met. */
export function checkAd(t: AdText): string[] {
  const out: string[] = [];
  const len = (s: string) => [...s].length;
  if (t.headlines.length < 1 || t.headlines.length > 5) out.push(`${t.headlines.length} headlines (1 to 5)`);
  if (t.descriptions.length < 1 || t.descriptions.length > 5) out.push(`${t.descriptions.length} descriptions (1 to 5)`);
  for (const h of t.headlines) {
    if (len(h) > 30) out.push(`headline "${h}" is ${len(h)} characters (30 max)`);
    if (h.includes('!')) out.push(`headline "${h}" has an exclamation mark`);
  }
  for (const d of t.descriptions) {
    if (len(d) > 90) out.push(`description "${d}" is ${len(d)} characters (90 max)`);
    if ((d.match(/!/g) ?? []).length > 1) out.push(`description "${d}" has more than one exclamation mark`);
  }
  for (const s of [...t.headlines, ...t.descriptions, AD_CTA]) {
    if (/tetris|jenga/i.test(s)) out.push(`"${s}" names a trademark`);
    if (/\b[A-Z]{3,}\b/.test(s)) out.push(`"${s}" shouts a word in capitals`);
    if (/…|\.\.\.|[!?]{2,}/.test(s)) out.push(`"${s}" has gimmicky punctuation`);
  }
  if (new Set(t.headlines).size !== t.headlines.length || new Set(t.descriptions).size !== t.descriptions.length) out.push('a line is repeated');
  return out;
}
