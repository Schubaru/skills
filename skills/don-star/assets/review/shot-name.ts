// What a prebuilt preview shot is CALLED. Shared, deliberately, by the browser
// (shot-store.ts) and the CI job that builds them (scripts/build-shots.ts) —
// two implementations of this would be two implementations of the cache key,
// and the failure would be silent: the board would simply never find a shot the
// job had just uploaded, and fall back to booting, forever.
//
// The name is CONTENT-ADDRESSED: it folds in the route's content version
// (screen-versions.ts), the viewport, and the exact seeded URL. So a shot is
// never invalidated — a changed screen gets a different NAME, and the old
// object is just unreferenced. That is what lets every shot be served
// `immutable`: the browser's own HTTP cache becomes the second tier of the
// cache, for free, with no revalidation and nothing to expire.
//
// No dependency on Vite, the DOM, or node: this module is imported by both
// runtimes and must stay portable.

/** FNV-1a, 32 bits. Hand-rolled because the name has to be computed
 *  SYNCHRONOUSLY in the browser's render path (isFresh) — SubtleCrypto is
 *  async, and a promise there would put a boot in front of every frame. */
function fnv1a(input: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619, in 32-bit pieces (Math.imul keeps it exact).
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 64 bits of hex from two independently-seeded 32-bit passes. Ample for the
 *  few hundred shots a board holds; a collision would need two DIFFERENT
 *  screens to agree in both halves. */
function hash64(input: string): string {
  const a = fnv1a(input, 0x811c9dc5);
  const b = fnv1a(input, 0x9e3779b9);
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/** The object name (no extension) for one screen's prebuilt shot.
 *
 *  `version` is the route's content hash — null means the manifest could not be
 *  read, and without it there is no way to know whether a shot still matches
 *  the code, so there is no name either and the caller falls back to booting.
 *
 *  `gen` is the store's GENERATION, and it exists because immutable caching has
 *  one sharp edge: a shot is cached for a year, so re-uploading the same object
 *  name with better bytes reaches nobody who already loaded it. Bumping the
 *  generation renames every shot, which is the only real cache bust available.
 *  It is carried in the index (the one mutable object here), never in matching
 *  env vars on two sides — a client and a job that disagreed about it would
 *  silently never find each other's shots. Reach for it when a shot is WRONG
 *  rather than merely old: the content hash already covers code changes, and
 *  the thing it can't see is time (a screen rendering "next Tuesday"). */
export function shotName(
  liveSrc: string,
  viewportW: number,
  version: string | null,
  gen: number,
): string | null {
  if (!version) return null;
  return hash64(`${gen}|${version}|${viewportW}|${liveSrc}`);
}

/** File extension every shot is stored with. WebP: these are glanced at while
 *  panning, and the lossless PNG path (export-png.ts) is a different job with a
 *  different answer. */
export const SHOT_EXT = "webp";

/** The manifest the CI job writes beside the shots — the board reads this ONE
 *  small file and then knows, without a request per screen, exactly which
 *  shots exist. A screen that isn't in it boots live, which is precisely the
 *  window between a push and the job finishing. */
export const SHOT_INDEX_FILE = "index.json";

export type ShotIndex = {
  generatedAt: number;
  /** Store generation — see `shotName`. Absent on indexes written before it
   *  existed, which read as generation 1. */
  gen?: number;
  /** Object names, no extension. */
  names: string[];
};

/** The generation an index declares. */
export function indexGen(idx: Pick<ShotIndex, "gen"> | null | undefined): number {
  return idx?.gen ?? 1;
}
