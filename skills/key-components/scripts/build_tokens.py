#!/usr/bin/env python3
"""
build_tokens.py — deterministic design-token generator.

Usage:
    python3 build_tokens.py <style-spec.json> <out-dir>

Reads the spec, generates:
    <out-dir>/tokens.json      primitive + semantic (light/dark) tokens, DTCG-ish
    <out-dir>/tokens.ts        if platforms include react-native or web
    <out-dir>/tokens.css       if platforms include web
    <out-dir>/Tokens.swift     if platforms include swiftui
    <out-dir>/contrast-report.md

Same spec in → byte-identical files out. No randomness, no dates inside token files.
Only stdlib.
"""
import json, sys, os, colorsys, re
from typing import Dict, Any, Tuple, List

# --------------------------------------------------------------------------- color math

def hex_to_rgb(h: str) -> Tuple[float, float, float]:
    h = h.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))  # type: ignore

def rgb_to_hex(rgb: Tuple[float, float, float]) -> str:
    return '#' + ''.join(f'{max(0, min(255, round(c * 255))):02X}' for c in rgb)

def hex_to_hsl(h: str):
    r, g, b = hex_to_rgb(h)
    hh, l, s = colorsys.rgb_to_hls(r, g, b)
    return hh * 360, s * 100, l * 100

def hsl_to_hex(h: float, s: float, l: float) -> str:
    r, g, b = colorsys.hls_to_rgb((h % 360) / 360, max(0, min(100, l)) / 100, max(0, min(100, s)) / 100)
    return rgb_to_hex((r, g, b))

def rel_lum(h: str) -> float:
    def ch(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(c) for c in hex_to_rgb(h))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b

def contrast(a: str, b: str) -> float:
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return round((hi + 0.05) / (lo + 0.05), 2)

# Fixed lightness table: ramps across families line up, and the neutral ramp's
# 50/950 endpoints are light/dark surfaces.
STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
LIGHTNESS = {50: 97, 100: 93, 200: 86, 300: 76, 400: 64, 500: 52, 600: 44, 700: 36, 800: 28, 900: 20, 950: 12}
# Saturation tapers at the ends so pale tints and deep shades don't look neon.
SAT_SCALE = {50: 0.55, 100: 0.65, 200: 0.8, 300: 0.9, 400: 0.97, 500: 1.0, 600: 1.0, 700: 0.95, 800: 0.9, 900: 0.85, 950: 0.8}

def ramp(seed_hex: str) -> Dict[str, str]:
    h, s, l = hex_to_hsl(seed_hex)
    # Snap the seed into the nearest step so the brand hex appears exactly.
    nearest = min(STEPS, key=lambda st: abs(LIGHTNESS[st] - l))
    out = {}
    for st in STEPS:
        if st == nearest:
            out[str(st)] = rgb_to_hex(hex_to_rgb(seed_hex))
        else:
            out[str(st)] = hsl_to_hex(h, s * SAT_SCALE[st], LIGHTNESS[st])
    return out

def neutral_ramp(temp: str) -> Dict[str, str]:
    hue, sat = {'cool': (220, 8), 'warm': (40, 8), 'pure': (0, 0)}[temp]
    return {str(st): hsl_to_hex(hue, sat, LIGHTNESS[st]) for st in STEPS}

def alpha(hex_color: str, a: int) -> str:
    r, g, b = (round(c * 255) for c in hex_to_rgb(hex_color))
    return f'rgba({r}, {g}, {b}, {a / 100:.2f})'

# --------------------------------------------------------------------------- scales

