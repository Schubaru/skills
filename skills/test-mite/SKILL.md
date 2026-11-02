---
name: test-mite
description: >
  Build and maintain deterministic routing test suites for web apps: Playwright end-to-end
  coverage of every user-facing route plus code-level route tests, a route inventory with a
  coverage report, and strict test-integrity rules (never silently fix, skip, or weaken a
  failing test). Use this whenever the user wants routing tests, navigation tests, route
  coverage, redirect/guard/deep-link verification, an audit of which screens lack test
  coverage, or complains that "navigation broke" / "the route is wrong" / "deep links are
  untested" — even if they don't say "Playwright" or "e2e". Also use it when a routing test
  fails and the user asks what to do about it: this skill defines the drift-vs-bug protocol.
  Every run ends by publishing a readable findings artifact whose defects and walked screens
  each link to the exact screen and design frame they describe, so use this too whenever
  someone wants a flow walked end to end and the results written up for other people to read.
---

# Routing Tests

Ensure every user-facing screen has deterministic coverage that validates **routing behavior** —
reachability, navigation, params, redirects, guards, fallbacks — independently of how the UI looks.
The suite must run locally and in CI, and its integrity is worth more than a green result.

## Core principles

1. **Routing ≠ cosmetics.** A routing test asserts: the URL you end up at, the redirect that
   happened, the guard that fired, and *one piece of identifying content* proving the right screen
   rendered (a heading, a landmark role, a `data-testid`). It never asserts colors, spacing,
   copy details, or layout. A pure visual redesign must not break a single routing test; if it
   does, the test was asserting the wrong thing.
2. **Deterministic or delete it.** No `waitForTimeout`, no `networkidle`, no time/locale/random
   dependence, no test order dependence. Wait on the identifying content itself. If a screen
   renders relative dates or random fixtures, assert something stable on it instead.
3. **The inventory is the contract.** Coverage is measured against a checked-in route manifest,
   not against vibes. A route missing from the manifest is invisible to the report — so building
   the manifest honestly is step one, and keeping it current is part of every routing change.
4. **Verification is scripted, never judged.** "Looks right" is not evidence. Every claim in your
   report must come from a command exit code or a script's output.

## Workflow

### Step 1 — Build the route inventory

Find the app's routing source of truth (e.g. the `<Routes>` table / router config for React Router,
`pages/`/`app/` dirs for Next, `routes` array for Vue Router). Enumerate:

- **Path routes** — every path, including dynamic segments (`/store/p/:productId`).
- **Param-state routes** — in many SPAs the load-bearing navigation lives in query params
  (step params like `?s=`, variant params like `?v=`, persona/state params). Treat a query-param
  state as a route when it changes *which screen* the user is on, not merely its data.
  Don't enumerate every possible param combination — inventory the ones that gate, redirect,
  fork, or hand off.
- **Redirects and aliases** — old paths kept as redirects, `/` remaps.
- **Guards** — auth gates, role/persona gates, entitlement checks.
- **Fallbacks** — 404 / unknown-route behavior, invalid-param behavior.

Write it to `tests/routing/routes.manifest.json` (schema below, one entry per route/behavior).
Each entry gets an `expect` (the identifying content) and a `behaviors` list (redirects, guards,
param handling worth testing). If you can't yet determine a route's identifying content, keep the
entry with `"expect": null` — the coverage report will list it as uncovered, which is the truth.

```json
{
  "routes": [
    {
      "path": "/portal",
      "entry": "checkout hand-off; also direct",
      "expect": { "role": "heading", "name": "Your care" },
      "behaviors": [{ "slug": "legacy-redirect", "note": "/account redirects here preserving query" }],
      "notes": "optional"
    }
  ]
}
```

Show the manifest (or its summary) to the user as the proposed test plan before writing tests.

### Step 2 — Set up Playwright

- Add `@playwright/test` as a devDependency if absent (ask before adding if the project is
  dependency-averse; check whether `playwright-core` already exists and match its major version).
