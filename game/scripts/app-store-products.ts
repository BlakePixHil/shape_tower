// Puts the Workshop's products in App Store Connect, the twin of play-products.ts: every product on sale
// (src/meta/shop.ts ON_SALE) as a non-consumable in-app purchase with the same id as on Play, not family
// sharable, listed in en-AU, en-GB and en-US, priced from its US price in cents (Apple sets the other
// countries), sold in the app's soon-launch countries, with the Workshop as its review screenshot. Safe to run
// again: what's there is only changed where it differs. Never submits anything for review.
// Needs the API key (scripts/app-store-connect.ts) and the Paid Apps Agreement for purchases to be sold.
//   node --experimental-strip-types scripts/app-store-products.ts            what it would send, nothing sent
//   node --experimental-strip-types scripts/app-store-products.ts --apply    sends it
//   --only <id,…>  just these products

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { ON_SALE, type Product } from '../src/meta/shop.ts';
import { AppStoreConnect, keyFromEnv, type Resource } from './app-store-connect.ts';
import { LOCALES, TERRITORIES } from './app-store-listing.ts';

const REVIEW_NOTE = 'Bought in the Workshop (main menu, next to the profile).';

/** The App Store's shorter text for each kind (30 characters for a name, 45 for a description). */
export function storeText(p: Product): { name: string; description: string } {
  switch (p.kind) {
    case 'supporter': return { name: p.name, description: 'Builder\'s Pass, Remove Ads and extras' };
    case 'pass': return { name: p.name, description: 'A second reward at every level' };
    case 'noads': return { name: p.name, description: 'No ads between runs, for good' };
    case 'wind': return { name: p.name, description: 'Second Wind ready in every Endless run' };
    case 'portrait': return { name: `${p.name} portrait`, description: p.cents > 99 ? 'An animated style for your ladder portrait' : 'A style for your Daily ladder portrait' };
    case 'set': return { name: `${p.name} set`, description: 'Five matching pieces for your look' };
  }
}

/** The name App Store Connect lists it by: the shop name, plus the id where names repeat. */
export function referenceName(p: Product, all: Product[] = ON_SALE): string {
  return all.filter(q => q.name === p.name).length > 1 ? `${p.name} (${p.id})` : p.name;
}

export function checkProducts(products: Product[] = ON_SALE): string[] {
  const out: string[] = [];
  for (const p of products) {
    const t = storeText(p);
    if ([...t.name].length > 30) out.push(`${p.id}: name is ${[...t.name].length} characters (30 max)`);
    if ([...t.description].length > 45) out.push(`${p.id}: description is ${[...t.description].length} characters (45 max)`);
    if ([...referenceName(p)].length > 64) out.push(`${p.id}: reference name is over 64 characters`);
    if (/tetris|jenga/i.test(t.name + t.description)) out.push(`${p.id}: names another company's game`);
  }
  return out;
}

const attr = (r: Resource | null | undefined, k: string): unknown => r?.attributes?.[k];

