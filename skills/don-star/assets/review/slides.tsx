// Slideshow modality: the selected screen rendered at reading size. The screen
// feed that used to live here is now the shared board sidebar (sidebar.tsx),
// rendered by app.tsx in both modalities. Arrow keys step through the whole
// flow, so a full pass never touches the mouse.

import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { CaretLeft, CaretRight } from "./icons";
import { clamp, type FlowLayout, type Point, type Size } from "./layout";
import {
  type CommentAnchor,
  type CommentThread,
  type DocKind,
  type Person,
  type ReviewEntry,
  type ReviewStatus,
} from "./model";
import { CommentsOverlay } from "./comments-ui";
import { ScreenEvents } from "./events-ui";
import { ScreenFrame, ScreenReviewBar, type FrameScrollApi } from "./frame";

/** Slides zoom is relative to the fitted screen: 1 = fit. Same gesture set as
 *  the canvas (toolbar buttons, pinch, ctrl/⌘ scroll), clamped here. */
export const SLIDE_ZOOM_MIN = 0.25;
export const SLIDE_ZOOM_MAX = 4;

export type SlideCommentsProps = {
  commentMode: boolean;
  commentCursor: string;
  threads: CommentThread[];
  showComments: boolean;
  showResolved: boolean;
  reviewerName: string;
  people: Person[];
  myEmail?: string;
  unread: Set<string>;
  onSetReviewerName: (n: string) => void;
  pending: { anchor: CommentAnchor } | null;
  onDropPin: (dx: number, dy: number) => void;
  onCancelPending: () => void;
  onCreate: (anchor: CommentAnchor, body: string, author: string, image?: string, mentions?: string[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReply: (id: string, body: string, author: string, image?: string, mentions?: string[]) => void;
  onRemoveReply: (id: string, replyId: string) => void;
  onResolve: (id: string, resolved: boolean) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, ddx: number, ddy: number) => void;
  onCopyLink: (id: string) => void | Promise<void>;
};

export function SlidesView({
  flows,
  liveViewport,
  selectedScreenId,
  index,
  total,
  onStep,
  zoom,
  onZoomBy,
  screenStatus,
  screenEntry,
  setScreen,
  comments,
  frameKey,
  onFrameNavigate,
  captureApi,
  events,
}: {
  flows: FlowLayout[];
  /** Layout viewport for live url frames (device switcher in the toolbar). */
  liveViewport: { w: number; h: number };
  selectedScreenId: string | null;
  index: number;
  total: number;
  onStep: (delta: number) => void;
  /** User zoom relative to the fitted screen (1 = fit); owned by the toolbar. */
  zoom: number;
  onZoomBy: (factor: number) => void;
  screenStatus: (screenId: string) => ReviewStatus | undefined;
  /** Full triage entry, for who-set-this tooltips. */
  screenEntry: (screenId: string) => ReviewEntry | undefined;
  setScreen: (screenId: string, next: ReviewEntry) => void;
  comments: SlideCommentsProps;
  /** Remount ticket for the stage frame. User-initiated selections bump it (a
   *  fresh boot at the new screen's seeded URL); board-follows from in-frame
   *  navigation keep it, so the app the reviewer is mid-walk in never reloads
   *  under them (the frame pins its src — see LiveScreen). */
  frameKey: number;
  /** In-frame SPA navigations from the stage, so the board can follow. */
  onFrameNavigate: (url: string) => void;
  /** Handle on the stage's booted iframe. Downloading the screen shoots THIS
   *  frame, so an export matches the state the reviewer walked into rather
   *  than a fresh boot of the seeded URL. */
  captureApi?: MutableRefObject<HTMLIFrameElement | null>;
  /** Documentation events for the selected screen (events-ui.tsx) — same list
   *  the canvas shows below the frame; null hides the row (events toggled off). */
  events: {
    forScreen: (screenId: string) => CommentThread[];
    onAdd: (screenId: string, kind: DocKind, body: string, author: string) => void;
    onRemove: (id: string) => void;
    reviewerName: string;
    onSetReviewerName: (n: string) => void;
  } | null;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Size>({ w: 900, h: 640 });
  const [box, setBox] = useState<Point>({ x: 0, y: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setStage({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The frame simulates the user's viewport: content taller than the frame
  // scrolls inside it. Pins anchor to content coordinates (dy includes
  // scroll), so they stay glued to what they point at.
  const scrollApiRef = useRef<FrameScrollApi | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  // Keyed to the frame instance, not the selection: a board-follow (the frame
  // navigated itself, the selection catches up) keeps the same live iframe, so
  // its scroll bridge stays valid and must not be dropped.
  useEffect(() => {
    scrollApiRef.current = null;
    setScrollTop(0);
  }, [frameKey]);

  const selFlow = flows.find((fl) => fl.screens.some((s) => s.screen.id === selectedScreenId));
  const sel = selFlow?.screens.find((s) => s.screen.id === selectedScreenId);
  const fitScale = sel ? clamp(Math.min((stage.w - 96) / sel.w, (stage.h - 48) / sel.h), 0.2, 1.1) : 1;
  const scale = fitScale * zoom;

  // Same zoom gestures as the canvas: pinch (Safari's native gesture events)
  // and ctrl/⌘ scroll, funneled into the shared toolbar zoom. A plain wheel
  // stays native — it scrolls the stage when the screen overflows it.
  const outerRef = useRef<HTMLDivElement>(null);
  const gesturingRef = useRef(false);
  const onZoomByRef = useRef(onZoomBy);
  onZoomByRef.current = onZoomBy;
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey) || gesturingRef.current) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      onZoomByRef.current(clamp(Math.exp(-e.deltaY * unit * 0.012), 0.4, 2.5));
    };
    let last = 1;
    const onStart = (e: Event) => {
      e.preventDefault();
      gesturingRef.current = true;
      last = 1;
    };
    const onChange = (e: Event) => {
      e.preventDefault();
      const s = (e as unknown as { scale: number }).scale;
      const ratio = s / last;
      last = s;
      if (Number.isFinite(ratio) && ratio > 0) onZoomByRef.current(ratio);
    };
    const onEnd = (e: Event) => {
      e.preventDefault();
      gesturingRef.current = false;
    };
    el.addEventListener("wheel", onWheel, { passive: false });

    /**
     * ⚠ The stage frame is INTERACTIVE, so a wheel with the cursor inside the
     * screen is delivered to the FRAME's document and never reaches the
     * listener above — zoom worked everywhere on the stage EXCEPT over the
     * thing you were trying to zoom (the reviewer, 2026-08-13: "when you try to zoom
     * while your mouse is inside of a screen design"). The frame is
     * same-origin, so the gesture is caught in there and forwarded out.
     *
     * A plain wheel is deliberately left alone: inside the frame it scrolls
     * the screen, which is the whole point of an interactive stage.
     */
    const framed = new Map<Document, () => void>();
    const attachFrames = () => {
      for (const frame of Array.from(el.querySelectorAll("iframe"))) {
        try {
          const doc = frame.contentDocument;
          if (!doc?.body || framed.has(doc)) continue;
          doc.addEventListener("wheel", onWheel, { passive: false });
          doc.addEventListener("gesturestart", onStart);
          doc.addEventListener("gesturechange", onChange);
          doc.addEventListener("gestureend", onEnd);
          framed.set(doc, () => {
            doc.removeEventListener("wheel", onWheel);
            doc.removeEventListener("gesturestart", onStart);
            doc.removeEventListener("gesturechange", onChange);
            doc.removeEventListener("gestureend", onEnd);
          });
        } catch {
          /* cross-origin — nothing to listen to */
        }
      }
    };
    const detachFrames = () => {
      for (const off of framed.values()) off();
      framed.clear();
    };
    // The frame boots after this effect runs, and re-navigates as the reviewer
    // walks the flow, so a one-shot attach would miss it.
    attachFrames();
    const frameSweep = window.setInterval(attachFrames, 500);

    if (!("GestureEvent" in window)) {
      return () => {
        window.clearInterval(frameSweep);
        el.removeEventListener("wheel", onWheel);
        detachFrames();
      };
    }
    el.addEventListener("gesturestart", onStart);
    el.addEventListener("gesturechange", onChange);
    el.addEventListener("gestureend", onEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onStart);
      el.removeEventListener("gesturechange", onChange);
      el.removeEventListener("gestureend", onEnd);
      detachFrames();
    };
    // The stage only exists while a screen is selected — (re)attach when it
    // appears (the selection is healed just after the first slides mount).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(sel)]);

  // Selecting a thread whose pin is scrolled out of the frame brings the
  // content back to it — the pin is the reviewer's bookmark into the page.
  useEffect(() => {
    if (!comments.selectedId || !sel) return;
    const th = comments.threads.find((t) => t.id === comments.selectedId);
    if (!th || th.anchor.type !== "screen" || th.anchor.screenId !== sel.screen.id) return;
    const api = scrollApiRef.current;
    if (!api) return;
    const top = api.get();
    const dy = th.anchor.dy;
    // Smooth only when visible: hidden pages never run scroll animations.
    if (dy < top + 48 || dy > top + sel.h - 48)
      api.to(Math.max(0, dy - sel.h * 0.4), document.visibilityState !== "hidden");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments.selectedId]);

  // Screen box's rendered offset within the stage, so comment pins (stored in
  // unscaled screen-space) can be projected onto it. Re-measured on stage
  // scroll too — a zoomed-in screen overflows the stage and scrolls under it.
  const measureBox = () => {
    const stageEl = stageRef.current;
    const boxEl = boxRef.current;
    if (!stageEl || !boxEl) return;
    const sr = stageEl.getBoundingClientRect();
    const br = boxEl.getBoundingClientRect();
    setBox({ x: br.left - sr.left, y: br.top - sr.top });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(measureBox, [stage, scale, selectedScreenId]);

  const slideThreads = sel
    ? comments.threads.filter((t) => t.anchor.type === "screen" && t.anchor.screenId === sel.screen.id)
    : [];
  // Project content-space anchors into the visible frame; pins whose spot is
  // scrolled away park at the frame's edge instead of drifting over the stage.
  const anchorToLocal = (a: CommentAnchor): Point =>
    a.type === "screen" ? { x: a.dx, y: clamp(a.dy - scrollTop, 6, (sel?.h ?? 0) - 6) } : { x: 0, y: 0 };

  return (
    <div className="rv-slides">
      {/* Stage */}
      <section className="rv-slides-stagewrap">
        {sel && selFlow ? (
          <>
            <div className="rv-slides-stage-head">
              <div className="rv-main">
                <div className="rv-eyebrow">
                  {selFlow.flow.section ? `${selFlow.flow.section} · ` : ""}
                  {selFlow.flow.title} · Flow {selFlow.flowIndex + 1} of {flows.length}
                </div>
                <h2>
                  {sel.screen.title} · Screen {sel.index + 1} of {selFlow.screens.length}
                </h2>
              </div>
              <ScreenReviewBar
                status={screenStatus(sel.screen.id)}
                entry={screenEntry(sel.screen.id)}
                onSet={(status) => setScreen(sel.screen.id, { status })}
              />
              <div className="rv-pager">
                <button
                  type="button"
                  onClick={() => onStep(-1)}
                  disabled={index <= 0}
                  aria-label="Previous screen"
                  className="rv-btn-icon is-bordered"
                >
                  <CaretLeft size={14} />
                </button>
                <span className="rv-pager-label">
                  {index + 1} / {total}
                </span>
                <button
                  type="button"
                  onClick={() => onStep(1)}
                  disabled={index >= total - 1}
                  aria-label="Next screen"
                  className="rv-btn-icon is-bordered"
                >
                  <CaretRight size={14} />
                </button>
              </div>
            </div>
            <div ref={outerRef} className="rv-slides-stage-outer">
              <div ref={stageRef} className="rv-slides-stage" onScroll={measureBox}>
                {/* Screen + its events travel as one centered block, so the
                    event cards sit directly below the frame like the canvas. */}
                <div style={{ margin: "auto", flexShrink: 0 }}>
                <div
                  ref={boxRef}
                  className="rv-slides-framebox"
                  data-presence-surface={`slides:${sel.screen.id}`}
                  data-presence-scale={scale}
                  style={{ position: "relative", width: sel.w * scale, height: sel.h * scale, margin: 0 }}
                >
                  <div style={{ width: sel.w, height: sel.h, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                    <ScreenFrame
                      key={frameKey}
                      screen={sel.screen}
                      index={sel.index}
                      total={selFlow.screens.length}
                      w={sel.w}
                      h={sel.h}
                      status={screenStatus(sel.screen.id)}
                      live
                      interactive
                      liveViewport={liveViewport}
                      scrollApi={scrollApiRef}
                      captureApi={captureApi}
                      onScrollChange={setScrollTop}
                      onNavigate={onFrameNavigate}
                    />
                  </div>
                  {/* Comment-mode capture layer: intercepts clicks on the screen to
                      drop a pin. Pins record content coordinates (click + scroll),
                      and the wheel forwards into the frame so a reviewer can still
                      scroll to the spot they want to mark. */}
                  {comments.commentMode ? (
                    <div
                      className="rv-slide-capture"
                      style={{ cursor: comments.commentCursor }}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        comments.onDropPin(
                          (e.clientX - rect.left) / scale,
                          (e.clientY - rect.top) / scale + (scrollApiRef.current?.get() ?? 0),
                        );
                      }}
                      onWheel={(e) => {
                        // ctrl/⌘ wheel is the zoom gesture — the stage-outer
                        // native listener owns it; don't also scroll the frame.
                        if (e.ctrlKey || e.metaKey) return;
                        const api = scrollApiRef.current;
                        if (api) api.to(api.get() + e.deltaY);
                      }}
                    />
                  ) : null}
                </div>
                {/* The screen's events, directly below the frame — same stack
                    the canvas shows (events-ui.tsx). */}
                {events ? (
                  <div className="rv-slides-events" style={{ width: sel.w * scale }}>
                    <ScreenEvents
                      events={events.forScreen(sel.screen.id)}
                      scope={`“${sel.screen.title}”`}
                      reviewerName={events.reviewerName}
                      onSetReviewerName={events.onSetReviewerName}
                      onAdd={(kind, body, author) => events.onAdd(sel.screen.id, kind, body, author)}
                      onRemove={events.onRemove}
                    />
                  </div>
                ) : null}
                </div>
              </div>

              {/* Comment pins, composer, and thread (screen-space, above the stage). */}
              <CommentsOverlay
                transform={{ x: box.x, y: box.y, scale }}
                size={stage}
                threads={slideThreads}
                showComments={comments.showComments}
                showResolved={comments.showResolved}
                reviewerName={comments.reviewerName}
                people={comments.people}
                myEmail={comments.myEmail}
                unread={comments.unread}
                onSetReviewerName={comments.onSetReviewerName}
                pending={comments.pending}
                onCancelPending={comments.onCancelPending}
                onCreate={comments.onCreate}
                selectedId={comments.selectedId}
                onSelect={comments.onSelect}
                onReply={comments.onReply}
                onRemoveReply={comments.onRemoveReply}
                onResolve={comments.onResolve}
                onRemove={comments.onRemove}
                onMove={comments.onMove}
                onCopyLink={comments.onCopyLink}
                anchorToWorld={anchorToLocal}
              />

            </div>
          </>
        ) : (
          <div className="rv-slides-empty">This page has no screens yet.</div>
        )}
      </section>
    </div>
  );
}
