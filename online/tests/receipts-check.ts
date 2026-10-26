// Receipt checks (monetisation plan, stage 3): a bought portrait shows to others only once a store
// receipt proves it. The App Store part runs on a certificate chain made here with openssl, shaped like
// Apple's (P-384 root and intermediate, P-256 signer, Apple's marker extensions), pinned in place of
// Apple's root; Google Play's runs against a stand-in for Google's token and purchases endpoints.
// Then the ladder's rules around them, with a stand-in check.
// Run: npm run api:check (in online/)

import { execFileSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RECEIPT_PLAYERS, handle } from '../src/handler.ts';
import { APPLE_ROOT_G3_SHA256, APP_ID, checkAppleJws, playChecker, receiptChecker, type Checked, type ReceiptCheck } from '../src/receipts.ts';
import { MemoryStore } from '../src/store.ts';
import { playerId } from '../../game/src/meta/ladder.ts';
import type { LadderReply, LadderRequest, Receipt } from '../../game/src/online/protocol.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}
const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

// ---------------------------------------------------------------- the App Store

const dir = mkdtempSync(join(tmpdir(), 'receipts-'));
const ssl = (...a: string[]) => execFileSync('openssl', a, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
const DAY = 86_400_000;
/** A certificate signed by `ca` (or by itself), with these extensions, valid from now for `days`. */
function makeCert(name: string, curve: string, ca: string | null, ext: string, days = 3650): void {
  ssl('ecparam', '-name', curve, '-genkey', '-noout', '-out', `${name}.key`);
  writeFileSync(join(dir, `${name}.ext`), ext);
  if (!ca) { ssl('req', '-new', '-x509', '-key', `${name}.key`, '-subj', `/CN=${name}`, '-days', String(days), '-sha384', '-out', `${name}.pem`, '-extensions', 'v3', '-config', writeConf(name)); return; }
  ssl('req', '-new', '-key', `${name}.key`, '-subj', `/CN=${name}`, '-out', `${name}.csr`);
  ssl('x509', '-req', '-in', `${name}.csr`, '-CA', `${ca}.pem`, '-CAkey', `${ca}.key`, '-CAcreateserial', '-days', String(days), '-sha384', '-extfile', `${name}.ext`, '-out', `${name}.pem`);
}
function writeConf(name: string): string {
  writeFileSync(join(dir, `${name}.cnf`), `[req]\ndistinguished_name=dn\n[dn]\n[v3]\n${readFileSync(join(dir, `${name}.ext`), 'utf8')}\n`);
  return `${name}.cnf`;
}
const der = (name: string) => Buffer.from(readFileSync(join(dir, `${name}.pem`), 'utf8').replace(/-----[^-]+-----|\s/g, ''), 'base64');

makeCert('root', 'secp384r1', null, 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign');
makeCert('wwdr', 'secp384r1', 'root', 'basicConstraints=critical,CA:TRUE\n1.2.840.113635.100.6.2.1=ASN1:NULL');
makeCert('signer', 'prime256v1', 'wwdr', 'basicConstraints=critical,CA:FALSE\n1.2.840.113635.100.6.11.1=ASN1:NULL');
makeCert('plain', 'prime256v1', 'wwdr', 'basicConstraints=critical,CA:FALSE\nkeyUsage=digitalSignature');
const ROOT = createHash('sha256').update(der('root')).digest('hex');
const x5c = (leaf = 'signer') => [leaf, 'wwdr', 'root'].map(n => der(n).toString('base64'));

const NOW = Date.now();
const tx = (o: Record<string, unknown> = {}) => ({
  transactionId: '2000000123', originalTransactionId: '2000000100', bundleId: APP_ID, productId: 'portrait_disco',
  purchaseDate: NOW - DAY, signedDate: NOW, environment: 'Sandbox', type: 'Non-Consumable', ...o,
});
function jws(payload: object, o: { leaf?: string; header?: object; chain?: string[] } = {}): string {
  const h = b64url(JSON.stringify(o.header ?? { alg: 'ES256', x5c: o.chain ?? x5c(o.leaf) }));
  const p = b64url(JSON.stringify(payload));
  const key = createPrivateKey(readFileSync(join(dir, `${o.leaf ?? 'signer'}.key`)));
  return `${h}.${p}.${b64url(sign('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }))}`;
}
const apple = (t: string, product = 'portrait_disco', root = ROOT) => checkAppleJws(t, product, root);
const isOk = (c: Checked, purchase?: string) => c.ok && (!purchase || c.purchase === purchase);

check('the pinned root is Apple Root CA - G3\'s fingerprint', APPLE_ROOT_G3_SHA256 === '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179');
check('the test signer\'s own signature checks out in Node', verify('sha256', Buffer.from('x'), createPublicKey(readFileSync(join(dir, 'signer.pem'))), sign('sha256', Buffer.from('x'), createPrivateKey(readFileSync(join(dir, 'signer.key'))))));
check('an App Store transaction for the portrait proves its purchase, by its original transaction', isOk(await apple(jws(tx())), 'appstore:2000000100'), JSON.stringify(await apple(jws(tx()))));
check('...restored on another phone (a new transaction id), the same purchase', isOk(await apple(jws(tx({ transactionId: '2000000999' }))), 'appstore:2000000100'));
check('a transaction for another product proves nothing for this one', !(await apple(jws(tx({ productId: 'portrait_retro' })))).ok);
check('another app\'s transaction proves nothing', !(await apple(jws(tx({ bundleId: 'com.example.other' })))).ok);
check('a refunded transaction proves nothing', !(await apple(jws(tx({ revocationDate: NOW - 1000 })))).ok);
check('the same chain under any other root (Apple\'s real one here) proves nothing', !(await apple(jws(tx()), 'portrait_disco', APPLE_ROOT_G3_SHA256)).ok);
check('a signing certificate without Apple\'s receipt-signer mark proves nothing', !(await apple(jws(tx(), { leaf: 'plain' }))).ok);
{
  const t = jws(tx()), [h, , s] = t.split('.');
  check('a changed transaction (its signature no longer fits) proves nothing', !(await apple(`${h}.${b64url(JSON.stringify(tx({ productId: 'portrait_rainbow' })))}.${s}`, 'portrait_rainbow')).ok);
}
check('a transaction signed when the certificates weren\'t yet valid proves nothing', !(await apple(jws(tx({ signedDate: NOW - 400 * DAY })))).ok);
check('a JWS without its chain, or with only two certificates, proves nothing',
  !(await apple(jws(tx(), { header: { alg: 'ES256' } }))).ok && !(await apple(jws(tx(), { chain: x5c().slice(0, 2) }))).ok);
check('rubbish proves nothing (and doesn\'t throw)', !(await apple('a.b.c')).ok && !(await apple('')).ok && !(await apple('x'.repeat(5000))).ok);
rmSync(dir, { recursive: true, force: true });

// ---------------------------------------------------------------- Google Play

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const KEY = JSON.stringify({ client_email: 'shape-tower-receipts@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.test/token' });
const TOKEN = 'abcdefghijklmnopqrstuvwxyz.AO-J1Ox_123';
let tokenCalls = 0;
const states: Record<string, number | 'missing' | 'down' | 'forbidden'> = { [TOKEN]: 0, ['cancelled' + TOKEN]: 1, ['pending' + TOKEN]: 2, ['missing' + TOKEN]: 'missing', ['down' + TOKEN]: 'down', ['forbidden' + TOKEN]: 'forbidden' };
const google: typeof fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.test/token') {
    tokenCalls++;
    const jwt = new URLSearchParams(String(init?.body)).get('assertion') ?? '';
    const [h, p, s] = jwt.split('.');
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
    const good = verify('sha256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, 'base64url')) && claims.scope === 'https://www.googleapis.com/auth/androidpublisher' && claims.aud === 'https://oauth2.test/token';
    return new Response(JSON.stringify(good ? { access_token: 'ya29.test', expires_in: 3599 } : { error: 'invalid_grant' }), { status: good ? 200 : 400 });
  }
  const m = /\/applications\/com\.blakepixhil\.shapetower\/purchases\/products\/([^/]+)\/tokens\/([^/]+)$/.exec(url);
  if (!m || (init?.headers as Record<string, string>)?.authorization !== 'Bearer ya29.test') return new Response('{}', { status: 401 });
  const st = m[1] === 'portrait_disco' ? states[m[2]] : 'missing';
  if (st === 'missing' || st === undefined) return new Response('{"error":{"code":404}}', { status: 404 });
  if (st === 'down') return new Response('{}', { status: 503 });
  if (st === 'forbidden') return new Response('{"error":{"message":"The current user has insufficient permissions"}}', { status: 403 });
  return new Response(JSON.stringify({ purchaseState: st, consumptionState: 0, orderId: 'GPA.3300-0000-0000-00000', purchaseType: 0 }), { status: 200 });
};
const play = playChecker(KEY, google);
const pr = (token: string, product = 'portrait_disco'): Receipt => ({ store: 'play', product, token });
const why = (c: Checked) => (c.ok ? 'ok' : c.why);

check('a bought Play token proves its purchase', isOk(await play(pr(TOKEN), NOW), `play:${TOKEN}`), JSON.stringify(await play(pr(TOKEN), NOW)));
check('...signing in with the service account once, not on every check', tokenCalls === 1, String(tokenCalls));
check('a cancelled or refunded purchase, or one still waiting for payment, proves nothing', why(await play(pr('cancelled' + TOKEN), NOW)) === 'invalid' && why(await play(pr('pending' + TOKEN), NOW)) === 'invalid');
check('a token Play doesn\'t know, or for another product, proves nothing', why(await play(pr('missing' + TOKEN), NOW)) === 'invalid' && why(await play(pr(TOKEN, 'portrait_retro'), NOW)) === 'invalid');
check('Play down: try again later, not "invalid"', why(await play(pr('down' + TOKEN), NOW)) === 'busy');
check('a key without the permission: "unchecked", not the player\'s fault', why(await play(pr('forbidden' + TOKEN), NOW)) === 'unchecked');
check('no key on this server: every Play receipt is "unchecked"', why(await playChecker(undefined, google)(pr(TOKEN), NOW)) === 'unchecked');
check('a token or product with odd characters never reaches Google', why(await play(pr('../../edits?x=1' + TOKEN), NOW)) === 'invalid' && why(await play(pr(TOKEN, '../x'), NOW)) === 'invalid');
check('the signing-in lasts its hour, then signs in again', (await play(pr(TOKEN), NOW + 3_400_000)).ok && tokenCalls === 2, String(tokenCalls));
{
  const both = receiptChecker(play, ROOT);
  check('both stores behind one check, and nonsense refused', (await both(pr(TOKEN), NOW)).ok && !(await both({ store: 'steam', product: 'x' } as unknown as Receipt, NOW)).ok && !(await both(null as unknown as Receipt, NOW)).ok);
}

// ---------------------------------------------------------------- the ladder's rules

const key = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const portraitOf = (r: LadderReply) => ('me' in r ? r.me.portrait : `error:${'error' in r ? r.error : '?'}`);
/** A stand-in store check: tokens "good-<n>" prove purchase n of the product they name, "busy" is busy. */
let asked = 0;
const fake: ReceiptCheck = async r => {
  asked++;
  if (r.store !== 'play') return { ok: false, why: 'invalid' };
  if (r.token === 'busy') return { ok: false, why: 'busy' };
  const m = /^good-(\d+)$/.exec(r.token);
  return m ? { ok: true, purchase: `play:${r.product}:${m[1]}` } : { ok: false, why: 'invalid' };
};
const store = new MemoryStore();
const call = (req: LadderRequest, check: ReceiptCheck | null = fake) => handle(req, store, NOW, check ?? undefined);
const look = (portrait: string) => ({ portrait, avatar: { shape: 'T', face: 'grin', hat: null } });
const receipt = (product: string, token: string): Receipt => ({ store: 'play', product, token });
const a = key(1);

await call({ op: 'name', key: a, name: 'Disco Dee', look: look('sunset') });
check('a bought portrait without a receipt: others see the one they had', portraitOf(await call({ op: 'look', key: a, look: look('disco') })) === 'sunset');
check('...or with a receipt for another product', portraitOf(await call({ op: 'look', key: a, look: look('disco'), receipt: receipt('portrait_retro', 'good-1') })) === 'sunset');
check('...or one the store refuses, or while the store is busy',
  portraitOf(await call({ op: 'look', key: a, look: look('disco'), receipt: receipt('portrait_disco', 'fake') })) === 'sunset'
  && portraitOf(await call({ op: 'look', key: a, look: look('disco'), receipt: receipt('portrait_disco', 'busy') })) === 'sunset');
check('...or on a server that can\'t ask the stores', portraitOf(await call({ op: 'look', key: a, look: look('disco'), receipt: receipt('portrait_disco', 'good-1') }, null)) === 'sunset');
check('with a good receipt it shows', portraitOf(await call({ op: 'look', key: a, look: look('disco'), receipt: receipt('portrait_disco', 'good-1') })) === 'disco');
{
  const day = new Date(NOW).toISOString().slice(0, 10);
  await call({ op: 'submit', key: a, sub: { day, height: 20, score: 2000, checkpoints: 2, finished: false, startedAt: NOW - 600_000 } });
  const v = await call({ op: 'ladder', day });
  check('...on their ladder row too', 'view' in v && v.view.top[0]?.portrait === 'disco', JSON.stringify(v));
}
await call({ op: 'look', key: a, look: look('meadow') });
asked = 0;
check('proved once, it comes back later without asking the store again', portraitOf(await call({ op: 'look', key: a, look: look('disco') })) === 'disco' && asked === 0);
check('a free or earned portrait never needs a receipt', portraitOf(await call({ op: 'look', key: a, look: look('nightsky') })) === 'nightsky' && asked === 0);
check('a proved portrait doesn\'t prove another one', portraitOf(await call({ op: 'look', key: a, look: look('rainbow') })) === 'nightsky');
{
  const b = key(2);
  await call({ op: 'name', key: b, name: 'Super Sam', look: look('meadow') });
  check('the Supporter portrait shows with a Supporter Pack receipt (an upgrade counts)', portraitOf(await call({ op: 'look', key: b, look: look('supporter'), receipt: receipt('supporter_upgrade_both', 'good-7') })) === 'supporter');
  check('a bought portrait they proved stays while another one is refused', portraitOf(await call({ op: 'look', key: b, look: look('disco') })) === 'supporter');
  // A player from before the checks, still showing a portrait they never proved.
  const old = store.docs.get(`players/${await playerId(key(2))}`)!.data as { portrait: string; bought?: string[] };
  Object.assign(old, { portrait: 'disco', bought: [] });
  check('an unproved bought portrait isn\'t kept as the fallback: the free one shows', portraitOf(await call({ op: 'look', key: b, look: look('rainbow') })) === 'meadow');
  const c = key(3);
  check('a name picked with a bought portrait and its receipt shows it at once', portraitOf(await call({ op: 'name', key: c, name: 'Retro Rae', look: look('retro'), receipt: receipt('portrait_retro', 'good-3') })) === 'retro');
}
{
  const players = Array.from({ length: RECEIPT_PLAYERS + 1 }, (_, i) => key(10 + i));
  for (const [i, k] of players.entries()) await call({ op: 'name', key: k, name: `Sharer ${String.fromCharCode(65 + i)}`, look: look('meadow') });
  const shown = [];
  for (const k of players) shown.push(portraitOf(await call({ op: 'look', key: k, look: look('lava_lamp'), receipt: receipt('portrait_lava_lamp', 'good-9') })));
  check(`one purchase shows on at most ${RECEIPT_PLAYERS} players' rows (a shared receipt stops there)`, shown.slice(0, RECEIPT_PLAYERS).every(p => p === 'lava_lamp') && shown[RECEIPT_PLAYERS] === 'meadow', shown.join());
  check('...and one already holding it can send it again', portraitOf(await call({ op: 'look', key: players[0], look: look('lava_lamp'), receipt: receipt('portrait_lava_lamp', 'good-9') })) === 'lava_lamp');
  await call({ op: 'forget', key: players[1] });
  check('deleting a player frees their place for another phone', portraitOf(await call({ op: 'look', key: players[RECEIPT_PLAYERS], look: look('lava_lamp'), receipt: receipt('portrait_lava_lamp', 'good-9') })) === 'lava_lamp');
  const left = [...store.docs.keys()].filter(p => p.startsWith('receipts/'));
  check('the server keeps a fingerprint of each purchase, never the receipt', left.length > 0 && [...store.docs.values()].every(d => !JSON.stringify(d.data).includes('good-')), left.join());
}

if (failures) { console.log(`\n${failures} receipt check(s) failed`); process.exit(1); }
console.log('\nall receipt checks passed');
