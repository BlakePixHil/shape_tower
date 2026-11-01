// The store (monetisation plan v2, "How it's built"): what the player owns, the prices, buying and
// restoring. In the Android app it's Google Play Billing through @capgo/native-purchases (the same
// plugin does StoreKit 2 for iOS later). Everywhere else, and in Android test builds that can't reach
// Play's products, it's a test store: every buy goes through a "nothing is charged" sheet (the
// Workshop shows it) and the purchase stays on the device. Store release builds are built with
// ST_STORE=play and never fall back to it.
//
// What the player owns is cached on the device, so the game plays fully offline, and checked with the
// store whenever it answers: anything it no longer lists (a refund) goes. Every product is a one-time
// purchase, so the stores restore them on a new phone.

import { Capacitor } from '@capacitor/core';
import { NativePurchases, PURCHASE_TYPE, type Transaction } from '@capgo/native-purchases';
import { ON_SALE, entitlements, portraitProducts, product, usd, type Entitlements } from '../meta/shop.ts';
import type { Receipt } from '../online/protocol.ts';

export type StoreKind = 'play' | 'appstore' | 'test';
export type BuyResult = 'bought' | 'pending' | 'cancelled' | 'failed' | 'unavailable';
export type StoreStatus = 'loading' | 'ready' | 'offline';

/** One store's side: the plugin, or the test store. */
export interface Backend {
  readonly kind: StoreKind;
  /** The store's price strings by product id. A product it doesn't list isn't for sale there. Throws when it can't answer. */
  prices(ids: string[]): Promise<Record<string, string>>;
  /**
   * What the store says the player owns, what's waiting for payment, and the store's receipts for what's
   * owned (the ladder checks them before showing a bought portrait). Throws when it can't answer: keep the cache.
   */
  purchases(): Promise<{ owned: string[]; pending: string[]; receipts?: Record<string, Receipt> }>;
  buy(id: string): Promise<BuyResult>;
  /** Asks the store again, finishing any purchase left half-done. */
  restore(): Promise<void>;
  /** A purchase changed outside buy() (a pending one was paid). */
  listen?(fn: () => void): void;
}

// ------------------------------------------------------------------ the test store

const TEST_KEY = 'shape-tower-test-store-v1';

function readList(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}
function writeList(key: string, ids: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(ids)); } catch { /* fine without it */ }
}

/** Purchases kept on this device, at the plan's US prices. Nothing is charged. */
export class TestBackend implements Backend {
  readonly kind = 'test' as const;
  async prices(ids: string[]): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const id of ids) { const p = product(id); if (p) out[id] = usd(p.cents); }
    return out;
  }
  async purchases(): Promise<{ owned: string[]; pending: string[] }> { return { owned: readList(TEST_KEY), pending: [] }; }
  async buy(id: string): Promise<BuyResult> {
    if (!product(id)) return 'unavailable';
    const owned = readList(TEST_KEY);
    if (!owned.includes(id)) writeList(TEST_KEY, [...owned, id]);
    return 'bought';
  }
  async restore(): Promise<void> {}
  /** Forgets every test purchase (Settings, test store only). */
  clear(): void { writeList(TEST_KEY, []); }
}

// ------------------------------------------------------------------ Google Play (and the App Store later)

const errCode = (e: unknown): string => String((e as { code?: unknown })?.code ?? (e as Error)?.message ?? e);

