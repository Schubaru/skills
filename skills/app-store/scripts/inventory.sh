#!/usr/bin/env bash
# App Store readiness inventory. Read-only. Run from the repo root.
# Prints a sectioned plain-text report of the mechanical facts an audit needs,
# so the audit reads the actual project instead of assuming one.
set -uo pipefail

ROOT="${1:-.}"
cd "$ROOT" || exit 1

# Source files only: skip build output, dependency checkouts, and derived data.
PRUNE='-path ./build -o -path ./Build -o -path ./DerivedData -o -path ./Pods -o -path ./.build -o -path ./Carthage -o -path ./.git'
srcfind() { find . \( $PRUNE \) -prune -o "$@" -print 2>/dev/null; }
swift_files() { srcfind -name '*.swift' -type f; }

h() { printf '\n===== %s =====\n' "$1"; }
none() { echo "  (none found)"; }

h "PROJECT LAYOUT"
srcfind \( -name '*.xcodeproj' -o -name '*.xcworkspace' -o -name 'Package.swift' -o -name 'project.yml' -o -name 'Project.swift' \) | sed 's/^/  /'
echo "  swift file count: $(swift_files | wc -l | tr -d ' ')"

h "INFO.PLIST FILES"
srcfind -name 'Info.plist' -type f | sed 's/^/  /' || none

h "INFO.PLIST CONTENTS"
for p in $(srcfind -name 'Info.plist' -type f); do
  echo "--- $p"
  plutil -p "$p" 2>/dev/null | sed 's/^/  /' || sed 's/^/  /' "$p"
done

h "ENTITLEMENTS"
for e in $(srcfind -name '*.entitlements' -type f); do
  echo "--- $e"
  plutil -p "$e" 2>/dev/null | sed 's/^/  /' || sed 's/^/  /' "$e"
done

h "BUILD SETTINGS (declared in pbxproj / project.yml / xcconfig)"
for f in $(srcfind \( -name 'project.pbxproj' -o -name 'project.yml' -o -name '*.xcconfig' \) -type f); do
  echo "--- $f"
  grep -nE 'IPHONEOS_DEPLOYMENT_TARGET|deploymentTarget|TARGETED_DEVICE_FAMILY|PRODUCT_BUNDLE_IDENTIFIER|bundleIdPrefix|MARKETING_VERSION|CURRENT_PROJECT_VERSION|SWIFT_VERSION|xcodeVersion|ENABLE_BITCODE|SUPPORTS_MACCATALYST|CODE_SIGN|DEVELOPMENT_TEAM|ASSETCATALOG_COMPILER_APPICON_NAME|SUPPORTED_PLATFORMS|INFOPLIST_KEY_' "$f" | sed 's/^/  /' | sort -u -t: -k2 | head -60
done

h "USAGE DESCRIPTION STRINGS (NS*UsageDescription)"
grep -rn 'UsageDescription' --include='*.plist' --include='*.pbxproj' --include='*.yml' --include='*.xcconfig' . 2>/dev/null \
  | grep -vE '/(build|Build|Pods|DerivedData|\.build|Carthage)/' | sed 's/^/  /' || none

h "PERMISSION-GATED API USAGE IN CODE (does the code ask for what the plist declares, and vice versa)"
grep -rnE 'AVCaptureDevice|CLLocationManager|requestWhenInUse|requestAlways|PHPhotoLibrary|UNUserNotificationCenter|CNContactStore|EKEventStore|HKHealthStore|SFSpeechRecognizer|AVAudioSession.*record|LAContext|CMMotionManager|MusicAuthorization|ATTrackingManager' --include='*.swift' . 2>/dev/null \
  | grep -vE '/(build|Build|Pods|DerivedData|\.build|Carthage)/' | sed 's/^/  /' | head -40 || none

h "THIRD-PARTY DEPENDENCIES"
for f in $(srcfind \( -name 'Package.resolved' -o -name 'Podfile' -o -name 'Podfile.lock' -o -name 'Cartfile' -o -name 'Cartfile.resolved' -o -name 'Package.swift' \) -type f); do
  echo "--- $f"; sed 's/^/  /' "$f" | head -80
done
echo "--- SPM package refs inside pbxproj"
grep -rn 'XCRemoteSwiftPackageReference\|repositoryURL' --include='project.pbxproj' . 2>/dev/null | sed 's/^/  /' | head -30
echo "--- embedded binary frameworks (xcframework/framework checked into the repo)"
srcfind \( -name '*.xcframework' -o -name '*.framework' \) | sed 's/^/  /' | head -30

h "PRIVACY MANIFESTS"
srcfind -name 'PrivacyInfo.xcprivacy' | sed 's/^/  /' || none
for p in $(srcfind -name 'PrivacyInfo.xcprivacy'); do
  echo "--- $p"; plutil -p "$p" 2>/dev/null | sed 's/^/  /'
done

h "REQUIRED-REASON API CANDIDATES IN FIRST-PARTY CODE"
# Categories per Apple's required-reason API doc; confirm the current list live before judging.
echo "--- UserDefaults"
grep -rn 'UserDefaults' --include='*.swift' . 2>/dev/null | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -20
echo "--- file timestamp APIs"
grep -rnE 'creationDate|modificationDate|contentModificationDate|\.fileAttributes|NSFileCreationDate|getattrlist|stat\(' --include='*.swift' . 2>/dev/null | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -20
echo "--- disk space APIs"
grep -rnE 'volumeAvailableCapacity|systemFreeSize|NSFileSystemFreeSize|statfs' --include='*.swift' . 2>/dev/null | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -20
echo "--- active keyboard / system boot time"
grep -rnE 'activeInputModes|systemUptime|mach_absolute_time|bootTime' --include='*.swift' . 2>/dev/null | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -20

