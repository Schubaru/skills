// Preview cache + frame boot queue for the review canvas.
//
// The zoomed-out canvas was mounting every visible frame as a live iframe —
// a 71-app boot storm the browser throttles into "some frames never load",
// and scaled-iframe compositing that makes panning crawl. Instead: frames
// boot live a FEW AT A TIME (the queue), each captures itself once as it
// becomes ready (see src/review-capture.ts — the app rasterizes its own
// document, so fidelity is exact), and the canvas renders the cached bitmap
// whenever it doesn't strictly need the live page.
//
// Captures PERSIST across reloads (snapshot-store.ts, 2026-08-04). They used
// to live only in this module's Map, which meant every board load re-booted
// every screen on every page — ~140 app boots to look at a canvas, and the
// same again on the next reload. Each entry is stamped with the content
// version of the route it shows (screen-versions.ts), so:
//
//   • unchanged screen  → painted from disk, no boot at all
//   • changed screen    → its entry is dropped, it re-boots and re-captures
//   • no manifest       → persistence off entirely, session-only as before
//
// This is not the committed-PNG road the author ruled out: nothing lands in git,
// entries invalidate themselves against the source that renders them, and any
// frame the reviewer actually works in is still the live page.

import { loadScreenVersions, subscribeVersions, versionFor } from "./screen-versions";
import { fetchShot, forgetShotIndex, loadShotIndex, serverHasShot } from "./shot-store";
import { clearShots, deleteShots, loadAllMeta, readShot, writeShot, type ShotMeta } from "./snapshot-store";

/** A capture older than this is dropped even when its code hasn't changed —
 *  a few screens render relative dates (the scheduler's day strip), and a
 *  week-old picture of "next Tuesday" is a lie no hash can catch. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
/** Disk budget. ~140 frames of WebP land well under this; the oldest go first. */
const MAX_BYTES = 120 * 1024 * 1024;

/** Hot layer: key → object URL for blobs already in memory this session. */
const urls = new Map<string, string>();
/** What exists on disk (and what was captured this session), without the blobs. */
const index = new Map<string, ShotMeta>();
let persist = false;

// --- change notification ------------------------------------------------------
// Frames subscribe so a hydration, an eviction, or a dev-time version change
// re-runs their "do I have a usable bitmap?" question.

let epoch = 0;
const listeners = new Set<() => void>();

export function snapshotEpoch(): number {
  return epoch;
}