- Create `playwright.config.ts` scoped to `tests/routing/`:
  - `webServer` pointing at the project's existing dev/preview command and port — reuse what the
    repo already has (a launch config, `npm run dev`); never invent a new server setup.
  - `retries: 0` locally. Retries hide nondeterminism; a routing test that needs a retry is broken.
    In CI, `retries: 1` is acceptable **only** with `trace: 'on-first-retry'` so the flake is
    diagnosable — and a pass-on-retry should still be reported as instability (see Step 6).
  - `trace: 'retain-on-failure'`, `screenshot: 'only-on-failure'` — these are the evidence your
    failure reports cite.
  - Fixed viewport; animations disabled if the app supports a reduced-motion flag.
- Do not touch CI workflow files, branch protections, or merge settings unless the user explicitly
  asks. Document the commands CI *would* run; adding them to CI is the user's call.

### Step 3 — Write the browser-level tests

Organize `tests/routing/` by concern, not by page aesthetics:

- **`reachability.spec.ts`** — table-driven from the manifest: for every entry with an `expect`,
  `page.goto(path)` and assert the identifying content is visible and `page.url()` matches
  (accounting for declared redirects). One data-driven spec covers the whole inventory cheaply.
- **One spec per behavior cluster** — `redirects.spec.ts`, `guards.spec.ts`, `params.spec.ts`,
  `fallbacks.spec.ts`, and one file per multi-step flow whose hand-offs matter
  (e.g. `checkout-handoff.spec.ts`). These assert transitions: click/submit → correct destination
  URL → identifying content. Navigate through the app's real entry points here, not just `goto`.

Tag every test with the route(s) it covers using a title annotation the coverage script can grep:

```ts
test('@route:/portal @behavior:redirect legacy /account preserves query', async ({ page }) => { ... })
```

Selector policy, strictest first: `getByRole` with accessible name → `data-testid` you add for this
purpose → never CSS classes, never nth-child, never visual properties. If no stable selector
exists, adding a `data-testid` to the app is the correct fix and is in scope.

### Step 4 — Code-level route tests

Where the architecture supports it, test routing logic without a browser — these are faster and
pin the logic the e2e suite samples:

- React Router: render the route table with `createMemoryRouter` and assert matches/redirects, or
  unit-test extracted route-decision functions (guards, `resolveLane`-style routers, param parsers).
- Any framework: if route decisions live in pure functions, test them directly.
- **Match the repo's existing test idiom** (its runner, file naming, assert style). If the repo has
  no runner, plain node/tsx assert files beat introducing a second framework.

Skip this layer only if routing is 100% declarative config with zero extractable logic — and say
so in the report rather than silently omitting it.

### Step 5 — Coverage report

Run the bundled reporter (copy `scripts/route-coverage.mjs` from this skill into the project's
`tests/routing/` if not already there):

```bash
node tests/routing/route-coverage.mjs
```

It diffs the manifest against `@route:`/`@behavior:` tags in the spec files — and counts every
manifest entry with a non-null `expect` as covered when a table-driven spec consumes the manifest
(those tags are generated at runtime, invisible to grep). It prints:
routes covered, routes missing coverage, and declared behaviors with no test. Exit code 1 when
anything critical is uncovered, so it can gate CI if the user wires it in. Include its output
verbatim in your summary.

### Step 6 — Failures, drift, and integrity (non-negotiable)

When a test fails, classify before touching anything:

- **Application bug** — the app violates its own intended routing. Report it; fix the app only if
  asked. Never adjust the test to match broken behavior.
- **Test drift** — product behavior *intentionally* changed (check git history, recent commits,
  decision logs) and the test encodes the old behavior. **Stop.** Report: what changed, which
  commit/decision changed it, which tests are affected, and the smallest explicit test update that
  would re-align them. **Do not apply the update without the user's confirmation** — in a
  non-interactive run, leave the test failing and report the drift.
- **Environment instability** — server not up, port conflict, flaky dependency. Fix the
  environment or the test's determinism; never paper over with waits or retries.

Hard rules, no exceptions without explicit user sign-off given *after* you've reported the
situation: never skip, disable, quarantine, `.fixme`, comment out, loosen an assertion, add a
conditional bypass, or broaden a matcher to make a test pass. A red suite that tells the truth is
the deliverable; a green suite that lies is a defect you introduced.

Every failure report includes: the route + scenario, expected vs actual (URLs and content), the
trace/screenshot path Playwright saved, and your classification with the evidence for it.

