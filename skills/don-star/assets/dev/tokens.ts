// Dev mode — the design tokens, read off the running page.
//
// DESIGN.md is the source of truth for the palette and `npm run tokens`
// generates the `@theme` block in index.css from it (CLAUDE.md, design-system
// rule 2). A developer without this repo has neither file, so this module
// recovers the same table from the stylesheets the browser actually loaded,
// and — the part that matters — maps VALUES BACK TO NAMES. A panel that says
// `background: rgb(28, 30, 66)` has told a dev nothing they can act on;
// `--color-midnight-800` is the thing they put in their own theme.
//
// Two sources, unioned, because neither is complete on its own:
//   1. Parsing `:root` rules out of same-origin stylesheets — gives the names
//      in authored order, which is how DESIGN.md groups them.
//   2. Enumerating the computed style of <html> — catches anything injected
//      at runtime that never landed in a parsable rule.
// Values are always RESOLVED through getComputedStyle, so a token defined as
// `var(--color-midnight-800)` reports the hex, not the indirection.

import { isInstance } from "./target";

export type Token = {
  /** `--color-midnight-800` */
  name: string;
  /** As resolved by the browser: `#1c1e42`. */
  value: string;
  /** Colors normalized to `rgb(…)` for value→name lookup; empty for non-colors. */
  rgb: string;
  /** Lengths normalized to px, for the same reason. ⚠ Load-bearing: tokens are
   *  authored in rem (`--radius-card: 1.5rem`) but computed styles report px
   *  (`24px`), so without this every length token silently fails to match. */
  px: string;
  /** `color`, `shadow`, `radius`, `font`, `other` — the panel's grouping. */
  group: TokenGroup;
};

export type TokenGroup = "color" | "shadow" | "radius" | "font" | "spacing" | "other";

// Cached per document: the table is stable for the life of a page, and
// building it walks every stylesheet. Keyed by document because the board
// inspects OTHER documents — one shared cache would hand the app's panel the
// board's own tokens.
const cache = new WeakMap<Document, Token[]>();

/** Every custom property on :root, resolved. */
export function readTokens(doc: Document): Token[] {
  const hit = cache.get(doc);
  if (hit) return hit;
  const names = new Set<string>();

  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin sheet — nothing readable, and nothing of ours
    }
    collectNames(rules, names, doc);
  }

  // Chrome exposes custom properties as enumerable entries on the computed
  // style; other engines don't, which is why this is the second source and
  // not the only one.
  const view = doc.defaultView ?? window;
  const rootStyle = view.getComputedStyle(doc.documentElement);
  for (let i = 0; i < rootStyle.length; i++) {
    const prop = rootStyle[i];
    if (prop?.startsWith("--")) names.add(prop);
  }

  const out = Array.from(names)
    .map((name) => {
      const value = rootStyle.getPropertyValue(name).trim();
      return { name, value, rgb: normalizeColor(value, doc), px: normalizeLength(value, doc), group: groupOf(name, value, doc) };
    })
    .filter((t) => t.value !== "")
    .sort((a, b) => a.name.localeCompare(b.name));
  cache.set(doc, out);
  return out;
}

function collectNames(rules: CSSRuleList, into: Set<string>, doc: Document): void {
  for (const rule of Array.from(rules)) {
    // Realm-safe: see target.ts `isInstance`.
    if (isInstance(rule, "CSSStyleRule", doc)) {
      const styleRule = rule as CSSStyleRule;
      // `@theme static` compiles to plain `:root` declarations, so this catches
      // the generated palette as well as the hand-authored semantic layer.
      if (!styleRule.selectorText.includes(":root") && styleRule.selectorText !== "html") continue;
      for (let i = 0; i < styleRule.style.length; i++) {
        const prop = styleRule.style[i];
        if (prop?.startsWith("--")) into.add(prop);
      }
    } else if ("cssRules" in rule) {
      // @media / @supports / @layer — Tailwind v4 nests a lot inside @layer.
      collectNames((rule as CSSGroupingRule).cssRules, into, doc);
    }
  }
}

// --- value → token -----------------------------------------------------------

const probes = new WeakMap<Document, HTMLElement>();

/** Normalizes any color notation to the browser's own `rgb(…)` form, so a hex
 *  token and a computed style can be compared. Non-colors return "".
 *
 *  The probe lives in the document being measured: `color-mix()` and `oklch()`
 *  resolve against that document's own color space and custom properties. */
function probeFor(doc: Document): HTMLElement | null {
  let probe = probes.get(doc);
  if (!probe || !probe.isConnected) {
    if (!doc.body) return null;
    probe = doc.createElement("span");
    probe.style.display = "none";
    probe.style.position = "absolute";
    // Marked so the standalone export can drop it — it is our instrument, not
    // part of the page.
    probe.setAttribute("data-rvdev-probe", "");
    doc.body.appendChild(probe);
    probes.set(doc, probe);
  }
  return probe;
}

export function normalizeColor(value: string, doc: Document): string {
  if (!value) return "";
  const probe = probeFor(doc);
  if (!probe) return "";
  probe.style.color = "";
  probe.style.color = value;
  // An invalid color leaves the property empty — that's the "not a color" test.
  return probe.style.color ? (doc.defaultView ?? window).getComputedStyle(probe).color : "";
}

/** Resolves any CSS length to px through the browser, so rem/em/calc() all
 *  land in the same unit the computed styles we compare against use. Returns
 *  "" for anything that isn't a length. */
