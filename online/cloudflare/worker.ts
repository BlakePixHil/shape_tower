// The ladder server on Cloudflare (gameplay.md §12.3). The Worker answers HTTP; one Durable Object keeps
// the ladder in its own SQLite database and runs the calls. POST /api/v1 with a JSON LadderRequest; GET
// /api/v1?day=YYYY-MM-DD&id=... reads a day. GET /selftest runs the live checks on a scratch copy.
// It also keeps the app's anonymous play stats (POST /api/v1/stats, a StatBatch; GET with ?key= reads the
// summary) in a second object of the same class, "stats", with its own database, and answers the share
// links' landing pages (landing.ts; og.png and icon.png are static files in online/public).
// Cloudflare deploys it from the repo (wrangler.jsonc at the root) on every push to main.

import { DurableObject } from 'cloudflare:workers';
import { handle } from '../src/handler.ts';
import { SqlStore, type Sql } from '../src/sql.ts';
import { StatsDb, type Metric, type StatsSummary } from '../src/stats.ts';
import type { LadderReply, LadderRequest } from '../../game/src/online/protocol.ts';
import { cleanBatch } from '../../game/src/meta/stats.ts';
import { landing } from './landing.ts';
import { selftest } from './selftest.ts';

export interface Env {
  LADDER: DurableObjectNamespace<Ladder>;
  /** Overrides STATS_READ_SHA256 (wrangler dev in the checks). */
  STATS_READ_SHA256?: string;
}

/**
 * SHA-256 of the key that reads the stats summary. The key itself lives in the project's shared files
 * (online/stats-read-key.txt), never in the repo.
 */
const STATS_READ_SHA256 = 'd523bf3693ec0e203c2639b849d987cb51880183d67c8108510e2e16a9a6b9d2';

/** What the Worker asks of a ladder object (the real one or the selftest's). */
export interface LadderRpc {
  run(req: LadderRequest, now?: number): Promise<LadderReply>;
  wipe(): Promise<void>;
  claimSelftest(now: number, gapMs: number): Promise<string>;
  keepSelftest(at: number, body: string): Promise<void>;
  /** The play stats (only the "stats" object, and the selftest's scratch copy, keep any). */
  stats(batch: unknown, now?: number): Promise<boolean>;
  statsSummary(days?: number, now?: number): Promise<StatsSummary>;
  count(metric: Metric, now?: number): Promise<void>;
}

export class Ladder extends DurableObject<Env> implements LadderRpc {
  private store: SqlStore;
  private statsDb: StatsDb | null = null;
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
    this.statsDb = null;
  }

  /** The stats tables, made on first use. */
  private get statsStore(): StatsDb { return (this.statsDb ??= new StatsDb(this.sql)); }

  /** A batch from a phone: false when it isn't one (nothing kept). */
  async stats(batch: unknown, now = Date.now()): Promise<boolean> {
    const b = cleanBatch(batch, now);
    if (!b) return false;
    this.statsStore.ingest(b, now);
    return true;
  }

  async statsSummary(days?: number, now = Date.now()): Promise<StatsSummary> {
    return this.statsStore.summary(now, days);
  }

  async count(metric: Metric, now = Date.now()): Promise<void> {
    this.statsStore.bump(metric, now);
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

export const statsOf = (env: Env): LadderRpc => ladderOf(env, 'stats');

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

export const sha256 = async (s: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');

/**
 * /api/v1/stats: POST takes a batch from a phone (always { ok: true } when it's a batch, so a phone never
 * retries one the server didn't want); GET with the read key answers the summary (?days=, default 28).
 */
export async function respondStats(request: Request, stats: LadderRpc, readHash: string): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    if (request.method === 'GET') {
      const q = new URL(request.url).searchParams;
      if (!readHash || (await sha256(q.get('key') ?? '')) !== readHash) return reply({ error: 'nokey' }, 403);
      return reply(await stats.statsSummary(Number(q.get('days') ?? 28) || 28));
    }
    if (request.method !== 'POST') return reply({ error: 'badop' }, 405);
    const text = await request.text();
    if (text.length > 16_384) return reply({ error: 'bad' }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return reply({ error: 'bad' }, 400); }
    return (await stats.stats(body)) ? reply({ ok: true }) : reply({ error: 'bad' }, 400);
  } catch (e) {
    console.error('stats', e);
    return reply({ error: 'busy' }, 503);
  }
}

interface Ctx { waitUntil(p: Promise<unknown>): void }

export default {
  async fetch(request: Request, env: Env, ctx?: Ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/v1') return respond(request, ladderOf(env));
    if (pathname === '/api/v1/stats') return respondStats(request, statsOf(env), env.STATS_READ_SHA256 ?? STATS_READ_SHA256);
    if (pathname === '/selftest') return selftest(env);
    // The share links' pages: counting a visit never holds up the page.
    const page = landing(request);
    if (page) {
      if (page.hit) {
        const counted = statsOf(env).count(page.hit).catch(e => console.error('count', e));
        if (ctx) ctx.waitUntil(counted); else await counted;
      }
      return page.response;
    }
    return new Response('Not found\n', { status: 404 });
  },
};
