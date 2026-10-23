# Changelog

## [Unreleased]

First public version.

- Three variants: Bordeaux and Oxblood Noir (dark), Merlot Day (light),
  each with a GNOME Shell theme and GTK 3 / GTK 4 colors.
- `install.sh` / `uninstall.sh`: per-user install with a saved backup,
  variant switching and `--dry-run`.
- `install-boot.sh`: optional GRUB menu theme and Plymouth boot splash.
- `tools/check_contrast.py`: WCAG check of every color pair, read from the
  CSS; runs in CI with shellcheck and an install/uninstall test.
