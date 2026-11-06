# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) Hamza Gouda
"""Check the Shell QA runner's failure handling without starting GNOME Shell."""

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import shell_qa


class ShellQARunnerTests(unittest.TestCase):
    def test_metrics_alone_do_not_prove_completion(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / "metrics.json").write_text("{}")
            failures, _ = shell_qa.check("Bordeaux", out)
            self.assertTrue(failures)

    def test_scope_failure_blocks_publication_even_with_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            results = []
            for variant, status in (("Bordeaux", 0), ("Merlot-Day", 124)):
                out = Path(tmp) / variant
                out.mkdir()
                (out / "metrics.json").write_text("{}")
                (out / "DONE").write_text("ok")
                results.append((out, status))
            argv = ["shell_qa.py", "--variant", "Bordeaux,Merlot-Day", "--scene", "desktop",
                    "--out", tmp, "--publish", str(Path(tmp) / "screenshots")]
            with patch.object(sys, "argv", argv), contextlib.redirect_stdout(io.StringIO()), \
                    patch.object(shell_qa, "run_variant", side_effect=results), \
                    patch.object(shell_qa, "publish") as publish, \
                    self.assertRaises(SystemExit) as failure:
                shell_qa.main()
            self.assertEqual(failure.exception.code, 1)
            publish.assert_not_called()


if __name__ == "__main__":
    unittest.main()
