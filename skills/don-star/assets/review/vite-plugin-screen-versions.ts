// Per-route CONTENT VERSIONS — the signal the review board's preview cache
// invalidates on.
//
// The board caches a bitmap of every screen (snapshot-cache.ts). A cache is
// only useful if something can say "this screen changed"; a build id says
// EVERYTHING changed on every deploy, which is the storm again once a day.
// So: for each route in src/App.tsx, hash the transitive import closure of the
// component that renders it. Edit components/flow/checkout.tsx and only the
// screens whose closure contains it re-capture; nothing else moves.
//
// The route→component map is DERIVED from App.tsx (its imports + its <Route>
// elements), never hand-maintained — a hand-written map is one forgotten line
// away from serving a stale picture of a screen that changed.
//
// Emitted as /screen-versions.json: a build asset in prod, dev middleware
// locally (recomputed per request, so a save is picked up by the board's poll
// without a reload).
//
// Import parsing is regex, not a full parser: this is our own source, the only
// dynamic import is React.lazy, and the failure direction is safe — an
// unresolved specifier drops a file from the closure at worst, and the global
// set (App/main/index.css) below still moves every hash when the system does.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Connect, Plugin } from "vite";

export const SCREEN_VERSIONS_PATH = "/screen-versions.json";

/** Files whose change invalidates every screen: the entry, the router SHELL,
 *  and the generated token/theme layer (a palette change repaints the whole
 *  board).
 *
 *  ⚠ App.tsx is hashed through `shellText` below, NOT whole. It is the single
 *  most-edited file in the repo — 18 of 30 days in Aug 2026 carried a commit
 *  touching this set — and hashing it whole folded every route addition, import
 *  line and comment edit into EVERY screen's version. That made the preview
 *  cache miss wholesale on most days, which is the reload storm the cache
 *  exists to prevent (and, once shots are built in CI, would re-shoot all ~280
 *  of them per push). What genuinely repaints every screen is the shell around
 *  the routes — providers, ScrollToTop, FocusFirstInput — so that is what's
 *  hashed globally; the route table feeds each route's own version instead. */
const GLOBAL_FILES = ["src/main.tsx", "src/App.tsx", "src/index.css"];

const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".css", ".json", ".svg"];
const INDEXES = ["/index.ts", "/index.tsx", "/index.js"];

export type ScreenVersions = {
  generatedAt: number;
  /** Hash of the global set — the fallback version for anything unrouted. */
  global: string;
  /** Route path (as declared in App.tsx) → hash of its module closure. */
  routes: Record<string, string>;
};

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** One computation pass over the source tree. Reads are memoized within the
 *  pass and thrown away after it, so every pass sees the tree as it is now. */
class SourceGraph {
  private text = new Map<string, string>();
  private depCache = new Map<string, string[]>();
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  read(file: string): string {
    let s = this.text.get(file);
    if (s === undefined) {
      try {
        s = fs.readFileSync(file, "utf8");
      } catch {
        s = "";
      }
      this.text.set(file, s);
    }
    return s;
  }

  hash(file: string): string {
    return sha1(this.read(file));
  }

  private resolve(from: string, spec: string): string | null {
    const clean = spec.split("?")[0];
    let base: string;
    if (clean.startsWith("@/")) base = path.join(this.root, "src", clean.slice(2));
    else if (clean.startsWith("./") || clean.startsWith("../")) base = path.resolve(path.dirname(from), clean);
    else return null; // bare specifier: node_modules, not ours to hash
    for (const e of EXTS) if (isFile(base + e)) return base + e;
    for (const i of INDEXES) if (isFile(base + i)) return base + i;
    return null;
  }

  deps(file: string): string[] {
    const hit = this.depCache.get(file);
    if (hit) return hit;
    const src = this.read(file);
    const specs = new Set<string>();
    // `import … from "x"` / `export … from "x"`, `import("x")`, `import "x"`,
    // and CSS's own `@import "x"`.
    const patterns = [
      /(?:^|[\s;}])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
      /@import\s+(?:url\()?['"]([^'"]+)['"]/g,
    ];
    for (const re of patterns) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) specs.add(m[1]);
    }
    const out: string[] = [];
    for (const s of specs) {
      const r = this.resolve(file, s);
      if (r) out.push(r);
    }
    this.depCache.set(file, out);
    return out;
  }

  /** Every source file `entries` transitively pulls in, including themselves. */
  closure(entries: string[]): string[] {
    const seen = new Set<string>();
    const stack = [...entries];
    while (stack.length) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const d of this.deps(f)) if (!seen.has(d)) stack.push(d);
    }
    return [...seen].sort();
  }

  hashOf(files: string[]): string {
    return sha1(files.map((f) => `${path.relative(this.root, f)}:${this.hash(f)}`).join("\n"));
  }
}

/** Route path → the modules whose elements render it, read out of App.tsx.
 *  A `<Route>` chunk contributes every capitalized JSX tag inside it that
 *  App.tsx imports — over-inclusion (a wrapper like Suspense is simply not in
 *  the import map) only ever widens a hash, never narrows it. */
