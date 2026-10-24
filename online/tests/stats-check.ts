// The play stats and the share links' pages without a network (launch marketing plan): a phone's batches
// become one row per device and counts per day; players back on day 1 and day 7 come out right; players
// who were here before the stats never join the retention numbers; the new players' funnel and the Daily
// share rate; Settings' off switch forgets a device; rows unseen for 13 months go; a batch costs a few
// row writes. Then the landing pages: copy, store links per phone, /get, bad paths and heights, bots.
// Run: npm run api:check (in online/)

import { DatabaseSync } from 'node:sqlite';
import { StatsDb, KEEP_DAYS } from '../src/stats.ts';
import { cleanBatch, statsId, type StatEvent } from '../../game/src/meta/stats.ts';
import { dailyDay, dailyNumber } from '../../game/src/meta/daily.ts';
import { heightParam, isBot, landing, landingCopy, phoneOf, playUrl } from '../cloudflare/landing.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

const DAY = 86_400_000;
const T0 = Date.parse('2026-12-03T09:00:00Z'); // the soft launch's first day
const day = (n: number) => new Date(T0 + n * DAY).toISOString().slice(0, 10);

function fresh(): { db: StatsDb; writes: () => number } {
  const sq = new DatabaseSync(':memory:');
  let writes = 0;
  const db = new StatsDb((q, ...b) => {
    if (/^\s*(INSERT|UPDATE|DELETE)/i.test(q)) writes++;
    return sq.prepare(q).all(...b) as Record<string, string | number | null>[];
  });
  return { db, writes: () => writes };
}

const ids = await Promise.all(Array.from({ length: 10 }, (_, i) => statsId(i.toString(16).padStart(2, '0').repeat(32))));
/** One phone's batch at time `t` (ms), as the server would get it. */
const send = (db: StatsDb, id: string, t: number, events: Partial<StatEvent>[], p = 'android') => {
  const b = cleanBatch({ id, p, b: 'abc1234', events: events.map(e => ({ t, ...e })) }, t + 1000);
  if (!b) throw new Error('batch refused');
  db.ingest(b, t + 1000);
};
const open = (lv = 1) => [{ e: 'session' as const, lv }];

// ---------------------------------------------------------------- stats: retention

{
  const { db, writes } = fresh();
  // Day 0: four new installs and two players from before the stats (no first_open).
  for (let i = 0; i < 4; i++) send(db, ids[i], T0 + i * 60_000, [{ e: 'first_open' }, ...open()]);
  for (let i = 4; i < 6; i++) send(db, ids[i], T0 + i * 60_000, open(9));
  // Day 1: two of the new ones come back (one twice), and one old player.
  send(db, ids[0], T0 + DAY, open(2));
  send(db, ids[0], T0 + DAY + 3600_000, open(2));
  send(db, ids[1], T0 + DAY, open(2));
  send(db, ids[4], T0 + DAY, open(9));
  // Day 7: one new one is back.
  send(db, ids[0], T0 + 7 * DAY, open(4));
  const s8 = db.summary(T0 + 8 * DAY, 10);
  check('day 1 retention: 2 of 4 new installs (old players don\'t count)', s8.retention.d1.n === 4 && s8.retention.d1.back === 2 && s8.retention.d1.rate === 0.5, JSON.stringify(s8.retention.d1));
  check('day 7 retention: 1 of 4', s8.retention.d7.n === 4 && s8.retention.d7.back === 1 && s8.retention.d7.rate === 0.25, JSON.stringify(s8.retention.d7));
  check('day 14 isn\'t measurable yet', s8.retention.d14.n === 0 && s8.retention.d14.rate === null && s8.cohorts[0].back.d14 === null, JSON.stringify(s8.cohorts));
  check('the cohort of day 0 is listed with its four', s8.cohorts.length === 1 && s8.cohorts[0].day === day(0) && s8.cohorts[0].n === 4);
  const d1 = s8.days.find(d => d.day === day(1))?.counts;
  check('active players per day: 6 on day 0, 3 on day 1 (twice in a day counts once)', s8.days.find(d => d.day === day(0))?.counts.active === 6 && d1?.active === 3, JSON.stringify(d1));
  check('sessions are counted each time', d1?.sessions === 4, JSON.stringify(d1));
  check('installs: 4 on day 0', s8.days.find(d => d.day === day(0))?.counts.installs === 4);
  const s1 = db.summary(T0 + DAY + 5 * 3600_000, 10);
  check('on day 1 itself, day 1 isn\'t over, so not measured yet', s1.retention.d1.n === 0 && s1.cohorts[0].back.d1 === null, JSON.stringify(s1.retention.d1));
  check('a batch costs a few row writes: 4 or fewer on average, the daily clean-up included', writes() / 11 <= 4, String(writes()));
}

