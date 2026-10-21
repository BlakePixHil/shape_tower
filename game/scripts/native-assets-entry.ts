// Browser entry for bake-native-assets.mjs: Art's icon and splash as PNG data URLs.
import { bakeAppIcon, bakeSplash, type IconLayer } from '../../art/src/brand.ts';

function icon(px: number, layer: IconLayer, round: boolean): string {
  const src = bakeAppIcon(px, layer);
  if (!round) return src.toDataURL('image/png');
  const cv = document.createElement('canvas');
  cv.width = cv.height = px;
  const c = cv.getContext('2d')!;
  c.beginPath(); c.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2); c.clip();
  c.drawImage(src, 0, 0);
  return cv.toDataURL('image/png');
}

(window as unknown as { nativeAssets: unknown }).nativeAssets = {
  icon,
  splash: (w: number, h: number) => bakeSplash(w, h).toDataURL('image/png'),
};
