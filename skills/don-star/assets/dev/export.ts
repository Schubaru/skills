// Dev mode — what leaves the browser.
//
// Two artifacts, for the two things a developer without this repo actually
// does with a screen:
//
//   page.html   ONE self-contained file. Every stylesheet inlined, every image
//               and font turned into a data: URI, every script stripped. Opens
//               offline and looks exactly like the screen it came from. This is
//               the artifact you attach to a ticket.
//
//   bundle.zip  the same page.html plus the pieces you build FROM: the JSX
//               tree, the resolved CSS, the token table as JSON, an asset
//               manifest, the icons as individual .svg files, and a README
//               that says what state the capture was taken in.
//
// The ZIP writer is the board's own (review/zip.ts) — store-only, hand-rolled,
// no dependency. Reusing it keeps one zip implementation in the repo.

import { makeZip, saveBlob, slugify, type ZipEntry } from "../review/zip";
import { isElement, isInstance, type DevTarget } from "./target";
import { formatBytes, loadedFontUrls, scanAssets, scanIcons, type AssetRow } from "./assets";
import { classesIn, cssForClasses, elementHtml, elementJsx, rootVarsFor } from "./markup";
import { readTokens, tokensUsedIn } from "./tokens";

/** Anything bigger than this stays a URL instead of becoming a data: URI. A
 *  standalone file is the point, but a 40MB one nobody can email is not. */
const INLINE_LIMIT = 4 * 1024 * 1024;

const enc = new TextEncoder();

function entry(name: string, text: string): ZipEntry {
  return { name, data: enc.encode(text) as Uint8Array<ArrayBuffer> };
}

// --- the standalone page -----------------------------------------------------

/** Builds a single HTML file that renders the current screen with no server,
 *  no build step and no network. */
export async function standaloneHtml(t: DevTarget): Promise<string> {
  const src = t.doc;
  const doc = src.documentElement.cloneNode(true) as HTMLElement;

  // Strip everything that would either fail or fight the snapshot: our own
  // overlay, the app's scripts (the DOM is already rendered — re-running React
  // over it would only blank it), and preloads pointing at a dev server.
  // `[data-rvdev-probe]` is the color probe tokens.ts appends to the page it
  // measures — our instrument, and it must not ride out in the artifact.
  for (const sel of ["#rvdev-root", "[data-rvdev-probe]", "script", "link[rel='modulepreload']", "link[rel='preload']", "link[rel='stylesheet']", "style"]) {
    for (const el of Array.from(doc.querySelectorAll(sel))) el.remove();
  }
  // The panel squeezes the page while it's open (the `rvdev-on` class and the
  // inset it sets). Both are inert once our rules are gone, but leaving them
  // on the exported <html> would have the next reader hunting a class that
  // isn't defined anywhere in the file.
  doc.classList.remove("rvdev-on");
  doc.style.removeProperty("--rvdev-inset");
  if (!doc.getAttribute("style")) doc.removeAttribute("style");
  doc.querySelector("body")?.classList.remove("rvdev-picking", "rvdev-resizing");

  const css = await inlineUrls(collectCss(src), src);
  const head = doc.querySelector("head");
  if (head) {
    const style = src.createElement("style");
    style.textContent = css;
    head.appendChild(style);
  }

  await inlineImages(doc, src);

  return [
    "<!doctype html>",
    `<!-- ${src.location.href}`,
    `     Captured ${new Date().toISOString()} — __DS_PROJECT_NAME__ prototype, dev mode.`,
    "     Static snapshot: styles, images and fonts are inlined; scripts are removed,",
    "     so nothing here is interactive. -->",
    doc.outerHTML,
    "",
  ].join("\n");
}

/** Every same-origin rule the page is styled by, as one stylesheet. Reads
 *  cssRules rather than re-fetching, so Tailwind's dev-time injected styles
 *  are included on the same footing as a built stylesheet. */
