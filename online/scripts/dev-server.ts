// The ladder API on this machine, in memory, for the game's browser checks (QA's and ours): the same
// handler as the live one. Point a game at it with localStorage 'shape-tower-ladder-api' set to its URL.
// Run: node --experimental-strip-types scripts/dev-server.ts [port]   (default 8787; GET /reset empties it)

import { createServer } from 'node:http';
import { handle } from '../src/handler.ts';
import { MemoryStore } from '../src/store.ts';

let store = new MemoryStore();
const port = Number(process.argv[2] ?? 8787);
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };

createServer(async (req, res) => {
  const send = (status: number, body: unknown) => { res.writeHead(status, { 'content-type': 'application/json', ...CORS }); res.end(JSON.stringify(body)); };
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  if (req.url?.startsWith('/reset')) { store = new MemoryStore(); send(200, { ok: true }); return; }
  let text = '';
  for await (const chunk of req) text += chunk;
  try {
    send(200, await handle(req.method === 'GET' ? { op: 'ladder', day: new URL(req.url ?? '/', 'http://x').searchParams.get('day') ?? '' } : JSON.parse(text), store));
  } catch (e) {
    send(400, { error: 'bad', detail: String(e) });
  }
}).listen(port, () => console.log(`ladder dev server on http://localhost:${port}`));