export class NativeBackend implements Backend {
  readonly kind: StoreKind = Capacitor.getPlatform() === 'ios' ? 'appstore' : 'play';
  async prices(ids: string[]): Promise<Record<string, string>> {
    const { products } = await NativePurchases.getProducts({ productIdentifiers: ids, productType: PURCHASE_TYPE.INAPP });
    const out: Record<string, string> = {};
    for (const p of products) if (ids.includes(p.identifier) && p.priceString) out[p.identifier] = p.priceString;
    return out;
  }
  async purchases(): Promise<{ owned: string[]; pending: string[]; receipts: Record<string, Receipt> }> {
    const { purchases } = await NativePurchases.getPurchases({ productType: PURCHASE_TYPE.INAPP, onlyCurrentEntitlements: true });
    const owned: string[] = [], pending: string[] = [];
    const receipts: Record<string, Receipt> = {};
    for (const t of purchases) {
      const id = t.productIdentifier;
      if (!id) continue;
      // Android: "1" is paid; Play Billing's PENDING is "2" (cash at a shop), though the plugin's docs say "0".
      // iOS lists current entitlements only.
      if (this.kind === 'play' && t.purchaseState !== undefined && String(t.purchaseState) !== '1') { if (/^[02]$/.test(String(t.purchaseState))) pending.push(id); continue; }
      if (t.revocationDate) continue;
      owned.push(id);
      if (this.kind === 'play' && t.purchaseToken) receipts[id] = { store: 'play', product: id, token: t.purchaseToken };
      if (this.kind === 'appstore' && t.jwsRepresentation) receipts[id] = { store: 'appstore', product: id, jws: t.jwsRepresentation };
    }
    return { owned, pending, receipts };
  }
  async buy(id: string): Promise<BuyResult> {
    try {
      const t: Transaction = await NativePurchases.purchaseProduct({ productIdentifier: id, productType: PURCHASE_TYPE.INAPP, quantity: 1 });
      return t.productIdentifier === id || !t.productIdentifier ? 'bought' : 'failed';
    } catch (e) {
      const code = errCode(e);
      if (/USER_CANCEL|cancel/i.test(code)) return 'cancelled';
      if (/pending/i.test(code)) return 'pending';
      if (/ITEM_ALREADY_OWNED/i.test(code)) return 'bought';
      if (/not found|ITEM_UNAVAILABLE|BILLING_UNAVAILABLE/i.test(code)) return 'unavailable';
      return 'failed';
    }
  }
  async restore(): Promise<void> { await NativePurchases.restorePurchases(); }
  listen(fn: () => void): void { void NativePurchases.addListener('transactionUpdated', () => fn()).catch(() => {}); }
}

// ------------------------------------------------------------------ the store the game uses

const KIND_KEY = 'shape-tower-store-kind';
const OWNED_KEY = (k: StoreKind) => `shape-tower-owned-v1:${k}`;
const RECEIPTS_KEY = (k: StoreKind) => `shape-tower-receipts-v1:${k}`;

