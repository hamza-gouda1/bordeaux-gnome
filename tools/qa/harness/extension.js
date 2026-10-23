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
import * as AltTab from 'resource:///org/gnome/shell/ui/altTab.js';
import * as WorkspaceSwitcherPopup from 'resource:///org/gnome/shell/ui/workspaceSwitcherPopup.js';

Gio._promisify(Shell.Screenshot.prototype, 'screenshot');

const OUT = GLib.getenv('BXQA_OUT');
const WANT = new Set((GLib.getenv('BXQA_SCENES') || 'all').split(','));
const APPS = (GLib.getenv('BXQA_APPS') || '').split(',').filter(Boolean);
const DOCK_UUID = 'ubuntu-dock@ubuntu.com';
const AURA_UUID = 'bordeaux-aura@hamza-gouda';

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
