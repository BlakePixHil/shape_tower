// The name filter's word lists (src/meta/names/words.ts) are ROT13. This prints them plain, one list per
// block, or turns a plain list back into a line for the file:
//   node scripts/name-words.mjs                  prints STRONG, WEAK and ALLOW plain
//   node scripts/name-words.mjs encode < words   prints the words (any spacing) as one ROT13 line

import { readFileSync } from 'node:fs';

const rot13 = s => s.replace(/[a-z]/g, c => String.fromCharCode(((c.charCodeAt(0) - 97 + 13) % 26) + 97));

if (process.argv[2] === 'encode') {
  const words = readFileSync(0, 'utf8').toLowerCase().split(/\s+/).filter(Boolean);
  const bad = words.filter(w => !/^[a-z]+$/.test(w));
  if (bad.length) { console.error(`only a-z words: ${bad.join(' ')}`); process.exit(1); }
  console.log(words.map(rot13).join(' '));
} else {
  const src = readFileSync(new URL('../src/meta/names/words.ts', import.meta.url), 'utf8');
  for (const [, name, list] of src.matchAll(/export const (\w+) = '([a-z ]*)'/g)) console.log(`${name}:\n${rot13(list)}\n`);
}
