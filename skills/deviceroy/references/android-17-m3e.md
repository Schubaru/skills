# Android 17 + Material 3 Expressive baseline

Verified 2026-09-29. Android 16 QPR1 introduced M3 Expressive on Pixel; Android 17 (API 37)
carries it to all OEMs.

## Navigation
- The original tall navigation bar is deprecated. Use the shorter **flexible navigation bar**
  (64dp) with a pill active indicator, 3-5 destinations; horizontal items in medium windows.
  → AND-NAV-01, AND-NAV-02
- **Navigation rail** at medium+ widths (600dp+). M3E drops the drawer as primary phone nav.
  → AND-NAV-03, AND-NAV-05
- **Android 17** removes the opt-out for orientation and resizability restrictions on large
  screens (smallest width ≥ 600dp): layouts must adapt. → AND-NAV-03
- **Predictive back** is on by default for apps targeting API 36; `onBackPressed` is no longer
  called. Custom back chevrons, "Back" text buttons, and JS back interception break it. → AND-NAV-04

## App bars and search
- ≤3 top app bar action icons plus a vertical overflow (more_vert). → AND-BAR-01, AND-MNU-03
- iOS text-button patterns (Edit / Done / Cancel) in the top bar read as foreign; use icon
  buttons (close, check) or a FAB. → AND-BAR-02
- **Search app bar**: thick pill field, hamburger/avatar moved outside the pill (Gmail, Keep,
  Drive, Meet). → AND-SRC-01

## Expressive components
- New: button groups, FAB menu (2-6 items), loading indicator, split button, floating toolbar.
  Updated: buttons, FAB, extended FAB, icon buttons, progress, nav bar, nav rail, app bars,
  menus, sliders, toolbars. → AND-MNU-05
- **Vertical menus**: rounded corners, standard and vibrant color styles, more selection
  states, grouped sections (gap or divider), submenu motion. Baseline menus lack the new
  shapes, color and motion. Compose Material3 ships toggleable and selectable menu items, menu
  groups, menu popup, and submenu positioning. → AND-MNU-02, AND-MNU-04
- iOS-style action sheets (stacked options + Cancel row) → M3 menu or modal bottom sheet. → AND-MNU-01
- Modal bottom sheets carry a drag handle. → AND-SHT-01
- Material controls: M3 switch, segmented buttons, date/time dialogs instead of wheels. → AND-CTL-01

## System
- **Edge-to-edge is mandatory** for apps targeting API 36; the opt-out is disabled on Android
  16+ devices. Handle insets. → AND-EDG-01
- Dynamic color (Material You) and Material Symbols are system defaults. Brand color in chrome
  is a valid choice, so AND-DYN-01 is a P3 warning only. → AND-DYN-01, AND-ICN-01
- Touch targets ≥ 48×48dp. → AND-TGT-01

## Sources
- Material 3 menus specs: https://m3.material.io/components/menus/specs
- Compose Material3 releases: https://developer.android.com/jetpack/androidx/releases/compose-material3
- Android 16 behavior changes: https://developer.android.com/about/versions/16/behavior-changes-16
- Android 17 resizability and orientation: https://developer.android.com/blog/posts/prepare-your-app-for-the-resizability-and-orientation-changes-in-android-17
- M3E navigation (9to5Google): https://9to5google.com/2025/05/14/material-3-expressive-navigation/
- M3E menus (9to5Google): https://9to5google.com/2025/11/22/material-3-expressive-menus/
