"use client";
import { useEffect, useMemo, useState } from "react";
import type { Agent, Blocker, Machine } from "@/lib/types";
import { agentName, basename, elapsedMs, fmtDuration, fmtTokens, modelLabel, STATUS_RANK, STATUS_WORD, totalTokens } from "@/lib/format";
import { act } from "./useLiveState";
import { IconChevron, IconX } from "./Icons";
import Link from "next/link";

interface Props {
  agents: Agent[];
  blockers: Blocker[];
  machines: Machine[];
  now: number;
  hover: string | null;
  selected: string | null;
  loaded: boolean;
  onHover(id: string | null): void;
  onSelect(id: string | null): void;
  /** Shared view: the table is read-only. No clearing, dismissing, or opening agents. */
  readOnly?: boolean;
}

export interface RowItem {
  agent: Agent;
  depth: number;
  last: boolean;
  kids: Agent[];
}

export function orderAgents(agents: Agent[]): RowItem[] {
  const children = new Map<string, Agent[]>();
  const roots: Agent[] = [];
  for (const a of agents) {
    if (a.parent_id && agents.some((p) => p.id === a.parent_id)) {
      const l = children.get(a.parent_id) ?? [];
      l.push(a);
      children.set(a.parent_id, l);
    } else roots.push(a);
  }
  const cmp = (a: Agent, b: Agent) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || a.started_at.localeCompare(b.started_at);
  roots.sort(cmp);
  const out: RowItem[] = [];
  const walk = (a: Agent, depth: number, last: boolean) => {
    const kids = (children.get(a.id) ?? []).sort((x, y) => x.started_at.localeCompare(y.started_at));
    out.push({ agent: a, depth, last, kids });
    kids.forEach((k, i) => walk(k, depth + 1, i === kids.length - 1));
  };
  roots.forEach((r, i) => walk(r, 0, i === roots.length - 1));
  return out;
}

const gone = (a: Agent) => a.status === "done" || a.status === "stopped";
type Tab = "active" | "done";
const TAB_KEY = "noob-board-tab";

/** "4 subagents · 1 active": the family at a glance while it's folded. */
function kidsSummary(kids: Agent[]): string {
  const live = kids.filter((k) => !gone(k)).length;
  return `${kids.length} subagent${kids.length === 1 ? "" : "s"}${live ? ` · ${live} active` : ""}`;
}

/** Splits ordered rows by family: a session and its subagents move to Done together, once every one of them has stopped. */
export function splitByFamily(rows: RowItem[]): Record<Tab, RowItem[]> {
  const out: Record<Tab, RowItem[]> = { active: [], done: [] };
  for (let i = 0; i < rows.length; ) {
    let j = i + 1;
    while (j < rows.length && rows[j].depth > 0) j++;
    const family = rows.slice(i, j);
    out[family.every((r) => gone(r.agent)) ? "done" : "active"].push(...family);
    i = j;
  }
  return out;
}

