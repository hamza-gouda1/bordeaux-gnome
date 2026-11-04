#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) Hamza Gouda
"""Regression checks on the generated shell sheets.

Popup wrappers must not paint a rectangle. St clips a blurred box-shadow on a BoxPointer
child to a hard-edged square box, which showed as a dim rectangle around every panel
popup, so those selectors carry no shadow and no fill of their own on the wrappers.
The overview backdrop must not be the stock flat #222222.

The rest pin down what the headless QA run (tools/shell_qa.py) found in GNOME 46:
Quick Settings toggles sized in em came out 156px and cut every label, the split
toggle's halves did not join, popups sat flush against the screen edge, the dock slab
had 3px side gaps and 27px end gaps, tracked eyebrow labels lost their last letter,
0.86-alpha slabs showed windows through them with popup blur off, the show-apps glyph
was white on the light dock, the light lock screen was white on pale grey, and every
variant used the Bordeaux aura accent.
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


def decls_for(css, selector):
    """Merged declarations of every rule whose selector list contains `selector`."""
    out = {}
    for sels, body in rules(css):
        if selector in sels:
            for d in body.split(";"):
                if ":" in d:
                    k, v = d.split(":", 1)
                    out[k.strip()] = v.replace("!important", "").strip()
    return out


def px(v):
    m = re.match(r"(-?\d+(?:\.\d+)?)px$", (v or "").strip())
    return float(m.group(1)) if m else None


def alpha(v):
    m = re.match(r"rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$", (v or "").strip())
    return float(m.group(1)) if m else 1.0


def top_bar_and_folder_checks(name, css):
    """Top bar type and icon sizes, and the fully rounded light-glass app-grid folders."""
    bad = []
    btn = decls_for(css, "#panel .panel-button")
    if (px(btn.get("font-size")) or 0) < 16:
        bad.append(f"{name}: top-bar button text is {btn.get('font-size')} (< 16px)")
    if (px(decls_for(css, "#panel .panel-button StLabel").get("font-size")) or 0) < 16:
        bad.append(f"{name}: top-bar indicator labels are below 16px")
    for sel in ("#panel .panel-button .system-status-icon", "#panel .panel-button StIcon"):
        if (px(decls_for(css, sel).get("icon-size")) or 0) < 22:
            bad.append(f"{name}: {sel} icon-size is below 22px")
    for sel in ("#panel .clock-display", "#panel .panel-button.clock-display .clock"):
        c = decls_for(css, sel)
        if (px(c.get("font-size")) or 0) < 17:
            bad.append(f"{name}: {sel} font-size {c.get('font-size')} (< 17px)")
        if "Mono" in c.get("font-family", "Mono"):
            bad.append(f"{name}: {sel} uses a mono face, the clock is proportional Geist")
        if "letter-spacing" in c:
            bad.append(f"{name}: {sel} has letter-spacing")
    if "tnum" not in decls_for(css, "#panel .panel-button.clock-display .clock").get("font-feature-settings", ""):
        bad.append(f"{name}: clock lacks tabular figures")
    if (px(decls_for(css, "#panelCenter").get("margin", "").split()[0]) or 0) * 2 + 40 > \
            (px(decls_for(css, "#panel").get("height")) or 0):
        bad.append(f"{name}: the 40px capsules do not fit the panel height")
    for sel, max_alpha in ((".app-folder", 0.6), (".app-folder-dialog", 0.7)):
        d = decls_for(css, sel)
        radii = d.get("border-radius", "").split()
        if len(set(radii)) != 1 or (px(radii[0]) or 0) < 24:
            bad.append(f"{sel} in {name}: border-radius {d.get('border-radius')!r} must be one value of 24px or more")
        if alpha(d.get("background-color")) >= max_alpha:
            bad.append(f"{name}: {sel} fill {d.get('background-color')} is not translucent glass (alpha < {max_alpha})")
    return bad


def layout_checks(name, css):
    bad = top_bar_and_folder_checks(name, css)
    t = decls_for(css, ".quick-menu-toggle")
    if (px(t.get("min-width")) or 0) < 176 or t.get("min-width") != t.get("max-width"):
        bad.append(f"{name}: Quick Settings toggles need a fixed px width >= 176 (em width cut labels)")
    ltr = decls_for(css, ".quick-menu-toggle .quick-toggle:ltr").get("border-radius", "")
    arrow = decls_for(css, ".quick-menu-toggle .quick-toggle-arrow:ltr").get("border-radius", "")
    if ltr.split()[1:3] != ["0", "0"] or not arrow.startswith("0 "):
        bad.append(f"{name}: split Quick Settings toggle halves do not join ({ltr!r} / {arrow!r})")
    if (px(decls_for(css, ".popup-menu-boxpointer").get("-arrow-rise")) or 0) <= 0:
        bad.append(f"{name}: -arrow-rise 0 puts popups flush against the screen edge")
    pad = decls_for(css, "#dashtodockContainer.left #dash .dash-background").get("padding", "").split()
    if len(pad) != 2 or pad[0] != "0" or (px(pad[1]) or 0) <= 0:
        bad.append(f"{name}: dock slab padding must be '0 <side>' for equal gaps, is {pad}")
    for sel in (".message .message-header .message-source-title", ".datemenu-today-button .day-label"):
        if "letter-spacing" in decls_for(css, sel):
            bad.append(f"{name}: {sel} has letter-spacing (St ellipsizes its last letter)")
    if "color" not in decls_for(css, "#dashtodockContainer .dash-item-container .show-apps .overview-icon"):
        bad.append(f"{name}: the dock show-apps glyph has no theme colour")
    return bad


def preset_checks():
    sys.path.insert(0, str(ROOT / "tools"))
    import tokenlib as tl

    bad = []
    data = tl.load()
    for variant in ("Bordeaux", "Oxblood-Noir", "Merlot-Day"):
        toks = tl.variant_tokens(data, variant)
        pre = (ROOT / "presets" / f"{variant}.preset").read_text()
        if toks:
            a = tl.parse_color(toks["glass-strong"])
            if a[3] < 0.94:
                bad.append(f"{variant}: glass-strong alpha {a[3]} lets windows show through popups")
            acc = "#{:02X}{:02X}{:02X}".format(*(round(c) for c in tl.parse_color(toks["accent"])[:3]))
            if f"bordeaux-aura accent '{acc}'" not in pre:
                bad.append(f"{variant}: preset does not set the aura accent to {acc}")
            if toks["scheme"] == "light" and "lockscreen pipeline 'pipeline_bordeaux_slab'" in pre:
                bad.append(f"{variant}: light lock screen uses the light slab dim (white clock on pale grey)")
        size = int(toks["panel-h"].removesuffix("px"))
        if f"just-perfection panel-size {size}\n" not in pre or size < 56:
            bad.append(f"{variant}: preset panel-size is not the {size}px panel (needs >= 56 for 40px capsules)")
        for need in ("appindicator icon-size 22", "blur-my-shell.appfolder style-dialogs 0",
                     "blur-my-shell.overview style-components 0"):
            if need not in pre:
                bad.append(f"{variant}: preset lacks: {need}")
    return bad


def backdrop_checks():
    sys.path.insert(0, str(ROOT / "tools"))
    from shell_qa import backdrop_sample

    bg0 = (14, 11, 12)
    box = (94, 45, 98, 75)
    measured = backdrop_sample([bg0] * 120, bg0, box)
    assert measured["bg0Distance"] == 0, "opaque fallback must be detected"
    measured = backdrop_sample([(60, 40, 30), (80, 60, 50)] * 60, bg0, box)
    assert measured["meanRgb"] == [70, 50, 40], "mean uses every RGB sample"
    assert measured["bg0Distance"] > 5, "wallpaper must differ from bg-0"


def main():
    backdrop_checks()
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
                    if not 0 < alpha(decls.get("background-color")) <= 0.55:
                        bad.append(f"{name}: #overviewGroup needs a translucent fallback (alpha <= 0.55)")
        if not overview:
            bad.append(f"{name}: no #overviewGroup rule")
        bad += layout_checks(name, sheet.read_text())
    bad += preset_checks()
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
