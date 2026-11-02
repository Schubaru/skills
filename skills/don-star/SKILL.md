---
name: don-star
description: >
  Visual design-review workflow for any Vite + React web app: a canvas board of
  live screens, a single-page walkthrough, pinned comments with @mentions and
  read state, documentation events, a projects folder with per-project access,
  presence and cursor chat, a preview cache, dev-mode inspector, flow-chart
  canvas, and an agent loop that turns comments into merged code. Set up the
  board for a project in one deterministic run, or process the comments a
  reviewer left on one. Invoked explicitly with /don-star; it does not auto-trigger.
disable-model-invocation: true
---

# Don-Star (review canvas)

A review board that lives inside the app it reviews. Every frame is the real
coded page — same origin, interactive, responsive, seeded into mid-flow states —
so the board can never go stale, and every comment a reviewer pins is a work
item an agent can pick up from a file or a database and answer in the thread.

**One install, every feature, every time.** `scripts/install.sh` copies the
whole harness (about 120 files), fills in the project's names, wires the app,
generates a first board from the router, installs dependencies, and runs a
check that fails if any wiring step is missing. Nothing in the setup is done by
hand or from memory; when the check prints "fully installed", the board is the
same board every other project has.

What the reviewer gets (the full inventory is `references/features.md`):

- **Canvas**: pan/zoom lanes of live screens, one lane per user journey; mobile
  and desktop; sections; drag lanes; **Single page**: the selected screen at
  reading size, fully interactive — walking the real flow inside the frame moves
  the sidebar, header and URL with you; **Flow**: the page as an authored
  branching chart.
- **Pinned comments** with replies, image paste, resolve, delete, copy-link,
  @mentions from a people directory, per-person unread state. **Events**:
  reviewer-authored cards under a frame documenting what the system does there
  (the email that sends, the webhook that fires).
- **Agents comment like people**: a skill replies in the thread under its own
  name (`/norm-dog`) with a provenance byline (command, files, how it was checked).
- **Board URLs** for every position (`?page=`, `view=slides&screen=`, one-shot
  `?thread=`), **Download screens** (fresh 2× PNGs, a ZIP per page), a
  **three-tier preview cache** (per-browser → a prebuilt bucket filled by CI →
  live boot) invalidated per route by content hash.
- **Projects folder** with live thumbnails, folders and an Archive; an
  **admin console** for who may sign in and who may open what; a **Share** pill
  on every board; a request-access door for anyone locked out.
- **Presence**: who's here, live cursors, follow, cursor chat, reactions.
- **Sign-in** by email + code (Supabase Auth) — in-app locally, an edge
  middleware on Vercel that serves nothing without its cookie. **Email
  notifications** for replies, new comments and mentions.
- **Dev mode** (`</>` or **D**): an inspector for developers rebuilding the
  screens — component stack, props, tokens, compiled CSS, downloadable assets,
  measurement rulers, `page.html` / `bundle.zip` exports.
- **/flows**: a flow-chart canvas per project, edited by the reviewers,
  rev-guarded saves, undo, fork.
- **CI**: prebuilt preview shots on every push; before/after sheets for any
  change; a triage loop that fixes comments on a schedule and replies at merge.
- **Everything works with no backend.** Unset the two Supabase vars and the board
  is a local tool: comments in localStorage and a committed `review-board.json`,
  which is also the agent's inbox.

Screens come in three kinds. **`url` — live frames. The default, and for a
runnable app the ONLY thing to board.** `image` — for things that genuinely ARE
pictures (design exports, a competitor's app, a site you can't run). `element` —
a live React node.

**Do not screenshot a runnable app to put it on the board.** A capture is a
fixed-width picture of a responsive design, right at one width and one moment;
the board then shows a stale desktop layout inside a phone frame and someone
signs off on it. If the app runs, point frames at routes.

## Which mode does this invocation want?

1. **Set up the board for a project** → below.
2. **Process / resolve the comments on a board** → `references/resolve-loop.md`.
3. **Add screens, flows or a second project** → "The config" below.
4. **Make the board shared and gated** → `references/supabase-setup.md`.
5. **Turn on CI shots, before/after sheets or scheduled triage** → `references/ci-and-triage.md`.
6. **Change the harness itself** → "Editing the harness" below, then `references/architecture.md`.

## Setting up a project

### 1. Install

The app must be a Vite + React app with a `src/main.tsx`. If it doesn't use
react-router yet, that's fine: on an untouched Vite template the installer
writes a minimal routed `App.tsx`; on any other app it mounts the board's
routes inside the existing `<Routes>` tree and tells you if it couldn't.

```bash
bash "$SKILL_DIR/scripts/install.sh" <app-dir> --slug <slug> --name "<Project name>"
```

