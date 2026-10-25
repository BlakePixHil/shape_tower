// The App Store Connect API (developer.apple.com/documentation/appstoreconnectapi) for the scripts that set up
// the iPhone app's store side, so Blake doesn't click through it. It signs in with an API key (Admin), the same
// one scripts/ios-build.sh signs and uploads with: ~/.appstoreconnect/private_keys/AuthKey_<id>.p8, with
// ASC_KEY_ID and ASC_ISSUER_ID in the environment or in ~/.appstoreconnect/shape-tower.env (ios/README.md).

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const API = 'https://api.appstoreconnect.apple.com';
export const BUNDLE_ID = 'com.blakepixhil.shapetower';

export interface Resource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}
export interface Key { keyId: string; issuerId: string; pem: string }

/** The key from the environment, falling back to ~/.appstoreconnect/shape-tower.env (KEY=value lines). */
export function keyFromEnv(env: NodeJS.ProcessEnv = process.env): Key {
  const file = env.ASC_ENV ?? `${homedir()}/.appstoreconnect/shape-tower.env`;
  const vars: Record<string, string | undefined> = { ...(existsSync(file) ? Object.fromEntries(readFileSync(file, 'utf8').split('\n')
    .map(l => l.match(/^\s*(?:export\s+)?([A-Z_]+)=["']?([^"'\s]*)["']?/)).filter(m => m !== null).map(m => [m[1], m[2]])) : {}), ...env };
  const keyId = vars.ASC_KEY_ID, issuerId = vars.ASC_ISSUER_ID;
  if (!keyId || !issuerId) throw new Error(`set ASC_KEY_ID and ASC_ISSUER_ID (or put them in ${file})`);
  const path = vars.ASC_KEY_PATH ?? `${homedir()}/.appstoreconnect/private_keys/AuthKey_${keyId}.p8`;
  return { keyId, issuerId, pem: readFileSync(path, 'utf8') };
}

const b64url = (bytes: Uint8Array | string): string =>
  btoa(typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A token for the API: a JWT signed with the key (ES256), good for 20 minutes at most. */
export async function token(key: Key, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const body = `${b64url(JSON.stringify({ alg: 'ES256', kid: key.keyId, typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: key.issuerId, iat: now, exp: now + 15 * 60, aud: 'appstoreconnect-v1' }))}`;
  const der = Uint8Array.from(atob(key.pem.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const pk = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pk, new TextEncoder().encode(body)));
  return `${body}.${b64url(sig)}`;
}

export class AppStoreConnect {
  private auth: { token: string; until: number } | null = null;
  private key: Key;
  constructor(key: Key) { this.key = key; }

  private async bearer(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (!this.auth || this.auth.until < now) this.auth = { token: await token(this.key, now), until: now + 10 * 60 };
    return this.auth.token;
  }

  /** One request; `path` starts with /v1/ or /v2/ (or is a full `links.next` URL). Null for a 404. */
  async call<T = { data: Resource | Resource[] | null }>(method: string, path: string, body?: unknown): Promise<T | null> {
    const url = path.startsWith('http') ? path : `${API}${path}`;
    const r = await fetch(url, { method, headers: { authorization: `Bearer ${await this.bearer()}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 404 && method === 'GET') return null;
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${url.replace(API, '')}: ${r.status} ${text.slice(0, 800)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Every resource of a list, following its pages. */
  async all(path: string): Promise<Resource[]> {
    const out: Resource[] = [];
    let next: string | undefined = path;
    while (next) {
      const page: { data: Resource[]; links?: { next?: string } } | null = await this.call('GET', next);
      if (!page) break;
      out.push(...page.data);
      next = page.links?.next;
    }
    return out;
  }

  /** The app's record (Blake makes it in App Store Connect; the API can't). */
  async app(bundleId = BUNDLE_ID): Promise<Resource> {
    const [app] = await this.all(`/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`);
    if (!app) throw new Error(`no app with the bundle id ${bundleId} in App Store Connect yet: make it there first (My Apps, +, New App)`);
    return app;
  }

  /** Uploads a file to the slots an asset reservation (an image, a screenshot) handed back. */
  async upload(ops: { method: string; url: string; length: number; offset: number; requestHeaders?: { name: string; value: string }[] }[], bytes: Uint8Array): Promise<void> {
    for (const op of ops) {
      const r = await fetch(op.url, { method: op.method, headers: Object.fromEntries((op.requestHeaders ?? []).map(h => [h.name, h.value])), body: bytes.slice(op.offset, op.offset + op.length) });
      if (!r.ok) throw new Error(`upload ${op.offset}+${op.length}: ${r.status} ${(await r.text()).slice(0, 300)}`);
    }
  }
}
