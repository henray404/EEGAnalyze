import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import launcher


def test_venv_dir_is_under_backend_not_root():
    """Regresi: launcher.py sebelumnya pakai .venv di root, beda dari
    backend/.venv yang dipakai start.bat/start.sh dan didokumentasikan di
    CLAUDE.md. Kalau launcher.py dipakai (mis. lewat shortcut GUI), venv-nya
    harus sama dengan yang start.bat pakai, bukan bikin venv terpisah.
    """
    assert launcher.VENV_DIR == os.path.join(launcher.BACKEND_DIR, ".venv")


def test_venv_python_nested_under_backend_venv():
    assert launcher.VENV_DIR in launcher.VENV_PYTHON
    assert launcher.BACKEND_DIR in launcher.VENV_PYTHON


def test_requirements_path_under_backend():
    assert launcher.REQUIREMENTS == os.path.join(launcher.BACKEND_DIR, "requirements.txt")