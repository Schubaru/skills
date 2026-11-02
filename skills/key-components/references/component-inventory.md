# Component Inventory

The fixed list, in the fixed build order. Build Core always; build Extended only when the spec's `components.tier` says so (or names a subset). Components are grouped by surf's five categories plus Layout. Every component gets one file, named exactly as listed, and one entry in `components/manifest.json`.

Universal rules (apply to every component, don't repeat them per entry):

- Consume semantic tokens only. No literals. Component tokens only where the doc below lists one.
- States for anything interactive: `default`, `pressed` (RN/iOS) / `hover` + `active` (web), `focus-visible`, `disabled`. Add `loading`, `selected`, `error`, `readOnly` where listed. Disabled uses `opacity.disabled` on the whole control, not a separate palette.
- Sizes: `sm` `md` `lg` where listed; `md` is default. Size changes height, horizontal padding, and font role size together; never independently.
- Touch targets ≥ 44pt on iOS/RN, ≥ 48dp on Android, ≥ 24px web. If the visual is smaller (e.g. `sm` IconButton), extend the hit area with padding/`hitSlop`, not the visual.
- Accessibility props: `accessibilityRole`/`accessibilityLabel` (RN), semantic HTML element + `aria-*` (web), `.accessibilityLabel` + traits (SwiftUI). A visible focus ring using `border.focus`, 2px, offset 2.
- Every component exports its props type and a `Sizes`/`Variants` union so the playground manifest can enumerate them.
- Doc block at the top of each file: category, purpose in one sentence, "use for", "don't use for", anatomy list.

Manifest entry shape (the playground script reads this):

```json
{ "name": "Button", "category": "actions", "tier": "core",
  "variants": ["primary","secondary","tertiary","danger"], "sizes": ["sm","md","lg"],
  "states": ["default","pressed","disabled","loading"], "file": "Button.tsx" }
```

---

## Core tier (always built, in this order)

### Actions

**1. Button** — the primary way to trigger an action.
- Anatomy: container, label, optional leading icon, optional trailing icon, loading indicator (replaces label, keeps width).
- Variants: `primary` (bg.accent), `secondary` (surface + border.strong), `tertiary` (no bg, text.accent), `danger` (bg.danger.strong).
- Sizes: sm 32 / md 44 / lg 52 height (RN); label role `label.sm|md|lg`.
- States: default, pressed, focus-visible, disabled, loading.
- Props: `variant`, `size`, `label`, `onPress`, `leadingIcon`, `trailingIcon`, `loading`, `disabled`, `fullWidth`.
- Don't: use for navigation (that's Link), stack more than one primary per view.

**2. IconButton** — Button with only an icon.
- Variants: `filled`, `outlined`, `ghost`. Sizes sm 32 / md 44 / lg 52, square, radius `md` (or `full` if profile is pill).
- Requires `accessibilityLabel`; the file should make it a required prop.

**3. Link** — inline or standalone navigation text.
- Variants: `inline` (inherits surrounding role, underline on web), `standalone` (label role, optional trailing chevron).
- States: default, pressed/hover, focus-visible, visited (web only).

**4. Chip** — compact selectable/filter/input token.
- Variants: `filter` (toggle selected), `input` (removable, trailing ×), `suggestion`.
- Sizes: sm 28 / md 32. Radius `full`.
- States: default, selected, pressed, disabled.
- Don't: use as a Button; a Chip changes state or filters, it doesn't submit.

### Inputs

**5. TextField** — single-line text entry.
- Anatomy: label (above), container, optional leading icon/prefix, input, optional trailing icon/action (clear, visibility), helper text, error text, character counter.
- Variants: `outlined` (default), `filled`.
- Sizes: md 44 / lg 52.
- States: default, focus, error, disabled, readOnly.
- Props: `label`, `value`, `onChangeText`, `placeholder`, `helperText`, `errorText`, `leading`, `trailing`, `secureTextEntry`, `keyboardType`, `maxLength`, `size`, `variant`.
- Component tokens: `textField.height.md|lg` (alias of size table).

**6. TextArea** — multi-line TextField. Same anatomy minus trailing action; `minRows`, `maxRows`, auto-grow.

**7. Checkbox** — binary or indeterminate selection with label.
- States: unchecked, checked, indeterminate, disabled, error. Box 20×20, radius `xs`, hit area 44.

**8. Radio / RadioGroup** — single selection. Same sizing as Checkbox, circle. Group manages value.

**9. Switch** — on/off setting with immediate effect.
- Track 51×31 (iOS metric) with `switch.track.width/height` component tokens; thumb 27. Colors: `bg.accent.default` on, `neutral.300/600` off.
- Don't: use for choices that require a submit; that's Checkbox.

**10. Select** — pick one from a list.
- Anatomy: TextField-like trigger with trailing chevron + a Sheet (mobile) or Menu (web) of options.
- States: default, focus, open, error, disabled.

### Feedback

**11. Toast** — brief, auto-dismissing confirmation.
- Variants: `neutral`, `success`, `warning`, `danger`, `info` (uses `bg.<intent>.strong` + `text.inverse` or `.subtle` + `text.<intent>`; pick one per spec `feedback.toastStyle`, default strong).
- Anatomy: icon, message, optional action. Duration `motion.duration` based, default 4000ms; bottom on mobile, top-right web.

