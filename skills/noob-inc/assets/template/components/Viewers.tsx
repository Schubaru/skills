"use client";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { agentName } from "@/lib/format";
import { type Agent, type AgentEvent, EMOTE_PER_MIN, EMOTES } from "@/lib/types";

const EMOTE_LABEL: Record<string, string> = { "☕": "Coffee", "📎": "Paperclip", "🚀": "Ship it", "❤️": "Love", "😴": "Sleepy" };
const FLOAT_MS = 2600;
const FLOAT_CAP = 24;

export type Viewer = { key: string; name: string };
type ViewerPayload = { kind?: string; by?: string; emoji?: string };

const storeKey = (token: string) => `noob-viewer:${token}`;

/** The viewer's name on this link: read from storage, re-checked with the server (which logs the visit). */
export function useViewer(token: string) {
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [ready, setReady] = useState(false);
  const url = `/api/watch/${encodeURIComponent(token)}`;

  const join = useCallback(
    async (body: { key?: string; name?: string }): Promise<string | null> => {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ act: "join", ...body }) });
        const j = (await res.json().catch(() => ({}))) as { key?: string; name?: string; error?: string };
        if (res.ok && j.key && j.name) {
          const v = { key: j.key, name: j.name };
          try {
            localStorage.setItem(storeKey(token), JSON.stringify(v));
          } catch {}
          setViewer(v);
          return null;
        }
        if (j.error === "taken") return "That name is taken on this link. Try another.";
        if (j.error === "name") return "Use 2 to 20 letters, numbers, spaces, dots, dashes or underscores.";
        if (res.status === 404) return "This link is off. Ask the owner for the current one.";
        return "Couldn't reach the office. Try again.";
      } catch {
        return "Couldn't reach the office. Check your connection and try again.";
      }
    },
    [token, url],
  );

  useEffect(() => {
    let saved: Viewer | null = null;
    try {
      saved = JSON.parse(localStorage.getItem(storeKey(token)) ?? "null");
    } catch {}
    if (!saved?.key) return setReady(true);
    // A key the server no longer knows (the link changed) falls back to picking a name again.
    join({ key: saved.key }).then((err) => {
      if (err) {
        try {
          localStorage.removeItem(storeKey(token));
        } catch {}
      }
      setReady(true);
    });
  }, [token, join]);

  return { viewer, ready, join: (name: string) => join({ name }) };
}

/** Shown instead of the floor until the viewer picks a name. Nothing personal: just what the log calls them. */
export function NameGate({ onJoin }: { onJoin: (name: string) => Promise<string | null> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(await onJoin(name));
    setBusy(false);
  };
  return (
    <main className="watch-off">
      <form className="gate card" onSubmit={submit}>
        <h1 className="display">Pick a name</h1>
        <p>It goes in the visitor log next to what you do here. No email, no account.</p>
        <label className="label" htmlFor="viewer-name">
          Name
        </label>
        <input
          id="viewer-name"
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          maxLength={20}
          autoComplete="nickname"
          autoFocus
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? "viewer-name-error" : undefined}
        />
        {error && (
          <p id="viewer-name-error" className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary" type="submit" disabled={busy || name.trim().length < 2}>
          {busy ? "Checking…" : "Enter the office"}
        </button>
      </form>
    </main>
  );
}

type Float = { id: string; emoji: string; by: string; x: number };

/** Emotes floating up over the office: other people's arrive with the feed, your own float the moment you tap. */
export function useEmoteFloats(events: AgentEvent[], me: string | null, loaded: boolean) {
  const [floats, setFloats] = useState<Float[]>([]);
  const seen = useRef<Set<number> | null>(null);
  const add = useCallback((emoji: string, by: string, id: string) => {
    // Spread across the width, but the same id always lands in the same spot on every screen.
    let h = 0;
    for (const c of id) h = Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0;
    setFloats((f) => [...f.slice(-(FLOAT_CAP - 1)), { id, emoji, by, x: 8 + (h % 78) }]);
    setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), FLOAT_MS);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const emotes = events.filter((e) => e.kind === "viewer" && (e.payload as ViewerPayload | null)?.kind === "emote");
    // The first loaded batch is history: mark it seen so a reload doesn't replay a minute of emotes.
    if (!seen.current) {
      seen.current = new Set(emotes.map((e) => e.id));
      return;
    }
    for (const e of emotes) {
      if (seen.current.has(e.id)) continue;
      seen.current.add(e.id);
      const p = e.payload as ViewerPayload;
      if (p.by && p.emoji && p.by !== me) add(p.emoji, p.by, String(e.id));
    }
  }, [events, me, add, loaded]);
  return { floats, add };
}

export function EmoteLayer({ floats }: { floats: Float[] }) {
  return (
    <div className="emote-layer" aria-hidden>
      {floats.map((f) => (
        <span key={f.id} className="emote-float" style={{ left: `${f.x}%` }}>
          <span className="emote-glyph">{f.emoji}</span>
          <span className="emote-by">{f.by}</span>
        </span>
      ))}
    </div>
  );
}

