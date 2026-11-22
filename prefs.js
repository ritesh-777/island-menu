// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// Island Menu: its settings window.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, {lower, upper, step, digits = 0}) {
    const row = new Adw.SpinRow({title, subtitle, digits,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 4})});
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

/** Panel Island's settings, from where it is installed, or null. */
function panelIslandSettings() {
    const dirs = [GLib.get_user_data_dir(), ...GLib.get_system_data_dirs()]
        .map(dir => GLib.build_filenamev([dir, 'gnome-shell', 'extensions', 'panel-island@ritesh', 'schemas']));
    for (const dir of dirs) {
        if (!GLib.file_test(GLib.build_filenamev([dir, 'gschemas.compiled']), GLib.FileTest.EXISTS))
            continue;
        try {
            const source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
            const schema = source.lookup('org.gnome.shell.extensions.panel-island', true);
            if (schema)
                return new Gio.Settings({settings_schema: schema});
        } catch (e) {}
    }
    return null;
}

function choiceRow(settings, key, title, choices) {
    const row = new Adw.ComboRow({title, model: Gtk.StringList.new(choices.map(([, label]) => label))});
    const sync = () => {
        const i = Math.max(0, choices.findIndex(([value]) => value === settings.get_string(key)));
        if (row.selected !== i)
            row.selected = i;
        const subtitle = choices[i][2];
        row.subtitle = (typeof subtitle === 'function' ? subtitle() : subtitle) ?? '';
    };
    row.resync = sync;
    row.connect('notify::selected', () => {
        const value = choices[row.selected]?.[0];
        if (value && settings.get_string(key) !== value)
            settings.set_string(key, value);
    });
    settings.connect(`changed::${key}`, sync);
    sync();
    return row;
}

/** At login: GNOME's overview, the desktop (GNOME's own start-in-overview, off), or the desktop with the menu open. */
function loginRow(settings) {
    const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
    const choices = [
        ['overview', 'Overview', 'GNOME\'s Activities overview, as GNOME starts'],
        ['desktop', 'Desktop', 'Straight to the desktop'],
        ['menu', 'Island Menu', 'The desktop, with the menu open on the apps open now'],
    ];
    const row = new Adw.ComboRow({title: 'At login', model: Gtk.StringList.new(choices.map(([, label]) => label))});
    const current = () => settings.get_boolean('open-at-login') ? 'menu'
        : shell.get_boolean('start-in-overview') ? 'overview' : 'desktop';
    const sync = () => {
        const i = choices.findIndex(([value]) => value === current());
        if (row.selected !== i)
            row.selected = i;
        row.subtitle = choices[i][2];
    };
    row.connect('notify::selected', () => {
        const value = choices[row.selected]?.[0];
        if (!value || value === current())
            return;
        shell.set_boolean('start-in-overview', value === 'overview');
        settings.set_boolean('open-at-login', value === 'menu');
    });
    settings.connect('changed::open-at-login', sync);
    shell.connect('changed::start-in-overview', sync);
    sync();
    return row;
}

