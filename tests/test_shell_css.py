#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Regression checks on the generated shell sheets.

Popup wrappers must not paint a rectangle. St clips a blurred box-shadow on a BoxPointer
child to a hard-edged square box, which showed as a dim rectangle around every panel
popup, so those selectors carry no shadow and no fill of their own on the wrappers.
The overview backdrop must not be the stock flat #222222.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# Selectors whose own rule must never carry a drop shadow (nodes inside a BoxPointer).
NO_SHADOW = {".popup-menu-content", ".quick-settings", ".candidate-popup-content"}
# Wrapper nodes that must never get a fill: the popup content owns the slab.
NO_FILL = {".popup-menu-boxpointer", ".candidate-popup-boxpointer", ".popup-menu",
           ".datemenu-popover", "#calendarArea", ".quick-settings-box", ".panel-menu",
           ".popup-menu.panel-menu", "#panelMenuBoxLayout"}


def rules(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        sels = [s.strip() for s in m.group(1).split(",")]
        yield sels, m.group(2)


def main():
    bad = []
    for sheet in sorted((ROOT / "themes").glob("*/gnome-shell/gnome-shell.css")):
        name = sheet.parent.parent.name
        overview = False
        for sels, body in rules(sheet.read_text()):
            decls = dict(d.split(":", 1) for d in body.replace("\n", "").split(";") if ":" in d)
            decls = {k.strip(): v.strip() for k, v in decls.items()}
            shadow = decls.get("box-shadow", "none").replace("!important", "").strip()
            for s in sels:
                if s in NO_SHADOW and shadow != "none":
                    bad.append(f"{name}: {s} has box-shadow {shadow}")
                if s in NO_FILL and any(k in decls for k in ("background-color", "background-gradient-start", "box-shadow")):
                    if decls.get("background-color", "transparent") not in ("transparent", "none") \
                            or "background-gradient-start" in decls or shadow != "none":
                        bad.append(f"{name}: wrapper {s} paints a fill or shadow")
                if s == "#overviewGroup":
                    overview = True
                    if decls.get("background-color", "").lower() == "#222222":
                        bad.append(f"{name}: #overviewGroup is the flat stock #222222")
        if not overview:
            bad.append(f"{name}: no #overviewGroup rule")
    pre = (ROOT / "presets" / "Bordeaux.preset").read_text()
    for need in ("blur-my-shell.overview blur true", "blur-my-shell.overview pipeline 'pipeline_bordeaux_overview'",
                 "blur-my-shell.popup blur false", "'pipeline_bordeaux_overview'"):
        if need not in pre:
            bad.append(f"preset lacks: {need}")
    if "'unscaled_radius': <0>" not in pre:
        bad.append("overview pipeline is not radius 0 (static dim, no blur)")
    if bad:
        print("\n".join(bad), file=sys.stderr)
        sys.exit(1)
    print("shell css regression checks passed")


if __name__ == "__main__":
    main()