h "STOREKIT / PURCHASE CODE"
grep -rnE 'import StoreKit|Product\.|Transaction\.|AppStore\.sync|SKPayment|purchase\(|currentEntitlements|verificationResult|subscriptionStatus|restorePurchases|Restore' --include='*.swift' . 2>/dev/null \
  | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -60 || none

h "PAYWALL / SUBSCRIPTION UI CANDIDATES"
grep -rlniE 'paywall|upgrade|subscribe|subscription|premium|pro plan|free trial' --include='*.swift' . 2>/dev/null | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' || none
echo "--- disclosure terms present anywhere in UI strings"
grep -rniE 'auto-renew|automatically renews|cancel anytime|Terms of Use|EULA|Privacy Policy|per month|per year|/mo|/yr' --include='*.swift' . 2>/dev/null | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -30 || none

h "AUTH / ACCOUNT CODE"
grep -rnE 'import AuthenticationServices|ASAuthorization|SignInWithApple|signIn|signUp|createAccount|logIn|logOut|signOut|deleteAccount|delete account|Auth\.|Firebase.*Auth|GIDSignIn|LoginManager' --include='*.swift' . 2>/dev/null \
  | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -50 || none

h "NETWORKING / DATA LEAVING THE DEVICE"
grep -rnE 'URLSession|URLRequest|https?://|Alamofire|WebSocket|CloudKit|Analytics|logEvent|track\(' --include='*.swift' . 2>/dev/null \
  | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -50 || none

h "CANDIDATE HARDCODED SECRETS (verify each by reading the line; many are false positives)"
grep -rnEi '(api[_-]?key|secret|token|password|bearer|client[_-]?id|access[_-]?key)[[:space:]]*[:=][[:space:]]*"[^"]{8,}"|sk-[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-' --include='*.swift' --include='*.plist' --include='*.xcconfig' --include='*.json' . 2>/dev/null \
  | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -30 || none

h "PLACEHOLDER / INCOMPLETE CONTENT (guideline 2.1)"
grep -rniE 'lorem ipsum|placeholder|TODO|FIXME|XXX:|coming soon|not implemented|unimplemented|dummy|test123|example\.com|localhost|fatalError\("' --include='*.swift' . 2>/dev/null \
  | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -60 || none

h "CRASH-PRONE PATTERNS (force unwrap / force try / force cast / array subscript)"
grep -rnE 'try!|as! |\)!|\]!|\.first!|\.last!|fatalError|preconditionFailure|precondition\(|assert\(' --include='*.swift' . 2>/dev/null \
  | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -60 || none

h "ASSET CATALOGS — APP ICON & ACCENT COLOR"
for c in $(srcfind -name '*.appiconset' -type d); do
  echo "--- $c"; ls "$c" | sed 's/^/  /'
  echo "  --- Contents.json"; sed 's/^/    /' "$c/Contents.json" 2>/dev/null | head -60
done
srcfind -name '*.xcassets' -type d | sed 's/^/  xcassets: /'

h "LAUNCH SCREEN"
srcfind \( -name 'LaunchScreen.storyboard' -o -name '*.storyboard' \) | sed 's/^/  /'
grep -rn 'UILaunchScreen\|UILaunchStoryboardName' --include='*.plist' --include='*.yml' --include='*.pbxproj' . 2>/dev/null | grep -vE '/(build|Pods)/' | sed 's/^/  /'

h "LOCALIZATION"
srcfind \( -name '*.lproj' -type d -o -name '*.xcstrings' \) | sed 's/^/  /' || none

h "DARK MODE / DYNAMIC TYPE / ACCESSIBILITY SIGNALS"
echo "--- colorScheme + hardcoded colors"
grep -rnE 'colorScheme|preferredColorScheme|UIUserInterfaceStyle|Color\(red:|#[0-9A-Fa-f]{6}|\.white\b|\.black\b' --include='*.swift' --include='*.plist' . 2>/dev/null | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -25
echo "--- fixed font sizes vs Dynamic Type"
grep -rnE '\.font\(\.system\(size:|UIFont\.systemFont\(ofSize:|dynamicTypeSize|\.minimumScaleFactor|ScaledMetric' --include='*.swift' . 2>/dev/null | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -25
echo "--- accessibility annotations present"
grep -rc 'accessibilityLabel\|accessibilityHint\|accessibilityIdentifier' --include='*.swift' . 2>/dev/null | grep -v ':0$' | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -20

h "SIMULATOR-ONLY / STUBBED / DEBUG CODE THAT MIGHT SHIP"
grep -rnE '#if targetEnvironment\(simulator\)|#if DEBUG|isSimulator|mock|Mock|stub|Stub|fake|Fake' --include='*.swift' . 2>/dev/null \
  | grep -vE '/(build|Pods|\.build)/' | sed 's/^/  /' | head -40 || none

h "PREVIOUS READINESS REPORTS (for re-run diffing)"
ls -1 app-store-readiness/ 2>/dev/null | sed 's/^/  /' || echo "  (no previous run)"

h "LOCAL TOOLCHAIN"
echo "  xcode-select: $(xcode-select -p 2>/dev/null)"
xcodebuild -version 2>/dev/null | sed 's/^/  /'
echo "  installed iOS SDKs:"; xcodebuild -showsdks 2>/dev/null | grep -i ios | sed 's/^/    /'
echo "  git HEAD: $(git rev-parse --short HEAD 2>/dev/null || echo 'not a git repo')"
echo "  uncommitted changes: $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"

printf '\n===== END INVENTORY =====\n'
