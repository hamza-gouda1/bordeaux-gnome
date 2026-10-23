#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Procedural wallpaper generator for the Bordeaux themes (Hallmark direction).

Deterministic: the same --seed always gives the same pixels. Colours come from
tokens/tokens.toml. Needs only Pillow and numpy.

  tools/make_wallpapers.py                      # all variants -> wallpapers/
  tools/make_wallpapers.py --variant Bordeaux --seed 7 --out /tmp/wp
"""
import argparse
import tomllib
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent


def hex_rgb(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) for i in (0, 2, 4)], np.float32) / 255.0


def smooth_noise(rng, w, h, cells, octaves=4):
    """Fractal value noise in [-1, 1], bicubic-upsampled from coarse grids."""
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = cells * 2 ** o
        gw, gh = n + 3, max(3, int(n * h / w) + 3)
        g = rng.random((gh, gw)).astype(np.float32)
        im = Image.fromarray(g, "F").resize((w, h), Image.BICUBIC)
        out += amp * (np.asarray(im) - 0.5) * 2
        tot += amp
        amp *= 0.5
    return out / tot


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def render(pal, dark, w, h, seed, lines=True, strength=1.0):
    rng = np.random.default_rng(seed)
    S = h / 2400.0                       # scale so look is size-independent
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    nx, ny = xx / w, yy / h

    bg = hex_rgb(pal["bg-0"])
    accent = hex_rgb(pal["accent"])
    gold = hex_rgb(pal["gold"])
    ink = gold if dark else accent       # line colour (spec: gold dark, merlot light)

    # --- base: deep warm vertical gradient, slightly lifted toward the glow
    if dark:
        top, bot = bg * 0.82, bg * 1.12 + 0.004
    else:
        top, bot = bg * 1.03, bg * 0.95
    t = (0.55 * ny + 0.45 * nx)[..., None]
    img = top + (bot - top) * t

    # --- burgundy glow, low-right
    gx, gy = 0.80, 0.90
    d = np.hypot((nx - gx) * w / h, ny - gy)
    glow = np.exp(-(d / 0.55) ** 2) * 0.85 + np.exp(-(d / 0.20) ** 2) * 0.25
    if dark:
        img = img + glow[..., None] * accent * 0.50
        # soft vignette
        v = np.hypot((nx - 0.5) * 1.1, (ny - 0.5)) ** 2
        img *= (1 - 0.35 * v)[..., None]
    else:
        img = img * (1 - glow[..., None] * 0.0) + glow[..., None] * (accent * 0.55 + 0.45 * bg - bg) * 0.30

    # --- contour field: warped concentric distance from a point past the corner
    if lines:
        warp = smooth_noise(rng, w, h, 3, 4) * 0.045 * h
        warp2 = smooth_noise(rng, w, h, 8, 3) * 0.004 * h
        cx, cy = w * 1.02, h * 1.08
        r = np.hypot(xx - cx, (yy - cy) * 1.05) + warp + warp2
        spacing = 44.0 * S
        f = r / spacing
        gyr, gxr = np.gradient(f)
        gm = np.hypot(gxr, gyr) + 1e-6               # field units per pixel
        fr = f - np.floor(f + 0.5)                   # distance to nearest line (field units)
        dist_px = np.abs(fr) / gm
        wpx = 0.75 * max(S, 0.6)                     # hairline width
        cover = 1 - smoothstep(wpx * 0.5, wpx * 0.5 + 1.0, dist_px)
        idx = np.floor(f + 0.5).astype(np.int32)
        major = (idx % 5 == 0).astype(np.float32)
        # fade lines out away from the corner so the upper-left stays calm
        reach = np.exp(-(np.hypot((nx - 1.0) * w / h, ny - 1.0) / 1.15) ** 2)
        mod = 0.30 + 0.70 * smoothstep(0.0, 1.0, reach)
        a_base = 0.085 if dark else 0.060
        alpha = cover * (a_base * (1 + 0.8 * major)) * mod * strength
        img = img * (1 - alpha[..., None]) + ink * alpha[..., None]

        # sparing gold hairline: one index contour, lit over a short arc only
        k = 15
        sel = (idx == k).astype(np.float32)
        ang = np.arctan2(-(yy - cy), -(xx - cx))
        lit = smoothstep(0.10, 0.45, ang) * (1 - smoothstep(0.55, 0.90, ang))
        ga = cover * sel * lit * (0.34 if dark else 0.40) * strength
        img = img * (1 - ga[..., None]) + gold * ga[..., None]

    # --- grain / dither: luminance noise, a little over 1 LSB
    g1 = rng.standard_normal((h, w)).astype(np.float32)
    g1 = (g1 + 0.5 * np.roll(g1, 1, 1)) / 1.12
    amp = (0.010 if dark else 0.008)
    img = img + (g1 * amp)[..., None]
    img += (rng.random((h, w, 1)).astype(np.float32) - 0.5) / 255.0   # TPDF-ish dither
    return Image.fromarray((np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--variant", help="variant name (default: all)")
    ap.add_argument("--seed", type=int, default=20)
    ap.add_argument("--out", type=Path, default=ROOT / "wallpapers")
    ap.add_argument("--quality", type=int, default=90)
    a = ap.parse_args()

    with open(ROOT / "tokens" / "tokens.toml", "rb") as fh:
        variants = tomllib.load(fh)["variant"]
    names = [a.variant] if a.variant else list(variants)
    for n in names:
        if n not in variants:
            ap.error(f"unknown variant {n!r}; have {', '.join(variants)}")
    (a.out / "grub").mkdir(parents=True, exist_ok=True)

    for n in names:
        v = variants[n]
        dark = v["scheme"] == "dark"
        pal = v["palette"]
        for (w, h, name) in ((3840, 2400, f"{n}.jpg"), (1920, 1080, f"{n}-1080p.jpg")):
            im = render(pal, dark, w, h, a.seed)
            im.save(a.out / name, quality=a.quality, subsampling=0, optimize=True)
            print(a.out / name, (a.out / name).stat().st_size // 1024, "KB")
        if dark:   # GRUB: plain dark tones, no line motif, very light grain
            im = render(pal, dark, 1024, 768, a.seed, lines=False)
            im.save(a.out / "grub" / f"{n}.png", optimize=True)
            print(a.out / "grub" / f"{n}.png", (a.out / "grub" / f"{n}.png").stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main()
