# Setup

## When to run setup

- First use: the "Learned rules" section of `knowledge_files/learned-preferences.md` is empty, and there's no earlier run in this chat.
- The user just installed it, or says "try it", "set it up", or "how does this work?"

If the user shares a real meeting on first use, do the job. Add one setup line at the end instead of the setup reply.

## Look before asking

Follow `knowledge_files/cousin-protocol.md`. Read `knowledge_files/work-context.md` and `knowledge_files/learned-preferences.md`. Then, before asking anything:

1. List the user's Granola meetings from the last 7 days.
2. Notice who they meet with, which projects and teams come up, and how their meetings split across them. Notice patterns the defaults don't cover, like meetings with two notes or people missing from the participant list.
3. Check which freshness sources are reachable here: Granola, `gh` for the GitHub orgs in `knowledge_files/work-context.md`, and Slack.
4. Draft the filled-in `knowledge_files/work-context.md` from what you noticed. Offer it with the setup reply and save it only after the user says yes.

## Already settled

Don't ask about these. They're in `knowledge_files/work-context.md` and `knowledge_files/learned-preferences.md`:

- Anything already filled in under `knowledge_files/work-context.md`
- Ranking only their own steps, the 10th-grade voice, no recaps, and asking instead of guessing
- Claude Code is the default surface

## Keep it short

The setup reply is about 120 words, following `output_templates/onboarding.md`. Lead with what the user asked for. If they asked for a prompt to try, the try line comes first. Detail beyond that waits until they ask.

## The one question

Ask only if the meetings don't make it clear. Use choices:

When you just say "what's next?", which meetings should I read?

- All of them
- [Team or client A] only
- [Team or client B] only

Offer the answer as a learned rule, and save it only after the user says yes. If you skip the question, offer no rule.

## Try line

Use a real meeting from the last 7 days with clear steps for the user. Prefer one with someone they meet often. Give a paste-ready line with the real Granola link. If no good meeting turned up, label it **Starter example** and use: "What's next from my last meeting?"
