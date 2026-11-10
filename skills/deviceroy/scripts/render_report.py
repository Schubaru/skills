#!/usr/bin/env python3
"""Step 7. findings.json -> report-ios.html + report-android.html. No model-written markup.

One page per platform, organized by screen, in plain language (references/plain-copy.json).
Design lives in assets/report-template.html; this script only fills it. Deterministic: the same
run folder, judgments and config give byte-identical pages. Self-contained: screenshots are
inlined as PNG data URIs and only decoded when their section opens.

When the run has before/after frames (proto/shots.json, from capture_after.mjs) the page gains
a Prototype tab: each screen in a device frame, today's design beside the same screen with the
listed fixes applied. plan() writes what capture_after.mjs needs: the problems listed per
screen, in the report's own order, so the two tabs can never disagree.

The page is authored for the Artifact tool (no doctype/html/body; its own <title> first), and
still opens locally because it declares its charset.

usage: render_report.py <runDir> [--platform ios|android|both]
"""
import argparse, base64, html, json, re, struct, sys
from datetime import date
from pathlib import Path
from _common import ASSETS, PLATFORMS, REF, dump, load, rules

E = html.escape
SEV = {"P1": ("bad", "Fix first"), "P2": ("mid", "Fix soon"), "P3": ("info", "Nice to fix")}
ORDER = {"P1": 0, "P2": 1, "P3": 2}
PHONE = {"ios": "iPhone", "android": "Android phone"}
BUILD = {"ios": ["rn-expo", "swiftui"], "android": ["rn-expo"]}
BUILD_LABEL = {"rn-expo": "React Native", "swiftui": "SwiftUI", "flutter": "Flutter", "web": "Web prototype"}
ANDROID_VERSION = {35: "15", 36: "16", 37: "17"}
TODAY = {  # scripted menu-row text -> plain words
    "Custom bottom sheet": "Custom pop-up panel", "System sheet": "System sheet", "Action sheet": "An action sheet",
    "Horizontal ellipsis": "A “…” button", "Vertical ellipsis": "A ⋮ button", "Add/new control": "An add button",
    "Search field": "A search field in the page", "Drawer / hamburger": "A hamburger menu", "FAB / split button": "A floating add button",
    "Header actions declared in code": "Top-bar buttons set in code", "Destructive copy": "A button that ends or deletes something",
    "Long-press / context menu": "A press-and-hold menu",
}
VIEW = {"ios": (393, 852), "android": (412, 915)}  # the web capture viewports (capture_web.mjs, capture_after.mjs)
# ponytail: the frames ride inline as base64, so one page tops out near 60 screens; publish them as
# separate files (the Artifact tool's `files`) if audits ever outgrow this.
PAGE_LIMIT = 15 * 1024 * 1024  # the Artifact tool refuses pages over 16 MB
CHOICE = {"select": "A dropdown list", "segmented": "A segmented control", "picker.wheel": "A scrolling picker wheel",
          "radiogroup": "A group of choices", "tablist": "A row of tabs", "listbox": "A list of choices"}


def mine(rule_id, platform):
    """Rules that belong on a platform's page: its own plus the cross-platform ones."""
    return rule_id.startswith("X-") or rule_id.startswith("IOS-" if platform == "ios" else "AND-")


def unref(t):
    """Drop code references such as (src/x.tsx:12, ...) from a sentence."""
    t = re.sub(r"\s*\([^()]*(?:\.[jt]sx?|\.dart|\.swift|src/)[^()]*(?:\([^()]*\)[^()]*)*\)", "", t or "")
    return re.sub(r"\s+", " ", t).strip()


def join(names):
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]


def png_size(path):
    with open(path, "rb") as fh:
        head = fh.read(24)
    return struct.unpack(">II", head[16:24])


def pill(sev):
    cls, word = SEV[sev]
    return f"<span class='pill {cls}'>{word}</span>"


