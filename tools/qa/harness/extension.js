// Copyright (C) Hamza Gouda
// SPDX-License-Identifier: GPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Hamza Gouda
//
// QA harness for tools/shell_qa.py. It only runs inside the private headless
// shell that script starts (BXQA_PRIVATE=1): it opens each surface of the shell
// in turn, saves a full-screen PNG per scene into $BXQA_OUT and writes
// metrics.json with geometry the script checks (top-bar font size, dock slab
// margins, ellipsized labels, aura glow boxes, CPU ticks). It never activates
// a toggle or menu item, so nothing is switched even on the mock services.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WindowPreview} from 'resource:///org/gnome/shell/ui/windowPreview.js';
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import * as WorkspaceSwitcherPopup from 'resource:///org/gnome/shell/ui/workspaceSwitcherPopup.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot');

const OUT = GLib.getenv('BXQA_OUT');
const WANT = new Set((GLib.getenv('BXQA_SCENES') || 'all').split(','));
const APPS = (GLib.getenv('BXQA_APPS') || '').split(',').filter(Boolean);
const DOCK_UUID = 'ubuntu-dock@ubuntu.com';
const AURA_UUID = 'bordeaux-aura@hamza-gouda';
const FOCUS_UUID = 'focus-keys@hamza-gouda';
const TUF_UUID = 'tuf-control-quick@hamza-gouda';

const sleep = ms => new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
    r();
    return GLib.SOURCE_REMOVE;
}));
const want = s => WANT.has('all') || WANT.has(s);

function rect(actor) {
    if (!actor)
        return null;
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return {x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h)};
}

function fontPx(actor) {
    const fd = actor.get_theme_node().get_font();
    const size = fd.get_size() / Pango.SCALE;
    if (fd.get_size_is_absolute())
        return size;
    const dpi = Clutter.Settings.get_default().font_dpi / 1024;
    return Math.round(size * dpi / 72 * 10) / 10;
}

function* walk(actor) {
    yield actor;
    for (const c of actor.get_children())
        yield* walk(c);
}

// Visible labels whose text St had to cut with an ellipsis, plus the smallest font.
function labels(root) {
    const cut = [], sizes = [];
    if (!root)
        return {cut, minPx: null};
    for (const a of walk(root)) {
        if (!(a instanceof St.Label) || !a.is_mapped() || !a.text || !a.width || !a.height)
            continue;
        const px = fontPx(a);
        sizes.push(px);
        if (a.clutter_text.get_layout().is_ellipsized()) {
            let grid = false;
            for (let p = a.get_parent(); p && !grid; p = p.get_parent())
                grid = !!p.has_style_class_name?.('overview-tile') || !!p.has_style_class_name?.('app-well-app');
            cut.push({text: a.text, px, cls: a.get_style_class_name() ?? '', box: rect(a), grid});
        }
    }
    return {cut, minPx: sizes.length ? Math.min(...sizes) : null};
}

export default class QaHarness {
    enable() {
        if (GLib.getenv('BXQA_PRIVATE') !== '1' || !OUT)
            return;
        // The shell re-enables extensions after one enabled before them is cycled;
        // the run must not start over (it would truncate the log and the metrics).
        if (this._started)
            return;
        this._started = true;
        this.metrics = {scenes: [], errors: []};
        this._logf = Gio.File.new_for_path(`${OUT}/harness.log`)
            .replace(null, false, Gio.FileCreateFlags.NONE, null);
        this.run().catch(e => this.fail(e)).finally(() => this.finish());
    }

    disable() {}

    log(msg) {
        this._logf.write_all(`${(GLib.get_monotonic_time() / 1e6).toFixed(1)} ${msg}\n`, null);
    }

    fail(e) {
        this.log(`ERROR ${e}\n${e?.stack ?? ''}`);
        this.metrics.errors.push(`${e}`);
    }

    finish() {
        GLib.file_set_contents(`${OUT}/metrics.json`, JSON.stringify(this.metrics, null, 1));
        this._logf.close(null);
        GLib.file_set_contents(`${OUT}/DONE`, 'ok');
    }

    async shot(name, root = null) {
        await sleep(150);
        const f = Gio.File.new_for_path(`${OUT}/${name}.png`);
        const s = f.replace(null, false, Gio.FileCreateFlags.NONE, null);
        await new Shell.Screenshot().screenshot(false, s);
        s.close(null);
        const entry = {name, labels: labels(root), box: root ? rect(root) : null};
        this.metrics.scenes.push(entry);
        this.log(`shot ${name}`);
        return entry;
    }

    async scene(name, fn) {
        if (!want(name))
            return;
        this.log(`scene ${name}`);
        try {
            await fn();
        } catch (e) {
            this.fail(new Error(`${name}: ${e}\n${e.stack}`));
        }
    }

    // ---- input ---------------------------------------------------------------
    get pointer() {
        if (!this._ptr) {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._ptr = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
            this._kbd = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        }
        return this._ptr;
    }

    async moveTo(x, y, steps = 6) {
        const [cx, cy] = global.get_pointer();
        for (let i = 1; i <= steps; i++) {
            this.pointer.notify_absolute_motion(GLib.get_monotonic_time(),
                cx + (x - cx) * i / steps, cy + (y - cy) * i / steps);
            await sleep(16);
        }
    }

    async key(keyval) {
        void this.pointer;
        this._kbd.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
        await sleep(30);
        this._kbd.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
        await sleep(200);
    }

