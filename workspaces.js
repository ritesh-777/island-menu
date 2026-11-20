// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// Settings → Workspaces: Island Menu's workspace numbers, workspace peek, drag to workspaces and attention glow
// (numbers.js, peek.js, drag.js, attention.js), in Panel Island's left capsule. The numbers are a button of the bar of
// their own and work without Panel Island; the peek, the drag onto the capsule and the glow are drawn on its glass, so
// they run while it does (`global.panel_island.workspaces`, its workspaceGlass.js), starting and stopping with it.
//
// Dragging onto them: a window moves to the workspace it is let go on, an app opens a new window there (drag.js,
// numbers.js, the peek's previews), and a file or link dragged from another app (Files, a browser) opens there in the
// app that opens it. The peek's last tile is the Shelf: an app or a file let go on it goes on Island Menu's Shelf.
// While the peek can open, the menu button opens it too (it no longer takes drops onto the Shelf itself).

import Gio from 'gi://Gio';
import GioUnix from 'gi://GioUnix';
import GLib from 'gi://GLib';
import St from 'gi://St';

import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Attention} from './attention.js';
import {DragToWorkspaces} from './drag.js';
import {Peek} from './peek.js';
import {WorkspaceNumbers, moveToWorkspace} from './numbers.js';

const KEYS = ['color-style', 'workspace-numbers', 'workspace-peek', 'drag-to-workspaces', 'peek-delay', 'attention-glow',
    'glow-width', 'attention-pulse'];

/** A drop target as a short key, to tell one from another cheaply ('' for none). */
const targetKey = target => !target ? '' : target.shelf ? 'shelf' : target.gap !== undefined ? `gap${target.gap}` : `ws${target.index}`;

const scale = () => St.ThemeContext.get_for_stage(global.stage).scale_factor;

/** The Shelf's tile icon (icons/), symbolic so it is coloured as the text round it. */
let shelfIcon = null;

/** Where a drag went and what came of it, in the log (journalctl) only while debugging drops. */
const DEBUG_DROPS = false;
const trace = message => DEBUG_DROPS && console.log(`[island-menu] drop: ${message}`);

/** The folders a file manager's `window` shows (Files: its tabs), as URIs, from its D-Bus
 * `org.freedesktop.FileManager1.OpenWindowsWithLocations`: `callback(uris)`, empty if it has none or cannot say. */
function windowLocations(window, callback) {
    const path = window.get_gtk_window_object_path?.();
    if (!path) {
        callback([]);
        return;
    }
    Gio.DBus.session.call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
        'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', ['org.freedesktop.FileManager1', 'OpenWindowsWithLocations']),
        null, Gio.DBusCallFlags.NONE, 1000, null, (connection, result) => {
            try {
                const [value] = connection.call_finish(result).deepUnpack();
                const windows = value.deepUnpack();
                callback(windows[path] ?? []);
            } catch (e) {
                trace(`the file manager's folders not read: ${e.message}`);
                callback([]);
            }
        });
}

/** Opens `value` (a file or link a drag carried) on the workspace at `index`, in the app that opens it; an app's
 * launcher file (.desktop) starts that app. Returns whether it opened. */
function openOnWorkspace(value, index) {
    const text = String(value ?? '').trim();
    const uri = GLib.path_is_absolute(text) ? Gio.File.new_for_path(text).get_uri() : text;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(uri))
        return false;
    const context = global.create_app_launch_context(global.get_current_time(), index);
    try {
        if (uri.startsWith('file://') && uri.endsWith('.desktop')) {
            const app = (GioUnix.DesktopAppInfo ?? Gio.DesktopAppInfo).new_from_filename(Gio.File.new_for_uri(uri).get_path());
            if (app)
                return app.launch([], context);
        }
        return Gio.AppInfo.launch_default_for_uri(uri, context);
    } catch (e) {
        console.warn(`[island-menu] ${uri} could not be opened on workspace ${index + 1}: ${e}`);
        Main.notify('Island Menu', `Nothing opens ${GLib.path_get_basename(Gio.File.new_for_uri(uri).get_path() ?? uri)}.`);
        return false;
    }
}

