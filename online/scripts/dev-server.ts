// The ladder API on this machine, in memory, for the game's browser checks (QA's and ours): the same
// handler as the live one. Point a game at it with localStorage 'shape-tower-ladder-api' set to its URL.
// The play stats too: POST /stats takes the app's batches into the live server's tables (SQLite in
// memory); GET /stats answers the summary (no key here) and GET /stats/batches what came in, as cleaned.
// Run: node --experimental-strip-types scripts/dev-server.ts [port]   (default 8787; GET /reset empties it)

import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { handle } from '../src/handler.ts';
import { StatsDb } from '../src/stats.ts';
import { MemoryStore } from '../src/store.ts';
import { cleanBatch, type StatBatch } from '../../game/src/meta/stats.ts';

let store = new MemoryStore();
const freshStats = () => {
  const db = new DatabaseSync(':memory:');
  return new StatsDb((q, ...b) => db.prepare(q).all(...b) as Record<string, string | number | null>[]);
};
let stats = freshStats();
let batches: StatBatch[] = [];
const port = Number(process.argv[2] ?? 8787);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

createServer(async (req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (req.url?.startsWith('/reset')) { store = new MemoryStore(); stats = freshStats(); batches = []; send(200, { ok: true }); return; }
  let text = '';
  for await (const chunk of req) text += chunk;
  if (req.url?.startsWith('/stats')) {
    if (req.method === 'GET') { send(200, req.url.startsWith('/stats/batches') ? batches : stats.summary(Date.now())); return; }
    let b: StatBatch | null = null;
    try { b = cleanBatch(JSON.parse(text), Date.now()); } catch { /* not JSON */ }
    if (!b) { send(400, { error: 'bad' }); return; }
    batches.push(b);
    stats.ingest(b, Date.now());
    send(200, { ok: true });
    return;
  }
  try {
    send(200, await handle(req.method === 'GET' ? { op: 'ladder', day: new URL(req.url ?? '/', 'http://x').searchParams.get('day') ?? '' } : JSON.parse(text), store));
  } catch (e) {
    send(400, { error: 'bad', detail: String(e) });
  }
}).listen(port, () => console.log(`ladder dev server on http://localhost:${port}`));
