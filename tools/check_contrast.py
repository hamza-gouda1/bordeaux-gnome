#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Check WCAG 2.1 contrast for every foreground/background pair the themes define.

Colors are read from the `@define-color` lines in each variant's GTK CSS, so
the check always tests the palette that actually ships. A pair is any
`<name>_fg_color` with a matching `<name>_bg_color` (plus GTK 3's
`theme_*` names). Translucent colors are composited first: a translucent
background over the window background, a translucent foreground over its
background.

Exit status is 1 if any theme pair is below WCAG AA (4.5:1). The status
colors (destructive, success, warning, error) keep GNOME's defaults and are
reported for information only.

Usage:
    tools/check_contrast.py            # check every variant
    tools/check_contrast.py --pair FG BG
"""

import argparse
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
AA = 4.5
AAA = 7.0
INFO_ONLY = {"destructive", "success", "warning", "error"}
GTK3_PAIRS = [
    ("theme (window)", "theme_fg_color", "theme_bg_color"),
    ("theme (view)", "theme_text_color", "theme_base_color"),
    ("theme (selection)", "theme_selected_fg_color", "theme_selected_bg_color"),
]

DEFINE = re.compile(r"@define-color\s+([a-z0-9_]+)\s+([^;]+);", re.I)
HEX = re.compile(r"#([0-9a-f]{3}|[0-9a-f]{6})$", re.I)
RGBA = re.compile(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$", re.I)


def parse_color(text):
    """Return (r, g, b, a) with r/g/b in 0..255 and a in 0..1, or None."""
    text = text.strip()
    m = HEX.match(text)
    if m:
        h = m.group(1)
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 1.0)
    m = RGBA.match(text)
    if m:
        r, g, b = (float(m.group(i)) for i in (1, 2, 3))
        a = float(m.group(4)) if m.group(4) is not None else 1.0
        return (r, g, b, a)
    return None


def over(top, bottom):
    """Composite a possibly translucent color over an opaque one."""
    a = top[3]
    return tuple(top[i] * a + bottom[i] * (1 - a) for i in range(3)) + (1.0,)


def luminance(c):
    def lin(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = (lin(v) for v in c[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def ratio(fg, bg):
    hi, lo = sorted((luminance(fg), luminance(bg)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def load(css_path):
    colors = {}
    for name, value in DEFINE.findall(css_path.read_text()):
        c = parse_color(value)
        if c is not None:
            colors[name.lower()] = c
    return colors


def pairs_for(colors):
    found = []
    for name in sorted(colors):
        if name.endswith("_fg_color") and not name.startswith("theme_"):
            base = name[: -len("_fg_color")]
            bg = f"{base}_bg_color"
            if bg in colors:
                found.append((base, name, bg))
    for label, fg, bg in GTK3_PAIRS:
        if fg in colors and bg in colors:
            found.append((label, fg, bg))
    return found


def check_variant(theme_dir):
    rows = []
    for css in sorted(theme_dir.glob("gtk-*/gtk.css")):
        colors = load(css)
        window = colors.get("window_bg_color") or colors.get("theme_bg_color")
        for label, fg_name, bg_name in pairs_for(colors):
            bg = colors[bg_name]
            if bg[3] < 1.0:
                if window is None:
                    continue
                bg = over(bg, window)
            fg = over(colors[fg_name], bg)
            rows.append((css.parent.name, label, ratio(fg, bg), label.split(" ")[0] in INFO_ONLY))
    return rows


def grade(r):
    return "AAA" if r >= AAA else ("AA" if r >= AA else "below AA")


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pair", nargs=2, metavar=("FG", "BG"), help="check one hex pair")
    args = ap.parse_args()

    if args.pair:
        fg, bg = (parse_color(c) for c in args.pair)
        if fg is None or bg is None:
            sys.exit("colors must be #rgb, #rrggbb or rgb()/rgba()")
        r = ratio(over(fg, bg), bg)
        print(f"{args.pair[0]} on {args.pair[1]}: {r:.2f}:1 ({grade(r)})")
        sys.exit(0 if r >= AA else 1)

    failed = 0
    checked = 0
    for theme_dir in sorted((ROOT / "themes").iterdir()):
        rows = check_variant(theme_dir)
        if not rows:
            continue
        print(f"\n{theme_dir.name}")
        for toolkit, label, r, info in rows:
            note = "  (GNOME default, info only)" if info else ""
            print(f"  {toolkit:<8} {label:<20} {r:6.2f}:1  {grade(r)}{note}")
            if not info:
                checked += 1
                failed += r < AA
    print(f"\n{checked - failed}/{checked} theme pairs meet WCAG AA ({AA}:1).")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
