// Who can open which project (2026-08-13). Pairs with supabase/project-access.sql.
//
// TWO LAYERS, and it matters which is the authority:
//   - The DATABASE decides. RLS gates every board row on can_access_project(),
//     so a hidden project is unreadable, not just unlisted.
//   - This file ASKS. my_project_slugs() answers about the caller alone; the
//     app intersects the answer with the code-defined registry (projects.ts).
//
// The rules themselves live in access-rules.ts — no Supabase import there, so
// the part that decides who sees what stays runnable in a test.

import { getSupabase, isRemoteConfigured } from "../auth/client";
import type {
  AccessEntry,
  AccessRequest,
  AccessRule,
  Folder,
  FolderGrant,
  FolderItem,
  ProjectGrant,
  ProjectMember,
} from "./access-rules";

export { isRemoteConfigured };
export {
  ACCESS_REQUEST_INBOX,
  deleteFolderConfirm,
  effectiveGrantsFor,
  emailDomain,
  folderGrantsFor,
  grantsFor,
  isDomainAllowed,
  matchesRule,
  moveConfirmText,
  movePreview,
  movePreviewLine,
  parseAccessEntries,
  parseAccessEntry,
} from "./access-rules";
export type {
  AccessEntry,
  AccessRequest,
  AccessRule,
  Folder,
  FolderGrant,
  FolderItem,
  GrantReason,
  ProjectGrant,
  ProjectMember,
} from "./access-rules";

// --- what the signed-in caller holds ---------------------------------------

/** Slugs the caller can open, or null when running offline (no Supabase env),
 *  which means "no gate at all" — local design work opens every project. */
export async function fetchMyProjectSlugs(): Promise<string[] | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("my_project_slugs");
  if (error) {
    // Before the migration is applied the function doesn't exist. Fail OPEN to
    // the pre-permissions behaviour rather than locking everyone out of a board
    // they could open yesterday — the RLS half of this feature lands in the
    // same window, so an unmigrated database has nothing to protect yet.
    console.warn("[access] my_project_slugs unavailable — treating as unrestricted", error.message);
    return null;
  }
  return (data ?? []).map((row: unknown) => (typeof row === "string" ? row : String((row as { my_project_slugs?: string })?.my_project_slugs ?? "")));
}

export async function fetchIsAdmin(): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return true; // offline: no accounts, so no one to keep out
  const { data, error } = await sb.rpc("my_is_admin");
  if (error) return false;
  return data === true;
}

// --- admin: the sign-in allowlist ------------------------------------------

type AccessRuleRow = {
  id: number;
  kind: string;
  value: string;
  note: string | null;
  is_admin: boolean;
  display_name?: string | null;
};
type GrantRow = { id: number; project_slug: string; kind: string; value: string | null; note: string | null };

const RULE_COLUMNS = "id, kind, value, note, is_admin, display_name";
/** Before access-sharing.sql is applied there is no display_name column, and
 *  asking for one fails the whole select. Every read of the table falls back to
 *  the pre-migration shape rather than showing an empty list. */
const RULE_COLUMNS_LEGACY = "id, kind, value, note, is_admin";

function toRule(r: AccessRuleRow): AccessRule {
  return {
    id: r.id,
    kind: r.kind === "email" ? "email" : "domain",
    value: r.value,
    note: r.note,
    isAdmin: Boolean(r.is_admin),
    displayName: r.display_name ?? null,
  };
}

export async function fetchAccessRules(): Promise<AccessRule[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const first = await sb.from("access_rules").select(RULE_COLUMNS).order("kind").order("value");
  const res = first.error
    ? await sb.from("access_rules").select(RULE_COLUMNS_LEGACY).order("kind").order("value")
    : first;
  if (res.error || !res.data) return [];
  return (res.data as unknown as AccessRuleRow[]).map(toRule);
}

export async function addAccessRule(rule: {
  kind: "domain" | "email";
  value: string;
  note?: string;
  isAdmin?: boolean;
  displayName?: string;
}): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const base = {
    kind: rule.kind,
    value: rule.value.trim().toLowerCase(),
    note: rule.note?.trim() || null,
    is_admin: Boolean(rule.isAdmin),
  };
  const name = rule.displayName?.trim() || null;
  const row = name ? ({ ...base, display_name: name } as typeof base) : base;
  const { error } = await sb.from("access_rules").insert(row);
  // Unmigrated database: the row is still worth having without the name.
  if (error && name) {
    const retry = await sb.from("access_rules").insert(base);
    return retry.error ? retry.error.message : null;
  }
  return error ? error.message : null;
}

export async function setRuleAdmin(id: number, isAdmin: boolean): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.from("access_rules").update({ is_admin: isAdmin }).eq("id", id);
  return error ? error.message : null;
}

