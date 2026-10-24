// Puts the achievements in Play Games (gameplay.md §18.5) through Google's Play Games Services Publishing
// API, so Blake doesn't type them in, then writes their ids the way `npm run stores:ids` does. Safe to run
// again: an achievement that's there (same English name) keeps its id and isn't made twice. Play Console
// lists them in the order they were made, so a first run makes them in the game's order. The API can't
// upload icons: those go in by hand from the store kit (store-setup.md, step 10).
// Needs the Play service account key (store-setup.md, step 6) and the Play Games project id (step 7).
//   node --experimental-strip-types scripts/play-achievements.ts <projectId>            what it would send
//   node --experimental-strip-types scripts/play-achievements.ts <projectId> --apply    sends it, writes the ids
//   --key <file>   the key (default /mnt/project-files/android/play-service-account.json)
//   --locales <a,b>   the languages each name and text go in (default en-US: Shape Tower's Play Games project
//                     takes en-US only and refuses en-AU, although the app's store listing defaults to en-AU)

import { readFileSync, writeFileSync } from 'node:fs';
import { STORE_IDS } from '../src/meta/store-ids.ts';
import { storeRows, type StoreRow } from '../src/meta/stores.ts';
import { projectIdResource, storeIdsSource } from './stores-ids.ts';

const API = 'https://gamesconfiguration.googleapis.com/games/v1configuration';
export const LOCALES = ['en-US'];

interface Strings { kind: 'gamesConfiguration#localizedStringBundle'; translations: { kind: 'gamesConfiguration#localizedString'; locale: string; value: string }[] }
export interface PlayAchievement {
  kind: 'gamesConfiguration#achievementConfiguration';
  id?: string;
  achievementType: 'STANDARD' | 'INCREMENTAL';
  initialState: 'HIDDEN' | 'REVEALED';
  stepsToUnlock?: number;
  draft: { kind: 'gamesConfiguration#achievementConfigurationDetail'; name: Strings; description: Strings; pointValue: number };
}
export interface Key { client_email: string; private_key: string; token_uri?: string }

const strings = (value: string, locales: string[]): Strings => ({
  kind: 'gamesConfiguration#localizedStringBundle',
  translations: locales.map(locale => ({ kind: 'gamesConfiguration#localizedString', locale, value })),
});
const english = (s: Strings | undefined): string => s?.translations.find(t => t.locale.startsWith('en'))?.value ?? s?.translations[0]?.value ?? '';

/** One row of the store table as the Publishing API takes it. */
export function playAchievement(r: StoreRow, locales = LOCALES): PlayAchievement {
  return {
    kind: 'gamesConfiguration#achievementConfiguration',
    achievementType: r.steps ? 'INCREMENTAL' : 'STANDARD',
    initialState: r.hidden ? 'HIDDEN' : 'REVEALED',
    ...(r.steps ? { stepsToUnlock: r.steps } : {}),
    draft: { kind: 'gamesConfiguration#achievementConfigurationDetail', name: strings(r.name, locales), description: strings(r.text, locales), pointValue: r.points },
  };
}

/**
 * What a run does against what Play already has: the rows to make (in the game's order), the ids of the
 * ones already there, and the ones there whose settings no longer match the game (reported, not changed).
 */
export function planPlay(rows: StoreRow[], existing: PlayAchievement[]): { create: StoreRow[]; have: Record<string, string>; differ: string[] } {
  const byName = new Map(existing.map(e => [english(e.draft?.name).toLowerCase(), e]));
  const create: StoreRow[] = [], have: Record<string, string> = {}, differ: string[] = [];
  for (const r of rows) {
    const e = byName.get(r.name.toLowerCase());
    if (!e?.id) { create.push(r); continue; }
    have[r.id] = e.id;
    const want = playAchievement(r);
    if (e.achievementType !== want.achievementType || e.initialState !== want.initialState || (e.stepsToUnlock ?? 0) !== (want.stepsToUnlock ?? 0)
      || e.draft.pointValue !== want.draft.pointValue || english(e.draft.description) !== r.text) differ.push(r.id);
  }
  return { create, have, differ };
}

const b64url = (bytes: Uint8Array | string): string =>
  btoa(typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** An access token for the service account (a signed JWT traded at Google's token endpoint). */
export async function token(key: Key): Promise<string> {
  const now = Math.floor(Date.now() / 1000), aud = key.token_uri ?? 'https://oauth2.googleapis.com/token';
  const body = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: key.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud, iat: now, exp: now + 3600 }))}`;
  const der = Uint8Array.from(atob(key.private_key.replace(/-----[^-]+-----|\s/g, '')), c => c.charCodeAt(0));
  const pk = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pk, new TextEncoder().encode(body)));
  const r = await fetch(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${body}.${b64url(sig)}` }) });
  const j = await r.json() as { access_token?: string; error_description?: string };
  if (!j.access_token) throw new Error(`token: ${r.status} ${j.error_description ?? JSON.stringify(j)}`);
  return j.access_token;
}

async function call<T>(auth: string, method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url.replace(API, '')}: ${r.status} ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

if (process.argv[1]?.endsWith('play-achievements.ts')) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const projectId = args.find(a => /^\d+$/.test(a));
  if (!projectId) { console.error('usage: play-achievements.ts <Play Games project id> [--apply] [--key file]'); process.exit(1); }
  const rows = storeRows(), locales = flag('--locales')?.split(',') ?? LOCALES;
  if (!args.includes('--apply')) {
    for (const r of rows) console.log(`${r.order}. ${r.name}  ${r.points} pts${r.steps ? `  ${r.steps} steps` : ''}${r.hidden ? '  hidden' : ''}`);
    console.log(`\n${rows.length} achievements for Play Games project ${projectId}, in ${locales.join(', ')}. Nothing sent: add --apply to make them.`);
  } else {
    const auth = await token(JSON.parse(readFileSync(flag('--key') ?? '/mnt/project-files/android/play-service-account.json', 'utf8')) as Key);
    const existing: PlayAchievement[] = [];
    let page: string | undefined;
    do {
      const q = new URLSearchParams({ maxResults: '200', ...(page ? { pageToken: page } : {}) });
      const got = await call<{ items?: PlayAchievement[]; nextPageToken?: string }>(auth, 'GET', `${API}/applications/${projectId}/achievements?${q}`);
      existing.push(...(got.items ?? []));
      page = got.nextPageToken;
    } while (page);
    const plan = planPlay(rows, existing);
    for (const r of plan.create) {
      const made = await call<PlayAchievement>(auth, 'POST', `${API}/applications/${projectId}/achievements`, playAchievement(r, locales));
      plan.have[r.id] = made.id!;
      console.log(`made ${r.id}: ${made.id}`);
    }
    const achievements = Object.fromEntries(rows.map(r => [r.id, plan.have[r.id]]));
    const root = new URL('..', import.meta.url).pathname;
    writeFileSync(`${root}src/meta/store-ids.ts`, storeIdsSource({ play: { projectId, achievements }, gameCenter: STORE_IDS.gameCenter }));
    writeFileSync(`${root}android/app/src/main/res/values/game_services.xml`, projectIdResource(projectId));
    console.log(`Play Games project ${projectId}: ${plan.create.length} made, ${rows.length - plan.create.length} already there; ids written.`);
    if (plan.differ.length) console.error(`Already there but set up differently from the game (change them in Play Console): ${plan.differ.join(', ')}`);
  }
}
