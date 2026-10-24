// The live check (GET /selftest): the real Worker code and a real Durable Object with its SQLite database,
// on a scratch copy of the ladder that starts and ends empty, so the real ladder is only ever read.
// Racing phones included. Answers { pass, out: [[PASS|FAIL, check, detail on a failure]], ranAt }. It runs at
// most once every 5 minutes; in between it answers the last run again, with cached: true.

import { ladderOf, respond, respondStats, sha256, type Env, type LadderRpc } from './worker.ts';
import { dailyDay } from '../../game/src/meta/daily.ts';

const key = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const URL_ = 'https://selftest.invalid/api/v1';
const GAP_MS = 5 * 60_000;
const json = (body: string) => new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function selftest(env: Env): Promise<Response> {
  const gate = ladderOf(env, 'selftest-gate');
  const at = Date.now();
  const claimed = await gate.claimSelftest(at, GAP_MS);
  if (claimed !== 'go') return json(JSON.stringify({ ...JSON.parse(claimed), cached: true }, null, 1));
  const out: [string, string, string?][] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => out.push(ok ? ['PASS', name] : ['FAIL', name, detail === undefined ? undefined : JSON.stringify(detail)]);
  const scratch: LadderRpc = ladderOf(env, 'selftest');
  const call = async (body: unknown): Promise<any> => (await respond(new Request(URL_, { method: 'POST', body: JSON.stringify(body) }), scratch)).json();
  try {
    await scratch.wipe();
    const now = Date.now(), day = dailyDay(new Date(now));

    const info = await respond(new Request(URL_), scratch);
    check('says what it is', info.status === 200 && ((await info.json()) as { service?: string }).service === 'shape-tower-ladder');
    const pre = await respond(new Request(URL_, { method: 'OPTIONS' }), scratch);
    check('lets browsers call it', pre.status === 204 && pre.headers.get('access-control-allow-origin') === '*');
    check('refuses a body too big', (await respond(new Request(URL_, { method: 'POST', body: 'x'.repeat(5000) }), scratch)).status === 413);
    check('refuses a body that isn\'t JSON', (await respond(new Request(URL_, { method: 'POST', body: '{nope' }), scratch)).status === 400);

    const names = ['Ada', 'Bea', 'Cal', 'Dot', 'Eve', 'Fay'];
    const named = await Promise.all(names.map((n, i) => call({ op: 'name', key: key(200 + i), name: `Selftest ${n}` })));
    check('six names at once', named.every(x => x.me), named);
    const subs = await Promise.all(names.map((_, i) => call({ op: 'submit', key: key(200 + i), sub: { day, height: 5 + i, score: 100 * i, checkpoints: 0, finished: false, startedAt: now - 60_000 } })));
    check('six submissions at once all land', subs.every(x => x.ok), subs);
    const v = await (await respond(new Request(`${URL_}?day=${day}&id=${named[0].me?.id}`), scratch)).json() as { view?: { total: number; top: { name: string }[]; me: { name: string } | null } };
    check('all six ranked, highest first', v.view?.total === 6 && v.view.top[0].name === 'Selftest Fay' && v.view.me?.name === 'Selftest Ada', v);
    const both = await Promise.all([call({ op: 'name', key: key(220), name: 'Selftest Same' }), call({ op: 'name', key: key(221), name: 'Selftest Same' })]);
    check('one of two racing claims wins', both.filter(x => x.me).length === 1 && both.filter(x => x.error === 'taken').length === 1, both);
    check('a rude name is refused', (await call({ op: 'name', key: key(222), name: 'shitstacker' })).error === 'blocked');
    check('a climb nobody could make is refused', (await call({ op: 'submit', key: key(200), sub: { day, height: 900, score: 1, checkpoints: 0, finished: false, startedAt: now - 60_000 } })).error === 'implausible');

    // The play stats, on the scratch copy too: a phone's batch becomes counts, and the summary needs its key.
    const SK = 'selftest-read-key', skHash = await sha256(SK), STATS = 'https://selftest.invalid/api/v1/stats';
    const batch = { id: 'ab'.repeat(12), p: 'android', b: 'selftest', events: [
      { e: 'first_open', t: now }, { e: 'session', t: now, lv: 1 }, { e: 'run_end', t: now, m: 'daily', lv: 2, cp: 2, h: 12.3 }, { e: 'share', t: now, m: 'daily', ok: 1 },
    ] };
    const taken = await respondStats(new Request(STATS, { method: 'POST', body: JSON.stringify(batch) }), scratch, skHash);
    check('stats: a phone\'s batch is taken', taken.status === 200);
    check('stats: a batch without a good id isn\'t', (await respondStats(new Request(STATS, { method: 'POST', body: JSON.stringify({ ...batch, id: 'nope' }) }), scratch, skHash)).status === 400);
    check('stats: the summary needs its key', (await respondStats(new Request(`${STATS}?key=wrong`), scratch, skHash)).status === 403);
    const sum = await (await respondStats(new Request(`${STATS}?key=${SK}&days=2`), scratch, skHash)).json() as { days?: { day: string; counts: Record<string, number> }[]; devices?: { android: number } };
    const c = sum.days?.find(x => x.day === day)?.counts ?? {};
    check('stats: one install, one active device, a Daily run and a share counted', c.installs === 1 && c.active === 1 && c['runs:daily'] === 1 && c['shared:daily'] === 1 && sum.devices?.android === 1, sum);

    // Leave the scratch copy empty.
    await scratch.wipe();
    check('wiped clean', (await call({ op: 'ladder', day })).view?.total === 0);

    const real = await respond(new Request(`${URL_}?day=${day}`), ladderOf(env));
    const rv = await real.json() as { view?: { day: string } };
    check('the real ladder answers', real.status === 200 && rv.view?.day === day, rv.view ? undefined : rv);
  } catch (e) {
    check('no errors', false, String((e as Error)?.stack ?? e));
  }
  const body = JSON.stringify({ pass: out.every(c => c[0] === 'PASS'), out, ranAt: new Date(at).toISOString() }, null, 1);
  await gate.keepSelftest(at, body);
  return json(body);
}
