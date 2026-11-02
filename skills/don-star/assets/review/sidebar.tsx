// Board sidebar, shared by both modalities (the reviewer, 2026-07-30): the header seg
// switches the modality itself (Canvas | Single page); the LIST follows the
// active tool — pointer shows Pages (the screen feed; a row click selects the
// screen / changes the slide), comment mode shows Comments (every thread on
// the board, wrangleable). The comment view controls (hide pins, show
// resolved) live in this panel's ⋯ menu.

import { Fragment, useEffect, useRef, useState } from "react";
import { CaretLeft, Check, Dots, Eye, EyeSlash, Info, PanelLeft } from "./icons";
import type { FlowLayout } from "./layout";
import { isAgent, relTime, type CommentThread, type ReviewStatus } from "./model";
import { PersonAvatar } from "./person";
import { usePersonName } from "./people-directory";

export type SidebarTab = "pages" | "comments";

/** ⋯ menu on the Comments tab — the view controls that used to crowd the
 *  header. Same outside-click / Escape dismissal as the board menu. */
function CommentsMenu({
  showComments,
  onToggleComments,
  showResolved,
  onToggleResolved,
  resolvedCount,
  showDocs,
  onToggleDocs,
}: {
  showComments: boolean;
  onToggleComments: () => void;
  showResolved: boolean;
  onToggleResolved: () => void;
  resolvedCount: number;
  showDocs: boolean;
  onToggleDocs: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Comment view options"
        title="Comment view options"
        className="rv-btn-icon"
        style={open ? { background: "var(--rv-muted)", color: "var(--rv-fg)" } : undefined}
      >
        <Dots size={16} />
      </button>
      {open ? (
        <div role="menu" aria-label="Comment view options" className="rv-menu" style={{ top: "100%", right: 0, marginTop: 6, width: 224 }}>
          <button type="button" role="menuitem" className="rv-menu-item" onClick={run(onToggleComments)}>
            {showComments ? <EyeSlash size={14} /> : <Eye size={14} />}
            <span className="rv-grow">{showComments ? "Hide comment pins" : "Show comment pins"}</span>
          </button>
          <button type="button" role="menuitem" className="rv-menu-item" onClick={run(onToggleResolved)}>
            <Check size={14} />
            <span className="rv-grow">{showResolved ? "Hide resolved" : "Show resolved"}</span>
            {resolvedCount > 0 ? <span className="rv-count">{resolvedCount}</span> : null}
          </button>
          <button type="button" role="menuitem" className="rv-menu-item" onClick={run(onToggleDocs)}>
            <Info size={14} />
            <span className="rv-grow">{showDocs ? "Hide events" : "Show events"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function CommentRow({
  thread,
  context,
  selected,
  unread,
  onOpen,
}: {
  thread: CommentThread;
  /** Where the pin lives — the screen's title, or the page for a board pin. */
  context: string;
  selected: boolean;
  /** Something here I haven't seen. Mine alone — see review_thread_reads. */
  unread: boolean;
  onOpen: () => void;
}) {
  const agent = isAgent(thread.author);
  const authorName = usePersonName(thread.authorEmail, thread.author);
  const replies = thread.replies.length;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={["rv-cmt-row", selected && "is-selected", thread.resolved && "is-resolved", unread && "is-unread"]
        .filter(Boolean)
        .join(" ")}
    >
      {/* The dot rides in the row's own gutter rather than beside the name:
          scanning a column of dots is what makes "what's new" answerable
          without reading a single comment. */}
      <span className="rv-cmt-unread" aria-hidden={!unread}>
        {unread ? <span className="rv-sr-only">Unread</span> : null}
      </span>
      <PersonAvatar name={thread.author} email={thread.authorEmail} size={24} className={agent ? "rv-avatar is-agent" : "rv-avatar"} />
      <span className="rv-cmt-main">
        <span className="rv-cmt-head">
          <span className={agent ? "rv-msg-author is-agent" : "rv-msg-author"}>{authorName}</span>
          <span className="rv-time">{relTime(thread.at)}</span>
          {thread.resolved ? <Check size={12} style={{ flexShrink: 0, color: "var(--rv-good)" }} /> : null}
        </span>
        <span className="rv-cmt-context">{context}</span>
        {thread.body || thread.image ? (
          <span className="rv-cmt-body">{thread.body || "(screenshot)"}</span>
        ) : null}
        {replies > 0 ? (
          <span className="rv-cmt-replies">
            {replies} {replies === 1 ? "reply" : "replies"}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export type BoardMode = "canvas" | "slides" | "flow";

export function BoardSidebar({
  tab,
  mode,
  onMode,
  hasFlow,
  onBack,
  onClose,
  flows,
  selectedScreenId,
  onSelectScreen,
  screenStatus,
  isMuted,
  threads,
  threadContext,
  selectedThreadId,
  unread,
  onOpenThread,
  showComments,
  onToggleComments,
  showResolved,
  onToggleResolved,
  showDocs,
  onToggleDocs,
}: {
  /** Which list shows — driven by the active tool (comment mode ⇒ comments). */
  tab: SidebarTab;
  mode: BoardMode;
  onMode: (mode: BoardMode) => void;
  /** The page authors Flow-view lanes (`branchLanes`); without them there is no Flow tab. */
  hasFlow: boolean;
  /** Back from the comments list to the page navigation (exits comment mode). */
  onBack: () => void;
  onClose: () => void;
  flows: FlowLayout[];
  selectedScreenId: string | null;
  /** Row click: change the slide (slides) or select + fly to it (canvas). */
  onSelectScreen: (id: string) => void;
  screenStatus: (screenId: string) => ReviewStatus | undefined;
  isMuted: (s: ReviewStatus | undefined) => boolean;
  /** Every thread on a live page, unsorted — the list orders newest first. */
  threads: CommentThread[];
  threadContext: (thread: CommentThread) => string;
  selectedThreadId: string | null;
  /** Thread ids with unseen activity, for this person only. */
  unread: Set<string>;
  onOpenThread: (id: string) => void;
  showComments: boolean;
  onToggleComments: () => void;
  showResolved: boolean;
  onToggleResolved: () => void;
  showDocs: boolean;
  onToggleDocs: () => void;
}) {
  // Keep the current screen's row in view — including when a walk inside the
  // stage frame moves the selection out from under the scroll position.
  const rowRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedScreenId, tab]);

  const sorted = [...threads].sort((a, b) => b.at - a.at);
  const openThreads = sorted.filter((t) => !t.resolved);
  const resolvedThreads = sorted.filter((t) => t.resolved);

  return (
    <aside className="rv-sidebar" aria-label="Board sidebar">
      <div className="rv-side-head">
        <div className="rv-seg is-grow" role="group" aria-label="View mode">
          <button
            type="button"
            onClick={() => onMode("canvas")}
            aria-pressed={mode === "canvas"}
            className={mode === "canvas" ? "rv-seg-btn is-label is-on" : "rv-seg-btn is-label"}
          >
            Canvas
          </button>
          <button
            type="button"
            onClick={() => onMode("slides")}
            aria-pressed={mode === "slides"}
            className={mode === "slides" ? "rv-seg-btn is-label is-on" : "rv-seg-btn is-label"}
          >
            Single page
          </button>
          {hasFlow ? (
            <button
              type="button"
              onClick={() => onMode("flow")}
              aria-pressed={mode === "flow"}
              className={mode === "flow" ? "rv-seg-btn is-label is-on" : "rv-seg-btn is-label"}
            >
              Flow
            </button>
          ) : null}
        </div>
        {/* Always present — appearing/vanishing with the comment tool made the
            header jump (the reviewer, 2026-07-30). */}
        <CommentsMenu
          showComments={showComments}
          onToggleComments={onToggleComments}
          showResolved={showResolved}
          onToggleResolved={onToggleResolved}
          resolvedCount={resolvedThreads.length}
          showDocs={showDocs}
          onToggleDocs={onToggleDocs}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide sidebar"
          title="Hide sidebar"
          className="rv-btn-icon"
          style={{ flexShrink: 0 }}
        >
          <PanelLeft size={15} />
        </button>
      </div>

      <div className="rv-side-body">
        {tab === "pages" ? (
          flows.map((fl, i) => {
            // A section heading opens each run of consecutive flows sharing a
            // Flow.section — the same grouping the canvas renders as a band.
            const sectionHead =
              fl.flow.section && fl.flow.section !== flows[i - 1]?.flow.section ? fl.flow.section : null;
            return (
              <Fragment key={fl.flow.id}>
                {sectionHead ? <div className="rv-slides-sectionband">{sectionHead}</div> : null}
                <section aria-label={fl.flow.title}>
                  <div className="rv-slides-section-head">
                    <span className="rv-title">{fl.flow.title}</span>
                  </div>
                  <div className="rv-slides-list">
                    {fl.screens.map((sl) => {
                      const st = screenStatus(sl.screen.id);
                      const isSel = selectedScreenId === sl.screen.id;
                      const cls = ["rv-slide-row", isSel && "is-selected", isMuted(st) && "is-muted"]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <button
                          key={sl.screen.id}
                          ref={isSel ? rowRef : undefined}
                          type="button"
                          onClick={() => onSelectScreen(sl.screen.id)}
                          aria-current={isSel ? "true" : undefined}
                          className={cls}
                        >
                          <span className="rv-n">{sl.index + 1}</span>
                          <span className="rv-main">
                            <span className="rv-title">{sl.screen.title}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              </Fragment>
            );
          })
        ) : (
          <div className="rv-cmt-list">
            {/* Back to the page navigation — rides in the body, not the
                header, so the header never shifts between tools. */}
            <button type="button" className="rv-side-back" onClick={onBack}>
              <CaretLeft size={13} />
              Pages
            </button>
            {openThreads.length === 0 && resolvedThreads.length === 0 ? (
              <p className="rv-side-empty">No comments yet. Press C, then click anywhere to leave one.</p>
            ) : null}
            {openThreads.map((t) => (
              <CommentRow
                key={t.id}
                thread={t}
                context={threadContext(t)}
                selected={selectedThreadId === t.id}
                unread={unread.has(t.id)}
                onOpen={() => onOpenThread(t.id)}
              />
            ))}
            {showResolved ? (
              resolvedThreads.map((t) => (
                <CommentRow
                  key={t.id}
                  thread={t}
                  context={threadContext(t)}
                  selected={selectedThreadId === t.id}
                  unread={unread.has(t.id)}
                  onOpen={() => onOpenThread(t.id)}
                />
              ))
            ) : resolvedThreads.length > 0 ? (
              <button type="button" className="rv-cmt-showresolved" onClick={onToggleResolved}>
                Show resolved <span className="rv-count">{resolvedThreads.length}</span>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </aside>
  );
}
