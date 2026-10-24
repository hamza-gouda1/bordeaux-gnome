// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda
//
// Focus Keys: global shortcuts that raise an app's window when it is already
// open (on any workspace) and start it when it is not.
//
// A custom shortcut in Settings runs a command such as `gtk-launch`, which
// carries no activation token, so on Wayland GNOME refuses to focus the
// already-running app and shows a "<App> is ready" notification instead. The
// shell itself may raise windows, so this extension does the raising.

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {FocusKeys} from './focus.js';

const SWITCHABLE = new Set([Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG]);

export default class FocusKeysExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        const appSystem = Shell.AppSystem.get_default();
        this._core = new FocusKeys({
            settings: this._settings,
            display: global.display,
            grabFlags: Meta.KeyBindingFlags.NONE,
            modes: Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            noModes: Shell.ActionMode.NONE,
            startingState: Shell.AppState.STARTING,
            bindingName: action => Meta.external_binding_name_for_action(action),
            allowKeybinding: (name, modes) => Main.wm.allowKeybinding(name, modes),
            lookupApp: id => appSystem.lookup_app(id),
            switchable: w => SWITCHABLE.has(w.get_window_type()) && !w.skip_taskbar,
            activateWindow: (w, time) => Main.activateWindow(w, time || global.get_current_time()),
            launch: (app, time) => {
                Main.overview.hide();
                // Launched by the shell, the app gets an activation token and
                // therefore the focus.
                if (app.get_state() === Shell.AppState.RUNNING)
                    app.open_new_window(-1);
                else
                    app.activate_full(-1, time || global.get_current_time());
            },
            missing: id => {
                console.warn(`[focus-keys] ${id} is not installed`);
                Main.osdWindowManager.show(-1, Gio.ThemedIcon.new('dialog-warning-symbolic'),
                    `${id.replace(/\.desktop$/, '')} is not installed`, null);
            },
            log: msg => console.warn(`[focus-keys] ${msg}`),
        });
        this._core.enable();
    }

    disable() {
        this._core?.destroy();
        this._core = null;
        this._settings = null;
    }
}
