// The ladder server's rules without a network (gameplay.md §12.3): names are claimed once and checked,
// renames wait a week, submissions are believable and only grow, the ladder ranks by height, three
// reports hide a name, a player can delete themselves, and two phones writing at once lose nothing.
// Runs on the memory store, then (argument "sql") on SQLite as the live server keeps it.
// Run: npm run api:check (in online/)

import { DatabaseSync } from 'node:sqlite';
import { handle } from '../src/handler.ts';
import { SqlStore, type Sql } from '../src/sql.ts';
import { MemoryStore, type Store } from '../src/store.ts';
import { playerId } from '../../game/src/meta/ladder.ts';
import type { LadderReply, LadderRequest, Me } from '../../game/src/online/protocol.ts';
import type { LadderView, Submission } from '../../game/src/meta/ladder.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

const T0 = Date.parse('2026-10-22T09:00:00Z');
const DAY = '2026-10-22';
const key = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const err = (r: LadderReply) => ('error' in r ? r.error : null);
const me = (r: LadderReply): Me | null => ('me' in r ? r.me : null);
const view = (r: LadderReply): LadderView | null => ('view' in r ? r.view : null);
const sub = (height: number, o: Partial<Submission> = {}): Submission => ({ day: DAY, height, score: height * 100, checkpoints: Math.floor(height / 8), finished: false, startedAt: T0, ...o });

const useSql = process.argv[2] === 'sql';
console.log(`-- ${useSql ? 'SQLite' : 'memory'} store`);
/** SQLite in memory, counting the rows each statement hands back. */
function sqlite(): { sql: Sql; rowsRead: () => number } {
  const db = new DatabaseSync(':memory:');
  let read = 0;
  const sql: Sql = (q, ...b) => {
    const rows = db.prepare(q).all(...b) as Record<string, string | number | null>[];
    read += rows.length;
    return rows;
  };
  return { sql, rowsRead: () => read };
}
const fresh = (): Store => (useSql ? new SqlStore(sqlite().sql) : new MemoryStore());
let store = fresh();
const call = (req: LadderRequest, now = T0 + 600_000, s: Store = store) => handle(req, s, now);

// ---------------------------------------------------------------- names

{
  const a = key(1);
  check('a new device has no name', me(await call({ op: 'me', key: a }))?.name === null);
  check('a bad key is refused', err(await call({ op: 'me', key: 'nope' })) === 'nokey' && err(await call({ op: 'name', name: 'Stacker' })) === 'nokey');
  check('a rude name is refused', err(await call({ op: 'name', key: a, name: 'shitstacker' })) === 'blocked');
  check('a short or odd name is refused', err(await call({ op: 'name', key: a, name: 'ab' })) === 'short' && err(await call({ op: 'name', key: a, name: 'a@b.com' })) !== null);
  check('a reserved name is refused', err(await call({ op: 'name', key: a, name: 'Admin' })) === 'reserved');
  const r = me(await call({ op: 'name', key: a, name: '  Tower  Tess ', look: { portrait: 'sunset', avatar: { shape: 'T', face: 'grin', hat: null } } }));
  check('a good name is claimed, tidied, with its look', r?.name === 'Tower Tess' && r.portrait === 'sunset' && r.avatar.shape === 'T' && r.avatar.hat === null, JSON.stringify(r));
  check('the id is the hash of the key', r?.id === await playerId(a));
  check('another device can\'t take the same name, in any case or look-alike spelling',
    err(await call({ op: 'name', key: key(2), name: 'tower tess' })) === 'taken' && err(await call({ op: 'name', key: key(2), name: 'T0wer_Tess' })) === 'taken');
  check('the holder can change its capitals at once', me(await call({ op: 'name', key: a, name: 'TOWER TESS' }))?.name === 'TOWER TESS');
  check('a new name waits a week', err(await call({ op: 'name', key: a, name: 'Brick Queen' })) === 'renamed');
  const later = me(await call({ op: 'name', key: a, name: 'Brick Queen' }, T0 + 8 * 86_400_000));
  check('after a week it changes and frees the old one', later?.name === 'Brick Queen' && me(await call({ op: 'name', key: key(2), name: 'Tower Tess' }, T0 + 8 * 86_400_000))?.name === 'Tower Tess');
  check('an unknown portrait falls back to the one they had', me(await call({ op: 'look', key: a, look: { portrait: 'gold_bars_for_sale', avatar: { shape: '<b>' } } }))?.portrait === 'sunset');
}

