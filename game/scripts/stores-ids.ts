// Fills in the Play Games half of src/meta/store-ids.ts from Play Console's export (Play Games Services >
// Achievements > Get resources > Android XML, saved as games-ids.xml), and the Android project id resource
// the plugin reads. Game Center's ids need nothing: they are ours (store-ids.ts prefix + the game's id).
//   node --experimental-strip-types scripts/stores-ids.ts games-ids.xml [--gamecenter]
//   --gamecenter also turns Game Center on, once the achievements exist in App Store Connect.

import { readFileSync, writeFileSync } from 'node:fs';
import { ACHIEVEMENTS } from '../src/meta/achievements.ts';
import { STORE_IDS } from '../src/meta/store-ids.ts';

/** Play Console names each id after the achievement: `achievement_` and the name in lower case, other characters as `_`. */
export const playResName = (name: string): string => 'achievement_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** The project id and each of the game's achievements' Play id, matched by the comment Play Console writes above each one, or by resource name. */
export function parseGamesIds(xml: string): { projectId: string; achievements: Record<string, string>; missing: string[] } {
  const byName = new Map<string, string>(), byRes = new Map<string, string>();
  let projectId = '';
  const re = /(?:<!--\s*(.*?)\s*-->\s*)?<string\s+name="([^"]+)"[^>]*>\s*([^<]*?)\s*<\/string>/g;
  for (const m of xml.matchAll(re)) {
    const [, comment, res, value] = m;
    if (res === 'app_id') projectId = value;
    byRes.set(res, value);
    const named = comment?.match(/^achievement\s+(.+)$/i);
    if (named) byName.set(named[1].trim().toLowerCase(), value);
  }
  const achievements: Record<string, string> = {}, missing: string[] = [];
  for (const a of ACHIEVEMENTS) {
    const id = byName.get(a.name.toLowerCase()) ?? byRes.get(playResName(a.name));
    if (id) achievements[a.id] = id; else missing.push(a.id);
  }
  return { projectId, achievements, missing };
}

export function storeIdsSource(ids: typeof STORE_IDS): string {
  const play = Object.entries(ids.play.achievements).map(([k, v]) => `    ${k}: '${v}',`).join('\n');
  return `// The store consoles' ids for the achievements (gameplay.md §18.5). \`npm run stores:ids\` writes the Play
// Games half from the console's export, together with the Android project id resource.

export const STORE_IDS = {
  /** Google Play Games: the game's project id and each achievement's id, both made by Play Console. Empty until then. */
  play: { projectId: '${ids.play.projectId}', achievements: {${play ? `\n${play}\n  ` : ''}} as Record<string, string> },
  /**
   * Game Center: ids are ours to pick, so they are fixed now (prefix + the game's id) and must match App Store
   * Connect exactly. \`enabled\` once they exist there.
   */
  gameCenter: { enabled: ${ids.gameCenter.enabled}, prefix: '${ids.gameCenter.prefix}' },
};
`;
}

/** The app's own copy of the plugin's project id string (it overrides the plugin's empty one). */
export const projectIdResource = (projectId: string): string => `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- The Play Games project id (scripts/stores-ids.ts): turns plugins/game-services on. -->
    <string name="game_services_project_id" translatable="false">${projectId}</string>
</resources>
`;

if (process.argv[1]?.endsWith('stores-ids.ts')) {
  const file = process.argv[2];
  if (!file) { console.error('usage: stores-ids.ts games-ids.xml [--gamecenter]'); process.exit(1); }
  const parsed = parseGamesIds(readFileSync(file, 'utf8'));
  if (!/^\d+$/.test(parsed.projectId)) { console.error('No numeric app_id in that file'); process.exit(1); }
  const ids = { play: { projectId: parsed.projectId, achievements: parsed.achievements }, gameCenter: { ...STORE_IDS.gameCenter, enabled: STORE_IDS.gameCenter.enabled || process.argv.includes('--gamecenter') } };
  const root = new URL('..', import.meta.url).pathname;
  writeFileSync(`${root}src/meta/store-ids.ts`, storeIdsSource(ids));
  writeFileSync(`${root}android/app/src/main/res/values/game_services.xml`, projectIdResource(parsed.projectId));
  console.log(`Play Games project ${parsed.projectId}: ${Object.keys(parsed.achievements).length} of ${ACHIEVEMENTS.length} achievements`);
  if (parsed.missing.length) { console.error(`Not in the export: ${parsed.missing.join(', ')}`); process.exit(2); }
}
