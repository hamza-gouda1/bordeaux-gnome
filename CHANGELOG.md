# Changelog

## [Unreleased]

First public version.

Light and dark follow the Dark Style switch:

- Toggling Dark Style used to change nothing: one variant was applied statically. Now `install.sh` sets `picture-uri` to Merlot Day and `picture-uri-dark` to the dark variant (with `--wallpaper`), installs both the light and the dark GNOME Terminal profile, and installs and enables `bordeaux-aura@hamza-gouda` with `follow-color-scheme` on and `dark-variant` from `--variant`. `--static` keeps the old single-variant install.
- Bordeaux Aura follows `color-scheme` (250 ms debounce, applied once at enable too): User Themes name, `gtk-theme` Yaru/Yaru-dark, the preset keys that differ between variants (blur pipelines merged, lock screen pipeline, aura accent, icon/cursor themes while ours), the dark wallpaper, the Terminal default profile (when it already is a Bordeaux one) and `~/.config/gtk-{3,4}.0/gtk.css` (when unedited). Values the user chose are never overwritten. Preferences: follow switch, dark variant. Its glow's `auto` mode now uses light clamps unless Dark Style is on.
- GTK reads only `~/.config/gtk-N.0/gtk.css`, at app start (GTK 3.24, 4.14 and libadwaita 1.5 never load a `gtk-dark.css` from there): apps take the new colours when restarted.
- `tools/build.py` writes `extensions/bordeaux-aura@hamza-gouda/variants/<Variant>.json`. Tests: `tests/test_theme_follow.js`, `tests/test_follow_json.py`, install tests (dry run, wallpapers, profiles, idempotence, uninstall, a hand-installed aura kept, `--static`), and the `color-scheme` shell QA scene with dark and light screenshots.

App shortcuts that raise the open window:

- New `focus-keys@hamza-gouda` extension (GNOME Shell 46). Shortcuts from one `bindings` key (`ACCELERATOR=desktop-id`) bring the app's most recent window to the front on any workspace, cycle its windows on a second press, and start it when it is not running, so the "*App* is ready" notification a `gtk-launch` custom shortcut gets on Wayland is gone. Keys are grabbed like the shell grabs custom shortcuts (`grab_accelerator`), all released on disable. Preferences: list, add (app chooser + key capture or typed name), change, remove; cycle switch.
- `install.sh` installs, compiles and enables it and merges `<Control>F9=spotify.desktop` into its shortcuts (skipped when a GNOME custom shortcut uses the key); `--no-shortcuts` leaves it out; dry run shows each step; `uninstall.sh` removes only what was added.
- `tests/test_focus_keys.js` (parsing, window choice, lifecycle with fakes), install tests for install, idempotence, dry run, conflict, `--no-shortcuts` and uninstall.
- Shell QA: `focus-keys` scene (real Ctrl+F9/F10/F11 presses through a virtual keyboard: raise across workspaces, launch with focus, missing app, disable/enable, preferences window) and `profile-osd` scene (TUF Control profile OSD after a burst of asusd changes). `tools/qa/mockbus.js` writable properties now emit PropertiesChanged. The harness no longer restarts when an extension before it is cycled.

Top bar and app-grid folders, from a look at the real desktop:

- Top bar: status and indicator icons are 22px (was 18) with 6px padding either side; indicator text (battery %, input source, media title) is 16px. Capsules are 40px tall in a 56px panel (Just Perfection `panel-size` 56, was 52). The ubuntu-appindicators tray icons follow the same size through the `icon-size` key the preset now sets.
- Clock: proportional Geist semibold at 17px with tabular figures and wider padding, replacing the tracked Geist Mono. The shell draws date and time in one label, so they cannot take different weights from CSS alone.
- App-grid folders: all four corners round (26px tile, 28px opened folder) and light translucent glass (alpha 0.30 to 0.48 tile, per-variant tint, hairline `folder-edge`); the search pill uses the same glass. Merlot Day is frosted ivory with dark names (`folder-fg`). New contrast pairs check the names and search text on the glass over the lightest overview backdrop.
- Why the folders looked dim: blur-my-shell was painting over the theme. Its automatic overview style (`style-components` 4) repaints tiles, search pill and labels with `!important` rules, and its folder dialog blur used a dark style at 0.6 brightness. The preset now sets overview `style-components 0`, appfolder `style-dialogs 0` and a `pipeline_bordeaux_folder` (blur 28, brightness 1.0).
- `tools/shell_qa.py` gives the private session two app folders, so the folder tile and the opened dialog are rendered. `tests/test_shell_css.py` asserts uniform folder radii, folder fill alpha below 0.6, panel font and icon sizes, clock face, and the preset keys.

Headless visual QA (`tools/shell_qa.py`) and the fixes it found:

