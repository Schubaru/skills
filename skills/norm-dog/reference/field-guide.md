# The Norman field guide, applied to interfaces

This is the lens every `norm-dog` command reads first. It takes the framework from *The Design of
Everyday Things* (the 2002 edition bundled in this skill: it says **visibility**, not
"discoverability," and speaks of **affordances** without the later "signifier" vocabulary, so this
skill uses Norman's original terms and bridges to modern ones in
[modern-practices.md](modern-practices.md)) and points it at the one artifact you actually audit:
a real person pursuing a goal through a screen or a flow.

Read it once, then hold it while you walk the interface. The point is to stop reviewing like a
generic UX checklist and start seeing the screen the way Norman saw doors, stoves, and phones: as
a machine whose usability is decided by whether an ordinary person can tell what to do and whether
it worked. When you need the exact argument or a fresh example, go to the book itself (chapter map is in
SKILL.md).

## Table of contents

1. The Seven Stages of Action, per interaction
2. The two Gulfs (your primary hunting ground)
3. The four principles of good design
4. Knowledge in the world vs. in the head
5. The error taxonomy: slips vs mistakes
6. Constraints and forcing functions
7. The flow as a whole: the arc-level checks
8. UI-pattern cheat sheet (where each common pattern tends to fail)

---

## 1. The Seven Stages of Action, per interaction

Norman models every human action as seven stages: form a **goal**, form an **intention**,
**specify** an action, **execute** it, **perceive** the new state of the world, **interpret** it,
**evaluate** it against the goal. Execution is the first four; evaluation is the last three.
(Chapter 2 of the book.)

A single interaction — filling a field, tapping a button, choosing an option — is a tiny instance
of this loop. Walk it literally for each meaningful step of the screen or flow:

- **Goal.** What does the user want here? Usually something concrete they came to do ("pay,"
  "reset my password," "compare two plans"). Sometimes the screen imposes a sub-goal ("verify your
  email before continuing"). Is that sub-goal one the user actually holds, or one the design
  assumes and never explains?
- **Intention + specify.** Given the goal, does the user know *what to do* on this screen? Which
  field, which button, tap or swipe or type? If they'd hesitate ("wait, what does this screen want
  from me?"), that hesitation is a **Gulf of Execution**.
- **Execute.** Can they actually do it, easily? Is the target obvious, reachable, and big enough
  for a thumb? Are two actions so similar they'll do the wrong one (a slip)?
- **Perceive.** After they act, does the screen visibly change? Did the button show a pressed or
  loading state? Did the field accept the value? If nothing perceptibly happens, the loop can't
  close and the user taps again (double-submit) or assumes it's broken.
- **Interpret + evaluate.** Can they tell *what the change meant* and whether it advanced their
  goal? "I pressed Pay, saw a spinner, then a receipt with the amount and a confirmation number"
  closes the loop. "I pressed Pay and the page just sat there" leaves them interpreting silence: a
  **Gulf of Evaluation**.

Most interactions you audit are fine on stages 1–4 and fail on 5–7 (feedback and interpretation)
or on 2 (the user can't tell what the screen wants). Those are the two gulfs.

---

## 2. The two Gulfs (your primary hunting ground)

> "The Gulf of Execution is the difference between the intentions and the allowable actions. The
> Gulf of Evaluation reflects the amount of effort the person must exert to interpret the state
> of the system and to determine how well expectations have been met."

This is the single most useful pair of ideas in the book for interfaces. Almost every real blocker
is one of these two. Name which one, at which screen or control, every time.

**Gulf of Execution — "I don't know what to do / how to do it."** Tells in an interface:

- A screen that changes what it asks of the user without signaling it (a read-only summary that is
  actually an editable form, with nothing indicating the fields are tappable).
- A primary button that's disabled and the user can't tell *why* or *what unlocks it* (a "Continue"
  greyed out because one hidden required field upstream is empty, with no error pointing there).
- An interactive control that doesn't look interactive (a flat "link" with no affordance), or a
  static element that looks tappable (an underlined non-link, a card that looks pressable but isn't).
- A gesture-only action with no visible signifier (swipe-to-delete, long-press menus, pull-to-refresh)
  on a screen where nothing hints the gesture exists.
- An empty state that shows nothing to do next — no primary action, no explanation of how it fills.

**Gulf of Evaluation — "I did something but can't tell what it meant."** Tells in an interface:

- Validation that rejects a value without saying what's wrong or how to fix it ("Invalid input").
- A submit that fires with no confirmation, no spinner, and no navigation, so the user can't tell
  if it worked and re-submits.
- A toggle or setting that saves silently with no state change the user can perceive, so they don't
  know it took.
- A slow action with no loading state, indistinguishable from a frozen screen.
- A multi-step flow that advances but never says what was accomplished, so the user reaches the end
  unsure whether they actually completed the task.

For each blocker, write it as: **which gulf · which screen/control · what the user intends · what
the design gives them instead**.

---

## 3. The four principles of good design

Norman's principles, restated as the questions to ask at each interaction (his figure-2.7
design-aid questions, adapted to software):

**A good conceptual model.** The designer has a model, the system projects an image (the UI), the
user builds a model from that image. Usability is whether the user's model matches the designer's.
- Does the screen imply the *right* model of how the system works, and nothing false? A cloud app
  that shows no "Save" button teaches "it autosaves" — which had better be true, or the user loses
  work trusting a model the design taught them.
- Is the model *consistent* across the app? If tapping a row opens a detail view in one list and
  selects a checkbox in another, the user's model of "what tapping a row does" fractures.

**Visibility.** By looking, can the user tell the state and the available actions?
- Is progress visible (a step indicator, "3 of 5," a breadcrumb)?
- Is the *state of this control* visible: selected, loading, disabled, error, complete?
- Are the possible actions visible without hunting, hovering, or recalling a hidden gesture?

**Natural mapping.** The relationships between action → result and control → effect are obvious.
- Does a stepper/progress bar map to real position, or drift out of sync with the actual step?
- Does selecting an option clearly map to "this is now chosen" (filled, checked, highlighted)?
- Do controls sit near what they affect? A "delete" that acts on a selection made far away, or a
  settings toggle whose effect appears on a different screen, is a weak mapping.

**Feedback.** Full and continuous information about the results of actions.
- Immediate: does it appear right when they act, not seconds later or only after navigation?
- Specific: does it reference *their* action and say *what* and *why* ("Card declined — check the
  expiry date," not "Error")?
- Located where they're looking (inline next to the field, not in a toast that's already gone, not
  at the top of a long form the user has scrolled past)?

---

## 4. Knowledge in the world vs. in the head

Norman's rule (Chapter 3): put knowledge *in the world* so people don't have to hold it *in the
head*. Memory is expensive and lossy; visible information is free at the point of use.

In an interface this is about **working memory across a flow**. The user should never have to
remember a value, a rule, or a choice from an earlier screen to act on the current one, unless the
task genuinely requires recall and the design has supported it.

Tells:
- A confirmation screen that omits what the user is confirming ("Are you sure?" with no object).
- A password field whose rules were shown *before* the field and are now scrolled off, so the user
  guesses and fails.
- A one-time code on one screen that must be typed on the next, with no autofill and no way to see
  both at once (especially painful on mobile, switching apps to read an SMS).
- A total or selection made three steps back that the final step assumes but doesn't restate.
- A form that clears itself on a validation error, forcing the user to reconstruct from memory what
  they'd typed.

The counter-balance: don't put *everything* in the world either. A screen drowning in restated
context, tooltips, and helper text has its own Gulf (visibility collapses when everything shouts).
The skill is putting *exactly what this step needs* where the user will look.

---

## 5. The error taxonomy: slips vs mistakes

Norman splits human error into two kinds (Chapter 5), with different fixes. Tag every error-risk
you find.

**Slip: right intention, wrong action.** The user knew what they meant to do and mis-executed.
In interfaces:
- Two controls so alike (wording, or "Save" and "Save as draft," or a destructive action styled
  like a benign one) that a user who understands still taps the wrong one.
- A tap target too small or too close to its neighbor (a tiny "x" beside a big "Buy").
- A destructive action ("Delete account") sitting where the user's thumb rests after a routine tap,
  with no separation.
- Autocomplete or autocorrect silently changing a field the user thought they'd set.
Fix slips with **constraints and layout**: separate and differentiate controls, move destructive
actions away from routine ones, widen targets, confirm only the truly irreversible. Don't fix a
slip by adding more words; the user already understood.

**Mistake: wrong intention, from a wrong model.** The user did exactly what they meant, but what
they meant was wrong because the design taught them wrong.
- Misleading copy or a mislabeled button led them to a confident wrong action ("Submit" that
  actually cancels).
- An icon implied the wrong function (a floppy-disk that shares instead of saves).
- An ambiguous prompt, so a reasonable reading points at the wrong choice: a design mistake
  masquerading as a user error.
- A default that's wrong for most users, so those who trust it end up somewhere they didn't intend.
Fix mistakes with **clarity and the conceptual model**: fix the label, the icon, the copy, the
prompt, or the default. If a "wrong" action is actually the reasonable thing to do, the design set
the trap, not the user.

The most important move in the whole skill: when a user would do something "wrong," decide **whose
fault the design made it.** If any sensible user reaches it, it's a design failure to fix, not a
user error to punish with a scolding error message.

---

## 6. Constraints and forcing functions

Norman (Chapter 4): the best error message is the one that never needs to appear, because the
design made the error impossible. **Constraints** prevent wrong actions; **forcing functions** stop
the flow until a condition is met.

In interfaces these are powerful but easy to misuse; audit them for **fit**, not just presence:

- **A disabled primary action** (Continue greyed until the form is valid) is a forcing function.
  Good when the gate is visible and the user can tell *what releases it*. A **trap** when the button
  is dead and nothing says which field is missing or invalid — the user is stuck with the goal
  intact and no allowable action. Every forcing function needs a visible, reachable release: show
  the blocking error, scroll to it, name it.
- **Input masks and typed inputs** (a date picker instead of a free-text date, a numeric keypad for
  a phone number) are constraints that make malformed input impossible. Good — but only if they
  don't block legitimate values (a phone mask that rejects international formats is a false
  constraint).
- **Confirmation dialogs** are forcing functions against destructive slips. Good for the truly
  irreversible (delete account, send money); noise when overused (a confirm on every trivial,
  undoable action trains the user to click through blindly — so the one that matters is also
  clicked through). Prefer **undo** over **confirm** wherever the action is reversible: it respects
  the common case and still protects the rare mistake.
- **Required fields / validation** constrain what counts as complete. Good when the requirement is
  visible up front and errors are specific. Bad when a field is secretly required and only reveals
  it on submit.

When you *recommend* a new constraint or forcing function (usually in `harden`), prefer the gentle
kind: a smart default, an input mask, a visibly distinct destructive action, an undo, over a hard
block or a modal. Norman prefers making the right action easy to making the wrong action forbidden.

---

## 7. The flow as a whole: the arc-level checks

Zoom out from individual screens. A flow is a sequence, and sequences have their own usability.

- **Does the entry point set a truthful conceptual model of the journey?** A first screen or a
  progress indicator previews the plan. If it promises three steps and there are seven, or hides a
  big demand ("we'll need your ID and a selfie") behind a cheerful "Get started," the user's model
  of what's ahead is wrong: a slow-motion Gulf of Execution, and a prime spot for abandonment.
- **Is the model consistent end to end?** Track the interaction patterns. Note every screen where
  the rules shift without a bridge (tap-to-select becomes swipe, autosave becomes manual save).
- **Does difficulty ramp sanely?** Ask for easy, low-commitment things before high-effort or
  high-anxiety ones (email before credit card; preferences before identity verification). A cold
  demand for sensitive data as step one is a cliff.
- **Peak and end.** Frustration compounds, and the last moment colors the memory of the whole flow.
  Where is the hardest or most anxious moment (payment, a permission request, an irreversible
  action), and does the design give reassurance there? Does the final screen confirm what was
  accomplished, closing the whole flow's evaluation stage — or dump the user back somewhere with no
  "you're done, here's what happened"?
- **Is every screen's *purpose* legible to the user**, not just to the product team? A step that
  exists for business reasons ("collect this for marketing") but reads as pointless friction breaks
  trust and drives drop-off.

---

## 8. UI-pattern cheat sheet (where each common pattern tends to fail)

Fast reference for the failure modes each common pattern invites. Use it to move quickly, not as a
substitute for walking the actual screen.

- **Landing / entry screen** — Sets the journey's conceptual model. Fails when the primary action
  is unclear or competes with five others, or when it under-promises the effort ahead (a friendly
  CTA hiding a long, invasive flow).
- **Forms & inputs** — The richest failure surface. Watch: (a) validation that fires at the wrong
  time (on every keystroke, or only on submit after the user filled everything); (b) errors that
  don't say what's wrong or where; (c) a form that clears on error (knowledge-in-the-head trap);
  (d) required fields not marked as required until they block submit; (e) wrong input type (free
  text where a picker belongs; the wrong mobile keyboard); (f) labels that vanish (placeholder-only
  fields the user can't re-read after typing).
- **Buttons & CTAs** — Fail when the primary action isn't visually primary, when a destructive
  action looks identical to a safe one, when the label describes the mechanism ("Submit") not the
  outcome ("Place order"), or when tapping produces no immediate state change (no loading, so the
  user double-taps).
- **Choices / selection (radios, checkboxes, toggles, segmented controls)** — Fail when the current
  selection isn't visible, when a toggle's on/off meaning is ambiguous, when single-vs-multi select
  is unclear, or when selecting produces no perceptible confirmation.
- **Drag-and-drop / reorder / swipe actions** — Fail when the drag or swipe affordance isn't
  signaled (Gulf of Execution — the user never discovers it), when the drop target is unclear, or
  when there's no keyboard/tap fallback for a drag-only action (accessibility + a mapping problem).
- **Multi-step wizards / checkout / onboarding** — Fail when progress isn't visible, when back
  loses entered data, when a later step assumes something from an earlier one it doesn't restate,
  or when the ramp front-loads the hardest ask. Arc-level checks (§7) live here.
- **Modals & confirmations** — Fail when they interrupt without cause, when the confirm and cancel
  are swapped from convention or ambiguously labeled ("OK"/"Cancel" on a delete), or when they
  confirm something reversible that should just offer undo.
- **Feedback surfaces (toasts, banners, inline messages, loading & progress)** — Fail when a toast
  vanishes before it's read, when a loading state is missing (frozen-looking screen), when progress
  is fake or stalls at 99%, or when success is silent so the user can't tell the action worked.
- **Empty states** — Fail when they show nothing to do (a blank list with no explanation or primary
  action), missing the chance to teach the conceptual model and offer the first step.
- **Navigation (tabs, back, menus, breadcrumbs)** — Fail when the user can't tell where they are,
  when back does something unexpected (loses state, exits the flow), or when a destructive or
  dead-end path has no way back.
- **Search & filters** — Fail when applied filters aren't visible or clearable, when zero-results
  gives no path forward, or when the mapping between what was typed and what returned is opaque.
- **Media / animation / video** — Usability question is narrow: does it carry meaning a user who
  skims it would miss, and can the user control it (pause, replay, skip)? Autoplay with no control
  is a mapping and consent failure. (Aesthetic quality of visuals is `impeccable`, not this skill.)

---

*Source: Donald A. Norman, The Design of Everyday Things (2002 edition), bundled in this skill. The
framework — Seven Stages of Action, Gulfs of Execution and Evaluation, the four principles,
knowledge in the world vs. the head, slips vs mistakes, constraints and forcing functions — is his;
the interface translations are this skill's. See [modern-practices.md](modern-practices.md) for how
his vocabulary maps onto contemporary digital patterns.*