### Step 7 — Publish the findings as an artifact (always)

The suite belongs in the repo; the *findings* belong somewhere a person can read. Terminal
scrollback is the wrong home for them — the people who own the flow (designers, PMs, whoever
decides whether a defect is real) don't run your suite and don't read your terminal. So every
engagement ends with a published artifact, not only a chat summary.

Publish a skeleton as soon as you start walking and republish as findings land, so the user can
follow along and an interrupted pass still leaves something behind.

**When fixes land, add a run — don't overwrite the one that found them.** Republishing in place is
right while a single walk is still filling in, but once a defect is fixed the old page was the
*evidence*, and rewriting it leaves a reader who arrives later looking at "2 defects, fixed" with
no way to see what the flow actually did or how bad it was. The page therefore holds one full view
per pass (Run 1 — the initial walk · Run 2 — the re-walk after fixes), with the template's switcher
between them and the selection in the URL hash so a specific run is linkable. Never edit an earlier
run to agree with a later one: a fixed finding stays a live defect in Run 1 and gains its "fixed"
chip in Run 2, alongside what the re-walk did to confirm it. `references/findings-artifact.md` has
the rule in full.

**When the pass walks several user scenarios, give each its own tab one level below the run.**
Personas, account states and entry points are different readers' concerns: the person who owns
"data is months old" should open the page on their cards, not scroll past eight other people's.
Each scenario tab holds its own status, scoreboard, findings and walk log, carries its open-defect
count on the tab, and is linkable with the run (`#run-1/no-weight`). Findings that belong to no
single scenario go in a last "Whole suite" tab rather than being copied into each. The template
has the markup and the script; the reference has the rules.

**Every finding and every screen you logged must link to the thing it is about.** This is the rule
that makes the page worth publishing: "the cart doesn't name the visit" is a claim, while the same
sentence beside a link that opens that exact screen is evidence a reader confirms in one click.
Link the live app URL seeded to the state described, and — where the repo names screens by id in a
review board, Storybook, or similar config — the frame id too, derived from that config and never
invented. When a defect is a *contrast* between two states, link both; the comparison is the
argument. Link the correct-behavior screens as well, so nobody over-reads the blast radius.

Each defect card reads as three bands: the header (chips + headline), the evidence
(expected / actual / root cause / bound) and the footer (why it matters + links). **The evidence
band is collapsed by default** — a reader scanning ten findings is deciding which ones concern
them, and that decision is made from the header and footer, not from four paragraphs of proof per
card. The proof opens for whoever wants to verify it.

Every card declares exactly one `data-kind` — `defect`, `noted`, `held-up`, `expected-gap`,
`environment` or `drift` — and the template turns those into a row of filter tabs above the
findings. It matters that this is one axis rather than a loose pile of notes: a reader who owns
the product, a reader checking whether your harness was sound, and a reader deciding whether a
stale test is worth updating are three different people, and each should be able to see only
their own cards.

Read `references/findings-artifact.md` for the full structure, the kinds table and the
link-derivation rules, and start from `assets/findings-template.html` rather than authoring a page
from scratch — what's worth reusing is the token structure, the kind/classification chips, the
filter tabs, the collapsed evidence block and the link components.

The integrity rules above govern this page too. Severity must match evidence: if a finding turns
out narrower than you first wrote, rewrite the card rather than leaving an overstated headline with
a hedge buried underneath — but if the correction comes from a *later* run, make it in that run and
say what changed, rather than quietly editing the earlier one. Keep your own harness problems in
their own labelled card, so a reader never has to guess whether a line describes their product or
your tooling.

## Output format

End every engagement with exactly this structure:

```
## Route inventory & plan     (step 1, or "unchanged" on re-runs)
## Test files                 (created/updated, with what each covers)
## Run commands               (copy-pasteable: install, run suite, run coverage report)
## Coverage summary           (the reporter's output)
## Failures & integrity       (failures with classification, drift awaiting confirmation,
                               anything skipped — or "none")
## Findings artifact          (the published URL — always, even when nothing failed;
                               name the runs it now holds if you added one)
```

Default behavior throughout: **fail safely**. When in doubt between a green result and an honest
one, choose honest.
