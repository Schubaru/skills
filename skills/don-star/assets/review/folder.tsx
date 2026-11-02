// One level above a board: the projects folder (2026-08-13).
//
// The folder only appears when there is a choice to make — an account with one
// project lands in that project (see Review.tsx). A chooser with one option is
// a lie about how much is behind it.
//
// A card's picture is the project's OWN lead screen (project-thumb.tsx), taken
// from the same capture cache the board frames paint from. Nothing on this page
// is decorative: the thumbnail is the board, the counts are read off the config,
// and a project with no screens shows an empty canvas because that's what it is.
//
// Manage access lives next door in admin/ — it is admin-only, three tabs deep,
// and has pages of its own. The folder keeps the button that opens it.
// FolderShell is exported for that console, so both pages wear one chrome.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createFolder,
  createFolderWith,
  deleteFolder,
  deleteFolderConfirm,
  isRemoteConfigured,
  moveConfirmText,
  moveProject,
  renameFolder,
} from "./access";
import type { Folder as FolderRecord, FolderGrant, FolderItem } from "./access-rules";
import { CaretDown, Check, Dots, Folder as FolderIcon, Lock, People, Plus } from "./icons";
import {
  groupByFolder,
  orderedFolders,
  summarize,
  withEmptyFolders,
  type FolderGroup,
  type ProjectEntry,
  type ProjectSummary,
} from "./projects";
import { ProjectThumb } from "./project-thumb";
import { SharePanel } from "./share-panel";
import { FlowThumb } from "../flows/thumb";
import { useThemePref, type ThemePref } from "./theme";
import { ThemeRows } from "./theme-menu";
import { BRAND } from "./brand";

export type FolderAccount = { name: string; email: string; onSignOut: () => void } | null;

// --- shell ------------------------------------------------------------------

