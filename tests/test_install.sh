#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Install, switch variant and uninstall inside a throwaway home folder.
# GSETTINGS_BACKEND=memory keeps the real desktop settings untouched.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
export HOME=$T/home XDG_DATA_HOME=$T/home/.local/share XDG_CONFIG_HOME=$T/home/.config
export XDG_STATE_HOME=$T/home/.local/state GSETTINGS_BACKEND=memory
# Keep gnome-extensions away from the running desktop session.
unset DBUS_SESSION_BUS_ADDRESS
mkdir -p "$XDG_CONFIG_HOME/gtk-4.0"
echo "/* my own css */" > "$XDG_CONFIG_HOME/gtk-4.0/gtk.css"

fail() { echo "FAIL: $*" >&2; exit 1; }

# A dry run changes nothing.
"$ROOT/install.sh" --dry-run --variant merlot-day >/dev/null 2>&1
[ ! -e "$XDG_DATA_HOME/themes" ] || fail "dry run created files"

"$ROOT/install.sh" --variant merlot-day >/dev/null 2>&1
for t in Bordeaux Oxblood-Noir Merlot-Day; do
    [ -f "$XDG_DATA_HOME/themes/$t/gnome-shell/gnome-shell.css" ] || fail "$t shell theme missing"
done
cmp -s "$XDG_CONFIG_HOME/gtk-4.0/gtk.css" "$ROOT/themes/Merlot-Day/gtk-4.0/gtk.css" || fail "gtk4 css not applied"
cmp -s "$XDG_CONFIG_HOME/gtk-3.0/gtk.css" "$ROOT/themes/Merlot-Day/gtk-3.0/gtk.css" || fail "gtk3 css not applied"

# Switching variants keeps the first backup.
"$ROOT/install.sh" --variant noir >/dev/null 2>&1
cmp -s "$XDG_CONFIG_HOME/gtk-4.0/gtk.css" "$ROOT/themes/Oxblood-Noir/gtk-4.0/gtk.css" || fail "variant switch"
grep -q "my own css" "$XDG_STATE_HOME/bordeaux-gnome/backup/gtk-4.0.css" || fail "backup overwritten"

"$ROOT/uninstall.sh" >/dev/null 2>&1
grep -q "my own css" "$XDG_CONFIG_HOME/gtk-4.0/gtk.css" || fail "gtk4 css not restored"
[ ! -e "$XDG_CONFIG_HOME/gtk-3.0/gtk.css" ] || fail "gtk3 css left behind"
[ ! -e "$XDG_DATA_HOME/themes/Bordeaux" ] || fail "theme left behind"
[ ! -e "$XDG_STATE_HOME/bordeaux-gnome" ] || fail "state left behind"

# Boot installer previews without root.
"$ROOT/install-boot.sh" --dry-run >/dev/null
"$ROOT/install-boot.sh" --dry-run --remove >/dev/null

# Bad input is refused.
if "$ROOT/install.sh" --variant nope >/dev/null 2>&1; then fail "accepted a bad variant"; fi

echo "install tests passed"
