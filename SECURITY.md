# Security

The installer changes user-level GNOME settings, copies themes and extensions into your home directory, and (only when you run `install-boot.sh` with `sudo`) writes GRUB and Plymouth files. Every change is backed up and `uninstall.sh` restores it.

To report a problem privately, use GitHub's "Report a vulnerability" button on the Security tab, or email Hamza Gouda <hraafat357@gmail.com>. Please do not open a public issue for something exploitable.
