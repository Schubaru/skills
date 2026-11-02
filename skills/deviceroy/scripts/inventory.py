#!/usr/bin/env python3
"""Step 1. Build the sorted, scoped screen list -> <run>/inventory.json.

Sources, merged by route: Expo Router app/ dir, or a React Router config (web);
the review-canvas manifest (JSON, or a TS/TSX board config); then config routes.
Screen identity = route pattern (query stripped). Order: tabs first, then route path A-Z.
"""
import re, sys
from pathlib import Path
from urllib.parse import urlsplit
from _common import dump, load, run_config, slugify, die

EXTS = (".tsx", ".ts", ".jsx", ".js", ".dart", ".swift")
WRAPPERS = {"Suspense", "FlagGate", "Navigate", "Route", "Routes", "Fragment", "Outlet", "StrictMode", "ErrorBoundary"}


def resolve_import(base_file, spec, project):
    if spec.startswith("@/"):
        cand = project / "src" / spec[2:]
    elif spec.startswith("."):
        cand = (base_file.parent / spec)
    else:
        return None
    cand = cand.resolve()
    if cand.is_file():
        return cand
    for e in EXTS:
        if cand.with_name(cand.name + e).is_file():
            return cand.with_name(cand.name + e)
    for e in EXTS:
        if (cand / f"index{e}").is_file():
            return cand / f"index{e}"
    return None


def local_imports(f, project):
    """Depth-1 local imports of a source file (relative or @/ alias)."""
    try:
        text = f.read_text(errors="ignore")
    except Exception:
        return []
    out = []
    for spec in re.findall(r"""(?:from|import)\s*\(?\s*['"]([.@][^'"]+)['"]""", text):
        r = resolve_import(f, spec, project)
        found = [r] if r else [p for p in (resolve_import(f, spec + ".ios", project), resolve_import(f, spec + ".android", project)) if p]
        out += [x for x in found if x != f and x.suffix in EXTS and "node_modules" not in x.parts]
    return out


# ---------- Expo Router ----------
def expo_routes(project):
    for root in (project / "app", project / "src" / "app"):
        if (root / "_layout.tsx").exists() or (root / "_layout.js").exists() or (root / "_layout.jsx").exists():
            break
    else:
        return {}
    routes = {}
    for f in sorted(root.rglob("*")):
        if f.suffix not in (".tsx", ".ts", ".jsx", ".js") or f.name.startswith("_") or f.name.startswith("+"):
            continue
        rel = f.relative_to(root).with_suffix("")
        parts = [p for p in rel.parts if not (p.startswith("(") and p.endswith(")"))]
        if parts and parts[-1] == "index":
            parts = parts[:-1]
        route = "/" + "/".join(parts)
        layouts, tab = [], False
        d = f.parent
        while True:
            for n in ("_layout.tsx", "_layout.ts", "_layout.jsx", "_layout.js"):
                if (d / n).exists():
                    layouts.append(d / n)
                    if d == f.parent and re.search(r"<(Native)?Tabs\b|NativeTabs|createBottomTabNavigator", (d / n).read_text(errors="ignore")):
                        tab = True
            if d == root:
                break
            d = d.parent
        routes.setdefault(route, {"files": [f], "chrome": layouts, "tab": tab})
    return routes


# ---------- React Router (web prototypes) ----------
def react_router_routes(project):
    src = project / "src"
    if not src.is_dir():
        return {}
    files = [p for p in src.rglob("*.tsx") if "node_modules" not in p.parts] + [p for p in src.rglob("*.jsx") if "node_modules" not in p.parts]
    routes = {}
    for f in sorted(files):
        text = f.read_text(errors="ignore")
        if "<Route" not in text:
            continue
        comp_file = {}
        for name, spec in re.findall(r"const\s+(\w+)\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(\s*['\"]([^'\"]+)['\"]", text):
            comp_file[name] = spec
        for names, spec in re.findall(r"import\s+([^'\";]+?)\s+from\s+['\"]([.@][^'\"]+)['\"]", text):
            for n in re.findall(r"\b([A-Z]\w*)\b", names):
                comp_file.setdefault(n, spec)
        marks = [(m.start(), m.group(1)) for m in re.finditer(r"""path\s*=\s*['"]([^'"]+)['"]""", text)]
        for i, (pos, path) in enumerate(marks):
            end = marks[i + 1][0] if i + 1 < len(marks) else pos + 1500
            chunk = text[pos:end]
            comps = [c for c in re.findall(r"<([A-Z]\w*)", chunk) if c not in WRAPPERS]
            if not comps or not path.startswith("/"):
                continue
            srcs = []
            for c in comps:
                r = resolve_import(f, comp_file[c], project) if c in comp_file else None
                if r:
                    srcs.append(r)
            if srcs and path not in routes:
                routes[path] = {"files": srcs, "chrome": [], "tab": False}
    return routes


