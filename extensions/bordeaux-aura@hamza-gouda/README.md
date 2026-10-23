# Bordeaux Aura

A small GNOME Shell 46 extension that puts a faint glow, in each app's own
colour, behind the icons of Ubuntu Dock (or Dash to Dock). The icons
themselves are never recoloured or restyled.

## How it works

- **Colour.** The app's icon is loaded at 64 px or smaller. Pixels that are
  almost transparent, almost white or almost black are skipped. The rest are
  weighted the Unity way (`0.1·255·α + 0.9·α·saturation`), and the strongest
  band of a hue histogram wins, so two-tone icons don't average into mud.
  This runs in a low-priority idle, two icons per tick. Results are cached
  per icon theme and app id, and the cache is cleared when the icon theme
  changes. Symbolic-only icons fall back to a neutral, accent-tinted glow.
- **Clamps (OKLCH).** L is 0.62–0.74 on dark and 0.66–0.76 on light. C is
  capped at 0.12 / 0.11. The hue is then pulled 15% toward the accent in
  OKLab. Alpha runs from 0.10 to 0.34 on dark (0.14 to 0.46 on light) as the
  icon's chroma rises, and is capped at 0.55. Grey icons stay at the minimum.
- **States.** Focused ×1.3, hover ×1.6 (the `hover-boost` key), pressed
  ×0.8, pinned-but-not-running ×0.7. The glow's style is painted once at
  its strongest state. States only ease the actor's opacity over 200 ms, so
  the shadow is never re-rendered and nothing runs per frame.
- **Actors.** One `St.Widget` disc (0.55× the icon size, with a blurred
  halo) per dock item, at index 0 of the dock's `DashItemContainer`, below
  the app icon. It is not put inside the icon's `_iconContainer`, because the
  dock indexes those children and restyles them in backlit mode.
- **Dock hook.** It reads `dockManager`, exported by the dock's
  `extension.js`, and listens to `extension-state-changed`, the manager's
  `toggled` (fired when docks are rebuilt), each dash box's `child-added`,
  and `icon-size-changed`. If the dock is missing or disabled, it waits.

## Settings

| Key | Default | |
|---|---|---|
| `enabled` | `true` | |
| `intensity` | `38` | 0–100; 38 gives the design-spec alphas |
| `hover-boost` | `1.6` | |
| `only-on-hover` | `false` | |
| `blur-radius` | `22` | halo blur at 48 px icons |
| `accent` | `'#8E2A44'` | Bordeaux; Oxblood Noir `#A3283A`, Merlot Day `#7A1C34` |
| `theme-mode` | `'auto'` | `auto` uses light clamps only for `prefer-light` |

## Install

```bash
dest=~/.local/share/gnome-shell/extensions/bordeaux-aura@hamza-gouda
mkdir -p "$dest" && cp -r extensions/bordeaux-aura@hamza-gouda/. "$dest"
glib-compile-schemas "$dest/schemas"
# Wayland: log out and back in so the Shell discovers the new extension.
gnome-extensions enable bordeaux-aura@hamza-gouda
# Optional, per variant:
gsettings --schemadir "$dest/schemas" set \
  org.gnome.shell.extensions.bordeaux-aura accent '#A3283A'
```

`gschemas.compiled` is a build product and is not committed.

## Tests

```bash
gjs -m tests/test_aura_colour.js
```

These cover the pure colour maths in `colour.js`. A nested session is the
way to see it live: `dbus-run-session -- gnome-shell --nested --wayland`.

License: GPL-3.0-or-later. © 2026 Hamza Gouda.
