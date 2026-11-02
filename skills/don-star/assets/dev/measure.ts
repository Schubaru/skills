// Dev mode — the measurement layer, the way a design tool's does it.
//
// a design tool's dev mode answers a question devtools never quite does: not "how big
// is this box" but "how far is it from THAT one". You select something, hover
// something else, and the gaps between them are drawn with their numbers on.
// That's what this file computes.
//
// Three readings, in the order they answer questions:
//   size     the hovered/selected box's own dimensions
//   insets   when one box is inside the other: the four gaps to its edges,
//            which is how you read padding and alignment
//   gaps     when they're apart: the distance across, on whichever axes they
//            don't overlap
//
// Everything is pure geometry over screen-space rects, so it works identically
// on a plain page and on a frame the review canvas has scaled and panned —
// the caller converts once (target.ts `toScreenRect`) and hands rects in.

export type Segment = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Rendered distance, in the INSPECTED page's own CSS pixels — never the
   *  board's scaled ones, or every number would change with the zoom. */
  label: string;
  axis: "x" | "y";
};

/** Rounds the way a spec is read: whole pixels, but never rounding a real 0.5
 *  gap away to "0". */
function px(n: number): string {
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}`;
}

/**
 * Measurements between two rects, in the host's screen coordinates.
 *
 * `scale` is how much the host has magnified the inspected page (1 on a plain
 * page, the canvas zoom inside a board frame). Positions are drawn in screen
 * space; LABELS are divided back down by it, because the developer is going to
 * write the number into a stylesheet where the board's zoom does not exist.
 */
export function measureBetween(a: DOMRect, b: DOMRect, scale = 1): Segment[] {
  const out: Segment[] = [];
  const k = scale || 1;

  // Containment reads as insets — the four gaps that tell you the padding and
  // whether the thing is centred.
  if (contains(a, b) || contains(b, a)) {
    const [outer, inner] = contains(a, b) ? [a, b] : [b, a];
    const midX = inner.left + inner.width / 2;
    const midY = inner.top + inner.height / 2;
    push(out, outer.left, midY, inner.left, midY, "x", k);
    push(out, inner.right, midY, outer.right, midY, "x", k);
    push(out, midX, outer.top, midX, inner.top, "y", k);
    push(out, midX, inner.bottom, midX, outer.bottom, "y", k);
    return out;
  }

  // Apart: measure across each axis they DON'T overlap on. A box that is both
  // left of and above the other gets two segments, which together read as the
  // diagonal offset.
  const yOverlap = overlap(a.top, a.bottom, b.top, b.bottom);
  const xOverlap = overlap(a.left, a.right, b.left, b.right);

  const y = yOverlap ? (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2 : b.top + b.height / 2;
  if (b.right <= a.left) push(out, b.right, y, a.left, y, "x", k);
  else if (a.right <= b.left) push(out, a.right, y, b.left, y, "x", k);

  const x = xOverlap ? (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2 : b.left + b.width / 2;
  if (b.bottom <= a.top) push(out, x, b.bottom, x, a.top, "y", k);
  else if (a.bottom <= b.top) push(out, x, a.bottom, x, b.top, "y", k);

  return out;
}

/** The element's own padding, as four inset segments — the reading you want
 *  when nothing is hovered and you're looking at one box on its own. */
export function measurePadding(rect: DOMRect, padding: { top: number; right: number; bottom: number; left: number }, scale = 1): Segment[] {
  const k = scale || 1;
  const out: Segment[] = [];
  const midX = rect.left + rect.width / 2;
  const midY = rect.top + rect.height / 2;
  if (padding.left > 0) push(out, rect.left, midY, rect.left + padding.left * k, midY, "x", k);
  if (padding.right > 0) push(out, rect.right - padding.right * k, midY, rect.right, midY, "x", k);
  if (padding.top > 0) push(out, midX, rect.top, midX, rect.top + padding.top * k, "y", k);
  if (padding.bottom > 0) push(out, midX, rect.bottom - padding.bottom * k, midX, rect.bottom, "y", k);
  return out;
}

function push(out: Segment[], x1: number, y1: number, x2: number, y2: number, axis: "x" | "y", scale: number): void {
  const len = axis === "x" ? x2 - x1 : y2 - y1;
  // Sub-pixel gaps are rendering noise, not a measurement anyone acts on.
  if (len <= 0.5) return;
  out.push({ x1, y1, x2, y2, label: px(len / scale), axis });
}

function contains(outer: DOMRect, inner: DOMRect): boolean {
  return (
    outer.left <= inner.left + 0.5 &&
    outer.top <= inner.top + 0.5 &&
    outer.right >= inner.right - 0.5 &&
    outer.bottom >= inner.bottom - 0.5 &&
    // A box the same size as its parent isn't "inside" it in any useful sense —
    // four zero insets tell you nothing.
    (outer.width > inner.width + 0.5 || outer.height > inner.height + 0.5)
  );
}

function overlap(a1: number, a2: number, b1: number, b2: number): boolean {
  return Math.min(a2, b2) - Math.max(a1, b1) > 0;
}

/** The ruler ticks along a frame's edges: nice round steps that stay legible
 *  at any zoom, labelled in the PAGE's pixels. Mirrors a design tool's rulers, which
 *  count the artboard's own coordinates rather than the screen's. */
export function rulerTicks(lengthPx: number, scale: number): { at: number; label: string; major: boolean }[] {
  const k = scale || 1;
  // Aim for a tick every ~60 screen px, snapped to a 1/2/5×10ⁿ step so the
  // numbers stay round as you zoom.
  const rough = 60 / k;
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1))));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= rough) ?? mag * 10;

  const out: { at: number; label: string; major: boolean }[] = [];
  const pageLen = lengthPx / k;
  for (let v = 0; v <= pageLen; v += step) {
    out.push({ at: v * k, label: String(Math.round(v)), major: (v / step) % 5 === 0 });
  }
  return out;
}
