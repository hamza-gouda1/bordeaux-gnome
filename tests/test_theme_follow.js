// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) Hamza Gouda
// Light/dark following of the aura extension: mapping, ops, debounce/lifecycle,
// and the GSettings/file side on an in-memory settings backend.
// Run: gjs -m tests/test_theme_follow.js

import GLib from 'gi://GLib';
import System from 'system';

GLib.setenv('GSETTINGS_BACKEND', 'memory', true); // before any Gio.Settings: never dconf

const Gio = (await import('gi://Gio')).default;
const F = await import('../extensions/bordeaux-aura@hamza-gouda/follow.js');
const A = await import('../extensions/bordeaux-aura@hamza-gouda/followApply.js');

let failed = 0, passed = 0;
function ok(cond, msg) {
    if (cond) {
        passed++;
    } else {
        failed++;
        print(`FAIL ${msg}`);
    }
}
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);

const root = GLib.path_get_dirname(GLib.path_get_dirname(GLib.filename_from_uri(import.meta.url)[0]));
const docs = A.loadDocs(`${root}/extensions/bordeaux-aura@hamza-gouda/variants`);
const byName = n => docs.find(d => d.variant === n);

// --- generated data
eq(docs.map(d => d.variant), ['Bordeaux', 'Merlot-Day', 'Oxblood-Noir'], 'one JSON per variant');
eq(docs.map(d => [d.scheme, d.gtkTheme]), [['dark', 'Yaru-dark'], ['light', 'Yaru'], ['dark', 'Yaru-dark']], 'scheme and GTK theme');
for (const d of docs) {
    const keys = d.keys.map(k => `${k.schema} ${k.key}`);
    ok(keys.includes('org.gnome.shell.extensions.bordeaux-aura accent'), `${d.variant}: aura accent included`);
    ok(keys.includes('org.gnome.shell.extensions.blur-my-shell pipelines'), `${d.variant}: blur pipelines included`);
    ok(!keys.includes('org.gnome.desktop.interface font-name'), `${d.variant}: keys equal in every variant left out`);
    ok(d.keys.find(k => k.key === 'pipelines').merge, `${d.variant}: pipelines is a merge`);
    ok(d.keys.find(k => k.key === 'icon-theme')?.ifOneOf?.length === 2, `${d.variant}: icon theme only when ours`);
}

// --- mapping
eq([F.pickVariant('prefer-dark'), F.pickVariant('default'), F.pickVariant('prefer-light')],
    ['Bordeaux', 'Merlot-Day', 'Merlot-Day'], 'only prefer-dark is dark');
eq(F.pickVariant('prefer-dark', {dark: 'Oxblood-Noir'}), 'Oxblood-Noir', 'chosen dark variant');

const ops = F.buildOps(byName('Oxblood-Noir'), docs, {bgDir: '/bg'});
const op = (s, k) => ops.find(o => o.schema === s && o.key === k);
eq(op('org.gnome.shell.extensions.user-theme', 'name').value, "'Oxblood-Noir'", 'shell theme');
eq(op('org.gnome.shell.extensions.user-theme', 'name').ifOneOf, ["'Bordeaux'", "'Merlot-Day'", "'Oxblood-Noir'"],
    'shell theme only replaces ours');
eq(op('org.gnome.desktop.interface', 'gtk-theme').value, "'Yaru-dark'", 'gtk theme');
eq(op('org.gnome.Terminal.ProfilesList', 'default').requireInList, byName('Oxblood-Noir').terminalProfile,
    'terminal default needs the profile to exist');
eq(op('org.gnome.desktop.background', 'picture-uri-dark').value, "'file:///bg/Oxblood-Noir.jpg'", 'dark wallpaper');
eq(op('org.gnome.desktop.background', 'picture-uri-dark').ifOneOf,
    ["'file:///bg/Bordeaux.jpg'", "'file:///bg/Oxblood-Noir.jpg'"], 'only replaces our dark wallpapers');
ok(!F.buildOps(byName('Merlot-Day'), docs, {bgDir: '/bg'}).some(o => o.key.startsWith('picture-uri')),
    'light variant never touches wallpapers');

// --- GTK user stylesheets
const files = {
    '/t/Bordeaux/gtk-4.0/gtk.css': 'B4', '/t/Merlot-Day/gtk-4.0/gtk.css': 'M4', '/t/Oxblood-Noir/gtk-4.0/gtk.css': 'O4',
    '/t/Bordeaux/gtk-3.0/gtk.css': 'B3', '/t/Merlot-Day/gtk-3.0/gtk.css': 'M3', '/t/Oxblood-Noir/gtk-3.0/gtk.css': 'O3',
    '/c/gtk-4.0/gtk.css': 'B4', '/c/gtk-3.0/gtk.css': 'my own',
};
const read = p => files[p] ?? null;
eq(F.gtkCssOps(byName('Merlot-Day'), docs, {configDir: '/c', themesDir: '/t'}, read),
    [{path: '/c/gtk-4.0/gtk.css', contents: 'M4'}], 'ours replaced, the user-edited GTK 3 file kept');
eq(F.gtkCssOps(byName('Bordeaux'), docs, {configDir: '/c', themesDir: '/t'}, read).length, 0, 'already right: no write');

// --- follower: debounce, settings, lifecycle (fakes)
class Sig {
    constructor(v) {
        this.v = v;
        this.h = new Map();
        this.n = 1;
    }

    connect(name, cb) {
        this.h.set(this.n, [name, cb]);
        return this.n++;
    }

    disconnect(id) {
        if (!this.h.delete(id))
            throw new Error('bad id');
    }

