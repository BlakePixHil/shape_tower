// The Shape Tower ladder API (gameplay.md §12.3): POST /api/v1 with a JSON LadderRequest. GET reads a
// day's ladder (?day=YYYY-MM-DD&id=...). Anyone may call it: the game runs on phones and in browsers.

import { handle } from '../src/handler.ts';
import { BlobStore } from '../src/blob.ts';
import type { LadderRequest } from '../../game/src/online/protocol.ts';

const store = new BlobStore();
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

async function run(req: LadderRequest): Promise<Response> {
  try {
    return reply(await handle(req, store));
  } catch (e) {
    console.error('ladder', req?.op, e);
    return reply({ error: 'busy' }, 503);
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams;
  if (!q.get('day')) return reply({ ok: true, service: 'shape-tower-ladder', version: 1 });
  return run({ op: 'ladder', day: q.get('day') ?? undefined, id: q.get('id') ?? undefined });
}

export async function POST(request: Request): Promise<Response> {
  const text = await request.text();
  if (text.length > 4096) return reply({ error: 'bad' }, 413);
  let body: LadderRequest;
  try { body = JSON.parse(text); } catch { return reply({ error: 'bad' }, 400); }
  return run(body);
}
