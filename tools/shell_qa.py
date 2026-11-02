#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) Hamza Gouda
"""Visual QA of the shell theme in a real, headless GNOME Shell 46.

    tools/shell_qa.py --variant Bordeaux --out /tmp/qa            # every scene
    tools/shell_qa.py --variant all --scene desktop,quick-settings --out /tmp/qa
    tools/shell_qa.py --variant all --out /tmp/qa --publish screenshots

For each variant it builds a throwaway HOME (themes, the variant's preset, the
Bordeaux Aura and TUF Control Quick Settings extensions, a fixed set of apps),
then runs `gnome-shell --headless` in it with the QA harness extension
(tools/qa/harness), which opens each surface and saves a PNG per scene plus
metrics.json. The script then checks the metrics (top-bar font size, equal dock
slab margins, centred dock icons, cut-off labels, extension errors) and exits 1
when one fails.

Isolation, by design:
  * private session bus (dbus-run-session) and a private *system* bus served by
    tools/qa/mockbus.js, so the shell never reaches the machine's logind,
    NetworkManager, BlueZ, UPower or asusd; every network/device it shows is fake;
  * private HOME / XDG dirs / runtime dir; GSettings use the keyfile backend in
    that HOME, so dconf of the real session is never read or written;
  * curated XDG_DATA_DIRS (no apps or search providers from the real HOME);
  * the whole tree runs in one `systemd-run --user --scope` with MemoryMax and
    no swap, under `timeout`, one variant at a time; the scope is stopped
    afterwards so nothing is left running.

Needs: gnome-shell 46, ubuntu-dock, user-theme, blur-my-shell and just-perfection
installed (system or user), gjs, dbus-daemon; Pillow for --publish.
Optional: pipewire + pipewire-pulse + pactl (volume slider; --no-audio skips).
"""

import argparse
import configparser
import json
import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
QA = ROOT / "tools" / "qa"
VARIANTS = {
    # name: (color-scheme, gtk theme, icon theme), as install.sh sets them
    "Bordeaux": ("prefer-dark", "Yaru-dark", "Yaru-dark"),
    "Oxblood-Noir": ("prefer-dark", "Yaru-dark", "Yaru-dark"),
    "Merlot-Day": ("prefer-light", "Yaru", "Yaru"),
}
SCENES = ["desktop", "dock", "aura-cpu", "quick-settings", "notifications", "osd", "overview",
          "alt-tab", "workspace-switcher", "run-dialog", "end-session", "profile-osd", "focus-keys", "show-desktop", "color-scheme", "lock"]
FAVOURITES = ["org.gnome.Nautilus.desktop", "org.gnome.Terminal.desktop", "org.gnome.TextEditor.desktop",
              "com.microsoft.VSCode.desktop", "org.gnome.Loupe.desktop",
              "org.gnome.Calendar.desktop", "org.gnome.Settings.desktop", "org.gnome.Software.desktop"]
# Opened as windows: running dots in the dock, windows in the overview.
OPEN_APPS = ["org.gnome.Nautilus.desktop", "org.gnome.Terminal.desktop", "org.gnome.Calculator.desktop"]
# Only these .desktop files are visible to the private shell (plus Settings panels for search).
APPS = FAVOURITES + OPEN_APPS + [
    "org.gnome.Characters.desktop", "org.gnome.clocks.desktop", "org.gnome.baobab.desktop",
    "org.gnome.DiskUtility.desktop", "org.gnome.Evince.desktop", "org.gnome.FileRoller.desktop",
    "org.gnome.font-viewer.desktop", "org.gnome.Logs.desktop",
    "org.gnome.SystemMonitor.desktop", "org.gnome.Snapshot.desktop", "org.gnome.tweaks.desktop",
    "org.gnome.Shell.Extensions.desktop", "org.gnome.seahorse.Application.desktop",
    "org.gnome.PowerStats.desktop", "org.gnome.Terminal.Preferences.desktop",
    "software-properties-gtk.desktop", "update-manager.desktop", "im-config.desktop",
]
SEARCH_PROVIDERS = ["org.gnome.Nautilus.search-provider.ini", "org.gnome.Calculator-search-provider.ini",
                    "org.gnome.Settings.search-provider.ini", "gnome-terminal-search-provider.ini"]
USER_THEME = "user-theme@gnome-shell-extensions.gcampax.github.com"
AURA = "bordeaux-aura@hamza-gouda"
FOCUS = "focus-keys@hamza-gouda"
TUF = "tuf-control-quick@hamza-gouda"
HARNESS = "bordeaux-qa@harness"
ENABLED = [USER_THEME, "ubuntu-dock@ubuntu.com", "ubuntu-appindicators@ubuntu.com",
           "blur-my-shell@aunetx", "just-perfection-desktop@just-perfection", AURA, FOCUS, TUF, HARNESS]
