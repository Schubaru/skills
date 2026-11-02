// /review — the internal design-review board (the author's don-star canvas), hosted
// inside __DS_APP_DIR__ so it ships behind the same email+OTP gate as the previews
// (edge middleware on Vercel; the in-app AuthGate below covers local dev).
// Frames are LIVE, always — same-origin iframes of the app's own routes, seeded
// into mid-flow states via each frame's own URL (src/review-seed.ts). There are
// no captured screenshots: a frame is either the real responsive page or a
// skeleton on its way to being one. Comments sync to Supabase when
// VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY are set (shared across clients);
// otherwise they stay in localStorage, and in dev they also autosave to
// review-board.json via the vite plugin in src/review/.
//
// WHICH BOARD (2026-08-13): this route now serves whichever project the
// account can open — ?project=<slug>, else the the partner board when the URL is
// addressing one (?page=/?thread=/?view=/?screen=, every deep link that
// predates projects), else the only project they hold. With a choice to make
// and nothing addressed, it hands over to /projects. See review/projects.ts.
import { useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ReviewApp, parseSnapshot, EMPTY_SNAPSHOT } from '@/review'
import { AuthGate, useAuthOptional } from '@/auth/AuthProvider'
import '@/review/review.css'
import { fetchSnapshotFromRepo } from '@/review/io'
import { findProject, hrefFor, resolveRequest, type ProjectEntry } from '@/review/projects'
import { useMyAccess } from '@/review/use-access'
import { RequestAccessScreen } from '@/review/request-access'
import '@/review/request-access.css'
import boardFile from '../../review-board.json'
import type { ReviewProject, ReviewSnapshot } from '@/review'

// The committed board files, by slug. The the partner board is imported statically so
// the production bundle carries it; a project with no committed file yet seeds
// empty and takes its threads from Supabase. Add the import here when a second
// board file lands (a dynamic import of a file that doesn't exist fails the
// build, so this map is deliberately explicit).
const COMMITTED_BOARDS: Record<string, unknown> = { '__DS_PROJECT_SLUG__': boardFile }

// Params that address a place INSIDE a board. Their presence is what keeps a
// shared comment link opening the comment for someone who has several projects.
const BOARD_ADDRESS_PARAMS = ['page', 'thread', 'view', 'screen']

// The committed board file seeds fresh browsers; localStorage edits then merge
// on top (see src/review/store.ts). In dev the seed is FETCHED from the
// snapshot plugin so out-of-band edits (an agent replying in the JSON) show up
// on reload — importing the JSON would either full-reload the page on every
// autosave (watched) or serve a stale module cache (the file is watch-ignored
// in vite.config.ts). The static import stays as the build fallback.
async function loadSeed(slug: string): Promise<ReviewSnapshot> {
  let raw: unknown = COMMITTED_BOARDS[slug] ?? null
  if (import.meta.env.DEV) {
    const fetched = await fetchSnapshotFromRepo(slug)
    if (fetched) raw = fetched
  }
  return parseSnapshot(raw) ?? EMPTY_SNAPSHOT
}

function Board({ entry, others, isAdmin }: { entry: ProjectEntry; others: ProjectEntry[]; isAdmin: boolean }) {
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState<{ project: ReviewProject; seed: ReviewSnapshot } | null>(null)

  useEffect(() => {
    let on = true
    setLoaded(null)
    // Non-null: ReviewInner hands a flows project to /flows before it gets
    // here, so a Board entry always has a config.
    void Promise.all([entry.load!(), loadSeed(entry.slug)]).then(([project, seed]) => {
      if (on) setLoaded({ project, seed })
    })
    return () => {
      on = false
    }
  }, [entry])

  if (!loaded) return null
  return (
    <ReviewApp
      project={loaded.project}
      seed={loaded.seed}
      nav={{
        // Only when there is somewhere to go back TO: with a single project the
        // folder would list the board you are standing in.
        onFolder: others.length > 1 ? () => navigate('/projects') : undefined,
        onManageAccess: isAdmin ? () => navigate('/projects/access') : undefined,
      }}
    />
  )
}

function ReviewInner() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const access = useMyAccess()
  // Read once for the byline the board's own header shows; the gate itself is
  // AuthGate + RLS, not this.
  const identity = useAuthOptional()

  if (access.loading) return null

  const wanted = params.get('project')
  const addressed = BOARD_ADDRESS_PARAMS.some((k) => params.has(k))
  const request = resolveRequest(access.projects, wanted, addressed)
  // A project that EXISTS and isn't yours gets a door to knock on rather than
  // the folder, which would read as "that board is gone".
  if ('denied' in request) {
    return (
      <RequestAccessScreen
        slug={request.denied}
        email={identity?.email ?? ''}
        onSignOut={identity?.signOut}
        onProjects={() => navigate('/projects')}
      />
    )
  }
  // Nothing to open, or a slug nobody has ever had: the folder says what they
  // DO have (and says "no projects yet" when that's the truth).
  if (!('open' in request)) return <Navigate to="/projects" replace />
  const slug = request.open

  const entry = findProject(slug)
  if (!entry) return <Navigate to="/projects" replace />
  // A flow-chart project has no board config — it resolves here only when it's
  // the account's single project, so hand it to the canvas rather than
  // rendering an empty board.
  if (entry.kind === 'flows') return <Navigate to={hrefFor(entry)} replace />
  return <Board entry={entry} others={access.projects} isAdmin={access.isAdmin} />
}

export default function Review() {
  // AuthGate = email+OTP sign-in when Supabase is configured (it renders the
  // board only with a signed-in, named user); passthrough in offline mode.
  return (
    <AuthGate>
      <ReviewInner />
    </AuthGate>
  )
}
