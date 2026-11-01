// Achievements preview: the list from gameplay.md §18.2 with a glyph each (the game keeps its own copy of the
// list; this one is for looking at the art). Some earned, some counting up, two secrets still hidden.

import {
  ACH_TIERS, achievementBadgeUrl, bakeAchievementForStore, bakeUiIcon, achievementStrip, achievementToast, achievementsPanel, achievementsRow, uiIconUrl,
  type AchTier, type AchievementGroup, type UiIcon,
} from '../src/index.ts';

type Row = [id: string, name: string, text: string, tier: AchTier, icon: UiIcon, biome?: number];
const B = 'bronze', S = 'silver', G = 'gold', P = 'platinum';

export const DEMO_LIST: [string, Row[]][] = [
  ['Climb', [
    ['cp_first', 'Off the Ground', 'Claim your first checkpoint', B, 'flag'],
    ['biome_2', 'Branching Out', 'Reach the Treetops', B, 'biome', 1],
    ['biome_3', 'Head in the Clouds', 'Reach Cloudlands', B, 'biome', 2],
    ['biome_4', 'Into the Storm', 'Reach the Storm Belt', S, 'biome', 3],
    ['biome_5', 'Thin Air', 'Reach the Stratosphere', S, 'biome', 4],
    ['biome_6', 'Liftoff', 'Reach Orbit', S, 'biome', 5],
    ['biome_7', 'One Small Step', 'Reach the Moon', G, 'biome', 6],
    ['biome_8', 'Red Rover', 'Reach the Red Planet', G, 'biome', 7],
    ['biome_9', 'Ring Leader', 'Reach the Ringed Giant', G, 'biome', 8],
    ['biome_10', 'Into the Deep', 'Reach Deep Cosmos', P, 'biome', 9],
    ['cp_30', 'Off the Map', 'Claim checkpoint 30 in one run', P, 'flag'],
    ['pb', 'New Heights', 'Beat your best height', B, 'tower'],
  ]],
  ['Craft', [
    ['perfect', 'Pixel Perfect', 'Place a Perfect', B, 'perfect'],
    ['combo_5', 'In the Zone', 'Place 5 Perfects in a row', S, 'combo'],
    ['combo_7', 'Seventh Heaven', 'Place 7 Perfects in a row (the ×4 combo)', G, 'combo'],
    ['row', 'Solid Ground', 'Make a Solid Row', B, 'row'],
    ['row_2', 'Double!', 'Make 2 Solid Rows with one shape', S, 'row'],
    ['row_3', 'Triple!', 'Make 3 Solid Rows with one shape', G, 'row'],
    ['grade_s', 'Flat Out', 'Claim a checkpoint with an S foundation', S, 'check'],
    ['grade_s3', 'Spirit Level', 'Claim 3 checkpoints in a row with S foundations', G, 'check'],
    ['thrifty', 'Penny Pincher', 'Claim a checkpoint with an A or S foundation and 8 or more bricks to spare', S, 'brick'],
    ['last_brick', 'Just Enough', 'Claim a checkpoint with your very last brick', S, 'brick'],
    ['clutch', 'Clutch!', 'Save a shape the guide said would tip', B, 'clutch'],
    ['clutch_3', 'Nerves of Steel', 'Make 3 Clutch saves in one run', S, 'clutch'],
  ]],
  ['Survive', [
    ['last_heart', 'By a Thread', 'Claim a checkpoint on your last heart', B, 'heart'],
    ['calm_2', 'Weathervane', 'Get through the Treetops without losing a heart', B, 'wind'],
    ['flawless_3', 'Steady Hands', 'Reach Cloudlands without losing a heart', S, 'heart'],
    ['calm_4', 'Eye of the Storm', 'Get through the Storm Belt without losing a heart', S, 'wind'],
    ['flawless_6', 'Iron Tower', 'Reach Orbit without losing a heart', G, 'heart'],
    ['calm_6', 'Dodgeball', 'Get through Orbit without losing a heart', G, 'junk'],
    ['calm_7', 'Meteor Proof', 'Get through the Moon without losing a heart', G, 'meteor'],
  ]],
  ['Power-ups', [
    ['bubble', 'Bubble Pop', 'Steer through a power bubble', B, 'gift'],
    ['toolbox', 'Toolbox', 'Use all five power-ups (counts across runs)', S, 'toolbox'],
    ['comeback', 'Comeback Kid', 'Use Second Wind, then claim 3 more checkpoints in the same run', S, 'restart'],
    ['purist', 'No Help Needed', 'Reach the Storm Belt without using a power-up or Second Wind', G, 'purist'],
    ['bubbles_50', 'Bubble Wrap', 'Collect 50 power bubbles', S, 'gift'],
  ]],
  ['Lifetime', [
    ['bricks_1k', 'Brick by Brick', 'Place 1,000 bricks', B, 'brick'],
    ['bricks_10k', 'Great Wall', 'Place 10,000 bricks', G, 'brick'],
    ['perfects_250', 'Perfectionist', 'Place 250 Perfects', S, 'perfect'],
    ['rows_100', 'Rock Solid', 'Make 100 Solid Rows', S, 'row'],
    ['cps_100', 'Centurion', 'Claim 100 checkpoints', S, 'flag'],
    ['streak_3', 'Hooked', 'Play 3 days in a row', B, 'streak'],
    ['streak_7', 'Creature of Habit', 'Play 7 days in a row', S, 'streak'],
  ]],
  ['Secret', [
    ['avalanche', 'Avalanche!', 'Lose 5 pieces in one tumble', B, 'avalanche'],
    ['so_close', 'So Close!', 'Run out of bricks within a block of the line', B, 'brick'],
    ['do_over', 'Do-Over', 'Undo a shape, then place it again as a Perfect', B, 'undo'],
    ['needle', 'Needle Threader', 'Claim a checkpoint with a tower so thin it gets the smallest foundation', B, 'needle'],
  ]],
];

