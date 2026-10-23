# Screenshots

Rendered by `tools/shell_qa.py --variant all --out /tmp/qa --publish screenshots`
in a headless GNOME Shell 46 (Ubuntu 24.04 session, Ubuntu Dock, Blur my Shell,
Just Perfection, Bordeaux Aura and the TUF Control Quick Settings toggle). The
session is private: networks, Bluetooth devices, battery, user and notifications
are made up, so nothing here comes from a real desktop. Full-screen shots are
JPEG (quality 90), crops are PNG; all are 1920 px wide or less and under 400 KB.

| Variant | Files |
|---|---|
| Bordeaux | `bordeaux-desktop`, `-dock`, `-quick-settings`, `-qs-wi-fi`, `-qs-performance`, `-calendar`, `-notification`, `-osd`, `-overview`, `-search`, `-app-grid`, `-alt-tab`, `-end-session`, `-lock` |
| Oxblood Noir | `oxblood-noir-desktop`, `-quick-settings`, `-calendar`, `-overview`, `-lock` |
| Merlot Day | `merlot-day-desktop`, `-dock`, `-quick-settings`, `-calendar`, `-overview`, `-app-grid`, `-end-session`, `-lock` |

The lock screens show stock Yaru: GNOME turns extensions (User Themes included)
off while the screen is locked. The window contents (Files, Terminal,
Calculator) are GTK apps, not the shell theme.

Design previews of all variants live in `docs/v2-previews/`.
