/*
  Runnable check for per-project access resolution (src/review/access.ts,
  src/review/projects.ts).
  Run:  npx tsx src/review/access.test.ts
  No test framework — plain assert, exits non-zero on failure. Same style as
  mentions-reads.test.ts.

  What's worth pinning, and why:
    §1  A GRANT NEVER WIDENS SIGN-IN. Rule matching is the same shape as the SQL
        predicate, but the SQL also requires is_email_allowed(); these helpers
        only ever answer "does this rule apply", never "is this person in".
    §2  DEEP LINKS SURVIVE. Every ?page= / ?thread= link written before projects
        existed means the the partner board. A multi-project reviewer following one must
        land on the comment, not on the folder.
    §5  ONE FIELD, TWO KINDS OF THING. What someone types is a person or a
        domain; anything we can't name comes back rejected rather than becoming
        a grant for something they didn't mean.
    §6  A DOOR TO KNOCK ON. A project that exists but isn't yours is not the
        same as a typo — the first can be asked for.
    §3  A CHOOSER WITH ONE OPTION IS A LIE. One project → you land in it. And a
        ?project= you don't hold resolves to the folder, never to someone else's
        board.
*/
import assert from 'node:assert'
import {
  effectiveGrantsFor,
  folderGrantsFor,
  grantsFor,
  isDomainAllowed,
  matchesRule,
  moveConfirmText,
  movePreview,
  movePreviewLine,
  parseAccessEntries,
  parseAccessEntry,
  canShare,
  type AccessRule,
  type Folder,
  type FolderGrant,
  type FolderItem,
  type ProjectGrant,
} from './access-rules'
import {
  PROJECTS,
  groupByFolder,
  hrefFor,
  isArchived,
  resolveProject,
  withEmptyFolders,
  resolveRequest,
  visibleProjects,
  type ProjectEntry,
} from './projects'

const ATT: ProjectEntry = { slug: '__DS_PROJECT_SLUG__', name: '__DS_PROJECT_NAME__', blurb: '', kind: 'board', load: async () => ({ name: '', pages: [] }) }
const REDESIGN: ProjectEntry = { slug: 'app-redesign', name: 'App Redesign', blurb: '', kind: 'board', load: async () => ({ name: '', pages: [] }) }
const ALL = [ATT, REDESIGN]

// === §1 rule matching =======================================================

const grants: ProjectGrant[] = [
  { id: 1, projectSlug: '__DS_PROJECT_SLUG__', kind: 'all', value: null, note: null },
  { id: 2, projectSlug: 'app-redesign', kind: 'domain', value: '__DS_ADMIN_DOMAIN__', note: null },
  { id: 3, projectSlug: 'app-redesign', kind: 'email', value: 'dana@client.example', note: null },
]

// 'all' is exactly that: everyone who got through the sign-in gate.
assert.equal(matchesRule(grants[0]!, 'anyone@partner.example'), true)
// Domain rules compare the domain, not a substring — "not__DS_ADMIN_DOMAIN__" must miss.
assert.equal(matchesRule(grants[1]!, 'rita@__DS_ADMIN_DOMAIN__'), true)
assert.equal(matchesRule(grants[1]!, 'rita@not__DS_ADMIN_DOMAIN__'), false)
assert.equal(matchesRule(grants[1]!, 'rita@__DS_ADMIN_DOMAIN__.uk'), false)
// Case is not a permission boundary.
assert.equal(matchesRule(grants[2]!, 'Dana@client.example'), true)
assert.equal(matchesRule(grants[2]!, 'other@client.example'), false)
// A malformed address matches nothing but 'all'.
assert.equal(matchesRule(grants[1]!, 'no-at-sign'), false)

assert.deepEqual(grantsFor(grants, 'rita@__DS_ADMIN_DOMAIN__'), ['__DS_PROJECT_SLUG__', 'app-redesign'])
assert.deepEqual(grantsFor(grants, 'someone@partner.example'), ['__DS_PROJECT_SLUG__'])
assert.deepEqual(grantsFor(grants, 'dana@client.example'), ['__DS_PROJECT_SLUG__', 'app-redesign'])

// === §2 what you can see ====================================================

