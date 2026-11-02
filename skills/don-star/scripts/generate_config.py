#!/usr/bin/env python3
"""Generate src/review/review.config.tsx from a folder of screen images.

Usage: generate_config.py <app-dir> --slug <slug> [--name "Project name"] [--page-title "..."] [--force]

For the things that genuinely ARE pictures (design exports, a competitor's
app, a site you can't run). Runs against the same embedded install: put the
images in <app-dir>/public/screens and the board serves them as `image`
screens beside any live `url` ones. --slug must match the registry entry in
src/review/projects.ts (comments key off it).

Convention: images in <app-dir>/public/screens named <flow>-<NN>-<name>.<ext>
group into flows by prefix and order by NN. Files that don't match the
convention become one screen each in a "misc" flow, ordered by filename.

Frame sizes come from each image's aspect ratio (sniffed from the file, no
dependencies): landscape/square frames are 960 wide, portrait frames are 844
tall. That normalizes retina captures to sensible board sizes.
"""

import argparse
import json
import re
import struct
import sys
from pathlib import Path

EXTS = {".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif"}


def image_size(path: Path) -> tuple[int, int] | None:
    """Width/height for png, jpeg, gif, webp, svg. None when unknown."""
    data = path.read_bytes()
    if data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) >= 24:
        w, h = struct.unpack(">II", data[16:24])
        return w, h
    if data[:2] == b"\xff\xd8":  # JPEG: scan for a SOF marker
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack(">HH", data[i + 5 : i + 9])
                return w, h
            i += 2 + struct.unpack(">H", data[i + 2 : i + 4])[0]
        return None
    if data[:6] in (b"GIF87a", b"GIF89a"):
        w, h = struct.unpack("<HH", data[6:10])
        return w, h
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        chunk = data[12:16]
        if chunk == b"VP8X":
            w = int.from_bytes(data[24:27], "little") + 1
            h = int.from_bytes(data[27:30], "little") + 1
            return w, h
        if chunk == b"VP8L":
            bits = int.from_bytes(data[21:25], "little")
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if chunk == b"VP8 ":
            w, h = struct.unpack("<HH", data[26:30])
            return w & 0x3FFF, h & 0x3FFF
        return None
    if b"<svg" in data[:1024]:
        head = data[: data.find(b">", data.find(b"<svg")) + 1].decode("utf-8", "replace")
        def attr(name: str) -> float | None:
            m = re.search(rf'{name}="([\d.]+)', head)
            return float(m.group(1)) if m else None
        w, h = attr("width"), attr("height")
        if w and h:
            return int(w), int(h)
        m = re.search(r'viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"', head)
        if m:
            return int(float(m.group(1))), int(float(m.group(2)))
    return None


def frame_size(px: tuple[int, int] | None) -> tuple[int, int]:
    """Board frame size: always viewport-proportioned, never page-shaped.

    A frame simulates the user's browser/device viewport; content taller than
    the frame scrolls inside it (the harness handles this). Sizing frames from
    a full-page capture's aspect ratio produces unusable skinny strips in
    slides view, so only the ORIENTATION of the capture is consulted:
    mobile-ish portrait → 390x844 phone frame, everything else → 960x600.
    """
    if px and px[0] > 0 and px[1] > 0:
        ratio = px[0] / px[1]
        if 0.35 <= ratio <= 0.65:  # phone-shaped capture (not a tall full-page desktop scroll)
            return 390, 844
    return 960, 600


def title_case(slug: str) -> str:
    return re.sub(r"[-_]+", " ", slug).strip().capitalize()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("host", help="app directory (contains public/screens and src/review)")
    ap.add_argument("--slug", required=True, help="the project slug from src/review/projects.ts")
    ap.add_argument("--name", default="Design review")
    ap.add_argument("--page-title", default="Core flows")
    ap.add_argument("--force", action="store_true", help="overwrite an existing review.config.tsx")
    args = ap.parse_args()

    host = Path(args.host)
    screens_dir = host / "public" / "screens"
    out = host / "src" / "review" / "review.config.tsx"
    if not screens_dir.is_dir():
        print(f"error: {screens_dir} not found", file=sys.stderr)
        return 1
    if out.exists() and not args.force:
        print(f"error: {out} exists (use --force to overwrite)", file=sys.stderr)
        return 1

    images = sorted(p for p in screens_dir.iterdir() if p.suffix.lower() in EXTS)
    if not images:
        print(f"error: no images in {screens_dir}", file=sys.stderr)
        return 1

    pat = re.compile(r"^(?P<flow>.+?)-(?P<n>\d+)-(?P<name>.+)$")
    flows: dict[str, list[dict]] = {}
    for img in images:
        stem = img.stem
        m = pat.match(stem)
        flow_id = m.group("flow") if m else "misc"
        title = title_case(m.group("name")) if m else title_case(stem)
        w, h = frame_size(image_size(img))
        flows.setdefault(flow_id, []).append(
            {"id": stem, "title": title, "w": w, "h": h, "src": f"/screens/{img.name}"}
        )

    ids = [s["id"] for shots in flows.values() for s in shots]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        print(f"error: duplicate screen ids: {sorted(dupes)}", file=sys.stderr)
        return 1

    def screen_line(s: dict) -> str:
        return (
            f'            {{ id: {json.dumps(s["id"])}, title: {json.dumps(s["title"])}, '
            f'w: {s["w"]}, h: {s["h"]}, source: {{ kind: "image", src: {json.dumps(s["src"])} }} }},'
        )

    flow_blocks = []
    for flow_id, shots in flows.items():
        lines = "\n".join(screen_line(s) for s in shots)
        flow_blocks.append(
            f"""        {{
          id: {json.dumps(flow_id)},
          title: {json.dumps(title_case(flow_id))},
          screens: [
{lines}
          ],
        }},"""
        )

    config = f"""// Generated by don-star/scripts/generate_config.py — edit freely, it's
// yours now (rerun with --force only if you want to regenerate from filenames).
// Screen ids must stay unique and stable: comments anchor to them.

import type {{ ReviewProject }} from "./model";

export const project: ReviewProject = {{
  name: {json.dumps(args.name)},
  // Pinned once: every comment, status and cache entry keys off it.
  slug: {json.dumps(args.slug)},
  screen: {{ w: 960, h: 600 }},
  pages: [
    {{
      id: "main",
      title: {json.dumps(args.page_title)},
      flows: [
{chr(10).join(flow_blocks)}
      ],
    }},
  ],
}};
"""
    out.write_text(config, encoding="utf-8")
    n = sum(len(s) for s in flows.values())
    print(f"Wrote {out} — {len(flows)} flows, {n} screens:")
    for flow_id, shots in flows.items():
        print(f"  {flow_id}: " + ", ".join(f'{s["id"]} ({s["w"]}x{s["h"]})' for s in shots))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
