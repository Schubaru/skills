# skills

Claude Code skills I use every day, packaged so you can too. Each one is a folder with a `SKILL.md`. Write-ups and real output: [nooblabs.vercel.app](https://nooblabs.vercel.app/#skills).

| Skill | What it does |
|---|---|
| [deviceroy](skills/deviceroy) | Screen-by-screen iOS 27 vs Android 17 platform audit, published as plain-language report pages. |
| [ui-surgeon](skills/ui-surgeon) | A short, reviewable checklist of the UI changes you just made, ready to hand off. |
| [key-components](skills/key-components) | Builds or reverse-engineers a complete design system: tokens, components, stories, docs. |
| [test-mite](skills/test-mite) | Deterministic routing tests: Playwright coverage of every route, plus a findings report. |
| [app-store](skills/app-store) | Audits an iOS app against Apple's current review guidelines, fixes what it safely can, reports the rest. |
| [noob-inc](skills/noob-inc) | Deploys N00B Inc into your own accounts: a pixel office and board for your Claude Code agents, with an inbox for their permission prompts. |
| [last-push](skills/last-push) | Your latest git push as a short, Slack-ready bullet list. |

## Install

One skill:

```bash
npx skills add Schubaru/skills --skill ui-surgeon
```

All of them:

```bash
npx skills add Schubaru/skills --all
```

As a Claude Code plugin (2.1.275 or later):

```
/plugin install ui-surgeon --marketplace Schubaru/skills
```

On older versions, add the marketplace first: `/plugin marketplace add Schubaru/skills`, then `/plugin install ui-surgeon@doodleshoe`.

Plugin skills are namespaced, so that one runs as `/ui-surgeon:ui-surgeon`. The `npx` route installs it as plain `/ui-surgeon`.

Or copy a folder into `~/.claude/skills/` yourself.

## Credits

ui-surgeon's folder layout follows the B43™ Skill Builder package format. B43™ is a trademark of its owner; these skills are not affiliated with or endorsed by B43.

## License

MIT
