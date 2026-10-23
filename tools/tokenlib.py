# SPDX-License-Identifier: GPL-3.0-or-later
"""Token loading and colour helpers shared by build.py and check_contrast.py."""

import pathlib
import re
import tomllib

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOKENS = ROOT / "tokens" / "tokens.toml"

HEX = re.compile(r"#([0-9a-f]{3}|[0-9a-f]{6})$", re.I)
RGBA = re.compile(
    r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$", re.I
)


def load():
    with open(TOKENS, "rb") as f:
        return tomllib.load(f)


def parse_color(text):
    """Return (r, g, b, a): r/g/b 0..255, a 0..1; None if not a colour."""
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
    """Composite `top` over `bottom` (bottom assumed opaque)."""
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


def fmt_alpha(a):
    return f"{a:.3f}".rstrip("0").rstrip(".") or "0"


def rgba(c, alpha=None):
    """Format a colour tuple as rgba(); alpha overrides when given."""
    a = c[3] if alpha is None else alpha
    return f"rgba({round(c[0])}, {round(c[1])}, {round(c[2])}, {fmt_alpha(a)})"


def stack(top, bottom):
    """Composite two possibly translucent colours into one (top over bottom)."""
    a = top[3] + bottom[3] * (1 - top[3])
    if a == 0:
        return (0, 0, 0, 0.0)
    rgb = tuple((top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a for i in range(3))
    return rgb + (a,)


def variant_tokens(data, name):
    """Flat token dict for one variant: shared tables, then palette, plus derived."""
    toks = {}
    for table in data["shared"].values():
        toks.update(table)
    var = data["variant"][name]
    toks.update(var["palette"])
    toks["scheme"] = var["scheme"]
    toks["variant"] = name
    toks["description"] = var["description"]

    # Single-layer elevation shadows (St draws one box-shadow per node).
    shadow = parse_color(toks["shadow"])
    for n in "1234":
        toks[f"elev-{n}"] = f"{toks[f'e{n}-geom']} {rgba(shadow, int(toks[f'shadow-a{n}']) / 100)}"

    # Sheen composited into the glass fill: St gradients take two plain colours.
    sheen = parse_color(toks["sheen"])
    toks["slab-top"] = rgba(stack(sheen, parse_color(toks["glass-strong"])))
    toks["island-top"] = rgba(stack(sheen, parse_color(toks["glass"])))
    return toks
