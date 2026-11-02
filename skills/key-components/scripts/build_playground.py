#!/usr/bin/env python3
"""
build_playground.py — renders tokens.json (+ components/manifest.json) into one self-contained HTML file.

Usage:
    python3 build_playground.py <tokens.json> <out.html> [--components manifest.json] [--extra-css styles.css]

The playground shows every foundation (color ramps + semantic roles with contrast, type roles, space,
radius, elevation, motion) and an HTML rendering of every component in the manifest across
variants × sizes × states, with a live "tester" per component, light/dark toggle, and a phone frame toggle.
Renderings are driven by the same tokens the code uses; they approximate RN/SwiftUI components in HTML.
A manifest entry may carry its own `html` template (with {variant}/{size}/{state} placeholders)
for a bespoke inventory the built-in RENDERERS don't cover; pair it with --extra-css to inline the
project's real stylesheet so those components render for real rather than being approximated twice.

Deterministic: same inputs → identical file. Only stdlib.
"""
import json, sys, re, html, os
from typing import Dict, Any, List

def is_leaf(v):
    """The three dict shapes that are one value, not a sub-tree. Each checks the shape
    as well as the key: primitive.font owns a `family` key and primitive.border owns a
    `width` key, and both are sub-trees. Mirrors build_tokens.py."""
    if 'shadowColor' in v:
        return True
    if 'width' in v and 'height' in v:
        return True
    if 'family' in v and not isinstance(v['family'], dict):
        return True
    return False

def flatten(d, prefix=''):
    out = {}
    for k, v in d.items():
        key = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict) and not is_leaf(v):
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out

def var(path: str) -> str:
    return '--' + re.sub(r'([a-z0-9])([A-Z])', r'\1-\2', path).replace('.', '-').lower()

def css_vars(tree: Dict[str, Any]) -> str:
    lines = []
    for path, v in flatten(tree).items():
        if isinstance(v, dict):
            if 'family' in v:
                fam = 'system-ui, -apple-system, sans-serif' if v['family'] == 'System' else f"'{v['family']}', system-ui, sans-serif"
                lines += [f"{var(path + '.family')}: {fam};", f"{var(path + '.size')}: {v['size']}px;",
                          f"{var(path + '.lineHeight')}: {v['lineHeight']}px;", f"{var(path + '.weight')}: {v['weight']};",
                          f"{var(path + '.letterSpacing')}: {v['letterSpacing']}px;"]
            elif 'css' in v:
                lines.append(f"{var(path)}: {v['css']};")
            continue
        top = path.split('.')[0]
        if isinstance(v, (int, float)) and (top in ('space', 'radius') or path.startswith('border.width') or path.startswith('font.size')):
            v = f'{v}px'
        lines.append(f'{var(path)}: {v};')
    return '\n'.join('  ' + l for l in lines)

def contrast(a: str, b: str) -> float:
    def lum(h):
        h = h.lstrip('#')
        r, g, b_ = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
        f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b_)
    if not (a.startswith('#') and b.startswith('#')):
        return 0
    la, lb = lum(a), lum(b)
    return round((max(la, lb) + 0.05) / (min(la, lb) + 0.05), 2)

def type_css(role, size):
    return (f"font-family:var({var(f'font.{role}.{size}.family')});font-size:var({var(f'font.{role}.{size}.size')});"
            f"line-height:var({var(f'font.{role}.{size}.lineHeight')});font-weight:var({var(f'font.{role}.{size}.weight')});"
            f"letter-spacing:var({var(f'font.{role}.{size}.letterSpacing')});")

# --------------------------------------------------------------------------- component renderers (HTML approximations)
# Each returns HTML for one instance given variant, size, state. Styles use CSS vars only.

def icon(name='●'):
    return f'<span class="ic" aria-hidden="true">{name}</span>'

def r_button(v, s, st, label='Button'):
    h = {'sm': 32, 'md': 44, 'lg': 52}[s]
    px = {'sm': 'var(--space-3)', 'md': 'var(--space-4)', 'lg': 'var(--space-5)'}[s]
    inner = '<span class="spin"></span>' if st == 'loading' else f'{label}'
    return (f'<button class="ds-btn v-{v} st-{st}" data-state="{st}" style="height:{h}px;padding:0 {px};{type_css("label", s)}" '
            f'{"disabled" if st in ("disabled", "loading") else ""}>{inner}</button>')

def r_iconbutton(v, s, st):
    h = {'sm': 32, 'md': 44, 'lg': 52}[s]
    return f'<button class="ds-iconbtn v-{v}" data-state="{st}" style="width:{h}px;height:{h}px" {"disabled" if st == "disabled" else ""} aria-label="Icon">{icon("✚")}</button>'

def r_link(v, s, st):
    return f'<a href="#" class="ds-link v-{v}" data-state="{st}" style="{type_css("label" if v == "standalone" else "body", "md")}">Learn more{" ›" if v == "standalone" else ""}</a>'

def r_chip(v, s, st):
    h = {'sm': 28, 'md': 32}.get(s, 32)
    trail = ' ×' if v == 'input' else ''
    return f'<button class="ds-chip v-{v}" data-state="{st}" style="height:{h}px;{type_css("label", "sm")}" {"disabled" if st == "disabled" else ""}>Chip{trail}</button>'

