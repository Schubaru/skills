// Client half of the per-route content versions (see
// vite-plugin-screen-versions.ts for how the manifest is built).
//
// A cached preview is only reusable while the code that renders it is
// unchanged, so every cache entry carries the route hash it was captured at.
// In dev the manifest is polled, so saving a component invalidates exactly the
// screens that render it — the canvas re-captures those and leaves the rest.

const MANIFEST_URL = "/screen-versions.json";
const POLL_MS = 4000;

export type ScreenVersions = {
  generatedAt: number;
  global: string;
  routes: Record<string, string>;
};

type Matcher = { re: RegExp; path: string; specificity: number };

let manifest: ScreenVersions | null = null;
let matchers: Matcher[] = [];
const listeners = new Set<() => void>();

function compile(m: ScreenVersions): Matcher[] {
  return Object.keys(m.routes)
    .map((p) => ({
      path: p,
      // `:param` and `*` are the only dynamic forms the router uses here.
      re: new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:\w+/g, "[^/]+").replace(/\*/g, ".*")}/?$`),
      // Literal length ranks a specific route above the prefix it extends.
      specificity: p.replace(/:\w+/g, "").length,
    }))
    .sort((a, b) => b.specificity - a.specificity);
}

function apply(next: ScreenVersions): boolean {
  const changed = !manifest || manifest.global !== next.global || JSON.stringify(manifest.routes) !== JSON.stringify(next.routes);
  manifest = next;
  matchers = compile(next);
  return changed;
}

async function fetchManifest(): Promise<ScreenVersions> {
  const res = await fetch(MANIFEST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`screen-versions ${res.status}`);
  const json = (await res.json()) as ScreenVersions;
  if (!json || typeof json.global !== "string" || !json.routes) throw new Error("screen-versions: malformed");
  return json;
}

let loaded: Promise<boolean> | null = null;

/** Loads the manifest once. Resolves false when it can't be reached — the
 *  caller then runs without persistence rather than trusting bitmaps it has no
 *  way to invalidate. */
export function loadScreenVersions(): Promise<boolean> {
  loaded ??= fetchManifest().then(
    (m) => {
      apply(m);
      if (import.meta.env.DEV) startPolling();
      return true;
    },
    () => false,
  );
  return loaded;
}

let polling = false;
function startPolling(): void {
  if (polling) return;
  polling = true;
  window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    void fetchManifest().then(
      (m) => {
        if (apply(m)) for (const l of listeners) l();
      },
      () => {},
    );
  }, POLL_MS);
}

/** The version of the route a frame's src lands on. Null until the manifest is
 *  loaded (or when it couldn't be). */
export function versionFor(liveSrc: string): string | null {
  if (!manifest) return null;
  const pathname = liveSrc.split("#")[0].split("?")[0] || "/";
  for (const m of matchers) if (m.re.test(pathname)) return manifest.routes[m.path];
  return manifest.global;
}

/** Fires when a dev poll finds new hashes. */
export function subscribeVersions(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
