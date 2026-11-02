// Copyright (C) Hamza Gouda
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda
//
// Pure helpers (no gi imports), shared by the extension, its preferences and
// the tests: the "ACCELERATOR=desktop-id" entries of the `bindings` key and
// the choice of which window a key press should raise.

/** "<Control>F9=spotify.desktop" -> {accel, appId}, or null when malformed. */
export function parseEntry(text) {
    if (typeof text !== 'string')
        return null;
    const s = text.trim();
    // Accelerator names never contain "=" (the key is spelled "equal"), desktop
    // ids never do either; split on the last one to be safe.
    const i = s.lastIndexOf('=');
    if (i <= 0 || i === s.length - 1)
        return null;
    const accel = s.slice(0, i).trim();
    let appId = s.slice(i + 1).trim();
    if (!accel || !appId || /\s/.test(appId))
        return null;
    if (!appId.endsWith('.desktop'))
        appId = `${appId}.desktop`;
    return {accel, appId};
}

export const formatEntry = (accel, appId) => `${accel}=${appId}`;

const MOD_ALIASES = {
    ctrl: 'control', ctl: 'control', primary: 'control', control: 'control',
    shift: 'shift', alt: 'alt', mod1: 'alt', super: 'super', mod4: 'super',
    meta: 'meta', hyper: 'hyper',
};

/**
 * A comparable form of an accelerator: modifiers sorted and lower case,
 * keysym lower case with any XF86 prefix dropped ("Launch1" and
 * "XF86Launch1" are the same key to GNOME).
 */
export function normAccel(accel) {
    if (typeof accel !== 'string')
        return '';
    const mods = new Set();
    let rest = accel.trim();
    let m;
    while ((m = /^<([^>]+)>/.exec(rest))) {
        const name = m[1].toLowerCase();
        mods.add(MOD_ALIASES[name] ?? name);
        rest = rest.slice(m[0].length);
    }
    let key = rest.trim().toLowerCase();
    if (key.startsWith('xf86'))
        key = key.slice(4);
    return [...[...mods].sort().map(x => `<${x}>`), key].join('');
}

/**
 * The `bindings` list -> {entries, invalid, duplicates}. The first entry for a
 * key wins; later ones for the same key are reported, not bound.
 */
export function parseBindings(list) {
    const entries = [], invalid = [], duplicates = [];
    const seen = new Set();
    for (const text of list ?? []) {
        const e = parseEntry(text);
        if (!e) {
            invalid.push(text);
            continue;
        }
        const key = normAccel(e.accel);
        if (seen.has(key)) {
            duplicates.push(text);
            continue;
        }
        seen.add(key);
        entries.push(e);
    }
    return {entries, invalid, duplicates};
}

/** Replace (or add) the entry for `accel`; returns a new list. */
export function setEntry(list, accel, appId, replaceAccel = accel) {
    const want = normAccel(replaceAccel);
    const out = [];
    let done = false;
    for (const text of list ?? []) {
        const e = parseEntry(text);
        if (e && normAccel(e.accel) === want) {
            if (!done)
                out.push(formatEntry(accel, appId));
            done = true;
        } else {
            out.push(text);
        }
    }
    if (!done)
        out.push(formatEntry(accel, appId));
    return out;
}

/** Remove every entry bound to `accel`; returns a new list. */
export function removeEntry(list, accel) {
    const want = normAccel(accel);
    return (list ?? []).filter(text => {
        const e = parseEntry(text);
        return !e || normAccel(e.accel) !== want;
    });
}

/**
 * What a key press should do with an app that has `windows` (already limited
 * to the ones a user can switch to).
 *
 *   {action: 'launch'}            no windows: start it (or ask it for one)
 *   {action: 'activate', window}  raise and focus this one
 *   {action: 'focused'}           its only window already has the focus
 *
 * Unfocused: the most recently used window, on any workspace. Focused and
 * `cycle` on: the next window in a stable order, so repeated presses walk
 * through all of them.
 *
 * `userTime(w)` and `seq(w)` read Meta.Window user time and stable sequence.
 */
export function chooseWindow(windows, focus, {cycle = true, userTime, seq}) {
    const wins = [...(windows ?? [])];
    if (!wins.length)
        return {action: 'launch'};
    if (focus && wins.includes(focus)) {
        if (!cycle || wins.length < 2)
            return {action: 'focused'};
        const order = wins.sort((a, b) => seq(a) - seq(b));
        const next = order[(order.indexOf(focus) + 1) % order.length];
        return {action: 'activate', window: next};
    }
    const mru = wins.sort((a, b) => (userTime(b) - userTime(a)) || (seq(b) - seq(a)));
    return {action: 'activate', window: mru[0]};
}
