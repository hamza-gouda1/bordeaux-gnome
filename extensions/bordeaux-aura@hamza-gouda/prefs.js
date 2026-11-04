// Copyright (C) Hamza Gouda
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ACCENTS = [
    ['Bordeaux', '#8E2A44'],
    ['Oxblood Noir', '#A3283A'],
    ['Merlot Day', '#7A1C34'],
];
const MODES = ['auto', 'dark', 'light'];

function rgbaToHex(rgba) {
    const h = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${h(rgba.red)}${h(rgba.green)}${h(rgba.blue)}`.toUpperCase();
}

export default class BordeauxAuraPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({icon_name: 'preferences-color-symbolic'});
        window.add(page);

        const look = new Adw.PreferencesGroup({
            title: 'Dock aura',
            description: 'A faint glow in each app’s own colour behind the dock icons.',
        });
        page.add(look);

        const enabled = new Adw.SwitchRow({title: 'Show the aura'});
        settings.bind('enabled', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(enabled);

        const intensityRow = new Adw.ActionRow({
            title: 'Intensity',
            subtitle: '38 matches the theme design',
        });
        const scale = new Gtk.Scale({
            adjustment: new Gtk.Adjustment({lower: 0, upper: 100, step_increment: 1, page_increment: 10}),
            digits: 0,
            draw_value: true,
            value_pos: Gtk.PositionType.LEFT,
            hexpand: true,
            valign: Gtk.Align.CENTER,
            width_request: 220,
        });
        scale.update_property([Gtk.AccessibleProperty.LABEL], ['Aura intensity']);
        scale.add_mark(38, Gtk.PositionType.BOTTOM, null);
        settings.bind('intensity', scale.adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
        intensityRow.add_suffix(scale);
        look.add(intensityRow);

        const hoverOnly = new Adw.SwitchRow({
            title: 'Only on hover',
            subtitle: 'Hide the aura until the pointer is over an icon',
        });
        settings.bind('only-on-hover', hoverOnly, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(hoverOnly);

        const boost = new Adw.SpinRow({
            title: 'Hover boost',
            digits: 1,
            adjustment: new Gtk.Adjustment({lower: 1, upper: 3, step_increment: 0.1, page_increment: 0.5}),
        });
        settings.bind('hover-boost', boost, 'value', Gio.SettingsBindFlags.DEFAULT);
        look.add(boost);

        const blur = new Adw.SpinRow({
            title: 'Halo blur',
            subtitle: 'Pixels, at 48 px icons',
            adjustment: new Gtk.Adjustment({lower: 0, upper: 48, step_increment: 1, page_increment: 4}),
        });
        settings.bind('blur-radius', blur, 'value', Gio.SettingsBindFlags.DEFAULT);
        look.add(blur);

        const colourGroup = new Adw.PreferencesGroup({title: 'Colour'});
        page.add(colourGroup);

        const accentRow = new Adw.ActionRow({
            title: 'Accent',
            subtitle: 'Each glow is pulled 15% toward this hue',
        });
        const presets = new Gtk.DropDown({
            model: Gtk.StringList.new([...ACCENTS.map(a => a[0]), 'Custom']),
            valign: Gtk.Align.CENTER,
        });
        const button = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog({with_alpha: false}),
            valign: Gtk.Align.CENTER,
        });
        accentRow.add_suffix(presets);
        accentRow.add_suffix(button);
        colourGroup.add(accentRow);

        let syncing = false;
        const fromSettings = () => {
            syncing = true;
            const hex = settings.get_string('accent').toUpperCase();
            const rgba = new Gdk.RGBA();
            if (rgba.parse(hex))
                button.set_rgba(rgba);
            const i = ACCENTS.findIndex(a => a[1] === hex);
            presets.set_selected(i >= 0 ? i : ACCENTS.length);
            syncing = false;
        };
        fromSettings();
        const ids = [settings.connect('changed::accent', fromSettings)];
        button.connect('notify::rgba', () => {
            if (!syncing)
                settings.set_string('accent', rgbaToHex(button.get_rgba()));
        });
        presets.connect('notify::selected', () => {
            const i = presets.get_selected();
            if (!syncing && i < ACCENTS.length)
                settings.set_string('accent', ACCENTS[i][1]);
        });

        const mode = new Adw.ComboRow({
            title: 'Theme brightness',
            subtitle: 'Auto follows the system style',
            model: Gtk.StringList.new(['Auto', 'Dark', 'Light']),
        });
        const syncMode = () => {
            mode.set_selected(Math.max(0, MODES.indexOf(settings.get_string('theme-mode'))));
        };
        syncMode();
        ids.push(settings.connect('changed::theme-mode', syncMode));
        mode.connect('notify::selected', () => {
            const v = MODES[mode.get_selected()];
            if (v && v !== settings.get_string('theme-mode'))
                settings.set_string('theme-mode', v);
        });
        colourGroup.add(mode);

        const followGroup = new Adw.PreferencesGroup({
            title: 'Light and dark',
            description: 'Follow the Dark Style switch: Merlot Day when it is off, the dark variant below when it is on.',
        });
        page.add(followGroup);
        const follow = new Adw.SwitchRow({
            title: 'Follow Dark Style',
            subtitle: 'Shell and GTK theme, blur, accent, dark wallpaper, Terminal profile',
        });
        settings.bind('follow-color-scheme', follow, 'active', Gio.SettingsBindFlags.DEFAULT);
        followGroup.add(follow);
        const DARKS = ['Bordeaux', 'Oxblood-Noir'];
        const dark = new Adw.ComboRow({
            title: 'Dark variant',
            model: Gtk.StringList.new(['Bordeaux', 'Oxblood Noir']),
        });
        const syncDark = () => dark.set_selected(Math.max(0, DARKS.indexOf(settings.get_string('dark-variant'))));
        syncDark();
        ids.push(settings.connect('changed::dark-variant', syncDark));
        dark.connect('notify::selected', () => {
            const v = DARKS[dark.get_selected()];
            if (v && v !== settings.get_string('dark-variant'))
                settings.set_string('dark-variant', v);
        });
        followGroup.add(dark);

        window.connect('close-request', () => {
            ids.forEach(id => settings.disconnect(id));
            window._settings = null;
        });
    }
}
