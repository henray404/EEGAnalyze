# Changelog

## v2.3 - 2026-07-15

- Nomor versi sekarang punya satu sumber kebenaran: file VERSION di root repo. launcher.py dan backend (FastAPI title version + /health) baca dari situ, bukan konstanta terpisah yang gampang lupa disinkronkan

## v2.2 - 2026-07-15

- ML pipeline: split train/test group-aware (StratifiedGroupKFold, cegah data leakage antar subject), metrik tambahan (MCC, specificity, PR-AUC, CV mean+-std), fix crash confusion_matrix saat ada kelas hilang di test set
- Batch: seleksi occurrence bisa multi-task (chip select) + tombol Select All/Clear All, upper bound otomatis dari occurrence maksimum per task
- Single File: chunk mode + chain encoding sekarang bisa dipakai saat filter occurrence spesifik (sebelumnya dipaksa full-data-only)
- Error handling + logging menyeluruh di backend (semua router/processing) dan frontend (pesan error jelas, bukan gagal diam-diam)
- Fix ukuran icon oversize dan chart yang gepeng/squished di beberapa halaman
- Installer: shortcut Start Menu/Desktop dan tombol "Launch now" sekarang buka GUI launcher.py, bukan terminal start.bat; fix shortcut gagal dibuat (VBScript quote escaping) dan fix "Launch now" gagal diam-diam (Tcl/Tk env terwarisi dari installer beku)

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