const EARNED = new Set(['cp_first', 'biome_2', 'biome_3', 'biome_4', 'pb', 'perfect', 'combo_5', 'row', 'row_2', 'grade_s', 'clutch', 'last_heart', 'calm_2', 'bubble', 'streak_3', 'avalanche', 'needle']);
const PROGRESS: Record<string, [number, number]> = { bricks_1k: [640, 1000], bricks_10k: [640, 10000], perfects_250: [112, 250], rows_100: [57, 100], cps_100: [31, 100], bubbles_50: [18, 50], toolbox: [3, 5], streak_7: [3, 7] };

export function demoGroups(all = false): AchievementGroup[] {
  return DEMO_LIST.map(([name, rows]) => ({
    name,
    items: rows.map(([id, n, text, tier, icon, biome]) => ({
      id, name: n, text, tier, icon, biome, secret: name === 'Secret',
      got: all || EARNED.has(id) ? '2026-10-21' : undefined, progress: PROGRESS[id],
    })),
  }));
}

const NEW_GLYPHS: UiIcon[] = ['combo', 'avalanche', 'toolbox', 'undo', 'needle', 'purist'];

/** Blockling Pop's 16 (game/src/meta/achievements.ts, group 'pop'): badges with pop: true. */
const POP_LIST: Row[] = [
  ['pop_first', 'Pop!', 'Pop your first line', B, 'row'], ['pop_double', 'Double Trouble', 'Pop 2 lines with one shape', B, 'row'],
  ['pop_daily', 'Daily Popper', 'Finish a scored Daily Pop', B, 'daily'], ['pop_10k', 'Five Digits', 'Score 10,000 in one run', B, 'score'],
  ['pop_bag', 'Saved by the Bag', 'Place the bagged shape and pop a line', B, 'bag'], ['pop_clear', 'Squeaky Clean', 'Get an All Clear', S, 'star'],
  ['pop_combo_8', 'On a Roll', 'Reach combo 8', S, 'combo'], ['pop_triple', 'Hat Trick', 'Pop 3 lines with one shape', S, 'row'],
  ['pop_lines_1k', 'Line Dancer', 'Pop 1,000 lines in all', S, 'shapes'], ['pop_world', 'Star Student', '3 stars on every puzzle in a world', S, 'star'],
  ['pop_quad', 'Towering Pop', 'Pop 4 or more lines with one shape', G, 'tower'], ['pop_combo_15', 'Unstoppable', 'Reach combo 15', G, 'combo'],
  ['pop_moon', 'Pop to the Moon', 'Reach the Moon in one run', G, 'biome', 6], ['pop_bare', 'Bare Hands', 'Score 20,000 with no help', G, 'purist'],
  ['pop_clears_10', 'Neat Freak', 'Get 10 All Clears', G, 'swirl'], ['pop_cosmos', 'Pop Star', 'Reach Deep Cosmos in one run', P, 'biome', 9],
];