export default class IslandMenuPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(560, 680);
        const page = new Adw.PreferencesPage({title: 'Island Menu', icon_name: 'view-app-grid-symbolic'});
        window.add(page);

        const opening = new Adw.PreferencesGroup({
            title: 'Opening',
            description: 'Opens on the apps open now. All apps ("* "), web search ("? "), files ("~ "), a calculator ("= ") and the Shelf ("# "), without the overview.',
        });
        opening.add(switchRow(settings, 'super-key-opens-menu', 'Super key opens the menu',
            'Instead of the overview, which stays on the Activities button, the hot corner and Super+A'));
        opening.add(loginRow(settings));
        opening.add(switchRow(settings, 'open-on-empty-workspace', 'Open on empty workspaces',
            'Opens by itself when a workspace has no windows, and closes as one opens. Turn off Foresight Reborn for this'));
        opening.add(switchRow(settings, 'alt-tab-opens-menu', 'Alt+Tab and Super+Tab open the menu',
            'Hold Alt (or Super) and press Tab to step through the open windows, let go to go there. Off: GNOME\'s own switchers again'));
        opening.add(switchRow(settings, 'menu-shortcut-enabled', 'Keyboard shortcut',
            'Open the menu with the shortcut below'));
        const shortcut = new Adw.EntryRow({title: 'Shortcut', show_apply_button: true});
        const syncShortcut = () => (shortcut.text = settings.get_strv('menu-shortcut')[0] ?? '');
        shortcut.connect('apply', () => {
            const text = shortcut.text.trim();
            if (text && Gtk.accelerator_parse(text)[0])
                settings.set_strv('menu-shortcut', [text]);
            else
                syncShortcut();
        });
        settings.connect('changed::menu-shortcut', syncShortcut);
        syncShortcut();
        const syncShortcutSensitive = () => (shortcut.sensitive = settings.get_boolean('menu-shortcut-enabled'));
        settings.connect('changed::menu-shortcut-enabled', syncShortcutSensitive);
        syncShortcutSensitive();
        opening.add(shortcut);
        opening.add(switchRow(settings, 'menu-show-panel-icon', 'Top bar button', 'A launcher button in the top bar'));
        opening.add(choiceRow(settings, 'menu-panel-icon', 'Top bar icon', [
            ['system', 'System logo', 'This system\'s own logo, black or white as the bar is'],
            ['grid', 'App grid'],
        ]));
        opening.add(choiceRow(settings, 'menu-search-position', 'Search field', [
            ['top', 'Top', 'Above its results'],
            ['bottom', 'Bottom', 'Below the results, nearest the launcher\'s bottom edge'],
        ]));
        opening.add(choiceRow(settings, 'menu-highlight-style', 'Highlight style', [
            ['classic', 'Classic', 'An accent ring round the search field, the chosen app tinted in the accent colour'],
            ['lens', 'Glass lens', 'Brighter glass, an accent line under the field and an accent bar by the chosen app'],
            ['capsule', 'Accent capsule', 'A soft accent glow round the field, the chosen app a solid accent pill'],
            ['edge', 'Minimal edge', 'No fill: an accent bar and a bold name mark the chosen app'],
        ]));
        // Panel Island's middle capsule: shown with its Middle capsule on, or on Automatic while Isle's island is not
        // at the top holding the clock (Isle off, or Panel Island's bar at the bottom).
        const panelIsland = panelIslandSettings();
        const shell = new Gio.Settings({schema_id: 'org.gnome.shell'});
        const middleShown = () => {
            if (!panelIsland)
                return false;
            const mode = panelIsland.get_string('centre-capsule');
            if (mode !== 'auto')
                return mode === 'on';
            const isle = shell.get_strv('enabled-extensions').includes('isle@zickrian.github.io') &&
                !shell.get_boolean('disable-user-extensions');
            return !isle || panelIsland.get_boolean('bar-at-bottom');
        };
        const placeRow = choiceRow(settings, 'menu-launcher-place', 'Launcher opens at', [
            ['capsule', 'Panel Island\'s left capsule', 'Its glass growing out of the left capsule, with the bar at the top or the bottom (near the top without Panel Island)'],
            ['capsule-middle', 'Panel Island\'s middle capsule', () => middleShown()
                ? 'Its glass growing out of the middle capsule (the clock\'s), centred on it'
                : 'No middle capsule now (Isle\'s island holds the clock with the bar at the top): the left capsule is used until there is one'],
            ['top-left', 'Top left', 'At the top left, under the top bar, coming down'],
            ['top-middle', 'Top middle', 'Under the top bar, centred, coming down'],
            ['centre', 'Centre of the screen', 'In the middle, opening out from there'],
            ['bottom-left', 'Bottom left', 'At the bottom left, rising up'],
            ['bottom-middle', 'Bottom middle', 'At the bottom, centred, rising up'],
        ]);
        opening.add(placeRow);
        if (panelIsland) {
            panelIsland.connect('changed::centre-capsule', () => placeRow.resync());
            panelIsland.connect('changed::bar-at-bottom', () => placeRow.resync());
        }
        shell.connect('changed::enabled-extensions', () => placeRow.resync());
        opening.add(choiceRow(settings, 'menu-panel-icon-placement', 'Top bar button placement', [
            ['before-workspaces', 'Before the workspaces'],
            ['after-workspaces', 'After the workspaces'],
            ['centre', 'In the middle', 'Before the clock, in Panel Island\'s middle capsule where it is shown'],
        ]));
        page.add(opening);

        const workspaces = new Adw.PreferencesGroup({
            title: 'Workspaces',
            description: 'In Panel Island\'s left capsule. The peek, dragging onto the capsule and the glow need Panel Island running.',
        });
        workspaces.add(switchRow(settings, 'workspace-numbers', 'Workspace numbers',
            'One per workspace. Click one to go there, drop a window or app icon on one'));
        workspaces.add(switchRow(settings, 'drag-to-workspaces', 'Drag to workspaces',
            'Hold a window by its title bar, or an app icon, over the capsule: the peek opens. Let go on a workspace to send it there'));
        workspaces.add(switchRow(settings, 'workspace-peek', 'Workspace peek',
            'Rest the pointer on the workspace buttons: a live preview of each workspace. Click one to go there, drag a window onto one to move it'));
        const peekDelay = spinRow(settings, 'peek-delay', 'Peek delay',
            'How long the pointer rests before it opens, in milliseconds', {lower: 100, upper: 2000, step: 50});
        const syncPeek = () => (peekDelay.sensitive = settings.get_boolean('workspace-peek'));
        settings.connect('changed::workspace-peek', syncPeek);
        syncPeek();
        workspaces.add(peekDelay);
        workspaces.add(switchRow(settings, 'attention-glow', 'Attention glow',
            'The capsule\'s edge glows while a window on another workspace asks for attention'));
        const glowWidth = spinRow(settings, 'glow-width', 'Glow width',
            'How wide its glowing line is, in px', {lower: 0.5, upper: 6, step: 0.5, digits: 1});
        const glowPulse = switchRow(settings, 'attention-pulse', 'Pulse', 'The glow slowly breathes in and out');
        const syncGlow = () => (glowWidth.sensitive = glowPulse.sensitive = settings.get_boolean('attention-glow'));
        settings.connect('changed::attention-glow', syncGlow);
        syncGlow();
        workspaces.add(glowWidth);
        workspaces.add(glowPulse);
        page.add(workspaces);

        const look = new Adw.PreferencesGroup({title: 'Look'});
        look.add(choiceRow(settings, 'color-style', 'Style', [
            ['auto', 'Follow GNOME', 'Light or dark as Settings → Appearance is'],
            ['light', 'Light', 'Frosted light glass, dark text'],
            ['dark', 'Dark', 'Smoked glass, light text'],
        ]));
        look.add(switchRow(settings, 'menu-animations-enabled', 'Animations', 'The menu animates as it opens and closes'));
        look.add(switchRow(settings, 'menu-backdrop-dim-enabled', 'Dim the screen', 'Behind the menu while it is open'));
        look.add(choiceRow(settings, 'menu-switch-glass', 'Glass during workspace switches', [
            ['always', 'Held still', 'Blurred again once the switch is over; lightest on the CPU'],
            ['battery', 'Held still on battery', 'Live when plugged in'],
            ['never', 'Live', 'Follows the slide every frame'],
            ['live-efficient', 'Live, efficient', 'Follows the slide, blurred at half resolution'],
        ]));
        page.add(look);

        const search = new Adw.PreferencesGroup({title: 'Search'});
        search.add(choiceRow(settings, 'menu-default-search-engine', 'Web search engine', [
            ['duckduckgo', 'DuckDuckGo'], ['google', 'Google'], ['bing', 'Bing'],
        ]));
        search.add(switchRow(settings, 'uninstall-in-menu', 'Uninstall from the menu',
            'An Uninstall action on apps found in the menu'));
        page.add(search);

        const shelf = new Adw.PreferencesGroup({
            title: 'Shelf',
            description: 'Files, folders, links and snippets you deliberately keep at hand. With GNOME Essentials running, apps on it can restore a Workspace Profile.',
        });
        shelf.add(switchRow(settings, 'shelf-enabled', 'Shelf', 'Type "# " in the menu'));
        shelf.add(switchRow(settings, 'shelf-show-in-menu', 'Shelf in the menu', 'Its items and actions in the menu'));
        shelf.add(switchRow(settings, 'shelf-persist', 'Keep after logging out', 'Its items are saved'));
        const size = new Adw.SpinRow({title: 'Shelf size', subtitle: 'How many items it keeps',
            adjustment: new Gtk.Adjustment({lower: 4, upper: 80, step_increment: 1, page_increment: 4})});
        settings.bind('shelf-max-items', size, 'value', Gio.SettingsBindFlags.DEFAULT);
        shelf.add(size);
        shelf.add(switchRow(settings, 'shelf-show-notifications', 'Notifications', 'For what the Shelf does'));
        const clear = new Adw.ActionRow({title: 'Clear the Shelf', subtitle: 'Removes every item on it'});
        const button = new Gtk.Button({label: 'Clear', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
        button.connect('clicked', () => settings.set_string('shelf-trigger-clear', `${Date.now()}`));
        clear.add_suffix(button);
        shelf.add(clear);
        page.add(shelf);
    }
}
