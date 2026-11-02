# Work context

Setup fills this in from the user's recent meetings. Show what you'd write and save it only after they say yes. Anything still in [brackets] is unknown: ask about it only when a run needs it.

## Who the user is

- Role: [e.g. product designer, engineer, PM]
- Where they work most: [Claude Code | Cowork | Chat]

## Teams, clients, and people

One line each. Name who often speaks or commits for the user.

- **[Team or client]**: [the user's role there]. [Name] is [their role] and [often commits the user to work, if true].

## Where work lives

- Repos or GitHub orgs to check in the freshness check: [org/repo]
- Status or notes files worth reading in those repos: [path]
- Commands the work usually starts with: [e.g. a slash command]

## Picking the surface for the prompt

- **Claude Code**: anything in a repo. That means code, prototypes, building or fixing a skill, and audits. This is the default.
- **Cowork**: work across several apps or documents, like pulling from Drive, a project tracker, or email and putting together a deliverable.
- **Chat**: writing or thinking, like a follow-up message, a pitch, or working through a decision.

When the work lives in a repo, the prompt names the repo, the command to start with if there is one, and where the finished work goes.
