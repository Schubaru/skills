// Supabase persistence for /review comment threads. When the Vite env vars
// are unset, the board keeps the localStorage + committed JSON path so local
// design work never depends on a remote. When they are set, every browser
// that opens /review shares one thread list (clients included).

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, isRemoteConfigured } from "../auth/client";
import { coerceStatus } from "./model";
import type {
  CommentAnchor,
  CommentReply,
  CommentThread,
  AgentMeta,
  Person,
  ReviewEntry,
  ReviewState,
} from "./model";

export { isRemoteConfigured };

// One client shared with auth (src/auth/client.ts), so the signed-in session
// applies to every query and realtime channel here.
function getClient(): SupabaseClient | null {
  return getSupabase();
}

type ThreadRow = {
  id: string;
  project_slug: string;
  anchor: CommentAnchor;
  author: string;
  body: string;
  at: number;
  resolved: boolean;
  image: string | null;
  meta: AgentMeta | null;
  replies: CommentReply[] | null;
  author_email: string | null;
  author_id: string | null;
  mentions: string[] | null;
};

function rowToThread(row: ThreadRow): CommentThread {
  return {
    id: row.id,
    anchor: row.anchor,
    author: row.author,
    body: row.body ?? "",
    at: row.at,
    resolved: Boolean(row.resolved),
    image: row.image ?? undefined,
    meta: row.meta ?? undefined,
    replies: Array.isArray(row.replies) ? row.replies : [],
    authorEmail: row.author_email ?? undefined,
    authorId: row.author_id ?? undefined,
    mentions: Array.isArray(row.mentions) ? row.mentions : undefined,
  };
}

function threadToRow(slug: string, t: CommentThread): ThreadRow {
  const row = threadRowFull(slug, t);
  if (mentionsColumn) return row;
  const { mentions: _drop, ...rest } = row;
  return rest as ThreadRow;
}

function threadRowFull(slug: string, t: CommentThread): ThreadRow {
  return {
    id: t.id,
    project_slug: slug,
    anchor: t.anchor,
    author: t.author,
    body: t.body,
    at: t.at,
    resolved: t.resolved,
    image: t.image ?? null,
    meta: t.meta ?? null,
    replies: t.replies,
    author_email: t.authorEmail ?? null,
    author_id: t.authorId ?? null,
    mentions: t.mentions?.length ? t.mentions : null,
  };
}

// `mentions` is a column added 2026-08-12 (supabase/review-people-reads.sql).
// A deploy can land before the migration does — and PostgREST fails the WHOLE
// statement on an unknown column, so naming it unconditionally would take every
// comment read and write down with it. So we try with it, and on the first
// error that says the column isn't there we drop it for the rest of the
// session: mentions stop working, the board doesn't. Flips back on a reload
// once the migration is applied.
let mentionsColumn = true;

const THREAD_COLS = "id, project_slug, anchor, author, body, at, resolved, image, meta, replies, author_email, author_id";

function missingMentions(message: string): boolean {
  return /mentions/i.test(message) && /column|schema cache/i.test(message);
}

export async function fetchRemoteThreads(slug: string): Promise<CommentThread[] | null> {
  const sb = getClient();
  if (!sb) return null;
  // review_threads_select is `to authenticated` (supabase/auth-access.sql), so a
  // signed-out read comes back as an empty list rather than an error — and the
  // store reads "zero rows" as "first deploy, seed the table", which upserts the
  // committed JSON (replies: []) over live rows by id and destroys real replies.
  // An unauthenticated read is not evidence about the table: report it as a
  // failure to reach the server, which every caller already handles by falling
  // back to the local copy and writing nothing. getSession() also refreshes an
  // expired token first, closing the read-as-anon / write-as-authenticated race.
  const { data: session } = await sb.auth.getSession();
  if (!session.session) return null;
  const read = () =>
    sb
      .from("review_threads")
      .select(mentionsColumn ? `${THREAD_COLS}, mentions` : THREAD_COLS)
      .eq("project_slug", slug)
      .order("at", { ascending: true });
  let { data, error } = await read();
  if (error && mentionsColumn && missingMentions(error.message)) {
    console.warn("[review] review_threads.mentions not migrated yet — mentions disabled this session");
    mentionsColumn = false;
    ({ data, error } = await read());
  }
  if (error) {
    console.error("[review] failed to load remote comments", error.message);
    return null;
  }
  return (data as unknown as ThreadRow[]).map(rowToThread);
}

export async function upsertRemoteThread(slug: string, thread: CommentThread): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { error } = await sb.from("review_threads").upsert(threadToRow(slug, thread), { onConflict: "id" });
  if (error) {
    console.error("[review] failed to save comment", error.message);
    return false;
  }
  return true;
}