/** The sheet: every badge earned, locked and secret, the new glyphs, the tiers, a toast, the strip and the profile row. */
export function achievementsSheet(root: HTMLElement): void {
  const rows = DEMO_LIST.flatMap(([, r]) => r);
  const img = (src: string, px: number, title = '') => `<img alt="" title="${title}" style="width:${px}px;height:${px}px" src="${src}">`;
  root.innerHTML = `<h3>Tiers</h3><div class="pv-wrap">${(Object.keys(ACH_TIERS) as AchTier[]).map(t =>
      `<div class="pv-cell">${img(achievementBadgeUrl({ icon: 'trophy', tier: t }, 96), 96)}${ACH_TIERS[t].name}</div>`).join('')}</div>
    <h3>New glyphs</h3><div class="pv-wrap">${NEW_GLYPHS.map(n => `<div class="pv-cell">${img(uiIconUrl(n, 48), 48)}${n}</div>`).join('')}</div>
    <h3>All ${rows.length}, earned</h3><div class="pv-wrap">${rows.map(([, n, , tier, icon, biome]) => img(achievementBadgeUrl({ icon, tier, biome }, 64), 64, n)).join('')}</div>
    <h3>Locked and secret</h3><div class="pv-wrap">${rows.map(([id, n, , tier, icon, biome]) =>
      img(achievementBadgeUrl(DEMO_LIST[5][1].some(r => r[0] === id) ? { icon, tier, secret: true } : { icon, tier, biome, locked: true }, 64), 64, n)).join('')}</div>
    <h3>Blockling Pop (pop: true), earned</h3><div class="pv-wrap">${POP_LIST.map(([, n, , tier, icon, biome]) => img(achievementBadgeUrl({ icon, tier, biome, pop: true }, 64), 64, n)).join('')}</div>
    <h3>Blockling Pop, locked; and twins: tower, then Pop</h3><div class="pv-wrap">${POP_LIST.slice(0, 6).map(([, n, , tier, icon, biome]) => img(achievementBadgeUrl({ icon, tier, biome, pop: true, locked: true }, 64), 64, n)).join('')}
      ${([['bronze', 'row'], ['silver', 'star'], ['silver', 'combo']] as [AchTier, UiIcon][]).map(([tier, icon]) => img(achievementBadgeUrl({ icon, tier }, 64), 64) + img(achievementBadgeUrl({ icon, tier, pop: true }, 64), 64)).join('')}</div>
    <h3>Blockling Pop small (32 and 44 px)</h3><div class="pv-wrap">${POP_LIST.slice(0, 8).map(([, n, , tier, icon]) => img(achievementBadgeUrl({ icon, tier, pop: true }, 32), 32, n)).join('')}${POP_LIST.slice(8, 12).map(([, n, , tier, icon]) => img(achievementBadgeUrl({ icon, tier, pop: true }, 44), 44, n)).join('')}</div>
    <h3>Small (32 px)</h3><div class="pv-wrap">${rows.slice(0, 16).map(([, n, , tier, icon, biome]) => img(achievementBadgeUrl({ icon, tier, biome }, 32), 32, n)).join('')}</div>
    <h3>Run summary strip</h3><div class="ui-panel pv-strip" style="max-width:344px"></div>
    <h3>Profile row</h3><div class="pv-row" style="max-width:344px"></div>
    <h3>Toast</h3><div class="pv-toasts" style="position:relative;display:flex;flex-direction:column;gap:12px"></div>`;
  root.querySelector('.pv-strip')!.appendChild(achievementStrip([
    { name: 'Head in the Clouds', tier: 'bronze', icon: 'biome', biome: 2 }, { name: 'In the Zone', tier: 'silver', icon: 'combo' },
    { name: 'Double!', tier: 'silver', icon: 'row' }, { name: 'Avalanche!', tier: 'bronze', icon: 'avalanche' }, { name: 'On a Roll', tier: 'silver', icon: 'combo', pop: true },
  ]));
  root.querySelector('.pv-row')!.appendChild(achievementsRow({ got: EARNED.size, total: rows.length }));
  // Toasts held in place (stay) so they can be looked at; the real one slides in and out.
  const host = root.querySelector('.pv-toasts')!;
  ([[{ name: 'Head in the Clouds', tier: 'bronze', icon: 'biome', biome: 2 }, {}], [{ name: 'Seventh Heaven', tier: 'gold', icon: 'combo', more: 2 }, {}],
    [{ name: 'Into the Deep', tier: 'platinum', icon: 'biome', biome: 9 }, {}], [{ name: 'Eye of the Storm', tier: 'silver', icon: 'wind' }, { plain: true }],
    [{ name: 'Squeaky Clean', tier: 'silver', icon: 'star', pop: true }, {}]] as const).forEach(([d, o]) => {
    const t = achievementToast({ ...d }, { ...o, stay: true });
    t.style.position = 'relative'; t.style.top = '0';
    host.appendChild(t);
  });
}

