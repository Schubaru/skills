// Dev mode — the three answers to "what is this made of?"
//
//   JSX   the component tree, read off React's fiber. What a dev rebuilds FROM.
//   HTML  the rendered DOM, indented. What a dev ports when they don't use React.
//   CSS   the rules behind the Tailwind classes on screen, resolved to real
//         declarations. `px-5` means nothing without a Tailwind build; the
//         `padding-inline: 1.25rem` it compiles to means something anywhere.
//
// All three are derived from the live page rather than from source, because
// the consuming developer has no repo (and because the seeded review-board
// states have no source form — they only exist as a rendered page).

import { componentName, fiberOf, type Fiber } from "./inspect";
import { isElement, isInstance } from "./target";

/** Attributes React and our own harness add that mean nothing downstream. */
const NOISE_ATTRS = /^(?:data-reactroot|data-rvdev.*|aria-owns)$/;

/** Nodes the panel itself put in the page (the color probe). They are our
 *  instrument, so they never appear in anything a dev copies out. */
function isInstrument(el: Element): boolean {
  return el.hasAttribute("data-rvdev-probe") || el.id === "rvdev-root";
}

// --- JSX ---------------------------------------------------------------------

export type JsxOptions = {
  /** How deep to descend. Beyond ~6 the output stops being readable and
   *  starts being a memory dump. */
  maxDepth?: number;
  /** Include host elements (`div`, `span`) as well as components. Off gives a
   *  component-only skeleton, which is the better first read of a screen. */
  hosts?: boolean;
};

/** Reconstructs JSX for the subtree under a DOM node, from the fiber tree.
 *  This is an accurate record of what RENDERED — prop values are the real
 *  runtime ones — not a copy of the source file, so a `.map()` in the source
 *  appears here as its expanded rows. That's the more useful artifact for
 *  someone rebuilding the screen. */
export function elementJsx(el: Element, opts: JsxOptions = {}): string {
  const fiber = fiberOf(el);
  if (!fiber) return "// No React fiber on this node — see the HTML tab.";
  const maxDepth = opts.maxDepth ?? 6;
  const lines: string[] = [];
  writeFiber(fiber, 0, maxDepth, opts.hosts ?? true, lines);
  return lines.join("\n") || "// Nothing rendered under this node.";
}

function writeFiber(f: Fiber, depth: number, maxDepth: number, hosts: boolean, out: string[]): void {
  const pad = "  ".repeat(depth);
  const name = componentName(f.type);

  // Text fibers (tag 6) carry the string itself as their props.
  if (f.tag === 6) {
    const text = String(f.memoizedProps ?? "").trim();
    if (text) out.push(pad + text);
    return;
  }

  const isHost = typeof f.type === "string";
  const skip = !name || (isHost && !hosts);

  if (skip) {
    // Fragments, providers and skipped hosts are transparent: render their
    // children at the SAME depth so the indentation still means nesting.
    for (const child of childrenOf(f)) writeFiber(child, depth, maxDepth, hosts, out);
    return;
  }

  const props = propsText(f.memoizedProps ?? {}, isHost, pad);
  const children = childrenOf(f);

  if (depth >= maxDepth && children.length) {
    out.push(`${pad}<${name}${props}>…</${name}>`);
    return;
  }
  if (!children.length) {
    out.push(`${pad}<${name}${props} />`);
    return;
  }

  // A component whose whole body is one string reads better on one line —
  // `<Button>Continue</Button>` is how it's written in source.
  const onlyText = children.length === 1 && children[0]!.tag === 6;
  if (onlyText) {
    const text = String(children[0]!.memoizedProps ?? "").trim();
    out.push(`${pad}<${name}${props}>${text}</${name}>`);
    return;
  }

  out.push(`${pad}<${name}${props}>`);
  for (const child of children) writeFiber(child, depth + 1, maxDepth, hosts, out);
  out.push(`${pad}</${name}>`);
}

function childrenOf(f: Fiber): Fiber[] {
  const out: Fiber[] = [];
  let c = f.child;
  while (c) {
    out.push(c);
    c = c.sibling;
  }
  return out;
}

