#!/usr/bin/env python3
"""Self-check for detect_static's SwiftUI pager rule: a TabView styled .page is not a tab bar.
usage: python3 test_detect.py"""
from detect_static import paged_tabview


def paged(src):
    lines = src.split("\n")
    return paged_tabview(src, lines, next(n for n, l in enumerate(lines, 1) if "TabView" in l))


assert paged('TabView(selection: $page) {\n  ForEach(0..<3) { i in Text("x") }\n}\n.tabViewStyle(.page(indexDisplayMode: .never))')
assert paged("TabView { Text(\"a\") }.tabViewStyle(PageTabViewStyle())")
assert not paged('TabView {\n  Tab("Home", systemImage: "house") { Home() }\n}\n.tabViewStyle(.sidebarAdaptable)\nTabView { Text("x") }.tabViewStyle(.page)')
assert not paged("TabView {\n  Text(\"a\")\n}")
print("test_detect: ok")
