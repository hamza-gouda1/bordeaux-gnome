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

python3 "$ROOT/tests/test_shell_css.py" || fail "generated shell css regression"

# An older copy in ~/.themes would shadow the new theme (User Themes looks there first).
mkdir -p "$HOME/.themes/Bordeaux/gnome-shell"
echo "/* legacy */" > "$HOME/.themes/Bordeaux/gnome-shell/gnome-shell.css"

# A dry run changes nothing.
"$ROOT/install.sh" --dry-run --variant merlot-day >/dev/null 2>&1
[ ! -e "$XDG_DATA_HOME/themes" ] || fail "dry run created files"
[ -f "$HOME/.themes/Bordeaux/gnome-shell/gnome-shell.css" ] || fail "dry run moved the legacy theme"

"$ROOT/install.sh" --variant merlot-day >/dev/null 2>&1
[ ! -e "$HOME/.themes/Bordeaux" ] || fail "legacy ~/.themes copy still shadows the theme"
grep -q legacy "$XDG_STATE_HOME/bordeaux-gnome/backup/legacy-themes/Bordeaux/gnome-shell/gnome-shell.css" || fail "legacy theme not backed up"
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
grep -q legacy "$HOME/.themes/Bordeaux/gnome-shell/gnome-shell.css" || fail "legacy theme not restored"
[ ! -e "$XDG_STATE_HOME/bordeaux-gnome" ] || fail "state left behind"