EXT_DIRS = [pathlib.Path.home() / ".local/share/gnome-shell/extensions",
            pathlib.Path("/usr/local/share/gnome-shell/extensions"),
            pathlib.Path("/usr/share/gnome-shell/extensions")]
DEFAULT_TUF = pathlib.Path.home() / "projects/tuf-control/extension" / TUF


def find_ext(uuid):
    for d in EXT_DIRS:
        if (d / uuid / "metadata.json").is_file():
            return d / uuid
    return None


# ---------------------------------------------------------------------- settings
def schema_paths(dirs):
    """schema id -> (path, {key: default text}) from the system and extension schema dirs."""
    import gi
    gi.require_version("Gio", "2.0")
    from gi.repository import Gio

    src = Gio.SettingsSchemaSource.get_default()
    for d in dirs:
        if (d / "gschemas.compiled").is_file():
            src = Gio.SettingsSchemaSource.new_from_directory(str(d), src, False)

    def look(sid):
        s = src.lookup(sid, True)
        if not s:
            return None
        return s.get_path(), {k: s.get_key(k).get_default_value().print_(True) for k in s.list_keys()}
    return look


def build_keyfile(variant, home, ext_schema_dirs, text_scale, wallpaper):
    scheme, gtk, icons = VARIANTS[variant]
    look = schema_paths(ext_schema_dirs)
    kf = {}

    def put(sid, key, value, path=None):
        info = look(sid)
        if info is None:
            print(f"  (schema {sid} not installed, {key} skipped)")
            return
        p = path or info[0]
        if not p:
            raise SystemExit(f"{sid} is relocatable, needs a path")
        if value.startswith("merge:"):  # same as install.sh: add to the schema default
            ours, cur = value[6:], info[1].get(key, "{}")
            cur = "" if cur.endswith("{}") else cur.rstrip("}") + ", "
            value = (cur + ours.lstrip("{")) if cur else ours
        kf.setdefault(p.strip("/"), {})[key] = value

    for line in (ROOT / "presets" / f"{variant}.preset").read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        group, sid, key, value = line.split(None, 3)
        if group == "core":
            put(sid, key, value)
    q = lambda s: "'" + s + "'"  # noqa: E731
    ql = lambda xs: "[" + ", ".join(q(x) for x in xs) + "]"  # noqa: E731
    put("org.gnome.shell", "enabled-extensions", ql(ENABLED))
    put("org.gnome.shell", "disabled-extensions", ql(["ding@rastersoft.com", "tiling-assistant@ubuntu.com"]))
    put("org.gnome.shell", "disable-user-extensions", "false")
    put("org.gnome.shell", "favorite-apps", ql(FAVOURITES))
    put("org.gnome.shell", "welcome-dialog-last-shown-version", q("999"))
    # Two app-grid folders, so the folder tile and the opened folder dialog can be checked.
    folders = {"System": ["org.gnome.SystemMonitor.desktop", "org.gnome.Logs.desktop",
                          "org.gnome.DiskUtility.desktop", "org.gnome.baobab.desktop"],
               "Utilities": ["org.gnome.Characters.desktop", "org.gnome.clocks.desktop",
                             "org.gnome.font-viewer.desktop", "org.gnome.Evince.desktop"]}
    put("org.gnome.desktop.app-folders", "folder-children", ql(folders))
    for fname, fapps in folders.items():
        fpath = f"/org/gnome/desktop/app-folders/folders/{fname}/"
        put("org.gnome.desktop.app-folders.folder", "name", q(fname), fpath)
        put("org.gnome.desktop.app-folders.folder", "apps", ql(fapps), fpath)
        put("org.gnome.desktop.app-folders.folder", "translate", "false", fpath)
    put("org.gnome.shell.extensions.user-theme", "name", q(variant))
    put("org.gnome.shell.extensions.bordeaux-aura", "dark-variant", q(variant if variant != "Merlot-Day" else "Bordeaux"))
    put("org.gnome.desktop.interface", "color-scheme", q(scheme))
    put("org.gnome.desktop.interface", "gtk-theme", q(gtk))
    put("org.gnome.desktop.interface", "icon-theme", q(icons))
    put("org.gnome.desktop.interface", "text-scaling-factor", str(text_scale))
    put("org.gnome.desktop.interface", "enable-hot-corners", "false")
    uri = q(wallpaper.as_uri())
    for sid in ("org.gnome.desktop.background", "org.gnome.desktop.screensaver"):
        put(sid, "picture-uri", uri)
        put(sid, "picture-options", q("zoom"))
    put("org.gnome.desktop.background", "picture-uri-dark", uri)
    put("org.gnome.desktop.notifications", "show-banners", "true")
    put("org.gnome.desktop.search-providers", "sort-order", ql(["org.gnome.Settings.desktop",
                                                               "org.gnome.Nautilus.desktop"]))
    # The Terminal profile the preset installs, as the default profile.
    dconf = ROOT / "terminal" / f"{variant}.dconf"
    if dconf.is_file():
        uuid = None
        for line in dconf.read_text().splitlines():
            if line.startswith("[:"):
                uuid = line[2:-1]
            elif "=" in line and uuid and not line.startswith("#"):
                k, v = line.split("=", 1)
                put("org.gnome.Terminal.Legacy.Profile", k, v,
                    f"/org/gnome/terminal/legacy/profiles:/:{uuid}/")
        if uuid:
            put("org.gnome.Terminal.ProfilesList", "list", ql([uuid]), "/org/gnome/terminal/legacy/profiles:/")
            put("org.gnome.Terminal.ProfilesList", "default", q(uuid), "/org/gnome/terminal/legacy/profiles:/")
    out = []
    for group in sorted(kf):
        out.append(f"[{group}]")
        out += [f"{k}={v}" for k, v in kf[group].items()]
        out.append("")
    return "\n".join(out)


