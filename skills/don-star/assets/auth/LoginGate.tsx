// In-app email→code sign-in. This is the whole gate in local dev (the Vercel
// edge middleware doesn't run under vite) and the fallback on the deployed
// site (valid gate cookie but a cleared localStorage session). Unbranded on
// purpose — same rule as the edge login page (the reviewer, 2026-07-10).

import { useRef, useState } from "react";
import { getSupabase } from "./client";
import { postSignInRequest, REQUEST_MESSAGE_MAX, REQUEST_NAME_MAX } from "../review/request-access";

/** Focus is a pseudo-class, so it can't live in the inline styles below —
 *  every gate input carries this class and each gate screen renders the tag. */
export const GATE_FOCUS_CSS = `.gate-input:focus { outline: none; border-color: #111 !important; box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.08); }`;

export const gateStyles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100svh",
    display: "grid",
    placeItems: "center",
    fontFamily: "system-ui, 'Segoe UI', Roboto, sans-serif",
  },
  form: { display: "grid", gap: 12, width: "min(320px, 85vw)", textAlign: "center" },
  h1: { fontSize: 18, fontWeight: 600, margin: 0 },
  hint: { margin: 0, fontSize: 14, opacity: 0.7 },
  input: { font: "inherit", padding: "10px 18px", borderRadius: 9999, border: "1px solid #8884" },
  button: {
    font: "inherit",
    padding: "10px 18px",
    borderRadius: 9999,
    border: "none",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
  },
  linkish: {
    font: "inherit",
    fontSize: 13,
    padding: 4,
    border: "none",
    background: "none",
    color: "inherit",
    opacity: 0.6,
    cursor: "pointer",
  },
  // Rendered only when there's a message, so the button sits tight under the
  // input and moves down when an error appears.
  error: { color: "#c0392b", fontSize: 14, margin: 0 },
  textarea: {
    font: "inherit",
    padding: "10px 14px",
    borderRadius: 14,
    border: "1px solid #8884",
    resize: "vertical",
    textAlign: "left",
  },
};

/** On Vercel, a fresh in-app sign-in also refreshes the edge gate cookie so
 *  the next full page load doesn't bounce to the edge login. 404s harmlessly
 *  in local dev where the middleware (and the cookie) don't exist. */
export function refreshGateCookie(accessToken: string): void {
  void fetch("/__gate/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ access_token: accessToken }),
  }).catch(() => {});
}

export function LoginGate() {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The code has actually gone out (the code screen shows before it has).
  const [sent, setSent] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);
  // The refusal is the only place a request makes sense, so the ask appears
  // under it rather than sitting on the door as a second thing to read.
  const [refused, setRefused] = useState(false);
  const [asking, setAsking] = useState(false);
  const [askName, setAskName] = useState("");
  const [askNote, setAskNote] = useState("");
  const [askError, setAskError] = useState("");
  const [asked, setAsked] = useState(false);

  // The press moves you to the code screen AT ONCE and the send happens
  // behind it (the reviewer, 2026-09-07: a slow send read as nothing happening, so
  // the button got pressed again). `busy` allows one send at a time; a
  // failed send brings the email screen back with the reason.
  const sendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const sb = getSupabase();
    if (!sb || busy) return;
    setBusy(true);
    setError("");
    setSent(false);
    setRefused(false);
    setAsking(false);
    setAsked(false);
    setStep("code");
    requestAnimationFrame(() => codeRef.current?.focus());
    const { error: err } = await sb.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (err) {
      // One generic line for rejections — the allowlist stays invisible.
      setStep("email");
      const throttled = err.status === 429;
      setError(throttled ? "Too many attempts. Try again in a minute." : "That email isn't authorized for this preview.");
      setRefused(!throttled);
      return;
    }
    setSent(true);
  };

  const askForAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setAskError("");
    const problem = await postSignInRequest({ email: email.trim(), name: askName, message: askNote });
    setBusy(false);
    if (problem) {
      setAskError(problem);
      return;
    }
    setAsked(true);
  };

  const verify = async (e?: React.FormEvent, token = code) => {
    e?.preventDefault();
    const sb = getSupabase();
    if (!sb || busy || !sent) return;
    setBusy(true);
    setError("");
    const { data, error: err } = await sb.auth.verifyOtp({ email: email.trim(), token: token.trim(), type: "email" });
    setBusy(false);
    if (err || !data.session) {
      setError(
        err?.status === 429 ? "Too many attempts. Try again in a minute." : "That code didn't work. Check it and try again.",
      );
      return;
    }
    refreshGateCookie(data.session.access_token);
    // Session state propagates via onAuthStateChange in AuthGate.
  };

  return (
    <div style={gateStyles.page}>
      <style>{GATE_FOCUS_CSS}</style>
      {step === "email" ? (
        <div style={gateStyles.form}>
        <form style={gateStyles.form} onSubmit={sendCode}>
          <h1 style={gateStyles.h1}>Log in</h1>
          <p style={gateStyles.hint}>Enter your email and we&rsquo;ll send a one-time code.</p>
          <input
            className="gate-input"
            style={gateStyles.input}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@address.com"
            autoComplete="email"
            autoFocus
            required
          />
          {error ? <p style={gateStyles.error}>{error}</p> : null}
          <button style={gateStyles.button} type="submit" disabled={busy}>
            Send code
          </button>
        </form>
        {refused && !asked ? (
          asking ? (
            <form style={gateStyles.form} onSubmit={askForAccess}>
              <input
                className="gate-input"
                style={gateStyles.input}
                value={askName}
                onChange={(e) => setAskName(e.target.value.slice(0, REQUEST_NAME_MAX))}
                placeholder="Your name (optional)"
                autoComplete="name"
              />
              <textarea
                className="gate-input"
                style={gateStyles.textarea}
                value={askNote}
                onChange={(e) => setAskNote(e.target.value.slice(0, REQUEST_MESSAGE_MAX))}
                rows={3}
                placeholder="A short note (optional)"
              />
              {askError ? <p style={gateStyles.error}>{askError}</p> : null}
              <button style={gateStyles.button} type="submit" disabled={busy}>
                Send request
              </button>
            </form>
          ) : (
            <button style={gateStyles.linkish} type="button" onClick={() => setAsking(true)}>
              Request access
            </button>
          )
        ) : null}
        {asked ? <p style={gateStyles.hint}>Request sent. We&rsquo;ll email you if it&rsquo;s approved.</p> : null}
        </div>
      ) : (
        <form style={gateStyles.form} onSubmit={verify}>
          <h1 style={gateStyles.h1}>Enter the code</h1>
          <p style={gateStyles.hint}>{sent ? `We sent a 6-digit code to ${email.trim()}.` : `Sending a 6-digit code to ${email.trim()}…`}</p>
          <input
            ref={codeRef}
            className="gate-input"
            style={{ ...gateStyles.input, textAlign: "center", letterSpacing: "0.3em" }}
            value={code}
            onChange={(e) => {
              // Digits only; the 6th digit submits, so pasting from the email
              // signs you in without touching the button.
              const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(digits);
              if (digits.length === 6) void verify(undefined, digits);
            }}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            required
          />
          {error ? <p style={gateStyles.error}>{error}</p> : null}
          <button style={gateStyles.button} type="submit" disabled={busy || !sent}>
            Continue
          </button>
          <button
            style={gateStyles.linkish}
            type="button"
            onClick={() => {
              setStep("email");
              setCode("");
              setError("");
            }}
          >
            Use a different email
          </button>
        </form>
      )}
    </div>
  );
}
