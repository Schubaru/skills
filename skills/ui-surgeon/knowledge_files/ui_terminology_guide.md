# UI Terminology Guide

Use consistent, plain-language terms when describing front-end changes. Prefer words that help a reviewer quickly understand what was changed.

## Preferred terms

- **Project**: the broader work area or product the change belongs to
- **Screen**: the page, view, or route being updated
- **Scope**: the narrow area of UI being edited
- **Changes made**: the specific front-end updates completed
- **Notes**: important context, constraints, or caveats for review
- **Follow-up**: the next review step or verification action

## UI element naming

Use the most direct name for the component or surface a reviewer will recognize.

- **Header** for the top section of a page
- **Card** for grouped content blocks
- **Button** for clickable actions
- **Form field** for inputs, text areas, selects, and similar controls
- **Modal** for dialog overlays
- **Empty state** for the no-content presentation
- **Sidebar** for side navigation or supporting panels
- **Tab** for switching between views

## Writing style for checklist items

- Use plain verbs: tightened, aligned, increased, reduced, updated, removed
- Be concrete about the UI surface: header, card spacing, button style, modal padding
- Avoid implementation jargon unless the reviewer would expect it
- Keep each item reviewable at a glance

## Example phrasing

- Tightened the header spacing
- Aligned the card content with the page grid
- Updated the primary button styling
- Increased the gap between form fields
- Cleaned up the empty state layout
