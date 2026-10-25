# Shape Tower for iPhone

Capacitor's iOS project for the game, the twin of `android/`. The web side is the same game build
(`npm run build:app` writes `dist-app/index.html` with the fonts inlined, so the app works offline);
`npx cap sync ios` copies it here. Plugins come in as Swift packages (`App/CapApp-SPM`, written by
`cap sync`), so there's no CocoaPods.

## Build and upload to TestFlight

```sh
cd game
scripts/ios-build.sh           # archive, sign, upload; ST_UPLOAD=0 stops at dist-ios/export-<n>/App.ipa
```

Needs a Mac with Xcode 26 or later (App Store Connect takes builds made with the iOS 26 SDK or later) and
Node. Like Android, the build number is the commit count, so every build from a new commit uploads; the
version players see is `MARKETING_VERSION` in the Xcode project. Store releases pass the same switches as
Android: `ST_STORE=play ST_ADS=live scripts/ios-build.sh` (`play` means the platform's own store).

Apple takes a few minutes to process an upload before TestFlight shows it.

## The App Store Connect API key

Signing, the upload and the store scripts below all use one App Store Connect API key with Admin access
(App Store Connect > Users and Access > Integrations), never kept in the repo:

- the key at `~/.appstoreconnect/private_keys/AuthKey_<key id>.p8`
- `ASC_KEY_ID=<key id>` and `ASC_ISSUER_ID=<issuer id>` in `~/.appstoreconnect/shape-tower.env` (or the
  environment)

Xcode makes the signing certificate and profile itself (automatic signing with `-allowProvisioningUpdates`),
so there's nothing to install by hand. The team id is in the Xcode project (`DEVELOPMENT_TEAM`).

## Store setup scripts

- `npm run testflight:team`: an internal TestFlight group that gets every build, with everyone on the App
  Store Connect team in it. Internal testers need no Beta App Review.
- `npm run stores:gamecenter -- --apply`: the 49 achievements in Game Center with their English text and
  Art's badges (`art: npm run export:badges`), then turns Game Center on in `src/meta/store-ids.ts`. Without
  `--apply` it only lists them.

## Native bits

- The launch screen (`App/Base.lproj/LaunchScreen.storyboard` and the `Splash*` images in the asset
  catalog) and the App Store icon are baked from Art's brand art by `node scripts/bake-native-assets.mjs`,
  the same picture as Android's launch screen and the game page's splash. `MainViewController` keeps it
  behind a see-through web view until the page's splash has painted over it, then `LaunchSplashPlugin.hide()`
  (called from `src/native.ts`) clears it, as on Android.
- Achievements on Game Center come from the local plugin in `plugins/game-services`; the app carries the
  Game Center entitlement (`App/App.entitlements`).
- Purchases: StoreKit through `@capgo/native-purchases`, driven by `src/store/store.ts`. They need the
  products made in App Store Connect with the same ids as Play, and the Paid Apps Agreement; until then test
  builds use the test store ("nothing is charged").
- Ads: AdMob through `@capacitor-community/admob`. `GADApplicationIdentifier` in `App/Info.plist` is the
  Shape Tower iOS app in Blake's AdMob, and its "Between runs" interstitial is `UNIT.ios` in
  `src/store/admob.ts`. As on Android, builds show Google's test ads unless they're built with `ST_ADS=live`.
  The app never asks for tracking (no `NSUserTrackingUsageDescription`), so the SDK never reads the IDFA.
- Export compliance: the app only uses Apple's HTTPS, so `ITSAppUsesNonExemptEncryption` is false and
  TestFlight doesn't ask.
- Portrait only, iPhone only (an iPad runs it as an iPhone app). Status bar hidden.
- `App/PrivacyInfo.xcprivacy` declares the file-timestamp and user-defaults APIs the plugins use; the
  plugins and Google's SDK carry their own manifests.

## App Store release

Version 1.0's store side is set up by two scripts (dry run without `--apply`, safe to run again):

- `node --experimental-strip-types scripts/app-store-listing.ts --apply`: name, subtitle and privacy policy
  (en-AU, the app's primary locale, plus en-GB and en-US), Games > Puzzle and Casual, no third-party
  content, the age rating answers (ads and the Daily ladder's player names; everything else none), each
  locale's description (from `marketing/listing/text.ts`), keywords, promotional text and links, the
  copyright, a manual release, free, AU/NZ/CA only, Game Center on with the 49 achievements in a draft review
  submission, and the 6.9"/6.7" screenshots from `marketing/listing/app-store/1-*.png`…`8-*.png`. The App
  Review contact needs a phone number Apple won't go without: `--phone "+61 …"` (or `ST_REVIEW_PHONE`).
- `node --experimental-strip-types scripts/app-store-products.ts --apply`: every product on sale in
  `src/meta/shop.ts` as a non-consumable in-app purchase (same ids as Play), its App Store name and
  description, its US price (Apple sets the rest), AU/NZ/CA, and `review-workshop.png` as its review
  screenshot.

Neither submits anything or attaches a build. Before submitting: the release build
(`ST_STORE=play ST_ADS=live scripts/ios-build.sh`, after the AdMob iOS ids are in) attached to 1.0, the
App Privacy answers, the Paid Apps Agreement, and the review contact's phone; then add the version and the
in-app purchases to the draft submission and submit it in App Store Connect.
