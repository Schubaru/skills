#!/usr/bin/env python3
"""Draw numbered pins + boxes over each screenshot -> screenshots/{base}.annotated.svg.

SVG embeds the PNG (base64) and draws in the capture's logical units, so it needs no image
library and is byte-stable. Code findings with no element pin to their rule's fixed zone.
"""
import base64, sys
from pathlib import Path
from _common import load, run_config, zone_box

SEV = {"P1": "#d92d20", "P2": "#dc6803", "P3": "#1570ef"}


def svg(png, vw, vh, marks):
    b64 = base64.b64encode(png.read_bytes()).decode()
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {vw} {vh}" width="{vw}" height="{vh}">',
             f'<image href="data:image/png;base64,{b64}" x="0" y="0" width="{vw}" height="{vh}" preserveAspectRatio="none"/>']
    drawn, pins = set(), set()
    for m in marks:
        x, y, w, h = m["bbox"]
        c = SEV.get(m["sev"], "#475467")
        for rx, ry, rw, rh in m.get("related", []):
            parts.append(f'<rect x="{rx}" y="{ry}" width="{rw}" height="{rh}" fill="none" stroke="{c}" stroke-width="1.5" stroke-opacity="0.6" rx="4"/>')
        if (x, y, w, h) not in drawn:  # a zone shared by several findings is outlined once, never filled
            drawn.add((x, y, w, h))
            style = 'fill="none" stroke-dasharray="6 4" stroke-opacity="0.7"' if m["zone"] else f'fill="{c}" fill-opacity="0.08"'
            parts.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" {style} stroke="{c}" stroke-width="2" rx="6"/>')
        cx, cy = max(12, min(vw - 12, x + 12)), max(12, min(vh - 12, y + 12))
        while (cx, cy) in pins:  # pins on the same spot fan out to the right
            cx += 24
        pins.add((cx, cy))
        parts.append(f'<circle cx="{cx}" cy="{cy}" r="11" fill="{c}" stroke="#fff" stroke-width="2"/>')
        parts.append(f'<text x="{cx}" y="{cy + 4}" text-anchor="middle" font-family="-apple-system,system-ui,sans-serif" font-size="12" font-weight="700" fill="#fff">{m["pin"]}</text>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def main(run_dir):
    run = Path(run_dir)
    cfg = run_config(run)
    f = load(run / "findings.json")
    ap = f["appearance"]
    n = 0
    for s in f["screens"]:
        for p in ("ios", "android"):
            png = run / "screenshots" / f"{s['slug']}__{p}__{ap}.png"
            doc = load(run / "elements" / f"{s['slug']}__{p}__{ap}.json")
            if not png.exists() or not doc:
                continue
            vw, vh = doc["viewport"]
            marks = []
            for fd in s["findings"]:
                if fd["platform"] not in (p, "both"):
                    continue
                el = fd["element"]
                bbox, zone = el.get("bbox"), False
                if not bbox or (fd["platform"] == "both" and p == "android"):  # a "both" bbox is the iOS frame
                    bbox, zone = zone_box(el.get("zone") or "overlay", p), True
                rel = [] if zone else el.get("related", [])
                marks.append({"bbox": bbox, "pin": fd["pin"], "sev": fd["severity"], "zone": zone, "related": rel})
            (run / "screenshots" / f"{s['slug']}__{p}__{ap}.annotated.svg").write_text(svg(png, vw, vh, marks))
            n += 1
    print(f"annotate: {n} annotated screenshots")


if __name__ == "__main__":
    main(sys.argv[1])
