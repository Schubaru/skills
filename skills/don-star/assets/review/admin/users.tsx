// The Users tab: everyone who can reach the preview, in one table.
//
// Two kinds of row, kept visibly apart because removing one is not the same
// act as removing the other:
//   a RULE row      an access_rules entry. An address, or a whole domain.
//                   Removing it cuts that person (or that company) out of
//                   every project at once.
//   a DIRECTORY row somebody who signed in under a domain rule. They have no
//                   row of their own to remove; the domain above them is the
//                   thing that lets them in, and the row says so.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  addAccessRule,
  parseAccessEntries,
  removeAccessRule,
  setRuleAdmin,
  type AccessEntry,
} from "../access";
import { Check, Lock, Plus, Trash } from "../icons";
import { PersonAvatar } from "../person";
import { buildUserRows, matchesSearch, projectNames, type AdminData, type UserRow } from "./data";

export function UsersTab({ data, myEmail }: { data: AdminData; myEmail: string }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () => buildUserRows(data.rules, data.grants, data.people, data.folderGrants, data.items, data.folders),
    [data.rules, data.grants, data.people, data.folderGrants, data.items, data.folders],
  );
  const shown = rows.filter((r) => matchesSearch(r, query));
  const adminRules = data.rules.filter((r) => r.isAdmin);

  return (
    <>
      <div className="rv-adm-bar">
        <input
          className="rv-folder-input rv-adm-search"
          type="search"
          aria-label="Search people and domains"
          placeholder="Search by name, address or domain"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="rv-folder-hint">
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>

      <div className="rv-adm-card">
        {data.rules.length === 0 && !data.loading ? (
          // Never true on a live board: the allowlist is what let you in. It
          // shows up when the migration has not been applied, so it says which.
          <p className="rv-adm-note">
            No sign-in rules readable. If this is the live board, supabase/project-access.sql has not been applied yet.
          </p>
        ) : null}
        <table className="rv-adm-table">
          <caption className="rv-sr-only">People and domains that can sign in</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Email or domain</th>
              <th scope="col">Role</th>
              <th scope="col">Projects</th>
              <th scope="col">
                <span className="rv-sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <UserTableRow
                key={row.key}
                row={row}
                data={data}
                myEmail={myEmail}
                lastAdmin={Boolean(row.rule) && row.rule!.isAdmin && adminRules.length === 1}
              />
            ))}
          </tbody>
        </table>
        {data.loading ? <p className="rv-adm-empty">Loading…</p> : null}
        {!data.loading && shown.length === 0 ? (
          <p className="rv-adm-empty">
            {rows.length === 0 ? "Nobody has been added yet." : "Nothing matches that search."}
          </p>
        ) : null}
      </div>

      <AddPeople data={data} />
    </>
  );
}

function UserTableRow({
  row,
  data,
  myEmail,
  lastAdmin,
}: {
  row: UserRow;
  data: AdminData;
  myEmail: string;
  lastAdmin: boolean;
}) {
  const held = row.isAdmin ? null : projectNames(row.slugs);
  const isMe = row.value.toLowerCase() === myEmail;
  return (
    <tr>
      <td data-label="Name">
        <span className="rv-adm-person">
          <PersonAvatar className="rv-adm-avatar" name={row.name || row.value} email={row.value.includes("@") ? row.value : null} />
          <span>
            {row.rule && row.kind === "email" ? (
              <Link className="rv-adm-link rv-adm-name" to={`/projects/access/u/${row.rule.id}`}>
                {row.name || row.value}
              </Link>
            ) : (
              <span className={row.name ? "rv-adm-name" : "rv-adm-name is-anon"}>{row.name || "No name yet"}</span>
            )}
            {isMe ? <span className="rv-adm-sub">You</span> : null}
            {row.via ? <span className="rv-adm-sub">via {row.via}</span> : null}
          </span>
        </span>
      </td>
      <td data-label="Address">
        <span className="rv-adm-mono">{row.value}</span>
        {row.rule?.note ? <span className="rv-adm-sub">{row.rule.note}</span> : null}
      </td>
      <td data-label="Role">
        {row.rule ? (
          <button
            type="button"
            role="switch"
            aria-checked={row.isAdmin}
            className={row.isAdmin ? "rv-pill is-on" : "rv-pill"}
            style={{ ["--rv-s" as string]: "var(--rv-good)" }}
            // The last admin cannot stand down: with no admin rule left, this
            // console is unreachable for everyone, and only a hand edit in
            // Supabase brings it back.
            disabled={data.busy || lastAdmin}
            title={lastAdmin ? "The last administrator cannot be removed" : "Administers access"}
            onClick={() => void data.run(() => setRuleAdmin(row.rule!.id, !row.isAdmin))}
          >
            {row.isAdmin ? <Check size={13} /> : <Lock size={13} />}
            {row.isAdmin ? "Admin" : "Member"}
          </button>
        ) : (
          <span className="rv-folder-hint">{row.isAdmin ? "Admin" : "Member"}</span>
        )}
      </td>
      <td data-label="Projects">
        {row.isAdmin ? (
          <span className="rv-folder-hint">All projects</span>
        ) : held && held.length ? (
          <span className="rv-adm-chips">
            {held.map((p) => (
              <span key={p.slug} className="rv-folder-tag">
                {p.name}
              </span>
            ))}
          </span>
        ) : (
          <span className="rv-folder-hint is-warn">No projects</span>
        )}
      </td>
      <td className="is-actions">
        {row.rule ? (
          <button
            type="button"
            className="rv-btn-icon is-danger"
            title={lastAdmin ? "The last administrator cannot be removed" : `Remove ${row.value}`}
            aria-label={`Remove ${row.value}`}
            disabled={data.busy || lastAdmin}
            onClick={() => {
              const what = isMe
                ? `Remove ${row.value}? That is your own access, and you will be signed out of every project.`
                : row.kind === "domain"
                  ? `Remove ${row.value}? Everyone at that domain loses the preview entirely.`
                  : `Remove ${row.value}? They lose the preview entirely, on every project.`;
              if (window.confirm(what)) void data.run(() => removeAccessRule(row.rule!.id));
            }}
          >
            <Trash size={15} />
          </button>
        ) : (
          <span className="rv-folder-hint">Covered by {row.via}</span>
        )}
      </td>
    </tr>
  );
}

