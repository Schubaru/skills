// The board's tri-state theme preference, shared by every review surface
// (the board itself, the projects folder, Manage access). Extracted from
// app.tsx 2026-08-13 when the folder appeared: two implementations of "is it
// dark?" would eventually disagree across a navigation, which is exactly the
// flicker a preference is supposed to prevent.
//
// Auto is the default and follows the system. JS resolves the three states
// down to one `is-dark` class so the CSS palette stays two blocks.

import { useEffect, useState } from "react";

export type ThemePref = "auto" | "light" | "dark";

export const THEME_OPTIONS: { value: ThemePref; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const THEME_KEY = "rv:theme";

/** Persisted globally, not per project — it's a user preference, not board state. */
export function useThemePref() {
  const [themePref, setThemePrefState] = useState<ThemePref>(() => {
    if (typeof window === "undefined") return "auto";
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : "auto";
  });

  const setThemePref = (next: ThemePref) => {
    setThemePrefState(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const [systemDark, setSystemDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const darkMode = themePref === "dark" || (themePref === "auto" && systemDark);
  return { themePref, setThemePref, darkMode };
}
