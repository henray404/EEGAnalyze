# 0015: Tab Encoding batch cuma CSV, dibuka di Excel data numpuk di satu kolom

**Tanggal ditemukan:** 2026-07-01
**Status:** resolved
**Komponen:** frontend
**Severity:** medium

---

## Gejala

Di halaman Batch tab Encoding/Chain, download hasil lalu dibuka di Excel: semua data masuk kolom pertama, kolom lain kosong. Sequence seperti `001` juga bisa berubah (leading zero hilang / jadi angka).

## Root Cause

Tab Encoding cuma menyediakan tombol CSV (`downloadCSV(encoding_records)`). CSV memakai pemisah koma; Excel dengan locale yang list-separator-nya titik-koma (mis. Indonesia) tidak memecah koma -> seluruh baris jatuh ke kolom A. Selain itu Excel auto-konversi `001` (chain_sequence) jadi angka. CSV-nya sendiri sebenarnya well-formed (14 kolom, 13 koma per baris) - masalahnya di interpretasi Excel.

## Solusi

Tambah tombol export Excel (.xlsx) asli di tab Encoding, sejajar dengan tombol CSV (seperti tab ERD & Data). xlsx punya kolom betulan (tidak bergantung locale) dan menyimpan sequence sebagai teks.
- `frontend_v2/src/pages/batch.jsx`: `handleExportEncodingExcel` -> `Api.exportExcel(recordsToScenarioSheets(encoding_records, 'Encoding'))`.
- `frontend_v2/src/pages/batch-tabs.jsx`: `EncodingTab` terima `onDownloadEncodingExcel`/`exporting`, tombol Excel baru.

## File yang Berubah

- `frontend_v2/src/pages/batch.jsx` (handler + prop)
- `frontend_v2/src/pages/batch-tabs.jsx` (`EncodingTab` tombol Excel)

## Verifikasi

POST `encoding_records` (14 kolom) ke `/export/excel` -> baca balik xlsx: 14 kolom lengkap, `chain_std_sequence` row = `'001'` (string, leading zero terjaga).

## Catatan Tambahan

- Akar umum "CSV koma vs Excel locale" berlaku untuk semua tombol CSV di app. Tab lain (ERD, Data) sudah punya Excel; ini menutup celah di tab Encoding.
- Terkait 0013 (union kolom export) yang membuat export robust untuk record heterogen.
