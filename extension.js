// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// Island Menu: a launcher for apps, search, files, a calculator and the Shelf, opened from the top bar, a shortcut,
// or (Settings) the Super key, so there is no need to go into the overview to open an app. Its menu and Shelf come
// from GNOME Essentials (by the same author); GNOME Essentials is not needed, but its Workspace Profiles are used
// when it runs.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import EssentialMenu from './menu.js';
import EssentialShelf from './shelf.js';
import {MenuSettings} from './settings.js';
import {SuperKey} from './superKey.js';
import {Workspaces} from './workspaces.js';
import {EmptyWorkspaces} from './emptyWorkspaces.js';
import {AltTab} from './altTab.js';

const WORKSPACE_KEYS = ['workspace-numbers', 'workspace-peek', 'drag-to-workspaces', 'peek-delay', 'attention-glow',
    'glow-width', 'attention-pulse'];

/** The workspace settings as they were in Panel Island (which had these features before), brought over once. Its
 * schema keeps the keys, marked as moved, for this. */
function importPanelIslandWorkspaces(settings) {
    if (settings.get_boolean('workspaces-imported'))
        return;
    settings.set_boolean('workspaces-imported', true);
    const dirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()].map(dir =>
        GLib.build_filenamev([dir, 'gnome-shell', 'extensions', 'panel-island@ritesh', 'schemas']));
    for (const dir of dirs) {
        if (!GLib.file_test(GLib.build_filenamev([dir, 'gschemas.compiled']), GLib.FileTest.EXISTS))
            continue;
        try {
            const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
            const schema = source.lookup('org.gnome.shell.extensions.panel-island', false);
            if (!schema)
                continue;
            const theirs = new Gio.Settings({settings_schema: schema});
            for (const key of WORKSPACE_KEYS) {
                const value = schema.has_key(key) ? theirs.get_user_value(key) : null;
                if (value)
                    settings.set_value(key, value);
            }
            return;
        } catch (e) {
            console.warn(`[island-menu] Panel Island's workspace settings were not brought over: ${e}`);
        }
    }
}

/** GNOME Essentials' Shelf, brought over once: Island Menu keeps its own from then on. */
function importEssentialsShelf(settings) {
    if (settings.get_boolean('shelf-imported'))
        return;
    settings.set_boolean('shelf-imported', true);
    const data = GLib.get_user_data_dir();
    const from = Gio.File.new_for_path(GLib.build_filenamev([data, 'gnome-essentials', 'shelf.json']));
    const to = Gio.File.new_for_path(GLib.build_filenamev([data, 'island-menu', 'shelf.json']));
    try {
        if (!from.query_exists(null) || to.query_exists(null))
            return;
        to.get_parent().make_directory_with_parents(null);
    } catch (e) {
        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
            console.warn(`[island-menu] The Shelf from GNOME Essentials was not brought over: ${e}`);
            return;
        }
    }
    try {
        from.copy(to, Gio.FileCopyFlags.NONE, null, null);
    } catch (e) {
        console.warn(`[island-menu] The Shelf from GNOME Essentials was not brought over: ${e}`);
    }
}

