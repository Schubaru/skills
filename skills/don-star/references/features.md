# What the board does (feature inventory)

Everything install.sh puts in an app, by subsystem, with the file that owns it
and the storage key / URL param / table it uses. Read this when a reviewer asks
"can the board do X?", when explaining the board to a team, or before touching
a subsystem. Keys are `rv:<slug>:…` in localStorage unless noted.

## 1. Canvas
- A pan/zoom board; each page lays its flows out as horizontal lanes of screens
  (`layout.ts`, prefix sums so mixed sizes line up). Root: `ReviewApp` in `app.tsx`.
- **Every `url` screen is the real route** in a same-origin iframe, laid out at
  a live viewport (desktop 1440×900, mobile 390×844 — `LIVE_VIEWPORTS`,
  overridable via `project.viewports`) and scaled into the frame (`frame.tsx`).
- Device switcher in the toolbar: mobile (default) / desktop; `device:"phone"` on a
  screen keeps it a phone frame in desktop mode. Key `device`.
- Seeded mid-flow states ride in the frame's own URL hash (`#rv-seed=…`) and are
  applied inside the frame before first render (`review-seed.ts`).
- Consecutive flows sharing `Flow.section` render under one band.
- Click a flow header to select the lane; hold and drag to move it (`layout` key).
  Click a screen to ring it; double-click opens it in Single page.
- Below `LIVE_SCALE = 0.55` a frame paints its cached bitmap; **Go live** in the
  frame header boots it. A "Live" badge marks real pages; a skeleton shows while
  booting; an "app unreachable" probe runs once per session.
- Per-page camera (`viewports`, debounced), last page (`page`), last mode (`mode`).
- Background warmer captures every url screen on every page; off-page screens wait.
- Right-click menu: Chat, reactions, Inspect (dev mode on that element), Open in
  single page, Copy link to this screen, Open live page, Zoom to fit.
- Toolbar hints self-dismiss (6 s); a `once` hint is remembered per tab.

## 2. Single page (slides)
- One screen at reading size, the stage frame fully interactive (`slides.tsx`).
- Prev/next, ← → ↑ ↓ and J/K step through the page; slide changes use a View
  Transition (skipped under reduced motion or on hidden tabs).
- Zoom relative to fit (0.25–4); ⌘-wheel and Safari pinch zoom, plain wheel scrolls
  the page inside the frame, ctrl-wheel inside the frame is forwarded out.
- **Walk-following:** `frame.tsx` hooks `pushState`/`replaceState`/`popstate` inside
  the stage frame and `nav.ts` maps the new URL back to a screen (subset param
  match, current page preferred, most-specific wins, null when ambiguous). Sidebar,
  header and URL follow a real click-through without remounting the frame.
- Pins anchor in content coordinates (scroll included); an off-screen pin parks at
  the edge and selecting its thread scrolls it back.
- Download exports the stage's booted iframe as-is — the state you walked into.

## 3. Flow view (third modality)
- The page drawn as authored branch lanes with labelled arrows; read-only
  (`flow-view.tsx`, `flow-graph.ts`). Appears only when `page.branchLanes` exists.
- Layered layout per lane; unauthored flows fall back to chains; "Not placed yet"
  lists missing screens; bad edges and cycles are reported, never blocking.
- Node badges: open-thread count + unread flag; click jumps to the newest thread.
  Camera key `flowview:<pageId>:<device>`.

## 4. Comments and threads
- `CommentThread { id, anchor, author, body, at, resolved, replies[], image?, meta?,
  authorEmail?, authorId?, mentions? }`; anchor is `screen(screenId,dx,dy)` (travels
  with the lane) or `world(x,y,pageId)` (`model.ts`).
- **C** toggles comment mode; a capture layer takes clicks; a click drops a pin.
  Pins are teardrops; drag past 4 px moves one; agent pins are tinted; a read pin
  recedes (`comments-ui.tsx`).
- Offline, the first comment asks for a name once (`reviewer` key); signed in,
  the gate already required a display name. Enter sends, Shift+Enter newlines.