def r_textfield(v, s, st, multiline=False):
    h = {'md': 44, 'lg': 52}.get(s, 44)
    err = st == 'error'
    tag = f'<textarea class="ds-input" rows="3" placeholder="Placeholder"></textarea>' if multiline else f'<input class="ds-input" placeholder="Placeholder" value="{"Value" if st != "default" else ""}" {"disabled" if st == "disabled" else ""} {"readonly" if st == "readOnly" else ""}>'
    return (f'<label class="ds-field v-{v}" data-state="{st}"><span class="lbl" style="{type_css("label", "md")}">Label</span>'
            f'<span class="box" style="{"" if multiline else f"height:{h}px"}">{tag}</span>'
            f'<span class="help" style="{type_css("caption", "md")}">{"Error message" if err else "Helper text"}</span></label>')

def r_check(v, s, st, radio=False):
    kind = 'radio' if radio else 'checkbox'
    checked = 'checked' if st in ('checked', 'indeterminate', 'selected') else ''
    return f'<label class="ds-check {"radio" if radio else ""}" data-state="{st}"><input type="{kind}" {checked} {"disabled" if st == "disabled" else ""}><span class="box"></span><span style="{type_css("body", "md")}">Option</span></label>'

def r_switch(v, s, st):
    on = 'on' if st in ('on', 'selected', 'checked') else 'off'
    return f'<button class="ds-switch {on}" role="switch" aria-checked="{on == "on"}" data-state="{st}" {"disabled" if st == "disabled" else ""}><span class="thumb"></span></button>'

def r_select(v, s, st):
    return r_textfield(v, s, st).replace('<input class="ds-input"', '<input class="ds-input" readonly value="Selected option"').replace('</span><span class="help"', f'{icon("⌄")}</span><span class="help"', 1)

def r_toast(v, s, st):
    return f'<div class="ds-toast v-{v}" style="{type_css("body", "md")}">{icon("✓")}<span>Saved successfully</span><a href="#" class="act" style="{type_css("label", "md")}">Undo</a></div>'

def r_alert(v, s, st):
    return (f'<div class="ds-alert v-{v}">{icon("ⓘ")}<div><div style="{type_css("title", "sm")}">Alert title</div>'
            f'<div style="{type_css("body", "sm")}" class="muted">Supporting description for the alert.</div></div><button class="x" aria-label="Dismiss">×</button></div>')

def r_dialog(v, s, st):
    return (f'<div class="ds-scrim"><div class="ds-dialog"><div style="{type_css("title", "md")}">Delete item?</div>'
            f'<div style="{type_css("body", "md")}" class="muted">This action cannot be undone.</div>'
            f'<div class="row">{r_button("secondary", "md", "default", "Cancel")}{r_button("danger" if v == "destructive" else "primary", "md", "default", "Delete" if v == "destructive" else "Confirm")}</div></div></div>')

def r_sheet(v, s, st):
    return (f'<div class="ds-scrim tall"><div class="ds-sheet {v}"><div class="grab"></div><div style="{type_css("title", "md")}">Sheet title</div>'
            f'<div style="{type_css("body", "md")}" class="muted">Scrollable content lives here.</div></div></div>')

def r_skeleton(v, s, st):
    return '<div class="ds-skel"><div class="ds-skel-line" style="width:70%"></div><div class="ds-skel-line" style="width:90%"></div><div class="ds-skel-line" style="width:40%"></div></div>' if v == 'text' else \
           ('<div class="ds-skel-circle"></div>' if v == 'circle' else '<div class="ds-skel-rect"></div>')

def r_spinner(v, s, st):
    d = {'sm': 16, 'md': 24, 'lg': 32}[s]
    return f'<span class="spin accent" style="width:{d}px;height:{d}px;border-width:{max(2, d // 8)}px"></span>'

def r_topbar(v, s, st):
    return f'<div class="ds-topbar v-{v}"><span class="ic">‹</span><span style="{type_css("title", "md")}">Screen title</span><span class="ic">⋯</span></div>'

def r_tabbar(v, s, st):
    items = ''.join(f'<div class="item {"active" if i == 0 else ""}"><span class="ic">{g}</span><span style="{type_css("label", "sm")}">{n}</span>{"<span class=dot></span>" if i == 2 else ""}</div>'
                    for i, (g, n) in enumerate([('⌂', 'Home'), ('⌕', 'Search'), ('♡', 'Saved'), ('☺', 'Profile')]))
    return f'<div class="ds-tabbar">{items}</div>'

def r_tabs(v, s, st):
    items = ''.join(f'<button class="tab {"active" if i == 0 else ""}" style="{type_css("label", "md")}">{n}</button>' for i, n in enumerate(['Overview', 'Activity', 'Settings']))
    return f'<div class="ds-tabs v-{v}">{items}</div>'

def r_badge(v, s, st):
    return '<span class="ds-badge dot"></span>' if v == 'dot' else f'<span class="ds-badge" style="{type_css("caption", "sm")}">{"99+" if st == "overflow" else "3"}</span>'

def r_tag(v, s, st):
    h = {'sm': 20, 'md': 24}.get(s, 24)
    intent, style = (v.split('-') + ['subtle'])[:2]
    return f'<span class="ds-tag i-{intent} {style}" style="height:{h}px;{type_css("caption", "md" if s == "md" else "sm")}">{intent.capitalize()}</span>'

def r_avatar(v, s, st):
    d = {'xs': 24, 'sm': 32, 'md': 40, 'lg': 56, 'xl': 80}.get(s, 40)
    return f'<span class="ds-avatar {v}" style="width:{d}px;height:{d}px;font-size:{d * 0.4:.0f}px">AS{"<span class=status></span>" if st == "status" else ""}</span>'

