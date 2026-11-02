# Freshness check

Notes get old fast. The user often shares a meeting days later. By then they may have finished half of it, someone else may have taken a step, or new direction may have replaced the plan. A list with done work in it wastes their time and teaches them not to trust it.

Skip this whole check if the meeting was today.

## What to look for

- Steps the user already finished
- Steps someone else took over
- Calls or events from the notes that already happened
- New direction that replaces what the notes said

## Where to look, in order

Search from the meeting date to now. One pass per source.

1. **Later Granola notes.** List meetings from the meeting date to now. Look for the same people, the same client, or the same project. Titles often differ. For example, an "intro with a bodegas group" can show up later as a "Workshop" with that client's company name. If the notes scheduled a call, check for a meeting on that day with those people. A newer meeting beats an older one.
2. **GitHub, for work tracked in the repos or orgs listed in `knowledge_files/work-context.md`.** In Claude Code, use `gh`:
   - Start with open and recent PRs: `gh pr list -R <org>/<repo> --state all --search "updated:>=<meeting date>"`. Read the PR body for what's still left.
   - Then check commits on all branches, not just `main`.
   - Then check the repo's status files: any status or notes files that `knowledge_files/work-context.md` names.
   - In Chat or Cowork without a GitHub connector, skip this and say so in one line.
3. **Slack.** Use `slack_search_public` for the project name and key deliverables, from the meeting date to now. Use private search only if a learned rule says the user allowed it. Otherwise ask once ("Can I search private channels and DMs too?") and offer that as a learned rule.

If a source isn't available in this session, skip it and name it under "Not checked". Never say you checked something you couldn't reach.

## What counts as done

- A step is done only when the deliverable reached the person who asked, or they said it's done.
- An open or draft PR is not done. Read the PR body and any status files. Whatever is still left stays as the user's step, rewritten to match. Example: "Finish the last review comments, then hand PR #1 to Sam."
- A status note from the requester ("only walkthrough videos are left") can close a step. If it's vague, ask under "Questions for you". Don't drop it quietly.

## What to do with what you find

- Done or replaced: drop it. Add one line under "Since the meeting".
- New direction: the new direction becomes the step. The note's version is history.
- Two sources disagree: put one short question under "Questions for you". Don't pick a side quietly.

If the picture is still unclear after one pass each, answer from the notes. Then say what you couldn't confirm under "Not checked".
