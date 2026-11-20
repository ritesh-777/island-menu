// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// Settings → Super key opens the menu: a tap of Super opens Island Menu instead of GNOME's overview. GNOME's own
// answer to the key (the overview's) is held while this is on, and let go as it goes off; the overview stays on the
// Activities button, the hot corner and Super+A.

import GObject from 'gi://GObject';

export class SuperKey {
    /** `open()`: what a tap of Super does instead. */
    constructor(open) {
        this._open = open;
        this._id = 0;
    }

    set enabled(on) {
        if (on === Boolean(this._id))
            return;
        if (on) {
            // Every answer the key has now (GNOME's overview) held, then ours added.
            GObject.signal_handlers_block_matched(global.display, {signalId: 'overlay-key'});
            this._id = global.display.connect('overlay-key', () => this._open());
        } else {
            global.display.disconnect(this._id);
            this._id = 0;
            GObject.signal_handlers_unblock_matched(global.display, {signalId: 'overlay-key'});
        }
    }

    destroy() {
        this.enabled = false;
    }
}
