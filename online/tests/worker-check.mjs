// The ladder server as Cloudflare runs it, on this machine: wrangler dev (the same workerd runtime, a real
// Durable Object with its SQLite file) answering over HTTP as the game calls it. Runs the live selftest,
// the game's calls, and a restart to show the ladder is kept on disk. Then the play stats (a phone's
// batch, the summary behind its key, kept across the restart) and the share links' pages with their
// picture and the store redirect, counted as visits.
// Run from the repo root: npm ci && npm run ladder:check

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8791;
// The stats summary's read key for this run only (the live one's hash is in worker.ts).
const READ_KEY = 'worker-check-read-key';
const BASE = `http://127.0.0.1:${PORT}`;
const state = mkdtempSync(join(tmpdir(), 'ladder-'));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

let dev = null;
async function start() {
  dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state, '--var', `STATS_READ_SHA256:${createHash('sha256').update(READ_KEY).digest('hex')}`], {
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  let log = '';
  dev.stdout.on('data', d => { log += d; });
  dev.stderr.on('data', d => { log += d; });
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${BASE}/`)).ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`wrangler dev didn't start:\n${log.slice(-2000)}`);
}
async function stop() {
  if (!dev) return;
  try { process.kill(-dev.pid, 'SIGTERM'); } catch { /* gone */ }
  await new Promise(r => setTimeout(r, 1500));
  dev = null;
}
process.on('exit', () => { if (dev) try { process.kill(-dev.pid, 'SIGKILL'); } catch { /* gone */ } rmSync(state, { recursive: true, force: true }); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(1));
process.on('unhandledRejection', e => { console.error(e); process.exit(1); });

const call = async body => {
  const r = await fetch(`${BASE}/api/v1`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, cors: r.headers.get('access-control-allow-origin'), body: await r.json() };
};
const key = n => n.toString(16).padStart(2, '0').repeat(32);

await start();
const st = await (await fetch(`${BASE}/selftest`)).json();
for (const [res, name, detail] of st.out) check(`selftest: ${name}`, res === 'PASS', detail);
check('selftest passes as a whole', st.pass === true && !st.cached);
const again = await (await fetch(`${BASE}/selftest`)).json();
check('a second selftest within 5 minutes answers the last run instead of running', again.cached === true && again.pass === true && again.ranAt === st.ranAt, JSON.stringify(again).slice(0, 200));

const now = Date.now(), day = new Date(now).toISOString().slice(0, 10);
const named = await call({ op: 'name', key: key(1), name: 'Check Charlie' });
check('a name is claimed over HTTP, and browsers may read the answer', named.status === 200 && named.body.me?.name === 'Check Charlie' && named.cors === '*', JSON.stringify(named));
const sub = await call({ op: 'submit', key: key(1), sub: { day, height: 12.34, score: 1234, checkpoints: 1, finished: false, startedAt: now - 120_000 } });
check('a try is submitted', sub.body.ok === true, JSON.stringify(sub));
check('an unknown op is refused', (await call({ op: 'explode', key: key(1) })).body.error === 'badop');
check('another path is not found', (await fetch(`${BASE}/api/v2`)).status === 404);

// The play stats: a phone's batch, then the summary, only with its key.
const STATS = `${BASE}/api/v1/stats`;
const sid = 'cd'.repeat(12);
const batch = await fetch(STATS, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: sid, p: 'android', b: 'check', events: [
  { e: 'first_open', t: now }, { e: 'session', t: now, lv: 2 }, { e: 'run_end', t: now, m: 'daily', lv: 2, cp: 3, h: 21.5 }, { e: 'share', t: now, m: 'daily', ok: 1 },
] }) });
check('stats: a phone\'s batch is taken, and browsers may read the answer', batch.status === 200 && batch.headers.get('access-control-allow-origin') === '*' && (await batch.json()).ok === true);
check('stats: a batch with a bad id is refused', (await fetch(STATS, { method: 'POST', body: JSON.stringify({ id: 'x', events: [] }) })).status === 400);
check('stats: the summary needs its key', (await fetch(STATS)).status === 403 && (await fetch(`${STATS}?key=nope`)).status === 403);
const summary = async () => (await fetch(`${STATS}?key=${READ_KEY}&days=3`)).json();
const sum1 = await summary();
const today1 = sum1.days?.find(d => d.day === day)?.counts ?? {};
check('stats: counted as an install, an active device, a Daily run and a share', today1.installs === 1 && today1.active === 1 && today1['runs:daily'] === 1 && today1['shared:daily'] === 1 && sum1.devices?.android === 1, JSON.stringify(sum1).slice(0, 400));

// The share links' pages (landing.ts), their picture as a static file, and /get; visits counted, bots not.
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const n = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse('2026-10-21T00:00:00Z')) / 86_400_000) + 1;
const page = await fetch(`${BASE}/d/${n}?h=21.5`, { headers: { 'user-agent': ANDROID } });
const html = await page.text();
check('a Daily link opens its page with the height to beat and the Google Play button', page.status === 200 && html.includes(`Daily #${n}`) && html.includes('21.5 m') && html.includes('play.google.com/store/apps/details?id=com.blakepixhil.shapetower'), html.slice(0, 300));
const og = await fetch(`${BASE}/og.png`);
check('the link preview picture is served as a PNG', og.status === 200 && og.headers.get('content-type') === 'image/png' && (await og.arrayBuffer()).byteLength > 10_000);
check('and so is the icon', (await fetch(`${BASE}/icon.png`)).status === 200);
const adsTxt = await fetch(`${BASE}/app-ads.txt`);
check('app-ads.txt names Blake\'s AdMob account, for AdMob\'s seller check', adsTxt.status === 200 && (await adsTxt.text()).trim() === 'google.com, pub-3936557050289022, DIRECT, f08c47fec0942fa0');
const go = await fetch(`${BASE}/get`, { headers: { 'user-agent': ANDROID }, redirect: 'manual' });
check('/get sends Android to Google Play', go.status === 302 && go.headers.get('location')?.startsWith('https://play.google.com/'), String(go.headers.get('location')));
await fetch(`${BASE}/d/${n}`, { headers: { 'user-agent': 'WhatsApp/2.23.20.0' } });
await new Promise(r => setTimeout(r, 300));
const today2 = (await summary()).days?.find(d => d.day === day)?.counts ?? {};
check('visits counted: one Daily page and one store tap, the link preview not', today2['link:daily'] === 1 && today2['link:store:android'] === 1, JSON.stringify(today2));
check('the old root text is gone: / is the game\'s page now', (await (await fetch(`${BASE}/`)).text()).includes('<!doctype html>'));

await stop();
await start();
const after = await (await fetch(`${BASE}/api/v1?day=${day}&id=${named.body.me?.id}`)).json();
check('after a restart the ladder is still there', after.view?.total === 1 && after.view.me?.name === 'Check Charlie' && after.view.me.height === 12.3, JSON.stringify(after));
const me = await call({ op: 'me', key: key(1) });
check('and so is the name', me.body.me?.name === 'Check Charlie', JSON.stringify(me));
check('and so are the stats', (await summary()).days?.find(d => d.day === day)?.counts?.['runs:daily'] === 1);
await call({ op: 'forget', key: key(1) });
check('delete me empties it', (await (await fetch(`${BASE}/api/v1?day=${day}`)).json()).view?.total === 0);
await stop();

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
