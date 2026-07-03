"""EEG Analysis Tool - single-file cross-platform installer.

Run with: python install.py

Clones the EEG Analysis Tool repo, sets up the backend Python virtual
environment, generates start.bat/start.sh launch scripts, and creates
OS-appropriate shortcuts. Stdlib only - no pip install needed to run this
file itself.
"""

import os
import platform
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

REPO_URL_DEFAULT = "https://github.com/henray404/EEGAnalyze.git"
PYTHON_VERSION_FLOOR = (3, 10)


# --------------------------------------------------------------------- #
#  Environment & prerequisite helpers (pure, no side effects)
# --------------------------------------------------------------------- #

def detect_os() -> str:
    """Return 'windows', 'mac', or 'linux'."""
    system = platform.system()
    if system == "Windows":
        return "windows"
    if system == "Darwin":
        return "mac"
    return "linux"


def default_destination() -> Path:
    return Path.home() / "EEGAnalyze"


def venv_dir(dest: Path) -> Path:
    return dest / "backend" / ".venv"


def venv_python(dest: Path) -> Path:
    if detect_os() == "windows":
        return venv_dir(dest) / "Scripts" / "python.exe"
    return venv_dir(dest) / "bin" / "python"


def venv_pip(dest: Path) -> Path:
    if detect_os() == "windows":
        return venv_dir(dest) / "Scripts" / "pip.exe"
    return venv_dir(dest) / "bin" / "pip"


def check_git() -> bool:
    return shutil.which("git") is not None


def check_python_version(version_info=None) -> bool:
    vi = version_info if version_info is not None else sys.version_info
    return (vi[0], vi[1]) >= PYTHON_VERSION_FLOOR


def can_proceed(git_ok: bool, python_ok: bool) -> bool:
    return git_ok and python_ok


def destination_is_safe(dest: Path) -> bool:
    """True if dest doesn't exist yet, or exists but is empty."""
    if not dest.exists():
        return True
    return not any(dest.iterdir())


# --------------------------------------------------------------------- #
#  Generated file content (pure string templates)
# --------------------------------------------------------------------- #

def start_bat_content() -> str:
    return (
        "@echo off\r\n"
        "cd /d \"%~dp0\"\r\n"
        "set VENV_PY=backend\\.venv\\Scripts\\python.exe\r\n"
        "start \"EEG Backend\" cmd /k \"%VENV_PY%\" -m uvicorn app.main:app "
        "--app-dir backend --port 8000\r\n"
        "start \"EEG Frontend\" cmd /k \"%VENV_PY%\" -m http.server 5173 "
        "--directory frontend_v2\r\n"
        "timeout /t 2 /nobreak >nul\r\n"
        "start http://localhost:5173\r\n"
    )


def start_sh_content() -> str:
    return (
        "#!/bin/bash\n"
        "cd \"$(dirname \"$0\")\"\n"
        "VENV_PY=\"backend/.venv/bin/python\"\n"
        "\"$VENV_PY\" -m uvicorn app.main:app --app-dir backend --port 8000 &\n"
        "BACKEND_PID=$!\n"
        "\"$VENV_PY\" -m http.server 5173 --directory frontend_v2 &\n"
        "FRONTEND_PID=$!\n"
        "sleep 2\n"
        "if command -v xdg-open >/dev/null 2>&1; then\n"
        "    xdg-open http://localhost:5173\n"
        "elif command -v open >/dev/null 2>&1; then\n"
        "    open http://localhost:5173\n"
        "fi\n"
        "trap \"kill $BACKEND_PID $FRONTEND_PID\" EXIT\n"
        "wait\n"
    )


def desktop_entry_content(dest: Path) -> str:
    start_sh = dest / "start.sh"
    return (
        "[Desktop Entry]\n"
        "Type=Application\n"
        "Name=EEG Analysis Tool\n"
        "Comment=Launch EEG Analysis Tool (backend + frontend)\n"
        f'Exec=bash "{start_sh}"\n'
        "Terminal=true\n"
        "Categories=Science;Education;\n"
    )