export async function upsertRemoteThreads(slug: string, threads: CommentThread[]): Promise<boolean> {
  const sb = getClient();
  if (!sb || threads.length === 0) return false;
  const { error } = await sb
    .from("review_threads")
    .upsert(
      threads.map((t) => threadToRow(slug, t)),
      { onConflict: "id" },
    );
  if (error) {
    console.error("[review] failed to seed remote comments", error.message);
    return false;
  }
  return true;
}

export async function deleteRemoteThread(id: string): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { error } = await sb.from("review_threads").delete().eq("id", id);
  if (error) {
    console.error("[review] failed to delete comment", error.message);
    return false;
  }
  return true;
}

// --- the people directory (review_people) -------------------------------------
//
// Display names live in auth.users.user_metadata, which one browser can't read
// for anyone else — so the board keeps its own list and each client publishes
// its OWN row. See supabase/review-people-reads.sql.

/** Publish (or refresh) my directory row so others can tag me. Fire and forget:
 *  a failure means the @ menu is one name short, never that a comment is lost. */
export function announceSelf(email: string, name: string, userId?: string): void {
  const sb = getClient();
  if (!sb || !email || !name.trim()) return;
  void sb
    .from("review_people")
    .upsert(
      { email: email.toLowerCase(), user_id: userId ?? null, name: name.trim(), last_seen_at: new Date().toISOString() },
      { onConflict: "email" },
    )
    .then(({ error }) => {
      if (error) console.error("[review] failed to publish directory row", error.message);
    });
}

export async function fetchPeople(): Promise<Person[] | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.from("review_people").select("email, name, user_id, color, emoji").order("name");
  if (error) {
    console.error("[review] failed to load people", error.message);
    return null;
  }
  return (data ?? []).map((r) => ({
    email: String(r.email).toLowerCase(),
    name: String(r.name),
    userId: r.user_id ?? null,
    color: r.color ?? null,
    emoji: r.emoji ?? null,
  }));
}

// --- read state (review_thread_reads) ------------------------------------------

/** My read marks: thread id → the newest activity timestamp I've seen. */
export async function fetchReads(email: string): Promise<Record<string, number> | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb.from("review_thread_reads").select("thread_id, seen_at").eq("email", email);
  if (error) {
    console.error("[review] failed to load read state", error.message);
    return null;
  }
  return Object.fromEntries((data ?? []).map((r) => [String(r.thread_id), Number(r.seen_at)]));
}

/** Mark one thread seen up to `seenAt` (an ACTIVITY timestamp, not "now"). */
export function markRemoteRead(email: string, threadId: string, seenAt: number): void {
  const sb = getClient();
  if (!sb) return;
  void sb
    .from("review_thread_reads")
    .upsert({ email: email.toLowerCase(), thread_id: threadId, seen_at: seenAt }, { onConflict: "email,thread_id" })
    .then(({ error }) => {
      if (error) console.error("[review] failed to save read state", error.message);
    });
}

// --- audit log (review_events) ------------------------------------------------

/** Fire-and-forget append to the timestamped audit log. Never blocks or
 *  throws — the log is a record, not a dependency. */
export function logRemoteEvent(
  slug: string,
  kind: string,
  targetId: string | null,
  actor: string | null,
  detail?: Record<string, unknown>,
  actorEmail?: string,
): void {
  const sb = getClient();
  if (!sb) return;
  void sb
    .from("review_events")
    .insert({
      project_slug: slug,
      kind,
      target_id: targetId,
      actor: actor || null,
      detail: detail ?? null,
      actor_email: actorEmail || null,
    })
    .then(({ error }) => {
      if (error) console.error("[review] failed to log event", error.message);
    });
}

// --- email notification prefs (review_notify_prefs) ---------------------------

/** Email notification prefs (see supabase/review-notify.sql). Replies are
 *  opt-OUT (no row = on, the reviewer 2026-07-30), new threads are opt-IN — keep the
 *  no-row default here in lockstep with the notify-review Edge Function. */
export type NotifyPrefs = { onReplies: boolean; onNewThreads: boolean };
const DEFAULT_PREFS: NotifyPrefs = { onReplies: true, onNewThreads: false };

export async function fetchNotifyPrefs(email: string): Promise<NotifyPrefs | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("review_notify_prefs")
    .select("on_replies, on_new_threads")
    .eq("email", email)
    .maybeSingle();
  if (error) {
    console.error("[review] failed to load notify prefs", error.message);
    return null;
  }
  if (!data) return { ...DEFAULT_PREFS };
  return {
    onReplies: Boolean(data.on_replies),
    onNewThreads: Boolean(data.on_new_threads),
  };
}

export async function upsertNotifyPrefs(
  email: string,
  userId: string | undefined,
  prefs: NotifyPrefs,
): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { error } = await sb.from("review_notify_prefs").upsert(
    {
      email,
      user_id: userId ?? null,
      on_replies: prefs.onReplies,
      on_new_threads: prefs.onNewThreads,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" },
  );
  if (error) {
    console.error("[review] failed to save notify prefs", error.message);
    return false;
  }
  return true;
}

