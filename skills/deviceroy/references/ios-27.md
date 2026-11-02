# iOS 27 baseline (Liquid Glass)

Verified 2026-09-29. Target: latest only. iOS 26 introduced Liquid Glass; iOS 27 refines it.

## Layers
- Controls and navigation float on a Liquid Glass layer above content. Glass belongs to the
  control/navigation layer, never the content layer (cards, list rows). → IOS-GLS-02
- One glass layer per stack: no glass on glass. Group controls with `GlassEffectContainer`. → IOS-GLS-01
- iOS 27 adds a user-controlled glass intensity slider (clear → fully tinted). Text on glass
  must stay legible at both ends and with Reduce Transparency and Increase Contrast. Needs
  device renders at both extremes. → IOS-GLS-03

## Tab bar
- Floats above content; can minimize on scroll and re-expand on reverse scroll. A bottom
  accessory view can sit above it. → IOS-NAV-01
- Up to 5 tabs. Search is visually separated (search tab role). iOS 27's **prominent tab role**
  puts one special destination (e.g. cart) on the bottom trailing edge. Tabs are destinations,
  never actions. → IOS-NAV-02, IOS-NAV-03
- No hamburger or drawer as primary navigation on iPhone. → IOS-NAV-04

## Toolbars
- Items sit on glass and are auto-grouped; the system back button is its own group.
  `ToolbarSpacer` controls grouping. A custom back button loses edge-swipe back and the
  long-press history menu. → IOS-NAV-05
- iOS 27 APIs: `visibilityPriority` (which items overflow first), `ToolbarOverflowMenu`
  (items that always live in overflow), `topBarPinnedTrailing` (pin one critical action such as
  Share). Keep ≤3 visible trailing actions. → IOS-BAR-02
- Reserve the ellipsis for overflow. → IOS-BAR-03
- Let content scroll under a transparent bar; the system adds the scroll edge effect. An opaque
  custom header background blocks it. → IOS-BAR-01
- Beta churn: `toolbarMinimizeBehavior` was reportedly removed or renamed in a later WWDC26
  seed. Always verify symbols against the installed SDK (`verify_api.py`).

## Sheets
- Partial-height sheets are inset with a glass background by default; toolbar items can be the
  source of a zoom transition into a sheet. Use system sheets with detents. → IOS-SHT-01

## Menus (HIG)
- **Pull-down button**: commands related to the button's purpose; ≥3 items (1-2 → plain
  buttons); never hide a view's primary actions in one. → IOS-MNU-01, IOS-MNU-02
- **Pop-up button**: mutually exclusive choice; shows the current selection. → IOS-MNU-04
- **Context menu**: long-press, secondary actions for the item under the finger; never the only
  path to a command. → IOS-MNU-05
- Destructive items use the destructive role; confirm with a dialog anchored to the source. → IOS-MNU-06
- Custom JS dropdowns lose glass, morph, haptics and VoiceOver behavior. → IOS-MNU-03

## Layout, type, targets, icons
- Controls stay inside the safe area (status bar / Dynamic Island ≈ top 59pt on Pro models,
  home indicator ≈ bottom 34pt). → IOS-LAY-01
- Text follows Dynamic Type; never disable font scaling. → IOS-TYP-01
- Hit targets ≥ 44×44pt. → IOS-TGT-01
- SF Symbols in system chrome. → IOS-ICN-01

## Sources
- WWDC25 "Build a SwiftUI app with the new design": https://developer.apple.com/videos/play/wwdc2025/323/
- WWDC26 SwiftUI guide: https://developer.apple.com/wwdc26/guides/swiftui/
- WWDC26 "What's new in SwiftUI": https://developer.apple.com/videos/play/wwdc2026/269/
- HIG Menus: https://developer.apple.com/design/human-interface-guidelines/menus
- HIG Pull-down buttons: https://developer.apple.com/design/human-interface-guidelines/pull-down-buttons
- Liquid Glass changes in iOS 27 (Cult of Mac): https://www.cultofmac.com/news/liquid-glass-changes-ios-27-macos-27
