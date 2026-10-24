// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {normAccel, parseEntry, removeEntry, setEntry} from './bindings.js';

/** Parses typed text such as "<Control>F9" or "XF86Launch1"; null when GTK cannot. */
function validAccel(text) {
    const t = (text ?? '').trim();
    if (!t)
        return null;
    const [ok, key] = Gtk.accelerator_parse(t);
    return ok && key ? t : null;
}

function appInfo(id) {
    try {
        return Gio.DesktopAppInfo.new(id);
    } catch {
        return null;
    }
}

/** Modal list of installed apps; calls done(desktopId). */
function chooseApp(parent, done) {
    const win = new Adw.Window({
        title: 'Choose an app', modal: true, transient_for: parent,
        default_width: 420, default_height: 560,
    });
    const view = new Adw.ToolbarView();
    view.add_top_bar(new Adw.HeaderBar());
    const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8,
        margin_top: 8, margin_bottom: 8, margin_start: 12, margin_end: 12});
    const search = new Gtk.SearchEntry({placeholder_text: 'Search apps'});
    const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE, css_classes: ['boxed-list']});
    const apps = Gio.AppInfo.get_all().filter(a => a.should_show() && a.get_id())
        .sort((a, b) => a.get_display_name().localeCompare(b.get_display_name()));
    for (const a of apps) {
        const row = new Adw.ActionRow({title: GLib.markup_escape_text(a.get_display_name(), -1),
            subtitle: a.get_id(), activatable: true});
        const icon = a.get_icon();
        if (icon)
            row.add_prefix(new Gtk.Image({gicon: icon, pixel_size: 32}));
        row.connect('activated', () => {
            win.close();
            done(a.get_id());
        });
        row._needle = `${a.get_display_name()} ${a.get_id()}`.toLowerCase();
        list.append(row);
    }
    list.set_filter_func(row => !search.text || (row._needle ?? '').includes(search.text.toLowerCase()));
    search.connect('search-changed', () => list.invalidate_filter());
    box.append(search);
    box.append(new Gtk.ScrolledWindow({child: list, vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER}));
    view.set_content(box);
    win.set_content(view);
    win.present();
    return win;
}

/** Modal "press the shortcut" window; calls done(accelerator). */
function captureAccel(parent, appName, done) {
    const win = new Adw.Window({
        title: 'Set shortcut', modal: true, transient_for: parent,
        default_width: 440, default_height: 360,
    });
    const view = new Adw.ToolbarView();
    view.add_top_bar(new Adw.HeaderBar());
    const status = new Adw.StatusPage({
        icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic',
        title: `Press the shortcut for ${appName}`,
        description: 'Esc cancels. A key that already opens something cannot be pressed ' +
            'here; type its name instead, e.g. XF86Launch1 or <Control>F9.',
    });
    const entry = new Gtk.Entry({placeholder_text: 'or type it, then Enter', width_chars: 28,
        halign: Gtk.Align.CENTER});
    entry.connect('activate', () => {
        const accel = validAccel(entry.text);
        if (accel) {
            win.close();
            done(accel);
        } else {
            entry.add_css_class('error');
        }
    });
    status.set_child(entry);
    view.set_content(status);
    win.set_content(view);

    const keys = new Gtk.EventControllerKey();
    keys.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    keys.connect('key-pressed', (_c, keyval, _keycode, state) => {
        const f = win.get_focus();
        if (entry.text && f && (f === entry || f.is_ancestor(entry)))
            return Gdk.EVENT_PROPAGATE; // typing a name

        const mask = state & Gtk.accelerator_get_default_mod_mask();
        if (!mask && keyval === Gdk.KEY_Escape) {
            win.close();
            return Gdk.EVENT_STOP;
        }
        const key = Gdk.keyval_to_lower(keyval);
        if (!Gtk.accelerator_valid(key, mask))
            return Gdk.EVENT_STOP; // a lone modifier: keep waiting
        // Plain letters, digits and Tab/Backspace/Enter without a modifier
        // would hijack typing; those go to the entry instead.
        const editing = [Gdk.KEY_Tab, Gdk.KEY_ISO_Left_Tab, Gdk.KEY_BackSpace, Gdk.KEY_Return, Gdk.KEY_KP_Enter];
        if (!mask && (key < 0x80 || editing.includes(key)))
            return Gdk.EVENT_PROPAGATE;
        win.close();
        done(Gtk.accelerator_name(key, mask));
        return Gdk.EVENT_STOP;
    });
    win.add_controller(keys);
    win.present();
    return win;
}

