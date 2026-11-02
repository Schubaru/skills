// Everything the manage-access console reads, asked once and shared by all
// three tabs (2026-09-18).
//
// The console is a WINDOW onto four tables, never a second opinion about them:
//   access_rules     who can sign in at all, and who administers access
//   project_access   who can open which project
//   access_requests  who has asked
//   review_people    the names people gave themselves when they signed in
// Postgres decides (supabase/project-access.sql, supabase/access-sharing.sql).
// Every mutation here re-reads rather than patching state in place, so a refusal
// leaves the screen showing what is true rather than what was attempted.

import { useCallback, useEffect, useState } from "react";
import {
  effectiveGrantsFor,
  emailDomain,
  fetchAccessRequests,
  fetchAccessRules,
  fetchFolderGrants,
  fetchMyFolderItems,
  fetchMyFolders,
  fetchProjectGrants,
  type AccessRequest,
  type AccessRule,
  type Folder,
  type FolderGrant,
  type FolderItem,
  type ProjectGrant,
} from "../access";
import { fetchPeople } from "../db";
import { orderedFolders, PROJECTS, type ProjectEntry } from "../projects";

// The folder order is one rule, and it lives with the grouping it belongs to.
export { orderedFolders };

export type Directory = { email: string; name: string }[];

export type AdminData = {
  loading: boolean;
  /** Null when the read failed outright. Empty is a real answer: a database
   *  where the migration has not been applied yet. */
  rules: AccessRule[];
  grants: ProjectGrant[];
  requests: AccessRequest[];
  people: Directory;
  /** The folders, where each project is filed, and who holds each folder. An
   *  admin reads all three (my_folders() answers about the caller, and an
   *  admin holds everything), so the console can say what a folder gives
   *  before a project is moved into it. */
  folders: Folder[];
  items: FolderItem[];
  folderGrants: FolderGrant[];
  error: string | null;
  busy: boolean;
  reload: () => Promise<void>;
  /** Run one mutation, report its refusal, then re-read. */
  run: (fn: () => Promise<string | null>) => Promise<void>;
};

export function useAdminData(): AdminData {
  const [rules, setRules] = useState<AccessRule[]>([]);
  const [grants, setGrants] = useState<ProjectGrant[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [people, setPeople] = useState<Directory>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<FolderItem[]>([]);
  const [folderGrants, setFolderGrants] = useState<FolderGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [r, g, q, p, f, i, fg] = await Promise.all([
      fetchAccessRules(),
      fetchProjectGrants(),
      fetchAccessRequests(),
      fetchPeople(),
      fetchMyFolders(),
      fetchMyFolderItems(),
      fetchFolderGrants(),
    ]);
    setRules(r);
    setGrants(g);
    setRequests(q);
    setPeople(p ?? []);
    setFolders(f);
    setItems(i);
    setFolderGrants(fg);
    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (fn: () => Promise<string | null>) => {
      setBusy(true);
      setError(null);
      const err = await fn();
      if (err) setError(err);
      await reload();
      setBusy(false);
    },
    [reload],
  );

  return { loading, rules, grants, requests, people, folders, items, folderGrants, error, busy, reload, run };
}

// --- reading the two lists back --------------------------------------------

/** One line of the Users table. A `rule` row is editable (it exists in
 *  access_rules); a `directory` row is somebody who signed in under a domain
 *  rule, so there is nothing of theirs to edit, only to show. */
export type UserRow = {
  key: string;
  kind: "email" | "domain" | "directory";
  /** The rule behind this row, absent on a directory row. */
  rule: AccessRule | null;
  name: string;
  /** The address or domain, as typed. */
  value: string;
  /** For a directory row: the domain rule that lets them in. */
  via: string | null;
  isAdmin: boolean;
  /** Slugs this row holds, admins excepted (they hold everything). A project
   *  held only through a FOLDER counts: it is a project they can open, and the
   *  Users tab is answering what they see, not how. */
  slugs: string[];
};

/** The name we know for an address: what they typed when they signed in wins
 *  over what an admin typed for them, because it is theirs. */
