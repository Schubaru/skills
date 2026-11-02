# Step 1 — Fetch the current requirements

Nothing in the audit is trustworthy until this step finishes, because everything downstream cites
these documents. Do this first, in parallel where possible, and write down what you got.

## Sources

Fetch all of these with WebFetch. They are listed with what to actually extract — a full page dump
is wasted context, and the guidelines page in particular is very long.

| # | URL | Extract |
|---|-----|---------|
| 1 | `https://developer.apple.com/app-store/review/guidelines/` | Text of 2.1, 2.3.x, 3.1.1, 3.1.2, 3.1.3(a–b), 4.2, 5.1.1(i–v), 5.1.2. Note the "last updated" date printed on the page. |
| 2 | `https://developer.apple.com/news/upcoming-requirements/` | Every active requirement with its enforcement date: minimum Xcode/SDK for new submissions, and anything else with a deadline in force now or soon. |
| 3 | `https://developer.apple.com/documentation/bundleresources/privacy-manifest-files` | Structure of `PrivacyInfo.xcprivacy`, the four top-level keys, what each expects. |
| 4 | `https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api` | The current required-reason API categories and the valid reason codes for each. This list grows — read it, do not recall it. |
| 5 | `https://developer.apple.com/support/third-party-SDK-requirements/` | The list of SDKs that must ship a privacy manifest and a signature. |

Also fetch, when the audit will reach them:

- App Privacy label data categories — `https://developer.apple.com/app-store/app-privacy-details/`
- Screenshot specifications — `https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/`
  (needed for the App Store Connect section; sizes change with each device generation)

Apple reorganizes documentation URLs. If one 404s or redirects somewhere unrelated, run a
WebSearch for the topic scoped to `developer.apple.com`, follow the current URL, and record the URL
you actually used. A moved page is a fetch success; a page you could not find is a fetch failure.

**Known failure mode: `developer.apple.com/documentation/*` pages render client-side.** WebFetch
often receives the page title and an empty body — sources 3 and 4 above are the usual victims. The
tell is a response that describes the page rather than quoting it. Try the alternate URL forms and
the relevant technote once, then stop: three or four attempts is enough to establish that the
content is not reachable this way, and further retries just burn context on the same empty shell.
Mark it failed and, in the report, hand the user the URL with a one-line instruction for what to
read there. A two-minute manual lookup they can actually complete beats a guessed value that gets
them rejected.

## Record what you fetched

Write `app-store-readiness/requirements-snapshot-YYYY-MM-DD.md` before auditing. It is short — for
each source: the URL used, fetch status, the page's own "last updated" date if it shows one, and a
condensed extract of the rules that will be cited. Two reasons this file earns its place: the
report can cite "the version of 3.1.1 I read on 2026-08-17," and a re-run three months later can
diff against it to show that Apple's rules moved, not just the code.

## When a fetch fails

Say so, loudly and specifically, and degrade the affected checks rather than the whole audit:

- The report's header carries a **Requirements freshness** block listing each source as fetched or
  failed, with the failure reason.
- Every check that depended on a failed source is tagged `UNVERIFIED — <source> unreachable` and
  moves to its own section rather than into a severity tier. It is not a blocker and it is not a
  pass; it is unknown.
- Repo-evidence checks still run. "This paywall has no Restore Purchases button" is an observation
  about the code, and it stands on its own even when you could not read Apple's wording for 3.1.1.
  State the observation, and mark the guideline citation as unverified.

What to never do: fill the gap from memory, or soften it to "based on standard App Store
requirements." That phrasing reads as verified to a user who is about to submit.

## Reading the guidelines efficiently

The guidelines page is one enormous document. Ask WebFetch for the specific sections rather than a
summary of the whole thing, and quote the operative sentence for each guideline you cite — a
finding that says "5.1.1(v) requires in-app account deletion, per the text fetched today" is
checkable by the user; one that says "Apple requires account deletion" is not.

Watch for wording that has teeth and is easy to misremember: what exactly must be *in the binary*
versus on a website, which options count as an "equivalent" privacy-preserving login, whether an
account-creating app is even permitted to require an account for its core function, and what the
current carve-outs are. These are exactly the places a stale memory produces a wrong finding.
