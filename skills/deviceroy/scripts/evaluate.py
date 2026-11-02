#!/usr/bin/env python3
"""Steps 4-5. Apply the rule catalog in catalog order -> candidates.json + findings.json.

Every rule has one fixed evaluator here. Evaluators return candidates with a verdict:
  fire   -> a finding (deterministic signal, required evidence present)
  review -> needs a judgment; becomes a finding ONLY via a cached judgment whose
            evidenceHash still matches (judgments.json, written by judge.py); otherwise
            it lands in "Needs manual review". The model never assigns severity or copy.
"""
import re, sys
from pathlib import Path
from _common import (PLATFORMS, REF, SEV_ORDER, VIEWPORTS, dump, hash4, hash_obj, load, rules, run_config)
from verify_api import verify

STACK_IMPL_KEY = {"rn-expo": "rn-expo", "flutter": "flutter", "swift": "swiftui", "web": "web"}
DESTRUCTIVE = re.compile(r"^(delete|remove|sign out|log out|cancel (plan|subscription|membership)|deactivate|unlink)\b", re.I)
CREATE = re.compile(r"^(new|add|create|compose)\b|^\+$", re.I)
TEXT_BTN = re.compile(r"^(edit|done|cancel|save)$", re.I)
PLATFORM_FILE = re.compile(r"\.(ios|android)\.[jt]sx?$")
NATIVE_SEARCH = re.compile(r"headerSearchBarOptions|Stack\.SearchBar|\.searchable\(|SearchAnchor")


# ---------------------------------------------------------------- element helpers
class Doc:
    def __init__(self, d):
        self.d = d
        self.ev = d["evidence"]
        self.vw, self.vh = d["viewport"]
        self.els = d["elements"]
        self._anc = {}

    def ancestors(self, i):
        if i not in self._anc:
            out, p = [], self.els[i]["parent"]
            while p is not None and p >= 0:
                out.append(p)
                p = self.els[p]["parent"]
            self._anc[i] = out
        return self._anc[i]

    def desc(self, i):
        return [j for j in range(len(self.els)) if i in self.ancestors(j)]

    def interactive(self):
        return [i for i, e in enumerate(self.els) if e["interactive"]]

    def bottom_nav(self):
        best = None
        for i, e in enumerate(self.els):
            x, y, w, h = e["bbox"]
            navish = e["tag"] == "nav" or e["role"] in ("navigation", "tablist")
            pinned = e["position"] in ("fixed", "sticky", "absolute") or e["fixedAncestor"]
            if navish and pinned and y + h >= self.vh * 0.8 and y > self.vh * 0.5:
                items = [j for j in self.desc(i) if self.els[j]["interactive"]]
                if len(items) >= 2 and (best is None or y + h > best[1]):
                    best = (i, y + h, items)
        return (best[0], best[2]) if best else (None, [])

    def top_bar(self):
        nav, items = self.bottom_nav()
        skip = set(items)
        return sorted((i for i in self.interactive() if i not in skip and self.els[i]["bbox"][1] >= 0
                       and self.els[i]["bbox"][1] + self.els[i]["bbox"][3] / 2 < 110), key=lambda i: self.els[i]["bbox"][0])

    def el(self, i, zone):
        e = self.els[i]
        return {"label": e["label"], "testID": e["testID"], "bbox": e["bbox"], "zone": zone}


def union(bboxes):
    xs = [b[0] for b in bboxes]; ys = [b[1] for b in bboxes]
    xe = [b[0] + b[2] for b in bboxes]; ye = [b[1] + b[3] for b in bboxes]
    return [min(xs), min(ys), max(xe) - min(xs), max(ye) - min(ys)]


def loc(hits, n=3):
    return ", ".join(f"{h['file']}:{h['line']}" for h in hits[:n]) + (f" (+{len(hits) - n} more)" if len(hits) > n else "")


# ---------------------------------------------------------------- screen context
class Screen:
    def __init__(self, s, static, docs, stack):
        self.s = s
        self.stack = stack
        self.slug = s["slug"]
        st = static.get(self.slug, {})
        self.tags = {}
        for part in ("own", "chrome"):
            for k, v in st.get(part, {}).items():
                self.tags.setdefault(k, []).extend(v)
        self.docs = docs
        self.has_code = bool(s["sources"] or s["chrome"])

    def t(self, *names):
        return [h for n in names for h in self.tags.get(n, [])]

    def doc(self, p):
        return self.docs.get(p)


def C(rule, platform, verdict, current, element=None, locations=None, evidence="C", related=None):
    return {"ruleId": rule, "platform": platform, "verdict": verdict, "current": current, "evidence": evidence,
            "element": element, "locations": [{"file": h["file"], "line": h["line"], "text": h["text"]} for h in (locations or [])],
            "related": related or []}


def plat_of(rule):
    return {"ios": ["ios"], "android": ["android"], "cross": ["both"]}[rule["platform"]]


def anchor(sc, p, finder, zone):
    """Pick an element from a capture for a code finding; fall back to the rule's zone."""
    d = sc.doc("ios" if p == "both" else p)
    if d:
        i = finder(d)
        if i is not None:
            return d.el(i, zone)
    return {"label": "", "testID": "", "bbox": None, "zone": zone}


def f_nav(d):
    i, _ = d.bottom_nav()
    return i


def visible_back(d, i):
    e = d.els[i]
    return bool(re.search(r"\bback\b", e["label"], re.I) or re.search(r"chevron-left|arrow-left|chevron\.left|arrow_back", e["iconHint"] + " " + e["cls"], re.I))


def f_back(d):
    return next((i for i in d.top_bar() if visible_back(d, i)), None)


def f_popup(d):
    for i, e in enumerate(d.els):
        if e["haspopup"] or e["role"] in ("menu", "listbox"):
            return i
    return None


