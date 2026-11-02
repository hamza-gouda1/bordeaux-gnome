// Copyright (C) Hamza Gouda
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda
//
// Pure colour maths for the dock aura. No GNOME imports, so the test suite
// can load it with plain `gjs -m`.

/** Largest number of pixels sampled per icon (64x64). */
export const MAX_SAMPLES = 4096;

const HUE_BINS = 24;

// Pixels the aura ignores: almost transparent, almost white, almost black.
const MIN_ALPHA = 24;
const WHITE_FLOOR = 235;
const BLACK_CEIL = 20;
// Below this share of saturated weight, an icon counts as neutral.
const NEUTRAL_SHARE = 0.15;

export const MODES = {
    dark: {lMin: 0.62, lMax: 0.74, cMax: 0.12, aMin: 0.10, aMax: 0.34},
    light: {lMin: 0.66, lMax: 0.76, cMax: 0.11, aMin: 0.14, aMax: 0.46},
};

export const ALPHA_CAP = 0.55;
export const ACCENT_MIX = 0.15;
// The design values are tuned for the default intensity.
export const DEFAULT_INTENSITY = 38;
export const NEUTRAL_CHROMA = 0.02;

export const STATE = {
    focused: 1.3,
    pressed: 0.8,
    idlePinned: 0.7,
};

export function clamp(x, lo, hi) {
    return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a, b, t) {
    return a + (b - a) * t;
}

export function smoothstep(e0, e1, x) {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
}

/**
 * Parse `#RRGGBB` or `#RGB`.
 *
 * @param {string} hex colour string
 * @returns {{r: number, g: number, b: number}|null} 0-255 channels
 */
export function parseHex(hex) {
    if (typeof hex !== 'string')
        return null;
    let s = hex.trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(s))
        s = s.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(s))
        return null;
    const n = parseInt(s, 16);
    return {r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255};
}

export function toHex({r, g, b}) {
    const h = v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
    return `#${h(r)}${h(g)}${h(b)}`;
}

function toLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function fromLinear(c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return v * 255;
}

export function rgbToOklab({r, g, b}) {
    const lr = toLinear(r), lg = toLinear(g), lb = toLinear(b);
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return {
        L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    };
}

/** OKLab to unclamped sRGB 0-255 (may fall outside the gamut). */
export function oklabToRgbRaw({L, a, b}) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    return {
        r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    };
}

export function oklabToOklch({L, a, b}) {
    const C = Math.hypot(a, b);
    let h = Math.atan2(b, a) * 180 / Math.PI;
    if (h < 0)
        h += 360;
    return {L, C, h};
}

export function oklchToOklab({L, C, h}) {
    const rad = h * Math.PI / 180;
    return {L, a: C * Math.cos(rad), b: C * Math.sin(rad)};
}

function inGamut({r, g, b}) {
    const e = 0.5;
    return r >= -e && r <= 255 + e && g >= -e && g <= 255 + e &&
        b >= -e && b <= 255 + e;
}

/**
 * OKLCH to sRGB, lowering chroma (keeping L and h) until it fits.
 *
 * @param {{L: number, C: number, h: number}} lch colour
 * @returns {{r: number, g: number, b: number}} rounded 0-255 channels
 */
export function oklchToRgb(lch) {
    let {C} = lch;
    let rgb = oklabToRgbRaw(oklchToOklab({...lch, C}));
    for (let i = 0; i < 24 && !inGamut(rgb); i++) {
        C *= 0.9;
        rgb = oklabToRgbRaw(oklchToOklab({...lch, C}));
    }
    return {
        r: Math.round(clamp(rgb.r, 0, 255)),
        g: Math.round(clamp(rgb.g, 0, 255)),
        b: Math.round(clamp(rgb.b, 0, 255)),
    };
}

/**
 * Dominant colour of an icon, from raw pixbuf bytes.
 *
 * Unity-style relevance (`0.1·255² + 0.9·α·sat`) over the pixels that
 * survive the transparency / white / black filter, then the strongest hue
 * band of a weighted hue histogram is averaged, so two-tone icons do not
 * blend into mud. Large buffers are strided so at most MAX_SAMPLES pixels
 * are read.
 *
 * @param {Uint8Array|number[]} pixels raw bytes
 * @param {object} fmt layout
 * @param {number} fmt.width pixels per row
 * @param {number} fmt.height rows
 * @param {number} [fmt.rowstride] bytes per row
 * @param {number} [fmt.channels] 3 or 4
 * @returns {{r: number, g: number, b: number, share: number}|null}
 *   null when no pixel is usable; `share` is the saturated weight share
 */