/** Serializes props the way they're written in JSX. Children are excluded —
 *  they're rendered as children — and functions collapse to `{fn}`, since the
 *  identity of a handler tells a dev nothing and its source is noise. */
function propsText(props: Record<string, unknown>, isHost: boolean, pad = ""): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || key === "key" || key === "ref") continue;
    if (isHost && NOISE_ATTRS.test(key)) continue;
    if (value === undefined || value === null || value === false) continue;
    if (value === true) {
      parts.push(key);
      continue;
    }
    if (typeof value === "string") {
      parts.push(`${key}="${value.replace(/"/g, "&quot;")}"`);
      continue;
    }
    if (typeof value === "number") {
      parts.push(`${key}={${value}}`);
      continue;
    }
    if (typeof value === "function") {
      parts.push(`${key}={fn}`);
      continue;
    }
    if (isElementLike(value)) {
      const inner = componentName((value as { type?: unknown }).type) ?? "…";
      parts.push(`${key}={<${inner} />}`);
      continue;
    }
    parts.push(`${key}={${json(value)}}`);
  }
  if (!parts.length) return "";
  // Long prop lists wrap, the way a formatter would leave them — indented to
  // the element's own depth, or the wrapped props read as a sibling node.
  const oneLine = " " + parts.join(" ");
  if (oneLine.length <= 88) return oneLine;
  const inner = `\n${pad}  `;
  return inner + parts.join(inner) + `\n${pad}`;
}

function isElementLike(v: unknown): boolean {
  return typeof v === "object" && v !== null && "$$typeof" in (v as object);
}

function json(v: unknown): string {
  try {
    const s = JSON.stringify(v, (_k, val) => (typeof val === "function" ? "fn" : val));
    if (!s) return "…";
    return s.length > 160 ? s.slice(0, 157) + "…" : s;
  } catch {
    return "…"; // cyclic (a DOM node, an event) — nothing worth printing
  }
}

// --- HTML --------------------------------------------------------------------

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** Indented outerHTML. The browser's own serializer emits one unreadable line
 *  for a whole screen, and a dev is going to read this before they paste it. */
export function elementHtml(el: Element, indent = 0): string {
  const out: string[] = [];
  writeNode(el, indent, out);
  return out.join("\n");
}

function writeNode(node: Node, depth: number, out: string[]): void {
  const pad = "  ".repeat(depth);

  if (node.nodeType === 3) {
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    if (text) out.push(pad + text);
    return;
  }
  // nodeType, not instanceof: a node from a framed document is not an
  // instance of THIS realm's Element (target.ts).
  if (!isElement(node)) return;
  if (isInstrument(node)) return;

  const tag = node.tagName.toLowerCase();
  const attrs = Array.from(node.attributes)
    .filter((a) => !NOISE_ATTRS.test(a.name))
    .map((a) => (a.value === "" ? a.name : `${a.name}="${a.value.replace(/"/g, "&quot;")}"`));
  const open = attrs.length ? `<${tag} ${attrs.join(" ")}>` : `<${tag}>`;

  if (VOID_TAGS.has(tag)) {
    out.push(pad + open.replace(/>$/, " />"));
    return;
  }
  // An <svg> is one indivisible thing to whoever is copying it; exploding its
  // paths across forty lines only makes it harder to move.
  if (tag === "svg") {
    out.push(pad + node.outerHTML);
    return;
  }

  const kids = Array.from(node.childNodes).filter((n) => n.nodeType === 1 || (n.textContent?.trim().length ?? 0) > 0);
  if (!kids.length) {
    out.push(`${pad}${open}</${tag}>`);
    return;
  }
  if (kids.length === 1 && kids[0]!.nodeType === 3) {
    out.push(`${pad}${open}${kids[0]!.textContent!.replace(/\s+/g, " ").trim()}</${tag}>`);
    return;
  }
  out.push(pad + open);
  for (const kid of kids) writeNode(kid, depth + 1, out);
  out.push(`${pad}</${tag}>`);
}

