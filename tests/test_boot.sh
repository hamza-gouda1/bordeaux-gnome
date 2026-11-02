#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) Hamza Gouda
# Exercise only the boot installer's filesystem snapshot functions in a temp tree.
set -euo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
python3 - "$ROOT/install-boot.sh" <<'PYTHON'
from pathlib import Path
import subprocess
import sys
import tempfile
source = Path(sys.argv[1]).read_text()
functions = source[source.index("backup_asset()"):source.index("\ngrub_install()")]
with tempfile.TemporaryDirectory() as td:
    base = Path(td)
    destination = base / "theme"
    destination.mkdir()
    (destination / "original").write_text("original")
    script = ("set -euo pipefail\nDRY=0\nBACKUP_DIR=" + str(base / "backup")
              + '\nsay(){ :; }\nrun(){ "$@"; }\n' + functions)
    script += '\nbackup_asset theme "$1"\nrm -rf -- "$1"\nmkdir -p "$1"\n'
    script += 'printf changed > "$1/new"\nbackup_asset theme "$1"\n'
    script += 'restore_asset theme "$1"\nrestore_asset absent "$1"\n'
    subprocess.run(["bash", "-c", script, "test", str(destination)], check=True)
    assert (destination / "original").read_text() == "original"
    assert not (destination / "new").exists()
print("boot snapshot tests passed (no privileged commands)")
PYTHON