assert.deepEqual(visibleProjects(['__DS_PROJECT_SLUG__']).map((p) => p.slug), ['__DS_PROJECT_SLUG__'])
// Offline (no Supabase configured) = no gate: local design work opens
// everything. Asserted against the registry rather than a written-out list, so
// adding a project doesn't fail a check about a rule it didn't change.
assert.deepEqual(visibleProjects(null).map((p) => p.slug), PROJECTS.map((p) => p.slug))
// A grant for a project that no longer exists in code is inert, not a crash.
assert.deepEqual(visibleProjects(['ghost-project']).map((p) => p.slug), [])

// === §3 resolution ==========================================================

// One project → land in it, folder or not.
assert.equal(resolveProject([ATT], null, false), '__DS_PROJECT_SLUG__')
assert.equal(resolveProject([REDESIGN], null, false), 'app-redesign')
// Several, and no board address → the folder.
assert.equal(resolveProject(ALL, null, false), null)
// Several, but the URL points INTO a board (?page=/?thread=) → the default one.
assert.equal(resolveProject(ALL, null, true), '__DS_PROJECT_SLUG__')
// …unless you can't open the default, in which case the folder is the honest
// answer — a deep link is not a grant.
assert.equal(resolveProject([REDESIGN], null, true), 'app-redesign')
assert.equal(resolveProject([], null, true), null)
// An explicit ?project= wins, when held.
assert.equal(resolveProject(ALL, 'app-redesign', true), 'app-redesign')
// …and never opens a board you don't hold, however it was addressed.
assert.equal(resolveProject([ATT], 'app-redesign', false), null)
assert.equal(resolveProject([ATT], 'app-redesign', true), null)
assert.equal(resolveProject(ALL, 'no-such-project', false), null)
// Nothing granted → nothing opens.
assert.equal(resolveProject([], null, false), null)

// === §4 the registry's own contract =========================================

// A "board" project IS its config module; a "flows" project has none, because
// its canvas is a document in the database. Every consumer branches on that —
// the folder (which thumbnail), /review (open it or hand it to /flows), and
// scripts/build-shots.ts (which projects have screens to photograph). The
// shots job broke on exactly this: it called entry.load() for every project
// the day a project without one landed.
for (const p of PROJECTS) {
  if (p.kind === 'board') assert.equal(typeof p.load, 'function', `${p.slug} is a board and must carry a config`)
  else assert.equal(p.load, undefined, `${p.slug} is not a board and must not carry one`)
}
assert.ok(PROJECTS.every((p) => p.kind === 'board' || p.kind === 'flows'), 'every project has a known kind')

// Opening a project goes by kind, in one place, so a third kind never means
// hunting for callers.
assert.ok(hrefFor(PROJECTS.find((p) => p.kind === 'board')!).startsWith('/review?'))
const flows = PROJECTS.find((p) => p.kind === 'flows')
if (flows) assert.ok(hrefFor(flows).startsWith('/flows?'))

// === §5 parsing the add field ===============================================

assert.deepEqual(parseAccessEntry('jane@client.example'), { kind: 'email', value: 'jane@client.example' })
// Case and stray whitespace are not a distinction.
assert.deepEqual(parseAccessEntry('  Jane@client.example '), { kind: 'email', value: 'jane@client.example' })
// A bare domain, the way people write it, and the way a browser hands it over.
assert.deepEqual(parseAccessEntry('client.example'), { kind: 'domain', value: 'client.example' })
assert.deepEqual(parseAccessEntry('@client.example'), { kind: 'domain', value: 'client.example' })
assert.deepEqual(parseAccessEntry('https://client.example/x'), { kind: 'domain', value: 'client.example' })
assert.deepEqual(parseAccessEntry('www.client.example'), { kind: 'domain', value: 'client.example' })
// A name typed alongside becomes that person's default byline.
assert.deepEqual(parseAccessEntry('Jane Doe <jane@client.example>'), {
  kind: 'email',
  value: 'jane@client.example',
  name: 'Jane Doe',
})
// Junk is null, never a guess: no dot, a bare name, an empty local part, a
// space inside the token.
assert.equal(parseAccessEntry('nonsense'), null)
assert.equal(parseAccessEntry('Jane Doe'), null)
assert.equal(parseAccessEntry('@'), null)
assert.equal(parseAccessEntry('@client'), null)
assert.equal(parseAccessEntry('jane@'), null)
assert.equal(parseAccessEntry('@client.example jane'), null)
assert.equal(parseAccessEntry(''), null)
assert.equal(parseAccessEntry('   '), null)

