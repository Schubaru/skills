// /projects — the folder one level above a board, and /projects/access, the
// admin-only console where access is defined (2026-08-13; the console rebuilt
// as tabs and pages 2026-09-18).
//
// Both sit behind the same AuthGate as the board itself: the folder is a list
// of what you can open, so it is meaningless before you're signed in.
//
// The console's three surfaces are three routes, read here and handed to one
// component as a view, so the URL shape is written down in exactly one place.
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ProjectsFolder } from '@/review/folder'
import { ManageAccess, NotYours, toTab, type AdminView } from '@/review/admin'
import { findProject, hrefFor } from '@/review/projects'
import { useMyAccess } from '@/review/use-access'
import { useAuthOptional } from '@/auth/AuthProvider'
import { AuthGate } from '@/auth/AuthProvider'
import '@/review/review.css'

/** The signed-in identity in the shape the folder shell wants; null offline. */
function useFolderAccount() {
  const identity = useAuthOptional()
  if (!identity) return null
  return { name: identity.displayName, email: identity.email, onSignOut: identity.signOut }
}

function FolderInner() {
  const navigate = useNavigate()
  const account = useFolderAccount()
  const access = useMyAccess()
  if (access.loading) return null
  return (
    <ProjectsFolder
      projects={access.projects}
      folders={access.folders}
      items={access.items}
      folderGrants={access.folderGrants}
      account={account}
      isAdmin={access.isAdmin}
      onReload={() => void access.reload()}
      // Where a card goes depends on what kind of canvas it is — screens open
      // the board, flow charts open /flows. hrefFor() is the one place that
      // decides, so a third kind never means hunting for callers.
      onOpen={(slug) => {
        const entry = findProject(slug)
        navigate(entry ? hrefFor(entry) : `/review?project=${encodeURIComponent(slug)}`)
      }}
      onManageAccess={() => navigate('/projects/access')}
    />
  )
}

export default function Projects() {
  return (
    <AuthGate>
      <FolderInner />
    </AuthGate>
  )
}

function AccessInner({ view }: { view: AdminView }) {
  const account = useFolderAccount()
  const access = useMyAccess()
  if (access.loading) return null
  // Not an admin: the page simply isn't yours. The database refuses the writes
  // anyway (RLS), so this is the courtesy, not the lock.
  if (!access.isAdmin) return <NotYours account={account} />
  return <ManageAccess account={account} view={view} />
}

/** /projects/access?tab=users|projects|requests */
export function ProjectAccess() {
  const [params] = useSearchParams()
  return (
    <AuthGate>
      <AccessInner view={{ kind: 'tabs', tab: toTab(params.get('tab')) }} />
    </AuthGate>
  )
}

/** /projects/access/p/:slug — one project's own sharing panel. */
export function ProjectAccessProject() {
  const { slug } = useParams()
  return (
    <AuthGate>
      <AccessInner view={{ kind: 'project', slug: slug ?? '' }} />
    </AuthGate>
  )
}

/** /projects/access/f/:id — one folder: its name, what is in it, and who holds
 *  it. Holding a folder is holding every project filed there. */
export function ProjectAccessFolder() {
  const { id } = useParams()
  return (
    <AuthGate>
      <AccessInner view={{ kind: 'folder', id: Number(id) }} />
    </AuthGate>
  )
}

/** /projects/access/u/:id — one access_rules row: a person, or a whole domain. */
export function ProjectAccessUser() {
  const { id } = useParams()
  return (
    <AuthGate>
      <AccessInner view={{ kind: 'user', id: Number(id) }} />
    </AuthGate>
  )
}