RADIUS = {
    'sharp': {'none': 0, 'xs': 1, 'sm': 2, 'md': 4, 'lg': 6, 'xl': 8, 'full': 9999},
    'soft':  {'none': 0, 'xs': 2, 'sm': 4, 'md': 8, 'lg': 12, 'xl': 16, 'full': 9999},
    'round': {'none': 0, 'xs': 4, 'sm': 8, 'md': 12, 'lg': 16, 'xl': 24, 'full': 9999},
    'pill':  {'none': 0, 'xs': 6, 'sm': 12, 'md': 16, 'lg': 24, 'xl': 32, 'full': 9999},
}
SPACE_STEPS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24]
SIZE_STEPS = [100, 200, 300, 400, 500, 600, 700, 800, 900]  # 300 = base
LINE_HEIGHT = {'tight': 1.15, 'snug': 1.25, 'normal': 1.5, 'relaxed': 1.6}
LETTER = {'tight': -0.02, 'normal': 0, 'wide': 0.04}
WEIGHT = {'regular': 400, 'medium': 500, 'semibold': 600, 'bold': 700}
ROLES = {  # role: (lg, md, sm) size steps, weight, lineHeight, letterSpacing, family
    'display':  ((900, 800, 700), 'bold', 'tight', 'tight', 'display'),
    'headline': ((700, 600, 500), 'semibold', 'tight', 'tight', 'display'),
    'title':    ((500, 400, 300), 'semibold', 'snug', 'normal', 'display'),
    'body':     ((400, 300, 200), 'regular', 'normal', 'normal', 'body'),
    'label':    ((300, 200, 100), 'medium', 'snug', 'normal', 'body'),
    'caption':  ((None, 200, 100), 'regular', 'snug', 'wide', 'body'),
    'mono':     ((None, 300, 200), 'regular', 'normal', 'normal', 'mono'),
}
ELEVATION_ALPHA = {'low': 0.6, 'medium': 1.0, 'high': 1.4}
DEFAULT_STATUS = {'success': '#16A34A', 'warning': '#F59E0B', 'danger': '#DC2626', 'info': '#0284C7'}

def type_sizes(base: float, ratio: float) -> Dict[str, int]:
    return {str(st): round(base * ratio ** (i - 2)) for i, st in enumerate(SIZE_STEPS)}

# --------------------------------------------------------------------------- build

