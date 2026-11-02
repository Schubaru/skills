# harden — design the interface against user error

Use to error-proof an existing screen or flow. Where `audit` finds gulfs, `harden` closes the ones
that are about **error**: the spots where a user slips, gets trapped, or is set up to make a
mistake. Norman's error framework (Chapter 5) is the whole method. This command edits the interface.

Norman's governing idea: the best error message is the one that never fires, because the design
made the error impossible or harmless. So `harden` prefers redesign over warnings, and gentle
constraints (and undo) over hard blocks.

## Step 1: inventory the error-risks

If a recent `audit` exists, start from its error-design findings. Either way, walk the screen/flow
and at every interactive point ask Norman's two questions (field-guide §5):

- **Where can a user slip?** Right intention, wrong action. Look for: controls that look alike or
  sit adjacent (a destructive action beside a routine one; "Save" vs "Save as draft"), tap targets
  that crowd, a primary button where a thumb rests after a habitual tap, autocomplete/autocorrect
  quietly changing a field, a swipe action that fires on a scroll.
- **Where is a user set up to make a mistake?** Wrong intention from a wrong model. Look for: a
  mislabeled button (a "Submit" that discards), an icon implying the wrong function, an ambiguous
  prompt with a reasonable reading that points the wrong way, a default that's wrong for most users,
  a validation that rejects a legitimate value.

Tag each risk **slip** or **mistake**, because the fix differs.

## Step 2: fix by kind

**Slips → constraints, layout, and forcing functions.** The user already understood; don't add
words. Instead:
- Separate and differentiate look-alike controls; move destructive actions away from routine ones
  and style them distinctly; give the primary action breathing room from just-tapped controls.
- Widen and space tap targets (mind mobile — see [modern-practices.md](modern-practices.md) for
  target sizes and gesture fallbacks).
- Where a wrong action would be costly, add the lightest guard that prevents it. **Prefer undo over
  confirm** for anything reversible; reserve confirmation dialogs for the truly irreversible. A
  smart default or a visible state change beats a modal.
- Constrain malformed input at the source (a date picker, a masked/typed field, the right mobile
  keyboard) rather than validating after the fact — but never let the constraint reject a
  legitimate value.

**Mistakes → clarity and the conceptual model.** The user did what they meant; what they meant was
wrong because the design taught it. So:
- Fix the misleading label, icon, prompt, or default. **If a "wrong" action is genuinely the
  reasonable thing to do, the design is the bug**: relabel it, change the default, or make the safe
  path the obvious one.
- Repair copy or an icon that implies the wrong rule (coordinate with `ux-copywriter` for wording or
  `impeccable` for a visual/icon fix if the real fix lives there; name that rather than half-fixing
  it here).
- Make the intended distinction explicit where the user has to make a choice they can't currently
  see the basis for (show the difference between the two options at the point of choosing).

## Step 3: audit the forcing functions you already have

Gated actions (a disabled Continue, a required-field wall, a confirmation step) are forcing
functions. For each:
- **Is the gate visible?** The user must be able to tell the action is blocked and *what releases
  it.* A dead button with no error is a trap. Add the signal: show the specific blocking error,
  scroll to it, name the missing field.
- **Is the release always reachable?** Confirm there is no state where the user does everything they
  can and the primary action stays dead. A forcing function with no reachable exit is the worst
  usability failure in the book: it strands the user with the goal intact and no allowable action.
- **Is any gate needless?** A confirmation on a reversible action, or a required field that isn't
  really required, is friction that trains click-through. Remove it or convert to undo.

## Step 4: recover gracefully

For any point where a user can end up wrong or stuck, make recovery cheap and obvious: they can
correct in place, the error message says *what* and *why* and points forward, nothing punishes a
good-faith attempt, and no work is silently lost (never clear a form on a validation error). Norman:
the system should treat error as a normal part of use, not a failure to scold.

## Step 5: apply and verify

Edit the interface in the project, matching its conventions, component library, and copy
conventions. Keep changes surgical: touch the controls with real error-risk, leave working ones
alone. Then verify the fixes behave — drive the running screen and actually try to trigger the old
error if you can (the `verify` skill / preview tools); otherwise at least typecheck/lint and reload.
In your summary, list each risk you found, whether it was a slip or a mistake, and what you changed
(or why you left it and pointed elsewhere).

Hand off to `/norm-dog polish <target>` for the final pass, or `/norm-dog audit` to confirm the
error-design axis moved.
