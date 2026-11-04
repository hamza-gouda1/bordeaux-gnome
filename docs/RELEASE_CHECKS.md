# Release checks

Reviewed on 2026-11-02 for GNOME Shell 46.

- Generated outputs: all 18 current.
- Declared contrast checks: 210/210 meet their text or non-text threshold.
- Installer: temporary-home install, variant switch, reinstall and uninstall pass.
- Migration regressions: legacy original GTK backup survives an upgrade; GTK CSS
  edited after installation is preserved when the original file was absent.
- Boot snapshot tests pass without privileged actions.
- Extension logic: 209 assertions pass across colour, focus, show-desktop and
  theme-following tests; schemas validate and ShellCheck passes.
- Tracked-text scan found no real home paths or obvious credential patterns.

Headless renders exercise isolated fake services. They cannot establish physical
hotkey mapping, real touchpad feel, GPU compositor performance or boot appearance.
The lock screen keeps the session's stock theme because User Themes is disabled
while locked. No real hardware or boot settings were written during this review.

Boot validation covers dry runs and isolated backup/restore logic. Privileged
installation and the resulting GRUB/Plymouth appearance have not been tested on
a real boot. Physical touchpad feel and high-refresh-display performance also
remain live-session checks; headless tests cannot establish them.

To reproduce the visual checks:

```sh
python3 tools/shell_qa.py --variant all \
  --scene desktop,quick-settings,overview --out /tmp/bordeaux-shell-review
```

The harness limits its scope to 1500 MB and disables swap for that scope.
