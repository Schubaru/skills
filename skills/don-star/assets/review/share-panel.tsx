// Share one project (2026-09-18). The Google-Docs shape, because that is the
// one every reviewer already knows: who is on it, one field to add someone,
// and a general-access row underneath.
//
// ONE level of permission. Being on a project is being able to share it, so
// this panel is the same for an admin and for anyone else who can open the
// board — the difference is only what the database lets through: a non-admin
// may add someone who could already sign in, and share_project() raises
// "That domain isn't allowed yet. Ask an admin." otherwise. Every RPC message
// is shown back VERBATIM: the SQL is the authority and it already speaks
// English, so paraphrasing it here would be a second, wrong rulebook.
//
// Two variants, one body: `dialog` adds the backdrop and the card (the board
// toolbar's Share pill), `page` fills whatever container the host gives it
// (the per-project access page).
//
// Two SUBJECTS, one body too (2026-09-18): a project, or a FOLDER — and so
// every project in it, now and later. The rules are the same one level
// (access-sharing.sql gives share_folder the same guardrail and the same
// sentences), so the panel swaps four functions and a line of copy rather than
// growing a second screen that would disagree eventually. Pending requests and
// Copy link stay project-only: you knock on a board, not on a heading.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  decideAccessRequest,
  fetchAccessRequests,
  fetchFolderMembers,
  fetchProjectMembers,
  isRemoteConfigured,
  parseAccessEntries,
  setFolderOpen,
  setProjectOpen,
  shareFolder,
  shareProject,
  unshareFolder,
  unshareProject,
  type AccessEntry,
  type AccessRequest,
  type ProjectMember,
} from "./access";
import { Check, Cross, Link, People } from "./icons";
import type { Person } from "./model";
import { PersonAvatar } from "./person";
import { useDirectory } from "./people-directory";
import { suggestPeople } from "./share-suggest";
import { findProject, hrefFor } from "./projects";
import "./share-panel.css";

/** What the add field will do, said in the same words as the button. */
function addSummary(entries: { kind: "email" | "domain"; value: string }[]): string {
  if (entries.length === 0) return "";
  if (entries.length === 1) {
    const e = entries[0]!;
    return e.kind === "domain" ? `Adds everyone at ${e.value}` : `Adds ${e.value}`;
  }
  return `Adds ${entries.length} entries`;
}

function initialOf(member: ProjectMember): string {
  const source = member.displayName?.trim() || member.value || "?";
  return source.slice(0, 1);
}

/** A member's name: their current one from the people directory (a rename in
 *  Edit profile shows here at once), else the name the RPC read, else the
 *  address. A domain is its sentence. */
function memberName(member: ProjectMember, dir?: ReadonlyMap<string, Person>): string {
  if (member.kind === "domain") return `Everyone at ${member.value}`;
  const current = member.value ? dir?.get(member.value.toLowerCase())?.name : undefined;
  return current?.trim() || member.displayName?.trim() || member.value || "Someone";
}

/** A person wears their profile look; a domain keeps its plain letter. */
function MemberAvatar({ member }: { member: ProjectMember }) {
  if (member.kind !== "email") {
    return (
      <span className="rv-share-avatar" aria-hidden>
        {initialOf(member)}
      </span>
    );
  }
  return <PersonAvatar className="rv-share-avatar" name={member.displayName?.trim() || member.value || "?"} email={member.value} />;
}

/** What the panel is sharing. One of the two shapes, never both — a subject
 *  with a slug AND a folder id would have two sets of rules to obey. */
export type ShareSubject =
  | {
      slug: string;
      projectName: string;
      folderId?: undefined;
      folderName?: undefined;
      /** The non-archive folder this project is filed in, if any. Named rather
       *  than listed: folder_members() raises for anyone who doesn't hold the
       *  folder, so the panel can say WHERE the extra access comes from without
       *  pretending it can read who is on it. */
      inFolder?: string | null;
    }
  | {
      folderId: number;
      folderName: string;
      slug?: undefined;
      projectName?: undefined;
      inFolder?: undefined;
    };

export type SharePanelProps = ShareSubject & {
  variant: "dialog" | "page";
  onClose?: () => void;
};

