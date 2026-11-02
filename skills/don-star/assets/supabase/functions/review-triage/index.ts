// Read-only thread export + PR-notification endpoint for the daily
// review-triage cloud routine (Anthropic cloud sandbox — no user JWT, so auth
// is a dedicated token in review_notify_config.triage_token, the same
// header-token pattern as notify-review). Deployed with verify_jwt=false for
// that reason. POST JSON with an `x-triage-token` header; two ops:
//
//   {op:"threads"}
//     → every __DS_PROJECT_SLUG__ thread (id, anchor, author, body, at, resolved,
//       meta, replies), with author emails/ids STRIPPED — the routine writes
//       PR bodies, and emails must never land in git (same rule as
//       buildSnapshot in src/review/io.ts).
//
//   {op:"notify", pr_url, title, items:[{thread_id, author, body, note}],
//    attachments:[{filename, content}]}
//     → one email to NOTIFY_TO via Resend announcing the triage PR. The
//       recipient is fixed here so a leaked token can't be used as a relay.
//       `attachments[].content` is base64 — the before/after sheet from
//       scripts/review-shots.mjs rides along so the merge decision can be made
//       from the email (the reviewer, 2026-07-30).
//
//   {op:"reply", key, author, items:[{thread_id, body, meta, resolve}]}
//     → append ONE agent reply per thread, posted by the merge workflow after a
//       triage PR lands (the reviewer, 2026-07-30: threads are answered once the change
//       ships, never before). `key` makes the reply id deterministic
//       (`triage-<key>-<thread_id>`), so a re-run of the workflow is a no-op
//       rather than a double post. `author` is forced to an agent identity (a
//       leading "/") because isAgent() in src/review/model.ts is what makes the
//       board render it as the skill rather than as a person.
//       It does NOT resolve the thread — the reviewer who raised it closes it —
//       unless an item passes `resolve:true` (2026-08-03): reserved for
//       documentation-event threads (meta.docKind, the + events below each
//       screen), where resolving archives the event off the canvas. Nothing
//       sends it today.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the platform;
// RESEND_API_KEY is the function secret shared with notify-review. Site URL
// and sender come from review_notify_config, like notify-review.

import { createClient } from "npm:@supabase/supabase-js@2";

const PROJECT_SLUG = "__DS_PROJECT_SLUG__";
const NOTIFY_TO = "__DS_ADMIN_INBOX__";
const BODY_MAX = 400;

type Reply = { id: string; author: string; body: string; at: number; email?: string; meta?: unknown };
type NotifyItem = { thread_id?: string; author?: string; body?: string; note?: string };
type Attachment = { filename?: string; content?: string };
type ReplyItem = { thread_id?: string; body?: string; meta?: unknown; resolve?: boolean };

const DEFAULT_AGENT = "/triage";
const REPLY_MAX = 4000;

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
  const t = (s ?? "").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Unbranded, matching notify-review: plain type, one button, no logos. */