/** Rename a person on the sign-in list. The name is a courtesy, not an
 *  identity: whatever they type when they sign in still wins on their
 *  comments (review_people). Empty clears it back to nothing. */
export async function setRuleDisplayName(id: number, name: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb
    .from("access_rules")
    .update({ display_name: name.trim() || null })
    .eq("id", id);
  return error ? error.message : null;
}

export async function removeAccessRule(id: number): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.from("access_rules").delete().eq("id", id);
  return error ? error.message : null;
}

// --- admin: project grants --------------------------------------------------

export async function fetchProjectGrants(): Promise<ProjectGrant[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("project_access")
    .select("id, project_slug, kind, value, note")
    .order("project_slug")
    .order("kind");
  if (error || !data) return [];
  return (data as GrantRow[]).map((r) => ({
    id: r.id,
    projectSlug: r.project_slug,
    kind: r.kind === "all" ? "all" : r.kind === "email" ? "email" : "domain",
    value: r.value,
    note: r.note,
  }));
}

export async function addProjectGrant(grant: {
  projectSlug: string;
  kind: "all" | "domain" | "email";
  value?: string;
  note?: string;
}): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const email = (await sb.auth.getUser()).data.user?.email ?? null;
  const { error } = await sb.from("project_access").insert({
    project_slug: grant.projectSlug,
    kind: grant.kind,
    value: grant.kind === "all" ? null : (grant.value ?? "").trim().toLowerCase(),
    note: grant.note?.trim() || null,
    created_by: email,
  });
  return error ? error.message : null;
}

export async function removeProjectGrant(id: number): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.from("project_access").delete().eq("id", id);
  return error ? error.message : null;
}

// --- sharing: anyone on a project, not just admins --------------------------
//
// Every call below is an RPC, never a table write: project_access stays
// admin-only at the table level, and the functions in supabase/access-sharing.sql
// derive the caller from the JWT. So the guardrail (a non-admin can only invite
// someone who could already sign in) lives in one place — Postgres — and this
// file only carries the message back.

type MemberRow = { id: number; kind: string; value: string | null; note: string | null; display_name: string | null };
type RequestRow = {
  id: number;
  email: string;
  name: string | null;
  project_slug: string | null;
  message: string | null;
  status: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
};

function toMemberKind(kind: string): ProjectMember["kind"] {
  return kind === "all" ? "all" : kind === "email" ? "email" : "domain";
}

/** Who is on a project. Empty offline, and empty when the caller can't open it
 *  — the function raises in that case, which is the point. */
export async function fetchProjectMembers(slug: string): Promise<ProjectMember[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.rpc("project_members", { slug });
  if (error || !data) return [];
  return (data as MemberRow[]).map((r) => ({
    id: r.id,
    kind: toMemberKind(r.kind),
    value: r.value,
    note: r.note,
    displayName: r.display_name ?? null,
  }));
}

export async function shareProject(slug: string, entry: AccessEntry): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("share_project", {
    slug,
    kind: entry.kind,
    value: entry.value,
    display_name: entry.name ?? null,
  });
  return error ? error.message : null;
}

export async function unshareProject(id: number): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("unshare_project", { grant_id: id });
  return error ? error.message : null;
}

export async function setProjectOpen(slug: string, open: boolean): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("set_project_open", { slug, open });
  return error ? error.message : null;
}

export async function requestProjectAccess(slug: string, message?: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("request_project_access", { slug, message: message?.trim() || null });
  return error ? error.message : null;
}

/** Requests the caller is allowed to see. `slug` narrows to one project; left
 *  off, it is every request the RLS policy lets through — your own, and every
 *  project you can open. */
export async function fetchAccessRequests(slug?: string): Promise<AccessRequest[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let q = sb
    .from("access_requests")
    .select("id, email, name, project_slug, message, status, created_at, decided_by, decided_at")
    .order("created_at", { ascending: false });
  if (slug) q = q.eq("project_slug", slug);
  const { data, error } = await q;
  if (error || !data) return [];
  return (data as RequestRow[]).map((r) => ({
    id: r.id,
    email: r.email,
    name: r.name,
    projectSlug: r.project_slug,
    message: r.message,
    status: r.status === "approved" ? "approved" : r.status === "denied" ? "denied" : "pending",
    createdAt: r.created_at,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
  }));
}

export async function decideAccessRequest(id: number, approve: boolean): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("decide_access_request", { request_id: id, approve });
  if (error) return error.message;
  if (!approve) return null;
  // Tell the requester. Best effort: the grant is already in, and the function
  // re-reads the row, so a failed email changes nothing about who has access.
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (token) {
      await fetch(`${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1/request-access`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ decidedRequestId: id }),
      });
    }
  } catch {
    // ignored on purpose, see above
  }
  return null;
}