- New `tools/shell_qa.py`: renders all three variants in a real `gnome-shell --headless` (private HOME, session and system bus, fake services from `tools/qa/mockbus.js`, memory-capped scope) and checks top-bar font size, dock margins and cut-off labels. Screenshots in `screenshots/` are now these renders; the old photo of a real desktop is gone.
- Quick Settings: toggles 192px wide (em sizing cut every title and subtitle), sans subtitles, split toggles joined into one pill, system buttons round 40px instead of tall pills.
- Popups keep 8px from the screen edge and the top bar; Quick Settings lines up with the right capsule. Slabs 0.96 opaque so windows no longer show through the calendar.
- Dock slab: equal 11px gap on all four sides (was 3px sides, 27px ends).
- Notification source and calendar weekday labels lost their last letter to letter-spacing; tracking removed there.
- Merlot Day: dark show-apps glyph, light app names on the dimmed overview, darker lock-screen dim for a readable clock.
- Preset sets the Bordeaux Aura accent per variant (it was Bordeaux's on all three).

Popup box and overview wallpaper fixes:

- The dim, square-cornered rectangle around every panel popup (calendar, Quick Settings) was the slab's `0 18px 40px` drop shadow: a BoxPointer clips its child's blurred shadow to a hard-edged box. `.popup-menu-content`, `.quick-settings` and `.candidate-popup-content` now carry no shadow (rendered in a headless gnome-shell before and after; any blur radius reproduced it). `tests/test_shell_css.py` guards the wrapper selectors.
- Overview: stock Yaru paints `#overviewGroup` flat `#222222`, so the wallpaper only showed inside the rounded workspace box. The preset turns blur-my-shell's overview component back on with a new `pipeline_bordeaux_overview` (radius 0, brightness 0.8 dark / 0.92 light): a dimmed full-screen wallpaper, no blur passes. `#overviewGroup` falls back to `bg-0`.

Gold strip removal:

- Every asymmetric gold border (top edge on the dock, top-bar capsules, Quick Settings, menus, notifications, app folders, OSD, Alt-Tab, dialogs, tooltips, lock screen widgets) is now a uniform 1px `border` hairline; the dark `lip` bottom edge is gone too, so rounded corners no longer taper.
- Removed the gold left rule on active menu items, the gold bar on GTK4 sidebar rows, gold separator in the dock, gold-bordered calendar today, and the gold workspace-switcher bar (now round dots). Alt-Tab selection is a thin gold full outline instead of an underline tick.
- Dock running indicator style DASHES to DEFAULT (round dots; focused app gold). The Activities workspace indicator is neutral light, since the shell stretches the active dot into a pill.
- blur-my-shell popup blur turned off in the preset: its rectangular blur surface showed as a larger dark box around Quick Settings.

Dock and performance pass:

- Dock aura: new optional `bordeaux-aura@hamza-gouda` extension, a faint glow in each app's own colour behind the dock icons (icons untouched), with tests for its colour maths.

- Dock slab: equal 12px left/right margins (was 12/8), so the icons are centred in the slab.

- Dock: `dock-fixed` false, `autohide` and `intellihide` true (mode ALL_WINDOWS),
  pressure barrier (`require-pressure-to-show` true, threshold 30, because dwell mode did not reliably reveal the hidden dock), 0.25 s show window / 0.2 s hide delay, 0.15 s animation, so it hides only
  when a window overlaps it and apps get the full width.
- Dock icons: `dash-max-icon-size` 44 to 48.
- Blur my Shell: dock and overview blur off, it re-blurs every frame while windows animate (lock screen blur kept).
- Dock slab: opaque gradient (no longer relies on blur) and no drop shadow.
- Overview: no box-shadow on app folders and the folder dialog, opaque matte fill instead of translucent layers.
- Just Perfection `animation` 3 to 4 (range 0-8, 1 is stock, higher is faster).
- Activities capsule: workspace indicator is a round 6px gold dot instead of a 6x3 strip
  (inactive dots are dimmed and shrunk by the Shell itself; the Shell still widens the active one).
- Wallpapers and GRUB images: removed the diagonal gold hairline from all variants.

- Three variants: Bordeaux and Oxblood Noir (dark), Merlot Day (light),
  each with a GNOME Shell theme and GTK 3 / GTK 4 colors.
- `install.sh` / `uninstall.sh`: per-user install with a saved backup,
  variant switching and `--dry-run`.
- `install-boot.sh`: optional GRUB menu theme (per-variant image, `--variant`)
  and Plymouth boot splash.
- Original wallpapers and GRUB images, generated by `tools/make_wallpapers.py`;
  `install.sh --wallpaper` sets them. No sound theme ships.
- `tools/check_contrast.py`: WCAG check of every color pair, read from the
  CSS; runs in CI with shellcheck and an install/uninstall test.
