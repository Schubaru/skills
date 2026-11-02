# The findings artifact

## Why this exists

A routing pass produces two things: a suite, and an understanding of what's broken. The suite
lives in the repo. The understanding, by default, dies in terminal scrollback — which is the wrong
home for it, because the people who most need it (designers, PMs, whoever owns the flow) don't
read your terminal and can't run your suite.

So the findings always get published as an artifact. Not as a nicety: a routing audit that nobody
can read is an audit that changes nothing.

The artifact is also what makes a finding *checkable*. A sentence like "the cart doesn't name the
visit" is a claim; the same sentence with a link that opens that exact screen is evidence someone
can confirm in one click. That is the difference between a report and an assertion, and it's why
the linking rule below is the part to get right.

## Publish it live, not at the end

Publish a skeleton as soon as you start walking, and republish as findings land. Two reasons: the
user can follow along instead of waiting, and a long pass that gets interrupted still leaves
something behind. Load the `artifact-design` skill before writing the file, as always.

## Runs: keep the report that found the bug

Republishing overwrites. That is right while a single walk is still in progress — the skeleton
becoming the finished report is one view getting more complete. It is wrong the moment fixes
land, because then you are overwriting *evidence*: the reader who opens the page after a fix
sees "2 defects, fixed" and cannot see the walk that found them, what the flow actually did, or
how bad it was. The before/after contrast is usually the most useful thing the page has, and
rewriting in place is what destroys it.

So a page holds **runs** — one full view per pass, with a switcher between them:

- **Run 1** — the initial walk, exactly as first reported.
- **Run 2** — the re-walk after fixes. Same four blocks (status, scoreboard, findings, walk log),
  filled with what the re-walk found.
- **Run 3+** — further rounds, if the fixes need more than one pass.

The template's switcher handles the mechanics: tabs carrying each run's headline numbers, the
selection in the URL hash so a specific run is linkable, and the page opening on the newest run
(the current state of the flow is what most readers came for; the history is one click away
rather than in the way).

**The rule that makes this worth doing: never edit an earlier run to agree with a later one.**
Not the severity, not the wording, not the scoreboard. If Run 1 said an 81-year-old reached
checkout, Run 1 keeps saying that after it's fixed — that sentence is the reason anyone believed
the fix was worth making. A finding that gets *fixed* appears in both runs: as a live defect in
Run 1, and in Run 2 with a "fixed" chip plus what the re-walk actually did to confirm it and what
now pins it. A finding still open keeps its original severity; a second pass is not a reason to
soften it.

Two things that genuinely change between runs, and should:

- **Findings you got wrong.** If the re-walk shows Run 1 overstated something, don't quietly
  rewrite Run 1 — add the correction to Run 2 and say what changed. A visible correction is
  worth more than a clean page, and it is the honest version of the same fact.
- **Run metadata.** Branch, commit and date differ per run, so they belong inside the run rather
  than in the shared masthead.

When there has only ever been one pass, delete the switcher — a control with one option is
furniture. Add it the first time you re-walk.

## Scenarios: one level below the run

A pass often walks the same feature as several different people — a new member, a member whose
data is months old, someone on the web where a capability doesn't exist. Those are *user
scenarios*, and the person who owns one of them should not have to scroll through the other
eight to find their cards. So inside a run, the template offers a second row of tabs, one per
scenario, each switching a `.scenario` wrapper that holds its **own** status line, scoreboard,
findings and walk log.

The order of the two levels is deliberate: the run is *when* (before or after the fix), the
scenario is *who*. A reader first decides which state of the product they are asking about, then
whose experience of it — never the other way round, because a scenario tab that spanned runs
would mix evidence from before and after a fix on one screen.

- **One tab per scenario, in the order walked**, labelled in the product's own words for that
  person ("No weight yet", not "S3"), with that scenario's open-defect count on the tab. The
  count is the reason to click; a row of bare names makes the reader open each one to learn
  which matter.
- **Each scenario opens with one sentence on who this is** — the person, the state they arrive
  in, what the product owes them — and links the seeded URL that puts a reader in that state.
- **Findings that belong to no single scenario** (your harness, a suite-wide drift, a shared
  component) go in a last scenario named "Whole suite". Don't duplicate a card into every tab:
  nine copies of one defect reads as nine defects.
- **The hash carries both levels**: `#run-2/no-weight`. Either half may be absent — no run opens
  the newest, no scenario opens the run's first — so every view a reader is looking at is a link
  they can paste. When a later run re-walks the same scenarios, keep the scenario ids identical
  so swapping `run-1` for `run-2` in a link lands on the same person.
- **One scenario is no scenarios.** The template hides a one-tab row; if the pass only walked
  one kind of user, unwrap the blocks and delete the nav rather than shipping furniture.

The kind filter still lives inside each scenario's findings and still stays out of the URL.

## Structure

Adapt the wording to the job, but these parts each do work:

1. **Masthead** — what was tested, in what environment. Route, viewport, server, branch. A reader
   six weeks later needs to know whether this still describes anything.
2. **Status line** — "walk in progress" while running, replaced by the result when done.
3. **Scoreboard** — Screens, Passed, Defects, Noted. One word each: these sit under a heading that
   already says what the page is, so a label repeating it ("assertions passed", "noted findings")
   spends a line saying nothing the number and the color don't. Small numbers, but they're what a
   skim-reader takes away, so they must match the body exactly.