// ---------------------------------------------------------------- submissions

store = fresh();
{
  const a = key(1), b = key(2);
  check('no name, no ladder', err(await call({ op: 'submit', key: a, sub: sub(10) })) === 'noname');
  await call({ op: 'name', key: a, name: 'Tower Tess' });
  await call({ op: 'name', key: b, name: 'Plank Pete' });
  check('a believable try is taken', 'ok' in await call({ op: 'submit', key: a, sub: sub(40) }));
  check('a climb faster than anyone can stack is refused', err(await call({ op: 'submit', key: b, sub: sub(1500) })) === 'implausible');
  check('a malformed one is refused', err(await call({ op: 'submit', key: b, sub: { ...sub(10), height: -1 } })) === 'bad' && err(await call({ op: 'submit', key: b, sub: { ...sub(10), height: NaN } })) === 'bad'
    && err(await call({ op: 'submit', key: b })) === 'bad');
  check('a day not yet open is closed', err(await call({ op: 'submit', key: b, sub: sub(10, { day: '2026-10-24', startedAt: Date.parse('2026-10-24T10:00:00Z') }) })) === 'closed');
  check('a try can\'t start before its day', err(await call({ op: 'submit', key: b, sub: sub(10, { startedAt: T0 - 86_400_000 }) })) === 'early');
  check('yesterday\'s try may finish just after midnight', 'ok' in await call({ op: 'submit', key: b, sub: sub(30, { day: '2026-10-21', startedAt: Date.parse('2026-10-21T23:50:00Z'), finished: true }) }, Date.parse('2026-10-22T00:20:00Z'))
    && err(await call({ op: 'submit', key: b, sub: sub(31, { day: '2026-10-21', startedAt: Date.parse('2026-10-21T23:50:00Z') }) }, Date.parse('2026-10-22T03:00:00Z'))) === 'closed');
  await call({ op: 'submit', key: a, sub: sub(20) });
  let v = view(await call({ op: 'ladder', day: DAY, id: await playerId(a) }));
  check('progress never goes down', v?.me?.height === 40, String(v?.me?.height));
  await call({ op: 'submit', key: a, sub: sub(55.55, { finished: true }) });
  check('a finished try freezes', err(await call({ op: 'submit', key: a, sub: sub(80) })) === 'finished');
  v = view(await call({ op: 'ladder', day: DAY, id: await playerId(a) }));
  check('heights keep one decimal and the finish is kept', v?.me?.height === 55.6 && v.me.finished, JSON.stringify(v?.me));
}

// ---------------------------------------------------------------- ranking

store = fresh();
{
  const names = ['Ann Stack', 'Bob Brick', 'Cy Crane', 'Di Domino', 'Ed Edge'];
  const heights = [50, 70, 70, 20, 70];
  const scores = [9000, 7000, 8000, 3000, 7000];
  for (let i = 0; i < names.length; i++) {
    await call({ op: 'name', key: key(i + 1), name: names[i] });
    await call({ op: 'submit', key: key(i + 1), sub: sub(heights[i], { score: scores[i], startedAt: T0 + i * 1000 }) });
  }
  const v = view(await call({ op: 'ladder', day: DAY, id: await playerId(key(4)) }))!;
  const order = v.top.map(r => `${r.rank}.${r.name}`).join(' ');
  check('highest first; equal heights by score; full ties share a rank, the earlier starter first', order === '1.Cy Crane 2.Bob Brick 2.Ed Edge 4.Ann Stack 5.Di Domino', order);
  check('the player\'s own row is picked out', v.me?.name === 'Di Domino' && v.me.rank === 5 && v.total === 5);
  check('a day nobody played is empty', view(await call({ op: 'ladder', day: '2026-10-23' }))?.total === 0);
  check('reading the ladder needs no key', view(await call({ op: 'ladder', day: DAY }))?.me === null);
  check('a bad day is refused', err(await call({ op: 'ladder', day: '../players/x' })) === 'bad');
}

