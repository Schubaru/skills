---
name: deviceroy
description: Audits a mobile app's UI screen by screen for iOS 27 (Liquid Glass) vs Android 17 (Material 3 Expressive) platform fit and produces one plain-language report page per platform (iPhone and Android), published as a private Artifact. Each page lists problems per screen with why they matter and how to fix them, a menu-treatment table, annotated screenshots, a Prototype tab showing each screen before and after the recommended fixes (web prototypes), and implementation guidance checked against installed dependencies. Read-only and deterministic; never edits app code. Use this when someone asks to audit, review, or check an app, prototype, or screens for iOS and Android differences, platform parity, native feel ("does this feel native"), Liquid Glass or Material 3 Expressive adoption, tab bars, toolbars, menus, sheets, or back buttons, or points at a prototype link, canvas, route, or screen and wants platform feedback, even without saying "audit". Works with React Native/Expo, Flutter, Swift, and web prototypes.
allowed-tools: Read, Grep, Glob, Bash, Artifact
---

# deviceroy: platform UI audit

Audits every screen against a fixed, versioned rule catalog and reports what each platform
should do differently. Three jobs in one run:

1. **Parity audit**: where the app departs from iOS 27 or Android 17 / M3 Expressive conventions.
2. **Menu treatments**: every menu-like element classified by intent and matched to one fixed
   treatment per platform (`references/menu-treatments.md`).
3. **Before and after**: when the app has a web prototype, each page gets a **Prototype** tab:
   every screen in a device frame as it is today, and the same screen with the listed fixes
   applied, so reviewers can see what the recommendations would look like.

All mechanics are scripts. Your job is narrow: set up the config once, run the pipeline,
make judgment calls the scripts can't make, publish the pages, and summarize. That split is
what makes the report trustworthy: the same commit and config give a byte-identical
`findings.json`, and the same run folder gives byte-identical report pages.

## Rules that keep the report honest

- **Never write into the audited project.** Config, runs, and judgments live in the
  project's home in the skill workspace (`~/.claude/skills/deviceroy-workspace/projects/<name>/`,
  printed by preflight as `home`). No files in the project, no installs, no git writes, no code
  changes. If the user asks for fixes mid-run, finish the report first, then hand off the rule
  IDs to a separate implementation pass. A read-only audit is only useful if people can run it
  on any repo without leaving a trace.
- **Every finding maps to a catalog rule** (`references/rules.json`). Anything you notice that
  matches no rule is an *observation* (shown on its screen as a note), never a finding. You never
  set severity or recommendation copy; those come from the catalog.
- **Evidence levels are claims about what was seen**: `V` a simulator/emulator render,
  `C` source code, `W` a web render of the prototype. A web render cannot show Liquid Glass,
  native tab bars, UIMenu, or Material components, so never describe W evidence as if it
  proved native rendering. The scripts enforce each rule's required evidence; don't work
  around a skipped rule by asserting it in prose.
- **The report pages come from `render_report.py`, never from you.** Their design lives in
  `assets/report-template.html` and every reader-facing word in `references/plain-copy.json`
  (written for a tenth-grade reader). Don't hand-write, restyle, summarize into, or "improve" a
  page after it renders: people compare pages across runs and projects, and they only can if
  every page is built the same way. To change the look or wording, change the template or the
  copy file (see "Changing the catalog").
- **An After frame is a mock-up, never evidence.** `capture_after.mjs` loads each screen of the
  web prototype, patches the listed fixes into the page in the browser (nothing is written to
  the project), and photographs it. The Prototype tab says so at its foot. Don't describe an
  After frame as a native render, don't draw or retouch one yourself, and don't add a fix to it
  that the report doesn't list for that screen. A listed problem whose fix can't be shown in
  that view (a closed sheet, a menu, Dynamic Type) is listed under "Not shown" with the reason;
  that is the honest outcome, not a gap to paper over.
