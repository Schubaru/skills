# Component API Design

Read this before writing any component file. The inventory says *what* each component is; this file says how its props should feel. A good API is one a teammate can guess correctly without opening the file, and one that survives a redesign without breaking call sites.

## The shape of every component

```ts
export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;                 // required content first
  variant?: ButtonVariant;       // then appearance, always with a default
  size?: ButtonSize;
  leadingIcon?: React.ReactNode; // slots
  trailingIcon?: React.ReactNode;
  loading?: boolean;             // states
  fullWidth?: boolean;           // layout
}
export function Button({ variant = 'primary', size = 'md', ...props }: ButtonProps) { … }
```

Order the interface the same way in every file: content → appearance → slots → state → layout → escape hatches. Readers learn it once.

## Rules, and why

**Extend the native props, don't reinvent them.** `extends Omit<PressableProps, 'style' | 'children'>` (RN) or `extends React.ButtonHTMLAttributes<HTMLButtonElement>` (web) gives consumers every event and accessibility prop for free and keeps the design system from becoming a bottleneck. Omit only what the component owns (`style`, `children` when there's a `label`).

**Unions, not booleans, for anything with more than two values now or later.** `variant="secondary"` beats `secondary` + `tertiary` + `danger` booleans, which can all be true at once. Export every union so stories, manifests, and Figma variant properties can enumerate them.

**Booleans only for real on/off state:** `disabled`, `loading`, `selected`, `fullWidth`. Name them as adjectives, never `isX`/`hasX`, so they read like HTML attributes.

**Size changes everything together.** `size` moves height, padding, and font role in one local table (`const SIZE = {…} as const`). Never expose `height` or `fontSize` separately; that's how systems drift.

**Controlled and uncontrolled, the React way.** Inputs take `value` + `onChange` (web) / `onChangeText` (RN). Offer `defaultValue` for uncontrolled use. Never a `setValue` prop, never a mutable ref API for state the parent could own.

**Events are named by what happened, not how.** `onPress` on RN, `onClick` on web; `onChange(value)` passes the new value, not the raw event, when the component owns the parsing (Select, Switch, Checkbox). Pass the event when the consumer might need it (TextField).

**Slots are `ReactNode`, not config objects.** `leadingIcon={<Icon/>}` not `icon="search"` + `iconSize`. The system doesn't pick an icon library and shouldn't grow a config schema for one. Name slots by position (`leading`, `trailing`) when the content type is open, by role (`primaryAction`) when it's fixed.

**Composition over mega-props.** When a component needs more than ~10 props, or props start conditioning on each other, split it: `Card` + `Card.Header` + `Card.Body`, or `RadioGroup` owning value and `Radio` owning label. A prop that only makes sense when another is set is a discriminated union waiting to happen:

```ts
type LinkProps = { variant: 'inline' } | { variant: 'standalone'; chevron?: boolean };
```

**Required props are the ones without a sane default.** `label` on Button, `accessibilityLabel` on IconButton, `options` on Select. Everything else defaults. If you find yourself defaulting a `label` to `''`, it should be required.

**Accessibility is part of the API, not a decoration.** If a component can't be accessible without a prop, the prop is required (IconButton's `accessibilityLabel`). Set roles and states inside the component so consumers can't forget them.

**Escape hatches go last and are narrow.** Accept `style` (RN) / `className` (web) only for layout concerns (margin, alignment) and say so in the doc block. Never accept `color`, `bg`, or `textStyle`: those bypass tokens, and a bypass is a future inconsistency. A one-off need is a new variant or a new semantic token, decided in the spec.

**Refs.** On React 19 `ref` is a normal prop; on 18 use `forwardRef`. Either way, forward to the root native element so focus management and measurement work.

**Type it honestly.** `satisfies`/`as const` for tables, no `any`, no `Record<string, unknown>` bags. Export `XProps`, `XVariant`, `XSize`. Use generics only where the value type genuinely flows through (Select's option value); otherwise they add ceremony without safety.

## Cross-platform parity

When the same component exists on RN and web, the props are identical except the platform event name (`onPress`/`onClick`) and the native-props base. Same union values, same slot names, same defaults. That's what lets one Storybook story file, one manifest entry, and one Figma component set describe both.

## Changing an API later

- Add a variant or optional prop: minor version, no migration.
- Rename or remove a prop: keep the old one for one release, mark `@deprecated` in the JSDoc with the replacement, log it in the doc's Deprecations table, remove next major.
- Never change a default silently; a changed default is a visual change on every call site.

## Review checklist (run it on every component before moving to the next)

- Can you guess every prop from the name alone?
- Are all appearance choices unions with defaults, and are the unions exported?
- Does `size` move height + padding + type together, from one table?
- Zero literals: every color, size, space, radius comes from `useTheme()` / CSS variables.
- Native props extended; `style`/`className` limited to layout.
- Required props are exactly the ones with no sane default.
- Accessibility role, label, and state set inside the component.
- Props identical to the sibling platform's version, except the event name.
