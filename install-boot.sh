#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) Hamza Gouda
# Optional: install (or remove) the Bordeaux GRUB menu and Plymouth boot splash.
# Needs root. Tested on Ubuntu 24.04. Try --dry-run first.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GRUB_DIR=/boot/grub/themes/bordeaux
GRUB_CFG=/etc/default/grub.d/90-bordeaux-gnome.cfg
PLY_DIR=/usr/share/plymouth/themes/bordeaux
PLY_FILE=$PLY_DIR/bordeaux.plymouth
PLY_LINK=/usr/share/plymouth/themes/default.plymouth
BACKUP_DIR=/var/lib/bordeaux-gnome/boot-backup

DRY=0
REMOVE=0
ONLY=all
VARIANT=Bordeaux

usage() {
    cat <<EOF
usage: sudo $(basename "$0") [--only grub|plymouth] [--remove] [--dry-run]
       [--variant bordeaux|oxblood-noir|merlot-day]
EOF
}

while [ $# -gt 0 ]; do
    case $1 in
        --only) ONLY=${2:?missing grub or plymouth}; shift 2 ;;
        -v|--variant) VARIANT=${2:?missing variant name}; shift 2 ;;
        --remove) REMOVE=1; shift ;;
        -n|--dry-run) DRY=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done
case $VARIANT in
    bordeaux|Bordeaux) VARIANT=Bordeaux ;;
    oxblood-noir|noir|Oxblood-Noir) VARIANT=Oxblood-Noir ;;
    merlot-day|merlot|Merlot-Day) VARIANT=Merlot-Day ;;
    *) echo "unknown variant: $VARIANT" >&2; usage >&2; exit 2 ;;
esac
case $ONLY in all|grub|plymouth) ;; *) usage >&2; exit 2 ;; esac

if [ "$DRY" = 0 ] && [ "$(id -u)" != 0 ]; then
    echo "run as root (sudo), or add --dry-run to preview" >&2
    exit 1
fi

say() { printf '%s\n' "$*"; }
run() {
    if [ "$DRY" = 1 ]; then
        printf '  would run:'; printf ' %q' "$@"; printf '\n'
    else
        "$@"
    fi
}

# Root-owned first-install snapshots. Reinstalling keeps the original assets;
# removing without a snapshot never deletes a coincidentally named theme.
backup_asset() {
    local path=$2 slot=$BACKUP_DIR/$1
    [ ! -f "$slot/recorded" ] || return 0
    say "Saving original $path in $slot"
    [ "$DRY" = 0 ] || return 0
    install -d -m0700 "$BACKUP_DIR" "$slot"
    if [ -e "$path" ] || [ -L "$path" ]; then cp -a -- "$path" "$slot/original"; fi
    : > "$slot/recorded"
}

restore_asset() {
    local path=$2 slot=$BACKUP_DIR/$1
    if [ ! -f "$slot/recorded" ]; then
        say "No saved original for $path; leaving it unchanged"
        return 0
    fi
    run rm -rf -- "$path"
    if [ -e "$slot/original" ] || [ -L "$slot/original" ]; then
        run mkdir -p "$(dirname "$path")"
        run cp -a -- "$slot/original" "$path"
    fi
    run rm -rf -- "$slot"
}

grub_install() {
    say "Installing the GRUB theme to $GRUB_DIR"
    backup_asset grub-theme "$GRUB_DIR"
    backup_asset grub-config "$GRUB_CFG"
    run mkdir -p "$GRUB_DIR"
    run cp "$ROOT"/boot/grub/bordeaux/* "$GRUB_DIR/"
    if [ -f "$ROOT/wallpapers/grub/$VARIANT.png" ]; then
        run cp "$ROOT/wallpapers/grub/$VARIANT.png" "$GRUB_DIR/background.png"
    else
        say "  no GRUB image for $VARIANT; using the plain background color"
        run sed -i '/^desktop-image:/d' "$GRUB_DIR/theme.txt"
    fi
    run mkdir -p "$(dirname "$GRUB_CFG")"
    if [ "$DRY" = 1 ]; then
        say "  would write $GRUB_CFG"
    else
        printf 'GRUB_THEME="%s/theme.txt"\n' "$GRUB_DIR" > "$GRUB_CFG"
    fi
    run update-grub
}

grub_remove() {
    say "Removing the GRUB theme"
    restore_asset grub-config "$GRUB_CFG"
    restore_asset grub-theme "$GRUB_DIR"
    run update-grub
}

plymouth_install() {
    say "Installing the Plymouth splash to $PLY_DIR"
    backup_asset plymouth-theme "$PLY_DIR"
    if [ ! -f "$BACKUP_DIR/plymouth-selection" ]; then
        if [ "$DRY" = 1 ]; then
            say "  would save original Plymouth selection and registration"
        else
            if update-alternatives --query default.plymouth > "$BACKUP_DIR/plymouth-selection.tmp"; then
                mv "$BACKUP_DIR/plymouth-selection.tmp" "$BACKUP_DIR/plymouth-selection"
            else
                rm -f "$BACKUP_DIR/plymouth-selection.tmp"
                : > "$BACKUP_DIR/plymouth-selection"
            fi
        fi
    fi
    run mkdir -p "$PLY_DIR"
    run cp "$ROOT"/boot/plymouth/bordeaux/* "$PLY_DIR/"
    if ! grep -qxF "Alternative: $PLY_FILE" "$BACKUP_DIR/plymouth-selection" 2>/dev/null; then
        run update-alternatives --install "$PLY_LINK" default.plymouth "$PLY_FILE" 100
    fi
    run update-alternatives --set default.plymouth "$PLY_FILE"
    run update-initramfs -u
}

plymouth_remove() {
    say "Removing the Plymouth splash"
    local selection=$BACKUP_DIR/plymouth-selection original status
    if [ ! -f "$selection" ]; then
        say "No saved Plymouth selection; leaving the splash unchanged"
        return 0
    fi
    if ! grep -qxF "Alternative: $PLY_FILE" "$selection"; then
        run update-alternatives --remove default.plymouth "$PLY_FILE"
    fi
    restore_asset plymouth-theme "$PLY_DIR"
    original=$(sed -n 's/^Value: //p' "$selection")
    status=$(sed -n 's/^Status: //p' "$selection")
    if [ "$status" = auto ]; then
        run update-alternatives --auto default.plymouth
    elif [ -n "$original" ] && [ -e "$original" ]; then
        run update-alternatives --set default.plymouth "$original"
    else
        say "Original Plymouth selection unavailable; inspect update-alternatives before rebooting"
    fi
    run rm -f "$selection"
    run update-initramfs -u
}

if [ "$REMOVE" = 1 ]; then
    [ "$ONLY" != plymouth ] && grub_remove
    [ "$ONLY" != grub ] && plymouth_remove
else
    [ "$ONLY" != plymouth ] && grub_install
    [ "$ONLY" != grub ] && plymouth_install
fi
say "Done. The changes show on the next boot."
