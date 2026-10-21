// Bakes the images the in-run HUD shows before a run needs them, so none is baked and encoded mid-run
// (issue #33): the power icons at the game HUD's sizes, the biome card's postcards and star, and the
// hazard chips' and cards' icons.

import { BIOMES } from '../biomes.ts';
import { POWER_KINDS, powerIconUrl } from '../powers.ts';
import { warmUrls } from '../urls.ts';
import { HAZARDS } from './hazard.ts';
import { uiIconUrl } from './icons.ts';
import { postcardUrl } from './postcard.ts';

/**
 * Call it once when the menu first shows. It bakes in idle slices, soonest-needed first, and encodes
 * off the main thread; the promise resolves when it's done. `also` warms your own: call *Url helpers in
 * it (powerIconUrl, uiIconUrl, postcardUrl, badgeUrl) and they're baked the same way.
 */
export function prewarmUi(o: { also?: () => void } = {}): Promise<void> {
  return warmUrls(() => {
    // The game HUD (game/src/view/hud.ts): Second Wind, the two slots, and the glue and slow-mo chips.
    powerIconUrl('wind', 46);
    for (const k of POWER_KINDS) powerIconUrl(k, 40);
    powerIconUrl('glue', 16); powerIconUrl('slowmo', 16);
    // The Meadow's card shows as a run starts; then the hazard icons and the other biomes' cards.
    postcardUrl(0, 40, 52);
    uiIconUrl('star', 18);
    for (const h of Object.values(HAZARDS)) { uiIconUrl(h.icon, 26); uiIconUrl(h.icon, 40); }
    BIOMES.forEach((_, i) => postcardUrl(i, 40, 52));
    o.also?.();
  });
}