- **Implementation guidance names only APIs that exist in the installed dependencies.**
  `verify_api.py` checks every snippet's symbols against `node_modules/**/*.d.ts`,
  `pubspec.lock`, or the Xcode SDK. When a symbol is missing the finding says "requires
  upgrade to X". If you add advice in chat, hold yourself to the same bar.

## Workflow

Scripts live in `scripts/` next to this file. Run them with `python3`; `audit.py` chains the
whole pipeline. `<SKILL>` below is this skill's directory.

### Step 0: config (first run only)

The project root is the directory with `package.json`, `pubspec.yaml`, or the `.xcodeproj`.
Its config lives in the workspace, not the project:
`python3 <SKILL>/scripts/preflight.py --project <root> --print-home` prints the home, and the
config is `<home>/config.json`. If it exists, use it and don't ask anything. If it's missing,
ask the user once, in one message (use the question UI if you have one), then write it there
from `<SKILL>/assets/config.template.json`:

- which screens: all routes, a path prefix (`scope.include`, e.g. `["/app"]`), or a list
  (`scope.routes`, full URLs with query allowed, e.g. `/home?state=active` to pick a state);
- the prototype URL template (`sources.prototypeUrl`, `{route}` is replaced by the route) and
  whether a dev server is running;
- a review-canvas manifest if there is one (`sources.canvasManifest`: JSON, or a TS/TSX board
  config whose frames are calls shaped `fn("id", "title", "/route")`);
- whether a native dev build + deep-link scheme exists (`native.ios.scheme`,
  `native.android.scheme`), which unlocks V captures.

Fill what you can infer from the repo first (router file, dev port, canvas config) and ask
only about the rest. Useful extras: `web.hideSelectors` for dev overlays that shouldn't count
as UI, `chrome` for shell files every screen renders inside, `tabRoutes` when the router
can't tell which screens are tabs, `brandExceptions` (`"RULE-ID@screen"` or `"RULE-ID@*"`)
for deliberate brand deviations, which then show as "accepted" instead of re-flagging.

The `prototype` block controls the before/after frames. Leave `enabled: true`. The After frames
use the platform's structure in the app's own look, read off the screen (its font, its bar
colour, its darkest filled button). Fill `prototype.skin` only with values the project's own
design tokens give you, when the derived ones would misrepresent the brand: any of `font`,
`surface` (bar background), `ink`, `muted`, `primary` and `onPrimary` (floating button, switch),
`indicator` (the pill behind the current Android tab). Look for them in the project's token or
theme file; never invent a colour.

Also fill the `report` block, which is what readers see instead of routes and slugs. Write it
yourself from the router, the review board, and the screens themselves; don't ask the user:

- `report.name`: a short name for the page title, 1 to 3 words (`"Redesign"` gives
  "Redesign iOS Audit").
- `report.appName`: the app as people call it, for the heading (`"Acme app redesign"`).
- `report.screens`: one entry per screen, in the order a person meets them (tabs first, in
  tab-bar order). `route` is the route key or path (`"/redesign/messages/:id"` or the path
  itself), `name` is what a person would call the screen (`"Get care"`, `"A message thread"`),
  and `state` is an optional short phrase for the state shown (`"Ready to join"`). Screens
  missing from the list fall back to a name taken from the route, which reads worse, so cover them all.
- `report.artifacts`: leave `{}`; Step 3 records the published links here.

### Step 1: run the pipeline

```bash
python3 <SKILL>/scripts/audit.py --project <app root>
# scope override from the request ("audit /settings and /profile"):
python3 <SKILL>/scripts/audit.py --project <app root> --routes /settings,/profile
```

It prints a 5-line run plan (stack, sources, screens, devices, catalog) and proceeds without
waiting. Then: inventory → capture (web via Playwright; iOS/Android via simctl/adb when
configured) → hierarchy → static detectors → evaluate → diff → annotate → before/after frames
(web prototypes only) → render. The last line is `RUN_DIR=...`.