export default function AgentBoard({ agents, blockers, machines, now, hover, selected, loaded, onHover, onSelect, readOnly }: Props) {
  const all = useMemo(() => orderAgents(agents), [agents]);
  const split = useMemo(() => splitByFamily(all), [all]);
  const [tab, setTabState] = useState<Tab>("active");
  useEffect(() => {
    try {
      if (localStorage.getItem(TAB_KEY) === "done") setTabState("done");
    } catch {}
  }, []);
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {}
  };
  const waitingOn = useMemo(() => new Map(blockers.map((b) => [b.agent_id, b])), [blockers]);
  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  // Families start folded; only the user opens them (not persisted).
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string, to?: boolean) =>
    setOpen((s) => {
      const want = to ?? !s.has(id);
      if (want === s.has(id)) return s;
      const n = new Set(s);
      if (want) n.add(id);
      else n.delete(id);
      return n;
    });
  // A subagent waiting on you is never folded away.
  const forced = useMemo(() => {
    const f = new Set<string>();
    for (const a of agents) {
      if (a.status !== "blocked" && !waitingOn.has(a.id)) continue;
      for (let p = a.parent_id && byId.get(a.parent_id); p; p = p.parent_id && byId.get(p.parent_id)) f.add(p.id);
    }
    return f;
  }, [agents, byId, waitingOn]);
  // Picking a subagent elsewhere (the office, the sheet) unfolds its family.
  useEffect(() => {
    const a = selected ? byId.get(selected) : undefined;
    if (!a?.parent_id || !byId.has(a.parent_id)) return;
    setOpen((s) => {
      const n = new Set(s);
      for (let p = byId.get(a.parent_id!); p; p = p.parent_id ? byId.get(p.parent_id) : undefined) n.add(p.id);
      return n.size === s.size ? s : n;
    });
  }, [selected, byId]);
  const isOpen = (id: string) => open.has(id) || forced.has(id);
  const rows = useMemo(() => {
    const out: RowItem[] = [];
    let foldedAt = Infinity;
    for (const r of split[tab]) {
      if (r.depth > foldedAt) continue;
      foldedAt = r.kids.length && !isOpen(r.agent.id) ? r.depth : Infinity;
      out.push(r);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [split, tab, open, forced]);
  const maxElapsed = Math.max(1, ...split[tab].map((r) => elapsedMs(r.agent, now)));
  const maxTokens = Math.max(1, ...split[tab].map((r) => totalTokens(r.agent)));
  // Clearing takes two clicks: the first arms the button, the second deletes. It disarms itself after a few seconds.
  const [armed, setArmed] = useState(false);
  const [clearing, setClearing] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);
  useEffect(() => setArmed(false), [tab]);
  const doneCount = split.done.filter((r) => r.depth === 0).length;
  const clearDone = async () => {
    if (!armed) return setArmed(true);
    setArmed(false);
    setClearing(true);
    await act("/api/agents", { action: "clear", ids: split.done.map((r) => r.agent.id) });
    setClearing(false);
    if (split.done.some((r) => r.agent.id === selected)) onSelect(null);
  };
  const tabs: [Tab, string][] = [
    ["active", "Active"],
    ["done", "Done"],
  ];

  return (
    <section className="board" aria-label="Agents">
      <div className="board-head">
        <div className="board-tabs" role="tablist" aria-label="Agents">
          {tabs.map(([t, word]) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`board-tab-${t}`}
              aria-selected={tab === t}
              aria-controls="board-panel"
              tabIndex={tab === t ? 0 : -1}
              className="board-tab label"
              onClick={() => setTab(t)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  const next = t === "active" ? "done" : "active";
                  setTab(next);
                  document.getElementById(`board-tab-${next}`)?.focus();
                }
              }}
            >
              {word} <span className="num">{split[t].filter((r) => r.depth === 0).length}</span>
            </button>
          ))}
        </div>
        {tab === "done" && doneCount > 0 && !readOnly ? (
          <button
            type="button"
            className={`btn sm quiet board-clear${armed ? " danger armed" : ""}`}
            onClick={clearDone}
            onBlur={() => setArmed(false)}
            onKeyDown={(e) => e.key === "Escape" && setArmed(false)}
            disabled={clearing}
            aria-live="polite"
          >
            {clearing ? "Clearing…" : armed ? `Delete ${doneCount} for good?` : "Clear all"}
          </button>
        ) : (
          waitingOn.size > 0 && <span className="label board-waiting">{waitingOn.size} waiting on you</span>
        )}
      </div>
      <div id="board-panel" role="tabpanel" aria-labelledby={`board-tab-${tab}`}>
        {all.length === 0 ? (
          <EmptyBoard loaded={loaded} hasMachine={machines.length > 0} readOnly={readOnly} />
        ) : rows.length === 0 ? (
          <div className="empty">
            {tab === "active" ? (
              <>
                <p className="empty-title display">Nobody working</p>
                <p>Every agent has finished. New sessions show up here the moment they start.</p>
              </>
            ) : (
              <>
                <p className="empty-title display">Nobody done yet</p>
                <p>When a session and all its subagents stop, they move here.</p>
              </>
            )}
          </div>
        ) : (
          <div className="table" role="table">
            <div className="tr th" role="row">
              <span role="columnheader" className="label td-agent">
                Agent
              </span>
              <span role="columnheader" className="label td-model">
                Model
              </span>
              <span role="columnheader" className="label td-elapsed">
                Elapsed
              </span>
              <span role="columnheader" className="label td-tokens">
                Tokens
              </span>
              <span role="columnheader" className="label td-status">
                Status
              </span>
            </div>
            {rows.map(({ agent: a, depth, kids }) => {
              const el = elapsedMs(a, now);
              const tok = totalTokens(a);
              const ask = waitingOn.get(a.id);
              const expanded = kids.length > 0 && isOpen(a.id);
              const pinned = forced.has(a.id);
              return (
                <div
                  key={a.id}
                  role="row"
                  tabIndex={0}
                  className={`tr${depth ? " kid" : ""}${hover === a.id ? " hov" : ""}${selected === a.id ? " sel" : ""}${gone(a) ? " gone" : ""}`}
                  onMouseEnter={() => onHover(a.id)}
                  onMouseLeave={() => onHover(null)}
                  onClick={() => onSelect(a.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(a.id);
                    } else if (kids.length && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
                      e.preventDefault();
                      toggle(a.id, e.key === "ArrowRight");
                    }
                  }}
                  aria-selected={selected === a.id}
                  aria-expanded={kids.length ? expanded : undefined}
                  aria-level={depth + 1}
                >
                  <span role="cell" className="td-agent" style={{ paddingLeft: depth * 24, ["--d" as string]: depth }}>
                    {depth > 0 && <span className="tree" aria-hidden />}
                    {kids.length > 0 ? (
                      <button
                        type="button"
                        className="fold"
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Hide" : "Show"} ${kidsSummary(kids)}`}
                        title={pinned ? "A subagent is waiting on you" : undefined}
                        disabled={pinned}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(a.id);
                        }}
                      >
                        <IconChevron />
                      </button>
                    ) : (
                      <span className="fold-slot" aria-hidden />
                    )}
                    <span className="chip" style={{ background: `var(--l${a.livery % 8})` }} aria-hidden />
                    <span className="agent-text">
                      <span className="agent-title">{agentName(a)}</span>
                      <span className="agent-sub">
                        {a.kind === "subagent" ? a.title || "subagent" : a.task || basename(a.cwd) || "session"}
                        {a.git_branch ? ` · ${a.git_branch}` : ""}
                        {kids.length > 0 && <span className="agent-kids"> · {kidsSummary(kids)}</span>}
                      </span>
                    </span>
                  </span>
                  <span role="cell" className="td-model">
                    {modelLabel(a.model)}
                  </span>
                  <span role="cell" className="td-elapsed num">
                    <span>{fmtDuration(el)}</span>
                    <span className="bar" aria-hidden>
                      <i style={{ width: `${Math.max(2, (el / maxElapsed) * 100)}%` }} />
                    </span>
                  </span>
                  <span role="cell" className="td-tokens num" title={`in ${fmtTokens(Number(a.input_tokens))} · out ${fmtTokens(Number(a.output_tokens))} · cache read ${fmtTokens(Number(a.cache_read_tokens))} · cache write ${fmtTokens(Number(a.cache_write_tokens))}`}>
                    <span>{fmtTokens(tok)}</span>
                    <span className="bar" aria-hidden>
                      <i style={{ width: `${Math.max(tok ? 2 : 0, (tok / maxTokens) * 100)}%` }} />
                    </span>
                  </span>
                  <span role="cell" className="td-status">
                    <span className="status" data-s={a.status}>
                      <span className="dot" />
                      {readOnly && a.status === "blocked" ? "Needs input" : STATUS_WORD[a.status] ?? a.status}
                    </span>
                    {ask ? (
                      <button
                        type="button"
                        className="btn attn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (selected !== a.id) onSelect(a.id);
                        }}
                      >
                        {ask.kind === "question" ? "Answer" : ask.kind === "permission" ? "Review" : "Open"}
                        <IconChevron />
                      </button>
                    ) : (
                      a.status_detail && <span className="status-detail">{a.status_detail}</span>
                    )}
                    {gone(a) && !readOnly && (
                      <button
                        type="button"
                        className="btn icon quiet sm dismiss"
                        aria-label="Remove from board"
                        onClick={(e) => {
                          e.stopPropagation();
                          act(`/api/agents/${encodeURIComponent(a.id)}`, { action: "dismiss" });
                        }}
                      >
                        <IconX />
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function EmptyBoard({ loaded, hasMachine, readOnly }: { loaded: boolean; hasMachine: boolean; readOnly?: boolean }) {
  if (!loaded) {
    return (
      <div className="empty">
        <div className="skeleton" />
        <div className="skeleton" style={{ width: "70%" }} />
        <div className="skeleton" style={{ width: "85%" }} />
      </div>
    );
  }
  if (readOnly) {
    return (
      <div className="empty">
        <p className="empty-title display">Nobody on the floor</p>
        <p>No agents are working right now. New ones walk in the moment they start; this page keeps watching.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <p className="empty-title display">Nobody on the floor</p>
      {hasMachine ? (
        <p>
          The bridge is installed. Start a Claude Code session on that machine and it will walk in. Sessions already running need a restart to pick up the hooks.
        </p>
      ) : (
        <p>
          Install the bridge on the machine that runs Claude Code. It takes one command from <Link href="/settings" className="link">Settings</Link>, and every session, subagent, and permission prompt shows up here.
        </p>
      )}
    </div>
  );
}