class Page:
    def __init__(self, run, platform):
        self.run, self.p = Path(run), platform
        self.f = load(self.run / "findings.json")
        self.meta = load(self.run / "run.json", {})
        cfg = load(self.run / "config.json", {})
        home = load(Path(cfg.get("_outRoot", "")) / "config.json", {}) if cfg.get("_outRoot") else {}
        self.report = {**cfg.get("report", {}), **home.get("report", {})}  # the home config's names win
        self.cat = rules()
        self.copy = load(REF / "plain-copy.json")
        self.sev = {r["id"]: r["severity"] for r in self.cat["rules"]}
        self.impl = {r["id"]: r["implementation"] for r in self.cat["rules"]}
        self.matrix = {m["key"]: m for m in self.cat["menuMatrix"]}
        j = load(Path(cfg["_outRoot"]) / "judgments.json", {}) if cfg.get("_outRoot") else {}
        cands = {c["findingId"]: c for c in load(self.run / "candidates.json", [])}
        # A pass recorded with --absent means the flagged thing is not on the screen at all.
        self.absent = {(fid.split("__")[0], fid.split("__")[1]) for fid, v in (j or {}).get("judgments", {}).items()
                       if v.get("verdict") == "pass" and v.get("absent") and fid in cands and cands[fid]["evidenceHash"] == v["evidenceHash"]}
        self.screens = self.f["screens"]
        self.by = {s["slug"]: s for s in self.screens}
        self.names = {}
        for i, e in enumerate(self.report.get("screens", [])):
            for s in self.screens:
                if e.get("route") in (s["route"], s["url"].split("?")[0], s["url"]):
                    self.names[s["slug"]] = (i, e.get("name") or self.fallback(s), e.get("state"))

    # ---------------------------------------------------------------- naming
    def fallback(self, s):
        segs = [x for x in s["route"].split("?")[0].strip("/").split("/") if x and not x.startswith((":", "[", "("))]
        return segs[-1].replace("-", " ").replace("_", " ").capitalize() if segs else "Home"

    def name(self, slug):
        return self.names.get(slug, (0, self.fallback(self.by[slug]), None))[1]

    def ordered(self):
        idx = {s["slug"]: n for n, s in enumerate(self.screens)}
        key = lambda s: (0, self.names[s["slug"]][0]) if s["slug"] in self.names else (1, idx[s["slug"]])
        return sorted(self.screens, key=key)

    # ---------------------------------------------------------------- what is listed where
    def groups(self):
        screens = self.ordered()
        groups = [("Tabs", [s for s in screens if s["tab"]]), ("Other screens", [s for s in screens if not s["tab"]])]
        return groups if groups[0][1] else [("Screens", screens)]

    def shared_map(self):
        """Problems written up on one screen that also apply to others: {slug: [(finding, source slug)]}."""
        shared = {}
        for s in self.screens:
            for f in s["findings"]:
                if mine(f["ruleId"], self.p):
                    for other in f.get("alsoOn", []):
                        shared.setdefault(other, []).append((f, s["slug"]))
        return shared

    def listed(self, s, shared):
        """A screen's own problems (numbered 1..n on the page), then the shared ones."""
        own = sorted((f for f in s["findings"] if mine(f["ruleId"], self.p)), key=lambda f: (ORDER[f["severity"]], f["ruleId"], f["findingId"]))
        sh = sorted(shared.get(s["slug"], []), key=lambda x: (ORDER[x[0]["severity"]], x[0]["ruleId"]))
        return own, sh

    # ---------------------------------------------------------------- per-finding words
    def rule_copy(self, rid):
        c = self.copy["rules"].get(rid)
        if c:
            return c
        r = next(x for x in self.cat["rules"] if x["id"] == rid)
        return {"title": r["title"], "why": "", "fix": r["recommendation"], "passed": r["title"]}

    def tabbar(self, slug):
        row = next((m for m in self.by[slug]["menu"] if m["key"] == "destinations"), None)
        m = re.search(r"items: (.+)$", row["today"]) if row else None
        return f"The bottom tab bar ({m.group(1)}) is custom." if m else "The bottom tab bar is custom."

    def detail(self, f):
        """What is happening on this screen, in plain words. Judged findings carry their own plain sentence."""
        r, cur, el = f["ruleId"], f["current"], f.get("element") or {}
        if r in ("IOS-TGT-01", "AND-TGT-01"):
            items = re.findall(r"'([^']+)' (\d+)x(\d+)", cur)
            n = int(re.match(r"(\d+)", cur).group(1))
            size = "44 by 44 points" if r.startswith("IOS") else "48 by 48 dp"
            names = list(dict.fromkeys(f"the {a[:-4]} logo" if a.endswith(".com") else a for a, _, _ in items[:4]))  # "acme.com" is the logo link
            if not names:
                return f"{n} buttons are smaller than {size}."
            return (f"{n} buttons are smaller than {size}, including {join(names)}." if n > len(names)
                    else f"{n} buttons are smaller than {size}: {join(names)}.")
        if r == "IOS-TYP-01":
            n = re.match(r"(\d+\+?)", cur).group(1).replace("+", " or more")
            return f"{n} text styles on this screen use a fixed size."
        if r in ("IOS-NAV-05", "AND-NAV-04"):
            return f"The back button (“{el['label']}”) is custom." if el.get("label") else "The back button is custom."
        if r == "IOS-SHT-01":
            return "The panels that slide up on this screen are custom."
        if r == "AND-SHT-01":
            return "The panels that slide up on this screen are custom" + (" and have no drag handle." if "drag handle" in cur else ".")
        if r == "X-PAR-02":
            kinds = re.search(r"\(([^)]*)\) have no platform branch", cur)
            parts = {"tabs.custom": "tab bar", "tabs.js": "tab bar", "drawer": "side menu", "back.custom": "back button",
                     "sheet.custom": "pop-up panels", "actionsheet": "action sheets", "menu.custom": "menus"}
            found = {parts[k.strip()] for k in kinds.group(1).split(",") if k.strip() in parts} if kinds else set()
            got = [g for g in dict.fromkeys(parts.values()) if g in found]  # fixed order: tab bar first
            verb = "have" if len(got) > 1 or (got and got[0].endswith("s")) else "has"
            return f"The {join(got)} {verb} one version for both phones." if got else "Navigation parts have one version for both phones."
        if r in ("IOS-ICN-01", "X-PAR-04"):
            lucide = any("lucide" in (l.get("text") or "") for l in f.get("locations", []))
            return "The icons in the tab bar and top bar come from a general icon set" + (" (Lucide)." if lucide else ".")
        if r in ("IOS-NAV-01", "AND-NAV-01"):
            return self.tabbar(f["screen"])
        if r == "X-PAR-01":
            return self.tabbar(f["screen"]) if "tab bar" in cur else "The same custom top bar and back button show on both phones."
        if r == "IOS-BAR-01":
            return f"The {self.name(f['screen'])} top bar has a solid background."
        if r in ("IOS-MNU-03", "AND-MNU-02"):
            return "The menus on this screen are custom."
        if r == "AND-MNU-03":
            return "The “more” button uses a sideways “…”."
        if r == "AND-CTL-01":
            return "An iPhone-style control, like a switch or a segmented control, also shows on Android."
        if r == "AND-MNU-01":
            return "An iPhone-style action sheet also shows on Android."
        if r == "AND-NAV-02":
            h = re.search(r"is (\d+)dp tall", cur)
            return f"The bottom bar is {h.group(1)} dp tall. The newer, shorter bar is 64 dp." if h else unref(cur)
        if r == "AND-NAV-03":
            return "There is no side rail or wider layout for tablets and foldables."
        if r in ("AND-NAV-05", "IOS-NAV-04"):
            return "A hamburger menu is the main way to get around."
        if r == "AND-BAR-02":
            m = re.search(r": (.+)\.$", cur)
            return f"The top bar uses word buttons: {m.group(1)}." if m else unref(cur)
        if r == "AND-EDG-01":
            return "The app doesn't draw behind the system bars, or doesn't pad for them."
        if r == "AND-DYN-01":
            return "The bars use fixed brand colors, not the phone's colors."
        if r == "AND-ICN-01":
            return "Icons use Apple's SF Symbols with no Android version."
        if r == "X-PAR-05":
            return "Confirmations use a custom pop-up, not the phone's own dialog."
        return unref(cur)

    def build_with(self, rid):
        i = self.impl[rid]
        keys = self.report.get("buildWith", {}).get(self.p, BUILD[self.p])
        rows = []
        for k in keys:
            v = i.get(k, "")
            if k == "swiftui" and v in ("", "n/a"):
                v = "Not needed. SwiftUI only runs on Apple devices."
            if v:
                rows.append(f"<div><b>{BUILD_LABEL.get(k, k)}</b><span>{E(v)}</span></div>")
        return f"<div class='build'>{''.join(rows)}</div>" if rows else ""

    def problem(self, f, n):
        c = self.rule_copy(f["ruleId"])
        num = f"<span class='num'>{n}</span>"
        code = (f.get("implementation") or {}).get("snippet", "")
        return (f"<li class='prob' id='{E(f['findingId'])}'><div class='ph'>{num}{pill(f['severity'])}<span class='pt'>{E(c['title'])}</span></div>"
                f"<dl><dt>On this screen</dt><dd>{E(self.detail(f))}</dd>"
                + (f"<dt>Why it matters</dt><dd>{E(c['why'])}</dd>" if c.get("why") else "")
                + f"<dt>How to fix</dt><dd>{E(c['fix'])}{self.build_with(f['ruleId'])}"
                + (f"<details class='code'><summary>Code example for the web prototype</summary><pre><code>{E(code)}</code></pre></details>" if "\n" in code else "")
                + "</dd></dl></li>")

    def shared_problem(self, f, src):
        c = self.rule_copy(f["ruleId"])
        return (f"<li class='prob shared'><div class='ph'>{pill(f['severity'])}<span class='pt'>{E(c['title'])}</span></div>"
                f"<p class='muted'>Same problem as on <a href='#s-{src}'>{E(self.name(src))}</a>. The fix there covers this screen.</p></li>")

    def ask(self, m):
        if not m["ruleId"]:
            return (f"<li class='prob ask'><div class='ph'><span class='pill plain'>Note</span><span class='pt'>Something to look at</span></div>"
                    f"<p>{E(unref(m['current']))}</p></li>")
        c = self.rule_copy(m["ruleId"])
        label = (m.get("element") or {}).get("label")
        about = f" It's about “{label}”." if label else ""
        return (f"<li class='prob ask'><div class='ph'><span class='pill plain'>Check by hand</span><span class='pt'>{E(c['title'])}</span></div>"
                f"<p>{E(c.get('ask') or unref(m.get('question') or m['current']))}{E(about)}</p></li>")

    # ---------------------------------------------------------------- per-screen parts
    def today(self, m):
        t = unref(m["today"])
        t = re.sub(r"^(?:Custom bottom nav|JS tab bar), (\d+) items:", r"Custom tab bar with \1 tabs:", t)
        t = re.sub(r"^(?:Custom bottom nav|JS tab bar)$", "Custom tab bar", t)
        t = re.sub(r"^(\d+) top-bar control\(s\):", r"\1 buttons in the top bar:", t)
        t = re.sub(r"^System tabs.*", "System tab bar", t)
        if t.startswith("Choice control: "):
            got = [CHOICE.get(x.strip(), x.strip()) for x in t[len("Choice control: "):].split(",")]
            t = got[0] if len(got) == 1 else join(got)
        return TODAY.get(t, t)

    def menu(self, s, here, pending):
        rows = []
        for m in s["menu"]:
            rs = [r for r in self.matrix[m["key"]]["rules"] if mine(r, self.p)]
            differs = any(r in here for r in rs)
            if not differs and any((r, s["slug"]) in self.absent for r in rs):
                continue  # judged not on this screen at all
            status = ("<span class='pill mid'>Differs</span>" if differs else
                      "<span class='pill plain'>Check by hand</span>" if any(r in pending for r in rs) else
                      "<span class='pill good'>Matches</span>")
            mc = self.copy["menu"][m["key"]]
            rows.append(f"<tr><td>{E(mc['name'])}</td><td>{E(self.today(m))}</td><td>{E(mc[self.p])}</td><td>{status}</td></tr>")
        if not rows:
            return ""
        return ("<details class='sub'><summary>Menus and controls</summary><div class='tw'><table><thead><tr><th>What it's for</th>"
                f"<th>What's there now</th><th>What {'iPhone' if self.p == 'ios' else 'Android'} expects</th><th>Result</th></tr></thead><tbody>"
                + "".join(rows) + "</tbody></table></div></details>")

    def shot(self, s, marks):
        name = (s.get("captures") or {}).get(self.p)
        path = self.run / "screenshots" / name if name else None
        if not path or not path.exists():
            return ""
        w, h = png_size(path)
        b64 = base64.b64encode(path.read_bytes()).decode()
        dots = "".join(
            f"<span class='mk {SEV[sev][0]}' style='left:{x / w * 100:.2f}%;top:{y / h * 100:.2f}%;width:{bw / w * 100:.2f}%;height:{bh / h * 100:.2f}%'><i>{n}</i></span>"
            for n, sev, (x, y, bw, bh) in marks)
        return (f"<details class='sub shot'><summary>Screenshot</summary><div class='phone' style='aspect-ratio:{w}/{h}'>"
                f"<img alt='{E(self.name(s['slug']))} on {'iPhone' if self.p == 'ios' else 'Android'}' width='{w}' height='{h}' data-src='data:image/png;base64,{b64}'>{dots}</div>"
                + ("<p class='muted small'>Numbers match the problems above.</p>" if marks else "") + "</details>")

    # ---------------------------------------------------------------- the page
    def render(self):
        p = self.p
        shared = self.shared_map()
        manual = {}
        for m in self.f["manualReview"]:
            if m["platform"] in (p, "both") and (not m["ruleId"] or mine(m["ruleId"], p)):
                manual.setdefault(m["screen"], []).append(m)

        totals, per_rule, sections, n_manual = {k: 0 for k in SEV}, {}, [], 0
        for group, members in self.groups():
            if not members:
                continue
            sections.append(f"<h3 class='group'>{group}</h3>")
            for s in members:
                slug = s["slug"]
                own, sh = self.listed(s, shared)
                asks = manual.get(slug, [])
                n_manual += len(asks)
                here = {f["ruleId"] for f in own} | {f["ruleId"] for f, _ in sh}
                pending = {m["ruleId"] for m in asks if m["ruleId"]}
                counts = {k: 0 for k in SEV}
                for f in own:
                    counts[f["severity"]] += 1
                    totals[f["severity"]] += 1
                for f, _ in sh:
                    counts[f["severity"]] += 1
                for f in own + [x[0] for x in sh]:
                    per_rule.setdefault(f["ruleId"], set()).add(slug)
                items, marks = [], []
                for n, f in enumerate(own, 1):
                    items.append(self.problem(f, n))
                    bb = (f.get("element") or {}).get("bbox")
                    if bb:
                        marks.append((n, f["severity"], bb))
                items += [self.shared_problem(f, src) for f, src in sh]
                items += [self.ask(m) for m in asks]
                badge = "".join(f"<span class='cnt {SEV[k][0]}' title='{SEV[k][1]}'>{v}<span class='sr'> {SEV[k][1]}</span></span>" for k, v in counts.items() if v)
                if asks:
                    badge += f"<span class='cnt plain' title='Check by hand'>{len(asks)}<span class='sr'> Check by hand</span></span>"
                if not badge:
                    badge = "<span class='muted small'>No problems</span>"
                state = self.names.get(slug, (0, "", None))[2]
                body = f"<ol class='probs'>{''.join(items)}</ol>" if items else "<p class='muted'>Nothing to fix on this screen.</p>"
                sections.append(
                    f"<details class='screen' id='s-{slug}'><summary><span class='sn'>{E(self.name(slug))}</span>"
                    + (f"<span class='state'>{E(state)}</span>" if state else "")
                    + f"<span class='cnts'>{badge}</span></summary><div class='body'>"
                    f"<p class='route'><code>{E(s['url'].split('?')[0])}</code></p>{body}"
                    + self.menu(s, here, pending) + self.shot(s, marks) + "</div></details>")

        total = sum(totals.values())
        common = sorted(per_rule.items(), key=lambda kv: (ORDER[self.sev[kv[0]]], -len(kv[1])))
        common_rows = "".join(f"<tr><td>{pill(self.sev[r])}</td><td>{E(self.rule_copy(r)['title'])}</td><td class='n'>{len(sc)}</td></tr>" for r, sc in common)

        a = self.f["appendix"]
        skipped = {x["ruleId"] for x in a["skipped"]}
        na = {x["ruleId"] for x in a["notApplicable"]}
        evaluated = {x["ruleId"] for x in a["evaluated"]}
        pend_rules = {m["ruleId"] for ms in manual.values() for m in ms if m["ruleId"]}
        passed, dont, unchecked = [], [], []
        for r in self.cat["rules"]:
            rid = r["id"]
            if not mine(rid, p) or r.get("status") == "retired" or rid in per_rule:
                continue
            c = self.rule_copy(rid)
            if rid in skipped:
                why = self.copy["skipped"].get(rid, self.copy["skipped"]["_default"])
                unchecked.append(f"<li><span class='pill info'>Not checked</span>{E(c['passed'])}. <span class='muted'>{E(why)}</span></li>")
            elif rid in na:
                dont.append(f"<li><span class='pill plain'>Doesn't apply</span>{E(c['passed'])}</li>")
            elif rid in evaluated and rid not in pend_rules:
                passed.append(f"<li><span class='pill good'>Passed</span>{E(c['passed'])}</li>")
        works = passed + unchecked + dont
        kept = [x for x in self.f["accepted"] if mine(x["ruleId"], p)]
        works += [f"<li><span class='pill plain'>Kept on purpose</span>{E(self.rule_copy(x['ruleId'])['title'])} on {E(self.name(x['screen']))}</li>" for x in kept]

        return self.fill(total, totals, common_rows, n_manual, sections, works)

    # ---------------------------------------------------------------- the Prototype tab
    def proto(self):
        """(screens, frames) for the Prototype tab, or None when this platform has no before/after frames."""
        shots = load(self.run / "proto" / "shots.json", {})
        mine_, patched = shots.get(self.p) or {}, set((shots.get("patched") or {}).get(self.p, []))
        t, per = self.copy["prototype"], lambda v: v.get(self.p) if isinstance(v, dict) else v
        shared, screens, frames = self.shared_map(), [], {}
        for group, members in self.groups():
            for s in members:
                slug, e = s["slug"], mine_.get(s["slug"])
                files = [self.run / "proto" / f"{slug}__{self.p}__{side}.webp" for side in ("before", "after")]
                if not e or not e.get("ok") or not all(f.exists() for f in files):
                    continue
                own, sh = self.listed(s, shared)
                items = []
                for n, (f, src) in enumerate([(f, None) for f in own] + sh, 1):
                    rid, sev = f["ruleId"], SEV[f["severity"]]
                    c, r = self.rule_copy(rid), e["rules"].get(rid, {})
                    it = {"n": n, "ref": f["findingId"] if src is None else f"s-{src}", "level": sev[0], "levelName": sev[1],
                          "title": c["title"], "today": self.detail(f)}
                    after = per(c.get("after"))
                    if r.get("applied") and after:
                        if r.get("tight"):
                            after += t["tight"].replace("{n}", str(r["tight"]))
                        it.update(shown=True, change=after, b=r["before"], a=r["after"])
                        if "beforeAll" in r:
                            it.update(bAll=r["beforeAll"], aAll=r["afterAll"])
                    else:
                        it.update(shown=False, change=per(c.get("hidden")) or t["absent" if rid in patched else "none"])
                    items.append(it)
                screens.append({"slug": slug, "name": self.name(slug), "state": self.names.get(slug, (0, "", None))[2] or "",
                                "group": group, "edge": e["edge"], "items": items})
                frames[slug] = [base64.b64encode(f.read_bytes()).decode() for f in files]
        return (screens, frames) if screens else None

    def fill(self, total, totals, common_rows, n_manual, sections, works):
        p, dev = self.p, self.f.get("devices", {}).get(self.p, {})
        started = self.meta.get("startedAt", "")[:10]
        d = date.fromisoformat(started) if started else None
        when = f"{d:%B} {d.day}, {d.year}" if d else ""
        if p == "ios":
            device = f"{dev.get('model', 'iPhone')} on iOS {str(dev.get('os', '')).split('.')[0]}".strip()
            parts = "some native iPhone parts, like the glass tab bar"
        else:
            api = dev.get("api")
            device = f"{dev.get('model', 'Android phone')} on Android {ANDROID_VERSION.get(api, f'(API {api})')}"
            parts = "some native Android parts, like Material components"
        ev = {s.get("captureEvidence", {}).get(p) for s in self.screens}
        if "V" in ev:
            how = f"We used screenshots from the {'iPhone simulator' if p == 'ios' else 'Android emulator'}, plus the app's code."
        elif "W" in ev:
            how = (f"We used the web prototype at {PHONE[p]} size, plus its code. A web page can't show {parts}, "
                   f"so a few things still need a look on a real {PHONE[p]}.")
        else:
            how = f"We only had the code, with no screenshots, so some things still need a look on a real {PHONE[p]}."
        app = self.report.get("appName") or self.f.get("app") or "the app"
        short = self.report.get("name") or app
        n = len(self.screens)
        meta = " · ".join(x for x in (when, f"{n} screen{'s' if n != 1 else ''}", device) if x)
        summary = (f"<div class=\"counts\">"
                   f"<div>{pill('P1')}<b>{totals['P1']}</b><span class=\"muted small\">Breaks what {PHONE[p]} users expect, or blocks some people.</span></div>"
                   f"<div>{pill('P2')}<b>{totals['P2']}</b><span class=\"muted small\">Easy to notice, but doesn't block anyone.</span></div>"
                   f"<div>{pill('P3')}<b>{totals['P3']}</b><span class=\"muted small\">Small polish.</span></div></div>")
        lead = f"{total} problem{'' if total == 1 else 's'} in all. Problems that come from a shared part, like the tab bar, are counted once." if total else "No problems found."
        if total:
            summary += (f"<div class=\"tw\"><table><thead><tr><th>Level</th><th>Problem</th><th class=\"n\">Screens</th></tr></thead><tbody>{common_rows}</tbody></table></div>")
        if n_manual:
            summary += f"<p class=\"muted small\" style=\"margin-top:10px\">{n_manual} thing{'s' if n_manual != 1 else ''} still need{'' if n_manual != 1 else 's'} a check by hand. {'They are' if n_manual != 1 else 'It is'} listed on each screen.</p>"
        head = f"<h1>{'iPhone' if p == 'ios' else 'Android'} check: {E(app)}</h1>\n<p class=\"meta\">{E(meta)}</p>"
        body = (f"<p class=\"note sum\">{lead}</p>\n\n"
                f"<details class=\"sec\" open><summary><h2>Summary</h2></summary><div class=\"inner\">\n{summary}\n</div></details>\n\n"
                "<div class=\"tools\"><button type=\"button\" id=\"open-all\">Open all screens</button><button type=\"button\" id=\"close-all\">Close all</button></div>\n"
                + "".join(sections)
                + f"\n\n<details class=\"sec\"><summary><h2>What already works</h2></summary><div class=\"inner\">\n<ul class=\"checks\">{''.join(works)}</ul>\n</div></details>"
                f"\n<p class=\"foot muted small\">{E(how)}</p>")
        tpl = (ASSETS / "report-template.html").read_text()
        title = f"{short} {'iOS' if p == 'ios' else 'Android'} Audit"
        proto, t = self.proto(), self.copy["prototype"]
        js = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"), sort_keys=True).replace("</", "<\\/")
        if proto:
            phone = "iPhone" if p == "ios" else "Android"
            words = {**{k: t[k] for k in ("today", "change", "more", "door", "problem", "fix", "pos", "sum", "sumRest", "hintBoth", "hintTap", "hintClick", "hintPick")},
                     "before": [t["before"], t["beforeSub"]], "after": [t["after"], t["afterSub"]]}
            tpl = re.sub(r"<!-- /?(?:tabs|proto) -->\n?", "", tpl)
            for k, v in t.items():
                tpl = tpl.replace("{{P.%s}}" % k, E(v.replace("{phone}", phone)))
            tpl = (tpl.replace("{{REPORT_ATTRS}}", ' role="tabpanel" aria-labelledby="tab-report" tabindex="-1"')
                   .replace("{{PROTO_DATA}}", js({"os": p, "view": VIEW[p], "t": words, "screens": proto[0]}))
                   .replace("{{PROTO_IMG}}", js(proto[1])))
        else:
            tpl = re.sub(r"<!-- (tabs|proto) -->.*?<!-- /\1 -->\n?", "", tpl, flags=re.S).replace("{{REPORT_ATTRS}}", "")
        return tpl.replace("{{TITLE}}", E(title)).replace("{{HEAD}}", head).replace("{{BODY}}", body)


