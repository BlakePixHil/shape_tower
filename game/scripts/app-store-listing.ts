// Sets up the iPhone app's App Store listing for version 1.0 through the App Store Connect API, so Blake
// doesn't click through it: the name, subtitle and privacy policy (en-AU, en-GB, en-US), categories, content
// rights, the age rating questions, each locale's description, keywords, promotional text and links, the
// copyright, a manual release, a free price, the soft launch countries, the App Review contact and notes,
// Game Center for the version with the achievements in a draft review submission (never submitted), and the
// 6.7"/6.9" screenshots from marketing/listing/app-store/. Safe to run again: only what differs is sent.
// It never submits for review and never attaches a build.
// Needs the API key (scripts/app-store-connect.ts) and the app made in App Store Connect.
//   node --experimental-strip-types scripts/app-store-listing.ts            what it would change, nothing sent
//   node --experimental-strip-types scripts/app-store-listing.ts --apply    sends it
//   --phone "+61 …"   the App Review contact's phone (or ST_REVIEW_PHONE), which Apple requires

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { LISTING } from '../../marketing/listing/text.ts';
import { AppStoreConnect, keyFromEnv, type Resource } from './app-store-connect.ts';

export const LOCALES = ['en-AU', 'en-GB', 'en-US'] as const;
export const TERRITORIES = ['AUS', 'NZL', 'CAN'];
const VERSION = '1.0';
const NAME = 'Shape Tower: Stack & Balance';
const SUBTITLE = 'Stack wobbly shapes sky-high';
const PRIVACY_URL = 'https://github.com/BlakePixHil/shape_tower/blob/main/PRIVACY.md';
const SUPPORT_URL = 'https://github.com/BlakePixHil/shape_tower/issues';
const MARKETING_URL = 'https://shape-tower.shape-tower.workers.dev/';
const KEYWORDS = 'physics,puzzle,blocks,building,casual,relaxing,daily,zen,brain,wobbly,drop,pile,skyscraper,fun';
const PROMO = 'A new Daily Tower every day: everyone gets the same shapes. How high can you stack before it all comes down?';
const SCREENSHOT_TYPE = 'APP_IPHONE_67'; // the 6.9"/6.7" set, 1290 x 2796
const REVIEW_NOTES = 'Shape Tower is a physics stacking game with no sign-in or account. Tap Play for an Endless run: drag to move the falling shape, tap the turn button to rotate it, let go to drop it. All in-app purchases are non-consumable and are in the Workshop (the button next to the profile on the main menu); Restore purchases is in Settings. Ads: an occasional Google AdMob interstitial between runs only, never during a run, only from player level 3 and after several minutes of play; every ad request is non-personalised and the app never reads the advertising identifier, so there is no tracking and no tracking prompt. The Daily ladder is optional: player names are filtered, any player can report a name (reported names are hidden), and players can delete their name and scores in Settings. Achievements use Game Center.';

/** The age rating answers: nothing but ads and the Daily ladder's player-picked names. Not made for kids. */
export const AGE_RATING = {
  alcoholTobaccoOrDrugUseOrReferences: 'NONE', contests: 'NONE', gamblingSimulated: 'NONE', gunsOrOtherWeapons: 'NONE',
  medicalOrTreatmentInformation: 'NONE', profanityOrCrudeHumor: 'NONE', sexualContentGraphicAndNudity: 'NONE',
  sexualContentOrNudity: 'NONE', horrorOrFearThemes: 'NONE', matureOrSuggestiveThemes: 'NONE',
  violenceCartoonOrFantasy: 'NONE', violenceRealisticProlongedGraphicOrSadistic: 'NONE', violenceRealistic: 'NONE',
  advertising: true, userGeneratedContent: true,
  gambling: false, healthOrWellnessTopics: false, lootBox: false, messagingAndChat: false, parentalControls: false,
  ageAssurance: false, socialMedia: false, socialMediaAgeRestricted: false, unrestrictedWebAccess: false,
  kidsAgeBand: null,
} as const;

