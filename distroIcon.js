// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Ritesh Seth
//
// Settings → Top bar icon: the logo of the system Island Menu runs on, in black and white as the bar's text is (black
// on light, white on dark), found on the system itself rather than shipped with Island Menu:
//
//  1. its own symbolic logo, which the theme colours as it colours text: the logo /etc/os-release names
//     (`LOGO=ubuntu-logo` → `ubuntu-logo-symbolic`), the `<id>-logo-symbolic` one, or the theme's
//     `distributor-logo-symbolic` (Yaru's is Ubuntu's circle of friends);
//  2. else its colour logo (`LOGO`, as an icon of the theme or a file in /usr/share/pixmaps), drawn in one colour:
//     its colour the ink, its white (a letter or a figure cut out of it) left see-through;
//  3. else the app grid.

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {shaderEffect} from './glass/shader.js';

/** A key of /etc/os-release (`LOGO`, `ID`), or ''. */
function osInfo(key) {
    try {
        return GLib.get_os_info(key) ?? '';
    } catch {
        return '';
    }
}

/**
 * What to draw: `{gicon, mono}`; `mono` when it is a colour logo to be drawn in one colour (`MonoEffect`), not a
 * symbolic one the theme colours itself.
 */
export function distroIcon() {
    const theme = new St.IconTheme();
    const logo = osInfo('LOGO');
    const id = osInfo('ID');
    const symbolic = [logo && `${logo}-symbolic`, id && `${id}-logo-symbolic`, 'distributor-logo-symbolic']
        .filter(Boolean).find(name => theme.has_icon(name));
    if (symbolic)
        return {gicon: new Gio.ThemedIcon({name: symbolic}), mono: false};
    if (logo) {
        if (theme.has_icon(logo))
            return {gicon: new Gio.ThemedIcon({name: logo}), mono: true};
        for (const ext of ['svg', 'png']) {
            const file = Gio.File.new_for_path(`/usr/share/pixmaps/${logo}.${ext}`);
            if (file.query_exists(null))
                return {gicon: new Gio.FileIcon({file}), mono: true};
        }
    }
    return {gicon: new Gio.ThemedIcon({name: 'view-app-grid-symbolic'}), mono: false};
}

/** A colour logo drawn in one colour, `ink` (the bar's text colour): how dark each of its pixels is, as how much ink
 * (its colour solid, its white see-through), so a letter or figure in white stays cut out of it. */
const MonoEffect = shaderEffect('DistroMono', {ink: 3}, `
    vec4 c = cogl_color_out;
    vec3 rgb = c.a > 0.0 ? c.rgb / c.a : vec3(0.0);
    float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    float a = c.a * clamp((1.0 - lum) * 1.6, 0.0, 1.0);
    cogl_color_out = vec4(ink * a, a);
`);

/**
 * An St.Icon showing the system's logo (see above), black or white as the text round it: a symbolic one by the theme,
 * a colour one by `MonoEffect`, following the icon's own text colour as it changes (light or dark bar).
 */
export function makeDistroIcon(props = {}) {
    const {gicon, mono} = distroIcon();
    const icon = new St.Icon({...props, gicon});
    if (!mono)
        return icon;
    const effect = new MonoEffect();
    effect.setUniforms({ink: [1, 1, 1]});
    icon.add_effect_with_name('island-menu-mono', effect);
    const sync = () => {
        try {
            const c = icon.get_theme_node().get_foreground_color();
            effect.setUniforms({ink: [c.red / 255, c.green / 255, c.blue / 255]});
        } catch {}
    };
    icon.connect('style-changed', sync);
    icon.connect('notify::mapped', sync);
    return icon;
}
