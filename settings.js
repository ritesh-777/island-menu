// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// The settings the menu reads, as one object: its own (Island Menu's schema), and GNOME Essentials' Workspace
// Profiles keys (`profiles-*`) when GNOME Essentials is installed. Without it, those read as off and empty and
// writing them does nothing, so the Shelf's layout features simply stay out of the way.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ESSENTIALS_UUID = 'gnome-essentials@ritesh';
const ESSENTIALS_SCHEMA = 'org.gnome.shell.extensions.gnome-essentials';

/** GNOME Essentials' settings, from where it is installed, or null. */
function essentialsSettings() {
    const dirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]
        .map(dir => GLib.build_filenamev([dir, 'gnome-shell', 'extensions', ESSENTIALS_UUID, 'schemas']));
    for (const dir of dirs) {
        if (!GLib.file_test(GLib.build_filenamev([dir, 'gschemas.compiled']), GLib.FileTest.EXISTS))
            continue;
        try {
            const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
            const schema = source.lookup(ESSENTIALS_SCHEMA, true);
            if (schema)
                return new Gio.Settings({settings_schema: schema});
        } catch (e) {
            console.warn(`[island-menu] GNOME Essentials' settings could not be read: ${e}`);
        }
    }
    return null;
}

const DEFAULTS = {get_boolean: false, get_int: 0, get_string: '', get_strv: []};

export class MenuSettings {
    /** `own`: Island Menu's Gio.Settings. */
    constructor(own) {
        this.own = own;
        this.essentials = essentialsSettings();
        /** Our ids for connections: [settings, its id]. */
        this._ids = new Map();
        this._next = 1;
    }

    /** The settings `key` belongs to, or null (a Workspace Profiles key without GNOME Essentials). */
    _for(key) {
        if (!key.startsWith('profiles-'))
            return this.own;
        return this.essentials?.settings_schema.has_key(key) ? this.essentials : null;
    }

    get_boolean(key) {
        return this._for(key)?.get_boolean(key) ?? DEFAULTS.get_boolean;
    }

    get_int(key) {
        return this._for(key)?.get_int(key) ?? DEFAULTS.get_int;
    }

    get_string(key) {
        return this._for(key)?.get_string(key) ?? DEFAULTS.get_string;
    }

    get_strv(key) {
        return this._for(key)?.get_strv(key) ?? DEFAULTS.get_strv;
    }

    set_boolean(key, value) {
        return this._for(key)?.set_boolean(key, value) ?? false;
    }

    set_int(key, value) {
        return this._for(key)?.set_int(key, value) ?? false;
    }

    set_string(key, value) {
        return this._for(key)?.set_string(key, value) ?? false;
    }

    set_strv(key, value) {
        return this._for(key)?.set_strv(key, value) ?? false;
    }

    connect(signal, callback) {
        const key = signal.startsWith('changed::') ? signal.slice('changed::'.length) : '';
        const settings = key ? this._for(key) : this.own;
        if (!settings)
            return 0;
        const id = this._next++;
        this._ids.set(id, [settings, settings.connect(signal, (_settings, changed) => callback(this, changed))]);
        return id;
    }

    disconnect(id) {
        const entry = this._ids.get(id);
        if (!entry)
            return;
        entry[0].disconnect(entry[1]);
        this._ids.delete(id);
    }

    destroy() {
        for (const [settings, id] of this._ids.values())
            settings.disconnect(id);
        this._ids.clear();
        this.essentials = null;
    }
}
