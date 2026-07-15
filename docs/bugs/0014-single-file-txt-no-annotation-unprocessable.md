# 0014: File tanpa annotation (TXT OpenBCI / EDF tanpa marker) tidak bisa diproses di Single File

**Tanggal ditemukan:** 2026-07-01
**Status:** resolved
**Komponen:** backend + frontend
**Severity:** high

---

## Gejala

Upload file TXT OpenBCI (atau EDF tanpa annotation) di Single File lalu Ekstrak Fitur -> tidak ada fitur keluar. Setelah penambahan gate seleksi task/occurrence, tombol Ekstrak malah ke-disable permanen (karena tidak ada task untuk dipilih), jadi file TXT sama sekali tidak bisa diproses.

## Cara Reproduksi

1. Upload file TXT OpenBCI (kolom `EXG Channel 2..7`) di Single File.
2. `/upload` -> `tasks: []`, `occurrences: []`.
3. Sebelum fix: `/process` -> DataFrame kosong (loop `for task in []`), atau 400 "Task terpilih tidak ditemukan".

## Root Cause

`load_openbci_txt` membangun RawArray tanpa annotation (kondisi OpenBCI berasal dari nama file/folder, bukan marker di dalam file). `get_task_list()` -> `[]`. Pipeline `compute_task_features` mengiterasi `tasks`, jadi tanpa task tidak ada output. Gate seleksi baru (kosong = 400) memperparah: file tanpa task tidak punya yang bisa dipilih -> selalu terblok.

## Solusi

Fallback whole-file: kalau `get_task_list()` kosong, proses seluruh sinyal sebagai satu segmen berlabel `"(seluruh file)"`.
- `backend/app/routers/single_file.py` `/process`: `whole_file = not all_tasks`; guard seleksi-kosong hanya berlaku kalau ADA task; branch compute whole-file (full via `compute_subband_features`, chunk via `compute_chunked_subband_features`).
- `frontend_v2/src/pages/single-file.jsx`: `hasSegmentation()` -> kalau file tak punya task & occurrence, tombol tidak diblok + banner "diproses sebagai seluruh file".

## File yang Berubah

- `backend/app/routers/single_file.py` (`whole_file`, guard, branch compute)
- `frontend_v2/src/pages/single-file.jsx` (`hasSegmentation`, `selectionEmpty`, banner)

## Verifikasi

- Upload TXT sintetis (8 kanal, 2000 sampel) -> `/process` full: 200, `mode=full`, task `(seluruh file)`, 12 record (6 kanal x 2 subband).
- `/process` chunk: 200, `mode=chunk`, 96 record.
- Regresi recoveriX: task Left -> hanya Left; occurrence Left|1 -> hanya Left_1; seleksi kosong (file BER-task) -> tetap 400.

## Catatan Tambahan

- TXT tetap tidak punya segmentasi per-kondisi di satu file (satu file = satu kondisi via nama file). Whole-file adalah perilaku yang benar untuk sumber ini.
- Ditemukan dari permintaan user "cek bagian data terutama single file dan txt".
