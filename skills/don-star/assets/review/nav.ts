// Board location ↔ URL, and in-frame navigation → screen matching.
//
// Two jobs, one vocabulary:
//  · The host URL carries where-you-are (`?page=…&view=slides&screen=…`) so any
//    board position is shareable and reload-safe — extending the `?page=` /
//    `?thread=` grammar the copy-link deep link already speaks.
//  · The slides stage reports the route the reviewer navigates to INSIDE a
//    live frame (see the bridge in frame.tsx); matching that route back to a
//    screen is how the sidebar follows a walk through the app.

import type { ReviewProject } from "./model";

export type BoardMode = "canvas" | "slides" | "flow";

/** What the URL says about where to be. Fields are absent when the URL doesn't
 *  say (fall back to stored state at boot; `mode` absent means canvas after a
 *  popstate, since slides always writes `view=slides`). */
export type BoardLocation = {
  pageId?: string;
  mode?: BoardMode;
  screenId?: string;
};

/** Query params that personalize a route without changing which screen it is
 *  (`/firstrun/mid?s=arrival&fn=Jane` greets by name) — invisible to matching,
 *  so a walk arriving with the reviewer's own typed name still matches the
 *  board's `fn=Jane` frame. */
const COSMETIC_PARAMS = ["fn"];

function splitUrl(url: string): { path: string; params: URLSearchParams } {
  // The hash never participates (it carries the frame seed, a host-side detail).
  const pathAndQuery = url.split("#")[0]!;
  const qi = pathAndQuery.indexOf("?");
  const path = qi === -1 ? pathAndQuery : pathAndQuery.slice(0, qi);
  const params = new URLSearchParams(qi === -1 ? "" : pathAndQuery.slice(qi + 1));
  for (const p of COSMETIC_PARAMS) params.delete(p);
  return { path, params };
}

export type RouteHit = { screenId: string; pageId: string };
type RouteCandidate = RouteHit & { params: [string, string][] };

/** path → every url-sourced screen on that path, with the (non-cosmetic)
 *  params its src declares. Seeded siblings (the `/intake` question frames)
 *  share identical entries on purpose — that ambiguity is what makes
 *  matchScreenForUrl stay put instead of guessing. */
export function buildRouteIndex(project: ReviewProject): Map<string, RouteCandidate[]> {
  const index = new Map<string, RouteCandidate[]>();
  for (const page of project.pages) {
    for (const flow of page.flows) {
      for (const screen of flow.screens) {
        if (screen.source.kind !== "url") continue;
        const { path, params } = splitUrl(screen.source.src);
        const hits = index.get(path) ?? [];
        hits.push({ screenId: screen.id, pageId: page.id, params: [...params.entries()] });
        index.set(path, hits);
      }
    }
  }
  return index;
}

/**
 * The screen a live frame's route belongs to, or null to stay put.
 *
 * A screen is viable when every param its src declares appears in the live URL
 * with the same value — SUBSET matching, because the app threads incidental
 * data params through navigation (`?email=`, `?fn=`) that no screen declares
 * and no reviewer should be stranded by. Among viable screens: the current
 * page's win over other pages' (a unique match elsewhere moves the board
 * there — the reviewer, 2026-07-29), then the most-specific (most declared params)
 * wins. Anything still tied is ambiguous (the seeded `/intake` questions) and
 * anything with no match is off-board — both return null: don't guess.
 */
export function matchScreenForUrl(
  index: Map<string, RouteCandidate[]>,
  url: string,
  currentPageId: string,
): RouteHit | null {
  const { path, params } = splitUrl(url);
  const hits = index.get(path);
  if (!hits) return null;
  const viable = hits.filter((h) => h.params.every(([k, v]) => params.get(k) === v));
  if (viable.length === 0) return null;
  const scoped = viable.filter((h) => h.pageId === currentPageId);
  const pool = scoped.length > 0 ? scoped : viable;
  const best = Math.max(...pool.map((h) => h.params.length));
  const top = pool.filter((h) => h.params.length === best);
  return top.length === 1 ? { screenId: top[0]!.screenId, pageId: top[0]!.pageId } : null;
}

/** Parse `?page`/`?view`/`?screen` into a validated board location. A valid
 *  screen is authoritative for its page — it knows where it lives, so a stale
 *  or missing `page` param can't strand it. */
export function parseBoardLocation(project: ReviewProject, search: string): BoardLocation {
  const params = new URLSearchParams(search);
  const loc: BoardLocation = {};
  const page = params.get("page");
  if (page && project.pages.some((p) => p.id === page)) loc.pageId = page;
  if (params.get("view") === "slides") loc.mode = "slides";
  if (params.get("view") === "flow") loc.mode = "flow";
  const screen = params.get("screen");
  if (screen) {
    for (const p of project.pages) {
      for (const f of p.flows) {
        if (f.screens.some((s) => s.id === screen)) {
          loc.screenId = screen;
          loc.pageId = p.id;
        }
      }
    }
  }
  return loc;
}
