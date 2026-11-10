# Step 3 — The audit

Seven domains. Work them in this order; earlier ones can invalidate later ones (an app that cannot
archive has no meaningful screenshot conversation yet).

Two habits that decide whether the report is useful:

**Cite the rule you fetched, not the rule you remember.** Each finding carries a guideline number
and the operative phrase from the text pulled this run. If the fetch for that source failed, the
finding still stands on its repo evidence but is tagged UNVERIFIED for the citation.

**Point at a line.** `Wordsword/PaywallView.swift:88` is a finding. "The paywall may be missing
disclosure" is a rumor. When the evidence is an *absence* (no Restore button anywhere), cite the
file where it should live and say what you searched for to conclude it is missing — that lets the
user disprove you in ten seconds if you are wrong.

---

## 1. Build and toolchain

Compare the machine's Xcode/SDK (bottom of the inventory) against the minimum in the
upcoming-requirements page fetched this run. This is the single most common "cannot even upload"
blocker, and the deadline moves — which is exactly why it is fetched.

- Xcode and iOS SDK version vs the current enforced minimum for **new submissions**, plus any
  deadline that has not hit yet (note the date so the user can plan).
- Deployment target: sane relative to the APIs actually used, and consistent between the pbxproj,
  `project.yml`, and any xcconfig — a mismatch surfaces as a confusing archive failure.
- `TARGETED_DEVICE_FAMILY`: `1` is iPhone-only, `1,2` claims iPad. Whatever it says becomes a
  promise about screenshots and about the app working on iPad. See domain 7.
- Signing: for a project that has never been submitted, `CODE_SIGNING_REQUIRED=NO` and an empty
  `CODE_SIGN_IDENTITY` are normal for simulator work and **fatal for archiving**. Report it,
  explain that archiving needs a real team and a distribution certificate, and do not change it —
  signing is on the never-touch list.
- Bundle identifier: must be a real reverse-DNS id the user owns, and it must match the App Store
  Connect record they will create. Flag placeholders (`com.example.*`, `com.yourcompany.*`) as a
  blocker but never edit it.
- Does `Product > Archive` actually succeed? Try to answer with evidence rather than a guess:
  `xcodebuild -scheme <S> -destination 'generic/platform=iOS' -configuration Release archive
  -archivePath /tmp/x.xcarchive` and read the failure. A Release-configuration build catches what
  Debug hides (`#if DEBUG` code that other code depends on, missing Release-only settings,
  optimizer-level warnings-as-errors). If signing blocks the archive, run with
  `CODE_SIGNING_ALLOWED=NO` to at least prove the compile is clean, and say clearly that this
  proves compilation, not archivability.
- Generated projects: if `project.yml` (XcodeGen) or `Project.swift` (Tuist) exists, the
  `.xcodeproj` is a build artifact. Edits to the pbxproj get wiped on the next generate — any
  build-setting fix belongs in the generator input. Note this prominently; it silently undoes fixes.

## 2. Guideline 2.1 — App completeness

The reviewer opens the app cold on a real device with a fresh install and no data. Everything that
appears is the app.

- Placeholder text, lorem ipsum, "coming soon", dummy data, `example.com` links, TODO strings that
  reach the UI. The inventory's placeholder scan finds candidates; open each and decide whether it
  is user-visible. A TODO comment is not a finding. A `Text("TODO")` is.
- Dead controls: a button whose action is empty, a nav link to an unbuilt screen, a settings row
  that does nothing. Grep alone will not find these — trace the primary flows in the view code.
- Crash paths on inputs the reviewer can reach: force unwraps and `try!` on network responses,
  decoded JSON, user text, or optional state. Weight by reachability — a `try!` on a bundled
  resource that ships in the binary is near-zero risk; the same on a decoded API payload is a
  crash-on-review waiting for one bad response.
- Debug-only code: verify that `#if DEBUG` blocks are genuinely excluded from Release and that
  nothing user-facing depends on them. A debug shortcut that seeds the app's only content means the
  Release build shows an empty app.