# ---- preset + Terminal profile ----
# memory backend does not persist between gsettings processes, so this part uses
# the keyfile backend inside the throwaway XDG_CONFIG_HOME (still never dconf).
export GSETTINGS_BACKEND=keyfile
DOCK=org.gnome.shell.extensions.dash-to-dock
PROF=org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:9b0d3a10-0b0e-4d11-9a01-000000000001/
OLD_LIST="['aaaaaaaa-0000-4000-8000-000000000000']"
gsettings set org.gnome.desktop.interface font-name "'My Font 10'"
gsettings set $DOCK dock-position "'BOTTOM'"
gsettings set org.gnome.Terminal.ProfilesList list "$OLD_LIST"
gsettings set org.gnome.Terminal.ProfilesList default "'aaaaaaaa-0000-4000-8000-000000000000'"
mkdir -p "$XDG_DATA_HOME/icons/Papirus-Dark"
# Extension schemas live inside the extension. Copy the real ones (read only)
# into the throwaway home when present, so those keys are exercised too.
BLUR=org.gnome.shell.extensions.blur-my-shell
REAL_HOME=$(getent passwd "$(id -u)" | cut -d: -f6)
SRC=$(ls -d "$REAL_HOME"/.local/share/gnome-shell/extensions/blur-my-shell@*/schemas 2>/dev/null | head -1 || true)
HAVE_BLUR=0
if [ -n "$SRC" ] && command -v glib-compile-schemas >/dev/null; then
    EXT=$XDG_DATA_HOME/gnome-shell/extensions/blur-my-shell@test/schemas
    mkdir -p "$EXT"; cp "$SRC"/*.gschema.xml "$EXT/"; glib-compile-schemas "$EXT"
    HAVE_BLUR=1
fi
blurget() { GSETTINGS_SCHEMA_DIR=$EXT gsettings get "$@"; }
KF=$XDG_CONFIG_HOME/glib-2.0/settings/keyfile
before=$(cat "$KF")

out=$("$ROOT/install.sh" --dry-run --icons 2>&1)
[ "$(cat "$KF")" = "$before" ] || fail "preset dry run changed settings"
[ ! -e "$XDG_STATE_HOME/bordeaux-gnome" ] || fail "preset dry run wrote state"
grep -q "would run: gsettings set org.gnome.desktop.interface font-name" <<<"$out" || fail "dry run lacks font change"
grep -q "would run: gsettings set $DOCK dock-position" <<<"$out" || fail "dry run lacks dock change"

PB=$XDG_STATE_HOME/bordeaux-gnome/backup/preset.txt
"$ROOT/install.sh" --icons --cursor >/dev/null 2>&1
[ "$(gsettings get org.gnome.desktop.interface font-name)" = "'Geist 11'" ] || fail "font not set"
[ "$(gsettings get $DOCK dock-position)" = "'LEFT'" ] || fail "dock position not set"
[ "$(gsettings get $DOCK extend-height)" = "false" ] || fail "dock extend-height not set"
[ "$(gsettings get $DOCK dock-fixed)" = "false" ] || fail "dock-fixed not cleared (intellihide)"
[ "$(gsettings get $DOCK require-pressure-to-show)" = "true" ] || fail "pressure barrier not enabled"
[ "$(gsettings get $DOCK pressure-threshold)" = "30.0" ] || fail "pressure threshold not 30"
[ "$(gsettings get $DOCK intellihide)" = "true" ] || fail "intellihide not set"
[ "$(gsettings get $DOCK autohide)" = "true" ] || fail "autohide not set"
[ "$(gsettings get $DOCK intellihide-mode)" = "'ALL_WINDOWS'" ] || fail "intellihide-mode not set"
[ "$(gsettings get $DOCK dash-max-icon-size)" = "48" ] || fail "icon size not 48"
[ "$(gsettings get $DOCK running-indicator-style)" = "'DEFAULT'" ] || fail "running indicator style not set"
[ "$(gsettings get $DOCK custom-background-color)" = "false" ] || fail "dock custom background not cleared"
[ "$(gsettings get org.gnome.desktop.interface icon-theme)" = "'Papirus-Dark'" ] || fail "installed icon theme not set"
if [ -d /usr/share/icons/DMZ-Black ]; then want="'DMZ-Black'"; else want="'Yaru'"; fi
[ "$(gsettings get org.gnome.desktop.interface cursor-theme)" = "$want" ] || fail "cursor theme only applies when installed"
if [ "$HAVE_BLUR" = 1 ]; then
    [ "$(blurget $BLUR.lockscreen pipeline)" = "'pipeline_bordeaux_slab'" ] || fail "blur-my-shell key not set via extension schema dir"
    blurget $BLUR pipelines | grep -q pipeline_bordeaux_island || fail "pipelines not merged"
    [ "$(blurget $BLUR.dash-to-dock blur)" = "false" ] || fail "dock blur not turned off"
    [ "$(blurget $BLUR.overview blur)" = "true" ] || fail "overview wallpaper (blur component) not turned on"
    [ "$(blurget $BLUR.overview pipeline)" = "'pipeline_bordeaux_overview'" ] || fail "overview pipeline not set"
    blurget $BLUR pipelines | grep -q pipeline_bordeaux_overview || fail "overview pipeline not merged"
    [ "$(blurget $BLUR.popup blur)" = "false" ] || fail "popup blur not turned off"
    grep -qF "$BLUR.lockscreen pipeline D" "$PB" || fail "backup lacks blur-my-shell default marker"
fi
[ "$(gsettings get $PROF visible-name)" = "'Bordeaux'" ] || fail "terminal profile missing or misnamed"
gsettings get org.gnome.Terminal.ProfilesList list | grep -q 9b0d3a10-0b0e-4d11-9a01-000000000001 || fail "profile not listed"
[ "$(gsettings get org.gnome.Terminal.ProfilesList default)" = "'aaaaaaaa-0000-4000-8000-000000000000'" ] || fail "terminal default changed without flag"
grep -q "org.gnome.desktop.interface font-name U 'My Font 10'" "$PB" || fail "backup lacks old font"
grep -q "$DOCK dock-position U 'BOTTOM'" "$PB" || fail "backup lacks old dock position"
grep -q "$DOCK extend-height D" "$PB" || fail "backup lacks default marker"
grep -qF "org.gnome.Terminal.ProfilesList list U $OLD_LIST" "$PB" || fail "backup lacks old profile list"

# Re-installing is idempotent and keeps the first backup.
cp "$PB" "$T/pb.1"; cp "$KF" "$T/kf.1"
"$ROOT/install.sh" --icons --cursor >/dev/null 2>&1
cmp -s "$PB" "$T/pb.1" || fail "re-install changed the preset backup"
cmp -s "$KF" "$T/kf.1" || fail "re-install changed settings"

# --terminal-default is opt-in.
"$ROOT/install.sh" --terminal-default >/dev/null 2>&1
[ "$(gsettings get org.gnome.Terminal.ProfilesList default)" = "'9b0d3a10-0b0e-4d11-9a01-000000000001'" ] || fail "--terminal-default ignored"

"$ROOT/uninstall.sh" >/dev/null 2>&1
[ "$(gsettings get org.gnome.desktop.interface font-name)" = "'My Font 10'" ] || fail "font not restored"
[ "$(gsettings get $DOCK dock-position)" = "'BOTTOM'" ] || fail "dock position not restored"
[ "$(gsettings get org.gnome.Terminal.ProfilesList list)" = "$OLD_LIST" ] || fail "profile list not restored"
[ "$(gsettings get org.gnome.Terminal.ProfilesList default)" = "'aaaaaaaa-0000-4000-8000-000000000000'" ] || fail "terminal default not restored"
python3 - <<'PY' || fail "default-valued keys were left set"
from gi.repository import Gio
d = Gio.Settings.new("org.gnome.shell.extensions.dash-to-dock")
assert d.get_user_value("extend-height") is None
assert d.get_user_value("intellihide") is None
assert d.get_user_value("transparency-mode") is None
p = Gio.Settings.new_with_path("org.gnome.Terminal.Legacy.Profile", "/org/gnome/terminal/legacy/profiles:/:9b0d3a10-0b0e-4d11-9a01-000000000001/")
assert p.get_user_value("visible-name") is None
assert Gio.Settings.new("org.gnome.desktop.interface").get_user_value("icon-theme") is None
PY
if [ "$HAVE_BLUR" = 1 ]; then
    [ "$(blurget $BLUR.lockscreen pipeline)" = "'pipeline_default'" ] || fail "blur-my-shell key not reset"
    blurget $BLUR pipelines | grep -q bordeaux && fail "pipelines not reset"
fi

# --no-preset leaves the desktop keys alone.
"$ROOT/install.sh" --no-preset >/dev/null 2>&1
[ "$(gsettings get org.gnome.desktop.interface font-name)" = "'My Font 10'" ] || fail "--no-preset set the font"
"$ROOT/uninstall.sh" >/dev/null 2>&1

# --wallpaper installs the generated jpg; uninstall restores the old keys.
BG=org.gnome.desktop.background
gsettings set $BG picture-uri "'file:///old.jpg'"
"$ROOT/install.sh" --no-preset --wallpaper --variant oxblood-noir >/dev/null 2>&1
cmp -s "$XDG_DATA_HOME/backgrounds/bordeaux-gnome/Oxblood-Noir.jpg" "$ROOT/wallpapers/Oxblood-Noir.jpg" || fail "wallpaper not installed"
[ "$(gsettings get $BG picture-uri-dark)" = "'file://$XDG_DATA_HOME/backgrounds/bordeaux-gnome/Oxblood-Noir.jpg'" ] || fail "picture-uri-dark not set"
"$ROOT/uninstall.sh" >/dev/null 2>&1
[ "$(gsettings get $BG picture-uri)" = "'file:///old.jpg'" ] || fail "picture-uri not restored"
[ ! -e "$XDG_DATA_HOME/backgrounds/bordeaux-gnome" ] || fail "wallpaper left behind"
if "$ROOT/install.sh" --sounds >/dev/null 2>&1; then fail "--sounds still accepted"; fi

# Boot installer previews without root; GRUB image per variant, none for Merlot-Day.
"$ROOT/install-boot.sh" --dry-run >/dev/null
"$ROOT/install-boot.sh" --dry-run --remove >/dev/null
out=$("$ROOT/install-boot.sh" --dry-run --only grub --variant noir)
grep -q "wallpapers/grub/Oxblood-Noir.png" <<<"$out" || fail "grub image not chosen"
out=$("$ROOT/install-boot.sh" --dry-run --only grub --variant merlot-day)
grep -q "no GRUB image" <<<"$out" || fail "merlot-day not skipped gracefully"

# The Geist check must not misfire under pipefail when fc-list prints a lot.
mkdir -p "$T/bin"
printf '#!/bin/sh\nfor i in $(seq 1 3000); do echo "Geist,Geist Medium"; done\n' > "$T/bin/fc-list"
chmod +x "$T/bin/fc-list"
out=$(PATH="$T/bin:$PATH" "$ROOT/install.sh" --no-preset 2>&1)
grep -q "Geist font is not installed" <<<"$out" && fail "installed Geist reported missing"
"$ROOT/uninstall.sh" >/dev/null 2>&1

# Bad input is refused.
if "$ROOT/install.sh" --variant nope >/dev/null 2>&1; then fail "accepted a bad variant"; fi

echo "install tests passed"
