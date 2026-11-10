"use client";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";

const IDLE_MS = 15 * 60_000;
const WARN_MS = 60_000;

let last = Date.now();
export function lastActivity() {
  return last;
}

/** Signs out after 15 minutes without pointer, key, or scroll input. The server session slides in step with real requests. */
export default function IdleGuard() {
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const bump = () => {
      last = Date.now();
    };
    const evs: (keyof WindowEventMap)[] = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"];
    for (const e of evs) window.addEventListener(e, bump, { passive: true });
    const t = setInterval(() => {
      const idle = Date.now() - last;
      if (idle >= IDLE_MS) {
        clearInterval(t);
        signOut({ callbackUrl: "/login?reason=idle" });
        return;
      }
      setLeft(idle >= IDLE_MS - WARN_MS ? Math.ceil((IDLE_MS - idle) / 1000) : null);
    }, 1000);
    return () => {
      clearInterval(t);
      for (const e of evs) window.removeEventListener(e, bump);
    };
  }, []);

  if (left == null) return null;
  return (
    <div role="status" className="idle-warn">
      <span className="label" style={{ color: "var(--amber)" }}>
        Idle
      </span>
      <span>
        Signing out in <b className="num">{left}s</b>. Move the mouse to stay.
      </span>
    </div>
  );
}