- Stubbed backends. If auth, sync, or purchases are locally faked (`// stub:`, mock services,
  hardcoded verification codes), that is a blocker for anything user-facing — the reviewer will hit
  the fake path. Say exactly which behavior is fake and what the reviewer would see.
- Can a reviewer exercise everything? Anything behind a login, a paywall, an invite, or hardware
  the reviewer lacks needs a route in: a demo account, or a way to unlock. Note what has to go in
  the App Store Connect review notes — this is where a solo developer most often loses a week.

## 3. Guidelines 3.1.1 and 3.1.2 — Purchases and subscriptions

Only relevant if the app sells digital goods. If it does not, say so explicitly in the report and
move on — a report that lists N/A checks as passes is misleading.

- Every digital good and unlock routes through StoreKit. Any external payment path, "subscribe on
  our website" link, or link steering users off-platform to pay is a rejection under 3.1.1 (read
  the fetched text for the current carve-outs — reader apps, external-purchase entitlements, and
  regional rules exist and change).
- **Restore Purchases** is reachable in the UI, calls the restore path (`AppStore.sync()` or the
  current equivalent for the StoreKit version in use), and reports success and failure to the user.
  Both the affordance and the wiring, not one without the other.
- Auto-renewing subscription disclosure, **in the binary**, adjacent to the purchase control: title
  of the subscription, length of the subscription period, price (and price per unit if relevant),
  and that it auto-renews until cancelled. Verify the strings exist in the paywall view, and verify
  price comes from the StoreKit `Product` (a hardcoded "$4.99" goes wrong in every other
  storefront — a real rejection cause and a real refund cause).
- Functional links to **Terms of Use (EULA)** and **Privacy Policy** from the paywall. A link that
  404s, points at `example.com`, or opens nothing is worse than no link. Check the URL is real; if
  the user has not written those documents yet, that is a blocker with an off-codebase fix.
- Entitlement state handling: expired, cancelled, refunded, billing-grace-period, and
  billing-retry. Read the transaction/entitlement code and check what happens in each. The
  common bug is treating any non-`nil` transaction as active access; the second most common is
  never listening for updates, so a refund never revokes.
- Validation approach: local `Transaction.currentEntitlements` with StoreKit 2 verification is
  acceptable and normal for a solo developer. Note the trade-off honestly rather than demanding a
  server; unverified `jwsRepresentation` parsing or trusting a client-supplied flag is worth a
  finding.
- Product identifiers in code must match what will exist in App Store Connect. Never edit them —
  list them so the user can create exactly these.

## 4. Guideline 5.1.1 — Privacy and accounts

- **Account deletion in-app** (5.1.1(v)) when the app supports account creation: a path the user
  can find and complete inside the app, not an email address, not a web form only. Trace it from
  the app's entry point — "the code has a `deleteAccount()` function" is not the requirement; the
  requirement is that a person can find and use it. Note where it lives and how many taps deep.
- Login options: read the current text on what an app offering third-party or social login must
  also offer. Which options the app should support is a **product decision** — surface it as a
  question with the requirement quoted, not as an edit.
- Requiring an account at all: check whether features that do not need an account are gated behind
  one. This is a real rejection cause and easy to miss when auth was built first.
