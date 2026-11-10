# Figma

Two directions, one rule: `style-spec.json` and `tokens.json` are the source of truth. Figma is either evidence going *in* (read) or a rendering going *out* (write). Never hand-patch tokens to match a Figma file, and never hand-patch a Figma file to match code; re-run the pipeline in the right direction.

The Figma MCP server must be connected (tools named `get_design_context`, `get_variable_defs`, `use_figma`, etc.). If it isn't, say so once and fall back to advice mode (last section).

## Reading from Figma (intake step 3)

Covered in `intake.md` § From Figma for style extraction. Two additions when the file has a component library:

1. **Map component sets to the inventory.** `get_metadata` on the Components page, list component sets, and match each to an inventory name (`Button`, `Text Field` → `TextField`). Record unmatched Figma components; they either become Extended-tier requests or are noted as out of scope. Don't invent inventory entries to absorb them.
2. **Map variant properties to props.** A Figma set with `Style=Primary, Size=Medium, State=Default` maps to `variant='primary'`, `size='md'`. Record the mapping in the spec's `sources[].componentMap` so the write path can reuse the same names and Code Connect can be set up later. Figma property names are Title Case, code unions are lowercase; keep both, translate at the boundary.

## Writing to Figma (pipeline step 9)

Do this only when the user asks for it or the intake answer for Figma is "push". It's the most expensive step (20–100+ `use_figma` calls) and it mutates a file they own.

**Before the first `use_figma` call, load the Figma server's own skills.** Fetch `skill://figma/figma-use/SKILL.md` and `skill://figma/figma-generate-library/SKILL.md` with the server's `get_figma_skill` tool (or `read_skill_uri`), read them, and follow their phase structure, state ledger, and Plugin API rules. They are maintained by Figma and change with the API; this file only tells you how *this* skill's artifacts map onto their phases. Never call `use_figma` from memory.

### Phase mapping

| figma-generate-library phase | What this skill feeds it |
|---|---|
| 0 Discovery | `tokens.json`, `components/manifest.json`, and the component files are the "codebase". Print the gap analysis against whatever the Figma file already has. Existing conventions in the file win over the tables below. |
| 1 Foundations | Variables from `tokens.json` (table below), text styles from `font.<role>.<size>`, effect styles from `elevation.0–4`. |
| 2 File structure | Cover → Foundations → `---` → one page per component in inventory order. |
| 3 Components | One component set per manifest entry, in inventory order, core tier first. |
| 4 QA | Unresolved-binding audit must be zero (same rule as "no hex in components"). |

### tokens.json → Figma variables

| tokens.json | Collection (modes) | Name | Scopes | Code syntax (WEB / iOS) |
|---|---|---|---|---|
| `color.<family>.<step>` | Primitives (Value) | `color/<family>/<step>` | `[]` (hidden) | none |
| `bg.*`, `surface.*` | Semantic (Light, Dark) | `bg/accent/default` | `FRAME_FILL, SHAPE_FILL` | `var(--<prefix>-bg-accent-default)` / `Tokens.bg.accent.default` |
| `text.*`, `icon.*` | Semantic (Light, Dark) | `text/default` | `TEXT_FILL` (icon: `SHAPE_FILL`) | same pattern |
| `border.*` colors | Semantic (Light, Dark) | `border/strong` | `STROKE_COLOR` | same pattern |
| `space.<n>` | Space (Value) | `space/4` | `GAP, WIDTH_HEIGHT` | `var(--<prefix>-space-4)` / `Tokens.space[4]` |
| `radius.<k>` | Radius (Value) | `radius/md` | `CORNER_RADIUS` | `var(--<prefix>-radius-md)` |
| `font.size.<n>`, line heights | Typography (Value) | `font/size/300` | `FONT_SIZE`, `LINE_HEIGHT` | as above |
| `opacity.*` | Semantic (Value) | `opacity/disabled` | `OPACITY` | as above |

Semantic color variables alias primitives (`VARIABLE_ALIAS`), one alias per mode, mirroring how `build_tokens.py` resolves them. Never paste a hex into the semantic collection; if the value isn't a primitive, the token script is wrong, not Figma.

Dot path → slash path is the only renaming. Keep the token names otherwise identical so Dev Mode shows the same name a developer will type.

### manifest.json → component sets

- One component set per manifest entry, named exactly as in the manifest.
- Variant properties mirror the exported unions: `Variant` = `variants[]`, `Size` = `sizes[]`, `State` = the interaction states that aren't props (`Default, Pressed, Focus, Disabled`). Boolean props (`loading`, `fullWidth`, `selected`) become BOOLEAN properties, not variants. `label`/`title`/`placeholder` become TEXT properties. Icon slots become INSTANCE_SWAP with a BOOLEAN `Show leading icon` that toggles visibility.
- Cap the matrix: if Variant × Size × State > 30, drop `Size` into a separate set or collapse rarely-combined states, as figma-generate-library advises.
- Set the component `description` from the file's doc block (purpose / use for / don't use for). That text is what designers see on hover; keep it the same text as the code.

### Auto layout rules (how every component frame is built)

- Every component frame and every internal container is auto layout. No absolute positioning except badges and status dots (`layoutPositioning: 'ABSOLUTE'`).
- Padding and gap are bound to `space/*` variables; radius to `radius/*`; fills and strokes to semantic color variables. A literal in Figma is a defect, same as in code.
- Sizing from the inventory: Button, Chip, Tag, Badge, IconButton are hug × hug with a fixed min-height equal to the size table (32/44/52). TextField, ListItem, Card, Alert, TopBar are fill × hug. Dialog and Sheet are fixed × hug at their max width.
- Text layers hug; the container decides wrapping. Set `textAutoResize` to `HEIGHT` on multi-line text (Alert description, ListItem subtitle) and `WIDTH_AND_HEIGHT` on labels.
- Order children in the layer list the way they read: leading → content → trailing. Name them from the anatomy list (`container`, `label`, `leadingIcon`).
- Apply text styles, not raw font properties, so a type-scale change in the spec re-flows Figma the same way it re-flows code.

### After the push

- Record `fileKey`, the Foundations page id, and the state ledger path in `style-spec.json` under `sources[]` with `direction: "push"` and the date.
- Add the Figma link and "code is upstream of Figma" to `DESIGN_SYSTEM.md` § Sources.
- Optional but cheap while context is fresh: Code Connect mappings (`figma-code-connect` skill on the Figma server) from each component set to its component file.

## Keeping them in sync later

- Spec change (retheme, radius, new variant): re-run tokens → Storybook → playground, then re-run only the affected Figma phase (variables for a token change, one component set for a variant) using the ledger IDs. Never rebuild the whole file for a delta.
- Designer changes Figma first: treat it as a read. Extract the delta into the spec, confirm with the user, run the pipeline forward, then push the reconciled result back. The spec stays the single input either way.

## Advice mode (no MCP, or the user is doing it by hand)

When the Figma server isn't available, still answer Figma questions from the tables above: how to name the collections, which scopes to set, how to structure a component set's properties, hug vs fill per component, how to bind padding to variables. Give the exact names this skill would have used so a hand-built file and a pushed file end up identical.