export function nameFor(email: string, people: Directory, rules: AccessRule[]): string {
  const e = email.toLowerCase();
  const person = people.find((p) => p.email === e);
  if (person && person.name.trim()) return person.name.trim();
  const rule = rules.find((r) => r.kind === "email" && r.value.toLowerCase() === e);
  if (rule?.displayName?.trim()) return rule.displayName.trim();
  return "";
}

export function projectNames(slugs: string[]): ProjectEntry[] {
  return PROJECTS.filter((p) => slugs.includes(p.slug));
}

export function buildUserRows(
  rules: AccessRule[],
  grants: ProjectGrant[],
  people: Directory,
  folderGrants: FolderGrant[],
  items: FolderItem[],
  folders: Folder[],
): UserRow[] {
  const rows: UserRow[] = [];
  const claimed = new Set<string>();
  const held = (email: string) =>
    effectiveGrantsFor(grants, folderGrants, items, folders, email).map((r) => r.slug);

  for (const rule of rules) {
    const isEmail = rule.kind === "email";
    if (isEmail) claimed.add(rule.value.toLowerCase());
    const sample = isEmail ? rule.value : `someone@${rule.value}`;
    rows.push({
      key: `rule-${rule.id}`,
      kind: rule.kind,
      rule,
      name: isEmail ? nameFor(rule.value, people, rules) : `Everyone at ${rule.value}`,
      value: rule.value,
      via: null,
      isAdmin: rule.isAdmin,
      slugs: held(sample),
    });
  }

  // Somebody who signed in under a domain rule has no row of their own in
  // access_rules. They are still a person with access, so the table says so
  // and names the rule that lets them in.
  const domains = new Map(rules.filter((r) => r.kind === "domain").map((r) => [r.value.toLowerCase(), r]));
  for (const person of people) {
    if (claimed.has(person.email)) continue;
    const rule = domains.get(emailDomain(person.email));
    if (!rule) continue;
    rows.push({
      key: `person-${person.email}`,
      kind: "directory",
      rule: null,
      name: person.name,
      value: person.email,
      via: rule.value,
      isAdmin: rule.isAdmin,
      slugs: held(person.email),
    });
  }

  return rows.sort((a, b) => {
    if (a.kind === "domain" && b.kind !== "domain") return -1;
    if (b.kind === "domain" && a.kind !== "domain") return 1;
    return (a.name || a.value).localeCompare(b.name || b.value);
  });
}

