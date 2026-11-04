// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) Hamza Gouda
// Shell-owned grab status is shared with the separate preferences process.
const SHORTCUT = 'show-desktop-shortcut';
const STATUS = 'show-desktop-grab-status';

export function desktopBindingSubtitle(shortcuts, report) {
    const description = 'Fade visible windows; press again to restore.';
    if (!shortcuts.length)
        return `${description} Off until a shortcut is set.`;
    const [state, ...checked] = report;
    if (JSON.stringify(shortcuts) !== JSON.stringify(checked))
        return `${description} Shortcut saved; enable Focus Keys to check availability.`;
    if (state === 'failed')
        return 'Shortcut unavailable: invalid or already used by another binding. Choose another shortcut.';
    if (state === 'active')
        return `${description} Shortcut is active.`;
    if (state === 'disabled')
        return 'Focus Keys is disabled; this shortcut is inactive.';
    return `${description} Checking shortcut availability…`;
}

export class DesktopBinding {
    constructor({settings, add, remove, none, log}) {
        this.settings = settings;
        this.add = add;
        this.remove = remove;
        this.none = none;
        this.log = log;
        this._signal = 0;
        this._registered = false;
        this._warned = new Set();
    }

    enable() {
        if (this._signal)
            return;
        this._signal = this.settings.connect(`changed::${SHORTCUT}`, () => this._reload());
        this._reload();
    }

    _reload() {
        if (this._registered)
            this.remove();
        this._registered = false;
        const shortcuts = this.settings.get_strv(SHORTCUT);
        this.settings.set_strv(STATUS, [shortcuts.length ? 'checking' : 'unbound', ...shortcuts]);
        if (!shortcuts.length)
            return;
        // WindowManager also keeps named-binding bookkeeping on failed grabs.
        this._registered = true;
        const result = this.add();
        const active = result !== this.none;
        this.settings.set_strv(STATUS, [active ? 'active' : 'failed', ...shortcuts]);
        const key = JSON.stringify(shortcuts);
        if (!active && !this._warned.has(key)) {
            if (this._warned.size >= 64)
                this._warned.delete(this._warned.values().next().value);
            this._warned.add(key);
            this.log(`Show desktop shortcut ${shortcuts.join(', ')} is invalid or already taken; not bound`);
        }
    }

    destroy() {
        if (this._signal)
            this.settings.disconnect(this._signal);
        this._signal = 0;
        if (this._registered)
            this.remove();
        this._registered = false;
        this.settings.set_strv(STATUS, ['disabled', ...this.settings.get_strv(SHORTCUT)]);
    }
}
