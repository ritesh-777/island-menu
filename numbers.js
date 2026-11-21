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

/** A number's slot (px), the shown one's pill filling it: the circle inside every other one leaves room either side,
 * so the pill clears the circles next to it. One width for both: a switch changes no width. */
const SLOT = 30;
const CIRCLE = 20;
const PILL = 30;
const HEIGHT = 20;

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
        this._strength = 50;
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
            this._button = this._box = this._slotsBox = null;
            this._numbers = [];
            return;
        }
        this._button = new PanelMenu.Button(0.0, 'Workspaces', true);
        this._button.add_style_class_name('island-menu-ws-button');
        this._syncLight();
        this._box = new St.BoxLayout({style_class: 'island-menu-ws', y_align: Clutter.ActorAlign.CENTER});
        this._button.add_child(this._box);
        // A thin line setting the numbers apart from GNOME's Activities button (its workspace dots) before them: a
        // line, not a dot, so it reads as neither a workspace nor the accent; shown only while that button is.
        this._separator = new St.Widget({style_class: 'island-menu-ws-separator', y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._separator);
        // The numbers, each the same width whether shown or not (see `_makeNumber`), so a switch moves nothing.
        this._slotsBox = new St.BoxLayout({x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._slotsBox);
        // Just after GNOME's Activities button, at the start of the left side, and kept there as other extensions add
        // or move their buttons (Island Menu's placing itself by the workspaces).
        Main.panel.addToStatusArea(NUMBERS_NAME, this._button, 1, 'left');
        Main.panel._leftBox.connectObject('child-added', () => this._queueOrder(),
            'child-removed', () => this._queueOrder(), this);
        this._queueOrder();
        global.workspace_manager.connectObject('notify::n-workspaces', () => this._resize(),
            'active-workspace-changed', () => this._sync(), 'workspaces-reordered', () => this._resize(), this);
        // GNOME's Activities button shown or hidden (another extension hiding it, Panel Island keeping it): the dot
        // before the numbers with it.
        Main.panel.statusArea.activities?.connectObject('notify::visible', () => this._sync(), this);
        Main.panel.statusArea.activities?.container?.connectObject('notify::visible', () => this._sync(), this);
        this._button.connect('destroy', () => {
            this._unwatch();
            global.workspace_manager.disconnectObject(this);
            this._button = this._box = this._slotsBox = null;
            this._numbers = [];
        });
        this._resize();
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

    /** The index of a number now (numbers come and go, so it is looked up as it is clicked or dropped on). */
    _indexOf(number) {
        return this._numbers.indexOf(number);
    }

    /** One number, in a slot of its own holding the room before it, so it can grow in and shrink out as a whole. */
    _makeNumber() {
        // The button: the pill's own size and shape (the stylesheet's, as before), filled in the accent while its
        // workspace is shown. Inside it, centred, a circle: the neutral shade of every other one. One footprint for both,
        // so a switch changes no width (nothing beside it moves, nor the capsule round it); the change crossfades.
        // Three layers, laid out by hand in one fixed slot: the accent pill (the shown one's, wider than the slot), the
        // circle (every other one's shade), the number. The pill and the circle crossfade as one on a switch.
        const layers = new St.Widget({layout_manager: new Clutter.FixedLayout(), width: SLOT, height: HEIGHT});
        const pill = new St.Widget({style_class: 'island-menu-ws-pill', x: (SLOT - PILL) / 2, y: 0,
            width: PILL, height: HEIGHT, opacity: 0});
        const dot = new St.Widget({style_class: 'island-menu-ws-dot', x: (SLOT - CIRCLE) / 2, y: (HEIGHT - CIRCLE) / 2,
            width: CIRCLE, height: CIRCLE});
        const label = new St.Label({text: '', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        const center = new St.Widget({layout_manager: new Clutter.BinLayout(), x: 0, y: 0, width: SLOT, height: HEIGHT});
        center.add_child(label);
        layers.add_child(pill);
        layers.add_child(dot);
        layers.add_child(center);
        const number = new St.Button({
            style_class: 'island-menu-ws-number', child: layers,
            style: `width: ${SLOT}px; height: ${HEIGHT}px; min-width: ${SLOT}px; min-height: ${HEIGHT}px; ` +
                `max-width: ${SLOT}px; max-height: ${HEIGHT}px; padding: 0; background-color: transparent;`,
            y_align: Clutter.ActorAlign.CENTER, can_focus: true,
        });
        number._label = label;
        number._dot = dot;
        number._pill = pill;
        number.connect('clicked', () => {
            const i = this._indexOf(number);
            global.workspace_manager.get_workspace_by_index(i)?.activate(global.get_current_time());
        });
        // A little stronger under the pointer (its shade is its own, `_shade`, so the stylesheet's hover is not it).
        number.connect('notify::hover', () => {
            const i = this._indexOf(number);
            if (i >= 0)
                this._shade(number, i);
        });
        number._delegate = {
            handleDragOver: source => {
                const i = this._indexOf(number);
                return i < 0 ? DND.DragMotionResult.CONTINUE : dropOn(source, i, false);
            },
            acceptDrop: source => {
                const i = this._indexOf(number);
                return i < 0 ? false : dropOn(source, i, true);
            },
        };
        const slot = new St.Bin({child: number, y_align: Clutter.ActorAlign.CENTER});
        number._slot = slot;
        return number;
    }

    /** One number per workspace, added or taken away at once (no animation: Panel Island's capsule takes the new width
     * in the same moment); labelled and watched anew. */
    _resize() {
        if (!this._slotsBox)
            return;
        const n = global.workspace_manager.n_workspaces;
        while (this._numbers.length < n) {
            const number = this._makeNumber();
            this._numbers.push(number);
            this._slotsBox.add_child(number._slot);
        }
        while (this._numbers.length > n) {
            this._numbers.pop()._slot.destroy();
        }
        // Labels and the room before each (none before the first).
        this._numbers.forEach((number, i) => {
            number._label.text = `${i + 1}`;
        });
        this._unwatch();
        for (let i = 0; i < n; i++) {
            const workspace = global.workspace_manager.get_workspace_by_index(i);
            workspace.connectObject('window-added', () => this._sync(), 'window-removed', () => this._sync(), this);
            this._watched.push(workspace);
        }
        this._sync();
    }

    /** Each button's look: shown, holding windows, wanting attention, under a window being dragged. */
    _sync() {
        // Off (no button of its own now): nothing to draw.
        if (!this._button)
            return;
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
            this._shade(number, i);
        });
    }

    /** A number's circle: a neutral shade, white-grey on dark glass and grey-dark on light, stronger for a workspace in
     * use (holding windows) than for an empty one (GNOME's spare last), and stronger as the glass is (`setStrength`).
     * The shown one: its pill filled in the accent (the stylesheet's), no circle; one a window is dragged onto: the
     * stylesheet's own highlight. */
    _shade(number, i) {
        const workspace = global.workspace_manager.get_workspace_by_index(i);
        const {_dot: dot, _pill: pill} = number;
        if (!dot || !pill)
            return;
        const shown = Boolean(workspace?.active);
        // The accent pill on the shown one, the circle on every other one: at once, no animation.
        pill.opacity = shown ? 255 : 0;
        dot.opacity = shown ? 0 : 255;
        if (!workspace || shown)
            return;
        // Under a window being dragged: the stylesheet's own highlight colour, on the circle.
        if (this._hot === i) {
            dot.style = `background-color: ${this._light ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.3)'};`;
            return;
        }
        const t = Math.max(0, Math.min(1, this._strength / 100));
        const used = occupied(workspace);
        let alpha = this._light
            ? (used ? 0.10 + 0.06 * t : 0.04 + 0.03 * t)
            : (used ? 0.16 + 0.10 * t : 0.05 + 0.05 * t);
        if (number.hover)
            alpha += 0.06;
        const ink = this._light ? '0, 0, 0' : '255, 255, 255';
        dot.style = `background-color: rgba(${ink}, ${alpha.toFixed(3)});`;
    }

    /** The glass's strength (0 clear to 100 strong, as Panel Island's), the shades following it. */
    setStrength(strength) {
        const next = Number.isFinite(strength) ? strength : 50;
        if (next === this._strength)
            return;
        this._strength = next;
        this._sync();
    }

    /** Light or dark as Island Menu's Style says (stylesheet.css), whatever the capsule they sit in. */
    setLight(light) {
        const changed = light !== this._light;
        this._light = light;
        this._syncLight();
        if (changed)
            this._sync();
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