// --- triage statuses (review_statuses) ----------------------------------------

type StatusRow = {
  project_slug: string;
  scope: "screens" | "flows";
  target_id: string;
  /** May hold retired vocabulary (e.g. "broken") from older writers. */
  status: string | null;
  note: string | null;
  set_by: string | null;
  set_at: number | null;
  set_by_email: string | null;
};

function rowsToReviewState(rows: StatusRow[]): ReviewState {
  const state: ReviewState = { screens: {}, flows: {} };
  for (const r of rows) {
    const entry: ReviewEntry = {};
    const status = coerceStatus(r.status);
    if (status) entry.status = status;
    if (r.note) entry.note = r.note;
    if (r.set_by) entry.by = r.set_by;
    if (r.set_at) entry.at = r.set_at;
    if (r.set_by_email) entry.byEmail = r.set_by_email;
    state[r.scope][r.target_id] = entry;
  }
  return state;
}

export async function fetchRemoteReviews(slug: string): Promise<ReviewState | null> {
  const sb = getClient();
  if (!sb) return null;
  const { data, error } = await sb
    .from("review_statuses")
    .select("project_slug, scope, target_id, status, note, set_by, set_at, set_by_email")
    .eq("project_slug", slug);
  if (error) {
    console.error("[review] failed to load remote statuses", error.message);
    return null;
  }
  return rowsToReviewState(data as StatusRow[]);
}

/** Upsert one triage entry; an empty entry deletes the row. */
export async function upsertRemoteReview(
  slug: string,
  scope: "screens" | "flows",
  targetId: string,
  entry: ReviewEntry | null,
): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  if (!entry || (!entry.status && !entry.note)) {
    const { error } = await sb
      .from("review_statuses")
      .delete()
      .match({ project_slug: slug, scope, target_id: targetId });
    if (error) console.error("[review] failed to clear status", error.message);
    return !error;
  }
  const { error } = await sb.from("review_statuses").upsert(
    {
      project_slug: slug,
      scope,
      target_id: targetId,
      status: entry.status ?? null,
      note: entry.note ?? null,
      set_by: entry.by ?? null,
      set_at: entry.at ?? null,
      set_by_email: entry.byEmail ?? null,
    },
    { onConflict: "project_slug,scope,target_id" },
  );
  if (error) console.error("[review] failed to save status", error.message);
  return !error;
}

/** Replace the slug's whole triage state (seed push, import, clear-all). */
export async function replaceRemoteReviews(slug: string, state: ReviewState): Promise<boolean> {
  const sb = getClient();
  if (!sb) return false;
  const { error: delError } = await sb.from("review_statuses").delete().eq("project_slug", slug);
  if (delError) {
    console.error("[review] failed to reset statuses", delError.message);
    return false;
  }
  const rows: StatusRow[] = [];
  for (const scope of ["screens", "flows"] as const) {
    for (const [targetId, entry] of Object.entries(state[scope])) {
      if (!entry.status && !entry.note) continue;
      rows.push({
        project_slug: slug,
        scope,
        target_id: targetId,
        status: entry.status ?? null,
        note: entry.note ?? null,
        set_by: entry.by ?? null,
        set_at: entry.at ?? null,
        set_by_email: entry.byEmail ?? null,
      });
    }
  }
  if (rows.length === 0) return true;
  const { error } = await sb.from("review_statuses").upsert(rows, { onConflict: "project_slug,scope,target_id" });
  if (error) console.error("[review] failed to seed statuses", error.message);
  return !error;
}

/** Live triage updates from other browsers. Returns an unsubscribe. */
export function subscribeRemoteReviews(slug: string, onChange: (state: ReviewState) => void): () => void {
  const sb = getClient();
  if (!sb) return () => {};

  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  const refresh = async () => {
    const next = await fetchRemoteReviews(slug);
    if (!cancelled && next) onChange(next);
  };

  channel = sb
    .channel(`review_statuses:${slug}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_statuses", filter: `project_slug=eq.${slug}` },
      () => {
        void refresh();
      },
    )
    .subscribe();

  return () => {
    cancelled = true;
    if (channel) void sb.removeChannel(channel);
  };
}

/** Live updates from other browsers. Returns an unsubscribe. */
export function subscribeRemoteThreads(
  slug: string,
  onChange: (threads: CommentThread[]) => void,
): () => void {
  const sb = getClient();
  if (!sb) return () => {};

  let channel: RealtimeChannel | null = null;
  let cancelled = false;

  const refresh = async () => {
    const next = await fetchRemoteThreads(slug);
    if (!cancelled && next) onChange(next);
  };

  channel = sb
    .channel(`review_threads:${slug}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "review_threads", filter: `project_slug=eq.${slug}` },
      () => {
        void refresh();
      },
    )
    .subscribe();

  return () => {
    cancelled = true;
    if (channel) void sb.removeChannel(channel);
  };
}
