// Dev mode — WHICH document is being inspected.
//
// Two callers, and the difference between them is the whole reason this file
// exists:
//
//   page   dev mode opened on a product route (?dev=1 / ⌘⇧D). The target is
//          the page it's running in.
//   board  dev mode opened from the review canvas. The panel runs in the
//          BOARD, but everything it reports must describe the app inside a
//          frame — the board's own chrome is not the thing under review.
//          Frames are same-origin iframes, so their document is readable
//          directly; what changes is only which one we read.
//
// So nothing in dev/ may reach for the ambient `document`, `window`,
// `getComputedStyle` or `performance`. Every module takes the target, and
// this file is the one place that resolves it.

export type DevTarget = {
  doc: Document;
  win: Window;
  /** The iframe the document lives in, when it's framed. Null in page mode.
   *  Highlights need it: an element's rect is in the FRAME's coordinate
   *  space, and the canvas has scaled and panned that frame across the board. */
  frame: HTMLIFrameElement | null;
};

export function pageTarget(): DevTarget {
  return { doc: document, win: window, frame: null };
}

/** A frame's contents as a target, or null if it isn't ready (still booting,
 *  or cross-origin — which shouldn't happen here, but a thrown SecurityError
 *  inside a hover handler would take the panel down with it). */
export function frameTarget(frame: HTMLIFrameElement): DevTarget | null {
  try {
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win || !doc.body) return null;
    return { doc, win, frame };
  } catch {
    return null;
  }
}

/** True once the target's document has gone away — a frame remounted, the
 *  board virtualized it out, the app navigated. Everything the panel holds
 *  about it is stale from that moment. */
export function isStale(t: DevTarget, el?: Element | null): boolean {
  if (t.frame && !t.frame.isConnected) return true;
  if (!t.doc.body) return true;
  return !!el && !el.isConnected;
}

/** The view an element belongs to. Cross-document code cannot call the
 *  ambient `getComputedStyle`: it would resolve against the wrong window. */
export function viewOf(el: Element): Window {
  return el.ownerDocument.defaultView ?? window;
}

export function styleOf(el: Element): CSSStyleDeclaration {
  return viewOf(el).getComputedStyle(el);
}

/**
 * `instanceof` that survives crossing into a frame.
 *
 * ⚠ This is the single sharpest edge in dev/. Every realm has its OWN DOM
 * constructors, so a `CSSFontFaceRule` from a frame is NOT `instanceof` the
 * board's `CSSFontFaceRule` — the check returns false, silently, and whatever
 * it guarded reads as "there are none". That failure is invisible: the panel
 * shows an empty list rather than an error. So inside dev/, never write a bare
 * `instanceof` against a DOM class; ask the target's own realm.
 *
 * (For plain Element / Node tests, prefer `nodeType === 1` — cheaper, and it
 * needs no realm at all.)
 */
export function isInstance(value: unknown, ctorName: string, scope: Document | Window): boolean {
  const win = "defaultView" in scope ? (scope.defaultView ?? window) : scope;
  const ctor = (win as unknown as Record<string, unknown>)[ctorName];
  return typeof ctor === "function" && value instanceof (ctor as new () => unknown);
}

/** Element test that ignores realms entirely. */
export function isElement(node: unknown): node is Element {
  return !!node && (node as Node).nodeType === 1;
}

// --- frame → screen geometry -------------------------------------------------

/** How much the board has scaled the frame on screen. The canvas transform,
 *  the frame's own `scale()` and any device downscale all compound into this
 *  one ratio, so measuring it beats trying to track them separately. */
export function frameScale(frame: HTMLIFrameElement): number {
  const rect = frame.getBoundingClientRect();
  const w = frame.offsetWidth;
  return w > 0 ? rect.width / w : 1;
}

/** The frame under a point, or null.
 *
 *  ⚠ Deliberately geometric rather than `elementsFromPoint`: the board sets
 *  `pointer-events: none` on every non-interactive frame's iframe so the
 *  canvas can be panned over it (review.css `.rv-frame-live.is-inert iframe`),
 *  which means hit-testing NEVER returns the one thing dev mode most needs to
 *  find. Rects don't lie about where something is drawn.
 *
 *  The rect is clipped by any ancestor that hides overflow, because a board
 *  frame's iframe is laid out taller than the window it shows through — the
 *  part below the fold is not something you can point at. */
export function frameAtPoint(root: Document, x: number, y: number, exclude?: Element | null): HTMLIFrameElement | null {
  let best: HTMLIFrameElement | null = null;
  for (const frame of Array.from(root.querySelectorAll("iframe"))) {
    if (exclude?.contains(frame)) continue;
    const r = visibleRect(frame);
    if (!r) continue;
    // Last match wins: later in document order is painted on top, which is
    // the frame a person believes they are pointing at.
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) best = frame;
  }
  return best;
}

/** An element's on-screen box after every clipping ancestor has had its say.
 *  Null when it's been clipped away entirely. */
export function visibleRect(el: Element): DOMRect | null {
  let rect = el.getBoundingClientRect();
  let parent = el.parentElement;
  while (parent) {
    const cs = viewOf(parent).getComputedStyle(parent);
    if (cs.overflow !== "visible" || cs.overflowX !== "visible" || cs.overflowY !== "visible") {
      const p = parent.getBoundingClientRect();
      const left = Math.max(rect.left, p.left);
      const top = Math.max(rect.top, p.top);
      const right = Math.min(rect.right, p.right);
      const bottom = Math.min(rect.bottom, p.bottom);
      if (right <= left || bottom <= top) return null;
      rect = new DOMRect(left, top, right - left, bottom - top);
    }
    parent = parent.parentElement;
  }
  return rect;
}

/** A rect inside the target document, expressed in the host page's screen
 *  coordinates — so a highlight drawn over a canvas frame lands on the element
 *  it belongs to at any zoom. */
export function toScreenRect(t: DevTarget, el: Element): DOMRect {
  const r = el.getBoundingClientRect();
  if (!t.frame) return r;
  const f = t.frame.getBoundingClientRect();
  const k = frameScale(t.frame);
  return new DOMRect(f.left + r.left * k, f.top + r.top * k, r.width * k, r.height * k);
}

/** The reverse: a point on the host page, as a point inside the framed
 *  document — what `elementFromPoint` needs to answer a hover. */
export function toFramePoint(frame: HTMLIFrameElement, clientX: number, clientY: number): { x: number; y: number } {
  const f = frame.getBoundingClientRect();
  const k = frameScale(frame) || 1;
  return { x: (clientX - f.left) / k, y: (clientY - f.top) / k };
}
