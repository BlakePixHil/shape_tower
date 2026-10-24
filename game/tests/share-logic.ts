// Sharing, the store's rating card and the play stats in Node (launch marketing plan): the text line and
// its squares and link, the card's postmark, when the game asks for a rating, and how a stats batch is
// cleaned (the server keeps nothing it doesn't know). The browser side is tests/share-check.mjs.
// Run: npm run share:check

import { BIOME_SQUARES, SHARE_BASE, checkpointSquares, shareHeadline, shareLink, sharePostmark, shareText } from '../src/meta/share.ts';
import { REVIEW_GAP_DAYS, REVIEW_MAX, happyMoment, loadReview, markAsked, shouldAskReview, type ReviewMoment } from '../src/meta/review.ts';
import { MAX_BATCH, cleanBatch, cleanEvent, statsId } from '../src/meta/stats.ts';
import { playerId } from '../src/meta/ladder.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------- the text line

const daily = { mode: 'daily' as const, height: 38.27, checkpoints: 9, daily: 47 };
check('Daily headline reads like the plan: "Shape Tower Daily #47: 38.2 m, 9 checkpoints"', shareHeadline(daily) === 'Shape Tower Daily #47: 38.2 m, 9 checkpoints', shareHeadline(daily));
check('a practice run says so', shareHeadline({ ...daily, practice: true }) === 'Shape Tower Daily #47 (practice): 38.2 m, 9 checkpoints', shareHeadline({ ...daily, practice: true }));
check('Endless with a new best, one checkpoint', shareHeadline({ mode: 'endless', height: 12, checkpoints: 1, newBest: true }) === 'Shape Tower: 12.0 m, 1 checkpoint (new best!)');
check('Zen', shareHeadline({ mode: 'zen', height: 5.55, checkpoints: 0 }) === 'Shape Tower Zen: 5.5 m, 0 checkpoints');
check('heights round down, never up (38.29 is 38.2, not 38.3)', shareHeadline({ ...daily, height: 38.29 }).includes('38.2 m'));
check('one square per checkpoint in its biome: 2 Meadow, 2 Treetops, 2 Cloudlands, 1 Storm Belt', checkpointSquares(7) === '🟩🟩🟫🟫⬜⬜🟪', checkpointSquares(7));
check('no checkpoints, no squares', checkpointSquares(0) === '');
const tall = checkpointSquares(34).split('\n');
check('rows of 10, three at most, then "+N"', tall.length === 3 && [...tall[0]].length === 10 && [...tall[1]].length === 10 && tall[2].endsWith(' +4'), JSON.stringify(tall));
check('Deep Cosmos claims are stars', checkpointSquares(24).endsWith(BIOME_SQUARES[10]), checkpointSquares(24));
check('the Daily links to its own page with the height to beat', shareLink(daily) === `${SHARE_BASE}/d/47?h=38.2`, shareLink(daily));
check('Endless links to the game\'s page', shareLink({ mode: 'endless', height: 3.04, checkpoints: 0 }) === `${SHARE_BASE}/?h=3.0`);
const text = shareText(daily);
check('the whole text: headline, squares, link, nothing else', text === `Shape Tower Daily #47: 38.2 m, 9 checkpoints\n🟩🟩🟫🟫⬜⬜🟪🟪🟦\n${SHARE_BASE}/d/47?h=38.2`, text);
check('no squares line when there were no checkpoints', shareText({ mode: 'endless', height: 2, checkpoints: 0 }).split('\n').length === 2);
check('public copy never names other games', !/tetris|jenga/i.test(text + shareText({ mode: 'endless', height: 1, checkpoints: 0 })));
check('the card\'s postmark: "DAILY #47" for the Daily', sharePostmark(daily) === 'DAILY #47');
check('and the date otherwise', sharePostmark({ mode: 'endless', height: 1, checkpoints: 0 }, new Date(2026, 9, 24)) === '24 OCT 2026', sharePostmark({ mode: 'endless', height: 1, checkpoints: 0 }, new Date(2026, 9, 24)));

// ---------------------------------------------------------------- the rating card