// ---------------------------------------------------------------- reports and restyle

store = fresh();
{
  const target = key(9), targetId = await playerId(target);
  await call({ op: 'name', key: target, name: 'Sneaky Sid' });
  await call({ op: 'submit', key: target, sub: sub(30) });
  check('nobody can report themselves', err(await call({ op: 'report', key: target, target: targetId })) === 'self');
  check('a device with no name can\'t report', err(await call({ op: 'report', key: key(1), target: targetId })) === 'noname');
  for (let i = 1; i <= 3; i++) await call({ op: 'name', key: key(i), name: `Judge ${'ABC'[i - 1]}` });
  await call({ op: 'report', key: key(1), target: targetId });
  await call({ op: 'report', key: key(1), target: targetId });
  await call({ op: 'report', key: key(2), target: targetId });
  let row = view(await call({ op: 'ladder', day: DAY }))!.top[0];
  check('two different reporters (one reporting twice) don\'t hide a name', row.name === 'Sneaky Sid' && !row.hidden);
  await call({ op: 'report', key: key(3), target: targetId });
  row = view(await call({ op: 'ladder', day: DAY }))!.top[0];
  const sid = me(await call({ op: 'me', key: target }));
  check('the third hides it on the ladder and the name never leaves the server', row.hidden === true && row.name === '' && row.height === 30, JSON.stringify(row));
  check('its owner is told', sid?.hidden === true);
  check('a hidden name may be replaced at once, which clears the reports', me(await call({ op: 'name', key: target, name: 'Nice Sid' }))?.hidden === false);
  row = view(await call({ op: 'ladder', day: DAY }))!.top[0];
  check('today\'s row takes the new name', row.name === 'Nice Sid' && !row.hidden, JSON.stringify(row));
  const rowPath = `ladder/${DAY}/${targetId}`;
  const etag = (await store.get(rowPath))!.etag;
  await call({ op: 'name', key: target, name: 'Nice Sid' });
  check('picking the same name again doesn\'t rewrite the ladder', (await store.get(rowPath))!.etag === etag);
  await call({ op: 'look', key: target, look: { portrait: 'nightsky', avatar: { shape: 'L', face: 'idle', hat: 'crown' } } });
  row = view(await call({ op: 'ladder', day: DAY }))!.top[0];
  check('a new look reaches today\'s row', row.portrait === 'nightsky' && row.avatar.shape === 'L');
  // A name stored before the filter learned a word still never shows.
  await store.put(rowPath, { ...(await store.get<object>(rowPath))!.data, name: 'shitstack' });
  check('a stored name the filter now refuses is blanked', view(await call({ op: 'ladder', day: DAY }))!.top[0].name === '');
}

// ---------------------------------------------------------------- forget

store = fresh();
{
  const a = key(5), id = await playerId(a);
  await call({ op: 'name', key: a, name: 'Gone Gwen' });
  await call({ op: 'submit', key: a, sub: sub(30) });
  await call({ op: 'submit', key: a, sub: sub(20, { day: '2026-10-21', startedAt: Date.parse('2026-10-21T23:00:00Z') }) }, Date.parse('2026-10-22T00:30:00Z'));
  check('delete me answers ok', 'ok' in await call({ op: 'forget', key: a }));
  check('their rows are gone from every day', view(await call({ op: 'ladder', day: DAY }))!.total === 0 && view(await call({ op: 'ladder', day: '2026-10-21' }))!.total === 0);
  check('their name is free and nothing about them is kept', me(await call({ op: 'name', key: key(6), name: 'Gone Gwen' }))?.name === 'Gone Gwen'
    && !(await store.list('')).some(d => JSON.stringify(d.data).includes(id)));
  check('deleting twice is harmless', 'ok' in await call({ op: 'forget', key: a }));
}