function emailHtml(opts: { title: string; prUrl: string; items: NotifyItem[]; siteUrl: string }): string {
  const rows = opts.items
    .map((it) => {
      const link = it.thread_id
        ? `<a href="${opts.siteUrl}/?thread=${encodeURIComponent(it.thread_id)}" style="color:#175cd3;font-size:13px;">View thread</a>`
        : "";
      const note = it.note
        ? `<p style="margin:6px 0 0;color:#344054;font-size:13px;line-height:1.5;">${escapeHtml(excerpt(it.note))}</p>`
        : "";
      return [
        `<div style="margin:0 0 16px;">`,
        `<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #d0d5dd;color:#344054;font-size:13px;line-height:1.5;white-space:pre-wrap;">${escapeHtml(excerpt(it.body ?? ""))}</blockquote>`,
        `<p style="margin:4px 0 0;color:#667085;font-size:12px;">— ${escapeHtml(it.author ?? "reviewer")} · ${link}</p>`,
        note,
        `</div>`,
      ].join("");
    })
    .join("");
  return [
    `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px 16px;color:#101828;">`,
    `<p style="margin:0 0 16px;font-size:15px;font-weight:600;">${escapeHtml(opts.title)}</p>`,
    rows,
    `<p style="margin:8px 0 0;"><a href="${opts.prUrl}" style="display:inline-block;background:#101828;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:999px;">Review the PR</a></p>`,
    `</div>`,
  ].join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: cfg } = await sb
    .from("review_notify_config")
    .select("site_url, from_email, triage_token")
    .limit(1)
    .maybeSingle();
  if (!cfg?.triage_token) return json(500, { error: "triage_token not configured" });
  if (req.headers.get("x-triage-token") !== cfg.triage_token) return json(401, { error: "bad token" });

  const payload = (await req.json().catch(() => ({}))) as {
    op?: string;
    pr_url?: string;
    title?: string;
    items?: NotifyItem[] & ReplyItem[];
    attachments?: Attachment[];
    key?: string;
    author?: string;
  };

  if (payload.op === "threads") {
    const { data, error } = await sb
      .from("review_threads")
      .select("id, anchor, author, body, at, resolved, meta, replies")
      .eq("project_slug", PROJECT_SLUG)
      .order("at", { ascending: true });
    if (error) return json(500, { error: error.message });
    const threads = (data ?? []).map((t) => ({
      ...t,
      replies: (Array.isArray(t.replies) ? (t.replies as Reply[]) : []).map(
        ({ email: _email, ...rest }) => rest,
      ),
    }));
    return json(200, { threads });
  }

  if (payload.op === "notify") {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) return json(503, { error: "RESEND_API_KEY not configured" });
    if (!payload.pr_url || typeof payload.pr_url !== "string") return json(400, { error: "pr_url required" });
    const items = Array.isArray(payload.items) ? payload.items.slice(0, 30) : [];
    const title = excerpt(payload.title ?? "Review triage PR ready", 120);
    const html = emailHtml({ title, prUrl: payload.pr_url, items, siteUrl: cfg.site_url });
    // Before/after sheet from scripts/review-shots.mjs, so the merge call can be made from
    // the email without opening the PR. Capped well under Resend's 40MB envelope.
    const attachments = (Array.isArray(payload.attachments) ? payload.attachments : [])
      .filter((a) => a?.filename && a?.content)
      .slice(0, 4)
      .map((a) => ({ filename: String(a.filename), content: String(a.content) }));
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: cfg.from_email,
        to: [NOTIFY_TO],
        subject: title,
        html,
        ...(attachments.length ? { attachments } : {}),
      }),
    });
    if (!res.ok) return json(502, { error: `resend: ${res.status} ${await res.text().catch(() => "")}`.trim() });
    return json(200, { sent: NOTIFY_TO, attached: attachments.length });
  }

  if (payload.op === "reply") {
    const key = String(payload.key ?? "").trim();
    if (!key) return json(400, { error: "key required (makes the reply id deterministic)" });
    const raw = String(payload.author ?? DEFAULT_AGENT).trim() || DEFAULT_AGENT;
    // isAgent() keys off the leading slash — without it the board renders the routine as a
    // person, which is exactly the confusion the agent-identity convention exists to prevent.
    const author = raw.startsWith("/") ? raw : `/${raw}`;
    const items = (Array.isArray(payload.items) ? payload.items : []).slice(0, 50);

    const posted: string[] = [];
    const skipped: string[] = [];
    const failed: { thread_id: string; error: string }[] = [];

    for (const item of items) {
      const id = String(item?.thread_id ?? "").trim();
      const body = String(item?.body ?? "").trim();
      if (!id || !body) continue;

      const { data: row, error } = await sb
        .from("review_threads")
        .select("replies")
        .eq("project_slug", PROJECT_SLUG)
        .eq("id", id)
        .maybeSingle();
      if (error) { failed.push({ thread_id: id, error: error.message }); continue; }
      if (!row) { failed.push({ thread_id: id, error: "no such thread" }); continue; }

      const replies = Array.isArray(row.replies) ? (row.replies as Reply[]) : [];
      const replyId = `triage-${key}-${id}`;
      // The whole idempotency story: a re-run of the merge workflow recomputes the same id
      // and stops here, so nothing double-posts and no write-back to git is needed.
      if (replies.some((r) => r?.id === replyId)) { skipped.push(id); continue; }

      const next = [
        ...replies,
        {
          id: replyId,
          author,
          body: excerpt(body, REPLY_MAX),
          at: Date.now(),
          ...(item?.meta ? { meta: item.meta } : {}),
        },
      ];
      // Deliberately NOT setting resolved for comment threads — the reviewer who
      // raised one closes it. resolve:true is the reserved event-archive path.
      const { error: upErr } = await sb
        .from("review_threads")
        .update({
          replies: next,
          updated_at: new Date().toISOString(),
          ...(item?.resolve === true ? { resolved: true } : {}),
        })
        .eq("project_slug", PROJECT_SLUG)
        .eq("id", id);
      if (upErr) failed.push({ thread_id: id, error: upErr.message });
      else posted.push(id);
    }

    return json(failed.length ? 207 : 200, { posted, skipped, failed });
  }

  return json(400, { error: "unknown op" });
});