def r_progress(v, s, st):
    h = {'sm': 4, 'md': 8}.get(s, 8)
    return f'<div class="ds-progress {v}" style="height:{h}px"><div class="fill" style="width:{"100" if v == "indeterminate" else "60"}%"></div></div>'

def r_card(v, s, st):
    return (f'<div class="ds-card v-{v}" data-state="{st}"><div style="{type_css("title", "sm")}">Card title</div>'
            f'<div style="{type_css("body", "sm")}" class="muted">Cards group related content and actions.</div></div>')

def r_listitem(v, s, st):
    trail = {'chevron': '<span class="ic muted">›</span>', 'value': f'<span class="muted" style="{type_css("body", "md")}">Value</span>', 'switch': r_switch('', '', 'on')}.get(v, '<span class="ic muted">›</span>')
    return (f'<div class="ds-listitem" data-state="{st}">{r_avatar("circle", "sm", "")}<div class="txt"><div style="{type_css("body", "md")}">List item title</div>'
            f'<div class="muted" style="{type_css("caption", "md")}">Supporting subtitle</div></div>{trail}</div>')

def r_divider(v, s, st):
    return '<div class="ds-divider"></div>' if v != 'inset' else '<div class="ds-divider inset"></div>'

def r_empty(v, s, st):
    return (f'<div class="ds-empty"><div class="ill">◌</div><div style="{type_css("title", "md")}">Nothing here yet</div>'
            f'<div class="muted" style="{type_css("body", "md")}">When you add items they will show up here.</div>{r_button("primary", "md", "default", "Add item")}</div>')

RENDERERS = {
    'Button': r_button, 'IconButton': r_iconbutton, 'Link': r_link, 'Chip': r_chip,
    'TextField': r_textfield, 'TextArea': lambda v, s, st: r_textfield(v, s, st, True), 'Checkbox': r_check,
    'Radio': lambda v, s, st: r_check(v, s, st, True), 'RadioGroup': lambda v, s, st: r_check(v, s, st, True),
    'Switch': r_switch, 'Select': r_select, 'Toast': r_toast, 'Alert': r_alert, 'Dialog': r_dialog, 'Sheet': r_sheet,
    'Skeleton': r_skeleton, 'Spinner': r_spinner, 'TopBar': r_topbar, 'TabBar': r_tabbar, 'Tabs': r_tabs,
    'Badge': r_badge, 'Tag': r_tag, 'Avatar': r_avatar, 'ProgressBar': r_progress, 'Card': r_card,
    'ListItem': r_listitem, 'Divider': r_divider, 'EmptyState': r_empty,
}

# --------------------------------------------------------------------------- page

