// The ladder server on Cloudflare (gameplay.md §12.3). The Worker answers HTTP; one Durable Object keeps
// the ladder in its own SQLite database and runs the calls. POST /api/v1 with a JSON LadderRequest; GET
// /api/v1?day=YYYY-MM-DD&id=... reads a day. GET /selftest runs the live checks on a scratch copy.
// Cloudflare deploys it from the repo (wrangler.jsonc at the root) on every push to main.

import { DurableObject } from 'cloudflare:workers';
import { handle } from '../src/handler.ts';
import { SqlStore, type Sql } from '../src/sql.ts';
import type { LadderReply, LadderRequest } from '../../game/src/online/protocol.ts';
import { selftest } from './selftest.ts';

export interface Env { LADDER: DurableObjectNamespace<Ladder> }

/** What the Worker asks of a ladder object (the real one or the selftest's). */
export interface LadderRpc {
  run(req: LadderRequest, now?: number): Promise<LadderReply>;
  wipe(): Promise<void>;
  claimSelftest(now: number, gapMs: number): Promise<string>;
  keepSelftest(at: number, body: string): Promise<void>;
}

export class Ladder extends DurableObject<Env> implements LadderRpc {
  private store: SqlStore;
  private readonly sql: Sql;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const db = ctx.storage.sql;
    this.sql = (q, ...b) => db.exec(q, ...b).toArray();
    this.store = new SqlStore(this.sql);
  }

  async run(req: LadderRequest, now?: number): Promise<LadderReply> {
    return handle(req, this.store, now);
  }

  /** Empties this object. Only the selftest's scratch copy is ever wiped. */
  async wipe(): Promise<void> {
    await this.ctx.storage.deleteAll();
    this.store = new SqlStore(this.sql);
  }

  /**
   * The selftest's gate (its own object): 'go' at most once per `gapMs`, otherwise the last run's answer,
   * so calling /selftest in a loop can't spend the free plan's daily calls and writes.
   */
  async claimSelftest(now: number, gapMs: number): Promise<string> {
    const last = (await this.store.get<{ at: number; body: string }>('selftest/last'))?.data;
    if (last && now - last.at < gapMs) return last.body || JSON.stringify({ pass: false, out: [['FAIL', 'another run is still going']] });
    await this.store.put('selftest/last', { at: now, body: '' });
    return 'go';
  }

  async keepSelftest(at: number, body: string): Promise<void> {
    await this.store.put('selftest/last', { at, body });
  }
}

export const ladderOf = (env: Env, name = 'ladder'): LadderRpc => env.LADDER.get(env.LADDER.idFromName(name));

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });

async function run(ladder: LadderRpc, req: LadderRequest): Promise<Response> {
  try {
    return reply(await ladder.run(req));
  } catch (e) {
    console.error('ladder', req?.op, e);
    return reply({ error: 'busy' }, 503);
  }
}

/** One /api/v1 call, against the given ladder object. */
export async function respond(request: Request, ladder: LadderRpc): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method === 'GET') {
    const q = new URL(request.url).searchParams;
    if (!q.get('day')) return reply({ ok: true, service: 'shape-tower-ladder', version: 1 });
    return run(ladder, { op: 'ladder', day: q.get('day') ?? undefined, id: q.get('id') ?? undefined });
  }
  if (request.method !== 'POST') return reply({ error: 'badop' }, 405);
  const text = await request.text();
  if (text.length > 4096) return reply({ error: 'bad' }, 413);
  let body: LadderRequest;
  try { body = JSON.parse(text); } catch { return reply({ error: 'bad' }, 400); }
  return run(ladder, body);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/v1') return respond(request, ladderOf(env));
    if (pathname === '/selftest') return selftest(env);
    if (pathname === '/') return new Response('Shape Tower ladder API. POST /api/v1\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response('Not found\n', { status: 404 });
  },
};
