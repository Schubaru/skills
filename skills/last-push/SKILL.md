---
name: last-push
description: Briefs the contents of the most recent git push as a short, Slack-ready bullet list — one line per change, ten words maximum, plain language, no filenames or identifiers. Use this whenever the user asks what they just pushed, wants to summarize or write up their latest push, needs an update for their team or for Slack, or types "last-push", "push brief", "what did I just push", "brief my updates", "summarize the push", or "write up what went out". Use it even when the request is casual or doesn't mention git — any ask for a human-readable summary of recently shipped code belongs here.
---

# last-push

Turn the most recent push into something the user can paste into Slack without
reading it first. The audience is teammates who do not read the code — a
designer, a PM, a client. They need to know what changed for a user, not what
changed in a file.

## 1. Find what the push actually contained

This is the step that goes wrong, so do it before anything else.

The push is almost never "the commit I just made." A branch is usually several
commits ahead of its remote before a push happens, so one `git push` moves
everything that had accumulated. Summarizing only the newest commit silently
drops the rest — and the user finds out when they notice their work missing
from the brief.

The remote-tracking reflog holds the range:

```bash
git reflog show origin/<branch> | head -3
git log --oneline --no-merges 'origin/<branch>@{1}..origin/<branch>'
```

`@{1}` is where the remote ref sat before the last push, so `@{1}..@{0}` is
exactly what went up. Count it (`git rev-list --count`) and say the number in
the title — if it is much larger than expected, that is the signal to read
wider, not to narrow down.

Two fallbacks, in order: if the reflog has only one entry (fresh clone), use
`git log <remote-branch>` and say the range is approximate. If there is no
remote at all, say so rather than briefing local commits as though they shipped.

Never derive the range from the working tree, from what you personally just
edited, or from the conversation. Those describe your session, not the push.

## 2. Gather the why

Commit subjects give you the what. The brief needs the why, because "added
resume.ts" means nothing to a designer and "leaving the chat dropped your
place" means everything.

Read, in order of value:
- **Changed docs in the push** — decision logs, changelogs, ADRs, wiki entries.
  These are written for humans and usually hand you the framing directly.
- **Commit bodies**, not just subjects.
- **The diff**, only for changes the first two do not explain.

Group as you read. Nineteen commits are rarely nineteen stories — they are
usually five or six threads with several commits each. Group by what a person
would recognize (a feature, a screen, a lane), never by directory.

## 3. Write it

Use this shape exactly:

```
**<Area or "Last push"> — <N commits>** ([<range>](<compare URL>))

- <bullet>
- <bullet>

**Open:** <one line>
```

The title names the thread when the push has one, or `Last push — N commits`
when it spans many. Link the compare view on the host (GitHub:
`<repo-url>/compare/<old>...<new>`); a single-commit push can link the commit.

### The bullets

**Ten words maximum.** This is the constraint that makes it readable, and it
works by forcing out everything that was never for this audience. If a bullet
will not fit, it is carrying a mechanism that belongs in the code, not a Slack
message.

- **State the outcome, not the change.** "Leaving the chat dropped your place.
  Now it doesn't." — not "added a resume module."
- **No identifiers.** No filenames, function names, flags, or types. If a
  reader has to know the codebase to parse the bullet, rewrite it.
- **Lead with the sharpest one.** Usually the defect a user would have hit.
- **One bullet per thread, not per commit.** Four commits refining one screen
  are one bullet. Aim for six to ten bullets however large the push.
- **Bugs found in passing are worth their own line** — they are often the most
  interesting thing in a push and the easiest to lose in a group.

Fragments beat sentences. Present tense. Drop articles where it still reads.

Write plain text, never HTML entities — an ampersand is `&`, not `&amp;`. The
brief is going into a chat window, where an entity pastes as itself and looks
like a bug in the thing you just shipped.

### The open line

Include `**Open:**` only when something is genuinely unresolved — a decision
waiting on a named person, a flagged assumption, a question the work raised and
did not answer. Decision logs and `⚠` comments in the diff are where these live.

Omit the line entirely when nothing is outstanding. A standing "Open: none"
trains people to skip it, which costs you the one time it matters.

## Worked example

A 19-commit push spanning pricing, plan switching, a board feature, and an
onboarding redesign:

```
**Last push — 19 commits** ([b70ee58…1f33043](https://github.com/org/repo/compare/b70ee58...1f33043))

- Annual plan is back at standard price.
- Annual plans now show in billing and receipts.
- Multi-month plans can't switch at launch — a notice.
- Alternative built: switch them anyway, credit the balance.
- Board gained Flow view — pages as branch lanes.
- Flow view caught canvas frames showing wrong questions.
- Option 4's cart and CTA merged into one card.
- Dev-mode resources download, scoped to the named component.

**Open:** Product lead's call — notice vs switch-and-credit.
```

Note what is absent: no file paths, no commit SHAs in the bullets, no
"refactored" or "updated", and no bullet explaining how anything works.

## Output

Return the brief and nothing else — no preamble, no offer to expand, no
description of how you found the commits. The user is going to paste it.