/** The panel over the scene; &all=1 shows everything earned. */
export function achievementsDemoPanel(all: boolean): HTMLElement {
  return achievementsPanel({ groups: demoGroups(all) });
}

/** One toast at a time, as in a run: the first three, then "+N more". */
export function achievementsDemoToasts(still: boolean, plain: boolean): void {
  const seq = [
    { name: 'Head in the Clouds', tier: 'bronze', icon: 'biome', biome: 2 }, { name: 'In the Zone', tier: 'silver', icon: 'combo' },
    { name: 'Triple!', tier: 'gold', icon: 'row', more: 2 },
  ] as const;
  // Each waits for the one before it to leave, as the game queues them.
  const show = (i: number): void => {
    if (i >= seq.length) return;
    const t = document.body.appendChild(achievementToast({ ...seq[i] }, { still, plain }));
    const wait = setInterval(() => { if (!t.isConnected) { clearInterval(wait); setTimeout(() => show(i + 1), 250); } }, 100);
  };
  setTimeout(() => show(0), 400);
}

// For scripts/export-badges.mjs: ?export=1 exposes this list and the store bake to the page.
if (new URLSearchParams(location.search).has('export')) {
  Object.assign(window, {
    achievementExport: {
      list: [...DEMO_LIST.flatMap(([, rows]) => rows.map(([id, , , tier, icon, biome]) => ({ id, tier, icon, biome }))),
        ...POP_LIST.map(([id, , , tier, icon, biome]) => ({ id, tier, icon, biome, pop: true }))],
      bake: (b: { tier: AchTier; icon: UiIcon; biome?: number; pop?: boolean }, store: 'play' | 'gamecenter') => bakeAchievementForStore(b, store).toDataURL('image/png'),
      icon: (name: UiIcon, px: number) => bakeUiIcon(name, px).toDataURL('image/png'),
    },
  });
}
