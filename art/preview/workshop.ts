// &ui=workshop: the Workshop with the test store, working end to end (buy opens the test sheet; Buy (test)
// goes busy, then Owned; Restore purchases restores two). &store=play|appstore|test|offline picks the
// footer line, &states=1 shows every card state at once (owned, busy, pending, loading, unavailable),
// &sheet=<product id> opens the test sheet for that product straight away. &art=1 shows the product art and
// the Workshop's icons large instead.

import {
  onAction, uiIconUrl, workshopArtUrl, setWorkshopItem, setWorkshopNote, setWorkshopRestoring, testPurchaseSheet, workshopPanel,
  type AvatarSpec, type WorkshopItem, type WorkshopStore,
} from '../src/index.ts';

export function workshopDemo(avatar: AvatarSpec, still: boolean, qs: URLSearchParams): HTMLElement {
  if (qs.has('art')) {
    const arts = (['supporter', 'builders_pass', 'remove_ads', 'second_wind_ready', { set: 'demo' }] as const).map(a => `<img alt="" style="width:140px;height:140px;background:#fff;border-radius:12px" src="${workshopArtUrl(a, 140)}">`);
    const icons = (['workshop', 'restore', 'noads'] as const).map(n => `<img alt="" style="width:96px;height:96px" src="${uiIconUrl(n, 96)}"><img alt="" style="width:24px;height:24px" src="${uiIconUrl(n, 24)}">`);
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;overflow:auto;background:#FFF7E8;padding:12px;display:flex;flex-wrap:wrap;gap:10px;align-content:flex-start;align-items:center';
    root.innerHTML = arts.join('') + icons.join('');
    document.body.appendChild(root);
    return root;
  }
  const st = (qs.get('store') ?? 'test') as WorkshopStore, states = qs.has('states');
  const items: WorkshopItem[] = [
    { id: 'supporter_pack', name: 'Supporter Pack', text: "The Builder's Pass and Remove Ads, plus a supporter portrait, hat and badge frame.", art: 'supporter', price: '$12.99', state: 'buy', note: 'About what the pass and Remove Ads cost apart', badge: 'Thank you!' },
    { id: 'builders_pass', name: "Builder's Pass", text: 'A second reward at every level from 2 to 60, then every 5 levels.', art: 'builders_pass', price: '$4.99', state: states ? 'owned' : 'buy', note: states ? undefined : 'Unlocks 6 rewards now' },
    { id: 'remove_ads', name: 'Remove Ads', text: 'No more ads between runs, for good.', art: 'remove_ads', price: '$7.99', state: states ? 'busy' : 'buy' },
    { id: 'second_wind_ready', name: 'Second Wind, always ready', text: 'Ready at the start of every Endless run. Still once a run.', art: 'second_wind_ready', price: states ? null : '$1.99', state: states ? 'unavailable' : 'buy' },
  ];
  const pts: [string, string, string, boolean][] = [
    ['bubblegum', 'Bubblegum', '$0.99', false], ['checkers', 'Checkers', '$0.99', false], ['retro', 'Retro', '$0.99', false],
    ['rainbow', 'Rainbow', '$1.99', true], ['lava_lamp', 'Lava Lamp', '$1.99', true], ['disco', 'Disco', '$1.99', true],
  ];
  const stateFor = ['owned', 'buy', 'busy', 'pending', 'buy', 'unavailable'] as const;
  const portraits: WorkshopItem[] = pts.map(([id, name, price, anim], i) => ({
    id: `portrait_${id}`, name, text: '', art: { portrait: id }, price: states && i === 4 ? null : price, state: states ? stateFor[i] : 'buy', badge: anim ? 'Animated' : undefined,
  }));
  const all = [...items, ...portraits];
  const ws = workshopPanel({
    avatar, still, store: st,
    sections: [
      { id: 'supporter', title: 'Support the game', items: items.slice(0, 1) },
      { id: 'upgrades', title: 'Upgrades', items: items.slice(1) },
      { id: 'portraits', title: 'Portraits', text: 'Styles for your portrait on the Daily ladder.', items: portraits },
    ],
  });
  document.body.appendChild(ws);
  const sheet = (it: WorkshopItem) => {
    const s = testPurchaseSheet(it, { avatar, still });
    document.body.appendChild(s);
    onAction(s, a => {
      s.remove();
      if (a === 'cancel') { setWorkshopNote(ws, 'Purchase cancelled'); return; }
      setWorkshopItem(ws, { ...it, state: 'busy' });
      setTimeout(() => { setWorkshopItem(ws, { ...it, state: 'owned', note: undefined }); setWorkshopNote(ws, `${it.name} is yours. Thank you!`, 'good'); }, 900);
    });
  };
  onAction(ws, (a, t) => {
    if (a === 'close') ws.remove();
    else if (a === 'buy') { const it = all.find(i => i.id === t.dataset.id); if (it) sheet(it); }
    else if (a === 'restore') {
      setWorkshopRestoring(ws, true);
      setTimeout(() => { setWorkshopRestoring(ws, false); setWorkshopNote(ws, 'Restored 2 purchases', 'good'); }, 1200);
    }
  });
  const open = qs.get('sheet');
  if (open) { const it = all.find(i => i.id === open); if (it) sheet(it); }
  return ws;
}
