// The ladder's documents in a private Vercel Blob store (BLOB_READ_WRITE_TOKEN comes from the project).
// Reads skip the CDN cache so a read-change-write always starts from the latest version.

import { BlobError, BlobPreconditionFailedError, del, get, put } from '@vercel/blob';
import type { Store, Stored } from './store.ts';

export class BlobStore implements Store {
  /** `root`: the folder every document lives under (a live self-test uses its own). */
  constructor(private root = 'v1') {}
  private file(path: string): string { return `${this.root}/${path}.json`; }

  async get<T>(path: string): Promise<Stored<T> | null> {
    const r = await get(this.file(path), { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return { data: JSON.parse(await new Response(r.stream).text()) as T, etag: r.blob.etag };
  }

  async put(path: string, data: unknown, o: { create?: boolean; ifMatch?: string } = {}): Promise<boolean> {
    try {
      await put(this.file(path), JSON.stringify(data), {
        access: 'private', contentType: 'application/json', addRandomSuffix: false,
        ...(o.ifMatch ? { ifMatch: o.ifMatch } : { allowOverwrite: !o.create }),
      });
      return true;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) return false;
      // Creating over an existing blob is refused with a plain error: if it's there, someone got in first.
      if (o.create && e instanceof BlobError && (await this.get(path))) return false;
      throw e;
    }
  }

  async del(path: string): Promise<void> {
    await del(this.file(path));
  }
}