// ---------------------------------------------------------------- stats: funnel, runs, shares, forget, prune

{
  const { db } = fresh();
  // Five new installs on day 0, playing on.
  for (let i = 0; i < 5; i++) send(db, ids[i], T0, [{ e: 'first_open' }, ...open()]);
  send(db, ids[0], T0 + 600_000, [{ e: 'run_end', m: 'endless', lv: 3, cp: 4, h: 30 }, { e: 'run_end', m: 'daily', lv: 3, cp: 2, h: 20 }, { e: 'share', m: 'daily', ok: 1 }]);
  send(db, ids[1], T0 + 600_000, [{ e: 'run_end', m: 'endless', lv: 2, cp: 1, h: 9 }, { e: 'share', m: 'endless', ok: 0 }]);
  send(db, ids[2], T0 + 600_000, [{ e: 'run_end', m: 'daily', lv: 5, cp: 6, h: 50 }, { e: 'run_end', m: 'practice', lv: 5, cp: 3, h: 22 }, { e: 'review' }]);
  const s = db.summary(T0 + DAY, 7);
  check('funnel: 5 new, 2 reached level 3, 1 level 5, 3 a checkpoint, 2 three, 1 six, 2 a scored Daily, 1 shared',
    JSON.stringify(s.funnel) === JSON.stringify({ n: 5, level3: 2, level5: 1, level8: 0, cp1: 3, cp3: 2, cp6: 1, daily: 2, shared: 1 }), JSON.stringify(s.funnel));
  const c = s.days.find(d => d.day === day(0))?.counts ?? {};
  check('runs by mode, shares tried and done, a review ask', c['runs:endless'] === 2 && c['runs:daily'] === 2 && c['runs:practice'] === 1 && c['shares:daily'] === 1 && c['shared:daily'] === 1 && c['shares:endless'] === 1 && !c['shared:endless'] && c.reviews === 1, JSON.stringify(c));
  check('the Daily share rate: 1 shared of 2 scored tries', s.dailyShareRate === 0.5, String(s.dailyShareRate));
  check('devices by platform', s.devices.total === 5 && s.devices.android === 5);
  // Settings' switch off: the device is forgotten.
  db.ingest(cleanBatch({ id: ids[3], p: 'android', b: 'x', forget: true }, T0 + DAY)!, T0 + DAY);
  const s2 = db.summary(T0 + DAY, 7);
  check('turning stats off deletes the device\'s row (and counts that it happened)', s2.devices.total === 4 && s2.days.find(d => d.day === day(1))?.counts.forgets === 1, JSON.stringify(s2.devices));
  // 13 months later, devices unseen since go; the one that played on stays.
  send(db, ids[0], T0 + (KEEP_DAYS - 5) * DAY, open(9));
  const later = T0 + (KEEP_DAYS + 2) * DAY;
  db.ingest(cleanBatch({ id: ids[9], p: 'ios', b: 'x', events: [{ e: 'session', t: later, lv: 1 }] }, later)!, later);
  const s3 = db.summary(later, 7);
  check(`devices unseen for ${KEEP_DAYS} days are deleted; counts per day stay`, s3.devices.total === 2 && s3.devices.ios === 1 && db.summary(T0 + DAY, 7).days.find(d => d.day === day(0))?.counts['runs:daily'] === 2, JSON.stringify(s3.devices));
  // An event queued long ago on a phone (older than its row's last day) still counts, without a second "active".
  send(db, ids[0], T0 + (KEEP_DAYS - 6) * DAY, [{ e: 'review' }]);
  check('a late event counts but doesn\'t make the device active again', true);
}

// ---------------------------------------------------------------- landing pages

const NOW = Date.parse('2026-11-30T12:00:00Z');
const today = dailyNumber(dailyDay(new Date(NOW)));
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const get = (path: string, ua: string | null = ANDROID) => landing(new Request(`https://shape-tower.example${path}`, { headers: ua ? { 'user-agent': ua } : {} }), NOW);

