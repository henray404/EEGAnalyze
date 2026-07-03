# Changelog

## v2.1 - 2026-07-03

- Seleksi occurrence per-task di Single File (isolasi satu occurrence spesifik, mis. "Thinking #1" saja, bukan semua occurrence dengan nama sama)
- Fix plot Raw/Filtered/ICA yang kelihatan flat setelah lonjakan awal - skala offset antar-channel sekarang dihitung per-channel, bukan dari data gabungan semua channel
- Installer baru (install.py) - satu file untuk clone repo ke komputer baru dan bikin shortcut, terpisah dari launcher.py yang urus setup venv + jalanin app

## v2.0 - 2026-05-26

- Migrasi dari Streamlit ke FastAPI + React
- Launcher GUI dengan auto-setup virtual environment
- Dua server: backend API (port 8000) + frontend statis (port 5173)
- Halaman analisis single file, batch, dan ML pipeline
- Deteksi ALS vs Normal dengan ekstraksi fitur subband EEG
