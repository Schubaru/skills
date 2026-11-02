// Email notifications for /review comments. Invoked by a pg_net trigger on
// review_threads (see ../review-notify.sql) with `{ thread_id }` — the payload
// is only a HINT. The function re-reads the thread row and the
// review_notifications ledger, so a duplicate, replayed, or forged request can
// never double-send: an item (the thread itself, or one reply) emails at most
// once, ever, claimed via the ledger's primary key.
//
// Recipients (review_notify_prefs; the reviewer 2026-07-30 — replies are opt-OUT,
// new threads are opt-IN):
//   - a new reply    → everyone who has participated in that thread
//                      (author + prior repliers), minus the replier, minus
//                      anyone whose prefs row has on_replies=false — no row
//                      means yes, replies are on by default
//   - a new thread   → only people with an explicit on_new_threads=true row,
//                      minus the author
//   - EVERY recipient is then filtered by can_access_project (2026-08-13).
//                      Prefs and the @ directory are board-wide, the board is
//                      not: an email about a project someone can't open is a
//                      leak, and this function runs as service role, so RLS
//                      won't do it for us.
//   - ANYONE MENTIONED in the item (2026-08-12) → always, whatever their prefs
//                      say. Being named is a direct address, not a
//                      subscription: someone who muted replies and never opted
//                      into new threads would otherwise never learn they were
//                      asked a question. They get a different subject line,
//                      because "you were asked something" and "something
//                      happened" are different pieces of news.
// Agent-authored items (author "/skill", no email) can trigger notifications
// but never receive them. Items older than MAX_AGE_MS are ledgered as 'stale'
// without sending — that's the flood guard for seed pushes of old boards.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the platform;
// RESEND_API_KEY must be set as a function secret. Site URL, sender, and the
// webhook token live in review_notify_config (DB), not env.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type Reply = { id: string; author: string; body: string; at: number; email?: string; mentions?: string[] };
type ThreadRow = {
  id: string;
  project_slug: string;
  anchor: { type: string; screenId?: string } | null;
  author: string;
  body: string;
  at: number;
  resolved: boolean;
  replies: Reply[] | null;
  author_email: string | null;
  mentions: string[] | null;
};
type PrefRow = { email: string; on_replies: boolean; on_new_threads: boolean };
type Config = { site_url: string; from_email: string; token: string };

/** Items older than this are ledgered as 'stale' instead of emailed — the
 *  guard against a bulk seed push re-announcing an old board. Generous so an
 *  agent reply committed on Friday still notifies after a Monday merge. */
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const BODY_MAX = 600;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function excerpt(s: string, max = BODY_MAX): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Unbranded, matching the login surfaces: plain type, one link, no logos. */
function emailHtml(opts: { heading: string; body: string; context?: string; link: string }): string {
  const context = opts.context
    ? `<p style="margin:0 0 12px;color:#667085;font-size:13px;">${escapeHtml(opts.context)}</p>`
    : "";
  return [
    `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px 16px;color:#101828;">`,
    `<p style="margin:0 0 12px;font-size:15px;font-weight:600;">${escapeHtml(opts.heading)}</p>`,
    context,
    `<blockquote style="margin:0 0 20px;padding:10px 14px;border-left:3px solid #d0d5dd;color:#344054;font-size:14px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(excerpt(opts.body))}</blockquote>`,
    `<p style="margin:0 0 24px;"><a href="${opts.link}" style="display:inline-block;background:#101828;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:999px;">View thread</a></p>`,
    `<p style="margin:0;color:#98a2b3;font-size:12px;">Manage email notifications in the review board's ⋯ menu — you can turn these off there any time.</p>`,
    `</div>`,
  ].join("");
}

async function sendEmail(
  resendKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<string | null> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (!res.ok) return `${res.status} ${await res.text().catch(() => "")}`.trim();
  return null;
}

