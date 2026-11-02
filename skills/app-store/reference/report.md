# Step 5 — The report

Write to `app-store-readiness/YYYY-MM-DD-readiness.md` (append `-2`, `-3` for multiple runs in one
day). Keep the requirements snapshot from step 1 beside it. Never overwrite a previous report —
the history is what makes re-runs meaningful.

## Structure

```markdown
# App Store readiness — <App name> — <YYYY-MM-DD>

## Verdict
<One of:>
- **Not submittable today.** N blockers, M likely-rejection items.
- **No known blockers remain.** M likely-rejection items, P polish items.

<Two or three sentences: the shape of what is left, and the single thing to do first.>

Approval is never guaranteed — reviewers exercise judgment, and this audit covers what is
checkable from the repo plus the guidelines as published today.

## Requirements freshness
| Source | Status | Apple's last-updated | Fetched |
|---|---|---|---|
| App Store Review Guidelines | fetched / FAILED: <reason> | <date> | <timestamp> |
| Upcoming requirements | ... | | |
| Privacy manifest docs | ... | | |
| Required-reason API list | ... | | |
| Third-party SDK list | ... | | |

Build check: <Release build / archive result, or why it could not be run>

## Since last run            <!-- only when a previous report exists -->
**Closed (N):** <finding + what closed it>
**Still open (N):** <finding + how long it has been open>
**New (N):** <finding + whether it is new code or a changed Apple requirement>

## Blockers — will be rejected, or cannot upload at all
### B1. <One-line title>  ·  Guideline <n.n.n>  ·  `path/to/File.swift:88`
**What:** <the evidence — what is there, or what is absent and how you checked>
**Why it blocks:** "<operative phrase from the guideline text fetched this run>"
**Fix:** <concrete, actionable — the code change, or the exact App Store Connect step>

## Likely rejection — reviewer discretion
<same shape; these are judgment calls where a reviewer could go either way — say which way you'd bet and why>

## Polish
<same shape, terser — real but not review-blocking>

## Unverified
<Checks that could not be completed because a source fetch failed, or because they need a real
device. Each says what is unknown and how to resolve it. Not passes.>

## N/A — checked, does not apply
<Domains that genuinely do not apply to this binary, with the evidence: "no StoreKit import, no
product identifiers, no paywall" rather than a bare "no IAP". This section matters more than it
looks — it is how the user can tell the difference between a domain you audited and cleared and a
domain you never reached.>

## Fixed automatically
### <File> — <what changed>
**Why:** <guideline + the finding it closes>
```diff
<the actual diff>
```
<Anything the user must still do for this fix to be complete — rotate a key, regenerate the
project, supply a real URL.>

## Needs your decision
Numbered questions, each with the context needed to answer it and the consequence of each answer.
4.2 functionality, login methods, iPad support, pricing, anything with a product or legal choice
inside it.

## Next steps
### In the codebase
1. ...
### In App Store Connect
1. ...
```

## Rules that keep the report honest

**Correct the brief when the repo disagrees with it.** The user's description of their own app can
be aspirational, out of date, or about a different branch — "it monetizes through subscriptions" is
worth checking against whether anything imports StoreKit. When the code says otherwise, say so in
the verdict, plainly and without ceremony, and audit what is actually there. Auditing the app the
user described instead of the app that exists produces a report full of findings about nothing.

**Severity is about consequence, not confidence.** Blocker means the upload fails or rejection is
near-certain. Likely rejection means a reviewer could reasonably reject. Polish means it is real
but nobody rejects for it. Uncertainty about whether something is true goes to Unverified or
becomes a question — never inflate a maybe into a blocker to be safe, because a padded blocker list
gets skimmed and the real blocker gets skimmed with it.

**Order the next steps so nothing waits on something below it.** The user is doing all of this
alone. Signing and a paid developer account gate archiving; the app record gates uploads;
screenshots need a build to screenshot; the demo account has to exist before review notes can name
it. Sequence accordingly, and mark anything that needs a real device, a paid account, or a
turnaround (a Privacy Policy URL that must be live) so the user can start it early.

**Separate codebase work from App Store Connect work** — they use different tools, different
sessions, and only one of them is something this skill can help with directly. Read
`app-store-connect.md` when writing that half.

## Re-run diffing

On a re-run, read the most recent previous report before auditing (the inventory lists them). Match
findings by their stable identity — guideline plus file plus the specific thing, not the wording,
since your phrasing will drift between runs. Then:

- **Closed**: it was in the last report and the evidence is now gone. Verify it actually closed;
  do not credit a finding as closed because the file was deleted or the feature was disabled — that
  is worth saying out loud.
- **Still open**: carry it forward with how long it has been open. A finding open across three runs
  is usually blocked on something the user has not been told clearly enough.
- **New**: distinguish "new code introduced this" from "Apple's requirement changed" — diff against
  the previous requirements snapshot to tell. The second kind is the whole reason this skill fetches
  live, and it deserves to be called out by name.