Every flag is optional and derived from the app when omitted (`--slug` from the
package name, `--admin-domain` and `--inbox` from the git email, `--brand-name`
from the name); pass them when the defaults would be wrong — the slug is
permanent and the admin domain decides who administers a shared board. Run
`install.sh --help` for the full list. `--force` re-copies the harness over an
existing install without touching project state (config, registry, brand, board
files).

What it does, in order — and why each step is required, so you can recognise
a broken one:

1. Copies `src/review/`, `src/auth/`, `src/dev/`, `src/flows/`, the two app-side
   modules (`review-seed.ts`, `review-capture.ts`), the route fragment and the
   three page mounts, `middleware.ts`, `DEV.md`, `supabase/`, `scripts/`, the two
   workflows (at the repo root), and an empty board file and triage ledger.
2. Fills every `__DS_*__` placeholder in the copied files (slug, name, admin
   domain, inbox, brand, site URL, sender, app directory). It refuses to finish
   with one unfilled.
3. `wire.mjs` patches the app: **`main.tsx`** gets `applySeedFromUrl()`,
   `installReviewCapture()`, `installDevMode()` as the FIRST thing that runs
   (ES imports hoist; a seed applied after a page module read storage is a seed
   that never landed, and every seeded frame then shows whichever sibling booted
   last) · **the router** mounts `{reviewRoutes}` · **`vite.config.ts`** gets the
   two plugins (dev autosave of the board file; `/screen-versions.json`, without
   which the preview cache runs off), the board-file watch ignore (without it
   every autosave reloads the page and kills live frames mid-review),
   `keepNames` (dev mode names components off React's fiber) and the `@` alias ·
   **tsconfig** gets `@/*` · **`review.config.tsx`** is generated from the
   router's static routes · `.gitignore` and `.env.example` are extended.
4. `npm install` (skip with `--no-install`).
5. `check.mjs` prints one line per wiring point with the failure mode next to
   any ✗, and exits non-zero. Fix every ✗ before going further; run it again any
   time with `node "$SKILL_DIR/scripts/check.mjs" <app-dir> --build --test`.

Then `npm run dev` and open `/review`. The board opens on the generated
config, every route a live frame.

### 2. Decide what to board

**Coverage: every page and every step, not just the screen the user named.**
The generated config lists the router's static routes, one flow per top-level
path; that is a starting point, not the board. Walk the product: a multi-step
flow (intake, checkout, wizard) is one screen per step, and a route that takes
its state from the URL is one screen per state worth reviewing.

**Group flows by user journey, never by viewport.** A flow = one journey
("Onboarding", "Checkout") in walk-through order. Never "Desktop" and "Mobile"
flows — that splits one journey into two lanes and doubles every comment. The
device switcher already renders the real responsive design both ways. Variants
of one screen (A/B, themes) are sequential screens inside one flow.

**Frames are viewport-proportioned, never page-shaped.** A frame simulates the
user's viewport (960×600 desktop default, 390×844 phone); a tall page scrolls
inside it.

### 3. The config

`src/review/review.config.tsx` — pages → flows → screens, one entry per screen
pointing at the app's own route. Write helpers (`url(id, title, route)`,
`step(flow, i, title)`), not sixty hand-pasted entries.

```tsx
url("landing", "Landing", "/")
url("checkout-03-shipping", "Shipping", "/checkout?step=ship")
```

**Ids are the join key for comments.** Unique across the project, never
recycled: pointing an existing id at a different screen silently moves every
comment on it. Same screen re-boarded = same id; genuinely new screen = new id.
If a step order changes, renumber ids AND migrate the anchors in the board file
in one commit; otherwise append suffixed ids and never renumber.

**The slug is pinned** in the config and in `src/review/projects.ts` (the
registry). Every comment, status, grant and cache entry keys off it; renaming
forks the board's data. `check.mjs` fails when the two disagree.

**A second board**: copy the config module, pin a NEW slug, add a registry
entry, and (on a shared board) grant it in `/projects/access`. Its file is
`review-board-<slug>.json`. **A flow-chart project**: a registry entry with
`kind: "flows"` and a grant — no config, the diagrams live in the database.

**Screens that are pictures**: put images in `public/screens/` named
`<flow>-<NN>-<name>.png` and run
`python3 "$SKILL_DIR/scripts/generate_config.py" <app-dir> --slug <slug> --name "…"`.
It derives flows from the prefixes and frame sizes from each image's aspect.
`image` and `url` screens mix freely on one board.

### 4. Seed mid-flow screens (the two-sided contract)

A screen the app only reaches after real input boots there by pre-writing the
app's own persistence. Find the key and shape by grepping the app for
`sessionStorage` / `localStorage`, then:

