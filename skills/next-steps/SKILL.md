---
name: next-steps
description: Reads the user's Granola meeting notes like a product manager, sorts out the next steps for every person in the meeting, ranks the user's own steps, and writes a ready-to-paste prompt for their top step to run in a new Claude Code, Cowork, or Chat session. Learns how the user works and asks before saving anything new. Use whenever the user shares a Granola link or meeting notes, pastes a link with little or no instruction, or asks "what's next", "remind me what I need to do", "what do I owe", "where does this stand", or "give me a prompt for this". Not for writing specs, critiquing designs, or doing the task itself.
---

# Next Steps

## Goal

The user hands over a meeting. They get back three things: who owes what, which of their own steps comes first and why, and a prompt that starts that step in a fresh Claude session. Read everything. Return only what someone acts on. Talk to them the way a sharp 10th grader would read easily, but keep every name, date, file, and constraint.

## Inputs

- Required: one or more Granola links or meeting IDs, or a plain "what's next?"
- Optional: a project to focus on, a person to filter by ("just Sam stuff"), extra links from Notion or Slack.
- Derivable: meeting date, people in the room, duplicate notes of the same meeting.

## Files to use

- `knowledge_files/cousin-protocol.md` — how to look things up before asking. Use during setup and every run.
- `knowledge_files/onboarding.md` — step 1, for first use, just installed, or "try it".
- `output_templates/onboarding.md` — the setup card.
- `knowledge_files/scoring-rubrics/onboarding-rubric.md` — score the setup card before sending it.
- `knowledge_files/learned-preferences.md` — step 2. The user's rules from past runs. They beat the defaults below.
- `knowledge_files/work-context.md` — steps 3 and 7. The user's roles, people, repos, and which Claude surface fits which job.
- `knowledge_files/pm-lens.md` — steps 4 and 6. Who owns what, and how to rank.
- `knowledge_files/freshness-check.md` — step 5. What to search after the meeting and how much.
- `output_templates/next-steps.md` — step 8. The answer's exact layout and the prompt's parts.
- `knowledge_files/scoring-rubrics/next-steps-rubric.md` — step 9. Score the answer before sending it.

## Run the process

1. Route setup. If this is first use, a fresh install, or "try it", follow `knowledge_files/onboarding.md`. Stop after the setup reply unless the user also shared a real meeting. A request for a made-up example skips setup. Follow "Sample requests" in `output_templates/next-steps.md`.
2. Read `knowledge_files/learned-preferences.md`. Apply every rule in it to this run.
3. Get the meeting. Pull the ID from the link (`notes.granola.ai/d/<id>`) and call `get_meetings`. Then list meetings around that time and look for a second note of the same meeting. If there is one, read both and merge them.
   - No link: list the user's meetings from the last 7 days and read the ones with real work in them. Then run one `query_granola_meetings` for promises made for the user in meetings they weren't in.
   - Not found: say so in one line. Offer their three most recent meetings as choices, plus "Something else".
4. Draft the next steps for each person using `knowledge_files/pm-lens.md`. Open the transcript only when the notes don't say who owns a step.
5. Run the freshness check in `knowledge_files/freshness-check.md`. Drop steps that are done or replaced. Note them for "Since the meeting".
6. Rank the user's steps with the ranking rules in `knowledge_files/pm-lens.md`. Write one or two sentences on why #1 comes first.
7. Write the prompt for #1, or for #2 if only the user can do #1. Pick the surface and repo from `knowledge_files/work-context.md`. Pack in everything a session with no history needs.
8. Lay out the answer with `output_templates/next-steps.md`.
9. Score it with `knowledge_files/scoring-rubrics/next-steps-rubric.md`. Fix anything at Worst before sending.
10. Offer one learned rule if the user corrected you in this chat. Follow "Learning" in `knowledge_files/pm-lens.md`. Never save it without their yes.

## Output

If this was setup, send the setup card from `output_templates/onboarding.md` first. Say where their preferences are saved. Don't claim a file changed unless you changed it.

For a meeting, send the sections in `output_templates/next-steps.md` and nothing else. No recap, no closing offer.

If the user asks again later in the same chat ("remind me what's next"), reuse what you already read. Rerun the freshness check only if they say work has moved.

## Final checks

- Every step's owner comes from the notes. Unclear owners show up as a question under "Questions for you".
- No step that is already done or replaced made the list. An open PR is not done.
- Calls the user only needs to attend are under "On your calendar", not ranked.
- #1 is the user's own step, and the "why" matches the ranking rules.
- The prompt names a surface and a repo or folder, and it says what "done" looks like.
- Names, dates, file names, and project names are kept exactly as the notes say them.
- Learned rules were offered, not written, unless the user said yes.
