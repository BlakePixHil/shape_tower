// The Workshop (monetisation plan v2, "Where purchases show up"): the one screen with buy buttons. This
// file builds what it shows from the store and runs buying and restoring; Art's kit draws it
// (art/src/ui/workshop.ts). It opens from the main menu (and from Settings' "Remove ads" line, or a
// locked shop portrait), never during a run, on pause or on the run-over screens.

import type { AvatarSpec, WorkshopArt, WorkshopData, WorkshopItem } from '@art/index.ts';
import { ON_SALE, entitlements, supporterOffer, type Product } from '../meta/shop.ts';
import type { BuyResult, Store } from '../store/store.ts';
import type { Screens, WorkshopHandle } from './screens.ts';

/** What a buy's outcome says under the cards. */
const AFTER: Record<BuyResult, [string, 'good' | 'bad' | undefined]> = {
  bought: ['', 'good'],
  pending: ['Waiting for the payment. It unlocks as soon as it\'s paid.', undefined],
  cancelled: ['Purchase cancelled. Nothing was charged.', undefined],
  failed: ['That didn\'t go through, and nothing was charged. Try again in a moment.', 'bad'],
  unavailable: ['That isn\'t for sale here right now.', 'bad'],
};

export interface WorkshopOptions {
  avatar(): AvatarSpec;
  still(): boolean;
  /** Whether this build shows ads at all (the store apps). */
  adsLive(): boolean;
  /** A purchase went through: an unlock sound, and anything the game shows from it. */
  bought(p: Product): void;
}

export class Workshop {
  private handle: WorkshopHandle | null = null;
  private busy: string | null = null;
  private off: (() => void) | null = null;

  constructor(private sc: Screens, private store: Store, private o: WorkshopOptions) {}

  /** Opens the Workshop; `focus` scrolls to one product. `onClose` is where its close button goes. */
  open(onClose: () => void, focus?: string): void {
    this.off?.();
    const close = () => { this.off?.(); this.off = null; this.handle = null; onClose(); };
    this.handle = this.sc.workshop({
      data: this.data(), focus,
      onBuy: id => { void this.buy(id); },
      onRestore: () => { void this.restore(); },
      onClose: close,
    });
    // Prices and ownership can arrive while it's open (the store answering, a pending purchase paid).
    this.off = this.store.onChange(() => this.redraw());
    void this.store.refresh();
  }

  private redraw(): void {
    if (!this.handle?.open) return;
    const d = this.data();
    this.handle.store(d.store);
    for (const s of d.sections) for (const it of s.items) this.handle.update(it);
  }

  data(): WorkshopData {
    const supporter = supporterOffer(this.store.list());
    const onSale = (p: Product | null | undefined): p is Product => !!p && !p.soon;
    const pick = (kind: Product['kind']) => ON_SALE.filter(p => p.kind === kind);
    const sections: WorkshopData['sections'] = [
      { id: 'support', title: 'Support the game', items: [supporter].filter(onSale).map(p => this.item(p)) },
      { id: 'pass', title: 'Builder\'s Pass', items: pick('pass').map(p => this.item(p)) },
      { id: 'upgrades', title: 'Upgrades', items: [...pick('noads'), ...pick('wind')].map(p => this.item(p)) },
      { id: 'portraits', title: 'Portraits', text: 'Styles for your portrait on the Daily ladder. Just for looks: the ladder ranks by height alone.', items: pick('portrait').map(p => this.item(p)) },
      { id: 'sets', title: 'Sets', items: pick('set').map(p => this.item(p)) },
    ];
    return {
      sections: sections.filter(s => s.items.length),
      avatar: this.o.avatar(),
      store: this.store.status === 'offline' ? 'offline' : this.store.kind,
      still: this.o.still(),
    };
  }

  private item(p: Product): WorkshopItem {
    const s = this.store, e = s.ent;
    const owned = s.owns(p.id) || (p.kind === 'noads' && e.noAds) || (p.kind === 'pass' && e.pass) || (p.kind === 'wind' && e.windAlways)
      || (p.kind === 'portrait' && !!p.portrait && e.portraits.includes(p.portrait));
    const price = s.price(p.id);
    const state: WorkshopItem['state'] = owned ? 'owned' : this.busy === p.id ? 'busy' : s.pending(p.id) ? 'pending'
      : price === null && s.status !== 'loading' ? 'unavailable' : 'buy';
    return { id: p.id, name: p.name, text: p.text, art: artFor(p), price, state, note: this.note(p, owned), badge: p.kind === 'portrait' && p.cents >= 199 ? 'Animated' : undefined };
  }

  private note(p: Product, owned: boolean): string | undefined {
    const e = this.store.ent;
    switch (p.kind) {
      case 'noads':
        if (owned) return e.supporter ? 'Included in your Supporter Pack.' : 'No ads between runs, for good.';
        return this.o.adsLive() ? undefined : 'Ads only ever show in the phone app, never on this page.';
      case 'wind': return owned ? 'Ready at the start of every Endless run.' : 'Everyone can still earn it free at checkpoint 2.';
      case 'portrait': return owned ? 'Yours: pick it for your ladder portrait.' : undefined;
      case 'supporter':
        return p.owns === 'pass' ? 'You own the Builder\'s Pass, so you pay the difference.'
          : p.owns === 'ads' ? 'You own Remove Ads, so you pay the difference.'
          : p.owns === 'both' ? 'You own both, so this adds the supporter hat, frame and portrait.' : undefined;
      default: return undefined;
    }
  }

  private async buy(id: string): Promise<void> {
    const h = this.handle;
    const p = ON_SALE.find(x => x.id === id);
    if (!h || !p || this.busy) return;
    const it = this.item(p);
    if (it.state !== 'buy') return;
    // The test store asks first: nothing is charged, and it says what the store app would charge.
    if (this.store.kind === 'test' && !(await h.confirm(it))) { h.note(AFTER.cancelled[0]); return; }
    this.busy = id;
    this.redraw();
    const r = await this.store.buy(id);
    this.busy = null;
    this.redraw();
    if (r === 'bought') {
      this.o.bought(p);
      h.note(`Thanks! ${p.name} is yours${entitlements([id]).portraits.length ? '. Pick it for your ladder portrait.' : '.'}`, 'good');
    } else {
      h.note(...AFTER[r], r === 'pending');
    }
  }

  private async restore(): Promise<void> {
    const h = this.handle;
    if (!h) return;
    h.restoring(true);
    const r = await this.store.restore();
    h.restoring(false);
    h.note(!r.ok ? 'Can\'t reach the store right now. What you own still works.' : r.added ? `Restored ${r.added} purchase${r.added === 1 ? '' : 's'}.` : 'Everything you own is already here.', r.ok ? 'good' : 'bad');
  }
}

function artFor(p: Product): WorkshopArt {
  if (p.kind === 'portrait' && p.portrait) return { portrait: p.portrait } as WorkshopArt;
  if (p.kind === 'supporter') return 'supporter';
  if (p.kind === 'pass') return 'builders_pass';
  if (p.kind === 'noads') return 'remove_ads';
  if (p.kind === 'wind') return 'second_wind_ready';
  return { set: p.id.replace(/^set_/, '') };
}
