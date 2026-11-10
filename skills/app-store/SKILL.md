---
name: app-store
version: 1.0.0
user-invocable: true
argument-hint: "[path to iOS app repo, or nothing for the current one]"
description: "Audits a native iOS app against Apple's *current* App Store Review Guidelines, SDK minimums, and privacy-manifest requirements — fetched live from developer.apple.com on every run, never recalled from memory — then safely fixes what it can and writes a dated readiness report listing every remaining blocker. Use this whenever the user is heading toward the App Store or TestFlight and wants to know what stands in the way: \"am I ready to submit\", \"will Apple reject this\", \"what's left before I ship\", \"App Store review\", \"app review checklist\", \"prep for App Store Connect\", \"why would this get rejected\", \"privacy manifest\", \"PrivacyInfo.xcprivacy\", \"required reason API\", \"App Privacy labels\", \"account deletion requirement\", \"guideline 5.1.1 / 3.1.1 / 2.1 / 4.2\", \"restore purchases\", \"encryption export compliance\", \"SDK deadline\", \"screenshot sizes\". Use it even when the ask sounds narrow (one guideline, one plist key, one rejection email) — a single rejection usually has siblings, and the audit surfaces them. Also use it as a re-run to see what closed since last time. Do NOT use for Android/Play Store, for web apps, or for designing features (that is a product question, not a review question)."
---

Audits an iOS app for App Store submission, fixes what is safe to fix, and reports honestly on
what is left. The output is a dated report in `app-store-readiness/`, re-runnable so a second pass
shows what closed and what is new.

## The one rule that makes this skill worth running

**Never state an Apple requirement from memory.** Apple revises the Review Guidelines several
times a year, moves SDK minimums on hard deadlines, expands the required-reason API list, and
changes screenshot dimensions. A model's recollection of these is confidently stale, and a stale
audit is worse than no audit — it grants false confidence about the exact things that block
submission.

So every run starts by fetching the live sources. Every finding cites a rule that was read *this
run*, with the URL it came from. When a fetch fails, the affected checks are reported as
**UNVERIFIED** with the reason — never quietly backfilled from what you think you know. It is
completely fine for a report to say "could not reach the guidelines page, so the 3.1.1 checks
below are based on the repo evidence but the guideline text is unverified." It is not fine to
present a remembered rule as a current one.

The second honest-framing rule: **approval is never guaranteed.** Human reviewers exercise
judgment. The best verdict this skill may issue is "no known blockers remain."

## Workflow

Work through these in order. Each step has a reference file — read it when you reach that step,
not before, so a full audit does not consume the context window on rules it never uses.

1. **Fetch current requirements** → read `reference/live-requirements.md`
   Pull the Review Guidelines, upcoming-requirements/SDK minimums, and privacy-manifest docs.
   Record what was fetched, when, and what failed. Nothing else happens until this is done.

2. **Inventory the repo** → run `scripts/inventory.sh` from the repo root.
   It dumps the mechanical facts (plists, entitlements, build settings, dependency inventory,
   asset catalog contents, StoreKit/auth/network call sites, candidate secrets) as one sectioned report
   so you are auditing the actual project rather than an assumption about it. Read its output
   before opening individual files, then open the files the inventory points at.

3. **Audit** → read `reference/audit-domains.md`
   The domain-by-domain checks: build/toolchain, 2.1 completeness, 3.1.1/3.1.2 purchases,
   5.1.1 privacy and accounts, third-party SDKs and privacy manifests, 4.2 minimum functionality,
   and the device realities the simulator hides. Every finding needs a guideline number, a
   `file:line`, and a concrete fix.

4. **Fix what is safe** → read `reference/autofix.md`
   It draws the line between what to change directly and what to only ever ask about. When a fix
   is not clearly safe, it becomes a finding, not an edit.

5. **Report** → read `reference/report.md`
   The report structure, severity tiers, and the diffing rules that make a re-run meaningful.
   `reference/app-store-connect.md` holds the outside-the-codebase checklist that feeds the
   final section — read it when writing that section.

## Standing constraints

**Evidence or nothing.** A finding without a file path and line number is a guess. If you suspect
something but cannot point at it, either go look, or write it in "Needs your decision" as a
question. Padding the blocker list with plausible-sounding items trains the user to ignore the
report, which costs them the real blocker buried in the noise.

**Never touch without asking**, no matter how obvious the fix looks: bundle identifier, signing
settings, provisioning profiles, team ID, version or build numbers, prices, product identifiers,
subscription tiers, and anything that is a product decision (whether the app does enough to
justify 4.2, which login methods to offer, whether to support iPad). And never delete or disable
code to make a check pass — that converts a real finding into a silent one.

**One person is doing all of this.** Assume no QA team and no lawyer. That means: order the next
steps so nothing blocks on something later in the list, say plainly when a step needs a real
device rather than the simulator, and flag where the user genuinely needs their own Terms of Use
and Privacy Policy documents rather than implying a link alone satisfies the requirement.