/** ONE field. What was typed decides what gets added: a domain adds a domain,
 *  an address adds a person, and `Jane Doe <jane@client.example>` adds both at
 *  once. A kind picker would only ask the reader to classify what they already
 *  typed. */
function AddPeople({ data }: { data: AdminData }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [name, setName] = useState("");

  const parsed = useMemo(() => parseAccessEntries(text), [text]);
  const single = parsed.entries.length === 1 ? parsed.entries[0]! : null;
  const askName = Boolean(single && single.kind === "email" && parsed.rejected.length === 0);
  const ready = parsed.entries.length > 0 && parsed.rejected.length === 0 && !data.busy;

  const submit = () => {
    if (!ready) return;
    const entries = parsed.entries;
    const typed = name.trim();
    void data
      .run(async () => {
        for (const entry of entries) {
          const err = await addAccessRule({
            kind: entry.kind,
            value: entry.value,
            displayName: displayNameFor(entry, entries.length === 1 ? typed : ""),
          });
          if (err) return err;
        }
        return null;
      })
      .then(() => {
        setText("");
        setName("");
        setOpen(false);
      });
  };

  if (!open) {
    return (
      <button type="button" className="rv-folder-addghost" onClick={() => setOpen(true)}>
        <Plus size={13} />
        Add a person or a domain
      </button>
    );
  }

  return (
    <form
      className="rv-adm-addform"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setText("");
          setName("");
          setOpen(false);
        }
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
      <input
        autoFocus
        className="rv-folder-input rv-adm-entry"
        aria-label="Email address or domain"
        placeholder="name@client.example, or client.example for everyone there"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {askName ? (
        <input
          className="rv-folder-input rv-adm-person"
          aria-label="Name (optional)"
          placeholder="Name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      ) : null}
      <button type="submit" className="rv-pill is-action" disabled={!ready}>
        Add
      </button>
      <button
        type="button"
        className="rv-folder-cancel"
        onClick={() => {
          setText("");
          setName("");
          setOpen(false);
        }}
      >
        Cancel
      </button>
      <p className={parsed.rejected.length ? "rv-adm-hint rv-folder-hint is-warn" : "rv-adm-hint"}>
        {describe(parsed, text)}
      </p>
    </form>
  );
}

function displayNameFor(entry: AccessEntry, typed: string): string {
  if (entry.kind !== "email") return "";
  return typed || entry.name || "";
}

/** Says what pressing Add will do, before it is pressed. */
function describe(parsed: { entries: AccessEntry[]; rejected: string[] }, text: string): string {
  if (parsed.rejected.length) {
    return `Could not read ${parsed.rejected.join(", ")}. An address needs an @, a domain needs a dot.`;
  }
  if (!parsed.entries.length) {
    return text.trim() ? "" : "One per line, or separated by commas.";
  }
  const parts = parsed.entries.map((e) => (e.kind === "domain" ? `everyone at ${e.value}` : e.value));
  return `Adds ${parts.join(", ")} to the sign-in list. Projects are granted separately.`;
}
