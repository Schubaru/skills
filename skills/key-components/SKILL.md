---
name: key-components
description: "Builds, edits, and reverse-engineers complete design systems for any project: layered tokens, a fixed component inventory with expertly designed React + TypeScript APIs (React Native default; also web, SwiftUI), a CSF3 Storybook story per component (RN on-device or web Storybook 10), an HTML playground, a DESIGN_SYSTEM.md as source of truth, and on request the system pushed to Figma as variables and auto-layout component sets via the Figma MCP. Use whenever the user invokes /key-components or asks to create, extract, edit, retheme, or audit a design system, tokens, theme, style guide, component library, or UI kit; wants Storybook set up or stories written; asks how a component's props or API should be designed; shares a Figma link or screenshot to pull style from, or wants tokens/components pushed to Figma; or wants brand colors, fonts, or radius changed across a codebase. Trigger on casual phrasing too (\"make the styles consistent\", \"add stories for these\", \"what should the Button props be\", \"get this into Figma\"). Never build tokens or stories from memory without it."
---

# Key Components

Builds a design system the same way every time. The *style* changes per project; the *structure*, file layout, token names, component inventory, story order, and build order never do. That predictability is the whole point: The user can open any project he has built with this skill and know exactly where everything is and what it is called.

Three areas of expertise sit on top of the pipeline, each with its own reference file:

- **Component API design** (`references/component-api.md`): how props should be shaped so a teammate can guess them and a redesign doesn't break call sites.
- **Storybook** (`references/storybook.md`): on-device React Native Storybook or web Storybook 10, CSF3 stories generated from the manifest then hand-extended, play functions, a11y.
- **Figma** (`references/figma.md`): reading style and component libraries out of Figma, and pushing tokens as variables and components as auto-layout component sets back in through the Figma MCP.

## What "done" looks like

Every run, regardless of input, produces this in the project (default root folder `design-system/`):

```
design-system/
├── style-spec.json            # The single input. Everything below is derived from it.
├── DESIGN_SYSTEM.md           # Source of truth for humans and future Claude sessions
├── tokens/
│   ├── tokens.json            # Resolved primitive + semantic tokens (DTCG-style), light & dark
│   ├── tokens.ts              # RN / web TS export        (platform-dependent)
│   ├── tokens.css             # CSS custom properties     (web only)
│   └── Tokens.swift           # Swift constants           (SwiftUI only)
├── components/                # One file per component, fixed inventory, fixed order
│   ├── Button.tsx
│   ├── Button.stories.tsx     # One story file per component, fixed story order
│   └── manifest.json
├── playground/
│   └── index.html             # Self-contained HTML playground (always built)
└── previews/                  # Native previews when the platform has them
.rnstorybook/ or .storybook/   # Storybook config at project root (unless the user opts out)
```

Nothing else gets invented. If the user asks for something outside this shape, add it *inside* this shape (a new component file, a new section in the doc), don't create a parallel structure. A Figma push adds nothing to the repo except a `sources[]` entry in the spec and a link in the doc.

## The pipeline (run in this order, every time)

```
1. Detect mode      → create / edit / extract-from-codebase
2. Intake           → ask the fixed question set, in one batch
3. Extract style    → from description, Figma, screenshot, or codebase → draft style-spec.json
4. Confirm spec     → show it, get an explicit yes, write style-spec.json
5. Generate tokens  → scripts/build_tokens.py   (deterministic, never hand-write tokens)
6. Build components → fixed inventory, fixed order; API rules from references/component-api.md
7. Stories + preview→ scripts/build_stories.py + Storybook setup, scripts/build_playground.py, native previews
8. Write the doc    → assets/DESIGN_SYSTEM.template.md, fill every section
9. Figma push       → only when asked; references/figma.md + the Figma server's own skills
10. Verify          → checklist at the bottom of this file
```

