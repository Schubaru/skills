// Dev mode — the panel.
//
// Wears the review board's design language, not a browser devtools one (the reviewer,
// 2026-08-13: "less browser dev mode, more a design tool dev mode"). In board mode it
// renders INSIDE `.rv-root` and inherits the board's tokens outright, dark
// theme included; on a bare product route it defines the same tokens itself.
// Either way it is one stylesheet and one component.
//
// The thing it inspects is a DevTarget, never the ambient document — from the
// board, every fact must describe the app inside a frame rather than the
// canvas around it (see target.ts).
//
// Four tabs (see TABS below for what each is for and what was cut), plus the
// measure layer, which answers the question no tab can: how far is this from
// that.

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatBytes, scanAssets, scanIcons, type AssetRow, type IconRow } from "./assets";
import { exportBundle, standaloneHtml } from "./export";
import { boxOf, colorsOf, fiberOf, hostNodeOf, iconOf, nearestComposite, ownerChain, typographyOf } from "./inspect";
import { classesIn, cssForClasses, elementHtml, elementJsx, rootVarsFor } from "./markup";
import { measureBetween, measurePadding, rulerTicks, type Segment } from "./measure";
import { frameAtPoint, frameScale, frameTarget, isStale, pageTarget, styleOf, toFramePoint, toScreenRect, visibleRect, type DevTarget } from "./target";
import { tokenLabel, tokensUsedIn, type Token } from "./tokens";
import { makeZip, saveBlob, slugify, type ZipEntry } from "../review/zip";
import "./dev.css";

type Tab = "inspect" | "markup" | "assets" | "export";

/** Four, down from six (the reviewer, 2026-08-13: "it's a bit overwhelming"). Each one
 *  is a thing a developer DOES, rather than a thing we can report:
 *    Inspect    what is this
 *    Code       give me it
 *    Resources  what is this screen made of — tokens, icons, files
 *    Export     take it away, at this exact state
 *  What went: the 289-row full token table (it ships in tokens.json and nobody
 *  reads it in a 400px panel), the class-name chips (a Tailwind class is
 *  meaningless to the off-stack developer this is for — the CSS tab has the
 *  rules), session storage (harness internals), and a Copy block that repeated
 *  the Code tab's own button. */
const TABS: { id: Tab; label: string }[] = [
  { id: "inspect", label: "Inspect" },
  { id: "markup", label: "Code" },
  { id: "assets", label: "Resources" },
  { id: "export", label: "Export" },
];

const WIDTH_KEY = "rvdev:width";
const TAB_KEY = "rvdev:tab";

export type DevPanelProps = {
  /** `page` — dev mode on a product route, inspecting the page it runs in.
   *  `board` — dev mode on the review canvas, inspecting a frame's contents. */
  mode: "page" | "board";
  onClose: () => void;
  /** Select what sits at this point on open, and again whenever it changes
   *  (the board's right-click → Inspect). `n` makes a repeat on the same spot
   *  count. */
  inspectAt?: { x: number; y: number; n: number } | null;
};

