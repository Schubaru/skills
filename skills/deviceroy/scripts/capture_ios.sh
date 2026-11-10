#!/usr/bin/env bash
# Step 2 (iOS, evidence V). Boot the configured simulator, normalize the status bar,
# open each screen by deep link, screenshot, and dump the accessibility hierarchy (maestro).
# usage: capture_ios.sh <runDir>     requires: xcrun; a dev build installed; config.native.ios.scheme
set -euo pipefail
RUN="$1"; CFG="$RUN/config.json"
j() { python3 -c "import json,sys;c=json.load(open('$CFG'));print(eval(sys.argv[1]))" "$1"; }
MODEL=$(j "c['devices']['ios']['model']"); OS=$(j "c['devices']['ios']['os']")
SCHEME=$(j "c['native']['ios']['scheme']"); SETTLE=$(j "c.get('native',{}).get('settleSeconds',2)")
APPEAR=$(j "c.get('appearance',['light'])[0]")
UDID=$(xcrun simctl list devices -j | python3 -c "
import json,sys
d=json.load(sys.stdin)['devices']
for rt,devs in sorted(d.items()):
  if 'iOS-'+'$OS'.replace('.','-') in rt:
    for x in devs:
      if x['name']=='$MODEL' and x['isAvailable']: print(x['udid']); raise SystemExit
")
[ -n "$UDID" ] || { echo "capture_ios: no available '$MODEL' on iOS $OS — install the runtime or change devices.ios" >&2; exit 2; }
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl status_bar "$UDID" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
xcrun simctl ui "$UDID" appearance "$APPEAR" || true
mkdir -p "$RUN/screenshots" "$RUN/raw"
python3 -c "import json;[print(s['slug']+'\t'+s['url']) for s in json.load(open('$RUN/inventory.json'))]" | while IFS=$'\t' read -r SLUG URL; do
  BASE="${SLUG}__ios__${APPEAR}"
  xcrun simctl openurl "$UDID" "${SCHEME}://${URL#/}" || { echo "capture_ios: deep link failed for $URL" >&2; continue; }
  sleep "$SETTLE"
  xcrun simctl io "$UDID" screenshot --type=png "$RUN/screenshots/$BASE.png" >/dev/null
  if command -v maestro >/dev/null; then maestro --udid "$UDID" hierarchy > "$RUN/raw/$BASE.maestro.json" 2>/dev/null || true; fi
done
xcrun simctl status_bar "$UDID" clear
echo "capture_ios: done ($UDID)"