```tsx
{ id: "intake-09", title: "Allergies", source: {
    kind: "url", src: "/intake",
    seed: { session: { "myapp-intake-v1": JSON.stringify({ answers, index: 8 }) } },
} }   // a null value removes a key — that's how you board a "fresh start" screen
```

The seed rides in the frame's own URL and is applied inside the frame by the
app — every frame is an iframe on one origin sharing one storage, so a board
that wrote storage before mounting each frame would let the last frame to boot
win for all of them. The app's side of the contract is two things, and the
installer did the first:

1. `applySeedFromUrl()` first in `main.tsx` (done).
2. **Wherever the app READS a seeded key, read through the seed module** —
   `readSession(KEY)` / `readLocal(KEY)` instead of `sessionStorage.getItem`,
   and `writeSession` / `writeLocal` where it persists. This is not
   belt-and-braces: the seed lands during module evaluation, the app reads
   during its first render, sibling frames boot in that gap. With only step 1,
   every seeded frame still shows the same screen. Verify by loading the board
   and confirming sibling frames of one flow show *different* screens.

Live-frame behaviour worth knowing: canvas frames are pointer-inert (pan stays
fluid) and paint a cached bitmap below 55% zoom — **Go live** in the frame
header boots one; the single-page stage is always live and interactive; pins
anchor to content coordinates (scroll included); the board and the app share the
origin's storage (`rv:*` keys beside the app's — fine, just don't be surprised).

### 5. Previews

Each frame photographs itself once into IndexedDB, stamped with a content hash
of the route that rendered it, so a board load boots only screens whose code
moved. In dev, saving a component re-captures exactly its frames with the board
open. When a screen changes through something the hash can't see (an API
fixture, a date, a feature flag), tell the reviewer: **⋯ → Refresh previews** is
the fix, but only if they know to use it. On a shared board, CI fills a bucket
of shots once per push so nobody's browser pays the boot sweep
(`references/ci-and-triage.md`).

### 6. Hand off

Tell the user: **C** (or the comment tool) to comment, click a spot, type,
Enter. Single page + arrow keys for a screen-by-screen pass; the screen on the
stage is the real page. Everything autosaves to the board file ("Saved to board
file" in the header). Commit that file to share a local board; on a shared board
comments are live across browsers and the file is the seed.

### 7. Close the loop

When the board has comments to process, follow `references/resolve-loop.md`:
`board.py list` shows the open threads; do the work; `board.py reply <id>
--body "what changed" --resolve` as the skill that did it. The script keeps the
file's invariants — never deletes a thread, never touches existing ids or
timestamps. On a shared board the same reply reaches the database at next boot;
for a scheduled routine, the triage loop in `ci-and-triage.md`.

## Going shared

```
VITE_SUPABASE_URL=… VITE_SUPABASE_ANON_KEY=…
```

Set those two and the same install becomes multi-reviewer and gated: one live
thread list, email + code sign-in with a server-side allowlist, per-project
grants, folders, sharing, presence, notifications. The schema, functions and
seed rows are already in the app's `supabase/` with the project's slug and
admin domain filled in; the order of operations is `references/supabase-setup.md`.
The Vercel middleware needs `GATE_SECRET` too. Until then, nothing about the
local board is different.

## Editing the harness

`assets/` is the source of truth; every project-specific string in it is a
`__DS_*__` placeholder that `install.sh` fills. If you improve the harness
inside one project, port the change back into `assets/` with the project's
names put back as placeholders, then re-install into a scratch app and run
`check.mjs --build --test`. Keep it
dependency-light and keep all styling in `review.css` behind the `--rv-*`
tokens per `references/design-system.md`.

Read `references/architecture.md` §"Layout traps" before touching frame
geometry, board chrome, zoom or the capture path. The short list, each of
which has cost a session: a transform doesn't shrink the layout box; chrome
belongs in the toolbar dock, not positioned against the canvas; zoom anchors
off the rendered world box, never off transform state; a throttled iframe
never runs rAF; password managers escape a reviewed app's mock fields into the
canvas; and nothing in `src/dev/` may touch the ambient document or use DOM
`instanceof`.

## Reference docs

- `references/features.md` — every feature, by subsystem, with the file, key, param or table.
- `references/architecture.md` — data model, file map, live frames, the preview cache, layout traps.
- `references/supabase-setup.md` — the shared board: SQL order, dashboard hooks, env, functions.
- `references/ci-and-triage.md` — prebuilt shots, before/after sheets, the scheduled triage loop.
- `references/resolve-loop.md` — processing comments as an agent.
- `references/design-system.md` — the board's visual system; `review.css` must keep matching it.
