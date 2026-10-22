// &ui=portraits: every portrait style at the picker's size (96 px), a Daily ladder of twenty rows at
// 32 px, and the still PNGs (portraitUrl). &pt=<id> shows one style large, at 200 px.

import { AVATAR_FACES, PORTRAIT_ART, portraitHtml, portraitUrl, type AvatarSpec, type Hat, type PortraitKind } from '../src/index.ts';

const KIND: Record<PortraitKind, string> = { free: 'Free', earned: 'Earned', platinum: 'Platinum', shop: 'Shop', supporter: 'Supporter Pack' };
const SHAPES = ['O', 'T', 'L', 'J', 'S', 'Z', 'I'];
const HATS: (Hat | null)[] = [null, 'party', 'cap', 'propeller', 'daisies', 'tophat', 'crown'];
const NAMES = ['Blake', 'StackAttack', 'WobbleKing', 'TetraTessa', 'BrickByBrick', 'Leaning Lou', 'SkyHigh_99', 'Plumb Bob', 'Mortar Mo', 'TowerTitan',
  'Gravity Gus', 'Stacy', 'TopHatTim', 'Moonbeam', 'Jelly Jo', 'Pebble', 'NimbusNat', 'Zigzag', 'Sir Stacks', 'Teeter'];

const avatarFor = (i: number): AvatarSpec => ({ shape: SHAPES[i % SHAPES.length], face: AVATAR_FACES[(i * 5) % AVATAR_FACES.length], hat: HATS[(i * 3) % HATS.length] });

export function portraitsSheet(root: HTMLElement, still: boolean, qs: URLSearchParams): void {
  const one = qs.get('pt');
  if (one) {
    root.innerHTML = `<h3>${one}</h3><div class="pv-wrap">${portraitHtml(one, avatarFor(2), 200, { still })}${portraitHtml(one, avatarFor(5), 96, { still })}${portraitHtml(one, avatarFor(0), 32, { still })}</div>`;
    return;
  }
  const cell = (id: string, i: number) => {
    const a = PORTRAIT_ART.find(p => p.id === id)!;
    return `<div class="pv-cell" style="width:104px">${portraitHtml(id, avatarFor(i), 96, { still })}<b>${a.name}</b><span style="opacity:.7">${KIND[a.kind]}${a.animated ? ', animated' : ''}</span></div>`;
  };
  const rows = NAMES.map((n, i) => {
    const id = PORTRAIT_ART[(i * 7 + 3) % PORTRAIT_ART.length].id;
    return `<div style="display:flex;align-items:center;gap:8px;padding:3px 8px;border-bottom:2px solid #F3E7D3;font:700 14px Nunito,system-ui,sans-serif">
      <span style="width:22px;text-align:right;opacity:.6">${i + 1}</span>${portraitHtml(id, avatarFor(i), 32, { still })}<span style="flex:1">${n}</span><span>${(98.4 - i * 3.7).toFixed(1)} m</span></div>`;
  }).join('');
  root.innerHTML = `<h3>Portraits (${PORTRAIT_ART.length}) at 96 px</h3><div class="pv-wrap">${PORTRAIT_ART.map((p, i) => cell(p.id, i)).join('')}</div>
    <h3>Daily ladder at 32 px</h3><div style="max-width:360px;background:#fff;border:3px solid #22183A;border-radius:14px;overflow:hidden">${rows}</div>
    <h3>Still PNGs (portraitUrl) at 48 px</h3><div class="pv-wrap">${PORTRAIT_ART.map((p, i) => `<img alt="" style="width:48px;height:48px" src="${portraitUrl(p.id, avatarFor(i), 48)}">`).join('')}</div>`;
}
