// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) Hamza Gouda
// Kept independent of Shell so actor discovery can be tested with a fake tree.
export function hasOverviewWallpaper(root) {
    const pending = root ? [root] : [];
    while (pending.length) {
        const actor = pending.pop();
        if (actor.get_name?.() === 'bms-overview-backgroundgroup')
            return true;
        pending.push(...(actor.get_children?.() ?? []));
    }
    return false;
}