// --- CSS ---------------------------------------------------------------------

/** Every class name in a subtree, in document order, deduped. */
export function classesIn(root: Element): string[] {
  const seen = new Set<string>();
  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const c of Array.from(el.classList)) seen.add(c);
  }
  return Array.from(seen).sort();
}

/** The real declarations behind a set of class names, as a stylesheet.
 *
 *  This is the piece that makes the export usable off-stack: it turns the
 *  page's Tailwind utilities back into the CSS they compile to, including the
 *  responsive and state variants (`@media`, `:hover`) that a class list alone
 *  never shows. Custom-property definitions on `:root` come along too, since
 *  the declarations reference them. */
export function cssForClasses(classes: string[], doc: Document): string {
  const wanted = new Set(classes);
  const blocks: string[] = [];
  const seen = new Set<string>();

  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    walkRules(rules, wanted, seen, blocks, [], doc);
  }
  return blocks.join("\n\n");
}

function walkRules(
  rules: CSSRuleList,
  wanted: Set<string>,
  seen: Set<string>,
  out: string[],
  context: string[],
  doc: Document,
): void {
  for (const rule of Array.from(rules)) {
    // Realm-safe throughout: see target.ts `isInstance`.
    if (isInstance(rule, "CSSStyleRule", doc)) {
      const styleRule = rule as CSSStyleRule;
      if (!selectorTouches(styleRule.selectorText, wanted)) continue;
      const key = context.join("|") + "|" + styleRule.selectorText;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(wrap(styleRule.cssText, context));
      continue;
    }
    if (isInstance(rule, "CSSMediaRule", doc)) {
      const media = rule as CSSMediaRule;
      walkRules(media.cssRules, wanted, seen, out, [...context, `@media ${media.conditionText}`], doc);
      continue;
    }
    if (isInstance(rule, "CSSSupportsRule", doc)) {
      const sup = rule as CSSSupportsRule;
      walkRules(sup.cssRules, wanted, seen, out, [...context, `@supports ${sup.conditionText}`], doc);
      continue;
    }
    // @layer and friends are transparent for our purposes — the declarations
    // inside them are what the page paints with.
    if ("cssRules" in rule) walkRules((rule as CSSGroupingRule).cssRules, wanted, seen, out, context, doc);
  }
}

/** True when any class in the selector is one we care about. Deliberately
 *  loose: `.rounded-card:hover` and `.group:hover .text-white` both count,
 *  because both change how the copied markup looks. */
function selectorTouches(selector: string, wanted: Set<string>): boolean {
  for (const match of selector.matchAll(/\.((?:\\.|[\w-])+)/g)) {
    const cls = match[1]!.replace(/\\(.)/g, "$1");
    if (wanted.has(cls)) return true;
  }
  return false;
}

function wrap(css: string, context: string[]): string {
  let out = css;
  for (let i = context.length - 1; i >= 0; i--) {
    out = `${context[i]} {\n  ${out.replace(/\n/g, "\n  ")}\n}`;
  }
  return out;
}

/** The custom properties a stylesheet text references, as a `:root` block —
 *  without it the exported CSS is full of `var(--color-…)` that resolve to
 *  nothing. */
export function rootVarsFor(cssText: string, doc: Document): string {
  const used = new Set<string>();
  for (const m of cssText.matchAll(/var\((--[\w-]+)/g)) used.add(m[1]!);
  if (!used.size) return "";
  const root = (doc.defaultView ?? window).getComputedStyle(doc.documentElement);
  const lines: string[] = [];
  // Resolving is transitive: a token's value can itself be a var().
  const queue = Array.from(used);
  const done = new Set<string>();
  while (queue.length) {
    const name = queue.shift()!;
    if (done.has(name)) continue;
    done.add(name);
    const value = root.getPropertyValue(name).trim();
    if (!value) continue;
    lines.push(`  ${name}: ${value};`);
    for (const m of value.matchAll(/var\((--[\w-]+)/g)) queue.push(m[1]!);
  }
  return lines.length ? `:root {\n${lines.sort().join("\n")}\n}` : "";
}
