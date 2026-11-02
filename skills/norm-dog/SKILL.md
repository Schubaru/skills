---
name: norm-dog
version: 1.0.0
user-invocable: true
argument-hint: "[audit|shape|harden|polish] [screen, flow, or description]"
description: Use when auditing, shaping, hardening, or polishing the UX of any app, website, screen, or flow from Don Norman's perspective (The Design of Everyday Things). Walks an interface step-by-step as the real user and finds the exact spots where they can't form a correct mental model, can't tell what to do, can't tell whether what they did worked, or can slip into the wrong action. Grounded in Norman's Seven Stages of Action, the Gulfs of Execution and Evaluation, and his four principles of good design (a good conceptual model, visibility, natural mapping, feedback), applied to modern digital interfaces. Reach for this whenever the user points at a screen, form, checkout, onboarding, dashboard, wizard, modal, or flow and wants it checked, fixed, or "run Norman on it," or says a user "would get stuck," "wouldn't know what to do," "can't tell if it worked," "would misread this," "would rage-click," or "the flow breaks." Make sure to use this skill even when the user doesn't say "Don Norman" or "norm-dog" — any request to assess, redesign, error-proof, or polish whether an interaction actually WORKS (as opposed to how it looks or reads) belongs here. Keyword functions like the impeccable skill, invoked as `audit` (find the usability blockers), `shape` (design a new screen/flow so the user can't get lost), `harden` (design against user error such as slips vs mistakes, using constraints and forcing functions), and `polish` (final Norman pass). Not for purely visual/aesthetic polish (that is the impeccable skill) or line-level prose (that is ux-copywriter); this is about whether the interaction and the flow are usable.
---

Audits and improves interfaces through Don Norman's eyes. The unit of design here is not a
button or a hex value in isolation: it is **a real person pursuing a goal through a screen or a
flow**. So Norman's framework applies almost literally. Every interaction is a small loop of the
Seven Stages of Action: the user forms a goal ("book the appointment," "understand this price"),
figures out what to do, does it, then reads the result to see if it worked. An interface is usable
when that loop closes cleanly at every step. It fails wherever a **Gulf of Execution** opens (the
user can't tell what to do or how) or a **Gulf of Evaluation** opens (the user did something but
can't tell what it meant or whether it worked).

This skill finds those gulfs, names them at the exact screen or control, and closes them.

## The source of truth

This skill is Don Norman's *The Design of Everyday Things* (revised edition, 2013) applied to
software. The book is the primary source for every principle here; it is not bundled, so if the
user has a copy (a PDF in the project, say), read the relevant chapter when you need the exact
argument, a precise definition, or a fresh example. The field guide distills it. Chapter map: **1** Psychopathology of Everyday Things (p1) ·
**2** Psychology of Everyday Actions — Seven Stages + the two Gulfs (p34) · **3** Knowledge in the
Head and in the World (p54) · **4** Knowing What to Do — constraints (p81) · **5** To Err Is Human
— slips vs mistakes (p105) · **6** The Design Challenge (p141) · **7** User-Centered Design (p187).

Norman wrote about doors, stoves, and phones. Translating him to screens, touch, and networked
software is the skill's real work — read
[reference/modern-practices.md](reference/modern-practices.md) to bridge his vocabulary
(affordances, visibility, mapping) to the modern surface (signifiers, touch targets, loading and
optimistic states, accessibility, responsive layout, design systems, and dark patterns as the
inverse of good design). His principles are timeless; the tells are contemporary.

## Setup

Do these before running any command. They are what let you audit the user's real experience
rather than guess from the markup.

1. **Resolve the target to one concrete screen or flow.** The argument is usually a route/URL
   (`/checkout`), a screen name ("the intake review page"), a component, or a description ("the
   sign-up flow"). Find what the user means and locate the code or the running screen behind it. A
   single screen is one target; a flow (onboarding, checkout, a multi-step wizard) is a legitimate
   single target too — but if the user gestures at a whole app, ask which screen or flow to start
   with. Auditing everything at once produces mush.
2. **Reconstruct what the user actually sees and does.** Read the component(s) that render the
   target and the state/logic behind them: what's visible at each moment, what's interactive, how
   an action changes state, when validation fires, what gates the primary action (a disabled
   button, a required field), what feedback appears and where, and how it behaves on a phone. The
   gulfs live in the rendered experience, not the raw data — so if a running preview is available,
   drive it and look; otherwise build the picture from the code (markup + state + handlers +
   styles).
3. **Read [reference/field-guide.md](reference/field-guide.md).** Non-optional for every command.
   It is the Norman lens: the Seven Stages applied to a single interaction, the two Gulfs, the four
   principles, the error taxonomy (slips vs mistakes), constraints and forcing functions, each
   with concrete interface examples. Without it you will fall back to generic UX-checklist reflexes
   and lose the whole point, which is to see the interface the way Norman would.
4. **Read the command reference** for whatever function the user invoked
   (`reference/<command>.md`). It defines that command's flow. Skipping it drops steps the user
   expects.

Norman audits by walking the stages in his head, and that is exactly the method here: reconstruct
what the user sees at each moment — from the running screen or from the code plus your model of
how it renders — and walk it as that person. Drive the real screen when you can; reason it out
faithfully when you can't.

## The lens in one screen

Judge every interaction against Norman's four principles of good design. These are the whole
rubric; the field guide expands each with interface-specific tells.

- **Conceptual model.** Does the interface build the *right* model in the user's head, and never a
  wrong one? Every screen implies a model of how the system works ("this saves as I type" vs "I
  must press Save"). The danger is the model the design accidentally teaches: a spinner that never
  resolves teaches "it's broken"; a form that silently discards input on error teaches "don't
  trust this." A wrong model is worse than a missing one.
- **Visibility.** By looking, can the user tell what state they're in and what they can do next?
  Where am I in the flow, is this action available or blocked, did my tap register, is it loading
  or stuck? Hidden state is a Gulf of Execution.
- **Mapping.** Does what the user does map naturally to what they intend and to what results? A
  progress indicator should map to "where I am." Tapping a control should map to "I did that." A
  toggle whose on/off state is ambiguous, or a "Submit" that lands them somewhere unexpected,
  breaks the mapping between action and result.
- **Feedback.** After every action, does the user get immediate, specific feedback? A saved
  confirmation, an inline validation message that says *why* a value is rejected, a loading state
  that shows progress — that is the loop closing. Generic feedback ("Error") that doesn't say what
  or why leaves the Gulf of Evaluation half-open.

Two more, always in view:

- **Knowledge in the world vs. in the head.** A step that needs the user to remember something
  from an earlier screen (a code, a choice, a total) opens a gulf. Put what they need where they
  need it. A confirmation screen that omits what they just ordered, or a password rule shown only
  *before* the field, is the classic trap.
- **Slips vs. mistakes.** A **slip** is the right intention, wrong action (a misclick, two buttons
  so alike the user hits the wrong one, "Delete" next to "Save"). A **mistake** is the wrong
  intention from a wrong model (the copy misled them, so they confidently did the wrong thing).
  Both are design failures with different fixes: constrain against slips, clarify the model against
  mistakes.

## Commands

| Command | What it does | Reference |
|---|---|---|
| `audit [target]` | Walk the screen or flow as the real user, find and rank every usability blocker. Read-only report. This is the flagship: "run Norman on this." | [reference/audit.md](reference/audit.md) |
| `shape [idea]` | Design a new screen or flow so the user can't get lost: establish the target conceptual model and the per-step action loop before building UI. | [reference/shape.md](reference/shape.md) |
| `harden [target]` | Error-proof an existing screen/flow through Norman's error framework: slips vs mistakes, constraints, forcing functions, graceful recovery. Edits the interface. | [reference/harden.md](reference/harden.md) |
| `polish [target]` | Final Norman pass: close the last half-open gulfs, tighten feedback quality and natural mapping, sweat the details. Edits the interface. | [reference/polish.md](reference/polish.md) |

## Routing

1. **First word matches a command** (`audit` / `shape` / `harden` / `polish`): run setup, read
   that command's reference, follow it. Everything after the command name is the target.
2. **First word doesn't match but the intent is clear** ("where would a user get stuck in
   checkout?" → `audit`; "help me design a sign-up flow" → `shape`; "make sure nobody can delete
   the wrong item by accident" → `harden`): load that command and proceed as if invoked.
3. **No argument**: the user is asking what to do. The default and most valuable move is `audit`
   on a specific screen or flow: offer it, name a target if the conversation implies one, then
   show the table. Never auto-run; recommend and let the user confirm.
4. **No clear command match**: treat it as a general Norman review of the named target, applying
   setup, the lens above, and the field guide.

## Scope discipline

- **One screen or flow at a time.** Every command targets a single screen or a single coherent
  flow. If asked to sweep an entire app, do it one screen/flow at a time and say so.
- **This is usability, not decoration.** Aesthetic and visual-design quality is the `impeccable`
  skill; line-level prose and microcopy are the `ux-copywriter` skill. When a blocker is really a
  copy problem or a visual problem, name it and point at the right skill rather than fixing it
  here. Norman's domain is whether the interaction and the flow *work*.
- **Findings name the exact screen and the exact element.** "Improve feedback" is useless.
  "Checkout step 2: the promo-code field accepts an invalid code, clears itself on submit, and
  shows no message, so the user can't tell what happened — a Gulf of Evaluation" is a finding.
  Specificity is the entire value.
