// Checking a store receipt before the ladder shows a bought portrait to others (monetisation plan,
// stage 3). Google Play: the purchase token, asked of the Play Developer API with a read-only service
// account (the Worker's PLAY_KEY secret, never in the repo). App Store: the StoreKit 2 transaction, a JWS
// that Apple signs with a certificate chain up to Apple Root CA - G3, checked here with no call out.
// Only WebCrypto, so the same code runs in Cloudflare's workerd and in Node's checks.

import type { Receipt } from '../../game/src/online/protocol.ts';

/** The app's id on both stores. */
export const APP_ID = 'com.blakepixhil.shapetower';

/**
 * What a check found: the purchase it proves (an id that stays the same on every device the purchase is
 * restored to), or why not. 'unchecked': this server can't ask that store (no key); 'busy': the store
 * didn't answer, so try again later.
 */
export type Checked = { ok: true; purchase: string } | { ok: false; why: 'invalid' | 'unchecked' | 'busy' };
export type ReceiptCheck = (r: Receipt, now: number) => Promise<Checked>;

/** Bytes on a plain ArrayBuffer, as WebCrypto takes them. */
type Bytes = Uint8Array<ArrayBuffer>;

const b64 = (s: string): Bytes => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s/g, '')), c => c.charCodeAt(0));
const b64url = (b: Bytes | string): string =>
  btoa(String.fromCharCode(...(typeof b === 'string' ? new TextEncoder().encode(b) : b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const INVALID: Checked = { ok: false, why: 'invalid' };

// ------------------------------------------------------------------ Google Play

const PLAY_API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${APP_ID}`;
const TOKEN_RE = /^[A-Za-z0-9._-]{20,1000}$/;
const PRODUCT_RE = /^[a-z0-9_.]{1,100}$/;

interface ServiceKey { client_email: string; private_key: string; token_uri?: string }

/**
 * Checks Play purchase tokens with the service account in `keyJson` (none: every Play receipt is
 * 'unchecked'). A token Play knows as bought (purchaseState 0) proves its purchase; one it calls
 * cancelled, refunded or still waiting for payment, or doesn't know, doesn't.
 */
export function playChecker(keyJson: string | undefined, fetchFn: typeof fetch = (...a) => fetch(...a)): ReceiptCheck {
  let key: ServiceKey | null = null;
  try { key = keyJson ? JSON.parse(keyJson) as ServiceKey : null; } catch { console.error('receipts: PLAY_KEY is not JSON'); }
  let access: { token: string; until: number } | null = null;

  async function accessToken(k: ServiceKey, now: number): Promise<string | null> {
    if (access && now < access.until) return access.token;
    const aud = k.token_uri ?? 'https://oauth2.googleapis.com/token';
    const iat = Math.floor(now / 1000);
    const body = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: k.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud, iat, exp: iat + 3600 }))}`;
    const der = b64(k.private_key.replace(/-----[^-]+-----/g, ''));
    const signer = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signer, new TextEncoder().encode(body)));
    const r = await fetchFn(aud, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${body}.${b64url(sig)}` }) });
    const j = await r.json().catch(() => ({})) as { access_token?: string; expires_in?: number };
    if (!j.access_token) { console.error('receipts: Google refused the key', r.status); return null; }
    access = { token: j.access_token, until: now + Math.min(j.expires_in ?? 3600, 3600) * 1000 - 300_000 };
    return access.token;
  }

  return async (r, now) => {
    if (r.store !== 'play') return INVALID;
    if (!TOKEN_RE.test(r.token) || !PRODUCT_RE.test(r.product)) return INVALID;
    if (!key) return { ok: false, why: 'unchecked' };
    try {
      const auth = await accessToken(key, now);
      if (!auth) return { ok: false, why: 'unchecked' };
      const res = await fetchFn(`${PLAY_API}/purchases/products/${r.product}/tokens/${r.token}`, { headers: { authorization: `Bearer ${auth}` } });
      if (res.ok) {
        const p = await res.json() as { purchaseState?: number };
        return p.purchaseState === 0 ? { ok: true, purchase: `play:${r.token}` } : INVALID;
      }
      if (res.status === 401) access = null;
      if (res.status === 401 || res.status === 403) { console.error('receipts: Play said', res.status, (await res.text()).slice(0, 300)); return { ok: false, why: 'unchecked' }; }
      return res.status >= 500 || res.status === 429 ? { ok: false, why: 'busy' } : INVALID;
    } catch (e) {
      console.error('receipts: Play', e);
      return { ok: false, why: 'busy' };
    }
  };
}

// ------------------------------------------------------------------ the App Store

/** SHA-256 of Apple Root CA - G3 (https://www.apple.com/certificateauthority/), the root of every App Store JWS. */
export const APPLE_ROOT_G3_SHA256 = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';
/** The extensions Apple marks its WWDR intermediate and its App Store receipt-signing certificates with. */
const OID_APPLE_INTERMEDIATE = '1.2.840.113635.100.6.2.1';
const OID_APPLE_RECEIPT_SIGNER = '1.2.840.113635.100.6.11.1';

/** One DER element: its tag, where its contents sit, and the whole element's bytes. */
interface Der { tag: number; body: Bytes; whole: Bytes }

function der(b: Bytes, at = 0): Der {
  const tag = b[at];
  let len = b[at + 1], off = at + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n < 1 || n > 3) throw new Error('der length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + b[off + i];
    off += n;
  }
  if (off + len > b.length) throw new Error('der overrun');
  return { tag, body: b.subarray(off, off + len), whole: b.subarray(at, off + len) };
}

/** The elements inside a SEQUENCE, SET or explicit tag. */
function kids(d: Der): Der[] {
  const out: Der[] = [];
  for (let at = 0; at < d.body.length;) { const k = der(d.body, at); out.push(k); at += k.whole.length; }
  return out;
}

function oid(b: Bytes): string {
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  for (let i = 1, v = 0; i < b.length; i++) { v = v * 128 + (b[i] & 0x7f); if (!(b[i] & 0x80)) { parts.push(v); v = 0; } }
  return parts.join('.');
}

function asn1Time(d: Der): number {
  const s = new TextDecoder().decode(d.body);
  const m = /^(\d{2}|\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) throw new Error('time');
  const y = m[1].length === 2 ? (Number(m[1]) < 50 ? 2000 : 1900) + Number(m[1]) : Number(m[1]);
  return Date.UTC(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
}

interface Cert { whole: Bytes; tbs: Bytes; sigAlg: string; sig: Bytes; spki: Bytes; curve: string; from: number; to: number; exts: string[] }

const CURVES: Record<string, string> = { '1.2.840.10045.3.1.7': 'P-256', '1.3.132.0.34': 'P-384' };
const HASHES: Record<string, string> = { '1.2.840.10045.4.3.2': 'SHA-256', '1.2.840.10045.4.3.3': 'SHA-384' };

function cert(bytes: Bytes): Cert {
  const top = der(bytes);
  const [tbsD, algD, sigD] = kids(top);
  const tbs = kids(tbsD);
  const i = tbs[0].tag === 0xa0 ? 1 : 0; // the version is optional
  const [validity, , spkiD] = [tbs[i + 3], tbs[i + 4], tbs[i + 5]];
  const [from, to] = kids(validity).map(asn1Time);
  const curve = CURVES[oid(kids(kids(spkiD)[0])[1].body)] ?? '';
  const extsD = tbs.slice(i + 6).find(d => d.tag === 0xa3);
  const exts = extsD ? kids(kids(extsD)[0]).map(e => oid(kids(e)[0].body)) : [];
  return { whole: top.whole, tbs: tbsD.whole, sigAlg: oid(kids(algD)[0].body), sig: sigD.body.subarray(1), spki: spkiD.whole, curve, from, to, exts };
}

/** An X.509 ECDSA signature (DER r, s) as WebCrypto wants it: r and s side by side, each `size` bytes. */
function rawSig(sig: Bytes, size: number): Bytes {
  const [r, s] = kids(der(sig)).map(k => k.body);
  const out = new Uint8Array(size * 2);
  const put = (v: Bytes, at: number) => { const t = v.subarray(Math.max(0, v.length - size)); out.set(t, at + size - t.length); };
  put(r, 0); put(s, size);
  return out;
}

const keyOf = (c: Cert) => crypto.subtle.importKey('spki', c.spki, { name: 'ECDSA', namedCurve: c.curve }, false, ['verify']);

async function signedBy(c: Cert, issuer: Cert): Promise<boolean> {
  const hash = HASHES[c.sigAlg];
  if (!hash || !issuer.curve) return false;
  return crypto.subtle.verify({ name: 'ECDSA', hash }, await keyOf(issuer), rawSig(c.sig, issuer.curve === 'P-384' ? 48 : 32), c.tbs);
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

/** The signed transaction's fields the ladder looks at (Apple's JWSTransactionDecodedPayload). */
interface AppleTransaction { bundleId?: string; productId?: string; originalTransactionId?: string; signedDate?: number; revocationDate?: number }

/**
 * Checks a StoreKit 2 transaction: a chain of three certificates whose root is Apple Root CA - G3 (or, in
 * the checks, `rootSha256`), each signed by the next and in date when the transaction was signed, an
 * App Store signing certificate at the bottom, its signature over the transaction, and a transaction of
 * this app for `product` that hasn't been refunded.
 */
export async function checkAppleJws(jws: string, product: string, rootSha256 = APPLE_ROOT_G3_SHA256): Promise<Checked> {
  try {
    const [h, p, s] = jws.split('.');
    if (!h || !p || !s) return INVALID;
    const header = JSON.parse(new TextDecoder().decode(b64(h))) as { alg?: string; x5c?: string[] };
    if (header.alg !== 'ES256' || !Array.isArray(header.x5c) || header.x5c.length !== 3) return INVALID;
    const [leaf, mid, root] = header.x5c.map(c => cert(b64(c)));
    if (hex(await crypto.subtle.digest('SHA-256', root.whole)) !== rootSha256) return INVALID;
    if (!mid.exts.includes(OID_APPLE_INTERMEDIATE) || !leaf.exts.includes(OID_APPLE_RECEIPT_SIGNER) || leaf.curve !== 'P-256') return INVALID;
    if (!(await signedBy(mid, root)) || !(await signedBy(leaf, mid))) return INVALID;
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, await keyOf(leaf), b64(s), new TextEncoder().encode(`${h}.${p}`));
    if (!ok) return INVALID;
    const t = JSON.parse(new TextDecoder().decode(b64(p))) as AppleTransaction;
    const at = Number(t.signedDate);
    if (![leaf, mid, root].every(c => c.from <= at && at <= c.to)) return INVALID;
    if (t.bundleId !== APP_ID || t.productId !== product || t.revocationDate || !t.originalTransactionId) return INVALID;
    return { ok: true, purchase: `appstore:${t.originalTransactionId}` };
  } catch {
    return INVALID;
  }
}

/** Both stores: Play through `play` (playChecker), the App Store here. */
export function receiptChecker(play: ReceiptCheck, rootSha256?: string): ReceiptCheck {
  return async (r, now) => {
    if (!r || typeof r !== 'object' || typeof r.product !== 'string') return INVALID;
    if (r.store === 'play' && typeof r.token === 'string') return play(r, now);
    if (r.store === 'appstore' && typeof r.jws === 'string' && r.jws.length < 12_000) return checkAppleJws(r.jws, r.product, rootSha256);
    return INVALID;
  };
}