COMPONENT_CSS = r"""
.ic{display:inline-flex;width:1.1em;height:1.1em;align-items:center;justify-content:center;font-size:1em;line-height:1}
.muted{color:var(--text-muted)}
.spin{display:inline-block;width:18px;height:18px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin .8s linear infinite}
.spin.accent{color:var(--icon-accent)}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){*{animation-duration:0s!important;transition-duration:0s!important}}
.ds-btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--space-2);border-radius:var(--radius-md);border:var(--border-width-regular) solid transparent;cursor:pointer;transition:background-color var(--motion-duration-fast) var(--motion-easing-standard)}
.ds-btn:focus-visible,.ds-iconbtn:focus-visible,.ds-chip:focus-visible,.ds-switch:focus-visible,.tab:focus-visible,.ds-link:focus-visible{outline:2px solid var(--border-focus);outline-offset:2px}
.ds-btn:disabled,.ds-iconbtn:disabled,.ds-chip:disabled,.ds-switch:disabled,.ds-check [data-state=disabled],.ds-field[data-state=disabled]{opacity:var(--opacity-disabled);cursor:not-allowed}
.ds-btn.v-primary{background:var(--bg-accent-default);color:var(--text-on-accent)}.ds-btn.v-primary:hover{background:var(--bg-accent-hover)}.ds-btn.v-primary:active,.ds-btn.v-primary[data-state=pressed]{background:var(--bg-accent-pressed)}
.ds-btn.v-secondary{background:var(--surface-default);color:var(--text-default);border-color:var(--border-strong)}.ds-btn.v-secondary:hover,.ds-btn.v-secondary[data-state=pressed]{background:var(--bg-muted)}
.ds-btn.v-tertiary{background:transparent;color:var(--text-accent)}.ds-btn.v-tertiary:hover,.ds-btn.v-tertiary[data-state=pressed]{background:var(--bg-accent-subtle)}
.ds-btn.v-danger{background:var(--bg-danger-strong);color:var(--text-on-danger)}.ds-btn.v-danger:hover,.ds-btn.v-danger[data-state=pressed]{background:var(--bg-danger-pressed)}
.ds-iconbtn{display:inline-flex;align-items:center;justify-content:center;border-radius:var(--radius-md);border:var(--border-width-regular) solid transparent;cursor:pointer;font-size:18px}
.ds-iconbtn.v-filled{background:var(--bg-accent-default);color:var(--icon-on-accent)}.ds-iconbtn.v-outlined{background:var(--surface-default);color:var(--icon-default);border-color:var(--border-strong)}.ds-iconbtn.v-ghost{background:transparent;color:var(--icon-default)}
.ds-iconbtn:hover,.ds-iconbtn[data-state=pressed]{filter:brightness(.92)}
.ds-link{color:var(--text-accent);text-decoration:none}.ds-link.v-inline{text-decoration:underline}.ds-link:hover,.ds-link[data-state=pressed]{text-decoration:underline;opacity:.85}
.ds-chip{display:inline-flex;align-items:center;gap:6px;padding:0 var(--space-3);border-radius:var(--radius-full);border:var(--border-width-regular) solid var(--border-default);background:var(--surface-default);color:var(--text-default);cursor:pointer}
.ds-chip[data-state=selected]{background:var(--bg-accent-subtle);border-color:var(--border-focus);color:var(--text-accent)}.ds-chip:hover,.ds-chip[data-state=pressed]{background:var(--bg-muted)}
.ds-field{display:flex;flex-direction:column;gap:6px;width:280px;max-width:100%}.ds-field .lbl{color:var(--text-default)}.ds-field .help{color:var(--text-muted)}
.ds-field .box{display:flex;align-items:center;gap:var(--space-2);padding:0 var(--space-3);border-radius:var(--radius-md);border:var(--border-width-regular) solid var(--border-strong);background:var(--surface-default)}
.ds-field.v-filled .box{background:var(--bg-subtle);border-color:transparent}
.ds-field[data-state=focus] .box{border-color:var(--border-focus);box-shadow:0 0 0 2px var(--bg-accent-subtle)}
.ds-field[data-state=error] .box{border-color:var(--border-danger)}.ds-field[data-state=error] .help{color:var(--text-danger)}
.ds-field[data-state=readOnly] .box{background:var(--bg-subtle)}
.ds-input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--text-default);font:inherit;padding:var(--space-2) 0;resize:vertical}.ds-input::placeholder{color:var(--text-subtle)}
.ds-check{display:inline-flex;align-items:center;gap:var(--space-3);min-height:44px;cursor:pointer;color:var(--text-default)}.ds-check input{position:absolute;opacity:0;width:0;height:0}
.ds-check .box{width:20px;height:20px;border-radius:var(--radius-xs);border:2px solid var(--border-strong);display:inline-flex;align-items:center;justify-content:center;background:var(--surface-default);color:var(--text-on-accent);font-size:14px}
.ds-check.radio .box{border-radius:50%}
.ds-check input:checked+.box{background:var(--bg-accent-default);border-color:var(--bg-accent-default)}.ds-check:not(.radio) input:checked+.box::after{content:"✓"}.ds-check.radio input:checked+.box::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--text-on-accent)}
.ds-check[data-state=indeterminate] .box::after{content:"–"!important}.ds-check[data-state=error] .box{border-color:var(--border-danger)}
.ds-check input:focus-visible+.box{outline:2px solid var(--border-focus);outline-offset:2px}
.ds-switch{width:51px;height:31px;border-radius:9999px;border:0;background:var(--bg-muted);position:relative;cursor:pointer;padding:0;transition:background var(--motion-duration-fast)}.ds-switch.on{background:var(--bg-accent-default)}
.ds-switch .thumb{position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:var(--elevation-1);transition:transform var(--motion-duration-fast) var(--motion-easing-standard)}.ds-switch.on .thumb{transform:translateX(20px)}
.ds-toast{display:inline-flex;align-items:center;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-radius:var(--radius-lg);box-shadow:var(--elevation-3);min-width:280px}
.ds-toast .act{margin-left:auto;text-decoration:none;color:inherit;font-weight:600}
.ds-toast.v-neutral{background:var(--bg-inverse);color:var(--text-inverse)}
.ds-toast.v-success{background:var(--bg-success-strong);color:var(--text-on-success)}.ds-toast.v-warning{background:var(--bg-warning-strong);color:var(--text-on-warning)}.ds-toast.v-danger{background:var(--bg-danger-strong);color:var(--text-on-danger)}.ds-toast.v-info{background:var(--bg-info-strong);color:var(--text-on-info)}
.ds-alert{display:flex;gap:var(--space-3);padding:var(--space-3) var(--space-4);border-radius:var(--radius-lg);border:var(--border-width-regular) solid;max-width:420px;color:var(--text-default)}
.ds-alert .x{margin-left:auto;background:none;border:0;color:inherit;font-size:18px;cursor:pointer}
.ds-alert.v-neutral{background:var(--bg-subtle);border-color:var(--border-default)}
.ds-alert.v-success{background:var(--bg-success-subtle);border-color:var(--border-success);color:var(--text-success)}.ds-alert.v-warning{background:var(--bg-warning-subtle);border-color:var(--border-warning);color:var(--text-warning)}.ds-alert.v-danger{background:var(--bg-danger-subtle);border-color:var(--border-danger);color:var(--text-danger)}.ds-alert.v-info{background:var(--bg-info-subtle);border-color:var(--border-info);color:var(--text-info)}
.ds-alert .muted{color:inherit;opacity:.8}
.ds-scrim{background:var(--overlay-scrim);padding:var(--space-8);border-radius:var(--radius-lg);display:flex;align-items:center;justify-content:center;width:100%;max-width:420px;box-sizing:border-box}.ds-scrim.tall{align-items:flex-end;min-height:260px;padding:0;overflow:hidden}
.ds-dialog{background:var(--surface-overlay);border-radius:var(--radius-xl);padding:var(--space-6);box-shadow:var(--elevation-4);display:flex;flex-direction:column;gap:var(--space-3);width:300px;color:var(--text-default)}.ds-dialog .row{display:flex;gap:var(--space-2);justify-content:flex-end;margin-top:var(--space-2)}
.ds-sheet{background:var(--surface-overlay);border-radius:var(--radius-xl) var(--radius-xl) 0 0;padding:var(--space-4) var(--space-5) var(--space-6);width:100%;box-shadow:var(--elevation-4);display:flex;flex-direction:column;gap:var(--space-2);color:var(--text-default)}.ds-sheet.full{min-height:230px}
.ds-sheet .grab{width:36px;height:5px;border-radius:9999px;background:var(--border-default);align-self:center;margin-bottom:var(--space-2)}
.ds-skel{display:flex;flex-direction:column;gap:var(--space-2);width:280px}.ds-skel-line,.ds-skel-rect,.ds-skel-circle{background:linear-gradient(90deg,var(--bg-muted) 25%,var(--bg-subtle) 50%,var(--bg-muted) 75%);background-size:200% 100%;animation:shimmer 1.4s infinite;border-radius:var(--radius-sm)}
.ds-skel-line{height:14px}.ds-skel-rect{width:280px;height:120px;border-radius:var(--radius-lg)}.ds-skel-circle{width:48px;height:48px;border-radius:50%}
@keyframes shimmer{to{background-position:-200% 0}}
.ds-topbar{display:flex;align-items:center;justify-content:space-between;height:44px;padding:0 var(--space-4);background:var(--surface-default);border-bottom:var(--border-width-hairline) solid var(--border-subtle);color:var(--text-default);width:100%;max-width:390px;box-sizing:border-box}.ds-topbar.v-transparent{background:transparent;border-bottom-color:transparent}.ds-topbar .ic{font-size:22px;color:var(--icon-accent)}
.ds-tabbar{display:flex;height:49px;background:var(--surface-default);border-top:var(--border-width-hairline) solid var(--border-subtle);width:100%;max-width:390px}.ds-tabbar .item{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:var(--text-muted);position:relative}.ds-tabbar .item .ic{font-size:20px}.ds-tabbar .item.active{color:var(--text-accent)}
.ds-tabbar .dot{position:absolute;top:6px;right:calc(50% - 14px);width:8px;height:8px;border-radius:50%;background:var(--bg-danger-strong)}
.ds-tabs{display:flex;gap:2px}.ds-tabs .tab{border:0;background:transparent;color:var(--text-muted);padding:var(--space-2) var(--space-4);cursor:pointer}
.ds-tabs.v-underline .tab{border-bottom:2px solid transparent}.ds-tabs.v-underline .tab.active{color:var(--text-accent);border-bottom-color:var(--bg-accent-default)}
.ds-tabs.v-segmented{background:var(--bg-muted);padding:2px;border-radius:var(--radius-md)}.ds-tabs.v-segmented .tab{border-radius:calc(var(--radius-md) - 2px);height:32px}.ds-tabs.v-segmented .tab.active{background:var(--surface-raised);color:var(--text-default);box-shadow:var(--elevation-1)}
.ds-badge{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9999px;background:var(--bg-danger-strong);color:var(--text-on-danger);font-weight:600}.ds-badge.dot{min-width:8px;width:8px;height:8px;padding:0}
.ds-tag{display:inline-flex;align-items:center;padding:0 var(--space-2);border-radius:var(--radius-sm);font-weight:500}
.ds-tag.i-neutral.subtle{background:var(--bg-muted);color:var(--text-default)}.ds-tag.i-neutral.strong{background:var(--bg-inverse);color:var(--text-inverse)}
.ds-tag.i-accent.subtle{background:var(--bg-accent-subtle);color:var(--text-accent)}.ds-tag.i-accent.strong{background:var(--bg-accent-default);color:var(--text-on-accent)}
.ds-tag.i-success.subtle{background:var(--bg-success-subtle);color:var(--text-success)}.ds-tag.i-success.strong{background:var(--bg-success-strong);color:var(--text-on-success)}
.ds-tag.i-warning.subtle{background:var(--bg-warning-subtle);color:var(--text-warning)}.ds-tag.i-warning.strong{background:var(--bg-warning-strong);color:var(--text-on-warning)}
.ds-tag.i-danger.subtle{background:var(--bg-danger-subtle);color:var(--text-danger)}.ds-tag.i-danger.strong{background:var(--bg-danger-strong);color:var(--text-on-danger)}
.ds-tag.i-info.subtle{background:var(--bg-info-subtle);color:var(--text-info)}.ds-tag.i-info.strong{background:var(--bg-info-strong);color:var(--text-on-info)}
.ds-avatar{display:inline-flex;align-items:center;justify-content:center;border-radius:50%;background:var(--bg-accent-subtle);color:var(--text-accent);font-weight:600;position:relative;font-family:var(--font-label-md-family)}.ds-avatar.square{border-radius:var(--radius-md)}
.ds-avatar .status{position:absolute;right:0;bottom:0;width:25%;height:25%;border-radius:50%;background:var(--bg-success-strong);border:2px solid var(--surface-default)}
.ds-progress{width:240px;background:var(--bg-muted);border-radius:9999px;overflow:hidden}.ds-progress .fill{height:100%;background:var(--bg-accent-default);border-radius:9999px}
.ds-progress.indeterminate .fill{width:40%;animation:indet 1.4s infinite var(--motion-easing-standard)}@keyframes indet{from{transform:translateX(-100%)}to{transform:translateX(300%)}}
.ds-card{width:280px;padding:var(--space-4);border-radius:var(--radius-lg);display:flex;flex-direction:column;gap:var(--space-1);color:var(--text-default)}
.ds-card.v-elevated{background:var(--surface-raised);box-shadow:var(--elevation-1)}.ds-card.v-outlined{background:var(--surface-default);border:var(--border-width-regular) solid var(--border-default)}.ds-card.v-filled{background:var(--bg-subtle)}
.ds-card[data-state=pressed]{filter:brightness(.96)}
.ds-listitem{display:flex;align-items:center;gap:var(--space-3);min-height:60px;padding:var(--space-2) var(--space-4);background:var(--surface-default);border-bottom:var(--border-width-hairline) solid var(--border-subtle);width:100%;max-width:390px;box-sizing:border-box;color:var(--text-default)}.ds-listitem .txt{flex:1;display:flex;flex-direction:column}.ds-listitem[data-state=pressed]{background:var(--bg-subtle)}
.ds-divider{height:var(--border-width-hairline);background:var(--border-subtle);width:100%;max-width:390px}.ds-divider.inset{margin-left:var(--space-4);max-width:calc(390px - var(--space-4))}
.ds-empty{display:flex;flex-direction:column;align-items:center;text-align:center;gap:var(--space-3);max-width:320px;padding:var(--space-8) var(--space-4);color:var(--text-default)}.ds-empty .ill{font-size:56px;color:var(--icon-muted);line-height:1}
"""