def build(spec: Dict[str, Any]) -> Tuple[Dict[str, Any], List[str]]:
    platforms = spec.get('platforms') or ['react-native']
    modes = spec.get('modes') or ['light', 'dark']
    color = spec['color']
    typ = spec['type']
    a11y_text = 7.0 if spec.get('accessibility', {}).get('target') == 'AAA' else 4.5
    hairline = 1 if platforms == ['web'] else 0.5

    prim: Dict[str, Any] = {'color': {}, 'font': {}, 'space': {}, 'radius': {}, 'border': {}, 'elevation': {},
                            'motion': {}, 'opacity': {}, 'zIndex': {}, 'breakpoint': {}}

    # colors
    prim['color']['white'] = '#FFFFFF'
    prim['color']['black'] = '#000000'
    prim['color']['neutral'] = neutral_ramp(color.get('neutral', 'cool'))
    prim['color']['primary'] = ramp(color['primary'])
    if color.get('secondary'):
        prim['color']['secondary'] = ramp(color['secondary'])
    if color.get('accent'):
        prim['color']['accent'] = ramp(color['accent'])
    status = {**DEFAULT_STATUS, **{k: v for k, v in (color.get('status') or {}).items() if not k.startswith('$') and v}}
    for k, v in status.items():
        prim['color'][k] = ramp(v)
    prim['color']['alpha'] = {
        'black': {str(a): alpha('#000000', a) for a in (4, 8, 12, 16, 24, 40, 60)},
        'white': {str(a): alpha('#FFFFFF', a) for a in (4, 8, 12, 16, 24, 40, 60)},
    }

    # type
    fam = {'display': typ.get('display', 'System'), 'body': typ.get('body', 'System'), 'mono': typ.get('mono', 'Menlo')}
    prim['font']['family'] = fam
    prim['font']['weight'] = dict(WEIGHT)
    prim['font']['size'] = type_sizes(float(typ.get('baseSize', 16)), float(typ.get('ratio', 1.2)))
    prim['font']['lineHeight'] = dict(LINE_HEIGHT)
    prim['font']['letterSpacing'] = dict(LETTER)

    # space / radius / border
    base = int(spec.get('space', {}).get('base', 4))
    prim['space'] = {str(s): s * base for s in SPACE_STEPS}
    prim['radius'] = dict(RADIUS[spec.get('shape', {}).get('radius', 'soft')])
    prim['border']['width'] = {'hairline': hairline, 'regular': 1, 'thick': 2}

    # elevation
    k = ELEVATION_ALPHA[spec.get('elevation', 'medium')]
    levels = [(0, 0, 0), (1, 2, 0.08), (2, 6, 0.10), (6, 16, 0.12), (12, 28, 0.16)]
    prim['elevation'] = {str(i): {'offsetY': y, 'blur': b, 'alpha': round(a * k, 3), 'android': i * 2}
                         for i, (y, b, a) in enumerate(levels)}
    prim['motion'] = {'duration': {'fast': 120, 'normal': 200, 'slow': 320},
                      'easing': {'standard': 'cubic-bezier(0.2, 0, 0, 1)', 'emphasized': 'cubic-bezier(0.3, 0, 0, 1)',
                                 'exit': 'cubic-bezier(0.4, 0, 1, 1)'}}
    prim['opacity'] = {'disabled': 0.4, 'muted': 0.64}
    prim['zIndex'] = {'base': 0, 'raised': 10, 'sticky': 100, 'overlay': 1000, 'modal': 1100, 'toast': 1200}
    prim['breakpoint'] = {'sm': 640, 'md': 768, 'lg': 1024, 'xl': 1280}

    n = prim['color']['neutral']
    p = prim['color']['primary']
    st = {kk: prim['color'][kk] for kk in status}
    report: List[str] = []

    def pick_on(bg: str) -> str:
        """Deterministic on-color: white if it meets the text threshold, else neutral.950; if neither, the better one."""
        w, d = contrast(bg, '#FFFFFF'), contrast(bg, n['950'])
        if w >= a11y_text:
            return '#FFFFFF'
        if d >= a11y_text:
            return n['950']
        return '#FFFFFF' if w >= d else n['950']

    def semantic(mode: str) -> Dict[str, Any]:
        L = mode == 'light'
        def N(light_step, dark_step):
            return n[str(light_step if L else dark_step)]
        def R(rmp, light_step, dark_step):
            return rmp[str(light_step if L else dark_step)]

        s: Dict[str, Any] = {}
        s['bg'] = {'default': N(50, 950), 'subtle': N(100, 900), 'muted': N(200, 800), 'inverse': N(900, 100)}
        s['surface'] = {'default': '#FFFFFF' if L else N(0, 900), 'raised': '#FFFFFF' if L else N(0, 800),
                        'overlay': '#FFFFFF' if L else N(0, 800), 'sunken': N(100, 950)}
        s['text'] = {'default': N(900, 50), 'muted': N(600, 400), 'subtle': N(500, 500), 'inverse': N(50, 900),
                     'disabled': N(400, 600), 'accent': R(p, 600, 300)}
        s['border'] = {'default': N(300, 700), 'subtle': N(200, 800), 'strong': N(500, 500),
                       'focus': R(p, 500, 400), 'inverse': N(700, 300)}
        s['icon'] = {'default': N(700, 200), 'muted': N(500, 500), 'accent': R(p, 600, 300)}
        s['overlay'] = {'scrim': prim['color']['alpha']['black']['60' if L else '60']}

        acc_default = R(p, 600, 500)
        s['bg']['accent'] = {'default': acc_default, 'hover': R(p, 700, 400), 'pressed': R(p, 800, 300),
                             'subtle': R(p, 50, 950), 'muted': R(p, 100, 900)}
        s['text']['onAccent'] = pick_on(acc_default)
        s['icon']['onAccent'] = s['text']['onAccent']
        if 'secondary' in prim['color']:
            sc = prim['color']['secondary']
            s['bg']['secondary'] = {'default': R(sc, 600, 500), 'pressed': R(sc, 800, 300), 'subtle': R(sc, 50, 950)}
            s['text']['secondary'] = R(sc, 700, 300)
            s['text']['onSecondary'] = pick_on(s['bg']['secondary']['default'])
        if 'accent' in prim['color']:
            ac = prim['color']['accent']
            s['bg']['highlight'] = {'default': R(ac, 500, 400), 'subtle': R(ac, 50, 950)}
            s['text']['highlight'] = R(ac, 700, 300)
            s['text']['onHighlight'] = pick_on(s['bg']['highlight']['default'])
        for name, rmp in st.items():
            strong = R(rmp, 600, 500)
            s['bg'][name] = {'strong': strong, 'pressed': R(rmp, 700, 400), 'subtle': R(rmp, 50, 950), 'muted': R(rmp, 100, 900)}
            s['text'][name] = R(rmp, 800, 200)
            s['text']['on' + name.capitalize()] = pick_on(strong)
            s['border'][name] = R(rmp, 500, 400)
            s['icon'][name] = R(rmp, 600, 300)

        # type roles
        s['font'] = {}
        for role, (sizes, w, lh, ls, family) in ROLES.items():
            s['font'][role] = {}
            for label, step in zip(('lg', 'md', 'sm'), sizes):
                if step is None:
                    continue
                size = prim['font']['size'][str(step)]
                s['font'][role][label] = {
                    'family': fam[family], 'size': size,
                    'lineHeight': round(size * LINE_HEIGHT[lh]),
                    'weight': WEIGHT[w], 'letterSpacing': round(size * LETTER[ls], 2),
                }

        # elevation resolved per mode (dark relies on surface lightness, lower alpha)
        s['elevation'] = {}
        for lvl, e in prim['elevation'].items():
            a = e['alpha'] if L else round(e['alpha'] * 1.6, 3)
            s['elevation'][lvl] = {'shadowColor': '#000000', 'shadowOffset': {'width': 0, 'height': e['offsetY']},
                                   'shadowOpacity': a, 'shadowRadius': e['blur'], 'elevation': e['android'],
                                   'css': f"0 {e['offsetY']}px {e['blur']}px rgba(0,0,0,{a})" if e['blur'] else 'none'}

        # contrast checks
        pairs = [
            ('text.default', s['text']['default'], 'bg.default', s['bg']['default'], a11y_text),
            ('text.default', s['text']['default'], 'surface.default', s['surface']['default'], a11y_text),
            ('text.muted', s['text']['muted'], 'bg.default', s['bg']['default'], a11y_text),
            ('text.muted', s['text']['muted'], 'surface.default', s['surface']['default'], a11y_text),
            ('text.accent', s['text']['accent'], 'bg.default', s['bg']['default'], a11y_text),
            ('text.onAccent', s['text']['onAccent'], 'bg.accent.default', acc_default, a11y_text),
            ('text.inverse', s['text']['inverse'], 'bg.inverse', s['bg']['inverse'], a11y_text),
            ('border.strong', s['border']['strong'], 'bg.default', s['bg']['default'], 3.0),
            ('icon.default', s['icon']['default'], 'bg.default', s['bg']['default'], 3.0),
            ('border.focus', s['border']['focus'], 'bg.default', s['bg']['default'], 3.0),
        ]
        for name in st:
            pairs.append((f'text.{name}', s['text'][name], f'bg.{name}.subtle', s['bg'][name]['subtle'], a11y_text))
            pairs.append((f'text.on{name.capitalize()}', s['text']['on' + name.capitalize()], f'bg.{name}.strong', s['bg'][name]['strong'], a11y_text))
        for fg_n, fg, bg_n, bg, need in pairs:
            c = contrast(fg, bg)
            flag = 'PASS' if c >= need else 'FAIL'
            report.append(f'| {mode} | `{fg_n}` on `{bg_n}` | {c}:1 | {need}:1 | {flag} |')
        return s

    tokens: Dict[str, Any] = {
        '$schema': 'design-system/tokens v1',
        'name': spec.get('name', ''), 'prefix': spec.get('prefix', 'ds'), 'version': spec.get('version', '1.0.0'),
        'platforms': platforms, 'modes': modes,
        'primitive': prim,
    }
    for m in modes:
        tokens[m] = semantic(m)
    # component tokens (aliases only)
    comp = {
        'button': {'height': {'sm': 32, 'md': 44, 'lg': 52}, 'radius': 'radius.md' if prim['radius']['full'] else 'radius.md'},
        'textField': {'height': {'md': 44, 'lg': 52}},
        'switch': {'track': {'width': 51, 'height': 31}, 'thumb': 27},
        'checkbox': {'size': 20}, 'radio': {'size': 20},
        'chip': {'height': {'sm': 28, 'md': 32}},
        'tag': {'height': {'sm': 20, 'md': 24}},
        'avatar': {'size': {'xs': 24, 'sm': 32, 'md': 40, 'lg': 56, 'xl': 80}},
        'tabBar': {'height': 49}, 'topBar': {'height': 44},
        'listItem': {'minHeight': {'single': 44, 'double': 60}},
        'card': {'padding': 'space.3' if typ.get('density') == 'compact' else 'space.4', 'radius': 'radius.lg'},
        'touchTarget': {'min': 44},
    }
    if spec.get('shape', {}).get('radius') == 'pill':
        comp['button']['radius'] = 'radius.full'
    tokens['component'] = comp
    return tokens, report

