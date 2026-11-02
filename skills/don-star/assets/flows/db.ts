// Where a flow chart lives. One row per diagram in `flow_docs`
// (supabase/flow-docs.sql), read and written by everyone who can open the
// project — which is the whole requirement: an edit made here is what the next
// person opens, not a copy in this browser.
//
// Three decisions worth knowing:
//
//  1. THE WHOLE DOC IS THE UNIT. Nodes and edges go up together as one jsonb.
//     Per-node rows would merge two people's simultaneous drags, but nothing
//     here is simultaneous — this is a design tool a handful of people think in
//     asynchronously — and a partial write that lands half a fork is worse than
//     a late one. `rev` is how two editors find out they disagreed.
//  2. NOTHING IS WRITTEN WITHOUT A SIGNED-IN SESSION. An anonymous read comes
//     back empty under RLS, and "zero rows" would otherwise read as "empty
//     project, seed it" and overwrite the real board with the seed. The review
//     board learned this the hard way (review/db.ts says so); the same guard is
//     here for the same reason.
//  3. OFFLINE IS A REAL MODE. With no Supabase env configured (local design
//     work), the canvas keeps everything in localStorage and says so in the
//     header, rather than silently pretending to share.

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isRemoteConfigured } from "../auth/client";
import type { FlowDoc, FlowEdge, FlowNode } from "./model";

export { isRemoteConfigured };

function getClient(): SupabaseClient | null {
  return getSupabase();
}

type DocRow = {
  id: string;
  project_slug: string;
  title: string;
  summary: string | null;
  doc: { nodes: FlowNode[]; edges: FlowEdge[] };
  rev: number;
  sort: number;
  updated_at: string;
  updated_by: string | null;
};

function rowToDoc(row: DocRow): FlowDoc {
  return {
    id: row.id,
    projectSlug: row.project_slug,
    title: row.title,
    summary: row.summary ?? undefined,
    nodes: Array.isArray(row.doc?.nodes) ? row.doc.nodes : [],
    edges: Array.isArray(row.doc?.edges) ? row.doc.edges : [],
    rev: row.rev ?? 0,
    updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
    updatedBy: row.updated_by,
    order: row.sort ?? 0,
  };
}

function docToRow(doc: FlowDoc, by: string | null): Omit<DocRow, "updated_at"> & { updated_at: string } {
  return {
    id: doc.id,
    project_slug: doc.projectSlug,
    title: doc.title,
    summary: doc.summary ?? null,
    doc: { nodes: doc.nodes, edges: doc.edges },
    rev: doc.rev,
    sort: doc.order,
    updated_at: new Date().toISOString(),
    updated_by: by,
  };
}

const COLS = "id, project_slug, title, summary, doc, rev, sort, updated_at, updated_by";

/** Null means "couldn't reach the server" — never "the project is empty".
 *  Callers must not treat the two the same: one falls back to the local copy,
 *  the other seeds. */
export async function fetchDocs(slug: string): Promise<FlowDoc[] | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data: session } = await sb.auth.getSession();
  if (!session.session) return null;
  const { data, error } = await sb
    .from("flow_docs")
    .select(COLS)
    .eq("project_slug", slug)
    .order("sort", { ascending: true });
  if (error) {
    console.warn("[flows] read failed", error.message);
    return null;
  }
  return (data as DocRow[]).map(rowToDoc);
}

export type SaveResult =
  | { ok: true; doc: FlowDoc }
  /** Someone else wrote after the copy we hold. `server` is theirs. */
  | { ok: false; conflict: true; server: FlowDoc }
  | { ok: false; conflict: false; error: string };

/** Save, refusing to overwrite a newer version. The update is conditional on
 *  the rev we read (`eq("rev", doc.rev)`), so two editors can't silently take
 *  turns deleting each other's branches — the loser is told. */
export async function saveDoc(doc: FlowDoc, by: string | null): Promise<SaveResult> {
  const sb = getClient();
  if (!sb) return { ok: false, conflict: false, error: "offline" };
  const { data: session } = await sb.auth.getSession();
  if (!session.session) return { ok: false, conflict: false, error: "signed out" };

  const next = { ...doc, rev: doc.rev + 1 };
  const row = docToRow(next, by);

  if (doc.rev === 0) {
    // First write of a new doc. `insert` rather than upsert so a duplicate id
    // is an error we see, not a silent overwrite of someone else's row.
    const { data, error } = await sb.from("flow_docs").insert(row).select(COLS).single();
    if (error) return { ok: false, conflict: false, error: error.message };
    return { ok: true, doc: rowToDoc(data as DocRow) };
  }

  const { data, error } = await sb
    .from("flow_docs")
    .update(row)
    .eq("id", doc.id)
    .eq("rev", doc.rev)
    .select(COLS)
    .maybeSingle();
  if (error) return { ok: false, conflict: false, error: error.message };
  if (!data) {
    // No row matched: either the rev moved or the row is gone. Read back to
    // find out which, and hand the caller the server's version to reconcile.
    const server = await fetchDoc(doc.id);
    if (server) return { ok: false, conflict: true, server };
    return { ok: false, conflict: false, error: "the diagram was deleted" };
  }
  return { ok: true, doc: rowToDoc(data as DocRow) };
}

export async function fetchDoc(id: string): Promise<FlowDoc | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.from("flow_docs").select(COLS).eq("id", id).maybeSingle();
  if (error || !data) return null;
  return rowToDoc(data as DocRow);
}

export async function deleteDoc(id: string): Promise<string | null> {
  const sb = getClient();
  if (!sb) return "offline";
  const { error } = await sb.from("flow_docs").delete().eq("id", id);
  return error ? error.message : null;
}

/** Seed a project that has never been opened. Guarded by `on conflict do
 *  nothing` semantics — two people opening a fresh project at the same moment
 *  must not produce two copies of the seed. */
export async function seedIfEmpty(docs: FlowDoc[], by: string | null): Promise<FlowDoc[] | null> {
  const sb = getClient();
  if (!sb) return null;
  const rows = docs.map((d) => docToRow({ ...d, rev: 1 }, by));
  const { error } = await sb.from("flow_docs").insert(rows);
  if (error) {
    // Almost always the race above: someone seeded a millisecond earlier. Read
    // back rather than reporting an error nobody can act on.
    return fetchDocs(docs[0]!.projectSlug);
  }
  return fetchDocs(docs[0]!.projectSlug);
}

/** Live updates from other browsers. Returns an unsubscribe. */
export function subscribeDocs(slug: string, onChange: () => void): () => void {
  const sb = getClient();
  if (!sb) return () => {};
  let channel: RealtimeChannel | null = sb
    .channel(`flow_docs:${slug}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "flow_docs", filter: `project_slug=eq.${slug}` },
      () => onChange(),
    )
    .subscribe();
  return () => {
    if (channel) void sb.removeChannel(channel);
    channel = null;
  };
}

// --- offline / local fallback ----------------------------------------------

const localKey = (slug: string) => `flows:${slug}`;

export function readLocal(slug: string): FlowDoc[] | null {
  try {
    const raw = localStorage.getItem(localKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FlowDoc[]) : null;
  } catch {
    return null;
  }
}

export function writeLocal(slug: string, docs: FlowDoc[]): void {
  try {
    localStorage.setItem(localKey(slug), JSON.stringify(docs));
  } catch {
    /* quota or private mode — the canvas still works, it just won't survive a reload */
  }
}