`<skill>` below means this skill's install directory (in Claude Code `~/.claude/skills/key-components`, or `.claude/skills/key-components` if installed per project); resolve it once at the start of the run. Steps 5 and 7 are scripts on purpose. Hand-writing a color ramp, a type scale, or twenty-seven story files produces slightly different output each session and the user has been explicit that he does not want that. The scripts encode the structure once.

### Step 1 — Detect mode

Look for `design-system/style-spec.json` (or the path recorded in an existing `DESIGN_SYSTEM.md`).

- **Found** → edit mode. Read the spec and the doc before asking anything. The user's request is a delta against a known state.
- **Not found, and the repo has UI code** → extract mode. Run `scripts/audit_codebase.py <src-dir>` first so the intake questions come pre-filled with what the code actually uses. See `references/intake.md` § Extracting from a codebase.
- **Not found, no UI code** → create mode.

Also detect, in the same pass: an existing Storybook (`.storybook/`, `.rnstorybook/`, `storybook` in `package.json`) and whether the Figma MCP tools are available. Both change what step 7 and step 9 can do.

Say which mode you're in, in one line, before asking questions.

### Step 2 — Intake (always ask, always the same questions)

Read `references/intake.md` and ask its question set **in a single message**, not one at a time. Every question carries a default so the user can answer "defaults for everything except X." Pre-fill answers you already have (from Figma, a screenshot, the codebase audit, or the existing spec) and mark them as "detected, confirm?" rather than re-asking blind.

Platform default when unspecified: **iOS via React Native (TypeScript)**. That is this skill's default; never ask "web or mobile?" as an open question, ask "iOS/React Native (default), or something else?" Storybook defaults to yes; Figma push defaults to no.

Do not skip intake in edit mode; ask only the questions the edit touches, but still ask them. Do not start building until the spec is confirmed.

### Step 3 — Extract style

Four input paths funnel into the *same* `style-spec.json`. The spec is the only thing the build reads, so the output is identical whether the style came from words, Figma, a PNG, or a repo. Method per input is in `references/intake.md`; the Figma path has extra guidance in `references/figma.md` § Reading when the file has a component library. Two rules that apply to all four:

- Reduce before you record. Twenty blues in a Figma file become one `primary` seed plus a note. The ramp script regenerates the shades.
- Record intent, not pixels, wherever the spec allows it: `radius.profile: "soft"` not `radius: 11px`. The spec schema is in `assets/style-spec.example.json` with every field commented.

### Step 4 — Confirm

Print the full spec as JSON, then a 5-line plain-English summary ("Cool neutrals, Inter, 1.2 ratio, soft radii, light+dark, core components, React Native, Storybook on-device, no Figma push"). Wait for an explicit yes. Then write `design-system/style-spec.json`.

### Step 5 — Generate tokens

```bash
python3 <skill>/scripts/build_tokens.py design-system/style-spec.json design-system/tokens/
```

This writes `tokens.json` and the platform files. Read `references/token-architecture.md` once so you understand what the script produced and why (three tiers, naming scheme, contrast guarantees); you'll need that vocabulary when writing components and the doc. Never edit generated token files by hand; edit the spec and re-run.

### Step 6 — Build components

Read `references/component-api.md` first, then `references/component-inventory.md`. The inventory defines the fixed list, the fixed build order, and for each component its anatomy, variants, sizes, states, and props. The API file defines how those props are shaped: interface order, unions over booleans, native props extended, slots as `ReactNode`, `size` moving height + padding + type together, escape hatches limited to layout. Then read the platform file (`references/platform-react-native.md`, `platform-web.md`, or `platform-swiftui.md`) for the exact file template, naming, and how components consume tokens.