PAGE_CSS = r"""
*{box-sizing:border-box}body{margin:0;background:var(--bg-default);color:var(--text-default);font-family:var(--font-body-md-family);transition:background .2s}
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:16px;padding:12px 24px;background:var(--surface-default);border-bottom:1px solid var(--border-subtle)}
.top h1{font:var(--font-title-md-weight) var(--font-title-md-size)/var(--font-title-md-line-height) var(--font-title-md-family);margin:0}
.top .v{color:var(--text-muted);font-size:13px}.top nav{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap}
.top nav a,.top button{font:500 13px/1 var(--font-body-md-family);padding:8px 12px;border-radius:var(--radius-md);border:1px solid var(--border-default);background:var(--surface-default);color:var(--text-default);text-decoration:none;cursor:pointer}
.top button[aria-pressed=true]{background:var(--bg-accent-subtle);border-color:var(--border-focus);color:var(--text-accent)}
main{max-width:1200px;margin:0 auto;padding:24px}main.phone{max-width:390px}
section{margin:0 0 48px}section>h2{font:var(--font-headline-sm-weight) var(--font-headline-sm-size)/var(--font-headline-sm-line-height) var(--font-headline-sm-family);letter-spacing:var(--font-headline-sm-letter-spacing);margin:0 0 16px;padding-top:8px}
h3{font:var(--font-title-sm-weight) var(--font-title-sm-size)/var(--font-title-sm-line-height) var(--font-title-sm-family);margin:24px 0 8px}
.meta{color:var(--text-muted);font-size:13px;margin:0 0 12px}
.ramps{display:grid;gap:12px}.ramp{display:grid;grid-template-columns:90px repeat(11,1fr);gap:2px;align-items:center}.ramp .n{font-size:12px;color:var(--text-muted)}
.sw{height:44px;border-radius:6px;display:flex;align-items:flex-end;justify-content:center;font-size:9px;padding:3px;font-family:var(--font-mono-sm-family);border:1px solid var(--border-subtle)}
.roles{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px}.role{display:flex;gap:10px;align-items:center;padding:8px;border:1px solid var(--border-subtle);border-radius:var(--radius-md);background:var(--surface-default)}.role .chip{width:36px;height:36px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);flex:none}.role code{font-size:11px;color:var(--text-default);word-break:break-all}.role .c{font-size:11px;color:var(--text-muted)}
.type-row{display:grid;grid-template-columns:150px 1fr 200px;gap:16px;align-items:baseline;padding:10px 0;border-bottom:1px solid var(--border-subtle)}.type-row .k{font-size:12px;color:var(--text-muted);font-family:var(--font-mono-sm-family)}.type-row .m{font-size:11px;color:var(--text-muted);font-family:var(--font-mono-sm-family)}
.space-row{display:flex;align-items:center;gap:12px;margin:6px 0;font-size:12px;color:var(--text-muted)}.space-row .bar{height:14px;background:var(--bg-accent-default);border-radius:2px}
.radii{display:flex;gap:16px;flex-wrap:wrap}.radii div{width:72px;height:72px;background:var(--bg-accent-subtle);border:2px solid var(--border-focus);display:flex;align-items:flex-end;justify-content:center;font-size:11px;color:var(--text-accent);padding:4px}
.elev{display:flex;gap:24px;flex-wrap:wrap}.elev div{width:120px;height:80px;border-radius:var(--radius-lg);background:var(--surface-raised);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--text-muted)}
.comp{border:1px solid var(--border-subtle);border-radius:var(--radius-lg);background:var(--surface-default);padding:20px;margin-bottom:20px}
.comp header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.comp header h3{margin:0}.cat{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)}.tier{font-size:11px;padding:2px 6px;border-radius:9999px;background:var(--bg-muted);color:var(--text-muted)}
.tester{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:16px 0;padding:16px;background:var(--bg-subtle);border-radius:var(--radius-md)}.tester label{font-size:12px;color:var(--text-muted);display:flex;gap:6px;align-items:center}.tester select{font:13px var(--font-body-md-family);padding:6px 8px;border-radius:var(--radius-sm);border:1px solid var(--border-default);background:var(--surface-default);color:var(--text-default)}
.stage{flex:1 1 100%;display:flex;align-items:center;justify-content:center;min-height:80px;padding:16px;background:var(--bg-default);border-radius:var(--radius-md);border:1px dashed var(--border-default)}
details{margin-top:8px}summary{cursor:pointer;font-size:13px;color:var(--text-accent)}
.matrix{display:grid;gap:12px;margin-top:12px}.mrow{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border-subtle)}.mrow .lab{width:140px;font-size:11px;color:var(--text-muted);font-family:var(--font-mono-sm-family);flex:none}
.cell{display:flex;flex-direction:column;gap:4px;align-items:flex-start}.cell small{font-size:10px;color:var(--text-subtle)}
.note{font-size:12px;color:var(--text-muted);border-left:3px solid var(--border-default);padding:6px 10px;margin:8px 0}
"""

