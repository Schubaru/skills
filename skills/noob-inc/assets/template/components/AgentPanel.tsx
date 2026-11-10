"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Agent, AgentEvent, Blocker } from "@/lib/types";
import { agentName, basename, clock, elapsedMs, fmtDuration, fmtTokens, modelLabel, STATUS_WORD, totalTokens } from "@/lib/format";
import { act } from "./useLiveState";
import BlockerCard from "./BlockerCard";
import { IconBubble, IconCheck, IconFlag, IconPrompt, IconSend, IconSpawn, IconStop, IconTool, IconX } from "./Icons";

interface Props {
  agent: Agent;
  agents: Agent[];
  liveEvents: AgentEvent[];
  /** Open prompts this agent is waiting on. */
  waiting: Blocker[];
  now: number;
  onClose(): void;
  onSelect(id: string): void;
}

export default function AgentPanel({ agent: a, agents, liveEvents, waiting, now, onClose, onSelect }: Props) {
  const [history, setHistory] = useState<AgentEvent[]>([]);
  const [blockers, setBlockers] = useState<Blocker[]>([]);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(a.kind === "subagent" ? agentName(a) : (a.title ?? ""));
  const streamRef = useRef<HTMLOListElement>(null);
  // Prompts you just answered disappear at once instead of waiting for the next poll.
  const [handled, setHandled] = useState<string[]>([]);
  const open = waiting.filter((b) => !handled.includes(b.id));

  // Confirmations fade after a few seconds; switching agents clears them.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);
  useEffect(() => setNote(null), [a.id]);

  useEffect(() => {
    let dead = false;
    setHistory([]);
    fetch(`/api/agents/${encodeURIComponent(a.id)}`)
      .then((r) => r.json())
      .then((j: { events: AgentEvent[]; blockers: Blocker[] }) => {
        if (dead) return;
        setHistory(j.events ?? []);
        setBlockers(j.blockers ?? []);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [a.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const events = useMemo(() => {
    const m = new Map<number, AgentEvent>();
    for (const e of history) m.set(e.id, e);
    for (const e of liveEvents) if (e.agent_id === a.id) m.set(e.id, e);
    // A viewer's coffee or harass skit is office theater, not the agent's activity.
    return [...m.values()].filter((e) => !(e.kind === "command" && ["harass", "coffee"].includes((e.payload as { kind?: string } | null)?.kind ?? ""))).sort((x, y) => x.id - y.id);
  }, [history, liveEvents, a.id]);

  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const children = agents.filter((c) => c.parent_id === a.id);
  const parent = a.parent_id ? agents.find((p) => p.id === a.parent_id) : null;
  const gone = a.status === "done" || a.status === "stopped";
  const files = useMemo(() => {
    const seen = new Set<string>();
    for (const e of events) if (e.kind === "tool" && ["Write", "Edit", "MultiEdit", "Read"].includes(e.tool ?? "") && e.summary) seen.add(e.summary);
    return [...seen].slice(-8);
  }, [events]);

  const send = async () => {
    const text = msg.trim();
    if (!text) return;
    const r = await act(`/api/agents/${encodeURIComponent(a.id)}`, { action: "nudge", text });
    setNote(r.ok ? (r.delivery === "now" ? "Delivered." : "Queued. It arrives at the next tool call or when the turn ends.") : r.error ?? "Failed.");
    if (r.ok) setMsg("");
  };
  const stop = async () => {
    const r = await act(`/api/agents/${encodeURIComponent(a.id)}`, { action: "stop" });
    setNote(r.ok ? (r.stopped ? "Stopped." : "Stopping. It halts at its next step; a command already running finishes first.") : r.error ?? "That didn't go through.");
    setConfirmStop(false);
  };
  const saveTitle = async () => {
    setEditing(false);
    if (title.trim() !== (a.kind === "subagent" ? agentName(a) : (a.title ?? ""))) await act(`/api/agents/${encodeURIComponent(a.id)}`, { action: "rename", title });
  };

  return (
    <aside className="panel" aria-label={`Agent ${agentName(a)}`}>
      <div className="panel-head">
        <span className="chip lg" style={{ background: `var(--l${a.livery % 8})` }} aria-hidden />
        {editing ? (
          <input className="input panel-title-input" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => e.key === "Enter" && saveTitle()} placeholder={agentName(a)} aria-label="Agent name" />
        ) : (
          <button type="button" className="panel-title" onClick={() => setEditing(true)} title="Rename">
            {agentName(a)}
          </button>
        )}
        <button className="btn icon quiet" type="button" onClick={onClose} aria-label="Close panel">
          <IconX />
        </button>
      </div>
      <div className="panel-meta">
        <span className="status" data-s={a.status}>
          <span className="dot" />
          {STATUS_WORD[a.status] ?? a.status}
        </span>
        {a.status_detail && <span className="status-detail">{a.status_detail}</span>}
      </div>
      {note && (
        <p className="panel-note" role="status">
          <IconCheck /> {note}
        </p>
      )}
      {open.length > 0 && (
        <section className="ask" aria-label="Waiting on you">
          {open.map((b) => (
            <BlockerCard
              key={b.id}
              blocker={b}
              holdUntil={a.hold_until}
              now={now}
              onDone={(n) => {
                setNote(n);
                setHandled((h) => [...h, b.id]);
              }}
            />
          ))}
        </section>
      )}
      <dl className="stats">
        <div>
          <dt className="label">Model</dt>
          <dd>{modelLabel(a.model)}</dd>
        </div>
        <div>
          <dt className="label">Elapsed</dt>
          <dd className="num">{fmtDuration(elapsedMs(a, now))}</dd>
        </div>
        <div>
          <dt className="label">Turns</dt>
          <dd className="num">{a.turns}</dd>
        </div>
        <div>
          <dt className="label">Tool calls</dt>
          <dd className="num">{a.tool_calls}</dd>
        </div>
        <div className="wide">
          <dt className="label">Tokens · {fmtTokens(totalTokens(a))}</dt>
          <dd className="num tokens-split">
            <span>
              <i>in</i> {fmtTokens(Number(a.input_tokens))}
            </span>
            <span>
              <i>out</i> {fmtTokens(Number(a.output_tokens))}
            </span>
            <span>
              <i>cache read</i> {fmtTokens(Number(a.cache_read_tokens))}
            </span>
            <span>
              <i>cache write</i> {fmtTokens(Number(a.cache_write_tokens))}
            </span>
          </dd>
        </div>
        <div className="wide">
          <dt className="label">Where</dt>
          <dd className="mono panel-where">
            {a.cwd ?? "—"}
            {a.git_branch ? ` · ${a.git_branch}` : ""}
          </dd>
        </div>
        {parent && (
          <div className="wide">
            <dt className="label">Reports to</dt>
            <dd>
              <button type="button" className="link" onClick={() => onSelect(parent.id)}>
                {agentName(parent)}
              </button>
            </dd>
          </div>
        )}
        {children.length > 0 && (
          <div className="wide">
            <dt className="label">Subagents</dt>
            <dd className="panel-kids">
              {children.map((c) => (
                <button type="button" className="link" key={c.id} onClick={() => onSelect(c.id)}>
                  <span className="chip" style={{ background: `var(--l${c.livery % 8})` }} aria-hidden /> {agentName(c)} · {STATUS_WORD[c.status]}
                </button>
              ))}
            </dd>
          </div>
        )}
        {files.length > 0 && (
          <div className="wide">
            <dt className="label">Recent files</dt>
            <dd className="mono panel-files">
              {files.map((f) => (
                <span key={f} title={f}>
                  {basename(f)}
                </span>
              ))}
            </dd>
          </div>
        )}
        {a.allowed_tools.length > 0 && (
          <div className="wide">
            <dt className="label">Allowed for this session</dt>
            <dd>
              {a.allowed_tools.join(", ")}{" "}
              <button type="button" className="link" onClick={() => act(`/api/agents/${encodeURIComponent(a.id)}`, { action: "revoke_allows" })}>
                revoke
              </button>
            </dd>
          </div>
        )}
      </dl>

      {!gone && (
        <div className="panel-actions">
          <label className="label" htmlFor="nudge">
            Message the agent
          </label>
          <textarea
            id="nudge"
            className="textarea"
            placeholder={a.status === "holding" ? "It's holding for you. Say what's next." : "Redirect it, add a constraint, answer something it mentioned…"}
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send();
            }}
          />
          <div className="panel-btns">
            <button className="btn primary" type="button" onClick={send} disabled={!msg.trim()}>
              <IconSend /> Send
            </button>
            {a.status === "holding" && (
              <button className="btn" type="button" onClick={() => act(`/api/agents/${encodeURIComponent(a.id)}`, { action: "release" })}>
                Release
              </button>
            )}
            <span style={{ flex: 1 }} />
            {confirmStop ? (
              <>
                <span className="status-detail">Stop it?</span>
                <button className="btn danger" type="button" onClick={stop}>
                  Yes, stop
                </button>
                <button className="btn quiet" type="button" onClick={() => setConfirmStop(false)}>
                  No
                </button>
              </>
            ) : (
              <button className="btn" type="button" onClick={() => setConfirmStop(true)}>
                <IconStop /> Stop
              </button>
            )}
          </div>
        </div>
      )}

      <div className="panel-stream-head">
        <span className="label">Activity</span>
        <span className="label">{events.length} events</span>
      </div>
      <ol className="stream" ref={streamRef}>
        {events.length === 0 && <li className="stream-empty">Nothing yet.</li>}
        {events.map((e) => (
          <li key={e.id} className={`ev ev-${e.kind}`}>
            <span className="ev-time num">{clock(e.created_at)}</span>
            <span className="ev-icon" aria-hidden>
              {e.kind === "tool" ? <IconTool /> : e.kind === "prompt" ? <IconPrompt /> : e.kind === "message" || e.kind === "command" ? <IconBubble /> : e.kind === "spawn" ? <IconSpawn /> : <IconFlag />}
            </span>
            <span className="ev-body">
              {e.tool && e.kind === "tool" && <b>{e.tool}</b>}
              {e.kind === "prompt" && <b>You</b>}
              {e.kind === "command" && <b>Dashboard</b>}
              {e.kind === "message" && <b>{(e.payload as { report?: boolean } | null)?.report ? "Reported back" : "Message"}</b>}
              {e.kind === "spawn" && <b>Spawned</b>}
              {e.kind === "blocker" && <b>{(e.payload as { kind?: string } | null)?.kind === "question" ? "Asked you" : "Asked permission"}</b>}
              {e.kind === "end" && <b>Ended</b>}
              {e.kind === "note" && <b>Note</b>}
              <span className={e.kind === "tool" ? "mono" : undefined}> {e.summary}</span>
            </span>
          </li>
        ))}
      </ol>
      {blockers.length > 0 && (
        <div className="panel-stream-head">
          <span className="label">Recent prompts</span>
          <span className="label">
            {blockers.filter((b) => b.status === "resolved").length} answered here
          </span>
        </div>
      )}
    </aside>
  );
}
