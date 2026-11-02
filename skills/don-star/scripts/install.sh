#!/usr/bin/env bash
# Install the review board into a Vite + React app, completely, in one run.
#
#   install.sh [app-dir] [--slug s] [--name "Name"] [--admin-domain d]
#              [--inbox e] [--brand-name b] [--brand-url u] [--site-url u]
#              [--from-email "Name <e>"] [--supabase-ref r]
#              [--force] [--no-install]
#
# Copies every asset into the app, fills the __DS_*__ placeholders, wires the
# entry / router / Vite config / tsconfig (wire.mjs), generates a first board
# config from the app's routes, installs dependencies, and then runs check.mjs
# — which fails loudly if any wiring step is missing. Deterministic: the same
# app and flags produce the same tree every time. Every default is derived
# from the app (package name, git email) so flags are optional.
#
# --force re-copies the harness over an existing install WITHOUT touching the
# files that hold project state: review.config.tsx, projects.ts, brand.ts,
# review-board*.json, review-triage.json, .env*.
set -euo pipefail

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP="."
SLUG="" NAME="" ADMIN_DOMAIN="" INBOX="" BRAND_NAME="" BRAND_URL="" SITE_URL="" FROM_EMAIL="" SUPABASE_REF=""
FORCE=0 NO_INSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --slug) SLUG="$2"; shift 2;;
    --name) NAME="$2"; shift 2;;
    --admin-domain) ADMIN_DOMAIN="$2"; shift 2;;
    --inbox) INBOX="$2"; shift 2;;
    --brand-name) BRAND_NAME="$2"; shift 2;;
    --brand-url) BRAND_URL="$2"; shift 2;;
    --site-url) SITE_URL="$2"; shift 2;;
    --from-email) FROM_EMAIL="$2"; shift 2;;
    --supabase-ref) SUPABASE_REF="$2"; shift 2;;
    --force) FORCE=1; shift;;
    --no-install) NO_INSTALL=1; shift;;
    -h|--help) sed -n 2,20p "$0"; exit 0;;
    --*) echo "unknown flag $1" >&2; exit 2;;
    *) APP="$1"; shift;;
  esac
done

APP="$(cd "$APP" && pwd)"
[ -f "$APP/package.json" ] || { echo "error: $APP has no package.json — point me at the app root" >&2; exit 1; }
[ -f "$APP/src/main.tsx" ] || [ -f "$APP/src/main.jsx" ] || { echo "error: $APP/src/main.tsx not found — this installs into a Vite + React app" >&2; exit 1; }
if [ -e "$APP/src/review" ] && [ $FORCE -eq 0 ]; then
  echo "error: $APP/src/review already exists — pass --force to re-copy the harness (project state is kept)" >&2; exit 1
fi

REPO="$(git -C "$APP" rev-parse --show-toplevel 2>/dev/null || echo "$APP")"
APP_DIR="$(python3 -c "import os,sys; p=os.path.relpath(sys.argv[1], sys.argv[2]); print(p)" "$APP" "$REPO")"

# --- defaults, derived from the app ------------------------------------------
pkg_name="$(node -p "require('$APP/package.json').name || ''" 2>/dev/null || true)"
[ -n "$SLUG" ] || SLUG="$(echo "${pkg_name:-$(basename "$APP")}" | sed -E 's#^@[^/]+/##; s/[^A-Za-z0-9-]+/-/g' | tr 'A-Z' 'a-z' | sed -E 's/^-+|-+$//g')"
[ -n "$SLUG" ] || SLUG="my-project"
[ -n "$NAME" ] || NAME="$(python3 -c "import sys; print(' '.join(w.capitalize() for w in sys.argv[1].split('-')))" "$SLUG")"
[ -n "$NAME" ] || NAME="$SLUG"
git_email="$(git -C "$APP" config user.email 2>/dev/null || true)"
[ -n "$ADMIN_DOMAIN" ] || ADMIN_DOMAIN="${git_email##*@}"
[ -n "$ADMIN_DOMAIN" ] && [ "$ADMIN_DOMAIN" != "$git_email" ] || ADMIN_DOMAIN="example.com"
[ -n "$INBOX" ] || INBOX="${git_email:-admin@$ADMIN_DOMAIN}"
[ -n "$BRAND_NAME" ] || BRAND_NAME="$NAME"
[ -n "$BRAND_URL" ] || BRAND_URL="/"
[ -n "$SITE_URL" ] || SITE_URL="http://localhost:5173"
[ -n "$FROM_EMAIL" ] || FROM_EMAIL="Review board <notify@$ADMIN_DOMAIN>"
[ -n "$SUPABASE_REF" ] || SUPABASE_REF="your-project-ref"

