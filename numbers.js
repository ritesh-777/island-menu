// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// Settings → Workspace numbers: Island Menu's own workspace buttons in Panel Island's left capsule, one per workspace, needing no
// other extension. The one shown is filled in the accent colour, ones holding windows brighter than empty ones, one
// wanting attention ringed in the accent colour. A click goes there. Each is a drop target: a window (from the peek, or
// moved by its title bar onto it, drag.js) moves to that workspace, an app icon opens a new window there.

import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

/** Its name in the bar's status area; "workspace" in it makes it a trigger of the workspace peek too (peek.js). */
export const NUMBERS_NAME = 'island-menu-workspaces';

/** Whether `workspace` holds a window one would see in the overview. */
const occupied = workspace => workspace.list_windows().some(window => !window.skip_taskbar && !window.is_on_all_workspaces());

/** Whether the stage point `x`, `y` is within `actor`. */
function within(actor, x, y) {
    if (!actor?.mapped)
        return false;
    const [ax, ay] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return x >= ax && x <= ax + w && y >= ay && y <= ay + h;
}

/** Moves `window` to the workspace at `index` on the monitor it is on, as the overview's drop does. */
export function moveToWorkspace(window, index) {
    if (window.get_workspace()?.index() === index)
        return false;
    Main.moveWindowToMonitorAndWorkspace(window, window.get_monitor(), index);
    return true;
}

/** What a drag's `source` does dropped on the workspace at `index`: a window moves there, an app opens there. */
export function dropOn(source, index, apply) {
    const window = source?.metaWindow;
    if (window) {
        if (window.get_workspace()?.index() === index)
            return apply ? false : DND.DragMotionResult.NO_DROP;
        return apply ? moveToWorkspace(window, index) : DND.DragMotionResult.MOVE_DROP;
    }
    const app = source?.app;
    if (app?.can_open_new_window?.()) {
        if (apply)
            app.open_new_window(index);
        return apply ? true : DND.DragMotionResult.COPY_DROP;
    }
    return apply ? false : DND.DragMotionResult.CONTINUE;
}

export class WorkspaceNumbers {
    /** `urgent()`: the indexes of the workspaces wanting attention. */
    constructor(urgent) {
        this._urgent = urgent;
        this._button = null;
        this._box = null;
        this._numbers = [];
        this._hot = null;
        this._watched = [];
        this._light = false;
    }

    get shown() {
        return Boolean(this._button);
    }

    set enabled(on) {
        if (on === this.shown)
            return;
        if (!on) {
            this._unwatch();
            global.workspace_manager.disconnectObject(this);
            Main.panel._leftBox.disconnectObject(this);
            if (this._orderLater)
                global.compositor.get_laters().remove(this._orderLater);
            this._orderLater = 0;
            Main.panel.statusArea.activities?.disconnectObject(this);
            Main.panel.statusArea.activities?.container?.disconnectObject(this);
            this._button.destroy();
            this._button = this._box = null;
            this._numbers = [];
            return;
        }
        this._button = new PanelMenu.Button(0.0, 'Workspaces', true);
        this._button.add_style_class_name('island-menu-ws-button');
        this._syncLight();
        this._box = new St.BoxLayout({style_class: 'island-menu-ws', y_align: Clutter.ActorAlign.CENTER});
        this._button.add_child(this._box);
        // Just after GNOME's Activities button, at the start of the left side, and kept there as other extensions add
        // or move their buttons (Island Menu's placing itself by the workspaces).
        Main.panel.addToStatusArea(NUMBERS_NAME, this._button, 1, 'left');
        Main.panel._leftBox.connectObject('child-added', () => this._queueOrder(),
            'child-removed', () => this._queueOrder(), this);
        this._queueOrder();
        global.workspace_manager.connectObject('notify::n-workspaces', () => this._build(),
            'active-workspace-changed', () => this._sync(), 'workspaces-reordered', () => this._build(), this);
        // GNOME's Activities button shown or hidden (another extension hiding it, Panel Island keeping it): the dot
        // before the numbers with it.
        Main.panel.statusArea.activities?.connectObject('notify::visible', () => this._sync(), this);
        Main.panel.statusArea.activities?.container?.connectObject('notify::visible', () => this._sync(), this);
        this._button.connect('destroy', () => {
            this._unwatch();
            global.workspace_manager.disconnectObject(this);
            this._button = this._box = null;
            this._numbers = [];
        });
        this._build();
    }

