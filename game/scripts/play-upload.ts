// Sends a build to the testers' phones through Play (store-setup.md, step 6), so Blake doesn't upload
// it: the .aab that `ST_BUNDLE=1 scripts/android-build.sh` made goes up to a testing track (internal by
// default) and rolls out to everyone on it, and Play updates their copy. Every build's upload key is
// the test key, which Play App Signing re-signs.
// Needs the Play service account key Blake makes (store-setup.md, step 6), never kept in the repo.
//   node --experimental-strip-types scripts/play-upload.ts dist-apk/shape-tower-0.1.300.aab --notes "…"
//   --track <name>  internal (default), alpha (closed testing), beta, or production with --draft only:
//                   a store release goes out by hand, under managed publishing, from Play Console.
//   --draft         leave the release as a draft. Until the app's first production release Play calls it a
//                   draft app and takes only draft releases outside internal testing, so someone rolls it
//                   out from Play Console (the track's Releases > Edit release, then send for review).
//   --key <file>    the key (default /mnt/project-files/android/play-service-account.json)

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PACKAGE = 'com.blakepixhil.shapetower';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const bundle = args[0];
const notes = flag('--notes');
const track = flag('--track') ?? 'internal';
const draft = args.includes('--draft');
const keyFile = flag('--key') ?? '/mnt/project-files/android/play-service-account.json';
if (!bundle?.endsWith('.aab')) throw new Error('usage: play-upload.ts <file.aab> [--notes "…"] [--track internal]');
if (!['internal', 'alpha', 'beta'].includes(track) && !(track === 'production' && draft)) throw new Error(`play-upload sends to a testing track, or production as a --draft, not "${track}"`);

interface Key { client_email: string; private_key: string; token_uri?: string }

async function token(key: Key): Promise<string> {
  const b64 = (x: string | Buffer) => Buffer.from(x).toString('base64url');
  const now = Math.floor(Date.now() / 1000), aud = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const body = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud, iat: now, exp: now + 3600 }))}`;
  const jwt = `${body}.${createSign('RSA-SHA256').update(body).sign(key.private_key).toString('base64url')}`;
  const r = await fetch(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const j = await r.json() as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`token: ${r.status} ${j.error_description ?? JSON.stringify(j)}`);
  return j.access_token;
}

async function call<T>(auth: string, method: string, url: string, body?: unknown, type = 'application/json'): Promise<T> {
  const data = body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body);
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${auth}`, 'content-type': type }, body: data });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url.replace(API, '').replace(UPLOAD, '')}: ${r.status} ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const auth = await token(JSON.parse(readFileSync(keyFile, 'utf8')) as Key);
const edit = await call<{ id: string }>(auth, 'POST', `${API}/edits`, {});
try {
  const { defaultLanguage } = await call<{ defaultLanguage: string }>(auth, 'GET', `${API}/edits/${edit.id}/details`);
  const up = await call<{ versionCode: number }>(auth, 'POST', `${UPLOAD}/edits/${edit.id}/bundles?uploadType=media`, readFileSync(bundle), 'application/octet-stream');
  await call(auth, 'PUT', `${API}/edits/${edit.id}/tracks/${track}`, {
    track,
    releases: [{
      versionCodes: [String(up.versionCode)],
      status: draft ? 'draft' : 'completed',
      ...(notes ? { releaseNotes: [{ language: defaultLanguage, text: notes }] } : {}),
    }],
  });
  await call(auth, 'POST', `${API}/edits/${edit.id}:commit`);
  console.log(`${bundle}: version ${up.versionCode} is ${draft ? 'a draft' : 'out'} on the ${track} track`);
} catch (e) {
  await call(auth, 'DELETE', `${API}/edits/${edit.id}`).catch(() => {});
  throw e;
}
