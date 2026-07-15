# Rebuilds dist/EEG-Analysis-Tool-Installer.exe from install.py.
# --windowed: no console window for the installer GUI itself.
# Run from repo root. Requires pyinstaller (pip install pyinstaller into .venv).

.venv\Scripts\python.exe -m PyInstaller --onefile --windowed `
    --name "EEG-Analysis-Tool-Installer" `
    --distpath dist --workpath build --specpath build `
    install.py