export class Workspaces {
    /** `settings`: Island Menu's Gio.Settings; `menu()`: Island Menu's menu now (its Shelf), or null. */
    constructor(settings, menu = () => null, dir = null) {
        this._settings = settings;
        this._menu = menu;
        shelfIcon = dir ? new Gio.FileIcon({file: dir.get_child('icons').get_child('island-menu-shelf-symbolic.svg')})
            : new Gio.ThemedIcon({name: 'user-bookmarks-symbolic'});
        this._menuDragging = false;
        this._xdnd = null;
        this._xdndMonitor = {dragMotion: event => this._xdndMotion(event)};
        this._glass = null;
        this._peek = null;
        this._drag = null;
        this._attention = new Attention(urgent => {
            this._applyGlow();
            this._peek?.setUrgent(urgent);
            this._numbers.setUrgent();
        });
        this._numbers = new WorkspaceNumbers(() => this._attention.urgent);
        // Panel Island tells us as it starts and stops (its workspaceGlass.js).
        global.island_menu_workspaces = {
            panelIslandReady: () => this._connect(),
            panelIslandGone: () => this._disconnect(),
            // The menu button opens the peek, rather than taking drops onto the Shelf (menu.js).
            // An app or a window let go on the menu button itself: on the Shelf (menu.js).
            panelDragOver: source => this._shelfHost()?.dragOver(source) ?? DND.DragMotionResult.CONTINUE,
            panelDrop: source => this._shelfHost()?.drop(source) ?? false,
            // A result dragged out of the menu (menu.js): the peek opens, where it is let go takes it.
            menuDragBegin: () => this._menuDragBegin(),
            menuDragMotion: (x, y, payload) => this._menuDragMotion(x, y, payload),
            menuDrop: (x, y, payload) => this._menuDrop(x, y, payload),
            menuDragEnd: () => this._menuDragEnd(),
            takesPanelDrops: () => Boolean(this._peek && this._drag) &&
                this._settings.get_boolean('workspace-peek') && this._settings.get_boolean('drag-to-workspaces'),
        };
        // A drag from another app (a file from Files, a link from a browser): where it is let go (`_xdndEnd`).
        Main.xdndHandler?.connectObject('drag-begin', () => this._xdndBegin(), 'drag-end', () => this._xdndEnd(), this);
        for (const key of KEYS)
            this._settings.connectObject(`changed::${key}`, () => this._apply(), this);
        // Settings → Style: Follow GNOME, so GNOME's own style too.
        St.Settings.get().connectObject('notify::color-scheme', () => this._apply(), this);
        this._connect();
        this._apply();
    }

    /** Whether they are drawn light: Island Menu's Settings → Style (Light, Dark, or as GNOME's own style is), as
     * its launcher is, not as Panel Island's capsules are. */
    _light() {
        const style = this._settings.get_string('color-style');
        if (style !== 'auto')
            return style === 'light';
        return St.Settings.get().color_scheme !== St.SystemColorScheme.PREFER_DARK;
    }

    /** Panel Island's workspace glass, if it runs. */
    _panelIsland() {
        const glass = global.panel_island?.workspaces;
        return glass?.version >= 1 ? glass : null;
    }

    /** The peek and the drag made on Panel Island's glass. */
    _connect() {
        const glass = this._panelIsland();
        if (!glass || glass === this._glass)
            return;
        this._disconnect();
        this._glass = glass;
        this._peek = new Peek({
            glass: glass.glass,
            restRect: () => glass.restRect(),
            openShape: rect => glass.openShape(rect),
            // Its glass, and the left capsule's text while it is open, light or dark as Island Menu's Style says.
            hold: on => {
                glass.setLight?.(on ? this._light() : null);
                glass.hold(on);
            },
            busy: () => glass.busy(),
            opening: () => glass.opening(),
            closing: () => glass.closing(),
            delay: () => this._settings.get_int('peek-delay'),
            closeDelay: () => glass.closeDelay(),
            urgent: () => this._attention.urgent,
            dragging: () => Boolean(this._drag?.active) || this._menuDragging,
            light: () => this._light(),
            shelf: () => this._shelfHost(),
            triggers: () => [this._menu()?._indicator].filter(Boolean),
        });
        const peek = this._peek;
        glass.attach(this._client = {
            get shown() {
                return peek.shown;
            },
            close: (now, why) => peek.close(now, why),
            watchTriggers: () => peek.watchTriggers(),
        });
        this._drag = new DragToWorkspaces({
            overPill: (x, y) => {
                const r = glass.restRect();
                const slack = 4 * scale();
                return Boolean(r) && x >= r.x - slack && x <= r.x + r.width + slack &&
                    y >= r.y - slack && y <= r.y + r.height + slack;
            },
            overPeek: (x, y) => peek.contains(x, y),
            // The Shelf's tile lit too as a window carried by its title bar is over it (it has no index).
            targetAt: (x, y) => {
                peek.setHotShelf(peek.shelfAt(x, y));
                return this._numbers.indexAt(x, y) ?? peek.indexAt(x, y);
            },
            setHot: index => {
                if (index === null && !this._drag?.active)
                    peek.setHotShelf(false);
                this._numbers.setHot(index);
                peek.setHot(index);
            },
            dropOnButton: (window, x, y) => {
                const menu = this._menu();
                if (!this._overMenuButton(x, y) || !menu?.shelfAvailable?.())
                    return false;
                this._windowToShelf(menu, window);
                return true;
            },
            openPeek: () => peek.open(),
            closePeek: why => peek.close(false, why),
            peekShown: () => peek.shown,
            delay: () => this._settings.get_int('peek-delay'),
            dropWindow: (window, x, y, dragged) => {
                peek.setHotShelf(false);
                // Let go on the Shelf's tile: its app (a file manager's folder) on the Shelf, the window where it was.
                if (peek.shelfAt(x, y)) {
                    const menu = this._menu();
                    if (menu?.shelfAvailable?.())
                        this._windowToShelf(menu, window);
                    return;
                }
                if (peek.dropWindow(window, x, y, dragged))
                    return;
                const index = this._numbers.indexAt(x, y);
                if (index !== null)
                    moveToWorkspace(window, index);
            },
        });
        this._apply();
    }