def f_dialog(d):
    for i, e in enumerate(d.els):
        if e["role"] in ("dialog", "alertdialog") or e["tag"] == "dialog":
            return i
    return None


def f_search(d):
    for i, e in enumerate(d.els):
        if e["type"] == "search" or e["role"] in ("searchbox", "search") or re.search(r"search", e["label"], re.I) and e["tag"] == "input":
            return i
    return None


# ---------------------------------------------------------------- evaluators
def ev_custom_tabs(sc, rule, p):
    if not sc.has_code:
        return None
    hits = sc.t("tabs.js", "tabs.custom")
    if not hits and not sc.t("tabs.native") and sc.stack == "swift":
        return None  # a hand-built SwiftUI tab bar is plain stacks of buttons: code can't tell it from no tab bar
    if not hits or sc.t("tabs.native"):
        return []
    kind = "JS tab bar" if sc.t("tabs.js") else "custom bottom <nav>"
    return [C(rule["id"], p, "fire", f"Top-level navigation is a {kind} ({loc(hits)}), not the system {'tab bar' if p == 'ios' else 'navigation bar'}.",
              anchor(sc, p, f_nav, "bottom-bar"), hits)]


def ev_tab_count(sc, rule, p):
    d = sc.doc(p)
    if not d:
        return None
    i, items = d.bottom_nav()
    if i is None:
        return []
    labels = [d.els[j]["label"] or "(icon)" for j in items]
    out = []
    if len(items) > 5:
        out.append(C(rule["id"], p, "fire", f"Tab bar shows {len(items)} items: {', '.join(labels)}.", d.el(i, "bottom-bar"), evidence=d.ev))
    acts = [j for j in items if CREATE.search(d.els[j]["label"])]
    if acts:
        out.append(C(rule["id"], p, "fire", f"Tab '{d.els[acts[0]]['label']}' performs an action rather than opening a destination.", d.el(acts[0], "bottom-bar"), evidence=d.ev))
    return out


def ev_search(sc, rule, p):
    hits = sc.t("search")
    d = sc.doc(p)
    i = f_search(d) if d else None
    if not hits and i is None:
        return [] if (sc.has_code or d) else None
    if any(NATIVE_SEARCH.search(h["text"]) for h in hits):
        return []
    el = d.el(i, "top-bar") if i is not None else {"label": "", "testID": "", "bbox": None, "zone": "top-bar"}
    return [C(rule["id"], p, "review", f"A search field is present ({loc(hits) if hits else 'seen in capture'}); is search a primary task on this screen?",
              el, hits, evidence="C" if hits else d.ev)]


def ev_drawer(sc, rule, p):
    hits = sc.t("drawer")
    if hits:
        return [C(rule["id"], p, "fire", f"A drawer / hamburger is used for navigation ({loc(hits)}).", anchor(sc, p, lambda d: next((i for i in d.top_bar() if re.search(r"menu", d.els[i]["label"], re.I)), None), "top-bar"), hits)]
    d = sc.doc(p)
    if d:
        for i in d.top_bar():
            if re.fullmatch(r"(open )?(main )?(menu|navigation)", d.els[i]["label"], re.I):
                return [C(rule["id"], p, "fire", f"Top bar control '{d.els[i]['label']}' opens a navigation menu.", d.el(i, "top-bar"), evidence=d.ev)]
    return [] if (sc.has_code or d) else None


def ev_back(sc, rule, p):
    if not sc.has_code:
        return None
    hits = sc.t("back.custom")
    inter = sc.t("back.intercept") if rule["id"] == "AND-NAV-04" else []
    if not hits and not inter:
        return []
    d = sc.doc(p)
    if d and hits and not inter and not any(visible_back(d, i) for i in d.top_bar()):
        return []  # back code lives in shared chrome but this screen renders no back control
    parts = []
    if hits:
        parts.append(f"a custom back control ({loc(hits)})")
    if inter:
        parts.append(f"JS back interception ({loc(inter)}) that can block predictive back")
    return [C(rule["id"], p, "fire", "Screen uses " + " and ".join(parts) + ".", anchor(sc, p, f_back, "top-bar"), hits + inter)]


def ev_header_opaque(sc, rule, p):
    if not sc.has_code:
        return None
    hits = sc.t("header.opaque")
    return [C(rule["id"], p, "fire", f"Top bar has an opaque background ({loc(hits)}), blocking glass and the scroll edge effect.", anchor(sc, p, lambda d: None, "top-bar"), hits)] if hits else []


def ev_toolbar(sc, rule, p):
    d = sc.doc(p)
    out = []
    if d:
        tb = [i for i in d.top_bar() if d.els[i]["bbox"][0] + d.els[i]["bbox"][2] / 2 > d.vw / 2]
        if len(tb) > 3:
            out.append(C(rule["id"], p, "fire", f"{len(tb)} trailing top-bar actions are visible: {', '.join(d.els[i]['label'] or '(icon)' for i in tb)}.",
                         {"label": d.els[tb[0]]["label"], "testID": d.els[tb[0]]["testID"], "bbox": union([d.els[i]["bbox"] for i in tb]), "zone": "top-bar"}, evidence=d.ev))
    hits = sc.t("toolbar.many")
    if hits and not out:
        out.append(C(rule["id"], p, "fire", f"Header declares {hits[0].get('count', '4+')} actions ({loc(hits)}).", anchor(sc, p, lambda d: None, "top-bar"), hits))
    if not d and not sc.has_code:
        return None
    return out


def ev_ellipsis_ios(sc, rule, p):
    hits = sc.t("ellipsis.horizontal", "ellipsis.vertical")
    if not sc.has_code:
        return None
    return [C(rule["id"], p, "review", f"An ellipsis control is present ({loc(hits)}); does it open overflow, or a single action?", anchor(sc, p, f_popup, "top-bar"), hits)] if hits else []


