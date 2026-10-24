// Puts the Workshop's products in Play Console (monetisation plan v2), so Blake doesn't type them in:
// every product on sale (src/meta/shop.ts, not `soon`) as a one-time product with one "buy" purchase
// option, its US price converted by Play to every other region, then activated. Listed in US English and
// in the app's default store language (Blake's is en-AU), since Play refuses a product without the
// latter. Safe to run again: a product that's there is updated (name, text, prices) and an active
// option stays active.
// Needs the Play service account key Blake makes (store-setup.md, step 6), never kept in the repo.
//   node --experimental-strip-types scripts/play-products.ts            what it would send, nothing sent
//   node --experimental-strip-types scripts/play-products.ts --apply    sends it
//   --key <file>   the key (default /mnt/project-files/android/play-service-account.json)
//   --only <id,…>  just these products

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PRODUCTS, type Product } from '../src/meta/shop.ts';

const PACKAGE = 'com.blakepixhil.shapetower';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const OPTION = 'buy';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const apply = args.includes('--apply');
const keyFile = flag('--key') ?? '/mnt/project-files/android/play-service-account.json';
const only = flag('--only')?.split(',');

interface Money { currencyCode: string; units: string; nanos?: number }
interface Key { client_email: string; private_key: string; token_uri?: string }

/** A Play price: whole units and nanos, from cents. */
export const money = (cents: number, currencyCode = 'USD'): Money => ({ currencyCode, units: String(Math.floor(cents / 100)), nanos: (cents % 100) * 10_000_000 });

/** The product as Play Console holds it, priced from Play's own conversion of the US price. */
export function oneTimeProduct(p: Product, conv: ConvertResponse, languages: string[]): unknown {
  // Play's purchase sheet shows the title alone, so a portrait says what it is.
  const title = p.kind === 'portrait' ? `${p.name} portrait` : p.name;
  return {
    packageName: PACKAGE,
    productId: p.id,
    listings: languages.map(languageCode => ({ languageCode, title, description: p.text })),
    purchaseOptions: [{
      purchaseOptionId: OPTION,
      buyOption: { legacyCompatible: true, multiQuantityEnabled: false },
      regionalPricingAndAvailabilityConfigs: Object.entries(conv.convertedRegionPrices).map(([regionCode, r]) => ({
        regionCode, price: regionCode === 'US' ? money(p.cents) : r.price, availability: 'AVAILABLE',
      })),
      newRegionsConfig: { usdPrice: conv.convertedOtherRegionsPrice.usdPrice, eurPrice: conv.convertedOtherRegionsPrice.eurPrice, availability: 'AVAILABLE' },
    }],
  };
}

interface ConvertResponse {
  convertedRegionPrices: Record<string, { regionCode: string; price: Money }>;
  convertedOtherRegionsPrice: { usdPrice: Money; eurPrice: Money };
  regionVersion: { version: string };
}

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

/** The app's default store language, read through an edit that's thrown away after. */
async function defaultLanguage(auth: string): Promise<string> {
  const edit = await call<{ id: string }>(auth, 'POST', `${API}/edits`, {});
  try { return (await call<{ defaultLanguage: string }>(auth, 'GET', `${API}/edits/${edit.id}/details`)).defaultLanguage; }
  finally { await call(auth, 'DELETE', `${API}/edits/${edit.id}`); }
}

async function call<T>(auth: string, method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: { authorization: `Bearer ${auth}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${url.replace(API, '')}: ${r.status} ${text.slice(0, 600)}`);
  return (text ? JSON.parse(text) : {}) as T;
}

const products = PRODUCTS.filter(p => !p.soon && (!only || only.includes(p.id)));
const tooLong = products.filter(p => p.name.length > 55 || p.text.length > 200);
if (tooLong.length) throw new Error(`Play's limits are 55 characters for a name and 200 for its text: ${tooLong.map(p => p.id).join(', ')}`);

if (!apply) {
  for (const p of products) console.log(`${p.id}  $${(p.cents / 100).toFixed(2)}  "${p.name}"  ${p.text}`);
  console.log(`\n${products.length} products. Nothing sent: add --apply to put them in Play Console.`);
} else {
  const auth = await token(JSON.parse(readFileSync(keyFile, 'utf8')) as Key);
  const languages = [...new Set(['en-US', await defaultLanguage(auth)])];
  for (const p of products) {
    const conv = await call<ConvertResponse>(auth, 'POST', `${API}/pricing:convertRegionPrices`, { price: money(p.cents) });
    const q = new URLSearchParams({ allowMissing: 'true', 'regionsVersion.version': conv.regionVersion.version, updateMask: 'listings,purchaseOptions' });
    const got = await call<{ purchaseOptions?: { purchaseOptionId: string; state?: string }[] }>(auth, 'PATCH', `${API}/onetimeproducts/${p.id}?${q}`, oneTimeProduct(p, conv, languages));
    const state = got.purchaseOptions?.find(o => o.purchaseOptionId === OPTION)?.state;
    if (state !== 'ACTIVE') {
      await call(auth, 'POST', `${API}/oneTimeProducts/${p.id}/purchaseOptions:batchUpdateStates`, {
        requests: [{ activatePurchaseOptionRequest: { packageName: PACKAGE, productId: p.id, purchaseOptionId: OPTION } }],
      });
    }
    console.log(`${p.id}: ${state === 'ACTIVE' ? 'updated' : 'added and activated'} at $${(p.cents / 100).toFixed(2)} (${Object.keys(conv.convertedRegionPrices).length} regions)`);
  }
}