export default class IslandMenuExtension extends Extension {
    enable() {
        this._own = this.getSettings();
        importEssentialsShelf(this._own);
        importPanelIslandWorkspaces(this._own);
        this._settings = new MenuSettings(this._own);
        this._shelf = null;
        this._menu = null;
        this._syncShelf();
        try {
            this._menu = new EssentialMenu(this._settings, this._shelf);
            this._menu.enable();
        } catch (e) {
            console.error(`[island-menu] The menu could not start: ${e}\n${e.stack}`);
            try {
                this._menu?.disable();
            } catch {}
            this._menu = null;
        }
        this._superKey = new SuperKey(() => this._menu?.toggle());
        this._own.connectObject('changed::shelf-enabled', () => this._syncShelf(),
            'changed::open-on-empty-workspace', () => this._syncEmptyWorkspaces(),
            'changed::alt-tab-opens-menu', () => this._syncAltTab(),
            'changed::super-key-opens-menu', () => this._syncSuperKey(), this);
        this._syncSuperKey();
        this._syncEmptyWorkspaces();
        this._syncAltTab();
        // Settings → At login: Island Menu: open once GNOME has finished starting (on the desktop: start-in-overview
        // is off with it).
        if (this._own.get_boolean('open-at-login') && Main.layoutManager._startingUp) {
            Main.layoutManager.connectObject('startup-complete', () => {
                Main.layoutManager.disconnectObject(this);
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                    if (this._menu && !Main.overview.visible)
                        this._menu.open();
                    return GLib.SOURCE_REMOVE;
                });
            }, this);
        }
        // Settings → Workspaces, in Panel Island's left capsule (workspaces.js).
        try {
            this._workspaces = new Workspaces(this._own, () => this._menu, this.dir);
        } catch (e) {
            console.error(`[island-menu] The workspace features could not start: ${e}\n${e.stack}`);
            this._workspaces = null;
        }
    }

    /** Settings → Alt+Tab opens the menu (altTab.js): taken while on, GNOME's switcher given it back as it goes off. */
    _syncAltTab() {
        const want = Boolean(this._menu) && this._own.get_boolean('alt-tab-opens-menu');
        if (want && !this._altTab) {
            try {
                this._altTab = new AltTab(() => this._menu);
            } catch (e) {
                console.error(`[island-menu] Alt+Tab could not be taken: ${e}`);
                this._altTab = null;
            }
        } else if (!want && this._altTab) {
            this._altTab.destroy();
            this._altTab = null;
        }
    }

    /** Settings → Open on empty workspaces (emptyWorkspaces.js). */
    _syncEmptyWorkspaces() {
        const want = Boolean(this._menu) && this._own.get_boolean('open-on-empty-workspace');
        if (want && !this._emptyWorkspaces) {
            try {
                this._emptyWorkspaces = new EmptyWorkspaces(() => this._menu);
            } catch (e) {
                console.error(`[island-menu] Opening on empty workspaces could not start: ${e}`);
                this._emptyWorkspaces = null;
            }
        } else if (!want && this._emptyWorkspaces) {
            this._emptyWorkspaces.destroy();
            this._emptyWorkspaces = null;
        }
    }

    _syncSuperKey() {
        this._superKey.enabled = Boolean(this._menu) && this._own.get_boolean('super-key-opens-menu');
    }

    /** Settings → Shelf: its storage on or off, the menu told. */
    _syncShelf() {
        const want = this._own.get_boolean('shelf-enabled');
        if (want && !this._shelf) {
            try {
                this._shelf = new EssentialShelf(this._settings);
                this._shelf.enable();
            } catch (e) {
                console.error(`[island-menu] The Shelf could not start: ${e}`);
                try {
                    this._shelf?.disable();
                } catch {}
                this._shelf = null;
            }
            this._menu?.setShelf?.(this._shelf);
        } else if (!want && this._shelf) {
            this._menu?.setShelf?.(null);
            try {
                this._shelf.disable();
            } catch (e) {
                console.error(`[island-menu] The Shelf did not stop cleanly: ${e}`);
            }
            this._shelf = null;
        }
    }

    disable() {
        // GNOME's switcher given Alt+Tab back first, whatever else.
        try {
            this._altTab?.destroy();
        } catch (e) {
            console.error(`[island-menu] Alt+Tab not given back cleanly: ${e}`);
        }
        this._altTab = null;
        Main.layoutManager.disconnectObject(this);
        this._emptyWorkspaces?.destroy();
        this._emptyWorkspaces = null;
        try {
            this._workspaces?.destroy();
        } catch (e) {
            console.error(`[island-menu] The workspace features did not stop cleanly: ${e}`);
        }
        this._workspaces = null;
        this._own?.disconnectObject(this);
        this._superKey?.destroy();
        this._superKey = null;
        try {
            this._menu?.disable();
        } catch (e) {
            console.error(`[island-menu] The menu did not stop cleanly: ${e}`);
        }
        this._menu = null;
        try {
            this._shelf?.disable();
        } catch (e) {
            console.error(`[island-menu] The Shelf did not stop cleanly: ${e}`);
        }
        this._shelf = null;
        this._settings?.destroy();
        this._settings = null;
        this._own = null;
    }
}