    /** The peek's Shelf tile (peek.js), or null with the Shelf off. */
    _shelfHost() {
        const menu = this._menu();
        if (!menu?.shelfAvailable?.())
            return null;
        return {
            gicon: shelfIcon,
            dragOver: source => source?.app || source?.metaWindow || source === Main.xdndHandler
                ? DND.DragMotionResult.COPY_DROP : DND.DragMotionResult.CONTINUE,
            // An app from the dash or the grid, or a window from a preview; another app's file is taken as its drag
            // ends (`_xdndEnd`).
            drop: source => {
                if (source?.metaWindow)
                    return this._windowToShelf(menu, source.metaWindow);
                trace(`onto the Shelf tile: ${source?.app ? source.app.get_id() : 'nothing it takes'}`);
                return source?.app ? menu.addAppToShelf(source.app) : false;
            },
            open: () => menu.openShelf(),
        };
    }

    /** A window dragged from a preview onto the Shelf's tile: a file manager's the folder it shows, any other its
     * app. The window stays where it is. */
    _windowToShelf(menu, window) {
        const app = Shell.WindowTracker.get_default().get_window_app(window);
        trace(`window of ${app?.get_id() ?? 'no app'} onto the Shelf tile`);
        windowLocations(window, uris => {
            if (uris.length) {
                trace(`its folders: ${uris.join(', ')}`);
                menu.addDroppedToShelf(uris);
            } else if (app) {
                menu.addAppToShelf(app);
            }
        });
        return true;
    }

    /** Where a drag from another app is now: the peek's Shelf tile, a workspace (its number or its preview), or null. */
    _dropTargetAt(x, y, fromMenu = false) {
        // The menu button only while the peek takes its drops (else the menu puts them on the Shelf itself), or for
        // a result dragged out of the menu.
        const button = (fromMenu || global.island_menu_workspaces?.takesPanelDrops?.()) && this._overMenuButton(x, y);
        if (this._peek?.shelfAt(x, y) || button)
            return this._menu()?.shelfAvailable?.() ? {shelf: true} : null;
        const gap = this._peek?.gapAt(x, y) ?? null;
        if (gap !== null)
            return {gap};
        const index = this._numbers.indexAt(x, y) ?? this._peek?.indexAt(x, y) ?? null;
        return index === null ? null : {index};
    }

    /** Whether the stage point `x`, `y` is on Island Menu's button in the bar (a drop there goes on the Shelf). */
    _overMenuButton(x, y) {
        const button = this._menu()?._indicator;
        if (!button?.mapped)
            return false;
        const [bx, by] = button.get_transformed_position();
        const [w, h] = button.get_transformed_size();
        return x >= bx && x <= bx + w && y >= by && y <= by + h;
    }

    /** The pointer over one of ours shown as a copy (a drag from another app sees no window there to take it, so
     * the compositor shows it can't be dropped); back as the compositor has it as it leaves. */
    _dropCursor(on, ended = false) {
        const cursor = ended ? Meta.Cursor.DEFAULT : on ? Meta.Cursor.DND_COPY : Meta.Cursor.DND_UNSUPPORTED_TARGET;
        if (cursor === undefined)
            return;
        try {
            global.display.set_cursor(cursor);
        } catch {}
    }

