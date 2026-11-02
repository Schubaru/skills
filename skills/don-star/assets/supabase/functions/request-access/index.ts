// "Let me in" — the email half of access_requests (2026-09-18). Pairs with
// supabase/access-sharing.sql, and mirrors notify-review's structure: service
// role client, Resend, one plain unbranded email.
//
// THREE MODES, one endpoint, told apart by the body:
//   { email, name?, message? }  — ANONYMOUS. Somebody who cannot sign in at
//     all, asking from the login door. There is no session to make an RPC
//     with, so this is the only path that writes access_requests for them, and
//     it is public: verify_jwt must be OFF for this function.
//   { requestId }               — AUTHENTICATED. A signed-in person has just
//     called request_project_access(); this emails the owners about the row
//     they made. The row is RE-READ and checked to belong to the caller, so
//     the body is a hint and never the content of the email.
//   { decidedRequestId }        — AUTHENTICATED. An approver telling the
//     asker yes. Only for a row already marked approved, and only from someone
//     who could have approved it.
//
// The anonymous mode NEVER says what it found. An address already on the
// allowlist gets the same 200 as a brand new one, with nothing written — a
// login door that answers "you already have an account" is an account
// enumerator.
//
// Env: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected by the platform;
// RESEND_API_KEY must be set as a function secret. The site URL and sender
// come from review_notify_config (DB), same row notify-review reads.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Where a request lands. ONE address on purpose, for now.
 *  ⚠ Duplicated from src/review/access-rules.ts (ACCESS_REQUEST_INBOX) — Deno
 *  cannot import the app's module. Change both. */
const ACCESS_REQUEST_INBOX = "__DS_ADMIN_INBOX__";

const NAME_MAX = 80;
const MESSAGE_MAX = 500;
/** Rate limits for the anonymous door: one ask per address per window, and a
 *  ceiling across everyone so the table can't be filled by a script. */
const PER_EMAIL_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
const GLOBAL_WINDOW_MAX = 20;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type RequestRow = {
  id: number;
  email: string;
  name: string | null;
  project_slug: string | null;
  message: string | null;
  status: string;
};
type Config = { site_url: string; from_email: string };

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Unbranded, matching the login surfaces and notify-review: plain type, one
 *  link, no logos, no em dashes. */
