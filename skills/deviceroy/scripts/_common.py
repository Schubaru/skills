"""Shared helpers. Stdlib only. Everything here must be deterministic."""
import hashlib, json, os, re, subprocess, sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
REF = SKILL_DIR / "references"
ASSETS = SKILL_DIR / "assets"

VIEWPORTS = {"ios": {"width": 393, "height": 852}, "android": {"width": 412, "height": 915}}
SEV_ORDER = {"P1": 0, "P2": 1, "P3": 2}
PLATFORMS = ("ios", "android")


def load(path, default=None):
    p = Path(path)
    if not p.exists():
        return default
    return json.loads(p.read_text())


def dump(path, data):
    """Stable JSON: sorted keys, 2-space indent, trailing newline."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n")


def hash4(s):
    return hashlib.sha1(str(s).encode()).hexdigest()[:4]


def hash_obj(o):
    return hashlib.sha1(json.dumps(o, sort_keys=True).encode()).hexdigest()[:12]


def slugify(route):
    path = route.split("?")[0].strip("/")
    if not path:
        return "index"
    path = re.sub(r"\(([^)]*)\)/?", "", path)      # expo-router groups
    path = re.sub(r"[:\[\]]", "", path)             # :id / [id]
    s = re.sub(r"[^a-zA-Z0-9]+", "-", path).strip("-").lower()
    return s or "index"


# Everything the skill writes lives here, never inside the audited project.
WORKSPACE = Path(os.environ.get("DEVICEROY_HOME", SKILL_DIR.parent / "deviceroy-workspace"))


def project_home(project):
    """<workspace>/projects/<dirname>-<hash4 of absolute path>: config.json, judgments.json, runs/."""
    p = Path(project).resolve()
    return WORKSPACE / "projects" / f"{slugify(p.name) if p.name else 'root'}-{hash4(str(p))}"


def rules():
    return load(REF / "rules.json")


def run_config(run_dir):
    return load(Path(run_dir) / "config.json")


def git(project, *args):
    try:
        return subprocess.run(["git", "-C", str(project), *args], capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ""


def zone_box(zone, platform):
    vw, vh = VIEWPORTS[platform]["width"], VIEWPORTS[platform]["height"]
    return {
        "top-bar": [0, 0, vw, 110],
        "bottom-bar": [0, vh - 110, vw, 110],
        "content": [0, 110, vw, vh - 220],
        "overlay": [0, 0, vw, vh],
    }[zone]


def die(msg, code=2):
    print(f"deviceroy: {msg}", file=sys.stderr)
    sys.exit(code)
