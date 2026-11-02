// One project's access, on its own page.
//
// The panel is the SAME one anyone on a project gets from the board (share-panel.tsx),
// mounted here at page width. There is no admin-only variant of it on purpose:
// two screens that both add people to a project would disagree eventually.

import { Link } from "react-router-dom";
import { CaretLeft, OpenExternal } from "../icons";
import { findProject, hrefFor } from "../projects";
import { SharePanel } from "../share-panel";
import type { AdminData } from "./data";

export function ProjectPage({ data, slug }: { data: AdminData; slug: string }) {
  const entry = findProject(slug);
  // Where it is filed, when that is somewhere a grant can reach: Archive holds
  // no grants, so naming it would promise access nobody has.
  const filedIn = data.items.find((i) => i.projectSlug === slug)?.folderId;
  const folder = data.folders.find((f) => f.id === filedIn && !f.isArchive) ?? null;

  return (
    <>
      <Link className="rv-backlink" to="/projects/access?tab=projects">
        <CaretLeft size={14} />
        Projects
      </Link>

      {!entry ? (
        <div className="rv-adm-card">
          <p className="rv-adm-empty">There is no project with the slug {slug}.</p>
        </div>
      ) : (
        <>
          <div className="rv-adm-head">
            <div className="rv-page-head">
              <h1>{entry.name}</h1>
              <p>{entry.blurb}</p>
            </div>
            <a className="rv-pill is-action" href={hrefFor(entry)}>
              Open board
              <OpenExternal size={13} />
            </a>
          </div>
          <SharePanel
            slug={entry.slug}
            projectName={entry.name}
            inFolder={folder ? folder.name : null}
            variant="page"
          />
        </>
      )}
    </>
  );
}
