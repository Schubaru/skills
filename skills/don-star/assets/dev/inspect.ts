// Dev mode — what an element on screen actually IS.
//
// The audience is a developer who does NOT have this repo (an outside
// engineer rebuilding a screen in their own stack). So every fact here has to
// be readable off the running page: nothing is looked up in source, and no
// answer is a file path they can't open.
//
// The one non-public thing we read is React's own fiber, hung off every host
// DOM node as `__reactFiber$<random>`. That is how the panel can say "this is
// a <Button variant="primary">" instead of "this is a <button class=…>" —
// component names and their props are the vocabulary a dev rebuilds FROM.
// It's an internal, so every read is defensive: a React upgrade that renames
// the property degrades this to plain DOM facts rather than throwing.
//
// ⚠ Component names survive minification only because vite.config.ts sets
// `esbuild.keepNames` — dev mode ships to the deployed site (it's behind the
// same login gate as everything else), and a panel that says "<t7>" on
// production is a panel nobody trusts.

import { isElement, styleOf } from "./target";

export type Fiber = {
  type: unknown;
  elementType: unknown;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  stateNode: unknown;
  memoizedProps: Record<string, unknown> | null;
  tag: number;
};

/** The fiber behind a DOM node, or null if React never rendered it (portal
 *  chrome, a third-party widget, our own overlay). */
export function fiberOf(el: Element): Fiber | null {
  for (const key in el) {
    if (key.startsWith("__reactFiber$")) return (el as unknown as Record<string, Fiber>)[key] ?? null;
  }
  return null;
}

/** React wraps components in objects (memo, forwardRef, context) whose name
 *  lives one level in. Unwrap to something a dev would actually type. */
export function componentName(type: unknown): string | null {
  if (typeof type === "string") return type; // host element: "div", "button"
  if (typeof type === "function") {
    const fn = type as { displayName?: string; name?: string };
    return fn.displayName || fn.name || null;
  }
  if (type && typeof type === "object") {
    const o = type as { displayName?: string; type?: unknown; render?: unknown; $$typeof?: symbol };
    if (o.displayName) return o.displayName;
    // memo(X) / forwardRef(X) — name the inner component, not the wrapper.
    if (o.type) return componentName(o.type);
    if (o.render) return componentName(o.render);
  }
  return null;
}

/** True for anything a dev writes as `<Name/>` rather than `<div/>`. */
function isComposite(f: Fiber): boolean {
  return typeof f.type === "function" || (typeof f.type === "object" && f.type !== null);
}

export type OwnerStep = { name: string; props: Record<string, unknown>; fiber: Fiber };

/** Plumbing that appears above every element in this app and identifies
 *  nothing about it. React Router alone contributes six entries to a stack
 *  that is only useful while it names the SCREEN's own components. */
const PLUMBING = new Set([
  "Router",
  "Routes",
  "Route",
  "RenderedRoute",
  "BrowserRouter",
  "RouterProvider",
  "Outlet",
  "Navigation",
  "Location",
  "DataRoutes",
  "MemoryRouter",
  "StrictMode",
  "Suspense",
  "ErrorBoundary",
]);

/** The component stack above an element, nearest first:
 *  `Button → FlowScreen → Intake`. This is the breadcrumb that tells a dev
 *  which piece of the page they are standing in. */
export function ownerChain(start: Fiber | null, max = 6): OwnerStep[] {
  const out: OwnerStep[] = [];
  let f: Fiber | null = start;
  while (f && out.length < max) {
    if (isComposite(f)) {
      const name = componentName(f.type);
      // Anonymous wrappers (inline arrow components, context consumers) and
      // router plumbing are noise in a breadcrumb — they name nothing a dev
      // can look up.
      if (name && name !== "Unknown" && !PLUMBING.has(name)) {
        out.push({ name, props: f.memoizedProps ?? {}, fiber: f });
      }
    }
    f = f.return;
  }
  return out;
}

/** The component that OWNS this DOM node — the first composite at or above it.
 *  Selecting a `<span>` inside a Button should talk about the Button. */
export function nearestComposite(el: Element): OwnerStep | null {
  return ownerChain(fiberOf(el), 1)[0] ?? null;
}

/** The first real DOM node a component rendered. Function components have no
 *  `stateNode` of their own, so clicking a name in the breadcrumb has to
 *  descend to the host element it produced. */
export function hostNodeOf(f: Fiber): Element | null {
  const queue: Fiber[] = [f];
  while (queue.length) {
    const cur = queue.shift()!;
    if (isElement(cur.stateNode)) return cur.stateNode;
    let c = cur.child;
    while (c) {
      queue.push(c);
      c = c.sibling;
    }
  }
  return null;
}

// --- box + type facts --------------------------------------------------------

export type Box = {
  width: number;
  height: number;
  padding: string;
  margin: string;
  border: string;
  radius: string;
  display: string;
  gap: string;
};

/** Rendered geometry, in the shape a dev reads a spec in. Sides collapse to
 *  one number when they're equal, the way CSS shorthand does. */
