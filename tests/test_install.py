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


def test_start_bat_content_launches_both_servers_and_browser():
    content = install.start_bat_content()
    assert "backend\\.venv\\Scripts\\python.exe" in content
    assert "-m uvicorn app.main:app --app-dir backend --port 8000" in content
    assert "-m http.server 5173 --directory frontend_v2" in content
    assert "start http://localhost:5173" in content


def test_start_sh_content_launches_both_servers_and_browser():
    content = install.start_sh_content()
    assert "backend/.venv/bin/python" in content
    assert "-m uvicorn app.main:app --app-dir backend --port 8000" in content
    assert "-m http.server 5173 --directory frontend_v2" in content
    assert "http://localhost:5173" in content
    assert content.startswith("#!/bin/bash\n")


def test_desktop_entry_content(tmp_path):
    dest = tmp_path / "EEGAnalyze"
    content = install.desktop_entry_content(dest)
    assert "[Desktop Entry]" in content
    assert "Name=EEG Analysis Tool" in content
    assert str(dest / "start.sh") in content


def test_command_launcher_content(tmp_path):
    dest = tmp_path / "EEGAnalyze"
    content = install.command_launcher_content(dest)
    assert content.startswith("#!/bin/bash\n")
    assert str(dest) in content
    assert str(dest / "start.sh") in content


def test_windows_shortcut_vbscript(tmp_path):
    target = tmp_path / "EEGAnalyze" / "start.bat"
    shortcut = tmp_path / "Desktop" / "EEG Analysis Tool.lnk"
    content = install.windows_shortcut_vbscript(target, shortcut, "Launch EEG Analysis Tool")
    assert 'WScript.CreateObject("WScript.Shell")' in content
    assert str(target) in content
    assert str(shortcut) in content
    assert "Launch EEG Analysis Tool" in content
    assert "oLink.Save" in content
