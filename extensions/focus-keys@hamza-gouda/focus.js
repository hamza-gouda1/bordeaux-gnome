// Copyright (C) Hamza Gouda
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda
//
// The key grabs and the raise-or-launch logic. No gi or shell imports: the
// shell objects come in through `deps`, so tests can drive the whole
// lifecycle with fakes (tests/test_focus_keys.js).
//
// Keys are grabbed the way the shell grabs them for gnome-settings-daemon's
// custom shortcuts: display.grab_accelerator() for each entry, one shared
// 'accelerator-activated' handler, and the action allowed in the normal and
// overview modes. Any number of bindings works from a single `as` key.

import {chooseWindow, parseBindings} from './bindings.js';

const NO_ACTION = 0; // Meta.KeyBindingAction.NONE

/**
 * deps = {
 *   settings,                     Gio.Settings: bindings (as), cycle-windows (b)
 *   display,                      grab_accelerator, ungrab_accelerator, connect, disconnect, focus_window
 *   grabFlags, modes,             Meta.KeyBindingFlags / Shell.ActionMode values
 *   bindingName(action),          Meta.external_binding_name_for_action
 *   allowKeybinding(name, modes), Main.wm.allowKeybinding
 *   noModes,                      Shell.ActionMode.NONE
 *   lookupApp(id),                Shell.AppSystem lookup (null when not installed)
 *   switchable(window),           true for windows a user would switch to
 *   activateWindow(win, time),    Main.activateWindow
 *   launch(app, time),            start a stopped app / ask a running one for a window
 *   missing(appId),               tell the user the app is not installed
 *   log(msg),
 * }
 */
export class FocusKeys {
    constructor(deps) {
        this._d = deps;
        this._grabs = new Map(); // action -> {accel, appId}
        this._ids = [];
        this._warned = new Set();
        this._enabled = false;
    }

    enable() {
        if (this._enabled)
            return;
        this._enabled = true;
        const {settings, display} = this._d;
        this._ids.push([settings, settings.connect('changed::bindings', () => this.reload())]);
        this._ids.push([display, display.connect('accelerator-activated',
            (_display, action, _device, timestamp) => this._onActivated(action, timestamp))]);
        this.reload();
    }

    disable() {
        if (!this._enabled)
            return;
        this._enabled = false;
        this._ungrabAll();
        for (const [obj, id] of this._ids)
            obj.disconnect(id);
        this._ids = [];
        this._warned.clear();
    }

    /** Accelerator -> desktop id of every key currently grabbed (for tests and QA). */
    get grabbed() {
        return [...this._grabs.values()].map(e => ({...e}));
    }

    reload() {
        this._ungrabAll();
        if (!this._enabled)
            return;
        const {settings, display} = this._d;
        const {entries, invalid, duplicates} = parseBindings(settings.get_strv('bindings'));
        for (const text of invalid)
            this._warnOnce(`bad:${text}`, `ignoring malformed entry "${text}" (want ACCELERATOR=app.desktop)`);
        for (const text of duplicates)
            this._warnOnce(`dup:${text}`, `ignoring "${text}": that key is already bound above it`);
        for (const entry of entries) {
            let action = NO_ACTION;
            try {
                action = display.grab_accelerator(entry.accel, this._d.grabFlags);
            } catch (e) {
                this._d.log(`cannot grab ${entry.accel}: ${e.message}`);
            }
            if (action === NO_ACTION) {
                // Invalid accelerator, or another grab (e.g. a custom shortcut) owns it.
                this._warnOnce(`grab:${entry.accel}`,
                    `${entry.accel} is invalid or already taken by another shortcut; not bound`);
                continue;
            }
            this._d.allowKeybinding(this._d.bindingName(action), this._d.modes);
            this._grabs.set(action, entry);
        }
    }

    _ungrabAll() {
        for (const action of this._grabs.keys()) {
            this._d.display.ungrab_accelerator(action);
            this._d.allowKeybinding(this._d.bindingName(action), this._d.noModes);
        }
        this._grabs.clear();
    }

    _warnOnce(key, msg) {
        if (this._warned.has(key))
            return;
        if (this._warned.size >= 128)
            this._warned.delete(this._warned.values().next().value);
        this._warned.add(key);
        this._d.log(msg);
    }

    _onActivated(action, timestamp) {
        const entry = this._grabs.get(action);
        if (entry)
            this.activate(entry.appId, timestamp);
    }

    /**
     * Raise the app's window (switching workspace if needed), cycle through
     * its windows when it already has the focus, or start it. Returns what it
     * did: 'missing', 'starting', 'launch', 'activate' or 'focused'.
     */
    activate(appId, timestamp = 0) {
        const app = this._d.lookupApp(appId);
        if (!app) {
            this._d.missing(appId);
            return 'missing';
        }
        const windows = app.get_windows().filter(w => this._d.switchable(w));
        const focus = this._d.display.focus_window;
        const res = chooseWindow(windows, focus, {
            cycle: this._d.settings.get_boolean('cycle-windows'),
            userTime: w => w.get_user_time(),
            seq: w => w.get_stable_sequence(),
        });
        if (res.action === 'launch') {
            if (app.get_state?.() === this._d.startingState)
                return 'starting'; // a press while it is still coming up
            this._d.launch(app, timestamp);
            return 'launch';
        }
        if (res.action === 'activate') {
            if (res.window.minimized)
                res.window.unminimize();
            this._d.activateWindow(res.window, timestamp);
        }
        return res.action;
    }

    destroy() {
        this.disable();
        this._d = null;
    }
}
