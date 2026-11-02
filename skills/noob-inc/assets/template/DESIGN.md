---
name: N00B Inc
description: One truth, two readings. A neutral fleet board for Claude Code agents, with a pixel office that reads the same state from across the room.
colors:
  n0: "#f4f5f7"
  n1: "#ebecef"
  n2: "#dfe1e5"
  n3: "#cdcfd4"
  n4: "#a5a8ae"
  n5: "#7b7e85"
  n6: "#5a5d64"
  n7: "#3a3c42"
  n8: "#222327"
  n9: "#121316"
  white: "#ffffff"
  amber: "#c27a00"
  amber-bg: "#fff3dd"
  green: "#1f8a4c"
  green-bg: "#e3f6ea"
  blue: "#2a63c9"
  blue-bg: "#e4edfb"
  red: "#c4302a"
  red-bg: "#fde7e5"
  livery-0: "#ff4d4d"
  livery-1: "#ff9f1c"
  livery-2: "#ffd400"
  livery-3: "#2ed47a"
  livery-4: "#19c3c6"
  livery-5: "#3a86ff"
  livery-6: "#a259ff"
  livery-7: "#ff5da2"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.02em"
  title:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.06em"
  body:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.04em"
  mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
rounded:
  chip: "1px"
  bar: "2px"
  kbd: "3px"
  sm: "4px"
  card: "6px"
  none: "0px"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "48px"
components:
  button:
    backgroundColor: "{colors.white}"
    textColor: "{colors.n9}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "30px"
    typography: "{typography.body}"
  button-hover:
    backgroundColor: "{colors.n1}"
  button-primary:
    backgroundColor: "{colors.n9}"
    textColor: "{colors.n0}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "30px"
  button-primary-hover:
    backgroundColor: "{colors.n7}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.n6}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "30px"
  button-quiet-hover:
    backgroundColor: "{colors.n1}"
    textColor: "{colors.n9}"
  button-danger:
    backgroundColor: "{colors.white}"
    textColor: "{colors.red}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "30px"
  button-danger-hover:
    backgroundColor: "{colors.red-bg}"
  button-sm:
    height: "26px"
    padding: "0 9px"
  button-icon:
    width: "30px"
    height: "30px"
    padding: "0"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.n9}"
    rounded: "{rounded.sm}"
    padding: "7px 10px"
  card:
    backgroundColor: "{colors.white}"
    textColor: "{colors.n9}"
    rounded: "{rounded.card}"
    padding: "16px 18px 18px"
  chip:
    rounded: "{rounded.chip}"
    width: "14px"
    height: "10px"
  chip-lg:
    rounded: "{rounded.chip}"
    width: "20px"
    height: "14px"
  status-word:
    typography: "{typography.title}"
  table-row:
    backgroundColor: "{colors.white}"
    padding: "0 12px"
    height: "48px"
  table-row-hover:
    backgroundColor: "{colors.n1}"
  table-header:
    backgroundColor: "{colors.n1}"
    typography: "{typography.label}"
    padding: "0 12px"
    height: "32px"
  blocker:
    backgroundColor: "{colors.amber-bg}"
    rounded: "{rounded.card}"
    padding: "12px 14px 14px"
  bar:
    backgroundColor: "{colors.n2}"
    rounded: "{rounded.bar}"
    height: "3px"
  segment:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.sm}"
    padding: "6px 14px"
  segment-on:
    backgroundColor: "{colors.n9}"
    textColor: "{colors.n0}"
  kbd:
    backgroundColor: "{colors.n1}"
    rounded: "{rounded.kbd}"
    padding: "1px 5px"
---

# Design System: N00B Inc

## Overview

**Creative North Star: "The Race Team Pit Wall"**

N00B Inc is a Wipeout / Designers Republic world held to four things: condensed caps type, one neutral ramp, tight row density, and a single skewed livery plate. Everything on the dashboard is gray on gray; color is information. Four state colors say what an agent needs from you, and eight saturated liveries thread each agent's board row to its pixel employee in the office. The chrome never moves on its own; the office is the only living region, and it is a second reading of the same truth the board shows.