/** Five emotes, ten a minute. The server holds the same line; this just says so before you hit it. */
export function EmoteBar({ token, viewer, now, onSent }: { token: string; viewer: Viewer; now: number; onSent: (emoji: string) => void }) {
  const sent = useRef<number[]>([]);
  const [, bump] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const recent = sent.current.filter((t) => now - t < 60_000);
  const left = EMOTE_PER_MIN - recent.length;
  const wait = left > 0 ? 0 : Math.ceil((recent[0] + 60_000 - now) / 1000);

  const send = async (emoji: string) => {
    if (left <= 0) return;
    sent.current = [...recent, Date.now()];
    bump((n) => n + 1);
    setNote(null);
    onSent(emoji);
    try {
      const res = await fetch(`/api/watch/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ act: "emote", key: viewer.key, emoji }),
      });
      if (res.status === 429) setNote("The office is getting a lot of emotes. Give it a moment.");
      else if (!res.ok) setNote("That one didn't send. Try again.");
    } catch {
      setNote("That one didn't send. Check your connection.");
    }
  };

  return (
    <div className="emote-bar">
      <div className="emote-keys" role="group" aria-label="Send an emote">
        {EMOTES.map((e) => (
          <button key={e} type="button" className="emote-key" onClick={() => send(e)} disabled={left <= 0} aria-label={EMOTE_LABEL[e]} title={EMOTE_LABEL[e]}>
            {e}
          </button>
        ))}
      </div>
      <p className="emote-left num" aria-live="polite">
        {note ?? (left > 0 ? `${left} of ${EMOTE_PER_MIN} left this minute` : `Next emote in ${wait}s`)}
      </p>
    </div>
  );
}

/** How an onlooker's arrival reads in the log. Picked by event id, so a line never changes once written. */
const ARRIVALS = [
  "entered the office",
  "badged in",
  "signed the visitor log",
  "took the elevator up",
  "found a desk near the printer",
  "is here for the 10 o'clock",
  "hung a coat on the back of a chair",
  "walked in. Nobody looked up",
];

type Line = { id: number; at: string; by: string; kind: "join" | "emote" | "harass" | "coffee"; emojis: string[]; agent: Agent | null };

/** Who visited the shared link and what they did there. The owner sees the same log under their office. */
export function ViewerLog({ events, agents, me }: { events: AgentEvent[]; agents: Agent[]; me?: string | null }) {
  const lines = useMemo(() => {
    const byId = new Map(agents.map((a) => [a.id, a]));
    const out: Line[] = [];
    for (const e of events) {
      const p = (e.payload ?? {}) as ViewerPayload;
      if (!p.by) continue;
      const kind = e.kind === "viewer" ? p.kind : e.kind === "command" ? p.kind : null;
      if (kind !== "join" && kind !== "emote" && kind !== "harass" && kind !== "coffee") continue;
      const last = out[out.length - 1];
      // A run of emotes from one person within a minute reads as one line.
      if (kind === "emote" && last?.kind === "emote" && last.by === p.by && new Date(e.created_at).getTime() - new Date(last.at).getTime() < 60_000) {
        last.emojis.push(p.emoji ?? "");
        continue;
      }
      out.push({ id: e.id, at: e.created_at, by: p.by, kind, emojis: p.emoji ? [p.emoji] : [], agent: e.agent_id ? byId.get(e.agent_id) ?? null : null });
    }
    return out.reverse().slice(0, 80);
  }, [events, agents]);
  const people = new Set(lines.map((l) => l.by)).size;

  return (
    <section className="vlog card" aria-label="Onlooker log">
      <header className="vlog-head">
        <h2 className="display">Onlookers</h2>
        {people > 0 && <span className="label num">{people === 1 ? "1 person" : `${people} people`}</span>}
      </header>
      {lines.length === 0 ? (
        <p className="vlog-empty">Nobody has stopped by yet. When someone opens the shared link, their visits and emotes show up here.</p>
      ) : (
        <ol className="vlog-list">
          {lines.map((l) => (
            <li key={l.id} className="vlog-line">
              <time className="vlog-time num" dateTime={l.at}>
                {new Date(l.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
              </time>
              <span className="vlog-what">
                <b>{l.by}</b>
                {l.by === me && <span className="vlog-you"> (you)</span>} {l.kind === "join" && ARRIVALS[l.id % ARRIVALS.length]}
                {l.kind === "emote" && <span className="vlog-emojis">{l.emojis.join(" ")}</span>}
                {(l.kind === "harass" || l.kind === "coffee") && (
                  <>
                    {l.kind === "harass" ? "harassed " : "sent "}
                    {l.agent ? (
                      <span className="vlog-agent">
                        <span className="chip" style={{ background: `var(--l${l.agent.livery % 8})` }} aria-hidden />
                        {agentName(l.agent)}
                      </span>
                    ) : (
                      "someone"
                    )}
                    {l.kind === "coffee" && " for coffee"}
                  </>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