# ---------------------------------------------------------------------- the tree
def font_dirs():
    """Directories holding Geist, which may live in the real HOME (read only)."""
    try:
        out = subprocess.run(["fc-list", ":", "file", "family"], capture_output=True, text=True).stdout
    except OSError:
        return []
    dirs = {str(pathlib.Path(line.split(":")[0]).parent) for line in out.splitlines() if "Geist" in line}
    return sorted(dirs)


def build_tree(variant, base, args):
    home = base / "home"
    data, conf = home / ".local/share", home / ".config"
    for d in (data, conf, home / ".cache", home / ".local/state"):
        d.mkdir(parents=True, exist_ok=True)
    for sub in ("Documents", "Downloads", "Music", "Pictures", "Videos", "Projects/bordeaux-gnome"):
        (home / sub).mkdir(parents=True, exist_ok=True)
    (home / "Documents/tasting-notes.md").write_text("# Notes\n")
    (home / ".sudo_as_admin_successful").write_text("")  # no sudo hint in Terminal
    (conf / "user-dirs.dirs").write_text("".join(
        f'XDG_{k}_DIR="$HOME/{v}"\n' for k, v in [("DOCUMENTS", "Documents"), ("DOWNLOAD", "Downloads"),
                                                 ("MUSIC", "Music"), ("PICTURES", "Pictures"),
                                                 ("VIDEOS", "Videos"), ("DESKTOP", "")]))
    # A neutral prompt: no real user or host name in the Terminal window.
    (home / ".bashrc").write_text(
        "PS1='\\[\\e[38;5;174m\\]bordeaux\\[\\e[0m\\] \\w \\$ '\nunset PROMPT_COMMAND\n"
        "printf '\\n  Bordeaux GNOME  \\e[2m%s\\e[0m\\n\\n' \"$(date +%A)\"\n"
        "for i in 1 2 3 4 5 6; do printf '\\e[4%sm    \\e[0m' $i; done; printf '\\n\\n'\n")

    shutil.copytree(ROOT / "themes", data / "themes")
    for v in ("3", "4"):
        (conf / f"gtk-{v}.0").mkdir(exist_ok=True)
        shutil.copy(ROOT / "themes" / variant / f"gtk-{v}.0/gtk.css", conf / f"gtk-{v}.0/gtk.css")
    wp = data / "backgrounds" / f"{variant}.jpg"
    wp.parent.mkdir(parents=True)
    shutil.copy(ROOT / "wallpapers" / f"{variant}.jpg", wp)

    exts = data / "gnome-shell/extensions"
    exts.mkdir(parents=True)
    schema_dirs = []
    for uuid in (USER_THEME, "blur-my-shell@aunetx", "just-perfection-desktop@just-perfection"):
        src = find_ext(uuid)
        if src is None:
            print(f"  warning: {uuid} is not installed; the run will lack it")
            continue
        if src.parent != pathlib.Path("/usr/share/gnome-shell/extensions"):
            shutil.copytree(src, exts / uuid, ignore=shutil.ignore_patterns("*.git"))
            sd = exts / uuid / "schemas"
            if not sd.is_dir():
                # e.g. User Themes installed by hand keeps its schema in ~/.local/share/glib-2.0
                meta = json.loads((src / "metadata.json").read_text())
                sid = meta.get("settings-schema", "")
                xml = pathlib.Path.home() / f".local/share/glib-2.0/schemas/{sid}.gschema.xml"
                if sid and xml.is_file():
                    sd.mkdir()
                    shutil.copy(xml, sd)
                    subprocess.run(["glib-compile-schemas", str(sd)], check=True)
            schema_dirs.append(sd)
    for uuid, src in ((AURA, ROOT / "extensions" / AURA), (FOCUS, ROOT / "extensions" / FOCUS),
                      (TUF, args.tuf_ext), (HARNESS, QA / "harness")):
        if not src or not (src / "metadata.json").is_file():
            print(f"  warning: {uuid} not found at {src}; skipped")
            continue
        shutil.copytree(src, exts / uuid)
        if (exts / uuid / "schemas").is_dir():
            subprocess.run(["glib-compile-schemas", str(exts / uuid / "schemas")], check=True)
            schema_dirs.append(exts / uuid / "schemas")

    # Curated system data dir: everything from /usr/share except the app list and
    # search providers, which are limited to the set above.
    share = base / "share"
    share.mkdir()
    for entry in pathlib.Path("/usr/share").iterdir():
        if entry.name not in ("applications", "gnome-shell"):
            (share / entry.name).symlink_to(entry)
    (share / "applications").mkdir()
    panels = [p.name for p in pathlib.Path("/usr/share/applications").glob("gnome-*-panel.desktop")]
    for app in dict.fromkeys(APPS + panels):
        if (pathlib.Path("/usr/share/applications") / app).is_file():
            (share / "applications" / app).symlink_to(pathlib.Path("/usr/share/applications") / app)
    gs = share / "gnome-shell"
    gs.mkdir()
    for entry in pathlib.Path("/usr/share/gnome-shell").iterdir():
        if entry.name != "search-providers":
            (gs / entry.name).symlink_to(entry)
    (gs / "search-providers").mkdir()
    for sp in SEARCH_PROVIDERS:
        p = pathlib.Path("/usr/share/gnome-shell/search-providers") / sp
        if p.is_file():
            (gs / "search-providers" / sp).symlink_to(p)

    # ibus-daemon (spawned by the shell) grows by ~60 MB/s in this setup until the
    # scope's MemoryMax kills it; a stub keeps the input-method stack out of the run.
    stub = base / "bin"
    stub.mkdir()
    (stub / "ibus-daemon").write_text("#!/bin/sh\nexit 0\n")
    (stub / "ibus-daemon").chmod(0o755)

    fc = base / "fonts.conf"
    fc.write_text("<?xml version='1.0'?>\n<!DOCTYPE fontconfig SYSTEM 'fonts.dtd'>\n<fontconfig>\n"
                  "  <include ignore_missing='yes'>/etc/fonts/fonts.conf</include>\n"
                  + "".join(f"  <dir>{d}</dir>\n" for d in font_dirs())
                  + f"  <cachedir>{home}/.cache/fontconfig</cachedir>\n</fontconfig>\n")

    # Audio: a private pipewire with one null sink as the default, so the shell's
    # volume slider and OSD have a device (no session manager, no real hardware).
    pwd = conf / "pipewire/pipewire.conf.d"
    pwd.mkdir(parents=True)
    (pwd / "qa.conf").write_text("""context.objects = [
  { factory = adapter
    args = { factory.name = support.null-audio-sink node.name = qa_speakers
             node.description = Speakers media.class = Audio/Sink
             object.linger = true audio.position = [ FL FR ] } }
  { factory = metadata
    args = { metadata.name = default
             metadata.values = [
               { key = default.audio.sink value = { name = qa_speakers } }
               { key = default.configured.audio.sink value = { name = qa_speakers } } ] } }
]
""")

    kfdir = conf / "glib-2.0/settings"
    kfdir.mkdir(parents=True)
    (kfdir / "keyfile").write_text(build_keyfile(variant, home, schema_dirs, args.text_scale, wp))
    return home, share, fc


