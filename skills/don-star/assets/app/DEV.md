# Dev mode

A built-in inspector for anyone implementing these screens. It answers, off the
running page: **what is this component, what is it made of, what does it cost,
and how do I take it away.**

It assumes you do **not** have this repo. Nothing it reports is a file path you
can't open, and everything it exports opens on its own.

---

## Opening it

| Where | How |
| --- | --- |
| The review board (`/review`) | The **`</>`** button in the toolbar, or press **D** |
| Any product screen | **⌘⇧D** / **Ctrl+Shift+D**, or add **`?dev=1`** to the URL |

It works on the deployed preview, not just locally — it's behind the same login
gate as the rest of the site, and that's the only gate it needs.

On the board, dev mode inspects the app **inside** a frame, never the board
around it. Most frames on the canvas are cached pictures rather than running
apps; clicking one in dev mode boots it for you, then click again to pick.

**Picking stays on.** Click element after element and each one replaces the
selection — there is no trip back to the toolbar between picks. **Esc** (or the
crosshair button) ends it, which is also how you go back to *using* the screen
rather than inspecting it. Zoom, pan and pinch keep working normally the whole
time: dev mode never sits between you and the canvas.

---

## The four tabs

**Inspect** — the component stack above what you clicked (`FlowHeading →
FlowShell → Intake`), that component's real props, and the element's layout,
type and color. Colors and radii are shown with the **design token** behind
them (`--brand-navy`, not just `rgb(0, 37, 74)`) — prefer the token name; the
palette is generated from `DESIGN.md`, so values move and names don't.

**Code** — three views of the selection:

- **JSX** — the React tree as it actually rendered, with real prop values. This
  is a record of the running page, not a copy of a source file: a `.map()`
  appears here as its expanded rows.
- **HTML** — the rendered DOM, indented. Use this if you're not on React.
- **CSS** — what this screen's Tailwind classes **compile to**, including
  `@media` and `:hover` variants, plus the custom properties they reference.
  `px-5` means nothing without a Tailwind build; `padding-inline: 1.25rem`
  means something anywhere.

**Resources** — the design tokens this screen actually paints with, every icon
on it (named the way the design system knows it, with its raw SVG), and every
image, font and video it loads with intrinsic size, rendered size and weight.
Every row is downloadable: images show a thumbnail and each file, icon included,
has its own **Download** button; **Download all** on the Files header saves the
lot as one `resources.zip` (the files under their bundle paths, each icon as an
`.svg`). Added 2026-08-19 — the rows used to be links only, and "how do I export
these pictures?" (a reviewer, Slack) had no good answer short of the full bundle.
The scope is the **component the header names** — everything below that part of
the tree — not the raw element the click landed on: a card's photo is usually a
sibling layer under the text the click actually hits, and scoping to the clicked
element alone listed a card's fonts but not the picture it's made of.

**Export** — see below. Also the screen's URL parameters, editable: the URL *is*
the state in this app, so changing a param here re-enters the screen in that
state.

## Working in it

- **Click any row to copy its value** — the token if there is one, otherwise
  the literal. That includes colors, sizes, fonts and props.
- **The breadcrumb walks up the component tree**; click any ancestor to select
  it. **↑ / ↓** move to the parent / first child once something is selected.
- **`selector`** in the header copies a CSS selector that finds this element
  again — paste it into your own devtools, or into a bug report.
- Drag the panel's left edge to resize; the width and the open tab are
  remembered.

## Measuring

The ruler button toggles canvas-style measurement: rulers along the frame in the
page's own pixels, the selection's dimensions, its padding, and — when you
select one element and hover another — the distances between them. Every number
is in the **inspected page's** pixels, never the board's, so a spec taken at 50%
zoom is still correct.

## Exporting

**`page.html`** — the whole screen as ONE self-contained file. Styles, fonts and
images inlined; scripts stripped. Opens offline in any browser and looks
identical. It is not interactive. This is the file to attach to a ticket.

**`bundle.zip`** — everything, for rebuilding:

| file | what it is |
| --- | --- |
| `page.html` | as above |
| `component.jsx` | the React tree with real props |
| `markup.html` | the rendered DOM, indented |
| `styles.css` | the compiled CSS + the tokens it references |
| `tokens.json` | tokens used on this screen, and the full palette |
| `assets.json` + `assets/` | every file the screen loads, and its bytes |
| `icons/*.svg` | each icon on screen, standalone |
| `README.md` | what state the capture was taken in |

Exports cover whatever the panel header says — pick an element to narrow them to
that subtree, or **Clear** for the whole screen. A snapshot is one state; walk
the screen to another state and export again.

## For maintainers

Code lives in `__DS_APP_DIR__/src/dev/`, loaded lazily (~43 kB gzipped 14 kB) so a
normal visit never downloads it.

| file | role |
| --- | --- |
| `index.ts` | activation (`?dev=1` / ⌘⇧D), mounts the panel in its own root |
| `overlay.tsx` | the panel, the highlight and the measure layer |
| `target.ts` | **which document** is being inspected, and frame↔screen geometry |
| `inspect.ts` | component names and props, read off React's fiber |
| `markup.ts` | JSX / HTML / CSS extraction |
| `tokens.ts` | the token table, and value→name lookup |
| `assets.ts` | images, fonts, icons |
| `measure.ts` | rulers and distances |
| `export.ts` | `page.html` and `bundle.zip` |

Three rules the code holds to, each of which has already bitten once:

1. **Never touch the ambient `document`, `window`, `getComputedStyle` or
   `performance`.** From the board, the thing under inspection is another
   document. Everything takes a `DevTarget`.
2. **Never `instanceof` a DOM class.** Each realm has its own constructors, so
   `rule instanceof CSSFontFaceRule` is silently `false` for a framed document —
   it reads as "there are none" and shows an empty list rather than an error.
   Use `isInstance(value, "CSSFontFaceRule", doc)` or `nodeType === 1`
   (`target.ts`).
3. **Namespace every class `rvdev`.** The standalone export filters the
   panel's own rules back out by that substring, so it can never appear in an
   artifact someone receives.

Component names survive minification because `vite.config.ts` sets
`build.rollupOptions.output.keepNames` — dev mode ships to the deployed site,
and a panel that says `<t7>` is a panel nobody trusts.
