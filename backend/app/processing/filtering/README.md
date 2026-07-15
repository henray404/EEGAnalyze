# processing/filtering

Tahap **Filter** di pipeline EEG (lihat `CLAUDE.md`).

## Isi

- `filters.py` -- `EEGFilters`. Semua operasi filtering pada raw MNE object:
  bandpass, notch, CAR (common average reference), amplitude clipping, ICA
  artifact removal, bad channel detection (MAD threshold).

## Dipakai oleh

`routers/single_file.py` dan `routers/batch.py` lewat `_apply_filters()` di
masing-masing router (bukan di sini -- helper application-order-nya router
-specific, tapi implementasi filternya sendiri dipakai bersama).

## Catatan

Operasi di sini memodifikasi `loader.raw` in-place (MNE convention) dan
mencatat tiap langkah ke `loader.processing_log`.