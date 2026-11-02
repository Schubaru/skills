// The access RULES, with no Supabase import — so the part that decides who
// sees what can be run and asserted on its own (access.test.ts). The queries
// live next door in access.ts; the enforcement lives in Postgres
// (supabase/project-access.sql), and that is the authority. These helpers
// answer the admin screen's question: what will this rule DO?

/** A rule granting one project. `value` is null only for `all`. */
export type ProjectGrant = {
  id: number;
  projectSlug: string;
  kind: "all" | "domain" | "email";
  value: string | null;
  note: string | null;
};

/** A row of the sign-in allowlist — who may reach the preview at all. */
export type AccessRule = {
  id: number;
  kind: "domain" | "email";
  value: string;
  note: string | null;
  /** May edit access (any __DS_ADMIN_DOMAIN__ address, by default). */
  isAdmin: boolean;
  /** The name to put on this person's comments before they have signed in and
   *  named themselves. Only meaningful on an `email` row. */
  displayName: string | null;
};

/** One row of a project's people list (public.project_members). A grant, plus
 *  whatever name we know for it. */
export type ProjectMember = {
  id: number;
  kind: "all" | "domain" | "email";
  value: string | null;
  note: string | null;
  displayName: string | null;
};

/** A folder (public.project_folders). Flat, one level; a project is in one
 *  folder or none. ARCHIVE is the one built-in: it cannot be renamed, deleted
 *  or shared, and a folder grant never reaches into it. */
export type Folder = {
  id: number;
  name: string;
  isArchive: boolean;
  position: number;
  /** The caller holds this folder (so may share it), not merely a project filed in it. */
  held?: boolean;
};

/** Where one project is filed. Absent = unfiled. */
export type FolderItem = {
  projectSlug: string;
  folderId: number;
};

/** A rule granting one folder, and so every project in it — now and later.
 *  Same three kinds as a project grant. */
export type FolderGrant = {
  id: number;
  folderId: number;
  kind: "all" | "domain" | "email";
  value: string | null;
  note: string | null;
};

/** Someone asking to be let in. `projectSlug` null = "let me sign in at all". */
export type AccessRequest = {
  id: number;
  email: string;
  name: string | null;
  projectSlug: string | null;
  message: string | null;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
};

/** Where a request lands until there is somewhere better to send it. One
 *  address on purpose: nobody else has asked to be woken up. */
export const ACCESS_REQUEST_INBOX = "__DS_ADMIN_INBOX__";

export function emailDomain(email: string): string {
  return email.toLowerCase().split("@")[1] ?? "";
}

/** Does this rule apply to this address? Same shape as the SQL predicate.
 *  ⚠ Answers "does the rule match", never "is this person allowed in" — the
 *  SQL also requires is_email_allowed(), so a project grant can never widen
 *  who can sign in. */
export function matchesRule(rule: { kind: string; value: string | null }, email: string): boolean {
  const e = email.toLowerCase();
  if (rule.kind === "all") return true;
  if (rule.kind === "domain") return Boolean(rule.value) && rule.value === emailDomain(e);
  if (rule.kind === "email") return rule.value === e;
  return false;
}

/** The slugs these grants give this address, ignoring admin status. Used by the
 *  admin screen to answer "what does this person actually see?" — the effect of
 *  a change, shown before it is trusted. */
export function grantsFor(grants: ProjectGrant[], email: string): string[] {
  return [...new Set(grants.filter((g) => matchesRule(g, email)).map((g) => g.projectSlug))];
}

/** The slugs these FOLDER grants give this address. Archive is excluded in the
 *  one place it matters: a folder grant must never become a key to retired
 *  work, and can_access_project() draws the same line in SQL. */
export function folderGrantsFor(
  folderGrants: FolderGrant[],
  items: FolderItem[],
  folders: Folder[],
  email: string,
): string[] {
  const open = new Set(
    folders.filter((f) => !f.isArchive).map((f) => f.id),
  );
  const held = new Set(
    folderGrants.filter((g) => open.has(g.folderId) && matchesRule(g, email)).map((g) => g.folderId),
  );
  return [...new Set(items.filter((i) => held.has(i.folderId)).map((i) => i.projectSlug))];
}

