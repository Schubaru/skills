#!/usr/bin/env python3
"""Normalize element frames from every capture source into one schema.

raw/{base}.json               (DOM, capture_web.mjs)        -> evidence W
raw/{base}.uiautomator.xml    (adb uiautomator dump)        -> evidence V
raw/{base}.maestro.json       (maestro hierarchy)           -> evidence V
-> elements/{base}.json  {evidence, platform, viewport, imageSize, elements[]}
Bboxes are integers in logical units (CSS px / pt / dp), [x, y, w, h].
"""
import json, re, struct, sys
import xml.etree.ElementTree as ET
from pathlib import Path
from _common import dump, run_config

KEYS = ("tag", "role", "label", "testID", "bbox", "interactive", "parent", "position", "fixedAncestor",
        "backdrop", "bgAlpha", "fontPx", "inText", "haspopup", "state", "type", "iconOnly", "iconHint", "cls")


def png_size(p):
    try:
        with open(p, "rb") as f:
            head = f.read(24)
        return list(struct.unpack(">II", head[16:24]))
    except Exception:
        return None


def norm(e):
    out = {k: e.get(k) for k in KEYS}
    out["bbox"] = [int(round(v)) for v in e["bbox"]]
    out["label"] = (e.get("label") or "")[:80]
    out["bgAlpha"] = round(float(e.get("bgAlpha") or 0), 2)
    out["fontPx"] = round(float(e.get("fontPx") or 0), 1)
    out["state"] = {k: v for k, v in sorted((e.get("state") or {}).items()) if v is not None}
    for k in ("role", "testID", "position", "fixedAncestor", "backdrop", "haspopup", "type", "iconHint", "cls", "tag"):
        out[k] = out[k] or ""
    for k in ("interactive", "inText", "iconOnly"):
        out[k] = bool(out[k])
    if out["parent"] is None:
        out["parent"] = -1
    return out


def from_uiautomator(xml_text, density):
    root = ET.fromstring(xml_text)
    els, stack = [], []

    def visit(node, parent):
        b = re.findall(r"\d+", node.get("bounds", "") or "")
        idx = parent
        if len(b) == 4:
            x1, y1, x2, y2 = (int(v) / density for v in b)
            clickable = node.get("clickable") == "true" or node.get("long-clickable") == "true"
            cls = node.get("class", "")
            if (x2 - x1) >= 1 and (y2 - y1) >= 1:
                idx = len(els)
                els.append({"tag": cls.split(".")[-1].lower(), "role": "", "label": node.get("content-desc") or node.get("text") or "",
                            "testID": node.get("resource-id", ""), "bbox": [x1, y1, x2 - x1, y2 - y1], "interactive": clickable,
                            "parent": parent, "state": {"checked": node.get("checked") if node.get("checkable") == "true" else None,
                                                        "selected": node.get("selected") if node.get("selected") == "true" else None},
                            "cls": cls})
        for ch in node:
            visit(ch, idx)
    visit(root, -1)
    return els


def from_maestro(data):
    els = []

    def visit(n, parent):
        a = n.get("attributes", {})
        b = re.findall(r"\d+", a.get("bounds", "") or "")
        idx = parent
        if len(b) == 4:
            x1, y1, x2, y2 = map(int, b)
            if x2 > x1 and y2 > y1:
                idx = len(els)
                els.append({"tag": "", "role": "", "label": a.get("accessibilityText") or a.get("text") or "",
                            "testID": a.get("resource-id", ""), "bbox": [x1, y1, x2 - x1, y2 - y1],
                            "interactive": a.get("clickable") == "true" or bool(a.get("accessibilityText")) and a.get("enabled") == "true",
                            "parent": parent, "state": {"selected": a.get("selected")}, "cls": ""})
        for ch in n.get("children", []):
            visit(ch, idx)
    visit(data, -1)
    return els


def main(run_dir):
    run = Path(run_dir)
    cfg = run_config(run)
    density = float(cfg.get("native", {}).get("android", {}).get("density", 2.625))
    out_dir = run / "elements"
    n = 0
    for f in sorted((run / "raw").glob("*")) if (run / "raw").exists() else []:
        name = f.name
        if name.endswith(".uiautomator.xml"):
            base, els, ev = name[: -len(".uiautomator.xml")], from_uiautomator(f.read_text(errors="ignore"), density), "V"
        elif name.endswith(".maestro.json"):
            base, els, ev = name[: -len(".maestro.json")], from_maestro(json.loads(f.read_text() or "{}")), "V"
        elif name.endswith(".json"):
            d = json.loads(f.read_text())
            base, els, ev = name[:-5], d["elements"], "W"
        else:
            continue
        slug, platform, appearance = base.split("__")
        elements = [norm(e) for e in els]
        img = png_size(run / "screenshots" / f"{base}.png")
        if ev == "W":
            vp = [int(v) for v in d["viewport"]]
        else:
            root = max(elements, key=lambda e: e["bbox"][2] * e["bbox"][3], default={"bbox": [0, 0, 0, 0]})
            vp = [root["bbox"][2], root["bbox"][3]]
        dump(out_dir / f"{base}.json", {"evidence": ev, "platform": platform, "appearance": appearance, "slug": slug,
                                         "viewport": vp, "imageSize": img, "elements": elements})
        n += 1
    print(f"hierarchy: {n} element dumps normalized")


if __name__ == "__main__":
    main(sys.argv[1])
