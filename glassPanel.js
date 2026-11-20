// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// The launcher's glass when Panel Island is not drawing it: one rounded piece of the same glass as Panel Island's and
// Isle's (glass/, Isle's own glass copied), behind the launcher and following it. GNOME's own blur effect has no
// rounded corners (GNOME 51 still), which GNOME Essentials made up for with three blurred strips redrawn every 120 ms;
// this glass is cut to the rounded shape itself, and blurs again only what changed behind it.

import Meta from 'gi://Meta';
import St from 'gi://St';

import {GlassBackdrop} from './glass/glass.js';
import * as Theme from './glass/theme.js';

/** The glass's corner radius, in CSS px, and how dark it is (Isle's Glass tint, 0 clear to 100 dark). */
const RADIUS = 16;
const TINT = 45;
/** How deep its inner glow reaches from its edge, in CSS px. */
const REACH = 4;

const scale = () => St.ThemeContext.get_for_stage(global.stage).scale_factor;

/** The light look of the glass, the same as Panel Island's light glass (its light.js) at this glass's strength
 * (`TINT`): frosted, what is behind still showing through, its lightness lifted into lo + span × l (never held
 * darker), most of its colour kept. */
function lightBlur(blur) {
    const t = TINT / 100;
    return {...blur, brightness: 1, lo: 0.32 + 0.1 * t, span: 0.66 - 0.1 * t, gamma: 0.9, deep: 0, knee: 0,
        small: 1 - 0.1 * t, large: 1.05 - 0.1 * t, sheen: 0.04, glow: 0.05 - 0.01 * t, rim: (blur.rim ?? 0) * 0.6};
}

export class GlassPanel {
    /** Behind `actor` (the launcher), in `parent` (at the stage's origin); frosted light glass with `light`. */
    constructor(parent, actor, light = false) {
        this._light = light;
        Theme.setTheme('glass', TINT);
        this._actor = actor;
        this.backdrop = new GlassBackdrop();
        parent.insert_child_below(this.backdrop, actor);
        this._shown = false;
        this._later = 0;
        const follow = () => this._queue();
        actor.connectObject('notify::allocation', follow, 'notify::x', follow, 'notify::y', follow,
            'notify::scale-x', follow, 'notify::scale-y', follow, 'notify::translation-y', follow,
            'notify::opacity', () => (this.backdrop.opacity = actor.opacity),
            'notify::visible', () => this._sync(), this);
    }

    /** The glass's own tint, as CSS rgba(): for the launcher's background over it (a thin white frost, light). */
    static fillCss(light = false) {
        if (light)
            return `rgba(255, 255, 255, ${(0.16 + 0.12 * TINT / 100).toFixed(3)})`;
        Theme.setTheme('glass', TINT);
        const [r, g, b, a] = Theme.fill();
        const c = v => Math.round(v * 255);
        return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${a.toFixed(2)})`;
    }

    /** On (behind the launcher while it shows) or off (Panel Island draws the glass instead). */
    set enabled(on) {
        this._enabled = on;
        this._sync();
    }

    _sync() {
        const want = Boolean(this._enabled && this._actor.visible);
        if (want && !this._shown) {
            Theme.setTheme('glass', TINT);
            this.backdrop.look = this._light ? lightBlur(Theme.blur()) : Theme.blur();
            this._shown = true;
            this._place();
        } else if (!want && this._shown) {
            this.backdrop.look = null;
            this._shown = false;
        }
    }

    _queue() {
        if (!this._shown || this._later)
            return;
        this._later = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._later = 0;
            this._place();
            return false;
        });
    }

    /** Placed and cut to where the launcher is drawn now (its opening motion too). */
    _place() {
        if (!this._shown)
            return;
        const [x, y] = this._actor.get_transformed_position();
        const [width, height] = this._actor.get_transformed_size();
        if (width <= 0 || height <= 0)
            return;
        const s = scale();
        this.backdrop.set_position(Math.round(x), Math.round(y));
        this.backdrop.place({
            stageX: Math.round(x), stageY: Math.round(y), width: Math.round(width), height: Math.round(height),
            left: 0, right: Math.round(width), radius: RADIUS * s, crown: RADIUS * s, reach: REACH * s, open: 1,
        });
    }

    destroy() {
        this._actor?.disconnectObject(this);
        if (this._later)
            global.compositor.get_laters().remove(this._later);
        this._later = 0;
        if (this._shown)
            this.backdrop.look = null;
        this.backdrop.destroy();
        this._actor = null;
    }
}
