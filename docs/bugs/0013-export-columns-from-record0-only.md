# 0013: Export Excel/CSV ambil kolom dari records[0] saja (kolom hilang di record heterogen)

**Tanggal ditemukan:** 2026-07-01
**Status:** resolved
**Komponen:** backend + frontend
**Severity:** medium

---

## Gejala

Saat download Excel/CSV dari kumpulan record yang tidak seragam (mis. sebagian baris punya kolom `chunk` atau `erd_ers_pct`, sebagian tidak), kolom yang hanya ada di baris selain baris pertama diam-diam hilang dari file. Tidak ada error; datanya cuma tidak ikut.

## Cara Reproduksi

POST `/api/export/excel` dengan `records = [{"a":1,"b":2}, {"a":3,"b":4,"chunk":7}]`. Hasil xlsx cuma punya kolom `a`, `b` (kolom `chunk` hilang) karena header diambil dari `records[0].keys()`.

## Root Cause

`export.py _write_sheet` dan `api.js downloadCSV` menentukan header dari `records[0].keys()` saja. Kalau record heterogen, kolom milik baris lain tidak pernah jadi header. (Kelas bug yang sama dengan 0007 di deteksi fitur.)

## Solusi

Ambil UNION semua key (urutan kemunculan pertama) di kedua tempat:
- `backend/app/routers/export.py` `_write_sheet` — loop semua record kumpulkan key unik.
- `frontend_v2/src/api.js` `downloadCSV` — idem.

## File yang Berubah

- `backend/app/routers/export.py` (header derivation di `_write_sheet`)
- `frontend_v2/src/api.js` (`downloadCSV`)

## Verifikasi

POST `/export/excel` dengan record heterogen -> baca balik xlsx via openpyxl: header = `['a','b','chunk','erd_ers_pct']` (semua kolom ada).

## Catatan Tambahan

- Ditemukan saat investigasi laporan "bug ERD encode pas download excel". Record ERD yang diuji ternyata seragam (export jalan), tapi bug union ini nyata dan berpotensi kena kalau record dicampur (mis. chunked + non-chunked). Layar ERD spesifik yang dilaporkan user masih perlu dikonfirmasi.
