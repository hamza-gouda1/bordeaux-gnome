#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) Hamza Gouda
# Install a Bordeaux variant for the current user. No root needed.
# The first run saves your current settings; uninstall.sh puts them back.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DATA=${XDG_DATA_HOME:-$HOME/.local/share}
CONF=${XDG_CONFIG_HOME:-$HOME/.config}
STATE=${XDG_STATE_HOME:-$HOME/.local/state}/bordeaux-gnome
LEGACY_BACKUP=0
if [ -d "$STATE/backup" ] && [ ! -d "$STATE/backup/assets" ]; then
    LEGACY_BACKUP=1
fi
USER_THEME_EXT=user-theme@gnome-shell-extensions.gcampax.github.com

VARIANT=bordeaux
DRY=0
WALLPAPER=0
PRESET=1
ICONS=0
CURSOR=0
TERM_DEFAULT=0
SHORTCUTS=1
FOCUS_UUID=focus-keys@hamza-gouda
FOCUS_SCHEMA=org.gnome.shell.extensions.focus-keys
# App shortcuts the Focus Keys extension gets by default (ACCELERATOR=desktop id).
FOCUS_DEFAULTS=("<Control>F9=spotify.desktop")
FOLLOW=1
AURA_UUID=bordeaux-aura@hamza-gouda
AURA_SCHEMA=org.gnome.shell.extensions.bordeaux-aura
LIGHT_THEME=Merlot-Day

usage() {
    cat <<EOF
usage: $(basename "$0") [--variant NAME] [--wallpaper] [--dry-run]
       [--no-preset] [--icons] [--cursor] [--terminal-default] [--no-shortcuts] [--static]

  -v, --variant NAME   bordeaux (default), oxblood-noir, merlot-day: the one shown
                       now. The desktop then follows the Dark Style switch: Merlot
                       Day when it is off, the dark variant (bordeaux unless you
                       chose oxblood-noir) when it is on
      --static         one variant only, no following (no Bordeaux Aura extension)
      --wallpaper      also set the wallpapers: Merlot Day for light, the dark
                       variant's for dark (with --static, the variant's for both)
  -n, --dry-run        print what would change, change nothing
      --no-preset      skip the desktop preset (fonts, Ubuntu Dock, Blur my Shell,
                       Just Perfection) and the GNOME Terminal profile
      --icons          also set the recommended icon theme, if installed
      --cursor         also set the recommended cursor theme, if installed
      --terminal-default  make the Bordeaux Terminal profile the default one
      --no-shortcuts   skip the Focus Keys extension (app shortcuts that bring an
                       open window to the front instead of an "is ready"
                       notification) and its default Control+F9 = Spotify
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
        --no-shortcuts) SHORTCUTS=0; shift ;;
        --static) FOLLOW=0; shift ;;
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
if [ "$SCHEME" = prefer-dark ]; then DARK_THEME=$THEME; else DARK_THEME=Bordeaux; fi

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
    chmod 0700 "$STATE" "$STATE/backup"
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

# Preserve the first state of every destination we own, including symlinks.
# A marker also records absence, so reinstalling never backs up our own copy.
snapshot_asset() {
    local key=$1 dest=$2 saved="$STATE/backup/assets/$1"
    [ ! -f "$saved.recorded" ] || return 0
    if [ "$DRY" = 1 ]; then
        say "  would preserve $dest for uninstall"
        return
    fi
    mkdir -p "$STATE/backup/assets"
    chmod 0700 "$STATE/backup/assets"
    if [ "$LEGACY_BACKUP" = 1 ]; then
        case "$key" in
            gtk-*.css)
                local version=${key#gtk-}
                version=${version%.css}
                if [ -e "$STATE/backup/gtk-$version.0.css" ]; then
                    cp -a -- "$STATE/backup/gtk-$version.0.css" "$saved"
                fi
                : > "$saved.recorded"
                return
                ;;
            theme-*)
                if grep -q 'Bordeaux Design System' "$dest/gnome-shell/gnome-shell.css" 2>/dev/null; then
                    : > "$saved.recorded"
                    return
                fi
                ;;
        esac
    fi
    if [ -e "$dest" ] || [ -L "$dest" ]; then
        cp -a -- "$dest" "$saved"
    fi
    : > "$saved.recorded"
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
    local theme=${1:-$THEME} file uuid base list def new line key value
    file="$ROOT/terminal/$theme.dconf"
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
    say "Adding the $theme GNOME Terminal profile"
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
    if [ "$TERM_DEFAULT" = 1 ] && [ "$theme" = "$THEME" ]; then
        def=default
        preset_backup org.gnome.Terminal.ProfilesList "$def"
        gs_run set org.gnome.Terminal.ProfilesList "$def" "'$uuid'"
    fi
}

