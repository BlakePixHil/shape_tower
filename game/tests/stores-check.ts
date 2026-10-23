// Play Games and Game Center (gameplay.md §18.5): the id and points table both consoles get, the sync that
// passes unlocks and progress on (with a stand-in for the native plugin), that the game page and builds made
// before the consoles are set up send nothing, and the script that reads Play Console's games-ids.xml.
// Run: npm run stores:check

import { ACHIEVEMENTS, freshCounts } from '../src/meta/achievements.ts';
import { STORE_IDS } from '../src/meta/store-ids.ts';
import { StoreSync, isIncremental, storeRows, type GameServicesApi, type StoreService } from '../src/meta/stores.ts';
import type { Profile } from '../src/view/profile.ts';
import { parseGamesIds, playResName, projectIdResource, storeIdsSource } from '../scripts/stores-ids.ts';
import { storeKit } from '../scripts/store-kit.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

function profile(over: Partial<Profile> = {}): Profile {
  return {
    level: 1, xp: 0, total: 0, runs: 0, streak: 0, lastDay: '', boostDay: '', askedGhost: false, windDay: '',
    stats: { bestHeight: 0, bestBiome: 1, bricks: 0, perfects: 0, rows: 0, checkpoints: 0, clutches: 0 },
    sliceRuns: 0, player: 'test', seenGusts: false, seenHazards: [], postcards: Array(10).fill(null),
    avatar: { shape: 'O', face: 'idle', hat: 'party' }, achievements: {}, achCounts: freshCounts(), ...over,
  } as Profile;
}

/** The native plugin as the sync sees it, recording every call. */
function fakeApi(o: { service?: StoreService; available?: boolean; signedIn?: boolean; signInOk?: boolean; fail?: boolean } = {}) {
  const calls: string[] = [];
  let listener: ((e: { signedIn: boolean }) => void) | null = null;
  const api: GameServicesApi = {
    status: async () => ({ available: o.available ?? true, signedIn: o.signedIn ?? false, service: o.service ?? 'play' }),
    signIn: async () => { calls.push('signIn'); return { signedIn: o.signInOk ?? true }; },
    unlock: async ({ id }) => { calls.push(`unlock ${id}`); if (o.fail) throw new Error('offline'); return { sent: true }; },
    progress: async ({ id, steps, total }) => { calls.push(`progress ${id} ${steps}/${total}`); return { sent: true }; },
    show: async () => { calls.push('show'); },
    addListener: async (_e, cb) => { listener = cb; },
  };
  return { api, calls, fire: (signedIn: boolean) => listener?.({ signedIn }) };
}

const PLAY_IDS = { play: { projectId: '123456789012', achievements: Object.fromEntries(ACHIEVEMENTS.map((a, i) => [a.id, `CgkI${i}`])) }, gameCenter: { enabled: true, prefix: 'shapetower.' } };
const played = () => profile({
  achievements: { cp_first: { at: '2026-10-21', paid: true }, bricks_1k: { at: '2026-10-22', paid: true } },
  stats: { bestHeight: 30, bestBiome: 2, bricks: 1300, perfects: 40, rows: 0, checkpoints: 3, clutches: 0 },
});

// ---------------------------------------------------------------- the table

{
  const rows = storeRows(PLAY_IDS);
  check('One row per achievement, in the game\'s order', rows.length === ACHIEVEMENTS.length && rows.every((r, i) => r.id === ACHIEVEMENTS[i].id && r.order === i + 1), `${rows.length}`);
  const pts = rows.reduce((s, r) => s + r.points, 0);
  check('Points fit both consoles: multiples of 5, 100 at most each and 1,000 in all (Game Center\'s caps; Play Games allows 200 and 2,000)', pts <= 1000 && rows.every(r => r.points % 5 === 0 && r.points >= 5 && r.points <= 100), `${pts} in all`);
  check('The secret ones are hidden there too, and only they', rows.filter(r => r.hidden).map(r => r.id).join() === ACHIEVEMENTS.filter(a => a.secret).map(a => a.id).join(), rows.filter(r => r.hidden).map(r => r.id).join(', '));
  const inc = rows.filter(r => r.steps);
  check('Counted ones are incremental with their goal as steps; streaks stay plain unlocks', inc.length > 0 && inc.every(r => r.steps === ACHIEVEMENTS.find(a => a.id === r.id)!.goal) && !inc.some(r => r.id.startsWith('streak_')), inc.map(r => `${r.id}:${r.steps}`).join(', '));
  check('Incremental steps are at least 2 (one step would be a plain unlock) and at most 10,000', inc.every(r => r.steps! >= 2 && r.steps! <= 10000));
  const gc = rows.map(r => r.gameCenter);
  check('Game Center ids are unique, at most 100 characters of letters, digits, "." and "_"', new Set(gc).size === gc.length && gc.every(id => /^[A-Za-z0-9._]{1,100}$/.test(id)), gc[0]);
  check('Names and descriptions fit the consoles (100 and 500 characters at most)', rows.every(r => r.name.length <= 100 && r.text.length <= 500 && r.name.trim() === r.name));
  check('Play ids come from the table; missing ones are empty', storeRows(STORE_IDS).every(r => r.play === (STORE_IDS.play.achievements[r.id] ?? '')) && rows[0].play === 'CgkI0');
}

