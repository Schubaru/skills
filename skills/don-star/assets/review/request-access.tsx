// The door to knock on (2026-09-18). A slug that EXISTS but isn't yours is not
// a typo — resolveRequest() in projects.ts calls it `denied`, and this is what
// that renders. Silently showing the folder instead would tell someone
// following a shared link that the board is gone, which is the one thing it
// isn't.
//
// Two askers, two paths, and only the first of them lives in this file:
//   - SIGNED IN, asking for a project → request_project_access() (the RPC in
//     supabase/access-sharing.sql), then the request-access Edge Function so
//     the people who can approve it hear about it.
//   - NOT SIGNED IN AT ALL → the login door (LoginGate / middleware.ts) posts
//     straight to that Edge Function, since there is no session to make an RPC
//     with. The helpers at the bottom are shared with it.
//
// The RPC is idempotent: asking twice hands back the request already open. So
// "you already asked" and "asked just now" are the same screen on purpose.

import { useState } from "react";
import { findProject } from "./projects";
import { useThemePref } from "./theme";

// --- the screen -------------------------------------------------------------

export type RequestAccessProps = {
  slug: string;
  /** Who is asking. Shown so a wrong-account arrival is obvious. */
  email: string;
  onSignOut?: () => void;
  /** Router navigation when there is one; falls back to a plain link. */
  onProjects?: () => void;
};

export function RequestAccessScreen({ slug, email, onSignOut, onProjects }: RequestAccessProps) {
  const { darkMode } = useThemePref();
  const entry = findProject(slug);
  const name = entry?.name ?? slug;

  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const ask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || sent) return;
    setBusy(true);
    setError("");
    const problem = await sendProjectRequest(slug, note);
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    setSent(true);
  };

  return (
    <div className={darkMode ? "rv-root is-dark rv-folder-root" : "rv-root rv-folder-root"}>
      <main className="rv-page is-narrow rv-ask">
        <div className="rv-ask-card">
          {sent ? (
            <>
              <h1 className="rv-ask-title">Request sent</h1>
              <p className="rv-ask-line">You&rsquo;ll get an email when it&rsquo;s approved.</p>
            </>
          ) : (
            <form className="rv-ask-form" onSubmit={ask}>
              <h1 className="rv-ask-title">You don&rsquo;t have access to {name}</h1>
              <p className="rv-ask-line">Ask for it and the request goes to the people who own this project.</p>
              <label className="rv-ask-label" htmlFor="rv-ask-note">
                Add a note (optional)
              </label>
              <textarea
                id="rv-ask-note"
                className="rv-textarea rv-ask-note"
                value={note}
                onChange={(ev) => setNote(ev.target.value.slice(0, REQUEST_MESSAGE_MAX))}
                rows={3}
                placeholder="Who you are, or what you’re looking for"
              />
              {error ? <p className="rv-ask-error">{error}</p> : null}
              <button type="submit" className="rv-pill is-action rv-ask-submit" disabled={busy}>
                Request access
              </button>
            </form>
          )}

          <div className="rv-ask-foot">
            {onProjects ? (
              <button type="button" className="rv-ask-link" onClick={onProjects}>
                See your projects
              </button>
            ) : (
              <a className="rv-ask-link" href="/projects">
                See your projects
              </a>
            )}
            <p className="rv-ask-who">
              Signed in as {email}
              {onSignOut ? (
                <>
                  {" · "}
                  <button type="button" className="rv-ask-link" onClick={onSignOut}>
                    Sign out
                  </button>
                </>
              ) : null}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

// --- asking, signed in ------------------------------------------------------

/** Make (or re-find) the request, then tell the owners. Returns a message to
 *  show, or null when it worked.
 *
 *  The RPC is called here rather than through access.ts's requestProjectAccess
 *  because the id is the whole point: the Edge Function re-reads the row it
 *  names, so the email can never be made up by the client. */
export async function sendProjectRequest(slug: string, message: string): Promise<string | null> {
  // Imported here rather than at the top so the pure helpers below can be run
  // under `npx tsx` (auth/client.ts reads import.meta.env at module scope).
  const { getSupabase } = await import("../auth/client");
  const sb = getSupabase();
  if (!sb) return "Not connected.";
  const { data, error } = await sb.rpc("request_project_access", {
    slug,
    message: message.trim().slice(0, REQUEST_MESSAGE_MAX) || null,
  });
  if (error) return error.message || "That didn't go through. Try again.";

  const requestId = typeof data === "number" ? data : Number(data);
  if (!Number.isFinite(requestId)) return null; // the row is there; the email is the extra

  // The notification is best effort. A request that exists but didn't email is
  // still a request, and it is sitting on /projects/access either way.
  try {
    const token = (await sb.auth.getSession()).data.session?.access_token;
    if (token) {
      await fetch(accessRequestUrl(), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: env("VITE_SUPABASE_ANON_KEY") ?? "",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId }),
      });
    }
  } catch {
    // ignored on purpose, see above
  }
  return null;
}

// --- asking from the login door (no session at all) -------------------------

export const REQUEST_NAME_MAX = 80;
export const REQUEST_MESSAGE_MAX = 500;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type SignInRequest = { email: string; name?: string; message?: string };

/** The one shape check both sides agree on. The Edge Function repeats it —
 *  a client check is a courtesy, never the gate — and middleware.ts carries a
 *  trimmed copy inline because its login page is a string, not a module. */
export function normalizeSignInRequest(input: {
  email?: string;
  name?: string;
  message?: string;
}): { ok: true; value: SignInRequest } | { ok: false; error: string } {
  const email = (input.email ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_SHAPE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const name = (input.name ?? "").trim().slice(0, REQUEST_NAME_MAX);
  const message = (input.message ?? "").trim().slice(0, REQUEST_MESSAGE_MAX);
  const value: SignInRequest = { email };
  if (name) value.name = name;
  if (message) value.message = message;
  return { ok: true, value };
}

// Read lazily and defensively: import.meta.env doesn't exist outside vite, and
// these helpers are asserted on in a plain node test.
function env(key: "VITE_SUPABASE_URL" | "VITE_SUPABASE_ANON_KEY"): string | undefined {
  return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[key];
}

export function accessRequestUrl(): string {
  return `${env("VITE_SUPABASE_URL") ?? ""}/functions/v1/request-access`;
}

/** Post a sign-in request. Always answers the same way whatever the server
 *  found, so the login door never reports who is already on the allowlist. */
export async function postSignInRequest(input: {
  email?: string;
  name?: string;
  message?: string;
}): Promise<string | null> {
  const parsed = normalizeSignInRequest(input);
  if (!parsed.ok) return parsed.error;
  const anonKey = env("VITE_SUPABASE_ANON_KEY");
  if (!env("VITE_SUPABASE_URL") || !anonKey) return "Not connected.";
  try {
    const res = await fetch(accessRequestUrl(), {
      method: "POST",
      headers: { "content-type": "application/json", apikey: anonKey },
      body: JSON.stringify(parsed.value),
    });
    if (res.status === 429) return "You've already asked. We'll be in touch.";
    if (!res.ok) return "That didn't go through. Try again.";
    return null;
  } catch {
    return "Network problem. Try again.";
  }
}