    // A real key combination through the virtual keyboard, e.g. Control+F9.
    async combo(mods, keyval) {
        void this.pointer;
        const t = () => GLib.get_monotonic_time();
        for (const m of mods)
            this._kbd.notify_keyval(t(), m, Clutter.KeyState.PRESSED);
        await sleep(30);
        this._kbd.notify_keyval(t(), keyval, Clutter.KeyState.PRESSED);
        await sleep(30);
        this._kbd.notify_keyval(t(), keyval, Clutter.KeyState.RELEASED);
        for (const m of [...mods].reverse())
            this._kbd.notify_keyval(t(), m, Clutter.KeyState.RELEASED);
        await sleep(200);
    }

    // ---- dock ----------------------------------------------------------------
    async dock() {
        const ext = Main.extensionManager.lookup(DOCK_UUID);
        if (!ext?.dir)
            return null;
        const mod = await import(ext.dir.get_child('extension.js').get_uri());
        return mod.dockManager?._allDocks?.[0] ?? null;
    }

    dockItems(dock) {
        return dock.dash._box.get_children().filter(c => c.child?.app && c.child.icon);
    }

    measureDock(dock) {
        const dash = dock.dash;
        const bg = rect(dash._background);
        const items = this.dockItems(dock);
        const icons = items.map(i => rect(i.child.icon._iconBin ?? i.child.icon));
        const showApps = rect(dash._showAppsIcon?.icon?._iconBin ?? dash._showAppsIcon);
        const all = [...icons, showApps].filter(Boolean);
        const node = dash._background.get_theme_node();
        const out = {
            background: bg,
            radius: node.get_border_radius(St.Corner.TOPLEFT),
            scrollView: rect(dash._scrollView),
            icons, showApps,
            apps: items.map(i => i.child.app.get_id()),
            running: items.map(i => i.child.app.state === Shell.AppState.RUNNING),
        };
        if (bg && all.length) {
            const left = Math.min(...all.map(r => r.x)), right = Math.max(...all.map(r => r.x + r.w));
            const top = Math.min(...all.map(r => r.y)), bottom = Math.max(...all.map(r => r.y + r.h));
            out.margins = {left: left - bg.x, right: bg.x + bg.w - right, top: top - bg.y,
                bottom: bg.y + bg.h - bottom};
            out.centreOffsets = all.map(r => Math.round((r.x + r.w / 2) - (bg.x + bg.w / 2)));
        }
        out.aura = items.map(i => {
            const g = i.get_children().find(c => c.name === 'bordeaux-aura');
            return g ? {box: rect(g), opacity: g.opacity, style: g.get_style()} : null;
        });
        return out;
    }