# --- copy ---------------------------------------------------------------------
KEEP_RE='(^|/)(review\.config\.tsx|projects\.ts|brand\.ts|review-board[^/]*\.json|review-triage\.json)$'
copied=()
copy() { # copy <src> <dst>
  local src="$1" dst="$2"
  if [ $FORCE -eq 1 ] && [ -e "$dst" ] && [[ "$dst" =~ $KEEP_RE ]]; then return; fi
  mkdir -p "$(dirname "$dst")"
  cp "$src" "$dst"
  copied+=("$dst")
}
copy_tree() { # copy_tree <src-dir> <dst-dir>
  local f
  while IFS= read -r -d '' f; do
    copy "$f" "$2/${f#$1/}"
  done < <(find "$1" -type f -print0)
}
A="$SKILL_DIR/assets"
copy_tree "$A/review" "$APP/src/review"
copy_tree "$A/auth" "$APP/src/auth"
copy_tree "$A/dev" "$APP/src/dev"
copy_tree "$A/flows" "$APP/src/flows"
copy "$A/app/review-seed.ts" "$APP/src/review-seed.ts"
copy "$A/app/review-capture.ts" "$APP/src/review-capture.ts"
copy "$A/app/review-routes.tsx" "$APP/src/review-routes.tsx"
copy_tree "$A/app/pages" "$APP/src/pages"
copy "$A/app/middleware.ts" "$APP/middleware.ts"
copy "$A/app/DEV.md" "$APP/DEV.md"
[ -e "$APP/review-board.json" ] || copy "$A/app/review-board.json" "$APP/review-board.json"
[ -e "$APP/review-triage.json" ] || copy "$A/app/review-triage.json" "$APP/review-triage.json"
copy_tree "$A/supabase" "$APP/supabase"
copy_tree "$A/scripts" "$APP/scripts"
copy_tree "$A/workflows" "$REPO/.github/workflows"

# --- fill placeholders (only in the files this script wrote) -----------------
fill() {
  python3 - "$@" <<'PY'
import sys, re
vals = dict(a.split("=", 1) for a in sys.argv[1:] if "=" in a and a.startswith("__DS_"))
files = [a for a in sys.argv[1:] if not a.startswith("__DS_")]
app_dir = vals["__DS_APP_DIR__"]
for f in files:
    try:
        s = open(f, encoding="utf-8").read()
    except (UnicodeDecodeError, IsADirectoryError):
        continue
    t = s
    if app_dir == ".":
        # Workflows: an app at the repo root has no subdirectory to scope by.
        t = t.replace('"__DS_APP_DIR__/**"', '"**"').replace("__DS_APP_DIR__/", "")
    for k, v in vals.items():
        t = t.replace(k, v)
    if t != s:
        open(f, "w", encoding="utf-8").write(t)
left = [f for f in files if "__DS_" in open(f, encoding="utf-8", errors="ignore").read()]
if left:
    sys.exit("unfilled placeholders in: " + ", ".join(left))
PY
}
fill "__DS_PROJECT_SLUG__=$SLUG" "__DS_PROJECT_NAME__=$NAME" "__DS_ADMIN_DOMAIN__=$ADMIN_DOMAIN" \
     "__DS_ADMIN_INBOX__=$INBOX" "__DS_BRAND_NAME__=$BRAND_NAME" "__DS_BRAND_URL__=$BRAND_URL" \
     "__DS_SITE_URL__=$SITE_URL" "__DS_FROM_EMAIL__=$FROM_EMAIL" "__DS_SUPABASE_REF__=$SUPABASE_REF" \
     "__DS_APP_DIR__=$APP_DIR" "${copied[@]}"

# --- wire the app -------------------------------------------------------------
node "$SKILL_DIR/scripts/wire.mjs" "$APP" --slug "$SLUG" --name "$NAME" --deps "$A/app/deps.json"

if [ $NO_INSTALL -eq 0 ]; then
  echo "installing dependencies…"
  (cd "$APP" && npm install --no-audit --no-fund --loglevel=error)
fi

echo
node "$SKILL_DIR/scripts/check.mjs" "$APP"
status=$?
echo
echo "Project: $NAME ($SLUG) · admins: $ADMIN_DOMAIN · inbox: $INBOX · app dir: $APP_DIR"
echo "Next: npm run dev, open http://localhost:5173/review — then regroup src/review/review.config.tsx by user journey."
exit $status