def ev_glass_nested(sc, rule, p):
    d = sc.doc(p)
    if not d:
        return None
    inner = [i for i, e in enumerate(d.els) if e["backdrop"] and any(d.els[a]["backdrop"] for a in d.ancestors(i))]
    if not inner:
        return []
    return [C(rule["id"], p, "fire", f"{len(inner)} glass/blur layer(s) sit inside another glass layer (e.g. '{d.els[inner[0]]['label'] or d.els[inner[0]]['tag']}').",
              d.el(inner[0], "overlay"), evidence=d.ev, related=[d.els[i]["bbox"] for i in inner[1:12]])]


def ev_glass_content(sc, rule, p):
    d = sc.doc(p)
    if not d:
        return None
    chrome_roles = {"navigation", "tablist", "dialog", "alertdialog", "toolbar", "banner", "menu", "search"}
    content = [i for i, e in enumerate(d.els) if e["backdrop"] and not e["interactive"] and not e["fixedAncestor"]
               and e["tag"] not in ("nav", "header", "dialog", "footer") and e["role"] not in chrome_roles
               and e["bbox"][2] * e["bbox"][3] > 4000
               and not any(d.els[a]["tag"] in ("nav", "header", "dialog") or d.els[a]["role"] in chrome_roles for a in d.ancestors(i))]
    if not content:
        return []
    return [C(rule["id"], p, "review", f"{len(content)} blurred/glass surface(s) in the content layer (first: {d.els[content[0]]['bbox'][2]}x{d.els[content[0]]['bbox'][3]}). Is this a card or row?",
              d.el(content[0], "content"), evidence=d.ev, related=[d.els[i]["bbox"] for i in content[1:12]])]


def ev_primary_in_menu(sc, rule, p):
    d = sc.doc(p)
    tops = [i for i in d.top_bar() if d.els[i]["haspopup"]] if d else []
    hits = sc.t("ellipsis.horizontal", "ellipsis.vertical") if not tops else []
    if not tops and not hits:
        return [] if (d or sc.has_code) else None
    el = d.el(tops[0], "top-bar") if tops else anchor(sc, p, f_popup, "top-bar")
    return [C(rule["id"], p, "review", "A menu trigger sits in the top bar; does it hide a primary action of this view?", el, hits, evidence=d.ev if tops else "C")]


def ev_custom_menu(sc, rule, p):
    if not sc.has_code:
        return None
    hits = sc.t("menu.custom")
    if not hits or sc.t("menu.native"):
        return []
    return [C(rule["id"], p, "fire", f"Menus/popovers are custom JS ({loc(hits)}), not the platform menu.", anchor(sc, p, f_popup, "overlay"), hits)]


def ev_choice_state(sc, rule, p):
    d = sc.doc(p)
    if not d:
        return None
    out = []
    for i, e in enumerate(d.els):
        if e["role"] in ("radiogroup", "tablist", "listbox"):
            opts = [j for j in d.desc(i) if d.els[j]["interactive"]]
            if len(opts) >= 2 and not any(d.els[j]["state"] for j in opts):
                out.append(C(rule["id"], p, "fire", f"A {e['role']} of {len(opts)} options exposes no selected state ({', '.join(d.els[j]['label'] or '(icon)' for j in opts[:5])}).",
                             d.el(i, "content"), evidence=d.ev))
    return out[:1] if out else []


def ev_longpress(sc, rule, p):
    if not sc.has_code:
        return None
    hits = sc.t("longpress")
    return [C(rule["id"], p, "review", f"Long-press / context-menu handlers exist ({loc(hits)}); does every command also have a visible path?", anchor(sc, p, lambda d: None, "content"), hits)] if hits else []


def ev_destructive(sc, rule, p):
    d = sc.doc(p)
    cand = [i for i in d.interactive() if DESTRUCTIVE.search(d.els[i]["label"])] if d else []
    hits = sc.t("destructive")
    if not cand and not hits:
        return [] if (d or sc.has_code) else None
    roles = sc.t("destructive.role", "dialog.native")
    el = d.el(cand[0], "content") if cand else anchor(sc, p, lambda d: None, "overlay")
    what = f"'{d.els[cand[0]]['label']}'" if cand else f"destructive copy ({loc(hits)})"
    return [C(rule["id"], p, "review", f"Destructive action {what} present; destructive role/confirmation in code: {'yes (' + loc(roles) + ')' if roles else 'none found'}.",
              el, hits + roles, evidence=d.ev if cand else "C")]


def ev_sheet(sc, rule, p):
    if not sc.has_code:
        return None
    hits = sc.t("sheet.custom")
    if not hits and sc.stack == "swift":
        return None  # a hand-built SwiftUI sheet is an offset view with a drag gesture: code can't tell it apart
    if not hits or sc.t("sheet.native"):
        return []
    extra = "" if rule["id"] != "AND-SHT-01" else (" A drag handle is drawn." if sc.t("sheet.handle") else " No drag handle found.")
    return [C(rule["id"], p, "fire", f"Bottom sheets are custom ({loc(hits)}), not the system sheet.{extra}", anchor(sc, p, f_dialog, "overlay"), hits)]