def private_env(base, home, share, fc, rt, out, args):
    env = {
        "PATH": f"{base}/bin:/usr/local/bin:/usr/bin:/bin", "HOME": str(home), "USER": os.environ.get("USER", "qa"),
        "LOGNAME": os.environ.get("LOGNAME", "qa"), "SHELL": "/bin/bash",
        "LANG": "en_US.UTF-8", "LC_ALL": "en_US.UTF-8",
        "XDG_CONFIG_HOME": str(home / ".config"), "XDG_DATA_HOME": str(home / ".local/share"),
        "XDG_CACHE_HOME": str(home / ".cache"), "XDG_STATE_HOME": str(home / ".local/state"),
        "XDG_RUNTIME_DIR": str(rt), "XDG_DATA_DIRS": str(share), "XDG_CONFIG_DIRS": "/etc/xdg",
        "XDG_CURRENT_DESKTOP": "ubuntu:GNOME", "XDG_SESSION_DESKTOP": "ubuntu",
        "XDG_SESSION_TYPE": "wayland", "XDG_SESSION_CLASS": "user", "XDG_SESSION_ID": "c1",
        "GNOME_SHELL_SESSION_MODE": "ubuntu", "GSETTINGS_BACKEND": "keyfile",
        "GVFS_DISABLE_FUSE": "1", "GIO_USE_VFS": "local", "GTK_USE_PORTAL": "0", "NO_AT_BRIDGE": "1", "GTK_A11Y": "none",
        "FONTCONFIG_FILE": str(fc), "BXQA_PRIVATE": "1", "BXQA_OUT": str(out),
        "BXQA_SCENES": ",".join(args.scene), "BXQA_APPS": ",".join(OPEN_APPS),
        "BXQA_BASE": str(base), "BXQA_WAYLAND": "bxqa-0", "BXQA_SIZE": args.size, "BXQA_AUDIO": "0" if args.no_audio else "1",
    }
    return env


