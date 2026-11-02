// The review app root: a pan/zoom canvas of flows (canvas-style board) and a
// slideshow modality, with pinned comments and per-screen triage. Drop it on a
// route (or run the standalone host) and pass a ReviewProject.

import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  Bell,
  CaretDown,
  CaretLeft,
  CaretRight,
  Chat,
  Check,
  Code,
  Cursor,
  Cross,
  Desktop,
  Dots,
  Download,
  Filter,
  Fit,
  Minus,
  PanelLeft,
  People,
  Phone,
  Plus,
  Refresh,
} from "./icons";
import {
  buildSnapshot,
  isDocNote,
  isUnread,
  nextStatus,
  projectSlug,
  worstStatus,
  EMPTY_SNAPSHOT,
  DEFAULT_SCREEN_W,
  LIVE_VIEWPORTS,
  MOBILE_FRAME,
  SHOW_REVIEW_STATUS,
  STATUS_LABEL,
  type CommentAnchor,
  type CommentThread,
  type DocKind,
  type ReviewProject,
  type Screen,
  type ReviewSnapshot,
  type ReviewStatus,
  type ViewportMode,
} from "./model";
import { ScreenEvents } from "./events-ui";
import {
  buildPageLayout,
  clamp,
  fitTransform,
  FLOW_HEADER_H,
  HEADER_TO_LANE,
  MAX_SCALE,
  MIN_SCALE,
  ORIGIN_X,
  PAGE_HEADER_W,
  SCREEN_GAP,
  SECTION_HEADER_H,
  type FlowLayout,
  type PageLayout,
  type Point,
  type Size,
  type Transform,
} from "./layout";
import { buildRouteIndex, matchScreenForUrl, parseBoardLocation, type BoardMode } from "./nav";
import {
  useComments,
  useLayoutOverrides,
  usePeople,
  useReads,
  useReviewerName,
  useReviews,
  type ReviewerIdentity,
} from "./store";
import { fetchNotifyPrefs, upsertNotifyPrefs, type NotifyPrefs } from "./db";
import { useAuthOptional } from "../auth/AuthProvider";
import { persistSnapshotToRepo, snapshotFilename } from "./io";
import { useThemePref, type ThemePref } from "./theme";
import { ThemeRows } from "./theme-menu";
import { BRAND } from "./brand";
import { CommentsOverlay } from "./comments-ui";
import { ScreenFrame, ScreenReviewBar, SnapshotWarmer, statusAttribution, statusClass } from "./frame";
import { clearSnapshots, initSnapshots, requestCapture } from "./snapshot-cache";
import { capturePng, exportZip, EXPORT_PIXEL_RATIO, type ShotSpec } from "./export-png";
import { saveBlob, slugify } from "./zip";
import { SlidesView, SLIDE_ZOOM_MAX, SLIDE_ZOOM_MIN } from "./slides";
import { FlowView, type FlowViewApi, type NodeThreads } from "./flow-view";
import { BoardSidebar } from "./sidebar";
import { ShareButton } from "./share-panel";
import { cleanEmoji, colorIndex, fitView, toSurface, usePresence, validColor, viewOf, type Place } from "./presence";
import { FollowFrame, FollowPill, PresenceCursors, PresenceMenu } from "./presence-ui";
import { CursorChat, type BoardMenuItems } from "./presence-chat";
import { seededSrc } from "../review-seed";
import { canShare, useMyAccess } from "./use-access";

/** Dev mode (src/dev/) — the markup / token / asset inspector a developer
 *  rebuilding these screens works in. Lazy on purpose: it is a tool for one
 *  kind of visit, and a reviewer who never opens it shouldn't download the
 *  fiber reader, the exporters and the zip writer to look at comments. */
const DevPanel = lazy(() => import("../dev/overlay").then((m) => ({ default: m.DevPanel })));

/** Screen-space margin (px) so panning reveals already-mounted nodes. Divided
 *  by scale below, not used raw — a flat world-space margin balloons at high
 *  zoom (exactly where `preferLive` boots real iframes), pulling far more
 *  offscreen screens into the "live" set than are ever actually visible. */
const VIEW_MARGIN = 700;
/** Movement (client px) under which a background press counts as a click, not a pan. */
const CLICK_SLOP = 4;
/** Touch input jitters more than a mouse; give taps more room before they read as a drag. */
const CLICK_SLOP_TOUCH = 10;
/** A press on a selected flow only becomes a move after this much travel, so a
 *  plain click on a selected card never nudges it. */
const DRAG_SLOP = 4;

/** Speech-bubble cursor for comment mode; hotspot at the tail (bottom-left). */
const COMMENT_CURSOR =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30' viewBox='0 0 30 30'><path d='M6 4h18a2.5 2.5 0 0 1 2.5 2.5v11A2.5 2.5 0 0 1 24 20H13l-7 6v-6a2.5 2.5 0 0 1-2.5-2.5v-11A2.5 2.5 0 0 1 6 4z' fill='%23202327' stroke='white' stroke-width='1.6' stroke-linejoin='round'/></svg>\") 6 26, crosshair";

/** Filter-menu order: Unreviewed leads (the reviewer, 2026-07-30 — the working view). */
const ALL_STATUSES: (ReviewStatus | "none")[] = ["none", "good", "needs"];

/** Below this canvas zoom, frames render their cached self-capture instead of
 *  a live iframe (snapshot-cache.ts) — a zoomed-out board is for scanning, and
 *  compositing dozens of scaled live apps is what made panning crawl. */
const LIVE_SCALE = 0.55;

/** How long a toolbar hint stays up before dismissing itself. */
const HINT_MS = 6000;

/** Transient toolbar hint: fades in over the dock, dismisses itself after
 *  HINT_MS, and any click kills it immediately. It remounts with its trigger
 *  (entering the board, arming comment mode), so the timer restarts naturally.
 *  Pass `once` to also remember the dismissal for the rest of the tab session
 *  (sessionStorage), so a mode round-trip doesn't re-nag. */
function Hint({ once, comment = false, children }: { once?: string; comment?: boolean; children: ReactNode }) {
  const storeKey = once ? `rv:hint:${once}` : null;
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(() => {
    if (!storeKey || typeof window === "undefined") return false;
    return window.sessionStorage.getItem(storeKey) === "1";
  });

  useEffect(() => {
    if (gone) return;
    const t = window.setTimeout(() => setLeaving(true), HINT_MS);
    return () => window.clearTimeout(t);
  }, [gone]);

  // Leave = fade out, then unmount (and remember, when asked to).
  useEffect(() => {
    if (!leaving) return;
    if (storeKey) {
      try {
        window.sessionStorage.setItem(storeKey, "1");
      } catch {
        /* ignore */
      }
    }
    const t = window.setTimeout(() => setGone(true), 220);
    return () => window.clearTimeout(t);
  }, [leaving, storeKey]);

  if (gone) return null;
  return (
    <button
      type="button"
      title="Dismiss"
      onClick={() => setLeaving(true)}
      className={`rv-hint${comment ? " is-comment" : ""}${leaving ? " is-leaving" : ""}`}
    >
      {children}
    </button>
  );
}

/** Overflow menu: theme + account. The file operations (export/import/reset)
 *  that used to live here were removed 2026-07-30 — see git history to restore. */
/** Off since 2026-09-18: the header's status filter went unused. */
const SHOW_STATUS_FILTER = false;

