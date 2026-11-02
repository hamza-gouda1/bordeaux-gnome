// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) Hamza Gouda
import System from 'system';
import {ShowDesktop} from '../extensions/focus-keys@hamza-gouda/desktop.js';
let passed = 0;
function ok(value, message) {
    if (!value)
        throw new Error(message);
    passed++;
}
const a = {minimized: false, alive: true}, b = {minimized: false, alive: true};
const old = {minimized: true, alive: true}, dialog = {minimized: false, alive: true, skip: true};
const pending = new Map();
let focus = null;
const toggle = new ShowDesktop({
    focus: () => a, windows: () => [a, b, old, dialog],
    eligible: w => !w.skip, alive: w => w.alive,
    fade: (w, delay, done) => pending.set(w, {delay, done}),
    minimize: w => { w.minimized = true; },
    unminimize: w => { w.minimized = false; },
    reset: w => { w.opacity = 255; },
    cancel: w => pending.delete(w),
    activate: w => { focus = w; },
});
ok(toggle.toggle() === 'hidden' && pending.size === 2, 'only visible eligible windows fade');
ok(pending.get(a).delay === 0 && pending.get(b).delay === 12, 'small stagger');
const stale = pending.get(a).done;
ok(toggle.toggle() === 'restored' && pending.size === 0, 'repeat cancels an unfinished fade');
stale();
ok(!a.minimized && !b.minimized && old.minimized, 'cancelled completion cannot minimize later');
toggle.toggle();
for (const job of pending.values())
    job.done();
ok(a.minimized && b.minimized && old.minimized && !dialog.minimized, 'fade completion minimizes');
b.alive = false;
toggle.toggle();
ok(!a.minimized && old.minimized && focus === a, 'restore survives closed window and preserves old minimization');
pending.clear();
toggle.toggle();
toggle.destroy();
ok(pending.size === 0 && !a.minimized, 'disable cancels live windows and restores them');
print(`${passed} passed, 0 failed`);
System.exit(0);
