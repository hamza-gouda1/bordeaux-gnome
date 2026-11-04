#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) Hamza Gouda
"""Check WCAG 2.1 contrast for the pairs listed in tokens/tokens.toml.

Every [[contrast.pair]] (fg, bg, min) is checked against each variant's
palette. A translucent background is composited over the `over` token
(default bg-0); a translucent foreground is composited over its background.
Thresholds: 4.5 for text, 3.0 for UI components.

Exit status is 1 if any pair is below its minimum.

Usage:
    tools/check_contrast.py            # check every variant
    tools/check_contrast.py --pair FG BG
"""

import argparse
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import tokenlib as tl  # noqa: E402

AA = 4.5
AAA = 7.0


def grade(r):
    return "AAA" if r >= AAA else ("AA" if r >= AA else ("UI" if r >= 3.0 else "below"))


def pair_ratio(palette, pair):
    bg = tl.parse_color(palette[pair["bg"]])
    if bg[3] < 1.0:
        bg = tl.over(bg, tl.parse_color(palette[pair.get("over", "bg-0")]))
    fg = tl.over(tl.parse_color(palette[pair["fg"]]), bg)
    return tl.ratio(fg, bg)


def pair_scope(pair):
    """Overview references are calibrated to shipped wallpapers, not arbitrary images."""
    return " [shipped wallpaper reference]" if "overview-dim" in (pair["bg"], pair.get("over")) else ""


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--pair", nargs=2, metavar=("FG", "BG"), help="check one hex pair")
    args = ap.parse_args()

    if args.pair:
        fg, bg = (tl.parse_color(c) for c in args.pair)
        if fg is None or bg is None:
            sys.exit("colors must be #rgb, #rrggbb or rgb()/rgba()")
        r = tl.ratio(tl.over(fg, bg), bg)
        print(f"{args.pair[0]} on {args.pair[1]}: {r:.2f}:1 ({grade(r)})")
        sys.exit(0 if r >= AA else 1)

    data = tl.load()
    pairs = data["contrast"]["pair"]
    identities = [tuple(sorted(pair.items())) for pair in pairs]
    if len(set(identities)) != len(identities):
        sys.exit("contrast table contains duplicate pairs")
    failed = checked = 0
    for name, var in data["variant"].items():
        palette = var["palette"]
        print(f"\n{name}")
        for pair in pairs:
            r = pair_ratio(palette, pair)
            ok = r >= pair["min"]
            checked += 1
            failed += not ok
            flag = "" if ok else f"  FAIL (needs {pair['min']})"
            print(f"  {pair['fg']:<12} on {pair['bg']:<13} {r:6.2f}:1  {grade(r)}{pair_scope(pair)}{flag}")
    print(f"\n{checked - failed}/{checked} pairs pass.")
    print("Overview pairs use shipped-wallpaper references; custom wallpapers require rendered review.")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
