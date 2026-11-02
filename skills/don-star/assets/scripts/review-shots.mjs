/*
  BEFORE/AFTER SCREENSHOTS for a review-triage branch.

  WHY THIS EXISTS. The daily triage routine opens a PR describing changes in prose, and prose
  is the wrong medium for judging a design change — the reviewer, 2026-07-30: "I want screenshots so I
  know what the change did and can decide on merging or not." This script produces them
  mechanically: the same routes rendered by the working tree and by the merge base, side by
  side, so the diff is visible rather than described.

  It is deliberately dumb and deterministic. It takes routes, spins BOTH versions of the app on
  real dev servers, drives a real browser, and writes files. It makes no judgement about what
  changed and needs none — the pictures are the finding.

    node scripts/review-shots.mjs --routes "/enroll?s=about&v=4,/enroll?s=otp&v=4"

  Options:
    --routes  comma-separated app routes to capture (required)
    --base    git ref to compare against              (default: origin/main)
    --out     output directory, relative to __DS_APP_DIR__/  (default: .shots)
    --labels  comma-separated captions, one per route (default: the route itself)
    --desktop also capture each route at 1280px
    --no-base skip the comparison and capture the working tree only

  Prints a JSON summary on stdout (last line) so a caller can find the files:
    {"sheet":"…/sheet.jpg","shots":[{"route":"…","before":"…","after":"…"}]}

  The sheet is also left as sheet.html beside the PNGs, which is the scrollable version.

  The baseline runs from a throwaway git worktree with node_modules symlinked in, so nothing
  is installed twice and the working tree is never checked out or stashed. Both dev servers and
  the worktree are torn down on every exit path, including Ctrl-C.
*/

import { spawn, execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPO = resolve(APP, '..')

// --- args --------------------------------------------------------------------------------
const argv = process.argv.slice(2)
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? fallback : (argv[i + 1] ?? true)
}
const has = (name) => argv.includes(`--${name}`)

const routes = String(flag('routes', '')).split(',').map((s) => s.trim()).filter(Boolean)
const labels = String(flag('labels', '')).split(',').map((s) => s.trim())
const baseRef = String(flag('base', 'origin/main'))
const outDir = resolve(APP, String(flag('out', '.shots')))
const withDesktop = has('desktop')
const compare = !has('no-base')

if (!routes.length) {
  console.error('review-shots: --routes is required, e.g. --routes "/enroll?s=about&v=4"')
  process.exit(1)
}

// --- teardown registry -------------------------------------------------------------------
// Every resource registers its own cleanup the moment it is created, so an exception halfway
// through never leaves a dev server holding a port or a worktree on disk.
const cleanups = []
let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  for (const fn of cleanups.reverse()) {
    try { fn() } catch { /* best effort — one failure must not block the rest */ }
  }
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { cleanup(); process.exit(1) })
}

// --- dev servers -------------------------------------------------------------------------
/** Start `vite` in `cwd` and resolve with the port it actually bound (it auto-increments when
 *  the requested one is taken, so the log is the only trustworthy source).
 *
 *  vite is spawned DIRECTLY rather than through `npm run dev`: npm adds a shell and a node
 *  process between us and the server, and an orphaned tree is harder to kill than a single
 *  process group. The `predev` token generation it would have run happens once, synchronously,
 *  before the server starts — so a branch that edited DESIGN.md still renders its own theme. */
function startDev(cwd, port) {
  execFileSync('npm', ['run', 'tokens'], { cwd, stdio: 'pipe' })
  return new Promise((ok, fail) => {
    const child = spawn(
      join(cwd, 'node_modules', '.bin', 'vite'),
      ['--port', String(port), '--host', '127.0.0.1', '--clearScreen', 'false'],
      { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    cleanups.push(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ } })
    let log = ''
    const timer = setTimeout(() => fail(new Error(`dev server in ${cwd} never came up:\n${log}`)), 90_000)
    const watch = (buf) => {
      log += buf
      const m = log.match(/Local:\s+https?:\/\/[^:]+:(\d+)/)
      // unref, or the child's open stdio pipes keep OUR event loop alive and the script hangs
      // after its last line instead of exiting (and running the teardown).
      if (m) { clearTimeout(timer); child.unref(); ok(Number(m[1])) }
    }
    child.stdout.on('data', watch)
    child.stderr.on('data', watch)
    child.on('exit', (code) => { clearTimeout(timer); fail(new Error(`dev server exited (${code}):\n${log}`)) })
  })
}