function routeModules(root: string, g: SourceGraph): Map<string, { entries: string[]; chunk: string }> {
  const appFile = path.join(root, "src/App.tsx");
  const src = g.read(appFile);
  const byName = new Map<string, string>();

  const record = (name: string, spec: string) => {
    const clean = spec.split("?")[0];
    const base = clean.startsWith("@/")
      ? path.join(root, "src", clean.slice(2))
      : path.resolve(path.dirname(appFile), clean);
    for (const e of EXTS) {
      if (isFile(base + e)) {
        byName.set(name, base + e);
        return;
      }
    }
    for (const i of INDEXES) {
      if (isFile(base + i)) {
        byName.set(name, base + i);
        return;
      }
    }
  };

  let m: RegExpExecArray | null;
  const defaultImport = /import\s+([A-Z]\w*)\s+from\s*['"]([^'"]+)['"]/g;
  while ((m = defaultImport.exec(src))) record(m[1], m[2]);
  const lazyImport = /const\s+([A-Z]\w*)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['"]([^'"]+)['"]/g;
  while ((m = lazyImport.exec(src))) record(m[1], m[2]);

  const routes = new Map<string, { entries: string[]; chunk: string }>();
  const chunks = src.split("<Route");
  for (const chunk of chunks.slice(1)) {
    const p = /path\s*=\s*"([^"]+)"/.exec(chunk);
    if (!p) continue;
    const files = new Set<string>();
    const tag = /<([A-Z]\w*)/g;
    let t: RegExpExecArray | null;
    while ((t = tag.exec(chunk))) {
      const f = byName.get(t[1]);
      if (f) files.add(f);
    }
    // Normalized, or the chunk is unstable: splitting on `<Route` leaves each
    // chunk running to the NEXT route, so the last one trails `</Routes>` and
    // the rest of the file — and adding a route silently rewrote its
    // neighbour's version. Cut at `</Routes>`, drop comments (this file carries
    // long explanatory blocks that get edited often), collapse whitespace so
    // re-indentation isn't a change. What's left is the element itself.
    const element = stripInert(chunk.split("</Routes>")[0])
      .replace(/\s+/g, " ")
      .trim();
    routes.set(p[1], { entries: [...files], chunk: element });
  }
  return routes;
}

/** Everything in a source file that can't change what a screen renders, removed
 *  before hashing: block comments, whole-line `//` comments, and blank lines.
 *
 *  Deliberately conservative on line comments — only a `//` that OPENS a line
 *  is stripped, never one mid-line, because `https://…` inside a string looks
 *  exactly like a comment to a regex. The failure direction is safe either way:
 *  an unstripped comment costs a spurious re-capture, never a stale one. */
function stripInert(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/^\s*[\r\n]/gm, "");
}

/** App.tsx minus the two things that belong to individual routes rather than to
 *  every screen: the import block (which module a route renders is already in
 *  that route's own closure) and the `<Routes>` table (adding `/foo` says
 *  nothing about `/intake`). What survives is the shell every screen really
 *  does render inside. */
function shellText(src: string): string {
  const open = src.indexOf("<Routes");
  const close = src.lastIndexOf("</Routes>");
  const withoutRoutes = open >= 0 && close > open ? src.slice(0, open) + src.slice(close + "</Routes>".length) : src;
  return stripInert(withoutRoutes)
    .replace(/^[ \t]*(?:import|export)\s[^\n]*?from\s*['"][^'"]+['"];?[ \t]*$/gm, "")
    .replace(/^[ \t]*import\s*['"][^'"]+['"];?[ \t]*$/gm, "")
    .replace(/^[ \t]*const\s+[A-Z]\w*\s*=\s*lazy\([\s\S]*?\)\)?[ \t]*$/gm, "")
    .replace(/^\s*[\r\n]/gm, "");
}

export function computeScreenVersions(root: string): ScreenVersions {
  const g = new SourceGraph(root);
  const appFile = path.join(root, "src/App.tsx");
  // File hashes only — App.tsx statically imports every page, so its *closure*
  // is the whole app and would make every route hash identical.
  const global = sha1(
    GLOBAL_FILES.map((f) => path.join(root, f))
      .filter(isFile)
      .map((f) => {
        const src = g.read(f);
        return `${path.relative(root, f)}:${sha1(f === appFile ? shellText(src) : stripInert(src))}`;
      })
      .join("\n"),
  );

  const routes: Record<string, string> = {};
  // The route's own `<Route>` chunk rides in its hash, so a prop change on the
  // element (`element={<Intake mode="x" />}`) re-captures that screen and only
  // that screen — the module closure alone can't see it.
  for (const [route, { entries, chunk }] of routeModules(root, g)) {
    routes[route] = sha1(`${global}|${sha1(chunk)}|${entries.length ? g.hashOf(g.closure(entries)) : ""}`);
  }
  return { generatedAt: Date.now(), global, routes };
}

/** Serves the manifest in dev and emits it as a build asset. */
export function screenVersionsPlugin(): Plugin {
  let root = process.cwd();
  let memo: { at: number; json: string } | null = null;

  // Recomputed per request behind a short TTL: the board polls this in dev, so
  // a save shows up within a beat, and a burst of polls costs one pass.
  const json = (ttlMs: number): string => {
    const now = Date.now();
    if (memo && now - memo.at < ttlMs) return memo.json;
    const out = JSON.stringify(computeScreenVersions(root));
    memo = { at: now, json: out };
    return out;
  };

  return {
    name: "screen-versions",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use((req: Connect.IncomingMessage, res, next) => {
        if ((req.url ?? "").split("?")[0] !== SCREEN_VERSIONS_PATH) {
          next();
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(json(1000));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: SCREEN_VERSIONS_PATH.slice(1), source: json(0) });
    },
  };
}
