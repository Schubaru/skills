// The projects this board can open (2026-08-13).
//
// A project IS a hand-authored canvas — pages of flows of screens, in TSX. So
// the list of what EXISTS lives here, in code; the database holds only who may
// open each one (supabase/project-access.sql), keyed by the slug below.
//
// Adding a project:
//   1. Write its config module, exporting `project: ReviewProject` with a
//      pinned `slug`.
//   2. Add an entry here.
//   3. Grant it in Manage access (/projects/access), or with a project_access
//      row. Nobody but an admin sees it until you do.
//
// ⚠ A slug is permanent. Every comment, status and event row is keyed by it,
// and the dev board file is named after it — renaming one forks the board's
// data (it happened once already; see ReviewProject.slug in model.ts).

import type { Folder, FolderItem } from "./access-rules";
import type { ReviewProject } from "./model";
import type { ScreenSeed } from "../review-seed";

/** What KIND of canvas a project is, which decides where opening it goes.
 *  - "board" — screens: a hand-authored TSX config of live frames (/review).
 *  - "flows" — flow charts: a document in the database that the people
 *    reviewing it edit directly (/flows). Added 2026-08-13 for the universal
 *    intake, where the thing being reviewed is the BRANCHING, and the reviewer
 *    needs to move it rather than comment on it. */
export type ProjectKind = "board" | "flows";

export type ProjectEntry = {
  /** Storage + grant key. Never change it. */
  slug: string;
  /** What the folder card and the board header say. */
  name: string;
  /** One line under the name on the folder card. */
  blurb: string;
  kind: ProjectKind;
  /** Loaded on demand — a board config is a large module, and opening one
   *  project shouldn't pay for the others. Absent on a "flows" project: there
   *  is no config, the database holds the diagrams. */
  load?: () => Promise<ReviewProject>;
  /** Archived (the reviewer, 2026-09-10, on cutting the Redesign project): the folder lists it
   *  under its own heading and nothing else changes — the URL still opens it, comments
   *  and grants stay keyed by the slug. Never a deletion: an old project is the record
   *  of what was tried.
   *  ⚠ Since folders landed (2026-09-18) the DATABASE is the source of truth: a
   *  project is archived when it sits in the Archive folder. This flag is the
   *  OFFLINE fallback, for a checkout with no Supabase and no folder rows to read. */
  archived?: true;
};

export const PROJECTS: ProjectEntry[] = [
  {
    slug: "__DS_PROJECT_SLUG__",
    name: "__DS_PROJECT_NAME__",
    blurb: "Every screen of the app, one flow per journey.",
    kind: "board",
    load: () => import("./review.config").then((m) => m.project),
  },
  // A second board: write its config module (copy review.config.tsx), add an
  // entry with a NEW slug, then grant it in /projects/access.
  // A flow-chart canvas: { slug, name, blurb, kind: "flows" } — no config; the
  // diagrams live in the database (src/flows/).
];

/** Where opening a project goes. The board and the canvas are different
 *  surfaces; the folder, the board header and /review all ask here rather than
 *  each deciding for themselves. */
export function hrefFor(entry: ProjectEntry): string {
  const q = `project=${encodeURIComponent(entry.slug)}`;
  return entry.kind === "flows" ? `/flows?${q}` : `/review?${q}`;
}

/** The project a bare /review or / opens. Every deep link written before
 *  projects existed (?page=, ?thread=) means this board, so it stays the
 *  default for anyone who can open it. */
export const DEFAULT_PROJECT_SLUG = "__DS_PROJECT_SLUG__";

/** What the folder card says about a project, read off its config rather than
 *  authored twice. `shot` is the screen that stands for it — the first live
 *  route on the first page, i.e. what the board itself opens on. */
export type ProjectSummary = {
  pages: number;
  screens: number;
  shot: { src: string; seed?: ScreenSeed } | null;
};

export function summarize(project: ReviewProject): ProjectSummary {
  let screens = 0;
  let shot: ProjectSummary["shot"] = null;
  for (const page of project.pages) {
    for (const flow of page.flows) {
      for (const screen of flow.screens) {
        screens++;
        // Only a `url` screen can be photographed; an `image` or `element`
        // screen is skipped rather than faked into a thumbnail.
        if (!shot && screen.source.kind === "url") shot = { src: screen.source.src, seed: screen.source.seed };
      }
    }
  }
  return { pages: project.pages.length, screens, shot };
}

export function findProject(slug: string | null | undefined): ProjectEntry | undefined {
  return PROJECTS.find((p) => p.slug === slug);
}

/** The registry filtered by what this account holds. `granted` is null in
 *  offline mode (no Supabase configured), which means no gate at all. */
export function visibleProjects(granted: string[] | null): ProjectEntry[] {
  if (granted === null) return PROJECTS;
  const set = new Set(granted);
  return PROJECTS.filter((p) => set.has(p.slug));
}

/** Which project a request resolves to, given what the account can open.
 *
 *  `wanted` is ?project=. `addressed` says the URL is pointing INTO a board
 *  (?page=, ?thread=, ?view=, ?screen= — every deep link that predates
 *  projects), which is why a multi-project account still lands on the default
 *  board instead of the folder: a shared comment link must open the comment.
 *
 *  Returns the slug to open, or null for "show the folder". */
