// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// Settings → Alt+Tab opens the menu: Alt+Tab (and Shift+Alt+Tab) shows the menu's open windows instead of GNOME's
// switcher; held, Tab steps through them, let go, the one chosen is gone to (menu.js, `altTab`).
//
// Only the handler of GNOME's own shortcut is changed, inside the running shell, as GNOME itself sets it
// (windowManager.js: `setCustomKeybindingHandler`): no keyboard setting is written. Each of GNOME's two switchers
// with Alt+Tab or Super+Tab on it (Settings → Keyboard: "Switch windows", "Switch applications") is taken, with its
// backward one. Turned off, or Island Menu off, each is given back to
// GNOME's own switcher exactly as GNOME set it. Nothing is left changed should the shell stop. Super+Tab (GNOME's
// "Switch applications") the same: both open the menu.

import Gio from 'gi://Gio';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const KEYS = 'org.gnome.desktop.wm.keybindings';

/** Whether an accelerator list holds Alt+Tab or Super+Tab (as GNOME writes them: <Alt>Tab, <Super>Tab, or spelt
 * otherwise). */
const hasSwitchTab = accels => accels.some(accel =>
    /^(<(Alt|Mod1|Super|Mod4)>)+Tab$/i.test(accel.replace(/\s/g, '')));

export class AltTab {
    /** `menu()`: Island Menu's menu now (its `altTab(backward)`), or null. */
    constructor(menu) {
        this._menu = menu;
        this._taken = [];
        this._keys = new Gio.Settings({schema_id: KEYS});
        // The shortcut moved in Settings → Keyboard: taken anew from whichever has it now.
        this._keys.connectObject('changed::switch-windows', () => this._take(),
            'changed::switch-applications', () => this._take(), this);
        this._take();
    }

    /** GNOME's switcher actions with Alt+Tab on them now (and their backward ones). */
    _actions() {
        const forward = ['switch-windows', 'switch-applications'].filter(name => hasSwitchTab(this._keys.get_strv(name)));
        return forward.flatMap(name => [name, `${name}-backward`]);
    }

    _take() {
        this._giveBack();
        for (const name of this._actions()) {
            const backward = name.endsWith('-backward');
            Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL, () => {
                const menu = this._menu();
                if (menu?.altTab)
                    menu.altTab(backward);
            });
            this._taken.push(name);
        }
    }

    /** Each back to GNOME's own switcher, as GNOME sets it (windowManager.js). */
    _giveBack() {
        for (const name of this._taken) {
            try {
                Main.wm.setCustomKeybindingHandler(name, Shell.ActionMode.NORMAL, Main.wm._startSwitcher.bind(Main.wm));
            } catch (e) {
                console.error(`[island-menu] ${name} could not be given back to GNOME's switcher: ${e}`);
            }
        }
        this._taken = [];
    }

    destroy() {
        this._keys.disconnectObject(this);
        this._giveBack();
    }
}
