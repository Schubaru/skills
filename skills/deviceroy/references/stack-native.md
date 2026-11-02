# Stack: native Swift / SwiftUI (secondary)

## Detection
A `*.xcodeproj` or `Package.swift`. If there is no `android/` target, report iOS findings only
and say "No Android target detected"; Android and cross-platform rules are still listed in the
appendix as not applicable to the run.

## Implementation notes
- Use SwiftUI APIs directly (see `ios-27.md`): `TabView` + `Tab` (search and prominent roles),
  `.toolbar` with `ToolbarSpacer`, `ToolbarOverflowMenu`, `.visibilityPriority`,
  `topBarPinnedTrailing`, `.glassEffect`, `GlassEffectContainer`, `.presentationDetents`,
  `Menu`, `Picker(.menu)`, `.contextMenu`, `.confirmationDialog`, `Button(role: .destructive)`.
- `verify_api.py` greps the installed SwiftUI `.swiftinterface` from the active Xcode SDK.
  WWDC26 toolbar APIs moved between seeds (`toolbarMinimizeBehavior`): if the symbol is not in
  the SDK, the finding says "requires Xcode/SDK upgrade".
- Screens: list them in `scope.routes` (deep-link paths) for simulator capture.
