// Snapshot persistence for the review board. In dev, edits auto-write to the
// committed snapshot JSON via the vite plugin (resolved threads stay in the
// file — resolve is not delete). The manual export/import helpers that lived
// here were removed 2026-07-30 with the board-menu trim — see git history.

import type { ReviewSnapshot } from "./model";

// Resolved against the host's base so it works both at "/" (plain host) and
// under "/__review/" (host with the app proxy on the rest of the origin).
export const DEV_SNAPSHOT_ENDPOINT = `${(import.meta.env.BASE_URL ?? "/").replace(/\/$/, "")}/__dev/review-snapshot`;

/** The the partner board's file, from before there was more than one project. Kept
 *  under its original name: it is committed, deep-linked from the docs, and
 *  read by the triage Edge Function. */
export const DEFAULT_SNAPSHOT_FILENAME = "review-board.json";

/** One file per project (2026-08-13). Both ends of the autosave — this and the
 *  vite plugin — derive the name the same way, so a second board can never
 *  overwrite the first's. */
export function snapshotFilename(slug: string): string {
  return slug === "__DS_PROJECT_SLUG__" ? DEFAULT_SNAPSHOT_FILENAME : `review-board-${slug}.json`;
}

function endpointFor(slug: string): string {
  return `${DEV_SNAPSHOT_ENDPOINT}?project=${encodeURIComponent(slug)}`;
}

/** The board file for one project, or null when there isn't one yet (a new
 *  project has no committed board until its first autosave). */
export async function fetchSnapshotFromRepo(slug: string): Promise<unknown | null> {
  try {
    const res = await fetch(endpointFor(slug));
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

/** Dev-server write of the full board (including resolved comments) into the repo file. */
export async function persistSnapshotToRepo(snapshot: ReviewSnapshot, slug: string): Promise<boolean> {
  if (!import.meta.env.DEV) return false;
  try {
    const res = await fetch(endpointFor(slug), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
    return res.ok;
  } catch {
    return false;
  }
}
