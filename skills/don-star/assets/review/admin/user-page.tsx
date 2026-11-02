// One person (or one whole domain), and every project they hold.
//
// The checklist answers WHY, not just whether. A tick that came from the
// client.example domain rule cannot be unticked here, and saying so is the point:
// otherwise an admin unticks a box, nothing happens, and the screen looks
// broken when it is the grant that lives somewhere else.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  addProjectGrant,
  removeProjectGrant,
  setRuleAdmin,
  setRuleDisplayName,
  shareFolder,
  unshareFolder,
} from "../access";
import { CaretLeft } from "../icons";
import { PersonAvatar } from "../person";
import { isArchived, PROJECTS } from "../projects";
import { folderHold, holdReason, nameFor, orderedFolders, reasonLabel, type AdminData } from "./data";

export function UserPage({ data, id }: { data: AdminData; id: number }) {
  const rule = data.rules.find((r) => r.id === id) ?? null;
  const adminRules = data.rules.filter((r) => r.isAdmin);
  const lastAdmin = Boolean(rule?.isAdmin) && adminRules.length === 1;

  if (!rule) {
    return (
      <>
        <Crumb />
        <div className="rv-adm-card">
          <p className="rv-adm-empty">{data.loading ? "Loading…" : "That entry is no longer on the sign-in list."}</p>
        </div>
      </>
    );
  }

  const isDomain = rule.kind === "domain";
  const signedInName = isDomain ? "" : nameFor(rule.value, data.people, data.rules);

  return (
    <>
      <Crumb />
      <div className="rv-page-head">
        {isDomain ? null : <PersonAvatar className="rv-adm-avatar is-large" name={signedInName || rule.value} email={rule.value} />}
        <h1>{isDomain ? `Everyone at ${rule.value}` : signedInName || rule.value}</h1>
        <p>
          {isDomain
            ? "A domain rule. Anyone with an address here can request a code and sign in."
            : rule.value}
        </p>
      </div>

      {data.error ? <p className="rv-folder-error">{data.error}</p> : null}

      {!isDomain ? <NameField data={data} id={rule.id} value={rule.displayName ?? ""} /> : null}

      <section className="rv-folder-section">
        <div className="rv-folder-sechead">
          <h2>Role</h2>
          <p>An admin opens this console and holds every project. A member holds only what is granted below.</p>
        </div>
        <div className="rv-folder-panel">
          <label className="rv-folder-check">
            <input
              type="checkbox"
              checked={rule.isAdmin}
              disabled={data.busy || lastAdmin}
              onChange={() => void data.run(() => setRuleAdmin(rule.id, !rule.isAdmin))}
            />
            <span>
              Administers access
              {lastAdmin ? <span className="rv-folder-hint"> · the last administrator cannot stand down</span> : null}
            </span>
          </label>
        </div>
      </section>

      <section className="rv-folder-section">
        <div className="rv-folder-sechead">
          <h2>Projects</h2>
          <p>What they can open, and where each one comes from.</p>
        </div>
        <div className="rv-adm-card">
          <ul className="rv-adm-checks">
            {PROJECTS.map((p) => {
              const reason = holdReason(rule, data.grants, p.slug, data.folderGrants, data.items, data.folders);
              const held = reason.via !== "none";
              // Only a grant made TO this exact rule is this screen's to undo.
              const editable = reason.via === "direct" || reason.via === "none";
              return (
                <li key={p.slug}>
                  <input
                    type="checkbox"
                    id={`hold-${p.slug}`}
                    checked={held}
                    disabled={data.busy || !editable}
                    onChange={() =>
                      void data.run(() =>
                        reason.via === "direct"
                          ? removeProjectGrant(reason.grantId)
                          : addProjectGrant({ projectSlug: p.slug, kind: rule.kind, value: rule.value }),
                      )
                    }
                  />
                  <span className="rv-adm-checkbody">
                    <label htmlFor={`hold-${p.slug}`} className="rv-adm-name">
                      {p.name}
                    </label>
                    <span className="rv-adm-sub">
                      {reasonLabel(reason)}
                      {isArchived(p, data.folders, data.items) ? " · archived" : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <Folders data={data} rule={rule} />
    </>
  );
}

/** The folders this rule is ON. One tick is one folder_access row, and it hands
 *  over every project filed there — now and later — which is why the sub-line
 *  counts them rather than leaving the reader to look it up. Archive has no
 *  grants at all, so it is not on the list. */
function Folders({ data, rule }: { data: AdminData; rule: NonNullable<AdminData["rules"][number]> }) {
  const folders = orderedFolders(data.folders).filter((f) => !f.isArchive);
  if (folders.length === 0) return null;

  return (
    <section className="rv-folder-section">
      <div className="rv-folder-sechead">
        <h2>Folders</h2>
        <p>A folder hands over everything filed in it, including projects moved in later.</p>
      </div>
      <div className="rv-adm-card">
        <ul className="rv-adm-checks">
          {folders.map((f) => {
            const grant = folderHold(rule, data.folderGrants, f.id);
            const count = data.items.filter((i) => i.folderId === f.id).length;
            return (
              <li key={f.id}>
                <input
                  type="checkbox"
                  id={`folder-${f.id}`}
                  checked={Boolean(grant)}
                  disabled={data.busy || rule.isAdmin}
                  onChange={() =>
                    void data.run(() =>
                      grant
                        ? unshareFolder(grant.id)
                        : shareFolder(f.id, { kind: rule.kind, value: rule.value }),
                    )
                  }
                />
                <span className="rv-adm-checkbody">
                  <label htmlFor={`folder-${f.id}`} className="rv-adm-name">
                    {f.name}
                  </label>
                  <span className="rv-adm-sub">
                    {rule.isAdmin
                      ? "Administers access, so holds every folder"
                      : count === 0
                        ? "Empty for now"
                        : `${count} ${count === 1 ? "project" : "projects"}`}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function Crumb() {
  return (
    <Link className="rv-backlink" to="/projects/access?tab=users">
      <CaretLeft size={14} />
      Users
    </Link>
  );
}

/** The name an admin types for somebody who has not signed in yet. Whatever
 *  they type themselves later wins on their comments, so this is a courtesy
 *  rather than an identity. */
function NameField({ data, id, value }: { data: AdminData; id: number; value: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const dirty = draft.trim() !== value.trim();

  return (
    <section className="rv-folder-section">
      <div className="rv-folder-sechead">
        <h2>Name</h2>
        <p>What we call them before they have signed in and named themselves.</p>
      </div>
      <form
        className="rv-adm-addform"
        onSubmit={(e) => {
          e.preventDefault();
          if (!dirty || data.busy) return;
          void data.run(() => setRuleDisplayName(id, draft));
        }}
      >
        <input
          className="rv-folder-input rv-adm-entry"
          aria-label="Name"
          placeholder="No name yet"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="rv-pill is-action" disabled={!dirty || data.busy}>
          Save
        </button>
      </form>
    </section>
  );
}
