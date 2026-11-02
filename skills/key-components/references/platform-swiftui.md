# Platform: SwiftUI

Use when the spec says `swiftui`. Target iOS 16+ unless the project's deployment target says otherwise.

## Files produced

```
DesignSystem/                      # Swift folder (mirrors design-system/ but Xcode-friendly casing)
├── Tokens/Tokens.swift            # generated: enum <Prefix>Tokens + Color(hex:) + Theme struct
├── Theme/ThemeEnvironment.swift   # EnvironmentKey, .theme modifier, resolves light/dark
├── Components/Button.swift …      # inventory order
├── Components/Manifest.json
└── Previews/Gallery.swift         # #Preview blocks per component + a full Gallery view
```

Keep `design-system/style-spec.json` and `DESIGN_SYSTEM.md` at the repo root as usual; only the Swift sources move into a target-friendly folder. Record the path in the doc.

## Theme access

```swift
struct ThemeKey: EnvironmentKey { static let defaultValue: Theme = .light }
extension EnvironmentValues { var theme: Theme { get { self[ThemeKey.self] } set { self[ThemeKey.self] = newValue } } }

struct ThemeResolver<Content: View>: View {
  @Environment(\.colorScheme) private var scheme
  let content: Content
  var body: some View { content.environment(\.theme, scheme == .dark ? .dark : .light) }
}
extension View { func dsTheme() -> some View { ThemeResolver(content: self) } }
```

The generated `Tokens.swift` exposes the semantic layer as dictionaries (`t.colors.text["default"]`, `t.font["label.md"]`). Write `Theme/Theme+Accessors.swift` once per project with typed accessors over them (`t.text.default`, `t.bg.accent.default`, `t.font.label.md`, `t.space[4]`, `t.radius.md`, `t.elevation[1]`) so components read cleanly and a typo is a compile error, not a runtime crash. The template below assumes those accessors exist.

## Component template

```swift
/// Button · actions
/// Purpose: Primary way to trigger an action.
/// Use for: submitting, confirming, starting a flow. Don't use for: navigation (Link), toggling (Chip/Switch).
/// Anatomy: container · label · leadingIcon? · trailingIcon? · loading
import SwiftUI

public struct DSButton: View {
  public enum Variant { case primary, secondary, tertiary, danger }
  public enum Size { case sm, md, lg }

  let label: String; var variant: Variant = .primary; var size: Size = .md
  var leadingIcon: Image? = nil; var trailingIcon: Image? = nil
  var loading = false; var fullWidth = false; var isDisabled = false
  let action: () -> Void

  @Environment(\.theme) private var t

  private var height: CGFloat { switch size { case .sm: 32; case .md: 44; case .lg: 52 } }
  private var px: CGFloat { switch size { case .sm: t.space[3]; case .md: t.space[4]; case .lg: t.space[5] } }
  private var font: Font { switch size { case .sm: t.font.label.sm; case .md: t.font.label.md; case .lg: t.font.label.lg } }

  public var body: some View {
    Button(action: action) {
      HStack(spacing: t.space[2]) {
        if loading { ProgressView().tint(fg) } else { leadingIcon; Text(label).font(font); trailingIcon }
      }
      .frame(maxWidth: fullWidth ? .infinity : nil).frame(height: height).padding(.horizontal, px)
      .foregroundStyle(fg)
    }
    .buttonStyle(DSPressStyle(bg: bg, bgPressed: bgPressed, border: border, radius: t.radius.md, borderWidth: t.border.width.regular))
    .disabled(isDisabled || loading).opacity(isDisabled ? t.opacity.disabled : 1)
    .accessibilityLabel(label).accessibilityAddTraits(.isButton)
  }
  private var fg: Color { switch variant { case .primary: t.text.onAccent; case .secondary: t.text.default; case .tertiary: t.text.accent; case .danger: t.text.inverse } }
  private var bg: Color { switch variant { case .primary: t.bg.accent.default; case .secondary: t.surface.default; case .tertiary: .clear; case .danger: t.bg.danger.strong } }
  private var bgPressed: Color { switch variant { case .primary: t.bg.accent.pressed; case .secondary: t.bg.muted; case .tertiary: t.bg.accent.subtle; case .danger: t.bg.danger.pressed } }
  private var border: Color { variant == .secondary ? t.border.strong : .clear }
}

struct DSPressStyle: ButtonStyle {
  let bg: Color, bgPressed: Color, border: Color, radius: CGFloat, borderWidth: CGFloat
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(RoundedRectangle(cornerRadius: radius, style: .continuous).fill(configuration.isPressed ? bgPressed : bg))
      .overlay(RoundedRectangle(cornerRadius: radius, style: .continuous).stroke(border, lineWidth: borderWidth))
  }
}
```

Conventions:

- Prefix component types with `DS` to avoid clashing with SwiftUI's `Button`, `Toggle`, `Slider`, etc.
- `RoundedRectangle(style: .continuous)` everywhere; it's the iOS-native corner curve.
- Hairline is `1 / UIScreen.main.scale`; the token script emits `border.width.hairline` accordingly.
- Custom fonts: `Font.custom(name, size:)` with `.weight()` only if the font is variable; static-weight fonts need per-weight names (spec `type.staticWeights`). The generated `Tokens.swift` handles both.
- Minimum tap target 44×44 via `.frame(minWidth: 44, minHeight: 44)` on small controls or `.contentShape`.
- Prefer native controls where the system provides the right behavior (Toggle for Switch, Picker for Select, `.sheet` for Sheet, `.alert`/`.confirmationDialog` for Dialog) and *style* them with tokens rather than rebuilding them; rebuilding fights iOS accessibility.

## Previews

Every component file ends with `#Preview("Button · light") { … }` and `#Preview("Button · dark") { … .preferredColorScheme(.dark) }` rendering all variants × sizes × states. `Previews/Gallery.swift` composes them in inventory order in a `ScrollView` and is the native equivalent of the HTML playground.
