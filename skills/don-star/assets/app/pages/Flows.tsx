// /flows — the flow-chart canvas for a project (2026-08-13).
//
// Same gate, same folder, same per-project grants as /review; what differs is
// that the document lives in the DATABASE and the people reviewing it are the
// ones editing it. See src/flows/ for the model, the store and the canvas.
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthGate, useAuthOptional } from '@/auth/AuthProvider'
import { FlowsApp } from '@/flows/app'
import { useMyAccess } from '@/review/use-access'
import { resolveRequest } from '@/review/projects'
import { RequestAccessScreen } from '@/review/request-access'
import '@/review/review.css'
import '@/review/request-access.css'

function FlowsInner() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const identity = useAuthOptional()
  const access = useMyAccess()

  if (access.loading) return null

  const wanted = params.get('project')
  // A canvas that exists and isn't yours gets the same door /review shows.
  const request = resolveRequest(access.projects, wanted, false)
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
  // No default: a flow canvas is per project, and guessing which one would
  // open somebody else's thinking. Unaddressed goes to the folder.
  const entry = wanted ? access.projects.find((p) => p.slug === wanted) : undefined
  if (!entry) return <Navigate to="/projects" replace />
  // A board project has no canvas here — send it to the board it does have.
  if (entry.kind !== 'flows') return <Navigate to={`/review?project=${encodeURIComponent(entry.slug)}`} replace />

  return (
    <FlowsApp
      slug={entry.slug}
      projectName={entry.name}
      account={
        identity ? { name: identity.displayName, email: identity.email, onSignOut: identity.signOut } : null
      }
      onFolder={access.projects.length > 1 ? () => navigate('/projects') : undefined}
    />
  )
}

export default function Flows() {
  return (
    <AuthGate>
      <FlowsInner />
    </AuthGate>
  )
}