Start from `assets/manifest.core.json` (copy it to `components/manifest.json`, then trim or extend to match the spec's tier). Build the **Core** tier always. Build **Extended** only if the spec says so. Never add a component that isn't in the inventory without first adding it to the inventory doc in the project's `DESIGN_SYSTEM.md` (that keeps the system self-describing for the next session).

Components reference tokens only. A hardcoded hex, font size, or spacing value in a component is a defect. This is what makes edit mode cheap: change the spec, regenerate tokens, components follow. Run the API review checklist at the bottom of `component-api.md` on each component before starting the next; it's faster than fixing twenty-seven files afterwards.

### Step 7 — Stories, Storybook, playground

Three previews, each with a reason to exist:

**Storybook** is the workbench (unless the user opted out). Read `references/storybook.md`. Detect or install Storybook for the platform, then generate the stories:

```bash
python3 <skill>/scripts/build_stories.py design-system/components/manifest.json design-system/components/ --platform rn   # or web
```

Every component gets the same five stories in the same order (Default, one per variant, Sizes, States, DarkMode). The generator never overwrites an existing story file, so hand-added stories and play functions survive regeneration. After it runs, typecheck, fix any `args` that don't match the props you wrote, and copy the fix back into the manifest so the next run matches. Then add component-specific stories and play functions where there's interaction logic.

**Playground** is the dependency-free token sheet:

```bash
python3 <skill>/scripts/build_playground.py design-system/tokens/tokens.json design-system/playground/index.html --components design-system/components/manifest.json
```

It renders every token (color ramps with contrast ratios, type scale, spacing, radius, elevation) and an HTML approximation of every component, with light/dark toggles, from the same `tokens.json`, so it can't drift from the code. The HTML renderings are faithful approximations driven by the real tokens, not the RN/SwiftUI source itself. Say that once in the doc; don't oversell it.

**Native previews** where the platform has them: `previews/Gallery.tsx` for RN (runs inside the app without a Storybook install), `previews/Gallery.swift` with `#Preview` blocks for SwiftUI. Web needs neither; Storybook is the gallery.

### Step 8 — The doc

Fill `assets/DESIGN_SYSTEM.template.md` completely. This file is what future Claude Code sessions read *instead of* re-deriving the system, so it must state decisions explicitly: which tokens exist, what each component is for and not for, how to add a component, how to run Storybook and the scripts, where the Figma file is and which direction is upstream, and a changelog. designsystems.surf's core argument (`references/principles.md` § AI-ready) is that systems fail AI not from missing assets but from missing *context about which decisions are current and approved*. The doc is that context. Write it for a reader who has never seen the project.

Add one line to the project's `CLAUDE.md` (create it if absent): `Design system: read design-system/DESIGN_SYSTEM.md before touching any UI.`

### Step 9 — Figma push (only when asked)

When the intake answer for Figma is "push", or the user asks later, read `references/figma.md`. It maps `tokens.json` onto variable collections (Primitives / Semantic with Light+Dark / Space / Radius / Typography, scopes and code syntax set on every variable) and `manifest.json` onto component sets whose variant properties mirror the exported prop unions, built with auto layout and every fill, stroke, padding, gap, and radius bound to a variable.

Before the first `use_figma` call, load the Figma server's own `figma-use` and `figma-generate-library` skills and follow their phases and state ledger. Those are maintained by Figma and change with the API; this skill only supplies the mapping tables. Code is upstream of Figma: a later spec change re-runs the affected Figma phase, and a designer's change in Figma is re-extracted into the spec, not patched into tokens.

### Step 10 — Verify

Before declaring done, check each of these and report the result in one compact list:

- `style-spec.json` validates against the example schema (all required fields present)
- `tokens.json` exists, light and dark both present, every semantic text/bg pair ≥ 4.5:1 (script prints this)
- Every Core component file exists, in inventory order, and imports tokens (grep for hex literals: expect zero)
- Every component passes the API checklist in `component-api.md` (unions exported, size table, native props extended, a11y set inside)
- `components/manifest.json` lists exactly the built components, with `args` that typecheck
- One `.stories.tsx` per manifest entry; `npx tsc --noEmit` clean; Storybook builds (or the RN bundle compiles with `STORYBOOK_ENABLED=true`); zero hex literals in stories
- `playground/index.html` opens without console errors (file exists, size > 20 KB, contains every component name)
- `DESIGN_SYSTEM.md` has no `TODO` or empty section; Storybook run command and Figma line filled in
- `CLAUDE.md` pointer present
- If pushed to Figma: unresolved-binding audit is zero and the file key is in `sources[]`

## Edit mode specifics

Typical edits: retheme (new primary), swap fonts, change radius profile, add dark mode, add a component, add a variant to a component, tighten density, add stories or play functions, sync a change to Figma.

1. Read the current spec and doc. State the delta you're about to make.
2. Ask the intake questions the delta touches (e.g. a retheme asks color + neutral temperature; nothing else).
3. Update the spec → re-run `build_tokens.py` → re-run `build_playground.py`. Run `build_stories.py` only if a component was added (it skips existing files anyway).
4. Edit only the components the delta requires (a new variant touches one component file and its story file; a token change touches none). A prop rename follows the deprecation path in `component-api.md`.
5. Append a dated entry to the doc's changelog and update the affected sections. Bump `version` in the spec (semver: token value change = minor, component API change = major, doc-only = patch).
6. If the system was pushed to Figma, re-run only the affected phase using the ledger IDs (`references/figma.md` § Keeping them in sync).
7. Re-run the verify checklist.

Never "refresh" or regenerate untouched components or stories. Determinism cuts both ways: an edit changes exactly what was asked and nothing else.

## Extract mode specifics (project has UI but no system)

1. Run `scripts/audit_codebase.py <src>`. It reports every hardcoded color, font size, font family, spacing value, and radius with usage counts and file locations.
2. Cluster: the top 1–2 saturated colors become `primary`/`secondary` candidates; the dominant desaturated family sets neutral temperature; the most-used body size sets `type.baseSize`; radius values map to a profile.
3. Present the proposed spec alongside the audit evidence ("`#2563EB` used 41× → primary"). The user confirms or corrects.
4. Proceed with the normal pipeline. Then produce `design-system/MIGRATION.md`: a table mapping each hardcoded value found to its new token, so the existing code can be migrated incrementally. Do not mass-rewrite the app's existing components unless asked; the system comes first, migration is a separate task.

## Standalone requests

Not every invocation is a full build. When the user asks for one slice, do that slice with the same rules and nothing more:

- "What should the props for X be?" → `references/component-api.md`, answer with the interface and the reasoning, no files unless asked.
- "Add stories for these components" → detect Storybook, write or generate stories per `references/storybook.md`; if the project has no manifest, write the stories by hand in the same fixed order.
- "Set up Storybook" → `references/storybook.md` § Setup, nothing else.
- "How should I structure this in Figma?" / "push this to Figma" → `references/figma.md`; advice mode if the MCP isn't connected.

## Knowledge base

`references/principles.md` distills designsystems.surf: the layered typography model (scale → primitives → roles → semantics → styles), the five component categories (actions, inputs, feedback, navigation, status), color-role structure, and what makes a system usable by AI. Read it once per project; it's what "deep understanding" means here. `references/surf-links.md` has the specific surf pages to point the user to when he wants to compare how Material, Spectrum, Polaris, Primer, etc. solved something. Only fetch surf live if the user asks for a specific system's current approach; the curated references are the default so runs stay fast and identical.

`references/component-api.md`, `references/storybook.md`, and `references/figma.md` are the three expertise files described at the top. Read the one the current step needs; don't front-load all three.

## Working style

Assume the user is a designer who builds. Be direct and opinionated: when the intake leaves a real choice, recommend one and say why in a sentence. No em dashes. Don't explain what a design token, a story, or a variable is. Do flag when a request would break the architecture (e.g. "a one-off button color is a component token, not a hex in the component; I'll add `button.bg.promo` to the spec" or "a `color` prop on Button bypasses tokens; that's a new variant"). If he wants something the fixed structure doesn't cover, extend the structure in the doc first, then build; that keeps the next session honest.
