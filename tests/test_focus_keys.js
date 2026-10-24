// SPDX-License-Identifier: GPL-3.0-or-later
// Pure-logic and lifecycle tests for the Focus Keys extension.
// Run: gjs -m tests/test_focus_keys.js

import System from 'system';
import * as B from '../extensions/focus-keys@hamza-gouda/bindings.js';
import {FocusKeys} from '../extensions/focus-keys@hamza-gouda/focus.js';

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

// --- entries
eq(B.parseEntry('<Control>F9=spotify.desktop'), {accel: '<Control>F9', appId: 'spotify.desktop'}, 'parse');
eq(B.parseEntry(' XF86Launch1 = io.github.hamzagouda.TufControl.desktop '),
    {accel: 'XF86Launch1', appId: 'io.github.hamzagouda.TufControl.desktop'}, 'parse trims');
eq(B.parseEntry('<Shift><Super>XF86TouchpadOff=org.gnome.Calculator'),
    {accel: '<Shift><Super>XF86TouchpadOff', appId: 'org.gnome.Calculator.desktop'}, '.desktop added');
eq(['', '=x.desktop', 'F9=', 'F9', 'F9=a b.desktop', null, 7].map(B.parseEntry),
    [null, null, null, null, null, null, null], 'malformed rejected');
eq(B.formatEntry('<Control>F9', 'spotify.desktop'), '<Control>F9=spotify.desktop', 'format');

// --- accelerator comparison
ok(B.normAccel('XF86Launch1') === B.normAccel('Launch1'), 'XF86 prefix ignored');
ok(B.normAccel('<Super><Shift>F23') === B.normAccel('<shift><super>f23'), 'modifier order and case ignored');
ok(B.normAccel('<Ctrl>F9') === B.normAccel('<Control>F9') && B.normAccel('<Primary>F9') === B.normAccel('<Control>F9'),
    'modifier aliases');
ok(B.normAccel('<Control>F9') !== B.normAccel('F9'), 'modifiers matter');

const p = B.parseBindings(['<Control>F9=spotify.desktop', 'junk', '<Ctrl>F9=other.desktop', 'XF86Launch1=a.desktop']);
eq(p.entries.map(e => e.appId), ['spotify.desktop', 'a.desktop'], 'first entry for a key wins');
eq([p.invalid, p.duplicates], [['junk'], ['<Ctrl>F9=other.desktop']], 'invalid and duplicate reported');

eq(B.setEntry(['A=a.desktop', '<Control>F9=x.desktop'], '<Ctrl>F9', 'spotify.desktop'),
    ['A=a.desktop', '<Ctrl>F9=spotify.desktop'], 'setEntry replaces in place');
eq(B.setEntry(['A=a.desktop'], 'F10', 'b.desktop'), ['A=a.desktop', 'F10=b.desktop'], 'setEntry appends');
eq(B.setEntry(['F9=a.desktop', 'F10=b.desktop'], 'F11', 'a.desktop', 'F9'), ['F11=a.desktop', 'F10=b.desktop'],
    'setEntry re-keys an entry');
eq(B.removeEntry(['F9=a.desktop', 'junk', 'XF86Launch1=b.desktop'], 'Launch1'), ['F9=a.desktop', 'junk'],
    'removeEntry');

// --- window choice
const win = (id, t, seq) => ({id, t, seq});
const opts = {userTime: w => w.t, seq: w => w.seq};
const w1 = win('w1', 100, 1), w2 = win('w2', 300, 2), w3 = win('w3', 200, 3);
eq(B.chooseWindow([], null, opts), {action: 'launch'}, 'no window: launch');
eq(B.chooseWindow([w1, w2, w3], null, opts).window.id, 'w2', 'most recently used first');
eq(B.chooseWindow([w1, w2, w3], {id: 'other'}, opts).window.id, 'w2', 'another app focused: MRU');
eq(B.chooseWindow([w1], w1, opts), {action: 'focused'}, 'single focused window stays');
eq(B.chooseWindow([w3, w1, w2], w1, opts).window.id, 'w2', 'cycle: next by stable order');
eq(B.chooseWindow([w1, w2, w3], w3, opts).window.id, 'w1', 'cycle wraps');
eq(B.chooseWindow([w1, w2], w1, {...opts, cycle: false}), {action: 'focused'}, 'cycle off');
eq(B.chooseWindow([win('a', 5, 1), win('b', 5, 2)], null, opts).window.id, 'b', 'user time tie: newer window');

// --- lifecycle with fakes
class Signals {
    constructor() {
        this._h = new Map();
        this._n = 1;
    }

    connect(name, cb) {
        this._h.set(this._n, [name, cb]);
        return this._n++;
    }

    disconnect(id) {
        if (!this._h.delete(id))
            throw new Error(`bad disconnect ${id}`);
    }

    emit(name, ...args) {
        for (const [n, cb] of [...this._h.values()]) {
            if (n === name)
                cb(this, ...args);
        }
    }

    get size() {
        return this._h.size;
    }
}

class FakeSettings extends Signals {
    constructor(bindings) {
        super();
        this.v = {bindings, 'cycle-windows': true};
    }

    get_strv(k) {
        return [...this.v[k]];
    }

    get_boolean(k) {
        return this.v[k];
    }

    set(k, v) {
        this.v[k] = v;
        this.emit(`changed::${k}`);
    }
}

