#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) Hamza Gouda
"""Procedural wallpaper generator for the Bordeaux themes (Hallmark direction).

Motif, "Drape": broad satin folds sweeping diagonally across the frame, lit
from the upper left, with the light pooled right of centre and the upper-left
(dock, top bar) kept calm and dark.
Height field from warped sine sums -> normal map -> diffuse + anisotropic
sheen + specular, mapped through a per-variant tone ramp, then grain and
TPDF dither so there is no banding.

Deterministic: the same --seed always gives the same pixels. Colours come from
tokens/tokens.toml. Needs only Pillow and numpy.

  tools/make_wallpapers.py                      # all variants -> wallpapers/
  tools/make_wallpapers.py --variant Bordeaux --seed 7 --out /tmp/wp
  tools/make_wallpapers.py --variant Bordeaux --preview 1280x800 --out /tmp/wp
"""
import argparse
import tomllib
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
F = np.float32
MAX_BYTES = 1_500_000            # cap for the 3840x2400 JPEG


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], F) / 255.0


def lin(c):                      # sRGB -> linear, so blends and light are physical
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(F)


def srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055).astype(F)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return a + (b - a) * t


def ramp(t, stops):
    """Piecewise-linear colour ramp; t is (h, w) in [0, 1], stops [(pos, rgb)]."""
    t = np.clip(t, 0, 1)
    out = np.empty(t.shape + (3,), F)
    for c in range(3):
        out[..., c] = np.interp(t, [p for p, _ in stops], [col[c] for _, col in stops])
    return out


# --------------------------------------------------------------------------
# Per-variant look. Everything is derived from palette tokens.
# --------------------------------------------------------------------------
def look(pal, name, dark):
    bg, acc, hi = hex_rgb(pal["bg-0"]), hex_rgb(pal["accent"]), hex_rgb(pal["accent-hi"])
    gold, fg = hex_rgb(pal["gold"]), hex_rgb(pal["fg-0"])
    grey = lambda c, k: mix(c, np.full(3, c.mean(), F), k)
    if name == "Oxblood-Noir":   # same drape, carbon-neutral, lower key
        stops = [(0.00, bg * 0.55),
                 (0.24, mix(bg, grey(acc, 0.35), 0.30)),
                 (0.52, mix(bg, grey(acc, 0.15), 0.78)),
                 (0.78, acc * 1.08),
                 (1.00, mix(hi, fg, 0.22) * 1.15)]
        return dict(stops=stops, spec=mix(hi, fg, 0.6), spec_k=0.40, sheen=acc,
                    sheen_k=0.22, pool=0.92, floor=0.20,
                    grain=0.0065)
    if dark:                     # Bordeaux, Quiet Wine
        stops = [(0.00, bg * 0.60),
                 (0.24, mix(bg, acc, 0.42) * 0.90),
                 (0.52, acc * 1.02),
                 (0.78, hi * 1.18),
                 (1.00, mix(hi, gold, 0.35) * 1.45)]
        return dict(stops=stops, spec=mix(hi, fg, 0.5), spec_k=0.45, sheen=hi,
                    sheen_k=0.30, pool=1.0, floor=0.24,
                    grain=0.0070)
    # Merlot-Day: ivory satin with merlot in the shadows of the folds
    b1 = hex_rgb(pal["bg-1"])
    stops = [(0.00, mix(bg * 0.60, acc, 0.46)),
             (0.24, mix(bg * 0.84, acc, 0.20)),
             (0.50, mix(bg * 0.95, acc, 0.06)),
             (0.75, bg),
             (1.00, mix(b1, np.ones(3, F), 0.35))]
    return dict(stops=stops, spec=np.ones(3, F), spec_k=0.30, sheen=b1, sheen_k=0.10,
                pool=1.0, floor=0.42, grain=0.0055)


# --------------------------------------------------------------------------
def drape(w, h, seed):
    """Return (height, fold-axis coordinate) in unit space (frame height = 1)."""
    r = np.random.default_rng(seed)
    p = r.uniform(-0.25, 0.25, 6).astype(F)          # small, seed-driven phase drift
    yy, xx = np.mgrid[0:h, 0:w].astype(F)
    x, y = xx / F(h), yy / F(h)
    del xx, yy
    a = np.deg2rad(-30.0)
    u = (x * np.cos(a) - y * np.sin(a)).astype(F)    # along the folds
    v = (x * np.sin(a) + y * np.cos(a)).astype(F)    # across the folds
    # the cloth twists: across-fold coordinate warped by the along-fold one
    vv = v + 0.085 * np.sin(u * 2.2 + 0.7 + p[0]) + 0.040 * np.sin(u * 4.1 - v * 2.0 + 1.9 + p[1])
    ph = vv * 8.6 + 0.70 * np.sin(u * 1.6 + 0.2 + p[2])
    # asymmetric fold profile: soft bulge, tighter crease
    hgt = (np.sin(ph) + 0.30 * np.sin(2 * ph + 0.9)) * 0.62
    hgt += np.sin(vv * 2.3 - u * 0.9 + 1.0 + p[3]) * 0.80          # broad swell
    hgt += np.sin(vv * 15.0 + u * 2.6 + 0.4 + p[4]) * 0.045        # fine ripple
    return x, y, hgt.astype(F), ph.astype(F)