# --------------------------------------------------------------------------- emitters

def is_leaf(v: Dict[str, Any]) -> bool:
    """True for the three dict shapes that are single values, not sub-trees.
    Each test also checks the shape, not just the key name: `primitive.font` owns a
    `family` key and `primitive.border` owns a `width` key, and both are sub-trees."""
    if 'shadowColor' in v:                                       # a resolved elevation
        return True
    if 'width' in v and 'height' in v:                           # shadowOffset, switch track
        return True
    if 'family' in v and not isinstance(v['family'], dict):      # a text style
        return True
    return False

def flatten(d: Dict[str, Any], prefix: str = '') -> Dict[str, Any]:
    out = {}
    for k, v in d.items():
        key = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict) and not is_leaf(v):
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out

def css_name(prefix: str, path: str) -> str:
    kebab = re.sub(r'([a-z0-9])([A-Z])', r'\1-\2', path).replace('.', '-').lower()
    return f'--{prefix}-{kebab}'

def emit_css(t: Dict[str, Any]) -> str:
    prefix = t['prefix']
    lines = ['/* Generated by design-system/build_tokens.py — do not edit; edit style-spec.json */', '']
    def block(selector, tree, fs_rem=True):
        lines.append(selector + ' {')
        for path, v in flatten(tree).items():
            if isinstance(v, dict):
                if 'family' in v:
                    for prop in ('family', 'size', 'lineHeight', 'weight', 'letterSpacing'):
                        val = v[prop]
                        if prop == 'family':
                            val = f"'{val}', system-ui, sans-serif" if val != 'System' else 'system-ui, -apple-system, sans-serif'
                        elif prop in ('size', 'lineHeight', 'letterSpacing'):
                            val = f'{val}px'
                        lines.append(f'  {css_name(prefix, f"{path}.{prop}")}: {val};')
                elif 'css' in v:
                    lines.append(f'  {css_name(prefix, path)}: {v["css"]};')
                continue
            if isinstance(v, (int, float)) and path.split('.')[0] in ('space', 'radius', 'breakpoint') or path.startswith('border.width') or path.startswith('font.size'):
                v = f'{v}px'
            elif isinstance(v, (int, float)) and path.startswith('motion.duration'):
                v = f'{v}ms'
            lines.append(f'  {css_name(prefix, path)}: {v};')
        lines.append('}')
        lines.append('')
    block(':root', t['primitive'])
    for mode in t['modes']:
        sel = ':root, [data-theme="light"]' if mode == 'light' else '[data-theme="dark"]'
        block(sel, t[mode])
    # type utility classes
    for role, sizes in t[t['modes'][0]]['font'].items():
        for sz in sizes:
            base = f'font.{role}.{sz}'
            fam = css_name(prefix, base + '.family'); size = css_name(prefix, base + '.size')
            lh = css_name(prefix, base + '.lineHeight'); w = css_name(prefix, base + '.weight'); ls = css_name(prefix, base + '.letterSpacing')
            lines.append(f'.{prefix}-type-{role}-{sz} {{ font: var({w}) var({size})/var({lh}) var({fam}); letter-spacing: var({ls}); }}')
    return '\n'.join(lines) + '\n'

