# Stack: web prototype of an app

## Detection
`package.json` with `react-dom` (or vue/svelte/next) and no React Native. Typical case: a
design team's clickable prototype of a mobile app, rendered in a phone-sized viewport.

## What that means for evidence
- Every chrome element is custom by construction (there is no native tab bar in a browser).
  Code rules still fire, and that is the point: the report tells the team what the iOS build
  and the Android build should each do instead.
- W captures give layout, content, labels, element frames, computed styles (backdrop blur,
  position). They cannot show native rendering. Chromium reports `env(safe-area-inset-*)` as 0,
  so unsafe-area hits on code that pads with safe-area insets become review candidates, not
  findings.
- Implementation snippets for this stack are **prototype sketches** (`usePlatform()` and the
  chrome components are placeholders) plus a `Native build:` line for `targetStack`
  (default `rn-expo`). There is no platform API to verify, so `apiVerified` is null.

## Recommended prototype move
Add one platform dimension (e.g. `?os=ios|android`, read once) and branch only the chrome
components on it: tab bar, top bar/back, menus, sheets, dialogs. Share everything else.
That single change resolves X-PAR-01/X-PAR-02 structurally and lets the review canvas show both
platforms side by side.

## Before and after frames
A web prototype is the one stack whose screens can be patched: `capture_after.mjs` reloads each
screen at both phone sizes, applies the listed fixes in the page (DOM and styles, in the
browser only) and photographs it for the Prototype tab. Targets come from the audit's own
element frames or from roles and geometry, so the patches work on any prototype; colours and
type are read off the app unless `prototype.skin` in the config supplies the project's tokens.
Android frames load the Material Symbols font from Google Fonts while they are drawn; offline,
the affected icons are missing from the After frame, so re-run with a connection. iPhone frames
keep the app's own icons (SF Symbols cannot be drawn on the web) and only hint at glass.
A top bar that cannot take the new shape is put back untouched and its fixes are listed as not
shown.

## Inventory
React Router: `path="…"` routes are read from any `src/**/*.tsx|jsx` that contains `<Route`,
components resolved through `lazy(() => import(…))` and imports (`@/` = `src/`). Canvas
manifests fill titles and concrete URLs (including query states). Use `scope.include` to keep a
large app to one area, `chrome` for the shell file, and `web.hideSelectors` for review tools
drawn over the page.