The surface is an operate-mode instrument, not a brochure. Numbers are tabular, bars are exact-length, finished agents stay on the roster struck through, and nothing is decorated that is not also data. The one indulgence is typographic: Barlow Condensed in caps, slightly tracked, for the wordmark, column labels, status words and section headings. Archivo carries every sentence and figure.

**Key Characteristics:**
- One ten-step neutral ramp is the only gray in both themes; light and dark remap the same ten slots.
- Color means something: amber waits on you, green works, blue thinks, red stopped. Liveries live only on chips and sprites.
- Condensed caps for labels and status, neutral grotesk with tabular numerals for everything else.
- Chips are skewed plates (skewX -14deg), the one tDR gesture; everything else is a 4px or 6px rectangle.
- Flat surfaces, 1px lines; shadows only on the two floating layers (agent panel, idle warning) and the login card.
- No decorative motion in the chrome; the office canvas is the one animated region.

## Colors

A cool, near-monochrome neutral ramp carries all chrome; four state pairs and eight liveries are the only saturated ink, and each of them is a signal.

### Primary
- **Ink** (`n9`): text, the primary button fill, the selected-row 2px inset edge, the focus ring, the wordmark plate. In dark mode the ramp flips and `n9` becomes near-white, so "ink" is always the strongest contrast step.

### Secondary (state)
- **Amber, waiting on you** (`amber` / `amber-bg`): the waiting band in the agent sheet, the row's Answer / Review button, the "waiting on you" count in the board head, the holding and blocked status words, the idle-warning border, the blocker icon in the activity stream. The only color allowed to tint a whole surface.
- **Green, working** (`green`): the working status word and dot; the bridge status when connected.
- **Blue, thinking** (`blue`): the thinking status word and dot; prompt events in the stream.
- **Red, stopped** (`red` / `red-bg`): stopped status, danger buttons on hover, form errors, the login error message.

### Tertiary (livery)
- **Liveries 0-7** (`livery-0` to `livery-7`): red, orange, yellow, green, cyan, blue, violet, pink. Assigned per agent as `agent.livery % 8`. Appear on the livery chip in a board row, blocker card, panel header and subagent list, and on the sprite in the office. Identical in light and dark. Never used on text, borders, or backgrounds.

### Neutral
- **Ground** (`n0`): page background. Light is cool paper-white; dark is near-black `#0f0f11`.
- **Surface** (`white` in light, `n1` in dark): cards, the table, the top bar, the panel, inputs, default buttons.
- **Surface raised** (`n1` light / `n2` dark): table header row, hover rows, stats block, kbd, machine icon tiles, token boxes.
- **Line** (`n2`) and **Line strong** (`n3`): dividers and card borders use line; button, input and segmented borders use line strong. Hover borders step up to `n4`.
- **Text secondary** (`n6`) and **Text tertiary** (`n5`): model column, notes and lead copy use secondary; labels, timestamps, placeholders and struck agents use tertiary.
- **Progress fill** (`n6` on `n2`): the elapsed and token bars are gray on gray; they are measurements, not status.

### Named Rules
**The One Ramp Rule.** Every gray in the chrome is one of `n0`-`n9`. Dark mode is the same ten slots remapped, never a second palette. If a gray is not on the ramp it is wrong.

**The Color Is Meaning Rule.** Saturated color appears only as a state (amber, green, blue, red) or a livery (chips and sprites). Nothing is colored to look nice; a colored element must answer "what does this color tell the operator?"

**The Amber Surface Rule.** Amber is the only state color that may tint a whole surface (`amber-bg` on blocker cards). Green, blue and red color words, dots and icons; they do not fill cards.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow, sans-serif), weights 600 and 700
**Body Font:** Archivo (with system-ui, sans-serif), weights 400, 500, 600
**Label/Mono Font:** ui-monospace, SF Mono, Menlo, Consolas for paths, commands and prompts

**Character:** A condensed racing grotesk in caps for anything that names or classifies, over a plain neutral grotesk with tabular numerals for anything you read or count. The pairing is the whole Designers Republic reference; the rest of the world is restraint.