export function boxOf(el: Element): Box {
  const cs = styleOf(el);
  const r = el.getBoundingClientRect();
  return {
    width: round(r.width),
    height: round(r.height),
    padding: sides(cs, "padding-top", "padding-right", "padding-bottom", "padding-left"),
    margin: sides(cs, "margin-top", "margin-right", "margin-bottom", "margin-left"),
    border: sides(cs, "border-top-width", "border-right-width", "border-bottom-width", "border-left-width"),
    radius: sides(
      cs,
      "border-top-left-radius",
      "border-top-right-radius",
      "border-bottom-right-radius",
      "border-bottom-left-radius",
    ),
    display: cs.display,
    gap: cs.gap && cs.gap !== "normal" ? cs.gap : "—",
  };
}

export type Typography = {
  family: string;
  size: string;
  weight: string;
  lineHeight: string;
  letterSpacing: string;
  transform: string;
};

export function typographyOf(el: Element): Typography {
  const cs = styleOf(el);
  return {
    // Only the first family matters — the rest is the fallback stack.
    family: cs.fontFamily.split(",")[0]!.replace(/["']/g, "").trim(),
    size: cs.fontSize,
    weight: cs.fontWeight,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing === "normal" ? "0" : cs.letterSpacing,
    transform: cs.textTransform,
  };
}

export type ColorFact = { label: string; value: string };

/** The paint on an element. Gradients and shadows are included as raw values —
 *  they carry token references a dev needs, and there's no shorter true form. */
export function colorsOf(el: Element): ColorFact[] {
  const cs = styleOf(el);
  const out: ColorFact[] = [{ label: "color", value: cs.color }];
  if (!isBlank(cs.backgroundColor)) out.push({ label: "background", value: cs.backgroundColor });
  if (cs.backgroundImage && cs.backgroundImage !== "none")
    out.push({ label: "background-image", value: cs.backgroundImage });
  if (parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0)
    out.push({ label: "border-color", value: cs.borderTopColor });
  if (cs.boxShadow && cs.boxShadow !== "none") out.push({ label: "box-shadow", value: cs.boxShadow });
  if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0)
    out.push({ label: "outline", value: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}` });
  return out;
}

// --- icons -------------------------------------------------------------------

export type IconFact = {
  /** What a dev writes: `<Icon name="check"/>` or `<ChevronRight/>`. */
  usage: string;
  /** Which library it comes from — the two in this app read very differently. */
  source: "design-system" | "lucide-react" | "inline-svg";
  /** The icon's own name, for a dev searching their own set. */
  name: string;
  /** The rendered SVG, so someone without the repo can just take it. */
  svg: string;
};

/** Names the icon an element is (or contains one of). Two idioms live here:
 *  the design system's `<Icon name="kebab-case"/>` lookup component, and
 *  lucide's one-component-per-icon. Both are recoverable from the fiber; the
 *  raw <svg> is included either way, because the consuming dev may have
 *  neither library. */
export function iconOf(el: Element): IconFact | null {
  const svg = el.tagName.toLowerCase() === "svg" ? (el as SVGSVGElement) : el.querySelector("svg");
  if (!svg) return null;
  const markup = svg.outerHTML;

  // Walk up from the <svg> looking for the component that decided WHICH icon
  // this is. `Icon` carries the answer in a prop; a lucide/svgr component IS
  // the answer.
  for (const step of ownerChain(fiberOf(svg), 6)) {
    const nameProp = step.props["name"];
    if (step.name === "Icon" && typeof nameProp === "string") {
      return { usage: `<Icon name="${nameProp}" />`, source: "design-system", name: nameProp, svg: markup };
    }
    // svgr output for the vendored the client set is `SvgChevronRight`; strip the
    // prefix to get the name the Icon component knows it by.
    if (/^Svg[A-Z]/.test(step.name)) {
      const bare = step.name.slice(3);
      return { usage: `<Icon name="${kebab(bare)}" />`, source: "design-system", name: kebab(bare), svg: markup };
    }
    // lucide components are PascalCase and render an <svg> directly.
    if (/^[A-Z]/.test(step.name) && svg.classList.contains("lucide")) {
      return { usage: `<${step.name} />`, source: "lucide-react", name: step.name, svg: markup };
    }
  }
  return { usage: "<svg>…</svg>", source: "inline-svg", name: svg.getAttribute("aria-label") || "inline", svg: markup };
}

// --- helpers -----------------------------------------------------------------

function sides(cs: CSSStyleDeclaration, ...props: string[]): string {
  const v = props.map((p) => short(cs.getPropertyValue(p)));
  if (v.every((x) => x === v[0])) return v[0]!;
  // CSS's own two-value shorthand when the pairs match — "0 24px" is how a dev
  // writes what "0 24px 0 24px" says.
  const [top, right, bottom, left] = v;
  if (top === bottom && right === left) return `${top} ${right}`;
  return v.join(" ");
}

/** "16px" reads better than "16.0000px"; "0px" reads better as "0".
 *
 *  ⚠ `rounded-full` computes to a radius of ~3.4e7px, and a number that size
 *  is not a measurement — it's the browser saying "as round as it goes". It
 *  prints as `full`, which is both shorter and the thing that's true. */
function short(v: string): string {
  const raw = v.trim();
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return raw || "0";
  if (n === 0) return "0";
  if (n >= 1e6) return "full";
  // Take the unit off the END rather than stripping digits off the front:
  // scientific notation ("3.35e+07px") has digits on both sides of it.
  const unit = raw.match(/[a-z%]+$/i)?.[0] ?? "";
  return `${round(n)}${unit}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function isBlank(color: string): boolean {
  return !color || color === "transparent" || color === "rgba(0, 0, 0, 0)";
}

export function kebab(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}
