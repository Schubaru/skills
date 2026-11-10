# Step 4 — Fixing

The test for whether a fix is safe: **could this edit be wrong in a way the user would not notice
before shipping?** If yes, it is a finding, not an edit. A silently-wrong permission string or a
guessed privacy-manifest reason code is worse than a missing one, because the missing one gets
fixed and the wrong one ships.

Every edit gets recorded for the report's "Fixed automatically" section: file, what changed, why,
which guideline it addresses, and the diff (`git diff` after the pass, or per-file diffs if the
tree already had changes).

## Safe to fix directly

**Missing or vague `NS*UsageDescription` strings.** Write what this app actually does with the
data, derived from the call site you found — not a generic sentence. "wordsword uses the microphone
so you can say a word aloud and hear how close your pronunciation is" beats "This app needs
microphone access." If you cannot tell from the code what the data is used for, that is a question
for the user, not a string to invent. In a generated project (`project.yml`, `Project.swift`), the
edit goes in the generator input; in a hand-managed project, the `Info.plist` or the
`INFOPLIST_KEY_*` build settings — match whatever the project already uses.

**`PrivacyInfo.xcprivacy` entries for required-reason APIs you found in first-party code.** Create
the file if absent (and add it to the app target's resources — a manifest that is not in the bundle
does nothing). Use the structure and reason codes from the doc fetched this run. Only add entries
for API usage you actually located, with a reason code that is genuinely true of this app; if two
reason codes could apply and the code does not disambiguate, add the entry and flag the choice for
confirmation rather than picking silently. Leave `NSPrivacyTracking`, tracking domains, and
collected-data types for the user to confirm — those are declarations about their business, not
facts you can read off the code.

**A Restore Purchases affordance where StoreKit is already wired.** Add the button in the existing
paywall or settings view, matching the surrounding code's style, calling the restore path the
project's StoreKit version uses, with loading, success, and failure states. If StoreKit is *not*
wired, do not scaffold a purchase system — that is a feature, not a fix.

**Subscription disclosure text and Terms/Privacy links on an existing paywall.** Pull title,
duration, and price from the StoreKit `Product` rather than hardcoding them, so every storefront
gets correct values. If the user has no Terms/Privacy URLs yet, leave a clearly-marked constant and
raise it as a blocker — never invent a URL, and never point at a placeholder domain.

**Placeholder strings, dead links, obvious crash paths.** Replace user-visible placeholders with
real copy in the app's voice. Convert reachable force unwraps on network or user input to safe
handling with a real user-visible failure path — a silent `if let` that shows nothing is a
different 2.1 finding, so give the failure a face.

**Hardcoded secrets → configuration.** Move the value to an xcconfig / `Info.plist` key read at
runtime / environment-injected build setting, matching the project's existing pattern, and make
sure the config file is gitignored. Then check `git log -S` for the value: if it was ever
committed, the report says **rotate this key** with the specific service named. Moving it does not
un-leak it.

**`ITSAppUsesNonExemptEncryption` — carefully.** Adding it removes a per-upload questionnaire, but
it is an export-compliance *declaration*, which is legally the user's to make. Set it only when the
evidence is unambiguous — the app uses nothing beyond HTTPS/ATS and platform crypto — state the
evidence you relied on in the report, and tell the user to confirm it. If the app does anything
else with encryption (custom crypto, encrypted local storage beyond Data Protection, a VPN or
proxy), do not set it: raise it as a question.

## Never touch — surface as a question instead

Bundle identifier · signing settings, provisioning profiles, team ID · version and build numbers ·
prices, product identifiers, subscription tiers · which login methods the app offers · whether the
app supports iPad · anything under guideline 4.2 · and never delete or disable code, tests, or
features to make a check pass.

These share a property: getting them wrong is expensive and the wrongness shows up late — a changed
bundle id orphans an App Store Connect record, a bumped build number breaks an upload, a removed
login method is a product decision with users attached. The cost of asking is one paragraph in the
report.

## When a fix touches a generated project

If `project.yml` or `Project.swift` exists, the `.xcodeproj` is regenerated output. Edit the
generator input and note in the report that the user needs to regenerate (`xcodegen generate`,
`tuist generate`) for the change to take effect. Fixing the pbxproj directly produces a change that
works today and vanishes at the next generate — the worst kind of fix, because it verifies clean.

## After fixing

Rebuild. A fix that breaks the build is worse than the finding it closed, and this is the one
verification step that is cheap and conclusive:

```
xcodebuild -scheme <SCHEME> -destination 'generic/platform=iOS' -configuration Release build CODE_SIGNING_ALLOWED=NO
```

If it fails, fix it or revert that edit before writing the report. Report the build result honestly
in the report header, including "did not build" if that is the truth.
