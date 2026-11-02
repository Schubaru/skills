# Next steps answer

Send these sections in this order. Skip any section that would be empty. Never write "nothing changed" or "none".

~~~markdown
**Your next steps**
1. [Verb + step] ([by Day] | [overdue, was due Day] | [Name] committed)
2. [Verb + step]

**On your calendar**
- [Call or event the user only needs to attend] ([Day, time if known])

**Everyone else**
- **[Name]**: [what they owe, owed-to-the user items first]

**Blocked**
- [Verb + the user's step]: waiting on [who or what]

**Questions for you**
- [Unclear owner, or two sources that disagree, as one short question]

**Since the meeting**
- [What changed, one line] ([source])

**Why #1 is first**
[One or two sentences naming the ranking rule that won.]

**Prompt for #1** · run in [Claude Code | Cowork | Chat] · [repo or folder]
```text
[The prompt]
```

**Not checked**: [source or fact I couldn't confirm] (one line, only when needed. The one-time "Can I search private Slack?" ask goes here.)
~~~

## Section rules

- **Your next steps**: start every step with a verb. Use about 12 words. Parentheses hold only a deadline, an overdue note, or an attribution like `(Sam committed)`.
- **On your calendar**: calls, intros, and events where the user only has to show up. They are never ranked and never get a prompt. If one needs prep work, the prep is the step.
- **Everyone else**: for one meeting, list each person's steps. For several meetings or a no-link "what's next?", list only what people owe the user. Skip everything else they do.
- **Questions for you**: unclear owners for steps that could be the user's, and conflicts between sources. Leave out unowned work that's clearly outside the user's lane. Three questions at most.
- **Since the meeting**: only changes that added, dropped, or changed a step. Five lines at most. Background status goes inside the prompt instead.
- Keep specifics that change what someone does: a file, a repo, a person, a constraint. Cut "as discussed".
- Use project names exactly as the notes say them.
- Mark any inference with "(my read)", including steps you assign to other people.
- A thin meeting gets a short list. Don't pad.

## The prompt's parts

Write the prompt for the highest step Claude can help with. If #1 is something only the user can do (a hard conversation, a decision), say so in "Why #1 is first" and write the prompt for #2.

Write it to a Claude session that has never seen the meeting. Second person, plain words. Include, in this order:

1. **Goal**: one sentence on what to make or do.
2. **Why now**: who is waiting and the deadline.
3. **Context**: the facts from the meeting and the freshness check that the session needs: names, decisions, constraints, current status, and links to the Granola note and any files or PRs.
4. **Where**: repo, branch or folder, or apps. If work-context.md names a command the work starts with, include it.
5. **Steps**: three to six short numbered steps.
6. **Done means**: what the user can check to know it's finished.
7. **Ask first if**: the one or two things the session should ask about instead of guessing.

Keep it under about 300 words. Cut context before cutting steps.

## Nothing for the user

If the meeting has no steps for the user, say that in one line. Then list "Everyone else" if it's useful. Skip the prompt.

## Sample requests

If the user asks to see a made-up example, start with one italic line: *Made-up meeting. Nothing here is real, and nothing was searched.* Use made-up names for every person, client, and repo. Use `<Granola link>` instead of a URL. Skip the meeting lookup, freshness check, and rule offer. Fill every section so they can see the full layout. "Since the meeting" and "Not checked" are pretend too.
