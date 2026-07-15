# 0002: AttributeError — EEGFeatures has no attribute 'extract_features'

**Tanggal ditemukan:** 2026-05-12
**Status:** resolved
**Komponen:** backend
**Severity:** high

---

## Gejala

```
type object 'EEGFeatures' has no attribute 'extract_features'
```

Error muncul saat endpoint `/api/single/process` atau `/api/batch/process` dipanggil dengan file EDF/ZIP nyata.

## Cara Reproduksi

1. Jalankan `uvicorn app.main:app --reload`
2. Upload file EDF nyata ke Single File page dan klik Proses Data
3. Backend mengembalikan HTTP 422 dengan detail error di atas

## Root Cause

Saat setup awal backend, digunakan nama method `EEGFeatures.extract_features()` yang tidak ada. Method asli di `features.py` adalah:

- `EEGFeatures.compute_subband_features()` — fitur per DataFrame segment
- `EEGFeatures.compute_task_features()` — fitur per task, per channel, per subband (method utama)
- `EEGFeatures.compute_occurrence_features()` — per occurrence
- dll

Selain itu, router hanya menghitung 3 fitur time-domain. Method `compute_task_features` sebenarnya juga menghitung `band_power`, `relative_power`, `peak_frequency` jika `include_frequency=True`.

## Solusi

Ganti `EEGFeatures.extract_features(...)` dengan `EEGFeatures.compute_task_features(loader, df, channels, tasks, subbands=..., features=..., include_frequency=True, ...)` di kedua router.

Tambahkan helper `_resolve_subbands()` untuk memetakan frontend ID (e.g. `"delta"`) ke dict key config (e.g. `"Delta"`), dan `_resolve_features()` untuk lowercase mapping.

Fitur lengkap per record setelah fix: `mav`, `variance`, `std`, `band_power`, `relative_power`, `peak_frequency`.

## File yang Berubah

- `backend/app/routers/single_file.py` — tambah `_resolve_subbands`, `_resolve_features`, ganti ke `compute_task_features`, tambah Form params lengkap
- `backend/app/routers/batch.py` — sama dengan single_file.py
- `frontend/src/config.js` — tambah `FEATURES_BACKEND_MAP`
- `frontend/src/SingleFile.jsx` — kirim `features`, `include_frequency`, PSD params ke FormData

## Verifikasi

1. Restart uvicorn
2. Upload file EDF, klik Proses Data
3. Backend return 200 dengan `features` berisi list of records dengan kolom: `task`, `channel`, `subband`, `mav`, `variance`, `std`, `band_power`, `relative_power`, `peak_frequency`

## Catatan Tambahan

- `compute_task_features` return DataFrame — dikonversi ke `orient="records"` untuk frontend.
- Fitur frekuensi dihitung via `PSDAnalyzer` secara batch, lebih efisien dari per-sample.
- Response format berubah dari `{"Task": {"channel": [...]}}` ke `[{"task": ..., "channel": ..., "subband": ..., "mav": ...}]`.
