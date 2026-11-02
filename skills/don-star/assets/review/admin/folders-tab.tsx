// The Folders tab: every folder, what is in it, and who can open it.
//
// A folder is a grant surface, not just a heading (supabase/access-sharing.sql):
// whoever is on it opens every project filed there, including projects moved in
// later. So this table reads like the Projects tab on purpose — the same "who
// can open it" sentence, the same Manage door — and the difference is only that
// one row can hand over several boards at once.
//
// Archive is last and has no door: it is built in, it cannot be shared, and a
// folder grant never reaches into it.

import { useState } from "react";
import { Link } from "react-router-dom";
import { createFolder } from "../access";
import { CaretRight, Plus } from "../icons";
import { folderProjects, folderSummary, orderedFolders, type AdminData } from "./data";

export function FoldersTab({ data }: { data: AdminData }) {
  const folders = orderedFolders(data.folders);

  return (
    <>
      <div className="rv-adm-card">
        <table className="rv-adm-table">
          <caption className="rv-sr-only">Folders and who can open them</caption>
          <thead>
            <tr>
              <th scope="col">Folder</th>
              <th scope="col">Projects</th>
              <th scope="col">Who can open it</th>
              <th scope="col">
                <span className="rv-sr-only">Manage</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {folders.map((f) => {
              const held = folderProjects(data.items, f.id);
              return (
                <tr key={f.id}>
                  <td data-label="Folder">
                    {f.isArchive ? (
                      <span className="rv-adm-name">{f.name}</span>
                    ) : (
                      <Link className="rv-adm-link rv-adm-name" to={`/projects/access/f/${f.id}`}>
                        {f.name}
                      </Link>
                    )}
                  </td>
                  <td data-label="Projects">
                    {held.length === 0 ? (
                      <span className="rv-folder-hint">Empty</span>
                    ) : (
                      <span className="rv-adm-chips">
                        {held.map((p) => (
                          <span key={p.slug} className="rv-folder-tag">
                            {p.name}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                  <td data-label="Access">{folderSummary(data.folderGrants, f)}</td>
                  <td className="is-actions">
                    {f.isArchive ? (
                      <span className="rv-folder-hint">Built in</span>
                    ) : (
                      <Link className="rv-pill is-action" to={`/projects/access/f/${f.id}`}>
                        Manage
                        <CaretRight size={13} />
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data.loading ? <p className="rv-adm-empty">Loading…</p> : null}
        {!data.loading && folders.length === 0 ? (
          <p className="rv-adm-empty">No folders yet. Every project is unfiled.</p>
        ) : null}
      </div>

      <NewFolder data={data} />
    </>
  );
}

function NewFolder({ data }: { data: AdminData }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ready = name.trim().length > 0 && !data.busy;

  const close = () => {
    setName("");
    setOpen(false);
  };

  if (!open) {
    return (
      <button type="button" className="rv-folder-addghost" onClick={() => setOpen(true)}>
        <Plus size={13} />
        New folder
      </button>
    );
  }

  return (
    <form
      className="rv-adm-addform"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready) return;
        const typed = name.trim();
        close();
        void data.run(() => createFolder(typed));
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input
        autoFocus
        className="rv-folder-input rv-adm-entry"
        aria-label="Folder name"
        placeholder="Folder name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" className="rv-pill is-action" disabled={!ready}>
        Create
      </button>
      <button type="button" className="rv-folder-cancel" onClick={close}>
        Cancel
      </button>
      <p className="rv-adm-hint">A new folder is empty and shared with nobody. Move projects in from their menu.</p>
    </form>
  );
}