def plan(run_dir):
    """proto/plan.json for capture_after.mjs: per platform, the screens a web render exists for and the
    problems listed on each. A problem found on this platform's own capture carries its element frame
    (`box`) so the patch can find the same element again; the rest are found by role and geometry."""
    run, out = Path(run_dir), {}
    for p in PLATFORMS:
        page = Page(run, p)
        shared, rows = page.shared_map(), []
        for s in page.ordered():
            if s.get("captureEvidence", {}).get(p) != "W":
                continue  # only a web render can be patched
            own, sh = page.listed(s, shared)
            listed = [{"rule": f["ruleId"], "box": (f.get("element") or {}).get("bbox") if f.get("platform") == p else None} for f in own]
            listed += [{"rule": f["ruleId"], "box": None} for f, _ in sh]
            rows.append({"slug": s["slug"], "rules": listed})
        out[p] = rows
    dump(run / "proto" / "plan.json", out)
    print(f"plan: {sum(len(v) for v in out.values())} screen renders to mock up")


def main(run_dir, platform="both"):
    run = Path(run_dir)
    for p in (("ios", "android") if platform == "both" else (platform,)):
        out = run / f"report-{p}.html"
        out.write_text(Page(run, p).render())
        size = out.stat().st_size
        print(f"render: {out} ({size // 1024} KB)" + (" — over the 15 MB Artifact limit: narrow the scope, or set prototype.enabled to false" if size > PAGE_LIMIT else ""))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("--platform", choices=["ios", "android", "both"], default="both")
    a = ap.parse_args()
    main(a.run_dir, a.platform)
