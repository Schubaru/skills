// Dev mode — the resources a screen actually loads.
//
// "Resources" was first on the reviewer's list, and it's the part a screenshot can
// never carry: which images, at what intrinsic size, from what path, weighing
// what. A developer rebuilding a screen needs the file, not a picture of it,
// so every row here is a real URL they can open, and the export writes the
// bytes into the bundle.
//
// Sizes come from the Resource Timing API rather than a HEAD request: the
// browser already fetched these, and `encodedBodySize` is the number that was
// actually on the wire. When the browser won't say — a 304, a buffer eviction
// — the row reports nothing rather than a number that is really the size of
// a response header.

import { iconOf, type IconFact } from "./inspect";
import { isInstance } from "./target";

export type AssetRow = {
  kind: "image" | "font" | "video" | "style" | "other";
  url: string;
  /** How the page pulls it in: `<img>`, `background-image`, `@font-face`. */
  via: string;
  /** Bytes over the wire, when the browser will tell us. */
  bytes: number | null;
  /** `1920×1080`, or the rendered box for something with no intrinsic size. */
  size: string;
  /** For images: the box it's actually drawn in, which is how you catch a
   *  1920px hero rendered at 375. */
  rendered: string;
};

export function scanAssets(root: Element): AssetRow[] {
  const doc = root.ownerDocument;
  const view = doc.defaultView ?? window;
  const timing = resourceBytes(view);
  const rows = new Map<string, AssetRow>();
  const add = (row: AssetRow) => {
    if (!row.url || row.url.startsWith("data:")) return;
    if (!rows.has(row.url)) rows.set(row.url, row);
  };

  for (const img of Array.from(root.querySelectorAll("img"))) {
    add({
      kind: "image",
      url: img.currentSrc || img.src,
      via: "<img>",
      bytes: timing.get(key(img.currentSrc || img.src, doc)) ?? null,
      size: img.naturalWidth ? `${img.naturalWidth}×${img.naturalHeight}` : "—",
      rendered: `${Math.round(img.clientWidth)}×${Math.round(img.clientHeight)}`,
    });
  }

  for (const el of [root, ...Array.from(root.querySelectorAll("*"))]) {
    const bg = view.getComputedStyle(el).backgroundImage;
    if (!bg || bg === "none") continue;
    for (const m of bg.matchAll(/url\(["']?(.*?)["']?\)/g)) {
      const url = absolute(m[1]!, doc);
      add({
        kind: "image",
        url,
        via: "background-image",
        bytes: timing.get(key(url, doc)) ?? null,
        size: "—",
        rendered: `${Math.round(el.clientWidth)}×${Math.round(el.clientHeight)}`,
      });
    }
  }

  for (const v of Array.from(root.querySelectorAll("video, source"))) {
    const url = (v as HTMLVideoElement | HTMLSourceElement).src;
    if (url) add({ kind: "video", url, via: `<${v.tagName.toLowerCase()}>`, bytes: timing.get(key(url, doc)) ?? null, size: "—", rendered: "—" });
  }

  // Fonts don't live in the DOM — they're @font-face rules. Read them out of
  // the stylesheets rather than out of Resource Timing: the dev server serves
  // every module as its own request, which overflows the 250-entry timing
  // buffer and evicts exactly the early font loads we're looking for.
  for (const face of fontFaces(doc)) {
    add({ kind: "font", url: face.url, via: `@font-face ${face.family} ${face.weight}`.trim(), bytes: timing.get(key(face.url, doc)) ?? null, size: "—", rendered: "—" });
  }

  return Array.from(rows.values()).sort((a, b) => a.kind.localeCompare(b.kind) || (b.bytes ?? 0) - (a.bytes ?? 0));
}

function resourceBytes(view: Window): Map<string, number> {
  const out = new Map<string, number>();
  try {
    for (const e of view.performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
      // transferSize is deliberately NOT a fallback: on a 304 it's just the
      // response headers (~300 bytes), and printing that next to a 1530px hero
      // would be a confident lie about the file's weight. Unknown is honest.
      const bytes = e.encodedBodySize || e.decodedBodySize;
      if (!bytes) continue;
      const k = key(e.name, view.document);
      // Keyed without the query string: the dev server appends `?import` to
      // asset URLs, so the timing entry and the DOM's src never match raw.
      if (!out.has(k) || out.get(k)! < bytes) out.set(k, bytes);
    }
  } catch {
    /* Resource Timing unavailable — rows just report no size */
  }
  return out;
}

/** URL identity for size lookups: no query, no hash. */
function key(url: string, doc: Document): string {
  try {
    const u = new URL(url, doc.baseURI);
    return u.origin + u.pathname;
  } catch {
    return url.split("?")[0]!;
  }
}

type FaceRow = { url: string; family: string; weight: string };

/** The font files this screen is actually rendering in.
 *
 *  ⚠ Not every @font-face in the stylesheets: @fontsource declares ~24 of them
 *  per family (one per unicode subset, times two formats), and listing the
 *  Cyrillic and Vietnamese cuts of a screen written in English buries the
 *  images under noise. `document.fonts` reports `status: "loaded"` only for
 *  the subsets the browser actually pulled, so that set is the answer — the
 *  CSS rules are only consulted to recover each one's URL. */
function fontFaces(doc: Document): FaceRow[] {
  const declared = new Map<string, FaceRow>();
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      // Realm-safe: see target.ts `isInstance`. A bare instanceof here reports
      // "no fonts" for every framed document.
      if (!isInstance(rule, "CSSFontFaceRule", doc)) continue;
      const face = rule as CSSFontFaceRule;
      // First url() only: a face lists woff2 then woff, and the browser takes
      // the first it supports. Listing both would double every row.
      const url = face.style.getPropertyValue("src").match(/url\(["']?([^"')]+)["']?\)/)?.[1];
      if (!url) continue;
      const family = face.style.getPropertyValue("font-family").replace(/["']/g, "");
      const weight = face.style.getPropertyValue("font-weight");
      declared.set(faceKey(family, weight, face.style.getPropertyValue("unicode-range")), {
        url: absolute(url, doc),
        family,
        weight,
      });
    }
  }

  const out: FaceRow[] = [];
  const seen = new Set<string>();
  for (const face of Array.from(doc.fonts)) {
    if (face.status !== "loaded") continue;
    const hit = declared.get(faceKey(face.family.replace(/["']/g, ""), face.weight, face.unicodeRange));
    if (!hit || seen.has(hit.url)) continue;
    seen.add(hit.url);
    out.push(hit);
  }
  // A page whose fonts all came from the OS (or a browser that reports
  // nothing) still gets the declared list rather than an empty section.
  return out.length ? out : Array.from(declared.values()).slice(0, 12);
}

/** The font files the page actually rendered with — the export inlines these
 *  and drops the rest, which is the difference between a 200KB snapshot and a
 *  1.2MB one carrying every Cyrillic and Vietnamese cut of Manrope. */
export function loadedFontUrls(doc: Document): Set<string> {
  return new Set(fontFaces(doc).map((f) => f.url));
}

function faceKey(family: string, weight: string, unicodeRange: string): string {
  return `${family.toLowerCase()}|${weight}|${unicodeRange.replace(/\s+/g, "")}`;
}

function absolute(url: string, doc: Document): string {
  try {
    return new URL(url, doc.baseURI).href;
  } catch {
    return url;
  }
}

// --- icons -------------------------------------------------------------------

export type IconRow = IconFact & { count: number };

/** Every icon on the screen, named and deduped. Because the consuming dev may
 *  have neither our design system nor lucide, each row carries its rendered
 *  SVG — the export writes one .svg file per icon. */
export function scanIcons(root: Element): IconRow[] {
  const rows = new Map<string, IconRow>();
  for (const svg of Array.from(root.querySelectorAll("svg"))) {
    const fact = iconOf(svg);
    if (!fact) continue;
    const id = `${fact.source}:${fact.name}`;
    const hit = rows.get(id);
    if (hit) hit.count++;
    else rows.set(id, { ...fact, count: 1 });
  }
  return Array.from(rows.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function formatBytes(n: number | null): string {
  if (n === null || n === 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} KB`;
  return `${Math.round(n / 104857.6) / 10} MB`;
}