export default class FocusKeysPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(620, 640);

        const page = new Adw.PreferencesPage({icon_name: 'preferences-desktop-keyboard-shortcuts-symbolic'});
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'App shortcuts',
            description: 'The app comes to the front if it is open, on any workspace, and starts if it is not.',
        });
        const add = new Gtk.Button({icon_name: 'list-add-symbolic', valign: Gtk.Align.CENTER,
            tooltip_text: 'Add a shortcut', css_classes: ['flat']});
        group.set_header_suffix(add);
        page.add(group);

        const behaviour = new Adw.PreferencesGroup({title: 'Behaviour'});
        const cycle = new Adw.SwitchRow({
            title: 'Cycle through windows',
            subtitle: 'Pressing the shortcut again moves to the app’s next window',
        });
        settings.bind('cycle-windows', cycle, 'active', Gio.SettingsBindFlags.DEFAULT);
        behaviour.add(cycle);
        page.add(behaviour);

        const list = () => settings.get_strv('bindings');
        const write = l => settings.set_strv('bindings', l);
        let rows = [];

        const edit = (oldAccel, appId) => {
            const name = appInfo(appId)?.get_display_name() ?? appId;
            captureAccel(window, name, accel => {
                let l = list();
                if (oldAccel === null || normAccel(accel) !== normAccel(oldAccel))
                    l = removeEntry(l, accel); // the new key moves here from any other app
                write(setEntry(l, accel, appId, oldAccel ?? accel));
            });
        };

        const rebuild = () => {
            rows.forEach(r => group.remove(r));
            rows = [];
            for (const text of list()) {
                const e = parseEntry(text);
                const info = e ? appInfo(e.appId) : null;
                const row = new Adw.ActionRow({
                    title: GLib.markup_escape_text(info?.get_display_name() ?? e?.appId ?? text, -1),
                    subtitle: GLib.markup_escape_text(!e ? 'Not understood: ACCELERATOR=app.desktop'
                        : !validAccel(e.accel) ? `${e.appId}: the shortcut ${e.accel} is not a valid key`
                            : info ? e.appId : `${e.appId}: not installed`, -1),
                });
                const icon = info?.get_icon();
                row.add_prefix(icon ? new Gtk.Image({gicon: icon, pixel_size: 32})
                    : new Gtk.Image({icon_name: 'dialog-warning-symbolic', pixel_size: 32}));
                if (e) {
                    const keyBtn = new Gtk.Button({valign: Gtk.Align.CENTER, css_classes: ['flat'],
                        tooltip_text: 'Change the shortcut',
                        child: new Gtk.ShortcutLabel({accelerator: e.accel, disabled_text: e.accel})});
                    keyBtn.connect('clicked', () => edit(e.accel, e.appId));
                    row.add_suffix(keyBtn);
                }
                const del = new Gtk.Button({icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER,
                    tooltip_text: 'Remove', css_classes: ['flat']});
                del.connect('clicked', () => write(list().filter(t => t !== text)));
                row.add_suffix(del);
                group.add(row);
                rows.push(row);
            }
            if (!rows.length) {
                const empty = new Adw.ActionRow({title: 'No shortcuts yet', subtitle: 'Add one with +'});
                group.add(empty);
                rows.push(empty);
            }
        };
        rebuild();
        const ids = [settings.connect('changed::bindings', rebuild)];
        add.connect('clicked', () => chooseApp(window, appId => edit(null, appId)));

        window.connect('close-request', () => {
            ids.forEach(id => settings.disconnect(id));
            window._settings = null;
        });
    }
}