JS = r"""
const root=document.documentElement;
function setMode(m){root.dataset.theme=m;document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===m));}
function setFrame(f){document.querySelector('main').classList.toggle('phone',f==='phone');document.querySelectorAll('[data-frame]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.frame===f));}
setMode(matchMedia('(prefers-color-scheme: dark)').matches&&document.body.dataset.hasDark==='1'?'dark':'light');setFrame('desktop');
document.querySelectorAll('.tester').forEach(t=>{const name=t.dataset.comp;const stage=t.querySelector('.stage');const sel=t.querySelectorAll('select');
 const upd=()=>{if(!RENDER[name])return;  // a tester with hand-written stage content (Motion) has no RENDER entry; leave it alone
  const v=t.querySelector('[name=variant]')?.value||'';const s=t.querySelector('[name=size]')?.value||'md';const st=t.querySelector('[name=state]')?.value||'default';
  stage.innerHTML=RENDER[name]?.[[v,s,st].join('|')]||'<span class="meta">No rendering for this combination.</span>';};
 sel.forEach(x=>x.addEventListener('change',upd));upd();});
"""

def section_foundations(t: Dict[str, Any], mode: str) -> str:
    prim = t['primitive']; sem = t[mode]
    out = ['<section id="color"><h2>Color</h2><p class="meta">Primitive ramps (top) are inputs. Semantic roles (below) are what components use. Contrast shown against the role\'s documented background.</p><div class="ramps">']
    for fam, rmp in prim['color'].items():
        if isinstance(rmp, dict) and fam != 'alpha':
            out.append(f'<div class="ramp"><span class="n">color.{fam}</span>' + ''.join(
                f'<div class="sw" style="background:{v};color:{"#000" if int(k) <= 400 else "#fff"}" title="color.{fam}.{k} {v}">{k}</div>' for k, v in rmp.items()) + '</div>')
    out.append('</div><h3>Semantic roles</h3><div class="roles">')
    bg = sem['bg']['default']
    for group in ('bg', 'surface', 'text', 'border', 'icon'):
        for path, v in flatten(sem[group], group).items():
            if not isinstance(v, str):
                continue
            against = sem['bg']['default'] if group in ('text', 'border', 'icon') else None
            c = f'<span class="c">{contrast(v, against)}:1 on bg.default</span>' if against and v.startswith('#') else ''
            out.append(f'<div class="role"><span class="chip" style="background:{v}"></span><div><code>{path}</code><br><span class="c">{v}</span> {c}</div></div>')
    out.append('</div></section>')

    out.append('<section id="type"><h2>Typography</h2><p class="meta">Roles describe purpose. Each has lg/md/sm. Components use roles, never raw sizes.</p>')
    for role, sizes in sem['font'].items():
        for sz, v in sizes.items():
            out.append(f'<div class="type-row"><span class="k">font.{role}.{sz}</span><span style="{type_css(role, sz)}">The quick brown fox jumps over the lazy dog</span>'
                       f'<span class="m">{v["family"]} · {v["size"]}/{v["lineHeight"]} · {v["weight"]} · {v["letterSpacing"]}</span></div>')
    out.append('</section>')

    out.append('<section id="space"><h2>Space</h2>')
    for k, v in prim['space'].items():
        out.append(f'<div class="space-row"><span style="width:70px">space.{k}</span><div class="bar" style="width:{max(v, 1)}px"></div><span>{v}</span></div>')
    out.append('</section><section id="shape"><h2>Radius & border</h2><div class="radii">')
    for k, v in prim['radius'].items():
        out.append(f'<div style="border-radius:{min(v, 36)}px">{k} {v}</div>')
    out.append('</div><p class="meta">Border widths: ' + ', '.join(f'{k} {v}' for k, v in prim['border']['width'].items()) + '</p></section>')
    out.append('<section id="elevation"><h2>Elevation</h2><div class="elev">')
    for k, v in sem['elevation'].items():
        out.append(f'<div style="box-shadow:{v["css"]}">elevation.{k}</div>')
    out.append('</div></section>')
    out.append('<section id="motion"><h2>Motion</h2><p class="meta">Durations ' + ', '.join(f'{k} {v}ms' for k, v in prim['motion']['duration'].items()) +
               ' · Easing ' + ', '.join(f'{k} {v}' for k, v in prim['motion']['easing'].items()) + '. Animations respect prefers-reduced-motion.</p>'
               '<div class="tester" data-comp="__motion"><div class="stage"><button class="ds-btn v-primary" style="height:44px;padding:0 16px" onmouseenter="this.style.transform=\'scale(1.04)\'" onmouseleave="this.style.transform=\'\'" '
               'style="transition:transform var(--motion-duration-normal) var(--motion-easing-emphasized)">Hover me</button></div></div></section>')
    return '\n'.join(out)

