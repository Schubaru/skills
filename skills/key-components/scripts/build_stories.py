#!/usr/bin/env python3
"""Generate CSF3 Storybook stories from components/manifest.json.

Usage: build_stories.py <manifest.json> <components-dir> [--platform rn|web] [--force]

One <Name>.stories.tsx per manifest entry with the fixed story order:
Default, one per variant, Sizes, States, DarkMode. Existing files are left
alone unless --force. Manifest fields used: name, category, variants, sizes,
states, args (optional, default {}), variantProps (optional, default ["variant"]).
"""
import argparse, json, os, re, sys

# Prop-driven states the generator knows how to express. Anything else
# (pressed, hover, focus, open, status...) is listed in a comment for hand-work.
STATE_ARGS = {
    "disabled": {"disabled": True},
    "loading": {"loading": True},
    "selected": {"selected": True},
    "checked": {"checked": True},
    "indeterminate": {"indeterminate": True},
    "error": {"errorText": "Something went wrong"},
    "readOnly": {"readOnly": True},
    "on": {"value": True},
    "off": {"value": False},
    "overflow": {"count": 120},
}

def pascal(s):
    return "".join(p[:1].upper() + p[1:] for p in re.split(r"[-_\s]+", s) if p)

def ts(v):
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, str): return json.dumps(v)
    if isinstance(v, list): return "[" + ", ".join(ts(x) for x in v) + "]"
    if isinstance(v, dict): return "{ " + ", ".join(f"{k}: {ts(x)}" for k, x in v.items()) + " }"
    return "undefined"

def variant_args(entry, value):
    props = entry.get("variantProps", ["variant"])
    parts = value.split("-") if len(props) > 1 else [value]
    return dict(zip(props, parts))

def render(entry, platform):
    name, cat = entry["name"], entry["category"]
    variants = [v for v in entry.get("variants", []) if v != "default"]
    sizes = entry.get("sizes", [])
    states = entry.get("states", [])
    base = entry.get("args", {})
    vprops = entry.get("variantProps", ["variant"])
    known = {s: STATE_ARGS[s] for s in states if s in STATE_ARGS}
    unknown = [s for s in states if s not in STATE_ARGS and s != "default"]

    if platform == "rn":
        imports = ("import React from 'react';\nimport { View } from 'react-native';\n"
                   "import type { Meta, StoryObj } from '@storybook/react-native';\n")
        row_open = "<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: t.space[3], alignItems: 'center' }}>"
        row_close = "</View>"
    else:
        imports = "import React from 'react';\nimport type { Meta, StoryObj } from '@storybook/react';\n"
        row_open = "<div style={{ display: 'flex', flexWrap: 'wrap', gap: t.space[3], alignItems: 'center' }}>"
        row_close = "</div>"

    argtypes = []
    if variants and len(vprops) == 1:
        argtypes.append(f"    {vprops[0]}: {{ control: 'select', options: {ts(entry['variants'])} }},")
    if len(sizes) > 1:
        argtypes.append(f"    size: {{ control: 'select', options: {ts(sizes)} }},")

    out = [imports,
           f"import {{ {name} }} from './{name}';",
           "import { useTheme } from '../theme';", "",
           "const meta = {",
           f"  title: '{pascal(cat)}/{name}',",
           f"  component: {name},",
           "  tags: ['autodocs'],",
           f"  args: {ts(base)},"]
    if argtypes:
        out += ["  argTypes: {", *argtypes, "  },"]
    out += [f"}} satisfies Meta<typeof {name}>;", "", "export default meta;",
            "type Story = StoryObj<typeof meta>;", "",
            "export const Default: Story = {};", ""]

    for v in variants:
        out += [f"export const {pascal(v)}: Story = {{ args: {ts(variant_args(entry, v))} }};"]
    if variants: out.append("")

    def row(story, items):
        return [f"export const {story}: Story = {{",
                "  render: (args) => {",
                "    const t = useTheme();",
                "    return (",
                f"      {row_open}",
                *[f"        <{name} {{...args}} {' '.join(f'{k}={{{ts(x)}}}' for k, x in a.items())} />" for a in items],
                f"      {row_close}",
                "    );", "  },", "};", ""]

    if len(sizes) > 1:
        out += row("Sizes", [{"size": s} for s in sizes])
    if known:
        out += row("States", list(known.values()))
    if unknown:
        out += [f"// States not expressible as props (add a play function or on-device control): {', '.join(unknown)}", ""]
    out += ["export const DarkMode: Story = { parameters: { mode: 'dark' } };", ""]
    return "\n".join(out)

def main():
    p = argparse.ArgumentParser()
    p.add_argument("manifest"); p.add_argument("outdir")
    p.add_argument("--platform", choices=["rn", "web"], default="rn")
    p.add_argument("--force", action="store_true")
    a = p.parse_args()
    entries = json.load(open(a.manifest))
    os.makedirs(a.outdir, exist_ok=True)
    written, skipped = [], []
    for e in entries:
        path = os.path.join(a.outdir, f"{e['name']}.stories.tsx")
        if os.path.exists(path) and not a.force:
            skipped.append(e["name"]); continue
        open(path, "w").write(render(e, a.platform)); written.append(e["name"])
    print(f"wrote {len(written)}: {', '.join(written)}")
    if skipped: print(f"kept existing {len(skipped)}: {', '.join(skipped)}")

if __name__ == "__main__":
    sys.exit(main())
