# Architecture

How the harness is put together. Read this before changing it, and before
debugging anything about frames, seeding, the preview cache or sync. For what
the board *does*, see `features.md`; for the shared-mode setup, `supabase-setup.md`.

## Data model

```
ReviewProject            what's being reviewed (code: src/review/<x>.config.tsx)
├─ slug                  PINNED storage namespace — every comment, status, grant
│                        and cache entry keys off it; a rename forks the data
├─ viewports?            live viewport override (default desktop 1440×900, mobile 390×844)
└─ Page[]                board pages (most projects use one)
   ├─ branchLanes?       authored branches for the Flow view (edges with labels)
   └─ Flow[]             one user journey = one horizontal lane
      ├─ section?        consecutive flows sharing one render under one band
      └─ Screen[]        id (globally unique), title, w/h?, device?, source

ScreenSource             what a screen shows
├─ { kind: "url", src, seed? }     the real coded page — the default
├─ { kind: "image", src }          things that ARE pictures
└─ { kind: "element", render() }   a live React node

ProjectEntry             the registry (src/review/projects.ts): slug, name, blurb,
                         kind "board" | "flows", load() for boards, archived? (offline fallback)

ReviewSnapshot           the committed state (review-board[-<slug>].json)
├─ comments: CommentThread[]     pins + threads; resolve is a flag, not a delete
│    anchor: screen(screenId,dx,dy) | world(x,y,pageId)
│    author: "Jane" | "/norm-dog"  a leading "/" IS the agent marker (isAgent)
│    meta?: { command, files[], verified }   provenance byline (agents)
│    meta.docKind?: email|push|sms|webhook|api|note → an EVENT (isDocNote)
│    mentions?: string[]          verified emails (stripped from the file)
└─ reviews: { screens{}, flows{} }   triage verdicts (hidden in the UI by default)
```

Invariants:

- **Screen ids are the join key** between config and data. Same id = comments
  carry over; changed meaning = orphaned or wrong comments.
- **Screen-anchored pins store offsets from the screen's top-left at its natural
  size** (scroll included), so they travel when a lane moves and project into
  slides unchanged.
- **The committed file merges per thread, not per id.** The browser's copy owns
  pin position and resolved state; the file owns authored text and contributes
  replies the browser hasn't seen. Merging whole threads by id silently hides a
  reply added to an already-cached thread, which breaks the async loop.
- **Identity is a string convention.** An author beginning with `/` is an agent:
  no schema branch, no migration, old boards keep parsing.
- **An event is a thread with `meta.docKind`.** Same storage, sync and merge;
  only rendering and filtering differ.
- **The file never carries an email.** `buildSnapshot` strips `authorEmail`,
  `authorId`, `mentions`, reply emails and status `byEmail` before anything
  reaches git; the triage function strips them again before a routine sees them.

## File map

`src/review/` (the harness):

| File | Owns |
| --- | --- |
| `model.ts` | Types, snapshot build/parse, status rollup, event kinds, `SHOW_REVIEW_STATUS` |
| `store.ts` | State hooks (comments, reviews, layout, reads, reviewer name); localStorage `rv:<slug>:*`; the remote sync when configured |
| `db.ts` | Every Supabase read/write/realtime call for threads, statuses, events, prefs, people |
| `io.ts` | The dev snapshot endpoint + `snapshotFilename(slug)` |
| `projects.ts` | The registry, `resolveRequest`, `hrefFor`, folder grouping |
| `access.ts` / `access-rules.ts` / `use-access.ts` | Grants: the queries, the pure rules (tested), the hook |
| `people-directory.ts` / `person.tsx` | The @ directory and avatars |
| `presence*.ts(x)` | Multiplayer presence, cursors, chat, reactions |
| `share-panel.tsx` / `share-suggest.ts` | Sharing UI and directory suggestions |
| `request-access.tsx` | The "ask for access" door |
| `admin/` | `/projects/access` — users, projects, folders, requests |
| `folder.tsx` / `project-thumb.tsx` | `/projects` and its live thumbnails |
| `layout.ts` / `nav.ts` | Board geometry; board URLs + walk-following route match |
| `frame.tsx` | The screen node: live iframe / cached bitmap / image / element |
| `comments-ui.tsx` / `events-ui.tsx` / `sidebar.tsx` / `slides.tsx` / `flow-view.tsx` / `flow-graph.ts` | The surfaces |
| `app.tsx` | Root: pan/zoom, hit-testing, selection, toolbar, menus, autosave, location sync |
| `snapshot-cache.ts` / `snapshot-store.ts` / `shot-store.ts` / `shot-name.ts` / `screen-versions.ts` | The three-tier preview cache |
| `export-png.ts` / `zip.ts` | Download screens |
| `theme.ts` / `theme-menu.tsx` | Auto / Light / Dark |
| `brand.ts` / `logo.svg` | The mark in the header (install fills it) |
| `review.css` (+ `request-access.css`, `share-panel.css`, `admin/admin.css`) | Every style, behind `--rv-*` tokens |
| `vite-plugin-review-snapshot.ts` / `vite-plugin-screen-versions.ts` | Dev endpoints |
| `index.ts` | Public exports |

