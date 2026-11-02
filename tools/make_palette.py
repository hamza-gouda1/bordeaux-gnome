#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) Hamza Gouda
"""Draw docs/palette.svg from tokens/tokens.toml."""
import pathlib
import tokenlib as tl

ROOT = pathlib.Path(__file__).resolve().parent.parent
VARIANTS = [("Bordeaux", "dark"), ("Oxblood-Noir", "dark"), ("Merlot-Day", "light")]
SWATCHES = [("window", "bg-1"), ("view", "bg-0"),
            ("header", "bg-2"), ("sidebar", "sidebar"),
            ("accent", "accent"), ("text", "fg-0")]

W, ROW, SW, X0 = 760, 96, 96, 150
data = tl.load()
out = ['<!-- SPDX-License-Identifier: GPL-3.0-or-later -->',
       '<!-- Copyright (C) Hamza Gouda -->', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {40 + ROW * len(VARIANTS)}" '
       f'font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">',
       f'<rect width="{W}" height="{40 + ROW * len(VARIANTS)}" rx="12" fill="#ffffff"/>']
for i, (name, mode) in enumerate(VARIANTS):
    colors = tl.variant_tokens(data, name)
    y = 24 + i * ROW
    out.append(f'<text x="20" y="{y + 34}" font-size="15" font-weight="700" fill="#1f2328">{name.replace("-", " ")}</text>')
    out.append(f'<text x="20" y="{y + 54}" font-size="12" fill="#59636e">{mode}</text>')
    for j, (label, key) in enumerate(SWATCHES):
        x = X0 + j * (SW + 4)
        c = colors[key]
        out.append(f'<rect x="{x}" y="{y}" width="{SW}" height="52" rx="6" fill="{c}" stroke="#d0d7de"/>')
        out.append(f'<text x="{x}" y="{y + 68}" font-size="11" fill="#1f2328">{label}</text>')
        out.append(f'<text x="{x + SW}" y="{y + 68}" font-size="11" text-anchor="end" fill="#59636e">{c.upper()}</text>')
out.append("</svg>")
(ROOT / "docs").mkdir(exist_ok=True)
(ROOT / "docs" / "palette.svg").write_text("\n".join(out) + "\n")
print("wrote docs/palette.svg")
