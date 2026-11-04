// Copyright (C) Hamza Gouda
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

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {FocusKeys} from './focus.js';
import {ShowDesktop} from './desktop.js';
import {DesktopBinding} from './desktopBinding.js';

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
        this._desktop = new ShowDesktop({
            focus: () => global.display.focus_window,
            windows: () => global.display.get_tab_list(Meta.TabList.NORMAL_ALL,
                global.workspace_manager.get_active_workspace()),
            eligible: w => SWITCHABLE.has(w.get_window_type()) && !w.skip_taskbar && w.can_minimize(),
            alive: w => !!w.get_compositor_private(),
            fade: (w, delay, done) => {
                const actor = w.get_compositor_private();
                if (!actor || !St.Settings.get().enable_animations) {
                    done();
                    return;
                }
                actor.ease({opacity: 0, delay, duration: 160,
                    mode: Clutter.AnimationMode.EASE_OUT_CUBIC, onComplete: done});
            },
            minimize: w => {
                Main.wm.skipNextEffect(w.get_compositor_private());
                w.minimize();
            },
            unminimize: w => {
                Main.wm.skipNextEffect(w.get_compositor_private());
                w.unminimize();
            },
            reset: w => { w.get_compositor_private().opacity = 255; },
            cancel: w => w.get_compositor_private().remove_transition('opacity'),
            activate: w => Main.activateWindow(w, global.get_current_time()),
        });
        this._desktopBinding = new DesktopBinding({
            settings: this._settings,
            add: () => Main.wm.addKeybinding('show-desktop-shortcut', this._settings,
                Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, () => this._desktop.toggle()),
            remove: () => Main.wm.removeKeybinding('show-desktop-shortcut'),
            none: Meta.KeyBindingAction.NONE,
            log: msg => console.warn(`[focus-keys] ${msg}`),
        });
        this._desktopBinding.enable();
    }

    disable() {
        this._desktopBinding?.destroy();
        this._desktopBinding = null;
        this._desktop?.destroy();
        this._desktop = null;
        this._core?.destroy();
        this._core = null;
        this._settings = null;
    }
}