function ShellMenu({
  theme,
  onTheme,
  account,
}: {
  theme: ThemePref;
  onTheme: (theme: ThemePref) => void;
  account: FolderAccount;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
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
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu"
        title="Theme and account"
        className="rv-btn-icon is-bordered"
        style={open ? { background: "var(--rv-muted)", color: "var(--rv-fg)" } : undefined}
      >
        <Dots size={17} />
      </button>
      {open ? (
        <div role="menu" aria-label="Actions" className="rv-menu" style={{ top: "100%", right: 0, marginTop: 8, width: 256 }}>
          <ThemeRows theme={theme} onTheme={onTheme} />
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

/** Toolbar + centred content column. The toolbar carries identity and account
 *  only — the page names itself in its own heading, so the eye lands on the
 *  content rather than reading the title out of the chrome. */
export function FolderShell({
  account,
  action,
  /** Settings-width column: rows of prose and controls read better narrow than
   *  the grid does. */
  narrow,
  children,
}: {
  account: FolderAccount;
  action?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  const { themePref, setThemePref, darkMode } = useThemePref();
  return (
    <div className={darkMode ? "rv-root is-dark rv-folder-root" : "rv-root rv-folder-root"}>
      <header className="rv-header">
        <div className="rv-header-main">
          <a href={BRAND.url} target="_blank" rel="noreferrer" title={BRAND.name} className="rv-logo-btn">
            <img src={BRAND.logo} alt={BRAND.name} className="rv-header-logo" />
          </a>
        </div>
        {action}
        <ShellMenu theme={themePref} onTheme={setThemePref} account={account} />
      </header>
      <main className={narrow ? "rv-page is-narrow" : "rv-page"}>{children}</main>
    </div>
  );
}

// --- a menu that is not the shell's ------------------------------------------

/** The ⋯ menu the cards and the folder headings share. Kept generic and small:
 *  Esc closes it, focus returns to the trigger, and a pointer anywhere else
 *  dismisses it — the three things a menu owes a keyboard. */
function Menu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className="rv-fmenu">
      <button
        ref={button}
        type="button"
        className="rv-btn-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <Dots size={16} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="rv-menu"
          style={{ top: "100%", right: 0, marginTop: 6, width: 236 }}
        >
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}

// --- the folder -------------------------------------------------------------

export function ProjectsFolder({
  projects,
  folders,
  items,
  folderGrants,
  account,
  isAdmin,
  onOpen,
  onManageAccess,
  onReload,
}: {
  projects: ProjectEntry[];
  folders: FolderRecord[];
  items: FolderItem[];
  /** Admin-only (RLS): empty for everyone else, which is why the move
   *  confirmation and the heading's Share are admin surfaces here. */
  folderGrants: FolderGrant[];
  account: FolderAccount;
  isAdmin: boolean;
  onOpen: (slug: string) => void;
  onManageAccess: () => void;
  /** Re-read the access data after a folder was made, renamed, emptied or a
   *  project moved. The page is a picture of the database, so it asks again. */
  onReload: () => void;
}) {
  // Configs are lazy per project; the summary (counts + the screen that stands
  // for it) is read off the real config rather than authored a second time.
  const [summaries, setSummaries] = useState<Record<string, ProjectSummary>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [shareFolderId, setShareFolderId] = useState<number | null>(null);
  // The card menu's two dialogs: sharing ONE project, and naming a new folder
  // for one project to land in.
  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [folderFor, setFolderFor] = useState<ProjectEntry | null>(null);
  // Offline there are no folder rows to read and no write that would land, so
  // the managing controls are simply not there. Same tone as the share panel:
  // this copy is running without a database, and nothing pretends otherwise.
  const manage = isAdmin && isRemoteConfigured();

  // Headings come from the DATABASE; the code `archived` flag is what
  // groupByFolder falls back to when there are no folder rows to read. Empty
  // folders are put back for admins only: a folder made a moment ago holds
  // nothing, and a heading that disappears until it is filled cannot be used.
  const groups = useMemo(() => {
    const base = groupByFolder(projects, folders, items);
    return manage ? withEmptyFolders(base, folders) : base;
  }, [projects, folders, items, manage]);

  const live = groups
    .filter((g) => !g.folder?.isArchive)
    .reduce((n, g) => n + g.projects.length, 0);

  const run = (fn: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    void fn().then((message) => {
      if (message) setError(message);
      setBusy(false);
      onReload();
    });
  };

  const move = (slug: string, folder: FolderRecord | null) => {
    const ask = moveConfirmText(folder, folderGrants);
    if (ask && !window.confirm(ask)) return;
    run(() => moveProject(slug, folder ? folder.id : null));
  };

  const sharing = folders.find((f) => f.id === shareFolderId) ?? null;

  useEffect(() => {
    let on = true;
    for (const p of projects) {
      // A flows project has no config to read: its diagrams live in the
      // database, and the card says what it is rather than counting screens
      // it doesn't have.
      if (!p.load) continue;
      void p.load().then((config) => {
        if (on) setSummaries((prev) => ({ ...prev, [p.slug]: summarize(config) }));
      });
    }
    return () => {
      on = false;
    };
  }, [projects]);


  const card = (p: ProjectEntry, dim: boolean) => {
    const s = summaries[p.slug];
    return (
      // The ⋯ menu is a SIBLING of the card button, never inside it: a button
      // in a button is not reachable by keyboard and not valid HTML either.
      <li key={p.slug} className={dim ? "rv-pcard-wrap is-dim" : "rv-pcard-wrap"}>
        <button type="button" className="rv-pcard" onClick={() => onOpen(p.slug)}>
          {p.kind === "flows" ? <FlowThumb slug={p.slug} /> : <ProjectThumb shot={s ? s.shot : null} />}
          <span className="rv-pcard-foot">
            <span className="rv-pcard-name">{p.name}</span>
            <span className="rv-pcard-meta">
              {dim
                ? `Archived${s && s.screens > 0 ? ` · ${s.screens} screens` : ""}`
                : p.kind === "flows"
                  ? "Flow charts"
                  : !s
                    ? " "
                    : s.screens === 0
                      ? "Empty canvas"
                      : `${s.pages} ${s.pages === 1 ? "page" : "pages"} · ${s.screens} screens`}
            </span>
          </span>
        </button>
        {/* Whoever can open a project can share it (Decision 341), so every
            card on the live board has the menu; filing is the admins' half. */}
        {isRemoteConfigured() ? (
          <div className="rv-pcard-menu">
            <CardMenu
              name={p.name}
              folders={folders}
              at={items.find((i) => i.projectSlug === p.slug)?.folderId ?? null}
              busy={busy}
              canMove={manage}
              onShare={() => setShareSlug(p.slug)}
              onMove={(folder) => move(p.slug, folder)}
              onNewFolder={() => setFolderFor(p)}
            />
          </div>
        ) : null}
      </li>
    );
  };

  return (
    <FolderShell
      account={account}
      action={
        isAdmin ? (
          <>
            {manage ? (
              <button type="button" className="rv-pill is-action" disabled={busy} onClick={() => setAdding(true)}>
                <Plus size={13} />
                New folder
              </button>
            ) : null}
            <button type="button" className="rv-share-open" onClick={onManageAccess}>
              <People size={14} />
              Sharing
            </button>
          </>
        ) : null
      }
    >
      <div className="rv-page-head">
        <h1>Projects</h1>
        <p>{live === 1 ? "1 board" : `${live} boards`}</p>
      </div>

      {error ? <p className="rv-folder-error">{error}</p> : null}

      {adding ? (
        <NameForm
          label="Folder name"
          submit="Create"
          busy={busy}
          onCancel={() => setAdding(false)}
          onSubmit={(name) => {
            setAdding(false);
            run(() => createFolder(name));
          }}
        />
      ) : null}

      {projects.length === 0 && groups.length === 0 ? (
        <div className="rv-folder-empty">
          <Lock size={20} />
          <p className="rv-folder-empty-title">No projects yet</p>
          {/* Named, because "ask an administrator" sends nobody anywhere. */}
          <p className="rv-folder-empty-sub">
            Your account can sign in, but hasn't been given a project to review. Ask an admin to add you.
          </p>
        </div>
      ) : (
        groups.map((group) =>
          group.folder?.isArchive ? (
            <ArchiveSection key="archive" group={group} card={card} />
          ) : group.folder ? (
            <section key={group.folder.id} className="rv-folder-group">
              <FolderHeading
                folder={group.folder}
                count={group.projects.length}
                isAdmin={manage}
                canShare={manage || (isRemoteConfigured() && Boolean(group.folder!.held))}
                busy={busy}
                onShare={() => setShareFolderId(group.folder!.id)}
                onRename={(name) => run(() => renameFolder(group.folder!.id, name))}
                onDelete={() => {
                  if (window.confirm(deleteFolderConfirm(group.folder!.name))) {
                    run(() => deleteFolder(group.folder!.id));
                  }
                }}
              />
              {group.projects.length === 0 ? (
                <p className="rv-folder-hint">Move a project here from its menu.</p>
              ) : (
                <ul className="rv-folder-grid">{group.projects.map((p) => card(p, false))}</ul>
              )}
            </section>
          ) : (
            // The unfiled projects are the working set, so they lead with no
            // heading at all: a label above the thing you always want is a
            // label nobody reads.
            <ul key="unfiled" className="rv-folder-grid">
              {group.projects.map((p) => card(p, false))}
            </ul>
          ),
        )
      )}

      {shareSlug ? (
        <SharePanel
          slug={shareSlug}
          projectName={projects.find((p) => p.slug === shareSlug)?.name ?? shareSlug}
          variant="dialog"
          onClose={() => {
            setShareSlug(null);
            onReload();
          }}
        />
      ) : null}

      {folderFor ? (
        <div className="rv-share-backdrop" onPointerDown={() => setFolderFor(null)}>
          <div
            className="rv-share is-dialog"
            role="dialog"
            aria-modal
            aria-label={`New folder for ${folderFor.name}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <h2 className="rv-share-title">New folder for “{folderFor.name}”</h2>
            <NameForm
              label="Folder name"
              submit="Create and move"
              busy={busy}
              onCancel={() => setFolderFor(null)}
              onSubmit={(name) => {
                const slug = folderFor.slug;
                setFolderFor(null);
                run(() => createFolderWith(name, slug));
              }}
            />
          </div>
        </div>
      ) : null}

      {sharing ? (
        <SharePanel
          folderId={sharing.id}
          folderName={sharing.name}
          variant="dialog"
          onClose={() => setShareFolderId(null)}
        />
      ) : null}
    </FolderShell>
  );
}

/** Archive, folded shut. It is the record rather than the work, so it opens
 *  only when asked for, and its cards keep the dimmed treatment they had when
 *  the flag in code was the only thing that knew. */
function ArchiveSection({
  group,
  card,
}: {
  group: FolderGroup;
  card: (p: ProjectEntry, dim: boolean) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rv-folder-group">
      <button
        type="button"
        className={open ? "rv-folder-disclose is-open" : "rv-folder-disclose"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <CaretDown size={14} aria-hidden />
        <span className="rv-folder-gname">Archive</span>
        <span className="rv-folder-gcount">{group.projects.length}</span>
      </button>
      {open ? (
        <ul className="rv-folder-grid">{group.projects.map((p) => card(p, true))}</ul>
      ) : null}
    </section>
  );
}

/** One folder's heading: what it is called, how much is in it, and the two
 *  things that can be done to it. */
function FolderHeading({
  folder,
  count,
  isAdmin,
  canShare,
  busy,
  onShare,
  onRename,
  onDelete,
}: {
  folder: FolderRecord;
  count: number;
  isAdmin: boolean;
  canShare: boolean;
  busy: boolean;
  onShare: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const [renaming, setRenaming] = useState(false);

  if (renaming) {
    return (
      <NameForm
        label="Folder name"
        submit="Rename"
        value={folder.name}
        busy={busy}
        onCancel={() => setRenaming(false)}
        onSubmit={(name) => {
          setRenaming(false);
          onRename(name);
        }}
      />
    );
  }

  return (
    <div className="rv-folder-ghead">
      <FolderIcon size={15} aria-hidden />
      <h2 className="rv-folder-gname">{folder.name}</h2>
      <span className="rv-folder-gcount">
        {count} {count === 1 ? "project" : "projects"}
      </span>
      {canShare ? (
        <button type="button" className="rv-folder-gshare" onClick={onShare}>
          <People size={13} aria-hidden />
          Share
        </button>
      ) : null}
      {isAdmin ? (
        <Menu label={`Manage ${folder.name}`}>
          {(close) => (
            <>
              <button
                type="button"
                role="menuitem"
                className="rv-menu-item"
                onClick={() => {
                  close();
                  setRenaming(true);
                }}
              >
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className="rv-menu-item is-danger"
                onClick={() => {
                  close();
                  onDelete();
                }}
              >
                Delete
              </button>
            </>
          )}
        </Menu>
      ) : null}
    </div>
  );
}

/** One project's ⋯ menu: Share for whoever can open it, then (admins) where
 *  it is filed and everywhere it could go instead. The current location
 *  carries the tick, so the list reads as a choice already made; "New folder"
 *  closes it, because a folder is usually made for the project in hand. */
function CardMenu({
  name,
  folders,
  at,
  busy,
  canMove,
  onShare,
  onMove,
  onNewFolder,
}: {
  name: string;
  folders: FolderRecord[];
  at: number | null;
  busy: boolean;
  canMove: boolean;
  onShare: () => void;
  onMove: (folder: FolderRecord | null) => void;
  onNewFolder: () => void;
}) {
  const ordered = orderedFolders(folders);

  return (
    <Menu label={`Options for ${name}`}>
      {(close) => (
        <>
          <button
            type="button"
            role="menuitem"
            className="rv-menu-item"
            onClick={() => {
              close();
              onShare();
            }}
          >
            <People size={14} aria-hidden />
            <span className="rv-grow">Share</span>
          </button>
          {canMove ? (
            <>
              <div className="rv-menu-sep" aria-hidden />
              <div className="rv-menu-item" style={{ cursor: "default", opacity: 0.7 }}>
                Move to
              </div>
              <MoveRow on={at === null} busy={busy} label="No folder" onPick={() => { close(); onMove(null); }} />
              {ordered.map((f) => (
                <MoveRow
                  key={f.id}
                  on={at === f.id}
                  busy={busy}
                  label={f.name}
                  onPick={() => {
                    close();
                    onMove(f);
                  }}
                />
              ))}
              <div className="rv-menu-sep" aria-hidden />
              <button
                type="button"
                role="menuitem"
                className="rv-menu-item"
                disabled={busy}
                onClick={() => {
                  close();
                  onNewFolder();
                }}
              >
                <Plus size={14} aria-hidden />
                <span className="rv-grow">New folder</span>
              </button>
            </>
          ) : null}
        </>
      )}
    </Menu>
  );
}

function MoveRow({
  on,
  busy,
  label,
  onPick,
}: {
  on: boolean;
  busy: boolean;
  label: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={on}
      className="rv-menu-item"
      disabled={busy || on}
      onClick={onPick}
    >
      <span className="rv-grow">{label}</span>
      {on ? <Check size={13} aria-hidden /> : null}
    </button>
  );
}

/** One field and two buttons, for both making a folder and renaming one. */
function NameForm({
  label,
  submit,
  value = "",
  busy,
  onSubmit,
  onCancel,
}: {
  label: string;
  submit: string;
  value?: string;
  busy: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ready = draft.trim().length > 0 && !busy;

  return (
    <form
      className="rv-folder-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input
        autoFocus
        className="rv-folder-input rv-folder-nameinput"
        aria-label={label}
        placeholder={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <button type="submit" className="rv-pill is-action" disabled={!ready}>
        {submit}
      </button>
      <button type="button" className="rv-folder-cancel" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}
