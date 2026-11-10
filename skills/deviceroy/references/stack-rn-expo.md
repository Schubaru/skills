# Stack: React Native / Expo (primary)

## Detection
`package.json` depends on `expo` or `react-native`. Screens come from the Expo Router `app/`
(or `src/app/`) tree: groups `(x)` are stripped, `index` maps to its parent, `_layout` files are
chrome for their subtree, and a layout rendering `Tabs`/`NativeTabs` marks its children as tabs.
Options declared in a layout for a named child (`<Stack.Screen name="settings" …>`) are
attributed to that child only.

## Implementation map (verify before recommending; `verify_api.py` does)
| Need | iOS | Android |
|---|---|---|
| System tab bar | `NativeTabs` from `expo-router/unstable-native-tabs` (beta, SDK 55+), `Icon sf=` | same, `Icon md=` (Material Symbols), M3 colors |
| SwiftUI / Compose views | `@expo/ui/swift-ui` (stable SDK 56): `Host`, `ContextMenu`, `Picker`, `glassEffect` | `@expo/ui/jetpack-compose` (stable SDK 56): `DropdownMenu`, `NavigationBar`, `FloatingActionButton`, `useMaterialColors` |
| Glass | `expo-glass-effect` (`GlassView`, `GlassContainer`) | n/a |
| Context menus / previews | Expo Router `Link.Menu`, `Link.Preview` | Compose `DropdownMenu` |
| Sheets | Stack `presentation: 'formSheet'`, `sheetAllowedDetents`, `sheetGrabberVisible` | same (react-native-screens) or Compose `ModalBottomSheet` |
| Alerts | `Alert.alert` | `Alert.alert` |
| Search | `Stack.SearchBar` / `headerSearchBarOptions` | same |

Universal `@expo/ui` components render SwiftUI on iOS and Compose on Android from one import;
prefer them for settings, forms, pickers, and sheets. NativeTabs is still marked beta and its
API shifted across SDK 55 betas: never assume a prop exists without the check.

## Captures
Web preview of an Expo app renders with `Platform.OS === 'web'`: it shows none of the native
chrome. Use it for layout and content only (W). Native captures need a dev build and a deep-link
scheme (`native.ios.scheme`, `native.android.scheme`).
