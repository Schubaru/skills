// Session gate + identity context for everything that talks to Supabase.
// AuthGate renders its children only with a signed-in user who has a display
// name; until then it shows the (unbranded) login or one-time name screen.
// When the env vars are unset it renders children directly with no context —
// the offline localStorage mode needs no login.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isRemoteConfigured } from "./client";
import { LoginGate, gateStyles, GATE_FOCUS_CSS } from "./LoginGate";

export type AuthIdentity = {
  userId: string;
  email: string;
  /** The name comments are authored as. Guaranteed non-empty inside AuthGate. */
  displayName: string;
  setDisplayName: (name: string) => Promise<void>;
  /** "Show me to others" off on the review board (presence.ts). Stored with
   *  the account like the name, so it holds on every device. Default: shown. */
  presenceHidden: boolean;
  setPresenceHidden: (hidden: boolean) => Promise<void>;
  /** The review-board avatar: a picked colour (index into the presence
   *  palette) and an emoji. null = the default (hashed colour, the initial). */
  presenceLook: { color: number | string | null; emoji: string | null };
  setPresenceLook: (patch: Partial<{ color: number | string | null; emoji: string | null }>) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthIdentity | null>(null);

/** The signed-in identity, or null when running in offline mode (no Supabase
 *  env). Callers fall back to the legacy localStorage name in that case. */
export function useAuthOptional(): AuthIdentity | null {
  return useContext(AuthContext);
}

/** Asked once, right after the first sign-in; stored in user_metadata so it
 *  travels with the account, not the browser.
 *
 *  Prefilled with the name whoever invited this person typed (my_default_name,
 *  supabase/access-sharing.sql) — still editable, still required, because the
 *  name on your own comments is yours. A missing RPC (pre-migration) just
 *  leaves the field empty rather than holding the screen back. */
function NameScreen({ onDone }: { onDone: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let on = true;
    void sb.rpc("my_default_name").then(({ data, error }) => {
      // Only ever fills an untouched field: a suggestion must not overwrite
      // what someone is already typing.
      if (!on || error || typeof data !== "string" || !data.trim()) return;
      setName((current) => (current ? current : data.trim()));
    });
    return () => {
      on = false;
    };
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    await onDone(n);
    setBusy(false);
  };
  return (
    <div style={gateStyles.page}>
      <style>{GATE_FOCUS_CSS}</style>
      <form style={gateStyles.form} onSubmit={submit}>
        <h1 style={gateStyles.h1}>Add your name</h1>
        <p style={gateStyles.hint}>It appears next to every comment you leave — we only ask once.</p>
        <input
          className="gate-input"
          style={gateStyles.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          autoComplete="name"
          autoFocus
          required
        />
        <button style={gateStyles.button} type="submit" disabled={busy || !name.trim()}>
          Continue
        </button>
      </form>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const remote = isRemoteConfigured();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!remote);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    let on = true;
    void sb.auth.getSession().then(({ data }) => {
      if (!on) return;
      setSession(data.session);
      setReady(true);
    });
    // Fires for SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED / USER_UPDATED —
    // keeps the session (and user_metadata edits) current.
    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      if (on) setSession(next);
    });
    return () => {
      on = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!remote) return <>{children}</>;
  if (!ready) return null;
  if (!session) return <LoginGate />;

  const user = session.user;
  const displayName = typeof user.user_metadata?.display_name === "string" ? user.user_metadata.display_name.trim() : "";

  const setDisplayName = async (name: string) => {
    const sb = getSupabase();
    if (!sb) return;
    // USER_UPDATED lands in onAuthStateChange, which re-renders with the name.
    await sb.auth.updateUser({ data: { display_name: name.trim() } });
  };

  const presenceHidden = user.user_metadata?.presence_hidden === true;
  const setPresenceHidden = async (hidden: boolean) => {
    await getSupabase()?.auth.updateUser({ data: { presence_hidden: hidden } });
  };

  const meta = user.user_metadata ?? {};
  const presenceLook = {
    color: typeof meta.presence_color === "number" || typeof meta.presence_color === "string" ? meta.presence_color : null,
    emoji: typeof meta.presence_emoji === "string" && meta.presence_emoji ? meta.presence_emoji : null,
  };
  const setPresenceLook = async (patch: Partial<{ color: number | string | null; emoji: string | null }>) => {
    const data: Record<string, unknown> = {};
    if ("color" in patch) data.presence_color = patch.color;
    if ("emoji" in patch) data.presence_emoji = patch.emoji;
    await getSupabase()?.auth.updateUser({ data });
  };

  if (!displayName) return <NameScreen onDone={setDisplayName} />;

  const identity: AuthIdentity = {
    userId: user.id,
    email: user.email ?? "",
    displayName,
    setDisplayName,
    presenceHidden,
    setPresenceHidden,
    presenceLook,
    setPresenceLook,
    signOut: async () => {
      // Clear the edge gate cookie first (HttpOnly — only the middleware can);
      // 404s harmlessly in local dev.
      await fetch("/__gate/logout", { method: "POST" }).catch(() => {});
      await getSupabase()?.auth.signOut();
    },
  };

  return <AuthContext.Provider value={identity}>{children}</AuthContext.Provider>;
}