def emit_ts(t: Dict[str, Any]) -> str:
    modes = t['modes']
    body = json.dumps({'primitive': t['primitive'], **{m: t[m] for m in modes}, 'component': t['component']}, indent=2)
    mode_type = ' | '.join(f"'{m}'" for m in modes)
    return (
        '// Generated by design-system/build_tokens.py — do not edit; edit style-spec.json\n'
        f'export const tokens = {body} as const;\n\n'
        f'export type Mode = {mode_type};\n'
        f"export type Theme = typeof tokens['{modes[0]}'];\n"
        'export type Primitive = typeof tokens.primitive;\n'
        'export type ComponentTokens = typeof tokens.component;\n'
    )

def emit_swift(t: Dict[str, Any]) -> str:
    P = ''.join(w.capitalize() for w in t['prefix'].split('-')) + 'Tokens'
    modes = t['modes']
    def sw_id(s: str) -> str:
        s = re.sub(r'[^A-Za-z0-9]', '_', s)
        return ('_' + s) if s[0].isdigit() else s
    out = ['// Generated by design-system/build_tokens.py — do not edit; edit style-spec.json', 'import SwiftUI', '',
           'extension Color {',
           '  init(hex: String) {',
           '    var h = hex.trimmingCharacters(in: .alphanumerics.inverted); if h.count == 3 { h = h.map { "\\($0)\\($0)" }.joined() }',
           '    let v = UInt64(h, radix: 16) ?? 0',
           '    self.init(.sRGB, red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255, opacity: 1)',
           '  }',
           '  init(rgba: String) {',
           '    let n = rgba.replacingOccurrences(of: "rgba(", with: "").replacingOccurrences(of: ")", with: "").split(separator: ",").map { Double($0.trimmingCharacters(in: .whitespaces)) ?? 0 }',
           '    self.init(.sRGB, red: n[0] / 255, green: n[1] / 255, blue: n[2] / 255, opacity: n.count > 3 ? n[3] : 1)',
           '  }',
           '}', '',
           'public struct DSElevation { public let color: Color; public let radius: CGFloat; public let y: CGFloat; public let opacity: Double }',
           'public struct DSTextStyle { public let family: String; public let size: CGFloat; public let lineHeight: CGFloat; public let weight: Int; public let letterSpacing: CGFloat',
           '  public var font: Font { family == "System" ? .system(size: size, weight: fw) : .custom(family, size: size).weight(fw) }',
           '  private var fw: Font.Weight { switch weight { case 700: .bold; case 600: .semibold; case 500: .medium; default: .regular } }',
           '}', '',
           f'public enum {P} {{']
    prim = t['primitive']
    def color_val(v: str) -> str:
        return f'Color(rgba: "{v}")' if v.startswith('rgba') else f'Color(hex: "{v}")'
    out.append('  public enum Primitive {')
    out.append('    public enum ColorRamp {')
    for fam, rmp in prim['color'].items():
        if isinstance(rmp, dict) and fam != 'alpha':
            out.append(f'      public enum {sw_id(fam)} {{')
            for k, v in rmp.items():
                out.append(f'        public static let {sw_id("s" + k)} = {color_val(v)}')
            out.append('      }')
    out.append('    }')
    out.append('    public enum Space {')
    for k, v in prim['space'].items():
        out.append(f'      public static let {sw_id("s" + k)}: CGFloat = {v}')
    out.append('    }')
    out.append('    public enum Radius {')
    for k, v in prim['radius'].items():
        out.append(f'      public static let {sw_id(k)}: CGFloat = {v}')
    out.append('    }')
    out.append('  }')
    # Theme struct
    out.append('  public struct Theme {')
    out.append('    public struct Colors { public let bg: [String: Color]; public let surface: [String: Color]; public let text: [String: Color]; public let border: [String: Color]; public let icon: [String: Color] }')
    out.append('    public let colors: Colors')
    out.append('    public let font: [String: DSTextStyle]')
    out.append('    public let elevation: [Int: DSElevation]')
    out.append('    public let space: [Int: CGFloat] = [' + ', '.join(f'{k}: {v}' for k, v in prim['space'].items()) + ']')
    out.append('    public let radius: (none: CGFloat, xs: CGFloat, sm: CGFloat, md: CGFloat, lg: CGFloat, xl: CGFloat, full: CGFloat) = (' + ', '.join(f'{k}: {v}' for k, v in prim['radius'].items()) + ')')
    out.append(f'    public let hairline: CGFloat = 1 / UIScreen.main.scale')
    out.append('    public let disabledOpacity: Double = ' + str(prim['opacity']['disabled']))
    for m in modes:
        s = t[m]
        def dict_lit(group):
            items = []
            for k, v in flatten(s[group]).items():
                items.append(f'"{k}": {color_val(v)}')
            return '[' + ', '.join(items) + ']'
        fonts = []
        for role, sizes in s['font'].items():
            for sz, v in sizes.items():
                fonts.append(f'"{role}.{sz}": DSTextStyle(family: "{v["family"]}", size: {v["size"]}, lineHeight: {v["lineHeight"]}, weight: {v["weight"]}, letterSpacing: {v["letterSpacing"]})')
        elev = ', '.join(f'{k}: DSElevation(color: .black, radius: {v["shadowRadius"]}, y: {v["shadowOffset"]["height"]}, opacity: {v["shadowOpacity"]})' for k, v in s['elevation'].items())
        out.append(f'    public static let {m} = Theme(')
        out.append(f'      colors: Colors(bg: {dict_lit("bg")}, surface: {dict_lit("surface")}, text: {dict_lit("text")}, border: {dict_lit("border")}, icon: {dict_lit("icon")}),')
        out.append('      font: [' + ', '.join(fonts) + '],')
        out.append(f'      elevation: [{elev}]')
        out.append('    )')
    out.append('  }')
    out.append('}')
    out.append('')
    out.append('// Usage: t.colors.text["default"]!  t.font["body.md"]!.font  t.space[4]!  t.radius.md')
    return '\n'.join(out) + '\n'