    // ---- scenes --------------------------------------------------------------
    async run() {
        // D-Bus activated apps (Files, Terminal, portals) need the display.
        await new Promise(resolve => Gio.DBus.session.call('org.freedesktop.DBus',
            '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'UpdateActivationEnvironment',
            new GLib.Variant('(a{ss})', [{
                WAYLAND_DISPLAY: GLib.getenv('BXQA_WAYLAND') ?? 'wayland-0',
                XDG_CURRENT_DESKTOP: GLib.getenv('XDG_CURRENT_DESKTOP') ?? 'GNOME',
                XDG_SESSION_TYPE: 'wayland',
            }]), null, Gio.DBusCallFlags.NONE, 3000, null, () => resolve()));
        if (Main.layoutManager._startingUp)
            await new Promise(r => Main.layoutManager.connect('startup-complete', r));
        Main.overview.hide();
        await sleep(2500);
        await this.moveTo(1500, 700, 1);
        this.metrics.monitor = rect(Main.layoutManager.primaryMonitor ? global.stage : null);
        this.metrics.extensions = Object.fromEntries(Main.extensionManager.getUuids()
            .map(u => [u, Main.extensionManager.lookup(u)?.state]));

        await this.openWindows();
        const dock = await this.dock();

        await this.scene('desktop', async () => {
            dock?._show();
            await sleep(1200);
            await this.shot('desktop', Main.panel);
            this.metrics.panel = this.measurePanel();
            if (dock)
                this.metrics.dock = this.measureDock(dock);
        });

        await this.scene('dock', async () => {
            if (!dock)
                throw new Error('no dock');
            dock._show();
            await sleep(600);
            const items = this.dockItems(dock);
            const target = items.find(i => i.child.app.state === Shell.AppState.RUNNING) ?? items[0];
            const r = rect(target.child.icon);
            await this.moveTo(r.x + r.w / 2, r.y + r.h / 2, 10);
            await sleep(1600);
            const e = await this.shot('dock-hover', dock);
            this.metrics.dockHover = this.measureDock(dock);
            const label = dock.dash._labelShowing !== undefined
                ? Main.uiGroup.get_children().find(c => c.has_style_class_name?.('dash-label') && c.visible)
                : null;
            e.tooltip = label ? {box: rect(label), px: fontPx(label)} : null;
            target.child.popupMenu();
            await sleep(900);
            await this.shot('dock-menu', target.child._menu?.actor);
            target.child._menu?.close();
            await sleep(400);
            await this.moveTo(1500, 700);
            await sleep(400);
        });

        await this.scene('aura-cpu', async () => {
            if (!dock)
                throw new Error('no dock');
            const settings = Main.extensionManager.lookup(AURA_UUID)?.stateObj?.getSettings?.();
            dock._show();
            await sleep(500);
            const sweep = async () => {
                const t0 = this.cpu();
                const pts = this.dockItems(dock).map(i => rect(i.child.icon));
                const end = GLib.get_monotonic_time() + 4e6;
                let k = 0;
                while (GLib.get_monotonic_time() < end) {
                    const r = pts[k++ % pts.length];
                    await this.moveTo(r.x + r.w / 2, r.y + r.h / 2, 4);
                    await sleep(60);
                }
                return this.cpu() - t0;
            };
            const idle = async () => {
                const t0 = this.cpu();
                await sleep(4000);
                return this.cpu() - t0;
            };
            await this.moveTo(1500, 700);
            const res = {idleOn: await idle(), sweepOn: await sweep()};
            if (settings) {
                settings.set_boolean('enabled', false);
                await sleep(500);
                await this.moveTo(1500, 700);
                res.idleOff = await idle();
                res.sweepOff = await sweep();
                settings.set_boolean('enabled', true);
                await sleep(800);
            }
            res.ticksPerSecond = 100;
            this.metrics.auraCpu = res;
            await this.moveTo(1500, 700);
        });

        await this.scene('quick-settings', async () => {
            const qs = Main.panel.statusArea.quickSettings;
            qs.menu.open(false);
            await sleep(1400);
            const e = await this.shot('quick-settings', qs.menu.box);
            e.box = rect(qs.menu.box);
            const sysBox = qs._system?._systemItem;
            this.metrics.qsSystem = sysBox ? [...walk(sysBox)].filter(a => a.get_style_class_name?.())
                .map(a => ({cls: a.get_style_class_name(), box: rect(a)})) : null;
            const toggles = qs.menu._grid.get_children().filter(c => c.visible && c.menu);
            this.metrics.qsToggles = qs.menu._grid.get_children().filter(c => c.visible)
                .map(c => c.title ?? c.constructor.name);
            for (const t of toggles) {
                const slug = (t.title || t.constructor.name).toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
                t.menu.open(false);
                await sleep(1100);
                await this.shot(`qs-${slug}`, t.menu.box ?? t.menu.actor);
                t.menu.close(false);
                await sleep(500);
            }
            const sys = qs._system?._systemItem;
            if (sys?.menu) {
                sys.menu.open(false);
                await sleep(1000);
                await this.shot('qs-power-menu', sys.menu.box ?? sys.menu.actor);
                sys.menu.close(false);
                await sleep(400);
            }
            qs.menu.close(false);
            await sleep(600);
        });

        await this.scene('notifications', async () => {
            const notes = [
                ['Calendar', 'org.gnome.Calendar', 'Tasting at 19:00', 'Cellar room, six vintages from the right bank'],
                ['Files', 'org.gnome.Nautilus', 'Copy complete', '48 photos copied to Pictures'],
                ['Terminal', 'org.gnome.Terminal', 'Build finished', 'tools/build.py --check passed'],
            ];
            await this.notify(...notes[0]);
            await sleep(1300);
            const banner = Main.messageTray._bannerBin?.get_first_child?.() ?? Main.messageTray;
            await this.shot('notification-banner', banner);
            // The shell keeps a banner up while the session is idle, which a headless
            // one always is: block banners so the rest go straight to the list.
            Main.messageTray.bannerBlocked = true;
            Main.messageTray._userActiveWhileNotificationShown = true;
            Main.messageTray._expireNotification?.();
            for (const n of notes.slice(1)) {
                await this.notify(...n);
                await sleep(300);
            }
            await sleep(1500);
            const dm = Main.panel.statusArea.dateMenu;
            dm.menu.open(false);
            await sleep(1500);
            const e = await this.shot('calendar', dm.menu.box);
            e.box = rect(dm.menu.box);
            dm.menu.close(false);
            await sleep(600);
        });

        await this.scene('osd', async () => {
            Main.osdWindowManager.show(-1, Gio.ThemedIcon.new('audio-volume-medium-symbolic'),
                'Speakers', 0.62, 1);
            await sleep(800);
            await this.shot('osd-volume', Main.uiGroup);
            Main.osdWindowManager.hideAll();
            await sleep(500);
            Main.osdWindowManager.show(-1, Gio.ThemedIcon.new('display-brightness-symbolic'),
                null, 0.7, 1);
            await sleep(800);
            await this.shot('osd-brightness');
            Main.osdWindowManager.hideAll();
            await sleep(500);
        });

        await this.scene('overview', async () => {
            // A window on a second workspace, so the overview shows its thumbnails.
            const calc = global.get_window_actors().map(a => a.meta_window)
                .find(w => /calculator/i.test(w.get_wm_class() ?? ''));
            calc?.change_workspace_by_index(1, true);
            Main.overview.show();
            await sleep(2200);
            await this.shot('overview', Main.overview._overview);
            await this.moveTo(960, 560, 8);
            await sleep(1200);
            await this.shot('overview-hover', Main.overview._overview);
            Main.overview.searchEntry.set_text('term');
            await sleep(2500);
            await this.shot('search', Main.overview._overview);
            Main.overview.searchEntry.set_text('');
            await sleep(800);
            Main.overview.hide();
            await sleep(1500);
            Main.overview.showApps();
            await sleep(2200);
            await this.shot('app-grid', Main.overview._overview);
            const appDisplay = Main.overview._overview._controls._appDisplay;
            const folder = appDisplay?._orderedItems?.find(i => i.constructor.name.includes('Folder'));
            if (folder) {
                folder.open();
                await sleep(1600);
                await this.shot('app-folder', folder._dialog);
                folder._dialog?.popdown();
                await sleep(800);
            }
            Main.overview.hide();
            await sleep(1500);
            await this.moveTo(1500, 700);
        });

        await this.scene('alt-tab', async () => {
            const popup = new AltTab.AppSwitcherPopup();
            popup._resetNoModsTimeout = () => {};
            if (popup.show(false, 'switch-applications', 0)) {
                await sleep(1000);
                await this.shot('alt-tab', popup);
                popup._popModal?.();
                popup.destroy();
            } else {
                popup.destroy();
                throw new Error('switcher did not show');
            }
            await sleep(500);
        });

        await this.scene('workspace-switcher', async () => {
            const wm = global.workspace_manager;
            if (wm.n_workspaces < 3)
                wm.append_new_workspace(false, global.get_current_time());
            const p = new WorkspaceSwitcherPopup.WorkspaceSwitcherPopup();
            p.display(1);
            await sleep(250); // it fades out by itself after ~0.75 s
            await this.shot('workspace-switcher');
            await sleep(400);
        });

        await this.scene('run-dialog', async () => {
            Main.openRunDialog();
            await sleep(1000);
            await this.shot('run-dialog', Main.uiGroup);
            await this.key(Clutter.KEY_Escape);
            await sleep(600);
        });

        await this.scene('end-session', async () => {
            const call = (m, v) => Gio.DBus.session.call('org.gnome.Shell',
                '/org/gnome/SessionManager/EndSessionDialog',
                'org.gnome.SessionManager.EndSessionDialog', m, v, null,
                Gio.DBusCallFlags.NONE, 3000, null, null);
            call('Open', new GLib.Variant('(uuuao)', [1, 0, 60, []]));
            await sleep(1800);
            await this.shot('end-session', Main.uiGroup);
            call('Close', null);
            await sleep(900);
        });

        await this.scene('profile-osd', () => this.profileOsd());
        await this.scene('focus-keys', () => this.focusKeys());
        await this.scene('show-desktop', async () => {
            const ext = Main.extensionManager.lookup(FOCUS_UUID)?.stateObj;
            if (!ext?._desktop)
                throw new Error('show desktop is not available');
            const settings = ext.getSettings();
            const previous = settings.get_strv('show-desktop-shortcut');
            const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL,
                global.workspace_manager.get_active_workspace())
                .filter(w => !w.minimized && !w.skip_taskbar && w.can_minimize());
            const r = {windows: windows.length, animationFactor: St.Settings.get().slow_down_factor};
            try {
                settings.set_strv('show-desktop-shortcut', ['<Control>F12']);
                await sleep(300);
                await this.combo([Clutter.KEY_Control_L], Clutter.KEY_F12);
                await sleep(600);
                r.hidden = windows.every(w => w.minimized);
                await this.shot('show-desktop');
                await this.combo([Clutter.KEY_Control_L], Clutter.KEY_F12);
                await sleep(600);
                r.restored = windows.every(w => !w.minimized && w.get_compositor_private()?.opacity === 255);
                ext._desktop.toggle();
                ext._desktop.toggle();
                await sleep(600);
                r.interrupted = windows.every(w => !w.minimized && w.get_compositor_private()?.opacity === 255);
                await this.shot('show-desktop-restored');
            } finally {
                ext._desktop.restore();
                settings.set_strv('show-desktop-shortcut', previous);
            }
            this.metrics.desktopToggle = r;
            const actions = Main.extensionManager.lookup(TUF_UUID)?.stateObj?._gestures?._actions;
            if (!actions)
                throw new Error('TUF desktop gesture actions unavailable');
            const clean = () => windows.every(w => !w.minimized && w.get_compositor_private()?.opacity === 255);
            const gesture = {windows: windows.length, actorsBefore: global.window_group.get_n_children()};
            gesture.animationsEnabled = St.Settings.get().enable_animations;
            actions['show-desktop']();
            gesture.transitionCount = windows.filter(w =>
                !!w.get_compositor_private()?.get_transition('opacity')).length;
            await sleep(70);
            gesture.opacityDuring = windows.map(w => w.get_compositor_private()?.opacity);
            gesture.actorsDuring = global.window_group.get_n_children();
            await this.shot('tuf-desktop-fading');
            await sleep(250);
            gesture.hidden = windows.every(w => w.minimized);
            actions['show-desktop']();
            await sleep(300);
            gesture.restored = clean();
            actions['show-desktop']();
            actions['show-desktop']();
            await sleep(300);
            gesture.interrupted = clean();
            Main.overview.show();
            await sleep(500);
            actions['show-desktop']();
            gesture.waitedForOverview = windows.every(w => !w.minimized);
            await sleep(800);
            gesture.deferred = windows.every(w => w.minimized) && !Main.overview.visible;
            actions['show-desktop']();
            await sleep(300);
            gesture.finalRestored = clean();
            await this.shot('tuf-desktop-restored');
            const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
            const animated = iface.get_boolean('enable-animations');
            try {
                iface.set_boolean('enable-animations', false);
                await sleep(100);
                actions['show-desktop']();
                gesture.reducedMotionHide = windows.every(w => w.minimized);
                actions['show-desktop']();
                gesture.reducedMotionRestore = clean();
            } finally {
                iface.set_boolean('enable-animations', animated);
            }
            this.metrics.tufDesktopToggle = gesture;
        });
        await this.scene('gesture-drag', () => this.gestureDrag());
        await this.scene('color-scheme', () => this.colorScheme());