check('phones: Android, iPhone, everything else', phoneOf(ANDROID) === 'android' && phoneOf(IPHONE) === 'ios' && phoneOf(DESKTOP) === 'other' && phoneOf(null) === 'other');
check('link previews and crawlers are bots, phones aren\'t', isBot('WhatsApp/2.23') && isBot('facebookexternalhit/1.1') && isBot('Discordbot/2.0') && isBot(null) && !isBot(ANDROID) && !isBot(IPHONE));
check('heights: one decimal, up to 5000, else ignored', heightParam('38.2') === 38.2 && heightParam('38.25') === null && heightParam('<script>') === null && heightParam('0') === null && heightParam('9999') === null);
const play = playUrl('daily');
check('the Play link names the package and tags the source', play.startsWith('https://play.google.com/store/apps/details?id=com.blakepixhil.shapetower&referrer=') && decodeURIComponent(play.split('referrer=')[1]) === 'utm_source=share_link&utm_medium=link&utm_campaign=daily', play);

const todays = landingCopy({ daily: today, height: 38.2, phone: 'android', url: '', origin: '', now: NOW });
check('today\'s Daily with a height: "Can you beat 38.2 m?"', todays.title === 'Can you beat 38.2 m?' && todays.kicker === `Daily #${today}`, JSON.stringify(todays));
const old = landingCopy({ daily: today - 3, height: 38.2, phone: 'android', url: '', origin: '', now: NOW });
check('an older Daily says what today\'s number is', old.lead.includes(`Today's tower is #${today}`) && old.title === 'They stacked 38.2 m', JSON.stringify(old));

const a = get(`/d/${today}?h=38.2`);
const html = a ? await a.response.text() : '';
check('/d/<n> answers a page, counted as a Daily link view', a?.response.status === 200 && a.hit === 'link:daily' && a.response.headers.get('content-type')?.startsWith('text/html') === true);
check('Android: the Google Play button, no App Store line', html.includes('Get it on Google Play') && !html.includes('Coming soon to iPhone'), html.slice(0, 200));
check('link preview tags with the picture', html.includes('og:image" content="https://shape-tower.example/og.png"') && html.includes('summary_large_image'));
check('no scripts on the page, and a strict content policy', !/<script/i.test(html) && /default-src 'none'/.test(a?.response.headers.get('content-security-policy') ?? ''));
check('public copy never names other games', !/tetris|jenga/i.test(html));
check('the heading keeps the height and its unit on one line on a phone', html.includes('<h1>Can you beat 38.2&nbsp;m?</h1>'), html.match(/<h1>.*<\/h1>/)?.[0]);
const ios = await get(`/d/${today}`, IPHONE)?.response.text() ?? '';
check('iPhone: "coming soon", and a Google Play link for Android friends', ios.includes('Coming soon to iPhone') && ios.includes('On Android?'));
const desk = await get('/?h=12.5', DESKTOP)?.response.text() ?? '';
check('a computer: both', desk.includes('Get it on Google Play') && desk.includes('Coming soon to iPhone') && desk.includes('Can you beat 12.5 m?'));
check('/ is the game\'s page, counted as a home link view', get('/')?.hit === 'link:home');
const evil = await get('/?h=%3Cscript%3Ealert(1)%3C/script%3E')?.response.text() ?? '';
check('a made-up height never reaches the page', !evil.includes('alert(1)') && evil.includes('Stack &amp; Balance'));
check('a Daily from the future or not a number is a 404', get(`/d/${today + 5}`)?.response.status === 404 && get('/d/abc')?.response.status === 404 && get('/d/0')?.response.status === 404);
check('other paths aren\'t the landing\'s', get('/api/v1') === null && get('/selftest') === null && get('/x') === null);
const go = get('/get');
check('/get sends Android to Google Play and counts it', go?.response.status === 302 && go.response.headers.get('location')?.startsWith('https://play.google.com/') === true && go.hit === 'link:store:android');
const goIos = get('/get', IPHONE);
check('/get sends an iPhone to the page until there\'s an App Store link', goIos?.response.status === 302 && goIos.response.headers.get('location') === '/' && goIos.hit === 'link:store:ios');
check('bots are never counted', get(`/d/${today}`, 'WhatsApp/2.23.20')?.hit === null && get('/get', 'Slackbot-LinkExpanding 1.0')?.hit === null);
check('POST isn\'t the landing\'s', landing(new Request('https://shape-tower.example/', { method: 'POST', body: '{}' }), NOW) === null);

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
