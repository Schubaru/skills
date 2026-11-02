"use client";
import { useEffect, useRef, useState } from "react";
import { IconShare } from "./Icons";

/** Hands out one view-only link to the floor. Making a new link or turning it off locks out everyone holding the old one. */
export default function ShareButton() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const url = token ? `${location.origin}/watch/${token}` : "";

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetch("/api/share", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { token: string | null }) => setToken(j.token))
      .catch(() => setError("Couldn't load the link. Try again in a moment."));
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  const set = async (action: "create" | "off") => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!r.ok) throw new Error();
      setToken(((await r.json()) as { token: string | null }).token);
      setCopied(false);
    } catch {
      setError(action === "off" ? "Couldn't turn the link off. Try again." : "Couldn't make a link. Try again.");
    }
    setBusy(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Copy was blocked. Select the link and copy it by hand.");
    }
  };

  return (
    <div className="share" ref={box}>
      <button className="btn icon quiet" type="button" aria-label="Share a view-only link" title="Share" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <IconShare />
      </button>
      {open && (
        <div className="share-pop card" role="dialog" aria-label="Share a view-only link">
          <p className="share-title display">Share the floor</p>
          <p className="share-copy">Anyone with the link can watch the office and the agent table. They can&apos;t open an agent, answer it, nudge it, or stop it. Folders, branches, commands, and questions stay hidden.</p>
          {token === undefined && !error ? (
            <div className="skeleton" style={{ height: 30 }} />
          ) : token ? (
            <>
              <div className="share-link">
                <input className="input mono" readOnly value={url} aria-label="View-only link" onFocus={(e) => e.currentTarget.select()} />
                <button className="btn primary" type="button" onClick={copy} disabled={busy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="share-actions">
                <span className="status" data-s="working">
                  <span className="dot" />
                  Link is on
                </span>
                <span className="share-spacer" />
                <button className="btn sm quiet" type="button" onClick={() => set("create")} disabled={busy} title="The current link stops working">
                  New link
                </button>
                <button className="btn sm danger" type="button" onClick={() => set("off")} disabled={busy}>
                  Turn off
                </button>
              </div>
            </>
          ) : (
            token === null && (
              <button className="btn primary share-create" type="button" onClick={() => set("create")} disabled={busy}>
                {busy ? "Making link…" : "Create view-only link"}
              </button>
            )
          )}
          {error && (
            <p className="share-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