- Thread popover: draggable, replies, per-reply delete, resolve/reopen (resolve is an
  archive flag, never a delete), delete thread (confirmed; remembered for the
  session so realtime can't resurrect it), copy link.
- Attachments: pick or paste an image; downscaled to 1600 px, inline data URL.
- **Agents comment like people:** an author starting with `/` is an agent
  (`isAgent`); `meta {command, files, verified}` renders as a provenance byline.
  Agents never receive email and never appear in presence or share suggestions.
- **@mentions:** `@` opens a picker over the people directory (minus yourself, six
  rows, ↑↓ Enter/Tab Esc). The body keeps plain `@Name`; verified emails go in
  `mentions[]`, and only those notify.
- **Copy link** → `?page=<id>&thread=<id>`. `?thread=` is one-shot: forces canvas,
  reveals the thread even if resolved, opens it, pans to it, then drops the param.
- **Per-person read state:** unread = last activity newer than your `seen` and the
  newest actor isn't you. Offline key `reads:<email|local>`; online table
  `review_thread_reads`. Opening a thread marks it read; unread dots show in the
  sidebar, on pins and on Flow badges.
- Sync (`store.ts`, `db.ts`): online → `review_threads` + realtime channel
  `review_threads:<slug>`, mirrored to `comments`; committed agent replies in the
  JSON are delta-merged up. Offline → localStorage seeded from the board file.
- The committed snapshot (`buildSnapshot`) strips every email. Dev autosave POSTs to
  `/__dev/review-snapshot?project=<slug>` (700 ms debounce; off when remote).
- Audit log: `review_events` (append-only) — distinct from the events layer below.

## 5. Events layer (documentation events)
- An event is a thread with `meta.docKind` set: `email|push|sms|webhook|api|note`
  (`events-ui.tsx`). Colour groups: comms yellow, hooks orange, notes blue.
- Renders as cards directly under each frame (canvas) or under the stage (slides);
  never as pins, never in the Comments tab. "+ Add event" under a screen opens the
  composer (⌘/Ctrl+Enter submits).
- Resolving archives an event off the canvas. Toggle: sidebar ⋯ → Show/Hide events
  (`showDocs`). Events ride every thread path (sync, snapshot, notifications) but
  triage never acts on them.

## 6. Triage statuses
- `good | needs` per screen (legacy `broken` coerces to `needs`), rolled up to the
  flow by `worstStatus`; entries carry who/when (`model.ts`). Table
  `review_statuses`, realtime `review_statuses:<slug>`, offline key `reviews`.
- **Hidden by default:** `SHOW_REVIEW_STATUS = false` (`model.ts`) hides the pills,
  dots and borders; `SHOW_STATUS_FILTER = false` (`app.tsx`) hides the filter. The
  data and components are kept; flip the constants to bring them back.

## 7. Sidebar
- Header segment switches modality: Canvas | Single page | Flow (when lanes exist).
- The list follows the tool: pointer → **Pages** (screen feed with section
  headings; a click selects and flies the camera, or changes the slide), comment
  mode → **Comments** (every thread on the page, newest first, context line,
  unread dot; a click jumps across pages and modes).
- ⋯ menu: Hide/Show comment pins (`showComments`), Hide/Show resolved (session),
  Hide/Show events (`showDocs`). Collapses to a floating button (`sidebar`).

## 8. Board URLs
- `/review?project=<slug>` · `?page=<id>` · `?view=slides|flow` · `?screen=<id>` ·
  one-shot `?thread=<id>` (`nav.ts`). Page changes push history; the rest replace.
  A shared link wins over the stored position.
- Which board opens (`pages/Review.tsx`, `projects.ts` `resolveRequest`): `?project`
  wins; else a URL addressing a board (page/thread/view/screen) opens
  `DEFAULT_PROJECT_SLUG`; else the account's only project; else `/projects`. A slug
  that exists but isn't yours shows the request-access door; a `flows` project
  redirects to `/flows`.
- Header: brand mark (`brand.ts`), back arrow (canvas first, then the folder — only
  when there is more than one project), title, page switcher, counts.

## 9. Download screens
- Board ⋯ menu: "Download all N screens" (ZIP, one numbered folder per flow) on the
  canvas; "Download this screen" (PNG) in Single page. Progress and cancel live in
  the header. Every shot is fresh: offscreen boot, PNG at 2×, never from the
  preview cache (`export-png.ts`, `zip.ts` — a store-only ZIP writer, no dependency).

## 10. Previews cache — three tiers
1. **IndexedDB** `rv-snapshots` (`snapshot-store.ts`): meta read whole at boot,
   blobs per frame.
2. **A public bucket** of prebuilt shots (`shot-store.ts`): reads `index.json` once,
   then `<name>.webp` with `force-cache`, and writes hits into IndexedDB. Off unless
   `VITE_SHOTS_URL` is set. Filled by `scripts/build-shots.ts` in CI
   (`workflows/review-shots.yml`) — see ci-and-triage.md.
3. **Live boot + self-capture** (`snapshot-cache.ts`, `review-capture.ts`): the board
   posts `{type:'rv-capture'}` into the frame; the app answers with a WebP at 1.5×,
   animations suspended, rAF shimmed. Boot queue of 12; exports jump the queue.
- **Invalidation** is per route: `vite-plugin-screen-versions.ts` hashes each
  `<Route>`'s transitive import closure into `/screen-versions.json`; the client
  polls it in dev (4 s) and drops entries whose route moved. No manifest → the
  cache runs OFF rather than trusting bitmaps it can't invalidate.
- Shot names are content-addressed (`shot-name.ts`: gen | version | viewport |
  src); `SHOTS_GENERATION` (env, `build-shots.ts`) is the only way to rename — and
  therefore truly re-serve — every immutable shot. Board ⋯ → **Refresh previews**
  clears the local tiers.

## 11. Projects, folder, registry
- `projects.ts` `PROJECTS`: `{ slug (permanent), name, blurb, kind: "board"|"flows",
  load?, archived? }`. `hrefFor(entry)` decides where opening goes. Adding a
  project = config module + registry entry + a grant.
- `/projects` (`folder.tsx`) shows only with more than one project: cards with a
  live thumbnail of the lead screen (`project-thumb.tsx`, mobile viewport, same
  cache key) and counts; flows cards draw the first diagram. Grouped: unfiled,
  then folders by position/name, Archive last (`groupByFolder`). Admins create,
  rename, delete folders and move projects (moving changes who can see it —
  `move-control.tsx` says so). Menu: theme rows, Manage access, Sign out.
- Archived = filed in the Archive folder (database); `ProjectEntry.archived` is the
  offline fallback. One committed board file per project:
  `review-board.json` for the default slug, `review-board-<slug>.json` otherwise
  (`io.ts` `snapshotFilename`, mirrored in the vite plugin).

## 12. Access
- **Edge middleware** (`middleware.ts`, Vercel): nothing is served without the
  HttpOnly `rv_auth` cookie — HMAC-SHA256 of `{email, t}` with `GATE_SECRET`,
  30 days. Serves a self-contained, unbranded email → 6-digit-code login;
  `POST /__gate/session` verifies the Supabase JWT (JWKS) and mints the cookie;
  `/__gate/logout` clears it. Fails closed (503) without its three env vars. A
  refused address gets a request-access form.
- **In-app gate** (`src/auth/`): `client.ts` one Supabase client; `LoginGate.tsx`
  the same OTP flow for local dev; `AuthProvider.tsx` `AuthGate` + `useAuthOptional`;
  asks for a display name once (prefilled by `my_default_name`). Offline (no env)
  everything renders with no gate.
- **Sign-in allowlist:** `access_rules (kind domain|email, value, is_admin,
  display_name)` enforced by the Before User Created hook + `is_email_allowed()`.
- **Per-project grants:** `project_access (project_slug, kind all|domain|email,
  value)`; RLS on threads/statuses/events via `can_access_project()`; client asks
  `my_project_slugs`, `my_is_admin` (`access.ts`, `use-access.ts`). Pure rules in
  `access-rules.ts` for tests.
- **Folders:** `project_folders`, `project_folder_items`, `folder_access` — a folder
  grant covers every project filed in it, now and later; Archive can't be granted.
- **Share panel** (`share-panel.tsx`, the Share pill): one permission level (being on
  a project means you can share it); Only people added / Everyone who can sign in;
  pending requests decided inline; directory suggestions as you type
  (`share-suggest.ts`, "Already added" tag, agents excluded). A non-admin may only
  add someone who can already sign in.
- **Request access:** signed-in → RPC `request_project_access` + the
  `request-access` function emails the owners; anonymous → from the login door
  (rate-limited, never reveals whether an address exists); approval email on decide.
- **Admin console** `/projects/access` (`admin/`): tabs Users | Projects | Folders |
  Requests, plus pages for one project, one folder, one person/domain.

## 13. Presence, chat, reactions
- Private realtime channel `review-presence:<slug>` (`presence.ts`, RLS on
  `realtime.messages`): who is on the board, which page/view/slide, cursors in
  surface-local coordinates (sent only to an audience, rate falling as it grows),
  camera only while someone follows you. Avatar row (3, then 2 + N); Edit profile
  (15 palette colours + custom hex, emoji); "Show me to others"; follow a person
  (any input of your own, or Esc, stops). Away after 10 min. No email, no
  persistence, agents never appear.
- Cursor chat: `/` or right-click → Chat, Enter sends, lasts 5 s. Reactions **1–8**;
  **E** opens the wheel (`presence-chat.tsx`). Works inside same-origin frames.

## 14. Notifications
- `review_notify_prefs` (replies opt-OUT, new threads opt-IN), `review_notifications`
  (a ledger: each thread or reply mails at most once), `review_notify_config`
  (`site_url`, `from_email`, `token`, `triage_token`). Trigger
  `notify_review_thread_changed` → pg_net → the `notify-review` function, which
  re-reads the row, diffs against the ledger, filters every recipient through
  `can_access_project`, always mails anyone @mentioned, marks items older than 72 h
  stale, and sends through Resend. UI: board ⋯ → "Email me about…".

## 15. Theme
- Auto / Light / Dark, global key `rv:theme` (`theme.ts`), resolved to `.is-dark` on
  `.rv-root`; rows shared by the board ⋯, the folder and the admin console.

## 16. Dev mode
- An inspector for developers rebuilding the screens (`src/dev/`, guide `DEV.md`
  in the app). On the board: the `</>` tool or **D**; on any product route:
  `?dev=1` or ⌘⇧D. Tabs Inspect (component stack, real props, tokens behind
  colours), Code (JSX / HTML / compiled CSS), Resources (tokens, icons, images,
  fonts — each downloadable), Export (`page.html`, `bundle.zip`). Measurement
  rulers in the page's own pixels. Three rules: never touch the ambient
  document, never `instanceof` a DOM class, namespace every class `rvdev`.
  `build.rollupOptions.output.keepNames` keeps component names in production.

## 17. /flows canvas
- A flow-chart document per `flows` project (`src/flows/`): nodes
  `start|step|decision|outcome|note`, labelled edges, pure ops (`model.ts`), undo/redo,
  fork, problems panel (unlabelled forks, orphans, dead ends). Stored in `flow_docs`,
  one jsonb row per diagram, autosaved 700 ms, **every save conditional on the `rev`
  it read** (a mismatch surfaces both versions). Offline → localStorage
  `flows:<slug>`, labelled "This browser only". `seed.ts` writes once, on the first
  open of an EMPTY project; afterwards the database is the document.

## 18. Keyboard and zoom
- **C** comment · **D** dev mode · **V** pointer · **Esc** backs out one layer ·
  ⌘/Ctrl + = / − zoom by 1.25 (works while typing) · ⌘/Ctrl+0 fit · slides ← → ↑ ↓ J K
  · `/` chat · 1–8 reactions · E wheel · flows ⌘Z / ⇧⌘Z.
- Canvas scale 0.14–1.6; wheel zoom anchored at the cursor; two-finger scroll pans;
  Safari `GestureEvent` pinch handled natively; touch pinch via a board-scoped
  viewport lock. Zoom belongs to the canvas, never to `index.html`.

## 19. Wiring (what install.sh does)
- `src/main.tsx`: `applySeedFromUrl()` → `installReviewCapture()` →
  `installDevMode()` FIRST, before any module can read storage.
- `vite.config.ts`: `reviewSnapshotPlugin('review-board.json')`,
  `screenVersionsPlugin()`, `server.watch.ignored` for the board files,
  `build.rollupOptions.output.keepNames`, the `@` alias.
- `src/review-routes.tsx` mounted inside the app's `<Routes>`; every page lazy.
- `tsconfig`: `@/*` paths, `vite/client` types.

## 20. Env vars and secrets
| Where | Variable | Effect |
| --- | --- | --- |
| client | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | unset = local board; set = shared + gated |
| client | `VITE_SHOTS_URL` | tier-2 preview bucket (build-time) |
| Vercel | `GATE_SECRET` | signs the gate cookie; rotate to sign everyone out |
| functions | `RESEND_API_KEY` | notify-review, request-access, review-triage |
| GitHub | `SHOTS_SUPABASE_URL`, `SHOTS_SERVICE_KEY` | review-shots workflow |
| GitHub | `REVIEW_TRIAGE_TOKEN` | triage-reply workflow |
| scripts | `TRIAGE_TOKEN`, `PR_NUMBER`, `TRIAGE_URL`, `CHROMIUM_PATH` | triage-reply.mjs, review-shots.mjs |

## 21. Tests
`npm run review:test` runs every `*.test.ts` under `src/review` and `src/flows`
through tsx (plain `node:assert`, no runner): access rules and folders, mentions
and read state, presence maths, screen-version hashing, flow-graph layout,
request normalisation, share suggestions, the flows model.
