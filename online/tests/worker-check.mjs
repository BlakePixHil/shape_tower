// The ladder server as Cloudflare runs it, on this machine: wrangler dev (the same workerd runtime, a real
// Durable Object with its SQLite file) answering over HTTP as the game calls it. Runs the live selftest,
// the game's calls, and a restart to show the ladder is kept on disk.
// Run from the repo root: npm ci && npm run ladder:check

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 8791;
const BASE = `http://127.0.0.1:${PORT}`;
const state = mkdtempSync(join(tmpdir(), 'ladder-'));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
};

let dev = null;
async function start() {
  dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', state], {
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

await stop();
await start();
const after = await (await fetch(`${BASE}/api/v1?day=${day}&id=${named.body.me?.id}`)).json();
check('after a restart the ladder is still there', after.view?.total === 1 && after.view.me?.name === 'Check Charlie' && after.view.me.height === 12.3, JSON.stringify(after));
const me = await call({ op: 'me', key: key(1) });
check('and so is the name', me.body.me?.name === 'Check Charlie', JSON.stringify(me));
await call({ op: 'forget', key: key(1) });
check('delete me empties it', (await (await fetch(`${BASE}/api/v1?day=${day}`)).json()).view?.total === 0);
await stop();

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
