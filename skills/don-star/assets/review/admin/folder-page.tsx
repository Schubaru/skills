// One folder's access, on its own page.
//
// The panel is the SAME one a project gets (share-panel.tsx), pointed at a
// folder — one screen for "who can open this", whatever this is. What the page
// adds is the two things only a folder has: a name that can change, and a list
// of what is inside it.
//
// Archive has no page: it cannot be renamed, deleted or shared, so the table
// sends nobody here.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteFolder, deleteFolderConfirm, renameFolder } from "../access";
import { CaretLeft } from "../icons";
import { SharePanel } from "../share-panel";
import { folderProjects, type AdminData } from "./data";
import { MoveControl } from "./move-control";

export function FolderPage({ data, id }: { data: AdminData; id: number }) {
  const folder = data.folders.find((f) => f.id === id) ?? null;
  const held = folderProjects(data.items, id);

  if (!folder || folder.isArchive) {
    return (
      <>
        <Crumb />
        <div className="rv-adm-card">
          <p className="rv-adm-empty">
            {data.loading
              ? "Loading…"
              : folder
                ? "Archive is built in. It cannot be renamed, deleted or shared."
                : "That folder is no longer there."}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <Crumb />
      <div className="rv-page-head">
        <h1>{folder.name}</h1>
        <p>
          {held.length === 0
            ? "Nothing is filed here yet."
            : `${held.length} ${held.length === 1 ? "project" : "projects"} filed here.`}
        </p>
      </div>

      {data.error ? <p className="rv-folder-error">{data.error}</p> : null}

      <NameField data={data} id={folder.id} value={folder.name} />

      <section className="rv-folder-section">
        <div className="rv-folder-sechead">
          <h2>Projects</h2>
          <p>Everyone on this folder opens all of these, and anything moved in later.</p>
        </div>
        <div className="rv-adm-card">
          {held.length === 0 ? (
            <p className="rv-adm-empty">Move a project here from the Projects tab.</p>
          ) : (
            <table className="rv-adm-table">
              <caption className="rv-sr-only">Projects in this folder</caption>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Folder</th>
                </tr>
              </thead>
              <tbody>
                {held.map((p) => (
                  <tr key={p.slug}>
                    <td data-label="Project">
                      <Link className="rv-adm-link rv-adm-name" to={`/projects/access/p/${encodeURIComponent(p.slug)}`}>
                        {p.name}
                      </Link>
                      <span className="rv-adm-sub">{p.slug}</span>
                    </td>
                    <td data-label="Folder">
                      <MoveControl data={data} slug={p.slug} label={p.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <SharePanel folderId={folder.id} folderName={folder.name} variant="page" />

      <section className="rv-folder-section">
        <div className="rv-folder-sechead">
          <h2>Delete this folder</h2>
          <p>
            The projects inside become unfiled, never deleted. Nobody loses access a project grants directly, only
            access that came from this folder.
          </p>
        </div>
        <button
          type="button"
          className="rv-pill is-action rv-adm-danger"
          disabled={data.busy}
          onClick={() => {
            if (window.confirm(deleteFolderConfirm(folder.name))) void data.run(() => deleteFolder(folder.id));
          }}
        >
          Delete folder
        </button>
      </section>
    </>
  );
}

function Crumb() {
  return (
    <Link className="rv-backlink" to="/projects/access?tab=folders">
      <CaretLeft size={14} />
      Folders
    </Link>
  );
}

/** Rename. The same shape as the user page's name field, because it is the
 *  same act: one value, saved when it has changed. */
function NameField({ data, id, value }: { data: AdminData; id: number; value: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const dirty = draft.trim() !== value.trim() && draft.trim().length > 0;

  return (
    <section className="rv-folder-section">
      <div className="rv-folder-sechead">
        <h2>Name</h2>
        <p>What the folder is called on the projects page and in every move menu.</p>
      </div>
      <form
        className="rv-adm-addform"
        onSubmit={(e) => {
          e.preventDefault();
          if (!dirty || data.busy) return;
          void data.run(() => renameFolder(id, draft));
        }}
      >
        <input
          className="rv-folder-input rv-adm-entry"
          aria-label="Folder name"
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
