import platform
import sys
from pathlib import Path

import install


def test_detect_os_windows(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Windows")
    assert install.detect_os() == "windows"


def test_detect_os_mac(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Darwin")
    assert install.detect_os() == "mac"


def test_detect_os_linux(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    assert install.detect_os() == "linux"


def test_default_destination_is_under_home():
    dest = install.default_destination()
    assert dest == Path.home() / "EEGAnalyze"


def test_venv_dir():
    dest = Path("/tmp/myproject")
    assert install.venv_dir(dest) == dest / "backend" / ".venv"


def test_venv_python_windows(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Windows")
    dest = Path("/tmp/myproject")
    assert install.venv_python(dest) == dest / "backend" / ".venv" / "Scripts" / "python.exe"


def test_venv_python_mac(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Darwin")
    dest = Path("/tmp/myproject")
    assert install.venv_python(dest) == dest / "backend" / ".venv" / "bin" / "python"


def test_venv_pip_windows(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Windows")
    dest = Path("/tmp/myproject")
    assert install.venv_pip(dest) == dest / "backend" / ".venv" / "Scripts" / "pip.exe"


def test_venv_pip_linux(monkeypatch):
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    dest = Path("/tmp/myproject")
    assert install.venv_pip(dest) == dest / "backend" / ".venv" / "bin" / "pip"


def test_check_git_found(monkeypatch):
    monkeypatch.setattr(install.shutil, "which", lambda name: "/usr/bin/git")
    assert install.check_git() is True


def test_check_git_missing(monkeypatch):
    monkeypatch.setattr(install.shutil, "which", lambda name: None)
    assert install.check_git() is False


def test_check_python_version_ok():
    assert install.check_python_version(version_info=(3, 10, 0)) is True
    assert install.check_python_version(version_info=(3, 12, 1)) is True


def test_check_python_version_too_old():
    assert install.check_python_version(version_info=(3, 9, 0)) is False
    assert install.check_python_version(version_info=(2, 7, 18)) is False


def test_can_proceed():
    assert install.can_proceed(True, True) is True
    assert install.can_proceed(False, True) is False
    assert install.can_proceed(True, False) is False
    assert install.can_proceed(False, False) is False


def test_destination_is_safe_nonexistent(tmp_path):
    dest = tmp_path / "does-not-exist-yet"
    assert install.destination_is_safe(dest) is True


def test_destination_is_safe_empty_dir(tmp_path):
    dest = tmp_path / "empty"
    dest.mkdir()
    assert install.destination_is_safe(dest) is True


def test_destination_is_safe_nonempty_dir(tmp_path):
    dest = tmp_path / "nonempty"
    dest.mkdir()
    (dest / "somefile.txt").write_text("hi")
    assert install.destination_is_safe(dest) is False
