#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Optional: install (or remove) the Bordeaux GRUB menu and Plymouth boot splash.
# Needs root. Tested on Ubuntu 24.04. Try --dry-run first.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
GRUB_DIR=/boot/grub/themes/bordeaux
GRUB_CFG=/etc/default/grub.d/90-bordeaux-gnome.cfg
PLY_DIR=/usr/share/plymouth/themes/bordeaux
PLY_FILE=$PLY_DIR/bordeaux.plymouth
PLY_LINK=/usr/share/plymouth/themes/default.plymouth

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

grub_install() {
    say "Installing the GRUB theme to $GRUB_DIR"
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
    run rm -f "$GRUB_CFG"
    run rm -rf "$GRUB_DIR"
    run update-grub
}

plymouth_install() {
    say "Installing the Plymouth splash to $PLY_DIR"
    run mkdir -p "$PLY_DIR"
    run cp "$ROOT"/boot/plymouth/bordeaux/* "$PLY_DIR/"
    run update-alternatives --install "$PLY_LINK" default.plymouth "$PLY_FILE" 100
    run update-alternatives --set default.plymouth "$PLY_FILE"
    run update-initramfs -u
}

plymouth_remove() {
    say "Removing the Plymouth splash"
    run update-alternatives --remove default.plymouth "$PLY_FILE"
    run rm -rf "$PLY_DIR"
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
