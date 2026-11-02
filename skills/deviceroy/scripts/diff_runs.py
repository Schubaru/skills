#!/usr/bin/env python3
"""New / resolved / unchanged findings vs the previous run -> <run>/diff.json.
The previous run is the latest sibling run dir (by name) that has a findings.json.
Kept out of findings.json on purpose: history must not change the findings themselves.
usage: diff_runs.py <runDir> [prevRunDir]
"""
import sys
from pathlib import Path
from _common import dump, load


def ids(f):
    return {x["findingId"] for s in f["screens"] for x in s["findings"]}


def main(run_dir, prev=None):
    run = Path(run_dir)
    if prev is None:
        sibs = sorted(p for p in run.parent.iterdir() if p.is_dir() and p != run and (p / "findings.json").exists() and p.name < run.name)
        prev = sibs[-1] if sibs else None
    cur = ids(load(run / "findings.json"))
    if not prev:
        dump(run / "diff.json", {"previous": None, "new": sorted(cur), "resolved": [], "unchanged": []})
        print("diff: first run (no previous)")
        return
    old = ids(load(Path(prev) / "findings.json"))
    dump(run / "diff.json", {"previous": Path(prev).name, "new": sorted(cur - old), "resolved": sorted(old - cur), "unchanged": sorted(cur & old)})
    print(f"diff vs {Path(prev).name}: {len(cur - old)} new, {len(old - cur)} resolved, {len(cur & old)} unchanged")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
