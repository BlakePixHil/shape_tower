// A seasoned player for the app's screens (the store screenshots and the Short): level 18, a streak, the
// Builder's Pass look, a few scored Dailies and half the achievements, so the screens look lived in.

export const today = new Date().toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const EARNED = ['cp_first', 'biome_2', 'biome_3', 'biome_4', 'biome_5', 'biome_6', 'biome_7', 'pb', 'perfect', 'combo_5', 'combo_7', 'row', 'row_2', 'clutch',
  'last_heart', 'calm_2', 'flawless_3', 'bubble', 'toolbox', 'comeback', 'streak_3', 'daily_first', 'avalanche', 'so_close'];
/** The test store's purchases (game/src/store/store.ts): the Builder's Pass, so the look shows its items. */
export const STORE = { 'shape-tower-test-store-v1': '["builders_pass"]', 'shape-tower-owned-v1:test': '["builders_pass"]' };
export const SEASONED = {
  level: 18, xp: 340, total: 14800, runs: 140, streak: 6, lastDay: today, boostDay: today, askedGhost: true, windDay: today, sliceRuns: 2, player: 'p-clips',
  stats: { bestHeight: 214.6, bestBiome: 7, bricks: 6240, perfects: 980, rows: 210, checkpoints: 420, clutches: 61 },
  seenGusts: true, seenHazards: ['crosswind', 'junk', 'meteor', 'dust', 'sway'], seenBrittle: true, passIntro: true,
  postcards: [...Array(7).fill(today), null, null, null], avatar: { shape: 'O', face: 'idle', hat: 'cowboy' },
  // Builder's Pass items up to level 18 (art/src/cosmetics.ts PASS_ITEMS).
  look: { skin: 'skin_stars', landing: 'landing_hearts', foundation: 'foundation_marble', flag: 'flag_heart' },
  // Their last few scored Dailies (today's try still open).
  daily: { scored: Object.fromEntries([[1, 41.2, 3, 2], [2, 63.8, 4, 3], [3, 52.5, 4, 3]].map(([d, h, c, b]) => [daysAgo(d), { height: h, score: Math.round(h * 950), checkpoints: c, biome: b, finished: true, at: `${daysAgo(d)}T08:00:00.000Z`, v: 2 }])), practice: {} },
  achievements: Object.fromEntries(EARNED.map((id, i) => [id, { at: daysAgo(30 - i), paid: true }])),
  achCounts: { bubbles: 40, powers: ['glue', 'slowmo', 'undo', 'quickset', 'clean'] },
};