    set(k, val) {
        this.v[k] = val;
        for (const [n, cb] of [...this.h.values()]) {
            if (n === `changed::${k}`)
                cb();
        }
    }

    get_string(k) {
        return this.v[k];
    }

    get_boolean(k) {
        return this.v[k];
    }
}
const timers = new Map();
let tid = 1;
const fire = () => [...timers].forEach(([id, fn]) => timers.delete(id) && fn());
const iface = new Sig({'color-scheme': 'prefer-dark'});
const own = new Sig({'follow-color-scheme': true, 'dark-variant': 'Oxblood-Noir', 'light-variant': 'Merlot-Day'});
const applied = [];
const fol = new F.ThemeFollower({iface, own, schedule: (_ms, fn) => {
    timers.set(tid, fn);
    return tid++;
}, cancel: id => timers.delete(id), apply: n => applied.push(n), log: () => {}});
fol.enable();
fire();
eq(applied, ['Oxblood-Noir'], 'applied once at start');
iface.set('color-scheme', 'default');
iface.set('color-scheme', 'prefer-dark');
iface.set('color-scheme', 'default');
eq(timers.size, 1, 'quick toggles: one pending run');
fire();
eq(applied, ['Oxblood-Noir', 'Merlot-Day'], 'debounced to the last state');
own.set('follow-color-scheme', false);
iface.set('color-scheme', 'prefer-dark');
fire();
eq(applied.length, 2, 'following off: nothing applied');
own.set('follow-color-scheme', true);
fire();
eq(applied.slice(-1), ['Oxblood-Noir'], 'turned back on: applies');
iface.set('color-scheme', 'default');
fol.disable();
eq([timers.size, iface.h.size, own.h.size], [0, 0, 0], 'disable: no timer, no handler');
fire();
eq(applied.length, 3, 'nothing after disable');
for (let i = 0; i < 100; i++)
    fol.run();
ok(fol.applied.length === 32 && fol.applied.every(n => n === 'Merlot-Day'),
    'diagnostic history stays bounded after repeated theme changes');

// --- GSettings side (memory backend) and dict merge
const w = new A.SettingsWriter({extDirs: []});
const ifs = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
ifs.set_string('gtk-theme', 'Yaru');
eq(w.apply({schema: 'org.gnome.desktop.interface', key: 'gtk-theme', value: "'Yaru-dark'", ifOneOf: ["'Yaru'", "'Yaru-dark'"]}),
    'set', 'ours: switched');
eq(ifs.get_string('gtk-theme'), 'Yaru-dark', 'value written');
eq(w.apply({schema: 'org.gnome.desktop.interface', key: 'gtk-theme', value: "'Yaru-dark'"}), 'same', 'no rewrite');
ifs.set_string('gtk-theme', 'Adwaita');
eq(w.apply({schema: 'org.gnome.desktop.interface', key: 'gtk-theme', value: "'Yaru'", ifOneOf: ["'Yaru'", "'Yaru-dark'"]}),
    'skip', "the user's own theme is kept");
eq(w.apply({schema: 'org.example.missing', key: 'x', value: '1'}), 'skip', 'missing schema skipped');
eq(w.apply({schema: 'org.gnome.desktop.interface', key: 'gtk-theme', value: 'not gvariant'}), 'error', 'bad value: error, no throw');
const T = GLib.VariantType.new('a{sa{sv}}');
const cur = GLib.Variant.parse(T, "{'mine': {'x': <1>}, 'pipeline_bordeaux_slab': {'b': <0.75>}}", null, null);
const ours = GLib.Variant.parse(T, "{'pipeline_bordeaux_slab': {'b': <0.5>}, 'pipeline_bordeaux_island': {'b': <0.5>}}", null, null);
eq(A.mergeDict(cur, ours).print(false),
    "{'mine': {'x': <1>}, 'pipeline_bordeaux_slab': {'b': <0.5>}, 'pipeline_bordeaux_island': {'b': <0.5>}}",
    'merge keeps the user entries, replaces ours in place, appends new');

// --- applyVariant end to end on a temp tree
const tmp = GLib.dir_make_tmp('bxfollow-XXXXXX');
for (const d of docs) {
    for (const v of ['3', '4']) {
        GLib.mkdir_with_parents(`${tmp}/data/themes/${d.variant}/gtk-${v}.0`, 0o755);
        GLib.file_set_contents(`${tmp}/data/themes/${d.variant}/gtk-${v}.0/gtk.css`, `${d.variant} ${v}`);
    }
}
for (const v of ['3', '4']) {
    GLib.mkdir_with_parents(`${tmp}/conf/gtk-${v}.0`, 0o755);
    GLib.file_set_contents(`${tmp}/conf/gtk-${v}.0/gtk.css`, `Bordeaux ${v}`);
}
ifs.set_string('gtk-theme', 'Yaru-dark');
const res = A.applyVariant('Merlot-Day', {docs, writer: w, dataDir: `${tmp}/data`, configDir: `${tmp}/conf`});
eq(ifs.get_string('gtk-theme'), 'Yaru', 'applyVariant: GTK theme light');
eq(res.files.length, 2, 'applyVariant: both GTK stylesheets switched');
eq(new TextDecoder().decode(GLib.file_get_contents(`${tmp}/conf/gtk-4.0/gtk.css`)[1]), 'Merlot-Day 4', 'gtk-4.0 now light');
let threw = false;
try {
    A.applyVariant('Nope', {docs, writer: w});
} catch {
    threw = true;
}
ok(threw, 'unknown variant refused');
GLib.spawn_command_line_sync(`rm -rf ${tmp}`);
w.destroy();

print(`${passed} passed, ${failed} failed`);
System.exit(failed ? 1 : 0);
