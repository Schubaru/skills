// Dev mode — activation.
//
// Turned on by `?dev=1` on any route, or ⌘⇧D / Ctrl+Shift+D anywhere. Both
// stay available on the DEPLOYED site, not just in `npm run dev`: the people
// this is for (outside engineers rebuilding these screens) never run
// this repo, they open the preview link. Everything behind the review gate is
// already staff-only, so that's the access boundary — there isn't a second one
// to invent here.
//
// The panel and everything it pulls in (the fiber reader, the exporters, the
// zip writer) load ONLY when it's switched on, so a normal visit carries none
// of it.
//
// ⚠ Two places it deliberately does NOT turn itself on:
//   - inside a review-board frame, unless that frame's own URL asks for it.
//     sessionStorage is shared across same-origin frames, so a remembered
//     "on" would otherwise paint a panel into all ~130 board frames — and
//     into every PNG the board exports.
//   - before React has rendered anything. The panel reads fibers; opening on
//     an empty root would just say "not rendered by React".

import { createElement } from "react";
import { createRoot } from "react-dom/client";

const FLAG = "rvdev:on";

let mounted: { unmount: () => void } | null = null;
let loading = false;

export function installDevMode(): void {
  if (typeof window === "undefined") return;

  const framed = window.top !== window;
  const asked = new URLSearchParams(location.search).get("dev");
  const remembered = !framed && sessionStorage.getItem(FLAG) === "1";

  if (asked === "1" || (asked !== "0" && remembered)) void open();
  if (asked === "0") sessionStorage.removeItem(FLAG);

  window.addEventListener("keydown", (e) => {
    // ⌘⇧D on a Mac, Ctrl+Shift+D elsewhere. `e.code` rather than `e.key`
    // because shifted layouts report a different character.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.code === "KeyD") {
      e.preventDefault();
      void toggle();
    }
  });
}

export async function toggle(): Promise<void> {
  if (mounted) return close();
  return open();
}

async function open(): Promise<void> {
  if (mounted || loading) return;
  loading = true;
  try {
    // Only the PANEL is dynamic. React and its DOM client are already in the
    // main chunk (the app is React), so importing them lazily moves no bytes
    // and only makes the bundler warn about it.
    const { DevPanel } = await import("./overlay");
    const host = document.createElement("div");
    host.id = "rvdev-root";
    // The board's self-capture skips this id, so a screenshot taken with the
    // panel open is still a picture of the product (review-capture.ts).
    host.setAttribute("data-rvdev", "");
    document.body.appendChild(host);

    const root = createRoot(host);
    root.render(createElement(DevPanel, { mode: "page", onClose: close }));
    mounted = {
      unmount: () => {
        root.unmount();
        host.remove();
      },
    };
    try {
      sessionStorage.setItem(FLAG, "1");
    } catch {
      /* private mode: dev mode just won't survive a reload */
    }
  } finally {
    loading = false;
  }
}

function close(): void {
  mounted?.unmount();
  mounted = null;
  try {
    sessionStorage.removeItem(FLAG);
  } catch {
    /* ignore */
  }
}
