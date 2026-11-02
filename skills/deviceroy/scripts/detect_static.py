#!/usr/bin/env python3
"""Step 3. Pattern detectors over each screen's source files -> <run>/static.json.

Scripts, not judgment: every tag is a regex (or a bounded window scan) over comment-stripped
source. A screen's files = its own sources + depth-1 local imports + chrome (layouts, shell).
Hits carry file:line and the matched line, capped at 12 per tag per screen (stable order).
"""
import re, sys
from pathlib import Path
from _common import dump, run_config, load

I = re.I
TAGS = [
    # navigation
    ("tabs.js", r"@react-navigation/bottom-tabs|createBottomTabNavigator|createMaterialBottomTabNavigator|import\s*\{[^}]*\bTabs\b[^}]*\}\s*from\s*['\"]expo-router['\"]|<Tabs[\s>]|BottomNavigationBar\(|CupertinoTabBar\(", 0),
    ("tabs.native", r"unstable-native-tabs|\bNativeTabs\b|react-native-bottom-tabs|CupertinoTabScaffold|NavigationBar\(|\bTabView\s*[({]|\bTab\(\s*\"", 0),
    ("drawer", r"createDrawerNavigator|@react-navigation/drawer|expo-router/drawer|\bDrawer\b|Bars3Icon|HamburgerIcon|line\.3\.horizontal|\bhamburger\b|Icons\.menu\b|name=[\"']menu[\"']", 0),
    ("back.custom", r"headerLeft\s*[:=]|headerBackVisible\s*:\s*false|navigate\(\s*-1\s*\)|router\.back\(|navigation\.goBack\(|history\.back\(|aria-label=[\"'`{]+Back\b|>\s*Back\s*<|<BackButton\b|\bback=\{\{\s*to\b|label\s*:\s*['\"]Back\b", 0),
    ("back.intercept", r"BackHandler\.addEventListener|onBackPressed|usePreventRemove|['\"]beforeRemove['\"]|popstate|WillPopScope|\bPopScope\b", 0),
    ("rail", r"NavigationRail|navigation-rail|NavigationSuiteScaffold|\bRail\b|WindowSizeClass|useWindowDimensions", 0),
    # bars
    ("header.opaque", r"headerStyle\s*:\s*\{[^}]*backgroundColor|headerTransparent\s*:\s*false|(?:sticky|fixed)\b[^\"'`]*\btop-0\b(?![^\"'`]*backdrop-blur)[^\"'`]*\bbg-[a-z]+(?:-\d+)?\b(?!/)", 0),
    ("glass", r"backdrop-blur|backdrop-filter|backdropFilter|\bBlurView\b|\bGlassView\b|glassEffect|expo-glass-effect|UIVisualEffectView|\.(?:ultraThin|thin|regular|thick)Material\b|BackdropFilter\(", 0),
    ("ellipsis.horizontal", r"\bMoreHorizontal\b|\bMoreHoriz\b|\bEllipsisHorizontal\w*|\bEllipsis\b(?!Vertical)|more_horiz|DotsHorizontal\w*|[\"']ellipsis(?:\.circle)?[\"']|ellipsis-horizontal|>\s*[⋯…]\s*<", 0),
    ("ellipsis.vertical", r"\bMoreVertical\b|\bMoreVert\b|EllipsisVertical\w*|more_vert|DotsVertical\w*|ellipsis-vertical", 0),
    ("search", r"type=[\"']search|placeholder=[\"'][^\"']*search|\bSearchBar\b|headerSearchBarOptions|Stack\.SearchBar|\.searchable\(|SearchAnchor|role=[\"']search", I),
    # menus
    ("menu.native", r"@react-native-menu/menu|\bMenuView\b|from\s+['\"]zeego|Link\.Menu|@expo/ui/(?:swift-ui|jetpack-compose)|\bUIMenu\b|\.contextMenu\b|PopupMenuButton|MenuAnchor\(|\bPullDownButton\b", 0),
    ("menu.custom", r"role=[\"']menu[\"']|aria-haspopup=[\"'{]*(?:menu|listbox|true)\b|\bPopover\b|\bDropdown\w*|react-native-element-dropdown|react-native-modal-dropdown|react-native-dropdown-picker|@radix-ui/react-(?:dropdown-menu|popover)|@headlessui", 0),
    ("actionsheet", r"ActionSheetIOS|showActionSheetWithOptions|@expo/react-native-action-sheet|CupertinoActionSheet|\bActionSheet\b|confirmationDialog\(", 0),
    ("longpress", r"onLongPress|onContextMenu|Link\.Menu|\bContextMenu\b|\.contextMenu\b|onLongPressGesture|delayLongPress", 0),
    ("destructive", r"destructive|isDestructive|>\s*(?:Delete|Remove|Sign out|Log out|Cancel (?:plan|subscription|membership))\b|[\"'](?:Delete|Remove) [a-z]|[\"'](?:Sign out|Log out)[\"']", 0),
    ("destructive.role", r"destructive\s*:\s*true|role\s*:\s*['\"]destructive|style\s*:\s*['\"]destructive|isDestructiveAction|role:\s*\.destructive|attributes\s*:\s*\{\s*destructive", 0),
    ("create", r"aria-label=[\"'](?:New|Create|Add|Compose)\b|>\s*(?:New|Create|Compose)\s+\w+\s*<|\bPlusIcon\b|\bPlus\b(?=[\s/>])|[\"']plus[\"']|add_circle|name=[\"']add", 0),
    ("fab", r"FloatingActionButton|\bFAB\b|FloatingActionButtonMenu|SplitButton|ExtendedFloatingActionButton", 0),
    # sheets & dialogs
    ("sheet.native", r"presentation\s*:\s*['\"](?:formSheet|pageSheet)|sheetAllowedDetents|presentationDetents|\.sheet\(|ModalBottomSheet|showModalBottomSheet|@expo/ui.*BottomSheet", 0),
    ("sheet.custom", r"@gorhom/bottom-sheet|react-native-modal\b|react-native-raw-bottom-sheet|\bBottomSheet\b|<Sheet\b|\bSheet\s*\(|function\s+\w*Sheet\b|inset-x-0\s+bottom-0", 0),
    ("sheet.handle", r"\bhandle\b|grabber|drag-handle|DragHandle|showDragHandle|sheetGrabberVisible|\bh-1(?:\.5)?\s+w-(?:8|9|10|12)\s+rounded-full", 0),
    ("dialog.custom", r"role=[\"']alertdialog|ConfirmDialog|ConfirmModal|<Modal\b[^>]*>|\bDialog\b", 0),
    ("dialog.native", r"Alert\.alert|Alert\.prompt|showDialog\(|AlertDialog\(|\.alert\(|confirmationDialog\(|window\.confirm\(", 0),
    ("confirm.text", r"Are you sure|>\s*Confirm\s*<|['\"]Confirm['\"]", 0),
    # controls
    ("switch.custom", r"role=[\"']switch|CupertinoSwitch\(|\bToggleSwitch\b", 0),
    ("switch.native", r"<Switch\b|Switch\.adaptive|\bToggle\(", 0),
    ("segmented", r"@react-native-segmented-control|SegmentedControl|CupertinoSegmentedControl|CupertinoSlidingSegmentedControl|pickerStyle\(\.segmented\)|variant=[\"']segmented", 0),
    ("picker.wheel", r"@react-native-picker/picker|display=[\"']spinner|CupertinoPicker|CupertinoDatePicker|pickerStyle\(\.wheel\)", 0),
    ("ios.only", r"ActionSheetIOS|DatePickerIOS|@expo/ui/swift-ui", 0),
    ("android.only", r"ToastAndroid|@expo/ui/jetpack-compose", 0),
    ("select", r"<select\b|<Picker\b|<Dropdown\b|\bSelect\b(?=[\s>])|role=[\"']listbox|role=[\"']radiogroup", 0),
    ("choice.state", r"aria-checked|aria-selected|aria-pressed|aria-current|role=[\"']menuitemradio|isSelected|selected=\{|checked=\{|\bCheckIcon\b|\bCheck\b(?=[\s/>])", 0),
    # icons
    ("icons.sf", r"expo-symbols|\bSymbolView\b|\bsf\s*[:=]\s*[\"'{]|systemName\s*:|Image\(systemName|sf-symbols", 0),
    ("icons.material", r"\bmd\s*[:=]\s*[\"'{]|MaterialIcons|MaterialCommunityIcons|material-symbols|Icons\.\w+|androidSrc|drawable", 0),
    ("icons.generic", r"lucide|heroicons|react-native-vector-icons|@expo/vector-icons|phosphor|react-feather|\.svg[\"'?]|<Icon\b", 0),
    # platform & layout
    ("platform.branch", r"Platform\.OS|Platform\.select|\.ios\.[jt]sx?|\.android\.[jt]sx?|defaultTargetPlatform|Theme\.of\(context\)\.platform|#if\s+os\(|data-platform|\bplatform\s*===|isIOS|isAndroid", 0),
    ("fontsize.fixed", r"allowFontScaling=\{false\}|maxFontSizeMultiplier=\{1(?:\.0)?\}|text-\[\d+(?:\.\d+)?px\]|font-size:\s*\d+px|fontSize:\s*['\"]\d+px|\.font\(\.system\(size:|TextScaler\.noScaling|textScaleFactor:\s*1(?:\.0)?\b", 0),
    ("safearea", r"react-native-safe-area-context|SafeAreaView|useSafeAreaInsets|safe-area-inset|SafeArea\(|ignoresSafeArea|WindowInsets|enableEdgeToEdge", 0),
    ("dynamic.color", r"useMaterialColors|dynamicColor|DynamicColor|MaterialTheme\.colorScheme|ColorScheme\.fromSeed|PlatformColor\(|DynamicColorIOS", 0),
]
COMPILED = [(t, re.compile(rx, fl)) for t, rx, fl in TAGS]
# Tags whose signal is the dependency itself; every other tag needs USAGE, so import/export
# lines (and multi-line import member lists, and barrel re-exports) don't count for them.
IMPORT_OK = {"tabs.js", "tabs.native", "drawer", "menu.native", "menu.custom", "actionsheet", "sheet.custom", "sheet.native",
             "glass", "icons.sf", "icons.material", "icons.generic", "segmented", "picker.wheel", "safearea", "dynamic.color",
             "ios.only", "android.only"}