export function DevPanel({ mode, onClose, inspectAt }: DevPanelProps) {
  // Validated, not just cast: the tab set has changed once already, and a
  // remembered id that no longer exists renders an empty panel with no tab
  // selected — which reads as broken rather than as stale.
  const [tab, setTab] = useState<Tab>(() => {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.some((t) => t.id === saved) ? (saved as Tab) : "inspect";
  });
  const [width, setWidth] = useState(() => Number(localStorage.getItem(WIDTH_KEY)) || 400);
  const [picking, setPicking] = useState(true);
  const [showMeasure, setShowMeasure] = useState(true);
  /** A frame we asked to boot. Only a label — the frame reports itself ready
   *  by simply becoming pickable. */
  const [booting, setBooting] = useState(false);
  const [hover, setHover] = useState<{ t: DevTarget; el: Element } | null>(null);
  const [sel, setSel] = useState<{ t: DevTarget; el: Element } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => localStorage.setItem(TAB_KEY, tab), [tab]);
  useEffect(() => localStorage.setItem(WIDTH_KEY, String(width)), [width]);

  // On a product route the panel is a fixed overlay that would otherwise sit
  // ON the screen it inspects, so the page gives up its width instead — and
  // responsive layouts then reflow honestly into what's left. The board needs
  // none of that: its canvas is already a viewport you pan.
  useEffect(() => {
    if (mode !== "page") return;
    document.documentElement.style.setProperty("--rvdev-inset", `${width}px`);
    document.documentElement.classList.add("rvdev-on");
    return () => {
      document.documentElement.classList.remove("rvdev-on");
      document.documentElement.style.removeProperty("--rvdev-inset");
    };
  }, [width, mode]);

  // The board's toolbar is centred over the full width and would sit under
  // the panel. Same shift the sidebar already does, from the other side.
  useEffect(() => {
    if (mode !== "board") return;
    const dock = document.querySelector(".rv-toolbar-dock");
    const board = document.querySelector(".rv-root");
    dock?.classList.add("is-dev-shifted");
    board?.classList.add("is-dev");
    document.documentElement.style.setProperty("--rvdev-inset", `${width}px`);
    return () => {
      dock?.classList.remove("is-dev-shifted");
      board?.classList.remove("is-dev");
      document.documentElement.style.removeProperty("--rvdev-inset");
    };
  }, [width, mode]);

  /** Resolves a screen point to the element under it, in whichever document
   *  owns it. One implementation for both modes: an iframe is opaque to
   *  `elementsFromPoint`, so hitting one means stepping into its document and
   *  asking again in its own coordinates. */
  const pickAt = useCallback(
    (clientX: number, clientY: number): { t: DevTarget; el: Element } | null => {
      // Frames first, and by geometry — see target.ts on why hit-testing
      // can't find them.
      const frame = frameAtPoint(document, clientX, clientY, rootRef.current);
      if (frame) {
        const t = frameTarget(frame);
        if (!t) return null;
        const p = toFramePoint(frame, clientX, clientY);
        const el = t.doc.elementFromPoint(p.x, p.y);
        return el ? { t, el } : null;
      }
      // Board chrome is not the thing under review — say nothing rather than
      // describe the canvas the reviewer is standing on.
      if (mode === "board") return null;
      const top = document.elementsFromPoint(clientX, clientY).find((e) => !rootRef.current?.contains(e));
      return top ? { t: pageTarget(), el: top } : null;
    },
    [mode],
  );

  /** Which frame owns a document, for events that arrive from inside one. */
  const frameOwning = useCallback((doc: Document): HTMLIFrameElement | null => {
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      try {
        if (frame.contentDocument === doc) return frame;
      } catch {
        /* cross-origin */
      }
    }
    return null;
  }, []);

  /** Most board frames are a cached bitmap, not a running app — that's what
   *  keeps the canvas fast (snapshot-cache.ts). There is nothing to inspect in
   *  a picture, so pointing at one in dev mode presses its own "Go live"
   *  button and the app boots underneath. Pressing the board's real control,
   *  rather than reaching into the frame's state, keeps one path to live. */
  const bootIfSnapshot = useCallback((clientX: number, clientY: number): boolean => {
    const hit = document.elementsFromPoint(clientX, clientY).find((e) => e.classList.contains("rv-snap"));
    const goLive = hit?.closest(".rv-screen-frame")?.querySelector<HTMLButtonElement>(".rv-live-badge.is-action");
    if (!goLive) return false;
    goLive.click();
    return true;
  }, []);

  // --- picking ---------------------------------------------------------------
  //
  // ⚠ NO event-swallowing overlay. The first build put a full-screen catcher
  // over everything while picking, which meant the board's canvas never saw a
  // wheel or a pointerdown: ⌘-scroll fell through to the BROWSER's page zoom
  // and panning stopped working entirely. So nothing is intercepted globally.
  // Instead we listen, in the capture phase, on each document that can own an
  // element — the host, plus every same-origin frame — and block only the one
  // event that would otherwise activate the app: a click that didn't move.
  //
  // Everything else (wheel, drag, pinch) reaches the board untouched, which is
  // why zoom and pan behave normally with dev mode open.
  useEffect(() => {
    if (!picking) return;
    const down = { x: 0, y: 0 };
    const attached = new Map<Document, () => void>();

    /** The element an event points at. Inside a frame the event's own target
     *  IS the answer and needs no geometry; on the host we hit-test, because
     *  over a canvas frame the target is board chrome (target.ts). */
    const resolve = (e: MouseEvent, doc: Document): { t: DevTarget; el: Element } | null => {
      if (doc !== document) {
        const frame = frameOwning(doc);
        const t = frame ? frameTarget(frame) : pageTarget();
        const el = e.target as Element | null;
        return t && el && el.nodeType === 1 ? { t, el } : null;
      }
      return pickAt(e.clientX, e.clientY);
    };

    const inPanel = (e: Event) => e.target instanceof Node && !!rootRef.current?.contains(e.target);

    const onMove = (e: MouseEvent, doc: Document) => {
      // Over our own panel there is nothing to pick, and highlighting whatever
      // happens to be behind it would be a lie about where the cursor is.
      if (inPanel(e)) return setHover(null);
      const hit = resolve(e, doc);
      setHover(hit);
      if (hit) setBooting(false);
    };

    const onDown = (e: MouseEvent) => {
      down.x = e.clientX;
      down.y = e.clientY;
    };

    const onClick = (e: MouseEvent, doc: Document) => {
      if (inPanel(e)) return;
      // A drag is a pan, not a pick. Without this, panning the canvas from
      // over a frame would select whatever the gesture happened to end on.
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const hit = resolve(e, doc);
      if (!hit) {
        // A cached frame is a picture; press its own "Go live" and stay in
        // picking mode so the next click lands on the real thing.
        if (doc === document && bootIfSnapshot(e.clientX, e.clientY)) setBooting(true);
        return;
      }
      // Only now do we swallow it — picking a button must not press it.
      e.preventDefault();
      e.stopPropagation();
      setSel(hit);
      setBooting(false);
      // Picking STAYS ON. Selecting used to switch it off, which meant every
      // second element cost a trip to the toolbar (the reviewer: "it seems to be stuck
      // until I unstick it"). Esc or the Pick button ends it.
    };

    const attach = (doc: Document) => {
      if (attached.has(doc)) return;
      const move = (e: Event) => onMove(e as MouseEvent, doc);
      const click = (e: Event) => onClick(e as MouseEvent, doc);
      doc.addEventListener("mousemove", move, true);
      doc.addEventListener("pointerdown", onDown as EventListener, true);
      doc.addEventListener("click", click, true);
      // Inline, not a class: a framed document has none of our stylesheets,
      // and the cursor is how picking announces itself in there too.
      const cursor = doc.documentElement.style.cursor;
      doc.documentElement.style.cursor = "crosshair";
      attached.set(doc, () => {
        doc.removeEventListener("mousemove", move, true);
        doc.removeEventListener("pointerdown", onDown as EventListener, true);
        doc.removeEventListener("click", click, true);
        doc.documentElement.style.cursor = cursor;
      });
    };

    /** The host plus every same-origin frame. A click inside an interactive
     *  frame (the slides stage) never reaches the parent, so listening only on
     *  the host would make picking silently dead there. */
    const sweep = () => {
      attach(document);
      for (const frame of Array.from(document.querySelectorAll("iframe"))) {
        if (rootRef.current?.contains(frame)) continue;
        try {
          const doc = frame.contentDocument;
          if (doc?.body) attach(doc);
        } catch {
          /* cross-origin — nothing to listen to */
        }
      }
    };
    sweep();
    // Frames boot, remount and get virtualized away while picking is on; a
    // one-shot attach would miss every frame that arrived after.
    const id = window.setInterval(sweep, 400);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPicking(false);
        setBooting(false);
        setHover(null);
      }
    };
    window.addEventListener("keydown", onKey, true);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("keydown", onKey, true);
      for (const detach of attached.values()) detach();
    };
  }, [picking, pickAt, bootIfSnapshot, frameOwning]);

  // Right-click → Inspect: select what was under the pointer, as a pick would
  // (a cached frame boots first; the next pick lands on the real thing). A
  // layout effect: opening shifts the board aside (the effect above), so the
  // point is only true before that runs.
  useLayoutEffect(() => {
    if (!inspectAt) return;
    setTab("inspect");
    const hit = pickAt(inspectAt.x, inspectAt.y);
    if (hit) setSel(hit);
    else if (bootIfSnapshot(inspectAt.x, inspectAt.y)) setBooting(true);
  }, [inspectAt, pickAt, bootIfSnapshot]);

  // Focus follows the selection: arrow-key traversal should work on the press
  // that selected, not after a second click into the panel.
  useEffect(() => {
    if (sel) panelRef.current?.focus({ preventScroll: true });
  }, [sel]);

  // A frame can remount under us (the board virtualizes, the app navigates).
  // Holding a detached element would freeze the panel on a screen that is no
  // longer there, so the selection is dropped the moment it goes stale.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (sel && isStale(sel.t, sel.el)) setSel(null);
    }, 500);
    return () => window.clearInterval(id);
  }, [sel]);

  const target = sel?.t ?? hover?.t ?? (mode === "page" ? pageTarget() : null);
  const el = sel?.el ?? (target && mode === "page" ? appRoot(target.doc) : null);
  const scopeLabel = sel ? describe(sel.el) : mode === "page" ? "Whole screen" : "Nothing picked";

  const [resizing, setResizing] = useState(false);
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e: MouseEvent) =>
      setWidth(Math.min(Math.max(window.innerWidth - e.clientX, 320), Math.min(880, window.innerWidth - 200)));
    const onUp = () => setResizing(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizing]);

  return (
    <div className="rvdev-root" ref={rootRef} data-rvdev="">
      <MeasureLayer sel={sel} hover={hover} on={showMeasure} />

      <aside
        ref={panelRef}
        className={`rvdev-panel${resizing ? " is-resizing" : ""}`}
        style={{ width }}
        aria-label="Dev mode"
        tabIndex={-1}
        // Arrow keys walk the tree, the way they do in devtools. Bound to the
        // PANEL rather than the window, and stopped here, so they can never
        // reach the board — where the same keys step through slides.
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          if (e.target instanceof HTMLInputElement) return;
          if (!sel) return;
          const next =
            e.key === "ArrowUp"
              ? sel.el.parentElement
              : Array.from(sel.el.children).find((c) => c.nodeType === 1) ?? null;
          if (!next) return;
          e.preventDefault();
          e.stopPropagation();
          setSel({ t: sel.t, el: next });
        }}
      >
        <div className="rvdev-grip" onMouseDown={() => setResizing(true)} />

        <header className="rvdev-head">
          <span className="rvdev-brand">Dev mode</span>
          <button
            type="button"
            className={picking ? "rvdev-btn is-on" : "rvdev-btn"}
            onClick={() =>
              setPicking((p) => {
                if (p) setBooting(false);
                return !p;
              })
            }
            title={picking ? "Stop picking (Esc)" : "Pick an element"}
            aria-pressed={picking}
          >
            <Crosshair />
          </button>
          <button
            type="button"
            className={showMeasure ? "rvdev-btn is-on" : "rvdev-btn"}
            onClick={() => setShowMeasure((m) => !m)}
            title="Rulers and distances"
            aria-pressed={showMeasure}
          >
            <Ruler />
          </button>
          <button type="button" className="rvdev-btn" onClick={onClose} title="Close dev mode (⌘⇧D)" aria-label="Close dev mode">
            <CloseGlyph />
          </button>
        </header>

        {/* The picked element gets a surface of its own: it is what the whole
            panel is about, and the selector is the handle a developer carries
            to their own devtools, or into a bug report. */}
        <div className="rvdev-target">
          <span className={sel ? "rvdev-target-name" : "rvdev-target-name is-empty"} title={scopeLabel}>
            {scopeLabel}
          </span>
          {sel && (
            <>
              <CopyGhost text={selectorFor(sel.el)} label="selector" title="Copy a CSS selector for this element" />
              <button type="button" className="rvdev-ghost" onClick={() => setSel(null)} title="Inspect the whole screen again">
                clear
              </button>
            </>
          )}
        </div>

        <nav className="rvdev-tabs">
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? "rvdev-tab is-on" : "rvdev-tab"} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        <div className="rvdev-body">
          {!target || !el ? (
            <p className="rvdev-blank">
              <Crosshair />
              {/* Three different empty states, because they need three
                  different next actions — and a panel that says "starting…"
                  when nothing is starting is the kind of thing that teaches
                  people not to read it. */}
              {!picking
                ? "Nothing selected."
                : booting
                  ? "Starting that screen…"
                  : "Pick an element inside a screen to inspect it."}
              <small>
                {!picking ? (
                  <button type="button" className="rvdev-ghost" onClick={() => setPicking(true)}>
                    Turn on Pick
                  </button>
                ) : booting ? (
                  "The board was showing a cached picture of it. One moment, then click again."
                ) : mode === "board" ? (
                  "Click any screen. Cached previews boot into the real page on the first click."
                ) : (
                  "Esc stops picking."
                )}
              </small>
            </p>
          ) : (
            <>
              {tab === "inspect" && <InspectTab t={target} el={el} onSelect={(next) => setSel({ t: target, el: next })} />}
              {tab === "markup" && <MarkupTab t={target} el={el} />}
              {tab === "assets" && <ResourcesTab el={resourceRoot(el)} />}
              {tab === "export" && <ExportTab t={target} el={resourceRoot(el)} label={scopeLabel} />}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/** What Resources and the exports read: the COMPONENT the header names, not the
 *  raw element the click landed on (the reviewer, 2026-08-19: "it needs to show all the
 *  resources below that part in the tree"). A card is typically full-bleed art,
 *  a scrim, then a full-height text layer — the click lands on the text layer,
 *  and the photo is its SIBLING, so the clicked element's own subtree misses
 *  the very image the card is made of (a reviewer hit exactly this on CareCard).
 *  The owning component's host node is "that part in the tree"; everything
 *  below it counts. Inspect stays on the precise element — its layout and type
 *  numbers are about the click. Falls back to the element itself when there's
 *  no owner, or when the owner renders a fragment whose first host node
 *  doesn't actually contain the selection. */
function resourceRoot(el: Element): Element {
  const owner = nearestComposite(el);
  const host = owner ? hostNodeOf(owner.fiber) : null;
  return host && host.contains(el) ? host : el;
}

// --- highlight + measurements ------------------------------------------------

/** Rects are polled rather than observed: inside the board the element hasn't
 *  moved at all — the CANVAS has, by a transform on an ancestor of the frame,
 *  which no ResizeObserver or scroll event on the element will ever report.
 *  One rAF with change detection covers pans, zooms, scrolls and reflows with
 *  one mechanism and no re-render when nothing moved. */
function useRects(pair: { t: DevTarget; el: Element } | null): { rect: DOMRect; scale: number; clip: DOMRect | null } | null {
  const [state, setState] = useState<{ rect: DOMRect; scale: number; clip: DOMRect | null } | null>(null);
  const last = useRef("");

  useEffect(() => {
    if (!pair) {
      last.current = "";
      setState(null);
      return;
    }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (isStale(pair.t, pair.el)) return;
      const rect = toScreenRect(pair.t, pair.el);
      const scale = pair.t.frame ? frameScale(pair.t.frame) : 1;
      // A framed element is only visible through its frame's window; the rest
      // of it is scrolled or clipped away, and an outline drawn across the
      // board's toolbar describes nothing.
      const clip = pair.t.frame ? visibleRect(pair.t.frame) : null;
      const key = `${rect.left}|${rect.top}|${rect.width}|${rect.height}|${scale}|${clip?.top}|${clip?.height}`;
      if (key === last.current) return;
      last.current = key;
      setState({ rect, scale, clip });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pair]);

  return state;
}

function MeasureLayer({
  sel,
  hover,
  on,
}: {
  sel: { t: DevTarget; el: Element } | null;
  hover: { t: DevTarget; el: Element } | null;
  on: boolean;
}) {
  const selBox = useRects(sel);
  const hoverBox = useRects(hover);

  const segments = useMemo<Segment[]>(() => {
    if (!on) return [];
    if (selBox && hoverBox && sel && hover && sel.el !== hover.el) {
      return measureBetween(selBox.rect, hoverBox.rect, selBox.scale);
    }
    // Nothing to compare against: read the selection's own padding, which is
    // the measurement you want on a single box.
    if (selBox && sel) {
      const cs = styleOf(sel.el);
      return measurePadding(
        selBox.rect,
        {
          top: parseFloat(cs.paddingTop) || 0,
          right: parseFloat(cs.paddingRight) || 0,
          bottom: parseFloat(cs.paddingBottom) || 0,
          left: parseFloat(cs.paddingLeft) || 0,
        },
        selBox.scale,
      );
    }
    return [];
  }, [on, selBox, hoverBox, sel, hover]);

  return (
    <>
      {on && selBox && sel?.t.frame && <Rulers frame={sel.t.frame} scale={selBox.scale} />}
      {hoverBox && hover && <Box {...hoverBox} kind="hover" label={describe(hover.el)} />}
      {selBox && sel && <Box {...selBox} kind="selected" label={describe(sel.el)} />}
      {segments.map((s, i) => (
        <Measure key={i} seg={s} />
      ))}
    </>
  );
}

function Box({
  rect,
  scale,
  clip,
  kind,
  label,
}: {
  rect: DOMRect;
  scale: number;
  clip: DOMRect | null;
  kind: "hover" | "selected";
  label: string;
}) {
  const drawn = clip ? intersect(rect, clip) : rect;
  if (!drawn) return null;
  return (
    <div className={`rvdev-hl is-${kind}`} style={{ left: drawn.left, top: drawn.top, width: drawn.width, height: drawn.height }}>
      <span className="rvdev-hl-tag">
        {label}
        {/* The page's own pixels, not the board's — a spec written from a
            zoomed-out canvas would otherwise be wrong by the zoom factor. */}
        <em>
          {Math.round(rect.width / scale)} × {Math.round(rect.height / scale)}
        </em>
      </span>
    </div>
  );
}

function Measure({ seg }: { seg: Segment }) {
  const horizontal = seg.axis === "x";
  return (
    <div
      className={`rvdev-measure is-${seg.axis}`}
      style={{
        left: Math.min(seg.x1, seg.x2),
        top: Math.min(seg.y1, seg.y2),
        width: horizontal ? Math.abs(seg.x2 - seg.x1) : 0,
        height: horizontal ? 0 : Math.abs(seg.y2 - seg.y1),
      }}
    >
      <span className="rvdev-measure-label">{seg.label}</span>
    </div>
  );
}

/** Rulers along the top and left of the inspected frame, counting the PAGE's
 *  coordinates. a design tool's rulers measure the artboard, not the screen, and that
 *  is the number a developer transcribes. */
function Rulers({ frame, scale }: { frame: HTMLIFrameElement; scale: number }) {
  const [box, setBox] = useState<DOMRect | null>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!frame.isConnected) return;
      const r = frame.getBoundingClientRect();
      setBox((prev) => (prev && prev.left === r.left && prev.top === r.top && prev.width === r.width ? prev : r));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frame]);

  if (!box) return null;
  const xs = rulerTicks(box.width, scale);
  const ys = rulerTicks(box.height, scale);
  return (
    <>
      <div className="rvdev-ruler is-x" style={{ left: box.left, top: box.top - 18, width: box.width }}>
        {xs.map((t) => (
          <span key={t.at} className={t.major ? "rvdev-tick is-major" : "rvdev-tick"} style={{ left: t.at }}>
            {t.major ? t.label : ""}
          </span>
        ))}
      </div>
      <div className="rvdev-ruler is-y" style={{ left: box.left - 18, top: box.top, height: box.height }}>
        {ys.map((t) => (
          <span key={t.at} className={t.major ? "rvdev-tick is-major" : "rvdev-tick"} style={{ top: t.at }}>
            {t.major ? t.label : ""}
          </span>
        ))}
      </div>
    </>
  );
}