### Hierarchy
- **Display** (700, 22px base, line-height 1, 0.02em, caps): section names and the wordmark. Scaled by context: 24px in the top-bar wordmark, 26px for the empty-state title, 28px on the login card, 34px for the Settings h1 (30px under 960px).
- **Title / status word** (700, 13px, line-height 1, 0.06em, caps): the agent status word with its 7px dot, and the bridge status in the top bar. Color is the state color.
- **Body** (400, 14px, 1.45): all prose, row titles (600), stat values (600, 14px), panel title (600, 17px, line-height 1.3, two-line clamp). Buttons use 500 at 13px; inputs 13.5px; secondary text and notes 12.5px; sublines and captions 12px.
- **Label** (600, 12px, line-height 1, 0.04em, caps, text tertiary): column headers, stat keys, section eyebrows on cards ("Account", "Machines and bridge tokens"), counts in the board head. The waiting band's "Question 2 of 4" / "Needs permission" label is the amber exception.
- **Mono** (400, 12.5px): cwd, file paths, tool prompts, install commands, blocker detail blocks.

### Named Rules
**The Caps Are Classification Rule.** Barlow Condensed caps mark names, columns, states and headings. Sentences, numbers and anything the operator reads for content stay in Archivo, never condensed, never uppercase.

**The Tabular Numerals Rule.** Every number sits in `font-variant-numeric: tabular-nums` (set on body). Durations, token counts and turn counts align column to column as they tick.

## Layout

The app is a flex column: a sticky 48px top bar (three-column grid `1fr auto 1fr`: wordmark and floor name left, bridge status centered, theme toggle, Settings and Sign out right), then a 16px-padded main grid. Desktop main is `minmax(0, 58fr) minmax(0, 42fr)` with a 16px column gap and areas `board office`: the board on the left, and the office column sticks at `top: 64px` on the right. The office box is a 320x200 internal canvas scaled to its column width with `image-rendering: pixelated`, inside an 8px-padded card with a 0-radius near-black box. Settings is a single 760px centered column; the login is a 380px card centered on the page.

Spacing rhythm is 2 / 4 / 8 / 12 / 16 / 24 / 48 with most interior gaps at 8 and 12 and all region separation at 16. Board rows are 48px minimum with 12px gap between a five-column grid `minmax(0,1fr) 96px 110px 110px 170px` (narrowing to `80 96 96 150` under 1100px); the header row is 32px. Subagents indent 18px per depth with a 12px tree bracket. Blocker cards stack at 10px. Panel sections are 12px / 16px padded. Stats are a four-column grid (two under 960px).

Breakpoints: 1100px tightens the roster columns; 960px stacks to a single column in the order office, board with 12px padding, hides the floor name, bridge text and the Settings word, repacks each row into a two-by-two grid (agent and status on the first line, elapsed and tokens with 56px bars and inline "elapsed" / "tokens" captions on the second), drops the model cell, and makes the dismiss button always visible. The agent panel is a fixed right drawer `min(460px, 100%)` below the top bar that scrolls as a whole; on narrow screens it covers the full width, and its waiting-band buttons grow to 36px and option rows to 48px.

**The Regions Breathe, Rows Don't Rule.** Rows are dense (48px, 12px gutters) and regions are separated by 16px of ground. Do not pad rows up to make them comfortable; do not shrink region gaps to fit more.

## Elevation & Depth

Flat by default, with tonal layering: ground `n0`, surfaces on `bg-2`, raised strips on `bg-3`, all separated by 1px `line` borders. Nothing in the main layout casts a shadow. Selected state is an inset 2px ink edge on the left of the row, and focus is a two-ring box-shadow (2px ground, 4px ink) in place of the outline. Depth is reserved for things that float above the page.

### Shadow Vocabulary
- **Card lift** (`--shadow`: `0 1px 2px rgba(18,19,22,0.06), 0 8px 24px -12px rgba(18,19,22,0.22)`; dark: `rgba(0,0,0,0.5)` / `0.8`): the login card only.
- **Floating layer** (`--shadow-lg`: `0 2px 4px rgba(18,19,22,0.08), 0 24px 48px -16px rgba(18,19,22,0.35)`; dark: `0.5` / `0.9`): the agent panel drawer and the idle sign-out warning.
- **Focus ring** (`--focus`: `0 0 0 2px var(--bg), 0 0 0 4px var(--fg)`): every focus-visible element.