/** WHY this person sees this project. One reason per slug, the strongest
 *  first: a direct grant outranks a folder, because it survives the project
 *  being moved. What the admin screens answer with, rather than a bare list. */
export type GrantReason = {
  slug: string;
  via: "everyone" | "domain" | "email" | "folder";
  /** Set only on `folder`. */
  folderId?: number;
};

/** Project grants and folder grants, unioned and explained. Admin status is
 *  NOT folded in: an admin holds everything, which is a fact about the account
 *  and not about these rules. */
export function effectiveGrantsFor(
  grants: ProjectGrant[],
  folderGrants: FolderGrant[],
  items: FolderItem[],
  folders: Folder[],
  email: string,
): GrantReason[] {
  const out: GrantReason[] = [];
  const seen = new Set<string>();
  for (const g of grants) {
    if (!matchesRule(g, email) || seen.has(g.projectSlug)) continue;
    seen.add(g.projectSlug);
    out.push({ slug: g.projectSlug, via: g.kind === "all" ? "everyone" : g.kind });
  }
  const open = new Set(folders.filter((f) => !f.isArchive).map((f) => f.id));
  const held = new Set(
    folderGrants.filter((g) => open.has(g.folderId) && matchesRule(g, email)).map((g) => g.folderId),
  );
  for (const item of items) {
    if (!held.has(item.folderId) || seen.has(item.projectSlug)) continue;
    seen.add(item.projectSlug);
    out.push({ slug: item.projectSlug, via: "folder", folderId: item.folderId });
  }
  return out;
}

/** Who gains a project the moment it is moved into this folder — the sentence
 *  the confirm dialog needs before an admin changes who can see a board.
 *  `open` is the everyone switch; `people` counts named addresses. Archive
 *  holds no grants, so moving there always reads as nobody. */
export function movePreview(
  folderGrants: FolderGrant[],
  folder: Folder,
): { open: boolean; domains: string[]; people: number } {
  if (folder.isArchive) return { open: false, domains: [], people: 0 };
  const mine = folderGrants.filter((g) => g.folderId === folder.id);
  return {
    open: mine.some((g) => g.kind === "all"),
    domains: [...new Set(mine.filter((g) => g.kind === "domain" && g.value).map((g) => g.value!))],
    people: new Set(mine.filter((g) => g.kind === "email" && g.value).map((g) => g.value!)).size,
  };
}

/** The move preview as the sentence a person reads. Kept beside movePreview()
 *  rather than written into each screen: the folder page and the admin table
 *  ask the same question and must not answer it in two voices. Returns null
 *  when nothing changes hands, which is the caller's cue to move without
 *  asking. */
