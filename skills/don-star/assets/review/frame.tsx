// A screen node on the board. Framed like B43's canvas screens so a capture
// reads as a device screen, not a naked image: slim
// title header, then the content (image, live page, or live element), plus
// the per-screen sign-off bar docked above the frame.
//
// Every `url` screen renders the real, responsive page — at every zoom, in
// every viewport, seeded or not (each frame carries its seed in its own URL,
// see src/review-seed.ts). There are no snapshot stand-ins: a captured PNG is
// a fixed-width picture of a responsive design, so it is only ever right by
// accident. A frame that isn't live yet shows a neutral skeleton, and one that
// can't reach the app says so.

import { useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from "react";
import { seededSrc } from "../review-seed";
import { OpenExternal } from "./icons";
import {
  acquireBootSlot,
  captureFrame,
  getSnapshot,
  hydrateSnapshot,
  isFresh,
  snapshotEpoch,
  snapshotKey,
  snapshotsInited,
  snapshotsReady,
  subscribeSnapshots,
} from "./snapshot-cache";
import { versionFor } from "./screen-versions";
import {
  assetUrl,
  LIVE_VIEWPORTS,
  SHOW_REVIEW_STATUS,
  relTime,
  STATUS_LABEL,
  type ReviewEntry,
  type ReviewStatus,
  type Screen,
  type ScreenSeed,
} from "./model";

export function statusClass(status: ReviewStatus | undefined): string {
  return `rv-s-${status ?? "none"}`;
}

/** "Signed off — the reviewer, 2h ago" for a set status with attribution; null when
 *  there's nothing to attribute (no status, or a pre-attribution entry). */
export function statusAttribution(entry: ReviewEntry | undefined): string | null {
  if (!entry?.status) return null;
  const who = entry.by?.trim();
  const when = entry.at ? relTime(entry.at) : null;
  if (!who && !when) return null;
  return `${STATUS_LABEL[entry.status]} — ${who || "someone"}${when ? `, ${when}` : ""}`;
}

/** Imperative scroll access into a frame's content (live page or tall image),
 *  so comment pins can anchor to page coordinates and threads can scroll the
 *  frame back to their pin. */
export type FrameScrollApi = {
  get: () => number;
  to: (y: number, smooth?: boolean) => void;
};

// One availability probe per session: the proxy either reaches the app's dev
// server or it doesn't. Probing per-frame would hammer a dead target.
let appProbe: Promise<boolean> | null = null;
function probeApp(src: string): Promise<boolean> {
  appProbe ??= fetch(src, { cache: "no-store" }).then(
    (r) => r.ok,
    () => false,
  );
  return appProbe;
}

function LiveScreen({
  src,
  seed,
  title,
  live,
  preferLive,
  forceLive,
  interactive,
  frameW,
  viewport,
  scrollApi,
  captureApi,
  onScrollChange,
  onLiveChange,
  onNavigate,
}: {
  src: string;
  seed?: ScreenSeed;
  title: string;
  live: boolean;
  /** False on the zoomed-out canvas: a cached self-capture (snapshot-cache.ts)
   *  stands in for the live iframe, and cache-less frames boot through the
   *  bounded queue instead of all at once. */
  preferLive: boolean;
  /** The reviewer asked THIS frame for the live page (the header's Go live).
   *  Zooming in no longer boots a frame whose capture is current — a canvas is
   *  for looking, and booting a lane of apps to look at them is the cost this
   *  cache exists to remove. */
  forceLive?: boolean;
  interactive: boolean;
  /** Frame width in board units — the iframe is laid out at `viewport` size
   *  and scaled by frameW/viewport.w, so the page renders its real
   *  desktop/mobile design instead of whatever breakpoint ~960px hits. */
  frameW: number;
  viewport: { w: number; h: number };
  scrollApi?: MutableRefObject<FrameScrollApi | null>;
  /** Handle on the booted iframe, for exporting THIS frame as the reviewer
   *  left it (review/export-png.ts). Null whenever no live page is mounted —
   *  the exporter falls back to a fresh offscreen boot. */
  captureApi?: MutableRefObject<HTMLIFrameElement | null>;
  onScrollChange?: (top: number) => void;
  onLiveChange?: (live: boolean) => void;
  /** Interactive frames only: reports the path+search the page inside
   *  navigates to, so the board can follow a walk (see app.tsx). */
  onNavigate?: (url: string) => void;
}) {
  // The seed rides in the frame's own URL, so seeded frames go live alongside
  // each other — no shared-storage race to dodge.
  const liveSrc = seededSrc(src, seed);
  const snapKey = snapshotKey(liveSrc, viewport.w);
  // Re-runs whenever a capture lands, a route's content version moves (dev
  // saves), or the reviewer clears previews.
  const epoch = useSyncExternalStore(subscribeSnapshots, snapshotEpoch);
  const version = versionFor(liveSrc);
  const inited = snapshotsInited();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [snapUrl, setSnapUrl] = useState<string | undefined>(() => getSnapshot(snapKey));
  // A boot-queue grant for the capture-warming path (zoomed out, no snapshot).
  const [bootGranted, setBootGranted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // A capture taken against the code that renders this screen right now. The
  // whole boot policy hangs off it: fresh means don't boot, stale means the
  // screen changed and the picture has to be retaken.
  const fresh = isFresh(snapKey, version);
  const wantLive = live && (interactive || !!forceLive || (preferLive && !fresh));

  // The slides stage never rewrites a mounted iframe's src. When the board
  // follows a navigation made *inside* the frame (onNavigate → new selected
  // screen → new src prop), the frame is already showing the destination —
  // resetting src would reload the app and destroy the state the reviewer just
  // walked into. Fresh selections remount through the stage's key instead.
  const pinnedSrc = useRef<string | null>(null);
  if (!mounted) pinnedSrc.current = null;
  else pinnedSrc.current ??= liveSrc;
  const frameSrc = interactive && pinnedSrc.current ? pinnedSrc.current : liveSrc;

  // Which capture applies (viewport, seed, route version) and whether it's
  // already in memory. A persisted one is read off disk here — the frame paints
  // it without ever mounting the app.
  useEffect(() => {
    if (!isFresh(snapKey, version)) {
      // Stale means the screen's code moved: showing the old picture would be
      // showing a design that no longer exists.
      setSnapUrl(undefined);
      return;
    }
    const mem = getSnapshot(snapKey);
    if (mem) {
      setSnapUrl(mem);
      return;
    }
    let on = true;
    void hydrateSnapshot(snapKey, version).then((url) => {
      if (on) setSnapUrl(url);
    });
    return () => {
      on = false;
    };
  }, [snapKey, version, epoch]);

  useEffect(() => {
    if (!live || available !== null) return;
    let on = true;
    probeApp(src).then((ok) => on && setAvailable(ok));
    return () => {
      on = false;
    };
  }, [live, available, src]);

  // Every non-interactive boot — real live paint (preferLive, panned into
  // view) or invisible capture-warming — shares the one bounded queue.
  // preferLive used to mount straight through, unbounded: panning past
  // LIVE_SCALE means several screens enter view in the same tick, and each
  // is a full app boot, so scrolling turned into a concurrent boot storm.
  // The slides stage (interactive) is the one screen the reviewer is looking
  // at right now, not a wave of newly-visible screens, so it stays instant.
  useEffect(() => {
    if (interactive || !live) return;
    // Nothing boots until the disk index has been read: a frame that boots
    // first and asks later is the storm this cache replaces.
    if (!inited) return;
    if (!wantLive && (fresh || available === false)) return;
    const slot = acquireBootSlot();
    let on = true;
    void slot.granted.then(() => on && setBootGranted(true));
    return () => {
      on = false;
      slot.release();
      setBootGranted(false);
    };
  }, [interactive, wantLive, live, inited, fresh, available, snapKey]);

  useEffect(() => {
    if (!((interactive && wantLive) || bootGranted) || !available) {
      setMounted(false);
      setReady(false);
      return;
    }
    setMounted(true);
  }, [interactive, wantLive, bootGranted, available, liveSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Live badge tells the reviewer they're seeing the real page — never
  // shown for an invisible capture-only boot.
  useEffect(() => {
    onLiveChange?.(ready && wantLive);
  }, [ready, wantLive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Publish the booted frame for the exporter. Only a page the reviewer is
  // actually looking at counts: a capture-only boot is invisible and mid-flight.
  useEffect(() => {
    if (!captureApi) return;
    captureApi.current = ready && wantLive ? iframeRef.current : null;
    return () => {
      captureApi.current = null;
    };
  }, [captureApi, ready, wantLive]);

  // Once the page is ready, rasterize it into the session cache (the frame
  // captures itself — see src/review-capture.ts). Runs in the live path too,
  // so zooming out later is instant. The delay lets fonts, images, and the
  // page's own entrance animations finish, so the capture isn't a half-played
  // reveal — cheap to wait out, since capture-only boots render invisibly.
  useEffect(() => {
    if (!ready) return;
    if (isFresh(snapKey, version)) return;
    const el = iframeRef.current;
    if (!el) return;
    let on = true;
    const t = window.setTimeout(() => {
      void captureFrame(el, snapKey, version).then((url) => {
        if (on && url) setSnapUrl(url);
      });
    }, 900);
    return () => {
      on = false;
      window.clearTimeout(t);
    };
  }, [ready, snapKey, version]);

  // Scroll math bridges two spaces: the page scrolls in viewport CSS px, pins
  // live in frame units. k converts between them.
  const k = frameW / viewport.w;

  const onLoad = () => {
    const win = iframeRef.current?.contentWindow;
    // Same-origin via the proxy; guard anyway (target could be cross-origin).
    try {
      if (win && scrollApi) {
        scrollApi.current = {
          get: () => win.scrollY * k,
          to: (y, smooth) => win.scrollTo({ top: y / k, behavior: smooth ? "smooth" : "auto" }),
        };
      }
      if (win && onScrollChange) {
        win.addEventListener("scroll", () => onScrollChange(win.scrollY * k), { passive: true });
      }
    } catch {
      /* cross-origin target: live view still works, scroll-aware pins don't */
    }
    // Double-rAF lets the app paint its first frame before the crossfade, so
    // the swap is snapshot → rendered page, never snapshot → white. rAF never
    // runs on hidden pages (background tab, headless review), so those swap
    // immediately — nobody is watching the fade — with a timeout backstop for
    // visibility flips mid-flight.
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setReady(true);
    };
    if (document.visibilityState === "hidden") finish();
    else {
      requestAnimationFrame(() => requestAnimationFrame(finish));
      window.setTimeout(finish, 500);
    }
  };

  // Readiness detection. React's synthetic onLoad is unreliable on iframes
  // and the native load event can slip past the attach (fast localhost loads,
  // HMR remounts), so belt and suspenders: listen for load AND poll
  // readyState until the real document is in.
  useEffect(() => {
    if (!mounted) return;
    const el = iframeRef.current;
    if (!el) return;
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      onLoad();
    };
    el.addEventListener("load", fire);
    const poll = window.setInterval(() => {
      try {
        if (el.contentDocument?.readyState === "complete" && el.contentWindow?.location.href !== "about:blank") {
          window.clearInterval(poll);
          fire();
        }
      } catch {
        window.clearInterval(poll); // cross-origin target: the load event has this
      }
    }, 120);
    return () => {
      el.removeEventListener("load", fire);
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // In-frame navigation bridge (slides stage only). The app inside the frame
  // is a same-origin SPA, so its route changes are pushState calls that fire
  // no event the host can hear. Wrap the content window's history methods and
  // listen for popstate, reporting path+search so the board can follow the
  // walk. Installs once per document — a full-document load replaces the
  // global object (wrappers and marker die with it), so re-install on `load`.
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  useEffect(() => {
    if (!interactive || !mounted) return;
    const el = iframeRef.current;
    if (!el) return;
    const install = () => {
      try {
        const win = el.contentWindow as (Window & { __rvNavHooked?: boolean }) | null;
        if (!win || win.__rvNavHooked) return;
        win.__rvNavHooked = true;
        const emit = () => onNavigateRef.current?.(win.location.pathname + win.location.search);
        for (const m of ["pushState", "replaceState"] as const) {
          const orig = win.history[m].bind(win.history);
          win.history[m] = ((...args: Parameters<History["pushState"]>) => {
            orig(...args);
            emit();
          }) as History["pushState"];
        }
        win.addEventListener("popstate", emit);
      } catch {
        /* cross-origin target: live view still works, the board just can't follow */
      }
    };
    try {
      // Fast localhost loads can complete before this effect attaches.
      if (el.contentDocument?.readyState === "complete") install();
    } catch {
      /* cross-origin */
    }
    el.addEventListener("load", install);
    return () => el.removeEventListener("load", install);
  }, [interactive, mounted]);

  // A capture-only boot (zoomed out, warming the cache) renders INVISIBLY —
  // the reviewer sees skeleton → snapshot, never the page playing its
  // entrance animations on its way to being rasterized (the reviewer, 2026-07-21).
  const captureOnly = mounted && !wantLive;
  const cls = [
    "rv-frame-live",
    ready && wantLive && "is-live",
    !interactive && "is-inert",
    mounted && !ready && !snapUrl && "is-mounting",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      {mounted ? (
        <iframe
          ref={iframeRef}
          src={frameSrc}
          title={title}
          style={{
            width: viewport.w,
            // Rendered height must fill the frame body: cssHeight × k = 100%.
            height: `calc(100% / ${k})`,
            transform: `scale(${k})`,
            transformOrigin: "top left",
            ...(captureOnly ? { opacity: 0 } : null),
          }}
        />
      ) : null}
      {/* Under the page, always: it fades out once the real thing is in, and
          stays put if the app can't be reached. */}
      <div className="rv-frame-placeholder has-skeleton is-layer">
        <div className="rv-lowfi-skeleton" aria-hidden />
        {/* No name here: the title bar above already says it. Only trouble
            speaks; a page on its way in is just the gray pulse. */}
        {available === false ? (
          <div>
            <p className="rv-hint-line">Live page unreachable. Start the app&rsquo;s dev server.</p>
          </div>
        ) : null}
      </div>
      {/* The session capture: exact pixels of this page's own last render.
          Covers the skeleton whenever it exists; fades away under the live
          page the moment one is ready. */}
      {snapUrl ? <img className="rv-snap" src={snapUrl} alt="" draggable={false} /> : null}
    </div>
  );
}

export function ScreenFrame({
  screen,
  index,
  total,
  w,
  h,
  status,
  live,
  preferLive = true,
  interactive = false,
  liveViewport,
  scrollApi,
  captureApi,
  onScrollChange,
  onNavigate,
}: {
  screen: Screen;
  /** Position within the flow, for the header count. */
  index: number;
  total: number;
  w: number;
  h: number;
  status: ReviewStatus | undefined;
  /** Whether to mount live content (in view, any zoom). Images always render. */
  live: boolean;
  /** False on the zoomed-out canvas: cached self-captures stand in for live
   *  iframes (see snapshot-cache.ts). Slides/interactive stages stay live. */
  preferLive?: boolean;
  /** Slides stage: pointer events reach the live page, tall images scroll. */
  interactive?: boolean;
  /** Layout viewport for live url frames (defaults to desktop 1440×900). */
  liveViewport?: { w: number; h: number };
  scrollApi?: MutableRefObject<FrameScrollApi | null>;
  /** Handle on this frame's booted iframe, for a WYSIWYG PNG export. */
  captureApi?: MutableRefObject<HTMLIFrameElement | null>;
  onScrollChange?: (top: number) => void;
  /** Interactive url frames: reports in-frame SPA navigations (path+search). */
  onNavigate?: (url: string) => void;
}) {
  const [liveOn, setLiveOn] = useState(false);
  // Per-frame opt-in to the live page. Cleared on zoom-out so panning back in
  // doesn't leave a trail of booted apps behind the reviewer.
  const [goLive, setGoLive] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!preferLive) setGoLive(false);
  }, [preferLive]);

  // Image frames scroll inside .rv-frame-body (slides only); expose the same
  // scroll API live frames get so pin math never cares about the source kind.
  useEffect(() => {
    if (!interactive || !scrollApi || screen.source.kind === "url") return;
    const el = bodyRef.current;
    if (!el) return;
    scrollApi.current = {
      get: () => el.scrollTop,
      to: (y, smooth) => el.scrollTo({ top: y, behavior: smooth ? "smooth" : "auto" }),
    };
  }, [interactive, scrollApi, screen.source.kind]);

  const cls = status ? `rv-screen-frame is-status ${statusClass(status)}` : "rv-screen-frame";
  return (
    <div className={cls} style={{ width: w, height: h }}>
      <div className="rv-frame-head">
        {/* The bar truncates; the tooltip is the whole name. */}
        <span className="rv-title" title={screen.title}>
          {screen.title}
        </span>
        {/* Straight out to the real page, no board chrome around it — the frame
            already knows the route AND the mid-flow seed, so it opens on the
            state you were looking at rather than at step one. New tab: the
            board is a place you were in the middle of. */}
        {screen.source.kind === "url" ? (
          <a
            href={seededSrc(screen.source.src, screen.source.seed)}
            target="_blank"
            rel="noreferrer"
            className="rv-frame-open"
            title={`Open ${screen.title} in the app (new tab)`}
            aria-label={`Open ${screen.title} in the app, new tab`}
            // The canvas pans on pointerdown; without this, reaching for the
            // link drags the board out from under it.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <OpenExternal size={13} />
          </a>
        ) : null}
        {liveOn ? (
          <span className="rv-live-badge" title="Rendering the real page from the app's dev server">
            <span className="rv-live-dot" aria-hidden />
            Live
          </span>
        ) : screen.source.kind === "url" && !interactive && preferLive ? (
          // Zoomed in on a cached frame: the picture is current, so the app
          // isn't running behind it. One press if you want to poke at it.
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setGoLive(true)}
            className="rv-live-badge is-action"
            title="Boot the real page in this frame"
          >
            {goLive ? "Starting…" : "Go live"}
          </button>
        ) : null}
        <span className="rv-n">
          {index + 1}/{total}
        </span>
      </div>
      <div
        ref={bodyRef}
        className="rv-frame-body"
        onScroll={
          interactive && screen.source.kind !== "url"
            ? (e) => onScrollChange?.((e.target as HTMLElement).scrollTop)
            : undefined
        }
      >
        {screen.source.kind === "image" ? (
          <img src={assetUrl(screen.source.src)} alt={screen.title} draggable={false} />
        ) : screen.source.kind === "url" ? (
          <LiveScreen
            src={screen.source.src}
            seed={screen.source.seed}
            title={screen.title}
            live={live}
            preferLive={preferLive}
            forceLive={goLive}
            interactive={interactive}
            frameW={w}
            viewport={screen.device === "phone" ? LIVE_VIEWPORTS.mobile : (liveViewport ?? LIVE_VIEWPORTS.desktop)}
            scrollApi={scrollApi}
            captureApi={captureApi}
            onScrollChange={onScrollChange}
            onLiveChange={setLiveOn}
            onNavigate={onNavigate}
          />
        ) : live ? (
          <div className="rv-screen-el">{screen.source.render()}</div>
        ) : (
          <div className="rv-frame-placeholder has-skeleton">
            <div className="rv-lowfi-skeleton" aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}

/** Invisible background warmer: boots every url screen that has no CURRENT
 *  capture — across ALL board pages, not just the mounted one — through the
 *  same bounded queue, photographs each, and tears it down. Page switches then
 *  paint bitmaps immediately instead of re-running the boot sweep (the reviewer,
 *  2026-07-21: captures only existed for the open board).
 *
 *  Two things keep it quiet now that captures persist: it waits for the disk
 *  index before deciding what's missing (otherwise it would re-shoot a board it
 *  already has), and screens on OTHER pages wait a second beat, so the page
 *  actually on screen owns the first queue slots. On a warm cache it renders
 *  nothing at all. */
export function SnapshotWarmer({
  shots,
  delayMs = 1500,
  deferMs = 4000,
}: {
  /** `defer` marks a screen that isn't on the open board page. */
  shots: { src: string; seed?: ScreenSeed; viewport: { w: number; h: number }; defer?: boolean }[];
  delayMs?: number;
  deferMs?: number;
}) {
  const epoch = useSyncExternalStore(subscribeSnapshots, snapshotEpoch);
  const [stage, setStage] = useState(0);
  useEffect(() => {
    let on = true;
    let deferTimer = 0;
    const t = window.setTimeout(() => {
      void snapshotsReady().then(() => {
        if (!on) return;
        setStage(1);
        deferTimer = window.setTimeout(() => on && setStage(2), deferMs);
      });
    }, delayMs);
    return () => {
      on = false;
      window.clearTimeout(t);
      window.clearTimeout(deferTimer);
    };
  }, [delayMs, deferMs]);
  if (!stage) return null;
  const seen = new Set<string>();
  return (
    <div aria-hidden style={{ position: "fixed", left: -20000, top: 0, pointerEvents: "none" }}>
      {shots.map((s) => {
        if (s.defer && stage < 2) return null;
        const liveSrc = seededSrc(s.src, s.seed);
        const key = snapshotKey(liveSrc, s.viewport.w);
        const version = versionFor(liveSrc);
        if (seen.has(key) || isFresh(key, version)) return null;
        seen.add(key);
        return (
          <WarmBoot key={`${key}#${epoch}`} liveSrc={liveSrc} snapKey={key} version={version} viewport={s.viewport} />
        );
      })}
    </div>
  );
}

function WarmBoot({
  liveSrc,
  snapKey: cacheKey,
  version,
  viewport,
}: {
  liveSrc: string;
  snapKey: string;
  version: string | null;
  viewport: { w: number; h: number };
}) {
  const [granted, setGranted] = useState(false);
  const [done, setDone] = useState(false);
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (done) return;
    const slot = acquireBootSlot();
    let on = true;
    let bail = 0;
    void slot.granted.then(() => {
      if (!on) return;
      setGranted(true);
      // Backstop: a page that never loads gives its slot back; the screen's own
      // frame retries whenever the reviewer actually visits it. The clock
      // starts when the boot does — started at mount, a screen still WAITING
      // behind 12 others timed itself out before its turn came, which is why a
      // sweep of ~140 screens only ever finished the first half.
      bail = window.setTimeout(() => on && setDone(true), 20000);
    });
    return () => {
      on = false;
      window.clearTimeout(bail);
      slot.release();
    };
  }, [done]);

  if (done || !granted) return null;
  return (
    <iframe
      ref={ref}
      src={liveSrc}
      title="Snapshot warmer"
      onLoad={() => {
        // Same settle delay as visible frames: let entrance animations finish
        // so the capture isn't a half-played reveal.
        window.setTimeout(() => {
          const el = ref.current;
          if (!el) {
            setDone(true);
            return;
          }
          void captureFrame(el, cacheKey, version).then(() => setDone(true));
        }, 900);
      }}
      style={{ width: viewport.w, height: viewport.h, border: 0 }}
    />
  );
}

/** Per-screen sign-off control. Explicit buttons (not a mystery cycle) so a
 *  reviewer can see and set the state at a glance; clicking the active one
 *  clears it back to unreviewed. */
const REVIEW_OPTIONS: { status: ReviewStatus; label: string }[] = [
  { status: "good", label: "Sign off" },
  { status: "needs", label: "Needs work" },
];

export function ScreenReviewBar({
  status,
  entry,
  onSet,
}: {
  status: ReviewStatus | undefined;
  /** Full entry for the active status, so its tooltip can say who set it. */
  entry?: ReviewEntry;
  onSet: (status: ReviewStatus | undefined) => void;
}) {
  if (!SHOW_REVIEW_STATUS) return null;
  return (
    <div onPointerDown={(e) => e.stopPropagation()} className="rv-review-bar" role="group" aria-label="Mark this screen">
      {REVIEW_OPTIONS.map((opt) => {
        const active = status === opt.status;
        // Always statusClass'd: the dot previews the color the button would
        // apply, and hover pulls the border toward it (is-action grammar).
        const attribution = active ? statusAttribution(entry) : null;
        return (
          <button
            key={opt.status}
            type="button"
            onClick={() => onSet(active ? undefined : opt.status)}
            aria-pressed={active}
            className={`rv-pill is-action ${statusClass(opt.status)}${active ? " is-on" : ""}`}
            title={
              active
                ? `${attribution ?? STATUS_LABEL[opt.status]} · click to clear`
                : `Set ${STATUS_LABEL[opt.status]}`
            }
          >
            <span className={`rv-dot ${statusClass(opt.status)}`} aria-hidden />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
