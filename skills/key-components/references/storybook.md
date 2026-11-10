# Storybook

Storybook is the component workbench for every platform this skill targets that runs React. The HTML playground still gets built (it's dependency-free and renders tokens), but Storybook is where components are developed, reviewed, and tested against the real code. One story file per component, generated from the manifest, then hand-extended.

## Versions and packages (checked Sept 2026)

- **Web:** Storybook 10.x. Install with `npm create storybook@latest`; it picks the framework package (`@storybook/react-vite`, or `@storybook/nextjs-vite` for Next). Test utilities import from `storybook/test` (no `@` prefix since v9).
- **React Native:** `@storybook/react-native` (on-device). The same `npm create storybook@latest` detects RN/Expo and writes `.rnstorybook/`.
- **Addons:** web `@storybook/addon-a11y`, `@storybook/addon-vitest`; RN `@storybook/addon-ondevice-controls`, `@storybook/addon-ondevice-actions`.
- Don't pin versions from memory. Let the init command choose and match what it installed. If the project already has Storybook, match *its* major version and don't upgrade it as a side effect.

## Detect before installing

Look for `.storybook/`, `.rnstorybook/`, and a `storybook` script in `package.json`. If present, add stories to the existing setup, match its story glob and its story style, and never install a second Storybook. If absent, install per platform below. If the user says no Storybook, skip this file entirely; playground and Gallery still get built.

## Setup per platform

### React Native (the default)

```bash
npm create storybook@latest      # choose "React Native (on-device)"
```

That writes `.rnstorybook/{main.ts, preview.tsx, index.tsx}`. Then:

- `main.ts` stories glob: `['../design-system/components/**/*.stories.?(ts|tsx)']`.
- `metro.config.js`: wrap the config with `withStorybook` from `@storybook/react-native/withStorybook` (it handles entry-point swapping and generates `storybook.requires`).
- Run: `STORYBOOK_ENABLED=true npx expo start` (or the project's start script).
- `preview.tsx` wraps every story in the design system's `ThemeProvider`, reading the mode from story parameters so light and dark are one parameter away:

```tsx
import React from 'react';
import type { Preview } from '@storybook/react-native';
import { ThemeProvider } from '../design-system/theme';

const preview: Preview = {
  decorators: [
    (Story, { parameters }) => (
      <ThemeProvider mode={parameters.mode}>
        <Story />
      </ThemeProvider>
    ),
  ],
};
export default preview;
```

**Web view of RN components (opt in):** when the user wants a browser-viewable Storybook (sharing, Chromatic, a11y addon, play functions), also add a web Storybook with `@storybook/addon-react-native-web` so the same story files render through react-native-web. Same glob, same stories, no duplication. Recommend it when the project already uses `react-native-web`; don't add react-native-web just for this.

### Web (React + TypeScript)

```bash
npm create storybook@latest      # React + Vite
```

- `.storybook/main.ts` stories glob points at `design-system/components/**/*.stories.tsx`; addons `@storybook/addon-a11y`, `@storybook/addon-vitest`.
- `.storybook/preview.ts` imports `../design-system/tokens/tokens.css` and a decorator sets `document.documentElement.dataset.theme = parameters.mode ?? 'light'`.

### SwiftUI

No Storybook. `previews/Gallery.swift` with `#Preview` blocks is the equivalent. Say so in the doc; don't fake a web Storybook for Swift.

## Story file conventions (CSF3 everywhere)

Use CSF3 (`export default meta`, named story objects) on every platform. It's the one format that web Storybook 10 and RN Storybook read unchanged; CSF Factories (`preview.meta`) are web-only and still marked experimental. One format means a story file written for on-device RN also works through react-native-web without edits.

- File: `components/Button.stories.tsx`, beside the component.
- `title`: `<Category>/<Name>` from the manifest (`Actions/Button`, `Inputs/TextField`) so the sidebar mirrors the inventory order and categories.
- `meta`: `component`, `title`, `tags: ['autodocs']`, `args` = the manifest's `args` (the minimum props for a sensible render), `argTypes` only where controls need help: variant and size as `select` with the union values; `ReactNode` slots hidden with `control: false`.
- Stories in this fixed order, so every file reads the same:
  1. `Default` (manifest args)
  2. One per variant, PascalCase (`Primary`, `Secondary`, `Danger`)
  3. `Sizes`: every size in one row
  4. `States`: every prop-driven state in one row (disabled, loading, selected, error…). Pressed/hover/focus are not props; cover them with a play function on web or leave them to the on-device controls.
  5. `DarkMode`: Default with `parameters: { mode: 'dark' }`
  6. Component-specific stories after these (`WithLeadingIcon`, `LongLabel`, `Indeterminate`).
- Stories contain no design decisions. No literal colors, no inline style overrides to "make it look right". If a story needs a value, the component needs a token or a prop.

## Generate, then extend

```bash
python3 <skill>/scripts/build_stories.py design-system/components/manifest.json design-system/components/ --platform rn
```

Emits the five standard stories per manifest entry. It never overwrites an existing `.stories.tsx` (delete the file to regenerate; `--force` overwrites all). The generator only knows what the manifest knows, so after it runs:

1. Typecheck (`npx tsc --noEmit`). Fix any `args` that don't match the props you actually wrote, then copy the fix back into the manifest's `args` so the next regeneration matches.
2. Open each file once and add the component-specific stories and, where there's interaction logic, a play function.

## Play functions (web or react-native-web)

```tsx
import { expect, fn } from 'storybook/test';

export const Presses: Story = {
  args: { label: 'Save', onPress: fn() },
  play: async ({ canvas, userEvent, args }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
    await expect(args.onPress).toHaveBeenCalledOnce();
  },
};
```

On-device RN has no DOM, so play functions only run through the web addon. Write them for anything with state logic (Checkbox, Switch, Chip filter, Select, Dialog actions); skip them for static components.

## Verify (feeds the main checklist)

- One `.stories.tsx` per manifest entry; each `title` is `<Category>/<Name>`.
- `npx storybook build` succeeds (web), or the RN bundle compiles with `STORYBOOK_ENABLED=true`.
- With the a11y addon: zero violations on every `Default` story.
- Grep the stories for hex literals: expect zero.