// --- baseline worktree -------------------------------------------------------------------
function makeBaseWorktree() {
  const dir = join(tmpdir(), `review-shots-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  execFileSync('git', ['worktree', 'add', '--detach', dir, baseRef], { cwd: REPO, stdio: 'pipe' })
  cleanups.push(() => execFileSync('git', ['worktree', 'remove', '--force', dir], { cwd: REPO, stdio: 'pipe' }))
  // node_modules is the only thing the checkout lacks and the one thing worth minutes.
  symlinkSync(join(APP, 'node_modules'), join(dir, '__DS_APP_DIR__', 'node_modules'))
  return join(dir, '__DS_APP_DIR__')
}

// --- capture -----------------------------------------------------------------------------
const VIEWPORTS = withDesktop ? [['phone', 390, 900], ['desktop', 1280, 1000]] : [['phone', 390, 900]]

/** Playwright resolves its own browser from PLAYWRIGHT_BROWSERS_PATH in most sandboxes; the
 *  explicit path is the fallback for the ones where it doesn't. */
async function launch(chromium) {
  try {
    return await chromium.launch()
  } catch (err) {
    const fallback = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium'
    if (!existsSync(fallback)) throw err
    return chromium.launch({ executablePath: fallback })
  }
}

// ⚠ TRUNCATED ON PURPOSE. A board frame's route can carry its whole seed in the hash
// (`/intake#rv-seed=…`, review-seed.ts) — 1500+ characters, which becomes a 1500-character
// filename, which Linux rejects at 255. The screenshot then threw, `shot()` swallowed it as
// "route doesn't exist on the baseline", and the run reported "after only" with nothing
// captured either side. Same failure shape as the base64 sheet: the tool going quiet exactly
// on the runs that need it. The caller appends the route's index, so a truncated name is still
// unique across routes sharing a prefix.
const slug = (s) =>
  (s.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root').slice(0, 60)

async function main() {
  mkdirSync(outDir, { recursive: true })
  const { chromium } = await import(join(APP, 'node_modules', 'playwright-core', 'index.mjs'))

  console.error('review-shots: starting the working tree…')
  const afterPort = await startDev(APP, 5183)
  let beforePort = null
  if (compare) {
    console.error(`review-shots: checking out ${baseRef} and starting it…`)
    beforePort = await startDev(makeBaseWorktree(), 5184)
  }

  const browser = await launch(chromium)
  cleanups.push(() => browser.close())

  /** Capture one route, or null if the app never painted anything there.
   *
   *  `networkidle` alone is NOT enough and produced a blank first frame every run: vite
   *  pre-bundles dependencies on the first request and reloads the page when it finishes, so
   *  the network goes quiet once BEFORE the app has mounted. Waiting for real painted content
   *  is the only signal that survives that reload — and it doubles as the not-a-route check,
   *  since an unmatched route paints nothing and simply times out. */
  async function shot(port, route, file, [, w, h]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
    try {
      const res = await page.goto(`http://127.0.0.1:${port}${route}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      if (res && res.status() >= 400) return null
      await page.waitForFunction(
        () => {
          const root = document.getElementById('root')
          return !!root && root.children.length > 0 && (document.body?.innerText ?? '').trim().length > 0
        },
        null,
        { timeout: 20_000 },
      )
      await page.waitForLoadState('networkidle')
      if (page.evaluate) await page.evaluate(() => document.fonts?.ready).catch(() => {})
      // The app autofocuses the first field on arrival; a focus ring in one column and not the
      // other reads as a design difference when it is only an artifact of the capture.
      await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur())
      await page.waitForTimeout(200)
      await page.screenshot({ path: file, fullPage: true })
      return file
    } catch {
      return null // a route that doesn't exist on the baseline is a NEW screen, not a failure
    } finally {
      await page.close()
    }
  }

  // One throwaway load per server so vite's dependency pre-bundling is done before the first
  // capture, rather than during it.
  for (const port of [afterPort, beforePort].filter(Boolean)) {
    const warm = await browser.newPage()
    await warm.goto(`http://127.0.0.1:${port}${routes[0]}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {})
    await warm.close()
  }

  const shots = []
  for (const [i, route] of routes.entries()) {
    for (const vp of VIEWPORTS) {
      const name = `${i + 1}-${slug(route)}-${vp[0]}`
      const after = await shot(afterPort, route, join(outDir, `${name}-after.png`), vp)
      const before = compare ? await shot(beforePort, route, join(outDir, `${name}-before.png`), vp) : null
      shots.push({ route, label: labels[i] || route, viewport: vp[0], before, after })
      console.error(`review-shots: ${route} @ ${vp[0]} ${before ? '(before + after)' : '(after only)'}`)
    }
  }

  // The sheet is written to a FILE and loaded over file://, not handed to the browser as a
  // data: URL (fixed 2026-08-03). It used to base64-inline every PNG into one data:text/html
  // URL, which Chromium aborts once the URL passes a few megabytes — so the sheet silently
  // stopped being produced at exactly the point it became useful (many routes × two
  // viewports), which is the run the triage email needs it for. From a real file the images
  // are ordinary relative <img src>, so there is no size ceiling and no base64 at all.
  const sheetHtmlPath = join(outDir, 'sheet.html')
  writeFileSync(sheetHtmlPath, buildSheet(shots))
  const page = await browser.newPage({ viewport: { width: 940, height: 1200 } })
  await page.goto(pathToFileURL(sheetHtmlPath).href, { waitUntil: 'networkidle' })
  const sheetPath = join(outDir, 'sheet.jpg')
  // JPEG, not PNG: these get emailed and pasted, and a 1.2 MB PNG sheet is rejected by more
  // transports than it is accepted by.
  await page.screenshot({ path: sheetPath, fullPage: true, type: 'jpeg', quality: 82 })
  await page.close()

  console.log(JSON.stringify({ sheet: sheetPath, shots }))
  // Tear down explicitly and leave: the browser and both dev servers are external processes,
  // and `process.on('exit')` cannot await an async close.
  await browser.close().catch(() => {})
  cleanup()
  process.exit(0)
}

/** One page, one row per capture: baseline left, working tree right, labelled. */
function buildSheet(shots) {
  // Relative filenames: sheet.html sits beside the PNGs in outDir, so the browser resolves them
  // itself. (Was base64 data: URIs — see the note at the goto above.)
  const uri = (f) => (f ? basename(f) : null)
  const rows = shots.map((s) => {
    const before = uri(s.before)
    const after = uri(s.after)
    const col = (src, cls, cap) =>
      src ? `<figure><figcaption class="${cls}">${cap}</figcaption><img src="${src}"></figure>` : ''
    return `<section>
      <h2>${esc(s.label)}</h2>
      <p><code>${esc(s.route)}</code> · ${s.viewport}${before ? '' : ' · new screen, no baseline'}</p>
      <div class="row">
        ${col(before, 'before', `Before — ${esc(baseRef)}`)}
        ${col(after, 'after', 'After — this branch')}
      </div>
    </section>`
  })
  return `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:40px;background:#f6f6f8;font:500 14px/1.4 -apple-system,system-ui,sans-serif;color:#1e1e20}
    h1{font-size:26px;margin:0 0 4px}
    .sub{color:#62626d;margin:0 0 32px}
    section{margin-bottom:40px}
    h2{font-size:20px;margin:0 0 2px}
    section>p{color:#62626d;margin:0 0 14px}
    code{font:600 13px ui-monospace,monospace}
    .row{display:flex;gap:20px;align-items:flex-start}
    figure{margin:0;flex:1;max-width:400px}
    figcaption{font-size:12px;font-weight:700;padding:6px 10px;border-radius:8px 8px 0 0;color:#fff}
    .before{background:#62626d}.after{background:#000229}
    img{width:100%;display:block;border:1px solid #dbdbe0;border-top:0;border-radius:0 0 12px 12px;background:#fff}
  </style>
  <h1>Before / after</h1>
  <p class="sub">Live pages, this branch vs. <code>${esc(baseRef)}</code>.</p>
  ${rows.join('\n')}`
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

main().catch((err) => {
  console.error('review-shots failed:', err.message)
  cleanup()
  process.exit(1)
})