- Every `NS*UsageDescription` for every permission the code requests — cross-reference the
  inventory's permission-API section against the plist's declared strings. Two failure modes:
  missing string (guaranteed crash on the permission prompt), and vague string ("needs camera
  access") which fails review. Each string states what the app does with the data, specifically.
  The reverse also matters: a declared usage description for a permission the app never requests
  looks like undisclosed data collection.
- What actually leaves the device: from the networking inventory, list each endpoint and what is
  sent. This becomes the App Privacy label draft in the report — the labels must match reality
  including what third-party SDKs collect.
- Hardcoded secrets: verify each candidate by reading the line. A shipped app binary is readable by
  anyone, so an embedded API key is compromised the day it ships. Distinguish keys designed to be
  public (a publishable client key with server-side restrictions) from ones that are not. Every
  real secret found needs both a code fix and a **rotation** note — moving it out of the binary
  does not un-leak it if it was ever committed. Check `git log` to see whether it was.
- `ITSAppUsesNonExemptEncryption`: absent means an export-compliance questionnaire on every single
  upload. Nearly every app qualifies for the exemption (HTTPS only), but the answer is the user's
  legal declaration — see the autofix rules for how to handle this one carefully.

## 5. Third-party SDKs and privacy manifests

- Build the SDK inventory from the dependency files, the SPM refs inside the pbxproj, and any
  `.xcframework` checked into the repo. Vendored binaries are the ones people forget.
- Cross-reference against the list of SDKs Apple requires to ship a privacy manifest and signature,
  fetched this run. Membership on that list is not stable — do not assume from the name.
- For each listed SDK: does the version in use actually include `PrivacyInfo.xcprivacy` and a
  signature? Look inside the resolved package/framework. An outdated version of a listed SDK is a
  hard upload rejection, and the fix is a version bump, not anything in the app's own code.
- The app's own `PrivacyInfo.xcprivacy`: present, in the app target, and correct for the four
  top-level keys per the fetched doc. `NSPrivacyAccessedAPITypes` needs an entry for every
  required-reason API the first-party code uses, each with a reason code that is actually valid for
  that category and actually true of this app. A wrong-but-present reason code is a rejection with
  a slower feedback loop than a missing one.
- Consistency: what the SDKs collect versus what the App Privacy labels will claim. A conflict here
  is caught by Apple automatically and is a common post-upload rejection.

## 6. Guideline 4.2 — Minimum functionality

Never auto-fix, never quietly pass. Give an honest read and hand the judgment back.

Ask whether the app does enough that it should be an app rather than a website, a widget, or a
re-skin of a template. The specific risks Apple names are worth checking against the fetched text:
web-view wrappers, apps whose entire content is one feed or one page, and apps that are primarily a
marketing vehicle. Then state your assessment in one honest paragraph — what the app does, what a
reviewer might see it as — and put the decision in "Needs your decision" as a question the user
answers, not a checkbox you tick.

Being genuinely useful here means being willing to say "this is thin, and here is the specific
reason a reviewer might say so." The user cannot act on false reassurance.

## 7. Device readiness the simulator hides

An app that runs perfectly in the simulator can fail on the reviewer's device. These are the gaps.
Most cannot be verified from code alone — the honest move is to list them as "verify on device"
items with what specifically to look for, rather than passing or failing them from a grep.

- Hardware the simulator fakes or lacks: camera, microphone quality, GPS, motion sensors, Face ID,
  push notification delivery, StoreKit sandbox behavior, on-device ML/model availability, Bluetooth,
  haptics. For each one the app uses, note that it is simulator-verified only.
- Cold start: first launch, no data, no network, no permissions granted yet. Also the launch-time
  budget — a slow or blank first screen on real hardware reads as broken.
- Network failure states: offline, slow, timeout, and a request that returns an error. Every
  network call site needs a user-visible failure path. Missing ones are 2.1 findings.
- Empty states: every list, library, history, and search result at zero items.
- Dark mode: hardcoded colors from the inventory that will not adapt. Check both appearances.
- Dynamic Type at the accessibility sizes: fixed `font(.system(size:))` values do not scale;
  layouts that fit at default size clip at AX5. Check the smallest supported device too.
- Safe areas: notch, Dynamic Island, home indicator, and landscape if supported.
- iPad: `TARGETED_DEVICE_FAMILY` including `2` means the app must genuinely work on iPad and needs
  iPad screenshots. If it does not, iPhone-only is a legitimate choice — but it is the user's
  choice. Flag the mismatch, do not resolve it.
- Accessibility labels on controls that have no text (icon-only buttons). Not a rejection cause
  in most cases, but cheap and it belongs in Polish.
