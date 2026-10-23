// Cosmetics previews (monetisation plan v2, Part B).
// &ui=cosmetics: every item's icon by slot, later variants, the Workshop sets' art, the supporter badge frame and
// a look preview per set. &ui=look opens "Your look": &lv=<level> (default 23), &pass=1 owns the Builder's Pass,
// &sets=set_candy,set_robot owns those sets, &supporter=1 the Supporter Pack, &tab=skin|landing|foundation|flag|hat.
// &ui=track shows the level track (non-owner and owner) and the XP tally's rewards; &lu=intro|owned opens the
// level-up with the pass's card (intro: the level-10 mention, Take a look and Not now).

import {
  COSMETIC_SLOTS, INK, SLOT_NAMES, WORKSHOP_SETS, badgeUrl, cosmeticUrl, levelRewards, levelTrack, levelUp, lookPanel, lookPreviewUrl,
  onAction, passRewardAt, passRewardsBetween, readLook, slotItems, workshopArtUrl,
  type AvatarSpec, type CosmeticLook, type CosmeticOwner, type CosmeticSlot,
} from '../src/index.ts';

const toast = (text: string): void => {
  const t = document.createElement('div');
  t.textContent = text;
  t.style.cssText = `position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;background:#FFC23D;color:${INK};border:3px solid ${INK};border-radius:12px;padding:6px 12px;font:700 14px Fredoka,sans-serif`;
  document.body.appendChild(t); setTimeout(() => t.remove(), 1800);
};

export function cosmeticsSheet(root: HTMLElement): void {
  const cell = (id: string, sub: string) => `<div class="pv-cell" style="width:76px"><img alt="" style="width:64px;height:64px;background:#fff;border-radius:12px" src="${cosmeticUrl(id, 64)}">${id}<br>${sub}</div>`;
  const slots = COSMETIC_SLOTS.map(sl => `<h3>${SLOT_NAMES[sl]} (${slotItems(sl).length})</h3><div class="pv-wrap">${slotItems(sl).map(d => cell(d.id, d.source === 'pass' || d.source === 'level' ? `${d.source} Lv ${d.level}` : d.set ?? d.source)).join('')}</div>`).join('');
  const later = [65, 70, 75, 80, 85, 125, 365].map(L => passRewardAt(L)!).map(d => cell(d.id, `Lv ${d.level}`)).join('');
  const sets = WORKSHOP_SETS.map(s => `<div class="pv-cell" style="width:120px"><img alt="" style="width:110px;height:110px;background:#fff;border-radius:14px" src="${workshopArtUrl({ set: s.id }, 110)}">${s.name}</div>`).join('');
  const looks: [string, CosmeticLook][] = [['Default', {}], ...WORKSHOP_SETS.map(s => [s.name, { skin: s.items[0], landing: s.items[1], foundation: s.items[2], flag: s.items[3], hat: s.items[4] }] as [string, CosmeticLook]),
    ['Pass mix', { skin: 'skin_galaxy', landing: 'landing_stars', foundation: 'foundation_crystal', flag: 'flag_moon', hat: 'hat_wizard' }]];
  const prev = looks.map(([n, l]) => `<div class="pv-cell" style="width:250px"><img alt="" style="width:240px;height:120px;border-radius:12px;border:3px solid ${INK}" src="${lookPreviewUrl({ skin: 'skin_classic', landing: 'landing_classic', foundation: 'foundation_classic', flag: 'flag_classic', hat: 'hat_party', ...l }, n === 'Default' ? 'O' : 'T', 240, 120)}">${n}</div>`).join('');
  const frames = [3, 12, 27, 45, 58, 72].map(L => `<img alt="" style="width:72px;height:72px" src="${badgeUrl(L, 72, undefined, 'supporter')}">`).join('');
  root.innerHTML = `${slots}<h3>Later Builder's Pass variants (after level 60)</h3><div class="pv-wrap">${later}</div>
    <h3>Workshop sets</h3><div class="pv-wrap">${sets}</div>
    <h3>Supporter badge frame</h3><div class="pv-wrap">${frames}</div>
    <h3>Looks</h3><div class="pv-wrap">${prev}</div>`;
}

export function lookDemo(avatar: AvatarSpec, still: boolean, qs: URLSearchParams): HTMLElement {
  const owner: CosmeticOwner = { level: Number(qs.get('lv') ?? 23), pass: qs.has('pass'), sets: (qs.get('sets') ?? '').split(',').filter(Boolean), supporter: qs.has('supporter') };
  let look: CosmeticLook = { skin: owner.pass ? 'skin_stars' : 'skin_classic', foundation: 'foundation_classic', flag: owner.pass ? 'flag_pennant' : 'flag_classic', landing: 'landing_classic', hat: 'hat_cap' };
  const p = lookPanel({ look, owner, avatar, slot: (qs.get('tab') ?? 'skin') as CosmeticSlot, still });
  document.body.appendChild(p);
  onAction(p, (a, t) => {
    if (a === 'workshop') toast(`Workshop: ${t.dataset.id} (${t.dataset.item})`);
    else { if (a === 'done') look = readLook(p); p.remove(); }
  });
  return p;
}

export function trackDemo(root: HTMLElement, qs: URLSearchParams): void {
  const L = Number(qs.get('lv') ?? 12);
  root.innerHTML = `<h3>Level track, no pass (level ${L})</h3><div class="pv-t1"></div>
    <h3>Level track, with the pass (level 34)</h3><div class="pv-t2"></div>
    <h3>Level track, past 60 (level 72, pass)</h3><div class="pv-t3"></div>
    <h3>XP tally: what level ${L} gave (no pass, then pass)</h3><div class="pv-r" style="display:flex;flex-direction:column;gap:10px;max-width:440px"></div>
    <h3>Level 10, no pass: rewards waiting ${passRewardsBetween(2, 10).length}</h3>`;
  root.querySelector('.pv-t1')!.appendChild(levelTrack({ level: L, pass: false }));
  root.querySelector('.pv-t2')!.appendChild(levelTrack({ level: 34, pass: true }));
  root.querySelector('.pv-t3')!.appendChild(levelTrack({ level: 72, pass: true }));
  const r = root.querySelector('.pv-r')!;
  for (const [lv, pass] of [[L, false], [L, true], [16, false], [65, true]] as [number, boolean][]) { const e = levelRewards(lv, { pass }); if (e) r.appendChild(e); }
  onAction(root, (a, t) => { if (a === 'workshop') toast(`Workshop: ${t.dataset.id} (${t.dataset.item})`); });
}

export function passLevelUp(qs: URLSearchParams): HTMLElement {
  const intro = qs.get('lu') === 'intro', level = intro ? 10 : Number(qs.get('lv') ?? 14);
  const l = levelUp({ level, pass: intro ? 'intro' : 'owned', passWaiting: passRewardsBetween(2, level).length });
  document.body.appendChild(l);
  onAction(l, (a, t) => { if (a === 'workshop') toast(`Workshop: ${t.dataset.id}`); l.remove(); });
  return l;
}
