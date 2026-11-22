// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// Settings → Clock: a clock at the left of the menu's power row, in one of two styles: flip digits (a changed digit
// flipping over, AM and PM stacked beside them), or the time beside a small sun (or moon) on its arc across the day,
// its colours those of the hour (golden, blue, night). The date after it, then the next event of GNOME's calendar
// today ("Standup · 12 min", within the hour), and a moon while Do Not Disturb is on. It runs only while the menu is
// open: its wall clock and the calendar followed then, nothing at all while it is closed.

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/** A digit's flip: down to its edge, then open again with the new one. */
const FLIP_DOWN_MS = 110;
const FLIP_UP_MS = 170;
/** Golden hour: this long before sunset and after sunrise; blue hour: this long after sunset and before sunrise. */
const GOLDEN_MIN = 45;
const BLUE_MIN = 30;
/** The sun's day without a weather location. */
const DEFAULT_SUNRISE_H = 6, DEFAULT_SUNSET_H = 18;
const SUN_COLOURS = {
    day: {body: [0.98, 0.78, 0.46], arc: null},
    golden: {body: [0.85, 0.35, 0.19], arc: [0.94, 0.62, 0.15]},
    blue: {body: [0.22, 0.54, 0.87], arc: [0.52, 0.72, 0.92]},
    night: {body: [0.71, 0.83, 0.96], arc: [0.71, 0.83, 0.96]},
};
/** The next event shows from this long before it until a minute after it starts. */
const EVENT_LEAD_MIN = 60;
/** An event's name, at most this long. */
const EVENT_CHARS = 14;
const DAY_MS = 86400000;

const animating = () => St.Settings.get().enable_animations;

/** Whether `event` lasts whole days (GNOME's calendar marks none as such: from a midnight, a day or more). */
const allDay = event => event.date.getHours() === 0 && event.date.getMinutes() === 0 &&
    event.end - event.date >= DAY_MS - 60000;

/** A label never cut short with "…". */
function label(props) {
    const actor = new St.Label(props);
    actor.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    return actor;
}

/** GNOME's own weather (its calendar's): where the sun rises and sets, or null. */
const weatherClient = () => Main.panel.statusArea.dateMenu?._weatherItem?._weatherClient ?? null;

export class MenuClock {
    /** `settings`: Island Menu's (`menu-clock`: 'off', 'flip', 'sun'). */
    constructor(settings) {
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this.actor = new St.BoxLayout({style_class: 'island-menu-clock', y_align: Clutter.ActorAlign.CENTER,
            reactive: false});
        this._token = {};
        this._running = false;
        this._style = null;
    }

    /** 'flip', 'sun', or null (off). */
    get style() {
        let style = 'flip';
        try {
            style = this._settings.get_string('menu-clock');
        } catch {}
        return style === 'sun' || style === 'flip' ? style : null;
    }

    /** The menu opening: shown as it is now, then followed minute by minute while it stays open. */
    start() {
        this.actor.visible = Boolean(this.style);
        if (!this.style)
            return;
        try {
            this._rebuild();
            this._render(false);
            if (this._running)
                return;
            this._running = true;
            this._wall = new GnomeDesktop.WallClock({time_only: true});
            this._wall.connectObject('notify::clock', () => this._safely(() => this._render(true)), this._token);
            this._interface.connectObject('changed::clock-format', () => this._safely(() => {
                this._rebuild();
                this._render(false);
            }), this._token);
            this._notifications.connectObject('changed::show-banners', () => this._syncDnd(), this._token);
            Main.panel.statusArea.dateMenu?._eventSource?.connectObject?.('changed',
                () => this._safely(() => this._syncEvent()), this._token);
        } catch (e) {
            console.error(`[island-menu] The clock failed, left out: ${e}\n${e.stack}`);
            this.stop();
            this.actor.visible = false;
        }
    }

    /** The menu closed: nothing followed until it opens again. */
    stop() {
        if (!this._running)
            return;
        this._running = false;
        this._wall?.disconnectObject(this._token);
        this._wall = null;
        this._interface.disconnectObject(this._token);
        this._notifications.disconnectObject(this._token);
        try {
            Main.panel.statusArea.dateMenu?._eventSource?.disconnectObject?.(this._token);
        } catch {}
    }