# ---- Focus Keys: app shortcuts handled by the shell ----
FSTATE=$STATE/focus-keys

# focus_merge CURRENT ENTRY...: CURRENT is the bindings value (GVariant text).
# Prints the merged list on the first line, then "add<TAB>entry" or
# "skip<TAB>entry<TAB>why" per entry. A key that already has an entry (the
# user's own choice) or is used by a GNOME custom shortcut is skipped.
focus_merge() {
    python3 - "$@" <<'PY'
import re
import sys

from gi.repository import Gio, GLib

ALIAS = {"ctrl": "control", "ctl": "control", "primary": "control", "mod1": "alt", "mod4": "super"}


def norm(a):
    mods, rest = set(), a.strip()
    while (m := re.match(r"<([^>]+)>", rest)):
        n = m.group(1).lower()
        mods.add(ALIAS.get(n, n))
        rest = rest[m.end():]
    k = rest.strip().lower()
    return "".join(f"<{x}>" for x in sorted(mods)) + (k[4:] if k.startswith("xf86") else k)


def custom():
    mk = "org.gnome.settings-daemon.plugins.media-keys"
    if not Gio.SettingsSchemaSource.get_default().lookup(mk, True):
        return {}
    out = {}
    for p in Gio.Settings.new(mk).get_strv("custom-keybindings"):
        c = Gio.Settings.new_with_path(mk + ".custom-keybinding", p)
        if c.get_string("binding"):
            out[norm(c.get_string("binding"))] = c.get_string("name")
    return out


cur = list(GLib.Variant.parse(GLib.VariantType("as"), sys.argv[1]).unpack())
have = {norm(e.rpartition("=")[0]) for e in cur if "=" in e}
taken = custom()
lines = []
for e in sys.argv[2:]:
    k = norm(e.rpartition("=")[0])
    if e in cur:
        lines.append(f"have\t{e}")
    elif k in have:
        lines.append(f"skip\t{e}\tthat key already has a Focus Keys shortcut")
    elif k in taken:
        lines.append(f"skip\t{e}\tthe GNOME custom shortcut \"{taken[k]}\" uses that key")
    else:
        cur.append(e)
        have.add(k)
        lines.append(f"add\t{e}")
print(GLib.Variant("as", cur).print_(False))
print("\n".join(lines))
PY
}

install_focus_keys() {
    local src="$ROOT/extensions/$FOCUS_UUID" dest="$DATA/gnome-shell/extensions/$FOCUS_UUID"
    local cur merged new verb entry why
    say "Installing the Focus Keys extension (app shortcuts that bring an open window to the front)"
    snapshot_asset "extension-$FOCUS_UUID" "$dest"
    run rm -rf "$dest"
    run mkdir -p "$dest"
    run cp -r "$src/." "$dest/"
    if command -v glib-compile-schemas >/dev/null 2>&1; then
        run glib-compile-schemas "$dest/schemas"
    else
        warn "glib-compile-schemas is missing (Ubuntu: libglib2.0-bin); Focus Keys cannot load its settings"
    fi
    [ "$DRY" = 1 ] || mkdir -p "$FSTATE"

    add_enabled "$FOCUS_UUID" "$FSTATE"

    # In a dry run the schema may not be installed yet: start from an empty list.
    if has_pkey "$FOCUS_SCHEMA" bindings; then
        cur=$(gs get "$FOCUS_SCHEMA" bindings)
    else
        cur="@as []"
    fi
    if [ "$DRY" = 0 ] && [ ! -f "$FSTATE/bindings.orig" ]; then
        printf '%s\n' "$cur" > "$FSTATE/bindings.orig"
    fi
    merged=$(focus_merge "$cur" "${FOCUS_DEFAULTS[@]}")
    new=$(head -1 <<<"$merged")
    while IFS=$'\t' read -r verb entry why; do
        case $verb in
            add)
                say "  shortcut ${entry%=*} -> ${entry##*=}"
                if [ "$DRY" = 0 ]; then printf '%s\n' "$entry" >> "$FSTATE/bindings-added"; fi ;;
            skip) warn "not adding the shortcut $entry: $why" ;;
        esac
    done < <(sed 1d <<<"$merged")
    if [ "$new" != "$cur" ]; then
        gs_run set "$FOCUS_SCHEMA" bindings "$new"
    fi
    say "  Focus Keys starts after you log out and back in; change its shortcuts in the Extensions app."
}

# ---- Bordeaux Aura: dock glow and light/dark following ----
ASTATE=$STATE/aura

