// The marketing tools' quick check (QA's gate runs it): the listing words fit Play's limits and never
// name another company's game, every caption and post the clips can make passes the same rule, and a
// short bot run still plays and finds its moments with today's sim.
//
//   node --experimental-strip-types scripts/check.ts

import { LISTING, checkListing } from '../listing/text.ts';
import { BANNED, checkWords, clipFor, ctaFor } from '../src/clips.ts';
import { findMoments, playRun, specFor, type Moment } from '../src/runs.ts';
import { SHOTS } from '../listing/shots.ts';

let failed = 0;
const ok = (cond: boolean, what: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) failed++; };

for (const [lang, t] of Object.entries(LISTING)) ok(checkListing(t).length === 0, `${lang} listing: ${checkListing(t).join('; ') || `${[...t.title].length}/${[...t.shortDescription].length}/${[...t.fullDescription].length} characters`}`);
ok(!/practise/.test(LISTING['en-US'].fullDescription), 'en-US uses US spelling');
ok(SHOTS.length === 8 && SHOTS.every(s => s.lines.every(l => !BANNED.test(l.text))), '8 screenshots, captions clean');
ok(ctaFor('2026-11-02').cta.includes('Coming soon') && ctaFor('2026-12-01').cta.includes('Pre-register') && ctaFor('2027-02-04').cta.includes('Free'), 'end card follows the launch dates');

const run = playRun(specFor('endless', 7, 'sloppy', 14, { maxSteps: 3 * 60 * 60 }));
ok(run.steps > 600 && run.inputs.length > 20 && run.digests.length === Math.floor(run.steps / 60), `bot run: ${run.steps} steps, ${run.inputs.length} inputs, ended by ${run.cause}`);
const moments = findMoments(run);
ok(moments.length > 0, `moments: ${moments.map(m => m.kind).join(', ')}`);
// Every format's words, from this run's moments and made-up ones of the kinds it lacks.
const kinds: Moment['kind'][] = ['collapse', 'clutch', 'checkpoint', 'soclose', 'combo', 'climb', 'daily'];
let words = 0;
for (const kind of kinds) for (let n = 0; n < 6; n++) {
  const m = moments.find(x => x.kind === kind) ?? { kind, from: 100, to: 400, score: 1, facts: { checkpoint: 3, near: n % 2 ? 1 : 99, combo: 5, height: 120, number: 15, biome: 'Orbit' } };
  const c = clipFor(run, m, n);
  checkWords(c.text, c.title, ...c.tags, ...c.job.captions.flatMap(x => x.lines.map(l => l.text)));
  words++;
}
ok(words === kinds.length * 6, 'every clip format\'s captions and posts are clean');

if (failed) { console.log(`${failed} failed`); process.exit(1); }
console.log('all good');
