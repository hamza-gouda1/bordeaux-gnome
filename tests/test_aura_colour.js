// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) Hamza Gouda
// Unit tests for the dock aura colour maths. Run: gjs -m tests/test_aura_colour.js

import System from 'system';
import * as C from '../extensions/bordeaux-aura@hamza-gouda/colour.js';

let failed = 0, passed = 0;
function ok(cond, msg) {
    if (cond) {
        passed++;
    } else {
        failed++;
        print(`FAIL ${msg}`);
    }
}
const near = (a, b, eps, msg) => ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b}`);
const hueDist = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** RGBA buffer: `fill(x, y)` returns [r, g, b, a]. */
function icon(w, h, fill, {channels = 4, pad = 0} = {}) {
    const rowstride = w * channels + pad;
    const px = new Uint8Array(rowstride * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const v = fill(x, y);
            for (let c = 0; c < channels; c++)
                px[y * rowstride + x * channels + c] = v[c];
        }
    }
    return {px, fmt: {width: w, height: h, rowstride, channels}};
}
const disc = (inside, outside = [0, 0, 0, 0]) => (x, y) =>
    Math.hypot(x - 31.5, y - 31.5) < 24 ? inside : outside;
const lch = rgb => C.oklabToOklch(C.rgbToOklab(rgb));
const ACCENT = C.parseHex('#8E2A44');

// --- parsing / conversions
ok(C.parseHex('#8E2A44').r === 142 && C.parseHex('#8e2a44').b === 68, 'parseHex 6');
ok(C.parseHex('#fff').g === 255, 'parseHex 3');
ok(C.parseHex('nope') === null && C.parseHex('#12345') === null && C.parseHex(5) === null, 'parseHex rejects');
ok(C.toHex({r: 142, g: 42, b: 68}) === '#8e2a44', 'toHex');
for (const hex of ['#000000', '#ffffff', '#8e2a44', '#12ab9f', '#ff0000', '#0000ff']) {
    const rgb = C.parseHex(hex);
    const back = C.oklabToRgbRaw(C.rgbToOklab(rgb));
    near(back.r, rgb.r, 0.5, `roundtrip r ${hex}`);
    near(back.g, rgb.g, 0.5, `roundtrip g ${hex}`);
    near(back.b, rgb.b, 0.5, `roundtrip b ${hex}`);
}
near(C.rgbToOklab({r: 255, g: 255, b: 255}).L, 1, 1e-3, 'white L=1');
near(lch({r: 255, g: 0, b: 0}).h, 29.2, 0.5, 'red hue');

// --- dominant colour
{
    const {px, fmt} = icon(64, 64, disc([220, 40, 40, 255]));
    const d = C.dominantColour(px, fmt);
    ok(d && d.r > 200 && d.g < 60 && d.b < 60, `red disc on transparency stays red ${JSON.stringify(d)}`);
    ok(d.share > 0.5, 'red disc is saturated');
}
{
    // Blue body with white and black outlines: outlines must not muddy it.
    const {px, fmt} = icon(64, 64, (x, y) => {
        const r = Math.hypot(x - 31.5, y - 31.5);
        if (r < 18) return [30, 90, 220, 255];
        if (r < 22) return [250, 250, 250, 255];
        if (r < 26) return [5, 5, 5, 255];
        return [0, 0, 0, 0];
    });
    const d = C.dominantColour(px, fmt);
    ok(hueDist(lch(d).h, lch({r: 30, g: 90, b: 220}).h) < 3, 'white/black/transparent ignored');
}
{
    // 60% orange, 40% teal: pick the orange band, not their average.
    const {px, fmt} = icon(64, 64, (x, _y) => x < 38 ? [240, 140, 20, 255] : [20, 160, 150, 255]);
    const d = C.dominantColour(px, fmt);
    ok(hueDist(lch(d).h, lch({r: 240, g: 140, b: 20}).h) < 3, 'two-tone picks the dominant hue');
}
{
    const {px, fmt} = icon(64, 64, disc([128, 128, 132, 255]));
    const d = C.dominantColour(px, fmt);
    ok(d && d.share < 0.15, 'grey icon is neutral');
    const a = C.auraColour(d, ACCENT, 'dark');
    near(a.alpha, C.MODES.dark.aMin, 1e-6, 'neutral icon gets the minimum alpha');
}
{
    const {px, fmt} = icon(64, 64, () => [0, 0, 0, 0]);
    ok(C.dominantColour(px, fmt) === null, 'fully transparent -> null');
    ok(C.dominantColour(null, fmt) === null, 'no pixels -> null');
}
{
    // RGB (no alpha) with rowstride padding of 3 bytes per row.
    const {px, fmt} = icon(48, 48, () => [40, 200, 60], {channels: 3, pad: 3});
    const d = C.dominantColour(px, fmt);
    ok(d && d.g > 190 && d.r < 50, 'RGB + padded rowstride read correctly');
}
{
    // 512x512 is strided down to at most MAX_SAMPLES reads.
    let reads = 0;
    const {px, fmt} = icon(512, 512, disc([200, 50, 200, 255]));
    const proxy = new Proxy(px, {get: (t, k) => {
        if (typeof k === 'string' && /^\d+$/.test(k))
            reads++;
        return t[k];
    }});
    C.dominantColour(proxy, fmt);
    ok(reads / 4 <= C.MAX_SAMPLES, `large icon sampled <= ${C.MAX_SAMPLES} px (${reads / 4})`);
}

// --- clamps, accent pull, alpha
for (const mode of ['dark', 'light']) {
    const m = C.MODES[mode];
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#111111', '#fefefe', '#e95420', '#3584e4']) {
        const a = C.auraColour(C.parseHex(hex), ACCENT, mode);
        const o = lch(a);
        ok(o.L >= m.lMin - 0.01 && o.L <= m.lMax + 0.01, `${mode} ${hex} L ${o.L.toFixed(3)} in range`);
        ok(o.C <= m.cMax + 0.005, `${mode} ${hex} C ${o.C.toFixed(3)} capped`);
        ok([a.r, a.g, a.b].every(v => Number.isInteger(v) && v >= 0 && v <= 255), `${mode} ${hex} in gamut`);
        ok(a.alpha >= m.aMin - 1e-9 && a.alpha <= Math.min(m.aMax, C.ALPHA_CAP) + 1e-9, `${mode} ${hex} alpha range`);
    }
}
{
    const src = {r: 40, g: 120, b: 230};
    const without = C.auraColour(src, src, 'dark');
    const withAcc = C.auraColour(src, ACCENT, 'dark');
    const hs = lch(without).h, ha = lch(ACCENT).h, hw = lch(withAcc).h;
    ok(hueDist(hw, ha) < hueDist(hs, ha), 'accent pulls the hue toward the accent');
    ok(hueDist(hw, hs) < 0.3 * hueDist(hs, ha), 'pull is small (~15%), the app keeps its colour');
    const vivid = C.auraColour({r: 255, g: 0, b: 0}, ACCENT, 'dark');
    ok(vivid.alpha === C.MODES.dark.aMax, 'saturated icon reaches max alpha');
    const nul = C.auraColour(null, ACCENT, 'dark');
    ok(nul.alpha === C.MODES.dark.aMin && hueDist(lch(nul).h, ha) < 5, 'symbolic fallback is accent-tinted neutral');
}

// --- states
{
    const base = 0.34;
    near(C.stateAlpha(base), base, 1e-9, 'default intensity reproduces spec alpha');
    ok(C.stateAlpha(base, {intensity: 0}) === 0, 'intensity 0 hides');
    ok(C.stateAlpha(base, {intensity: 100}) > C.stateAlpha(base), 'intensity scales');
    const hover = C.stateAlpha(base, {hover: true});
    const focus = C.stateAlpha(base, {focused: true});
    near(hover / base, 1.6, 1e-9, 'hover x1.6');
    near(focus / base, 1.3, 1e-9, 'focused x1.3');
    ok(C.stateAlpha(base, {running: false}) < base, 'pinned, not running is dimmer');
    ok(C.stateAlpha(base, {pressed: true, hover: true}) < hover, 'pressed dims');
    ok(C.stateAlpha(base, {onlyOnHover: true}) === 0 && C.stateAlpha(base, {onlyOnHover: true, hover: true}) === hover, 'only-on-hover');
    ok(C.stateAlpha(0.55, {intensity: 100, hover: true, focused: true, hoverBoost: 3}) === 1, 'clamped to 1');
}

print(`${passed} passed, ${failed} failed`);
System.exit(failed ? 1 : 0);
