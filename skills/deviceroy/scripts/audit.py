#!/usr/bin/env python3
"""One entry point for the whole pipeline (Steps 0-7). Read-only toward the app:
every write lands in the project's home in the skill workspace (runs/<run>/, judgments.json).

usage:
  audit.py [--project DIR] [--routes /a,/b] [--run-id ID]      full run
  audit.py --run-dir RUN --from evaluate                       re-render after judgments
"""
import argparse, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import annotate, detect_static, diff_runs, evaluate, hierarchy, inventory, render_report  # noqa: E402
from _common import load  # noqa: E402


def sh(cmd):
    r = subprocess.run(cmd, text=True, capture_output=True)
    sys.stdout.write(r.stdout)
    if r.returncode:
        sys.stderr.write(r.stderr)
    return r.returncode


def summary(run):
    f = load(run / "findings.json")
    allf = sorted((x for s in f["screens"] for x in s["findings"]), key=lambda x: (x["severity"], x["ruleId"], x["screen"]))
    s = f["summary"]
    counts = " · ".join(f"{p}: " + "/".join(f"{s.get(p, {}).get(v, 0)}" for v in ("P1", "P2", "P3")) for p in ("ios", "android", "both"))
    print(f"\n== deviceroy: {len(allf)} findings on {len(f['screens'])} screens (P1/P2/P3 → {counts})")
    for x in allf[:3]:
        print(f"   {x['severity']} {x['ruleId']} @ {x['screen']} [{x['evidence']}]: {x['current'][:110]}")
    pend = sum(1 for m in f["manualReview"] if m["status"] == "needs judgment")
    print(f"   manual review: {len(f['manualReview'])} ({pend} awaiting judgment) · skipped rules: {len(f['appendix']['skipped'])}")
    print(f"   pages: {run / 'report-ios.html'} · {run / 'report-android.html'}")
    ids = sorted({x["ruleId"] for x in allf}, key=lambda r: (min(x["severity"] for x in allf if x["ruleId"] == r), r))
    print(f"   hand-off rule IDs: {' '.join(ids) or 'none'}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=".")
    ap.add_argument("--routes")
    ap.add_argument("--run-id")
    ap.add_argument("--run-dir")
    ap.add_argument("--from", dest="start", choices=["capture", "evaluate"])
    a = ap.parse_args()

    if a.start == "evaluate":
        run = Path(a.run_dir)
    else:
        cmd = [sys.executable, str(HERE / "preflight.py"), "--project", a.project]
        if a.routes:
            cmd += ["--routes", a.routes]
        if a.run_id:
            cmd += ["--run-id", a.run_id]
        r = subprocess.run(cmd, text=True, capture_output=True)
        sys.stdout.write(r.stdout)
        if r.returncode:
            sys.stderr.write(r.stderr)
            sys.exit(r.returncode)
        run = Path(r.stdout.strip().split("RUN_DIR=")[-1].strip())
        inventory.main(run)
        modes = load(run / "preflight.json")["modes"]
        if "W" in modes:
            sh(["node", str(HERE / "capture_web.mjs"), str(run)])
        if "V-ios" in modes:
            sh(["bash", str(HERE / "capture_ios.sh"), str(run)])
        if "V-android" in modes:
            sh(["bash", str(HERE / "capture_android.sh"), str(run)])
        hierarchy.main(run)
        detect_static.main(run)
    evaluate.main(run)
    diff_runs.main(run)
    annotate.main(run)
    # Before/after frames for the Prototype tab: only a web render can be patched, and only while it is reachable.
    cfg = load(run / "config.json", {})
    if "W" in load(run / "preflight.json", {}).get("modes", []) and cfg.get("prototype", {}).get("enabled", True):
        render_report.plan(run)
        sh(["node", str(HERE / "capture_after.mjs"), str(run)])
    render_report.main(run)
    summary(run)
    print(f"RUN_DIR={run}")


if __name__ == "__main__":
    main()
