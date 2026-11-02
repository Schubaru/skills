// The picture on a project card (2026-08-13).
//
// It is the project's own lead screen, painted from the SAME capture the board
// frames use (snapshot-cache.ts): same key, same mobile viewport, so a reviewer
// who has browsed that board in phone mode already has the bitmap and the
// folder paints instantly with no boot at all. Nothing here is drawn or decorative —
// a thumbnail that isn't the thing would be worse than no thumbnail.
//
// Cold cache: one hidden iframe boots the page and captures it, exactly like
// frame.tsx's SnapshotWarmer, through the same bounded boot queue. A project
// with no screens yet gets the canvas texture instead — an empty board, drawn
// as an empty board.

import { useEffect, useRef, useState } from "react";
import { seededSrc, type ScreenSeed } from "../review-seed";
import { LIVE_VIEWPORTS } from "./model";
import { versionFor } from "./screen-versions";
import { acquireBootSlot, captureFrame, hydrateSnapshot, initSnapshots, snapshotKey } from "./snapshot-cache";

/** Which screen stands for the project, and how it was seeded. */
export type ThumbShot = { src: string; seed?: ScreenSeed };

/** MOBILE, always (the reviewer, 2026-08-13: "vertical rather than horizontal").
 *  These designs are phone-first — a desktop capture showed the responsive
 *  adaptation rather than the thing being reviewed — and it matches the board's
 *  own mobile-viewport key, so browsing the board in phone mode fills these in
 *  for free. */
const VIEWPORT = LIVE_VIEWPORTS.mobile;

export function ProjectThumb({ shot }: { shot: ThumbShot | null }) {
  const [url, setUrl] = useState<string | null>(null);
  // "Should I boot?" is answered only after the cache has been asked, so a
  // hit never costs an app boot.
  const [boot, setBoot] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const liveSrc = shot ? seededSrc(shot.src, shot.seed) : null;
  const key = liveSrc ? snapshotKey(liveSrc, VIEWPORT.w) : null;
  const version = liveSrc ? versionFor(liveSrc) : null;

  useEffect(() => {
    if (!key) return;
    let on = true;
    setUrl(null);
    setBoot(false);
    void initSnapshots()
      .then(() => hydrateSnapshot(key, versionFor(liveSrc!)))
      .then((cached) => {
        if (!on) return;
        if (cached) setUrl(cached);
        else setBoot(true);
      });
    return () => {
      on = false;
    };
  }, [key, liveSrc]);

  // Cold: take a slot in the same queue the board's warmer uses, so opening
  // the folder can't start a boot storm behind a board that is already busy.
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    if (!boot) return;
    const slot = acquireBootSlot();
    let on = true;
    let bail = 0;
    void slot.granted.then(() => {
      if (!on) return;
      setGranted(true);
      // A page that never loads gives its slot back and the card keeps its
      // skeleton rather than hanging on an empty frame forever.
      bail = window.setTimeout(() => on && setBoot(false), 20000);
    });
    return () => {
      on = false;
      window.clearTimeout(bail);
      slot.release();
    };
  }, [boot]);

  if (!shot) {
    return (
      <div className="rv-thumb is-empty" aria-hidden>
        <div className="rv-dots rv-thumb-canvas" />
      </div>
    );
  }

  return (
    <div className={url ? "rv-thumb is-loaded" : "rv-thumb"} aria-hidden>
      {url ? (
        <img className="rv-thumb-img" src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        // Skeleton, not a spinner: the card keeps its shape while the picture
        // arrives, so the grid never reflows under the pointer.
        <div className="rv-thumb-skeleton" />
      )}
      {boot && granted && key ? (
        <iframe
          ref={iframeRef}
          src={liveSrc ?? undefined}
          title="Thumbnail"
          tabIndex={-1}
          onLoad={() => {
            // Same settle delay as the board's frames — an entrance animation
            // caught halfway is a worse picture than none.
            window.setTimeout(() => {
              const el = iframeRef.current;
              if (!el) return;
              void captureFrame(el, key, version).then((next) => {
                if (next) setUrl(next);
                setBoot(false);
              });
            }, 900);
          }}
          style={{ position: "fixed", left: -20000, top: 0, width: VIEWPORT.w, height: VIEWPORT.h, border: 0 }}
        />
      ) : null}
    </div>
  );
}