function collectCss(doc: Document): string {
  const out: string[] = [];
  const fonts = loadedFontUrls(doc);
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        // Our own panel's rules would ship inside the snapshot. Every one of
        // them is namespaced `rvdev`, which is also why that prefix exists.
        if (rule.cssText.includes("rvdev")) continue;
        // @fontsource declares two dozen subsets per family and the page
        // renders in four of them. Inlining the rest is a megabyte of Cyrillic
        // nobody asked for, so unused faces are dropped, not just left linked.
        if (isInstance(rule, "CSSFontFaceRule", doc) && !usesLoadedFont(rule as CSSFontFaceRule, fonts)) continue;
        out.push(rule.cssText);
      }
    } catch {
      // Cross-origin: keep it as a link so the file at least degrades to the
      // hosted version rather than silently losing the rules.
      if (sheet.href) out.push(`@import url("${sheet.href}");`);
    }
  }
  return out.join("\n");
}

function usesLoadedFont(rule: CSSFontFaceRule, loaded: Set<string>): boolean {
  const base = rule.parentStyleSheet?.href ?? location.href;
  for (const m of rule.style.getPropertyValue("src").matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    try {
      if (loaded.has(new URL(m[1]!, base).href)) return true;
    } catch {
      /* unparseable url — treat the face as unused */
    }
  }
  return false;
}

/** Turns `url(/foo.woff2)` inside CSS into data: URIs — mainly the self-hosted
 *  Manrope faces, without which the snapshot renders in Times. */
async function inlineUrls(css: string, doc: Document): Promise<string> {
  const urls = new Set<string>();
  for (const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
    const raw = m[1]!;
    if (!raw.startsWith("data:")) urls.add(raw);
  }
  const map = new Map<string, string>();
  await Promise.all(
    Array.from(urls).map(async (u) => {
      const data = await toDataUri(u, doc);
      if (data) map.set(u, data);
    }),
  );
  return css.replace(/url\(["']?([^"')]+)["']?\)/g, (whole, raw: string) => {
    const hit = map.get(raw);
    return hit ? `url("${hit}")` : whole;
  });
}

async function inlineImages(doc: HTMLElement, src: Document): Promise<void> {
  const live = Array.from(src.querySelectorAll("img"));
  const clones = Array.from(doc.querySelectorAll("img"));
  await Promise.all(
    clones.map(async (img, i) => {
      // currentSrc off the LIVE node: it's the src the browser actually chose
      // out of a srcset, which the clone doesn't know.
      const url = live[i]?.currentSrc || img.getAttribute("src") || "";
      if (!url || url.startsWith("data:")) return;
      const data = await toDataUri(url, src);
      if (data) {
        img.setAttribute("src", data);
        img.removeAttribute("srcset"); // would override the src we just inlined
      } else {
        img.setAttribute("src", new URL(url, src.baseURI).href);
      }
    }),
  );

  // Inline background images too — the portal's hero art is painted this way.
  const liveAll = [src.documentElement, ...Array.from(src.querySelectorAll("*"))];
  const cloneAll = [doc, ...Array.from(doc.querySelectorAll("*"))];
  await Promise.all(
    cloneAll.map(async (el, i) => {
      const source = liveAll[i];
      if (!source || !isElement(el) || !("style" in el)) return;
      const bg = (src.defaultView ?? window).getComputedStyle(source).backgroundImage;
      if (!bg || bg === "none" || !bg.includes("url(")) return;
      const replaced = await inlineUrls(bg, src);
      if (replaced !== bg) (el as HTMLElement).style.backgroundImage = replaced;
    }),
  );
}

const dataUriCache = new Map<string, string | null>();

async function toDataUri(url: string, doc: Document): Promise<string | null> {
  const abs = (() => {
    try {
      return new URL(url, doc.baseURI).href;
    } catch {
      return null;
    }
  })();
  if (!abs) return null;
  if (dataUriCache.has(abs)) return dataUriCache.get(abs)!;

  let result: string | null = null;
  try {
    const res = await fetch(abs);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size <= INLINE_LIMIT) result = await blobToDataUri(blob);
    }
  } catch {
    result = null; // cross-origin or offline: caller keeps the absolute URL
  }
  dataUriCache.set(abs, result);
  return result;
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// --- the bundle --------------------------------------------------------------

/** Everything about the current screen (or the selected element), as a ZIP.
 *  `target` is the selection when there is one, the app root otherwise.
 *
 */