The before/after step prints `capture_after: N/N before/after pairs`. It needs the prototype to
be reachable, the same as the web capture. A run with no web render (native captures or code
only) has no Prototype tab; say so in the summary instead of working around it.

If preflight reports the prototype unreachable, start the project's own dev server if its
command is documented (no installs), or ask the user; don't silently fall back to code-only
without saying so. If Playwright isn't resolvable from the project, say so and continue with
C evidence; installing it is the user's call.

### Step 2: judgments (the one place your eyes are needed)

Some rules can't be settled by a regex or a bounding box: is this search field the screen's
primary task, does this ellipsis open overflow, does this menu hide a primary action. Those
come out as **review candidates**. List them:

```bash
python3 <SKILL>/scripts/judge.py <RUN_DIR> --pending
```

For each, look at the evidence before deciding: open the screenshot
(`<RUN_DIR>/screenshots/<slug>__<platform>__light.png`), the element in
`<RUN_DIR>/elements/…json`, and the file:line in `candidates.json`. Then record one verdict:

```bash
python3 <SKILL>/scripts/judge.py <RUN_DIR> <findingId> fire   --current "One sentence on what exists today."
python3 <SKILL>/scripts/judge.py <RUN_DIR> <findingId> pass   --note "why it's fine"
python3 <SKILL>/scripts/judge.py <RUN_DIR> <findingId> manual --note "what a human should check"
```

- `fire` only when the rule's condition is visibly true in the evidence. `--current` is one
  plain sentence describing what exists, not what should change (the catalog supplies that).
  It is printed on the page as "On this screen", so write it for a tenth-grade reader: name
  things the way a person sees them ("the round “…” button on the visit card"), no file paths,
  component names, or jargon like FAB, CTA or in-content. Example: *The home page starts with a
  wide “Ask Lifey or search” box inside the page.*
- `pass` when the evidence shows the rule doesn't apply. Add `--absent` when the flagged thing
  is not on the screen at all (the code is imported but never rendered in this state); the page
  then leaves that screen's menu row out instead of calling it a match.
- `manual` when you can't tell from what you have. Uncertainty belongs here; a guessed
  finding costs more trust than a gap does.

Judgments are cached in `<home>/judgments.json`, keyed by finding ID and pinned to the
evidence hash, so later runs on unchanged code reuse them and stay deterministic. When
the evidence changes, the judgment expires and the candidate comes back as pending.

Something worth flagging that matches no rule? Record it as an observation, never a finding:

```bash
python3 <SKILL>/scripts/judge.py <RUN_DIR> --observe <slug> <ios|android|both> <top-bar|bottom-bar|content|overlay> "what you saw"
```

Then re-render:

```bash
python3 <SKILL>/scripts/audit.py --run-dir <RUN_DIR> --from evaluate
```

A verdict changes which problems a screen lists, so this also retakes the before/after frames
of the screens whose list changed (the rest are reused). Keep the prototype's dev server
running until the last re-render.

Before publishing, open two or three After frames (`<RUN_DIR>/proto/<slug>__<platform>__after.webp`),
at least one tab screen and one pushed screen. You are checking that the patch landed cleanly:
bars in place, nothing overlapping, no content lost. If a frame is broken, don't fix the image.
Record what you saw with `judge.py --observe`, tell the user which screen, and if it is
widespread set `prototype.enabled` to `false` in the config and re-render so the page ships
without the tab rather than with a misleading picture.

Skip step 2 when there are many screens and the user wants a quick pass; pending candidates
stay honestly listed on their screens as "Check by hand".

### Step 3: publish, summarize, stop

