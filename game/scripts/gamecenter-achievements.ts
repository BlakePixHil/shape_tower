// Puts the achievements in Game Center (gameplay.md §18.5) through the App Store Connect API, so Blake doesn't
// type them in, then turns Game Center on in src/meta/store-ids.ts. The Game Center twin of play-achievements.ts.
// Safe to run again: an achievement that's there (same id, shapetower.<id>) isn't made twice, and its English
// text and badge are only added where missing. Each badge is <id>.png or <id>.jpg in --images: Art's
// `npm run export:badges` writes them to art/exports/achievements/gamecenter (1024 px, flattened).
// Needs the API key (scripts/app-store-connect.ts) and the app made in App Store Connect.
//   node --experimental-strip-types scripts/gamecenter-achievements.ts            what it would send
//   node --experimental-strip-types scripts/gamecenter-achievements.ts --apply    sends it, turns Game Center on
//   --images <dir>   the badges (default ../art/exports/achievements/gamecenter)
//   --replace <id,id>   swap the badge these achievements already have for the one in --images (Art redrew it)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { STORE_IDS } from '../src/meta/store-ids.ts';
import { storeRows, type StoreRow } from '../src/meta/stores.ts';
import { AppStoreConnect, keyFromEnv, type Resource } from './app-store-connect.ts';
import { storeIdsSource } from './stores-ids.ts';

const LOCALE = 'en-US';

/** One row of the store table as App Store Connect takes it (POST /v2/gameCenterAchievements). */
export function gameCenterAchievement(r: StoreRow, detailId: string): unknown {
  return {
    data: {
      type: 'gameCenterAchievements',
      attributes: { referenceName: r.name, vendorIdentifier: r.gameCenter, points: r.points, showBeforeEarned: !r.hidden, repeatable: false },
      relationships: {
        gameCenterDetail: { data: { type: 'gameCenterDetails', id: detailId } },
        versions: { data: [{ type: 'gameCenterAchievementVersions', id: '${version}' }] },
      },
    },
    included: [{ type: 'gameCenterAchievementVersions', id: '${version}' }],
  };
}

const attr = (r: Resource, k: string): unknown => r.attributes?.[k];

if (process.argv[1]?.endsWith('gamecenter-achievements.ts')) {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const root = new URL('..', import.meta.url).pathname;
  const images = flag('--images') ?? `${root}../art/exports/achievements/gamecenter`;
  const replace = new Set(flag('--replace')?.split(',').filter(Boolean) ?? []);
  const rows = storeRows();
  const badge = (r: StoreRow): string | undefined => ['png', 'jpg'].map(x => `${images}/${r.id}.${x}`).find(f => existsSync(f));
  if (!args.includes('--apply')) {
    for (const r of rows) console.log(`${r.order}. ${r.gameCenter}  ${r.name}  ${r.points} pts${r.hidden ? '  hidden' : ''}${badge(r) ? '' : '  (no badge)'}`);
    console.log(`\n${rows.length} achievements, ${rows.reduce((n, r) => n + r.points, 0)} of Game Center's 1000 points. Nothing sent: add --apply to make them.`);
  } else {
    const asc = new AppStoreConnect(keyFromEnv());
    const app = await asc.app();
    let detail = (await asc.call<{ data: Resource | null }>('GET', `/v1/apps/${app.id}/gameCenterDetail`))?.data ?? null;
    detail ??= (await asc.call<{ data: Resource }>('POST', '/v1/gameCenterDetails', { data: { type: 'gameCenterDetails', relationships: { app: { data: { type: 'apps', id: app.id } } } } }))!.data;
    const have = new Map((await asc.all(`/v1/gameCenterDetails/${detail.id}/gameCenterAchievementsV2?limit=200`)).map(a => [attr(a, 'vendorIdentifier'), a]));
    let made = 0, texts = 0, badges = 0, swapped = 0;
    const missingBadges: string[] = [];
    for (const r of rows) {
      let a = have.get(r.gameCenter);
      if (!a) {
        a = (await asc.call<{ data: Resource }>('POST', '/v2/gameCenterAchievements', gameCenterAchievement(r, detail.id)))!.data;
        made++;
      }
      // The newest version holds the text and badge players see.
      const versions = await asc.all(`/v2/gameCenterAchievements/${a.id}/versions`);
      const version = versions.sort((x, y) => Number(attr(y, 'version') ?? 0) - Number(attr(x, 'version') ?? 0))[0];
      if (!version) throw new Error(`${r.gameCenter} has no version`);
      const locs = await asc.all(`/v2/gameCenterAchievementVersions/${version.id}/localizations`);
      let loc = locs.find(l => attr(l, 'locale') === LOCALE);
      if (!loc) {
        loc = (await asc.call<{ data: Resource }>('POST', '/v2/gameCenterAchievementLocalizations', { data: {
          type: 'gameCenterAchievementLocalizations',
          attributes: { locale: LOCALE, name: r.name, beforeEarnedDescription: r.text, afterEarnedDescription: r.text },
          relationships: { version: { data: { type: 'gameCenterAchievementVersions', id: version.id } } },
        } }))!.data;
        texts++;
      }
      const file = badge(r);
      if (!file) { missingBadges.push(r.id); continue; }
      const old = (await asc.call<{ data: Resource | null }>('GET', `/v2/gameCenterAchievementLocalizations/${loc.id}/image`))?.data;
      if (old && !replace.has(r.id)) continue;
      if (old) {
        // Images made through /v2 are deleted there; fall back to /v1 if this API version has no DELETE for them.
        try { await asc.call('DELETE', `/v2/gameCenterAchievementImages/${old.id}`); }
        catch (e) { if (!/: 40[45] /.test(String(e))) throw e; await asc.call('DELETE', `/v1/gameCenterAchievementImages/${old.id}`); }
        swapped++;
      }
      const bytes = readFileSync(file);
      const image = (await asc.call<{ data: Resource }>('POST', '/v2/gameCenterAchievementImages', { data: {
        type: 'gameCenterAchievementImages',
        attributes: { fileName: file.split('/').pop(), fileSize: bytes.length },
        relationships: { localization: { data: { type: 'gameCenterAchievementLocalizations', id: loc.id } } },
      } }))!.data;
      await asc.upload(attr(image, 'uploadOperations') as Parameters<AppStoreConnect['upload']>[0], bytes);
      await asc.call('PATCH', `/v2/gameCenterAchievementImages/${image.id}`, { data: { type: 'gameCenterAchievementImages', id: image.id, attributes: { uploaded: true } } });
      badges++;
      console.log(`${r.gameCenter}: ready`);
    }
    writeFileSync(`${root}src/meta/store-ids.ts`, storeIdsSource({ ...STORE_IDS, gameCenter: { ...STORE_IDS.gameCenter, enabled: true } }));
    console.log(`Game Center: ${made} made, ${rows.length - made} already there; ${texts} English texts and ${badges} badges added (${swapped} of them replacing an old one). Game Center is on in store-ids.ts.`);
    if (missingBadges.length) console.error(`No badge in ${images} for: ${missingBadges.join(', ')} (Art: npm run export:badges)`);
  }
}
