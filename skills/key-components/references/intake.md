# Intake

The question set is fixed so every run collects the same information in the same order. Ask everything in **one message**. Pre-fill anything you already know and label it `detected` so the user confirms rather than re-types. Each item states its default; "defaults" as an answer means accept every default not otherwise overridden.

## The question set

Present it exactly in this order, numbered, as a compact list. Skip nothing in create mode. In edit mode, ask only the items the edit touches, but keep the numbering so the spec fields are unambiguous.

```
1. Source        — describe the style / Figma link / screenshot(s) / "use what's in this repo"
2. Platform      — default: iOS via React Native (TypeScript). Other options: web (React + CSS vars), SwiftUI, or multiple.
3. Name & prefix — project name; token prefix for CSS/Swift (default: derived from name, kebab/Pascal)
4. Colors        — primary seed hex; optional secondary and accent seeds. Semantic status colors (success/warning/danger/info) default to fixed hues unless overridden.
5. Neutrals      — cool / warm / pure. Default: cool (slight blue tint). Determines the gray ramp and default surfaces.
6. Type          — display family, body family, mono family; base size (default 16 web, 17 iOS-RN); scale ratio (default 1.200 minor third); density normal / compact.
7. Shape         — radius profile: sharp / soft / round / pill (default soft). Border weight: hairline / regular (default regular).
8. Modes         — light only / light + dark (default: both)
9. Components    — core / core + extended / core + a named subset of extended (default: core)
10. Output path  — default: design-system/ at project root
11. Storybook    — yes (default; on-device RN Storybook, web Storybook for web) / no / use the project's existing Storybook (detected)
12. Figma        — none (default) / read style from <link> / read + push the finished library to <file> as variables and components
```

Then one closing line: "Anything the system must accommodate that isn't covered (brand rule, accessibility target beyond AA, existing font licences, RTL)?"

Why these twelve and no more: every field maps to a key in `style-spec.json` and every key drives a script. A question that doesn't change the output is noise. A missing question means the script guesses, and guessing is the thing this skill exists to prevent.

## Recommending, not just asking

The user prefers an opinion. For any item where they haven't stated a preference and the source doesn't settle it, attach a one-line recommendation: "Recommend `soft` radius; the screenshot's cards read as ~10px which lands there." Keep it to one line per item.

## Extracting the style per source

All four paths produce a draft `style-spec.json`. Only the spec is built from; the source is evidence.

### From a description

Map adjectives to spec fields with this table so the mapping is repeatable:

| The user says | Spec field |
|---|---|
| "clean / minimal / airy" | density normal, radius soft, neutrals cool, elevation low |
| "dense / data-heavy / dashboard" | density compact, radius sharp or soft, base size 14 (web) |
| "friendly / playful / consumer" | radius round or pill, saturated primary, warm neutrals |
| "premium / editorial / luxury" | display serif, high type contrast (ratio 1.25+), sharp radius, pure neutrals |
| "fintech / trustworthy" | cool neutrals, blue/teal primary, soft radius, regular borders |
| "brutalist / raw" | sharp radius, hairline borders off, mono display, pure neutrals |

Ask for a primary hex if none was given; do not invent a brand color. If the user names a reference app ("like Linear," "like Robinhood"), read `references/surf-links.md` for whether the surf library documents that system and describe what you'd borrow before assuming.

### From Figma (Figma MCP available in Claude Code)

1. `get_design_context` / `get_variable_defs` on the shared node. If the file has variables, they *are* the primitives: read color, spacing, radius, and type variables directly and record their seed values.
2. If no variables, `get_metadata` and walk the top-level frames: collect fills, text styles, corner radii, effects. Reduce: cluster colors by hue (within 10° hue, treat as one seed), take the most saturated as primary; take the most common body text size as `baseSize`; infer ratio from the two most common heading sizes (`ratio ≈ (h1/h2)`, snap to the nearest of 1.125 / 1.200 / 1.250 / 1.333); map median corner radius to a profile (≤4 sharp, ≤10 soft, ≤16 round, >16 pill).
3. Record the Figma file key and node id in the spec's `sources` array so the doc can cite where the style came from.

### From a screenshot

You can see the image. Extract in this order, recording confidence:

1. Primary: the dominant saturated UI color (buttons, links, active states). Read it as best you can; state the hex as an estimate and ask the user to confirm or paste the real value. Never present an eyeballed hex as exact.
2. Neutral temperature: compare the lightest background to pure white. Bluish → cool, yellowish → warm, indistinguishable → pure.
3. Type: serif vs sans display; relative heading/body ratio (large jump → 1.25–1.333, modest → 1.125–1.2); if a recognizable typeface, name it and ask to confirm.
4. Radius: read the buttons and cards. Map to a profile.
5. Density: how much whitespace around list rows and inside cards.
6. Elevation: flat/bordered vs shadowed cards.

State every estimate as an estimate. The user will correct; that's cheaper than false precision.

### From an existing codebase (extract mode)

Run the auditor first, before any question:

```bash
python3 <skill>/scripts/audit_codebase.py <src-dir> --out design-system/audit.json
```

It scans `.ts .tsx .js .jsx .css .scss .swift .kt .dart .vue .svelte .html` for hex/rgb/hsl colors, font families, font sizes, spacing-shaped numbers in style contexts, and radius values, with counts and locations. Then:

- Colors: sort saturated colors by count. Top → `primary`, second (if distinct hue >30°) → `secondary`. The dominant low-saturation family sets neutral temperature.
- Type: most-used size in body-shaped contexts → `baseSize`. Any `fontFamily` strings → families.
- Spacing: if ≥80% of values are multiples of 4 → base 4; multiples of 8 → base 8; otherwise 4 and note the outliers.
- Radius: median of found values → profile.

Present the proposed spec **with the evidence** (counts and 2–3 file paths per decision). Ask the intake set with those fields marked `detected`. Then build normally and produce `MIGRATION.md` mapping every found literal to its token.

## Writing the spec

Use `assets/style-spec.example.json` as the schema. Every field is required except `secondary`, `accent`, `sources`, and `notes`. Fill `version: "1.0.0"` for a new system. Print it, get a yes, write it. Then and only then run the scripts.
