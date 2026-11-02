#!/usr/bin/env python3
"""Record a judgment for a "review" candidate (or a free observation) in the project's home (<workspace>/projects/<name>/judgments.json).

A judgment is keyed by findingId and pinned to the candidate's evidenceHash, so it is reused
on every later run while the evidence is unchanged, and silently expires when it changes.

usage:
  judge.py <runDir> <findingId> fire|pass|manual [--current "one sentence"] [--note "why"] [--absent]

--current is shown to readers as "On this screen": one plain sentence, no file paths or code names.
--absent (with pass) says the flagged thing is not on the screen at all; the report then drops its
menu row for that screen instead of listing it as a match.
  judge.py <runDir> --observe <screenSlug> <ios|android|both> <zone> "what you saw"
  judge.py <runDir> --pending        # list review candidates with no valid judgment
"""
import argparse, sys
from pathlib import Path
from _common import dump, load, run_config


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("run_dir")
    ap.add_argument("finding_id", nargs="?")
    ap.add_argument("verdict", nargs="?", choices=["fire", "pass", "manual"])
    ap.add_argument("--current")
    ap.add_argument("--note", default="")
    ap.add_argument("--absent", action="store_true")
    ap.add_argument("--observe", nargs=4, metavar=("SCREEN", "PLATFORM", "ZONE", "NOTE"))
    ap.add_argument("--pending", action="store_true")
    a = ap.parse_args()
    run = Path(a.run_dir)
    cfg = run_config(run)
    jpath = Path(cfg["_outRoot"]) / "judgments.json"
    j = load(jpath, {"version": 1, "judgments": {}, "observations": []})
    cands = {c["findingId"]: c for c in load(run / "candidates.json", [])}

    if a.pending:
        for c in cands.values():
            if c["verdict"] == "review" and j["judgments"].get(c["findingId"], {}).get("evidenceHash") != c["evidenceHash"]:
                print(f"{c['findingId']}\t{c['platform']}\t{c['current']}")
        return
    if a.observe:
        screen, platform, zone, note = a.observe
        if zone not in ("top-bar", "bottom-bar", "content", "overlay"):
            sys.exit("zone must be top-bar | bottom-bar | content | overlay")
        obs = {"screen": screen, "platform": platform, "zone": zone, "note": note, "evidence": "W"}
        if obs not in j["observations"]:
            j["observations"].append(obs)
            j["observations"].sort(key=lambda o: (o["screen"], o["note"]))
        dump(jpath, j)
        print("observation recorded")
        return
    c = cands.get(a.finding_id)
    if not c:
        sys.exit(f"unknown findingId {a.finding_id} (see candidates.json)")
    if c["verdict"] != "review":
        sys.exit(f"{a.finding_id} is deterministic ({c['verdict']}); only review candidates take a judgment")
    entry = {"evidenceHash": c["evidenceHash"], "verdict": a.verdict, "note": a.note}
    if a.current:
        entry["current"] = a.current.strip()
    if a.absent:
        if a.verdict != "pass":
            sys.exit("--absent only goes with pass")
        entry["absent"] = True
    j["judgments"][a.finding_id] = entry
    dump(jpath, j)
    print(f"judged {a.finding_id}: {a.verdict}")


if __name__ == "__main__":
    main()
