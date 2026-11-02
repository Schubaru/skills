# Stack: Flutter (secondary)

## Detection
`pubspec.yaml` present. Versions come from `pubspec.lock` (`cupertino_ui`, `material_ui`).
There is no route inventory from code: list screens in `scope.routes` or a canvas manifest,
and map sources with `chrome` if needed.

## Implementation notes
- Since Flutter 3.47 (Aug 2026) Cupertino and Material widgets ship as packages
  (`cupertino_ui`, `material_ui`), decoupled from the SDK.
- **Liquid Glass is not first-party.** Say "third-party package or platform view required"
  instead of naming a widget that doesn't exist.
- **M3 Expressive coverage is incomplete first-party.** Community packages exist; flag the gap
  rather than inventing APIs.
- Useful first-party pieces: `NavigationBar`, `NavigationRail`, `MenuAnchor`,
  `showModalBottomSheet(showDragHandle: true)`, `Switch.adaptive`, `AlertDialog.adaptive`,
  `CupertinoTabScaffold`, `CupertinoContextMenu`.
- `verify_api.py` confirms a package is in `pubspec.lock`; it cannot see individual widgets.