The render step writes `report-ios.html` and `report-android.html` into the run folder. Publish
the page for each platform the user asked about (both when they didn't say) with the Artifact
tool, exactly as rendered:

- First time for this project and platform: publish `<RUN_DIR>/report-<platform>.html` with
  `icon: "phone"` and a one-sentence `description` (e.g. "A plain-language iOS 27 check of the
  Acme app redesign: 18 screens, each problem with why it matters and how to fix it."). Then
  save the returned link in `<home>/config.json` under `report.artifacts.<platform>`.
- A link is already saved: read that artifact first (`action: "read"` with its `url`), then
  publish the new page with the same `url`, so the team keeps one link that always shows the
  latest run.
- If the tool refuses the file's location, copy the page into your scratchpad directory and
  publish the copy. Never edit the page before publishing.

Then reply in at most 8 lines: finding counts by platform × severity, the top 3 findings (rule
ID, screen, one clause), how many items need a check by hand, the Artifact link(s), and the rule
IDs a separate implementation pass could take (audit.py prints all of this). When the page has
a Prototype tab, say in one clause that it shows each screen before and after as a mock-up, not
a native build. Then stop: no edits, no offer to "quickly fix" things inside this run.

## Outputs

```
~/.claude/skills/deviceroy-workspace/projects/<dirname>-<hash>/     the project's home
  config.json       written once on first run
  judgments.json    cached judgments + observations (shared across runs)
  runs/<YYYY-MM-DD>_<shortSha>/
    report-ios.html     the iPhone page: plain language, by screen, collapsible, light + dark
    report-android.html the Android page, same design
    findings.json     source of truth; the HTML is rendered from it (no timestamps)
    candidates.json   every rule hit incl. review candidates + evidence hashes
    screenshots/      raw PNGs (inlined into the pages) + *.annotated.svg
    proto/            before/after frames for the Prototype tab (web prototypes only):
                      plan.json (problems listed per screen), shots.json (which fixes applied, and where),
                      <slug>__<platform>__before.webp / __after.webp (inlined into the pages)
    elements/ raw/    normalized + raw element frames
    static.json       detector tags per screen (file:line)
    diff.json         new / resolved / unchanged vs the previous run
    run.json          config snapshot, tool + SDK versions, catalog version, start time
```

The home name is the project folder's name plus a short hash of its absolute path, so two
checkouts with the same folder name never share state. `DEVICEROY_HOME` overrides the workspace
location.

Finding IDs are `RULE__screen__hash4(testID || label || zone)`, stable across runs. Code
findings that come from shared chrome (a tab bar every screen renders) are reported once,
with the other screens listed under "Also on".

## References (read only what the run needs)

- `references/plain-copy.json`: every reader-facing word on the report pages: per rule a title, why it matters, how to fix, a "passed" line and (for judged rules) a check-by-hand question; plus plain names for the menu intents. For the Prototype tab: per rule an `after` line (what the After frame shows) and a `hidden` line (why it has none on a screen), and the `prototype` block with the tab's own labels. Edit here to change wording.
- `references/rules.json`: the catalog (46 rules, severities, evidence, sources) and the menu matrix. Machine-read; open it to explain a rule.
- `references/ios-27.md`, `references/android-17-m3e.md`: platform baselines with sources. Read when writing a `--current` sentence or explaining a finding.
- `references/menu-treatments.md`: how elements are classified by intent.
- Stack notes, load only the detected one: `references/stack-rn-expo.md`, `stack-flutter.md`, `stack-native.md`, `stack-web.md` (web prototypes of apps).

## Changing the catalog

Rules are additive and versioned. A new rule takes the next number in its group, gets an
evaluator in `scripts/evaluate.py` (and a detector in `detect_static.py` if it needs a new
code signal), and bumps `catalogVersion`. It also needs its plain-language entry in
`references/plain-copy.json`; if its finding sentence needs rewording for readers, add a case to
`Page.detail()` in `render_report.py`. If the fix can be shown on a web render, give the rule a
patch in `scripts/capture_after.mjs`: add its ID to `PATCHED` for the platform, find its target
from the finding's element frame or from roles and geometry (never from one app's class names),
and add its `after` line to the copy file. Retired rules keep their ID with
`"status": "retired"` so old reports stay readable. Re-verify the baselines each June (WWDC)
and at each Android stable release; API names shift during betas.
