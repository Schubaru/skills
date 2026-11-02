// The Requests tab: everyone who has knocked.
//
// Pending first, because a pending request is the only row here that is asking
// for something. A decided one is the record of an answer, so it stays, quieter,
// carrying who gave it.

import { decideAccessRequest, type AccessRequest } from "../access";
import { findProject } from "../projects";
import { whenLabel, type AdminData } from "./data";

export function RequestsTab({ data }: { data: AdminData }) {
  const pending = data.requests.filter((r) => r.status === "pending");
  const decided = data.requests.filter((r) => r.status !== "pending");

  return (
    <>
      <div className="rv-adm-card">
        <ul className="rv-adm-reqs">
          {pending.map((r) => (
            <li key={r.id}>
              <div className="rv-adm-reqmain">
                <span className="rv-adm-name">{r.name?.trim() || r.email}</span>
                <span className="rv-adm-sub">
                  {r.name?.trim() ? `${r.email} · ` : ""}
                  {whereLabel(r)} · {whenLabel(r.createdAt)}
                </span>
                {r.message ? <p className="rv-adm-msg">{r.message}</p> : null}
              </div>
              <span className="rv-adm-chips">
                <button
                  type="button"
                  className="rv-pill is-action"
                  disabled={data.busy}
                  onClick={() => void data.run(() => decideAccessRequest(r.id, true))}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="rv-pill"
                  disabled={data.busy}
                  onClick={() => void data.run(() => decideAccessRequest(r.id, false))}
                >
                  Deny
                </button>
              </span>
            </li>
          ))}
        </ul>
        {data.loading ? <p className="rv-adm-empty">Loading…</p> : null}
        {!data.loading && pending.length === 0 ? (
          <p className="rv-adm-empty">Nothing waiting. Requests land here when somebody asks to be let in.</p>
        ) : null}
      </div>

      {decided.length ? (
        <section className="rv-folder-section">
          <div className="rv-folder-sechead">
            <h2>Already answered</h2>
            <p>Kept as the record of who decided what.</p>
          </div>
          <div className="rv-adm-card">
            <ul className="rv-adm-reqs">
              {decided.map((r) => (
                <li key={r.id} className="is-decided">
                  <div className="rv-adm-reqmain">
                    <span>{r.name?.trim() || r.email}</span>
                    <span className="rv-adm-sub">
                      {whereLabel(r)} · {r.status === "approved" ? "Approved" : "Denied"}
                      {r.decidedBy ? ` by ${r.decidedBy}` : ""}
                      {r.decidedAt ? ` · ${whenLabel(r.decidedAt)}` : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </>
  );
}

/** A request with no project is asking for the front door, not for a board. */
function whereLabel(r: AccessRequest): string {
  if (!r.projectSlug) return "Sign-in";
  return findProject(r.projectSlug)?.name ?? r.projectSlug;
}