export function movePreviewLine(
  preview: { open: boolean; domains: string[]; people: number },
  folderName: string,
): string | null {
  const parts: string[] = [];
  if (preview.open) parts.push("everyone who can sign in");
  for (const d of preview.domains) parts.push(`everyone at ${d}`);
  if (preview.people) parts.push(`${preview.people} ${preview.people === 1 ? "person" : "people"}`);
  if (parts.length === 0) return null;
  const who =
    parts.length === 1
      ? parts[0]!
      : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]!}`;
  return `Moving this into “${folderName}” shares it with ${who}.`;
}

/** What to ask before a move, or null for "just do it". Archive is its own
 *  sentence: it takes folder access away rather than giving it, and the
 *  project's own grants are untouched — saying so is the whole point, because
 *  an admin filing something away should know what they have not done. */
export function moveConfirmText(
  folder: Folder | null,
  folderGrants: FolderGrant[],
): string | null {
  if (!folder) return null;
  if (folder.isArchive) {
    return "Move this to Archive? It stops being shared through any folder. Its own access is untouched.";
  }
  const line = movePreviewLine(movePreview(folderGrants, folder), folder.name);
  return line ? `${line} Move it there?` : null;
}

/** What to ask before a folder is deleted. Two screens can do it, so the
 *  sentence is written once: what it does NOT do is the load-bearing half. */
export function deleteFolderConfirm(name: string): string {
  return (
    `Delete the folder “${name}”? The projects inside become unfiled. ` +
    "Nobody loses access a project grants directly."
  );
}

// --- one field, two kinds of thing ------------------------------------------

/** What someone typed into the add field, once we know what it is. */
export type AccessEntry = {
  kind: "email" | "domain";
  value: string;
  /** A name typed alongside an address, e.g. `Jane Doe <jane@client.example>`. */
  name?: string;
};

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]+$/;

/** Reduce a typed host to a bare domain: no scheme, no path, no port, no www. */
function toDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.split(":")[0] ?? "";
  s = s.replace(/^www\./, "");
  s = s.replace(/\.$/, "");
  return DOMAIN.test(s) ? s : null;
}

/** One line of the add field. Returns null rather than guessing: an entry we
 *  can't name is shown back to the person, never quietly turned into a grant
 *  for something they didn't type. */
export function parseAccessEntry(input: string): AccessEntry | null {
  let s = (input ?? "").trim();
  if (!s) return null;

  // `Jane Doe <jane@client.example>` — the shape a mail client hands you.
  let name: string | undefined;
  const angled = s.match(/^(.*)<([^<>]+)>$/);
  if (angled) {
    name = angled[1]!.trim().replace(/^["']|["']$/g, "").trim() || undefined;
    s = angled[2]!.trim();
  }
  if (!s || /\s/.test(s)) return null;

  s = s.toLowerCase();

  // A leading @ means "the whole domain", which is how people write it.
  if (s.startsWith("@")) {
    const d = toDomain(s.slice(1));
    return d ? { kind: "domain", value: d } : null;
  }

  if (s.includes("@")) {
    const at = s.lastIndexOf("@");
    const local = s.slice(0, at);
    const domain = toDomain(s.slice(at + 1));
    if (!local || !LOCAL.test(local) || local.includes("..") || !domain) return null;
    return name ? { kind: "email", value: `${local}@${domain}`, name } : { kind: "email", value: `${local}@${domain}` };
  }

  const d = toDomain(s);
  return d ? { kind: "domain", value: d } : null;
}

/** A pasted list. Splits on commas, semicolons and newlines, keeps the first
 *  of any duplicate, and hands back what it couldn't read so the UI can say so
 *  instead of dropping it silently. */
export function parseAccessEntries(input: string): { entries: AccessEntry[]; rejected: string[] } {
  const entries: AccessEntry[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const raw of (input ?? "").split(/[,;\n\r]+/)) {
    const piece = raw.trim();
    if (!piece) continue;
    const entry = parseAccessEntry(piece);
    if (!entry) {
      rejected.push(piece);
      continue;
    }
    const key = `${entry.kind}:${entry.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return { entries, rejected };
}

/** Could this entry already sign in? Mirrors share_project()'s guardrail, so
 *  the screen can say "ask an admin" before the round trip rather than after
 *  the exception. ⚠ The SQL is the authority; this only predicts it. */
export function isDomainAllowed(rules: AccessRule[], entry: AccessEntry): boolean {
  const value = entry.value.toLowerCase();
  if (entry.kind === "domain") {
    return rules.some((r) => r.kind === "domain" && r.value.toLowerCase() === value);
  }
  const domain = emailDomain(value);
  return rules.some(
    (r) =>
      (r.kind === "email" && r.value.toLowerCase() === value) ||
      (r.kind === "domain" && Boolean(domain) && r.value.toLowerCase() === domain),
  );
}

/** May this account manage access for this project? There is ONE level: being
 *  on a project is being able to share it (supabase/access-sharing.sql). An
 *  admin holds every project, and offline (`slugs` null) there is no gate at
 *  all. Before the answer arrives nobody gets the control, so it doesn't
 *  flicker in.
 *  ⚠ A convenience for rendering, not the gate — the SQL functions re-check. */
export function canShare(
  access: { loading: boolean; slugs: string[] | null; isAdmin: boolean },
  slug: string,
): boolean {
  if (access.loading) return false;
  if (access.isAdmin || access.slugs === null) return true;
  return access.slugs.includes(slug);
}