/** Every check that doesn't need the API: the store's limits and the naming rule. */
export function checkText(): string[] {
  const out: string[] = [];
  const len = (s: string) => [...s].length;
  if (len(NAME) > 30) out.push(`name is ${len(NAME)} characters (30 max)`);
  if (len(SUBTITLE) > 30) out.push(`subtitle is ${len(SUBTITLE)} characters (30 max)`);
  if (len(KEYWORDS) > 100) out.push(`keywords are ${len(KEYWORDS)} characters (100 max)`);
  if (len(PROMO) > 170) out.push(`promotional text is ${len(PROMO)} characters (170 max)`);
  if (len(REVIEW_NOTES) > 4000) out.push(`review notes are ${len(REVIEW_NOTES)} characters (4000 max)`);
  for (const l of LOCALES) if (len(LISTING[l].fullDescription) > 4000) out.push(`${l} description is over 4000 characters`);
  for (const s of [NAME, SUBTITLE, KEYWORDS, PROMO, REVIEW_NOTES, ...LOCALES.map(l => LISTING[l].fullDescription)])
    if (/tetris|jenga/i.test(s)) out.push('names another company\'s game');
  return out;
}

/** The screenshots, 1-*.png to 8-*.png in name order. */
export function screenshotFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => /^[1-8]-.*\.png$/.test(f)).sort();
}

const attr = (r: Resource | null | undefined, k: string): unknown => r?.attributes?.[k];
const relId = (r: Resource | null | undefined): string | null => (r as unknown as { data?: { id?: string } } | null)?.data?.id ?? null;
/** The fields of `want` that `have` doesn't match. */
const differs = (have: Record<string, unknown> | undefined, want: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(want).filter(([k, v]) => (have?.[k] ?? null) !== v));

