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
- SwiftUI has no file router, so map each route to the files that draw it in `screenSources`
  (read them off `navigationDestination` / the root view switch; add a shared header file, such as a
  custom top bar, to every screen that uses it). `chrome` is only the app shell (the `App` file, a
  real `TabView`).
- Code alone can't see a hand-built tab bar or sheet in SwiftUI (they are plain stacks and drag
  gestures), so those checks show as "Not checked" without a simulator capture. A `TabView` styled
  `.page` is a pager, not a tab bar, and is not counted as one.