# add_enabled UUID STATEDIR: append to enabled-extensions; STATEDIR/enabled-by-us marks it.
add_enabled() {
    local uuid=$1 st=$2 exts
    has_key org.gnome.shell enabled-extensions || return 0
    exts=$(gsettings get org.gnome.shell enabled-extensions)
    case $exts in
        *"'$uuid'"*) return 0 ;;
        "@as []"|"[]") exts="['$uuid']" ;;
        *) exts="${exts%]}, '$uuid']" ;;
    esac
    run gsettings set org.gnome.shell enabled-extensions "$exts"
    if [ "$DRY" = 0 ]; then mkdir -p "$st"; : > "$st/enabled-by-us"; fi
}

install_aura() {
    local src="$ROOT/extensions/$AURA_UUID" dest="$DATA/gnome-shell/extensions/$AURA_UUID"
    say "Installing the Bordeaux Aura extension: dock glow, and the desktop follows Dark Style ($LIGHT_THEME light, $DARK_THEME dark)"
    if [ "$DRY" = 0 ]; then
        mkdir -p "$ASTATE"
        # Remember whether a copy existed; the asset snapshot restores it exactly.
        if [ -e "$dest" ] && [ ! -e "$ASTATE/installed-by-us" ]; then : > "$ASTATE/preexisting"; fi
        : > "$ASTATE/installed-by-us"
    fi
    snapshot_asset "extension-$AURA_UUID" "$dest"
    run rm -rf "$dest"
    run mkdir -p "$dest"
    run cp -r "$src/." "$dest/"
    if command -v glib-compile-schemas >/dev/null 2>&1; then
        run glib-compile-schemas "$dest/schemas"
    else
        warn "glib-compile-schemas is missing (Ubuntu: libglib2.0-bin); Bordeaux Aura cannot load its settings"
    fi
    add_enabled "$AURA_UUID" "$ASTATE"
    if [ "$DRY" = 1 ]; then
        say "  would set $AURA_SCHEMA follow-color-scheme true, dark-variant '$DARK_THEME' (backed up first)"
    else
        preset_set "$AURA_SCHEMA" follow-color-scheme true
        preset_set "$AURA_SCHEMA" dark-variant "'$DARK_THEME'"
    fi
}

say "Installing Bordeaux GNOME: $THEME"
backup

say "Copying the three themes to $DATA/themes"
run mkdir -p "$DATA/themes"
for dir in "$ROOT"/themes/*/; do
    name=$(basename "$dir")
    snapshot_asset "theme-$name" "$DATA/themes/$name"
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
    snapshot_asset "gtk-$v.css" "$CONF/gtk-$v.0/gtk.css"
    run rm -f "$CONF/gtk-$v.0/gtk.css"
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
    bg="$DATA/backgrounds/bordeaux-gnome"
    if [ "$FOLLOW" = 1 ]; then
        # GNOME itself shows picture-uri in light style and picture-uri-dark in dark style.
        # All three are copied so the aura extension can follow a change of dark variant.
        light=$LIGHT_THEME dark=$DARK_THEME
    else
        light=$THEME dark=$THEME
    fi
    if [ -f "$ROOT/wallpapers/$light.jpg" ] && [ -f "$ROOT/wallpapers/$dark.jpg" ]; then
        snapshot_asset wallpapers "$bg"
        run mkdir -p "$bg"
        for w in "$ROOT"/wallpapers/*.jpg; do
            if [ "$FOLLOW" = 1 ] || [ "$(basename "$w")" = "$THEME.jpg" ]; then run cp "$w" "$bg/"; fi
        done
        say "Wallpapers: $light (light style), $dark (dark style)"
        set_key org.gnome.desktop.background picture-uri "file://$bg/$light.jpg"
        set_key org.gnome.desktop.background picture-uri-dark "file://$bg/$dark.jpg"
    else
        warn "no wallpaper in $ROOT/wallpapers; skipping"
    fi
fi

if [ "$FOLLOW" = 1 ]; then
    install_aura
fi

if [ "$PRESET" = 1 ] || [ "$ICONS" = 1 ] || [ "$CURSOR" = 1 ]; then
    say "Applying the desktop preset (backed up first)"
    apply_preset
fi
if [ "$PRESET" = 1 ]; then
    apply_terminal "$THEME"
    # Following: the other style's profile too, so the extension can make it the default.
    if [ "$FOLLOW" = 1 ]; then
        for t in "$LIGHT_THEME" "$DARK_THEME"; do
            if [ "$t" != "$THEME" ]; then apply_terminal "$t"; fi
        done
    fi
fi

if [ "$SHORTCUTS" = 1 ]; then
    install_focus_keys
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
