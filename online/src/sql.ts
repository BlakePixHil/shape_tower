// The ladder's documents in SQLite: the Durable Object's own database in production (cloudflare/worker.ts),
// node:sqlite in the checks. One table of JSON documents by path, each with a version number for its etag.
// The object is the only thing that writes them, so it keeps what it has read in memory: a day's ladder is
// read from the table once, not on every look (Cloudflare's free plan counts rows read).

import type { Store, Stored } from './store.ts';

export type SqlValue = string | number | null;
/** Runs one statement and hands back its rows. */
export type Sql = (query: string, ...bind: SqlValue[]) => Record<string, SqlValue>[];

/** Past this many documents in memory, start again from empty (a lot more than a busy day's ladder). */
const MAX_CACHED = 60_000;
/** How many listed prefixes (days) to keep whole in memory: today, yesterday, and a spare. */
const MAX_LISTS = 3;

interface Doc { json: string; etag: string }

export class SqlStore implements Store {
  /** Documents as stored; null when known to be missing. */
  private readonly cache = new Map<string, Doc | null>();
  /** Listed prefixes, each with every path under it. */
  private readonly lists = new Map<string, Set<string>>();
  private readonly sql: Sql;

  constructor(sql: Sql) {
    this.sql = sql;
    sql('CREATE TABLE IF NOT EXISTS docs (path TEXT PRIMARY KEY, data TEXT NOT NULL, v INTEGER NOT NULL) WITHOUT ROWID');
  }

  async get<T>(path: string): Promise<Stored<T> | null> {
    this.trim();
    let d = this.cache.get(path);
    if (d === undefined) {
      const r = this.sql('SELECT data, v FROM docs WHERE path = ?', path)[0];
      d = r ? { json: String(r.data), etag: String(r.v) } : null;
      this.remember(path, d);
    }
    return d ? { data: JSON.parse(d.json) as T, etag: d.etag } : null;
  }

  async put(path: string, data: unknown, o: { create?: boolean; ifMatch?: string } = {}): Promise<boolean> {
    const json = JSON.stringify(data);
    const rows = o.ifMatch !== undefined
      ? this.sql('UPDATE docs SET data = ?, v = v + 1 WHERE path = ? AND v = ? RETURNING v', json, path, Number(o.ifMatch))
      : o.create
        ? this.sql('INSERT INTO docs (path, data, v) VALUES (?, ?, 1) ON CONFLICT (path) DO NOTHING RETURNING v', path, json)
        : this.sql('INSERT INTO docs (path, data, v) VALUES (?, ?, 1) ON CONFLICT (path) DO UPDATE SET data = excluded.data, v = docs.v + 1 RETURNING v', path, json);
    if (!rows.length) return false;
    this.remember(path, { json, etag: String(rows[0].v) });
    return true;
  }

  async del(path: string): Promise<void> {
    this.sql('DELETE FROM docs WHERE path = ?', path);
    this.remember(path, null);
  }

  async list<T>(prefix: string): Promise<Stored<T>[]> {
    this.trim();
    let paths = this.lists.get(prefix);
    if (!paths) {
      if (this.lists.size >= MAX_LISTS) this.lists.delete(this.lists.keys().next().value!);
      paths = new Set();
      this.lists.set(prefix, paths);
      // Paths are plain ASCII, so everything under the prefix sorts below prefix + U+FFFF.
      for (const r of this.sql('SELECT path, data, v FROM docs WHERE path >= ? AND path < ?', prefix, `${prefix}￿`)) {
        this.remember(String(r.path), { json: String(r.data), etag: String(r.v) });
      }
    }
    return [...paths].map(p => {
      const d = this.cache.get(p)!;
      return { data: JSON.parse(d.json) as T, etag: d.etag };
    });
  }

  private remember(path: string, d: Doc | null): void {
    this.cache.set(path, d);
    for (const [prefix, paths] of this.lists) {
      if (!path.startsWith(prefix)) continue;
      if (d) paths.add(path); else paths.delete(path);
    }
  }

  private trim(): void {
    if (this.cache.size < MAX_CACHED) return;
    this.cache.clear();
    this.lists.clear();
  }
}