# ---------------------------------------------------------------------- inner side
def log_memory(f):
    """Scope memory and the five largest processes in it, for memory.log."""
    try:
        cg = pathlib.Path("/proc/self/cgroup").read_text().strip().split("::", 1)[1]
        root = pathlib.Path("/sys/fs/cgroup" + cg)
        while root.name and not root.name.endswith(".scope"):
            root = root.parent
        cur = int((root / "memory.current").read_text()) >> 20
        rows = []
        for pid in (root / "cgroup.procs").read_text().split():
            try:
                st = pathlib.Path(f"/proc/{pid}/status").read_text()
                rss = next(int(x.split()[1]) for x in st.splitlines() if x.startswith("VmRSS"))
                name = next(x.split()[1] for x in st.splitlines() if x.startswith("Name"))
                rows.append((rss >> 10, name))
            except (OSError, StopIteration):
                pass
        rows.sort(reverse=True)
        f.write(f"{time.strftime('%H:%M:%S')} scope {cur} MB; " +
                ", ".join(f"{n} {r}" for r, n in rows[:6]) + "\n")
        f.flush()
    except (OSError, IndexError, ValueError):
        pass


def inner(base):
    """Runs inside dbus-run-session (private session bus), inside the scope."""
    base = pathlib.Path(base)
    rt = pathlib.Path(os.environ["XDG_RUNTIME_DIR"])
    out = pathlib.Path(os.environ["BXQA_OUT"])
    procs = []
    log = open(out / "services.log", "w")

    def start(cmd, **kw):
        p = subprocess.Popen(cmd, stdout=kw.pop("stdout", log), stderr=subprocess.STDOUT, **kw)
        procs.append(p)
        return p

    def wait_for(path, secs):
        end = time.time() + secs
        while time.time() < end:
            if path.exists():
                return True
            time.sleep(0.2)
        return False

    try:
        sock = rt / "system_bus_socket"
        conf = base / "system-bus.conf"
        conf.write_text(
            '<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN"\n'
            ' "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">\n'
            f"<busconfig><type>session</type><listen>unix:path={sock}</listen><auth>EXTERNAL</auth>"
            '<policy context="default"><allow send_destination="*" eavesdrop="true"/>'
            '<allow eavesdrop="true"/><allow own="*"/></policy></busconfig>\n')
        start(["dbus-daemon", f"--config-file={conf}", "--nofork", "--nopidfile"])
        if not wait_for(sock, 10):
            raise SystemExit("private system bus did not start")
        os.environ["DBUS_SYSTEM_BUS_ADDRESS"] = f"unix:path={sock}"
        ready = base / "mock.ready"
        start(["gjs", "-m", str(QA / "mockbus.js"), str(ready)])
        if not wait_for(ready, 15):
            raise SystemExit("mock services did not start")
        if os.environ.get("BXQA_AUDIO") == "1" and shutil.which("pipewire") and shutil.which("pipewire-pulse"):
            start(["pipewire"])
            time.sleep(0.8)
            start(["pipewire-pulse"])
            if wait_for(rt / "pulse/native", 8):
                subprocess.run(["pactl", "set-sink-volume", "qa_speakers", "62%"], stdout=log, stderr=log)
        w, h = os.environ["BXQA_SIZE"].split("x")
        shell = start(["gnome-shell", "--headless", "--wayland", "--no-x11", "--wayland-display=" + os.environ["BXQA_WAYLAND"],
                       "--virtual-monitor", f"{w}x{h}"], stdout=open(out / "shell.log", "w"))
        memlog = open(out / "memory.log", "w")
        tick = 0
        while shell.poll() is None and not (out / "DONE").exists():
            time.sleep(0.5)
            tick += 1
            if tick % 4 == 0:
                log_memory(memlog)
        if shell.poll() is not None:
            print(f"gnome-shell exited early ({shell.returncode}), see {out}/shell.log", file=sys.stderr)
    finally:
        for p in reversed(procs):
            if p.poll() is None:
                p.send_signal(signal.SIGTERM)
        for p in reversed(procs):
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()