export function subscribeSnapshots(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function bump(): void {
  epoch++;
  for (const l of listeners) l();
}

/** Cache key: what page is loaded (src+seed hash ride in liveSrc) × the
 *  viewport it renders at. */
export function snapshotKey(liveSrc: string, viewportW: number): string {
  return `${viewportW}:${liveSrc}`;
}

/** The liveSrc a key was built from — the viewport prefix is numeric, so the
 *  first colon is always the separator. */
function srcOfKey(key: string): string {
  return key.slice(key.indexOf(":") + 1);
}

/** The viewport width a key was built at (the other half of snapshotKey). */
function viewportOfKey(key: string): number {
  return Number(key.slice(0, key.indexOf(":")));
}

function forget(keys: string[]): void {
  for (const k of keys) {
    const url = urls.get(k);
    if (url) URL.revokeObjectURL(url);
    urls.delete(k);
    index.delete(k);
  }
  if (persist) void deleteShots(keys);
}

/** Drops everything whose route version moved on, or that has simply aged out,
 *  then trims the oldest until the store fits its budget. */
function prune(): number {
  const now = Date.now();
  const stale: string[] = [];
  for (const [key, meta] of index) {
    const want = versionFor(srcOfKey(key));
    if (want === null) continue; // no manifest: leave the session cache alone
    if (meta.version !== want || now - meta.capturedAt > MAX_AGE_MS) stale.push(key);
  }
  forget(stale);

  let total = 0;
  for (const m of index.values()) total += m.bytes;
  if (total > MAX_BYTES) {
    const oldest = [...index.values()].sort((a, b) => a.capturedAt - b.capturedAt);
    const over: string[] = [];
    for (const m of oldest) {
      if (total <= MAX_BYTES) break;
      total -= m.bytes;
      over.push(m.key);
    }
    forget(over);
  }
  return stale.length;
}

let inited: Promise<void> | null = null;
let initialized = false;

/** Loads the version manifest and the on-disk index, drops what no longer
 *  applies, and wakes every mounted frame. Idempotent. */
export function initSnapshots(): Promise<void> {
  inited ??= (async () => {
    // Both indexes before any frame decides whether to boot: the version
    // manifest says what a valid shot would be called, the shot index says
    // which ones the server holds. Asking later is the storm this replaces.
    const [ok] = await Promise.all([loadScreenVersions(), loadShotIndex()]);
    persist = ok;
    if (persist) {
      for (const meta of await loadAllMeta()) index.set(meta.key, meta);
      prune();
      subscribeVersions(() => {
        prune();
        bump();
      });
    }
    initialized = true;
    bump();
  })();
  return inited;
}

/** True once initSnapshots() has settled. Frames hold their boots until then:
 *  booting before the disk index is read is exactly the storm this replaces. */
export function snapshotsInited(): boolean {
  return initialized;
}

/** Awaitable form, for the background warmer. */
export function snapshotsReady(): Promise<void> {
  return initSnapshots();
}

/** In-memory object URL, if this session already has one. Sync — render path. */
export function getSnapshot(key: string): string | undefined {
  return urls.get(key);
}

/** Whether a usable capture exists for this key at this version — in memory, on
 *  disk, or on the server. `version` null (no manifest) falls back to memory
 *  only.
 *
 *  Sync on purpose: every frame asks this while rendering to decide whether to
 *  boot an app, so the server tier is answered from the index loaded up front
 *  (shot-store.ts), never from a request. */
export function isFresh(key: string, version: string | null): boolean {
  return localFresh(key, version) || serverHasShot(srcOfKey(key), viewportOfKey(key), version);
}

/** Tiers 1 and 2 — this browser's own copy, in memory or on disk. */
function localFresh(key: string, version: string | null): boolean {
  const meta = index.get(key);
  if (!meta) return false;
  if (Date.now() - meta.capturedAt > MAX_AGE_MS) return false;
  if (version === null) return urls.has(key);
  if (meta.version !== version) return false;
  return urls.has(key) || persist;
}

/** Brings a persisted capture into memory. Resolves undefined when there isn't
 *  a usable one — the caller boots the live page instead. */
export async function hydrateSnapshot(key: string, version: string | null): Promise<string | undefined> {
  const mem = urls.get(key);
  if (mem) return isFresh(key, version) ? mem : undefined;

  if (localFresh(key, version) && persist) {
    const blob = await readShot(key);
    if (blob) {
      const url = URL.createObjectURL(blob);
      urls.set(key, url);
      return url;
    }
    // Index said yes, disk said no (a partial write, or storage evicted the
    // blob store): forget it, then fall through to the server.
    forget([key]);
    bump();
  }

  // Server tier. What comes back is remembered like any other capture, so the
  // next load of this board reads it off disk and never touches the network —
  // the shot is fetched once per browser, not once per session.
  //
  // Rate-limited because a board page mounts every one of its ~180 frames at
  // once, and each asks straight away. These are small CDN objects, so the
  // limit is about arrival ORDER, not load: unbounded, the last screen's bytes
  // compete with the first screen's, and the canvas fills in at random.
  if (!serverHasShot(srcOfKey(key), viewportOfKey(key), version)) return undefined;
  return fetchGate(async () => {
    const shot = await fetchShot(srcOfKey(key), viewportOfKey(key), version);
    return shot ? remember(key, shot, version) : undefined;
  });
}

/** Bounded-concurrency gate for shot downloads (see above). Higher than the
 *  boot queue's 12 — a download is a CDN round-trip, not an app boot. */
const MAX_CONCURRENT_FETCHES = 24;
let fetching = 0;
const fetchQueue: (() => void)[] = [];

async function fetchGate<T>(run: () => Promise<T>): Promise<T> {
  if (fetching >= MAX_CONCURRENT_FETCHES) await new Promise<void>((r) => fetchQueue.push(r));
  fetching++;
  try {
    return await run();
  } finally {
    fetching--;
    fetchQueue.shift()?.();
  }
}

/** Pruning walks the whole index and route-matches every key, so it must not
 *  run once per write: hydrating a 180-screen board from the server writes 180
 *  entries in a burst, and a prune each would be ~1.5M regex tests of pure
 *  jank. Coalesced to one pass after the burst settles. */
let pruneTimer = 0;
function pruneSoon(): void {
  if (pruneTimer) return;
  pruneTimer = window.setTimeout(() => {
    pruneTimer = 0;
    prune();
  }, 1000);
}

function remember(key: string, blob: Blob, version: string | null): string {
  const prev = urls.get(key);
  if (prev) URL.revokeObjectURL(prev);
  const url = URL.createObjectURL(blob);
  urls.set(key, url);
  const meta: ShotMeta = { key, version: version ?? "", capturedAt: Date.now(), bytes: blob.size };
  index.set(key, meta);
  if (persist && version !== null) void writeShot(meta, blob).then(pruneSoon);
  return url;
}

/** The raw protocol call: ask a framed app to rasterize itself and resolve the
 *  bitmap it sends back (src/review-capture.ts). Null on timeout or failure.
 *  Nothing is cached here — the preview path caches through captureFrame
 *  below, the PNG export (export-png.ts) deliberately does not, since its
 *  shots are lossless, 2× the scale, and headed straight out of the browser. */
export function requestCapture(
  iframe: HTMLIFrameElement,
  opts: { tag?: string; pixelRatio?: number; format?: "image/webp" | "image/png"; timeoutMs?: number } = {},
): Promise<Blob | null> {
  const win = iframe.contentWindow;
  if (!win) return Promise.resolve(null);
  const id = `${opts.tag ?? "shot"}#${Math.random().toString(36).slice(2)}`;
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMsg);
      resolve(null);
    }, opts.timeoutMs ?? 8000);
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; id?: string; blob?: Blob | null } | null;
      if (!d || d.type !== "rv-capture-done" || d.id !== id) return;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      resolve(d.blob instanceof Blob ? d.blob : null);
    };
    window.addEventListener("message", onMsg);
    win.postMessage(
      {
        type: "rv-capture",
        id,
        pixelRatio: opts.pixelRatio ?? CAPTURE_PIXEL_RATIO,
        format: opts.format ?? "image/webp",
      },
      window.location.origin,
    );
  });
}