def ev_unsafe(sc, rule, p):
    d = sc.doc(p)
    if not d:
        return None
    top, bottom = 59, 34
    bad = [i for i in d.interactive() if not d.els[i]["inText"] and d.els[i]["bbox"][2] >= 4 and d.els[i]["bbox"][3] >= 4
           and (d.els[i]["bbox"][1] < top or d.els[i]["bbox"][1] + d.els[i]["bbox"][3] > d.vh - bottom)
           and d.els[i]["bbox"][1] + d.els[i]["bbox"][3] > 0 and d.els[i]["bbox"][1] < d.vh]
    if not bad:
        return []
    handled = sc.t("safearea")
    verdict = "review" if (handled and d.ev == "W") else "fire"
    note = (f" The code pads with safe-area insets ({loc(handled, 2)}), which a desktop web render reports as 0, so confirm on a device."
            if verdict == "review" else "")
    return [C(rule["id"], p, verdict, f"{len(bad)} control(s) overlap the status bar / Dynamic Island or home-indicator zone (e.g. '{d.els[bad[0]]['label'] or d.els[bad[0]]['tag']}').{note}",
              d.el(bad[0], "overlay"), handled, evidence=d.ev, related=[d.els[i]["bbox"] for i in bad[1:12]])]


def ev_fixed_font(sc, rule, p):
    if not sc.has_code:
        return None
    hits = sc.t("fontsize.fixed")
    return [C(rule["id"], p, "fire", f"{len(hits)}{'+' if len(hits) >= 12 else ''} fixed font size(s) that won't follow Dynamic Type ({loc(hits)}).", anchor(sc, p, lambda d: None, "content"), hits)] if hits else []


def ev_icons(sc, rule, p):
    """Icon rules are about SYSTEM CHROME: read only files that draw chrome (tab bar, back, config'd shell)."""
    if not sc.has_code:
        return None
    chrome = set(sc.s["chrome"]) | {h["file"] for h in sc.t("tabs.js", "tabs.custom", "tabs.native", "back.custom", "drawer")}
    only = lambda hits: [h for h in hits if h["file"] in chrome]
    gen, sf, md, br = only(sc.t("icons.generic")), only(sc.t("icons.sf")), only(sc.t("icons.material")), sc.t("platform.branch")
    rid = rule["id"]
    if rid == "IOS-ICN-01" and gen and not sf:
        return [C(rid, p, "fire", f"Chrome icons come from a generic set ({loc(gen)}), not SF Symbols.", anchor(sc, p, f_nav, "bottom-bar"), gen)]
    if rid == "AND-ICN-01" and sf and not md and not br:
        return [C(rid, p, "fire", f"SF Symbols are used with no Material Symbols mapping ({loc(sf)}).", anchor(sc, p, f_nav, "bottom-bar"), sf)]
    if rid == "X-PAR-04" and gen and not sf and not md:
        return [C(rid, p, "fire", f"One icon set serves both platforms' chrome ({loc(gen)}).", anchor(sc, p, f_nav, "bottom-bar"), gen)]
    return []


def ev_targets(sc, rule, p):
    d = sc.doc(p)
    if not d:
        return None
    m = 44 if p == "ios" else 48
    inter = set(d.interactive())
    bad = [i for i in sorted(inter, key=lambda i: (d.els[i]["bbox"][1], d.els[i]["bbox"][0]))
           if not d.els[i]["inText"] and d.els[i]["bbox"][2] >= 4 and d.els[i]["bbox"][3] >= 4
           and (d.els[i]["bbox"][2] < m or d.els[i]["bbox"][3] < m)
           and not any(a in inter for a in d.ancestors(i))]
    if not bad:
        return []
    eg = "; ".join(f"'{d.els[i]['label'] or d.els[i]['tag']}' {d.els[i]['bbox'][2]}x{d.els[i]['bbox'][3]}" for i in bad[:4])
    return [C(rule["id"], p, "fire", f"{len(bad)} control(s) under {m}x{m}: {eg}{' …' if len(bad) > 4 else ''}.", d.el(bad[0], "content"),
              evidence=d.ev, related=[d.els[i]["bbox"] for i in bad[1:12]])]


def ev_nav_height(sc, rule, p):
    d = sc.doc(p)
    if not d:
        return None
    i, _ = d.bottom_nav()
    if i is not None and d.els[i]["bbox"][3] >= 76:
        return [C(rule["id"], p, "fire", f"Bottom navigation is {d.els[i]['bbox'][3]}dp tall; the flexible bar is 64dp.", d.el(i, "bottom-bar"), evidence=d.ev)]
    return []


def ev_rail(sc, rule, p):
    if not sc.has_code:
        return None
    has_nav = sc.t("tabs.js", "tabs.custom", "tabs.native") or (sc.doc(p) and sc.doc(p).bottom_nav()[0] is not None)
    if not has_nav or sc.t("rail"):
        return []
    return [C(rule["id"], p, "fire", "Bottom navigation has no rail or window-size adaptation for 600dp+ widths.", anchor(sc, p, f_nav, "bottom-bar"), sc.t("tabs.js", "tabs.custom", "tabs.native"))]


def ev_text_buttons(sc, rule, p):
    d = sc.doc(p)
    if not d:
        return None
    tb = [i for i in d.top_bar() if TEXT_BTN.fullmatch(d.els[i]["label"])]
    return [C(rule["id"], p, "fire", f"Top bar uses iOS-style text buttons: {', '.join(d.els[i]['label'] for i in tb)}.", d.el(tb[0], "top-bar"), evidence=d.ev)] if tb else []


def ev_edge(sc, rule, p, project_tags):
    hits = project_tags.get("edge.optout", [])
    return [C(rule["id"], p, "fire", f"Edge-to-edge is opted out or insets are unhandled ({loc(hits)}).", {"label": "", "testID": "", "bbox": None, "zone": "overlay"}, hits)] if hits else []


def ev_actionsheet(sc, rule, p):
    if not sc.has_code:
        return None
    hits = sc.t("actionsheet")
    if not hits or sc.t("platform.branch"):
        return []
    return [C(rule["id"], p, "fire", f"An iOS-style action sheet is shown on Android too ({loc(hits)}).", anchor(sc, p, f_dialog, "overlay"), hits)]


