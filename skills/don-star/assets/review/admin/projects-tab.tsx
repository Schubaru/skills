// The Projects tab: every project in the registry, and who can open it.
//
// The registry is CODE (projects.ts) and the grants are DATABASE, so this table
// lists all of the first and reads the second against it. An archived project
// still appears: its comments and grants are still keyed by its slug, and
// somebody still holds it.

import { Link } from "react-router-dom";
import { CaretRight } from "../icons";
import { isArchived, PROJECTS } from "../projects";
import { accessSummary, pendingFor, type AdminData } from "./data";
import { MoveControl } from "./move-control";

export function ProjectsTab({ data }: { data: AdminData }) {
  return (
    <div className="rv-adm-card">
      <table className="rv-adm-table">
        <caption className="rv-sr-only">Projects and who can open them</caption>
        <thead>
          <tr>
            <th scope="col">Project</th>
            <th scope="col">Who can open it</th>
            <th scope="col">Folder</th>
            <th scope="col">Requests</th>
            <th scope="col">
              <span className="rv-sr-only">Manage</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {PROJECTS.map((p) => {
            const pending = pendingFor(data.requests, p.slug);
            return (
              <tr key={p.slug}>
                <td data-label="Project">
                  <span className="rv-adm-prow">
                    <span className="rv-adm-thumb" aria-hidden>
                      {p.name.charAt(0)}
                    </span>
                    <span>
                      <Link className="rv-adm-link rv-adm-name" to={`/projects/access/p/${encodeURIComponent(p.slug)}`}>
                        {p.name}
                      </Link>
                      <span className="rv-adm-sub">
                        {isArchived(p, data.folders, data.items) ? "Archived · " : ""}
                        {p.slug}
                      </span>
                    </span>
                  </span>
                </td>
                <td data-label="Access">{accessSummary(data.grants, p.slug)}</td>
                <td data-label="Folder">
                  <MoveControl data={data} slug={p.slug} label={p.name} />
                </td>
                <td data-label="Requests">
                  {pending ? <span className="rv-adm-badge">{pending}</span> : <span className="rv-folder-hint">None</span>}
                </td>
                <td className="is-actions">
                  <Link className="rv-pill is-action" to={`/projects/access/p/${encodeURIComponent(p.slug)}`}>
                    Manage
                    <CaretRight size={13} />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