export function matchesSearch(row: UserRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${row.name} ${row.value} ${row.via ?? ""}`.toLowerCase().includes(q);
}

// --- what a project's access adds up to -------------------------------------

/** "Who can open it", said the same way wherever it is asked. A project and a
 *  folder are the same three kinds of grant, so they get one sentence rather
 *  than two tables that eventually word it differently. */
function summarizeGrants(grants: { kind: string; value: string | null }[]): string {
  if (grants.some((g) => g.kind === "all")) return "Everyone who can sign in";
  const domains = grants.filter((g) => g.kind === "domain" && g.value).map((g) => label(g.value!));
  const people = grants.filter((g) => g.kind === "email").length;
  const parts: string[] = [];
  if (domains.length) parts.push(domains.join(", "));
  if (people) parts.push(`${people} ${people === 1 ? "person" : "people"}`);
  return parts.length ? parts.join(" + ") : "Admins only";
}

/** The Projects tab's one-line summary, derived rather than authored. */
export function accessSummary(grants: ProjectGrant[], slug: string): string {
  return summarizeGrants(grants.filter((g) => g.projectSlug === slug));
}

/** __DS_ADMIN_DOMAIN__ reads as the studio in a summary line. The raw domain is still on
 *  the project's own page, where the exact rule matters. */
function label(domain: string): string {
  const first = domain.split(".")[0] ?? domain;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

export function pendingFor(requests: AccessRequest[], slug: string | null): number {
  return requests.filter((r) => r.status === "pending" && r.projectSlug === slug).length;
}

export function pendingCount(requests: AccessRequest[]): number {
  return requests.filter((r) => r.status === "pending").length;
}

// --- why one person holds one project ---------------------------------------

export type HoldReason =
  | { via: "admin" }
  | { via: "everyone"; grantId: number }
  | { via: "domain"; domain: string; grantId: number }
  | { via: "direct"; grantId: number }
  | { via: "folder"; folder: string }
  | { via: "none" };

/** The email a rule stands for, for asking the shared grant helpers about it.
 *  A domain rule is asked about as a typical member of it. */
function sampleAddress(rule: AccessRule): string {
  return rule.kind === "email" ? rule.value.toLowerCase() : `someone@${rule.value.toLowerCase()}`;
}

/** How this rule comes to hold this project, if it does. Direct is last on
 *  purpose: it is the only one this screen can toggle, and saying "via the
 *  client.example rule" is more useful than saying "yes" twice.
 *
 *  A FOLDER is checked last of all, because it is the weakest claim: it lasts
 *  only as long as the project stays in that folder. */
export function holdReason(
  rule: AccessRule,
  grants: ProjectGrant[],
  slug: string,
  folderGrants: FolderGrant[] = [],
  items: FolderItem[] = [],
  folders: Folder[] = [],
): HoldReason {
  if (rule.isAdmin) return { via: "admin" };
  const mine = grants.filter((g) => g.projectSlug === slug);
  const all = mine.find((g) => g.kind === "all");
  if (all) return { via: "everyone", grantId: all.id };
  const value = rule.value.toLowerCase();
  const domain = rule.kind === "email" ? emailDomain(value) : value;
  if (rule.kind === "email") {
    const direct = mine.find((g) => g.kind === "email" && (g.value ?? "").toLowerCase() === value);
    if (direct) return { via: "direct", grantId: direct.id };
    const byDomain = mine.find((g) => g.kind === "domain" && (g.value ?? "").toLowerCase() === domain);
    if (byDomain) return { via: "domain", domain, grantId: byDomain.id };
  } else {
    const direct = mine.find((g) => g.kind === "domain" && (g.value ?? "").toLowerCase() === value);
    if (direct) return { via: "direct", grantId: direct.id };
  }

  const byFolder = effectiveGrantsFor(grants, folderGrants, items, folders, sampleAddress(rule)).find(
    (r) => r.slug === slug && r.via === "folder",
  );
  const folder = byFolder ? folders.find((f) => f.id === byFolder.folderId) : undefined;
  return folder ? { via: "folder", folder: folder.name } : { via: "none" };
}

export function reasonLabel(reason: HoldReason): string {
  switch (reason.via) {
    case "admin":
      return "Administers access, so holds every project";
    case "everyone":
      return "Open to everyone who can sign in";
    case "domain":
      return `Through the ${reason.domain} rule`;
    case "direct":
      return "Added to this project";
    case "folder":
      return `Through the folder “${reason.folder}”`;
    default:
      return "Not on this project";
  }
}

// --- folders ----------------------------------------------------------------

/** Does this rule hold this folder directly, and through which grant? The
 *  folder checklist on a person's page toggles exactly this one row; a grant
 *  that came from somewhere else is not this screen's to undo. */
export function folderHold(rule: AccessRule, folderGrants: FolderGrant[], folderId: number): FolderGrant | null {
  const value = rule.value.toLowerCase();
  return (
    folderGrants.find(
      (g) => g.folderId === folderId && g.kind === rule.kind && (g.value ?? "").toLowerCase() === value,
    ) ?? null
  );
}

/** The Folders tab's one-line summary, in the same words the Projects tab
 *  uses — one sentence shape for "who can open this". */
export function folderSummary(folderGrants: FolderGrant[], folder: Folder): string {
  if (folder.isArchive) return "Built in, cannot be shared";
  return summarizeGrants(folderGrants.filter((g) => g.folderId === folder.id));
}

/** The projects filed in one folder, in registry order. */
export function folderProjects(items: FolderItem[], folderId: number): ProjectEntry[] {
  const slugs = new Set(items.filter((i) => i.folderId === folderId).map((i) => i.projectSlug));
  return PROJECTS.filter((p) => slugs.has(p.slug));
}

/** The date lines on the Requests tab. Absolute, because "2 days ago" stops
 *  being true the moment the tab is left open. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