### Named Rules
**The Only Floaters Cast Shadows Rule.** A shadow means "this is above the page": the panel, the idle warning, the login card. Cards, rows, buttons and the office box are flat with a 1px line.

## Shapes

Rectangles with small, consistent corners: 4px (`--radius`) on buttons, inputs, option tiles, kbd-like boxes, segmented controls and code blocks; 6px on cards, the table, the empty state, the idle warning. The office box is the only 0-radius container, because pixels have no corners. Bars are 3px tall with 2px ends. Status dots are 7px circles. Borders are always 1px (kbd adds a 2px bottom for a key feel). The signature form is the livery chip: a 14x10 plate skewed -14deg with a 1px radius (20x14 in the `lg` size used on the wordmark, login and panel header). The sprite shares the chip's color, not its shape.

**The One Skew Rule.** The chip is the only skewed element. No other container, button, label or divider is slanted or italic; the gesture earns its force by being alone.

## Components

### Buttons
Quiet, boxed, and one height. Character: "a labeled key".
- **Shape:** 4px radius, 30px tall, 1px `line-2` border, 13px / 500, 6px icon gap, 15px icons.
- **Default:** surface fill, ink text; hover raises to `bg-3` with an `n4` border; active nudges 1px down (80ms); disabled is 45% opacity.
- **Primary:** ink fill, ground text, ink border; hover `n7`. One per region: Allow in a blocker, Nudge in the panel, Sign in with GitHub, Add machine.
- **Quiet:** transparent, secondary text; hover `bg-3` and ink. Icon-only variant is a 30px square. Used for theme toggle, Settings, Close, Answer in Claude, Back, Cancel.
- **Danger:** default box with red text; hover `red-bg` fill and red border. Deny, Stop, Revoke.
- **Small:** 26px tall, 9px side padding, 12.5px.
- **Link:** underlined ink text with the underline in `n4`, 3px offset, darkening to ink on hover. For in-sentence navigation and parent/child agent references.

### Inputs / Fields
- **Style:** 1px `line-2` border, 4px radius, surface fill, 7px 10px padding, 13.5px text, tertiary placeholder. Textareas resize vertically from 72px.
- **Hover:** border to `n4`. **Focus:** the global two-ring focus shadow; no border color change.
- **Option tiles** (question answers): 4px, surface, left-aligned label (600) over description (12px secondary); selected tile has an ink border doubled with a 1px inset ring. Grid of `minmax(200px, 1fr)`.
- **Segmented control:** inline 4px box, 1px `line-2`, buttons `6px 14px` / 500 divided by 1px lines; the on segment is ink fill with ground text.

### Cards / Containers
- **Corner Style:** 6px.
- **Background:** surface (`bg-2`), 1px `line` border, no shadow.
- **Internal Padding:** settings cards `16px 18px 18px`; empty state `28px 24px`, max 70ch; login `28px 28px 22px`.
- **Waiting band:** anything an agent waits on (question, permission) lives at the top of its sheet, under the status line, as a full-width `amber-bg` band with amber-mixed top and bottom rules (no nested card); arrives once with a 260ms fade and 6px rise. Header line: amber label ("Question 2 of 4 · Header" or "Needs permission") and the time / time-left label pushed right. Questions go one at a time, reskinning Claude's own question form: a row of 26px tabs, one per question, showing its number (or a check once answered) and Claude's short header, the current tab inverted to ink; the 15.5px/600 question; numbered option rows (a 22px number plate that inverts when picked, or shows a check for multi-select, then the 600 label and 12.5px secondary description; number keys pick); a last numbered "Type something else…" row with an inline borderless field; and the action row (Back quiet, Answer in Claude quiet pushed right, Next / Skip / Send answers primary). A single choice advances on its own after 220ms. When no hook is waiting for the answer, the same form shows read-only (every option at full contrast, tabs and Back / Next still page through) above an "answer it in Claude" note. Permissions keep the tool in 600 with the prompt in mono secondary, a collapsible detail block, and Allow primary, Allow for session, Deny danger, Answer in Claude quiet.
- **Answer button (board row):** a 22px amber-tinted button replacing the status detail line when the agent waits on you; opens the sheet.