class FakeDisplay extends Signals {
    constructor() {
        super();
        this.grabs = new Map();
        this.next = 100;
        this.focus_window = null;
        this.taken = new Set(['<Super>x']); // owned by somebody else
    }

    grab_accelerator(accel) {
        if (this.taken.has(accel) || accel.includes('Bogus') || [...this.grabs.values()].includes(accel))
            return 0;
        const a = this.next++;
        this.grabs.set(a, accel);
        return a;
    }

    ungrab_accelerator(a) {
        return this.grabs.delete(a);
    }

    press(accel, time = 42) {
        const action = [...this.grabs].find(([, v]) => v === accel)?.[0];
        if (action !== undefined)
            this.emit('accelerator-activated', action, null, time);
    }
}

const mkWin = (id, t, seq, extra = {}) => ({
    id, t, seq, minimized: false, type: 'normal', ...extra,
    get_user_time() {
        return this.t;
    },
    get_stable_sequence() {
        return this.seq;
    },
    unminimize() {
        this.minimized = false;
    },
});

class FakeApp {
    constructor(id, windows = [], state = 'stopped') {
        this.id = id;
        this.windows = windows;
        this.state = windows.length ? 'running' : state;
    }

    get_windows() {
        return this.windows;
    }

    get_state() {
        return this.state;
    }
}

const settings = new FakeSettings(['<Control>F9=spotify.desktop', 'XF86Launch1=tuf.desktop',
    '<Super>x=taken.desktop', 'Bogus=x.desktop', 'nonsense', '<Shift><Super>XF86TouchpadOff=missing.desktop']);
const display = new FakeDisplay();
const allowed = new Map();
const calls = [];
const logs = [];
const spotWins = [mkWin('s1', 10, 1), mkWin('s2', 50, 2, {minimized: true}), mkWin('tip', 99, 3, {type: 'tooltip'})];
const apps = {
    'spotify.desktop': new FakeApp('spotify', spotWins),
    'tuf.desktop': new FakeApp('tuf'),
};
const core = new FocusKeys({
    settings, display, grabFlags: 0, modes: 3, noModes: 0, startingState: 'starting',
    bindingName: a => `external-grab-${a}`,
    allowKeybinding: (n, m) => allowed.set(n, m),
    lookupApp: id => apps[id] ?? null,
    switchable: w => w.type === 'normal',
    activateWindow: (w, t) => calls.push(['activate', w.id, t]),
    launch: (app, t) => calls.push(['launch', app.id, t]),
    missing: id => calls.push(['missing', id]),
    log: m => logs.push(m),
});
core.enable();
core.enable(); // idempotent
eq(core.grabbed.map(e => e.accel), ['<Control>F9', 'XF86Launch1', '<Shift><Super>XF86TouchpadOff'],
    'valid, free keys grabbed');
eq([...allowed.values()], [3, 3, 3], 'grabbed keys allowed in normal + overview');
ok(logs.some(l => l.includes('<Super>x')) && logs.some(l => l.includes('nonsense')) &&
    logs.some(l => l.includes('Bogus')), 'taken, bogus and malformed entries logged');
eq([settings.size, display.size], [1, 1], 'one handler each');

display.press('<Control>F9', 777);
eq(calls.pop(), ['activate', 's2', 777], 'press raises MRU window with the key timestamp');
ok(!spotWins[1].minimized, 'minimized window unminimized first');
display.focus_window = spotWins[1];
display.press('<Control>F9');
eq(calls.pop(), ['activate', 's1', 42], 'second press cycles to the next window');
settings.v['cycle-windows'] = false;
display.press('<Control>F9');
eq(calls.length, 0, 'cycle off: focused app stays');
settings.v['cycle-windows'] = true;

display.press('XF86Launch1', 5);
eq(calls.pop(), ['launch', 'tuf', 5], 'no window: launch');
apps['tuf.desktop'].state = 'starting';
display.press('XF86Launch1');
eq(calls.length, 0, 'no second launch while starting');
display.press('<Shift><Super>XF86TouchpadOff');
eq(calls.pop(), ['missing', 'missing.desktop'], 'missing app reported');
eq(core.activate('spotify.desktop'), 'activate', 'activate() callable directly (QA hook)');
calls.length = 0;

const before = logs.length;
settings.set('bindings', ['F10=spotify.desktop', 'nonsense']);
eq(core.grabbed.map(e => e.accel), ['F10'], 'reload on change');
eq(display.grabs.size, 1, 'old grabs released on reload');
ok(logs.length === before, 'already-reported entries are not logged again');
eq([...allowed].filter(([, m]) => m === 3).length, 1, 'released keys no longer allowed');

core.disable();
eq([display.grabs.size, display.size, settings.size], [0, 0, 0], 'disable: zero grabs, zero handlers');
ok([...allowed.values()].every(m => m === 0), 'disable: every binding name set to no modes');
display.emit('accelerator-activated', 100, null, 1);
settings.set('bindings', ['F11=spotify.desktop']);
eq([calls.length, display.grabs.size], [0, 0], 'nothing reacts after disable');
core.enable();
eq(core.grabbed.map(e => e.accel), ['F11'], 're-enable grabs again');
core.destroy();
eq([display.grabs.size, display.size, settings.size], [0, 0, 0], 'destroy cleans up');

print(`${passed} passed, ${failed} failed`);
System.exit(failed ? 1 : 0);
