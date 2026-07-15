"""
EEG Analysis Tool v2 - GUI Launcher
Tkinter-based launcher: auto-setup venv, install deps, start FastAPI + static frontend.
"""
import tkinter as tk
from tkinter import ttk
import subprocess
import threading
import time
import os
import sys
import re
import webbrowser
import logging

# --- FILE LOGGING ---
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "launcher.log")
logging.basicConfig(
    filename=LOG_FILE, level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logging.info("=" * 50)
logging.info("Launcher started")

# --- KONFIGURASI ---
LOCAL_VERSION = "2.2"
APP_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(APP_DIR, "backend")
FRONTEND_DIR = os.path.join(APP_DIR, "frontend_v2")
# backend/.venv, bukan .venv di root -- ini yang dipakai start.bat/start.sh
# (lihat install.py: start_bat_content) dan didokumentasikan di CLAUDE.md.
# Sebelumnya launcher.py nunjuk ke .venv root, beda lokasi dari yang
# sebenarnya dipakai/dibuat alur install+start.bat.
VENV_DIR = os.path.join(BACKEND_DIR, ".venv")
REQUIREMENTS = os.path.join(BACKEND_DIR, "requirements.txt")
CHANGELOG_FILE = os.path.join(APP_DIR, "CHANGELOG.md")

BACKEND_PORT = 8000
FRONTEND_PORT = 5173
FRONTEND_URL = f"http://localhost:{FRONTEND_PORT}"
HEALTH_URL = f"http://localhost:{BACKEND_PORT}/health"

if sys.platform == "win32":
    VENV_PYTHON = os.path.join(VENV_DIR, "Scripts", "python.exe")
    VENV_PIP = os.path.join(VENV_DIR, "Scripts", "pip.exe")
else:
    VENV_PYTHON = os.path.join(VENV_DIR, "bin", "python3")
    VENV_PIP = os.path.join(VENV_DIR, "bin", "pip")


def _read_current_changelog():
    """Baca changelog untuk versi saat ini dari CHANGELOG.md."""
    if not os.path.exists(CHANGELOG_FILE):
        return []
    try:
        with open(CHANGELOG_FILE, "r", encoding="utf-8") as f:
            content = f.read()
        pattern = rf"## v{re.escape(LOCAL_VERSION)}.*?\n(.*?)(?=\n## v|\Z)"
        match = re.search(pattern, content, re.DOTALL)
        if match:
            lines = match.group(1).strip().split("\n")
            return [ln.lstrip("- ").strip() for ln in lines if ln.strip().startswith("-")]
    except Exception:
        pass
    return []


def _wait_for_backend(timeout=30):
    """Poll /health sampai backend siap atau timeout."""
    import urllib.request
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(HEALTH_URL, timeout=2)
            return True
        except Exception:
            time.sleep(0.5)
    return False


class LauncherApp:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("EEG Analysis Tool v2")
        self.root.geometry("560x600")
        self.root.resizable(False, False)
        self.root.configure(bg="#0B1120")

        self.root.update_idletasks()
        x = (self.root.winfo_screenwidth() - 560) // 2
        y = (self.root.winfo_screenheight() - 600) // 2
        self.root.geometry(f"560x600+{x}+{y}")

        self._build_ui()
        self.backend_process = None
        self.frontend_process = None

    def _build_ui(self):
        bg = "#0B1120"
        card = "#111827"
        accent = "#5B65DC"
        text = "#F1F5F9"
        muted = "#94A3B8"

        # Header
        header = tk.Frame(self.root, bg=bg)
        header.pack(fill="x", padx=20, pady=(20, 5))

        tk.Label(header, text="EEG Analysis Tool", font=("Segoe UI", 18, "bold"),
                 bg=bg, fg=text).pack(anchor="w")
        tk.Label(header, text=f"Versi {LOCAL_VERSION}  |  FastAPI + React",
                 font=("Segoe UI", 10), bg=bg, fg=muted).pack(anchor="w")

        # Changelog card
        changelog_items = _read_current_changelog()
        if changelog_items:
            cl_frame = tk.Frame(self.root, bg=card, highlightbackground="#1E293B",
                                highlightthickness=1)
            cl_frame.pack(fill="x", padx=20, pady=(10, 0))

            tk.Label(cl_frame, text=f"Pembaruan v{LOCAL_VERSION}",
                     font=("Segoe UI", 10, "bold"),
                     bg=card, fg=accent).pack(anchor="w", padx=12, pady=(8, 2))

            cl_text = tk.Text(cl_frame, bg=card, fg=muted,
                              font=("Consolas", 8), bd=0,
                              highlightthickness=0, wrap="word",
                              height=4, state="normal")
            cl_text.insert("1.0", "\n".join(f"  - {item}" for item in changelog_items))
            cl_text.configure(state="disabled")
            cl_text.pack(fill="x", padx=12, pady=(0, 8))

        # Status card
        status_frame = tk.Frame(self.root, bg=card, highlightbackground="#1E293B",
                                highlightthickness=1)
        status_frame.pack(fill="both", expand=True, padx=20, pady=10)

        tk.Label(status_frame, text="Status", font=("Segoe UI", 10, "bold"),
                 bg=card, fg=muted).pack(anchor="w", padx=12, pady=(10, 0))

        self.log_text = tk.Text(status_frame, bg=card, fg=text,
                                font=("Consolas", 9), bd=0,
                                highlightthickness=0, wrap="word",
                                state="disabled", height=10)
        self.log_text.pack(fill="both", expand=True, padx=12, pady=(5, 10))

        # Progress
        style = ttk.Style()
        style.theme_use("default")
        style.configure("Custom.Horizontal.TProgressbar",
                        troughcolor=card, background=accent,
                        bordercolor=card, lightcolor=accent,
                        darkcolor=accent)

        self.progress = ttk.Progressbar(self.root, mode="determinate",
                                        style="Custom.Horizontal.TProgressbar",
                                        maximum=100)
        self.progress.pack(fill="x", padx=20, pady=(0, 10))

        # Buttons
        btn_frame = tk.Frame(self.root, bg=bg)
        btn_frame.pack(fill="x", padx=20, pady=(0, 20))

        self.start_btn = tk.Button(
            btn_frame, text="Mulai Aplikasi", font=("Segoe UI", 11, "bold"),
            bg=accent, fg="white", activebackground="#4A54C5",
            activeforeground="white", bd=0, padx=20, pady=8,
            cursor="hand2", command=self._on_start,
        )
        self.start_btn.pack(side="left", expand=True, fill="x", padx=(0, 5))

        self.quit_btn = tk.Button(
            btn_frame, text="Keluar", font=("Segoe UI", 11),
            bg="#1E293B", fg=text, activebackground="#374151",
            activeforeground=text, bd=0, padx=20, pady=8,
            cursor="hand2", command=self._on_quit,
        )
        self.quit_btn.pack(side="right", expand=True, fill="x", padx=(5, 0))

    # ---- Logging ----
    def log(self, msg):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", msg + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")
        self.root.update_idletasks()
        logging.info(msg)

    def set_progress(self, value):
        self.progress["value"] = value
        self.root.update_idletasks()

    # ---- Setup ----
    def _run_setup(self):
        self.start_btn.configure(state="disabled", bg="#374151")

        # Step 1: Venv
        self.log("Memeriksa virtual environment...")
        self.set_progress(10)
        if not os.path.exists(VENV_PYTHON):
            self.log("  Membuat virtual environment...")
            result = subprocess.run(
                [sys.executable, "-m", "venv", VENV_DIR],
                cwd=APP_DIR, capture_output=True,
            )
            if result.returncode != 0:
                self.log(f"  Gagal membuat venv: {result.stderr.decode()[:200]}")
                self.start_btn.configure(state="normal", bg="#5B65DC")
                return
            self.log("  Virtual environment dibuat.")
        else:
            self.log("  Virtual environment tersedia.")
        self.set_progress(25)

        # Step 2: Dependencies
        self.log("Memeriksa dependensi backend...")
        check = subprocess.run(
            [VENV_PIP, "show", "fastapi"],
            capture_output=True, text=True,
        )
        if check.returncode != 0:
            self.log("  Menginstall dependensi (mohon tunggu)...")
            proc = subprocess.run(
                [VENV_PIP, "install", "-r", REQUIREMENTS, "-q"],
                capture_output=True, text=True,
            )
            if proc.returncode == 0:
                self.log("  Dependensi berhasil diinstall.")
            else:
                self.log(f"  Gagal install: {proc.stderr[:300]}")
                self.start_btn.configure(state="normal", bg="#5B65DC")
                return
        else:
            self.log("  Dependensi tersedia.")
        self.set_progress(50)

        # Step 3: Mulai backend (FastAPI via uvicorn)
        self.log("\nMemulai backend (FastAPI port 8000)...")
        self.set_progress(60)

        kwargs = dict(
            cwd=BACKEND_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        if sys.platform == "win32":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

        self.backend_process = subprocess.Popen(
            [VENV_PYTHON, "-m", "uvicorn", "app.main:app",
             "--host", "127.0.0.1", "--port", str(BACKEND_PORT)],
            **kwargs,
        )

        def _drain_backend():
            try:
                for line in iter(self.backend_process.stdout.readline, ""):
                    logging.debug(f"backend: {line.strip()}")
            except Exception:
                pass

        threading.Thread(target=_drain_backend, daemon=True).start()

        self.log("  Menunggu backend siap...")
        if _wait_for_backend(timeout=30):
            self.log(f"  Backend berjalan: http://localhost:{BACKEND_PORT}")
        else:
            self.log("  Peringatan: backend lambat merespons, melanjutkan...")
        self.set_progress(75)

        # Step 4: Mulai frontend (static server)
        self.log(f"\nMemulai frontend (static port {FRONTEND_PORT})...")

        fe_kwargs = dict(
            cwd=FRONTEND_DIR,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        if sys.platform == "win32":
            fe_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

        self.frontend_process = subprocess.Popen(
            [VENV_PYTHON, "-m", "http.server", str(FRONTEND_PORT)],
            **fe_kwargs,
        )

        def _drain_frontend():
            try:
                for line in iter(self.frontend_process.stdout.readline, ""):
                    logging.debug(f"frontend: {line.strip()}")
            except Exception:
                pass

        threading.Thread(target=_drain_frontend, daemon=True).start()

        time.sleep(1)
        self.set_progress(90)

        # Step 5: Buka browser
        self.log(f"  Frontend berjalan: {FRONTEND_URL}")
        webbrowser.open(FRONTEND_URL)
        self.set_progress(100)

        self.log("\nAplikasi berjalan!")
        self.log(f"  Frontend : {FRONTEND_URL}")
        self.log(f"  Backend  : http://localhost:{BACKEND_PORT}")
        self.log(f"  API Docs : http://localhost:{BACKEND_PORT}/docs")
        self.log("\nTekan 'Keluar' untuk menghentikan semua server.")

        self.start_btn.configure(
            text="Buka Browser", state="normal", bg="#10B981",
            command=lambda: webbrowser.open(FRONTEND_URL),
        )

    def _on_start(self):
        threading.Thread(target=self._run_setup, daemon=True).start()

    def _on_quit(self):
        for proc in (self.backend_process, self.frontend_process):
            if proc:
                try:
                    proc.terminate()
                except Exception:
                    pass
        self.root.destroy()

    def run(self):
        self.root.protocol("WM_DELETE_WINDOW", self._on_quit)
        self.root.mainloop()


if __name__ == "__main__":
    LauncherApp().run()
