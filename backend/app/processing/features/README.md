# processing/features

Tahap **Ekstraksi Fitur** di pipeline EEG (lihat `CLAUDE.md`).

## Isi

- `features.py` -- `EEGFeatures`. Ekstraksi fitur full-data: per task, per
  occurrence, agregat occurrence, ERD/ERS. Time-domain (MAV/Variance/STD) +
  frequency-domain (band power/relative power/peak frequency via PSD).
- `chunking.py` -- `ChunkingPipeline`. Ekstraksi fitur per chunk (potongan
  waktu tetap) untuk whole-file, whole-task, atau occurrence spesifik + chain
  encoding (tren naik/turun antar chunk berturutan).
- `psd.py` -- `PSDAnalyzer`. Power Spectral Density (Welch / multitaper),
  dipakai `features.py` dan `chunking.py` untuk fitur frequency-domain.

## Dipakai oleh

`routers/single_file.py` dan `routers/batch.py` -- kedua endpoint /process
pakai modul yang sama persis (full-data lewat `features.py`, chunk mode lewat
`chunking.py`).

## Catatan penting

`_bandpass_array` ada di `chunking.py` (dengan `_butter_sos` yang di-cache)
DAN `features.py`, sengaja tidak disatukan penuh -- keduanya numerically
berbeda dikit (`<=` vs `<` di guard `min_len`). Kalau ubah salah satu, cek
yang lain juga biar tidak divergen lebih jauh.