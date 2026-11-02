// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) Hamza Gouda

// A desktop toggle owns only the windows it hid. Pre-minimized windows stay
// minimized, and a repeated press safely interrupts an unfinished fade.
export class ShowDesktop {
    constructor(deps) {
        this._d = deps;
        this._windows = [];
        this._focus = null;
    }

    toggle() {
        if (this._windows.length) {
            this.restore();
            return 'restored';
        }
        this._focus = this._d.focus();
        for (const [i, window] of this._d.windows().entries()) {
            if (!this._d.alive(window) || !this._d.eligible(window) || window.minimized)
                continue;
            const record = {window, active: true};
            this._windows.push(record);
            this._d.fade(window, Math.min(i * 12, 96), () => {
                if (!record.active || !this._d.alive(window))
                    return;
                this._d.minimize(window);
                this._d.reset(window);
            });
        }
        return this._windows.length ? 'hidden' : 'empty';
    }

    restore() {
        const windows = this._windows;
        this._windows = [];
        for (const record of windows.reverse()) {
            record.active = false;
            const w = record.window;
            if (!this._d.alive(w))
                continue;
            this._d.cancel(w);
            this._d.reset(w);
            if (w.minimized)
                this._d.unminimize(w);
        }
        if (this._focus && this._d.alive(this._focus) && !this._focus.minimized)
            this._d.activate(this._focus);
        this._focus = null;
    }

    destroy() {
        this.restore();
        this._d = null;
    }
}
