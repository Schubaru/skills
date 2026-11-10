# Principles (distilled from designsystems.surf)

Read this once per project. It is the "why" behind the structure the scripts enforce. Sources: the surf articles on typography architecture, AI-ready systems, building a system in Figma, and the five component categories, plus the surf library's documentation of Material, Spectrum, Polaris, Primer, Atlassian, Carbon, Evo, Pajamas, and Wise. Links in `surf-links.md`.

## 1. A system is a chain of layers, not a list of styles

Surf's typography guide states the model this skill applies to *every* foundation, not just type:

```
Scale → Primitive tokens → Roles → Semantic tokens → Styles/Components → Governance
```

- **Scale** sets proportions and hierarchy only. No meaning, no roles. Change it and everything above updates predictably.
- **Primitives** turn the scale into concrete values (`color.blue.500`, `font.size.400`, `space.4`). They do not express intent. A primitive that "means" something (`color.error.500`) is a bug in the architecture.
- **Roles** are the vocabulary: Display / Headline / Title / Body / Label / Caption / Mono for type; Background / Surface / Text / Border / Interactive for color. A role is defined by purpose, not appearance. Test: can you explain the role without mentioning a size or a hex? If not, it's a hardcoded style wearing a role's name.
- **Semantic tokens** map roles to primitives (`text.body → color.neutral.900`, `font.size.body.md → font.size.400`). They carry meaning and can point at different primitives per mode (light/dark) or platform without changing meaning. Multiple roles may share a primitive; that's fine and intended.
- **Styles/components** consume semantic tokens only. They contain no values and make no decisions. Surf's test: strip all values from a style and reconstruct it purely from token references. If you can't, the layer has leaked.
- **Governance** is a few explicit rules: who changes what, how deprecation works (mark, point to replacement, remove later), how to decide whether a request is a new role, a missed variation, or misuse of what exists. Most "we need a new style" requests dissolve under that last question.

The payoff surf keeps returning to: **decide once, ripple everywhere.** Retheme by editing a seed. Swap a font in one place. That only works if lower layers never store values that belong to layers above.

## 2. Keep the scale small

An overly detailed scale invites redundant decisions. Surf cites Material (Major Second, base 14) and Spectrum (ratio 1.125 applied to desktop and mobile with per-mode values) as examples where the *ratio choice matters less than consistency*. This skill offers four ratios (1.125, 1.200, 1.250, 1.333) and nine steps. Fine-tuning happens at the role/semantic level, not by adding scale steps.

Responsive behavior belongs in the foundation as **modes** on the scale (desktop / tablet / mobile), never as separate "mobile styles." The same role keeps its meaning; only the resolved value changes.

## 3. Color roles, not color names

Surf documents two dominant structures:

- **Material**: role-based. primary / secondary / tertiary / surface / error / outline, each with `on-` and `-container` variants.
- **Spectrum**: highly structured semantics (positive / negative / informative / notice) with separate rules for text, background, border, icon, and decorative use.

This skill uses the Spectrum-style separation of *what the color is applied to* (`bg`, `surface`, `text`, `border`, `icon`) crossed with *intent* (`default`, `subtle`, `strong`, `accent`, `success`, `warning`, `danger`, `info`, `disabled`) plus Material-style `on-` pairs guaranteed to meet contrast. Every text-on-background pairing the semantic layer defines is contrast-checked by the token script (AA 4.5:1 for text, 3:1 for UI/large text). Contrast is a property of the *pair*, so pairs are what get named and tested.

Reduce brand palettes aggressively. Surf's Figma guide: twenty blues become two or three core tones applied consistently. Here: one primary seed, optional secondary/accent seeds, and the script regenerates the 11-step ramps. The ramp is a primitive; which step a role uses is semantic.

## 4. The five component categories

Surf organizes every component library into:

| Category | Job | Examples |
|---|---|---|
| Actions | Turn intention into movement | Button, IconButton, Link, Chip, Menu |
| Inputs | Collect what the user is trying to say | TextField, Select, Checkbox, Radio, Switch, Slider |
| Feedback | Confirm that something happened | Toast, Alert, Dialog, Sheet, Skeleton, Spinner |
| Navigation | Move around without getting lost | TabBar, TopBar, Tabs, Breadcrumb, Pagination |
| Status | Keep the user in the loop | Badge, Tag, Avatar, ProgressBar, EmptyState |

Plus a **Layout/Content** group (Card, ListItem, Divider) that surf treats as structural. `component-inventory.md` is organized in this order and every component's doc block names its category. Naming the category forces the question "what job does this do?" which is the same discipline as text roles.

Surf's Figma guide also warns: components should come from **repeated real needs, not a generic UI-kit checklist.** That's why the inventory has a Core tier (needs nearly every product has) and an Extended tier that is built only when the project's designs call for it. Don't build Pagination for a mobile app.

## 5. Anatomy, states, behavior, usage

Surf's component pages compare systems on the same axes: anatomy (named parts), variants, sizes, states, behavior, usage do/don't, accessibility, implementation. Each component in the inventory is specified along those axes so the code and the doc say the same thing. Every interactive component defines these states at minimum: `default`, `hover` (web), `pressed`, `focus-visible`, `disabled`, and where relevant `loading`, `selected`, `error`. A component without a focus state fails AA before it ships.

## 6. What makes a system usable by AI

The surf AI-ready thesis, paraphrased: systems already have the assets AI needs; what they lack is **explicit context about which decisions are current, approved, and safe to reuse.** Humans fill that gap from memory. AI cannot, so it infers, and inference is where drift starts. Surf's roadmap names the areas that must be explicit: direction, foundations, tokens, components, documentation, design–code alignment, adoption, governance, measurement, maintenance.

Concretely for this skill:

- `DESIGN_SYSTEM.md` states every decision in words, including the *don'ts* (Body is not for headings; Chip is not a Button; Tag is not a Badge).
- Token names are self-describing and the doc includes the naming grammar so a future session can extend correctly.
- The component manifest lists what exists, so nothing has to be discovered by grepping.
- The changelog records what changed and why; deprecated items are marked before removal.
- The `CLAUDE.md` pointer means the next session reads the doc before touching UI. That one line is the highest-leverage thing in the whole build.

Surf also notes that a good prompt is not yet a repeatable workflow. The workflow here is the pipeline in SKILL.md plus the scripts; the prompt is just how the user triggers it.

## 7. Accessibility is a foundation, not a component feature

Surf's accessibility directory covers 60+ systems; the recurring floor is WCAG 2.1 AA: text contrast 4.5:1, UI/large text 3:1, focus visible, touch targets 44×44pt on iOS (48dp Android, 24px min web), motion respects reduce-motion, color never the sole carrier of meaning (pair with icon or text). The token script enforces contrast; the component specs enforce targets and states; the doc records the target so nobody re-derives it.

## 8. Design–code alignment

One source of truth per decision. Here the spec is the truth; tokens are derived; components consume tokens; the playground renders tokens; the doc describes all of it. When Figma exists, the spec's `sources` field cites the file so the mapping is traceable. When Figma variables exist, they should equal the primitives in `tokens.json`; if they diverge, say so in the doc rather than silently picking one.