// ---------------------------------------------------------------- nothing until it should

{
  const s = new StoreSync(null);
  await s.start(played());
  check('The game page (no plugin) sends nothing and has no button', !s.available && s.label() === null && !(await s.open(played())));

  const f = fakeApi({ signedIn: true });
  const t = new StoreSync(f.api, STORE_IDS);
  await t.start(played());
  await t.sync(played());
  await t.report('cp_first');
  const unset = !/^\d+$/.test(STORE_IDS.play.projectId);
  check('Before Play Console is set up (no project id) nothing is sent, even signed in', !unset || (f.calls.length === 0 && !t.available && t.label() === null), f.calls.join(', '));

  const g = fakeApi({ service: 'gamecenter', signedIn: true });
  const u = new StoreSync(g.api, { ...STORE_IDS, gameCenter: { ...STORE_IDS.gameCenter, enabled: false } });
  await u.start(played());
  check('Game Center stays off until its achievements exist (enabled false)', g.calls.length === 0 && u.label() === null);

  const h = fakeApi({ available: false, signedIn: true });
  const v = new StoreSync(h.api, PLAY_IDS);
  await v.start(played());
  check('No Play services on the phone: nothing sent', h.calls.length === 0 && !v.available);
}

// ---------------------------------------------------------------- the sync

{
  const f = fakeApi({ signedIn: true });
  const s = new StoreSync(f.api, PLAY_IDS);
  const p = played();
  await s.start(p);
  const want = ['unlock CgkI0', 'progress CgkI' + ACHIEVEMENTS.findIndex(a => a.id === 'bricks_1k') + ' 1000/1000'];
  check('Signed in at launch: every unlock is sent (a counted one as all its steps)', want.every(c => f.calls.includes(c)), f.calls.join(', '));
  const perfects = ACHIEVEMENTS.findIndex(a => a.id === 'perfects_250'), tenK = ACHIEVEMENTS.findIndex(a => a.id === 'bricks_10k');
  check('Counted ones not earned yet send their progress', f.calls.includes(`progress CgkI${perfects} 40/250`) && f.calls.includes(`progress CgkI${tenK} 1300/10000`), f.calls.filter(c => c.startsWith('progress')).join(', '));
  check('Nothing at 0 progress, and nothing for unearned plain ones', !f.calls.some(c => c.includes(`CgkI${ACHIEVEMENTS.findIndex(a => a.id === 'rows_100')} `)) && !f.calls.includes(`unlock CgkI${ACHIEVEMENTS.findIndex(a => a.id === 'perfect')}`));
  check('The label names the service', s.label() === 'Google Play Games');

  const before = f.calls.length;
  await s.sync(p);
  check('A second sync with nothing new sends nothing', f.calls.length === before, f.calls.slice(before).join(', '));
  p.stats.perfects = 41;
  p.achievements.perfect = { at: '2026-10-23', paid: false };
  await s.sync(p);
  const fresh = f.calls.slice(before);
  check('Then only what changed: the new unlock and higher progress', fresh.length === 2 && fresh.includes(`unlock CgkI${ACHIEVEMENTS.findIndex(a => a.id === 'perfect')}`) && fresh.includes(`progress CgkI${perfects} 41/250`), fresh.join(', '));
  await s.report('perfect');
  check('report() of something already sent sends nothing', f.calls.length === before + 2);
}

{
  const f = fakeApi({ signedIn: false });
  const s = new StoreSync(f.api, PLAY_IDS);
  const p = played();
  await s.start(p);
  await s.report('cp_first');
  check('Signed out: nothing is sent, and the game never asks to sign in by itself', f.calls.length === 0, f.calls.join(', '));
  check('The button still shows (it is how a player signs in)', s.label() === 'Google Play Games');
  const opened = await s.open(p);
  check('The button signs in, catches up, then opens the store\'s screen', opened && f.calls[0] === 'signIn' && f.calls.at(-1) === 'show' && f.calls.includes('unlock CgkI0'), f.calls.join(', '));

  const g = fakeApi({ signedIn: false, signInOk: false });
  const t = new StoreSync(g.api, PLAY_IDS);
  await t.start(p);
  check('A cancelled sign-in opens nothing and sends nothing', !(await t.open(p)) && g.calls.join() === 'signIn');

  const h = fakeApi({ signedIn: false });
  const u = new StoreSync(h.api, PLAY_IDS);
  await u.start(p);
  h.fire(true);
  await new Promise(r => setTimeout(r, 0));
  check('Signing in elsewhere (Play Games\' own sign-in) catches up straight away', h.calls.includes('unlock CgkI0'), h.calls.join(', '));
}

