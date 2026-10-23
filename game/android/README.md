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
- Icons and the launch screen are baked from Art's brand art: `node scripts/bake-native-assets.mjs`.
  The launch screen (`res/drawable/splash.xml`, written by that script) is the same picture as the game
  page's loading splash (`assets/splash/layout.css`): the Meadow sky, clouds, hills and the menu's logo.
  `MainActivity` keeps it behind a see-through web view until the page's splash has painted over it,
  then `LaunchSplashPlugin.hide()` (called from `src/native.ts`) clears it, so there's never a blank frame.
- Achievements on Google Play Games come from the local plugin in `plugins/game-services` (see its README).
  It stays off, and Play Games never starts, until `npm run stores:ids` sets the Play Games project id.
- Portrait only.
- Purchases (monetisation plan v2): Google Play Billing through `@capgo/native-purchases`, driven by
  `src/store/store.ts`. Test builds (the default, `ST_STORE=auto`) use Play when the Play Console lists
  the game's products and the test store ("nothing is charged") otherwise; store releases are built
  with `ST_STORE=play` and never fall back to it.
- Ads between runs: AdMob through `@capacitor-community/admob` (`src/store/admob.ts`), interstitials only,
  every request non-personalised, a G rating. The manifest drops the advertising ID and Android's ad
  services permissions. Without `ST_ADMOB_APP_ID` (the app id, into the manifest) and
  `ST_ADMOB_INTERSTITIAL` (the ad unit, into the web build) the app uses Google's test ids and only
  ever shows test ads.

A store release, once the Play Console and AdMob exist:

```sh
ST_STORE=play ST_ADMOB_APP_ID=ca-app-pub-…~… ST_ADMOB_INTERSTITIAL=ca-app-pub-…/… scripts/android-build.sh
```