def command_launcher_content(dest: Path) -> str:
    start_sh = dest / "start.sh"
    return (
        "#!/bin/bash\n"
        f'cd "{dest}"\n'
        f'bash "{start_sh}"\n'
    )


def windows_shortcut_vbscript(
    target: Path, shortcut_path: Path, description: str
) -> str:
    """Create WScript.Shell VBScript content for a Windows shortcut."""
    return (
        'Set oWS = WScript.CreateObject("WScript.Shell")\n'
        f'sLinkFile = "{shortcut_path}"\n'
        "Set oLink = oWS.CreateShortcut(sLinkFile)\n"
        f'oLink.TargetPath = "{target}"\n'
        f'oLink.WorkingDirectory = "{target.parent}"\n'
        f'oLink.Description = "{description}"\n'
        "oLink.Save\n"
    )


# --------------------------------------------------------------------- #
#  Writing generated files / creating shortcuts (side effects)
# --------------------------------------------------------------------- #

def _make_executable(path: Path) -> None:
    st = os.stat(path)
    os.chmod(path, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


def write_start_scripts(dest: Path) -> None:
    # write_bytes (not write_text): start_bat_content()/start_sh_content()
    # embed explicit line endings (\r\n / \n). Path.write_text() applies
    # its own newline translation on top of that and corrupts \r\n into
    # \r\r\n on Windows. Writing raw bytes preserves them exactly.
    bat_path = dest / "start.bat"
    sh_path = dest / "start.sh"
    bat_path.write_bytes(start_bat_content().encode("utf-8"))
    sh_path.write_bytes(start_sh_content().encode("utf-8"))
    _make_executable(sh_path)


def create_windows_shortcut(target: Path, shortcut_path: Path, description: str) -> None:
    vbs_content = windows_shortcut_vbscript(target, shortcut_path, description)
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".vbs", delete=False, encoding="utf-8"
    ) as f:
        f.write(vbs_content)
        vbs_path = f.name
    try:
        subprocess.run(
            ["cscript", "//nologo", vbs_path], check=True, capture_output=True
        )
    finally:
        os.unlink(vbs_path)


def create_windows_shortcuts(dest: Path) -> list[Path]:
    """Create Start Menu + Desktop shortcuts pointing at start.bat."""
    target = dest / "start.bat"
    start_menu = (
        Path(os.environ["APPDATA"]) / "Microsoft" / "Windows"
        / "Start Menu" / "Programs" / "EEG Analysis Tool.lnk"
    )
    desktop = Path.home() / "Desktop" / "EEG Analysis Tool.lnk"
    created = []
    for shortcut_path in (start_menu, desktop):
        shortcut_path.parent.mkdir(parents=True, exist_ok=True)
        create_windows_shortcut(target, shortcut_path, "Launch EEG Analysis Tool")
        created.append(shortcut_path)
    return created


def create_mac_launcher(dest: Path) -> Path:
    launcher_path = dest / "EEG Analysis Tool.command"
    launcher_path.write_bytes(command_launcher_content(dest).encode("utf-8"))
    _make_executable(launcher_path)
    return launcher_path


def create_linux_desktop_entry(dest: Path) -> list[Path]:
    content = desktop_entry_content(dest)
    content_bytes = content.encode("utf-8")
    apps_dir = Path.home() / ".local" / "share" / "applications"
    apps_dir.mkdir(parents=True, exist_ok=True)
    entry_path = apps_dir / "eeg-analysis-tool.desktop"
    entry_path.write_bytes(content_bytes)
    _make_executable(entry_path)
    created = [entry_path]
    desktop_dir = Path.home() / "Desktop"
    if desktop_dir.exists():
        desktop_copy = desktop_dir / "eeg-analysis-tool.desktop"
        desktop_copy.write_bytes(content_bytes)
        _make_executable(desktop_copy)
        created.append(desktop_copy)
    return created


def create_shortcuts(dest: Path) -> list[Path]:
    os_name = detect_os()
    if os_name == "windows":
        return create_windows_shortcuts(dest)
    if os_name == "mac":
        return [create_mac_launcher(dest)]
    return create_linux_desktop_entry(dest)


if __name__ == "__main__":
    print("install.py: GUI not wired up yet (see later tasks in the plan).")
