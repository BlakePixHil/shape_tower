// Browser entry for bake-share-assets.mjs: the share links' picture and icon from Art's brand art.
import { bakeAppIcon, bakeSplash } from '../../art/src/brand.ts';

(window as unknown as { shareAssets: Record<string, () => string> }).shareAssets = {
  /** The link preview and the landing page's picture: the splash (the logo over the Meadow), 1200 × 630. */
  og: () => bakeSplash(1200, 630).toDataURL('image/png'),
  /** The page's icon: the app icon, 192 px. */
  icon: () => bakeAppIcon(192, 'full').toDataURL('image/png'),
};