export function normalizeLength(value: string, doc: Document): string {
  const v = value.trim();
  if (!v || !/^[\d.+-]|^calc\(/.test(v)) return "";
  const probe = probeFor(doc);
  if (!probe) return "";
  probe.style.width = "";
  probe.style.width = v;
  if (!probe.style.width) return "";
  const px = (doc.defaultView ?? window).getComputedStyle(probe).width;
  return px && px !== "auto" ? px : "";
}

const byValueCache = new WeakMap<Document, Map<string, Token[]>>();

/** Every token that resolves to this value. Plural on purpose: the semantic
 *  layer aliases the palette (`--primary` → `--color-midnight-800`), and a dev
 *  wants to see the alias, not just the raw step. */
export function tokensFor(value: string, doc: Document): Token[] {
  let byValue = byValueCache.get(doc);
  if (!byValue) {
    byValue = new Map();
    for (const t of readTokens(doc)) {
      // Every form the same token can be written in: as authored, as a color,
      // as a px length. A computed style may match any of the three.
      for (const key of new Set([t.value.trim(), t.rgb, t.px])) {
        if (!key || isTrivial(key)) continue;
        const list = byValue.get(key);
        if (list) list.push(t);
        else byValue.set(key, [t]);
      }
    }
    byValueCache.set(doc, byValue);
  }
  const direct = byValue.get(value.trim());
  if (direct) return direct;
  const rgb = normalizeColor(value, doc);
  if (rgb && byValue.has(rgb)) return byValue.get(rgb)!;
  const px = normalizeLength(value, doc);
  return (px && byValue.get(px)) || [];
}

/** The single best name for a value: prefer the semantic alias a dev would
 *  write (`--primary`) over the raw palette step it points at.
 *
 *  ⚠ `group` is not optional in practice — pass it for anything but a color.
 *  Lengths collide constantly across categories: a 24px border-radius matches
 *  `--blur-xl` (also 24px), and naming that as the token behind the corner is
 *  a confident wrong answer in a panel whose entire value is being right.
 *  `property` does the same job for colors — see below. */
export function tokenLabel(value: string, doc: Document, group?: TokenGroup, property?: string): string | null {
  let hits = tokensFor(value, doc).filter((t) => !group || t.group === group);
  if (!hits.length) return null;

  // ⚠ Drop names that CONTRADICT the property they'd be explaining. White text
  // resolves to the same rgb as the `--background` token, and reporting a text
  // colour as "--background" is a confident wrong answer — the exact failure
  // this panel exists to avoid. Filtering by contradiction (rather than
  // guessing the right alias) removes the lie without inventing a truth.
  if (property) {
    const wantsForeground = /(^|-)color$|text|foreground|border|outline|shadow/.test(property);
    const contradicts = wantsForeground
      ? /background|(^|-)card$/
      : /foreground/;
    const sane = hits.filter((t) => !contradicts.test(t.name));
    if (sane.length) hits = sane;
  }

  // Prefer the semantic alias a dev would write (`--primary`) over the raw
  // palette step it points at.
  const semantic = hits.find((t) => !t.name.startsWith("--color-"));
  return (semantic ?? hits[0]!).name;
}

// --- which of them this page actually uses -----------------------------------

/** Scans the rendered page and returns the tokens it paints with, most-used
 *  first. This is the shortlist a dev needs to reproduce THIS screen — the
 *  full table is ~200 entries, most of which the screen never touches. */
export function tokensUsedIn(root: Element): { token: Token; count: number }[] {
  const doc = root.ownerDocument;
  const view = doc.defaultView ?? window;
  const counts = new Map<string, number>();
  const all = readTokens(doc);
  const index = new Map<string, Token>();
  for (const t of all) {
    for (const key of new Set([t.rgb, t.px, t.value.trim()])) {
      // First writer wins so the palette step, not a late alias, owns the key —
      // then tokenLabel() decides how it's displayed.
      if (key && !isTrivial(key) && !index.has(key)) index.set(key, t);
    }
  }

  const bump = (value: string) => {
    if (!value) return;
    const key = normalizeColor(value, doc) || value.trim();
    const t = index.get(key);
    if (t) counts.set(t.name, (counts.get(t.name) ?? 0) + 1);
  };

  const els = [root, ...Array.from(root.querySelectorAll("*"))];
  for (const el of els) {
    const cs = view.getComputedStyle(el);
    bump(cs.color);
    bump(cs.backgroundColor);
    bump(cs.borderTopColor);
    bump(cs.borderRadius);
    bump(cs.boxShadow);
    bump(cs.fontFamily);
  }

  const byName = new Map(all.map((t) => [t.name, t]));
  return Array.from(counts.entries())
    .map(([name, count]) => ({ token: byName.get(name)!, count }))
    .filter((r) => r.token)
    .sort((a, b) => b.count - a.count);
}

/** A token whose value is `0`, `1` or `none` is not the explanation for an
 *  element's `border-radius: 0` — dozens of unrelated internals share those
 *  values, and naming one of them is a confident wrong answer. */
function isTrivial(value: string): boolean {
  const v = value.trim();
  return v === "" || v === "none" || v === "normal" || v === "auto" || /^0(?:px|rem|%)?$/.test(v) || /^-?\d+(?:\.\d+)?$/.test(v);
}

function groupOf(name: string, value: string, doc: Document): TokenGroup {
  if (name.startsWith("--color-") || normalizeColor(value, doc)) return "color";
  if (name.includes("shadow")) return "shadow";
  if (name.includes("radius")) return "radius";
  if (name.includes("font") || name.includes("text-")) return "font";
  if (name.includes("spacing") || /^--(?:space|gap)/.test(name)) return "spacing";
  return "other";
}
