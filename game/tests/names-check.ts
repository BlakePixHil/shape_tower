// The ladder name rules and filter (gameplay.md §12.3): the format rules, a long list of rude names
// spelt every way people try (ROT13 here, like the word lists), real names and words from many
// languages that must pass (the Scunthorpe problem), look-alike names colliding, and reserved names.
// Run: npm run names:check

import { NAME_HINT, nameKey, nameProblem, nameShowable, placeholderName, tidyName } from '../src/meta/names/names.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}
const rot13 = (s: string): string => s.replace(/[a-z]/gi, c => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });

// ---------------------------------------------------------------- format

check('tidying folds spaces and trims', tidyName('  Big   Stack ') === 'Big Stack');
const fmt: [string, string | null][] = [
  ['ab', 'short'], ['A name far too long', 'long'], ['Bob!', 'chars'], ['Zoë', 'chars'], ['bob@mail', 'chars'], ['site.com', 'chars'], ['1234', 'letter'],
  ['_bob', 'spacing'], ['bo__b', 'spacing'], ['bob_', 'spacing'], ['bo - b', 'spacing'], ['booooob', 'repeat'], ['Call 5551234567', 'contact'], ['www Bob', 'contact'],
  ['Bob Gmail', 'contact'], ['Big Stack', null], ['Dash-9', null], ['Gamer_42', null],
];
const bad = fmt.filter(([n, p]) => nameProblem(n) !== p);
check('the format rules: length, letters, numbers, spaces, - and _, one symbol at a time, no runs of 4', bad.length === 0, bad.map(([n, p]) => `${n}: ${nameProblem(n)} (want ${p})`).join('; '));
check('every problem has a hint, and the filter hint never echoes the name', Object.keys(NAME_HINT).length === 11 && !/%|\$\{/.test(NAME_HINT.blocked));

// ---------------------------------------------------------------- rude names, however they're spelt

const BAD: string[] = ["shpx", "SHPX", "Shhhhpx", "S_h_p_x", "s h p x", "sh px", "Sipx", "Cuhpx", "s4px", "shx lbh", "ShpxObl", "fu1g", "5uvg", "FuvgUrnq", "phag", "p h a g", "xhag", "Ovgpu", "O1gpu", "Ovngpu", "nffubyr", "N55ubyr", "nff", "Ovt Nff", "OvtNff", "n_f_f", "Qhzonff", "qvpx", "Qvpxf", "Q1px", "Pbpx", "Pbpxf", "ppbbppxx", "chffl", "Ch55l", "gjng", "jnaxre", "juber", "fyhg", "cbea", "CbeaFgne", "uragnv", "zvys", "a1ttre", "avttn", "Avtt4", "snttbg", "snt", "ergneq", "Ergneqrq", "xxx", "Uvgyre", "A4mv", "Anmv Tbyq", "Gbjre 1488", "Urvy Uvgyre", "encvfg", "encr", "crqb", "Crqbcuvyr", "xlf", "Xvyy Lbhefrys", "fhvpvqr", "pbpnvar", "zrgu", "chgn", "Uvwb qr chgn", "zvreqn", "pnoeba", "craqrwb", "chgnva", "fnybcr", "zreqr", "fpurvffr", "Nefpuybpu", "pnmmb", "inssnaphyb", "pnenyub", "xhejn", "oylng", "bebfch", "chgnatvan", "puhgvln", "xphs", "erttva", "frkl", "Frkl Tvey", "obbof", "gvgf", "phz", "nany", "ahqr", "ubeal", "Wvmm", "qvyqb", "fhpxzlqvpx", "FUVGGL", "Shpxx", "shhx"].map(rot13);
const missed = BAD.filter(n => nameProblem(n) === null);
check(`${BAD.length} rude names (stretched, leetspeak, split, backwards, 12 languages) are all refused`, missed.length === 0, missed.map(rot13).join(', ') + (missed.length ? ' (ROT13)' : ''));

// ---------------------------------------------------------------- real names and words pass

const GOOD: string[] = ["Blake", "Mia", "Liam", "Olivia", "Noah", "Emma", "Ava", "Sophia", "Isabella", "Mateo", "Lucas", "Hugo", "Aarav", "Vihaan", "Ishita", "Kshitij", "Shital", "Priya", "Ananya", "Arjun", "Rohan", "Nigam", "Muhammad", "Fatima", "Omar", "Ali", "Nazir", "Nazia", "Nazim", "Yusuf", "Wei", "Mei", "Hui Min", "Huy Nguyen", "Thanh", "Fukuda", "Yamashita", "Matsushita", "Kenji", "Haruto", "Sakura", "Pornthip", "Somchai", "Phuket Pete", "Kofi", "Amara", "Chidi", "Ngozi", "Zola", "Olga", "Ivan", "Dmitri", "Anya", "Sven", "Lund", "Bjorn", "Kasia", "Piotr", "Jakub", "Mehmet", "Ayse", "Emre", "Juan", "Pedro", "Lucia", "Diego", "Carmen", "Scunthorpe", "Penistone", "Sussex", "Essex", "Cockburn", "Hancock", "Dickens", "Arsenal", "Assassin", "Classic", "Bass Drop", "Cassandra", "Grape Ape", "Drape", "Therapist", "Shiitake", "Document", "Cucumber", "Hello World", "Seashell", "Titan", "Title", "Spice Girl", "Technique", "Unique", "Computer", "Reputation", "Calculus", "Rebate", "Analyst", "Cocoon", "Raccoon", "Tycoon", "Pakistan", "Japanese", "Homer", "Hellen", "Wankel", "Swanky", "Retardant", "Niggle", "Snigger", "Kumar", "Butterfly", "Assembly", "Buttons", "Saturday", "Cumberbatch", "Clitheroe", "Montenegro", "Negroni", "Vergara", "Merdeka", "Merdan", "Shitao", "StackMaster", "TowerQueen", "BlockBuster", "Wobble King", "xXSniperXx", "Gamer_42", "Mr Bean", "Shapes4Days", "Tetris Fan", "Big Stack", "Night Owl", "Sky High", "Rocket Man", "Boo Boo", "Bob", "Ann", "Eve", "Hannah", "Otto", "Butt Kicker", "Isaac", "Dash-9", "Jo Jo", "Zed", "Tower of Pisa", "Pisces", "Cocktail", "Scrap Heap", "Hellraiser", "Tulsi", "Restful", "Trustful", "Rapping", "Hugging Bear", "Noggin", "Flimsy", "Philanthropic", "Trappist", "Overgame", "Claude", "Apple", "Nan", "Cognizant", "Bagging", "Wistful", "Bookkeeper", "Raccoon", "Coocoo", "Mississippi", "Hello Kitty"];
const wrong = GOOD.filter(n => nameProblem(n) !== null);
check(`${GOOD.length} real names, places and words that hide a rude one pass (Scunthorpe, Therapist, Ishita, Fukuda...)`, wrong.length === 0, wrong.map(n => `${n}: ${nameProblem(n)}`).join(', '));

// ---------------------------------------------------------------- look-alikes and reserved names

check('look-alike names share a key (Blake, B1ake, BLAKE, bla_ke)', new Set(['Blake', 'B1ake', 'BLAKE', 'bla_ke', 'Bla ke']).size === 5 && new Set(['Blake', 'B1ake', 'BLAKE', 'bla_ke', 'Bla ke'].map(nameKey)).size === 1);
check('different names keep different keys', nameKey('Blake') !== nameKey('Black') && nameKey('Sam') !== nameKey('Sammy'));
const reserved = ['Admin', 'Adm1n', 'Moderator', 'ShapeTower', 'Shape Tower', 'Official Bob', 'Builder 4821', 'Bu1lder 1234', 'Anthropic', 'Support', 'Mod'];
const notReserved = reserved.filter(n => nameProblem(n) !== 'reserved');
check('staff, the game, the platforms and the "Builder 1234" stand-ins are reserved', notReserved.length === 0, notReserved.join(', '));
check('a stand-in name is steady per player and never a real name', placeholderName('a1b2c3d4e5') === placeholderName('a1b2c3d4e5') && /^Builder \d{4}$/.test(placeholderName('a1b2c3d4e5')) && nameProblem(placeholderName('ffff0000')) === 'reserved');
check('names are checked again when shown', !nameShowable(BAD[0]) && nameShowable('Big Stack'));

console.log(failures ? `\n${failures} failed` : '\nall passing');
process.exit(failures ? 1 : 0);
