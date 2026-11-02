# Contributing

Thanks for looking. A few rules keep the design coherent.

- **Edit the source, not the output.** Colours, radii, spacing and type live in `tokens/tokens.toml`; CSS comes from `templates/`. Run `python3 tools/build.py` and commit the regenerated files. `python3 tools/build.py --check` must be clean.
- **Keep contrast passing.** `python3 tools/check_contrast.py` reads its pairs from the tokens; new surfaces need new pairs.
- **Test the installer in a throwaway home.** `bash tests/test_install.sh` never touches your real settings. Do not run `install.sh` against a session you care about without `--dry-run` first.
- **Look at it.** `tools/shell_qa.py` renders every scene in a headless GNOME Shell under a memory cap (see its `--help`). Attach screenshots to visual changes.
- **Licence.** Contributions are under GPL-3.0-or-later, like the rest of the project.

Open an issue before large changes so the direction can be agreed first.
