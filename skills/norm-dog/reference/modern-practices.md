# Norman, translated to the modern surface

*The Design of Everyday Things* (2002 edition, bundled here) is about doors, stoves, faucets, and
phones with physical buttons. Its principles are timeless; its examples predate the touchscreen,
the network, and the design system. This file is the translation layer — how each Norman idea shows
up on a screen in 2020s software — so the skill audits *today's* interfaces with *his* rigor. Read
it alongside the field guide.

The rule of thumb: **Norman's principles never change; only the tells do.** When you catch yourself
reaching for a purely modern heuristic ("use skeleton loaders," "hit 44px targets"), trace it back
to the principle it serves (feedback, slip-prevention). The principle is why; the practice is how.

## Affordances → signifiers (the one vocabulary update to know)

The 2002 edition talks about **affordances** (what an object lets you do) and **perceived
affordances**. Norman's *later* revision (2013) split out **signifiers** — the perceivable *signal*
that an affordance exists — because on a flat screen everything is technically "clickable," so the
real design problem is *signaling* what's interactive. This skill uses the 2002 vocabulary but
you should think in signifiers for digital:

- A button affords tapping; its *signifier* is the fill, shadow, or shape that says "I'm a button."
  A flat text label with a tap handler has the affordance but no signifier — a Gulf of Execution.
- Gesture actions (swipe-to-delete, long-press, pull-to-refresh, drag-to-reorder) have **no
  built-in signifier**. They are invisible until discovered. Any gesture-only path needs a visible
  hint (a peeking action, an arrow, a hint animation) and, ideally, a visible alternative.
- The inverse failure: something that *looks* interactive but isn't (underlined non-links, cards
  with hover states that don't act, disabled buttons that look enabled).

## The four principles, in modern tells

**Conceptual model** — the mental model the UI installs about how the system works:
- Autosave vs. explicit save; optimistic UI (showing success before the server confirms) vs. pending
  states. Whatever model you imply, the system must honor it — optimistic UI that silently rolls
  back teaches "I can't trust what I see."
- Sync/offline: does the user understand what's local vs. saved to the server? A queued action on a
  bad connection needs to *say* it's queued.
- Sensible system status: "logged in as," "editing draft," "changes saved 2s ago" keep the model true.

**Visibility** — modern state that must be perceivable:
- Loading (spinner/skeleton/progress), empty, error, success, disabled, selected, focused. Each is a
  distinct state a user must be able to read at a glance. Missing loading state = looks frozen;
  missing empty state = looks broken.
- "Where am I": step indicators in flows, active-tab styling, breadcrumbs, the current filter set
  shown and clearable.
- Focus visibility for keyboard users (never remove focus outlines without replacing them).

**Mapping** — action-to-result on screen:
- Progress bars/steppers must track *real* progress (no fake 99% stalls).
- Direct manipulation (drag, slider, reorder) should preview the result as you go.
- Navigation mapping: back should go back to prior *state*, not reload or exit the flow;
  deep links and the browser back button should behave.
- **Custom pan/zoom canvases can hijack browser chrome.** A two-finger trackpad pan is *also* the
  OS/browser's swipe-navigation gesture (back/forward). `preventDefault()` on the canvas's own
  wheel handler doesn't reliably suppress it — that gesture recognizer runs independently — so the
  user's intended pan randomly kicks them out of the app. Set `overscroll-behavior-x: none` on the
  pannable surface and verify on a real trackpad, not a mouse wheel; a mismatch here is a broken
  mapping between the gesture and its result, and it's intermittent, so it's easy to ship unnoticed.
- **Direct manipulation must stay responsive as content streams in.** On a canvas/board/whiteboard,
  content entering the viewport during a pan often triggers real work (loading live pages, heavy
  components, network fetches). If that work is unbounded and synchronous with the gesture, the pan
  itself stutters — breaking "preview the result as you go" into "the world lags behind my hand."
  Bound concurrent loads with a small queue, and don't let a fixed-pixel viewport margin scale in
  *world* units — at high zoom it balloons into a large on-screen prefetch radius, pulling far more
  off-screen content into the "must load now" set than is ever actually visible.

**Feedback** — the modern feedback vocabulary:
- Inline validation (say what's wrong, where, and how to fix — at the field, at the right time:
  usually on blur or submit, not on every keystroke of a half-typed email).
