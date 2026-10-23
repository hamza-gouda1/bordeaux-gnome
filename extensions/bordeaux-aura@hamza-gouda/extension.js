// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda
//
// Bordeaux Aura: a faint glow in each app's own colour behind the icons of
// Ubuntu Dock (or Dash to Dock). The dock's own actors are never restyled:
// each dash item gets one extra St.Widget, painted below the app icon.

import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

import * as Colour from './colour.js';

// Both export `dockManager` from extension.js. Ubuntu Dock steps aside when
// Dash to Dock is enabled, so the first active one with a manager wins.
const DOCK_UUIDS = ['ubuntu-dock@ubuntu.com', 'dash-to-dock@micxgx.gmail.com'];

const SAMPLE_SIZE = 64;
const ICONS_PER_IDLE = 2;
const EASE_MS = 200;
const REF_ICON = 48;

function safeDisconnect(obj, id) {
    try {
        obj?.disconnect(id);
    } catch {
        // Already gone with its owner.
    }
}

/**
 * Lazily computed dominant colours, cached by icon theme + app id.
 * Work runs in a low-priority idle, a couple of icons per tick.
 */
class ColourCache {
    constructor() {
        this._iconTheme = new St.IconTheme();
        this._map = new Map();
        this._pending = new Map();
        this._idleId = 0;
        this._themeId = this._iconTheme.connect('changed', () => this.clear());
        this.onInvalidate = null;
    }

    _key(app) {
        const theme = St.Settings.get().gtk_icon_theme ?? '';
        return `${theme}|${app.get_id?.() ?? app.get_name?.() ?? ''}`;
    }

    request(app, callback) {
        const key = this._key(app);
        if (this._map.has(key)) {
            callback(this._map.get(key));
            return;
        }
        const job = this._pending.get(key);
        if (job) {
            job.callbacks.push(callback);
            return;
        }
        this._pending.set(key, {app, callbacks: [callback]});
        if (!this._idleId) {
            this._idleId = GLib.idle_add(GLib.PRIORITY_LOW, () => this._work());
            GLib.Source.set_name_by_id(this._idleId, '[bordeaux-aura] colour');
        }
    }

    _work() {
        let n = 0;
        for (const [key, job] of this._pending) {
            if (n++ >= ICONS_PER_IDLE)
                return GLib.SOURCE_CONTINUE;
            this._pending.delete(key);
            const colour = this._compute(job.app);
            this._map.set(key, colour);
            for (const cb of job.callbacks)
                cb(colour);
        }
        this._idleId = 0;
        return GLib.SOURCE_REMOVE;
    }

    _compute(app) {
        try {
            const pixbuf = this._loadPixbuf(app);
            if (!pixbuf)
                return null;
            return Colour.dominantColour(pixbuf.get_pixels(), {
                width: pixbuf.get_width(),
                height: pixbuf.get_height(),
                rowstride: pixbuf.get_rowstride(),
                channels: pixbuf.get_n_channels(),
            });
        } catch {
            return null;
        }
    }

    _loadPixbuf(app) {
        let gicon = app.get_icon?.() ?? null;
        if (!gicon) {
            const tex = app.create_icon_texture?.(16);
            gicon = tex instanceof St.Icon ? tex.get_gicon() : null;
            tex?.destroy();
        }
        if (!gicon)
            return null;

        let pixbuf = null;
        if (gicon instanceof Gio.ThemedIcon) {
            const names = gicon.get_names().filter(n => !n.endsWith('-symbolic'));
            if (!names.length)
                return null;
            pixbuf = this._iconTheme.choose_icon(names, SAMPLE_SIZE, 0)?.load_icon() ?? null;
        } else if (gicon instanceof Gio.FileIcon) {
            const path = gicon.get_file().get_path();
            if (path)
                pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_size(path, SAMPLE_SIZE, SAMPLE_SIZE);
        } else if (gicon instanceof Gio.LoadableIcon) {
            const [stream] = gicon.load(SAMPLE_SIZE, null);
            try {
                pixbuf = GdkPixbuf.Pixbuf.new_from_stream_at_scale(
                    stream, SAMPLE_SIZE, SAMPLE_SIZE, true, null);
            } finally {
                stream.close(null);
            }
        }
        if (pixbuf && (pixbuf.get_width() > SAMPLE_SIZE * 1.5 ||
            pixbuf.get_height() > SAMPLE_SIZE * 1.5)) {
            pixbuf = pixbuf.scale_simple(SAMPLE_SIZE, SAMPLE_SIZE,
                GdkPixbuf.InterpType.BILINEAR);
        }
        return pixbuf;
    }

    clear() {
        this._map.clear();
        this.onInvalidate?.();
    }

