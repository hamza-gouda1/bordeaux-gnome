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
PRESET=1
ICONS=0
CURSOR=0
TERM_DEFAULT=0

usage() {
    cat <<EOF
usage: $(basename "$0") [--variant NAME] [--wallpaper] [--dry-run]
       [--no-preset] [--icons] [--cursor] [--terminal-default]

  -v, --variant NAME   bordeaux (default), oxblood-noir, merlot-day
      --wallpaper      also set the variant's wallpaper (wallpapers/<Variant>.jpg)
  -n, --dry-run        print what would change, change nothing
      --no-preset      skip the desktop preset (fonts, Ubuntu Dock, Blur my Shell,
                       Just Perfection) and the GNOME Terminal profile
      --icons          also set the recommended icon theme, if installed
      --cursor         also set the recommended cursor theme, if installed
      --terminal-default  make the Bordeaux Terminal profile the default one
EOF
}

while [ $# -gt 0 ]; do
    case $1 in
        -v|--variant) VARIANT=${2:?missing variant name}; shift 2 ;;
        --wallpaper) WALLPAPER=1; shift ;;
        -n|--dry-run) DRY=1; shift ;;
        --no-preset) PRESET=0; shift ;;
        --with-preset) PRESET=1; shift ;;
        --icons) ICONS=1; shift ;;
        --cursor) CURSOR=1; shift ;;
        --terminal-default) TERM_DEFAULT=1; shift ;;
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
has_pkey() { gs writable "$1" "$2" >/dev/null 2>&1; }
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

# ---- preset: every key changed here is backed up first (first value wins) ----
PBACK=$STATE/backup/preset.txt

# Prints U when the key has a user value, D when it is at its default.
key_state() {
    GSETTINGS_SCHEMA_DIR=$(schema_dir "$1") python3 - "$1" "$2" 2>/dev/null <<'PY' || echo U
import sys
from gi.repository import Gio
schema, _, path = sys.argv[1].partition(":")
s = Gio.Settings.new_with_path(schema, path) if path else Gio.Settings.new(schema)
print("D" if s.get_user_value(sys.argv[2]) is None else "U")
PY
}

preset_backup() {
    local schema=$1 key=$2 st
    if [ -f "$PBACK" ] && awk -v s="$schema" -v k="$key" '$1==s && $2==k {f=1} END{exit !f}' "$PBACK"; then
        return
    fi
    st=$(key_state "$schema" "$key")
    if [ "$DRY" = 1 ]; then
        say "  would back up $schema $key ($st)"
        return
    fi
    mkdir -p "$STATE/backup"
    if [ "$st" = D ]; then
        printf '%s %s D\n' "$schema" "$key" >> "$PBACK"
    else
        printf '%s %s U %s\n' "$schema" "$key" "$(gs get "$schema" "$key")" >> "$PBACK"
    fi
}

preset_set() {
    local val=$3 cur
    if has_pkey "$1" "$2"; then
        if [ "${val#merge:}" != "$val" ]; then
            # Add our entries to the dict the user already has (keeps theirs).
            val=${val#merge:}
            cur=$(gs get "$1" "$2")
            case $cur in
                *pipeline_bordeaux_*) preset_backup "$1" "$2"; return ;;
                "@"*" {}") cur= ;;
                *) cur=${cur%\}}", " ;;
            esac
            val="${cur:+$cur}${val#\{}"
            [ -n "$cur" ] || val="{${val}"
        fi
        preset_backup "$1" "$2"
        gs_run set "$1" "$2" "$val"
    else
        warn "skipping $1 $2 (schema not installed)"
    fi
}

theme_installed() {
    local d
    for d in "$DATA/icons" "$HOME/.icons" /usr/local/share/icons /usr/share/icons; do
        [ -d "$d/$1" ] && return 0
    done
    return 1
}

apply_preset() {
    local file="$ROOT/presets/$THEME.preset" group schema key value name
    [ -f "$file" ] || { warn "no preset at $file; skipping"; return; }
    while read -r group schema key value; do
        case $group in ""|"#"*) continue ;; esac
        case $group in
            core) [ "$PRESET" = 1 ] || continue ;;
            icons) [ "$ICONS" = 1 ] || continue ;;
            cursor) [ "$CURSOR" = 1 ] || continue ;;
            *) continue ;;
        esac
        if [ "$group" != core ]; then
            name=${value//\'/}
            theme_installed "$name" || { warn "$group theme $name is not installed; skipping (nothing is downloaded)"; continue; }
        fi
        preset_set "$schema" "$key" "$value"
    done < "$file"
}

