# Bug Log

Catatan setiap bug yang ditemukan selama development dan debugging, beserta penyebab dan solusinya.

## Tujuan

- Mencegah bug yang sama berulang.
- Mempermudah onboarding kontributor baru.
- Menjadi knowledge base untuk masalah-masalah yang spesifik ke domain (EEG processing, MNE library, FastAPI streaming, dsb).

## Workflow

Setiap kali sebuah bug ditemukan dan diselesaikan (atau saat sesi debugging menghasilkan insight penting), catat di sini.

### Aturan

1. **Wajib dicatat setiap kali debugging.** Tidak peduli sekecil apa pun bug-nya, jika ada effort untuk mencari root cause, catat.
2. **Satu file per bug.** Buat file baru di folder ini, jangan menambahkan ke file yang sudah ada.
3. **Penamaan file:** `NNNN-short-slug.md` di mana `NNNN` adalah nomor urut 4 digit (`0001`, `0002`, dst) dan `slug` deskripsi singkat dengan tanda hubung (kebab-case).
4. **Gunakan template** di `TEMPLATE.md`.
5. **Update index** di bawah ini saat menambah bug baru.
6. **Tidak ada emoji** di file bug.

### Status

- `open` — bug masih ada, belum ada solusi.
- `investigating` — sedang dicari root cause.
- `resolved` — sudah diperbaiki, solusi terverifikasi.
- `wontfix` — diputuskan tidak diperbaiki (jelaskan alasannya).

## Index

| ID | Tanggal | Status | Judul | File |
|----|---------|--------|-------|------|
| 0001 | 2026-05-12 | resolved | Dropzone memasukkan dummy data saat diklik, bukan membuka file picker | [0001-dropzone-hardcoded-dummy-data.md](0001-dropzone-hardcoded-dummy-data.md) |
| 0002 | 2026-05-12 | resolved | AttributeError: EEGFeatures has no attribute 'extract_features' | [0002-eefeatures-extract-features-not-found.md](0002-eefeatures-extract-features-not-found.md) |
| 0003 | 2026-05-13 | resolved | Frontend tidak dapat terhubung ke backend — CORS blocked + Python typing error | [0003-backend-connection-failed.md](0003-backend-connection-failed.md) |
| 0004 | 2026-05-17 | resolved | Halaman Single File tidak bisa dibuka karena typo tag `<script>` di index.html | [0004-single-file-script-tag-typo.md](0004-single-file-script-tag-typo.md) |
| 0005 | 2026-05-17 | resolved | Batch tabs menampilkan ikon oversize dan visual kosong meski data ada | [0005-batch-tabs-oversized-icons-and-empty-visuals.md](0005-batch-tabs-oversized-icons-and-empty-visuals.md) |
| 0006 | 2026-06-12 | resolved | Batch process "Tidak ada hasil dari server" karena NaN/Infinity di NDJSON | [0006-batch-ndjson-nan-infinity-no-result.md](0006-batch-ndjson-nan-infinity-no-result.md) |
| 0007 | 2026-06-12 | resolved | Tab batch bilang "tidak ada fitur" karena deteksi cuma cek records[0] (null Delta) | [0007-batch-tabs-feature-detection-record0-nan.md](0007-batch-tabs-feature-detection-record0-nan.md) |
| 0008 | 2026-06-12 | resolved | Subband Delta selalu NaN karena bandpass (b,a) tidak stabil di freq rendah | [0008-delta-subband-nan-iir-instability.md](0008-delta-subband-nan-iir-instability.md) |
| 0009 | 2026-06-21 | resolved | relative_power mode chunk hampir selalu ~1 karena dihitung dari sinyal yang sudah dibandpass | [0009-chunk-relative-power-always-one.md](0009-chunk-relative-power-always-one.md) |
| 0010 | 2026-07-01 | resolved | Bandpass chunk masih pakai (b,a) filtfilt (regresi 0008) — crash/NaN di chunk pendek | [0010-chunk-bandpass-ba-regression.md](0010-chunk-bandpass-ba-regression.md) |
| 0011 | 2026-07-01 | resolved | extract_occurrence_segment menyatukan occurrence task sama yang berdampingan | [0011-occurrence-segment-merge-adjacent.md](0011-occurrence-segment-merge-adjacent.md) |
| 0012 | 2026-07-01 | resolved | Tempfile .edf bocor tiap request (tidak pernah dibersihkan) | [0012-edf-tempfile-leak.md](0012-edf-tempfile-leak.md) |
| 0013 | 2026-07-01 | resolved | Export Excel/CSV ambil kolom dari records[0] saja (kolom hilang di record heterogen) | [0013-export-columns-from-record0-only.md](0013-export-columns-from-record0-only.md) |
| 0014 | 2026-07-01 | resolved | File tanpa annotation (TXT OpenBCI) tidak bisa diproses di Single File | [0014-single-file-txt-no-annotation-unprocessable.md](0014-single-file-txt-no-annotation-unprocessable.md) |
| 0015 | 2026-07-01 | resolved | Tab Encoding batch cuma CSV, dibuka di Excel numpuk di satu kolom | [0015-encoding-tab-no-excel-csv-one-column.md](0015-encoding-tab-no-excel-csv-one-column.md) |
| 0016 | 2026-07-02 | resolved | Plot Raw/Filtered/ICA flat total karena spread pakai std global bukan per-channel | [0016-signal-plot-flat-global-std-autoscale.md](0016-signal-plot-flat-global-std-autoscale.md) |
| 0017 | 2026-07-15 | resolved | Shortcut .lnk gagal dibuat -- VBScript compilation error di Arguments (kutip tak di-escape) | [0017-shortcut-vbscript-arguments-double-quote.md](0017-shortcut-vbscript-arguments-double-quote.md) |

## Cara Menambah Entry Baru

1. Salin `TEMPLATE.md` menjadi file baru dengan nama sesuai format penamaan.
2. Isi semua field yang ada di template.
3. Tambahkan baris baru di tabel **Index** di atas.
4. Commit dengan pesan `docs(bugs): add NNNN <short-description>`.
