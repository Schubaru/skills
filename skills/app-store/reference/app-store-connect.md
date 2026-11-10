# The App Store Connect half

Everything here happens in a browser, in the user's account, with their credentials. This skill
cannot do any of it — so the job is to make the list precise enough that it is mechanical, and to
pre-fill every answer that the audit already determined.

Specs in this area change constantly (screenshot dimensions with every device generation, label
categories, age-rating questions). **Fetch, do not recall** — see `live-requirements.md`. Where a
spec could not be fetched, say "check the current requirement at <URL>" rather than naming a number.

## Sequenced, because these gate each other

**1. Apple Developer Program membership.** Paid, annual, and it can take a day or more to activate
(longer for an organization needing a D-U-N-S number). Nothing downstream works without it, so if
the user has not enrolled, that is step one and it goes at the very top of the report.

**2. Certificates, identifiers, profiles.** Register the exact bundle identifier found in the audit,
with the capabilities the entitlements file declares (In-App Purchase, Sign in with Apple, push,
App Groups...). The identifier must match the binary exactly; it cannot be changed after the app
record exists.

**3. The app record.** Name (must be unique across the App Store — worth checking availability
before falling in love with it), primary language, bundle id, SKU, and user access.

**4. In-app purchases and subscriptions.** Create the exact product identifiers the audit found in
the code — list them verbatim in the report so this is copy-paste, not recall. Each subscription
needs its group, duration, price tier per storefront, localized display name and description, and a
review screenshot of the purchase UI. A subscription cannot be submitted for review without at
least one localization and a screenshot, and IAPs are reviewed alongside the first binary.

**5. App privacy (labels).** Answered from the audit's data-flow section: what leaves the device
from first-party code *and* what every third-party SDK collects. Mismatches with the SDK privacy
manifests are caught automatically and rejected. Also needs a Privacy Policy URL that is live and
reachable — for a solo developer without legal review, flag that this is a document they must
actually have, not a checkbox.

**6. Age rating questionnaire.** Answered honestly about the app's content, including any
user-generated content, web views that can reach arbitrary content, and any AI-generated content
the app surfaces. Over-rating is safer than under-rating; under-rating is a rejection and a removal
risk.

**7. Screenshots.** Required device sizes and their exact pixel dimensions change — fetch the
current screenshot specifications. Two things the audit determines: whether iPad screenshots are
needed (from `TARGETED_DEVICE_FAMILY`) and whether the screenshots can honestly show the app's
actual UI. Screenshots must depict the app in use; mockup frames, marketing text over unreadable
UI, and screens the app does not have are rejection causes.

**8. Metadata.** Name, subtitle, promotional text, description, keywords, support URL, marketing
URL. Keyword stuffing, competitor names, and pricing claims in the description all get rejected.
Support URL must resolve to something real.

**9. Demo account and review notes.** If anything is behind a login, a paywall, or hardware the
reviewer lacks, the notes must contain working credentials and step-by-step instructions to reach
the gated features. This is the single highest-yield thing a solo developer can do to avoid a
week-long rejection loop. The audit's 2.1 section already determined what is gated — turn that into
draft review-notes text in the report, ready to paste.

**10. Pricing and availability.** Price tier or free, territories, release method (manual release is
usually right for a first launch — it lets the user control the moment).

**11. Build upload.** Archive in Xcode, validate, upload, wait for processing (minutes to a couple
of hours), attach the processed build to the version, answer the export-compliance question if
`ITSAppUsesNonExemptEncryption` is not set in the plist.

**12. TestFlight first.** Worth its own line in the report: an internal TestFlight build installs on
a real device and surfaces every simulator-hidden problem from audit domain 7 before a reviewer
sees them. It costs one upload and it is the cheapest insurance available to someone with no QA.

**13. Submit for review.** Then expect the possibility of rejection and treat it as normal — the
resolution center is a conversation, and most first rejections are one specific fixable thing.

## What to put in the report

For each step: what the user does, what the audit already determined (bundle id, product ids, data
categories, gated features, whether iPad screenshots are needed), and where a spec must be checked
live rather than trusted from the report. Anything that has a waiting period — enrollment, build
processing, a Privacy Policy URL that has to be published — gets marked so the user starts it first.
