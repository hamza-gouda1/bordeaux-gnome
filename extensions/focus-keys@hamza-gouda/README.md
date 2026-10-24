# Focus Keys

A GNOME Shell 46 extension for app shortcuts that behave like the dock: press
the shortcut and the app comes to the front if it is already open (on any
workspace, unminimized if needed), or starts if it is not. Press it again while
the app has the focus and it moves to the app's next window.

## Why

A custom shortcut in Settings runs a command, typically `gtk-launch app` or a
launcher script. On Wayland that command has no activation token, so when the
app is already running GNOME will not let it take the focus and shows an
"*App* is ready" notification instead. Focus Keys has the shell itself raise
the window (the same call the dock and Alt+Tab use) and, when the app is not
running, the shell starts it, so the new window gets the focus too.

## Shortcuts

One GSettings key, `bindings`, holds every shortcut as `ACCELERATOR=desktop-id`:

```
<Control>F9=spotify.desktop
XF86Launch3=io.github.hamzagouda.TufControl.desktop
<Shift><Super>XF86TouchpadOff=org.gnome.Calculator.desktop
```

The accelerator uses the GTK syntax that Settings shows. The desktop id is the
file name of the app's `.desktop` file (in `~/.local/share/applications`,
`/usr/share/applications`, or the Flatpak and Snap export folders). The first
entry for a key wins. `cycle-windows` (default on) controls the cycling.

Change them in the Extensions app (Focus Keys > Settings): add with **+**, pick
the app, then press the shortcut. A key that something else already grabs
cannot be pressed in that window; type its name instead (for example
`XF86Launch1`). Or from a terminal:

```bash
dir=~/.local/share/gnome-shell/extensions/focus-keys@hamza-gouda/schemas
GSETTINGS_SCHEMA_DIR=$dir gsettings set org.gnome.shell.extensions.focus-keys bindings \
  "['<Control>F9=spotify.desktop']"
```

A key that a GNOME custom shortcut also uses is not bound (the shell gives each
key to one owner): remove the custom shortcut first. `install.sh` does that
check for its defaults and skips a key that is taken. A missing app shows a
short on-screen message and a line in the journal.

## Install

`install.sh` in the repository root installs and enables it and adds
`<Control>F9=spotify.desktop` (skip all of it with `--no-shortcuts`). It starts
after you log out and back in. `uninstall.sh` removes only the shortcuts it
added and the extension.

## How

Each entry is grabbed with `global.display.grab_accelerator()`, the call the
shell uses for gnome-settings-daemon's custom shortcuts, and allowed in the
normal and overview modes. One `accelerator-activated` handler serves all of
them, so any number of shortcuts fit in the single key. `disable()` ungrabs
every key and disconnects every handler.

Tests: `gjs -m tests/test_focus_keys.js` (parsing, window choice, full
enable/reload/disable lifecycle with fakes) and the `focus-keys` scene of
`tools/shell_qa.py`, which presses real key combinations in a headless shell.

GPL-3.0-or-later. Hamza Gouda.
