# {{name}} Design System

> Source of truth for every UI decision in this project. Read this before touching any UI. Built with the `key-components` skill on {{date}}. Version {{version}}.

## 1. Overview

- **Platforms:** {{platforms}}
- **Modes:** {{modes}}
- **Style in one paragraph:** {{style_summary}}
- **Sources:** {{sources}}
- **Where things live:**
  - Spec: `{{output}}/style-spec.json` (the only file you edit to change the system)
  - Tokens: `{{output}}/tokens/` (generated, do not hand-edit)
  - Components: `{{output}}/components/` (manifest in `manifest.json`)
  - Stories: `{{output}}/components/*.stories.tsx` (Storybook config in `{{storybook_dir}}`; run `{{storybook_cmd}}`)
  - Playground: `{{output}}/playground/index.html` (open in a browser)
  - Figma: {{figma_line}}
  - Native previews: `{{output}}/previews/`

## 2. Principles

Decide once, ripple everywhere. Components never contain literal values. Roles describe purpose, not appearance. Accessibility target: {{a11y_target}}. Every text/background pairing named in the semantic layer is contrast-checked.

## 3. Foundations

### 3.1 Color
- Seeds: primary `{{primary}}`{{secondary_line}}{{accent_line}}; neutrals `{{neutral}}`.
- Ramps: 11 steps (50–950) per family. Primitive names `color.<family>.<step>`.
- Semantic roles (use these, not ramps): `bg.*`, `surface.*`, `text.*`, `border.*`, `icon.*`, `overlay.*` × intents `default | subtle | muted | strong | inverse | accent | success | warning | danger | info | disabled | focus`.
- Light/dark: {{mode_rule}}
- Contrast report: {{contrast_summary}}

### 3.2 Typography
- Families: display `{{display_font}}`, body `{{body_font}}`, mono `{{mono_font}}`. Loading: {{font_loading_note}}
- Scale: base {{base_size}}, ratio {{ratio}}, steps `font.size.100–900`.
- Roles and when to use them:

| Role | Use for | Don't use for |
|---|---|---|
| display | Hero moments, onboarding headlines | Anything that appears more than once per screen |
| headline | Screen-level headings | Card titles (that's title) |
| title | Section, card, modal, list-group headers | Body reading |
| body | Reading flow, descriptions | Headings, buttons |
| label | Buttons, tabs, form labels, chips | Paragraphs |
| caption | Helper text, timestamps, metadata | Primary content |
| mono | Codes, IDs, amounts needing alignment | Prose |

Each role has `lg | md | sm` (caption/mono: `md | sm`). Token path: `font.<role>.<size>.{family,size,lineHeight,weight,letterSpacing}`.

### 3.3 Space
Base {{space_base}}. Steps `space.0 1 2 3 4 5 6 8 10 12 16 20 24`. Density: {{density}}.

### 3.4 Shape
Radius profile `{{radius_profile}}` → `radius.none xs sm md lg xl full`. Default border weight `{{border_weight}}`.

### 3.5 Elevation, motion, opacity, z-index
Elevation `{{elevation}}` (levels 0–4). Motion `fast 120 / normal 200 / slow 320` ms, respects reduce-motion. Opacity `disabled 0.4 / muted 0.64`. Z-index `base raised sticky overlay modal toast`.

## 4. Components

Inventory (tier: {{tier}}). Category · purpose · variants · sizes · states. Full anatomy and don'ts are in each component's header comment.

{{component_table}}

**Adding a component:** add it to this table first (category, purpose, anatomy, variants, sizes, states, don'ts), then build it following the universal rules (tokens only; states default/pressed/focus/disabled; ≥44pt targets; accessibility props), add it to `components/manifest.json`, regenerate the playground.

## 5. Usage rules (the don'ts)

- No hex, rgb, px, or font-size literals in components or screens. Import from tokens.
- Don't reach for primitives (`color.blue.600`) in product code; use semantic roles. If no role fits, add one to the spec's semantic layer, don't bypass it.
- One primary Button per view. Chip toggles/filters; Button submits. Tag is static; Badge attaches to something. Dialog is for decisions; Sheet is for content.
- Never disable focus visibility.
- Color never carries meaning alone; pair with icon or text.
{{extra_rules}}

## 6. How to change the system

1. Edit `style-spec.json`.
2. `python3 <skill>/scripts/build_tokens.py {{output}}/style-spec.json {{output}}/tokens/`
3. `python3 <skill>/scripts/build_playground.py {{output}}/tokens/tokens.json {{output}}/playground/index.html --components {{output}}/components/manifest.json`
4. `python3 <skill>/scripts/build_stories.py {{output}}/components/manifest.json {{output}}/components/ --platform {{platform_flag}}` (only writes stories for new components; existing story files are yours)
5. Only touch component files if the change adds a variant or component.
6. If the system is pushed to Figma: re-run only the affected phase (variables for a token change, one component set for a variant) per the skill's `references/figma.md`.
7. Bump `version` (token values: minor; component API: major; docs: patch) and add a changelog entry below.

Or run `/key-components` and describe the change; the skill follows this exact procedure.

## 7. Deprecations

| Item | Deprecated in | Replacement | Remove after |
|---|---|---|---|
| — | | | |

## 8. Changelog

- **{{version}} — {{date}}** — Initial system. {{initial_summary}}
