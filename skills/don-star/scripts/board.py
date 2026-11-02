#!/usr/bin/env python3
"""Read and edit a review-board.json safely (the agent side of the review loop).

Usage:
  board.py list    [--all] [--events] [--file review-board.json]
  board.py show    <thread-id> [--file ...]
  board.py reply   <thread-id> --body "text" [--author /skill] [--resolve] [--file ...]
                   [--command harden] [--files a.tsx,b.css] [--verified "how you checked"]
  board.py resolve <thread-id> [--file ...]
  board.py reopen  <thread-id> [--file ...]

Guarantees the loop's invariants: threads are never deleted, existing ids and
timestamps are never touched, replies get fresh ids, output is 2-space indented
with a trailing newline (same as the dev server writes, so diffs stay clean).
Thread ids can be abbreviated to any unique prefix.

Reply as the SKILL that did the work, not as the model running it: an author
starting with "/" renders on the board as an agent (its own avatar, monospace
name, tinted pin), so a reviewer can tell at a glance who changed what. Pass
--author /norm-dog when another skill did the work; the default names this one.
The optional --command/--files/--verified become the reply's provenance byline,
which is what lets a reviewer find the context a change was made in.
"""

import argparse
import json
import random
import string
import sys
import time
from pathlib import Path


def load(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1 or not isinstance(data.get("comments"), list):
        print(f"error: {path} is not a version-1 review board", file=sys.stderr)
        raise SystemExit(1)
    return data


def save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def uid() -> str:
    alphabet = string.ascii_lowercase + string.digits
    base36 = ""
    n = int(time.time() * 1000)
    while n:
        n, r = divmod(n, 36)
        base36 = alphabet[r] + base36
    return base36 + "".join(random.choices(alphabet, k=6))


def find(data: dict, tid: str) -> dict:
    hits = [t for t in data["comments"] if t["id"] == tid] or [
        t for t in data["comments"] if t["id"].startswith(tid)
    ]
    if len(hits) != 1:
        kind = "no thread matches" if not hits else "ambiguous prefix"
        print(f"error: {kind} '{tid}'", file=sys.stderr)
        raise SystemExit(1)
    return hits[0]


def is_event(t: dict) -> bool:
    """Events (the reviewer's documentation of emails, webhooks, notes) are stored
    as threads carrying meta.docKind. They are not asking for a change, so they
    stay out of the working list unless asked for."""
    return bool((t.get("meta") or {}).get("docKind"))


def where(t: dict) -> str:
    a = t["anchor"]
    if a["type"] == "screen":
        return f'{a["screenId"]} @ ({round(a["dx"])},{round(a["dy"])})'
    return f'board page {a.get("pageId", "?")} @ ({round(a["x"])},{round(a["y"])})'


def meta_suffix(node: dict) -> str:
    """Compact provenance, so a prior agent pass is legible when you read history."""
    m = node.get("meta") or {}
    bits = [m["command"]] if m.get("command") else []
    bits += m.get("files", [])
    return f' ({" · ".join(bits)})' if bits else ""


def print_thread(t: dict, verbose: bool = False) -> None:
    kind = (t.get("meta") or {}).get("docKind")
    flag = kind.upper() if kind else ("resolved" if t["resolved"] else "OPEN")
    img = " [image]" if t.get("image") else ""
    print(f'{t["id"]}  [{flag}]  {where(t)}')
    print(f'  {t["author"]}: {t["body"]}{img}')
    for r in t["replies"]:
        rimg = " [image]" if r.get("image") else ""
        body = r["body"] if verbose or len(r["body"]) <= 120 else r["body"][:117] + "..."
        print(f'    ↳ {r["author"]}{meta_suffix(r)}: {body}{rimg}')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["list", "show", "reply", "resolve", "reopen"])
    ap.add_argument("thread", nargs="?", help="thread id (unique prefix ok)")
    ap.add_argument("--file", default="review-board.json", type=Path)
    ap.add_argument("--all", action="store_true", help="list: include resolved threads")
    ap.add_argument("--events", action="store_true", help="list: show the events layer instead of comments")
    ap.add_argument("--body", help="reply: the reply text")
    ap.add_argument("--author", default="/don-star", help="reply: '/skill-name' renders as an agent")
    ap.add_argument("--resolve", action="store_true", help="reply: also mark resolved")
    # dest must not be "command" — that's the positional, and argparse would
    # overwrite it, making `reply --command x` fall through to the resolve branch.
    ap.add_argument("--command", dest="meta_command", help="reply meta: the command you ran, e.g. 'harden'")
    ap.add_argument("--files", help="reply meta: comma-separated files you touched")
    ap.add_argument("--verified", help="reply meta: how you checked it works")
    args = ap.parse_args()

    data = load(args.file)

    if args.command == "list":
        pool = [t for t in data["comments"] if is_event(t) == args.events]
        threads = pool if args.all else [t for t in pool if not t["resolved"]]
        if not threads:
            noun = "events" if args.events else "threads"
            print(f"No open {noun}." if not args.all else f"No {noun}.")
            return 0
        for t in threads:
            print_thread(t)
        n_open = sum(1 for t in pool if not t["resolved"])
        print(f"\n{n_open} open / {len(pool)} total")
        return 0

    if not args.thread:
        print("error: thread id required", file=sys.stderr)
        return 1
    t = find(data, args.thread)

    if args.command == "show":
        print_thread(t, verbose=True)
        return 0

    if args.command == "reply":
        if not args.body:
            print("error: --body required", file=sys.stderr)
            return 1
        reply = {"id": uid(), "author": args.author, "body": args.body, "at": int(time.time() * 1000)}
        # Provenance is optional: a human replying via this script has none, and an
        # empty meta object would render an empty byline, so only attach what's given.
        meta = {}
        if args.meta_command:
            meta["command"] = args.meta_command
        if args.files:
            meta["files"] = [f.strip() for f in args.files.split(",") if f.strip()]
        if args.verified:
            meta["verified"] = args.verified
        if meta:
            reply["meta"] = meta
        t["replies"].append(reply)
        if args.resolve:
            t["resolved"] = True
        save(args.file, data)
        print(f'Replied to {t["id"]}' + (" and resolved" if args.resolve else ""))
        return 0

    t["resolved"] = args.command == "resolve"
    save(args.file, data)
    print(f'{t["id"]} {"resolved" if t["resolved"] else "reopened"}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
