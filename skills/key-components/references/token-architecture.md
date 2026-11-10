# Token Architecture

What `scripts/build_tokens.py` produces and why. Read this before writing components or the doc so you use the names correctly. Do not hand-edit generated files; edit `style-spec.json` and re-run.

## Three tiers

```
primitive   →   semantic   →   component
color.blue.600  bg.accent.default  button.primary.bg
```

- **Primitive**: the full palette of available values. No meaning. Generated from seeds and scales.
- **Semantic**: roles mapped to primitives, per mode (light/dark). This is what components use 95% of the time.
- **Component**: only when a component needs a value no semantic role expresses (rare; e.g. `switch.track.width`). Component tokens alias semantic or primitive tokens; they never introduce raw values.

## Naming grammar

Dot-separated in `tokens.json`; the platform files convert mechanically (dots → camelCase in TS, → hyphens in CSS with the project prefix, → nested Swift enums).

```
primitive:  <category>.<family>.<step>          color.neutral.900   space.4   radius.md   font.size.400
semantic:   <property>.<intent>.<state?>        text.default   bg.accent.hover   border.danger
            font.<role>.<size>.<attr>           font.body.md.size   font.title.lg.lineHeight
component:  <component>.<part>.<property>       button.primary.bg   card.padding
```

Fixed vocabularies (do not invent new ones without adding them here and to the project doc):

- properties: `bg` `surface` `text` `border` `icon` `overlay`
- intents: `default` `subtle` `muted` `strong` `inverse` `accent` `success` `warning` `danger` `info` `disabled` `focus`
- states: `hover` `pressed` `selected`
- type roles: `display` `headline` `title` `body` `label` `caption` `mono`
- role sizes: `lg` `md` `sm`

## Primitives generated

### Color ramps
For each seed (`primary`, optional `secondary`, `accent`) and for the fixed status hues (`success` 152°, `warning` 38°, `danger` 4°, `info` 212°) and the `neutral` family: an 11-step ramp `50 100 200 300 400 500 600 700 800 900 950`. Hue and saturation come from the seed; lightness follows a fixed table so ramps across families line up. The seed itself is snapped into the nearest step so the brand color appears exactly. Neutral saturation is set by temperature: cool 6%, warm 6% at hue 40°, pure 0%.

Also `color.white`, `color.black`, and alpha primitives `color.alpha.black.{4,8,12,16,24,40,60}` and `color.alpha.white.{...}` for overlays and pressed states.

### Type
- `font.family.display|body|mono` from the spec.
- `font.weight.regular 400 / medium 500 / semibold 600 / bold 700`.
- `font.size.{100..900}` — nine steps from `baseSize × ratio^n`, n from -2 to +6, rounded to whole units. Step `300` is the base.
- `font.lineHeight.{tight 1.15, snug 1.25, normal 1.5, relaxed 1.6}`.
- `font.letterSpacing.{tight -0.02em, normal 0, wide 0.04em}`.

### Space
Base unit 4 (or 8 if the spec says). Steps `0 1 2 3 4 5 6 8 10 12 16 20 24` as multiples of the base. `density: compact` multiplies component padding tokens by 0.75, not the primitive scale.

### Radius
Profile → values:

| profile | none | xs | sm | md | lg | xl | full |
|---|---|---|---|---|---|---|---|
| sharp | 0 | 1 | 2 | 4 | 6 | 8 | 9999 |
| soft | 0 | 2 | 4 | 8 | 12 | 16 | 9999 |
| round | 0 | 4 | 8 | 12 | 16 | 24 | 9999 |
| pill | 0 | 6 | 12 | 16 | 24 | 32 | 9999 |

