// The game's side of the ladder's receipt checks (monetisation plan, stage 3), without a browser: a look
// with a bought portrait carries the store's receipt for it, a portrait the ladder won't show yet stays
// the player's pick (so it can go again) while others see the one the ladder answered, and nothing
// else changes. The ladder here is the server's own rules (online/src/handler.ts) with a stand-in store check.
// Run: npm run shop:check (transform-types: online.ts has parameter properties)

import { Ladder, type LadderBackend } from '../src/online/online.ts';
import type { LadderReply, LadderRequest, Receipt } from '../src/online/protocol.ts';
import { portraitProducts } from '../src/meta/shop.ts';
import { PORTRAITS, portraitBought } from '../src/meta/portraits.ts';
import { handle } from '../../online/src/handler.ts';
import { MemoryStore } from '../../online/src/store.ts';
import type { ReceiptCheck } from '../../online/src/receipts.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}

check('the bought portraits are exactly the shop styles and the Supporter one', PORTRAITS.filter(p => portraitBought(p.id)).map(p => p.id).join() === 'bubblegum,checkers,retro,rainbow,lava_lamp,disco,supporter');
check('each bought portrait has the products that give it; earned ones have none',
  portraitProducts('disco').join() === 'portrait_disco' && portraitProducts('supporter').join() === 'supporter_pack,supporter_upgrade_pass,supporter_upgrade_ads,supporter_upgrade_both'
  && PORTRAITS.every(p => portraitBought(p.id) === portraitProducts(p.id).length > 0));

const sent: LadderRequest[] = [];
const fakeCheck: ReceiptCheck = async r => (r.store === 'play' && r.token === 'good' ? { ok: true, purchase: `play:${r.token}` } : { ok: false, why: 'invalid' });
const store = new MemoryStore();
const backend: LadderBackend = { kind: 'api', call: async req => { sent.push(req); return handle(req, store, Date.now(), fakeCheck) as Promise<LadderReply>; } };
const ladder = new Ladder(backend);
let receipt: Receipt | null = null;
ladder.receiptFor = p => (p === 'disco' ? receipt : null);
const avatar = { shape: 'T', face: 'grin', hat: null };
const last = () => sent[sent.length - 1];

await ladder.setName('Disco Dee', { portrait: 'sunset', avatar });
check('a free portrait goes without a receipt', ladder.me?.portrait === 'sunset' && !last().receipt);
await ladder.setLook({ portrait: 'disco', avatar });
check('a bought portrait with no receipt on this phone (the test store): others see the one before', ladder.me?.portrait === 'sunset' && !last().receipt, JSON.stringify(ladder.me));
check('...and it stays their pick, waiting to go again', ladder.state.portrait === 'disco' && ladder.unproved);
receipt = { store: 'play', product: 'portrait_disco', token: 'good' };
await ladder.setLook({ portrait: 'disco', avatar });
check('with the store\'s receipt it goes along and the ladder shows it', last().receipt?.store === 'play' && ladder.me?.portrait === 'disco' && !ladder.unproved, JSON.stringify(last()));
await ladder.setLook({ portrait: 'nightsky', avatar });
check('an earned portrait never sends one', !last().receipt && ladder.me?.portrait === 'nightsky' && ladder.state.portrait === 'nightsky');
await ladder.setLook({ portrait: 'gold_bars_for_sale', avatar });
check('a portrait the ladder doesn\'t know: they take the ladder\'s answer, as before', ladder.state.portrait === 'nightsky' && !ladder.unproved, ladder.state.portrait);
await ladder.refresh();
check('a refresh sends no look and no receipt', last().op === 'me' && !last().receipt && !last().look);

if (failures) { console.log(`\n${failures} receipt client check(s) failed`); process.exit(1); }
console.log('\nall receipt client checks passed');