    /** Once the bar has settled, its numbers put right after GNOME's Activities button if anything came between. */
    _queueOrder() {
        if (this._orderLater || !this._button)
            return;
        this._orderLater = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._orderLater = 0;
            const ours = this._button?.container;
            const activities = Main.panel.statusArea.activities?.container;
            const left = Main.panel._leftBox;
            if (!ours || !activities || ours.get_parent() !== left || activities.get_parent() !== left)
                return false;
            const children = left.get_children();
            if (children.indexOf(ours) !== children.indexOf(activities) + 1)
                left.set_child_above_sibling(ours, activities);
            return false;
        });
    }

    _unwatch() {
        this._watched.forEach(workspace => workspace.disconnectObject(this));
        this._watched = [];
    }

    /** One button per workspace, made anew as workspaces come and go. */
    _build() {
        if (!this._box)
            return;
        this._unwatch();
        this._box.destroy_all_children();
        this._numbers = [];
        // A thin line setting the numbers apart from GNOME's Activities button (its workspace dots) before them: a
        // line, not a dot, so it reads as neither a workspace nor the accent; shown only while that button is.
        this._separator = new St.Widget({style_class: 'island-menu-ws-separator', y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._separator);
        const manager = global.workspace_manager;
        for (let i = 0; i < manager.n_workspaces; i++) {
            const workspace = manager.get_workspace_by_index(i);
            const number = new St.Button({
                style_class: 'island-menu-ws-number', label: `${i + 1}`,
                y_align: Clutter.ActorAlign.CENTER, can_focus: true,
            });
            number.connect('clicked', () => workspace.activate(global.get_current_time()));
            number._delegate = {
                handleDragOver: source => dropOn(source, i, false),
                acceptDrop: source => dropOn(source, i, true),
            };
            this._box.add_child(number);
            this._numbers.push(number);
            workspace.connectObject('window-added', () => this._sync(), 'window-removed', () => this._sync(), this);
            this._watched.push(workspace);
        }
        this._sync();
    }

    /** Each button's look: shown, holding windows, wanting attention, under a window being dragged. */
    _sync() {
        const activities = Main.panel.statusArea.activities;
        if (this._separator)
            this._separator.visible = Boolean(activities?.visible && activities.container?.visible);
        const manager = global.workspace_manager;
        const urgent = this._urgent();
        this._numbers.forEach((number, i) => {
            const workspace = manager.get_workspace_by_index(i);
            if (!workspace)
                return;
            const set = (name, on) => on ? number.add_style_class_name(name) : number.remove_style_class_name(name);
            set('island-menu-ws-current', workspace.active);
            set('island-menu-ws-occupied', occupied(workspace));
            set('island-menu-ws-urgent', urgent.has(i));
            set('island-menu-ws-hot', this._hot === i);
        });
    }

    /** Light or dark as Island Menu's Style says (stylesheet.css), whatever the capsule they sit in. */
    setLight(light) {
        this._light = light;
        this._syncLight();
    }

    _syncLight() {
        if (!this._button)
            return;
        this._button.add_style_class_name(this._light ? 'island-menu-ws-light' : 'island-menu-ws-dark');
        this._button.remove_style_class_name(this._light ? 'island-menu-ws-dark' : 'island-menu-ws-light');
    }

    /** The workspaces wanting attention changed. */
    setUrgent() {
        this._sync();
    }

    /** The workspace whose button is at the stage point `x`, `y`, or null. */
    indexAt(x, y) {
        const i = this._numbers.findIndex(number => within(number, x, y));
        return i < 0 ? null : i;
    }

    /** Marks the button a dragged window would go to (`index`), or none. */
    setHot(index) {
        if (this._hot === index)
            return;
        this._hot = index;
        this._sync();
    }

    destroy() {
        this.enabled = false;
    }
}
