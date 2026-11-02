#!/usr/bin/env python3
"""
audit_codebase.py — inventory of hardcoded style values in a codebase (extract mode).

Usage:
    python3 audit_codebase.py <src-dir> [--out audit.json] [--top 15]

Scans .ts .tsx .js .jsx .css .scss .swift .kt .dart .vue .svelte .html for:
  colors      hex / rgb(a) / hsl(a)          → clustered by hue, saturated vs neutral
  fontFamily  fontFamily: 'X' / font-family: X / Font.custom("X")
  fontSize    fontSize: N / font-size: Npx / .font(.system(size: N))
  spacing     padding*/margin*/gap: N  (numbers in style contexts)
  radius      borderRadius: N / border-radius: Npx / cornerRadius: N

Prints a ranked report with counts and up to 3 file locations each, plus a proposed
style-spec starting point. Writes JSON if --out is given. Only stdlib. Deterministic ordering.
"""
import sys, os, re, json, colorsys
from collections import Counter, defaultdict

EXT = {'.ts', '.tsx', '.js', '.jsx', '.css', '.scss', '.swift', '.kt', '.dart', '.vue', '.svelte', '.html'}
SKIP = {'node_modules', '.git', 'dist', 'build', '.next', 'ios/Pods', 'Pods', 'design-system', 'coverage', '.expo', 'DerivedData'}

PAT = {
    'colors': re.compile(r'(#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))'),
    'fontFamily': re.compile(r'(?:fontFamily\s*[:=]\s*[\'"]([^\'"]+)[\'"]|font-family\s*:\s*([^;]+);|Font\.custom\(\s*"([^"]+)")'),
    'fontSize': re.compile(r'(?:fontSize\s*[:=]\s*(\d+(?:\.\d+)?)|font-size\s*:\s*(\d+(?:\.\d+)?)(?:px|pt)?|\.system\(size:\s*(\d+(?:\.\d+)?))'),
    'spacing': re.compile(r'(?:padding|margin|gap|paddingHorizontal|paddingVertical|paddingTop|paddingBottom|paddingLeft|paddingRight|marginTop|marginBottom|marginLeft|marginRight|marginHorizontal|marginVertical|row-gap|column-gap)\s*[:=]\s*(\d+(?:\.\d+)?)(?:px)?\b'),
    'radius': re.compile(r'(?:borderRadius|border-radius|cornerRadius)\s*[:=(]\s*(\d+(?:\.\d+)?)(?:px)?'),
}

def norm_hex(c: str):
    c = c.strip()
    if c.startswith('#'):
        h = c[1:]
        if len(h) in (3, 4):
            h = ''.join(x * 2 for x in h)
        if len(h) == 8:
            h = h[:6]
        if len(h) != 6:
            return None
        return '#' + h.upper()
    m = re.match(r'rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)', c)
    if m:
        return '#' + ''.join(f'{int(v):02X}' for v in m.groups())
    m = re.match(r'hsla?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%', c)
    if m:
        h, s, l = (int(v) for v in m.groups())
        r, g, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
        return '#' + ''.join(f'{round(v * 255):02X}' for v in (r, g, b))
    return None

def hsl(hex6: str):
    r, g, b = (int(hex6[i:i + 2], 16) / 255 for i in (1, 3, 5))
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h * 360, s * 100, l * 100

def scan(root: str):
    hits = {k: Counter() for k in PAT}
    where = {k: defaultdict(list) for k in PAT}
    files = 0
    for dp, dns, fns in os.walk(root):
        dns[:] = sorted(d for d in dns if d not in SKIP and not d.startswith('.'))
        for fn in sorted(fns):
            if os.path.splitext(fn)[1] not in EXT:
                continue
            path = os.path.join(dp, fn)
            try:
                text = open(path, encoding='utf-8', errors='ignore').read()
            except OSError:
                continue
            files += 1
            rel = os.path.relpath(path, root)
            for kind, rx in PAT.items():
                for m in rx.finditer(text):
                    val = next((g for g in m.groups() if g), None) if m.groups() else m.group(0)
                    if val is None:
                        continue
                    if kind == 'colors':
                        val = norm_hex(m.group(0))
                        if not val:
                            continue
                    elif kind == 'fontFamily':
                        val = val.split(',')[0].strip().strip('\'"')
                        if val.lower() in ('inherit', 'system-ui', 'sans-serif', 'serif', 'monospace'):
                            pass
                    else:
                        val = str(round(float(val), 1)).rstrip('0').rstrip('.')
                    hits[kind][val] += 1
                    line = text.count('\n', 0, m.start()) + 1
                    if len(where[kind][val]) < 3:
                        where[kind][val].append(f'{rel}:{line}')
    return files, hits, where

