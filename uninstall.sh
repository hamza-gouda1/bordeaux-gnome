#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Remove Bordeaux GNOME and restore the settings saved by install.sh.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DATA=${XDG_DATA_HOME:-$HOME/.local/share}
CONF=${XDG_CONFIG_HOME:-$HOME/.config}
STATE=${XDG_STATE_HOME:-$HOME/.local/state}/bordeaux-gnome
DRY=0

case ${1:-} in
    -n|--dry-run) DRY=1 ;;
    -h|--help) echo "usage: $(basename "$0") [--dry-run]"; exit 0 ;;
    "") ;;
    *) echo "usage: $(basename "$0") [--dry-run]" >&2; exit 2 ;;
esac

say() { printf '%s\n' "$*"; }
warn() { printf 'note: %s\n' "$*" >&2; }
run() {
    if [ "$DRY" = 1 ]; then
        printf '  would run:'; printf ' %q' "$@"; printf '\n'
    else
        "$@"
    fi
}


# GNOME extensions ship their schemas inside the extension, not in the system
# schema dir. Find the dir that defines a schema (user dir first).
schema_dir() {
    local base=${1%%:*} d
    gsettings list-schemas 2>/dev/null | grep -qxF "$base" && return 0
    gsettings list-relocatable-schemas 2>/dev/null | grep -qxF "$base" && return 0
    for d in "$DATA"/gnome-shell/extensions/*/schemas /usr/share/gnome-shell/extensions/*/schemas; do
        if grep -qsF "id=\"$base\"" "$d"/*.gschema.xml 2>/dev/null; then
            printf '%s\n' "$d"; return 0
        fi
    done
}
# gs SUBCOMMAND SCHEMA ARGS...: gsettings with the extension's schema dir when needed.
gs() {
    local d
    d=$(schema_dir "$2")
    if [ -n "$d" ]; then
        GSETTINGS_SCHEMA_DIR="$d${GSETTINGS_SCHEMA_DIR:+:$GSETTINGS_SCHEMA_DIR}" gsettings "$@"
    else
        gsettings "$@"
    fi
}
gs_run() {
    if [ "$DRY" = 1 ]; then
        printf '  would run: gsettings'; printf ' %q' "$@"; printf '\n'
    else
        gs "$@"
    fi
}

# True if the file is one of the gtk.css files this repo ships.
is_ours() {
    local f=$1 v=$2 t
    for t in "$ROOT"/themes/*/; do
        cmp -s "$f" "$t/gtk-$v.0/gtk.css" && return 0
    done
    return 1
}

if [ -f "$STATE/backup/gsettings.txt" ]; then
    say "Restoring your saved GNOME settings"
    while read -r schema key value; do
        if gsettings writable "$schema" "$key" >/dev/null 2>&1; then
            run gsettings set "$schema" "$key" "$value"
        fi
    done < "$STATE/backup/gsettings.txt"
else
    warn "no saved settings found in $STATE; leaving GNOME settings as they are"
fi

if [ -f "$STATE/backup/preset.txt" ]; then
    say "Restoring the preset keys (fonts, dock, extensions, Terminal profile)"
    while read -r schema key state value; do
        gs writable "$schema" "$key" >/dev/null 2>&1 || continue
        if [ "$state" = D ]; then
            gs_run reset "$schema" "$key"
        else
            gs_run set "$schema" "$key" "$value"
        fi
    done < "$STATE/backup/preset.txt"
fi

# remove_enabled UUID STATEDIR: drop UUID from enabled-extensions if install.sh added it.
remove_enabled() {
    local exts
    [ -f "$2/enabled-by-us" ] || return 0
    gsettings writable org.gnome.shell enabled-extensions >/dev/null 2>&1 || return 0
    exts=$(python3 - "$(gsettings get org.gnome.shell enabled-extensions)" "$1" <<'PY'
import sys

from gi.repository import GLib

cur = GLib.Variant.parse(GLib.VariantType("as"), sys.argv[1]).unpack()
print(GLib.Variant("as", [e for e in cur if e != sys.argv[2]]).print_(False))
PY
)
    if [ "$exts" != "$(gsettings get org.gnome.shell enabled-extensions)" ]; then
        run gsettings set org.gnome.shell enabled-extensions "$exts"
    fi
}

# Focus Keys: take out only the shortcuts and the enable that install.sh added
# (other tools, e.g. tuf-control, may have added their own entries).
FOCUS_UUID=focus-keys@hamza-gouda
FOCUS_SCHEMA=org.gnome.shell.extensions.focus-keys
FSTATE=$STATE/focus-keys
if [ -d "$FSTATE" ]; then
    say "Removing the Focus Keys shortcuts added by install.sh"
    if [ -s "$FSTATE/bindings-added" ] && gs writable "$FOCUS_SCHEMA" bindings >/dev/null 2>&1; then
        left=$(python3 - "$(gs get "$FOCUS_SCHEMA" bindings)" "$FSTATE/bindings-added" <<'PY'
import sys

from gi.repository import GLib

cur = GLib.Variant.parse(GLib.VariantType("as"), sys.argv[1]).unpack()
ours = set(open(sys.argv[2]).read().splitlines())
left = [e for e in cur if e not in ours]
print(GLib.Variant("as", left).print_(False) if left else "RESET")
PY
)
        if [ "$left" = RESET ]; then
            gs_run reset "$FOCUS_SCHEMA" bindings
        else
            gs_run set "$FOCUS_SCHEMA" bindings "$left"
        fi
    fi
    remove_enabled "$FOCUS_UUID" "$FSTATE"
    run rm -rf "${DATA:?}/gnome-shell/extensions/$FOCUS_UUID"
fi

# Bordeaux Aura (light/dark following): its keys came back with preset.txt above.
AURA_UUID=bordeaux-aura@hamza-gouda
ASTATE=$STATE/aura
if [ -d "$ASTATE" ]; then
    remove_enabled "$AURA_UUID" "$ASTATE"
    if [ -f "$ASTATE/installed-by-us" ] && [ ! -f "$ASTATE/preexisting" ]; then
        say "Removing the Bordeaux Aura extension"
        run rm -rf "${DATA:?}/gnome-shell/extensions/$AURA_UUID"
    fi
fi

say "Restoring GTK 3 and GTK 4 styles"
for v in 3 4; do
    css="$CONF/gtk-$v.0/gtk.css"
    if [ -f "$STATE/backup/gtk-$v.0.css" ]; then
        run cp "$STATE/backup/gtk-$v.0.css" "$css"
    elif [ -f "$css" ] && is_ours "$css" "$v"; then
        run rm -f "$css"
    elif [ -f "$css" ]; then
        warn "$css was changed after install; leaving it"
    fi
done

say "Removing installed files"
for dir in "$ROOT"/themes/*/; do
    run rm -rf "${DATA:?}/themes/$(basename "$dir")"
done
# Put back any older ~/.themes copies that install.sh moved aside.
if [ -d "$STATE/backup/legacy-themes" ]; then
    for dir in "$STATE"/backup/legacy-themes/*/; do
        [ -d "$dir" ] || continue
        name=$(basename "$dir")
        case $name in *.[0-9]*) continue ;; esac
        if [ ! -e "$HOME/.themes/$name" ]; then
            run mkdir -p "$HOME/.themes"
            run cp -r "$dir" "$HOME/.themes/$name"
        fi
    done
fi
# The sounds dir came from an older version that shipped a sound theme.
run rm -rf "${DATA:?}/backgrounds/bordeaux-gnome" "${DATA:?}/sounds/bordeaux-velvet"
run rm -rf "$STATE"

say "Done."
