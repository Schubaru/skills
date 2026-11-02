# polish — the final Norman pass

The last step, not the first. Use when the screen or flow is structurally sound and free of
error-traps, and you want to close the last half-open gulfs and make every action loop feel
effortless. `polish` edits the interface, but lightly: it sweats feedback quality, natural mapping,
and visibility of state — the small things that separate an interface a user *tolerates* from one
they glide through.

Don't polish something that still has P0/P1 blockers. Those are `harden` or `shape` work; polishing
around them is decoration on a broken loop. If a prior `audit` shows unresolved P0/P1, say so and
send the user there first.

## Pull in the prior audit

If `/norm-dog audit` has run on this target, its P2/P3 findings and its "already working" list are
your backlog and your do-not-break list. Start there. If not, do a quick walk yourself first
(field-guide §1 per screen) so you're polishing against the real loops, not a guess.

## Polish the four principles, in order of leverage

**Feedback quality — the highest-leverage polish in an interface.** Every submit, validation,
toggle, and state change is a loop closing; make each carry its weight:
- **Specific, not generic.** "Error" closes nothing. "Card declined — check the expiry date" tells
  the user *what* and *why*, and points forward. Every message should reference the user's actual
  action and the reason.
- **Symmetric care.** Error and empty states deserve the same craft as the happy path: name what's
  off, offer the next move, never dead-end. A good error state turns a near-miss into a recovery.
- **Immediate and located.** Confirm feedback lands right where the user acts, right when they act —
  inline by the field, not in a toast that's already gone, not above a form they've scrolled past.
  Add loading states so no action ever looks like a frozen screen; add success confirmation so no
  action ever completes in silence.

**Natural mapping.** Tighten the places where action and result don't quite line up:
- Does the progress indicator / stepper track real position at every step?
- Does a selected option unmistakably read as "this is chosen" (filled, checked, highlighted)?
- Do controls sit near what they affect, and does the primary action land the user where they
  expect? (If an action lands somewhere surprising, that's a mapping bug, not polish — send it to
  `harden`.)

**Visibility of state.** Make the user's current state legible without thought:
- Is it always clear whether a control is active, loading, disabled, complete, or in error?
- Does the entry point / progress honestly preview the effort ahead (no cheerful CTA hiding a long
  flow)?
- Does the primary action's state read correctly (ready vs blocked), and is the reason for a block
  visible?

**Conceptual-model consistency.** A final read for through-line: do the interaction patterns hold
across the flow with no unbridged jump (tap-to-select doesn't silently become swipe; autosave
doesn't become manual save)? Does the final screen name what the user accomplished and what's next,
closing the flow's own evaluation stage? An interface that ends without telling the user "you're
done, here's what happened" leaves the biggest loop of all half-open.

## The arc's peak and end

Norman cares that frustration compounds and that endings color the whole memory. Find the hardest or
most anxious moment (payment, a permission prompt, an irreversible action) and confirm the user gets
reassurance there, not just difficulty. Confirm the ending lands as relief-plus-confirmation, not a
flat stop or a silent redirect.

## Apply and verify

Make surgical edits in the project, matching its conventions, component library, and copy
conventions (don't hardcode values that belong to design tokens). Polish touches many small things
but changes no structure; if you find yourself restructuring, stop — that's `shape` or `harden`.
Then verify the polish holds by driving the running screen (the `verify` skill / preview tools) or,
failing that, typecheck/lint and reload; check it on a phone viewport too, since much polish
(feedback location, target size, loading states) only proves out at mobile size.

In your summary, list the loops you tightened and why each makes the user's pass smoother. If you
left something because it's really a copy or visual matter, name the owning skill (`ux-copywriter`,
`impeccable`) rather than reaching outside Norman's lane. Suggest a final `/norm-dog audit <target>`
to confirm the score moved and nothing regressed.
