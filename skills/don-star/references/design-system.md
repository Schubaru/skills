# Design system

The harness ships a canvas design *system* with a neutral, themable
identity. `assets/review/review.css` is the binding; this file is the intent.
When touching any harness UI, match what's here — don't invent a parallel
style, and don't reach for a host app's design system (the harness must look
right dropped into any project).

## The look in one paragraph

Cool-neutral paper and ink. Flat surfaces with 1.5px hairline borders — no
decorative shadows on cards; elevation is reserved for genuinely floating
layers (toolbar, menus, popovers, pins). Pills for every action. Hierarchy
comes from weight and size in one typeface, never a second family and never
forced uppercase. One accent color at a time, used small: the accent owns
comments, the status colors own triage, the event ramp owns documentation,
nothing else is colored. A dark theme inverts the same neutrals in one class
(`.rv-root.is-dark`), resolved from a tri-state Auto/Light/Dark preference. Motion
is ease-out only, 130–200ms, state-conveying, with a reduced-motion fallback.

## Tokens (all on `.rv-root`; theming = overriding these, nothing else)

| Token | Default | Role |
| --- | --- | --- |
| `--rv-bg` | `oklch(0.956 0.0045 247.9)` | page background (cool paper, a clear step below `card`) |
| `--rv-card` | `oklch(0.9965 0.0017 247.84)` | cards, popovers, raised surfaces |
| `--rv-muted` | `oklch(0.924 0.0058 247.9)` | panels, hover fills, segmented track |
| `--rv-border` | `oklch(0.9147 0.0063 255.48)` | hairlines, always 1.5px (1px for row dividers) |
| `--rv-fg` | `oklch(0.2547 0.0087 255.59)` | ink: primary text, emphasis borders |
| `--rv-muted-fg` | `oklch(0.5611 0.0072 255.5)` | secondary text, 12px+ labels |
| `--rv-muted-strong` | `oklch(0.45 0.0075 255.5)` | secondary text that carries information rather than chrome |
| `--rv-accent` | `#e8492b` | comment pins, comment mode, send buttons — nothing else |
| `--rv-agent` | `#6d4aff` | agent (skill) identity: their avatar, pins, byline chip |
| `--rv-good/-needs` | green / amber | triage only (`--rv-broken`, berry, is kept for legacy boards — "broken" was retired from the vocabulary and now folds into "needs") |
| `--rv-ev-comms/-hook/-note` | yellow / orange / blue | the events layer's own ramp — documentation, never a verdict |
| `--rv-p0` … `--rv-p14` | fifteen hues | presence: one per person (avatar ring, cursor, chat bubble); a person may pick one or a custom hex |
| `--rv-shadow-sm/-lg/-xl` | Tailwind-equivalent | sm: review bar · lg: toolbar, pins · xl: menus, popovers |
| `--rv-ease`, `--rv-fast` | ease-out-quint, 130ms | every transition |

Neutrals are OKLCH and slightly cool-tinted; never introduce a raw `#000`/`#fff`
neutral (the only whites are text/rings on accent fills). Status colors may be
re-themed per project but keep their semantics.

**People vs. agents.** A skill that comments is a participant, not a system
notice — same avatar size, same slot in the thread, same pin shape budget. It's
told apart by hue (`--rv-agent`, deliberately off the accent and triage ramps so
it never reads as a pin state or a verdict) and by a **squircle** avatar against
a person's circle. Keep both signals: colour alone fails for a colour-blind
reviewer, and shape alone is too quiet at pin size. Agent names render monospace
because they're invoked strings (`/norm-dog`), not display names.

## Shape & spacing

- Radius scale: **20px** cards/frames · **16px** menus/popovers · **12px**
  fields, menu items, list rows · `rounded-full` for every button and pill.
- Borders: 1.5px solid `--rv-border`; `--rv-fg` on selection/emphasis. Status
  color on a frame border means "this screen has a verdict".
- Screen frames have chrome so captures read as device screens: 3px flow-
  progress hairline, slim title header (13px/600 + tabular `i/n`), then the
  image on a `--rv-muted` bed.
- Nested cards are always wrong. The board's depth comes from the dot grid
  (1.4px dots, 34px pitch, `--rv-border`) behind flat cards.

## Type

One family: `"Hanken Grotesk", system-ui, …` — the stack picks up Hanken when
the host has it (`npm i @fontsource-variable/hanken-grotesk` + import it before
`review.css` for that face) and falls back to the system sans cleanly.
Scale: 24px/600 page band · 18px/600 flow titles · 16px/600 app title ·
14px body · 13px/600 popover + frame titles, 13px/500 menu items · 12px labels,
eyebrows, pills · 11px autosave/feed numerals. Tracking: `-0.01em` at 16–18px,
`-0.02em` at 24px, never tighter. Numerals in counts are always tabular.

## State vocabulary (every interactive element)

- Hover: `--rv-muted` fill (ghost things) or ink shift; never a new color.
- Selected: ink border (`is-selected`), not a colored fill.
- Active pill: status-colored border + 10% tint + darkened text
  (`color-mix(… 85%, var(--rv-fg))` keeps amber readable on white).
- Disabled: 35% opacity, hover suppressed.
- Focus: 2px ink outline, 2px offset (pins: accent ring instead).
- Muted-by-filter: 22–35% opacity on the whole node.

## Motion

Ease-out only (`--rv-ease`), no bounce/elastic. 130ms for state changes, 180ms
popover entrances (fade + 6px rise), 200ms pin pop-in. Transform/opacity only —
never animate layout. `prefers-reduced-motion: reduce` collapses everything to
instant; the components also gate JS-driven entrances on the same query, and
**hidden pages** (background tab, agent-driven browser) skip animation paths
entirely — rAF, smooth scroll, and View Transitions don't run there.

The "materialize" set (live frames — all state-conveying, none decorative):

- **Preview→live crossfade**: 200ms opacity on the cached-bitmap layer, only
  once the real page has painted (double-rAF after load). Never fade to white.
- **LIVE badge**: 11px hairline pill in the frame header, `--rv-good` 6px dot,
  130ms fade+2px rise entrance. Quiet — it states a fact, it doesn't celebrate.
- **Slides stepping**: a named View Transition (`rv-slide-frame`, 200ms,
  `--rv-ease` curve) morphs the stage frame between screens. Feature-gated;
  absent = instant swap, which is also the reduced-motion behavior.
- **No-snapshot loading**: the placeholder breathes at 1.1s alternate opacity
  (0.55↔1) — the only looping animation in the system, and it only exists
  while a live page loads with nothing else to show.

## Bans (match-and-refuse)

Side-stripe accent borders · gradient text · glassmorphism beyond the sanctioned
`backdrop-filter` on header/toolbar/hint · decorative motion · arbitrary
z-index (scale: header/section 10 · toolbar 20 · menus 30; overlay pins ride
document order) · a second font family · uppercase headings · shadows on
resting cards · new colors outside the token set.