apply_terminal() {
    local file="$ROOT/terminal/$THEME.dconf" uuid base list def new line key value
    [ -f "$file" ] || return
    uuid=$(sed -n 's/^\[:\(.*\)\]$/\1/p' "$file")
    base="org.gnome.Terminal.Legacy.Profile:/org/gnome/terminal/legacy/profiles:/:$uuid/"
    if ! has_key org.gnome.Terminal.ProfilesList list; then
        warn "GNOME Terminal schemas not installed; skipping the Terminal profile"
        return
    fi
    list=$(gsettings get org.gnome.Terminal.ProfilesList list)
    if [ "$list" = "@as []" ] || [ "$list" = "[]" ]; then
        warn "GNOME Terminal has no profile list yet; open Terminal once, then run this again to add the profile"
        return
    fi
    say "Adding the $THEME GNOME Terminal profile"
    while IFS= read -r line; do
        case $line in ""|"#"*|"["*) continue ;; esac
        key=${line%%=*}; value=${line#*=}
        preset_set "$base" "$key" "$value"
    done < "$file"
    case $list in
        *"'$uuid'"*) ;;
        *)
            preset_backup org.gnome.Terminal.ProfilesList list
            new="${list%]}, '$uuid']"
            gs_run set org.gnome.Terminal.ProfilesList list "$new" ;;
    esac
    if [ "$TERM_DEFAULT" = 1 ]; then
        def=default
        preset_backup org.gnome.Terminal.ProfilesList "$def"
        gs_run set org.gnome.Terminal.ProfilesList "$def" "'$uuid'"
    fi
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

# The User Themes extension searches ~/.themes BEFORE ~/.local/share/themes, so an
# older copy there silently wins and the shell keeps running the old stylesheet.
# Move such copies into the backup (uninstall.sh puts them back).
LEGACY=$STATE/backup/legacy-themes
for dir in "$ROOT"/themes/*/; do
    name=$(basename "$dir")
    old=$HOME/.themes/$name
    [ -e "$old/gnome-shell" ] || continue
    say "Moving the older $old out of the way (it would override the new theme); saved in $LEGACY"
    run mkdir -p "$LEGACY"
    if [ -e "$LEGACY/$name" ]; then
        run mv "$old" "$LEGACY/$name.$(date +%Y%m%d%H%M%S)"
    else
        run mv "$old" "$LEGACY/$name"
    fi
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
    src="$ROOT/wallpapers/$THEME.jpg"
    if [ -f "$src" ]; then
        dest="$DATA/backgrounds/bordeaux-gnome/$THEME.jpg"
        run mkdir -p "$(dirname "$dest")"
        run cp "$src" "$dest"
        set_key org.gnome.desktop.background picture-uri "file://$dest"
        set_key org.gnome.desktop.background picture-uri-dark "file://$dest"
    else
        warn "no wallpaper at $src; skipping"
    fi
fi

if [ "$PRESET" = 1 ] || [ "$ICONS" = 1 ] || [ "$CURSOR" = 1 ]; then
    say "Applying the desktop preset (backed up first)"
    apply_preset
fi
if [ "$PRESET" = 1 ]; then
    apply_terminal
fi

if [ "$DRY" = 0 ]; then
    mkdir -p "$STATE"
    printf '%s\n' "$VARIANT" > "$STATE/variant"
fi

# Capture first: `fc-list | grep -q` under pipefail fails with SIGPIPE as soon as grep
# exits on its first match, which made an installed Geist look missing.
if command -v fc-list >/dev/null 2>&1; then
    families=$(fc-list : family 2>/dev/null || true)
    if ! grep -qE '^Geist(,|$)' <<<"$families"; then
        warn "the Geist font is not installed; the theme falls back to your system font. Get it from https://vercel.com/font"
    fi
fi

say "Done. Restart open apps to see the GTK colors. Undo everything with ./uninstall.sh"