### Roster (table)
- A 6px card holding a grid of rows. Header row 32px on `bg-3` with label-caps column names; rows 48px minimum, 1px `line` top borders, pointer cursor.
- Row cells: livery chip + title (600, truncated) + cwd subline (12px tertiary); model (secondary); elapsed and tokens as a tabular figure over a 3px exact-length bar (`n6` fill, width animates 400ms); status word with dot and an optional 12px detail line.
- States: hover and cross-highlight from the office share `bg-3`; selected adds a 2px inset ink edge; departed rows go tertiary with a struck title and a 35% chip; the dismiss icon button appears on hover.

### Navigation (top bar)
- 48px sticky surface strip with a 1px bottom line. Left: the wordmark (ink `chip lg` + "N00B Inc" in display 24px) and a 1px-divided "Agent floor" label. Center: the bridge status in title caps with dot, followed by a 12.5px Archivo detail (machine, last seen). Right: quiet icon theme toggle, quiet Settings, default Sign out. Under 960px the floor name and bridge detail hide.

### Agent panel
- Fixed right drawer below the top bar, surface fill, 1px left line, `--shadow-lg`, slides in 12px over 180ms. Header: `chip lg`, 17px/600 editable title clamped to two lines, close button. Then status word, a `bg-3` stats grid (label keys over 600 values), mono where/files, link lists of parent and subagents with their chips, a nudge textarea with Nudge primary / Release / Stop danger, and the activity stream: 64px time column, 18px icon, body; event icons and bold names take the state color of their kind (blue prompt, amber blocker, ink command).

### Status word
- `title` caps with a 7px `currentColor` dot and 7px gap. `working` green, `thinking` blue, `blocked` and `holding` amber, `stopped` red, `idle` secondary, `done` tertiary. Color swaps once over 180ms.

### Livery chip (signature)
- A 14x10 plate, `skewX(-14deg)`, 1px radius, filled with `var(--l{n})`. It appears beside an agent's name everywhere the agent is named and is the same hex the office paints on that agent's sprite shirt. The wordmark's chip is the same plate in ink.

### Icons
- 16px, 1.5 stroke, round caps and joins, `currentColor`, drawn on a 16-unit grid (GitHub mark is filled). Rendered at 15px inside buttons and 18px columns in the stream. Icons never carry color of their own; they inherit the state of their line.

### Office canvas (signature)
- 320x200 internal pixel buffer in a worker, scaled with no smoothing, 0-radius near-black box inside an 8px card. Its own palette: the eight liveries on sprite shirts and the lobby poster, warm walls and floors in light, violet-gray in dark, state-colored desk lamps (amber blocked, mint working, periwinkle thinking). A 12px legend below in tertiary text. This is the only animated region and the only place saturated color may be ambient.

## Do's and Don'ts

### Do:
- **Do** take every gray from `n0`-`n9` and let dark mode come from the remapped ramp; never a hand-picked gray.
- **Do** reserve amber, green, blue and red for the state they name, and use `amber-bg` as the only colored surface.
- **Do** put the livery chip wherever an agent is named, filled from `var(--l0..7)` by `livery % 8`.
- **Do** set names, columns, headings and status words in Barlow Condensed caps (600 at 12px, 700 at 13px and above); keep sentences and figures in Archivo with tabular numerals.
- **Do** keep rows at 48px with 12px gutters and separate regions by 16px of ground.
- **Do** use the two-ring focus shadow and the 2px inset ink edge for selection; keep hover to a `bg-3` fill and an `n4` border.
- **Do** limit transitions to 120ms ease-out on color and background, 180ms for status swaps, 400ms for bar widths, and respect reduced motion.

### Don't:
- **Don't** add gradients, glass, blur or glow anywhere outside the office canvas.
- **Don't** skew, slant or italicize anything but the livery chip.
- **Don't** color text, borders or backgrounds with a livery; liveries are chips and sprites only.
- **Don't** cast shadows on cards, rows, buttons or the office; shadows belong to the panel, the idle warning and the login card.
- **Don't** animate the chrome for decoration; motion is a response to state (arrival, selection, status change, panel open).
- **Don't** use a radius other than 4px, 6px, or 0 on the office box; no pills except the 7px status dot.
- **Don't** introduce hero metric cards, chat transcripts, or a second typeface.