IMPORT_LINE = re.compile(r"^\s*(?:import\b|export\s*(?:\*|\{[^}]*\})\s*from\b|export\s*\{\s*default\s+as\b)")


def import_lines(lines):
    out, inside = set(), False
    for n, line in enumerate(lines, 1):
        if inside or IMPORT_LINE.search(line):
            out.add(n)
            inside = not re.search(r"\bfrom\s*['\"]|^\s*import\s*['\"]", line) and (inside or line.rstrip().endswith("{") or "{" in line and "}" not in line)
    return out
PROJECT_FILES = ["app.json", "app.config.js", "app.config.ts", "android/app/src/main/AndroidManifest.xml",
                 "android/app/src/main/res/values/styles.xml", "android/app/build.gradle", "android/gradle.properties"]
EDGE_OPTOUT = re.compile(r"edgeToEdgeEnabled[\"']?\s*:\s*false|windowOptOutEdgeToEdgeEnforcement|android:fitsSystemWindows=\"true\"|edgeToEdgeEnabled\s*=\s*false|targetSdkVersion[\"']?\s*[:=]\s*(?:2\d|3[0-5])\b")
CAP = 12


def strip_comments(text, suffix):
    """Blank comments but keep line numbers. Handles /* */, {/* */}, //, and # for yaml-ish files."""
    text = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group(0).count("\n"), text, flags=re.S)
    text = re.sub(r"(^|[^:'\"\\\w])//[^\n]*", r"\1", text)
    return text