def propose(hits):
    sat, neu = [], []
    for c, n in hits['colors'].items():
        if c in ('#FFFFFF', '#000000'):
            continue
        h, s, l = hsl(c)
        (sat if s > 25 and 15 < l < 85 else neu).append((n, c, h, s, l))
    sat.sort(key=lambda x: (-x[0], x[1])); neu.sort(key=lambda x: (-x[0], x[1]))
    primary = sat[0][1] if sat else None
    secondary = next((c for n, c, h, s, l in sat[1:] if primary and abs(h - hsl(primary)[0]) % 360 > 30), None)
    temp = 'pure'
    if neu:
        n, c, h, s, l = neu[0]
        if s > 2:
            temp = 'warm' if 20 <= h <= 70 else 'cool'
    sizes = {float(k): v for k, v in hits['fontSize'].items()}
    body = None
    if sizes:
        cands = {k: v for k, v in sizes.items() if 13 <= k <= 18} or sizes
        body = max(sorted(cands), key=lambda k: cands[k])
    sp = [float(k) for k, v in hits['spacing'].items() for _ in range(v) if float(k) > 0]
    base = None
    if sp:
        m8 = sum(1 for v in sp if v % 8 == 0) / len(sp); m4 = sum(1 for v in sp if v % 4 == 0) / len(sp)
        base = 8 if m8 >= 0.8 else 4 if m4 >= 0.8 else 4
    rad = sorted(float(k) for k, v in hits['radius'].items() for _ in range(v) if float(k) < 100)
    profile = None
    if rad:
        med = rad[len(rad) // 2]
        profile = 'sharp' if med <= 4 else 'soft' if med <= 10 else 'round' if med <= 16 else 'pill'
    fams = [f for f, _ in hits['fontFamily'].most_common(3)]
    return {'color': {'primary': primary, 'secondary': secondary, 'neutral': temp},
            'type': {'families': fams, 'baseSize': body}, 'space': {'base': base}, 'shape': {'radius': profile},
            'evidence': {'saturated_top5': [(c, n) for n, c, *_ in sat[:5]], 'neutral_top5': [(c, n) for n, c, *_ in neu[:5]]}}

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); sys.exit(1)
    root = args[0]
    out = args[args.index('--out') + 1] if '--out' in args else None
    top = int(args[args.index('--top') + 1]) if '--top' in args else 15
    files, hits, where = scan(root)
    print(f'Scanned {files} files under {root}\n')
    for kind in PAT:
        print(f'== {kind} ({len(hits[kind])} distinct, {sum(hits[kind].values())} uses)')
        for val, n in sorted(hits[kind].items(), key=lambda kv: (-kv[1], kv[0]))[:top]:
            print(f'  {n:5d}  {val:<28} {", ".join(where[kind][val])}')
        print()
    prop = propose(hits)
    print('== proposed style-spec starting point (confirm with the user; every value here is a guess from usage counts)')
    print(json.dumps(prop, indent=2))
    if out:
        os.makedirs(os.path.dirname(out) or '.', exist_ok=True)
        json.dump({'files': files, 'hits': {k: dict(sorted(v.items(), key=lambda kv: (-kv[1], kv[0]))) for k, v in hits.items()},
                   'where': {k: dict(v) for k, v in where.items()}, 'proposed': prop}, open(out, 'w'), indent=2)
        print(f'\nWrote {out}')

if __name__ == '__main__':
    main()
