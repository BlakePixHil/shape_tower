// The ladder's documents in a private Vercel Blob store (BLOB_READ_WRITE_TOKEN comes from the project).
// Reads skip the CDN cache so a read-change-write always starts from the latest version. A read that
// comes back compressed (documents over about 1 KB) carries a weak ETag, W/"...", which a conditional
// write never matches, so the W/ is dropped: the tag is the content's hash either way. Two writes to one
// document at the same moment: the store refuses one as a precondition or as a "conflicting operation",
// and both mean the same to the ladder: someone else's change landed first, read again and retry.

import { BlobError, BlobPreconditionFailedError, del, get, put } from '@vercel/blob';
import type { Store, Stored } from './store.ts';

const file = (path: string) => `v1/${path}.json`;

export class BlobStore implements Store {
  async get<T>(path: string): Promise<Stored<T> | null> {
    const r = await get(file(path), { access: 'private', useCache: false });
    if (!r || r.statusCode !== 200) return null;
    return { data: JSON.parse(await new Response(r.stream).text()) as T, etag: r.blob.etag.replace(/^W\//, '') };
  }

  async put(path: string, data: unknown, o: { create?: boolean; ifMatch?: string } = {}): Promise<boolean> {
    try {
      await put(file(path), JSON.stringify(data), {
        access: 'private', contentType: 'application/json', addRandomSuffix: false,
        ...(o.ifMatch ? { ifMatch: o.ifMatch } : { allowOverwrite: !o.create }),
      });
      return true;
    } catch (e) {
      if (e instanceof BlobPreconditionFailedError) return false;
      if (e instanceof BlobError && /conflicting operation/i.test(e.message)) return false;
      // Creating over an existing blob is refused with a plain error: if it's there, someone got in first.
      if (o.create && e instanceof BlobError && (await this.get(path))) return false;
      throw e;
    }
  }

  async del(path: string): Promise<void> {
    await del(file(path));
  }
}
