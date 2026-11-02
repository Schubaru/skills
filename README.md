# skills

Claude Code skills I use every day, packaged so you can too. Each one is a folder with a `SKILL.md`. Write-ups and real output: [doodleshoe.vercel.app/skills](https://doodleshoe.vercel.app/skills).

| Skill | What it does |
|---|---|
| [don-star](skills/don-star) | A review canvas of live screens inside your Vite + React app, with pinned comments an agent turns into code. |
| [deviceroy](skills/deviceroy) | Screen-by-screen iOS 27 vs Android 17 platform audit, published as plain-language report pages. |
| [norm-dog](skills/norm-dog) | Don Norman's *Design of Everyday Things*, run against your screens: audit, shape, harden, polish. |
| [key-components](skills/key-components) | Builds or reverse-engineers a complete design system: tokens, components, stories, docs. |
| [test-mite](skills/test-mite) | Deterministic routing tests: Playwright coverage of every route, plus a findings report. |
| [app-store](skills/app-store) | Audits an iOS app against Apple's current review guidelines, fixes what it safely can, reports the rest. |
| [noob-inc](skills/noob-inc) | Deploys N00B Inc into your own accounts: a pixel office and board for your Claude Code agents, with an inbox for their permission prompts. |
| [last-push](skills/last-push) | Your latest git push as a short, Slack-ready bullet list. |

## Install

One skill:

```bash
npx skills add Schubaru/skills --skill norm-dog
```

All of them:

```bash
npx skills add Schubaru/skills --all
```

As a Claude Code plugin (2.1.275 or later):

```
/plugin install norm-dog --marketplace Schubaru/skills
```

On older versions, add the marketplace first: `/plugin marketplace add Schubaru/skills`, then `/plugin install norm-dog@doodleshoe`.

Plugin skills are namespaced, so that one runs as `/norm-dog:norm-dog`. The `npx` route installs it as plain `/norm-dog`.

Or copy a folder into `~/.claude/skills/` yourself.

## License

MIT
