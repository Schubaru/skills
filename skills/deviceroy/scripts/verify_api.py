#!/usr/bin/env python3
"""Confirm that symbols a recommendation names exist in the project's INSTALLED dependencies.

rn-expo / web : word match in node_modules/<pkg>/**/*.d.ts
flutter       : package present in pubspec.lock
swift         : symbol present in the installed SwiftUI .swiftinterface
usage (CLI): verify_api.py <projectDir> <stack> <pkg>:<symbol> [...]
"""
import functools, re, subprocess, sys
from pathlib import Path

MAX_FILES = 4000


@functools.lru_cache(maxsize=None)
def _dts_text(pkg_dir):
    chunks, n = [], 0
    for p in sorted(Path(pkg_dir).rglob("*.d.ts")):
        if "node_modules" in p.relative_to(pkg_dir).parts:
            continue
        n += 1
        if n > MAX_FILES:
            break
        try:
            chunks.append(p.read_text(errors="ignore"))
        except Exception:
            pass
    return "\n".join(chunks)


@functools.lru_cache(maxsize=None)
def _swiftui_interface():
    try:
        sdk = subprocess.run(["xcrun", "--sdk", "iphoneos", "--show-sdk-path"], capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ""
    mod = Path(sdk) / "System/Library/Frameworks/SwiftUI.framework/Modules/SwiftUI.swiftmodule"
    return "\n".join(p.read_text(errors="ignore") for p in sorted(mod.glob("*.swiftinterface"))[:1]) if mod.exists() else ""


def has_symbol(project, stack, pkg, symbol):
    project = Path(project)
    if stack in ("rn-expo", "web"):
        d = project / "node_modules" / pkg
        if not d.is_dir():
            return False
        return re.search(rf"\b{re.escape(symbol)}\b", _dts_text(str(d))) is not None
    if stack == "flutter":
        lock = project / "pubspec.lock"
        return lock.exists() and re.search(rf"^\s{{2}}{re.escape(pkg)}:", lock.read_text(), re.M) is not None
    if stack == "swift":
        return re.search(rf"\b{re.escape(symbol)}\b", _swiftui_interface()) is not None
    return False


def verify(project, stack, requires):
    """-> (apiVerified: True | False | None, missing: [pkg:symbol])"""
    if not requires:
        return None, []
    missing = [f"{r['pkg']}:{r['symbol']}" for r in requires if not has_symbol(project, stack, r["pkg"], r["symbol"])]
    return (not missing), missing


if __name__ == "__main__":
    proj, stack, *pairs = sys.argv[1:]
    reqs = [dict(zip(("pkg", "symbol"), p.rsplit(":", 1))) for p in pairs]
    ok, missing = verify(proj, stack, reqs)
    print("verified" if ok else f"missing: {', '.join(missing)}")
    sys.exit(0 if ok else 1)
