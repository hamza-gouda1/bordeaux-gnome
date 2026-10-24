#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""The per-variant JSON that drives light/dark following (tools/build.py output).

Checks that the committed files match a fresh render and that they hold exactly
the preset keys that differ between variants. Run: python3 tests/test_follow_json.py
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
import build  # noqa: E402

bad = []
files = build.render_all()
gen = {p: t for p, t in files.items() if p.parent == build.FOLLOW_DIR}
if sorted(p.name for p in gen) != ["Bordeaux.json", "Merlot-Day.json", "Oxblood-Noir.json"]:
    bad.append(f"unexpected JSON set: {sorted(gen)}")
for rel, text in gen.items():
    if (ROOT / rel).read_text() != text:
        bad.append(f"{rel} is stale (run tools/build.py)")

presets = {}
for v in ("Bordeaux", "Oxblood-Noir", "Merlot-Day"):
    rows = {}
    for line in (ROOT / "presets" / f"{v}.preset").read_text().splitlines():
        if line.strip() and not line.startswith("#"):
            g, s, k, val = line.split(None, 3)
            rows[(s, k)] = val
    presets[v] = rows
differ = {k for k in presets["Bordeaux"] if len({presets[v].get(k) for v in presets}) > 1}
for v in presets:
    doc = json.loads((ROOT / build.FOLLOW_DIR / f"{v}.json").read_text())
    keys = {(e["schema"], e["key"]) for e in doc["keys"]}
    if keys != differ:
        bad.append(f"{v}: keys {sorted(keys ^ differ)} differ from the varying preset keys")
    for e in doc["keys"]:
        want = presets[v][(e["schema"], e["key"])]
        if e["value"] != want.removeprefix("merge:") or e["merge"] != want.startswith("merge:"):
            bad.append(f"{v}: {e['schema']} {e['key']} does not match the preset")
    if doc["scheme"] == "dark" and doc["gtkTheme"] != "Yaru-dark" or doc["scheme"] == "light" and doc["gtkTheme"] != "Yaru":
        bad.append(f"{v}: GTK theme {doc['gtkTheme']} for a {doc['scheme']} variant")
    if doc["terminalProfile"] != build.TERMINAL_UUIDS[v]:
        bad.append(f"{v}: wrong Terminal profile")

if bad:
    print("\n".join(["FAIL:"] + bad))
    sys.exit(1)
print(f"follow JSON ok ({len(differ)} varying keys)")
