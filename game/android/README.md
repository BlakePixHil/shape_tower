# Shape Tower for Android

Capacitor's Android project for the game (vertical slice G6). The web side is the game build
(`npm run build:app` writes `dist-app/index.html` with the fonts inlined, so the app works offline);
`npx cap sync android` copies it here.

## Build

```sh
cd game
scripts/android-build.sh   # signed release APK in dist-apk/
```

Needs JDK 21 and the Android SDK with `platforms;android-36` and `build-tools;36.0.0`
(`ANDROID_HOME` set, or `sdk.dir` in `android/local.properties`). Gradle and the Android plugins come
from services.gradle.org and Google's Maven; the SDK itself from dl.google.com.

## Signing

Test builds for phones are signed with one key so each build installs over the last. The key and its
`keystore.properties` live in the project's shared files (`/mnt/project-files/android/`), never in
the repo; `SHAPE_TOWER_KEYSTORE` can point elsewhere. Store releases will use Play App Signing with
an upload key made when the Play developer account exists.

## Native bits

- `src/native.ts` (game side): hides the status bar and maps the back button to pause, close a card,
  or minimize from the main menu.
- Haptics come from `@capacitor/haptics`, which Sound's haptics module picks up on its own.
- Icons and splash screens are baked from Art's brand art: `node scripts/bake-native-assets.mjs`.
- Portrait only.