// --- inspect -----------------------------------------------------------------

/**
 * A counter that bumps whenever the element's box changes.
 *
 * ⚠ Without this the Inspect readouts are measured ONCE, on the render that
 * selected the element, and never again — which meant the panel confidently
 * reported `0 × 2301.92` for a screen that was actually 880 × 840, because it
 * had measured during first paint, before fonts, images and the panel's own
 * inset had settled. A spec tool quietly showing last-minute's numbers is
 * worse than one showing none.
 */
function useLayoutEpoch(el: Element | null): number {
  const [epoch, setEpoch] = useState(0);
  const last = useRef("");
  useEffect(() => {
    if (!el) return;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!el.isConnected) return;
      const r = el.getBoundingClientRect();
      const key = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (key === last.current) return;
      last.current = key;
      setEpoch((n) => n + 1);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [el]);
  return epoch;
}

function InspectTab({ t, el, onSelect }: { t: DevTarget; el: Element; onSelect: (el: Element) => void }) {
  const epoch = useLayoutEpoch(el);
  const chain = useMemo(() => ownerChain(fiberOf(el)), [el]);
  const owner = useMemo(() => nearestComposite(el), [el]);
  // `epoch` is an invalidation key rather than an input: these three read the
  // LIVE layout, so they must be recomputed whenever the box changes. Reading
  // it inside the factory is what says so — to React, to the linter, and to
  // the next person wondering why it's in the deps.
  const box = useMemo(() => {
    void epoch;
    return boxOf(el);
  }, [el, epoch]);
  const type = useMemo(() => {
    void epoch;
    return typographyOf(el);
  }, [el, epoch]);
  const colors = useMemo(() => {
    void epoch;
    return colorsOf(el);
  }, [el, epoch]);
  // Only when the selection IS one icon. On a wider scope `iconOf` would answer
  // with whichever icon comes first in the subtree — a fact about the page
  // rather than about what's selected. The Assets tab holds the full list.
  const icon = useMemo(() => (el.tagName.toLowerCase() === "svg" || el.querySelectorAll("svg").length === 1 ? iconOf(el) : null), [el]);
  const tk = (v: string, group?: Parameters<typeof tokenLabel>[2]) => tokenLabel(v, t.doc, group);
  // Which element am I actually on? The copy is the fastest confirmation — but
  // only for something small. A whole screen's text concatenated into one
  // paragraph identifies nothing and just pushes the spec off the panel.
  const ownText = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const text = el.querySelectorAll("*").length <= 6 && ownText.length <= 140 ? ownText : "";

  return (
    <>
      <Section title="Component">
        {chain.length ? (
          // Nearest first, weighted: the owning component is the answer to
          // "what is this", its ancestors are context.
          <div className="rvdev-crumbs">
            {chain.map((step, i) => (
              <Fragment key={`${step.name}-${i}`}>
                {i > 0 && <span className="rvdev-crumb-sep">◂</span>}
                <button
                  type="button"
                  className={i === 0 ? "rvdev-crumb is-own" : "rvdev-crumb"}
                  title={`Select <${step.name}>`}
                  onClick={() => {
                    const host = hostNodeOf(step.fiber);
                    if (host) onSelect(host);
                  }}
                >
                  {step.name}
                </button>
              </Fragment>
            ))}
          </div>
        ) : (
          <Empty>Not rendered by React — plain DOM.</Empty>
        )}
      </Section>

      {owner && Object.keys(owner.props).length > 0 && (
        <Section title={`<${owner.name}> props`}>
          <Rows
            rows={Object.entries(owner.props)
              // children render below; key/ref are React's own bookkeeping.
              .filter(([k]) => k !== "children" && k !== "key" && k !== "ref")
              .map(([k, v]) => [k, previewValue(v)])}
          />
        </Section>
      )}

      {icon && (
        <Section title="Icon">
          <div className="rvdev-icon-row">
            <span className="rvdev-icon-preview" dangerouslySetInnerHTML={{ __html: icon.svg }} />
            <div>
              <div className="rvdev-mono">{icon.usage}</div>
              <div className="rvdev-sub">{icon.source}</div>
            </div>
            <Copy text={icon.svg} label="SVG" />
          </div>
        </Section>
      )}

      {/* Layout and type in one list: they are read together, and two headed
          sections for eleven rows was most of what made the panel feel like a
          form. Rows that say nothing (no margin, no gap) are simply absent. */}
      <Section title="Layout">
        <Rows
          rows={[
            ["size", `${box.width} × ${box.height}`],
            ["display", box.display],
            ...optional([
              ["padding", box.padding],
              ["radius", withToken(box.radius, (v) => tk(v, "radius"))],
              ["margin", box.margin],
              ["gap", box.gap],
              ["border", box.border],
            ]),
          ]}
        />
      </Section>

      <Section title="Type">
        <Rows
          rows={[
            ["font", `${withToken(type.family, (v) => tk(v, "font"))} ${type.weight}`],
            ["size", `${type.size} / ${type.lineHeight}`],
            ...optional([
              ["letter-spacing", type.letterSpacing],
              ["transform", type.transform === "none" ? "" : type.transform],
            ]),
          ]}
        />
      </Section>

      <Section title="Color">
        {colors.map((c) => (
          <ColorRow key={c.label} label={c.label} value={c.value} token={tokenLabel(c.value, t.doc, undefined, c.label)} />
        ))}
      </Section>

      {text && (
        <Section title="Text">
          <p className="rvdev-sub" style={{ whiteSpace: "normal" }}>
            {text}
          </p>
        </Section>
      )}
    </>
  );
}

