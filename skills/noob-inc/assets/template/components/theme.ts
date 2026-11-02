"use client";
import { useCallback, useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    let p: ThemePref = "system";
    try {
      const s = localStorage.getItem("noob-theme");
      if (s === "light" || s === "dark") p = s;
    } catch {}
    setPref(p);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setResolved(p === "system" ? (mq.matches ? "dark" : "light") : p);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const set = useCallback((p: ThemePref) => {
    setPref(p);
    try {
      if (p === "system") localStorage.removeItem("noob-theme");
      else localStorage.setItem("noob-theme", p);
    } catch {}
    if (p === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = p;
    const dark = p === "system" ? window.matchMedia("(prefers-color-scheme: dark)").matches : p === "dark";
    setResolved(dark ? "dark" : "light");
  }, []);

  const toggle = useCallback(() => set(resolved === "dark" ? "light" : "dark"), [resolved, set]);
  return { pref, resolved, set, toggle };
}
