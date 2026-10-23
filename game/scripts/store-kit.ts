// Everything the store consoles need for the achievements (gameplay.md §18.5), from the game's own list:
//   achievements.json   one row per achievement for both consoles (src/meta/stores.ts storeRows)
//   play-games.csv      Play Console's fields, in its order
//   game-center.csv     App Store Connect's fields, in its order
//   badges.json         the list for Art's badge export (art: npm run export:badges -- badges.json)
//   node --experimental-strip-types scripts/store-kit.ts [outDir]

import { mkdirSync, writeFileSync } from 'node:fs';
import { BY_ID } from '../src/meta/achievements.ts';
import { storeRows } from '../src/meta/stores.ts';

const csv = (rows: (string | number | boolean)[][]): string =>
  rows.map(r => r.map(v => { const s = String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n') + '\n';

export function storeKit(): Record<string, string> {
  const rows = storeRows();
  const play = [['Name', 'Description', 'Icon', 'Incremental', 'Steps to unlock', 'Initial state', 'Points', 'List order']];
  const gc = [['Reference name', 'Achievement ID', 'Points', 'Hidden', 'Achievable more than once', 'Name (en-US)', 'Pre-earned description', 'Earned description', 'Image']];
  for (const r of rows) {
    play.push([r.name, r.text, `play/${r.id}.png`, r.steps ? 'Yes' : 'No', r.steps ?? '', r.hidden ? 'Hidden' : 'Revealed', r.points, r.order] as string[]);
    gc.push([r.name, r.gameCenter, r.points, r.hidden ? 'Yes' : 'No', 'No', r.name, r.text, r.text, `gamecenter/${r.id}.png`] as string[]);
  }
  // Art's export counts biomes from 0 (Meadow); the game from 1.
  const badges = rows.map(r => { const a = BY_ID.get(r.id)!; return { id: r.id, tier: a.tier, icon: a.icon, ...(a.biome ? { biome: a.biome - 1 } : {}) }; });
  return {
    'achievements.json': JSON.stringify(rows, null, 2) + '\n',
    'play-games.csv': csv(play),
    'game-center.csv': csv(gc),
    'badges.json': JSON.stringify(badges, null, 2) + '\n',
  };
}

if (process.argv[1]?.endsWith('store-kit.ts')) {
  const out = (process.argv[2] ?? 'store-kit').replace(/\/$/, '');
  mkdirSync(out, { recursive: true });
  for (const [name, text] of Object.entries(storeKit())) writeFileSync(`${out}/${name}`, text);
  console.log(`store kit -> ${out}/ (${storeRows().length} achievements)`);
}