- Toasts/snackbars (transient — never put a *required* action or a message the user must read in
  something that auto-dismisses).
- Optimistic feedback + reconciliation; pending/disabled states on the button that was pressed to
  prevent double-submit.
- Haptics and micro-animation as feedback on touch; sound sparingly.

## Slips & mistakes, on touch and networks

- **Touch slips:** fat-finger errors are the dominant slip on mobile. Targets should be roughly
  44×44pt (iOS HIG) / 48×48dp (Material) with spacing; destructive actions kept away from where the
  thumb rests and away from routine actions.
- **Prefer Undo to Confirm** for reversible actions (the Gmail "Undo send" pattern). Confirmation
  dialogs are a forcing function for the *irreversible* only; overused, they train click-through so
  the one that matters is dismissed reflexively.
- **Network mistakes:** a slow or failed request needs a real state, a retry, and no lost input.
  Never let a timeout look like a completed action, or a completed action look like a timeout.
- **Autofill/autocorrect** silently altering fields is a modern slip source — respect autofill
  tokens, don't fight the password manager, and show what got filled.

## Accessibility is Norman's principles for more people

Norman designed for the ordinary person; accessibility extends "ordinary" to include motor, visual,
auditory, and cognitive differences. It is not a separate checklist bolted on — it *is* visibility,
mapping, and feedback, made robust:
- **Keyboard path:** every action reachable and operable without a mouse/touch (this is mapping +
  execution for a whole population). Any drag-only or hover-only interaction is a Gulf of Execution
  for keyboard users — provide an alternative.
- **Screen-reader semantics:** labels, roles, and state announced (an icon-only button with no
  accessible name is invisible — a total loss of the signifier).
- **Contrast and text size:** visibility, literally. WCAG AA (4.5:1 body text) is the floor.
- **Motion:** respect `prefers-reduced-motion`; never convey meaning by motion or color alone.
- **Focus management** in modals and route changes: send focus where the user's attention should go,
  and trap it in modals so it doesn't wander behind them.

Flag accessibility failures as first-class usability blockers in an `audit`, not as an afterthought.
When the deep fix is visual (contrast, focus styling), name `impeccable`; when it's structural
(keyboard path, semantics), it's squarely Norman's lane.

## Responsive & context

The same screen is many screens: phone, tablet, desktop; portrait/landscape; slow/fast network;
one-handed on a train. Norman's "design for the actual person in their actual situation" now means:
- Verify the loop closes at mobile width, not just the desktop mock. Most feedback-location and
  target-size failures only appear on a phone.
- Respect the platform's conventions (iOS vs Android vs web back behavior, share sheets, system
  fonts) — violating them breaks the user's existing conceptual model.

## Dark patterns: good design, inverted

Dark patterns are Norman's principles deliberately weaponized against the user — and worth naming
when you see them, because they are usability failures *by design*:
- Confirmshaming, disguised ads, sneak-into-basket, roach-motel cancellation (easy in, hard out),
  pre-checked opt-ins, fake urgency/scarcity, misdirected visual hierarchy (the "decline" made
  invisible next to a loud "accept").
- The tell: the design makes the action that benefits the *business* easy and the action that
  benefits the *user* hard or hidden — the opposite of natural mapping and honest feedback.
Call these out plainly in an `audit`. Norman's ethic is that design is an act of communication in
the user's interest; a dark pattern is a lie.

## Modern methods that fit the skill

These are contemporary techniques that operationalize Norman without replacing him — reach for them,
but keep them subordinate to the principle they serve:
- **Jakob Nielsen's 10 heuristics** overlap heavily with Norman (visibility of system status = his
  feedback/visibility; match to the real world = conceptual model; error prevention = his
  constraints). Use them as a cross-check, not a substitute for walking the loop.
- **Fitts's law** (target size/distance) and **Hick's law** (choice count → decision time) quantify
  slip-risk and Gulf-of-Execution load.
- **Progressive disclosure** keeps knowledge in the world without shouting everything at once
  (field-guide §4's balance).
- **Design systems / tokens:** consistency of components *is* conceptual-model consistency at scale.
  When editing, use the system's components and tokens; a one-off control breaks the model the rest
  of the app taught.

When in doubt, go back to the source: *The Design of Everyday Things*. Everything here is just Norman,
wearing modern clothes.
