// /flows — the flow-chart canvas.
//
// A project on the same folder as the review boards, behind the same email
// gate, with the same per-project grants (review/projects.ts, kind: "flows").
// What's different is who authors it: a review board is TSX in the repo, this
// is a document in the database that the people looking at it edit directly.
// So everything here is shared by default — an edit lands for whoever opens it
// next, which was the requirement.
//
// The left rail is ITERATIONS, not pages: forking a diagram is the main move.
// You argue about branching by putting two versions side by side, not by
// editing one until the argument is lost.

import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, Inspector, type Selection } from "./canvas";
import { deadEnds, orphans, unlabelledForks, type FlowDoc, type NodeKind } from "./model";
import { useFlowStore, type SaveState } from "./store";
import { CaretLeft, Check, Dots, Plus, Trash, Undo } from "../review/icons";
import { useThemePref } from "../review/theme";
import { ThemeRows } from "../review/theme-menu";
import { BRAND } from "../review/brand";
import { ShareButton } from "../review/share-panel";
import { canShare, useMyAccess } from "../review/use-access";
import "./flows.css";

export type FlowsAccount = { name: string; email: string; onSignOut: () => void } | null;

// --- header bits ------------------------------------------------------------

function SaveBadge({ state }: { state: SaveState }) {
  const [, tick] = useState(0);
  // "Saved 12s ago" has to keep counting or it silently becomes a lie.
  useEffect(() => {
    if (state.kind !== "saved") return;
    const t = setInterval(() => tick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, [state.kind]);

  if (state.kind === "loading") return <span className="fl-save">Loading…</span>;
  if (state.kind === "saving") return <span className="fl-save">Saving…</span>;
  if (state.kind === "dirty") return <span className="fl-save">Unsaved…</span>;
  if (state.kind === "error") return <span className="fl-save is-error">{state.message}</span>;
  if (state.kind === "local")
    return (
      <span className="fl-save is-local" title="No database configured — this canvas is in this browser only.">
        This browser only
      </span>
    );
  const secs = Math.round((Date.now() - state.at) / 1000);
  return (
    <span className="fl-save">
      <Check size={12} /> Saved{secs > 20 ? ` ${secs < 90 ? `${secs}s` : `${Math.round(secs / 60)}m`} ago` : ""}
    </span>
  );
}

function ShellMenu({ account }: { account: FlowsAccount }) {
  const { themePref, setThemePref } = useThemePref();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        className="rv-btn-icon is-bordered"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu"
        onClick={() => setOpen((o) => !o)}
      >
        <Dots size={17} />
      </button>
      {open ? (
        <div role="menu" className="rv-menu" style={{ top: "100%", right: 0, marginTop: 8, width: 256 }}>
          <ThemeRows theme={themePref} onTheme={setThemePref} />
          {account ? (
            <>
              <div className="rv-menu-sep" aria-hidden />
              <div className="rv-menu-item" style={{ cursor: "default", opacity: 0.7 }} title={account.email}>
                Signed in as {account.name}
              </div>
              <button type="button" role="menuitem" className="rv-menu-item" onClick={account.onSignOut}>
                Sign out
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// --- the iteration rail -----------------------------------------------------

function Rail({
  docs,
  activeId,
  onPick,
  onAdd,
  onFork,
  onRename,
  onDelete,
}: {
  docs: FlowDoc[];
  activeId: string | null;
  onPick: (id: string) => void;
  onAdd: () => void;
  onFork: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <aside className="fl-rail">
      <div className="fl-rail-head">
        <span>Iterations</span>
        <button type="button" className="rv-btn-icon" title="New, empty" aria-label="New diagram" onClick={onAdd}>
          <Plus size={15} />
        </button>
      </div>
      <ul className="fl-rail-list">
        {docs.map((d) => {
          const on = d.id === activeId;
          return (
            <li key={d.id} className={on ? "fl-rail-item is-on" : "fl-rail-item"}>
              {editing === d.id ? (
                <input
                  className="fl-input"
                  autoFocus
                  defaultValue={d.title}
                  onBlur={(e) => {
                    onRename(d.id, e.target.value.trim() || d.title);
                    setEditing(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <button type="button" className="fl-rail-btn" onClick={() => onPick(d.id)} onDoubleClick={() => setEditing(d.id)}>
                  <span className="fl-rail-title">{d.title}</span>
                  <span className="fl-rail-meta">
                    {d.nodes.length} boxes
                    {d.updatedBy ? ` · ${d.updatedBy}` : ""}
                  </span>
                </button>
              )}
              {on ? (
                <div className="fl-rail-actions">
                  <button type="button" className="fl-mini-btn" onClick={() => onFork(d.id)}>
                    Fork
                  </button>
                  <button type="button" className="fl-mini-btn" onClick={() => setEditing(d.id)}>
                    Rename
                  </button>
                  <button
                    type="button"
                    className="rv-btn-icon is-danger"
                    aria-label={`Delete ${d.title}`}
                    title="Delete this iteration"
                    onClick={() => {
                      if (window.confirm(`Delete "${d.title}"? It goes for everyone, and there's no undo.`)) onDelete(d.id);
                    }}
                  >
                    <Trash size={14} />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// --- what the diagram is missing --------------------------------------------

function Issues({ doc, onSelect }: { doc: FlowDoc; onSelect: (sel: Selection) => void }) {
  const forks = unlabelledForks(doc);
  const loose = orphans(doc);
  const stops = deadEnds(doc);
  const total = forks.length + loose.length + stops.length;
  if (total === 0) return null;

  const rows: { label: string; nodes: typeof forks }[] = [
    { label: "fork with an unlabelled branch", nodes: forks },
    { label: "box with nothing leading in or out", nodes: loose },
    { label: "stops with nowhere to go", nodes: stops },
  ].filter((r) => r.nodes.length > 0);

  return (
    <div className="fl-issues">
      {rows.map((r) => (
        <div key={r.label} className="fl-issue-row">
          <span className="fl-issue-count">{r.nodes.length}</span>
          <span className="fl-issue-label">{r.label}</span>
          <span className="fl-issue-names">
            {r.nodes.slice(0, 4).map((n) => (
              <button key={n.id} type="button" className="fl-chip" onClick={() => onSelect({ kind: "node", id: n.id })}>
                {n.title || "Untitled"}
              </button>
            ))}
            {r.nodes.length > 4 ? <span className="fl-hint">+{r.nodes.length - 4}</span> : null}
          </span>
        </div>
      ))}
    </div>
  );
}

// --- the screen -------------------------------------------------------------

const ADD_KINDS: NodeKind[] = ["step", "decision", "outcome", "note"];

export function FlowsApp({
  slug,
  projectName,
  account,
  onFolder,
}: {
  slug: string;
  projectName: string;
  account: FlowsAccount;
  onFolder?: () => void;
}) {
  const { darkMode } = useThemePref();
  // Same one level of sharing as a review board (review/access-rules.ts).
  const access = useMyAccess();
  const store = useFlowStore(slug, account?.name ?? null);
  const [selection, setSelection] = useState<Selection>(null);
  const { mutate, undo, redo, canUndo, canRedo, active } = store;

  useEffect(() => setSelection(null), [store.activeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  /** Add a box in the middle of whatever is on screen. Double-clicking the
   *  canvas is the faster route; this exists for the kinds. */
  const addKind = useCallback(
    (kind: NodeKind) => {
      if (!active) return;
      // Below everything, so a new box never lands on top of an old one.
      const y = active.nodes.length ? Math.max(...active.nodes.map((n) => n.y)) + 160 : 0;
      const id = crypto.randomUUID().slice(0, 10);
      mutate((d) => ({ ...d, nodes: [...d.nodes, { id, kind, title: "", x: 0, y }] }));
      setSelection({ kind: "node", id });
    },
    [active, mutate],
  );

  return (
    <div className={darkMode ? "rv-root is-dark fl-root" : "rv-root fl-root"}>
      <header className="rv-header">
        <div className="rv-header-main">
          {onFolder ? (
            <button type="button" className="rv-backlink" onClick={onFolder} title="All projects">
              <CaretLeft size={14} />
            </button>
          ) : null}
          <a href={BRAND.url} target="_blank" rel="noreferrer" className="rv-logo-btn" title={BRAND.name}>
            <img src={BRAND.logo} alt={BRAND.name} className="rv-header-logo" />
          </a>
          <span className="fl-title">{projectName}</span>
          {active ? <span className="rv-header-sub">{active.title}</span> : null}
        </div>
        <SaveBadge state={store.save} />
        <div className="fl-tools">
          <button type="button" className="rv-btn-icon" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)" aria-label="Undo">
            <Undo size={16} />
          </button>
          <button
            type="button"
            className="rv-btn-icon fl-redo"
            disabled={!canRedo}
            onClick={redo}
            title="Redo (⇧⌘Z)"
            aria-label="Redo"
          >
            <Undo size={16} />
          </button>
          {ADD_KINDS.map((k) => (
            <button key={k} type="button" className="fl-add" onClick={() => addKind(k)}>
              <span className={`fl-swatch is-${k}`} aria-hidden />
              {k === "step" ? "Step" : k === "decision" ? "Decision" : k === "outcome" ? "Outcome" : "Note"}
            </button>
          ))}
        </div>
        {canShare(access, slug) ? <ShareButton slug={slug} projectName={projectName} /> : null}
        <ShellMenu account={account} />
      </header>

      {store.conflict ? (
        <div className="fl-conflict" role="alert">
          <span>
            <strong>{store.conflict.server.updatedBy ?? "Someone"}</strong> saved a different version of “
            {store.conflict.server.title}” while you were editing. Only one can survive.
          </span>
          <button type="button" className="fl-mini-btn" onClick={() => store.resolve("theirs")}>
            Keep theirs
          </button>
          <button type="button" className="fl-mini-btn is-strong" onClick={() => store.resolve("mine")}>
            Keep mine
          </button>
        </div>
      ) : null}

      <div className="fl-body">
        {store.docs ? (
          <Rail
            docs={store.docs}
            activeId={store.activeId}
            onPick={store.setActiveId}
            onAdd={() => store.addDoc("Untitled iteration")}
            onFork={(id) => {
              const src = store.docs?.find((d) => d.id === id);
              store.forkDoc(id, src ? `${src.title} — fork` : "Fork");
            }}
            onRename={(id, title) => {
              if (id === store.activeId) mutate((d) => ({ ...d, title }));
            }}
            onDelete={(id) => void store.removeDoc(id)}
          />
        ) : null}

        <div className="fl-stage">
          {active ? (
            <>
              <Canvas doc={active} mutate={mutate} selection={selection} onSelect={setSelection} />
              <Issues doc={active} onSelect={setSelection} />
            </>
          ) : (
            <div className="fl-blank">
              <p>{store.docs ? "No diagram yet." : "Loading…"}</p>
              {store.docs ? (
                <button type="button" className="rv-pill is-action" onClick={() => store.addDoc("First pass")}>
                  <Plus size={13} /> Start one
                </button>
              ) : null}
            </div>
          )}
        </div>

        {active ? <Inspector doc={active} selection={selection} mutate={mutate} onSelect={setSelection} /> : null}
      </div>
    </div>
  );
}