const pasted = parseAccessEntries('jane@client.example, client.example; nonsense\nJANE@client.example\n@partner.example')
assert.deepEqual(pasted.entries, [
  { kind: 'email', value: 'jane@client.example' },
  { kind: 'domain', value: 'client.example' },
  { kind: 'domain', value: 'partner.example' },
])
assert.deepEqual(pasted.rejected, ['nonsense'])

// The guardrail a non-admin hits: you may only invite someone who could
// already sign in. Mirrors share_project() — the SQL is still the authority.
const rules: AccessRule[] = [
  { id: 1, kind: 'domain', value: '__DS_ADMIN_DOMAIN__', note: null, isAdmin: true, displayName: null },
  { id: 2, kind: 'domain', value: 'client.example', note: null, isAdmin: false, displayName: null },
  { id: 3, kind: 'email', value: 'guest@example.com', note: null, isAdmin: false, displayName: 'Guest' },
]
assert.equal(isDomainAllowed(rules, { kind: 'email', value: 'anyone@client.example' }), true)
assert.equal(isDomainAllowed(rules, { kind: 'email', value: 'guest@example.com' }), true)
// One allowed address does not open its domain.
assert.equal(isDomainAllowed(rules, { kind: 'domain', value: 'example.com' }), false)
assert.equal(isDomainAllowed(rules, { kind: 'email', value: 'other@example.com' }), false)
assert.equal(isDomainAllowed(rules, { kind: 'domain', value: 'client.example' }), true)
assert.equal(isDomainAllowed(rules, { kind: 'domain', value: 'nope.com' }), false)

// === §6 requests ============================================================

// A project you hold opens, exactly as resolveProject says.
assert.deepEqual(resolveRequest(ALL, 'app-redesign', false), { open: 'app-redesign' })
assert.deepEqual(resolveRequest(ALL, null, false), { folder: true })
// One you don't hold, but which EXISTS, is a door to knock on.
assert.deepEqual(resolveRequest([], PROJECTS[0]!.slug, false), { denied: PROJECTS[0]!.slug })
// A slug that isn't in the registry at all is a typo, not a locked door.
assert.deepEqual(resolveRequest(ALL, 'no-such-project', false), { folder: true })

// === §7 who may share =======================================================

// One level: on the project = may manage it. Admins hold everything, and
// offline (slugs null) there is no gate at all.
const loaded = { loading: false }
assert.equal(canShare({ ...loaded, slugs: ['__DS_PROJECT_SLUG__'], isAdmin: false }, '__DS_PROJECT_SLUG__'), true)
assert.equal(canShare({ ...loaded, slugs: ['__DS_PROJECT_SLUG__'], isAdmin: false }, 'redesign'), false)
assert.equal(canShare({ ...loaded, slugs: [], isAdmin: true }, 'redesign'), true)
assert.equal(canShare({ ...loaded, slugs: null, isAdmin: false }, 'redesign'), true)
// Before the answer arrives, nobody gets the button — it would flicker in.
assert.equal(canShare({ loading: true, slugs: null, isAdmin: true }, 'redesign'), false)

// === §8 folders =============================================================
//
// A folder is two things: how the folder page groups projects, and a grant
// surface. ARCHIVE is neither shareable nor reachable through a folder grant —
// that is the line worth pinning, because crossing it would hand out every
// retired board at once.

const WORK: Folder = { id: 1, name: 'Client work', isArchive: false, position: 0 }
const IDEAS: Folder = { id: 2, name: 'Ideas', isArchive: false, position: 0 }
const ARCHIVE: Folder = { id: 9, name: 'Archive', isArchive: true, position: 100 }
const FOLDERS = [WORK, IDEAS, ARCHIVE]

const items: FolderItem[] = [
  { projectSlug: '__DS_PROJECT_SLUG__', folderId: WORK.id },
  { projectSlug: 'medicare-wm', folderId: WORK.id },
  { projectSlug: 'universal-intake', folderId: IDEAS.id },
  { projectSlug: 'app-redesign', folderId: ARCHIVE.id },
]

const folderGrants: FolderGrant[] = [
  { id: 1, folderId: WORK.id, kind: 'domain', value: 'client.example', note: null },
  { id: 2, folderId: IDEAS.id, kind: 'email', value: 'dana@client.example', note: null },
  { id: 3, folderId: IDEAS.id, kind: 'all', value: null, note: null },
  // Should never exist (the SQL trigger refuses it); pinned here so a bug that
  // writes one anyway still can't hand Archive to a reader.
  { id: 4, folderId: ARCHIVE.id, kind: 'all', value: null, note: null },
]

