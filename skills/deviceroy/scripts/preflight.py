#!/usr/bin/env python3
"""Step 0. Read config, detect stack + versions + tools, pick capture modes, open a run dir.

usage: preflight.py [--project DIR] [--config FILE] [--routes /a,/b] [--run-id ID] [--print-home]
Config and output live in the project's home under the skill workspace, never in the project.
Exit 3 = config missing (the model asks the user once and writes it to the printed path).
Last stdout line is RUN_DIR=<path>.
"""
import argparse, datetime, json, shutil, subprocess, urllib.request
from pathlib import Path
from _common import dump, load, git, rules, die, project_home

WEB_PKGS = ["react", "react-dom", "react-router", "react-router-dom", "vite", "next", "tailwindcss", "playwright"]
RN_PKGS = ["expo", "expo-router", "@expo/ui", "expo-glass-effect", "expo-symbols", "react-native",
           "react-native-screens", "@react-navigation/bottom-tabs", "@react-navigation/native"]


def pkg_version(project, name, declared):
    installed = load(project / "node_modules" / name / "package.json")
    if installed:
        return installed.get("version")
    return f"declared {declared}" if declared else None


def detect(project):
    pkg = load(project / "package.json", {})
    deps = {**pkg.get("devDependencies", {}), **pkg.get("dependencies", {})}
    if "expo" in deps or "react-native" in deps:
        vers = {n: pkg_version(project, n, deps.get(n)) for n in RN_PKGS if n in deps or (project / "node_modules" / n).exists()}
        return "rn-expo", vers, True
    if (project / "pubspec.yaml").exists():
        lock = (project / "pubspec.lock").read_text() if (project / "pubspec.lock").exists() else ""
        vers = {}
        for name in ("cupertino_ui", "material_ui", "flutter"):
            i = lock.find(f"\n  {name}:")
            if i >= 0:
                j = lock.find('version: "', i)
                vers[name] = lock[j + 10:lock.find('"', j + 10)] if j > 0 else "?"
        return "flutter", vers, (project / "android").is_dir()
    if list(project.glob("*.xcodeproj")) or (project / "Package.swift").exists():
        out = subprocess.run(["xcodebuild", "-version"], capture_output=True, text=True).stdout.split("\n")[0] if shutil.which("xcodebuild") else None
        return "swift", {"xcode": out}, (project / "android").is_dir()
    if any(d in deps for d in ("react-dom", "vue", "svelte", "next")):
        vers = {n: pkg_version(project, n, deps.get(n)) for n in WEB_PKGS if n in deps}
        return "web", vers, True   # a web prototype renders both platforms
    return "unknown", {}, True


def tool(cmd):
    return shutil.which(cmd) is not None


def playwright_ok(project):
    if not tool("node"):
        return False
    r = subprocess.run(["node", "-e", "require.resolve('playwright')"], cwd=project, capture_output=True)
    return r.returncode == 0


def reachable(url):
    try:
        with urllib.request.urlopen(url, timeout=4) as r:
            return r.status < 500
    except Exception:
        return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project", default=".")
    ap.add_argument("--config")
    ap.add_argument("--routes", help="comma-separated override of scope (e.g. /settings,/profile)")
    ap.add_argument("--run-id")
    ap.add_argument("--print-home", action="store_true")
    a = ap.parse_args()
    project = Path(a.project).resolve()
    home = project_home(project)
    if a.print_home:
        print(home)
        return
    cfg_path = Path(a.config) if a.config else home / "config.json"
    cfg = load(cfg_path)
    if cfg is None:
        print(f"CONFIG_MISSING={cfg_path}")
        raise SystemExit(3)

    stack, versions, has_android = detect(project)
    if cfg.get("stack", "auto") != "auto":
        stack = cfg["stack"]
    if a.routes:
        cfg["scope"] = {**cfg.get("scope", {}), "mode": "routes", "routes": [r.strip() for r in a.routes.split(",") if r.strip()]}

    src = cfg.get("sources", {})
    tools = {t: tool(t) for t in ("node", "xcrun", "adb", "maestro")}
    tools["playwright"] = playwright_ok(project)
    modes, reasons = ["C"], {}
    url = src.get("prototypeUrl")
    if url:
        probe = url.replace("{route}", "/")
        if not tools["playwright"]:
            reasons["W"] = "prototypeUrl set but playwright is not resolvable from the project"
        elif not reachable(probe):
            reasons["W"] = f"prototype not reachable at {probe} (start the dev server)"
        else:
            modes.append("W")
    else:
        reasons["W"] = "no prototypeUrl configured"
    native = src.get("native", {})
    nat_cfg = cfg.get("native", {})
    for plat, t in (("ios", "xcrun"), ("android", "adb")):
        if not native.get(plat):
            reasons[f"V-{plat}"] = "disabled in config"
        elif plat == "android" and not has_android:
            reasons["V-android"] = "No Android target detected"
        elif not tools[t]:
            reasons[f"V-{plat}"] = f"{t} not available"
        elif not nat_cfg.get(plat, {}).get("scheme"):
            reasons[f"V-{plat}"] = f"no native.{plat}.scheme (deep link) configured / no dev build"
        else:
            modes.append(f"V-{plat}")

    sha = git(project, "rev-parse", "--short", "HEAD") or "nogit"
    dirty = bool(git(project, "status", "--porcelain", "--untracked-files=no"))
    run_id = a.run_id or f"{datetime.date.today().isoformat()}_{sha}"
    out_root = home
    run_dir = home / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    cfg["stack"] = stack
    cfg["_project"] = str(project)
    cfg["_outRoot"] = str(out_root)
    catalog = rules()
    if cfg.get("ruleCatalogVersion") and cfg["ruleCatalogVersion"] != catalog["catalogVersion"]:
        print(f"note: config pins catalog {cfg['ruleCatalogVersion']}, skill ships {catalog['catalogVersion']}; using the shipped catalog")
    dump(run_dir / "config.json", cfg)
    dump(run_dir / "preflight.json", {
        "stack": stack, "versions": versions, "hasAndroid": has_android, "tools": tools,
        "modes": modes, "skippedModes": reasons, "commit": sha,
        "catalogVersion": catalog["catalogVersion"],
    })
    dump(run_dir / "run.json", {
        "startedAt": datetime.datetime.now().isoformat(timespec="seconds"), "commit": sha, "dirty": dirty,
        "catalogVersion": catalog["catalogVersion"], "tools": tools, "versions": versions, "configSnapshot": cfg,
    })
    dev = cfg.get("devices", {})
    print(f"stack    : {stack} {json.dumps(versions, sort_keys=True)}" + ("" if has_android else "  (No Android target detected)"))
    print(f"sources  : {', '.join(modes)}" + (f"  | skipped: {'; '.join(f'{k}: {v}' for k, v in sorted(reasons.items()))}" if reasons else ""))
    sc = cfg.get("scope", {})
    print(f"screens  : scope={sc.get('mode', 'all')} {sc.get('routes') or sc.get('include') or ''}")
    print(f"devices  : iOS {dev.get('ios', {}).get('model')} {dev.get('ios', {}).get('os')} · Android {dev.get('android', {}).get('model')} API {dev.get('android', {}).get('api')}")
    print(f"catalog  : {catalog['catalogVersion']} (verified {catalog['lastVerified']}) · commit {sha}{' (dirty)' if dirty else ''}")
    print(f"home     : {home}")
    print(f"RUN_DIR={run_dir}")


if __name__ == "__main__":
    main()
