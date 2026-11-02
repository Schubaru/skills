// The theme rows, shared by the board menu and the folder menu (2026-08-13).
// One preference, one set of rows — a second copy would drift in wording the
// first time either is touched.

import { Check, Desktop, Moon, Sun } from "./icons";
import { THEME_OPTIONS, type ThemePref } from "./theme";

/** Applies without closing the menu, like the other view toggles. */
export function ThemeRows({ theme, onTheme }: { theme: ThemePref; onTheme: (theme: ThemePref) => void }) {
  return (
    <>
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="menuitemradio"
          aria-checked={theme === opt.value}
          className="rv-menu-item"
          onClick={() => onTheme(opt.value)}
        >
          {opt.value === "auto" ? <Desktop size={14} /> : opt.value === "light" ? <Sun size={14} /> : <Moon size={14} />}
          <span className="rv-grow">
            {opt.label}
            {opt.value === "auto" ? <span style={{ color: "var(--rv-muted-fg)" }}> · follows system</span> : null}
          </span>
          {theme === opt.value ? <Check size={13} style={{ flexShrink: 0 }} /> : null}
        </button>
      ))}
    </>
  );
}