    _xdndBegin() {
        trace('a drag from another app began');
        this._xdnd = {target: null, values: null, reading: false, ended: false};
        DND.addDragMonitor(this._xdndMonitor);
    }

    _xdndMotion(event) {
        const drag = this._xdnd;
        if (!drag || event.source !== Main.xdndHandler)
            return DND.DragMotionResult.CONTINUE;
        const target = this._dropTargetAt(event.x, event.y);
        if (DEBUG_DROPS && targetKey(target) !== targetKey(drag.target))
            trace(`over ${targetKey(target) || 'nothing of ours'}`);
        if (target || drag.target)
            this._dropCursor(Boolean(target));
        drag.target = target;
        this._numbers.setHot(drag.target?.index ?? null);
        this._peek?.setHot(drag.target?.index ?? null);
        this._peek?.setHotGap(drag.target?.gap ?? null);
        this._peek?.setHotShelf(Boolean(drag.target?.shelf));
        // What it carries read while it is held over one, as it may not be readable once let go.
        if (drag.target && !drag.values && !drag.reading) {
            drag.reading = true;
            this._menu()?.readDroppedValues(values => {
                trace(`it carries ${values.length}: ${values.slice(0, 3).join(', ')}`);
                drag.values = values;
                drag.reading = false;
                if (drag.ended)
                    this._xdndDrop(drag);
            });
        }
        return DND.DragMotionResult.CONTINUE;
    }

    _xdndEnd() {
        const drag = this._xdnd;
        this._xdnd = null;
        DND.removeDragMonitor(this._xdndMonitor);
        this._numbers.setHot(null);
        this._peek?.setHot(null);
        this._peek?.setHotGap(null);
        this._peek?.setHotShelf(false);
        if (drag?.target)
            this._dropCursor(false, true);
        trace(`it ended over ${targetKey(drag?.target) || 'nothing of ours'}`);
        if (!drag?.target)
            return;
        drag.ended = true;
        if (!drag.reading)
            this._xdndDrop(drag);
    }

    /** Another app's files or links let go on a workspace (opened there) or on the Shelf's tile (put on the Shelf). */
    _xdndDrop({target, values}) {
        if (!values?.length)
            return;
        if (target.shelf) {
            this._menu()?.addDroppedToShelf(values);
            return;
        }
        // Only files and links open on a workspace; text has nothing to open it.
        const openable = values.filter(value => /^[a-z][a-z0-9+.-]*:/i.test(value) || GLib.path_is_absolute(value));
        if (!openable.length) {
            Main.notify('Island Menu', 'Only files and links open on a workspace. Drop text on the Shelf instead.');
            return;
        }
        // In a gap: a new workspace there first, as an app or a window dropped there makes one.
        let index = target.index;
        if (target.gap !== undefined) {
            Main.wm.insertWorkspace(target.gap);
            index = target.gap;
        }
        const opened = openable.filter(value => openOnWorkspace(value, index)).length;
        trace(`opened ${opened} of ${openable.length} on workspace ${index + 1}`);
        if (opened)
            this._peek?.close(false, 'a file was opened on a workspace');
    }

    /** A result dragged out of the menu: the peek opened at once, in the menu's place (it stepped aside). */
    _menuDragBegin() {
        this._menuDragging = true;
        trace('a result was dragged out of the menu');
        if (this._peek && this._settings.get_boolean('workspace-peek') && !this._peek.shown)
            this._peek.open();
    }

    _menuDragMotion(x, y, payload) {
        const target = this._dropTargetAt(x, y, true);
        this._numbers.setHot(target?.index ?? null);
        this._peek?.setHot(target?.index ?? null);
        this._peek?.setHotGap(target?.gap ?? null);
        this._peek?.setHotShelf(Boolean(target?.shelf));
        // Back over the capsule after the peek closed: open again.
        if (this._peek && !this._peek.shown && this._glass && this._drag && this._overCapsule(x, y))
            this._peek.open();
        void payload;
    }

    _menuDrop(x, y, payload) {
        const target = this._dropTargetAt(x, y, true);
        trace(`menu result ${payload.window ? 'window' : payload.app?.get_id() ?? payload.uri ?? 'text'} let go over ${targetKey(target) || 'nothing'}`);
        if (target) {
            this._dropPayload(target, payload);
            return;
        }
        // Let go anywhere else (the desktop, a window): an app or a file opens on the workspace shown, as dropping
        // it on that workspace's preview would. Text has nothing to open it, so it is left.
        if (payload.app || payload.uri || payload.window)
            this._dropPayload({index: global.workspace_manager.get_active_workspace_index()}, payload);
    }

