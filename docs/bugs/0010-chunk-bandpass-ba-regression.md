# 0010: Bandpass chunk masih pakai (b,a) filtfilt — regresi dari fix 0008

**Tanggal ditemukan:** 2026-07-01
**Status:** resolved
**Komponen:** backend
**Severity:** critical

---

## Gejala

Log backend saat chunk mode / chunk_duration kecil:

```
filter_length (845) is longer than the signal (512), distortion is likely.
```

Subband Delta pada chunk pendek menghasilkan NaN atau `ValueError` dari `filtfilt` (signal < padlen), dan pada path serial `_run_chunk_units` tidak ada try/except sehingga seluruh request crash.

## Cara Reproduksi

1. Single File -> mode Chunk dengan chunk_duration kecil (mis. 0.3s) pada sfreq rendah.
2. Subband termasuk Delta (0.5-4 Hz).
3. Hasil: NaN di mav/variance/std Delta, atau 422 crash.

## Root Cause

Fix 0008 mengganti bandpass `(b, a)` + `filtfilt` menjadi SOS + `sosfiltfilt` di `features.py`, tapi `chunking.py` tidak ikut diubah. `chunking._bandpass_array` masih memakai `butter(..., btype="band")` bentuk transfer function yang tidak stabil numerik di subband frekuensi rendah, dan tanpa guard panjang minimum. `_MIN_CHUNK_SAMPLES = 4` jauh di bawah floor nyata (`filtfilt` padlen ~33, PSD Welch >= 8), jadi chunk yang lolos gate justru dijamin crash/degenerate.

## Solusi

- `_butter_coeffs` -> `_butter_sos` (`output="sos"`, tetap `lru_cache`).
- `_bandpass_array` pakai `sosfiltfilt` + guard `min_len = 3*(2*len(sos)+1)`; kalau data lebih pendek, kembalikan `np.zeros_like` (bukan crash).
- `_MIN_CHUNK_SAMPLES` 4 -> 64 (di atas floor filtfilt dan window PSD).

## File yang Berubah

- `backend/app/processing/chunking.py:40` (import), `:67` (`_MIN_CHUNK_SAMPLES`), `:74-91` (`_butter_sos`/`_bandpass_array`)

## Verifikasi

`backend/tests/test_qa_fixes.py`:
- `test_bandpass_short_signal_returns_zeros_no_crash`
- `test_bandpass_delta_no_nan_on_valid_length`

Jalankan: `cd backend && .venv/Scripts/python -m tests.test_qa_fixes` -> "OK: semua self-check QA fix lolos".

## Catatan Tambahan

- Sama persis dengan 0008 tapi di modul chunking. Pattern: kalau ganti implementasi filter, cari SEMUA `butter(...btype="band")` + `filtfilt` di codebase (features.py, chunking.py, routers/single_file.py plot/subband masih pakai filtfilt window pendek — lihat audit M4).
- Ditemukan lewat QA audit 2026-07-01 (agent pipeline + Codex).