// --- folders ----------------------------------------------------------------
//
// Reads are RPCs that answer about the CALLER alone, so a folder nobody has
// shared with you is not even a name you can learn. Writes are RPCs for the
// same reason project sharing is: the guardrail lives in Postgres.
//
// ⚠ Every read below is tolerant of a database where the folder migration has
// not been applied yet — a missing function returns [], which the app reads as
// "no folders", falling back to the code `archived` flag. Silence rather than
// an error page: folders are a grouping, and a board still opens without them.

type FolderRow = { id: number; name: string; is_archive: boolean; position: number };
type FolderItemRow = { project_slug: string; folder_id: number };
type FolderGrantRow = { id: number; folder_id: number; kind: string; value: string | null; note: string | null };

function toGrantKind(kind: string): FolderGrant["kind"] {
  return kind === "all" ? "all" : kind === "email" ? "email" : "domain";
}

/** The folders the caller can see, already in the order to list them. */
export async function fetchMyFolders(): Promise<Folder[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.rpc("my_folders");
  if (error || !data) return [];
  return (data as FolderRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    isArchive: Boolean(r.is_archive),
    position: r.position ?? 0,
    held: Boolean((r as { held?: boolean }).held),
  }));
}

/** Where each project the caller can open is filed. */
export async function fetchMyFolderItems(): Promise<FolderItem[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.rpc("my_folder_items");
  if (error || !data) return [];
  return (data as FolderItemRow[]).map((r) => ({ projectSlug: r.project_slug, folderId: r.folder_id }));
}

/** Every folder grant there is — admins only, the same posture as
 *  fetchProjectGrants(). RLS returns nothing to anyone else. */
export async function fetchFolderGrants(): Promise<FolderGrant[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("folder_access")
    .select("id, folder_id, kind, value, note")
    .order("folder_id")
    .order("kind");
  if (error || !data) return [];
  return (data as FolderGrantRow[]).map((r) => ({
    id: r.id,
    folderId: r.folder_id,
    kind: toGrantKind(r.kind),
    value: r.value,
    note: r.note,
  }));
}

/** Who is on a folder. Empty offline, and empty when the caller doesn't hold
 *  it — the function raises in that case, which is the point. */
export async function fetchFolderMembers(id: number): Promise<ProjectMember[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb.rpc("folder_members", { folder_id: id });
  if (error || !data) return [];
  return (data as MemberRow[]).map((r) => ({
    id: r.id,
    kind: toMemberKind(r.kind),
    value: r.value,
    note: r.note,
    displayName: r.display_name ?? null,
  }));
}

export async function shareFolder(id: number, entry: AccessEntry): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("share_folder", {
    folder_id: id,
    kind: entry.kind,
    value: entry.value,
    display_name: entry.name ?? null,
  });
  return error ? error.message : null;
}

export async function unshareFolder(grantId: number): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("unshare_folder", { grant_id: grantId });
  return error ? error.message : null;
}

export async function setFolderOpen(id: number, open: boolean): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("set_folder_open", { folder_id: id, open });
  return error ? error.message : null;
}

// Managing the folders themselves is admin-only in the database; these carry
// the refusal back rather than pre-judging it.

export async function createFolder(name: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("create_folder", { name: name.trim() });
  return error ? error.message : null;
}

/** Make a folder and file one project in it, as one gesture: the "New folder"
 *  row inside a project's Move to menu. A failed move leaves the (empty)
 *  folder behind on purpose; it is visible, and deleting it is one click. */
export async function createFolderWith(name: string, slug: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { data, error } = await sb.rpc("create_folder", { name: name.trim() });
  if (error) return error.message;
  const id = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(id)) return "The folder was made, but the project could not be moved into it.";
  return moveProject(slug, id);
}

export async function renameFolder(id: number, name: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("rename_folder", { folder_id: id, name: name.trim() });
  return error ? error.message : null;
}

export async function deleteFolder(id: number): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("delete_folder", { folder_id: id });
  return error ? error.message : null;
}

/** File a project, or un-file it (`null`). This is the call that changes who
 *  can see a board, which is why the database keeps it to admins. */
export async function moveProject(slug: string, folderId: number | null): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return "Not connected";
  const { error } = await sb.rpc("move_project", { slug, folder_id: folderId });
  return error ? error.message : null;
}

/** The name to put in the comment box before this person has typed one. */
export async function fetchMyDefaultName(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.rpc("my_default_name");
  if (error) return null;
  return typeof data === "string" && data.trim() ? data : null;
}
