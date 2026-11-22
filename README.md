# Island Menu

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-51-blue.svg)](https://gnome.org)
[![License](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](LICENSE)
[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?style=flat&logo=github-sponsors)](https://github.com/sponsors/ritesh-777)

A launcher, window switcher and workspace companion for the GNOME top bar.

Island Menu opens from its button in the top bar, a shortcut, the Super key or Alt+Tab, without going into the
overview. It opens on the windows you have open, and finds apps, Settings pages, system actions and files as you
type, even misspelt. A Shelf keeps the files, folders, links and snippets you want at hand.

It is made to sit beside [Panel Island](https://github.com/ritesh-777/panel-island), and works on its own too. With
Panel Island, the menu grows out of the left capsule as one piece of glass, and its workspace features live in that
capsule.

## Quick Links

- [Requirements](#requirements)
- [Installation](#installation)
- [Using It](#using-it)
- [Settings](#settings)
- [Working With Panel Island](#working-with-panel-island)
- [Troubleshooting](#troubleshooting)
- [Acknowledgments](#acknowledgments)

## What You Get

- **Your open windows first**: the menu opens on every open window, most recently used first, across all
  workspaces. Pick one to go straight to it, keyboard focus included.
- **Search that forgives typos**: apps, GNOME Settings pages and system actions as you type, matched on names,
  keywords, descriptions and categories, so "browser" finds every browser and "blutooth" still finds Bluetooth.
- **Settings pages**: type "bluetooth", "wallpaper" or "battery" and open Settings directly on that page.
- **System actions**: Power Off, Restart, Lock, Log Out, Suspend, through GNOME's own confirmation.
- **Files**: `~ ` searches your files, and finds misspelt names too.
- **Alt+Tab and Super+Tab** (optional): hold Alt or Super, press Tab to step through your windows, let go to switch.
- **Close and Kill**: close an app or a window from the menu, or force-quit one that hangs.
- **A light for what is open**: beside each open app, and beside the menu's button, so nothing is shut down by
  accident.
- **Favourites**: a star on every app, shared with your dock.
- **The Shelf**: files, folders, links, apps and text you keep at hand, with drag and drop.
- **Drag out of the menu**: an app, a file or a window onto a workspace, the Shelf, or the desktop.
- **Workspaces** (with Panel Island): a live peek of every workspace, workspace numbers, drag to workspaces, and an
  attention glow.
- **Opens itself on empty workspaces** (optional), and closes again as a window opens.
- **Your system's logo** as its button, black or white as the bar is.

## Requirements

- **GNOME Shell 51**

Optional:

- [Panel Island](https://github.com/ritesh-777/panel-island): the menu grows out of its left capsule, and the workspace
  peek, drag onto the capsule and the attention glow are drawn on its glass.
- GNOME LocalSearch (installed with GNOME): for file search.

## Installation

### One-Line Install

```bash
curl -fsSL https://raw.githubusercontent.com/ritesh-777/island-menu/main/install.sh | bash
```

Then log out and back in, and enable the extension:

```bash
gnome-extensions enable island-menu@ritesh
```

Running the same command again updates it to the latest version.

### Local Install

```bash
git clone https://github.com/ritesh-777/island-menu.git
cd island-menu
./install.sh
```

Log out and back in, then enable it from the Extensions app.

### Uninstalling

```bash
gnome-extensions disable island-menu@ritesh
rm -rf ~/.local/share/gnome-shell/extensions/island-menu@ritesh
```

## Using It

Open it from its button in the top bar, Super+Space, the Super key or Alt+Tab (each as set in Settings).

- **Nothing typed**: your open windows. Arrow keys or the pointer to choose, Enter or a click to go there.
- **Type a name**: apps, Settings pages and system actions. An app with several windows open lists them under it.
- **`* `**: every app, favourites first. **`* text`** searches them.
- **`~ text`**: files and folders.
- **`= 2*(3+4)`**: a calculator; Enter copies the result.
- **`? text`**: a web search.
- **`# `**: the Shelf.

On a row:

- **Star**: a favourite (GNOME's own, as the dock has them).
- **New window**: another window of the app, for apps that have more than one.
- **Close (✕)**: closes the window, or quits the app as its own Quit does (it may ask to save).
- **Kill**: ends the app's process at once, for one that hangs; click twice, as it asks "Sure?" first. Anything
  unsaved in it is lost.

Drag a row out of the menu and the menu steps aside: let go on a workspace (with Panel Island, in the peek that
opens), a gap between workspaces (a new one there), the Shelf's tile, or anywhere on the desktop.

## Settings

Open the Extensions app, find **Island Menu**, and click the settings button. Settings take effect at once.

### Opening

- **At login** — GNOME's overview, the desktop, or the desktop with the menu open.
- **Open on empty workspaces** — The menu opens by itself on a workspace with no windows, and closes as one opens.
  Turn off Foresight Reborn (which opens the overview instead) for this.
- **Alt+Tab and Super+Tab open the menu** — Hold Alt or Super and press Tab to step through your windows, let go to
  switch. Only the shortcuts' handler inside GNOME Shell is changed, never a keyboard setting: off, or Island Menu
  off, GNOME's own switchers have them again.
- **Super key opens the menu** — Instead of the overview, which stays on the Activities button and Super+A.
- **Keyboard shortcut** — Super+Space by default.
- **Search field** — at the top (default) or the bottom of the launcher: below the results and the hints, nearest
  its bottom edge (good with the launcher at the bottom of the screen).
- **Highlight style** — how the focused search field and the chosen app look: Classic (default), Glass lens, Accent
  capsule or Minimal edge, each with its own look on light glass.
- **Launcher opens at** — out of Panel Island's left capsule (default) or its middle one (the clock's, centred on
  it; the left one while there is no middle capsule, as with Isle's island at the top), with the bar at the top or
  the bottom; or a place of its own: top left or top middle (coming down),
  the centre of the screen (opening out), bottom left or bottom middle (rising up), with its own glass there.
- **Glass during workspace switches** — the menu's own glass as a switch slides under it (the menu kept open on
  empty workspaces), set apart from Panel Island's for its glass: held still (default, lightest), held still on
  battery only, live, or live at half resolution.
- **Top bar button**, **Top bar icon** (your system's logo, or the app grid) and **Top bar button placement**
  (before or after the workspaces, or in the middle before the clock: Panel Island's middle capsule, where it is shown).

### Workspaces

In Panel Island's left capsule.

- **Workspace numbers** — One button per workspace. Click one to go there; drop a window, an app or a file on one.
- **Drag to workspaces** — Hold a window by its title bar, or an app icon or a file, over the capsule: the peek
  opens. Let go on a workspace to send it there, or in a gap between two to make a new workspace there.
- **Workspace peek** and **Peek delay** — Rest the pointer on the workspace buttons or the menu's button: a live
  preview of each workspace, with the Shelf as the first tile.
- **Attention glow**, **Glow width** and **Pulse** — The capsule's edge glows while a window on another workspace
  asks for attention.

### Look

- **Style** — Follow GNOME, Light or Dark. The workspace peek and numbers follow it too.
- **Animations** and **Dim the screen**.

### Search

- **Web search engine** and **Uninstall from the menu**.

### Shelf

- **Shelf**, **Shelf in the menu**, **Keep after logging out**, **Shelf size**, **Notifications** and **Clear the
  Shelf**.

## Working With Panel Island

Each works without the other. Together:

- The menu grows out of Panel Island's left capsule as one piece of glass, and shrinks back into it.
- The workspace peek, drag onto the capsule and the attention glow appear; without Panel Island they are off, and the
  workspace numbers still work as a button of their own.
- Either can be turned on first: each finds the other as it starts.

## Troubleshooting

### The extension does not appear

1. Check the folder is at `~/.local/share/gnome-shell/extensions/island-menu@ritesh/`
2. Recompile the schema:
   `glib-compile-schemas ~/.local/share/gnome-shell/extensions/island-menu@ritesh/schemas/`
3. Log out and back in

### New settings do not show up

Close the Extensions app and open it again: it keeps the old settings window until it is restarted.

### File search finds nothing

File search uses GNOME's file index (LocalSearch). Check that it is indexing your folders in Settings → Search →
Search Locations.

### Something looks wrong

Check the log for Island Menu's lines:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep island-menu
```

## Support

If Island Menu has made your desktop nicer, consider supporting its development:

- [Sponsor on GitHub Sponsors](https://github.com/sponsors/ritesh-777)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the GNU General Public License v3.0 or later — see the [LICENSE](LICENSE) file for
details.

## Acknowledgments

- [Isle](https://github.com/zickrian/isle) by zickrian (GPL-3.0-or-later): the glass in `glass/` is copied from Isle
  1.7.3, for the menu's own glass when Panel Island is not running.
- [Foresight Reborn](https://github.com/gabrielpalassi/ForesightReborn) (GPL-3.0-or-later): what counts as a window,
  and its list of apps' splash and updater windows, in `emptyWorkspaces.js`.
- GNOME Shell's own system actions, Settings pages and file index, which the search reads rather than copies.
- GNOME Shell Extensions framework
