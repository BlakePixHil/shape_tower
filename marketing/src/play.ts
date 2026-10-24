// The Google Play Developer API (Android Publisher v3) with the service account key, the same way
// game/scripts/play-upload.ts signs in. The key stays in the project files, never in the repo.

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const PACKAGE = 'com.blakepixhil.shapetower';
export const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
export const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;
export const KEY_FILE = '/mnt/project-files/android/play-service-account.json';

interface Key { client_email: string; private_key: string; token_uri?: string }

export async function token(keyFile = KEY_FILE): Promise<string> {
  const key = JSON.parse(readFileSync(keyFile, 'utf8')) as Key;
  const b64 = (x: string | Buffer) => Buffer.from(x).toString('base64url');
  const now = Math.floor(Date.now() / 1000), aud = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const body = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud, iat: now, exp: now + 3600 }))}`;
  const jwt = `${body}.${createSign('RSA-SHA256').update(body).sign(key.private_key).toString('base64url')}`;
  const r = await fetch(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const j = await r.json() as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`token: ${r.status} ${j.error_description ?? JSON.stringify(j)}`);
  return j.access_token;
}

export async function call<T>(auth: string, method: string, url: string, body?: unknown, type = 'application/json'): Promise<T> {
  const data = body === undefined ? undefined : body instanceof Uint8Array ? new Blob([new Uint8Array(body)]) : JSON.stringify(body);
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${auth}`, 'content-type': type }, body: data });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url.replace(API, '').replace(UPLOAD, '')}: ${r.status} ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

/** Runs `fn` inside one edit; commits it when `commit`, else throws it away. */
export async function withEdit<T>(fn: (auth: string, edit: string) => Promise<T>, commit: boolean): Promise<T> {
  const auth = await token();
  const edit = await call<{ id: string }>(auth, 'POST', `${API}/edits`, {});
  try {
    const out = await fn(auth, edit.id);
    if (commit) await call(auth, 'POST', `${API}/edits/${edit.id}:commit`);
    else await call(auth, 'DELETE', `${API}/edits/${edit.id}`);
    return out;
  } catch (e) {
    await call(auth, 'DELETE', `${API}/edits/${edit.id}`).catch(() => {});
    throw e;
  }
}