export function SharePanel(props: SharePanelProps) {
  const { variant, onClose } = props;
  const isFolder = props.folderId !== undefined;
  const subjectName = isFolder ? props.folderName! : props.projectName!;
  const slug = props.slug ?? "";
  const folderId = props.folderId ?? -1;
  const remote = isRemoteConfigured();
  const [members, setMembers] = useState<ProjectMember[] | null>(null);
  const dir = useDirectory();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [active, setActive] = useState(0);
  const addRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!remote) return;
    if (isFolder) {
      setMembers(await fetchFolderMembers(folderId));
      setRequests([]);
      return;
    }
    const [rows, reqs] = await Promise.all([fetchProjectMembers(slug), fetchAccessRequests(slug)]);
    setMembers(rows);
    setRequests(reqs.filter((r) => r.status === "pending"));
  }, [remote, isFolder, folderId, slug]);

  // The four writes, picked once. Everything below calls these and shows the
  // message back verbatim, so neither subject grows its own error vocabulary.
  const add = useCallback(
    (entry: AccessEntry) => (isFolder ? shareFolder(folderId, entry) : shareProject(slug, entry)),
    [isFolder, folderId, slug],
  );
  const drop = useCallback(
    (id: number) => (isFolder ? unshareFolder(id) : unshareProject(id)),
    [isFolder],
  );
  const openTo = useCallback(
    (open: boolean) => (isFolder ? setFolderOpen(folderId, open) : setProjectOpen(slug, open)),
    [isFolder, folderId, slug],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The dialog is modal: Esc closes it, and focus starts in the add field
  // because adding someone is why the panel was opened.
  useEffect(() => {
    if (variant !== "dialog") return;
    addRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [variant, onClose]);

  const parsed = useMemo(() => parseAccessEntries(draft), [draft]);
  const singleEmail = parsed.entries.length === 1 && parsed.entries[0]!.kind === "email";

  const people = (members ?? []).filter((m) => m.kind !== "all");
  const openRow = (members ?? []).find((m) => m.kind === "all") ?? null;

  const suggestions = useMemo(() => {
    const taken = new Set(people.filter((m) => m.kind === "email").map((m) => (m.value ?? "").toLowerCase()));
    return suggestPeople(draft, dir, taken);
  }, [draft, dir, people]);
  const current = suggestions.length ? Math.min(active, suggestions.length - 1) : -1;

  /** Picking a person fills the field with their address and carries their
   *  directory name across, so Add stores the name they already go by. Someone
   *  already on the project is shown, not picked: there is nothing to add. */
  const pick = (p: Person & { onProject?: boolean }) => {
    if (p.onProject) return;
    setDraft(p.email);
    setName(p.name);
    setActive(0);
    addRef.current?.focus();
  };

  const submit = async () => {
    if (!parsed.entries.length || busy) return;
    setBusy(true);
    setError(null);
    for (const entry of parsed.entries) {
      const typed = singleEmail ? name.trim() : "";
      const message = await add(typed ? { ...entry, name: typed } : entry);
      if (message) {
        setError(message);
        setBusy(false);
        await load();
        return;
      }
    }
    setDraft("");
    setName("");
    setBusy(false);
    await load();
  };

  const remove = async (id: number) => {
    setBusy(true);
    setError(null);
    const message = await drop(id);
    if (message) setError(message);
    setBusy(false);
    await load();
  };

  const setOpen = async (open: boolean) => {
    if (Boolean(openRow) === open || busy) return;
    setBusy(true);
    setError(null);
    const message = await openTo(open);
    if (message) setError(message);
    setBusy(false);
    await load();
  };

  const decide = async (id: number, approve: boolean) => {
    setBusy(true);
    setError(null);
    const message = await decideAccessRequest(id, approve);
    if (message) setError(message);
    setBusy(false);
    await load();
  };

  const copyLink = async () => {
    const entry = findProject(slug);
    const href = entry ? hrefFor(entry) : `/review?project=${encodeURIComponent(slug)}`;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Could not copy the link. Copy it from the address bar instead.");
    }
  };

  const body = (
    <div
      className={variant === "dialog" ? "rv-share is-dialog" : "rv-share"}
      role={variant === "dialog" ? "dialog" : undefined}
      aria-modal={variant === "dialog" ? true : undefined}
      aria-label={isFolder ? `Share the folder ${subjectName}` : `Share ${subjectName}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="rv-share-head">
        <h2 className="rv-share-title">
          {isFolder ? "Share the folder" : "Share"} “{subjectName}”
        </h2>
        {variant === "dialog" ? (
          <button type="button" className="rv-btn-icon" onClick={onClose} aria-label="Close">
            <Cross size={16} />
          </button>
        ) : null}
      </div>

      {isFolder ? (
        <p className="rv-share-note">
          People added here can open every project in this folder, including projects moved in later.
        </p>
      ) : props.inFolder ? (
        // Not a list: folder_members() raises for anyone who doesn't hold the
        // folder, so the panel names the folder and stops there.
        <p className="rv-share-note">Also shared through the folder “{props.inFolder}”.</p>
      ) : null}

      {!remote ? (
        <p className="rv-share-note">Sharing needs the live board. This copy is running without a database.</p>
      ) : (
        <>
          {requests.length ? (
            <section className="rv-share-section">
              <h3 className="rv-share-label">Waiting to be let in</h3>
              {requests.map((r) => (
                <div key={r.id} className="rv-share-request">
                  <div className="rv-share-who">
                    <div className="rv-share-name">{r.name?.trim() || r.email}</div>
                    <div className="rv-share-sub">{r.email}</div>
                  </div>
                  {r.message ? <p className="rv-share-message">{r.message}</p> : null}
                  <div className="rv-share-request-actions">
                    <button
                      type="button"
                      className="rv-share-btn is-strong"
                      disabled={busy}
                      onClick={() => void decide(r.id, true)}
                    >
                      Approve
                    </button>
                    <button type="button" className="rv-share-btn" disabled={busy} onClick={() => void decide(r.id, false)}>
                      Deny
                    </button>
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          <section className="rv-share-section">
            <div className="rv-share-add-row">
              <input
                ref={addRef}
                className="rv-input"
                value={draft}
                placeholder="Add an email or a domain"
                aria-label="Add an email or a domain"
                role="combobox"
                aria-expanded={suggestions.length > 0}
                aria-controls="rv-share-suggest"
                aria-activedescendant={current >= 0 ? `rv-share-suggest-${current}` : undefined}
                autoComplete="off"
                onChange={(e) => {
                  setDraft(e.target.value);
                  setActive(0);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (suggestions.length && e.key === "ArrowDown") {
                    e.preventDefault();
                    setActive((a) => (a + 1) % suggestions.length);
                    return;
                  }
                  if (suggestions.length && e.key === "ArrowUp") {
                    e.preventDefault();
                    setActive((a) => (a - 1 + suggestions.length) % suggestions.length);
                    return;
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    // Enter on a suggestion takes it; Enter on an address adds it.
                    if (current >= 0 && draft.trim().toLowerCase() !== suggestions[current]!.email) pick(suggestions[current]!);
                    else void submit();
                  }
                }}
              />
              <button
                type="button"
                className="rv-share-btn is-strong"
                disabled={!parsed.entries.length || busy}
                onClick={() => void submit()}
              >
                Add
              </button>
            </div>
            {suggestions.length ? (
              <div id="rv-share-suggest" className="rv-mention-menu rv-share-suggest" role="listbox" aria-label="People who have signed in">
                {suggestions.map((p, i) => (
                  <button
                    key={p.email}
                    id={`rv-share-suggest-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === current}
                    aria-disabled={p.onProject || undefined}
                    className={`rv-mention-item${i === current ? " is-active" : ""}${p.onProject ? " is-taken" : ""}`}
                    onMouseEnter={() => setActive(i)}
                    // mousedown, not click: a click would blur the field first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(p);
                    }}
                  >
                    <PersonAvatar name={p.name} email={p.email} size={22} className="rv-share-avatar" />
                    <span className="rv-mention-name">{p.name}</span>
                    <span className="rv-mention-email">{p.email}</span>
                    {p.onProject ? <span className="rv-share-taken">Already added</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
            {/* The name is only meaningful on one address, so it appears only
                then rather than sitting empty beside a pasted list. */}
            {singleEmail ? (
              <input
                className="rv-input"
                value={name}
                placeholder="Name shown on their comments"
                aria-label="Name shown on their comments"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            ) : null}
            {parsed.entries.length ? <p className="rv-share-hint">{addSummary(parsed.entries)}</p> : null}
            {parsed.rejected.length ? (
              <p className="rv-share-hint">Could not read: {parsed.rejected.join(", ")}</p>
            ) : null}
            {error ? (
              <p className="rv-share-error" role="alert">
                {error}
              </p>
            ) : null}
          </section>

          <section className="rv-share-section is-people">
            <h3 className="rv-share-label">
              People with access{people.length ? ` · ${people.length}` : ""}
            </h3>
            {members === null ? (
              <p className="rv-share-hint">Loading…</p>
            ) : people.length === 0 ? (
              <p className="rv-share-hint">Nobody has been added yet.</p>
            ) : (
              <div className="rv-share-list">
                {people.map((m) => (
                  <div key={m.id} className="rv-share-row">
                    <MemberAvatar member={m} />
                    <div className="rv-share-who">
                      <div className="rv-share-name">{memberName(m, dir)}</div>
                      {m.kind === "email" && m.displayName?.trim() ? <div className="rv-share-sub">{m.value}</div> : null}
                    </div>
                    <button
                      type="button"
                      className="rv-btn-icon is-danger"
                      disabled={busy}
                      onClick={() => void remove(m.id)}
                      title={`Remove ${memberName(m, dir)}`}
                      aria-label={`Remove ${memberName(m, dir)}`}
                    >
                      <Cross size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="rv-share-note">Admins always have access.</p>
          </section>

          <section className="rv-share-section">
            <h3 className="rv-share-label">General access</h3>
            <div>
              <button
                type="button"
                role="radio"
                aria-checked={!openRow}
                className={openRow ? "rv-share-choice" : "rv-share-choice is-on"}
                disabled={busy}
                onClick={() => void setOpen(false)}
              >
                <People size={16} aria-hidden />
                <span className="rv-share-who">
                  <span className="rv-share-name">Only people added</span>
                  <span className="rv-share-sub">Everyone above, plus admins.</span>
                </span>
                {!openRow ? <Check size={14} aria-hidden /> : null}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={Boolean(openRow)}
                className={openRow ? "rv-share-choice is-on" : "rv-share-choice"}
                disabled={busy}
                onClick={() => void setOpen(true)}
              >
                <People size={16} aria-hidden />
                <span className="rv-share-who">
                  <span className="rv-share-name">Everyone who can sign in</span>
                  <span className="rv-share-sub">
                    Anyone on the sign-in allowlist opens {isFolder ? "everything in this folder" : "this project"}.
                  </span>
                </span>
                {openRow ? <Check size={14} aria-hidden /> : null}
              </button>
            </div>
          </section>
        </>
      )}

      {/* A folder is not a destination: there is no /folders/<id> to open, so
          there is no link to copy and the foot exists only for Done. */}
      {isFolder && variant !== "dialog" ? null : (
        <div className="rv-share-foot">
          {isFolder ? null : (
            <button type="button" className="rv-share-btn" onClick={() => void copyLink()}>
              <Link size={14} aria-hidden />
              {copied ? "Link copied" : "Copy link"}
            </button>
          )}
          <span className="rv-share-spacer" />
          {variant === "dialog" ? (
            <button type="button" className="rv-share-btn is-strong" onClick={onClose}>
              Done
            </button>
          ) : null}
        </div>
      )}
    </div>
  );

  if (variant !== "dialog") return body;
  return (
    <div className="rv-share-backdrop" onPointerDown={() => onClose?.()}>
      {body}
    </div>
  );
}

/** The toolbar control, so the board and the flow canvas open the same thing
 *  the same way. Render it only where canShare() already said yes. */
export function ShareButton({ slug, projectName }: { slug: string; projectName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    ref.current?.focus();
  }, []);

  return (
    <>
      <button
        ref={ref}
        type="button"
        className="rv-share-open"
        onClick={() => setOpen(true)}
        title={`Share ${projectName}`}
        aria-haspopup="dialog"
      >
        <People size={14} aria-hidden />
        Share
      </button>
      {/* Portalled to the board root: the toolbar's backdrop-filter makes it the
          containing block for position:fixed, which pinned the dialog to the
          toolbar. The root keeps the rv-* variables and the dark class. */}
      {open
        ? createPortal(
            <SharePanel slug={slug} projectName={projectName} variant="dialog" onClose={close} />,
            ref.current?.closest(".rv-root") ?? document.body,
          )
        : null}
    </>
  );
}
