// The Flow modality (the reviewer, 2026-08-18): the current page as a branching chart —
// every screen a preview node, every branch an arrow with its condition on it.
// Third mode beside Canvas and Single page. Navigate + read only: pan, zoom,
// click to select, double-click into Single page; layout is automatic and
// nothing drags — the graph states the app's real branching (authored in
// Page.edges), and a hand-tuned picture of it would drift like any copy.
//
// Nodes are the same ScreenFrame the canvas renders, at the same sizes, so the
// capture cache, Go-live behavior and status rings all carry over unchanged.

import {
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { buildFlowGraph, type FlowComponent, type FlowGraphLayout, type FlowNode } from "./flow-graph";
import { ScreenFrame } from "./frame";
import { clamp, MAX_SCALE, type Size, type Transform } from "./layout";
import type { Page, ReviewProject, ReviewStatus } from "./model";
import { fitView, viewOf, type View } from "./presence-model";

export type FlowViewApi = {
  zoomBy: (factor: number) => void;
  fit: () => void;
  centerOn: (screenId: string) => void;
  /** The camera, for presence follow mode (presence.ts). */
  getView: () => View;
  setView: (view: View) => void;
};

/** Per-screen comment rollup for the node badges. */
export type NodeThreads = { open: number; unread: boolean; firstId: string };

const VIEW_MARGIN = 700;

/** The Flow world is a much bigger geometry than a canvas lane stack — an
 *  onboarding map is ~20 columns wide — so its zoom floor sits well below the
 *  canvas's MIN_SCALE: "see the whole map" is this modality's home position. */
const FV_MIN_SCALE = 0.03;

function fvFit(bounds: Size, size: Size, pad = 80): Transform {
  const scale = clamp(
    Math.min((size.w - pad * 2) / bounds.w, (size.h - pad * 2) / bounds.h),
    FV_MIN_SCALE,
    MAX_SCALE,
  );
  return { scale, x: (size.w - bounds.w * scale) / 2, y: (size.h - bounds.h * scale) / 2 };
}

/** Where an edge leaves and enters its nodes, plus the path between. Forward
 *  edges run right out of the source into the target's left edge; anything
 *  else (a back edge, a same-column drop) runs bottom → top so the arrow
 *  never crosses its own nodes. */
function edgePath(from: FlowNode, to: FlowNode): { d: string; mx: number; my: number } {
  const forward = to.x >= from.x + from.w;
  if (forward) {
    const x1 = from.x + from.w;
    const y1 = from.y + Math.min(from.h, to.h) / 2;
    const x2 = to.x;
    const y2 = to.y + Math.min(from.h, to.h) / 2;
    const d = Math.max(48, (x2 - x1) / 2);
    return {
      d: `M ${x1} ${y1} C ${x1 + d} ${y1}, ${x2 - d} ${y2}, ${x2} ${y2}`,
      mx: (x1 + x2) / 2,
      my: (y1 + y2) / 2,
    };
  }
  const down = to.y >= from.y;
  const x1 = from.x + from.w / 2;
  const y1 = down ? from.y + from.h : from.y;
  const x2 = to.x + to.w / 2;
  const y2 = down ? to.y : to.y + to.h;
  const d = Math.max(48, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
  return {
    d: `M ${x1} ${y1} C ${x1} ${y1 + d}, ${x2} ${y2 - d}, ${x2} ${y2}`,
    mx: (x1 + x2) / 2,
    my: (y1 + y2) / 2,
  };
}

function componentExtent(c: FlowComponent): Size {
  let w = 0;
  let h = 0;
  for (const n of c.nodes) {
    w = Math.max(w, n.x + n.w);
    h = Math.max(h, n.y + n.h);
  }
  return { w, h };
}

export function FlowView({
  project,
  page,
  liveViewport,
  liveScale,
  storageKey,
  selectedScreenId,
  screenStatus,
  nodeThreads,
  onSelectScreen,
  onOpenScreen,
  onOpenThread,
  onScale,
  apiRef,
}: {
  project: ReviewProject;
  page: Page;
  liveViewport: { w: number; h: number };
  /** Below this zoom frames show their cached capture (app.tsx LIVE_SCALE). */
  liveScale: number;
  /** localStorage key for this page's flow viewport. */
  storageKey: string;
  selectedScreenId: string | null;
  screenStatus: (screenId: string) => ReviewStatus | undefined;
  nodeThreads: Map<string, NodeThreads>;
  onSelectScreen: (id: string | null) => void;
  /** Double-click: open this screen in Single page. */
  onOpenScreen: (id: string) => void;
  onOpenThread: (threadId: string) => void;
  /** Reports the current zoom so the toolbar's readout can show it. */
  onScale?: (scale: number) => void;
  apiRef: MutableRefObject<FlowViewApi | null>;
}) {
  const graph: FlowGraphLayout = useMemo(() => buildFlowGraph(project, page), [project, page]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 1280, h: 800 });
  const [t, setT] = useState<Transform>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem(storageKey);
        if (stored) return JSON.parse(stored) as Transform;
      } catch {
        /* ignore */
      }
    }
    return fvFit(graph.bounds, { w: 1280, h: 800 });
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // First sight of a page with no stored viewport: fit once the real container
  // size is in (the state initializer only had the default).
  const fittedRef = useRef(typeof window !== "undefined" && !!window.localStorage.getItem(storageKey));
  useEffect(() => {
    if (fittedRef.current) return;
    fittedRef.current = true;
    setT(fvFit(graph.bounds, size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(t));
    } catch {
      /* ignore */
    }
  }, [t, storageKey]);

  const onScaleRef = useRef(onScale);
  onScaleRef.current = onScale;
  useEffect(() => {
    onScaleRef.current?.(t.scale);
  }, [t.scale]);

  const zoomAt = (cx: number, cy: number, factor: number) =>
    setT((prev) => {
      const scale = clamp(prev.scale * factor, FV_MIN_SCALE, MAX_SCALE);
      const k = scale / prev.scale;
      return { scale, x: cx - (cx - prev.x) * k, y: cy - (cy - prev.y) * k };
    });

  useImperativeHandle(apiRef, () => ({
    zoomBy: (factor) => zoomAt(size.w / 2, size.h / 2, factor),
    fit: () => setT(fvFit(graph.bounds, size)),
    centerOn: (screenId) => {
      for (const c of graph.components) {
        const n = c.nodes.find((nd) => nd.screen.id === screenId);
        if (!n) continue;
        const cx = c.x + n.x + n.w / 2;
        const cy = c.y + n.y + n.h / 2;
        setT((prev) => {
          const scale =
            prev.scale >= liveScale
              ? prev.scale
              : clamp(Math.min((size.w - 120) / n.w, (size.h - 160) / n.h), liveScale, 1);
          return { scale, x: size.w / 2 - cx * scale, y: size.h / 2 - cy * scale };
        });
        return;
      }
    },
    getView: () => viewOf(t, size),
    setView: (view) => setT(fitView(view, size, FV_MIN_SCALE, MAX_SCALE)),
  }));

  // Wheel: plain scroll pans, ctrl/meta (trackpad pinch on Chrome) zooms at the
  // cursor. Non-passive so the browser's page zoom never fires — the same
  // contract the canvas holds (see app.tsx).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      if (e.ctrlKey || e.metaKey) {
        const ratio = clamp(Math.exp(-e.deltaY * unit * 0.012), 0.4, 2.5);
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, ratio);
      } else {
        setT((prev) => ({ ...prev, x: prev.x - e.deltaX * unit, y: prev.y - e.deltaY * unit }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Safari trackpad pinch arrives as gesture events, not ctrl+wheel.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let lastScale = 1;
    const start = (e: Event) => {
      e.preventDefault();
      lastScale = (e as unknown as { scale: number }).scale ?? 1;
    };
    const change = (e: Event) => {
      e.preventDefault();
      const ev = e as unknown as { scale: number; clientX: number; clientY: number };
      const rect = el.getBoundingClientRect();
      const ratio = ev.scale / lastScale;
      lastScale = ev.scale;
      zoomAt(ev.clientX - rect.left, ev.clientY - rect.top, ratio);
    };
    el.addEventListener("gesturestart", start as EventListener);
    el.addEventListener("gesturechange", change as EventListener);
    return () => {
      el.removeEventListener("gesturestart", start as EventListener);
      el.removeEventListener("gesturechange", change as EventListener);
    };
  }, []);

  // Pointer pan. Nodes don't stop propagation, so a drag that starts over a
  // frame still pans; their click handlers check `moved` and stand down after
  // a pan (the canvas's own 4px click-vs-drag rule).
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const movedRef = useRef(false);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y };
    movedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const pan = panRef.current;
    if (!pan) return;
    const dx = e.clientX - pan.sx;
    const dy = e.clientY - pan.sy;
    if (Math.hypot(dx, dy) > 4) movedRef.current = true;
    if (movedRef.current) setT((prev) => ({ ...prev, x: pan.ox + dx, y: pan.oy + dy }));
  };
  const endPointer = () => {
    panRef.current = null;
  };

  // Visible world rect, for the same frame virtualization the canvas does.
  const margin = VIEW_MARGIN / t.scale;
  const view = {
    left: -t.x / t.scale - margin,
    top: -t.y / t.scale - margin,
    right: (-t.x + size.w) / t.scale + margin,
    bottom: (-t.y + size.h) / t.scale + margin,
  };
  const intersects = (x: number, y: number, w: number, h: number) =>
    x < view.right && x + w > view.left && y < view.bottom && y + h > view.top;

  return (
    <div
      ref={containerRef}
      className="rv-canvas"
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerLeave={endPointer}
      onClick={() => {
        if (!movedRef.current) onSelectScreen(null);
      }}
    >
      {graph.components.length === 0 ? <p className="rv-canvas-empty">This page has no screens yet.</p> : null}
      <div
        className="rv-world"
        data-presence-surface={`flow:${page.id}`}
        data-presence-scale={t.scale}
        style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})` }}
      >
        <div className="rv-dots" style={{ width: graph.bounds.w, height: graph.bounds.h }} />
        {graph.components.map((c, ci) => {
          const extent = componentExtent(c);
          return (
            <div key={`${page.id}:${ci}`} className="rv-fv-component" style={{ left: c.x, top: c.y }}>
              <div className="rv-fv-head">
                <div className="rv-fv-eyebrow">{c.eyebrow}</div>
                <h3>{c.title}</h3>
                {c.subtitle ? <p className="rv-fv-sub">{c.subtitle}</p> : null}
              </div>
              {/* Branch arrows under the nodes, labels above the paths. */}
              <svg
                className="rv-fv-edges"
                width={extent.w + 40}
                height={extent.h + 40}
                viewBox={`0 0 ${extent.w + 40} ${extent.h + 40}`}
                aria-hidden
              >
                <defs>
                  <marker id={`rv-fv-arrow-${ci}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                </defs>
                {c.edges.map((e, i) => {
                  const from = c.nodes.find((n) => n.screen.id === e.from)!;
                  const to = c.nodes.find((n) => n.screen.id === e.to)!;
                  const p = edgePath(from, to);
                  return (
                    <path
                      key={i}
                      d={p.d}
                      className={e.auto ? "rv-fv-edge is-auto" : "rv-fv-edge"}
                      markerEnd={`url(#rv-fv-arrow-${ci})`}
                    />
                  );
                })}
              </svg>
              {c.edges.map((e, i) => {
                if (!e.label) return null;
                const from = c.nodes.find((n) => n.screen.id === e.from)!;
                const to = c.nodes.find((n) => n.screen.id === e.to)!;
                const p = edgePath(from, to);
                return (
                  <span key={`l${i}`} className="rv-fv-label" style={{ left: p.mx, top: p.my }}>
                    {e.label}
                  </span>
                );
              })}
              {c.nodes.map((n) => {
                const worldX = c.x + n.x;
                const worldY = c.y + n.y;
                const visible = intersects(worldX, worldY, n.w, n.h);
                const st = screenStatus(n.screen.id);
                const selected = selectedScreenId === n.screen.id;
                const threads = nodeThreads.get(n.screen.id);
                return (
                  <div
                    key={n.screen.id}
                    className={selected ? "rv-screen rv-fv-node is-selected" : "rv-screen rv-fv-node"}
                    style={{ left: n.x, top: n.y }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!movedRef.current) onSelectScreen(n.screen.id);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      // Chart-only steps aren't in slides — nothing to open on.
                      if (!movedRef.current && !n.laneOnly) onOpenScreen(n.screen.id);
                    }}
                  >
                    {selected ? <div aria-hidden className="rv-screen-sel" /> : null}
                    <ScreenFrame
                      screen={n.screen}
                      index={n.indexInFlow}
                      total={n.flowCount}
                      w={n.w}
                      h={n.h}
                      status={st}
                      live={visible}
                      preferLive={t.scale >= liveScale}
                      liveViewport={liveViewport}
                    />
                    {threads && threads.open > 0 ? (
                      <button
                        type="button"
                        className={threads.unread ? "rv-fv-badge is-unread" : "rv-fv-badge"}
                        title={`${threads.open} open ${threads.open === 1 ? "comment" : "comments"} — open on the canvas`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenThread(threads.firstId);
                        }}
                      >
                        {threads.open}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {/* What the chart is missing — reported like /flows does, never blocking. */}
      {graph.problems.length > 0 ? (
        <div className="rv-fv-problems" role="note">
          <p className="rv-fv-problems-head">This chart has gaps</p>
          {graph.problems.slice(0, 6).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {graph.problems.length > 6 ? <p>…and {graph.problems.length - 6} more.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