# --------------------------------------------------------------------------- main

def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    spec_path, out_dir = sys.argv[1], sys.argv[2]
    with open(spec_path) as f:
        spec = json.load(f)
    spec = {k: v for k, v in spec.items() if not k.startswith('$')}
    for req in ('name', 'prefix', 'color', 'type'):
        if req not in spec:
            sys.exit(f'style-spec.json missing required field: {req}')
    os.makedirs(out_dir, exist_ok=True)
    tokens, report = build(spec)

    with open(os.path.join(out_dir, 'tokens.json'), 'w') as f:
        json.dump(tokens, f, indent=2, sort_keys=False)
        f.write('\n')
    written = ['tokens.json']
    plats = set(tokens['platforms'])
    if plats & {'react-native', 'web'}:
        with open(os.path.join(out_dir, 'tokens.ts'), 'w') as f:
            f.write(emit_ts(tokens)); written.append('tokens.ts')
    if 'web' in plats:
        with open(os.path.join(out_dir, 'tokens.css'), 'w') as f:
            f.write(emit_css(tokens)); written.append('tokens.css')
    if 'swiftui' in plats:
        with open(os.path.join(out_dir, 'Tokens.swift'), 'w') as f:
            f.write(emit_swift(tokens)); written.append('Tokens.swift')

    fails = [r for r in report if r.endswith('FAIL |')]
    rep = ['# Contrast report', '', f'Threshold: text {7.0 if spec.get("accessibility", {}).get("target") == "AAA" else 4.5}:1, UI 3:1.', '',
           '| Mode | Pair | Ratio | Needed | Result |', '|---|---|---|---|---|', *report, '',
           f'**{len(fails)} failing pair(s).**' if fails else '**All pairs pass.**']
    with open(os.path.join(out_dir, 'contrast-report.md'), 'w') as f:
        f.write('\n'.join(rep) + '\n')
    written.append('contrast-report.md')

    print(f'Wrote: {", ".join(written)} → {out_dir}')
    print(f'Contrast: {len(report) - len(fails)} pass / {len(fails)} fail')
    for r in fails:
        print('  ' + r)
    if fails:
        print('Surface the failing pairs to the user; do not silence them. Usual fix: a darker/lighter seed or a different neutral temperature.')

if __name__ == '__main__':
    main()