        await this.scene('lock', async () => {
            Main.screenShield.lock(false);
            await sleep(2000);
            // A manual lock fades to black (monitor off); motion wakes it like a user would.
            await this.moveTo(900, 600, 4);
            await this.moveTo(1000, 650, 4);
            Main.screenShield._longLightbox?.lightOff();
            Main.screenShield._shortLightbox?.lightOff();
            await sleep(1500);
            await this.shot('lock', Main.screenShield.actor);
            Main.screenShield._activateDialog?.();
            await sleep(2200);
            await this.shot('unlock', Main.screenShield.actor);
        });
    }

    // ---- Light/dark following (Bordeaux Aura): flip color-scheme, check the theme --
    async colorScheme() {
        const aura = Main.extensionManager.lookup(AURA_UUID)?.stateObj;
        if (!aura?._follower)
            throw new Error('bordeaux-aura is not running or has no follower');
        const own = aura._settings;
        const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        const ut = aura._writer.settings('org.gnome.shell.extensions.user-theme');
        const home = GLib.get_home_dir();
        const read = p => {
            try {
                return new TextDecoder().decode(GLib.file_get_contents(p)[1]);
            } catch {
                return null;
            }
        };
        const gtkVariant = v => {
            const cur = read(`${home}/.config/gtk-${v}.0/gtk.css`);
            return ['Bordeaux', 'Oxblood-Noir', 'Merlot-Day'].find(n =>
                read(`${GLib.get_user_data_dir()}/themes/${n}/gtk-${v}.0/gtk.css`) === cur) ?? null;
        };
        const snap = () => ({
            scheme: iface.get_string('color-scheme'), userTheme: ut?.get_string('name') ?? null,
            gtkTheme: iface.get_string('gtk-theme'), accent: own.get_string('accent'),
            stylesheet: Main.getThemeStylesheet?.()?.get_path?.() ?? null,
            gtk4: gtkVariant('4'), gtk3: gtkVariant('3'), applied: aura.lastFollow?.variant ?? null,
        });
        const qsShot = async name => {
            const qs = Main.panel.statusArea.quickSettings;
            qs.menu.open(false);
            await sleep(1300);
            const e = await this.shot(name, qs.menu.box);
            e.box = rect(qs.menu.box);
            qs.menu.close(false);
            await sleep(500);
        };
        const r = {start: snap()};
        const startScheme = r.start.scheme, startDark = own.get_string('dark-variant');
        own.set_boolean('follow-color-scheme', true);
        own.set_string('dark-variant', 'Bordeaux');
        iface.set_string('color-scheme', 'prefer-dark');
        await sleep(1800);
        r.dark = snap();
        await qsShot('scheme-dark');
        // Three quick toggles: one apply, for the last state.
        const before = aura._follower.applied.length;
        for (const s of ['default', 'prefer-dark', 'default']) {
            iface.set_string('color-scheme', s);
        }
        await sleep(1800);
        r.light = {...snap(), appliesForBurst: aura._follower.applied.length - before};
        await qsShot('scheme-light');
        own.set_string('dark-variant', 'Oxblood-Noir');
        iface.set_string('color-scheme', 'prefer-dark');
        await sleep(1800);
        r.noir = snap();
        own.set_string('dark-variant', startDark);
        iface.set_string('color-scheme', startScheme);
        await sleep(1800);
        r.restored = snap();
        own.set_boolean('follow-color-scheme', false);
        await sleep(300);
        this.metrics.colorScheme = r;
    }

    // ---- TUF Control profile OSD: asusd PlatformProfile changes (Fn+F5) ------
    osdState() {
        const w = Main.osdWindowManager._osdWindows?.[0];
        return w ? {visible: w.visible, label: w._label?.visible ? w._label.text : null,
            icon: w._icon?.gicon?.to_string?.() ?? null, box: rect(w._hbox)} : null;
    }

    setAsusdProfile(id) {
        // Same as asusd itself switching: the mock emits PropertiesChanged.
        return new Promise(resolve => Gio.DBus.system.call('xyz.ljones.Asusd', '/xyz/ljones',
            'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['xyz.ljones.Platform', 'PlatformProfile', new GLib.Variant('u', id)]),
            null, Gio.DBusCallFlags.NONE, 3000, null, () => resolve()));
    }

    async gestureDrag() {
        const ext = Main.extensionManager.lookup(TUF_UUID)?.stateObj;
        const watcher = ext?._gestures;
        const input = ext?._gestureInput;
        if (!input || !watcher)
            throw new Error('interactive TUF gestures unavailable');

        const settings = watcher._settings;
        const values = {
            'gesture-enabled': new GLib.Variant('b', true),
            'gesture-swipe3-down': new GLib.Variant('s', 'show-desktop'),
            'gesture-swipe3-left': new GLib.Variant('s', 'next-window'),
            'gesture-swipe3-right': new GLib.Variant('s', 'prev-window'),
            'gesture-swipe4-up': new GLib.Variant('s', 'volume-up'),
            'gesture-swipe4-down': new GLib.Variant('s', 'volume-down'),
            'gesture-hold4': new GLib.Variant('s', 'play-pause'),
        };
        const previous = Object.fromEntries(Object.keys(values).map(key => [key, settings.get_value(key)]));
        const native = [Main.overview._swipeTracker._touchpadGesture,
            Main.wm._workspaceAnimation._swipeTracker._touchpadGesture];
        const originalEnabled = native.map(gesture => gesture.enabled);
        const Phase = Clutter.TouchpadGesturePhase;
        const emit = (phase, dx = 0, dy = 0, fingers = 3,
            type = Clutter.EventType.TOUCHPAD_SWIPE,
            time = Math.floor(GLib.get_monotonic_time() / 1000) >>> 0) => {
            const event = {
                type: () => type,
                get_gesture_phase: () => phase,
                get_touchpad_gesture_finger_count: () => fingers,
                get_gesture_motion_delta: () => [dx, dy],
                get_gesture_motion_delta_unaccelerated: () => [dx, dy],
                get_coords: () => [960, 600],
                get_time: () => time,
            };
            // Clutter filters run before the native captured-event handlers.
            if (watcher._event(event) === Clutter.EVENT_STOP)
                return Clutter.EVENT_STOP;
            for (const gesture of native) {
                if (gesture._handleEvent(global.stage, event) === Clutter.EVENT_STOP)
                    return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        };
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL_ALL,
            global.workspace_manager.get_active_workspace()).filter(w =>
            !w.minimized && !w.skip_taskbar && w.can_minimize() && !w.is_on_all_workspaces());
        const metrics = {windows: windows.length};
        if (windows.length < 2)
            throw new Error('need two visible test apps');

        const actors = windows.map(window => window.get_compositor_private());
        const baseline = actors.map(actor => [actor.translation_x, actor.translation_y, actor.opacity]);
        const clean = () => actors.every((actor, i) => actor.translation_x === baseline[i][0] &&
            actor.translation_y === baseline[i][1] && actor.opacity === baseline[i][2]);
        try {
            for (const [key, value] of Object.entries(values))
                settings.set_value(key, value);
            Main.activateWindow(windows[0], global.get_current_time());
            await sleep(150);
            metrics.beginPropagates = emit(Phase.BEGIN) === Clutter.EVENT_PROPAGATE;
            metrics.downOwned = emit(Phase.UPDATE, 0, 80) === Clutter.EVENT_STOP;
            metrics.desktopTracks = actors.every((actor, i) => actor.translation_y > baseline[i][1]
                && actor.opacity < baseline[i][2]) && windows.every(w => !w.minimized);
            const forward = actors[0].translation_y;
            emit(Phase.UPDATE, 0, -40);
            metrics.reverses = actors[0].translation_y < forward;
            await this.shot('tuf-desktop-tracking');
            emit(Phase.CANCEL);
            await sleep(250);
            metrics.cancelRestores = clean() && windows.every(w => !w.minimized);
            metrics.nativeReleased = native.every((gesture, i) => gesture.enabled === originalEnabled[i]);

            emit(Phase.BEGIN);
            emit(Phase.UPDATE, 0, 105);
            emit(Phase.END);
            await sleep(250);
            metrics.hidden = clean() && windows.every(w => w.minimized);
            emit(Phase.BEGIN);
            emit(Phase.UPDATE, 0, 80);
            metrics.returnTracks = actors.some((actor, i) => actor.translation_y < baseline[i][1]);
            emit(Phase.END);
            await sleep(250);
            metrics.returned = clean() && windows.every(w => !w.minimized);

            const focused = global.display.focus_window;
            emit(Phase.BEGIN);
            emit(Phase.UPDATE, -120, 0);
            metrics.appTracks = !clean() && global.display.focus_window === focused;
            emit(Phase.END);
            await sleep(250);
            metrics.appSwitched = clean() && global.display.focus_window !== focused;
            emit(Phase.BEGIN);
            emit(Phase.UPDATE, 120, 0);
            Main.overview.show();
            await sleep(550);
            metrics.overviewSettled = clean() && !Main.overview.animationInProgress && Main.overview.visible;
            const previews = [];
            const visit = actor => {
                if (!actor.is_mapped())
                    return;
                if (actor instanceof WindowPreview && windows.includes(actor.metaWindow))
                    previews.push(rect(actor));
                for (const child of actor.get_children())
                    visit(child);
            };
            visit(Main.layoutManager.overviewGroup);
            metrics.previews = previews;
            metrics.overlap = previews.some((a, i) => previews.slice(i + 1).some(b =>
                Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 3 &&
                Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 3));
            await this.shot('overview-after-gesture');
            Main.overview.hide();
            await sleep(450);
            emit(Phase.BEGIN);
            emit(Phase.UPDATE, 0, -120);
            emit(Phase.UPDATE, 0, -160);
            emit(Phase.END);
            await sleep(500);
            metrics.nativeUpSettled = Main.overview.visible && !Main.overview.animationInProgress;
            // Exercise media dispatch with fake sinks in this private session.
            const media = [];
            const actions = watcher._actions;
            const keys = ['volume-up', 'volume-down', 'play-pause'];
            const original = keys.map(key => actions[key]);
            try {
                for (const key of keys)
                    actions[key] = () => media.push(key);
                emit(Phase.BEGIN, 0, 0, 4, Clutter.EventType.TOUCHPAD_HOLD, 100);
                emit(Phase.BEGIN, 0, 0, 4);
                emit(Phase.UPDATE, 0, -58, 4);
                emit(Phase.UPDATE, 0, 28, 4);
                emit(Phase.END, 0, 0, 4);
                emit(Phase.END, 0, 0, 4, Clutter.EventType.TOUCHPAD_HOLD, 340);
                emit(Phase.BEGIN, 0, 0, 4, Clutter.EventType.TOUCHPAD_HOLD, 500);
                emit(Phase.END, 0, 0, 4, Clutter.EventType.TOUCHPAD_HOLD, 750);
            } finally {
                keys.forEach((key, index) => { actions[key] = original[index]; });
            }
            metrics.media = media;
            this.metrics.tufGestureDrag = metrics;
        } finally {
            watcher.cancel();
            input.prepareOverview();
            Main.overview.hide();
            for (const [key, value] of Object.entries(previous))
                settings.set_value(key, value);
        }
    }

    async profileOsd() {
        const ann = Main.extensionManager.lookup(TUF_UUID)?.stateObj?._announcer;
        if (!ann)
            throw new Error('tuf-control-quick is not running or has no profile announcer');
        Main.osdWindowManager.hideAll();
        await sleep(400);
        const r = {shownAtStart: ann.shown, atStart: this.osdState()};
        // Three quick presses (asusd ids: 0 Balanced, 1 Performance, 2 Quiet).
        for (const id of [1, 2, 1]) {
            await this.setAsusdProfile(id);
            await sleep(60);
        }
        r.duringBurst = {shown: ann.shown - r.shownAtStart, osd: this.osdState()};
        await sleep(500);
        r.afterBurst = {shown: ann.shown - r.shownAtStart, osd: this.osdState()};
        const e = await this.shot('osd-profile-performance');
        e.box = r.afterBurst.osd?.box ?? null;
        Main.osdWindowManager.hideAll();
        await sleep(400);
        await this.setAsusdProfile(2);
        await sleep(600);
        r.single = {shown: ann.shown - r.shownAtStart, osd: this.osdState()};
        const q = await this.shot('osd-profile-quiet');
        q.box = r.single.osd?.box ?? null;
        Main.osdWindowManager.hideAll();
        await this.setAsusdProfile(0);
        await sleep(600);
        Main.osdWindowManager.hideAll();
        this.metrics.profileOsd = r;
        await sleep(300);
    }

    // ---- Focus Keys: raise-or-launch on real key presses ---------------------
    async focusKeys() {
        const ext = () => Main.extensionManager.lookup(FOCUS_UUID)?.stateObj;
        if (!ext()?._core)
            throw new Error('focus-keys is not running');
        const r = {};
        const wins = () => global.get_window_actors().map(a => a.meta_window)
            .filter(w => w.get_window_type() === Meta.WindowType.NORMAL);
        const find = re => wins().find(w => re.test(w.get_wm_class() ?? ''));
        const state = () => ({focus: global.display.focus_window?.get_wm_class() ?? null,
            workspace: global.workspace_manager.get_active_workspace_index()});
        const ctrl = [Clutter.KEY_Control_L];

        ext()._settings.set_strv('bindings', ['<Control>F9=org.gnome.Calculator.desktop',
            '<Control>F10=org.gnome.Characters.desktop', '<Control>F11=not-installed.desktop',
            'Bogus=org.gnome.Calculator.desktop']);
        await sleep(300);
        r.grabbed = ext()._core.grabbed.map(g => g.accel);

        // Calculator on the second workspace, Terminal focused on the first.
        const wm = global.workspace_manager;
        if (wm.n_workspaces < 2)
            wm.append_new_workspace(false, global.get_current_time());
        const calc = find(/calculator/i), term = find(/terminal/i);
        if (!calc || !term)
            throw new Error(`need Calculator and Terminal windows, have ${wins().map(w => w.get_wm_class())}`);
        calc.change_workspace_by_index(1, false);
        Main.activateWindow(term);
        await sleep(900);
        r.before = state();
        await this.combo(ctrl, Clutter.KEY_F9);
        await sleep(1200);
        r.raised = state();
        await this.shot('focus-keys-raised');
        await this.combo(ctrl, Clutter.KEY_F9);
        await sleep(600);
        r.again = state();

        // Not running: the shell starts it and it gets the focus (no "is ready").
        await this.combo(ctrl, Clutter.KEY_F10);
        for (let i = 0; i < 30 && !find(/characters/i); i++)
            await sleep(500);
        await sleep(1500);
        r.launched = {...state(), window: !!find(/characters/i),
            notifications: Main.messageTray.getSources?.()
                .flatMap(s => (s.notifications ?? []).map(n => `${s.title}: ${n.title}`)) ?? null};
        // Pressed again while it is focused: stays (one window).
        await this.combo(ctrl, Clutter.KEY_F10);
        await sleep(600);
        r.launchedAgain = state();

        Main.osdWindowManager.hideAll();
        await this.combo(ctrl, Clutter.KEY_F11);
        await sleep(500);
        r.missing = this.osdState();
        Main.osdWindowManager.hideAll();

        // Lifecycle in the real shell: disable releases every grab, enable takes them back.
        // The extension's own disable()/enable() are called directly: going through
        // extensionManager.disableExtension() would also cycle every extension enabled
        // after it, this harness included.
        const fk = ext();
        const names = [...fk._core._grabs.keys()].map(a => Meta.external_binding_name_for_action(a));
        fk.disable();
        await sleep(400);
        r.disabled = {coreGone: fk._core === null, allowed: names.map(n => Main.wm._allowedKeybindings[n] ?? null)};
        Main.activateWindow(term);
        await sleep(600);
        await this.combo(ctrl, Clutter.KEY_F9);
        await sleep(600);
        r.pressWhileDisabled = state();
        fk.enable();
        await sleep(400);
        r.reenabled = {state: Main.extensionManager.lookup(FOCUS_UUID)?.state,
            grabbed: fk._core?.grabbed.map(g => g.accel) ?? null};
        this.metrics.focusKeys = r;
        r.prefs = await this.prefsWindow(FOCUS_UUID, 'focus-keys-prefs');
    }

    // The extension's preferences window, opened like the Extensions app does.
    async prefsWindow(uuid, shotName) {
        const ext = Main.extensionManager.lookup(uuid);
        const script = GLib.build_filenamev([GLib.path_get_dirname(
            GLib.filename_from_uri(import.meta.url)[0]), 'prefs_smoke.js']);
        const report = `${OUT}/${shotName}.json`;
        // The prefs runtime (like gnome-extensions-app) needs the shell's private Shew library.
        const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.STDERR_MERGE});
        launcher.set_stdout_file_path(`${OUT}/${shotName}.log`);
        launcher.setenv('GI_TYPELIB_PATH', '/usr/lib/gnome-shell/girepository-1.0', true);
        launcher.setenv('LD_LIBRARY_PATH', '/usr/lib/gnome-shell', true);
        const proc = launcher.spawnv(['gjs', '-m', script, ext.path, report]);
        let res = null;
        for (let i = 0; i < 100 && !res; i++) {
            await sleep(250);
            if (GLib.file_test(report, GLib.FileTest.EXISTS))
                res = JSON.parse(new TextDecoder().decode(GLib.file_get_contents(report)[1]));
        }
        const win = global.get_window_actors().map(a => a.meta_window)
            .find(w => w.get_title() === ext.metadata.name);
        if (win) {
            win.move_resize_frame(true, 560, 140, 800, 860);
            win.activate(global.get_current_time());
            await sleep(900);
            const e = await this.shot(shotName);
            e.box = rect(global.get_window_actors().find(a => a.meta_window === win));
        }
        proc.force_exit();
        await sleep(300);
        return {...res ?? {ok: false, error: 'no report'}, window: !!win};
    }

    cpu() {
        const [, raw] = GLib.file_get_contents('/proc/self/stat');
        const f = new TextDecoder().decode(raw).split(') ')[1].split(' ');
        return Number(f[11]) + Number(f[12]); // utime + stime, clock ticks
    }

    notify(app, icon, summary, body) {
        return new Promise(resolve => Gio.DBus.session.call('org.freedesktop.Notifications',
            '/org/freedesktop/Notifications', 'org.freedesktop.Notifications', 'Notify',
            new GLib.Variant('(susssasa{sv}i)', [app, 0, icon, summary, body, [], {}, -1]),
            null, Gio.DBusCallFlags.NONE, 3000, null, () => resolve()));
    }

    measurePanel() {
        const p = Main.panel;
        const clock = p.statusArea.dateMenu._clockDisplay;
        const boxes = {};
        for (const [k, box] of [['left', p._leftBox], ['center', p._centerBox], ['right', p._rightBox]]) {
            boxes[k] = box.get_children().filter(c => c.visible).map(c => {
                const btn = c.child ?? c;
                return {cls: btn.get_style_class_name?.() ?? '', box: rect(btn),
                    radius: btn.get_theme_node?.().get_border_radius(St.Corner.TOPLEFT)};
            });
        }
        return {height: p.height, clockPx: fontPx(clock), clockBox: rect(clock), boxes, labels: labels(p)};
    }

    // Open the configured apps and lay their windows out away from the dock, so
    // intellihide keeps the dock up and the overview has windows to show.
    async openWindows() {
        const sys = Shell.AppSystem.get_default();
        for (const id of APPS) {
            const app = sys.lookup_app(id);
            if (!app) {
                this.log(`no app ${id}`);
                continue;
            }
            try {
                app.open_new_window(-1);
            } catch (e) {
                this.log(`launch ${id}: ${e}`);
            }
            await sleep(1500);
        }
        const normal = () => global.get_window_actors().map(a => a.meta_window)
            .filter(w => w.get_window_type() === Meta.WindowType.NORMAL);
        for (let i = 0; i < 40 && normal().length < APPS.length; i++)
            await sleep(500);
        await sleep(1500);
        const layout = [[430, 250, 980, 640], [760, 130, 960, 560], [1480, 560, 380, 560]];
        const wins = normal();
        this.metrics.windows = wins.map(w => w.get_wm_class());
        wins.forEach((w, i) => {
            const [x, y, width, height] = layout[i % layout.length];
            if (w.get_maximized())
                w.unmaximize(Meta.MaximizeFlags.BOTH);
            w.move_resize_frame(true, x, y, width, height);
        });
        await sleep(800);
        const term = wins.find(w => /terminal/i.test(w.get_wm_class() ?? '')) ?? wins[0];
        term?.activate(global.get_current_time());
        await sleep(800);
    }
}
