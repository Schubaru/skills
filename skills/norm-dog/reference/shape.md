# shape — design a new screen or flow so the user can't get lost

Use before building UI, when the user wants a *new* screen or flow, or wants an existing one
rethought from the studs. `shape` produces the thinking that makes the interface good: the target
conceptual model and the per-step action loop, established before any component is written.
Norman's point: most usability failures are decided at design time, not fixed at polish time.

This command plans, then (only after the user confirms the plan) builds the UI. It does not
silently jump to code.

## Phase 1: the conceptual model, first

Before layout, settle what the interface installs in the user's head. Everything else serves this.

Answer, in conversation with the user (ask, don't assume; 2–3 questions per round):

- **The one model.** In a single sentence the user could hold, how should they understand what this
  screen/flow does and how it works? ("This saves automatically as you go; there is no submit.") The
  UI's job is to project that model so cleanly the user rebuilds it exactly.
- **The wrong models to prevent.** What plausible-but-false model might a user already hold or
  accidentally form here? (E.g. "if I leave, I lose my progress.") The design must not reinforce it,
  and ideally kills it visibly.
- **The user's goal and job-to-be-done.** What did the person actually come to do, in their words —
  not the feature name? Design serves that goal; friction that doesn't serve it is a target for
  removal.
- **Entry state.** What does the user know, have, and feel walking in (device, context, urgency,
  what they arrived with)? Norman: design for the person's actual starting model, not the expert's.

Don't move on until the one-sentence model is sharp. A fuzzy target model produces an interface
that can't be audited later because there's nothing to measure against.

## Phase 2: the flow as a chain of closed loops

Now design the sequence. Each screen/step is one action loop (field-guide §1); the flow is loops in
series. Design so every loop closes and effort ramps sanely.

For the flow, decide:

- **The spine.** The ordered steps from entry state to goal accomplished. Name each step's job.
- **Effort ramp.** Ask for easy, low-commitment things before high-effort or high-anxiety ones
  (email before payment; preferences before identity verification). No cold cliffs (a sensitive
  data demand as step one). A demand the user isn't ready for is a Gulf of Execution you're building
  on purpose.
- **The commitment/confirmation point.** Where does the user take the consequential action (pay,
  submit, delete, share)? Design that moment so the right action is obvious, the state is visible,
  and — if reversible — an undo beats a confirm.
- **The close.** A final state that confirms what was accomplished and what happens next, closing
  the whole flow's evaluation stage. Not a dump back to a dashboard with no acknowledgment.

For each screen, pre-declare its loop so the build can't drift:

- **Goal** the user holds here.
- **What the screen asks** (and how the user can tell: the visibility of the ask and the primary
  action).
- **The feedback** they get when they act (specific and immediate: what success looks like, what a
  validation error says and where).
- **The failure it must avoid** (the slip or mistake most likely here; design it out now — the
  wrong default, the look-alike destructive action, the silent submit).

Fold in the modern surface as you go (see [modern-practices.md](modern-practices.md)): loading and
empty states are part of the design, not afterthoughts; every drag/swipe needs a visible signifier
and a tap fallback; touch targets and keyboard/screen-reader paths are designed in, not bolted on;
responsive behavior is decided here.

## Phase 3: present the brief, then stop

Present a compact brief and **end the turn**. The user confirms before you build anything.

Brief shape (keep it tight; a clear plan is 6–10 bullets, not a wall):

1. **The one model** (the sentence).
2. **The user's goal + entry state.**
3. **Flow spine:** each screen/step as its job + its loop (ask → feedback), in order, showing the
   effort ramp.
4. **The commitment point + the close:** how the consequential action is made safe, and how the end
   confirms success.
5. **Open questions:** only genuinely unresolved ones; if you'd write "recommend X," just decide X.

Then stop and ask for confirmation. The pause is the point; it's what separates shaping from
premature building.

## Phase 4: build the UI (only after confirmation)

Build real components in the project, matching its existing structure, stack, component library,
and conventions (read a neighboring screen first; follow the project's copy conventions and design
system — don't hardcode values that belong to tokens). Every screen you build must close its loop
as declared in the brief, including its loading, empty, and error states. Then verify the change
actually renders and works the way the brief intends — drive the running screen if you can (the
built-in `verify` skill / preview tools), otherwise at minimum typecheck/lint and load it.

Hand off: suggest `/norm-dog audit <target>` on the fresh screen to confirm the loops close in
practice, and point at `impeccable` for visual/aesthetic polish and `ux-copywriter` for a copy
pass. Shaping gets the interaction structure right; those get the surface right.