if (process.argv[1]?.endsWith('app-store-listing.ts')) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const phone = (args.includes('--phone') ? args[args.indexOf('--phone') + 1] : process.env.ST_REVIEW_PHONE) || undefined;
  const root = new URL('../..', import.meta.url).pathname;
  const shotsDir = `${root}marketing/listing/app-store`;
  const problems = checkText();
  if (problems.length) throw new Error(problems.join('; '));

  const asc = new AppStoreConnect(keyFromEnv());
  const errors: string[] = [];
  /** Logs a change and, with --apply, makes it; a refusal is kept for the summary and the rest carries on. */
  const change = async <T>(what: string, run: () => Promise<T>): Promise<T | undefined> => {
    console.log(`${apply ? '' : 'would '}${what}`);
    if (!apply) return undefined;
    try { return await run(); } catch (e) { errors.push(`${what}: ${(e as Error).message}`); console.error(`  refused: ${(e as Error).message}`); return undefined; }
  };
  const one = async (path: string): Promise<Resource | null> => (await asc.call<{ data: Resource | null }>('GET', path))?.data ?? null;
  const post = async (type: string, attributes: Record<string, unknown>, relationships?: Record<string, unknown>, path = `/v1/${type}`): Promise<Resource> =>
    (await asc.call<{ data: Resource }>('POST', path, { data: { type, attributes, relationships } }))!.data;
  const patch = (type: string, id: string, body: Record<string, unknown>, path = `/v1/${type}/${id}`) =>
    asc.call('PATCH', path, { data: { type, id, ...body } });
  const rel = (type: string, id: string) => ({ data: { type, id } });

  const app = await asc.app();
  console.log(`App ${app.id} (${attr(app, 'name')}), primary locale ${attr(app, 'primaryLocale')}`);

  // App info: categories, then each locale's name, subtitle and privacy policy.
  const infos = await asc.all(`/v1/apps/${app.id}/appInfos`);
  const info = infos.find(i => attr(i, 'state') !== 'READY_FOR_DISTRIBUTION' && attr(i, 'appStoreState') !== 'READY_FOR_SALE') ?? infos[0];
  const cats = { primaryCategory: 'GAMES', primarySubcategoryOne: 'GAMES_PUZZLE', primarySubcategoryTwo: 'GAMES_CASUAL' };
  const haveCats = Object.fromEntries(await Promise.all(Object.keys(cats).map(async k => [k, (await one(`/v1/appInfos/${info.id}/${k}`))?.id ?? null])));
  if (Object.keys(differs(haveCats, cats)).length)
    await change(`set categories ${Object.values(cats).join(', ')}`, () => patch('appInfos', info.id, { relationships: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, rel('appCategories', v)])) }));
  const infoLocs = await asc.all(`/v1/appInfos/${info.id}/appInfoLocalizations`);
  const infoWant = { name: NAME, subtitle: SUBTITLE, privacyPolicyUrl: PRIVACY_URL };
  for (const locale of LOCALES) {
    const loc = infoLocs.find(l => attr(l, 'locale') === locale);
    if (!loc) { await change(`add the ${locale} app info (name, subtitle, privacy policy)`, () => post('appInfoLocalizations', { locale, ...infoWant }, { appInfo: rel('appInfos', info.id) })); continue; }
    const d = differs(loc.attributes, infoWant);
    if (Object.keys(d).length) await change(`set the ${locale} ${Object.keys(d).join(', ')}`, () => patch('appInfoLocalizations', loc.id, { attributes: d }));
  }

  // Content rights.
  if (attr(app, 'contentRightsDeclaration') !== 'DOES_NOT_USE_THIRD_PARTY_CONTENT')
    await change('declare no third-party content', () => patch('apps', app.id, { attributes: { contentRightsDeclaration: 'DOES_NOT_USE_THIRD_PARTY_CONTENT' } }));

  // Age rating.
  const age = await one(`/v1/appInfos/${info.id}/ageRatingDeclaration`);
  if (age) {
    const d = differs(age.attributes, AGE_RATING);
    if (Object.keys(d).length) await change(`answer the age rating questions (${Object.keys(d).length} answers)`, () => patch('ageRatingDeclarations', age.id, { attributes: d }));
  }

  // The version: copyright, manual release, then each locale's text and links.
  const versions = await asc.all(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS`);
  let version = versions.find(v => attr(v, 'versionString') === VERSION);
  if (!version) version = await change(`make version ${VERSION}`, () => post('appStoreVersions', { platform: 'IOS', versionString: VERSION }, { app: rel('apps', app.id) }));
  if (!version) { console.log(`\nNo version ${VERSION} yet, so nothing more to show.`); process.exit(0); }
  const holder = (await asc.all('/v1/users?limit=200')).find(u => (attr(u, 'roles') as string[] | undefined)?.includes('ACCOUNT_HOLDER'));
  if (!holder) throw new Error('no Account Holder in /v1/users');
  const first = String(attr(holder, 'firstName')), last = String(attr(holder, 'lastName')), email = String(attr(holder, 'username'));
  const versionWant = { copyright: `2026 ${first} ${last}`, releaseType: 'MANUAL' };
  const vd = differs(version.attributes, versionWant);
  if (Object.keys(vd).length) await change(`set version ${VERSION} ${Object.entries(vd).map(([k, v]) => `${k} "${v}"`).join(', ')}`, () => patch('appStoreVersions', version!.id, { attributes: vd }));
  let versionLocs = await asc.all(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
  for (const locale of LOCALES) {
    const want = { description: LISTING[locale].fullDescription, keywords: KEYWORDS, promotionalText: PROMO, supportUrl: SUPPORT_URL, marketingUrl: MARKETING_URL };
    const loc = versionLocs.find(l => attr(l, 'locale') === locale);
    if (!loc) { await change(`add the ${locale} version text`, () => post('appStoreVersionLocalizations', { locale, ...want }, { appStoreVersion: rel('appStoreVersions', version!.id) })); continue; }
    const d = differs(loc.attributes, want);
    if (Object.keys(d).length) await change(`set the ${locale} ${Object.keys(d).join(', ')}`, () => patch('appStoreVersionLocalizations', loc.id, { attributes: d }));
  }
  versionLocs = await asc.all(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);

  // Price: free, with the US as the base country.
  const manual = await asc.all(`/v1/appPriceSchedules/${app.id}/manualPrices?include=appPricePoint`).catch(() => [] as Resource[]);
  if (!manual.length) {
    const points = await asc.all(`/v1/apps/${app.id}/appPricePoints?filter[territory]=USA&limit=200`);
    const free = points.find(p => Number(attr(p, 'customerPrice')) === 0);
    if (!free) errors.push('no 0.00 US price point found');
    else await change('set the price to free (base country USA)', () => asc.call('POST', '/v1/appPriceSchedules', {
      data: { type: 'appPriceSchedules', relationships: { app: rel('apps', app.id), baseTerritory: rel('territories', 'USA'), manualPrices: { data: [{ type: 'appPrices', id: '${free}' }] } } },
      included: [{ type: 'appPrices', id: '${free}', attributes: { startDate: null }, relationships: { appPricePoint: rel('appPricePoints', free.id) } }],
    }));
  }

  // Availability: the soft launch countries only.
  const avail = await one(`/v1/apps/${app.id}/appAvailabilityV2`);
  if (!avail) {
    // The first availability has to answer for every country Apple sells in.
    const all = (await asc.all('/v1/territories?limit=200')).map(t => t.id);
    await change(`make the app available in ${TERRITORIES.join(', ')} only (of ${all.length} countries)`, () => asc.call('POST', '/v2/appAvailabilities', {
      data: { type: 'appAvailabilities', attributes: { availableInNewTerritories: false }, relationships: {
        app: rel('apps', app.id), territoryAvailabilities: { data: all.map(t => ({ type: 'territoryAvailabilities', id: `\${${t}}` })) } } },
      included: all.map(t => ({ type: 'territoryAvailabilities', id: `\${${t}}`, attributes: { available: TERRITORIES.includes(t) }, relationships: { territory: rel('territories', t) } })),
    }));
  } else {
    if (attr(avail, 'availableInNewTerritories') !== false) errors.push('availableInNewTerritories is on; the API can\'t change it after the fact: turn it off in Pricing and Availability');
    const tas = await asc.all(`/v2/appAvailabilities/${avail.id}/territoryAvailabilities?include=territory&limit=200`);
    for (const ta of tas) {
      const t = relId(ta.relationships?.territory as Resource);
      const want = t !== null && TERRITORIES.includes(t);
      if (attr(ta, 'available') !== want) await change(`${want ? 'make' : 'stop'} the app available in ${t}`, () => patch('territoryAvailabilities', ta.id, { attributes: { available: want } }));
    }
  }

  // App Review: the Account Holder's contact, no demo account, the notes. Apple won't take the contact
  // without a phone number, which isn't anywhere the API can read: pass it with --phone "+61 ..." (or
  // ST_REVIEW_PHONE); until then the contact and notes wait.
  const reviewWant: Record<string, unknown> = { contactFirstName: first, contactLastName: last, contactEmail: email, demoAccountRequired: false, notes: REVIEW_NOTES };
  if (phone) reviewWant.contactPhone = phone;
  const review = await one(`/v1/appStoreVersions/${version.id}/appStoreReviewDetail`);
  if (!review && !phone) errors.push('App Review contact and notes not added: Apple requires a contact phone number (rerun with --phone "+61 ...")');
  else if (!review) await change(`add the App Review contact (${first} ${last}) and notes`, () => post('appStoreReviewDetails', reviewWant, { appStoreVersion: rel('appStoreVersions', version!.id) }));
  else {
    const d = differs(review.attributes, reviewWant);
    if (Object.keys(d).length) await change(`set the App Review ${Object.keys(d).join(', ')}`, () => patch('appStoreReviewDetails', review.id, { attributes: d }));
  }

  // Game Center on for the version, and every achievement's newest version waiting in a draft review
  // submission with it (the API's way of sending achievements to review with the app; nothing is submitted).
  if (!(await one(`/v1/appStoreVersions/${version.id}/gameCenterAppVersion`)))
    await change(`turn Game Center on for version ${VERSION}`, () => post('gameCenterAppVersions', {}, { appStoreVersion: rel('appStoreVersions', version!.id) }));
  const detail = await one(`/v1/apps/${app.id}/gameCenterDetail`);
  if (detail) {
    const pending: Resource[] = [];
    for (const a of await asc.all(`/v1/gameCenterDetails/${detail.id}/gameCenterAchievementsV2?limit=200`)) {
      const v = (await asc.all(`/v2/gameCenterAchievements/${a.id}/versions`)).sort((x, y) => Number(attr(y, 'version')) - Number(attr(x, 'version')))[0];
      if (v && attr(v, 'state') === 'PREPARE_FOR_SUBMISSION') pending.push(v);
    }
    if (pending.length) {
      const drafts = await asc.all(`/v1/reviewSubmissions?filter[app]=${app.id}&filter[platform]=IOS&filter[state]=READY_FOR_REVIEW`);
      let draft: Resource | undefined = drafts[0];
      draft ??= await change('start a draft review submission (not submitted)', () => post('reviewSubmissions', { platform: 'IOS' }, { app: rel('apps', app.id) }));
      const inDraft = new Set<string>();
      if (draft) for (const item of await asc.all(`/v1/reviewSubmissions/${draft.id}/items?include=gameCenterAchievementVersion&limit=200`))
        { const id = relId(item.relationships?.gameCenterAchievementVersion as Resource); if (id) inDraft.add(id); }
      const missing = pending.filter(v => !inDraft.has(v.id));
      if (missing.length) await change(`put ${missing.length} achievements in the draft review submission`, async () => {
        for (const v of missing) {
          try { await post('reviewSubmissionItems', {}, { reviewSubmission: rel('reviewSubmissions', draft!.id), gameCenterAchievementVersion: rel('gameCenterAchievementVersions', v.id) }); }
          catch (e) { errors.push(`achievement version ${v.id} into the draft: ${(e as Error).message}`); if (errors.length > 3) throw e; }
        }
      });
    }
  }

  // Screenshots: each locale's 6.7"/6.9" set holds the eight PNGs, in order.
  const files = screenshotFiles(shotsDir);
  if (files.length < 8) errors.push(`only ${files.length} of the 8 screenshots are in ${shotsDir} (pull the branch again)`);
  else for (const locale of LOCALES) {
    const loc = versionLocs.find(l => attr(l, 'locale') === locale);
    if (!loc) continue;
    let set: Resource | undefined = (await asc.all(`/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?filter[screenshotDisplayType]=${SCREENSHOT_TYPE}`))[0];
    const shots = set ? await asc.all(`/v1/appScreenshotSets/${set.id}/appScreenshots`) : [];
    const good = (s: Resource) => (attr(s, 'assetDeliveryState') as { state?: string } | null)?.state !== 'FAILED';
    const byName = new Map(shots.filter(good).map(s => [String(attr(s, 'fileName')), s]));
    const stale = shots.filter(s => !good(s) || !files.includes(String(attr(s, 'fileName'))));
    const toAdd = files.filter(f => !byName.has(f));
    const inOrder = shots.map(s => String(attr(s, 'fileName'))).join() === files.join();
    if (!stale.length && !toAdd.length && inOrder) continue;
    await change(`${locale} screenshots: upload ${toAdd.length}, remove ${stale.length}, order 1-8`, async () => {
      set ??= await post('appScreenshotSets', { screenshotDisplayType: SCREENSHOT_TYPE }, { appStoreVersionLocalization: rel('appStoreVersionLocalizations', loc.id) });
      for (const s of stale) await asc.call('DELETE', `/v1/appScreenshots/${s.id}`);
      for (const f of toAdd) {
        const bytes = readFileSync(`${shotsDir}/${f}`);
        const shot = await post('appScreenshots', { fileName: f, fileSize: bytes.length }, { appScreenshotSet: rel('appScreenshotSets', set!.id) });
        await asc.upload(attr(shot, 'uploadOperations') as Parameters<AppStoreConnect['upload']>[0], bytes);
        await patch('appScreenshots', shot.id, { attributes: { uploaded: true, sourceFileChecksum: createHash('md5').update(bytes).digest('hex') } });
        byName.set(f, shot);
      }
      await asc.call('PATCH', `/v1/appScreenshotSets/${set!.id}/relationships/appScreenshots`, { data: files.map(f => ({ type: 'appScreenshots', id: byName.get(f)!.id })) });
    });
  }

  // What App Store Connect shows now.
  const infoNow = (await one(`/v1/appInfos/${info.id}`))!;
  console.log(`\nAge rating: ${attr(infoNow, 'appStoreAgeRating') ?? 'not computed yet'}${attr(infoNow, 'australiaAgeRating') ? `, Australia ${attr(infoNow, 'australiaAgeRating')}` : ''}`);
  console.log(`Build attached to ${VERSION}: ${relId(await asc.call('GET', `/v1/appStoreVersions/${version.id}/relationships/build`) as Resource) ?? 'none (the release build goes on later)'}`);
  if (errors.length) { console.error(`\n${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exitCode = 1; }
  else if (!apply) console.log('\nNothing sent: add --apply to make these changes.');
}