# ---------- canvas manifest ----------
def canvas_screens(project, manifest):
    if not manifest:
        return []
    p = (project / manifest)
    if not p.exists():
        print(f"warn: canvasManifest {manifest} not found", file=sys.stderr)
        return []
    out = []
    if p.suffix == ".json":
        def walk(o):
            if isinstance(o, dict):
                so = o.get("source")
                url = o.get("route") or o.get("url") or o.get("src") or (so.get("src") if isinstance(so, dict) else None)
                if isinstance(url, str) and url.startswith("/"):
                    out.append({"url": url, "title": o.get("title", ""), "canvasId": o.get("id", "")})
                for v in o.values():
                    walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(load(p))
    else:
        # A board config: helper calls shaped fn("id", "title", "/route") in manifest order.
        text = p.read_text(errors="ignore")
        for cid, title, url in re.findall(r"""\w+\(\s*["']([^"']+)["']\s*,\s*["']([^"']*)["']\s*,\s*["'](/[^"']*)["']""", text):
            out.append({"url": url, "title": title, "canvasId": cid})
    return out


def match_route(path, routes):
    if path in routes:
        return path
    for pat in routes:
        rx = "^" + re.sub(r":\w+|\[[^\]]+\]", "[^/]+", pat) + "/?$"
        if ":" in pat or "[" in pat:
            if re.match(rx, path):
                return pat
    return None


def main(run_dir):
    cfg = run_config(run_dir)
    project = Path(cfg["_project"])
    stack = cfg["stack"]
    routes = expo_routes(project) if stack == "rn-expo" else react_router_routes(project) if stack == "web" else {}
    sc = cfg.get("scope", {})
    include = sc.get("include") or []
    screens = {}

    def add(route_key, url, title="", canvas_id=""):
        s = screens.setdefault(route_key, {"route": route_key, "url": url, "title": title, "canvasId": canvas_id})
        if not s["title"] and title:
            s["title"] = title

    for c in canvas_screens(project, cfg.get("sources", {}).get("canvasManifest")):
        path = urlsplit(c["url"]).path or "/"
        add(match_route(path, routes) or path, c["url"], c["title"], c["canvasId"])
    for r in routes:
        if ":" not in r and "[" not in r:
            add(r, r)
    cfg_routes = sc.get("routes") or []
    for r in cfg_routes:  # config routes win on URL (a chosen state), keep canvas title
        path = urlsplit(r).path or "/"
        key = match_route(path, routes) or path
        add(key, r)
        screens[key]["url"] = r

    if sc.get("mode") == "routes":
        wanted = {match_route(urlsplit(r).path or "/", routes) or (urlsplit(r).path or "/") for r in cfg_routes}
        screens = {k: v for k, v in screens.items() if k in wanted}
    elif include:
        screens = {k: v for k, v in screens.items() if any(k == p or k.startswith(p.rstrip("/") + "/") for p in include)}

    chrome_cfg = [project / c for c in cfg.get("chrome", [])]
    ignored = {(project / i).resolve() for i in cfg.get("ignoreSources", [])}
    tab_cfg = set(cfg.get("tabRoutes", []))
    out = []
    for key, s in screens.items():
        r = routes.get(key, {"files": [], "chrome": [], "tab": False})
        files = list(dict.fromkeys(r["files"]))
        deps = []
        for f in files:
            deps += local_imports(f, project)
        chrome = list(dict.fromkeys(r["chrome"] + chrome_cfg))
        rel = lambda ps: sorted({str(p.relative_to(project)) for p in ps if p.exists() and p.resolve() not in ignored})
        out.append({
            "route": key, "slug": slugify(key), "url": s["url"], "title": s["title"] or key,
            "canvasId": s["canvasId"], "tab": bool(r["tab"] or key in tab_cfg),
            "sources": rel(files), "imports": rel(deps), "chrome": rel(chrome),
        })
    out.sort(key=lambda s: (not s["tab"], s["route"]))
    seen = {}
    for s in out:  # slug collisions get a stable suffix
        n = seen.get(s["slug"], 0)
        seen[s["slug"]] = n + 1
        if n:
            s["slug"] = f"{s['slug']}-{n + 1}"
    if not out:
        die("inventory is empty: no routes found in scope. Check scope/include, canvasManifest, or add scope.routes.")
    dump(Path(run_dir) / "inventory.json", out)
    print(f"inventory: {len(out)} screens" + ("" if all(s["sources"] for s in out) else f" ({sum(1 for s in out if not s['sources'])} without source mapping — code rules skip them)"))


if __name__ == "__main__":
    main(sys.argv[1])