export function dominantColour(pixels, {width, height, rowstride, channels = 4}) {
    if (!pixels || width <= 0 || height <= 0)
        return null;
    rowstride ??= width * channels;
    const step = Math.max(1, Math.ceil(Math.sqrt(width * height / MAX_SAMPLES)));
    const hasAlpha = channels >= 4;

    const binW = new Float64Array(HUE_BINS);
    const binR = new Float64Array(HUE_BINS);
    const binG = new Float64Array(HUE_BINS);
    const binB = new Float64Array(HUE_BINS);
    let total = 0, satTotal = 0, rT = 0, gT = 0, bT = 0;

    for (let y = 0; y < height; y += step) {
        const row = y * rowstride;
        for (let x = 0; x < width; x += step) {
            const o = row + x * channels;
            const r = pixels[o], g = pixels[o + 1], b = pixels[o + 2];
            const a = hasAlpha ? pixels[o + 3] : 255;
            if (a < MIN_ALPHA)
                continue;
            const max = Math.max(r, g, b), min = Math.min(r, g, b);
            if (min > WHITE_FLOOR || max < BLACK_CEIL)
                continue;
            const sat = max - min;
            const satW = 0.9 * a * sat;
            const w = 0.1 * 255 * a + satW;
            total += w;
            rT += r * w;
            gT += g * w;
            bT += b * w;
            if (sat < 24)
                continue;
            satTotal += satW;
            let h;
            if (max === r)
                h = ((g - b) / sat + 6) % 6;
            else if (max === g)
                h = (b - r) / sat + 2;
            else
                h = (r - g) / sat + 4;
            const bin = Math.min(HUE_BINS - 1, Math.floor(h / 6 * HUE_BINS));
            binW[bin] += satW;
            binR[bin] += r * satW;
            binG[bin] += g * satW;
            binB[bin] += b * satW;
        }
    }
    if (total <= 0)
        return null;

    const share = satTotal / total;
    if (share < NEUTRAL_SHARE || satTotal <= 0)
        return {r: rT / total, g: gT / total, b: bT / total, share};

    let best = 0, bestW = -1;
    for (let i = 0; i < HUE_BINS; i++) {
        const w = binW[i] + binW[(i + 1) % HUE_BINS] + binW[(i + HUE_BINS - 1) % HUE_BINS];
        if (w > bestW) {
            bestW = w;
            best = i;
        }
    }
    let w = 0, r = 0, g = 0, b = 0;
    for (const i of [best - 1, best, best + 1]) {
        const k = (i + HUE_BINS) % HUE_BINS;
        w += binW[k];
        r += binR[k];
        g += binG[k];
        b += binB[k];
    }
    return {r: r / w, g: g / w, b: b / w, share};
}

/**
 * Turn a dominant colour into the aura colour and its base alpha.
 *
 * @param {{r: number, g: number, b: number}|null} source dominant colour,
 *   null for symbolic / unreadable icons (neutral fallback)
 * @param {{r: number, g: number, b: number}} accent theme accent
 * @param {'dark'|'light'} mode theme brightness
 * @returns {{r: number, g: number, b: number, alpha: number, chroma: number}}
 */
export function auraColour(source, accent, mode = 'dark') {
    const m = MODES[mode] ?? MODES.dark;
    const acc = oklabToOklch(rgbToOklab(accent ?? {r: 142, g: 42, b: 68}));

    let src;
    if (source)
        src = oklabToOklch(rgbToOklab(source));
    else
        src = {L: (m.lMin + m.lMax) / 2, C: 0, h: acc.h};
    if (src.C < 1e-4)
        src.h = acc.h;

    const L = clamp(src.L, m.lMin, m.lMax);
    const C = Math.max(Math.min(src.C, m.cMax), NEUTRAL_CHROMA);
    const glow = oklchToOklab({L, C, h: src.h});
    // Pull 15% toward the accent hue at the glow's own L and C, so a dark
    // accent tints the hue without darkening the glow.
    const target = oklchToOklab({L, C, h: acc.h});
    const mixed = {
        L,
        a: lerp(glow.a, target.a, ACCENT_MIX),
        b: lerp(glow.b, target.b, ACCENT_MIX),
    };
    const out = oklabToOklch(mixed);
    const rgb = oklchToRgb(out);

    const alpha = Math.min(ALPHA_CAP, lerp(m.aMin, m.aMax, smoothstep(0.02, 0.10, src.C)));
    return {...rgb, alpha, chroma: src.C};
}

/**
 * Alpha for one icon in its current state.
 *
 * @param {number} base alpha from auraColour()
 * @param {object} s state and settings
 * @returns {number} 0-1
 */
export function stateAlpha(base, {
    intensity = DEFAULT_INTENSITY, hoverBoost = 1.6, onlyOnHover = false,
    hover = false, focused = false, running = true, pressed = false,
} = {}) {
    if (onlyOnHover && !hover)
        return 0;
    let a = base * clamp(intensity, 0, 100) / DEFAULT_INTENSITY;
    if (!running)
        a *= STATE.idlePinned;
    if (focused)
        a *= STATE.focused;
    if (hover)
        a *= Math.max(1, hoverBoost);
    if (pressed)
        a *= STATE.pressed;
    return clamp(a, 0, 1);
}
