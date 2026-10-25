// The phone apps (G6): Capacitor wraps the game build. `npm run build:app` makes dist-app/, then
// `npx cap sync android` (or `ios`) copies it into android/ or ios/. See android/README.md and
// ios/README.md for the build steps.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.blakepixhil.shapetower',
  appName: 'Shape Tower',
  webDir: 'dist-app',
  android: {
    // The game draws its own sky edge to edge; the status bar floats over it.
    backgroundColor: '#8EC8FF',
  },
  ios: {
    // Edge to edge under the notch and home bar too: the HUD keeps clear with safe-area insets.
    backgroundColor: '#8EC8FF',
    contentInset: 'never',
    // A game, not a page: no rubber-band scrolling, no link previews on a long press.
    scrollEnabled: false,
    allowsLinkPreview: false,
  },
};

export default config;