// --- code --------------------------------------------------------------------

/** A color: swatch, the TOKEN as the headline (that's what gets reused) and
 *  the literal value underneath. Clicking copies the token when there is one. */
function ColorRow({ label, value, token }: { label: string; value: string; token: string | null }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rvdev-color"
      title={`Copy ${token ? `var(${token})` : value}`}
      onClick={() => {
        copy(token ? `var(${token})` : value);
        setDone(true);
        window.setTimeout(() => setDone(false), 900);
      }}
    >
      <span className="rvdev-swatch" style={{ background: value }} />
      <span className="rvdev-color-body">
        <span className="rvdev-color-name" style={done ? { color: "var(--rvdev-select)" } : undefined}>
          {done ? "copied" : (token ?? value)}
        </span>
        <span className="rvdev-color-sub">
          {label}
          {token ? ` · ${value}` : ""}
        </span>
      </span>
    </button>
  );
}

function MarkupTab({ t, el }: { t: DevTarget; el: Element }) {
  const [view, setView] = useState<"jsx" | "html" | "css">("jsx");
  const [hosts, setHosts] = useState(true);

  const text = useMemo(() => {
    if (view === "jsx") return elementJsx(el, { hosts, maxDepth: 8 });
    if (view === "html") return elementHtml(el);
    const css = cssForClasses(classesIn(el), t.doc);
    return [rootVarsFor(css, t.doc), css].filter(Boolean).join("\n\n") || "/* No matching rules. */";
  }, [el, view, hosts, t.doc]);

  return (
    <>
      <div className="rvdev-seg-row">
        <div className="rvdev-seg">
          {(["jsx", "html", "css"] as const).map((v) => (
            <button key={v} type="button" className={view === v ? "rvdev-seg-btn is-on" : "rvdev-seg-btn"} onClick={() => setView(v)}>
              {v.toUpperCase()}
            </button>
          ))}
        </div>
        <Copy text={text} label="Copy" />
      </div>

      {view === "jsx" && (
        <label className="rvdev-check">
          <input type="checkbox" checked={hosts} onChange={(e) => setHosts(e.target.checked)} /> include host elements
        </label>
      )}
      {view === "css" && <p className="rvdev-note">What this screen's Tailwind classes compile to, with the tokens they reference.</p>}

      <pre className="rvdev-pre">{text}</pre>
    </>
  );
}

function TokenRow({ token, count }: { token: Token; count?: number }) {
  return (
    <button type="button" className="rvdev-color" onClick={() => copy(`var(${token.name})`)} title={`Copy var(${token.name})`}>
      <span className="rvdev-swatch" style={{ background: token.rgb || "transparent" }} />
      <span className="rvdev-color-body">
        <span className="rvdev-color-name">{token.name}</span>
        <span className="rvdev-color-sub">
          {token.value}
          {count ? ` · used ${count}×` : ""}
        </span>
      </span>
    </button>
  );
}

// --- assets ------------------------------------------------------------------

function ResourcesTab({ el }: { el: Element }) {
  const assets = useMemo<AssetRow[]>(() => scanAssets(el), [el]);
  const icons = useMemo<IconRow[]>(() => scanIcons(el), [el]);
  // Only the tokens this screen actually paints with. The full table is ~290
  // rows; it ships in the bundle's tokens.json, where it can be searched.
  const tokens = useMemo(() => tokensUsedIn(el), [el]);

  return (
    <>
      <Section title={`Tokens · ${tokens.length}`}>
        {tokens.map((u) => (
          <TokenRow key={u.token.name} token={u.token} count={u.count} />
        ))}
        {!tokens.length && <Empty>No palette values matched here.</Empty>}
      </Section>

      <Section title={`Icons · ${icons.length}`}>
        {icons.map((i) => (
          <div key={`${i.source}-${i.name}`} className="rvdev-icon-row">
            <span className="rvdev-icon-preview" dangerouslySetInnerHTML={{ __html: i.svg }} />
            <div>
              <div className="rvdev-mono">{i.usage}</div>
              <div className="rvdev-sub">
                {i.source} · ×{i.count}
              </div>
            </div>
            <span className="rvdev-row-actions">
              <Copy text={i.svg} label="SVG" />
              <SaveFile
                name={`${slugify(i.name) || "icon"}.svg`}
                make={() => Promise.resolve(new Blob([i.svg], { type: "image/svg+xml" }))}
              />
            </span>
          </div>
        ))}
        {!icons.length && <Empty>No icons here.</Empty>}
      </Section>

      <Section
        title={`Files · ${assets.length}`}
        action={
          <span className="rvdev-row-actions">
            <Copy text={JSON.stringify(assets, null, 2)} label="JSON" />
            {(assets.length > 0 || icons.length > 0) && (
              <SaveFile label="Download all" name="resources.zip" make={() => zipResources(assets, icons)} />
            )}
          </span>
        }
      >
        {assets.map((a) => (
          <div key={a.url} className="rvdev-asset">
            {a.kind === "image" && (
              <span className="rvdev-asset-thumb">
                <img src={a.url} alt="" loading="lazy" />
              </span>
            )}
            <div className="rvdev-asset-body">
              <a href={a.url} target="_blank" rel="noreferrer" className="rvdev-asset-url">
                {path(a.url)}
              </a>
              <div className="rvdev-sub">
                {a.kind} · {a.via}
                {a.size !== "—" ? ` · ${a.size} intrinsic` : ""}
                {a.rendered !== "—" ? ` · ${a.rendered} rendered` : ""}
                {a.bytes ? ` · ${formatBytes(a.bytes)}` : ""}
              </div>
            </div>
            <SaveFile name={fileName(a.url)} make={() => fetchBlob(a.url)} />
          </div>
        ))}
        {!assets.length && <Empty>No images, fonts or video here.</Empty>}
      </Section>
    </>
  );
}

// --- export ------------------------------------------------------------------

function ExportTab({ t, el, label }: { t: DevTarget; el: Element; label: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setDone(null);
    try {
      await fn();
      setDone(`Saved ${name}.`);
    } catch (err) {
      setDone(`${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(null);
    }
  };

  const base = slugify(t.doc.title || t.doc.location.pathname) || "screen";
  const params = Array.from(new URL(t.doc.location.href).searchParams.entries());
  /** Assigning href re-enters the screen at that state; a pushState would only
   *  half-apply it, since the app reads most of these params at mount. */
  const setParam = (key: string, value: string) => {
    const next = new URL(t.doc.location.href);
    if (value) next.searchParams.set(key, value);
    else next.searchParams.delete(key);
    t.doc.location.href = next.toString();
  };

  return (
    <>
      <Section title="Download">
        <button
          type="button"
          className="rvdev-action"
          disabled={!!busy}
          onClick={() =>
            run("page.html", async () => {
              const html = await standaloneHtml(t);
              saveBlob(new Blob([html], { type: "text/html" }), `${base}.html`);
            })
          }
        >
          <b>{busy === "page.html" ? "Inlining…" : "page.html"}</b>
          <span>One self-contained file — styles, fonts and images inlined, scripts stripped. Opens offline, looks identical, not interactive.</span>
        </button>

        <button
          type="button"
          className="rvdev-action"
          disabled={!!busy}
          onClick={() => run("bundle.zip", async () => void (await exportBundle(t, el, label)))}
        >
          <b>{busy === "bundle.zip" ? "Packing…" : "bundle.zip"}</b>
          <span>Everything: page.html, the JSX tree, the resolved CSS, tokens.json, the asset files, every icon as an .svg, and a README.</span>
        </button>
        {done && <p className="rvdev-note">{done}</p>}
      </Section>

      {/* The URL IS the state in this app — every flow step, persona and
          seeded variant is a query param (CLAUDE.md: "URL is the whole
          state"). So it lives beside the exports: what you take away is always
          "this screen, in this state", and a param is how you change which
          state that is. */}
      <Section title="This state" action={<Copy text={t.doc.location.href} label="URL" />}>
        <div className="rvdev-rows">
          <div className="rvdev-row">
            <span className="rvdev-row-key">path</span>
            <span className="rvdev-row-value">{new URL(t.doc.location.href).pathname}</span>
          </div>
          {params.map(([k, v]) => (
            <div key={k} className="rvdev-param">
              <span className="rvdev-row-key">{k}</span>
              <input
                className="rvdev-input is-sm"
                defaultValue={v}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setParam(k, (e.target as HTMLInputElement).value);
                }}
                onBlur={(e) => e.target.value !== v && setParam(k, e.target.value)}
              />
            </div>
          ))}
        </div>
      </Section>

      <p className="rvdev-note">Every export covers the component the header names — everything below that part of the tree — or Clear for the whole screen.</p>
    </>
  );
}

// --- small pieces ------------------------------------------------------------

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rvdev-group">
      <h3>
        {title}
        {action}
      </h3>
      {children}
    </section>
  );
}

/** Label left, value right — and every row is a copy button. A developer
 *  reading a spec is about to retype these values somewhere; making them click
 *  targets is the difference between a readout and a tool. */
function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="rvdev-rows">
      {rows.map(([k, v]) => (
        <CopyRow key={k} label={k} value={v} />
      ))}
    </div>
  );
}

function CopyRow({ label, value, token }: { label: string; value: string; token?: string | null }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="rvdev-row"
      title={`Copy "${token ?? value}"`}
      onClick={() => {
        copy(token ?? value);
        setDone(true);
        window.setTimeout(() => setDone(false), 900);
      }}
    >
      <span className="rvdev-row-key">{label}</span>
      <span className={done ? "rvdev-row-value is-copied" : "rvdev-row-value"}>
        {done ? "copied" : token ? <><span className="rvdev-row-token">{token}</span> {value}</> : value}
      </span>
    </button>
  );
}

/** Drops rows whose value is nothing worth reading — "0", "none", "—". A spec
 *  that lists every property an element doesn't set is longer and says less. */
function optional(rows: [string, string][]): [string, string][] {
  return rows.filter(([, v]) => v && v !== "0" && v !== "none" && v !== "normal" && v !== "—");
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rvdev-empty">{children}</p>;
}

function Copy({ text, label, block }: { text: string; label: string; block?: boolean }) {
  const [ok, setOk] = useState(false);
  const onClick = useCallback(() => {
    copy(text);
    setOk(true);
    window.setTimeout(() => setOk(false), 1200);
  }, [text]);
  return (
    <button type="button" className={block ? "rvdev-copy is-block" : "rvdev-copy"} onClick={onClick}>
      {ok ? "Copied" : label}
    </button>
  );
}

/** The Copy chip's sibling: same control, but the result is a file on disk
 *  rather than a clipboard entry (the reviewer, 2026-08-19, from a reviewer asking how to
 *  export the card art — every resource row is now a download, not just a
 *  link into a preview site). `make` is async because most saves fetch. */
function SaveFile({ name, make, label = "Download" }: { name: string; make: () => Promise<Blob>; label?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const onClick = useCallback(async () => {
    setState("busy");
    try {
      saveBlob(await make(), name);
      setState("done");
    } catch {
      setState("fail");
    }
    window.setTimeout(() => setState("idle"), 1400);
  }, [name, make]);
  return (
    <button
      type="button"
      className={state === "done" ? "rvdev-copy is-done" : "rvdev-copy"}
      disabled={state === "busy"}
      onClick={() => void onClick()}
    >
      {state === "busy" ? "Saving…" : state === "done" ? "Saved" : state === "fail" ? "Failed" : label}
    </button>
  );
}

/** Same-origin fetch of a resource the page already loaded — the bundle
 *  export's own path (export.ts), per file instead of all at once. */
async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.blob();
}

/** The file's own basename, hash-suffixed by Vite and all — the name a
 *  developer can trace back to the bundle. */
function fileName(url: string): string {
  try {
    const base = new URL(url).pathname.split("/").filter(Boolean).pop();
    return base ? decodeURIComponent(base) : "asset";
  } catch {
    return "asset";
  }
}

/** Every listed resource as one archive: the files under their bundle paths
 *  (path segments joined, same as the bundle export, so two same-named files
 *  can't collide) and each icon as its own .svg. Unreachable files are
 *  skipped, not fatal — the per-row buttons still name them. */
async function zipResources(assets: AssetRow[], icons: IconRow[]): Promise<Blob> {
  const entries: ZipEntry[] = [];
  const enc = new TextEncoder();
  for (const i of icons) entries.push({ name: `icons/${slugify(i.name) || "icon"}.svg`, data: enc.encode(i.svg) as Uint8Array<ArrayBuffer> });
  await Promise.all(
    assets.map(async (a) => {
      try {
        const res = await fetch(a.url);
        if (!res.ok) return;
        const buf = new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;
        const name = new URL(a.url).pathname.split("/").filter(Boolean).join("_") || "asset";
        entries.push({ name, data: buf });
      } catch {
        /* unreachable asset — its row's own button will say so */
      }
    }),
  );
  if (!entries.length) throw new Error("nothing to save");
  return makeZip(entries);
}

function copy(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {
    // Clipboard API needs a secure context; the textarea trick always works.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
}

function CloseGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

/** A quiet copy control for the target chip. */
function CopyGhost({ text, label, title }: { text: string; label: string; title: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={done ? "rvdev-ghost is-done" : "rvdev-ghost"}
      title={title}
      onClick={() => {
        copy(text);
        setDone(true);
        window.setTimeout(() => setDone(false), 900);
      }}
    >
      {done ? "copied" : label}
    </button>
  );
}

/**
 * A CSS selector that finds this element again — the handle a developer takes
 * to their own devtools, or into a bug report.
 *
 * Shortest thing that's unique in its document, tried in the order a person
 * would: an id, then a distinctive class, then a nth-of-type path. It is
 * checked for uniqueness rather than assumed — a selector that silently
 * matches something else is worse than a long one.
 */
function selectorFor(el: Element): string {
  const doc = el.ownerDocument;
  const unique = (sel: string) => {
    try {
      return doc.querySelectorAll(sel).length === 1;
    } catch {
      return false;
    }
  };
  if (el.id && unique(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;

  const tag = el.tagName.toLowerCase();
  // Utility classes repeat everywhere; a semantic-looking one is worth trying.
  for (const cls of Array.from(el.classList)) {
    const sel = `${tag}.${CSS.escape(cls)}`;
    if (unique(sel)) return sel;
  }

  const path: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && path.length < 6) {
    if (node.id && unique(`#${CSS.escape(node.id)}`)) {
      path.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (!parent) {
      path.unshift(node.tagName.toLowerCase());
      break;
    }
    const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
    const step =
      siblings.length > 1
        ? `${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node) + 1})`
        : node.tagName.toLowerCase();
    path.unshift(step);
    if (unique(path.join(" > "))) break;
    node = parent;
  }
  return path.join(" > ");
}

function Crosshair() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="3.2" />
      <line x1="12" y1="2.5" x2="12" y2="7" />
      <line x1="12" y1="17" x2="12" y2="21.5" />
      <line x1="2.5" y1="12" x2="7" y2="12" />
      <line x1="17" y1="12" x2="21.5" y2="12" />
    </svg>
  );
}

function Ruler() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
      <rect x="2.5" y="8" width="19" height="8" rx="1.5" />
      <line x1="7" y1="8" x2="7" y2="11.5" />
      <line x1="12" y1="8" x2="12" y2="12.5" />
      <line x1="17" y1="8" x2="17" y2="11.5" />
    </svg>
  );
}