    destroy() {
        if (this._idleId)
            GLib.source_remove(this._idleId);
        this._idleId = 0;
        this._pending.clear();
        this._map.clear();
        this.onInvalidate = null;
        safeDisconnect(this._iconTheme, this._themeId);
        this._iconTheme = null;
    }
}

export default class BordeauxAuraExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._cache = new ColourCache();
        this._cache.onInvalidate = () => this._recolourAll();
        this._icons = new Map(); // appIcon -> record
        this._dashes = new Map(); // dash -> record
        this._dockManager = null;
        this._dockManagerIds = [];
        this._token = 0;
        this._readSettings();

        this._settingsId = this._settings.connect('changed', (_s, key) => this._onSetting(key));
        this._ifaceId = this._iface.connect('changed::color-scheme', () => this._onSetting('theme-mode'));
        this._extStateId = Main.extensionManager.connect('extension-state-changed',
            (_m, ext) => {
                if (DOCK_UUIDS.includes(ext?.uuid))
                    this._sync();
            });
        this._sync();
    }

    disable() {
        this._token++;
        safeDisconnect(Main.extensionManager, this._extStateId);
        safeDisconnect(this._settings, this._settingsId);
        safeDisconnect(this._iface, this._ifaceId);
        this._detach();
        this._cache.destroy();
        this._cache = null;
        this._icons = null;
        this._dashes = null;
        this._settings = null;
        this._iface = null;
        this._cfg = null;
    }

    _readSettings() {
        const s = this._settings;
        let mode = s.get_string('theme-mode');
        if (mode === 'auto')
            mode = this._iface.get_string('color-scheme') === 'prefer-light' ? 'light' : 'dark';
        this._cfg = {
            enabled: s.get_boolean('enabled'),
            intensity: s.get_int('intensity'),
            hoverBoost: s.get_double('hover-boost'),
            onlyOnHover: s.get_boolean('only-on-hover'),
            blur: s.get_int('blur-radius'),
            accent: Colour.parseHex(s.get_string('accent')) ?? Colour.parseHex('#8E2A44'),
            mode,
        };
    }

    _onSetting(key) {
        const wasEnabled = this._cfg.enabled;
        this._readSettings();
        if (key === 'enabled' || wasEnabled !== this._cfg.enabled) {
            this._sync();
            return;
        }
        // Every other key changes the painted peak alpha or geometry:
        // restyle from the cached colours, no pixbuf work.
        for (const rec of this._icons.values()) {
            if (rec.colour === undefined)
                continue;
            this._style(rec);
            this._updateState(rec, false);
        }
    }

    // ---- dock discovery -------------------------------------------------

    async _sync() {
        const token = ++this._token;
        if (!this._cfg.enabled) {
            this._detach();
            return;
        }
        let manager = null;
        for (const uuid of DOCK_UUIDS) {
            const ext = Main.extensionManager.lookup(uuid);
            if (ext?.state !== ExtensionState.ACTIVE || !ext.dir)
                continue;
            try {
                // Same URI as the shell's own import, so this returns the
                // already-loaded module and its live `dockManager` binding.
                const mod = await import(ext.dir.get_child('extension.js').get_uri());
                manager = mod.dockManager ?? null;
            } catch {
                manager = null;
            }
            if (manager)
                break;
        }
        if (token !== this._token)
            return;
        if (manager === this._dockManager) {
            this._scanDocks();
            return;
        }
        this._detach();
        if (!manager)
            return;
        this._dockManager = manager;
        this._dockManagerIds = [manager.connect('toggled', () => this._scanDocks())];
        this._scanDocks();
    }

    _detach() {
        for (const id of this._dockManagerIds)
            safeDisconnect(this._dockManager, id);
        this._dockManagerIds = [];
        this._dockManager = null;
        for (const dash of [...this._dashes.keys()])
            this._unhookDash(dash);
        for (const appIcon of [...this._icons.keys()])
            this._unhookIcon(appIcon);
    }

    _scanDocks() {
        const docks = this._dockManager?._allDocks ?? [];
        const live = new Set();
        for (const dock of docks) {
            const dash = dock?.dash;
            if (!dash?._box)
                continue;
            live.add(dash);
            if (!this._dashes.has(dash))
                this._hookDash(dash);
        }
        for (const dash of [...this._dashes.keys()]) {
            if (!live.has(dash))
                this._unhookDash(dash);
        }
    }

    _hookDash(dash) {
        const box = dash._box;
        const rec = {box, ids: [], boxIds: []};
        rec.boxIds.push(box.connect('child-added', (_b, item) => this._hookItem(item)));
        rec.boxIds.push(box.connect('destroy', () => this._dashes?.delete(dash)));
        if (dash.connect) {
            try {
                rec.ids.push(dash.connect('icon-size-changed', () => this._resizeAll()));
            } catch {
                // Older dash without the signal; sizes refresh on rebuild.
            }
        }
        this._dashes.set(dash, rec);
        for (const item of box.get_children())
            this._hookItem(item);
    }

    _unhookDash(dash) {
        const rec = this._dashes.get(dash);
        if (!rec)
            return;
        this._dashes.delete(dash);
        for (const id of rec.boxIds)
            safeDisconnect(rec.box, id);
        for (const id of rec.ids)
            safeDisconnect(dash, id);
    }

    // ---- per icon -------------------------------------------------------

    _hookItem(item) {
        // item is the dock's DashItemContainer (BinLayout, one child: the
        // AppIcon). The glow goes in at index 0 of the item, below the icon.
        // Not inside _iconContainer: the dock indexes its children
        // ([0] icon, [1] dot) and restyles them in backlit mode.
        const appIcon = item?.child;
        if (!appIcon?.app || !appIcon._iconContainer || !this._icons ||
            this._icons.has(appIcon))
            return;

        const glow = new St.Widget({
            name: 'bordeaux-aura',
            reactive: false,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            opacity: 0,
        });
        item.insert_child_at_index(glow, 0);

        const rec = {appIcon, glow, ids: [], colour: undefined, peak: 0, dead: false};
        const upd = () => this._updateState(rec, true);
        for (const sig of ['notify::hover', 'notify::focused', 'notify::running', 'notify::pressed']) {
            try {
                rec.ids.push(appIcon.connect(sig, upd));
            } catch {
                // Property missing on this icon type.
            }
        }
        rec.ids.push(appIcon.connect('destroy', () => {
            rec.dead = true;
            this._icons?.delete(appIcon);
        }));
        this._icons.set(appIcon, rec);
        this._requestColour(rec);
    }

    _unhookIcon(appIcon) {
        const rec = this._icons.get(appIcon);
        if (!rec)
            return;
        this._icons.delete(appIcon);
        rec.dead = true;
        for (const id of rec.ids)
            safeDisconnect(appIcon, id);
        rec.glow.destroy();
    }

    _requestColour(rec) {
        this._cache.request(rec.appIcon.app, colour => {
            if (rec.dead)
                return;
            rec.colour = colour;
            this._style(rec);
            this._updateState(rec, false);
        });
    }

    _recolourAll() {
        if (!this._icons)
            return;
        for (const rec of this._icons.values())
            this._requestColour(rec);
    }

    _resizeAll() {
        for (const rec of this._icons.values()) {
            if (rec.colour !== undefined)
                this._style(rec);
        }
    }

    _style(rec) {
        const cfg = this._cfg;
        const size = rec.appIcon.icon?.iconSize || REF_ICON;
        const k = size / REF_ICON;
        const aura = Colour.auraColour(rec.colour, cfg.accent, cfg.mode);
        rec.base = aura.alpha;
        // Paint the style once at the strongest state; states only move
        // the actor's opacity, so St never re-renders the shadow.
        rec.peak = Colour.stateAlpha(aura.alpha, {
            ...this._stateCfg(), onlyOnHover: false, hover: true, focused: true,
        });
        const d = Math.max(4, Math.round(size * 0.55));
        const rgba = `rgba(${aura.r},${aura.g},${aura.b},${rec.peak.toFixed(3)})`;
        rec.glow.set_size(d, d);
        rec.glow.translation_y = Math.round(2 * k);
        rec.glow.set_style(
            `background-color: ${rgba}; border-radius: ${Math.ceil(d / 2)}px;` +
            ` box-shadow: 0 0 ${Math.round(cfg.blur * k)}px ${Math.round(12 * k)}px ${rgba};`);
    }

    _stateCfg() {
        const {intensity, hoverBoost, onlyOnHover} = this._cfg;
        return {intensity, hoverBoost, onlyOnHover};
    }

    _updateState(rec, animate) {
        if (rec.dead || rec.colour === undefined)
            return;
        const icon = rec.appIcon;
        const a = Colour.stateAlpha(rec.base, {
            ...this._stateCfg(),
            hover: !!icon.hover,
            focused: !!icon.focused,
            running: icon.running ?? true,
            pressed: !!icon.pressed,
        });
        const opacity = rec.peak > 0 ? Math.round(255 * Math.min(1, a / rec.peak)) : 0;
        if (!animate) {
            rec.glow.remove_all_transitions();
            rec.glow.opacity = opacity;
            return;
        }
        rec.glow.ease({
            opacity,
            duration: EASE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }
}