export function resolveProject(
  visible: ProjectEntry[],
  wanted: string | null,
  addressed: boolean,
): string | null {
  if (wanted) return visible.some((p) => p.slug === wanted) ? wanted : null;
  const hasDefault = visible.some((p) => p.slug === DEFAULT_PROJECT_SLUG);
  if (addressed && hasDefault) return DEFAULT_PROJECT_SLUG;
  if (visible.length === 1) return visible[0]!.slug;
  if (visible.length === 0) return null;
  return null;
}

/** The same question, answered with the one distinction resolveProject cannot
 *  make: a slug that EXISTS but isn't yours is not the same as a slug that
 *  doesn't exist. The first deserves a door to knock on ("ask for access"), the
 *  second is a typo and belongs on the folder.
 *
 *  Kept beside resolveProject rather than folded into it: every caller of that
 *  function wants "a slug or the folder", and one of them is a redirect. */
export type ProjectRequest = { open: string } | { folder: true } | { denied: string };

export function resolveRequest(
  visible: ProjectEntry[],
  wanted: string | null,
  addressed: boolean,
): ProjectRequest {
  if (wanted && !visible.some((p) => p.slug === wanted) && findProject(wanted)) {
    return { denied: wanted };
  }
  const slug = resolveProject(visible, wanted, addressed);
  return slug ? { open: slug } : { folder: true };
}

// --- folders ----------------------------------------------------------------
//
// Folders live in the DATABASE (supabase/access-sharing.sql); the projects they
// hold live here, in code. So grouping is a join, done in one place: the folder
// page, the admin screens and anything else that lists projects ask below
// rather than each deciding what "archived" means.

/** The Archive shown when there is no folder data to read — offline, or a
 *  database where the folder migration hasn't been applied. A negative id, so
 *  it can never be mistaken for a real folder in a write. */
const OFFLINE_ARCHIVE: Folder = { id: -1, name: "Archive", isArchive: true, position: 100 };

/** One heading on the folder page. `folder` null = the unfiled projects, which
 *  come first because they are the working set. */
export type FolderGroup = { folder: Folder | null; projects: ProjectEntry[] };

/** The one order every surface lists folders in: by position, then name, and
 *  Archive last because it is the end of the road rather than a peer. Asked
 *  here by the folder page, the move menus and the admin table, so a heading
 *  and the menu row that files something under it can never disagree. */
export function orderedFolders(folders: Folder[]): Folder[] {
  return [...folders].sort(
    (a, b) =>
      Number(a.isArchive) - Number(b.isArchive) ||
      a.position - b.position ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}

/** Is this project archived? The Archive FOLDER decides, when there are
 *  folders to read; the code flag is the fallback and nothing more. */
export function isArchived(entry: ProjectEntry, folders: Folder[], items: FolderItem[]): boolean {
  if (folders.length === 0) return Boolean(entry.archived);
  const archive = folders.find((f) => f.isArchive);
  if (!archive) return false;
  return items.some((i) => i.projectSlug === entry.slug && i.folderId === archive.id);
}

/** The projects, under their headings: unfiled first, then the named folders
 *  by position and then name, and Archive last. Empty groups are dropped — a
 *  folder whose every project is closed to this account is not a heading. */
export function groupByFolder(
  projects: ProjectEntry[],
  folders: Folder[],
  items: FolderItem[],
): FolderGroup[] {
  // No folder data at all: the code flag is the only thing that knows, so it
  // produces a synthetic Archive and everything else is unfiled.
  if (folders.length === 0) {
    const live = projects.filter((p) => !p.archived);
    const old = projects.filter((p) => p.archived);
    const groups: FolderGroup[] = [];
    if (live.length > 0) groups.push({ folder: null, projects: live });
    if (old.length > 0) groups.push({ folder: OFFLINE_ARCHIVE, projects: old });
    return groups;
  }

  const where = new Map(items.map((i) => [i.projectSlug, i.folderId]));
  const known = new Map(folders.map((f) => [f.id, f]));
  const unfiled: ProjectEntry[] = [];
  const filed = new Map<number, ProjectEntry[]>();
  for (const p of projects) {
    const id = where.get(p.slug);
    // A project filed in a folder this account can't see is shown unfiled
    // rather than hidden: it holds the project, and a heading it can't read is
    // not a reason to lose the card.
    if (id === undefined || !known.has(id)) unfiled.push(p);
    else filed.set(id, [...(filed.get(id) ?? []), p]);
  }

  const ordered = orderedFolders(folders);

  const groups: FolderGroup[] = [];
  if (unfiled.length > 0) groups.push({ folder: null, projects: unfiled });
  for (const folder of ordered) {
    const held = filed.get(folder.id);
    if (held && held.length > 0) groups.push({ folder, projects: held });
  }
  return groups;
}

/** The same groups, with the empty folders put back. For ADMINS only: a folder
 *  they just made holds nothing, and a heading that vanishes until something is
 *  dropped into it is a folder nobody can use. For everyone else an empty
 *  heading is noise, which is why groupByFolder drops them.
 *
 *  Order is groupByFolder's own — unfiled, then by position and name, Archive
 *  last — so an added heading lands where it will sit once it is filled. */
export function withEmptyFolders(groups: FolderGroup[], folders: Folder[]): FolderGroup[] {
  if (folders.length === 0) return groups;
  const filled = new Map(groups.filter((g) => g.folder).map((g) => [g.folder!.id, g]));
  const unfiled = groups.find((g) => !g.folder);
  const out: FolderGroup[] = unfiled ? [unfiled] : [];
  for (const folder of orderedFolders(folders)) {
    out.push(filled.get(folder.id) ?? { folder, projects: [] });
  }
  return out;
}
