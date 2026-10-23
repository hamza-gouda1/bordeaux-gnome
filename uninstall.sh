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
run rm -rf "${DATA:?}/backgrounds/bordeaux-gnome" "${DATA:?}/sounds/bordeaux-velvet"
run rm -rf "$STATE"

say "Done."
