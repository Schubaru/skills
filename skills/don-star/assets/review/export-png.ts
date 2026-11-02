// "Download screens" — the board's export to PNG (one screen) or a ZIP of
// PNGs (a whole canvas page).
//
// Every shot is taken FRESH, not lifted from the preview cache. The cache is
// lossy WebP at 1.5× (snapshot-cache.ts) — right for a bitmap you glance at
// while panning, wrong for a file that leaves the browser and gets dropped
// into a deck. So the exporter boots each screen offscreen exactly the way
// the background warmer does, asks it to rasterize itself as lossless PNG at
// EXPORT_PIXEL_RATIO, and throws the iframe away.
//
// It shares the warmer's bounded boot queue (acquireBootSlot) rather than
// opening its own: a 40-screen export and a warming sweep running at once
// would otherwise put 24 booting apps on the page.

import { seededSrc } from "../review-seed";
import type { ScreenSeed } from "./model";
import { acquireBootSlot, requestCapture } from "./snapshot-cache";
import { makeZip, type ZipEntry } from "./zip";

/** 2× the CSS viewport: a 390pt phone screen exports at 780px, which still
 *  reads when someone drops it full-bleed on a slide. */
export const EXPORT_PIXEL_RATIO = 2;

/** How long one screen gets to boot, settle and rasterize before the export
 *  gives up on it and moves on. Generous — a cold page behind eleven others
 *  is slow, and losing a screen from the zip is worse than waiting. */
const SHOT_TIMEOUT_MS = 25_000;

/** Settle delay before the shutter, matching the preview path: fonts, images
 *  and the page's own entrance animations finish first, so a capture is never
 *  a half-played reveal. */
const SETTLE_MS = 900;

export type ShotSpec = {
  /** Path inside the zip, no extension — "01-arrival/03-first-run.png" is
   *  built from this plus ".png". */
  path: string;
  /** App route to shoot (raw, unseeded). */
  src: string;
  seed?: ScreenSeed;
  /** CSS px the page is laid out at — the board's live viewport, at the
   *  frame's own aspect, so the export matches what the frame shows. */
  viewport: { w: number; h: number };
};

export type ExportProgress = { done: number; total: number; failed: number };

/** Boots one screen offscreen and resolves its PNG. Null when the page never
 *  loaded, the capture failed, or the caller aborted. */
export async function capturePng(spec: ShotSpec, signal?: AbortSignal): Promise<Blob | null> {
  if (signal?.aborted) return null;
  // Priority: an export is a press the reviewer is waiting on, so it takes
  // the next freed slots instead of queueing behind a whole warming sweep.
  const slot = acquireBootSlot(true);
  try {
    // Cancelling has to cut the QUEUE, not just the shot: most of an aborted
    // export is screens still waiting for a boot slot.
    const aborted = signal
      ? new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
      : null;
    await (aborted ? Promise.race([slot.granted, aborted]) : slot.granted);
    if (signal?.aborted) return null;

    const frame = document.createElement("iframe");
    // Offscreen, not display:none — a frame that isn't laid out never paints,
    // and there would be nothing to rasterize.
    frame.style.cssText = `position:fixed;left:-20000px;top:0;border:0;width:${spec.viewport.w}px;height:${spec.viewport.h}px`;
    frame.setAttribute("aria-hidden", "true");
    frame.title = "Screen export";
    frame.src = seededSrc(spec.src, spec.seed);
    document.body.appendChild(frame);

    try {
      return await withTimeout(shoot(frame, signal), SHOT_TIMEOUT_MS);
    } finally {
      frame.remove();
    }
  } finally {
    slot.release();
  }
}

async function shoot(frame: HTMLIFrameElement, signal?: AbortSignal): Promise<Blob | null> {
  await frameLoaded(frame);
  if (signal?.aborted) return null;
  await sleep(SETTLE_MS);
  if (signal?.aborted) return null;
  return requestCapture(frame, {
    pixelRatio: EXPORT_PIXEL_RATIO,
    format: "image/png",
    timeoutMs: SHOT_TIMEOUT_MS,
  });
}

/** Same belt-and-braces readiness as the board's frames: the load event can
 *  slip past a late listener on fast localhost loads, so poll readyState too. */
function frameLoaded(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      frame.removeEventListener("load", finish);
      window.clearInterval(poll);
      resolve();
    };
    frame.addEventListener("load", finish);
    const poll = window.setInterval(() => {
      try {
        if (frame.contentDocument?.readyState === "complete" && frame.contentWindow?.location.href !== "about:blank")
          finish();
      } catch {
        window.clearInterval(poll); // cross-origin: the load event covers it
      }
    }, 120);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => window.setTimeout(r, ms));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, sleep(ms).then(() => null)]);
}

/** Captures every spec and returns the zip. Screens that fail are counted and
 *  left out rather than faked — the caller reports the shortfall. */
export async function exportZip(
  specs: ShotSpec[],
  opts: {
    onProgress?: (p: ExportProgress) => void;
    /** Fires when the last shot is in and the archive is being assembled —
     *  CRC-ing tens of megabytes is a beat the reviewer can see. */
    onPacking?: () => void;
    signal?: AbortSignal;
    concurrency?: number;
  } = {},
): Promise<{ blob: Blob | null; done: number; failed: number }> {
  const entries: (ZipEntry | null)[] = new Array(specs.length).fill(null);
  let done = 0;
  let failed = 0;

  // Workers pull from a shared cursor, so a slow screen doesn't hold up a
  // whole batch behind it. The real ceiling is the boot queue underneath.
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      const spec = specs[i];
      if (!spec || opts.signal?.aborted) return;
      const blob = await capturePng(spec, opts.signal);
      if (blob) entries[i] = { name: `${spec.path}.png`, data: new Uint8Array(await blob.arrayBuffer()) };
      else failed++;
      done++;
      opts.onProgress?.({ done, total: specs.length, failed });
    }
  };

  const lanes = Math.max(1, Math.min(opts.concurrency ?? 8, specs.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  if (opts.signal?.aborted) return { blob: null, done, failed };

  const got = entries.filter((e): e is ZipEntry => e !== null);
  if (!got.length) return { blob: null, done, failed };
  opts.onPacking?.();
  // Yield a frame first, so the "Zipping…" state actually paints before the
  // synchronous CRC pass takes the main thread.
  await sleep(0);
  return { blob: makeZip(got), done, failed };
}
