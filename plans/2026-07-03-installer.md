# Cross-platform Installer (install.py) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `install.py`, a single-file, stdlib-only, cross-platform (Windows/Mac/Linux) Tkinter GUI installer that clones this repo, sets up the backend venv, generates `start.bat`/`start.sh`, and creates OS shortcuts.

**Architecture:** One file at repo root, split internally into a pure/testable "logic" section (environment detection, file-content generation, subprocess command builders — all plain functions with no side effects beyond what's explicitly documented) and a thin Tkinter "GUI" section that only calls those functions and handles widget wiring. Tests import `install.py` as a module and exercise the logic section directly; the GUI section is verified by manual smoke test since Tkinter mainloop isn't practically unit-testable.

**Tech Stack:** Python 3.10+ stdlib only (`tkinter`, `subprocess`, `pathlib`, `platform`, `shutil`, `threading`) — no pip dependencies for the installer itself. Tests use `pytest` (already a project dependency in `backend/requirements.txt`).

## Global Constraints

- Single file: all installer logic lives in `install.py` at repo root — this is the one file end users download. Test file (`tests/test_install.py`) and this plan/spec are repo-internal, not part of what a new user needs.
- Python version floor: 3.10 (matches `README.md:23` "Python 3.10+", and `backend/requirements.txt`'s `numpy>=2.1` which requires 3.10+).
- No third-party pip packages for `install.py` itself (stdlib only) — the whole point is zero setup before running it.
- Repo URL default: `https://github.com/henray404/EEGAnalyze.git` (from `git remote -v` in this repo), user-editable in the GUI.
- Backend server: `uvicorn app.main:app --app-dir backend --port 8000` (matches `CLAUDE.md`'s documented dev command, run via `--app-dir` instead of `cd` so scripts can stay at repo root).
- Frontend server: `python -m http.server 5173 --directory frontend_v2` (the ACTIVE frontend per `CLAUDE.md` — not the old unused `frontend/` folder).
- No automated taskbar/Dock pinning (per spec's Non-goals) — installer creates real shortcuts and shows a manual instruction instead.
- Every subprocess call's exit code must be checked; failures show real captured output in the GUI log, never swallowed.
- Run all tests via the existing backend venv's Python, which already has `pytest` installed: `backend\.venv\Scripts\python.exe` (Windows) — confirmed present and working (`pytest 9.0.3`) in this repo already.
- Spec's open question "should `install.py` be copied into the cloned repo for later re-runs" is resolved by construction: `install.py` lives at repo root, so `git clone` already includes it in the destination automatically. No extra copy step needed.

---

## Task 1: Environment & prerequisite helpers

**Files:**
- Create: `install.py` (new file, repo root — this task starts it)
- Create: `tests/conftest.py`
- Create: `tests/test_install.py` (this task starts it; later tasks append to it)

**Interfaces:**
- Produces (used by all later tasks):
  - `REPO_URL_DEFAULT: str`
  - `PYTHON_VERSION_FLOOR: tuple[int, int]` = `(3, 10)`
  - `detect_os() -> str` — returns `"windows"`, `"mac"`, or `"linux"`
  - `default_destination() -> pathlib.Path`
  - `venv_dir(dest: pathlib.Path) -> pathlib.Path`
  - `venv_python(dest: pathlib.Path) -> pathlib.Path`
  - `venv_pip(dest: pathlib.Path) -> pathlib.Path`
  - `check_git() -> bool`
  - `check_python_version(version_info=None) -> bool`
  - `can_proceed(git_ok: bool, python_ok: bool) -> bool`
  - `destination_is_safe(dest: pathlib.Path) -> bool`

- [ ] **Step 1: Create `tests/conftest.py` so tests can import `install.py` from repo root**

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
```

- [ ] **Step 2: Write failing tests for Task 1 functions**

Create `tests/test_install.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail (install.py doesn't exist yet)**

Run: `backend\.venv\Scripts\python.exe -m pytest tests\test_install.py -v`
Expected: `ModuleNotFoundError: No module named 'install'` (or collection error) — confirms tests can't pass yet.

- [ ] **Step 4: Create `install.py` with the Task 1 implementation**

```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `backend\.venv\Scripts\python.exe -m pytest tests\test_install.py -v`
Expected: all tests PASS (17 tests from Step 2).

- [ ] **Step 6: Commit**

```bash
git add install.py tests/conftest.py tests/test_install.py
git commit -m "feat(installer): add environment/prerequisite helpers"
```

---

## Task 2: Generated file content (start scripts, shortcuts, desktop entries)

**Files:**
- Modify: `install.py` (append)
- Modify: `tests/test_install.py` (append)

**Interfaces:**
- Consumes: `Path` from `pathlib` (already imported in Task 1)
- Produces (used by Task 3):
  - `start_bat_content() -> str`
  - `start_sh_content() -> str`
  - `desktop_entry_content(dest: Path) -> str`
  - `command_launcher_content(dest: Path) -> str`
  - `windows_shortcut_vbscript(target: Path, shortcut_path: Path, description: str) -> str`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_install.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend\.venv\Scripts\python.exe -m pytest tests\test_install.py -v`
Expected: 5 new tests FAIL with `AttributeError: module 'install' has no attribute 'start_bat_content'` (etc).

- [ ] **Step 3: Implement content generators**

Append to `install.py` (before the `if __name__ == "__main__":` block):

```python
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


def windows_shortcut_vbscript(target: Path, shortcut_path: Path, description: str) -> str:
    """WScript.Shell COM shortcut creation via a throwaway .vbs script.
    No pywin32 dependency needed - cscript.exe ships with every Windows install.
    """
    return (
        'Set oWS = WScript.CreateObject("WScript.Shell")\n'
        f'sLinkFile = "{shortcut_path}"\n'
        "Set oLink = oWS.CreateShortcut(sLinkFile)\n"
        f'oLink.TargetPath = "{target}"\n'
        f'oLink.WorkingDirectory = "{target.parent}"\n'
        f'oLink.Description = "{description}"\n'
        "oLink.Save\n"
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `backend\.venv\Scripts\python.exe -m pytest tests\test_install.py -v`
Expected: all tests PASS (22 total).

- [ ] **Step 5: Commit**

```bash
git add install.py tests/test_install.py
git commit -m "feat(installer): add start script and shortcut content generators"
```

---

## Task 3: Writing generated files & creating shortcuts on disk

**Files:**
- Modify: `install.py` (append)
- Modify: `tests/test_install.py` (append)

**Interfaces:**
- Consumes: `start_bat_content`, `start_sh_content`, `desktop_entry_content`, `command_launcher_content`, `windows_shortcut_vbscript`, `detect_os` (Task 1-2)
- Produces (used by Task 5):
  - `write_start_scripts(dest: Path) -> None`
  - `create_windows_shortcut(target: Path, shortcut_path: Path, description: str) -> None`
  - `create_windows_shortcuts(dest: Path) -> list[Path]`
  - `create_mac_launcher(dest: Path) -> Path`
  - `create_linux_desktop_entry(dest: Path) -> list[Path]`
  - `create_shortcuts(dest: Path) -> list[Path]`

- [ ] **Step 1: Write failing tests (OS-agnostic parts only — Windows shortcut subprocess call is covered manually in Task 6)**

Append to `tests/test_install.py`:

```python
import os
import stat


def test_write_start_scripts_creates_both_files(tmp_path):
    install.write_start_scripts(tmp_path)
    bat = tmp_path / "start.bat"
    sh = tmp_path / "start.sh"
    assert bat.read_text() == install.start_bat_content()
    assert sh.read_text() == install.start_sh_content()


def test_write_start_scripts_makes_sh_executable(tmp_path):
    install.write_start_scripts(tmp_path)
    sh = tmp_path / "start.sh"
    mode = os.stat(sh).st_mode
    assert mode & stat.S_IXUSR


def test_create_mac_launcher(tmp_path):
    launcher = install.create_mac_launcher(tmp_path)
    assert launcher == tmp_path / "EEG Analysis Tool.command"
    assert launcher.read_text() == install.command_launcher_content(tmp_path)
    mode = os.stat(launcher).st_mode
    assert mode & stat.S_IXUSR


def test_create_linux_desktop_entry_writes_to_applications_dir(tmp_path, monkeypatch):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    monkeypatch.setattr(install.Path, "home", classmethod(lambda cls: fake_home))
    dest = tmp_path / "EEGAnalyze"
    created = install.create_linux_desktop_entry(dest)
    apps_entry = fake_home / ".local" / "share" / "applications" / "eeg-analysis-tool.desktop"
    assert apps_entry in created
    assert apps_entry.read_text() == install.desktop_entry_content(dest)


def test_create_linux_desktop_entry_also_copies_to_desktop_if_present(tmp_path, monkeypatch):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    (fake_home / "Desktop").mkdir()
    monkeypatch.setattr(install.Path, "home", classmethod(lambda cls: fake_home))
    dest = tmp_path / "EEGAnalyze"
    created = install.create_linux_desktop_entry(dest)
    desktop_entry = fake_home / "Desktop" / "eeg-analysis-tool.desktop"
    assert desktop_entry in created
    assert desktop_entry.read_text() == install.desktop_entry_content(dest)


def test_create_linux_desktop_entry_skips_desktop_copy_if_no_desktop_dir(tmp_path, monkeypatch):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    monkeypatch.setattr(install.Path, "home", classmethod(lambda cls: fake_home))
    dest = tmp_path / "EEGAnalyze"
    created = install.create_linux_desktop_entry(dest)
    assert len(created) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend\.venv\Scripts\python.exe -m pytest tests\test_install.py -v`
Expected: 6 new tests FAIL with `AttributeError` (functions don't exist yet).

- [ ] **Step 3: Implement file-writing and shortcut-creation functions**

Append to `install.py` (before `if __name__ == "__main__":`):

```python
# --------------------------------------------------------------------- #
#  Writing generated files / creating shortcuts (side effects)
# --------------------------------------------------------------------- #

def _make_executable(path: Path) -> None:
    st = os.stat(path)
    os.chmod(path, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


def write_start_scripts(dest: Path) -> None:
    bat_path = dest / "start.bat"
    sh_path = dest / "start.sh"
    bat_path.write_text(start_bat_content(), encoding="utf-8")
    sh_path.write_text(start_sh_content(), encoding="utf-8")
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
    launcher_path.write_text(command_launcher_content(dest), encoding="utf-8")
    _make_executable(launcher_path)
    return launcher_path


def create_linux_desktop_entry(dest: Path) -> list[Path]:
    content = desktop_entry_content(dest)
    apps_dir = Path.home() / ".local" / "share" / "applications"
    apps_dir.mkdir(parents=True, exist_ok=True)
    entry_path = apps_dir / "eeg-analysis-tool.desktop"
    entry_path.write_text(content, encoding="utf-8")
    _make_executable(entry_path)
    created = [entry_path]
    desktop_dir = Path.home() / "Desktop"
    if desktop_dir.exists():
        desktop_copy = desktop_dir / "eeg-analysis-tool.desktop"
        desktop_copy.write_text(content, encoding="utf-8")
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `backend\.venv\Scripts\python.exe -m pytest tests\test_install.py -v`
Expected: all tests PASS (28 total). Note: `test_write_start_scripts_makes_sh_executable` and the mac/linux executable-bit assertions are meaningful on Windows too (`os.chmod` doesn't error, it's just a lower-fidelity no-op for POSIX bits on NTFS) — should still pass.

- [ ] **Step 5: Commit**

```bash
git add install.py tests/test_install.py
git commit -m "feat(installer): write start scripts and create OS shortcuts"
```

---

## Task 4: Clone / venv / pip install orchestration

**Files:**
- Modify: `install.py` (append)
- Modify: `tests/test_install.py` (append)

**Interfaces:**
- Consumes: `venv_dir`, `venv_pip` (Task 1)
- Produces (used by Task 5):
  - `clone_command(url: str, dest: Path) -> list[str]`
  - `venv_command(dest: Path) -> list[str]`
  - `pip_install_command(dest: Path) -> list[str]`
  - `run_command_streaming(cmd: list[str], on_line: Callable[[str], None]) -> int`
  - `run_setup(url: str, dest: Path, on_line: Callable[[str], None]) -> bool`

- [ ] **Step 1: Write failing tests**

Append to `tests/test_install.py`:

```python
import sys


def test_clone_command():
    dest = Path("/tmp/EEGAnalyze")
    cmd = install.clone_command("https://example.com/repo.git", dest)
    assert cmd == ["git", "clone", "https://example.com/repo.git", str(dest)]


def test_venv_command():
    dest = Path("/tmp/EEGAnalyze")
    cmd = install.venv_command(dest)
    assert cmd == [sys.executable, "-m", "venv", str(install.venv_dir(dest))]


def test_pip_install_command():
    dest = Path("/tmp/EEGAnalyze")
    cmd = install.pip_install_command(dest)
    assert cmd == [
        str(install.venv_pip(dest)), "install", "-r",
        str(dest / "backend" / "requirements.txt"),
    ]


def test_run_command_streaming_captures_output_and_exit_code():
    lines = []
    code = install.run_command_streaming(
        [sys.executable, "-c", "print('a'); print('b')"], lines.append
    )
    assert code == 0
    assert lines == ["a", "b"]


def test_run_command_streaming_captures_nonzero_exit_code():
    lines = []
    code = install.run_command_streaming(
        [sys.executable, "-c", "import sys; sys.exit(3)"], lines.append
    )
    assert code == 3


def test_run_setup_stops_after_clone_failure(monkeypatch, tmp_path):
    calls = []

    def fake_run(cmd, on_line):
        calls.append(cmd)
        return 1  # simulate failure on every call

    monkeypatch.setattr(install, "run_command_streaming", fake_run)
    lines = []
    result = install.run_setup("https://example.com/repo.git", tmp_path, lines.append)
    assert result is False
    assert len(calls) == 1  # only clone attempted; venv/pip never ran
    assert any("FAILED" in line for line in lines)


def test_run_setup_stops_after_venv_failure(monkeypatch, tmp_path):
    calls = []

    def fake_run(cmd, on_line):
        calls.append(cmd)
        return 0 if len(calls) == 1 else 1  # clone succeeds, venv fails

    monkeypatch.setattr(install, "run_command_streaming", fake_run)
    lines = []
    result = install.run_setup("https://example.com/repo.git", tmp_path, lines.append)
    assert result is False
    assert len(calls) == 2  # clone + venv attempted; pip never ran


def test_run_setup_all_succeed(monkeypatch, tmp_path):
    calls = []

    def fake_run(cmd, on_line):
        calls.append(cmd)
        return 0

    monkeypatch.setattr(install, "run_command_streaming", fake_run)
    lines = []
    result = install.run_setup("https://example.com/repo.git", tmp_path, lines.append)
    assert result is True
    assert len(calls) == 3
    assert any("complete" in line.lower() for line in lines)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `backend\.venv\Scripts\python.exe -m pytest tests\test_install.py -v`
Expected: 8 new tests FAIL with `AttributeError` (functions don't exist yet).

- [ ] **Step 3: Implement clone/venv/pip orchestration**

Append to `install.py` (before `if __name__ == "__main__":`):

```python
# --------------------------------------------------------------------- #
#  git clone / venv / pip install orchestration
# --------------------------------------------------------------------- #

def clone_command(url: str, dest: Path) -> list[str]:
    return ["git", "clone", url, str(dest)]


def venv_command(dest: Path) -> list[str]:
    return [sys.executable, "-m", "venv", str(venv_dir(dest))]


def pip_install_command(dest: Path) -> list[str]:
    return [
        str(venv_pip(dest)), "install", "-r",
        str(dest / "backend" / "requirements.txt"),
    ]


def run_command_streaming(cmd: list[str], on_line) -> int:
    """Run cmd, calling on_line(str) for each stdout/stderr line as it
    arrives. Returns the process's exit code."""
    process = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )
    for line in process.stdout:
        on_line(line.rstrip("\n"))
    process.wait()
    return process.returncode


def run_setup(url: str, dest: Path, on_line) -> bool:
    """Clone repo, create venv, install backend deps. Returns True only if
    all three steps succeed. Calls on_line(str) with progress as it happens.
    """
    on_line("Cloning repository...")
    code = run_command_streaming(clone_command(url, dest), on_line)
    if code != 0:
        on_line(f"FAILED (exit code {code}) cloning repository")
        return False

    on_line("Creating Python virtual environment...")
    code = run_command_streaming(venv_command(dest), on_line)
    if code != 0:
        on_line(f"FAILED (exit code {code}) creating virtual environment")
        return False

    on_line("Installing backend dependencies...")
    code = run_command_streaming(pip_install_command(dest), on_line)
    if code != 0:
        on_line(f"FAILED (exit code {code}) installing dependencies")
        return False

    on_line("Setup complete.")
    return True
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `backend\.venv\Scripts\python.exe -m pytest tests\test_install.py -v`
Expected: all tests PASS (36 total).

- [ ] **Step 5: Commit**

```bash
git add install.py tests/test_install.py
git commit -m "feat(installer): add git clone / venv / pip install orchestration"
```

---

## Task 5: Tkinter GUI

**Files:**
- Modify: `install.py` (append + guarded tkinter import + `main()`)

**Interfaces:**
- Consumes: everything from Tasks 1-4 (`check_git`, `check_python_version`, `can_proceed`, `default_destination`, `REPO_URL_DEFAULT`, `PYTHON_VERSION_FLOOR`, `destination_is_safe`, `run_setup`, `write_start_scripts`, `create_shortcuts`, `detect_os`)
- Produces: `InstallerApp` class, `main()` function

No automated tests for this task (Tkinter mainloop isn't practically unit-testable without a display server). Verified via the manual smoke-test procedure in Task 6.

- [ ] **Step 1: Add guarded tkinter import near the top of `install.py`**

Insert immediately after the existing stdlib imports (after `from pathlib import Path`, before `REPO_URL_DEFAULT = ...`):

```python
try:
    import tkinter as tk
    from tkinter import filedialog, messagebox
except ImportError:
    print(
        "tkinter is not available on this Python install.\n"
        "On Linux, install it with your package manager, e.g.:\n"
        "  sudo apt install python3-tk\n"
        "On Windows/Mac, reinstall Python from python.org with the "
        "'tcl/tk' component enabled."
    )
    sys.exit(1)
```

- [ ] **Step 2: Implement the `InstallerApp` class**

Append to `install.py`, replacing the placeholder `if __name__ == "__main__":` block at the end:

```python
# --------------------------------------------------------------------- #
#  GUI
# --------------------------------------------------------------------- #

class InstallerApp:
    def __init__(self, root: "tk.Tk"):
        self.root = root
        self.root.title("EEG Analysis Tool - Installer")
        self.root.geometry("640x480")
        self.dest_var = tk.StringVar(value=str(default_destination()))
        self.url_var = tk.StringVar(value=REPO_URL_DEFAULT)
        self.log_text = None
        self.container = tk.Frame(self.root, padx=16, pady=16)
        self.container.pack(fill="both", expand=True)
        self.show_prereq_screen()

    def clear(self):
        for widget in self.container.winfo_children():
            widget.destroy()

    def show_prereq_screen(self):
        self.clear()
        git_ok = check_git()
        python_ok = check_python_version()
        floor_str = ".".join(map(str, PYTHON_VERSION_FLOOR))
        tk.Label(
            self.container, text="Checking prerequisites...", font=("", 14, "bold")
        ).pack(anchor="w")
        tk.Label(
            self.container,
            text=("git: OK" if git_ok else "git: NOT FOUND - install from git-scm.com"),
            fg="green" if git_ok else "red",
        ).pack(anchor="w", pady=4)
        tk.Label(
            self.container,
            text=(
                f"Python {floor_str}+: OK" if python_ok
                else f"Python {floor_str}+ required, found "
                     f"{sys.version_info.major}.{sys.version_info.minor}"
            ),
            fg="green" if python_ok else "red",
        ).pack(anchor="w", pady=4)
        tk.Button(
            self.container, text="Next", command=self.show_destination_screen,
            state="normal" if can_proceed(git_ok, python_ok) else "disabled",
        ).pack(anchor="e", pady=16)

    def show_destination_screen(self):
        self.clear()
        tk.Label(
            self.container, text="Choose install location", font=("", 14, "bold")
        ).pack(anchor="w")
        tk.Label(self.container, text="Repository URL:").pack(anchor="w", pady=(12, 0))
        tk.Entry(self.container, textvariable=self.url_var, width=60).pack(anchor="w")
        tk.Label(self.container, text="Install to folder:").pack(anchor="w", pady=(12, 0))
        row = tk.Frame(self.container)
        row.pack(anchor="w", fill="x")
        tk.Entry(row, textvariable=self.dest_var, width=48).pack(side="left")
        tk.Button(row, text="Browse...", command=self.browse_destination).pack(
            side="left", padx=8
        )
        tk.Button(
            self.container, text="Install", command=self.start_install
        ).pack(anchor="e", pady=16)

    def browse_destination(self):
        chosen = filedialog.askdirectory()
        if chosen:
            self.dest_var.set(str(Path(chosen) / "EEGAnalyze"))

    def start_install(self):
        dest = Path(self.dest_var.get())
        url = self.url_var.get()
        if not destination_is_safe(dest):
            proceed = messagebox.askyesno(
                "Folder not empty",
                f"{dest} already exists and is not empty. Continue anyway?",
            )
            if not proceed:
                return
        self.show_progress_screen()
        thread = threading.Thread(
            target=self.run_install_thread, args=(url, dest), daemon=True
        )
        thread.start()

    def show_progress_screen(self):
        self.clear()
        tk.Label(
            self.container, text="Installing...", font=("", 14, "bold")
        ).pack(anchor="w")
        self.log_text = tk.Text(self.container, height=20, width=76)
        self.log_text.pack(pady=8)
        self.log_text.config(state="disabled")

    def append_log(self, line: str):
        def do_append():
            self.log_text.config(state="normal")
            self.log_text.insert("end", line + "\n")
            self.log_text.see("end")
            self.log_text.config(state="disabled")
        self.root.after(0, do_append)

    def run_install_thread(self, url: str, dest: Path):
        dest.mkdir(parents=True, exist_ok=True)
        ok = run_setup(url, dest, self.append_log)
        if ok:
            write_start_scripts(dest)
            self.append_log("Start scripts written.")
            try:
                created = create_shortcuts(dest)
                self.append_log(
                    "Shortcuts created: " + ", ".join(str(p) for p in created)
                )
            except Exception as exc:
                self.append_log(f"Shortcut creation failed (non-fatal): {exc}")
        self.root.after(0, lambda: self.show_done_screen(dest, ok))

    def show_done_screen(self, dest: Path, success: bool):
        self.clear()
        if success:
            tk.Label(
                self.container, text="Setup complete!", font=("", 14, "bold"),
                fg="green",
            ).pack(anchor="w")
            tk.Label(
                self.container,
                text=(
                    f"Installed to: {dest}\n"
                    "A shortcut was created - right-click it and choose "
                    "'Pin to taskbar' / 'Pin to Dock' / 'Add to Favorites' "
                    "if you want quick access."
                ),
                justify="left",
            ).pack(anchor="w", pady=8)
            tk.Button(
                self.container, text="Launch now",
                command=lambda: self.launch(dest),
            ).pack(anchor="e", pady=16)
        else:
            tk.Label(
                self.container, text="Setup failed.", font=("", 14, "bold"),
                fg="red",
            ).pack(anchor="w")
            tk.Label(
                self.container,
                text="See the log on the previous screen for details.",
            ).pack(anchor="w", pady=8)

    def launch(self, dest: Path):
        if detect_os() == "windows":
            subprocess.Popen(
                ["cmd", "/c", "start", "", str(dest / "start.bat")], shell=False
            )
        else:
            subprocess.Popen(["bash", str(dest / "start.sh")])
        self.root.destroy()


def main():
    root = tk.Tk()
    InstallerApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Remove the old placeholder `if __name__ == "__main__":` block from Task 1**

The Task 1 placeholder (`print("install.py: GUI not wired up yet...")`) is superseded by Step 2's real `main()` — make sure only one `if __name__ == "__main__":` block remains in the file (the one from Step 2).

- [ ] **Step 4: Run the full test suite to confirm nothing broke**

Run: `backend\.venv\Scripts\python.exe -m pytest tests\test_install.py -v`
Expected: all 36 tests still PASS (this task added no new automated tests, just GUI code that imports cleanly).

- [ ] **Step 5: Manual smoke test (document result, don't skip)**

Run: `python install.py` on this Windows machine. Click through: prereq screen shows git/Python both OK -> Next -> destination screen shows pre-filled URL and default folder, Browse... opens a real folder picker -> pick a throwaway test folder -> Install -> progress screen shows live log output. Stop here (don't let it actually clone yet) by closing the window - this step only confirms the GUI opens and screens transition correctly. Full end-to-end run (real clone) happens in Task 6.

- [ ] **Step 6: Commit**

```bash
git add install.py
git commit -m "feat(installer): add Tkinter GUI wiring all installer steps together"
```

---

## Task 6: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Run install.py end-to-end on this Windows machine against a throwaway destination**

Run: `python install.py`

Walk through the full flow with a real destination, e.g. `C:\Users\Henry\AppData\Local\Temp\eeg-installer-test\EEGAnalyze`:
1. Prereq screen: confirm git/Python both show OK.
2. Destination screen: leave URL as default, set destination to the throwaway path above, click Install.
3. Progress screen: watch the log — confirm `git clone` output appears live, then venv creation, then pip install output (this will take a few minutes for `mne`/`scipy`/etc).
4. Done screen: confirm it shows "Setup complete!" and the destination path.

- [ ] **Step 2: Verify the cloned repo and generated artifacts**

Run:
```
dir C:\Users\Henry\AppData\Local\Temp\eeg-installer-test\EEGAnalyze
dir C:\Users\Henry\AppData\Local\Temp\eeg-installer-test\EEGAnalyze\backend\.venv\Scripts
type C:\Users\Henry\AppData\Local\Temp\eeg-installer-test\EEGAnalyze\start.bat
```
Expected: repo files present (`backend/`, `frontend_v2/`, `CLAUDE.md`, etc.), `.venv\Scripts\python.exe` and `.venv\Scripts\pip.exe` exist, `start.bat` content matches `start_bat_content()`.

- [ ] **Step 3: Verify shortcuts were created**

Run:
```
dir "%APPDATA%\Microsoft\Windows\Start Menu\Programs\EEG Analysis Tool.lnk"
dir "%USERPROFILE%\Desktop\EEG Analysis Tool.lnk"
```
Expected: both `.lnk` files exist (confirms the `cscript`-based shortcut creation actually works on this machine — this is the one piece Task 3's automated tests couldn't cover).

- [ ] **Step 4: Click "Launch now" (or double-click the generated start.bat) and verify the app actually starts**

Expected: two console windows open (backend uvicorn, frontend http.server), default browser opens to `http://localhost:5173` showing the app's overview page. Confirms the full pipeline — clone, venv, deps, start script, launch — works together, not just each piece in isolation.

- [ ] **Step 5: Clean up the throwaway test install**

Run: `rmdir /s /q C:\Users\Henry\AppData\Local\Temp\eeg-installer-test`

Also delete the two shortcuts created in Step 3 (`EEG Analysis Tool.lnk` in Start Menu and Desktop) so a real future install isn't confused by leftover test shortcuts.

- [ ] **Step 6: Document Mac/Linux status**

Mac and Linux code paths (`create_mac_launcher`, `create_linux_desktop_entry`, `start_sh_content`'s `xdg-open`/`open` branches) are covered by the automated tests in Task 3 for their pure logic, but have **not** been executed end-to-end on real Mac/Linux machines (this is a Windows dev environment). Note this limitation in the commit message / PR description — recommend a collaborator with Mac or Linux access do one real run-through before relying on `install.py` for onboarding non-Windows users, per the spec's Testing section.

- [ ] **Step 7: Final commit noting verification status**

```bash
git add -A
git commit -m "test(installer): verify end-to-end install flow on Windows

Confirmed: clone, venv setup, pip install, start.bat generation, Start
Menu + Desktop shortcut creation, and full app launch all work together
on Windows. Mac/Linux code paths unit-tested but not executed end-to-end
(no Mac/Linux machine available) - recommend verification before relying
on this for non-Windows onboarding."
```
