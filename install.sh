#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Install a Bordeaux variant for the current user. No root needed.
# The first run saves your current settings; uninstall.sh puts them back.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DATA=${XDG_DATA_HOME:-$HOME/.local/share}
CONF=${XDG_CONFIG_HOME:-$HOME/.config}
STATE=${XDG_STATE_HOME:-$HOME/.local/state}/bordeaux-gnome
USER_THEME_EXT=user-theme@gnome-shell-extensions.gcampax.github.com

VARIANT=bordeaux
DRY=0
WALLPAPER=0
SOUNDS=0

usage() {
    cat <<EOF
usage: $(basename "$0") [--variant NAME] [--wallpaper] [--sounds] [--dry-run]

  -v, --variant NAME   bordeaux (default), oxblood-noir, merlot-day
      --wallpaper      also set the variant's wallpaper (from pending-review/)
      --sounds         also install the Bordeaux Velvet sound theme
  -n, --dry-run        print what would change, change nothing
EOF
}

while [ $# -gt 0 ]; do
    case $1 in
        -v|--variant) VARIANT=${2:?missing variant name}; shift 2 ;;
        --wallpaper) WALLPAPER=1; shift ;;
        --sounds) SOUNDS=1; shift ;;
        -n|--dry-run) DRY=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done

case $VARIANT in
    bordeaux) THEME=Bordeaux; GTK_THEME=Yaru-dark; SCHEME=prefer-dark ;;
    oxblood-noir|noir) VARIANT=oxblood-noir; THEME=Oxblood-Noir; GTK_THEME=Yaru-dark; SCHEME=prefer-dark ;;
    merlot-day|merlot) VARIANT=merlot-day; THEME=Merlot-Day; GTK_THEME=Yaru; SCHEME=prefer-light ;;
    *) echo "unknown variant: $VARIANT" >&2; usage >&2; exit 2 ;;
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
has_key() { gsettings writable "$1" "$2" >/dev/null 2>&1; }
set_key() {
    if has_key "$1" "$2"; then
        run gsettings set "$1" "$2" "$3"
    else
        warn "skipping $1 $2 (schema not installed)"
    fi
}

BACKUP_KEYS=(
    "org.gnome.desktop.interface gtk-theme"
    "org.gnome.desktop.interface color-scheme"
    "org.gnome.shell enabled-extensions"
    "org.gnome.shell.extensions.user-theme name"
    "org.gnome.desktop.background picture-uri"
    "org.gnome.desktop.background picture-uri-dark"
    "org.gnome.desktop.sound theme-name"
)

backup() {
    if [ -d "$STATE/backup" ]; then
        say "Keeping the backup from your first install ($STATE/backup)."
        return
    fi
    say "Saving your current settings to $STATE/backup"
    [ "$DRY" = 1 ] && return
    mkdir -p "$STATE/backup"
    : > "$STATE/backup/gsettings.txt"
    local entry schema key
    for entry in "${BACKUP_KEYS[@]}"; do
        read -r schema key <<<"$entry"
        if has_key "$schema" "$key"; then
            printf '%s %s %s\n' "$schema" "$key" "$(gsettings get "$schema" "$key")" >> "$STATE/backup/gsettings.txt"
        fi
    done
    local v
    for v in 3 4; do
        if [ -f "$CONF/gtk-$v.0/gtk.css" ]; then
            cp "$CONF/gtk-$v.0/gtk.css" "$STATE/backup/gtk-$v.0.css"
        fi
    done
}

say "Installing Bordeaux GNOME: $THEME"
backup

say "Copying the three themes to $DATA/themes"
run mkdir -p "$DATA/themes"
for dir in "$ROOT"/themes/*/; do
    name=$(basename "$dir")
    run rm -rf "${DATA:?}/themes/$name"
    run cp -r "$dir" "$DATA/themes/$name"
done

say "Applying $THEME colors to GTK 3 and GTK 4 apps"
for v in 3 4; do
    run mkdir -p "$CONF/gtk-$v.0"
    run cp "$ROOT/themes/$THEME/gtk-$v.0/gtk.css" "$CONF/gtk-$v.0/gtk.css"
done
set_key org.gnome.desktop.interface gtk-theme "$GTK_THEME"
set_key org.gnome.desktop.interface color-scheme "$SCHEME"

say "Setting the GNOME Shell theme"
if command -v gnome-extensions >/dev/null 2>&1 && gnome-extensions info "$USER_THEME_EXT" >/dev/null 2>&1; then
    run gnome-extensions enable "$USER_THEME_EXT"
else
    warn "the User Themes extension is not installed; install it (Ubuntu: sudo apt install gnome-shell-extensions), log out and in, then run this again"
fi
set_key org.gnome.shell.extensions.user-theme name "$THEME"

if [ "$WALLPAPER" = 1 ]; then
    src="$ROOT/pending-review/wallpapers/$VARIANT.png"
    if [ -f "$src" ]; then
        dest="$DATA/backgrounds/bordeaux-gnome/$VARIANT.png"
        run mkdir -p "$(dirname "$dest")"
        run cp "$src" "$dest"
        set_key org.gnome.desktop.background picture-uri "file://$dest"
        set_key org.gnome.desktop.background picture-uri-dark "file://$dest"
    else
        warn "no wallpaper at $src; skipping"
    fi
fi

if [ "$SOUNDS" = 1 ]; then
    src="$ROOT/pending-review/sounds/bordeaux-velvet"
    if [ -d "$src" ]; then
        run mkdir -p "$DATA/sounds"
        run rm -rf "${DATA:?}/sounds/bordeaux-velvet"
        run cp -r "$src" "$DATA/sounds/bordeaux-velvet"
        set_key org.gnome.desktop.sound theme-name bordeaux-velvet
    else
        warn "no sound theme at $src; skipping"
    fi
fi

if [ "$DRY" = 0 ]; then
    mkdir -p "$STATE"
    printf '%s\n' "$VARIANT" > "$STATE/variant"
fi

if command -v fc-list >/dev/null 2>&1 && ! fc-list | grep -qi 'Geist'; then
    warn "the Geist font is not installed; the theme falls back to your system font. Get it from https://vercel.com/font"
fi

say "Done. Restart open apps to see the GTK colors. Undo everything with ./uninstall.sh"
