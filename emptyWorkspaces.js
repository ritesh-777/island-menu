// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// Settings → Open on empty workspaces: the menu opens by itself on a workspace with no windows (its last one closed,
// or gone to an empty one), so an app or a file is a few keys away; and goes again as a window opens there or another
// workspace with windows is gone to, if it opened itself. As Foresight Reborn (GPL-3.0-or-later,
// https://github.com/gabrielpalassi/ForesightReborn) does with GNOME's overview, whose rules for what counts as a
// window, and its list of apps' splash and updater windows not to count, are taken from it.

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

/** Foresight Reborn and Foresight open the overview on empty workspaces themselves: while one runs, this does not. */
const OVERVIEW_OPENERS = ['foresight-reborn@gabrielpalassi.github.io', 'foresight@pesader.dev'];
const overviewOpenerRuns = () => OVERVIEW_OPENERS.some(uuid =>
    Main.extensionManager.lookup(uuid)?.state === ExtensionState.ACTIVE);
import * as WindowManager from 'resource:///org/gnome/shell/ui/windowManager.js';

const VALID_WINDOW_TYPES = [Meta.WindowType.NORMAL, Meta.WindowType.DIALOG, Meta.WindowType.MODAL_DIALOG];

// From Foresight Reborn: apps' splash and updater windows, which are not yet the app's window.
const TEMPORARY_WINDOW_PATTERNS = [
    // DBeaver splash screens
    {
        title: 'Progress Information',
        wmClass: 'DBeaver',
        appIds: ['io.dbeaver.DBeaver.Community'],
        allowMissingAppId: true,
    },
    {
        title: 'DBeaver',
        wmClass: 'java',
        appIds: ['io.dbeaver.DBeaver.Community'],
        allowMissingAppId: true,
    },
    // Steam splash and login screens
    {
        title: 'Steam',
        wmClass: null,
        appIds: ['com.valvesoftware.Steam'],
        allowMissingAppId: true,
    },
    {
        title: 'Sign in to Steam',
        wmClass: 'steam',
        appIds: ['com.valvesoftware.Steam'],
        allowMissingAppId: true,
    },
    {
        title: 'Launching...',
        wmClass: 'steam',
        appIds: ['com.valvesoftware.Steam'],
        allowMissingAppId: true,
    },
    // Discord updater
    {
        title: 'Discord Updater',
        wmClass: 'discord',
        appIds: ['com.discordapp.Discord'],
        allowMissingAppId: true,
    },
    // LibreOffice splash screen
    {
        titleRegex: /^LibreOffice \d+\.\d+$/,
        wmClass: 'soffice',
        appIds: ['org.libreoffice.LibreOffice'],
        allowMissingAppId: true,
    },
];

/** How long switching has to stop before the menu opens (going through several empty workspaces: once, at the end),
 * and how long it is held open through each switch, in ms. */
const SETTLE_MS = 220;
const HOLD_MS = 900;

/** Each opening, keeping and closing in the log, only while debugging it. */
const DEBUG = false;
const trace = message => DEBUG && console.log(`[island-menu] empty workspace: ${message}`);

const isTemporary = window => {
    const title = window.get_title();
    const wmClass = window.get_wm_class();
    const appIds = [window.get_sandboxed_app_id(), window.get_gtk_application_id()]
        .filter(id => typeof id === 'string' && id.length > 0);
    return TEMPORARY_WINDOW_PATTERNS.some(p =>
        (p.titleRegex ? p.titleRegex.test(title) : title === p.title) && wmClass === p.wmClass &&
        (appIds.length ? appIds.some(id => p.appIds.includes(id)) : p.allowMissingAppId));
};

export class EmptyWorkspaces {
    /** `menu()`: Island Menu's menu now (open(), close(), _isOpen), or null. */
    constructor(menu) {
        this._menu = menu;
        this._manager = global.workspace_manager;
        this._mutter = new Gio.Settings({schema_id: 'org.gnome.mutter'});
        this._openedByUs = 0;
        this._removal = 0;
        this._switch = 0;
        this._timeouts = new Set();
        this._laters = new Set();
        this._workspace = null;
        this._watch(this._manager.get_active_workspace());
        this._manager.connectObject('workspace-switched', () => this._switched(), this);
    }

