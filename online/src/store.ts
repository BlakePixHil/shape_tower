// Where the ladder server keeps its JSON documents. SQLite in a Cloudflare Durable Object in production
// (sql.ts), memory in tests. Every write can be conditional, so two phones posting at once never lose an update.

export interface Stored<T> { data: T; etag: string }

export interface Store {
  get<T>(path: string): Promise<Stored<T> | null>;
  /**
   * Writes a document. `create`: only if none exists yet. `ifMatch`: only if it is still that version.
   * Resolves false when the condition fails.
   */
  put(path: string, data: unknown, o?: { create?: boolean; ifMatch?: string }): Promise<boolean>;
  del(path: string): Promise<void>;
  /** Every document whose path starts with `prefix`, in no particular order. */
  list<T>(prefix: string): Promise<Stored<T>[]>;
}

export class MemoryStore implements Store {
  readonly docs = new Map<string, Stored<unknown>>();
  private n = 0;
  async get<T>(path: string): Promise<Stored<T> | null> {
    const d = this.docs.get(path);
    return d ? { data: JSON.parse(JSON.stringify(d.data)) as T, etag: d.etag } : null;
  }
  async put(path: string, data: unknown, o: { create?: boolean; ifMatch?: string } = {}): Promise<boolean> {
    const cur = this.docs.get(path);
    if (o.create && cur) return false;
    if (o.ifMatch !== undefined && cur?.etag !== o.ifMatch) return false;
    this.docs.set(path, { data: JSON.parse(JSON.stringify(data)), etag: `e${++this.n}` });
    return true;
  }
  async del(path: string): Promise<void> { this.docs.delete(path); }
  async list<T>(prefix: string): Promise<Stored<T>[]> {
    const out: Stored<T>[] = [];
    for (const path of this.docs.keys()) if (path.startsWith(prefix)) out.push((await this.get<T>(path))!);
    return out;
  }
}