SCREEN_DECL = re.compile(r"""<(?:Stack|Tabs|Drawer|NativeTabs)\.(?:Screen|Trigger)\s+name=["']([^"']+)["']""")


def scopes(text):
    """Line ranges of per-route declarations in a layout (<Stack.Screen name="x" ...>) -> [(start, end, name)]."""
    marks = [(text[: m.start()].count("\n") + 1, m.group(1)) for m in SCREEN_DECL.finditer(text)]
    last = text.count("\n") + 1
    return [(ln, (marks[i + 1][0] - 1) if i + 1 < len(marks) else last, name) for i, (ln, name) in enumerate(marks)]


def scan(project, files, names=None):
    """names: route names this screen answers to; a hit inside another route's declaration is dropped."""
    tags = {}
    for rel in files:
        p = project / rel
        try:
            text = strip_comments(p.read_text(errors="ignore"), p.suffix)
        except Exception:
            continue
        lines = text.split("\n")
        sc = scopes(text) if names is not None else []
        foreign = lambda n: any(a <= n <= b and name not in names for a, b, name in sc)
        imports = import_lines(lines)
        for n, line in enumerate(lines, 1):
            if len(line) > 2000 or foreign(n):
                continue
            for t, rx in COMPILED:
                if n in imports and t not in IMPORT_OK:
                    continue
                if rx.search(line):
                    tags.setdefault(t, []).append({"file": rel, "line": n, "text": line.strip()[:140]})
        # window scans (multi-line JSX)
        for m in re.finditer(r"<nav\b", text):
            window = text[m.start(): m.start() + 600]
            if re.search(r"\b(?:fixed|absolute)\b", window) and re.search(r"\bbottom-|bottom:", window):
                n = text[: m.start()].count("\n") + 1
                tags.setdefault("tabs.custom", []).append({"file": rel, "line": n, "text": lines[n - 1].strip()[:140]})
        for m in re.finditer(r"headerRight|toolbarItems|actions\s*:\s*\[|ToolbarItemGroup", text):
            window = text[m.start(): m.start() + 900]
            count = len(re.findall(r"<(?:Pressable|TouchableOpacity|IconButton|HeaderButton|Button|ToolbarItem)\b|IconButton\(", window))
            if count >= 4:
                n = text[: m.start()].count("\n") + 1
                tags.setdefault("toolbar.many", []).append({"file": rel, "line": n, "text": f"{count} actions: " + lines[n - 1].strip()[:110], "count": count})
    for t in tags:
        tags[t] = sorted(tags[t], key=lambda h: (h["file"], h["line"]))[:CAP]
    return tags


def main(run_dir):
    run = Path(run_dir)
    cfg = run_config(run)
    project = Path(cfg["_project"])
    inv = load(run / "inventory.json")
    out = {}
    for s in inv:
        own = s["sources"] + s["imports"]
        names = {part for src in s["sources"] for part in Path(src).with_suffix("").parts} | {s["route"].rstrip("/").split("/")[-1] or "index"}
        out[s["slug"]] = {"own": scan(project, own), "chrome": scan(project, [c for c in s["chrome"] if c not in own], names)}
    proj = []
    for rel in PROJECT_FILES:
        p = project / rel
        if p.exists():
            for n, line in enumerate(p.read_text(errors="ignore").split("\n"), 1):
                if EDGE_OPTOUT.search(line):
                    proj.append({"file": rel, "line": n, "text": line.strip()[:140]})
    out["_project"] = {"edge.optout": proj}
    dump(run / "static.json", out)
    print(f"detect_static: {len(inv)} screens scanned")


if __name__ == "__main__":
    main(sys.argv[1])
