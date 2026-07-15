import os
import platform
import stat
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


def test_start_bat_content_sets_up_venv_on_first_run():
    # First-run venv/pip setup lives in the script itself (a real console
    # window, on-PATH "python" - not sys.executable) rather than inside
    # install.py's own process, which is a frozen PyInstaller exe: there,
    # sys.executable IS the exe itself, so shelling out to
    # [sys.executable, "-m", "venv", ...] silently relaunches the whole
    # GUI installer as a hung child process instead of creating a venv.
    content = install.start_bat_content()
    assert "if not exist" in content
    assert "python -m venv backend\\.venv" in content
    assert "-m pip install -r backend\\requirements.txt" in content


def test_start_sh_content_launches_both_servers_and_browser():
    content = install.start_sh_content()
    assert "backend/.venv/bin/python" in content
    assert "-m uvicorn app.main:app --app-dir backend --port 8000" in content
    assert "-m http.server 5173 --directory frontend_v2" in content
    assert "http://localhost:5173" in content
    assert content.startswith("#!/bin/bash\n")


def test_start_sh_content_sets_up_venv_on_first_run():
    content = install.start_sh_content()
    assert "python3 -m venv backend/.venv" in content
    assert "-m pip install -r backend/requirements.txt" in content


def test_desktop_entry_content(tmp_path):
    dest = tmp_path / "EEGAnalyze"
    content = install.desktop_entry_content(dest)
    assert "[Desktop Entry]" in content
    assert "Name=EEGAnalyze" in content
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


def test_windows_shortcut_vbscript_escapes_quoted_arguments(tmp_path):
    # arguments is built by callers as a pre-quoted path (e.g. `"{path}"`)
    # to survive spaces once passed to CreateProcess. Those embedded quotes
    # must be doubled for a valid VBScript string literal, or cscript fails
    # with "Expected end of statement" (real bug: they were passed through
    # unescaped, producing four consecutive quote chars).
    target = tmp_path / "pythonw.exe"
    shortcut = tmp_path / "EEGAnalyze.lnk"
    launcher = tmp_path / "EEGAnalyze" / "launcher.py"
    arguments = f'"{launcher}"'
    content = install.windows_shortcut_vbscript(
        target, shortcut, "desc", arguments=arguments, working_dir=tmp_path,
    )
    assert f'oLink.Arguments = """{launcher}"""' in content
    assert '""""' not in content
    assert 'oLink.Arguments = "' + arguments + '"' not in content


def test_write_start_scripts_creates_both_files(tmp_path):
    install.write_start_scripts(tmp_path)
    bat = tmp_path / "start.bat"
    sh = tmp_path / "start.sh"
    # Compare raw bytes, not text-mode read: start_bat_content() embeds
    # literal \r\n and text-mode read_text() would normalize newlines on
    # the way in, masking a write-side CRLF corruption bug.
    assert bat.read_bytes().decode("utf-8") == install.start_bat_content()
    assert sh.read_bytes().decode("utf-8") == install.start_sh_content()


def test_write_start_scripts_makes_sh_executable(tmp_path):
    install.write_start_scripts(tmp_path)
    sh = tmp_path / "start.sh"
    if sys.platform == "win32":
        # Windows has no POSIX exec-bit concept for arbitrary extensions;
        # os.chmod's S_IEXEC is a documented no-op here. Just confirm the
        # file exists and chmod didn't raise.
        assert sh.exists()
    else:
        mode = os.stat(sh).st_mode
        assert mode & stat.S_IXUSR


def test_create_mac_launcher(tmp_path):
    launcher = install.create_mac_launcher(tmp_path)
    assert launcher == tmp_path / "EEGAnalyze.command"
    assert launcher.read_bytes().decode("utf-8") == install.command_launcher_content(tmp_path)
    if sys.platform == "win32":
        assert launcher.exists()
    else:
        mode = os.stat(launcher).st_mode
        assert mode & stat.S_IXUSR


def test_create_linux_desktop_entry_writes_to_applications_dir(tmp_path, monkeypatch):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    monkeypatch.setattr(install.Path, "home", classmethod(lambda cls: fake_home))
    dest = tmp_path / "EEGAnalyze"
    created = install.create_linux_desktop_entry(dest)
    apps_entry = fake_home / ".local" / "share" / "applications" / "eeganalyze.desktop"
    assert apps_entry in created
    assert apps_entry.read_bytes().decode("utf-8") == install.desktop_entry_content(dest)


def test_create_linux_desktop_entry_also_copies_to_desktop_if_present(tmp_path, monkeypatch):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    (fake_home / "Desktop").mkdir()
    monkeypatch.setattr(install.Path, "home", classmethod(lambda cls: fake_home))
    dest = tmp_path / "EEGAnalyze"
    created = install.create_linux_desktop_entry(dest)
    desktop_entry = fake_home / "Desktop" / "eeganalyze.desktop"
    assert desktop_entry in created
    assert desktop_entry.read_bytes().decode("utf-8") == install.desktop_entry_content(dest)