def section_components(manifest: List[Dict[str, Any]]) -> (str, Dict[str, Dict[str, str]]):
    out = ['<section id="components"><h2>Components</h2><p class="meta">HTML approximations driven by the same tokens as the code. Use the tester to combine variant × size × state; expand the matrix to see everything at once. Native previews: see <code>previews/</code>.</p>']
    render_map: Dict[str, Dict[str, str]] = {}
    for c in manifest:
        name = c['name']
        tpl = c.get('html')
        # a project with its own inventory supplies markup in the manifest; {variant} /
        # {size} / {state} are substituted, and its CSS comes in via --extra-css.
        fn = (lambda v, s_, st, _t=tpl: _t.format(variant=v, size=s_, state=st)) if tpl else RENDERERS.get(name)
        variants = c.get('variants') or ['default']; sizes = c.get('sizes') or ['md']; states = c.get('states') or ['default']
        out.append(f'<div class="comp" id="c-{name}"><header><h3>{name}</h3><span class="cat">{c.get("category", "")}</span><span class="tier">{c.get("tier", "core")}</span></header>')
        if c.get('purpose'):
            out.append(f'<p class="meta">{html.escape(c["purpose"])}</p>')
        if not fn:
            out.append(f'<div class="note">No HTML renderer for <b>{name}</b>. Add an <code>html</code> template to its manifest entry, add a renderer to <code>build_playground.py</code>, or rely on the native preview in <code>previews/</code>.</div></div>')
            continue
        render_map[name] = {}
        for v in variants:
            for s in sizes:
                for st in states:
                    try:
                        render_map[name]['|'.join([v, s, st])] = fn(v, s, st)
                    except Exception as e:  # a renderer that can't do a combo shouldn't break the page
                        render_map[name]['|'.join([v, s, st])] = f'<span class="meta">{name} {v}/{s}/{st}: {e}</span>'
        def sel(nm, opts):
            return f'<label>{nm}<select name="{nm}">' + ''.join(f'<option value="{o}"{" selected" if o == "md" else ""}>{o}</option>' for o in opts) + '</select></label>' if len(opts) > 1 or nm == 'variant' else f'<input type="hidden" name="{nm}" value="{opts[0]}">'
        out.append(f'<div class="tester" data-comp="{name}">{sel("variant", variants)}{sel("size", sizes)}{sel("state", states)}<div class="stage"></div></div>')
        out.append('<details><summary>Full matrix</summary><div class="matrix">')
        for v in variants:
            for s in sizes:
                cells = ''.join(f'<div class="cell">{render_map[name]["|".join([v, s, st])]}<small>{st}</small></div>' for st in states)
                out.append(f'<div class="mrow"><span class="lab">{v} · {s}</span>{cells}</div>')
        out.append('</div></details></div>')
    out.append('</section>')
    return '\n'.join(out), render_map