def ev_ellipsis_android(sc, rule, p):
    if not sc.has_code:
        return None
    hits = sc.t("ellipsis.horizontal")
    if not hits or sc.t("ellipsis.vertical") or sc.t("platform.branch"):
        return []
    return [C(rule["id"], p, "fire", f"Overflow uses a horizontal ellipsis on Android ({loc(hits)}).", anchor(sc, p, f_popup, "top-bar"), hits)]


def ev_fab(sc, rule, p):
    d = sc.doc(p)
    dom = [i for i in d.interactive() if CREATE.search(d.els[i]["label"])] if d else []
    hits = sc.t("create")
    if (not dom and not hits) or sc.t("fab"):
        return [] if (d or sc.has_code) else None
    el = d.el(dom[0], "content") if dom else anchor(sc, p, lambda d: None, "bottom-bar")
    return [C(rule["id"], p, "review", f"A create action is present ({'“' + d.els[dom[0]]['label'] + '”' if dom else loc(hits)}) with no FAB; is creation the primary task here?",
              el, hits, evidence=d.ev if dom else "C")]


def ev_dyn(sc, rule, p):
    if not sc.has_code:
        return None
    has_nav = sc.t("tabs.js", "tabs.custom", "tabs.native")
    return [C(rule["id"], p, "fire", "System chrome uses fixed colors; no dynamic color source found.", anchor(sc, p, f_nav, "bottom-bar"), has_nav)] if has_nav and not sc.t("dynamic.color") else []


def ev_controls(sc, rule, p):
    if not sc.has_code:
        return None
    hits = sc.t("switch.custom", "segmented", "picker.wheel")
    if not hits or sc.t("platform.branch"):
        return []
    return [C(rule["id"], p, "fire", f"iOS-style control(s) render on Android too ({loc(hits)}).", anchor(sc, p, lambda d: next((i for i, e in enumerate(d.els) if e["role"] == "switch"), None), "content"), hits)]


def ev_same_chrome(sc, rule, p):
    if not sc.has_code:
        return None
    if sc.t("platform.branch"):
        return []
    tabs, back = sc.t("tabs.js", "tabs.custom"), sc.t("back.custom")
    if tabs and not sc.t("tabs.native"):
        return [C(rule["id"], p, "fire", f"The same custom tab bar renders on iOS and Android ({loc(tabs)}); neither gets native chrome.", anchor(sc, p, f_nav, "bottom-bar"), tabs)]
    if back:
        return [C(rule["id"], p, "fire", f"The same custom header/back renders on both platforms ({loc(back)}).", anchor(sc, p, f_back, "top-bar"), back)]
    return []


def ev_no_branch(sc, rule, p):
    if not sc.has_code:
        return None
    if sc.t("platform.branch"):
        return []
    native_menu = {h["file"] for h in sc.t("menu.native")}
    keep = lambda k, h: not PLATFORM_FILE.search(h["file"]) and not (k == "menu.custom" and h["file"] in native_menu)
    custom = {k: [h for h in sc.t(k) if keep(k, h)] for k in ("tabs.js", "tabs.custom", "drawer", "menu.custom", "actionsheet", "sheet.custom")}
    custom = {k: v for k, v in custom.items() if v}
    if not custom:
        return []
    kinds = ", ".join(sorted(custom))
    hits = [h for k in sorted(custom) for h in custom[k]]
    return [C(rule["id"], p, "fire", f"Navigation/menu components ({kinds}) have no platform branch ({loc(hits)}).", {"label": "", "testID": "", "bbox": None, "zone": "overlay"}, hits)]


def ev_parity(sc, rule, p):
    out = []
    if sc.has_code:  # platform-only APIs with no guard: the action is missing (or throws) on the other platform
        guarded = {h["file"] for h in sc.t("platform.branch")}
        hits = [(h, other) for tag, other in (("ios.only", "Android"), ("android.only", "iOS")) for h in sc.t(tag)
                if h["file"] not in guarded and not PLATFORM_FILE.search(h["file"])]
        if hits:
            hs = [h for h, _ in hits]
            throws = " (ActionSheetIOS throws there)" if any("ActionSheetIOS" in h["text"] for h in hs) else ""
            out.append(C(rule["id"], p, "fire", f"Platform-only API with no platform guard ({loc(hs)}): the action is unreachable on {' and '.join(sorted({o for _, o in hits}))}{throws}.",
                         {"label": "", "testID": "", "bbox": None, "zone": "content"}, hs))
    a, b = sc.doc("ios"), sc.doc("android")
    if not a or not b:
        return out if sc.has_code else None
    if a.ev == "W" and b.ev == "W" and not sc.t("platform.branch"):
        return out  # one web codebase with no platform branch: any capture difference is a viewport artifact
    # Pinned chrome always counts; scrolling content only inside the frame both viewports show
    # (a taller or wider screen is not a platform difference).
    mw, mh = min(a.vw, b.vw), min(a.vh, b.vh)
    def inside(d, e):
        x, y, w, h = e["bbox"]
        bottom_chrome = y >= d.vh - 130 and y + h <= d.vh
        return e["fixedAncestor"] or bottom_chrome or (x >= 0 and y >= 0 and x + w <= mw and y + h <= mh - 130)
    lab = lambda d: {re.sub(r"\s+", " ", d.els[i]["label"].lower()).strip() for i in d.interactive() if d.els[i]["label"].strip() and inside(d, d.els[i])}
    only_i, only_a = sorted(lab(a) - lab(b)), sorted(lab(b) - lab(a))
    if not only_i and not only_a:
        return out
    parts = ([f"iOS only: {', '.join(only_i[:6])}"] if only_i else []) + ([f"Android only: {', '.join(only_a[:6])}"] if only_a else [])
    return out + [C(rule["id"], p, "fire", "Actions differ between platforms. " + "; ".join(parts) + ".", {"label": (only_i or only_a)[0], "testID": "", "bbox": None, "zone": "content"}, evidence=a.ev)]