/** Claim (kind, targetId) in the ledger. False = already claimed (or raced). */
async function claim(
  sb: SupabaseClient,
  kind: "thread" | "reply",
  targetId: string,
  threadId: string,
  status: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from("review_notifications")
    .upsert(
      { kind, target_id: targetId, thread_id: threadId, status },
      { onConflict: "kind,target_id", ignoreDuplicates: true },
    )
    .select("target_id");
  if (error) {
    console.error("[notify-review] ledger claim failed", error.message);
    return false;
  }
  return Array.isArray(data) && data.length > 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: cfg } = (await sb.from("review_notify_config").select("site_url, from_email, token").limit(1).maybeSingle()) as { data: Config | null };
  if (!cfg) return json(500, { error: "review_notify_config missing" });
  if (req.headers.get("x-notify-token") !== cfg.token) return json(401, { error: "bad token" });

  // Checked BEFORE any ledger claim: with no key we must not mark items sent —
  // they stay unclaimed and the next change to the thread retries them.
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json(503, { error: "RESEND_API_KEY not configured" });

  const { thread_id: threadId } = (await req.json().catch(() => ({}))) as { thread_id?: string };
  if (!threadId || typeof threadId !== "string") return json(400, { error: "thread_id required" });

  const { data: thread } = (await sb
    .from("review_threads")
    .select("id, project_slug, anchor, author, body, at, resolved, replies, author_email, mentions")
    .eq("id", threadId)
    .maybeSingle()) as { data: ThreadRow | null };
  if (!thread) return json(200, { skipped: "thread gone" });

  const replies: Reply[] = Array.isArray(thread.replies) ? thread.replies : [];

  const { data: prefData } = await sb
    .from("review_notify_prefs")
    .select("email, on_replies, on_new_threads");
  const prefs: PrefRow[] = prefData ?? [];

  // Everyone with a verified email on the thread — author + every replier.
  const participants = new Set<string>();
  if (thread.author_email) participants.add(thread.author_email.toLowerCase());
  for (const r of replies) if (r.email) participants.add(r.email.toLowerCase());

  const items: {
    kind: "thread" | "reply";
    id: string;
    at: number;
    actor: string;
    actorEmail: string | null;
    body: string;
    mentions: string[];
  }[] = [
    {
      kind: "thread",
      id: thread.id,
      at: thread.at,
      actor: thread.author,
      actorEmail: thread.author_email,
      body: thread.body,
      mentions: Array.isArray(thread.mentions) ? thread.mentions : [],
    },
    ...replies
      .filter((r) => r.id)
      .map((r) => ({
        kind: "reply" as const,
        id: r.id,
        at: r.at,
        actor: r.author,
        actorEmail: r.email ?? null,
        body: r.body,
        mentions: Array.isArray(r.mentions) ? r.mentions : [],
      })),
  ];

  const { data: ledgerRows } = await sb
    .from("review_notifications")
    .select("kind, target_id")
    .eq("thread_id", thread.id);
  const ledgered = new Set((ledgerRows ?? []).map((r) => `${r.kind}:${r.target_id}`));

  const screen = thread.anchor?.type === "screen" && thread.anchor.screenId ? thread.anchor.screenId : null;
  const link = `${cfg.site_url}/?thread=${encodeURIComponent(thread.id)}`;
  const results: Record<string, string> = {};

  for (const item of items) {
    if (ledgered.has(`${item.kind}:${item.id}`)) continue;

    const actorEmail = item.actorEmail?.toLowerCase() ?? null;
    const prefByEmail = new Map(prefs.map((p) => [p.email.toLowerCase(), p]));
    // Named people, regardless of prefs — see the header. You can't mention
    // yourself into an email.
    const mentioned = new Set(
      item.mentions.map((e) => e.toLowerCase()).filter((e) => e && e !== actorEmail),
    );
    const subscribed =
      item.kind === "thread"
        ? prefs.filter((p) => p.on_new_threads && p.email.toLowerCase() !== actorEmail).map((p) => p.email)
        : [...participants]
            .filter((e) => e !== actorEmail)
            // No prefs row = replies on by default; a row only excludes when
            // the person explicitly flipped on_replies off.
            .filter((e) => prefByEmail.get(e)?.on_replies !== false);
    const candidates = [...new Set([...subscribed, ...mentioned].map((e) => e.toLowerCase()))];
    // PROJECT SCOPE (2026-08-13). This function runs as service role, so RLS
    // does nothing for it — the check has to be here. Without it, "every new
    // comment" and the @ directory (both board-wide) would mail a project's
    // comments to people who can't open that project. Mentions are filtered
    // too, deliberately: naming someone is not a way to grant them access.
    const recipients = (await Promise.all(
      candidates.map(async (email) => {
        const { data: ok, error } = await sb.rpc("can_access_project", { email, slug: thread.project_slug });
        // FAIL OPEN on a missing/erroring function: before project-access.sql
        // is applied the RPC doesn't exist, and treating that as "no access"
        // would silently drop every notification — permanently, since the
        // ledger claims each item at most once. An unapplied migration means
        // there is only one project, so open is also correct.
        if (error) return email;
        return ok === true ? email : null;
      }),
    )).filter((e): e is string => e !== null);

    const stale = Date.now() - item.at > MAX_AGE_MS;
    const initialStatus = stale ? "stale" : recipients.length === 0 ? "no-recipients" : "pending";
    if (!(await claim(sb, item.kind, item.id, thread.id, initialStatus))) continue;
    if (stale || recipients.length === 0) {
      results[`${item.kind}:${item.id}`] = initialStatus;
      continue;
    }

    const subject =
      item.kind === "thread"
        ? `${item.actor} left a new comment on the review board`
        : `${item.actor} replied on the review board`;
    const mentionSubject = `${item.actor} mentioned you on the review board`;
    const context =
      item.kind === "reply"
        ? `In ${thread.author}'s thread${screen ? ` on ${screen}` : ""}: “${excerpt(thread.body, 120)}”`
        : screen
          ? `On ${screen}`
          : undefined;

    const errors: string[] = [];
    for (const to of recipients) {
      // Same thread, different news: a mention says someone wants YOU.
      const forMention = mentioned.has(to);
      const line = forMention ? mentionSubject : subject;
      const html = emailHtml({ heading: line, body: item.body, context, link });
      const err = await sendEmail(resendKey, cfg.from_email, to, line, html);
      if (err) errors.push(`${to}: ${err}`);
    }
    const status = errors.length === 0 ? "sent" : `error: ${errors.join("; ").slice(0, 500)}`;
    await sb
      .from("review_notifications")
      .update({ recipients, status })
      .match({ kind: item.kind, target_id: item.id });
    if (errors.length) console.error("[notify-review] send failures", errors);
    results[`${item.kind}:${item.id}`] = status;
  }

  return json(200, { thread: thread.id, results });
});