    /** Settings → Clock changed: laid out again in its style, or hidden. */
    restyle() {
        if (this._running || !this.style)
            this.stop();
        this.actor.visible = Boolean(this.style);
        if (this.style)
            this.start();
    }

    destroy() {
        this.stop();
        this.actor.destroy();
    }

    _safely(fn) {
        try {
            fn();
        } catch (e) {
            console.error(`[island-menu] The clock failed, left out: ${e}`);
            this.stop();
            this.actor.visible = false;
        }
    }

    get _twelve() {
        return this._interface.get_string('clock-format') === '12h';
    }

    /** What it shows now: `digits` ('9:41' or '09:41'), `meridiem` ('AM', 'PM' or null), `date` ('Mon 23'). */
    _model() {
        const now = GLib.DateTime.new_now_local();
        const h = now.get_hour(), mm = String(now.get_minute()).padStart(2, '0');
        const date = now.format('%a %e').replace(/\s+/g, ' ');
        if (!this._twelve)
            return {digits: `${String(h).padStart(2, '0')}:${mm}`, meridiem: null, date};
        return {digits: `${h % 12 || 12}:${mm}`, meridiem: h < 12 ? 'AM' : 'PM', date};
    }

    /** Laid out anew for its style (its parts; their text comes in `_render`). */
    _rebuild() {
        const face = this.actor;
        face.destroy_all_children();
        this._tiles = this._tileFor = this._sun = this._time = this._meridiem = null;
        this._date = this._event = this._eventText = this._moon = null;
        const flip = this.style === 'flip';
        this._style = this.style;
        face.style_class = `island-menu-clock ${flip ? 'island-menu-clock-flip' : 'island-menu-clock-sun'}`;
        const model = this._model();
        if (flip) {
            this._tiles = new St.BoxLayout({style_class: 'island-menu-clock-tiles', y_align: Clutter.ActorAlign.CENTER});
            this._tileFor = [];
            for (const char of model.digits) {
                if (char === ':') {
                    this._tiles.add_child(label({style_class: 'island-menu-clock-colon', text: ':',
                        y_align: Clutter.ActorAlign.CENTER}));
                    this._tileFor.push(null);
                    continue;
                }
                const tile = this._tile(char);
                this._tiles.add_child(tile);
                this._tileFor.push(tile);
            }
            face.add_child(this._tiles);
            if (model.meridiem) {
                // AM over PM, the one it is now bright.
                this._meridiem = new St.BoxLayout({style_class: 'island-menu-clock-stack',
                    orientation: Clutter.Orientation.VERTICAL, y_align: Clutter.ActorAlign.CENTER});
                this._meridiem._am = label({style_class: 'island-menu-clock-stack-label', text: 'AM'});
                this._meridiem._pm = label({style_class: 'island-menu-clock-stack-label', text: 'PM'});
                this._meridiem.add_child(this._meridiem._am);
                this._meridiem.add_child(this._meridiem._pm);
                face.add_child(this._meridiem);
            }
        } else {
            this._sun = new St.DrawingArea({style_class: 'island-menu-clock-arc', y_align: Clutter.ActorAlign.CENTER});
            this._sun.connect('repaint', area => this._paintSun(area));
            face.add_child(this._sun);
            this._time = label({style_class: 'island-menu-clock-time', y_align: Clutter.ActorAlign.CENTER});
            face.add_child(this._time);
            if (model.meridiem) {
                this._meridiem = label({style_class: 'island-menu-clock-meridiem', y_align: Clutter.ActorAlign.CENTER,
                    opacity: 190});
                face.add_child(this._meridiem);
            }
        }
        // Softer than the time (St's style has no opacity of its own).
        this._date = label({style_class: 'island-menu-clock-date', y_align: Clutter.ActorAlign.CENTER, opacity: 165});
        face.add_child(this._date);
        this._event = new St.BoxLayout({style_class: 'island-menu-clock-event', y_align: Clutter.ActorAlign.CENTER,
            visible: false});
        this._event.add_child(new St.Widget({style_class: 'island-menu-clock-event-dot',
            y_align: Clutter.ActorAlign.CENTER}));
        this._eventText = label({style_class: 'island-menu-clock-event-text', y_align: Clutter.ActorAlign.CENTER});
        this._event.add_child(this._eventText);
        face.add_child(this._event);
        this._moon = new St.Icon({style_class: 'island-menu-clock-dnd', icon_name: 'weather-clear-night-symbolic',
            visible: false});
        face.add_child(this._moon);
    }