// ---------------------------------------------------------------- two phones at once

store = fresh();
{
  const n = 12;
  const racers = ['Ada', 'Bea', 'Cal', 'Dot', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jem', 'Kit', 'Lux'];
  for (let i = 0; i < n; i++) await call({ op: 'name', key: key(i + 1), name: `Racer ${racers[i]}` });
  // A store that hands back stale versions half the time, like two functions racing.
  const racy: Store = {
    get: p => store.get(p),
    put: async (p, d, o) => (Math.random() < 0.3 ? false : store.put(p, d, o)),
    del: p => store.del(p),
    list: p => store.list(p),
  };
  await Promise.all(Array.from({ length: n }, (_, i) => call({ op: 'submit', key: key(i + 1), sub: sub(10 + i) }, T0 + 600_000, racy)));
  const v = view(await call({ op: 'ladder', day: DAY }))!;
  check('twelve submissions at once all land', v.total === n, `${v.total} of ${n}`);
  const both = await Promise.all([call({ op: 'name', key: key(50), name: 'Same Sam' }), call({ op: 'name', key: key(51), name: 'Same Sam' })]);
  check('two devices claiming one name: exactly one gets it', both.filter(r => me(r)?.name === 'Same Sam').length === 1 && both.filter(r => err(r) === 'taken').length === 1);
}

// ---------------------------------------------------------------- SQLite: kept, and read once

if (useSql) {
  const db = sqlite();
  const a = key(1);
  let s: Store = new SqlStore(db.sql);
  await call({ op: 'name', key: a, name: 'Tower Tess' }, T0 + 600_000, s);
  const crew = 'Ada Bea Cal Dot Eve Fay Gus Hal Ivy Jem Kit Lux Max Ned Oz Pip Quin Rex Sue Tod Uma Vic Wes Xia Yan Zed Ari Bo Cy'.split(' ');
  for (let i = 2; i <= 30; i++) {
    await call({ op: 'name', key: key(i), name: `Climber ${crew[i - 2]}` }, T0 + 600_000, s);
    await call({ op: 'submit', key: key(i), sub: sub(i) }, T0 + 600_000, s);
  }
  await call({ op: 'submit', key: a, sub: sub(45) }, T0 + 600_000, s);
  // A Durable Object restarts with nothing in memory: everything must come back from the table.
  s = new SqlStore(db.sql);
  const v = view(await call({ op: 'ladder', day: DAY, id: await playerId(a) }, T0 + 600_000, s))!;
  check('a restarted server has every row', v.total === 30 && v.top[0].name === 'Tower Tess' && v.me?.rank === 1, `${v.total} rows`);
  const before = db.rowsRead();
  for (let i = 0; i < 5; i++) await call({ op: 'ladder', day: DAY }, T0 + 600_000, s);
  check('looking again reads no rows', db.rowsRead() === before, `${db.rowsRead() - before} rows`);
  await call({ op: 'submit', key: key(2), sub: sub(60) }, T0 + 600_000, s);
  const after = view(await call({ op: 'ladder', day: DAY }, T0 + 600_000, s))!;
  check('a new height shows at once', after.top[0].height === 60 && after.total === 30);
  const first = await s.put('t/x', 1, { create: true }), second = await s.put('t/x', 2, { create: true });
  check('creating twice is refused the second time', first && !second);
  const t = (await s.get<number>('t/x'))!;
  check('writes only land on the version read', (await s.put('t/x', 3, { ifMatch: t.etag })) && !(await s.put('t/x', 4, { ifMatch: t.etag })) && (await s.get<number>('t/x'))!.data === 3);
}

check('unknown ops are refused', err(await call({ op: 'explode' as never, key: key(1) })) === 'badop' && err(await call(null as never)) === 'badop');

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
