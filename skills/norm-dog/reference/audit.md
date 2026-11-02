# audit — walk the screen or flow as the real user, find every usability blocker

The flagship command. Read-only: you diagnose and report, you do not edit. The deliverable is a
specific, ranked list of the exact spots where a user's action loop fails, each named at the
screen or control and tied to the Norman principle it breaks. `harden` and `polish` fix them later.

"As specific as you can" is the whole job. A finding that doesn't name the exact screen and element
is not a finding.

## Method: walk every step in order, in character

You have the target's markup, its state/logic, the running screen if a preview is available, and
the field guide. Now become the real user and walk the screen (or the flow, screen by screen) from
entry to completion, in the order they'd actually meet it. Do not skim to the "interesting" parts;
gulfs hide in the boring ones (the innocuous summary that's secretly editable, the button with no
loading state). If you can drive the real screen, do — click the primary path, submit an invalid
value, resize to a phone, tab through with the keyboard. If you can't, reconstruct the rendered
experience faithfully from the code.

For each screen/step, run the loop from field-guide §1:

1. **Name it** by screen/route and a short quote or description of the element so the finding is
   locatable ("`/checkout` step 2, the 'Apply promo' field").
2. **Goal / intention:** what does the user want, and can they tell what this screen wants of them?
   (Gulf of Execution check.)
3. **Execute:** can they do it without slipping? (Ambiguous controls, tiny targets, look-alike
   actions, destructive next to benign.)
4. **Perceive / interpret / evaluate:** after they act, can they tell what happened and whether it
   worked? (Gulf of Evaluation check, feedback quality, loading states.)
5. **Model check:** does this screen build the right conceptual model and nothing false? Is it
   consistent with the screens around it?
6. **Memory check:** does it demand a value or rule from an earlier, now-off-screen step?

Then zoom out and run the **arc-level checks** (field-guide §7) on the flow as a whole.

Keep a running list. Most screens produce few findings; that's correct. Flag only real loop
failures, not style preferences.

## Scoring: the Six Gulfs Scorecard

Score the target 0–4 on each of Norman's six lenses. Be honest; a 4 is genuinely excellent, and
most real interfaces land 2–3 on their weak axes. The score exists to make the weak axis obvious
and to show movement on re-audit, not to reward a number.

| # | Lens | What a low score looks like | What a 4 looks like |
|---|------|------|------|
| 1 | Conceptual model | A screen implies a wrong/false model, or the model fractures across the flow | One coherent model, nothing false, consistent end to end |
| 2 | Visibility | User can't tell control state, progress, or why the primary action is blocked | State, progress, and available actions always visible by looking |
| 3 | Mapping | Progress indicator drifts; controls sit far from effects; action→result unclear | Every action maps obviously to its result; controls sit by what they affect |
| 4 | Feedback | "Error" with no why; silent submits; missing loading states | Immediate, specific, located feedback that closes every loop |
| 5 | Memory load (world vs head) | A step needs a value shown two screens back and now off-screen | Each step carries what it needs; recall is never accidentally required |
| 6 | Error design (slips/mistakes) | Look-alike/adjacent destructive actions; reasonable inputs rejected; dead gates | Slips constrained, mistakes designed out, every gate has a visible release |

**Score bands** (out of 24): 22–24 excellent (ship, minor polish) · 17–21 good (fix the weak
axes) · 11–16 rough (real work before a user is well served) · 0–10 broken (the loop fails
somewhere central; redesign that stretch).

## The report

Present this in chat as the primary deliverable. Lead with the verdict, not the table.

### 1. The user's-eye verdict
Two or three sentences: could an ordinary user get through this forming the right model and always
knowing what to do and whether it worked? Name the single biggest gulf up front.

### 2. Scorecard

| # | Lens | Score | Sharpest finding |
|---|------|-------|------|
| 1 | Conceptual model | ?/4 | [one line or "solid"] |
| 2 | Visibility | ?/4 | |
| 3 | Mapping | ?/4 | |
| 4 | Feedback | ?/4 | |
| 5 | Memory load | ?/4 | |
| 6 | Error design | ?/4 | |
| **Total** | | **??/24** | **[band]** |

### 3. Blockers, ranked
The real output. Order by severity. For each:

- **[P?] Short name** — one line stating the blocker.
- **Where:** screen/route + the quoted or described element so it's locatable.
- **Gulf / principle:** which of the six lenses, and whether it opens a Gulf of Execution or
  Evaluation.
- **What the user intends → what the design gives them:** the concrete mismatch, in the user's
  voice ("I pressed Pay expecting a confirmation and instead got a silent, unchanged screen, so I
  pressed it again").
- **Slip or mistake:** if it's an error-risk, which kind, and therefore whether the fix is a
  constraint (slip) or a clarification of the model (mistake).
- **Fix direction:** what would close the gulf, and which command owns it (`/norm-dog harden` for
  error/constraint work, `/norm-dog polish` for feedback/mapping/visibility tightening, `/norm-dog
  shape` if a screen needs redesign; `ux-copywriter` if it's purely a copy fix; `impeccable` if
  purely visual). Don't fix it here; point at the owner.

**Severity:** P0 the user cannot complete the task or forms a flatly wrong model · P1 they can
finish but get lost, misled, or can't tell if they succeeded · P2 friction with a workaround · P3
polish. Reserve P0 for real loop breaks; if everything is P0, nothing is.

### 4. What's already working
Two or three things the interface does *right* by Norman's lights, specifically. This isn't
politeness: it marks the patterns to preserve when other commands edit, and it's honest.

### 5. Recommended next moves
A short ordered list of commands to run, mapped from the blockers, highest-severity first. End with
`/norm-dog audit <target>` again after fixes to see the score move. Tell the user they can run them
one at a time or hand you the whole list.

## Rules

- **Name the exact element.** Every blocker names its screen and quotes or describes enough to find
  it.
- **Decide whose fault a "wrong" action is.** If a sensible user reaches a rejected input or a
  wrong path, it's a design failure to fix, not a user error. This judgment is the most valuable
  thing the audit produces.
- **Don't invent blockers to fill the report.** A screen with three real gulfs and a 20/24 is a
  better outcome than a padded list of P3 nitpicks. Noise buries the P0.
- **Stay in Norman's lane.** Aesthetic taste, prose rhythm, and brand voice belong to other skills;
  when a finding is really one of those, say which skill owns it (`impeccable`, `ux-copywriter`)
  and move on. Your domain is whether the interaction and the flow *work*.
