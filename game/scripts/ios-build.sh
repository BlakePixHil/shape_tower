#!/usr/bin/env bash
# Builds the iPhone app on a Mac with Xcode: the game page, Capacitor's copy into ios/, then a signed App
# Store archive in dist-ios/, uploaded to App Store Connect for TestFlight. ST_UPLOAD=0 stops at the .ipa
# in dist-ios/ instead. Signing and the upload use an App Store Connect API key (Admin), kept outside the
# repo: ~/.appstoreconnect/private_keys/AuthKey_<id>.p8, with ASC_KEY_ID and ASC_ISSUER_ID set or in
# ~/.appstoreconnect/shape-tower.env. The build number is the commit count, like Android's versionCode;
# the version (MARKETING_VERSION) lives in the Xcode project. See ios/README.md.
set -euo pipefail
cd "$(dirname "$0")/.."

env_file="${ASC_ENV:-$HOME/.appstoreconnect/shape-tower.env}"
# shellcheck disable=SC1090
[ -f "$env_file" ] && . "$env_file"
: "${ASC_KEY_ID:?set ASC_KEY_ID (or put it in $env_file)}"
: "${ASC_ISSUER_ID:?set ASC_ISSUER_ID (or put it in $env_file)}"
key="${ASC_KEY_PATH:-$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8}"
[ -f "$key" ] || { echo "no API key at $key" >&2; exit 1; }
auth=(-allowProvisioningUpdates -authenticationKeyPath "$key" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")

count=$(git rev-list --count HEAD)
hash=$(git rev-parse --short HEAD)
out=dist-ios
archive="$out/shape-tower-${count}.xcarchive"

npm run -s build:app
npx cap sync ios
rm -rf "$archive"
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination generic/platform=iOS \
  -archivePath "$archive" "${auth[@]}" -quiet archive CURRENT_PROJECT_VERSION="$count"

destination=upload
[ "${ST_UPLOAD:-1}" = 0 ] && destination=export
mkdir -p "$out"
cat > "$out/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>destination</key><string>${destination}</string>
	<key>signingStyle</key><string>automatic</string>
	<key>manageAppVersionAndBuildNumber</key><false/>
	<key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST
xcodebuild -exportArchive -archivePath "$archive" -exportOptionsPlist "$out/ExportOptions.plist" -exportPath "$out/export-${count}" "${auth[@]}"
if [ "$destination" = upload ]; then
  echo "uploaded build ${count} (${hash}) to App Store Connect; TestFlight lists it once Apple has processed it"
else
  echo "built $out/export-${count}/App.ipa (build ${count}, ${hash})"
fi
