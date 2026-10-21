// The phone app (G6): Capacitor wraps the game build. `npm run build:app` makes dist-app/, then
// `npx cap sync android` copies it into android/. See android/README.md for the build steps.
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.blakepixhil.shapetower',
  appName: 'Shape Tower',
  webDir: 'dist-app',
  android: {
    // The game draws its own sky edge to edge; the status bar floats over it.
    backgroundColor: '#8EC8FF',
  },
};

export default config;
