// /projects/access — the manage-access console (2026-09-18).
//
// It replaced a single scrolling screen that stacked every project's grants
// above the sign-in list above a read-back of both. That screen answered "what
// is true" but never "who is this person", and it grew a section per project.
// Tabs instead, each a list of one KIND of record, each row a door:
//   Users     everyone who can reach the preview → one person's page
//   Projects  the registry, and who can open each → that project's share panel
//   Folders   the groupings, which are also grants → that folder's share panel
//   Requests  who has knocked, pending first
//
// Admin only. Being ON a project is what lets you share it (access-rules.ts,
// canShare), and that lives in the share panel, reachable from the board. This
// console is the other half: the front door, and every project at once.
//
// The tab is on the URL so a link to one lands on it. Postgres decides all of
// it (supabase/project-access.sql, supabase/access-sharing.sql); nothing here
// is a second opinion.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CaretLeft, Folder, Envelope, Grid, People } from "../icons";
import { FolderShell, type FolderAccount } from "../folder";
import { pendingCount, useAdminData } from "./data";
import { FoldersTab } from "./folders-tab";
import { FolderPage } from "./folder-page";
import { ProjectsTab } from "./projects-tab";
import { ProjectPage } from "./project-page";
import { RequestsTab } from "./requests-tab";
import { UserPage } from "./user-page";
import { UsersTab } from "./users";
import "./admin.css";

export type AdminTab = "users" | "projects" | "folders" | "requests";

export function toTab(raw: string | null | undefined): AdminTab {
  return raw === "projects" || raw === "folders" || raw === "requests" ? raw : "users";
}

/** Which of the console's three surfaces is on screen. The page wrapper reads
 *  it off the route so this module never has to know the URL shape twice. */
export type AdminView =
  | { kind: "tabs"; tab: AdminTab }
  | { kind: "project"; slug: string }
  | { kind: "folder"; id: number }
  | { kind: "user"; id: number };

export function ManageAccess({ account, view }: { account: FolderAccount; view: AdminView }) {
  const data = useAdminData();
  const pending = pendingCount(data.requests);

  return (
    <FolderShell account={account} narrow>
      {view.kind === "tabs" ? (
        <>
          <Link className="rv-backlink" to="/projects">
            <CaretLeft size={14} />
            Projects
          </Link>
          <div className="rv-page-head">
            <h1>Manage access</h1>
            <p>Who can sign in, who sees which project, and who has asked.</p>
          </div>

          <nav className="rv-adm-tabs" aria-label="Manage access">
            <Tab to="users" on={view.tab} label="Users" icon={<People size={14} />} />
            <Tab to="projects" on={view.tab} label="Projects" icon={<Grid size={14} />} />
            <Tab to="folders" on={view.tab} label="Folders" icon={<Folder size={14} />} />
            <Tab
              to="requests"
              on={view.tab}
              label="Requests"
              icon={<Envelope size={14} />}
              badge={pending || undefined}
            />
          </nav>

          {data.error ? <p className="rv-folder-error">{data.error}</p> : null}

          {view.tab === "users" ? (
            <UsersTab data={data} myEmail={account?.email.toLowerCase() ?? ""} />
          ) : view.tab === "projects" ? (
            <ProjectsTab data={data} />
          ) : view.tab === "folders" ? (
            <FoldersTab data={data} />
          ) : (
            <RequestsTab data={data} />
          )}
        </>
      ) : view.kind === "project" ? (
        <ProjectPage data={data} slug={view.slug} />
      ) : view.kind === "folder" ? (
        <FolderPage data={data} id={view.id} />
      ) : (
        <UserPage data={data} id={view.id} />
      )}
    </FolderShell>
  );
}

function Tab({
  to,
  on,
  label,
  icon,
  badge,
}: {
  to: AdminTab;
  on: AdminTab;
  label: string;
  icon: ReactNode;
  badge?: number;
}) {
  const active = to === on;
  return (
    <Link
      to={`/projects/access?tab=${to}`}
      className={active ? "rv-adm-tab is-on" : "rv-adm-tab"}
      aria-current={active ? "page" : undefined}
    >
      {icon}
      {label}
      {badge ? (
        <span className="rv-adm-badge" aria-label={`${badge} waiting`}>
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/** What a non-admin gets. The database refuses the writes anyway, so this is
 *  the courtesy rather than the lock. */
export function NotYours({ account }: { account: FolderAccount }) {
  return (
    <FolderShell account={account} narrow>
      <div className="rv-page-head">
        <h1>Manage access</h1>
        <p>Only admins can open this page.</p>
      </div>
      <Link className="rv-pill is-action" to="/projects" style={{ alignSelf: "flex-start", width: "auto" }}>
        <CaretLeft size={13} />
        Back to projects
      </Link>
    </FolderShell>
  );
}