### Border, elevation, motion, opacity, z-index, breakpoints
- `border.width.{hairline 0.5 (RN/iOS) or 1 (web), regular 1, thick 2}` per spec.
- `elevation.{0..4}` as shadow objects (offset, blur, spread, alpha) plus an RN `elevation` int and a Swift shadow radius. Dark mode shadows lower alpha and rely on surface lightness.
- `motion.duration.{fast 120, normal 200, slow 320}` ms; `motion.easing.{standard, emphasized, exit}` cubic-bezier.
- `opacity.{disabled 0.4, muted 0.64}`.
- `zIndex.{base 0, raised 10, sticky 100, overlay 1000, modal 1100, toast 1200}`.
- `breakpoint.{sm 640, md 768, lg 1024, xl 1280}` (web only).

## Semantic mapping (light / dark)

The script maps each semantic token to a primitive per mode. The light/dark rule for neutrals is a mirror: light uses `neutral.50` for `bg.default` and `neutral.900` for `text.default`; dark uses `neutral.950` and `neutral.50`. Accent roles keep the same ramp but shift one step lighter in dark for text and one step darker for backgrounds so contrast holds.

Key semantic roles produced (abridged; the full list is in the generated file):

```
bg.default / bg.subtle / bg.muted / bg.inverse
surface.default / surface.raised / surface.overlay / surface.sunken
text.default / text.muted / text.subtle / text.inverse / text.disabled / text.accent / text.onAccent / text.success ... 
border.default / border.subtle / border.strong / border.focus / border.danger ...
bg.accent.default / bg.accent.hover / bg.accent.pressed / bg.accent.subtle
bg.success.subtle / bg.warning.subtle / bg.danger.subtle / bg.info.subtle (+ .strong)
icon.default / icon.muted / icon.accent / icon.onAccent
overlay.scrim
font.display.lg|md|sm.{family,size,lineHeight,weight,letterSpacing}
font.headline.lg|md|sm.…   font.title.lg|md|sm.…   font.body.lg|md|sm.…
font.label.lg|md|sm.…      font.caption.md|sm.…    font.mono.md|sm.…
```

Role → size-step mapping is fixed so hierarchy is identical across projects (only the ratio changes the numbers):

| role | lg | md | sm | weight | lineHeight | letterSpacing |
|---|---|---|---|---|---|---|
| display | 900 | 800 | 700 | bold | tight | tight |
| headline | 700 | 600 | 500 | semibold | tight | tight |
| title | 500 | 400 | 300 | semibold | snug | normal |
| body | 400 | 300 | 200 | regular | normal | normal |
| label | 300 | 200 | 100 | medium | snug | normal |
| caption | — | 200 | 100 | regular | snug | wide |
| mono | — | 300 | 200 | regular | normal | normal |

## Contrast guarantees

The script tests every `text.*` against the `bg.*`/`surface.*` it is documented to sit on, and every `text.on<X>` against `bg.<X>.default`, in both modes. Text pairs must reach 4.5:1; if a computed `text.onAccent` fails, the script flips it (white ↔ neutral.950) and records that in the report. Icon/border pairs must reach 3:1. Failures that can't be auto-resolved are printed as warnings and must be surfaced to the user, not silenced.

## Platform outputs

- **React Native / web TS** (`tokens.ts`): a `tokens` object with `light` and `dark` semantic trees plus `primitive`, fully typed; a `Theme` type; `useTheme()` is provided by the platform template in `platform-react-native.md`. Sizes are unitless numbers (RN points).
- **CSS** (`tokens.css`): `:root` for light, `[data-theme="dark"]` for dark, prefixed `--<prefix>-text-default`. Sizes in `px`; font sizes also emitted as `rem` variants.
- **Swift** (`Tokens.swift`): `enum <Prefix>Tokens` with nested `Color` (using `Color(hex:)` extension emitted alongside), `Space`, `Radius`, `Font` (returns `Font.custom` or `.system` by weight/size), and a `Theme` struct with `light`/`dark` resolved via `@Environment(\.colorScheme)`.

The platform files are *derived*. If they look wrong, the fix is in the spec or the script, never in the output.
