// The SERVER tier of the preview cache: shots built in CI and served from a
// public bucket, shared by every reviewer.
//
// The board used to hold captures only in the reviewer's own browser, so every
// person, device and profile paid a full ~190-screen boot sweep of its own, and
// nothing anyone warmed ever helped anyone else. Now a push to main photographs
// whatever it changed (scripts/build-shots.ts) and everybody paints from the
// same bitmaps — including on localhost, where only the screens you're actively
// editing miss.
//
// Three tiers, in order (snapshot-cache.ts drives them):
//   1. IndexedDB      — this browser has it already, no network at all
//   2. here           — the bucket, immutable + CDN-cached, then written to (1)
//   3. a live boot    — nobody has shot it yet; capture it ourselves, as before
//
// Tier 3 is why the CI job can be fully async: until it finishes, a changed
// screen behaves exactly the way the whole board behaved before any of this
// existed. There is no broken state to wait out, only a slower one.
//
// Off by default: with no VITE_SHOTS_URL configured, everything below reports
// "nothing here" and the board runs on tiers 1 and 3, unchanged.

import { indexGen, SHOT_EXT, SHOT_INDEX_FILE, shotName, type ShotIndex } from "./shot-name";

/** Public base URL of the bucket folder holding the shots + their index.
 *  Trailing slash trimmed so callers can always join with one. */
const BASE = (import.meta.env.VITE_SHOTS_URL as string | undefined)?.replace(/\/+$/, "") ?? "";

/** Names known to exist on the server. Empty until the index loads, and empty
 *  forever if it can't be reached — both read as "boot it yourself". */
let names: Set<string> = new Set();
/** Generation the loaded index declares — part of every shot's name. */
let gen = 1;
let loaded: Promise<boolean> | null = null;

export function shotsConfigured(): boolean {
  return !!BASE;
}

/** Reads the index once. Resolves false when shots are off or unreachable.
 *
 *  The index is the ONE mutable object in the store, so it's the only thing
 *  that must not be cached hard — the shots it points at are immutable and can
 *  be cached forever. */
export function loadShotIndex(): Promise<boolean> {
  loaded ??= !BASE
    ? Promise.resolve(false)
    : fetch(`${BASE}/${SHOT_INDEX_FILE}`, { cache: "no-cache" })
        .then((r) => (r.ok ? (r.json() as Promise<ShotIndex>) : null))
        .then((idx) => {
          if (!idx?.names?.length) return false;
          names = new Set(idx.names);
          gen = indexGen(idx);
          return true;
        })
        .catch(() => false);
  return loaded;
}

/** "Refresh previews" has to reach THIS tier too, or it stops meaning anything:
 *  clearing local storage while the server index still answers yes would leave
 *  every frame instantly "fresh" again and nothing would re-capture. Dropping
 *  the index (rather than the bucket, which the board has no business writing
 *  to) sends the whole board back to booting and self-capturing for the rest of
 *  the session — which is exactly what a reviewer pressing it wants to see. */
export function forgetShotIndex(): void {
  names = new Set();
  loaded = Promise.resolve(false);
}

/** Whether the server holds a shot for this exact screen at this exact version.
 *  Sync, because it is asked from the render path. */
export function serverHasShot(liveSrc: string, viewportW: number, version: string | null): boolean {
  const name = shotName(liveSrc, viewportW, version, gen);
  return !!name && names.has(name);
}

/** Fetches the shot itself. Null whenever it isn't there — the caller boots the
 *  live page instead, which is also what happens in the window between a push
 *  and the CI job catching up.
 *
 *  A miss here after a hit in `serverHasShot` is possible and fine: the index
 *  can be a few seconds stale against a bucket that is still being written. */
export async function fetchShot(
  liveSrc: string,
  viewportW: number,
  version: string | null,
): Promise<Blob | null> {
  const name = shotName(liveSrc, viewportW, version, gen);
  if (!name || !BASE) return null;
  try {
    const res = await fetch(`${BASE}/${name}.${SHOT_EXT}`, { cache: "force-cache" });
    if (!res.ok) return null;
    const blob = await res.blob();
    return blob.size ? blob : null;
  } catch {
    return null;
  }
}