def ev_custom_alert(sc, rule, p):
    if not sc.has_code:
        return None
    dlg, conf = sc.t("dialog.custom"), sc.t("confirm.text")
    if not dlg or not conf or sc.t("dialog.native"):
        return []
    return [C(rule["id"], p, "fire", f"Confirmations use a custom modal ({loc(dlg + conf)}), not the platform alert/dialog.", anchor(sc, p, f_dialog, "overlay"), dlg + conf)]


EVAL = {
    "IOS-NAV-01": ev_custom_tabs, "IOS-NAV-02": ev_tab_count, "IOS-NAV-03": ev_search, "IOS-NAV-04": ev_drawer, "IOS-NAV-05": ev_back,
    "IOS-BAR-01": ev_header_opaque, "IOS-BAR-02": ev_toolbar, "IOS-BAR-03": ev_ellipsis_ios,
    "IOS-GLS-01": ev_glass_nested, "IOS-GLS-02": ev_glass_content, "IOS-GLS-03": None,
    "IOS-MNU-01": ev_primary_in_menu, "IOS-MNU-02": None, "IOS-MNU-03": ev_custom_menu, "IOS-MNU-04": ev_choice_state,
    "IOS-MNU-05": ev_longpress, "IOS-MNU-06": ev_destructive, "IOS-SHT-01": ev_sheet, "IOS-LAY-01": ev_unsafe,
    "IOS-TYP-01": ev_fixed_font, "IOS-ICN-01": ev_icons, "IOS-TGT-01": ev_targets,
    "AND-NAV-01": ev_custom_tabs, "AND-NAV-02": ev_nav_height, "AND-NAV-03": ev_rail, "AND-NAV-04": ev_back, "AND-NAV-05": ev_drawer,
    "AND-BAR-01": ev_toolbar, "AND-BAR-02": ev_text_buttons, "AND-EDG-01": ev_edge, "AND-MNU-01": ev_actionsheet,
    "AND-MNU-02": ev_custom_menu, "AND-MNU-03": ev_ellipsis_android, "AND-MNU-04": ev_choice_state, "AND-MNU-05": ev_fab,
    "AND-SRC-01": ev_search, "AND-DYN-01": ev_dyn, "AND-ICN-01": ev_icons, "AND-CTL-01": ev_controls, "AND-SHT-01": ev_sheet,
    "AND-TGT-01": ev_targets, "X-PAR-01": ev_same_chrome, "X-PAR-02": ev_no_branch, "X-PAR-03": ev_parity,
    "X-PAR-04": ev_icons, "X-PAR-05": ev_custom_alert,
}
DEVICE_ONLY = {"IOS-GLS-03": "needs device renders at both Liquid Glass intensity extremes + Reduce Transparency (Phase 3)",
               "IOS-MNU-02": "needs open-menu captures to count items (Phase 2)"}


# ---------------------------------------------------------------- menu treatment table
def menu_rows(sc, matrix, fired, pending):
    d = sc.doc("ios") or sc.doc("android")
    rows = []

    def row(key, today):
        m = next(r for r in matrix if r["key"] == key)
        status = "diverges" if set(m["rules"]) & fired else "needs judgment" if set(m["rules"]) & pending else "aligned"
        rows.append({"key": key, "intent": m["intent"], "today": today, "status": status, "ios": m["ios"], "android": m["android"],
                     "implementation": m["rnExpo"], "rules": sorted(set(m["rules"]) & (fired | pending))})

    nav_i, items = d.bottom_nav() if d else (None, [])
    if sc.t("tabs.native"):
        row("destinations", "System tabs (" + sc.t("tabs.native")[0]["text"][:60] + ")")
    elif sc.t("tabs.js", "tabs.custom") or nav_i is not None:
        kind = "JS tab bar" if sc.t("tabs.js") else "Custom bottom nav"
        labels = ", ".join(d.els[j]["label"] or "(icon)" for j in items) if items else ""
        row("destinations", f"{kind}" + (f", {len(items)} items: {labels}" if items else ""))
    if sc.t("drawer"):
        row("destinations", "Drawer / hamburger") if not any(r["key"] == "destinations" for r in rows) else None
    tb = [i for i in d.top_bar() if d.els[i]["bbox"][0] > d.vw * 0.25] if d else []
    if tb or sc.t("toolbar.many"):
        row("secondary", f"{len(tb)} top-bar control(s): " + ", ".join(d.els[i]["label"] or "(icon)" for i in tb) if tb else "Header actions declared in code")
    if sc.t("ellipsis.horizontal", "ellipsis.vertical"):
        row("overflow", ("Horizontal ellipsis" if sc.t("ellipsis.horizontal") else "Vertical ellipsis") + f" ({loc(sc.t('ellipsis.horizontal', 'ellipsis.vertical'), 1)})")
    if sc.t("longpress"):
        row("per-item", f"Long-press / context menu ({loc(sc.t('longpress'), 1)})")
    groups = [e for e in (d.els if d else []) if e["role"] in ("radiogroup", "tablist", "listbox")]
    if sc.t("segmented", "picker.wheel", "select") or groups:
        what = [k for k in ("segmented", "picker.wheel", "select") if sc.t(k)] + sorted({e["role"] for e in groups})
        row("choose-one", "Choice control: " + ", ".join(dict.fromkeys(what)))
    creates = [i for i in d.interactive() if CREATE.search(d.els[i]["label"])] if d else []
    if sc.t("fab"):
        row("create", "FAB / split button")
    elif creates or sc.t("create"):
        row("create", f"“{d.els[creates[0]]['label']}” button" if creates else f"Add/new control ({loc(sc.t('create'), 1)})")
    dest = [i for i in d.interactive() if DESTRUCTIVE.search(d.els[i]["label"])] if d else []
    if dest or sc.t("destructive"):
        row("destructive", f"“{d.els[dest[0]]['label']}”" if dest else f"Destructive copy ({loc(sc.t('destructive'), 1)})")
    if sc.t("sheet.custom", "sheet.native", "actionsheet"):
        row("rich", "System sheet" if sc.t("sheet.native") else "Custom bottom sheet" if sc.t("sheet.custom") else "Action sheet")
    if sc.t("search") or (d and f_search(d) is not None):
        row("search", "Search field")
    acct = [i for i in (d.interactive() if d else []) if re.search(r"\b(account|profile|avatar|sign in)\b", d.els[i]["label"], re.I)
            and (i in items or d.els[i]["bbox"][1] < 110)]
    if acct:
        row("account", f"“{d.els[acct[0]]['label']}” in {'the tab bar' if acct[0] in items else 'the top bar'}")
    return rows


