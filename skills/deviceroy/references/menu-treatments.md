# Menu treatments

The treatment matrix itself lives in `rules.json` under `menuMatrix` so it is versioned with
the catalog. This file explains how `evaluate.py` fills each screen's table.

## Intent classification (deterministic)

| Intent | Detected from |
|---|---|
| Top-level destinations | a pinned bottom `nav`/`tablist` with ≥2 controls in the capture, or tab code (`tabs.native`, `tabs.js`, `tabs.custom`), or a drawer |
| Screen-level secondary actions | top-bar controls right of the leading quarter (capture), or a header declaring ≥4 actions |
| Overflow | horizontal/vertical ellipsis icons in code |
| Per-item actions | long-press / context-menu handlers |
| Choose one of N | segmented controls, wheel pickers, selects, or `radiogroup`/`tablist`/`listbox` roles |
| Create with variants | a FAB/split button, or a control labelled New/Add/Create/Compose or "+" |
| Destructive action | a control labelled Delete/Remove/Sign out/Log out/Cancel plan… |
| Many options or rich content | custom or system sheets, action sheets |
| Search | search inputs/bars in code or capture |
| Account / profile | a control labelled account/profile/avatar/sign in in the top bar or tab bar |

A row appears only when its intent is present on the screen. **Today** describes what exists;
**Status** is `diverges` when a rule linked to that intent fired on the screen, `needs
judgment` when one is pending review, else `aligned`. iOS / Android / RN-Expo columns are the
matrix row verbatim.

## Linked rules
Destinations: IOS-NAV-01/02/04, AND-NAV-01/02/03/05, X-PAR-01 · Secondary: IOS-BAR-01/02,
AND-BAR-01/02 · Overflow: IOS-BAR-03, AND-MNU-03 · Per-item: IOS-MNU-05 · Choose one:
IOS-MNU-04, AND-MNU-04, AND-CTL-01 · Create: AND-MNU-05, IOS-MNU-02 · Destructive: IOS-MNU-06,
X-PAR-05 · Rich: IOS-SHT-01, AND-SHT-01, AND-MNU-01 · Search: IOS-NAV-03, AND-SRC-01.