function emailHtml(lines: string[], link: { href: string; label: string }): string {
  return [
    `<div style="font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px 16px;color:#101828;">`,
    ...lines.map((l) => `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;">${l}</p>`),
    `<p style="margin:20px 0 0;"><a href="${escapeHtml(link.href)}" style="display:inline-block;background:#101828;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 20px;border-radius:999px;">${escapeHtml(link.label)}</a></p>`,
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

/** The email the inbox gets about one request. `who` and `note` are whatever
 *  the asker typed, so both are escaped. */
function inboxEmail(row: { email: string; name: string | null; project_slug: string | null; message: string | null }, siteUrl: string) {
  const what = row.project_slug ? `access to ${row.project_slug}` : "a sign-in";
  const lines = [
    `${escapeHtml(row.name ? `${row.name} (${row.email})` : row.email)} asked for ${escapeHtml(what)}.`,
  ];
  if (row.message) lines.push(`Their note: ${escapeHtml(row.message)}`);
  return {
    subject: `Access request: ${row.email}`,
    html: emailHtml(lines, { href: `${siteUrl}/projects/access?tab=requests`, label: "Review requests" }),
  };
}

/** The caller's email, verified against the JWT. Null when there is no usable
 *  bearer token — the anonymous mode's normal state. */
async function callerEmail(sb: SupabaseClient, req: Request): Promise<string | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data.user?.email) return null;
  return data.user.email.toLowerCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json(503, { error: "RESEND_API_KEY not configured" });

  const { data: cfg } = (await sb
    .from("review_notify_config")
    .select("site_url, from_email")
    .limit(1)
    .maybeSingle()) as { data: Config | null };
  if (!cfg) return json(500, { error: "review_notify_config missing" });

  const body = (await req.json().catch(() => ({}))) as {
    requestId?: number;
    decidedRequestId?: number;
    email?: string;
    name?: string;
    message?: string;
  };

  // --- mode: a signed-in person's own request -------------------------------

  if (typeof body.requestId === "number" || typeof body.decidedRequestId === "number") {
    const caller = await callerEmail(sb, req);
    if (!caller) return json(401, { error: "Sign in first." });

    const id = (body.requestId ?? body.decidedRequestId)!;
    const { data: row } = (await sb
      .from("access_requests")
      .select("id, email, name, project_slug, message, status")
      .eq("id", id)
      .maybeSingle()) as { data: RequestRow | null };
    if (!row) return json(404, { error: "No such request." });

    if (typeof body.requestId === "number") {
      // The row must be the caller's own. Otherwise anyone signed in could
      // walk the ids and have the inbox emailed about other people.
      if (row.email.toLowerCase() !== caller) return json(403, { error: "Not your request." });
      const { subject, html } = inboxEmail(row, cfg.site_url);
      const err = await sendEmail(resendKey, cfg.from_email, ACCESS_REQUEST_INBOX, subject, html);
      if (err) console.error("[request-access] inbox send failed", err);
      return json(200, { ok: true });
    }

    // --- mode: telling the asker they were approved -------------------------
    if (row.status !== "approved") return json(409, { error: "That request is not approved." });
    const { data: isAdmin } = await sb.rpc("is_admin", { email: caller });
    let mayTell = isAdmin === true;
    if (!mayTell && row.project_slug) {
      const { data: ok } = await sb.rpc("can_access_project", { email: caller, slug: row.project_slug });
      mayTell = ok === true;
    }
    if (!mayTell) return json(403, { error: "Not yours to approve." });

    const where = row.project_slug ? `${cfg.site_url}/review?project=${encodeURIComponent(row.project_slug)}` : cfg.site_url;
    const err = await sendEmail(
      resendKey,
      cfg.from_email,
      row.email,
      "Your access request was approved",
      emailHtml(
        [row.project_slug ? "You can now open this board." : "You can now sign in with this address."],
        { href: where, label: "Open the board" },
      ),
    );
    if (err) console.error("[request-access] approval send failed", err);
    return json(200, { ok: true });
  }

  // --- mode: anonymous, from the login door ---------------------------------

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_SHAPE.test(email)) {
    return json(400, { error: "Enter a valid email address." });
  }
  const name = (body.name ?? "").trim().slice(0, NAME_MAX) || null;
  const message = (body.message ?? "").trim().slice(0, MESSAGE_MAX) || null;

  // Rate limits BEFORE the allowlist check, so a refusal here is about volume
  // and still says nothing about who exists.
  const since = new Date(Date.now() - PER_EMAIL_WINDOW_MS).toISOString();
  const { count: mine } = await sb
    .from("access_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("created_at", since);
  if ((mine ?? 0) > 0) return json(429, { error: "Already asked." });

  const hourAgo = new Date(Date.now() - GLOBAL_WINDOW_MS).toISOString();
  const { count: recent } = await sb
    .from("access_requests")
    .select("id", { count: "exact", head: true })
    .is("project_slug", null)
    .gte("created_at", hourAgo);
  if ((recent ?? 0) >= GLOBAL_WINDOW_MAX) return json(429, { error: "Too many requests." });

  // Already able to sign in? Then there is nothing to ask for. Same 200 either
  // way, and no row: see the header.
  // ⚠ is_email_allowed is granted to authenticated + supabase_auth_admin; if
  // service_role has no EXECUTE the call errors and `allowed` is null, which
  // lands us on the insert. Harmless (the response is identical either way,
  // and an admin will see a request from someone who is already in), but the
  // grant is worth adding.
  const { data: allowed } = await sb.rpc("is_email_allowed", { email });
  if (allowed === true) return json(200, { ok: true });

  // The pending-unique index makes a second ask a no-op rather than an error.
  const { error: insertError } = await sb
    .from("access_requests")
    .insert({ email, name, project_slug: null, message });
  if (insertError && !/duplicate key|unique/i.test(insertError.message)) {
    console.error("[request-access] insert failed", insertError.message);
    return json(500, { error: "Could not record the request." });
  }

  const { subject, html } = inboxEmail({ email, name, project_slug: null, message }, cfg.site_url);
  const err = await sendEmail(resendKey, cfg.from_email, ACCESS_REQUEST_INBOX, subject, html);
  if (err) console.error("[request-access] inbox send failed", err);

  return json(200, { ok: true });
});