// A folder grant gives every project in the folder.
assert.deepEqual(folderGrantsFor(folderGrants, items, FOLDERS, 'anyone@client.example'), [
  '__DS_PROJECT_SLUG__',
  'medicare-wm',
  'universal-intake',
])
// 'all' on a folder is everyone who can sign in, and nothing more.
assert.deepEqual(folderGrantsFor(folderGrants, items, FOLDERS, 'someone@partner.example'), ['universal-intake'])
// ⚠ The line: Archive is never reachable through a folder grant, not even an
// open one.
assert.ok(!folderGrantsFor(folderGrants, items, FOLDERS, 'anyone@client.example').includes('app-redesign'))
// No folders at all (offline, or pre-migration) gives nothing rather than
// throwing.
assert.deepEqual(folderGrantsFor([], [], [], 'rita@__DS_ADMIN_DOMAIN__'), [])

// What does this person see, and WHY. A direct grant outranks a folder,
// because it survives the project being moved.
assert.deepEqual(effectiveGrantsFor(grants, folderGrants, items, FOLDERS, 'dana@client.example'), [
  { slug: '__DS_PROJECT_SLUG__', via: 'everyone' },
  { slug: 'app-redesign', via: 'email' },
  { slug: 'medicare-wm', via: 'folder', folderId: WORK.id },
  { slug: 'universal-intake', via: 'folder', folderId: IDEAS.id },
])
// Someone with no project grant but a folder grant sees the folder's projects.
assert.deepEqual(effectiveGrantsFor([], folderGrants, items, FOLDERS, 'other@client.example'), [
  { slug: '__DS_PROJECT_SLUG__', via: 'folder', folderId: WORK.id },
  { slug: 'medicare-wm', via: 'folder', folderId: WORK.id },
  { slug: 'universal-intake', via: 'folder', folderId: IDEAS.id },
])
// The union is still just the project grants when there are no folders.
assert.deepEqual(
  effectiveGrantsFor(grants, [], [], [], 'rita@__DS_ADMIN_DOMAIN__').map((r) => r.slug),
  grantsFor(grants, 'rita@__DS_ADMIN_DOMAIN__'),
)

// The sentence the confirm dialog needs before a move changes who can see a
// board.
assert.deepEqual(movePreview(folderGrants, WORK), { open: false, domains: ['client.example'], people: 0 })
assert.deepEqual(movePreview(folderGrants, IDEAS), { open: true, domains: [], people: 1 })
// Moving to Archive always reads as nobody, whatever rows are there.
assert.deepEqual(movePreview(folderGrants, ARCHIVE), { open: false, domains: [], people: 0 })

// === §9 grouping ============================================================

const ARCHIVED_ENTRY: ProjectEntry = { ...REDESIGN, archived: true }
const MEDICARE: ProjectEntry = { slug: 'medicare-wm', name: 'Medicare WM', blurb: '', kind: 'board', load: async () => ({ name: '', pages: [] }) }
const SOME = [ATT, ARCHIVED_ENTRY, MEDICARE]

// No folder data: the code flag is the only thing that knows, and it produces
// a synthetic Archive so the folder page still has its heading.
const offline = groupByFolder(SOME, [], [])
assert.deepEqual(offline.map((g) => g.folder?.name ?? null), [null, 'Archive'])
assert.deepEqual(offline[0]!.projects.map((p) => p.slug), ['__DS_PROJECT_SLUG__', 'medicare-wm'])
assert.deepEqual(offline[1]!.projects.map((p) => p.slug), ['app-redesign'])

// With folders, the DATABASE decides: unfiled first, named folders by position
// then name, Archive last.
const grouped = groupByFolder(SOME, FOLDERS, items)
assert.deepEqual(grouped.map((g) => g.folder?.name ?? null), ['Client work', 'Archive'])
assert.deepEqual(grouped[0]!.projects.map((p) => p.slug), ['__DS_PROJECT_SLUG__', 'medicare-wm'])
assert.deepEqual(grouped[1]!.projects.map((p) => p.slug), ['app-redesign'])
// Ideas holds nothing this account can see, so it is not a heading.
assert.ok(!grouped.some((g) => g.folder?.name === 'Ideas'))

