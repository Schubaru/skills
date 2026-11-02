// Mid-flow seeding for review frames.
//
// The review board shows screens like "intake question 9" — states the app only
// reaches after real input. It gets there by pre-writing the app's own storage
// keys (`myapp-intake-v1`, `myapp-register-v1`).
//
// Writing that storage from the *host* can't work on a board: every frame is an
// iframe on the same origin, so they share one sessionStorage and the last
// writer wins. Each frame therefore carries its seed in its own URL hash and
// applies it inside its own document, before its first render — a synchronous
// step no sibling frame can interleave with.
//
// The hash is deliberately left in place: a reload or HMR re-seeds, so a frame
// always returns to the state the board says it's showing. In-frame navigation
// drops the hash, which is also right — once the reviewer moves on, they own
// the state.

const PARAM = "rv-seed";

/** This document's seed, parsed once at boot. */
let seeded: ScreenSeed | null = null;

/** Storage to write into the app before it boots. `null` removes a key. */
export type ScreenSeed = {
  session?: Record<string, string | null>;
  local?: Record<string, string | null>;
};

/** Frame src carrying its own seed. Unseeded screens are returned untouched. */
export function seededSrc(src: string, seed: ScreenSeed | undefined): string {
  if (!seed) return src;
  return `${src}#${PARAM}=${encodeURIComponent(JSON.stringify(seed))}`;
}

/**
 * Apply a seed carried in `location.hash`, if any. Must run before the app
 * reads its storage — import this module first in the entry point.
 */
export function applySeedFromUrl(): void {
  try {
    const raw = new URLSearchParams(window.location.hash.slice(1)).get(PARAM);
    if (!raw) return;
    const seed = JSON.parse(raw) as ScreenSeed;
    seeded = seed;
    const write = (store: Storage, entries: Record<string, string | null> | undefined) => {
      if (!entries) return;
      for (const [k, v] of Object.entries(entries)) {
        if (v === null) store.removeItem(k);
        else store.setItem(k, v);
      }
    };
    write(window.sessionStorage, seed.session);
    write(window.localStorage, seed.local);
  } catch {
    // Malformed hash, or storage blocked in a privacy mode: the frame still
    // renders live, just unseeded. Never break the boot over a preview detail.
  }
}

/**
 * What this frame was seeded with for `key` — authoritative over the storage
 * read it shadows.
 *
 * Writing the seed into storage isn't enough on a board: the write lands during
 * module evaluation, the app reads during its first render, and sibling frames
 * boot in between. Whoever wrote last would win for everybody, which is why
 * every seeded frame used to show the same screen. So readers of a seeded key
 * ask here first.
 *
 * Returns `undefined` when this frame wasn't seeded for `key` (use storage), or
 * `null` when the seed explicitly clears it (a screen that must start fresh) —
 * those are different answers, so don't collapse them with `??`.
 */
export function seededItem(key: string): string | null | undefined {
  if (seeded?.session && key in seeded.session) return seeded.session[key];
  if (seeded?.local && key in seeded.local) return seeded.local[key];
  return undefined;
}

/** `sessionStorage.getItem`, but a review frame's own seed wins. */
export function readSession(key: string): string | null {
  const fromSeed = seededItem(key);
  return fromSeed !== undefined ? fromSeed : sessionStorage.getItem(key);
}

/**
 * `sessionStorage.setItem` (`null` = removeItem), keeping this frame's own seed shadow in
 * step. The boot seed shadows the SHARED storage so a sibling frame's write can't leak in —
 * but a write made in THIS document is the reviewer's own walk, and their next screen must
 * read it back (found 2026-08-27: tapping Female on the seeded s=who frame recorded the
 * answer, the intake read the boot seed's sex:"" straight over it, and asked sex again one
 * screen later). Sibling frames still can't win: they run in their own realm, so they can
 * only touch the shared storage this frame's shadow keeps shadowing.
 * Every app-side writer of a key that board frames seed must use this, not raw setItem —
 * the read half already goes through readSession, and the pair only works symmetric.
 */
export function writeSession(key: string, value: string | null): void {
  if (seeded?.session && key in seeded.session) seeded.session[key] = value;
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage blocked (privacy mode): seeded frames still read the shadow; the live app
       simply re-asks — the same non-fatal outcome the callers already accepted. */
  }
}

/** `localStorage.getItem`, but a review frame's own seed wins — the local twin
 *  of `readSession`, for the one key that outlives a tab (`site-demo-v1`, the
 *  demo account). A frame seeded with `local: { key: null }` reads nothing even
 *  when the presenter's browser holds a demo. */
export function readLocal(key: string): string | null {
  const fromSeed = seededItem(key);
  if (fromSeed !== undefined) return fromSeed;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** `localStorage.setItem` (`null` = removeItem), keeping this frame's seed shadow
 *  in step — the same symmetric pair as `writeSession`, for the same reason. */
export function writeLocal(key: string, value: string | null): void {
  if (seeded?.local && key in seeded.local) seeded.local[key] = value;
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage blocked: the shadow still serves a seeded frame; the live app forgets. */
  }
}
