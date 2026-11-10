"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Agent, AgentEvent, Blocker, Machine, OfficeLook, Settings, StateResponse } from "@/lib/types";
import { lastActivity } from "./IdleGuard";

export interface Live {
  agents: Agent[];
  events: AgentEvent[];
  blockers: Blocker[];
  machines: Machine[];
  settings: Settings | null;
  look: OfficeLook;
  loaded: boolean;
  online: boolean;
  /** Shared view only: the owner turned the link off or replaced it. */
  revoked: boolean;
  now: number;
}

const POLL_MS = 2000;
const HEARTBEAT_MS = 30_000;
const EVENT_CAP = 600;

// Set while the dashboard is mounted: polls right away instead of waiting out the interval.
let refreshNow: (() => void) | null = null;
// After an action, reload in full: a delta can't show agents that were deleted.
let fullNext = false;

/** With `share`, reads the scrubbed view-only feed for that link and never touches the owner's session. */
export function useLiveState(share?: string): Live {
  const [live, setLive] = useState<Live>({ agents: [], events: [], blockers: [], machines: [], settings: null, look: "office", loaded: false, online: true, revoked: false, now: Date.now() });
  const since = useRef<string | null>(null);
  const agents = useRef(new Map<string, Agent>());
  const blockers = useRef(new Map<string, Blocker>());
  const events = useRef<AgentEvent[]>([]);
  const seen = useRef(new Set<number>());

  const publish = useCallback((partial: Partial<Live>) => {
    setLive((l) => ({
      ...l,
      ...partial,
      agents: [...agents.current.values()],
      blockers: [...blockers.current.values()].filter((b) => b.status === "open"),
      events: events.current,
      now: Date.now(),
    }));
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    let polls = 0;
    let busy = false;
    let again = false;
    const tick = async () => {
      if (stopped) return;
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      clearTimeout(timer);
      try {
        // A full load every 30 polls drops agents that were dismissed or cleaned up server-side.
        if (++polls % 30 === 0 || fullNext) since.current = null;
        fullNext = false;
        const q = since.current ? `?since=${encodeURIComponent(since.current)}` : "";
        // A request that never returns (sleep, dropped connection) must not freeze the board for good.
        const res = await fetch(`${share ? `/api/watch/${encodeURIComponent(share)}` : "/api/state"}${q}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (share && res.status === 404) {
          agents.current.clear();
          blockers.current.clear();
          events.current = [];
          publish({ loaded: true, revoked: true });
          return;
        }
        if (!share && res.status === 401) {
          location.href = "/login?reason=expired";
          return;
        }
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as StateResponse;
        if (data.full) {
          agents.current.clear();
          blockers.current.clear();
        }
        for (const a of data.agents) {
          if (a.dismissed) agents.current.delete(a.id);
          else agents.current.set(a.id, a);
        }
        for (const b of data.blockers) blockers.current.set(b.id, b);
        if (data.events.length) {
          const fresh = data.events.filter((e) => !seen.current.has(e.id));
          for (const e of fresh) seen.current.add(e.id);
          events.current = [...events.current, ...fresh].slice(-EVENT_CAP);
        }
        since.current = data.now;
        publish({ machines: data.machines, settings: data.settings, look: data.look ?? "office", loaded: true, online: true });
      } catch {
        publish({ online: false });
      }
      busy = false;
      timer = setTimeout(tick, again ? 0 : document.hidden ? POLL_MS * 5 : POLL_MS);
      again = false;
    };
    refreshNow = tick;
    tick();

    const beat = () => {
      // A viewer never counts as the owner being here: that would make agents hold prompts nobody can answer.
      if (share) return;
      // Only while the person is actually here: an idle tab must not keep the session alive.
      if (Date.now() - lastActivity() < 15 * 60_000 && !document.hidden) fetch("/api/heartbeat", { method: "POST" }).catch(() => {});
    };
    beat();
    const hb = setInterval(beat, HEARTBEAT_MS);
    const onVis = () => {
      if (!document.hidden) beat();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      refreshNow = null;
      clearTimeout(timer);
      clearInterval(hb);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [publish, share]);

  // A one-second clock so elapsed times tick between polls.
  useEffect(() => {
    const t = setInterval(() => setLive((l) => ({ ...l, now: Date.now() })), 1000);
    return () => clearInterval(t);
  }, []);

  return live;
}

export async function act(path: string, body: unknown): Promise<{ ok: boolean; error?: string; delivery?: string; stopped?: boolean }> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  fullNext = true;
  refreshNow?.();
  return { ok: res.ok, ...j };
}
