---
name: ui-surgeon
description: >-
  Use when a front-end cosmetic change (UI tweak, style fix, layout adjustment) needs
  to be handed off for review. Produces a short, structured UI Change Checklist that
  names the project or screen, lists the specific changes made, calls out anything a
  reviewer should know, and ends with a clear next step. Not for planning or
  implementing the UI change itself — only for documenting one that's already done.
user-invocable: true
argument-hint: "[project/screen] [what changed]"
---
# Description
This skill helps produce a UI Change Checklist for the person requesting a front-end cosmetic change and anyone reviewing the work. It keeps the checklist focused on what changed in the UI, names the project or screen so the change is easy to track, calls out anything important for review, and ends with a clear next step.

# Package map
This package follows the B43™ Skill Builder package format. B43™ is a trademark of its owner; this skill is not affiliated with or endorsed by B43.

The `output_templates/` folder contains the single checklist template, `output_templates/ui_change_checklist.md`, which is used when the user needs a short structured checklist for cosmetic UI changes.

The `scoring_rubrics/` folder contains one rubric per template. For this skill, `scoring_rubrics/ui_change_checklist.json` scores the checklist before it is returned so the output stays focused, specific, reviewable, and easy to follow.

The `knowledge_files/` folder contains stable reference material that supports the checklist output and rubric. `knowledge_files/ui_change_checklist_examples.md` provides canonical checklist examples, `knowledge_files/ui_terminology_guide.md` keeps project/screen/UI wording consistent, and `knowledge_files/ui_surgical_edit_principles.md` reinforces narrow, polished, review-friendly edits.

The `code_scripts/` folder is empty for this skill. No repeatable scripts are needed for this skill.

# Runtime inputs
- `{{project_name}}` — the project or screen name the checklist should identify.
- `{{change_scope}}` — the short scope line that explains the UI area being edited.
- `{{change_1}}` — the first specific front-end change item to list in the checklist.
- `{{change_2}}` — the second specific front-end change item to list in the checklist.
- `{{change_3}}` — the third specific front-end change item to list in the checklist.
- `{{notes}}` — important context, constraints, or caveats a reviewer should know.
- `{{follow_up}}` — the next review step or verification action.

# Process
1. Pick `output_templates/ui_change_checklist.md` because the user needs a short structured checklist for front-end cosmetic changes.
2. Identify the runtime inputs from the user’s request and map them to `{{project_name}}`, `{{change_scope}}`, `{{change_1}}`, `{{change_2}}`, `{{change_3}}`, `{{notes}}`, and `{{follow_up}}` in the template.
3. Consult the stable reference files when wording needs help: `knowledge_files/ui_change_checklist_examples.md` for canonical checklist shape, `knowledge_files/ui_terminology_guide.md` for project/screen/component wording, and `knowledge_files/ui_surgical_edit_principles.md` for keeping the edits narrow and review-friendly.
4. No `code_scripts/` step is needed because the skill has no repeatable scripted transformation.
5. Fill `output_templates/ui_change_checklist.md` with concrete values that stay centered on UI changes, track the right project or screen, and surface review context clearly.
6. Self-check the draft against `scoring_rubrics/ui_change_checklist.json`, especially `focus_on_ui_work`, `clear_project_or_screen`, `specific_change_items`, `review_context_and_caveats`, and `clear_follow_up_step`.
7. Return the final UI Change Checklist only after it reads like a concise front-end change log and matches the rubric.

# Output checks
Before returning `output_templates/ui_change_checklist.md`, confirm:
- Focus on UI work: the checklist stays tightly scoped to front-end cosmetic changes — see `scoring_rubrics/ui_change_checklist.json`.
- Clear project or screen reference: the project or screen is named clearly enough to track the change — see `scoring_rubrics/ui_change_checklist.json`.
- Specific change items: each checklist item says exactly what was changed — see `scoring_rubrics/ui_change_checklist.json`.
- Review context and caveats: the notes call out any important context the reviewer needs — see `scoring_rubrics/ui_change_checklist.json`.
- Clear follow-up step: the checklist ends with an obvious next review action — see `scoring_rubrics/ui_change_checklist.json`.