if (process.argv[1]?.endsWith('app-store-products.ts')) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : undefined;
  const products = ON_SALE.filter(p => !only || only.includes(p.id));
  const problems = checkProducts(products);
  if (problems.length) throw new Error(problems.join('; '));
  const shot = new URL('../../marketing/listing/app-store/review-workshop.png', import.meta.url).pathname;

  const asc = new AppStoreConnect(keyFromEnv());
  const errors: string[] = [];
  const change = async <T>(what: string, run: () => Promise<T>): Promise<T | undefined> => {
    console.log(`${apply ? '' : 'would '}${what}`);
    if (!apply) return undefined;
    try { return await run(); } catch (e) { errors.push(`${what}: ${(e as Error).message}`); console.error(`  refused: ${(e as Error).message}`); return undefined; }
  };
  const one = async (path: string): Promise<Resource | null> => (await asc.call<{ data: Resource | null }>('GET', path))?.data ?? null;
  const post = async (type: string, attributes: Record<string, unknown>, relationships?: Record<string, unknown>, path = `/v1/${type}`): Promise<Resource> =>
    (await asc.call<{ data: Resource }>('POST', path, { data: { type, attributes, relationships } }))!.data;
  const patch = (type: string, id: string, attributes: Record<string, unknown>, path = `/v1/${type}/${id}`) =>
    asc.call('PATCH', path, { data: { type, id, attributes } });
  const rel = (type: string, id: string) => ({ data: { type, id } });
  const differs = (have: Record<string, unknown> | undefined, want: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(want).filter(([k, v]) => (have?.[k] ?? null) !== v));

  const app = await asc.app();
  const have = new Map((await asc.all(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`)).map(i => [String(attr(i, 'productId')), i]));
  if (!existsSync(shot)) errors.push(`no review screenshot at ${shot} yet (pull the branch again)`);

  for (const p of products) {
    const t = storeText(p);
    const want = { name: referenceName(p), reviewNote: REVIEW_NOTE, familySharable: false };
    let iap = have.get(p.id);
    if (!iap) iap = await change(`${p.id}: make it ("${want.name}", non-consumable)`, () =>
      post('inAppPurchases', { productId: p.id, inAppPurchaseType: 'NON_CONSUMABLE', ...want }, { app: rel('apps', app.id) }, '/v2/inAppPurchases'));
    else {
      const d = differs(iap.attributes, want);
      if (Object.keys(d).length) await change(`${p.id}: set ${Object.keys(d).join(', ')}`, () => patch('inAppPurchases', iap!.id, d, `/v2/inAppPurchases/${iap!.id}`));
    }
    if (!iap) { if (apply) continue; console.log(`would list it in ${LOCALES.join(', ')} as "${t.name}": ${t.description}; $${(p.cents / 100).toFixed(2)}; ${TERRITORIES.join(', ')}; review screenshot`); continue; }

    // The store page text in each locale.
    const locs = await asc.all(`/v2/inAppPurchases/${iap.id}/inAppPurchaseLocalizations`);
    for (const locale of LOCALES) {
      const loc = locs.find(l => attr(l, 'locale') === locale);
      if (!loc) await change(`${p.id}: add ${locale} "${t.name}"`, () => post('inAppPurchaseLocalizations', { locale, name: t.name, description: t.description }, { inAppPurchaseV2: rel('inAppPurchases', iap!.id) }));
      else {
        const d = differs(loc.attributes, { name: t.name, description: t.description });
        if (Object.keys(d).length) await change(`${p.id}: set the ${locale} ${Object.keys(d).join(', ')}`, () => patch('inAppPurchaseLocalizations', loc.id, d));
      }
    }

    // The US price; Apple works out every other country's from it.
    const schedule = await one(`/v2/inAppPurchases/${iap.id}/iapPriceSchedule`).catch(() => null);
    const manual = schedule ? await asc.all(`/v1/inAppPurchasePriceSchedules/${schedule.id}/manualPrices?include=inAppPurchasePricePoint,territory&limit=200`).catch(() => [] as Resource[]) : [];
    if (!manual.length) {
      const points = await asc.all(`/v2/inAppPurchases/${iap.id}/pricePoints?filter[territory]=USA&limit=200`);
      const point = points.find(pp => Math.round(Number(attr(pp, 'customerPrice')) * 100) === p.cents);
      if (!point) errors.push(`${p.id}: no US price point at $${(p.cents / 100).toFixed(2)}`);
      else await change(`${p.id}: price $${(p.cents / 100).toFixed(2)} (base country USA)`, () => asc.call('POST', '/v1/inAppPurchasePriceSchedules', {
        data: { type: 'inAppPurchasePriceSchedules', relationships: { inAppPurchase: rel('inAppPurchases', iap!.id), baseTerritory: rel('territories', 'USA'), manualPrices: { data: [{ type: 'inAppPurchasePrices', id: '${price}' }] } } },
        included: [{ type: 'inAppPurchasePrices', id: '${price}', attributes: { startDate: null }, relationships: { inAppPurchasePricePoint: rel('inAppPurchasePricePoints', point.id) } }],
      }));
    }

    // Sold where the app is.
    const avail = await one(`/v2/inAppPurchases/${iap.id}/inAppPurchaseAvailability`).catch(() => null);
    const where = avail ? (await asc.all(`/v1/inAppPurchaseAvailabilities/${avail.id}/availableTerritories?limit=200`)).map(x => x.id).sort().join() : '';
    if (!avail || where !== [...TERRITORIES].sort().join() || attr(avail, 'availableInNewTerritories') !== false)
      await change(`${p.id}: sell it in ${TERRITORIES.join(', ')}`, () => asc.call('POST', '/v1/inAppPurchaseAvailabilities', {
        data: { type: 'inAppPurchaseAvailabilities', attributes: { availableInNewTerritories: false }, relationships: {
          inAppPurchase: rel('inAppPurchases', iap!.id), availableTerritories: { data: TERRITORIES.map(id => ({ type: 'territories', id })) } } },
      }));

    // The review screenshot: the Workshop.
    if (existsSync(shot)) {
      const current = await one(`/v2/inAppPurchases/${iap.id}/appStoreReviewScreenshot`).catch(() => null);
      const state = (attr(current, 'assetDeliveryState') as { state?: string } | null)?.state;
      if (!current || state === 'FAILED') await change(`${p.id}: add the review screenshot`, async () => {
        if (current) await asc.call('DELETE', `/v1/inAppPurchaseAppStoreReviewScreenshots/${current.id}`);
        const bytes = readFileSync(shot);
        const s = await post('inAppPurchaseAppStoreReviewScreenshots', { fileName: 'review-workshop.png', fileSize: bytes.length }, { inAppPurchaseV2: rel('inAppPurchases', iap!.id) });
        await asc.upload(attr(s, 'uploadOperations') as Parameters<AppStoreConnect['upload']>[0], bytes);
        await patch('inAppPurchaseAppStoreReviewScreenshots', s.id, { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') });
      });
    }
  }

  // What App Store Connect says about each one now.
  if (apply) for (const i of await asc.all(`/v1/apps/${app.id}/inAppPurchasesV2?limit=200`))
    console.log(`${attr(i, 'productId')}: ${attr(i, 'state')}`);
  if (errors.length) { console.error(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exitCode = 1; }
  else if (!apply) console.log(`\n${products.length} products. Nothing sent: add --apply to make them.`);
}