Outside it: `src/review-seed.ts` (the seed contract, lives in the app because the
app reads it), `src/review-capture.ts` (the frame's self-capture service),
`src/review-routes.tsx`, `src/pages/{Review,Projects,Flows}.tsx` (the mounts),
`src/auth/` (the gate), `src/dev/` (the inspector), `src/flows/` (the diagram
canvas), `middleware.ts` (the edge gate), `supabase/` (schema + functions),
`scripts/` (shots, sheets, triage reply, tests), `.github/workflows/`.

## Live frames — the constraints that shaped them

- **Same origin, always.** The board is a route in the app it reviews, so frames
  are the same server. That is what unlocks seeding, scroll APIs,
  `contentDocument`, walk-following and the capture protocol.
- **Seeding rides in the frame's own URL.** `seededSrc` builds
  `<route>#rv-seed=<json>`; the app calls `applySeedFromUrl()` at boot and reads
  through `readSession` / `readLocal` where it hydrates, writes through
  `writeSession` / `writeLocal` where it persists. The read half is not optional:
  the seed lands during module evaluation, the app reads during first render,
  sibling frames boot in that gap — with only the boot call every seeded frame
  shows whichever neighbour booted last. The write half keeps a reviewer's own
  walk inside a seeded frame consistent (an answer written in the frame must be
  read back by its next screen, while siblings still can't leak in).
- **Viewport simulation.** A frame is ~960 CSS px wide, which most apps read as
  tablet. So the iframe is laid out at the live viewport and CSS-scaled into the
  frame; the device switcher swaps the viewport and the app's real responsive
  layout renders both times.
- **Walk-following.** The stage frame's history methods are hooked; the board
  matches the new URL to a screen (`nav.ts`) by route and a subset of its
  params, preferring the current page and the most specific match, and gives up
  (keeps the current selection) when ambiguous. A user pick bumps a remount
  ticket; a walk never does.
- **Materialize sequencing.** Readiness = native `load` listener + a readyState
  poll; then double-rAF → skeleton fades, LIVE badge appears. Everything
  animation-adjacent is gated on `document.visibilityState` so hidden pages
  (background tabs, agent-driven browsers) swap instantly instead of hanging.
- **Snapshot freshness without reload loops.** The vite plugin serves GET on the
  snapshot endpoint and the mount fetches the seed at boot; the dev server
  `watch.ignored`s the board files. Watching them full-reloads on every autosave;
  ignoring alone serves a stale module cache. Keep both halves.

## The preview cache

Booting every visible frame live is right for a small board and wrong the moment
a pan sweeps ten screens into view. Three tiers, and the invalidation that makes
caching honest:

1. **IndexedDB**, per browser. Each frame photographs itself once (`html-to-image`
   inside the app's own document, where fonts and images are resolved), WebP at 1.5×.
2. **A public bucket** of shots built once per push in CI. Content-addressed names
   → served immutable → the browser's HTTP cache is a free tier behind it.
3. **Live boot** through a bounded queue (12), exports jumping it.

Every entry is stamped with a **content hash of the route that rendered it**: the
transitive import closure of the component each `<Route>` renders, derived from
the router file — never hand-maintained. A build id would say "everything
changed" on every deploy. In dev the manifest is polled, so saving a component
re-captures exactly its frames with the board open. Guards: entries expire at
7 days; ⋯ → Refresh previews; any frame the reviewer works in is live. No
manifest → the cache runs OFF.

Exports never come from the cache: lossless PNG at 2×, shot fresh.

## Shared mode

With the two `VITE_SUPABASE_*` vars unset every call site sees null and the board
is the local tool. Set, threads / statuses / events / reads / people / presence
live in Postgres and arrive over realtime; the gate (`src/auth/` locally,
`middleware.ts` on Vercel) is the same email + code flow; RLS enforces the
allowlist and the per-project grants server-side (`can_access_project`). The
committed JSON stays the seed and the agent's inbox: the client upserts the
merged committed delta, so the database is a superset, not a fork.

## Layout traps

A board is transformed boxes containing iframes, and CSS layout does not agree
with what you see. Each of these cost a session; the moral is **measure the
rendered box, and give chrome a containing block that can't move**.

- **A transform doesn't shrink the layout box.** The scaled iframe keeps its
  unscaled height, so a scrolling ancestor offers a scrollbar into blank space.
  `.rv-frame-live` is `overflow: clip` (not `hidden`, which is still
  programmatically scrollable and drifts content-anchored pins).
- **Board chrome belongs in the toolbar dock**, never positioned against the
  canvas: the canvas remounts and can measure zero-width, which puts a centered
  pill at `-width/2`.
- **Zoom anchors off the rendered world box** (`getBoundingClientRect`), never
  off transform state — Safari fires `gesturestart`/`gesturechange` AND
  ctrl+wheel for one pinch, and state-derived anchors drift the instant the two
  disagree. Zoom belongs to the canvas: ⌘+/⌘−/⌘0 ahead of the typing guard,
  pinch on the canvas's own wheel listener, touch pinch via a board-scoped
  viewport lock — never in `index.html`.
- **A throttled iframe never runs rAF**, so `html-to-image` hangs in exactly the
  frames worth capturing; a cloned DOM restarts entrance animations at t=0.
  `review-capture.ts` shims rAF and freezes animation for the capture.
- **Password managers escape into the canvas.** Mock `type="password"` fields in
  the app attract them; their popups land in board space. `data-1p-ignore` /
  `autoComplete="off"` on fake credential inputs.
- **Nothing in `src/dev/` touches the ambient document, and nothing uses DOM
  `instanceof`.** From the board the inspected page is another realm with its
  own constructors; `isInstance(v, "CSSFontFaceRule", doc)` or `nodeType`.

## Extension points

- **Brand:** `brand.ts` is the one place the board says whose it is.
- **A second board:** copy `review.config.tsx`, pin a new slug, add a registry
  entry, grant it. A `flows` project needs only the registry entry and a grant.
- **DOM-element anchors** (`{ kind: "screen", screenId, selector }`) would let
  pins stick to elements; coordinates remain the robust default.
- **Merge-safe statuses:** `reviews` are last-writer-wins offline; online the
  database row is the truth.