    _watch(workspace) {
        this._workspace?.disconnectObject(this);
        this._workspace = workspace;
        workspace.connectObject('window-added', (_ws, window) => this._added(window),
            'window-removed', (_ws, window) => this._removed(window), this);
    }

    /** Whether `window` counts as a window on the workspace (not a menu, a tooltip, a splash screen). */
    _counts(window, added = false) {
        if (!VALID_WINDOW_TYPES.includes(window.get_window_type()))
            return false;
        if (!added && window.is_hidden())
            return false;
        if (window.is_skip_taskbar())
            return false;
        if (this._mutter.get_boolean('workspaces-only-on-primary') && !window.is_on_primary_monitor())
            return false;
        return !isTemporary(window);
    }

    _empty() {
        return !this._workspace.list_windows().some(window => this._counts(window));
    }

    _open() {
        const menu = this._menu();
        if (!menu || menu._isOpen || Main.overview.visible || Main.modalCount > 0 || overviewOpenerRuns())
            return;
        menu.open();
        // Which opening is ours: closed and opened again by hand, it is not ours to close.
        this._openedByUs = menu._isOpen ? menu._openCount : 0;
        menu.holdOpen?.(Boolean(this._openedByUs));
        trace(`opened (${this._openedByUs ? 'held' : 'not open'})`);
    }

    /** Closed again, only if it opened itself (and is still open). */
    _close() {
        const menu = this._menu();
        if (this._openedByUs && menu?._isOpen && menu._openCount === this._openedByUs) {
            trace('closed (a window is there)');
            menu.holdOpen?.(false);
            menu.close();
        }
        this._openedByUs = 0;
    }

    _added(window) {
        if (!this._counts(window, true))
            return;
        // A window come (Chrome's own after its profile picker went): any opening still waiting for the last one's
        // closing to be drawn is called off (its workspace is not empty after all), and ours closed.
        this._removal++;
        this._switch++;
        this._close();
    }

    _removed(window) {
        if (!this._counts(window, true))
            return;
        // Once its closing has been drawn.
        const generation = ++this._removal;
        const ms = window.get_window_type() === Meta.WindowType.NORMAL
            ? WindowManager.DESTROY_WINDOW_ANIMATION_TIME : WindowManager.DIALOG_DESTROY_WINDOW_ANIMATION_TIME;
        const id = setTimeout(() => {
            this._timeouts.delete(id);
            if (generation === this._removal && this._empty())
                this._open();
        }, ms);
        this._timeouts.add(id);
    }

    _switched() {
        this._removal++;
        // Ours and open: kept open through the switch (its focus moves), to stay if this one is empty too.
        const menu = this._menu();
        if (this._ours(menu))
            menu.holdThroughSwitch?.(HOLD_MS);
        this._watch(this._manager.get_active_workspace());
        const generation = ++this._switch;
        this._afterSwitch(generation);
    }

    /** Once the switch has been drawn (not during it: that would stop a run of switches by keys or scrolling). */
    _afterSwitch(generation) {
        const laters = global.compositor.get_laters();
        const id = laters.add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._laters.delete(id);
            if (generation !== this._switch)
                return false;
            if (Main.wm._switchInProgress) {
                this._afterSwitch(generation);
                return false;
            }
            if (!this._empty()) {
                this._close();
                return false;
            }
            // Empty: kept if it is open already (its keys back to its search); else opened once switching stops.
            const menu = this._menu();
            if (this._ours(menu)) {
                trace('kept open through the switch');
                menu.refocus?.();
                return false;
            }
            trace(`opening once switching stops (menu ${menu?._isOpen ? 'open, not ours' : 'closed'})`);
            const timeout = setTimeout(() => {
                this._timeouts.delete(timeout);
                if (generation === this._switch && this._empty())
                    this._open();
            }, SETTLE_MS);
            this._timeouts.add(timeout);
            return false;
        });
        this._laters.add(id);
    }

    /** Whether the menu is open by our own opening of it. */
    _ours(menu) {
        return Boolean(this._openedByUs && menu?._isOpen && menu._openCount === this._openedByUs);
    }

    destroy() {
        this._manager.disconnectObject(this);
        this._workspace?.disconnectObject(this);
        this._timeouts.forEach(id => clearTimeout(id));
        this._timeouts.clear();
        const laters = global.compositor.get_laters();
        this._laters.forEach(id => laters.remove(id));
        this._laters.clear();
        this._openedByUs = 0;
    }
}
