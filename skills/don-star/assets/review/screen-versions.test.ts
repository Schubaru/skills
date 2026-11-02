/*
  Runnable check for the per-route content versions the preview cache invalidates
  on (src/review/vite-plugin-screen-versions.ts).
  Run:  npx tsx src/review/screen-versions.test.ts
  No test framework — plain assert, exits non-zero on failure. Same style as
  mentions-reads.test.ts.

  WHY THIS IS PINNED. The board caches a bitmap per screen and re-boots any screen
  whose version moved. So the version function decides, for every reviewer, how
  much of the board reloads — and once shots are built in CI, how many get
  re-photographed per push. It used to fold a whole-file hash of App.tsx into
  EVERY route, which meant one added `<Route>` line, one renamed import, or one
  edited comment invalidated all ~140 screens. App.tsx is the most-edited file in
  the repo (18 of 30 days in Aug 2026 carried a commit touching the global set),
  so the cache missed wholesale on most days.

  The property that has to hold: a change re-captures the screens it can actually
  affect, and nothing else. Both directions are asserted below, because both
  failures are expensive and neither is visible by looking — under-invalidating
  serves a picture of a design that no longer exists, over-invalidating brings
  back the reload storm.
*/
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { computeScreenVersions } from './vite-plugin-screen-versions'

// --- a miniature app tree ------------------------------------------------------

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-versions-'))
const write = (rel: string, body: string) => {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
}

write('src/main.tsx', `import App from './App'\nrender(<App />)\n`)
write('src/index.css', `@theme { --color-primary: #000229; }\n`)
write('src/lib/pricing.ts', `export const PRICE = 230\n`)
write('src/pages/Intake.tsx', `import { PRICE } from '../lib/pricing'\nexport default () => <div>{PRICE}</div>\n`)
write('src/pages/Account.tsx', `export default () => <div>account</div>\n`)

const app = (body: string) => write('src/App.tsx', body)

const APP_BASE = `import Intake from './pages/Intake'
import Account from './pages/Account'

// A long explanatory comment block, of the kind this file actually carries.
function ScrollToTop() {
  useEffect(() => window.scrollTo(0, 0), [pathname])
  return null
}

function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/intake" element={<Intake />} />
        <Route path="/account" element={<Account />} />
      </Routes>
    </>
  )
}
`

app(APP_BASE)
const base = computeScreenVersions(root)

assert.deepEqual(Object.keys(base.routes).sort(), ['/account', '/intake'])

/** Recompute after an edit and report which of the ORIGINAL routes moved. A
 *  route the edit itself introduced has no baseline to differ from. */
function movedAfter(edit: () => void): string[] {
  edit()
  const next = computeScreenVersions(root)
  return Object.keys(base.routes)
    .filter((r) => next.routes[r] !== base.routes[r])
    .sort()
}

// --- §1 what must NOT move other screens ---------------------------------------
// Each of these is a real, frequent App.tsx edit. Before the shell split, every
// one of them repainted the entire board.

// Adding a route says nothing about the screens already on the board.
assert.deepEqual(
  movedAfter(() => app(APP_BASE.replace('</Routes>', '  <Route path="/new" element={<Account />} />\n      </Routes>'))),
  [],
  'adding a route must not move any existing route',
)

// Editing one of this file's long comment blocks cannot change a render.
assert.deepEqual(
  movedAfter(() => app(APP_BASE.replace('// A long explanatory comment block, of the kind this file actually carries.', '// Rewritten comment, twice as long, explaining a decision from a call.'))),
  [],
  'a comment edit must not move any route',
)

// Reordering imports is a formatting change; which module a route renders is
// already carried by that route's own closure.
assert.deepEqual(
  movedAfter(() =>
    app(APP_BASE.replace(`import Intake from './pages/Intake'\nimport Account from './pages/Account'`, `import Account from './pages/Account'\nimport Intake from './pages/Intake'`)),
  ),
  [],
  'reordering imports must not move any route',
)

// --- §2 what MUST move, and exactly how far ------------------------------------

// A component edit moves its own screen only.
assert.deepEqual(
  movedAfter(() => {
    app(APP_BASE)
    write('src/pages/Intake.tsx', `import { PRICE } from '../lib/pricing'\nexport default () => <div>now {PRICE}</div>\n`)
  }),
  ['/intake'],
  'editing a page must move exactly that page',
)

// A shared dependency moves every screen whose closure contains it — the whole
// point of hashing the transitive closure rather than the entry file.
assert.deepEqual(
  movedAfter(() => write('src/lib/pricing.ts', `export const PRICE = 249\n`)),
  ['/intake'],
  'editing a shared module must move the screens that import it',
)

// A prop on the route element is invisible to the module closure, so the
// `<Route>` chunk rides in the hash too.
assert.deepEqual(
  movedAfter(() => app(APP_BASE.replace('<Intake />', '<Intake mode="wm" />'))),
  ['/intake'],
  'a prop change on the route element must move that route',
)

// The shell every screen renders inside is still global, and so is the token
// layer — a palette change really does repaint the board.
app(APP_BASE)
assert.deepEqual(
  movedAfter(() => app(APP_BASE.replace('window.scrollTo(0, 0)', 'window.scrollTo(0, 40)'))),
  ['/account', '/intake'],
  'a change to the router shell must move every route',
)

app(APP_BASE)
assert.deepEqual(
  movedAfter(() => write('src/index.css', `@theme { --color-primary: #112233; }\n`)),
  ['/account', '/intake'],
  'a palette change must move every route',
)

// A CSS comment is inert here for the same reason it is in App.tsx.
write('src/index.css', `@theme { --color-primary: #112233; }\n`)
const cssBase = computeScreenVersions(root)
write('src/index.css', `/* RADIUS settled 2026-08-03, see DESIGN.md §7 */\n@theme { --color-primary: #112233; }\n`)
assert.deepEqual(computeScreenVersions(root).routes, cssBase.routes, 'a CSS comment must not move any route')

fs.rmSync(root, { recursive: true, force: true })
console.log('screen versions: all assertions passed')
