#!/usr/bin/env bash
# Builds the Android app (G6) from this checkout: the game page, Capacitor's copy into android/, then
# a signed release APK at dist-apk/shape-tower-<version>.apk. Not in dist-app: that is the app's web
# folder, and an APK left there ships inside the next one. Needs JDK 21 and the Android SDK
# (ANDROID_HOME, platform and build-tools 36; see android/README.md).
set -euo pipefail
cd "$(dirname "$0")/.."

count=$(git rev-list --count HEAD)
hash=$(git rev-parse --short HEAD)
version="0.1.${count}"

npm run -s build:app
npx cap sync android
export SHAPE_TOWER_KEYSTORE="${SHAPE_TOWER_KEYSTORE:-/mnt/project-files/android/keystore.properties}"
(cd android && ./gradlew --no-daemon -q assembleRelease -PversionCode="${count}" -PversionName="${version} (${hash})")
mkdir -p dist-apk
cp android/app/build/outputs/apk/release/app-release.apk "dist-apk/shape-tower-${version}.apk"
echo "built dist-apk/shape-tower-${version}.apk (${hash})"