export async function exportBundle(t: DevTarget, target: Element, label: string): Promise<void> {
  const doc = t.doc;
  const wholePage = target === (doc.getElementById("root")?.firstElementChild ?? doc.body);
  const classes = classesIn(target);
  const css = cssForClasses(classes, doc);
  const vars = rootVarsFor(css, doc);
  const assets = scanAssets(target);
  const icons = scanIcons(target);
  const used = tokensUsedIn(target);

  const entries: ZipEntry[] = [
    entry("page.html", await standaloneHtml(t)),
    entry("component.jsx", elementJsx(target, { maxDepth: 8 })),
    entry("markup.html", elementHtml(target)),
    entry("styles.css", [vars, css].filter(Boolean).join("\n\n")),
    entry(
      "tokens.json",
      JSON.stringify(
        {
          usedOnThisScreen: used.map((u) => ({ name: u.token.name, value: u.token.value, uses: u.count })),
          all: readTokens(doc).map((tk) => ({ name: tk.name, value: tk.value, group: tk.group })),
        },
        null,
        2,
      ),
    ),
    entry("assets.json", JSON.stringify(assets, null, 2)),
    entry("README.md", readme(t, target, label, wholePage, assets, icons.length)),
  ];

  for (const icon of icons) entries.push(entry(`icons/${slugify(icon.name)}.svg`, icon.svg));

  // The real bytes of every image, so the bundle is a handoff and not a list
  // of links into a preview site the recipient may not be able to reach.
  await Promise.all(
    assets
      .filter((a) => a.kind === "image" || a.kind === "font")
      .map(async (a) => {
        try {
          const res = await fetch(a.url);
          if (!res.ok) return;
          const buf = new Uint8Array(await res.arrayBuffer()) as Uint8Array<ArrayBuffer>;
          const name = new URL(a.url).pathname.split("/").filter(Boolean).join("_") || "asset";
          entries.push({ name: `assets/${name}`, data: buf });
        } catch {
          /* unreachable asset: assets.json still records the URL */
        }
      }),
  );

  saveBlob(makeZip(entries), `${slugify(label) || "screen"}-dev.zip`);
}

function readme(t: DevTarget, target: Element, label: string, wholePage: boolean, assets: AssetRow[], icons: number): string {
  const assetLines = assets
    .map((a) => `| ${a.kind} | \`${short(a.url)}\` | ${a.size} | ${a.rendered} | ${formatBytes(a.bytes)} |`)
    .join("\n");
  const view = t.win;
  return `# ${label}

Exported from the __DS_PROJECT_NAME__ prototype on ${new Date().toISOString()}.

**Source URL** — \`${t.doc.location.href}\`
**Scope** — ${wholePage ? "the whole screen" : `the selected element and its subtree (\`${target.tagName.toLowerCase()}\`)`}
**Viewport** — ${view.innerWidth}×${view.innerHeight} CSS px, DPR ${view.devicePixelRatio}

The prototype is a Vite + React 19 + Tailwind v4 app. Nothing here needs it:
every file below is readable on its own.

| file | what it is |
| --- | --- |
| \`page.html\` | The whole screen as ONE self-contained file — styles, fonts and images inlined, scripts removed. Open it in any browser; it renders offline but is not interactive. |
| \`component.jsx\` | The React component tree as it rendered, with real prop values. This is the structure to rebuild from — it is a record of the running page, not a copy of a source file, so mapped lists appear expanded. |
| \`markup.html\` | The rendered DOM, indented. Use this if you are not on React. |
| \`styles.css\` | The CSS the Tailwind classes on this screen compile to, including \`@media\` and state variants, plus the \`:root\` custom properties they reference. |
| \`tokens.json\` | The design tokens. \`usedOnThisScreen\` is the shortlist; \`all\` is the full palette. Names match \`DESIGN.md\`, the single source of truth for the theme. |
| \`assets.json\` | Every image, font and video the screen loads, with intrinsic and rendered sizes. |
| \`assets/\` | The actual bytes of those files (${assets.length} found). |
| \`icons/\` | Each icon on screen as a standalone \`.svg\` (${icons} found), named the way the design system knows it. |

## Assets on this screen

| kind | url | intrinsic | rendered | bytes |
| --- | --- | --- | --- | --- |
${assetLines || "| — | — | — | — | — |"}

## Notes

- Colors, radii, shadows and type are all tokens. Prefer the token name over
  the literal value — the palette is generated from \`DESIGN.md\`, so values
  move and names don't.
- \`page.html\` is a snapshot of one state. Interactive states (open sheets,
  later steps in a flow) are separate URLs — walk the screen to the state you
  want and export again.
`;
}

function short(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