/** Capture into the preview cache; resolves the cached object URL. Null on
 *  timeout/failure (the caller keeps the live iframe up instead). */
export function captureFrame(
  iframe: HTMLIFrameElement,
  key: string,
  version: string | null,
  timeoutMs = 8000,
): Promise<string | null> {
  // A page still behind its lazy chunk 900ms after load rasterizes as one flat colour, and
  // a cached white frame never heals (its version hash is "fresh"). A flat shot is retried
  // while the page finishes, and never cached: null keeps the live iframe up instead.
  const attempt = (left: number): Promise<string | null> =>
    requestCapture(iframe, { tag: key, timeoutMs }).then(async (blob) => {
      if (!blob) return null;
      if (!(await isFlat(blob))) return remember(key, blob, version);
      if (left <= 0 || !iframe.isConnected) return null;
      await new Promise((r) => window.setTimeout(r, 1500));
      return attempt(left - 1);
    });
  return attempt(3);
}

/** True when every sampled pixel of the shot is the same colour: nothing had painted. */
async function isFlat(blob: Blob): Promise<boolean> {
  try {
    const bmp = await createImageBitmap(blob, { resizeWidth: 64, resizeHeight: 40, resizeQuality: "low" });
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 40;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const d = ctx.getImageData(0, 0, 64, 40).data;
    for (let i = 4; i < d.length; i += 4)
      if (Math.abs(d[i] - d[0]) > 6 || Math.abs(d[i + 1] - d[1]) > 6 || Math.abs(d[i + 2] - d[2]) > 6) return false;
    return true;
  } catch {
    return false;
  }
}

/** Captured above the canvas's own scale so a bitmap still reads when the
 *  board is zoomed in near 100% (see LIVE_SCALE in app.tsx). */
export const CAPTURE_PIXEL_RATIO = 1.5;

/** "Refresh previews": throw everything away and let the board re-capture. The
 *  escape hatch for anything the version hash can't see (a data file the
 *  closure missed, a capture that caught a page mid-transition). */
export async function clearSnapshots(): Promise<void> {
  forget([...index.keys()]);
  // The server tier goes with it — otherwise the index answers "fresh" for
  // every screen a millisecond later and the press does nothing visible.
  forgetShotIndex();
  if (persist) await clearShots();
  bump();
}

// --- boot queue ---------------------------------------------------------------
// Bounded concurrency for background frame boots. Live-on-purpose frames
// (zoomed in, slides stage) bypass the queue; only capture-warming boots wait.

// 12 parallel boots (the reviewer, 2026-07-21: regenerate thumbnails in parallel, not
// sequentially) — high enough that a 24-frame page fills in two waves, low
// enough that the browser doesn't starve the frames it's already painting.
const MAX_CONCURRENT_BOOTS = 12;
let booting = 0;
const waiters: (() => void)[] = [];

/** One release() covers every path: while still queued it withdraws the
 *  request; once granted it frees the slot. Safe to call twice.
 *
 *  `priority` jumps the queue (front, not back). Reserved for boots the
 *  reviewer ASKED for — a PNG export off a cold board would otherwise sit
 *  behind a 50-screen warming sweep, doing nothing visible for a minute,
 *  because the warmer holds every slot. A jumper still waits for one boot to
 *  finish; it never widens the concurrency the cap exists to hold. */
export function acquireBootSlot(priority = false): { granted: Promise<void>; release: () => void } {
  let state: "waiting" | "granted" | "done" = "waiting";
  let grant!: () => void;
  const granted = new Promise<void>((res) => {
    grant = () => {
      if (state !== "waiting") return;
      state = "granted";
      booting++;
      res();
    };
  });
  if (booting < MAX_CONCURRENT_BOOTS) grant();
  else if (priority) waiters.unshift(grant);
  else waiters.push(grant);
  const release = () => {
    if (state === "granted") {
      state = "done";
      booting--;
      waiters.shift()?.();
    } else if (state === "waiting") {
      state = "done";
      const i = waiters.indexOf(grant);
      if (i >= 0) waiters.splice(i, 1);
    }
  };
  return { granted, release };
}
