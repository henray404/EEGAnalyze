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


if __name__ == "__main__":
    print("install.py: GUI not wired up yet (see later tasks in the plan).")
