# UX/UI Principles for Surgical Interface Edits

These principles help keep front-end edits focused, minimal, and easy to review. Use them when the task is to polish an interface rather than redesign it.

## Core principles

1. **Stay scoped to the visible change**
   - Touch only the part of the interface that needs improvement.
   - Avoid broad layout or behavior changes unless they are explicitly requested.

2. **Preserve the existing structure when possible**
   - Keep the current information hierarchy intact.
   - Make the smallest change that solves the issue cleanly.

3. **Improve clarity before adding complexity**
   - Reduce visual noise, spacing issues, and weak alignment first.
   - Prefer simpler, more readable patterns over decorative additions.

4. **Make review easy**
   - Call out what changed, where it changed, and any caveats a reviewer should know.
   - If the change could affect behavior, mention that explicitly.

5. **Keep edits consistent with the surrounding UI**
   - Match the established component language, spacing rhythm, and tone.
   - Do not introduce terminology or patterns that feel out of place.

## Good surgical edits

- Tightening spacing between existing elements
- Clarifying labels or hierarchy without changing meaning
- Aligning controls for cleaner scanning
- Updating visual treatment to match nearby UI
- Reducing clutter in a modal, card, or form section

## Common failure modes

- Rewriting the whole screen when only one area needed help
- Adding unrelated implementation detail to the checklist
- Using vague wording that hides what actually changed
- Omitting review context that would help someone approve the work