    /** A flip tile showing `char`. */
    _tile(char) {
        const digit = label({style_class: 'island-menu-clock-tile-label', text: char,
            x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER});
        digit.set_pivot_point(0.5, 0.5);
        const tile = new St.Bin({style_class: 'island-menu-clock-tile', child: digit, y_align: Clutter.ActorAlign.CENTER});
        tile._label = digit;
        return tile;
    }

    /** The time as it is now; `flip`: changed digits flip over (a new minute), else set at once. */
    _render(flip) {
        if (!this.style)
            return;
        if (this.style !== this._style)
            this._rebuild();
        const model = this._model();
        // A different shape of digits (9:59 to 10:00): laid out anew.
        if (this._tiles && model.digits.length !== this._tileFor.length) {
            this._rebuild();
            flip = false;
        }
        if (this._tiles) {
            [...model.digits].forEach((char, i) => {
                const tile = this._tileFor[i];
                if (tile && tile._label.text !== char)
                    this._flipTo(tile, char, flip);
            });
        }
        if (this._time)
            this._time.text = model.digits;
        if (this._meridiem && model.meridiem) {
            if (this._meridiem._am) {
                const pm = model.meridiem === 'PM';
                this._meridiem._am.opacity = pm ? 80 : 255;
                this._meridiem._pm.opacity = pm ? 255 : 80;
            } else {
                this._meridiem.text = model.meridiem;
            }
        }
        if ((this._meridiem !== null) !== Boolean(model.meridiem)) {
            // 12 or 24 hours changed under it.
            this._rebuild();
            this._render(false);
            return;
        }
        this._date.text = model.date;
        this._sun?.queue_repaint();
        this._syncEvent();
        this._syncDnd();
    }

    /** `tile` to `char`: folded flat and opened again with it, or set at once. */
    _flipTo(tile, char, flip) {
        const digit = tile._label;
        digit.remove_all_transitions();
        if (!flip || !animating() || !digit.mapped) {
            digit.scale_y = 1;
            digit.text = char;
            return;
        }
        digit.ease({
            scale_y: 0, duration: FLIP_DOWN_MS, mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: finished => {
                digit.text = char;
                if (!finished) {
                    digit.scale_y = 1;
                    return;
                }
                digit.ease({scale_y: 1, duration: FLIP_UP_MS, mode: Clutter.AnimationMode.EASE_OUT_QUAD});
            },
        });
    }

    /** The next event of GNOME's calendar today with a time of day, from an hour before it to a minute after. */
    _nextEvent() {
        const source = Main.panel.statusArea.dateMenu?._eventSource;
        if (typeof source?.getEvents !== 'function')
            return null;
        const now = new Date();
        const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const at = now.getTime();
        return source.getEvents(day, new Date(day.getTime() + DAY_MS))
            .filter(event => !allDay(event))
            .sort((a, b) => a.date - b.date)
            .find(event => event.date.getTime() > at - 60000 && event.date.getTime() - at <= EVENT_LEAD_MIN * 60000) ??
            null;
    }

    _syncEvent() {
        if (!this._event)
            return;
        let next = null;
        try {
            next = this._nextEvent();
        } catch {}
        this._event.visible = Boolean(next);
        if (!next)
            return;
        const minutes = Math.ceil((next.date.getTime() - Date.now()) / 60000);
        const name = (next.summary ?? '').trim() || 'Event';
        const short = name.length > EVENT_CHARS ? `${name.slice(0, EVENT_CHARS - 1).trimEnd()}…` : name;
        this._eventText.text = `${short} · ${minutes <= 0 ? 'now' : `${minutes} min`}`;
        if (minutes <= 0)
            this._event.add_style_class_name('island-menu-clock-event-now');
        else
            this._event.remove_style_class_name('island-menu-clock-event-now');
    }