// Position before name, and name only as the tie-break.
const zulu: Folder = { id: 3, name: 'Alpha', isArchive: false, position: 5 }
const ordered = groupByFolder(
  [ATT, MEDICARE],
  [WORK, zulu],
  [{ projectSlug: '__DS_PROJECT_SLUG__', folderId: zulu.id }, { projectSlug: 'medicare-wm', folderId: WORK.id }],
)
assert.deepEqual(ordered.map((g) => g.folder?.name), ['Client work', 'Alpha'])

// A project filed in a folder this account can't see keeps its card, under no
// heading — losing the card would be worse than losing the heading.
const hidden = groupByFolder([ATT], FOLDERS.filter((f) => f.isArchive), items)
assert.deepEqual(hidden.map((g) => g.folder?.name ?? null), [null])

// The database is the source of truth once there are folders; the code flag is
// the fallback and nothing more.
assert.equal(isArchived(ARCHIVED_ENTRY, [], []), true)
assert.equal(isArchived(ARCHIVED_ENTRY, FOLDERS, items), true)
assert.equal(isArchived(ATT, FOLDERS, items), false)
// A project the code calls archived but the database has filed elsewhere is
// NOT archived — the move is what counts.
assert.equal(isArchived(ARCHIVED_ENTRY, FOLDERS, [{ projectSlug: 'app-redesign', folderId: WORK.id }]), false)

// --- §8  A MOVE IS A SHARE ---------------------------------------------------
//
// Moving a project into a folder hands it to everyone on that folder, which is
// why the sentence is a helper and not three copies of some prose. Archive is
// the other direction: it takes folder access away and leaves the project's
// own grants alone, so it gets its own sentence rather than a silent move.

assert.equal(
  movePreviewLine(movePreview(folderGrants, WORK), WORK.name),
  'Moving this into “Client work” shares it with everyone at client.example.',
)
assert.equal(
  movePreviewLine(movePreview(folderGrants, IDEAS), IDEAS.name),
  'Moving this into “Ideas” shares it with everyone who can sign in and 1 person.',
)
// A folder nobody is on changes nothing, so there is nothing to ask about.
const LONELY: Folder = { id: 7, name: 'Drafts', isArchive: false, position: 1 }
assert.equal(movePreviewLine(movePreview(folderGrants, LONELY), LONELY.name), null)
assert.equal(moveConfirmText(LONELY, folderGrants), null)
assert.equal(moveConfirmText(null, folderGrants), null)
assert.ok(moveConfirmText(WORK, folderGrants)?.endsWith('Move it there?'))
// Archive always asks, and says what it does NOT do.
const toArchive = moveConfirmText(ARCHIVE, folderGrants)
assert.ok(toArchive && toArchive.includes('Its own access is untouched.'))

// --- §9  AN EMPTY FOLDER IS STILL A FOLDER (for admins) ----------------------
//
// groupByFolder drops a heading with nothing under it, which is right for a
// reviewer and wrong for the admin who just made it: there would be nowhere to
// move a project TO. The empty groups go back in their own order.

const grouped9 = groupByFolder(SOME, FOLDERS, items)
const withEmpty = withEmptyFolders(grouped9, FOLDERS)
// Every project in SOME is filed, so there is no unfiled group to lead with.
assert.deepEqual(withEmpty.map((g) => g.folder?.name), ['Client work', 'Ideas', 'Archive'])
assert.deepEqual(withEmpty.find((g) => g.folder?.name === 'Ideas')!.projects, [])
// The unfiled group keeps the lead once an empty folder is put back.
const UNFILED: ProjectEntry = { ...REDESIGN, slug: 'miscellaneous', name: 'Miscellaneous' }
const mixed = withEmptyFolders(groupByFolder([ATT, UNFILED], FOLDERS, items), FOLDERS)
assert.deepEqual(mixed.map((g) => g.folder?.name ?? null), [null, 'Client work', 'Ideas', 'Archive'])

// Nothing missing means the same array, and no folders at all is a no-op.
assert.equal(withEmptyFolders(grouped9, []), grouped9)
assert.deepEqual(withEmptyFolders(withEmpty, FOLDERS).map((g) => g.folder?.name), [
  'Client work',
  'Ideas',
  'Archive',
])

console.log('review project access: all assertions passed')