    _menuDragEnd() {
        this._menuDragging = false;
        this._numbers.setHot(null);
        this._peek?.setHot(null);
        this._peek?.setHotGap(null);
        this._peek?.setHotShelf(false);
    }

    /** Whether the stage point `x`, `y` is on Panel Island's left capsule (a little round it). */
    _overCapsule(x, y) {
        const r = this._glass?.restRect();
        const slack = 4 * scale();
        return Boolean(r) && x >= r.x - slack && x <= r.x + r.width + slack &&
            y >= r.y - slack && y <= r.y + r.height + slack;
    }

    /** What a drag carries (`{app}`, `{uri}`, `{text}`) let go on `target`: the Shelf, a workspace, or a gap (a new
     * workspace there). */
    _dropPayload(target, {app, uri, text, window}) {
        const menu = this._menu();
        // A window's row (the menu's open view): the window itself moves, or its app (a file manager's folder) goes on
        // the Shelf.
        if (window) {
            if (target.shelf) {
                if (menu?.shelfAvailable?.())
                    this._windowToShelf(menu, window);
                return;
            }
            let index = target.index;
            if (target.gap !== undefined) {
                Main.wm.insertWorkspace(target.gap);
                index = target.gap;
            }
            if (window.get_workspace?.()?.index() !== index)
                Main.moveWindowToMonitorAndWorkspace(window, window.get_monitor(), index);
            // Focused, the keys too (menu.js: on another workspace it could come forward without them).
            if (menu?._focusWindow) menu._focusWindow(window);
            else Main.activateWindow(window);
            this._peek?.close(false, 'a window was moved from the menu');
            return;
        }
        if (target.shelf) {
            if (app)
                menu?.addAppToShelf(app);
            else if (uri || text)
                menu?.addDroppedToShelf([uri || text]);
            return;
        }
        if (text && !uri && !app) {
            Main.notify('Island Menu', 'Only apps, files and links open on a workspace. Drop text on the Shelf instead.');
            return;
        }
        let index = target.index;
        if (target.gap !== undefined) {
            Main.wm.insertWorkspace(target.gap);
            index = target.gap;
        }
        if (app) {
            if (app.can_open_new_window?.())
                app.open_new_window(index);
            else
                app.activate();
        } else {
            openOnWorkspace(uri, index);
        }
        this._peek?.close(false, 'something was opened on a workspace');
    }

    /** Panel Island gone (or going): the peek and the drag with it. */
    _disconnect() {
        if (!this._glass)
            return;
        try {
            this._drag?.destroy();
            this._peek?.destroy();
        } catch (e) {
            console.warn(`[island-menu] The workspace peek did not stop cleanly: ${e}`);
        }
        try {
            this._glass.detach(this._client);
            this._glass.setAttention(null);
        } catch {}
        this._glass = this._peek = this._drag = this._client = null;
    }

    _apply() {
        const s = this._settings;
        this._numbers.enabled = s.get_boolean('workspace-numbers');
        this._numbers.setLight(this._light());
        this._attention.enabled = s.get_boolean('attention-glow');
        if (this._peek)
            this._peek.enabled = s.get_boolean('workspace-peek');
        if (this._drag)
            this._drag.enabled = s.get_boolean('drag-to-workspaces');
        this._applyGlow();
    }

    /** The left capsule's edge lit while a workspace wants attention: Settings → Glow width and Pulse. */
    _applyGlow() {
        if (!this._glass)
            return;
        const on = this._settings.get_boolean('attention-glow') && this._attention.urgent.size > 0;
        try {
            this._glass.setAttention(on ? {
                width: this._settings.get_double('glow-width'),
                pulse: this._settings.get_boolean('attention-pulse'),
            } : null);
        } catch (e) {
            console.warn(`[island-menu] The attention glow could not be shown: ${e}`);
        }
    }

    destroy() {
        this._settings.disconnectObject(this);
        St.Settings.get().disconnectObject(this);
        Main.xdndHandler?.disconnectObject(this);
        if (this._xdnd)
            DND.removeDragMonitor(this._xdndMonitor);
        this._xdnd = null;
        this._disconnect();
        this._numbers.destroy();
        this._attention.destroy();
        if (global.island_menu_workspaces?.panelIslandReady)
            delete global.island_menu_workspaces;
    }
}