{
  const f = fakeApi({ signedIn: true, fail: true });
  const s = new StoreSync(f.api, PLAY_IDS);
  const p = played();
  await s.start(p);
  const n = f.calls.filter(c => c.startsWith('unlock')).length;
  await s.sync(p);
  check('A failed send is tried again at the next sync, and never throws', f.calls.filter(c => c.startsWith('unlock')).length === n * 2 && n > 0, `${n} then ${f.calls.filter(c => c.startsWith('unlock')).length}`);

  const g = fakeApi({ service: 'gamecenter', signedIn: true });
  const t = new StoreSync(g.api, PLAY_IDS);
  await t.start(p);
  check('Game Center gets our own ids (prefix + id)', g.calls.includes('unlock shapetower.cp_first') && g.calls.includes('progress shapetower.bricks_1k 1000/1000') && t.label() === 'Game Center', g.calls.slice(0, 3).join(', '));
  check('Every achievement counts as incremental or not the same way everywhere', ACHIEVEMENTS.every(a => isIncremental(a) === !!storeRows(PLAY_IDS).find(r => r.id === a.id)!.steps));
}

// ---------------------------------------------------------------- Play Console's export

{
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<!--Google Play game services IDs. Save this file as res/values/games-ids.xml in your project.-->
<resources>
  <!--app_id-->
  <string name="app_id" translatable="false">123456789012</string>
  <!--package_name-->
  <string name="package_name" translatable="false">com.blakepixhil.shapetower</string>
${ACHIEVEMENTS.map((a, i) => i % 2 ? `  <!--achievement ${a.name}-->\n  <string name="${playResName(a.name)}" translatable="false">CgkIid${i}</string>` : `  <string name="${playResName(a.name)}" translatable="false">CgkIid${i}</string>`).join('\n')}
</resources>`;
  const r = parseGamesIds(xml);
  check('games-ids.xml: the project id and every achievement, by comment or by name', r.projectId === '123456789012' && r.missing.length === 0 && ACHIEVEMENTS.every((a, i) => r.achievements[a.id] === `CgkIid${i}`), `missing ${r.missing.join(', ')}`);
  check('Resource-name fallback when an entry has no comment', playResName('Double!') === 'achievement_double' && playResName('Do-Over') === 'achievement_do_over' && playResName('Clutch!') === 'achievement_clutch');
  const partial = parseGamesIds(xml.replace(/<string name="achievement_off_the_ground"[^\n]*\n/, ''));
  check('One missing from the export is reported, not guessed', partial.missing.join() === 'cp_first', partial.missing.join());
  const src = storeIdsSource({ play: { projectId: r.projectId, achievements: r.achievements }, gameCenter: { enabled: true, prefix: 'shapetower.' } });
  check('The table it writes is valid and has them all', src.includes("projectId: '123456789012'") && src.includes("cp_first: 'CgkIid0',") && src.includes('enabled: true'));
  check('And the Android resource the plugin reads', projectIdResource('123456789012').includes('name="game_services_project_id" translatable="false">123456789012<'));
  const current = storeIdsSource(STORE_IDS);
  const { readFileSync } = await import('node:fs');
  check('Rewriting the current table changes nothing (the script and the file agree)', readFileSync(new URL('../src/meta/store-ids.ts', import.meta.url).pathname, 'utf8') === current);
}

// ---------------------------------------------------------------- the kit

{
  const kit = storeKit();
  const play = kit['play-games.csv'].trim().split('\n'), gc = kit['game-center.csv'].trim().split('\n');
  check('Kit: one CSV line per achievement for each console, plus the header', play.length === ACHIEVEMENTS.length + 1 && gc.length === ACHIEVEMENTS.length + 1);
  const badges = JSON.parse(kit['badges.json']) as { id: string; biome?: number }[];
  check('Badges list for Art\'s export counts biomes from 0', badges.find(b => b.id === 'biome_2')?.biome === 1 && badges.length === ACHIEVEMENTS.length);
  check('A comma in a name or text is quoted', !kit['play-games.csv'].split('\n').some(l => l && l.split(',').length < 8));
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