def test_create_linux_desktop_entry_skips_desktop_copy_if_no_desktop_dir(tmp_path, monkeypatch):
    fake_home = tmp_path / "home"
    fake_home.mkdir()
    monkeypatch.setattr(install.Path, "home", classmethod(lambda cls: fake_home))
    dest = tmp_path / "EEGAnalyze"
    created = install.create_linux_desktop_entry(dest)
    assert len(created) == 1


def test_clone_command():
    dest = Path("/tmp/EEGAnalyze")
    cmd = install.clone_command("https://example.com/repo.git", dest)
    # "--" before the URL stops git from treating a leading-dash URL as a flag.
    assert cmd == ["git", "clone", "--", "https://example.com/repo.git", str(dest)]


def test_pull_command():
    dest = Path("/tmp/EEGAnalyze")
    cmd = install.pull_command(dest)
    assert cmd == ["git", "-C", str(dest), "pull"]


def test_is_existing_clone_false_for_new_dir(tmp_path):
    assert install.is_existing_clone(tmp_path) is False


def test_is_existing_clone_true_when_git_dir_present(tmp_path):
    (tmp_path / ".git").mkdir()
    assert install.is_existing_clone(tmp_path) is True


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


def test_run_command_streaming_emits_heartbeat_during_silent_stretch():
    # Simulates pip's silent "Installing collected packages" phase: a
    # subprocess that produces no output for a while before finishing.
    # A short heartbeat_interval keeps this test fast (real usage defaults
    # to a much longer interval - see run_setup's callers).
    lines = []
    code = install.run_command_streaming(
        [sys.executable, "-c", "import time; time.sleep(0.3); print('done')"],
        lines.append,
        heartbeat_interval=0.05,
    )
    assert code == 0
    assert "done" in lines  # real output still arrives
    # At least one heartbeat fired during the silent stretch before it.
    # (Not asserting exact position: a heartbeat tick can legitimately
    # race the final line's arrival, since it's a genuinely concurrent
    # background thread - both landing is what matters, not their order.)
    assert any(line == "... still working ..." for line in lines)


def test_run_command_streaming_no_heartbeat_when_output_is_fast():
    lines = []
    code = install.run_command_streaming(
        [sys.executable, "-c", "print('a'); print('b')"],
        lines.append,
        heartbeat_interval=15.0,
    )
    assert code == 0
    assert lines == ["a", "b"]


def test_run_command_streaming_heartbeat_message_is_customizable():
    lines = []
    code = install.run_command_streaming(
        [sys.executable, "-c", "import time; time.sleep(0.3); print('done')"],
        lines.append,
        heartbeat_interval=0.05,
        heartbeat_message="... still creating virtual environment ...",
    )
    assert code == 0
    assert any(line == "... still creating virtual environment ..." for line in lines)


def test_run_setup_stops_after_clone_failure(monkeypatch, tmp_path):
    calls = []

    def fake_run(cmd, on_line, **kwargs):
        calls.append(cmd)
        return 1  # simulate failure on every call

    monkeypatch.setattr(install, "run_command_streaming", fake_run)
    lines = []
    result = install.run_setup("https://example.com/repo.git", tmp_path, lines.append)
    assert result is False
    assert len(calls) == 1  # only clone attempted; venv/pip never ran
    assert any("FAILED" in line for line in lines)


def test_run_setup_all_succeed(monkeypatch, tmp_path):
    calls = []

    def fake_run(cmd, on_line, **kwargs):
        calls.append(cmd)
        return 0

    monkeypatch.setattr(install, "run_command_streaming", fake_run)
    lines = []
    result = install.run_setup("https://example.com/repo.git", tmp_path, lines.append)
    assert result is True
    # Clone only - venv/pip setup lives in start.bat/start.sh now, not
    # install.py's own process (see test_start_bat_content_sets_up_venv_on_first_run
    # for why: sys.executable inside the frozen exe IS the exe itself).
    assert len(calls) == 1
    assert any("complete" in line.lower() for line in lines)


def test_run_setup_uses_a_heartbeat_message_naming_the_step(monkeypatch, tmp_path):
    heartbeat_messages = []

    def fake_run(cmd, on_line, **kwargs):
        heartbeat_messages.append(kwargs.get("heartbeat_message"))
        return 0

    monkeypatch.setattr(install, "run_command_streaming", fake_run)
    install.run_setup("https://example.com/repo.git", tmp_path, lambda line: None)
    assert len(heartbeat_messages) == 1
    assert "clon" in heartbeat_messages[0].lower()


def test_run_setup_pulls_instead_of_cloning_for_existing_install(monkeypatch, tmp_path):
    (tmp_path / ".git").mkdir()
    calls = []

    def fake_run(cmd, on_line, **kwargs):
        calls.append(cmd)
        return 0

    monkeypatch.setattr(install, "run_command_streaming", fake_run)
    lines = []
    result = install.run_setup("https://example.com/repo.git", tmp_path, lines.append)
    assert result is True
    assert calls[0] == install.pull_command(tmp_path)
    assert any("pull" in line.lower() for line in lines)