    _syncDnd() {
        if (this._moon)
            this._moon.visible = !this._notifications.get_boolean('show-banners');
    }

    /** Today's sunrise and sunset (unix seconds): GNOME's weather place's, else 6 and 18 o'clock. */
    _sunTimes(now) {
        try {
            const client = weatherClient();
            const info = client?.available && client.hasLocation ? client.info : null;
            const [hasRise, rise] = info?.get_value_sunrise?.() ?? [false, 0];
            const [hasSet, set] = info?.get_value_sunset?.() ?? [false, 0];
            if (hasRise && hasSet && set > rise) {
                // For the day it last fetched: moved to today, keeping their time of day.
                const shift = Math.floor((now - rise) / 86400) * 86400;
                return {rise: rise + shift, set: set + shift};
            }
        } catch {}
        const today = GLib.DateTime.new_now_local();
        const at = h => GLib.DateTime.new_local(today.get_year(), today.get_month(), today.get_day_of_month(), h, 0, 0)
            .to_unix();
        return {rise: at(DEFAULT_SUNRISE_H), set: at(DEFAULT_SUNSET_H)};
    }

    /** Where the sun is: `phase` (day, golden, blue, night), `t` 0..1 along the arc (the day's, or the night's). */
    _sunState() {
        const now = GLib.DateTime.new_now_local().to_unix();
        const {rise, set} = this._sunTimes(now);
        const min = 60;
        if (now >= rise && now <= set) {
            const golden = now >= set - GOLDEN_MIN * min || now <= rise + GOLDEN_MIN * min;
            return {phase: golden ? 'golden' : 'day', t: (now - rise) / (set - rise), up: true};
        }
        const from = now > set ? set : set - 86400;
        const to = now > set ? rise + 86400 : rise;
        const blue = now <= from + BLUE_MIN * min || now >= to - BLUE_MIN * min;
        return {phase: blue ? 'blue' : 'night', t: (now - from) / Math.max(1, to - from), up: false};
    }

    _paintSun(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const fg = area.get_theme_node().get_foreground_color();
        const ink = [fg.red / 255, fg.green / 255, fg.blue / 255];
        const s = Math.max(1, w / 30);
        const {phase, t, up} = this._sunState();
        const colours = SUN_COLOURS[phase];
        const cx = w / 2, cy = h - 3 * s, r = Math.min(w / 2 - 3 * s, h - 6 * s);
        // The horizon, and the arc dashed above it.
        cr.setLineWidth(Math.max(1, 0.8 * s));
        cr.setSourceRGBA(...(colours.arc ?? ink), colours.arc ? 0.55 : 0.3);
        cr.moveTo(1 * s, cy);
        cr.lineTo(w - 1 * s, cy);
        cr.stroke();
        cr.setDash([2 * s, 2 * s], 0);
        cr.setSourceRGBA(...(colours.arc ?? ink), colours.arc ? 0.8 : 0.35);
        cr.arc(cx, cy, r, Math.PI, 2 * Math.PI);
        cr.stroke();
        cr.setDash([], 0);
        const angle = Math.PI * (1 - Math.max(0, Math.min(1, t)));
        const x = cx + r * Math.cos(angle), y = cy - r * Math.sin(angle);
        const body = 2.6 * s;
        cr.setSourceRGBA(...colours.body, 1);
        if (up || phase === 'blue') {
            cr.arc(x, y, body, 0, 2 * Math.PI);
            cr.fill();
        } else {
            // A crescent: the disc less one a little to its side.
            cr.setFillRule(Cairo.FillRule.EVEN_ODD);
            cr.arc(x, y, body, 0, 2 * Math.PI);
            cr.newSubPath();
            cr.arc(x + body * 0.7, y - body * 0.35, body * 0.85, 0, 2 * Math.PI);
            cr.clip();
            cr.arc(x, y, body, 0, 2 * Math.PI);
            cr.fill();
            cr.resetClip();
        }
        cr.$dispose();
    }
}