**12. Alert** — persistent inline message.
- Variants same as Toast, always `.subtle` background with `border.<intent>` left rule or full border.
- Anatomy: icon, title, description, optional actions, optional dismiss.

**13. Dialog** — modal confirmation/decision.
- Anatomy: scrim (`overlay.scrim`), container (`surface.overlay`, radius `xl`, elevation 4), title (title.md), body (body.md), action row (primary right, secondary left; stacked on narrow).
- Props: `open`, `title`, `description`, `primaryAction`, `secondaryAction`, `destructive`.
- Don't: use for anything that isn't a decision; that's Sheet or Alert.

**14. Sheet** — bottom sheet (mobile) / side drawer (web) for content and forms.
- Anatomy: scrim, grabber, header, scrollable content, optional sticky footer. Detents `half`, `full`.

**15. Skeleton** — loading placeholder. Shapes: `text` (lines), `rect`, `circle`. Shimmer respects reduce-motion.

**16. Spinner** — indeterminate activity. Sizes sm 16 / md 24 / lg 32. Color `icon.accent` or `icon.onAccent`.

### Navigation

**17. TopBar** (NavigationBar / AppBar) — screen header.
- Anatomy: leading (back or close), title (title.md, centered on iOS, leading on web/Android), trailing actions (≤2), optional large-title mode (iOS).
- Variants: `default`, `transparent`.

**18. TabBar** — bottom primary navigation (mobile).
- 3–5 items; icon + label (label.sm); active `text.accent`/`icon.accent`; inactive `text.muted`. Height 49 + safe area. Badge slot per item.

**19. Tabs** (segmented / underline) — switch views within a screen.
- Variants: `underline` (default web), `segmented` (default iOS; fill `bg.muted`, selected `surface.raised` + elevation 1).

### Status

**20. Badge** — count or dot indicator attached to another element.
- Variants: `dot`, `count` (max 99+). Colors `bg.danger.strong` default, `accent` optional. Never contains text longer than a number.

**21. Tag** — categorization label, non-interactive.
- Variants: intents `neutral | accent | success | warning | danger | info`, style `subtle | strong`. Sizes sm 20 / md 24. Radius `sm` (or `full` for pill profile).
- Don't: confuse with Chip (interactive) or Badge (attached indicator).

**22. Avatar** — person/entity image with fallback initials.
- Sizes xs 24 / sm 32 / md 40 / lg 56 / xl 80. Shape `circle` default, `square` option (radius `md`). Fallback: initials on `bg.accent.subtle`, `text.accent`. Optional status dot (Badge dot).

**23. ProgressBar** — determinate progress. Height 4 (sm) / 8 (md). Track `bg.muted`, fill `bg.accent.default`. `indeterminate` variant animates.

### Layout / Content

**24. Card** — grouped content container.
- Variants: `elevated` (surface.raised + elevation 1), `outlined` (surface.default + border.default), `filled` (bg.subtle).
- Padding `space.4` (compact: `space.3`). Radius `lg`. Optional `onPress` makes the whole card interactive with pressed state.

**25. ListItem** — row in a list.
- Anatomy: leading (icon/avatar/checkbox), title (body.md), optional subtitle (caption.md, text.muted), trailing (chevron / value / switch). Min height 44 (single line) / 60 (two lines). Divider via `border.subtle`, inset to content.

**26. Divider** — horizontal or vertical rule, `border.subtle`, hairline width. Optional inset.

**27. EmptyState** — nothing-here view.
- Anatomy: illustration/icon slot, title (title.md), description (body.md, text.muted), optional primary action. Centered, max width 320.

---

## Extended tier (built only when requested)

Same rules apply. Build in this order when included.

**Actions:** Menu (contextual list of actions, anchored), FAB (mobile), ButtonGroup, SplitButton.
**Inputs:** Slider (single/range), Stepper (numeric +/−), SearchField (TextField preset with leading search icon, clear, cancel on iOS), DateField / DatePicker (native picker wrapper), FileUpload (web), OTPInput.
**Feedback:** Banner (full-width, page-level), Tooltip (web/desktop only; mobile uses long-press Popover), Popover, ProgressRing.
**Navigation:** Breadcrumb (web), Pagination (web), SideNav (web/tablet), Stepper/Wizard indicator, SegmentedControl (if Tabs `segmented` isn't enough), BackToTop.
**Status:** StatusDot, Rating, Countdown/Timer text.
**Layout:** Accordion, Table (web; mobile gets a stacked-card fallback), Carousel, Grid helpers, SafeAreaScreen wrapper (RN), Section header.

## Adding a component that isn't listed

1. Decide its category. If it doesn't fit one of the six, it's probably a composition of existing components, not a new one.
2. Add it to the project's `DESIGN_SYSTEM.md` inventory section with anatomy/variants/sizes/states/don'ts *first*.
3. Then build it under the universal rules and add it to the manifest.
4. Regenerate the playground.

This keeps the system self-describing: the doc never lags the code.
