# Platform: Web (React + CSS custom properties)

Use when the spec says `web`. If the repo already uses Tailwind, also emit a `tailwind.tokens.js` preset that maps the CSS variables into Tailwind theme keys; don't replace their config, extend it via `presets`.

## Files produced

```
design-system/
├── tokens/
│   ├── tokens.json
│   ├── tokens.css               # :root (light) + [data-theme="dark"]
│   └── tokens.ts                # same tree typed, for JS consumers
├── theme/
│   └── ThemeProvider.tsx        # sets data-theme on <html>, exposes useTheme()
├── components/
│   ├── Button.tsx + Button.module.css  (one pair per component)
│   ├── Button.stories.tsx              (one per component)
│   ├── index.ts
│   └── manifest.json
└── playground/index.html        # generated token/component sheet
.storybook/                      # main.ts + preview.ts; see references/storybook.md
```

If the project uses Vue/Svelte/plain HTML, keep `tokens.css` as the contract and write components in the project's framework using the same class and variable names. The CSS is the portable layer.

## CSS conventions

- Variables are prefixed with the spec prefix: `--<prefix>-text-default`, `--<prefix>-space-4`, `--<prefix>-font-body-md-size`.
- Components use CSS Modules (or the project's existing styling approach if it has one; match, don't fight). Classes: `.root`, `.variantPrimary`, `.sizeMd`, state via `data-*` attributes (`data-state="pressed"`, `data-disabled`) and pseudo-classes for hover/focus-visible.
- `:focus-visible { outline: 2px solid var(--<prefix>-border-focus); outline-offset: 2px; }` on every interactive component. Never `outline: none` without replacement.
- Motion under `@media (prefers-reduced-motion: reduce)` collapses durations to 0.
- Hairline borders are 1px on web (the token script already resolves this).
- Type: apply role tokens via a small set of utility classes emitted into `tokens.css`: `.<prefix>-type-body-md { font: var(--<prefix>-font-body-md-weight) var(--<prefix>-font-body-md-size)/var(--<prefix>-font-body-md-line-height) var(--<prefix>-font-family-body); letter-spacing: … }`.

## Component template (React)

```tsx
/**
 * Button · actions
 * Purpose / Use for / Don't use for / Anatomy — as in component-inventory.md
 */
import React from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string; variant?: ButtonVariant; size?: ButtonSize;
  leadingIcon?: React.ReactNode; trailingIcon?: React.ReactNode; loading?: boolean; fullWidth?: boolean;
}

export function Button({ label, variant = 'primary', size = 'md', leadingIcon, trailingIcon, loading, fullWidth, disabled, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={[styles.root, styles[variant], styles[size], fullWidth && styles.fullWidth, className].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden /> : (<>{leadingIcon}<span>{label}</span>{trailingIcon}</>)}
    </button>
  );
}
```

```css
.root { display:inline-flex; align-items:center; justify-content:center; gap:var(--p-space-2);
  border-radius:var(--p-radius-md); border:1px solid transparent; cursor:pointer;
  transition: background-color var(--p-motion-duration-fast) var(--p-motion-easing-standard); }
.root:focus-visible { outline:2px solid var(--p-border-focus); outline-offset:2px; }
.root:disabled { opacity:var(--p-opacity-disabled); cursor:not-allowed; }
.sm { height:32px; padding:0 var(--p-space-3); font:var(--p-font-label-sm-weight) var(--p-font-label-sm-size)/var(--p-font-label-sm-line-height) var(--p-font-family-body); }
.md { height:40px; padding:0 var(--p-space-4); font:var(--p-font-label-md-weight) var(--p-font-label-md-size)/var(--p-font-label-md-line-height) var(--p-font-family-body); }
.lg { height:48px; padding:0 var(--p-space-5); font:var(--p-font-label-lg-weight) var(--p-font-label-lg-size)/var(--p-font-label-lg-line-height) var(--p-font-family-body); }
.primary { background:var(--p-bg-accent-default); color:var(--p-text-on-accent); }
.primary:hover { background:var(--p-bg-accent-hover); } .primary:active { background:var(--p-bg-accent-pressed); }
.secondary { background:var(--p-surface-default); color:var(--p-text-default); border-color:var(--p-border-strong); }
.tertiary { background:transparent; color:var(--p-text-accent); } .tertiary:hover { background:var(--p-bg-accent-subtle); }
.danger { background:var(--p-bg-danger-strong); color:var(--p-text-inverse); }
.fullWidth { width:100%; }
```

(`--p-` above stands for the project prefix.) Web button heights are 32/40/48; RN's are 32/44/52 because of touch targets. That difference is deliberate and lives in the platform layer, not in tokens.

## ThemeProvider

Sets `document.documentElement.dataset.theme` from a prop or `prefers-color-scheme`, persists nothing by default (the app decides). `useTheme()` returns the typed semantic tree from `tokens.ts` for the rare JS-side need (charts, canvas).

## Preview

Storybook (`@storybook/react-vite`, a11y + vitest addons) is the component workbench; `references/storybook.md` has the setup. The generated `playground/index.html` remains as the dependency-free token sheet. No Gallery on web; Storybook is the gallery.
