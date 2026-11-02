#!/usr/bin/env bash
# Step 2 (Android, evidence V). Demo-mode status bar, animations off, deep link each screen,
# screenshot, and dump the uiautomator hierarchy. Restores animation scales on exit.
# usage: capture_android.sh <runDir>     requires: adb + a running emulator with a dev build; config.native.android.scheme
set -euo pipefail
RUN="$1"; CFG="$RUN/config.json"
j() { python3 -c "import json,sys;c=json.load(open('$CFG'));print(eval(sys.argv[1]))" "$1"; }
SCHEME=$(j "c['native']['android']['scheme']"); SETTLE=$(j "c.get('native',{}).get('settleSeconds',2)")
APPEAR=$(j "c.get('appearance',['light'])[0]")
adb get-state >/dev/null || { echo "capture_android: no device/emulator attached" >&2; exit 2; }
restore() {
  for k in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global $k 1; done
  adb shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null || true
}
trap restore EXIT
for k in window_animation_scale transition_animation_scale animator_duration_scale; do adb shell settings put global $k 0; done
adb shell settings put global sysui_demo_allowed 1
D="adb shell am broadcast -a com.android.systemui.demo"
$D -e command enter >/dev/null
$D -e command clock -e hhmm 0941 >/dev/null
$D -e command battery -e level 100 -e plugged false >/dev/null
$D -e command network -e mobile show -e level 4 -e datatype none >/dev/null
$D -e command network -e wifi show -e level 4 >/dev/null
$D -e command notifications -e visible false >/dev/null
adb shell "cmd uimode night $([ "$APPEAR" = dark ] && echo yes || echo no)" >/dev/null || true
mkdir -p "$RUN/screenshots" "$RUN/raw"
python3 -c "import json;[print(s['slug']+'\t'+s['url']) for s in json.load(open('$RUN/inventory.json'))]" | while IFS=$'\t' read -r SLUG URL; do
  BASE="${SLUG}__android__${APPEAR}"
  adb shell am start -W -a android.intent.action.VIEW -d "'${SCHEME}://${URL#/}'" >/dev/null || { echo "capture_android: deep link failed for $URL" >&2; continue; }
  sleep "$SETTLE"
  adb exec-out screencap -p > "$RUN/screenshots/$BASE.png"
  adb shell uiautomator dump /sdcard/deviceroy.xml >/dev/null && adb exec-out cat /sdcard/deviceroy.xml > "$RUN/raw/$BASE.uiautomator.xml"
done
echo "capture_android: done"
