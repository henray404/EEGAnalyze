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
            ["cscript", "//nologo", vbs_path],
            check=True, capture_output=True, text=True,
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


# --------------------------------------------------------------------- #
#  git clone / venv / pip install orchestration
# --------------------------------------------------------------------- #

def clone_command(url: str, dest: Path) -> list[str]:
    # "--" stops git from ever interpreting a URL starting with "-" as a flag.
    return ["git", "clone", "--", url, str(dest)]


def pull_command(dest: Path) -> list[str]:
    return ["git", "-C", str(dest), "pull"]


def is_existing_clone(dest: Path) -> bool:
    return (dest / ".git").exists()


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
    """Clone repo (or pull latest if dest is already a clone), create venv,
    install backend deps. Returns True only if all steps succeed. Calls
    on_line(str) with progress as it happens.
    """
    if is_existing_clone(dest):
        on_line("Existing installation found, pulling latest changes...")
        code = run_command_streaming(pull_command(dest), on_line)
        if code != 0:
            on_line(f"FAILED (exit code {code}) pulling latest changes")
            return False
    else:
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
        # git clone always refuses a non-empty destination, so "continue
        # anyway" into one can never actually succeed. Only two folder
        # states can proceed: empty/new (clone), or an existing install of
        # this tool (update via git pull, handled in run_setup).
        if not is_existing_clone(dest) and not destination_is_safe(dest):
            messagebox.showerror(
                "Folder not empty",
                f"{dest} already exists and is not empty, and isn't a "
                "previous install of this tool. Pick an empty or new folder.",
            )
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
            except subprocess.CalledProcessError as exc:
                detail = exc.stderr.strip() if exc.stderr else str(exc)
                self.append_log(f"Shortcut creation failed (non-fatal): {detail}")
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