function BoardMenu({
  theme,
  onTheme,
  onRefreshPreviews,
  download,
  account,
  notify,
  onManageAccess,
}: {
  /** The page as a ZIP of PNGs on the canvas, the one screen in slides. The
   *  label says which, since that depends on the modality. */
  download: { label: string; busy: boolean; onStart: () => void };
  theme: ThemePref;
  onTheme: (theme: ThemePref) => void;
  /** Throws away every cached frame capture and lets the board re-shoot them. */
  onRefreshPreviews: () => void;
  /** Signed-in identity (Supabase auth); null in the offline localStorage mode. */
  account: { name: string; email: string; onSignOut: () => void } | null;
  /** Opt-in email notification prefs; null until loaded (or offline mode). */
  notify: { prefs: NotifyPrefs; toggle: (patch: Partial<NotifyPrefs>) => void } | null;
  /** Admins only (2026-08-13) — absent for everyone else. */
  onManageAccess?: () => void;
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
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Board menu"
        title="More"
        className="rv-btn-icon is-bordered"
        style={open ? { background: "var(--rv-muted)", color: "var(--rv-fg)" } : undefined}
      >
        <Dots size={17} />
      </button>
      {open ? (
        <div role="menu" aria-label="Board actions" className="rv-menu" style={{ top: "100%", right: 0, marginTop: 8, width: 256 }}>
          {/* Theme: Auto (default) follows the system. Shared with the folder
              menu — see theme-menu.tsx. */}
          <ThemeRows theme={theme} onTheme={onTheme} />
          <div className="rv-menu-sep" aria-hidden />
          {/* Frames paint from a cached capture and only re-shoot when the code
              behind a screen changes (review/snapshot-cache.ts). This is the
              manual out for anything that hash can't see. */}
          <button
            type="button"
            role="menuitem"
            className="rv-menu-item"
            disabled={download.busy}
            onClick={run(download.onStart)}
          >
            <Download size={14} />
            <span className="rv-grow">{download.label}</span>
          </button>
          <button type="button" role="menuitem" className="rv-menu-item" onClick={run(onRefreshPreviews)}>
            <Refresh size={14} />
            <span className="rv-grow">Refresh previews</span>
          </button>
          {account && notify ? (
            <>
              <div className="rv-menu-sep" aria-hidden />
              {/* Opt-in email notifications (supabase/review-notify.sql).
                  Applies without closing the menu, like the theme rows. */}
              <div className="rv-menu-item" style={{ cursor: "default", opacity: 0.7 }}>
                <Bell size={14} />
                <span className="rv-grow">Email me about…</span>
              </div>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={notify.prefs.onReplies}
                className="rv-menu-item"
                onClick={() => notify.toggle({ onReplies: !notify.prefs.onReplies })}
              >
                <span style={{ width: 14, flexShrink: 0 }} aria-hidden />
                <span className="rv-grow">Replies in my threads</span>
                {notify.prefs.onReplies ? <Check size={13} style={{ flexShrink: 0 }} /> : null}
              </button>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={notify.prefs.onNewThreads}
                className="rv-menu-item"
                onClick={() => notify.toggle({ onNewThreads: !notify.prefs.onNewThreads })}
              >
                <span style={{ width: 14, flexShrink: 0 }} aria-hidden />
                <span className="rv-grow">Every new comment</span>
                {notify.prefs.onNewThreads ? <Check size={13} style={{ flexShrink: 0 }} /> : null}
              </button>
            </>
          ) : null}
          {onManageAccess ? (
            <>
              <div className="rv-menu-sep" aria-hidden />
              {/* Who can sign in, and who sees which project. An account-level
                  action, not a board one — hence here and not the header. */}
              <button type="button" role="menuitem" className="rv-menu-item" onClick={run(onManageAccess)}>
                <People size={14} />
                <span className="rv-grow">Manage access</span>
              </button>
            </>
          ) : null}
          {account ? (
            <>
              <div className="rv-menu-sep" aria-hidden />
              <div className="rv-menu-item" style={{ cursor: "default", opacity: 0.7 }} title={account.email}>
                Signed in as {account.name}
              </div>
              <button type="button" role="menuitem" className="rv-menu-item" onClick={run(account.onSignOut)}>
                Sign out
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** What the download control is doing. `working` counts screens as they land;
 *  `done`/`error` are transient — a message that clears itself. */
type ExportState =
  | { phase: "idle" }
  | { phase: "working"; done: number; total: number }
  | { phase: "packing" }
  | { phase: "done"; message: string }
  | { phase: "error"; message: string };

/** Header control: shoots the board's screens as PNGs — the whole canvas page
 *  as a ZIP, or just the one screen in slides. Progress and cancel live in the
 *  button itself rather than a modal, because an export is something you kick
 *  off and keep working around (a 40-screen page takes a handful of seconds,
 *  and every screen in it is a real app boot). */
function ExportControl({
  state,
  onCancel,
}: {
  state: ExportState;
  onCancel: () => void;
}) {
  if (state.phase === "working" || state.phase === "packing") {
    return (
      <div className="rv-export is-busy" role="status" aria-live="polite">
        <span className="rv-export-spin" aria-hidden />
        <span>
          {state.phase === "packing"
            ? "Zipping…"
            : state.total > 1
              ? `Capturing ${state.done}/${state.total}`
              : "Capturing…"}
        </span>
        <button type="button" onClick={onCancel} aria-label="Cancel download" title="Cancel download">
          <Cross size={12} />
        </button>
      </div>
    );
  }
  return (
    <>
      {state.phase === "done" || state.phase === "error" ? (
        <span className={state.phase === "error" ? "rv-autosave is-error" : "rv-autosave"} role="status">
          {state.message}
        </span>
      ) : null}
    </>
  );
}

/** Zoom dropdown in the toolbar: the current percent opens a menu of zoom
 *  actions + presets, replacing the −/+/fit button row. Opens upward — the
 *  toolbar docks at the bottom. Same dismissal pattern as BoardMenu. */
function ZoomMenu({
  percent,
  fitLabel,
  onZoomIn,
  onZoomOut,
  onFit,
  onSetPercent,
}: {
  percent: number;
  fitLabel: string;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onSetPercent: (p: number) => void;
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
        title="Zoom"
        className={open ? "rv-zoom-trigger is-open" : "rv-zoom-trigger"}
      >
        <span className="rv-zoom-label">{percent}%</span>
        <CaretDown size={11} style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 120ms" }} />
      </button>
      {open ? (
        <div role="menu" aria-label="Zoom" className="rv-menu" style={{ bottom: "100%", right: 0, marginBottom: 8, width: 176 }}>
          <button type="button" role="menuitem" className="rv-menu-item" onClick={run(onZoomIn)}>
            <Plus size={14} /> Zoom in
          </button>
          <button type="button" role="menuitem" className="rv-menu-item" onClick={run(onZoomOut)}>
            <Minus size={14} /> Zoom out
          </button>
          <button type="button" role="menuitem" className="rv-menu-item" onClick={run(onFit)}>
            <Fit size={14} /> {fitLabel}
          </button>
          <div className="rv-menu-sep" aria-hidden />
          {[50, 100, 200].map((p) => (
            <button key={p} type="button" role="menuitem" className="rv-menu-item" onClick={run(() => onSetPercent(p))}>
              <span className="rv-grow">{p}%</span>
              {percent === p ? <Check size={13} style={{ flexShrink: 0 }} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Status filter as ONE button (the reviewer, 2026-07-30 — the chip track is gone):
 *  the trigger names the active view and opens a menu of All / Unreviewed /
 *  Signed off / Needs work with counts. Same dismissal pattern as BoardMenu. */
function StatusFilterMenu({
  view,
  counts,
  total,
  onSet,
}: {
  view: ReviewStatus | "none" | "all";
  counts: Record<ReviewStatus | "none", number>;
  total: number;
  onSet: (view: ReviewStatus | "none" | "all") => void;
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

  const pick = (v: ReviewStatus | "none" | "all") => () => {
    setOpen(false);
    onSet(v);
  };
  const filtered = view !== "all";

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Filter screens by review status"
        className={open || filtered ? "rv-btn-toggle is-open" : "rv-btn-toggle"}
      >
        <Filter size={13} />
        {filtered ? (
          <>
            <span className={`rv-dot is-small ${statusClass(view === "none" ? undefined : view)}`} aria-hidden />
            {STATUS_LABEL[view]}
            <span className="rv-count">{counts[view]}</span>
          </>
        ) : (
          "Filter"
        )}
      </button>
      {open ? (
        <div role="menu" aria-label="Status filter" className="rv-menu" style={{ top: "100%", right: 0, marginTop: 8, width: 200 }}>
          <button type="button" role="menuitemradio" aria-checked={view === "all"} className="rv-menu-item" onClick={pick("all")}>
            <span className="rv-grow">All screens</span>
            <span className="rv-count">{total}</span>
            {view === "all" ? <Check size={13} style={{ flexShrink: 0 }} /> : null}
          </button>
          <div className="rv-menu-sep" aria-hidden />
          {ALL_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitemradio"
              aria-checked={view === s}
              className="rv-menu-item"
              onClick={pick(s)}
            >
              <span className={`rv-dot is-small ${statusClass(s === "none" ? undefined : s)}`} aria-hidden />
              <span className="rv-grow">{STATUS_LABEL[s]}</span>
              <span className="rv-count">{counts[s]}</span>
              {view === s ? <Check size={13} style={{ flexShrink: 0 }} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Cursor position in *scaled* world pixels, measured off the world element's
 * rendered box rather than derived from the transform state. Zoom anchoring has
 * to agree with what's actually on screen — deriving it from `t` re-drifts the
 * moment the rendered transform and state disagree (a queued update, a second
 * zoom source mid-gesture, any offset ancestor).
 */
function worldOffset(world: HTMLElement | null, clientX: number, clientY: number) {
  if (!world) return null;
  const r = world.getBoundingClientRect();
  return { x: clientX - r.left, y: clientY - r.top };
}

/** Where this board sits among the others (2026-08-13). Absent when the host
 *  has no folder above it — the board renders exactly as it did before
 *  projects existed. `projects` is everything this account can open, INCLUDING
 *  the current one; one entry means no switcher, because a chooser with a
 *  single option is a lie about what's behind it. */
export type BoardNav = {
  /** Back to the projects folder. Undefined when this account has only one
   *  project — a back arrow onto a page listing the board you just left is a
   *  door to nowhere. Switching projects happens THERE, not in the header
   *  (the reviewer, 2026-08-13): the folder already shows what each one is. */
  onFolder?: () => void;
  /** Admins only; the row is absent for everyone else. */
  onManageAccess?: () => void;
};

export function ReviewApp({
  project,
  seed = EMPTY_SNAPSHOT,
  nav,
}: {
  project: ReviewProject;
  seed?: ReviewSnapshot;
  nav?: BoardNav;
}) {
  const slug = projectSlug(project);

  // Sharing is one level: whoever can open this board can hand it to someone
  // else (review/access-rules.ts, canShare). The board is often reached by a
  // deep link without passing through the folder, so it asks for itself.
  const access = useMyAccess();

  // Which device the board simulates. Desktop keeps each screen's configured
  // frame; mobile swaps every frame to a phone frame and live pages render at
  // the phone viewport (real responsive layout, not a shrunk desktop).
  const deviceKey = `rv:${slug}:device`;
  // Mobile is the default (the reviewer, 2026-07-21) — the flows under review are
  // phone-first; desktop stays a stored per-browser choice.
  const [device, setDeviceState] = useState<ViewportMode>(() =>
    typeof window !== "undefined" && window.localStorage.getItem(deviceKey) === "desktop" ? "desktop" : "mobile",
  );
  const setDevice = (next: ViewportMode) => {
    setDeviceState(next);
    try {
      window.localStorage.setItem(deviceKey, next);
    } catch {
      /* ignore */
    }
  };
  const liveViewport = project.viewports?.[device] ?? LIVE_VIEWPORTS[device];

  const effProject = useMemo(() => {
    if (device === "desktop") {
      // Every live desktop frame is a browser WINDOW at the live viewport's aspect (1440×900),
      // never a whole page: a screen authored 6200 tall is not what a user's screen looks
      // like, and fits into a phone-shaped strip. The page scrolls inside the frame. A
      // phone-sized screen takes the default desktop width, and /redesign is asked for its
      // web surface (a bare URL is the native app, which draws a device frame at `lg`).
      const desktopW = Math.max(
        DEFAULT_SCREEN_W,
        project.screen?.w ?? 0,
        ...project.pages.flatMap((p) => p.flows.flatMap((f) => f.screens.map((x) => (x.source.kind === "url" ? (x.w ?? 0) : 0)))),
      );
      const wide = <S extends Screen>(s: S): S => {
        if (s.source.kind !== "url" || s.device === "phone") return s;
        // ONE width per project, so a row of frames reads as one screen size: the widest
        // authored desktop width, which a phone-authored screen takes too.
        const w = desktopW;
        const h = Math.round((w * liveViewport.h) / liveViewport.w);
        const src = s.source.src;
        const web =
          /^\/redesign(?=[/?#]|$)/.test(src) && !/[?&]surface=/.test(src)
            ? src.replace(/^([^#]*)/, (m) => m + (m.includes("?") ? "&" : "?") + "surface=web")
            : src;
        return { ...s, w, h, source: { ...s.source, src: web } };
      };
      return {
        ...project,
        pages: project.pages.map((p) => ({
          ...p,
          flows: p.flows.map((f) => ({ ...f, screens: f.screens.map(wide) })),
          branchLanes: p.branchLanes?.map((l) => ({ ...l, screens: l.screens?.map(wide) })),
        })),
      };
    }
    return {
      ...project,
      pages: project.pages.map((p) => ({
        ...p,
        flows: p.flows.map((f) => ({
          ...f,
          screens: f.screens.map((s) => ({ ...s, w: MOBILE_FRAME.w, h: MOBILE_FRAME.h })),
        })),
        // The Flow view's lane-local screens follow the same device swap.
        branchLanes: p.branchLanes?.map((l) => ({
          ...l,
          screens: l.screens?.map((s) => ({ ...s, w: MOBILE_FRAME.w, h: MOBILE_FRAME.h })),
        })),
      })),
    };
  }, [project, device, liveViewport.w, liveViewport.h]);

  const layouts = useMemo(() => {
    const m = new Map<string, PageLayout>();
    for (const page of effProject.pages) m.set(page.id, buildPageLayout(effProject, page));
    return m;
  }, [effProject]);

  // Identity: the signed-in Supabase account when auth is on (AuthGate
  // guarantees a display name), else the legacy localStorage name that the
  // composer's NameStep asks for on the first comment (offline mode only).
  const auth = useAuthOptional();
  const [localName, setLocalName] = useReviewerName(slug);
  const reviewerName = auth ? auth.displayName : localName;
  const setReviewerName = auth ? (n: string) => void auth.setDisplayName(n) : setLocalName;
  const identity = useMemo<ReviewerIdentity>(
    () => ({ name: reviewerName, email: auth?.email, id: auth?.userId }),
    [reviewerName, auth?.email, auth?.userId],
  );
  const { reviews, setScreen, setFlow } = useReviews(slug, seed, identity);
  const { overrides, move } = useLayoutOverrides(slug);
  const comments = useComments(slug, seed, identity);
  // Who can be tagged, and what I personally have and haven't read.
  const people = usePeople(identity);
  const { seen, markRead } = useReads(slug, identity);

  // Opt-in email notification prefs (the reviewer, 2026-07-30). Loaded once per
  // signed-in account; null (section hidden) offline or until the fetch lands.
  const [notifyPrefs, setNotifyPrefs] = useState<NotifyPrefs | null>(null);
  useEffect(() => {
    if (!auth?.email) return;
    let cancelled = false;
    void fetchNotifyPrefs(auth.email).then((p) => {
      if (!cancelled && p) setNotifyPrefs(p);
    });
    return () => {
      cancelled = true;
    };
  }, [auth?.email]);
  const toggleNotify = (patch: Partial<NotifyPrefs>) => {
    if (!auth?.email || !notifyPrefs) return;
    const prev = notifyPrefs;
    const next = { ...notifyPrefs, ...patch };
    setNotifyPrefs(next);
    void upsertNotifyPrefs(auth.email, auth.userId, next).then((ok) => {
      if (!ok) setNotifyPrefs(prev);
    });
  };

  const containerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  // Set while Safari is mid-pinch so the ctrl+wheel path doesn't fight the
  // native gesture handler (Safari fires both for one trackpad pinch).
  const gesturingRef = useRef(false);
  const [size, setSize] = useState<Size>({ w: 1280, h: 800 });

  // Per-page viewports + last page + modality, all restored across reloads.
  const viewportKey = `rv:${slug}:viewports`;
  const pageKey = `rv:${slug}:page`;
  const modeKey = `rv:${slug}:mode`;
  const loadViewports = (): Record<string, Transform> => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(window.localStorage.getItem(viewportKey) ?? "{}") as Record<string, Transform>;
    } catch {
      return {};
    }
  };
  const saveViewports = (next: Record<string, Transform>) => {
    try {
      window.localStorage.setItem(viewportKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  // Where the URL says to start (`?page=…&view=slides&screen=…`, written back
  // by the location-sync effect below) — a shared link must win over this
  // browser's remembered last position.
  const initialLoc = useRef(
    typeof window === "undefined" ? {} : parseBoardLocation(project, window.location.search),
  ).current;
  const [pageId, setPageId] = useState<string>(() => {
    const fallback = project.pages[0]!.id;
    if (initialLoc.pageId) return initialLoc.pageId;
    if (typeof window === "undefined") return fallback;
    const stored = window.localStorage.getItem(pageKey);
    return stored && project.pages.some((p) => p.id === stored) ? stored : fallback;
  });
  const [mode, setModeState] = useState<BoardMode>(() => {
    if (initialLoc.mode) return initialLoc.mode;
    if (typeof window === "undefined") return "canvas";
    const stored = window.localStorage.getItem(modeKey);
    return stored === "slides" || stored === "flow" ? stored : "canvas";
  });
  const [t, setT] = useState<Transform>(() => loadViewports()[pageId] ?? { x: ORIGIN_X * 0.5, y: 40, scale: 0.5 });

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [selectedScreenId, setSelectedScreenId] = useState<string | null>(initialLoc.screenId ?? null);
  // Status navigation (the reviewer, 2026-07-21: "instead of these being filters,
  // let's make them navigation"): one view at a time, "all" is home.
  const [statusView, setStatusView] = useState<ReviewStatus | "none" | "all">("all");

  const [commentMode, setCommentMode] = useState(false);
  const [pending, setPending] = useState<{ anchor: CommentAnchor } | null>(null);
  const [selectedComment, setSelectedComment] = useState<string | null>(null);
  const showCommentsKey = `rv:${slug}:showComments`;
  const [showComments, setShowComments] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(showCommentsKey) !== "0";
  });
  /** The persisted setter — hiding pins also dismisses whatever is open on them. */
  const setShowCommentsPersist = (next: boolean) => {
    setShowComments(next);
    try {
      window.localStorage.setItem(showCommentsKey, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (!next) {
      setSelectedComment(null);
      setPending(null);
    }
  };
  const [showResolved, setShowResolved] = useState(false);

  // The system-docs layer (docs.config.ts): on by default, per-browser like
  // the pin toggle — a reviewer who wants a clean look can shed it.
  const showDocsKey = `rv:${slug}:showDocs`;
  const [showDocs, setShowDocs] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem(showDocsKey) !== "0";
  });
  const setShowDocsPersist = (next: boolean) => {
    setShowDocs(next);
    try {
      window.localStorage.setItem(showDocsKey, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };

  // Theme: shared with the projects folder and Manage access (review/theme.ts),
  // so a navigation between them can't change the palette.
  const { themePref, setThemePref, darkMode } = useThemePref();

  // Sidebar: shared by both modalities (the reviewer, 2026-07-30) — the LIST follows
  // the active tool (pointer ⇒ Pages, comment mode ⇒ Comments; the reviewer,
  // 2026-07-30 v2). Only the open state sticks per browser.
  const sidebarOpenKey = `rv:${slug}:sidebar`;
  const [sidebarOpen, setSidebarOpenState] = useState(
    () => typeof window === "undefined" || window.localStorage.getItem(sidebarOpenKey) !== "0",
  );
  const setSidebarOpen = (next: boolean) => {
    setSidebarOpenState(next);
    try {
      window.localStorage.setItem(sidebarOpenKey, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const pageMenuRef = useRef<HTMLDivElement>(null);
  const [autoSaveState, setAutoSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const layout = layouts.get(pageId)!;

  // Close the page picker on outside click or Escape.
  useEffect(() => {
    if (!pageMenuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!pageMenuRef.current?.contains(e.target as Node)) setPageMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPageMenuOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [pageMenuOpen]);


  // Dev auto-export: every comment/review change writes the committed JSON
  // (resolved threads stay in the file). Debounced so typing notes isn't chatty.
  // Skip the mount run: on load the board is hydrated from localStorage, and
  // writing that straight back would clobber threads added to the file directly
  // (a teammate's commit, an agent's replies) before the reviewer can load them.
  // The skip is by dep identity, not a run-once flag, so StrictMode's dev
  // double-run of effects can't count the remount as an edit and write anyway.
  const hydrated = useRef<{ threads: unknown; reviews: unknown } | null>(null);
  if (hydrated.current === null) hydrated.current = { threads: comments.threads, reviews };
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // Remote mode: Supabase is the live source of truth and remote hydration
    // lands here as a threads change — writing THAT to review-board.json would
    // clobber the committed seed with whatever state hydrated (it did, once:
    // a stale localStorage merge overwrote the 07-17 anchor migration). The
    // JSON stays the agent/seed channel; live comments stay in the table.
    if (comments.remote) return;
    if (comments.threads === hydrated.current?.threads && reviews === hydrated.current?.reviews) return;
    setAutoSaveState("saving");
    const id = window.setTimeout(() => {
      const snapshot = buildSnapshot(comments.threads, reviews);
      void persistSnapshotToRepo(snapshot, slug).then((ok) => setAutoSaveState(ok ? "saved" : "error"));
    }, 700);
    return () => window.clearTimeout(id);
  }, [comments.threads, comments.remote, reviews, slug]);

  // --- geometry lookups -------------------------------------------------------

  const posOf = (fl: FlowLayout): Point => overrides[fl.flow.id] ?? fl.def;

  const flowByScreenId = useMemo(() => {
    const m = new Map<string, { fl: FlowLayout; x: number; y: number; w: number; h: number; index: number }>();
    for (const fl of layout.flows) {
      for (const sl of fl.screens) {
        m.set(sl.screen.id, { fl, x: sl.x, y: 0, w: sl.w, h: sl.h, index: sl.index });
      }
    }
    return m;
  }, [layout]);

  /** Screen id → page id, across every page (not just the active one) — lets a
   *  comment link work out which page a "screen"-anchored thread lives on. */
  const screenPageId = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of project.pages) for (const fl of p.flows) for (const s of fl.screens) m.set(s.id, p.id);
    return m;
  }, [project]);

  /** Threads that belong on this page: screen pins by their screen's page,
   *  board pins by the page they were dropped on. Doc notes (meta.docKind) are
   *  NOT comments — they render in the docs section, never as pins. */
  const pageThreads = useMemo(
    () =>
      comments.threads.filter(
        (th) =>
          !isDocNote(th) &&
          (th.anchor.type === "screen" ? flowByScreenId.has(th.anchor.screenId) : th.anchor.pageId === pageId),
      ),
    [comments.threads, flowByScreenId, pageId],
  );

  /** Threads the sidebar lists: everything anchored to a LIVE page — retired
   *  pages' threads stay in the file but can't be jumped to, so they don't show. */
  const sidebarThreads = useMemo(
    () =>
      comments.threads.filter((th) => {
        if (isDocNote(th)) return false;
        const anchor = th.anchor;
        return anchor.type === "screen"
          ? screenPageId.has(anchor.screenId)
          : project.pages.some((p) => p.id === anchor.pageId);
      }),
    [comments.threads, screenPageId, project],
  );

  /** Threads with something in them I haven't seen. Personal — it comes from my
   *  own read marks and is never shown to, or affected by, anyone else. Doc
   *  notes are excluded: they are documentation, not messages. */
  const unread = useMemo(() => {
    const s = new Set<string>();
    for (const th of comments.threads) {
      if (!isDocNote(th) && isUnread(th, seen[th.id], identity)) s.add(th.id);
    }
    return s;
  }, [comments.threads, seen, identity]);

  /** Per-screen open-comment rollup for the Flow view's node badges — count,
   *  any-unread, and the newest open thread as the badge's jump target. */
  const nodeThreads = useMemo(() => {
    const m = new Map<string, NodeThreads>();
    const newestFirst = [...pageThreads].sort((a, b) => b.at - a.at);
    for (const th of newestFirst) {
      if (th.resolved || th.anchor.type !== "screen") continue;
      const cur = m.get(th.anchor.screenId);
      if (cur) {
        cur.open += 1;
        cur.unread ||= unread.has(th.id);
      } else {
        m.set(th.anchor.screenId, { open: 1, unread: unread.has(th.id), firstId: th.id });
      }
    }
    return m;
  }, [pageThreads, unread]);

  /** Opening a thread is what marks it read — by any route (a pin, a sidebar
   *  row, a ?thread= deep link), which is why this watches the selection rather
   *  than living in each of those handlers. A reply landing while the popover
   *  is open counts as read too: it's on screen in front of you. */
  useEffect(() => {
    if (!selectedComment) return;
    const th = comments.threads.find((t) => t.id === selectedComment);
    if (th) markRead(th);
  }, [selectedComment, comments.threads, markRead]);

  /** Documentation events by screen id, oldest first — unresolved only
   *  (resolving archives an event off the canvas; delete removes it). */
  const eventsByScreen = useMemo(() => {
    const m = new Map<string, CommentThread[]>();
    for (const th of comments.threads) {
      if (!isDocNote(th) || th.resolved || th.anchor.type !== "screen") continue;
      const list = m.get(th.anchor.screenId);
      if (list) list.push(th);
      else m.set(th.anchor.screenId, [th]);
    }
    for (const list of m.values()) list.sort((a, b) => a.at - b.at);
    return m;
  }, [comments.threads]);

  const addEvent = (screenId: string) => (kind: DocKind, body: string, author: string) => {
    comments.add({ type: "screen", screenId, dx: 0, dy: 0 }, author, body, undefined, { docKind: kind });
  };

  /** Screen id → title across every page, for the comment list's context line. */
  const screenTitles = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of project.pages) for (const fl of p.flows) for (const s of fl.screens) m.set(s.id, s.title);
    return m;
  }, [project]);
  const threadContext = (th: CommentThread): string => {
    const anchor = th.anchor;
    return anchor.type === "screen"
      ? screenTitles.get(anchor.screenId) ?? "Screen"
      : project.pages.find((p) => p.id === anchor.pageId)?.title ?? "Board";
  };

  /** Resolve a comment anchor to current world coordinates (screen anchors move
   *  with their dragged flow lane). Anchors use content coordinates, so a pin
   *  dropped below the fold in slides view parks at the frame's bottom edge on
   *  the canvas instead of floating over the board. */
  const anchorToWorld = (a: CommentAnchor): Point => {
    if (a.type === "world") return { x: a.x, y: a.y };
    const hit = flowByScreenId.get(a.screenId);
    if (!hit) return { x: 0, y: 0 };
    const pos = posOf(hit.fl);
    return {
      x: pos.x + hit.x + a.dx,
      y: pos.y + FLOW_HEADER_H + HEADER_TO_LANE + Math.min(a.dy, hit.h - 10),
    };
  };

  /** A world point becomes a screen-relative anchor when it lands on a screen
   *  node, otherwise a fixed board anchor on this page. */
  const hitTest = (wx: number, wy: number): CommentAnchor => {
    for (const fl of layout.flows) {
      const pos = posOf(fl);
      const laneY = pos.y + FLOW_HEADER_H + HEADER_TO_LANE;
      for (const sl of fl.screens) {
        const nx = pos.x + sl.x;
        if (wx >= nx && wx <= nx + sl.w && wy >= laneY && wy <= laneY + sl.h) {
          return { type: "screen", screenId: sl.screen.id, dx: wx - nx, dy: wy - laneY };
        }
      }
    }
    return { type: "world", x: wx, y: wy, pageId };
  };

  /** Which flow header (if any) sits under a world point — used to resolve a
   *  plain click into a selection instead of a comment anchor. */
  const headerHitTest = (wx: number, wy: number): string | null => {
    for (const fl of layout.flows) {
      const pos = posOf(fl);
      if (wx >= pos.x && wx <= pos.x + fl.width && wy >= pos.y && wy <= pos.y + FLOW_HEADER_H) {
        return fl.flow.id;
      }
    }
    return null;
  };

  // --- viewport ----------------------------------------------------------------

  // Measure the viewport (re-attach when the canvas remounts after a mode switch).
  useEffect(() => {
    if (mode !== "canvas") return;
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  // Persist this page's viewport (debounced so a pan doesn't hammer localStorage).
  useEffect(() => {
    const id = window.setTimeout(() => {
      const all = loadViewports();
      all[pageId] = t;
      saveViewports(all);
    }, 350);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, pageId]);

  // Native, non-passive wheel: two-finger scroll pans, ctrl/⌘ scroll zooms at cursor.
  useEffect(() => {
    if (mode !== "canvas") return;
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Let a comment popover (or any opted-in region) own its own scroll instead
      // of the canvas eating the wheel and panning underneath it.
      if ((e.target as Element | null)?.closest?.("[data-rv-scroll]")) return;
      e.preventDefault();
      // Normalize line/page wheel deltas to pixels so a notched mouse wheel and a
      // trackpad feel the same.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        if (gesturingRef.current) return;
        // Pinch / ctrl+wheel = zoom toward the cursor. The coefficient is tuned so
        // one comfortable two-finger spread crosses the whole zoom range; the
        // per-event clamp guards against a single wild mouse-wheel notch.
        const p = worldOffset(worldRef.current, e.clientX, e.clientY);
        if (!p) return;
        setT((prev) => {
          const ratio = clamp(Math.exp(-dy * 0.012), 0.4, 2.5);
          const scale = clamp(prev.scale * ratio, MIN_SCALE, MAX_SCALE);
          const k = scale / prev.scale;
          return { scale, x: prev.x - p.x * (k - 1), y: prev.y - p.y * (k - 1) };
        });
      } else {
        // Two-finger scroll / wheel = pan, 1:1 with the gesture.
        setT((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode]);

  // Safari reports trackpad pinch as a native gesture with a precise cumulative
  // `scale` — use it when present for a truer 1:1 feel. Other browsers only ever
  // fire the ctrl+wheel path above, which stays as the universal fallback.
  useEffect(() => {
    if (mode !== "canvas") return;
    const el = containerRef.current;
    if (!el || !("GestureEvent" in window)) return;
    // Applied incrementally (last gesture scale → this one) against the live
    // world box, so the anchor tracks the cursor even as the fingers travel.
    let last = 1;
    const onStart = (e: any) => {
      e.preventDefault();
      gesturingRef.current = true;
      last = 1;
    };
    const onChange = (e: any) => {
      e.preventDefault();
      const p = worldOffset(worldRef.current, e.clientX, e.clientY);
      const ratio = e.scale / last;
      last = e.scale;
      if (!p || !Number.isFinite(ratio) || ratio <= 0) return;
      setT((prev) => {
        const scale = clamp(prev.scale * ratio, MIN_SCALE, MAX_SCALE);
        const k = scale / prev.scale;
        return { scale, x: prev.x - p.x * (k - 1), y: prev.y - p.y * (k - 1) };
      });
    };
    const onEnd = (e: any) => {
      e.preventDefault();
      gesturingRef.current = false;
    };
    el.addEventListener("gesturestart", onStart);
    el.addEventListener("gesturechange", onChange);
    el.addEventListener("gestureend", onEnd);
    return () => {
      el.removeEventListener("gesturestart", onStart);
      el.removeEventListener("gesturechange", onChange);
      el.removeEventListener("gestureend", onEnd);
    };
  }, [mode]);

  const zoomBy = (factor: number) => {
    const cx = size.w / 2;
    const cy = size.h / 2;
    setT((prev) => {
      const scale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE);
      const k = scale / prev.scale;
      return { scale, x: cx - (cx - prev.x) * k, y: cy - (cy - prev.y) * k };
    });
  };

  const fitAll = () => setT(fitTransform(layout.bounds, size));

  // Slides-mode zoom, relative to the fitted screen (1 = fit). The toolbar
  // buttons and the stage's pinch / ctrl+wheel both funnel through here.
  // Dev mode: a tool, not a place — it never enters the board URL, because a
  // shared board link should open on the work, not on someone's inspector.
  const [devMode, setDevMode] = useState(false);
  /** Right-click → Inspect: dev mode opens on the element at this point. */
  const [inspectAt, setInspectAt] = useState<{ x: number; y: number; n: number } | null>(null);

  const [slideZoom, setSlideZoom] = useState(1);
  const slideZoomBy = (factor: number) =>
    setSlideZoom((z) => clamp(z * factor, SLIDE_ZOOM_MIN, SLIDE_ZOOM_MAX));

  // Flow view: its pan/zoom lives inside the component (its world is a
  // different geometry from the canvas's); the ref is how the toolbar and the
  // ⌘ zoom keys reach it, and flowScale is its reported zoom for the readout.
  const flowApiRef = useRef<FlowViewApi | null>(null);
  const [flowScale, setFlowScale] = useState(1);

  // --- pages ---------------------------------------------------------------------

  const switchPage = (id: string) => {
    if (id === pageId) return;
    // Save the outgoing page's viewport immediately; a quick switch shouldn't
    // wait out the debounce and lose the last pan.
    const all = loadViewports();
    all[pageId] = t;
    saveViewports(all);
    try {
      window.localStorage.setItem(pageKey, id);
    } catch {
      /* ignore */
    }
    setPageId(id);
    setSelectedFlowId(null);
    setSelectedScreenId(null);
    setSelectedComment(null);
    setPending(null);
    const next = layouts.get(id)!;
    setT(all[id] ?? fitTransform(next.bounds, size));
  };

  // --- modality --------------------------------------------------------------------

  /** Pan the board so a screen sits centered, keeping the current zoom. */
  const centerOnScreen = (screenId: string) => {
    const hit = flowByScreenId.get(screenId);
    if (!hit) return;
    const pos = posOf(hit.fl);
    const cx = pos.x + hit.x + hit.w / 2;
    const cy = pos.y + FLOW_HEADER_H + HEADER_TO_LANE + hit.h / 2;
    setT((prev) => ({ scale: prev.scale, x: size.w / 2 - cx * prev.scale, y: size.h / 2 - cy * prev.scale }));
  };

  /** Pan the board so a raw world point (a board-level comment anchor) sits centered. */
  const centerOnWorld = (wx: number, wy: number) => {
    setT((prev) => ({ scale: prev.scale, x: size.w / 2 - wx * prev.scale, y: size.h / 2 - wy * prev.scale }));
  };

  /** Which page a thread's pin lives on — screen anchors travel with their screen. */
  const pageIdForThread = (thread: CommentThread): string =>
    thread.anchor.type === "world" ? thread.anchor.pageId : screenPageId.get(thread.anchor.screenId) ?? pageId;

  /** Puts a URL on the clipboard that reopens exactly this comment (see the
   *  deep-link restore effect below): the `?thread=` id is authoritative, `page`
   *  just makes the copied link readable at a glance before anyone opens it. */
  const copyThreadLink = async (threadId: string) => {
    const thread = comments.threads.find((t) => t.id === threadId);
    const url = new URL(window.location.href);
    url.search = "";
    url.searchParams.set("page", thread ? pageIdForThread(thread) : pageId);
    url.searchParams.set("thread", threadId);
    await navigator.clipboard.writeText(url.toString());
  };

  /** Sidebar "Pages" click: slides changes the slide; canvas selects the screen
   *  and brings the camera onto it — zooming in to a readable (live) scale when
   *  the board is too far out to see what was just picked. */
  const focusScreen = (id: string) => {
    if (mode === "slides") {
      selectSlide(id);
      return;
    }
    if (mode === "flow") {
      setSelectedFlowId(null);
      setSelectedScreenId(id);
      flowApiRef.current?.centerOn(id);
      return;
    }
    const hit = flowByScreenId.get(id);
    if (!hit) return;
    setSelectedFlowId(null);
    setSelectedScreenId(id);
    const pos = posOf(hit.fl);
    const cx = pos.x + hit.x + hit.w / 2;
    const cy = pos.y + FLOW_HEADER_H + HEADER_TO_LANE + hit.h / 2;
    setT((prev) => {
      const scale =
        prev.scale >= LIVE_SCALE
          ? prev.scale
          : clamp(Math.min((size.w - 120) / hit.w, (size.h - 160) / hit.h), LIVE_SCALE, 1);
      return { scale, x: size.w / 2 - cx * scale, y: size.h / 2 - cy * scale };
    });
  };

  /** Sidebar "Comments" click: jump to the thread wherever it lives. Slides
   *  keeps the modality for screen pins (the guard below clears the open thread
   *  on a slide change, so the id waits in pendingThreadRef); board pins fall
   *  back to canvas — slides has nowhere to show a world anchor. */
  const openThread = (threadId: string) => {
    const thread = comments.threads.find((th) => th.id === threadId);
    if (!thread) return;
    const targetPage = pageIdForThread(thread);
    if (!project.pages.some((p) => p.id === targetPage)) return;
    if (thread.resolved) setShowResolved(true);
    setShowCommentsPersist(true);
    if (mode === "slides" && thread.anchor.type === "screen") {
      if (targetPage !== pageId) switchPage(targetPage);
      if (thread.anchor.screenId === selectedScreenId) {
        setSelectedComment(threadId);
      } else {
        pendingThreadRef.current = threadId;
        selectSlide(thread.anchor.screenId);
      }
      return;
    }
    if (mode !== "canvas") switchMode("canvas");
    if (targetPage !== pageId) {
      pendingCenterRef.current = { pageId: targetPage, anchor: thread.anchor };
      switchPage(targetPage);
    } else if (thread.anchor.type === "screen") {
      centerOnScreen(thread.anchor.screenId);
    } else {
      centerOnWorld(thread.anchor.x, thread.anchor.y);
    }
    // Last write wins over the clears in switchMode/switchPage.
    setSelectedComment(threadId);
  };

  // Deep link: `?thread=<id>` in the URL jumps straight to that comment — force
  // canvas mode (slides can't show every anchor type), select its page, reveal
  // it even if resolved, open the popover, and (once the target page's layout
  // is live) pan the camera onto its pin. Runs once per page load.
  const pendingCenterRef = useRef<{ pageId: string; anchor: CommentAnchor } | null>(null);
  const appliedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (appliedDeepLinkRef.current) return;
    const threadId = new URLSearchParams(window.location.search).get("thread");
    if (!threadId) return;
    appliedDeepLinkRef.current = true;
    // Drop only `thread` — one-shot by design. `page`/`view`/`screen` stay the
    // location-sync effect's to manage (it rewrites them as the jump applies).
    const rest = new URLSearchParams(window.location.search);
    rest.delete("thread");
    const qs = rest.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    const thread = comments.threads.find((t) => t.id === threadId);
    if (!thread) return;
    const targetPage = pageIdForThread(thread);
    if (!project.pages.some((p) => p.id === targetPage)) return;
    setShowResolved(true);
    switchMode("canvas");
    switchPage(targetPage);
    setSelectedComment(threadId);
    pendingCenterRef.current = { pageId: targetPage, anchor: thread.anchor };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comments.threads]);

  useEffect(() => {
    const pending = pendingCenterRef.current;
    if (!pending || pending.pageId !== pageId) return;
    pendingCenterRef.current = null;
    if (pending.anchor.type === "screen") centerOnScreen(pending.anchor.screenId);
    else centerOnWorld(pending.anchor.x, pending.anchor.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  // The URL always says where you are: `?page=…`, plus `view=slides&screen=…`
  // in slides — so the address bar is shareable at any moment and a reload
  // lands exactly where you were (the reviewer, 2026-07-29). Foreign params (`thread`
  // mid-restore) pass through untouched. Page changes PUSH so back/forward
  // step between pages; everything else replaces in place — after a popstate
  // the URL already matches the applied state, so the equality check keeps
  // history application from pushing again.
  const lastSyncedPageRef = useRef(pageId);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.set("page", pageId);
    if (mode === "slides" || mode === "flow") params.set("view", mode);
    else params.delete("view");
    if (mode === "slides" && selectedScreenId) params.set("screen", selectedScreenId);
    else params.delete("screen");
    const search = params.toString();
    if (search !== window.location.search.replace(/^\?/, "")) {
      const url = `${window.location.pathname}?${search}${window.location.hash}`;
      if (pageId !== lastSyncedPageRef.current) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    }
    lastSyncedPageRef.current = pageId;
  }, [pageId, mode, selectedScreenId]);

  // Back/forward re-applies the URL it lands on. No deps array on purpose
  // (the keyboard listener above sets the precedent): the handler needs this
  // render's state and helpers, and re-attaching per render is cheap.
  useEffect(() => {
    const onPop = () => {
      const loc = parseBoardLocation(project, window.location.search);
      if (loc.pageId && loc.pageId !== pageId) switchPage(loc.pageId);
      const nextMode = loc.mode ?? "canvas";
      if (nextMode !== mode) switchMode(nextMode, loc.screenId);
      else if (loc.screenId && loc.screenId !== selectedScreenId) selectSlide(loc.screenId);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  });

  const switchMode = (next: BoardMode, focusScreenId?: string) => {
    if (next === mode && !focusScreenId) return;
    // A pending pin or open thread is tied to the view it was opened in;
    // don't strand it across the switch.
    setPending(null);
    setSelectedComment(null);
    if (next === "slides") {
      if (focusScreenId) {
        // Opened straight from a screen on the board — focus exactly that one.
        setSelectedScreenId(focusScreenId);
        setSelectedFlowId(null);
      } else {
        const fl = selectedFlowId ? layout.flows.find((f) => f.flow.id === selectedFlowId) : undefined;
        const currentFlow = selectedScreenId ? flowByScreenId.get(selectedScreenId)?.fl : undefined;
        if (fl && currentFlow?.flow.id !== fl.flow.id && fl.screens[0]) {
          setSelectedScreenId(fl.screens[0].screen.id);
        }
      }
    } else if (selectedScreenId) {
      // Carry the reviewed screen back to the board: keep it ring-selected and
      // center the canvas on it so the round-trip lands where you left off.
      setSelectedFlowId(null);
      centerOnScreen(selectedScreenId);
    }
    setModeState(next);
    try {
      window.localStorage.setItem(modeKey, next);
    } catch {
      /* ignore */
    }
  };

  // Slides always have a current screen: heal an empty or off-page selection.
  useEffect(() => {
    if (mode !== "slides") return;
    if (selectedScreenId && flowByScreenId.has(selectedScreenId)) return;
    const first = layout.flows[0]?.screens[0];
    setSelectedScreenId(first ? first.screen.id : null);
  }, [mode, selectedScreenId, flowByScreenId, layout]);

  const slides = useMemo(
    () => layout.flows.flatMap((fl) => fl.screens.map((sl) => sl.screen.id)),
    [layout],
  );
  const slideIndex = selectedScreenId ? slides.indexOf(selectedScreenId) : -1;

  /** Slide changes ride a View Transition so the stage frame morphs between
   *  screens instead of swap-flashing. Feature-gated; reduced motion and
   *  unsupporting browsers get the instant swap. */
  const withSlideTransition = (fn: () => void) => {
    const start = document.startViewTransition?.bind(document);
    // Hidden pages (background tab, headless review) skip the transition —
    // its animation frames would never run.
    if (
      mode !== "slides" ||
      !start ||
      document.visibilityState === "hidden" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      fn();
      return;
    }
    start(() => flushSync(fn));
  };
  // Remount ticket for the slides stage frame: user-initiated selections bump
  // it, booting a fresh frame at the new screen's seeded URL. Board-follows
  // (the frame navigated itself and the selection catches up, below) keep it,
  // so the app the reviewer is mid-walk in never reloads under them.
  const [frameTicket, setFrameTicket] = useState(0);
  const selectSlide = (id: string) =>
    withSlideTransition(() => {
      setFrameTicket((n) => n + 1);
      setSelectedScreenId(id);
    });
  const stepSlide = (delta: number) => {
    if (slides.length === 0) return;
    const next = clamp(slideIndex < 0 ? 0 : slideIndex + delta, 0, slides.length - 1);
    selectSlide(slides[next]!);
  };

  // The board follows a walk: when the reviewer navigates INSIDE the live
  // stage frame (the bridge in frame.tsx reports path+search), match the route
  // back to a screen and move the selection there — sidebar, header, pager,
  // and URL all catch up while the frame itself stays put. Ambiguous routes
  // (the seeded /intake questions) and off-board routes change nothing; a
  // unique match on another page switches pages (the reviewer, 2026-07-29).
  const routeIndex = useMemo(() => buildRouteIndex(project), [project]);
  const onFrameNavigate = (url: string) => {
    const hit = matchScreenForUrl(routeIndex, url, pageId);
    if (!hit || hit.screenId === selectedScreenId) return;
    if (hit.pageId !== pageId) switchPage(hit.pageId);
    // No view transition and no ticket bump: the stage pixels aren't changing,
    // only the chrome follows.
    setSelectedScreenId(hit.screenId);
  };

  // A pending pin or open thread is anchored to whichever screen was showing
  // when it opened; changing the slide would strand it, so close it instead.
  const lastSlideKeyRef = useRef(selectedScreenId);
  if (lastSlideKeyRef.current !== selectedScreenId) {
    lastSlideKeyRef.current = selectedScreenId;
    if (pending) setPending(null);
    if (selectedComment) setSelectedComment(null);
  }

  // A sidebar comment-click in slides changes the slide first — the guard above
  // would immediately clear the thread it's trying to open, so the id waits
  // here and applies once the new slide is committed.
  const pendingThreadRef = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingThreadRef.current) return;
    const id = pendingThreadRef.current;
    pendingThreadRef.current = null;
    setSelectedComment(id);
  }, [selectedScreenId]);

  // --- presence: who else is here, their cursors, follow mode (presence.ts) ------

  const presenceMe = useMemo(
    () =>
      auth
        ? { uid: auth.userId, name: auth.displayName, color: validColor(auth.presenceLook.color), emoji: cleanEmoji(auth.presenceLook.emoji) }
        : null,
    // Keyed on the fields: `auth` is a fresh object every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth?.userId, auth?.displayName, auth?.presenceLook.color, auth?.presenceLook.emoji],
  );
  const presencePlace = useMemo<Place>(
    () => ({ pageId, mode, screenId: mode === "slides" ? selectedScreenId : null }),
    [pageId, mode, selectedScreenId],
  );
  const presenceHidden = auth?.presenceHidden ?? false;
  const presence = usePresence({
    slug,
    me: presenceMe,
    hidden: presenceHidden,
    place: presencePlace,
    getView: () => ({
      view: mode === "canvas" ? viewOf(t, size) : mode === "flow" ? (flowApiRef.current?.getView() ?? null) : null,
      slideZoom,
    }),
  });

  // Following: walk to the leader's page, then their view, then their camera.
  // One step per render — each switch re-renders and this runs again.
  const leaderView = presence.leaderView;
  useEffect(() => {
    if (!leaderView || !presence.following) return;
    if (leaderView.pageId !== pageId) {
      if (project.pages.some((p) => p.id === leaderView.pageId)) switchPage(leaderView.pageId);
      return;
    }
    if (leaderView.mode !== mode) {
      switchMode(leaderView.mode, leaderView.screenId ?? undefined);
      return;
    }
    if (mode === "slides") {
      if (leaderView.screenId && leaderView.screenId !== selectedScreenId) selectSlide(leaderView.screenId);
      setSlideZoom(leaderView.slideZoom);
    } else if (leaderView.view) {
      if (mode === "canvas") setT(fitView(leaderView.view, size, MIN_SCALE, MAX_SCALE));
      else flowApiRef.current?.setView(leaderView.view);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaderView, pageId, mode, selectedScreenId]);

  // Any move of your own (a press, a scroll, Escape) hands the camera back.
  // The avatar row and the follow pill are exempt: they ARE the follow controls.
  const stopFollowing = presence.follow;
  const isFollowing = Boolean(presence.following);
  useEffect(() => {
    if (!isFollowing) return;
    const exempt = (e: Event) => {
      const el = e.target as Element | null;
      return Boolean(el && typeof el.closest === "function" && el.closest(".rv-presence-ui"));
    };
    const onPress = (e: Event) => {
      if (e.isTrusted && !exempt(e)) stopFollowing(null);
    };
    // Escape inside the flyout closes the flyout, not the follow.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !exempt(e)) stopFollowing(null);
    };
    window.addEventListener("pointerdown", onPress, true);
    window.addEventListener("wheel", onPress, { capture: true, passive: true });
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPress, true);
      window.removeEventListener("wheel", onPress, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [isFollowing, stopFollowing]);

  // --- pointer: pan on empty canvas, click to select, drag what's selected ---------

  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const dragRef = useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; started: boolean } | null>(null);
  // Active touch pointers (container-relative) and the pinch gesture they may be driving.
  const pointersRef = useRef<Map<number, Point>>(new Map());
  const pinchRef = useRef<{ dist: number; midX: number; midY: number; startScale: number; startX: number; startY: number } | null>(null);

  const relPoint = (e: ReactPointerEvent): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
  };
  const startPinch = () => {
    const [a, b] = Array.from(pointersRef.current.values());
    if (!a || !b) return;
    pinchRef.current = {
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      startScale: t.scale,
      startX: t.x,
      startY: t.y,
    };
    panRef.current = null;
    dragRef.current = null;
    setDraggingId(null);
  };
  const onBgPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    // A background press in normal mode dismisses an open thread.
    if (!commentMode && selectedComment) setSelectedComment(null);
    containerRef.current?.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      pointersRef.current.set(e.pointerId, relPoint(e));
      if (pointersRef.current.size === 2) {
        startPinch();
        return;
      }
    }
    panRef.current = { sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y };
  };
  /** A press on a flow header only arms a move when that flow is already
   *  selected — click first, then hold and drag. */
  const onHeaderPointerDown = (e: ReactPointerEvent, id: string, pos: Point) => {
    if (e.button !== 0 || id !== selectedFlowId) return;
    e.stopPropagation();
    dragRef.current = { id, sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, started: false };
    containerRef.current?.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (e.pointerType === "touch" && pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, relPoint(e));
      const pr = pinchRef.current;
      if (pr && pointersRef.current.size === 2) {
        const [a, b] = Array.from(pointersRef.current.values());
        const d = Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y));
        const mx = (a!.x + b!.x) / 2;
        const my = (a!.y + b!.y) / 2;
        const scale = clamp(pr.startScale * (d / pr.dist), MIN_SCALE, MAX_SCALE);
        const k = scale / pr.startScale;
        setT({ scale, x: mx - (pr.midX - pr.startX) * k, y: my - (pr.midY - pr.startY) * k });
        return;
      }
    }
    const d = dragRef.current;
    if (d) {
      if (!d.started) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_SLOP) return;
        d.started = true;
        setDraggingId(d.id);
      }
      move(d.id, { x: d.ox + (e.clientX - d.sx) / t.scale, y: d.oy + (e.clientY - d.sy) / t.scale });
      return;
    }
    const p = panRef.current;
    if (p) setT((prev) => ({ ...prev, x: p.ox + (e.clientX - p.sx), y: p.oy + (e.clientY - p.sy) }));
  };
  const endPointer = (e: ReactPointerEvent) => {
    const p = panRef.current;
    const slop = e.pointerType === "touch" ? CLICK_SLOP_TOUCH : CLICK_SLOP;
    const wasClick = !!p && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < slop;
    const wasDrag = dragRef.current?.started === true;
    panRef.current = null;
    dragRef.current = null;
    setDraggingId(null);
    containerRef.current?.releasePointerCapture?.(e.pointerId);

    if (e.pointerType === "touch") {
      pointersRef.current.delete(e.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      // Lifting one finger out of a pinch hands off to a single-finger pan,
      // anchored where that finger already is, so nothing jumps.
      if (pointersRef.current.size === 1) {
        const rect = containerRef.current?.getBoundingClientRect();
        const [[, pt]] = Array.from(pointersRef.current.entries());
        if (rect && pt) {
          panRef.current = { sx: pt.x + rect.left, sy: pt.y + rect.top, ox: t.x, oy: t.y };
        }
      }
    }

    if (commentMode) {
      // In comment mode, a click (not a pan) either dismisses the open UI or drops a pin.
      if (!wasClick) return;
      if (pending) {
        setPending(null);
        return;
      }
      if (selectedComment) {
        setSelectedComment(null);
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const wx = (e.clientX - rect.left - t.x) / t.scale;
      const wy = (e.clientY - rect.top - t.y) / t.scale;
      setShowComments(true);
      setPending({ anchor: hitTest(wx, wy) });
      return;
    }

    // A stationary click that didn't already arm a drag selects what's under
    // it: a flow header selects the flow (movable), a screen selects that
    // screen (carried into slides on switch), open canvas clears both.
    if (wasClick && !wasDrag) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const wx = (e.clientX - rect.left - t.x) / t.scale;
      const wy = (e.clientY - rect.top - t.y) / t.scale;
      const flowId = headerHitTest(wx, wy);
      if (flowId) {
        setSelectedFlowId(flowId);
        setSelectedScreenId(null);
      } else {
        const hit = hitTest(wx, wy);
        setSelectedFlowId(null);
        setSelectedScreenId(hit.type === "screen" ? hit.screenId : null);
      }
    }
  };

  // Keyboard: C toggles comment mode, arrows step screens (slides),
  // Escape backs out of the current layer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "Escape") {
        if (pending) setPending(null);
        else if (selectedComment) setSelectedComment(null);
        else if (commentMode) setCommentMode(false);
        else if (mode === "canvas" && selectedFlowId) setSelectedFlowId(null);
        else if ((mode === "canvas" || mode === "flow") && selectedScreenId) setSelectedScreenId(null);
        return;
      }
      // ⌘/Ctrl +/−/0 zoom the BOARD, not the browser. On a canvas app the
      // browser's own zoom is the wrong tool — it scales the chrome along with
      // the work and leaves the stored viewport lying about where you are.
      // Handled ahead of the typing guard because these are never text keys.
      // (Chrome/Firefox honor preventDefault here; Safari's page zoom is not
      // cancelable, so there it stays the browser's.)
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        // "=" is the unshifted +; Digit-row and numpad both report these.
        const inKey = e.key === "+" || e.key === "=";
        const outKey = e.key === "-" || e.key === "_";
        if (inKey || outKey) {
          e.preventDefault();
          // Same step as the toolbar's own zoom buttons, so keys and buttons
          // land on the same percentages.
          const factor = inKey ? 1.25 : 1 / 1.25;
          if (mode === "slides") slideZoomBy(factor);
          else if (mode === "flow") flowApiRef.current?.zoomBy(factor);
          else zoomBy(factor);
          return;
        }
        if (e.key === "0") {
          e.preventDefault();
          if (mode === "slides") setSlideZoom(1);
          else if (mode === "flow") flowApiRef.current?.fit();
          else fitAll();
          return;
        }
      }
      if (typing) return;
      if (mode === "slides") {
        if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
          e.preventDefault();
          stepSlide(1);
          return;
        }
        if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
          e.preventDefault();
          stepSlide(-1);
          return;
        }
      }
      if (e.key === "c" || e.key === "C") {
        const next = !commentMode;
        setCommentMode(next);
        if (next) setShowCommentsPersist(true);
        setPending(null);
      }
      // D toggles dev mode, beside C for comment — the two armed tools.
      if (e.key === "d" || e.key === "D") {
        setDevMode((d) => !d);
        setCommentMode(false);
        setPending(null);
      }
      // V returns to the pointer tool (a design tool's move shortcut).
      if (e.key === "v" || e.key === "V") {
        setCommentMode(false);
        setDevMode(false);
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Visible world rect, for virtualization.
  const margin = VIEW_MARGIN / t.scale;
  const view = {
    left: -t.x / t.scale - margin,
    top: -t.y / t.scale - margin,
    right: (-t.x + size.w) / t.scale + margin,
    bottom: (-t.y + size.h) / t.scale + margin,
  };
  const intersects = (x: number, y: number, w: number, h: number) =>
    x < view.right && x + w > view.left && y < view.bottom && y + h > view.top;

  // --- review helpers -----------------------------------------------------------

  // One gate: with the states hidden nothing downstream (frame borders, the
  // sidebar's dots, the page menu, muting) ever sees a status.
  const screenStatus = (screenId: string) => (SHOW_REVIEW_STATUS ? reviews.screens[screenId]?.status : undefined);
  const flowRoll = (fl: FlowLayout): { status: ReviewStatus | undefined; auto: boolean } => {
    const explicit = SHOW_REVIEW_STATUS ? reviews.flows[fl.flow.id]?.status : undefined;
    if (explicit) return { status: explicit, auto: false };
    return { status: worstStatus(fl.screens.map((sl) => screenStatus(sl.screen.id))), auto: true };
  };
  const pageWorst = (id: string): ReviewStatus | undefined => {
    const pl = layouts.get(id);
    if (!pl) return undefined;
    return worstStatus(pl.flows.map((fl) => flowRoll(fl).status));
  };

  // Counts for the current page (the filter pills act on what's on screen).
  const counts = useMemo(() => {
    const c: Record<ReviewStatus | "none", number> = { good: 0, needs: 0, none: 0 };
    for (const fl of layout.flows) {
      for (const sl of fl.screens) c[screenStatus(sl.screen.id) ?? "none"]++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviews.screens, layout]);

  // Canvas-only: the status nav lives on the canvas (slides hides it — the reviewer,
  // 2026-07-21), so a scoped view must never invisibly thin the slides list.
  const isMuted = (status: ReviewStatus | undefined) =>
    mode === "canvas" && statusView !== "all" && (status ?? "none") !== statusView;

  const pageScreens = counts.good + counts.needs + counts.none;
  const activePage = project.pages.find((p) => p.id === pageId) ?? project.pages[0]!;
  // The Flow view charts a page's authored lanes; a page without any has no
  // Flow tab, and a stored or linked `flow` mode falls back to the canvas.
  const hasFlow = Boolean(activePage.branchLanes?.length);
  useEffect(() => {
    if (mode === "flow" && !hasFlow) setModeState("canvas");
  }, [mode, hasFlow]);

  // Every url screen on every page, for the background snapshot warmer —
  // switching boards should paint bitmaps, not re-run the boot sweep. Screens
  // that aren't on the open page are marked `defer`: they still get warmed,
  // but a beat later, so the board you're actually looking at fills in first.
  const warmShots = useMemo(() => {
    const shots: {
      src: string;
      seed?: import("./model").ScreenSeed;
      viewport: { w: number; h: number };
      defer?: boolean;
    }[] = [];
    for (const p of effProject.pages) {
      for (const f of p.flows)
        for (const s of f.screens)
          if (s.source.kind === "url")
            shots.push({ src: s.source.src, seed: s.source.seed, viewport: s.device === "phone" ? LIVE_VIEWPORTS.mobile : liveViewport, defer: p.id !== pageId });
      // The Flow view's lane-local step frames warm too — a first visit to
      // Flow mode should paint bitmaps, not run a boot sweep in front of you.
      for (const l of p.branchLanes ?? [])
        for (const s of l.screens ?? [])
          if (s.source.kind === "url")
            shots.push({ src: s.source.src, seed: s.source.seed, viewport: s.device === "phone" ? LIVE_VIEWPORTS.mobile : liveViewport, defer: p.id !== pageId });
    }
    return shots.sort((a, b) => Number(a.defer ?? false) - Number(b.defer ?? false));
  }, [effProject, liveViewport, pageId]);

  // Read the persisted capture index (and the route-version manifest it's
  // validated against) before any frame decides whether it needs to boot.
  useEffect(() => {
    void initSnapshots();
  }, []);

  /**
   * On the board, zoom belongs to the CANVAS (the reviewer, 2026-08-13).
   *
   * Scoped to the board and restored on unmount, NOT set in index.html: the
   * product routes are patient-facing telehealth screens for an older
   * audience, and blocking pinch-zoom on those is a WCAG 1.4.4 failure. The
   * board is an internal tool with its own zoom control, which is the case
   * where suppressing it is the right call.
   *
   * ⚠ This governs TOUCH pinch only. Desktop browsers ignore `user-scalable`
   * for ⌘+/⌘−/menu zoom entirely — that is intercepted in the keydown handler
   * above, and trackpad pinch arrives as ctrl+wheel, which the canvas already
   * cancels. So this is the third of three mechanisms, not a replacement for
   * either.
   */
  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const original = meta.getAttribute("content") ?? "";
    meta.setAttribute("content", `${original}, maximum-scale=1, user-scalable=no`);
    return () => meta.setAttribute("content", original);
  }, []);

  // --- download screens ---------------------------------------------------------
  // Canvas exports the whole page as a ZIP of PNGs, one folder per flow;
  // slides exports the single screen on the stage. Shots are taken fresh and
  // lossless (export-png.ts) — the preview cache is lossy WebP sized for
  // glancing at while panning, not for a file that leaves the browser.

  const [exportState, setExportState] = useState<ExportState>({ phase: "idle" });
  const exportAbortRef = useRef<AbortController | null>(null);
  /** The slides stage's booted iframe: a single-screen export shoots THAT
   *  frame, so it matches the state the reviewer walked into rather than a
   *  fresh boot of the seeded URL. */
  const stageFrameRef = useRef<HTMLIFrameElement | null>(null);
  const exportBusy = exportState.phase === "working" || exportState.phase === "packing";

  // Outcome messages clear themselves; a stuck chip in the header is noise.
  useEffect(() => {
    if (exportState.phase !== "done" && exportState.phase !== "error") return;
    const t = window.setTimeout(() => setExportState({ phase: "idle" }), 6000);
    return () => window.clearTimeout(t);
  }, [exportState]);

  // Leaving the board mid-export tears the boots down with it.
  useEffect(() => () => exportAbortRef.current?.abort(), []);

  /** The CSS viewport a frame renders its page at: the board's live viewport
   *  width, at that frame's own aspect — so the PNG frames exactly what the
   *  board frames, phone or desktop. */
  const shotViewport = (w: number, h: number) => ({
    w: liveViewport.w,
    h: Math.max(1, Math.round((h * liveViewport.w) / w)),
  });

  const selectedLayout = useMemo(() => {
    for (const fl of layout.flows) {
      const sl = fl.screens.find((s) => s.screen.id === selectedScreenId);
      if (sl) return sl;
    }
    return null;
  }, [layout, selectedScreenId]);

  // A menu row now, so it is short: the row's place says PNG/ZIP well enough.
  /** The board's right-click rows for the spot clicked (presence-chat.tsx
   *  draws the menu around them: Chat and reactions above). */
  const boardMenuItems: BoardMenuItems = (at) => {
    const s = toSurface(at.x, at.y);
    let anchor: CommentAnchor | null = null;
    if (s && mode === "canvas") anchor = hitTest(s.x, s.y);
    else if (s && mode === "slides" && selectedScreenId) anchor = { type: "screen", screenId: selectedScreenId, dx: s.x, dy: s.y };
    const screenId = anchor?.type === "screen" ? anchor.screenId : null;
    const screen = screenId
      ? project.pages.flatMap((p) => p.flows.flatMap((fl) => fl.screens)).find((x) => x.id === screenId)
      : undefined;

    const tools = [
      ...(anchor
        ? [
            {
              id: "comment",
              label: "Comment here",
              kbd: "C",
              icon: "💭",
              onSelect: () => {
                setDevMode(false);
                setShowComments(true);
                setPending({ anchor: anchor! });
              },
            },
          ]
        : []),
      // One dev row: Inspect opens dev mode ON what was clicked (D alone
      // opens it with nothing picked).
      {
        id: "inspect",
        label: "Inspect",
        kbd: "D",
        icon: "🔍",
        onSelect: () => {
          setCommentMode(false);
          setPending(null);
          setDevMode(true);
          setInspectAt((prev) => ({ x: at.x, y: at.y, n: (prev?.n ?? 0) + 1 }));
        },
      },
    ];

    const screenRows = screen
      ? [
          ...(mode === "canvas"
            ? [{ id: "slides", label: "Open in single page", icon: "▢", onSelect: () => switchMode("slides", screen.id) }]
            : []),
          {
            id: "link",
            label: "Copy link to this screen",
            icon: "🔗",
            onSelect: () => {
              const url = new URL(window.location.href);
              url.search = "";
              url.hash = "";
              url.searchParams.set("page", screenPageId.get(screen.id) ?? pageId);
              url.searchParams.set("view", "slides");
              url.searchParams.set("screen", screen.id);
              void navigator.clipboard.writeText(url.toString());
            },
          },
          ...(screen.source.kind === "url"
            ? [
                {
                  id: "live",
                  label: "Open live page",
                  icon: "↗",
                  onSelect: () => {
                    if (screen.source.kind === "url")
                      window.open(seededSrc(screen.source.src, screen.source.seed), "_blank", "noreferrer");
                  },
                },
              ]
            : []),
        ]
      : [];

    const view = [
      {
        id: "fit",
        label: "Zoom to fit",
        kbd: "⌘0",
        icon: "⤢",
        onSelect: () => (mode === "canvas" ? fitAll() : mode === "flow" ? flowApiRef.current?.fit() : setSlideZoom(1)),
      },
    ];
    return [tools, screenRows, view];
  };

  const exportLabel = mode === "slides" ? "Download this screen" : `Download all ${pageScreens} screens`;

  const downloadScreens = async () => {
    if (exportBusy) return;
    const ctl = new AbortController();
    exportAbortRef.current = ctl;
    try {
      if (mode === "slides") {
        const sl = selectedLayout;
        if (!sl) {
          setExportState({ phase: "error", message: "No screen selected" });
          return;
        }
        setExportState({ phase: "working", done: 0, total: 1 });
        // The stage frame is already booted and is what the reviewer sees;
        // fall back to a fresh offscreen boot when it isn't live (an image
        // screen, or a frame still painting its cached bitmap).
        const live = stageFrameRef.current;
        let blob = live
          ? await requestCapture(live, { pixelRatio: EXPORT_PIXEL_RATIO, format: "image/png", timeoutMs: 25_000 })
          : null;
        if (!blob && !ctl.signal.aborted && sl.screen.source.kind === "url")
          blob = await capturePng(
            {
              path: "",
              src: sl.screen.source.src,
              seed: sl.screen.source.seed,
              viewport: shotViewport(sl.w, sl.h),
            },
            ctl.signal,
          );
        if (ctl.signal.aborted) {
          setExportState({ phase: "idle" });
          return;
        }
        if (!blob) {
          setExportState({ phase: "error", message: "Couldn't capture that screen" });
          return;
        }
        saveBlob(blob, `${slugify(activePage.title)}-${slugify(sl.screen.title)}.png`);
        setExportState({ phase: "done", message: "Screen downloaded" });
        return;
      }

      // Zip paths mirror the board: a numbered folder per flow, numbered
      // files inside, so the archive reads in the order the canvas does.
      const specs: ShotSpec[] = [];
      layout.flows.forEach((fl, fi) => {
        const folder = `${String(fi + 1).padStart(2, "0")}-${slugify(fl.flow.title)}`;
        fl.screens.forEach((sl, si) => {
          if (sl.screen.source.kind !== "url") return;
          specs.push({
            path: `${folder}/${String(si + 1).padStart(2, "0")}-${slugify(sl.screen.title)}`,
            src: sl.screen.source.src,
            seed: sl.screen.source.seed,
            viewport: shotViewport(sl.w, sl.h),
          });
        });
      });
      if (!specs.length) {
        setExportState({ phase: "error", message: "No live screens on this page" });
        return;
      }

      setExportState({ phase: "working", done: 0, total: specs.length });
      const { blob, failed } = await exportZip(specs, {
        signal: ctl.signal,
        onProgress: (p) => setExportState({ phase: "working", done: p.done, total: p.total }),
        onPacking: () => setExportState({ phase: "packing" }),
      });
      if (ctl.signal.aborted) {
        setExportState({ phase: "idle" });
        return;
      }
      if (!blob) {
        setExportState({ phase: "error", message: "Couldn't capture any screens" });
        return;
      }
      saveBlob(blob, `${slugify(project.name)}-${slugify(activePage.title)}-${device}.zip`);
      // A shortfall is reported, never rounded away: the archive is short.
      setExportState({
        phase: "done",
        message: failed
          ? `Downloaded ${specs.length - failed} of ${specs.length} — ${failed} couldn't be captured`
          : `Downloaded ${specs.length} screens`,
      });
    } catch {
      setExportState({ phase: "error", message: "Download failed" });
    } finally {
      if (exportAbortRef.current === ctl) exportAbortRef.current = null;
    }
  };

  return (
    <div className={darkMode ? "rv-root is-dark" : "rv-root"}>
      {/* Toolbar */}
      <header className="rv-header">
        <div className="rv-header-main">
          <a
            href={BRAND.url}
            target="_blank"
            rel="noreferrer"
            title={BRAND.name}
            className="rv-logo-btn"
          >
            <img src={BRAND.logo} alt={BRAND.name} className="rv-header-logo" />
          </a>
          {/* Back to the folder, not a project switcher (the reviewer, 2026-08-13):
              you choose a project where you can see what each one is. Absent
              for an account with only one — see BoardNav.onFolder. */}
          {/* From any other view, back means the canvas first (the reviewer,
              2026-09-18): the projects list is one more press away. */}
          {mode !== "canvas" || nav?.onFolder ? (
            <button
              type="button"
              onClick={mode !== "canvas" ? () => switchMode("canvas") : nav?.onFolder}
              title={mode !== "canvas" ? "Back to canvas" : "All projects"}
              aria-label={mode !== "canvas" ? "Back to canvas" : "All projects"}
              className="rv-btn-icon rv-header-back"
            >
              <CaretLeft size={17} />
            </button>
          ) : null}
          <h1 className="rv-header-title">{project.name}</h1>
          {/* Page switcher lives beside the title (the reviewer, 2026-07-21) — where
              you are sits with what you're in; the bottom dock keeps only view
              controls. */}
          <div ref={pageMenuRef} style={{ position: "relative", flexShrink: 0, alignSelf: "center" }}>
            <button
              type="button"
              onClick={() => setPageMenuOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={pageMenuOpen}
              title="Switch page"
              className={pageMenuOpen ? "rv-page-trigger is-open" : "rv-page-trigger"}
            >
              <span className="rv-title">{activePage.title}</span>
              <CaretDown
                size={11}
                style={{ transform: pageMenuOpen ? "rotate(180deg)" : undefined, transition: "transform 120ms" }}
              />
            </button>
            {pageMenuOpen ? (
              <div
                role="menu"
                aria-label="Board pages"
                className="rv-menu"
                style={{ top: "100%", left: 0, marginTop: 8, width: 224, maxHeight: "min(60vh, 320px)", overflowY: "auto" }}
              >
                {project.pages.map((p) => {
                  const active = p.id === pageId;
                  const worst = pageWorst(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={active}
                      onClick={() => {
                        switchPage(p.id);
                        setPageMenuOpen(false);
                      }}
                      title={`${p.title}${worst ? ` · ${STATUS_LABEL[worst]}` : ""}`}
                      className="rv-menu-item"
                      style={active ? { background: "var(--rv-muted)" } : undefined}
                    >
                      {SHOW_REVIEW_STATUS ? <span className={`rv-dot is-small ${statusClass(worst)}`} aria-hidden /> : null}
                      <span className="rv-grow">{p.title}</span>
                      {active ? <Check size={13} style={{ flexShrink: 0 }} /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <span className="rv-header-sub">
            {layout.flows.length} flows · {pageScreens} screens
          </span>
          {/* Remote sync is silent when healthy (the "Live comments" chatter
              died with the logo pass, the reviewer 2026-07-21) — only trouble speaks. */}
          {comments.remote ? (
            comments.remoteError ? (
              <span className="rv-autosave is-error">{comments.remoteError}</span>
            ) : null
          ) : import.meta.env.DEV ? (
            <span
              className={autoSaveState === "error" ? "rv-autosave is-error" : "rv-autosave"}
              title={`Autosaves to ${snapshotFilename(slug)}. Resolved comments stay in the file.`}
            >
              {autoSaveState === "saving"
                ? "Saving…"
                : autoSaveState === "saved"
                  ? "Saved to board file"
                  : autoSaveState === "error"
                    ? "Autosave failed — is the dev server running?"
                    : null}
            </span>
          ) : null}
        </div>

        {/* The status filter is hidden (the reviewer, 2026-09-18): nobody used it. The
            component and `statusView` stay, so it is one line to bring back. */}
        {SHOW_STATUS_FILTER && mode === "canvas" ? (
          <StatusFilterMenu view={statusView} counts={counts} total={pageScreens} onSet={setStatusView} />
        ) : null}

        {/* Sharing this board: a labelled pill, not a ⋯ row — handing a project
            to someone is the move people come looking for. */}
        {/* Everyone here, me last (presence-ui.tsx). One menu: my look and
            Show me to others, then the people (pick one to follow). */}
        {presence.enabled && auth ? (
          <PresenceMenu
            self={{
              name: auth.displayName,
              color: presenceMe?.color ?? colorIndex(auth.userId),
              emoji: presenceMe?.emoji ?? null,
            }}
            peers={presence.peers}
            everyone={presence.everyone}
            following={presence.following}
            followers={presence.followers}
            shown={!presenceHidden}
            onToggleShown={() => void auth.setPresenceHidden(!presenceHidden)}
            onRename={(n) => void auth.setDisplayName(n)}
            onLook={(patch) => void auth.setPresenceLook(patch)}
            onFollow={presence.follow}
            pageTitle={(id) => project.pages.find((p) => p.id === id)?.title ?? "Another page"}
          />
        ) : null}

        {canShare(access, slug) ? <ShareButton slug={slug} projectName={project.name} /> : null}

        {/* Export status only: the download itself starts from the ⋯ menu
            (the reviewer, 2026-09-18). A running export still reports and cancels here. */}
        <ExportControl state={exportState} onCancel={() => exportAbortRef.current?.abort()} />

        {/* Comment view controls (hide pins, show resolved) moved into the
            comments sidebar's ⋯ menu (the reviewer, 2026-07-30). */}
        <BoardMenu
          theme={themePref}
          onTheme={setThemePref}
          onManageAccess={nav?.onManageAccess}
          onRefreshPreviews={() => void clearSnapshots()}
          download={{
            label: exportLabel,
            busy: exportState.phase === "working" || exportState.phase === "packing",
            onStart: () => void downloadScreens(),
          }}
          account={auth ? { name: auth.displayName, email: auth.email, onSignOut: () => void auth.signOut() } : null}
          notify={notifyPrefs ? { prefs: notifyPrefs, toggle: toggleNotify } : null}
        />
      </header>

      {/* Background snapshot warmer — invisible, queue-bounded, all pages. */}
      <SnapshotWarmer shots={warmShots} />

      {/* Workspace: the shared sidebar (Pages / Comments), then canvas board or
          slides review, plus the floating toolbar */}
      <div className="rv-workspace">
        {sidebarOpen ? (
          <BoardSidebar
            tab={commentMode ? "comments" : "pages"}
            mode={mode}
            onMode={switchMode}
            hasFlow={hasFlow}
            onBack={() => {
              setCommentMode(false);
              setPending(null);
            }}
            onClose={() => setSidebarOpen(false)}
            flows={layout.flows}
            selectedScreenId={selectedScreenId}
            onSelectScreen={focusScreen}
            screenStatus={screenStatus}
            isMuted={isMuted}
            threads={sidebarThreads}
            threadContext={threadContext}
            selectedThreadId={selectedComment}
            unread={unread}
            onOpenThread={openThread}
            showComments={showComments}
            onToggleComments={() => setShowCommentsPersist(!showComments)}
            showResolved={showResolved}
            onToggleResolved={() => setShowResolved((v) => !v)}
            showDocs={showDocs}
            onToggleDocs={() => setShowDocsPersist(!showDocs)}
          />
        ) : (
          /* Collapsed: the reopen control floats where the sidebar's edge was,
             so open/close live in the same spot instead of down in the toolbar. */
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Show sidebar"
            title="Show sidebar"
            className="rv-side-open"
          >
            <PanelLeft size={15} />
          </button>
        )}
        {mode === "canvas" ? (
          <div
            ref={containerRef}
            className="rv-canvas"
            style={{ touchAction: "none", cursor: commentMode ? COMMENT_CURSOR : undefined }}
            onPointerDown={onBgPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerLeave={endPointer}
            onDoubleClick={(e) => {
              // Double-click a screen to jump straight into the slideshow on it.
              if (commentMode) return;
              const rect = containerRef.current?.getBoundingClientRect();
              if (!rect) return;
              const wx = (e.clientX - rect.left - t.x) / t.scale;
              const wy = (e.clientY - rect.top - t.y) / t.scale;
              const hit = hitTest(wx, wy);
              if (hit.type === "screen") switchMode("slides", hit.screenId);
            }}
          >
            {/* A page with nothing on it says so (2026-08-13, with the second
                project): an empty canvas and a canvas that failed to load look
                identical otherwise. Same sentence as single-page view, and in
                SCREEN space — parked in the world it would shrink to nothing
                at board zoom, which is exactly when you need to read it. */}
            {layout.flows.length === 0 ? <p className="rv-canvas-empty">This page has no screens yet.</p> : null}
            <div
              ref={worldRef}
              className="rv-world"
              data-presence-surface={`canvas:${pageId}`}
              data-presence-scale={t.scale}
              style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})` }}
            >
              {/* Dotted board background (world-sized), also the pan surface. */}
              <div className="rv-dots" style={{ width: layout.bounds.w, height: layout.bounds.h }} />

              {/* The page label band is gone (the reviewer, 2026-07-30) — the header's
                  page picker already names where you are. */}

              {/* Section bands — one per run of consecutive flows sharing a
                  Flow.section. Fixed at default positions. */}
              {layout.sections.map((sec) => (
                <div
                  key={`${sec.title}@${sec.y}`}
                  className="rv-section-band"
                  style={{ left: ORIGIN_X, top: sec.y, width: PAGE_HEADER_W, height: SECTION_HEADER_H }}
                >
                  <div className="rv-section-band-eyebrow">Section</div>
                  <h3>{sec.title}</h3>
                  <p>
                    {sec.flowCount} {sec.flowCount === 1 ? "flow" : "flows"} · {sec.screenCount} screens
                  </p>
                </div>
              ))}

              {/* Flow lanes */}
              {layout.flows.map((fl) => {
                const pos = posOf(fl);
                const laneFull = FLOW_HEADER_H + HEADER_TO_LANE + fl.laneH;
                if (!intersects(pos.x, pos.y, fl.width, laneFull)) return null;
                const roll = flowRoll(fl);
                const dragging = draggingId === fl.flow.id;
                const selected = selectedFlowId === fl.flow.id;

                return (
                  <div key={fl.flow.id} className="rv-flow" style={{ left: pos.x, top: pos.y, width: fl.width }}>
                    {/* Selection frame around the whole lane, canvas-style, so
                        what's selected (and movable) is unambiguous. */}
                    {selected || dragging ? (
                      <div aria-hidden className={dragging ? "rv-selection-frame is-dragging" : "rv-selection-frame"} />
                    ) : null}

                    {/* Flow header: click to select, then hold and drag to move. */}
                    <div
                      onPointerDown={(e) => onHeaderPointerDown(e, fl.flow.id, pos)}
                      className={[
                        "rv-flow-header",
                        selected && "is-selected",
                        dragging && "is-dragging",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ height: FLOW_HEADER_H }}
                      title={selected ? "Hold and drag to move this flow" : "Click to select"}
                    >
                      <div className="rv-flow-header-main">
                        <div className="rv-flow-header-eyebrow">
                          Flow {fl.flowIndex + 1} of {layout.flows.length} · {fl.screens.length} screens
                        </div>
                        <h3>{fl.flow.title}</h3>
                        {fl.flow.subtitle ? <p className="rv-flow-header-sub">{fl.flow.subtitle}</p> : null}
                      </div>
                      {!SHOW_REVIEW_STATUS ? null : <button
                        type="button"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => setFlow(fl.flow.id, { status: nextStatus(reviews.flows[fl.flow.id]?.status) })}
                        className={
                          roll.status
                            ? `rv-pill is-action is-on ${statusClass(roll.status)}`
                            : `rv-pill is-action ${statusClass(undefined)}`
                        }
                        title={
                          (!roll.auto ? statusAttribution(reviews.flows[fl.flow.id]) : null) ?? "Set flow verdict"
                        }
                      >
                        <span className={`rv-dot ${statusClass(roll.status)}`} aria-hidden />
                        {roll.status ? STATUS_LABEL[roll.status] : "Verdict"}
                        {roll.status && roll.auto ? <span style={{ opacity: 0.6 }}>auto</span> : null}
                      </button>}
                    </div>

                    {/* Screen lane */}
                    <div style={{ position: "relative", marginTop: HEADER_TO_LANE, height: fl.laneH }}>
                      {fl.screens.map((sl, i) => {
                        const worldX = pos.x + sl.x;
                        const worldY = pos.y + FLOW_HEADER_H + HEADER_TO_LANE;
                        const visible = intersects(worldX, worldY, sl.w, sl.h);
                        const st = screenStatus(sl.screen.id);
                        const next = fl.screens[i + 1];
                        const screenSel = selectedScreenId === sl.screen.id;
                        return (
                          <div
                            key={sl.screen.id}
                            className={screenSel ? "rv-screen is-selected" : "rv-screen"}
                            style={{ left: sl.x, opacity: isMuted(st) ? 0.22 : 1 }}
                          >
                            {/* Selection ring: double-click (or select + switch) opens this screen in slides. */}
                            {screenSel ? <div aria-hidden className="rv-screen-sel" /> : null}
                            <div style={{ position: "absolute", left: 0, top: -44 }}>
                              <ScreenReviewBar
                                status={st}
                                entry={reviews.screens[sl.screen.id]}
                                onSet={(status) => setScreen(sl.screen.id, { status })}
                              />
                            </div>
                            <ScreenFrame
                              screen={sl.screen}
                              index={sl.index}
                              total={fl.screens.length}
                              w={sl.w}
                              h={sl.h}
                              status={st}
                              live={visible}
                              preferLive={t.scale >= LIVE_SCALE}
                              liveViewport={liveViewport}
                            />
                            {next ? (
                              <div
                                className="rv-flow-arrow"
                                style={{ left: sl.w, top: Math.min(sl.h, next.h) / 2 - 10, width: SCREEN_GAP, height: 20 }}
                              >
                                <span className="rv-line" />
                                <CaretRight size={17} style={{ flexShrink: 0 }} />
                              </div>
                            ) : null}
                            {/* Documentation events directly below the frame —
                                what the system does at this moment (emails,
                                push, webhooks, notes), added by reviewers. */}
                            {showDocs ? (
                              <div className="rv-screen-docs" style={{ top: sl.h + 12 }}>
                                <ScreenEvents
                                  events={eventsByScreen.get(sl.screen.id) ?? []}
                                  scope={`“${sl.screen.title}”`}
                                  popScale={1 / t.scale}
                                  reviewerName={reviewerName}
                                  onSetReviewerName={setReviewerName}
                                  onAdd={addEvent(sl.screen.id)}
                                  onRemove={comments.remove}
                                />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Comment-mode capture layer: intercepts every click so a pin can land
                anywhere (including on a screen), and disables screen interaction. */}
            {commentMode ? <div style={{ position: "absolute", inset: 0 }} /> : null}

            {/* Comment pins, composer, and threads (screen-space, above the board). */}
            <CommentsOverlay
              transform={t}
              size={size}
              threads={pageThreads}
              showComments={showComments}
              showResolved={showResolved}
              reviewerName={reviewerName}
              people={people}
              myEmail={identity.email}
              unread={unread}
              onSetReviewerName={setReviewerName}
              pending={pending}
              onCancelPending={() => setPending(null)}
              onCreate={(anchor, body, author, image, mentions) => {
                comments.add(anchor, author, body, image, undefined, mentions);
                setPending(null);
              }}
              selectedId={selectedComment}
              onSelect={setSelectedComment}
              onReply={(id, body, author, image, mentions) => comments.reply(id, author, body, image, mentions)}
              onRemoveReply={comments.removeReply}
              onResolve={comments.setResolved}
              onRemove={comments.remove}
              onMove={comments.move}
              onCopyLink={copyThreadLink}
              anchorToWorld={anchorToWorld}
            />

          </div>
        ) : mode === "flow" ? (
          /* Flow view (the reviewer, 2026-08-18): the page as a branching chart. Keyed
             per page + device so its viewport state restarts with its world. */
          <FlowView
            key={`${pageId}:${device}`}
            project={effProject}
            page={effProject.pages.find((p) => p.id === pageId) ?? activePage}
            liveViewport={liveViewport}
            liveScale={LIVE_SCALE}
            storageKey={`rv:${slug}:flowview:${pageId}:${device}`}
            selectedScreenId={selectedScreenId}
            screenStatus={screenStatus}
            nodeThreads={nodeThreads}
            onSelectScreen={(id) => {
              setSelectedFlowId(null);
              setSelectedScreenId(id);
            }}
            onOpenScreen={(id) => switchMode("slides", id)}
            onOpenThread={openThread}
            onScale={setFlowScale}
            apiRef={flowApiRef}
          />
        ) : (
          <SlidesView
            flows={layout.flows}
            liveViewport={liveViewport}
            selectedScreenId={selectedScreenId}
            index={slideIndex}
            total={slides.length}
            onStep={stepSlide}
            zoom={slideZoom}
            onZoomBy={slideZoomBy}
            screenStatus={screenStatus}
            screenEntry={(id) => reviews.screens[id]}
            setScreen={setScreen}
            frameKey={frameTicket}
            onFrameNavigate={onFrameNavigate}
            captureApi={stageFrameRef}
            events={
              showDocs
                ? {
                    forScreen: (id) => eventsByScreen.get(id) ?? [],
                    onAdd: (id, kind, body, author) => addEvent(id)(kind, body, author),
                    onRemove: comments.remove,
                    reviewerName,
                    onSetReviewerName: setReviewerName,
                  }
                : null
            }
            comments={{
              commentMode,
              commentCursor: COMMENT_CURSOR,
              threads: pageThreads,
              showComments,
              showResolved,
              reviewerName,
              people,
              myEmail: identity.email,
              unread,
              onSetReviewerName: setReviewerName,
              pending,
              onDropPin: (dx, dy) => {
                if (!selectedScreenId) return;
                if (pending) {
                  setPending(null);
                  return;
                }
                if (selectedComment) {
                  setSelectedComment(null);
                  return;
                }
                setShowComments(true);
                setPending({ anchor: { type: "screen", screenId: selectedScreenId, dx, dy } });
              },
              onCancelPending: () => setPending(null),
              onCreate: (anchor, body, author, image, mentions) => {
                comments.add(anchor, author, body, image, undefined, mentions);
                setPending(null);
              },
              selectedId: selectedComment,
              onSelect: setSelectedComment,
              onReply: (id, body, author, image, mentions) => comments.reply(id, author, body, image, mentions),
              onRemoveReply: comments.removeReply,
              onResolve: comments.setResolved,
              onRemove: comments.remove,
              onMove: comments.move,
              onCopyLink: copyThreadLink,
            }}
          />
        )}

        {/* Floating toolbar: page picker, modality, comment mode, zoom — the
            single navigation surface, docked like a design tool's toolbar. The
            contextual hint rides IN the dock rather than floating over the
            canvas: the canvas is a transformed, remounting, sometimes
            zero-width box, and anything positioned against it drifts away from
            the toolbar it's supposed to sit above. */}
        <div className={sidebarOpen ? "rv-toolbar-dock is-shifted" : "rv-toolbar-dock"}>
          {/* Distinct keys: both branches render a <Hint> in the same slot, and
              without a key React would reuse the instance — a hint that already
              dismissed itself would swallow the other one's mount. */}
          {commentMode ? (
            <Hint key="comment" comment>
              {mode === "slides" ? "Click the screen" : "Click anywhere"} to drop a comment · Esc to exit
            </Hint>
          ) : mode === "canvas" && counts.good + counts.needs === 0 ? (
            <Hint key="canvas" once="canvas">
              Drag to pan · ⌘ scroll to zoom · click a flow to select it · C to comment
            </Hint>
          ) : null}
          {presence.following ? <FollowPill peer={presence.following} onStop={() => presence.follow(null)} /> : null}
          {/* Two tools + zoom. Cursor is the quiet default (select/pan);
              comment is the armed mode — it keeps the accent treatment because
              it changes what a click does. */}
          <div className="rv-toolbar">
            <button
              type="button"
              onClick={() => {
                setCommentMode(false);
                setPending(null);
              }}
              aria-pressed={!commentMode}
              title="Move — select & pan (Esc)"
              className={commentMode ? "rv-tool-btn" : "rv-tool-btn is-on"}
            >
              <Cursor size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !commentMode;
                setCommentMode(next);
                if (next) setShowCommentsPersist(true);
                setPending(null);
              }}
              aria-pressed={commentMode}
              title="Comment mode (C)"
              className={commentMode ? "rv-tool-btn is-hot" : "rv-tool-btn"}
            >
              <Chat size={15} />
            </button>
            {/* Dev mode — the third tool. Like comment mode it changes what a
                click does, so it belongs beside the other two rather than in
                the ⋯ menu. It inspects the app INSIDE a frame, never the board
                around it. */}
            <button
              type="button"
              onClick={() => {
                setDevMode((d) => !d);
                setCommentMode(false);
                setPending(null);
              }}
              aria-pressed={devMode}
              title="Dev mode — inspect and export a screen's markup (D)"
              className={devMode ? "rv-tool-btn is-on" : "rv-tool-btn"}
            >
              <Code size={15} />
            </button>

            {/* Device switcher: which viewport the frames simulate. */}
            <span className="rv-toolbar-sep" aria-hidden />
            <div className="rv-seg" role="group" aria-label="Frame viewport">
              <button
                type="button"
                onClick={() => setDevice("desktop")}
                aria-pressed={device === "desktop"}
                title={`Desktop frames (pages render at ${(project.viewports?.desktop ?? LIVE_VIEWPORTS.desktop).w}px)`}
                className={device === "desktop" ? "rv-seg-btn is-on" : "rv-seg-btn"}
              >
                <Desktop size={14} />
              </button>
              <button
                type="button"
                onClick={() => setDevice("mobile")}
                aria-pressed={device === "mobile"}
                title={`Mobile frames (pages render at ${(project.viewports?.mobile ?? LIVE_VIEWPORTS.mobile).w}px)`}
                className={device === "mobile" ? "rv-seg-btn is-on" : "rv-seg-btn"}
              >
                <Phone size={14} />
              </button>
            </div>

            {/* Zoom rides in both modes: canvas zooms the board (absolute scale),
                slides zooms the current screen (100% = fit). */}
            <span className="rv-toolbar-sep" aria-hidden />
            <ZoomMenu
              percent={Math.round((mode === "canvas" ? t.scale : mode === "flow" ? flowScale : slideZoom) * 100)}
              fitLabel={mode === "slides" ? "Fit screen" : "Zoom to fit"}
              onZoomIn={() =>
                mode === "canvas" ? zoomBy(1.25) : mode === "flow" ? flowApiRef.current?.zoomBy(1.25) : slideZoomBy(1.25)
              }
              onZoomOut={() =>
                mode === "canvas"
                  ? zoomBy(1 / 1.25)
                  : mode === "flow"
                    ? flowApiRef.current?.zoomBy(1 / 1.25)
                    : slideZoomBy(1 / 1.25)
              }
              onFit={() => (mode === "canvas" ? fitAll() : mode === "flow" ? flowApiRef.current?.fit() : setSlideZoom(1))}
              onSetPercent={(p) =>
                mode === "canvas"
                  ? zoomBy(p / 100 / t.scale)
                  : mode === "flow"
                    ? flowApiRef.current?.zoomBy(p / 100 / flowScale)
                    : slideZoomBy(p / 100 / slideZoom)
              }
            />
          </div>
        </div>

        {/* Presence: everyone else's pointer, and the frame while following. */}
        {presence.enabled ? (
          <PresenceCursors
            cursorsRef={presence.cursorsRef}
            entriesRef={presence.entriesRef}
            chatsRef={presence.chatsRef}
            reactionsRef={presence.reactionsRef}
            clearRef={presence.reactClearRef}
            pointerRef={presence.pointerRef}
            myTab={presence.tab}
          />
        ) : null}
        {/* Press / to chat on your cursor, E for reactions (presence-chat.tsx). */}
        {presence.enabled && auth ? (
          <CursorChat
            presence={presence}
            color={presenceMe?.color ?? colorIndex(auth.userId)}
            hidden={presenceHidden}
            items={boardMenuItems}
          />
        ) : null}
        {presence.following ? <FollowFrame peer={presence.following} /> : null}

        {/* Outside the dock and outside the canvas: the panel is a fixed layer
            over the whole board, and it must not be inside the transformed
            world it measures. */}
        {devMode && (
          <Suspense fallback={null}>
            <DevPanel mode="board" inspectAt={inspectAt} onClose={() => setDevMode(false)} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
