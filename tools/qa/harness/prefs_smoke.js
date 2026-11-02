// Copyright (C) Hamza Gouda
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda
//
// Opens an extension's preferences window the way the Extensions app does,
// for tools/shell_qa.py (run by the QA harness inside the private headless
// shell, so the window lands there). Writes a JSON report to REPORT and keeps
// the window open until killed.
//
// Run: gjs -m tools/qa/harness/prefs_smoke.js EXTENSION_DIR REPORT

import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

const [extPath, report] = ARGV;
const write = obj => GLib.file_set_contents(report, JSON.stringify(obj));
if (!GLib.getenv('WAYLAND_DISPLAY')?.startsWith('bxqa')) {
    printerr('prefs_smoke: only runs inside the QA session');
    System.exit(1);
}

Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();
const dir = Gio.File.new_for_path(extPath);
const [, raw] = dir.get_child('metadata.json').load_contents(null);
const metadata = {...JSON.parse(new TextDecoder().decode(raw)), dir, path: extPath};

const app = new Adw.Application({application_id: 'org.bordeaux.QaPrefs', flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', async () => {
    app.hold(); // the import below is asynchronous; keep the app alive meanwhile
    try {
        const {default: Prefs} = await import(dir.get_child('prefs.js').get_uri());
        const prefs = new Prefs(metadata);
        const win = new Adw.PreferencesWindow({application: app, title: metadata.name});
        await prefs.fillPreferencesWindow(win);
        win.present();
        app.release();
        // Count the rows the page built, after it has been laid out.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            const rows = [];
            const walk = w => {
                for (let c = w.get_first_child(); c; c = c.get_next_sibling()) {
                    if (c instanceof Adw.ActionRow && c.get_mapped())
                        rows.push({title: c.title, subtitle: c.subtitle});
                    walk(c);
                }
            };
            walk(win);
            write({ok: true, rows});
            return GLib.SOURCE_REMOVE;
        });
    } catch (e) {
        write({ok: false, error: `${e}\n${e.stack}`});
        app.quit();
    }
});
app.run([]);
void Gtk;