function readReceipts(k: StoreKind): Record<string, Receipt> {
  try {
    const v = JSON.parse(localStorage.getItem(RECEIPTS_KEY(k)) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, Receipt> : {};
  } catch { return {}; }
}

/** How a build picks its store: 'play' (store releases), 'test' (web), 'auto' (Android test builds: Play when it lists our products). */
export type StoreMode = 'play' | 'test' | 'auto';

export class Store {
  private backend: Backend;
  private owned: Set<string>;
  private pendingIds: Set<string>;
  private receipts: Record<string, Receipt>;
  private priceOf: Record<string, string> = {};
  private fns = new Set<() => void>();
  private ents: Entitlements;
  status: StoreStatus = 'loading';
  /** Resolves once the store has answered (or couldn't). */
  readonly ready: Promise<void>;

  constructor(mode: StoreMode = defaultMode(), native = Capacitor.isNativePlatform()) {
    // Until the store answers, the last store this device used and what it owned there.
    const last = (() => { try { return localStorage.getItem(KIND_KEY) as StoreKind | null; } catch { return null; } })();
    const useNative = native && mode !== 'test' && (mode === 'play' || last !== 'test');
    this.backend = useNative ? new NativeBackend() : new TestBackend();
    this.owned = new Set(readList(OWNED_KEY(this.backend.kind)));
    this.receipts = readReceipts(this.backend.kind);
    this.pendingIds = new Set();
    this.ents = entitlements(this.owned);
    this.ready = this.start(mode, native);
  }

  get kind(): StoreKind { return this.backend.kind; }
  get ent(): Entitlements { return this.ents; }
  owns(id: string): boolean { return this.owned.has(id); }
  pending(id: string): boolean { return this.pendingIds.has(id); }
  /** Owned product ids. */
  list(): string[] { return [...this.owned]; }
  /** The store's price string, or null when it doesn't sell it (or hasn't said yet). */
  price(id: string): string | null { return this.priceOf[id] ?? null; }
  /** The store's receipt for an owned product that gives this portrait (none from the test store). */
  receiptFor(portrait: string): Receipt | null {
    for (const id of portraitProducts(portrait)) if (this.owned.has(id) && this.receipts[id]) return this.receipts[id];
    return null;
  }

  onChange(fn: () => void): () => void { this.fns.add(fn); return () => this.fns.delete(fn); }

  private async start(mode: StoreMode, native: boolean): Promise<void> {
    if (native && mode !== 'test') {
      const nb = this.backend.kind === 'test' ? new NativeBackend() : this.backend;
      try {
        const prices = await nb.prices(ON_SALE.map(p => p.id));
        if (mode === 'auto' && !Object.keys(prices).length) {
          // A test build the Play Console doesn't know: the test store stands in.
          this.use(new TestBackend());
        } else {
          this.use(nb);
          this.priceOf = prices;
        }
      } catch {
        // No answer (offline, or no Play on this phone): keep what's cached and try again on the next visit.
        if (mode === 'auto' && this.backend.kind === 'test') { await this.refresh(); return; }
        this.use(nb);
        this.status = 'offline';
        this.emit();
        return;
      }
    }
    await this.refresh();
  }

  private use(b: Backend): void {
    if (b !== this.backend) {
      this.backend = b;
      this.owned = new Set(readList(OWNED_KEY(b.kind)));
      this.receipts = readReceipts(b.kind);
      this.ents = entitlements(this.owned);
    }
    try { localStorage.setItem(KIND_KEY, b.kind); } catch { /* fine */ }
    b.listen?.(() => { void this.refresh(); });
  }

  /** Asks the store what's owned and what things cost. Offline keeps the cache. */
  async refresh(): Promise<void> {
    try {
      const [{ owned, pending, receipts }, prices] = await Promise.all([this.backend.purchases(), Object.keys(this.priceOf).length ? Promise.resolve(this.priceOf) : this.backend.prices(ON_SALE.map(p => p.id))]);
      this.priceOf = prices;
      this.setOwned(owned, pending, receipts);
      this.status = 'ready';
    } catch {
      this.status = 'offline';
    }
    this.emit();
  }

  private setOwned(owned: string[], pending: string[], receipts?: Record<string, Receipt>): void {
    this.owned = new Set(owned);
    this.pendingIds = new Set(pending.filter(id => !this.owned.has(id)));
    writeList(OWNED_KEY(this.backend.kind), [...this.owned]);
    this.ents = entitlements(this.owned);
    // A store's answer replaces the receipts (a refunded product's goes); a buy keeps the ones there are.
    this.receipts = Object.fromEntries(Object.entries({ ...(receipts ? {} : this.receipts), ...receipts }).filter(([id]) => this.owned.has(id)));
    try { localStorage.setItem(RECEIPTS_KEY(this.backend.kind), JSON.stringify(this.receipts)); } catch { /* fine without it */ }
  }

  /** Buys one product. The test store's sheet has already asked. */
  async buy(id: string): Promise<BuyResult> {
    const r = await this.backend.buy(id);
    if (r === 'bought') {
      this.owned.add(id);
      this.pendingIds.delete(id);
      this.setOwned([...this.owned], [...this.pendingIds]);
      void this.refresh();
    } else if (r === 'pending') {
      this.pendingIds.add(id);
    }
    this.emit();
    return r;
  }

  /** Restore purchases: asks the store again. Resolves how many products came back that weren't here. */
  async restore(): Promise<{ added: number; ok: boolean }> {
    const before = new Set(this.owned);
    try { await this.backend.restore(); } catch { /* the check below says whether the store answered */ }
    await this.refresh();
    return { added: [...this.owned].filter(id => !before.has(id)).length, ok: this.status === 'ready' };
  }

  /** The test store only: forget every test purchase. */
  clearTest(): void {
    if (!(this.backend instanceof TestBackend)) return;
    this.backend.clear();
    this.setOwned([], []);
    this.emit();
  }

  private emit(): void { for (const fn of this.fns) { try { fn(); } catch (e) { console.warn(e); } } }
}

/** The build's store mode (vite.config.ts sets __STORE__ from ST_STORE). */
function defaultMode(): StoreMode {
  const m = typeof __STORE__ === 'string' ? __STORE__ : 'auto';
  return m === 'play' || m === 'test' ? m : 'auto';
}

declare const __STORE__: string | undefined;