# ---------------------------------------------------------------- main
def implementation(rule, stack, project, snippets, cfg):
    key = STACK_IMPL_KEY.get(stack, "rn-expo")
    one_liner = rule["implementation"].get(key) or rule["implementation"].get("rn-expo")
    sn = snippets.get(rule["id"], {}).get(stack)
    out = {"stack": stack}
    if stack == "web":
        tgt = cfg.get("targetStack", "rn-expo")
        out["nativeTarget"] = f"{tgt}: {rule['implementation'].get(STACK_IMPL_KEY.get(tgt, tgt), '')}"
    if not sn:
        out.update({"snippet": one_liner, "apiVerified": None})
        return out
    ok, missing = verify(project, stack, sn.get("requires"))
    if ok is False:
        out.update({"snippet": f"// Requires upgrade: {sn.get('upgrade', 'a newer version')}\n// Not in installed deps: {', '.join(missing)}\n// Then: {one_liner}",
                    "apiVerified": False, "requiresUpgrade": sn.get("upgrade", "")})
    else:
        out.update({"snippet": sn["code"], "apiVerified": ok})
    if sn.get("note"):
        out["note"] = sn["note"]
    return out


def main(run_dir):
    run = Path(run_dir)
    cfg = run_config(run)
    pre = load(run / "preflight.json")
    inv = load(run / "inventory.json")
    static = load(run / "static.json", {})
    catalog = rules()
    snippets = load(REF / "snippets.json", {})
    project = Path(cfg["_project"])
    stack = cfg["stack"]
    appearance = (cfg.get("appearance") or ["light"])[0]
    jfile = load(Path(cfg["_outRoot"]) / "judgments.json", {"judgments": {}, "observations": []})
    judgments = jfile.get("judgments", {})
    brand = set(cfg.get("brandExceptions", []))

    screens = []
    for s in inv:
        docs = {}
        for p in PLATFORMS:
            d = load(run / "elements" / f"{s['slug']}__{p}__{appearance}.json")
            if d:
                docs[p] = Doc(d)
        screens.append(Screen(s, static, docs, stack))
    available = {"C"} | {d.ev for sc in screens for d in sc.docs.values()}

    cands, appendix = [], {"evaluated": [], "passed": [], "skipped": [], "notApplicable": []}
    for rule in catalog["rules"]:
        rid = rule["id"]
        if rule.get("status") == "retired":
            continue
        if rule.get("stacks") and stack not in rule["stacks"]:
            appendix["notApplicable"].append({"ruleId": rid, "reason": f"not applicable to stack '{stack}'"})
            continue
        if not pre.get("hasAndroid", True) and rule["platform"] in ("android", "cross"):
            appendix["notApplicable"].append({"ruleId": rid, "reason": "No Android target detected"})
            continue
        if rid in DEVICE_ONLY:
            appendix["skipped"].append({"ruleId": rid, "reason": DEVICE_ONLY[rid]})
            continue
        if not set(rule["evidenceRequired"]) & available:
            appendix["skipped"].append({"ruleId": rid, "reason": f"requires {'/'.join(rule['evidenceRequired'])} evidence, only {'/'.join(sorted(available))} available"})
            continue
        fn, n_eval, got = EVAL[rid], 0, []
        for sc in screens:
            for p in plat_of(rule):
                res = ev_edge(sc, rule, p, static.get("_project", {})) if fn is ev_edge else fn(sc, rule, p)
                if res is None:
                    continue
                n_eval += 1
                for c in res:
                    if c["evidence"] not in rule["evidenceRequired"] and not (c["evidence"] == "W" and "C" in rule["evidenceRequired"] and c["locations"]):
                        continue
                    c["screen"] = sc.slug
                    got.append(c)
        if fn is ev_edge:  # project-level: report once, on the first screen
            got = got[:1]
        if n_eval == 0:
            appendix["skipped"].append({"ruleId": rid, "reason": "no screen had the evidence this rule needs (no source mapping or no capture)"})
            continue
        appendix["evaluated"].append({"ruleId": rid, "screens": n_eval // len(plat_of(rule)) if plat_of(rule) else n_eval})
        if not got:
            appendix["passed"].append(rid)
        cands += [(rule, c) for c in got]

    # Code findings whose evidence is identical on several screens come from shared chrome:
    # report them once (first screen in inventory order) with the other screens in alsoOn.
    order = {sc.slug: n for n, sc in enumerate(screens)}
    groups = {}
    for rule, c in cands:
        if c["verdict"] in ("fire", "review") and c["evidence"] == "C" and c["locations"]:
            groups.setdefault((rule["id"], c["platform"], c["current"]), []).append(c)
    shared = {}
    for g in groups.values():
        if len(g) > 1:
            g.sort(key=lambda c: order[c["screen"]])
            g[0]["alsoOn"] = [c["screen"] for c in g[1:]]
            for c in g[1:]:
                c["verdict"] = "shared"
                shared.setdefault(c["screen"], []).append((c["ruleId"], g[0]["screen"]))

    findings = {sc.slug: [] for sc in screens}
    manual, accepted, cand_out, seen = [], [], [], {}
    for rule, c in cands:
        if c["verdict"] == "shared":
            continue
        el = c["element"] or {"label": "", "testID": "", "bbox": None, "zone": rule["zone"]}
        fid = f"{rule['id']}__{c['screen']}__{hash4(el.get('testID') or el.get('label') or el.get('zone'))}"
        if fid in seen:  # same rule, screen, element: merge evidence
            seen[fid]["locations"] += [l for l in c["locations"] if l not in seen[fid]["locations"]]
            continue
        eh = hash_obj({"current": c["current"], "locations": c["locations"], "el": [el.get("label"), el.get("bbox")]})
        cand_out.append({"findingId": fid, "ruleId": rule["id"], "screen": c["screen"], "platform": c["platform"], "verdict": c["verdict"], "evidenceHash": eh, "current": c["current"]})
        verdict, current, note = c["verdict"], c["current"], ""
        if verdict == "review":
            j = judgments.get(fid)
            if j and j.get("evidenceHash") == eh:
                verdict, note = j["verdict"], j.get("note", "")
                current = j.get("current") or current
            else:
                verdict, note = "manual", "needs judgment"
            if verdict == "pass":
                continue
        item = {"findingId": fid, "ruleId": rule["id"], "title": rule["title"], "screen": c["screen"], "platform": c["platform"],
                "severity": rule["severity"], "evidence": c["evidence"], "element": {**el, "related": c["related"]} if c["related"] else el,
                "current": current, "locations": c["locations"]}
        if c.get("alsoOn"):
            item["alsoOn"] = c["alsoOn"]
        seen[fid] = item
        if verdict == "manual":
            manual.append({**item, "status": note or "judged manual", "question": c["current"] if c["verdict"] == "review" else ""})
            continue
        item.update({"recommended": rule["recommendation"], "implementation": implementation(rule, stack, project, snippets, cfg),
                     "source": rule["source"]})
        if f"{rule['id']}@{c['screen']}" in brand or f"{rule['id']}@*" in brand:
            accepted.append(item)
        else:
            findings[c["screen"]].append(item)
    for o in jfile.get("observations", []):
        manual.append({"findingId": f"OBS__{o['screen']}__{hash4(o['note'])}", "ruleId": None, "title": "Observation (no matching rule)",
                       "screen": o["screen"], "platform": o.get("platform", "both"), "severity": None,
                       "evidence": o["evidence"] if o.get("evidence") in available else "C",  # never claim a render this run didn't have
                       "element": {"label": "", "testID": "", "bbox": None, "zone": o.get("zone", "content")}, "current": o["note"],
                       "locations": [], "status": "observation", "question": ""})

    key = lambda f: (SEV_ORDER.get(f["severity"], 9), f["ruleId"] or "", f["platform"], f["findingId"])
    out_screens, summary = [], {}
    for sc in screens:
        fs = sorted(findings[sc.slug], key=key)
        for n, f in enumerate(fs, 1):
            f["pin"] = n
            summary.setdefault(f["platform"], {}).setdefault(f["severity"], 0)
            summary[f["platform"]][f["severity"]] += 1
        fired = {f["ruleId"] for f in fs} | {r for r, _ in shared.get(sc.slug, [])}
        pending = {m["ruleId"] for m in manual if m["screen"] == sc.slug and m["ruleId"]}
        out_screens.append({"slug": sc.slug, "route": sc.s["route"], "url": sc.s["url"], "title": sc.s["title"], "tab": sc.s["tab"],
                            "captures": {p: (f"{sc.slug}__{p}__{appearance}.png" if p in sc.docs else None) for p in PLATFORMS},
                            "captureEvidence": {p: sc.docs[p].ev for p in sc.docs},
                            "sources": sc.s["sources"], "findings": fs,
                            "sharedFindings": sorted({f"{r} (see {first})" for r, first in shared.get(sc.slug, [])}),
                            "menu": menu_rows(sc, catalog["menuMatrix"], fired, pending)})
    manual.sort(key=lambda m: ([s["slug"] for s in inv].index(m["screen"]) if m["screen"] in [s["slug"] for s in inv] else 999, m["ruleId"] or "~", m["findingId"]))
    accepted.sort(key=key)
    appendix["passed"] = [r for r in appendix["passed"] if not any(m["ruleId"] == r for m in manual)]
    result = {
        "schema": 1, "app": cfg.get("app"), "commit": pre["commit"], "stack": stack, "catalogVersion": catalog["catalogVersion"],
        "evidenceAvailable": sorted(available), "captureModes": pre["modes"], "skippedModes": pre["skippedModes"],
        "devices": cfg.get("devices", {}), "appearance": appearance, "summary": summary,
        "screens": out_screens, "manualReview": manual, "accepted": accepted, "appendix": appendix,
    }
    dump(run / "findings.json", result)
    dump(run / "candidates.json", sorted(cand_out, key=lambda c: c["findingId"]))
    total = sum(len(s["findings"]) for s in out_screens)
    print(f"evaluate: {total} findings, {len(manual)} for manual review, {len(accepted)} accepted, "
          f"{len(appendix['skipped'])} rules skipped")


if __name__ == "__main__":
    main(sys.argv[1])
