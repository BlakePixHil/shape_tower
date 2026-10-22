// A live check, deployed only as a preview of the API project (never production): the Blob store's
// conditional writes under a throwaway folder, then the real API end to end over HTTP, racing phones
// included, cleaning up after itself. Deploy this folder with selftest/package.json, then GET /api/selftest.
import { BlobError, BlobPreconditionFailedError, del, get, put } from '@vercel/blob';

const API = 'https://shape-tower-api.vercel.app/api/v1';
const key = n => n.toString(16).padStart(2, '0').repeat(32);
const call = body => fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

export async function GET() {
  const out = [];
  const check = (name, ok, detail) => out.push([ok ? 'PASS' : 'FAIL', name, detail]);
  const root = `selftest-${Date.now().toString(36)}`;
  const file = p => `${root}/${p}.json`;
  const tryPut = async (p, data, o) => {
    try { await put(file(p), JSON.stringify(data), { access: 'private', contentType: 'application/json', addRandomSuffix: false, ...o }); return 'ok'; }
    catch (e) { return e instanceof BlobPreconditionFailedError ? 'precondition' : e instanceof BlobError ? `blob: ${e.message}` : `other: ${e}`; }
  };
  try {
    check('create on an empty path', (await tryPut('a', { n: 1 }, { allowOverwrite: false })) === 'ok');
    const again = await tryPut('a', { n: 2 }, { allowOverwrite: false });
    check('create again is refused', again !== 'ok', again);
    const r = await get(file('a'), { access: 'private', useCache: false });
    const a = JSON.parse(await new Response(r.stream).text());
    check('read back', a.n === 1 && !!r.blob.etag, r.blob.etag);
    const w = await tryPut('a', { n: 3 }, { ifMatch: r.blob.etag });
    check('write if unchanged', w === 'ok', w);
    const stale = await tryPut('a', { n: 4 }, { ifMatch: r.blob.etag });
    check('stale write is refused as a precondition', stale === 'precondition', stale);
    const r2 = await get(file('a'), { access: 'private', useCache: false });
    check('the newer value stays', JSON.parse(await new Response(r2.stream).text()).n === 3);
    await del(file('a'));
    check('a missing blob reads as null', (await get(file('a'), { access: 'private', useCache: false })) === null);

    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
    const names = ['Ada', 'Bea', 'Cal', 'Dot', 'Eve', 'Fay'];
    const named = await Promise.all(names.map((n, i) => call({ op: 'name', key: key(200 + i), name: `Selftest ${n}` })));
    check('six names at once', named.every(x => x.me), JSON.stringify(named));
    const subs = await Promise.all(names.map((_, i) => call({ op: 'submit', key: key(200 + i), sub: { day, height: 5 + i, score: 100 * i, checkpoints: 0, finished: false, startedAt: now - 60_000 } })));
    check('six submissions at once all land', subs.every(x => x.ok), JSON.stringify(subs));
    const v = await call({ op: 'ladder', day, id: named[0].me?.id });
    const mine = (v.view?.top ?? []).filter(x => x.name.startsWith('Selftest'));
    check('all six ranked, highest first', mine.length === 6 && mine[0].name === 'Selftest Fay' && v.view.me?.name === 'Selftest Ada', JSON.stringify(v));
    const both = await Promise.all([call({ op: 'name', key: key(220), name: 'Selftest Same' }), call({ op: 'name', key: key(221), name: 'Selftest Same' })]);
    check('one of two racing claims wins', both.filter(x => x.me).length === 1 && both.filter(x => x.error === 'taken').length === 1, JSON.stringify(both));
    const rude = await call({ op: 'name', key: key(222), name: 'shitstacker' });
    check('a rude name is refused', rude.error === 'blocked', JSON.stringify(rude));
    for (const k of [200, 201, 202, 203, 204, 205, 220, 221, 222]) await call({ op: 'forget', key: key(k) });
    const after = await call({ op: 'ladder', day });
    check('cleaned up', !(after.view?.top ?? []).some(x => x.name.startsWith('Selftest')), JSON.stringify(after));
  } catch (e) {
    check('no errors', false, String(e?.stack ?? e));
  }
  return new Response(JSON.stringify({ pass: out.every(c => c[0] === 'PASS'), out }, null, 1), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}
