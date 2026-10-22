// The few Cloudflare Workers types the ladder server uses, so the online/ typecheck needs no extra package.
// The full set is @cloudflare/workers-types; these match it for what we call.

declare module 'cloudflare:workers' {
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}

interface SqlStorageCursor<T> { toArray(): T[] }
interface DurableObjectState {
  storage: {
    sql: { exec(query: string, ...bindings: (string | number | null)[]): SqlStorageCursor<Record<string, string | number | null>> };
    deleteAll(): Promise<void>;
  };
}
interface DurableObjectId { toString(): string }
interface DurableObjectNamespace<T> {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): T;
}
