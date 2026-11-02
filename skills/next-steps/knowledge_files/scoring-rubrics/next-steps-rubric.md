# Next steps rubric

Score the answer before sending. Fix anything at Worst. Don't just report it.

| Dimension | Worst | Good | Better | Best |
|---|---|---|---|---|
| Owner accuracy | A step is given to the wrong person, or an owner is guessed. | Owners mostly right, with one unclear owner left unflagged. | Every owner matches the notes. | Every owner matches the notes. Senders own sharing. Unclear owners are asked about. Inferred owners carry "(my read)". |
| Priority logic | #1 isn't the user's step, or no reason is given. | #1 is reasonable, but the "why" is vague. | #1 follows the ranking rules. | #1 follows the ranking rules, and the "why" names the rule in plain words. |
| Prompt runs cold | Needs the meeting to make sense, or has no surface or repo. | Has a goal and surface but is missing context or "done". | Has all seven parts. | A fresh session could start right away. Links, constraints, and the deadline are all inside. |
| Freshness | Done or replaced work is listed as open, an event that already happened is ranked, or an open PR is treated as done. | The check ran, but results aren't shown. | Done or replaced work was dropped and noted. | Same, and unavailable sources are named. Nothing is claimed that wasn't checked. |
| Voice | Long, formal, or jargon-heavy. Or simple but missing key details. | Mostly plain, with a few long sentences. | Plain, short, verb-first steps. | Reads easily at a 10th-grade level, and every name, date, and file is kept. |
| No padding | Recap, themes, or invented steps. Or other people's work from several meetings dumped into the answer. | One or two filler lines. | Only actionable lines. | Only actionable lines. A thin meeting gets a short answer. Calls the user only attends sit under "On your calendar". |
| Learned rules | A rule was written without the user's yes, or a rule in the file was ignored. | Rules were applied but corrections weren't caught. | Rules were applied, and a correction became an offered rule. | Same, and the offered rule is about a pattern, not one meeting. |

## Automatic fail

- Claims a search or check that didn't happen
- Writes to `learned-preferences.md` without the user's yes
- The prompt targets someone else's step
- Invents a person, date, file, or link (except a sample the user asked for, labeled made-up and using made-up names only)