const happy: ReviewMoment = { mode: 'endless', newBest: true, checkpoints: 3, quit: false, runs: 12, level: 5 };
const T = Date.parse('2026-11-20T10:00:00Z'), DAY = 86_400_000;
check('a new Endless best is a happy moment', happyMoment(happy));
check('a run without a new best isn\'t', !happyMoment({ ...happy, newBest: false }));
check('a quit never is, nor Zen', !happyMoment({ ...happy, quit: true }) && !happyMoment({ ...happy, mode: 'zen' }));
check('a scored Daily try with a checkpoint is', happyMoment({ ...happy, mode: 'daily', scored: true, newBest: false, checkpoints: 1 }));
check('Daily practice and a scored try with no checkpoint aren\'t', !happyMoment({ ...happy, mode: 'daily', scored: false, checkpoints: 4 }) && !happyMoment({ ...happy, mode: 'daily', scored: true, checkpoints: 0 }));
const st = loadReview(null);
check('not before 8 runs and level 3', !shouldAskReview(st, { ...happy, runs: 7 }, T) && !shouldAskReview(st, { ...happy, level: 2 }, T));
check('asks after a happy moment with enough play behind it', shouldAskReview(st, happy, T));
markAsked(st, T);
check(`then not again for ${REVIEW_GAP_DAYS} days`, !shouldAskReview(st, happy, T + (REVIEW_GAP_DAYS - 1) * DAY) && shouldAskReview(st, happy, T + REVIEW_GAP_DAYS * DAY));
markAsked(st, T + 100 * DAY);
markAsked(st, T + 200 * DAY);
check(`and ${REVIEW_MAX} times at most, ever`, !shouldAskReview(st, happy, T + 400 * DAY), JSON.stringify(st));
check('a stored state is read back, junk dropped', loadReview({ asked: [T, 'x', null, T + 1] }).asked.length === 2 && loadReview('nope').asked.length === 0);

// ---------------------------------------------------------------- the stats batch

const NOW = Date.parse('2026-11-20T10:00:00Z');
const key = 'ab'.repeat(32);
const sid = await statsId(key);
check('the stats id is 24 hex, the same every time for a key', /^[0-9a-f]{24}$/.test(sid) && sid === await statsId(key));
check('and it isn\'t the ladder id, so stats can\'t be matched to a ladder name', sid !== await playerId(key));
const good = { id: sid, p: 'android', b: 'abc1234', events: [
  { e: 'first_open', t: NOW - 1000 }, { e: 'session', t: NOW - 900, lv: 4 }, { e: 'run_end', t: NOW - 500, m: 'daily', lv: 4, cp: 6, h: 41.26 },
  { e: 'share', t: NOW - 400, m: 'daily', ok: true }, { e: 'review', t: NOW - 300 },
] };
const b = cleanBatch(good, NOW);
check('a good batch is taken whole', b?.events.length === 5 && b.p === 'android' && b.b === 'abc1234', JSON.stringify(b));
check('heights keep one decimal; ok becomes 1', b?.events[2].e === 'run_end' && b.events[2].h === 41.3 && b.events[3].e === 'share' && b.events[3].ok === 1, JSON.stringify(b?.events));
check('a bad id refuses the batch', cleanBatch({ ...good, id: 'player-1' }, NOW) === null && cleanBatch({ ...good, id: sid.toUpperCase() }, NOW) === null);
check('an unknown platform counts as web; a build is cut to plain characters', cleanBatch({ ...good, p: 'toaster', b: '<b>x</b>' }, NOW)?.p === 'web' && cleanBatch({ ...good, b: '<b>x</b>' }, NOW)?.b === 'bxb');
check('unknown events, unknown modes and extra fields are dropped', cleanBatch({ ...good, events: [{ e: 'purchase', t: NOW }, { e: 'run_end', t: NOW, m: 'hard', lv: 1, cp: 1, h: 1 }, { e: 'review', t: NOW, email: 'x@y.z' }] }, NOW)?.events.length === 1
  && !('email' in (cleanBatch({ ...good, events: [{ e: 'review', t: NOW, email: 'x@y.z' }] }, NOW)?.events[0] ?? {})));
check('events older than 14 days or from the future are dropped; a little clock skew is taken as now', cleanEvent({ e: 'review', t: NOW - 15 * DAY }, NOW) === null && cleanEvent({ e: 'review', t: NOW + 3600_000 }, NOW) === null && cleanEvent({ e: 'review', t: NOW + 60_000 }, NOW)?.t === NOW);
check('numbers are clamped', (cleanEvent({ e: 'run_end', t: NOW, m: 'endless', lv: -4, cp: 1e9, h: 'tall' }, NOW) as { lv: number; cp: number; h: number }).cp === 999);
check(`at most ${MAX_BATCH} events a batch`, cleanBatch({ ...good, events: Array.from({ length: 80 }, () => ({ e: 'review', t: NOW })) }, NOW)?.events.length === MAX_BATCH);
check('"forget" carries no events', JSON.stringify(cleanBatch({ ...good, forget: true }, NOW)?.events) === '[]' && cleanBatch({ ...good, forget: true }, NOW)?.forget === true);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
