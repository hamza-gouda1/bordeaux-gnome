// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda
//
// Light/dark following, the part that touches GSettings and files. Schemas of
// other extensions (User Themes, Blur my Shell) live inside those extensions,
// so they are looked up in every extension's schemas folder too. Each write is
// on its own: a missing schema or a bad value skips that key only.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import {buildOps, gtkCssOps} from './follow.js';

const EXT_DIRS = () => [
    GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions']),
    ...GLib.get_system_data_dirs().map(d => GLib.build_filenamev([d, 'gnome-shell', 'extensions'])),
];

function readText(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes) : null;
    } catch {
        return null;
    }
}

/** Every variants/<Variant>.json in `dir`, as objects. */
export function loadDocs(dir) {
    const docs = [];
    let en;
    try {
        en = Gio.File.new_for_path(dir).enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return docs;
    }
    for (let info; (info = en.next_file(null));) {
        if (!info.get_name().endsWith('.json'))
            continue;
        try {
            docs.push(JSON.parse(readText(`${dir}/${info.get_name()}`)));
        } catch {
            // a broken file only drops that variant
        }
    }
    en.close(null);
    return docs.sort((a, b) => a.variant.localeCompare(b.variant));
}

/** A dict-typed value with our entries put in (same keys replaced, the user's kept). */
export function mergeDict(current, ours) {
    const mine = new Map();
    for (let i = 0; i < ours.n_children(); i++) {
        const e = ours.get_child_value(i);
        mine.set(e.get_child_value(0).unpack(), e);
    }
    const out = [];
    for (let i = 0; i < current.n_children(); i++) {
        const e = current.get_child_value(i);
        const k = e.get_child_value(0).unpack();
        out.push(mine.get(k) ?? e);
        mine.delete(k);
    }
    out.push(...mine.values());
    return GLib.Variant.new_array(current.get_type().element(), out);
}

export class SettingsWriter {
    constructor({extDirs = EXT_DIRS(), log = () => {}} = {}) {
        this._extDirs = extDirs;
        this._log = log;
        this._source = null;
        this._cache = new Map();
    }

    _lookup(schemaId) {
        if (!this._source) {
            let src = Gio.SettingsSchemaSource.get_default();
            for (const base of this._extDirs) {
                let en;
                try {
                    en = Gio.File.new_for_path(base).enumerate_children('standard::name',
                        Gio.FileQueryInfoFlags.NONE, null);
                } catch {
                    continue;
                }
                for (let info; (info = en.next_file(null));) {
                    const dir = `${base}/${info.get_name()}/schemas`;
                    if (!GLib.file_test(`${dir}/gschemas.compiled`, GLib.FileTest.EXISTS))
                        continue;
                    try {
                        src = Gio.SettingsSchemaSource.new_from_directory(dir, src, false);
                    } catch {
                        // unreadable: skip that extension
                    }
                }
                en.close(null);
            }
            this._source = src;
        }
        return this._source?.lookup(schemaId, true) ?? null;
    }

    settings(schemaId) {
        if (!this._cache.has(schemaId)) {
            const schema = this._lookup(schemaId);
            this._cache.set(schemaId, schema ? new Gio.Settings({settings_schema: schema}) : null);
        }
        return this._cache.get(schemaId);
    }

    /** Applies one op; returns 'set', 'same', 'skip' or 'error'. */
    apply(op) {
        try {
            const s = this.settings(op.schema);
            if (!s || !s.settings_schema.has_key(op.key))
                return 'skip';
            const type = s.settings_schema.get_key(op.key).get_value_type();
            const parse = text => GLib.Variant.parse(type, text, null, null);
            const cur = s.get_value(op.key);
            if (op.ifOneOf && !op.ifOneOf.some(t => parse(t).equal(cur)))
                return 'skip'; // a value the user chose
            if (op.requireInList && !s.get_strv('list').includes(op.requireInList))
                return 'skip';
            if (op.requireFile && !GLib.file_test(op.requireFile, GLib.FileTest.EXISTS))
                return 'skip';
            let want = parse(op.value);
            if (op.merge)
                want = mergeDict(cur, want);
            if (cur.equal(want))
                return 'same';
            s.set_value(op.key, want);
            return 'set';
        } catch (e) {
            this._log(`${op.schema} ${op.key}: ${e.message}`);
            return 'error';
        }
    }

    destroy() {
        this._cache.clear();
        this._source = null;
    }
}

/**
 * Switches the desktop to `name`; returns {ops: [[schema key result]], files: [paths]}.
 */
export function applyVariant(name, {docs, writer, dataDir = GLib.get_user_data_dir(),
    configDir = GLib.get_user_config_dir(), log = () => {}}) {
    const doc = docs.find(d => d.variant === name);
    if (!doc)
        throw new Error(`no data for variant ${name}`);
    const bgDir = `${dataDir}/backgrounds/bordeaux-gnome`;
    const res = {ops: [], files: []};
    for (const op of buildOps(doc, docs, {bgDir}))
        res.ops.push([op.schema, op.key, writer.apply(op)]);
    for (const f of gtkCssOps(doc, docs, {configDir, themesDir: `${dataDir}/themes`}, readText)) {
        try {
            GLib.file_set_contents(f.path, f.contents);
            res.files.push(f.path);
        } catch (e) {
            log(`${f.path}: ${e.message}`);
        }
    }
    return res;
}