# ---------------------------------------------------------------------- outer side
def run_variant(variant, args):
    out = args.out / variant
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    base = pathlib.Path(tempfile.mkdtemp(prefix=f"bxqa-{variant}-", dir=args.work))
    run_parent = pathlib.Path(os.environ.get("XDG_RUNTIME_DIR") or tempfile.gettempdir())
    rt = pathlib.Path(tempfile.mkdtemp(prefix="bxqa-", dir=run_parent))  # short: socket paths
    unit = f"bxqa-{os.getpid()}-{variant.lower()}"
    try:
        print(f"[{variant}] building private session in {base}")
        home, share, fc = build_tree(variant, base, args)
        env = private_env(base, home, share, fc, rt, out, args)
        cmd = ["systemd-run", "--user", "--scope", "--quiet", f"--unit={unit}",
               f"--description=Bordeaux shell QA ({variant})",
               "-p", f"MemoryMax={args.mem}", "-p", "MemorySwapMax=0", "--",
               "timeout", "-k", "10", str(args.timeout), "env", "-i",
               *[f"{k}={v}" for k, v in env.items()],
               "dbus-run-session", "--", sys.executable, str(pathlib.Path(__file__).resolve()),
               "--inner", str(base)]
        print(f"[{variant}] running gnome-shell --headless (scope {unit}, MemoryMax={args.mem})")
        t0 = time.time()
        rc = subprocess.run(cmd).returncode
        print(f"[{variant}] finished in {time.time() - t0:.0f}s (rc {rc})")
    finally:
        for verb in ("stop", "reset-failed"):  # nothing left running, no failed unit left behind
            subprocess.run(["systemctl", "--user", verb, f"{unit}.scope"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(rt, ignore_errors=True)
        if not args.keep:
            shutil.rmtree(base, ignore_errors=True)
    return out


def check_keys_and_osd(variant, m):
    """Focus Keys raise/launch/lifecycle and the TUF profile OSD (scenes focus-keys, profile-osd)."""
    bad = []
    desktop = m.get("desktopToggle")
    if desktop and (not desktop["windows"] or not all(desktop.get(k) for k in ("hidden", "restored", "interrupted"))):
        bad.append(f"{variant}: show desktop did not hide/restore cleanly: {desktop}")
    o = m.get("profileOsd")
    if o:
        if o["shownAtStart"] != 0:
            bad.append(f"{variant}: profile OSD shown {o['shownAtStart']}x at startup (want 0)")
        if o["duringBurst"]["shown"] != 0:
            bad.append(f"{variant}: profile OSD shown during a burst, before the 300 ms settle")
        a = o["afterBurst"]
        if a["shown"] != 1 or not (a["osd"] or {}).get("visible") or a["osd"]["label"] != "Performance":
            bad.append(f"{variant}: three quick profile changes did not give one 'Performance' OSD: {a}")
        s = o["single"]
        if s["shown"] != 2 or (s["osd"] or {}).get("label") != "Quiet":
            bad.append(f"{variant}: single change to Quiet not shown: {s}")
    c = m.get("colorScheme")
    if c:
        want = {"dark": ("Bordeaux", "Yaru-dark"), "light": ("Merlot-Day", "Yaru"), "noir": ("Oxblood-Noir", "Yaru-dark")}
        for step, (theme, gtk) in want.items():
            got = c[step]
            if (got["userTheme"], got["gtkTheme"], got["gtk4"], got["gtk3"]) != (theme, gtk, theme, theme):
                bad.append(f"{variant}: color-scheme {step}: want {theme}/{gtk}, got {got}")
            if not (got["stylesheet"] or "").endswith(f"/{theme}/gnome-shell/gnome-shell.css"):
                bad.append(f"{variant}: color-scheme {step}: shell stylesheet {got['stylesheet']}")
        if c["light"]["appliesForBurst"] != 1:
            bad.append(f"{variant}: three quick Dark Style toggles applied {c['light']['appliesForBurst']}x (want 1)")
        if c["restored"]["userTheme"] != c["start"]["userTheme"]:
            bad.append(f"{variant}: theme not restored after the color-scheme scene: {c['restored']}")
    f = m.get("focusKeys")
    if f:
        if f["grabbed"] != ["<Control>F9", "<Control>F10", "<Control>F11"]:
            bad.append(f"{variant}: focus-keys grabbed {f['grabbed']}")
        if not (f["raised"]["focus"] or "").lower().endswith("calculator") or f["raised"]["workspace"] != 1:
            bad.append(f"{variant}: Ctrl+F9 did not raise Calculator on workspace 2: {f['before']} -> {f['raised']}")
        if f["again"] != f["raised"]:
            bad.append(f"{variant}: second Ctrl+F9 moved focus: {f['again']}")
        L = f["launched"]
        if not L["window"] or "characters" not in (L["focus"] or "").lower():
            bad.append(f"{variant}: Ctrl+F10 did not start and focus Characters: {L}")
        if any("ready" in (n or "").lower() for n in L.get("notifications") or []):
            bad.append(f"{variant}: an 'is ready' notification appeared: {L['notifications']}")
        if (f["missing"] or {}).get("label") != "not-installed is not installed":
            bad.append(f"{variant}: missing app gave no OSD: {f['missing']}")
        if not f["disabled"]["coreGone"] or any(v not in (0, None) for v in f["disabled"]["allowed"]):
            bad.append(f"{variant}: focus-keys disable left bindings allowed: {f['disabled']}")
        if f["pressWhileDisabled"]["focus"] == f["raised"]["focus"]:
            bad.append(f"{variant}: Ctrl+F9 still worked with focus-keys disabled")
        pr = f.get("prefs") or {}
        titles = [r.get("title") for r in pr.get("rows", [])]
        if not pr.get("ok") or not pr.get("window") or "Calculator" not in titles:
            bad.append(f"{variant}: Focus Keys preferences did not open with the shortcut list: "
                       f"{pr.get('error') or titles}")
        if f["reenabled"]["state"] != 1 or len(f["reenabled"]["grabbed"] or []) != 3:
            bad.append(f"{variant}: focus-keys did not come back after re-enable: {f['reenabled']}")
    return bad


def check(variant, out):
    """Returns a list of failures from metrics.json and shell.log."""
    bad, notes = [], []
    mfile = out / "metrics.json"
    if not mfile.is_file():
        return [f"{variant}: no metrics.json (harness did not finish)"], notes
    m = json.loads(mfile.read_text())
    for e in m.get("errors", []):
        bad.append(f"{variant}: harness error: {e.splitlines()[0]}")
    for uuid, state in m.get("extensions", {}).items():
        if uuid in ENABLED and state != 1:
            bad.append(f"{variant}: extension {uuid} is in state {state}, not active")
    p = m.get("panel")
    if p:
        if p["clockPx"] < 15:
            bad.append(f"{variant}: top-bar clock is {p['clockPx']}px (< 15px)")
        if p["labels"]["minPx"] is not None and p["labels"]["minPx"] < 15:
            bad.append(f"{variant}: a top-bar label is {p['labels']['minPx']}px (< 15px)")
    d = m.get("dock")
    if d and d.get("margins"):
        mg = d["margins"]
        if max(mg.values()) - min(mg.values()) > 1:
            bad.append(f"{variant}: dock slab margins differ: {mg}")
        off = [abs(o) for o in d["centreOffsets"]]
        if max(off) > 1:
            bad.append(f"{variant}: dock icons not centred on the slab (offsets {d['centreOffsets']})")
        if d["radius"] < 8:
            bad.append(f"{variant}: dock slab radius {d['radius']} is not rounded")
    for s in m.get("scenes", []):
        for c in s["labels"]["cut"]:
            if c.get("grid"):  # app names in the grid: the shell ellipsizes those itself
                continue
            bad.append(f"{variant}: {s['name']}: label cut off: {c['text']!r} ({c['cls']})")
    bad += check_keys_and_osd(variant, m)
    a = m.get("auraCpu")
    if a:
        notes.append(f"{variant}: CPU ticks (1/100 s) over 4 s: idle aura on {a['idleOn']}, "
                     f"off {a.get('idleOff')}; hover sweep on {a['sweepOn']}, off {a.get('sweepOff')}")
    log = (out / "shell.log").read_text(errors="replace") if (out / "shell.log").is_file() else ""
    for line in log.splitlines():
        low = line.lower()
        if ("gnome-shell.css" in low or "st-warning" in low or "bordeaux" in low or "tuf-control" in low
                or "bordeaux-qa" in low) and ("error" in low or "warning" in low or "critical" in low):
            bad.append(f"{variant}: shell.log: {line.strip()[:200]}")
    return bad, notes


# Scene -> published file name; crop to the popup when the metrics have its box.
PUBLISH = {
    "Bordeaux": ["desktop", "dock-hover", "quick-settings", "qs-wi-fi", "qs-performance", "calendar",
                 "notification-banner", "osd-volume", "overview", "search", "app-grid", "alt-tab",
                 "end-session", "lock"],
    "Oxblood-Noir": ["desktop", "quick-settings", "calendar", "overview", "lock"],
    "Merlot-Day": ["desktop", "dock-hover", "quick-settings", "calendar", "overview", "app-grid",
                   "end-session", "lock"],
}
CROP = {"dock-hover": "dock", "dock-menu": "box", "quick-settings": "box", "qs-wi-fi": "box",
        "qs-bluetooth": "box", "qs-performance": "box", "qs-power-menu": "box", "calendar": "box",
        "notification-banner": "banner"}
RENAME = {"dock-hover": "dock", "notification-banner": "notification", "osd-volume": "osd"}


def publish(variant, out, dest, max_bytes=400_000):
    from PIL import Image

    m = json.loads((out / "metrics.json").read_text())
    boxes = {s["name"]: s.get("box") for s in m["scenes"]}
    qsbox = boxes.get("quick-settings")
    slug = variant.lower()
    written = []
    for scene in PUBLISH[variant]:
        src = out / f"{scene}.png"
        if not src.is_file():
            print(f"  missing {src.name}, skipped")
            continue
        im = Image.open(src).convert("RGB")
        W, H = im.size
        how = CROP.get(scene)
        box = None
        if how == "box":
            b = boxes.get(scene) or qsbox
            if b and b["w"] > 0:
                # The popup plus the top bar above it, with a margin of wallpaper.
                box = (b["x"] - 90, 0, b["x"] + b["w"] + 90, b["y"] + b["h"] + 70)
        elif how == "dock" and m.get("dockHover"):
            b = m["dockHover"]["background"]
            box = (0, b["y"] - 60, b["x"] + b["w"] + 420, b["y"] + b["h"] + 60)
        elif how == "banner":
            box = (W // 2 - 520, 0, W // 2 + 520, 330)
        if box:
            box = (max(0, box[0]), max(0, box[1]), min(W, box[2]), min(H, box[3]))
            im = im.crop(box)
        if im.width > 1920:
            im = im.resize((1920, round(im.height * 1920 / im.width)), Image.LANCZOS)
        name = f"{slug}-{RENAME.get(scene, scene)}"
        png = dest / f"{name}.png"
        jpg = dest / f"{name}.jpg"
        im.save(png, optimize=True)
        if png.stat().st_size > max_bytes:
            png.unlink()
            for q in (90, 86, 82):
                im.save(jpg, quality=q, optimize=True, progressive=True, subsampling=0 if q >= 90 else 2)
                if jpg.stat().st_size <= max_bytes:
                    break
            written.append(jpg)
        else:
            jpg.unlink(missing_ok=True)
            written.append(png)
    return written


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--inner", help=argparse.SUPPRESS)
    ap.add_argument("--variant", default="all", help="Bordeaux, Oxblood-Noir, Merlot-Day or all")
    ap.add_argument("--scene", default="all", help=f"comma list of: {', '.join(SCENES)} (default all)")
    ap.add_argument("--out", type=pathlib.Path, help="where the PNGs and metrics go (one dir per variant)")
    ap.add_argument("--work", type=pathlib.Path, default=None, help="parent dir for the private HOME")
    ap.add_argument("--publish", type=pathlib.Path, help="also write the curated, optimised set here")
    ap.add_argument("--size", default="1920x1200")
    ap.add_argument("--text-scale", type=float, default=1.0)
    ap.add_argument("--mem", default="1500M", help="MemoryMax of the scope (at most 1500M)")
    ap.add_argument("--timeout", type=int, default=420, help="seconds per variant")
    ap.add_argument("--tuf-ext", type=pathlib.Path, default=DEFAULT_TUF)
    ap.add_argument("--no-audio", action="store_true", help="skip the private pipewire (no volume slider)")
    ap.add_argument("--keep", action="store_true", help="keep the private HOME for inspection")
    args = ap.parse_args()
    mem = re.fullmatch(r"([1-9][0-9]*)([MG])", args.mem)
    if not mem or int(mem[1]) * (1024 if mem[2] == "G" else 1) > 1500:
        ap.error("--mem must be a positive M/G value no greater than 1500M")
    if args.inner:
        inner(args.inner)
        return
    if not args.out:
        ap.error("--out is required")
    args.scene = SCENES if args.scene == "all" else args.scene.split(",")
    unknown = set(args.scene) - set(SCENES)
    if unknown:
        ap.error(f"unknown scene(s): {', '.join(sorted(unknown))}")
    variants = list(VARIANTS) if args.variant == "all" else args.variant.split(",")
    for v in variants:
        if v not in VARIANTS:
            ap.error(f"unknown variant {v}")
    args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=True)
    if args.work:
        args.work.mkdir(parents=True, exist_ok=True)
    failures = []
    for v in variants:  # one at a time: one shell in memory at once
        out = run_variant(v, args)
        bad, notes = check(v, out)
        failures += bad
        for n in notes:
            print("  " + n)
        if args.publish:
            args.publish.mkdir(parents=True, exist_ok=True)
            for f in publish(v, out, args.publish):
                print(f"  published {f} ({f.stat().st_size // 1024} KB)")
    if failures:
        print("\n".join(["", "QA failures:"] + ["  " + f for f in failures]))
        sys.exit(1)
    print("QA checks passed")


if __name__ == "__main__":
    main()
