#!/usr/bin/env bash
# Builds the Android app (G6) from this checkout: the game page, Capacitor's copy into android/, then
# a signed release APK at dist-app/shape-tower-<version>.apk. Needs JDK 21 and the Android SDK
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
cp android/app/build/outputs/apk/release/app-release.apk "dist-app/shape-tower-${version}.apk"
echo "built dist-app/shape-tower-${version}.apk (${hash})"