def render(pal, name, dark, w, h, seed, plain=False):
    L = look(pal, name, dark)
    x, y, hgt, ph = drape(w, h, seed)
    px = F(1.0 / h)                                  # unit size of one pixel

    # normals from the height field (unit-space slope)
    gy, gx = np.gradient(hgt)
    k = F(0.36) / px
    gx *= -k
    gy *= -k
    inv = 1.0 / np.sqrt(gx * gx + gy * gy + 1.0)
    nx, ny, nz = gx * inv, gy * inv, inv
    del gx, gy, inv

    Ld = np.array([-0.50, -0.62, 0.60], F); Ld /= np.linalg.norm(Ld)
    Hv = Ld + np.array([0, 0, 1], F); Hv /= np.linalg.norm(Hv)
    ndl = np.clip(nx * Ld[0] + ny * Ld[1] + nz * Ld[2], 0, 1)
    ndh = np.clip(nx * Hv[0] + ny * Hv[1] + nz * Hv[2], 0, 1)
    del nx, ny, nz

    # where the light lands: a soft pool right of centre, calm upper left
    pool = np.exp(-((x - 1.08) ** 2 / 0.50 + (y - 0.60) ** 2 / 0.34)).astype(F)
    calm = smoothstep(0.0, 1.0, np.hypot(x * 0.9, y * 1.1) / 0.95)   # 0 at top-left
    lightmap = (L["floor"] + (1 - L["floor"]) * pool * L["pool"]) * (0.55 + 0.45 * calm)
    occl = 0.62 + 0.38 * smoothstep(-1.6, 1.4, hgt)  # valleys sit deeper

    tone = (0.10 + 0.90 * ndl ** 1.35) * occl * lightmap
    if not dark:
        tone = 0.22 + 0.78 * tone / 0.70
    tone = np.clip(tone * 1.08, 0, 1)
    img = lin(ramp(tone, L["stops"]))
    del tone, occl

    sheen = (ndh ** 5) * pool
    spec = (ndh ** 48) * pool
    img += sheen[..., None] * lin(L["sheen"]) * L["sheen_k"]
    img += spec[..., None] * lin(L["spec"]) * L["spec_k"]
    del sheen, spec, ndh, ndl

    # vignette (dark only) for depth at the edges
    if dark:
        vig = 1 - 0.30 * smoothstep(0.35, 1.05, np.hypot((x - 0.85) / 1.0, (y - 0.55) / 0.75))
        img *= vig[..., None]
    del x, y, hgt, ph, pool

    out = srgb(img)
    del img
    rng = np.random.default_rng(seed + 1)
    g1 = rng.standard_normal((h, w)).astype(F)
    g1 = (g1 + 0.6 * np.roll(g1, 1, 0) + 0.6 * np.roll(g1, 1, 1)) / 1.39   # slightly soft grain
    out += (g1 * (L["grain"] * (0.5 if plain else 1.0)))[..., None]
    del g1
    tp = (rng.random((h, w), F) - rng.random((h, w), F)) / 255.0         # TPDF dither
    out += tp[..., None]
    return Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")


def save_jpeg(im, path, quality, cap=None):
    q = quality
    while True:
        im.save(path, quality=q, subsampling=0, optimize=True, progressive=True)
        if cap is None or path.stat().st_size <= cap or q <= 70:
            return q
        q -= 2


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--variant", help="variant name (default: all)")
    ap.add_argument("--seed", type=int, default=20)
    ap.add_argument("--out", type=Path, default=ROOT / "wallpapers")
    ap.add_argument("--quality", type=int, default=92)
    ap.add_argument("--preview", metavar="WxH", help="render one PNG at this size only")
    a = ap.parse_args()

    with open(ROOT / "tokens" / "tokens.toml", "rb") as fh:
        variants = tomllib.load(fh)["variant"]
    names = [a.variant] if a.variant else list(variants)
    for n in names:
        if n not in variants:
            ap.error(f"unknown variant {n!r}; have {', '.join(variants)}")
    a.out.mkdir(parents=True, exist_ok=True)

    for n in names:
        v = variants[n]
        dark = v["scheme"] == "dark"
        pal = v["palette"]
        if a.preview:
            w, h = (int(s) for s in a.preview.lower().split("x"))
            p = a.out / f"{n}-preview.png"
            render(pal, n, dark, w, h, a.seed).save(p)
            print(p)
            continue
        for (w, h, name, cap) in ((3840, 2400, f"{n}.jpg", MAX_BYTES),
                                  (1920, 1080, f"{n}-1080p.jpg", None)):
            p = a.out / name
            q = save_jpeg(render(pal, n, dark, w, h, a.seed), p, a.quality, cap)
            print(p, p.stat().st_size // 1024, "KB", f"q{q}")
        if dark:   # GRUB: the same drape, gentler grain
            (a.out / "grub").mkdir(exist_ok=True)
            p = a.out / "grub" / f"{n}.png"
            render(pal, n, dark, 1024, 768, a.seed, plain=True).save(p, optimize=True)
            print(p, p.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