/** The element React actually rendered — `#root` is only the container it was
 *  mounted into, and carries no fiber of its own, so defaulting to it would
 *  make the whole-screen scope report "not rendered by React". */
function appRoot(doc: Document): Element {
  const mount = doc.getElementById("root");
  return mount?.firstElementChild ?? mount ?? doc.body;
}

/** `<Button> button.rounded-full` — component first, then a CSS-selector-shaped
 *  name a dev can paste into their own devtools. */
function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const owner = nearestComposite(el);
  const classes = Array.from(el.classList).slice(0, 2).map((c) => `.${c}`).join("");
  const rest = el.classList.length > 2 ? `+${el.classList.length - 2}` : "";
  return `${owner ? `<${owner.name}> ` : ""}${tag}${classes}${rest}`;
}

function withToken(value: string, tk: (v: string) => string | null): string {
  const name = tk(value);
  return name ? `${value}  (${name})` : value;
}

function previewValue(v: unknown): string {
  if (typeof v === "string") return v.length > 80 ? `${v.slice(0, 77)}…` : v;
  if (typeof v === "function") return "fn";
  if (v === null) return "null";
  if (typeof v === "object") {
    try {
      const s = JSON.stringify(v);
      return s.length > 80 ? `${s.slice(0, 77)}…` : s;
    } catch {
      return "{…}";
    }
  }
  return String(v);
}

/** Overlap of two screen rects, or null when they don't meet. */
function intersect(a: DOMRect, b: DOMRect): DOMRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return new DOMRect(left, top, right - left, bottom - top);
}

function path(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
