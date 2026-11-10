"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Agent, AgentEvent, OfficeLook } from "@/lib/types";
import { agentName } from "@/lib/format";
import { createOffice, type OfficeHandle, type OfficeMsg, type OfficeState, type Spot } from "./engine";
import type { MenuAt } from "./OfficeMenu";

interface Props {
  look: OfficeLook;
  agents: Agent[];
  events: AgentEvent[];
  theme: "light" | "dark";
  hover: string | null;
  selected: string | null;
  onHover(id: string | null): void;
  /** A click on the floor: who was hit, and where their menu should open. */
  onSelect(id: string | null, at: MenuAt | null): void;
  children?: ReactNode;
}

const MSG_WINDOW_MS = 2 * 60_000;
const VISIT_WINDOW_MS = 20_000;

export default function Office({ look, agents, events, theme, hover, selected, onHover, onSelect, children }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const localRef = useRef<OfficeHandle | null>(null);
  const [reduced, setReduced] = useState(false);
  const [visible, setVisible] = useState(true);
  const [mode, setMode] = useState<"worker" | "main" | null>(null);
  // A canvas whose control was transferred to a worker can never be reused; React dev mode
  // double-mounts, so a failed boot swaps in a fresh canvas element.
  const [canvasKey, setCanvasKey] = useState(0);
  const cbs = useRef({ onHover, onSelect });
  cbs.current = { onHover, onSelect };
  // The menu is drawn at the office's own pixel size, never smaller than 2 CSS px so its letters stay readable.
  const pick = (id: string | null, at?: Spot) => {
    const box = boxRef.current;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    cbs.current.onSelect(id, id && at && box ? { x: at.x / dpr, y: at.y / dpr, u: Math.max(2, at.s / dpr), w: box.clientWidth, h: box.clientHeight } : null);
  };

  // boot
  useEffect(() => {
    const canvas = canvasRef.current!;
    const box = boxRef.current!;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const size = () => {
      const w = box.clientWidth;
      const h = Math.round(w * 0.625);
      canvas.style.height = h + "px";
      return { w: Math.round(w * dpr), h: Math.round(h * dpr) };
    };
    const first = size();
    const canWorker = typeof Worker !== "undefined" && "transferControlToOffscreen" in canvas;
    if (canWorker) {
      try {
        const worker = new Worker(new URL("./office.worker.ts", import.meta.url));
        const off = canvas.transferControlToOffscreen();
        worker.postMessage({ type: "init", canvas: off, w: first.w, h: first.h }, [off]);
        worker.onmessage = (e: MessageEvent<{ type: "hover" | "select"; id: string | null; at?: Spot }>) => {
          if (e.data.type === "hover") cbs.current.onHover(e.data.id);
          else pick(e.data.id, e.data.at);
        };
        workerRef.current = worker;
        setMode("worker");
      } catch {
        /* fall through to main-thread */
      }
    }
    if (!workerRef.current) {
      try {
        localRef.current = createOffice(
        canvas,
        (w, h) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          return c;
        },
        { onHover: (id) => cbs.current.onHover(id), onSelect: pick },
      );
        localRef.current.resize(first.w, first.h);
        setMode("main");
      } catch {
        setCanvasKey((k) => k + 1);
        return;
      }
    }
    const ro = new ResizeObserver(() => {
      const s = size();
      cbs.current.onSelect(null, null); // an open menu would be left pointing at the old layout
      if (workerRef.current) workerRef.current.postMessage({ type: "resize", ...s });
      else localRef.current?.resize(s.w, s.h);
    });
    ro.observe(box);
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onMq = () => setReduced(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    const onVis = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", onMq);
      document.removeEventListener("visibilitychange", onVis);
      workerRef.current?.terminate();
      localRef.current?.destroy();
      workerRef.current = null;
      localRef.current = null;
    };
  }, [canvasKey]);

  const messages = useMemo<OfficeMsg[]>(() => {
    const cutoff = Date.now() - MSG_WINDOW_MS;
    const byTitle = new Map<string, string>();
    for (const a of agents) if (a.title) byTitle.set(a.title.toLowerCase(), a.id);
    const out: OfficeMsg[] = [];
    for (const e of events) {
      // Visitor joins and emotes belong to no agent; the emote layer draws those.
      if (!e.agent_id || new Date(e.created_at).getTime() < cutoff) continue;
      if (e.kind === "message") {
        const p = (e.payload ?? {}) as { to?: string | null; text?: string; report?: boolean };
        let to: string | null = p.to ?? null;
        if (to && !agents.some((a) => a.id === to)) {
          const lower = to.toLowerCase();
          to = byTitle.get(lower) ?? agents.find((a) => a.id.includes(to!) || (a.title ?? "").toLowerCase().includes(lower))?.id ?? null;
        }
        if (!to) {
          const me = agents.find((a) => a.id === e.agent_id);
          if (me?.parent_id) to = me.parent_id;
        }
        out.push({ id: e.id, from: e.agent_id, to, text: (p.text || e.summary || "").slice(0, 60), kind: p.report ? "report" : "message" });
      } else if (e.kind === "command") {
        const k = (e.payload as { kind?: string } | null)?.kind;
        if (k === "letgo") out.push({ id: e.id, from: e.agent_id, to: null, text: "", kind: "letgo" });
        // A viewer's skit only plays while it's fresh, so a reload or floor switch doesn't rerun old ones.
        else if ((k === "harass" || k === "coffee") && new Date(e.created_at).getTime() > Date.now() - VISIT_WINDOW_MS) out.push({ id: e.id, from: e.agent_id, to: null, text: "", kind: k });
      } else if (e.kind === "spawn") {
        out.push({ id: e.id, from: e.agent_id, to: null, text: (e.summary || "").slice(0, 40), kind: "spawn" });
      }
    }
    return out;
  }, [agents, events]);

  // push state
  useEffect(() => {
    // Let go by HR, or a subagent from its session's last turn: either way it stays out of the break area.
    const off = (a: Agent) => a.status_detail === "let go by HR" || a.status_detail === "went home with its session";
    const state: OfficeState = {
      agents: agents.map((a) => ({ id: a.id, title: agentName(a), status: a.status, livery: a.livery, parent_id: a.parent_id, kind: a.kind, off: off(a) })),
      look,
      messages,
      theme,
      hover,
      selected,
      reduced,
      visible,
    };
    if (workerRef.current) workerRef.current.postMessage({ type: "state", state });
    else localRef.current?.update(state);
  }, [look, agents, messages, theme, hover, selected, reduced, visible, mode]);

  const toCanvas = (e: React.PointerEvent | React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    return { x: (e.clientX - r.left) * dpr, y: (e.clientY - r.top) * dpr };
  };
  const send = (m: { type: "pointer" | "click"; x: number; y: number }) => {
    if (workerRef.current) workerRef.current.postMessage(m);
    else if (m.type === "pointer") localRef.current?.pointer(m.x, m.y);
    else localRef.current?.click(m.x, m.y);
  };

  return (
    <div ref={boxRef} className="office-box">
      <canvas
        key={canvasKey}
        ref={canvasRef}
        className="office-canvas"
        role="img"
        aria-label={`Pixel ${look === "studio" ? "studio showing each agent at a reading table" : "office showing each agent at a desk"}; the same states are listed in the agent board.`}
        style={{ cursor: hover ? "pointer" : "default" }}
        onPointerMove={(e) => send({ type: "pointer", ...toCanvas(e) })}
        onPointerLeave={() => send({ type: "pointer", x: -1, y: -1 })}
        onClick={(e) => send({ type: "click", ...toCanvas(e) })}
      />
      {children}
    </div>
  );
}
