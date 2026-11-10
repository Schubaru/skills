#!/bin/sh
# N00B Inc bridge installer. Usage: install.sh <machine-token> <dashboard-url>
set -e
TOKEN="$1"
URL="$2"
if [ -z "$TOKEN" ] || [ -z "$URL" ]; then
  echo "usage: install.sh <machine-token> <dashboard-url>" >&2
  exit 1
fi
command -v node >/dev/null 2>&1 || { echo "node is required (https://nodejs.org)" >&2; exit 1; }
URL=$(printf '%s' "$URL" | sed 's:/*$::')
DIR="$HOME/.claude/noob-inc"
mkdir -p "$DIR/state" "$DIR/queue"
curl -fsSL "$URL/bridge/bridge.mjs" -o "$DIR/bridge.mjs"
printf '{"url":"%s","token":"%s"}\n' "$URL" "$TOKEN" > "$DIR/config.json"
chmod 600 "$DIR/config.json"
node "$DIR/bridge.mjs" --install-hooks
echo "Bridge installed at $DIR. Start a new Claude Code session and it will appear on the dashboard."
echo "To remove: node \"$DIR/bridge.mjs\" --uninstall-hooks"