4. **Findings** — one card each, most severe first. Every card carries:
   - a **kind** (below) shown as its severity chip, and a **classification chip**
     (app bug / board / clinical / awaiting sign-off), because "it failed" and "whose fault it
     is" are different facts and the reader needs both,
   - the concrete evidence — expected vs actual, root cause, and the bound on it, quoted from
     the run rather than paraphrased,
   - **why it matters**, in the product's terms rather than the test's,
   - the **links** (below).

   **The evidence block is collapsed by default; the header and footer are not.** A reader
   arriving at a page of findings is deciding *which* ones concern them, and four paragraphs of
   expected/actual per card buries that decision under evidence nobody has asked for yet. So the
   chips and the headline (what and how bad) and the why-it-matters line and the links (what to do
   about it) always read straight down the page, and the proof opens on demand for whoever wants
   to check it. Use a native `<details>` — no script, keyboard-operable and findable by in-page
   search for free. Cards with no evidence block (held up, environment) need no toggle at all;
   a disclosure that opens onto one sentence is worse than no disclosure.

   **There is no "Expand all" control, and that is deliberate.** An earlier version carried one,
   on the reasoning that a closed `<details>` can hide its contents from the browser's in-page
   find. It earned its place less than it cost: it sat beside the heading competing with the one
   thing that section needs to say, its label had to be derived from the cards to stay honest,
   and it had to be hidden whenever the visible cards had nothing to open — a lot of machinery
   for a button most readers never press. The tabs do the real narrowing job now: someone looking
   for the defects filters to Defects rather than opening thirty evidence blocks to scan them.

   The find-in-page tradeoff is real but small, and worth stating rather than engineering around:
   browsers increasingly open a closed `<details>` when a find lands inside it, support is not
   universal, and the parts a reader searches for — a route, a heading, a screen id — live in the
   card header and footer, which are never collapsed. If you find yourself wanting the button
   back, the likelier fix is that too much of the finding is buried in the evidence block.

   **Kinds, and the tabs that filter them.** Every card declares exactly one `data-kind`, and the
   tab row is built from those values:

   | `data-kind` | Tab | What belongs here |
   |---|---|---|
   | `defect` | Defects | The flow breaks its own stated rules. |
   | `noted` | Noted | Real, but small or narrower than it first looked. |
   | `held-up` | Held up | Behaviour that was correct, now pinned. |
   | `expected-gap` | Expected gaps | Known open items — confirmed, deliberately not filed. |
   | `environment` | Environment | Your harness, your tooling, your method traps. |
   | `drift` | Drift | A test encoding behaviour the product changed on purpose. |

   One axis, one card, one tab. The reason to separate `expected-gap`, `environment` and `drift`
   out of a general "notes" pile is that each answers a different question a reader actually asks:
   *was this always going to be missing?*, *is this even about my product?*, and *did we change
   this on purpose?* A reader who only owns one of those should be able to see only that.

   The template builds the tabs from the cards themselves, so counts are always true and a
   category with no cards gets no tab — a tab opening onto an empty page is worse than a missing
   one. With only one kind present the row hides itself, for the same reason the run switcher
   disappears on a single run. **"All" leads and is the default**: a page that opens pre-filtered
   hides its own shape, and anything filtered out is invisible to in-page find. For that reason
   the selected tab deliberately stays *out* of the URL — a link someone shares should open on
   the whole report, not on one slice of it, and the hash already belongs to the run and the
   scenario.
5. **The walk log** — one row per screen actually reached, in the order the flow served it,
   each row linked. This is the part that proves you walked rather than sampled.
6. **Scope** — what was in, what was out. Gaps stated plainly beat gaps implied.

Include a `held-up` card listing what behaved correctly. A findings page that is only failures
reads as an indictment and hides how much of the flow is sound — and the passing list is what
tells a reader which behaviors are now pinned.

## Linking — the part that matters

**Every finding and every logged screen links to the thing it is about.** A finding the reader
cannot open is a finding they have to take on faith.

Link two ways wherever both exist:

- **The live screen** — the app's own URL, seeded to the exact state described. Most step-driven
  apps encode state in query params; find that scheme (the router, the step union, the seed
  function) and construct real URLs rather than approximations. Use the dev server origin the run
  actually used, and say so near the links so nobody is surprised when they don't resolve on a
  different machine.
- **The design frame** — if the repo has a review board, Storybook, or any config that names
  screens by id, link the frame id too. Derive ids from that config; never invent one. A frame id
  that doesn't exist is worse than no link, because it looks authoritative.

Practical rules:

- Prefer several precise links over one vague one. A defect that is a *contrast* between two
  states should link **both** — the broken case and the working one — because the comparison is
  the argument.
- Link the correct-behavior screens too (the checkout that does render properly, the Option 2
  control). It's what stops a reader over-reading the blast radius.
- Make the step id in each walk-log row the link itself. It's already the identifier; giving it a
  second affordance is noise.
- Escape `&` as `&amp;` in HTML attributes, and open in a new tab (`target="_blank"` with
  `rel="noopener"`) so the reader doesn't lose the report.

## Honesty carries into the artifact

The integrity rules in SKILL.md govern this page too:

- **Severity must match evidence.** If a finding turns out narrower than first written, rewrite the
  card — don't leave an overstated headline with a hedge buried in the body. Moving it from
  `defect` to `noted` is the honest edit, and the tabs make that demotion visible rather than
  burying it. Correcting the artifact is part of the work, not an admission.
- **Separate your harness from the app.** Environment problems and your own test bugs go in their
  own card, labelled. A reader must never have to guess whether a line describes their product or
  your tooling.
- **Record method traps.** If an assertion passed for the wrong reason, or a locator matched an
  inert layer, say so — the next person to test this flow will hit the same thing.

## Template

`assets/findings-template.html` has the skeleton: theme-aware tokens (all three theme states),
scoreboard, chips, finding cards, linked walk-log rows, and the link styles. Copy it and fill it
in rather than starting from scratch — the parts worth keeping are the token structure and the
link/chip components, not the specific palette, which should suit the subject.