def main():
    args = sys.argv[1:]
    if len(args) < 2:
        print(__doc__); sys.exit(1)
    tokens_path, out_path = args[0], args[1]
    manifest_path = args[args.index('--components') + 1] if '--components' in args else None
    extra_css_path = args[args.index('--extra-css') + 1] if '--extra-css' in args else None
    t = json.load(open(tokens_path))
    manifest = json.load(open(manifest_path)) if manifest_path else []
    extra_css = open(extra_css_path).read() if extra_css_path else ''
    modes = t['modes']; has_dark = 'dark' in modes
    light_vars = css_vars(t['primitive']) + '\n' + css_vars(t['light'])
    dark_vars = css_vars(t['dark']) if has_dark else ''
    comps_html, render_map = section_components(manifest)
    nav = ''.join(f'<a href="#{i}">{n}</a>' for i, n in [('color', 'Color'), ('type', 'Type'), ('space', 'Space'), ('shape', 'Shape'), ('elevation', 'Elevation'), ('motion', 'Motion'), ('components', 'Components')])
    mode_btns = ''.join(f'<button data-mode="{m}" onclick="setMode(\'{m}\')">{m}</button>' for m in modes)
    doc = f"""<!doctype html>
<html lang="en" data-theme="light">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(t.get('name', 'Design System'))} · Playground</title>
<style>
{extra_css}
</style>
<style>
:root, [data-theme="light"] {{
{light_vars}
}}
{'[data-theme="dark"] {' + chr(10) + dark_vars + chr(10) + '}' if has_dark else ''}
{PAGE_CSS}
{COMPONENT_CSS}
</style></head>
<body data-has-dark="{'1' if has_dark else '0'}">
<div class="top"><h1>{html.escape(t.get('name', 'Design System'))}</h1><span class="v">v{t.get('version', '')} · {', '.join(t.get('platforms', []))} · {len(manifest)} components</span>
<nav>{nav}</nav>
<div style="display:flex;gap:6px;margin-left:12px">{mode_btns}<button data-frame="desktop" onclick="setFrame('desktop')">desktop</button><button data-frame="phone" onclick="setFrame('phone')">390pt</button></div></div>
<main>
{section_foundations(t, 'light')}
{comps_html}
</main>
<script>const RENDER={json.dumps(render_map)};{JS}</script>
</body></html>
"""
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w') as f:
        f.write(doc)
    print(f'Wrote {out_path} ({len(doc) // 1024} KB, {len(render_map)} rendered components, {sum(len(v) for v in render_map.values())} combinations)')

if __name__ == '__main__':
    main()
